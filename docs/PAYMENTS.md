# Payments: how the money actually moves

This is the operator's document for ThriftOS payments — the charge model, the
guarantees, what breaks and how, and the checklist for going live. It is written
to be read by whoever is on call at 9pm when a shop says a payment "went
through but didn't".

## The charge model

**Destination charges with Express connected accounts**, with `on_behalf_of`
set to the shop's account.

That means:

- The shop is the **merchant of record**. Their name is on the customer's
  statement, the charge settles in their country, under their descriptor.
- The platform sets `application_fee_amount` server-side. A browser never sees
  or sends a fee.
- **The platform carries Stripe's processing cost, refund exposure, and dispute
  liability.**

That last point is the price of the first, and it is not a rounding detail. A
dispute on a shop's sale is money out of *our* account, plus Stripe's dispute
fee. It belongs in platform unit economics, and `platformReport()` in
`app/lib/ledger.ts` deliberately refuses to call gross application-fee revenue
"net" for exactly this reason.

The alternative — direct charges — would move that liability to the shops.
It was rejected because thrift stores are small nonprofits that cannot model
chargeback risk, and because fee collection and reconciliation across hundreds
of tiny accounts is materially harder.

## The rules that must never be broken

These are enforced in code and pinned by tests. If you are changing payment
code, these are the invariants you are working around.

1. **The client never sends a price.** `priceCart()` in `app/api/pos.ts` prices
   every cart from the `items` table. The register sends item ids and a tender.
   Anything resembling an amount in a request body is ignored.
2. **Inventory follows the payment, never the request.** Items are *reserved*
   when a payment starts and only marked *sold* when a payment reaches an
   approved terminal state. See `inventoryEffectFor()` in `app/lib/payments.ts`.
3. **Stripe is authoritative.** A 200 response means Stripe accepted a request,
   not that money moved. Only a verified webhook — or a direct read of the
   PaymentIntent — completes a sale.
4. **Every attempt carries one idempotency key**, derived as
   `${transactionId}:${attemptNumber}`. Retrying an attempt reuses it; a genuinely
   new attempt gets a new one, because a second card is a second charge.
5. **Webhook events are claimed by insert**, not by check-then-act. Two
   concurrent deliveries race on the primary key and exactly one wins.
6. **The ledger is append-only and signed.** Costs are negative so a plain SUM
   is the net. A correction is a new opposing entry, never an edit.
7. **Card payments are never collected offline.** The offline queue accepts cash
   only; `isOfflineEligible()` returns false for `terminal` unconditionally.
8. **Refunds return our fee proportionally.** Stripe does not do this
   automatically. `refund_application_fee` is set on every card refund.
9. **The register never switches off.** Neither does cash checkout, card
   checkout, receipts, or data export — in any billing state, including
   canceled. See `app/lib/entitlements.ts`.

## What the money looks like end to end

```
Cashier scans items
  → POST /api/pos/terminal/pay
      · priceCart()          prices from the items table
      · quotePlatformFee()   resolves the fee policy, server-side
      · INSERT transaction   payment_state = 'draft'
      · reserveItems()       conditional UPDATE; items now 'held'
      · openAttempt()        idempotency key minted here
      · createCardPresentIntent()  destination charge + application fee
      · processOnReader()    reader wakes up
      → payment_state = 'awaiting_reader'   ← items are HELD, not SOLD

Customer taps
  → Stripe decides
  → webhook payment_intent.succeeded
      · advanceAttempt()     guarded on prior state
      · applyInventoryEffect()   items become 'sold'  ← the only place this happens
      · saleEntries() → ledger   gross_sale, tax, round_up, platform_fee
      · recordFeeAccrual()   monthly cap tracking

  → webhook charge.succeeded
      · stripe_processing_fee posted to the ledger   ← now the payout reconciles
```

If the webhook never arrives, `GET /api/pos/terminal/status/:id` polls Stripe
directly and applies the same transitions. A dropped webhook delays a receipt;
it does not lose a sale.

## Failure modes, and what actually happens

| What goes wrong | What happens | What a person must do |
|---|---|---|
| Card declined | Attempt → `failed`, items released back to `available` | Try another card, or take cash |
| Customer walks off mid-tap | Attempt sits in `awaiting_reader`; the daily `stale_payments` cron asks Stripe and releases the goods | Nothing |
| Reader offline | `/terminal/pay` returns 502 before any charge; items released | Check the reader's network |
| Network dies after Stripe charged | Retry reuses the idempotency key; Stripe returns the original charge | Nothing — retry is safe |
| Webhook never delivered | Register's status poll reads Stripe directly | Nothing |
| Webhook handler has a bug | Event stored with `status='failed'`; returns 200 | Fix, then `POST /api/stripe/events/:id/replay` |
| Two registers sell the same item | The conditional UPDATE in `reserveItems()` lets exactly one win | The losing sale is marked `unfulfilled` |
| Refund on a cash sale | Never touches Stripe; ledger + restock only | Take it out of the drawer |
| Dispute | Sale marked `disputed`, ledger debited, **goods not restocked** | Respond before the deadline |
| Internet down entirely | Cash sales queue in IndexedDB; cards refused with an explanation | Take cash |

**Note the dispute row.** A dispute does not restock. The customer has the coat;
this is an argument about payment, not a return. Restocking would let a shop
sell an item it does not physically have.

## Offline

The register works offline for **cash only**, and this is a deliberate limit,
not an unfinished feature.

Collecting a card payment offline means accepting a card without an
authorisation and hoping it clears later. In a browser we have no way to do that
safely — no secure element, no Terminal SDK, no way to enforce a floor limit.
Recording an unauthorised card payment as complete would be recording money we
may never receive.

So: `isOfflineEligible()` returns `false` for card-present tenders,
unconditionally, and the sync endpoint rejects any queued card sale with an
explanation rather than silently accepting it.

True offline card acceptance would require a native app with the Stripe Terminal
SDK. That is a separate milestone with its own risk limits, not a flag to flip.

The service worker (`public/sw.js`) caches the register *shell* only. It never
caches `/api/` responses — a stale price undercharges, and a stale payment
status would tell a cashier a declined card went through.

## Receipts

Every sale mints an unguessable token at creation and is readable at
`/r/<token>` with no login, because a shopper doesn't have an account. The
register offers print or email the moment a sale completes.

This is not a nicety. **A chargeback is answered with a receipt** — "compelling
evidence" is largely a document showing what was sold, when, and for how much,
and a merchant who can't produce one loses by default. The dispute alert links
straight to the sale page, where the receipt is one button.

Receipts are built from the `transaction_items` snapshot, so re-pricing or
renaming an item later cannot alter a receipt somebody already holds.

## Alerts

Everything that needs a person raises a row in `alerts`, surfaced as a banner
(critical) or on the dashboard (warning):

| Kind | Raised when | Severity |
|---|---|---|
| `dispute_deadline` | Evidence due within 7 days / within 2 days | warning → critical |
| `webhook_failed` | A handler threw — raised immediately, not nightly | critical |
| `payment_stranded` | Attempts in flight over 2 hours, holding inventory | warning |
| `connect_disabled` | Account restricted, disabled, or requirements due | critical |
| `payout_failed` | Stripe couldn't reach the bank | critical |

Deduped by `(kind, dedupe_key)`, so a nightly sweep can't pile up. Nothing
auto-clears except when the condition genuinely goes away — replaying a fixed
event resolves its alert. Acknowledging stops the interruption but keeps the
row.

## Logging

`app/lib/log.ts`. One JSON object per line with `requestId`, `orgId`,
`transactionId`, `attemptId`, `stripeObjectId`, `idempotencyKey`, and
`transition`, so searching one transaction id returns the whole story.

Fields are on an allowlist and every string value passes `redact()`, which
strips Stripe secrets, anything resembling a card number, and email addresses.
A log that leaks is worse than no log.

## Reports

**Store-facing** (`storeReport()`): gross sales, refunds, tax, round-ups,
platform fees, Stripe processing, disputes, expected payout, cash/card split,
drawer variance. Every figure is a SUM over ledger entries, so each one can be
drilled into and traced to an event.

**Platform-facing** (`platformReport()`): application-fee revenue, fee refunds,
Stripe costs, dispute losses, gross payment volume, and `netMarginCents` —
which is the only one that predicts anything.

## Configuration

Required secrets (set with `npx wrangler secret put NAME`):

| Secret | Needed for |
|---|---|
| `STRIPE_SECRET_KEY` | Any card payment |
| `STRIPE_PUBLISHABLE_KEY` | Client-side Stripe, if added |
| `STRIPE_WEBHOOK_SECRET` | Verifying platform webhooks |
| `STRIPE_CONNECT_WEBHOOK_SECRET` | Only if Connect events use a separate endpoint |

Everything degrades rather than crashes. With no `STRIPE_SECRET_KEY` the app
runs fully — cash sales, inventory, donations, reporting — and card payments
report themselves as "not switched on yet". That is checked by
`stripeReadiness()` and surfaced in Settings.

Use separate test and live keys. `isTestMode()` keys the UI off the `sk_test_`
prefix so nobody mistakes a test shop for a live one.

## Going live: the checklist

**Stripe dashboard**

- [ ] Connect enabled, Express accounts, platform profile completed
- [ ] Terminal enabled on the platform account
- [ ] Webhook endpoint pointed at `https://<host>/api/stripe/webhook`
- [ ] Webhook subscribed to: `payment_intent.*`, `charge.succeeded`,
      `charge.refunded`, `charge.dispute.*`, `refund.updated`,
      `terminal.reader.action_*`, `account.updated`, `capability.updated`,
      `account.application.deauthorized`, `payout.failed`
- [ ] Statement descriptor set on the platform account

**This app**

- [ ] All migrations applied to the remote D1 (`wrangler d1 migrations apply thriftos-db --remote`)
- [ ] All four secrets set
- [ ] `/api/health` returns ok
- [ ] Settings → Payments shows "ready" for a test shop

**Verified with a test shop before any real money**

- [ ] Connect onboarding completes; status reaches `enabled`
- [ ] A restricted account cannot take a payment
- [ ] Terminal location created, simulated reader paired
- [ ] Sale on a simulated reader: items go `held` → `sold` only after the webhook
- [ ] Declined card (`4000000000000002`): items return to `available`
- [ ] Cancel mid-payment: nothing charged, items released
- [ ] Duplicate webhook delivery changes nothing
- [ ] Refund returns the proportional application fee
- [ ] Partial refund leaves the sale `partially_refunded`
- [ ] Dispute marks the sale `disputed` and does **not** restock
- [ ] Cash sale carries no platform fee
- [ ] A receipt renders at `/r/<token>` with no session, and 404s on a bad token
- [ ] A suspended shop can still ring up a sale and export its data
- [ ] Offline: cash queues and syncs; card is refused with an explanation
- [ ] Replaying an offline queue twice creates one sale
- [ ] Drawer opens, records a pay-out, closes with a variance in the ledger
- [ ] Money report's expected payout matches Stripe's payout for the period

**Watch after launch**

- `stripe_events` where `status='failed'` — should be zero
- `payment_attempts` stuck in `awaiting_reader` beyond 30 minutes — the cron
  should be clearing these
- `system_runs` for `stale_payments` — a rising `released` count means readers
  or staff are abandoning payments
- Drawer variances trending in one direction — that's a training problem, not a
  software one

## When a shop says "it took the money but didn't record the sale"

1. Find the charge in Stripe. Note the PaymentIntent id.
2. `SELECT * FROM payment_attempts WHERE stripe_payment_intent_id = '...'`.
   If there's no row, the payment was never started by us — that is a Stripe
   dashboard charge, not a ThriftOS sale.
3. `SELECT * FROM stripe_events WHERE object_id = '...'`. If the event is
   `failed`, read `last_error`, fix it, and replay.
4. If no event arrived at all, hit `GET /api/pos/terminal/status/:transactionId`
   — it reads Stripe directly and applies the same transitions.
5. The ledger entries for the sale are the record of what we believe happened:
   `entriesForTransaction()`. Compare against Stripe's balance transaction.

Never "fix" this by hand-editing a transaction row. Post a ledger entry, or
replay the event. The history is the point.

Faster route now that logging exists: search the logs for the transaction id.
Every step from the quote to the ledger write carries it, so the line where the
story stops is the step that failed.

## What is still unverified

**Terminal has never run against live Stripe.** Charge construction, the
guards, state mapping, webhook handling, and refund arithmetic are covered by
unit tests, but no simulated reader has ever taken a payment in this codebase.
The go-live checklist above is not a formality — the first real tap is the
first real test of that path.
