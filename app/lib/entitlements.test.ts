import { describe, expect, it } from "vitest";
import { billingNotice, can, getEntitlements, reasonUnavailable } from "./entitlements";
import { ALWAYS_AVAILABLE } from "./pricing";

const DAY = 86_400_000;
const NOW = new Date("2026-07-26T12:00:00Z");
const inDays = (n: number) => new Date(NOW.getTime() + n * DAY).toISOString();

function stubDb(opts: {
  plan?: string;
  sub?: Record<string, unknown> | null;
  locations?: number;
}) {
  return {
    prepare(sql: string) {
      return {
        bind: () => ({
          first: async () => {
            if (/FROM orgs/i.test(sql)) return { plan: opts.plan ?? "core" };
            if (/FROM tenant_subscriptions/i.test(sql)) return opts.sub ?? null;
            if (/FROM locations/i.test(sql)) return { n: opts.locations ?? 1 };
            return null;
          },
          all: async () => ({ results: [] }),
          run: async () => ({ meta: { changes: 0 } }),
        }),
      };
    },
  } as unknown as D1Database;
}

describe("the promise that is never broken", () => {
  it("keeps the register on in every billing state", async () => {
    const states = [
      { status: "past_due", grace_ends_at: inDays(-30) },
      { status: "canceled" },
      { status: "incomplete", grace_ends_at: inDays(-1) },
      { status: "trialing", trial_ends_at: inDays(-10) },
    ];

    for (const sub of states) {
      const ent = await getEntitlements(stubDb({ sub }), "og_1", NOW);
      expect(can(ent, "register"), sub.status).toBe(true);
      expect(can(ent, "cash_checkout"), sub.status).toBe(true);
      expect(can(ent, "receipts"), sub.status).toBe(true);
    }
  });

  it("keeps data export on even for a canceled shop", async () => {
    // A shop that wants to leave must always be able to leave with its
    // records. This is the one that would make the marketing a lie.
    const ent = await getEntitlements(stubDb({ sub: { status: "canceled" } }), "og_1", NOW);
    expect(can(ent, "data_export")).toBe(true);
  });

  it("keeps card checkout on, because the money is the shop's not ours", async () => {
    const ent = await getEntitlements(
      stubDb({ sub: { status: "past_due", grace_ends_at: inDays(-30) } }),
      "og_1",
      NOW
    );
    expect(can(ent, "card_checkout")).toBe(true);
  });

  it("honours everything named in ALWAYS_AVAILABLE", async () => {
    const ent = await getEntitlements(stubDb({ sub: { status: "canceled" } }), "og_1", NOW);
    for (const feature of ALWAYS_AVAILABLE) {
      expect(can(ent, feature), feature).toBe(true);
    }
  });
});

describe("billing states", () => {
  it("treats a missing subscription as active, not as locked out", async () => {
    // Failing closed on our own missing row would be the worst possible
    // behaviour for this function.
    const ent = await getEntitlements(stubDb({ sub: null }), "og_1", NOW);
    expect(ent.state).toBe("active");
    expect(ent.full).toBe(true);
  });

  it("gives a live trial everything", async () => {
    const ent = await getEntitlements(
      stubDb({ sub: { status: "trialing", trial_ends_at: inDays(10) } }),
      "og_1",
      NOW
    );
    expect(ent.state).toBe("trialing");
    expect(can(ent, "ai_intake")).toBe(true);
  });

  it("treats an expired trial like past due, not like a lockout", async () => {
    const ent = await getEntitlements(
      stubDb({ sub: { status: "trialing", trial_ends_at: inDays(-1) } }),
      "og_1",
      NOW
    );
    expect(ent.state).toBe("past_due");
    expect(can(ent, "register")).toBe(true);
  });

  it("keeps everything on during grace", async () => {
    const ent = await getEntitlements(
      stubDb({ sub: { status: "past_due", grace_ends_at: inDays(5) } }),
      "og_1",
      NOW
    );
    expect(ent.state).toBe("grace");
    expect(ent.full).toBe(true);
    expect(can(ent, "ai_intake")).toBe(true);
    expect(ent.daysOfGraceLeft).toBe(5);
  });

  it("pauses the discretionary half once grace runs out", async () => {
    const ent = await getEntitlements(
      stubDb({ sub: { status: "past_due", grace_ends_at: inDays(-1) } }),
      "og_1",
      NOW
    );
    expect(ent.state).toBe("suspended");
    expect(can(ent, "ai_intake")).toBe(false);
    expect(can(ent, "storefront")).toBe(false);
    expect(can(ent, "impact_report")).toBe(false);
  });

  it("assumes the full grace period when nobody recorded an end date", async () => {
    // The benefit of our own missing data goes to the shop.
    const ent = await getEntitlements(
      stubDb({ sub: { status: "past_due", grace_ends_at: null } }),
      "og_1",
      NOW
    );
    expect(ent.state).toBe("grace");
  });
});

describe("location limits", () => {
  it("lets a single-location plan add its first location", async () => {
    const ent = await getEntitlements(stubDb({ plan: "core", locations: 0 }), "og_1", NOW);
    expect(can(ent, "add_location")).toBe(true);
  });

  it("stops a single-location plan adding a second", async () => {
    const ent = await getEntitlements(stubDb({ plan: "core", locations: 1 }), "og_1", NOW);
    expect(can(ent, "add_location")).toBe(false);
    expect(reasonUnavailable(ent, "add_location")).toMatch(/doesn't change your fees/);
  });

  it("lets a federation plan run several", async () => {
    const ent = await getEntitlements(stubDb({ plan: "federation", locations: 3 }), "og_1", NOW);
    expect(can(ent, "add_location")).toBe(true);
  });

  it("puts no ceiling on enterprise", async () => {
    const ent = await getEntitlements(stubDb({ plan: "enterprise", locations: 40 }), "og_1", NOW);
    expect(ent.maxLocations).toBeNull();
    expect(can(ent, "add_location")).toBe(true);
  });
});

describe("what a shop is told", () => {
  it("says nothing during a healthy subscription", async () => {
    const ent = await getEntitlements(stubDb({ sub: { status: "active" } }), "og_1", NOW);
    expect(billingNotice(ent)).toBeNull();
  });

  it("says nothing early in a trial — a countdown from day one is pressure", async () => {
    const ent = await getEntitlements(
      stubDb({ sub: { status: "trialing", trial_ends_at: inDays(25) } }),
      "og_1",
      NOW
    );
    expect(billingNotice(ent)).toBeNull();
  });

  it("mentions a trial in its last week", async () => {
    const ent = await getEntitlements(
      stubDb({ sub: { status: "trialing", trial_ends_at: inDays(3) } }),
      "og_1",
      NOW
    );
    expect(billingNotice(ent)?.text).toMatch(/register keeps working/);
  });

  it("promises the register during grace", async () => {
    const ent = await getEntitlements(
      stubDb({ sub: { status: "past_due", grace_ends_at: inDays(4) } }),
      "og_1",
      NOW
    );
    const notice = billingNotice(ent);
    expect(notice?.tone).toBe("warn");
    expect(notice?.text).toMatch(/register never does/);
  });

  it("names what still works when suspended, rather than only what doesn't", async () => {
    const ent = await getEntitlements(
      stubDb({ sub: { status: "past_due", grace_ends_at: inDays(-5) } }),
      "og_1",
      NOW
    );
    const notice = billingNotice(ent);
    expect(notice?.text).toMatch(/register, receipts, and data export/);
  });

  it("gives a reason a shop owner would recognise", async () => {
    const ent = await getEntitlements(
      stubDb({ sub: { status: "past_due", grace_ends_at: inDays(-5) } }),
      "og_1",
      NOW
    );
    const reason = reasonUnavailable(ent, "ai_intake");
    expect(reason).toMatch(/grace period has run out/);
    expect(reason).toMatch(/comes straight back/);
  });

  it("returns no reason for something that is available", async () => {
    const ent = await getEntitlements(stubDb({ sub: { status: "active" } }), "og_1", NOW);
    expect(reasonUnavailable(ent, "ai_intake")).toBeNull();
  });
});
