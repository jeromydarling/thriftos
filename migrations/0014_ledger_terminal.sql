-- 0014_ledger_terminal — the money half of the system.
--
-- Steps 4 through 7 of the payments build: an immutable ledger, payment
-- attempts, cash drawer sessions, Terminal readers, refunds, and disputes.
--
-- The governing idea is that a transaction row records what a sale *is*, and
-- the ledger records what *happened*. Those are different questions, and a
-- system that only stores current totals can answer the first but not the
-- second. When a shop asks "why is my payout $18.40 less than my sales?" the
-- answer is a list of events, not a column.

/* ─── Payment attempts ──────────────────────────────────────────────────── */

-- One row per attempt to collect money for a transaction. A transaction can
-- have several: a declined tap, a retry, a cancelled reader session.
--
-- This is what makes "retry without double-charging" possible. The idempotency
-- key is generated once per attempt and reused for every retry of that same
-- attempt, so a network failure mid-request cannot produce two charges.
CREATE TABLE payment_attempts (
  id                  TEXT PRIMARY KEY,              -- pa_...
  org_id              TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  transaction_id      TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  attempt_number      INTEGER NOT NULL DEFAULT 1,
  tender              TEXT NOT NULL,                 -- card | terminal
  state               TEXT NOT NULL DEFAULT 'draft', -- mirrors PaymentState
  amount_cents        INTEGER NOT NULL,
  currency            TEXT NOT NULL DEFAULT 'usd',
  -- Sent to Stripe on every request for this attempt. Never reused across
  -- attempts, always reused within one.
  idempotency_key     TEXT NOT NULL,
  stripe_payment_intent_id TEXT,
  stripe_charge_id    TEXT,
  reader_id           TEXT,
  -- What the shop should be told, in words, when this failed.
  failure_code        TEXT,
  failure_message     TEXT,
  -- The fee as quoted at the moment of the attempt, so a later policy change
  -- can't retroactively alter what was charged.
  platform_fee_cents  INTEGER NOT NULL DEFAULT 0,
  fee_base_cents      INTEGER NOT NULL DEFAULT 0,
  created_by          TEXT REFERENCES users(id),
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at         TEXT
);

CREATE UNIQUE INDEX idx_attempts_idem ON payment_attempts (org_id, idempotency_key);
CREATE INDEX idx_attempts_tx ON payment_attempts (transaction_id, attempt_number);
CREATE INDEX idx_attempts_pi ON payment_attempts (stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;
CREATE INDEX idx_attempts_open ON payment_attempts (org_id, state, created_at DESC);

/* ─── The ledger ────────────────────────────────────────────────────────── */

-- Append-only. Nothing in here is ever updated or deleted; a mistake is
-- corrected by writing an opposing entry, exactly as a paper ledger would.
-- That is what makes the history defensible to an auditor a year later.
CREATE TABLE ledger_entries (
  id             TEXT PRIMARY KEY,                   -- le_...
  org_id         TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  -- gross_sale | tax | round_up | platform_fee | stripe_processing_fee
  -- | connected_account_transfer | refund | application_fee_refund
  -- | transfer_reversal | dispute | dispute_fee | cash_sale | cash_variance
  entry_type     TEXT NOT NULL,
  transaction_id TEXT REFERENCES transactions(id) ON DELETE SET NULL,
  attempt_id     TEXT REFERENCES payment_attempts(id) ON DELETE SET NULL,
  shift_id       TEXT,                               -- register_shifts.id
  -- The Stripe object this entry describes, when there is one.
  stripe_object_id TEXT,
  -- Signed. Money into the shop is positive; money out is negative. Costs are
  -- stored negative rather than as positive "cost" values so that a plain SUM
  -- over any slice of the ledger is the net, with no per-type sign table to
  -- get wrong.
  amount_cents   INTEGER NOT NULL,
  currency       TEXT NOT NULL DEFAULT 'usd',
  occurred_at    TEXT NOT NULL DEFAULT (datetime('now')),
  -- pos | stripe_webhook | reconciliation | manual
  source         TEXT NOT NULL DEFAULT 'pos',
  -- What this entry represents, stated by whoever wrote it — e.g.
  -- "gross_sale:tx_abc" or "dispute:dp_xyz". A replayed webhook computes the
  -- same key and is refused by the unique index below rather than doubling
  -- the books. See idx_ledger_dedupe.
  dedupe_key     TEXT NOT NULL,
  metadata_json  TEXT NOT NULL DEFAULT '{}',
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_ledger_org_time ON ledger_entries (org_id, occurred_at DESC);
CREATE INDEX idx_ledger_type ON ledger_entries (org_id, entry_type, occurred_at DESC);
CREATE INDEX idx_ledger_tx ON ledger_entries (transaction_id);
CREATE INDEX idx_ledger_shift ON ledger_entries (shift_id) WHERE shift_id IS NOT NULL;

-- Writing the same entry twice — a replayed webhook, a retried handler — must
-- not double the books. Every writer supplies a key describing what the entry
-- represents, and this index refuses the second one.
CREATE UNIQUE INDEX idx_ledger_dedupe ON ledger_entries (org_id, entry_type, dedupe_key);

/* ─── Registers and drawer sessions ─────────────────────────────────────── */

CREATE TABLE registers (
  id           TEXT PRIMARY KEY,                     -- rg_...
  org_id       TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  location_id  TEXT REFERENCES locations(id),
  name         TEXT NOT NULL,                        -- "Front counter"
  -- The Terminal reader normally paired with this register, if any.
  reader_id    TEXT,
  is_active    INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_registers_org ON registers (org_id, is_active);

-- A drawer session: opened with a counted float, closed with a counted total.
-- Named register_shifts to keep it distinct from `shifts`, which is volunteer
-- rota and an entirely different thing.
CREATE TABLE register_shifts (
  id                TEXT PRIMARY KEY,                -- rs_...
  org_id            TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  register_id       TEXT REFERENCES registers(id),
  opened_by         TEXT REFERENCES users(id),
  closed_by         TEXT REFERENCES users(id),
  opening_float_cents INTEGER NOT NULL DEFAULT 0,
  -- What the person actually counted at close. Null until closed.
  counted_cents     INTEGER,
  -- What the system says should be there: float + cash sales - cash refunds
  -- - paid outs. Computed at close and frozen, so a later backdated sale
  -- cannot silently change a variance somebody already signed off.
  expected_cents    INTEGER,
  variance_cents    INTEGER,
  note              TEXT,
  status            TEXT NOT NULL DEFAULT 'open',    -- open | closed
  opened_at         TEXT NOT NULL DEFAULT (datetime('now')),
  closed_at         TEXT
);

CREATE INDEX idx_regshifts_org ON register_shifts (org_id, opened_at DESC);
CREATE INDEX idx_regshifts_open ON register_shifts (org_id, status, register_id);

-- Cash movements that aren't sales: a float top-up, a petty-cash payout, a
-- safe drop. Without these the variance figure blames the cashier for money
-- that left the drawer legitimately.
CREATE TABLE cash_movements (
  id           TEXT PRIMARY KEY,                     -- cm_...
  org_id       TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  shift_id     TEXT NOT NULL REFERENCES register_shifts(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL,                        -- pay_in | pay_out | drop
  amount_cents INTEGER NOT NULL,                     -- always positive
  reason       TEXT NOT NULL,
  created_by   TEXT REFERENCES users(id),
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_cash_moves_shift ON cash_movements (shift_id);

/* ─── Terminal ──────────────────────────────────────────────────────────── */

CREATE TABLE terminal_locations (
  id                  TEXT PRIMARY KEY,              -- tl_...
  org_id              TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  location_id         TEXT REFERENCES locations(id),
  stripe_location_id  TEXT NOT NULL,                 -- tml_...
  display_name        TEXT NOT NULL,
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX idx_term_loc_stripe ON terminal_locations (stripe_location_id);
CREATE INDEX idx_term_loc_org ON terminal_locations (org_id);

CREATE TABLE terminal_readers (
  id                  TEXT PRIMARY KEY,              -- tr_...
  org_id              TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  terminal_location_id TEXT REFERENCES terminal_locations(id) ON DELETE CASCADE,
  stripe_reader_id    TEXT NOT NULL,                 -- tmr_...
  label               TEXT NOT NULL,
  device_type         TEXT,                          -- bbpos_wisepos_e | simulated_wisepos_e | ...
  serial_number       TEXT,
  -- online | offline — Stripe's word for it, never inferred locally.
  status              TEXT NOT NULL DEFAULT 'offline',
  -- A simulated reader behaves like hardware but takes no money. Marked so the
  -- register can say so rather than letting somebody believe a sale was real.
  is_simulated        INTEGER NOT NULL DEFAULT 0,
  last_seen_at        TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX idx_readers_stripe ON terminal_readers (stripe_reader_id);
CREATE INDEX idx_readers_org ON terminal_readers (org_id, status);

/* ─── Refunds and disputes ──────────────────────────────────────────────── */

CREATE TABLE refunds (
  id                  TEXT PRIMARY KEY,              -- rf_...
  org_id              TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  transaction_id      TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  attempt_id          TEXT REFERENCES payment_attempts(id),
  stripe_refund_id    TEXT,
  amount_cents        INTEGER NOT NULL,
  -- The share of the platform fee handed back with it. Stripe does not do this
  -- automatically; keeping a shop's fee on money it no longer has would be
  -- indefensible, so we reverse it proportionally.
  fee_refund_cents    INTEGER NOT NULL DEFAULT 0,
  reason              TEXT,                          -- our word, for the shop
  stripe_reason       TEXT,                          -- requested_by_customer | duplicate | fraudulent
  -- restock | keep — whether the goods came back.
  restock             INTEGER NOT NULL DEFAULT 1,
  tender              TEXT NOT NULL DEFAULT 'card',  -- cash refunds never touch Stripe
  status              TEXT NOT NULL DEFAULT 'pending', -- pending | succeeded | failed
  idempotency_key     TEXT NOT NULL,
  failure_message     TEXT,
  created_by          TEXT REFERENCES users(id),
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at         TEXT
);

CREATE UNIQUE INDEX idx_refunds_idem ON refunds (org_id, idempotency_key);
CREATE UNIQUE INDEX idx_refunds_stripe ON refunds (stripe_refund_id)
  WHERE stripe_refund_id IS NOT NULL;
CREATE INDEX idx_refunds_tx ON refunds (transaction_id);
CREATE INDEX idx_refunds_org ON refunds (org_id, created_at DESC);

CREATE TABLE disputes (
  id                  TEXT PRIMARY KEY,              -- dp_...
  org_id              TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  transaction_id      TEXT REFERENCES transactions(id) ON DELETE SET NULL,
  stripe_dispute_id   TEXT NOT NULL,
  stripe_charge_id    TEXT,
  amount_cents        INTEGER NOT NULL,
  -- Stripe's fee for handling the dispute. On destination charges this lands
  -- on the platform, which is the cost of the merchant-of-record choice and
  -- belongs in platform unit economics, not in the shop's books.
  fee_cents           INTEGER NOT NULL DEFAULT 0,
  reason              TEXT,
  status              TEXT NOT NULL,                 -- warning_needs_response | needs_response | under_review | won | lost
  evidence_due_at     TEXT,
  -- Set when a person has been told. Disputes have deadlines; a dispute nobody
  -- noticed is a dispute lost by default.
  acknowledged_at     TEXT,
  acknowledged_by     TEXT REFERENCES users(id),
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX idx_disputes_stripe ON disputes (stripe_dispute_id);
CREATE INDEX idx_disputes_org ON disputes (org_id, status, created_at DESC);

/* ─── Columns on existing tables ────────────────────────────────────────── */

-- Which drawer session a sale belongs to, so reconciliation has something to
-- add up. Null for sales rung up outside an open session.
ALTER TABLE transactions ADD COLUMN shift_id TEXT;
ALTER TABLE transactions ADD COLUMN register_id TEXT;
-- Money actually returned, so a partially-refunded sale reports correctly
-- without summing the refunds table on every read.
ALTER TABLE transactions ADD COLUMN refunded_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE transactions ADD COLUMN fee_refunded_cents INTEGER NOT NULL DEFAULT 0;
-- What Stripe kept. Only known once the charge is available, so nullable.
-- (transactions.stripe_charge_id already exists — added in 0009_billing.)
ALTER TABLE transactions ADD COLUMN stripe_fee_cents INTEGER;

CREATE INDEX idx_tx_shift ON transactions (shift_id) WHERE shift_id IS NOT NULL;
CREATE INDEX idx_tx_charge ON transactions (stripe_charge_id) WHERE stripe_charge_id IS NOT NULL;

-- How many of a line's items came back, so a partial refund can restock
-- exactly what was returned rather than the whole sale.
ALTER TABLE transaction_items ADD COLUMN refunded_cents INTEGER NOT NULL DEFAULT 0;
