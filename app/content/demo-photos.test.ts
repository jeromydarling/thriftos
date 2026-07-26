import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DEMO_BEFORE_AFTER,
  DEMO_PHOTOS,
  DEMO_PHOTO_SIZE,
  SNAPSHOT_STYLE,
  demoAssetPath,
  demoMediaKey,
  snapshotPrompt,
} from "./demo-photos";
import { HELP_ARTICLES, getArticle } from "./help";

/**
 * The demo shop's photographs are the input to the cleanup, not a showcase of
 * it. Most of what's pinned here is that they stay deliberately bad, and that
 * the "after" shown to a customer is computed rather than kept.
 */
describe("the demo shop's photographs", () => {
  it("has a unique, URL-safe id for every photograph", () => {
    const ids = DEMO_PHOTOS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9-]+$/);
  });

  it("asks for the faults the cleanup actually fixes", () => {
    // Every one of these is something segment/trim/pad demonstrably deals
    // with. A "before" whose problem the product can't solve is a demo that
    // sets up a disappointment.
    for (const fault of ["cluttered", "shadow", "crooked", "amateur"]) {
      expect(SNAPSHOT_STYLE, fault).toContain(fault);
    }
  });

  it("does not ask for faults the cleanup can't fix", () => {
    // No sharpening and no denoising happen anywhere in the chain, so a blurry
    // or grainy "before" would promise an "after" that never arrives.
    expect(SNAPSHOT_STYLE).not.toMatch(/blur|out of focus|grain|noisy/i);
  });

  it("keeps the two standing rules of every generated image", () => {
    expect(SNAPSHOT_STYLE).toContain("no people");
    expect(SNAPSHOT_STYLE).toContain("no logos");
  });

  it("puts the faults on every prompt without losing the subject", () => {
    for (const photo of DEMO_PHOTOS) {
      const prompt = snapshotPrompt(photo);
      expect(prompt.startsWith(photo.prompt), photo.id).toBe(true);
      expect(prompt, photo.id).toContain(SNAPSHOT_STYLE);
    }
  });

  it("is square, because that's what the cleanup targets", () => {
    expect(DEMO_PHOTO_SIZE).toBeGreaterThanOrEqual(1024);
  });

  it("describes what is actually in the frame", () => {
    // The title goes on the listing and the alt text goes to a screen reader.
    // Both have to match the prompt, or the demo is lying in a small way.
    for (const photo of DEMO_PHOTOS) {
      const prompt = photo.prompt.toLowerCase();
      // Singular/plural and "mug set" vs "mugs" make an exact match too
      // brittle to be useful, so this asks that most of the title turns up
      // rather than all of it. It still catches a photograph paired with the
      // wrong description, which is the failure that matters.
      const words = photo.title
        .toLowerCase()
        .split(" ")
        .filter((w) => w.length >= 4);
      const present = words.filter((w) => prompt.includes(w.replace(/s$/, "")));
      expect(present.length, `${photo.id}: ${words.join(", ")}`).toBeGreaterThanOrEqual(
        Math.ceil(words.length / 2)
      );
      expect(photo.alt.length, photo.id).toBeGreaterThan(20);
    }
  });

  it("prices things like the rest of the demo prices them", () => {
    // A window item at ten times the shop's own band would read as a mistake.
    const BANDS: Record<string, [number, number]> = {
      Outerwear: [800, 2400],
      Tops: [300, 900],
      Housewares: [400, 1800],
      Books: [100, 400],
      Furniture: [2500, 8500],
      "Toys & Games": [200, 700],
    };
    for (const photo of DEMO_PHOTOS) {
      const [low, high] = BANDS[photo.category];
      expect(photo.priceCents, `${photo.id} price`).toBeGreaterThanOrEqual(low);
      expect(photo.priceCents, `${photo.id} price`).toBeLessThanOrEqual(high);
      // Second-hand is worth less than new, always.
      expect(photo.retailCents, `${photo.id} retail`).toBeGreaterThan(photo.priceCents);
    }
  });

  it("uses colours the demo shop already knows about", () => {
    const COLORS = ["navy", "cream", "forest green", "rust", "charcoal", "burgundy", "mustard"];
    for (const photo of DEMO_PHOTOS) {
      expect(COLORS, photo.id).toContain(photo.color);
    }
  });

  it("fills the shop window", () => {
    // The storefront shows twelve. Fewer and the window has gaps in it.
    expect(DEMO_PHOTOS.length).toBeGreaterThanOrEqual(12);
  });

  it("keeps the R2 key clear of the bundled path", () => {
    // Two different namespaces on purpose: one is a file in the client bundle,
    // the other is an object in a bucket, and confusing them is how a seed
    // starts writing over something.
    expect(demoAssetPath("x")).toBe("img/demo/x.jpg");
    expect(demoMediaKey("x")).toBe("photos/demo/x.jpg");
    expect(demoMediaKey("x")).not.toBe(demoAssetPath("x"));
  });
});

describe("the before-and-after in the help centre", () => {
  const article = getArticle("product-photographs")!;
  const section = article.sections.find((s) => s.comparison);

  it("shows one", () => {
    expect(section?.comparison).toBeDefined();
  });

  it("uses a real demo photograph as the before", () => {
    expect(section!.comparison!.before.src).toBe(`/${demoAssetPath(DEMO_BEFORE_AFTER)}`);
    expect(DEMO_PHOTOS.some((p) => p.id === DEMO_BEFORE_AFTER)).toBe(true);
  });

  it("computes the after rather than keeping one", () => {
    // The whole claim of this section is that the picture on the right is what
    // the product does, right now. A committed screenshot could go on
    // promising something the transformation had stopped doing.
    const after = section!.comparison!.after.src;
    expect(after).toContain("/api/demo/tidied/");
    expect(after).toContain(DEMO_BEFORE_AFTER);
    expect(after).not.toMatch(/^\/img\//);
  });

  it("says the after is computed, where somebody will read it", () => {
    expect(section!.comparison!.note ?? "").toMatch(/when you load this page|not a screenshot/i);
  });

  it("only ever points a comparison at something this app serves", () => {
    for (const a of HELP_ARTICLES) {
      for (const s of a.sections) {
        if (!s.comparison) continue;
        for (const shot of [s.comparison.before, s.comparison.after]) {
          expect(shot.src, `${a.slug}`).toMatch(/^\/(img|api)\//);
          expect(shot.alt.length, `${a.slug}`).toBeGreaterThan(20);
        }
      }
    }
  });
});

describe("what the demo shop ends up looking like", () => {
  const stock = readFileSync("app/lib/demo-stock.ts", "utf8");

  it("tidies some of the window but not all of it", () => {
    // All tidied and the photo bench has no work in it; none tidied and the
    // shop window is a page of carpets. Half shows both.
    expect(stock).toMatch(/DEMO_PHOTOS\.slice\(0, Math\.floor\(DEMO_PHOTOS\.length \/ 2\)\)/);
  });

  it("tidies by running the real thing", () => {
    // Not a second implementation and not a pre-drawn file: the demo must not
    // be able to show a result the product doesn't produce.
    expect(stock).toContain("enhanceItemPhoto");
    expect(stock).not.toMatch(/AI\.run|flux/i);
  });

  it("gives an item a photo key only when the bytes are there", () => {
    expect(stock).toMatch(/present\.has\(photo\.id\) \? demoMediaKey\(photo\.id\) : null/);
  });

  it("copies photographs before it writes the rows that point at them", () => {
    const seed = readFileSync("app/lib/seed.ts", "utf8");
    expect(seed.indexOf("copyDemoPhotos")).toBeLessThan(seed.indexOf("demoWindowStatements("));
  });
});
