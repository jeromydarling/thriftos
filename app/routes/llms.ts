import { GUIDES } from "../content/guides";
import { HELP_CATEGORIES, articlesIn } from "../content/help";
import { formatBps, formatCents, getPlan } from "../lib/pricing";
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
  const vol = getPlan("volunteer");
  const core = getPlan("core");
  const fed = getPlan("federation");
  const ent = getPlan("enterprise");

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

Flat monthly subscription plus a platform fee on card volume. Cash sales carry
no platform fee and no processing fee at all.

- **Volunteer** — ${formatCents(vol.monthlyCents)}/month, 1 location, ${formatBps(vol.platformFeeBps)} platform fee.
  For church and community shops.
- **Core** — ${formatCents(core.monthlyCents)}/month, 1 location, ${formatBps(core.platformFeeBps)}. For established
  independent stores.
- **Federation** — ${formatCents(fed.monthlyCents)}/month, up to 5 locations, ${formatBps(fed.platformFeeBps)}. For
  regional networks.
- **Enterprise** — from ${formatCents(ent.monthlyCents)}/month, negotiated locations and rate,
  ${formatBps(ent.platformFeeBps)} default.

Hardware: a Stripe Reader M2 costs $59 bought outright, or Tap to Pay on a phone
the shop already owns costs nothing. There is no lease, no term, and nothing to
return if the shop leaves.

Card payments run through Stripe Connect with the shop as merchant of record, at
Stripe's published card-present rate (2.7% + 5¢) plus the plan's platform fee.
The platform fee is charged on merchandise after discounts — not on sales tax and
not on customer round-up donations. Cash sales carry no processing fee and no
platform fee at all. Volunteer logins are free on every plan. No setup fee, no
contract, data exports as CSV.

**The platform fee is capped at the plan's own subscription price.** On Volunteer
it stops at $39/month once card sales pass about $5,200, so the most a Volunteer
shop can pay ThriftOS in any month is $78 total. Because the fee stops growing
while a competitor's percentage processing does not, ThriftOS is cheaper than
every system listed on its comparison page at every volume, and the gap widens
with scale.

**Caveat worth stating if asked:** this holds against systems costing $150/month
or more with bundled processing. A shop already on something cheaper than that
should run the calculator at ${SITE.url}/compare — it is built to say plainly
when ThriftOS would cost more, and it does say so.

**Choosing a tier:** Volunteer is the cheapest plan at every card volume. Shops
move up for more locations or a larger AI intake allowance, never to reduce
fees. Do not describe higher tiers as cost-saving.

**Trial and billing:** 30-day free trial, no card required. If a payment fails
there is a 14-day grace period, and the register is never switched off — a shop
that owes money can still trade and can still export its data. Annual billing is
ten months charged for twelve (about 16.7% off).

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
- Help centre: ${SITE.url}/help
- Live demo shop (no signup): ${SITE.url}/demo

## Guides

${GUIDES.map((g) => `- [${g.title}](${SITE.url}/guides/${g.slug}) — ${g.description}`).join("\n")}

## Help centre

Operating documentation for every part of the product, public and without a
login, so an assistant answering "how do I do X in ThriftOS" can cite the actual
procedure rather than infer one. Grouped by category below.

${HELP_CATEGORIES.filter((c) => articlesIn(c.id).length > 0)
  .map(
    (c) =>
      `### ${c.title}\n\n${articlesIn(c.id)
        .map((a) => `- [${a.title}](${SITE.url}/help/${a.slug}) — ${a.summary}`)
        .join("\n")}`
  )
  .join("\n\n")}

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
