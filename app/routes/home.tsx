import { Link } from "react-router";
import type { Route } from "./+types/home";
import {
  jsonLd,
  marketingMeta,
  organizationSchema,
  softwareApplicationSchema,
  websiteSchema,
} from "../lib/seo";
import { MarketingFooter, MarketingHeader, Section } from "../components/marketing";
import { LinkButton } from "../components/ui";
import { getPlan, stallBreakEvenSales, usageCapCents, formatCents } from "../lib/pricing";

export function meta() {
  return marketingMeta({
    title: "ThriftOS — the operating system for thrift stores",
    description:
      "Run the register, the racks, and the relationships in one place. Photo-based intake, colour-tag markdowns, donation receipts, volunteer hours, and impact reporting built in.",
    path: "/",
  });
}

export function loader() {
  return {
    entryPerSale: getPlan("stall").perSaleCents,
    capCents: usageCapCents(),
    breakEven: stallBreakEvenSales(),
  };
}

const PRINCIPLES = [
  {
    name: "Subsidiarity",
    line: "Your shop decides.",
    body: "Pricing, hours, markdown schedule, what gets shared and what doesn't — all local, all yours. Joining a federation shares nothing until you turn on a specific thing, and you can turn it off again without leaving.",
  },
  {
    name: "Solidarity",
    line: "People aren't a module.",
    body: "Donors, volunteers, workers, and shoppers live in one list, and the same person can be all four without becoming four records. Relationships are the core of the data model, not a CRM bolted on the side.",
  },
  {
    name: "Common good",
    line: "Impact sits beside revenue.",
    body: "Pounds kept out of a landfill, value delivered to shoppers, volunteer hours given — computed from the records that run your register, so the report is a query rather than a scramble.",
  },
];

export default function Home({ loaderData }: Route.ComponentProps) {
  const { entryPerSale, capCents, breakEven } = loaderData;

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={jsonLd([
          organizationSchema(),
          websiteSchema(),
          softwareApplicationSchema(0),
        ])}
      />

      <MarketingHeader />

      <main>
        <Section>
          <div className="max-w-2xl">
            <p className="text-sm font-medium uppercase tracking-wider text-moss">
              For thrift stores of every size
            </p>
            <h1 className="mt-4 font-display text-4xl leading-tight text-bark sm:text-5xl">
              The shop runs on more than sales.
              <br />
              So should the software.
            </h1>
            <p className="mt-6 text-lg leading-relaxed text-slate-soft">
              ThriftOS handles the register, the racks, and the relationships — and reports
              what you kept out of a landfill beside what you took at the till. Built for
              shops where every item is one of a kind and half the staff are volunteers.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <LinkButton to="/demo">Look around the demo shop</LinkButton>
              <LinkButton to="/signup" variant="secondary">
                Set up your shop
              </LinkButton>
            </div>
            <p className="mt-4 text-sm text-slate-soft">
              No card to look around. Starts at {entryPerSale}¢ a sale and never costs more
              than {formatCents(capCents)} in a month, however busy you get.
            </p>
          </div>
        </Section>

        <Section tinted>
          <h2 className="font-display text-3xl text-bark">What it does on a Tuesday</h2>
          <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {[
              {
                title: "Photograph the donation",
                body: "Snap the item and the form fills itself in — category, colour, condition, a price band, a description. You correct what's wrong, which is far quicker than typing from nothing. Every guess is labelled a guess.",
              },
              {
                title: "Tag it and forget it",
                body: "Items take today's colour automatically and step down in price on your schedule. The register always knows today's price, so nobody has to remember the rotation.",
              },
              {
                title: "Sell when the internet doesn't",
                body: "The register keeps working offline and syncs itself when the connection returns. Sales carry a client ID, so a replayed queue can't double-charge anyone.",
              },
              {
                title: "Thank the donor properly",
                body: "One click issues a compliant acknowledgement with the required language — describing what you received, never assigning it a value, because that's the donor's call.",
              },
              {
                title: "Keep the schedule",
                body: "Volunteer shifts, hours logged as they happen, and a running total ready for whatever grant asks for it next.",
              },
              {
                title: "Answer the board",
                body: "Diversion weight, value delivered, volunteer hours — derived from the records you already keep, exportable as CSV, honest about what each number is.",
              },
            ].map((feature) => (
              <div key={feature.title} className="rounded-2xl border border-line p-6">
                <h3 className="font-display text-lg text-bark">{feature.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-soft">{feature.body}</p>
              </div>
            ))}
          </div>
        </Section>

        <Section>
          <div className="max-w-2xl">
            <h2 className="font-display text-3xl text-bark">
              NRI: the part that notices things
            </h2>
            <p className="mt-4 text-lg leading-relaxed text-slate-soft">
              Narrative Relational Intelligence is the layer that watches for what a busy week
              hides — a donor whose own rhythm has changed, a volunteer who's drifted off the
              schedule, stock that's run out its rotation, a diversion milestone worth saying
              out loud.
            </p>
            <p className="mt-4 leading-relaxed text-slate-soft">
              It gathers what it finds in one calm place. Every signal shows the exact records
              it came from. Nothing acts on its own — no price changes, no emails, no contact
              with anyone. It suggests; you decide.
            </p>
            <p className="mt-4 leading-relaxed text-slate-soft">
              And when there's nothing worth saying, it says nothing.
            </p>
            <Link
              to="/nri"
              prefetch="intent"
              className="mt-6 inline-block font-medium text-moss underline underline-offset-4"
            >
              How NRI works, in detail
            </Link>
          </div>
        </Section>

        <Section tinted>
          <h2 className="font-display text-3xl text-bark">Three commitments</h2>
          <p className="mt-3 max-w-2xl leading-relaxed text-slate-soft">
            These aren't marketing words — they're decisions already made in the database
            schema, and you can hold us to them.
          </p>
          <div className="mt-10 grid gap-6 sm:grid-cols-3">
            {PRINCIPLES.map((principle) => (
              <div key={principle.name} className="rounded-2xl border border-line p-6">
                <h3 className="font-display text-lg text-bark">{principle.name}</h3>
                <p className="mt-1 text-sm font-medium text-moss">{principle.line}</p>
                <p className="mt-3 text-sm leading-relaxed text-slate-soft">{principle.body}</p>
              </div>
            ))}
          </div>
        </Section>

        <Section>
          <div className="max-w-2xl">
            <h2 className="font-display text-3xl text-bark">What it costs</h2>
            <p className="mt-4 leading-relaxed text-slate-soft">
              The entry plan is {entryPerSale}¢ a sale with no monthly fee, and it stops at{" "}
              {formatCents(capCents)} — which is simply what the next plan up costs. Past
              roughly {breakEven} sales in a month you're paying the flat price and nothing
              more, so a good month is never a penalty.
            </p>
            <p className="mt-4 leading-relaxed text-slate-soft">
              Card payments run through Stripe with your shop as the merchant of record, so
              receipts carry your name and payouts land in your account. Our platform fee is
              1%, printed on the label every time.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <LinkButton to="/pricing">See the full pricing</LinkButton>
              <LinkButton to="/guides/thrift-store-software-comparison" variant="secondary">
                Compared with the alternatives
              </LinkButton>
            </div>
          </div>
        </Section>
      </main>

      <MarketingFooter />
    </>
  );
}
