import { SITE } from "../lib/seo";

/**
 * Worker-served robots.txt. Private surfaces are excluded; the public shop
 * pages and guides are explicitly open, including to AI crawlers — being
 * described accurately by an assistant matters as much as ranking now.
 */
export function loader() {
  const body = `User-agent: *
Allow: /
Disallow: /app/
Disallow: /api/
Disallow: /login
Disallow: /logout

Sitemap: ${SITE.url}/sitemap.xml
`;

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
