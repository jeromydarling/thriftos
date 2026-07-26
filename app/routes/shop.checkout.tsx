import { useState } from "react";
import { Form, Link, useNavigation } from "react-router";
import type { Route } from "./+types/shop.checkout";
import { envFrom } from "../lib/env";
import { first } from "../lib/db";
import { loadShopChrome, shopForHostname, shopForSlug } from "../lib/storefront";
import { cartByToken, priceOrder, readCart, type FulfilmentMethod } from "../lib/orders";
import { canPost } from "../lib/shipping";
import { beginCheckout } from "../lib/checkout";
import { stripeConfigFrom } from "../lib/stripe/client";
import { cartTokenFrom } from "../lib/cart-cookie";
import { ShopPage, money } from "../components/shopchrome";

export function meta({ loaderData }: Route.MetaArgs) {
  return [
    { title: `Checkout · ${loaderData?.chrome.shop.name ?? "Shop"}` },
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
  if (!chrome.sellingOnline) {
    throw new Response("This shop isn't selling online.", { status: 404 });
  }

  const token = cartTokenFrom(request);
  const cart = token ? await cartByToken(env.DB, token) : null;
  const lines =
    cart && cart.org_id === shop.orgId ? await readCart(env.DB, cart.id, shop.orgId) : [];

  const postable = await canPost(env.DB, shop.orgId);
  const method: FulfilmentMethod = postable ? "ship" : "pickup";

  // Priced both ways up front, so choosing collection doesn't cost a round
  // trip to find out what it saves.
  const [shipQuote, pickupQuote] = await Promise.all([
    postable ? priceOrder(env.DB, shop.orgId, lines, "ship") : Promise.resolve(null),
    chrome.pickupEnabled ? priceOrder(env.DB, shop.orgId, lines, "pickup") : Promise.resolve(null),
  ]);

  return {
    chrome,
    lines: lines.filter((l) => l.available),
    unavailable: lines.filter((l) => !l.available),
    postable,
    defaultMethod: method,
    ship: shipQuote
      ? {
          subtotalCents: shipQuote.subtotalCents,
          shippingCents: shipQuote.shippingCents,
          taxCents: shipQuote.taxCents,
          totalCents: shipQuote.totalCents,
          bandLabel: shipQuote.shipping?.band?.label ?? null,
          reason: shipQuote.shipping?.reason ?? null,
          assumed: shipQuote.shipping?.assumed ?? [],
        }
      : null,
    pickup: pickupQuote
      ? {
          subtotalCents: pickupQuote.subtotalCents,
          taxCents: pickupQuote.taxCents,
          totalCents: pickupQuote.totalCents,
        }
      : null,
  };
}

export async function action({ params, request, context }: Route.ActionArgs) {
  const env = envFrom(context);
  const shop = await resolve(env.DB, request, params.slug ?? "");
  if (!shop) throw new Response("Not found", { status: 404 });

  const chrome = await loadShopChrome(env.DB, shop);
  if (!chrome.sellingOnline) return { error: "This shop isn't selling online at the moment." };

  const token = cartTokenFrom(request);
  const cart = token ? await cartByToken(env.DB, token) : null;
  if (!cart || cart.org_id !== shop.orgId) return { error: "Your basket has expired." };

  const account = await first<{ stripe_account_id: string }>(
    env.DB,
    `SELECT stripe_account_id FROM stripe_accounts WHERE org_id = ?`,
    shop.orgId
  );
  if (!account?.stripe_account_id) {
    return { error: "This shop can't take online payments yet." };
  }

  const form = await request.formData();
  const method: FulfilmentMethod = form.get("method") === "pickup" ? "pickup" : "ship";

  const url = new URL(request.url);
  const origin = `${url.protocol}//${url.host}`;

  const result = await beginCheckout(env.DB, stripeConfigFrom(env), {
    orgId: shop.orgId,
    cartId: cart.id,
    method,
    connectedAccountId: account.stripe_account_id,
    shopName: shop.name,
    origin,
    basePath: shop.base,
    buyer: {
      name: String(form.get("name") ?? ""),
      email: String(form.get("email") ?? ""),
      phone: String(form.get("phone") ?? ""),
      line1: String(form.get("line1") ?? ""),
      line2: String(form.get("line2") ?? ""),
      city: String(form.get("city") ?? ""),
      state: String(form.get("state") ?? ""),
      postalCode: String(form.get("postalCode") ?? ""),
      country: String(form.get("country") ?? ""),
    },
  });

  if (!result.ok) return { error: result.error, gone: result.gone };

  return new Response(null, { status: 303, headers: { Location: result.checkoutUrl } });
}

export default function Checkout({ loaderData, actionData }: Route.ComponentProps) {
  const { chrome, lines, unavailable, postable, defaultMethod, ship, pickup } = loaderData;
  const { palette, fonts, shop } = chrome;
  const nav = useNavigation();
  const [method, setMethod] = useState<FulfilmentMethod>(defaultMethod);

  const totals = method === "ship" ? ship : pickup;

  return (
    <ShopPage chrome={chrome}>
      <h1
        className="font-display text-2xl"
        style={{ color: palette.headingText, fontFamily: fonts.display }}
      >
        Checkout
      </h1>

      {unavailable.length > 0 ? (
        <div
          className="mt-4 rounded-xl p-3 text-sm"
          style={{ background: `${palette.accent}18`, color: palette.headingText }}
        >
          <p>
            {unavailable.length === 1
              ? "One thing in your basket has gone since you added it:"
              : "Some things in your basket have gone since you added them:"}
          </p>
          <ul className="mt-1 list-inside list-disc">
            {unavailable.map((l) => (
              <li key={l.itemId}>{l.title}</li>
            ))}
          </ul>
          <p className="mt-1">They're not included below and you won't be charged for them.</p>
        </div>
      ) : null}

      {actionData?.error ? (
        <div
          className="mt-4 rounded-xl p-3 text-sm"
          style={{ background: `${palette.accent}18`, color: palette.headingText }}
        >
          <p>{actionData.error}</p>
          {actionData.gone?.length ? (
            <ul className="mt-1 list-inside list-disc">
              {actionData.gone.map((title: string) => (
                <li key={title}>{title}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {lines.length === 0 ? (
        <p className="mt-6" style={{ color: palette.bodyText }}>
          There's nothing left to pay for.{" "}
          <Link to={shop.base || "/"} className="underline underline-offset-2" style={{ color: palette.primary }}>
            Back to the shop
          </Link>
          .
        </p>
      ) : (
        <Form method="post" className="mt-6 space-y-6">
          <fieldset>
            <legend className="text-sm font-medium" style={{ color: palette.headingText }}>
              How would you like it?
            </legend>
            <div className="mt-2 space-y-2">
              {chrome.pickupEnabled ? (
                <label
                  className="flex cursor-pointer items-start gap-3 rounded-xl p-3"
                  style={{ border: `1px solid ${method === "pickup" ? palette.primary : `${palette.primary}22`}` }}
                >
                  <input
                    type="radio"
                    name="method"
                    value="pickup"
                    checked={method === "pickup"}
                    onChange={() => setMethod("pickup")}
                    className="mt-1"
                  />
                  <span>
                    <span className="font-medium" style={{ color: palette.headingText }}>
                      Collect from the shop — free
                    </span>
                    <span className="block text-sm" style={{ color: palette.bodyText }}>
                      Pay now, pick it up when you're passing. We'll hold it for you and give you a
                      short code to quote.
                    </span>
                  </span>
                </label>
              ) : null}

              {postable ? (
                <label
                  className="flex cursor-pointer items-start gap-3 rounded-xl p-3"
                  style={{ border: `1px solid ${method === "ship" ? palette.primary : `${palette.primary}22`}` }}
                >
                  <input
                    type="radio"
                    name="method"
                    value="ship"
                    checked={method === "ship"}
                    onChange={() => setMethod("ship")}
                    className="mt-1"
                  />
                  <span>
                    <span className="font-medium" style={{ color: palette.headingText }}>
                      Post it to me
                      {ship?.shippingCents ? ` — ${money(ship.shippingCents)}` : ""}
                    </span>
                    <span className="block text-sm" style={{ color: palette.bodyText }}>
                      {ship?.reason ?? ship?.bandLabel ?? "Worked out from the weight."}
                    </span>
                  </span>
                </label>
              ) : null}
            </div>
          </fieldset>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Your name" name="name" palette={palette} required autoComplete="name" />
            <Field
              label="Email"
              name="email"
              type="email"
              palette={palette}
              required
              autoComplete="email"
              hint="Where the receipt goes."
            />
          </div>

          {method === "ship" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Address" name="line1" palette={palette} required autoComplete="address-line1" wide />
              <Field label="Address line 2" name="line2" palette={palette} autoComplete="address-line2" wide />
              <Field label="Town or city" name="city" palette={palette} required autoComplete="address-level2" />
              <Field label="County or state" name="state" palette={palette} autoComplete="address-level1" />
              <Field label="Postcode or ZIP" name="postalCode" palette={palette} required autoComplete="postal-code" />
              <Field label="Country" name="country" palette={palette} autoComplete="country-name" />
            </div>
          ) : null}

          <div className="rounded-2xl p-4" style={{ background: `${palette.primary}0d` }}>
            <Row label={`${lines.length} ${lines.length === 1 ? "item" : "items"}`} value={money(totals?.subtotalCents ?? 0)} palette={palette} />
            {method === "ship" && ship ? (
              <Row label={ship.bandLabel ?? "Postage"} value={money(ship.shippingCents)} palette={palette} />
            ) : null}
            {totals?.taxCents ? (
              <Row label="Sales tax" value={money(totals.taxCents)} palette={palette} />
            ) : null}
            <div
              className="mt-2 flex items-center justify-between border-t pt-2"
              style={{ borderColor: `${palette.primary}22` }}
            >
              <span className="font-medium" style={{ color: palette.headingText }}>
                Total
              </span>
              <span className="text-lg font-medium" style={{ color: palette.headingText }}>
                {money(totals?.totalCents ?? 0)}
              </span>
            </div>
          </div>

          {/* Said before they commit, not after. Everything here is one of one,
              and the honest thing is to warn rather than to apologise later. */}
          <p className="text-xs leading-relaxed" style={{ color: palette.bodyText }}>
            Next you'll pay securely through Stripe. Everything here is one of a kind and stays on
            the shop floor until it's paid for — very occasionally something sells in the shop
            while you're checking out. If that happens we'll refund you straight away and tell you
            which one.
          </p>

          <button
            type="submit"
            disabled={nav.state !== "idle"}
            className="w-full rounded-xl px-5 py-3 text-base font-medium disabled:opacity-60"
            style={{ background: palette.primary, color: "#fff" }}
          >
            {nav.state !== "idle" ? "One moment…" : `Pay ${money(totals?.totalCents ?? 0)}`}
          </button>
        </Form>
      )}
    </ShopPage>
  );
}

function Row({ label, value, palette }: { label: string; value: string; palette: any }) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <span style={{ color: palette.bodyText }}>{label}</span>
      <span style={{ color: palette.headingText }}>{value}</span>
    </div>
  );
}

function Field({
  label,
  name,
  palette,
  type = "text",
  required = false,
  hint,
  wide = false,
  autoComplete,
}: {
  label: string;
  name: string;
  palette: any;
  type?: string;
  required?: boolean;
  hint?: string;
  wide?: boolean;
  autoComplete?: string;
}) {
  return (
    <div className={wide ? "sm:col-span-2" : ""}>
      <label htmlFor={name} className="block text-sm font-medium" style={{ color: palette.headingText }}>
        {label}
        {required ? "" : <span style={{ color: palette.bodyText }}> (optional)</span>}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        required={required}
        autoComplete={autoComplete}
        className="mt-1 w-full rounded-xl px-3 py-2"
        style={{ border: `1px solid ${palette.primary}33`, background: "#fff", color: palette.headingText }}
      />
      {hint ? (
        <p className="mt-1 text-xs" style={{ color: palette.bodyText }}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}
