/**
 * Drawer sessions and cash reconciliation.
 *
 * A shop counts the float in, sells things, and counts the drawer out. The
 * difference between what's there and what should be there is the variance,
 * and it is the single most useful operational number a thrift store has —
 * not because people steal, but because a drawer that is consistently short by
 * two dollars usually means somebody is giving change wrong, and a drawer
 * that's suddenly forty short means something happened that day.
 *
 * Two design decisions worth stating:
 *
 *   1. The expected total is computed at close and frozen. If it were computed
 *      on read, a backdated sale entered next week would silently change a
 *      variance a volunteer already signed their name to. Freezing it means
 *      the record says what was known at the time.
 *
 *   2. Non-sale cash movements are first-class. Without pay-ins, pay-outs, and
 *      safe drops, the variance blames whoever was on the register for money
 *      that left the drawer entirely legitimately. That's both wrong and
 *      corrosive.
 */
import { all, first, run } from "./db";
import { newId } from "./ids";
import { record } from "./ledger";

export interface RegisterShift {
  id: string;
  org_id: string;
  register_id: string | null;
  opened_by: string | null;
  closed_by: string | null;
  opening_float_cents: number;
  counted_cents: number | null;
  expected_cents: number | null;
  variance_cents: number | null;
  note: string | null;
  status: "open" | "closed";
  opened_at: string;
  closed_at: string | null;
}

/** The one open session for a register, if there is one. */
export async function openShiftFor(
  db: D1Database,
  orgId: string,
  registerId: string | null
): Promise<RegisterShift | null> {
  return first<RegisterShift>(
    db,
    registerId
      ? `SELECT * FROM register_shifts
          WHERE org_id = ? AND status = 'open' AND register_id = ?
          ORDER BY opened_at DESC LIMIT 1`
      : `SELECT * FROM register_shifts
          WHERE org_id = ? AND status = 'open' AND (? IS NULL)
          ORDER BY opened_at DESC LIMIT 1`,
    orgId,
    registerId
  );
}

export class ShiftAlreadyOpenError extends Error {}

/**
 * Open a drawer session.
 *
 * Refuses if one is already open on that register. Two open sessions on one
 * drawer means two people counting the same money, and whichever closes second
 * gets a variance that is pure fiction.
 */
export async function openShift(
  db: D1Database,
  opts: {
    orgId: string;
    registerId: string | null;
    userId: string | null;
    openingFloatCents: number;
  }
): Promise<RegisterShift> {
  const existing = await openShiftFor(db, opts.orgId, opts.registerId);
  if (existing) {
    throw new ShiftAlreadyOpenError(
      "This register already has a drawer open. Close it before opening another."
    );
  }

  const id = newId("registerShift");
  await run(
    db,
    `INSERT INTO register_shifts (id, org_id, register_id, opened_by, opening_float_cents)
     VALUES (?, ?, ?, ?, ?)`,
    id,
    opts.orgId,
    opts.registerId,
    opts.userId,
    Math.max(0, Math.round(opts.openingFloatCents))
  );

  const shift = await first<RegisterShift>(db, `SELECT * FROM register_shifts WHERE id = ?`, id);
  if (!shift) throw new Error("Drawer session vanished immediately after insert");
  return shift;
}

export interface ShiftTotals {
  cashSalesCents: number;
  cashRefundsCents: number;
  cardSalesCents: number;
  payInsCents: number;
  payOutsCents: number;
  dropsCents: number;
  transactionCount: number;
  /** float + cash in - cash out. What should physically be in the drawer. */
  expectedCents: number;
}

/**
 * What this session has taken so far.
 *
 * Card sales are reported but deliberately excluded from `expectedCents` — the
 * money never entered the drawer, so counting it there would make every
 * reconciliation wrong by the day's card total.
 */
export async function shiftTotals(
  db: D1Database,
  orgId: string,
  shiftId: string
): Promise<ShiftTotals> {
  const [shift, sales, refunds, movements] = await Promise.all([
    first<{ opening_float_cents: number }>(
      db,
      `SELECT opening_float_cents FROM register_shifts WHERE id = ? AND org_id = ?`,
      shiftId,
      orgId
    ),
    first<{ cash: number; card: number; n: number }>(
      db,
      // Voided sales never happened, and only approved payments took money.
      `SELECT
         COALESCE(SUM(CASE WHEN tender = 'cash' THEN total_cents ELSE 0 END), 0) AS cash,
         COALESCE(SUM(CASE WHEN tender <> 'cash' THEN total_cents ELSE 0 END), 0) AS card,
         COUNT(*) AS n
       FROM transactions
      WHERE org_id = ? AND shift_id = ? AND voided_at IS NULL
        AND payment_state IN ('succeeded','partially_refunded','refunded','disputed')`,
      orgId,
      shiftId
    ),
    first<{ cash: number }>(
      db,
      `SELECT COALESCE(SUM(r.amount_cents), 0) AS cash
         FROM refunds r
         JOIN transactions t ON t.id = r.transaction_id
        WHERE r.org_id = ? AND t.shift_id = ? AND r.tender = 'cash'
          AND r.status = 'succeeded'`,
      orgId,
      shiftId
    ),
    first<{ pay_in: number; pay_out: number; safe_drop: number }>(
      db,
      // `drop` is a SQLite keyword, so the alias is `safe_drop`. Aliasing it as
      // `drop` parses as the start of a DROP statement and fails at runtime.
      `SELECT
         COALESCE(SUM(CASE WHEN kind = 'pay_in' THEN amount_cents ELSE 0 END), 0) AS pay_in,
         COALESCE(SUM(CASE WHEN kind = 'pay_out' THEN amount_cents ELSE 0 END), 0) AS pay_out,
         COALESCE(SUM(CASE WHEN kind = 'drop' THEN amount_cents ELSE 0 END), 0) AS safe_drop
       FROM cash_movements WHERE org_id = ? AND shift_id = ?`,
      orgId,
      shiftId
    ),
  ]);

  const float = Number(shift?.opening_float_cents ?? 0);
  const cashSales = Number(sales?.cash ?? 0);
  const cardSales = Number(sales?.card ?? 0);
  const cashRefunds = Number(refunds?.cash ?? 0);
  const payIns = Number(movements?.pay_in ?? 0);
  const payOuts = Number(movements?.pay_out ?? 0);
  const drops = Number(movements?.safe_drop ?? 0);

  return {
    cashSalesCents: cashSales,
    cashRefundsCents: cashRefunds,
    cardSalesCents: cardSales,
    payInsCents: payIns,
    payOutsCents: payOuts,
    dropsCents: drops,
    transactionCount: Number(sales?.n ?? 0),
    expectedCents: float + cashSales + payIns - cashRefunds - payOuts - drops,
  };
}

export interface CloseResult {
  shift: RegisterShift;
  totals: ShiftTotals;
  varianceCents: number;
}

/**
 * Close a drawer session against a counted total.
 *
 * The variance goes into the ledger as its own entry. That's deliberate: a
 * shop's books should show that £3.40 went missing on a Tuesday, not silently
 * absorb it into sales and leave the revenue figure quietly wrong.
 */
export async function closeShift(
  db: D1Database,
  opts: {
    orgId: string;
    shiftId: string;
    userId: string | null;
    countedCents: number;
    note?: string | null;
  }
): Promise<CloseResult> {
  const totals = await shiftTotals(db, opts.orgId, opts.shiftId);
  const counted = Math.max(0, Math.round(opts.countedCents));
  const variance = counted - totals.expectedCents;

  const res = await run(
    db,
    // Guarded on status so a double submit closes once. The second press of a
    // button that seemed to do nothing is a real thing people do.
    `UPDATE register_shifts
        SET status = 'closed', closed_by = ?, counted_cents = ?, expected_cents = ?,
            variance_cents = ?, note = ?, closed_at = datetime('now')
      WHERE id = ? AND org_id = ? AND status = 'open'`,
    opts.userId,
    counted,
    totals.expectedCents,
    variance,
    opts.note ?? null,
    opts.shiftId,
    opts.orgId
  );

  if ((res.meta?.changes ?? 0) === 0) {
    const already = await first<RegisterShift>(
      db,
      `SELECT * FROM register_shifts WHERE id = ? AND org_id = ?`,
      opts.shiftId,
      opts.orgId
    );
    if (!already) throw new Error("That drawer session doesn't exist.");
    return {
      shift: already,
      totals,
      varianceCents: Number(already.variance_cents ?? 0),
    };
  }

  if (variance !== 0) {
    await record(db, {
      orgId: opts.orgId,
      entryType: "cash_variance",
      amountCents: variance,
      dedupeKey: `variance:${opts.shiftId}`,
      shiftId: opts.shiftId,
      source: "reconciliation",
      metadata: {
        countedCents: counted,
        expectedCents: totals.expectedCents,
        note: opts.note ?? null,
      },
    });
  }

  const shift = await first<RegisterShift>(
    db,
    `SELECT * FROM register_shifts WHERE id = ?`,
    opts.shiftId
  );

  return { shift: shift!, totals, varianceCents: variance };
}

/** Record cash that moved for a reason other than a sale. */
export async function recordCashMovement(
  db: D1Database,
  opts: {
    orgId: string;
    shiftId: string;
    kind: "pay_in" | "pay_out" | "drop";
    amountCents: number;
    reason: string;
    userId?: string | null;
  }
): Promise<string> {
  const amount = Math.round(Math.abs(opts.amountCents));
  if (amount === 0) throw new Error("A cash movement of nothing isn't a movement.");
  if (!opts.reason.trim()) {
    // An unexplained pay-out is indistinguishable from a missing pay-out when
    // somebody reviews the day a month later.
    throw new Error("Say what the money was for — an unexplained movement helps nobody.");
  }

  const id = newId("cashMovement");
  await run(
    db,
    `INSERT INTO cash_movements (id, org_id, shift_id, kind, amount_cents, reason, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    id,
    opts.orgId,
    opts.shiftId,
    opts.kind,
    amount,
    opts.reason.trim(),
    opts.userId ?? null
  );
  return id;
}

export async function listRegisters(db: D1Database, orgId: string) {
  return all<{ id: string; name: string; location_id: string | null; reader_id: string | null }>(
    db,
    `SELECT id, name, location_id, reader_id FROM registers
      WHERE org_id = ? AND is_active = 1 ORDER BY name`,
    orgId
  );
}

/**
 * Every shop gets one register without being asked.
 *
 * Most thrift stores have exactly one counter and will never think about this
 * screen. Making them create a register before they can open a drawer would be
 * configuration for its own sake.
 */
export async function ensureDefaultRegister(
  db: D1Database,
  orgId: string
): Promise<string> {
  const existing = await first<{ id: string }>(
    db,
    `SELECT id FROM registers WHERE org_id = ? AND is_active = 1 ORDER BY created_at LIMIT 1`,
    orgId
  );
  if (existing) return existing.id;

  const location = await first<{ id: string }>(
    db,
    `SELECT id FROM locations WHERE org_id = ? ORDER BY is_default DESC, created_at LIMIT 1`,
    orgId
  );

  const id = newId("register");
  await run(
    db,
    `INSERT INTO registers (id, org_id, location_id, name) VALUES (?, ?, ?, 'Front counter')`,
    id,
    orgId,
    location?.id ?? null
  );
  return id;
}

/** Closed sessions, newest first, for the reconciliation history. */
export async function recentShifts(db: D1Database, orgId: string, limit = 30) {
  return all<
    RegisterShift & { register_name: string | null; opened_by_name: string | null }
  >(
    db,
    `SELECT s.*, r.name AS register_name, u.name AS opened_by_name
       FROM register_shifts s
       LEFT JOIN registers r ON r.id = s.register_id
       LEFT JOIN users u ON u.id = s.opened_by
      WHERE s.org_id = ?
      ORDER BY s.opened_at DESC
      LIMIT ?`,
    orgId,
    limit
  );
}
