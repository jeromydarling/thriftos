/**
 * Connect onboarding routes, and the Stripe webhook endpoint.
 *
 * Every route here requires a tenant administrator. Onboarding a payment
 * account is not something a volunteer on the floor should be able to start.
 *
 * The webhook is the only writer of account status that a shop cannot
 * influence, which is exactly why it's authoritative.
 */
import { Hono } from "hono";
import { first } from "../lib/db";
import { getUser, roleAtLeast } from "../lib/auth";
import type { AppEnv } from "../lib/env";
import { stripeReadiness, StripeError } from "../lib/stripe/client";
import {
  failedEvents,
  handleStripeEvent,
  handleWebhook,
  replayEvent,
  type StripeEvent as VerifiedStripeEvent,
} from "../lib/stripe/webhooks";
import {
  canAcceptPayments,
  createDashboardLink,
  createOnboardingLink,
  ensureAccount,
  getAccount,
  retrieveAccount,
  statusExplanation,
  syncAccount,
} from "../lib/stripe/connect";

type Ctx = { Bindings: AppEnv };

export const connect = new Hono<Ctx>();

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });

/** Admin-or-better, plus a configured Stripe. Returns the guard failure, or null. */
async function requireAdmin(c: { req: { raw: Request }; env: AppEnv }) {
  const user = await getUser(c.req.raw, c.env.DB);
  if (!user) return { error: json({ error: "Please sign in first." }, 401), user: null };
  if (!roleAtLeast(user.role, "admin")) {
    return {
      error: json(
        { error: "Setting up payments needs an owner or admin." },
        403
      ),
      user: null,
    };
  }
  return { error: null, user };
}

function config(env: AppEnv) {
  return { secretKey: env.STRIPE_SECRET_KEY! };
}

/* ─── Status ────────────────────────────────────────────────────────────── */

/**
 * Always answers, even with Stripe unconfigured — the settings page needs to
 * render something truthful rather than an error.
 */
connect.get("/api/stripe/connect/status", async (c) => {
  const guard = await requireAdmin(c);
  if (guard.error) return guard.error;
  const user = guard.user!;

  const readiness = stripeReadiness(c.env);
  const record = await getAccount(c.env.DB, user.orgId);
  const status = record?.status ?? "not_started";

  return json({
    configured: readiness.configured,
    missingSecrets: readiness.missing,
    status,
    explanation: statusExplanation(status),
    canAcceptPayments: canAcceptPayments(record),
    account: record
      ? {
          stripeAccountId: record.stripeAccountId,
          chargesEnabled: record.chargesEnabled,
          payoutsEnabled: record.payoutsEnabled,
          detailsSubmitted: record.detailsSubmitted,
          disabledReason: record.disabledReason,
          currentlyDue: record.currentlyDue,
          eventuallyDue: record.eventuallyDue,
          lastSyncedAt: record.lastSyncedAt,
        }
      : null,
  });
});

/* ─── Create or reuse the account ───────────────────────────────────────── */

connect.post("/api/stripe/connect/account", async (c) => {
  const guard = await requireAdmin(c);
  if (guard.error) return guard.error;
  const user = guard.user!;

  const readiness = stripeReadiness(c.env);
  if (!readiness.configured) {
    return json(
      {
        error: "Payments aren't configured on this deployment yet.",
        missing: readiness.missing,
      },
      503
    );
  }

  const org = await first<{ id: string; name: string; email: string | null }>(
    c.env.DB,
    `SELECT id, name, email FROM orgs WHERE id = ?`,
    user.orgId
  );
  if (!org) return json({ error: "We couldn't find your shop." }, 404);

  try {
    // Reuses an existing account. Restarting onboarding never mints a second.
    const { record, created } = await ensureAccount(c.env.DB, config(c.env), org);
    const url = await createOnboardingLink(
      config(c.env),
      record.stripeAccountId,
      c.env.APP_URL
    );
    return json({ created, status: record.status, onboardingUrl: url });
  } catch (err) {
    return stripeFailure(err);
  }
});

connect.post("/api/stripe/connect/onboarding-link", async (c) => {
  const guard = await requireAdmin(c);
  if (guard.error) return guard.error;
  const user = guard.user!;

  const record = await getAccount(c.env.DB, user.orgId);
  if (!record) return json({ error: "Start by activating payments first." }, 400);

  try {
    const url = await createOnboardingLink(
      config(c.env),
      record.stripeAccountId,
      c.env.APP_URL
    );
    return json({ onboardingUrl: url });
  } catch (err) {
    return stripeFailure(err);
  }
});

connect.post("/api/stripe/connect/dashboard-link", async (c) => {
  const guard = await requireAdmin(c);
  if (guard.error) return guard.error;
  const user = guard.user!;

  const record = await getAccount(c.env.DB, user.orgId);
  if (!record) return json({ error: "No connected account yet." }, 400);

  try {
    const url = await createDashboardLink(config(c.env), record.stripeAccountId);
    return json({ dashboardUrl: url });
  } catch (err) {
    return stripeFailure(err);
  }
});

/** Pull the current truth from Stripe on demand. */
connect.post("/api/stripe/connect/refresh", async (c) => {
  const guard = await requireAdmin(c);
  if (guard.error) return guard.error;
  const user = guard.user!;

  const record = await getAccount(c.env.DB, user.orgId);
  if (!record) return json({ error: "No connected account yet." }, 400);

  try {
    const account = await retrieveAccount(config(c.env), record.stripeAccountId);
    const updated = await syncAccount(c.env.DB, user.orgId, account);
    return json({
      status: updated.status,
      explanation: statusExplanation(updated.status),
      canAcceptPayments: canAcceptPayments(updated),
    });
  } catch (err) {
    return stripeFailure(err);
  }
});

function stripeFailure(err: unknown) {
  if (err instanceof StripeError) {
    console.error("stripe error:", err.code, err.message);
    return json(
      {
        error: err.isRetryable
          ? "Stripe is having a moment. Try again shortly — nothing was lost."
          : `Stripe couldn't complete that: ${err.message}`,
        retryable: err.isRetryable,
      },
      err.isRetryable ? 503 : 400
    );
  }
  console.error("connect error:", err);
  return json({ error: "That didn't work. Nothing was changed." }, 500);
}

/* ─── Webhooks ──────────────────────────────────────────────────────────── */

interface StripeEvent {
  id: string;
  type: string;
  account?: string;
  data: { object: Record<string, unknown> };
}

/**
 * The Stripe webhook endpoint.
 *
 * Thin on purpose. Verification, the event store, dispatch, and replay all
 * live in lib/stripe/webhooks.ts so that the same logic can be exercised by
 * tests without an HTTP layer, and so there is exactly one place where a
 * Stripe event becomes a fact about our database.
 */
connect.post("/api/stripe/webhook", async (c) => {
  // The RAW body. Parsing first and re-serialising changes the bytes and the
  // signature will not verify.
  const raw = await c.req.text();

  const secret = c.env.STRIPE_CONNECT_WEBHOOK_SECRET ?? c.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    console.warn("stripe webhook received but no signing secret configured");
    return json({ error: "Webhooks are not configured." }, 503);
  }

  const { status, result } = await handleWebhook(c.env.DB, {
    rawBody: raw,
    signature: c.req.header("stripe-signature") ?? null,
    secret,
    config: c.env.STRIPE_SECRET_KEY ? { secretKey: c.env.STRIPE_SECRET_KEY } : null,
  });

  if (result.outcome === "failed" && result.eventId) {
    console.error("webhook processing failed:", result.eventType, result.detail);
  }

  return json({ received: status === 200, ...result }, status);
});

/* ─── Federation receiver ───────────────────────────────────────────────── */

/** Lowercase-hex HMAC-SHA256 of `message`, keyed by `secret`. */
async function hmacHex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time string comparison — never `===` for signatures. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

interface FederationEnvelope {
  hub_event_id?: string;
  satellite_app?: string;
  stripe_event?: unknown;
  delivered_at?: string;
}

/**
 * The CROS hub's Stripe receiver.
 *
 * The hub receives all Stripe events centrally and forwards each satellite's
 * share as a JSON envelope, signed with a shared secret rather than Stripe's
 * own signature — the hub already verified that. Once the envelope checks
 * out, the unwrapped event goes through handleStripeEvent, the exact code
 * path the direct webhook runs after its verification, so the two delivery
 * paths cannot drift.
 */
connect.post("/api/stripe/federation-in", async (c) => {
  // The RAW body first — the HMAC covers these exact bytes.
  const raw = await c.req.text();

  const secret = c.env.FEDERATION_STRIPE_SECRET;
  if (!secret) {
    // Fail closed. An unverifiable delivery must never reach a handler.
    return json({ ok: false, error: "federation_not_configured" }, 500);
  }

  const signature = c.req.header("X-CROS-Federation-Signature");
  if (!signature) {
    return json({ ok: false, error: "missing_federation_signature" }, 400);
  }

  const expected = await hmacHex(secret, raw);
  if (!timingSafeEqual(signature.toLowerCase(), expected)) {
    return json({ ok: false, error: "invalid_federation_signature" }, 400);
  }

  // Only now — after verification — is the body worth parsing.
  let envelope: FederationEnvelope;
  try {
    envelope = JSON.parse(raw) as FederationEnvelope;
  } catch {
    return json({ ok: false, error: "invalid_envelope" }, 400);
  }

  if (envelope.satellite_app && envelope.satellite_app !== "thriftos") {
    return json({ ok: false, error: "wrong_satellite" }, 400);
  }

  const stripeEvent = envelope.stripe_event;
  if (!stripeEvent || typeof stripeEvent !== "object" || Array.isArray(stripeEvent)) {
    return json({ ok: false, error: "invalid_stripe_event" }, 400);
  }

  const { status, result } = await handleStripeEvent(
    c.env.DB,
    stripeEvent as VerifiedStripeEvent,
    c.env.STRIPE_SECRET_KEY ? { secretKey: c.env.STRIPE_SECRET_KEY } : null
  );

  // handleStripeEvent answers 400 only for an event missing id/type.
  if (status === 400) {
    return json({ ok: false, error: "invalid_stripe_event", detail: result.detail }, 400);
  }

  if (result.outcome === "failed") {
    // Stored, alerted, and replayable — same as a direct-webhook failure —
    // but the hub is told so its own delivery record shows the truth.
    console.error("federation event processing failed:", result.eventType, result.detail);
    return json(
      { ok: false, error: "handler_failed", hub_event_id: envelope.hub_event_id ?? null },
      502
    );
  }

  return json({
    ok: true,
    received: true,
    hub_event_id: envelope.hub_event_id ?? null,
    ...result,
  });
});

/**
 * Replay an event whose handler failed.
 *
 * Fetches the current object from Stripe rather than replaying the stored
 * payload — the payload was true when it was sent and may not be now.
 */
connect.post("/api/stripe/events/:id/replay", async (c) => {
  const guard = await requireAdmin(c);
  if (guard.error) return guard.error;
  if (!c.env.STRIPE_SECRET_KEY) return json({ error: "Stripe isn't configured." }, 503);

  const result = await replayEvent(c.env.DB, config(c.env), c.req.param("id"));
  return json(result, result.outcome === "failed" ? 422 : 200);
});

connect.get("/api/stripe/events/failed", async (c) => {
  const guard = await requireAdmin(c);
  if (guard.error) return guard.error;
  return json({ events: await failedEvents(c.env.DB) });
});
