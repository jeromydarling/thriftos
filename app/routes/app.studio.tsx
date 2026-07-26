import { useEffect, useMemo, useRef, useState } from "react";
import { Form, Link, useNavigation } from "react-router";
import type { Route } from "./+types/app.studio";
import { requireUser } from "../lib/auth";
import { envFrom } from "../lib/env";
import { first, run } from "../lib/db";
import {
  auditBrand,
  DEFAULT_BRAND,
  parseBrandKit,
  serialiseBrandKit,
  TYPEFACES,
  VOICES,
  type BrandKit,
  type TypefaceId,
  type VoiceId,
} from "../lib/brand";
import { ASSETS, type AssetKind } from "../lib/studio/assets";
import { assetReadiness, gatherStudioContext } from "../lib/studio/facts";
import { Button, Card, Input, Notice } from "../components/ui";

export function meta() {
  return [{ title: "Brand studio | ThriftOS" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = envFrom(context);
  const user = await requireUser(request, env.DB);

  const { kit, facts } = await gatherStudioContext(env.DB, user.orgId, env.APP_URL ?? "");

  return {
    kit,
    audit: auditBrand(kit),
    readiness: assetReadiness(facts),
    tagColors: facts.ladder.filter((r) => r.discountPct > 0).map((r) => r.tagColor),
    arrivals: facts.arrivals.slice(0, 8).map((a) => a.title),
    shopName: facts.name,
    siteUrl: facts.siteUrl,
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const env = envFrom(context);
  const user = await requireUser(request, env.DB);
  const form = await request.formData();

  if (String(form.get("intent")) !== "kit") {
    return { error: "That action isn't one we know." };
  }

  const existing = await first<{ kit_json: string }>(
    env.DB,
    `SELECT kit_json FROM brand_kits WHERE org_id = ?`,
    user.orgId
  );

  // Merged onto whatever is stored, so a partial form post can't wipe fields
  // that weren't on screen.
  const kit: BrandKit = {
    ...parseBrandKit(existing?.kit_json),
    primary: String(form.get("primary") ?? DEFAULT_BRAND.primary),
    accent: String(form.get("accent") ?? DEFAULT_BRAND.accent),
    ink: String(form.get("ink") ?? DEFAULT_BRAND.ink),
    surface: String(form.get("surface") ?? DEFAULT_BRAND.surface),
    typeface: String(form.get("typeface") ?? "warm") as TypefaceId,
    voice: String(form.get("voice") ?? "warm") as VoiceId,
    tagline: String(form.get("tagline") ?? ""),
    boilerplate: String(form.get("boilerplate") ?? ""),
  };

  // Re-parsed before storing, so an invalid colour typed into the hex box
  // becomes the previous value rather than breaking every asset.
  const clean = parseBrandKit(serialiseBrandKit(kit));

  await run(
    env.DB,
    `INSERT INTO brand_kits (org_id, kit_json, updated_by)
     VALUES (?, ?, ?)
     ON CONFLICT (org_id) DO UPDATE SET
       kit_json = excluded.kit_json, updated_by = excluded.updated_by,
       updated_at = datetime('now')`,
    user.orgId,
    serialiseBrandKit(clean),
    user.id
  );

  // The storefront reads these two directly, so they follow the kit.
  await run(
    env.DB,
    `UPDATE orgs SET brand_primary = ?, brand_accent = ?, updated_at = datetime('now')
      WHERE id = ?`,
    clean.primary,
    clean.accent,
    user.orgId
  );

  return { ok: true };
}

const VERDICT_TONE: Record<string, string> = {
  fails: "text-clay",
  "large-only": "text-amber-700",
  passes: "text-slate-soft",
  excellent: "text-moss",
};

export default function Studio({ loaderData, actionData }: Route.ComponentProps) {
  const { kit, audit, readiness, tagColors, arrivals, shopName, siteUrl } = loaderData;
  const nav = useNavigation();
  const busy = nav.state !== "idle";

  // Local so the previews move as the colour pickers move, without a round
  // trip. Saving is still an explicit act.
  const [draft, setDraft] = useState<BrandKit>(kit);
  useEffect(() => setDraft(kit), [kit]);

  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(kit),
    [draft, kit]
  );

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <header>
        <h1 className="font-display text-3xl text-bark">Brand studio</h1>
        <p className="mt-3 max-w-2xl leading-relaxed text-slate-soft">
          Your colours, your type, and signage that fills itself in from what the shop is
          actually doing. A sale sign made here says what's genuinely on offer today, because it
          reads the same markdown schedule the till does.
        </p>
      </header>

      {actionData && "ok" in actionData ? (
        <Notice tone="good">Saved. Every asset and your shop page now use these.</Notice>
      ) : null}
      {actionData && "error" in actionData && actionData.error ? (
        <Notice tone="warn">{actionData.error}</Notice>
      ) : null}

      <Form method="post" className="space-y-6">
        <input type="hidden" name="intent" value="kit" />

        <Card>
          <h2 className="font-display text-xl text-bark">Your colours</h2>
          <p className="mt-2 text-sm leading-relaxed text-slate-soft">
            Two colours is plenty. The accent should be used for one thing at a time — a price,
            a button, a stripe.
          </p>

          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <ColourField
              label="Primary"
              hint="Headings and your mark"
              name="primary"
              value={draft.primary}
              onChange={(primary) => setDraft({ ...draft, primary })}
            />
            <ColourField
              label="Accent"
              hint="Used sparingly"
              name="accent"
              value={draft.accent}
              onChange={(accent) => setDraft({ ...draft, accent })}
            />
            <ColourField
              label="Text"
              hint="Body copy"
              name="ink"
              value={draft.ink}
              onChange={(ink) => setDraft({ ...draft, ink })}
            />
            <ColourField
              label="Page"
              hint="Background"
              name="surface"
              value={draft.surface}
              onChange={(surface) => setDraft({ ...draft, surface })}
            />
          </div>

          <div className="mt-6 border-t border-line pt-5">
            <h3 className="font-medium text-bark">Can people read it?</h3>
            <p className="mt-1 text-sm leading-relaxed text-slate-soft">
              Checked as you go. You know what your own sign says — the people who'll struggle
              are the ones who don't, and in a charity shop that isn't a hypothetical audience.
            </p>
            <ul className="mt-3 space-y-2">
              {audit.map((row) => (
                <li key={row.label} className="flex flex-wrap items-baseline gap-x-3 text-sm">
                  <span className="font-medium text-bark">{row.label}</span>
                  <span className={VERDICT_TONE[row.check.verdict] ?? "text-slate-soft"}>
                    {row.check.advice}
                  </span>
                </li>
              ))}
            </ul>
            {dirty ? (
              <p className="mt-3 text-xs text-slate-soft">
                These checks update when you save.
              </p>
            ) : null}
          </div>
        </Card>

        <Card>
          <h2 className="font-display text-xl text-bark">Type</h2>
          <p className="mt-2 text-sm leading-relaxed text-slate-soft">
            Four pairings, not a font menu. All of them are fonts every computer already has, so
            a poster prints the same on the shop's machine as it looks here.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {TYPEFACES.map((face) => (
              <label
                key={face.id}
                className="flex cursor-pointer gap-3 rounded-xl border border-line bg-white p-4 hover:bg-linen has-[:checked]:border-moss"
              >
                <input
                  type="radio"
                  name="typeface"
                  value={face.id}
                  checked={draft.typeface === face.id}
                  onChange={() => setDraft({ ...draft, typeface: face.id })}
                  className="mt-1.5 accent-[#2F6F5E]"
                />
                <span className="min-w-0">
                  <span
                    className="block text-xl text-bark"
                    style={{ fontFamily: face.display }}
                  >
                    {shopName}
                  </span>
                  <span className="mt-1 block text-sm text-slate-soft" style={{ fontFamily: face.body }}>
                    {face.name} · {face.feels}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </Card>

        <Card>
          <h2 className="font-display text-xl text-bark">How you sound</h2>
          <p className="mt-2 text-sm leading-relaxed text-slate-soft">
            Steers the copy suggestions, and worth agreeing on anyway — a shop where three people
            write the newsletter sounds like three shops.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {VOICES.map((voice) => (
              <label
                key={voice.id}
                className="flex cursor-pointer gap-3 rounded-xl border border-line bg-white p-4 hover:bg-linen has-[:checked]:border-moss"
              >
                <input
                  type="radio"
                  name="voice"
                  value={voice.id}
                  checked={draft.voice === voice.id}
                  onChange={() => setDraft({ ...draft, voice: voice.id })}
                  className="mt-1.5 accent-[#2F6F5E]"
                />
                <span className="min-w-0">
                  <span className="block font-medium text-bark">{voice.name}</span>
                  <span className="mt-0.5 block text-sm text-slate-soft">{voice.describes}</span>
                </span>
              </label>
            ))}
          </div>

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="tagline" className="block text-sm font-medium text-bark">
                Tagline
              </label>
              <p className="mt-0.5 text-xs leading-relaxed text-slate-soft">
                What the shop actually does, not a slogan.
              </p>
              <Input
                id="tagline"
                name="tagline"
                value={draft.tagline}
                onChange={(e) => setDraft({ ...draft, tagline: e.target.value })}
                placeholder="Everything here has had one life already"
                className="mt-2"
                maxLength={120}
              />
            </div>
            <div>
              <label htmlFor="boilerplate" className="block text-sm font-medium text-bark">
                A standing line
              </label>
              <p className="mt-0.5 text-xs leading-relaxed text-slate-soft">
                Something you want on most things — a policy, a thank-you.
              </p>
              <Input
                id="boilerplate"
                name="boilerplate"
                value={draft.boilerplate}
                onChange={(e) => setDraft({ ...draft, boilerplate: e.target.value })}
                placeholder="All proceeds stay in this town"
                className="mt-2"
                maxLength={400}
              />
            </div>
          </div>
        </Card>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={busy || !dirty}>
            {busy ? "Saving…" : dirty ? "Save your brand" : "Saved"}
          </Button>
          {dirty ? (
            <button
              type="button"
              onClick={() => setDraft(kit)}
              className="text-sm text-slate-soft underline underline-offset-2"
            >
              Undo changes
            </button>
          ) : null}
        </div>
      </Form>

      <section className="border-t border-line pt-8">
        <h2 className="font-display text-2xl text-bark">Make something</h2>
        <p className="mt-2 max-w-2xl leading-relaxed text-slate-soft">
          Each of these fills itself in from your records. Nothing here invents a figure — if
          there's nothing to say yet, it says that instead of making something up.
        </p>

        <div className="mt-6 space-y-8">
          {(["print", "social", "counter"] as const).map((medium) => (
            <div key={medium}>
              <h3 className="font-display text-lg text-bark">
                {medium === "print"
                  ? "For the window and the wall"
                  : medium === "social"
                    ? "For posting"
                    : "For the counter"}
              </h3>
              <div className="mt-3 grid gap-4 sm:grid-cols-2">
                {ASSETS.filter((a) => a.medium === medium).map((asset) => (
                  <AssetCard
                    key={asset.kind}
                    kind={asset.kind}
                    label={asset.label}
                    purpose={asset.purpose}
                    blocked={readiness[asset.kind] ?? null}
                    tagColors={tagColors}
                    arrivals={arrivals}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="border-t border-line pt-8">
        <h2 className="font-display text-lg text-bark">Your shop's page</h2>
        <p className="mt-2 leading-relaxed text-slate-soft">
          Everything you set here is already live at{" "}
          <span className="font-medium text-bark">{siteUrl}</span>.{" "}
          <Link to="/app/site" className="text-moss underline underline-offset-2">
            Add pages and put your own words on it
          </Link>
          .
        </p>
      </section>
    </div>
  );
}

function ColourField({
  label,
  hint,
  name,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label htmlFor={name} className="block text-sm font-medium text-bark">
        {label}
      </label>
      <p className="mt-0.5 text-xs text-slate-soft">{hint}</p>
      <div className="mt-2 flex items-center gap-2">
        <input
          id={name}
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-10 w-12 cursor-pointer rounded-lg border border-line bg-white p-1"
          aria-label={`${label} colour`}
        />
        <input
          type="text"
          name={name}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-lg border border-line bg-white px-2 py-2 font-mono text-xs text-bark outline-none focus:border-moss"
          spellCheck={false}
        />
      </div>
    </div>
  );
}

/**
 * One asset, previewed live.
 *
 * The SVG is fetched from the server rather than built here, so what you see
 * is byte-for-byte what prints. Downloading as PNG happens in the browser via
 * canvas — no headless browser anywhere, and no dependency.
 */
function AssetCard({
  kind,
  label,
  purpose,
  blocked,
  tagColors,
  arrivals,
}: {
  kind: AssetKind;
  label: string;
  purpose: string;
  blocked: string | null;
  tagColors: string[];
  arrivals: string[];
}) {
  const [open, setOpen] = useState(false);
  const [svg, setSvg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [tagColor, setTagColor] = useState(tagColors[0] ?? "");
  const [itemIndex, setItemIndex] = useState(0);
  const [headline, setHeadline] = useState("");
  const [drafts, setDrafts] = useState<string[]>([]);
  const [draftNote, setDraftNote] = useState<string | null>(null);
  const [drafting, setDrafting] = useState(false);
  const holder = useRef<HTMLDivElement>(null);

  const query = useMemo(() => {
    const params = new URLSearchParams({ kind });
    if (tagColor) params.set("tagColor", tagColor);
    if (kind === "social_arrival") params.set("itemIndex", String(itemIndex));
    if (headline.trim()) params.set("headline", headline.trim());
    return params.toString();
  }, [kind, tagColor, itemIndex, headline]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);

    fetch(`/api/studio/asset?${query}`)
      .then((res) => (res.ok ? res.text() : Promise.reject(new Error(String(res.status)))))
      .then((text) => {
        if (!cancelled) setSvg(text);
      })
      .catch(() => {
        if (!cancelled) setSvg(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, query]);

  /** Rasterise the previewed SVG to PNG, in the browser, with no library. */
  async function downloadPng() {
    if (!svg) return;
    const node = holder.current?.querySelector("svg");
    if (!node) return;

    const width = Number(node.getAttribute("width") ?? 1080);
    const height = Number(node.getAttribute("height") ?? 1080);
    const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    try {
      const image = new Image();
      image.crossOrigin = "anonymous";
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error("could not read the preview"));
        image.src = url;
      });

      // Two-up, so a poster prints acceptably from the PNG as well.
      const canvas = document.createElement("canvas");
      canvas.width = width * 2;
      canvas.height = height * 2;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

      canvas.toBlob((png) => {
        if (!png) return;
        const link = document.createElement("a");
        link.href = URL.createObjectURL(png);
        link.download = `${kind}.png`;
        link.click();
        URL.revokeObjectURL(link.href);
      }, "image/png");
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function printIt() {
    if (!svg) return;
    const frame = window.open("", "_blank");
    if (!frame) return;
    frame.document.write(
      `<!doctype html><title>${label}</title><style>@page{margin:0}body{margin:0}svg{width:100%;height:auto;display:block}</style>${svg}`
    );
    frame.document.close();
    frame.focus();
    frame.print();
  }

  async function suggest(purposeKey: string) {
    setDrafting(true);
    setDraftNote(null);
    try {
      const res = await fetch("/api/studio/copy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ purpose: purposeKey, itemIndex }),
      });
      const data = (await res.json()) as {
        drafts?: { text: string }[];
        message?: string | null;
      };
      setDrafts((data.drafts ?? []).map((d) => d.text));
      setDraftNote(data.message ?? null);
    } catch {
      setDraftNote("Couldn't reach the suggestion service. Write it yourself — you'll do better.");
    } finally {
      setDrafting(false);
    }
  }

  const copyPurpose =
    kind === "social_arrival"
      ? "social_arrival"
      : kind === "donation_poster"
        ? "donation_appeal"
        : kind === "volunteer_call"
          ? "volunteer_call"
          : kind === "sale_sign"
            ? "sale_announcement"
            : null;

  return (
    <div className="rounded-2xl border border-line bg-white p-4">
      <h4 className="font-medium text-bark">{label}</h4>
      <p className="mt-1 text-sm leading-relaxed text-slate-soft">{purpose}</p>

      {blocked ? (
        <p className="mt-3 rounded-lg border border-line bg-linen px-3 py-2 text-xs leading-relaxed text-slate-soft">
          {blocked}
        </p>
      ) : null}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="mt-3 text-sm font-medium text-moss underline underline-offset-2"
      >
        {open ? "Close" : "Make one"}
      </button>

      {open ? (
        <div className="mt-4 space-y-3 border-t border-line pt-4">
          {kind === "sale_sign" && tagColors.length > 1 ? (
            <label className="block text-sm">
              <span className="text-bark">Which tag colour</span>
              <select
                value={tagColor}
                onChange={(e) => setTagColor(e.target.value)}
                className="mt-1 w-full rounded-lg border border-line bg-white px-2 py-2 text-sm"
              >
                {tagColors.map((c) => (
                  <option key={c} value={c}>
                    {c.charAt(0).toUpperCase() + c.slice(1)}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          {kind === "social_arrival" && arrivals.length > 1 ? (
            <label className="block text-sm">
              <span className="text-bark">Which item</span>
              <select
                value={itemIndex}
                onChange={(e) => setItemIndex(Number(e.target.value))}
                className="mt-1 w-full rounded-lg border border-line bg-white px-2 py-2 text-sm"
              >
                {arrivals.map((title, i) => (
                  <option key={title + i} value={i}>
                    {title}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <label className="block text-sm">
            <span className="text-bark">Your own headline</span>
            <input
              type="text"
              value={headline}
              onChange={(e) => setHeadline(e.target.value)}
              placeholder="Optional — leave blank for the default"
              className="mt-1 w-full rounded-lg border border-line bg-white px-2 py-2 text-sm outline-none focus:border-moss"
            />
          </label>

          {copyPurpose ? (
            <div>
              <button
                type="button"
                onClick={() => suggest(copyPurpose)}
                disabled={drafting}
                className="text-sm text-moss underline underline-offset-2 disabled:opacity-50"
              >
                {drafting ? "Thinking…" : "Suggest some wording"}
              </button>
              {draftNote ? (
                <p className="mt-2 text-xs leading-relaxed text-slate-soft">{draftNote}</p>
              ) : null}
              {drafts.length > 0 ? (
                <div className="mt-2 space-y-1.5">
                  <p className="text-xs text-slate-soft">
                    Drafts — read them before you use one. Nothing is saved until you do.
                  </p>
                  {drafts.map((text) => (
                    <button
                      key={text}
                      type="button"
                      onClick={() => setHeadline(text)}
                      className="block w-full rounded-lg border border-line bg-linen/60 px-3 py-2 text-left text-sm leading-relaxed text-bark hover:border-moss"
                    >
                      {text}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          <div
            ref={holder}
            className="overflow-hidden rounded-xl border border-line bg-linen/40 [&_svg]:h-auto [&_svg]:w-full"
            dangerouslySetInnerHTML={svg ? { __html: svg } : undefined}
          >
            {svg ? undefined : (
              <p className="px-3 py-10 text-center text-sm text-slate-soft">
                {loading ? "Drawing it…" : "Couldn't draw that just now."}
              </p>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={printIt}
              disabled={!svg}
              className="rounded-lg bg-moss px-3 py-1.5 text-sm font-medium text-white hover:bg-moss-deep disabled:opacity-50"
            >
              Print
            </button>
            <button
              type="button"
              onClick={downloadPng}
              disabled={!svg}
              className="rounded-lg border border-line px-3 py-1.5 text-sm text-bark hover:bg-linen disabled:opacity-50"
            >
              Download PNG
            </button>
            <a
              href={`/api/studio/asset?${query}&download=1`}
              className="rounded-lg border border-line px-3 py-1.5 text-sm text-bark hover:bg-linen"
            >
              Download SVG
            </a>
          </div>
        </div>
      ) : null}
    </div>
  );
}
