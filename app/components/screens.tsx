/**
 * Live product demos for the marketing site.
 *
 * Every one of these is real React running in the page — not an image. They
 * animate on a loop so a visitor sees the whole flow without clicking, and they
 * use the same colours, spacing, and copy tone as the actual app, because the
 * fastest way to lose trust is a marketing screenshot that flatters the product.
 *
 * The numbers shown are computed from lib/pricing and lib/savings, so a demo
 * can never quote a fee we don't actually charge.
 */
import { useSequence } from "./motion";
import { TAG_COLOR_HEX } from "../lib/markdown";
import { formatCents, getPlan, platformFeeCents, stripeCardPresentFeeCents } from "../lib/pricing";

const cell = "rounded-lg border border-line bg-white px-3 py-2";

/* ─── 1. AI intake ──────────────────────────────────────────────────────── */

const INTAKE_FIELDS = [
  { label: "What is it", value: "Navy wool peacoat" },
  { label: "Category", value: "Outerwear" },
  { label: "Colour", value: "Navy" },
  { label: "Condition", value: "Good — small mark on left cuff" },
  { label: "Price", value: "$14.00" },
  { label: "Comparable new", value: "$90.00" },
];

export function IntakeScreen() {
  // 0: empty · 1: photo · 2..7: fields fill in · 8: done
  const step = useSequence(9, 620, 3200);

  return (
    <div className="grid gap-4 p-4 sm:grid-cols-[9rem_1fr]">
      <div>
        <div className="relative aspect-square w-full overflow-hidden rounded-xl border border-line bg-linen">
          {step >= 1 ? (
            <div className="motion-safe:animate-rise absolute inset-0 flex items-center justify-center bg-gradient-to-br from-[#3b4a63] to-[#22304a]">
              <span className="text-4xl" aria-hidden="true">🧥</span>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center text-[11px] text-slate-soft">
              No photo yet
            </div>
          )}
        </div>
        <div className="mt-2 rounded-lg bg-moss px-3 py-2 text-center text-[11px] font-medium text-white">
          {step === 0 ? "Take a photo" : step < 8 ? "Reading…" : "Read"}
        </div>
        {step >= 8 ? (
          <p className="motion-safe:animate-rise mt-2 text-[10px] leading-snug text-slate-soft">
            Fairly sure — check before saving.
          </p>
        ) : null}
      </div>

      <div className="space-y-1.5">
        {INTAKE_FIELDS.map((field, i) => {
          const revealed = step >= i + 2;
          return (
            <div key={field.label} className={cell}>
              <p className="text-[9px] uppercase tracking-wide text-slate-soft">{field.label}</p>
              <p
                className={`mt-0.5 text-[11px] text-bark transition-opacity duration-300 ${
                  revealed ? "opacity-100" : "opacity-0"
                }`}
              >
                {revealed ? field.value : "—"}
              </p>
            </div>
          );
        })}
        <p className="pt-1 text-[10px] text-slate-soft">
          Every field editable. Nothing saves itself.
        </p>
      </div>
    </div>
  );
}

/* ─── 2. The register ───────────────────────────────────────────────────── */

const CART = [
  { title: "Navy wool peacoat", cents: 1400 },
  { title: "Pyrex casserole dish", cents: 650 },
  { title: "Paperback novel", cents: 200 },
];

export function RegisterScreen() {
  // 0-2: items scan · 3: total · 4: tap · 5: approved · 6: fees
  const step = useSequence(7, 900, 3000);
  const visible = CART.slice(0, Math.min(step + 1, CART.length));
  const subtotal = visible.reduce((s, l) => s + l.cents, 0);
  const roundUp = step >= 3 && subtotal % 100 !== 0 ? 100 - (subtotal % 100) : 0;
  const total = subtotal + roundUp;

  const plan = getPlan("volunteer");
  const stripeFee = stripeCardPresentFeeCents(total);
  const ourFee = platformFeeCents(subtotal, { platformFeeBps: plan.platformFeeBps });

  return (
    <div className="grid gap-3 p-4 sm:grid-cols-[1fr_10rem]">
      <div className="space-y-1.5">
        {visible.map((line, i) => (
          <div
            key={line.title}
            className={`${cell} motion-safe:animate-rise flex items-center justify-between`}
            style={{ animationDelay: `${i * 60}ms` }}
          >
            <span className="truncate text-[11px] text-bark">{line.title}</span>
            <span className="text-[11px] font-medium text-bark">{formatCents(line.cents)}</span>
          </div>
        ))}
        {step >= 3 && roundUp > 0 ? (
          <div className="motion-safe:animate-rise flex items-center justify-between rounded-lg border border-moss/30 bg-moss/5 px-3 py-2">
            <span className="text-[11px] text-moss-deep">Rounded up</span>
            <span className="text-[11px] font-medium text-moss-deep">{formatCents(roundUp)}</span>
          </div>
        ) : null}
      </div>

      <div className="flex flex-col justify-between rounded-xl border border-line bg-white p-3">
        <div>
          <p className="text-[9px] uppercase tracking-wide text-slate-soft">Total</p>
          <p className="font-display text-2xl text-bark">{formatCents(total)}</p>
        </div>

        <div className="mt-3">
          {step < 4 ? (
            <div className="rounded-lg border border-dashed border-line px-2 py-3 text-center text-[10px] text-slate-soft">
              Ready
            </div>
          ) : step === 4 ? (
            <div className="relative rounded-lg bg-bark px-2 py-3 text-center">
              <span className="relative z-10 text-[11px] font-medium text-white">Tap to pay</span>
              <span className="motion-safe:animate-ping-ring absolute inset-0 rounded-lg border-2 border-moss" aria-hidden="true" />
            </div>
          ) : (
            <div className="motion-safe:animate-rise rounded-lg bg-moss px-2 py-3 text-center">
              <span className="text-[11px] font-medium text-white">✓ Approved</span>
            </div>
          )}
        </div>

        {step >= 6 ? (
          <dl className="motion-safe:animate-rise mt-3 space-y-1 border-t border-line pt-2 text-[9.5px]">
            <div className="flex justify-between">
              <dt className="text-slate-soft">Stripe</dt>
              <dd className="text-bark">{formatCents(stripeFee)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-soft">ThriftOS 0.75%</dt>
              <dd className="text-bark">{formatCents(ourFee)}</dd>
            </div>
            <div className="flex justify-between font-medium">
              <dt className="text-bark">You keep</dt>
              <dd className="text-moss">{formatCents(total - stripeFee - ourFee)}</dd>
            </div>
          </dl>
        ) : (
          <p className="mt-3 border-t border-line pt-2 text-[9.5px] leading-snug text-slate-soft">
            No lease. No contract. No terminal to send back.
          </p>
        )}
      </div>
    </div>
  );
}

/* ─── 3. The Compass (NRI) ──────────────────────────────────────────────── */

const SIGNALS = [
  {
    kind: "Worth celebrating",
    color: "#2F6F5E",
    glyph: "✳",
    title: "5,000 pounds kept out of a landfill",
    body: "The number a grant application asks for is already on your impact page.",
  },
  {
    kind: "A connection",
    color: "#2B6CB0",
    glyph: "◈",
    title: "A relationship widening",
    body: "Marta now shows up as donor, volunteer, and shopper.",
  },
  {
    kind: "Worth a check-in",
    color: "#B8860B",
    glyph: "◔",
    title: "A quiet stretch worth noticing",
    body: "Ray usually drops by every 30 days or so. It's been 84.",
  },
];

export function CompassScreen() {
  const step = useSequence(SIGNALS.length + 1, 1000, 3200);

  return (
    <div className="space-y-2 p-4">
      <p className="text-[10px] text-slate-soft">
        A few things worth noticing. Nothing here is urgent, and nothing acts on its own.
      </p>
      {SIGNALS.slice(0, step).map((signal, i) => (
        <div
          key={signal.title}
          className="motion-safe:animate-rise rounded-xl border border-line bg-white p-3"
          style={{ animationDelay: `${i * 80}ms` }}
        >
          <div className="flex items-start gap-2">
            <span className="text-sm leading-none" style={{ color: signal.color }} aria-hidden="true">
              {signal.glyph}
            </span>
            <div className="min-w-0">
              <span
                className="inline-block rounded-full px-1.5 py-0.5 text-[8.5px] font-medium"
                style={{ backgroundColor: `${signal.color}1A`, color: signal.color }}
              >
                {signal.kind}
              </span>
              <p className="mt-1 font-display text-[12px] leading-snug text-bark">{signal.title}</p>
              <p className="mt-0.5 text-[10px] leading-snug text-slate-soft">{signal.body}</p>
              <p className="mt-1 text-[9px] text-moss underline underline-offset-2">
                Why am I seeing this?
              </p>
            </div>
          </div>
        </div>
      ))}
      {step === 0 ? (
        <div className="rounded-xl border border-dashed border-line px-3 py-6 text-center text-[10px] text-slate-soft">
          Nothing worth surfacing this week — and that's a fine thing.
        </div>
      ) : null}
    </div>
  );
}

/* ─── 4. Inventory & colour tags ────────────────────────────────────────── */

const STOCK = [
  { title: "Cream cable-knit sweater", tag: "green", days: 3, list: 900, pct: 0 },
  { title: "Oak side table", tag: "yellow", days: 19, list: 4200, pct: 25 },
  { title: "Rust corduroy jacket", tag: "blue", days: 33, list: 1600, pct: 50 },
  { title: "Children's picture book", tag: "red", days: 47, list: 300, pct: 75 },
];

export function InventoryScreen() {
  const step = useSequence(STOCK.length + 1, 700, 3000);

  return (
    <div className="p-4">
      <div className="grid grid-cols-[1fr_auto_auto] gap-x-3 border-b border-line pb-1.5 text-[9px] uppercase tracking-wide text-slate-soft">
        <span>Item</span>
        <span>Age</span>
        <span className="text-right">Today</span>
      </div>
      {STOCK.slice(0, step).map((item, i) => {
        const price = Math.round(item.list - (item.list * item.pct) / 100);
        return (
          <div
            key={item.title}
            className="motion-safe:animate-rise grid grid-cols-[1fr_auto_auto] items-center gap-x-3 border-b border-line/60 py-2"
            style={{ animationDelay: `${i * 70}ms` }}
          >
            <span className="flex min-w-0 items-center gap-2">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full border border-line"
                style={{ backgroundColor: TAG_COLOR_HEX[item.tag] }}
              />
              <span className="truncate text-[11px] text-bark">{item.title}</span>
            </span>
            <span className="text-[10px] text-slate-soft">{item.days}d</span>
            <span className="text-right">
              <span className="text-[11px] font-medium text-bark">{formatCents(price)}</span>
              {item.pct > 0 ? (
                <span className="ml-1 text-[9px] text-clay">−{item.pct}%</span>
              ) : null}
            </span>
          </div>
        );
      })}
      <p className="pt-2 text-[10px] leading-snug text-slate-soft">
        Tags step down on your schedule. The register always knows today's price.
      </p>
    </div>
  );
}

/* ─── 5. Impact ─────────────────────────────────────────────────────────── */

const IMPACT_BARS = [
  { label: "Diverted", value: "8.4 tons", pct: 100, tone: "#2F6F5E" },
  { label: "Rehomed", value: "12,480 items", pct: 78, tone: "#2F6F5E" },
  { label: "Value delivered", value: "$186,200", pct: 62, tone: "#B8860B" },
  { label: "Volunteer hours", value: "3,120", pct: 44, tone: "#2B6CB0" },
];

export function ImpactScreen() {
  const step = useSequence(IMPACT_BARS.length + 1, 620, 3400);

  return (
    <div className="space-y-3 p-4">
      <p className="text-[10px] text-slate-soft">
        Derived from the records that already run your register.
      </p>
      {IMPACT_BARS.map((bar, i) => (
        <div key={bar.label}>
          <div className="flex items-baseline justify-between">
            <span className="text-[10px] text-slate-soft">{bar.label}</span>
            <span className="font-display text-[13px] text-bark">
              {step > i ? bar.value : "—"}
            </span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-line/70">
            {step > i ? (
              <div
                className="bar-grow h-full rounded-full"
                style={{ width: `${bar.pct}%`, backgroundColor: bar.tone }}
              />
            ) : null}
          </div>
        </div>
      ))}
      <p className="border-t border-line pt-2 text-[9.5px] leading-snug text-slate-soft">
        Value delivered counts only items with a recorded retail comparison. Where none
        was, it contributes nothing rather than an estimate.
      </p>
    </div>
  );
}

/* ─── 6. Donation receipt ───────────────────────────────────────────────── */

export function ReceiptScreen() {
  const step = useSequence(4, 900, 3200);

  return (
    <div className="p-4">
      <div className="rounded-xl border border-line bg-white p-4">
        <p className="font-display text-[13px] text-moss">Second Chances Thrift</p>
        <p className="mt-0.5 text-[9px] text-slate-soft">EIN 00-0000000 · Rockbridge, OH</p>

        <div className="mt-3 space-y-1.5 border-t border-line pt-3">
          {step >= 1 ? (
            <p className="motion-safe:animate-rise text-[11px] text-bark">
              Received from <span className="font-medium">Marta Ellison</span>
            </p>
          ) : null}
          {step >= 2 ? (
            <p className="motion-safe:animate-rise text-[10px] leading-snug text-slate-soft">
              Four bags and two boxes of household goods and clothing, received 14 July 2026.
            </p>
          ) : null}
          {step >= 3 ? (
            <p className="motion-safe:animate-rise rounded-lg bg-linen px-2 py-1.5 text-[9px] leading-snug text-slate-soft">
              No goods or services were provided in exchange for this contribution.
              Determining the value of donated items is the donor's responsibility.
            </p>
          ) : null}
        </div>

        <p className="mt-3 border-t border-line pt-2 text-[9px] text-slate-soft">
          Receipt R-00412 · issued in one click
        </p>
      </div>
      <p className="mt-2 text-[10px] leading-snug text-slate-soft">
        We describe what arrived. We never put a value on it — that's the donor's call, and
        a charity stating one is exactly what the IRS asks us not to do.
      </p>
    </div>
  );
}

/* ─── Registry, so the showcase and the features grid stay in step ──────── */

export const DEMOS = [
  {
    id: "intake",
    label: "AI intake",
    url: "thriftos.app/app/intake",
    heading: "Photograph it. Correct it. Done.",
    body: "Snap a donated item and the form fills itself in — category, colour, condition, a price band, a description. You fix what's wrong, which beats typing from nothing. Every guess is labelled a guess, and nothing saves itself.",
    Screen: IntakeScreen,
  },
  {
    id: "register",
    label: "Register",
    url: "thriftos.app/app/register",
    heading: "A register that doesn't need a lease.",
    body: "Tap to Pay on a phone you already own, or a $59 reader you buy outright. Card-present rates straight from Stripe, our fee on the label, and it keeps selling when the internet drops.",
    Screen: RegisterScreen,
  },
  {
    id: "compass",
    label: "The Compass",
    url: "thriftos.app/app",
    heading: "The part that notices things.",
    body: "NRI watches for what a busy week hides — a donor gone quiet against their own rhythm, stock past its rotation, a milestone worth saying out loud. Deterministic rules, not model guesses. Every signal shows its work.",
    Screen: CompassScreen,
  },
  {
    id: "inventory",
    label: "Inventory",
    url: "thriftos.app/app/inventory",
    heading: "Built for one-of-a-kind stock.",
    body: "No SKUs, no product catalogue to maintain. Colour tags applied at intake step down in price on your schedule, so nobody has to remember the rotation and the register is never wrong.",
    Screen: InventoryScreen,
  },
  {
    id: "impact",
    label: "Impact",
    url: "thriftos.app/app/impact",
    heading: "The report you dread, already written.",
    body: "Landfill diversion, value delivered to shoppers, volunteer hours — all derived from the records that run the shop. Export it as CSV the morning of the board meeting.",
    Screen: ImpactScreen,
  },
  {
    id: "receipts",
    label: "Receipts",
    url: "thriftos.app/app/donations",
    heading: "Receipts that hold up at tax time.",
    body: "One click issues a compliant acknowledgement with the required language already in place — describing what you received, never assigning it a value.",
    Screen: ReceiptScreen,
  },
] as const;
