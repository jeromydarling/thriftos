/**
 * Shop settings — one typed shape, one place each key name is written.
 *
 * This exists because of a bug that reached production. `settings_json` was a
 * free-form blob read with a `Record<string, unknown>` helper, so the settings
 * screen wrote `taxRateBps`, the register read `taxRateBps`, and the
 * server-side card pricer read `taxBps`. Nothing failed. Nothing typechecked
 * wrong. Card payments simply charged no sales tax, and the shop would have
 * discovered it from a state audit.
 *
 * A typed parser can't prevent someone inventing a new key, but it makes the
 * key name appear exactly once, and it makes a rename a compile error rather
 * than a silent behaviour change in one of three call sites.
 *
 * Every field is optional in storage and defaulted here, so a shop created
 * before a field existed reads as the sensible default rather than undefined.
 */

export interface OrgSettings {
  /** Sales tax in basis points. 700 = 7%. Never stored as a float percentage. */
  taxRateBps: number;
  /** Whether the register offers round-up-for-donation at checkout. */
  roundUpEnabled: boolean;
  /** What the round-up is called at the counter. Concrete beats worthy. */
  roundUpCause: string;

  /**
   * When the shop is open, one line per line. Free text on purpose: real
   * opening hours are full of "Closed bank holidays" and "First Sunday of the
   * month", and a structured week grid would force a shop to lie.
   */
  openingHours: string;
  /** When donations can be dropped off, if that differs from opening hours. */
  donationHours: string;
  /** What the shop can take, one per line. */
  accepted: string;
  /** What it can't, one per line. Saves a volunteer the same conversation daily. */
  notAccepted: string;

  /**
   * Whether the shop sells online at all.
   *
   * Off until a shop turns it on. A shop that has never thought about postage
   * or packing should not discover it has a checkout because we shipped one.
   */
  onlineSelling: boolean;
  /** Whether shoppers can pay online and collect in the shop. */
  pickupEnabled: boolean;
  /** Where to come, and when. Shown after an order is placed and on the receipt. */
  pickupInstructions: string;
}

export const DEFAULT_SETTINGS: OrgSettings = {
  taxRateBps: 0,
  roundUpEnabled: true,
  roundUpCause: "our community programs",
  // Empty rather than invented. A shop's public page shows nothing at all for
  // these until somebody fills them in, which is the honest state — printed
  // opening hours that are wrong are worse than none.
  openingHours: "",
  donationHours: "",
  accepted: "",
  notAccepted: "",
  onlineSelling: false,
  // On by default *when selling is on*, because collection is the one thing a
  // thrift shop can offer with no packing, no postage and no risk of a parcel
  // going astray. Turning selling on and getting nothing would be a puzzle.
  pickupEnabled: true,
  pickupInstructions: "",
};

function num(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** Multi-line free text, capped so a paste can't become a shop's whole page. */
function text(value: unknown, limit = 600): string {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

/**
 * Read a shop's settings. Total and defaulted — never returns undefined for a
 * field, so no caller has to remember a fallback.
 */
export function parseOrgSettings(json: string | null | undefined): OrgSettings {
  if (!json) return { ...DEFAULT_SETTINGS };

  let raw: Record<string, unknown>;
  try {
    const parsed = JSON.parse(json);
    raw = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return { ...DEFAULT_SETTINGS };
  }

  return {
    // Clamped: a tax rate above 100% is a typo, and charging it would be worse
    // than ignoring it.
    taxRateBps: Math.max(0, Math.min(10_000, Math.round(num(raw.taxRateBps, 0)))),
    roundUpEnabled: raw.roundUpEnabled !== false,
    roundUpCause:
      typeof raw.roundUpCause === "string" && raw.roundUpCause.trim()
        ? raw.roundUpCause.trim()
        : DEFAULT_SETTINGS.roundUpCause,
    openingHours: text(raw.openingHours),
    donationHours: text(raw.donationHours),
    accepted: text(raw.accepted),
    notAccepted: text(raw.notAccepted),
    onlineSelling: raw.onlineSelling === true,
    pickupEnabled: raw.pickupEnabled !== false,
    pickupInstructions: text(raw.pickupInstructions),
  };
}

/** Serialise for storage. The only writer, so the shape can't drift. */
export function serialiseOrgSettings(settings: OrgSettings): string {
  return JSON.stringify(settings);
}

/**
 * Sales tax on a subtotal.
 *
 * Shared so the register's display and the server's authoritative price are
 * computed by the same function rather than the same formula written twice.
 */
export function taxCentsFor(
  subtotalCents: number,
  settings: OrgSettings,
  taxExempt = false
): number {
  if (taxExempt || settings.taxRateBps <= 0) return 0;
  return Math.round((Math.max(0, subtotalCents) * settings.taxRateBps) / 10_000);
}
