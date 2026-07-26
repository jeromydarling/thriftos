/**
 * The financial ledger — append-only, signed, and deduplicated.
 *
 * A transactions row records what a sale *is*. The ledger records what
 * *happened*: the sale, the tax on it, the round-up, our platform fee, what
 * Stripe kept, what came back as a refund, what a dispute took away. Those are
 * different questions, and a system that stores only current totals can answer
 * the first but not the second.
 *
 * Three rules hold the whole thing together:
 *
 *   1. Append-only. Nothing here is ever updated or deleted. A mistake is
 *      corrected by writing an opposing entry, exactly as a paper ledger would,
 *      because the history is the point.
 *
 *   2. Signed amounts. Money into the shop is positive; money out is negative.
 *      Costs are stored as negatives rather than positive "cost" values, so a
 *      plain SUM over any slice is the net — no per-type sign table for a
 *      future report to get wrong.
 *
 *   3. Every write carries a dedupe key. Stripe retries webhooks, and our own
 *      handlers retry too. The unique index refuses the second write rather
 *      than doubling the books.
 */
import { all, first, run } from "./db";
import { newId } from "./ids";

export type LedgerEntryType =
  | "gross_sale"
  | "tax"
  | "round_up"
  | "platform_fee"
  | "stripe_processing_fee"
  | "connected_account_transfer"
  | "refund"
  | "application_fee_refund"
  | "transfer_reversal"
  | "dispute"
  | "dispute_fee"
  | "cash_sale"
  | "cash_variance";

/**
 * Which direction each type moves money, as an assertion rather than a
 * convention. `record` enforces it, so a handler that computes a positive
 * platform fee gets an error rather than quietly inflating a shop's revenue.
 */
const SIGN: Record<LedgerEntryType, "positive" | "negative" | "either"> = {
  gross_sale: "positive",
  tax: "positive",
  round_up: "positive",
  cash_sale: "positive",
  platform_fee: "negative",
  stripe_processing_fee: "negative",
  refund: "negative",
  transfer_reversal: "negative",
  dispute: "negative",
  dispute_fee: "negative",
  // Money handed back to the shop when a refund reverses our fee.
  application_fee_refund: "positive",
  // A transfer out to the connected account is negative from the platform's
  // side and positive from the shop's; callers state which they mean.
  connected_account_transfer: "either",
  // A drawer can be over or short.
  cash_variance: "either",
};

/** Types that count toward what the shop earned, rather than what it cost. */
export const REVENUE_TYPES: readonly LedgerEntryType[] = [
  "gross_sale",
  "cash_sale",
  "round_up",
];

export interface LedgerWrite {
  orgId: string;
  entryType: LedgerEntryType;
  amountCents: number;
  /** What this entry represents. Two writes with the same key are one entry. */
  dedupeKey: string;
  transactionId?: string | null;
  attemptId?: string | null;
  shiftId?: string | null;
  stripeObjectId?: string | null;
  occurredAt?: string;
  source?: "pos" | "stripe_webhook" | "reconciliation" | "manual";
  metadata?: Record<string, unknown>;
}

export class LedgerSignError extends Error {}

/**
 * Write one entry. Returns false if an entry with this key already existed,
 * which is a normal outcome on a replayed webhook and not an error.
 */
export async function record(db: D1Database, entry: LedgerWrite): Promise<boolean> {
  const amount = Math.round(entry.amountCents);
  const expected = SIGN[entry.entryType];

  if (expected === "positive" && amount < 0) {
    throw new LedgerSignError(`${entry.entryType} must be positive, got ${amount}`);
  }
  if (expected === "negative" && amount > 0) {
    throw new LedgerSignError(
      `${entry.entryType} must be negative — costs are stored as negatives so a SUM is the net. Got ${amount}`
    );
  }

  const res = await run(
    db,
    `INSERT OR IGNORE INTO ledger_entries
       (id, org_id, entry_type, transaction_id, attempt_id, shift_id, stripe_object_id,
        amount_cents, occurred_at, source, dedupe_key, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')), ?, ?, ?)`,
    newId("ledger"),
    entry.orgId,
    entry.entryType,
    entry.transactionId ?? null,
    entry.attemptId ?? null,
    entry.shiftId ?? null,
    entry.stripeObjectId ?? null,
    amount,
    entry.occurredAt ?? null,
    entry.source ?? "pos",
    entry.dedupeKey,
    JSON.stringify(entry.metadata ?? {})
  );

  return (res.meta?.changes ?? 0) > 0;
}

/**
 * Write several entries, skipping any that already exist.
 *
 * Not a transaction, deliberately. D1 batches are atomic but INSERT OR IGNORE
 * inside one gives no per-statement changes count, and knowing which entries
 * were new matters more here than saving round trips — a partial write is
 * self-healing on the next replay precisely because of the dedupe keys.
 */
export async function recordAll(
  db: D1Database,
  entries: LedgerWrite[]
): Promise<{ written: number; skipped: number }> {
  let written = 0;
  let skipped = 0;
  for (const entry of entries) {
    if (await record(db, entry)) written++;
    else skipped++;
  }
  return { written, skipped };
}

/**
 * The entries a completed sale produces.
 *
 * Kept as one function so the POS, the webhook handler, and any backfill all
 * post the same shape. Gross sale is merchandise only — tax and round-up are
 * separate lines because they are not the shop's revenue and reporting them
 * as such would overstate every figure downstream.
 */
export function saleEntries(opts: {
  orgId: string;
  transactionId: string;
  attemptId?: string | null;
  shiftId?: string | null;
  subtotalCents: number;
  taxCents: number;
  roundUpCents: number;
  platformFeeCents: number;
  tender: string;
  occurredAt?: string;
  source?: LedgerWrite["source"];
}): LedgerWrite[] {
  const isCash = opts.tender === "cash";

  const base = {
    orgId: opts.orgId,
    transactionId: opts.transactionId,
    attemptId: opts.attemptId ?? null,
    shiftId: opts.shiftId ?? null,
    occurredAt: opts.occurredAt,
    source: opts.source ?? ("pos" as const),
    // Carried on every entry because the expected-payout figure depends on it.
    // Cash never reaches a Stripe payout — it's already in the drawer — so tax
    // and round-ups collected in cash must not be counted as money coming from
    // Stripe, and neither must a refund handed back from the till.
    metadata: { tender: opts.tender },
  };
  const entries: LedgerWrite[] = [];

  if (opts.subtotalCents !== 0) {
    entries.push({
      ...base,
      entryType: isCash ? "cash_sale" : "gross_sale",
      amountCents: opts.subtotalCents,
      dedupeKey: `sale:${opts.transactionId}`,
    });
  }

  if (opts.taxCents > 0) {
    entries.push({
      ...base,
      entryType: "tax",
      amountCents: opts.taxCents,
      dedupeKey: `tax:${opts.transactionId}`,
    });
  }

  if (opts.roundUpCents > 0) {
    entries.push({
      ...base,
      entryType: "round_up",
      amountCents: opts.roundUpCents,
      dedupeKey: `roundup:${opts.transactionId}`,
    });
  }

  if (opts.platformFeeCents > 0) {
    entries.push({
      ...base,
      entryType: "platform_fee",
      amountCents: -opts.platformFeeCents,
      dedupeKey: `fee:${opts.transactionId}`,
    });
  }

  return entries;
}

/* ─── Reporting ─────────────────────────────────────────────────────────── */

export interface StoreReport {
  grossSalesCents: number;
  taxCents: number;
  roundUpCents: number;
  refundsCents: number;
  platformFeesCents: number;
  stripeFeesCents: number;
  disputesCents: number;
  /** Gross minus refunds. What the shop actually sold. */
  netSalesCents: number;
  /** What should land in the bank: net sales + tax + round-ups, less costs. */
  expectedPayoutCents: number;
  cashCents: number;
  cardCents: number;
}

/**
 * The store-facing report, derived entirely from the ledger.
 *
 * Every figure here is a SUM over entries, which means each one can be drilled
 * into and every cent traced to an event. A report that can't show its working
 * is a report a grant officer is right to distrust.
 */
export async function storeReport(
  db: D1Database,
  orgId: string,
  fromIso: string,
  toIso: string
): Promise<StoreReport> {
  const rows = await all<{ entry_type: string; tender: string; total: number }>(
    db,
    // Grouped by tender as well as type, because the expected payout is a
    // card-only figure. Entries written before tender was recorded default to
    // card, which is the conservative reading — it can only understate what a
    // shop should expect, never promise money that isn't coming.
    `SELECT entry_type,
            COALESCE(json_extract(metadata_json, '$.tender'), 'card') AS tender,
            COALESCE(SUM(amount_cents), 0) AS total
       FROM ledger_entries
      WHERE org_id = ? AND occurred_at >= ? AND occurred_at < ?
      GROUP BY entry_type, tender`,
    orgId,
    fromIso,
    toIso
  );

  const total = (type: LedgerEntryType, tender?: "cash" | "card") =>
    rows
      .filter((r) => r.entry_type === type)
      .filter((r) => !tender || (tender === "cash" ? r.tender === "cash" : r.tender !== "cash"))
      .reduce((sum, r) => sum + Number(r.total), 0);

  const cardSales = total("gross_sale");
  const cashSales = total("cash_sale");
  const gross = cardSales + cashSales;
  const tax = total("tax");
  const roundUp = total("round_up");

  // Already negative in the ledger; kept negative here so callers can add
  // rather than having to remember to subtract.
  const refunds = total("refund");
  const platformFees = total("platform_fee") + total("application_fee_refund");
  const stripeFees = total("stripe_processing_fee");
  const disputes = total("dispute") + total("dispute_fee");

  return {
    grossSalesCents: gross,
    taxCents: tax,
    roundUpCents: roundUp,
    refundsCents: refunds,
    platformFeesCents: platformFees,
    stripeFeesCents: stripeFees,
    disputesCents: disputes,
    netSalesCents: gross + refunds,
    // Only what Stripe will actually send. Cash sales, cash refunds, and tax or
    // round-ups collected in cash are all already in the drawer.
    expectedPayoutCents:
      cardSales +
      total("refund", "card") +
      total("tax", "card") +
      total("round_up", "card") +
      platformFees +
      stripeFees +
      disputes,
    cashCents: cashSales,
    cardCents: cardSales,
  };
}

/**
 * The platform-facing report.
 *
 * Note what this deliberately does not do: it never calls application-fee
 * revenue "net". On destination charges the platform carries Stripe's costs,
 * refund exposure, and dispute liability, so gross fee revenue is a number
 * that flatters us and predicts nothing. `netMarginCents` is the honest one.
 */
export interface PlatformReport {
  applicationFeeCents: number;
  applicationFeeRefundedCents: number;
  stripeCostCents: number;
  disputeLossCents: number;
  grossPaymentVolumeCents: number;
  netMarginCents: number;
}

export async function platformReport(
  db: D1Database,
  fromIso: string,
  toIso: string
): Promise<PlatformReport> {
  const row = await first<{
    fees: number;
    fee_refunds: number;
    stripe_cost: number;
    disputes: number;
    volume: number;
  }>(
    db,
    `SELECT
       COALESCE(SUM(CASE WHEN entry_type = 'platform_fee' THEN -amount_cents END), 0) AS fees,
       COALESCE(SUM(CASE WHEN entry_type = 'application_fee_refund' THEN amount_cents END), 0) AS fee_refunds,
       COALESCE(SUM(CASE WHEN entry_type = 'stripe_processing_fee' THEN -amount_cents END), 0) AS stripe_cost,
       COALESCE(SUM(CASE WHEN entry_type IN ('dispute','dispute_fee') THEN -amount_cents END), 0) AS disputes,
       COALESCE(SUM(CASE WHEN entry_type = 'gross_sale' THEN amount_cents END), 0) AS volume
     FROM ledger_entries
    WHERE occurred_at >= ? AND occurred_at < ?`,
    fromIso,
    toIso
  );

  const fees = Number(row?.fees ?? 0);
  const feeRefunds = Number(row?.fee_refunds ?? 0);
  const stripeCost = Number(row?.stripe_cost ?? 0);
  const disputes = Number(row?.disputes ?? 0);

  return {
    applicationFeeCents: fees,
    applicationFeeRefundedCents: feeRefunds,
    stripeCostCents: stripeCost,
    disputeLossCents: disputes,
    grossPaymentVolumeCents: Number(row?.volume ?? 0),
    netMarginCents: fees - feeRefunds - stripeCost - disputes,
  };
}

/** Every entry touching one sale, for the "why is this figure what it is" view. */
export async function entriesForTransaction(
  db: D1Database,
  orgId: string,
  transactionId: string
) {
  return all<{
    id: string;
    entry_type: string;
    amount_cents: number;
    occurred_at: string;
    source: string;
    stripe_object_id: string | null;
  }>(
    db,
    `SELECT id, entry_type, amount_cents, occurred_at, source, stripe_object_id
       FROM ledger_entries
      WHERE org_id = ? AND transaction_id = ?
      ORDER BY occurred_at, id`,
    orgId,
    transactionId
  );
}
