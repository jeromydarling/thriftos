-- Somewhere for a shop to say "this is wrong" or "this should exist".
--
-- Stored before it's emailed, and on purpose in that order. A report that only
-- exists as an email is a report that's lost the moment a send fails, and the
-- one thing worse than a shop hitting a bug is a shop taking the trouble to
-- tell us and hearing nothing back because the message never left the building.
--
-- The context columns are filled in by the app, not typed by a person. Nobody
-- behind a counter should have to write a bug report; they should be able to
-- say "the price went weird" and have us already know which screen, which
-- shop, and which error.

CREATE TABLE feedback (
  id          TEXT PRIMARY KEY,
  org_id      TEXT NOT NULL,
  user_id     TEXT,
  -- 'bug' or 'idea'. Kept as text rather than a check constraint so a third
  -- kind doesn't need a migration on a table nobody's schema depends on.
  kind        TEXT NOT NULL DEFAULT 'bug',
  body        TEXT NOT NULL,
  -- The screen they were on. Pathname only: a query string here could carry a
  -- receipt token, and this table is read by people.
  path        TEXT,
  -- The Sentry event, when the report came out of an error we'd already seen.
  event_id    TEXT,
  user_agent  TEXT,
  -- 'new', 'seen', 'done'. For us, not for them.
  status      TEXT NOT NULL DEFAULT 'new',
  emailed_at  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_feedback_org_created ON feedback (org_id, created_at DESC);
CREATE INDEX idx_feedback_status ON feedback (status, created_at DESC);
