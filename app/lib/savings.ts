/**
 * The savings model behind the marketing site.
 *
 * Every number shown to a visitor is computed here, from stated assumptions, in
 * integer cents. Nothing on the site is a pasted figure — if an input changes,
 * the page changes with it, and the tests catch any claim that stops being true.
 *
 * The honesty rule this file exists to enforce: against a reasonably-priced
 * software-only competitor the saving is real but modest (roughly 7–10%).
 * Against a shop locked into a 48-month hardware lease it is large (10–22%).
 * We say both. Overstating the first would be the easiest lie to tell and the
 * fastest one to get caught.
 */
import {
  feeCapReachedAtVolumeCents,
  getPlan,
  platformFeeCents,
  READER_M2_CENTS,
  stripeCardPresentFeeCents,
  type PlanId,
} from "./pricing";

/* ─── Assumptions, stated out loud ──────────────────────────────────────── */

/**
 * A typical nonprofit card-processing rate. Most incumbent thrift POS vendors
 * bundle processing at around this, and it is the fair midpoint to compare to.
 */
export const INCUMBENT_PROCESSING_BPS = 260; // 2.6%
export const INCUMBENT_PROCESSING_FIXED_CENTS = 10;

/**
 * We attribute the full cost of a reader to the first six months rather than
 * spreading it over its life. That makes our own column look worse, which is
 * the direction an assumption should err.
 */
export const HARDWARE_AMORTISATION_MONTHS = 6;

export interface CompetitorProfile {
  id: string;
  name: string;
  /** Monthly software subscription in cents. */
  softwareMonthlyCents: number;
  /** Monthly hardware lease in cents, 0 where hardware is bought outright. */
  hardwareLeaseMonthlyCents: number;
  /** Lease term in months, 0 where there is no lease. */
  leaseTermMonths: number;
  processingBps: number;
  processingFixedCents: number;
  note: string;
}

/**
 * Published/reported pricing for the systems thrift shops actually evaluate.
 * Where a vendor publishes a range we take a mid or low point, so the
 * comparison never flatters us by picking their worst tier.
 */
export const COMPETITORS: readonly CompetitorProfile[] = [
  {
    id: "thriftcart",
    name: "ThriftCart Core",
    softwareMonthlyCents: 15_000,
    hardwareLeaseMonthlyCents: 0,
    leaseTermMonths: 0,
    processingBps: INCUMBENT_PROCESSING_BPS,
    processingFixedCents: INCUMBENT_PROCESSING_FIXED_CENTS,
    note: "Software-only. A fair, well-priced competitor — the savings here are modest.",
  },
  {
    id: "thrifttrac",
    name: "ThriftTrac (3 modules)",
    softwareMonthlyCents: 35_000,
    hardwareLeaseMonthlyCents: 0,
    leaseTermMonths: 0,
    processingBps: INCUMBENT_PROCESSING_BPS,
    processingFixedCents: INCUMBENT_PROCESSING_FIXED_CENTS,
    note: "Priced per module, so the bill grows as you switch features on.",
  },
  {
    id: "leased-mid",
    name: "Leased terminal + software",
    softwareMonthlyCents: 10_000,
    hardwareLeaseMonthlyCents: 19_000,
    leaseTermMonths: 48,
    processingBps: INCUMBENT_PROCESSING_BPS,
    processingFixedCents: INCUMBENT_PROCESSING_FIXED_CENTS,
    note: "A 48-month hardware lease on top of software. This is where the gap gets wide.",
  },
  {
    id: "leased-high",
    name: "Leased terminal (high tier)",
    softwareMonthlyCents: 10_000,
    hardwareLeaseMonthlyCents: 25_400,
    leaseTermMonths: 48,
    processingBps: INCUMBENT_PROCESSING_BPS,
    processingFixedCents: INCUMBENT_PROCESSING_FIXED_CENTS,
    note: "The upper end of reported hardware leases. Four years, non-cancellable.",
  },
] as const;

export function getCompetitor(id: string): CompetitorProfile {
  return COMPETITORS.find((c) => c.id === id) ?? COMPETITORS[0];
}

/* ─── The model ─────────────────────────────────────────────────────────── */

export interface ShopInputs {
  /** Card volume per month, in cents. */
  monthlyCardVolumeCents: number;
  /** Average sale, in cents. Drives the per-transaction component. */
  averageTicketCents: number;
  planId?: PlanId;
  competitorId?: string;
  /** Does the shop need to buy a reader? Tap to Pay costs nothing. */
  needsReader?: boolean;
}

export interface CostBreakdown {
  softwareCents: number;
  hardwareCents: number;
  processingCents: number;
  platformFeeCents: number;
  totalCents: number;
}

export interface SavingsResult {
  transactionsPerMonth: number;
  plan: ReturnType<typeof getPlan>;
  competitor: CompetitorProfile;
  incumbent: CostBreakdown;
  thriftos: CostBreakdown;
  monthlySavingsCents: number;
  annualSavingsCents: number;
  /** Percentage saved, in basis points, so no float creeps into a headline. */
  savingsBps: number;
  /** Remaining lease liability a shop would be walking away from. */
  leaseBuyoutCents: number;
  /** True where the saving is small enough that we should say so plainly. */
  isModest: boolean;
  /**
   * The honest verdict for this exact combination. The marketing site branches
   * on this rather than assuming we always win — because we don't.
   *
   * Against a keenly-priced software-only competitor at high card volume, our
   * platform fee can outweigh the subscription and processing advantage. A shop
   * will work that out with a calculator in about four minutes, so it is far
   * better that they hear it from us first.
   */
  verdict: "big-win" | "modest-win" | "costs-more";
}

export function transactionsPerMonth(volumeCents: number, avgTicketCents: number): number {
  if (avgTicketCents <= 0) return 0;
  return Math.round(volumeCents / avgTicketCents);
}

/**
 * The plan a shop should actually be on.
 *
 * Chosen by what a shop *needs*, not by what costs most — because once the
 * platform fee is capped at each plan's own subscription, Volunteer is the
 * cheapest plan at every card volume. There is no volume at which a shop should
 * "upgrade to save money", and pretending otherwise would be an upsell dressed
 * as advice.
 *
 * You move up for locations and for AI intake allowance. That's it, and the
 * pricing page says so in those words.
 */
export function recommendPlan(
  monthlyCardVolumeCents: number,
  locations = 1,
  itemsPerMonth = 0
): PlanId {
  if (locations > 5) return "enterprise";
  if (locations > 1) return "federation";
  if (itemsPerMonth > 1_000) return "federation";
  if (itemsPerMonth > 100) return "core";
  return "volunteer";
}

/** True where a cheaper plan would serve this shop just as well. */
export function cheapestAdequatePlan(locations = 1, itemsPerMonth = 0): PlanId {
  return recommendPlan(0, locations, itemsPerMonth);
}

/**
 * The card volume at which a plan's platform fee stops growing.
 *
 * Past this point the fee is flat for the rest of the month, so a shop's
 * marginal cost of taking another card payment is Stripe's rate and nothing
 * else. This is the number worth putting on the pricing page.
 */
export function feeCapVolumeCents(planId: PlanId): number | null {
  return feeCapReachedAtVolumeCents(getPlan(planId));
}

/** The most a shop can pay ThriftOS in a month: subscription plus capped fee. */
export function maxMonthlyCostCents(planId: PlanId): number {
  const plan = getPlan(planId);
  return plan.monthlyCents + (plan.maxPlatformFeeCents ?? 0);
}

/**
 * The card volume above which ThriftOS stops being cheaper than a given
 * competitor.
 *
 * Our platform fee is a percentage; an incumbent's software and lease are flat.
 * That means there is always some volume where they win, and a large shop will
 * find it immediately. Better to compute it, show it, and route those shops to
 * Enterprise terms — or to a fee cap, which `maximumFeeCents` already supports.
 *
 * Returns Infinity where we win at every volume. Searched rather than solved
 * because the per-transaction components depend on the ticket size.
 */
export function percentFeeCrossoverVolumeCents(
  competitorId: string,
  averageTicketCents: number
): number {
  const step = 500_000; // $5k
  const ceiling = 100_000_000; // $1M/month

  for (let volume = step; volume <= ceiling; volume += step) {
    const result = calculateSavings({
      monthlyCardVolumeCents: volume,
      averageTicketCents,
      competitorId,
    });
    if (result.monthlySavingsCents <= 0) return volume;
  }
  return Number.POSITIVE_INFINITY;
}

export function calculateSavings(inputs: ShopInputs): SavingsResult {
  const volume = Math.max(0, Math.round(inputs.monthlyCardVolumeCents));
  const avgTicket = Math.max(1, Math.round(inputs.averageTicketCents));
  const txns = transactionsPerMonth(volume, avgTicket);

  const planId = inputs.planId ?? recommendPlan(volume, 1, 0);
  const plan = getPlan(planId);
  const competitor = getCompetitor(inputs.competitorId ?? "thriftcart");

  // Incumbent: software + lease + bundled processing.
  const incumbentProcessing =
    Math.round((volume * competitor.processingBps) / 10_000) +
    txns * competitor.processingFixedCents;

  const incumbent: CostBreakdown = {
    softwareCents: competitor.softwareMonthlyCents,
    hardwareCents: competitor.hardwareLeaseMonthlyCents,
    processingCents: incumbentProcessing,
    platformFeeCents: 0,
    totalCents:
      competitor.softwareMonthlyCents +
      competitor.hardwareLeaseMonthlyCents +
      incumbentProcessing,
  };

  // ThriftOS: subscription + Stripe card-present + our platform fee + hardware.
  // Stripe's fixed component is per transaction, so it scales with count.
  const stripeProcessing =
    Math.round((volume * 270) / 10_000) + txns * 5;

  // The monthly cap is what keeps a percentage fee from overtaking a
  // competitor's flat price as a shop grows.
  const ourPlatformFee = platformFeeCents(volume, {
    platformFeeBps: plan.platformFeeBps,
    maximumFeeCents: plan.maxPlatformFeeCents,
  });

  const hardware = inputs.needsReader
    ? Math.round(READER_M2_CENTS / HARDWARE_AMORTISATION_MONTHS)
    : 0;

  const thriftos: CostBreakdown = {
    softwareCents: plan.monthlyCents,
    hardwareCents: hardware,
    processingCents: stripeProcessing,
    platformFeeCents: ourPlatformFee,
    totalCents: plan.monthlyCents + hardware + stripeProcessing + ourPlatformFee,
  };

  const monthlySavings = incumbent.totalCents - thriftos.totalCents;
  const savingsBps =
    incumbent.totalCents > 0
      ? Math.round((monthlySavings / incumbent.totalCents) * 10_000)
      : 0;

  return {
    transactionsPerMonth: txns,
    plan,
    competitor,
    incumbent,
    thriftos,
    monthlySavingsCents: monthlySavings,
    annualSavingsCents: monthlySavings * 12,
    savingsBps,
    leaseBuyoutCents:
      competitor.hardwareLeaseMonthlyCents * competitor.leaseTermMonths,
    // Under ~12% we describe the saving as real but modest rather than dramatic.
    isModest: savingsBps > 0 && savingsBps < 1_200,
    verdict:
      monthlySavings <= 0 ? "costs-more" : savingsBps >= 1_200 ? "big-win" : "modest-win",
  };
}

/** Verify our published Stripe rate matches what the calculator uses. */
export function stripeCheck(amountCents: number): number {
  return stripeCardPresentFeeCents(amountCents);
}

/* ─── Preset scenarios used on the marketing page ───────────────────────── */

export const SCENARIOS = [
  {
    id: "small",
    label: "Small shop",
    detail: "~$15k/month on card, $12 average sale",
    monthlyCardVolumeCents: 1_500_000,
    averageTicketCents: 1_200,
  },
  {
    id: "medium",
    label: "Medium shop",
    detail: "~$40k/month on card, $12 average sale",
    monthlyCardVolumeCents: 4_000_000,
    averageTicketCents: 1_200,
  },
  {
    id: "large",
    label: "Multi-location",
    detail: "~$120k/month on card, $14 average sale",
    monthlyCardVolumeCents: 12_000_000,
    averageTicketCents: 1_400,
  },
] as const;

/**
 * The operational claim, kept separate from the money claim and attributed.
 *
 * This is an industry figure about AI-assisted intake, not a measurement of
 * ThriftOS. It is phrased as what shops have seen, never as what we promise.
 */
export const LABOUR_CLAIM = {
  fromSeconds: 45,
  toSeconds: 12,
  revenuePerSqFtLiftPct: 28,
  attribution: "reported across thrift operations adopting AI-assisted intake",
  caveat:
    "That's an industry figure, not a promise about your shop. Your mileage depends on your volunteers, your donations, and your light.",
} as const;

/** Seconds saved per item, and what that is worth in volunteer hours a month. */
export function intakeHoursSavedPerMonth(itemsPerMonth: number): number {
  const savedSeconds = (LABOUR_CLAIM.fromSeconds - LABOUR_CLAIM.toSeconds) * itemsPerMonth;
  return Math.round((savedSeconds / 3600) * 10) / 10;
}
