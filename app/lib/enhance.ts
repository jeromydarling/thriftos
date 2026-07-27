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
  DEFAULT_GROUND,
  DEFAULT_STYLE,
  ENHANCE_OUTPUT,
  SEAMLESS,
  SHADOW,
  cutoutTransform,
  enhanceTransform,
  enhancedKeyFor,
  imageBytes,
  seamlessFor,
  shadowTransform,
  softenTransform,
  type Ground,
  type PhotoStyle,
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
    style?: PhotoStyle;
    background: string;
    size?: number;
    padding?: number;
    /** Overrides, for tuning against real photographs. */
    blur?: number;
    drop?: number;
    darkness?: number;
  }
): ImageTransformer {
  const style = opts.style ?? DEFAULT_STYLE;

  const chain = enhanceTransform({
    background: opts.background,
    size: opts.size,
    padding: opts.padding,
  });
  const size = chain.width + chain.border.width * 2;

  // The same source, opened again. `input()` consumes a stream, and every one
  // of these needs the photograph two or three times over. Cheap: the bytes
  // are already in memory.
  const open = () => env.IMAGES.input(streamOf(bytes));
  const cutout = () => open().transform(cutoutTransform() as never);

  const place = {
    width: chain.width,
    height: chain.height,
    fit: chain.fit,
    background: chain.background,
    border: chain.border,
  };

  if (style === "blur") {
    // Nothing is removed. The whole frame is pushed back, and the item —
    // segmented but *not* trimmed, so its position is untouched — is drawn
    // back over itself at full sharpness. The real shadow stays because the
    // real background stays.
    //
    // Both layers take the same square crop from the same source, which is
    // what makes them line up: crop after segmenting, never before.
    const square = { width: size, height: size, fit: "cover" };

    const backdrop = open()
      .transform(softenTransform(opts.blur) as never)
      .transform(square as never);

    const subject = open()
      .transform({ segment: "foreground" } as never)
      .transform(square as never);

    return backdrop.draw(subject);
  }

  if (style === "plain") {
    return cutout().transform(place as never);
  }

  // Shadow. Draw order is the whole trick: there is no "draw underneath", so
  // the shadow layer *is* the canvas — the silhouette greyed and blurred, then
  // padded onto the seamless. The item goes over it, lifted by the drop, and
  // the gap between them is what reads as an object sitting on a surface.
  const drop = Math.max(1, Math.round(size * (opts.drop ?? SHADOW.drop)));

  // Chained rather than one transform, so the greying lands before there is a
  // background to grey.
  const ground = cutout()
    .transform(shadowTransform(opts.blur, opts.darkness) as never)
    .transform(place as never);

  return ground.draw(cutout().transform(place as never), { top: -drop, opacity: 1 });
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
  itemId: string,
  choice: { style?: PhotoStyle; ground?: Ground } = {}
): Promise<EnhanceResult> {
  const style = choice.style ?? DEFAULT_STYLE;
  const ground = choice.ground ?? DEFAULT_GROUND;
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
  // A dark ground is an explicit choice and overrides the shop's surface; a
  // light one still defers to the brand, because a shop with a warm off-white
  // of its own should see its own.
  const background =
    ground === "dark"
      ? SEAMLESS.dark
      : seamlessFor(parseBrandKit(kitRow?.kit_json).surface, luminance);

  const original = await env.MEDIA.get(item.photo_key);
  if (!original) return { ok: false, error: "The original photo has gone missing.", status: 404 };

  try {
    const { bytes } = await imageBytes(original);
    const result = await composeProductShot(env, bytes, { style, background }).output(
      ENHANCE_OUTPUT
    );

    // Buffered rather than streamed straight through: R2 wants a known length
    // too, and the transform's output stream doesn't carry one. A product shot
    // is a few hundred kilobytes, so there is nothing to be gained by being
    // clever about it.
    const cutout = await new Response(result.image()).arrayBuffer();

    const key = enhancedKeyFor(item.photo_key);
    await env.MEDIA.put(key, cutout, { httpMetadata: { contentType: "image/webp" } });

    // The key, but not the timestamp. Somebody still has to look at it.
    // The choice is stored alongside the key so the bench can show what was
    // picked, and so re-running one keeps its style rather than silently
    // reverting to the default.
    await run(
      env.DB,
      `UPDATE items SET photo_enhanced_key = ?, photo_enhanced_at = NULL,
              photo_style = ?, photo_ground = ?, updated_at = datetime('now')
        WHERE id = ? AND org_id = ?`,
      key,
      style,
      ground,
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
