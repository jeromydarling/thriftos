import { useState } from "react";
import { Link } from "react-router";
import type { Route } from "./+types/home";
import {
  jsonLd,
  marketingMeta,
  organizationSchema,
  softwareApplicationSchema,
  websiteSchema,
} from "../lib/seo";
import { MarketingFooter, MarketingHeader } from "../components/marketing";
import { LinkButton } from "../components/ui";
import { BrowserFrame } from "../components/BrowserFrame";
import { DEMOS } from "../components/screens";
import { CountUp, Marquee, Reveal, Typewriter, useCycle } from "../components/motion";
import { SavingsCalculator } from "../components/SavingsCalculator";
import { calculateSavings, LABOUR_CLAIM, intakeHoursSavedPerMonth } from "../lib/savings";
import { formatCents, formatDollars, getPlan, READER_M2_CENTS } from "../lib/pricing";

export function meta() {
  return marketingMeta({
    title: "ThriftOS — the thrift store operating system with no hardware lease",
    description:
      "Register, inventory, donors, volunteers, and impact reporting in one place. Tap to Pay or a $59 reader — no 48-month lease, no contract. See exactly what you'd save.",
    path: "/",
  });
}

export function loader() {
  // Every headline figure is computed, never pasted — so the page can't outlive
  // the model behind it.
  const leasedSmall = calculateSavings({
    monthlyCardVolumeCents: 1_500_000,
    averageTicketCents: 1_200,
    competitorId: "leased-mid",
    needsReader: true,
  });
  const softwareSmall = calculateSavings({
    monthlyCardVolumeCents: 1_500_000,
    averageTicketCents: 1_200,
    competitorId: "thriftcart",
  });

  return {
    volunteerPrice: getPlan("volunteer").monthlyCents,
    readerPrice: READER_M2_CENTS,
    leasedAnnualSavings: leasedSmall.annualSavingsCents,
    leasedPct: leasedSmall.savingsBps / 100,
    leaseBuyout: leasedSmall.leaseBuyoutCents,
    softwareAnnualSavings: softwareSmall.annualSavingsCents,
    softwarePct: softwareSmall.savingsBps / 100,
    hoursSaved: intakeHoursSavedPerMonth(1_000),
  };
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const {
    volunteerPrice,
    readerPrice,
    leasedAnnualSavings,
    leasedPct,
    leaseBuyout,
    softwareAnnualSavings,
    softwarePct,
    hoursSaved,
  } = loaderData;

  const [demoIndex, setDemoIndex] = useCycle(DEMOS.length, 5200);
  const [paused, setPaused] = useState(false);
  const demo = DEMOS[demoIndex];
  const Screen = demo.Screen;

  // JSX needs a capitalised binding — DEMOS[1].Screen isn't a valid element.
  const IntakeDemo = DEMOS[0].Screen;
  const RegisterDemo = DEMOS[1].Screen;
  const CompassDemo = DEMOS[2].Screen;

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={jsonLd([
          organizationSchema(),
          websiteSchema(),
          softwareApplicationSchema(volunteerPrice / 100),
        ])}
      />

      <MarketingHeader />

      <main>
        {/* ── Hero ─────────────────────────────────────────────────────── */}
        <section className="relative overflow-hidden">
          <div className="aurora" aria-hidden="true" />
          <div className="grid-lines absolute inset-0" aria-hidden="true" />

          <div className="relative mx-auto max-w-6xl px-4 pb-20 pt-16 sm:pt-24">
            <div className="grid items-center gap-12 lg:grid-cols-[1fr_1.05fr]">
              <div>
                <Reveal>
                  <span className="inline-flex items-center gap-2 rounded-full border border-moss/25 bg-white/70 px-3 py-1 text-xs font-medium text-moss backdrop-blur">
                    <span className="h-1.5 w-1.5 rounded-full bg-moss motion-safe:animate-pulse-soft" />
                    No lease · No contract · No terminal to send back
                  </span>
                </Reveal>

                <Reveal delay={80}>
                  <h1 className="mt-6 font-display text-4xl leading-[1.1] text-bark sm:text-5xl lg:text-6xl">
                    Stop renting
                    <br />
                    <span className="shimmer-text">
                      <Typewriter
                        phrases={[
                          "your card terminal.",
                          "your own register.",
                          "a 48-month contract.",
                        ]}
                      />
                    </span>
                  </h1>
                </Reveal>

                <Reveal delay={160}>
                  <p className="mt-6 max-w-xl text-lg leading-relaxed text-slate-soft">
                    ThriftOS runs the register, the racks, and the relationships — on a phone
                    you already own, or a reader that costs{" "}
                    <strong className="text-bark">{formatCents(readerPrice)}</strong> outright.
                    Not {formatDollars(leaseBuyout)} over four years.
                  </p>
                </Reveal>

                <Reveal delay={240}>
                  <div className="mt-8 flex flex-wrap gap-3">
                    <LinkButton to="/demo">Open the demo shop</LinkButton>
                    <LinkButton to="#savings" variant="secondary">
                      What would I save?
                    </LinkButton>
                  </div>
                </Reveal>

                <Reveal delay={320}>
                  <dl className="mt-10 grid max-w-lg grid-cols-3 gap-4 border-t border-line pt-6">
                    <div>
                      <dt className="text-xs text-slate-soft">Starts at</dt>
                      <dd className="font-display text-2xl text-bark">
                        {formatCents(volunteerPrice)}
                        <span className="text-sm text-slate-soft">/mo</span>
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-slate-soft">Hardware</dt>
                      <dd className="font-display text-2xl text-moss">
                        $0<span className="text-sm text-slate-soft">–59</span>
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-slate-soft">Contract</dt>
                      <dd className="font-display text-2xl text-bark">None</dd>
                    </div>
                  </dl>
                </Reveal>
              </div>

              <Reveal delay={200} from="scale">
                <BrowserFrame url="thriftos.app/app/register" tone="pos" floating>
                  <RegisterDemo />
                </BrowserFrame>
              </Reveal>
            </div>
          </div>
        </section>

        {/* ── The lease marquee ────────────────────────────────────────── */}
        <section className="border-y border-line bg-white py-6">
          <p className="mb-4 text-center text-xs uppercase tracking-wider text-slate-soft">
            What thrift shops are quoted for hardware
          </p>
          <Marquee speed={38}>
            {[
              "48-month lease · $190/mo",
              "48-month lease · $254/mo",
              "Non-cancellable term",
              "Early termination fee",
              "Equipment must be returned",
              "$9,120 total obligation",
              "$12,192 total obligation",
            ].map((item) => (
              <span
                key={item}
                className="mx-3 whitespace-nowrap rounded-full border border-clay/25 bg-clay/5 px-4 py-1.5 text-sm text-clay"
              >
                {item}
              </span>
            ))}
          </Marquee>
          <p className="mt-4 text-center text-sm text-bark">
            ThriftOS: <strong className="text-moss">{formatCents(readerPrice)} once</strong>, or
            nothing at all if you tap on a phone.
          </p>
        </section>

        {/* ── The showcase ─────────────────────────────────────────────── */}
        <section className="mx-auto max-w-6xl px-4 py-20 sm:py-28">
          <Reveal>
            <h2 className="max-w-2xl font-display text-3xl text-bark sm:text-4xl">
              The whole shop, in one place
            </h2>
            <p className="mt-3 max-w-2xl leading-relaxed text-slate-soft">
              Every screen below is the real thing, running right here. Not a screenshot —
              screenshots go stale the week after you take them.
            </p>
          </Reveal>

          <div className="mt-10 flex flex-wrap gap-2">
            {DEMOS.map((item, i) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setDemoIndex(i);
                  setPaused(true);
                }}
                className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                  i === demoIndex
                    ? "bg-moss text-white"
                    : "border border-line bg-white text-slate-soft hover:text-bark"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div
            className="mt-8 grid items-center gap-10 lg:grid-cols-[1fr_1.1fr]"
            onMouseEnter={() => setPaused(true)}
            onMouseLeave={() => setPaused(false)}
          >
            <div key={demo.id} className="motion-safe:animate-rise">
              <h3 className="font-display text-2xl text-bark">{demo.heading}</h3>
              <p className="mt-3 leading-relaxed text-slate-soft">{demo.body}</p>
              <div className="mt-6 flex gap-2" aria-hidden="true">
                {DEMOS.map((item, i) => (
                  <span
                    key={item.id}
                    className={`h-1 rounded-full transition-all duration-500 ${
                      i === demoIndex ? "w-8 bg-moss" : "w-2 bg-line"
                    }`}
                  />
                ))}
              </div>
            </div>

            <div key={`${demo.id}-frame`} className="motion-safe:animate-rise">
              <BrowserFrame url={demo.url} tone={demo.id === "register" ? "pos" : "app"}>
                <Screen />
              </BrowserFrame>
            </div>
          </div>
        </section>

        {/* ── Savings ──────────────────────────────────────────────────── */}
        <section id="savings" className="scroll-mt-8 border-y border-line bg-white py-20 sm:py-28">
          <div className="mx-auto max-w-6xl px-4">
            <Reveal>
              <h2 className="max-w-2xl font-display text-3xl text-bark sm:text-4xl">
                What you'd actually save
              </h2>
              <p className="mt-3 max-w-2xl leading-relaxed text-slate-soft">
                Move the sliders. The numbers are computed live from published pricing — ours
                and theirs — and the calculator will tell you if we'd cost you more.
              </p>
            </Reveal>

            <Reveal delay={100}>
              <div className="mt-10">
                <SavingsCalculator />
              </div>
            </Reveal>

            <div className="mt-10 grid gap-6 sm:grid-cols-2">
              <Reveal delay={140}>
                <div className="h-full rounded-2xl border border-moss/30 bg-moss/5 p-6">
                  <p className="text-xs uppercase tracking-wider text-moss">
                    If you're leasing a terminal
                  </p>
                  <p className="mt-2 font-display text-4xl text-moss">
                    <CountUp to={Math.round(leasedAnnualSavings / 100)} format={(n) => `$${n.toLocaleString("en-US")}`} />
                  </p>
                  <p className="mt-1 text-sm text-bark">
                    a year, about {leasedPct.toFixed(0)}% lower — for a small shop
                  </p>
                  <p className="mt-3 text-sm leading-relaxed text-slate-soft">
                    This is the case where switching is genuinely obvious. You're walking away
                    from a {formatDollars(leaseBuyout)} obligation and replacing it with a{" "}
                    {formatCents(readerPrice)} reader.
                  </p>
                </div>
              </Reveal>

              <Reveal delay={200}>
                <div className="h-full rounded-2xl border border-line bg-linen/60 p-6">
                  <p className="text-xs uppercase tracking-wider text-slate-soft">
                    If you're on fair software-only pricing
                  </p>
                  <p className="mt-2 font-display text-4xl text-bark">
                    <CountUp to={Math.round(softwareAnnualSavings / 100)} format={(n) => `$${n.toLocaleString("en-US")}`} />
                  </p>
                  <p className="mt-1 text-sm text-bark">
                    a year, about {softwarePct.toFixed(0)}% lower — for a small shop
                  </p>
                  <p className="mt-3 text-sm leading-relaxed text-slate-soft">
                    Real, but modest — and at higher volume our percentage fee can tip the
                    other way. We'd rather you read that here than find it in a spreadsheet.
                  </p>
                </div>
              </Reveal>
            </div>

            <Reveal delay={240}>
              <p className="mt-8 text-center">
                <Link
                  to="/compare"
                  prefetch="intent"
                  className="font-medium text-moss underline underline-offset-4 hover:text-moss-deep"
                >
                  See the full comparison, including where competitors beat us →
                </Link>
              </p>
            </Reveal>
          </div>
        </section>

        {/* ── The time argument ────────────────────────────────────────── */}
        <section className="mx-auto max-w-6xl px-4 py-20 sm:py-28">
          <div className="grid items-center gap-12 lg:grid-cols-2">
            <Reveal from="left">
              <h2 className="font-display text-3xl text-bark sm:text-4xl">
                The bigger saving isn't money. It's Tuesday afternoon.
              </h2>
              <p className="mt-4 leading-relaxed text-slate-soft">
                In a volunteer-run shop the scarce resource was never cash — it's the four
                people who showed up. Shops adopting AI-assisted intake have reported sorting
                time dropping from around{" "}
                <strong className="text-bark">{LABOUR_CLAIM.fromSeconds} seconds an item</strong>{" "}
                to about <strong className="text-bark">{LABOUR_CLAIM.toSeconds}</strong>, and
                revenue per square foot up roughly{" "}
                <strong className="text-bark">{LABOUR_CLAIM.revenuePerSqFtLiftPct}%</strong>.
              </p>
              <p className="mt-4 text-sm leading-relaxed text-slate-soft">
                At a thousand items a month that's about{" "}
                <strong className="text-bark">{hoursSaved} volunteer hours</strong> handed back
                — roughly two full shifts.
              </p>
              <p className="mt-4 rounded-xl border border-line bg-white p-4 text-sm leading-relaxed text-slate-soft">
                <strong className="text-bark">In fairness:</strong> that's{" "}
                {LABOUR_CLAIM.attribution}, not a measurement of ThriftOS. {LABOUR_CLAIM.caveat}
              </p>
            </Reveal>

            <Reveal from="right" delay={120}>
              <BrowserFrame url="thriftos.app/app/intake">
                <IntakeDemo />
              </BrowserFrame>
            </Reveal>
          </div>
        </section>

        {/* ── NRI ──────────────────────────────────────────────────────── */}
        <section className="border-y border-line bg-white py-20 sm:py-28">
          <div className="mx-auto max-w-6xl px-4">
            <div className="grid items-center gap-12 lg:grid-cols-2">
              <Reveal from="left">
                <BrowserFrame url="thriftos.app/app">
                  <CompassDemo />
                </BrowserFrame>
              </Reveal>

              <Reveal from="right" delay={120}>
                <p className="text-xs font-medium uppercase tracking-wider text-moss">
                  Narrative Relational Intelligence
                </p>
                <h2 className="mt-3 font-display text-3xl text-bark sm:text-4xl">
                  The part that notices things
                </h2>
                <p className="mt-4 leading-relaxed text-slate-soft">
                  A donor quiet against their own rhythm. A volunteer who's drifted off the
                  schedule. Stock that's run the whole rotation. A milestone worth saying out
                  loud. NRI gathers it into one calm place and shows the exact records behind
                  every signal.
                </p>
                <ul className="mt-6 space-y-2.5 text-sm text-slate-soft">
                  {[
                    "Deterministic rules, not model guesses — identical input, identical output",
                    "Never acts, never sends, never contacts anyone on its own",
                    "No donor tiers, no volunteer leaderboards, nobody scored",
                    "When there's nothing worth saying, it says nothing",
                  ].map((line) => (
                    <li key={line} className="flex gap-2.5">
                      <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-moss" />
                      {line}
                    </li>
                  ))}
                </ul>
                <Link
                  to="/nri"
                  prefetch="intent"
                  className="mt-6 inline-block font-medium text-moss underline underline-offset-4"
                >
                  How NRI works, including the actual thresholds →
                </Link>
              </Reveal>
            </div>
          </div>
        </section>

        {/* ── Honesty ──────────────────────────────────────────────────── */}
        <section className="mx-auto max-w-3xl px-4 py-20 sm:py-28">
          <Reveal>
            <h2 className="font-display text-3xl text-bark sm:text-4xl">
              Where we're not the right answer
            </h2>
            <p className="mt-4 leading-relaxed text-slate-soft">
              Every vendor's site tells you they win. Here's where we don't.
            </p>
            <ul className="mt-8 space-y-5">
              {[
                {
                  t: "You're doing serious card volume.",
                  d: "Our platform fee is a percentage, so past roughly $25k–$105k a month depending on who you're comparing to, a flat-priced competitor is cheaper. The calculator above will tell you exactly where that line falls for you.",
                },
                {
                  t: "You need deep e-commerce.",
                  d: "ThriftCart and ThriftTrac have years of online selling behind them. Ours is a browse-and-visit storefront. If online is most of your revenue, buy theirs.",
                },
                {
                  t: "You want someone to install it.",
                  d: "We have no hardware partnerships and no installer network. You'll set this up yourself, and it's built to be set up in an afternoon — but that's still you doing it.",
                },
                {
                  t: "What you have works and your staff know it.",
                  d: "Switching costs are real. A feature list is rarely worth retraining a volunteer crew who finally stopped asking how to do a refund.",
                },
              ].map((item) => (
                <li key={item.t} className="rounded-xl border border-line bg-white p-5">
                  <p className="font-display text-lg text-bark">{item.t}</p>
                  <p className="mt-1.5 text-sm leading-relaxed text-slate-soft">{item.d}</p>
                </li>
              ))}
            </ul>
          </Reveal>
        </section>

        {/* ── CTA ──────────────────────────────────────────────────────── */}
        <section className="relative overflow-hidden border-t border-line bg-white">
          <div className="aurora opacity-60" aria-hidden="true" />
          <div className="relative mx-auto max-w-3xl px-4 py-20 text-center sm:py-28">
            <Reveal>
              <h2 className="font-display text-3xl text-bark sm:text-4xl">
                Look around before you decide anything
              </h2>
              <p className="mx-auto mt-4 max-w-xl leading-relaxed text-slate-soft">
                The demo is a real shop with real data, a working Compass, and a register you
                can ring a sale on. No signup, no card, nothing to undo.
              </p>
              <div className="mt-8 flex flex-wrap justify-center gap-3">
                <LinkButton to="/demo">Open the demo shop</LinkButton>
                <LinkButton to="/pricing" variant="secondary">
                  See the pricing
                </LinkButton>
              </div>
              <p className="mt-6 text-sm text-slate-soft">
                Starts at {formatCents(volunteerPrice)}/month. Volunteer logins are always free.
              </p>
            </Reveal>
          </div>
        </section>
      </main>

      <MarketingFooter />
    </>
  );
}
