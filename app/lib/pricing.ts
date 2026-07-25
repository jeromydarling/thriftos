/**
 * pricing.ts — the single source of truth for every amount ThriftOS charges.
 *
 * Money is always integer cents. Never a float, never a string, never a guess.
 * Every surface — marketing page, billing gate, comparison table, tests —
 * reads from here, so the number on the pricing page and the number on the
 * invoice cannot drift apart.
 */

export type PlanId = "stall" | "shop" | "store" | "network";

export interface Plan {
  id: PlanId;
  name: string;
  /** Flat monthly price in cents. Usage plans use `perSaleCents` instead. */
  monthlyCents: number;
  /** Per-transaction price in cents, for the usage-based entry tier. */
  perSaleCents: number;
  blurb: string;
  bestFor: string;
  limits: {
    locations: number;
    seats: number;
    /** null = no cap */
    itemsPerMonth: number | null;
  };
  features: string[];
}

/**
 * Four plans. The entry tier is usage-based so a tiny church shop pays close to
 * nothing in a slow month — and its cap is *derived* from the next tier, so a
 * busy month can never cost more than simply being on Shop.
 */
export const PLANS: readonly Plan[] = [
  {
    id: "stall",
    name: "Stall",
    monthlyCents: 0,
    perSaleCents: 12,
    blurb: "Pay 12¢ a sale. Nothing else. Never more than Shop in a busy month.",
    bestFor: "A single-volunteer shop open two days a week",
    limits: { locations: 1, seats: 5, itemsPerMonth: null },
    features: [
      "Everything in the register, inventory, and donor log",
      "AI photo intake — 100 items a month included",
      "Donation receipts that hold up at tax time",
      "Impact reporting you can hand to a board",
    ],
  },
  {
    id: "shop",
    name: "Shop",
    monthlyCents: 4900,
    perSaleCents: 0,
    blurb: "One flat price. Unlimited sales.",
    bestFor: "A shop with regular hours and a few volunteers",
    limits: { locations: 1, seats: 25, itemsPerMonth: null },
    features: [
      "Everything in Stall, with no per-sale charge",
      "AI photo intake — 1,000 items a month included",
      "Color-tag markdown scheduling",
      "Volunteer shifts and hours logging",
      "Public storefront on your own domain",
    ],
  },
  {
    id: "store",
    name: "Store",
    monthlyCents: 14900,
    perSaleCents: 0,
    blurb: "Multiple locations, transfers, and grant-ready reporting.",
    bestFor: "A nonprofit running two to five locations",
    limits: { locations: 5, seats: 100, itemsPerMonth: null },
    features: [
      "Everything in Shop",
      "Multi-location inventory and transfers",
      "AI photo intake — 5,000 items a month included",
      "Patronage ledger for worker-run stores",
      "API access and outbound webhooks",
    ],
  },
  {
    id: "network",
    name: "Network",
    monthlyCents: 39900,
    perSaleCents: 0,
    blurb: "Federation: shared reporting and wholesale channels across stores.",
    bestFor: "A chain or an association of independent shops",
    limits: { locations: 999, seats: 1000, itemsPerMonth: null },
    features: [
      "Everything in Store",
      "Federation groups with per-resource consent",
      "Shared wholesale and rag-out channel",
      "Rollup reporting across member stores",
      "AI photo intake — 25,000 items a month included",
    ],
  },
] as const;

export function getPlan(id: PlanId): Plan {
  const plan = PLANS.find((p) => p.id === id);
  if (!plan) throw new Error(`Unknown plan: ${id}`);
  return plan;
}

/**
 * The usage cap, derived — never hardcoded. A Stall month is billed per sale
 * but stops at whatever Shop costs, so heavy months are never a punishment.
 */
export function usageCapCents(): number {
  return getPlan("shop").monthlyCents;
}

/** What a Stall store actually owes for `sales` completed sales this month. */
export function stallMonthlyCents(sales: number): number {
  const raw = Math.max(0, Math.floor(sales)) * getPlan("stall").perSaleCents;
  return Math.min(raw, usageCapCents());
}

/** The sale count at which Stall reaches its cap and Shop becomes the better deal. */
export function stallBreakEvenSales(): number {
  return Math.ceil(usageCapCents() / getPlan("stall").perSaleCents);
}

/** What an org owes this month, whatever plan it is on. */
export function monthlyChargeCents(plan: PlanId, sales: number): number {
  return plan === "stall" ? stallMonthlyCents(sales) : getPlan(plan).monthlyCents;
}

/* ─── Platform fee on payments the store receives ─────────────────────────
   Stripe Connect: the store is merchant of record. We take a small, visible
   application fee — and the shopper is offered the chance to cover it. */

export const PLATFORM_FEE_BPS = 100; // 1.00%, disclosed on the label every time

export function platformFeeCents(amountCents: number): number {
  return Math.round((Math.max(0, amountCents) * PLATFORM_FEE_BPS) / 10_000);
}

/** Stripe's own published US card rate, so "cover the fees" math is honest. */
export const STRIPE_PCT_BPS = 290;
export const STRIPE_FIXED_CENTS = 30;

export function stripeFeeCents(amountCents: number): number {
  if (amountCents <= 0) return 0;
  return Math.round((amountCents * STRIPE_PCT_BPS) / 10_000) + STRIPE_FIXED_CENTS;
}

/**
 * If the payer opts to cover fees, gross up so the store nets the full amount.
 * Solve g = net + stripe(g) + platform(g) directly rather than iterating.
 */
export function grossUpToCoverFees(netCents: number): number {
  if (netCents <= 0) return 0;
  const rate = (STRIPE_PCT_BPS + PLATFORM_FEE_BPS) / 10_000;
  return Math.ceil((netCents + STRIPE_FIXED_CENTS) / (1 - rate));
}

/* ─── Free grace allowance before a card is required ─────────────────────── */

export const FREE_GRACE_SALES = 150;

export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}$${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}
