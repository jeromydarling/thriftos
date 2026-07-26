import type { HelpArticle } from "./types";

/**
 * Taking payments.
 *
 * The longest section in the help centre on purpose. Payment setup is where a
 * shop is most likely to get stuck, most likely to give up, and least likely to
 * have anyone on staff who has done it before. Every step says what you should
 * see afterwards, because "click next" instructions are useless the moment
 * something doesn't look the way the writer expected.
 */
export const PAYMENTS_ARTICLES: readonly HelpArticle[] = [
  {
    slug: "set-up-card-payments",
    title: "Setting up card payments, start to finish",
    summary:
      "Connect Stripe, get verified, and take your first card payment — including what to do when Stripe asks for something you don't have to hand.",
    category: "payments",
    audience: ["owner", "manager"],
    readMinutes: 9,
    updated: "2026-07-26",
    appPath: "/app/settings#payments",
    keywords: ["stripe", "connect", "onboarding", "activate", "card", "merchant"],
    sections: [
      {
        heading: "Before you start",
        body: [
          "Set aside about twenty minutes and have three things within reach: your organisation's legal name and EIN, a bank account number and routing number for the account you want money paid into, and the personal details of whoever is legally responsible for the organisation — usually a director or officer.",
          "That last one surprises people. Stripe is required to verify a real human being behind every account, so it will ask for a name, date of birth, home address, and often the last four digits of a Social Security number. This is not ThriftOS asking, and we never see it. If the person who has to answer isn't you, get them in the room before you start rather than abandoning the form halfway.",
        ],
        callout: {
          tone: "note",
          title: "You don't need this to open today",
          body: "Cash sales work with no setup at all. If today is busy, take cash, and come back to this when the shop is quiet. Nothing else in ThriftOS depends on payments being connected.",
        },
      },
      {
        heading: "The steps",
        steps: [
          {
            do: "Open Settings and find the Card payments panel.",
            expect: "It says 'Card payments aren't set up' with an Activate payments button.",
            watchOut:
              "If it says payments aren't switched on for this deployment, the ThriftOS instance itself is missing its Stripe keys. That's an administrator job, not yours — send them the message on screen.",
          },
          {
            do: "Press Activate payments.",
            expect: "You're sent to a Stripe-hosted page. The address bar will say stripe.com.",
            watchOut:
              "We never ask for bank details inside ThriftOS. If a page asks you for an account number and it isn't on stripe.com, stop and tell us.",
          },
          {
            do: "Work through Stripe's questions about your organisation.",
            expect: "Business type, address, what you sell, and who is responsible.",
            watchOut:
              "For 'what does your business sell', the honest answer is used or secondhand merchandise. Don't overthink it — we've already set the category to secondhand retail behind the scenes.",
          },
          {
            do: "Add the bank account you want payouts to land in.",
            expect: "Stripe confirms the account, sometimes instantly, sometimes after a small test deposit.",
            watchOut:
              "Use the organisation's account, not a personal one. Changing it later is possible but involves re-verification.",
          },
          {
            do: "Finish, and let Stripe send you back to ThriftOS.",
            expect:
              "You land on a page telling you exactly where you stand — enabled, still needing something, or being checked.",
            watchOut:
              "Getting back to ThriftOS doesn't mean you're finished. We check with Stripe directly rather than assuming, so believe what this page says over what the last Stripe screen implied.",
          },
        ],
      },
      {
        heading: "What the statuses actually mean",
        body: [
          "The Payments panel shows one of a handful of states. They're not jargon for jargon's sake — each one means something different about what you can do today.",
        ],
        table: {
          headers: ["What you see", "What it means", "What to do"],
          rows: [
            [
              "Card payments are on",
              "Stripe has enabled both charging and payouts.",
              "Nothing. Go and sell something.",
            ],
            [
              "A few details still needed",
              "You started but didn't finish.",
              "Press Finish setting up. You'll resume where you left off.",
            ],
            [
              "Stripe needs something from you",
              "You finished, but Stripe wants more — often an ID document or a clarification.",
              "The panel lists what's outstanding. Press Finish setting up to provide it.",
            ],
            [
              "Stripe is checking your details",
              "Everything's in and under review.",
              "Wait. Usually a day or two. The page updates itself.",
            ],
            [
              "Payments are paused",
              "Stripe has restricted the account, and shows its reason.",
              "Read the reason, then open your Stripe dashboard for the detail.",
            ],
            [
              "This account can't take payments",
              "Stripe has declined the account outright.",
              "Contact Stripe support. Cash sales continue as normal meanwhile.",
            ],
          ],
        },
      },
      {
        heading: "Why we check rather than assume",
        body: [
          "When Stripe sends you back to us, all that proves is that a browser followed a link. It doesn't prove you finished, and it certainly doesn't prove Stripe approved anything. So we ask Stripe directly what the state of your account is, and show you that.",
          "This occasionally means the page says you're not finished when you thought you were. That's the system working. The alternative — telling you card payments are on when they aren't — would send you into a Saturday rush with a register that declines everything.",
        ],
      },
      {
        heading: "If you get interrupted",
        body: [
          "Onboarding links expire, and half-finished applications are completely normal. Come back to Settings and press Finish setting up; we'll mint a fresh link and drop you back into Stripe's flow.",
          "You will not create a second Stripe account by doing this, however many times you restart. There's exactly one account per shop, and we reuse it. This matters more than it sounds: a duplicate account holding your verification documents is a genuinely awkward thing to unpick.",
        ],
      },
    ],
    faq: [
      {
        question: "Whose name is on the customer's bank statement?",
        answer:
          "Yours. Your shop is the merchant of record — you hold the Stripe account, receipts carry your name, and payouts go to your bank. ThriftOS takes a disclosed fee on top; we are not in the middle of your money.",
      },
      {
        question: "Do I need to be a registered nonprofit?",
        answer:
          "No. Stripe will ask what kind of organisation you are, and both nonprofit and for-profit answers are fine. Your tax status affects your donation receipts, not your ability to take cards.",
      },
      {
        question: "How long until money reaches my bank?",
        answer:
          "Stripe's standard schedule for a new US account is a rolling payout a couple of days after each sale, with the very first payout taking longer — often seven to fourteen days — while Stripe establishes the account. This is Stripe's schedule, not ours, and you can see it in your Stripe dashboard.",
      },
      {
        question: "Can I test it before going live?",
        answer:
          "Yes, if your ThriftOS instance is running Stripe test keys — the Payments panel shows a Test mode badge when it is. In test mode you can run the whole flow with Stripe's test cards without any real money moving.",
      },
    ],
    related: ["card-readers-and-tap-to-pay", "what-payments-cost", "payment-problems"],
  },

  {
    slug: "card-readers-and-tap-to-pay",
    title: "Choosing and setting up a card reader",
    summary:
      "Tap to Pay on a phone you already own, or a reader you buy outright — what each is good for, and how to get it working.",
    category: "payments",
    audience: ["owner", "manager", "staff"],
    readMinutes: 7,
    updated: "2026-07-26",
    keywords: ["reader", "terminal", "tap to pay", "hardware", "m2", "wisepos", "s700"],
    sections: [
      {
        heading: "The short version",
        body: [
          "If you already have a reasonably recent phone or tablet, start with Tap to Pay and spend nothing. If you want a dedicated thing that lives by the till and doesn't walk off in someone's pocket, buy a reader outright for about $59.",
          "What you should not do is sign a hardware lease. The going rate elsewhere is $190 to $254 a month on a forty-eight month term — somewhere between seven and twelve thousand dollars, non-cancellable, for a device that costs a fraction of that. If you're currently in one, see how much longer it has to run before you decide anything; you may be better off letting it lapse rather than paying it out.",
        ],
        callout: {
          tone: "warn",
          title: "Leases outlive the equipment",
          body: "Four years is longer than most card terminals stay current. Read any hardware agreement's termination clause before signing, whoever it's with — including ours, which is that there isn't one, because you own the reader.",
        },
      },
      {
        heading: "Tap to Pay",
        body: [
          "Tap to Pay turns a phone or tablet into a contactless reader. The customer taps their card or phone against the back of yours, and that's the whole interaction. There's no extra device to charge, pair, or lose.",
          "It handles contactless cards and phone wallets, which is most customers now. It does not handle a chip card that must be inserted, or a card with only a magnetic stripe. For a shop with an older customer base, keep some way of taking those — which in practice means either a physical reader or cash.",
        ],
        list: [
          "Costs nothing if you have a suitable device",
          "Nothing to carry, charge, or lose",
          "Contactless only — no chip insert, no swipe",
          "Needs a fairly recent phone or tablet and a live connection",
        ],
      },
      {
        heading: "A physical reader",
        body: [
          "A Stripe Reader M2 is about $59 and you own it outright. It takes contactless, chip, and swipe, so nobody gets turned away. It sits by the till, and because it's yours, leaving ThriftOS means keeping it rather than posting it back to someone.",
          "Larger shops sometimes want a countertop smart reader with its own screen, which lets the customer tap without anyone passing a device across the counter. Those cost more and are worth it at real volume; below that they're a nicer version of a thing you already have.",
        ],
      },
      {
        heading: "Getting a reader working",
        steps: [
          {
            do: "Make sure Card payments shows as on in Settings first.",
            expect: "A green Live badge on the Payments panel.",
            watchOut:
              "A reader can't be paired to an account that isn't finished verifying. Sort that first or you'll chase a hardware problem that isn't one.",
          },
          {
            do: "Charge the reader fully before its first use.",
            expect: "A steady light rather than a blinking one.",
            watchOut:
              "A surprising share of 'the reader won't connect' turns out to be a flat battery on a device that's been in a drawer since it arrived.",
          },
          {
            do: "Put the reader on the same network as the register.",
            expect: "It appears as available in the register's reader picker.",
            watchOut:
              "Guest wi-fi networks often block devices from seeing each other. If the reader is invisible but online, that's usually why — ask whoever runs the network for the ordinary one.",
          },
          {
            do: "Run one small test sale and refund it.",
            expect: "Approved on the reader, and the sale visible in the register history.",
            watchOut:
              "Do this before opening, not during a queue. A test sale of a dollar tells you everything a hypothetical one doesn't.",
          },
        ],
      },
      {
        heading: "Which to buy, honestly",
        table: {
          headers: ["Your situation", "What we'd do"],
          rows: [
            ["Open two days a week, mostly cash", "Tap to Pay. Spend nothing until card volume justifies it."],
            ["Regular hours, one till", "One M2 reader. $59, keeps chip-card customers served."],
            ["Two tills, or a busy Saturday", "A reader per till. Sharing one across two registers causes queues and mistakes."],
            ["Pop-up stall or a fair", "Tap to Pay on a phone, and take cash as well — venue wi-fi is unreliable."],
            ["Currently leasing a terminal", "Check the remaining term, then move. The lease is usually the biggest line on your bill."],
          ],
        },
      },
    ],
    faq: [
      {
        question: "Can two registers share one reader?",
        answer:
          "Technically yes, practically no. A reader can only be doing one thing at a time, and two people sending payments to it produces exactly the confusion you'd expect. Buy the second one.",
      },
      {
        question: "What happens to the reader if we leave ThriftOS?",
        answer:
          "You keep it. You bought it, it's a standard Stripe reader, and it works with anything else that supports Stripe Terminal. There's nothing to return and no buyout to negotiate.",
      },
      {
        question: "Can I take card payments with no internet at all?",
        answer:
          "Not through the web register, no — and we'd rather say that plainly than pretend. See the article on selling when the internet is down for what does work, which is more than you'd think.",
      },
    ],
    related: ["set-up-card-payments", "selling-when-the-internet-is-down", "what-payments-cost"],
  },

  {
    slug: "what-payments-cost",
    title: "What a card payment actually costs you",
    summary:
      "Every fee on a sale, who takes what, and why your cash sales cost nothing beyond the subscription.",
    category: "payments",
    audience: ["owner", "manager"],
    readMinutes: 6,
    updated: "2026-07-26",
    keywords: ["fees", "processing", "platform fee", "cost", "rate", "cap"],
    sections: [
      {
        heading: "Two fees, both on the label",
        body: [
          "When a customer pays by card, two organisations take a cut and both are shown on every transaction record.",
          "Stripe charges its published card-present rate — 2.7% plus five cents at the time of writing — for moving the money. ThriftOS charges a platform fee, which is between 0.25% and 0.75% depending on your plan. Nothing is bundled into a single blended rate, because a blended rate is how a fee gets hidden.",
        ],
        table: {
          headers: ["On a $20 sale", "Amount"],
          rows: [
            ["Customer pays", "$20.00"],
            ["Stripe takes (2.7% + 5¢)", "−$0.59"],
            ["ThriftOS takes (0.75% on Volunteer)", "−$0.15"],
            ["You keep", "$19.26"],
          ],
        },
      },
      {
        heading: "The cap, which is the part worth knowing",
        body: [
          "Our platform fee stops. Each plan caps it monthly at that plan's own subscription price, so on Volunteer the fee stops at $39 a month however much you sell. You reach that cap at around $5,200 of card sales, and every card payment after it costs you nothing from us for the rest of the month.",
          "That means the most you can pay ThriftOS in any month on Volunteer is $78 — the $39 subscription and $39 of fee. Not a penny more, whatever kind of December you have.",
        ],
        callout: {
          tone: "good",
          title: "A busy month is never a punishment",
          body: "This is the opposite of a percentage that grows forever. Once you're past the cap, growing your card sales costs you only what Stripe charges.",
        },
      },
      {
        heading: "What the fee is not charged on",
        body: [
          "The platform fee applies to merchandise, after any discount. It does not apply to sales tax, which is the state's money and never yours to begin with. It does not apply to a customer's round-up donation, because taking a cut of someone's donation to your shop is not a thing we're willing to do.",
          "And it does not apply to cash. A cash sale has no card, no processor, and no platform fee — only your subscription applies. A cash-only shop pays $39 a month and nothing else.",
        ],
      },
      {
        heading: "What we're not going to call it",
        body: [
          "The platform fee is a fee. It is not a donation, it isn't 'supporting the platform', and we don't put it on a screen dressed as a charitable act. You're paying us for software, which is a perfectly ordinary thing to be doing.",
        ],
      },
      {
        heading: "If a customer wants to cover the fees",
        body: [
          "At checkout you can offer the customer the option of covering processing costs so the full amount reaches you. It's clearly labelled, the customer chooses, and most say yes when asked plainly. It is never a pre-ticked box that quietly inflates a total — that's a dark pattern, and it costs more in trust than it earns in cents.",
        ],
      },
    ],
    faq: [
      {
        question: "Do I pay the platform fee during my free trial?",
        answer:
          "No. During the 30-day trial there's no subscription charge and no platform fee. You're taking real payments, and Stripe's own processing fee still applies because that's Stripe's cost of moving money.",
      },
      {
        question: "What if a sale is refunded?",
        answer:
          "You get our platform fee back in proportion to what you refunded, and the refund frees up your monthly cap again. Stripe's own processing fee behaves according to Stripe's policy, which we don't control.",
      },
      {
        question: "Is there a minimum?",
        answer:
          "There's no minimum sale amount and no minimum monthly fee. On a very quiet month with two card sales, our fee is a couple of cents.",
      },
    ],
    related: ["set-up-card-payments", "refunds-and-returns", "your-plan-and-billing"],
  },

  {
    slug: "selling-when-the-internet-is-down",
    title: "Selling when the internet is down",
    summary:
      "What keeps working when the connection drops, what doesn't, and why we won't pretend to take a card offline.",
    category: "payments",
    audience: ["owner", "manager", "staff", "volunteer"],
    readMinutes: 5,
    updated: "2026-07-26",
    appPath: "/app/register",
    keywords: ["offline", "no internet", "wifi down", "sync", "queue"],
    sections: [
      {
        heading: "What still works",
        body: [
          "The register keeps going. You can search stock you've already loaded, build a cart, apply the right markdown, take cash, and give the customer a receipt. Every sale is saved on the device the moment you complete it, and the register shows an Offline badge so nobody's guessing.",
          "When the connection returns, queued sales send themselves. You don't need to do anything, and you can't accidentally send them twice — each sale carries an identifier the server recognises, so a repeated sync is silently ignored rather than charging anyone again.",
        ],
      },
      {
        heading: "What doesn't",
        body: [
          "Card payments. A card has to be authorised by the customer's bank, and that needs a live connection — there is no way around it that doesn't involve taking a real risk with real money.",
          "Some systems will let you store a card payment offline and submit it later. That works right up until the card declines a day later, by which point the customer has left with the coat and you have nothing. Doing that safely needs a native app and specific hardware, and it puts the loss on the shop. Our web register doesn't offer it, and we'd rather tell you why than quietly leave a broken button on screen.",
        ],
        callout: {
          tone: "warn",
          title: "If you tried to queue a card sale",
          body: "The register will keep it on the device and tell you it needs a manager rather than dropping it. Nothing is lost — but somebody has to decide what actually happened with that customer.",
        },
      },
      {
        heading: "What to do in the moment",
        steps: [
          {
            do: "Check the badge at the top of the register.",
            expect: "'Offline — still selling' if the connection has dropped.",
          },
          {
            do: "Keep serving. Take cash.",
            expect: "Sales complete normally and a counter shows how many are waiting to sync.",
          },
          {
            do: "For card customers, offer cash, an ATM, or holding the item.",
            watchOut:
              "Holding an item for someone is fine and normal. Promising them a price for next week is a decision, not an inevitability — make it deliberately.",
          },
          {
            do: "When the connection returns, watch the counter fall to zero.",
            expect: "A short 'queued sales synced' message.",
            watchOut:
              "If the counter stays put, don't close the browser or clear the site's data — the sales are in there. Get someone to look at it.",
          },
        ],
      },
      {
        heading: "Preparing for it in advance",
        body: [
          "Open the register once at the start of every day while you still have a connection. That loads the stock list onto the device, which is what lets search work later if things go wrong.",
          "Keep a float. A shop that can only take cards is a shop that closes when the router does.",
        ],
      },
    ],
    faq: [
      {
        question: "How long can we stay offline?",
        answer:
          "Practically, a full day of trading is fine. Sales are held in the browser's own storage, which persists across refreshes and restarts. Don't clear site data while sales are queued.",
      },
      {
        question: "What if the tablet dies with sales still queued?",
        answer:
          "They're on that device's storage, so they come back when it does. If the device is genuinely gone, so are they — which is a good argument for syncing whenever you have a signal rather than a whole day at once.",
      },
    ],
    related: ["card-readers-and-tap-to-pay", "ringing-up-a-sale", "payment-problems"],
  },

  {
    slug: "payment-problems",
    title: "When a payment goes wrong",
    summary:
      "Declines, stuck readers, a sale that took the money but didn't finish, chargebacks — what each one means and what to do.",
    category: "payments",
    audience: ["owner", "manager", "staff"],
    readMinutes: 8,
    updated: "2026-07-26",
    keywords: ["decline", "failed", "stuck", "dispute", "chargeback", "troubleshooting"],
    sections: [
      {
        heading: "A card declines",
        body: [
          "Most declines are the customer's bank saying no, and there's nothing wrong at your end. The customer's card is at its limit, or their bank flagged the transaction, or the card has expired. Ask them to try another card, or take cash.",
          "What matters operationally is that a declined payment does not sell the item. It stays on the floor and is available to the next person. You'll see the sale return to a state you can retry from — retrying creates a fresh attempt rather than resurrecting the failed one, so there's no way to accidentally charge twice.",
        ],
      },
      {
        heading: "The reader won't respond",
        steps: [
          {
            do: "Check the reader is on and charged.",
            watchOut: "A reader on a dying battery often connects, then fails mid-payment.",
          },
          {
            do: "Cancel the payment from the register rather than the reader.",
            expect: "The reader returns to its idle screen.",
            watchOut:
              "Pulling the power mid-payment is the one thing to avoid. Cancel properly so both sides agree nothing happened.",
          },
          { do: "Check nobody else is sending a payment to the same reader." },
          { do: "Restart the reader, then run a small test sale before serving the next customer." },
        ],
      },
      {
        heading: "The customer was charged but the sale didn't finish",
        body: [
          "This is the one that feels worst and is genuinely rare, but you should know the shape of it. It happens when the payment succeeds at Stripe and something interrupts us before the sale closes — a browser crash, a connection dropping at exactly the wrong second.",
          "Stripe is the authority on whether money moved, so check there first: if the payment shows as succeeded in your Stripe dashboard, the customer has been charged and you should let them leave with the item. The sale will reconcile on our side when the confirmation arrives, and you can check the register history afterwards.",
          "Do not run the payment again to 'make it stick'. That's how a customer gets charged twice.",
        ],
        callout: {
          tone: "warn",
          title: "When in doubt, believe Stripe",
          body: "Our records follow Stripe's, never the other way round. If the two ever disagree, Stripe is right and we have a bug to fix — tell us.",
        },
      },
      {
        heading: "Two registers sold the same item",
        body: [
          "Only one of them actually did. Items are one of a kind, so the first register to claim it gets it, and the second is told the item is gone.",
          "The second customer still paid, though, and that's real money — so we record their sale and flag the line as unfulfilled rather than quietly deleting it. You'll see a message on the register. Someone needs to sort it out with that customer: refund them, or find them something else. Usually the cause is a duplicated tag number, which is worth checking if it happens more than once.",
        ],
      },
      {
        heading: "A chargeback",
        body: [
          "A chargeback is a customer telling their bank they don't recognise or accept a charge. You'll be notified, and there's a window to respond with evidence — a receipt, a record of what was sold.",
          "For thrift shops these are mercifully rare, and most are genuine confusion rather than fraud: someone doesn't recognise the shop's name on their statement. Making sure your shop's name in Settings matches what customers actually call you prevents a surprising number of them.",
        ],
      },
      {
        heading: "Payments stopped working entirely",
        body: [
          "Check the Payments panel in Settings first. The most common cause is Stripe asking for something — an updated document, a clarification — and pausing the account until it arrives. The panel shows the reason and links to where you provide it.",
          "Cash sales are unaffected throughout. However bad the card situation looks, the shop can still trade.",
        ],
      },
    ],
    faq: [
      {
        question: "A customer says they were charged twice. How do I check?",
        answer:
          "Look in your Stripe dashboard for their card's last four digits and today's date — it shows every charge, including ones that never made it back to us. If there genuinely are two, refund one from ThriftOS and tell us, because it means something is wrong at our end.",
      },
      {
        question: "Can I take a payment over the phone?",
        answer:
          "Not in the register today. It's built for card-present sales, which are cheaper to process and safer for the shop.",
      },
    ],
    related: ["refunds-and-returns", "selling-when-the-internet-is-down", "set-up-card-payments"],
  },
] as const;
