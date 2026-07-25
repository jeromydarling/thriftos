import { describe, expect, it } from "vitest";
import { GUIDES, getGuide } from "./guides";
import { sitemapUrls, STATIC_ROUTES } from "../routes/sitemap";
import { SITE } from "../lib/seo";
import { NRI_FAQ } from "./nri";
import { PLANS, getPlan, usageCapCents } from "../lib/pricing";

describe("guide registry integrity", () => {
  it("has unique slugs", () => {
    const slugs = GUIDES.map((g) => g.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("uses URL-safe slugs", () => {
    for (const guide of GUIDES) {
      expect(guide.slug).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it("every related link resolves to a real guide", () => {
    for (const guide of GUIDES) {
      for (const slug of guide.related) {
        expect(getGuide(slug), `${guide.slug} → ${slug}`).toBeDefined();
      }
    }
  });

  it("never links to itself", () => {
    for (const guide of GUIDES) {
      expect(guide.related).not.toContain(guide.slug);
    }
  });

  it("meets a minimum depth — a thin guide helps nobody", () => {
    for (const guide of GUIDES) {
      const words = guide.blocks
        .flatMap((b) => [...b.paragraphs, ...(b.list ?? [])])
        .join(" ")
        .split(/\s+/).length;
      expect(words, guide.slug).toBeGreaterThan(250);
      expect(guide.faq.length, guide.slug).toBeGreaterThanOrEqual(2);
    }
  });

  it("has a description short enough to survive a search result", () => {
    for (const guide of GUIDES) {
      expect(guide.description.length, guide.slug).toBeLessThanOrEqual(200);
      expect(guide.description.length, guide.slug).toBeGreaterThan(50);
    }
  });

  it("uses a valid published date", () => {
    for (const guide of GUIDES) {
      expect(guide.published).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isNaN(new Date(guide.published).getTime())).toBe(false);
    }
  });
});

describe("sitemap", () => {
  it("lists every guide", () => {
    const urls = sitemapUrls().map((u) => u.loc);
    for (const guide of GUIDES) {
      expect(urls).toContain(`${SITE.url}/guides/${guide.slug}`);
    }
  });

  it("lists no duplicates", () => {
    const urls = sitemapUrls().map((u) => u.loc);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it("never advertises a private surface", () => {
    for (const route of STATIC_ROUTES) {
      expect(route.path).not.toMatch(/^\/(app|api|login|logout)/);
    }
  });

  it("uses absolute URLs on the canonical host", () => {
    for (const url of sitemapUrls()) {
      expect(url.loc.startsWith(SITE.url)).toBe(true);
    }
  });
});

describe("honesty of the comparison page", () => {
  const comparison = getGuide("thrift-store-software-comparison");

  it("exists and names real alternatives", () => {
    expect(comparison).toBeDefined();
    const text = JSON.stringify(comparison);
    expect(text).toMatch(/ThriftCart/);
    expect(text).toMatch(/ThriftTrac/);
  });

  it("says plainly where we are the weaker choice", () => {
    const text = JSON.stringify(comparison).toLowerCase();
    expect(text).toMatch(/weaker|better choice|are better/);
  });

  it("keeps its cap claim consistent with pricing.ts", () => {
    // If someone changes the Shop price, this claim must not silently rot.
    const text = JSON.stringify(comparison).toLowerCase();
    expect(text).toMatch(/caps at the flat plan's price|per-sale and caps/);
    expect(usageCapCents()).toBe(getPlan("shop").monthlyCents);
  });
});

describe("NRI claims stay true to the implementation", () => {
  it("states that signals are rules rather than model output", () => {
    const text = JSON.stringify(NRI_FAQ).toLowerCase();
    expect(text).toMatch(/deterministic rules/);
    expect(text).toMatch(/not by a model|never acts/);
  });

  it("promises no scoring of people", () => {
    const text = JSON.stringify(NRI_FAQ).toLowerCase();
    expect(text).toMatch(/no donor tiers/);
  });
});

describe("pricing content", () => {
  it("every plan has a name, blurb, and at least three features", () => {
    for (const plan of PLANS) {
      expect(plan.name.length).toBeGreaterThan(0);
      expect(plan.blurb.length).toBeGreaterThan(10);
      expect(plan.features.length).toBeGreaterThanOrEqual(3);
    }
  });
});
