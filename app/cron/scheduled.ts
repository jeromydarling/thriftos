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
import type { AppEnv } from "../lib/env";
import { advanceAttempt, staleAttempts } from "../lib/attempts";
import { applyInventoryEffect, type PaymentState } from "../lib/payments";
import { getPaymentIntent, stateForIntent } from "../lib/stripe/terminal";
import { sweepAlerts } from "../lib/alerts";
import { pendingDomains, refreshDomain } from "../lib/domains";
import { releaseExpiredHolds } from "../lib/checkout";
import { HOLD_MINUTES } from "../lib/orders";

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

export async function runDaily(env: AppEnv): Promise<void> {
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

  // Payments nobody finished.
  //
  // A reader session that was abandoned — the customer walked off, the tablet
  // was closed — leaves an attempt in flight holding its items reserved. Those
  // items are unsellable until something notices, so something has to.
  //
  // Stripe is asked rather than assumed: an attempt that has actually
  // succeeded gets finalised, and only one that genuinely went nowhere is
  // released. Timing out a payment locally would eventually release items on a
  // sale that did go through.
  await record(db, "stale_payments", async () => {
    const stale = await staleAttempts(db, 30);
    let released = 0;
    let recovered = 0;

    for (const attempt of stale) {
      let state: PaymentState = "canceled";

      if (attempt.stripe_payment_intent_id && env.STRIPE_SECRET_KEY) {
        try {
          const intent = await getPaymentIntent(
            { secretKey: env.STRIPE_SECRET_KEY },
            attempt.stripe_payment_intent_id
          );
          state = stateForIntent(intent.status);
        } catch {
          // Stripe unreachable. Leave it alone rather than releasing goods on
          // a payment we can't ask about — it'll be swept again tomorrow.
          continue;
        }
        // Still genuinely in progress. Not stale, just slow.
        if (state === "processing" || state === "requires_action") continue;
      }

      await advanceAttempt(db, attempt.org_id, attempt.id, {
        state,
        failureMessage:
          state === "canceled" ? "Abandoned at the reader and swept automatically." : null,
      });
      await run(
        db,
        `UPDATE transactions SET payment_state = ? WHERE id = ? AND org_id = ?`,
        state,
        attempt.transaction_id,
        attempt.org_id
      );
      await applyInventoryEffect(db, attempt.org_id, attempt.transaction_id, state);

      if (state === "succeeded") recovered++;
      else released++;
    }

    return { swept: stale.length, released, recovered };
  });

  // Chase domains still waiting on DNS.
  //
  // A shop that added a CNAME on Tuesday evening shouldn't have to come back
  // and press a button to find out it worked. Skipped entirely when Cloudflare
  // for SaaS isn't configured, rather than logging a failure every night.
  if (env.CF_SAAS_API_TOKEN && env.CF_SAAS_ZONE_ID) {
    await record(db, "domain_check", async () => {
      const config = {
        apiToken: env.CF_SAAS_API_TOKEN!,
        zoneId: env.CF_SAAS_ZONE_ID!,
        cnameTarget: (env.APP_URL ?? "").replace(/^https?:\/\//, ""),
      };
      const waiting = await pendingDomains(db);
      let live = 0;
      for (const domain of waiting) {
        const fresh = await refreshDomain(db, config, domain);
        if (fresh.status === "active") live++;
      }
      return { checked: waiting.length, went_live: live };
    });
  }

  // Anything that needs a person. Runs last, so it sees the state the other
  // jobs left behind rather than the state they started from.
  await record(db, "alert_sweep", async () => sweepAlerts(db));

  // The demo must never be found empty by a visitor.
  await record(db, "demo_selfheal", async () => {
    const orgId = await ensureDemoSeeded(db);
    return { org_id: orgId };
  });
}

/**
 * The frequent pass. Minutes, not hours.
 *
 * Only one job lives here, and it has to: a checkout holds stock for fifteen
 * minutes, so a release that runs once a day would leave a coat off the rail
 * until tomorrow morning. A hold nobody clears is an item that has quietly
 * stopped being for sale — the same harm as selling it twice, arriving slowly,
 * and invisible because nothing looks broken.
 *
 * Deliberately not "run the daily jobs more often". Everything else in the
 * daily pass is expensive or writes reports, and running it every ten minutes
 * would be a way to spend money and confuse the run log.
 */
export async function runFrequent(env: AppEnv): Promise<void> {
  const db = env.DB;
  await record(db, "release_holds", async () => releaseExpiredHolds(db, HOLD_MINUTES));
}

export async function runWeekly(env: AppEnv): Promise<void> {
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
