import { describe, expect, it } from "vitest";
import {
  diversionLbs,
  impactNarrative,
  lbsToTons,
  toCsv,
  valueDeliveredCents,
  volunteerHoursValueCents,
  EMPTY_TOTALS,
} from "./impact";

describe("value delivered is honest or it is nothing", () => {
  it("counts the difference between retail and what was paid", () => {
    expect(
      valueDeliveredCents([
        { retailEstimateCents: 9000, pricePaidCents: 1200 },
        { retailEstimateCents: 3200, pricePaidCents: 500 },
      ])
    ).toBe(7800 + 2700);
  });

  it("claims nothing where no retail comparison was recorded", () => {
    // The tempting bug is to invent a multiplier here. That would make every
    // impact report a fiction.
    expect(valueDeliveredCents([{ retailEstimateCents: 0, pricePaidCents: 500 }])).toBe(0);
  });

  it("never goes negative when an item sold above its comparison", () => {
    expect(valueDeliveredCents([{ retailEstimateCents: 1000, pricePaidCents: 4000 }])).toBe(0);
  });

  it("returns zero for no lines", () => {
    expect(valueDeliveredCents([])).toBe(0);
  });
});

describe("diversion counts only what actually left", () => {
  it("counts sold, transferred, and recycled", () => {
    expect(
      diversionLbs([
        { weightLbs: 10, status: "sold" },
        { weightLbs: 5, status: "transferred" },
        { weightLbs: 2, status: "recycled" },
      ])
    ).toBe(17);
  });

  it("does not count stock still sitting on the floor", () => {
    expect(
      diversionLbs([
        { weightLbs: 100, status: "available" },
        { weightLbs: 50, status: "held" },
        { weightLbs: 10, status: "sold" },
      ])
    ).toBe(10);
  });

  it("ignores missing or nonsensical weights", () => {
    expect(
      diversionLbs([
        { weightLbs: 0, status: "sold" },
        { weightLbs: -5, status: "sold" },
        { weightLbs: Number.NaN, status: "sold" },
        { weightLbs: 8, status: "sold" },
      ])
    ).toBe(8);
  });
});

describe("unit conversions", () => {
  it("converts pounds to tons", () => {
    expect(lbsToTons(4000)).toBe(2);
    expect(lbsToTons(500)).toBe(0.25);
  });

  it("prices volunteer hours against the published national figure", () => {
    expect(volunteerHoursValueCents(10)).toBe(34_650);
    expect(volunteerHoursValueCents(0)).toBe(0);
    expect(volunteerHoursValueCents(-4)).toBe(0);
  });
});

describe("narrative", () => {
  it("says nothing when there is nothing to say", () => {
    expect(impactNarrative(EMPTY_TOTALS, "Second Chances")).toEqual([]);
  });

  it("uses tons once the number is large enough to warrant it", () => {
    const lines = impactNarrative({ ...EMPTY_TOTALS, diversionLbs: 6000 }, "Second Chances");
    expect(lines[0]).toContain("tons");
  });

  it("uses pounds for smaller shops rather than an awkward fraction", () => {
    const lines = impactNarrative({ ...EMPTY_TOTALS, diversionLbs: 400 }, "Second Chances");
    expect(lines[0]).toContain("pounds");
  });

  it("makes no claim it can't support", () => {
    const lines = impactNarrative({ ...EMPTY_TOTALS, volunteerHours: 100 }, "Shop").join(" ");
    expect(lines.toLowerCase()).not.toMatch(/best|leading|award|#1|unmatched/);
  });
});

describe("CSV export", () => {
  it("quotes and escapes properly", () => {
    const csv = toCsv([{ name: 'A "quoted" shop', total: 1200 }]);
    expect(csv).toContain('"A ""quoted"" shop"');
  });

  it("neutralises formula injection", () => {
    // A cell starting with = would execute when the grant officer opens it.
    const csv = toCsv([{ note: "=cmd|'/c calc'!A1" }]);
    expect(csv).toContain("\"'=cmd");
  });

  it("returns empty string for no rows", () => {
    expect(toCsv([])).toBe("");
  });
});
