/**
 * Copy drafts.
 *
 * The only place in the studio a model is used, and it obeys the same rules
 * NRI does: the output is labelled a draft, it is always editable, it is never
 * saved or posted without a person accepting it, and every call is logged.
 *
 * What it is allowed to do: rephrase facts the shop already has. What it is
 * not allowed to do: invent a fact. So a caption for an arrival is written
 * from a real title, a real price, and a real category — the model never sees
 * a blank page, and there is nothing for it to make up.
 *
 * The suggestions are also checked after the fact. A model trained on retail
 * copy reaches for urgency and superlatives by default, and "DON'T MISS OUT!!"
 * is exactly the register a charity shop shouldn't be in. `screen()` catches
 * that and the drafts are rejected rather than shown.
 */
import { run } from "../db";
import { newId } from "../ids";
import type { AppEnv } from "../env";
import { voiceFor, type BrandKit } from "../brand";
import type { ShopFacts } from "./assets";

const MODEL = "@cf/meta/llama-3.1-8b-instruct";

export type CopyPurpose =
  | "social_arrival"
  | "donation_appeal"
  | "volunteer_call"
  | "sale_announcement"
  | "shop_description";

export interface CopyRequest {
  purpose: CopyPurpose;
  kit: BrandKit;
  facts: ShopFacts;
  /** Which arrival, for social_arrival. */
  itemIndex?: number;
}

export interface CopyDraft {
  text: string;
  /** Always true. Present so no caller can render this without saying so. */
  isDraft: true;
}

export interface CopyResult {
  drafts: CopyDraft[];
  degraded: boolean;
  /** Why there are no drafts, in words for the shop. */
  message: string | null;
}

/**
 * Words a charity shop should not be made to say.
 *
 * Manufactured urgency, hollow superlatives, and the vocabulary of a clearance
 * warehouse. A draft containing any of these is dropped rather than shown,
 * because a volunteer under time pressure will accept whatever is on screen.
 */
const FORBIDDEN = [
  /don'?t miss (out|this)/i,
  /act (now|fast)/i,
  /limited time/i,
  /hurry/i,
  /while (stocks|supplies) last/i,
  /once[- ]in[- ]a[- ]lifetime/i,
  /unbeatable/i,
  /incredible deal/i,
  /amazing deal/i,
  /steal of a deal/i,
  /you won'?t believe/i,
  /must[- ]have/i,
  /shop now/i,
  /click here/i,
  /!!+/,
];

export interface ScreenResult {
  ok: boolean;
  reason: string | null;
}

/** Check a draft before a person ever sees it. */
export function screen(text: string): ScreenResult {
  const trimmed = text.trim();

  if (!trimmed) return { ok: false, reason: "empty" };
  if (trimmed.length > 400) return { ok: false, reason: "too long" };

  for (const pattern of FORBIDDEN) {
    if (pattern.test(trimmed)) return { ok: false, reason: `uses "${pattern.source}"` };
  }

  // Shouting. A line in block capitals is a line nobody in a charity shop
  // would have written by hand.
  const letters = trimmed.replace(/[^a-z]/gi, "");
  if (letters.length > 12) {
    const caps = trimmed.replace(/[^A-Z]/g, "").length;
    if (caps / letters.length > 0.5) return { ok: false, reason: "shouting" };
  }

  return { ok: true, reason: null };
}

/** Split a model response into candidate lines. */
export function splitDrafts(raw: string): string[] {
  return raw
    .split("\n")
    .map((line) =>
      line
        .trim()
        // Models number and bullet their lists however they like.
        .replace(/^[\d]+[.)]\s*/, "")
        .replace(/^[-*·•]\s*/, "")
        // And wrap things in quotes nobody asked for.
        .replace(/^["'“”](.*)["'“”]$/, "$1")
        .trim()
    )
    .filter(Boolean);
}

function promptFor(request: CopyRequest): { system: string; user: string } | null {
  const voice = voiceFor(request.kit);
  const { facts } = request;

  const system = [
    "You write short copy for a charity thrift store.",
    voice.guidance,
    "Rules you must follow without exception:",
    "- Use only facts given to you. Never invent a price, a date, a discount, or a claim.",
    "- Never use urgency: no 'don't miss out', no 'act now', no 'limited time', no 'while stocks last'.",
    "- Never use superlatives you cannot verify.",
    "- No exclamation marks. No words in block capitals. No hashtags. No emoji.",
    "- Write like a person who works there, not a marketing department.",
    "Return exactly three options, one per line, nothing else.",
  ].join("\n");

  switch (request.purpose) {
    case "social_arrival": {
      const item = facts.arrivals[request.itemIndex ?? 0];
      if (!item) return null;
      return {
        system,
        user: `Write three short social captions, under 30 words each, for this item that just reached the floor at ${facts.name}.
Item: ${item.title}
Price: $${(item.priceCents / 100).toFixed(2)}
Category: ${item.category ?? "not recorded"}
It is one of a kind. Mention that when it is gone it is gone, in your own words, at most once.`,
      };
    }

    case "donation_appeal":
      return {
        system,
        user: `Write three short appeals, under 40 words each, asking people to donate goods to ${facts.name}.
${facts.donationHours.length ? `Donation hours: ${facts.donationHours.join("; ")}` : "Donation hours are not recorded — do not mention hours."}
${facts.impact && facts.impact.itemsRehomed > 0 ? `So far this shop has rehomed ${facts.impact.itemsRehomed} items and kept ${Math.round(facts.impact.diversionLbs)} pounds out of landfill.` : "No impact figures are recorded — do not mention any numbers."}
Ask for good-quality items people would give a friend.`,
      };

    case "volunteer_call":
      return {
        system,
        user: `Write three short appeals, under 40 words each, asking for volunteers at ${facts.name}.
${facts.openShifts.length ? `Shifts currently unfilled: ${facts.openShifts.map((s) => `${s.label} on ${s.when}`).join("; ")}` : "No specific shifts are recorded — keep it general."}
Say that no experience is needed. Do not guilt anybody.`,
      };

    case "sale_announcement": {
      const live = facts.ladder.filter((r) => r.discountPct > 0);
      if (live.length === 0) return null;
      const deepest = live.slice().sort((a, b) => b.discountPct - a.discountPct)[0];
      return {
        system,
        user: `Write three short announcements, under 30 words each, for a markdown at ${facts.name}.
${deepest.tagColor} tags are ${deepest.discountPct}% off once they are ${deepest.ageDays} days old.
The discount is applied automatically at the till. There is no voucher and nothing to ask for.`,
      };
    }

    case "shop_description":
      return {
        system,
        user: `Write three short descriptions of ${facts.name}, under 45 words each, for the top of its website.
${facts.addressLines.length ? `Address: ${facts.addressLines.join(", ")}` : ""}
${facts.tagline ? `Their own tagline: ${facts.tagline}` : ""}
Everything sold is second-hand and one of a kind. Say what the shop is, not how wonderful it is.`,
      };
  }
}

/**
 * Draft some copy.
 *
 * Degrades to "no suggestions" rather than throwing. A studio that breaks
 * because a model was busy is worse than one that quietly says write it
 * yourself — which is what a shop was going to do anyway.
 */
export async function draftCopy(
  env: AppEnv,
  orgId: string,
  request: CopyRequest,
  userId?: string | null
): Promise<CopyResult> {
  const prompt = promptFor(request);
  if (!prompt) {
    return {
      drafts: [],
      degraded: false,
      message:
        "There isn't enough recorded for a useful draft yet. Add the details and try again.",
    };
  }

  if (!env.AI) {
    return {
      drafts: [],
      degraded: true,
      message: "Copy suggestions aren't switched on. Everything else in the studio still works.",
    };
  }

  const started = Date.now();
  let raw = "";

  try {
    const response = (await env.AI.run(MODEL, {
      messages: [
        { role: "system", content: prompt.system },
        { role: "user", content: prompt.user },
      ],
      max_tokens: 400,
      temperature: 0.7,
    })) as { response?: string };
    raw = response?.response ?? "";
  } catch (err) {
    await logCopy(env, orgId, userId, request.purpose, false, err, Date.now() - started, 0);
    return {
      drafts: [],
      degraded: true,
      message:
        "The suggestion service didn't answer just now. Write it yourself, or try again in a minute — nothing else is affected.",
    };
  }

  const kept = splitDrafts(raw)
    .filter((line) => screen(line).ok)
    .slice(0, 3)
    .map((text) => ({ text, isDraft: true as const }));

  await logCopy(env, orgId, userId, request.purpose, true, null, Date.now() - started, raw.length);

  if (kept.length === 0) {
    // Everything came back in the wrong register. Saying so is more useful
    // than showing a shop copy we'd already decided was unusable.
    return {
      drafts: [],
      degraded: false,
      message:
        "The suggestions came back sounding like a clearance sale, so we've held them back. Try again, or write it in your own words — you'll do it better.",
    };
  }

  return { drafts: kept, degraded: false, message: null };
}

async function logCopy(
  env: AppEnv,
  orgId: string,
  userId: string | null | undefined,
  purpose: string,
  ok: boolean,
  error: unknown,
  durationMs: number,
  outputChars: number
): Promise<void> {
  try {
    await run(
      env.DB,
      `INSERT INTO nri_ai_log
         (id, org_id, user_id, purpose, model, ok, error, output_chars, duration_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      newId("aiLog"),
      orgId,
      userId ?? null,
      `studio_copy:${purpose}`,
      MODEL,
      ok ? 1 : 0,
      error instanceof Error ? error.message.slice(0, 300) : null,
      outputChars,
      Math.round(durationMs)
    );
  } catch {
    // Logging must never be the reason a draft fails.
  }
}
