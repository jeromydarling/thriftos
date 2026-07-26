import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Layout stability on the marketing page.
 *
 * The reported symptom was the page bouncing while being scrolled. Three
 * separate causes: a typewriter whose phrases are different lengths reflowed
 * the heading it sits in; the showcase swapped between demos and copy of
 * different heights; and frames whose contents animate in grew as they went.
 *
 * Measured before and after with a headless browser — 445px of movement at
 * 360px wide, then none at any width. These are source-level guards so the
 * technique doesn't get quietly undone; the browser measurement is the real
 * check and lives in the commit message rather than in CI.
 */
describe("nothing on the homepage resizes itself", () => {
  const motion = readFileSync("app/components/motion.tsx", "utf8");
  const frame = readFileSync("app/components/BrowserFrame.tsx", "utf8");
  const home = readFileSync("app/routes/home.tsx", "utf8");

  it("the typewriter holds a box the size of its longest phrase", () => {
    expect(motion).toMatch(/const longest = phrases\.reduce/);
    // Both in one grid cell is what makes the box the size of the longest.
    expect(motion).toContain("col-start-1 row-start-1");
  });

  it("the typewriter announces a whole phrase, not a half-typed one", () => {
    expect(motion).toContain("sr-only");
    expect(motion).toMatch(/aria-hidden="true"[\s\S]{0,200}\{text\}/);
  });

  it("the showcase stacks every demo rather than swapping one in", () => {
    // A fixed pixel floor was wrong (these wrap on a phone) and growing to the
    // tallest seen was wrong (it only settles after a full cycle).
    expect(home).toMatch(/DEMOS\.map\([\s\S]{0,400}col-start-1 row-start-1/);
    expect(home).not.toMatch(/minContent=\{\d+\}/);
  });

  it("frames whose contents animate in reserve their height", () => {
    expect(frame).toContain("ResizeObserver");
    // Grow-only, or it oscillates instead of settling.
    expect(frame).toMatch(/height > current \? height : current/);
    expect(home).toMatch(/<BrowserFrame[^>]*reserve/);
  });

  it("does not key the frame on the demo, which would remount it", () => {
    // Keying the frame threw away the height it had measured on every switch.
    expect(home).not.toMatch(/key=\{`\$\{demo\.id\}-frame`\}/);
  });
});
