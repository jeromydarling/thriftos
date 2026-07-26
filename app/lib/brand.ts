/**
 * The shop's brand.
 *
 * A typed kit with one parser and one serialiser, following the same rule as
 * settings.ts — a free-form JSON blob read from three places is how the tax
 * bug happened, and a brand read by the storefront, the studio, and every
 * generated asset is exactly that shape of risk.
 *
 * The part worth caring about is `contrast()`. A shop will pick two colours it
 * likes off a colour wheel, and roughly half the time the pair fails WCAG on
 * body text. Nobody in the shop will notice, because they know what the sign
 * says. The people who will notice are the ones who can't read it — which for a
 * charity shop is not a hypothetical audience. So the studio checks every pair
 * as it's chosen, says plainly when a combination won't be readable, and offers
 * a corrected shade rather than just refusing.
 */

export interface BrandKit {
  /** Primary — used for headings, the wordmark, and large surfaces. */
  primary: string;
  /** Accent — used sparingly, for one thing at a time. */
  accent: string;
  /** Text colour on light surfaces. */
  ink: string;
  /** Page background. */
  surface: string;
  /** One of the pairings below. Shops don't want a font picker. */
  typeface: TypefaceId;
  /** A line under the name. Not a slogan — what the shop actually does. */
  tagline: string;
  /**
   * How the shop sounds. Used to steer AI copy drafts and shown in the kit as
   * a reminder to whoever writes the newsletter.
   */
  voice: VoiceId;
  /** Sentences the shop wants on assets — hours, a policy, a standing line. */
  boilerplate: string;
}

export type TypefaceId = "warm" | "plain" | "classic" | "bold";
export type VoiceId = "warm" | "practical" | "spirited" | "quiet";

export interface Typeface {
  id: TypefaceId;
  name: string;
  /** How it reads, in words a person without a design vocabulary would use. */
  feels: string;
  display: string;
  body: string;
}

/**
 * Four pairings, not a font picker.
 *
 * Every one is a system-font stack. That is deliberate: a printed sign renders
 * on whatever machine is attached to the printer, and a webfont that fails to
 * load leaves a poster in Times New Roman half an hour before it goes in the
 * window.
 */
export const TYPEFACES: readonly Typeface[] = [
  {
    id: "warm",
    name: "Warm",
    feels: "Friendly and a bit handmade. Suits a shop that knows its regulars.",
    display: "Georgia, 'Iowan Old Style', 'Palatino Linotype', serif",
    body: "-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  },
  {
    id: "plain",
    name: "Plain",
    feels: "Clear and modern. Reads well at a distance and on a phone.",
    display: "-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    body: "-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  },
  {
    id: "classic",
    name: "Classic",
    feels: "Settled and institutional. Suits a shop attached to a church or hospital.",
    display: "'Times New Roman', Times, serif",
    body: "Georgia, 'Iowan Old Style', serif",
  },
  {
    id: "bold",
    name: "Bold",
    feels: "Loud. Good for sale signage that has to work from across the road.",
    display: "'Arial Black', 'Helvetica Neue', Impact, sans-serif",
    body: "-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  },
] as const;

export interface Voice {
  id: VoiceId;
  name: string;
  describes: string;
  /** Handed to the model when drafting copy. Never shown as marketing text. */
  guidance: string;
}

export const VOICES: readonly Voice[] = [
  {
    id: "warm",
    name: "Warm",
    describes: "Like a neighbour, not a retailer.",
    guidance:
      "Write like someone who knows the customers by name. Plain words, short sentences, no exclamation marks, no urgency. Never call anyone a shopper or a consumer.",
  },
  {
    id: "practical",
    name: "Practical",
    describes: "Says what's true and stops.",
    guidance:
      "State the facts and stop. No adjectives that can't be checked. No 'amazing', no 'incredible', no 'don't miss out'.",
  },
  {
    id: "spirited",
    name: "Spirited",
    describes: "Cheerful, but not shouty.",
    guidance:
      "Light and a little playful. One joke at most. Still never invents a claim, and still never uses false urgency.",
  },
  {
    id: "quiet",
    name: "Quiet",
    describes: "Understated. Lets the goods speak.",
    guidance:
      "Spare and calm. Short. Trust the reader. Never oversell, never pad, never use a superlative.",
  },
] as const;

// Lowercase because that's the form `colour()` normalises to. A default that
// doesn't survive its own round-trip is a small bug that produces a confusing
// diff the first time anyone saves a kit without changing anything.
export const DEFAULT_BRAND: BrandKit = {
  primary: "#2f6f5e",
  accent: "#e4a33c",
  ink: "#2a2724",
  surface: "#faf7f2",
  typeface: "warm",
  tagline: "",
  voice: "warm",
  boilerplate: "",
};

/* ─── Parsing ───────────────────────────────────────────────────────────── */

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Normalise to 6-digit lowercase hex, or fall back. Never throws. */
export function colour(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  if (!HEX.test(trimmed)) return fallback;
  const hex = trimmed.slice(1).toLowerCase();
  return hex.length === 3
    ? `#${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}`
    : `#${hex}`;
}

export function parseBrandKit(json: string | null | undefined): BrandKit {
  if (!json) return { ...DEFAULT_BRAND };

  let raw: Record<string, unknown>;
  try {
    const parsed = JSON.parse(json);
    raw = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return { ...DEFAULT_BRAND };
  }

  const typeface = TYPEFACES.some((t) => t.id === raw.typeface)
    ? (raw.typeface as TypefaceId)
    : DEFAULT_BRAND.typeface;
  const voice = VOICES.some((v) => v.id === raw.voice)
    ? (raw.voice as VoiceId)
    : DEFAULT_BRAND.voice;

  return {
    primary: colour(raw.primary, DEFAULT_BRAND.primary),
    accent: colour(raw.accent, DEFAULT_BRAND.accent),
    ink: colour(raw.ink, DEFAULT_BRAND.ink),
    surface: colour(raw.surface, DEFAULT_BRAND.surface),
    typeface,
    voice,
    tagline: typeof raw.tagline === "string" ? raw.tagline.trim().slice(0, 120) : "",
    boilerplate: typeof raw.boilerplate === "string" ? raw.boilerplate.trim().slice(0, 400) : "",
  };
}

export function serialiseBrandKit(kit: BrandKit): string {
  return JSON.stringify(kit);
}

export function typefaceFor(kit: BrandKit): Typeface {
  return TYPEFACES.find((t) => t.id === kit.typeface) ?? TYPEFACES[0];
}

export function voiceFor(kit: BrandKit): Voice {
  return VOICES.find((v) => v.id === kit.voice) ?? VOICES[0];
}

/* ─── Contrast ──────────────────────────────────────────────────────────── */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export function toRgb(hex: string): Rgb {
  const clean = colour(hex, "#000000").slice(1);
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16),
  };
}

export function toHex({ r, g, b }: Rgb): string {
  const part = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${part(r)}${part(g)}${part(b)}`;
}

/** WCAG relative luminance. */
export function luminance(hex: string): number {
  const { r, g, b } = toRgb(hex);
  const channel = (value: number) => {
    const v = value / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio, 1 (identical) to 21 (black on white). */
export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [light, dark] = la > lb ? [la, lb] : [lb, la];
  return (light + 0.05) / (dark + 0.05);
}

export type ContrastVerdict = "fails" | "large-only" | "passes" | "excellent";

export interface ContrastCheck {
  ratio: number;
  verdict: ContrastVerdict;
  /** What this means, for someone who has never heard of WCAG. */
  advice: string;
}

/**
 * Check a foreground against a background.
 *
 * Written to be read by a volunteer, not an accessibility auditor. "4.1:1"
 * means nothing to anybody; "this will be hard to read on a sign" does.
 */
export function checkContrast(foreground: string, background: string): ContrastCheck {
  const ratio = contrast(foreground, background);

  if (ratio < 3) {
    return {
      ratio,
      verdict: "fails",
      advice:
        "These two are too close together — text in this colour will be hard to read for a lot of people, and unreadable for some. Worth changing.",
    };
  }
  if (ratio < 4.5) {
    return {
      ratio,
      verdict: "large-only",
      advice:
        "Fine for a big headline, not for body text or anything on a price tag. Darken one of them if you want to use it for ordinary text.",
    };
  }
  if (ratio < 7) {
    return {
      ratio,
      verdict: "passes",
      advice: "Readable at any size. This pair is fine.",
    };
  }
  return {
    ratio,
    verdict: "excellent",
    advice: "Very legible, including in poor light and on a cheap printer.",
  };
}

/**
 * Nudge a colour until it's readable against a background.
 *
 * Steps toward black or white in small increments rather than jumping to a
 * "safe" colour, so the result is still recognisably the shade the shop chose.
 * Returns the original if it's already fine, and gives up gracefully rather
 * than looping — at which point the honest answer is to pick a different hue.
 */
export function readableAgainst(foreground: string, background: string, target = 4.5): string {
  if (contrast(foreground, background) >= target) return foreground;

  const towardsBlack = luminance(background) > 0.5;
  let current = toRgb(foreground);

  for (let step = 0; step < 40; step++) {
    current = towardsBlack
      ? { r: current.r * 0.92, g: current.g * 0.92, b: current.b * 0.92 }
      : {
          r: current.r + (255 - current.r) * 0.08,
          g: current.g + (255 - current.g) * 0.08,
          b: current.b + (255 - current.b) * 0.08,
        };

    const candidate = toHex(current);
    if (contrast(candidate, background) >= target) return candidate;
  }

  // Nothing in this hue works. Black or white always does.
  return towardsBlack ? "#000000" : "#ffffff";
}

/**
 * The colours an asset actually draws with.
 *
 * Every generated asset uses these rather than the raw kit, so a shop that
 * picked a pale yellow accent gets a legible sign instead of a blank one. The
 * shop's own colours are still used wherever they're legible — this only
 * corrects the pairs that would fail.
 */
export interface RenderPalette {
  primary: string;
  accent: string;
  ink: string;
  surface: string;
  /** Legible text on a primary-coloured block. */
  onPrimary: string;
  /** Legible text on an accent-coloured block. */
  onAccent: string;
  /** The kit's ink, corrected if it fails against the surface. */
  bodyText: string;
  /** Primary, corrected if it fails against the surface. */
  headingText: string;
}

export function renderPalette(kit: BrandKit): RenderPalette {
  const onPrimary = contrast("#ffffff", kit.primary) >= 4.5 ? "#ffffff" : "#000000";
  const onAccent = contrast("#ffffff", kit.accent) >= 4.5 ? "#ffffff" : "#000000";

  return {
    primary: kit.primary,
    accent: kit.accent,
    ink: kit.ink,
    surface: kit.surface,
    onPrimary,
    onAccent,
    bodyText: readableAgainst(kit.ink, kit.surface),
    headingText: readableAgainst(kit.primary, kit.surface),
  };
}

/** Every check the studio shows, so nothing is silently wrong. */
export function auditBrand(kit: BrandKit): { label: string; check: ContrastCheck }[] {
  return [
    { label: "Body text on the page", check: checkContrast(kit.ink, kit.surface) },
    { label: "Headings on the page", check: checkContrast(kit.primary, kit.surface) },
    { label: "White text on your primary colour", check: checkContrast("#ffffff", kit.primary) },
    { label: "White text on your accent colour", check: checkContrast("#ffffff", kit.accent) },
    { label: "Your accent against the page", check: checkContrast(kit.accent, kit.surface) },
  ];
}

/**
 * A wordmark from the shop's name, for when there's no logo.
 *
 * Two or three letters, chosen the way a person would: initials of the words
 * that matter, skipping the ones nobody would abbreviate.
 */
export function initialsFor(name: string): string {
  const skip = new Set(["the", "of", "and", "for", "a", "an", "at", "on", "in"]);
  const words = name
    .split(/\s+/)
    .map((w) => w.replace(/[^a-z0-9]/gi, ""))
    .filter((w) => w && !skip.has(w.toLowerCase()));

  if (words.length === 0) return name.slice(0, 2).toUpperCase() || "TS";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return words
    .slice(0, 3)
    .map((w) => w[0].toUpperCase())
    .join("");
}
