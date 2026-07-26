import { Form, Link, useNavigation } from "react-router";
import type { Route } from "./+types/app.sale";
import { requireUser, roleAtLeast } from "../lib/auth";
import { envFrom } from "../lib/env";
import { all, first, run } from "../lib/db";
import { entriesForTransaction } from "../lib/ledger";
import { attemptsForTransaction } from "../lib/attempts";
import { ensureReceiptToken } from "../lib/receipts";
import { saleReceiptEmail, receiptByToken } from "../lib/receipts";
import { sendEmail } from "../lib/email";
import { planRefund, refundSale, RefundError } from "../lib/refunds";
import { Badge, Button, Card, Input, Notice, Stat, money } from "../components/ui";

export function meta() {
  return [{ title: "Sale | ThriftOS" }];
}

export async function loader({ params, request, context }: Route.LoaderArgs) {
  const env = envFrom(context);
  const user = await requireUser(request, env.DB);
  const id = params.id ?? "";

  const tx = await first<{
    id: string;
    created_at: string;
    subtotal_cents: number;
    tax_cents: number;
    roundup_cents: number;
    total_cents: number;
    refunded_cents: number;
    fee_refunded_cents: number;
    platform_fee_cents: number;
    stripe_fee_cents: number | null;
    tender: string;
    payment_state: string;
    voided_at: string | null;
    receipt_token: string | null;
    receipt_email: string | null;
    receipt_sent_at: string | null;
    cashier: string | null;
  }>(
    env.DB,
    `SELECT t.id, t.created_at, t.subtotal_cents, t.tax_cents, t.roundup_cents, t.total_cents,
            t.refunded_cents, t.fee_refunded_cents, t.platform_fee_cents, t.stripe_fee_cents,
            t.tender, t.payment_state, t.voided_at, t.receipt_token, t.receipt_email,
            t.receipt_sent_at, u.name AS cashier
       FROM transactions t
       LEFT JOIN users u ON u.id = t.cashier_user_id
      WHERE t.id = ? AND t.org_id = ?`,
    id,
    user.orgId
  );

  if (!tx) throw new Response("No such sale", { status: 404 });

  const [lines, ledger, attempts, refunds] = await Promise.all([
    all<{
      item_id: string | null;
      title: string;
      price_cents: number;
      markdown_cents: number;
      refunded_cents: number;
      fulfillment_state: string | null;
    }>(
      env.DB,
      `SELECT item_id, title, price_cents, markdown_cents, refunded_cents, fulfillment_state
         FROM transaction_items WHERE transaction_id = ? AND org_id = ? ORDER BY created_at, id`,
      id,
      user.orgId
    ),
    entriesForTransaction(env.DB, user.orgId, id),
    attemptsForTransaction(env.DB, user.orgId, id),
    all<{
      id: string;
      amount_cents: number;
      fee_refund_cents: number;
      reason: string | null;
      status: string;
      tender: string;
      created_at: string;
    }>(
      env.DB,
      `SELECT id, amount_cents, fee_refund_cents, reason, status, tender, created_at
         FROM refunds WHERE transaction_id = ? AND org_id = ? ORDER BY created_at DESC`,
      id,
      user.orgId
    ),
  ]);

  const refundable = tx.subtotal_cents + tx.tax_cents - tx.refunded_cents;

  return {
    tx,
    lines,
    ledger,
    attempts,
    refunds,
    refundable,
    canRefund: roleAtLeast(user.role, "staff"),
    appUrl: env.APP_URL ?? "",
  };
}

export async function action({ params, request, context }: Route.ActionArgs) {
  const env = envFrom(context);
  const user = await requireUser(request, env.DB);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const id = params.id ?? "";

  if (intent === "receipt") {
    const token = await ensureReceiptToken(env.DB, user.orgId, id);
    if (!token) return { error: "That sale doesn't exist." };

    const email = String(form.get("email") ?? "").trim();
    if (!email) return { ok: true, receiptUrl: `/r/${token}` };

    const receipt = await receiptByToken(env.DB, token);
    if (!receipt) return { error: "We couldn't build that receipt." };

    const url = `${env.APP_URL ?? ""}/r/${token}`;
    const message = saleReceiptEmail({ receipt, receiptUrl: url });
    const result = await sendEmail(env, {
      to: email,
      subject: message.subject,
      html: message.html,
      text: message.text,
      orgId: user.orgId,
      template: "sale_receipt",
    });

    await run(
      env.DB,
      `UPDATE transactions SET receipt_email = ?, receipt_sent_at = CASE WHEN ? = 1 THEN datetime('now') ELSE receipt_sent_at END
        WHERE id = ? AND org_id = ?`,
      email,
      result.sent ? 1 : 0,
      id,
      user.orgId
    );

    return result.sent
      ? { ok: true, sent: email, receiptUrl: `/r/${token}` }
      : { error: `We couldn't send that: ${result.reason}`, receiptUrl: `/r/${token}` };
  }

  if (intent === "refund") {
    if (!roleAtLeast(user.role, "staff")) {
      return { error: "Refunds need a staff member or a manager." };
    }

    const dollars = Number(String(form.get("amount") ?? "").replace(/[$,\s]/g, ""));
    if (!Number.isFinite(dollars) || dollars <= 0) {
      return { error: "Enter the amount to refund." };
    }

    try {
      const result = await refundSale(
        env.DB,
        {
          orgId: user.orgId,
          transactionId: id,
          amountCents: Math.round(dollars * 100),
          reason: String(form.get("reason") ?? "").trim() || undefined,
          restock: form.get("restock") === "on",
          itemIds: form.getAll("itemId").map(String).filter(Boolean),
          userId: user.id,
        },
        env.STRIPE_SECRET_KEY ? { secretKey: env.STRIPE_SECRET_KEY } : null
      );
      return { ok: true, refunded: result.amountCents, feeReturned: result.feeRefundCents };
    } catch (err) {
      if (err instanceof RefundError) return { error: err.message };
      throw err;
    }
  }

  if (intent === "preview-refund") {
    const dollars = Number(String(form.get("amount") ?? "").replace(/[$,\s]/g, ""));
    try {
      const plan = await planRefund(env.DB, {
        orgId: user.orgId,
        transactionId: id,
        amountCents: Math.round((Number.isFinite(dollars) ? dollars : 0) * 100),
      });
      return { ok: true, plan };
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Couldn't work that out." };
    }
  }

  return { error: "That action isn't one we know." };
}

const STATE_TONE: Record<string, string> = {
  succeeded: "#2F6F5E",
  partially_refunded: "#B8860B",
  refunded: "#B8543F",
  disputed: "#B8543F",
  failed: "#B8543F",
  canceled: "#6B7280",
};

export default function Sale({ loaderData, actionData }: Route.ComponentProps) {
  const { tx, lines, ledger, attempts, refunds, refundable, canRefund } = loaderData;
  const nav = useNavigation();
  const busy = nav.state !== "idle";
  const receiptUrl =
    actionData && "receiptUrl" in actionData
      ? actionData.receiptUrl
      : tx.receipt_token
        ? `/r/${tx.receipt_token}`
        : null;

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl text-bark">{money(tx.total_cents)}</h1>
          <p className="mt-1 text-sm text-slate-soft">
            {new Date(tx.created_at).toLocaleString()} · {tx.tender}
            {tx.cashier ? ` · ${tx.cashier}` : ""}
          </p>
        </div>
        <Badge color={STATE_TONE[tx.payment_state] ?? "#6B7280"}>
          {tx.payment_state.replace(/_/g, " ")}
        </Badge>
      </header>

      {actionData && "error" in actionData && actionData.error ? (
        <Notice tone="warn">{actionData.error}</Notice>
      ) : null}
      {actionData && "sent" in actionData && actionData.sent ? (
        <Notice tone="good">Receipt sent to {actionData.sent}.</Notice>
      ) : null}
      {actionData && "refunded" in actionData && actionData.refunded ? (
        <Notice tone="good">
          Refunded {money(actionData.refunded)}
          {actionData.feeReturned > 0
            ? `, including ${money(actionData.feeReturned)} of our fee returned to you.`
            : "."}
        </Notice>
      ) : null}

      <Card>
        <h2 className="font-display text-xl text-bark">What was sold</h2>
        <table className="mt-4 w-full text-sm">
          <tbody className="divide-y divide-line">
            {lines.map((line, i) => (
              <tr key={i}>
                <td className="py-2 pr-3">
                  {line.title}
                  {line.refunded_cents > 0 ? (
                    <span className="ml-2 text-xs text-clay">refunded</span>
                  ) : null}
                  {line.fulfillment_state === "unfulfilled" ? (
                    <span className="ml-2 text-xs text-clay">not handed over</span>
                  ) : null}
                </td>
                <td className="py-2 text-right tabular-nums text-slate-soft">
                  {money(line.price_cents)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <dl className="mt-4 space-y-1 border-t border-line pt-4 text-sm">
          <Row label="Subtotal" cents={tx.subtotal_cents} />
          {tx.tax_cents > 0 ? <Row label="Sales tax" cents={tx.tax_cents} /> : null}
          {tx.roundup_cents > 0 ? <Row label="Round-up" cents={tx.roundup_cents} /> : null}
          <Row label="Total" cents={tx.total_cents} strong />
          {tx.refunded_cents > 0 ? <Row label="Refunded" cents={-tx.refunded_cents} /> : null}
        </dl>
      </Card>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Our fee" value={money(tx.platform_fee_cents)} hint="Charged on merchandise" />
        <Stat
          label="Card processing"
          value={tx.stripe_fee_cents === null ? "—" : money(tx.stripe_fee_cents)}
          hint={tx.stripe_fee_cents === null ? "Not reported yet" : "Stripe's cut"}
        />
        <Stat label="Still refundable" value={money(Math.max(0, refundable))} />
      </div>

      <Card>
        <h2 className="font-display text-xl text-bark">Receipt</h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-soft">
          A customer disputing a card payment is answered with a receipt. It's worth sending one
          even when nobody asks.
        </p>
        <Form method="post" className="mt-4 flex flex-wrap items-end gap-3">
          <input type="hidden" name="intent" value="receipt" />
          <div className="min-w-[16rem] flex-1">
            <label htmlFor="email" className="block text-sm font-medium text-bark">
              Email it to
            </label>
            <Input
              id="email"
              name="email"
              type="email"
              placeholder="Optional"
              defaultValue={tx.receipt_email ?? ""}
              className="mt-1"
            />
          </div>
          <Button type="submit" variant="secondary" disabled={busy}>
            {busy ? "Sending…" : "Send receipt"}
          </Button>
        </Form>
        {receiptUrl ? (
          <p className="mt-3 text-sm">
            <a
              href={receiptUrl}
              target="_blank"
              rel="noreferrer"
              className="text-moss underline underline-offset-2"
            >
              Open the printable receipt
            </a>
            {tx.receipt_sent_at
              ? ` · last sent ${new Date(tx.receipt_sent_at).toLocaleDateString()}`
              : ""}
          </p>
        ) : null}
      </Card>

      {refundable > 0 && !tx.voided_at ? (
        <Card>
          <h2 className="font-display text-xl text-bark">Refund</h2>
          {!canRefund ? (
            <p className="mt-2 text-sm leading-relaxed text-slate-soft">
              Refunds need a staff member or a manager. Ask whoever is on today.
            </p>
          ) : (
            <>
              <p className="mt-2 text-sm leading-relaxed text-slate-soft">
                Our fee comes back with it, proportionally. Up to{" "}
                {money(refundable)} can still be returned on this sale — the round-up isn't
                included, because it was a donation the customer chose to make.
              </p>
              <Form method="post" className="mt-4 space-y-3">
                <input type="hidden" name="intent" value="refund" />
                <div className="flex flex-wrap items-end gap-3">
                  <div>
                    <label htmlFor="amount" className="block text-sm font-medium text-bark">
                      Amount
                    </label>
                    <Input
                      id="amount"
                      name="amount"
                      inputMode="decimal"
                      defaultValue={(refundable / 100).toFixed(2)}
                      className="mt-1 w-32"
                    />
                  </div>
                  <div className="min-w-[14rem] flex-1">
                    <label htmlFor="reason" className="block text-sm font-medium text-bark">
                      Why
                    </label>
                    <Input id="reason" name="reason" placeholder="Torn lining" className="mt-1" />
                  </div>
                </div>

                {lines.some((l) => l.item_id) ? (
                  <fieldset className="rounded-xl border border-line p-3">
                    <legend className="px-1 text-sm font-medium text-bark">
                      Put back on the floor
                    </legend>
                    <label className="flex gap-2 text-sm text-slate-soft">
                      <input type="checkbox" name="restock" defaultChecked className="mt-0.5" />
                      <span>The goods came back</span>
                    </label>
                    <div className="mt-2 space-y-1">
                      {lines
                        .filter((l) => l.item_id && l.refunded_cents === 0)
                        .map((line) => (
                          <label key={line.item_id} className="flex gap-2 text-sm text-slate-soft">
                            <input
                              type="checkbox"
                              name="itemId"
                              value={line.item_id!}
                              defaultChecked
                              className="mt-0.5"
                            />
                            <span>{line.title}</span>
                          </label>
                        ))}
                    </div>
                  </fieldset>
                ) : null}

                <Button type="submit" disabled={busy}>
                  {busy ? "Refunding…" : "Refund"}
                </Button>
              </Form>
            </>
          )}
        </Card>
      ) : null}

      {refunds.length > 0 ? (
        <section>
          <h2 className="font-display text-xl text-bark">Refunds on this sale</h2>
          <ul className="mt-3 divide-y divide-line overflow-hidden rounded-xl border border-line bg-white">
            {refunds.map((r) => (
              <li key={r.id} className="flex items-baseline justify-between gap-3 px-4 py-2.5 text-sm">
                <span>
                  <span className="font-medium text-bark">{money(r.amount_cents)}</span>
                  <span className="ml-2 text-slate-soft">
                    {r.reason || "no reason given"} · {r.tender} · {r.status}
                  </span>
                </span>
                <span className="text-xs text-slate-soft">
                  {new Date(r.created_at).toLocaleDateString()}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {attempts.length > 0 ? (
        <section>
          <h2 className="font-display text-xl text-bark">Payment attempts</h2>
          <p className="mt-2 text-sm leading-relaxed text-slate-soft">
            Every try at collecting this money, including the ones that failed. A declined card
            followed by a successful one is two rows, not a mystery.
          </p>
          <ul className="mt-3 divide-y divide-line overflow-hidden rounded-xl border border-line bg-white">
            {attempts.map((a) => (
              <li key={a.id} className="px-4 py-2.5 text-sm">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-medium text-bark">
                    Attempt {a.attempt_number} · {a.state.replace(/_/g, " ")}
                  </span>
                  <span className="text-xs text-slate-soft">
                    {new Date(a.created_at).toLocaleString()}
                  </span>
                </div>
                {a.failure_message ? (
                  <p className="mt-0.5 text-xs text-clay">{a.failure_message}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section>
        <h2 className="font-display text-xl text-bark">In the books</h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-soft">
          Every ledger entry this sale produced. This is the answer to "why is my payout different
          from my sales" for this one transaction.
        </p>
        {ledger.length === 0 ? (
          <p className="mt-3 text-sm text-slate-soft">
            Nothing posted yet — a card sale posts once Stripe confirms it.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-line overflow-hidden rounded-xl border border-line bg-white">
            {ledger.map((entry) => (
              <li
                key={entry.id}
                className="flex items-baseline justify-between gap-3 px-4 py-2 text-sm"
              >
                <span className="text-bark">{entry.entry_type.replace(/_/g, " ")}</span>
                <span
                  className={`tabular-nums ${entry.amount_cents < 0 ? "text-clay" : "text-bark"}`}
                >
                  {entry.amount_cents < 0 ? "−" : ""}
                  {money(Math.abs(entry.amount_cents))}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="text-sm">
        <Link to="/app/money" className="text-moss underline underline-offset-2">
          Back to Money
        </Link>
      </p>
    </div>
  );
}

function Row({ label, cents, strong }: { label: string; cents: number; strong?: boolean }) {
  return (
    <div className={`flex justify-between ${strong ? "border-t border-line pt-2 font-medium" : ""}`}>
      <dt className={strong ? "text-bark" : "text-slate-soft"}>{label}</dt>
      <dd className={`tabular-nums ${cents < 0 ? "text-clay" : "text-bark"}`}>
        {cents < 0 ? "−" : ""}
        {money(Math.abs(cents))}
      </dd>
    </div>
  );
}
