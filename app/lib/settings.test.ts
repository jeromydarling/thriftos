import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  parseOrgSettings,
  serialiseOrgSettings,
  taxCentsFor,
} from "./settings";

describe("settings round-trip", () => {
  it("reads back exactly what it wrote", () => {
    // The regression this file exists for: the writer and the readers used
    // different key names, so a 7% tax rate was saved and read as zero by the
    // card pricer. A round-trip test catches that class of bug permanently.
    const written = serialiseOrgSettings({
      taxRateBps: 700,
      roundUpEnabled: false,
      roundUpCause: "the food pantry",
      openingHours: "Tue–Sat 10–5",
      donationHours: "Tue–Fri until 4",
      accepted: "Clothing\nBooks",
      notAccepted: "Mattresses",
    });

    expect(parseOrgSettings(written)).toEqual({
      taxRateBps: 700,
      roundUpEnabled: false,
      openingHours: "Tue–Sat 10–5",
      donationHours: "Tue–Fri until 4",
      accepted: "Clothing\nBooks",
      notAccepted: "Mattresses",
      roundUpCause: "the food pantry",
    });
  });

  it("stores tax under the key the pricer reads", () => {
    // Belt and braces: assert the wire format itself, so a rename that updates
    // both sides of the round-trip still trips this.
    const json = serialiseOrgSettings({ ...DEFAULT_SETTINGS, taxRateBps: 700 });
    expect(JSON.parse(json)).toHaveProperty("taxRateBps", 700);
  });
});

describe("parseOrgSettings", () => {
  it("defaults an empty shop rather than returning undefined", () => {
    expect(parseOrgSettings("{}")).toEqual(DEFAULT_SETTINGS);
    expect(parseOrgSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseOrgSettings(undefined)).toEqual(DEFAULT_SETTINGS);
  });

  it("survives corrupt JSON", () => {
    expect(parseOrgSettings("{not json")).toEqual(DEFAULT_SETTINGS);
    expect(parseOrgSettings("[1,2,3]")).toEqual(DEFAULT_SETTINGS);
  });

  it("defaults round-up to on, since that's what a new shop expects", () => {
    expect(parseOrgSettings('{"taxRateBps":100}').roundUpEnabled).toBe(true);
  });

  it("treats only an explicit false as off", () => {
    expect(parseOrgSettings('{"roundUpEnabled":false}').roundUpEnabled).toBe(false);
    expect(parseOrgSettings('{"roundUpEnabled":null}').roundUpEnabled).toBe(true);
  });

  it("ignores a nonsense tax rate rather than charging it", () => {
    expect(parseOrgSettings('{"taxRateBps":"abc"}').taxRateBps).toBe(0);
    expect(parseOrgSettings('{"taxRateBps":-500}').taxRateBps).toBe(0);
    // 200% tax is a typo, and charging it would be worse than ignoring it.
    expect(parseOrgSettings('{"taxRateBps":20000}').taxRateBps).toBe(10_000);
  });

  it("falls back to a named cause rather than an empty label", () => {
    expect(parseOrgSettings('{"roundUpCause":"   "}').roundUpCause).toBe(
      DEFAULT_SETTINGS.roundUpCause
    );
  });
});

describe("taxCentsFor", () => {
  it("applies the rate in basis points", () => {
    expect(taxCentsFor(2000, { ...DEFAULT_SETTINGS, taxRateBps: 700 })).toBe(140);
  });

  it("rounds to the nearest cent", () => {
    // 7% of $10.07 is 70.49¢.
    expect(taxCentsFor(1007, { ...DEFAULT_SETTINGS, taxRateBps: 700 })).toBe(70);
    // 7% of $10.10 is 70.7¢.
    expect(taxCentsFor(1010, { ...DEFAULT_SETTINGS, taxRateBps: 700 })).toBe(71);
  });

  it("charges nothing when the sale is exempt", () => {
    expect(taxCentsFor(2000, { ...DEFAULT_SETTINGS, taxRateBps: 700 }, true)).toBe(0);
  });

  it("charges nothing when no rate is configured", () => {
    expect(taxCentsFor(2000, DEFAULT_SETTINGS)).toBe(0);
  });

  it("never returns negative tax on a negative subtotal", () => {
    expect(taxCentsFor(-500, { ...DEFAULT_SETTINGS, taxRateBps: 700 })).toBe(0);
  });
});

describe("the website fields", () => {
  it("defaults to empty rather than to invented opening hours", () => {
    // A shop's public page shows nothing for these until somebody fills them
    // in. Printed hours that are wrong are worse than no hours at all.
    const s = parseOrgSettings("{}");
    expect(s.openingHours).toBe("");
    expect(s.accepted).toBe("");
    expect(s.notAccepted).toBe("");
  });

  it("keeps the line breaks, because they are the format", () => {
    const s = parseOrgSettings(JSON.stringify({ accepted: "Clothing\nBooks\nKitchenware" }));
    expect(s.accepted.split("\n")).toEqual(["Clothing", "Books", "Kitchenware"]);
  });

  it("caps a paste rather than letting it become the whole page", () => {
    const s = parseOrgSettings(JSON.stringify({ openingHours: "x".repeat(5000) }));
    expect(s.openingHours.length).toBeLessThanOrEqual(600);
  });

  it("ignores a value of the wrong type instead of rendering it", () => {
    const s = parseOrgSettings(JSON.stringify({ accepted: ["Clothing"], openingHours: 42 }));
    expect(s.accepted).toBe("");
    expect(s.openingHours).toBe("");
  });
});
