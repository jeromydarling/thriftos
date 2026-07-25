import { describe, expect, it } from "vitest";
import {
  currentDiscountPct,
  DEFAULT_MARKDOWN_RULES,
  daysBetween,
  effectivePriceCents,
  markdownCents,
  nextMarkdown,
  tagColorForIntake,
  type MarkdownRule,
} from "./markdown";

const RULES: MarkdownRule[] = [
  { tagColor: "green", weekIndex: 0, discountPct: 0, ageDays: 0 },
  { tagColor: "yellow", weekIndex: 1, discountPct: 25, ageDays: 14 },
  { tagColor: "blue", weekIndex: 2, discountPct: 50, ageDays: 28 },
  { tagColor: "red", weekIndex: 3, discountPct: 75, ageDays: 42 },
];

const at = (iso: string) => new Date(`${iso}T12:00:00Z`);

describe("daysBetween", () => {
  it("counts whole days and never goes negative", () => {
    expect(daysBetween("2026-01-01", "2026-01-15")).toBe(14);
    expect(daysBetween("2026-01-15", "2026-01-01")).toBe(0);
    expect(daysBetween("2026-01-01", "2026-01-01")).toBe(0);
  });
});

describe("tag rotation", () => {
  it("cycles through the active colours", () => {
    const colors = new Set<string>();
    for (let week = 0; week < 8; week++) {
      const date = new Date(Date.UTC(2026, 0, 1 + week * 7)).toISOString().slice(0, 10);
      colors.add(tagColorForIntake(date, RULES));
    }
    expect(colors.size).toBe(RULES.length);
  });

  it("gives the same colour to everything logged on the same day", () => {
    expect(tagColorForIntake("2026-03-10", RULES)).toBe(tagColorForIntake("2026-03-10", RULES));
  });

  it("falls back to a sane colour on unusable input", () => {
    expect(tagColorForIntake("not-a-date", RULES)).toBe("green");
    expect(tagColorForIntake("2026-03-10", [])).toBe("green");
  });
});

describe("a discount must be earned by both colour and age", () => {
  it("charges full price for a discounted colour that is still too new", () => {
    // A blue tag applied this morning is not half price. This is the bug that
    // would quietly give away money on every fresh item.
    const item = { priceCents: 1000, tagColor: "blue", intakeDate: "2026-03-01" };
    expect(currentDiscountPct(item, RULES, at("2026-03-02"))).toBe(0);
    expect(effectivePriceCents(item, RULES, at("2026-03-02"))).toBe(1000);
  });

  it("applies the discount once the age threshold is reached", () => {
    const item = { priceCents: 1000, tagColor: "blue", intakeDate: "2026-03-01" };
    expect(currentDiscountPct(item, RULES, at("2026-03-29"))).toBe(50);
    expect(effectivePriceCents(item, RULES, at("2026-03-29"))).toBe(500);
  });

  it("applies exactly on the boundary day, not the day after", () => {
    const item = { priceCents: 1000, tagColor: "yellow", intakeDate: "2026-03-01" };
    expect(currentDiscountPct(item, RULES, at("2026-03-14"))).toBe(0); // 13 days
    expect(currentDiscountPct(item, RULES, at("2026-03-15"))).toBe(25); // 14 days
  });

  it("never discounts an untagged item", () => {
    const item = { priceCents: 1000, tagColor: null, intakeDate: "2020-01-01" };
    expect(effectivePriceCents(item, RULES, at("2026-03-01"))).toBe(1000);
  });
});

describe("effective price arithmetic", () => {
  it("stays in integer cents and rounds half-up on the discount", () => {
    const item = { priceCents: 333, tagColor: "blue", intakeDate: "2026-01-01" };
    const price = effectivePriceCents(item, RULES, at("2026-06-01"));
    expect(Number.isInteger(price)).toBe(true);
    expect(price).toBe(333 - Math.round(333 * 0.5)); // 167 off → 166
  });

  it("never returns a negative price", () => {
    const rules: MarkdownRule[] = [{ tagColor: "white", weekIndex: 0, discountPct: 100, ageDays: 0 }];
    const item = { priceCents: 500, tagColor: "white", intakeDate: "2026-01-01" };
    expect(effectivePriceCents(item, rules, at("2026-06-01"))).toBe(0);
  });

  it("reports what the shopper saved", () => {
    const item = { priceCents: 1000, tagColor: "red", intakeDate: "2026-01-01" };
    expect(markdownCents(item, RULES, at("2026-06-01"))).toBe(750);
  });

  it("clamps a nonsense discount rather than inverting the price", () => {
    const rules: MarkdownRule[] = [{ tagColor: "green", weekIndex: 0, discountPct: 250, ageDays: 0 }];
    const item = { priceCents: 1000, tagColor: "green", intakeDate: "2026-01-01" };
    expect(effectivePriceCents(item, rules, at("2026-06-01"))).toBe(0);
  });

  it("ignores rules a shop has switched off", () => {
    const rules: MarkdownRule[] = [
      { tagColor: "blue", weekIndex: 0, discountPct: 50, ageDays: 0, isActive: false },
    ];
    const item = { priceCents: 1000, tagColor: "blue", intakeDate: "2026-01-01" };
    expect(effectivePriceCents(item, rules, at("2026-06-01"))).toBe(1000);
  });
});

describe("nextMarkdown", () => {
  it("tells staff honestly when the price drops", () => {
    const item = { tagColor: "blue", intakeDate: "2026-03-01" };
    expect(nextMarkdown(item, RULES, at("2026-03-08"))).toEqual({ inDays: 21, toPct: 50 });
  });

  it("returns null once the drop has already happened", () => {
    const item = { tagColor: "blue", intakeDate: "2026-03-01" };
    expect(nextMarkdown(item, RULES, at("2026-05-01"))).toBeNull();
  });

  it("returns null for a colour that never discounts", () => {
    const item = { tagColor: "green", intakeDate: "2026-03-01" };
    expect(nextMarkdown(item, RULES, at("2026-03-08"))).toBeNull();
  });
});

describe("the shipped defaults", () => {
  it("step down monotonically as items age", () => {
    const discounting = DEFAULT_MARKDOWN_RULES.filter((r) => r.discountPct > 0).slice()
      .sort((a, b) => a.ageDays - b.ageDays);
    const pcts = discounting.map((r) => r.discountPct);
    expect(pcts).toEqual([...pcts].sort((a, b) => a - b));
  });

  it("give every colour a unique name", () => {
    const names = DEFAULT_MARKDOWN_RULES.map((r) => r.tagColor);
    expect(new Set(names).size).toBe(names.length);
  });
});
