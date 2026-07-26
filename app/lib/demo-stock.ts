/**
 * Giving the demo shop photographs.
 *
 * The demo used to seed 260 items and not one picture, which made every screen
 * that exists to show photographs — the shop window, the photo bench, the
 * product feed — look broken rather than empty. A shop evaluating this would
 * conclude, reasonably, that the feature didn't work.
 *
 * So a dozen items carry real photographs: back-room snapshots on carpets and
 * cluttered worktops, drawn once and committed (see `app/content/demo-photos`).
 * They are the *input* to the cleanup, not a showcase of it — nothing here is
 * pre-tidied, because a demo whose "before" is already good demonstrates
 * nothing and a pre-drawn "after" would be a claim we hadn't earned.
 *
 * The bytes live in the client bundle and are copied into R2 on seed, which is
 * the only way to have them without a Cloudflare credential in the repository
 * or a manual upload step somebody has to remember.
 */
import { DEMO_PHOTOS, demoAssetPath, demoMediaKey } from "../content/demo-photos";
import { tagColorForIntake } from "./markdown";
import { newId } from "./ids";
import type { AppEnv } from "./env";

/**
 * Copy the bundled photographs into R2, once.
 *
 * Idempotent by key: an object already there is left alone, so this is cheap
 * on the weekly reseed and correct on a cold bucket. Deliberately not fatal —
 * a demo with eleven photographs instead of twelve is fine, a demo that fails
 * to seed because an image is missing is not.
 */
export async function copyDemoPhotos(env: AppEnv): Promise<Set<string>> {
  const present = new Set<string>();
  if (!env.ASSETS) return present;

  for (const photo of DEMO_PHOTOS) {
    const key = demoMediaKey(photo.id);

    try {
      if (await env.MEDIA.head(key)) {
        present.add(photo.id);
        continue;
      }

      // The host is arbitrary — the assets binding routes on path alone. It is
      // spelled out rather than borrowed from APP_URL so a wrong APP_URL, which
      // has broken this codebase once already, can't reach this.
      const res = await env.ASSETS.fetch(
        new Request(`https://assets.invalid/${demoAssetPath(photo.id)}`)
      );
      if (!res.ok) continue;

      // Buffered because R2 wants a known length and an asset response body
      // doesn't carry one — the same trap as the image transforms.
      const bytes = await res.arrayBuffer();
      if (bytes.byteLength === 0) continue;

      await env.MEDIA.put(key, bytes, { httpMetadata: { contentType: "image/jpeg" } });
      present.add(photo.id);
    } catch (err) {
      console.warn(`demo photo ${photo.id} not copied:`, err);
    }
  }

  return present;
}

/**
 * The window items: one per photograph, newest in the shop.
 *
 * Given the latest intake dates on purpose. The shop window shows the twelve
 * most recent items, and a demo where the photographed dozen sit on page four
 * is a demo of an empty-looking shop.
 *
 * Returned as statements rather than executed, so they join the seed's own
 * batch and the whole demo is still built in one pass.
 */
export function demoWindowStatements(
  db: D1Database,
  orgId: string,
  locationId: string,
  /** Ids whose bytes are actually in R2. Anything else is stock with no photo. */
  present: Set<string>
): D1PreparedStatement[] {
  const DAY = 86_400_000;
  const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * DAY).toISOString();
  const day = (daysAgo: number) => iso(daysAgo).slice(0, 10);

  return DEMO_PHOTOS.map((photo, i) => {
    // Spread across the last few days so the tag colours aren't all identical
    // — the window should show the ladder working, not one flat colour.
    const ageDays = i % 6;
    const intake = day(ageDays);

    return db
      .prepare(
        `INSERT INTO items (id, org_id, location_id, tag_number, title, description,
                            category, color, condition, price_cents, original_price_cents,
                            retail_estimate_cents, weight_lbs, tag_color, intake_date,
                            status, photo_key, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'available', ?, ?)`
      )
      .bind(
        newId("item"),
        orgId,
        locationId,
        `W${String(100 + i)}`,
        photo.title,
        photo.description,
        photo.category,
        photo.color,
        photo.condition,
        photo.priceCents,
        photo.priceCents,
        photo.retailCents,
        photo.weightLbs,
        tagColorForIntake(intake),
        intake,
        // A key only if the bytes are there. A listing pointing at a
        // photograph that doesn't exist is a broken image on the shop window,
        // which is the first thing anybody sees — worse than an item with no
        // picture, which is a thing every real shop has plenty of.
        present.has(photo.id) ? demoMediaKey(photo.id) : null,
        iso(ageDays)
      );
  });
}

export const DEMO_WINDOW_COUNT = DEMO_PHOTOS.length;
