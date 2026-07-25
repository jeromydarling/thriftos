/**
 * SEO and AI-findability. Treated as a product surface, not an afterthought.
 *
 * React Router gotcha worth remembering: `meta()` receives `loaderData`, not
 * `data`. Getting that wrong silently ships pages with no tags at all.
 */

export const SITE = {
  name: "ThriftOS",
  tagline: "The operating system for thrift stores",
  description:
    "ThriftOS runs the register, the racks, and the relationships for thrift stores of every size — with landfill diversion and volunteer hours reported beside the revenue.",
  url: "https://thriftos.jeromydarling.workers.dev",
  twitter: "@thriftos",
} as const;

export interface MetaInput {
  title: string;
  description: string;
  /** Path with a leading slash. Becomes the canonical URL. */
  path: string;
  image?: string;
  type?: "website" | "article";
  noindex?: boolean;
}

type MetaDescriptor = Record<string, string> | { title: string };

/** Canonical + og:* + twitter:* from one small object. Every public page uses it. */
export function marketingMeta(input: MetaInput): MetaDescriptor[] {
  const url = `${SITE.url}${input.path === "/" ? "" : input.path}`;
  const image = input.image ?? `${SITE.url}/og-default.png`;
  const title = input.title.includes(SITE.name)
    ? input.title
    : `${input.title} | ${SITE.name}`;

  const tags: MetaDescriptor[] = [
    { title },
    { name: "description", content: input.description },
    { tagName: "link", rel: "canonical", href: url } as unknown as Record<string, string>,

    { property: "og:title", content: title },
    { property: "og:description", content: input.description },
    { property: "og:url", content: url },
    { property: "og:type", content: input.type ?? "website" },
    { property: "og:image", content: image },
    { property: "og:site_name", content: SITE.name },

    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: title },
    { name: "twitter:description", content: input.description },
    { name: "twitter:image", content: image },
  ];

  if (input.noindex) tags.push({ name: "robots", content: "noindex,nofollow" });

  return tags;
}

/* ─── JSON-LD ───────────────────────────────────────────────────────────── */

export function organizationSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: SITE.name,
    url: SITE.url,
    description: SITE.description,
  };
}

export function websiteSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: SITE.name,
    url: SITE.url,
  };
}

export function softwareApplicationSchema(lowestPriceUsd: number) {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: SITE.name,
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    description: SITE.description,
    offers: {
      "@type": "Offer",
      price: lowestPriceUsd.toFixed(2),
      priceCurrency: "USD",
    },
  };
}

export function faqSchema(faq: readonly { question: string; answer: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faq.map((f) => ({
      "@type": "Question",
      name: f.question,
      acceptedAnswer: { "@type": "Answer", text: f.answer },
    })),
  };
}

export function articleSchema(opts: {
  headline: string;
  description: string;
  path: string;
  datePublished: string;
}) {
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: opts.headline,
    description: opts.description,
    url: `${SITE.url}${opts.path}`,
    datePublished: opts.datePublished,
    publisher: { "@type": "Organization", name: SITE.name },
  };
}

export function breadcrumbSchema(items: readonly { label: string; path?: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.label,
      ...(item.path ? { item: `${SITE.url}${item.path}` } : {}),
    })),
  };
}

/** Store-specific schema, so a shop's own public page is findable as a store. */
export function storeSchema(org: {
  name: string;
  street?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  phone?: string | null;
  slug: string;
}) {
  return {
    "@context": "https://schema.org",
    "@type": "ThriftStore",
    name: org.name,
    url: `${SITE.url}/s/${org.slug}`,
    ...(org.phone ? { telephone: org.phone } : {}),
    ...(org.street || org.city
      ? {
          address: {
            "@type": "PostalAddress",
            streetAddress: org.street ?? undefined,
            addressLocality: org.city ?? undefined,
            addressRegion: org.state ?? undefined,
            postalCode: org.postalCode ?? undefined,
            addressCountry: "US",
          },
        }
      : {}),
  };
}

export function jsonLd(schemas: unknown[]): { __html: string } {
  return { __html: JSON.stringify(schemas.length === 1 ? schemas[0] : schemas) };
}
