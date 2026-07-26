/**
 * The help centre's shape.
 *
 * A typed registry rather than a CMS, for the same reason the guides are: the
 * search index, the in-app links, the sitemap, and llms.txt all generate from
 * this, so a renamed article can never leave a dead link behind. Tests pin it.
 *
 * These articles are written for someone standing behind a counter with a
 * queue forming. Dense, but in sentences — not a wall of bullet points, and
 * never a screenshot tour that goes stale the week after it's taken.
 */

export type HelpCategoryId =
  | "getting-started"
  | "payments"
  | "intake"
  | "inventory"
  | "register"
  | "selling-online"
  | "donations"
  | "people"
  | "volunteers"
  | "reporting"
  | "nri"
  | "brand"
  | "admin"
  | "migrating";

export interface HelpCategory {
  id: HelpCategoryId;
  title: string;
  blurb: string;
  /** Emoji-free glyph, so it renders identically everywhere. */
  glyph: string;
}

export const HELP_CATEGORIES: readonly HelpCategory[] = [
  {
    id: "getting-started",
    title: "Getting started",
    blurb: "Your first hour, and what to do in what order.",
    glyph: "◇",
  },
  {
    id: "payments",
    title: "Taking payments",
    blurb: "Stripe setup, readers, Tap to Pay, fees, payouts, and what to do when a payment goes wrong.",
    glyph: "◈",
  },
  {
    id: "intake",
    title: "Logging donations in",
    blurb: "Photo intake, pricing, tagging, and getting a backlog under control.",
    glyph: "▣",
  },
  {
    id: "inventory",
    title: "Inventory & pricing",
    blurb: "Colour tags, markdowns, aged stock, transfers, and what to track.",
    glyph: "▤",
  },
  {
    id: "register",
    title: "The register",
    blurb: "Ringing up, round-ups, tax, offline selling, voids and refunds.",
    glyph: "▦",
  },
  {
    id: "selling-online",
    title: "Selling online",
    blurb:
      "Turning it on, postage and collection, picking and posting orders, product photographs, and getting your stock found.",
    glyph: "▧",
  },
  {
    id: "donations",
    title: "Donors & receipts",
    blurb: "Recording donations, issuing acknowledgements, and staying on the right side of the rules.",
    glyph: "◉",
  },
  {
    id: "people",
    title: "People",
    blurb: "One contact list, stacking roles, and keeping it honest.",
    glyph: "◎",
  },
  {
    id: "volunteers",
    title: "Volunteers & shifts",
    blurb: "Scheduling, logging hours, and turning them into grant evidence.",
    glyph: "◍",
  },
  {
    id: "reporting",
    title: "Impact & reporting",
    blurb: "Diversion, value delivered, hours, and how to defend the numbers.",
    glyph: "◊",
  },
  {
    id: "nri",
    title: "The Compass (NRI)",
    blurb: "What it notices, why, and how to make it useful rather than noise.",
    glyph: "✳",
  },
  {
    id: "brand",
    title: "Brand, signage & website",
    blurb: "Your colours and voice, printable signs built from your own numbers, your public pages, and using your own domain.",
    glyph: "◐",
  },
  {
    id: "admin",
    title: "Settings & billing",
    blurb: "Your plan, your team, your shop's details, and what things cost.",
    glyph: "⚙",
  },
  {
    id: "migrating",
    title: "Moving in",
    blurb: "Importing from another system, and what to do with the parts that don't map.",
    glyph: "⇥",
  },
] as const;

export type Audience = "owner" | "manager" | "staff" | "volunteer";

export interface HelpStep {
  /** Short imperative. "Open Settings → Payments." */
  do: string;
  /** What the person should see, so they know it worked. */
  expect?: string;
  /** The trap at this step, if there is one. */
  watchOut?: string;
}

export interface HelpSection {
  heading: string;
  /** Paragraphs. Prose, not bullet soup. */
  body?: string[];
  list?: string[];
  steps?: HelpStep[];
  /** A boxed aside. Use sparingly or it stops meaning anything. */
  callout?: { tone: "note" | "warn" | "good"; title: string; body: string };
  /** A small reference table where one genuinely helps. */
  table?: { headers: string[]; rows: string[][] };
}

export interface HelpArticle {
  slug: string;
  title: string;
  /** One sentence. Shown in search results and category listings. */
  summary: string;
  category: HelpCategoryId;
  audience: Audience[];
  readMinutes: number;
  updated: string;
  /** Deep link into the app, where the article is about a specific screen. */
  appPath?: string;
  sections: HelpSection[];
  faq?: { question: string; answer: string }[];
  related?: string[];
  /** Extra terms someone might search for that aren't in the title. */
  keywords?: string[];
}
