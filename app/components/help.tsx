/**
 * Help centre rendering, shared between the public site and in-app help so the
 * two can never drift.
 */
import { useMemo, useState } from "react";
import { Link } from "react-router";
import type { HelpArticle, HelpSection } from "../content/help/types";
import { searchHelp } from "../content/help";

export function ArticleBody({ article, base = "/help" }: { article: HelpArticle; base?: string }) {
  return (
    <article>
      <header>
        <h1 className="font-display text-3xl leading-tight text-bark sm:text-4xl">
          {article.title}
        </h1>
        <p className="mt-3 text-lg leading-relaxed text-slate-soft">{article.summary}</p>
        <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-soft">
          <span>{article.readMinutes} min read</span>
          <span aria-hidden="true">·</span>
          <span>For {article.audience.join(", ")}</span>
          {article.appPath ? (
            <>
              <span aria-hidden="true">·</span>
              <Link
                to={article.appPath}
                prefetch="intent"
                className="font-medium text-moss underline underline-offset-2"
              >
                Open this in the app
              </Link>
            </>
          ) : null}
        </p>
      </header>

      <div className="mt-10 space-y-10">
        {article.sections.map((section) => (
          <Section key={section.heading} section={section} />
        ))}
      </div>

      {article.faq && article.faq.length > 0 ? (
        <section className="mt-12 border-t border-line pt-8">
          <h2 className="font-display text-2xl text-bark">Common questions</h2>
          <dl className="mt-5 space-y-5">
            {article.faq.map((item) => (
              <div key={item.question}>
                <dt className="font-medium text-bark">{item.question}</dt>
                <dd className="mt-1 leading-relaxed text-slate-soft">{item.answer}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}

      {article.related && article.related.length > 0 ? (
        <section className="mt-12 border-t border-line pt-8">
          <h2 className="font-display text-lg text-bark">Next</h2>
          <ul className="mt-3 space-y-2">
            {article.related.map((slug) => (
              <li key={slug}>
                <Link
                  to={`${base}/${slug}`}
                  prefetch="intent"
                  className="text-moss underline underline-offset-2 hover:text-moss-deep"
                >
                  {slug.replace(/-/g, " ").replace(/^\w/, (c) => c.toUpperCase())}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </article>
  );
}

function Section({ section }: { section: HelpSection }) {
  return (
    <section>
      <h2 className="font-display text-2xl text-bark">{section.heading}</h2>

      {section.body ? (
        <div className="mt-3 space-y-4 leading-relaxed text-slate-soft">
          {section.body.map((p) => (
            <p key={p}>{p}</p>
          ))}
        </div>
      ) : null}

      {section.list ? (
        <ul className="mt-4 space-y-2">
          {section.list.map((item) => (
            <li key={item} className="flex gap-2.5 leading-relaxed text-slate-soft">
              <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-moss" />
              {item}
            </li>
          ))}
        </ul>
      ) : null}

      {section.steps ? (
        <ol className="mt-5 space-y-4">
          {section.steps.map((step, i) => (
            <li key={step.do} className="flex gap-4">
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-moss/10 text-xs font-medium text-moss">
                {i + 1}
              </span>
              <div className="min-w-0">
                <p className="font-medium text-bark">{step.do}</p>
                {step.expect ? (
                  <p className="mt-1 text-sm leading-relaxed text-slate-soft">
                    <span className="text-moss">You should see:</span> {step.expect}
                  </p>
                ) : null}
                {step.watchOut ? (
                  <p className="mt-1 text-sm leading-relaxed text-slate-soft">
                    <span className="text-clay">Watch out:</span> {step.watchOut}
                  </p>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      ) : null}

      {section.table ? (
        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[30rem] border-collapse text-sm">
            <thead>
              <tr className="border-b border-line text-left">
                {section.table.headers.map((h) => (
                  <th key={h} className="px-3 py-2 font-medium text-slate-soft">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {section.table.rows.map((row) => (
                <tr key={row.join("|")}>
                  {row.map((cell, i) => (
                    <td
                      key={i}
                      className={`px-3 py-2.5 align-top leading-relaxed ${
                        i === 0 ? "font-medium text-bark" : "text-slate-soft"
                      }`}
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {section.callout ? (
        <div
          className={`mt-5 rounded-xl border p-4 ${
            section.callout.tone === "warn"
              ? "border-clay/30 bg-clay/5"
              : section.callout.tone === "good"
                ? "border-moss/30 bg-moss/5"
                : "border-line bg-linen/60"
          }`}
        >
          <p className="font-medium text-bark">{section.callout.title}</p>
          <p className="mt-1 text-sm leading-relaxed text-slate-soft">{section.callout.body}</p>
        </div>
      ) : null}
    </section>
  );
}

/** Live search box. Filters in memory — no request, no index to keep warm. */
export function HelpSearch({ base = "/help" }: { base?: string }) {
  const [query, setQuery] = useState("");
  const hits = useMemo(() => searchHelp(query), [query]);

  return (
    <div>
      <label htmlFor="help-search" className="sr-only">
        Search help
      </label>
      <input
        id="help-search"
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="What are you trying to do?"
        className="touch-target w-full rounded-xl border border-line bg-white px-4 py-3 text-bark outline-none focus:border-moss"
      />

      {query.trim().length > 1 ? (
        hits.length > 0 ? (
          <ul className="mt-3 divide-y divide-line overflow-hidden rounded-xl border border-line bg-white">
            {hits.map(({ article, excerpt }) => (
              <li key={article.slug}>
                <Link
                  to={`${base}/${article.slug}`}
                  prefetch="intent"
                  className="block px-4 py-3 hover:bg-linen"
                >
                  <p className="font-medium text-bark">{article.title}</p>
                  <p className="mt-0.5 line-clamp-2 text-sm leading-relaxed text-slate-soft">
                    {excerpt}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <div className="mt-3 rounded-xl border border-dashed border-line bg-white/60 px-4 py-6 text-center">
            <p className="text-sm text-bark">Nothing matched that.</p>
            <p className="mt-1 text-xs leading-relaxed text-slate-soft">
              Try fewer words, or browse the categories below. If it genuinely isn't covered,
              tell us — a gap in the help is our problem, not yours.
            </p>
          </div>
        )
      ) : null}
    </div>
  );
}
