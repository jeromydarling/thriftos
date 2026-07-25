-- 0004_people_impact — volunteers, hours, patronage, and common-good reporting.
-- Solidarity: the people who make the store work are first-class records, not a footnote.

CREATE TABLE shifts (
  id           TEXT PRIMARY KEY,                   -- sh_...
  org_id       TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  location_id  TEXT REFERENCES locations(id),
  contact_id   TEXT REFERENCES contacts(id),       -- volunteers are contacts with a stacked role
  user_id      TEXT REFERENCES users(id),          -- staff who also log in
  role_label   TEXT NOT NULL DEFAULT 'floor',      -- floor | sorting | register | pickup | ...
  starts_at    TEXT NOT NULL,
  ends_at      TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'scheduled',  -- scheduled | confirmed | completed | no_show | cancelled
  hours_logged REAL NOT NULL DEFAULT 0,
  notes        TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_shifts_org_start ON shifts (org_id, starts_at);
CREATE INDEX idx_shifts_contact ON shifts (contact_id);
CREATE INDEX idx_shifts_status ON shifts (org_id, status);

-- Optional, off by default. Only worker-run co-ops turn this on.
CREATE TABLE patronage_ledger (
  id            TEXT PRIMARY KEY,                  -- pl_...
  org_id        TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  contact_id    TEXT REFERENCES contacts(id),
  user_id       TEXT REFERENCES users(id),
  period_start  TEXT NOT NULL,
  period_end    TEXT NOT NULL,
  hours         REAL NOT NULL DEFAULT 0,
  basis         TEXT NOT NULL DEFAULT 'hours',     -- hours | sales
  share_bps     INTEGER NOT NULL DEFAULT 0,        -- basis points of the distributable pool
  allocated_cents INTEGER NOT NULL DEFAULT 0,      -- computed, never auto-paid
  status        TEXT NOT NULL DEFAULT 'draft',     -- draft | approved | distributed
  notes         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_patronage_org_period ON patronage_ledger (org_id, period_start);

-- Rolled up nightly. Revenue sits beside these, never above them.
CREATE TABLE impact_metrics (
  id                    TEXT PRIMARY KEY,          -- im_...
  org_id                TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  period_start          TEXT NOT NULL,
  period_end            TEXT NOT NULL,
  period_kind           TEXT NOT NULL DEFAULT 'month', -- day | week | month | year
  diversion_lbs         REAL NOT NULL DEFAULT 0,   -- weight kept out of landfill
  items_rehomed         INTEGER NOT NULL DEFAULT 0,
  value_delivered_cents INTEGER NOT NULL DEFAULT 0,-- retail estimate minus what shoppers paid
  volunteer_hours       REAL NOT NULL DEFAULT 0,
  volunteer_headcount   INTEGER NOT NULL DEFAULT 0,
  paid_hours            REAL NOT NULL DEFAULT 0,
  revenue_cents         INTEGER NOT NULL DEFAULT 0,
  donations_received    INTEGER NOT NULL DEFAULT 0,
  computed_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX idx_impact_org_period ON impact_metrics (org_id, period_kind, period_start);
