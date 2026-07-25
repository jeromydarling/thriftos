-- 0006_federation — optional shared infrastructure between stores.
--
-- Subsidiarity is the whole point: joining a federation shares nothing by default.
-- A store opts in per resource type, and can revoke any of them at any time
-- without leaving the group. Nothing here can be switched on for a store by
-- anyone other than that store.

CREATE TABLE federation_groups (
  id          TEXT PRIMARY KEY,                    -- fg_...
  slug        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  description TEXT,
  charter     TEXT,                                -- the group's own stated terms, in plain words
  created_by_org_id TEXT REFERENCES orgs(id),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE federation_links (
  id            TEXT PRIMARY KEY,                  -- fl_...
  group_id      TEXT NOT NULL REFERENCES federation_groups(id) ON DELETE CASCADE,
  org_id        TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  resource_type TEXT NOT NULL,                     -- reporting | wholesale | donors | inventory
  consented_at  TEXT NOT NULL DEFAULT (datetime('now')),
  consented_by  TEXT REFERENCES users(id),
  revoked_at    TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX idx_fedlink_unique ON federation_links (group_id, org_id, resource_type);
CREATE INDEX idx_fedlink_org ON federation_links (org_id, revoked_at);

-- Shared bulk/rag-out channel. A listing is visible only to orgs that opted into
-- 'wholesale' in the same group.
CREATE TABLE federation_offers (
  id           TEXT PRIMARY KEY,                   -- fo_...
  group_id     TEXT NOT NULL REFERENCES federation_groups(id) ON DELETE CASCADE,
  org_id       TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  description  TEXT,
  category     TEXT,
  quantity     INTEGER NOT NULL DEFAULT 0,
  weight_lbs   REAL NOT NULL DEFAULT 0,
  asking_cents INTEGER NOT NULL DEFAULT 0,
  status       TEXT NOT NULL DEFAULT 'open',       -- open | claimed | closed
  claimed_by_org_id TEXT REFERENCES orgs(id),
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_offers_group_status ON federation_offers (group_id, status, created_at DESC);
