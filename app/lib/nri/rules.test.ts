import { describe, expect, it } from "vitest";
import { deriveSignals, medianGapDays, prioritize, THRESHOLDS, weekStamp } from "./rules";
import type { NriSnapshot } from "./types";
import { DISCERNMENT } from "./voice";

const NOW = new Date("2026-07-25T12:00:00Z");

/** A shop where nothing notable is happening. Rules must stay quiet on this. */
function quietShop(overrides: Partial<NriSnapshot> = {}): NriSnapshot {
  return {
    orgId: "og_test",
    orgName: "Second Chances",
    now: NOW.toISOString(),
    quietDonors: [],
    returningDonors: [],
    firstTimeDonorsUnacknowledged: [],
    donationsMissingReceipts: 0,
    donationsMissingReceiptsOldestDays: 0,
    quietVolunteers: [],
    volunteersWithoutUpcoming: 0,
    inventory: {
      available: 200,
      intakeLast7: 20,
      intakePrev7: 18,
      soldLast7: 18,
      soldPrev7: 20,
      atFinalMarkdown: 5,
      unpriced: 2,
      pastRotation: 5,
      oldestAvailableDays: 40,
    },
    impact: {
      diversionLbsTotal: 400,
      diversionLbsThisMonth: 50,
      itemsRehomedTotal: 120,
      itemsRehomedThisMonth: 20,
      valueDeliveredCentsThisMonth: 40_000,
      volunteerHoursThisMonth: 20,
      volunteerHoursPrevMonth: 22,
      volunteerHeadcountThisMonth: 4,
    },
    multiRoleContacts: [],
    reflectionsLast30: 6,
    reflectionsPrev30: 7,
    celebratedMilestones: [],
    ...overrides,
  };
}

describe("silence is a valid output", () => {
  it("says nothing at all about an ordinary week", () => {
    expect(deriveSignals(quietShop(), NOW)).toEqual([]);
  });

  it("stays quiet when every measure sits just under its threshold", () => {
    const snapshot = quietShop({
      donationsMissingReceipts: THRESHOLDS.missingReceiptsMin - 1,
      donationsMissingReceiptsOldestDays: 90,
      inventory: {
        ...quietShop().inventory,
        atFinalMarkdown: THRESHOLDS.finalMarkdownMin - 1,
        unpriced: THRESHOLDS.unpricedMin - 1,
      },
    });
    expect(deriveSignals(snapshot, NOW)).toEqual([]);
  });
});

describe("determinism", () => {
  it("produces identical output for identical input", () => {
    const snapshot = quietShop({
      inventory: { ...quietShop().inventory, unpriced: 40 },
      donationsMissingReceipts: 12,
      donationsMissingReceiptsOldestDays: 30,
    });
    // This is what makes "why am I seeing this?" answerable. A model in this
    // path would break it.
    expect(deriveSignals(snapshot, NOW)).toEqual(deriveSignals(snapshot, NOW));
  });
});

describe("a quiet donor is measured against their own rhythm", () => {
  const donor = {
    contactId: "ct_marta",
    name: "Marta Ellison",
    donationCount: 6,
    firstDonationAt: "2025-01-10T00:00:00Z",
    lastDonationAt: "2026-05-01T00:00:00Z",
    daysSinceLast: 85,
    medianGapDays: 30,
    hasReceipt: true,
    acknowledged: true,
  };

  it("notices someone well past their usual gap", () => {
    const signals = deriveSignals(quietShop({ quietDonors: [donor] }), NOW);
    const signal = signals.find((s) => s.dedupeKey.includes("donor_quiet"));
    expect(signal).toBeDefined();
    expect(signal?.kind).toBe("check_in");
    expect(signal?.subjectId).toBe("ct_marta");
    expect(signal?.evidence.usual_gap_days).toBe(30);
  });

  it("stays quiet about someone with too little history to have a rhythm", () => {
    const signals = deriveSignals(
      quietShop({ quietDonors: [{ ...donor, donationCount: 2 }] }),
      NOW
    );
    expect(signals.filter((s) => s.dedupeKey.includes("donor_quiet"))).toHaveLength(0);
  });

  it("stays quiet before the absolute minimum, however brisk their rhythm", () => {
    const signals = deriveSignals(
      quietShop({ quietDonors: [{ ...donor, medianGapDays: 3, daysSinceLast: 20 }] }),
      NOW
    );
    expect(signals.filter((s) => s.dedupeKey.includes("donor_quiet"))).toHaveLength(0);
  });

  it("never calls a person lapsed, churned, or low-value", () => {
    const signals = deriveSignals(quietShop({ quietDonors: [donor] }), NOW);
    for (const signal of signals) {
      const text = `${signal.title} ${signal.summary}`.toLowerCase();
      expect(text).not.toMatch(/lapsed|churn|low.?value|tier \d|inactive/);
    }
  });

  it("surfaces at most a handful of people at once", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ ...donor, contactId: `ct_${i}` }));
    const signals = deriveSignals(quietShop({ quietDonors: many }), NOW);
    expect(signals.filter((s) => s.dedupeKey.includes("donor_quiet")).length).toBeLessThanOrEqual(3);
  });
});

describe("celebrations", () => {
  it("marks a diversion milestone once it is crossed", () => {
    const snapshot = quietShop({
      impact: { ...quietShop().impact, diversionLbsTotal: 5_400 },
    });
    const signal = deriveSignals(snapshot, NOW).find((s) => s.dedupeKey.startsWith("celebration:diversion"));
    expect(signal).toBeDefined();
    expect(signal?.evidence.milestone_lbs).toBe(5_000);
  });

  it("never repeats a milestone already celebrated", () => {
    const snapshot = quietShop({
      impact: { ...quietShop().impact, diversionLbsTotal: 5_400 },
      celebratedMilestones: ["diversion:5000"],
    });
    expect(
      deriveSignals(snapshot, NOW).filter((s) => s.dedupeKey.startsWith("celebration:diversion"))
    ).toHaveLength(0);
  });

  it("reports the largest milestone crossed, not the smallest", () => {
    const snapshot = quietShop({
      impact: { ...quietShop().impact, diversionLbsTotal: 60_000 },
    });
    const signal = deriveSignals(snapshot, NOW).find((s) => s.dedupeKey.startsWith("celebration:diversion"));
    expect(signal?.evidence.milestone_lbs).toBe(50_000);
  });
});

describe("the floor", () => {
  it("notices intake outpacing sales, but only with real volume behind it", () => {
    const busy = quietShop({
      inventory: { ...quietShop().inventory, intakeLast7: 60, soldLast7: 20 },
    });
    expect(deriveSignals(busy, NOW).some((s) => s.dedupeKey.includes("backlog"))).toBe(true);

    // Same ratio, tiny numbers — a slow week, not a problem.
    const slow = quietShop({
      inventory: { ...quietShop().inventory, intakeLast7: 6, soldLast7: 2 },
    });
    expect(deriveSignals(slow, NOW).some((s) => s.dedupeKey.includes("backlog"))).toBe(false);
  });

  it("does not divide by zero when nothing sold", () => {
    const snapshot = quietShop({
      inventory: { ...quietShop().inventory, intakeLast7: 80, soldLast7: 0 },
    });
    expect(() => deriveSignals(snapshot, NOW)).not.toThrow();
  });

  it("mentions receipts only when they are both numerous and old", () => {
    const numerousButFresh = quietShop({
      donationsMissingReceipts: 20,
      donationsMissingReceiptsOldestDays: 2,
    });
    expect(
      deriveSignals(numerousButFresh, NOW).some((s) => s.dedupeKey.includes("receipts_pending"))
    ).toBe(false);

    const numerousAndOld = quietShop({
      donationsMissingReceipts: 20,
      donationsMissingReceiptsOldestDays: 40,
    });
    expect(
      deriveSignals(numerousAndOld, NOW).some((s) => s.dedupeKey.includes("receipts_pending"))
    ).toBe(true);
  });
});

describe("evidence and dedupe", () => {
  const loud = quietShop({
    donationsMissingReceipts: 20,
    donationsMissingReceiptsOldestDays: 40,
    inventory: { ...quietShop().inventory, unpriced: 40, atFinalMarkdown: 90 },
    impact: { ...quietShop().impact, diversionLbsTotal: 12_000, volunteerHoursThisMonth: 120 },
  });

  it("attaches evidence to every signal", () => {
    for (const signal of deriveSignals(loud, NOW)) {
      expect(Object.keys(signal.evidence).length).toBeGreaterThan(0);
    }
  });

  it("gives every signal a unique, stable dedupe key", () => {
    const keys = deriveSignals(loud, NOW).map((s) => s.dedupeKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(deriveSignals(loud, NOW).map((s) => s.dedupeKey)).toEqual(keys);
  });

  it("caps how much it will say in one pass", () => {
    expect(deriveSignals(loud, NOW).length).toBeLessThanOrEqual(DISCERNMENT.maxPerRun);
  });

  it("puts celebrations before nudges", () => {
    const kinds = deriveSignals(loud, NOW).map((s) => s.kind);
    const firstHeadsUp = kinds.indexOf("heads_up");
    const lastCelebration = kinds.lastIndexOf("celebration");
    if (firstHeadsUp !== -1 && lastCelebration !== -1) {
      expect(lastCelebration).toBeLessThan(firstHeadsUp);
    }
  });
});

describe("prioritize", () => {
  it("drops duplicate dedupe keys", () => {
    const one = {
      kind: "check_in" as const,
      title: "t",
      summary: "s",
      evidence: {},
      confidence: "moderate" as const,
      dedupeKey: "same",
    };
    expect(prioritize([one, { ...one, title: "other" }])).toHaveLength(1);
  });
});

describe("medianGapDays", () => {
  it("returns null without at least two visits", () => {
    expect(medianGapDays([])).toBeNull();
    expect(medianGapDays(["2026-01-01T00:00:00Z"])).toBeNull();
  });

  it("computes the middle gap, resisting one unusual absence", () => {
    const dates = [
      "2026-01-01T00:00:00Z",
      "2026-02-01T00:00:00Z", // 31
      "2026-03-01T00:00:00Z", // 28
      "2026-09-01T00:00:00Z", // 184 — one long gap shouldn't move the median much
    ];
    const gap = medianGapDays(dates);
    expect(gap).toBeGreaterThanOrEqual(28);
    expect(gap).toBeLessThanOrEqual(35);
  });
});

describe("weekStamp", () => {
  it("returns the Monday of the week, so a noticing can recur next week", () => {
    expect(weekStamp(new Date("2026-07-25T12:00:00Z"))).toBe("2026-07-20"); // Sat → Mon
    expect(weekStamp(new Date("2026-07-26T12:00:00Z"))).toBe("2026-07-20"); // Sun → same Mon
    expect(weekStamp(new Date("2026-07-27T12:00:00Z"))).toBe("2026-07-27"); // Mon → itself
  });
});
