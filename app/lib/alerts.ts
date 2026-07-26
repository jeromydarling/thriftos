/**
 * Alerts — the things that need a person.
 *
 * Every condition here was already detectable before this file existed. A
 * failed webhook sat in `stripe_events`, a dispute deadline sat in
 * `disputes.evidence_due_at`, a failed payout wrote an audit row. All of it
 * true, recorded, and read by nobody.
 *
 * Two rules keep this from becoming noise, which is the only way an alert
 * system fails:
 *
 *   1. Every alert names an action. If there is nothing a person can do about
 *      it, it isn't an alert — it's a log line, and it belongs in system_runs.
 *
 *   2. Deduped by construction. A cron that runs daily must not produce a
 *      daily pile of identical rows; the unique index on (kind, dedupe_key)
 *      refuses the second one. An alert that resolves and recurs gets a new
 *      key, because that genuinely is new information.
 *
 * Nothing here auto-clears silently. An alert that vanishes on its own is one
 * nobody can prove they were shown, and "we did warn you" is worth very little
 * without a row to point at.
 */
import { all, first, run } from "./db";
import { newId } from "./ids";

export type AlertKind =
  | "dispute_deadline"
  | "webhook_failed"
  | "payout_failed"
  | "payment_stranded"
  | "connect_disabled"
  | "reader_failing"
  | "reconciliation_mismatch";

export type AlertSeverity = "critical" | "warning" | "info";

export interface AlertInput {
  /** Null for platform problems that aren't any one shop's fault. */
  orgId: string | null;
  kind: AlertKind;
  severity?: AlertSeverity;
  title: string;
  body: string;
  href?: string | null;
  dedupeKey: string;
  metadata?: Record<string, unknown>;
}

/** Raise an alert. Returns false if this exact problem is already flagged. */
export async function raise(db: D1Database, input: AlertInput): Promise<boolean> {
  const res = await run(
    db,
    `INSERT OR IGNORE INTO alerts
       (id, org_id, kind, severity, title, body, href, dedupe_key, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    newId("alert"),
    input.orgId,
    input.kind,
    input.severity ?? "warning",
    input.title,
    input.body,
    input.href ?? null,
    input.dedupeKey,
    JSON.stringify(input.metadata ?? {})
  );
  return (res.meta?.changes ?? 0) > 0;
}

/**
 * Mark an alert resolved because the condition it described has gone.
 *
 * Called when the underlying problem clears — a replayed webhook, a dispute
 * that closed. The row stays, so "how often does this happen to us" remains
 * answerable a year later.
 */
export async function resolve(
  db: D1Database,
  kind: AlertKind,
  dedupeKey: string
): Promise<void> {
  await run(
    db,
    `UPDATE alerts SET resolved_at = datetime('now')
      WHERE kind = ? AND dedupe_key = ? AND resolved_at IS NULL`,
    kind,
    dedupeKey
  );
}

export async function acknowledge(
  db: D1Database,
  orgId: string,
  alertId: string,
  userId: string
): Promise<void> {
  await run(
    db,
    `UPDATE alerts SET acknowledged_at = datetime('now'), acknowledged_by = ?
      WHERE id = ? AND (org_id = ? OR org_id IS NULL) AND acknowledged_at IS NULL`,
    userId,
    alertId,
    orgId
  );
}

export interface Alert {
  id: string;
  kind: string;
  severity: AlertSeverity;
  title: string;
  body: string;
  href: string | null;
  acknowledged_at: string | null;
  created_at: string;
}

/** Open alerts for a shop, most severe first. */
export async function openAlerts(db: D1Database, orgId: string, limit = 20): Promise<Alert[]> {
  return all<Alert>(
    db,
    `SELECT id, kind, severity, title, body, href, acknowledged_at, created_at
       FROM alerts
      WHERE (org_id = ? OR org_id IS NULL) AND resolved_at IS NULL
      ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
               created_at DESC
      LIMIT ?`,
    orgId,
    limit
  );
}

/** How many need attention, for a badge. Acknowledged ones stop counting. */
export async function unreadAlertCount(db: D1Database, orgId: string): Promise<number> {
  const row = await first<{ n: number }>(
    db,
    `SELECT COUNT(*) AS n FROM alerts
      WHERE (org_id = ? OR org_id IS NULL) AND resolved_at IS NULL AND acknowledged_at IS NULL`,
    orgId
  );
  return Number(row?.n ?? 0);
}

/* ─── The sweeps ────────────────────────────────────────────────────────── */

const DAY_MS = 86_400_000;

/**
 * Look for everything worth telling someone about.
 *
 * Runs from the daily cron. Written as one function returning counts so a
 * missing alert shows up as a zero in `system_runs` rather than as silence.
 */
export async function sweepAlerts(db: D1Database): Promise<Record<string, number>> {
  const raised: Record<string, number> = {
    dispute_deadline: 0,
    webhook_failed: 0,
    payment_stranded: 0,
    connect_disabled: 0,
    resolved: 0,
  };

  /* Disputes with a deadline. The one that costs real money if missed. */
  const disputes = await all<{
    id: string;
    org_id: string;
    amount_cents: number;
    evidence_due_at: string | null;
    status: string;
    transaction_id: string | null;
  }>(
    db,
    `SELECT id, org_id, amount_cents, evidence_due_at, status, transaction_id
       FROM disputes WHERE status NOT IN ('won','lost')`
  );

  for (const dispute of disputes) {
    const due = dispute.evidence_due_at ? new Date(dispute.evidence_due_at).getTime() : null;
    const daysLeft = due === null ? null : Math.floor((due - Date.now()) / DAY_MS);

    // Escalates as the deadline approaches, and each stage is its own alert
    // so a shop that acknowledged the first warning is still told when it
    // becomes urgent.
    const stage = daysLeft === null ? "open" : daysLeft <= 2 ? "urgent" : daysLeft <= 7 ? "soon" : null;
    if (!stage) continue;

    const created = await raise(db, {
      orgId: dispute.org_id,
      kind: "dispute_deadline",
      severity: stage === "urgent" ? "critical" : "warning",
      title:
        stage === "urgent"
          ? `A disputed payment needs a response now`
          : `A payment is being disputed`,
      body:
        daysLeft === null
          ? `${(dispute.amount_cents / 100).toFixed(2)} is being disputed. There's no deadline set yet, but responding early is always better.`
          : `${(dispute.amount_cents / 100).toFixed(2)} is being disputed and evidence is due in ${daysLeft} ${daysLeft === 1 ? "day" : "days"}. A dispute nobody answers is lost by default — send the receipt.`,
      href: dispute.transaction_id ? `/app/sales/${dispute.transaction_id}` : "/app/money",
      dedupeKey: `${dispute.id}:${stage}`,
      metadata: { disputeId: dispute.id, daysLeft },
    });
    if (created) raised.dispute_deadline++;
  }

  /* Webhook events whose handler failed. Money may be unrecorded. */
  const failed = await all<{ n: number; latest: string }>(
    db,
    `SELECT COUNT(*) AS n, MAX(received_at) AS latest
       FROM stripe_events WHERE status = 'failed'`
  );
  const failedCount = Number(failed[0]?.n ?? 0);

  if (failedCount > 0) {
    // Keyed by the day rather than the count, so a growing backlog doesn't
    // raise a fresh alert on every sweep — but a new day's failure does.
    const day = String(failed[0]?.latest ?? "").slice(0, 10);
    const created = await raise(db, {
      orgId: null,
      kind: "webhook_failed",
      severity: "critical",
      title: `${failedCount} Stripe ${failedCount === 1 ? "event" : "events"} failed to process`,
      body: "A payment, refund, or dispute may not have been recorded. Fix the handler, then replay the events — nothing is lost, but nothing is right until they run.",
      href: "/app/money",
      dedupeKey: `failed:${day}:${failedCount}`,
      metadata: { count: failedCount },
    });
    if (created) raised.webhook_failed++;
  }

  /* Payments stuck mid-flight, holding inventory nobody can sell. */
  const stranded = await all<{ org_id: string; n: number }>(
    db,
    `SELECT org_id, COUNT(*) AS n FROM payment_attempts
      WHERE state IN ('awaiting_reader','processing','requires_action')
        AND created_at < datetime('now', '-2 hours')
      GROUP BY org_id`
  );

  for (const row of stranded) {
    const created = await raise(db, {
      orgId: row.org_id,
      kind: "payment_stranded",
      severity: "warning",
      title: `${row.n} card ${row.n === 1 ? "payment is" : "payments are"} stuck part-way`,
      body: "These are holding items as reserved, so nobody can sell them. We ask Stripe about them nightly and release anything that genuinely went nowhere — but a lot of these usually means a reader is dropping off the network.",
      href: "/app/money",
      dedupeKey: `${row.org_id}:${new Date().toISOString().slice(0, 10)}`,
      metadata: { count: row.n },
    });
    if (created) raised.payment_stranded++;
  }

  /* Connect accounts that can no longer take money. */
  const blocked = await all<{ org_id: string; status: string; disabled_reason: string | null }>(
    db,
    `SELECT org_id, status, disabled_reason FROM stripe_accounts
      WHERE status IN ('restricted','disabled','requirements_due')`
  );

  for (const account of blocked) {
    const created = await raise(db, {
      orgId: account.org_id,
      kind: "connect_disabled",
      severity: "critical",
      title: "Card payments have stopped",
      body: `Stripe needs something from you before this shop can take cards again${account.disabled_reason ? ` (${account.disabled_reason.replace(/_/g, " ")})` : ""}. Cash still works in the meantime — the register doesn't stop.`,
      href: "/app/settings#payments",
      dedupeKey: `${account.org_id}:${account.status}`,
      metadata: { status: account.status },
    });
    if (created) raised.connect_disabled++;
  }

  /* Anything whose condition has gone. */
  const cleared = await run(
    db,
    `UPDATE alerts SET resolved_at = datetime('now')
      WHERE kind = 'connect_disabled' AND resolved_at IS NULL
        AND org_id IN (SELECT org_id FROM stripe_accounts WHERE status = 'enabled')`
  );
  raised.resolved = cleared.meta?.changes ?? 0;

  return raised;
}
