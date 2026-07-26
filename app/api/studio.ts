/**
 * Studio endpoints — rendering an asset, and drafting copy.
 *
 * The asset endpoint returns SVG rather than a rendered bitmap. That keeps the
 * Worker free of a headless browser, and it means the preview a shop sees and
 * the file that prints are the same bytes rather than two renderings that might
 * disagree.
 */
import { Hono } from "hono";
import { getUser } from "../lib/auth";
import type { AppEnv } from "../lib/env";
import { LIMITS, rateLimit, recordAttempt } from "../lib/ratelimit";
import { ASSETS, renderAsset, type AssetKind } from "../lib/studio/assets";
import { gatherStudioContext } from "../lib/studio/facts";
import { draftCopy, type CopyPurpose } from "../lib/studio/copy";

type Ctx = { Bindings: AppEnv };

export const studio = new Hono<Ctx>();

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const KINDS = new Set<string>(ASSETS.map((a) => a.kind));

const COPY_PURPOSES = new Set<string>([
  "social_arrival",
  "donation_appeal",
  "volunteer_call",
  "sale_announcement",
  "shop_description",
]);

/**
 * Render one asset.
 *
 * A GET so the preview is cacheable by the browser and the SVG can be linked
 * to directly for download. Everything that varies is in the query string,
 * which is also what makes the preview and the download identical.
 */
studio.get("/api/studio/asset", async (c) => {
  const user = await getUser(c.req.raw, c.env.DB);
  if (!user) return json({ error: "Please sign in first." }, 401);

  const kind = c.req.query("kind") ?? "";
  if (!KINDS.has(kind)) return json({ error: "There's no asset by that name." }, 404);

  const { kit, facts } = await gatherStudioContext(c.env.DB, user.orgId, c.env.APP_URL ?? "");

  const rawIndex = parseInt(c.req.query("itemIndex") ?? "0", 10);
  const svg = renderAsset(kind as AssetKind, kit, facts, {
    tagColor: c.req.query("tagColor") || undefined,
    // Clamped rather than trusted: an out-of-range index would silently render
    // the "nothing to post about" fallback and look like a bug.
    itemIndex: Number.isFinite(rawIndex)
      ? Math.max(0, Math.min(rawIndex, Math.max(0, facts.arrivals.length - 1)))
      : 0,
    headline: c.req.query("headline")?.slice(0, 200) || undefined,
    body: c.req.query("body")?.slice(0, 400) || undefined,
  });

  const download = c.req.query("download") === "1";

  return new Response(svg, {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      // Private: this contains one shop's figures and belongs to nobody else.
      "Cache-Control": "private, max-age=30",
      ...(download
        ? { "Content-Disposition": `attachment; filename="${kind}.svg"` }
        : {}),
    },
  });
});

/**
 * Draft some copy.
 *
 * Rate-limited on the AI bucket, because this costs money per call and a
 * button somebody leans on is a bill. Returns drafts, or an honest reason
 * there are none — never an empty success that looks like a broken feature.
 */
studio.post("/api/studio/copy", async (c) => {
  const user = await getUser(c.req.raw, c.env.DB);
  if (!user) return json({ error: "Please sign in first." }, 401);

  const key = `studio-copy:${user.orgId}`;
  const limit = await rateLimit(c.env.KV, key, LIMITS.aiIntake);
  if (!limit.allowed) {
    return json(
      {
        drafts: [],
        message:
          "That's a lot of suggestions in a short time. Give it a minute — or just write it, which is usually quicker anyway.",
        retryAfter: limit.retryAfterSeconds,
      },
      429
    );
  }
  await recordAttempt(c.env.KV, key, LIMITS.aiIntake);

  const body = (await c.req.json().catch(() => null)) as {
    purpose?: string;
    itemIndex?: number;
  } | null;

  const purpose = body?.purpose ?? "";
  if (!COPY_PURPOSES.has(purpose)) {
    return json({ drafts: [], message: "We don't write that kind of copy." }, 400);
  }

  const { kit, facts } = await gatherStudioContext(c.env.DB, user.orgId, c.env.APP_URL ?? "");

  const result = await draftCopy(
    c.env,
    user.orgId,
    {
      purpose: purpose as CopyPurpose,
      kit,
      facts,
      itemIndex: Math.max(0, Math.round(body?.itemIndex ?? 0)),
    },
    user.id
  );

  return json(result);
});
