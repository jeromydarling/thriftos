import { Link } from "react-router";
import { SiteNav } from "./blocks";
import type { ShopChrome } from "../lib/storefront";

/**
 * The frame around a shop's basket, item pages and checkout.
 *
 * The same nav and the same colours as the shop's own site, because a shopper
 * who clicks "buy" should not feel handed over to somebody else. Everything
 * here reads from the shop's brand kit; nothing is ThriftOS-branded.
 */
export function ShopPage({
  chrome,
  children,
  wide = false,
}: {
  chrome: ShopChrome;
  children: React.ReactNode;
  wide?: boolean;
}) {
  const { palette, fonts, shop, nav } = chrome;

  return (
    <div style={{ background: palette.surface, minHeight: "100vh", fontFamily: fonts.body }}>
      <SiteNav
        base={shop.base}
        pages={nav}
        palette={palette}
        fonts={fonts}
        shopName={shop.name}
      />
      <main className={`mx-auto px-4 py-10 ${wide ? "max-w-5xl" : "max-w-2xl"}`}>{children}</main>
      <footer
        className="mx-auto max-w-5xl px-4 py-10 text-xs"
        style={{ borderTop: `1px solid ${palette.primary}22`, color: palette.bodyText }}
      >
        <p>
          {shop.name} · Everything is one of a kind, so anything here can go at any moment —
          including while it's in your basket.
        </p>
      </footer>
    </div>
  );
}

/** A basket link that only appears once there's something in it. */
export function BasketLink({
  chrome,
  count,
}: {
  chrome: ShopChrome;
  count: number;
}) {
  if (count === 0) return null;
  return (
    <Link
      to={`${chrome.shop.base}/basket`}
      className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium"
      style={{ background: chrome.palette.primary, color: "#fff" }}
    >
      Basket · {count} {count === 1 ? "item" : "items"}
    </Link>
  );
}

export function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
