/**
 * The homepage's photography, and the prompts that made it.
 *
 * Every image here was generated once with FLUX.2 on Workers AI, committed,
 * and is served as a static file. Not generated per request: a marketing page
 * that re-renders its own photographs costs money on every visit, takes a
 * second to paint, and can quietly change what it shows. Generated once and
 * checked in, it is a photograph like any other — reviewable in a diff and
 * identical for everyone.
 *
 * The prompts live next to the alt text on purpose. They are the closest thing
 * we have to a negative, and the alt text should describe what was actually
 * asked for.
 *
 * Two rules hold across the whole set:
 *
 *   No people. Generated faces are the fastest way to look synthetic, and a
 *   photograph of a volunteer who doesn't exist, on a page arguing that our
 *   numbers are computed rather than invented, is a bad trade. Objects,
 *   textures and rooms carry the warmth without the claim.
 *
 *   Nothing that could read as a real shop. No legible signage, no logos, no
 *   named premises. These are atmosphere, not evidence.
 */

export interface Shot {
  /** Filename stem. The generated file is /img/{id}.jpg. */
  id: string;
  /** What it's for, in one line — read by whoever regenerates the set. */
  purpose: string;
  prompt: string;
  /** Written for someone who can't see it, describing the subject not the style. */
  alt: string;
  width: number;
  height: number;
}

/**
 * The house style, appended to every prompt.
 *
 * 35mm film stock is doing real work here rather than being a mood: grain,
 * halation and a slightly imperfect colour response are what generated images
 * most often lack, and their absence is what makes a picture read as rendered.
 * Portra is chosen for how it handles warm interior light without going
 * orange.
 */
export const HOUSE_STYLE = [
  "shot on 35mm film, Kodak Portra 400, visible fine grain",
  "natural window light, no flash, soft falloff into shadow",
  "shallow depth of field, slight lens softness at the edges",
  "muted warm colour, gentle halation on highlights",
  "documentary still life, unstyled, slightly imperfect",
  "no people, no faces, no hands",
  "no text, no lettering, no signage, no logos, no watermarks",
].join(", ");

export const SHOTS: readonly Shot[] = [
  {
    id: "shopfloor",
    purpose: "Hero backdrop, behind the headline. Sits under a heavy wash — needs to work soft.",
    prompt:
      "The interior of a small second-hand clothing shop on a quiet afternoon, seen from the back of the room. Two wooden rails of coats and knitwear recede toward a front window. Worn floorboards, a mismatched armchair, a stack of hardback books on a side table. Late afternoon sun falls in a long slab across the floor. Dust in the light.",
    alt: "The inside of a small second-hand shop, rails of coats leading toward a sunlit front window.",
    width: 1024,
    height: 1024,
  },
  {
    id: "rail",
    purpose: "Beside 'The bigger saving isn't money. It's Tuesday afternoon.'",
    prompt:
      "Close view along a rail of second-hand wool coats in muted greens, rust and navy, hung shoulder to shoulder. Small blank coloured paper tags on string hang from a few of the sleeves. Soft light from the left. The far end of the rail falls out of focus.",
    alt: "A rail of second-hand wool coats hung close together, small coloured paper tags on some of the sleeves.",
    width: 1024,
    height: 1024,
  },
  {
    id: "counter",
    purpose: "The register/payments section. Must not show a branded card reader.",
    prompt:
      "A shop counter in a second-hand shop, photographed from slightly above at an angle. A worn wooden surface, a stack of folded brown paper bags, a jam jar of biros, a roll of string, a small plain white card reader face down, a tin of coins. Morning light from a window out of frame.",
    alt: "A worn wooden shop counter with folded paper bags, a jar of pens, a roll of string and a tin of coins.",
    width: 1024,
    height: 1024,
  },
  {
    id: "tags",
    purpose: "Texture band. Colour-tag markdown is the one mechanic worth showing literally.",
    prompt:
      "Macro still life of a handful of blank coloured paper price tags — yellow, green, blue, red, orange — threaded on cotton string and overlapping on a pale linen surface. Extremely shallow focus, the nearest tag sharp and the rest dissolving. Soft directional light.",
    alt: "Blank coloured paper price tags on cotton string, overlapping on a pale linen surface.",
    width: 1024,
    height: 1024,
  },
  {
    id: "backroom",
    purpose: "The intake/sorting story. The unglamorous half of the work.",
    prompt:
      "A sorting room behind a charity shop in the early morning. Cardboard boxes stacked three high, folded textiles in muted colours spilling from an open crate, a set of hanging scales, a roll of bin bags on a shelf. Cool light through a high window. Cluttered but orderly.",
    alt: "A charity shop's sorting room: stacked cardboard boxes, folded textiles in an open crate, hanging scales.",
    width: 1024,
    height: 1024,
  },
  {
    id: "window",
    purpose: "Closing section, behind the invitation to open the demo.",
    prompt:
      "A shop front window seen from inside at dusk, the glass reflecting the dim interior. A pair of empty wooden display plinths, a folded blanket, a ceramic vase. Blue evening light outside, warm lamplight inside. Quiet, closed for the day.",
    alt: "A shop's front window at dusk seen from inside, empty wooden display plinths and a ceramic vase.",
    width: 1024,
    height: 1024,
  },
] as const;

/** The full prompt sent to the model, house style included. */
export function fullPrompt(shot: Shot): string {
  return `${shot.prompt} ${HOUSE_STYLE}.`;
}

export function shot(id: string): Shot | undefined {
  return SHOTS.find((s) => s.id === id);
}

/** Where a shot lives once generated. */
export function shotSrc(id: string): string {
  return `/img/${id}.jpg`;
}
