import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assertRealShop, DemoChargeRefused } from "./demo-guard";

/** A D1 stand-in that answers one row. */
function dbReturning(row: unknown): D1Database {
  return {
    prepare: () => ({
      bind: () => ({ first: async () => row }),
    }),
  } as unknown as D1Database;
}

describe("a demo shop cannot take real money", () => {
  it("refuses a demo org", async () => {
    await expect(assertRealShop(dbReturning({ is_demo: 1 }), "org_demo")).rejects.toBeInstanceOf(
      DemoChargeRefused
    );
  });

  it("allows a real shop", async () => {
    await expect(assertRealShop(dbReturning({ is_demo: 0 }), "org_real")).resolves.toBeUndefined();
  });

  it("refuses an org it can't find", async () => {
    // A missing row is not a licence to charge somebody's card.
    await expect(assertRealShop(dbReturning(null), "org_gone")).rejects.toBeInstanceOf(
      DemoChargeRefused
    );
  });

  it("says nothing was charged, because nothing was", async () => {
    await expect(assertRealShop(dbReturning({ is_demo: 1 }), "org_demo")).rejects.toThrow(
      /nothing has been charged/i
    );
  });

  it("points at the thing that does work", async () => {
    // A dead end teaches a shop nothing. Cash still runs the whole till.
    await expect(assertRealShop(dbReturning({ is_demo: 1 }), "org_demo")).rejects.toThrow(/cash/i);
  });
});

describe("where the guard sits", () => {
  const checkout = readFileSync("app/lib/checkout.ts", "utf8");
  const pos = readFileSync("app/api/pos.ts", "utf8");

  it("runs before the online checkout session is created", () => {
    const guard = checkout.indexOf("assertRealShop(db, opts.orgId)");
    const session = checkout.indexOf("await createHostedCheckout(");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(session);
  });

  it("runs before the card-present intent is created", () => {
    const guard = pos.indexOf("assertRealShop(c.env.DB");
    const intent = pos.indexOf("await createCardPresentIntent(");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(intent);
  });

  it("guards every place a charge is created, not just the two we remembered", () => {
    // If a third charge path appears, this fails until it is guarded too.
    for (const [name, src] of [
      ["checkout.ts", checkout],
      ["pos.ts", pos],
    ] as const) {
      const charges = (src.match(/createCardPresentIntent\(|createHostedCheckout\(/g) ?? []).filter(
        (m) => m.endsWith("(")
      );
      // One import mention plus one call site in each file.
      expect(charges.length, name).toBeLessThanOrEqual(2);
      expect(src, name).toContain("assertRealShop");
    }
  });

  it("lets the refusal reach the person, rather than a generic failure", () => {
    // Both catch blocks flatten errors to a house message. This one has to
    // survive that, or the demo's card path is a dead end with no explanation.
    expect(checkout).toContain("err instanceof DemoChargeRefused");
    expect(pos).toContain("err instanceof DemoChargeRefused");
  });

  it("leaves cash alone", () => {
    // Nothing leaves anybody's pocket on a demo cash sale, and the demo exists
    // to let people use the register. Cash sales are recorded in api/index.ts,
    // not here — the invariant worth pinning is that that path creates no
    // Stripe charge at all, so there is nothing for the guard to stand in
    // front of.
    const sales = readFileSync("app/api/index.ts", "utf8");
    expect(sales).toContain(`tender === "cash"`);
    expect(sales).not.toMatch(/createCardPresentIntent|createHostedCheckout/);
    expect(sales).not.toContain("assertRealShop");
  });
});
