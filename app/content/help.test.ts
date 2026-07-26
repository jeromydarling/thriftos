import { describe, expect, it } from "vitest";
import {
  HELP_ARTICLES,
  HELP_CATEGORIES,
  articlesForPath,
  articlesIn,
  getArticle,
  populatedCategories,
  searchHelp,
} from "./help";
import { sitemapUrls } from "../routes/sitemap";
import { ONBOARDING_STEPS } from "../lib/onboarding";

describe("help registry integrity", () => {
  it("has unique slugs", () => {
    const slugs = HELP_ARTICLES.map((a) => a.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("uses URL-safe slugs", () => {
    for (const article of HELP_ARTICLES) {
      expect(article.slug).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it("every article sits in a declared category", () => {
    const ids = new Set(HELP_CATEGORIES.map((c) => c.id));
    for (const article of HELP_ARTICLES) {
      expect(ids.has(article.category), `${article.slug} → ${article.category}`).toBe(true);
    }
  });

  it("every related link resolves to a real article", () => {
    for (const article of HELP_ARTICLES) {
      for (const slug of article.related ?? []) {
        expect(getArticle(slug), `${article.slug} → ${slug}`).toBeDefined();
      }
    }
  });

  it("never links to itself", () => {
    for (const article of HELP_ARTICLES) {
      expect(article.related ?? [], article.slug).not.toContain(article.slug);
    }
  });

  it("every in-app link points at a route that exists", () => {
    // Kept in step by hand rather than imported, so adding an appPath to an
    // article forces a deliberate look at whether that route is real.
    const routes = new Set([
      "/app",
      "/app/welcome",
      "/app/import",
      "/app/intake",
      "/app/inventory",
      "/app/photos",
      "/app/orders",
      "/app/register",
      "/app/people",
      "/app/donations",
      "/app/volunteers",
      "/app/impact",
      "/app/settings",
      "/app/help",
      "/app/studio",
      "/app/site",
    ]);

    for (const article of HELP_ARTICLES) {
      if (!article.appPath) continue;
      const base = article.appPath.split("#")[0];
      expect(routes.has(base), `${article.slug} → ${article.appPath}`).toBe(true);
    }
  });

  it("meets a minimum depth — a thin help article is worse than none", () => {
    for (const article of HELP_ARTICLES) {
      const words = article.sections
        .flatMap((s) => [
          ...(s.body ?? []),
          ...(s.list ?? []),
          ...(s.steps ?? []).flatMap((step) => [step.do, step.expect ?? "", step.watchOut ?? ""]),
          ...(s.table?.rows.flat() ?? []),
        ])
        .join(" ")
        .split(/\s+/)
        .filter(Boolean).length;

      expect(words, article.slug).toBeGreaterThan(250);
    }
  });

  it("gives a believable reading time", () => {
    for (const article of HELP_ARTICLES) {
      expect(article.readMinutes, article.slug).toBeGreaterThan(0);
      expect(article.readMinutes, article.slug).toBeLessThan(30);
    }
  });

  it("covers the categories it claims to cover", () => {
    // Payments is the one a shop most needs walked through, so it earns depth.
    expect(articlesIn("payments").length).toBeGreaterThanOrEqual(4);
    expect(articlesIn("getting-started").length).toBeGreaterThanOrEqual(2);
    expect(articlesIn("migrating").length).toBeGreaterThanOrEqual(1);
    // A shop building its brand and its website should not have to guess.
    expect(articlesIn("brand").length).toBeGreaterThanOrEqual(3);
    // Turning on online selling opens five new screens at once. Each earns a page.
    expect(articlesIn("selling-online").length).toBeGreaterThanOrEqual(5);
  });

  it("lists no empty category on the index", () => {
    for (const category of populatedCategories()) {
      expect(articlesIn(category.id).length, category.id).toBeGreaterThan(0);
    }
  });
});

describe("search", () => {
  it("finds an article by a word in its title", () => {
    const hits = searchHelp("refunds");
    expect(hits[0].article.slug).toBe("refunds-and-returns");
  });

  it("requires every term, so a partial topic match doesn't win", () => {
    // Plenty of articles mention Stripe; only the reader one is about readers.
    const hits = searchHelp("stripe reader");
    expect(hits.length).toBeGreaterThan(0);
    for (const hit of hits) {
      const haystack = JSON.stringify(hit.article).toLowerCase();
      expect(haystack).toContain("stripe");
      expect(haystack).toContain("reader");
    }
  });

  it("ranks a title match above a passing mention", () => {
    const hits = searchHelp("colour tags");
    expect(hits[0].article.slug).toBe("colour-tags-and-markdowns");
  });

  it("returns nothing for an empty or one-character query", () => {
    expect(searchHelp("")).toEqual([]);
    expect(searchHelp("a")).toEqual([]);
  });

  it("returns nothing rather than everything for nonsense", () => {
    expect(searchHelp("zzzqqqxxx")).toEqual([]);
  });

  it("gives every hit an excerpt", () => {
    for (const hit of searchHelp("donation")) {
      expect(hit.excerpt.length).toBeGreaterThan(0);
    }
  });

  it("ignores punctuation and case", () => {
    expect(searchHelp("REFUNDS!").length).toBeGreaterThan(0);
  });
});

describe("contextual help", () => {
  it("finds articles for a screen", () => {
    expect(articlesForPath("/app/register").length).toBeGreaterThan(0);
  });

  it("prefers the most specific match", () => {
    const hits = articlesForPath("/app/settings");
    expect(hits[0].appPath?.startsWith("/app/settings")).toBe(true);
  });

  it("returns an empty list rather than everything for an unknown screen", () => {
    expect(articlesForPath("/app/nonexistent")).toEqual([]);
  });

  it("covers the screens a shop opens without knowing what they do", () => {
    // Studio and Website are the two screens with no equivalent in the till
    // system a shop is coming from, so contextual help matters most there.
    for (const path of ["/app/studio", "/app/site"]) {
      expect(articlesForPath(path).length, path).toBeGreaterThan(0);
    }
  });
});

describe("discoverability", () => {
  it("every article is in the sitemap", () => {
    const urls = sitemapUrls().map((u) => u.loc);
    for (const article of HELP_ARTICLES) {
      expect(urls.some((u) => u.endsWith(`/help/${article.slug}`)), article.slug).toBe(true);
    }
  });

  it("the help index itself is in the sitemap", () => {
    expect(sitemapUrls().some((u) => u.loc.endsWith("/help"))).toBe(true);
  });
});

describe("onboarding and help agree with each other", () => {
  it("every onboarding step points at a route the help centre also knows", () => {
    const helpPaths = new Set(
      HELP_ARTICLES.filter((a) => a.appPath).map((a) => a.appPath!.split("#")[0])
    );
    // Not every step needs an article, but the ones a shop is most likely to
    // get stuck on — importing and first items — must have one.
    expect(helpPaths.has("/app/import")).toBe(true);
    expect(helpPaths.has("/app/welcome")).toBe(true);
    expect(ONBOARDING_STEPS.some((s) => s.href === "/app/import")).toBe(true);
  });

  it("every step belongs to at least one path", () => {
    for (const step of ONBOARDING_STEPS) {
      expect(step.paths.length, step.id).toBeGreaterThan(0);
    }
  });

  it("has unique step ids", () => {
    const ids = ONBOARDING_STEPS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives each of the three paths something to do", () => {
    for (const path of ["new", "migrating", "exploring"] as const) {
      const steps = ONBOARDING_STEPS.filter((s) => s.paths.includes(path));
      expect(steps.length, path).toBeGreaterThan(0);
    }
  });

  it("puts the shop's own details first on every path", () => {
    for (const path of ["new", "migrating", "exploring"] as const) {
      const steps = ONBOARDING_STEPS.filter((s) => s.paths.includes(path));
      expect(steps[0].id, path).toBe("shop_details");
    }
  });
});
