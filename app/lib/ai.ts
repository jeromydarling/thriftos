/**
 * Workers AI — item intake vision and short copy generation.
 *
 * House rules, enforced here rather than remembered:
 *   • AI drafts, a human approves. Nothing written here saves itself.
 *   • Every guess is labeled a guess, with a confidence the form can show.
 *   • Never invent a fact. Missing means null, not plausible-sounding filler.
 *   • Budget-gated and rate-limited per org; every call lands in nri_ai_log.
 *   • No AI binding? Everything still works — the form just opens empty.
 *
 * Donated goods photographed on a folding table in bad light are nothing like
 * catalogue photography, so extraction accuracy is genuinely mixed. That is
 * precisely why the intake form is editable by default and nothing auto-commits.
 */
import { first, run } from "./db";
import { newId } from "./ids";
import { getPlan, type PlanId } from "./pricing";

export const VISION_MODEL = "@cf/meta/llama-3.2-11b-vision-instruct";
export const TEXT_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

/** Monthly AI intake allowance per plan. Generous, but not unbounded. */
const MONTHLY_VISION_BUDGET: Record<PlanId, number> = {
  volunteer: 100,
  core: 1_000,
  federation: 5_000,
  enterprise: 25_000,
};

export interface ItemExtraction {
  title: string | null;
  category: string | null;
  brand: string | null;
  color: string | null;
  size: string | null;
  material: string | null;
  era: string | null;
  condition: "new" | "excellent" | "good" | "fair" | "flawed" | null;
  conditionNotes: string | null;
  suggestedPriceLowCents: number | null;
  suggestedPriceHighCents: number | null;
  retailEstimateCents: number | null;
  description: string | null;
  /** 0–1. Shown to staff so a shaky guess looks shaky. */
  confidence: number;
}

export interface AiOutcome<T> {
  ok: boolean;
  data: T | null;
  /** Friendly, plain-language reason. Safe to show a volunteer. */
  message: string | null;
  degraded: boolean;
}

const EMPTY_EXTRACTION: ItemExtraction = {
  title: null,
  category: null,
  brand: null,
  color: null,
  size: null,
  material: null,
  era: null,
  condition: null,
  conditionNotes: null,
  suggestedPriceLowCents: null,
  suggestedPriceHighCents: null,
  retailEstimateCents: null,
  description: null,
  confidence: 0,
};

const VISION_PROMPT = `You are helping a thrift store volunteer log a donated item.

Look at the photo and describe ONLY what you can actually see. This is a used,
donated item — often creased, dim, or photographed on a folding table. That is
normal. Do not flatter it and do not invent detail.

Return STRICT JSON, no prose, no markdown fence, with exactly these keys:
{
  "title": string|null,          // short, plain: "Blue wool peacoat"
  "category": string|null,       // e.g. "Outerwear", "Housewares", "Books"
  "brand": string|null,          // ONLY if a label or logo is legible. Else null.
  "color": string|null,
  "size": string|null,           // ONLY if a size tag is legible. Else null.
  "material": string|null,       // ONLY if stated on a label or obvious. Else null.
  "era": string|null,            // e.g. "modern", "1990s". Null if unsure.
  "condition": "new"|"excellent"|"good"|"fair"|"flawed"|null,
  "condition_notes": string|null,// visible flaws: stains, pilling, missing buttons
  "suggested_price_low": number|null,   // US dollars, thrift resale price
  "suggested_price_high": number|null,  // US dollars
  "retail_estimate": number|null,       // US dollars, comparable item bought new
  "description": string|null,    // 1-2 warm, honest sentences for a listing
  "confidence": number           // 0 to 1, your genuine confidence
}

Rules:
- If you cannot read a brand or size, use null. A guessed brand is worse than none.
- Note visible flaws honestly. A shopper who is surprised by a stain does not come back.
- Prices are for a US thrift store: low. Most clothing is 3 to 15 dollars.
- Never mention people, faces, or anything in the background.`;

/* ─── Budget ────────────────────────────────────────────────────────────── */

export async function visionUsageThisMonth(db: D1Database, orgId: string): Promise<number> {
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const row = await first<{ n: number }>(
    db,
    `SELECT COUNT(*) AS n FROM nri_ai_log
      WHERE org_id = ? AND purpose = 'item_vision' AND ok = 1 AND created_at >= ?`,
    orgId,
    monthStart.toISOString()
  );
  return Number(row?.n ?? 0);
}

export async function visionBudget(
  db: D1Database,
  orgId: string,
  plan: PlanId
): Promise<{ used: number; limit: number; remaining: number; exhausted: boolean }> {
  const limit = MONTHLY_VISION_BUDGET[plan] ?? MONTHLY_VISION_BUDGET.volunteer;
  const used = await visionUsageThisMonth(db, orgId);
  return { used, limit, remaining: Math.max(0, limit - used), exhausted: used >= limit };
}

async function logAi(
  db: D1Database,
  entry: {
    orgId: string;
    userId?: string | null;
    purpose: string;
    model: string;
    ok: boolean;
    error?: string | null;
    inputChars?: number;
    outputChars?: number;
    durationMs: number;
  }
): Promise<void> {
  try {
    await run(
      db,
      `INSERT INTO nri_ai_log
         (id, org_id, user_id, purpose, model, ok, error, input_chars, output_chars, duration_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      newId("aiLog"),
      entry.orgId,
      entry.userId ?? null,
      entry.purpose,
      entry.model,
      entry.ok ? 1 : 0,
      entry.error ?? null,
      entry.inputChars ?? 0,
      entry.outputChars ?? 0,
      Math.round(entry.durationMs)
    );
  } catch (err) {
    console.warn("ai log write failed:", err);
  }
}

/* ─── Vision extraction ─────────────────────────────────────────────────── */

export async function extractItemFromPhoto(
  env: Env,
  opts: { orgId: string; userId?: string | null; plan: PlanId; image: ArrayBuffer }
): Promise<AiOutcome<ItemExtraction>> {
  // Degrade clean: without the binding the shop still logs items by hand.
  if (!env.AI) {
    return {
      ok: false,
      data: null,
      degraded: true,
      message: "Photo reading isn't switched on yet — fill in what you know and save.",
    };
  }

  const budget = await visionBudget(env.DB, opts.orgId, opts.plan);
  if (budget.exhausted) {
    return {
      ok: false,
      data: null,
      degraded: true,
      message: `You've used this month's ${budget.limit} photo reads. Everything still works — you'll just be typing rather than correcting.`,
    };
  }

  const started = Date.now();
  try {
    const response = (await env.AI.run(VISION_MODEL as never, {
      // Workers AI vision takes the image as a byte array.
      image: [...new Uint8Array(opts.image)],
      prompt: VISION_PROMPT,
      max_tokens: 640,
    } as never)) as { response?: string };

    const raw = String(response?.response ?? "");
    const parsed = parseExtraction(raw);

    await logAi(env.DB, {
      orgId: opts.orgId,
      userId: opts.userId,
      purpose: "item_vision",
      model: VISION_MODEL,
      ok: true,
      inputChars: VISION_PROMPT.length,
      outputChars: raw.length,
      durationMs: Date.now() - started,
    });

    if (!parsed) {
      return {
        ok: false,
        data: null,
        degraded: false,
        message: "I couldn't make sense of that photo. Try another angle, or just type it in.",
      };
    }

    return { ok: true, data: parsed, degraded: false, message: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await logAi(env.DB, {
      orgId: opts.orgId,
      userId: opts.userId,
      purpose: "item_vision",
      model: VISION_MODEL,
      ok: false,
      error: message,
      durationMs: Date.now() - started,
    });
    return {
      ok: false,
      data: null,
      degraded: true,
      message: "Photo reading is having a moment. Fill in what you know — nothing is lost.",
    };
  }
}

/**
 * Parse the model's JSON defensively. Anything unreadable becomes null rather
 * than a plausible-looking invention, and every number is clamped to something
 * a thrift store could actually charge.
 */
export function parseExtraction(raw: string): ItemExtraction | null {
  const jsonText = extractJsonObject(raw);
  if (!jsonText) return null;

  let obj: Record<string, unknown>;
  try {
    const parsed = JSON.parse(jsonText);
    if (!parsed || typeof parsed !== "object") return null;
    obj = parsed as Record<string, unknown>;
  } catch {
    return null;
  }

  const conditions = ["new", "excellent", "good", "fair", "flawed"] as const;
  const condition = conditions.includes(obj.condition as never)
    ? (obj.condition as ItemExtraction["condition"])
    : null;

  const low = dollarsToCents(obj.suggested_price_low);
  const high = dollarsToCents(obj.suggested_price_high);

  return {
    ...EMPTY_EXTRACTION,
    title: cleanString(obj.title, 120),
    category: cleanString(obj.category, 60),
    brand: cleanString(obj.brand, 60),
    color: cleanString(obj.color, 40),
    size: cleanString(obj.size, 30),
    material: cleanString(obj.material, 60),
    era: cleanString(obj.era, 30),
    condition,
    conditionNotes: cleanString(obj.condition_notes, 300),
    suggestedPriceLowCents: low,
    // A high below the low is nonsense; drop it rather than show a broken range.
    suggestedPriceHighCents: high !== null && low !== null && high < low ? null : high,
    retailEstimateCents: dollarsToCents(obj.retail_estimate, 200_000),
    description: cleanString(obj.description, 600),
    confidence: clamp01(obj.confidence),
  };
}

/** Models like to wrap JSON in prose or a fence. Find the object anyway. */
function extractJsonObject(raw: string): string | null {
  const trimmed = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "");
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return trimmed.slice(start, end + 1);
}

function cleanString(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  // Models sometimes emit these instead of a proper null.
  if (/^(null|n\/a|none|unknown|unclear|not visible)$/i.test(trimmed)) return null;
  return trimmed.slice(0, max);
}

/** Dollars → integer cents, clamped. Currency never touches a float downstream. */
function dollarsToCents(value: unknown, maxCents = 50_000): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? parseFloat(value) : NaN;
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.min(maxCents, Math.round(n * 100));
}

function clamp01(value: unknown): number {
  const n = typeof value === "number" ? value : parseFloat(String(value));
  if (!Number.isFinite(n)) return 0.5;
  return Math.min(1, Math.max(0, n));
}

/** How the UI should describe a confidence number, in words a volunteer trusts. */
export function confidenceLabel(confidence: number): { label: string; tone: "high" | "medium" | "low" } {
  if (confidence >= 0.75) return { label: "Fairly sure", tone: "high" };
  if (confidence >= 0.45) return { label: "Worth a second look", tone: "medium" };
  return { label: "Just a rough guess", tone: "low" };
}
