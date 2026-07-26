/**
 * Scheduled work.
 *
 * Daily  (17 7 * * *)  — impact rollup, demo self-heal, session housekeeping.
 * Weekly (23 6 * * 1)  — NRI signal generation and the demo reset.
 *
 * Every job records a row in system_runs so a silent failure is visible rather
 * than merely absent.
 */
import { all, first, run } from "../lib/db";
import { newId } from "../lib/ids";
import { generateSignals } from "../lib/nri/engine";
import { ensureDemoSeeded, seedDemoOrg, DEMO_SLUG } from "../lib/seed";
import { DIVERTED_STATUS_SQL, realOnly } from "../lib/impact";

async function record(
  db: D1Database,
  job: string,
  fn: () => Promise<Record<string, unknown>>
): Promise<void> {
  const started = Date.now();
  try {
    const stats = await fn();
    await run(
      db,
      `INSERT INTO system_runs (id, job, status, stats_json, duration_ms) VALUES (?, ?, 'ok', ?, ?)`,
      newId("run"),
      job,
      JSON.stringify(stats),
      Date.now() - started
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`cron ${job} failed:`, message);
    try {
      await run(
        db,
        `INSERT INTO system_runs (id, job, status, error, duration_ms) VALUES (?, ?, 'error', ?, ?)`,
        newId("run"),
        job,
        message,
        Date.now() - started
      );
    } catch {
      /* best effort */
    }
  }
}

async function activeOrgIds(db: D1Database): Promise<string[]> {
  const rows = await all<{ id: string }>(
    db,
    `SELECT id FROM orgs WHERE status = 'active' LIMIT 500`
  );
  return rows.map((r) => r.id);
}

export async function runDaily(env: Env): Promise<void> {
  const db = env.DB;

  await record(db, "session_cleanup", async () => {
    const res = await run(db, `DELETE FROM sessions WHERE expires_at < datetime('now')`);
    return { deleted: res.meta?.changes ?? 0 };
  });

  await record(db, "impact_rollup", async () => {
    const orgs = await activeOrgIds(db);
    let written = 0;
    for (const orgId of orgs) {
      written += await rollupImpact(db, orgId);
    }
    return { orgs: orgs.length, periods_written: written };
  });

  // The demo must never be found empty by a visitor.
  await record(db, "demo_selfheal", async () => {
    const orgId = await ensureDemoSeeded(db);
    return { org_id: orgId };
  });
}

export async function runWeekly(env: Env): Promise<void> {
  const db = env.DB;

  await record(db, "nri_weekly", async () => {
    const orgs = await activeOrgIds(db);
    let written = 0;
    for (const orgId of orgs) {
      const result = await generateSignals(db, orgId);
      written += result.written;
    }
    return { orgs: orgs.length, signals_written: written };
  });

  // A fresh demo every week — nobody wants to meet last month's mess.
  await record(db, "demo_reset", async () => {
    const result = await seedDemoOrg(db);
    return { org_id: result.orgId, items: result.items, slug: DEMO_SLUG };
  });
}

/**
 * Roll this month's impact into `impact_metrics`. Upserts on
 * (org_id, period_kind, period_start), so re-running only refreshes.
 */
export async function rollupImpact(db: D1Database, orgId: string): Promise<number> {
  const now = new Date();
  const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    .toISOString()
    .slice(0, 10);
  const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0))
    .toISOString()
    .slice(0, 10);

  const totals = await first<{
    diversion_lbs: number;
    items_rehomed: number;
    value_delivered: number;
    revenue: number;
    volunteer_hours: number;
    volunteer_headcount: number;
    donations: number;
  }>(
    db,
    `SELECT
       COALESCE((SELECT SUM(weight_lbs) FROM items
                  WHERE org_id = ?1 AND status IN (${DIVERTED_STATUS_SQL})
                    AND ${realOnly()}
                    AND COALESCE(sold_at, updated_at) >= ?2), 0) AS diversion_lbs,
       (SELECT COUNT(*) FROM items
         WHERE org_id = ?1 AND ${realOnly()} AND sold_at >= ?2) AS items_rehomed,
       COALESCE((SELECT SUM(MAX(ti.retail_estimate_cents - ti.price_cents, 0))
                   FROM transaction_items ti
                   JOIN transactions t ON t.id = ti.transaction_id
                  WHERE ti.org_id = ?1 AND ${realOnly("t")}
                    AND t.created_at >= ?2 AND t.voided_at IS NULL), 0) AS value_delivered,
       COALESCE((SELECT SUM(total_cents) FROM transactions
                  WHERE org_id = ?1 AND ${realOnly()}
                    AND created_at >= ?2 AND voided_at IS NULL), 0) AS revenue,
       COALESCE((SELECT SUM(hours_logged) FROM shifts
                  WHERE org_id = ?1 AND ${realOnly()}
                    AND status = 'completed' AND starts_at >= ?2), 0) AS volunteer_hours,
       (SELECT COUNT(DISTINCT contact_id) FROM shifts
         WHERE org_id = ?1 AND ${realOnly()}
           AND status = 'completed' AND starts_at >= ?2) AS volunteer_headcount,
       (SELECT COUNT(*) FROM donations
         WHERE org_id = ?1 AND ${realOnly()} AND received_at >= ?2) AS donations`,
    orgId,
    periodStart
  );

  await run(
    db,
    `INSERT INTO impact_metrics
       (id, org_id, period_start, period_end, period_kind, diversion_lbs, items_rehomed,
        value_delivered_cents, volunteer_hours, volunteer_headcount, revenue_cents,
        donations_received, computed_at)
     VALUES (?, ?, ?, ?, 'month', ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT (org_id, period_kind, period_start) DO UPDATE SET
       diversion_lbs = excluded.diversion_lbs,
       items_rehomed = excluded.items_rehomed,
       value_delivered_cents = excluded.value_delivered_cents,
       volunteer_hours = excluded.volunteer_hours,
       volunteer_headcount = excluded.volunteer_headcount,
       revenue_cents = excluded.revenue_cents,
       donations_received = excluded.donations_received,
       computed_at = datetime('now')`,
    newId("impact"),
    orgId,
    periodStart,
    periodEnd,
    Number(totals?.diversion_lbs ?? 0),
    Number(totals?.items_rehomed ?? 0),
    Number(totals?.value_delivered ?? 0),
    Number(totals?.volunteer_hours ?? 0),
    Number(totals?.volunteer_headcount ?? 0),
    Number(totals?.revenue ?? 0),
    Number(totals?.donations ?? 0)
  );

  return 1;
}
