import type { Route } from "./+types/app.dashboard";
import { requireUser } from "../lib/auth";
import { first } from "../lib/db";
import { envFrom } from "../lib/env";
import { generateSignals, openSignals } from "../lib/nri/engine";
import { Compass, CompassAside } from "../components/Compass";
import { LinkButton, Stat, money } from "../components/ui";
import { DIVERTED_STATUS_SQL, lbsToTons } from "../lib/impact";

export function meta() {
  return [{ title: "Today | ThriftOS" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = envFrom(context);
  const user = await requireUser(request, env.DB);

  // Independent reads, so never serialize them.
  const [today, inventory, monthImpact, signalCount] = await Promise.all([
    first<{ sales: number; revenue: number }>(
      env.DB,
      `SELECT COUNT(*) AS sales, COALESCE(SUM(total_cents), 0) AS revenue
         FROM transactions
        WHERE org_id = ? AND voided_at IS NULL AND date(created_at) = date('now')`,
      user.orgId
    ),
    first<{ available: number; intake_today: number }>(
      env.DB,
      `SELECT
         (SELECT COUNT(*) FROM items WHERE org_id = ?1 AND status = 'available') AS available,
         (SELECT COUNT(*) FROM items WHERE org_id = ?1 AND date(created_at) = date('now')) AS intake_today`,
      user.orgId
    ),
    first<{ diversion_lbs: number; volunteer_hours: number; donations: number }>(
      env.DB,
      `SELECT
         COALESCE((SELECT SUM(weight_lbs) FROM items
                    WHERE org_id = ?1 AND status IN (${DIVERTED_STATUS_SQL})), 0) AS diversion_lbs,
         COALESCE((SELECT SUM(hours_logged) FROM shifts
                    WHERE org_id = ?1 AND status = 'completed'
                      AND starts_at >= date('now','start of month')), 0) AS volunteer_hours,
         (SELECT COUNT(*) FROM donations
           WHERE org_id = ?1 AND received_at >= date('now','start of month')) AS donations`,
      user.orgId
    ),
    first<{ n: number }>(
      env.DB,
      `SELECT COUNT(*) AS n FROM nri_signals WHERE org_id = ?`,
      user.orgId
    ),
  ]);

  // A brand-new shop has never had the weekly cron run. Generate once so the
  // Compass isn't mysteriously blank on day one.
  if (Number(signalCount?.n ?? 0) === 0) {
    await generateSignals(env.DB, user.orgId);
  }

  const signals = await openSignals(env.DB, user.orgId);

  return {
    firstName: user.name.split(" ")[0],
    signals,
    stats: {
      salesToday: Number(today?.sales ?? 0),
      revenueToday: Number(today?.revenue ?? 0),
      available: Number(inventory?.available ?? 0),
      intakeToday: Number(inventory?.intake_today ?? 0),
      diversionLbs: Number(monthImpact?.diversion_lbs ?? 0),
      volunteerHours: Number(monthImpact?.volunteer_hours ?? 0),
      donationsThisMonth: Number(monthImpact?.donations ?? 0),
    },
  };
}

export default function Dashboard({ loaderData }: Route.ComponentProps) {
  const { firstName, signals, stats } = loaderData;
  const tons = lbsToTons(stats.diversionLbs);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl text-bark">Hello, {firstName}</h1>
          <p className="mt-1 text-sm text-slate-soft">Here's where things stand today.</p>
        </div>
        <div className="flex gap-2">
          <LinkButton to="/app/intake">Log an item</LinkButton>
          <LinkButton to="/app/register" variant="secondary">
            Open the register
          </LinkButton>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Sales today"
          value={String(stats.salesToday)}
          hint={money(stats.revenueToday)}
        />
        <Stat
          label="On the floor"
          value={stats.available.toLocaleString("en-US")}
          hint={`${stats.intakeToday} logged today`}
        />
        <Stat
          label="Kept from landfill"
          value={tons >= 1 ? `${tons} tons` : `${Math.round(stats.diversionLbs)} lbs`}
          hint="All time"
          tone="moss"
        />
        <Stat
          label="Volunteer hours"
          value={String(Math.round(stats.volunteerHours))}
          hint="This month"
          tone="moss"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_18rem]">
        <section>
          <h2 className="font-display text-xl text-bark">The Compass</h2>
          <p className="mb-4 mt-1 text-sm text-slate-soft">
            What NRI noticed this week — recognized, gathered, and put in one place.
          </p>
          <Compass signals={signals} />
        </section>

        <CompassAside />
      </div>
    </div>
  );
}
