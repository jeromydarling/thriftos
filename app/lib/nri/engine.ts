/**
 * NRI engine — gathers the snapshot, runs the rules, persists what's new.
 *
 * The DB half lives here so `rules.ts` can stay pure. Reads run in parallel;
 * writes are batched. Re-running this is safe and cheap: `dedupe_key` carries a
 * unique index, so the same noticing is never written twice.
 */
import { all, batch, first } from "../db";
import { newId } from "../ids";
import { deriveSignals } from "./rules";
import type { CandidateSignal, NriSnapshot } from "./types";
import { DISCERNMENT } from "./voice";
import { DIVERTED_STATUS_SQL, realOnly } from "../impact";
import { THRESHOLDS, medianGapDays } from "./rules";

const DAY = 86_400_000;

function daysAgo(now: Date, days: number): string {
  return new Date(now.getTime() - days * DAY).toISOString();
}

function daysSince(iso: string | null, now: Date): number | null {
  if (!iso) return null;
  const ms = now.getTime() - new Date(iso.length === 10 ? iso + "T00:00:00Z" : iso).getTime();
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, Math.floor(ms / DAY));
}

/**
 * Read everything the rules need, in one parallel pass.
 *
 * Note the shape: aggregates where aggregates suffice, and per-person rows only
 * where a rule genuinely needs to name someone. NRI reads no more than it must.
 */
export async function gatherSnapshot(
  db: D1Database,
  orgId: string,
  now: Date = new Date()
): Promise<NriSnapshot> {
  const nowIso = now.toISOString();
  const d7 = daysAgo(now, 7);
  const d14 = daysAgo(now, 14);
  const d30 = daysAgo(now, 30);
  const d60 = daysAgo(now, 60);
  const d90 = daysAgo(now, 90);
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const prevMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString();

  const [
    org,
    donorRows,
    donationDateRows,
    unackRows,
    receiptGap,
    volunteerRows,
    inventoryAgg,
    intakeSold,
    soldAgg,
    impactAgg,
    volunteerHours,
    multiRoleRows,
    reflectionCounts,
    milestoneRows,
  ] = await Promise.all([
    first<{ name: string }>(db, `SELECT name FROM orgs WHERE id = ?`, orgId),

    // Donor rhythm: count, first, last.
    all<{ contact_id: string; name: string; n: number; first_at: string; last_at: string }>(
      db,
      `SELECT d.contact_id, c.name, COUNT(*) AS n,
              MIN(d.received_at) AS first_at, MAX(d.received_at) AS last_at
         FROM donations d
         JOIN contacts c ON c.id = d.contact_id
        WHERE d.org_id = ? AND d.contact_id IS NOT NULL
        GROUP BY d.contact_id, c.name
       HAVING n >= ?
        LIMIT 400`,
      orgId,
      THRESHOLDS.quietDonorMinDonations
    ),

    // Individual dates, to compute each donor's own median gap.
    all<{ contact_id: string; received_at: string }>(
      db,
      `SELECT contact_id, received_at FROM donations
        WHERE org_id = ? AND contact_id IS NOT NULL
        ORDER BY contact_id, received_at
        LIMIT 4000`,
      orgId
    ),

    // First-time donors inside the ack window who have no receipt yet.
    all<{ contact_id: string; name: string; received_at: string }>(
      db,
      `SELECT d.contact_id, c.name, d.received_at
         FROM donations d
         JOIN contacts c ON c.id = d.contact_id
        WHERE d.org_id = ?
          AND d.contact_id IS NOT NULL
          AND d.received_at >= ?
          AND NOT EXISTS (SELECT 1 FROM donation_receipts r WHERE r.donation_id = d.id)
          AND (SELECT COUNT(*) FROM donations d2
                WHERE d2.org_id = d.org_id AND d2.contact_id = d.contact_id) = 1
        LIMIT 50`,
      orgId,
      daysAgo(now, THRESHOLDS.firstDonorAckDays)
    ),

    first<{ n: number; oldest: string | null }>(
      db,
      `SELECT COUNT(*) AS n, MIN(d.received_at) AS oldest
         FROM donations d
        WHERE d.org_id = ? AND d.contact_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM donation_receipts r WHERE r.donation_id = d.id)`,
      orgId
    ),

    // Volunteer rhythm over 90 days, plus whether anything is on the books ahead.
    all<{
      contact_id: string;
      name: string;
      shifts: number;
      hours: number;
      last_at: string | null;
      upcoming: number;
    }>(
      db,
      `SELECT s.contact_id, c.name,
              COUNT(*) AS shifts,
              COALESCE(SUM(s.hours_logged), 0) AS hours,
              MAX(CASE WHEN s.starts_at <= ? THEN s.starts_at END) AS last_at,
              SUM(CASE WHEN s.starts_at > ? AND s.status IN ('scheduled','confirmed') THEN 1 ELSE 0 END) AS upcoming
         FROM shifts s
         JOIN contacts c ON c.id = s.contact_id
        WHERE s.org_id = ? AND s.contact_id IS NOT NULL AND s.starts_at >= ?
        GROUP BY s.contact_id, c.name
        LIMIT 400`,
      nowIso,
      nowIso,
      orgId,
      d90
    ),

    first<{
      available: number;
      unpriced: number;
      oldest: string | null;
    }>(
      db,
      `SELECT COUNT(*) AS available,
              SUM(CASE WHEN price_cents <= 0 THEN 1 ELSE 0 END) AS unpriced,
              MIN(intake_date) AS oldest
         FROM items WHERE org_id = ? AND status = 'available'`,
      orgId
    ),

    first<{
      intake_7: number;
      intake_prev_7: number;
      sold_7: number;
      sold_prev_7: number;
    }>(
      db,
      `SELECT
         (SELECT COUNT(*) FROM items WHERE org_id = ?1 AND created_at >= ?2) AS intake_7,
         (SELECT COUNT(*) FROM items WHERE org_id = ?1 AND created_at >= ?3 AND created_at < ?2) AS intake_prev_7,
         (SELECT COUNT(*) FROM items WHERE org_id = ?1 AND sold_at >= ?2) AS sold_7,
         (SELECT COUNT(*) FROM items WHERE org_id = ?1 AND sold_at >= ?3 AND sold_at < ?2) AS sold_prev_7`,
      orgId,
      d7,
      d14
    ),

    // Aged stock: on the floor past the whole rotation.
    first<{ past_rotation: number; final_markdown: number }>(
      db,
      `SELECT
         SUM(CASE WHEN julianday('now') - julianday(intake_date) >= 56 THEN 1 ELSE 0 END) AS past_rotation,
         SUM(CASE WHEN julianday('now') - julianday(intake_date) >= 56 THEN 1 ELSE 0 END) AS final_markdown
        FROM items WHERE org_id = ? AND status = 'available'`,
      orgId
    ),

    first<{
      lbs_total: number;
      lbs_month: number;
      rehomed_total: number;
      rehomed_month: number;
      value_month: number;
    }>(
      db,
      // Diversion counts only what actually left the building for reuse — the
      // same definition the impact rollup uses. Adding donation intake weight
      // here would double-count and would also count goods still sitting in the
      // backroom, which have not been diverted from anything yet.
      //
      // Sample data is excluded here and only here. NRI's operational rules
      // above deliberately read it — a shop loading samples wants to watch the
      // Compass notice aged stock and a donor gone quiet, and that's the whole
      // point of loading them. But these are the figures that become a
      // celebration signal and a board report, and celebrating invented weight
      // would make every number in the app suspect. One definition of impact,
      // shared with the rollup, so the two can never drift apart again.
      `SELECT
         COALESCE((SELECT SUM(weight_lbs) FROM items
                    WHERE org_id = ?1 AND ${realOnly()}
                      AND status IN (${DIVERTED_STATUS_SQL})), 0) AS lbs_total,
         COALESCE((SELECT SUM(weight_lbs) FROM items
                    WHERE org_id = ?1 AND ${realOnly()} AND sold_at >= ?2), 0) AS lbs_month,
         (SELECT COUNT(*) FROM items
           WHERE org_id = ?1 AND ${realOnly()} AND status = 'sold') AS rehomed_total,
         (SELECT COUNT(*) FROM items
           WHERE org_id = ?1 AND ${realOnly()} AND sold_at >= ?2) AS rehomed_month,
         COALESCE((SELECT SUM(MAX(ti.retail_estimate_cents - ti.price_cents, 0))
                     FROM transaction_items ti
                     JOIN transactions t ON t.id = ti.transaction_id
                    WHERE ti.org_id = ?1 AND ${realOnly("t")}
                      AND t.created_at >= ?2 AND t.voided_at IS NULL), 0) AS value_month`,
      orgId,
      monthStart
    ),

    first<{ hours_month: number; hours_prev: number; headcount: number }>(
      db,
      `SELECT
         COALESCE((SELECT SUM(hours_logged) FROM shifts
                    WHERE org_id = ?1 AND status = 'completed' AND starts_at >= ?2), 0) AS hours_month,
         COALESCE((SELECT SUM(hours_logged) FROM shifts
                    WHERE org_id = ?1 AND status = 'completed'
                      AND starts_at >= ?3 AND starts_at < ?2), 0) AS hours_prev,
         (SELECT COUNT(DISTINCT contact_id) FROM shifts
           WHERE org_id = ?1 AND status = 'completed' AND starts_at >= ?2) AS headcount`,
      orgId,
      monthStart,
      prevMonthStart
    ),

    // People holding more than one role, who picked one up recently.
    all<{ id: string; name: string; roles: string; updated_at: string }>(
      db,
      `SELECT id, name, roles, updated_at FROM contacts
        WHERE org_id = ? AND roles LIKE '%,%' AND updated_at >= ?
        LIMIT 50`,
      orgId,
      d30
    ),

    first<{ last_30: number; prev_30: number }>(
      db,
      `SELECT
         (SELECT COUNT(*) FROM nri_reflections WHERE org_id = ?1 AND created_at >= ?2) AS last_30,
         (SELECT COUNT(*) FROM nri_reflections WHERE org_id = ?1 AND created_at >= ?3 AND created_at < ?2) AS prev_30`,
      orgId,
      d30,
      d60
    ),

    // Milestones already celebrated — read straight off prior signals.
    all<{ dedupe_key: string }>(
      db,
      `SELECT dedupe_key FROM nri_signals WHERE org_id = ? AND kind = 'celebration' LIMIT 500`,
      orgId
    ),
  ]);

  // Per-donor median gaps, from the raw dates.
  const datesByContact = new Map<string, string[]>();
  for (const row of donationDateRows) {
    const list = datesByContact.get(row.contact_id) ?? [];
    list.push(row.received_at);
    datesByContact.set(row.contact_id, list);
  }

  const quietDonors: NriSnapshot["quietDonors"] = [];
  const returningDonors: NriSnapshot["returningDonors"] = [];

  for (const row of donorRows) {
    const since = daysSince(row.last_at, now) ?? 0;
    const gap = medianGapDays(datesByContact.get(row.contact_id) ?? []);
    const donor = {
      contactId: row.contact_id,
      name: row.name,
      donationCount: Number(row.n),
      firstDonationAt: row.first_at,
      lastDonationAt: row.last_at,
      daysSinceLast: since,
      medianGapDays: gap,
      hasReceipt: true,
      acknowledged: true,
    };

    // Quiet relative to *their own* rhythm — never a fixed schedule imposed on them.
    const expected = gap ? gap * THRESHOLDS.quietDonorGapMultiplier : THRESHOLDS.quietDonorMinDays;
    if (since >= Math.max(expected, THRESHOLDS.quietDonorMinDays)) {
      quietDonors.push(donor);
    }

    // Came back after a long absence: last visit is recent, prior gap was long.
    const dates = (datesByContact.get(row.contact_id) ?? []).slice().sort();
    if (dates.length >= 2 && since <= 7) {
      const priorGap = daysSince(dates[dates.length - 2], new Date(dates[dates.length - 1])) ?? 0;
      if (priorGap >= THRESHOLDS.returningDonorMinGapDays) returningDonors.push(donor);
    }
  }

  quietDonors.sort((a, b) => b.daysSinceLast - a.daysSinceLast);

  const quietVolunteers = volunteerRows
    .map((v) => ({
      contactId: v.contact_id,
      name: v.name,
      shiftsLast90: Number(v.shifts),
      hoursLast90: Number(v.hours),
      lastShiftAt: v.last_at,
      daysSinceLast: daysSince(v.last_at, now),
      upcomingShifts: Number(v.upcoming ?? 0),
    }))
    .filter(
      (v) =>
        v.upcomingShifts === 0 &&
        v.shiftsLast90 >= THRESHOLDS.quietVolunteerMinShifts &&
        (v.daysSinceLast ?? 0) >= THRESHOLDS.quietVolunteerDays
    )
    .sort((a, b) => (b.daysSinceLast ?? 0) - (a.daysSinceLast ?? 0));

  const multiRoleContacts = multiRoleRows.map((c) => {
    const roles = c.roles.split(",").map((r) => r.trim()).filter(Boolean);
    return {
      contactId: c.id,
      name: c.name,
      roles,
      // The most recently gained role is the one that widened the relationship.
      newRoles: roles.slice(-1),
    };
  });

  const oldestDays = daysSince(inventoryAgg?.oldest ?? null, now) ?? 0;

  return {
    orgId,
    orgName: org?.name ?? "your shop",
    now: nowIso,
    quietDonors,
    returningDonors,
    firstTimeDonorsUnacknowledged: unackRows.map((r) => ({
      contactId: r.contact_id,
      name: r.name,
      donationCount: 1,
      firstDonationAt: r.received_at,
      lastDonationAt: r.received_at,
      daysSinceLast: daysSince(r.received_at, now) ?? 0,
      medianGapDays: null,
      hasReceipt: false,
      acknowledged: false,
    })),
    donationsMissingReceipts: Number(receiptGap?.n ?? 0),
    donationsMissingReceiptsOldestDays: daysSince(receiptGap?.oldest ?? null, now) ?? 0,
    quietVolunteers,
    volunteersWithoutUpcoming: quietVolunteers.length,
    inventory: {
      available: Number(inventoryAgg?.available ?? 0),
      intakeLast7: Number(intakeSold?.intake_7 ?? 0),
      intakePrev7: Number(intakeSold?.intake_prev_7 ?? 0),
      soldLast7: Number(intakeSold?.sold_7 ?? 0),
      soldPrev7: Number(intakeSold?.sold_prev_7 ?? 0),
      atFinalMarkdown: Number(soldAgg?.final_markdown ?? 0),
      unpriced: Number(inventoryAgg?.unpriced ?? 0),
      pastRotation: Number(soldAgg?.past_rotation ?? 0),
      oldestAvailableDays: oldestDays,
    },
    impact: {
      diversionLbsTotal: Number(impactAgg?.lbs_total ?? 0),
      diversionLbsThisMonth: Number(impactAgg?.lbs_month ?? 0),
      itemsRehomedTotal: Number(impactAgg?.rehomed_total ?? 0),
      itemsRehomedThisMonth: Number(impactAgg?.rehomed_month ?? 0),
      valueDeliveredCentsThisMonth: Number(impactAgg?.value_month ?? 0),
      volunteerHoursThisMonth: Number(volunteerHours?.hours_month ?? 0),
      volunteerHoursPrevMonth: Number(volunteerHours?.hours_prev ?? 0),
      volunteerHeadcountThisMonth: Number(volunteerHours?.headcount ?? 0),
    },
    multiRoleContacts,
    reflectionsLast30: Number(reflectionCounts?.last_30 ?? 0),
    reflectionsPrev30: Number(reflectionCounts?.prev_30 ?? 0),
    // Strip the "celebration:" prefix so rules can ask "have we said this?"
    celebratedMilestones: milestoneRows.map((r) => r.dedupe_key.replace(/^celebration:/, "")),
  };
}

export interface GenerateResult {
  generated: number;
  written: number;
  skipped: number;
}

/** Gather → derive → persist. Safe to run as often as you like. */
export async function generateSignals(
  db: D1Database,
  orgId: string,
  now: Date = new Date()
): Promise<GenerateResult> {
  const snapshot = await gatherSnapshot(db, orgId, now);
  const candidates = deriveSignals(snapshot, now);
  return persistSignals(db, orgId, candidates);
}

/** Insert what's new. `INSERT OR IGNORE` against the unique dedupe index. */
export async function persistSignals(
  db: D1Database,
  orgId: string,
  candidates: CandidateSignal[]
): Promise<GenerateResult> {
  if (candidates.length === 0) return { generated: 0, written: 0, skipped: 0 };

  const existing = new Set(
    (
      await all<{ dedupe_key: string }>(
        db,
        `SELECT dedupe_key FROM nri_signals WHERE org_id = ?`,
        orgId
      )
    ).map((r) => r.dedupe_key)
  );

  const fresh = candidates.filter((c) => !existing.has(c.dedupeKey));

  const stmts = fresh.map((c) =>
    db
      .prepare(
        `INSERT OR IGNORE INTO nri_signals
           (id, org_id, kind, title, summary, evidence_json, confidence, subject_type, subject_id, dedupe_key)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        newId("signal"),
        orgId,
        c.kind,
        c.title,
        c.summary,
        JSON.stringify(c.evidence),
        c.confidence,
        c.subjectType ?? null,
        c.subjectId ?? null,
        c.dedupeKey
      )
  );

  await batch(db, stmts);

  return {
    generated: candidates.length,
    written: fresh.length,
    skipped: candidates.length - fresh.length,
  };
}

export interface StoredSignal {
  id: string;
  kind: string;
  title: string;
  summary: string;
  evidence: Record<string, unknown>;
  confidence: string;
  subjectType: string | null;
  subjectId: string | null;
  createdAt: string;
}

/** The open Compass — capped, because attention is the scarce resource. */
export async function openSignals(
  db: D1Database,
  orgId: string,
  limit = DISCERNMENT.maxOpenSignals
): Promise<StoredSignal[]> {
  const rows = await all<{
    id: string;
    kind: string;
    title: string;
    summary: string;
    evidence_json: string;
    confidence: string;
    subject_type: string | null;
    subject_id: string | null;
    created_at: string;
  }>(
    db,
    `SELECT id, kind, title, summary, evidence_json, confidence, subject_type, subject_id, created_at
       FROM nri_signals
      WHERE org_id = ? AND dismissed_at IS NULL
      ORDER BY CASE kind
                 WHEN 'celebration' THEN 0
                 WHEN 'connection'  THEN 1
                 WHEN 'check_in'    THEN 2
                 ELSE 3 END,
               created_at DESC
      LIMIT ?`,
    orgId,
    limit
  );

  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    title: r.title,
    summary: r.summary,
    evidence: safeParse(r.evidence_json),
    confidence: r.confidence,
    subjectType: r.subject_type,
    subjectId: r.subject_id,
    createdAt: r.created_at,
  }));
}

function safeParse(json: string): Record<string, unknown> {
  try {
    const v = JSON.parse(json);
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}
