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
}

export const DEFAULT_SETTINGS: OrgSettings = {
  taxRateBps: 0,
  roundUpEnabled: true,
  roundUpCause: "our community programs",
};

function num(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
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
