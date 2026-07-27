/**
 * Hono API — JSON, uploads, offline sync, and media.
 *
 * Mounted at /api/* inside the same Worker as the SSR app, so there is no CORS
 * to configure and no second deploy to keep in step.
 */
import { Hono } from "hono";
import { all, first, run } from "../lib/db";
import { newId, newToken } from "../lib/ids";
import { getUser } from "../lib/auth";
import { composeProductShot, decideEnhancedPhoto, enhanceItemPhoto } from "../lib/enhance";
import { ENHANCE_OUTPUT, SEAMLESS, imageBytes, isGround, seamlessFor } from "../lib/photos";
import { luminance } from "../lib/brand";
import { DEMO_PHOTOS, demoAssetPath } from "../content/demo-photos";
import { clientIp, LIMITS, rateLimit, recordAttempt } from "../lib/ratelimit";
import { extractItemFromPhoto, confidenceLabel } from "../lib/ai";
import { findOrCreateContact } from "../lib/contacts";
import { effectivePriceCents, DEFAULT_MARKDOWN_RULES } from "../lib/markdown";
import { suppress } from "../lib/email";
import { toCsv } from "../lib/impact";
import { buildExport, EXPORTS } from "../lib/export";
import { buildZip } from "../lib/zip";
import type { AppEnv } from "../lib/env";
import { scoreSpam } from "../lib/spam";
import { connect } from "./connect";
import { pos } from "./pos";
import { studio } from "./studio";
import { resolvePlanId } from "../lib/pricing";
import { can, getEntitlements, reasonUnavailable } from "../lib/entitlements";
import { quotePlatformFee, recordFeeAccrual } from "../lib/fees";
import { record, saleEntries } from "../lib/ledger";
import {
  applyInventoryEffect,
  initialStateForTender,
  isApproved,
  isOfflineEligible,
  reserveItems,
  type Tender,
} from "../lib/payments";

type Ctx = { Bindings: AppEnv };

export const api = new Hono<Ctx>();

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });

/* ─── Health ────────────────────────────────────────────────────────────── */

api.get("/api/health", async (c) => {
  const row = await first<{ n: number }>(c.env.DB, `SELECT 1 AS n`);
  return json({ ok: row?.n === 1, service: "thriftos", time: new Date().toISOString() });
});

/* ─── Media: R2 + on-the-fly resizing ───────────────────────────────────── */

api.get("/api/media/:key{.+}", async (c) => {
  const key = c.req.param("key");
  const width = parseInt(c.req.query("w") ?? "", 10);

  const object = await c.env.MEDIA.get(key);
  if (!object) return c.notFound();

  const headers = new Headers();
  headers.set("Cache-Control", "public, max-age=31536000, immutable");

  // Resize through the Images binding when a width is asked for; fall back to
  // the original if the binding isn't available or the transform fails.
  if (Number.isFinite(width) && width > 0 && width <= 2400 && c.env.IMAGES) {
    const { bytes, stream } = await imageBytes(object);
    try {
      const result = await c.env.IMAGES.input(stream)
        .transform({ width })
        .output({ format: "image/webp" });
      headers.set("Content-Type", "image/webp");
      return new Response(result.image(), { headers });
    } catch (err) {
      console.warn("image transform failed, serving original:", err);
      headers.set("Content-Type", object.httpMetadata?.contentType ?? "image/jpeg");
      return new Response(bytes, { headers });
    }
  }

  headers.set("Content-Type", object.httpMetadata?.contentType ?? "image/jpeg");
  return new Response(object.body, { headers });
});

/* ─── The help centre's before-and-after ────────────────────────────────── */

/**
 * The tidied version of one of the demo shop's snapshots.
 *
 * Computed, not drawn. The help centre shows a before and an after side by
 * side, and the after is produced here by the same `enhanceTransform` a real
 * shop's photographs go through — so the example can never claim something the
 * product doesn't do. A pair of committed screenshots would drift the first
 * time the transformation changed, and drift silently, which is the one thing
 * a page making a promise about honesty must not do.
 *
 * Public, because the help centre is. Safe because the id has to be one of the
 * dozen demo photographs by name: no path, no user input reaching R2, nothing
 * to traverse.
 */
api.get("/api/demo/tidied/:id", async (c) => {
  const id = c.req.param("id").replace(/\.(jpg|webp)$/, "");
  const photo = DEMO_PHOTOS.find((p) => p.id === id);
  if (!photo) return c.notFound();

  const asset = await c.env.ASSETS.fetch(
    new Request(`https://assets.invalid/${demoAssetPath(photo.id)}`)
  );
  if (!asset.ok) return c.notFound();

  // Variants, so the ground and the shadow can be judged on real photographs
  // rather than argued about. `?ground=dark` and `?shadow=off`.
  const ground = c.req.query("ground") ?? "light";
  const background = isGround(ground) ? SEAMLESS[ground] : seamlessFor("", luminance);
  // Opt-in while it is being judged, so the live help article keeps the
  // behaviour somebody has already looked at.
  const shadow = c.req.query("shadow") === "on";

  const headers = new Headers({
    // A year. The input is a committed file and the transformation is
    // deterministic, so the answer cannot change without a deploy.
    "Cache-Control": "public, max-age=31536000, immutable",
  });

  if (!c.env.IMAGES) {
    // Better the untidied original than a broken image: the page still reads,
    // and the caption still says which is which.
    headers.set("Content-Type", "image/jpeg");
    return new Response(await asset.arrayBuffer(), { headers });
  }

  try {
    const { bytes } = await imageBytes(asset);
    const num = (name: string) => {
      const v = Number.parseFloat(c.req.query(name) ?? "");
      return Number.isFinite(v) ? v : undefined;
    };
    const result = await composeProductShot(c.env, bytes, {
      background,
      shadow,
      blur: num("blur"),
      drop: num("drop"),
      darkness: num("dark"),
    }).output(ENHANCE_OUTPUT);
    headers.set("Content-Type", "image/webp");
    return new Response(result.image(), { headers });
  } catch (err) {
    console.warn("demo tidy-up failed:", err);
    return c.notFound();
  }
});

/* ─── Item intake: photo → R2 → Workers AI ──────────────────────────────── */

/**
 * Make a product shot out of a back-room snapshot.
 *
 * Writes a *second* object. The original is never replaced, and
 * `photo_enhanced_at` stays null until a person has looked at the result and
 * kept it — an unreviewed cut-out is a guess, and a guess about what a used
 * item looks like is not something to publish.
 *
 * Degrades by saying so. If the binding isn't there or the transform fails, the
 * shop is told the tidy-up isn't available; it is never handed back the
 * original dressed up as an enhanced version, because then nobody would know
 * which listings had actually been cleaned up.
 */
api.post("/api/items/:id/enhance", async (c) => {
  const user = await getUser(c.req.raw, c.env.DB);
  if (!user) return json({ error: "Please sign in first." }, 401);

  const limit = await rateLimit(c.env.KV, `enhance:${user.orgId}`, LIMITS.aiIntake);
  if (!limit.allowed) {
    return json(
      { error: "That's a lot at once. Give it a minute.", retryAfter: limit.retryAfterSeconds },
      429
    );
  }

  const result = await enhanceItemPhoto(c.env, user.orgId, c.req.param("id"));
  if (!result.ok) return json({ error: result.error }, (result.status ?? 500) as 400);

  return json({ enhancedUrl: result.enhancedUrl, originalUrl: result.originalUrl });
});

/** Keep, or throw away, an enhanced photo a person has now looked at. */
api.post("/api/items/:id/enhance/decide", async (c) => {
  const user = await getUser(c.req.raw, c.env.DB);
  if (!user) return json({ error: "Please sign in first." }, 401);

  const body = await c.req.json<{ keep?: boolean }>().catch(() => ({}) as { keep?: boolean });

  const result = await decideEnhancedPhoto(
    c.env,
    user.orgId,
    c.req.param("id"),
    body.keep === true
  );
  if (!result.ok) return json({ error: result.error }, (result.status ?? 500) as 400);

  return json({ ok: true });
});

api.post("/api/intake/photo", async (c) => {
  const user = await getUser(c.req.raw, c.env.DB);
  if (!user) return json({ error: "Please sign in first." }, 401);

  const limitKey = `ai:${user.orgId}`;
  const limit = await rateLimit(c.env.KV, limitKey, LIMITS.aiIntake);
  if (!limit.allowed) {
    return json(
      {
        error: "That's a lot of photos at once. Give it a minute and try again.",
        retryAfter: limit.retryAfterSeconds,
      },
      429
    );
  }
  await recordAttempt(c.env.KV, limitKey, LIMITS.aiIntake);

  // Photo intake is the discretionary half — it pauses when a shop is
  // suspended, unlike the register, which never does.
  const entitlements = await getEntitlements(c.env.DB, user.orgId);
  if (!can(entitlements, "ai_intake")) {
    return json(
      {
        error: reasonUnavailable(entitlements, "ai_intake"),
        // Not a dead end: intake by hand is unaffected and the photo is still
        // stored. Only the guess is paused.
        manualEntryStillWorks: true,
      },
      402
    );
  }

  const form = await c.req.formData();
  const file = form.get("photo");
  if (!(file instanceof File)) return json({ error: "No photo was attached." }, 400);
  if (file.size > 12_000_000) {
    return json({ error: "That photo is very large — try one under 12MB." }, 400);
  }

  const bytes = await file.arrayBuffer();
  const key = `orgs/${user.orgId}/items/${newId("item")}.jpg`;

  // Store the original first: even if AI is down, the photo is safely kept.
  await c.env.MEDIA.put(key, bytes, {
    httpMetadata: { contentType: file.type || "image/jpeg" },
  });

  const org = await first<{ plan: string }>(
    c.env.DB,
    `SELECT plan FROM orgs WHERE id = ?`,
    user.orgId
  );

  const extraction = await extractItemFromPhoto(c.env, {
    orgId: user.orgId,
    userId: user.id,
    plan: resolvePlanId(org?.plan ?? "volunteer"),
    image: bytes,
  });

  return json({
    photoKey: key,
    photoUrl: `/api/media/${key}`,
    // Always a suggestion. The form stays editable and nothing is saved yet.
    suggestion: extraction.data,
    confidence: extraction.data ? confidenceLabel(extraction.data.confidence) : null,
    degraded: extraction.degraded,
    message: extraction.message,
  });
});

/* ─── POS: offline queue sync ───────────────────────────────────────────── */

interface OfflineSale {
  offlineId: string;
  lines: {
    itemId?: string;
    title: string;
    priceCents: number;
    retailEstimateCents?: number;
    listPriceCents?: number;
  }[];
  subtotalCents: number;
  taxCents?: number;
  roundupCents?: number;
  totalCents: number;
  tender: string;
  taxExempt?: boolean;
  createdAt?: string;
}

/**
 * The register keeps selling when the network drops; queued sales replay here.
 * `offline_id` carries a unique index, so replaying the same queue twice — which
 * absolutely will happen — cannot double-charge or double-count a sale.
 */
api.post("/api/pos/sync", async (c) => {
  const user = await getUser(c.req.raw, c.env.DB);
  if (!user) return json({ error: "Please sign in first." }, 401);

  const body = (await c.req.json().catch(() => null)) as { sales?: OfflineSale[] } | null;
  const sales = body?.sales ?? [];
  if (!Array.isArray(sales) || sales.length === 0) return json({ synced: 0, duplicates: 0 });
  if (sales.length > 200) return json({ error: "Too many at once — sync in smaller batches." }, 400);

  // Attach these sales to whatever drawer is open, so the cash reconciliation
  // at close has something to add up. Sales rung up with no drawer open are
  // still recorded — they just won't appear in a variance, which is honest:
  // we don't know which drawer the money went into.
  const openDrawer = await first<{ id: string }>(
    c.env.DB,
    `SELECT id FROM register_shifts WHERE org_id = ? AND status = 'open'
      ORDER BY opened_at DESC LIMIT 1`,
    user.orgId
  );
  const openDrawerId = openDrawer?.id ?? null;

  let synced = 0;
  let duplicates = 0;
  // Returned so the register can offer the customer a receipt without a second
  // round trip — the moment to ask "would you like a receipt?" is while they're
  // still standing there.
  const receipts: { offlineId: string; transactionId: string; receiptUrl: string }[] = [];
  const conflicts: { offlineId: string; itemIds: string[] }[] = [];
  const rejected: { offlineId: string; reason: string }[] = [];

  for (const sale of sales) {
    if (!sale?.offlineId) continue;

    const already = await first<{ id: string }>(
      c.env.DB,
      `SELECT id FROM transactions WHERE org_id = ? AND offline_id = ?`,
      user.orgId,
      sale.offlineId
    );
    if (already) {
      duplicates++;
      continue;
    }

    const tender = (sale.tender || "cash") as Tender;
    const stripeConfigured = Boolean(c.env.STRIPE_SECRET_KEY);

    // A card-present payment cannot be authorised from a replayed browser
    // queue. Accepting one here would be recording money we never collected.
    if (!isOfflineEligible(tender, stripeConfigured)) {
      rejected.push({
        offlineId: sale.offlineId,
        reason:
          "Card-present payments can't be completed from the offline queue — they need the reader and a live connection.",
      });
      continue;
    }

    const txId = newId("transaction");
    const receiptToken = newToken(24);
    const createdAt = sale.createdAt ?? new Date().toISOString();
    const state = initialStateForTender(tender, { stripeConfigured });

    // Resolve the fee server-side. Nothing about it comes from the browser.
    const quote = await quotePlatformFee(c.env.DB, user.orgId, {
      merchandiseSubtotalCents: Math.round(sale.subtotalCents || 0),
      taxCents: Math.round(sale.taxCents || 0),
      roundUpCents: Math.round(sale.roundupCents || 0),
    });

    // Cash and other tenders carry no platform fee — no card, no Connect charge.
    const platformFee = tender === "cash" || tender === "other" ? 0 : quote.platformFeeCents;

    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO transactions
           (id, org_id, cashier_user_id, subtotal_cents, tax_cents, roundup_cents, total_cents,
            tender, tax_exempt, offline_id, synced_at, created_at,
            payment_state, fee_policy_id, platform_fee_bps, platform_fee_cents, fee_base_cents,
            shift_id, receipt_token)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        txId,
        user.orgId,
        user.id,
        Math.round(sale.subtotalCents || 0),
        Math.round(sale.taxCents || 0),
        Math.round(sale.roundupCents || 0),
        Math.round(sale.totalCents || 0),
        tender,
        sale.taxExempt ? 1 : 0,
        sale.offlineId,
        createdAt,
        state,
        quote.policy.feePolicyId,
        quote.policy.platformFeeBps,
        platformFee,
        quote.feeBaseCents,
        openDrawerId,
        receiptToken
      ),
      ...(sale.lines ?? []).map((line) =>
        c.env.DB.prepare(
          `INSERT INTO transaction_items
             (id, org_id, transaction_id, item_id, title, price_cents, markdown_cents,
              retail_estimate_cents)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          newId("txItem"),
          user.orgId,
          txId,
          line.itemId ?? null,
          line.title || "Item",
          Math.round(line.priceCents || 0),
          // What the colour tag took off. Absent on a manually-priced line,
          // which is honest — nobody knows what it "should" have cost.
          Math.max(0, Math.round((line.listPriceCents ?? 0) - (line.priceCents || 0))),
          Math.round(line.retailEstimateCents || 0)
        )
      ),
    ]);

    // Reserve first, then let the payment state decide what happens next.
    // The conditional UPDATE inside reserveItems is what stops two registers
    // selling the same one-of-a-kind item.
    const itemIds = (sale.lines ?? [])
      .map((l) => l.itemId)
      .filter((id): id is string => Boolean(id));

    const reservation = await reserveItems(c.env.DB, user.orgId, txId, itemIds);

    if (reservation.unavailable.length > 0) {
      conflicts.push({ offlineId: sale.offlineId, itemIds: reservation.unavailable });

      // The customer paid, so the sale stands — but we couldn't hand over this
      // item, because another register got it first. Mark the line so the books
      // show one item sold and one line a person needs to sort out, rather than
      // two sales of something that only existed once.
      for (const itemId of reservation.unavailable) {
        await run(
          c.env.DB,
          `UPDATE transaction_items
              SET fulfillment_state = 'unfulfilled',
                  fulfillment_note = 'Another sale reserved this item first'
            WHERE transaction_id = ? AND org_id = ? AND item_id = ?`,
          txId,
          user.orgId,
          itemId
        );
      }
    }

    // Inventory only moves to sold if the payment is genuinely approved.
    await applyInventoryEffect(c.env.DB, user.orgId, txId, state, createdAt);

    if (platformFee > 0 && isApproved(state)) {
      await recordFeeAccrual(
        c.env.DB,
        user.orgId,
        platformFee,
        quote.policy.maximumFeeCents
      );
    }

    // The books, for anything that actually took money. A cash sale completes
    // the moment it's rung up, so it posts here; a card sale posts from the
    // webhook once Stripe confirms it, which is why this is guarded on the
    // payment state rather than simply running for every synced sale.
    if (isApproved(state)) {
      for (const entry of saleEntries({
        orgId: user.orgId,
        transactionId: txId,
        shiftId: openDrawerId,
        subtotalCents: Math.round(sale.subtotalCents || 0),
        taxCents: Math.round(sale.taxCents || 0),
        roundUpCents: Math.round(sale.roundupCents || 0),
        platformFeeCents: platformFee,
        tender,
        occurredAt: createdAt,
      })) {
        await record(c.env.DB, entry);
      }
    }

    receipts.push({
      offlineId: sale.offlineId,
      transactionId: txId,
      receiptUrl: `/r/${receiptToken}`,
    });
    synced++;
  }

  const unresolved = await first<{ n: number }>(
    c.env.DB,
    `SELECT COUNT(*) AS n FROM transaction_items
      WHERE org_id = ? AND fulfillment_state = 'unfulfilled'`,
    user.orgId
  );

  return json({
    synced,
    duplicates,
    receipts,
    conflicts,
    rejected,
    unfulfilled: Number(unresolved?.n ?? 0),
  });
});

/** Item lookup for the register — by tag number or id, with markdown applied. */
api.get("/api/pos/lookup", async (c) => {
  const user = await getUser(c.req.raw, c.env.DB);
  if (!user) return json({ error: "Please sign in first." }, 401);

  const q = (c.req.query("q") ?? "").trim();
  if (!q) return json({ items: [] });

  const rows = await all<{
    id: string;
    title: string;
    tag_number: string | null;
    price_cents: number;
    retail_estimate_cents: number;
    tag_color: string | null;
    intake_date: string;
    category: string | null;
  }>(
    c.env.DB,
    `SELECT id, title, tag_number, price_cents, retail_estimate_cents, tag_color, intake_date, category
       FROM items
      WHERE org_id = ? AND status = 'available' AND (tag_number = ? OR id = ? OR title LIKE ?)
      LIMIT 20`,
    user.orgId,
    q,
    q,
    `%${q}%`
  );

  const rules = await all<{ tag_color: string; discount_pct: number; age_days: number }>(
    c.env.DB,
    `SELECT tag_color, discount_pct, age_days FROM markdown_rules WHERE org_id = ? AND is_active = 1`,
    user.orgId
  );
  const markdownRules = rules.length
    ? rules.map((r) => ({
        tagColor: r.tag_color,
        weekIndex: 0,
        discountPct: r.discount_pct,
        ageDays: r.age_days,
      }))
    : DEFAULT_MARKDOWN_RULES;

  return json({
    items: rows.map((row) => ({
      id: row.id,
      title: row.title,
      tagNumber: row.tag_number,
      category: row.category,
      tagColor: row.tag_color,
      listPriceCents: row.price_cents,
      priceCents: effectivePriceCents(
        { priceCents: row.price_cents, tagColor: row.tag_color, intakeDate: row.intake_date },
        markdownRules
      ),
      retailEstimateCents: row.retail_estimate_cents,
    })),
  });
});

/* ─── Impact export ─────────────────────────────────────────────────────── */

/**
 * Grant and board reporting, as a file.
 *
 * This lives here rather than on the impact page's loader on purpose: in
 * framework mode a returned Response is treated as loader data and a thrown 2xx
 * lands in the error boundary, so neither delivers a download. A resource
 * endpoint is the shape that actually works.
 */
api.get("/api/impact.csv", async (c) => {
  const user = await getUser(c.req.raw, c.env.DB);
  if (!user) return json({ error: "Please sign in first." }, 401);

  const months = await all<{
    period_start: string;
    diversion_lbs: number;
    items_rehomed: number;
    value_delivered_cents: number;
    volunteer_hours: number;
    revenue_cents: number;
    donations_received: number;
  }>(
    c.env.DB,
    `SELECT period_start, diversion_lbs, items_rehomed, value_delivered_cents,
            volunteer_hours, revenue_cents, donations_received
       FROM impact_metrics
      WHERE org_id = ? AND period_kind = 'month'
      ORDER BY period_start DESC LIMIT 120`,
    user.orgId
  );

  const csv = toCsv(
    months.map((m) => ({
      month: m.period_start.slice(0, 7),
      diversion_lbs: Math.round(m.diversion_lbs),
      items_rehomed: m.items_rehomed,
      value_delivered_usd: (m.value_delivered_cents / 100).toFixed(2),
      volunteer_hours: Math.round(m.volunteer_hours),
      donations_received: m.donations_received,
      revenue_usd: (m.revenue_cents / 100).toFixed(2),
    }))
  );

  return new Response(csv || "month\r\n", {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="impact-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
});

/* ─── Data export ───────────────────────────────────────────────────────── */

/**
 * Take everything and go.
 *
 * Always available, deliberately — including to a shop whose card has failed.
 * "No lock-in" is the loudest claim this product makes, and a billing state
 * that blocks the exit would make it a lie.
 */
api.get("/api/export/:kind", async (c) => {
  const user = await getUser(c.req.raw, c.env.DB);
  if (!user) return json({ error: "Please sign in first." }, 401);

  const kind = c.req.param("kind");
  const stamp = new Date().toISOString().slice(0, 10);

  // The whole archive.
  if (kind === "all") {
    const files = await Promise.all(
      EXPORTS.map(async (spec) => ({
        name: spec.filename,
        content: await buildExport(c.env.DB, user.orgId, spec.kind),
      }))
    );

    files.push({
      name: "README.txt",
      content:
        `Export from ThriftOS for ${user.orgName}\n` +
        `Taken ${new Date().toISOString()}\n\n` +
        `Every file is CSV with a header row. Money appears twice: as integer\n` +
        `cents (exact) and as dollars with two decimals (readable). Where the\n` +
        `two disagree, the cents are right.\n\n` +
        `Sample data is not included — it was never yours.\n\n` +
        EXPORTS.map((s) => `${s.filename.padEnd(24)} ${s.description}`).join("\n") +
        `\n`,
    });

    // Sliced to a plain ArrayBuffer: a Uint8Array view isn't a BodyInit.
    const zip = buildZip(files);
    const body = zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength) as ArrayBuffer;
    return new Response(body, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="thriftos-export-${stamp}.zip"`,
      },
    });
  }

  const spec = EXPORTS.find((e) => e.kind === kind);
  if (!spec) return json({ error: "There's no export by that name." }, 404);

  const csv = await buildExport(c.env.DB, user.orgId, spec.kind);
  return new Response(csv || "\r\n", {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${spec.filename.replace(".csv", "")}-${stamp}.csv"`,
    },
  });
});

/* ─── NRI ───────────────────────────────────────────────────────────────── */

/** Dismissing is a human override, recorded as one. Nothing is deleted. */
api.post("/api/nri/signals/:id/dismiss", async (c) => {
  const user = await getUser(c.req.raw, c.env.DB);
  if (!user) return json({ error: "Please sign in first." }, 401);

  await run(
    c.env.DB,
    `UPDATE nri_signals SET dismissed_at = datetime('now'), dismissed_by = ?
      WHERE id = ? AND org_id = ? AND dismissed_at IS NULL`,
    user.id,
    c.req.param("id"),
    user.orgId
  );

  return json({ ok: true });
});

/* ─── Public contact form ───────────────────────────────────────────────── */

/**
 * Layered defenses. Spam is accepted with the same cheerful "thanks!" and then
 * dropped — a bot that gets an error learns how to get past you next time.
 */
api.post("/api/contact", async (c) => {
  const ip = clientIp(c.req.raw);
  const limit = await rateLimit(c.env.KV, `contact:${ip}`, LIMITS.publicForm);
  await recordAttempt(c.env.KV, `contact:${ip}`, LIMITS.publicForm);

  const form = await c.req.formData();
  const name = String(form.get("name") ?? "").trim();
  const email = String(form.get("email") ?? "").trim();
  const message = String(form.get("message") ?? "").trim();
  const honeypot = String(form.get("company_website") ?? "");
  const renderedAt = parseInt(String(form.get("rendered_at") ?? ""), 10);

  const verdict = scoreSpam({ name, email, message, honeypot, renderedAt, now: Date.now() });

  if (!limit.allowed || verdict.isSpam) {
    console.info("contact form dropped:", verdict.reasons.join(", ") || "rate limited");
    return json({ ok: true, message: "Thanks — we'll be in touch." });
  }

  if (!name || !email || !message) {
    return json({ error: "We need your name, a real email, and a message. That's all." }, 400);
  }

  console.info("contact form:", { name, email, message: message.slice(0, 500) });
  return json({ ok: true, message: "Thanks — we'll be in touch." });
});

/* ─── One-click unsubscribe ─────────────────────────────────────────────── */

api.get("/api/unsubscribe", async (c) => {
  const orgId = c.req.query("org");
  const email = c.req.query("email");
  if (!orgId || !email) return c.text("That link looks incomplete.", 400);

  await suppress(c.env.DB, orgId, email);
  await run(
    c.env.DB,
    `UPDATE contacts SET is_subscribed = 0 WHERE org_id = ? AND email = ?`,
    orgId,
    email.toLowerCase()
  );

  return c.html(
    `<div style="font-family:system-ui;max-width:480px;margin:80px auto;text-align:center;line-height:1.6">
       <h1 style="font-size:20px">You're unsubscribed.</h1>
       <p style="color:#555">We won't email you again. No hard feelings — thanks for everything.</p>
     </div>`
  );
});

/* ─── Versioned REST ────────────────────────────────────────────────────── */

api.get("/api/v1/items", async (c) => {
  const user = await getUser(c.req.raw, c.env.DB);
  if (!user) return json({ error: "Please sign in first." }, 401);

  const limit = Math.min(100, parseInt(c.req.query("limit") ?? "50", 10) || 50);
  const since = c.req.query("since");

  const rows = await all(
    c.env.DB,
    `SELECT id, title, category, brand, color, size, condition, price_cents, tag_color,
            intake_date, status, updated_at
       FROM items
      WHERE org_id = ? ${since ? "AND updated_at > ?" : ""}
      ORDER BY updated_at DESC
      LIMIT ?`,
    ...(since ? [user.orgId, since, limit] : [user.orgId, limit])
  );

  return json({ items: rows, count: rows.length });
});

// Connect onboarding and the Stripe webhook. Mounted before the catch-all.
api.route("/", connect);
// Register: card-present payments, refunds, and the cash drawer.
api.route("/", pos);
// Brand studio: asset rendering and copy drafts.
api.route("/", studio);

api.all("/api/*", (c) => json({ error: "Not found" }, 404));
