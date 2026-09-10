/**
 * What a shop is actually allowed to do.
 *
 * The plan catalogue, the help centre, and llms.txt have all described this in
 * detail from the beginning — a 30-day trial, 14 days of grace after a failed
 * card, then "some non-essential features pause", and a location limit per
 * plan. None of it was enforced anywhere. Four tiers priced from $39 to $799
 * differed by an AI photo quota and nothing else.
 *
 * The shape of the enforcement matters as much as its existence, and it
 * follows one commitment made in the copy and kept here:
 *
 *   **The register never switches off. Neither does data export.**
 *
 * A shop that owes us money can still take a customer's money, still issue a
 * receipt, still update its card, and still leave with every record it owns.
 * Locking a till on a Saturday because a card expired isn't a billing strategy,
 * it's a hostage situation — and a shop in that position is usually a shop
 * having a bad month, not one refusing to pay.
 *
 * What pauses is the discretionary half: photo intake, the public storefront,
 * federation, and the impact report. Annoying, visible, and reversible the
 * moment a card goes through.
 */
import { first } from "./db";
import { ALWAYS_AVAILABLE, GRACE_DAYS, getPlan, resolvePlanId, type PlanId } from "./pricing";

/** Every gated capability. `ALWAYS_AVAILABLE` names the ones that never gate. */
export type Feature =
  | "register"
  | "cash_checkout"
  | "card_checkout"
  | "data_export"
  | "billing_update"
  | "receipts"
  | "ai_intake"
  | "storefront"
  | "federation"
  | "impact_report"
  | "add_location";

export type BillingState = "trialing" | "active" | "past_due" | "grace" | "suspended" | "canceled";

export interface Entitlements {
  planId: PlanId;
  state: BillingState;
  /** Whether the discretionary half is switched on. */
  full: boolean;
  maxLocations: number | null;
  locationCount: number;
  trialEndsAt: string | null;
  graceEndsAt: string | null;
  /** Days until the grace period runs out. Negative once it has. */
  daysOfGraceLeft: number | null;
  /**
   * Days until the trial ends, measured against the same `now` this whole
   * object was computed from — never against the wall clock at display time.
   *
   * `daysOfGraceLeft` already worked this way; this field closes the one gap
   * where it didn't. `billingNotice` used to recompute a trial countdown from
   * `Date.now()` on its own, which is usually indistinguishable from doing it
   * right — the two calls happen back to back — except when a caller injects
   * a fixed `now` (a test, a replay, a scheduled job), at which point the
   * banner silently drifts out of step with the state it's describing. A test
   * fixture with a hardcoded trial end date failed this way the day real time
   * caught up with it.
   */
  daysOfTrialLeft: number | null;
}

const DAY_MS = 86_400_000;

/** Never gated, whatever the billing state. */
const ALWAYS: ReadonlySet<string> = new Set(ALWAYS_AVAILABLE);

/**
 * Work out where a shop stands.
 *
 * Fails open. If the subscription row is missing or unreadable — which is the
 * normal state for a shop created before billing existed, and for the demo —
 * the shop is treated as active. Locking someone out because of our own
 * missing row would be the worst possible failure mode for this function.
 */
export async function getEntitlements(
  db: D1Database,
  orgId: string,
  now = new Date()
): Promise<Entitlements> {
  const [org, sub, locations] = await Promise.all([
    first<{ plan: string }>(db, `SELECT plan FROM orgs WHERE id = ?`, orgId),
    first<{
      status: string;
      trial_ends_at: string | null;
      grace_ends_at: string | null;
    }>(
      db,
      `SELECT status, trial_ends_at, grace_ends_at
         FROM tenant_subscriptions WHERE org_id = ?
        ORDER BY created_at DESC LIMIT 1`,
      orgId
    ),
    first<{ n: number }>(
      db,
      `SELECT COUNT(*) AS n FROM locations WHERE org_id = ?`,
      orgId
    ),
  ]);

  const planId = resolvePlanId(org?.plan ?? "volunteer");
  const plan = getPlan(planId);
  const locationCount = Number(locations?.n ?? 0);

  const base = {
    planId,
    maxLocations: plan.maxLocations,
    locationCount,
    trialEndsAt: sub?.trial_ends_at ?? null,
    graceEndsAt: sub?.grace_ends_at ?? null,
  };

  if (!sub) {
    return { ...base, state: "active", full: true, daysOfGraceLeft: null, daysOfTrialLeft: null };
  }

  if (sub.status === "canceled") {
    return { ...base, state: "canceled", full: false, daysOfGraceLeft: null, daysOfTrialLeft: null };
  }

  if (sub.status === "trialing") {
    const ends = sub.trial_ends_at ? new Date(sub.trial_ends_at).getTime() : null;
    // An expired trial with no payment behaves exactly like past due: the
    // register keeps working. Nobody loses a Saturday's takings to a trial
    // clock.
    if (ends !== null && ends < now.getTime()) {
      return { ...base, state: "past_due", full: false, daysOfGraceLeft: 0, daysOfTrialLeft: null };
    }
    const daysOfTrialLeft = ends === null ? null : Math.ceil((ends - now.getTime()) / DAY_MS);
    return { ...base, state: "trialing", full: true, daysOfGraceLeft: null, daysOfTrialLeft };
  }

  if (sub.status === "past_due" || sub.status === "incomplete") {
    // Grace is granted from the moment the payment failed. If nobody recorded
    // a grace end, assume the full period rather than none — the benefit of
    // our own missing data goes to the shop.
    const graceEnd = sub.grace_ends_at
      ? new Date(sub.grace_ends_at).getTime()
      : now.getTime() + GRACE_DAYS * DAY_MS;
    const daysLeft = Math.ceil((graceEnd - now.getTime()) / DAY_MS);

    return daysLeft > 0
      ? { ...base, state: "grace", full: true, daysOfGraceLeft: daysLeft, daysOfTrialLeft: null }
      : { ...base, state: "suspended", full: false, daysOfGraceLeft: daysLeft, daysOfTrialLeft: null };
  }

  return { ...base, state: "active", full: true, daysOfGraceLeft: null, daysOfTrialLeft: null };
}

/** Can this shop do this thing right now? */
export function can(entitlements: Entitlements, feature: Feature): boolean {
  if (ALWAYS.has(feature)) return true;

  if (feature === "add_location") {
    if (!entitlements.full) return false;
    if (entitlements.maxLocations === null) return true;
    return entitlements.locationCount < entitlements.maxLocations;
  }

  // Card checkout is not in ALWAYS_AVAILABLE, but it isn't ours to switch off
  // either: the money goes to the shop's own Stripe account, and blocking it
  // would be interfering with a customer paying a charity.
  if (feature === "card_checkout") return true;

  return entitlements.full;
}

/**
 * Why something is unavailable, in words a shop owner would use.
 *
 * Returns null when the feature is available, so a caller can use it directly
 * as the reason to show.
 */
export function reasonUnavailable(
  entitlements: Entitlements,
  feature: Feature
): string | null {
  if (can(entitlements, feature)) return null;

  if (feature === "add_location") {
    if (entitlements.maxLocations !== null && entitlements.locationCount >= entitlements.maxLocations) {
      return `Your plan covers ${entitlements.maxLocations} ${
        entitlements.maxLocations === 1 ? "location" : "locations"
      }. Moving up a tier is the only reason to — it doesn't change your fees.`;
    }
  }

  switch (entitlements.state) {
    case "suspended":
      return "A payment to us didn't go through and the grace period has run out, so this is paused. Your register, your receipts, and your data export all still work — update your card and this comes straight back.";
    case "canceled":
      return "This shop's subscription has ended. The register and your data export still work, so nothing is stranded — restart the subscription whenever you like.";
    default:
      return "That isn't available on this plan.";
  }
}

/** A banner's worth of context, or null when there's nothing worth saying. */
export function billingNotice(
  entitlements: Entitlements
): { tone: "info" | "warn"; text: string; href: string } | null {
  switch (entitlements.state) {
    case "grace":
      return {
        tone: "warn",
        text: `A payment to us didn't go through. Everything keeps working for ${entitlements.daysOfGraceLeft} more ${
          entitlements.daysOfGraceLeft === 1 ? "day" : "days"
        } — after that, photo intake and your public shop page pause. The register never does.`,
        href: "/app/settings",
      };
    case "suspended":
      return {
        tone: "warn",
        text: "Photo intake and your public shop page are paused because a payment didn't go through. Your register, receipts, and data export are all still working.",
        href: "/app/settings",
      };
    case "canceled":
      return {
        tone: "info",
        text: "This subscription has ended. You can still ring up sales and export everything you have.",
        href: "/app/settings",
      };
    case "trialing": {
      // Read off the entitlements object rather than recomputed from
      // Date.now() here — see the field's own comment for why that distinction
      // matters.
      const days = entitlements.daysOfTrialLeft;
      if (days === null) return null;
      // Only worth mentioning near the end. A countdown from day one is
      // pressure, not information.
      if (days > 7) return null;
      return {
        tone: "info",
        text: `${days} ${days === 1 ? "day" : "days"} left of your trial. Nothing switches off when it ends — the register keeps working either way.`,
        href: "/app/settings",
      };
    }
    default:
      return null;
  }
}
