import type { Route } from "./+types/nri";
import {
  breadcrumbSchema,
  faqSchema,
  jsonLd,
  marketingMeta,
} from "../lib/seo";
import { MarketingFooter, MarketingHeader, Section } from "../components/marketing";
import { LinkButton } from "../components/ui";
import {
  AI_LIMITS,
  CORE_LOOP,
  HOW_IT_DIFFERS,
  NRI_FAQ,
  NRI_HERO,
  PRINCIPLES,
} from "../content/nri";
import { TRUST_BOUNDARIES } from "../lib/nri/voice";
import { THRESHOLDS } from "../lib/nri/rules";

export function meta() {
  return marketingMeta({
    title: "NRI — Narrative Relational Intelligence",
    description:
      "NRI recognizes what changes in your shop, gathers it into one place, and shows its work. Deterministic rules, not model guesses — and it never acts on its own.",
    path: "/nri",
  });
}

export default function NRI() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={jsonLd([
          faqSchema(NRI_FAQ),
          breadcrumbSchema([{ label: "Home", path: "/" }, { label: "NRI" }]),
        ])}
      />

      <MarketingHeader />

      <main>
        <Section>
          <div className="max-w-2xl">
            <p className="text-sm font-medium uppercase tracking-wider text-moss">
              {NRI_HERO.eyebrow}
            </p>
            <h1 className="mt-4 font-display text-4xl leading-tight text-bark sm:text-5xl">
              {NRI_HERO.title}
            </h1>
            <p className="mt-6 text-lg leading-relaxed text-slate-soft">{NRI_HERO.subtitle}</p>
            <p className="mt-6 font-display text-lg italic text-moss">{NRI_HERO.footnote}</p>
          </div>
        </Section>

        <Section tinted>
          <h2 className="font-display text-3xl text-bark">{CORE_LOOP.heading}</h2>
          <p className="mt-3 max-w-2xl leading-relaxed text-slate-soft">{CORE_LOOP.intro}</p>

          <div className="mt-10 grid gap-6 sm:grid-cols-3">
            {CORE_LOOP.steps.map((step) => (
              <div key={step.label} className="rounded-2xl border border-line p-6">
                <h3 className="font-display text-lg text-bark">{step.label}</h3>
                <p className="mt-3 text-sm leading-relaxed text-slate-soft">{step.description}</p>
                <ul className="mt-4 space-y-2">
                  {step.examples.map((example) => (
                    <li key={example} className="text-xs leading-relaxed text-slate-soft">
                      · {example}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <p className="mt-8 max-w-2xl italic leading-relaxed text-slate-soft">
            {CORE_LOOP.closing}
          </p>
        </Section>

        <Section>
          <div className="max-w-2xl">
            <h2 className="font-display text-3xl text-bark">{AI_LIMITS.heading}</h2>
            <div className="mt-6 space-y-4 leading-relaxed text-slate-soft">
              {AI_LIMITS.body.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
            </div>
            <p className="mt-6 font-display text-xl text-bark">{AI_LIMITS.closing}</p>
          </div>
        </Section>

        <Section tinted>
          <h2 className="font-display text-3xl text-bark">How this differs from "AI features"</h2>
          <div className="mt-8 grid gap-6 sm:grid-cols-2">
            {HOW_IT_DIFFERS.map((item) => (
              <div key={item.claim}>
                <h3 className="font-display text-lg text-bark">{item.claim}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-soft">{item.detail}</p>
              </div>
            ))}
          </div>
        </Section>

        <Section>
          <div className="max-w-2xl">
            <h2 className="font-display text-3xl text-bark">The actual thresholds</h2>
            <p className="mt-4 leading-relaxed text-slate-soft">
              Publishing these is the point. If a signal's trigger is a secret, "why am I
              seeing this?" can't be answered honestly. A few of the ones in use:
            </p>
            <ul className="mt-6 space-y-3 text-sm leading-relaxed text-slate-soft">
              <li>
                <strong className="text-bark">A quiet donor</strong> — someone with at least{" "}
                {THRESHOLDS.quietDonorMinDonations} recorded donations who is now{" "}
                {THRESHOLDS.quietDonorGapMultiplier}× past their own typical gap, and at least{" "}
                {THRESHOLDS.quietDonorMinDays} days out regardless. Their rhythm, never a
                schedule we invented.
              </li>
              <li>
                <strong className="text-bark">A volunteer who's drifted</strong> — at least{" "}
                {THRESHOLDS.quietVolunteerMinShifts} shifts in the last 90 days, nothing
                upcoming, and {THRESHOLDS.quietVolunteerDays}+ days since the last one.
              </li>
              <li>
                <strong className="text-bark">A filling backroom</strong> — intake at least{" "}
                {THRESHOLDS.backlogRatio}× sales over a week, with at least{" "}
                {THRESHOLDS.backlogMinIntake} items in, so a slow week doesn't trip it.
              </li>
              <li>
                <strong className="text-bark">Receipts owed</strong> — at least{" "}
                {THRESHOLDS.missingReceiptsMin} outstanding, oldest at least{" "}
                {THRESHOLDS.missingReceiptsAgeDays} days.
              </li>
            </ul>
            <p className="mt-6 leading-relaxed text-slate-soft">
              Below these, NRI says nothing at all. That's deliberate: a system that always
              finds something to tell you has stopped being worth reading.
            </p>
          </div>
        </Section>

        <Section tinted>
          <h2 className="font-display text-3xl text-bark">Grounded in three principles</h2>
          <div className="mt-8 grid gap-6 sm:grid-cols-3">
            {PRINCIPLES.map((principle) => (
              <div key={principle.name} className="rounded-2xl border border-line bg-linen/40 p-6">
                <h3 className="font-display text-lg text-bark">{principle.name}</h3>
                <p className="mt-1 text-sm font-medium text-moss">{principle.definition}</p>
                <p className="mt-3 text-xs leading-relaxed text-slate-soft">{principle.example}</p>
              </div>
            ))}
          </div>
        </Section>

        <Section>
          <div className="max-w-2xl">
            <h2 className="font-display text-3xl text-bark">What NRI will never do</h2>
            <ul className="mt-8 space-y-5">
              {TRUST_BOUNDARIES.map((boundary) => (
                <li key={boundary.statement}>
                  <p className="font-display text-lg text-bark">{boundary.statement}</p>
                  <p className="mt-1 leading-relaxed text-slate-soft">{boundary.detail}</p>
                </li>
              ))}
            </ul>
          </div>
        </Section>

        <Section tinted>
          <div className="max-w-2xl">
            <h2 className="font-display text-3xl text-bark">Questions</h2>
            <dl className="mt-8 space-y-6">
              {NRI_FAQ.map((item) => (
                <div key={item.question}>
                  <dt className="font-display text-lg text-bark">{item.question}</dt>
                  <dd className="mt-1.5 leading-relaxed text-slate-soft">{item.answer}</dd>
                </div>
              ))}
            </dl>

            <div className="mt-10 flex flex-wrap gap-3">
              <LinkButton to="/demo">See the Compass in the demo shop</LinkButton>
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
