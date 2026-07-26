/**
 * Payment attempts — the record of every try at collecting money.
 *
 * A transaction can need several attempts: a declined tap, a customer who
 * fishes out a different card, a reader session somebody cancelled. Each is a
 * row here, and each carries one idempotency key.
 *
 * That key is the whole safety property. Stripe treats two requests with the
 * same key as one operation, so a request that times out after Stripe charged
 * the card but before we heard back can be retried without taking the money
 * twice. The key is generated once when the attempt is created and reused for
 * every retry *of that attempt*; a genuinely new attempt gets a new key,
 * because a customer presenting a second card is a second charge.
 *
 * The unique index on (org_id, idempotency_key) is what makes this hold even
 * if the application logic is wrong.
 */
import { all, first, run } from "./db";
import { newId } from "./ids";
import {
  assertTransition,
  type PaymentState,
  type Tender,
} from "./payments";

export interface PaymentAttempt {
  id: string;
  org_id: string;
  transaction_id: string;
  attempt_number: number;
  tender: string;
  state: PaymentState;
  amount_cents: number;
  idempotency_key: string;
  stripe_payment_intent_id: string | null;
  stripe_charge_id: string | null;
  reader_id: string | null;
  failure_code: string | null;
  failure_message: string | null;
  platform_fee_cents: number;
  fee_base_cents: number;
  created_at: string;
  resolved_at: string | null;
}

export interface OpenAttemptOptions {
  orgId: string;
  transactionId: string;
  tender: Tender;
  amountCents: number;
  platformFeeCents: number;
  feeBaseCents: number;
  readerId?: string | null;
  userId?: string | null;
  initialState?: PaymentState;
}

/**
 * Start a new attempt, or hand back the one already in flight.
 *
 * Reusing an in-flight attempt is the important half. A cashier who taps
 * "charge" twice because the screen looked frozen must get the same attempt —
 * and therefore the same idempotency key — rather than a second charge.
 */
export async function openAttempt(
  db: D1Database,
  opts: OpenAttemptOptions
): Promise<{ attempt: PaymentAttempt; reused: boolean }> {
  const existing = await first<PaymentAttempt>(
    db,
    `SELECT * FROM payment_attempts
      WHERE org_id = ? AND transaction_id = ?
        AND state IN ('draft','awaiting_reader','processing','requires_action')
      ORDER BY attempt_number DESC LIMIT 1`,
    opts.orgId,
    opts.transactionId
  );

  if (existing) return { attempt: existing, reused: true };

  const prior = await first<{ n: number }>(
    db,
    `SELECT COALESCE(MAX(attempt_number), 0) AS n FROM payment_attempts
      WHERE org_id = ? AND transaction_id = ?`,
    opts.orgId,
    opts.transactionId
  );

  const attemptNumber = Number(prior?.n ?? 0) + 1;
  const id = newId("attempt");

  // Derived from the transaction and attempt number rather than random, so a
  // retry that loses our response and re-derives the key still collides with
  // the original in Stripe rather than charging again.
  const idempotencyKey = `${opts.transactionId}:${attemptNumber}`;
  const state: PaymentState = opts.initialState ?? "draft";

  await run(
    db,
    `INSERT INTO payment_attempts
       (id, org_id, transaction_id, attempt_number, tender, state, amount_cents,
        idempotency_key, reader_id, platform_fee_cents, fee_base_cents, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    opts.orgId,
    opts.transactionId,
    attemptNumber,
    opts.tender,
    state,
    Math.round(opts.amountCents),
    idempotencyKey,
    opts.readerId ?? null,
    Math.round(opts.platformFeeCents),
    Math.round(opts.feeBaseCents),
    opts.userId ?? null
  );

  const attempt = await first<PaymentAttempt>(
    db,
    `SELECT * FROM payment_attempts WHERE id = ?`,
    id
  );
  if (!attempt) throw new Error("Attempt vanished immediately after insert");

  return { attempt, reused: false };
}

export interface AttemptUpdate {
  state: PaymentState;
  paymentIntentId?: string | null;
  chargeId?: string | null;
  failureCode?: string | null;
  failureMessage?: string | null;
}

/**
 * Move an attempt to a new state.
 *
 * The transition is checked against the state machine, and the UPDATE is
 * guarded on the state we believed it was in. Two webhooks arriving at once —
 * which Stripe makes no promise against — cannot both apply; the second finds
 * zero rows changed and is reported as such rather than overwriting the first.
 */
export async function advanceAttempt(
  db: D1Database,
  orgId: string,
  attemptId: string,
  update: AttemptUpdate
): Promise<{ applied: boolean; from: PaymentState | null }> {
  const current = await first<{ state: PaymentState }>(
    db,
    `SELECT state FROM payment_attempts WHERE id = ? AND org_id = ?`,
    attemptId,
    orgId
  );
  if (!current) return { applied: false, from: null };

  // Re-delivery of an event we already applied. Normal, not an error.
  if (current.state === update.state) return { applied: false, from: current.state };

  assertTransition(current.state, update.state);

  const terminal = ["succeeded", "failed", "canceled"].includes(update.state);

  const res = await run(
    db,
    `UPDATE payment_attempts
        SET state = ?,
            stripe_payment_intent_id = COALESCE(?, stripe_payment_intent_id),
            stripe_charge_id = COALESCE(?, stripe_charge_id),
            failure_code = ?,
            failure_message = ?,
            resolved_at = CASE WHEN ? = 1 THEN datetime('now') ELSE resolved_at END,
            updated_at = datetime('now')
      WHERE id = ? AND org_id = ? AND state = ?`,
    update.state,
    update.paymentIntentId ?? null,
    update.chargeId ?? null,
    update.failureCode ?? null,
    update.failureMessage ?? null,
    terminal ? 1 : 0,
    attemptId,
    orgId,
    current.state
  );

  return { applied: (res.meta?.changes ?? 0) > 0, from: current.state };
}

/** Find the attempt a Stripe object belongs to, for webhook handling. */
export async function attemptForPaymentIntent(
  db: D1Database,
  paymentIntentId: string
): Promise<PaymentAttempt | null> {
  return first<PaymentAttempt>(
    db,
    `SELECT * FROM payment_attempts WHERE stripe_payment_intent_id = ?`,
    paymentIntentId
  );
}

export async function attemptsForTransaction(
  db: D1Database,
  orgId: string,
  transactionId: string
): Promise<PaymentAttempt[]> {
  return all<PaymentAttempt>(
    db,
    `SELECT * FROM payment_attempts
      WHERE org_id = ? AND transaction_id = ?
      ORDER BY attempt_number`,
    orgId,
    transactionId
  );
}

/**
 * Attempts that have been in flight too long.
 *
 * A reader session that nobody finished leaves an attempt sitting in
 * awaiting_reader forever, holding its items reserved. Something has to notice;
 * the cron does, using this.
 */
export async function staleAttempts(
  db: D1Database,
  olderThanMinutes = 30
): Promise<PaymentAttempt[]> {
  return all<PaymentAttempt>(
    db,
    `SELECT * FROM payment_attempts
      WHERE state IN ('awaiting_reader','processing','requires_action')
        AND created_at < datetime('now', ?)
      ORDER BY created_at
      LIMIT 100`,
    `-${Math.max(1, Math.round(olderThanMinutes))} minutes`
  );
}
