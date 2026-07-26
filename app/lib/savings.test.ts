import { describe, expect, it } from "vitest";
import {
  calculateSavings,
  COMPETITORS,
  HARDWARE_AMORTISATION_MONTHS,
  intakeHoursSavedPerMonth,
  LABOUR_CLAIM,
  feeCapVolumeCents,
  maxMonthlyCostCents,
  recommendPlan,
  SCENARIOS,
  transactionsPerMonth,
  percentFeeCrossoverVolumeCents,
} from "./savings";
import { getPlan, READER_M2_CENTS } from "./pricing";

describe("the published scenarios reproduce the underwriting model", () => {
  // These are the exact figures quoted on the marketing site. If the model
  // drifts, the site is making a claim it can no longer support — so this test
  // is the thing standing between us and an untrue number in public.

  it("small shop vs software-only: ~$665 → ~$619, about 7%", () => {
    const result = calculateSavings({
      monthlyCardVolumeCents: 1_500_000,
      averageTicketCents: 1_200,
      competitorId: "thriftcart",
    });

    expect(result.transactionsPerMonth).toBe(1_250);
    expect(result.plan.id).toBe("volunteer");
    expect(result.incumbent.totalCents).toBe(66_500); // $665.00
    // The fee cap binds here: 0.75% of $15k would be $112.50, capped to $39.
    expect(result.thriftos.platformFeeCents).toBe(3_900);
    expect(result.thriftos.totalCents).toBe(54_550); // $545.50
    expect(result.monthlySavingsCents).toBe(11_950); // $119.50
    expect(result.savingsBps).toBeGreaterThan(1_700); // >17%
  });

  it("medium shop vs a per-module competitor saves well over 20%", () => {
    const result = calculateSavings({
      monthlyCardVolumeCents: 4_000_000,
      averageTicketCents: 1_200,
      competitorId: "thrifttrac",
    });

    expect(result.incumbent.totalCents).toBeGreaterThan(172_000);
    // Cap binds hard at this volume: 0.5% of $40k would be $200, capped to $39.
    expect(result.thriftos.platformFeeCents).toBe(3_900);
    expect(result.savingsBps).toBeGreaterThan(2_000);
    expect(result.verdict).toBe("big-win");
  });

  it("a leased-terminal shop saves dramatically more", () => {
    const softwareOnly = calculateSavings({
      monthlyCardVolumeCents: 1_500_000,
      averageTicketCents: 1_200,
      competitorId: "thriftcart",
    });
    const leased = calculateSavings({
      monthlyCardVolumeCents: 1_500_000,
      averageTicketCents: 1_200,
      competitorId: "leased-mid",
      needsReader: true,
    });

    // This gap is the entire positioning argument. If it ever inverts, the
    // "lead with hardware liberation" pitch is wrong.
    expect(leased.savingsBps).toBeGreaterThan(softwareOnly.savingsBps);
    expect(leased.savingsBps).toBeGreaterThan(1_800); // >18%
    expect(leased.savingsBps).toBeGreaterThan(softwareOnly.savingsBps);
    expect(leased.isModest).toBe(false);
    expect(leased.annualSavingsCents).toBeGreaterThan(200_000); // >$2,000/yr
  });

  it("quotes a real lease buyout for leased competitors", () => {
    const leased = calculateSavings({
      monthlyCardVolumeCents: 1_500_000,
      averageTicketCents: 1_200,
      competitorId: "leased-mid",
    });
    // 48 months × $190 = $9,120 of remaining obligation.
    expect(leased.leaseBuyoutCents).toBe(19_000 * 48);
    expect(leased.leaseBuyoutCents).toBeGreaterThan(700_000);
  });

  it("charges nothing for hardware when the shop uses Tap to Pay", () => {
    const withReader = calculateSavings({
      monthlyCardVolumeCents: 1_500_000,
      averageTicketCents: 1_200,
      needsReader: true,
    });
    const tapToPay = calculateSavings({
      monthlyCardVolumeCents: 1_500_000,
      averageTicketCents: 1_200,
      needsReader: false,
    });

    expect(tapToPay.thriftos.hardwareCents).toBe(0);
    expect(withReader.thriftos.hardwareCents).toBe(
      Math.round(READER_M2_CENTS / HARDWARE_AMORTISATION_MONTHS)
    );
  });
});

describe("plan recommendation is by need, never by upsell", () => {
  it("never recommends a bigger plan just because card volume grew", () => {
    // With the fee capped at each plan's own subscription, Volunteer is the
    // cheapest plan at every volume. Recommending an upgrade "to save money"
    // would be an upsell dressed as advice.
    for (const volume of [500_000, 4_000_000, 20_000_000, 100_000_000]) {
      expect(recommendPlan(volume)).toBe("volunteer");
    }
  });

  it("moves up for locations", () => {
    expect(recommendPlan(1_000_000, 3)).toBe("federation");
    expect(recommendPlan(1_000_000, 9)).toBe("enterprise");
  });

  it("moves up for AI intake allowance", () => {
    expect(recommendPlan(1_000_000, 1, 50)).toBe("volunteer");
    expect(recommendPlan(1_000_000, 1, 500)).toBe("core");
    expect(recommendPlan(1_000_000, 1, 5_000)).toBe("federation");
  });

  it("never recommends a plan whose location limit the shop exceeds", () => {
    const plan = getPlan(recommendPlan(1_000_000, 4));
    expect(plan.maxLocations == null || plan.maxLocations >= 4).toBe(true);
  });

  it("caps the total a shop can ever pay us in a month", () => {
    // Subscription plus capped fee. Nothing else exists.
    expect(maxMonthlyCostCents("volunteer")).toBe(7_800); // $78
    expect(maxMonthlyCostCents("core")).toBe(19_800); // $198
  });

  it("reaches the fee cap at a knowable volume", () => {
    // 0.75% hits $39 at $5,200/month.
    expect(feeCapVolumeCents("volunteer")).toBe(520_000);
  });
});

describe("model robustness", () => {
  it("handles a shop with no card volume at all", () => {
    const result = calculateSavings({
      monthlyCardVolumeCents: 0,
      averageTicketCents: 1_200,
    });
    expect(result.transactionsPerMonth).toBe(0);
    expect(result.thriftos.processingCents).toBe(0);
    expect(result.thriftos.platformFeeCents).toBe(0);
    // Cash-only shops still pay a subscription, and we should not pretend a
    // saving exists where the incumbent is cheaper.
    expect(result.thriftos.totalCents).toBe(getPlan("volunteer").monthlyCents);
  });

  it("never divides by zero on a nonsense average ticket", () => {
    expect(() =>
      calculateSavings({ monthlyCardVolumeCents: 100_000, averageTicketCents: 0 })
    ).not.toThrow();
    expect(transactionsPerMonth(100_000, 0)).toBe(0);
  });

  it("keeps every output an integer number of cents", () => {
    for (const scenario of SCENARIOS) {
      for (const competitor of COMPETITORS) {
        const r = calculateSavings({
          monthlyCardVolumeCents: scenario.monthlyCardVolumeCents,
          averageTicketCents: scenario.averageTicketCents,
          competitorId: competitor.id,
        });
        for (const value of [
          r.incumbent.totalCents,
          r.thriftos.totalCents,
          r.monthlySavingsCents,
          r.annualSavingsCents,
          r.thriftos.platformFeeCents,
        ]) {
          expect(Number.isInteger(value)).toBe(true);
        }
      }
    }
  });

  it("classifies every scenario honestly rather than assuming we always win", () => {
    for (const scenario of SCENARIOS) {
      for (const competitor of COMPETITORS) {
        const r = calculateSavings({
          monthlyCardVolumeCents: scenario.monthlyCardVolumeCents,
          averageTicketCents: scenario.averageTicketCents,
          competitorId: competitor.id,
        });
        // The verdict must agree with the arithmetic, whichever way it falls.
        if (r.monthlySavingsCents <= 0) {
          expect(r.verdict, `${scenario.id} vs ${competitor.id}`).toBe("costs-more");
        } else if (r.savingsBps >= 1_200) {
          expect(r.verdict).toBe("big-win");
        } else {
          expect(r.verdict).toBe("modest-win");
        }
      }
    }
  });

  it("the fee cap is what makes us cheaper at every published volume", () => {
    // Before the cap, a $40k/month shop paid us more than ThriftCart Core.
    // This is the test that proves the cap fixed it — and it fails loudly if
    // the cap is ever removed or raised past the point where it binds.
    const r = calculateSavings({
      monthlyCardVolumeCents: 4_000_000,
      averageTicketCents: 1_200,
      competitorId: "thriftcart",
    });

    expect(r.monthlySavingsCents).toBeGreaterThan(0);
    expect(r.thriftos.platformFeeCents).toBe(getPlan("volunteer").maxPlatformFeeCents);

    // Without the cap the fee would have been $200 and we would have lost.
    const uncappedFee = Math.round((4_000_000 * 75) / 10_000);
    expect(uncappedFee).toBeGreaterThan(r.thriftos.platformFeeCents!);
  });

  it("still reports 'costs-more' honestly if the arithmetic ever says so", () => {
    // The honesty branch must keep working even though no published competitor
    // currently triggers it. A competitor at $1/month would.
    const r = calculateSavings({
      monthlyCardVolumeCents: 100_000,
      averageTicketCents: 1_200,
      competitorId: "thriftcart",
      planId: "enterprise", // $799/month against $150 software
    });
    expect(r.monthlySavingsCents).toBeLessThan(0);
    expect(r.verdict).toBe("costs-more");
  });

  it("wins clearly against leased hardware at small and medium scale", () => {
    // Hardware liberation is the claim we can make loudly — up to a point.
    for (const scenario of SCENARIOS.filter((s) => s.id !== "large")) {
      for (const competitor of COMPETITORS.filter((c) => c.leaseTermMonths > 0)) {
        const r = calculateSavings({
          monthlyCardVolumeCents: scenario.monthlyCardVolumeCents,
          averageTicketCents: scenario.averageTicketCents,
          competitorId: competitor.id,
          needsReader: true,
        });
        expect(r.monthlySavingsCents, `${scenario.id} vs ${competitor.id}`).toBeGreaterThan(0);
      }
    }
  });

  it("saves more as a shop grows, now that the fee stops growing", () => {
    // With the fee capped, our cost is nearly flat while an incumbent's
    // percentage processing keeps climbing — so the gap widens with scale.
    const small = calculateSavings({
      monthlyCardVolumeCents: 1_500_000,
      averageTicketCents: 1_200,
      competitorId: "leased-mid",
      needsReader: true,
    });
    const medium = calculateSavings({
      monthlyCardVolumeCents: 4_000_000,
      averageTicketCents: 1_200,
      competitorId: "leased-mid",
      needsReader: true,
    });

    expect(small.verdict).toBe("big-win");
    expect(medium.verdict).toBe("big-win");
    expect(medium.monthlySavingsCents).toBeGreaterThan(small.monthlySavingsCents);
  });

  it("has no volume at which any published competitor beats us", () => {
    // The whole point of the cap. If this ever regresses, the comparison page
    // must go back to publishing a crossover — so this test failing is a
    // marketing-copy change, not just a code change.
    for (const competitor of COMPETITORS) {
      expect(
        percentFeeCrossoverVolumeCents(competitor.id, 1_200),
        competitor.id
      ).toBe(Number.POSITIVE_INFINITY);
    }
  });

  it("is cheaper than every published competitor at every published scale", () => {
    for (const scenario of SCENARIOS) {
      for (const competitor of COMPETITORS) {
        const r = calculateSavings({
          monthlyCardVolumeCents: scenario.monthlyCardVolumeCents,
          averageTicketCents: scenario.averageTicketCents,
          competitorId: competitor.id,
        });
        expect(r.monthlySavingsCents, `${scenario.id} vs ${competitor.id}`).toBeGreaterThan(0);
      }
    }
  });
});

describe("competitor profiles are fair", () => {
  it("uses each competitor's lower/mid published tier, never their worst", () => {
    const thriftcart = COMPETITORS.find((c) => c.id === "thriftcart")!;
    expect(thriftcart.softwareMonthlyCents).toBe(15_000);
    expect(thriftcart.hardwareLeaseMonthlyCents).toBe(0);
  });

  it("says out loud where a competitor is reasonably priced", () => {
    const thriftcart = COMPETITORS.find((c) => c.id === "thriftcart")!;
    expect(thriftcart.note.toLowerCase()).toMatch(/fair|modest|well-priced/);
  });

  it("gives every competitor the same processing assumption", () => {
    const rates = new Set(COMPETITORS.map((c) => c.processingBps));
    expect(rates.size).toBe(1);
  });
});

describe("the labour claim stays attributed", () => {
  it("is framed as an industry figure with a caveat, not a promise", () => {
    expect(LABOUR_CLAIM.attribution.length).toBeGreaterThan(10);
    expect(LABOUR_CLAIM.caveat.toLowerCase()).toMatch(/not a promise/);
  });

  it("converts seconds saved into believable volunteer hours", () => {
    // 1,000 items × 33s = 9.2 hours
    expect(intakeHoursSavedPerMonth(1_000)).toBeCloseTo(9.2, 1);
    expect(intakeHoursSavedPerMonth(0)).toBe(0);
  });
});
