import { Link } from "react-router";
import type { Route } from "./+types/storefront";
import { all, first } from "../lib/db";
import { envFrom } from "../lib/env";
import { jsonLd, marketingMeta, storeSchema } from "../lib/seo";
import {
  currentDiscountPct,
  effectivePriceCents,
  TAG_COLOR_HEX,
  type MarkdownRule,
} from "../lib/markdown";
import { Badge, money } from "../components/ui";

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData?.org) {
    return marketingMeta({
      title: "Shop not found",
      description: "That shop doesn't exist.",
      path: "/",
      noindex: true,
    });
  }
  return marketingMeta({
    title: `${loaderData.org.name} — what's on the floor`,
    description: `Browse what's currently on the floor at ${loaderData.org.name}${
      loaderData.org.city ? ` in ${loaderData.org.city}, ${loaderData.org.state ?? ""}` : ""
    }. Every item is one of a kind.`,
    path: `/s/${loaderData.org.slug}`,
  });
}

export async function loader({ params, context, request }: Route.LoaderArgs) {
  const env = envFrom(context);

  const org = await first<{
    id: string;
    slug: string;
    name: string;
    street: string | null;
    city: string | null;
    state: string | null;
    postal_code: string | null;
    phone: string | null;
    brand_primary: string;
    status: string;
  }>(
    env.DB,
    `SELECT id, slug, name, street, city, state, postal_code, phone, brand_primary, status
       FROM orgs WHERE slug = ? AND status = 'active'`,
    params.slug ?? ""
  );

  if (!org) throw new Response("Not found", { status: 404 });

  const [items, rules] = await Promise.all([
    all<{
      id: string;
      title: string;
      description: string | null;
      category: string | null;
      condition: string;
      price_cents: number;
      tag_color: string | null;
      intake_date: string;
      photo_key: string | null;
    }>(
      env.DB,
      `SELECT id, title, description, category, condition, price_cents, tag_color,
              intake_date, photo_key
         FROM items
        WHERE org_id = ? AND status = 'available' AND price_cents > 0 AND listed_online = 1
        ORDER BY created_at DESC LIMIT 60`,
      org.id
    ),
    all<{ tag_color: string; week_index: number; discount_pct: number; age_days: number }>(
      env.DB,
      `SELECT tag_color, week_index, discount_pct, age_days FROM markdown_rules
        WHERE org_id = ? AND is_active = 1 ORDER BY week_index`,
      org.id
    ),
  ]);

  const markdownRules: MarkdownRule[] = rules.map((r) => ({
    tagColor: r.tag_color,
    weekIndex: r.week_index,
    discountPct: r.discount_pct,
    ageDays: r.age_days,
  }));

  const listed = items.map((item) => {
    const shape = {
      priceCents: item.price_cents,
      tagColor: item.tag_color,
      intakeDate: item.intake_date,
    };
    return {
      id: item.id,
      title: item.title,
      description: item.description,
      category: item.category,
      condition: item.condition,
      photoKey: item.photo_key,
      tagColor: item.tag_color,
      listPriceCents: item.price_cents,
      priceCents: effectivePriceCents(shape, markdownRules.length ? markdownRules : undefined),
      discountPct: currentDiscountPct(shape, markdownRules.length ? markdownRules : undefined),
    };
  });

  return { org, items: listed };
}

/**
 * Anonymous public GETs are edge-cached briefly. Bypassed on any session
 * cookie, and only 200s without Set-Cookie are stored.
 */
export function headers() {
  return {
    "Cache-Control": "public, max-age=0, s-maxage=120, stale-while-revalidate=600",
  };
}

export default function Storefront({ loaderData }: Route.ComponentProps) {
  const { org, items } = loaderData;

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={jsonLd([
          storeSchema({
            name: org.name,
            street: org.street,
            city: org.city,
            state: org.state,
            postalCode: org.postal_code,
            phone: org.phone,
            slug: org.slug,
          }),
        ])}
      />

      <header className="border-b border-line bg-white">
        <div className="mx-auto max-w-5xl px-4 py-8">
          <h1 className="font-display text-3xl" style={{ color: org.brand_primary }}>
            {org.name}
          </h1>
          {org.city ? (
            <p className="mt-1 text-sm text-slate-soft">
              {org.street ? `${org.street}, ` : ""}
              {org.city}
              {org.state ? `, ${org.state}` : ""} {org.postal_code ?? ""}
              {org.phone ? ` · ${org.phone}` : ""}
            </p>
          ) : null}
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-10">
        <p className="max-w-2xl leading-relaxed text-slate-soft">
          Everything here is one of a kind — when it's gone, it's gone. Prices shown are
          today's; tags step down as items age. Come by and see it in person.
        </p>

        {items.length === 0 ? (
          <div className="mt-10 rounded-2xl border border-dashed border-line bg-white/60 px-6 py-12 text-center">
            <p className="font-display text-lg text-bark">Nothing listed online just now</p>
            <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-slate-soft">
              The floor is fuller than this page — we only list a portion online. Come and
              have a look.
            </p>
          </div>
        ) : (
          <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((item) => (
              <article key={item.id} className="rounded-2xl border border-line bg-white p-4">
                {item.photoKey ? (
                  <img
                    src={`/api/media/${item.photoKey}?w=480`}
                    alt={item.title}
                    loading="lazy"
                    className="aspect-square w-full rounded-xl object-cover"
                  />
                ) : (
                  <div className="aspect-square w-full rounded-xl bg-linen" />
                )}
                <h2 className="mt-3 font-display text-lg text-bark">{item.title}</h2>
                <p className="mt-1 text-xs text-slate-soft">
                  {item.category ?? "One of a kind"} · {item.condition}
                </p>
                {item.description ? (
                  <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-slate-soft">
                    {item.description}
                  </p>
                ) : null}
                <p className="mt-3 flex items-center gap-2">
                  <span className="font-display text-xl text-bark">{money(item.priceCents)}</span>
                  {item.discountPct > 0 ? (
                    <>
                      <span className="text-sm text-slate-soft line-through">
                        {money(item.listPriceCents)}
                      </span>
                      <Badge color="#B8543F">−{item.discountPct}%</Badge>
                    </>
                  ) : null}
                </p>
              </article>
            ))}
          </div>
        )}
      </main>

      <footer className="mt-16 border-t border-line bg-white">
        <div className="mx-auto max-w-5xl px-4 py-8 text-xs text-slate-soft">
          <Link to="/" className="hover:text-bark">
            Runs on ThriftOS
          </Link>
        </div>
      </footer>
    </>
  );
}
