import { Link } from "react-router";
import type { Route } from "./+types/compare";
import { breadcrumbSchema, faqSchema, jsonLd, marketingMeta } from "../lib/seo";
import { MarketingFooter, MarketingHeader } from "../components/marketing";
import { LinkButton } from "../components/ui";
import { Reveal } from "../components/motion";
import { SavingsCalculator } from "../components/SavingsCalculator";
import {
  calculateSavings,
  COMPETITORS,
  percentFeeCrossoverVolumeCents,
  SCENARIOS,
} from "../lib/savings";
import { formatCents, formatDollars, getPlan, READER_M2_CENTS } from "../lib/pricing";

const FAQ = [
  {
    question: "Is ThriftOS always cheaper?",
    answer:
      "Against every system on this page, yes — because the platform fee is capped at your subscription, so it stops growing while their percentage processing doesn't. Against something cheaper than $150/month with bundled processing, run the calculator; it will tell you honestly if we'd cost more.",
  },
  {
    question: "What is the hardware actually going to cost me?",
    answer:
      "A Stripe Reader M2 is $59, bought outright. Tap to Pay on a phone or tablet you already own costs nothing. There is no lease, no term, and nothing to return if you leave.",
  },
  {
    question: "Who is the merchant of record for card payments?",
    answer:
      "Your shop. Payments run through Stripe Connect under your own account, so receipts carry your name and payouts land in your bank. ThriftOS takes a disclosed platform fee on top of Stripe's published rate.",
  },
  {
    question: "What happens to my data if I leave?",
    answer:
      "It exports as CSV, and there is no notice period. We would rather lose a customer cleanly than keep one who wants to go.",
  },
];

const MATRIX: {
  feature: string;
  thriftos: string;
  others: string;
  advantage: "us" | "them" | "even";
}[] = [
  {
    feature: "Card reader cost",
    thriftos: "$0 Tap to Pay, or $59 outright",
    others: "$190–$254/mo on a 48-month lease",
    advantage: "us",
  },
  {
    feature: "Contract term",
    thriftos: "Monthly, cancel any time",
    others: "48-month non-cancellable hardware term",
    advantage: "us",
  },
  {
    feature: "Entry price",
    thriftos: "$39/month",
    others: "$150–$350/month",
    advantage: "us",
  },
  {
    feature: "Donation receipts",
    thriftos: "Built in, IRS-compliant language",
    others: "Usually built in",
    advantage: "even",
  },
  {
    feature: "Volunteer scheduling & hours",
    thriftos: "Included on every plan",
    others: "Often a paid module",
    advantage: "us",
  },
  {
    feature: "Impact reporting",
    thriftos: "Diversion, value delivered, hours — derived automatically",
    others: "Rarely included; usually a spreadsheet",
    advantage: "us",
  },
  {
    feature: "AI photo intake",
    thriftos: "Included, editable by default",
    others: "Not generally offered",
    advantage: "us",
  },
  {
    feature: "Per-person roles (donor + volunteer + shopper)",
    thriftos: "One record, roles stack",
    others: "Usually separate modules",
    advantage: "us",
  },
  {
    feature: "Online store / e-commerce",
    thriftos: "Browse-and-visit storefront only",
    others: "Mature, full checkout",
    advantage: "them",
  },
  {
    feature: "Platform fee on card volume",
    thriftos: "0.25%–0.75% on top of Stripe, capped at your subscription",
    others: "None as a line item — bundled into a higher processing rate",
    advantage: "even",
  },
  {
    feature: "Track record & support depth",
    thriftos: "New. Fewer edge cases seen",
    others: "Years of thrift-specific experience",
    advantage: "them",
  },
  {
    feature: "Installation & hardware partners",
    thriftos: "Self-serve only",
    others: "Installer networks available",
    advantage: "them",
  },
];

export function meta() {
  return marketingMeta({
    title: "ThriftOS vs ThriftCart, ThriftTrac, and leased terminals",
    description:
      "An honest comparison of thrift store POS systems — including the volumes at which competitors beat ThriftOS on price, and the features where they're simply better.",
    path: "/compare",
  });
}

export function loader() {
  const rows = COMPETITORS.map((competitor) => {
    const scenarios = SCENARIOS.map((scenario) => {
      const result = calculateSavings({
        monthlyCardVolumeCents: scenario.monthlyCardVolumeCents,
        averageTicketCents: scenario.averageTicketCents,
        competitorId: competitor.id,
        needsReader: competitor.leaseTermMonths > 0,
      });
      return {
        id: scenario.id,
        label: scenario.label,
        incumbentCents: result.incumbent.totalCents,
        thriftosCents: result.thriftos.totalCents,
        savingsCents: result.monthlySavingsCents,
        savingsPct: result.savingsBps / 100,
        verdict: result.verdict,
      };
    });

    const crossover = percentFeeCrossoverVolumeCents(competitor.id, 1_200);

    return {
      id: competitor.id,
      name: competitor.name,
      note: competitor.note,
      softwareCents: competitor.softwareMonthlyCents,
      leaseCents: competitor.hardwareLeaseMonthlyCents,
      leaseTermMonths: competitor.leaseTermMonths,
      leaseTotalCents: competitor.hardwareLeaseMonthlyCents * competitor.leaseTermMonths,
      crossoverCents: Number.isFinite(crossover) ? crossover : null,
      scenarios,
    };
  });

  return { rows, readerPrice: READER_M2_CENTS, entryPrice: getPlan("volunteer").monthlyCents };
}

export default function Compare({ loaderData }: Route.ComponentProps) {
  const { rows, readerPrice, entryPrice } = loaderData;

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={jsonLd([
          faqSchema(FAQ),
          breadcrumbSchema([{ label: "Home", path: "/" }, { label: "Compare" }]),
        ])}
      />

      <MarketingHeader />

      <main>
        <section className="relative overflow-hidden border-b border-line">
          <div className="aurora opacity-70" aria-hidden="true" />
          <div className="relative mx-auto max-w-6xl px-4 py-16 sm:py-24">
            <Reveal>
              <h1 className="max-w-3xl font-display text-4xl leading-tight text-bark sm:text-5xl">
                An honest comparison, including the parts that don't flatter us
              </h1>
              <p className="mt-5 max-w-2xl text-lg leading-relaxed text-slate-soft">
                We'd rather you bought the right thing than bought ours. Below is where each
                option genuinely wins — with the arithmetic shown, and the volumes at which
                competitors beat us on price stated plainly.
              </p>
            </Reveal>
          </div>
        </section>

        {/* ── Cost table ───────────────────────────────────────────────── */}
        <section className="mx-auto max-w-6xl px-4 py-16">
          <Reveal>
            <h2 className="font-display text-3xl text-bark">What it costs, side by side</h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-soft">
              Every figure below is computed from published pricing at a $12 average sale.
              Where we come out more expensive, the row says so.
            </p>
          </Reveal>

          <div className="mt-8 space-y-6">
            {rows.map((row, i) => (
              <Reveal key={row.id} delay={i * 60}>
                <div className="overflow-hidden rounded-2xl border border-line bg-white">
                  <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-line bg-linen/50 px-5 py-4">
                    <div>
                      <h3 className="font-display text-xl text-bark">{row.name}</h3>
                      <p className="mt-0.5 text-xs text-slate-soft">{row.note}</p>
                    </div>
                    <div className="text-right text-xs text-slate-soft">
                      <p>{formatCents(row.softwareCents)}/mo software</p>
                      {row.leaseCents > 0 ? (
                        <p className="text-clay">
                          + {formatCents(row.leaseCents)}/mo lease ×{row.leaseTermMonths} ={" "}
                          {formatDollars(row.leaseTotalCents)}
                        </p>
                      ) : (
                        <p>No hardware lease</p>
                      )}
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[36rem] text-sm">
                      <thead className="border-b border-line text-left">
                        <tr>
                          <th className="px-5 py-2.5 font-medium text-slate-soft">Shop size</th>
                          <th className="px-5 py-2.5 text-right font-medium text-slate-soft">
                            {row.name}
                          </th>
                          <th className="px-5 py-2.5 text-right font-medium text-slate-soft">
                            ThriftOS
                          </th>
                          <th className="px-5 py-2.5 text-right font-medium text-slate-soft">
                            Difference
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-line">
                        {row.scenarios.map((s) => (
                          <tr key={s.id}>
                            <td className="px-5 py-3 text-bark">{s.label}</td>
                            <td className="px-5 py-3 text-right text-slate-soft">
                              {formatCents(s.incumbentCents)}
                            </td>
                            <td className="px-5 py-3 text-right text-slate-soft">
                              {formatCents(s.thriftosCents)}
                            </td>
                            <td className="px-5 py-3 text-right">
                              {/* whitespace-nowrap on the signed amount. A minus
                                  sign and a currency symbol are both "prefix
                                  numeric" to the line-breaking algorithm, which
                                  allows a break between them — so a narrow
                                  column strands the − on its own line and the
                                  saving reads as a cost. */}
                              {s.savingsCents > 0 ? (
                                <span className="font-medium text-moss">
                                  <span className="whitespace-nowrap">
                                    −{formatCents(s.savingsCents)}
                                  </span>{" "}
                                  <span className="whitespace-nowrap text-xs font-normal text-slate-soft">
                                    ({s.savingsPct.toFixed(1)}%)
                                  </span>
                                </span>
                              ) : (
                                <span className="font-medium text-clay">
                                  <span className="whitespace-nowrap">
                                    +{formatCents(Math.abs(s.savingsCents))}
                                  </span>{" "}
                                  <span className="text-xs font-normal text-slate-soft">
                                    we cost more
                                  </span>
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <p className="border-t border-line bg-linen/40 px-5 py-3 text-xs leading-relaxed text-slate-soft">
                    {row.crossoverCents ? (
                      <>
                        ThriftOS is cheaper up to about{" "}
                        <strong className="text-bark">{formatDollars(row.crossoverCents)}</strong>{" "}
                        a month in card sales. Above that, {row.name} wins on cost.
                      </>
                    ) : (
                      <>
                        Our platform fee is capped at your subscription, so it stops growing
                        while {row.name}'s percentage processing keeps climbing. There is no
                        volume at which they become cheaper — the gap widens as you grow.
                      </>
                    )}
                  </p>
                </div>
              </Reveal>
            ))}
          </div>
        </section>

        {/* ── Feature matrix ───────────────────────────────────────────── */}
        <section className="border-y border-line bg-white py-16">
          <div className="mx-auto max-w-5xl px-4">
            <Reveal>
              <h2 className="font-display text-3xl text-bark">Feature for feature</h2>
              <p className="mt-2 text-sm text-slate-soft">
                Three of these rows go against us. They're in the same table as the rest.
              </p>
            </Reveal>

            {/* Scrolls rather than squeezes. At 390px the third column was
                simply clipped, with no way to reach it — and that column is
                where the comparison actually lives. */}
            <div className="mt-8 overflow-x-auto rounded-2xl border border-line">
              <table className="w-full min-w-[40rem] text-sm">
                <thead className="bg-linen/60 text-left">
                  <tr>
                    <th className="px-4 py-3 font-medium text-slate-soft">Feature</th>
                    <th className="px-4 py-3 font-medium text-slate-soft">ThriftOS</th>
                    <th className="px-4 py-3 font-medium text-slate-soft">Typical alternative</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line bg-white">
                  {MATRIX.map((row) => (
                    <tr
                      key={row.feature}
                      className={row.advantage === "them" ? "bg-clay/[0.03]" : undefined}
                    >
                      <td className="px-4 py-3 font-medium text-bark">
                        {row.feature}
                        {row.advantage === "them" ? (
                          <span className="ml-2 rounded-full bg-clay/10 px-2 py-0.5 text-[10px] font-medium text-clay">
                            they win
                          </span>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-slate-soft">{row.thriftos}</td>
                      <td className="px-4 py-3 text-slate-soft">{row.others}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* ── Calculator ───────────────────────────────────────────────── */}
        <section className="mx-auto max-w-6xl px-4 py-16">
          <Reveal>
            <h2 className="font-display text-3xl text-bark">Run your own numbers</h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-soft">
              Your volume, your average sale, your current system.
            </p>
          </Reveal>
          <Reveal delay={100}>
            <div className="mt-8">
              <SavingsCalculator />
            </div>
          </Reveal>
        </section>

        {/* ── FAQ ──────────────────────────────────────────────────────── */}
        <section className="border-t border-line bg-white py-16">
          <div className="mx-auto max-w-3xl px-4">
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

              <div className="mt-10 rounded-2xl border border-line bg-linen/60 p-6">
                <p className="leading-relaxed text-bark">
                  If you're currently leasing a terminal, this is the easiest decision on the
                  page: {formatCents(readerPrice)} once instead of thousands over four years,
                  and {formatCents(entryPrice)} a month to run the shop.
                </p>
                <div className="mt-5 flex flex-wrap gap-3">
                  <LinkButton to="/demo">Open the demo shop</LinkButton>
                  <LinkButton to="/pricing" variant="secondary">
                    See the pricing
                  </LinkButton>
                </div>
              </div>

              <p className="mt-6 text-xs leading-relaxed text-slate-soft">
                Competitor pricing is drawn from publicly published rates and third-party
                comparisons and may have changed since. If we've got something wrong about your
                product,{" "}
                <Link to="/guides" className="underline underline-offset-2">
                  tell us
                </Link>{" "}
                and we'll correct it.
              </p>
            </Reveal>
          </div>
        </section>
      </main>

      <MarketingFooter />
    </>
  );
}
