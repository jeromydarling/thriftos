/**
 * The help centre registry, and its search.
 *
 * One place everything is assembled, so the category pages, the in-app help,
 * the sitemap, and llms.txt all read from the same source and cannot disagree.
 */
import { HELP_CATEGORIES, type HelpArticle, type HelpCategoryId } from "./types";
import { ONBOARDING_ARTICLES } from "./onboarding";
import { PAYMENTS_ARTICLES } from "./payments";
import { OPERATIONS_ARTICLES } from "./operations";
import { PEOPLE_ARTICLES } from "./people-and-reporting";
import { BRAND_ARTICLES } from "./brand-and-website";
import { ONLINE_ARTICLES } from "./selling-online";

export * from "./types";

export const HELP_ARTICLES: readonly HelpArticle[] = [
  ...ONBOARDING_ARTICLES,
  ...PAYMENTS_ARTICLES,
  ...OPERATIONS_ARTICLES,
  ...PEOPLE_ARTICLES,
  ...BRAND_ARTICLES,
  ...ONLINE_ARTICLES,
] as const;

export function getArticle(slug: string): HelpArticle | undefined {
  return HELP_ARTICLES.find((a) => a.slug === slug);
}

export function articlesIn(category: HelpCategoryId): HelpArticle[] {
  return HELP_ARTICLES.filter((a) => a.category === category);
}

/** Categories that actually have articles, in declared order. */
export function populatedCategories() {
  return HELP_CATEGORIES.filter((c) => articlesIn(c.id).length > 0);
}

/**
 * Articles relevant to a given app screen, for contextual in-app help.
 *
 * Matching is on whole path segments, and the root `/app` matches only itself.
 * A plain `startsWith` looks right and isn't: `/app` is a prefix of every screen
 * in the product, so the dashboard's articles would turn up as "help for this
 * page" on the register, on settings, and on screens that don't exist.
 */
export function articlesForPath(path: string): HelpArticle[] {
  const normalised = path.replace(/\/+$/, "") || "/";

  const matches = HELP_ARTICLES.filter((article) => {
    if (!article.appPath) return false;
    const base = article.appPath.split("#")[0].replace(/\/+$/, "");

    if (base === "/app") return normalised === "/app";
    return normalised === base || normalised.startsWith(`${base}/`);
  });

  // Longest appPath first, so /app/settings beats a shorter match.
  return matches.sort((a, b) => (b.appPath?.length ?? 0) - (a.appPath?.length ?? 0));
}

export interface HelpSearchHit {
  article: HelpArticle;
  score: number;
  /** The line to show under the title in results. */
  excerpt: string;
}

/**
 * Search, without an index or a dependency.
 *
 * A few hundred articles at most, all in memory, so scoring every one on every
 * keystroke is cheaper than maintaining an index — and far cheaper than
 * shipping a search library to a browser on a shop's tablet.
 */
export function searchHelp(query: string, limit = 8): HelpSearchHit[] {
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.replace(/[^a-z0-9]/g, ""))
    .filter((t) => t.length > 1);

  if (terms.length === 0) return [];

  const hits: HelpSearchHit[] = [];

  for (const article of HELP_ARTICLES) {
    const title = article.title.toLowerCase();
    const summary = article.summary.toLowerCase();
    const keywords = (article.keywords ?? []).join(" ").toLowerCase();
    const body = article.sections
      .flatMap((s) => [s.heading, ...(s.body ?? []), ...(s.list ?? [])])
      .join(" ")
      .toLowerCase();
    const faq = (article.faq ?? [])
      .flatMap((f) => [f.question, f.answer])
      .join(" ")
      .toLowerCase();

    let score = 0;
    let matched = 0;

    for (const term of terms) {
      let termScore = 0;
      // Weighted by where the match is: a title hit means far more than a
      // passing mention three paragraphs into the body.
      if (title.includes(term)) termScore += 12;
      if (keywords.includes(term)) termScore += 8;
      if (summary.includes(term)) termScore += 5;
      if (faq.includes(term)) termScore += 3;
      if (body.includes(term)) termScore += 2;

      if (termScore > 0) matched++;
      score += termScore;
    }

    // Require every term to appear somewhere, so "stripe reader" doesn't match
    // an article that only mentions Stripe.
    if (matched < terms.length) continue;

    hits.push({
      article,
      score,
      excerpt: bestExcerpt(article, terms),
    });
  }

  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** The sentence that best explains why this article matched. */
function bestExcerpt(article: HelpArticle, terms: string[]): string {
  const candidates = [
    article.summary,
    ...article.sections.flatMap((s) => s.body ?? []),
    ...(article.faq ?? []).map((f) => f.answer),
  ];

  for (const candidate of candidates) {
    const lower = candidate.toLowerCase();
    if (terms.every((t) => lower.includes(t))) {
      return candidate.length > 180 ? `${candidate.slice(0, 177)}…` : candidate;
    }
  }
  return article.summary;
}

/** Rough total reading time, for the help index. */
export function totalReadMinutes(): number {
  return HELP_ARTICLES.reduce((sum, a) => sum + a.readMinutes, 0);
}
