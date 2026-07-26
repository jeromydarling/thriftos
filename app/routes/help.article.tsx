import { Link } from "react-router";
import type { Route } from "./+types/help.article";
import { articleSchema, breadcrumbSchema, faqSchema, jsonLd, marketingMeta } from "../lib/seo";
import { MarketingFooter, MarketingHeader } from "../components/marketing";
import { ArticleBody } from "../components/help";
import { getArticle, HELP_CATEGORIES } from "../content/help";

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData?.article) {
    return marketingMeta({
      title: "Article not found",
      description: "That help article doesn't exist.",
      path: "/help",
      noindex: true,
    });
  }
  return marketingMeta({
    title: `${loaderData.article.title} | Help`,
    description: loaderData.article.summary,
    path: `/help/${loaderData.article.slug}`,
    type: "article",
  });
}

export async function loader({ params }: Route.LoaderArgs) {
  const article = getArticle(params.slug ?? "");
  if (!article) throw new Response("Not found", { status: 404 });

  const category = HELP_CATEGORIES.find((c) => c.id === article.category);

  return {
    article: JSON.parse(JSON.stringify(article)) as typeof article,
    categoryTitle: category?.title ?? "Help",
  };
}

export default function HelpArticlePage({ loaderData }: Route.ComponentProps) {
  const { article, categoryTitle } = loaderData;

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={jsonLd(
          [
            articleSchema({
              headline: article.title,
              description: article.summary,
              path: `/help/${article.slug}`,
              datePublished: article.updated,
            }),
            article.faq && article.faq.length > 0 ? faqSchema(article.faq) : null,
            breadcrumbSchema([
              { label: "Home", path: "/" },
              { label: "Help", path: "/help" },
              { label: article.title },
            ]),
          ].filter(Boolean)
        )}
      />
      <MarketingHeader />

      <main className="mx-auto max-w-3xl px-4 py-12 sm:py-16">
        <nav className="text-sm text-slate-soft">
          <Link to="/help" className="hover:text-bark">Help</Link>
          <span> · {categoryTitle}</span>
        </nav>

        <div className="mt-6">
          <ArticleBody article={article} />
        </div>

        <div className="mt-14 rounded-2xl border border-line bg-white p-6">
          <p className="text-sm leading-relaxed text-slate-soft">
            Was this the answer you needed? If not, tell us what you were actually trying to
            do — unclear help is a bug we'd like to fix.
          </p>
        </div>
      </main>

      <MarketingFooter />
    </>
  );
}
