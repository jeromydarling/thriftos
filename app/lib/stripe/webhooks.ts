/**
 * Stripe webhook processing.
 *
 * This is where a payment actually becomes real. Everywhere else in the app, a
 * successful HTTP response means "Stripe accepted our request"; only here does
 * a verified event mean "the money moved". Inventory is marked sold from this
 * file and nowhere else on the card path.
 *
 * The order of operations is fixed and matters:
 *
 *   1. Verify the signature against the **raw** body. Parse nothing first —
 *      re-serialising JSON changes the bytes and the signature will not match.
 *   2. Store the event id before running any side effect. If we crash midway,
 *      the retry finds the row and knows where it got to.
 *   3. Refuse duplicates by primary key, not by checking first. Two concurrent
 *      deliveries of the same event both pass a check-then-act test.
 *   4. Never assume ordering. Stripe makes no promise, so a handler that needs
 *      current truth re-fetches the object rather than trusting the payload.
 *   5. Return 200 for anything we've stored, even if processing failed —
 *      otherwise Stripe retries forever on a bug we can replay ourselves.
 */
import { first, run } from "../db";
import { verifyWebhookSignature, type StripeConfig } from "./client";
import {
  advanceAttempt,
  attemptForPaymentIntent,
  type PaymentAttempt,
} from "../attempts";
import { applyInventoryEffect } from "../payments";
import { record, saleEntries } from "../ledger";
import { recordFeeAccrual, resolveFeePolicy } from "../fees";
import { settleRefund, upsertDispute } from "../refunds";
import { stateForIntent, type StripePaymentIntent } from "./terminal";
import {
  deriveStatus,
  getAccountByStripeId,
  markDeauthorized,
  retrieveAccount,
  syncAccount,
  type StripeAccountObject,
} from "./connect";

export interface StripeEvent {
  id: string;
  type: string;
  account?: string;
  created: number;
  data: { object: Record<string, unknown> };
}

export type EventOutcome = "processed" | "duplicate" | "ignored" | "failed";

export interface WebhookResult {
  outcome: EventOutcome;
  eventId?: string;
  eventType?: string;
  detail?: string;
}

/** Events we act on. Anything else is stored and ignored, not an error. */
const HANDLED = new Set([
  "payment_intent.succeeded",
  "payment_intent.payment_failed",
  "payment_intent.canceled",
  "payment_intent.requires_action",
  "payment_intent.processing",
  "charge.succeeded",
  "charge.refunded",
  "charge.dispute.created",
  "charge.dispute.updated",
  "charge.dispute.closed",
  "refund.updated",
  "terminal.reader.action_succeeded",
  "terminal.reader.action_failed",
  "account.updated",
  "payout.failed",
]);

/**
 * Verify, store, and process one webhook delivery.
 *
 * `rawBody` must be exactly the bytes that arrived.
 */
export async function handleWebhook(
  db: D1Database,
  opts: {
    rawBody: string;
    signature: string | null;
    secret: string;
    config: StripeConfig | null;
  }
): Promise<{ status: number; result: WebhookResult }> {
  const verified = await verifyWebhookSignature(opts.rawBody, opts.signature, opts.secret);
  if (!verified.valid) {
    // 400, and nothing stored. An unverified body is not evidence of anything
    // and must never reach a handler.
    return {
      status: 400,
      result: { outcome: "failed", detail: verified.reason ?? "signature failed" },
    };
  }

  let event: StripeEvent;
  try {
    event = JSON.parse(opts.rawBody) as StripeEvent;
  } catch {
    return { status: 400, result: { outcome: "failed", detail: "body was not JSON" } };
  }
  if (!event?.id || !event?.type) {
    return { status: 400, result: { outcome: "failed", detail: "not a Stripe event" } };
  }

  // Claim the event by primary key. Two concurrent deliveries race here and
  // exactly one wins — which is the property a SELECT-then-INSERT can't give.
  const claim = await run(
    db,
    `INSERT OR IGNORE INTO stripe_events
       (stripe_event_id, account_context, event_type, object_id, status, attempts)
     VALUES (?, ?, ?, ?, 'received', 0)`,
    event.id,
    event.account ?? null,
    event.type,
    (event.data?.object?.id as string) ?? null
  );

  if ((claim.meta?.changes ?? 0) === 0) {
    const prior = await first<{ status: string }>(
      db,
      `SELECT status FROM stripe_events WHERE stripe_event_id = ?`,
      event.id
    );
    // A previous attempt failed, so this delivery is a retry we should honour.
    if (prior?.status !== "failed") {
      return {
        status: 200,
        result: { outcome: "duplicate", eventId: event.id, eventType: event.type },
      };
    }
  }

  if (!HANDLED.has(event.type)) {
    await markEvent(db, event.id, "ignored");
    return {
      status: 200,
      result: { outcome: "ignored", eventId: event.id, eventType: event.type },
    };
  }

  try {
    const detail = await dispatch(db, event, opts.config);
    await markEvent(db, event.id, "processed");
    return {
      status: 200,
      result: { outcome: "processed", eventId: event.id, eventType: event.type, detail },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await markEvent(db, event.id, "failed", message);
    // Still 200. The event is on disk and replayable; letting Stripe retry a
    // deterministic bug forever just buries the real failure in noise.
    return {
      status: 200,
      result: { outcome: "failed", eventId: event.id, eventType: event.type, detail: message },
    };
  }
}

async function markEvent(
  db: D1Database,
  eventId: string,
  status: "processed" | "failed" | "ignored",
  error?: string
): Promise<void> {
  await run(
    db,
    `UPDATE stripe_events
        SET status = ?, attempts = attempts + 1, last_error = ?,
            processed_at = CASE WHEN ? IN ('processed','ignored') THEN datetime('now') ELSE processed_at END
      WHERE stripe_event_id = ?`,
    status,
    error ?? null,
    status,
    eventId
  );
}

async function dispatch(
  db: D1Database,
  event: StripeEvent,
  config: StripeConfig | null
): Promise<string> {
  const object = event.data.object;

  switch (event.type) {
    case "payment_intent.succeeded":
    case "payment_intent.payment_failed":
    case "payment_intent.canceled":
    case "payment_intent.requires_action":
    case "payment_intent.processing":
      return handlePaymentIntent(db, object as unknown as StripePaymentIntent);

    case "charge.succeeded":
      return handleCharge(db, object as Record<string, unknown>);

    case "charge.refunded":
      return handleChargeRefunded(db, object as Record<string, unknown>);

    case "refund.updated":
      return handleRefundUpdated(db, object as Record<string, unknown>);

    case "charge.dispute.created":
    case "charge.dispute.updated":
    case "charge.dispute.closed":
      return handleDispute(db, object as Record<string, unknown>);

    case "terminal.reader.action_succeeded":
    case "terminal.reader.action_failed":
      return handleReaderAction(db, object as Record<string, unknown>);

    case "account.updated":
      return handleAccountUpdated(db, object as Record<string, unknown>, config);

    case "account.application.deauthorized":
      return handleDeauthorized(db, event, object as Record<string, unknown>);

    case "capability.updated":
      return handleCapabilityUpdated(db, object as Record<string, unknown>, config);

    case "payout.failed":
      return handlePayoutFailed(db, event, object as Record<string, unknown>);

    default:
      return "no handler";
  }
}

/**
 * The important one: a card payment reaching a terminal state.
 *
 * Inventory moves here and only here for card sales. The fee is accrued only
 * on success, because a fee on a declined card is money we never earned.
 */
async function handlePaymentIntent(
  db: D1Database,
  intent: StripePaymentIntent
): Promise<string> {
  const attempt = await attemptForPaymentIntent(db, intent.id);
  if (!attempt) {
    // A payment intent we don't recognise. Recorded as handled rather than
    // failed — retrying won't conjure a matching attempt, and the event store
    // preserves it for anyone investigating.
    return `no attempt for ${intent.id}`;
  }

  const state = stateForIntent(intent.status);
  const chargeId = (intent.latest_charge as string | null) ?? null;

  const { applied } = await advanceAttempt(db, attempt.org_id, attempt.id, {
    state,
    paymentIntentId: intent.id,
    chargeId,
    failureCode: intent.last_payment_error?.code ?? null,
    failureMessage: intent.last_payment_error?.message ?? null,
  });

  if (!applied) return `attempt already ${state}`;

  await run(
    db,
    `UPDATE transactions SET payment_state = ?, stripe_payment_intent_id = ?,
            stripe_charge_id = COALESCE(?, stripe_charge_id)
      WHERE id = ? AND org_id = ?`,
    state,
    intent.id,
    chargeId,
    attempt.transaction_id,
    attempt.org_id
  );

  // Sold on success, released on failure or cancellation. This is rule 12 of
  // the build brief: inventory follows the payment, never the request.
  await applyInventoryEffect(db, attempt.org_id, attempt.transaction_id, state);

  if (state !== "succeeded") return `attempt ${state}`;

  await finaliseSale(db, attempt);
  return "sale finalised";
}

/**
 * Post a completed card sale to the ledger and accrue the fee.
 *
 * Every write is keyed, so a replayed event or a manual replay re-runs this
 * safely — which is what lets the webhook handler be retried without thought.
 */
async function finaliseSale(db: D1Database, attempt: PaymentAttempt): Promise<void> {
  const tx = await first<{
    subtotal_cents: number;
    tax_cents: number;
    roundup_cents: number;
    platform_fee_cents: number;
    tender: string;
    shift_id: string | null;
  }>(
    db,
    `SELECT subtotal_cents, tax_cents, roundup_cents, platform_fee_cents, tender, shift_id
       FROM transactions WHERE id = ? AND org_id = ?`,
    attempt.transaction_id,
    attempt.org_id
  );
  if (!tx) return;

  const entries = saleEntries({
    orgId: attempt.org_id,
    transactionId: attempt.transaction_id,
    attemptId: attempt.id,
    shiftId: tx.shift_id,
    subtotalCents: tx.subtotal_cents,
    taxCents: tx.tax_cents,
    roundUpCents: tx.roundup_cents,
    platformFeeCents: tx.platform_fee_cents,
    tender: tx.tender,
    source: "stripe_webhook",
  });

  for (const entry of entries) await record(db, entry);

  if (tx.platform_fee_cents > 0) {
    // The cap comes from the policy in force now, not from the transaction —
    // the accrual row tracks a running monthly total against a current ceiling,
    // whereas the fee itself was already frozen when the attempt was created.
    const policy = await resolveFeePolicy(db, attempt.org_id);
    await recordFeeAccrual(db, attempt.org_id, tx.platform_fee_cents, policy.maximumFeeCents);
  }
}

/**
 * A charge arriving tells us what Stripe actually kept.
 *
 * Until this lands, the shop's expected payout is an estimate. Posting the
 * real processing fee is what makes "why is my payout less than my sales?"
 * answerable to the cent.
 */
async function handleCharge(db: D1Database, charge: Record<string, unknown>): Promise<string> {
  const chargeId = charge.id as string;
  const tx = await first<{ id: string; org_id: string }>(
    db,
    `SELECT id, org_id FROM transactions WHERE stripe_charge_id = ?`,
    chargeId
  );
  if (!tx) return `no transaction for ${chargeId}`;

  // Present only when the balance transaction is expanded; when it isn't, the
  // figure stays null rather than being guessed at.
  const bt = charge.balance_transaction as { fee?: number } | string | null | undefined;
  const feeCents = typeof bt === "object" && bt?.fee ? Math.round(bt.fee) : null;

  if (feeCents === null || feeCents <= 0) return "no processing fee on this charge yet";

  await run(db, `UPDATE transactions SET stripe_fee_cents = ? WHERE id = ?`, feeCents, tx.id);

  await record(db, {
    orgId: tx.org_id,
    entryType: "stripe_processing_fee",
    amountCents: -feeCents,
    dedupeKey: `stripefee:${chargeId}`,
    transactionId: tx.id,
    stripeObjectId: chargeId,
    source: "stripe_webhook",
  });

  return "processing fee posted";
}

/** A refund initiated outside ThriftOS — from the Stripe dashboard, say. */
async function handleChargeRefunded(
  db: D1Database,
  charge: Record<string, unknown>
): Promise<string> {
  const chargeId = charge.id as string;
  const tx = await first<{ id: string; org_id: string; refunded_cents: number; shift_id: string | null }>(
    db,
    `SELECT id, org_id, refunded_cents, shift_id FROM transactions WHERE stripe_charge_id = ?`,
    chargeId
  );
  if (!tx) return `no transaction for ${chargeId}`;

  const refundedTotal = Math.round((charge.amount_refunded as number) ?? 0);
  const unaccounted = refundedTotal - tx.refunded_cents;

  // Already reconciled by our own refund path. Nothing to do.
  if (unaccounted <= 0) return "already accounted for";

  await settleRefund(db, {
    orgId: tx.org_id,
    refundId: `external:${chargeId}:${refundedTotal}`,
    transactionId: tx.id,
    amountCents: unaccounted,
    feeRefundCents: 0,
    shiftId: tx.shift_id,
    stripeRefundId: chargeId,
    // Goods aren't restocked for a refund we didn't process, because nobody
    // told us anything came back. A person has to decide that.
    restock: false,
    itemIds: [],
  });

  return `recorded ${unaccounted} refunded outside ThriftOS`;
}

/** A pending refund reaching its final state. */
async function handleRefundUpdated(
  db: D1Database,
  refund: Record<string, unknown>
): Promise<string> {
  const stripeRefundId = refund.id as string;
  const status = refund.status as string;

  const row = await first<{
    id: string;
    org_id: string;
    transaction_id: string;
    amount_cents: number;
    fee_refund_cents: number;
    status: string;
  }>(
    db,
    `SELECT id, org_id, transaction_id, amount_cents, fee_refund_cents, status
       FROM refunds WHERE stripe_refund_id = ?`,
    stripeRefundId
  );
  if (!row) return `no refund record for ${stripeRefundId}`;
  if (row.status === "succeeded") return "already settled";

  if (status === "succeeded") {
    await run(
      db,
      `UPDATE refunds SET status = 'succeeded', resolved_at = datetime('now') WHERE id = ?`,
      row.id
    );
    await settleRefund(db, {
      orgId: row.org_id,
      refundId: row.id,
      transactionId: row.transaction_id,
      amountCents: row.amount_cents,
      feeRefundCents: row.fee_refund_cents,
      stripeRefundId,
      restock: false,
      itemIds: [],
    });
    return "refund settled";
  }

  if (status === "failed" || status === "canceled") {
    await run(
      db,
      `UPDATE refunds SET status = 'failed', failure_message = ?, resolved_at = datetime('now')
        WHERE id = ?`,
      (refund.failure_reason as string) ?? status,
      row.id
    );
    return "refund failed";
  }

  return `refund still ${status}`;
}

async function handleDispute(
  db: D1Database,
  dispute: Record<string, unknown>
): Promise<string> {
  const chargeId = dispute.charge as string | undefined;
  const tx = chargeId
    ? await first<{ org_id: string }>(
        db,
        `SELECT org_id FROM transactions WHERE stripe_charge_id = ?`,
        chargeId
      )
    : null;

  if (!tx) return `no transaction for dispute on ${chargeId ?? "unknown charge"}`;

  const { created } = await upsertDispute(db, tx.org_id, {
    id: dispute.id as string,
    amount: Math.round((dispute.amount as number) ?? 0),
    charge: chargeId,
    reason: dispute.reason as string | undefined,
    status: dispute.status as string,
    evidence_details: dispute.evidence_details as { due_by?: number } | undefined,
    balance_transactions: dispute.balance_transactions as { fee?: number }[] | undefined,
  });

  return created ? "dispute recorded" : "dispute updated";
}

/**
 * A reader finishing or failing its action.
 *
 * Note this deliberately does not conclude the payment. `action_succeeded`
 * means the reader collected a card, not that the charge cleared — the
 * payment_intent event is the authority, and acting here would sell an item on
 * a tap that might still decline.
 */
async function handleReaderAction(
  db: D1Database,
  reader: Record<string, unknown>
): Promise<string> {
  const readerId = reader.id as string;
  await run(
    db,
    `UPDATE terminal_readers SET status = ?, last_seen_at = datetime('now'), updated_at = datetime('now')
      WHERE stripe_reader_id = ?`,
    (reader.status as string) ?? "online",
    readerId
  );

  const action = reader.action as
    | { status?: string; failure_code?: string; failure_message?: string }
    | null
    | undefined;

  if (action?.status === "failed") {
    const intentId = (
      reader.action as { process_payment_intent?: { payment_intent?: string } } | null
    )?.process_payment_intent?.payment_intent;

    if (intentId) {
      const attempt = await attemptForPaymentIntent(db, intentId);
      if (attempt) {
        await advanceAttempt(db, attempt.org_id, attempt.id, {
          state: "failed",
          failureCode: action.failure_code ?? "reader_action_failed",
          failureMessage: action.failure_message ?? "The reader couldn't take the payment.",
        });
        await applyInventoryEffect(db, attempt.org_id, attempt.transaction_id, "failed");
      }
    }
    return "reader action failed";
  }

  return "reader status synced";
}

async function handleAccountUpdated(
  db: D1Database,
  payload: Record<string, unknown>,
  config: StripeConfig | null
): Promise<string> {
  const accountId = (payload.id as string) ?? "";
  const local = await getAccountByStripeId(db, accountId);
  if (!local) return `no org for ${accountId}`;

  // Events can arrive out of order, so the current account is fetched rather
  // than trusting this payload to be the newest truth. A stale "requirements
  // due" overwriting a fresh "enabled" would lock a shop out of its own till.
  let account = payload as unknown as StripeAccountObject;
  if (config) {
    try {
      account = await retrieveAccount(config, accountId);
    } catch {
      // Stripe unreachable. The payload is stale-but-signed, which beats
      // nothing — and the next event will correct it.
    }
  }

  await syncAccount(db, local.orgId, account);
  return `account ${deriveStatus(account)}`;
}

/** The shop revoked our access. Payments stop; nothing is deleted. */
async function handleDeauthorized(
  db: D1Database,
  event: StripeEvent,
  object: Record<string, unknown>
): Promise<string> {
  const accountId = event.account ?? (object.id as string | undefined);
  if (!accountId) return "no account on the event";
  await markDeauthorized(db, accountId);
  return "account deauthorized";
}

/** A capability changing can flip an account between enabled and restricted. */
async function handleCapabilityUpdated(
  db: D1Database,
  object: Record<string, unknown>,
  config: StripeConfig | null
): Promise<string> {
  const accountId = object.account as string | undefined;
  if (!accountId || !config) return "no account, or Stripe not configured";

  const local = await getAccountByStripeId(db, accountId);
  if (!local) return `no org for ${accountId}`;

  const fresh = await retrieveAccount(config, accountId);
  await syncAccount(db, local.orgId, fresh);
  return `capability synced — account ${deriveStatus(fresh)}`;
}

/**
 * A failed payout.
 *
 * Nothing to do automatically — the money is stuck at the bank and only the
 * shop can fix it — but it must be visible rather than sitting silently in an
 * event log.
 */
async function handlePayoutFailed(
  db: D1Database,
  event: StripeEvent,
  payout: Record<string, unknown>
): Promise<string> {
  if (!event.account) return "payout failure on the platform account";

  const acct = await first<{ org_id: string }>(
    db,
    `SELECT org_id FROM stripe_accounts WHERE stripe_account_id = ?`,
    event.account
  );
  if (!acct) return `no org for ${event.account}`;

  await run(
    db,
    `INSERT INTO audit_log (id, org_id, action, entity_type, entity_id, detail_json)
     VALUES (?, ?, 'payout.failed', 'payout', ?, ?)`,
    `au_${(payout.id as string).slice(0, 20)}`,
    acct.org_id,
    (payout.id as string) ?? null,
    JSON.stringify({
      amount: payout.amount ?? 0,
      failureMessage: payout.failure_message ?? null,
      failureCode: payout.failure_code ?? null,
    })
  );

  return "payout failure recorded";
}

/* ─── Replay ────────────────────────────────────────────────────────────── */

/**
 * Events whose processing failed, for the admin replay screen.
 *
 * Replay exists because the alternative is worse: without it, a bug in a
 * handler means a permanently wrong ledger that has to be repaired by hand.
 * With it, you fix the handler and press a button.
 */
export async function failedEvents(db: D1Database, limit = 50) {
  const { all } = await import("../db");
  return all<{
    stripe_event_id: string;
    event_type: string;
    object_id: string | null;
    attempts: number;
    last_error: string | null;
    received_at: string;
  }>(
    db,
    `SELECT stripe_event_id, event_type, object_id, attempts, last_error, received_at
       FROM stripe_events WHERE status = 'failed'
      ORDER BY received_at DESC LIMIT ?`,
    limit
  );
}

/**
 * Re-run a stored event by fetching the current object from Stripe.
 *
 * The stored payload is deliberately not replayed. It was true when it was
 * sent and may not be now — a payment that was `processing` then may have
 * succeeded since, and replaying the stale view would undo the newer truth.
 */
export async function replayEvent(
  db: D1Database,
  config: StripeConfig,
  eventId: string
): Promise<WebhookResult> {
  const stored = await first<{ event_type: string }>(
    db,
    `SELECT event_type FROM stripe_events WHERE stripe_event_id = ?`,
    eventId
  );
  if (!stored) return { outcome: "failed", detail: "no such event" };

  const { stripeRequest } = await import("./client");
  const fresh = await stripeRequest<StripeEvent>(config, "GET", `/events/${eventId}`);

  try {
    const detail = await dispatch(db, fresh, config);
    await markEvent(db, eventId, "processed");
    return { outcome: "processed", eventId, eventType: fresh.type, detail };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await markEvent(db, eventId, "failed", message);
    return { outcome: "failed", eventId, eventType: fresh.type, detail: message };
  }
}
