import { Link } from "react-router";
import type { Route } from "./+types/pricing";
import { faqSchema, jsonLd, marketingMeta } from "../lib/seo";
import { MarketingFooter, MarketingHeader } from "../components/marketing";
import { LinkButton } from "../components/ui";
import { Reveal } from "../components/motion";
import { SavingsCalculator } from "../components/SavingsCalculator";
import {
  formatBps,
  formatCents,
  formatDollars,
  PLANS,
  READER_M2_CENTS,
  STRIPE_CARD_PRESENT_BPS,
  STRIPE_CARD_PRESENT_FIXED_CENTS,
} from "../lib/pricing";
import { feeCapVolumeCents, maxMonthlyCostCents } from "../lib/savings";

const FAQ = [
  {
    question: "What exactly is the platform fee?",
    answer:
      "A percentage of card sales — 0.75% on Volunteer down to 0.25% on Enterprise — charged on top of Stripe's own processing rate, and capped each month at your subscription price. It is not a donation and we don't call it one. Cash sales carry no platform fee at all.",
  },
  {
    question: "Does the fee apply to sales tax and round-up donations?",
    answer:
      "No. The fee is charged on merchandise after discounts. Sales tax is the state's money and a round-up is the customer's donation — charging a platform fee on either would be hard to explain to a shop, so we don't.",
  },
  {
    question: "What happens if my card fails?",
    answer:
      "You get 14 days' grace, and we never switch off your register. A shop that owes us money can still take a customer's money, and can still export its data. Locking a till on a Saturday isn't a billing strategy.",
  },
  {
    question: "Is there a free trial?",
    answer:
      "30 days, no card required. If it isn't right, walk away and take your data with you.",
  },
  {
    question: "Is there a setup fee, contract, or hardware lease?",
    answer:
      "None of the three. Monthly, cancel whenever, and your data exports as CSV on the way out. A card reader is $59 bought outright, or nothing if you use Tap to Pay on a phone you already own.",
  },
  {
    question: "Do you charge per volunteer?",
    answer:
      "No. Volunteer logins are unlimited and free on every plan. Charging per seat in a shop staffed by volunteers would be a strange thing to do.",
  },
  {
    question: "Could ThriftOS end up costing me more than what I have?",
    answer:
      "Against the systems we compare to, no — the platform fee is capped at your subscription, so it stops growing and we stay cheaper at every volume. If you're on something cheaper than $150/month with bundled processing, run it through the calculator; it will tell you plainly if we'd cost more.",
  },
  {
    question: "Is there an annual discount?",
    answer:
      "Yes — pay for ten months and get twelve. That's about 16.7% off, and it's the same discount on every plan.",
  },
];

export function meta() {
  return marketingMeta({
    title: "Pricing",
    description:
      "From $39/month with no contract and no hardware lease. Every fee on the label — including where a competitor would cost you less.",
    path: "/pricing",
  });
}

export function loader() {
  return {
    plans: PLANS.map((p) => ({ ...p, features: [...p.features] })),
    capVolumeCents: feeCapVolumeCents("volunteer") ?? 0,
    maxVolunteerCents: maxMonthlyCostCents("volunteer"),
    readerPrice: READER_M2_CENTS,
    stripeRate: `${(STRIPE_CARD_PRESENT_BPS / 100).toFixed(1)}% + ${STRIPE_CARD_PRESENT_FIXED_CENTS}¢`,
  };
}

export default function Pricing({ loaderData }: Route.ComponentProps) {
  const { plans, capVolumeCents, maxVolunteerCents, readerPrice, stripeRate } = loaderData;

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={jsonLd([faqSchema(FAQ)])} />

      <MarketingHeader />

      <main>
        <section className="relative overflow-hidden border-b border-line">
          <div className="aurora opacity-60" aria-hidden="true" />
          <div className="relative mx-auto max-w-6xl px-4 py-16 sm:py-20">
            <Reveal>
              <h1 className="font-display text-4xl text-bark sm:text-5xl">
                Every fee on the label
              </h1>
              <p className="mt-4 max-w-2xl text-lg leading-relaxed text-slate-soft">
                No "contact sales" tier, no setup fee, no hardware lease, and nothing that
                turns up later on an invoice.
              </p>
            </Reveal>

            <div className="mt-12 grid gap-5 lg:grid-cols-4">
              {plans.map((plan, i) => (
                <Reveal key={plan.id} delay={i * 70}>
                  <div
                    className={`flex h-full flex-col rounded-2xl border bg-white p-6 transition hover:-translate-y-1 hover:shadow-lg ${
                      plan.id === "core" ? "border-moss shadow-md" : "border-line"
                    }`}
                  >
                    {plan.id === "core" ? (
                      <span className="mb-3 w-fit rounded-full bg-moss/10 px-2.5 py-0.5 text-[11px] font-medium text-moss">
                        Most shops
                      </span>
                    ) : null}

                    <h2 className="font-display text-xl text-bark">{plan.name}</h2>

                    <p className="mt-3">
                      {plan.startingAt ? (
                        <span className="text-xs text-slate-soft">from </span>
                      ) : null}
                      <span className="font-display text-4xl text-bark">
                        {formatCents(plan.monthlyCents)}
                      </span>
                      <span className="text-sm text-slate-soft">/mo</span>
                    </p>

                    <p className="mt-2 inline-flex w-fit items-center gap-1.5 rounded-full bg-linen px-2.5 py-1 text-xs text-bark">
                      <span className="h-1.5 w-1.5 rounded-full bg-moss" />
                      {formatBps(plan.platformFeeBps)} platform fee
                    </p>

                    <p className="mt-3 text-sm leading-relaxed text-slate-soft">{plan.blurb}</p>
                    <p className="mt-2 text-xs text-slate-soft">{plan.bestFor}</p>

                    <p className="mt-3 text-xs text-slate-soft">
                      {plan.maxLocations === null
                        ? "Locations: negotiated"
                        : `${plan.maxLocations} location${plan.maxLocations > 1 ? "s" : ""}`}
                    </p>

                    <ul className="mt-5 flex-1 space-y-2 border-t border-line pt-4">
                      {plan.features.map((feature) => (
                        <li key={feature} className="flex gap-2 text-xs leading-relaxed text-slate-soft">
                          <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-moss" />
                          {feature}
                        </li>
                      ))}
                    </ul>

                    <div className="mt-5">
                      <LinkButton
                        to={plan.id === "enterprise" ? "/compare" : "/signup"}
                        variant={plan.id === "core" ? "primary" : "secondary"}
                        className="w-full"
                      >
                        {plan.id === "enterprise" ? "Talk to us" : "Start here"}
                      </LinkButton>
                    </div>
                  </div>
                </Reveal>
              ))}
            </div>

            <Reveal delay={200}>
              <p className="mt-6 rounded-xl border border-moss/30 bg-moss/5 px-5 py-4 text-sm leading-relaxed text-slate-soft">
                <strong className="text-bark">Your platform fee is capped at your
                subscription.</strong>{" "}
                On Volunteer it stops at {formatCents(3_900)} a month — reached at about{" "}
                {formatDollars(capVolumeCents)} in card sales — so the most you can ever pay us
                is <strong className="text-bark">{formatCents(maxVolunteerCents)}</strong> a
                month, however busy you get.
              </p>
              <p className="mt-3 rounded-xl border border-line bg-white px-5 py-4 text-sm leading-relaxed text-slate-soft">
                <strong className="text-bark">Which tier?</strong> Not the one with the most
                card volume — Volunteer is the cheapest plan at every volume, and we're not
                going to pretend otherwise to sell you an upgrade. Move up when you need more
                locations or a bigger AI intake allowance. That's the only reason.
              </p>
            </Reveal>
          </div>
        </section>

        {/* ── Calculator ───────────────────────────────────────────────── */}
        <section className="mx-auto max-w-6xl px-4 py-16">
          <Reveal>
            <h2 className="font-display text-3xl text-bark">Work out your real bill</h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-soft">
              Subscription plus processing plus our fee, against what you're paying now.
            </p>
          </Reveal>
          <Reveal delay={100}>
            <div className="mt-8">
              <SavingsCalculator />
            </div>
          </Reveal>
        </section>

        {/* ── Payments ─────────────────────────────────────────────────── */}
        <section className="border-y border-line bg-white py-16">
          <div className="mx-auto max-w-3xl px-4">
            <Reveal>
              <h2 className="font-display text-3xl text-bark">How card payments work</h2>
              <div className="mt-6 space-y-4 leading-relaxed text-slate-soft">
                <p>
                  Payments run through Stripe Connect with{" "}
                  <strong className="text-bark">your shop as the merchant of record</strong>.
                  Receipts carry your name, payouts land in your account, and you keep your own
                  Stripe dashboard.
                </p>
                <p>
                  Stripe charges its published card-present rate of{" "}
                  <strong className="text-bark">{stripeRate}</strong>. ThriftOS adds the
                  platform fee shown on your plan. Both appear on every transaction record —
                  there is no bundled "effective rate" hiding one inside the other.
                </p>
                <p>
                  <strong className="text-bark">Cash sales cost nothing extra.</strong> No
                  processing, no platform fee. Only the subscription applies.
                </p>
                <p>
                  Hardware is a <strong className="text-bark">{formatCents(readerPrice)}</strong>{" "}
                  Stripe Reader M2 you own, or Tap to Pay on a phone you already have. If you
                  leave, there's nothing to return and no buyout to negotiate.
                </p>
              </div>
            </Reveal>
          </div>
        </section>

        {/* ── FAQ ──────────────────────────────────────────────────────── */}
        <section className="mx-auto max-w-3xl px-4 py-16">
          <Reveal>
            <h2 className="font-display text-3xl text-bark">Questions</h2>
            <dl className="mt-8 space-y-6">
              {FAQ.map((item) => (
                <div key={item.question}>
                  <dt className="font-display text-lg text-bark">{item.question}</dt>
                  <dd className="mt-1.5 leading-relaxed text-slate-soft">{item.answer}</dd>
                </div>
              ))}
            </dl>

            <div className="mt-10 flex flex-wrap gap-3">
              <LinkButton to="/demo">Look around first</LinkButton>
              <LinkButton to="/compare" variant="secondary">
                Compare with the alternatives
              </LinkButton>
            </div>

            <p className="mt-6 text-sm text-slate-soft">
              Still deciding?{" "}
              <Link to="/nri" className="text-moss underline underline-offset-2">
                Read how NRI works
              </Link>{" "}
              — it's the part that's hardest to copy.
            </p>
          </Reveal>
        </section>
      </main>

      <MarketingFooter />
    </>
  );
}
