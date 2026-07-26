import { describe, expect, it } from "vitest";
import { canAcceptPayments, deriveStatus, statusExplanation, type ConnectStatus } from "./connect";
import { toFormBody, verifyWebhookSignature, stripeReadiness, isTestMode } from "./client";

const base = { id: "acct_test", country: "US", default_currency: "usd" };

describe("deriving account status from Stripe", () => {
  it("is enabled only when charges AND payouts are both on", () => {
    expect(
      deriveStatus({ ...base, charges_enabled: true, payouts_enabled: true })
    ).toBe("enabled");

    // Charges on but payouts off is not "enabled" — the shop can take money it
    // cannot then receive, which is a worse state than being told to wait.
    expect(
      deriveStatus({ ...base, charges_enabled: true, payouts_enabled: false })
    ).not.toBe("enabled");
  });

  it("treats a rejection as disabled, and any other block as restricted", () => {
    expect(
      deriveStatus({ ...base, requirements: { disabled_reason: "rejected.fraud" } })
    ).toBe("disabled");

    expect(
      deriveStatus({ ...base, requirements: { disabled_reason: "requirements.past_due" } })
    ).toBe("restricted");
  });

  it("puts a disabled reason ahead of outstanding requirements", () => {
    // Both are true at once constantly; the more severe one must win.
    expect(
      deriveStatus({
        ...base,
        requirements: { disabled_reason: "rejected.terms_of_service", currently_due: ["dob"] },
      })
    ).toBe("disabled");
  });

  it("distinguishes 'never finished' from 'finished but needs more'", () => {
    expect(
      deriveStatus({ ...base, details_submitted: false, requirements: { currently_due: ["dob"] } })
    ).toBe("onboarding_incomplete");

    expect(
      deriveStatus({ ...base, details_submitted: true, requirements: { currently_due: ["dob"] } })
    ).toBe("requirements_due");
  });

  it("reports pending verification while Stripe is checking", () => {
    expect(
      deriveStatus({
        ...base,
        details_submitted: true,
        requirements: { pending_verification: ["document"] },
      })
    ).toBe("pending_verification");
  });

  it("returns account_created for a brand-new, untouched account", () => {
    expect(deriveStatus(base)).toBe("account_created");
  });
});

describe("payments are gated on verified capability", () => {
  it("allows payments only for an enabled account with charges on", () => {
    expect(
      canAcceptPayments({
        id: "sa_1", orgId: "og_1", stripeAccountId: "acct_1", status: "enabled",
        chargesEnabled: true, payoutsEnabled: true, detailsSubmitted: true,
        disabledReason: null, currentlyDue: [], eventuallyDue: [], lastSyncedAt: null,
      })
    ).toBe(true);
  });

  it("refuses for every non-enabled status", () => {
    const statuses: ConnectStatus[] = [
      "not_started", "account_created", "onboarding_incomplete",
      "requirements_due", "pending_verification", "restricted", "disabled",
    ];
    for (const status of statuses) {
      expect(
        canAcceptPayments({
          id: "sa_1", orgId: "og_1", stripeAccountId: "acct_1", status,
          chargesEnabled: true, payoutsEnabled: true, detailsSubmitted: true,
          disabledReason: null, currentlyDue: [], eventuallyDue: [], lastSyncedAt: null,
        }),
        status
      ).toBe(false);
    }
  });

  it("refuses when there is no account at all", () => {
    expect(canAcceptPayments(null)).toBe(false);
  });
});

describe("status is explained in words a volunteer understands", () => {
  it("has a headline and detail for every status", () => {
    const statuses: ConnectStatus[] = [
      "not_started", "account_created", "onboarding_incomplete", "requirements_due",
      "pending_verification", "enabled", "restricted", "disabled",
    ];
    for (const status of statuses) {
      const e = statusExplanation(status);
      expect(e.headline.length, status).toBeGreaterThan(5);
      expect(e.detail.length, status).toBeGreaterThan(20);
      // No Stripe jargon leaking into the UI.
      expect(e.headline.toLowerCase()).not.toMatch(/requirements_due|currently_due|acct_/);
    }
  });

  it("reassures that cash still works when payments are off", () => {
    expect(statusExplanation("disabled").detail.toLowerCase()).toMatch(/cash/);
    expect(statusExplanation("not_started").detail.toLowerCase()).toMatch(/cash/);
  });
});

describe("webhook signature verification", () => {
  const secret = "whsec_test_secret";
  const payload = '{"id":"evt_1","type":"account.updated"}';

  async function sign(body: string, timestamp: number, withSecret = secret) {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(withSecret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const sig = await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(`${timestamp}.${body}`)
    );
    return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  it("accepts a correctly signed payload", async () => {
    const ts = 1_700_000_000;
    const header = `t=${ts},v1=${await sign(payload, ts)}`;
    expect((await verifyWebhookSignature(payload, header, secret, 300, ts)).valid).toBe(true);
  });

  it("rejects a payload signed with the wrong secret", async () => {
    const ts = 1_700_000_000;
    const header = `t=${ts},v1=${await sign(payload, ts, "whsec_wrong")}`;
    const result = await verifyWebhookSignature(payload, header, secret, 300, ts);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("signature mismatch");
  });

  it("rejects a tampered body even with a valid-looking signature", async () => {
    const ts = 1_700_000_000;
    const header = `t=${ts},v1=${await sign(payload, ts)}`;
    const tampered = payload.replace("account.updated", "account.deleted");
    expect((await verifyWebhookSignature(tampered, header, secret, 300, ts)).valid).toBe(false);
  });

  it("rejects a replay of an old but validly-signed payload", async () => {
    const ts = 1_700_000_000;
    const header = `t=${ts},v1=${await sign(payload, ts)}`;
    // Same signature, checked an hour later.
    const result = await verifyWebhookSignature(payload, header, secret, 300, ts + 3_600);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("timestamp outside tolerance");
  });

  it("accepts when any one of several signatures matches, for key rotation", async () => {
    const ts = 1_700_000_000;
    const header = `t=${ts},v1=${await sign(payload, ts, "whsec_old")},v1=${await sign(payload, ts)}`;
    expect((await verifyWebhookSignature(payload, header, secret, 300, ts)).valid).toBe(true);
  });

  it("rejects a missing or malformed header rather than throwing", async () => {
    expect((await verifyWebhookSignature(payload, null, secret)).valid).toBe(false);
    expect((await verifyWebhookSignature(payload, "garbage", secret)).valid).toBe(false);
    expect((await verifyWebhookSignature(payload, "t=123", secret)).valid).toBe(false);
  });
});

describe("form encoding for the Stripe API", () => {
  it("flattens nested objects into bracket notation", () => {
    const body = toFormBody({
      type: "express",
      business_profile: { name: "Second Chances", mcc: "5931" },
    });
    expect(body.get("type")).toBe("express");
    expect(body.get("business_profile[name]")).toBe("Second Chances");
    expect(body.get("business_profile[mcc]")).toBe("5931");
  });

  it("flattens deeply nested capability requests", () => {
    const body = toFormBody({ capabilities: { card_payments: { requested: true } } });
    expect(body.get("capabilities[card_payments][requested]")).toBe("true");
  });

  it("indexes arrays", () => {
    const body = toFormBody({ expand: ["a", "b"] });
    expect(body.get("expand[0]")).toBe("a");
    expect(body.get("expand[1]")).toBe("b");
  });

  it("omits null and undefined rather than sending the string 'null'", () => {
    const body = toFormBody({ email: null, name: undefined, id: "x" });
    expect(body.has("email")).toBe(false);
    expect(body.has("name")).toBe(false);
    expect(body.get("id")).toBe("x");
  });
});

describe("configuration guard", () => {
  it("refuses to consider payments configured without both secrets", () => {
    expect(stripeReadiness({}).configured).toBe(false);
    expect(stripeReadiness({ STRIPE_SECRET_KEY: "sk_test_x" }).configured).toBe(false);
    expect(
      stripeReadiness({ STRIPE_SECRET_KEY: "sk_test_x", STRIPE_WEBHOOK_SECRET: "whsec_x" })
        .configured
    ).toBe(true);
  });

  it("names exactly what is missing", () => {
    expect(stripeReadiness({}).missing).toEqual([
      "STRIPE_SECRET_KEY",
      "STRIPE_WEBHOOK_SECRET",
    ]);
  });

  it("recognises test-mode keys so the UI can label them", () => {
    expect(isTestMode("sk_test_abc")).toBe(true);
    expect(isTestMode("sk_live_abc")).toBe(false);
    expect(isTestMode(undefined)).toBe(false);
  });
});
