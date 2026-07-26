/**
 * The shop's website.
 *
 * A page is a list of blocks. The argument for building this rather than
 * telling shops to use Squarespace is one property: **blocks that show data
 * read it live**. Opening hours, what's on the racks, how much was kept out of
 * landfill, which tags are half price — all of it comes from the same records
 * that run the till, at the moment the page is served.
 *
 * A shop website written in January is, by March, usually wrong about its own
 * hours. That isn't carelessness; it's that updating two places is a job
 * nobody has time for. So here there is only one place.
 *
 * Shop-authored prose is still shop-authored — an `intro` or `text` block says
 * exactly what somebody typed. The live blocks are the ones that can't drift.
 */

export type BlockKind =
  | "intro"
  | "text"
  | "hours"
  | "featured"
  | "impact"
  | "donate"
  | "tags"
  | "volunteer"
  | "contact";

export interface BlockSpec {
  kind: BlockKind;
  label: string;
  /** What it does, in words a shop manager would use. */
  describes: string;
  /** True when the block reads live records rather than stored text. */
  live: boolean;
  /** Which fields a person fills in. Everything else comes from the data. */
  fields: { key: "heading" | "body"; label: string; placeholder: string; long?: boolean }[];
}

export const BLOCKS: readonly BlockSpec[] = [
  {
    kind: "intro",
    label: "Welcome",
    describes: "A heading and a paragraph at the top of the page. Your words.",
    live: false,
    fields: [
      { key: "heading", label: "Heading", placeholder: "A second life for good things" },
      {
        key: "body",
        label: "Paragraph",
        placeholder: "Say what the shop is and who it's for.",
        long: true,
      },
    ],
  },
  {
    kind: "text",
    label: "Some words",
    describes: "A heading and a paragraph, anywhere on the page. Your words.",
    live: false,
    fields: [
      { key: "heading", label: "Heading", placeholder: "Our story" },
      { key: "body", label: "Paragraph", placeholder: "Whatever you'd like to say.", long: true },
    ],
  },
  {
    kind: "hours",
    label: "When we're open",
    describes: "Reads your opening and donation hours from Settings, so it can't go stale.",
    live: true,
    fields: [{ key: "heading", label: "Heading", placeholder: "When we're open" }],
  },
  {
    kind: "featured",
    label: "What's in at the moment",
    describes:
      "A few things genuinely on the floor right now, at today's price. Sold items drop off on their own.",
    live: true,
    fields: [{ key: "heading", label: "Heading", placeholder: "In this week" }],
  },
  {
    kind: "impact",
    label: "What this shop has done",
    describes:
      "Diversion weight, items rehomed, and volunteer hours from your own records — with the method stated.",
    live: true,
    fields: [{ key: "heading", label: "Heading", placeholder: "What your shopping does" }],
  },
  {
    kind: "donate",
    label: "How to donate",
    describes: "Donation hours and what you can and can't take, from Settings.",
    live: true,
    fields: [
      { key: "heading", label: "Heading", placeholder: "Donating things" },
      { key: "body", label: "Anything to add", placeholder: "Optional.", long: true },
    ],
  },
  {
    kind: "tags",
    label: "How our tags work",
    describes: "Your colour rotation and what each colour is worth today.",
    live: true,
    fields: [{ key: "heading", label: "Heading", placeholder: "How our tags work" }],
  },
  {
    kind: "volunteer",
    label: "Volunteering",
    describes: "The shifts actually unfilled, if you schedule them here.",
    live: true,
    fields: [
      { key: "heading", label: "Heading", placeholder: "Could you spare a few hours?" },
      { key: "body", label: "Anything to add", placeholder: "Optional.", long: true },
    ],
  },
  {
    kind: "contact",
    label: "Where to find us",
    describes: "Address and phone, from your shop details.",
    live: true,
    fields: [{ key: "heading", label: "Heading", placeholder: "Where to find us" }],
  },
] as const;

export function blockSpec(kind: BlockKind): BlockSpec | undefined {
  return BLOCKS.find((b) => b.kind === kind);
}

export interface Block {
  kind: BlockKind;
  heading: string;
  body: string;
}

/**
 * What a new shop's front page looks like before anybody touches it.
 *
 * Deliberately mostly live blocks. A shop that never opens this editor still
 * gets a correct, useful page — which is the outcome most of them will have,
 * and it should be a good one rather than a placeholder apologising for itself.
 */
export const DEFAULT_HOME: Block[] = [
  {
    kind: "intro",
    heading: "",
    body: "",
  },
  { kind: "featured", heading: "In at the moment", body: "" },
  { kind: "hours", heading: "When we're open", body: "" },
  { kind: "donate", heading: "Donating things", body: "" },
  { kind: "impact", heading: "What your shopping does", body: "" },
  { kind: "contact", heading: "Where to find us", body: "" },
];

const KINDS = new Set<string>(BLOCKS.map((b) => b.kind));

/**
 * Parse stored blocks. Total and forgiving — a page that fails to parse must
 * render as an empty page, never as a 500 on a shop's public website.
 */
export function parseBlocks(json: string | null | undefined): Block[] {
  if (!json) return [];

  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];

  return raw
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .filter((item) => KINDS.has(String(item.kind)))
    .slice(0, 24)
    .map((item) => ({
      kind: String(item.kind) as BlockKind,
      heading: typeof item.heading === "string" ? item.heading.trim().slice(0, 120) : "",
      body: typeof item.body === "string" ? item.body.trim().slice(0, 2000) : "",
    }));
}

export function serialiseBlocks(blocks: Block[]): string {
  return JSON.stringify(
    blocks.slice(0, 24).map((b) => ({
      kind: b.kind,
      heading: b.heading.slice(0, 120),
      body: b.body.slice(0, 2000),
    }))
  );
}

/* ─── Slugs ─────────────────────────────────────────────────────────────── */

/**
 * A shop's slug shares a namespace with every system route, because its page
 * lives at /{slug}. Reserved words are in the database rather than in code, so
 * adding a marketing page tomorrow fails loudly at deploy time instead of
 * quietly stealing somebody's URL.
 */
export async function slugAvailable(
  db: D1Database,
  slug: string,
  forOrgId?: string
): Promise<{ ok: boolean; reason: string | null }> {
  const clean = slug.trim().toLowerCase();

  if (!/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/.test(clean)) {
    return {
      ok: false,
      reason:
        "Use letters, numbers, and hyphens — three characters or more, starting and ending with a letter or number.",
    };
  }

  const { first } = await import("./db");

  const reserved = await first<{ reason: string }>(
    db,
    `SELECT reason FROM reserved_slugs WHERE slug = ?`,
    clean
  );
  if (reserved) {
    return { ok: false, reason: "That one's taken by the software itself. Pick another." };
  }

  const taken = await first<{ id: string }>(
    db,
    `SELECT id FROM orgs WHERE slug = ? AND id <> COALESCE(?, '')`,
    clean,
    forOrgId ?? null
  );
  if (taken) {
    return { ok: false, reason: "Another shop already has that address." };
  }

  return { ok: true, reason: null };
}

/** Turn a shop name into a usable slug. Not authoritative — just a start. */
export function suggestSlug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40)
      .replace(/-+$/, "") || "shop"
  );
}
