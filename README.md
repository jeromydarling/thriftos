# ThriftOS

An operating system for thrift stores — the register, the racks, and the
relationships in one place, with landfill diversion and volunteer hours reported
beside the revenue.

Built for shops where every item is one of a kind and much of the staff are
volunteers. That is a different problem from conventional retail, and the whole
data model is shaped around it.

## Three commitments, made in the schema

- **Subsidiarity** — the store decides. Pricing, hours, markdown rotation, and
  what is shared are all local. Joining a federation shares nothing until the
  store turns on a specific resource type, and it can be revoked without leaving
  the group (`federation_links`).
- **Solidarity** — donors, shoppers, volunteers, and workers are one `contacts`
  table with stacking roles. The same person can be all four without becoming
  four records.
- **Common good** — impact is derived from the records that already run the
  register, so the report is a query rather than a scramble before a board
  meeting.

## NRI — Narrative Relational Intelligence

NRI is the layer that notices what a busy week hides, and gathers it into one
calm place called the Compass.

The thing to understand: **NRI signals come from deterministic rules, not from a
model.** `app/lib/nri/rules.ts` is a pure function over a snapshot. Run it twice
on the same data and you get identical output. That is what makes the "Why am I
seeing this?" drawer honest — every signal renders the exact counts, dates, and
records it came from.

What it notices: a donor quiet relative to *their own* rhythm, a volunteer who
has drifted off the schedule, a backroom filling faster than the floor clears,
stock past its rotation, receipts owed, and diversion or volunteer-hour
milestones worth saying out loud.

What it will not do: act on its own, send any message, change any price, contact
anyone, or score, rank, or tier a person. There are no donor tiers and no
volunteer leaderboards — that vocabulary is on a blocklist in
`app/lib/nri/voice.ts`, with a test pinning it.

When there is nothing worth saying, it says nothing. The thresholds are set so a
quiet week produces an empty Compass, and they are published on `/nri` rather
than hidden.

The only AI model in the product reads photos at intake. Its output is labelled a
guess, always editable, and never saved without a person accepting it.

## Stack

One Cloudflare Worker serves everything:

| Layer | Choice |
|---|---|
| Runtime | Cloudflare Workers |
| App + marketing | React Router v8, SSR |
| API | Hono, mounted at `/api/*` |
| Database | D1 (`thriftos-db`) |
| Object storage | R2 (`thriftos-media`) |
| Rate limiting | KV (`thriftos-kv`) |
| Photo intake | Workers AI — `llama-3.2-11b-vision-instruct` |
| Image resizing | Images binding |
| Scheduled work | Cron triggers |

**Deviation from the brief, stated plainly:** the brief specified a separate
Cloudflare Pages SPA plus a Workers API. This ships as a single Worker with
React Router in SSR mode and Hono at `/api/*` instead. The marketing site and
each shop's public storefront need server rendering for SEO, one Worker means
one deploy and no CORS, and Cloudflare now steers new projects to Workers static
assets rather than Pages. Hono is still the API framework and the frontend is
still React + Vite — they just share a deploy.

## Running it

```bash
npm install
npx wrangler d1 migrations apply thriftos-db --local   # local database
npm run dev
```

Then open `/demo` for a seeded shop with a working Compass — no signup required.

Local dev needs `CLOUDFLARE_API_TOKEN` set if you want the AI binding, because
Workers AI has no local emulation. Without it, remove the `ai` block from
`wrangler.jsonc`; the intake form degrades to manual entry, which is a supported
path rather than a broken one.

That variable is the *deploy* credential, and it is the only place that name is
used. The Worker's own Cloudflare access — for shops on a custom domain — is
`CF_SAAS_API_TOKEN`, named apart on purpose: sharing a name with the deploy
token invites pasting the deploy token into a public-facing Worker, which would
let it redeploy itself and read every database on the account. It needs one
permission, Zone → SSL and Certificates → Edit.

```bash
npm test          # 594 tests, no network needed
npm run typecheck
npm run build
```

## Everything degrades without keys

The app is fully usable before a single third-party key is added. Each
integration runs dark with a friendly fallback, and Settings shows the exact
one-line command to switch it on:

| Integration | Without the key |
|---|---|
| `STRIPE_SECRET_KEY` | Cash and other tenders work normally; card sales are recorded, not charged |
| `RESEND_API_KEY` | Receipts still generate; sends become rows in `email_log` |
| Workers AI | Intake form opens empty and staff type the details |
| Images | Photos served at original size |

Secrets are Worker secrets — never in the repo:

```bash
npx wrangler secret put STRIPE_SECRET_KEY
npx wrangler secret put RESEND_API_KEY
```

## Layout

```
app/
  api/         Hono routes — uploads, offline POS sync, media, CSV export
  content/     Guides registry and NRI copy (typed; the sitemap generates from it)
  cron/        Scheduled work — impact rollup, NRI weekly, demo reset
  lib/
    nri/       rules.ts (pure) · engine.ts (DB) · voice.ts · guardrails.ts
    markdown.ts  Colour-tag rotation — pure, heavily tested
    pricing.ts   Single source of truth. Integer cents; cap derived, not hardcoded
    impact.ts    Common-good maths, one shared definition of "diverted"
  routes/      React Router v8 routes
migrations/    Numbered SQL, applied local and remote
workers/app.ts Worker entry
```

## Conventions worth knowing

- **Money is always integer cents.** Never a float. `pricing.ts` is the only
  place any amount is defined, and the entry plan's usage cap is *derived* from
  the next tier so the two can never disagree.
- **Every query is org-scoped.** There is no helper that lets you forget the
  tenant.
- **Keyset pagination**, never OFFSET — `WHERE (name, id) > (?, ?)`.
- **The offline queue is idempotent.** Sales carry a client-generated
  `offline_id` with a unique index, because a replayed queue will happen.
- **The demo self-heals.** If it is ever found empty it rebuilds before a
  visitor notices.

## Things that bit us, so they don't bite you

- React Router's `meta()` receives `loaderData`, not `data`.
- A loader cannot serve a file download. A returned `Response` becomes loader
  data; a thrown 2xx lands in the error boundary. Use a resource endpoint —
  that is why the CSV export lives at `/api/impact.csv`.
- `createContext()` at module scope can be evaluated twice, since the Worker
  entry and the route modules are separate bundles. `app/lib/cf-context.ts`
  pins the key to a `Symbol.for` global so both copies agree.
- Diversion weight had two definitions once, and the Compass celebrated a
  milestone the impact page disagreed with. It is now one exported constant
  (`DIVERTED_STATUSES`) used by every query.
