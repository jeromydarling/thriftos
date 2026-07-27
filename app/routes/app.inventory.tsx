import { Form, Link, useSearchParams } from "react-router";
import type { Route } from "./+types/app.inventory";
import { requireUser } from "../lib/auth";
import { all, decodeCursor, encodeCursor } from "../lib/db";
import { envFrom } from "../lib/env";
import {
  currentDiscountPct,
  effectivePriceCents,
  nextMarkdown,
  TAG_COLOR_HEX,
  type MarkdownRule,
} from "../lib/markdown";
import { Badge, Card, EmptyState, Input, LinkButton, money, Select, TableScroll } from "../components/ui";

export function meta() {
  return [{ title: "Inventory | ThriftOS" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = envFrom(context);
  const user = await requireUser(request, env.DB);
  const url = new URL(request.url);

  const status = url.searchParams.get("status") ?? "available";
  const search = url.searchParams.get("q")?.trim() ?? "";
  const cursor = decodeCursor(url.searchParams.get("cursor"));
  const limit = 40;

  const where: string[] = ["org_id = ?"];
  const params: unknown[] = [user.orgId];

  if (status !== "all") {
    where.push("status = ?");
    params.push(status);
  }
  if (search) {
    where.push("(title LIKE ? OR tag_number = ? OR category LIKE ?)");
    params.push(`%${search}%`, search, `%${search}%`);
  }
  // Keyset on (created_at DESC, id) — stays fast however big the shop gets.
  if (cursor) {
    where.push("(created_at < ? OR (created_at = ? AND id < ?))");
    params.push(cursor[0], cursor[0], cursor[1]);
  }

  const [rows, rules] = await Promise.all([
    all<{
      id: string;
      title: string;
      category: string | null;
      tag_number: string | null;
      price_cents: number;
      retail_estimate_cents: number;
      tag_color: string | null;
      intake_date: string;
      status: string;
      condition: string;
      photo_key: string | null;
      created_at: string;
    }>(
      env.DB,
      `SELECT id, title, category, tag_number, price_cents, retail_estimate_cents,
              tag_color, intake_date, status, condition, photo_key, created_at
         FROM items
        WHERE ${where.join(" AND ")}
        ORDER BY created_at DESC, id DESC
        LIMIT ?`,
      ...params,
      limit + 1
    ),
    all<{ tag_color: string; week_index: number; discount_pct: number; age_days: number }>(
      env.DB,
      `SELECT tag_color, week_index, discount_pct, age_days FROM markdown_rules
        WHERE org_id = ? AND is_active = 1 ORDER BY week_index`,
      user.orgId
    ),
  ]);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];

  const markdownRules: MarkdownRule[] = rules.map((r) => ({
    tagColor: r.tag_color,
    weekIndex: r.week_index,
    discountPct: r.discount_pct,
    ageDays: r.age_days,
  }));

  const items = page.map((row) => {
    const shape = {
      priceCents: row.price_cents,
      tagColor: row.tag_color,
      intakeDate: row.intake_date,
    };
    const next = nextMarkdown(shape, markdownRules.length ? markdownRules : undefined);
    return {
      id: row.id,
      title: row.title,
      category: row.category,
      tagNumber: row.tag_number,
      tagColor: row.tag_color,
      condition: row.condition,
      status: row.status,
      intakeDate: row.intake_date,
      photoKey: row.photo_key,
      listPriceCents: row.price_cents,
      priceCents: effectivePriceCents(shape, markdownRules.length ? markdownRules : undefined),
      discountPct: currentDiscountPct(shape, markdownRules.length ? markdownRules : undefined),
      nextDrop: next,
    };
  });

  return {
    items,
    status,
    search,
    nextCursor: hasMore && last ? encodeCursor(last.created_at, last.id) : null,
  };
}

export default function Inventory({ loaderData }: Route.ComponentProps) {
  const { items, status, search, nextCursor } = loaderData;
  const [params] = useSearchParams();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl text-bark">Inventory</h1>
          <p className="mt-1 text-sm text-slate-soft">
            Every item is one of a kind. Prices step down as tags age.
          </p>
        </div>
        <LinkButton to="/app/intake">Log an item</LinkButton>
      </div>

      <Card>
        <Form method="get" className="flex flex-wrap items-end gap-3">
          <div className="min-w-48 flex-1">
            <label htmlFor="q" className="mb-1.5 block text-sm font-medium text-bark">
              Search
            </label>
            <Input id="q" name="q" defaultValue={search} placeholder="Name, tag, or category" />
          </div>
          <div className="w-44">
            <label htmlFor="status" className="mb-1.5 block text-sm font-medium text-bark">
              Status
            </label>
            <Select id="status" name="status" defaultValue={status}>
              <option value="available">On the floor</option>
              <option value="sold">Sold</option>
              <option value="held">Held</option>
              <option value="recycled">Recycled</option>
              <option value="all">Everything</option>
            </Select>
          </div>
          <button
            type="submit"
            className="touch-target rounded-xl bg-moss px-5 py-3 font-medium text-white hover:bg-moss-deep"
          >
            Filter
          </button>
        </Form>
      </Card>

      {items.length === 0 ? (
        <EmptyState
          title="Nothing here yet"
          body="Once you log a few items they'll show up here, colour-tagged and priced."
          action={<LinkButton to="/app/intake">Log your first item</LinkButton>}
        />
      ) : (
        <TableScroll>
          <table className="w-full text-sm">
            <thead className="border-b border-line bg-linen/60 text-left">
              <tr>
                <th className="px-4 py-3 font-medium text-slate-soft">Item</th>
                <th className="px-4 py-3 font-medium text-slate-soft">Tag</th>
                <th className="px-4 py-3 font-medium text-slate-soft">Age</th>
                <th className="px-4 py-3 text-right font-medium text-slate-soft">Price</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {items.map((item) => (
                <tr key={item.id} className="hover:bg-linen/40">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      {item.photoKey ? (
                        <img
                          src={`/api/media/${item.photoKey}?w=64`}
                          alt=""
                          className="h-10 w-10 rounded-lg object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <span className="inline-block h-10 w-10 rounded-lg bg-linen" />
                      )}
                      <span>
                        <span className="block text-bark">{item.title}</span>
                        <span className="block text-xs text-slate-soft">
                          {item.category ?? "Uncategorised"} · {item.condition}
                          {item.status !== "available" ? ` · ${item.status}` : ""}
                        </span>
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="flex items-center gap-2">
                      <span
                        className="inline-block h-3 w-3 rounded-full border border-line"
                        style={{ backgroundColor: TAG_COLOR_HEX[item.tagColor ?? ""] ?? "#ddd" }}
                      />
                      <span className="text-xs text-slate-soft">{item.tagNumber ?? "—"}</span>
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-soft">
                    {daysOld(item.intakeDate)} days
                    {item.nextDrop ? (
                      <span className="block">
                        −{item.nextDrop.toPct}% in {item.nextDrop.inDays}d
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className="font-medium text-bark">{money(item.priceCents)}</span>
                    {item.discountPct > 0 ? (
                      <span className="block text-xs">
                        <span className="text-slate-soft line-through">
                          {money(item.listPriceCents)}
                        </span>{" "}
                        <Badge color="#B8543F">−{item.discountPct}%</Badge>
                      </span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      )}

      {nextCursor ? (
        <div className="text-center">
          <Link
            to={`?${new URLSearchParams({
              ...Object.fromEntries(params),
              cursor: nextCursor,
            })}`}
            prefetch="intent"
            className="inline-block rounded-xl border border-line bg-white px-5 py-3 text-sm font-medium text-bark hover:bg-linen"
          >
            Show more
          </Link>
        </div>
      ) : null}
    </div>
  );
}

function daysOld(intakeDate: string): number {
  const ms = Date.now() - new Date(`${intakeDate}T00:00:00Z`).getTime();
  return Math.max(0, Math.floor(ms / 86_400_000));
}
