import { Link, useSearchParams } from "react-router";
import type { Route } from "./+types/app.help";
import { requireUser } from "../lib/auth";
import { envFrom } from "../lib/env";
import { ArticleBody, HelpSearch } from "../components/help";
import { Card } from "../components/ui";
import { articlesIn, getArticle, populatedCategories } from "../content/help";

export function meta() {
  return [{ title: "Help | ThriftOS" }];
}

/**
 * In-app help. Same articles as the public centre, rendered inside the app so
 * nobody has to leave what they're doing — and so the answer sits next to the
 * screen it's about.
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  const env = envFrom(context);
  await requireUser(request, env.DB);

  const url = new URL(request.url);
  const slug = url.searchParams.get("a");
  const article = slug ? getArticle(slug) : undefined;

  return {
    article: article ? (JSON.parse(JSON.stringify(article)) as typeof article) : null,
    categories: populatedCategories().map((c) => ({
      ...c,
      articles: articlesIn(c.id).map((a) => ({
        slug: a.slug,
        title: a.title,
        summary: a.summary,
        readMinutes: a.readMinutes,
      })),
    })),
  };
}

export default function AppHelp({ loaderData }: Route.ComponentProps) {
  const { article, categories } = loaderData;
  const [, setParams] = useSearchParams();

  if (article) {
    return (
      <div className="mx-auto max-w-3xl">
        <button
          type="button"
          onClick={() => setParams({})}
          className="text-sm text-moss underline underline-offset-2"
        >
          ← All help
        </button>
        <div className="mt-6">
          <ArticleBody article={article} base="/app/help?a=" />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div>
        <h1 className="font-display text-3xl text-bark">Help</h1>
        <p className="mt-1 text-sm text-slate-soft">
          Everything about running the shop, without leaving it.
        </p>
      </div>

      <HelpSearch base="/app/help?a=" />

      <div className="space-y-8">
        {categories.map((category) => (
          <Card key={category.id}>
            <div className="flex items-baseline gap-2">
              <span className="text-moss" aria-hidden="true">{category.glyph}</span>
              <h2 className="font-display text-lg text-bark">{category.title}</h2>
            </div>
            <ul className="mt-3 divide-y divide-line">
              {category.articles.map((a) => (
                <li key={a.slug}>
                  <Link
                    to={`/app/help?a=${a.slug}`}
                    className="flex items-baseline justify-between gap-3 py-2.5"
                  >
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-bark">{a.title}</span>
                      <span className="mt-0.5 block text-xs leading-relaxed text-slate-soft">
                        {a.summary}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs text-slate-soft">{a.readMinutes}m</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>
    </div>
  );
}
