-- 0013_onboarding — the welcome checklist, and reversible data loads.
--
-- Sample data and CSV imports share one mechanism on purpose. Both create
-- records a shop may later want gone in one piece, and having a single
-- "everything this batch created" pointer means one undo path to get right
-- rather than two. Sample data is simply a batch with kind = 'sample'.

CREATE TABLE import_batches (
  id            TEXT PRIMARY KEY,                   -- ib_...
  org_id        TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL,                      -- sample | items | contacts | donations
  source        TEXT,                               -- filename, or 'sample-data'
  status        TEXT NOT NULL DEFAULT 'complete',   -- preview | complete | reversed
  rows_created  INTEGER NOT NULL DEFAULT 0,
  rows_updated  INTEGER NOT NULL DEFAULT 0,
  rows_skipped  INTEGER NOT NULL DEFAULT 0,
  -- Why rows were skipped, so the shop can fix the file rather than guess.
  notes_json    TEXT NOT NULL DEFAULT '{}',
  created_by    TEXT REFERENCES users(id),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  reversed_at   TEXT
);

CREATE INDEX idx_import_batches_org ON import_batches (org_id, created_at DESC);
CREATE INDEX idx_import_batches_kind ON import_batches (org_id, kind, status);

-- The pointer that makes a batch reversible. Null for anything a person
-- entered by hand, which is exactly what must never be removed by an undo.
ALTER TABLE items ADD COLUMN import_batch_id TEXT;
ALTER TABLE contacts ADD COLUMN import_batch_id TEXT;
ALTER TABLE donations ADD COLUMN import_batch_id TEXT;
ALTER TABLE transactions ADD COLUMN import_batch_id TEXT;
ALTER TABLE shifts ADD COLUMN import_batch_id TEXT;

-- Denormalised on purpose. Impact reporting, NRI, and billing all have to
-- exclude invented records, and those aggregates live in four different files.
-- "AND is_sample = 0" is a predicate that is hard to get wrong; a subquery
-- against import_batches on every rollup is one somebody eventually forgets.
--
-- Note this is NOT the same as "came from a batch": imported records are real
-- and must count. Only sample data is excluded.
ALTER TABLE items ADD COLUMN is_sample INTEGER NOT NULL DEFAULT 0;
ALTER TABLE contacts ADD COLUMN is_sample INTEGER NOT NULL DEFAULT 0;
ALTER TABLE donations ADD COLUMN is_sample INTEGER NOT NULL DEFAULT 0;
ALTER TABLE transactions ADD COLUMN is_sample INTEGER NOT NULL DEFAULT 0;
ALTER TABLE shifts ADD COLUMN is_sample INTEGER NOT NULL DEFAULT 0;

CREATE INDEX idx_items_batch ON items (org_id, import_batch_id)
  WHERE import_batch_id IS NOT NULL;
CREATE INDEX idx_contacts_batch ON contacts (org_id, import_batch_id)
  WHERE import_batch_id IS NOT NULL;
CREATE INDEX idx_donations_batch ON donations (org_id, import_batch_id)
  WHERE import_batch_id IS NOT NULL;
CREATE INDEX idx_transactions_batch ON transactions (org_id, import_batch_id)
  WHERE import_batch_id IS NOT NULL;
CREATE INDEX idx_shifts_batch ON shifts (org_id, import_batch_id)
  WHERE import_batch_id IS NOT NULL;

-- The welcome checklist. One row per org; steps are stored as a JSON map so
-- adding a step later doesn't need a migration.
CREATE TABLE onboarding_progress (
  org_id        TEXT PRIMARY KEY REFERENCES orgs(id) ON DELETE CASCADE,
  -- 'new' or 'migrating' — the path the shop chose, which changes what we ask.
  path          TEXT,
  steps_json    TEXT NOT NULL DEFAULT '{}',
  dismissed_at  TEXT,
  completed_at  TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
