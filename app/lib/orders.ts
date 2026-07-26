/**
 * Online orders: the cart, the price, and the hold.
 *
 * An online order is a `transaction` with `channel = 'online'`. Not a parallel
 * orders table — the ledger, refunds, fees, receipts and every report already
 * work on transactions, and a second shape would have to be taught all of it
 * again and would drift the first time one side changed.
 *
 * Three rules run through this file, and they are the same three the register
 * follows:
 *
 *   Every figure is computed here from what is in the database. Nothing about
 *   money is read from the request. A browser sends item ids and an address.
 *
 *   Stock is held by `reserveItems`, at checkout, for minutes — never at
 *   add-to-cart. One idle browser must not lock a coat out of a shop for an
 *   afternoon.
 *
 *   Nothing is marked sold until a payment reaches an approved terminal state.
 *   The hold is what stands between "somebody is buying this" and "this is
 *   gone", and it is released when the payment doesn't land.
 */
import { all, first, run } from "./db";
import { newId, newToken } from "./ids";
import { parseOrgSettings, taxCentsFor, type OrgSettings } from "./settings";
import { effectivePriceCents, DEFAULT_MARKDOWN_RULES, type MarkdownRule } from "./markdown";
import { bandsFor, quoteFor, type ShippableLine, type ShippingQuote } from "./shipping";

export type FulfilmentMethod = "ship" | "pickup";

export type FulfilmentStatus =
  | "awaiting"
  | "picking"
  | "ready"
  | "dispatched"
  | "collected"
  | "unfindable"
  | "refunded";

/**
 * How long Stripe's hosted checkout page stays payable.
 *
 * Thirty minutes is Stripe's minimum for a session, so this is a floor we don't
 * get to choose.
 */
export const SESSION_MINUTES = 30;

/**
 * How long a checkout holds stock before the items go back on sale.
 *
 * **Must be longer than SESSION_MINUTES.** The hold is what stops the item
 * being sold to somebody else while a shopper is on Stripe's page; if it
 * lapsed first, a perfectly ordinary payment at minute 29 would arrive for a
 * coat we had already put back on the rail. The five-minute margin is for
 * webhook delivery, which is quick but not instant.
 */
export const HOLD_MINUTES = SESSION_MINUTES + 5;

/* ─── The cart ───────────────────────────────────────────────────────────── */

export interface CartLine {
  itemId: string;
  title: string;
  category: string | null;
  /** The tag price, before any colour-tag markdown. */
  listedCents: number;
  /** What it actually costs today. */
  priceCents: number;
  markdownCents: number;
  tagColor: string | null;
  weightLbs: number | null;
  photoKey: string | null;
  /** False when it sold, or somebody else's checkout is holding it. */
  available: boolean;
}

export async function cartByToken(
  db: D1Database,
  token: string
): Promise<{ id: string; org_id: string } | null> {
  if (!token) return null;
  return first<{ id: string; org_id: string }>(
    db,
    `SELECT id, org_id FROM carts WHERE token = ?`,
    token
  );
}

export async function createCart(db: D1Database, orgId: string): Promise<{ id: string; token: string }> {
  const id = newId("cart");
  const token = newToken(24);
  await run(db, `INSERT INTO carts (id, org_id, token) VALUES (?, ?, ?)`, id, orgId, token);
  return { id, token };
}

export async function addToCart(db: D1Database, cartId: string, itemId: string): Promise<void> {
  // OR IGNORE rather than check-then-insert: the primary key is the guard, and
  // a shopper double-tapping "add" on a slow connection is not an error.
  await run(db, `INSERT OR IGNORE INTO cart_items (cart_id, item_id) VALUES (?, ?)`, cartId, itemId);
  await run(db, `UPDATE carts SET updated_at = datetime('now') WHERE id = ?`, cartId);
}

export async function removeFromCart(db: D1Database, cartId: string, itemId: string): Promise<void> {
  await run(db, `DELETE FROM cart_items WHERE cart_id = ? AND item_id = ?`, cartId, itemId);
  await run(db, `UPDATE carts SET updated_at = datetime('now') WHERE id = ?`, cartId);
}

/**
 * Read a cart, priced as of now.
 *
 * Prices are recomputed on every read rather than stored on the line. A cart
 * left open across a colour-tag rotation should show today's price, and the
 * shopper should pay what the shop is charging today — which is also what the
 * label on the rail says.
 */
export async function readCart(
  db: D1Database,
  cartId: string,
  orgId: string
): Promise<CartLine[]> {
  const [rows, rules] = await Promise.all([
    all<{
      id: string;
      title: string;
      category: string | null;
      price_cents: number;
      tag_color: string | null;
      intake_date: string;
      weight_lbs: number | null;
      photo_key: string | null;
      photo_enhanced_key: string | null;
      photo_enhanced_at: string | null;
      status: string;
      held_by_transaction_id: string | null;
    }>(
      db,
      `SELECT i.id, i.title, i.category, i.price_cents, i.tag_color, i.intake_date,
              i.weight_lbs, i.photo_key, i.photo_enhanced_key, i.photo_enhanced_at,
              i.status, i.held_by_transaction_id
         FROM cart_items c
         JOIN items i ON i.id = c.item_id
        WHERE c.cart_id = ? AND i.org_id = ?
        ORDER BY c.added_at`,
      cartId,
      orgId
    ),
    all<{ tag_color: string; discount_pct: number; age_days: number }>(
      db,
      `SELECT tag_color, discount_pct, age_days FROM markdown_rules
        WHERE org_id = ? AND is_active = 1 ORDER BY week_index`,
      orgId
    ),
  ]);

  const ladder: readonly MarkdownRule[] =
    rules.length > 0
      ? rules.map((r) => ({
          tagColor: r.tag_color,
          discountPct: r.discount_pct,
          ageDays: r.age_days,
          weekIndex: 0,
        }))
      : DEFAULT_MARKDOWN_RULES;

  return rows.map((r) => {
    // The same functions the register and the rail label use, so an item costs
    // one price in three places rather than three prices that agree by luck.
    const priced = { priceCents: r.price_cents, tagColor: r.tag_color, intakeDate: r.intake_date };
    const priceCents = effectivePriceCents(priced, ladder);
    return {
      itemId: r.id,
      title: r.title,
      category: r.category,
      listedCents: r.price_cents,
      priceCents,
      markdownCents: r.price_cents - priceCents,
      tagColor: r.tag_color,
      weightLbs: r.weight_lbs,
      // Only a reviewed cut-out is shown. An unreviewed one is a guess, and a
      // guess about what a used item looks like is not something to publish.
      photoKey: r.photo_enhanced_at ? (r.photo_enhanced_key ?? r.photo_key) : r.photo_key,
      available: r.status === "available" && !r.held_by_transaction_id,
    };
  });
}

/* ─── Pricing ────────────────────────────────────────────────────────────── */

export interface OrderTotals {
  lines: CartLine[];
  subtotalCents: number;
  shippingCents: number;
  taxCents: number;
  totalCents: number;
  shipping: ShippingQuote | null;
  /** Lines that can no longer be bought. Never silently dropped. */
  unavailable: CartLine[];
}

/**
 * Price an order, server-side, from the database.
 *
 * The only source of truth for what a shopper is charged. The browser sends a
 * fulfilment method and an address; every figure here is derived.
 *
 * Tax is charged on goods and not on postage. That is the common treatment and
 * it is the conservative one — a shop that should be taxing postage is
 * under-collecting slightly, which is a conversation; over-collecting on a
 * customer's behalf is a refund and a complaint.
 */
export async function priceOrder(
  db: D1Database,
  orgId: string,
  lines: readonly CartLine[],
  method: FulfilmentMethod,
  settings?: OrgSettings
): Promise<OrderTotals> {
  const org =
    settings ??
    parseOrgSettings(
      (
        await first<{ settings_json: string }>(
          db,
          `SELECT settings_json FROM orgs WHERE id = ?`,
          orgId
        )
      )?.settings_json
    );

  const available = lines.filter((l) => l.available);
  const unavailable = lines.filter((l) => !l.available);

  const subtotalCents = available.reduce((sum, l) => sum + l.priceCents, 0);

  let shipping: ShippingQuote | null = null;
  let shippingCents = 0;

  if (method === "ship") {
    const shippable: ShippableLine[] = available.map((l) => ({
      itemId: l.itemId,
      title: l.title,
      weightLbs: l.weightLbs,
    }));
    shipping = quoteFor(shippable, await bandsFor(db, orgId));
    shippingCents = shipping.priceCents;
  }

  const taxCents = taxCentsFor(subtotalCents, org);

  return {
    lines: available,
    subtotalCents,
    shippingCents,
    taxCents,
    totalCents: subtotalCents + shippingCents + taxCents,
    shipping,
    unavailable,
  };
}

/* ─── Pickup codes ───────────────────────────────────────────────────────── */

/**
 * A code said out loud across a counter.
 *
 * No vowels, so it can't spell anything; no 0/O or 1/I, which are the two pairs
 * people misread and mis-say. Six characters is enough for a shop's order
 * volume and short enough to read off a phone screen in one go.
 */
const CODE_ALPHABET = "BCDFGHJKLMNPQRSTVWXYZ23456789";

export function pickupCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

/* ─── Fulfilment ─────────────────────────────────────────────────────────── */

/** What the shop is asked to do next, in the order it happens. */
export const FULFILMENT_FLOW: Record<FulfilmentStatus, string> = {
  awaiting: "Paid. Needs picking off the floor.",
  picking: "Somebody is looking for it.",
  ready: "Found and packed.",
  dispatched: "In the post.",
  collected: "Handed over in the shop.",
  unfindable: "Couldn't be found — the customer needs refunding.",
  refunded: "Money returned. Nothing further to do.",
};

/**
 * Which statuses can follow which.
 *
 * The same shape as the payment state machine, and for the same reason: a
 * parcel that jumps from `awaiting` to `collected` is a bug, and we would
 * rather see it than tell a customer their order is waiting for them when
 * nobody has picked it.
 */
const FULFILMENT_TRANSITIONS: Record<FulfilmentStatus, readonly FulfilmentStatus[]> = {
  awaiting: ["picking", "unfindable", "refunded"],
  picking: ["ready", "unfindable", "awaiting", "refunded"],
  ready: ["dispatched", "collected", "unfindable", "refunded"],
  dispatched: ["refunded"],
  collected: ["refunded"],
  unfindable: ["picking", "refunded"],
  // Terminal. Money has gone back; anything else is a new order.
  refunded: [],
};

/**
 * A refund is reachable from everywhere.
 *
 * Written as its own sentence because the first version of the table above
 * omitted it from `picking` and `ready`, which would have meant telling a
 * customer who rang up to cancel that we couldn't return their money until
 * somebody had finished looking for their jumper. The customer's money is the
 * one thing that must always be returnable.
 */

export function canAdvance(from: FulfilmentStatus, to: FulfilmentStatus): boolean {
  return FULFILMENT_TRANSITIONS[from]?.includes(to) ?? false;
}
