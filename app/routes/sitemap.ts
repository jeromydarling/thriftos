import { GUIDES } from "../content/guides";
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
