import type { Route } from "./+types/app.impact";
import { requireUser } from "../lib/auth";
import { all, first } from "../lib/db";
import { envFrom } from "../lib/env";
import {
  impactNarrative,
  lbsToTons,
  VOLUNTEER_HOUR_VALUE_SOURCE,
  volunteerHoursValueCents,
  DIVERTED_STATUS_SQL,
  realOnly,
} from "../lib/impact";
import { rollupImpact } from "../cron/scheduled";
import { Card, Stat, money } from "../components/ui";

export function meta() {
  return [{ title: "Impact | ThriftOS" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = envFrom(context);
  const user = await requireUser(request, env.DB);


  // Keep the current month fresh rather than waiting for tonight's cron.
  await rollupImpact(env.DB, user.orgId);

  const [totals, months, org] = await Promise.all([
    first<{
      diversion_lbs: number;
      items_rehomed: number;
      value_delivered: number;
      volunteer_hours: number;
      volunteer_headcount: number;
      donations: number;
      revenue: number;
    }>(
      env.DB,
      `SELECT
         COALESCE((SELECT SUM(weight_lbs) FROM items
                    WHERE org_id = ?1 AND ${realOnly()}
                      AND status IN (${DIVERTED_STATUS_SQL})), 0) AS diversion_lbs,
         (SELECT COUNT(*) FROM items
           WHERE org_id = ?1 AND ${realOnly()} AND status = 'sold') AS items_rehomed,
         COALESCE((SELECT SUM(MAX(ti.retail_estimate_cents - ti.price_cents, 0))
                     FROM transaction_items ti JOIN transactions t ON t.id = ti.transaction_id
                    WHERE ti.org_id = ?1 AND ${realOnly("t")}
                      AND t.voided_at IS NULL), 0) AS value_delivered,
         COALESCE((SELECT SUM(hours_logged) FROM shifts
                    WHERE org_id = ?1 AND ${realOnly()}
                      AND status = 'completed'), 0) AS volunteer_hours,
         (SELECT COUNT(DISTINCT contact_id) FROM shifts
           WHERE org_id = ?1 AND ${realOnly()} AND status = 'completed') AS volunteer_headcount,
         (SELECT COUNT(*) FROM donations WHERE org_id = ?1 AND ${realOnly()}) AS donations,
         COALESCE((SELECT SUM(total_cents) FROM transactions
                    WHERE org_id = ?1 AND ${realOnly()}
                      AND voided_at IS NULL), 0) AS revenue`,
      user.orgId
    ),
    all<{
      period_start: string;
      diversion_lbs: number;
      items_rehomed: number;
      value_delivered_cents: number;
      volunteer_hours: number;
      revenue_cents: number;
      donations_received: number;
    }>(
      env.DB,
      `SELECT period_start, diversion_lbs, items_rehomed, value_delivered_cents,
              volunteer_hours, revenue_cents, donations_received
         FROM impact_metrics
        WHERE org_id = ? AND period_kind = 'month'
        ORDER BY period_start DESC LIMIT 24`,
      user.orgId
    ),
    first<{ name: string }>(env.DB, `SELECT name FROM orgs WHERE id = ?`, user.orgId),
  ]);

  // The CSV download lives at /api/impact.csv. It can't be served from here:
  // in framework mode a returned Response becomes loader data, and a thrown
  // 2xx lands in the error boundary — neither delivers a file.

  const shaped = {
    diversionLbs: Number(totals?.diversion_lbs ?? 0),
    itemsRehomed: Number(totals?.items_rehomed ?? 0),
    valueDeliveredCents: Number(totals?.value_delivered ?? 0),
    volunteerHours: Number(totals?.volunteer_hours ?? 0),
    volunteerHeadcount: Number(totals?.volunteer_headcount ?? 0),
    paidHours: 0,
    revenueCents: Number(totals?.revenue ?? 0),
    donationsReceived: Number(totals?.donations ?? 0),
  };

  return {
    orgName: org?.name ?? "Your shop",
    totals: shaped,
    months,
    narrative: impactNarrative(shaped, org?.name ?? "Your shop"),
  };
}

export default function Impact({ loaderData }: Route.ComponentProps) {
  const { totals, months, narrative, orgName } = loaderData;
  const tons = lbsToTons(totals.diversionLbs);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl text-bark">Impact</h1>
          <p className="mt-1 text-sm leading-relaxed text-slate-soft">
            The other half of the ledger. These come from the same records that run the
            register — nobody has to remember to log them separately.
          </p>
        </div>
        <a
          href="/api/impact.csv"
          className="touch-target inline-flex items-center rounded-xl border border-line bg-white px-5 py-3 text-sm font-medium text-bark hover:bg-linen"
        >
          Export CSV
        </a>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Kept from landfill"
          value={tons >= 1 ? `${tons} tons` : `${Math.round(totals.diversionLbs)} lbs`}
          tone="moss"
        />
        <Stat label="Items rehomed" value={totals.itemsRehomed.toLocaleString("en-US")} tone="moss" />
        <Stat
          label="Value delivered"
          value={money(totals.valueDeliveredCents)}
          hint="Retail comparison minus what shoppers paid"
          tone="moss"
        />
        <Stat
          label="Volunteer hours"
          value={Math.round(totals.volunteerHours).toLocaleString("en-US")}
          hint={`≈ ${money(volunteerHoursValueCents(totals.volunteerHours))}`}
          tone="moss"
        />
      </div>

      {narrative.length > 0 ? (
        <Card>
          <h2 className="font-display text-lg text-bark">In plain words</h2>
          <p className="mt-1 text-xs text-slate-soft">
            Copy this into a board packet or a grant application as-is.
          </p>
          <ul className="mt-3 space-y-2 text-sm leading-relaxed text-bark">
            {narrative.map((line) => (
              <li key={line}>· {line}</li>
            ))}
          </ul>
          <p className="mt-4 border-t border-line pt-3 text-xs leading-relaxed text-slate-soft">
            Volunteer hours are converted using {VOLUNTEER_HOUR_VALUE_SOURCE} — an external
            national figure, not a claim {orgName} is making about itself. Value delivered
            counts only items where a retail comparison was actually recorded; where none
            was, it contributes nothing rather than an estimate.
          </p>
        </Card>
      ) : null}

      {months.length > 0 ? (
        <div className="overflow-hidden rounded-2xl border border-line bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-line bg-linen/60 text-left">
              <tr>
                <th className="px-4 py-3 font-medium text-slate-soft">Month</th>
                <th className="px-4 py-3 text-right font-medium text-slate-soft">Diverted</th>
                <th className="px-4 py-3 text-right font-medium text-slate-soft">Rehomed</th>
                <th className="px-4 py-3 text-right font-medium text-slate-soft">Value delivered</th>
                <th className="px-4 py-3 text-right font-medium text-slate-soft">Volunteer hrs</th>
                <th className="px-4 py-3 text-right font-medium text-slate-soft">Revenue</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {months.map((m) => (
                <tr key={m.period_start}>
                  <td className="px-4 py-3 text-bark">{m.period_start.slice(0, 7)}</td>
                  <td className="px-4 py-3 text-right text-slate-soft">
                    {Math.round(m.diversion_lbs).toLocaleString("en-US")} lbs
                  </td>
                  <td className="px-4 py-3 text-right text-slate-soft">{m.items_rehomed}</td>
                  <td className="px-4 py-3 text-right text-slate-soft">
                    {money(m.value_delivered_cents)}
                  </td>
                  <td className="px-4 py-3 text-right text-slate-soft">
                    {Math.round(m.volunteer_hours)}
                  </td>
                  <td className="px-4 py-3 text-right text-slate-soft">{money(m.revenue_cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
