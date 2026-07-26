import type { Route } from "./+types/shop";
import { envFrom } from "../lib/env";
import { loadStorefrontPage, shopForHostname, shopForSlug } from "../lib/storefront";
import { ShopNotFound, Storefront } from "../components/storefront";

export function meta({ loaderData }: Route.MetaArgs) {
  // React Router hands meta() `loaderData`, not `data`.
  const seo = loaderData?.seo;
  return [
    { title: seo?.title ?? "Shop" },
    { name: "description", content: seo?.description ?? "" },
    // A draft is previewable but must never be indexed.
    ...(loaderData?.isDraft ? [{ name: "robots", content: "noindex" }] : []),
  ];
}

/**
 * A shop's public page.
 *
 * Lives at the root of the path namespace — thriftos.app/{shop} — because a
 * shop putting its address on a flyer shouldn't have to explain a /s/ in the
 * middle of it. Reserved slugs are held in the database precisely so this
 * route can sit here without a marketing page ever colliding with a shop.
 *
 * The same route serves a custom hostname, where the shop is resolved from the
 * Host header and the slug segment becomes the page instead.
 */
export async function loader({ params, request, context }: Route.LoaderArgs) {
  const env = envFrom(context);
  const url = new URL(request.url);

  const first = params.slug ?? "";
  const second = params.page ?? "";

  // Ask the database whether this hostname belongs to a shop, rather than
  // asking configuration whether it's one of ours. A hostname that matches an
  // active custom domain can only mean one shop, and its first path segment is
  // a page; anything else is our own address, where the first segment is the
  // shop. Getting this from data rather than from APP_URL is what stops a
  // wrong hostname in config from 404-ing every storefront at once.
  const byHostname = await shopForHostname(env.DB, url.hostname);
  const shop = byHostname ?? (await shopForSlug(env.DB, first));

  if (!shop) throw new Response("Not found", { status: 404 });

  const pageSlug = byHostname ? first : second;
  const page = await loadStorefrontPage(env.DB, shop, pageSlug);

  if (!page) throw new Response("Not found", { status: 404 });

  return page;
}

/**
 * Anonymous public GETs are edge-cached briefly. A shop's page shows live
 * prices, so the window is short — two minutes is long enough to absorb a
 * burst and short enough that a markdown applied this morning is visible by
 * lunchtime.
 */
export function headers() {
  return {
    "Cache-Control": "public, max-age=0, s-maxage=120, stale-while-revalidate=600",
  };
}

export default function Shop({ loaderData }: Route.ComponentProps) {
  return <Storefront page={loaderData} />;
}

export function ErrorBoundary() {
  return <ShopNotFound />;
}
