import type { HelpArticle } from "./types";

/** Intake, inventory, the register, and donations — the daily work. */
export const OPERATIONS_ARTICLES: readonly HelpArticle[] = [
  {
    slug: "logging-your-first-items",
    title: "Logging items in",
    summary:
      "Photograph an item, correct what the guess got wrong, and get it priced and tagged in about twenty seconds.",
    category: "intake",
    audience: ["owner", "manager", "staff", "volunteer"],
    readMinutes: 6,
    updated: "2026-07-26",
    appPath: "/app/intake",
    keywords: ["intake", "photo", "ai", "add item", "sorting", "logging"],
    sections: [
      {
        heading: "How it works",
        body: [
          "Take a photo of the item and the form fills itself in — what it is, category, colour, condition, a price band, and a description you could put online. You then fix whatever's wrong and press save.",
          "That order matters. Correcting is much faster than typing, and it's a job you can hand to someone on their first shift. They don't need to know what a peacoat is worth; they need to notice that the photo shows a stain the guess missed.",
        ],
        callout: {
          tone: "note",
          title: "Nothing saves itself",
          body: "The guess is only ever a draft on your screen. Until you press save, nothing exists. If the guess is nonsense, clear it and type over it.",
        },
      },
      {
        heading: "Taking a photo that works",
        list: [
          "Put the item against a plain background — a table, a wall, a sheet",
          "Get the whole item in frame rather than a detail",
          "Use daylight if you have it; overhead fluorescents make everything look grey",
          "For clothing, lay it flat rather than holding it up",
          "Photograph the label separately if you want the brand read correctly",
        ],
        body: [
          "Donated goods photographed on a folding table in a back room are nothing like catalogue photography, and accuracy suffers accordingly. That's expected. The guess is there to save you typing, not to be right every time.",
        ],
      },
      {
        heading: "How much to trust the guess",
        body: [
          "Each read comes with a confidence: fairly sure, worth a second look, or just a rough guess. Treat those honestly — a low-confidence read on a $4 sweater is fine to accept quickly, and a low-confidence read on something that might be worth $90 deserves a proper look.",
          "Brands and sizes are the fields to check hardest. We instruct the model to leave them blank rather than guess, because an invented brand on a price tag is worse than no brand at all — but check anyway.",
          "Prices are a starting point calibrated for a US thrift shop, which means low. If your neighbourhood supports higher prices, they'll be low for you. Adjust, and your own judgement should always win.",
        ],
      },
      {
        heading: "The fields worth filling in",
        body: [
          "You can save an item with just a name and a price, and on a busy day you should. But three optional fields pay for themselves later.",
        ],
        table: {
          headers: ["Field", "Why it's worth the two seconds"],
          rows: [
            [
              "Comparable new price",
              "Powers 'value delivered' on your impact report — the difference between what a shopper paid and what the thing costs new. Without it, that item contributes nothing to the number.",
            ],
            [
              "Weight",
              "Powers landfill diversion, the figure grant officers understand fastest. A rough estimate is fine; record the method somewhere.",
            ],
            [
              "Anything wrong with it",
              "A shopper surprised by a stain at home stops trusting the shop. Two seconds here is worth a great deal.",
            ],
          ],
        },
      },
      {
        heading: "Working through a backlog",
        body: [
          "Sort before you log. Three piles: standard stock that gets a category price and ten seconds, things worth a look, and things somebody knowledgeable needs to see. Log the first pile fast without agonising — the colour-tag rotation will correct anything you price too high within a few weeks, so being ten percent wrong on a sweater costs nothing and deciding for five minutes costs real time.",
          "If the backroom is filling faster than the floor clears, the Compass will mention it. That's usually a signal to run a fill-a-bag day or find a bulk buyer rather than to log faster.",
        ],
      },
    ],
    faq: [
      {
        question: "What if photo reading isn't available?",
        answer:
          "The form opens empty and you type. Everything else works identically — this is a supported way to run the shop, not a broken state.",
      },
      {
        question: "Is there a limit on photo reads?",
        answer:
          "Yes, by plan — 100 a month on Volunteer, 1,000 on Core, more above. You'll be told when you reach it, and manual entry continues unaffected.",
      },
      {
        question: "Can I log an item without a photo?",
        answer:
          "Yes. Skip the photo and fill the form in. Photos are worth taking for anything going on your online storefront, and skippable for a rack of jeans.",
      },
    ],
    related: ["colour-tags-and-markdowns", "pricing-donated-goods-in-practice", "recording-a-donation"],
  },

  {
    slug: "colour-tags-and-markdowns",
    title: "Colour tags and automatic markdowns",
    summary:
      "How the rotation works, how to set your own schedule, and what to do with stock that reaches the end of it.",
    category: "inventory",
    audience: ["owner", "manager", "staff", "volunteer"],
    readMinutes: 6,
    updated: "2026-07-26",
    appPath: "/app/settings",
    keywords: ["colour tag", "color tag", "markdown", "discount", "rotation", "aged stock"],
    sections: [
      {
        heading: "What the colours do",
        body: [
          "Every item gets a coloured tag on the day it reaches the floor. The colour rotates weekly, and each colour steps down in price as it ages. A volunteer can look at a rack and know what everything costs without checking anything, which on a Saturday matters more than any feature software can offer.",
          "ThriftOS handles the arithmetic. The register always charges today's correct price for a given tag, so nobody has to remember the schedule or work out 50% of $7.50 while a queue forms.",
        ],
      },
      {
        heading: "The default schedule",
        table: {
          headers: ["Colour", "Kicks in after", "Discount"],
          rows: [
            ["Green", "—", "Full price"],
            ["Yellow", "14 days", "25% off"],
            ["Blue", "28 days", "50% off"],
            ["Red", "42 days", "75% off"],
            ["White", "56 days", "90% off"],
          ],
        },
        body: [
          "This is a starting point, not a rule. Change any of it in Settings — the colours, the days, the percentages. Your shop decides; we ship something sensible so it works on day one.",
        ],
      },
      {
        heading: "A discount has to be earned twice",
        body: [
          "An item only gets its discount when it carries a discounted colour and has been on the floor long enough. A blue tag stapled on this morning is still full price, because blue means 'reached the floor in that week', not 'is half price today'.",
          "This catches people out when they re-tag something. If you put a blue tag on a fresh item, it won't discount for four weeks — which is usually what you wanted anyway.",
        ],
      },
      {
        heading: "What to change, and what not to",
        body: [
          "The most common mistake is discounting too slowly. The instinct is to protect margin by holding price, but a garment that hasn't sold in six weeks won't sell in twelve — it's occupying rack space a fresh donation needs, and fresh donations are what bring shoppers back. Space on the floor is your scarce resource, not stock.",
          "Furniture, genuine vintage, and anything with collector value should sit outside the rotation entirely. Leave the tag colour blank on those and price them by hand; they sell to a specific person who may take a month to walk in, and a two-week clock just gives the money away.",
        ],
      },
      {
        heading: "Stock that runs out the rotation",
        body: [
          "When a batch reaches its last markdown without selling, the Compass will say so. At that point you have three reasonable options: a fill-a-bag day, a bulk or rag-out buyer, or the recycling stream. Which one depends on what you have and who you know locally.",
          "What isn't reasonable is leaving it on the rack. It's already told you what it's worth, and the space is needed.",
        ],
      },
    ],
    faq: [
      {
        question: "How many colours should we use?",
        answer:
          "Five or six. Fewer and items age out before they've had a fair run at full price; more and staff can't hold the schedule in their heads.",
      },
      {
        question: "Can I override the price on one item?",
        answer:
          "Yes — edit the item and set the price you want. If you want it permanently outside the rotation, clear its tag colour too.",
      },
      {
        question: "What happens if I change the schedule?",
        answer:
          "It applies immediately to everything on the floor, because the price is worked out from the tag and the intake date rather than stored. Change discounts before opening rather than mid-trade.",
      },
    ],
    related: ["logging-your-first-items", "pricing-donated-goods-in-practice", "ringing-up-a-sale"],
  },

  {
    slug: "pricing-donated-goods-in-practice",
    title: "Pricing donated goods",
    summary:
      "How much attention to give which items, what to charge relative to retail, and why being roughly right fast beats being exactly right slowly.",
    category: "inventory",
    audience: ["owner", "manager", "staff", "volunteer"],
    readMinutes: 5,
    updated: "2026-07-26",
    keywords: ["price", "pricing", "how much", "value", "worth"],
    sections: [
      {
        heading: "Spend time unevenly",
        body: [
          "The biggest pricing mistake is giving every item the same attention. A shop researching a $4 sweater as carefully as a $90 coat is losing money on the sweater — not in margin, but in the hours.",
          "Sort by what something could plausibly be worth, then spend accordingly: ten seconds and a category price for standard stock, a minute and a quick search for recognisable brands and furniture, and set aside anything you can't identify for whoever knows that category.",
        ],
      },
      {
        heading: "Price for the shopper in front of you",
        body: [
          "Online comparables mislead. A coat fetching $60 on a resale marketplace does not fetch $60 on your rack, because your shopper is standing in your shop on a Tuesday comparing it to everything else in the room.",
          "As a rough guide, most clothing sits between a tenth and a quarter of its original retail. Housewares run higher, fast fashion lower, and anything with a visible flaw lower still.",
        ],
      },
      {
        heading: "Be honest in both directions",
        body: [
          "Note the stain, the missing button, the chip on the rim, and price for it. But if something is genuinely excellent — unworn, tags on, a brand people know — say so and charge accordingly. Underpricing good stock is as much a mistake as overpricing tired stock, and it's the more common one in shops staffed by people who feel awkward asking for money.",
        ],
      },
      {
        heading: "Let the rack correct you",
        body: [
          "No pricing decision needs to be right first time. The rotation is self-correcting: anything priced too high finds its level within a few weeks without anyone revisiting it.",
          "Say this to a volunteer agonising over a price. Being ten percent wrong on a four-dollar sweater costs nothing; five minutes of deciding costs something real. Price it, tag it, move to the next box.",
        ],
      },
    ],
    related: ["colour-tags-and-markdowns", "logging-your-first-items"],
  },

  {
    slug: "ringing-up-a-sale",
    title: "Using the register",
    summary:
      "Scanning, manual prices, round-ups, tax exemption, and completing a sale by cash or card.",
    category: "register",
    audience: ["staff", "volunteer", "manager"],
    readMinutes: 5,
    updated: "2026-07-26",
    appPath: "/app/register",
    keywords: ["register", "till", "checkout", "pos", "sale", "scan"],
    sections: [
      {
        heading: "The basic loop",
        steps: [
          {
            do: "Scan the tag, or type part of the item's name into the search box.",
            expect: "Matching items appear with today's price — already marked down if the tag has aged.",
            watchOut:
              "If a struck-through price shows, that's the tag price and the customer pays the lower one. That's correct.",
          },
          {
            do: "Tap the item to add it to the cart.",
            expect: "It appears on the left with its price.",
          },
          {
            do: "For anything without a tag, type the price into the box and press Add.",
            expect: "A line called 'Item' at that price.",
            watchOut:
              "A manual line isn't linked to inventory, so it won't mark anything sold. Use it for genuinely untagged things, not as a shortcut past a scanner that's playing up.",
          },
          {
            do: "Press Cash or Card.",
            expect: "A confirmation and the total. The cart clears, ready for the next customer.",
          },
        ],
      },
      {
        heading: "Round-ups",
        body: [
          "If your shop has round-ups switched on, the register offers to round the total up to the next whole dollar. The customer chooses; it's a checkbox the cashier can untick without any fuss.",
          "Round-ups are recorded separately from merchandise revenue, appear as their own line on the receipt, and carry no platform fee. What you call it and how you treat it for tax is set in Settings and depends on your organisation's status — we don't make a blanket claim about deductibility on your behalf.",
        ],
      },
      {
        heading: "Tax exemption",
        body: [
          "Tick Tax exempt for a customer with a valid certificate, and record the certificate number if your shop keeps them on file. The tax line drops to zero and the sale records that it was exempt, which is what you'll want if anyone ever asks.",
        ],
      },
      {
        heading: "Things that go wrong",
        list: [
          "Item won't come up in search — check it's still marked available; it may already be sold",
          "Price looks wrong — check the tag colour and intake date on the item's record",
          "Card declined — take another card or cash; the item stays on the floor",
          "Offline badge showing — keep selling, take cash, it'll sync itself",
        ],
      },
    ],
    faq: [
      {
        question: "Can I take part cash and part card?",
        answer:
          "Not yet. Today a sale is one tender. If this comes up often for you, tell us — it's a reasonable thing to want.",
      },
      {
        question: "How do I void a sale I just rang up wrong?",
        answer:
          "See the refunds and returns article. A sale that hasn't settled is voided rather than refunded, and the two are recorded differently on purpose.",
      },
    ],
    related: ["refunds-and-returns", "selling-when-the-internet-is-down", "colour-tags-and-markdowns"],
  },

  {
    slug: "refunds-and-returns",
    title: "Refunds, returns, and voids",
    summary:
      "Giving money back, putting an item back on the floor, and the difference between voiding and refunding.",
    category: "register",
    audience: ["manager", "owner", "staff"],
    readMinutes: 5,
    updated: "2026-07-26",
    keywords: ["refund", "return", "void", "exchange", "money back"],
    sections: [
      {
        heading: "Void or refund",
        body: [
          "A void cancels a sale that hasn't settled — you rang it up wrong thirty seconds ago and nothing has really happened yet. A refund gives money back on a sale that completed.",
          "They're recorded separately because they mean different things to your books. A voided sale never happened; a refunded one happened and was reversed. Reports treat them accordingly.",
        ],
      },
      {
        heading: "Refunding",
        steps: [
          { do: "Find the sale in the register history, or look it up from the receipt." },
          { do: "Choose full or partial, and which lines are coming back." },
          {
            do: "Pick what happens to the item.",
            expect: "Back on the floor at its old price, back as a newly inspected item, or not restocked at all.",
            watchOut:
              "Something returned damaged shouldn't go straight back on the rack at the old price. Re-inspecting it is a real option, not a formality.",
          },
          {
            do: "Record a reason.",
            watchOut:
              "This is the field everyone skips and everyone later wishes they hadn't. Three words is plenty.",
          },
        ],
      },
      {
        heading: "Where the money goes",
        body: [
          "A cash sale is refunded in cash from the drawer. A card sale is refunded to the same card — you can't refund a card sale in cash, which protects the shop as much as anyone.",
          "Our platform fee comes back in proportion to what you refunded, and it frees up your monthly fee cap again. Stripe's processing fee follows Stripe's own policy, which we don't control and shouldn't pretend to.",
        ],
      },
      {
        heading: "Permissions",
        body: [
          "Refunds above a threshold you set need a manager. This isn't distrust — it's so a volunteer on their second shift isn't the person deciding whether a $60 refund is reasonable, which is an unfair thing to put on someone.",
        ],
      },
    ],
    related: ["ringing-up-a-sale", "payment-problems", "what-payments-cost"],
  },

  {
    slug: "recording-a-donation",
    title: "Recording a donation",
    summary:
      "Logging what came in, attaching it to a donor, and why the weight field earns its keep.",
    category: "donations",
    audience: ["staff", "volunteer", "manager"],
    readMinutes: 4,
    updated: "2026-07-26",
    appPath: "/app/donations",
    keywords: ["donation", "drop off", "donor", "intake", "goods"],
    sections: [
      {
        heading: "The counter version",
        body: [
          "Someone brings bags in. Get a name and an email if they'll give you one, write a sentence about what it is, and note roughly how many items and how much it weighs. That's the whole job at the counter — thirty seconds.",
          "If they'd rather not give a name, that's completely fine. Leave it blank and record the donation anonymously. Plenty of people don't want to be on a list, and pushing costs you more than the record is worth.",
        ],
      },
      {
        heading: "Why weight matters",
        body: [
          "Weight is what turns your donation log into a landfill diversion figure, and diversion is the number grant officers understand fastest. You don't need scales — per-category averages are fine and defensible. A bag of clothing runs 15 to 20 pounds; most housewares are 1 to 3 pounds each.",
          "Write down whichever method you use and stick to it. A number with a stated method survives scrutiny; one that appeared from nowhere doesn't.",
        ],
      },
      {
        heading: "Goods, or cash",
        body: [
          "A donation is one or the other, and the difference matters. For goods you record a description, a rough item count, and a weight; for cash you record an amount in dollars and cents. The receipt that comes out is worded differently in each case, because a cash gift can carry a stated amount and a bag of coats cannot.",
          "If someone hands you both — a box of books and a twenty — record them as two donations. It takes ten seconds longer and produces a receipt that's actually correct, rather than one that implies you valued the books at twenty dollars.",
        ],
      },
      {
        heading: "The things people get wrong",
        list: [
          "Recording the date you sorted the bags rather than the day they arrived. The donor's date is the one that belongs on the receipt.",
          "Guessing an email rather than leaving it blank. A wrong address is worse than none — it silently fails, and the donor thinks you never thanked them.",
          "Logging a van-load as one donation with no description. In six months nobody will remember what it was, including you.",
          "Recording refused items. If you turned it away, it isn't a donation and it didn't divert anything.",
        ],
      },
      {
        heading: "What happens next",
        body: [
          "Recording a donor creates or updates their record automatically — you never hand-enter someone the system has already seen. If they've shopped or volunteered before, this attaches to the same person rather than making a second one.",
          "From there you can issue a receipt in one click, and the Compass will notice if a regular donor goes unusually quiet. It compares each donor against their own rhythm rather than against other donors, so someone who has always come twice a year isn't flagged for behaving exactly as they always have.",
        ],
      },
      {
        heading: "Donations that arrive without a person",
        body: [
          "Doorstep drop-offs, overnight bags, and anything left while you were closed all still count. Record them anonymously with the date you found them — the weight still feeds your diversion figure, which is the part that matters for reporting.",
          "It's worth keeping these separate in your description, because a shop with a lot of them usually has an access problem worth solving rather than a donor base worth cultivating.",
        ],
      },
    ],
    faq: [
      {
        question: "Do I have to weigh anything?",
        answer:
          "No. Per-category averages are fine as long as you use them consistently and can say what they are. Scales are a nice-to-have, not a requirement.",
      },
      {
        question: "Someone wants their donation recorded under their business name.",
        answer:
          "Record the business as the contact and put the individual's name in the notes. The receipt then names the entity that actually made the gift, which is what their accountant needs.",
      },
    ],
    related: ["donation-receipts", "one-list-of-people", "impact-reporting"],
  },

  {
    slug: "donation-receipts",
    title: "Donation receipts, done correctly",
    summary:
      "What a US charity must put on an acknowledgement, what it must never put on one, and how to stop January being a scramble.",
    category: "donations",
    audience: ["owner", "manager"],
    readMinutes: 6,
    updated: "2026-07-26",
    appPath: "/app/donations",
    keywords: ["receipt", "acknowledgement", "irs", "tax", "deduction", "501c3"],
    sections: [
      {
        heading: "The rule that trips everyone up",
        body: [
          "You describe what you received. You do not say what it was worth.",
          "Valuing donated goods is the donor's responsibility, and a charity that writes a number on a bag of clothes has done that donor no favours at all — a deduction claimed on a figure the charity supplied leaves them in a considerably worse position than one they determined themselves.",
          "This feels unhelpful the first few times you explain it at the counter. It isn't. ThriftOS won't let you put a value on donated goods, and that's deliberate.",
        ],
        callout: {
          tone: "warn",
          title: "What to say at the counter",
          body: "\"We can describe exactly what you gave us, but we're not allowed to put a value on it — that's between you and whoever does your taxes.\" People accept this readily when it's explained as a rule rather than a refusal.",
        },
      },
      {
        heading: "What goes on the acknowledgement",
        list: [
          "Your organisation's name",
          "The date the donation was received",
          "A reasonably detailed description of what was donated",
          "A statement that no goods or services were provided in exchange",
        ],
        body: [
          "ThriftOS puts all four on every receipt automatically, including the required language, which is the part people most often get wrong or omit. Your EIN and legal name come from Settings — fill those in before issuing your first receipt.",
        ],
      },
      {
        heading: "Thresholds worth knowing",
        body: [
          "Donors need a written acknowledgement from the charity for any single contribution of $250 or more. Above $500 they file extra paperwork, and above $5,000 a qualified appraisal generally enters the picture. None of that is your job, but knowing it lets you answer kindly rather than blankly.",
          "Issuing a receipt for every donation regardless is easier than tracking the threshold, and donors appreciate it.",
        ],
        callout: {
          tone: "note",
          title: "This is a summary, not tax advice",
          body: "Rules change and circumstances differ. For anything beyond the acknowledgement itself, point donors at their own adviser.",
        },
      },
      {
        heading: "Don't let it pile up",
        body: [
          "Issue receipts as donations arrive. A donor who gets a warm acknowledgement within a day or two is markedly more likely to come back, and the thank-you matters more than the tax document to most people.",
          "If receipts do start stacking up, the Compass will mention it once there are a few outstanding and the oldest has been waiting a fortnight. It's a far easier job in March than in the week before a filing deadline.",
        ],
      },
    ],
    faq: [
      {
        question: "A donor is insisting we write a value. What do we do?",
        answer:
          "Politely decline and explain why — it protects them, not us. Offer a detailed description instead, which is what their adviser actually needs.",
      },
      {
        question: "We gave the donor something in return. Does that change things?",
        answer:
          "Yes. The acknowledgement must describe it and give a good-faith estimate of its value so the donor can subtract it. If you run donor thank-you gifts, get advice on how to word it.",
      },
      {
        question: "Can I resend a receipt?",
        answer:
          "Yes, from the donation's record. The receipt number stays the same — reissuing isn't creating a second one.",
      },
    ],
    related: ["recording-a-donation", "shop-details-and-team"],
  },
] as const;
