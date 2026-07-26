/**
 * Gathering what an asset needs from what the shop already records.
 *
 * The rule for every field here: it either comes from a record, or it comes
 * back empty and the asset says so. Nothing is padded with a plausible default,
 * because a poster that invents opening hours is worse than one that admits it
 * doesn't know them — a customer turns up to a locked door either way, but only
 * one of those is our fault.
 */
import { all, first } from "../db";
import { DEFAULT_MARKDOWN_RULES } from "../markdown";
import { DIVERTED_STATUS_SQL, realOnly } from "../impact";
import { parseBrandKit, type BrandKit } from "../brand";
import type { ShopFacts } from "./assets";

export interface StudioContext {
  kit: BrandKit;
  logoKey: string | null;
  facts: ShopFacts;
}

/** Opening hours live in settings as free text, one line per day. */
function hourLines(raw: unknown): string[] {
  if (typeof raw !== "string") return [];
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 8);
}

function listLines(raw: unknown, fallback: string[]): string[] {
  if (typeof raw !== "string" || !raw.trim()) return fallback;
  return raw
    .split("\n")
    .map((line) => line.trim().replace(/^[·\-*]\s*/, ""))
    .filter(Boolean)
    .slice(0, 10);
}

/**
 * What most thrift shops can and can't take.
 *
 * Offered as a starting point a shop edits, not as a claim about their policy.
 * The studio shows these as prefilled and editable rather than baked in.
 */
export const DEFAULT_ACCEPTED = [
  "Clean clothing and shoes",
  "Books, records, and games",
  "Kitchenware and small appliances that work",
  "Furniture you could carry in yourself",
  "Linens, curtains, and bedding",
  "Toys with all their pieces",
];

export const DEFAULT_NOT_ACCEPTED = [
  "Mattresses and bed bases",
  "Anything damp, mouldy, or torn",
  "Car seats, cots, and helmets",
  "Large appliances and televisions",
  "Building materials and paint",
];

export async function gatherStudioContext(
  db: D1Database,
  orgId: string,
  appUrl: string
): Promise<StudioContext> {
  const [org, kitRow, rules, impact, arrivals, openShifts] = await Promise.all([
    first<{
      name: string;
      slug: string;
      street: string | null;
      city: string | null;
      state: string | null;
      postal_code: string | null;
      phone: string | null;
      settings_json: string;
    }>(
      db,
      `SELECT name, slug, street, city, state, postal_code, phone, settings_json
         FROM orgs WHERE id = ?`,
      orgId
    ),
    first<{ kit_json: string; logo_key: string | null }>(
      db,
      `SELECT kit_json, logo_key FROM brand_kits WHERE org_id = ?`,
      orgId
    ),
    all<{ tag_color: string; discount_pct: number; age_days: number; week_index: number }>(
      db,
      `SELECT tag_color, discount_pct, age_days, week_index FROM markdown_rules
        WHERE org_id = ? AND is_active = 1 ORDER BY week_index`,
      orgId
    ),
    first<{
      diversion_lbs: number;
      items_rehomed: number;
      volunteer_hours: number;
      value_delivered: number;
    }>(
      db,
      // The same definitions the impact report uses, sample data excluded. A
      // poster and the board report must never disagree.
      `SELECT
         COALESCE((SELECT SUM(weight_lbs) FROM items
                    WHERE org_id = ?1 AND ${realOnly()}
                      AND status IN (${DIVERTED_STATUS_SQL})), 0) AS diversion_lbs,
         (SELECT COUNT(*) FROM items
           WHERE org_id = ?1 AND ${realOnly()} AND status = 'sold') AS items_rehomed,
         COALESCE((SELECT SUM(hours_logged) FROM shifts
                    WHERE org_id = ?1 AND ${realOnly()} AND status = 'completed'), 0) AS volunteer_hours,
         COALESCE((SELECT SUM(MAX(ti.retail_estimate_cents - ti.price_cents, 0))
                     FROM transaction_items ti JOIN transactions t ON t.id = ti.transaction_id
                    WHERE ti.org_id = ?1 AND ${realOnly("t")}
                      AND t.voided_at IS NULL), 0) AS value_delivered`,
      orgId
    ),
    all<{ title: string; price_cents: number; category: string | null }>(
      db,
      // Genuinely on the floor, genuinely priced. A post about something
      // already sold sends someone to the shop for nothing.
      `SELECT title, price_cents, category FROM items
        WHERE org_id = ? AND status = 'available' AND price_cents > 0 AND ${realOnly()}
        ORDER BY created_at DESC LIMIT 12`,
      orgId
    ),
    all<{ role_label: string; starts_at: string }>(
      db,
      `SELECT role_label, starts_at FROM shifts
        WHERE org_id = ? AND status = 'scheduled' AND contact_id IS NULL
          AND starts_at > datetime('now') AND ${realOnly()}
        ORDER BY starts_at LIMIT 8`,
      orgId
    ),
  ]);

  let settings: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(org?.settings_json ?? "{}");
    if (parsed && typeof parsed === "object") settings = parsed as Record<string, unknown>;
  } catch {
    settings = {};
  }

  const kit = parseBrandKit(kitRow?.kit_json);

  const addressLines = [
    org?.street ?? "",
    [org?.city, org?.state].filter(Boolean).join(", ") + (org?.postal_code ? ` ${org.postal_code}` : ""),
  ]
    .map((line) => line.trim())
    .filter(Boolean);

  const facts: ShopFacts = {
    name: org?.name ?? "Your shop",
    tagline: kit.tagline,
    addressLines,
    phone: org?.phone ?? null,
    siteUrl: `${appUrl.replace(/^https?:\/\//, "")}/${org?.slug ?? ""}`,
    ladder:
      rules.length > 0
        ? rules.map((r) => ({
            tagColor: r.tag_color,
            discountPct: r.discount_pct,
            ageDays: r.age_days,
          }))
        : DEFAULT_MARKDOWN_RULES.map((r) => ({
            tagColor: r.tagColor,
            discountPct: r.discountPct,
            ageDays: r.ageDays,
          })),
    impact: impact
      ? {
          diversionLbs: Number(impact.diversion_lbs ?? 0),
          itemsRehomed: Number(impact.items_rehomed ?? 0),
          volunteerHours: Number(impact.volunteer_hours ?? 0),
          valueDeliveredCents: Number(impact.value_delivered ?? 0),
        }
      : null,
    arrivals: arrivals.map((item) => ({
      title: item.title,
      priceCents: item.price_cents,
      category: item.category,
    })),
    openShifts: openShifts.map((shift) => ({
      label: shift.role_label.charAt(0).toUpperCase() + shift.role_label.slice(1),
      when: new Date(shift.starts_at).toLocaleDateString("en-US", {
        weekday: "long",
        month: "short",
        day: "numeric",
      }),
    })),
    hours: hourLines(settings.openingHours),
    donationHours: hourLines(settings.donationHours),
    accepted: listLines(settings.accepted, DEFAULT_ACCEPTED),
    notAccepted: listLines(settings.notAccepted, DEFAULT_NOT_ACCEPTED),
  };

  return { kit, logoKey: kitRow?.logo_key ?? null, facts };
}

/** Does the shop have enough recorded for this asset to say anything true? */
export function assetReadiness(facts: ShopFacts): Record<string, string | null> {
  return {
    sale_sign:
      facts.ladder.some((r) => r.discountPct > 0)
        ? null
        : "Set up your colour-tag rotation first — there's nothing on offer to advertise.",
    tag_ladder: null,
    donation_poster:
      facts.donationHours.length > 0
        ? null
        : "Add your donation hours in Settings and this will fill itself in.",
    impact_poster:
      facts.impact && facts.impact.itemsRehomed > 0
        ? null
        : "Ring up a few sales first. This poster reports what actually happened, so it needs something to report.",
    volunteer_call: null,
    social_arrival:
      facts.arrivals.length > 0
        ? null
        : "Log some stock — this posts about what's genuinely on the floor.",
    hours_card:
      facts.hours.length > 0 ? null : "Add your opening hours in Settings.",
    shelf_talker: null,
  };
}
