import { describe, expect, it } from "vitest";
import {
  auditBrand,
  checkContrast,
  colour,
  contrast,
  DEFAULT_BRAND,
  initialsFor,
  parseBrandKit,
  readableAgainst,
  renderPalette,
  serialiseBrandKit,
  TYPEFACES,
  VOICES,
} from "./brand";

describe("colour parsing", () => {
  it("expands three-digit hex", () => {
    expect(colour("#abc", "#000000")).toBe("#aabbcc");
  });

  it("lowercases and keeps six-digit hex", () => {
    expect(colour("#2F6F5E", "#000000")).toBe("#2f6f5e");
  });

  it("falls back on anything that isn't a colour", () => {
    expect(colour("rebeccapurple", "#123456")).toBe("#123456");
    expect(colour("#12345", "#123456")).toBe("#123456");
    expect(colour(42, "#123456")).toBe("#123456");
    expect(colour(null, "#123456")).toBe("#123456");
  });
});

describe("the kit round-trips", () => {
  it("reads back exactly what it wrote", () => {
    const kit = {
      ...DEFAULT_BRAND,
      primary: "#123456",
      accent: "#abcdef",
      typeface: "bold" as const,
      voice: "quiet" as const,
      tagline: "Second-hand, first-rate",
      boilerplate: "Open Tuesday to Saturday",
    };
    expect(parseBrandKit(serialiseBrandKit(kit))).toEqual(kit);
  });

  it("defaults an empty or corrupt kit rather than rendering nothing", () => {
    expect(parseBrandKit("{}")).toEqual(DEFAULT_BRAND);
    expect(parseBrandKit(null)).toEqual(DEFAULT_BRAND);
    expect(parseBrandKit("{not json")).toEqual(DEFAULT_BRAND);
  });

  it("rejects a typeface or voice we don't ship", () => {
    const kit = parseBrandKit('{"typeface":"comic","voice":"aggressive"}');
    expect(TYPEFACES.some((t) => t.id === kit.typeface)).toBe(true);
    expect(VOICES.some((v) => v.id === kit.voice)).toBe(true);
  });

  it("caps a tagline rather than letting it break every asset", () => {
    const kit = parseBrandKit(JSON.stringify({ tagline: "x".repeat(500) }));
    expect(kit.tagline.length).toBeLessThanOrEqual(120);
  });
});

describe("contrast", () => {
  it("gives the known extremes", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 1);
    expect(contrast("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
  });

  it("is symmetric — order of arguments doesn't matter", () => {
    expect(contrast("#2f6f5e", "#faf7f2")).toBeCloseTo(contrast("#faf7f2", "#2f6f5e"), 10);
  });

  it("calls a genuinely unreadable pair a failure", () => {
    // Pale yellow on cream: a real choice a shop makes, and unreadable.
    const check = checkContrast("#f5e6a8", "#faf7f2");
    expect(check.verdict).toBe("fails");
    expect(check.advice).toMatch(/hard to read/);
  });

  it("allows a mid pair for headlines only", () => {
    const check = checkContrast("#767676", "#ffffff");
    expect(["large-only", "passes"]).toContain(check.verdict);
  });

  it("explains itself without using the word WCAG", () => {
    for (const hex of ["#000000", "#888888", "#eeeeee"]) {
      expect(checkContrast(hex, "#ffffff").advice).not.toMatch(/wcag|ratio|4\.5/i);
    }
  });
});

describe("readableAgainst", () => {
  it("leaves an already-readable colour alone", () => {
    expect(readableAgainst("#2f6f5e", "#ffffff")).toBe("#2f6f5e");
  });

  it("darkens a pale colour until it can be read on a light page", () => {
    const fixed = readableAgainst("#f5e6a8", "#faf7f2");
    expect(contrast(fixed, "#faf7f2")).toBeGreaterThanOrEqual(4.5);
  });

  it("lightens a dark colour on a dark page", () => {
    const fixed = readableAgainst("#1a1a1a", "#000000");
    expect(contrast(fixed, "#000000")).toBeGreaterThanOrEqual(4.5);
  });

  it("always reaches the target rather than giving up silently", () => {
    for (const hex of ["#ffffff", "#000000", "#7f7f7f", "#ff00ff", "#00ffff"]) {
      for (const bg of ["#ffffff", "#000000", "#faf7f2", "#2f6f5e"]) {
        expect(contrast(readableAgainst(hex, bg), bg), `${hex} on ${bg}`).toBeGreaterThanOrEqual(
          4.4
        );
      }
    }
  });
});

describe("renderPalette", () => {
  it("picks legible text for a coloured block", () => {
    const dark = renderPalette({ ...DEFAULT_BRAND, primary: "#1a3a2e" });
    expect(dark.onPrimary).toBe("#ffffff");

    const pale = renderPalette({ ...DEFAULT_BRAND, primary: "#f5e6a8" });
    expect(pale.onPrimary).toBe("#000000");
  });

  it("corrects a heading colour that would be unreadable", () => {
    const kit = { ...DEFAULT_BRAND, primary: "#f5e6a8", surface: "#faf7f2" };
    const palette = renderPalette(kit);
    expect(contrast(palette.headingText, kit.surface)).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps the shop's own colours when they're already fine", () => {
    const palette = renderPalette(DEFAULT_BRAND);
    expect(palette.headingText).toBe(DEFAULT_BRAND.primary);
    expect(palette.bodyText).toBe(DEFAULT_BRAND.ink);
  });
});

describe("auditBrand", () => {
  it("checks every pair a shop can get wrong", () => {
    const audit = auditBrand(DEFAULT_BRAND);
    expect(audit.length).toBeGreaterThanOrEqual(5);
    for (const row of audit) {
      expect(row.label.length).toBeGreaterThan(0);
      expect(row.check.advice.length).toBeGreaterThan(0);
    }
  });

  it("passes the shipped defaults — we shouldn't ship a failing palette", () => {
    const body = auditBrand(DEFAULT_BRAND).find((r) => r.label.includes("Body text"));
    expect(body?.check.verdict === "passes" || body?.check.verdict === "excellent").toBe(true);
  });
});

describe("initialsFor", () => {
  it("takes the initials of the words that matter", () => {
    expect(initialsFor("Second Chances Thrift")).toBe("SCT");
    expect(initialsFor("The Thrift Shop of Mill Road")).toBe("TSM");
  });

  it("uses two letters for a one-word name", () => {
    expect(initialsFor("Rummage")).toBe("RU");
  });

  it("copes with punctuation and never returns nothing", () => {
    expect(initialsFor("St. Mary's Op-Shop").length).toBeGreaterThan(0);
    expect(initialsFor("!!!").length).toBeGreaterThan(0);
    expect(initialsFor("").length).toBeGreaterThan(0);
  });
});
