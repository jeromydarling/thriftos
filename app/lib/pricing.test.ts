import { describe, expect, it } from "vitest";
import {
  ALWAYS_AVAILABLE,
  ANNUAL_DISCOUNT_BPS,
  ANNUAL_MONTHS_CHARGED,
  annualCentsFor,
  cappedPlatformFeeCents,
  feeCapReachedAtVolumeCents,
  GRACE_DAYS,
  proportionalFeeRefundCents,
  TRIAL_DAYS,
  formatBps,
  formatCents,
  formatDollars,
  getPlan,
  LEGACY_PLAN_CODES,
  PLANS,
  platformFeeBase,
  platformFeeCents,
  resolvePlanId,
  stripeCardPresentFeeCents,
  stripeOnlineFeeCents,
} from "./pricing";

describe("plan definitions", () => {
  it("keeps every amount an integer number of cents", () => {
    for (const plan of PLANS) {
      expect(Number.isInteger(plan.monthlyCents)).toBe(true);
      expect(plan.annualCents === null || Number.isInteger(plan.annualCents)).toBe(true);
      expect(Number.isInteger(plan.platformFeeBps)).toBe(true);
    }
  });

  it("matches the published business model exactly", () => {
    expect(getPlan("volunteer").monthlyCents).toBe(3_900);
    expect(getPlan("volunteer").platformFeeBps).toBe(75);
    expect(getPlan("core").monthlyCents).toBe(9_900);
    expect(getPlan("core").platformFeeBps).toBe(50);
    expect(getPlan("federation").monthlyCents).toBe(24_900);
    expect(getPlan("federation").platformFeeBps).toBe(35);
    expect(getPlan("enterprise").monthlyCents).toBe(79_900);
    expect(getPlan("enterprise").platformFeeBps).toBe(25);
  });

  it("charges more per month but less per swipe as tiers rise", () => {
    const tiers = PLANS.map((p) => ({ m: p.monthlyCents, bps: p.platformFeeBps }));
    expect(tiers.map((t) => t.m)).toEqual([...tiers.map((t) => t.m)].sort((a, b) => a - b));
    expect(tiers.map((t) => t.bps)).toEqual(
      [...tiers.map((t) => t.bps)].sort((a, b) => b - a)
    );
  });

  it("gives location allowances that make sense for the tier", () => {
    expect(getPlan("volunteer").maxLocations).toBe(1);
    expect(getPlan("core").maxLocations).toBe(1);
    expect(getPlan("federation").maxLocations).toBe(5);
    expect(getPlan("enterprise").maxLocations).toBeNull();
  });

  it("gives two months free on annual, and derives the headline from it", () => {
    expect(ANNUAL_MONTHS_CHARGED).toBe(10);
    expect(ANNUAL_DISCOUNT_BPS).toBe(1_667); // ~16.67%

    // The advertised percentage and the amount charged must agree.
    for (const plan of PLANS) {
      expect(plan.annualCents).toBe(annualCentsFor(plan.monthlyCents));
      expect(plan.annualCents).toBe(plan.monthlyCents * 10);
    }
  });

  it("caps each plan's platform fee at its own subscription", () => {
    // The promise: you never pay us more in fees than you pay in subscription.
    for (const plan of PLANS) {
      expect(plan.maxPlatformFeeCents).toBe(plan.monthlyCents);
    }
  });

  it("is generous on trial and grace, and never locks the register", () => {
    expect(TRIAL_DAYS).toBe(30);
    expect(GRACE_DAYS).toBe(14);
    // A shop that owes us money can still take a customer's money, and can
    // still leave with its data. Both are non-negotiable.
    expect(ALWAYS_AVAILABLE).toContain("register");
    expect(ALWAYS_AVAILABLE).toContain("cash_checkout");
    expect(ALWAYS_AVAILABLE).toContain("data_export");
  });
});

describe("legacy plan codes keep working", () => {
  it("resolves every old code to a current plan", () => {
    for (const [legacy, current] of Object.entries(LEGACY_PLAN_CODES)) {
      expect(resolvePlanId(legacy)).toBe(current);
      expect(() => getPlan(legacy)).not.toThrow();
    }
  });

  it("falls back safely rather than throwing on an unknown code", () => {
    expect(resolvePlanId("nonsense")).toBe("volunteer");
    expect(getPlan("nonsense").id).toBe("volunteer");
  });
});

describe("platform fee", () => {
  it("uses the basis-point formula exactly", () => {
    // 0.75% of $100.00 = $0.75
    expect(platformFeeCents(10_000, { platformFeeBps: 75 })).toBe(75);
    expect(platformFeeCents(10_000, { platformFeeBps: 50 })).toBe(50);
    expect(platformFeeCents(10_000, { platformFeeBps: 35 })).toBe(35);
    expect(platformFeeCents(10_000, { platformFeeBps: 25 })).toBe(25);
  });

  it("rounds half-up and stays an integer", () => {
    const fee = platformFeeCents(1_333, { platformFeeBps: 75 });
    expect(Number.isInteger(fee)).toBe(true);
    expect(fee).toBe(Math.round((1_333 * 75) / 10_000));
  });

  it("returns zero for a zero or negative base", () => {
    expect(platformFeeCents(0, { platformFeeBps: 75 })).toBe(0);
    expect(platformFeeCents(-500, { platformFeeBps: 75 })).toBe(0);
  });

  it("honours the exemption switch", () => {
    // This backs both the global kill switch and per-tenant exemptions.
    expect(platformFeeCents(100_000, { platformFeeBps: 75, exempt: true })).toBe(0);
  });

  it("applies configured minimum and maximum fees", () => {
    expect(platformFeeCents(1_000, { platformFeeBps: 75, minimumFeeCents: 25 })).toBe(25);
    expect(platformFeeCents(1_000_000, { platformFeeBps: 75, maximumFeeCents: 500 })).toBe(500);
  });

  it("never charges more than the amount itself", () => {
    expect(platformFeeCents(100, { platformFeeBps: 75, minimumFeeCents: 5_000 })).toBe(100);
  });
});

describe("what the fee is charged on", () => {
  const order = {
    merchandiseSubtotalCents: 10_000,
    discountCents: 1_000,
    taxCents: 700,
    roundUpCents: 43,
  };

  it("excludes tax and round-up by default", () => {
    // Tax is the state's money and round-up is the customer's donation.
    // Charging a platform fee on either needs an explicit decision.
    expect(platformFeeBase(order)).toBe(9_000);
  });

  it("includes them only when configured to", () => {
    expect(platformFeeBase({ ...order, includeTax: true })).toBe(9_700);
    expect(platformFeeBase({ ...order, includeRoundUp: true })).toBe(9_043);
    expect(platformFeeBase({ ...order, includeTax: true, includeRoundUp: true })).toBe(9_743);
  });

  it("never lets a discount push the base below zero", () => {
    expect(
      platformFeeBase({ merchandiseSubtotalCents: 500, discountCents: 900 })
    ).toBe(0);
  });
});

describe("Stripe's published rates", () => {
  it("matches card-present pricing (2.7% + 5¢)", () => {
    expect(stripeCardPresentFeeCents(10_000)).toBe(275);
  });

  it("matches online pricing (2.9% + 30¢)", () => {
    expect(stripeOnlineFeeCents(10_000)).toBe(320);
  });

  it("returns zero on a zero amount", () => {
    expect(stripeCardPresentFeeCents(0)).toBe(0);
    expect(stripeOnlineFeeCents(0)).toBe(0);
  });
});

describe("formatting", () => {
  it("formats cents without floating point drift", () => {
    expect(formatCents(0)).toBe("$0.00");
    expect(formatCents(5)).toBe("$0.05");
    expect(formatCents(3_900)).toBe("$39.00");
    expect(formatCents(123_456)).toBe("$1,234.56");
    expect(formatCents(-250)).toBe("-$2.50");
  });

  it("formats whole dollars for headline figures", () => {
    expect(formatDollars(213_200)).toBe("$2,132");
  });

  it("formats basis points as a readable percentage", () => {
    expect(formatBps(75)).toBe("0.75%");
    expect(formatBps(50)).toBe("0.5%");
    expect(formatBps(25)).toBe("0.25%");
    expect(formatBps(100)).toBe("1%");
  });
});


describe("the monthly cap, spent down one sale at a time", () => {
  const policy = { platformFeeBps: 75 };
  const cap = 3_900; // Volunteer

  it("charges the normal fee while there is headroom", () => {
    expect(cappedPlatformFeeCents(10_000, policy, 0, cap)).toBe(75);
    expect(cappedPlatformFeeCents(10_000, policy, 1_000, cap)).toBe(75);
  });

  it("charges only the remaining headroom on the sale that crosses the cap", () => {
    expect(cappedPlatformFeeCents(10_000, policy, 3_860, cap)).toBe(40);
  });

  it("charges nothing once the cap is reached", () => {
    expect(cappedPlatformFeeCents(10_000, policy, 3_900, cap)).toBe(0);
    expect(cappedPlatformFeeCents(10_000, policy, 99_999, cap)).toBe(0);
  });

  it("does not apply the monthly cap to each transaction in isolation", () => {
    // The bug that would charge a busy shop the cap many times over: 500 sales
    // must total the cap, not 500× the cap.
    let spent = 0;
    for (let i = 0; i < 500; i++) {
      spent += cappedPlatformFeeCents(10_000, policy, spent, cap);
    }
    expect(spent).toBe(cap);
  });

  it("is uncapped when no cap is configured", () => {
    expect(cappedPlatformFeeCents(1_000_000, policy, 0, null)).toBe(7_500);
  });

  it("reaches the cap at a derivable volume", () => {
    const plan = getPlan("volunteer");
    const volume = feeCapReachedAtVolumeCents(plan)!;
    expect(platformFeeCents(volume, { platformFeeBps: plan.platformFeeBps })).toBeGreaterThanOrEqual(
      plan.maxPlatformFeeCents!
    );
  });
});

describe("refunds give the platform fee back proportionally", () => {
  it("returns the whole fee on a full refund", () => {
    expect(proportionalFeeRefundCents(75, 10_000, 10_000)).toBe(75);
  });

  it("returns half the fee on a half refund", () => {
    expect(proportionalFeeRefundCents(100, 10_000, 5_000)).toBe(50);
  });

  it("rounds in the shop's favour, never ours", () => {
    // A third of 100 is 33.33; the shop gets 34.
    expect(proportionalFeeRefundCents(100, 3_000, 1_000)).toBe(34);
  });

  it("never returns more than was charged", () => {
    expect(proportionalFeeRefundCents(75, 10_000, 99_999)).toBe(75);
  });

  it("handles a zero fee or zero base without dividing by zero", () => {
    expect(proportionalFeeRefundCents(0, 10_000, 5_000)).toBe(0);
    expect(proportionalFeeRefundCents(75, 0, 5_000)).toBe(0);
  });
});
