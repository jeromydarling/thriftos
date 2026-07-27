/**
 * Doing the tidy-up, once, for everybody who asks for it.
 *
 * The rule this file serves lives in `photos.ts`: enhance the photograph, never
 * the item. This file is the machinery — read the original, run the
 * deterministic chain, write a *second* object, and leave the review flag off.
 *
 * It exists as a library rather than as the body of an endpoint because two
 * callers need it: the JSON API and the screen a volunteer actually uses. Two
 * copies of "which R2 key, which column, which flag" is precisely the drift
 * that has bitten this codebase before.
 */
import { first, run } from "./db";
import { parseBrandKit, luminance } from "./brand";
import {
  ENHANCE_OUTPUT,
  SHADOW,
  cutoutTransform,
  enhanceTransform,
  enhancedKeyFor,
  imageBytes,
  seamlessFor,
  shadowTransform,
} from "./photos";
import type { AppEnv } from "./env";

/**
 * Build the finished square: seamless, shadow, item.
 *
 * Three passes over the same bytes, because `input()` consumes a stream and
 * this needs the cut-out twice — once blurred and blackened underneath, once
 * sharp on top. Cheap: the bytes are already in memory.
 *
 * Draw order is the whole trick. There is no "draw underneath", so the shadow
 * layer *is* the canvas — the silhouette blackened and blurred, then padded
 * onto the seamless. The real item goes over it, lifted by the drop, and the
 * gap between them is what reads as an object sitting on a surface.
 */
export function composeProductShot(
  env: AppEnv,
  bytes: ArrayBuffer,
  opts: {
    background: string;
    size?: number;
    padding?: number;
    shadow?: boolean;
    /** Overrides, for tuning against real photographs. */
    blur?: number;
    drop?: number;
    darkness?: number;
  }
): ImageTransformer {
  const chain = enhanceTransform({
    background: opts.background,
    size: opts.size,
    padding: opts.padding,
  });

  const place = {
    width: chain.width,
    height: chain.height,
    fit: chain.fit,
    background: chain.background,
    border: chain.border,
  };

  const sharp = () =>
    env.IMAGES.input(streamOf(bytes)).transform(cutoutTransform() as never);

  if (opts.shadow === false) {
    return sharp().transform(place as never);
  }

  const size = chain.width + chain.border.width * 2;
  const drop = Math.max(1, Math.round(size * (opts.drop ?? SHADOW.drop)));

  // The canvas: the item's own silhouette, blackened and softened, sitting on
  // the seamless. Chained rather than one transform so the blackening lands
  // before there is a background to blacken.
  const ground = sharp()
    .transform(shadowTransform(opts.blur, opts.darkness) as never)
    .transform(place as never);

  // The item, lifted off its shadow by the drop.
  return ground.draw(sharp().transform(place as never), {
    top: -drop,
    opacity: 1,
  });
}

/** A fresh stream over the same bytes. `input()` consumes what it's given. */
function streamOf(bytes: ArrayBuffer): ReadableStream {
  return new Response(bytes).body as ReadableStream;
}

export interface EnhanceResult {
  ok: boolean;
  /** Shown to a person, so written for one. */
  error?: string;
  /** HTTP status the API should use. Ignored by the screen. */
  status?: number;
  enhancedUrl?: string;
  originalUrl?: string;
}

/**
 * Make a product shot from an item's existing photograph.
 *
 * Degrades by saying so. If the binding isn't there or the transform fails, the
 * shop is told the tidy-up isn't available; it is never handed back the
 * original dressed up as an enhanced version, because then nobody would know
 * which listings had actually been cleaned up.
 */
export async function enhanceItemPhoto(
  env: AppEnv,
  orgId: string,
  itemId: string
): Promise<EnhanceResult> {
  const item = await first<{ id: string; photo_key: string | null }>(
    env.DB,
    `SELECT id, photo_key FROM items WHERE id = ? AND org_id = ?`,
    itemId,
    orgId
  );
  if (!item) return { ok: false, error: "We can't find that item.", status: 404 };
  if (!item.photo_key)
    return { ok: false, error: "There's no photo of this one to tidy up.", status: 400 };

  if (!env.IMAGES) {
    return { ok: false, error: "Photo tidy-up isn't switched on for this shop yet.", status: 503 };
  }

  const kitRow = await first<{ kit_json: string }>(
    env.DB,
    `SELECT kit_json FROM brand_kits WHERE org_id = ?`,
    orgId
  );
  const background = seamlessFor(parseBrandKit(kitRow?.kit_json).surface, luminance);

  const original = await env.MEDIA.get(item.photo_key);
  if (!original) return { ok: false, error: "The original photo has gone missing.", status: 404 };

  try {
    const { stream } = await imageBytes(original);
    const result = await env.IMAGES.input(stream)
      .transform(enhanceTransform({ background }))
      .output(ENHANCE_OUTPUT);

    // Buffered rather than streamed straight through: R2 wants a known length
    // too, and the transform's output stream doesn't carry one. A product shot
    // is a few hundred kilobytes, so there is nothing to be gained by being
    // clever about it.
    const cutout = await new Response(result.image()).arrayBuffer();

    const key = enhancedKeyFor(item.photo_key);
    await env.MEDIA.put(key, cutout, { httpMetadata: { contentType: "image/webp" } });

    // The key, but not the timestamp. Somebody still has to look at it.
    await run(
      env.DB,
      `UPDATE items SET photo_enhanced_key = ?, photo_enhanced_at = NULL, updated_at = datetime('now')
        WHERE id = ? AND org_id = ?`,
      key,
      item.id,
      orgId
    );

    return {
      ok: true,
      enhancedUrl: `/api/media/${key}`,
      originalUrl: `/api/media/${item.photo_key}`,
    };
  } catch (err) {
    console.warn("photo enhance failed:", err);
    return {
      ok: false,
      error:
        "That photo couldn't be tidied up — it may be an unusual format. The original is untouched and still on the listing.",
      status: 502,
    };
  }
}

/**
 * Keep, or throw away, an enhanced photo a person has now looked at.
 *
 * Throwing one away deletes the R2 object as well as clearing the column. An
 * orphaned cut-out nobody can reach is a bill with no benefit, and a bucket
 * full of them is how storage costs quietly become somebody's problem.
 */
export async function decideEnhancedPhoto(
  env: AppEnv,
  orgId: string,
  itemId: string,
  keep: boolean
): Promise<{ ok: boolean; error?: string; status?: number }> {
  const item = await first<{ photo_enhanced_key: string | null }>(
    env.DB,
    `SELECT photo_enhanced_key FROM items WHERE id = ? AND org_id = ?`,
    itemId,
    orgId
  );
  if (!item) return { ok: false, error: "We can't find that item.", status: 404 };
  if (!item.photo_enhanced_key) {
    return { ok: false, error: "There's no tidied-up photo waiting on that one.", status: 400 };
  }

  if (keep) {
    await run(
      env.DB,
      `UPDATE items SET photo_enhanced_at = datetime('now'), updated_at = datetime('now')
        WHERE id = ? AND org_id = ?`,
      itemId,
      orgId
    );
    return { ok: true };
  }

  await run(
    env.DB,
    `UPDATE items SET photo_enhanced_key = NULL, photo_enhanced_at = NULL,
            updated_at = datetime('now')
      WHERE id = ? AND org_id = ?`,
    itemId,
    orgId
  );
  // After the column, never before: a delete that succeeds against a row that
  // then fails to update would leave a listing pointing at nothing.
  await env.MEDIA.delete(item.photo_enhanced_key).catch(() => {});

  return { ok: true };
}
