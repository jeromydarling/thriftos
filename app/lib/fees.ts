/**
 * Fee resolution — the server-side authority on what a shop is charged.
 *
 * Nothing here trusts the browser. Amounts, rates, tenant identity, and the fee
 * base are all resolved from the database on every charge, and the exact policy
 * used is written onto the transaction so history can never be rewritten by a
 * later rate change.
 *
 * Resolution order, most specific first:
 *   1. tenant fee_policy row (effective now)
 *   2. tenant_subscriptions override columns
 *   3. plan fee_policy row (effective now)
 *   4. plans table default
 *   5. pricing.ts — the last-resort fallback if the tables are unseeded
 */
import { first, run } from "./db";
import { newId } from "./ids";
import {
  cappedPlatformFeeCents,
  getPlan,
  platformFeeBase,
  resolvePlanId,
  type FeeBaseOptions,
} from "./pricing";

export interface ResolvedFeePolicy {
  /** Null where the fee came from code rather than a policy row. */
  feePolicyId: string | null;
  planCode: string;
  platformFeeBps: number;
  minimumFeeCents: number | null;
  /** The monthly cap. */
  maximumFeeCents: number | null;
  includeTax: boolean;
  includeRoundUp: boolean;
  exempt: boolean;
  source: "tenant_policy" | "tenant_override" | "plan_policy" | "plan" | "code";
}

/**
 * Resolve the policy in force for an org right now.
 *
 * Never throws: an org with no subscription row, a missing plan, or an empty
 * plans table all fall through to the code defaults rather than failing a sale.
 * A shop must always be able to take money.
 */
export async function resolveFeePolicy(
  db: D1Database,
  orgId: string
): Promise<ResolvedFeePolicy> {
  const sub = await first<{
    plan_code: string | null;
    custom_platform_fee_bps: number | null;
    platform_fee_exempt: number;
    plan_default_bps: number | null;
    plan_max_fee: number | null;
  }>(
    db,
    `SELECT p.code AS plan_code,
            s.custom_platform_fee_bps,
            s.platform_fee_exempt,
            p.default_platform_fee_bps AS plan_default_bps,
            p.max_platform_fee_cents  AS plan_max_fee
       FROM tenant_subscriptions s
       LEFT JOIN plans p ON p.id = s.plan_id
      WHERE s.org_id = ?`,
    orgId
  );

  // Fall back to the org's own plan column when no subscription row exists yet.
  const orgPlan = sub?.plan_code
    ? sub.plan_code
    : (await first<{ plan: string }>(db, `SELECT plan FROM orgs WHERE id = ?`, orgId))?.plan ??
      "volunteer";

  const planCode = resolvePlanId(orgPlan);
  const codePlan = getPlan(planCode);

  // A global kill switch or a per-tenant exemption both land here.
  if (sub?.platform_fee_exempt === 1) {
    return {
      feePolicyId: null,
      planCode,
      platformFeeBps: 0,
      minimumFeeCents: null,
      maximumFeeCents: null,
      includeTax: false,
      includeRoundUp: false,
      exempt: true,
      source: "tenant_override",
    };
  }

  // 1. Tenant-specific policy, if one is in effect today.
  const tenantPolicy = await first<PolicyRow>(
    db,
    `SELECT id, platform_fee_bps, minimum_fee_cents, maximum_fee_cents,
            include_tax, include_round_up
       FROM fee_policies
      WHERE org_id = ? AND active = 1
        AND effective_from <= datetime('now')
        AND (effective_until IS NULL OR effective_until > datetime('now'))
      ORDER BY effective_from DESC
      LIMIT 1`,
    orgId
  );
  if (tenantPolicy) return fromRow(tenantPolicy, planCode, "tenant_policy");

  // 2. A negotiated rate stored on the subscription itself.
  if (sub?.custom_platform_fee_bps != null) {
    return {
      feePolicyId: null,
      planCode,
      platformFeeBps: sub.custom_platform_fee_bps,
      minimumFeeCents: null,
      maximumFeeCents: sub.plan_max_fee ?? codePlan.maxPlatformFeeCents,
      includeTax: false,
      includeRoundUp: false,
      exempt: false,
      source: "tenant_override",
    };
  }

  // 3. A policy attached to the plan.
  const planPolicy = await first<PolicyRow>(
    db,
    `SELECT fp.id, fp.platform_fee_bps, fp.minimum_fee_cents, fp.maximum_fee_cents,
            fp.include_tax, fp.include_round_up
       FROM fee_policies fp
       JOIN plans p ON p.id = fp.plan_id
      WHERE p.code = ? AND fp.active = 1 AND fp.org_id IS NULL
        AND fp.effective_from <= datetime('now')
        AND (fp.effective_until IS NULL OR fp.effective_until > datetime('now'))
      ORDER BY fp.effective_from DESC
      LIMIT 1`,
    planCode
  );
  if (planPolicy) return fromRow(planPolicy, planCode, "plan_policy");

  // 4. The plans table.
  if (sub?.plan_default_bps != null) {
    return {
      feePolicyId: null,
      planCode,
      platformFeeBps: sub.plan_default_bps,
      minimumFeeCents: null,
      maximumFeeCents: sub.plan_max_fee,
      includeTax: false,
      includeRoundUp: false,
      exempt: false,
      source: "plan",
    };
  }

  // 5. Code defaults, so an unseeded database still charges correctly.
  return {
    feePolicyId: null,
    planCode,
    platformFeeBps: codePlan.platformFeeBps,
    minimumFeeCents: null,
    maximumFeeCents: codePlan.maxPlatformFeeCents,
    includeTax: false,
    includeRoundUp: false,
    exempt: false,
    source: "code",
  };
}

interface PolicyRow {
  id: string;
  platform_fee_bps: number;
  minimum_fee_cents: number | null;
  maximum_fee_cents: number | null;
  include_tax: number;
  include_round_up: number;
}

function fromRow(
  row: PolicyRow,
  planCode: string,
  source: ResolvedFeePolicy["source"]
): ResolvedFeePolicy {
  return {
    feePolicyId: row.id,
    planCode,
    platformFeeBps: row.platform_fee_bps,
    minimumFeeCents: row.minimum_fee_cents,
    maximumFeeCents: row.maximum_fee_cents,
    includeTax: row.include_tax === 1,
    includeRoundUp: row.include_round_up === 1,
    exempt: false,
    source,
  };
}

/* ─── Month-to-date accrual, for the cap ────────────────────────────────── */

export function currentPeriodStart(now = new Date()): string {
  return `${now.toISOString().slice(0, 7)}-01`;
}

export async function monthToDateFeeCents(
  db: D1Database,
  orgId: string,
  now = new Date()
): Promise<number> {
  const row = await first<{ fee_cents: number; refunded_cents: number }>(
    db,
    `SELECT fee_cents, refunded_cents FROM fee_accruals
      WHERE org_id = ? AND period_start = ?`,
    orgId,
    currentPeriodStart(now)
  );
  // Refunded fees free up headroom again — a refunded sale shouldn't consume
  // any of a shop's monthly cap.
  return Math.max(0, Number(row?.fee_cents ?? 0) - Number(row?.refunded_cents ?? 0));
}

export interface QuotedFee {
  policy: ResolvedFeePolicy;
  feeBaseCents: number;
  platformFeeCents: number;
  /** What the fee would have been without the monthly cap. */
  uncappedFeeCents: number;
  cappedByMonthlyLimit: boolean;
}

/**
 * Quote the platform fee for one sale. Server-side, integer cents, capped
 * against what this shop has already paid this month.
 */
export async function quotePlatformFee(
  db: D1Database,
  orgId: string,
  order: Omit<FeeBaseOptions, "includeTax" | "includeRoundUp">,
  now = new Date()
): Promise<QuotedFee> {
  const policy = await resolveFeePolicy(db, orgId);

  const feeBaseCents = platformFeeBase({
    ...order,
    includeTax: policy.includeTax,
    includeRoundUp: policy.includeRoundUp,
  });

  const spent = await monthToDateFeeCents(db, orgId, now);

  const feePolicy = {
    platformFeeBps: policy.platformFeeBps,
    minimumFeeCents: policy.minimumFeeCents,
    maximumFeeCents: null, // the monthly cap is applied below, not per sale
    exempt: policy.exempt,
  };

  const uncapped = cappedPlatformFeeCents(feeBaseCents, feePolicy, 0, null);
  const capped = cappedPlatformFeeCents(
    feeBaseCents,
    feePolicy,
    spent,
    policy.maximumFeeCents
  );

  return {
    policy,
    feeBaseCents,
    platformFeeCents: capped,
    uncappedFeeCents: uncapped,
    cappedByMonthlyLimit: capped < uncapped,
  };
}

/** Record a charged fee against this month's accrual. Call after Stripe confirms. */
export async function recordFeeAccrual(
  db: D1Database,
  orgId: string,
  feeCents: number,
  capCents: number | null,
  now = new Date()
): Promise<void> {
  if (feeCents <= 0) return;
  await run(
    db,
    `INSERT INTO fee_accruals (id, org_id, period_start, fee_cents, cap_cents)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (org_id, period_start) DO UPDATE SET
       fee_cents = fee_cents + excluded.fee_cents,
       cap_cents = excluded.cap_cents,
       updated_at = datetime('now')`,
    newId("run"),
    orgId,
    currentPeriodStart(now),
    Math.round(feeCents),
    capCents
  );
}

/** Give fee headroom back when a sale is refunded. */
export async function recordFeeRefund(
  db: D1Database,
  orgId: string,
  refundedFeeCents: number,
  now = new Date()
): Promise<void> {
  if (refundedFeeCents <= 0) return;
  await run(
    db,
    `UPDATE fee_accruals
        SET refunded_cents = refunded_cents + ?, updated_at = datetime('now')
      WHERE org_id = ? AND period_start = ?`,
    Math.round(refundedFeeCents),
    orgId,
    currentPeriodStart(now)
  );
}
