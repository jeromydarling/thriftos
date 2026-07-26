-- 0017_brand_site — the shop's own brand, its website, and its domain.
--
-- A thrift store's public face is usually a Facebook page and a laminated sign
-- somebody made in Word. Not because they don't care, but because a designer
-- costs money the shop doesn't have and a website builder is one more login to
-- forget. What ThriftOS has that no design tool does is the shop's live data —
-- which tags are half price today, what came in this morning, how much was kept
-- out of landfill last quarter. That's what makes an asset generated here worth
-- more than the same asset made anywhere else.

-- Reserved words: slugs a shop may never claim, because they're ours.
--
-- A shop's page lives at /{slug}, so its slug shares a namespace with every
-- system route. A table rather than a code constant so that adding a marketing
-- page tomorrow can't silently steal a shop's URL — the insert fails instead,
-- loudly, at deploy time.
CREATE TABLE reserved_slugs (
  slug   TEXT PRIMARY KEY,
  reason TEXT NOT NULL
);

INSERT INTO reserved_slugs (slug, reason) VALUES
  ('app', 'the application'),
  ('api', 'the API'),
  ('s', 'legacy storefront path'),
  ('r', 'customer receipts'),
  ('login', 'auth'),
  ('logout', 'auth'),
  ('signup', 'auth'),
  ('demo', 'the demo shop'),
  ('help', 'the help centre'),
  ('guides', 'the guides'),
  ('pricing', 'marketing'),
  ('compare', 'marketing'),
  ('nri', 'marketing'),
  ('stripe', 'payment round-trips'),
  ('robots.txt', 'machine-readable'),
  ('sitemap.xml', 'machine-readable'),
  ('llms.txt', 'machine-readable'),
  ('favicon.ico', 'browser convention'),
  ('favicon.svg', 'browser convention'),
  ('manifest.webmanifest', 'browser convention'),
  ('sw.js', 'service worker'),
  ('assets', 'build output'),
  ('admin', 'reserved for later'),
  ('status', 'reserved for later'),
  ('blog', 'reserved for later'),
  ('about', 'reserved for later'),
  ('legal', 'reserved for later'),
  ('privacy', 'reserved for later'),
  ('terms', 'reserved for later'),
  ('security', 'reserved for later'),
  ('contact', 'reserved for later'),
  ('www', 'ambiguous'),
  ('mail', 'ambiguous');

/* ─── Brand ─────────────────────────────────────────────────────────────── */

-- One brand kit per shop.
--
-- Stored as typed JSON rather than twenty columns because nothing here is ever
-- queried across shops — it's read whole, for one org, to render one page. The
-- parser in app/lib/brand.ts is the only reader and writer, which is the lesson
-- from the tax-key bug: a free-form blob with three call sites is how a shop
-- ends up charging no sales tax.
CREATE TABLE brand_kits (
  org_id        TEXT PRIMARY KEY REFERENCES orgs(id) ON DELETE CASCADE,
  kit_json      TEXT NOT NULL DEFAULT '{}',
  -- R2 keys. Null until a shop uploads something; every asset falls back to a
  -- wordmark drawn from the shop's name, so nothing ever renders broken.
  logo_key      TEXT,
  logo_mark_key TEXT,
  updated_by    TEXT REFERENCES users(id),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Assets a shop has generated and kept, so "the poster we made in March" is
-- findable rather than remade. The spec is stored, not the rendered file:
-- regenerating from live data means a sale sign reprinted in June shows June's
-- prices rather than March's.
CREATE TABLE brand_assets (
  id            TEXT PRIMARY KEY,                   -- ba_...
  org_id        TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL,                      -- see app/lib/studio/assets.ts
  title         TEXT NOT NULL,
  -- The inputs a person chose. Everything else comes from live data at render.
  spec_json     TEXT NOT NULL DEFAULT '{}',
  created_by    TEXT REFERENCES users(id),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_brand_assets_org ON brand_assets (org_id, created_at DESC);

/* ─── The shop's website ────────────────────────────────────────────────── */

-- Pages are a list of blocks. Blocks that show data — hours, featured stock,
-- impact figures, how to donate — read it live rather than storing a copy, so
-- a page written in January isn't quietly lying by March. That is the whole
-- argument for building this here rather than telling shops to use Squarespace.
CREATE TABLE site_pages (
  id            TEXT PRIMARY KEY,                   -- sp_...
  org_id        TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  -- '' is the shop's front page; anything else is /{shop}/{slug}.
  slug          TEXT NOT NULL DEFAULT '',
  title         TEXT NOT NULL,
  blocks_json   TEXT NOT NULL DEFAULT '[]',
  -- draft | published. A draft is visible to the shop and to nobody else.
  status        TEXT NOT NULL DEFAULT 'draft',
  -- Shown in the shop's own navigation, in this order. Null hides it.
  nav_order     INTEGER,
  nav_label     TEXT,
  seo_title     TEXT,
  seo_description TEXT,
  updated_by    TEXT REFERENCES users(id),
  published_at  TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX idx_site_pages_slug ON site_pages (org_id, slug);
CREATE INDEX idx_site_pages_nav ON site_pages (org_id, status, nav_order);

/* ─── Custom domains ────────────────────────────────────────────────────── */

-- Every shop is reachable at /{slug} for nothing. A custom domain is the
-- optional extra, served through Cloudflare for SaaS.
--
-- Status is never inferred from a DNS lookup we did ourselves — it's written
-- from what Cloudflare tells us, for the same reason payment state is written
-- from what Stripe tells us. A domain that looks right locally and isn't
-- provisioned is a shop's website down.
CREATE TABLE custom_domains (
  id                  TEXT PRIMARY KEY,             -- cd_...
  org_id              TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  hostname            TEXT NOT NULL,                -- shop.example.org
  -- Cloudflare's custom hostname id, once created.
  cf_hostname_id      TEXT,
  -- pending | verifying | active | failed | removed
  status              TEXT NOT NULL DEFAULT 'pending',
  -- What the shop must put in their DNS, verbatim, so support can read it back.
  verification_txt_name  TEXT,
  verification_txt_value TEXT,
  cname_target        TEXT,
  ssl_status          TEXT,
  last_error          TEXT,
  last_checked_at     TEXT,
  verified_at         TEXT,
  created_by          TEXT REFERENCES users(id),
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One shop per hostname, globally. Two shops claiming the same domain is a
-- routing ambiguity we must never have to resolve at request time.
CREATE UNIQUE INDEX idx_custom_domains_host ON custom_domains (hostname);
CREATE INDEX idx_custom_domains_org ON custom_domains (org_id, status);
