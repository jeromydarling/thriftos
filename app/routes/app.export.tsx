import type { Route } from "./+types/app.export";
import { requireUser } from "../lib/auth";
import { envFrom } from "../lib/env";
import { EXPORTS, exportCounts } from "../lib/export";
import { Card, Notice } from "../components/ui";

export function meta() {
  return [{ title: "Export your data | ThriftOS" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = envFrom(context);
  const user = await requireUser(request, env.DB);
  return { counts: await exportCounts(env.DB, user.orgId), orgName: user.orgName };
}

/**
 * The exit.
 *
 * Kept as its own screen rather than buried in settings, and reachable
 * whatever a shop's billing state is. If leaving is hard to find, "no lock-in"
 * is a slogan rather than a fact.
 */
export default function ExportPage({ loaderData }: Route.ComponentProps) {
  const { counts, orgName } = loaderData;
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <header>
        <h1 className="font-display text-3xl text-bark">Export your data</h1>
        <p className="mt-3 leading-relaxed text-slate-soft">
          Everything {orgName} has put into ThriftOS, in files any spreadsheet can open. No
          request, no waiting, no conversation with anyone first.
        </p>
      </header>

      <Card>
        <h2 className="font-display text-xl text-bark">Take all of it</h2>
        <p className="mt-2 leading-relaxed text-slate-soft">
          One archive with every file below, plus a note explaining what's in each one.{" "}
          {total.toLocaleString()} records.
        </p>
        <a
          href="/api/export/all"
          className="touch-target mt-4 inline-flex items-center rounded-xl bg-moss px-5 py-3 font-medium text-white hover:bg-moss-deep"
        >
          Download everything
        </a>
      </Card>

      <section>
        <h2 className="font-display text-xl text-bark">Or one thing at a time</h2>
        <ul className="mt-4 divide-y divide-line overflow-hidden rounded-xl border border-line bg-white">
          {EXPORTS.map((spec) => (
            <li key={spec.kind} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="font-medium text-bark">
                  {spec.label}{" "}
                  <span className="ml-1 text-xs font-normal text-slate-soft">
                    {counts[spec.kind].toLocaleString()}
                  </span>
                </p>
                <p className="mt-0.5 text-sm leading-relaxed text-slate-soft">
                  {spec.description}
                </p>
              </div>
              <a
                href={`/api/export/${spec.kind}`}
                className="shrink-0 text-sm text-moss underline underline-offset-2"
              >
                Download CSV
              </a>
            </li>
          ))}
        </ul>
      </section>

      <Notice tone="info">
        Money appears twice in every file: as exact integer cents, and as dollars with two
        decimals for reading. Where the two disagree, the cents are right. Sample data is never
        included — it was never yours.
      </Notice>

      <section className="border-t border-line pt-8">
        <h2 className="font-display text-lg text-bark">If you're leaving</h2>
        <p className="mt-2 leading-relaxed text-slate-soft">
          Take the archive first, then cancel — not the other way round. Exporting stays available
          whatever your billing situation, including a failed card, because holding a shop's own
          records hostage over an invoice isn't something we're willing to do. But taking the
          files while you still have the screen in front of you is simply easier.
        </p>
        <p className="mt-3 leading-relaxed text-slate-soft">
          If something you need isn't in here, tell us what it is. A gap in the export is our
          problem to fix, not a reason for you to stay.
        </p>
      </section>
    </div>
  );
}
