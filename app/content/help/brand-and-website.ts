import type { HelpArticle } from "./types";

/**
 * The Studio, the website, and custom domains.
 *
 * Written for a shop that has never had a brand and doesn't want a branding
 * project — the whole point of these three screens is that a shop gets a
 * coherent look, printable signage, and a working website out of records it
 * already keeps, in an afternoon, without hiring anyone.
 */
export const BRAND_ARTICLES: readonly HelpArticle[] = [
  {
    slug: "your-brand-kit",
    title: "Your brand, in about ten minutes",
    summary:
      "Pick four colours, a typeface pairing and a tone of voice once, and every sign, poster and page in ThriftOS uses them from then on.",
    category: "brand",
    audience: ["owner", "manager"],
    readMinutes: 7,
    updated: "2026-07-26",
    appPath: "/app/studio",
    keywords: ["brand", "logo", "colours", "colors", "fonts", "typeface", "voice", "identity", "studio"],
    sections: [
      {
        heading: "What a brand kit is here",
        body: [
          "Four colours, a typeface pairing, a tone of voice, and your shop's name and tagline. That's it. It is deliberately not a brand guidelines document — nobody behind a counter is going to read one, and a shop that needs a forty-page PDF before it can print a sale sign will never print the sale sign.",
          "You set it once. Everything downstream reads from it: the signs and posters in the Studio, your public website, and the colours on your printed tags. Change the accent colour on a Tuesday and every asset you generate on Wednesday has already changed with it. There is no step where you re-apply the brand to anything.",
        ],
        callout: {
          tone: "note",
          title: "You can skip this entirely",
          body: "There's a sensible default kit already in place, and every screen works with it. If you'd rather get on with pricing stock, come back to this in a quieter week.",
        },
      },
      {
        heading: "The four colours, and what each one does",
        table: {
          headers: ["Colour", "Where it turns up", "What to pick"],
          rows: [
            [
              "Primary",
              "Headings, your name on a poster, the top of your website",
              "The colour you'd paint the fascia. Dark enough to read text in.",
            ],
            [
              "Accent",
              "Prices, sale flashes, buttons, the one thing on a sign that should be noticed first",
              "Something that fights the primary a little. If it's a near-neighbour of the primary, nothing stands out.",
            ],
            [
              "Ink",
              "Body text everywhere",
              "Nearly black, or a very dark version of the primary. Not mid-grey.",
            ],
            [
              "Surface",
              "The paper, the page background",
              "White, or something barely off it. Every printed asset costs you ink here, so a strong background colour is a running expense.",
            ],
          ],
        },
        body: [
          "As you change them, the contrast panel updates. It's checking whether the combinations you've chosen can actually be read — dark text on a dark background is the classic own goal, and it looks fine on a bright laptop in a lit office and is illegible on a sign taped to a window in February.",
        ],
      },
      {
        heading: "Reading the contrast panel",
        body: [
          "Each row is a real pairing something uses: body text on the page, headings on the page, white text on your primary, white text on your accent, your accent against the page. Each is rated, and where a pairing is too close the panel says which of the two to move and in which direction.",
          "Take the warnings seriously in exactly one case and lightly in the others: body text on the page is the one that matters, because it's the one people read paragraphs of. A marginal accent-on-surface rating on a price flash that's set in 60pt is not a real problem.",
        ],
        callout: {
          tone: "warn",
          title: "Ink on surface is the one to fix",
          body: "If that row is failing, your website's paragraphs and your posters' small print are hard to read for a meaningful share of your customers — including anyone reading a sign through a shop window in daylight.",
        },
      },
      {
        heading: "Typeface pairings",
        body: [
          "There are four: Warm, Plain, Classic and Bold. They're built from fonts already present on the devices your customers use, which is why your website loads instantly and a poster looks the same on your printer as it does on screen. Nothing is downloaded, so there's nothing to break.",
          "Choose by what you're for rather than what you like. Warm suits a shop leaning on community and story. Plain suits a high-volume shop where clarity beats character. Classic suits a shop with a long history or a church connection. Bold suits a shop with a young customer base and a loud front window.",
        ],
      },
      {
        heading: "Tone of voice",
        body: [
          "Warm, Practical, Spirited, or Quiet. This does one job: it steers the drafted copy in the Studio, so a donation poster written for a Quiet shop doesn't come out shouting.",
          "It doesn't change anything already written, and it never overrides words you typed. If you write your own headline, that's your headline.",
        ],
      },
      {
        heading: "A logo, without a designer",
        body: [
          "There isn't a logo generator, on purpose — the ones that exist produce something a shop is quietly embarrassed by within a year. What you get instead is a wordmark: your shop's name set in your chosen pairing, in your primary colour, with your initials as a compact mark for the places a full name won't fit.",
          "That is genuinely enough. A consistently-applied name in a consistent colour reads as more established than an inconsistently-applied logo, and if you commission a proper mark later, nothing here has to be undone.",
        ],
      },
    ],
    faq: [
      {
        question: "We already have a logo and brand colours. Can we use them?",
        answer:
          "Yes — enter your existing hex codes and the whole system uses them. There's no upload for a logo file yet, so the wordmark stays as it is, but everything else will match what you already print.",
      },
      {
        question: "Does changing the brand break signs I've already printed?",
        answer:
          "No, but it does mean the paper on your walls no longer matches what you'd generate today. If you make a big change, it's worth reprinting the tag ladder and hours card — those are the two customers actually read.",
      },
      {
        question: "Can different shops in our group have different brands?",
        answer:
          "Each shop has its own kit. Shops in a federation can look alike or not, entirely as you choose.",
      },
    ],
    related: ["signs-and-posters", "your-website"],
  },
  {
    slug: "signs-and-posters",
    title: "Signs and posters from your own numbers",
    summary:
      "Eight print-ready assets built from what your shop actually did this week — sale signs, the colour-tag ladder, a donation-wanted poster, and an impact poster that only ever shows figures you have.",
    category: "brand",
    audience: ["owner", "manager", "staff"],
    readMinutes: 8,
    updated: "2026-07-26",
    appPath: "/app/studio",
    keywords: ["studio", "poster", "sign", "print", "signage", "marketing", "social", "flyer", "shelf talker"],
    sections: [
      {
        heading: "What this is",
        body: [
          "Eight things you can print or post today, each one filled in from your own records rather than from a template you have to complete. The sale sign already knows which colour tag is discounted this week. The donation poster already lists what you take. The impact poster already has your diversion figure in it.",
          "That's the whole idea. A blank template is a job you'll do next month; a finished sign with your numbers in it is a thing you print now.",
        ],
        table: {
          headers: ["Asset", "What it's built from", "Where it goes"],
          rows: [
            ["Today's sale sign", "This week's colour-tag discount", "The window, and the end of each rail"],
            ["How our colour tags work", "Your live tag rotation and its discounts", "By the till, and at the door"],
            ["What we can take", "Your accepted and not-accepted lists", "The donation door"],
            ["What this shop did", "Items rehomed, weight diverted, value delivered, volunteer hours", "The window, and any grant application"],
            ["We need volunteers", "Your genuinely unfilled shifts", "The noticeboard, and the local library"],
            ["Just arrived", "Items logged in the last few days", "Social, once or twice a week"],
            ["When we're open", "Your opening hours", "The door, and the window at closing time"],
            ["Shelf talker", "A category or a single item you pick", "Folded over a shelf edge"],
          ],
        },
      },
      {
        heading: "Printing one",
        steps: [
          { do: "Open Studio and choose an asset.", expect: "A preview that already has your shop's name, colours and numbers in it." },
          { do: "Change the size if you need to — window, poster, or square for social." },
          { do: "Edit any wording you want to change. Your words always win over the drafted ones." },
          {
            do: "Download it.",
            expect: "A PNG, ready to print or post.",
            watchOut:
              "Print at 100%, not 'fit to page'. Fit-to-page adds a white margin that makes an A4 sign look like an A5 sign someone enlarged badly.",
          },
        ],
        body: [
          "Everything is generated on your device from the shop's own data. Nothing is sent anywhere to be rendered, and there's no queue and no watermark.",
        ],
      },
      {
        heading: "Assets that hide themselves, and why that's the point",
        body: [
          "An asset will tell you it isn't ready rather than print with a hole in it. The volunteer poster stays quiet if you have no unfilled shifts — a poster begging for help you don't need costs you credibility with the exact people you'll want next month. The sale sign stays quiet if no tag colour is discounted this week.",
          "The impact poster is the strictest, and it works figure by figure rather than all-or-nothing. If you've rehomed 400 items but never recorded a weight, it prints the 400 and simply doesn't mention landfill. A poster in a window reading '0 lbs diverted' in large type is worse than no poster, and it is precisely the kind of thing that gets printed once and quietly discredits every other number on the wall.",
        ],
        callout: {
          tone: "good",
          title: "The fix is upstream",
          body: "If an asset says it hasn't got enough to work with, the cure is a field on the intake form — a rough weight, a comparable new price — not a setting here. Fill those in for a fortnight and the poster fills itself in.",
        },
      },
      {
        heading: "Drafted words",
        body: [
          "Where an asset has a headline or a paragraph, you can ask for a few drafts in your shop's tone of voice. You get options, not a decision: nothing is applied until you pick one, and you can edit it afterwards or ignore all of them and write your own.",
          "Drafts are screened before you see them. Anything that invents a figure, promises something on your behalf, or makes a charitable claim you haven't substantiated is dropped rather than shown — a sign in your window is your word, and it should never contain a number you didn't put there.",
        ],
        callout: {
          tone: "warn",
          title: "Read it before you print it",
          body: "The screening catches the obvious failures. It cannot know that your Tuesday half-price day ended in March. You're the last check, and on anything going in a window you should read it twice.",
        },
      },
      {
        heading: "A rhythm that works",
        list: [
          "Monday: print this week's sale sign, and put last week's in the recycling",
          "Whenever the tag rotation changes: reprint the tag ladder by the till",
          "Once a week: post 'Just arrived' with three or four things worth a look",
          "Once a quarter: refresh the impact poster in the window — regulars do read it",
          "When you actually need people: the volunteer poster, in three physical places, not just online",
        ],
        body: [
          "Resist doing all eight in one afternoon. A window with eight posters in it is a window nobody reads. Two, changed regularly, beat eight that stay up until they fade.",
        ],
      },
    ],
    faq: [
      {
        question: "Can I get a PDF instead of a PNG?",
        answer:
          "Print to PDF from your browser's print dialog — the download is a high-resolution image, so it prints cleanly either way.",
      },
      {
        question: "The colours look different on my printer.",
        answer:
          "Screens emit light and paper reflects it, so some shift is unavoidable. If it's badly off, the usual culprit is a printer set to draft or economy mode. A very dark surface colour also drinks ink; a near-white surface prints more predictably and costs less.",
      },
      {
        question: "Can I use these outside ThriftOS?",
        answer:
          "They're your shop's assets, made from your shop's data. Put them wherever you like.",
      },
    ],
    related: ["your-brand-kit", "your-website"],
  },
  {
    slug: "your-website",
    title: "Your website, and using your own domain",
    summary:
      "Every shop has a public page that keeps itself current. Here's what's on it, how to add pages, and how to point a domain you already own at it.",
    category: "brand",
    audience: ["owner", "manager"],
    readMinutes: 9,
    updated: "2026-07-26",
    appPath: "/app/site",
    keywords: ["website", "site", "cms", "pages", "domain", "dns", "cname", "url", "storefront", "public page"],
    sections: [
      {
        heading: "You already have one",
        body: [
          "From the day you signed up, your shop has a public page. It's at your ThriftOS address — the one shown at the top of the Website screen — and it is already correct, because most of what's on it is read from your records rather than typed by you.",
          "Your opening hours are your opening hours. 'In at the moment' is genuinely what you logged this week. The impact figures are the same ones on your reports. Nothing on the page can drift out of date while you're busy, because there's nothing there for you to forget to update.",
        ],
      },
      {
        heading: "Blocks, and which ones look after themselves",
        body: [
          "A page is a stack of blocks you can reorder, add and remove. Seven of the nine read live from your shop; two are for words you write.",
        ],
        table: {
          headers: ["Block", "Keeps itself current?"],
          rows: [
            ["Welcome", "No — your heading and paragraph"],
            ["Some words", "No — anything you want to say"],
            ["When we're open", "Yes, from your hours"],
            ["What's in at the moment", "Yes, from items logged recently"],
            ["What this shop has done", "Yes, from your impact figures"],
            ["How to donate", "Yes, from your accepted list"],
            ["How our tags work", "Yes, from your tag rotation"],
            ["Volunteering", "Yes, from your unfilled shifts"],
            ["Where to find us", "Yes, from your shop details"],
          ],
        },
        callout: {
          tone: "note",
          title: "An empty live block shows nothing at all",
          body: "No stray heading, no placeholder text. Add the volunteering block before you need volunteers and it simply won't appear until you have a shift going spare — at which point it turns up on its own.",
        },
      },
      {
        heading: "Adding a page",
        steps: [
          { do: "Open Website and choose New page.", expect: "An empty page with an address you can set." },
          {
            do: "Give it a title and an address — 'about', 'donate', 'find-us'.",
            watchOut: "The address is what people will type and what search engines will index. Changing it later breaks any link anyone has saved.",
          },
          { do: "Add blocks, and put them in the order someone visiting would want them." },
          {
            do: "Publish when you're ready.",
            expect: "It appears in your site's navigation and is publicly reachable.",
            watchOut: "A draft page is genuinely private — visiting its address gets a 404, not a preview. That's deliberate, so a half-finished page can't be found before you're ready.",
          },
        ],
      },
      {
        heading: "Writing a page people read",
        list: [
          "Say where you are and when you're open in the first screenful — it's what most visitors came for",
          "Say what you take and what you can't, plainly. It saves your volunteers an unloading conversation every day",
          "One short paragraph of story is worth more than five. Who you're for, and where the money goes",
          "Avoid announcing anything with a date in it unless you'll remember to take it down",
        ],
        body: [
          "Three pages is plenty for a thrift shop: your home page, an about page, and a donate page. A fourth is usually a page that goes stale.",
        ],
      },
      {
        heading: "Your address, and using your own",
        body: [
          "Your shop lives at thriftos.app followed by your shop's name — a real, permanent, free address you can print on a bag. If you don't own a domain, you don't need one, and this section is safe to skip entirely.",
          "If you do own one, you can point it here. Both addresses then work at once, so nothing you've already printed stops working.",
        ],
        steps: [
          { do: "Open Website → Your domain and type the domain you own." },
          {
            do: "Add the CNAME record it shows you, at whoever you registered the domain with.",
            watchOut:
              "This is the step that needs someone with the login for your domain registrar. If nobody at the shop knows what that is, the ThriftOS address works perfectly well and this can wait.",
          },
          {
            do: "Leave it. There's nothing to press.",
            expect:
              "The screen checks every time you open it and again overnight. It goes live on its own, usually within minutes and occasionally up to an hour.",
          },
        ],
        callout: {
          tone: "note",
          title: "The certificate is handled",
          body: "The padlock in the address bar is issued and renewed for you. There's nothing to buy and nothing that expires and takes your site down on a bank holiday.",
        },
      },
      {
        heading: "When a domain won't go live",
        body: [
          "Nearly always it's the DNS record. Check it letter by letter against what the screen shows — the two common mistakes are typing the record at the wrong level (an entry for 'shop.example.org' typed as 'shop.example.org.example.org') and pointing at the wrong target.",
          "The other frequent cause is a second record already sitting on the same name. A CNAME cannot coexist with an A record on the same hostname, so an old record left over from a previous website will block it. Remove the old one.",
          "If the screen says a domain needs attention, it's showing you the actual reason, not a generic failure. Fix what it names, or remove the domain and add it again.",
        ],
        callout: {
          tone: "good",
          title: "Your domain is always yours",
          body: "We don't sell domains and we never hold yours. It stays registered where you bought it. If you leave, delete the DNS record and it's entirely yours again — there's nothing to ask us for and nobody to email.",
        },
      },
    ],
    faq: [
      {
        question: "Can I change my shop's ThriftOS address?",
        answer:
          "Yes, in Settings, but treat it like moving premises. The old address stops working, so anything printed with it on becomes wrong. Worth doing early, not casually.",
      },
      {
        question: "Will this show up on Google?",
        answer:
          "Your published pages are indexable and carry the right structured data for a local shop — hours, address, the lot. Drafts are not. Being found for your own name usually takes a couple of weeks.",
      },
      {
        question: "Can people buy from the website?",
        answer:
          "Not yet. 'In at the moment' shows what you've got to bring people through the door; selling happens at your register.",
      },
      {
        question: "Can I use a subdomain, like shop.ourcharity.org?",
        answer:
          "Yes, and for a charity that already has a main site it's usually the better choice — it borrows the reputation of the domain you already have.",
      },
    ],
    related: ["your-brand-kit", "signs-and-posters"],
  },
];
