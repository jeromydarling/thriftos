import { Link } from "react-router";
import type { Route } from "./+types/shop.order";
import { envFrom } from "../lib/env";
import { all, first } from "../lib/db";
import { loadShopChrome, shopForHostname, shopForSlug } from "../lib/storefront";
import { cartByToken } from "../lib/orders";
import { clearCart } from "../lib/checkout";
import { cartTokenFrom } from "../lib/cart-cookie";
import { ShopPage, money } from "../components/shopchrome";

export function meta({ loaderData }: Route.MetaArgs) {
  return [
    { title: `Your order · ${loaderData?.chrome.shop.name ?? "Shop"}` },
    // Somebody's order, reachable by anyone with the link. Never indexed.
    { name: "robots", content: "noindex" },
  ];
}

async function resolve(db: D1Database, request: Request, slug: string) {
  const byHostname = await shopForHostname(db, new URL(request.url).hostname);
  return byHostname ?? (await shopForSlug(db, slug));
}

export async function loader({ params, request, context }: Route.LoaderArgs) {
  const env = envFrom(context);
  const shop = await resolve(env.DB, request, params.slug ?? "");
  if (!shop) throw new Response("Not found", { status: 404 });

  const chrome = await loadShopChrome(env.DB, shop);

  const order = await first<{
    id: string;
    payment_state: string;
    fulfilment_method: string | null;
    fulfilment_status: string | null;
    pickup_code: string | null;
    buyer_name: string | null;
    buyer_email: string | null;
    subtotal_cents: number;
    shipping_cents: number;
    tax_cents: number;
    total_cents: number;
    created_at: string;
  }>(
    env.DB,
    `SELECT id, payment_state, fulfilment_method, fulfilment_status, pickup_code,
            buyer_name, buyer_email, subtotal_cents, shipping_cents, tax_cents,
            total_cents, created_at
       FROM transactions
      WHERE id = ? AND org_id = ? AND channel = 'online'`,
    params.orderId ?? "",
    shop.orgId
  );

  if (!order) throw new Response("Not found", { status: 404 });

  const lines = await all<{ title: string; price_cents: number; fulfillment_state: string }>(
    env.DB,
    `SELECT title, price_cents, fulfillment_state FROM transaction_items
      WHERE transaction_id = ? AND org_id = ?`,
    order.id,
    shop.orgId
  );

  // Landing here means they came back from Stripe. Emptying the basket now
  // stops a refresh looking like a second order's worth of stock.
  const token = cartTokenFrom(request);
  const cart = token ? await cartByToken(env.DB, token) : null;
  if (cart && cart.org_id === shop.orgId && order.payment_state === "succeeded") {
    await clearCart(env.DB, cart.id);
  }

  return { chrome, order, lines };
}

export default function OrderConfirmation({ loaderData }: Route.ComponentProps) {
  const { chrome, order, lines } = loaderData;
  const { palette, fonts, shop } = chrome;

  const paid = order.payment_state === "succeeded";
  const pending = ["draft", "processing", "requires_action"].includes(order.payment_state);
  const unfulfilled = lines.filter((l) => l.fulfillment_state === "unfulfilled");

  return (
    <ShopPage chrome={chrome}>
      <h1
        className="font-display text-2xl"
        style={{ color: palette.headingText, fontFamily: fonts.display }}
      >
        {paid ? "Thank you — that's paid" : pending ? "We're waiting on your payment" : "This order didn't go through"}
      </h1>

      {/* Never claims more than the payment state supports. A confirmation
          page that says "paid" before Stripe has said so is how a shopper
          finds out days later that nothing happened. */}
      {pending ? (
        <p className="mt-3 leading-relaxed" style={{ color: palette.bodyText }}>
          Your bank hasn't confirmed it yet. This usually takes a few seconds — refresh in a
          moment. Nothing is dispatched until it clears, and if it doesn't clear you won't be
          charged.
        </p>
      ) : null}

      {!paid && !pending ? (
        <p className="mt-3 leading-relaxed" style={{ color: palette.bodyText }}>
          Nothing was charged, and everything went back on sale.{" "}
          <Link to={shop.base || "/"} className="underline underline-offset-2" style={{ color: palette.primary }}>
            Have another look
          </Link>
          .
        </p>
      ) : null}

      {paid && order.fulfilment_method === "pickup" ? (
        <div className="mt-5 rounded-2xl p-4" style={{ background: `${palette.primary}0d` }}>
          <p className="text-sm" style={{ color: palette.bodyText }}>
            Quote this when you come in:
          </p>
          <p
            className="mt-1 font-display text-3xl tracking-[0.2em]"
            style={{ color: palette.headingText, fontFamily: fonts.display }}
          >
            {order.pickup_code}
          </p>
          {chrome.pickupInstructions ? (
            <p className="mt-3 whitespace-pre-line text-sm leading-relaxed" style={{ color: palette.bodyText }}>
              {chrome.pickupInstructions}
            </p>
          ) : null}
        </div>
      ) : null}

      {paid && order.fulfilment_method === "ship" ? (
        <p className="mt-3 leading-relaxed" style={{ color: palette.bodyText }}>
          We'll pack it and get it in the post. You'll get an email when it goes — most shops are
          volunteer-run, so give it a few days rather than a few hours.
        </p>
      ) : null}

      {unfulfilled.length > 0 ? (
        <div
          className="mt-5 rounded-xl p-3 text-sm leading-relaxed"
          style={{ background: `${palette.accent}18`, color: palette.headingText }}
        >
          <p>
            We're sorry — {unfulfilled.length === 1 ? "one thing" : "some things"} in this order
            couldn't be found in the shop after all:
          </p>
          <ul className="mt-1 list-inside list-disc">
            {unfulfilled.map((l) => (
              <li key={l.title}>{l.title}</li>
            ))}
          </ul>
          <p className="mt-1">
            You're being refunded for {unfulfilled.length === 1 ? "it" : "them"}. It's the risk
            with one-of-a-kind stock, and it's on us to say so rather than leave you wondering.
          </p>
        </div>
      ) : null}

      <ul className="mt-6 space-y-1 text-sm">
        {lines.map((line, i) => (
          <li key={i} className="flex items-center justify-between">
            <span
              style={{
                color: palette.bodyText,
                textDecoration: line.fulfillment_state === "unfulfilled" ? "line-through" : undefined,
              }}
            >
              {line.title}
            </span>
            <span style={{ color: palette.headingText }}>{money(line.price_cents)}</span>
          </li>
        ))}
      </ul>

      <div className="mt-4 border-t pt-3 text-sm" style={{ borderColor: `${palette.primary}22` }}>
        {order.shipping_cents > 0 ? (
          <div className="flex items-center justify-between">
            <span style={{ color: palette.bodyText }}>Postage</span>
            <span style={{ color: palette.headingText }}>{money(order.shipping_cents)}</span>
          </div>
        ) : null}
        {order.tax_cents > 0 ? (
          <div className="flex items-center justify-between">
            <span style={{ color: palette.bodyText }}>Sales tax</span>
            <span style={{ color: palette.headingText }}>{money(order.tax_cents)}</span>
          </div>
        ) : null}
        <div className="mt-1 flex items-center justify-between font-medium">
          <span style={{ color: palette.headingText }}>Total</span>
          <span style={{ color: palette.headingText }}>{money(order.total_cents)}</span>
        </div>
      </div>

      {order.buyer_email ? (
        <p className="mt-5 text-xs" style={{ color: palette.bodyText }}>
          A receipt is on its way to {order.buyer_email}. Keep this page's address if you'd like to
          check back — it's the only link to this order.
        </p>
      ) : null}
    </ShopPage>
  );
}

export function ErrorBoundary() {
  return (
    <main className="mx-auto max-w-md px-4 py-24 text-center">
      <h1 className="font-display text-2xl text-bark">We can't find that order</h1>
      <p className="mt-3 text-sm leading-relaxed text-slate-soft">
        The link may be mistyped. If you paid, your receipt email has the right one.
      </p>
    </main>
  );
}
