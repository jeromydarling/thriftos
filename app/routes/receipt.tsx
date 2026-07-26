import type { Route } from "./+types/receipt";
import { envFrom } from "../lib/env";
import { money, receiptAddress, receiptByToken, type Receipt } from "../lib/receipts";

export function meta() {
  return [
    { title: "Receipt" },
    // A receipt is somebody's private purchase. It should never turn up in a
    // search result, even though the token makes that vanishingly unlikely.
    { name: "robots", content: "noindex, nofollow" },
  ];
}

export async function loader({ params, context }: Route.LoaderArgs) {
  const env = envFrom(context);
  const receipt = await receiptByToken(env.DB, params.token ?? "");

  if (!receipt) {
    throw new Response("No such receipt", { status: 404 });
  }

  return { receipt };
}

/**
 * The customer's copy.
 *
 * Public, no login, and printable — a shopper standing at a counter wanting to
 * return something should be able to open this on their phone and hand it over.
 * Deliberately plain: this gets printed on thermal paper as often as it gets
 * read on a screen.
 */
export default function ReceiptPage({ loaderData }: Route.ComponentProps) {
  const { receipt } = loaderData as { receipt: Receipt };

  const saved = receipt.lines.reduce((sum, line) => sum + line.markdownCents, 0);
  const soldAt = new Date(receipt.soldAt);
  const address = receiptAddress(receipt);

  return (
    <main className="mx-auto min-h-screen max-w-sm bg-white px-6 py-10 text-bark print:max-w-none print:py-0">
      <header className="text-center">
        <h1 className="font-display text-2xl">{receipt.orgName}</h1>
        {address ? <p className="mt-1 text-xs text-slate-soft">{address}</p> : null}
        {receipt.phone ? <p className="text-xs text-slate-soft">{receipt.phone}</p> : null}
      </header>

      {receipt.voided ? (
        <p className="mt-6 rounded-lg border border-clay/30 bg-clay/5 px-3 py-2 text-center text-sm text-clay">
          This sale was voided.
        </p>
      ) : null}

      <p className="mt-6 text-center text-sm text-slate-soft">
        {soldAt.toLocaleDateString("en-US", { dateStyle: "long" })} ·{" "}
        {soldAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
      </p>

      <table className="mt-6 w-full text-sm">
        <tbody>
          {receipt.lines.map((line, i) => (
            <tr key={i} className="align-top">
              <td className="py-1.5 pr-3">
                {line.title}
                {line.refundedCents > 0 ? (
                  <span className="ml-2 text-xs text-clay">refunded</span>
                ) : null}
              </td>
              <td className="py-1.5 text-right tabular-nums">{money(line.priceCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <dl className="mt-4 space-y-1 border-t border-line pt-4 text-sm">
        <Row label="Subtotal" value={money(receipt.subtotalCents)} />
        {receipt.taxCents > 0 ? <Row label="Sales tax" value={money(receipt.taxCents)} /> : null}
        {receipt.roundUpCents > 0 ? (
          <Row
            label={`Round-up for ${receipt.roundUpCause}`}
            value={money(receipt.roundUpCents)}
          />
        ) : null}
        <div className="flex justify-between border-t border-line pt-2 font-medium">
          <dt>Total</dt>
          <dd className="tabular-nums">{money(receipt.totalCents)}</dd>
        </div>
        {receipt.refundedCents > 0 ? (
          <div className="flex justify-between pt-1 text-clay">
            <dt>Refunded</dt>
            <dd className="tabular-nums">−{money(receipt.refundedCents)}</dd>
          </div>
        ) : null}
      </dl>

      <p className="mt-3 text-center text-xs text-slate-soft">
        Paid by {receipt.tender === "cash" ? "cash" : "card"}
      </p>

      {saved > 0 ? (
        <p className="mt-6 rounded-lg bg-linen px-4 py-3 text-center text-sm">
          You paid <strong>{money(saved)} less</strong> than the tag price.
        </p>
      ) : null}

      <p className="mt-6 text-center text-xs leading-relaxed text-slate-soft">
        Everything here is one of a kind and sold as seen. If something isn't right, bring it back
        and talk to us — this receipt is all you need.
      </p>

      <p className="mt-6 text-center text-[10px] text-slate-soft">
        Ref {receipt.transactionId}
      </p>

      <button
        type="button"
        onClick={() => window.print()}
        className="mt-6 w-full rounded-xl border border-line px-4 py-2.5 text-sm text-slate-soft print:hidden"
      >
        Print this receipt
      </button>
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <dt className="text-slate-soft">{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}

export function ErrorBoundary() {
  return (
    <main className="mx-auto max-w-sm px-6 py-16 text-center">
      <h1 className="font-display text-2xl text-bark">We can't find that receipt</h1>
      <p className="mt-3 text-sm leading-relaxed text-slate-soft">
        The link may have been mistyped, or the sale may have been removed. The shop that sold you
        the item can look it up and send a fresh copy.
      </p>
    </main>
  );
}
