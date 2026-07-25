import { describe, expect, it } from "vitest";
import {
  formatCents,
  getPlan,
  grossUpToCoverFees,
  monthlyChargeCents,
  PLANS,
  platformFeeCents,
  stallBreakEvenSales,
  stallMonthlyCents,
  stripeFeeCents,
  usageCapCents,
} from "./pricing";

describe("plan definitions", () => {
  it("keeps every amount an integer number of cents", () => {
    for (const plan of PLANS) {
      expect(Number.isInteger(plan.monthlyCents)).toBe(true);
      expect(Number.isInteger(plan.perSaleCents)).toBe(true);
    }
  });

  it("orders plans by ascending price", () => {
    const flat = PLANS.filter((p) => p.monthlyCents > 0).map((p) => p.monthlyCents);
    expect(flat).toEqual([...flat].sort((a, b) => a - b));
  });
});

describe("the usage cap is derived, not hardcoded", () => {
  it("equals the next flat tier exactly", () => {
    expect(usageCapCents()).toBe(getPlan("shop").monthlyCents);
  });

  it("never bills a Stall month above the cap, however busy", () => {
    expect(stallMonthlyCents(100_000)).toBe(usageCapCents());
    expect(stallMonthlyCents(1_000_000)).toBe(usageCapCents());
  });

  it("bills per sale below the cap", () => {
    expect(stallMonthlyCents(10)).toBe(120);
    expect(stallMonthlyCents(0)).toBe(0);
  });

  it("charges exactly the cap at the break-even point, and not a cent more after", () => {
    const breakEven = stallBreakEvenSales();
    expect(stallMonthlyCents(breakEven)).toBe(usageCapCents());
    expect(stallMonthlyCents(breakEven + 1)).toBe(usageCapCents());
    // One sale short must still be under the cap — otherwise the marketing
    // claim "never more than Shop" would be describing the wrong boundary.
    expect(stallMonthlyCents(breakEven - 1)).toBeLessThan(usageCapCents());
  });

  it("ignores nonsense sale counts rather than producing negative charges", () => {
    expect(stallMonthlyCents(-5)).toBe(0);
    expect(stallMonthlyCents(3.7)).toBe(3 * getPlan("stall").perSaleCents);
  });

  it("charges flat plans their flat price regardless of volume", () => {
    expect(monthlyChargeCents("shop", 0)).toBe(getPlan("shop").monthlyCents);
    expect(monthlyChargeCents("shop", 99_999)).toBe(getPlan("shop").monthlyCents);
  });
});

describe("fees", () => {
  it("takes 1% as the platform fee", () => {
    expect(platformFeeCents(10_000)).toBe(100);
    expect(platformFeeCents(0)).toBe(0);
  });

  it("matches Stripe's published US card rate", () => {
    // $10.00 → 2.9% + 30¢ = 59¢
    expect(stripeFeeCents(1000)).toBe(59);
  });

  it("grosses up so the shop nets at least the intended amount", () => {
    for (const net of [500, 1000, 2500, 10_000, 100_000]) {
      const gross = grossUpToCoverFees(net);
      const received = gross - stripeFeeCents(gross) - platformFeeCents(gross);
      // Rounding may leave a cent over, but never under — the shop must not
      // silently absorb the fee it was told the payer covered.
      expect(received).toBeGreaterThanOrEqual(net);
      expect(received - net).toBeLessThanOrEqual(2);
    }
  });

  it("returns zero for a zero or negative gross-up", () => {
    expect(grossUpToCoverFees(0)).toBe(0);
    expect(grossUpToCoverFees(-100)).toBe(0);
  });
});

describe("formatCents", () => {
  it("formats without floating point drift", () => {
    expect(formatCents(0)).toBe("$0.00");
    expect(formatCents(5)).toBe("$0.05");
    expect(formatCents(4900)).toBe("$49.00");
    expect(formatCents(123_456)).toBe("$1234.56");
    expect(formatCents(-250)).toBe("-$2.50");
  });
});
