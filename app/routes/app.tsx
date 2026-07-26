import { Link, NavLink, Outlet } from "react-router";
import type { Route } from "./+types/app";
import { requireUser } from "../lib/auth";
import { envFrom } from "../lib/env";
import { sampleBatchId } from "../lib/onboarding";
import { openAlerts } from "../lib/alerts";
import { billingNotice, getEntitlements } from "../lib/entitlements";

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = envFrom(context);
  const user = await requireUser(request, env.DB);

  // Checked on every app page on purpose. Sample data is invented, and the one
  // thing that must never happen is somebody reading a number off a screen
  // without knowing that. A banner that's only on the dashboard isn't a
  // guarantee; this one is.
  const [hasSampleData, alerts, entitlements] = await Promise.all([
    sampleBatchId(env.DB, user.orgId).then((id) => id !== null),
    openAlerts(env.DB, user.orgId, 5),
    getEntitlements(env.DB, user.orgId),
  ]);

  // Only the critical ones interrupt. A warning belongs on the dashboard, not
  // across the top of the register while somebody is serving a customer.
  const critical = alerts.filter((a) => a.severity === "critical" && !a.acknowledged_at);

  return {
    hasSampleData,
    critical,
    billing: billingNotice(entitlements),
    user: {
      name: user.name,
      role: user.role,
      orgName: user.orgName,
      orgSlug: user.orgSlug,
      isDemo: user.isDemo,
    },
  };
}

const NAV = [
  { to: "/app", label: "Today", end: true },
  { to: "/app/intake", label: "Log an item" },
  { to: "/app/register", label: "Register" },
  { to: "/app/inventory", label: "Inventory" },
  { to: "/app/donations", label: "Donations" },
  { to: "/app/people", label: "People" },
  { to: "/app/volunteers", label: "Volunteers" },
  { to: "/app/drawer", label: "Drawer" },
  { to: "/app/money", label: "Money" },
  { to: "/app/impact", label: "Impact" },
  { to: "/app/settings", label: "Settings" },
];

export default function AppLayout({ loaderData }: Route.ComponentProps) {
  const { user, hasSampleData, critical, billing } = loaderData;

  return (
    <div className="min-h-screen bg-linen">
      {critical.length > 0 ? (
        <div className="bg-clay/15 px-4 py-2 text-center text-sm text-bark">
          <strong>{critical[0].title}.</strong> {critical[0].body}{" "}
          <Link
            to={critical[0].href ?? "/app"}
            className="font-medium text-moss underline underline-offset-2"
          >
            Sort it out
          </Link>
          {critical.length > 1 ? (
            <span className="text-slate-soft"> · and {critical.length - 1} more</span>
          ) : null}
        </div>
      ) : null}

      {billing ? (
        <div
          className={`px-4 py-2 text-center text-sm text-bark ${
            billing.tone === "warn" ? "bg-amber/25" : "bg-linen"
          }`}
        >
          {billing.text}{" "}
          <Link to={billing.href} className="font-medium text-moss underline underline-offset-2">
            Sort out billing
          </Link>
        </div>
      ) : null}

      {hasSampleData ? (
        <div className="bg-clay/15 px-4 py-2 text-center text-sm text-bark">
          Sample data is loaded, so some of what you see is invented. It's kept out of your
          impact report and your bill.{" "}
          <Link
            to="/app/welcome"
            className="font-medium text-moss underline underline-offset-2"
          >
            Remove it
          </Link>
        </div>
      ) : null}

      {user.isDemo ? (
        <div className="bg-amber/20 px-4 py-2 text-center text-sm text-bark">
          You're in the demo shop — poke at anything you like. It resets every Monday, and
          nothing here is real.{" "}
          <Link to="/signup" className="font-medium text-moss underline underline-offset-2">
            Set up your own
          </Link>
        </div>
      ) : null}

      <header className="border-b border-line bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <div className="min-w-0">
            <Link to="/app" className="font-display text-lg text-moss">
              ThriftOS
            </Link>
            <p className="truncate text-xs text-slate-soft">{user.orgName}</p>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="hidden text-slate-soft sm:inline">{user.name}</span>
            <Link
              to="/logout"
              className="rounded-lg border border-line px-3 py-1.5 text-slate-soft hover:bg-linen"
            >
              Sign out
            </Link>
          </div>
        </div>

        <nav className="mx-auto max-w-6xl overflow-x-auto px-4">
          <ul className="flex gap-1 pb-2">
            {NAV.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={item.end}
                  prefetch="intent"
                  className={({ isActive }) =>
                    `block whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition ${
                      isActive ? "bg-moss text-white" : "text-slate-soft hover:bg-linen hover:text-bark"
                    }`
                  }
                >
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8">
        <Outlet />
      </main>
    </div>
  );
}
