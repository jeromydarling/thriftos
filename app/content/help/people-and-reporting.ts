import type { HelpArticle } from "./types";

/** People, volunteers, reporting, the Compass, and settings. */
export const PEOPLE_ARTICLES: readonly HelpArticle[] = [
  {
    slug: "one-list-of-people",
    title: "One list of people, not four",
    summary:
      "Why donors, shoppers, volunteers, and workers share a single record, and how roles stack automatically.",
    category: "people",
    audience: ["owner", "manager", "staff"],
    readMinutes: 4,
    updated: "2026-07-26",
    appPath: "/app/people",
    keywords: ["contacts", "donors", "crm", "roles", "people"],
    sections: [
      {
        heading: "The idea",
        body: [
          "Most systems keep donors in one module, volunteers in another, and customers nowhere. So the woman who drops off bags every spring, covers the register on Thursdays, and shops every week ends up as three records that never meet — and gets thanked for a donation the same week she's sent a volunteer recruitment appeal and a sale flyer.",
          "ThriftOS keeps one list. Roles stack: the same person can be donor, volunteer, shopper, and worker at once, and her record shows the whole relationship in one place.",
        ],
      },
      {
        heading: "Roles add themselves",
        body: [
          "You almost never add a role by hand. Record a donation with a name on it and that person becomes a donor. Schedule them for a shift and they become a volunteer too. The system finds the existing person by email and merges the role rather than creating a second record.",
          "This is why it's worth asking for an email at the counter, and worth accepting that plenty of people won't give one. An anonymous donation is still recorded; it just can't be joined up later.",
        ],
      },
      {
        heading: "Keeping the list honest",
        body: [
          "A shop with four hundred names it never contacts is in better shape than one with four thousand it emails monthly. The second has trained most of those people to ignore it, and the unsubscribes you can see are the small visible part of a much larger silent tuning-out.",
          "Every email carries a one-click unsubscribe, and an unsubscribe is honoured everywhere, permanently, with no argument and no re-subscribe campaign.",
        ],
      },
      {
        heading: "Finding someone",
        body: [
          "Search by name or email, or filter to a role. The list pages efficiently however large it gets, so a shop with forty thousand contacts is as fast as one with forty.",
        ],
      },
    ],
    related: ["recording-a-donation", "scheduling-volunteers", "the-compass"],
  },

  {
    slug: "scheduling-volunteers",
    title: "Volunteer shifts and hours",
    summary:
      "Putting people on the rota, logging hours as shifts finish, and turning that into something a funder will accept.",
    category: "volunteers",
    audience: ["owner", "manager"],
    readMinutes: 5,
    updated: "2026-07-26",
    appPath: "/app/volunteers",
    keywords: ["volunteer", "shift", "rota", "schedule", "hours"],
    sections: [
      {
        heading: "Adding a shift",
        body: [
          "Name, date, start time, and how long. If the person is new, they're created as a contact with a volunteer role automatically — no separate volunteer sign-up step.",
          "Give the shift a role label — floor, sorting, register, pickup, donation intake. It costs nothing and later tells you whether you're short on sorters or short on cashiers, which are quite different problems.",
        ],
      },
      {
        heading: "Logging hours",
        body: [
          "As shifts pass they appear under recent shifts with a box to log the hours actually worked. Do this weekly rather than monthly from memory. Reconstructed hours are the weakest number in most impact reports, and everyone knows it.",
          "Log what actually happened. If someone stayed an extra two hours, that's two extra hours — those hours are real and they belong in your total.",
        ],
        callout: {
          tone: "note",
          title: "Record headcount as well as hours",
          body: "Two thousand hours from six people and two thousand from ninety describe completely different organisations. A funder reading only the total learns almost nothing about which one you are.",
        },
      },
      {
        heading: "Turning hours into evidence",
        body: [
          "Your Impact page converts hours into a dollar figure using Independent Sector's published national value of a volunteer hour. That's an external reference with a name attached, not a valuation your shop invented — and it's cited that way, which is what makes it usable in an application.",
          "The full history exports as CSV whenever you need it.",
        ],
      },
      {
        heading: "When someone drifts away",
        body: [
          "The Compass will notice when a volunteer who worked a steady rhythm hasn't been on the schedule for a while and has nothing upcoming. It says so quietly and once.",
          "The useful response is a friendly note, not a rota shift assigned unasked. People drift off mostly because nobody asked, and occasionally because something happened in their life that isn't your business. A short message covers both cases.",
        ],
      },
    ],
    faq: [
      {
        question: "Do volunteers need logins?",
        answer:
          "Only if they'll use the register or log items. Logins are unlimited and free on every plan — we're not going to charge per seat in a shop staffed by volunteers.",
      },
      {
        question: "Can volunteers see donor details?",
        answer:
          "The volunteer role is deliberately limited. Give people the least access that lets them do the job, and raise it when they need more.",
      },
    ],
    related: ["one-list-of-people", "impact-reporting", "shop-details-and-team"],
  },

  {
    slug: "impact-reporting",
    title: "Impact reporting that survives scrutiny",
    summary:
      "Diversion, value delivered, and volunteer hours — where each number comes from, and how to defend it.",
    category: "reporting",
    audience: ["owner", "manager"],
    readMinutes: 7,
    updated: "2026-07-26",
    appPath: "/app/impact",
    keywords: ["impact", "diversion", "landfill", "grant", "board", "report", "csv"],
    sections: [
      {
        heading: "Why it's already written",
        body: [
          "Most impact reports get assembled in a panic before a board meeting, from records never designed to answer the question. The numbers end up being estimates of estimates and everyone privately knows it.",
          "ThriftOS derives impact from the records that already run the shop — the sale, the donation, the shift. Nobody has to remember to log impact separately, so the report is a query rather than a project.",
        ],
      },
      {
        heading: "What each number actually is",
        table: {
          headers: ["Figure", "How it's calculated", "What it excludes"],
          rows: [
            [
              "Diversion weight",
              "The weight of items that actually left for reuse — sold, transferred, or recycled.",
              "Stock still on the floor. It hasn't been diverted from anything yet.",
            ],
            [
              "Items rehomed",
              "A count of items sold.",
              "Items held or pulled.",
            ],
            [
              "Value delivered",
              "Comparable new price minus what the shopper paid, summed across sales.",
              "Any item with no recorded comparable price. It contributes zero rather than an estimate.",
            ],
            [
              "Volunteer hours",
              "Hours logged against completed shifts.",
              "Scheduled shifts nobody logged. Unlogged hours don't exist.",
            ],
          ],
        },
      },
      {
        heading: "The honesty that makes it usable",
        body: [
          "Value delivered counts only items where a retail comparison was actually recorded. Where none was, it contributes nothing — we don't apply a multiplier to make the number bigger.",
          "This means your figure will look lower than one produced by a system that estimates. It will also survive a question, which is the point. A grant officer who has read a hundred impact reports can tell the difference between a number with a method attached and one that appeared from nowhere, and the first is the one they can defend to their own board.",
        ],
        callout: {
          tone: "good",
          title: "State the method beside the figure",
          body: "Weight estimated by category average, not weighed. Value delivered counted only where a comparison was recorded. Hours logged per shift. Writing this down also protects you next year when someone asks how the figure was arrived at and everyone who knew has moved on.",
        },
      },
      {
        heading: "Getting it out",
        body: [
          "The In plain words box gives you sentences you can paste into a board packet without rewriting. Export CSV gives you the monthly history for a spreadsheet or an application form.",
          "Both are drawn from the same records as everything else, so the version in your grant application and the version on your dashboard cannot disagree.",
        ],
      },
      {
        heading: "Making the numbers better",
        body: [
          "Two habits improve every figure here. Record a weight at donation intake, even a rough one. And record a comparable new price on anything where it's obvious — a $90 coat sold for $14 contributes $76 of value delivered, and takes three seconds to capture.",
          "Neither is required. Both make the difference between a report that impresses and one that shrugs.",
        ],
      },
    ],
    faq: [
      {
        question: "Can I report on a custom date range?",
        answer:
          "The page shows all-time totals and a monthly history. Export the CSV and total whichever months you need — most applications ask for a fiscal year, which is a spreadsheet sum away.",
      },
      {
        question: "Is it fair to put a dollar value on volunteer hours?",
        answer:
          "Yes, if you attribute the rate. We use Independent Sector's national figure and cite it as theirs rather than presenting the conversion as your own valuation.",
      },
    ],
    related: ["scheduling-volunteers", "recording-a-donation", "the-compass"],
  },

  {
    slug: "the-compass",
    title: "The Compass, and what NRI notices",
    summary:
      "Where the suggestions come from, why every one shows its working, and how to keep it useful rather than noise.",
    category: "nri",
    audience: ["owner", "manager"],
    readMinutes: 6,
    updated: "2026-07-26",
    appPath: "/app",
    keywords: ["compass", "nri", "signals", "ai", "suggestions", "insights"],
    sections: [
      {
        heading: "What it is",
        body: [
          "The Compass is the one place ThriftOS says anything unprompted. It notices what a busy week hides — a donor gone quiet against their own rhythm, stock past its rotation, receipts owed, a milestone worth saying out loud — and gathers it in one calm spot rather than scattering alerts across the interface.",
          "It is deliberately small. At most six things at once, celebrations first, because a shop that only ever hears about problems stops opening the app.",
        ],
      },
      {
        heading: "It isn't a model guessing",
        body: [
          "This is the part most often misunderstood. Compass signals come from deterministic rules over your own records, not from an AI. Run the same data through twice and you get identical output.",
          "That's what makes 'Why am I seeing this?' an honest answer rather than a hand-wave. Open it on any signal and you'll see the exact counts, dates, and records behind it. If a signal can't show you its working, treat that as a bug and tell us.",
          "The published thresholds are on our NRI page — the actual numbers, not a description of them.",
        ],
      },
      {
        heading: "What it will never do",
        list: [
          "Act on its own — no price changes, no emails, no messages to anyone",
          "Score, rank, or tier a person; there are no donor tiers and no volunteer leaderboards",
          "Surface anything it can't show you the evidence for",
          "Invent a number it doesn't have",
          "Manufacture something to say during a quiet week",
        ],
        body: [
          "That last one is worth dwelling on. An empty Compass is a valid, healthy state — it means nothing crossed a threshold, not that something is broken. A system that always finds something to tell you has stopped being worth reading.",
        ],
      },
      {
        heading: "Making it useful",
        body: [
          "Dismiss what isn't useful. It won't come back, and it costs nothing to be firm — the Compass is meant to be a short list of things that actually deserve you, not an inbox.",
          "Write the odd note. Signals about donors and volunteers get better when there's context in the system, and the notes you write become the raw material for next year's grant report anyway. The Compass will mention it if note-writing drops off sharply, because that's usually a sign the shop got busy rather than that nothing happened.",
        ],
      },
      {
        heading: "Acting on a check-in signal",
        body: [
          "When the Compass says a donor has been quiet, the right response is a friendly hello, not a solicitation. There are a hundred good reasons someone has been quiet and most of them are none of your business. The signal exists so you notice, not so you can run a campaign.",
        ],
      },
    ],
    faq: [
      {
        question: "Can I turn it off?",
        answer:
          "You can dismiss everything, and a Compass you never engage with will stay quiet. If you want it gone entirely, tell us why — that's useful information.",
      },
      {
        question: "Why is my Compass empty?",
        answer:
          "Either you're new and there isn't enough history yet, or genuinely nothing crossed a threshold this week. Both are fine. It fills in as the shop accumulates records.",
      },
      {
        question: "Does it read my data to train anything?",
        answer:
          "No. Signals are rules run against your own records inside your own shop. Nothing is sold, nothing is shared, and nothing leaves.",
      },
    ],
    related: ["impact-reporting", "one-list-of-people"],
  },

  {
    slug: "shop-details-and-team",
    title: "Your shop's details, team, and roles",
    summary:
      "What to fill in before issuing receipts, who can do what, and how to add someone without sharing a password.",
    category: "admin",
    audience: ["owner", "manager"],
    readMinutes: 5,
    updated: "2026-07-26",
    appPath: "/app/settings",
    keywords: ["settings", "team", "roles", "permissions", "ein", "invite", "staff"],
    sections: [
      {
        heading: "Fill these in first",
        body: [
          "Your legal name and EIN appear on every donation receipt, so set them before you issue one. Reissuing a batch of receipts because the EIN was blank is a genuinely miserable afternoon.",
          "The shop name is what customers see, and it's worth matching what people actually call you rather than what's on the incorporation paperwork — it prevents a real share of card disputes from customers not recognising a name on their statement.",
        ],
      },
      {
        heading: "Roles, and what each can do",
        table: {
          headers: ["Role", "Can do"],
          rows: [
            ["Owner", "Everything, including billing and payments setup."],
            ["Admin", "Everything operational — settings, refunds, team, reports. Not billing ownership."],
            ["Staff", "Register, intake, inventory, donations, people. Refunds up to your threshold."],
            ["Volunteer", "The day-to-day floor work: register, intake, looking things up."],
          ],
        },
        body: [
          "Give people the least access that lets them do the job, and raise it when they need more. This isn't suspicion — it's so nobody is one mis-tap away from changing the markdown schedule mid-Saturday.",
        ],
      },
      {
        heading: "Adding someone",
        body: [
          "Invite them by email. They set their own password, which nobody else ever knows — including you. Never share a login between people; it makes the audit trail useless and means removing one person locks everyone out.",
          "Removing someone ends their sessions everywhere, immediately. If a volunteer leaves under any kind of cloud, that's the button.",
        ],
        callout: {
          tone: "warn",
          title: "The shared-login trap",
          body: "Shops do this constantly and it always causes the same problem: you can't tell who processed a refund, and you can't remove one person without changing the password for everyone. Individual logins are free and unlimited.",
        },
      },
      {
        heading: "Staff who are also volunteers",
        body: [
          "A login and a contact record are different things, and the distinction confuses people at first. The login is how somebody gets into the app; the contact record is how the shop knows them as a person — donor, volunteer, shopper, or all three at once.",
          "Somebody who both works shifts and logs in needs both: invite them so they can sign in, and add them to People so their hours land in your volunteer figures. Linking the two means their shifts are counted without anyone typing a name twice.",
        ],
      },
      {
        heading: "The register's own settings",
        body: [
          "Sales tax rate, whether to offer round-ups, and what the round-up is called are all here. The tax rate is stored precisely rather than as a rounded percentage, so it can't drift by a cent on large sales.",
          "Name the round-up after something concrete — a programme, a fund, a specific thing the money does. \"Round up for the food pantry\" is accepted far more often than \"round up to support our mission\", because the first tells a shopper what happens to their forty cents.",
        ],
      },
      {
        heading: "What to do before you go live",
        list: [
          "Legal name and EIN filled in, if you'll issue donation receipts",
          "Sales tax rate set, or explicitly zero if you're exempt",
          "At least one other person invited, so you aren't the only way into the shop",
          "Everyone on the lowest role that lets them do their job",
          "Any sample data cleared",
        ],
      },
    ],
    faq: [
      {
        question: "Can I change someone's role later?",
        answer:
          "Yes, at any time, and it takes effect on their next request rather than their next login. Raising a volunteer to staff for one busy weekend and putting it back afterwards is a perfectly reasonable thing to do.",
      },
      {
        question: "What happens to the records someone created if I remove them?",
        answer:
          "Everything stays. Their sales, intake, and receipts are the shop's records, not theirs, and the audit trail still shows who did what — that's the whole reason for individual logins.",
      },
    ],
    related: ["your-plan-and-billing", "colour-tags-and-markdowns", "set-up-card-payments"],
  },

  {
    slug: "your-plan-and-billing",
    title: "Your plan, and what it costs",
    summary:
      "Which tier you need, what the fee cap means, the trial, and what happens if a payment fails.",
    category: "admin",
    audience: ["owner"],
    readMinutes: 5,
    updated: "2026-07-26",
    appPath: "/app/settings",
    keywords: ["plan", "billing", "subscription", "upgrade", "trial", "invoice", "cancel"],
    sections: [
      {
        heading: "Choosing a tier",
        body: [
          "Not by card volume. Volunteer is the cheapest plan at every volume, because the platform fee is capped at each plan's own subscription — so there's no point at which upgrading saves you money, and we're not going to pretend otherwise to sell you one.",
          "You move up for two reasons only: more locations, or a bigger AI intake allowance. That's it.",
        ],
        table: {
          headers: ["Plan", "Per month", "Fee", "Locations", "Photo reads"],
          rows: [
            ["Volunteer", "$39", "0.75%, capped at $39", "1", "100/month"],
            ["Core", "$99", "0.50%, capped at $99", "1", "1,000/month"],
            ["Federation", "$249", "0.35%, capped at $249", "5", "5,000/month"],
            ["Enterprise", "from $799", "0.25%, negotiated", "Negotiated", "25,000/month"],
          ],
        },
      },
      {
        heading: "The cap",
        body: [
          "Your platform fee stops at your subscription price each month. On Volunteer that's $39, reached at about $5,200 of card sales, after which card payments cost you nothing from us for the rest of the month.",
          "The most you can pay ThriftOS on Volunteer in any month is therefore $78. Whatever December looks like.",
        ],
      },
      {
        heading: "Trial, and what happens if a payment fails",
        body: [
          "Thirty days free, no card required. If it isn't right, walk away and take your data with you as CSV.",
          "If a card fails later, you get fourteen days' grace during which nothing changes at all. After that, three things pause: AI photo intake, your public shop page, and the impact report. That's the whole list.",
          "The register does not pause. Cash checkout does not. Card checkout does not — that money goes to your Stripe account, not ours, and blocking a customer from paying a charity isn't ours to do. Receipts do not. Data export does not. A shop that owes us money can still take a customer's money and can still leave with every record it owns, because locking a till on a Saturday because a card expired isn't a billing strategy.",
          "Nothing stops being recorded while things are paused, either. Your impact figures keep accruing from your sales and donations — the report just isn't drawn until billing is sorted, and it comes straight back when it is.",
        ],
        callout: {
          tone: "good",
          title: "Annual billing",
          body: "Pay for ten months, get twelve. About 16.7% off, the same on every plan.",
        },
      },
      {
        heading: "Leaving",
        body: [
          "Cancel whenever. No notice period, no exit fee, and your data exports as CSV. If you bought a reader it's yours — there's nothing to post back.",
          "We'd rather lose a shop cleanly than keep one that wants to go. If you're leaving, we'd genuinely like to know why.",
        ],
      },
    ],
    related: ["what-payments-cost", "shop-details-and-team", "importing-from-another-system"],
  },
] as const;
