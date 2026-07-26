-- 0016_alerts — telling someone when something needs a person.
--
-- Everything this raises was already detectable: a failed webhook sat in
-- stripe_events, a dispute deadline sat in disputes.evidence_due_at, a failed
-- payout wrote an audit row. All of it was true, recorded, and read by nobody.
--
-- The documentation says "a dispute nobody answers is lost by default" and
-- then didn't build the thing that stops that happening. This is that thing.

CREATE TABLE alerts (
  id            TEXT PRIMARY KEY,                   -- ax_...
  -- Null for platform-wide problems that aren't any one shop's fault.
  org_id        TEXT REFERENCES orgs(id) ON DELETE CASCADE,
  -- dispute_deadline | webhook_failed | payout_failed | payment_stranded
  -- | connect_disabled | reader_failing | reconciliation_mismatch
  kind          TEXT NOT NULL,
  -- critical: money or a deadline is at stake and a person must act today.
  -- warning:  worth looking at this week.
  -- info:     recorded so it's visible, no action implied.
  severity      TEXT NOT NULL DEFAULT 'warning',
  title         TEXT NOT NULL,
  -- Written for the person who has to fix it, in the words they'd use.
  body          TEXT NOT NULL,
  -- Where to go and do something about it.
  href          TEXT,
  -- What this alert is about. Raising the same alert twice for the same
  -- problem is refused by the unique index below, so a cron that runs daily
  -- doesn't produce a daily pile of identical rows.
  dedupe_key    TEXT NOT NULL,
  -- Set when a person has seen it. Nothing is auto-cleared: an alert that
  -- disappears on its own is one nobody can prove they were shown.
  acknowledged_at TEXT,
  acknowledged_by TEXT REFERENCES users(id),
  -- Set when the underlying condition is gone. Kept rather than deleted, so
  -- "how often does this happen to us" stays answerable.
  resolved_at   TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX idx_alerts_dedupe ON alerts (kind, dedupe_key);
CREATE INDEX idx_alerts_open ON alerts (org_id, resolved_at, severity, created_at DESC);
CREATE INDEX idx_alerts_kind ON alerts (kind, created_at DESC);
