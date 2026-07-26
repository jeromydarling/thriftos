import type { Route } from "./+types/shop";
import { envFrom } from "../lib/env";
import { loadStorefrontPage, resolveShop } from "../lib/storefront";
import { Blocks, SiteNav } from "../components/blocks";
import { jsonLd, storeSchema } from "../lib/seo";

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
  const appHost = (env.APP_URL ?? "").replace(/^https?:\/\//, "");

  const first = params.slug ?? "";
  const second = params.page ?? "";

  // On a custom hostname the first segment is a page, not a shop.
  const onCustomHost =
    url.hostname !== appHost.replace(/:\d+$/, "") &&
    url.hostname !== "localhost" &&
    url.hostname !== "127.0.0.1";

  const shop = await resolveShop(env.DB, {
    hostname: url.hostname,
    slug: onCustomHost ? null : first,
    appHost,
  });

  if (!shop) throw new Response("Not found", { status: 404 });

  const pageSlug = onCustomHost ? first : second;
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
  const { shop, palette, fonts, blocks, data, nav, isDraft } = loaderData;

  return (
    <div style={{ background: palette.surface, minHeight: "100vh", fontFamily: fonts.body }}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={jsonLd([
          storeSchema({
            name: data.shopName,
            street: data.addressLines[0] ?? null,
            city: null,
            state: null,
            postalCode: null,
            phone: data.phone,
            slug: shop.slug,
          }),
        ])}
      />

      {isDraft ? (
        <p className="bg-amber/25 px-4 py-2 text-center text-sm text-bark">
          This page is a draft. Only you can see it.
        </p>
      ) : null}

      <SiteNav
        base={shop.base}
        pages={nav}
        palette={palette}
        fonts={fonts}
        shopName={data.shopName}
      />

      <main>
        <Blocks blocks={blocks} data={data} palette={palette} fonts={fonts} />
      </main>

      <footer
        className="mx-auto max-w-5xl px-4 py-10 text-xs"
        style={{ borderTop: `1px solid ${palette.primary}22`, color: palette.bodyText }}
      >
        <p>
          {data.shopName}
          {data.addressLines.length > 0 ? ` · ${data.addressLines.join(", ")}` : ""}
        </p>
        <p className="mt-1">
          Prices shown are today's — tags step down as items age. Everything is one of a kind.
        </p>
      </footer>
    </div>
  );
}

export function ErrorBoundary() {
  return (
    <main className="mx-auto max-w-md px-4 py-24 text-center">
      <h1 className="font-display text-2xl text-bark">We can't find that shop</h1>
      <p className="mt-3 text-sm leading-relaxed text-slate-soft">
        The address may have been mistyped, or the shop may have moved. Nothing else is affected.
      </p>
      <a href="/" className="mt-6 inline-block text-moss underline underline-offset-2">
        Go to ThriftOS
      </a>
    </main>
  );
}
