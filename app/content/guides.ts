/**
 * The guides registry — the organic-traffic flywheel.
 *
 * A typed registry rather than a CMS, so the sitemap, llms.txt, and internal
 * links all generate from the same source and can never go stale. Tests pin
 * slug uniqueness, link validity, and depth.
 *
 * These are written to be genuinely useful to someone running a thrift shop
 * whether or not they ever buy anything. That is the entire strategy.
 */

export interface GuideBlock {
  heading?: string;
  paragraphs: string[];
  list?: string[];
}

export interface Guide {
  slug: string;
  title: string;
  h1: string;
  description: string;
  category: "Running a shop" | "Donations" | "Pricing" | "Volunteers" | "Impact" | "Comparisons";
  published: string;
  blocks: GuideBlock[];
  faq: { question: string; answer: string }[];
  related: string[];
  cta: string;
}

export const GUIDES: readonly Guide[] = [
  {
    slug: "color-tag-markdown-system",
    title: "How the colour-tag markdown system actually works",
    h1: "The colour-tag system, explained properly",
    description:
      "Why thrift stores tag by colour, how to pick a rotation and discount schedule, and the mistakes that quietly cost shops money.",
    category: "Pricing",
    published: "2026-07-01",
    blocks: [
      {
        paragraphs: [
          "Almost every thrift store of any size prices by colour. An item gets a coloured tag on the day it reaches the floor, the colour rotates weekly, and each colour steps down in price as it ages. It is a system invented for a world without computers, and it survives because it is genuinely excellent.",
          "The reason is simple: a volunteer can look at a rack and know what everything costs without checking anything. No lookup, no memory, no asking. On a Saturday with three people working and forty shoppers, that matters more than any feature a piece of software can offer.",
        ],
      },
      {
        heading: "Picking a rotation",
        paragraphs: [
          "Most shops run five or six colours. Fewer than four and items age out before they've had a fair run at full price; more than seven and staff stop being able to hold the schedule in their heads.",
          "A common shape looks like this:",
        ],
        list: [
          "Weeks 1–2: full price",
          "Weeks 3–4: 25% off",
          "Weeks 5–6: 50% off",
          "Weeks 7–8: 75% off",
          "Week 9 onward: 90% off, or pulled entirely",
        ],
      },
      {
        heading: "The mistake almost everyone makes",
        paragraphs: [
          "Shops discount too slowly. The instinct is to protect margin by holding price, but a garment that doesn't sell in six weeks is not going to sell in twelve — it is occupying rack space that a fresh donation needs, and fresh donations are what bring shoppers back.",
          "The shops that do best treat the rotation as a conveyor belt rather than a safety net. Space on the floor is the scarce resource, not inventory. Donations are the one thing a thrift store never runs short of.",
        ],
      },
      {
        heading: "When to break the rotation",
        paragraphs: [
          "Furniture, genuine vintage, and anything with real collector value should sit outside the colour system entirely. These sell to a specific person who may not walk in for a month, and marking them down on a two-week clock simply gives away money.",
          "Everything else — clothing, housewares, books, toys — belongs on the belt.",
        ],
      },
    ],
    faq: [
      {
        question: "How many colours should we use?",
        answer:
          "Five or six works for most shops. Fewer and items age out too fast; more and staff can't remember the schedule.",
      },
      {
        question: "Should furniture go on the colour rotation?",
        answer:
          "Usually not. Furniture and genuine vintage sell to a specific buyer who may take weeks to appear, and a two-week markdown clock just gives away the margin.",
      },
      {
        question: "What do we do with items that reach the last markdown?",
        answer:
          "Most shops either pull them for a bulk or rag-out buyer, or run a fill-a-bag day. Either clears floor space, which is the actual goal.",
      },
    ],
    related: ["pricing-donated-goods", "thrift-store-inventory-basics"],
    cta: "ThriftOS applies your rotation automatically — the register always knows today's price.",
  },
  {
    slug: "donation-receipts-irs-rules",
    title: "Donation receipts: what a thrift store may and may not say",
    h1: "Donation receipts without getting it wrong",
    description:
      "What a US charity must include on a donation acknowledgement, why you should never state a value for donated goods, and how to keep receipts painless.",
    category: "Donations",
    published: "2026-07-02",
    blocks: [
      {
        paragraphs: [
          "This is the part of running a shop that most people get slightly wrong, usually by being too helpful.",
          "The short version: you describe what you received. You do not say what it was worth. Valuing donated goods is the donor's responsibility, and a charity that puts a number on a bag of clothes has done the donor no favours at all.",
        ],
      },
      {
        heading: "What belongs on the acknowledgement",
        paragraphs: ["A written acknowledgement for donated goods should carry:"],
        list: [
          "Your organisation's name",
          "The date the donation was received",
          "A reasonably detailed description of what was donated",
          "A statement that no goods or services were provided in exchange — or, if something was, a description and good-faith estimate of its value",
        ],
      },
      {
        heading: "What must not be on it",
        paragraphs: [
          "A dollar value for donated goods. Not an estimate, not a range, not a 'for your convenience' figure. The determination is the donor's to make with their tax adviser.",
          "This feels unhelpful the first few times you explain it at the counter. It isn't. A donor who claims a deduction based on a number the charity supplied is in a considerably worse position than one who made their own reasonable determination.",
        ],
      },
      {
        heading: "Thresholds worth knowing",
        paragraphs: [
          "Donors need a written acknowledgement from the charity for any single contribution of $250 or more. Above $500 they file additional paperwork, and above $5,000 a qualified appraisal generally enters the picture. None of that is your job — but knowing it helps you answer the question kindly rather than blankly.",
          "Rules change, and this is a summary rather than tax advice. Point donors to their own adviser for anything beyond the acknowledgement itself.",
        ],
      },
      {
        heading: "The practical advice",
        paragraphs: [
          "Issue receipts as donations arrive, not in a January scramble. A donor who receives a warm acknowledgement within a day or two is markedly more likely to come back — and the thank-you matters more than the tax document for most people.",
        ],
      },
    ],
    faq: [
      {
        question: "Can we tell a donor what their donation is worth?",
        answer:
          "No. Describe what you received and let the donor determine value with their tax adviser. A charity stating a value is exactly what the IRS asks charities not to do.",
      },
      {
        question: "When does a donor need a written acknowledgement?",
        answer:
          "For any single contribution of $250 or more. Issuing one for every donation is easier than tracking the threshold, and donors appreciate it.",
      },
      {
        question: "What if we gave the donor something in return?",
        answer:
          "Then the acknowledgement must describe it and give a good-faith estimate of its value, so the donor can subtract it from their deduction.",
      },
    ],
    related: ["thrift-store-donor-relationships", "color-tag-markdown-system"],
    cta: "ThriftOS issues compliant receipts in one click, with the required language already in place.",
  },
  {
    slug: "pricing-donated-goods",
    title: "Pricing donated goods without a spreadsheet",
    h1: "How to price donated goods",
    description:
      "A practical approach to pricing thrift inventory: what to check, what to ignore, and when to spend time on an item.",
    category: "Pricing",
    published: "2026-07-03",
    blocks: [
      {
        paragraphs: [
          "The single biggest pricing mistake in thrift retail is spending equal time on every item. A shop that researches a $4 sweater as carefully as a $90 coat is losing money on the sweater — not in margin, but in the hours it took.",
          "Sort by what an item could plausibly be worth, then spend time accordingly.",
        ],
      },
      {
        heading: "The three-pile method",
        paragraphs: ["Most incoming goods fall into three piles, and each deserves a different amount of attention:"],
        list: [
          "Standard stock — clothing, housewares, books. Price by category with a fixed table. Ten seconds an item, no research.",
          "Worth a look — recognisable brands, solid wood furniture, anything unusual. Sixty seconds and a quick search.",
          "Stop and think — genuine vintage, collectibles, anything you can't identify. Set it aside for whoever knows the category.",
        ],
      },
      {
        heading: "Price for the shopper you actually have",
        paragraphs: [
          "Online comparables mislead. A coat that fetches $60 on a resale marketplace does not fetch $60 on your rack, because your shopper is standing in your shop on a Tuesday and comparing it to everything else in front of them.",
          "A useful rule: most clothing prices somewhere between a tenth and a quarter of its original retail. Housewares run higher, fast fashion runs lower, and anything with a visible flaw runs lower still.",
        ],
      },
      {
        heading: "Be honest about flaws",
        paragraphs: [
          "Note the stain, the missing button, the chip on the rim — and price accordingly. A shopper surprised at home by a flaw they didn't see is a shopper who stops trusting the shop. That trust is worth far more than the two dollars.",
          "The same applies in reverse. If something is genuinely excellent — unworn, tags still attached, a brand people know — say so and price it accordingly. Underpricing good stock is just as much a mistake as overpricing tired stock, and it is the more common one in shops staffed by people who feel awkward asking for money.",
        ],
      },
      {
        heading: "Let the rack tell you when you were wrong",
        paragraphs: [
          "No pricing decision needs to be right the first time. The colour-tag rotation is a self-correcting mechanism: anything priced too high finds its level within a few weeks without anyone re-examining it.",
          "This is worth saying to a volunteer who is agonising over a price. The cost of being ten percent wrong on a four-dollar sweater is nothing, and the cost of spending five minutes deciding is real. Price it, tag it, and move on to the next box.",
        ],
      },
    ],
    faq: [
      {
        question: "How much should we charge relative to retail?",
        answer:
          "Most clothing sits between 10% and 25% of original retail. Housewares run a bit higher, fast fashion lower, and anything with a visible flaw lower still.",
      },
      {
        question: "Should we check online prices for every item?",
        answer:
          "No. Research is worth it for recognisable brands, furniture, and genuine vintage. For standard stock a fixed category table is faster and just as accurate.",
      },
    ],
    related: ["color-tag-markdown-system", "thrift-store-inventory-basics"],
    cta: "ThriftOS suggests a price band from a photo — you correct it rather than start from nothing.",
  },
  {
    slug: "thrift-store-inventory-basics",
    title: "Inventory for shops where every item is one of a kind",
    h1: "Unique-item inventory, without the overhead",
    description:
      "Why conventional retail inventory software fits thrift stores badly, and what to track instead.",
    category: "Running a shop",
    published: "2026-07-04",
    blocks: [
      {
        paragraphs: [
          "Conventional retail software assumes SKUs: many identical units of the same product, tracked as a count. A thrift store has the opposite problem. Every item is one of one, arrives unannounced, and will never be reordered.",
          "This is why so many shops end up running a point-of-sale system that fights them daily — the software wants a product catalogue, and there isn't one.",
        ],
      },
      {
        heading: "What's worth tracking",
        paragraphs: ["Not everything needs a record. In practice these earn their keep:"],
        list: [
          "The date it reached the floor — this drives every markdown decision",
          "Category, so you can see what's selling and what's piling up",
          "Condition and any flaws, honestly noted",
          "Weight, if you want diversion figures for grant reporting",
          "Who donated it, when they told you",
        ],
      },
      {
        heading: "What isn't",
        paragraphs: [
          "Per-item photography for the sales floor, exhaustive measurements, or a full description for anything that isn't going online. That effort only pays for itself on items you're listing for sale online — for floor stock it is time taken from sorting, which is where the actual bottleneck usually is.",
          "Nor is a running valuation of unsold stock worth maintaining. In conventional retail, inventory on hand is an asset worth knowing precisely. In a thrift store it arrived free, will be marked down on a fixed schedule regardless, and any figure you assign it is a guess that ages badly. What matters is how fast it moves, not what it is notionally worth today.",
        ],
      },
      {
        heading: "Track the flow, not the stock",
        paragraphs: [
          "The most useful number in a thrift store is not how many items are on the floor — it is the relationship between what came in this week and what went out. A shop taking in sixty items a week and selling twenty has a problem that no amount of careful cataloguing will fix, and one that a stock count alone will never show.",
          "Watch that ratio over a month and the decisions make themselves: when to run a fill-a-bag day, when to find a bulk buyer, when to be more selective about what you accept at the door. Saying no to a truck of unsellable goods is a legitimate inventory decision, and shops that never do it end up storing other people's rubbish at their own expense.",
        ],
      },
      {
        heading: "Multiple locations change the question",
        paragraphs: [
          "Once a second location exists, the useful capability is transfer rather than tracking. Stock that has stalled in one shop often sells quickly in another with a different neighbourhood around it, and moving it is far better than marking it to nothing.",
          "That is the point at which per-item records genuinely start earning their keep: you need to know what an item is and how long it has been around before you can decide it belongs somewhere else.",
        ],
      },
    ],
    faq: [
      {
        question: "Do we need a barcode on every item?",
        answer:
          "Not necessarily. A tag number is enough for lookup, and the colour tag alone handles pricing. Barcodes help most at higher volumes or across multiple locations.",
      },
      {
        question: "Should we photograph everything?",
        answer:
          "Only what you'll list online. For floor stock the time is better spent sorting, which is usually the real bottleneck.",
      },
    ],
    related: ["color-tag-markdown-system", "measuring-thrift-store-impact"],
    cta: "ThriftOS is built for unique items — no SKUs, no product catalogue to maintain.",
  },
  {
    slug: "measuring-thrift-store-impact",
    title: "Measuring what a thrift store is actually for",
    h1: "Impact reporting that isn't invented the night before",
    description:
      "How to track landfill diversion, value delivered, and volunteer hours as a by-product of running the shop rather than a separate chore.",
    category: "Impact",
    published: "2026-07-05",
    blocks: [
      {
        paragraphs: [
          "Most impact reports are assembled in a panic before a board meeting, from records that were never designed to answer the question. The numbers end up being estimates of estimates, and everyone privately knows it.",
          "The fix is structural: derive impact from the records you already keep to run the shop, so the report is a query rather than a project.",
        ],
      },
      {
        heading: "Landfill diversion",
        paragraphs: [
          "Weight kept out of a landfill is the figure grant officers understand fastest. It needs one extra field — approximate weight, either per item or per donation — and after that it adds itself up.",
          "Count what actually left the building for reuse: sold, transferred, or passed to a recycler. Stock still sitting on the floor has not been diverted yet, and counting it is the kind of flattery that gets noticed.",
        ],
      },
      {
        heading: "Value delivered to shoppers",
        paragraphs: [
          "This is the quiet half of what a thrift store does, and almost nobody measures it: the difference between what goods would have cost new and what people actually paid.",
          "It requires recording a comparable retail figure at intake. Where none was recorded, the honest thing is to count zero rather than estimate — a report that survives scrutiny is worth more than a bigger number that doesn't.",
        ],
      },
      {
        heading: "Volunteer hours",
        paragraphs: [
          "Log hours as shifts complete, not monthly from memory. If you want a dollar figure, Independent Sector publishes a national estimated value of a volunteer hour — cite it as an external reference rather than presenting it as your own claim.",
          "Record headcount alongside hours. Two thousand hours from six people and two thousand from ninety describe very different organisations, and a funder reading only the total learns almost nothing about which one you are.",
        ],
      },
      {
        heading: "Say what each number actually is",
        paragraphs: [
          "The habit that makes a report survive scrutiny is stating the method beside the figure. Weight estimated by category average, not weighed. Value delivered counted only where a retail comparison was recorded. Hours logged per shift rather than reconstructed.",
          "This feels like undercutting your own case. It does the opposite. A grant officer who has read a hundred impact reports can tell the difference between a number with a method attached and a number that appeared from nowhere, and the first one is the one they can defend to their own board.",
          "It also protects you the following year, when someone asks how last year's figure was arrived at and everyone who knew has moved on.",
        ],
      },
    ],
    faq: [
      {
        question: "How do we estimate weight without weighing everything?",
        answer:
          "Per-category averages are fine and defensible. A bag of clothing runs 15–20 lbs; most housewares are 1–3 lbs each. Record the method alongside the number.",
      },
      {
        question: "Is it fair to count volunteer hours in dollars?",
        answer:
          "Yes, if you attribute the rate. Independent Sector's national figure is widely accepted — cite it rather than presenting the conversion as your own valuation.",
      },
    ],
    related: ["thrift-store-inventory-basics", "donation-receipts-irs-rules"],
    cta: "ThriftOS computes these from the same records that run your register.",
  },
  {
    slug: "thrift-store-donor-relationships",
    title: "Keeping donors without a fundraising department",
    h1: "Donor relationships for shops that don't have a development team",
    description:
      "Practical ways a small thrift store can keep donors coming back, using only what it already knows.",
    category: "Donations",
    published: "2026-07-06",
    blocks: [
      {
        paragraphs: [
          "A thrift store's donors are not the same as a charity's donors, and treating them like a mailing list is the fastest way to lose them. They're usually neighbours clearing a closet, and what keeps them coming back is being treated like a person rather than a source.",
        ],
      },
      {
        heading: "The first thank-you is the one that counts",
        paragraphs: [
          "A first-time donor who hears something back within a day or two is dramatically more likely to return. One that hears nothing usually assumes the drop-off vanished into a void, because from where they stand it did.",
          "It doesn't need to be elaborate. A short note that names what they brought does more than a designed newsletter.",
        ],
      },
      {
        heading: "Notice rhythms, not schedules",
        paragraphs: [
          "People who donate regularly have their own rhythm — some seasonal, some monthly, some tied to a spring clear-out. The useful thing to notice is when someone's own pattern breaks, not whether they match a schedule you invented.",
          "And when you do notice, the right response is a friendly hello, not a solicitation. There are a hundred good reasons someone has been quiet, and most of them are none of your business.",
        ],
      },
      {
        heading: "Close the loop",
        paragraphs: [
          "The single most underused thing a thrift store can say to a donor: your things found a home. Not a receipt, not an appeal — just the fact that the coat they dropped off is now being worn by someone who needed it.",
          "Almost nobody does this, and it lands harder than anything else you could send.",
          "You don't need permission or a system to start. The next time something distinctive comes in and sells the same week, tell whoever brought it. One sentence is enough.",
        ],
      },
      {
        heading: "Keep the list small and the roles honest",
        paragraphs: [
          "A shop with four hundred names it never contacts is in better shape than one with four thousand it emails monthly. The second has trained most of those people to ignore it, and unsubscribes are the visible part of a much larger silent tuning-out.",
          "It helps to remember that the same person often occupies several roles at once. Someone who drops off bags every spring may also shop every week and cover the register when you are short-handed. Treating them as three separate entries in three separate systems is how a shop ends up thanking someone for a donation the same week it sent them a volunteer recruitment appeal and a sale flyer.",
        ],
      },
      {
        heading: "When someone stops coming",
        paragraphs: [
          "People stop for ordinary reasons: they finished the clear-out, they moved, they got ill, life got busy. Very few of them stopped because of anything the shop did, and treating a gap as a problem to be solved usually reads as pressure.",
          "The response that works is the smallest one — a note that says you noticed and hope they are well, with nothing asked for. Some will come back. Some won't, and that is a perfectly acceptable outcome for a relationship that was always voluntary.",
        ],
      },
    ],
    faq: [
      {
        question: "How often should we contact donors?",
        answer:
          "Rarely, and with something worth reading. A thank-you after a donation and an occasional note about what their things became beats a monthly newsletter.",
      },
      {
        question: "Should we ask donors for money?",
        answer:
          "Carefully, if at all. Most goods donors don't think of themselves as financial donors, and asking too early can lose you both.",
      },
    ],
    related: ["donation-receipts-irs-rules", "measuring-thrift-store-impact"],
    cta: "ThriftOS notices when a donor's own rhythm changes — and never contacts anyone for you.",
  },
  {
    slug: "thrift-store-software-comparison",
    title: "ThriftOS compared with the other thrift store systems",
    h1: "An honest comparison of thrift store software",
    description:
      "Where ThriftOS fits against ThriftCart, ThriftTrac, KORONA, and general-purpose retail POS — including where they're the better choice.",
    category: "Comparisons",
    published: "2026-07-07",
    blocks: [
      {
        paragraphs: [
          "We'd rather you chose the right thing than chose us. Here is where each option genuinely wins.",
        ],
      },
      {
        heading: "Where the established systems are better",
        paragraphs: [
          "ThriftCart and ThriftTrac have been doing this for years and it shows. If you run a large operation with complex e-commerce, established wholesale relationships, or specific integrations you already depend on, they are mature in ways a newer product is not. They also have support teams who have seen your exact problem before.",
          "KORONA and conventional retail POS deployments are strong if your store is closer to conventional retail — consistent stock, real SKUs, standard reordering. Their inventory model will fight you less than it fights a pure donation-driven shop.",
          "If you already run a system your staff know and it works, switching costs are real and rarely worth it for a feature list.",
        ],
      },
      {
        heading: "Where ThriftOS is different",
        paragraphs: [
          "Three things, honestly:",
        ],
        list: [
          "Donation, volunteer, and donor records are the core of the data model rather than modules bolted onto a retail system. In practice that means the same person can be a donor, a volunteer, and a shopper without being three records.",
          "Impact reporting — diversion weight, value delivered, volunteer hours — is derived from the records that run the register, so it isn't assembled from scratch before a board meeting.",
          "Local autonomy is architectural. Stores in a federation share only what they explicitly turn on, per resource type, and can revoke it without leaving.",
        ],
      },
      {
        heading: "Where we're weaker",
        paragraphs: [
          "We're newer, so there is less accumulated support knowledge and fewer third-party integrations. Our e-commerce is basic next to a mature storefront product. We don't have hardware partnerships or an installer network.",
          "If any of that is load-bearing for you, buy the thing that has it.",
        ],
      },
    ],
    faq: [
      {
        question: "Can we import our existing inventory?",
        answer:
          "Yes, via CSV. Whether it's worth it depends on how much of your stock will still be on the floor in six weeks — for many shops, starting fresh at intake is less work.",
      },
      {
        question: "What if we outgrow the entry plan?",
        answer:
          "The entry plan is per-sale and caps at the flat plan's price, so a busy month simply costs what the next tier costs. There's no cliff to fall off.",
      },
    ],
    related: ["thrift-store-inventory-basics", "color-tag-markdown-system"],
    cta: "Look around the demo shop before deciding anything.",
  },
] as const;

export function getGuide(slug: string): Guide | undefined {
  return GUIDES.find((g) => g.slug === slug);
}

export const GUIDE_CATEGORIES = [...new Set(GUIDES.map((g) => g.category))];
