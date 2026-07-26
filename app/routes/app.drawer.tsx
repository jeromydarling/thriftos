import { Form, useNavigation } from "react-router";
import type { Route } from "./+types/app.drawer";
import { requireUser } from "../lib/auth";
import { envFrom } from "../lib/env";
import {
  closeShift,
  ensureDefaultRegister,
  openShift,
  openShiftFor,
  recentShifts,
  recordCashMovement,
  shiftTotals,
  ShiftAlreadyOpenError,
} from "../lib/shifts-cash";
import { Button, Card, Input, Notice, Stat, money } from "../components/ui";

export function meta() {
  return [{ title: "Cash drawer | ThriftOS" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = envFrom(context);
  const user = await requireUser(request, env.DB);

  const registerId = await ensureDefaultRegister(env.DB, user.orgId);
  const shift = await openShiftFor(env.DB, user.orgId, registerId);

  return {
    registerId,
    shift,
    totals: shift ? await shiftTotals(env.DB, user.orgId, shift.id) : null,
    history: await recentShifts(env.DB, user.orgId, 15),
  };
}

/** Dollars in a text field → integer cents. Everything downstream is cents. */
function centsFrom(form: FormData, field: string): number {
  const raw = String(form.get(field) ?? "").replace(/[$,\s]/g, "");
  const value = Number(raw);
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100);
}

export async function action({ request, context }: Route.ActionArgs) {
  const env = envFrom(context);
  const user = await requireUser(request, env.DB);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "open") {
    try {
      await openShift(env.DB, {
        orgId: user.orgId,
        registerId: String(form.get("registerId") ?? "") || null,
        userId: user.id,
        openingFloatCents: centsFrom(form, "openingFloat"),
      });
      return { ok: true };
    } catch (err) {
      if (err instanceof ShiftAlreadyOpenError) return { error: err.message };
      throw err;
    }
  }

  if (intent === "movement") {
    try {
      await recordCashMovement(env.DB, {
        orgId: user.orgId,
        shiftId: String(form.get("shiftId") ?? ""),
        kind: String(form.get("kind") ?? "pay_out") as "pay_in" | "pay_out" | "drop",
        amountCents: centsFrom(form, "amount"),
        reason: String(form.get("reason") ?? ""),
        userId: user.id,
      });
      return { ok: true };
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Couldn't record that." };
    }
  }

  if (intent === "close") {
    const result = await closeShift(env.DB, {
      orgId: user.orgId,
      shiftId: String(form.get("shiftId") ?? ""),
      userId: user.id,
      countedCents: centsFrom(form, "counted"),
      note: String(form.get("note") ?? "") || null,
    });
    return { ok: true, closed: { varianceCents: result.varianceCents, totals: result.totals } };
  }

  return { error: "That action isn't one we know." };
}

export default function Drawer({ loaderData, actionData }: Route.ComponentProps) {
  const { registerId, shift, totals, history } = loaderData;
  const nav = useNavigation();
  const busy = nav.state !== "idle";
  const closed = actionData && "closed" in actionData ? actionData.closed : null;

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <header>
        <h1 className="font-display text-3xl text-bark">Cash drawer</h1>
        <p className="mt-2 leading-relaxed text-slate-soft">
          Count the float in, sell things, count the drawer out. The difference is the variance —
          the most useful number a shop has, and one that's only meaningful if the count is
          honest rather than adjusted to match.
        </p>
      </header>

      {actionData && "error" in actionData && actionData.error ? (
        <Notice tone="warn">{actionData.error}</Notice>
      ) : null}

      {closed ? (
        <Notice tone={closed.varianceCents === 0 ? "good" : "warn"}>
          {closed.varianceCents === 0
            ? "Drawer closed and balanced exactly."
            : `Drawer closed ${closed.varianceCents > 0 ? "over" : "short"} by ${money(
                Math.abs(closed.varianceCents)
              )}. It's recorded as its own line in the books rather than hidden in sales.`}
        </Notice>
      ) : null}

      {shift && totals ? (
        <OpenDrawer shift={shift} totals={totals} busy={busy} />
      ) : (
        <Card>
          <h2 className="font-display text-xl text-bark">Open the drawer</h2>
          <p className="mt-2 leading-relaxed text-slate-soft">
            Count the float before you start. It's the only number in the day that nobody can
            reconstruct afterwards.
          </p>
          <Form method="post" className="mt-5 flex flex-wrap items-end gap-3">
            <input type="hidden" name="intent" value="open" />
            <input type="hidden" name="registerId" value={registerId} />
            <div>
              <label htmlFor="openingFloat" className="block text-sm font-medium text-bark">
                Opening float
              </label>
              <Input
                id="openingFloat"
                name="openingFloat"
                inputMode="decimal"
                placeholder="150.00"
                defaultValue="150.00"
                className="mt-1 w-40"
              />
            </div>
            <Button type="submit" disabled={busy}>
              Open drawer
            </Button>
          </Form>
        </Card>
      )}

      {history.length > 0 ? <History history={history} /> : null}
    </div>
  );
}

function OpenDrawer({
  shift,
  totals,
  busy,
}: {
  shift: { id: string; opening_float_cents: number; opened_at: string };
  totals: {
    cashSalesCents: number;
    cashRefundsCents: number;
    cardSalesCents: number;
    payInsCents: number;
    payOutsCents: number;
    dropsCents: number;
    transactionCount: number;
    expectedCents: number;
  };
  busy: boolean;
}) {
  return (
    <>
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Expected in drawer" value={money(totals.expectedCents)} tone="moss" />
        <Stat
          label="Cash sales"
          value={money(totals.cashSalesCents)}
          hint={`${totals.transactionCount} sales`}
        />
        <Stat
          label="Card sales"
          value={money(totals.cardSalesCents)}
          hint="Not in the drawer"
        />
        <Stat label="Opening float" value={money(shift.opening_float_cents)} />
      </section>

      {totals.payInsCents + totals.payOutsCents + totals.dropsCents > 0 ? (
        <p className="text-sm leading-relaxed text-slate-soft">
          Also counted: {money(totals.payInsCents)} paid in, {money(totals.payOutsCents)} paid
          out, {money(totals.dropsCents)} dropped to the safe.
        </p>
      ) : null}

      <Card>
        <h2 className="font-display text-xl text-bark">Money in or out</h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-soft">
          Anything that isn't a sale — buying stamps, topping up change, a safe drop. Without
          these, the variance at close blames whoever was on the register for money that left
          the drawer perfectly legitimately.
        </p>
        <Form method="post" className="mt-4 flex flex-wrap items-end gap-3">
          <input type="hidden" name="intent" value="movement" />
          <input type="hidden" name="shiftId" value={shift.id} />
          <div>
            <label htmlFor="kind" className="block text-sm font-medium text-bark">
              What happened
            </label>
            <select
              id="kind"
              name="kind"
              className="touch-target mt-1 rounded-xl border border-line bg-white px-3 py-2.5 text-bark outline-none focus:border-moss"
            >
              <option value="pay_out">Paid out of the drawer</option>
              <option value="pay_in">Put into the drawer</option>
              <option value="drop">Dropped to the safe</option>
            </select>
          </div>
          <div>
            <label htmlFor="amount" className="block text-sm font-medium text-bark">
              Amount
            </label>
            <Input id="amount" name="amount" inputMode="decimal" placeholder="20.00" className="mt-1 w-32" />
          </div>
          <div className="min-w-[14rem] flex-1">
            <label htmlFor="reason" className="block text-sm font-medium text-bark">
              What for
            </label>
            <Input id="reason" name="reason" placeholder="Change for the till" className="mt-1" required />
          </div>
          <Button type="submit" variant="secondary" disabled={busy}>
            Record it
          </Button>
        </Form>
      </Card>

      <Card>
        <h2 className="font-display text-xl text-bark">Close the drawer</h2>
        <p className="mt-2 leading-relaxed text-slate-soft">
          Count what's actually there and enter it. Don't adjust it to match the expected figure
          — a drawer that's consistently two dollars short usually means somebody is giving
          change wrong, and that's worth knowing.
        </p>
        <Form method="post" className="mt-5 space-y-4">
          <input type="hidden" name="intent" value="close" />
          <input type="hidden" name="shiftId" value={shift.id} />
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label htmlFor="counted" className="block text-sm font-medium text-bark">
                Counted total
              </label>
              <Input id="counted" name="counted" inputMode="decimal" placeholder="0.00" className="mt-1 w-40" required />
            </div>
            <div className="min-w-[16rem] flex-1">
              <label htmlFor="note" className="block text-sm font-medium text-bark">
                Anything worth noting
              </label>
              <Input id="note" name="note" placeholder="Optional" className="mt-1" />
            </div>
          </div>
          <Button type="submit" disabled={busy}>
            Close drawer
          </Button>
        </Form>
      </Card>
    </>
  );
}

function History({
  history,
}: {
  history: {
    id: string;
    opened_at: string;
    closed_at: string | null;
    status: string;
    counted_cents: number | null;
    expected_cents: number | null;
    variance_cents: number | null;
    opened_by_name: string | null;
  }[];
}) {
  return (
    <section className="border-t border-line pt-8">
      <h2 className="font-display text-xl text-bark">Recent drawers</h2>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[34rem] border-collapse text-sm">
          <thead>
            <tr className="border-b border-line text-left">
              {["Opened", "Who", "Expected", "Counted", "Variance"].map((h) => (
                <th key={h} className="px-3 py-2 font-medium text-slate-soft">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {history.map((s) => (
              <tr key={s.id}>
                <td className="px-3 py-2.5 font-medium text-bark">
                  {new Date(s.opened_at).toLocaleDateString()}
                  {s.status === "open" ? " · open now" : ""}
                </td>
                <td className="px-3 py-2.5 text-slate-soft">{s.opened_by_name ?? "—"}</td>
                <td className="px-3 py-2.5 text-slate-soft">
                  {s.expected_cents === null ? "—" : money(s.expected_cents)}
                </td>
                <td className="px-3 py-2.5 text-slate-soft">
                  {s.counted_cents === null ? "—" : money(s.counted_cents)}
                </td>
                <td
                  className={`px-3 py-2.5 ${
                    (s.variance_cents ?? 0) === 0 ? "text-slate-soft" : "text-clay"
                  }`}
                >
                  {s.variance_cents === null
                    ? "—"
                    : s.variance_cents === 0
                      ? "Exact"
                      : `${s.variance_cents > 0 ? "+" : "−"}${money(Math.abs(s.variance_cents))}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
