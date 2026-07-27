/**
 * Register API — card-present payments, refunds, and the cash drawer.
 *
 * Every monetary value in this file is computed server-side from records the
 * browser cannot influence. The register sends item ids and a tender; it never
 * sends a price, a subtotal, or a fee, and anything resembling one that arrives
 * in a request body is ignored. That is the single rule this file exists to
 * enforce, and it's why the cart is re-priced here from the items table rather
 * than trusted from the client.
 */
import { Hono } from "hono";
import { bindLog, newRequestId } from "../lib/log";
import { LIMITS, rateLimit, recordAttempt } from "../lib/ratelimit";
import { all, first, run } from "../lib/db";
import { getUser, roleAtLeast } from "../lib/auth";
import { newId, newToken } from "../lib/ids";
import type { AppEnv } from "../lib/env";
import { StripeError, stripeConfigFrom } from "../lib/stripe/client";
import { assertRealShop, DemoChargeRefused } from "../lib/demo-guard";
import {
  cancelPaymentIntent,
  cancelReaderAction,
  createCardPresentIntent,
  getPaymentIntent,
  orgReaders,
  presentTestPaymentMethod,
  processOnReader,
  stateForIntent,
  syncReader,
} from "../lib/stripe/terminal";
import { advanceAttempt, openAttempt, attemptsForTransaction } from "../lib/attempts";
import { applyInventoryEffect, reserveItems } from "../lib/payments";
import { quotePlatformFee } from "../lib/fees";
import { canAcceptPayments, getAccount } from "../lib/stripe/connect";
import { effectivePriceCents, DEFAULT_MARKDOWN_RULES } from "../lib/markdown";
import { parseOrgSettings, taxCentsFor } from "../lib/settings";
import { planRefund, refundSale, RefundError, openDisputes } from "../lib/refunds";
import {
  closeShift,
  ensureDefaultRegister,
  openShift,
  openShiftFor,
  recordCashMovement,
  shiftTotals,
  ShiftAlreadyOpenError,
} from "../lib/shifts-cash";

type Ctx = { Bindings: AppEnv };

export const pos = new Hono<Ctx>();

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });

async function auth(c: { req: { raw: Request }; env: AppEnv }) {
  const user = await getUser(c.req.raw, c.env.DB);
  if (!user) return { error: json({ error: "Please sign in first." }, 401), user: null };
  return { error: null, user };
}

/**
 * Auth, plus a ceiling on how fast one shop can move money.
 *
 * Not because a thrift store will hammer this — a busy Saturday is a few
 * hundred sales — but because a runaway retry loop in a browser tab left open
 * on a counter can, and a loop that creates PaymentIntents is a loop that
 * costs somebody money.
 */
async function authLimited(
  c: { req: { raw: Request }; env: AppEnv },
  bucket: keyof typeof LIMITS = "api"
) {
  const { error, user } = await auth(c);
  if (error) return { error, user: null };

  const key = `money:${user!.orgId}`;
  const limit = await rateLimit(c.env.KV, key, LIMITS[bucket]);
  if (!limit.allowed) {
    return {
      error: json(
        {
          error:
            "That's a lot of requests very quickly. Give it a moment — if this keeps happening, something is stuck in a loop rather than you being fast.",
          retryAfter: limit.retryAfterSeconds,
        },
        429
      ),
      user: null,
    };
  }
  await recordAttempt(c.env.KV, key, LIMITS[bucket]);
  return { error: null, user };
}

/** Kept as a local alias so the many call sites below stay short. */
const config = stripeConfigFrom;

/* ─── Server-side cart pricing ──────────────────────────────────────────── */

export interface PricedCart {
  lines: {
    itemId: string;
    title: string;
    priceCents: number;
    markdownCents: number;
    retailEstimateCents: number;
  }[];
  subtotalCents: number;
  taxCents: number;
  roundUpCents: number;
  totalCents: number;
  missing: string[];
}

/**
 * Price a cart from the database.
 *
 * The client sends item ids and nothing else that costs money. Prices, the
 * markdown currently in force, and tax are all derived here — so a modified
 * request body buys nothing at a discount, and a stale price on a tablet that
 * has been open since this morning can't undercharge.
 */
export async function priceCart(
  db: D1Database,
  orgId: string,
  itemIds: string[],
  opts: { roundUpCents?: number; taxExempt?: boolean } = {}
): Promise<PricedCart> {
  const unique = [...new Set(itemIds.filter(Boolean))];
  if (unique.length === 0) {
    return {
      lines: [],
      subtotalCents: 0,
      taxCents: 0,
      roundUpCents: 0,
      totalCents: 0,
      missing: [],
    };
  }

  const placeholders = unique.map(() => "?").join(",");
  const [items, rules, org] = await Promise.all([
    all<{
      id: string;
      title: string;
      price_cents: number;
      retail_estimate_cents: number;
      tag_color: string | null;
      intake_date: string;
      status: string;
    }>(
      db,
      `SELECT id, title, price_cents, retail_estimate_cents, tag_color, intake_date, status
         FROM items WHERE org_id = ? AND id IN (${placeholders})`,
      orgId,
      ...unique
    ),
    all<{ tag_color: string; discount_pct: number; age_days: number }>(
      db,
      `SELECT tag_color, discount_pct, age_days FROM markdown_rules
        WHERE org_id = ? AND is_active = 1`,
      orgId
    ),
    first<{ settings_json: string }>(db, `SELECT settings_json FROM orgs WHERE id = ?`, orgId),
  ]);

  const ladder = rules.length > 0
    ? rules.map((r) => ({
        tagColor: r.tag_color,
        discountPct: r.discount_pct,
        ageDays: r.age_days,
        weekIndex: 0,
      }))
    : DEFAULT_MARKDOWN_RULES;

  const found = new Map(items.map((i) => [i.id, i]));
  const missing = unique.filter((id) => {
    const item = found.get(id);
    // Anything not available can't be sold — it's gone, held by another
    // register, or pulled. Reported rather than silently dropped.
    return !item || (item.status !== "available" && item.status !== "held");
  });

  const lines = items
    .filter((i) => !missing.includes(i.id))
    .map((item) => {
      const price = effectivePriceCents(
        {
          priceCents: item.price_cents,
          tagColor: item.tag_color,
          intakeDate: item.intake_date,
        },
        ladder
      );
      return {
        itemId: item.id,
        title: item.title,
        priceCents: price,
        markdownCents: Math.max(0, item.price_cents - price),
        retailEstimateCents: item.retail_estimate_cents,
      };
    });

  const subtotal = lines.reduce((sum, l) => sum + l.priceCents, 0);

  // Through the shared parser, so this and the register cannot read different
  // keys. They did once: this pricer read `taxBps` while settings wrote
  // `taxRateBps`, and every card payment charged no tax at all.
  const settings = parseOrgSettings(org?.settings_json);
  const taxCents = taxCentsFor(subtotal, settings, opts.taxExempt);
  // A round-up is a donation the customer chose. Clamped to something sane so a
  // fat finger can't turn a $4 sale into a $400 one.
  const roundUp = Math.max(0, Math.min(Math.round(opts.roundUpCents ?? 0), 100_00));

  return {
    lines,
    subtotalCents: subtotal,
    taxCents,
    roundUpCents: roundUp,
    totalCents: subtotal + taxCents + roundUp,
    missing,
  };
}

/** Quote a cart, so the register can show a total it didn't invent. */
pos.post("/api/pos/quote", async (c) => {
  const { error, user } = await auth(c);
  if (error) return error;

  const body = (await c.req.json().catch(() => null)) as {
    itemIds?: string[];
    roundUpCents?: number;
    taxExempt?: boolean;
  } | null;

  const cart = await priceCart(c.env.DB, user!.orgId, body?.itemIds ?? [], {
    roundUpCents: body?.roundUpCents,
    taxExempt: body?.taxExempt,
  });

  const quote = await quotePlatformFee(c.env.DB, user!.orgId, {
    merchandiseSubtotalCents: cart.subtotalCents,
    taxCents: cart.taxCents,
    roundUpCents: cart.roundUpCents,
  });

  return json({
    ...cart,
    platformFeeCents: quote.platformFeeCents,
    feeBaseCents: quote.feeBaseCents,
  });
});

/* ─── Terminal payments ─────────────────────────────────────────────────── */

/**
 * Start a card-present payment.
 *
 * Creates the transaction, reserves the items, opens an attempt, creates the
 * PaymentIntent, and hands it to the reader. It does not conclude anything —
 * the customer has not tapped yet. Completion arrives by webhook, and the items
 * stay reserved rather than sold until it does.
 */
pos.post("/api/pos/terminal/pay", async (c) => {
  const { error, user } = await authLimited(c);
  if (error) return error;

  if (!c.env.STRIPE_SECRET_KEY) {
    return json(
      { error: "Card payments aren't switched on yet. Cash still works." },
      503
    );
  }

  const account = await getAccount(c.env.DB, user!.orgId);
  if (!account || !canAcceptPayments(account)) {
    return json(
      {
        error:
          "This shop can't take card payments yet — payment setup isn't finished. Cash still works.",
      },
      409
    );
  }

  const body = (await c.req.json().catch(() => null)) as {
    itemIds?: string[];
    readerId?: string;
    roundUpCents?: number;
    taxExempt?: boolean;
    shiftId?: string | null;
  } | null;

  if (!body?.readerId) return json({ error: "Choose a reader first." }, 400);

  const reader = await first<{ stripe_reader_id: string; status: string; is_simulated: number }>(
    c.env.DB,
    `SELECT stripe_reader_id, status, is_simulated FROM terminal_readers
      WHERE org_id = ? AND id = ?`,
    user!.orgId,
    body.readerId
  );
  if (!reader) return json({ error: "That reader isn't paired with this shop." }, 404);

  const cart = await priceCart(c.env.DB, user!.orgId, body.itemIds ?? [], {
    roundUpCents: body.roundUpCents,
    taxExempt: body.taxExempt,
  });

  if (cart.lines.length === 0) {
    return json({ error: "There's nothing in the cart to charge for.", missing: cart.missing }, 400);
  }
  if (cart.missing.length > 0) {
    return json(
      {
        error: "Some of these have already gone. Take them off the sale and try again.",
        missing: cart.missing,
      },
      409
    );
  }

  const quote = await quotePlatformFee(c.env.DB, user!.orgId, {
    merchandiseSubtotalCents: cart.subtotalCents,
    taxCents: cart.taxCents,
    roundUpCents: cart.roundUpCents,
  });

  const txId = newId("transaction");
  await run(
    c.env.DB,
    `INSERT INTO transactions
       (id, org_id, cashier_user_id, shift_id, subtotal_cents, tax_cents, roundup_cents,
        total_cents, tender, tax_exempt, payment_state, fee_policy_id, platform_fee_bps,
        platform_fee_cents, fee_base_cents, receipt_token)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'terminal', ?, 'draft', ?, ?, ?, ?, ?)`,
    txId,
    user!.orgId,
    user!.id,
    body.shiftId ?? null,
    cart.subtotalCents,
    cart.taxCents,
    cart.roundUpCents,
    cart.totalCents,
    body.taxExempt ? 1 : 0,
    quote.policy.feePolicyId,
    quote.policy.platformFeeBps,
    quote.platformFeeCents,
    quote.feeBaseCents,
    newToken(24)
  );

  await c.env.DB.batch(
    cart.lines.map((line) =>
      c.env.DB.prepare(
        `INSERT INTO transaction_items
           (id, org_id, transaction_id, item_id, title, price_cents, markdown_cents,
            retail_estimate_cents)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        newId("txItem"),
        user!.orgId,
        txId,
        line.itemId,
        line.title,
        line.priceCents,
        line.markdownCents,
        line.retailEstimateCents
      )
    )
  );

  // Hold the goods before asking for money. The conditional UPDATE inside is
  // what stops two registers selling the same one-of-a-kind item.
  const reservation = await reserveItems(
    c.env.DB,
    user!.orgId,
    txId,
    cart.lines.map((l) => l.itemId)
  );

  if (reservation.unavailable.length > 0) {
    await applyInventoryEffect(c.env.DB, user!.orgId, txId, "canceled");
    await run(
      c.env.DB,
      `UPDATE transactions SET payment_state = 'canceled', voided_at = datetime('now'),
              void_reason = 'Items taken by another register before payment started'
        WHERE id = ?`,
      txId
    );
    return json(
      {
        error: "Another register just took one of these. Nothing was charged.",
        missing: reservation.unavailable,
      },
      409
    );
  }

  const logger = bindLog({
    requestId: newRequestId(),
    orgId: user!.orgId,
    userId: user!.id,
    transactionId: txId,
    connectedAccountId: account.stripeAccountId,
    readerId: body.readerId,
  });

  const { attempt } = await openAttempt(c.env.DB, {
    orgId: user!.orgId,
    transactionId: txId,
    tender: "terminal",
    amountCents: cart.totalCents,
    platformFeeCents: quote.platformFeeCents,
    feeBaseCents: quote.feeBaseCents,
    readerId: body.readerId,
    userId: user!.id,
    initialState: "draft",
  });

  try {
    // See app/lib/demo-guard.ts. Live keys make this the one thing the demo
    // must not be able to do.
    await assertRealShop(c.env.DB, user!.orgId);

    const intent = await createCardPresentIntent(
      config(c.env),
      {
        amountCents: cart.totalCents,
        applicationFeeCents: quote.platformFeeCents,
        connectedAccountId: account.stripeAccountId,
        transactionId: txId,
        orgId: user!.orgId,
      },
      attempt.idempotency_key
    );

    await processOnReader(
      config(c.env),
      reader.stripe_reader_id,
      intent.id,
      `${attempt.idempotency_key}:process`
    );

    await advanceAttempt(c.env.DB, user!.orgId, attempt.id, {
      state: "awaiting_reader",
      paymentIntentId: intent.id,
    });

    logger.info("card payment sent to reader", {
      attemptId: attempt.id,
      stripeObjectId: intent.id,
      idempotencyKey: attempt.idempotency_key,
      amountCents: cart.totalCents,
      feeCents: quote.platformFeeCents,
      transition: "draft→awaiting_reader",
    });

    await run(
      c.env.DB,
      `UPDATE transactions SET payment_state = 'awaiting_reader', stripe_payment_intent_id = ?
        WHERE id = ?`,
      intent.id,
      txId
    );

    return json({
      transactionId: txId,
      attemptId: attempt.id,
      paymentIntentId: intent.id,
      totalCents: cart.totalCents,
      platformFeeCents: quote.platformFeeCents,
      state: "awaiting_reader",
      simulated: reader.is_simulated === 1,
    });
  } catch (err) {
    // Stripe refused before any card was presented. Release the goods rather
    // than leaving them held by a payment that will never happen.
    // A refused demo charge explains itself — a volunteer poking at the demo
    // should be told why the card path stops, not shown a dead end.
    const message =
      err instanceof StripeError || err instanceof DemoChargeRefused
        ? err.message
        : "We couldn't start the payment.";
    logger.error("could not start card payment", {
      attemptId: attempt.id,
      idempotencyKey: attempt.idempotency_key,
      amountCents: cart.totalCents,
      outcome: "failed",
      error: message,
    });
    await advanceAttempt(c.env.DB, user!.orgId, attempt.id, {
      state: "failed",
      failureMessage: message,
    });
    await applyInventoryEffect(c.env.DB, user!.orgId, txId, "failed");
    await run(c.env.DB, `UPDATE transactions SET payment_state = 'failed' WHERE id = ?`, txId);
    return json({ error: message, transactionId: txId }, 502);
  }
});

/**
 * What's happening with this payment right now.
 *
 * The register polls this while the customer taps. It reads local state, and
 * only asks Stripe when the payment still looks unfinished — so a webhook that
 * has already landed is answered from our own database, and a webhook that is
 * late doesn't leave a cashier staring at a spinner.
 */
pos.get("/api/pos/terminal/status/:transactionId", async (c) => {
  const { error, user } = await auth(c);
  if (error) return error;

  const txId = c.req.param("transactionId");
  const tx = await first<{
    payment_state: string;
    stripe_payment_intent_id: string | null;
    receipt_token: string | null;
  }>(
    c.env.DB,
    `SELECT payment_state, stripe_payment_intent_id, receipt_token FROM transactions
      WHERE id = ? AND org_id = ?`,
    txId,
    user!.orgId
  );
  if (!tx) return json({ error: "No such sale." }, 404);

  const receiptUrl = tx.receipt_token ? `/r/${tx.receipt_token}` : null;

  const settled = ["succeeded", "failed", "canceled", "refunded", "partially_refunded"];
  if (settled.includes(tx.payment_state) || !tx.stripe_payment_intent_id) {
    return json({ state: tx.payment_state, source: "local", receiptUrl });
  }

  if (!c.env.STRIPE_SECRET_KEY) return json({ state: tx.payment_state, source: "local" });

  // Stripe is the authority. Polling it directly means a dropped webhook
  // delays the receipt rather than losing the sale.
  try {
    const intent = await getPaymentIntent(config(c.env), tx.stripe_payment_intent_id);
    const state = stateForIntent(intent.status);

    if (state !== tx.payment_state) {
      const attempts = await attemptsForTransaction(c.env.DB, user!.orgId, txId);
      const attempt = attempts[attempts.length - 1];
      if (attempt) {
        await advanceAttempt(c.env.DB, user!.orgId, attempt.id, {
          state,
          paymentIntentId: intent.id,
          chargeId: intent.latest_charge ?? null,
        });
      }
      await run(
        c.env.DB,
        `UPDATE transactions SET payment_state = ?, stripe_charge_id = COALESCE(?, stripe_charge_id)
          WHERE id = ? AND org_id = ?`,
        state,
        intent.latest_charge ?? null,
        txId,
        user!.orgId
      );
      await applyInventoryEffect(c.env.DB, user!.orgId, txId, state);
    }

    return json({ state, source: "stripe", receiptUrl });
  } catch {
    return json({ state: tx.payment_state, source: "local", stale: true, receiptUrl });
  }
});

/** The customer changed their mind while the reader was waiting. */
pos.post("/api/pos/terminal/cancel", async (c) => {
  const { error, user } = await authLimited(c);
  if (error) return error;
  if (!c.env.STRIPE_SECRET_KEY) return json({ error: "Stripe isn't configured." }, 503);

  const body = (await c.req.json().catch(() => null)) as {
    transactionId?: string;
    readerId?: string;
  } | null;
  if (!body?.transactionId) return json({ error: "Which sale?" }, 400);

  const tx = await first<{ stripe_payment_intent_id: string | null; payment_state: string }>(
    c.env.DB,
    `SELECT stripe_payment_intent_id, payment_state FROM transactions WHERE id = ? AND org_id = ?`,
    body.transactionId,
    user!.orgId
  );
  if (!tx) return json({ error: "No such sale." }, 404);

  // Refuse to "cancel" money that has already moved. That's a refund, and
  // calling it a cancellation would leave the books wrong.
  if (tx.payment_state === "succeeded") {
    return json(
      { error: "That payment already went through. Refund it instead." },
      409
    );
  }

  if (body.readerId) {
    const reader = await first<{ stripe_reader_id: string }>(
      c.env.DB,
      `SELECT stripe_reader_id FROM terminal_readers WHERE org_id = ? AND id = ?`,
      user!.orgId,
      body.readerId
    );
    if (reader) await cancelReaderAction(config(c.env), reader.stripe_reader_id).catch(() => {});
  }

  if (tx.stripe_payment_intent_id) {
    await cancelPaymentIntent(config(c.env), tx.stripe_payment_intent_id).catch(() => {});
  }

  const attempts = await attemptsForTransaction(c.env.DB, user!.orgId, body.transactionId);
  const attempt = attempts[attempts.length - 1];
  if (attempt) {
    await advanceAttempt(c.env.DB, user!.orgId, attempt.id, { state: "canceled" });
  }

  await run(
    c.env.DB,
    `UPDATE transactions SET payment_state = 'canceled', voided_at = datetime('now'),
            void_reason = 'Cancelled at the register'
      WHERE id = ? AND org_id = ?`,
    body.transactionId,
    user!.orgId
  );
  await applyInventoryEffect(c.env.DB, user!.orgId, body.transactionId, "canceled");

  return json({ ok: true, state: "canceled" });
});

pos.get("/api/pos/terminal/readers", async (c) => {
  const { error, user } = await auth(c);
  if (error) return error;
  return json({ readers: await orgReaders(c.env.DB, user!.orgId) });
});

pos.post("/api/pos/terminal/readers/:id/sync", async (c) => {
  const { error, user } = await auth(c);
  if (error) return error;
  if (!c.env.STRIPE_SECRET_KEY) return json({ error: "Stripe isn't configured." }, 503);

  const reader = await first<{ stripe_reader_id: string }>(
    c.env.DB,
    `SELECT stripe_reader_id FROM terminal_readers WHERE org_id = ? AND id = ?`,
    user!.orgId,
    c.req.param("id")
  );
  if (!reader) return json({ error: "No such reader." }, 404);

  const synced = await syncReader(c.env.DB, config(c.env), user!.orgId, reader.stripe_reader_id);
  return json({ status: synced.status, label: synced.label });
});

/**
 * Make a simulated reader present a test card.
 *
 * Test mode only, and guarded on the reader being simulated — a route that
 * could be pointed at real hardware would be a way to trigger a payment nobody
 * asked for.
 */
pos.post("/api/pos/terminal/readers/:id/simulate", async (c) => {
  const { error, user } = await auth(c);
  if (error) return error;
  if (!c.env.STRIPE_SECRET_KEY) return json({ error: "Stripe isn't configured." }, 503);

  const reader = await first<{ stripe_reader_id: string; is_simulated: number }>(
    c.env.DB,
    `SELECT stripe_reader_id, is_simulated FROM terminal_readers WHERE org_id = ? AND id = ?`,
    user!.orgId,
    c.req.param("id")
  );
  if (!reader) return json({ error: "No such reader." }, 404);
  if (reader.is_simulated !== 1) {
    return json({ error: "That's a real reader — it needs a real card." }, 400);
  }

  const body = (await c.req.json().catch(() => null)) as { cardNumber?: string } | null;
  const result = await presentTestPaymentMethod(
    config(c.env),
    reader.stripe_reader_id,
    body?.cardNumber
  );
  return json({ ok: true, action: result.action?.status ?? null });
});

/* ─── Refunds ───────────────────────────────────────────────────────────── */

/** What a refund would do. Shown to a cashier before they commit to it. */
pos.post("/api/pos/refunds/preview", async (c) => {
  const { error, user } = await auth(c);
  if (error) return error;

  const body = (await c.req.json().catch(() => null)) as {
    transactionId?: string;
    amountCents?: number;
    taxCents?: number;
  } | null;
  if (!body?.transactionId) return json({ error: "Which sale?" }, 400);

  try {
    const plan = await planRefund(c.env.DB, {
      orgId: user!.orgId,
      transactionId: body.transactionId,
      amountCents: Math.round(body.amountCents ?? 0),
      taxCents: Math.round(body.taxCents ?? 0),
    });
    return json(plan);
  } catch (err) {
    if (err instanceof RefundError) return json({ error: err.message }, 400);
    throw err;
  }
});

/**
 * Refund a sale. Needs staff or above.
 *
 * Refunds are the one register action where a mistake moves money out of the
 * shop, so the permission bar sits above volunteer — not from distrust, but
 * because it shouldn't be one mis-tap away for someone whose job is the floor.
 */
pos.post("/api/pos/refunds", async (c) => {
  const { error, user } = await authLimited(c);
  if (error) return error;

  if (!roleAtLeast(user!.role, "staff")) {
    return json({ error: "Refunds need a staff member or a manager." }, 403);
  }

  const body = (await c.req.json().catch(() => null)) as {
    transactionId?: string;
    amountCents?: number;
    taxCents?: number;
    reason?: string;
    restock?: boolean;
    itemIds?: string[];
  } | null;
  if (!body?.transactionId) return json({ error: "Which sale?" }, 400);

  try {
    const result = await refundSale(
      c.env.DB,
      {
        orgId: user!.orgId,
        transactionId: body.transactionId,
        amountCents: Math.round(body.amountCents ?? 0),
        taxCents: Math.round(body.taxCents ?? 0),
        reason: body.reason,
        restock: body.restock !== false,
        itemIds: body.itemIds ?? [],
        userId: user!.id,
      },
      c.env.STRIPE_SECRET_KEY ? config(c.env) : null
    );
    return json(result);
  } catch (err) {
    if (err instanceof RefundError) return json({ error: err.message }, 400);
    throw err;
  }
});

pos.get("/api/pos/disputes", async (c) => {
  const { error, user } = await auth(c);
  if (error) return error;
  return json({ disputes: await openDisputes(c.env.DB, user!.orgId) });
});

/* ─── Cash drawer ───────────────────────────────────────────────────────── */

pos.post("/api/pos/shift/open", async (c) => {
  const { error, user } = await authLimited(c);
  if (error) return error;

  const body = (await c.req.json().catch(() => null)) as {
    registerId?: string;
    openingFloatCents?: number;
  } | null;

  const registerId = body?.registerId ?? (await ensureDefaultRegister(c.env.DB, user!.orgId));

  try {
    const shift = await openShift(c.env.DB, {
      orgId: user!.orgId,
      registerId,
      userId: user!.id,
      openingFloatCents: Math.round(body?.openingFloatCents ?? 0),
    });
    return json({ shift });
  } catch (err) {
    if (err instanceof ShiftAlreadyOpenError) return json({ error: err.message }, 409);
    throw err;
  }
});

pos.get("/api/pos/shift/current", async (c) => {
  const { error, user } = await auth(c);
  if (error) return error;

  const registerId = c.req.query("registerId") ?? (await ensureDefaultRegister(c.env.DB, user!.orgId));
  const shift = await openShiftFor(c.env.DB, user!.orgId, registerId);
  if (!shift) return json({ shift: null });

  return json({ shift, totals: await shiftTotals(c.env.DB, user!.orgId, shift.id) });
});

pos.post("/api/pos/shift/movement", async (c) => {
  const { error, user } = await authLimited(c);
  if (error) return error;

  const body = (await c.req.json().catch(() => null)) as {
    shiftId?: string;
    kind?: "pay_in" | "pay_out" | "drop";
    amountCents?: number;
    reason?: string;
  } | null;

  if (!body?.shiftId || !body.kind) return json({ error: "Missing the drawer or the kind." }, 400);

  try {
    const id = await recordCashMovement(c.env.DB, {
      orgId: user!.orgId,
      shiftId: body.shiftId,
      kind: body.kind,
      amountCents: Math.round(body.amountCents ?? 0),
      reason: body.reason ?? "",
      userId: user!.id,
    });
    return json({ id, totals: await shiftTotals(c.env.DB, user!.orgId, body.shiftId) });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "Couldn't record that." }, 400);
  }
});

pos.post("/api/pos/shift/close", async (c) => {
  const { error, user } = await authLimited(c);
  if (error) return error;

  const body = (await c.req.json().catch(() => null)) as {
    shiftId?: string;
    countedCents?: number;
    note?: string;
  } | null;
  if (!body?.shiftId) return json({ error: "Which drawer?" }, 400);

  const result = await closeShift(c.env.DB, {
    orgId: user!.orgId,
    shiftId: body.shiftId,
    userId: user!.id,
    countedCents: Math.round(body.countedCents ?? 0),
    note: body.note ?? null,
  });

  return json(result);
});
