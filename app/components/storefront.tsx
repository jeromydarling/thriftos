import { Blocks, SiteNav } from "./blocks";
import { jsonLd, storeSchema } from "../lib/seo";
import type { StorefrontPage } from "../lib/storefront";

/**
 * A shop's public page.
 *
 * Its own component because two routes render it: /{shop} on our address, and
 * the root of a shop's custom domain — where the front page has to be the
 * shop's, not our marketing site.
 */
export function Storefront({ page }: { page: StorefrontPage }) {
  const { shop, palette, fonts, blocks, data, nav, isDraft } = page;

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

/** Shown when an address doesn't belong to any shop. */
export function ShopNotFound() {
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
