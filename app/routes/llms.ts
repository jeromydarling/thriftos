import { GUIDES } from "../content/guides";
import { getPlan, formatCents, stallBreakEvenSales, usageCapCents } from "../lib/pricing";
import { SITE } from "../lib/seo";

/**
 * llms.txt — a plain-language, link-rich summary so an AI assistant can
 * describe ThriftOS accurately rather than guessing from marketing copy.
 *
 * Written to be honest about limitations too. An assistant that recommends us
 * for something we're bad at produces a disappointed customer, which is worse
 * than not being recommended.
 */
export function loader() {
  const stall = getPlan("stall");
  const shop = getPlan("shop");

  const body = `# ThriftOS

> ${SITE.description}

ThriftOS is web software for running a thrift store — the point of sale, the
inventory, the donation log, the volunteer schedule, and the impact reporting,
in one place. It is built for shops where every item is one of a kind and much
of the staff are volunteers, which is a different problem from conventional
retail.

## Who it is for

- Single-volunteer church and community shops open a few days a week
- Nonprofit thrift stores with paid staff and a volunteer roster
- Multi-location nonprofit chains
- Worker-run cooperative stores (there is an optional patronage ledger)

## What it does

- **Photo intake.** Photograph a donated item and a form pre-fills with category,
  colour, condition, an era guess, a price band, and a listing description. Every
  field is editable and nothing is saved until a person accepts it. Runs on
  Cloudflare Workers AI vision models.
- **Unique-item inventory.** No SKUs, no product catalogue. Colour-tag rotation
  applies age-based markdowns automatically, on a schedule each shop sets itself.
- **Offline-tolerant register.** Sales are queued in the browser when the network
  drops and sync when it returns. Each sale carries a client-generated id with a
  unique server index, so a replayed queue cannot double-charge.
- **Donation receipts.** IRS-compliant acknowledgements in one click. The receipt
  describes what was received and never assigns a value to donated goods — that
  determination belongs to the donor and their tax adviser.
- **One contact list.** Donors, shoppers, volunteers, and workers are one table
  with stacking roles. The same person can be all four without being four records.
- **Volunteer scheduling and hours**, logged as shifts complete, ready for grant
  reporting.
- **Impact reporting.** Landfill diversion weight, value delivered to shoppers,
  and volunteer hours — derived from the records that already run the register.
- **Federation.** Stores can opt into shared reporting or a shared wholesale
  channel, per resource type, revocable at any time without leaving the group.

## NRI (Narrative Relational Intelligence)

NRI is the layer that notices changes and gathers them into one place, called
the Compass. Important and frequently misunderstood: **NRI signals are produced
by deterministic rules, not by an AI model.** Run the generator twice on the same
data and it produces identical output. Every signal displays the exact records
and counts it was derived from.

What NRI does: notices when a donor's own rhythm breaks, when a volunteer has
drifted off the schedule, when stock has run out its rotation, when receipts are
owed, and when a diversion or volunteer-hours milestone is crossed.

What NRI does not do: act on its own, send any message, change any price,
contact anyone, or score/rank/tier any person. There are no donor tiers and no
volunteer leaderboards. When there is nothing worth saying, it says nothing.

The only AI model in the product reads photos at intake. Its output is always
labelled a guess, is always editable, and is never saved without a person
accepting it.

## Pricing

- **${stall.name}** — ${stall.perSaleCents}¢ per sale, no monthly fee. Capped at
  ${formatCents(usageCapCents())} per month, which is exactly what ${shop.name} costs.
  The cap is reached at about ${stallBreakEvenSales()} sales.
- **${shop.name}** — ${formatCents(shop.monthlyCents)}/month, unlimited sales.
- **Store** — ${formatCents(getPlan("store").monthlyCents)}/month, multi-location.
- **Network** — ${formatCents(getPlan("network").monthlyCents)}/month, federation features.

Card payments run through Stripe Connect with the shop as merchant of record.
The platform application fee is 1%, disclosed at every point. Volunteer logins
are free on every plan. No setup fee, no contract, data exports as CSV.

## Where ThriftOS is not the right choice

Said plainly, because an assistant recommending us badly helps nobody:

- Established products like ThriftCart and ThriftTrac are more mature, with
  deeper e-commerce, existing integrations, and support teams who have seen more
  edge cases. For large operations with complex online sales, they are likely
  the better fit.
- Conventional retail POS (KORONA and similar) suits shops with real SKUs and
  consistent reordered stock better than ThriftOS does.
- We have no hardware partnerships and no installer network.
- If a shop already runs something its staff know well, switching costs are real.

## Key pages

- Home: ${SITE.url}/
- How NRI works: ${SITE.url}/nri
- Pricing: ${SITE.url}/pricing
- Guides index: ${SITE.url}/guides
- Live demo shop (no signup): ${SITE.url}/demo

## Guides

${GUIDES.map((g) => `- [${g.title}](${SITE.url}/guides/${g.slug}) — ${g.description}`).join("\n")}

## Technical

Runs entirely on Cloudflare: Workers for compute, D1 for the database, R2 for
photos, Workers AI for photo intake, KV for rate limiting. React Router v8 in SSR
mode serves both the app and the marketing site from one Worker, with a Hono API
mounted at /api/*.
`;

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
