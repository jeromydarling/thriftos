import type { Route } from "./+types/app.dashboard";
import { requireUser } from "../lib/auth";
import { first } from "../lib/db";
import { envFrom } from "../lib/env";
import { generateSignals, openSignals } from "../lib/nri/engine";
import { Compass, CompassAside } from "../components/Compass";
import { LinkButton, Stat, money } from "../components/ui";
import { DIVERTED_STATUS_SQL, lbsToTons, realOnly } from "../lib/impact";
import { getOnboardingState } from "../lib/onboarding";
import { acknowledge, openAlerts } from "../lib/alerts";
import { Form, Link } from "react-router";

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
      // Impact figures, so they exclude sample data — these have to agree with
      // the impact report and the Compass to the pound. The operational counts
      // above deliberately don't exclude it: a shop exploring wants to see the
      // register and the inventory list behave.
      `SELECT
         COALESCE((SELECT SUM(weight_lbs) FROM items
                    WHERE org_id = ?1 AND ${realOnly()}
                      AND status IN (${DIVERTED_STATUS_SQL})), 0) AS diversion_lbs,
         COALESCE((SELECT SUM(hours_logged) FROM shifts
                    WHERE org_id = ?1 AND ${realOnly()} AND status = 'completed'
                      AND starts_at >= date('now','start of month')), 0) AS volunteer_hours,
         (SELECT COUNT(*) FROM donations
           WHERE org_id = ?1 AND ${realOnly()}
             AND received_at >= date('now','start of month')) AS donations`,
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
  const onboarding = await getOnboardingState(env.DB, user.orgId);
  const alerts = await openAlerts(env.DB, user.orgId, 10);

  return {
    firstName: user.name.split(" ")[0],
    signals,
    // Kept separate from NRI signals on purpose. The Compass notices things
    // worth thinking about; these are things that are broken. Mixing them
    // would teach people to skim both.
    alerts,
    // Shown until it's finished or the shop hides it. A checklist that keeps
    // congratulating a shop that's been trading for a year is noise.
    onboarding:
      onboarding.dismissed || onboarding.completed
        ? null
        : {
            path: onboarding.path,
            done: onboarding.completedCount,
            total: onboarding.totalCount,
            next: onboarding.nextStep
              ? {
                  title: onboarding.nextStep.title,
                  href: onboarding.nextStep.href,
                  cta: onboarding.nextStep.cta,
                }
              : null,
          },
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

export async function action({ request, context }: Route.ActionArgs) {
  const env = envFrom(context);
  const user = await requireUser(request, env.DB);
  const form = await request.formData();

  if (String(form.get("intent")) === "ack") {
    await acknowledge(env.DB, user.orgId, String(form.get("alertId") ?? ""), user.id);
  }
  return { ok: true };
}

export default function Dashboard({ loaderData }: Route.ComponentProps) {
  const { firstName, signals, stats, onboarding, alerts } = loaderData;
  const tons = lbsToTons(stats.diversionLbs);

  return (
    <div className="space-y-8">
      {alerts.length > 0 ? <Alerts alerts={alerts} /> : null}

      {onboarding ? <SetupPrompt onboarding={onboarding} /> : null}

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

/**
 * Things that are broken.
 *
 * Deliberately plain and slightly ugly. These aren't suggestions — each one is
 * something a person has to do, and dressing them up as gentle prompts would
 * be the wrong register entirely.
 */
function Alerts({
  alerts,
}: {
  alerts: {
    id: string;
    severity: string;
    title: string;
    body: string;
    href: string | null;
    acknowledged_at: string | null;
  }[];
}) {
  return (
    <section className="space-y-2">
      {alerts.map((alert) => (
        <div
          key={alert.id}
          className={`rounded-xl border p-4 ${
            alert.severity === "critical"
              ? "border-clay/40 bg-clay/5"
              : "border-line bg-white"
          }`}
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-medium text-bark">{alert.title}</p>
              <p className="mt-1 text-sm leading-relaxed text-slate-soft">{alert.body}</p>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              {alert.href ? (
                <Link
                  to={alert.href}
                  className="rounded-lg bg-moss px-3 py-1.5 text-sm font-medium text-white hover:bg-moss-deep"
                >
                  Look at it
                </Link>
              ) : null}
              {!alert.acknowledged_at ? (
                <Form method="post">
                  <input type="hidden" name="intent" value="ack" />
                  <input type="hidden" name="alertId" value={alert.id} />
                  <button
                    type="submit"
                    className="text-sm text-slate-soft underline underline-offset-2 hover:text-bark"
                  >
                    Seen it
                  </button>
                </Form>
              ) : null}
            </div>
          </div>
        </div>
      ))}
    </section>
  );
}

/**
 * The nudge back to setup.
 *
 * It shows one next step rather than the whole list, because a shop that opens
 * the app to ring up a customer doesn't need six outstanding tasks in its face.
 */
function SetupPrompt({
  onboarding,
}: {
  onboarding: {
    done: number;
    total: number;
    next: { title: string; href: string; cta: string } | null;
  };
}) {
  const pct = onboarding.total > 0 ? Math.round((onboarding.done / onboarding.total) * 100) : 0;

  return (
    <section className="rounded-2xl border border-moss/25 bg-moss/5 p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="font-display text-lg text-bark">
            {onboarding.next ? onboarding.next.title : "Finish setting up"}
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-slate-soft">
            {onboarding.done} of {onboarding.total} done. The rest of the setup is on the{" "}
            <Link to="/app/welcome" className="text-moss underline underline-offset-2">
              welcome page
            </Link>
            .
          </p>
        </div>
        {onboarding.next ? (
          <LinkButton to={onboarding.next.href}>{onboarding.next.cta}</LinkButton>
        ) : null}
      </div>

      <div
        className="mt-4 h-1.5 overflow-hidden rounded-full bg-white"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Setup progress"
      >
        <div className="h-full rounded-full bg-moss" style={{ width: `${pct}%` }} />
      </div>
    </section>
  );
}
