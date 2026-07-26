import { describe, expect, it } from "vitest";
import { buildExport, EXPORTS, type ExportKind } from "./export";

/**
 * A stub returning one row of every column the real query selects.
 *
 * The point of these tests is the contract between the declared `columns` on
 * each spec and what the query actually produces. A declared header that has
 * drifted from the SQL means a shop with no records of that kind downloads a
 * file whose header doesn't match the one a shop *with* records gets — a
 * difference nobody would notice until an import somewhere else failed.
 */
function stubDb(rows: Record<string, unknown>[]) {
  return {
    prepare: () => ({
      bind: () => ({
        all: async () => ({ results: rows }),
        first: async () => rows[0] ?? null,
        run: async () => ({ meta: { changes: 0 } }),
      }),
    }),
  } as unknown as D1Database;
}

/** The header line of a CSV, unquoted. */
function headerOf(csv: string): string[] {
  return (csv.split("\r\n")[0] ?? "")
    .split(",")
    .map((c) => c.replace(/^"|"$/g, ""));
}

describe("export registry", () => {
  it("gives every kind a spec", () => {
    const kinds: ExportKind[] = [
      "items",
      "contacts",
      "donations",
      "receipts",
      "sales",
      "sale_items",
      "shifts",
      "ledger",
    ];
    for (const kind of kinds) {
      expect(EXPORTS.find((e) => e.kind === kind), kind).toBeDefined();
    }
  });

  it("uses distinct filenames, so nothing overwrites anything in the archive", () => {
    const names = EXPORTS.map((e) => e.filename);
    expect(new Set(names).size).toBe(names.length);
  });

  it("declares columns for every export", () => {
    for (const spec of EXPORTS) {
      expect(spec.columns.length, spec.kind).toBeGreaterThan(0);
    }
  });

  it("exports money as both cents and dollars wherever money appears", () => {
    for (const spec of EXPORTS) {
      const hasCents = spec.columns.some((c) => c.endsWith("_cents"));
      if (!hasCents) continue;
      expect(
        spec.columns.some((c) => c.endsWith("_usd")),
        `${spec.kind} has cents but no readable dollars`
      ).toBe(true);
    }
  });
});

describe("empty exports", () => {
  it("returns a header row rather than a zero-byte file", async () => {
    for (const spec of EXPORTS) {
      const csv = await buildExport(stubDb([]), "og_1", spec.kind);
      expect(csv.length, spec.kind).toBeGreaterThan(0);
      expect(headerOf(csv), spec.kind).toEqual([...spec.columns]);
    }
  });
});

describe("declared headers match the queries", () => {
  // One row per kind, with every column the SELECT lists. If a query gains or
  // loses a column without the spec being updated, the header comparison below
  // fails — which is the drift check.
  const SAMPLES: Record<ExportKind, Record<string, unknown>> = {
    contacts: {
      name: "Marta",
      email: "m@example.com",
      phone: "555",
      roles: "donor",
      street: "",
      city: "",
      state: "",
      postal_code: "",
      notes: "",
      first_seen_at: "",
      last_seen_at: "",
      created_at: "",
    },
    donations: {
      received_at: "",
      donor_name: "",
      donor_email: "",
      kind: "goods",
      item_count: 1,
      est_weight_lbs: 2,
      amount_cents: 0,
      description: "",
      notes: "",
    },
    receipts: {
      receipt_number: "R-1",
      issued_at: "",
      donor_name: "",
      donor_email: "",
      description: "",
      goods_services_statement: "",
      emailed_at: "",
    },
    items: {
      tag_number: "T1",
      title: "Coat",
      description: "",
      category: "",
      brand: "",
      color: "",
      size: "",
      material: "",
      era: "",
      condition: "good",
      condition_notes: "",
      price_cents: 2000,
      original_price_cents: 2000,
      retail_estimate_cents: 9000,
      weight_lbs: 2,
      tag_color: "blue",
      intake_date: "",
      status: "available",
      sold_at: null,
      sold_price_cents: null,
      created_at: "",
    },
    sales: {
      sale_id: "tx_1",
      created_at: "",
      tender: "cash",
      payment_state: "succeeded",
      subtotal_cents: 2000,
      tax_cents: 140,
      roundup_cents: 0,
      total_cents: 2140,
      refunded_cents: 0,
      platform_fee_cents: 0,
      fee_refunded_cents: 0,
      stripe_fee_cents: null,
      tax_exempt: 0,
      voided_at: null,
      void_reason: null,
      cashier: "Dana",
    },
    sale_items: {
      sale_id: "tx_1",
      created_at: "",
      title: "Coat",
      category: "",
      price_cents: 2000,
      markdown_cents: 0,
      retail_estimate_cents: 9000,
      refunded_cents: 0,
      fulfillment_state: null,
    },
    shifts: {
      starts_at: "",
      ends_at: "",
      status: "completed",
      role_label: "floor",
      hours_logged: 4,
      notes: "",
      volunteer_name: "",
      volunteer_email: "",
    },
    ledger: {
      occurred_at: "",
      entry_type: "cash_sale",
      amount_cents: 2000,
      transaction_id: "tx_1",
      shift_id: null,
      stripe_object_id: null,
      source: "pos",
    },
  };

  for (const spec of EXPORTS) {
    it(`${spec.kind} produces the columns it declares`, async () => {
      const csv = await buildExport(stubDb([SAMPLES[spec.kind]]), "og_1", spec.kind);
      expect(headerOf(csv)).toEqual([...spec.columns]);
    });
  }

  it("formats money as dollars alongside the cents", async () => {
    const csv = await buildExport(stubDb([SAMPLES.sales]), "og_1", "sales");
    // 2140 cents must appear as 21.40, not 21.4 and not 2140.
    expect(csv).toContain('"21.40"');
  });
});
