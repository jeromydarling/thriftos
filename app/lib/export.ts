/**
 * Taking your data with you.
 *
 * The whole position of this product is no lock-in — no hardware lease, no
 * contract, no hostage-taking. The help centre says "if it isn't right, export
 * your data and go", and `data_export` sits in the always-available
 * entitlements so a shop that owes us money can still leave with its records.
 *
 * Until now none of that was true. The only export was a monthly impact
 * summary. A shop that wanted to leave couldn't, and the first one to try
 * would have said so publicly and been right.
 *
 * Design notes:
 *
 *   • CSV, not JSON. The people who need this open files in Excel, and a
 *     format their accountant can read matters more than one a programmer
 *     finds tidy.
 *   • Every dataset is exported whole, including archived and sold records.
 *     An export that quietly omits history isn't an escape route.
 *   • Sample data is excluded. It was never theirs.
 *   • Money is exported in dollars with two decimals *and* raw cents. The
 *     first is for a human, the second is for whoever has to import it
 *     somewhere else without a rounding argument.
 */
import { all } from "./db";
import { toCsv } from "./impact";

export type ExportKind =
  | "items"
  | "contacts"
  | "donations"
  | "receipts"
  | "sales"
  | "sale_items"
  | "shifts"
  | "ledger";

export interface ExportSpec {
  kind: ExportKind;
  filename: string;
  label: string;
  description: string;
  /**
   * The header row, so a shop with none of something still gets a usable file
   * rather than a zero-byte one that reads as a broken export. A test asserts
   * these match what the query actually returns, so they can't drift.
   */
  columns: readonly string[];
}

export const EXPORTS: readonly ExportSpec[] = [
  {
    kind: "contacts",
    filename: "people.csv",
    label: "People",
    description: "Donors, volunteers, shoppers, and workers, with their stacked roles.",
    columns: ["name", "email", "phone", "roles", "street", "city", "state", "postal_code", "notes", "first_seen_at", "last_seen_at", "created_at"],
  },
  {
    kind: "donations",
    filename: "donations.csv",
    label: "Donations",
    description: "Every donation received, with donor, weight, and description.",
    columns: ["received_at", "donor_name", "donor_email", "kind", "item_count", "est_weight_lbs", "amount_cents", "description", "notes", "amount_usd"],
  },
  {
    kind: "receipts",
    filename: "donation-receipts.csv",
    label: "Donation receipts",
    description: "Acknowledgements issued, with their numbers and dates.",
    columns: ["receipt_number", "issued_at", "donor_name", "donor_email", "description", "goods_services_statement", "emailed_at"],
  },
  {
    kind: "items",
    filename: "inventory.csv",
    label: "Inventory",
    description: "All items, including sold and archived, with prices and tag colours.",
    columns: ["tag_number", "title", "description", "category", "brand", "color", "size", "material", "era", "condition", "condition_notes", "price_cents", "original_price_cents", "retail_estimate_cents", "weight_lbs", "tag_color", "intake_date", "status", "sold_at", "sold_price_cents", "created_at", "price_usd", "sold_price_usd"],
  },
  {
    kind: "sales",
    filename: "sales.csv",
    label: "Sales",
    description: "Every transaction, with tender, tax, fees, and refunds.",
    columns: ["sale_id", "created_at", "tender", "payment_state", "subtotal_cents", "tax_cents", "roundup_cents", "total_cents", "refunded_cents", "platform_fee_cents", "fee_refunded_cents", "stripe_fee_cents", "tax_exempt", "voided_at", "void_reason", "cashier", "subtotal_usd", "tax_usd", "total_usd", "refunded_usd"],
  },
  {
    kind: "sale_items",
    filename: "sale-lines.csv",
    label: "Sale lines",
    description: "What was on each sale, as recorded at the time.",
    columns: ["sale_id", "created_at", "title", "category", "price_cents", "markdown_cents", "retail_estimate_cents", "refunded_cents", "fulfillment_state", "price_usd"],
  },
  {
    kind: "shifts",
    filename: "volunteer-shifts.csv",
    label: "Volunteer shifts",
    description: "Scheduled and completed shifts, with hours logged.",
    columns: ["starts_at", "ends_at", "status", "role_label", "hours_logged", "notes", "volunteer_name", "volunteer_email"],
  },
  {
    kind: "ledger",
    filename: "ledger.csv",
    label: "Financial ledger",
    description: "Every money event, signed. This is the auditable record.",
    columns: ["occurred_at", "entry_type", "amount_cents", "transaction_id", "shift_id", "stripe_object_id", "source", "amount_usd"],
  },
] as const;

const dollars = (cents: number | null | undefined) =>
  ((Number(cents ?? 0)) / 100).toFixed(2);

/**
 * Build one export as CSV.
 *
 * Column names are chosen to be self-explanatory to somebody who has never
 * seen our schema, because the person reading this file will be using a
 * different system by then.
 */
export async function buildExport(
  db: D1Database,
  orgId: string,
  kind: ExportKind
): Promise<string> {
  const csv = await runExport(db, orgId, kind);
  if (csv) return csv;

  // No rows. Emit the header anyway — a zero-byte file reads as a broken
  // export, whereas a header with nothing under it says "you have none of
  // these", which is the truth.
  const spec = EXPORTS.find((e) => e.kind === kind);
  return spec ? `${spec.columns.map((c) => `"${c}"`).join(",")}\r\n` : "";
}

async function runExport(
  db: D1Database,
  orgId: string,
  kind: ExportKind
): Promise<string> {
  switch (kind) {
    case "contacts": {
      const rows = await all<Record<string, unknown>>(
        db,
        `SELECT name, email, phone, roles, street, city, state, postal_code, notes,
                first_seen_at, last_seen_at, created_at
           FROM contacts WHERE org_id = ? AND is_sample = 0
           ORDER BY name, id`,
        orgId
      );
      return toCsv(rows);
    }

    case "donations": {
      const rows = await all<Record<string, unknown>>(
        db,
        `SELECT d.received_at, c.name AS donor_name, c.email AS donor_email, d.kind,
                d.item_count, d.est_weight_lbs, d.amount_cents, d.description, d.notes
           FROM donations d
           LEFT JOIN contacts c ON c.id = d.contact_id
          WHERE d.org_id = ? AND d.is_sample = 0
          ORDER BY d.received_at DESC`,
        orgId
      );
      return toCsv(
        rows.map((r) => ({ ...r, amount_usd: dollars(r.amount_cents as number) }))
      );
    }

    case "receipts": {
      const rows = await all<Record<string, unknown>>(
        db,
        `SELECT r.receipt_number, r.issued_at, c.name AS donor_name, c.email AS donor_email,
                r.description, r.goods_services_statement, r.emailed_at
           FROM donation_receipts r
           LEFT JOIN contacts c ON c.id = r.contact_id
           LEFT JOIN donations d ON d.id = r.donation_id
          WHERE r.org_id = ? AND COALESCE(d.is_sample, 0) = 0
          ORDER BY r.issued_at DESC`,
        orgId
      );
      return toCsv(rows);
    }

    case "items": {
      const rows = await all<Record<string, unknown>>(
        db,
        `SELECT tag_number, title, description, category, brand, color, size, material, era,
                condition, condition_notes, price_cents, original_price_cents,
                retail_estimate_cents, weight_lbs, tag_color, intake_date, status,
                sold_at, sold_price_cents, created_at
           FROM items WHERE org_id = ? AND is_sample = 0
           ORDER BY created_at DESC`,
        orgId
      );
      return toCsv(
        rows.map((r) => ({
          ...r,
          price_usd: dollars(r.price_cents as number),
          sold_price_usd: r.sold_price_cents === null ? "" : dollars(r.sold_price_cents as number),
        }))
      );
    }

    case "sales": {
      const rows = await all<Record<string, unknown>>(
        db,
        `SELECT t.id AS sale_id, t.created_at, t.tender, t.payment_state,
                t.subtotal_cents, t.tax_cents, t.roundup_cents, t.total_cents,
                t.refunded_cents, t.platform_fee_cents, t.fee_refunded_cents,
                t.stripe_fee_cents, t.tax_exempt, t.voided_at, t.void_reason,
                u.name AS cashier
           FROM transactions t
           LEFT JOIN users u ON u.id = t.cashier_user_id
          WHERE t.org_id = ? AND t.is_sample = 0
          ORDER BY t.created_at DESC`,
        orgId
      );
      return toCsv(
        rows.map((r) => ({
          ...r,
          subtotal_usd: dollars(r.subtotal_cents as number),
          tax_usd: dollars(r.tax_cents as number),
          total_usd: dollars(r.total_cents as number),
          refunded_usd: dollars(r.refunded_cents as number),
        }))
      );
    }

    case "sale_items": {
      const rows = await all<Record<string, unknown>>(
        db,
        `SELECT ti.transaction_id AS sale_id, t.created_at, ti.title, ti.category,
                ti.price_cents, ti.markdown_cents, ti.retail_estimate_cents,
                ti.refunded_cents, ti.fulfillment_state
           FROM transaction_items ti
           JOIN transactions t ON t.id = ti.transaction_id
          WHERE ti.org_id = ? AND t.is_sample = 0
          ORDER BY t.created_at DESC`,
        orgId
      );
      return toCsv(rows.map((r) => ({ ...r, price_usd: dollars(r.price_cents as number) })));
    }

    case "shifts": {
      const rows = await all<Record<string, unknown>>(
        db,
        `SELECT s.starts_at, s.ends_at, s.status, s.role_label, s.hours_logged, s.notes,
                c.name AS volunteer_name, c.email AS volunteer_email
           FROM shifts s
           LEFT JOIN contacts c ON c.id = s.contact_id
          WHERE s.org_id = ? AND s.is_sample = 0
          ORDER BY s.starts_at DESC`,
        orgId
      );
      return toCsv(rows);
    }

    case "ledger": {
      const rows = await all<Record<string, unknown>>(
        db,
        `SELECT occurred_at, entry_type, amount_cents, transaction_id, shift_id,
                stripe_object_id, source
           FROM ledger_entries WHERE org_id = ?
           ORDER BY occurred_at DESC`,
        orgId
      );
      return toCsv(
        rows.map((r) => ({ ...r, amount_usd: dollars(r.amount_cents as number) }))
      );
    }

    default: {
      // Exhaustiveness: a new ExportKind that nobody wired up is a compile
      // error here rather than an empty file a shop discovers after leaving.
      const never: never = kind;
      throw new Error(`No exporter for ${String(never)}`);
    }
  }
}

/** Rough row counts, so the export screen can say what's in the box. */
export async function exportCounts(
  db: D1Database,
  orgId: string
): Promise<Record<ExportKind, number>> {
  const row = await all<Record<string, number>>(
    db,
    `SELECT
       (SELECT COUNT(*) FROM contacts WHERE org_id = ?1 AND is_sample = 0) AS contacts,
       (SELECT COUNT(*) FROM donations WHERE org_id = ?1 AND is_sample = 0) AS donations,
       (SELECT COUNT(*) FROM donation_receipts WHERE org_id = ?1) AS receipts,
       (SELECT COUNT(*) FROM items WHERE org_id = ?1 AND is_sample = 0) AS items,
       (SELECT COUNT(*) FROM transactions WHERE org_id = ?1 AND is_sample = 0) AS sales,
       (SELECT COUNT(*) FROM transaction_items WHERE org_id = ?1) AS sale_items,
       (SELECT COUNT(*) FROM shifts WHERE org_id = ?1 AND is_sample = 0) AS shifts,
       (SELECT COUNT(*) FROM ledger_entries WHERE org_id = ?1) AS ledger`,
    orgId
  );

  const counts = row[0] ?? {};
  return {
    contacts: Number(counts.contacts ?? 0),
    donations: Number(counts.donations ?? 0),
    receipts: Number(counts.receipts ?? 0),
    items: Number(counts.items ?? 0),
    sales: Number(counts.sales ?? 0),
    sale_items: Number(counts.sale_items ?? 0),
    shifts: Number(counts.shifts ?? 0),
    ledger: Number(counts.ledger ?? 0),
  };
}
