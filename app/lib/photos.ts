/**
 * Turning a back-room snapshot into a product shot.
 *
 * One rule runs through this file and it is not negotiable:
 *
 *   **Enhance the photograph. Never the item.**
 *
 * Straighten it, light it, drop out the cluttered background, put it on a clean
 * seamless — all fair. Remove a stain, close a moth hole, make faded black
 * cotton read as new black cotton — never. These are used goods sold by
 * charities; a listing that flatters the item drives returns and destroys the
 * one asset a charity shop actually has. It is also the exact opposite of the
 * argument the rest of this product makes about numbers being computed rather
 * than invented.
 *
 * The tooling is chosen to make that rule hard to break rather than merely
 * stated. Cloudflare Images transformations are *deterministic*: `segment`
 * isolates the real pixels, `trim` crops to them, `background` puts a colour
 * behind them. None of them can invent a garment that isn't there. A generative
 * model could, so none is used on the item.
 */

/**
 * The two grounds an item can sit on.
 *
 * Light is right most of the time and is the default. Dark exists because a
 * pale item on a pale ground is a photograph of almost nothing — four cream
 * mugs on a cream seamless lose their edges entirely, and no amount of
 * cutting-out fixes that. The fix is contrast, and contrast is a choice about
 * the item rather than about the shop.
 *
 * Neither is pure: #fff behind a white mug is the same problem, and pure black
 * turns a dark coat into a hole. Both are warm and slightly off, which is also
 * what a real paper seamless looks like.
 */
export const SEAMLESS = {
  light: "#f6f4f0",
  dark: "#33302c",
} as const;

export type Ground = keyof typeof SEAMLESS;

export function isGround(value: string): value is Ground {
  return value === "light" || value === "dark";
}

export interface EnhanceOptions {
  /** The seamless behind the subject. A shop's own surface colour by default. */
  background: string;
  /** Square by default: every listing grid wants the same shape. */
  size?: number;
  /** Breathing room around the subject, as a fraction of the frame. */
  padding?: number;
}

/**
 * How the contact shadow is built, and why there is one at all.
 *
 * Cutting an item out takes its shadow with it, and an object with no shadow
 * doesn't look like an object on a surface — it looks pasted. That reads as
 * fake, which on a page arguing for honesty is the worst possible impression.
 *
 * The shadow is derived from the item's own silhouette rather than drawn as a
 * generic ellipse: the same cut-out, blackened, blurred, and offset down, with
 * the sharp item placed over it. So a mug's shadow is mug-shaped and a coat's
 * is coat-shaped, and neither is a shape somebody invented.
 *
 * Worth being clear about where this sits against the rule at the top of this
 * file. A contact shadow is a fact about lighting, not about the goods. It
 * says nothing about the item's condition, adds nothing it doesn't have, and
 * hides nothing it does — the wear, the marks and the fading are all still
 * exactly where they were. Removing the real shadow and putting nothing back
 * is the change that misleads.
 */
export const SHADOW = {
  /** Enough to read as soft, not so much it becomes a smudge. */
  blur: 22,
  /** How far down the shadow sits, as a fraction of the frame. */
  drop: 0.018,
  /** Faint. A heavy shadow looks like a sticker with a bevel. */
  opacity: 0.28,
} as const;

export const DEFAULT_ENHANCE: Required<Omit<EnhanceOptions, "background">> = {
  size: 1200,
  padding: 0.06,
};

/**
 * The transformation chain for a product shot.
 *
 * Ordered deliberately: isolate the subject, trim to what's left, then place it
 * on the seamless with a margin. Trimming before compositing is what makes a
 * jumper shot from six feet away and a mug shot from six inches come out the
 * same size in a grid — which is the actual difference between a page that
 * looks like a shop and one that looks like a car boot sale.
 */
export interface EnhanceTransform {
  segment: "foreground";
  trim: "border";
  width: number;
  height: number;
  fit: "pad";
  background: string;
  /** The breathing room, as Cloudflare spells it. See the note below. */
  border: { color: string; width: number };
}

export function enhanceTransform(opts: EnhanceOptions): EnhanceTransform {
  const size = opts.size ?? DEFAULT_ENHANCE.size;
  const padding = opts.padding ?? DEFAULT_ENHANCE.padding;
  const inner = Math.round(size * (1 - padding * 2));

  return {
    // BiRefNet, via Workers AI, exposed as an ordinary image transformation.
    // It replaces the background with transparency; it does not touch the
    // subject, which is the entire reason it's the tool used here.
    segment: "foreground",
    trim: "border",
    width: inner,
    height: inner,
    // `pad`, not `cover` and not `contain`. `cover` crops a garment to fill the
    // square, which is how a sleeve or a hem silently leaves the photograph.
    // `contain` doesn't crop, but it also doesn't fill — a wide item comes back
    // as a short picture, and a grid of short and tall pictures is the mess
    // this is supposed to fix. `pad` fits the whole item and fills the rest
    // with the seamless, so every item is the same square whatever its shape.
    fit: "pad",
    background: opts.background,
    // `border`, not `padding` — there is no `padding` transformation, and an
    // option Cloudflare doesn't recognise is ignored rather than refused. This
    // was a `padding` key for a while and every cut-out came out with the
    // garment jammed against the frame, with nothing anywhere saying why.
    //
    // Borders are applied after the resize, so the inner box is deliberately
    // smaller than the finished square: inner + two borders lands back on
    // `size` exactly, which is what keeps a grid even.
    border: { color: opts.background, width: Math.round(size * padding) },
  };
}

/**
 * How the finished cut-out is encoded.
 *
 * Separate from the transformation because Cloudflare treats them separately —
 * `quality` and `format` passed to `.transform()` are quietly dropped.
 */
export const ENHANCE_OUTPUT = { format: "image/webp", quality: 82 } as const;

/** The finished square, in pixels — what every enhanced photo comes out as. */
export function enhancedSize(opts: EnhanceOptions): number {
  const t = enhanceTransform(opts);
  return t.width + t.border.width * 2;
}

/**
 * Where an enhanced version lives in R2.
 *
 * Derived from the original's key rather than random, so the pair is obvious to
 * anybody looking at a bucket listing and an orphan is recognisable as one.
 */
export function enhancedKeyFor(originalKey: string): string {
  return `enhanced/${originalKey}`;
}

/**
 * A background that suits the shop without vanishing behind the goods.
 *
 * A shop's surface colour is usually near-white, which is right. But a shop
 * whose brand is dark would get a black seamless, and a black coat on a black
 * seamless is a photograph of nothing — so anything dark falls back to a warm
 * off-white rather than being taken literally.
 */
export function seamlessFor(surface: string, luminance: (hex: string) => number): string {
  const light = "#f6f4f0";
  if (!/^#[0-9a-f]{6}$/i.test(surface)) return light;
  return luminance(surface) > 0.6 ? surface : light;
}

/** The cut-out alone, on transparency — the shared first step of both layers. */
export function cutoutTransform(): { segment: "foreground"; trim: "border" } {
  return { segment: "foreground", trim: "border" };
}

/**
 * The cut-out turned into its own shadow: black, soft, and see-through.
 *
 * `brightness: 0` flattens the subject to black without touching the alpha, so
 * what survives is the silhouette. Applied before the item is placed on a
 * ground, or the ground would be blackened along with it.
 */
export function shadowTransform(): Record<string, number> {
  return { brightness: 0, blur: SHADOW.blur };
}

/**
 * Bytes the Images binding will actually accept.
 *
 * `IMAGES.input()` requires a stream whose length is known up front, and an R2
 * object's `body` is not one — it throws "Provided readable stream must have a
 * known length". Both call sites had a try/catch that fell back to the original
 * image, so nothing ever failed loudly: the tidy-up quietly never worked, and
 * every `?w=` on the site quietly served the full-size photograph instead of a
 * resized one. A fallback that hides a total failure is worse than no fallback.
 *
 * Wrapping the bytes in a Response gives them a content length, which is what
 * the binding is asking for. The bytes come back too, so a caller that needs to
 * fall back doesn't have to fetch the object from R2 a second time.
 */
export async function imageBytes(
  object: { arrayBuffer(): Promise<ArrayBuffer> }
): Promise<{ bytes: ArrayBuffer; stream: ReadableStream }> {
  const bytes = await object.arrayBuffer();
  return { bytes, stream: new Response(bytes).body as ReadableStream };
}

/* ─── What we will and won't say about a photograph ──────────────────────── */

/**
 * The note shown under an enhanced photograph, on the shop's public listing.
 *
 * Written out here rather than at the call site because it is a promise about
 * how the picture was made, and a promise belongs next to the code that keeps
 * it. Every enhanced image links to its original; a shopper is entitled to see
 * what was actually photographed.
 */
export const ENHANCED_NOTE =
  "This photo has been tidied up — background removed, straightened. The item itself is exactly as it came in.";

/**
 * What a shop is told before it enhances anything.
 *
 * Shops will ask why we don't remove the stain. This is the answer, in the
 * place they'll ask it.
 */
export const ENHANCE_EXPLAINER = [
  "We cut the item out of its background and put it on a clean, even surface, then straighten and light it consistently.",
  "We don't change the item. No removing marks, no mending tears, no making a faded thing look new — a shopper who receives something worse than the photo is a shopper who stops trusting you, and asks for their money back.",
  "The original photo is kept and linked from every listing, so anyone can see exactly what you photographed.",
] as const;
