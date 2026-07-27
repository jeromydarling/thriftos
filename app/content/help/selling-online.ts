import type { HelpArticle } from "./types";

/**
 * Selling online, for a shop that already sells over a counter.
 *
 * The through-line in all of these: it is the same stock, at the same price,
 * with the same till. Online selling here is not a second shop to run — it is
 * a second door into the one you already have. Everything that would otherwise
 * need reconciling (stock counts, prices, takings) is shared rather than
 * synchronised, because a synchronised thing is a thing that drifts.
 */
export const ONLINE_ARTICLES: readonly HelpArticle[] = [
  {
    slug: "selling-online",
    title: "Turning on online selling",
    summary:
      "One switch, one requirement, and the handful of things that change about a shop's day once shoppers can buy from your pages.",
    category: "selling-online",
    audience: ["owner", "manager"],
    readMinutes: 6,
    updated: "2026-07-26",
    appPath: "/app/settings",
    keywords: ["online", "ecommerce", "web shop", "sell online", "buy button", "storefront"],
    sections: [
      {
        heading: "What the switch actually does",
        body: [
          "Settings → Selling online adds a buy button to the items already on your website. It does not create a second shop, a second stock list, or a second set of prices. Everything a shopper sees online is a row in the same inventory a volunteer sees on the tablet behind the counter, at whatever price your colour-tag ladder has it at today.",
          "That is the whole design. A great many shops that sell in two places spend their week reconciling the two, and the reconciling is where the mistakes live — an item marked down in the shop but not online, a coat sold on Saturday and still listed on Monday. There is nothing to reconcile here because there is only one record.",
        ],
        callout: {
          tone: "note",
          title: "Your website is already there",
          body: "Your public pages exist whether or not you sell online. The switch decides whether there is a buy button on them, not whether the pages are visible.",
        },
      },
      {
        heading: "The one requirement",
        body: [
          "Stripe has to be connected, and it has to be able to take charges. Until it is, the buy button stays hidden rather than appearing and leading somewhere that can't take money. You will see this reflected in Settings: the switch will be on and the button still won't show.",
          "This is deliberate. A shopper who fills a basket, types their address, and then hits a payment page that errors is a shopper you have lost, and they will not tell you why. Better that they see a shop with no buy button and ring you.",
        ],
        steps: [
          { do: "Open Settings → Taking payments and connect Stripe.", expect: "The panel says card payments are set up." },
          { do: "Open Settings → Selling online and tick 'Sell online'.", expect: "The postage and collection options below become relevant." },
          {
            do: "Open your own shop page and look for a price with a buy button under it.",
            watchOut:
              "No button usually means Stripe isn't finished, not that the switch didn't save. Check the payments panel first.",
          },
        ],
      },
      {
        heading: "Same price everywhere",
        body: [
          "An item costs the same online as it does on the shelf, including the markdown its tag colour has earned it. There is no online price field, and that is on purpose: two prices for one object is a second thing to maintain and a first-class way to have an argument at the counter with somebody holding a phone.",
          "If you want something cheaper online, mark it down — it will be cheaper in both places, which is almost always what you actually meant.",
        ],
      },
      {
        heading: "What changes about your day",
        list: [
          "Items sold online disappear from the shop floor listing straight away, because they are the same record.",
          "An item somebody is part-way through paying for is held for half an hour, then released if they don't finish.",
          "A new screen, Orders, collects anything paid for and waiting to be found. Nothing appears there until the money has actually cleared.",
          "Nobody needs a login to buy from you. There are no shopper accounts, no passwords to reset, and no customer database to look after.",
        ],
        body: [
          "That last one is worth dwelling on. Guest checkout only is a deliberate limitation: an account system is a thing to secure, a thing to support, and a reason for somebody to abandon a basket. For a shop selling one-of-a-kind items that people buy once, there is very little an account would earn.",
        ],
      },
      {
        heading: "Selling the same item in two places",
        body: [
          "The honest answer is that it can happen: somebody can be at the counter with a jumper at the same moment somebody online is paying for it. The window is small, because an online shopper holds the item from the moment they start paying, and the counter will refuse to sell something that is held.",
          "It is not zero, though, and the fix is not technical. If you take the jumper to the till and ring it up, the online sale can't complete. If you sell it out of a back room without ringing it up, nothing anywhere knows. Ringing up everything is the same discipline that makes your stock figures true; online selling just raises the stakes slightly.",
        ],
        callout: {
          tone: "warn",
          title: "If it does happen",
          body: "Refund the online buyer from the Orders screen with a note saying what happened. It refunds them immediately and tells them which item it was. Most people are entirely reasonable about a charity shop selling the last one in the shop.",
        },
      },
    ],
    faq: [
      {
        question: "Can I sell only some of my items online?",
        answer:
          "Not per item, yet. Everything available and priced is buyable. If something shouldn't be sold online, the reliable way today is to hold it back from the floor entirely.",
      },
      {
        question: "Do I need a separate Stripe account for online sales?",
        answer:
          "No. It is the same connected account as the counter, at the same fee, paid out on the same schedule. Online and in-person takings land in one place.",
      },
      {
        question: "What if I turn it off again?",
        answer:
          "The buy button disappears and your pages stay exactly as they were. Any order already paid for still needs fulfilling, and stays on the Orders screen.",
      },
    ],
    related: ["postage-and-collection", "online-orders", "product-photographs"],
  },

  {
    slug: "postage-and-collection",
    title: "Postage bands and collection in the shop",
    summary:
      "Price postage by weight in three or four bands, or let people pay online and pick up at the counter and post nothing at all.",
    category: "selling-online",
    audience: ["owner", "manager", "staff"],
    readMinutes: 6,
    updated: "2026-07-26",
    appPath: "/app/settings",
    keywords: ["postage", "shipping", "delivery", "pickup", "collection", "click and collect", "bands"],
    sections: [
      {
        heading: "Why bands rather than live rates",
        body: [
          "A live carrier rate needs a parcel's real dimensions, and nobody weighing a donated coat in a back room is going to measure it in three axes before listing it. Bands ask for one number you already record at intake — weight — and put the order in the cheapest band it fits.",
          "Three bands covers almost everything a charity shop posts. Four if you sell furniture or a lot of books.",
        ],
        table: {
          headers: ["Band", "Up to", "Typical contents"],
          rows: [
            ["Large letter", "250g", "A scarf, a paperback, a piece of costume jewellery"],
            ["Small parcel", "2kg", "Most clothing — a shirt, a dress, a jumper"],
            ["Parcel", "6kg", "A coat, boots, or several items together"],
          ],
        },
        callout: {
          tone: "note",
          title: "The lightest band is limited by thickness, not weight",
          body: "A folded jumper can weigh under 250g and still be far too thick to go as a letter. That is why the lightest band is capped low — it is a rough stand-in for 'flat enough to post through a slot'.",
        },
      },
      {
        heading: "Setting yours",
        steps: [
          {
            do: "Open Settings → Postage. Start from the suggested bands.",
            expect: "Three rows with a description, a weight limit and a price.",
          },
          {
            do: "Change the prices to what your post office actually charges you, rounded up.",
            watchOut:
              "Round up. Postage sold at cost becomes postage sold at a loss the first time a parcel needs a bigger box than you assumed.",
          },
          {
            do: "Save, then look at your own shop page and put something in a basket.",
            expect: "A postage line appears at checkout with the band's description next to it.",
          },
        ],
        body: [
          "Descriptions are shown to shoppers, so write them for a shopper: 'Small parcel — most clothing' tells somebody what they're paying for. '2kg' does not.",
        ],
      },
      {
        heading: "Items with no weight recorded",
        body: [
          "If an item has never been weighed, it is assumed to be 500g — comfortably inside the middle band for most things. This keeps a shop from having to weigh its entire back catalogue before switching postage on.",
          "It is a guess, and it will occasionally be a generous one in the shopper's favour. If you sell a lot of heavy things, weighing at intake pays for itself quickly, and it feeds your diversion figures at the same time.",
        ],
      },
      {
        heading: "Collection in the shop",
        body: [
          "Collection is on by default, and for a lot of shops it is the better half of the feature. Nothing is packed, nothing is posted, nothing goes astray, and somebody who comes in to collect a lamp very often leaves with a lamp and two books.",
          "A shopper who chooses collection pays online and is given a short code. The code avoids vowels and anything that could be a one or a zero, because it gets read out over a counter with a queue behind it. Whoever is on the till types the code into the Orders screen and hands the item over.",
        ],
        steps: [
          { do: "In Settings → Selling online, leave 'collect in the shop' ticked." },
          {
            do: "Fill in what to tell somebody collecting: where you are and when you're open.",
            expect: "That text appears on their receipt and on the page they see after paying.",
            watchOut:
              "Say how long you'll hold it. 'Please come within two weeks' saves an awkward conversation in March about something bought in January.",
          },
        ],
      },
      {
        heading: "Tax and postage",
        body: [
          "Sales tax is calculated on the goods, not on the postage. Postage is passed through at the price you set, and the platform fee is worked out on the merchandise too — you are not charged a percentage on money that goes straight to a carrier.",
        ],
      },
    ],
    faq: [
      {
        question: "Can I offer free postage over a certain amount?",
        answer:
          "Not yet. The nearest thing today is a cheap first band and prices that quietly absorb some of the cost.",
      },
      {
        question: "What if an order doesn't fit any band?",
        answer:
          "Anything over the heaviest band's limit can't be posted, and the shopper is offered collection instead. Add a heavier band if you regularly sell things that fall off the end.",
      },
      {
        question: "Do I have to offer both?",
        answer:
          "No. Collection-only is a perfectly good way to start, and it is how a lot of shops should start — you learn the workflow without owning a parcel problem.",
      },
    ],
    related: ["selling-online", "online-orders"],
  },

  {
    slug: "online-orders",
    title: "Picking, posting, and what to do when you can't find it",
    summary:
      "The Orders screen, oldest first, with a pick list grouped by where things live — and a one-click refund for the item that isn't on the rail any more.",
    category: "selling-online",
    audience: ["manager", "staff", "volunteer"],
    readMinutes: 7,
    updated: "2026-07-26",
    appPath: "/app/orders",
    keywords: ["orders", "fulfilment", "fulfillment", "picking", "packing", "dispatch", "tracking", "refund"],
    sections: [
      {
        heading: "What lands on the screen, and when",
        body: [
          "An order appears on the Orders screen the moment its payment clears, and never before. This matters more than it sounds: a queue that includes not-yet-paid orders is a queue that sends volunteers to find things nobody has bought, and after that happens twice nobody trusts the queue.",
          "The list is oldest first. Whoever has been waiting longest is at the top, which is the only ordering that doesn't quietly punish somebody for ordering something awkward.",
        ],
      },
      {
        heading: "The pick list",
        body: [
          "Open an order and you get a list of what to find, with each item's recorded location, tag colour and category next to it. A volunteer who has to ask somebody where a coat is stops picking, so the location is on the line rather than a click away.",
          "Work down the list, then use the buttons at the bottom. They change with the state of the order, so you see the two things you might do next rather than six greyed-out ones.",
        ],
        table: {
          headers: ["Where it is", "What you'll be offered"],
          rows: [
            ["Just paid", "Start looking"],
            ["Being picked", "Found it — packed"],
            ["Packed, to post", "In the post (with a tracking box, if you have one)"],
            ["Packed, for collection", "Handed over"],
          ],
        },
      },
      {
        heading: "When you can't find something",
        body: [
          "This will happen. Somebody bought a jumper at the counter this morning without ringing it up, or it went to a different branch, or it is simply not where the label says. The screen is built around this being normal rather than an exception.",
          "Tick the lines you couldn't find, write a note in plain words, and refund. The customer is refunded for exactly those items immediately, and told which ones. The rest of the order stays in the queue to be picked and posted.",
        ],
        steps: [
          { do: "Tick the lines you couldn't find." },
          {
            do: "Write what happened. 'Sold in the shop this morning' is enough.",
            watchOut: "The customer sees this. Write it to be read by them, not by you.",
          },
          {
            do: "Press the refund button.",
            expect:
              "A confirmation saying how much came back and for what. If nothing in the order could be found, the postage is refunded too.",
          },
        ],
        callout: {
          tone: "good",
          title: "Postage comes back only when the whole order fails",
          body: "If one of three items is missing, you are still posting a parcel, so the postage stands. If none of them turned up, there is no parcel and the postage goes back. This is worked out for you.",
        },
      },
      {
        heading: "Items that couldn't be found don't come back to the floor",
        body: [
          "A refunded line is not returned to stock. If you couldn't find it, putting it back on the shelf as available is asserting something you have just demonstrated you don't know. Find it later and log it in again — that takes a minute and leaves your figures honest.",
        ],
      },
      {
        heading: "Collections",
        body: [
          "A collection order shows the shopper's code prominently. Ask for it at the counter, find the order, hand the item over, and press 'Handed over'. There is nothing to pack and nothing to post.",
          "If somebody has lost their code, you can find the order by their name in the same list.",
        ],
      },
      {
        heading: "Done and gone",
        body: [
          "Anything dispatched, collected or refunded drops into the settled list at the bottom of the screen, so the top of the screen only ever shows work. You can still open a settled order to check an address or re-read a note.",
        ],
      },
    ],
    faq: [
      {
        question: "Do I have to add tracking?",
        answer:
          "No. The box is there if you have a reference and want it on the record, and empty is fine.",
      },
      {
        question: "Can a volunteer use this screen?",
        answer:
          "Yes — that is who it is written for. Refunding is the one consequential action on it, and it is deliberately explicit about what it is about to do.",
      },
      {
        question: "What if somebody never collects?",
        answer:
          "Refund the order with a note, and put the item back on the floor by logging it in again. Say in your collection instructions how long you'll hold things so this is a policy rather than a judgement call.",
      },
    ],
    related: ["selling-online", "postage-and-collection", "refunds-and-returns"],
  },

  {
    slug: "product-photographs",
    title: "Turning a back-room snapshot into a product shot",
    summary:
      "Cut the item out of whatever it was photographed against and put it on a clean, even background — without changing the item itself.",
    category: "selling-online",
    audience: ["manager", "staff", "volunteer"],
    readMinutes: 6,
    updated: "2026-07-26",
    appPath: "/app/photos",
    keywords: ["photos", "photographs", "images", "product shots", "background", "cut out", "enhance", "ai"],
    sections: [
      {
        heading: "The rule",
        body: [
          "Enhance the photograph. Never the item.",
          "Straightening, lighting, dropping out a cluttered background, putting the thing on a clean seamless — all fair, and all of it makes a page of listings look like a shop rather than a car boot sale. Removing a stain, closing a moth hole, making faded black cotton read as new black cotton — never.",
          "This is not squeamishness. A shopper who receives something visibly worse than the photograph is a shopper who asks for their money back and doesn't come again, and the only real asset a charity shop has online is being believed. The tools used here are chosen so the rule is difficult to break rather than merely stated: the cut-out is done by an ordinary image transformation that isolates the real pixels. It cannot invent a garment that isn't there. A generative model could, so none is used on the item.",
        ],
      },
      {
        heading: "What it actually does to a real photograph",
        body: [
          "This is a real back-room snapshot from our demo shop: a navy wool coat on a beige carpet, with a laundry basket, a table leg and a hard shadow across half the frame. Nobody would put it on a listing.",
        ],
        comparison: {
          before: {
            src: "/img/demo/peacoat.jpg",
            caption: "What somebody photographed",
            alt: "A navy wool peacoat laid on a beige carpet, photographed from above with a laundry basket and table legs at the edges of the frame.",
          },
          after: {
            src: "/api/demo/tidied/peacoat.webp?style=plain",
            caption: "Plain",
            alt: "The same coat, cut out of its background and centred on a plain off-white square.",
          },
          also: [
            {
              src: "/api/demo/tidied/peacoat.webp?style=shadow",
              caption: "With a shadow",
              alt: "The same coat on a plain background, sitting on a soft shadow in its own shape.",
            },
            {
              src: "/api/demo/tidied/peacoat.webp?style=blur",
              caption: "Softened",
              alt: "The same coat where it was photographed, with the carpet and clutter blurred and drained of colour behind it.",
            },
          ],
          note: "All three are made when you load this page, by the same code your own photographs go through — none is a screenshot of a good result we kept. Now look at the coat itself in every one: the scuffed cuff is still scuffed and the marks down the front are still there. The photograph got better; the coat did not.",
        },
      },
      {
        heading: "How it works",
        steps: [
          {
            do: "Open Photos. Everything on the floor with a photograph and no tidy-up is in the lower list.",
          },
          {
            do: "Press 'Tidy this up' on one.",
            expect: "After a moment it moves to the top of the screen, next to the original.",
          },
          {
            do: "Compare the two and either keep it or throw it away.",
            watchOut:
              "Look at the edges. A cut-out occasionally eats a thin strap or a pale hem against a pale background, and that is exactly the kind of thing you should throw away rather than publish.",
          },
        ],
        body: [
          "Nothing is published until somebody has looked at it. An unreviewed cut-out is a guess, and a guess about what a used item looks like is not something to put in front of a shopper.",
        ],
        callout: {
          tone: "note",
          title: "The original is never replaced",
          body: "A tidied photograph is stored alongside the original, not over it. Throw the tidy-up away and you are exactly where you started. Every listing using a tidied photograph links to the original, so anyone can see what was actually photographed.",
        },
      },
      {
        heading: "Three ways, and which to pick",
        body: [
          "Plain is the default and suits most things: cut out, centred, on an even background. It's the one that makes a page of listings look like a shop, because every item ends up the same size and shape.",
          "With a shadow is the same cut-out sitting on a soft shadow in its own shape. Use it when a plain cut-out looks like it's floating — which it often does for anything with a solid form, like a mug or a lamp. The shadow is the one thing here that wasn't in your photograph: it's built from the item's own outline, it says nothing about the item's condition, and it's there because an object with no shadow at all reads as pasted on.",
          "Softened removes nothing. Your background is still there — blurred and drained of colour so the item stands forward. The real shadow and the real surface survive, which some shops much prefer. The trade is that it doesn't give you an even grid, because every photograph keeps its own framing.",
        ],
        table: {
          headers: ["Style", "Background", "Good for"],
          rows: [
            ["Plain", "Replaced", "Clothing, and anything you want in a tidy grid"],
            ["With a shadow", "Replaced", "Solid objects that look pasted on without one"],
            ["Softened", "Kept, pushed back", "Shops that would rather change nothing at all"],
          ],
        },
        callout: {
          tone: "note",
          title: "Light or dark background",
          body: "Plain and With a shadow both let you choose. Pale things — cream mugs, white shirts — disappear into a pale background, and a dark one gives them their edges back. Dark items want the light one. It's a decision about the item, not about your shop, so it sits on each photograph.",
        },
      },
      {
        heading: "Why every one comes out square",
        body: [
          "A jumper photographed from six feet and a mug photographed from six inches have to end up the same size on the page, or the grid looks like a jumble sale. The item is isolated, cropped to itself, then placed on a square background with a margin — so shape stops mattering and every listing sits on the same footing.",
          "The background is taken from your brand's surface colour, unless that colour is dark. A black coat on a black seamless is a photograph of nothing, so anything dark falls back to a warm off-white.",
        ],
      },
      {
        heading: "Taking a photograph worth tidying",
        list: [
          "Fill the frame. A garment shot from across a room has very few pixels of garment in it, and no amount of processing invents them.",
          "Flat and even beats artful. A jumper on the floor in daylight photographs better than one on a hanger under a strip light.",
          "Avoid strong shadows under the item — a cut-out will sometimes take them along.",
          "One item per photograph. Two things in shot and the cut-out has to guess which one you meant.",
        ],
      },
      {
        heading: "What to do about flaws",
        body: [
          "Photograph them, and say so in the description. A close-up of the mark on the cuff sells more coats than a photograph without it, because it tells a shopper you are not going to surprise them. Second-hand buyers expect wear; what they will not forgive is finding it after paying.",
        ],
      },
    ],
    faq: [
      {
        question: "Can it remove a stain?",
        answer:
          "No, and it never will. That is the one line this feature is built not to cross.",
      },
      {
        question: "Do I have to tidy every photograph?",
        answer:
          "No. An untidied photograph is used exactly as it is. Tidying is worth most on your window items and anything you are trying to get found in a shopping feed.",
      },
      {
        question: "Can I change it back after keeping it?",
        answer:
          "Tidy it up again and throw the new one away, and you are back to the original. The original is always the fallback.",
      },
    ],
    related: ["product-feed", "selling-online", "logging-your-first-items"],
  },

  {
    slug: "product-feed",
    title: "Getting your stock found",
    summary:
      "A product feed puts your items in front of people searching for them, and sends the buyer back to your own page to buy.",
    category: "selling-online",
    audience: ["owner", "manager"],
    readMinutes: 5,
    updated: "2026-07-26",
    appPath: "/app/settings",
    keywords: ["google shopping", "feed", "rss", "syndication", "marketplace", "discovery", "seo"],
    sections: [
      {
        heading: "What a feed is",
        body: [
          "Every shop has a product feed at a fixed address — your shop's page with /feed.xml on the end. It is a machine-readable list of what you currently have: title, description, price, photograph, and a link. Google Shopping reads one, and so do a number of other places.",
          "Submit it once and it is read repeatedly. Something sold this morning is gone from the feed by lunchtime, because the feed is generated from your stock rather than exported from it.",
        ],
      },
      {
        heading: "Why this rather than a marketplace",
        body: [
          "A marketplace listing takes the buyer's money, holds your stock hostage to its own checkout, and charges you for the privilege. A feed does the opposite: it gets you discovered where the audience is, and sends the buyer to your own page to buy.",
          "That distinction is what keeps everything else in this product working. The buyer lands on your page, so your holds apply, the money goes through your own Stripe account at the fee you already understand, and there is no second checkout anywhere that could sell the same coat.",
        ],
        callout: {
          tone: "good",
          title: "One price, everywhere",
          body: "The feed carries whatever the item costs today, markdown included. There is no separate feed price to maintain and nothing to go stale.",
        },
      },
      {
        heading: "What's in it, and what isn't",
        body: [
          "An item is in the feed if it is available, priced above nothing, not currently held by somebody paying, and has a photograph. Everything else is left out.",
          "The photograph requirement is not ours — a shopping channel rejects a listing without an image. An item with no photograph would be submitted and bounced, so it is excluded instead, and the count of what's missing is shown to you on the Settings screen rather than left as a mystery.",
        ],
        table: {
          headers: ["Reason", "What to do"],
          rows: [
            ["No photograph", "Photograph it. This is by far the most common gap."],
            ["Not priced", "Price it. A channel rejects a zero price."],
            ["Held", "Nothing — somebody is part-way through buying it. It returns if they don't finish."],
            ["Sold", "Nothing. One-of-a-kind items leave rather than linger as 'out of stock'."],
          ],
        },
      },
      {
        heading: "Submitting it",
        steps: [
          {
            do: "In Settings → Selling online, check the count and follow 'See the feed'.",
            expect: "A page of XML. It is not meant to be readable; you are checking it isn't empty.",
          },
          {
            do: "Create a Google Merchant Center account for your shop and add the feed's address as a scheduled fetch.",
            watchOut:
              "Merchant Center will want your postage and returns policies filled in before it will show anything. That is their requirement, not ours, and it is worth doing properly once.",
          },
          {
            do: "Wait. First review commonly takes a few days.",
          },
        ],
      },
      {
        heading: "Making the listings worth finding",
        list: [
          "Titles carry the search. 'Forest green cable knit jumper, wool, size M' finds people. 'Nice jumper' does not.",
          "Brand and category, where you know them. Both are searched on heavily.",
          "A tidied photograph on a clean background performs measurably better than a snapshot on a carpet.",
          "Describe the wear. It costs you nothing in the feed and saves a return.",
        ],
      },
      {
        heading: "If the feed is empty",
        body: [
          "Two causes, in order of likelihood. Online selling is off — a shop not selling online gets an empty feed rather than an error, so a merchant account already pointed at it doesn't start complaining the day you pause. Or nothing has a photograph. The Settings screen tells you which, with numbers.",
        ],
      },
    ],
    faq: [
      {
        question: "Does this cost anything?",
        answer:
          "Google's free listings are free. Paid placement is a separate decision and not one you have to make to be in the feed.",
      },
      {
        question: "How often is it refreshed?",
        answer:
          "It is generated on request and cached for half an hour, so something sold this morning is out of it by lunchtime.",
      },
      {
        question: "Can I use it somewhere other than Google?",
        answer:
          "Yes. It is ordinary RSS with the standard shopping fields, which several other services read.",
      },
    ],
    related: ["product-photographs", "selling-online", "your-website"],
  },
] as const;
