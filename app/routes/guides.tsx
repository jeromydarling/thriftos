import { Link } from "react-router";
import type { Route } from "./+types/guides";
import { breadcrumbSchema, jsonLd, marketingMeta } from "../lib/seo";
import { MarketingFooter, MarketingHeader, Section } from "../components/marketing";
import { GUIDE_CATEGORIES, GUIDES } from "../content/guides";

export function meta() {
  return marketingMeta({
    title: "Guides for running a thrift store",
    description:
      "Practical guides on colour-tag markdowns, donation receipts, pricing donated goods, volunteer hours, and impact reporting — useful whether or not you use ThriftOS.",
    path: "/guides",
  });
}

export function loader() {
  return {
    categories: GUIDE_CATEGORIES,
    guides: GUIDES.map((g) => ({
      slug: g.slug,
      title: g.title,
      description: g.description,
      category: g.category,
    })),
  };
}

export default function Guides({ loaderData }: Route.ComponentProps) {
  const { categories, guides } = loaderData;

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={jsonLd([
          breadcrumbSchema([{ label: "Home", path: "/" }, { label: "Guides" }]),
        ])}
      />

      <MarketingHeader />

      <main>
        <Section>
          <div className="max-w-2xl">
            <h1 className="font-display text-4xl text-bark">Guides</h1>
            <p className="mt-4 text-lg leading-relaxed text-slate-soft">
              Written to be useful whether or not you ever use ThriftOS. If something here is
              wrong, tell us and we'll fix it.
            </p>
          </div>

          <div className="mt-12 space-y-12">
            {categories.map((category) => (
              <div key={category}>
                <h2 className="font-display text-xl text-moss">{category}</h2>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  {guides
                    .filter((g) => g.category === category)
                    .map((guide) => (
                      <Link
                        key={guide.slug}
                        to={`/guides/${guide.slug}`}
                        prefetch="intent"
                        className="rounded-2xl border border-line bg-white p-6 transition hover:border-moss"
                      >
                        <h3 className="font-display text-lg text-bark">{guide.title}</h3>
                        <p className="mt-2 text-sm leading-relaxed text-slate-soft">
                          {guide.description}
                        </p>
                      </Link>
                    ))}
                </div>
              </div>
            ))}
          </div>
        </Section>
      </main>

      <MarketingFooter />
    </>
  );
}
