import { Link } from "react-router";
import type { Route } from "./+types/help";
import { breadcrumbSchema, jsonLd, marketingMeta } from "../lib/seo";
import { MarketingFooter, MarketingHeader } from "../components/marketing";
import { HelpSearch } from "../components/help";
import { articlesIn, HELP_ARTICLES, populatedCategories, totalReadMinutes } from "../content/help";

export function meta() {
  return marketingMeta({
    title: "Help centre",
    description:
      "How to use every part of ThriftOS — setting up card payments, logging donations, colour-tag markdowns, receipts, impact reporting, and moving in from another system.",
    path: "/help",
  });
}

export function loader() {
  return {
    categories: populatedCategories().map((c) => ({
      ...c,
      articles: articlesIn(c.id).map((a) => ({
        slug: a.slug,
        title: a.title,
        summary: a.summary,
        readMinutes: a.readMinutes,
      })),
    })),
    count: HELP_ARTICLES.length,
    minutes: totalReadMinutes(),
  };
}

export default function Help({ loaderData }: Route.ComponentProps) {
  const { categories, count, minutes } = loaderData;

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={jsonLd([
          breadcrumbSchema([{ label: "Home", path: "/" }, { label: "Help" }]),
        ])}
      />
      <MarketingHeader />

      <main>
        <section className="border-b border-line bg-white">
          <div className="mx-auto max-w-4xl px-4 py-14 sm:py-20">
            <h1 className="font-display text-4xl text-bark sm:text-5xl">Help centre</h1>
            <p className="mt-4 max-w-2xl text-lg leading-relaxed text-slate-soft">
              {count} articles covering every corner of ThriftOS, written for someone standing
              behind a counter with a queue forming. About {Math.round(minutes / 6) * 6} minutes
              of reading in total, and you won't need most of it.
            </p>
            <div className="mt-8">
              <HelpSearch />
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-4xl px-4 py-14">
          <div className="space-y-12">
            {categories.map((category) => (
              <div key={category.id}>
                <div className="flex items-baseline gap-3">
                  <span className="text-moss" aria-hidden="true">{category.glyph}</span>
                  <h2 className="font-display text-2xl text-bark">{category.title}</h2>
                </div>
                <p className="mt-1 text-sm leading-relaxed text-slate-soft">{category.blurb}</p>

                <ul className="mt-4 divide-y divide-line overflow-hidden rounded-2xl border border-line bg-white">
                  {category.articles.map((article) => (
                    <li key={article.slug}>
                      <Link
                        to={`/help/${article.slug}`}
                        prefetch="intent"
                        className="flex items-baseline justify-between gap-4 px-5 py-4 hover:bg-linen"
                      >
                        <span className="min-w-0">
                          <span className="block font-medium text-bark">{article.title}</span>
                          <span className="mt-0.5 block text-sm leading-relaxed text-slate-soft">
                            {article.summary}
                          </span>
                        </span>
                        <span className="shrink-0 text-xs text-slate-soft">
                          {article.readMinutes} min
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <div className="mt-14 rounded-2xl border border-line bg-white p-6">
            <h2 className="font-display text-lg text-bark">Can't find it?</h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-soft">
              A gap in the help is our problem rather than yours. Tell us what you were looking
              for and we'll write it — and answer your question directly in the meantime.
            </p>
          </div>
        </section>
      </main>

      <MarketingFooter />
    </>
  );
}
