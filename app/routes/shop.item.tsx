import { Form, Link, useNavigation } from "react-router";
import type { Route } from "./+types/shop.item";
import { envFrom } from "../lib/env";
import { all, first } from "../lib/db";
import { loadShopChrome, shopForHostname, shopForSlug } from "../lib/storefront";
import { effectivePriceCents, currentDiscountPct, DEFAULT_MARKDOWN_RULES } from "../lib/markdown";
import { cartByToken, createCart, addToCart, readCart } from "../lib/orders";
import { cartCookie, cartTokenFrom } from "../lib/cart-cookie";
import { ShopPage, BasketLink, money } from "../components/shopchrome";

export function meta({ loaderData }: Route.MetaArgs) {
  return [
    { title: loaderData ? `${loaderData.item.title} · ${loaderData.chrome.shop.name}` : "Item" },
    { name: "description", content: loaderData?.item.description ?? "" },
    // A sold item stays readable — links get shared — but must not be indexed
    // as though it were for sale.
    ...(loaderData && !loaderData.item.available ? [{ name: "robots", content: "noindex" }] : []),
  ];
}

async function resolve(db: D1Database, request: Request, slug: string) {
  const url = new URL(request.url);
  const byHostname = await shopForHostname(db, url.hostname);
  return byHostname ?? (await shopForSlug(db, slug));
}

export async function loader({ params, request, context }: Route.LoaderArgs) {
  const env = envFrom(context);
  const shop = await resolve(env.DB, request, params.slug ?? "");
  if (!shop) throw new Response("Not found", { status: 404 });

  const chrome = await loadShopChrome(env.DB, shop);

  const [row, rules] = await Promise.all([
    first<{
      id: string;
      title: string;
      description: string | null;
      category: string | null;
      brand: string | null;
      size: string | null;
      condition: string | null;
      condition_notes: string | null;
      price_cents: number;
      retail_estimate_cents: number | null;
      tag_color: string | null;
      intake_date: string;
      weight_lbs: number | null;
      photo_key: string | null;
      photo_enhanced_key: string | null;
      photo_enhanced_at: string | null;
      status: string;
      held_by_transaction_id: string | null;
    }>(
      env.DB,
      `SELECT id, title, description, category, brand, size, condition, condition_notes,
              price_cents, retail_estimate_cents, tag_color, intake_date, weight_lbs,
              photo_key, photo_enhanced_key, photo_enhanced_at, status, held_by_transaction_id
         FROM items WHERE id = ? AND org_id = ?`,
      params.itemId ?? "",
      shop.orgId
    ),
    all<{ tag_color: string; discount_pct: number; age_days: number }>(
      env.DB,
      `SELECT tag_color, discount_pct, age_days FROM markdown_rules
        WHERE org_id = ? AND is_active = 1 ORDER BY week_index`,
      shop.orgId
    ),
  ]);

  if (!row) throw new Response("Not found", { status: 404 });

  const ladder =
    rules.length > 0
      ? rules.map((r) => ({
          tagColor: r.tag_color,
          discountPct: r.discount_pct,
          ageDays: r.age_days,
          weekIndex: 0,
        }))
      : DEFAULT_MARKDOWN_RULES;

  const shape = {
    priceCents: row.price_cents,
    tagColor: row.tag_color,
    intakeDate: row.intake_date,
  };

  // How many things are in this shopper's basket, for the header. Cheap enough
  // to do here and it saves a second round trip on every item page.
  const token = cartTokenFrom(request);
  const cart = token ? await cartByToken(env.DB, token) : null;
  const basketCount =
    cart && cart.org_id === shop.orgId ? (await readCart(env.DB, cart.id, shop.orgId)).length : 0;

  return {
    chrome,
    basketCount,
    item: {
      id: row.id,
      title: row.title,
      description: row.description,
      category: row.category,
      brand: row.brand,
      size: row.size,
      condition: row.condition,
      conditionNotes: row.condition_notes,
      priceCents: effectivePriceCents(shape, ladder),
      listedCents: row.price_cents,
      discountPct: currentDiscountPct(shape, ladder),
      retailEstimateCents: row.retail_estimate_cents,
      // The original is always offered alongside an enhanced shot. These are
      // used goods and a shopper is entitled to see what was photographed.
      photoKey: row.photo_enhanced_at ? (row.photo_enhanced_key ?? row.photo_key) : row.photo_key,
      originalPhotoKey: row.photo_enhanced_at ? row.photo_key : null,
      available: row.status === "available" && !row.held_by_transaction_id,
      sold: row.status === "sold",
    },
  };
}

export async function action({ params, request, context }: Route.ActionArgs) {
  const env = envFrom(context);
  const shop = await resolve(env.DB, request, params.slug ?? "");
  if (!shop) throw new Response("Not found", { status: 404 });

  const chrome = await loadShopChrome(env.DB, shop);
  if (!chrome.sellingOnline) {
    return { error: "This shop isn't selling online at the moment." };
  }

  const token = cartTokenFrom(request);

  let cart = token ? await cartByToken(env.DB, token) : null;
  // A cart belongs to one shop. Arriving at a second shop's page with another
  // shop's cart cookie starts a new basket rather than mixing them.
  if (!cart || cart.org_id !== shop.orgId) {
    const made = await createCart(env.DB, shop.orgId);
    cart = { id: made.id, org_id: shop.orgId };
    await addToCart(env.DB, cart.id, params.itemId ?? "");
    return new Response(null, {
      status: 303,
      headers: {
        Location: `${shop.base}/basket`,
        "Set-Cookie": cartCookie(made.token, new URL(request.url).protocol === "https:"),
      },
    });
  }

  await addToCart(env.DB, cart.id, params.itemId ?? "");
  return new Response(null, { status: 303, headers: { Location: `${shop.base}/basket` } });
}

export default function ShopItem({ loaderData, actionData }: Route.ComponentProps) {
  const { chrome, item, basketCount } = loaderData;
  const { palette, fonts } = chrome;
  const nav = useNavigation();

  return (
    <ShopPage chrome={chrome} wide>
      <div className="mb-6 flex items-center justify-between gap-4">
        <Link
          to={chrome.shop.base || "/"}
          className="text-sm underline underline-offset-2"
          style={{ color: palette.bodyText }}
        >
          ← Everything else
        </Link>
        <BasketLink chrome={chrome} count={basketCount} />
      </div>

      <div className="grid gap-8 md:grid-cols-2">
        <div>
          {item.photoKey ? (
            <img
              src={`/api/media/${item.photoKey}?w=1000`}
              alt={item.title}
              width={1000}
              height={750}
              className="w-full rounded-2xl object-cover"
              style={{ border: `1px solid ${palette.primary}22` }}
            />
          ) : (
            <div
              className="flex aspect-[4/3] w-full items-center justify-center rounded-2xl text-sm"
              style={{ border: `1px solid ${palette.primary}22`, color: palette.bodyText }}
            >
              No photograph of this one
            </div>
          )}

          {item.originalPhotoKey ? (
            <p className="mt-2 text-xs" style={{ color: palette.bodyText }}>
              This photo has been tidied up — background removed, straightened.{" "}
              <a
                href={`/api/media/${item.originalPhotoKey}?w=1000`}
                className="underline underline-offset-2"
                style={{ color: palette.primary }}
              >
                See the untouched photo
              </a>
              . The item itself is exactly as it came in.
            </p>
          ) : null}
        </div>

        <div>
          <h1 className="font-display text-2xl" style={{ color: palette.headingText, fontFamily: fonts.display }}>
            {item.title}
          </h1>

          <p className="mt-3 flex items-baseline gap-3">
            <span className="text-3xl font-medium" style={{ color: palette.headingText }}>
              {money(item.priceCents)}
            </span>
            {item.discountPct > 0 ? (
              <>
                <span className="text-base line-through" style={{ color: palette.bodyText }}>
                  {money(item.listedCents)}
                </span>
                <span className="text-sm font-medium" style={{ color: palette.accent }}>
                  {item.discountPct}% off
                </span>
              </>
            ) : null}
          </p>

          <dl className="mt-6 grid grid-cols-2 gap-x-4 gap-y-2 text-sm" style={{ color: palette.bodyText }}>
            {[
              ["Category", item.category],
              ["Brand", item.brand],
              ["Size", item.size],
              ["Condition", item.condition],
            ]
              .filter(([, v]) => v)
              .map(([label, value]) => (
                <div key={label as string}>
                  <dt className="text-xs uppercase tracking-wide opacity-70">{label}</dt>
                  <dd style={{ color: palette.headingText }}>{value}</dd>
                </div>
              ))}
          </dl>

          {/* Wear and damage sit above the buy button, not below it. A shopper
              should read the flaw before deciding, not after. */}
          {item.conditionNotes ? (
            <p
              className="mt-5 rounded-xl p-3 text-sm leading-relaxed"
              style={{ background: `${palette.accent}14`, color: palette.headingText }}
            >
              <strong>Worth knowing:</strong> {item.conditionNotes}
            </p>
          ) : null}

          {item.description ? (
            <p className="mt-5 leading-relaxed" style={{ color: palette.bodyText }}>
              {item.description}
            </p>
          ) : null}

          {actionData?.error ? (
            <p className="mt-5 text-sm" style={{ color: palette.accent }}>
              {actionData.error}
            </p>
          ) : null}

          <div className="mt-7">
            {!item.available ? (
              <p className="text-sm" style={{ color: palette.bodyText }}>
                {item.sold
                  ? "This one has sold. There was only ever one of it."
                  : "Somebody is buying this right now. If they don't finish, it'll come back."}
              </p>
            ) : !chrome.sellingOnline ? (
              <p className="text-sm" style={{ color: palette.bodyText }}>
                This one's in the shop — come and see it. We're not selling online just yet.
              </p>
            ) : (
              <Form method="post">
                <button
                  type="submit"
                  disabled={nav.state !== "idle"}
                  className="w-full rounded-xl px-5 py-3 text-base font-medium disabled:opacity-60"
                  style={{ background: palette.primary, color: "#fff" }}
                >
                  Add to basket
                </button>
                <p className="mt-2 text-xs" style={{ color: palette.bodyText }}>
                  Adding it doesn't hold it — there's only one, and it stays on the shop floor
                  until somebody pays.
                </p>
              </Form>
            )}
          </div>
        </div>
      </div>
    </ShopPage>
  );
}

export function ErrorBoundary() {
  return (
    <main className="mx-auto max-w-md px-4 py-24 text-center">
      <h1 className="font-display text-2xl text-bark">We can't find that</h1>
      <p className="mt-3 text-sm leading-relaxed text-slate-soft">
        It may have sold and been cleared away, or the address may be mistyped.
      </p>
    </main>
  );
}
