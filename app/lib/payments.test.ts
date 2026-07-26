import { describe, expect, it } from "vitest";
import {
  APPROVED_STATES,
  assertTransition,
  canTransition,
  initialStateForTender,
  inventoryEffectFor,
  isApproved,
  isOfflineEligible,
  isPending,
  PENDING_STATES,
  type PaymentState,
} from "./payments";

describe("inventory follows payment state, never the other way round", () => {
  it("only sells an item once the payment is genuinely approved", () => {
    // This is the rule the old code broke: it sold on sync, regardless.
    for (const state of APPROVED_STATES) {
      expect(inventoryEffectFor(state), state).toBe("sell");
    }
  });

  it("reserves rather than sells while a payment is in flight", () => {
    for (const state of PENDING_STATES) {
      expect(inventoryEffectFor(state), state).toBe("reserve");
    }
  });

  it("puts an item back on the floor when a payment fails or is cancelled", () => {
    expect(inventoryEffectFor("failed")).toBe("release");
    expect(inventoryEffectFor("canceled")).toBe("release");
  });

  it("never sells on a state that only looks finished", () => {
    // A reader accepting an action is not an authorisation, and neither is an
    // HTTP 200 from our own API.
    expect(isApproved("processing")).toBe(false);
    expect(isApproved("awaiting_reader")).toBe(false);
    expect(isApproved("requires_action")).toBe(false);
    expect(isApproved("offline_pending")).toBe(false);
    expect(inventoryEffectFor("awaiting_reader")).not.toBe("sell");
  });

  it("does not put goods back on the shelf on a dispute", () => {
    // The customer still has the coat. A dispute is a financial event, not a
    // return, and the returns flow decides what physically comes back.
    expect(inventoryEffectFor("disputed")).toBe("sell");
    expect(inventoryEffectFor("refunded")).toBe("none");
  });

  it("classifies every state as exactly one of approved, pending, or released", () => {
    const states: PaymentState[] = [
      "draft", "awaiting_reader", "processing", "requires_action", "succeeded",
      "failed", "canceled", "offline_pending", "partially_refunded", "refunded", "disputed",
    ];
    for (const state of states) {
      const flags = [isApproved(state), isPending(state)].filter(Boolean).length;
      expect(flags, `${state} is both approved and pending`).toBeLessThanOrEqual(1);
    }
  });
});

describe("transitions", () => {
  it("allows the normal terminal-payment path", () => {
    expect(canTransition("draft", "awaiting_reader")).toBe(true);
    expect(canTransition("awaiting_reader", "processing")).toBe(true);
    expect(canTransition("processing", "succeeded")).toBe(true);
  });

  it("lets a failed payment be retried as a new attempt, not resurrected", () => {
    // failed is terminal for *this* attempt. A retry creates a new one.
    expect(canTransition("failed", "succeeded")).toBe(false);
    expect(canTransition("failed", "processing")).toBe(false);
    expect(canTransition("canceled", "succeeded")).toBe(false);
  });

  it("allows a succeeded payment to be refunded or disputed", () => {
    expect(canTransition("succeeded", "refunded")).toBe(true);
    expect(canTransition("succeeded", "partially_refunded")).toBe(true);
    expect(canTransition("succeeded", "disputed")).toBe(true);
  });

  it("never lets a refund reopen as a fresh sale", () => {
    expect(canTransition("refunded", "succeeded")).toBe(false);
  });

  it("treats a repeated state as legal, because webhooks arrive twice", () => {
    expect(canTransition("succeeded", "succeeded")).toBe(true);
    expect(() => assertTransition("succeeded", "succeeded")).not.toThrow();
  });

  it("throws loudly on an illegal jump rather than applying it", () => {
    expect(() => assertTransition("failed", "succeeded")).toThrow(/Illegal/);
  });
});

describe("tender decides the starting state", () => {
  it("approves cash immediately — a person counted it", () => {
    expect(initialStateForTender("cash")).toBe("succeeded");
    expect(initialStateForTender("other")).toBe("succeeded");
  });

  it("never approves a Terminal payment on arrival", () => {
    expect(initialStateForTender("terminal")).toBe("awaiting_reader");
    expect(isApproved(initialStateForTender("terminal"))).toBe(false);
  });

  it("routes card through the reader once Stripe is live", () => {
    expect(initialStateForTender("card", { stripeConfigured: true })).toBe("awaiting_reader");
    // While Stripe is dark the shop collected elsewhere and is recording it.
    expect(initialStateForTender("card", { stripeConfigured: false })).toBe("succeeded");
  });
});

describe("what may be queued offline", () => {
  it("always allows cash", () => {
    expect(isOfflineEligible("cash", true)).toBe(true);
    expect(isOfflineEligible("cash", false)).toBe(true);
  });

  it("never allows a Terminal payment from the offline queue", () => {
    // Offline card collection needs a native SDK and eligible hardware. The web
    // POS has neither, so queuing one would promise an authorisation we cannot
    // obtain — and the customer would have walked out with the goods.
    expect(isOfflineEligible("terminal", true)).toBe(false);
    expect(isOfflineEligible("terminal", false)).toBe(false);
  });

  it("stops accepting queued card sales once Stripe is live", () => {
    expect(isOfflineEligible("card", true)).toBe(false);
    expect(isOfflineEligible("card", false)).toBe(true);
  });
});
