-- 0012_connect — Stripe Connect accounts, and the Stripe event store.
--
-- Step 3 of the payments plan. Express accounts with destination charges: the
-- shop is merchant of record on the customer's statement, and the platform
-- carries Stripe fees, refunds, and dispute liability. That was an explicit
-- decision, not a default — see the payments audit.

CREATE TABLE stripe_accounts (
  id                  TEXT PRIMARY KEY,              -- sa_...
  org_id              TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  stripe_account_id   TEXT NOT NULL,                 -- acct_...
  account_type        TEXT NOT NULL DEFAULT 'express',
  -- The onboarding state machine. Never inferred from an HTTP redirect —
  -- only ever written from a verified Stripe object.
  status              TEXT NOT NULL DEFAULT 'not_started',
                      -- not_started | account_created | onboarding_incomplete
                      -- | requirements_due | pending_verification | enabled
                      -- | restricted | disabled
  charges_enabled     INTEGER NOT NULL DEFAULT 0,
  payouts_enabled     INTEGER NOT NULL DEFAULT 0,
  details_submitted   INTEGER NOT NULL DEFAULT 0,
  disabled_reason     TEXT,
  requirements_json   TEXT NOT NULL DEFAULT '{}',
  capabilities_json   TEXT NOT NULL DEFAULT '{}',
  country             TEXT NOT NULL DEFAULT 'US',
  default_currency    TEXT NOT NULL DEFAULT 'usd',
  -- When Stripe last told us something, so a stale local view is visible.
  last_synced_at      TEXT,
  deauthorized_at     TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One connected account per org. This unique index is what stops a restarted
-- onboarding from creating a second Stripe account and orphaning the first.
CREATE UNIQUE INDEX idx_stripe_accounts_org ON stripe_accounts (org_id);
CREATE UNIQUE INDEX idx_stripe_accounts_acct ON stripe_accounts (stripe_account_id);
CREATE INDEX idx_stripe_accounts_status ON stripe_accounts (status);

-- Every Stripe event we receive, stored before any side effect runs.
-- Idempotency lives here: a duplicate delivery finds its row and stops.
CREATE TABLE stripe_events (
  stripe_event_id TEXT PRIMARY KEY,
  account_context TEXT,                              -- connected acct_..., or NULL for platform
  event_type      TEXT NOT NULL,
  object_id       TEXT,
  payload_hash    TEXT,
  status          TEXT NOT NULL DEFAULT 'received',  -- received | processed | failed | ignored
  attempts        INTEGER NOT NULL DEFAULT 0,
  last_error      TEXT,
  received_at     TEXT NOT NULL DEFAULT (datetime('now')),
  processed_at    TEXT
);

CREATE INDEX idx_stripe_events_status ON stripe_events (status, received_at);
CREATE INDEX idx_stripe_events_type ON stripe_events (event_type, received_at DESC);
CREATE INDEX idx_stripe_events_object ON stripe_events (object_id);
