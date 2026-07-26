/**
 * Stripe Terminal — locations, readers, and card-present payments.
 *
 * The charge model is destination charges with `on_behalf_of` set to the
 * connected account, which makes the shop the merchant of record while letting
 * the platform set `application_fee_amount` server-side. That choice has a
 * price: the platform carries Stripe's processing costs, refund exposure, and
 * dispute liability. It is the honest arrangement for shops that should appear
 * on a customer's statement under their own name, and its cost belongs in
 * platform unit economics rather than being mistaken for margin.
 *
 * The rule that governs every function here: **Stripe is authoritative.** We
 * never conclude a payment succeeded because a request returned 200, because a
 * reader flashed green, or because a redirect landed. A payment is complete
 * when a verified Stripe object says it is, and until then the money is not
 * ours to count and the goods are not sold.
 */
import { stripeRequest, type StripeConfig } from "./client";
import { all, first, run } from "../db";
import { newId } from "../ids";

/* ─── Stripe object shapes, narrowed to what we use ─────────────────────── */

export interface StripeTerminalLocation {
  id: string;
  display_name: string;
  address?: Record<string, string>;
}

export interface StripeReader {
  id: string;
  label: string;
  device_type: string;
  serial_number?: string;
  status: "online" | "offline";
  location?: string;
  action?: {
    status: "in_progress" | "succeeded" | "failed";
    type: string;
    failure_code?: string;
    failure_message?: string;
    process_payment_intent?: { payment_intent: string };
  } | null;
}

export interface StripePaymentIntent {
  id: string;
  status:
    | "requires_payment_method"
    | "requires_confirmation"
    | "requires_action"
    | "processing"
    | "requires_capture"
    | "canceled"
    | "succeeded";
  amount: number;
  currency: string;
  latest_charge?: string | null;
  application_fee_amount?: number | null;
  last_payment_error?: { code?: string; message?: string } | null;
  /**
   * Only present on intents a browser will confirm. It authorises confirming
   * this one payment and nothing else, which is why it is the only part of a
   * payment intent that may be sent to a shopper.
   */
  client_secret?: string | null;
}

/**
 * Map Stripe's PaymentIntent status onto our payment state.
 *
 * Deliberately total and deliberately conservative: an unrecognised status
 * becomes `processing`, not `succeeded`. If Stripe adds a status tomorrow, the
 * worst outcome is a payment that looks unfinished until someone checks —
 * never an item marked sold for money we never took.
 */
export function stateForIntent(status: string) {
  switch (status) {
    case "succeeded":
      return "succeeded" as const;
    case "canceled":
      return "canceled" as const;
    case "requires_action":
    case "requires_confirmation":
      return "requires_action" as const;
    case "requires_payment_method":
      // On a card-present flow this means the card was declined and Stripe is
      // waiting for another. From the shop's point of view the tap failed.
      return "failed" as const;
    case "processing":
    case "requires_capture":
    default:
      return "processing" as const;
  }
}

/* ─── Locations and readers ─────────────────────────────────────────────── */

/**
 * Terminal locations live on the connected account, not the platform, because
 * the reader is physically in the shop and its address is the shop's.
 */
export async function createLocation(
  config: StripeConfig,
  opts: {
    displayName: string;
    line1: string;
    city: string;
    state: string;
    postalCode: string;
    country?: string;
  }
): Promise<StripeTerminalLocation> {
  return stripeRequest<StripeTerminalLocation>(config, "POST", "/terminal/locations", {
    display_name: opts.displayName,
    address: {
      line1: opts.line1,
      city: opts.city,
      state: opts.state,
      postal_code: opts.postalCode,
      country: opts.country ?? "US",
    },
  });
}

/**
 * Pair a reader using the code shown on its screen.
 *
 * Registration codes are single-use and short-lived, which is why a failure
 * here nearly always means the code expired rather than anything being wrong.
 */
export async function registerReader(
  config: StripeConfig,
  opts: { registrationCode: string; label: string; stripeLocationId: string }
): Promise<StripeReader> {
  return stripeRequest<StripeReader>(config, "POST", "/terminal/readers", {
    registration_code: opts.registrationCode,
    label: opts.label,
    location: opts.stripeLocationId,
  });
}

export async function listReaders(
  config: StripeConfig,
  stripeLocationId?: string
): Promise<{ data: StripeReader[] }> {
  return stripeRequest<{ data: StripeReader[] }>(config, "GET", "/terminal/readers", {
    ...(stripeLocationId ? { location: stripeLocationId } : {}),
    limit: 100,
  });
}

export async function getReader(config: StripeConfig, readerId: string): Promise<StripeReader> {
  return stripeRequest<StripeReader>(config, "GET", `/terminal/readers/${readerId}`);
}

/** Sync a reader's status from Stripe. Local status is never inferred. */
export async function syncReader(
  db: D1Database,
  config: StripeConfig,
  orgId: string,
  stripeReaderId: string
): Promise<StripeReader> {
  const reader = await getReader(config, stripeReaderId);
  await run(
    db,
    `UPDATE terminal_readers
        SET status = ?, label = ?, last_seen_at = CASE WHEN ? = 'online' THEN datetime('now') ELSE last_seen_at END,
            updated_at = datetime('now')
      WHERE org_id = ? AND stripe_reader_id = ?`,
    reader.status,
    reader.label,
    reader.status,
    orgId,
    stripeReaderId
  );
  return reader;
}

/* ─── Payment intents ───────────────────────────────────────────────────── */

export interface CardPresentIntentOptions {
  /** Total the customer pays, in cents. Computed server-side, always. */
  amountCents: number;
  /** Our cut. Never sent from a browser. */
  applicationFeeCents: number;
  /** The shop's connected account: acct_... */
  connectedAccountId: string;
  transactionId: string;
  orgId: string;
  currency?: string;
  statementDescriptorSuffix?: string;
  metadata?: Record<string, string>;
}

/**
 * Create a card-present PaymentIntent as a destination charge.
 *
 * `on_behalf_of` is what makes the shop the merchant of record — it settles the
 * charge in the shop's country under the shop's descriptor. `transfer_data`
 * routes the money to them, and `application_fee_amount` is our fee, taken from
 * the platform side.
 *
 * The application fee is asserted against the amount rather than trusted. A fee
 * larger than the payment would be rejected by Stripe anyway, but failing here
 * gives a readable error instead of an API error, and guards against a fee
 * policy bug reaching production as a charge.
 */
export async function createCardPresentIntent(
  config: StripeConfig,
  opts: CardPresentIntentOptions,
  idempotencyKey: string
): Promise<StripePaymentIntent> {
  const amount = Math.round(opts.amountCents);
  const fee = Math.round(opts.applicationFeeCents);

  if (amount <= 0) throw new Error("A payment must be for a positive amount.");
  if (fee < 0) throw new Error("A platform fee cannot be negative.");
  if (fee >= amount) {
    throw new Error(
      `Platform fee (${fee}) is not less than the payment (${amount}). Refusing to charge.`
    );
  }

  return stripeRequest<StripePaymentIntent>(
    config,
    "POST",
    "/payment_intents",
    {
      amount,
      currency: opts.currency ?? "usd",
      payment_method_types: ["card_present"],
      capture_method: "automatic",
      on_behalf_of: opts.connectedAccountId,
      transfer_data: { destination: opts.connectedAccountId },
      ...(fee > 0 ? { application_fee_amount: fee } : {}),
      ...(opts.statementDescriptorSuffix
        ? { statement_descriptor_suffix: opts.statementDescriptorSuffix.slice(0, 22) }
        : {}),
      metadata: {
        thriftos_transaction_id: opts.transactionId,
        thriftos_org_id: opts.orgId,
        ...(opts.metadata ?? {}),
      },
    },
    idempotencyKey
  );
}

export interface CheckoutSession {
  id: string;
  /** Where to send the shopper. The whole point of the hosted page. */
  url?: string | null;
  payment_intent?: string | null;
  status?: string | null;
  expires_at?: number | null;
}

export interface HostedCheckoutLine {
  name: string;
  amountCents: number;
}

/**
 * A hosted Stripe Checkout session for an online order.
 *
 * The same destination-charge shape as the counter — `on_behalf_of` plus
 * `transfer_data.destination` — so the shop is the merchant of record and we
 * carry dispute liability deliberately rather than by accident.
 *
 * Lines are sent individually because a shopper about to pay should see what
 * they are buying rather than one "Order total". Every amount is one we
 * computed; Stripe is being told the arithmetic, not asked for it. Postage and
 * sales tax arrive as their own lines for the same reason.
 */
export async function createHostedCheckout(
  config: StripeConfig,
  opts: {
    lines: readonly HostedCheckoutLine[];
    /** Must equal the sum of the lines. Checked here rather than trusted. */
    totalCents: number;
    applicationFeeCents: number;
    connectedAccountId: string;
    transactionId: string;
    orgId: string;
    shopName: string;
    successUrl: string;
    cancelUrl: string;
    customerEmail?: string | null;
    currency?: string;
    /** Unix seconds. Must not outlive the inventory hold behind it. */
    expiresAt: number;
  },
  idempotencyKey: string
): Promise<CheckoutSession> {
  const total = Math.round(opts.totalCents);
  const fee = Math.round(opts.applicationFeeCents);
  const summed = opts.lines.reduce((n, l) => n + Math.round(l.amountCents), 0);

  if (opts.lines.length === 0) throw new Error("A checkout must have something in it.");
  if (total <= 0) throw new Error("A payment must be for a positive amount.");
  if (summed !== total) {
    // A silent mismatch here charges a different number from the one the order
    // was written with, and the two would only be compared at reconciliation.
    throw new Error(`Checkout lines total ${summed} but the order is ${total}. Refusing to charge.`);
  }
  if (fee < 0) throw new Error("A platform fee cannot be negative.");
  if (fee >= total) {
    throw new Error(`Platform fee (${fee}) is not less than the payment (${total}). Refusing to charge.`);
  }

  const body: Record<string, unknown> = {
    mode: "payment",
    success_url: opts.successUrl,
    cancel_url: opts.cancelUrl,
    expires_at: opts.expiresAt,
    "payment_intent_data[on_behalf_of]": opts.connectedAccountId,
    "payment_intent_data[transfer_data][destination]": opts.connectedAccountId,
    "payment_intent_data[metadata][thriftos_transaction_id]": opts.transactionId,
    "payment_intent_data[metadata][thriftos_org_id]": opts.orgId,
    "payment_intent_data[metadata][thriftos_channel]": "online",
    "metadata[thriftos_transaction_id]": opts.transactionId,
    "metadata[thriftos_org_id]": opts.orgId,
    ...(fee > 0 ? { "payment_intent_data[application_fee_amount]": String(fee) } : {}),
    ...(opts.customerEmail ? { customer_email: opts.customerEmail } : {}),
  };

  opts.lines.forEach((line, i) => {
    body[`line_items[${i}][quantity]`] = "1";
    body[`line_items[${i}][price_data][currency]`] = opts.currency ?? "usd";
    body[`line_items[${i}][price_data][unit_amount]`] = String(Math.round(line.amountCents));
    body[`line_items[${i}][price_data][product_data][name]`] = line.name.slice(0, 250);
  });

  return stripeRequest<CheckoutSession>(config, "POST", "/checkout/sessions", body, idempotencyKey);
}

/** Hand the intent to a reader. The customer taps; Stripe tells us what happened. */
export async function processOnReader(
  config: StripeConfig,
  readerId: string,
  paymentIntentId: string,
  idempotencyKey: string
): Promise<StripeReader> {
  return stripeRequest<StripeReader>(
    config,
    "POST",
    `/terminal/readers/${readerId}/process_payment_intent`,
    { payment_intent: paymentIntentId },
    idempotencyKey
  );
}

/** Stop a reader waiting for a card — the customer changed their mind. */
export async function cancelReaderAction(
  config: StripeConfig,
  readerId: string
): Promise<StripeReader> {
  return stripeRequest<StripeReader>(
    config,
    "POST",
    `/terminal/readers/${readerId}/cancel_action`
  );
}

export async function getPaymentIntent(
  config: StripeConfig,
  paymentIntentId: string
): Promise<StripePaymentIntent> {
  return stripeRequest<StripePaymentIntent>(
    config,
    "GET",
    `/payment_intents/${paymentIntentId}`
  );
}

export async function cancelPaymentIntent(
  config: StripeConfig,
  paymentIntentId: string
): Promise<StripePaymentIntent> {
  return stripeRequest<StripePaymentIntent>(
    config,
    "POST",
    `/payment_intents/${paymentIntentId}/cancel`
  );
}

/**
 * Make a simulated reader present a test card.
 *
 * Simulated readers only exist in test mode and never move money. Everything
 * about them is marked as simulated in our own tables so nobody can look at a
 * screen and believe a sale was real.
 */
export async function presentTestPaymentMethod(
  config: StripeConfig,
  readerId: string,
  cardNumber?: string
): Promise<StripeReader> {
  return stripeRequest<StripeReader>(
    config,
    "POST",
    `/test_helpers/terminal/readers/${readerId}/present_payment_method`,
    cardNumber ? { card_present: { number: cardNumber } } : {}
  );
}

/* ─── Local records ─────────────────────────────────────────────────────── */

export async function saveLocation(
  db: D1Database,
  orgId: string,
  stripeLocation: StripeTerminalLocation,
  locationId: string | null
): Promise<string> {
  const existing = await first<{ id: string }>(
    db,
    `SELECT id FROM terminal_locations WHERE stripe_location_id = ?`,
    stripeLocation.id
  );
  if (existing) return existing.id;

  const id = newId("terminalLocation");
  await run(
    db,
    `INSERT INTO terminal_locations (id, org_id, location_id, stripe_location_id, display_name)
     VALUES (?, ?, ?, ?, ?)`,
    id,
    orgId,
    locationId,
    stripeLocation.id,
    stripeLocation.display_name
  );
  return id;
}

export async function saveReader(
  db: D1Database,
  orgId: string,
  terminalLocationId: string,
  reader: StripeReader
): Promise<string> {
  const existing = await first<{ id: string }>(
    db,
    `SELECT id FROM terminal_readers WHERE stripe_reader_id = ?`,
    reader.id
  );

  const simulated = reader.device_type?.startsWith("simulated") ? 1 : 0;

  if (existing) {
    await run(
      db,
      `UPDATE terminal_readers
          SET label = ?, status = ?, device_type = ?, serial_number = ?,
              is_simulated = ?, updated_at = datetime('now')
        WHERE id = ?`,
      reader.label,
      reader.status,
      reader.device_type,
      reader.serial_number ?? null,
      simulated,
      existing.id
    );
    return existing.id;
  }

  const id = newId("terminalReader");
  await run(
    db,
    `INSERT INTO terminal_readers
       (id, org_id, terminal_location_id, stripe_reader_id, label, device_type,
        serial_number, status, is_simulated)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    orgId,
    terminalLocationId,
    reader.id,
    reader.label,
    reader.device_type,
    reader.serial_number ?? null,
    reader.status,
    simulated
  );
  return id;
}

export async function orgReaders(db: D1Database, orgId: string) {
  return all<{
    id: string;
    stripe_reader_id: string;
    label: string;
    status: string;
    device_type: string | null;
    is_simulated: number;
    last_seen_at: string | null;
  }>(
    db,
    `SELECT id, stripe_reader_id, label, status, device_type, is_simulated, last_seen_at
       FROM terminal_readers WHERE org_id = ? ORDER BY label`,
    orgId
  );
}

export async function orgTerminalLocation(db: D1Database, orgId: string) {
  return first<{ id: string; stripe_location_id: string; display_name: string }>(
    db,
    `SELECT id, stripe_location_id, display_name FROM terminal_locations
      WHERE org_id = ? ORDER BY created_at LIMIT 1`,
    orgId
  );
}
