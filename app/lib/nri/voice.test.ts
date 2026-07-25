import { describe, expect, it } from "vitest";
import { applyVoice, violatesPersonLanguage, DISCERNMENT, KIND_PRIORITY } from "./voice";

describe("authority reduction", () => {
  it("softens phrases that claim to know what things mean", () => {
    // Capitalisation follows the phrase being replaced, so match case-insensitively.
    expect(applyVoice("This proves the donor is gone.")).toMatch(/perhaps/i);
    expect(applyVoice("You must call them today.")).toMatch(/you might/i);
    expect(applyVoice("The truth is your intake is slowing.")).toMatch(/we begin to notice/i);
  });

  it("strips manufactured urgency", () => {
    const out = applyVoice("URGENT: contact them immediately.");
    expect(out.toLowerCase()).not.toContain("urgent");
    expect(out.toLowerCase()).not.toContain("immediately");
  });

  it("keeps the replacement's capitalisation in step", () => {
    expect(applyVoice("You should call.")).toMatch(/^You might/);
    expect(applyVoice("Perhaps you should call.")).toContain("you might");
  });

  it("is idempotent — signals are regenerated and must not drift", () => {
    const once = applyVoice("You must act immediately. This proves it.");
    expect(applyVoice(once)).toBe(once);
  });

  it("leaves ordinary sentences alone", () => {
    const plain = "Marta dropped things off again after a while away.";
    expect(applyVoice(plain)).toBe(plain);
  });

  it("collapses stray whitespace", () => {
    expect(applyVoice("  too    many   spaces  ")).toBe("too many spaces");
  });
});

describe("language about people", () => {
  it("flags vocabulary that treats a person as a metric", () => {
    expect(violatesPersonLanguage("This donor has lapsed.")).toBe(true);
    expect(violatesPersonLanguage("Churned supporters this quarter")).toBe(true);
    expect(violatesPersonLanguage("Tier one donors")).toBe(true);
    expect(violatesPersonLanguage("A low-value giver")).toBe(true);
  });

  it("permits ordinary, warm description", () => {
    expect(violatesPersonLanguage("Marta hasn't been by in a while.")).toBe(false);
    expect(violatesPersonLanguage("A familiar face has been away.")).toBe(false);
  });

  it("re-tests cleanly despite global regex flags", () => {
    // Global regexes carry lastIndex between calls; a stale one would make the
    // second identical check silently return false.
    const text = "This donor has lapsed.";
    expect(violatesPersonLanguage(text)).toBe(true);
    expect(violatesPersonLanguage(text)).toBe(true);
  });
});

describe("discernment settings", () => {
  it("keeps the Compass small enough to actually read", () => {
    expect(DISCERNMENT.maxOpenSignals).toBeLessThanOrEqual(8);
    expect(DISCERNMENT.maxPerRun).toBeLessThanOrEqual(10);
  });

  it("ranks celebrations above every nudge", () => {
    expect(KIND_PRIORITY.celebration).toBeLessThan(KIND_PRIORITY.check_in);
    expect(KIND_PRIORITY.celebration).toBeLessThan(KIND_PRIORITY.heads_up);
    expect(KIND_PRIORITY.connection).toBeLessThan(KIND_PRIORITY.heads_up);
  });
});
