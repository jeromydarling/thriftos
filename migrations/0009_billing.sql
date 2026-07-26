-- 0009_billing — plans, subscriptions, fee policies, and the fee snapshot.
--
-- Step 2 of the payments plan. Additive and forward-only; nothing is dropped.
--
-- The point of this migration: make fee resolution *data*, not code. pricing.ts
-- seeds these tables and stays the fallback, but once a row exists here it is
-- the authority — which is what makes tenant overrides, effective dates, and
-- grandfathered rates possible without a deploy.

CREATE TABLE plans (
  id                      TEXT PRIMARY KEY,          -- pl_...
  code                    TEXT NOT NULL UNIQUE,      -- volunteer | core | ...
  name                    TEXT NOT NULL,
  active                  INTEGER NOT NULL DEFAULT 1,
  monthly_amount_cents    INTEGER NOT NULL,
  annual_amount_cents     INTEGER,
  default_platform_fee_bps INTEGER NOT NULL,
  -- Monthly ceiling on the platform fee. Defaults to the subscription price:
  -- a shop never pays us more in fees than it pays in subscription.
  max_platform_fee_cents  INTEGER,
  max_locations           INTEGER,                   -- NULL = negotiated
  stripe_product_id       TEXT,
  stripe_monthly_price_id TEXT,
  stripe_annual_price_id  TEXT,
  entitlements_json       TEXT NOT NULL DEFAULT '{}',
  created_at              TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at              TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE tenant_subscriptions (
  id                     TEXT PRIMARY KEY,           -- ts_...
  org_id                 TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  plan_id                TEXT NOT NULL REFERENCES plans(id),
  stripe_customer_id     TEXT,
  stripe_subscription_id TEXT,
  status                 TEXT NOT NULL DEFAULT 'trialing',
                         -- trialing | active | past_due | canceled | incomplete
  billing_interval       TEXT NOT NULL DEFAULT 'monthly', -- monthly | annual
  trial_ends_at          TEXT,
  current_period_start   TEXT,
  current_period_end     TEXT,
  -- Set when a payment fails. The register keeps working throughout; only
  -- non-essential features pause, and only after this passes.
  grace_ends_at          TEXT,
  cancel_at_period_end   INTEGER NOT NULL DEFAULT 0,
  custom_subscription_amount_cents INTEGER,
  custom_platform_fee_bps INTEGER,
  platform_fee_exempt    INTEGER NOT NULL DEFAULT 0,
  grandfathered          INTEGER NOT NULL DEFAULT 0,
  created_at             TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at             TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX idx_subs_org ON tenant_subscriptions (org_id);
CREATE INDEX idx_subs_stripe_sub ON tenant_subscriptions (stripe_subscription_id);
CREATE INDEX idx_subs_status ON tenant_subscriptions (status);

-- Fee policies, with effective dates so a rate change never rewrites history.
-- A tenant-scoped row beats a plan-scoped row; the most recent effective row wins.
CREATE TABLE fee_policies (
  id                 TEXT PRIMARY KEY,               -- fp_...
  org_id             TEXT REFERENCES orgs(id) ON DELETE CASCADE, -- NULL = plan-wide
  plan_id            TEXT REFERENCES plans(id),      -- NULL = tenant-specific
  platform_fee_bps   INTEGER NOT NULL,
  minimum_fee_cents  INTEGER,
  maximum_fee_cents  INTEGER,                        -- the monthly cap
  -- Policy switches, resolved server-side and never trusted from a client.
  include_tax        INTEGER NOT NULL DEFAULT 0,
  include_round_up   INTEGER NOT NULL DEFAULT 0,
  effective_from     TEXT NOT NULL DEFAULT (datetime('now')),
  effective_until    TEXT,
  active             INTEGER NOT NULL DEFAULT 1,
  note               TEXT,
  created_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_feepol_org ON fee_policies (org_id, active, effective_from DESC);
CREATE INDEX idx_feepol_plan ON fee_policies (plan_id, active, effective_from DESC);

-- The snapshot. Every charged transaction records the exact policy it used, so
-- changing a rate tomorrow cannot alter what a shop was charged yesterday.
ALTER TABLE transactions ADD COLUMN fee_policy_id TEXT;
ALTER TABLE transactions ADD COLUMN platform_fee_bps INTEGER;
ALTER TABLE transactions ADD COLUMN platform_fee_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE transactions ADD COLUMN fee_base_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE transactions ADD COLUMN processing_fee_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE transactions ADD COLUMN payment_state TEXT NOT NULL DEFAULT 'succeeded';
ALTER TABLE transactions ADD COLUMN stripe_charge_id TEXT;
ALTER TABLE transactions ADD COLUMN connected_account_id TEXT;

CREATE INDEX idx_tx_payment_state ON transactions (org_id, payment_state);

-- Month-to-date fee accrual, so the monthly cap can be spent down correctly
-- without summing every transaction on every sale.
CREATE TABLE fee_accruals (
  id              TEXT PRIMARY KEY,
  org_id          TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  period_start    TEXT NOT NULL,                     -- YYYY-MM-01
  fee_cents       INTEGER NOT NULL DEFAULT 0,
  refunded_cents  INTEGER NOT NULL DEFAULT 0,
  cap_cents       INTEGER,
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX idx_accrual_org_period ON fee_accruals (org_id, period_start);

-- Seed the plan catalogue from pricing.ts. Fee cap = the plan's own price.
INSERT INTO plans (id, code, name, monthly_amount_cents, annual_amount_cents,
                   default_platform_fee_bps, max_platform_fee_cents, max_locations,
                   entitlements_json)
VALUES
  ('pl_volunteer',  'volunteer',  'Volunteer',   3900,  39000, 75,  3900,    1,
   '{"ai_items_per_month":100,"storefront":false,"patronage":false}'),
  ('pl_core',       'core',       'Core',        9900,  99000, 50,  9900,    1,
   '{"ai_items_per_month":1000,"storefront":true,"patronage":false}'),
  ('pl_federation', 'federation', 'Federation',  24900, 249000, 35, 24900,   5,
   '{"ai_items_per_month":5000,"storefront":true,"patronage":true}'),
  ('pl_enterprise', 'enterprise', 'Enterprise',  79900, 799000, 25, 79900,   NULL,
   '{"ai_items_per_month":25000,"storefront":true,"patronage":true}');

-- Give every existing org a subscription row on its current plan, in trial.
-- Nobody is charged: Stripe is unconfigured, and this only makes state explicit.
INSERT INTO tenant_subscriptions (id, org_id, plan_id, status, trial_ends_at)
SELECT
  'ts_' || substr(hex(randomblob(11)), 1, 22),
  o.id,
  'pl_' || o.plan,
  'trialing',
  datetime('now', '+30 days')
FROM orgs o
WHERE NOT EXISTS (SELECT 1 FROM tenant_subscriptions s WHERE s.org_id = o.id);
