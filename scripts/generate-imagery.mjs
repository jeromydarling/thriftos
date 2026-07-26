/**
 * Generate the project's photography with FLUX.2 on Workers AI.
 *
 * Run once, commit the output. This is not part of the build — the images are
 * static files under public/img and nothing calls a model to draw them at
 * request time.
 *
 *   CLOUDFLARE_API_TOKEN=... node scripts/generate-imagery.mjs [--set=NAME] [id ...]
 *
 * With no arguments it generates every shot in the set that doesn't already
 * exist. Pass ids to force those specific ones to be redrawn:
 *
 *   node scripts/generate-imagery.mjs rail counter
 *   node scripts/generate-imagery.mjs --set=demo cable-knit
 *
 * The account id is discovered from the token rather than being a second
 * secret to keep in step. The token needs Workers AI read/write on top of
 * whatever the deploy uses.
 */
import { mkdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";

const MODEL = "@cf/black-forest-labs/flux-2-dev";
const STEPS = 28;
/** A request still silent after this is stuck, not working. */
const REQUEST_TIMEOUT_MS = 150_000;
const API = "https://api.cloudflare.com/client/v4";

/**
 * Two sets, one pipeline.
 *
 * The prompts live in app/content/, next to the alt text the app renders, so
 * the two can't drift. Node strips the types on import, which saves adding a
 * build step for one file — and means a change to the shape over there fails
 * here rather than silently generating a different set.
 *
 * `site` is the marketing photography, which flatters. `demo` is the demo
 * shop's stock, which deliberately does not — those prompts ask for clutter,
 * bad light and crooked framing, because they are the *input* to the cleanup
 * and a cleanup demonstrated on studio photography demonstrates nothing.
 *
 * They share everything else. A second copy of the retry logic and the
 * multipart handling is a second place for the next FLUX quirk to be fixed
 * only once.
 */
const SETS = {
  site: {
    dir: "public/img",
    async load() {
      const { SHOTS, fullPrompt } = await import("../app/content/imagery.ts");
      return SHOTS.map((s) => ({ ...s, prompt: fullPrompt(s) }));
    },
  },
  demo: {
    dir: "public/img/demo",
    async load() {
      const { DEMO_PHOTOS, snapshotPrompt, DEMO_PHOTO_SIZE } = await import(
        "../app/content/demo-photos.ts"
      );
      return DEMO_PHOTOS.map((p) => ({
        id: p.id,
        prompt: snapshotPrompt(p),
        width: DEMO_PHOTO_SIZE,
        height: DEMO_PHOTO_SIZE,
      }));
    },
  },
};

const token = process.env.CLOUDFLARE_API_TOKEN;
if (!token) {
  console.error("CLOUDFLARE_API_TOKEN is not set.");
  process.exit(1);
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
  form.append("steps", String(STEPS));

  // Serialise the form to a Buffer rather than handing FormData to fetch.
  //
  // Passing FormData directly makes Node send a chunked body with no
  // Content-Length, and this endpoint can simply never answer one — which is
  // not a slow request but a hung one, indistinguishable from a slow model
  // until the job times out. Going through a Response is also the only way to
  // get the multipart boundary into the Content-Type header.
  const packed = new Response(form);
  const body = Buffer.from(await packed.arrayBuffer());

  console.log(`  ${shot.id} — requesting${attempt > 1 ? ` (attempt ${attempt})` : ""}`);

  const res = await fetch(`${API}/accounts/${account}/ai/run/${MODEL}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": packed.headers.get("content-type"),
    },
    body,
    // A request that hasn't answered in this long is stuck, not working.
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
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

/**
 * Recompress to a web-weight JPEG.
 *
 * Not optional. The model hands back roughly 780 KB per image — three
 * megabytes of photography on a marketing page whose whole argument is that
 * it's lighter than what a shop is currently paying for. At quality 80 the
 * same pictures come out around 80 KB with the grain and halation intact,
 * which is the part that has to survive.
 *
 * sharp rather than a shell tool: the first run reached for ImageMagick,
 * found neither `magick` nor `convert` on the runner, and silently kept
 * 780 KB files named .png that were actually JPEG bytes.
 */
async function compress(bytes, jpegPath) {
  await sharp(bytes).jpeg({ quality: 80, progressive: true, mozjpeg: true }).toFile(jpegPath);
  return statSync(jpegPath).size;
}

const args = process.argv.slice(2);
const setFlag = args.find((a) => a.startsWith("--set="));
const setName = setFlag ? setFlag.slice("--set=".length) : "site";
const set = SETS[setName];
if (!set) {
  console.error(`Unknown set "${setName}". Known sets: ${Object.keys(SETS).join(", ")}`);
  process.exit(1);
}

const OUT_DIR = set.dir;
const shots = await set.load();
const only = args.filter((a) => a !== setFlag);
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

const todo = wanted.filter((shot) => {
  // Without an explicit id, an image that already exists is left alone —
  // regenerating the whole set on every run would silently replace art
  // somebody had already looked at and approved.
  if (!only.length && existsSync(join(OUT_DIR, `${shot.id}.jpg`))) {
    console.log(`· ${shot.id} — already drawn, skipping`);
    return false;
  }
  return true;
});

async function draw(shot) {
  const jpeg = join(OUT_DIR, `${shot.id}.jpg`);
  try {
    const bytes = await generate(account, shot);
    const size = await compress(bytes, jpeg);
    console.log(`✓ ${shot.id} — ${Math.round(size / 1024)} KB`);
  } catch (err) {
    failed++;
    const reason = err instanceof Error ? err.message : String(err);
    console.error(
      `✗ ${shot.id} — ${err?.name === "TimeoutError" ? `no answer in ${REQUEST_TIMEOUT_MS / 1000}s` : reason}`
    );
  }
}

// Three at a time. Sequential meant one slow shot delayed every shot behind
// it; unbounded would just get us rate limited.
const queue = [...todo];
await Promise.all(
  Array.from({ length: Math.min(3, queue.length) }, async () => {
    while (queue.length) await draw(queue.shift());
  })
);

console.log(`\nDrew ${todo.length - failed} of ${todo.length}.`);
process.exit(failed > 0 ? 1 : 0);
