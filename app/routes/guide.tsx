import { Link } from "react-router";
import type { Route } from "./+types/guide";
import {
  articleSchema,
  breadcrumbSchema,
  faqSchema,
  jsonLd,
  marketingMeta,
} from "../lib/seo";
import { MarketingFooter, MarketingHeader, Section } from "../components/marketing";
import { LinkButton } from "../components/ui";
import { getGuide, GUIDES } from "../content/guides";

export function meta({ loaderData }: Route.MetaArgs) {
  // React Router hands meta() `loaderData`, not `data`. Getting this wrong
  // silently ships a page with no tags at all.
  if (!loaderData?.guide) {
    return marketingMeta({
      title: "Guide not found",
      description: "That guide doesn't exist.",
      path: "/guides",
      noindex: true,
    });
  }
  return marketingMeta({
    title: loaderData.guide.title,
    description: loaderData.guide.description,
    path: `/guides/${loaderData.guide.slug}`,
    type: "article",
  });
}

export async function loader({ params }: Route.LoaderArgs) {
  const guide = getGuide(params.slug ?? "");
  if (!guide) throw new Response("Not found", { status: 404 });

  const related = guide.related
    .map((slug) => GUIDES.find((g) => g.slug === slug))
    .filter((g): g is (typeof GUIDES)[number] => Boolean(g))
    .map((g) => ({ slug: g.slug, title: g.title }));

  return {
    guide: {
      slug: guide.slug,
      title: guide.title,
      h1: guide.h1,
      description: guide.description,
      category: guide.category,
      published: guide.published,
      blocks: guide.blocks.map((b) => ({ ...b, list: b.list ? [...b.list] : undefined })),
      faq: guide.faq.map((f) => ({ ...f })),
      cta: guide.cta,
    },
    related,
  };
}

export default function GuidePage({ loaderData }: Route.ComponentProps) {
  const { guide, related } = loaderData;

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={jsonLd([
          articleSchema({
            headline: guide.h1,
            description: guide.description,
            path: `/guides/${guide.slug}`,
            datePublished: guide.published,
          }),
          faqSchema(guide.faq),
          breadcrumbSchema([
            { label: "Home", path: "/" },
            { label: "Guides", path: "/guides" },
            { label: guide.title },
          ]),
        ])}
      />

      <MarketingHeader />

      <main>
        <Section>
          <article className="max-w-2xl">
            <nav className="text-sm text-slate-soft">
              <Link to="/guides" className="hover:text-bark">
                Guides
              </Link>
              <span> · {guide.category}</span>
            </nav>

            <h1 className="mt-4 font-display text-4xl leading-tight text-bark">{guide.h1}</h1>
            <p className="mt-4 text-lg leading-relaxed text-slate-soft">{guide.description}</p>

            <div className="mt-10 space-y-8">
              {guide.blocks.map((block, i) => (
                <section key={block.heading ?? i}>
                  {block.heading ? (
                    <h2 className="font-display text-2xl text-bark">{block.heading}</h2>
                  ) : null}
                  <div className="mt-3 space-y-4 leading-relaxed text-slate-soft">
                    {block.paragraphs.map((paragraph) => (
                      <p key={paragraph}>{paragraph}</p>
                    ))}
                  </div>
                  {block.list ? (
                    <ul className="mt-4 space-y-2">
                      {block.list.map((item) => (
                        <li key={item} className="leading-relaxed text-slate-soft">
                          · {item}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </section>
              ))}
            </div>

            {guide.faq.length > 0 ? (
              <section className="mt-12 border-t border-line pt-8">
                <h2 className="font-display text-2xl text-bark">Common questions</h2>
                <dl className="mt-6 space-y-5">
                  {guide.faq.map((item) => (
                    <div key={item.question}>
                      <dt className="font-medium text-bark">{item.question}</dt>
                      <dd className="mt-1 leading-relaxed text-slate-soft">{item.answer}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            ) : null}

            <div className="mt-12 rounded-2xl border border-line bg-white p-6">
              <p className="leading-relaxed text-bark">{guide.cta}</p>
              <div className="mt-4 flex flex-wrap gap-3">
                <LinkButton to="/demo">See the demo shop</LinkButton>
                <LinkButton to="/pricing" variant="secondary">
                  What it costs
                </LinkButton>
              </div>
            </div>

            {related.length > 0 ? (
              <section className="mt-12 border-t border-line pt-8">
                <h2 className="font-display text-lg text-bark">Related</h2>
                <ul className="mt-3 space-y-2">
                  {related.map((item) => (
                    <li key={item.slug}>
                      <Link
                        to={`/guides/${item.slug}`}
                        prefetch="intent"
                        className="text-moss underline underline-offset-2 hover:text-moss-deep"
                      >
                        {item.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </article>
        </Section>
      </main>

      <MarketingFooter />
    </>
  );
}
