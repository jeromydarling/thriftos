/**
 * Stripe Connect — Express account onboarding and status.
 *
 * The rule that shapes this file: **local status is only ever written from a
 * Stripe object.** A shop returning to our redirect URL proves it closed a
 * browser tab, not that it finished onboarding. So the return route fetches the
 * account and reads its real capabilities, and webhooks keep it current after.
 *
 * The other rule: never create a second connected account. Onboarding gets
 * abandoned and restarted constantly, and an orphaned `acct_` with a shop's
 * verification documents in it is a genuinely bad outcome. There is a unique
 * index on org_id, and `ensureAccount` reuses before it creates.
 */
import { first, run } from "../db";
import { newId } from "../ids";
import { stripeRequest, type StripeConfig } from "./client";

export type ConnectStatus =
  | "not_started"
  | "account_created"
  | "onboarding_incomplete"
  | "requirements_due"
  | "pending_verification"
  | "enabled"
  | "restricted"
  | "disabled";

export interface StripeAccountObject {
  id: string;
  charges_enabled?: boolean;
  payouts_enabled?: boolean;
  details_submitted?: boolean;
  country?: string;
  default_currency?: string;
  capabilities?: Record<string, string>;
  requirements?: {
    currently_due?: string[];
    eventually_due?: string[];
    past_due?: string[];
    pending_verification?: string[];
    disabled_reason?: string | null;
  };
}

export interface ConnectAccountRecord {
  id: string;
  orgId: string;
  stripeAccountId: string;
  status: ConnectStatus;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  disabledReason: string | null;
  currentlyDue: string[];
  eventuallyDue: string[];
  lastSyncedAt: string | null;
}

/**
 * Derive our status from Stripe's account object.
 *
 * Ordered most-severe first: a disabled account that also has requirements due
 * is disabled, not merely incomplete.
 */
export function deriveStatus(account: StripeAccountObject): ConnectStatus {
  const req = account.requirements ?? {};
  const disabledReason = req.disabled_reason ?? null;

  if (disabledReason) {
    // Stripe uses `rejected.*` for accounts it has turned away for good.
    return disabledReason.startsWith("rejected") ? "disabled" : "restricted";
  }

  if (account.charges_enabled && account.payouts_enabled) return "enabled";

  if ((req.currently_due?.length ?? 0) > 0 || (req.past_due?.length ?? 0) > 0) {
    return account.details_submitted ? "requirements_due" : "onboarding_incomplete";
  }

  if ((req.pending_verification?.length ?? 0) > 0) return "pending_verification";

  // Details in, nothing outstanding, but Stripe hasn't switched charges on yet.
  if (account.details_submitted) return "pending_verification";

  return "account_created";
}

/** Payments may only be taken when Stripe says both are true. */
export function canAcceptPayments(record: ConnectAccountRecord | null): boolean {
  return Boolean(record && record.status === "enabled" && record.chargesEnabled);
}

/**
 * Plain-language explanation of where a shop stands. Shown verbatim in
 * settings, because "requirements_due" means nothing to a volunteer.
 */
export function statusExplanation(status: ConnectStatus): {
  headline: string;
  detail: string;
  tone: "good" | "warn" | "info";
} {
  switch (status) {
    case "enabled":
      return {
        headline: "Card payments are on",
        detail: "You can take cards, and payouts go to your bank on Stripe's normal schedule.",
        tone: "good",
      };
    case "account_created":
      return {
        headline: "Not finished yet",
        detail: "Your Stripe account exists but onboarding hasn't been completed. Pick up where you left off.",
        tone: "info",
      };
    case "onboarding_incomplete":
      return {
        headline: "A few details still needed",
        detail: "Stripe needs the rest of your business and bank details before it can enable payments.",
        tone: "info",
      };
    case "requirements_due":
      return {
        headline: "Stripe needs something from you",
        detail: "There are outstanding items on your account. Until they're provided, card payments stay off.",
        tone: "warn",
      };
    case "pending_verification":
      return {
        headline: "Stripe is checking your details",
        detail: "Nothing to do — this usually takes a day or two. We'll update this page automatically.",
        tone: "info",
      };
    case "restricted":
      return {
        headline: "Payments are paused",
        detail: "Stripe has restricted the account. The reason is below, and the Stripe dashboard has the full detail.",
        tone: "warn",
      };
    case "disabled":
      return {
        headline: "This account can't take payments",
        detail: "Stripe has declined the account. Cash sales still work normally, and everything else in ThriftOS is unaffected.",
        tone: "warn",
      };
    default:
      return {
        headline: "Card payments aren't set up",
        detail: "Cash sales work today. Connect Stripe when you're ready to take cards.",
        tone: "info",
      };
  }
}

/* ─── Persistence ───────────────────────────────────────────────────────── */

function toRecord(row: {
  id: string;
  org_id: string;
  stripe_account_id: string;
  status: string;
  charges_enabled: number;
  payouts_enabled: number;
  details_submitted: number;
  disabled_reason: string | null;
  requirements_json: string;
  last_synced_at: string | null;
}): ConnectAccountRecord {
  let requirements: StripeAccountObject["requirements"] = {};
  try {
    requirements = JSON.parse(row.requirements_json) ?? {};
  } catch {
    requirements = {};
  }

  return {
    id: row.id,
    orgId: row.org_id,
    stripeAccountId: row.stripe_account_id,
    status: row.status as ConnectStatus,
    chargesEnabled: row.charges_enabled === 1,
    payoutsEnabled: row.payouts_enabled === 1,
    detailsSubmitted: row.details_submitted === 1,
    disabledReason: row.disabled_reason,
    currentlyDue: requirements?.currently_due ?? [],
    eventuallyDue: requirements?.eventually_due ?? [],
    lastSyncedAt: row.last_synced_at,
  };
}

export async function getAccount(
  db: D1Database,
  orgId: string
): Promise<ConnectAccountRecord | null> {
  const row = await first<Parameters<typeof toRecord>[0]>(
    db,
    `SELECT id, org_id, stripe_account_id, status, charges_enabled, payouts_enabled,
            details_submitted, disabled_reason, requirements_json, last_synced_at
       FROM stripe_accounts WHERE org_id = ?`,
    orgId
  );
  return row ? toRecord(row) : null;
}

export async function getAccountByStripeId(
  db: D1Database,
  stripeAccountId: string
): Promise<ConnectAccountRecord | null> {
  const row = await first<Parameters<typeof toRecord>[0]>(
    db,
    `SELECT id, org_id, stripe_account_id, status, charges_enabled, payouts_enabled,
            details_submitted, disabled_reason, requirements_json, last_synced_at
       FROM stripe_accounts WHERE stripe_account_id = ?`,
    stripeAccountId
  );
  return row ? toRecord(row) : null;
}

/** Write a Stripe account object into local state. The only writer of status. */
export async function syncAccount(
  db: D1Database,
  orgId: string,
  account: StripeAccountObject
): Promise<ConnectAccountRecord> {
  const status = deriveStatus(account);
  const requirements = JSON.stringify(account.requirements ?? {});
  const capabilities = JSON.stringify(account.capabilities ?? {});

  await run(
    db,
    `INSERT INTO stripe_accounts
       (id, org_id, stripe_account_id, status, charges_enabled, payouts_enabled,
        details_submitted, disabled_reason, requirements_json, capabilities_json,
        country, default_currency, last_synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT (org_id) DO UPDATE SET
       stripe_account_id = excluded.stripe_account_id,
       status            = excluded.status,
       charges_enabled   = excluded.charges_enabled,
       payouts_enabled   = excluded.payouts_enabled,
       details_submitted = excluded.details_submitted,
       disabled_reason   = excluded.disabled_reason,
       requirements_json = excluded.requirements_json,
       capabilities_json = excluded.capabilities_json,
       last_synced_at    = datetime('now'),
       updated_at        = datetime('now')`,
    newId("run"),
    orgId,
    account.id,
    status,
    account.charges_enabled ? 1 : 0,
    account.payouts_enabled ? 1 : 0,
    account.details_submitted ? 1 : 0,
    account.requirements?.disabled_reason ?? null,
    requirements,
    capabilities,
    account.country ?? "US",
    account.default_currency ?? "usd"
  );

  const record = await getAccount(db, orgId);
  if (!record) throw new Error("Failed to persist Stripe account");
  return record;
}

/* ─── Stripe calls ──────────────────────────────────────────────────────── */

export async function retrieveAccount(
  config: StripeConfig,
  stripeAccountId: string
): Promise<StripeAccountObject> {
  return stripeRequest<StripeAccountObject>(
    config,
    "GET",
    `/accounts/${stripeAccountId}`
  );
}

/**
 * Get this org's connected account, creating one only if it truly has none.
 *
 * Restarting onboarding must never mint a second account, so we check locally
 * first and reuse. The idempotency key is derived from the org id, so even a
 * double-submit at the Stripe end collapses to one account.
 */
export async function ensureAccount(
  db: D1Database,
  config: StripeConfig,
  org: { id: string; name: string; email: string | null; country?: string }
): Promise<{ record: ConnectAccountRecord; created: boolean }> {
  const existing = await getAccount(db, org.id);
  if (existing) {
    // Refresh from Stripe so a stale local row can't gate payments wrongly.
    const account = await retrieveAccount(config, existing.stripeAccountId);
    return { record: await syncAccount(db, org.id, account), created: false };
  }

  const account = await stripeRequest<StripeAccountObject>(
    config,
    "POST",
    "/accounts",
    {
      type: "express",
      country: org.country ?? "US",
      email: org.email ?? undefined,
      business_profile: {
        name: org.name,
        // 5931 — Used Merchandise and Secondhand Stores.
        mcc: "5931",
      },
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
      metadata: { thriftos_org_id: org.id },
    },
    `connect-account-${org.id}`
  );

  return { record: await syncAccount(db, org.id, account), created: true };
}

/** A fresh onboarding link. These are single-use and expire, so never cached. */
export async function createOnboardingLink(
  config: StripeConfig,
  stripeAccountId: string,
  appUrl: string
): Promise<string> {
  const link = await stripeRequest<{ url: string }>(config, "POST", "/account_links", {
    account: stripeAccountId,
    refresh_url: `${appUrl}/stripe/connect/refresh`,
    return_url: `${appUrl}/stripe/connect/return`,
    type: "account_onboarding",
    collection_options: { fields: "eventually_due" },
  });
  return link.url;
}

/** A link into the shop's own Express dashboard. */
export async function createDashboardLink(
  config: StripeConfig,
  stripeAccountId: string
): Promise<string> {
  const link = await stripeRequest<{ url: string }>(
    config,
    "POST",
    `/accounts/${stripeAccountId}/login_links`
  );
  return link.url;
}

/** Record that Stripe told us an account is gone. Never deletes local history. */
export async function markDeauthorized(
  db: D1Database,
  stripeAccountId: string
): Promise<void> {
  await run(
    db,
    `UPDATE stripe_accounts
        SET status = 'disabled', charges_enabled = 0, payouts_enabled = 0,
            deauthorized_at = datetime('now'), updated_at = datetime('now')
      WHERE stripe_account_id = ?`,
    stripeAccountId
  );
}
