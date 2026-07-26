/**
 * The asset generator.
 *
 * Every asset here is drawn from records the shop already keeps: the real
 * markdown ladder, the real address and hours, real diversion weight, real
 * stock. That is the entire argument for building this rather than pointing
 * shops at Canva — a sale sign that says "BLUE TAGS 50% OFF" is only useful if
 * blue tags are actually 50% off today, and nothing outside this app knows
 * that.
 *
 * Output is SVG, for three reasons that all matter to a shop with one printer:
 *
 *   • It prints crisply at any size. A poster enlarged to A2 on the library
 *     photocopier still looks deliberate.
 *   • It needs no headless browser, so it renders inside the Worker.
 *   • The browser can rasterise it to PNG on the client for social, using
 *     canvas and no dependency at all.
 *
 * Nothing here invents a number. If a shop has no impact figures yet, the
 * impact poster says so rather than printing zeroes in a large font.
 */
import type { BrandKit, RenderPalette } from "../brand";
import { initialsFor, renderPalette, typefaceFor } from "../brand";

export type AssetKind =
  | "sale_sign"
  | "tag_ladder"
  | "donation_poster"
  | "impact_poster"
  | "hours_card"
  | "social_arrival"
  | "volunteer_call"
  | "shelf_talker";

export interface AssetSpec {
  kind: AssetKind;
  /** Width and height in points. 72pt = 1in, so 612×792 is US Letter. */
  width: number;
  height: number;
  label: string;
  /** What it's for, in the words a shop manager would use. */
  purpose: string;
  /** Where it ends up, so the studio can group by that rather than by size. */
  medium: "print" | "social" | "counter";
}

/** US Letter portrait, the paper every American shop actually has. */
const LETTER = { width: 612, height: 792 };
/** Square, for the platforms shops actually post to. */
const SQUARE = { width: 1080, height: 1080 };

export const ASSETS: readonly AssetSpec[] = [
  {
    kind: "sale_sign",
    ...LETTER,
    label: "Today's sale sign",
    purpose:
      "One tag colour, one discount, in letters readable from the pavement. Reads today's markdown ladder, so it can't be out of date.",
    medium: "print",
  },
  {
    kind: "tag_ladder",
    ...LETTER,
    label: "How our colour tags work",
    purpose:
      "The whole rotation on one sheet for the wall by the till. Answers the question volunteers get asked twenty times a day.",
    medium: "print",
  },
  {
    kind: "donation_poster",
    ...LETTER,
    label: "What we can take",
    purpose:
      "Donation hours, the address, and what you can and can't accept. The single most useful thing to put in a window.",
    medium: "print",
  },
  {
    kind: "impact_poster",
    ...LETTER,
    label: "What this shop did",
    purpose:
      "Real diversion weight, items rehomed, and volunteer hours, with the method stated. For a board packet, a grant, or the noticeboard.",
    medium: "print",
  },
  {
    kind: "volunteer_call",
    ...LETTER,
    label: "We need volunteers",
    purpose: "The shifts actually going unfilled, not a generic appeal.",
    medium: "print",
  },
  {
    kind: "social_arrival",
    ...SQUARE,
    label: "Just arrived",
    purpose:
      "A square post about stock genuinely on the floor right now, with today's price.",
    medium: "social",
  },
  {
    kind: "hours_card",
    ...SQUARE,
    label: "When we're open",
    purpose: "Opening and donation hours as a square, for a profile or a pinned post.",
    medium: "social",
  },
  {
    kind: "shelf_talker",
    width: 288,
    height: 180,
    label: "Shelf talker",
    purpose:
      "A small folded card for a rack or a shelf. Four to a sheet, for a category or a message.",
    medium: "counter",
  },
] as const;

export function assetSpec(kind: AssetKind): AssetSpec {
  return ASSETS.find((a) => a.kind === kind) ?? ASSETS[0];
}

/* ─── The data an asset draws on ────────────────────────────────────────── */

export interface ShopFacts {
  name: string;
  tagline: string;
  addressLines: string[];
  phone: string | null;
  siteUrl: string;
  /** The shop's real rotation, in order. */
  ladder: { tagColor: string; discountPct: number; ageDays: number }[];
  /** Real impact, or nulls where nothing has been recorded yet. */
  impact: {
    diversionLbs: number;
    itemsRehomed: number;
    volunteerHours: number;
    valueDeliveredCents: number;
  } | null;
  /** Genuinely on the floor right now. */
  arrivals: { title: string; priceCents: number; category: string | null }[];
  /** Shifts with nobody assigned, if the shop schedules any. */
  openShifts: { label: string; when: string }[];
  hours: string[];
  donationHours: string[];
  accepted: string[];
  notAccepted: string[];
}

export interface AssetOptions {
  /** For sale_sign: which colour, defaulting to the deepest live discount. */
  tagColor?: string;
  /** Free text the shop typed, already reviewed by a person. */
  headline?: string;
  body?: string;
  /** For social_arrival: which item. */
  itemIndex?: number;
}

/* ─── SVG helpers ───────────────────────────────────────────────────────── */

/** Escape for XML text content. Assets carry shop-authored strings. */
export function esc(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Break a line to fit a width, estimating from character count.
 *
 * There is no text measurement in a Worker, so this approximates using an
 * average glyph width. Deliberately conservative — a line that wraps one word
 * early looks fine, and a line that overflows the page does not.
 */
export function wrap(text: string, maxChars: number, maxLines = 4): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length <= maxChars) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    line = word;
    if (lines.length === maxLines) break;
  }
  if (line && lines.length < maxLines) lines.push(line);

  // Anything that didn't fit is signalled rather than silently dropped.
  if (lines.length === maxLines && words.join(" ").length > lines.join(" ").length) {
    lines[maxLines - 1] = `${lines[maxLines - 1]}…`;
  }
  return lines;
}

/** A stack of text lines, each on its own baseline. */
function lines(
  items: string[],
  opts: { x: number; y: number; size: number; leading?: number; fill: string; font: string; weight?: string; anchor?: string }
): string {
  const leading = opts.leading ?? opts.size * 1.25;
  return items
    .map(
      (line, i) =>
        `<text x="${opts.x}" y="${opts.y + i * leading}" font-family="${esc(opts.font)}" font-size="${opts.size}" font-weight="${opts.weight ?? "normal"}" fill="${opts.fill}" text-anchor="${opts.anchor ?? "start"}">${esc(line)}</text>`
    )
    .join("");
}

/** The shop's mark: its logo isn't available inside an SVG, so initials. */
function wordmark(facts: ShopFacts, p: RenderPalette, font: string, x: number, y: number, size = 44): string {
  const initials = initialsFor(facts.name);
  return `
    <rect x="${x}" y="${y}" width="${size}" height="${size}" rx="${size * 0.22}" fill="${p.primary}"/>
    <text x="${x + size / 2}" y="${y + size * 0.68}" font-family="${esc(font)}" font-size="${size * 0.42}" font-weight="bold" fill="${p.onPrimary}" text-anchor="middle">${esc(initials)}</text>`;
}

/** Every asset ends the same way: who this is and where to find them. */
function footer(facts: ShopFacts, p: RenderPalette, font: string, w: number, h: number): string {
  const parts = [facts.addressLines.join(", "), facts.phone, facts.siteUrl].filter(
    (part): part is string => Boolean(part)
  );
  return `
    <line x1="48" y1="${h - 74}" x2="${w - 48}" y2="${h - 74}" stroke="${p.primary}" stroke-opacity="0.25" stroke-width="1"/>
    ${lines([facts.name], { x: 48, y: h - 50, size: 15, fill: p.headingText, font, weight: "bold" })}
    ${lines(wrap(parts.join(" · "), Math.floor((w - 96) / 6.2), 2), {
      x: 48,
      y: h - 32,
      size: 11,
      leading: 14,
      fill: p.bodyText,
      font,
    })}`;
}

const money = (cents: number) => `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;

/** Rough tag-colour swatches, so a sign matches the physical tag. */
const TAG_HEX: Record<string, string> = {
  green: "#3E8E5A",
  yellow: "#E0B62C",
  blue: "#3D6FA8",
  red: "#C0453A",
  white: "#F2F0EC",
  orange: "#D4762C",
  purple: "#7A5A9E",
  pink: "#C96792",
};

/* ─── Generation ────────────────────────────────────────────────────────── */

/**
 * Render one asset to SVG.
 *
 * Pure: same brand, same facts, same options, same bytes. That makes it
 * testable without a browser and means a preview is exactly what prints.
 */
export function renderAsset(
  kind: AssetKind,
  kit: BrandKit,
  facts: ShopFacts,
  options: AssetOptions = {}
): string {
  const spec = assetSpec(kind);
  const p = renderPalette(kit);
  const type = typefaceFor(kit);
  const { width: w, height: h } = spec;

  const body = (() => {
    switch (kind) {
      case "sale_sign":
        return saleSign(kit, facts, p, type.display, type.body, w, h, options);
      case "tag_ladder":
        return tagLadder(facts, p, type.display, type.body, w, h);
      case "donation_poster":
        return donationPoster(facts, p, type.display, type.body, w, h, options);
      case "impact_poster":
        return impactPoster(facts, p, type.display, type.body, w, h);
      case "volunteer_call":
        return volunteerCall(facts, p, type.display, type.body, w, h, options);
      case "social_arrival":
        return socialArrival(facts, p, type.display, type.body, w, h, options);
      case "hours_card":
        return hoursCard(facts, p, type.display, type.body, w, h);
      case "shelf_talker":
        return shelfTalker(facts, p, type.display, type.body, w, h, options);
    }
  })();

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(spec.label)} for ${esc(facts.name)}">
  <rect width="${w}" height="${h}" fill="${p.surface}"/>
  ${body}
</svg>`;
}

function saleSign(
  kit: BrandKit,
  facts: ShopFacts,
  p: RenderPalette,
  display: string,
  bodyFont: string,
  w: number,
  h: number,
  options: AssetOptions
): string {
  // Default to the deepest live discount — that's the one worth a sign.
  const live = facts.ladder.filter((r) => r.discountPct > 0);
  const rule =
    live.find((r) => r.tagColor === options.tagColor) ??
    live.slice().sort((a, b) => b.discountPct - a.discountPct)[0];

  if (!rule) {
    return `
      ${wordmark(facts, p, display, 48, 56)}
      ${lines(wrap("No markdowns are running yet", 22, 2), {
        x: 48,
        y: 220,
        size: 46,
        leading: 56,
        fill: p.headingText,
        font: display,
        weight: "bold",
      })}
      ${lines(
        wrap(
          "Set up your colour-tag rotation in Settings and this sign will fill itself in with whatever is on offer that day.",
          52,
          4
        ),
        { x: 48, y: 350, size: 15, leading: 22, fill: p.bodyText, font: bodyFont }
      )}
      ${footer(facts, p, bodyFont, w, h)}`;
  }

  const swatch = TAG_HEX[rule.tagColor.toLowerCase()] ?? p.accent;
  const tagName = rule.tagColor.charAt(0).toUpperCase() + rule.tagColor.slice(1);

  return `
    ${wordmark(facts, p, display, 48, 48)}
    <rect x="0" y="150" width="${w}" height="330" fill="${swatch}"/>
    ${lines([`${tagName} tags`], {
      x: w / 2,
      y: 250,
      size: 54,
      fill: swatch === "#F2F0EC" ? "#2A2724" : "#ffffff",
      font: display,
      weight: "bold",
      anchor: "middle",
    })}
    ${lines([`${rule.discountPct}% off`], {
      x: w / 2,
      y: 400,
      size: 130,
      fill: swatch === "#F2F0EC" ? "#2A2724" : "#ffffff",
      font: display,
      weight: "bold",
      anchor: "middle",
    })}
    ${lines(
      wrap(
        options.headline ||
          `Every ${tagName.toLowerCase()}-tagged item on the floor, marked down at the till. No voucher, nothing to ask for.`,
        46,
        3
      ),
      { x: 48, y: 550, size: 19, leading: 28, fill: p.bodyText, font: bodyFont }
    )}
    ${lines([`Applies once a ${tagName.toLowerCase()} tag is ${rule.ageDays} days old.`], {
      x: 48,
      y: 650,
      size: 13,
      fill: p.bodyText,
      font: bodyFont,
    })}
    ${footer(facts, p, bodyFont, w, h)}`;
}

function tagLadder(
  facts: ShopFacts,
  p: RenderPalette,
  display: string,
  bodyFont: string,
  w: number,
  h: number
): string {
  const rows = facts.ladder
    .map((rule, i) => {
      const y = 250 + i * 62;
      const swatch = TAG_HEX[rule.tagColor.toLowerCase()] ?? p.accent;
      const name = rule.tagColor.charAt(0).toUpperCase() + rule.tagColor.slice(1);
      return `
        <rect x="48" y="${y - 26}" width="40" height="40" rx="8" fill="${swatch}" stroke="${p.primary}" stroke-opacity="0.2"/>
        ${lines([name], { x: 106, y, size: 22, fill: p.bodyText, font: bodyFont, weight: "bold" })}
        ${lines([rule.discountPct === 0 ? "Full price" : `${rule.discountPct}% off`], {
          x: w - 48,
          y,
          size: 22,
          fill: p.headingText,
          font: display,
          weight: "bold",
          anchor: "end",
        })}
        ${lines([rule.ageDays === 0 ? "from the day it arrives" : `after ${rule.ageDays} days`], {
          x: w - 48,
          y: y + 20,
          size: 12,
          fill: p.bodyText,
          font: bodyFont,
          anchor: "end",
        })}`;
    })
    .join("");

  return `
    ${wordmark(facts, p, display, 48, 48)}
    ${lines(["How our tags work"], {
      x: 48,
      y: 160,
      size: 40,
      fill: p.headingText,
      font: display,
      weight: "bold",
    })}
    ${lines(
      wrap(
        "Every item gets a coloured tag the day it reaches the floor. As it ages, the price steps down on its own — the till always charges today's price.",
        62,
        3
      ),
      { x: 48, y: 196, size: 14, leading: 19, fill: p.bodyText, font: bodyFont }
    )}
    ${rows}
    ${footer(facts, p, bodyFont, w, h)}`;
}

function donationPoster(
  facts: ShopFacts,
  p: RenderPalette,
  display: string,
  bodyFont: string,
  w: number,
  h: number,
  options: AssetOptions
): string {
  const yes = facts.accepted.slice(0, 7);
  const no = facts.notAccepted.slice(0, 6);

  const column = (items: string[], x: number, y: number, colour: string) =>
    items
      .map(
        (item, i) =>
          `${lines([`· ${item}`], { x, y: y + i * 24, size: 15, fill: colour, font: bodyFont })}`
      )
      .join("");

  return `
    ${wordmark(facts, p, display, 48, 48)}
    ${lines(wrap(options.headline || "Your donations keep this shop going", 26, 2), {
      x: 48,
      y: 165,
      size: 36,
      leading: 44,
      fill: p.headingText,
      font: display,
      weight: "bold",
    })}
    ${
      facts.donationHours.length > 0
        ? `<rect x="48" y="240" width="${w - 96}" height="${28 + facts.donationHours.length * 22}" rx="10" fill="${p.primary}" fill-opacity="0.08"/>
           ${lines(["Bring donations"], { x: 66, y: 266, size: 13, fill: p.headingText, font: bodyFont, weight: "bold" })}
           ${lines(facts.donationHours.slice(0, 4), { x: 66, y: 288, size: 15, leading: 22, fill: p.bodyText, font: bodyFont })}`
        : ""
    }
    ${lines(["We can take"], { x: 48, y: 410, size: 18, fill: p.headingText, font: display, weight: "bold" })}
    ${column(yes, 48, 440, p.bodyText)}
    ${lines(["We can't take"], { x: w / 2 + 12, y: 410, size: 18, fill: p.headingText, font: display, weight: "bold" })}
    ${column(no, w / 2 + 12, 440, p.bodyText)}
    ${lines(
      wrap(
        options.body ||
          "Please only bring things you'd give a friend. Sorting what can't be sold costs us money that would otherwise go to the work.",
        66,
        3
      ),
      { x: 48, y: 640, size: 14, leading: 20, fill: p.bodyText, font: bodyFont }
    )}
    ${footer(facts, p, bodyFont, w, h)}`;
}

function impactPoster(
  facts: ShopFacts,
  p: RenderPalette,
  display: string,
  bodyFont: string,
  w: number,
  h: number
): string {
  // A shop with no recorded impact gets an explanation, not four zeroes in
  // 90-point type. Printing zeroes large would be worse than printing nothing.
  if (!facts.impact || facts.impact.diversionLbs + facts.impact.itemsRehomed === 0) {
    return `
      ${wordmark(facts, p, display, 48, 48)}
      ${lines(wrap("Nothing to report yet", 22, 2), {
        x: 48,
        y: 200,
        size: 40,
        leading: 48,
        fill: p.headingText,
        font: display,
        weight: "bold",
      })}
      ${lines(
        wrap(
          "This poster fills itself in from your sales and donations. Log some stock and ring up a few sales, and it will have something true to say.",
          56,
          4
        ),
        { x: 48, y: 300, size: 16, leading: 23, fill: p.bodyText, font: bodyFont }
      )}
      ${footer(facts, p, bodyFont, w, h)}`;
  }

  const tons = facts.impact.diversionLbs / 2000;
  const figures: [string, string][] = [
    [
      tons >= 1 ? `${tons.toFixed(1)} tons` : `${Math.round(facts.impact.diversionLbs)} lbs`,
      "kept out of landfill",
    ],
    [facts.impact.itemsRehomed.toLocaleString("en-US"), "items given a second life"],
    [Math.round(facts.impact.volunteerHours).toLocaleString("en-US"), "volunteer hours given"],
    [money(facts.impact.valueDeliveredCents), "saved by the people who shop here"],
  ];

  const blocks = figures
    .map(([value, label], i) => {
      const y = 250 + i * 108;
      return `
        ${lines([value], { x: 48, y, size: 52, fill: p.headingText, font: display, weight: "bold" })}
        ${lines([label], { x: 48, y: y + 28, size: 16, fill: p.bodyText, font: bodyFont })}`;
    })
    .join("");

  return `
    ${wordmark(facts, p, display, 48, 48)}
    ${lines(wrap(`What ${facts.name} did`, 26, 2), {
      x: 48,
      y: 165,
      size: 34,
      leading: 42,
      fill: p.headingText,
      font: display,
      weight: "bold",
    })}
    ${blocks}
    ${lines(
      wrap(
        "Diversion is the weight of goods that actually left for reuse, not what arrived. Value saved counts only items where a comparable retail price was recorded — where none was, it counts nothing rather than an estimate.",
        76,
        3
      ),
      { x: 48, y: 690, size: 11, leading: 15, fill: p.bodyText, font: bodyFont }
    )}
    ${footer(facts, p, bodyFont, w, h)}`;
}

function volunteerCall(
  facts: ShopFacts,
  p: RenderPalette,
  display: string,
  bodyFont: string,
  w: number,
  h: number,
  options: AssetOptions
): string {
  const shifts = facts.openShifts.slice(0, 6);

  return `
    ${wordmark(facts, p, display, 48, 48)}
    ${lines(wrap(options.headline || "Could you spare a few hours?", 24, 2), {
      x: 48,
      y: 170,
      size: 38,
      leading: 46,
      fill: p.headingText,
      font: display,
      weight: "bold",
    })}
    ${
      shifts.length > 0
        ? `${lines(["These are the shifts we're short on right now:"], {
            x: 48,
            y: 280,
            size: 15,
            fill: p.bodyText,
            font: bodyFont,
          })}
           ${shifts
             .map(
               (shift, i) => `
             <rect x="48" y="${300 + i * 46}" width="${w - 96}" height="38" rx="8" fill="${p.primary}" fill-opacity="0.07"/>
             ${lines([shift.label], { x: 66, y: 325 + i * 46, size: 16, fill: p.bodyText, font: bodyFont, weight: "bold" })}
             ${lines([shift.when], { x: w - 66, y: 325 + i * 46, size: 15, fill: p.bodyText, font: bodyFont, anchor: "end" })}`
             )
             .join("")}`
        : lines(
            wrap(
              "We need people on the floor, on the till, and sorting donations. No experience needed — we'll show you everything.",
              54,
              3
            ),
            { x: 48, y: 290, size: 17, leading: 25, fill: p.bodyText, font: bodyFont }
          )
    }
    ${lines(
      wrap(
        options.body ||
          "Come in and ask for whoever is on, or ring us. An hour a week genuinely helps.",
        58,
        3
      ),
      { x: 48, y: 640, size: 16, leading: 23, fill: p.bodyText, font: bodyFont }
    )}
    ${footer(facts, p, bodyFont, w, h)}`;
}

function socialArrival(
  facts: ShopFacts,
  p: RenderPalette,
  display: string,
  bodyFont: string,
  w: number,
  h: number,
  options: AssetOptions
): string {
  const item = facts.arrivals[options.itemIndex ?? 0];

  if (!item) {
    return `
      ${wordmark(facts, p, display, 80, 80, 72)}
      ${lines(wrap("Nothing listed just now", 18, 2), {
        x: 80,
        y: 360,
        size: 68,
        leading: 82,
        fill: p.headingText,
        font: display,
        weight: "bold",
      })}
      ${lines(
        wrap("Log some stock and this post will fill itself in with what's actually on the floor.", 42, 3),
        { x: 80, y: 520, size: 26, leading: 36, fill: p.bodyText, font: bodyFont }
      )}`;
  }

  return `
    <rect x="0" y="0" width="${w}" height="18" fill="${p.accent}"/>
    ${wordmark(facts, p, display, 80, 90, 72)}
    ${lines(["Just in"], { x: 176, y: 140, size: 34, fill: p.bodyText, font: bodyFont })}
    ${lines(wrap(item.title, 20, 3), {
      x: 80,
      y: 380,
      size: 76,
      leading: 92,
      fill: p.headingText,
      font: display,
      weight: "bold",
    })}
    ${lines([money(item.priceCents)], {
      x: 80,
      y: 720,
      size: 96,
      fill: p.headingText,
      font: display,
      weight: "bold",
    })}
    ${
      item.category
        ? lines([item.category], { x: 80, y: 762, size: 26, fill: p.bodyText, font: bodyFont })
        : ""
    }
    ${lines(wrap("One of a kind — when it's gone, it's gone.", 40, 2), {
      x: 80,
      y: 880,
      size: 28,
      leading: 38,
      fill: p.bodyText,
      font: bodyFont,
    })}
    ${lines([facts.name, facts.addressLines[0] ?? ""].filter(Boolean), {
      x: 80,
      y: 980,
      size: 24,
      leading: 32,
      fill: p.headingText,
      font: bodyFont,
      weight: "bold",
    })}`;
}

function hoursCard(
  facts: ShopFacts,
  p: RenderPalette,
  display: string,
  bodyFont: string,
  w: number,
  h: number
): string {
  const shop = facts.hours.slice(0, 7);
  const donate = facts.donationHours.slice(0, 4);

  return `
    <rect x="0" y="0" width="${w}" height="18" fill="${p.accent}"/>
    ${wordmark(facts, p, display, 80, 90, 72)}
    ${lines(wrap(facts.name, 22, 2), {
      x: 80,
      y: 260,
      size: 56,
      leading: 68,
      fill: p.headingText,
      font: display,
      weight: "bold",
    })}
    ${lines(["We're open"], { x: 80, y: 400, size: 30, fill: p.bodyText, font: bodyFont, weight: "bold" })}
    ${
      shop.length > 0
        ? lines(shop, { x: 80, y: 450, size: 30, leading: 42, fill: p.bodyText, font: bodyFont })
        : lines(["Add your hours in Settings"], {
            x: 80,
            y: 450,
            size: 26,
            fill: p.bodyText,
            font: bodyFont,
          })
    }
    ${
      donate.length > 0
        ? `${lines(["Donations"], { x: 80, y: 760, size: 30, fill: p.bodyText, font: bodyFont, weight: "bold" })}
           ${lines(donate, { x: 80, y: 810, size: 28, leading: 40, fill: p.bodyText, font: bodyFont })}`
        : ""
    }
    ${lines(facts.addressLines.slice(0, 2), {
      x: 80,
      y: 990,
      size: 24,
      leading: 32,
      fill: p.bodyText,
      font: bodyFont,
    })}`;
}

function shelfTalker(
  facts: ShopFacts,
  p: RenderPalette,
  display: string,
  bodyFont: string,
  w: number,
  h: number,
  options: AssetOptions
): string {
  return `
    <rect x="0" y="0" width="${w}" height="8" fill="${p.accent}"/>
    ${lines(wrap(options.headline || "Everything here is one of a kind", 24, 2), {
      x: 20,
      y: 52,
      size: 20,
      leading: 26,
      fill: p.headingText,
      font: display,
      weight: "bold",
    })}
    ${lines(wrap(options.body || facts.tagline || "When it's gone, it's gone.", 40, 3), {
      x: 20,
      y: 110,
      size: 12,
      leading: 17,
      fill: p.bodyText,
      font: bodyFont,
    })}
    ${lines([facts.name], { x: 20, y: h - 18, size: 11, fill: p.headingText, font: bodyFont, weight: "bold" })}`;
}
