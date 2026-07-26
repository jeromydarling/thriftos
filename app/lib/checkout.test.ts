import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The order of operations in an online checkout.
 *
 * These are source-level assertions, and that is deliberate. What matters here
 * isn't the value a function returns — it's the *sequence*: price, snapshot,
 * hold, then charge. A unit test that stubbed Stripe and the database would
 * assert the sequence I wrote rather than the sequence that ships, and the
 * failure being guarded against is somebody reordering two awaits in six
 * months because it read more naturally.
 */
const src = readFileSync("app/lib/checkout.ts", "utf8");

const at = (needle: string) => {
  const i = src.indexOf(needle);
  expect(i, `not found in checkout.ts: ${needle}`).toBeGreaterThan(-1);
  return i;
};

describe("goods are held before money is asked for", () => {
  it("reserves stock before creating a payment intent", () => {
    // Reversed, a shop charges a card for a jumper somebody bought at the
    // counter thirty seconds earlier, and owes a stranger a refund.
    expect(at("reserveItems(")).toBeLessThan(at("createOnlineIntent("));
  });

  it("prices the order before reserving anything", () => {
    expect(at("priceOrder(")).toBeLessThan(at("reserveItems("));
  });

  it("snapshots the lines before taking payment", () => {
    // The receipt must not change if the item is re-priced or re-tagged later.
    expect(at("INSERT INTO transaction_items")).toBeLessThan(at("createOnlineIntent("));
  });

  it("opens a payment attempt before calling Stripe", () => {
    // The attempt carries the idempotency key. Calling Stripe first means a
    // retry can charge twice.
    expect(at("openAttempt(")).toBeLessThan(at("createOnlineIntent("));
  });

  it("passes the attempt's idempotency key to Stripe", () => {
    expect(src).toMatch(/createOnlineIntent\([\s\S]{0,600}attempt\.idempotency_key/);
  });
});

describe("nothing is sold before the money is real", () => {
  it("never marks an item sold in this file", () => {
    // Inventory becomes 'sold' in the webhook, when Stripe says the payment
    // reached an approved terminal state — never optimistically here.
    expect(src).not.toMatch(/status\s*=\s*'sold'/);
    expect(src).not.toMatch(/"succeeded"/);
  });

  it("releases the hold when Stripe can't be reached", () => {
    // Leaving them held over an error the shopper never saw would take a coat
    // out of a shop with nobody able to clear it.
    expect(src).toMatch(/catch[\s\S]{0,400}applyInventoryEffect\([^)]*"failed"\)/);
  });

  it("releases the hold when somebody else got the item first", () => {
    expect(src).toMatch(/reservation\.unavailable[\s\S]{0,400}applyInventoryEffect\([^)]*"canceled"\)/);
  });

  it("says nothing was charged when it wasn't", () => {
    // A shopper who reads "somebody got there first" needs to know their card
    // is untouched, in the same sentence.
    expect(src).toMatch(/nothing has been charged/i);
  });
});

describe("money is computed, never received", () => {
  it("parses no money out of a form or body", () => {
    // Targeted rather than a broad word search — the loose version matched
    // `newRequestId()` next to a logged `amountCents` and cried wolf. The real
    // risk is a money field being read from what the browser sent.
    expect(src).not.toMatch(/(Number|parseInt|parseFloat)\([^)]*\b(form|body|params|query)\b/);
    expect(src).not.toMatch(/\b(form|body)\.get\(["'](amount|total|price|shipping|fee)/i);
  });

  it("charges the total it computed", () => {
    expect(src).toMatch(/amountCents:\s*totals\.totalCents/);
  });

  it("keeps postage out of the platform fee base", () => {
    // Postage is a pass-through to a carrier, exactly as tax is to the state.
    // A percentage of it would mean earning more the heavier a coat is.
    // Slice to the end of the call, not a fixed window — a wide window caught
    // `totalCents` from the code after it and failed for the wrong reason.
    const start = at("quotePlatformFee(");
    const feeCall = src.slice(start, src.indexOf("});", start) + 3);
    expect(feeCall).toContain("merchandiseSubtotalCents");
    expect(feeCall).not.toContain("shippingCents");
    // `totals.totalCents`, anchored — a bare "totalCents" is a substring of
    // "subtotalCents" and fails on the correct code.
    expect(feeCall).not.toMatch(/\btotals\.totalCents\b/);
  });
});

describe("what the shopper is told", () => {
  it("names the item that went rather than counting it", () => {
    // "One item is no longer available" makes somebody re-read their basket to
    // work out which one.
    expect(src).toMatch(/gone\??:/);
    expect(src).toMatch(/\$\{totals\.unavailable\[0\]\.title\}/);
  });

  it("refuses an order it cannot post, with the reason", () => {
    expect(src).toMatch(/method === "ship" && !totals\.shipping\?\.band/);
    expect(src).toMatch(/totals\.shipping\?\.reason/);
  });

  it("asks for an address only when something is being posted", () => {
    expect(src).toMatch(/if \(method === "ship"\)[\s\S]{0,300}street address/);
  });
});

describe("abandoned checkouts put the goods back", () => {
  it("only releases holds that are still mid-payment", () => {
    // A succeeded payment owns its items; a failed one released them already.
    expect(src).toMatch(/payment_state IN \('draft','processing','requires_action'\)/);
  });

  it("only touches online orders", () => {
    // A register sale sitting in `processing` is a reader waiting for a tap,
    // and pulling its items out from under the cashier would be worse than the
    // problem this solves.
    expect(src).toMatch(/releaseExpiredHolds[\s\S]{0,600}channel = 'online'/);
  });

  it("says why the items went back", () => {
    expect(src).toMatch(/void_reason = 'Checkout not completed/);
  });
});
