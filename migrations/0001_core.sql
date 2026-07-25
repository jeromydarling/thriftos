-- 0001_core — orgs (the store), users, sessions, contacts (the CRM spine), locations.
-- Every table below row one is org-scoped. Subsidiarity: the store owns its data.

CREATE TABLE orgs (
  id                TEXT PRIMARY KEY,              -- og_...
  slug              TEXT NOT NULL UNIQUE,
  name              TEXT NOT NULL,
  legal_name        TEXT,
  ein               TEXT,                          -- for IRS-compliant receipts
  street            TEXT,
  city              TEXT,
  state             TEXT,
  postal_code       TEXT,
  country           TEXT NOT NULL DEFAULT 'US',
  phone             TEXT,
  email             TEXT,
  timezone          TEXT NOT NULL DEFAULT 'America/New_York',
  is_nonprofit      INTEGER NOT NULL DEFAULT 1,    -- 0/1
  plan              TEXT NOT NULL DEFAULT 'stall', -- see app/lib/pricing.ts
  status            TEXT NOT NULL DEFAULT 'active',
  is_demo           INTEGER NOT NULL DEFAULT 0,
  -- brand tokens (per-store look, editable)
  brand_primary     TEXT NOT NULL DEFAULT '#2F6F5E',
  brand_accent      TEXT NOT NULL DEFAULT '#E4A33C',
  brand_wordmark    TEXT,
  -- store-local policy, always the store's call
  settings_json     TEXT NOT NULL DEFAULT '{}',
  federation_group_id TEXT,
  stripe_account_id TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_orgs_federation ON orgs (federation_group_id);

CREATE TABLE users (
  id            TEXT PRIMARY KEY,                  -- us_...
  org_id        TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  email         TEXT NOT NULL,
  name          TEXT NOT NULL,
  password_hash TEXT,                              -- PBKDF2, never reversible
  password_salt TEXT,
  role          TEXT NOT NULL DEFAULT 'volunteer', -- owner | admin | staff | volunteer
  status        TEXT NOT NULL DEFAULT 'active',
  last_login_at TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX idx_users_org_email ON users (org_id, email);
CREATE INDEX idx_users_email ON users (email);

CREATE TABLE sessions (
  token      TEXT PRIMARY KEY,                     -- opaque, HttpOnly cookie
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_id     TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_sessions_user ON sessions (user_id);
CREATE INDEX idx_sessions_expires ON sessions (expires_at);

CREATE TABLE invites (
  id          TEXT PRIMARY KEY,                    -- iv_...
  org_id      TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  email       TEXT NOT NULL,
  role        TEXT NOT NULL DEFAULT 'volunteer',
  token_hash  TEXT NOT NULL UNIQUE,                -- one-time; invitee sets own password
  invited_by  TEXT REFERENCES users(id),
  expires_at  TEXT NOT NULL,
  accepted_at TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_invites_org ON invites (org_id);

CREATE TABLE password_resets (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,                 -- hashed at rest, single use, 1h
  expires_at TEXT NOT NULL,
  used_at    TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE locations (
  id         TEXT PRIMARY KEY,                     -- lo_...
  org_id     TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  kind       TEXT NOT NULL DEFAULT 'salesfloor',   -- salesfloor | backroom | warehouse | outlet
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_locations_org ON locations (org_id);

-- One gentle contacts table. Roles stack: a person can be donor + shopper + volunteer.
CREATE TABLE contacts (
  id            TEXT PRIMARY KEY,                  -- ct_...
  org_id        TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  email         TEXT,
  phone         TEXT,
  street        TEXT,
  city          TEXT,
  state         TEXT,
  postal_code   TEXT,
  roles         TEXT NOT NULL DEFAULT '',          -- comma-list: donor,shopper,volunteer,worker,referrer
  notes         TEXT,
  is_subscribed INTEGER NOT NULL DEFAULT 1,        -- polite one-click unsubscribe
  first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at  TEXT NOT NULL DEFAULT (datetime('now')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Keyset pagination: WHERE (name, id) > (?, ?) ORDER BY name, id
CREATE INDEX idx_contacts_keyset ON contacts (org_id, name, id);
CREATE INDEX idx_contacts_email ON contacts (org_id, email);

CREATE TABLE audit_log (
  id         TEXT PRIMARY KEY,
  org_id     TEXT NOT NULL,
  user_id    TEXT,
  action     TEXT NOT NULL,
  entity     TEXT,
  entity_id  TEXT,
  meta_json  TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_audit_org_created ON audit_log (org_id, created_at DESC);
