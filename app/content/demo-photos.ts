/**
 * The demo shop's photographs — and they are meant to be bad.
 *
 * Everything else in this codebase generates images that flatter. These do the
 * opposite, on purpose. They are what a volunteer's phone actually produces in
 * a back room on a Tuesday: a jumper on a carpet, a lamp on a worktop next to
 * a kettle, a shadow across half the frame, the item shot from too far away
 * and slightly off square.
 *
 * That is the point of the demo. A cleanup tool shown against studio input is
 * a tool demonstrating nothing — the "before" has to be recognisably somebody's
 * own back room or nobody believes the "after". So the house style below is a
 * list of faults, and the prompts ask for clutter by name.
 *
 * These are the *input*. Nothing here is retouched, and the tidied version is
 * never generated: it is produced by the real cleanup, at request time, from
 * these exact bytes. There is no "after" file anywhere in this repository,
 * because an "after" that was drawn rather than computed would be a lie about
 * what the product does.
 *
 * The two rules from the marketing imagery still hold: no people, and nothing
 * that could read as a real shop.
 */

export interface DemoPhoto {
  /** Filename stem. The generated file is /img/demo/{id}.jpg. */
  id: string;
  /** Title the seeded item carries. Must describe what's in the frame. */
  title: string;
  /** One of the demo seed's own categories. */
  category: "Outerwear" | "Tops" | "Housewares" | "Books" | "Furniture" | "Toys & Games";
  /** One of the demo seed's own colours. */
  color: string;
  /** In cents. Sits inside the category's band in the seed. */
  priceCents: number;
  /** What a shop would have paid for it new, in cents. */
  retailCents: number;
  weightLbs: number;
  condition: "excellent" | "good" | "fair";
  /** Shown on the listing. Written the way a volunteer writes. */
  description: string;
  prompt: string;
  /** For someone who can't see it. The subject, not the fault. */
  alt: string;
}

/**
 * The faults, appended to every prompt.
 *
 * Read this as a specification for a bad photograph. Every line is something
 * the cleanup demonstrably fixes — a cluttered background it removes, a crooked
 * framing it squares, an inconsistent distance it normalises — or something it
 * deliberately leaves alone, like the wear on the item itself.
 *
 * Deliberately *not* asked for: blur and heavy noise. The cleanup does not
 * sharpen or denoise, so a blurry "before" would set up an "after" the product
 * can't deliver, and the whole point of this set is that it doesn't oversell.
 */
export const SNAPSHOT_STYLE = [
  "amateur smartphone snapshot, casual and unstyled",
  "photographed on a domestic carpet, worn table or laminate worktop",
  "cluttered domestic background, other household objects visible around the edges",
  "uneven overhead room lighting, hard shadow falling across part of the frame",
  "slightly crooked framing, item not centred, too much empty space around it",
  "flat phone-camera colour, mild colour cast from artificial light",
  "visible signs of use on the item, honest wear, nothing staged or repaired",
  "no people, no faces, no hands",
  "no text, no lettering, no signage, no logos, no watermarks",
].join(", ");

/** The prompt actually sent, faults and all. */
export function snapshotPrompt(photo: DemoPhoto): string {
  return `${photo.prompt}. ${SNAPSHOT_STYLE}`;
}

/** Square: it is what a phone hands over and what the cleanup targets. */
export const DEMO_PHOTO_SIZE = 1024;

/** Where the bundled file lives, and where its bytes end up in R2. */
export const demoAssetPath = (id: string) => `img/demo/${id}.jpg`;
export const demoMediaKey = (id: string) => `photos/demo/${id}.jpg`;

export const DEMO_PHOTOS: readonly DemoPhoto[] = [
  {
    id: "peacoat",
    title: "Navy wool peacoat",
    category: "Outerwear",
    color: "navy",
    priceCents: 2200,
    retailCents: 9000,
    weightLbs: 2.4,
    condition: "good",
    description:
      "Heavy navy wool, double breasted, all buttons present. Lining is sound. Slight shine on the elbows from wear.",
    prompt:
      "a navy wool double-breasted peacoat laid flat on a beige domestic carpet, one sleeve folded awkwardly under itself, a table leg and a plastic laundry basket intruding at the edge of the frame",
    alt: "A navy double-breasted wool peacoat laid flat, photographed from above.",
  },
  {
    id: "denim-jacket",
    title: "Cream denim jacket",
    category: "Outerwear",
    color: "cream",
    priceCents: 1400,
    retailCents: 6500,
    weightLbs: 1.8,
    condition: "good",
    description:
      "Faded cream denim, classic cut. Fraying at one cuff, which we've photographed. Everything else is solid.",
    prompt:
      "a faded cream denim jacket draped over the back of a kitchen chair, photographed from slightly too far away, a cluttered worktop and a kettle out of focus behind it",
    alt: "A faded cream denim jacket over the back of a chair.",
  },
  {
    id: "cable-knit",
    title: "Forest green cable knit sweater",
    category: "Tops",
    color: "forest green",
    priceCents: 750,
    retailCents: 3200,
    weightLbs: 0.6,
    condition: "excellent",
    description:
      "Thick cable knit in a deep green. No holes, no pilling to speak of. Wool blend — cool wash.",
    prompt:
      "a thick forest green cable knit wool sweater crumpled slightly on a dark patterned rug, shot at an angle, a corner of a sofa and a remote control visible at the edge",
    alt: "A forest green cable knit sweater on a patterned rug.",
  },
  {
    id: "flannel",
    title: "Rust flannel shirt",
    category: "Tops",
    color: "rust",
    priceCents: 480,
    retailCents: 2800,
    weightLbs: 0.6,
    condition: "good",
    description: "Soft brushed cotton in rust and cream check. Worn in, in the good way.",
    prompt:
      "a rust and cream checked flannel shirt laid on a scratched wooden dining table, one collar point turned up, a mug and a stack of post beside it",
    alt: "A rust and cream checked flannel shirt laid flat on a wooden table.",
  },
  {
    id: "blouse",
    title: "Mustard cotton blouse",
    category: "Tops",
    color: "mustard",
    priceCents: 620,
    retailCents: 3000,
    weightLbs: 0.5,
    condition: "good",
    description: "Mustard cotton, short sleeves, buttons all present. Small mark on the hem.",
    prompt:
      "a mustard yellow cotton short-sleeved blouse on a hanger hooked over a door frame, the hallway behind it dim and cluttered, harsh overhead light from above",
    alt: "A mustard cotton blouse on a hanger.",
  },
  {
    id: "skillet",
    title: "Charcoal cast iron skillet",
    category: "Housewares",
    color: "charcoal",
    priceCents: 1450,
    retailCents: 4500,
    weightLbs: 4.2,
    condition: "good",
    description:
      "Heavy cast iron, ten inch. Seasoned and ready to use. Some surface rust on the handle, easily taken off.",
    prompt:
      "a well-used black cast iron skillet sitting on a cluttered laminate kitchen worktop, crumbs and a tea towel nearby, lit from directly overhead with a hard shadow under the pan",
    alt: "A well-used cast iron skillet on a kitchen worktop.",
  },
  {
    id: "mug-set",
    title: "Cream ceramic mug set",
    category: "Housewares",
    color: "cream",
    priceCents: 890,
    retailCents: 3200,
    weightLbs: 2.6,
    condition: "excellent",
    description: "Four matching cream stoneware mugs. No chips, no crazing. Dishwasher safe.",
    prompt:
      "four matching cream stoneware mugs grouped unevenly on a worn wooden table, one turned the wrong way, a cereal box and a bottle in the background",
    alt: "Four cream stoneware mugs grouped on a wooden table.",
  },
  {
    id: "table-lamp",
    title: "Burgundy table lamp",
    category: "Housewares",
    color: "burgundy",
    priceCents: 1650,
    retailCents: 5500,
    weightLbs: 3.4,
    condition: "good",
    description:
      "Ceramic base in a deep burgundy with its original shade. Tested and working. Takes a standard bulb.",
    prompt:
      "a deep burgundy ceramic table lamp with a plain fabric shade standing on a side table against a busy patterned wallpaper, its flex trailing across the frame",
    alt: "A burgundy ceramic table lamp with a fabric shade.",
  },
  {
    id: "casserole",
    title: "Rust Pyrex casserole dish",
    category: "Housewares",
    color: "rust",
    priceCents: 1200,
    retailCents: 4000,
    weightLbs: 3.1,
    condition: "good",
    description: "Vintage glass casserole with its lid. Light utensil marks inside, no cracks.",
    prompt:
      "a vintage burnt-orange glass casserole dish with a matching lid, sitting slightly off-centre on a cluttered kitchen counter beside a chopping board and a jar of utensils",
    alt: "A vintage burnt-orange glass casserole dish with its lid.",
  },
  {
    id: "cookbook",
    title: "Navy hardback cookbook",
    category: "Books",
    color: "navy",
    priceCents: 320,
    retailCents: 1800,
    weightLbs: 1.6,
    condition: "good",
    description: "Hardback with a navy cloth cover, no jacket. Pages clean. Spine barely creased.",
    prompt:
      "a navy cloth-bound hardback cookbook with no dust jacket lying flat on a dark carpet, photographed from a low angle so it looks slightly distorted, a shoe and a bag strap in the corner",
    alt: "A navy cloth-bound hardback cookbook lying flat.",
  },
  {
    id: "side-table",
    title: "Oak side table",
    category: "Furniture",
    color: "cream",
    priceCents: 4200,
    retailCents: 18000,
    weightLbs: 18,
    condition: "good",
    description:
      "Solid oak, one drawer, turned legs. Ring mark on the top which sands out or lives with you.",
    prompt:
      "a small solid oak side table with a single drawer and turned legs, standing in the corner of a cluttered garage, boxes and a bicycle wheel behind it, uneven strip lighting",
    alt: "A small solid oak side table with one drawer and turned legs.",
  },
  {
    id: "wooden-puzzle",
    title: "Forest green wooden puzzle",
    category: "Toys & Games",
    color: "forest green",
    priceCents: 380,
    retailCents: 2000,
    weightLbs: 1.1,
    condition: "good",
    description:
      "Wooden shape puzzle in its frame. We've counted the pieces and they're all here.",
    prompt:
      "a wooden children's shape puzzle board with coloured pieces, green frame, lying on a rug with a few pieces sitting loose beside it, toys scattered at the edge of the frame",
    alt: "A wooden children's shape puzzle board with coloured pieces.",
  },
] as const;

/**
 * The pair the help centre shows.
 *
 * Chosen by looking at all twelve run through the real cleanup, not by
 * guessing. The coat wins on both halves: the snapshot is unmistakably
 * somebody's floor — laundry basket, table legs, hard shadow — and the cut-out
 * comes back whole, with the scuffed cuff and the marks down the front still
 * there. That last part is the argument. A pairing where the item came back
 * looking better than it went in would undo everything this page says.
 *
 * The jumper on the rug was the first choice and lost: the cut-out takes a
 * sliver of cushion with it. That is honest — it is why a person reviews every
 * one — but it is not the picture to lead with.
 */
export const DEMO_BEFORE_AFTER = "peacoat";
