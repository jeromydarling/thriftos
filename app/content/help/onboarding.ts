import type { HelpArticle } from "./types";

/** Your first hour, and moving in from somewhere else. */
export const ONBOARDING_ARTICLES: readonly HelpArticle[] = [
  {
    slug: "your-first-hour",
    title: "Your first hour with ThriftOS",
    summary:
      "What to do in what order so the shop is genuinely running by the end of it, rather than half-configured.",
    category: "getting-started",
    audience: ["owner", "manager"],
    readMinutes: 6,
    updated: "2026-07-26",
    appPath: "/app/welcome",
    keywords: ["setup", "start", "new", "first", "getting started", "checklist"],
    sections: [
      {
        heading: "The order that works",
        body: [
          "You do not need to configure everything before you can use anything. The fastest route to a shop that's actually working is to get twenty real items in and ring up one real sale — everything else can wait until the shop is quiet.",
          "The welcome checklist walks you through this and keeps your place. You can leave halfway and come back; it remembers.",
        ],
        steps: [
          {
            do: "Confirm your shop's details.",
            expect: "Name, address, and — if you issue donation receipts — your legal name and EIN.",
            watchOut:
              "The EIN is the one people skip and regret. Receipts issued without it have to be reissued.",
          },
          {
            do: "Check the colour-tag schedule.",
            expect: "Six colours with a default markdown ladder.",
            watchOut:
              "If your shop already runs a rotation, match it here rather than adopting ours. Staff muscle memory is worth more than our defaults.",
          },
          {
            do: "Log twenty items.",
            expect: "The inventory list fills, and your dashboard stops being empty.",
            watchOut:
              "Twenty is the number where the app starts feeling real. Five isn't enough to tell you anything.",
          },
          {
            do: "Ring up one sale on the register — cash is fine.",
            expect: "Today's sales figure moves, and the item's status becomes sold.",
          },
          {
            do: "Record one donation with a donor's name.",
            expect: "The person appears in People with a donor role.",
          },
          {
            do: "Issue that donor a receipt.",
            expect: "A compliant acknowledgement with the required language already in place.",
          },
        ],
      },
      {
        heading: "What to leave until later",
        body: [
          "Card payments, unless you're taking cards today. Setup takes about twenty minutes and needs your bank details and a responsible person's ID to hand — it's a job for a quiet morning, not your first hour. Cash works with no setup at all.",
          "Your public storefront, volunteer rota, and federation settings can all wait. None of them block the shop from trading.",
        ],
      },
      {
        heading: "Getting your team in",
        body: [
          "Invite people by email rather than sharing a login. They pick their own password, and you can remove any one of them without disrupting anyone else.",
          "Start volunteers on the Volunteer role. It covers the register, intake, and looking things up, which is the whole job for most people. Raise it when someone needs more.",
        ],
      },
      {
        heading: "If you want to look around first",
        body: [
          "The demo shop is a fully-stocked shop with a year of history, a working register, and a Compass with real signals in it. Nothing you do there touches your own shop, and it resets weekly.",
          "It's the fastest way to see what the app looks like once it has data in it — which is the thing a new, empty shop can't show you.",
        ],
      },
    ],
    faq: [
      {
        question: "How long until the reports are useful?",
        answer:
          "The dashboard is useful the day you've logged stock and rung up a sale. Impact reporting needs a few weeks of donations and sales before the trends mean anything — the numbers are correct from day one, they just describe a short period.",
      },
      {
        question: "Can I try it without committing?",
        answer:
          "Thirty days free, no card required. If it isn't right, export your data and go.",
      },
    ],
    related: ["load-sample-data", "importing-from-another-system", "logging-your-first-items"],
  },

  {
    slug: "load-sample-data",
    title: "Filling an empty shop so you can see how it works",
    summary:
      "Load a set of clearly-labelled sample records to explore with, then remove every trace of them in one click.",
    category: "getting-started",
    audience: ["owner", "manager"],
    readMinutes: 3,
    updated: "2026-07-26",
    appPath: "/app/welcome",
    keywords: ["sample", "demo data", "example", "test data", "empty", "explore"],
    sections: [
      {
        heading: "The problem with a new shop",
        body: [
          "An empty shop can't show you anything. The dashboard has nothing to display, the Compass has no patterns to notice, and the impact report is four zeroes. That tells you nothing about whether the software is any good.",
          "So you can load a set of sample records — items across the colour rotation, donors with donation histories, volunteers with logged shifts, and a few months of sales. Suddenly every screen has something on it and you can judge the thing properly.",
        ],
      },
      {
        heading: "It is always labelled",
        body: [
          "Every sample record is marked as sample data, and a banner sits across the app for as long as any of it exists. There is no way to accidentally mistake it for your own records, and no way to forget it's there.",
          "Sample data is excluded from your impact reporting and never counted toward billing. It exists to be looked at.",
        ],
        callout: {
          tone: "warn",
          title: "Clear it before you go live",
          body: "One button removes every sample record and leaves anything real you've entered untouched. Do this before your first real trading day so the numbers on your board report are yours.",
        },
      },
      {
        heading: "What actually gets created",
        body: [
          "Ninety items spread across the whole colour rotation, so some are freshly tagged and some have aged into their final markdown — that's the only way to see what the rotation does over time without waiting eight weeks. Ten people, some donors, some volunteers, one shopper. Around thirty donations with receipts issued against most of them, a few dozen sales, and forty-odd volunteer shifts including some in the future.",
          "The shape is deliberate rather than random. One donor has gone quiet after a run of regular visits, one volunteer has drifted off the schedule, and a slice of the stock has sat past its rotation. Those are the situations the Compass exists to notice, and a tidy dataset where nothing is wrong would show you nothing about how it behaves.",
        ],
      },
      {
        heading: "What it can and can't tell you",
        body: [
          "It shows you the shape of the software: how intake feels, what the register does, what a colour rotation looks like in practice, and what the Compass raises. Those are the things worth judging before you commit.",
          "It can't tell you whether the workflow suits your shop, because your shop's rhythm isn't in it. Twenty of your own items logged by one of your own volunteers will tell you more about that than ninety invented ones — so if you're seriously evaluating, do both.",
        ],
      },
      {
        heading: "Training volunteers on it",
        body: [
          "This is the use that outlasts the evaluation. A new volunteer can ring up sales, log intake, void a transaction, and get a receipt wrong without any of it mattering — and the mistakes are the point, because a person who has already made one on purpose won't panic making it for real.",
          "If you're using it for training after you've gone live, be deliberate about clearing it afterwards. The banner will keep telling you it's loaded, but somebody rushing on a Saturday reads the numbers, not the banner.",
        ],
      },
      {
        heading: "When to use it, and when not to",
        list: [
          "Use it to evaluate ThriftOS before committing — that's what it's for",
          "Use it to train volunteers without risking your live records",
          "Use it to see what a screen looks like with data on it before deciding the screen is useless",
          "Don't use it if you're importing from another system; import the real thing instead",
          "Don't leave it loaded once you're trading",
          "Don't use it to check your own numbers — it's excluded from every report, so it can't help there",
        ],
      },
    ],
    faq: [
      {
        question: "Will any of this reach my impact report or my invoice?",
        answer:
          "No. Every sample record carries a flag that every impact figure and every billing calculation excludes, and the exclusion is tested. The Compass does read sample data for its operational signals — aged stock, a quiet donor — because watching it do that is the point of loading them. It won't celebrate invented diversion weight.",
      },
      {
        question: "Can I load it twice?",
        answer:
          "No — if a set is already loaded the button will tell you so rather than quietly doubling it. Clear the first set if you want a fresh one.",
      },
      {
        question: "Does removing it touch anything I entered myself?",
        answer:
          "It can't. Removal only ever deletes records tagged as belonging to the sample batch, so anything you logged by hand is out of reach by construction, not by carefulness.",
      },
    ],
    related: ["your-first-hour", "importing-from-another-system"],
  },

  {
    slug: "importing-from-another-system",
    title: "Moving in from another system",
    summary:
      "Import inventory, people, and donation history from a CSV — including what to do with the columns that don't map.",
    category: "migrating",
    audience: ["owner", "manager"],
    readMinutes: 8,
    updated: "2026-07-26",
    appPath: "/app/import",
    keywords: ["import", "csv", "migrate", "migration", "switch", "transfer", "thriftcart", "thrifttrac"],
    sections: [
      {
        heading: "What's worth bringing, and what isn't",
        body: [
          "Not everything should come with you. Be selective — a clean shop with the right data beats a complete one full of records nobody will look at again.",
        ],
        table: {
          headers: ["Data", "Bring it?", "Why"],
          rows: [
            [
              "People — donors, volunteers, customers",
              "Yes, always",
              "Relationships are the hardest thing to rebuild and the easiest to move.",
            ],
            [
              "Donation history",
              "Yes",
              "It's what your receipts, donor rhythms, and diversion figures are built from.",
            ],
            [
              "Current inventory",
              "Usually",
              "Worth it if a decent share will still be on the floor in six weeks. If your stock turns fast, starting fresh at intake is less work.",
            ],
            [
              "Historic sales",
              "Rarely",
              "It won't reconcile with your new financial records and it clutters reports. Keep the old system's export as an archive instead.",
            ],
            [
              "Sold or archived items",
              "No",
              "Nothing reads them. Leave them behind.",
            ],
          ],
        },
      },
      {
        heading: "How the import works",
        steps: [
          {
            do: "Export a CSV from your current system.",
            expect: "One file per thing — items, people, donations.",
            watchOut:
              "If your system exports XLSX, open it and save as CSV. Spreadsheet files carry formatting we can't reliably read.",
          },
          {
            do: "Upload it and tell us what each column is.",
            expect:
              "We guess the mapping from your headers, and you correct anything we got wrong.",
            watchOut:
              "Check the date and money columns particularly. A date read as month-day when it's day-month will quietly ruin donor rhythms.",
          },
          {
            do: "Look at the preview.",
            expect:
              "The first few rows as they'll actually be created, plus a count of anything we'd skip and why.",
            watchOut:
              "This is a dry run — nothing has been written yet. Read the skipped rows; they usually reveal a mapping mistake rather than bad data.",
          },
          {
            do: "Import.",
            expect: "A summary of what was created, updated, and skipped.",
          },
        ],
      },
      {
        heading: "How duplicates are handled",
        body: [
          "People are matched by email. An import row matching an existing person updates that record and merges the role rather than creating a second one — which is what makes it safe to import donors and volunteers as separate files even when they're the same people.",
          "Rows without an email are always created new, because there's no reliable way to tell two people named J. Smith apart. If your export has emails, include them.",
          "Running the same file twice does not double your data. The second run updates rather than duplicates.",
        ],
        callout: {
          tone: "note",
          title: "Import people first",
          body: "Then donations, then inventory. That order lets donations attach to the right people, and items attach to the right donations. Done the other way round you get orphans.",
        },
      },
      {
        heading: "The columns that don't map",
        body: [
          "Every system has fields ThriftOS doesn't. Loyalty points, internal status codes, a custom field somebody added in 2019. These aren't lost — anything unmapped can be dropped into the notes field on the record, which keeps it findable without pretending we understand it.",
          "The one thing to decide deliberately is item condition. Systems grade differently, and a mechanical mapping from someone else's scale to ours will be wrong somewhere. The mapping screen lets you set it explicitly.",
        ],
      },
      {
        heading: "Colour tags on imported stock",
        body: [
          "Imported items need an intake date, because that's what drives markdowns. If your export has one, map it — your existing aged stock then arrives already correctly marked down, which is usually what you want.",
          "If there's no date in the export, everything imports as arriving today and starts the rotation fresh. That's a real decision: it means stock that's been on your floor for two months goes back to full price. For most shops the honest fix is to bulk-edit the genuinely old stuff afterwards, or to run a clearance before you migrate.",
        ],
      },
      {
        heading: "Running both systems briefly",
        body: [
          "Plenty of shops run the old and new side by side for a week. That's sensible, as long as you decide which one is authoritative for that week and stick to it — usually the new one for sales, the old one for reference.",
          "What causes pain is entering things in both. Pick one, and re-import at the end if you need to catch up.",
        ],
      },
    ],
    faq: [
      {
        question: "What if the import goes wrong?",
        answer:
          "Every import is recorded as a batch, and a batch can be reversed — it removes exactly the records that import created and leaves everything else alone. Check the preview first, but know the undo exists.",
      },
      {
        question: "Can you do the import for us?",
        answer:
          "Send us your export and we'll look at it. We'd rather help than watch someone give up on a mapping screen at 11pm.",
      },
      {
        question: "Our old system won't export anything useful.",
        answer:
          "Some won't. In that case, most shops start fresh at intake and import only their people list, which is often available even when nothing else is. It's less painful than it sounds — inventory turns over anyway.",
      },
    ],
    related: ["your-first-hour", "logging-your-first-items", "one-list-of-people"],
  },
] as const;
