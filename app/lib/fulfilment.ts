/**
 * The shop side of an online order: finding the thing and getting it out.
 *
 * This is a physical problem wearing software. The item is on a rail in a room,
 * and sometimes it is not there — it sold at the till twenty minutes ago, or
 * it's damaged, or it walked. No amount of state machine fixes that, so the
 * job here is to make the honest outcome cheap: one button that refunds the
 * customer, tells them which item, and puts the transaction straight.
 *
 * Fulfilment state is deliberately separate from payment state. The money and
 * the parcel are different journeys, and a paid order that can't be fulfilled
 * is an ordinary Tuesday rather than a payment problem.
 */
import { all, first, run } from "./db";
import { canAdvance, type FulfilmentStatus } from "./orders";
import { refundSale } from "./refunds";
import type { StripeConfig } from "./stripe/client";

export interface OrderSummary {
  id: string;
  buyer_name: string | null;
  buyer_email: string | null;
  fulfilment_method: "ship" | "pickup" | null;
  fulfilment_status: FulfilmentStatus | null;
  pickup_code: string | null;
  payment_state: string;
  total_cents: number;
  shipping_cents: number;
  created_at: string;
  dispatched_at: string | null;
  collected_at: string | null;
  ship_line1: string | null;
  ship_line2: string | null;
  ship_city: string | null;
  ship_state: string | null;
  ship_postal_code: string | null;
  ship_country: string | null;
  item_count: number;
}

export interface PickLine {
  id: string;
  item_id: string | null;
  title: string;
  category: string | null;
  price_cents: number;
  fulfillment_state: string;
  fulfillment_note: string | null;
  /** Where the volunteer should look. Null for an item with no location. */
  location_name: string | null;
  tag_color: string | null;
}

/**
 * Orders needing a person, oldest first.
 *
 * Oldest first rather than newest: somebody who ordered on Monday has waited
 * longer than somebody who ordered an hour ago, and a queue that shows the
 * newest at the top quietly starves the person who has been waiting.
 *
 * Only paid orders. An order still mid-payment isn't work — it's a shopper on
 * Stripe's page — and putting it in front of a volunteer invites them to go and
 * fetch something nobody has bought.
 */
export async function ordersNeedingWork(
  db: D1Database,
  orgId: string
): Promise<OrderSummary[]> {
  return all<OrderSummary>(
    db,
    `SELECT t.id, t.buyer_name, t.buyer_email, t.fulfilment_method, t.fulfilment_status,
            t.pickup_code, t.payment_state, t.total_cents, t.shipping_cents, t.created_at,
            t.dispatched_at, t.collected_at,
            t.ship_line1, t.ship_line2, t.ship_city, t.ship_state, t.ship_postal_code,
            t.ship_country,
            (SELECT COUNT(*) FROM transaction_items ti WHERE ti.transaction_id = t.id) AS item_count
       FROM transactions t
      WHERE t.org_id = ? AND t.channel = 'online'
        AND t.payment_state = 'succeeded'
        AND t.fulfilment_status IN ('awaiting','picking','ready','unfindable')
      ORDER BY t.created_at`,
    orgId
  );
}

/** Everything else, newest first — the record rather than the queue. */
export async function ordersSettled(
  db: D1Database,
  orgId: string,
  limit = 50
): Promise<OrderSummary[]> {
  return all<OrderSummary>(
    db,
    `SELECT t.id, t.buyer_name, t.buyer_email, t.fulfilment_method, t.fulfilment_status,
            t.pickup_code, t.payment_state, t.total_cents, t.shipping_cents, t.created_at,
            t.dispatched_at, t.collected_at,
            t.ship_line1, t.ship_line2, t.ship_city, t.ship_state, t.ship_postal_code,
            t.ship_country,
            (SELECT COUNT(*) FROM transaction_items ti WHERE ti.transaction_id = t.id) AS item_count
       FROM transactions t
      WHERE t.org_id = ? AND t.channel = 'online'
        AND (t.payment_state <> 'succeeded'
             OR t.fulfilment_status IN ('dispatched','collected','refunded'))
      ORDER BY t.created_at DESC
      LIMIT ?`,
    orgId,
    limit
  );
}

export async function orderById(
  db: D1Database,
  orgId: string,
  id: string
): Promise<OrderSummary | null> {
  return first<OrderSummary>(
    db,
    `SELECT t.id, t.buyer_name, t.buyer_email, t.fulfilment_method, t.fulfilment_status,
            t.pickup_code, t.payment_state, t.total_cents, t.shipping_cents, t.created_at,
            t.dispatched_at, t.collected_at,
            t.ship_line1, t.ship_line2, t.ship_city, t.ship_state, t.ship_postal_code,
            t.ship_country,
            (SELECT COUNT(*) FROM transaction_items ti WHERE ti.transaction_id = t.id) AS item_count
       FROM transactions t
      WHERE t.id = ? AND t.org_id = ? AND t.channel = 'online'`,
    id,
    orgId
  );
}

/**
 * The pick list.
 *
 * Includes where each item lives, because "Navy wool coat" is not findable in a
 * shop with four rails and a stockroom, and a volunteer who has to ask somebody
 * is a volunteer who stops picking.
 */
export async function pickList(
  db: D1Database,
  orgId: string,
  transactionId: string
): Promise<PickLine[]> {
  return all<PickLine>(
    db,
    `SELECT ti.id, ti.item_id, ti.title, ti.category, ti.price_cents,
            ti.fulfillment_state, ti.fulfillment_note,
            l.name AS location_name, i.tag_color
       FROM transaction_items ti
       LEFT JOIN items i ON i.id = ti.item_id
       LEFT JOIN locations l ON l.id = i.location_id
      WHERE ti.transaction_id = ? AND ti.org_id = ?
      ORDER BY l.name, ti.title`,
    transactionId,
    orgId
  );
}

export class FulfilmentError extends Error {}

/**
 * Move an order along.
 *
 * Refuses a transition the state machine doesn't allow rather than applying it,
 * for the same reason the payment machine does: telling a customer their order
 * is on its way when nobody has picked it is worse than an error on a screen.
 */
export async function advance(
  db: D1Database,
  orgId: string,
  transactionId: string,
  to: FulfilmentStatus,
  opts: { trackingReference?: string | null } = {}
): Promise<void> {
  const order = await orderById(db, orgId, transactionId);
  if (!order) throw new FulfilmentError("That order isn't one of yours.");

  const from = (order.fulfilment_status ?? "awaiting") as FulfilmentStatus;
  if (from === to) return;

  if (!canAdvance(from, to)) {
    throw new FulfilmentError(
      `An order can't go from "${from}" to "${to}". Refresh — somebody may have moved it already.`
    );
  }

  await run(
    db,
    `UPDATE transactions
        SET fulfilment_status = ?,
            tracking_reference = COALESCE(?, tracking_reference),
            dispatched_at = CASE WHEN ? = 'dispatched' THEN datetime('now') ELSE dispatched_at END,
            collected_at = CASE WHEN ? = 'collected' THEN datetime('now') ELSE collected_at END
      WHERE id = ? AND org_id = ?`,
    to,
    opts.trackingReference?.trim() || null,
    to,
    to,
    transactionId,
    orgId
  );
}

export interface CannotFindResult {
  refundedCents: number;
  /** Titles the customer is being refunded for. */
  titles: string[];
  /** True when nothing in the order could be found and the whole thing goes back. */
  wholeOrder: boolean;
}

/**
 * "We couldn't find it."
 *
 * The button that matters. One-of-a-kind stock goes missing, and the difference
 * between a shop people trust and one they don't is whether saying so is easy.
 *
 * Refunds the named lines, marks them unfulfilled with a reason, and moves the
 * order on. Postage comes back too when nothing at all could be found — charging
 * somebody to post an empty parcel would be indefensible; when part of the order
 * still ships, the postage stands because the shop is still posting something.
 */
export async function cannotFind(
  db: D1Database,
  config: StripeConfig | null,
  opts: {
    orgId: string;
    transactionId: string;
    lineIds: readonly string[];
    note?: string;
    userId?: string | null;
  }
): Promise<CannotFindResult> {
  const lines = await pickList(db, opts.orgId, opts.transactionId);
  const missing = lines.filter((l) => opts.lineIds.includes(l.id));
  if (missing.length === 0) throw new FulfilmentError("Pick which ones you couldn't find.");

  const order = await orderById(db, opts.orgId, opts.transactionId);
  if (!order) throw new FulfilmentError("That order isn't one of yours.");

  const stillFulfillable = lines.filter(
    (l) => !opts.lineIds.includes(l.id) && l.fulfillment_state !== "unfulfilled"
  );
  const wholeOrder = stillFulfillable.length === 0;

  for (const line of missing) {
    await run(
      db,
      `UPDATE transaction_items
          SET fulfillment_state = 'unfulfilled',
              fulfillment_note = ?
        WHERE id = ? AND org_id = ?`,
      opts.note?.trim() || "Couldn't be found in the shop",
      line.id,
      opts.orgId
    );
  }

  const merchandiseCents = missing.reduce((n, l) => n + l.price_cents, 0);

  // Tax comes back in proportion to the goods being refunded. Refunding goods
  // and keeping their tax would be keeping money that was never the shop's.
  const allMerchandise = lines.reduce((n, l) => n + l.price_cents, 0);
  const taxCents =
    allMerchandise > 0
      ? Math.round(((order.total_cents - order.shipping_cents - allMerchandise) * merchandiseCents) /
          allMerchandise)
      : 0;

  const refund = await refundSale(db, {
    orgId: opts.orgId,
    transactionId: opts.transactionId,
    amountCents: merchandiseCents + (wholeOrder ? order.shipping_cents : 0),
    taxCents: Math.max(0, taxCents),
    reason: opts.note?.trim() || "Item could not be found in the shop",
    // Nothing goes back on the floor. The whole point is that it isn't there.
    restock: false,
    userId: opts.userId ?? null,
  }, config);

  await run(
    db,
    // No updated_at here: `transactions` has never had one. The timeline of a
    // sale is its dispatched_at, collected_at, voided_at and the ledger — a
    // single mutable timestamp would say less and be wrong more often.
    `UPDATE transactions SET fulfilment_status = ? WHERE id = ? AND org_id = ?`,
    wholeOrder ? "refunded" : "picking",
    opts.transactionId,
    opts.orgId
  );

  return {
    refundedCents: refund.amountCents,
    titles: missing.map((l) => l.title),
    wholeOrder,
  };
}

/** A one-line address for a packing slip. */
export function addressLines(order: OrderSummary): string[] {
  return [
    order.ship_line1,
    order.ship_line2,
    [order.ship_city, order.ship_state].filter(Boolean).join(", "),
    order.ship_postal_code,
    order.ship_country,
  ]
    .map((l) => (l ?? "").trim())
    .filter(Boolean);
}
