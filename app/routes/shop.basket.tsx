import { Form, Link } from "react-router";
import type { Route } from "./+types/shop.basket";
import { envFrom } from "../lib/env";
import { loadShopChrome, shopForHostname, shopForSlug } from "../lib/storefront";
import { cartByToken, readCart, removeFromCart } from "../lib/orders";
import { cartTokenFrom } from "../lib/cart-cookie";
import { ShopPage, money } from "../components/shopchrome";

export function meta({ loaderData }: Route.MetaArgs) {
  return [
    { title: `Basket · ${loaderData?.chrome.shop.name ?? "Shop"}` },
    // Never a page for a search engine.
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
  const token = cartTokenFrom(request);
  const cart = token ? await cartByToken(env.DB, token) : null;

  const lines =
    cart && cart.org_id === shop.orgId ? await readCart(env.DB, cart.id, shop.orgId) : [];

  const available = lines.filter((l) => l.available);

  return {
    chrome,
    lines,
    subtotalCents: available.reduce((n, l) => n + l.priceCents, 0),
    canCheckout: chrome.sellingOnline && available.length > 0,
  };
}

export async function action({ params, request, context }: Route.ActionArgs) {
  const env = envFrom(context);
  const shop = await resolve(env.DB, request, params.slug ?? "");
  if (!shop) throw new Response("Not found", { status: 404 });

  const token = cartTokenFrom(request);
  const cart = token ? await cartByToken(env.DB, token) : null;
  if (!cart || cart.org_id !== shop.orgId) {
    return new Response(null, { status: 303, headers: { Location: `${shop.base}/basket` } });
  }

  const form = await request.formData();
  await removeFromCart(env.DB, cart.id, String(form.get("itemId") ?? ""));

  return new Response(null, { status: 303, headers: { Location: `${shop.base}/basket` } });
}

export default function Basket({ loaderData }: Route.ComponentProps) {
  const { chrome, lines, subtotalCents, canCheckout } = loaderData;
  const { palette, fonts, shop } = chrome;

  return (
    <ShopPage chrome={chrome}>
      <h1
        className="font-display text-2xl"
        style={{ color: palette.headingText, fontFamily: fonts.display }}
      >
        Your basket
      </h1>

      {lines.length === 0 ? (
        <p className="mt-6 leading-relaxed" style={{ color: palette.bodyText }}>
          Nothing in it yet.{" "}
          <Link
            to={shop.base || "/"}
            className="underline underline-offset-2"
            style={{ color: palette.primary }}
          >
            Have a look at what's in
          </Link>
          .
        </p>
      ) : (
        <>
          <ul className="mt-6 space-y-3">
            {lines.map((line) => (
              <li
                key={line.itemId}
                className="flex items-center gap-4 rounded-2xl p-3"
                style={{
                  border: `1px solid ${palette.primary}22`,
                  background: line.available ? "#fff" : `${palette.accent}10`,
                }}
              >
                {line.photoKey ? (
                  <img
                    src={`/api/media/${line.photoKey}?w=200`}
                    alt=""
                    width={80}
                    height={80}
                    className="h-20 w-20 rounded-xl object-cover"
                  />
                ) : null}

                <div className="min-w-0 flex-1">
                  <p className="font-medium" style={{ color: palette.headingText }}>
                    {line.title}
                  </p>
                  {/* The reason it can't be bought, in the row it belongs to.
                      A banner at the top makes somebody hunt for which one. */}
                  {!line.available ? (
                    <p className="mt-0.5 text-sm" style={{ color: palette.accent }}>
                      Gone — somebody bought this one. There was only the one.
                    </p>
                  ) : line.markdownCents > 0 ? (
                    <p className="mt-0.5 text-sm" style={{ color: palette.bodyText }}>
                      {money(line.listedCents)} on the tag, marked down today
                    </p>
                  ) : null}
                </div>

                <p className="font-medium" style={{ color: palette.headingText }}>
                  {line.available ? money(line.priceCents) : "—"}
                </p>

                <Form method="post">
                  <input type="hidden" name="itemId" value={line.itemId} />
                  <button
                    type="submit"
                    className="text-sm underline underline-offset-2"
                    style={{ color: palette.bodyText }}
                    aria-label={`Remove ${line.title}`}
                  >
                    Remove
                  </button>
                </Form>
              </li>
            ))}
          </ul>

          <div
            className="mt-6 flex items-center justify-between rounded-2xl p-4"
            style={{ background: `${palette.primary}0d` }}
          >
            <span style={{ color: palette.bodyText }}>Items</span>
            <span className="text-lg font-medium" style={{ color: palette.headingText }}>
              {money(subtotalCents)}
            </span>
          </div>
          <p className="mt-2 text-xs" style={{ color: palette.bodyText }}>
            Postage and any tax are worked out at the next step, once you've said whether you're
            collecting.
          </p>

          {canCheckout ? (
            <Link
              to={`${shop.base}/checkout`}
              className="mt-6 block w-full rounded-xl px-5 py-3 text-center text-base font-medium"
              style={{ background: palette.primary, color: "#fff" }}
            >
              Continue
            </Link>
          ) : (
            <p className="mt-6 text-sm" style={{ color: palette.bodyText }}>
              {chrome.sellingOnline
                ? "Nothing here is still available, so there's nothing to pay for."
                : "This shop isn't selling online at the moment."}
            </p>
          )}
        </>
      )}
    </ShopPage>
  );
}
