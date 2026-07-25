-- 0007_ops — email log, suppression, offline sync receipts, and the demo reset marker.

CREATE TABLE email_log (
  id         TEXT PRIMARY KEY,
  org_id     TEXT NOT NULL,
  to_email   TEXT NOT NULL,
  template   TEXT NOT NULL,
  subject    TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'logged',       -- logged (no key) | sent | failed
  error      TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_email_org_created ON email_log (org_id, created_at DESC);

-- Honoured across every send, forever. One click to leave, no argument.
CREATE TABLE email_suppressions (
  id         TEXT PRIMARY KEY,
  org_id     TEXT NOT NULL,
  email      TEXT NOT NULL,
  reason     TEXT NOT NULL DEFAULT 'unsubscribed', -- unsubscribed | bounced | complained
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX idx_suppress_org_email ON email_suppressions (org_id, email);

CREATE TABLE system_runs (
  id          TEXT PRIMARY KEY,
  job         TEXT NOT NULL,                       -- demo_reset | nri_weekly | impact_rollup | ...
  status      TEXT NOT NULL,                       -- ok | error
  stats_json  TEXT NOT NULL DEFAULT '{}',
  error       TEXT,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_runs_job_created ON system_runs (job, created_at DESC);
