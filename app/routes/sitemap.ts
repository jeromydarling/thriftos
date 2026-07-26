import { GUIDES } from "../content/guides";
import { HELP_ARTICLES } from "../content/help";
import { SITE } from "../lib/seo";

/**
 * Generated from the real route and content registry, so it cannot go stale
 * when a guide is added. A test pins that every listed URL resolves.
 */
export const STATIC_ROUTES = [
  { path: "/", priority: "1.0", changefreq: "weekly" },
  { path: "/nri", priority: "0.9", changefreq: "monthly" },
  { path: "/pricing", priority: "0.9", changefreq: "monthly" },
  { path: "/compare", priority: "0.9", changefreq: "monthly" },
  { path: "/guides", priority: "0.8", changefreq: "weekly" },
  { path: "/help", priority: "0.8", changefreq: "weekly" },
  { path: "/signup", priority: "0.7", changefreq: "monthly" },
] as const;

export function sitemapUrls(): { loc: string; priority: string; changefreq: string; lastmod?: string }[] {
  return [
    ...STATIC_ROUTES.map((r) => ({
      loc: `${SITE.url}${r.path === "/" ? "" : r.path}`,
      priority: r.priority,
      changefreq: r.changefreq,
    })),
    ...GUIDES.map((g) => ({
      loc: `${SITE.url}/guides/${g.slug}`,
      priority: "0.7",
      changefreq: "monthly",
      lastmod: g.published,
    })),
    // The help centre is public on purpose. Somebody evaluating the software
    // should be able to read exactly how it works before they sign up, and a
    // shop searching for how to do something at 9pm should find the answer
    // without hitting a login wall.
    ...HELP_ARTICLES.map((a) => ({
      loc: `${SITE.url}/help/${a.slug}`,
      priority: "0.6",
      changefreq: "monthly",
      lastmod: a.updated,
    })),
  ];
}

export function loader() {
  const urls = sitemapUrls()
    .map(
      (u) =>
        `  <url>\n    <loc>${u.loc}</loc>\n${u.lastmod ? `    <lastmod>${u.lastmod}</lastmod>\n` : ""}    <changefreq>${u.changefreq}</changefreq>\n    <priority>${u.priority}</priority>\n  </url>`
    )
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
