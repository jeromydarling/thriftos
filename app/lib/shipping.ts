/**
 * Postage, priced from weight the shop already recorded.
 *
 * The weight on an item exists for landfill-diversion reporting. It also
 * happens to be the number a carrier charges on, which means a shop using
 * ThriftOS gets accurate postage from data it collected for an entirely
 * different reason — where every other platform makes somebody type it twice or
 * guess and eat the difference.
 *
 * Bands rather than live carrier rates. A shop can explain a band to a customer
 * and to itself; a live rate that came back wrong on a Saturday is a mystery
 * nobody in the building can debug.
 */
import { all, first } from "./db";

export interface ShippingBand {
  id: string;
  label: string;
  /** Inclusive upper bound, in grams. */
  max_grams: number;
  price_cents: number;
  sort_order: number;
}

/** Grams per pound. Items store pounds; scales and carriers speak grams. */
const GRAMS_PER_LB = 453.59237;

export function lbsToGrams(lbs: number): number {
  return Math.round(lbs * GRAMS_PER_LB);
}

/**
 * What we assume an item weighs when nobody recorded it.
 *
 * Not zero. Zero would quietly post a coat in the cheapest band and lose the
 * shop money on every unweighed item, which is exactly the sort of silent,
 * compounding error that only shows up in a quarterly reconciliation. A
 * deliberate over-estimate costs a shopper a few pence and is visible.
 */
export const ASSUMED_GRAMS = 500;

export interface ShippableLine {
  itemId: string;
  title: string;
  /** Null when the shop never weighed it. */
  weightLbs: number | null;
}

export interface ShippingQuote {
  /** Null when nothing in the order can be posted at any band the shop offers. */
  band: ShippingBand | null;
  priceCents: number;
  grams: number;
  /** Items with no recorded weight, so the shop can see what it's guessing at. */
  assumed: string[];
  /** Set when no band is heavy enough. Shown to the shopper, not swallowed. */
  reason: string | null;
}

/**
 * Total an order's weight.
 *
 * Sums the items and adds nothing for packaging. Padding the number here would
 * be a second, invisible price rise on top of the band, and a shop that wants
 * to cover boxes and tape should say so in the band price where it can see it.
 */
export function orderGrams(lines: readonly ShippableLine[]): {
  grams: number;
  assumed: string[];
} {
  let grams = 0;
  const assumed: string[] = [];

  for (const line of lines) {
    if (line.weightLbs && line.weightLbs > 0) {
      grams += lbsToGrams(line.weightLbs);
    } else {
      grams += ASSUMED_GRAMS;
      assumed.push(line.title);
    }
  }

  return { grams, assumed };
}

/**
 * The cheapest band that will carry this order.
 *
 * Bands are inclusive upper bounds, so a 500g order fits a 500g band. Sorted by
 * weight rather than by price: a shop that has priced a heavier band lower has
 * made a mistake, and quietly picking it would hide the mistake rather than
 * letting them find it.
 */
export function quoteFor(
  lines: readonly ShippableLine[],
  bands: readonly ShippingBand[]
): ShippingQuote {
  const { grams, assumed } = orderGrams(lines);

  if (bands.length === 0) {
    return {
      band: null,
      priceCents: 0,
      grams,
      assumed,
      reason: "This shop hasn't set up postage yet. You can still collect in store.",
    };
  }

  const byWeight = [...bands].sort((a, b) => a.max_grams - b.max_grams);
  const band = byWeight.find((b) => grams <= b.max_grams) ?? null;

  if (!band) {
    const heaviest = byWeight[byWeight.length - 1];
    return {
      band: null,
      priceCents: 0,
      grams,
      assumed,
      // Named rather than generic: "too heavy to post" leaves a shopper with
      // nothing to do, and collection is very often the answer they'd take.
      reason: `This order weighs more than the largest parcel this shop posts (${heaviest.label}). Collecting in store works, or buy fewer items in one go.`,
    };
  }

  return { band, priceCents: band.price_cents, grams, assumed, reason: null };
}

/* ─── Storage ────────────────────────────────────────────────────────────── */

export async function bandsFor(db: D1Database, orgId: string): Promise<ShippingBand[]> {
  return all<ShippingBand>(
    db,
    `SELECT id, label, max_grams, price_cents, sort_order
       FROM shipping_bands
      WHERE org_id = ? AND is_active = 1
      ORDER BY max_grams`,
    orgId
  );
}

/**
 * A starting set, described in things rather than in grams.
 *
 * Offered on the settings screen as something to edit rather than written
 * automatically — a shop's postage is a commercial decision and inventing one
 * silently would be us setting their prices.
 *
 * The lightest band is capped well below what a letter format actually permits
 * by weight, and that is deliberate. Letter rates are limited by *thickness*,
 * which we cannot measure and a shop will not type in: a 680g jumper is inside
 * every letter weight limit and will never go as one. Holding the band down to
 * roughly what a genuinely flat thing weighs makes weight a usable stand-in for
 * a dimension we don't have, and errs toward charging the parcel rate rather
 * than under-collecting on every jumper.
 */
export const SUGGESTED_BANDS: readonly Omit<ShippingBand, "id">[] = [
  { label: "Large letter — a scarf, a paperback", max_grams: 250, price_cents: 399, sort_order: 0 },
  { label: "Small parcel — most clothing", max_grams: 2000, price_cents: 599, sort_order: 1 },
  { label: "Parcel — a coat, boots, several items", max_grams: 6000, price_cents: 899, sort_order: 2 },
];

/**
 * Whether an order can be posted at all.
 *
 * Kept separate from quoteFor so a caller that only needs the yes/no — the
 * checkout deciding whether to offer postage as an option — doesn't have to
 * reason about a quote it will throw away.
 */
export async function canPost(db: D1Database, orgId: string): Promise<boolean> {
  const row = await first<{ n: number }>(
    db,
    `SELECT COUNT(*) AS n FROM shipping_bands WHERE org_id = ? AND is_active = 1`,
    orgId
  );
  return Number(row?.n ?? 0) > 0;
}
