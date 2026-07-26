import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_ENHANCE,
  ENHANCE_EXPLAINER,
  ENHANCE_OUTPUT,
  ENHANCED_NOTE,
  enhanceTransform,
  enhancedKeyFor,
  enhancedSize,
  seamlessFor,
} from "./photos";
import { luminance } from "./brand";

describe("the rule: enhance the photograph, never the item", () => {
  const src = readFileSync("app/lib/photos.ts", "utf8");
  const work = readFileSync("app/lib/enhance.ts", "utf8");
  const api = readFileSync("app/api/index.ts", "utf8");
  const screen = readFileSync("app/routes/app.photos.tsx", "utf8");

  it("uses only deterministic transformations on the item", () => {
    // `segment` isolates real pixels; `trim` crops to them; `background` puts a
    // colour behind them. None can invent a garment that isn't there. A
    // generative model could, which is why none is used on the item.
    const chain = enhanceTransform({ background: "#ffffff" });
    expect(chain.segment).toBe("foreground");
    expect(Object.keys(chain)).not.toContain("prompt");
    expect(src).not.toMatch(/AI\.run|flux|stable-diffusion|inpaint/i);
  });

  it("never asks a model to touch the item, where the work is done either", () => {
    expect(work).not.toMatch(/AI\.run|prompt/i);
    expect(work).toContain("enhanceTransform");
  });

  it("has one implementation, so the screen and the API can't drift", () => {
    // Two copies of "which key, which column, which flag" is the drift that
    // has bitten this codebase before. Both callers go through the library.
    for (const caller of [api, screen]) {
      expect(caller).toMatch(/enhanceItemPhoto/);
      expect(caller).toMatch(/decideEnhancedPhoto/);
      expect(caller).not.toMatch(/photo_enhanced_key = \?/);
    }
  });

  it("writes a second object and never overwrites the original", () => {
    expect(enhancedKeyFor("photos/abc.jpg")).toBe("enhanced/photos/abc.jpg");
    expect(enhancedKeyFor("photos/abc.jpg")).not.toBe("photos/abc.jpg");

    // The put target is the derived key, never the original's.
    expect(work).toMatch(/MEDIA\.put\(key/);
    expect(work).not.toMatch(/MEDIA\.put\(item\.photo_key/);
  });

  it("does not mark a fresh cut-out as reviewed", () => {
    // An unreviewed cut-out is a guess, and a guess about what a used item
    // looks like is not something to publish.
    expect(work).toMatch(/photo_enhanced_at = NULL/);
  });

  it("clears the column before deleting the object it points at", () => {
    // The other order leaves a listing pointing at a key that isn't there if
    // the update fails.
    const clears = work.indexOf("photo_enhanced_key = NULL");
    const deletes = work.indexOf("MEDIA.delete");
    expect(clears).toBeGreaterThan(-1);
    expect(deletes).toBeGreaterThan(clears);
  });

  it("shows the reviewed cut-out in the grid, not just on the item page", () => {
    // A grid of mixed backgrounds is the thing the tidy-up exists to fix.
    const storefront = readFileSync("app/lib/storefront.ts", "utf8");
    expect(storefront).toMatch(/photo_enhanced_at IS NOT NULL/);
  });

  it("says what it does and doesn't do, where a shop will ask", () => {
    const explainer = ENHANCE_EXPLAINER.join(" ").toLowerCase();
    expect(explainer).toMatch(/don't change the item|no removing marks/);
    expect(explainer).toMatch(/original/);
    expect(ENHANCED_NOTE).toMatch(/exactly as it came in/i);
  });
});

describe("the transformation chain", () => {
  it("trims to the subject before placing it, so a grid is even", () => {
    // A jumper shot from six feet and a mug shot from six inches have to come
    // out the same size, or the page looks like a car boot sale.
    const keys = Object.keys(enhanceTransform({ background: "#fff" }));
    expect(keys.indexOf("segment")).toBeLessThan(keys.indexOf("trim"));
    expect(keys.indexOf("trim")).toBeLessThan(keys.indexOf("fit"));
  });

  it("pads rather than covers or contains, so the grid is truly even", () => {
    // `cover` on a square is how a sleeve silently leaves the photograph.
    // `contain` keeps the whole item but returns a short picture for a wide
    // one, which leaves the grid as ragged as it was before.
    expect(enhanceTransform({ background: "#fff" }).fit).toBe("pad");
  });

  it("leaves the subject room to breathe, in the option Cloudflare has", () => {
    // There is no `padding` transformation. An option Cloudflare doesn't know
    // is ignored, not refused — which is how every cut-out came out with the
    // garment jammed against the frame and nothing said so.
    const t = enhanceTransform({ background: "#fff", size: 1000, padding: 0.1 });
    expect(t.width).toBe(800);
    expect(t.border).toEqual({ color: "#fff", width: 100 });
    expect(Object.keys(t)).not.toContain("padding");
  });

  it("lands on the size asked for once the border is on", () => {
    // Borders are applied after the resize, so inner + two borders has to come
    // back to `size` or a grid of these is uneven.
    for (const size of [800, 1000, 1200]) {
      expect(enhancedSize({ background: "#fff", size })).toBe(size);
    }
  });

  it("keeps the border the same colour as the seamless", () => {
    // Any other colour and it reads as a frame around the item rather than
    // space around it.
    const t = enhanceTransform({ background: "#f6f4f0" });
    expect(t.border.color).toBe(t.background);
  });

  it("encodes quality and format where they're actually read", () => {
    // `quality` and `format` passed to .transform() are silently dropped.
    const t = enhanceTransform({ background: "#fff" });
    expect(Object.keys(t)).not.toContain("quality");
    expect(Object.keys(t)).not.toContain("format");
    expect(ENHANCE_OUTPUT.format).toBe("image/webp");
    expect(readFileSync("app/lib/enhance.ts", "utf8")).toContain(".output(ENHANCE_OUTPUT)");
  });

  it("has sane defaults", () => {
    expect(DEFAULT_ENHANCE.size).toBeGreaterThanOrEqual(1000);
    expect(DEFAULT_ENHANCE.padding).toBeGreaterThan(0);
    expect(DEFAULT_ENHANCE.padding).toBeLessThan(0.2);
  });
});

describe("choosing the seamless", () => {
  it("uses a light brand surface as-is", () => {
    expect(seamlessFor("#f6f4f0", luminance)).toBe("#f6f4f0");
    expect(seamlessFor("#ffffff", luminance)).toBe("#ffffff");
  });

  it("refuses a dark one", () => {
    // A black coat on a black seamless is a photograph of nothing.
    expect(seamlessFor("#000000", luminance)).toBe("#f6f4f0");
    expect(seamlessFor("#2f2a26", luminance)).toBe("#f6f4f0");
  });

  it("falls back rather than trusting a malformed colour", () => {
    for (const bad of ["", "white", "#fff", "#12345g", "rgb(1,2,3)"]) {
      expect(seamlessFor(bad, luminance), bad).toBe("#f6f4f0");
    }
  });
});
