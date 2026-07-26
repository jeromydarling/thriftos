import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  canAdvance,
  pickupCode,
  FULFILMENT_FLOW,
  HOLD_MINUTES,
  SESSION_MINUTES,
  type FulfilmentStatus,
} from "./orders";

describe("pickup codes", () => {
  const codes = Array.from({ length: 400 }, () => pickupCode());

  it("cannot be misread across a counter", () => {
    // No 0/O and no 1/I: the two pairs people misread and mis-say. Reading a
    // code off a phone screen to a volunteer is the whole job of this string.
    for (const code of codes) expect(code).toMatch(/^[BCDFGHJKLMNPQRSTVWXYZ2-9]{6}$/);
  });

  it("cannot spell a word", () => {
    // No vowels. A code is read out in a shop full of strangers.
    for (const code of codes) expect(code).not.toMatch(/[AEIOU]/);
  });

  it("is not the same code twice", () => {
    // Not a uniqueness guarantee — that's the database's job — but a generator
    // returning duplicates in 400 draws would be broken.
    expect(new Set(codes).size).toBeGreaterThan(395);
  });
});

describe("the fulfilment state machine", () => {
  const all: FulfilmentStatus[] = [
    "awaiting",
    "picking",
    "ready",
    "dispatched",
    "collected",
    "unfindable",
    "refunded",
  ];

  it("describes every state in words a volunteer can act on", () => {
    for (const s of all) {
      expect(FULFILMENT_FLOW[s], s).toBeTruthy();
      expect(FULFILMENT_FLOW[s].length, s).toBeGreaterThan(10);
    }
  });

  it("walks the ordinary posted order", () => {
    expect(canAdvance("awaiting", "picking")).toBe(true);
    expect(canAdvance("picking", "ready")).toBe(true);
    expect(canAdvance("ready", "dispatched")).toBe(true);
  });

  it("walks the ordinary collected order", () => {
    expect(canAdvance("ready", "collected")).toBe(true);
  });

  it("will not skip picking to say something is with the customer", () => {
    // Telling a customer their order is ready when nobody has looked for it is
    // the failure this machine exists to prevent.
    expect(canAdvance("awaiting", "ready")).toBe(false);
    expect(canAdvance("awaiting", "collected")).toBe(false);
    expect(canAdvance("awaiting", "dispatched")).toBe(false);
  });

  it("lets a search be abandoned at any point before hand-over", () => {
    // One-of-a-kind stock goes missing: sold at the till, damaged, or walked.
    for (const from of ["awaiting", "picking", "ready"] as FulfilmentStatus[]) {
      expect(canAdvance(from, "unfindable"), from).toBe(true);
    }
  });

  it("lets a search resume, because things turn up", () => {
    expect(canAdvance("unfindable", "picking")).toBe(true);
    expect(canAdvance("picking", "awaiting")).toBe(true);
  });

  it("always allows a refund, and never allows anything after one", () => {
    // The customer's money is the one thing that must always be returnable.
    for (const from of all.filter((s) => s !== "refunded")) {
      expect(canAdvance(from, "refunded"), from).toBe(true);
    }
    for (const to of all) expect(canAdvance("refunded", to), to).toBe(false);
  });

  it("does not let a dispatched parcel become uncollected or unfindable", () => {
    // It's in the post. The only thing left that can happen is a refund.
    expect(canAdvance("dispatched", "unfindable")).toBe(false);
    expect(canAdvance("dispatched", "collected")).toBe(false);
    expect(canAdvance("collected", "dispatched")).toBe(false);
  });
});

describe("the rules that keep stock honest", () => {
  const src = readFileSync("app/lib/orders.ts", "utf8");

  it("holds stock for longer than Stripe's page stays payable", () => {
    // The upper bound here used to be a flat 30 minutes, chosen before
    // checkout was hosted. Stripe's session is payable for a minimum of thirty
    // minutes, so a hold shorter than that would lapse while a shopper is
    // still on the page — and their perfectly ordinary payment would arrive
    // for a coat already back on the rail.
    expect(HOLD_MINUTES).toBeGreaterThan(SESSION_MINUTES);
    // Still measured in minutes. An abandoned checkout must not keep a coat
    // off the rail all afternoon.
    expect(HOLD_MINUTES).toBeLessThanOrEqual(SESSION_MINUTES + 15);
  });

  it("prices from the database and never from the request", () => {
    // The one rule that must not rot. If a price ever arrives in a form body,
    // a shopper can set it.
    expect(src).not.toMatch(/form\.get\(["']price/);
    expect(src).not.toMatch(/priceCents:\s*Number\(.*(body|form|request)/);
  });

  it("recomputes the markdown rather than storing a price on the cart line", () => {
    // A cart left open across a tag rotation must show today's price — the
    // same one on the label on the rail.
    expect(src).toContain("effectivePriceCents");
    expect(src).not.toMatch(/INSERT INTO cart_items[^`]*price/);
  });

  it("charges tax on goods and not on postage", () => {
    expect(src).toMatch(/taxCentsFor\(subtotalCents/);
  });

  it("keeps an unavailable line rather than dropping it", () => {
    // A shopper whose item went must be told which one, not handed a quietly
    // shorter basket.
    expect(src).toContain("unavailable");
    expect(src).toMatch(/lines\.filter\(\(l\) => !l\.available\)/);
  });

  it("shows an enhanced photograph only once a person has kept it", () => {
    // An unreviewed cut-out is a guess, and a guess about what a used item
    // looks like is not something to publish.
    expect(src).toMatch(/photo_enhanced_at \? /);
  });
});
