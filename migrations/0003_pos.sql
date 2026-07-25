-- 0003_pos — checkout. Offline-tolerant: the register keeps working when the internet doesn't.

CREATE TABLE transactions (
  id                TEXT PRIMARY KEY,              -- tx_...
  org_id            TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  location_id       TEXT REFERENCES locations(id),
  contact_id        TEXT REFERENCES contacts(id),  -- optional: shoppers stay anonymous by default
  cashier_user_id   TEXT REFERENCES users(id),
  subtotal_cents    INTEGER NOT NULL DEFAULT 0,
  discount_cents    INTEGER NOT NULL DEFAULT 0,
  tax_cents         INTEGER NOT NULL DEFAULT 0,
  roundup_cents     INTEGER NOT NULL DEFAULT 0,    -- round-up-for-donation at checkout
  total_cents       INTEGER NOT NULL DEFAULT 0,
  tender            TEXT NOT NULL DEFAULT 'cash',  -- cash | card | terminal | other
  tax_exempt        INTEGER NOT NULL DEFAULT 0,
  tax_exempt_ref    TEXT,                          -- certificate number on file
  stripe_payment_intent_id TEXT,
  -- Offline queue: the register stamps a client id so a replayed sync never double-charges.
  offline_id        TEXT,
  synced_at         TEXT,
  voided_at         TEXT,
  void_reason       TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_tx_org_created ON transactions (org_id, created_at DESC);
CREATE UNIQUE INDEX idx_tx_offline ON transactions (org_id, offline_id) WHERE offline_id IS NOT NULL;
CREATE INDEX idx_tx_contact ON transactions (contact_id);

CREATE TABLE transaction_items (
  id             TEXT PRIMARY KEY,
  org_id         TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  item_id        TEXT REFERENCES items(id),
  title          TEXT NOT NULL,                    -- snapshot: the receipt must not change later
  category       TEXT,
  price_cents    INTEGER NOT NULL DEFAULT 0,
  markdown_cents INTEGER NOT NULL DEFAULT 0,       -- what the shopper saved off the tag
  retail_estimate_cents INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_txitems_tx ON transaction_items (transaction_id);
CREATE INDEX idx_txitems_item ON transaction_items (item_id);
