import { Link, useSearchParams } from "react-router";
import type { Route } from "./+types/app.money";
import { requireUser } from "../lib/auth";
import { envFrom } from "../lib/env";
import { all } from "../lib/db";
import { storeReport } from "../lib/ledger";
import { openDisputes } from "../lib/refunds";
import { Card, Notice, Stat, money } from "../components/ui";

export function meta() {
  return [{ title: "Money | ThriftOS" }];
}

/** Month boundaries in UTC. Reports are dated, not "last 30 days". */
function monthRange(offset = 0): { from: string; to: string; label: string } {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1));
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
  return {
    from: start.toISOString(),
    to: end.toISOString(),
    label: start.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }),
  };
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = envFrom(context);
  const user = await requireUser(request, env.DB);

  const url = new URL(request.url);
  const offset = Math.max(0, Math.min(11, parseInt(url.searchParams.get("back") ?? "0", 10) || 0));
  const range = monthRange(offset);

  const [report, disputes, recent] = await Promise.all([
    storeReport(env.DB, user.orgId, range.from, range.to),
    openDisputes(env.DB, user.orgId),
    all<{
      id: string;
      entry_type: string;
      amount_cents: number;
      occurred_at: string;
      source: string;
    }>(
      env.DB,
      `SELECT id, entry_type, amount_cents, occurred_at, source
         FROM ledger_entries
        WHERE org_id = ? AND occurred_at >= ? AND occurred_at < ?
        ORDER BY occurred_at DESC LIMIT 40`,
      user.orgId,
      range.from,
      range.to
    ),
  ]);

  return { report, disputes, recent, range, offset };
}

const ENTRY_LABELS: Record<string, string> = {
  gross_sale: "Card sale",
  cash_sale: "Cash sale",
  tax: "Sales tax",
  round_up: "Round-up donation",
  platform_fee: "ThriftOS fee",
  stripe_processing_fee: "Card processing",
  refund: "Refund",
  application_fee_refund: "ThriftOS fee returned",
  dispute: "Disputed payment",
  dispute_fee: "Dispute fee",
  cash_variance: "Drawer variance",
  transfer_reversal: "Transfer reversed",
  connected_account_transfer: "Paid out",
};

export default function Money({ loaderData }: Route.ComponentProps) {
  const { report, disputes, recent, range, offset } = loaderData;
  const [, setParams] = useSearchParams();

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl text-bark">Money</h1>
          <p className="mt-2 leading-relaxed text-slate-soft">
            Every figure here is a sum of recorded events, not a stored total. That's why each
            one can be traced to the sale, refund, or fee that produced it.
          </p>
        </div>
        <label className="text-sm">
          <span className="sr-only">Month</span>
          <select
            value={offset}
            onChange={(e) => setParams({ back: e.target.value })}
            className="touch-target rounded-xl border border-line bg-white px-3 py-2 text-bark outline-none focus:border-moss"
          >
            {Array.from({ length: 12 }, (_, i) => (
              <option key={i} value={i}>
                {monthRange(i).label}
              </option>
            ))}
          </select>
        </label>
      </header>

      {disputes.length > 0 ? (
        <Notice tone="warn">
          {disputes.length === 1 ? "A payment is" : `${disputes.length} payments are`} being
          disputed. Disputes have deadlines and one nobody answers is lost by default — see
          below.
        </Notice>
      ) : null}

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Net sales" value={money(report.netSalesCents)} hint={range.label} tone="moss" />
        <Stat label="Cash" value={money(report.cashCents)} hint="Already in the drawer" />
        <Stat label="Card" value={money(report.cardCents)} hint="Paid out by Stripe" />
        <Stat
          label="Expected payout"
          value={money(report.expectedPayoutCents)}
          hint="Card, less costs"
        />
      </section>

      <Card>
        <h2 className="font-display text-xl text-bark">Where the money went</h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-soft">
          The gap between what you sold and what lands in the bank, itemised. If these don't add
          up to your Stripe payout, something is wrong and worth telling us about.
        </p>
        <dl className="mt-5 divide-y divide-line">
          <Row label="Gross sales" value={report.grossSalesCents} />
          <Row label="Refunds" value={report.refundsCents} />
          <Row label="Sales tax collected" value={report.taxCents} hint="Owed to the state, not yours" />
          <Row label="Round-up donations" value={report.roundUpCents} />
          <Row label="ThriftOS platform fee" value={report.platformFeesCents} />
          <Row label="Card processing" value={report.stripeFeesCents} hint="Stripe's cut" />
          {report.disputesCents !== 0 ? (
            <Row label="Disputes" value={report.disputesCents} />
          ) : null}
        </dl>
      </Card>

      {disputes.length > 0 ? (
        <Card>
          <h2 className="font-display text-xl text-bark">Disputed payments</h2>
          <p className="mt-2 text-sm leading-relaxed text-slate-soft">
            A customer's bank has pulled a payment back. The goods aren't returned to your
            inventory, because the customer still has them — this is an argument about payment,
            not a return.
          </p>
          <ul className="mt-4 divide-y divide-line">
            {disputes.map((d) => (
              <li key={d.id} className="flex flex-wrap items-baseline justify-between gap-2 py-3">
                <div className="min-w-0">
                  <p className="font-medium text-bark">
                    {money(d.amount_cents)} · {(d.reason ?? "no reason given").replace(/_/g, " ")}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-soft">
                    {d.status.replace(/_/g, " ")}
                    {d.evidence_due_at
                      ? ` · respond by ${new Date(d.evidence_due_at).toLocaleDateString()}`
                      : ""}
                  </p>
                </div>
                {d.transaction_id ? (
                  <Link
                    to={`/app/sales/${d.transaction_id}`}
                    className="text-sm text-moss underline underline-offset-2"
                  >
                    See the sale
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <section className="border-t border-line pt-8">
        <h2 className="font-display text-xl text-bark">Recent entries</h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-soft">
          The raw ledger. Nothing here is ever edited or deleted — a correction is a new entry
          in the opposite direction, exactly as a paper ledger would do it.
        </p>
        {recent.length === 0 ? (
          <p className="mt-4 text-sm text-slate-soft">Nothing recorded this month yet.</p>
        ) : (
          <ul className="mt-4 divide-y divide-line overflow-hidden rounded-xl border border-line bg-white">
            {recent.map((entry) => (
              <li key={entry.id} className="flex items-baseline justify-between gap-3 px-4 py-2.5">
                <span className="min-w-0">
                  <span className="font-medium text-bark">
                    {ENTRY_LABELS[entry.entry_type] ?? entry.entry_type.replace(/_/g, " ")}
                  </span>
                  <span className="ml-2 text-xs text-slate-soft">
                    {new Date(entry.occurred_at).toLocaleDateString()}
                    {entry.source === "stripe_webhook" ? " · from Stripe" : ""}
                  </span>
                </span>
                <span
                  className={`shrink-0 tabular-nums ${
                    entry.amount_cents < 0 ? "text-clay" : "text-bark"
                  }`}
                >
                  {entry.amount_cents < 0 ? "−" : ""}
                  {money(Math.abs(entry.amount_cents))}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Row({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5">
      <dt className="min-w-0">
        <span className="text-bark">{label}</span>
        {hint ? <span className="ml-2 text-xs text-slate-soft">{hint}</span> : null}
      </dt>
      <dd className={`shrink-0 tabular-nums ${value < 0 ? "text-clay" : "text-bark"}`}>
        {value < 0 ? "−" : ""}
        {money(Math.abs(value))}
      </dd>
    </div>
  );
}
