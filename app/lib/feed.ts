/**
 * What goes in a shop's product feed, and why the rest doesn't.
 *
 * The predicate lives here and is read twice: once by the feed itself, once by
 * the screen that tells a shop how many items are in it. Two copies of a rule
 * like this is how a shop ends up looking at "412 items listed" above a feed
 * containing eleven.
 *
 * A photograph is required, and that isn't our rule — a shopping channel
 * rejects an entry with no image. So an item without one is excluded rather
 * than sent and bounced, and the shop is told the count so an empty feed is
 * never a mystery.
 */
import { first } from "./db";
import { realOnly } from "./impact";

/**
 * The SQL every feed reader shares.
 *
 * Written as a fragment rather than a function returning rows, because the feed
 * needs the columns and the readiness check needs only a count, and generating
 * both from one string is what keeps them honest.
 */
export const FEED_PREDICATE = `status = 'available'
       AND price_cents > 0
       AND held_by_transaction_id IS NULL
       AND photo_key IS NOT NULL
       AND ${realOnly()}`;

export interface FeedReadiness {
  /** Items that will appear. */
  listed: number;
  /** Available, priced, but with no photograph — the usual reason for a gap. */
  missingPhoto: number;
  /** Available but priced at nothing. A channel rejects a zero price. */
  missingPrice: number;
  /** Plain-language summary, or null when everything sellable is in the feed. */
  note: string | null;
}

export async function feedReadiness(db: D1Database, orgId: string): Promise<FeedReadiness> {
  const row = await first<{
    listed: number;
    missing_photo: number;
    missing_price: number;
  }>(
    db,
    `SELECT
       SUM(CASE WHEN ${FEED_PREDICATE} THEN 1 ELSE 0 END) AS listed,
       SUM(CASE WHEN status = 'available' AND price_cents > 0 AND photo_key IS NULL
                     AND ${realOnly()} THEN 1 ELSE 0 END) AS missing_photo,
       SUM(CASE WHEN status = 'available' AND price_cents <= 0 AND ${realOnly()}
                THEN 1 ELSE 0 END) AS missing_price
     FROM items WHERE org_id = ?`,
    orgId
  );

  const listed = Number(row?.listed ?? 0);
  const missingPhoto = Number(row?.missing_photo ?? 0);
  const missingPrice = Number(row?.missing_price ?? 0);

  const reasons: string[] = [];
  if (missingPhoto > 0) {
    reasons.push(
      `${missingPhoto} ${missingPhoto === 1 ? "item has" : "items have"} no photograph — shopping channels reject a listing without one`
    );
  }
  if (missingPrice > 0) {
    reasons.push(`${missingPrice} ${missingPrice === 1 ? "isn't" : "aren't"} priced`);
  }

  return {
    listed,
    missingPhoto,
    missingPrice,
    note: reasons.length > 0 ? `Not included: ${reasons.join(", ")}.` : null,
  };
}
