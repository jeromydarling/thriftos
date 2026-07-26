/**
 * Taking an online order.
 *
 * The order of operations is the whole design, and it is the register's order:
 *
 *   1. Price the basket from the database. Nothing about money comes from the
 *      browser.
 *   2. Write the transaction and a snapshot of every line, so the receipt can
 *      never change underneath the customer.
 *   3. **Hold the goods.** The conditional UPDATE inside `reserveItems` is what
 *      stops the web and the till selling the same coat.
 *   4. Only then ask for money.
 *
 * Reversed — money first, goods second — a shop takes a card payment for a
 * jumper somebody bought at the counter thirty seconds earlier, and now owes a
 * refund and an apology to a stranger. Holding first means the worst case is a
 * shopper told, before paying anything, that an item has gone.
 *
 * Nothing here marks an item sold. That happens in the webhook, when Stripe
 * says the money is real, through exactly the same `applyInventoryEffect` the
 * counter uses.
 */
import { first, run } from "./db";
import { newId } from "./ids";
import { newRequestId, bindLog } from "./log";
import { openAttempt, advanceAttempt } from "./attempts";
import { applyInventoryEffect, reserveItems } from "./payments";
import { quotePlatformFee } from "./fees";
import { createOnlineIntent } from "./stripe/terminal";
import type { StripeConfig } from "./stripe/client";
import {
  pickupCode,
  priceOrder,
  readCart,
  type CartLine,
  type FulfilmentMethod,
} from "./orders";

export interface Buyer {
  name: string;
  email: string;
  phone?: string | null;
  line1?: string | null;
  line2?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  country?: string | null;
}

export type CheckoutResult =
  | {
      ok: true;
      transactionId: string;
      clientSecret: string;
      totalCents: number;
      pickupCode: string | null;
    }
  | {
      ok: false;
      /** Shown to the shopper as-is, so it has to be worth reading. */
      error: string;
      /** Titles of the things that went, so they can be named rather than counted. */
      gone?: string[];
    };

/** A guest checkout still needs somewhere to send the receipt. */
function validBuyer(buyer: Buyer, method: FulfilmentMethod): string | null {
  if (!buyer.name.trim()) return "We need a name for the order.";
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(buyer.email.trim())) {
    return "We need an email address that works — it's where your receipt goes.";
  }
  if (method === "ship") {
    if (!buyer.line1?.trim()) return "We need a street address to post to.";
    if (!buyer.city?.trim()) return "We need a town or city.";
    if (!buyer.postalCode?.trim()) return "We need a postcode or ZIP.";
  }
  return null;
}

export async function beginCheckout(
  db: D1Database,
  config: StripeConfig,
  opts: {
    orgId: string;
    cartId: string;
    method: FulfilmentMethod;
    buyer: Buyer;
    connectedAccountId: string;
  }
): Promise<CheckoutResult> {
  const problem = validBuyer(opts.buyer, opts.method);
  if (problem) return { ok: false, error: problem };

  const lines = await readCart(db, opts.cartId, opts.orgId);
  if (lines.length === 0) return { ok: false, error: "Your basket is empty." };

  const totals = await priceOrder(db, opts.orgId, lines, opts.method);

  // Named, not counted. "One item is no longer available" makes a shopper
  // re-read their whole basket to work out which.
  if (totals.unavailable.length > 0) {
    return {
      ok: false,
      error:
        totals.unavailable.length === 1
          ? `${totals.unavailable[0].title} has just gone — everything here is one of a kind.`
          : "Some of these have just gone — everything here is one of a kind.",
      gone: totals.unavailable.map((l) => l.title),
    };
  }

  if (totals.lines.length === 0) return { ok: false, error: "Your basket is empty." };

  if (opts.method === "ship" && !totals.shipping?.band) {
    return {
      ok: false,
      error: totals.shipping?.reason ?? "This order can't be posted.",
    };
  }

  const txId = newId("transaction");
  const code = opts.method === "pickup" ? pickupCode() : null;

  await run(
    db,
    `INSERT INTO transactions
       (id, org_id, channel, subtotal_cents, tax_cents, shipping_cents, total_cents,
        tender, payment_state, fulfilment_method, fulfilment_status, pickup_code,
        buyer_name, buyer_email, buyer_phone,
        ship_line1, ship_line2, ship_city, ship_state, ship_postal_code, ship_country)
     VALUES (?, ?, 'online', ?, ?, ?, ?, 'card', 'draft', ?, 'awaiting', ?,
             ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    txId,
    opts.orgId,
    totals.subtotalCents,
    totals.taxCents,
    totals.shippingCents,
    totals.totalCents,
    opts.method,
    code,
    opts.buyer.name.trim(),
    opts.buyer.email.trim().toLowerCase(),
    opts.buyer.phone?.trim() || null,
    opts.buyer.line1?.trim() || null,
    opts.buyer.line2?.trim() || null,
    opts.buyer.city?.trim() || null,
    opts.buyer.state?.trim() || null,
    opts.buyer.postalCode?.trim() || null,
    opts.buyer.country?.trim() || null
  );

  // A snapshot per line, so re-pricing later can never change what somebody
  // was charged or what their receipt says.
  await db.batch(
    totals.lines.map((line) =>
      db
        .prepare(
          `INSERT INTO transaction_items
             (id, org_id, transaction_id, item_id, title, category, price_cents, markdown_cents)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          newId("txItem"),
          opts.orgId,
          txId,
          line.itemId,
          line.title,
          line.category,
          line.priceCents,
          line.markdownCents
        )
    )
  );

  // Hold the goods before asking for money.
  const reservation = await reserveItems(
    db,
    opts.orgId,
    txId,
    totals.lines.map((l) => l.itemId)
  );

  if (reservation.unavailable.length > 0) {
    // Somebody took one between pricing and holding — a window of milliseconds,
    // and exactly the one this ordering exists to make harmless. Nothing has
    // been charged, so there is nothing to refund.
    await applyInventoryEffect(db, opts.orgId, txId, "canceled");
    await run(
      db,
      `UPDATE transactions
          SET payment_state = 'canceled', fulfilment_status = NULL,
              voided_at = datetime('now'),
              void_reason = 'Item taken elsewhere before payment started'
        WHERE id = ?`,
      txId
    );

    const goneTitles = totals.lines
      .filter((l) => reservation.unavailable.includes(l.itemId))
      .map((l) => l.title);

    return {
      ok: false,
      error: "Somebody got there first — nothing has been charged.",
      gone: goneTitles,
    };
  }

  // Postage is not in the fee base.
  //
  // The same reasoning the defaults already apply to sales tax: it isn't the
  // shop's revenue, it's money passing through them to somebody else. Taking a
  // percentage of a shop's postage would mean earning more the heavier a coat
  // is, which is not a thing we could explain to a shop out loud.
  const quote = await quotePlatformFee(db, opts.orgId, {
    merchandiseSubtotalCents: totals.subtotalCents,
    taxCents: totals.taxCents,
  });

  const logger = bindLog({
    requestId: newRequestId(),
    orgId: opts.orgId,
    transactionId: txId,
    connectedAccountId: opts.connectedAccountId,
  });

  const { attempt } = await openAttempt(db, {
    orgId: opts.orgId,
    transactionId: txId,
    tender: "card",
    amountCents: totals.totalCents,
    platformFeeCents: quote.platformFeeCents,
    feeBaseCents: quote.feeBaseCents,
    initialState: "draft",
  });

  try {
    const intent = await createOnlineIntent(
      config,
      {
        amountCents: totals.totalCents,
        applicationFeeCents: quote.platformFeeCents,
        connectedAccountId: opts.connectedAccountId,
        transactionId: txId,
        orgId: opts.orgId,
        receiptEmail: opts.buyer.email.trim().toLowerCase(),
      },
      attempt.idempotency_key
    );

    await advanceAttempt(db, opts.orgId, attempt.id, {
      state: "processing",
      paymentIntentId: intent.id,
    });

    await run(
      db,
      `UPDATE transactions SET payment_state = 'processing', stripe_payment_intent_id = ?
        WHERE id = ?`,
      intent.id,
      txId
    );

    logger.info("online payment started", {
      attemptId: attempt.id,
      stripeObjectId: intent.id,
      idempotencyKey: attempt.idempotency_key,
      amountCents: totals.totalCents,
      feeCents: quote.platformFeeCents,
      transition: "draft→processing",
    });

    if (!intent.client_secret) {
      throw new Error("Stripe returned a payment intent with no client secret.");
    }

    return {
      ok: true,
      transactionId: txId,
      clientSecret: intent.client_secret,
      totalCents: totals.totalCents,
      pickupCode: code,
    };
  } catch (err) {
    // The goods go back on the rail. Leaving them held because our own call
    // failed would take a coat out of a shop over an error the shopper never
    // saw and cannot clear.
    await applyInventoryEffect(db, opts.orgId, txId, "failed");
    await advanceAttempt(db, opts.orgId, attempt.id, {
      state: "failed",
      failureMessage: err instanceof Error ? err.message : String(err),
    });
    await run(
      db,
      `UPDATE transactions SET payment_state = 'failed', fulfilment_status = NULL WHERE id = ?`,
      txId
    );

    logger.error("online payment could not be started", {
      attemptId: attempt.id,
      transition: "draft→failed",
    });

    return {
      ok: false,
      error: "We couldn't start the payment. Nothing has been charged — please try again.",
    };
  }
}

/**
 * Put back the goods behind a checkout that was started and never finished.
 *
 * Runs on the cron. A hold exists so two people can't buy one coat; a hold
 * nobody ever cleared is a coat that quietly stops being for sale, which is the
 * same harm arriving slowly.
 *
 * Only touches attempts still mid-flight. A payment that succeeded owns its
 * items, and one that already failed released them at the time.
 */
export async function releaseExpiredHolds(
  db: D1Database,
  holdMinutes: number
): Promise<{ released: number; transactions: string[] }> {
  const stale = await db
    .prepare(
      `SELECT id, org_id FROM transactions
        WHERE channel = 'online'
          AND payment_state IN ('draft','processing','requires_action')
          AND created_at < datetime('now', ?)`
    )
    .bind(`-${Math.round(holdMinutes)} minutes`)
    .all<{ id: string; org_id: string }>();

  const rows = stale.results ?? [];
  const transactions: string[] = [];

  for (const tx of rows) {
    await applyInventoryEffect(db, tx.org_id, tx.id, "canceled");
    await run(
      db,
      `UPDATE transactions
          SET payment_state = 'canceled', fulfilment_status = NULL,
              voided_at = datetime('now'),
              void_reason = 'Checkout not completed — items returned to sale'
        WHERE id = ?`,
      tx.id
    );
    transactions.push(tx.id);
  }

  return { released: transactions.length, transactions };
}

/** Empty a cart once its order is paid for, so a refresh can't re-buy it. */
export async function clearCart(db: D1Database, cartId: string): Promise<void> {
  await run(db, `DELETE FROM cart_items WHERE cart_id = ?`, cartId);
}

export async function orderByPickupCode(
  db: D1Database,
  orgId: string,
  code: string
): Promise<{ id: string; buyer_name: string; fulfilment_status: string } | null> {
  return first(
    db,
    `SELECT id, buyer_name, fulfilment_status FROM transactions
      WHERE org_id = ? AND pickup_code = ? AND channel = 'online'`,
    orgId,
    code.trim().toUpperCase()
  );
}
