/**
 * The payment state machine, and the inventory effects that follow from it.
 *
 * The bug this file exists to fix: inventory used to be marked sold the moment
 * a sale reached the sync endpoint. That is wrong the instant a card is
 * involved — an HTTP 200 from our own API says nothing about whether Stripe
 * approved anything. An item must not leave the floor until the payment behind
 * it reaches an approved terminal state.
 *
 * So state drives inventory, never the other way round:
 *
 *   pending-ish states  → items are RESERVED (held), not sold
 *   succeeded           → items are SOLD
 *   failed / canceled   → reservation RELEASED, item back on the floor
 *
 * Everything here is pure except the three DB helpers at the bottom, and those
 * are written to be idempotent because webhooks arrive twice and offline queues
 * replay.
 */
import { all, run } from "./db";

export type PaymentState =
  | "draft"
  | "awaiting_reader"
  | "processing"
  | "requires_action"
  | "succeeded"
  | "failed"
  | "canceled"
  | "offline_pending"
  | "partially_refunded"
  | "refunded"
  | "disputed";

/**
 * Allowed transitions. Anything not listed is rejected rather than quietly
 * applied — a payment that jumps from `failed` to `succeeded` is a bug, and we
 * would rather see it than sell an item twice.
 */
const TRANSITIONS: Record<PaymentState, readonly PaymentState[]> = {
  draft: ["awaiting_reader", "processing", "offline_pending", "succeeded", "canceled", "failed"],
  awaiting_reader: ["processing", "requires_action", "canceled", "failed"],
  processing: ["succeeded", "requires_action", "failed", "canceled"],
  requires_action: ["processing", "succeeded", "failed", "canceled"],
  offline_pending: ["succeeded", "failed", "canceled"],
  // Terminal-ish states. A succeeded payment can still be refunded or disputed.
  succeeded: ["partially_refunded", "refunded", "disputed"],
  partially_refunded: ["partially_refunded", "refunded", "disputed"],
  refunded: ["disputed"],
  disputed: ["refunded", "partially_refunded"],
  failed: [],
  canceled: [],
};

export function canTransition(from: PaymentState, to: PaymentState): boolean {
  if (from === to) return true; // idempotent replay is always fine
  return (TRANSITIONS[from] ?? []).includes(to);
}

export function assertTransition(from: PaymentState, to: PaymentState): void {
  if (!canTransition(from, to)) {
    throw new Error(`Illegal payment transition: ${from} → ${to}`);
  }
}

/** Money has actually been captured. Only these may mark inventory sold. */
export const APPROVED_STATES: readonly PaymentState[] = [
  "succeeded",
  "partially_refunded",
  // A dispute doesn't put the goods back on the shelf — the customer has them.
  "disputed",
];

/** Still in flight. Inventory is reserved, not sold, and not available. */
export const PENDING_STATES: readonly PaymentState[] = [
  "draft",
  "awaiting_reader",
  "processing",
  "requires_action",
  "offline_pending",
];

/** Over, unsuccessfully. Reservations are released. */
export const RELEASED_STATES: readonly PaymentState[] = ["failed", "canceled"];

export function isApproved(state: PaymentState): boolean {
  return APPROVED_STATES.includes(state);
}

export function isPending(state: PaymentState): boolean {
  return PENDING_STATES.includes(state);
}

export type InventoryEffect = "reserve" | "sell" | "release" | "none";

/** What should happen to the items on a sale entering this state. */
export function inventoryEffectFor(state: PaymentState): InventoryEffect {
  if (isApproved(state)) return "sell";
  if (isPending(state)) return "reserve";
  if (RELEASED_STATES.includes(state)) return "release";
  // A full refund is handled by the returns flow, which decides whether the
  // goods came back and in what condition. It is never automatic.
  return "none";
}

/* ─── Tender ────────────────────────────────────────────────────────────── */

export type Tender = "cash" | "card" | "terminal" | "other";

/**
 * The state a sale starts in, given how it is being paid for.
 *
 * Cash is confirmed by the person at the counter, so it is approved on arrival.
 * A Stripe Terminal payment is not approved until Stripe says so, whatever the
 * reader appeared to do — that is the whole point of this module.
 */
export function initialStateForTender(
  tender: Tender,
  opts: { stripeConfigured: boolean } = { stripeConfigured: false }
): PaymentState {
  switch (tender) {
    case "cash":
    case "other":
      return "succeeded";
    case "terminal":
      return "awaiting_reader";
    case "card":
      // With Stripe live, a card sale must go through the reader flow. While
      // Stripe is dark the shop took the money on some other machine and is
      // recording it here, which the cashier has confirmed by pressing the key.
      return opts.stripeConfigured ? "awaiting_reader" : "succeeded";
    default:
      return "draft";
  }
}

/** Tenders that must never be accepted from the offline queue. */
export function isOfflineEligible(tender: Tender, stripeConfigured: boolean): boolean {
  // Offline *card collection* needs a native Terminal SDK and eligible hardware.
  // The web POS does not have it, so queuing a card-present payment offline
  // would be promising an authorisation we cannot obtain.
  if (tender === "terminal") return false;
  if (tender === "card" && stripeConfigured) return false;
  return true;
}

/* ─── Inventory transitions ─────────────────────────────────────────────── */

export interface ReservationResult {
  reserved: string[];
  /** Items someone else already sold or reserved. */
  unavailable: string[];
}

/**
 * Reserve items for a sale, atomically.
 *
 * The conditional UPDATE is the whole safety property: two registers scanning
 * the same one-of-a-kind item will both issue this, and exactly one will report
 * a changed row. The loser is told the item is gone rather than selling it.
 */
export async function reserveItems(
  db: D1Database,
  orgId: string,
  transactionId: string,
  itemIds: readonly string[]
): Promise<ReservationResult> {
  const reserved: string[] = [];
  const unavailable: string[] = [];

  for (const itemId of itemIds) {
    const res = await run(
      db,
      `UPDATE items
          SET status = 'held', held_by_transaction_id = ?, updated_at = datetime('now')
        WHERE id = ? AND org_id = ?
          AND (status = 'available' OR (status = 'held' AND held_by_transaction_id = ?))`,
      transactionId,
      itemId,
      orgId,
      transactionId
    );
    if ((res.meta?.changes ?? 0) > 0) reserved.push(itemId);
    else unavailable.push(itemId);
  }

  return { reserved, unavailable };
}

/**
 * Mark a sale's reserved items sold. Idempotent — a webhook that arrives twice
 * finalises once, because the second pass matches no rows.
 */
export async function sellReservedItems(
  db: D1Database,
  orgId: string,
  transactionId: string,
  soldAt: string
): Promise<number> {
  const lines = await all<{ item_id: string; price_cents: number }>(
    db,
    `SELECT item_id, price_cents FROM transaction_items
      WHERE transaction_id = ? AND org_id = ? AND item_id IS NOT NULL`,
    transactionId,
    orgId
  );

  let sold = 0;
  for (const line of lines) {
    const res = await run(
      db,
      `UPDATE items
          SET status = 'sold', sold_at = ?, sold_price_cents = ?,
              held_by_transaction_id = NULL, updated_at = datetime('now')
        WHERE id = ? AND org_id = ? AND status IN ('held', 'available')`,
      soldAt,
      line.price_cents,
      line.item_id,
      orgId
    );
    if ((res.meta?.changes ?? 0) > 0) sold++;
  }
  return sold;
}

/**
 * Put a failed sale's items back on the floor.
 *
 * Scoped to this transaction's own reservations, so a later sale that has
 * legitimately picked the item up is never disturbed.
 */
export async function releaseReservation(
  db: D1Database,
  orgId: string,
  transactionId: string
): Promise<number> {
  const res = await run(
    db,
    `UPDATE items
        SET status = 'available', held_by_transaction_id = NULL, updated_at = datetime('now')
      WHERE org_id = ? AND held_by_transaction_id = ? AND status = 'held'`,
    orgId,
    transactionId
  );
  return res.meta?.changes ?? 0;
}

/** Apply whatever this state implies for inventory. Safe to call repeatedly. */
export async function applyInventoryEffect(
  db: D1Database,
  orgId: string,
  transactionId: string,
  state: PaymentState,
  soldAt = new Date().toISOString()
): Promise<{ effect: InventoryEffect; affected: number }> {
  const effect = inventoryEffectFor(state);

  switch (effect) {
    case "sell":
      return { effect, affected: await sellReservedItems(db, orgId, transactionId, soldAt) };
    case "release":
      return { effect, affected: await releaseReservation(db, orgId, transactionId) };
    default:
      return { effect, affected: 0 };
  }
}
