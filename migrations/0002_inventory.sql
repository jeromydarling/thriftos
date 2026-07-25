-- 0002_inventory — unique-item inventory, donations, IRS receipts, color-tag markdown.
-- Thrift inventory is non-SKU: every item is one of one. That shapes everything here.

CREATE TABLE donations (
  id             TEXT PRIMARY KEY,                 -- dn_...
  org_id         TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  contact_id     TEXT REFERENCES contacts(id),     -- nullable: anonymous drop-offs are real
  kind           TEXT NOT NULL DEFAULT 'goods',    -- goods | cash
  received_at    TEXT NOT NULL DEFAULT (datetime('now')),
  received_by    TEXT REFERENCES users(id),
  item_count     INTEGER NOT NULL DEFAULT 0,
  est_weight_lbs REAL NOT NULL DEFAULT 0,          -- powers landfill-diversion reporting
  amount_cents   INTEGER NOT NULL DEFAULT 0,       -- cash donations only. Always integer cents.
  description    TEXT,                             -- donor's own description of goods
  notes          TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_donations_org_received ON donations (org_id, received_at DESC);
CREATE INDEX idx_donations_contact ON donations (contact_id);

-- IRS-compliant acknowledgement. The store never states a value for donated goods —
-- that is the donor's responsibility, and saying otherwise would be wrong.
CREATE TABLE donation_receipts (
  id             TEXT PRIMARY KEY,                 -- rc_...
  org_id         TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  donation_id    TEXT NOT NULL REFERENCES donations(id) ON DELETE CASCADE,
  contact_id     TEXT REFERENCES contacts(id),
  receipt_number TEXT NOT NULL,
  issued_at      TEXT NOT NULL DEFAULT (datetime('now')),
  description    TEXT NOT NULL,
  amount_cents   INTEGER NOT NULL DEFAULT 0,
  goods_services_statement TEXT NOT NULL,          -- required "no goods or services" language
  pdf_key        TEXT,                             -- R2 key
  emailed_at     TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX idx_receipts_org_number ON donation_receipts (org_id, receipt_number);
CREATE INDEX idx_receipts_contact ON donation_receipts (contact_id);

CREATE TABLE items (
  id                   TEXT PRIMARY KEY,           -- it_...
  org_id               TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  location_id          TEXT REFERENCES locations(id),
  donation_id          TEXT REFERENCES donations(id),
  tag_number           TEXT,                       -- printed on the barcode/QR tag
  title                TEXT NOT NULL,
  description          TEXT,
  category             TEXT,
  brand                TEXT,
  color                TEXT,
  size                 TEXT,
  material             TEXT,
  era                  TEXT,                       -- "1990s", "modern" — a guess, always labeled
  condition            TEXT NOT NULL DEFAULT 'good', -- new | excellent | good | fair | flawed
  condition_notes      TEXT,
  price_cents          INTEGER NOT NULL DEFAULT 0,
  original_price_cents INTEGER NOT NULL DEFAULT 0, -- pre-markdown, for value-delivered math
  retail_estimate_cents INTEGER NOT NULL DEFAULT 0,-- comparable new price, for value delivered
  weight_lbs           REAL NOT NULL DEFAULT 0,
  tag_color            TEXT,                       -- color-tag rotation → age-based markdown
  intake_date          TEXT NOT NULL DEFAULT (date('now')),
  status               TEXT NOT NULL DEFAULT 'available',
                       -- intake | available | sold | held | recycled | pulled | transferred
  photo_key            TEXT,                       -- R2 key
  ai_json              TEXT,                       -- raw vision output, kept for transparency
  ai_confidence        REAL,
  ai_accepted          INTEGER NOT NULL DEFAULT 0, -- did a human accept the guess as-is?
  listed_online        INTEGER NOT NULL DEFAULT 0,
  sold_at              TEXT,
  sold_price_cents     INTEGER,
  created_by           TEXT REFERENCES users(id),
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_items_org_status ON items (org_id, status, intake_date);
CREATE INDEX idx_items_keyset ON items (org_id, created_at DESC, id);
CREATE INDEX idx_items_tag_color ON items (org_id, tag_color, status);
CREATE INDEX idx_items_donation ON items (donation_id);
CREATE UNIQUE INDEX idx_items_org_tag ON items (org_id, tag_number) WHERE tag_number IS NOT NULL;

-- Color-tag rotation, configured per store. Subsidiarity: the store sets its own cadence.
CREATE TABLE markdown_rules (
  id            TEXT PRIMARY KEY,                  -- mr_...
  org_id        TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  tag_color     TEXT NOT NULL,                     -- green | yellow | blue | ...
  week_index    INTEGER NOT NULL,                  -- rotation position (0-based)
  discount_pct  INTEGER NOT NULL DEFAULT 0,        -- applied once the tag reaches age_days
  age_days      INTEGER NOT NULL DEFAULT 0,
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX idx_markdown_org_color ON markdown_rules (org_id, tag_color);
