/**
 * pricing.ts — the single source of truth for every amount ThriftOS charges.
 *
 * Money is always integer cents. Rates are always basis points. Never a float,
 * never a percentage stored as a decimal, never a guess. Every surface — the
 * marketing page, the savings calculator, the billing gate, the comparison
 * table, the tests — reads from here, so the number on the pricing page and the
 * number on the invoice cannot drift apart.
 *
 * These plan definitions are the *defaults*. Per the payments plan, live fee
 * resolution will read from a `plans` / `fee_policies` table with tenant-level
 * overrides and effective dates, and each transaction will store the fee policy
 * snapshot it actually used. This file seeds those tables and remains the
 * fallback; it is not the runtime authority once that schema lands.
 */

export type PlanId = "volunteer" | "core" | "federation" | "enterprise";

export interface Plan {
  id: PlanId;
  name: string;
  /** Flat monthly price in integer cents. */
  monthlyCents: number;
  /** Annual price in cents — ten months charged, twelve delivered. */
  annualCents: number | null;
  /** ThriftOS platform fee on card volume, in basis points. 75 = 0.75%. */
  platformFeeBps: number;
  /**
   * Monthly ceiling on the platform fee. Defaults to the plan's own
   * subscription price, which gives a promise a shop can hold in their head:
   * **your platform fee never exceeds your subscription.**
   *
   * This is what stops a percentage fee from quietly overtaking a competitor's
   * flat price as a shop grows. null = uncapped (Enterprise negotiates its own).
   */
  maxPlatformFeeCents: number | null;
  /** null = negotiated per contract. */
  maxLocations: number | null;
  /** True where the monthly price is a starting point, not a fixed rate. */
  startingAt: boolean;
  blurb: string;
  bestFor: string;
  features: string[];
}

/**
 * Annual billing: pay for ten months, get twelve. Two months free is the plainest
 * version of a discount a shop can check in their head, which is worth more than
 * a cleverer percentage.
 *
 * The discount is *derived* from this, never stored separately, so the headline
 * percentage and the amount actually charged cannot drift apart.
 */
export const ANNUAL_MONTHS_CHARGED = 10;

export function annualCentsFor(monthlyCents: number): number {
  return monthlyCents * ANNUAL_MONTHS_CHARGED;
}

/** ~1667bps (16.67%). Derived, so changing the months above moves it too. */
export const ANNUAL_DISCOUNT_BPS = Math.round(
  ((12 - ANNUAL_MONTHS_CHARGED) / 12) * 10_000
);

/* ─── Trial and grace ────────────────────────────────────────────────────
   Generous on purpose, and bounded by one rule that isn't negotiable:
   we never switch off a shop's register. Locking the till on a Saturday
   because a card expired is not a billing strategy, it's sabotage. */

export const TRIAL_DAYS = 30;
export const GRACE_DAYS = 14;

/**
 * What a shop can still do while past due. The register and data export stay on
 * no matter what — a shop that wants to leave must always be able to leave with
 * its records, and a shop that owes us money can still take a customer's money.
 */
export const ALWAYS_AVAILABLE = [
  "register",
  "cash_checkout",
  "data_export",
  "billing_update",
  "receipts",
] as const;

export const PLANS: readonly Plan[] = [
  {
    id: "volunteer",
    name: "Volunteer",
    monthlyCents: 3900,
    annualCents: 39000,
    maxPlatformFeeCents: 3900,
    platformFeeBps: 75,
    maxLocations: 1,
    startingAt: false,
    blurb: "For the shop that runs on Tuesdays and goodwill.",
    bestFor: "Church basements, community shops, all-volunteer crews",
    features: [
      "Full register, inventory, and donor log",
      "AI photo intake — 100 items a month",
      "Donation receipts that hold up at tax time",
      "Impact reporting you can hand to a board",
      "Unlimited volunteer logins, always free",
    ],
  },
  {
    id: "core",
    name: "Core",
    monthlyCents: 9900,
    annualCents: 99000,
    maxPlatformFeeCents: 9900,
    platformFeeBps: 50,
    maxLocations: 1,
    startingAt: false,
    blurb: "For an established shop with real hours and real volume.",
    bestFor: "Independent thrift stores with paid staff",
    features: [
      "Everything in Volunteer",
      "AI photo intake — 1,000 items a month",
      "Colour-tag markdown scheduling",
      "Volunteer shifts and hours logging",
      "Public storefront on your own domain",
      "Lower platform fee — 0.50%",
    ],
  },
  {
    id: "federation",
    name: "Federation",
    monthlyCents: 24900,
    annualCents: 249000,
    maxPlatformFeeCents: 24900,
    platformFeeBps: 35,
    maxLocations: 5,
    startingAt: false,
    blurb: "Up to five locations that stay independent.",
    bestFor: "Regional networks and federated organisations",
    features: [
      "Everything in Core, across up to 5 locations",
      "Inventory transfers between shops",
      "Federation groups with per-resource consent",
      "Shared wholesale and rag-out channel",
      "Rollup reporting that never overrides local control",
      "Patronage ledger for worker-run stores",
    ],
  },
  {
    id: "enterprise",
    name: "Enterprise",
    monthlyCents: 79900,
    annualCents: 799000,
    maxPlatformFeeCents: 79900,
    platformFeeBps: 25,
    maxLocations: null,
    startingAt: true,
    blurb: "Negotiated terms for large networks.",
    bestFor: "Multi-region chains and statewide organisations",
    features: [
      "Everything in Federation",
      "Configurable location allowance",
      "Negotiated subscription and platform fee",
      "Priority support and onboarding assistance",
      "API access and outbound webhooks",
    ],
  },
] as const;

/**
 * Plan codes shipped before the payments rework. Existing rows keep working —
 * `getPlan` resolves them — and migration 0008 rewrites them in place.
 */
export const LEGACY_PLAN_CODES: Record<string, PlanId> = {
  stall: "volunteer",
  shop: "core",
  store: "federation",
  network: "enterprise",
};

export function resolvePlanId(code: string): PlanId {
  if (PLANS.some((p) => p.id === code)) return code as PlanId;
  return LEGACY_PLAN_CODES[code] ?? "volunteer";
}

export function getPlan(id: string): Plan {
  const resolved = resolvePlanId(id);
  const plan = PLANS.find((p) => p.id === resolved);
  if (!plan) throw new Error(`Unknown plan: ${id}`);
  return plan;
}

/* ─── Platform fee ──────────────────────────────────────────────────────── */

export interface FeePolicy {
  platformFeeBps: number;
  minimumFeeCents?: number | null;
  maximumFeeCents?: number | null;
  /** Global kill switch, and per-tenant exemptions, both land here. */
  exempt?: boolean;
}

/**
 * The one fee calculation. Server-side only, integer cents in and out.
 *
 * Deliberately takes an explicit fee base rather than a whole order: whether
 * tax and round-up are inside the base is a policy decision, not arithmetic.
 * See `platformFeeBase` — round-up is excluded by default because charging a
 * platform fee on a customer's donation needs an explicit business decision,
 * not a silent default.
 */
export function platformFeeCents(feeBaseCents: number, policy: FeePolicy): number {
  if (policy.exempt) return 0;
  const base = Math.max(0, Math.round(feeBaseCents));
  if (base === 0) return 0;

  let fee = Math.round((base * policy.platformFeeBps) / 10_000);

  if (policy.minimumFeeCents != null) fee = Math.max(fee, policy.minimumFeeCents);
  if (policy.maximumFeeCents != null) fee = Math.min(fee, policy.maximumFeeCents);

  // A fee can never exceed what was actually charged.
  return Math.min(fee, base);
}

/**
 * The monthly cap, applied per transaction.
 *
 * The cap is a *monthly* ceiling but fees are charged one sale at a time, so it
 * has to be spent down rather than applied to each charge in isolation. Given
 * what a shop has already paid this month, this returns the fee for the next
 * sale — which is whatever headroom remains, and eventually zero.
 *
 * Getting this wrong in the obvious way (capping each transaction at the
 * monthly figure) would charge a busy shop the cap many times over, which is
 * the exact opposite of the promise.
 */
export function cappedPlatformFeeCents(
  feeBaseCents: number,
  policy: FeePolicy,
  monthToDateFeeCents: number,
  monthlyCapCents: number | null
): number {
  const uncapped = platformFeeCents(feeBaseCents, policy);
  if (monthlyCapCents == null) return uncapped;

  const spent = Math.max(0, Math.round(monthToDateFeeCents));
  const headroom = Math.max(0, monthlyCapCents - spent);
  return Math.min(uncapped, headroom);
}

/** The card volume at which a plan's fee reaches its cap. Derived. */
export function feeCapReachedAtVolumeCents(plan: Plan): number | null {
  if (plan.maxPlatformFeeCents == null || plan.platformFeeBps <= 0) return null;
  return Math.ceil((plan.maxPlatformFeeCents * 10_000) / plan.platformFeeBps);
}

/**
 * A refund gives back the platform fee in proportion to what was returned.
 *
 * Stripe does not do this on its own — the application fee has to be refunded
 * explicitly. A shop that hands a customer their money back should not still be
 * paying us for the sale, so this is always called on refund.
 */
export function proportionalFeeRefundCents(
  originalFeeCents: number,
  originalBaseCents: number,
  refundedBaseCents: number
): number {
  if (originalBaseCents <= 0 || originalFeeCents <= 0) return 0;
  const refunded = Math.min(Math.max(0, refundedBaseCents), originalBaseCents);
  // Round in the shop's favour, so a rounding cent is never one we keep.
  return Math.min(originalFeeCents, Math.ceil((originalFeeCents * refunded) / originalBaseCents));
}

export interface FeeBaseOptions {
  merchandiseSubtotalCents: number;
  discountCents?: number;
  taxCents?: number;
  roundUpCents?: number;
  /** Both default to the conservative answer: exclude. */
  includeTax?: boolean;
  includeRoundUp?: boolean;
}

/**
 * What the platform fee is charged on.
 *
 * Defaults exclude tax (it isn't the store's revenue — it's the state's) and
 * exclude round-up (it's the customer's donation). Both are configurable, but
 * the default is the one we'd be comfortable explaining to a shop out loud.
 */
export function platformFeeBase(opts: FeeBaseOptions): number {
  const merchandise = Math.max(
    0,
    Math.round(opts.merchandiseSubtotalCents) - Math.round(opts.discountCents ?? 0)
  );
  let base = merchandise;
  if (opts.includeTax) base += Math.max(0, Math.round(opts.taxCents ?? 0));
  if (opts.includeRoundUp) base += Math.max(0, Math.round(opts.roundUpCents ?? 0));
  return base;
}

/* ─── Card processing (Stripe's published card-present rate) ─────────────── */

export const STRIPE_CARD_PRESENT_BPS = 270; // 2.7%
export const STRIPE_CARD_PRESENT_FIXED_CENTS = 5;

export const STRIPE_ONLINE_BPS = 290; // 2.9%
export const STRIPE_ONLINE_FIXED_CENTS = 30;

export function stripeCardPresentFeeCents(amountCents: number): number {
  if (amountCents <= 0) return 0;
  return (
    Math.round((amountCents * STRIPE_CARD_PRESENT_BPS) / 10_000) +
    STRIPE_CARD_PRESENT_FIXED_CENTS
  );
}

export function stripeOnlineFeeCents(amountCents: number): number {
  if (amountCents <= 0) return 0;
  return Math.round((amountCents * STRIPE_ONLINE_BPS) / 10_000) + STRIPE_ONLINE_FIXED_CENTS;
}

/* ─── Hardware ──────────────────────────────────────────────────────────── */

/** Stripe Reader M2, bought outright. No lease, no contract, no buyout. */
export const READER_M2_CENTS = 5900;
/** Tap to Pay on a phone the shop already owns. */
export const TAP_TO_PAY_CENTS = 0;

export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.round(cents));
  return `${sign}$${Math.floor(abs / 100).toLocaleString("en-US")}.${String(abs % 100).padStart(2, "0")}`;
}

/** Whole dollars, for headline figures where cents are noise. */
export function formatDollars(cents: number): string {
  return `$${Math.round(cents / 100).toLocaleString("en-US")}`;
}

/** 75 → "0.75%" */
export function formatBps(bps: number): string {
  const pct = bps / 100;
  return `${pct % 1 === 0 ? pct.toFixed(0) : pct.toFixed(2).replace(/0$/, "")}%`;
}
