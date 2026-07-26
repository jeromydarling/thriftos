import { describe, expect, it } from "vitest";
import {
  calculateSavings,
  COMPETITORS,
  HARDWARE_AMORTISATION_MONTHS,
  intakeHoursSavedPerMonth,
  LABOUR_CLAIM,
  planCrossoverVolumeCents,
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
    expect(result.thriftos.totalCents).toBe(61_900); // $619.00
    expect(result.monthlySavingsCents).toBe(4_600); // $46.00
    expect(result.annualSavingsCents).toBe(55_200); // $552
    expect(result.savingsBps).toBeGreaterThanOrEqual(680);
    expect(result.savingsBps).toBeLessThanOrEqual(700);
    // Modest, and the site must say so.
    expect(result.isModest).toBe(true);
  });

  it("medium shop vs a per-module competitor: ~$1,723 → ~$1,546, about 10%", () => {
    const result = calculateSavings({
      monthlyCardVolumeCents: 4_000_000,
      averageTicketCents: 1_200,
      competitorId: "thrifttrac",
    });

    expect(result.plan.id).toBe("core");
    expect(result.incumbent.totalCents).toBeGreaterThan(172_000);
    expect(result.incumbent.totalCents).toBeLessThan(172_500);
    expect(result.thriftos.totalCents).toBeGreaterThan(154_000);
    expect(result.thriftos.totalCents).toBeLessThan(155_000);
    expect(result.savingsBps).toBeGreaterThanOrEqual(1_000);
    expect(result.savingsBps).toBeLessThanOrEqual(1_060);
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

describe("plan recommendation is by total cost, not sticker price", () => {
  it("puts a small shop on Volunteer", () => {
    expect(recommendPlan(500_000)).toBe("volunteer");
  });

  it("moves a busy shop to Core, even though it costs more per month", () => {
    // Core is $60/month dearer but 25bps cheaper. Recommending Volunteer here
    // to look cheap would cost the shop money in month one.
    expect(recommendPlan(6_000_000)).toBe("core");
  });

  it("crosses over exactly where the arithmetic says it should", () => {
    const crossover = planCrossoverVolumeCents();
    expect(crossover).toBe(2_400_000); // $24,000/month

    const below = calculateSavings({
      monthlyCardVolumeCents: crossover - 100_000,
      averageTicketCents: 1_200,
    });
    const above = calculateSavings({
      monthlyCardVolumeCents: crossover + 100_000,
      averageTicketCents: 1_200,
    });

    expect(below.plan.id).toBe("volunteer");
    expect(above.plan.id).toBe("core");
  });

  it("routes multi-location shops to the right tier", () => {
    expect(recommendPlan(1_000_000, 3)).toBe("federation");
    expect(recommendPlan(1_000_000, 9)).toBe("enterprise");
  });

  it("never recommends a plan whose location limit the shop exceeds", () => {
    const plan = getPlan(recommendPlan(1_000_000, 4));
    expect(plan.maxLocations == null || plan.maxLocations >= 4).toBe(true);
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

  it("admits ThriftOS costs more against a keenly-priced competitor at volume", () => {
    // This is the case the marketing site must never paper over. At $40k/month
    // our 0.50% platform fee outweighs the cheaper subscription and processing
    // against a $150/month software-only competitor. A prospect will find this
    // with a calculator in four minutes; far better they hear it from us.
    const r = calculateSavings({
      monthlyCardVolumeCents: 4_000_000,
      averageTicketCents: 1_200,
      competitorId: "thriftcart",
    });

    expect(r.verdict).toBe("costs-more");
    expect(r.monthlySavingsCents).toBeLessThan(0);
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

  it("saves a small shop the most, proportionally, against a lease", () => {
    // A fixed lease is a far bigger share of a small shop's costs, so the
    // percentage saving shrinks as the shop grows. That inverts the usual
    // "bigger customer, bigger saving" instinct and is worth targeting on.
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
    expect(small.savingsBps).toBeGreaterThan(medium.savingsBps);
    expect(medium.verdict).toBe("modest-win");
  });

  it("stops being cheaper above a knowable volume, and admits it", () => {
    // A percentage fee scales; a fixed lease does not. Past some volume the
    // incumbent's flat cost wins. Pretending otherwise on the pricing page
    // would be a lie a large shop discovers on day one — so the site shows the
    // crossover instead, and points those shops at Enterprise terms.
    const crossover = percentFeeCrossoverVolumeCents("leased-mid", 1_400);

    expect(crossover).toBeGreaterThan(4_000_000); // above medium scale
    expect(Number.isFinite(crossover)).toBe(true);

    const below = calculateSavings({
      monthlyCardVolumeCents: crossover - 1_000_000,
      averageTicketCents: 1_400,
      competitorId: "leased-mid",
    });
    const above = calculateSavings({
      monthlyCardVolumeCents: crossover + 1_000_000,
      averageTicketCents: 1_400,
      competitorId: "leased-mid",
    });

    expect(below.monthlySavingsCents).toBeGreaterThan(0);
    expect(above.verdict).toBe("costs-more");
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
