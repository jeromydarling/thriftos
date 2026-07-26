import { useState } from "react";
import { Form, Link, useNavigation } from "react-router";
import type { Route } from "./+types/app.site";
import { requireUser } from "../lib/auth";
import { envFrom } from "../lib/env";
import { all, first, run } from "../lib/db";
import { newId } from "../lib/ids";
import {
  BLOCKS,
  blockSpec,
  DEFAULT_HOME,
  parseBlocks,
  serialiseBlocks,
  slugAvailable,
  suggestSlug,
  type Block,
  type BlockKind,
} from "../lib/site";
import { Button, Card, Input, Notice } from "../components/ui";

export function meta() {
  return [{ title: "Your website | ThriftOS" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = envFrom(context);
  const user = await requireUser(request, env.DB);

  const url = new URL(request.url);
  const editing = url.searchParams.get("page");

  const [org, pages] = await Promise.all([
    first<{ slug: string; name: string }>(
      env.DB,
      `SELECT slug, name FROM orgs WHERE id = ?`,
      user.orgId
    ),
    all<{
      id: string;
      slug: string;
      title: string;
      status: string;
      nav_order: number | null;
      nav_label: string | null;
      updated_at: string;
    }>(
      env.DB,
      `SELECT id, slug, title, status, nav_order, nav_label, updated_at
         FROM site_pages WHERE org_id = ?
        ORDER BY slug = '' DESC, nav_order, title`,
      user.orgId
    ),
  ]);

  const page =
    editing !== null
      ? await first<{
          id: string;
          slug: string;
          title: string;
          status: string;
          blocks_json: string;
          nav_order: number | null;
          nav_label: string | null;
          seo_description: string | null;
        }>(
          env.DB,
          `SELECT id, slug, title, status, blocks_json, nav_order, nav_label, seo_description
             FROM site_pages WHERE org_id = ? AND slug = ?`,
          user.orgId,
          editing
        )
      : null;

  // Editing the front page of a shop that has never saved one shows the
  // default rather than a blank slate — it's what the public already sees.
  const blocks =
    page !== null
      ? parseBlocks(page.blocks_json)
      : editing === ""
        ? DEFAULT_HOME
        : [];

  return {
    slug: org?.slug ?? "",
    shopName: org?.name ?? "",
    suggested: suggestSlug(org?.name ?? ""),
    pages,
    editing,
    page,
    blocks,
    appUrl: env.APP_URL ?? "",
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const env = envFrom(context);
  const user = await requireUser(request, env.DB);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "slug") {
    const wanted = String(form.get("slug") ?? "").trim().toLowerCase();
    const check = await slugAvailable(env.DB, wanted, user.orgId);
    if (!check.ok) return { error: check.reason };

    await run(
      env.DB,
      `UPDATE orgs SET slug = ?, updated_at = datetime('now') WHERE id = ?`,
      wanted,
      user.orgId
    );
    return { ok: "Your address is updated. The old one no longer works, so update anything printed." };
  }

  if (intent === "save") {
    const slug = String(form.get("slug") ?? "");
    const title = String(form.get("title") ?? "").trim() || "Untitled";

    // Blocks arrive as parallel arrays, in the order they appear on screen.
    const kinds = form.getAll("blockKind").map(String);
    const headings = form.getAll("blockHeading").map(String);
    const bodies = form.getAll("blockBody").map(String);

    const blocks: Block[] = kinds
      .map((kind, i) => ({
        kind: kind as BlockKind,
        heading: headings[i] ?? "",
        body: bodies[i] ?? "",
      }))
      .filter((b) => blockSpec(b.kind));

    const existing = await first<{ id: string }>(
      env.DB,
      `SELECT id FROM site_pages WHERE org_id = ? AND slug = ?`,
      user.orgId,
      slug
    );

    const publish = form.get("publish") === "on";
    const inNav = form.get("inNav") === "on";

    if (existing) {
      await run(
        env.DB,
        `UPDATE site_pages
            SET title = ?, blocks_json = ?, status = ?, nav_order = ?, nav_label = ?,
                seo_description = ?, updated_by = ?,
                published_at = CASE WHEN ? = 'published' AND published_at IS NULL
                                    THEN datetime('now') ELSE published_at END,
                updated_at = datetime('now')
          WHERE id = ? AND org_id = ?`,
        title,
        serialiseBlocks(blocks),
        publish ? "published" : "draft",
        inNav ? Number(form.get("navOrder") ?? 10) : null,
        String(form.get("navLabel") ?? "").trim() || null,
        String(form.get("seoDescription") ?? "").trim() || null,
        user.id,
        publish ? "published" : "draft",
        existing.id,
        user.orgId
      );
    } else {
      await run(
        env.DB,
        `INSERT INTO site_pages
           (id, org_id, slug, title, blocks_json, status, nav_order, nav_label,
            seo_description, updated_by, published_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CASE WHEN ? = 'published' THEN datetime('now') END)`,
        newId("sitePage"),
        user.orgId,
        slug,
        title,
        serialiseBlocks(blocks),
        publish ? "published" : "draft",
        inNav ? Number(form.get("navOrder") ?? 10) : null,
        String(form.get("navLabel") ?? "").trim() || null,
        String(form.get("seoDescription") ?? "").trim() || null,
        user.id,
        publish ? "published" : "draft"
      );
    }

    return { ok: publish ? "Published. It's live now." : "Saved as a draft. Only you can see it." };
  }

  if (intent === "new") {
    const wanted = String(form.get("pageSlug") ?? "").trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{0,48}$/.test(wanted)) {
      return { error: "Use letters, numbers, and hyphens for the address." };
    }
    const clash = await first<{ id: string }>(
      env.DB,
      `SELECT id FROM site_pages WHERE org_id = ? AND slug = ?`,
      user.orgId,
      wanted
    );
    if (clash) return { error: "You already have a page at that address." };

    await run(
      env.DB,
      `INSERT INTO site_pages (id, org_id, slug, title, blocks_json, status, updated_by)
       VALUES (?, ?, ?, ?, '[]', 'draft', ?)`,
      newId("sitePage"),
      user.orgId,
      wanted,
      String(form.get("pageTitle") ?? "").trim() || wanted,
      user.id
    );
    return { ok: "Page created as a draft." };
  }

  if (intent === "delete") {
    const slug = String(form.get("slug") ?? "");
    // The front page isn't deletable — a shop with no front page has no site.
    if (slug === "") return { error: "The front page can't be deleted." };
    await run(
      env.DB,
      `DELETE FROM site_pages WHERE org_id = ? AND slug = ?`,
      user.orgId,
      slug
    );
    return { ok: "Page deleted." };
  }

  return { error: "That action isn't one we know." };
}

export default function Site({ loaderData, actionData }: Route.ComponentProps) {
  const { slug, shopName, suggested, pages, editing, page, blocks, appUrl } = loaderData;
  const nav = useNavigation();
  const busy = nav.state !== "idle";
  const host = appUrl.replace(/^https?:\/\//, "") || "thriftos.app";

  if (editing !== null) {
    return (
      <PageEditor
        slug={editing}
        page={page}
        blocks={blocks}
        busy={busy}
        actionData={actionData}
        publicUrl={`${host}/${slug}${editing ? `/${editing}` : ""}`}
      />
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <header>
        <h1 className="font-display text-3xl text-bark">Your website</h1>
        <p className="mt-3 leading-relaxed text-slate-soft">
          Already live at{" "}
          <a
            href={`/${slug}`}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-moss underline underline-offset-2"
          >
            {host}/{slug}
          </a>
          . Your hours, what's on the racks, and your impact figures come straight from your
          records — so the page can't be out of date about things you've already updated once.
        </p>
      </header>

      {actionData && "ok" in actionData && actionData.ok ? (
        <Notice tone="good">{actionData.ok}</Notice>
      ) : null}
      {actionData && "error" in actionData && actionData.error ? (
        <Notice tone="warn">{actionData.error}</Notice>
      ) : null}

      <Card>
        <h2 className="font-display text-xl text-bark">Your address</h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-soft">
          Changing this breaks anything already printed. Worth getting right once rather than
          twice.
        </p>
        <Form method="post" className="mt-4 flex flex-wrap items-end gap-2">
          <input type="hidden" name="intent" value="slug" />
          <div className="min-w-[16rem] flex-1">
            <label htmlFor="slug" className="block text-sm font-medium text-bark">
              {host}/
            </label>
            <Input
              id="slug"
              name="slug"
              defaultValue={slug}
              placeholder={suggested}
              className="mt-1"
              spellCheck={false}
            />
          </div>
          <Button type="submit" variant="secondary" disabled={busy}>
            Change it
          </Button>
        </Form>
      </Card>

      <section>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="font-display text-xl text-bark">Pages</h2>
          <Link
            to="/app/site?page="
            className="text-sm text-moss underline underline-offset-2"
          >
            Edit the front page
          </Link>
        </div>

        <ul className="mt-4 divide-y divide-line overflow-hidden rounded-xl border border-line bg-white">
          {pages.length === 0 ? (
            <li className="px-4 py-6 text-sm leading-relaxed text-slate-soft">
              You haven't customised anything yet, which is fine —{" "}
              <span className="text-bark">{host}/{slug}</span> already shows your hours, stock,
              and how to donate. Edit the front page to add your own words.
            </li>
          ) : (
            pages.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="font-medium text-bark">
                    {p.title}
                    {p.status === "draft" ? (
                      <span className="ml-2 text-xs text-clay">draft</span>
                    ) : null}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-soft">
                    {host}/{slug}
                    {p.slug ? `/${p.slug}` : ""}
                    {p.nav_order !== null ? " · in the menu" : ""}
                  </p>
                </div>
                <div className="flex shrink-0 gap-3 text-sm">
                  <Link
                    to={`/app/site?page=${encodeURIComponent(p.slug)}`}
                    className="text-moss underline underline-offset-2"
                  >
                    Edit
                  </Link>
                  {p.slug ? (
                    <Form method="post">
                      <input type="hidden" name="intent" value="delete" />
                      <input type="hidden" name="slug" value={p.slug} />
                      <button
                        type="submit"
                        className="text-clay underline underline-offset-2"
                        disabled={busy}
                      >
                        Delete
                      </button>
                    </Form>
                  ) : null}
                </div>
              </li>
            ))
          )}
        </ul>
      </section>

      <Card>
        <h2 className="font-display text-xl text-bark">Add a page</h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-soft">
          For anything the front page doesn't cover — your story, a volunteer page, where the
          money goes.
        </p>
        <Form method="post" className="mt-4 flex flex-wrap items-end gap-2">
          <input type="hidden" name="intent" value="new" />
          <div className="min-w-[10rem] flex-1">
            <label htmlFor="pageTitle" className="block text-sm font-medium text-bark">
              Title
            </label>
            <Input id="pageTitle" name="pageTitle" placeholder="About us" className="mt-1" />
          </div>
          <div className="min-w-[10rem] flex-1">
            <label htmlFor="pageSlug" className="block text-sm font-medium text-bark">
              Address
            </label>
            <Input id="pageSlug" name="pageSlug" placeholder="about" className="mt-1" spellCheck={false} />
          </div>
          <Button type="submit" variant="secondary" disabled={busy}>
            Create
          </Button>
        </Form>
      </Card>

      <p className="text-sm leading-relaxed text-slate-soft">
        Want your own domain instead of {host}/{slug}?{" "}
        <Link to="/app/domains" className="text-moss underline underline-offset-2">
          Point one at this shop
        </Link>
        .
      </p>
    </div>
  );
}

/**
 * The block editor.
 *
 * Deliberately a plain form rather than a drag-and-drop canvas. The people
 * using this are volunteers on a shared laptop, and a form that works with a
 * keyboard and survives a page reload beats a canvas that loses work.
 */
function PageEditor({
  slug,
  page,
  blocks: initial,
  busy,
  actionData,
  publicUrl,
}: {
  slug: string;
  page: { title: string; status: string; nav_order: number | null; nav_label: string | null; seo_description: string | null } | null;
  blocks: Block[];
  busy: boolean;
  actionData: unknown;
  publicUrl: string;
}) {
  const [blocks, setBlocks] = useState<Block[]>(initial);

  const update = (index: number, patch: Partial<Block>) =>
    setBlocks((list) => list.map((b, i) => (i === index ? { ...b, ...patch } : b)));

  const move = (index: number, by: number) =>
    setBlocks((list) => {
      const next = [...list];
      const target = index + by;
      if (target < 0 || target >= next.length) return list;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });

  const result = actionData as { ok?: string; error?: string } | null;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to="/app/site" className="text-sm text-moss underline underline-offset-2">
            ← All pages
          </Link>
          <h1 className="mt-2 font-display text-3xl text-bark">
            {slug === "" ? "Front page" : page?.title || slug}
          </h1>
          <p className="mt-1 text-sm text-slate-soft">{publicUrl}</p>
        </div>
        <a
          href={`/${publicUrl.split("/").slice(1).join("/")}`}
          target="_blank"
          rel="noreferrer"
          className="text-sm text-moss underline underline-offset-2"
        >
          See it
        </a>
      </header>

      {result?.ok ? <Notice tone="good">{result.ok}</Notice> : null}
      {result?.error ? <Notice tone="warn">{result.error}</Notice> : null}

      <Form method="post" className="space-y-5">
        <input type="hidden" name="intent" value="save" />
        <input type="hidden" name="slug" value={slug} />

        <Card>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="title" className="block text-sm font-medium text-bark">
                Page title
              </label>
              <Input
                id="title"
                name="title"
                defaultValue={page?.title ?? (slug === "" ? "Home" : slug)}
                className="mt-1"
              />
            </div>
            <div>
              <label htmlFor="navLabel" className="block text-sm font-medium text-bark">
                Menu label
              </label>
              <Input
                id="navLabel"
                name="navLabel"
                defaultValue={page?.nav_label ?? ""}
                placeholder="Leave blank to use the title"
                className="mt-1"
              />
            </div>
          </div>

          <div className="mt-4">
            <label htmlFor="seoDescription" className="block text-sm font-medium text-bark">
              What search engines show
            </label>
            <Input
              id="seoDescription"
              name="seoDescription"
              defaultValue={page?.seo_description ?? ""}
              placeholder="One sentence about this page"
              className="mt-1"
              maxLength={200}
            />
          </div>

          <div className="mt-4 space-y-2">
            <label className="flex gap-2 text-sm text-slate-soft">
              <input
                type="checkbox"
                name="publish"
                defaultChecked={page?.status === "published" || page === null}
                className="mt-0.5 accent-[#2F6F5E]"
              />
              <span>
                <span className="font-medium text-bark">Published.</span> Unticked, only you can
                see it.
              </span>
            </label>
            <label className="flex gap-2 text-sm text-slate-soft">
              <input
                type="checkbox"
                name="inNav"
                defaultChecked={page?.nav_order !== null && page !== null}
                className="mt-0.5 accent-[#2F6F5E]"
              />
              <span>Show in the menu</span>
            </label>
            <input type="hidden" name="navOrder" value={page?.nav_order ?? 10} />
          </div>
        </Card>

        <section className="space-y-3">
          {blocks.map((block, i) => {
            const spec = blockSpec(block.kind);
            if (!spec) return null;
            return (
              <Card key={`${block.kind}-${i}`}>
                <input type="hidden" name="blockKind" value={block.kind} />
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium text-bark">
                      {spec.label}
                      {spec.live ? (
                        <span className="ml-2 rounded-full bg-moss/10 px-2 py-0.5 text-xs text-moss">
                          fills itself in
                        </span>
                      ) : null}
                    </p>
                    <p className="mt-0.5 text-sm leading-relaxed text-slate-soft">
                      {spec.describes}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2 text-sm text-slate-soft">
                    <button type="button" onClick={() => move(i, -1)} aria-label="Move up">
                      ↑
                    </button>
                    <button type="button" onClick={() => move(i, 1)} aria-label="Move down">
                      ↓
                    </button>
                    <button
                      type="button"
                      onClick={() => setBlocks((l) => l.filter((_, j) => j !== i))}
                      className="text-clay"
                    >
                      Remove
                    </button>
                  </div>
                </div>

                <div className="mt-3 space-y-3">
                  {spec.fields.map((field) =>
                    field.long ? (
                      <textarea
                        key={field.key}
                        name={field.key === "heading" ? "blockHeading" : "blockBody"}
                        value={block[field.key]}
                        onChange={(e) => update(i, { [field.key]: e.target.value })}
                        placeholder={field.placeholder}
                        rows={4}
                        className="w-full rounded-xl border border-line bg-white px-3 py-2 leading-relaxed text-bark outline-none focus:border-moss"
                      />
                    ) : (
                      <Input
                        key={field.key}
                        name={field.key === "heading" ? "blockHeading" : "blockBody"}
                        value={block[field.key]}
                        onChange={(e) => update(i, { [field.key]: e.target.value })}
                        placeholder={field.placeholder}
                      />
                    )
                  )}
                  {/* Every block posts both fields, so the parallel arrays stay
                      aligned even when a block only shows one input. */}
                  {!spec.fields.some((f) => f.key === "heading") ? (
                    <input type="hidden" name="blockHeading" value={block.heading} />
                  ) : null}
                  {!spec.fields.some((f) => f.key === "body") ? (
                    <input type="hidden" name="blockBody" value={block.body} />
                  ) : null}
                </div>
              </Card>
            );
          })}

          {blocks.length === 0 ? (
            <p className="rounded-xl border border-dashed border-line bg-white/60 px-4 py-8 text-center text-sm text-slate-soft">
              Nothing on this page yet. Add a block below.
            </p>
          ) : null}
        </section>

        <Card>
          <h2 className="font-medium text-bark">Add a block</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {BLOCKS.map((spec) => (
              <button
                key={spec.kind}
                type="button"
                onClick={() =>
                  setBlocks((l) => [...l, { kind: spec.kind, heading: "", body: "" }])
                }
                className="rounded-lg border border-line bg-white px-3 py-1.5 text-sm text-bark hover:border-moss"
              >
                {spec.label}
                {spec.live ? <span className="ml-1 text-xs text-moss">·</span> : null}
              </button>
            ))}
          </div>
          <p className="mt-3 text-xs leading-relaxed text-slate-soft">
            Blocks marked with a dot read your records live — you never have to come back and
            update them.
          </p>
        </Card>

        <Button type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save this page"}
        </Button>
      </Form>
    </div>
  );
}
