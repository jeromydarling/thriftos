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
import { first, run } from "../lib/db";
import { getUser, roleAtLeast } from "../lib/auth";
import type { AppEnv } from "../lib/env";
import { stripeReadiness, verifyWebhookSignature, StripeError } from "../lib/stripe/client";
import {
  canAcceptPayments,
  createDashboardLink,
  createOnboardingLink,
  ensureAccount,
  getAccount,
  getAccountByStripeId,
  markDeauthorized,
  retrieveAccount,
  statusExplanation,
  syncAccount,
  type StripeAccountObject,
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
 * Order matters here and is deliberate:
 *   1. read the RAW body (parsing first would break signature verification)
 *   2. verify the signature
 *   3. record the event id BEFORE any side effect
 *   4. only then act
 *
 * Step 3 is what makes redelivery safe. Stripe retries, and it does not
 * guarantee order — so handlers re-fetch the object rather than trusting the
 * payload to be current.
 */
connect.post("/api/stripe/webhook", async (c) => {
  const raw = await c.req.text();
  const signature = c.req.header("stripe-signature") ?? null;

  const secret = c.env.STRIPE_CONNECT_WEBHOOK_SECRET ?? c.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    console.warn("stripe webhook received but no signing secret configured");
    return json({ error: "Webhooks are not configured." }, 503);
  }

  const verified = await verifyWebhookSignature(raw, signature, secret);
  if (!verified.valid) {
    // Never process an unverified payload. Anyone can POST to this URL.
    console.warn("stripe webhook rejected:", verified.reason);
    return json({ error: "Invalid signature" }, 400);
  }

  let event: StripeEvent;
  try {
    event = JSON.parse(raw) as StripeEvent;
  } catch {
    return json({ error: "Malformed payload" }, 400);
  }

  // Record before acting. A duplicate delivery stops right here.
  const seen = await first<{ stripe_event_id: string; status: string }>(
    c.env.DB,
    `SELECT stripe_event_id, status FROM stripe_events WHERE stripe_event_id = ?`,
    event.id
  );

  if (seen && seen.status === "processed") {
    return json({ received: true, duplicate: true });
  }

  if (!seen) {
    await run(
      c.env.DB,
      `INSERT OR IGNORE INTO stripe_events
         (stripe_event_id, account_context, event_type, object_id, status)
       VALUES (?, ?, ?, ?, 'received')`,
      event.id,
      event.account ?? null,
      event.type,
      String((event.data?.object as { id?: string })?.id ?? "")
    );
  }

  try {
    const handled = await handleEvent(c.env, event);
    await run(
      c.env.DB,
      `UPDATE stripe_events
          SET status = ?, attempts = attempts + 1, processed_at = datetime('now'), last_error = NULL
        WHERE stripe_event_id = ?`,
      handled ? "processed" : "ignored",
      event.id
    );
    return json({ received: true, handled });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await run(
      c.env.DB,
      `UPDATE stripe_events
          SET status = 'failed', attempts = attempts + 1, last_error = ?
        WHERE stripe_event_id = ?`,
      message.slice(0, 500),
      event.id
    );
    // 500 asks Stripe to retry. The event row records why it failed.
    console.error("webhook processing failed:", event.type, message);
    return json({ error: "Processing failed" }, 500);
  }
});

/** Returns true if we acted on the event, false if it isn't one we care about. */
async function handleEvent(env: AppEnv, event: StripeEvent): Promise<boolean> {
  switch (event.type) {
    case "account.updated": {
      const account = event.data.object as unknown as StripeAccountObject;
      const local = await getAccountByStripeId(env.DB, account.id);
      if (!local) return false;

      // Events can arrive out of order, so re-fetch rather than trusting the
      // payload to be the newest truth.
      const fresh = env.STRIPE_SECRET_KEY
        ? await retrieveAccount({ secretKey: env.STRIPE_SECRET_KEY }, account.id)
        : account;

      await syncAccount(env.DB, local.orgId, fresh);
      return true;
    }

    case "account.application.deauthorized": {
      const accountId = event.account ?? (event.data.object as { id?: string })?.id;
      if (!accountId) return false;
      await markDeauthorized(env.DB, accountId);
      return true;
    }

    case "capability.updated": {
      const capability = event.data.object as { account?: string };
      if (!capability.account || !env.STRIPE_SECRET_KEY) return false;
      const local = await getAccountByStripeId(env.DB, capability.account);
      if (!local) return false;

      const fresh = await retrieveAccount(
        { secretKey: env.STRIPE_SECRET_KEY },
        capability.account
      );
      await syncAccount(env.DB, local.orgId, fresh);
      return true;
    }

    default:
      // Payment, refund, dispute, and billing events land in later steps.
      // Recording them as ignored is honest, and leaves a trail.
      return false;
  }
}
