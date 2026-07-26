import type { Route } from "./+types/shop.feed";
import { envFrom } from "../lib/env";
import { all, first } from "../lib/db";
import { loadShopChrome, shopForHostname, shopForSlug } from "../lib/storefront";
import { effectivePriceCents, DEFAULT_MARKDOWN_RULES } from "../lib/markdown";
import { parseOrgSettings } from "../lib/settings";
import { FEED_PREDICATE } from "../lib/feed";

/**
 * A product feed, for Google Shopping's free listings and anything else that
 * reads one.
 *
 * This is the syndication worth having: the buyer discovers an item somewhere
 * with an audience, and lands on the shop's own page to buy it. Our reservation
 * machinery holds unchanged, the money goes through the shop's own Stripe
 * account at the fee they already understand, and there is no second checkout
 * that could sell the same coat.
 *
 * `availability` is always `in_stock`, because anything not available simply
 * isn't in the feed. Listing a sold item as out of stock would be technically
 * correct and practically wrong — the item is one of one and is never coming
 * back, so it should leave rather than linger.
 */
function esc(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function loader({ params, request, context }: Route.LoaderArgs) {
  const env = envFrom(context);
  const url = new URL(request.url);

  const byHostname = await shopForHostname(env.DB, url.hostname);
  const shop = byHostname ?? (await shopForSlug(env.DB, params.slug ?? ""));
  if (!shop) throw new Response("Not found", { status: 404 });

  const chrome = await loadShopChrome(env.DB, shop);

  // A shop not selling online gets an empty feed rather than a 404: the URL
  // stays valid, so a merchant account already pointed at it doesn't start
  // reporting errors the day a shop pauses.
  const org = await first<{ settings_json: string }>(
    env.DB,
    `SELECT settings_json FROM orgs WHERE id = ?`,
    shop.orgId
  );
  const settings = parseOrgSettings(org?.settings_json);

  const [items, rules] = await Promise.all([
    chrome.sellingOnline
      ? all<{
          id: string;
          title: string;
          description: string | null;
          category: string | null;
          brand: string | null;
          condition: string | null;
          price_cents: number;
          tag_color: string | null;
          intake_date: string;
          photo_key: string | null;
          photo_enhanced_key: string | null;
          photo_enhanced_at: string | null;
        }>(
          env.DB,
          `SELECT id, title, description, category, brand, condition, price_cents,
                  tag_color, intake_date, photo_key, photo_enhanced_key, photo_enhanced_at
             FROM items
            WHERE org_id = ? AND ${FEED_PREDICATE}
            ORDER BY created_at DESC
            LIMIT 5000`,
          shop.orgId
        )
      : Promise.resolve([]),
    all<{ tag_color: string; discount_pct: number; age_days: number }>(
      env.DB,
      `SELECT tag_color, discount_pct, age_days FROM markdown_rules
        WHERE org_id = ? AND is_active = 1 ORDER BY week_index`,
      shop.orgId
    ),
  ]);

  const ladder =
    rules.length > 0
      ? rules.map((r) => ({
          tagColor: r.tag_color,
          discountPct: r.discount_pct,
          ageDays: r.age_days,
          weekIndex: 0,
        }))
      : DEFAULT_MARKDOWN_RULES;

  const origin = `${url.protocol}//${url.host}`;

  const entries = items.map((item) => {
    const price = effectivePriceCents(
      { priceCents: item.price_cents, tagColor: item.tag_color, intakeDate: item.intake_date },
      ladder
    );

    // Only a reviewed cut-out goes out to a shopping channel — the same rule
    // the shop's own listing follows.
    const photo =
      item.photo_enhanced_at && item.photo_enhanced_key ? item.photo_enhanced_key : item.photo_key;

    return `    <item>
      <g:id>${esc(item.id)}</g:id>
      <g:title>${esc(item.title)}</g:title>
      <g:description>${esc(
        item.description?.slice(0, 4000) ||
          `${item.title} — second-hand, one of a kind, from ${shop.name}.`
      )}</g:description>
      <g:link>${esc(`${origin}${shop.base}/item/${item.id}`)}</g:link>
      <g:image_link>${esc(`${origin}/api/media/${photo}?w=1200`)}</g:image_link>
      <g:availability>in_stock</g:availability>
      <g:price>${(price / 100).toFixed(2)} USD</g:price>
      <g:condition>used</g:condition>
      <g:quantity>1</g:quantity>
${item.brand ? `      <g:brand>${esc(item.brand)}</g:brand>\n` : ""}${
      item.category ? `      <g:product_type>${esc(item.category)}</g:product_type>\n` : ""
    }      <g:identifier_exists>no</g:identifier_exists>
    </item>`;
  });

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
  <channel>
    <title>${esc(shop.name)}</title>
    <link>${esc(`${origin}${shop.base}`)}</link>
    <description>${esc(
      settings.accepted
        ? `Second-hand goods from ${shop.name}. Everything is one of a kind.`
        : `Second-hand goods from ${shop.name}.`
    )}</description>
${entries.join("\n")}
  </channel>
</rss>
`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      // Half an hour. Long enough that a crawler isn't scanning inventory on
      // every hit, short enough that something sold this morning is gone from
      // the feed by lunchtime.
      "Cache-Control": "public, max-age=0, s-maxage=1800",
    },
  });
}
