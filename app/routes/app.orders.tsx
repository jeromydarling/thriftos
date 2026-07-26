import { Form, useNavigation, useSearchParams } from "react-router";
import type { Route } from "./+types/app.orders";
import { requireUser } from "../lib/auth";
import { envFrom } from "../lib/env";
import { stripeConfigFrom } from "../lib/stripe/client";
import {
  addressLines,
  advance,
  cannotFind,
  FulfilmentError,
  orderById,
  ordersNeedingWork,
  ordersSettled,
  pickList,
} from "../lib/fulfilment";
import { FULFILMENT_FLOW, type FulfilmentStatus } from "../lib/orders";
import { Badge, Button, Card, Input, Notice, money } from "../components/ui";

export function meta() {
  return [{ title: "Online orders | ThriftOS" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = envFrom(context);
  const user = await requireUser(request, env.DB);

  const open = new URL(request.url).searchParams.get("order");

  const [queue, settled, order] = await Promise.all([
    ordersNeedingWork(env.DB, user.orgId),
    ordersSettled(env.DB, user.orgId, 25),
    open ? orderById(env.DB, user.orgId, open) : Promise.resolve(null),
  ]);

  return {
    queue,
    settled,
    order,
    lines: order ? await pickList(env.DB, user.orgId, order.id) : [],
    address: order ? addressLines(order) : [],
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const env = envFrom(context);
  const user = await requireUser(request, env.DB);
  const form = await request.formData();

  const intent = String(form.get("intent") ?? "");
  const orderId = String(form.get("orderId") ?? "");

  try {
    if (intent === "advance") {
      await advance(env.DB, user.orgId, orderId, String(form.get("to")) as FulfilmentStatus, {
        trackingReference: String(form.get("tracking") ?? ""),
      });
      return { ok: "Updated." };
    }

    if (intent === "cannot-find") {
      const lineIds = form.getAll("lineId").map(String);
      const result = await cannotFind(env.DB, stripeConfigFrom(env), {
        orgId: user.orgId,
        transactionId: orderId,
        lineIds,
        note: String(form.get("note") ?? ""),
        userId: user.id,
      });

      return {
        ok: `Refunded ${money(result.refundedCents)} for ${result.titles.join(", ")}. ${
          result.wholeOrder
            ? "The whole order is refunded and closed."
            : "The rest of the order still needs picking."
        }`,
      };
    }
  } catch (err) {
    if (err instanceof FulfilmentError) return { error: err.message };
    return {
      error: err instanceof Error ? err.message : "That didn't work. Nothing has changed.",
    };
  }

  return { error: "That action isn't one we know." };
}

const TONE: Record<string, string> = {
  awaiting: "#B8860B",
  picking: "#B8860B",
  ready: "#2F6F5E",
  dispatched: "#2F6F5E",
  collected: "#2F6F5E",
  unfindable: "#B8543F",
  refunded: "#6B7280",
};

export default function Orders({ loaderData, actionData }: Route.ComponentProps) {
  const { queue, settled, order, lines, address } = loaderData;
  const [params, setParams] = useSearchParams();
  const nav = useNavigation();
  const busy = nav.state !== "idle";

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <header>
        <h1 className="font-display text-3xl text-bark">Online orders</h1>
        <p className="mt-3 leading-relaxed text-slate-soft">
          Paid and waiting for somebody to go and find it. Oldest first — whoever has waited
          longest is at the top.
        </p>
      </header>

      {actionData && "ok" in actionData && actionData.ok ? (
        <Notice tone="good">{actionData.ok}</Notice>
      ) : null}
      {actionData && "error" in actionData && actionData.error ? (
        <Notice tone="warn">{actionData.error}</Notice>
      ) : null}

      {order ? (
        <Card>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-display text-xl text-bark">
                {order.buyer_name ?? "Order"}{" "}
                {order.fulfilment_method === "pickup" ? "· collecting" : "· to post"}
              </h2>
              <p className="mt-1 text-sm text-slate-soft">
                {order.buyer_email} · {money(order.total_cents)} ·{" "}
                {new Date(order.created_at + "Z").toLocaleDateString()}
              </p>
            </div>
            <Badge color={TONE[order.fulfilment_status ?? "awaiting"] ?? "#6B7280"}>
              {order.fulfilment_status ?? "awaiting"}
            </Badge>
          </div>

          {order.pickup_code ? (
            <p className="mt-4 rounded-xl bg-linen/60 p-3 text-sm text-bark">
              Collection code: <strong className="font-mono text-lg">{order.pickup_code}</strong>{" "}
              — ask for this when they come in.
            </p>
          ) : null}

          {address.length > 0 ? (
            <address className="mt-4 not-italic text-sm leading-relaxed text-bark">
              {address.map((l) => (
                <span key={l} className="block">
                  {l}
                </span>
              ))}
            </address>
          ) : null}

          {/* The pick list, grouped by where things live. A volunteer who has to
              ask somebody where a coat is stops picking. */}
          <Form method="post" className="mt-6">
            <input type="hidden" name="orderId" value={order.id} />
            <h3 className="text-sm font-medium text-bark">What to find</h3>
            <ul className="mt-2 divide-y divide-line rounded-xl border border-line">
              {lines.map((line) => (
                <li key={line.id} className="flex items-start gap-3 p-3">
                  <input
                    type="checkbox"
                    name="lineId"
                    value={line.id}
                    disabled={line.fulfillment_state === "unfulfilled"}
                    className="mt-1 h-4 w-4"
                    aria-label={`Couldn't find ${line.title}`}
                  />
                  <div className="min-w-0 flex-1">
                    <p
                      className={`font-medium text-bark ${
                        line.fulfillment_state === "unfulfilled" ? "line-through opacity-60" : ""
                      }`}
                    >
                      {line.title}
                    </p>
                    <p className="text-xs text-slate-soft">
                      {[line.location_name ?? "No location recorded", line.tag_color, line.category]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                    {line.fulfillment_note ? (
                      <p className="mt-0.5 text-xs text-clay">{line.fulfillment_note}</p>
                    ) : null}
                  </div>
                  <p className="text-sm text-bark">{money(line.price_cents)}</p>
                </li>
              ))}
            </ul>

            <div className="mt-3 flex flex-wrap items-end gap-2">
              <div className="min-w-[14rem] flex-1">
                <label htmlFor="note" className="block text-xs text-slate-soft">
                  What happened? (the customer sees this)
                </label>
                <Input id="note" name="note" placeholder="Sold in the shop this morning" className="mt-1" />
              </div>
              <Button
                type="submit"
                name="intent"
                value="cannot-find"
                variant="secondary"
                disabled={busy}
              >
                Tick what you couldn't find, then refund it
              </Button>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-slate-soft">
              This refunds the customer for the ticked items straight away and tells them which
              ones. If nothing in the order can be found, the postage comes back too.
            </p>
          </Form>

          <Form method="post" className="mt-6 flex flex-wrap items-end gap-2 border-t border-line pt-4">
            <input type="hidden" name="orderId" value={order.id} />
            {order.fulfilment_method === "ship" ? (
              <div className="min-w-[12rem]">
                <label htmlFor="tracking" className="block text-xs text-slate-soft">
                  Tracking, if you have it
                </label>
                <Input id="tracking" name="tracking" className="mt-1" />
              </div>
            ) : null}

            {nextSteps(order.fulfilment_status ?? "awaiting", order.fulfilment_method).map((step) => (
              <Button key={step.to} type="submit" name="to" value={step.to} disabled={busy}>
                {step.label}
              </Button>
            ))}
            <input type="hidden" name="intent" value="advance" />
          </Form>
        </Card>
      ) : null}

      <section>
        <h2 className="font-display text-xl text-bark">
          Needs doing {queue.length > 0 ? `· ${queue.length}` : ""}
        </h2>
        {queue.length === 0 ? (
          <p className="mt-3 text-sm leading-relaxed text-slate-soft">
            Nothing waiting. Orders appear here the moment a payment clears — never before, so
            nobody goes looking for something that hasn't been bought.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {queue.map((o) => (
              <li key={o.id}>
                <button
                  type="button"
                  onClick={() => setParams({ order: o.id })}
                  className={`flex w-full flex-wrap items-center justify-between gap-3 rounded-xl border p-3 text-left ${
                    params.get("order") === o.id ? "border-moss bg-moss/5" : "border-line bg-white"
                  }`}
                >
                  <span>
                    <span className="font-medium text-bark">{o.buyer_name ?? "Someone"}</span>
                    <span className="ml-2 text-sm text-slate-soft">
                      {o.item_count} {o.item_count === 1 ? "item" : "items"} ·{" "}
                      {o.fulfilment_method === "pickup" ? "collecting" : "to post"} ·{" "}
                      {waitedFor(o.created_at)}
                    </span>
                  </span>
                  <Badge color={TONE[o.fulfilment_status ?? "awaiting"] ?? "#6B7280"}>
                    {FULFILMENT_FLOW[(o.fulfilment_status ?? "awaiting") as FulfilmentStatus]}
                  </Badge>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="border-t border-line pt-6">
        <h2 className="font-display text-lg text-bark">Done and gone</h2>
        <ul className="mt-3 space-y-1 text-sm">
          {settled.map((o) => (
            <li key={o.id} className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => setParams({ order: o.id })}
                className="text-left text-bark underline underline-offset-2"
              >
                {o.buyer_name ?? "Someone"} · {money(o.total_cents)}
              </button>
              <span className="text-slate-soft">
                {o.payment_state !== "succeeded"
                  ? "not paid"
                  : (o.fulfilment_status ?? "—")}
              </span>
            </li>
          ))}
          {settled.length === 0 ? (
            <li className="text-slate-soft">Nothing here yet.</li>
          ) : null}
        </ul>
      </section>
    </div>
  );
}

/**
 * The buttons for where an order is now.
 *
 * Derived from the state rather than shown-and-disabled, so a volunteer sees
 * two choices instead of six greyed-out ones.
 */
function nextSteps(
  status: FulfilmentStatus,
  method: "ship" | "pickup" | null
): { to: FulfilmentStatus; label: string }[] {
  switch (status) {
    case "awaiting":
      return [{ to: "picking", label: "Start looking" }];
    case "picking":
      return [{ to: "ready", label: "Found it — packed" }];
    case "ready":
      return method === "pickup"
        ? [{ to: "collected", label: "Handed over" }]
        : [{ to: "dispatched", label: "In the post" }];
    case "unfindable":
      return [{ to: "picking", label: "Look again" }];
    default:
      return [];
  }
}

/** "3 days" beats a timestamp when the point is how long somebody has waited. */
function waitedFor(createdAt: string): string {
  const ms = Date.now() - new Date(createdAt + "Z").getTime();
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"} ago`;
}
