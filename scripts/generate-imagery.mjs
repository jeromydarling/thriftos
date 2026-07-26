/**
 * Generate the homepage photography with FLUX.2 on Workers AI.
 *
 * Run once, commit the output. This is not part of the build — the images are
 * static files in public/img and the site never calls a model to draw them.
 *
 *   CLOUDFLARE_API_TOKEN=... node scripts/generate-imagery.mjs [id ...]
 *
 * With no arguments it generates every shot that doesn't already exist. Pass
 * ids to force those specific ones to be redrawn:
 *
 *   node scripts/generate-imagery.mjs rail counter
 *
 * The account id is discovered from the token rather than being a second
 * secret to keep in step. The token needs Workers AI read/write on top of
 * whatever the deploy uses.
 */
import { mkdirSync, existsSync, writeFileSync, statSync, rmSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const MODEL = "@cf/black-forest-labs/flux-2-dev";
const OUT_DIR = "public/img";
const API = "https://api.cloudflare.com/client/v4";

const token = process.env.CLOUDFLARE_API_TOKEN;
if (!token) {
  console.error("CLOUDFLARE_API_TOKEN is not set.");
  process.exit(1);
}

/**
 * The prompts live in app/content/imagery.ts, next to the alt text the site
 * renders, so the two can't drift. Node strips the types on import, which
 * saves adding a build step for one file — and means a change to the shape
 * over there fails here rather than silently generating a different set.
 */
async function loadShots() {
  const { SHOTS, fullPrompt } = await import("../app/content/imagery.ts");
  return SHOTS.map((s) => ({ ...s, prompt: fullPrompt(s) }));
}

async function accountId() {
  const res = await fetch(`${API}/accounts`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await res.json();
  if (!res.ok || !body.success) {
    throw new Error(
      `Could not list accounts: ${body.errors?.map((e) => e.message).join("; ") ?? res.status}`
    );
  }
  if (body.result.length !== 1) {
    // More than one account and no way to tell which — say so rather than
    // generating against whichever happens to be first.
    throw new Error(
      `The token can see ${body.result.length} accounts. Set CLOUDFLARE_ACCOUNT_ID to choose one.`
    );
  }
  return body.result[0].id;
}

/**
 * FLUX.2 takes multipart form data even when the only input is a prompt.
 * Passing the FormData through a Response is what produces the boundary in the
 * Content-Type header; sending the FormData directly does not.
 */
async function generate(account, shot, attempt = 1) {
  const form = new FormData();
  form.append("prompt", shot.prompt);
  form.append("width", String(shot.width));
  form.append("height", String(shot.height));
  form.append("steps", "30");

  const res = await fetch(`${API}/accounts/${account}/ai/run/${MODEL}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });

  // A busy GPU or a rate limit shouldn't cost a shot for the whole run. Only
  // retry what retrying can fix: a 401 or a 400 will say the same thing twice.
  if ((res.status >= 500 || res.status === 429) && attempt < 3) {
    const wait = attempt * 5000;
    console.log(`  ${shot.id} — ${res.status}, retrying in ${wait / 1000}s`);
    await new Promise((r) => setTimeout(r, wait));
    return generate(account, shot, attempt + 1);
  }

  const type = res.headers.get("content-type") ?? "";

  if (!res.ok) {
    const detail = type.includes("json")
      ? JSON.stringify(await res.json())
      : (await res.text()).slice(0, 400);
    throw new Error(`${res.status} — ${detail}`);
  }

  // A success can still be JSON: some models return a base64 payload rather
  // than raw bytes, and which one you get is not worth guessing at.
  if (type.includes("json")) {
    const body = await res.json();
    const b64 = body.result?.image ?? body.image;
    if (!b64) throw new Error(`No image in response: ${JSON.stringify(body).slice(0, 300)}`);
    return Buffer.from(b64, "base64");
  }

  return Buffer.from(await res.arrayBuffer());
}

/** Recompress to JPEG. A megabyte of PNG on a marketing page is not acceptable. */
function toJpeg(pngPath, jpegPath) {
  for (const [cmd, args] of [
    ["magick", [pngPath, "-quality", "82", "-strip", "-interlace", "Plane", jpegPath]],
    ["convert", [pngPath, "-quality", "82", "-strip", "-interlace", "Plane", jpegPath]],
  ]) {
    try {
      execFileSync(cmd, args, { stdio: "pipe" });
      return true;
    } catch {
      /* try the next one */
    }
  }
  return false;
}

const shots = await loadShots();
const only = process.argv.slice(2);
const wanted = only.length ? shots.filter((s) => only.includes(s.id)) : shots;

if (only.length && wanted.length !== only.length) {
  const known = shots.map((s) => s.id).join(", ");
  console.error(`Unknown shot id. Known ids: ${known}`);
  process.exit(1);
}

mkdirSync(OUT_DIR, { recursive: true });
const account = process.env.CLOUDFLARE_ACCOUNT_ID || (await accountId());
console.log(`Generating ${wanted.length} shot(s) with ${MODEL}\n`);

let failed = 0;

for (const shot of wanted) {
  const jpeg = join(OUT_DIR, `${shot.id}.jpg`);

  // Without an explicit id, an image that already exists is left alone —
  // regenerating the whole set on every run would silently replace art
  // somebody had already looked at and approved.
  if (!only.length && existsSync(jpeg)) {
    console.log(`· ${shot.id} — already drawn, skipping`);
    continue;
  }

  try {
    const bytes = await generate(account, shot);
    const png = join(OUT_DIR, `${shot.id}.png`);
    writeFileSync(png, bytes);

    if (toJpeg(png, jpeg)) {
      console.log(`✓ ${shot.id} — ${Math.round(statSync(jpeg).size / 1024)} KB`);
      rmSync(png, { force: true });
    } else {
      console.log(`✓ ${shot.id} — kept as PNG, no image tool available to recompress`);
    }
  } catch (err) {
    failed++;
    console.error(`✗ ${shot.id} — ${err instanceof Error ? err.message : err}`);
  }
}

process.exit(failed > 0 ? 1 : 0);
