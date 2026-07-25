-- 0005_nri — Narrative Relational Intelligence.
--
-- NRI recognizes, synthesizes, and prioritizes. It never decides.
-- Signals are generated deterministically from rules (see app/lib/nri/signals.ts);
-- AI is only ever used to phrase what the rules already found, and every AI write
-- is logged. Nothing here auto-sends, auto-publishes, or auto-contacts anyone.

CREATE TABLE nri_signals (
  id           TEXT PRIMARY KEY,                   -- ns_...
  org_id       TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL,                      -- check_in | connection | heads_up | celebration
  title        TEXT NOT NULL,
  summary      TEXT NOT NULL,
  -- Why am I seeing this? Every signal must be able to answer that.
  evidence_json TEXT NOT NULL DEFAULT '{}',
  confidence   TEXT NOT NULL DEFAULT 'moderate',   -- high | medium | moderate
  subject_type TEXT,                               -- contact | item | shift | org
  subject_id   TEXT,
  -- Re-running the generator must never duplicate a signal.
  dedupe_key   TEXT NOT NULL,
  period_start TEXT,
  dismissed_at TEXT,
  dismissed_by TEXT REFERENCES users(id),
  acted_at     TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX idx_nri_dedupe ON nri_signals (org_id, dedupe_key);
CREATE INDEX idx_nri_org_created ON nri_signals (org_id, created_at DESC);
CREATE INDEX idx_nri_open ON nri_signals (org_id, dismissed_at, created_at DESC);

-- The narrative half. Humans write these; NRI only ever gathers them.
CREATE TABLE nri_reflections (
  id           TEXT PRIMARY KEY,                   -- nr_...
  org_id       TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  author_id    TEXT REFERENCES users(id),
  signal_id    TEXT REFERENCES nri_signals(id) ON DELETE SET NULL,
  subject_type TEXT,                               -- contact | item | shift | org
  subject_id   TEXT,
  body         TEXT NOT NULL,
  is_private   INTEGER NOT NULL DEFAULT 1,         -- private by default, always
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_reflections_org_created ON nri_reflections (org_id, created_at DESC);
CREATE INDEX idx_reflections_subject ON nri_reflections (org_id, subject_type, subject_id);

-- Audit trail for every AI call. Budget-gated and rate-limited per org.
CREATE TABLE nri_ai_log (
  id           TEXT PRIMARY KEY,
  org_id       TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  user_id      TEXT REFERENCES users(id),
  purpose      TEXT NOT NULL,                      -- item_vision | item_copy | signal_phrasing | ...
  model        TEXT,
  ok           INTEGER NOT NULL DEFAULT 1,
  error        TEXT,
  input_chars  INTEGER NOT NULL DEFAULT 0,
  output_chars INTEGER NOT NULL DEFAULT 0,
  duration_ms  INTEGER NOT NULL DEFAULT 0,
  accepted     INTEGER,                            -- did a human keep the suggestion?
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_ailog_org_created ON nri_ai_log (org_id, created_at DESC);
CREATE INDEX idx_ailog_org_purpose ON nri_ai_log (org_id, purpose, created_at DESC);
