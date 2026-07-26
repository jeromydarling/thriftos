/**
 * Refunds and disputes.
 *
 * Two convictions shape this file.
 *
 * First: when money goes back to a customer, our fee goes back with it,
 * proportionally. Stripe does not do this automatically — an application fee
 * survives a refund unless the platform explicitly reverses it. Keeping a fee
 * on money a shop no longer has would be indefensible, so `refund_application_
 * fee` is set on every card refund and the reversal is written to the ledger.
 *
 * Second: a refund is not one action but three that must agree — money back to
 * the customer, goods back on the shelf, and the books updated. Doing those in
 * the wrong order is how a shop ends up having refunded a customer and also
 * still holding the item as sold. The order here is: record intent, ask Stripe,
 * then act on what Stripe says. Nothing is restocked on optimism.
 */
import { all, first, run } from "./db";
import { newId } from "./ids";
import { proportionalFeeRefundCents } from "./pricing";
import { record } from "./ledger";
import { recordFeeRefund } from "./fees";
import { stripeRequest, type StripeConfig } from "./stripe/client";

export interface StripeRefund {
  id: string;
  amount: number;
  currency: string;
  status: "pending" | "succeeded" | "failed" | "canceled" | "requires_action";
  charge?: string;
  payment_intent?: string;
  failure_reason?: string;
}

export type RefundReason = "requested_by_customer" | "duplicate" | "fraudulent";

export interface RefundRequest {
  orgId: string;
  transactionId: string;
  /** Merchandise being returned, in cents. Tax and round-up handled separately. */
  amountCents: number;
  /** Tax refunded alongside it, if the sale carried tax. */
  taxCents?: number;
  reason?: string;
  stripeReason?: RefundReason;
  /** Whether the goods came back and should return to the floor. */
  restock?: boolean;
  itemIds?: string[];
  userId?: string | null;
}

export class RefundError extends Error {}

export interface RefundPlan {
  refundableCents: number;
  amountCents: number;
  feeRefundCents: number;
  tender: string;
  alreadyRefundedCents: number;
  originalFeeCents: number;
  feeBaseCents: number;
}

/**
 * Work out what a refund would do, without doing it.
 *
 * Split out so the register can show a cashier the fee reversal and the
 * remaining refundable balance before they commit — and so the same arithmetic
 * is tested directly rather than only through a Stripe call.
 */
export async function planRefund(
  db: D1Database,
  req: RefundRequest
): Promise<RefundPlan> {
  const tx = await first<{
    total_cents: number;
    subtotal_cents: number;
    tax_cents: number;
    roundup_cents: number;
    refunded_cents: number;
    fee_refunded_cents: number;
    platform_fee_cents: number;
    fee_base_cents: number;
    tender: string;
    payment_state: string;
    voided_at: string | null;
  }>(
    db,
    `SELECT total_cents, subtotal_cents, tax_cents, roundup_cents, refunded_cents,
            fee_refunded_cents, platform_fee_cents, fee_base_cents, tender,
            payment_state, voided_at
       FROM transactions WHERE id = ? AND org_id = ?`,
    req.transactionId,
    req.orgId
  );

  if (!tx) throw new RefundError("That sale doesn't exist.");
  if (tx.voided_at) throw new RefundError("That sale was voided — there's nothing to refund.");

  const approved = ["succeeded", "partially_refunded", "disputed"].includes(tx.payment_state);
  if (!approved) {
    throw new RefundError(
      `That payment never completed (it's ${tx.payment_state}), so there's no money to send back. Cancel it instead.`
    );
  }

  // Round-up is a donation the customer chose to make. It isn't refunded by
  // default, because handing it back silently would misstate what the shop
  // received — if a customer wants it back, that's a separate deliberate act.
  const refundable = tx.subtotal_cents + tx.tax_cents - tx.refunded_cents;
  const requested = Math.round(req.amountCents + (req.taxCents ?? 0));

  if (requested <= 0) throw new RefundError("A refund has to be for a positive amount.");
  if (requested > refundable) {
    throw new RefundError(
      `That's more than remains on this sale. At most ${(refundable / 100).toFixed(2)} can still be refunded.`
    );
  }

  // The fee is charged on merchandise, so it reverses on merchandise. Refunding
  // tax alone gives nothing back, which is right — we never charged a fee on it.
  const merchandiseRefunded = Math.round(req.amountCents);
  const feeRefund = Math.min(
    tx.platform_fee_cents - tx.fee_refunded_cents,
    proportionalFeeRefundCents(tx.platform_fee_cents, tx.fee_base_cents, merchandiseRefunded)
  );

  return {
    refundableCents: refundable,
    amountCents: requested,
    feeRefundCents: Math.max(0, feeRefund),
    tender: tx.tender,
    alreadyRefundedCents: tx.refunded_cents,
    originalFeeCents: tx.platform_fee_cents,
    feeBaseCents: tx.fee_base_cents,
  };
}

export interface RefundResult {
  refundId: string;
  stripeRefundId: string | null;
  amountCents: number;
  feeRefundCents: number;
  restocked: string[];
  status: "succeeded" | "pending" | "failed";
}

/**
 * Refund a sale.
 *
 * `config` is null for a cash refund, which never touches Stripe — the money
 * comes out of the drawer, so the only work is the books and the shelf.
 */
export async function refundSale(
  db: D1Database,
  req: RefundRequest,
  config: StripeConfig | null
): Promise<RefundResult> {
  const plan = await planRefund(db, req);
  const isCash = plan.tender === "cash" || plan.tender === "other";

  const tx = await first<{ stripe_charge_id: string | null; shift_id: string | null }>(
    db,
    `SELECT stripe_charge_id, shift_id FROM transactions WHERE id = ? AND org_id = ?`,
    req.transactionId,
    req.orgId
  );

  const refundId = newId("refund");
  // Derived, not random: a retried refund request re-derives the same key and
  // Stripe returns the original rather than sending the money twice.
  const priorCount = await first<{ n: number }>(
    db,
    `SELECT COUNT(*) AS n FROM refunds WHERE org_id = ? AND transaction_id = ?`,
    req.orgId,
    req.transactionId
  );
  const idempotencyKey = `refund:${req.transactionId}:${Number(priorCount?.n ?? 0) + 1}`;

  // Recorded before we ask Stripe for anything. If the request dies halfway,
  // the intent is on disk and can be reconciled; the reverse order leaves money
  // sent with nothing to show it.
  await run(
    db,
    `INSERT INTO refunds
       (id, org_id, transaction_id, amount_cents, fee_refund_cents, reason, stripe_reason,
        restock, tender, status, idempotency_key, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    refundId,
    req.orgId,
    req.transactionId,
    plan.amountCents,
    plan.feeRefundCents,
    req.reason ?? null,
    req.stripeReason ?? "requested_by_customer",
    req.restock === false ? 0 : 1,
    isCash ? "cash" : "card",
    idempotencyKey,
    req.userId ?? null
  );

  let stripeRefundId: string | null = null;
  let status: RefundResult["status"] = "succeeded";

  if (!isCash) {
    if (!config) {
      await failRefund(db, req.orgId, refundId, "Card payments aren't switched on.");
      throw new RefundError(
        "This was a card sale, but card payments aren't switched on — so there's nothing to send the money back through."
      );
    }
    if (!tx?.stripe_charge_id) {
      await failRefund(db, req.orgId, refundId, "No Stripe charge recorded for this sale.");
      throw new RefundError(
        "We have no Stripe charge for this sale, so it can't be refunded through the card network. If the customer needs the money today, refund it as cash and note why."
      );
    }

    try {
      const refund = await stripeRequest<StripeRefund>(
        config,
        "POST",
        "/refunds",
        {
          charge: tx.stripe_charge_id,
          amount: plan.amountCents,
          reason: req.stripeReason ?? "requested_by_customer",
          // The whole point. Without this the platform keeps its fee on money
          // the shop has handed back.
          refund_application_fee: plan.feeRefundCents > 0,
          // Pull the refunded amount back from the connected account rather
          // than the platform eating it — the shop received the money.
          reverse_transfer: true,
          metadata: {
            thriftos_refund_id: refundId,
            thriftos_transaction_id: req.transactionId,
          },
        },
        idempotencyKey
      );

      stripeRefundId = refund.id;
      status = refund.status === "succeeded" ? "succeeded" : "pending";
    } catch (err) {
      const message = err instanceof Error ? err.message : "Stripe refused the refund.";
      await failRefund(db, req.orgId, refundId, message);
      throw new RefundError(message);
    }
  }

  await run(
    db,
    `UPDATE refunds SET stripe_refund_id = ?, status = ?,
            resolved_at = CASE WHEN ? = 'succeeded' THEN datetime('now') ELSE NULL END
      WHERE id = ? AND org_id = ?`,
    stripeRefundId,
    status,
    status,
    refundId,
    req.orgId
  );

  // Only settle the books once the money is genuinely on its way back.
  const restocked =
    status === "succeeded"
      ? await settleRefund(db, {
          orgId: req.orgId,
          refundId,
          transactionId: req.transactionId,
          amountCents: plan.amountCents,
          feeRefundCents: plan.feeRefundCents,
          shiftId: tx?.shift_id ?? null,
          stripeRefundId,
          tender: isCash ? "cash" : "card",
          restock: req.restock !== false,
          itemIds: req.itemIds ?? [],
        })
      : [];

  return {
    refundId,
    stripeRefundId,
    amountCents: plan.amountCents,
    feeRefundCents: plan.feeRefundCents,
    restocked,
    status,
  };
}

async function failRefund(
  db: D1Database,
  orgId: string,
  refundId: string,
  message: string
): Promise<void> {
  await run(
    db,
    `UPDATE refunds SET status = 'failed', failure_message = ?, resolved_at = datetime('now')
      WHERE id = ? AND org_id = ?`,
    message,
    refundId,
    orgId
  );
}

/**
 * Apply a completed refund to the books and the shelf.
 *
 * Exported because a refund can also complete asynchronously — a pending
 * refund that Stripe confirms by webhook lands here too, and both paths must
 * do exactly the same thing. Every write is idempotent, so a webhook arriving
 * after the synchronous path already ran changes nothing.
 */
export async function settleRefund(
  db: D1Database,
  opts: {
    orgId: string;
    refundId: string;
    transactionId: string;
    amountCents: number;
    feeRefundCents: number;
    shiftId?: string | null;
    stripeRefundId?: string | null;
    /** Cash refunds come out of the drawer, not out of a Stripe payout. */
    tender?: string;
    restock: boolean;
    itemIds: string[];
  }
): Promise<string[]> {
  await run(
    db,
    `UPDATE transactions
        SET refunded_cents = refunded_cents + ?,
            fee_refunded_cents = fee_refunded_cents + ?,
            payment_state = CASE
              WHEN refunded_cents + ? >= subtotal_cents + tax_cents THEN 'refunded'
              ELSE 'partially_refunded'
            END
      WHERE id = ? AND org_id = ?`,
    opts.amountCents,
    opts.feeRefundCents,
    opts.amountCents,
    opts.transactionId,
    opts.orgId
  );

  await record(db, {
    orgId: opts.orgId,
    entryType: "refund",
    amountCents: -opts.amountCents,
    dedupeKey: `refund:${opts.refundId}`,
    transactionId: opts.transactionId,
    shiftId: opts.shiftId ?? null,
    stripeObjectId: opts.stripeRefundId ?? null,
    source: opts.stripeRefundId ? "stripe_webhook" : "pos",
    metadata: { tender: opts.tender ?? "card" },
  });

  if (opts.feeRefundCents > 0) {
    await record(db, {
      orgId: opts.orgId,
      entryType: "application_fee_refund",
      amountCents: opts.feeRefundCents,
      dedupeKey: `feerefund:${opts.refundId}`,
      transactionId: opts.transactionId,
      source: "pos",
    });
    // Keep the monthly fee cap honest: a fee that came back shouldn't count
    // toward the cap a shop is being measured against.
    await recordFeeRefund(db, opts.orgId, opts.feeRefundCents);
  }

  const restocked: string[] = [];
  if (opts.restock && opts.itemIds.length > 0) {
    for (const itemId of opts.itemIds) {
      // Guarded on `sold` so a refund can't resurrect an item that has since
      // been recycled, transferred, or sold again on a different sale.
      const res = await run(
        db,
        `UPDATE items
            SET status = 'available', sold_at = NULL, sold_price_cents = NULL,
                held_by_transaction_id = NULL, updated_at = datetime('now')
          WHERE id = ? AND org_id = ? AND status = 'sold'`,
        itemId,
        opts.orgId
      );
      if ((res.meta?.changes ?? 0) > 0) restocked.push(itemId);

      await run(
        db,
        `UPDATE transaction_items SET refunded_cents = price_cents
          WHERE transaction_id = ? AND org_id = ? AND item_id = ?`,
        opts.transactionId,
        opts.orgId,
        itemId
      );
    }
  }

  return restocked;
}

/* ─── Disputes ──────────────────────────────────────────────────────────── */

export interface DisputePayload {
  id: string;
  amount: number;
  charge?: string;
  reason?: string;
  status: string;
  evidence_details?: { due_by?: number };
  balance_transactions?: { fee?: number; amount?: number }[];
}

/**
 * Record or update a dispute from a Stripe event.
 *
 * The shop is told, and the sale is marked disputed — but the goods are *not*
 * restocked. The customer has the coat; a dispute is an argument about payment,
 * not a return. Putting it back on the shelf would let the shop sell an item it
 * doesn't have.
 */
export async function upsertDispute(
  db: D1Database,
  orgId: string,
  payload: DisputePayload
): Promise<{ id: string; created: boolean }> {
  const existing = await first<{ id: string }>(
    db,
    `SELECT id FROM disputes WHERE stripe_dispute_id = ?`,
    payload.id
  );

  const feeCents = Math.abs(
    payload.balance_transactions?.reduce((sum, bt) => sum + (bt.fee ?? 0), 0) ?? 0
  );
  const dueAt = payload.evidence_details?.due_by
    ? new Date(payload.evidence_details.due_by * 1000).toISOString()
    : null;

  if (existing) {
    await run(
      db,
      `UPDATE disputes SET status = ?, fee_cents = ?, evidence_due_at = COALESCE(?, evidence_due_at),
              updated_at = datetime('now')
        WHERE id = ?`,
      payload.status,
      feeCents,
      dueAt,
      existing.id
    );
    return { id: existing.id, created: false };
  }

  const tx = payload.charge
    ? await first<{ id: string }>(
        db,
        `SELECT id FROM transactions WHERE org_id = ? AND stripe_charge_id = ?`,
        orgId,
        payload.charge
      )
    : null;

  const id = newId("dispute");
  await run(
    db,
    `INSERT INTO disputes
       (id, org_id, transaction_id, stripe_dispute_id, stripe_charge_id, amount_cents,
        fee_cents, reason, status, evidence_due_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    orgId,
    tx?.id ?? null,
    payload.id,
    payload.charge ?? null,
    payload.amount,
    feeCents,
    payload.reason ?? null,
    payload.status,
    dueAt
  );

  if (tx) {
    await run(
      db,
      `UPDATE transactions SET payment_state = 'disputed'
        WHERE id = ? AND org_id = ? AND payment_state IN ('succeeded','partially_refunded')`,
      tx.id,
      orgId
    );
  }

  await record(db, {
    orgId,
    entryType: "dispute",
    amountCents: -payload.amount,
    dedupeKey: `dispute:${payload.id}`,
    transactionId: tx?.id ?? null,
    stripeObjectId: payload.id,
    source: "stripe_webhook",
    metadata: { reason: payload.reason ?? null },
  });

  if (feeCents > 0) {
    await record(db, {
      orgId,
      entryType: "dispute_fee",
      amountCents: -feeCents,
      dedupeKey: `disputefee:${payload.id}`,
      transactionId: tx?.id ?? null,
      stripeObjectId: payload.id,
      source: "stripe_webhook",
    });
  }

  return { id, created: true };
}

/** Disputes needing a human, soonest deadline first. */
export async function openDisputes(db: D1Database, orgId: string) {
  return all<{
    id: string;
    stripe_dispute_id: string;
    amount_cents: number;
    reason: string | null;
    status: string;
    evidence_due_at: string | null;
    acknowledged_at: string | null;
    transaction_id: string | null;
  }>(
    db,
    `SELECT id, stripe_dispute_id, amount_cents, reason, status, evidence_due_at,
            acknowledged_at, transaction_id
       FROM disputes
      WHERE org_id = ? AND status NOT IN ('won','lost')
      ORDER BY evidence_due_at IS NULL, evidence_due_at`,
    orgId
  );
}
