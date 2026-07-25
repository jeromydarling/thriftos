/**
 * Color-tag markdown — the oldest trick in thrift retail, encoded.
 *
 * Every item gets a colored tag on the day it hits the floor. The color tells
 * you how old it is at a glance, and each color steps down in price as it ages.
 * Stores set their own rotation and their own discounts: subsidiarity means we
 * ship a sensible default and then get out of the way.
 *
 * Pure functions only — no DB, no clock reads except what's passed in. That
 * makes the arithmetic testable, and this is arithmetic that decides what a
 * shopper pays, so it had better be right.
 */

export interface MarkdownRule {
  tagColor: string;
  weekIndex: number;
  discountPct: number;
  ageDays: number;
  isActive?: boolean;
}

/** A six-week rotation. Reasonable for most shops, and every part is editable. */
export const DEFAULT_MARKDOWN_RULES: readonly MarkdownRule[] = [
  { tagColor: "green", weekIndex: 0, discountPct: 0, ageDays: 0 },
  { tagColor: "yellow", weekIndex: 1, discountPct: 25, ageDays: 14 },
  { tagColor: "blue", weekIndex: 2, discountPct: 50, ageDays: 28 },
  { tagColor: "red", weekIndex: 3, discountPct: 75, ageDays: 42 },
  { tagColor: "white", weekIndex: 4, discountPct: 90, ageDays: 56 },
  { tagColor: "purple", weekIndex: 5, discountPct: 0, ageDays: 0 },
] as const;

export const TAG_COLOR_HEX: Record<string, string> = {
  green: "#2F855A",
  yellow: "#D69E2E",
  blue: "#2B6CB0",
  red: "#C53030",
  white: "#E2E8F0",
  purple: "#6B46C1",
  orange: "#DD6B20",
  pink: "#D53F8C",
};

/** Whole days between two dates, floored, never negative. */
export function daysBetween(from: string | Date, to: string | Date): number {
  const a = typeof from === "string" ? new Date(from + (from.length === 10 ? "T00:00:00Z" : "")) : from;
  const b = typeof to === "string" ? new Date(to + (to.length === 10 ? "T00:00:00Z" : "")) : to;
  const ms = b.getTime() - a.getTime();
  if (!Number.isFinite(ms)) return 0;
  return Math.max(0, Math.floor(ms / 86_400_000));
}

/**
 * Which tag color an item receives at intake, following the store's rotation.
 * Week 0 of the year gets the first color, and it cycles from there.
 */
export function tagColorForIntake(
  intakeDate: string | Date,
  rules: readonly MarkdownRule[] = DEFAULT_MARKDOWN_RULES
): string {
  const active = rules.filter((r) => r.isActive !== false);
  if (active.length === 0) return "green";
  const date = typeof intakeDate === "string" ? new Date(intakeDate + (intakeDate.length === 10 ? "T00:00:00Z" : "")) : intakeDate;
  if (Number.isNaN(date.getTime())) return active[0].tagColor;

  const startOfYear = Date.UTC(date.getUTCFullYear(), 0, 1);
  const week = Math.floor((date.getTime() - startOfYear) / (7 * 86_400_000));
  const ordered = [...active].sort((a, b) => a.weekIndex - b.weekIndex);
  return ordered[((week % ordered.length) + ordered.length) % ordered.length].tagColor;
}

/**
 * The discount an item has actually earned: it must both carry a discounted
 * color *and* be old enough. A blue tag stuck on this morning is still full price.
 */
export function currentDiscountPct(
  item: { tagColor: string | null; intakeDate: string },
  rules: readonly MarkdownRule[] = DEFAULT_MARKDOWN_RULES,
  now: Date = new Date()
): number {
  if (!item.tagColor) return 0;
  const rule = rules.find(
    (r) => r.tagColor === item.tagColor && r.isActive !== false
  );
  if (!rule || rule.discountPct <= 0) return 0;

  const age = daysBetween(item.intakeDate, now);
  if (age < rule.ageDays) return 0;

  return clampPct(rule.discountPct);
}

function clampPct(pct: number): number {
  if (!Number.isFinite(pct)) return 0;
  return Math.min(100, Math.max(0, Math.round(pct)));
}

/**
 * The price a shopper pays today, in integer cents. Rounding is half-up on the
 * discount so the store never accidentally charges a fraction of a cent.
 */
export function effectivePriceCents(
  item: { priceCents: number; tagColor: string | null; intakeDate: string },
  rules: readonly MarkdownRule[] = DEFAULT_MARKDOWN_RULES,
  now: Date = new Date()
): number {
  const base = Math.max(0, Math.round(item.priceCents));
  const pct = currentDiscountPct(item, rules, now);
  if (pct === 0) return base;
  const discount = Math.round((base * pct) / 100);
  return Math.max(0, base - discount);
}

/** What the shopper saved off the tag — the number that powers value-delivered. */
export function markdownCents(
  item: { priceCents: number; tagColor: string | null; intakeDate: string },
  rules: readonly MarkdownRule[] = DEFAULT_MARKDOWN_RULES,
  now: Date = new Date()
): number {
  return Math.max(0, Math.round(item.priceCents)) - effectivePriceCents(item, rules, now);
}

/** The next step down, so staff can answer "when does this drop?" honestly. */
export function nextMarkdown(
  item: { tagColor: string | null; intakeDate: string },
  rules: readonly MarkdownRule[] = DEFAULT_MARKDOWN_RULES,
  now: Date = new Date()
): { inDays: number; toPct: number } | null {
  if (!item.tagColor) return null;
  const rule = rules.find((r) => r.tagColor === item.tagColor && r.isActive !== false);
  if (!rule || rule.discountPct <= 0) return null;

  const age = daysBetween(item.intakeDate, now);
  if (age >= rule.ageDays) return null; // already there

  return { inDays: rule.ageDays - age, toPct: clampPct(rule.discountPct) };
}
