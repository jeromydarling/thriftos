import { describe, expect, it } from "vitest";
import { planRefund, RefundError } from "./refunds";

/**
 * A stub returning one transaction row.
 *
 * `planRefund` is where the refund arithmetic lives — how much may still be
 * returned, and how much of our fee goes back with it. Those are the
 * assertions worth making directly.
 */
function stubTx(overrides: Partial<Record<string, unknown>> = {}) {
  const row = {
    total_cents: 2150,
    subtotal_cents: 2000,
    tax_cents: 150,
    roundup_cents: 50,
    refunded_cents: 0,
    fee_refunded_cents: 0,
    platform_fee_cents: 10,
    fee_base_cents: 2000,
    tender: "terminal",
    payment_state: "succeeded",
    voided_at: null,
    ...overrides,
  };

  return {
    prepare: () => ({
      bind: () => ({
        first: async () => row,
        all: async () => ({ results: [] }),
        run: async () => ({ meta: { changes: 1 } }),
      }),
    }),
  } as unknown as D1Database;
}

const req = { orgId: "og_1", transactionId: "tx_1" };

describe("planRefund", () => {
  it("returns the full platform fee on a full merchandise refund", async () => {
    const plan = await planRefund(stubTx(), { ...req, amountCents: 2000 });
    expect(plan.feeRefundCents).toBe(10);
  });

  it("returns the fee proportionally on a partial refund", async () => {
    const plan = await planRefund(stubTx(), { ...req, amountCents: 1000 });
    expect(plan.feeRefundCents).toBe(5);
  });

  it("rounds a fractional fee refund in the shop's favour", async () => {
    // 3¢ of a 10¢ fee on 2000 base is 1.5¢. Rounding down would keep half a
    // cent that isn't ours; the shop gets the rounding.
    const plan = await planRefund(stubTx(), { ...req, amountCents: 300 });
    expect(plan.feeRefundCents).toBe(2);
  });

  it("returns no fee when only tax is refunded", async () => {
    // We never charged a fee on tax, so there is nothing to hand back.
    const plan = await planRefund(stubTx(), { ...req, amountCents: 0, taxCents: 150 });
    expect(plan.feeRefundCents).toBe(0);
    expect(plan.amountCents).toBe(150);
  });

  it("never returns more fee than remains", async () => {
    const plan = await planRefund(
      stubTx({ fee_refunded_cents: 8 }),
      { ...req, amountCents: 2000 }
    );
    expect(plan.feeRefundCents).toBe(2);
  });

  it("excludes the round-up from what can be refunded", async () => {
    // A round-up is a donation the customer chose to make. Handing it back
    // silently would misstate what the shop received.
    const plan = await planRefund(stubTx(), { ...req, amountCents: 2000, taxCents: 150 });
    expect(plan.refundableCents).toBe(2150);
  });

  it("subtracts what has already come back", async () => {
    const plan = await planRefund(
      stubTx({ refunded_cents: 500, payment_state: "partially_refunded" }),
      { ...req, amountCents: 100 }
    );
    expect(plan.refundableCents).toBe(1650);
  });

  it("refuses to refund more than remains", async () => {
    await expect(
      planRefund(stubTx({ refunded_cents: 2000 }), { ...req, amountCents: 500 })
    ).rejects.toThrow(/At most/);
  });

  it("refuses a refund of nothing", async () => {
    await expect(planRefund(stubTx(), { ...req, amountCents: 0 })).rejects.toBeInstanceOf(
      RefundError
    );
  });

  it("refuses to refund a payment that never completed", async () => {
    await expect(
      planRefund(stubTx({ payment_state: "failed" }), { ...req, amountCents: 100 })
    ).rejects.toThrow(/never completed/);
  });

  it("refuses to refund a voided sale", async () => {
    await expect(
      planRefund(stubTx({ voided_at: "2026-01-01" }), { ...req, amountCents: 100 })
    ).rejects.toThrow(/voided/);
  });

  it("allows refunding a disputed sale", async () => {
    // A shop may choose to refund rather than fight a dispute.
    const plan = await planRefund(stubTx({ payment_state: "disputed" }), {
      ...req,
      amountCents: 100,
    });
    expect(plan.amountCents).toBe(100);
  });

  it("reports a cash sale as cash, so no Stripe call is attempted", async () => {
    const plan = await planRefund(stubTx({ tender: "cash", platform_fee_cents: 0 }), {
      ...req,
      amountCents: 500,
    });
    expect(plan.tender).toBe("cash");
    expect(plan.feeRefundCents).toBe(0);
  });

  it("returns nothing when there was no fee to begin with", async () => {
    const plan = await planRefund(
      stubTx({ platform_fee_cents: 0, fee_base_cents: 0 }),
      { ...req, amountCents: 2000 }
    );
    expect(plan.feeRefundCents).toBe(0);
  });
});
