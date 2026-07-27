import { Form, Link, redirect, useNavigation } from "react-router";
import type { Route } from "./+types/app.welcome";
import { requireUser } from "../lib/auth";
import { envFrom } from "../lib/env";
import {
  dismissOnboarding,
  getOnboardingState,
  markStepDone,
  setOnboardingPath,
  type OnboardingPath,
} from "../lib/onboarding";
import { clearSampleData, loadSampleData, sampleDataSummary } from "../lib/sample-data";
import { Button, Card, Notice } from "../components/ui";
import { ToastFrom } from "../components/toast";

export function meta() {
  return [{ title: "Welcome | ThriftOS" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = envFrom(context);
  const user = await requireUser(request, env.DB);

  const [state, sample] = await Promise.all([
    getOnboardingState(env.DB, user.orgId),
    sampleDataSummary(env.DB, user.orgId),
  ]);

  return { state, sample, firstName: user.name.split(" ")[0], isDemo: user.isDemo };
}

export async function action({ request, context }: Route.ActionArgs) {
  const env = envFrom(context);
  const user = await requireUser(request, env.DB);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  // The demo shop is shared and resets weekly. Letting a visitor load or clear
  // data in it would break it for whoever looks next.
  if (user.isDemo && intent !== "path") {
    return { error: "The demo shop can't be changed — set up your own shop to try this." };
  }

  if (intent === "path") {
    const path = String(form.get("path") ?? "") as OnboardingPath;
    if (!["new", "migrating", "exploring"].includes(path)) {
      return { error: "Pick one of the three to carry on." };
    }
    await setOnboardingPath(env.DB, user.orgId, path);
    if (path === "migrating") return redirect("/app/import");
    return { ok: true };
  }

  if (intent === "load-sample") {
    try {
      const result = await loadSampleData(env.DB, user.orgId, user.id);
      return { ok: true, loaded: result };
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Could not load the sample data." };
    }
  }

  if (intent === "clear-sample") {
    const { cleared } = await clearSampleData(env.DB, user.orgId);
    return { ok: true, cleared };
  }

  if (intent === "mark-step") {
    await markStepDone(env.DB, user.orgId, String(form.get("step") ?? ""));
    return { ok: true };
  }

  if (intent === "dismiss") {
    await dismissOnboarding(env.DB, user.orgId);
    return redirect("/app");
  }

  return { error: "That action isn't one we know." };
}

const PATHS: { id: OnboardingPath; title: string; body: string; cta: string }[] = [
  {
    id: "migrating",
    title: "We're moving from another system",
    body: "Bring your people, donation history, and current stock across from a CSV. You'll see a preview of exactly what will be created before anything is written, and the whole import can be undone in one click.",
    cta: "Start importing",
  },
  {
    id: "new",
    title: "We're setting up a new shop",
    body: "A short checklist that gets you to real data in about twenty minutes: confirm your details, log twenty items, ring up a sale. No card setup needed — cash works straight away.",
    cta: "Show me the checklist",
  },
  {
    id: "exploring",
    title: "We're just having a look",
    body: "Load a set of clearly-labelled sample records so every screen has something on it, then remove every trace when you're done. Nothing here counts toward your reports or your bill.",
    cta: "Load sample data",
  },
];

export default function Welcome({ loaderData, actionData }: Route.ComponentProps) {
  const { state, sample, firstName, isDemo } = loaderData;
  const nav = useNavigation();
  const busy = nav.state !== "idle";

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <header>
        <h1 className="font-display text-3xl text-bark">Welcome, {firstName}.</h1>
        <p className="mt-3 text-lg leading-relaxed text-slate-soft">
          An empty shop can't tell you anything, so the point of this page is to get real
          numbers on your screens as fast as honestly possible.
        </p>
      </header>

      <ToastFrom data={actionData} />

      {isDemo ? (
        <Notice tone="info">
          You're in the shared demo shop, so nothing here can be changed.{" "}
          <Link to="/signup" className="font-medium text-moss underline underline-offset-2">
            Set up your own shop
          </Link>{" "}
          to work through this properly.
        </Notice>
      ) : null}

      {!state.path ? (
        <section className="space-y-4">
          <h2 className="font-display text-xl text-bark">Which of these is you?</h2>
          {PATHS.map((path) => (
            <Card key={path.id}>
              <h3 className="font-display text-lg text-bark">{path.title}</h3>
              <p className="mt-2 leading-relaxed text-slate-soft">{path.body}</p>
              <Form method="post" className="mt-4">
                <input type="hidden" name="intent" value="path" />
                <input type="hidden" name="path" value={path.id} />
                <Button type="submit" disabled={busy}>
                  {path.cta}
                </Button>
              </Form>
            </Card>
          ))}
          <p className="text-sm leading-relaxed text-slate-soft">
            You can change your mind later — none of these locks anything.
          </p>
        </section>
      ) : (
        <>
          <ProgressBar done={state.completedCount} total={state.totalCount} />

          {state.path === "exploring" ? (
            <SamplePanel sample={sample} busy={busy} />
          ) : null}

          <section className="space-y-3">
            {state.steps.map((step) => (
              <Card key={step.id}>
                <div className="flex items-start gap-4">
                  <span
                    className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-medium ${
                      step.done ? "bg-moss text-white" : "bg-linen text-slate-soft"
                    }`}
                    aria-hidden="true"
                  >
                    {step.done ? "✓" : ""}
                  </span>
                  <div className="min-w-0 flex-1">
                    <h3
                      className={`font-medium ${step.done ? "text-slate-soft line-through" : "text-bark"}`}
                    >
                      {step.title}
                    </h3>
                    <p className="mt-1 text-sm leading-relaxed text-slate-soft">{step.detail}</p>

                    {!step.done ? (
                      <div className="mt-3 flex flex-wrap items-center gap-3">
                        <Link
                          to={step.href}
                          prefetch="intent"
                          className="rounded-lg bg-moss px-3 py-1.5 text-sm font-medium text-white hover:bg-moss-deep"
                        >
                          {step.cta}
                        </Link>
                        {!step.autoDetected ? (
                          <Form method="post">
                            <input type="hidden" name="intent" value="mark-step" />
                            <input type="hidden" name="step" value={step.id} />
                            <button
                              type="submit"
                              disabled={busy}
                              className="text-sm text-slate-soft underline underline-offset-2 hover:text-bark"
                            >
                              Already done
                            </button>
                          </Form>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </div>
              </Card>
            ))}
          </section>

          <footer className="flex flex-wrap items-center justify-between gap-4 border-t border-line pt-6">
            <p className="text-sm leading-relaxed text-slate-soft">
              Stuck on any of these?{" "}
              <Link
                to="/app/help?a=your-first-hour"
                className="text-moss underline underline-offset-2"
              >
                The first-hour guide
              </Link>{" "}
              covers each one in detail.
            </p>
            <Form method="post">
              <input type="hidden" name="intent" value="dismiss" />
              <button
                type="submit"
                disabled={busy}
                className="text-sm text-slate-soft underline underline-offset-2 hover:text-bark"
              >
                Hide this checklist
              </button>
            </Form>
          </footer>
        </>
      )}
    </div>
  );
}

function ProgressBar({ done, total }: { done: number; total: number }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <p className="text-sm font-medium text-bark">
          {done} of {total} done
        </p>
        {done === total && total > 0 ? (
          <p className="text-sm text-moss">Your shop is set up.</p>
        ) : null}
      </div>
      <div
        className="mt-2 h-2 overflow-hidden rounded-full bg-linen"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Setup progress"
      >
        <div
          className="h-full rounded-full bg-moss transition-[width] duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function SamplePanel({
  sample,
  busy,
}: {
  sample: { loadedAt: string; counts: Record<string, number> } | null;
  busy: boolean;
}) {
  if (!sample) {
    return (
      <Card>
        <h2 className="font-display text-xl text-bark">Fill the shop with sample records</h2>
        <p className="mt-2 leading-relaxed text-slate-soft">
          Ninety items across the colour rotation, ten people with donation histories, a few
          months of sales, and volunteer shifts. Enough for the dashboard, the inventory list,
          and the Compass to have something to say.
        </p>
        <ul className="mt-4 space-y-2 text-sm leading-relaxed text-slate-soft">
          <li className="flex gap-2.5">
            <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-moss" />
            Every record is named as a sample, and a banner sits across the app while any of it
            exists.
          </li>
          <li className="flex gap-2.5">
            <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-moss" />
            None of it reaches your impact report or your bill.
          </li>
          <li className="flex gap-2.5">
            <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-moss" />
            One button removes all of it and leaves anything real you've entered untouched.
          </li>
        </ul>
        <Form method="post" className="mt-5">
          <input type="hidden" name="intent" value="load-sample" />
          <Button type="submit" disabled={busy}>
            {busy ? "Loading…" : "Load sample data"}
          </Button>
        </Form>
      </Card>
    );
  }

  const total = Object.entries(sample.counts)
    .filter(([k]) => k !== "sample")
    .map(([k, v]) => `${v} ${k}`)
    .join(", ");

  return (
    <Card>
      <h2 className="font-display text-xl text-bark">Sample data is loaded</h2>
      <p className="mt-2 leading-relaxed text-slate-soft">
        {total || "Sample records"} — added {new Date(sample.loadedAt).toLocaleDateString()}. Have
        a look around: the{" "}
        <Link to="/app" className="text-moss underline underline-offset-2">
          dashboard
        </Link>
        , the{" "}
        <Link to="/app/inventory" className="text-moss underline underline-offset-2">
          inventory list
        </Link>
        , and the Compass all have something to show now.
      </p>
      <div className="mt-4 rounded-xl border border-clay/30 bg-clay/5 p-4">
        <p className="font-medium text-bark">Clear this before your first real trading day</p>
        <p className="mt-1 text-sm leading-relaxed text-slate-soft">
          It's already kept out of your impact report and your bill, but leaving invented items
          in your inventory list will confuse whoever is on the floor.
        </p>
        <Form method="post" className="mt-3">
          <input type="hidden" name="intent" value="clear-sample" />
          <Button type="submit" variant="secondary" disabled={busy}>
            {busy ? "Removing…" : "Remove all sample data"}
          </Button>
        </Form>
      </div>
    </Card>
  );
}
