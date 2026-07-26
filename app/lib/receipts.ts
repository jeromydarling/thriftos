/**
 * Sale receipts.
 *
 * A shopper who buys a coat should be able to prove what they paid, and a shop
 * facing a chargeback should be able to submit a document showing what was
 * sold and when. Those are the same artefact, which is why this exists as one
 * thing rather than two.
 *
 * The receipt is reachable at /r/<token> without a login, because a customer
 * cannot be expected to have an account. The token is random, unguessable, and
 * scoped to a single sale — knowing it proves you were handed it, and it
 * reveals nothing about any other transaction or about the shop.
 *
 * Note what a receipt is NOT allowed to do: change. It is generated from the
 * transaction_items snapshot, which stores the title and price at the moment of
 * sale, so re-pricing an item or renaming it later cannot alter a receipt
 * somebody already has in their inbox.
 */
import { all, first, run } from "./db";
import { newToken } from "./ids";
import { parseOrgSettings } from "./settings";

export interface ReceiptLine {
  title: string;
  priceCents: number;
  markdownCents: number;
  refundedCents: number;
}

export interface Receipt {
  transactionId: string;
  token: string;
  orgName: string;
  orgLegalName: string | null;
  street: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  phone: string | null;
  soldAt: string;
  lines: ReceiptLine[];
  subtotalCents: number;
  taxCents: number;
  roundUpCents: number;
  roundUpCause: string;
  totalCents: number;
  refundedCents: number;
  tender: string;
  paymentState: string;
  voided: boolean;
  /** Only ever the last four. We never see, store, or display more. */
  cardLast4: string | null;
}

/**
 * Give a sale a public token, or return the one it already has.
 *
 * Idempotent, so pressing "email a receipt" twice doesn't invalidate the link
 * already sitting in somebody's inbox.
 */
export async function ensureReceiptToken(
  db: D1Database,
  orgId: string,
  transactionId: string
): Promise<string | null> {
  const existing = await first<{ receipt_token: string | null }>(
    db,
    `SELECT receipt_token FROM transactions WHERE id = ? AND org_id = ?`,
    transactionId,
    orgId
  );
  if (!existing) return null;
  if (existing.receipt_token) return existing.receipt_token;

  const token = newToken(24);
  await run(
    db,
    // Guarded on the column still being null, so two concurrent requests can't
    // mint two tokens and leave one of them dangling.
    `UPDATE transactions SET receipt_token = ?
      WHERE id = ? AND org_id = ? AND receipt_token IS NULL`,
    token,
    transactionId,
    orgId
  );

  const after = await first<{ receipt_token: string | null }>(
    db,
    `SELECT receipt_token FROM transactions WHERE id = ? AND org_id = ?`,
    transactionId,
    orgId
  );
  return after?.receipt_token ?? null;
}

/** Look a receipt up by its public token. No org scope — the token is the key. */
export async function receiptByToken(db: D1Database, token: string): Promise<Receipt | null> {
  const tx = await first<{
    id: string;
    org_id: string;
    receipt_token: string;
    subtotal_cents: number;
    tax_cents: number;
    roundup_cents: number;
    total_cents: number;
    refunded_cents: number;
    tender: string;
    payment_state: string;
    voided_at: string | null;
    created_at: string;
    org_name: string;
    legal_name: string | null;
    street: string | null;
    city: string | null;
    state: string | null;
    postal_code: string | null;
    phone: string | null;
    settings_json: string;
  }>(
    db,
    `SELECT t.id, t.org_id, t.receipt_token, t.subtotal_cents, t.tax_cents, t.roundup_cents,
            t.total_cents, t.refunded_cents, t.tender, t.payment_state, t.voided_at,
            t.created_at,
            o.name AS org_name, o.legal_name, o.street, o.city, o.state, o.postal_code,
            o.phone, o.settings_json
       FROM transactions t
       JOIN orgs o ON o.id = t.org_id
      WHERE t.receipt_token = ?`,
    token
  );
  if (!tx) return null;

  const lines = await all<{
    title: string;
    price_cents: number;
    markdown_cents: number;
    refunded_cents: number;
  }>(
    db,
    `SELECT title, price_cents, markdown_cents, refunded_cents
       FROM transaction_items WHERE transaction_id = ? ORDER BY created_at, id`,
    tx.id
  );

  const settings = parseOrgSettings(tx.settings_json);

  return {
    transactionId: tx.id,
    token: tx.receipt_token,
    orgName: tx.org_name,
    orgLegalName: tx.legal_name,
    street: tx.street,
    city: tx.city,
    state: tx.state,
    postalCode: tx.postal_code,
    phone: tx.phone,
    soldAt: tx.created_at,
    lines: lines.map((l) => ({
      title: l.title,
      priceCents: l.price_cents,
      markdownCents: l.markdown_cents,
      refundedCents: l.refunded_cents,
    })),
    subtotalCents: tx.subtotal_cents,
    taxCents: tx.tax_cents,
    roundUpCents: tx.roundup_cents,
    roundUpCause: settings.roundUpCause,
    totalCents: tx.total_cents,
    refundedCents: tx.refunded_cents,
    tender: tx.tender,
    paymentState: tx.payment_state,
    voided: Boolean(tx.voided_at),
    cardLast4: null,
  };
}

/** Plain money formatting, for contexts with no React helper to hand. */
export function money(cents: number): string {
  return `$${(Math.abs(cents) / 100).toFixed(2)}`;
}

export function receiptAddress(receipt: Receipt): string {
  return [receipt.street, [receipt.city, receipt.state].filter(Boolean).join(", "), receipt.postalCode]
    .filter(Boolean)
    .join(" · ");
}

/**
 * The email a shopper receives.
 *
 * Deliberately not a tax document. A retail receipt records a purchase; the
 * separate donation-receipt path is the one bound by IRS acknowledgement rules,
 * and conflating them would put a valuation on a sale that nobody made.
 */
export function saleReceiptEmail(opts: {
  receipt: Receipt;
  receiptUrl: string;
}): { subject: string; html: string; text: string } {
  const { receipt } = opts;
  const date = new Date(receipt.soldAt).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const saved = receipt.lines.reduce((sum, l) => sum + l.markdownCents, 0);

  const rows = receipt.lines
    .map(
      (line) =>
        `<tr><td style="padding:6px 0">${escapeHtml(line.title)}</td>` +
        `<td style="padding:6px 0;text-align:right">${money(line.priceCents)}</td></tr>`
    )
    .join("");

  const html = layoutReceipt(
    receipt.orgName,
    `<p>Thank you for shopping with us on ${escapeHtml(date)}.</p>
     <table style="width:100%;border-collapse:collapse;margin:16px 0">
       ${rows}
       <tr><td colspan="2" style="border-top:1px solid #E5E1DA;padding-top:8px"></td></tr>
       <tr><td style="padding:3px 0">Subtotal</td><td style="padding:3px 0;text-align:right">${money(receipt.subtotalCents)}</td></tr>
       ${receipt.taxCents > 0 ? `<tr><td style="padding:3px 0">Sales tax</td><td style="padding:3px 0;text-align:right">${money(receipt.taxCents)}</td></tr>` : ""}
       ${receipt.roundUpCents > 0 ? `<tr><td style="padding:3px 0">Round-up for ${escapeHtml(receipt.roundUpCause)}</td><td style="padding:3px 0;text-align:right">${money(receipt.roundUpCents)}</td></tr>` : ""}
       <tr><td style="padding:8px 0;font-weight:600">Total</td><td style="padding:8px 0;text-align:right;font-weight:600">${money(receipt.totalCents)}</td></tr>
       ${receipt.refundedCents > 0 ? `<tr><td style="padding:3px 0;color:#B8543F">Refunded</td><td style="padding:3px 0;text-align:right;color:#B8543F">−${money(receipt.refundedCents)}</td></tr>` : ""}
     </table>
     ${saved > 0 ? `<p style="padding:12px 16px;background:#F7F5F1;border-radius:8px;margin:0 0 16px">You paid ${money(saved)} less than the tag price on this visit.</p>` : ""}
     <p><a href="${escapeHtml(opts.receiptUrl)}" style="display:inline-block;padding:10px 18px;background:#2F6F5E;color:#fff;border-radius:8px;text-decoration:none">View or print this receipt</a></p>
     <p style="font-size:13px;color:#6B7280">Everything here is one of a kind and sold as seen. If something isn't right, bring it back and talk to us — this receipt is all you need.</p>`
  );

  const text =
    `Thank you for shopping with ${receipt.orgName} on ${date}.\n\n` +
    receipt.lines.map((l) => `${l.title}  ${money(l.priceCents)}`).join("\n") +
    `\n\nSubtotal ${money(receipt.subtotalCents)}` +
    (receipt.taxCents > 0 ? `\nSales tax ${money(receipt.taxCents)}` : "") +
    (receipt.roundUpCents > 0 ? `\nRound-up ${money(receipt.roundUpCents)}` : "") +
    `\nTotal ${money(receipt.totalCents)}\n\n` +
    `View or print: ${opts.receiptUrl}`;

  return { subject: `Your receipt from ${receipt.orgName}`, html, text };
}

function layoutReceipt(orgName: string, body: string): string {
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#F7F5F1;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1F2937;line-height:1.6">
<div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;padding:32px">
<p style="margin:0 0 20px;font-weight:600;color:#2F6F5E">${escapeHtml(orgName)}</p>
${body}
</div>
<p style="max-width:520px;margin:16px auto 0;font-size:12px;color:#6B7280;text-align:center">Sent by ${escapeHtml(orgName)} using ThriftOS.</p>
</body></html>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
