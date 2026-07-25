import type { Route } from "./+types/pricing";
import { faqSchema, jsonLd, marketingMeta } from "../lib/seo";
import { MarketingFooter, MarketingHeader, Section } from "../components/marketing";
import { LinkButton } from "../components/ui";
import {
  formatCents,
  PLANS,
  PLATFORM_FEE_BPS,
  stallBreakEvenSales,
  usageCapCents,
} from "../lib/pricing";

const FAQ = [
  {
    question: "What happens if we have a really busy month on the entry plan?",
    answer:
      "It caps. The per-sale charge stops at whatever the Shop plan costs, so a busy month costs the same as simply being on Shop. A good month is never a penalty.",
  },
  {
    question: "Is there a setup fee or a contract?",
    answer: "No to both. Monthly, cancel whenever, and your data exports as CSV on the way out.",
  },
  {
    question: "Who is the merchant of record for card payments?",
    answer:
      "Your shop. Payments run through Stripe Connect under your account, so receipts carry your name and payouts land with you. We take a 1% platform fee, shown on the label every time.",
  },
  {
    question: "Do you charge for volunteers as seats?",
    answer:
      "No. Volunteer logins are included on every plan — charging per volunteer would be a strange thing to do to a shop staffed by volunteers.",
  },
];

export function meta() {
  return marketingMeta({
    title: "Pricing",
    description:
      "Start at 12¢ a sale with no monthly fee, capped at the flat plan's price. No setup fee, no contract, and volunteer logins are always free.",
    path: "/pricing",
  });
}

export function loader() {
  return {
    plans: PLANS.map((p) => ({ ...p, features: [...p.features] })),
    capCents: usageCapCents(),
    breakEven: stallBreakEvenSales(),
    platformFeePct: PLATFORM_FEE_BPS / 100,
  };
}

export default function Pricing({ loaderData }: Route.ComponentProps) {
  const { plans, capCents, breakEven, platformFeePct } = loaderData;

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={jsonLd([faqSchema(FAQ)])} />

      <MarketingHeader />

      <main>
        <Section>
          <div className="max-w-2xl">
            <h1 className="font-display text-4xl text-bark">What it costs</h1>
            <p className="mt-4 text-lg leading-relaxed text-slate-soft">
              Every fee is on this page. There is no "contact sales" tier and nothing that
              appears later on an invoice.
            </p>
          </div>

          <div className="mt-12 grid gap-6 lg:grid-cols-4">
            {plans.map((plan) => (
              <div
                key={plan.id}
                className={`rounded-2xl border p-6 ${
                  plan.id === "shop" ? "border-moss bg-white" : "border-line bg-white"
                }`}
              >
                <h2 className="font-display text-xl text-bark">{plan.name}</h2>
                <p className="mt-3">
                  {plan.monthlyCents > 0 ? (
                    <>
                      <span className="font-display text-3xl text-bark">
                        {formatCents(plan.monthlyCents)}
                      </span>
                      <span className="text-sm text-slate-soft">/month</span>
                    </>
                  ) : (
                    <>
                      <span className="font-display text-3xl text-bark">{plan.perSaleCents}¢</span>
                      <span className="text-sm text-slate-soft"> a sale</span>
                    </>
                  )}
                </p>
                <p className="mt-2 text-sm leading-relaxed text-slate-soft">{plan.blurb}</p>
                <p className="mt-3 text-xs text-slate-soft">{plan.bestFor}</p>
                <ul className="mt-5 space-y-2 border-t border-line pt-4">
                  {plan.features.map((feature) => (
                    <li key={feature} className="text-xs leading-relaxed text-slate-soft">
                      · {feature}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <div className="mt-8 rounded-2xl border border-moss/30 bg-moss/5 p-6">
            <h2 className="font-display text-lg text-bark">
              The entry plan can't cost more than the next one
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-soft">
              Stall bills {plans[0].perSaleCents}¢ a sale and stops at {formatCents(capCents)} —
              exactly what Shop costs. You reach that at about {breakEven} sales in a month,
              and past that point you pay nothing further. We'd rather you found out from this
              page than from a bill.
            </p>
          </div>
        </Section>

        <Section tinted>
          <div className="max-w-2xl">
            <h2 className="font-display text-3xl text-bark">Card payments</h2>
            <p className="mt-4 leading-relaxed text-slate-soft">
              Payments run through Stripe Connect with your shop as the merchant of record.
              Receipts carry your name, payouts go to your account, and we take a{" "}
              {platformFeePct}% platform fee on top of Stripe's own published rate.
            </p>
            <p className="mt-4 leading-relaxed text-slate-soft">
              At checkout, shoppers paying by card can choose to cover the processing fees so
              the full amount reaches you. It's on by default and clearly labelled — most
              people say yes when asked plainly, and nobody is tricked into it.
            </p>
            <p className="mt-4 leading-relaxed text-slate-soft">
              Cash sales cost you nothing beyond your plan, because no card ever touched them.
            </p>
          </div>
        </Section>

        <Section>
          <div className="max-w-2xl">
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
              <LinkButton to="/signup" variant="secondary">
                Set up your shop
              </LinkButton>
            </div>
          </div>
        </Section>
      </main>

      <MarketingFooter />
    </>
  );
}
