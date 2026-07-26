import { describe, expect, it } from "vitest";
import { LedgerSignError, REVENUE_TYPES, saleEntries } from "./ledger";
import { record } from "./ledger";

/**
 * A stub that records the statements a write would produce.
 *
 * The ledger's job is arithmetic and sign discipline; testing it against a
 * fake keeps those assertions direct rather than filtered through D1.
 */
function stubDb(changes = 1) {
  const calls: { sql: string; params: unknown[] }[] = [];
  const db = {
    prepare(sql: string) {
      return {
        bind: (...params: unknown[]) => ({
          run: async () => {
            calls.push({ sql, params });
            return { meta: { changes } };
          },
          first: async () => null,
          all: async () => ({ results: [] }),
        }),
      };
    },
  } as unknown as D1Database;
  return { db, calls };
}

describe("sign discipline", () => {
  it("refuses a positive platform fee", async () => {
    const { db } = stubDb();
    await expect(
      record(db, {
        orgId: "og_1",
        entryType: "platform_fee",
        amountCents: 50,
        dedupeKey: "fee:tx_1",
      })
    ).rejects.toBeInstanceOf(LedgerSignError);
  });

  it("accepts a negative platform fee", async () => {
    const { db, calls } = stubDb();
    await expect(
      record(db, {
        orgId: "og_1",
        entryType: "platform_fee",
        amountCents: -50,
        dedupeKey: "fee:tx_1",
      })
    ).resolves.toBe(true);
    expect(calls[0].params).toContain(-50);
  });

  it("refuses a negative sale", async () => {
    const { db } = stubDb();
    await expect(
      record(db, {
        orgId: "og_1",
        entryType: "gross_sale",
        amountCents: -100,
        dedupeKey: "sale:tx_1",
      })
    ).rejects.toBeInstanceOf(LedgerSignError);
  });

  it("lets a drawer be over or short", async () => {
    const { db } = stubDb();
    await expect(
      record(db, {
        orgId: "og_1",
        entryType: "cash_variance",
        amountCents: -340,
        dedupeKey: "variance:rs_1",
      })
    ).resolves.toBe(true);
    await expect(
      record(db, {
        orgId: "og_1",
        entryType: "cash_variance",
        amountCents: 120,
        dedupeKey: "variance:rs_2",
      })
    ).resolves.toBe(true);
  });

  it("reports a duplicate as not-written rather than throwing", async () => {
    const { db } = stubDb(0);
    await expect(
      record(db, {
        orgId: "og_1",
        entryType: "gross_sale",
        amountCents: 100,
        dedupeKey: "sale:tx_1",
      })
    ).resolves.toBe(false);
  });

  it("writes with INSERT OR IGNORE so a replay can't double the books", async () => {
    const { db, calls } = stubDb();
    await record(db, {
      orgId: "og_1",
      entryType: "gross_sale",
      amountCents: 100,
      dedupeKey: "sale:tx_1",
    });
    expect(calls[0].sql).toMatch(/INSERT OR IGNORE/i);
  });
});

describe("saleEntries", () => {
  const base = {
    orgId: "og_1",
    transactionId: "tx_1",
    subtotalCents: 2000,
    taxCents: 150,
    roundUpCents: 50,
    platformFeeCents: 10,
  };

  it("splits a card sale into its parts", () => {
    const entries = saleEntries({ ...base, tender: "terminal" });
    const types = entries.map((e) => e.entryType);
    expect(types).toEqual(["gross_sale", "tax", "round_up", "platform_fee"]);
  });

  it("keeps tax and round-up out of the sale line", () => {
    const [sale] = saleEntries({ ...base, tender: "terminal" });
    // Reporting tax as revenue would overstate every downstream figure — the
    // money belongs to the state, not the shop.
    expect(sale.amountCents).toBe(2000);
  });

  it("calls a cash sale a cash sale", () => {
    const entries = saleEntries({ ...base, tender: "cash", platformFeeCents: 0 });
    expect(entries[0].entryType).toBe("cash_sale");
    expect(entries.some((e) => e.entryType === "platform_fee")).toBe(false);
  });

  it("stores the platform fee as a negative", () => {
    const fee = saleEntries({ ...base, tender: "terminal" }).find(
      (e) => e.entryType === "platform_fee"
    );
    expect(fee?.amountCents).toBe(-10);
  });

  it("omits lines that are zero rather than writing noise", () => {
    const entries = saleEntries({
      ...base,
      taxCents: 0,
      roundUpCents: 0,
      platformFeeCents: 0,
      tender: "cash",
    });
    expect(entries).toHaveLength(1);
  });

  it("gives every entry a distinct dedupe key", () => {
    const keys = saleEntries({ ...base, tender: "terminal" }).map((e) => e.dedupeKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("derives dedupe keys from the transaction, so a replay collides", () => {
    const first = saleEntries({ ...base, tender: "terminal" }).map((e) => e.dedupeKey);
    const second = saleEntries({ ...base, tender: "terminal" }).map((e) => e.dedupeKey);
    expect(first).toEqual(second);
  });

  it("counts round-ups as revenue but not tax", () => {
    expect(REVENUE_TYPES).toContain("round_up");
    expect(REVENUE_TYPES).not.toContain("tax");
  });

  it("records the tender on every entry", () => {
    // The expected-payout figure depends on this: a cash refund comes out of
    // the drawer, not out of a Stripe payout, and counting it against the
    // payout made the register look like it owed Stripe money.
    for (const entry of saleEntries({ ...base, tender: "cash" })) {
      expect(entry.metadata).toEqual({ tender: "cash" });
    }
    for (const entry of saleEntries({ ...base, tender: "terminal" })) {
      expect(entry.metadata).toEqual({ tender: "terminal" });
    }
  });
});
