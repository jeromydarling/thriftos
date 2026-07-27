import { Form, redirect, useNavigation } from "react-router";
import type { Route } from "./+types/app.donations";
import { requireUser } from "../lib/auth";
import { all, first, run } from "../lib/db";
import { newId } from "../lib/ids";
import { ctxFrom, envFrom } from "../lib/env";
import { findOrCreateContact } from "../lib/contacts";
import { donationReceiptEmail, sendEmail } from "../lib/email";
import { Button, Card, EmptyState, Field, Input, money, Notice, TableScroll, Textarea } from "../components/ui";

export function meta() {
  return [{ title: "Donations | ThriftOS" }];
}

/**
 * The acknowledgement language a US charity must use, and must not exceed.
 * The shop describes what it received; it never assigns a dollar value to
 * donated goods — that determination belongs to the donor and their adviser.
 */
const GOODS_SERVICES_STATEMENT =
  "No goods or services were provided in exchange for this contribution.";

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = envFrom(context);
  const user = await requireUser(request, env.DB);

  const [donations, org, pending] = await Promise.all([
    all<{
      id: string;
      contact_name: string | null;
      kind: string;
      received_at: string;
      item_count: number;
      est_weight_lbs: number;
      amount_cents: number;
      description: string | null;
      receipt_number: string | null;
    }>(
      env.DB,
      `SELECT d.id, c.name AS contact_name, d.kind, d.received_at, d.item_count,
              d.est_weight_lbs, d.amount_cents, d.description, r.receipt_number
         FROM donations d
         LEFT JOIN contacts c ON c.id = d.contact_id
         LEFT JOIN donation_receipts r ON r.donation_id = d.id
        WHERE d.org_id = ?
        ORDER BY d.received_at DESC
        LIMIT 60`,
      user.orgId
    ),
    first<{ name: string; ein: string | null; legal_name: string | null }>(
      env.DB,
      `SELECT name, ein, legal_name FROM orgs WHERE id = ?`,
      user.orgId
    ),
    first<{ n: number }>(
      env.DB,
      `SELECT COUNT(*) AS n FROM donations d
        WHERE d.org_id = ? AND d.contact_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM donation_receipts r WHERE r.donation_id = d.id)`,
      user.orgId
    ),
  ]);

  return {
    donations,
    org,
    pendingReceipts: Number(pending?.n ?? 0),
    hasEin: Boolean(org?.ein && org.ein !== "00-0000000"),
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const env = envFrom(context);
  const user = await requireUser(request, env.DB);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "record");

  if (intent === "receipt") {
    const donationId = String(form.get("donation_id") ?? "");

    const donation = await first<{
      id: string;
      contact_id: string | null;
      description: string | null;
      received_at: string;
      amount_cents: number;
      kind: string;
      contact_name: string | null;
      contact_email: string | null;
    }>(
      env.DB,
      `SELECT d.id, d.contact_id, d.description, d.received_at, d.amount_cents, d.kind,
              c.name AS contact_name, c.email AS contact_email
         FROM donations d
         LEFT JOIN contacts c ON c.id = d.contact_id
        WHERE d.id = ? AND d.org_id = ?`,
      donationId,
      user.orgId
    );

    if (!donation) return { error: "We couldn't find that donation." };
    if (!donation.contact_id) {
      return { error: "This donation was anonymous — add a donor before issuing a receipt." };
    }

    const existing = await first<{ id: string }>(
      env.DB,
      `SELECT id FROM donation_receipts WHERE donation_id = ?`,
      donationId
    );
    if (existing) return { error: "A receipt for this donation already went out." };

    const seq = await first<{ n: number }>(
      env.DB,
      `SELECT COUNT(*) AS n FROM donation_receipts WHERE org_id = ?`,
      user.orgId
    );
    const receiptNumber = `R-${String(Number(seq?.n ?? 0) + 1).padStart(5, "0")}`;
    const description = donation.description ?? "Donated goods";

    await run(
      env.DB,
      `INSERT INTO donation_receipts
         (id, org_id, donation_id, contact_id, receipt_number, description, amount_cents, goods_services_statement)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      newId("receipt"),
      user.orgId,
      donation.id,
      donation.contact_id,
      receiptNumber,
      description,
      donation.kind === "cash" ? donation.amount_cents : 0,
      GOODS_SERVICES_STATEMENT
    );

    if (donation.contact_email) {
      const org = await first<{ name: string }>(env.DB, `SELECT name FROM orgs WHERE id = ?`, user.orgId);
      const mail = donationReceiptEmail({
        orgName: org?.name ?? "Your shop",
        donorName: donation.contact_name ?? "friend",
        receiptNumber,
        receivedOn: new Date(donation.received_at).toLocaleDateString(),
        description,
      });
      ctxFrom(context).waitUntil(
        sendEmail(env, {
          orgId: user.orgId,
          to: donation.contact_email,
          template: "donation_receipt",
          subject: mail.subject,
          html: mail.html,
          text: mail.text,
        })
      );
    }

    return redirect("/app/donations?receipted=1");
  }

  // Record a donation
  const donorName = String(form.get("donor_name") ?? "").trim();
  const donorEmail = String(form.get("donor_email") ?? "").trim();
  const kind = String(form.get("kind") ?? "goods");
  const description = String(form.get("description") ?? "").trim();
  const weight = parseFloat(String(form.get("weight") ?? "0"));
  const itemCount = parseInt(String(form.get("item_count") ?? "0"), 10);
  const amount = parseFloat(String(form.get("amount") ?? "0"));

  if (kind === "goods" && !description) {
    return { error: "A short description of what was donated is all we need." };
  }

  const contactId =
    donorName || donorEmail
      ? await findOrCreateContact(env.DB, {
          orgId: user.orgId,
          name: donorName || null,
          email: donorEmail || null,
          roles: ["donor"],
        })
      : null;

  await run(
    env.DB,
    `INSERT INTO donations (id, org_id, contact_id, kind, received_by, item_count, est_weight_lbs, amount_cents, description)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    newId("donation"),
    user.orgId,
    contactId,
    kind,
    user.id,
    Number.isFinite(itemCount) ? itemCount : 0,
    Number.isFinite(weight) ? weight : 0,
    kind === "cash" && Number.isFinite(amount) ? Math.round(amount * 100) : 0,
    description || null
  );

  return redirect("/app/donations?saved=1");
}

export default function Donations({ loaderData, actionData }: Route.ComponentProps) {
  const { donations, org, pendingReceipts, hasEin } = loaderData;
  const navigation = useNavigation();
  const busy = navigation.state === "submitting";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl text-bark">Donations</h1>
        <p className="mt-1 text-sm text-slate-soft">
          What came in, who brought it, and whether they've been thanked.
        </p>
      </div>

      {!hasEin ? (
        <Notice tone="warn">
          Add your EIN in Settings before issuing receipts — donors need it on the
          acknowledgement for their records.
        </Notice>
      ) : null}

      {pendingReceipts > 0 ? (
        <Notice>
          {pendingReceipts} {pendingReceipts === 1 ? "donation is" : "donations are"} waiting on a
          receipt. Easier now than in a January rush.
        </Notice>
      ) : null}

      {actionData?.error ? <Notice tone="warn">{actionData.error}</Notice> : null}

      <div className="grid gap-6 lg:grid-cols-[22rem_1fr]">
        <Card className="h-fit">
          <h2 className="font-display text-lg text-bark">Record a donation</h2>
          <Form method="post" className="mt-4 space-y-4">
            <input type="hidden" name="intent" value="record" />

            <Field label="Donor name" name="donor_name" hint="Leave blank if they'd rather not say.">
              <Input id="donor_name" name="donor_name" />
            </Field>

            <Field label="Email" name="donor_email" hint="Needed to email a receipt.">
              <Input id="donor_email" name="donor_email" type="email" />
            </Field>

            <Field label="What was donated?" name="description">
              <Textarea id="description" name="description" rows={2} placeholder="Four bags of clothing and two boxes of kitchenware" />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Items (approx.)" name="item_count">
                <Input id="item_count" name="item_count" type="number" min="0" />
              </Field>
              <Field label="Weight (lbs)" name="weight">
                <Input id="weight" name="weight" type="number" step="0.1" min="0" />
              </Field>
            </div>

            <input type="hidden" name="kind" value="goods" />

            <Button type="submit" disabled={busy} className="w-full">
              {busy ? "Recording…" : "Record it"}
            </Button>
          </Form>

          <p className="mt-4 border-t border-line pt-3 text-xs leading-relaxed text-slate-soft">
            We describe what was received. We never put a dollar value on donated goods —
            that's the donor's call with their tax adviser, and a charity stating one is
            exactly what the IRS asks us not to do.
          </p>
        </Card>

        {/* min-w-0, or this grid item is sized by the natural width of the
            table inside it — the track grows past the screen and takes the
            form beside it along for the ride. A scroll container can only
            scroll if it is allowed to be narrower than its contents. */}
        <div className="min-w-0">
          {donations.length === 0 ? (
            <EmptyState
              title="No donations recorded yet"
              body="Record the first one on the left, and it'll appear here with a one-click receipt."
            />
          ) : (
            <TableScroll>
              <table className="w-full text-sm">
                <thead className="border-b border-line bg-linen/60 text-left">
                  <tr>
                    <th className="px-4 py-3 font-medium text-slate-soft">Donor</th>
                    <th className="px-4 py-3 font-medium text-slate-soft">What</th>
                    <th className="px-4 py-3 font-medium text-slate-soft">When</th>
                    <th className="px-4 py-3 text-right font-medium text-slate-soft">Receipt</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {donations.map((d) => (
                    <tr key={d.id} className="hover:bg-linen/40">
                      <td className="px-4 py-3 text-bark">{d.contact_name ?? "Anonymous"}</td>
                      <td className="px-4 py-3 text-slate-soft">
                        {d.kind === "cash" ? (
                          money(d.amount_cents)
                        ) : (
                          <>
                            <span className="line-clamp-1">{d.description ?? "Goods"}</span>
                            {d.est_weight_lbs > 0 ? (
                              <span className="text-xs">{d.est_weight_lbs} lbs</span>
                            ) : null}
                          </>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-soft">
                        {new Date(d.received_at).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {d.receipt_number ? (
                          <span className="text-xs text-moss">{d.receipt_number}</span>
                        ) : d.contact_name ? (
                          <Form method="post" className="inline">
                            <input type="hidden" name="intent" value="receipt" />
                            <input type="hidden" name="donation_id" value={d.id} />
                            <button
                              type="submit"
                              className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-bark hover:bg-linen"
                            >
                              Send receipt
                            </button>
                          </Form>
                        ) : (
                          <span className="text-xs text-slate-soft">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          )}
        </div>
      </div>
    </div>
  );
}
