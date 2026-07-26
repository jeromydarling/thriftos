/**
 * Resolving and loading a shop's public page.
 *
 * A shop is reachable two ways: at `/{slug}` on our domain, which every shop
 * gets for nothing, and at its own hostname through Cloudflare for SaaS. Both
 * end up here, so there is one loader and one set of behaviour rather than two
 * that drift.
 */
import { all, first } from "./db";
import { parseBrandKit, renderPalette, typefaceFor, type BrandKit } from "./brand";
import { parseBlocks, DEFAULT_HOME, type Block } from "./site";
import { currentDiscountPct, effectivePriceCents, DEFAULT_MARKDOWN_RULES } from "./markdown";
import { DIVERTED_STATUS_SQL, realOnly } from "./impact";
import { can, getEntitlements } from "./entitlements";
import type { PageData } from "../components/blocks";
import { parseOrgSettings } from "./settings";

export interface ResolvedShop {
  orgId: string;
  slug: string;
  name: string;
  /** "" when reached on a custom hostname, "/{slug}" on ours. */
  base: string;
}

/**
 * A shop reached on its own hostname, or null if this isn't one.
 *
 * Deciding "is this a custom hostname?" by asking the database rather than by
 * comparing against a configured APP_URL is deliberate, and it is the whole
 * lesson of the first production deploy: APP_URL said
 * thriftos.jeromydarling.workers.dev and the worker actually answered on
 * thriftos.jer-f84.workers.dev, so every request looked like a custom hostname,
 * the first path segment was read as a page instead of a shop, and every shop's
 * page 404'd. A wrong hostname in configuration should cost us custom domains,
 * not every storefront we serve.
 *
 * Only `active` domains resolve — a hostname still being provisioned must not
 * serve a half-configured page.
 */
export async function shopForHostname(
  db: D1Database,
  hostname: string
): Promise<ResolvedShop | null> {
  const host = hostname.toLowerCase().replace(/:\d+$/, "");
  if (!host) return null;

  const domain = await first<{ org_id: string; slug: string; name: string }>(
    db,
    `SELECT d.org_id, o.slug, o.name
       FROM custom_domains d
       JOIN orgs o ON o.id = d.org_id
      WHERE d.hostname = ? AND d.status = 'active' AND o.status = 'active'`,
    host
  );
  if (!domain) return null;

  return { orgId: domain.org_id, slug: domain.slug, name: domain.name, base: "" };
}

/** A shop reached at /{slug} on our own address. */
export async function shopForSlug(db: D1Database, slug: string): Promise<ResolvedShop | null> {
  if (!slug) return null;

  const org = await first<{ id: string; slug: string; name: string }>(
    db,
    `SELECT id, slug, name FROM orgs WHERE slug = ? AND status = 'active'`,
    slug.toLowerCase()
  );
  if (!org) return null;

  return { orgId: org.id, slug: org.slug, name: org.name, base: `/${org.slug}` };
}

export interface StorefrontPage {
  shop: ResolvedShop;
  kit: BrandKit;
  palette: ReturnType<typeof renderPalette>;
  fonts: { display: string; body: string };
  blocks: Block[];
  data: PageData;
  nav: { slug: string; label: string }[];
  seo: { title: string; description: string };
  /** Set when the page is a draft being previewed by the shop itself. */
  isDraft: boolean;
}

function hourLines(raw: unknown): string[] {
  if (typeof raw !== "string") return [];
  return raw.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 8);
}

function listLines(raw: unknown): string[] {
  if (typeof raw !== "string") return [];
  return raw
    .split("\n")
    .map((l) => l.trim().replace(/^[·\-*]\s*/, ""))
    .filter(Boolean)
    .slice(0, 10);
}

/**
 * Load everything a page needs, in one pass.
 *
 * Returns null when the page doesn't exist or isn't published — the caller
 * turns that into a 404. A draft is only loaded when `allowDraft` is set,
 * which the app-side preview does and the public route never does.
 */
export async function loadStorefrontPage(
  db: D1Database,
  shop: ResolvedShop,
  pageSlug: string,
  opts: { allowDraft?: boolean } = {}
): Promise<StorefrontPage | null> {
  const entitlements = await getEntitlements(db, shop.orgId);
  if (!can(entitlements, "storefront")) return null;

  const [page, navPages, kitRow, org, rules] = await Promise.all([
    first<{
      blocks_json: string;
      title: string;
      status: string;
      seo_title: string | null;
      seo_description: string | null;
    }>(
      db,
      `SELECT blocks_json, title, status, seo_title, seo_description
         FROM site_pages WHERE org_id = ? AND slug = ?`,
      shop.orgId,
      pageSlug
    ),
    all<{ slug: string; nav_label: string | null; title: string }>(
      db,
      `SELECT slug, nav_label, title FROM site_pages
        WHERE org_id = ? AND status = 'published' AND nav_order IS NOT NULL
        ORDER BY nav_order, title`,
      shop.orgId
    ),
    first<{ kit_json: string }>(db, `SELECT kit_json FROM brand_kits WHERE org_id = ?`, shop.orgId),
    first<{
      street: string | null;
      city: string | null;
      state: string | null;
      postal_code: string | null;
      phone: string | null;
      settings_json: string;
    }>(
      db,
      `SELECT street, city, state, postal_code, phone, settings_json FROM orgs WHERE id = ?`,
      shop.orgId
    ),
    all<{ tag_color: string; discount_pct: number; age_days: number }>(
      db,
      `SELECT tag_color, discount_pct, age_days FROM markdown_rules
        WHERE org_id = ? AND is_active = 1 ORDER BY week_index`,
      shop.orgId
    ),
  ]);

  // A shop that has never opened the editor still gets a real page. The
  // front page falls back to a sensible default; any other slug must exist.
  if (!page && pageSlug !== "") return null;
  if (page && page.status !== "published" && !opts.allowDraft) return null;

  const blocks = page ? parseBlocks(page.blocks_json) : DEFAULT_HOME;
  const kit = parseBrandKit(kitRow?.kit_json);
  const type = typefaceFor(kit);

  // The typed parser, not a hand-rolled JSON.parse. This file used to read
  // `openingHours`, `accepted` and `notAccepted` out of an untyped blob that
  // nothing on earth ever wrote — so a shop's hours and donation lists could
  // never appear on its own website, and nothing failed to say so. That is the
  // same shape as the tax bug, and app/lib/settings.ts exists to end it.
  const settings = parseOrgSettings(org?.settings_json);

  // Only query for what the page actually shows. A page with no featured
  // block shouldn't cost an inventory scan.
  const kinds = new Set(blocks.map((b) => b.kind));

  const [featured, impact, openShifts] = await Promise.all([
    kinds.has("featured")
      ? all<{
          id: string;
          title: string;
          category: string | null;
          price_cents: number;
          tag_color: string | null;
          intake_date: string;
          photo_key: string | null;
        }>(
          db,
          // No `listed_online = 1` here, deliberately. That column defaults
          // to 0 and nothing in the application has ever written it — with the
          // condition in place this block was empty on every shop's website,
          // permanently, and nothing failed to say so. The block is already
          // opt-in at the page level; requiring a second per-item opt-in with
          // no screen to give it is how a feature ends up blank forever.
          //
          // The column stays, unread, for the per-item "keep this off our
          // website" control that doesn't exist yet. Whoever builds that adds
          // the condition back here, in this one place, alongside the writer.
          // A reviewed cut-out wins over the snapshot it came from — a grid of
          // mixed backgrounds is the exact thing the tidy-up exists to fix, and
          // showing the tidy version on the item page but not in the grid is
          // worse than not having it. Unreviewed, it's the original: nobody has
          // said the cut-out is a fair picture of the goods yet.
          `SELECT id, title, category, price_cents, tag_color, intake_date,
                  CASE WHEN photo_enhanced_at IS NOT NULL AND photo_enhanced_key IS NOT NULL
                       THEN photo_enhanced_key ELSE photo_key END AS photo_key
             FROM items
            WHERE org_id = ? AND status = 'available' AND price_cents > 0
              AND ${realOnly()}
            -- Photographed stock first. Every shop puts its best in the window,
            -- and a grid where a third of the tiles are a title and a price
            -- reads as a site that's broken rather than a shop that's busy.
            -- Newest-first within that, so it's still what came in recently.
            ORDER BY (photo_key IS NOT NULL) DESC, created_at DESC LIMIT 12`,
          shop.orgId
        )
      : Promise.resolve([]),
    kinds.has("impact")
      ? first<{
          diversion_lbs: number;
          items_rehomed: number;
          volunteer_hours: number;
          value_delivered: number;
        }>(
          db,
          `SELECT
             COALESCE((SELECT SUM(weight_lbs) FROM items
                        WHERE org_id = ?1 AND ${realOnly()}
                          AND status IN (${DIVERTED_STATUS_SQL})), 0) AS diversion_lbs,
             (SELECT COUNT(*) FROM items
               WHERE org_id = ?1 AND ${realOnly()} AND status = 'sold') AS items_rehomed,
             COALESCE((SELECT SUM(hours_logged) FROM shifts
                        WHERE org_id = ?1 AND ${realOnly()} AND status = 'completed'), 0) AS volunteer_hours,
             COALESCE((SELECT SUM(MAX(ti.retail_estimate_cents - ti.price_cents, 0))
                         FROM transaction_items ti JOIN transactions t ON t.id = ti.transaction_id
                        WHERE ti.org_id = ?1 AND ${realOnly("t")}
                          AND t.voided_at IS NULL), 0) AS value_delivered`,
          shop.orgId
        )
      : Promise.resolve(null),
    kinds.has("volunteer")
      ? all<{ role_label: string; starts_at: string }>(
          db,
          `SELECT role_label, starts_at FROM shifts
            WHERE org_id = ? AND status = 'scheduled' AND contact_id IS NULL
              AND starts_at > datetime('now') AND ${realOnly()}
            ORDER BY starts_at LIMIT 6`,
          shop.orgId
        )
      : Promise.resolve([]),
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

  const addressLines = [
    org?.street ?? "",
    [[org?.city, org?.state].filter(Boolean).join(", "), org?.postal_code].filter(Boolean).join(" "),
  ]
    .map((l) => l.trim())
    .filter(Boolean);

  const data: PageData = {
    base: shop.base,
    shopName: shop.name,
    tagline: kit.tagline,
    addressLines,
    phone: org?.phone ?? null,
    hours: hourLines(settings.openingHours),
    donationHours: hourLines(settings.donationHours),
    accepted: listLines(settings.accepted),
    notAccepted: listLines(settings.notAccepted),
    ladder: ladder.map((r) => ({
      tagColor: r.tagColor,
      discountPct: r.discountPct,
      ageDays: r.ageDays,
    })),
    featured: featured.map((item) => {
      const shape = {
        priceCents: item.price_cents,
        tagColor: item.tag_color,
        intakeDate: item.intake_date,
      };
      return {
        id: item.id,
        title: item.title,
        category: item.category,
        priceCents: effectivePriceCents(shape, ladder),
        listPriceCents: item.price_cents,
        discountPct: currentDiscountPct(shape, ladder),
        photoKey: item.photo_key,
      };
    }),
    impact: impact
      ? {
          diversionLbs: Number(impact.diversion_lbs ?? 0),
          itemsRehomed: Number(impact.items_rehomed ?? 0),
          volunteerHours: Number(impact.volunteer_hours ?? 0),
          valueDeliveredCents: Number(impact.value_delivered ?? 0),
        }
      : null,
    openShifts: openShifts.map((s) => ({
      label: s.role_label.charAt(0).toUpperCase() + s.role_label.slice(1),
      when: new Date(s.starts_at).toLocaleDateString("en-US", {
        weekday: "long",
        month: "short",
        day: "numeric",
      }),
    })),
  };

  return {
    shop,
    kit,
    palette: renderPalette(kit),
    fonts: { display: type.display, body: type.body },
    blocks,
    data,
    nav: navPages.map((p) => ({ slug: p.slug, label: p.nav_label || p.title })),
    seo: {
      title: page?.seo_title || page?.title || shop.name,
      description:
        page?.seo_description ||
        kit.tagline ||
        `Second-hand goods at ${shop.name}. Everything is one of a kind.`,
    },
    isDraft: Boolean(page && page.status !== "published"),
  };
}

/* ─── Chrome for the shop's own pages ────────────────────────────────────── */

export interface ShopChrome {
  shop: ResolvedShop;
  kit: BrandKit;
  palette: ReturnType<typeof renderPalette>;
  fonts: { display: string; body: string };
  nav: { slug: string; label: string }[];
  /** False when the shop hasn't switched selling on, or Stripe isn't connected. */
  sellingOnline: boolean;
  pickupEnabled: boolean;
  pickupInstructions: string;
}

/**
 * Everything a shop page that isn't a CMS page needs: the item page, the
 * basket, the checkout, the order confirmation.
 *
 * Separate from loadStorefrontPage because those pages have no blocks and
 * shouldn't pay for a featured-stock query or an impact rollup to render a
 * basket. They do need the shop's brand, so the basket looks like the shop
 * rather than like us.
 */
export async function loadShopChrome(
  db: D1Database,
  shop: ResolvedShop
): Promise<ShopChrome> {
  const [kitRow, org, navPages, account] = await Promise.all([
    first<{ kit_json: string }>(db, `SELECT kit_json FROM brand_kits WHERE org_id = ?`, shop.orgId),
    first<{ settings_json: string }>(
      db,
      `SELECT settings_json FROM orgs WHERE id = ?`,
      shop.orgId
    ),
    all<{ slug: string; nav_label: string | null; title: string }>(
      db,
      `SELECT slug, nav_label, title FROM site_pages
        WHERE org_id = ? AND status = 'published' AND nav_order IS NOT NULL
        ORDER BY nav_order, title`,
      shop.orgId
    ),
    first<{ charges_enabled: number }>(
      db,
      `SELECT charges_enabled FROM stripe_accounts WHERE org_id = ?`,
      shop.orgId
    ),
  ]);

  const kit = parseBrandKit(kitRow?.kit_json);
  const type = typefaceFor(kit);
  const settings = parseOrgSettings(org?.settings_json);

  return {
    shop,
    kit,
    palette: renderPalette(kit),
    fonts: { display: type.display, body: type.body },
    nav: navPages.map((p) => ({ slug: p.slug, label: p.nav_label || p.title })),
    // Both, not either. A shop can switch selling on before finishing Stripe,
    // and a buy button that leads to "this shop can't take payments" is worse
    // than no buy button.
    sellingOnline: settings.onlineSelling && Number(account?.charges_enabled ?? 0) === 1,
    pickupEnabled: settings.pickupEnabled,
    pickupInstructions: settings.pickupInstructions,
  };
}
