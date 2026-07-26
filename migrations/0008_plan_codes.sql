-- 0008_plan_codes — rename plan codes to the Volunteer/Core/Federation/Enterprise
-- model, and add the columns the payments rework needs on `orgs`.
--
-- Forward-only and idempotent: the UPDATEs match the old codes, so re-running
-- after a partial apply is harmless. Nothing is deleted, and `resolvePlanId` in
-- app/lib/pricing.ts still maps the old codes at runtime, so a row this misses
-- keeps working rather than throwing.

UPDATE orgs SET plan = 'volunteer'  WHERE plan = 'stall';
UPDATE orgs SET plan = 'core'       WHERE plan = 'shop';
UPDATE orgs SET plan = 'federation' WHERE plan = 'store';
UPDATE orgs SET plan = 'enterprise' WHERE plan = 'network';

-- Anything unrecognised lands on the entry tier rather than an invalid state.
UPDATE orgs SET plan = 'volunteer'
 WHERE plan NOT IN ('volunteer', 'core', 'federation', 'enterprise');

-- Per-tenant fee overrides. Nullable so the plan default applies unless a
-- deliberate exception has been recorded. `platform_fee_exempt` backs both the
-- per-tenant exemption and, set across the board, the global kill switch.
ALTER TABLE orgs ADD COLUMN custom_platform_fee_bps INTEGER;
ALTER TABLE orgs ADD COLUMN platform_fee_exempt INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orgs ADD COLUMN grandfathered INTEGER NOT NULL DEFAULT 0;
