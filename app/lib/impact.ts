/**
 * Common-good reporting — the numbers a board and a grant officer ask for,
 * computed from the same records that run the register.
 *
 * The design decision that matters: these metrics are derived from the *sale*
 * and the *donation*, the records a shop must keep anyway. Nobody has to
 * remember to log impact separately, so the impact report is never a fiction
 * assembled the night before a board meeting.
 *
 * Every figure here is honest about what it is. "Value delivered" is a
 * difference between two recorded numbers, not an estimate of social good.
 */

export interface ImpactTotals {
  diversionLbs: number;
  itemsRehomed: number;
  valueDeliveredCents: number;
  volunteerHours: number;
  volunteerHeadcount: number;
  paidHours: number;
  revenueCents: number;
  donationsReceived: number;
}

export const EMPTY_TOTALS: ImpactTotals = {
  diversionLbs: 0,
  itemsRehomed: 0,
  valueDeliveredCents: 0,
  volunteerHours: 0,
  volunteerHeadcount: 0,
  paidHours: 0,
  revenueCents: 0,
  donationsReceived: 0,
};

/**
 * Value delivered: what a shopper would have paid new, minus what they paid here.
 * Only counts when a retail comparison was actually recorded — we never invent
 * one to inflate the number, so an unpriced comparison contributes zero.
 */
export function valueDeliveredCents(
  lines: readonly { retailEstimateCents: number; pricePaidCents: number }[]
): number {
  let total = 0;
  for (const line of lines) {
    const retail = Math.max(0, Math.round(line.retailEstimateCents));
    const paid = Math.max(0, Math.round(line.pricePaidCents));
    if (retail <= 0) continue; // no comparison recorded → claim nothing
    total += Math.max(0, retail - paid);
  }
  return total;
}

/**
 * The one definition of "diverted", shared by every surface that reports it.
 *
 * Goods still on the floor have not been diverted from anything yet, and the
 * weight of what arrived at the door is intake, not diversion. Keeping this in
 * one place stops the dashboard, the impact report, and NRI from quietly
 * answering the same question three different ways — which they did, once.
 */
export const DIVERTED_STATUSES = ["sold", "transferred", "recycled"] as const;

/** The same list as a SQL literal, for the aggregate queries. */
export const DIVERTED_STATUS_SQL = DIVERTED_STATUSES.map((s) => `'${s}'`).join(",");

/**
 * The predicate that keeps invented records out of a real report.
 *
 * A shop that loads sample data to look around must not find that weight in
 * its first board report, or that revenue on its first invoice. Every aggregate
 * over items, donations, transactions, or shifts has to carry this — it exists
 * as a named helper rather than a typed-out `is_sample = 0` so the ones that
 * matter are greppable, and so a missing one shows up as an absence of
 * `REAL_ONLY` rather than a predicate nobody thought to look for.
 *
 * Imported records are NOT excluded. They are real; only sample data isn't.
 */
export function realOnly(alias?: string): string {
  return `${alias ? `${alias}.` : ""}is_sample = 0`;
}

/**
 * Landfill diversion: weight that actually left the building for reuse.
 */
export function diversionLbs(
  items: readonly { weightLbs: number; status: string }[]
): number {
  const DIVERTED = new Set<string>(DIVERTED_STATUSES);
  let total = 0;
  for (const item of items) {
    if (!DIVERTED.has(item.status)) continue;
    const w = Number(item.weightLbs);
    if (Number.isFinite(w) && w > 0) total += w;
  }
  return Math.round(total * 100) / 100;
}

/** Pounds → US tons, for the sentence a board actually repeats out loud. */
export function lbsToTons(lbs: number): number {
  return Math.round((lbs / 2000) * 100) / 100;
}

/**
 * A plain-language summary. No superlatives, no "impact score" — just the
 * figures, phrased the way a person would say them.
 */
export function impactNarrative(totals: ImpactTotals, orgName: string): string[] {
  const lines: string[] = [];

  if (totals.diversionLbs > 0) {
    const tons = lbsToTons(totals.diversionLbs);
    lines.push(
      tons >= 1
        ? `${orgName} kept ${tons} tons of goods out of a landfill.`
        : `${orgName} kept ${Math.round(totals.diversionLbs)} pounds of goods out of a landfill.`
    );
  }

  if (totals.itemsRehomed > 0) {
    lines.push(`${totals.itemsRehomed.toLocaleString("en-US")} items found a second home.`);
  }

  if (totals.valueDeliveredCents > 0) {
    lines.push(
      `Shoppers took home about $${Math.round(totals.valueDeliveredCents / 100).toLocaleString("en-US")} more in goods than they paid for.`
    );
  }

  if (totals.volunteerHours > 0) {
    const people = totals.volunteerHeadcount;
    lines.push(
      `${Math.round(totals.volunteerHours).toLocaleString("en-US")} volunteer hours were given${people > 0 ? ` by ${people} ${people === 1 ? "person" : "people"}` : ""}.`
    );
  }

  if (totals.donationsReceived > 0) {
    lines.push(`${totals.donationsReceived.toLocaleString("en-US")} donations were received.`);
  }

  return lines;
}

/**
 * Independent Sector's published national value of a volunteer hour, so hours
 * can be expressed in dollars for a grant application. Stated as an external
 * reference with its year attached — never presented as this shop's own claim.
 */
export const VOLUNTEER_HOUR_VALUE_CENTS = 3465; // $34.65, US national estimate
export const VOLUNTEER_HOUR_VALUE_SOURCE =
  "Independent Sector's national estimated value of a volunteer hour";

export function volunteerHoursValueCents(hours: number): number {
  if (!Number.isFinite(hours) || hours <= 0) return 0;
  return Math.round(hours * VOLUNTEER_HOUR_VALUE_CENTS);
}

/** CSV for grant and board reporting. Excel-safe, no formula injection. */
export function toCsv(rows: readonly Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const escape = (value: unknown): string => {
    const s = value === null || value === undefined ? "" : String(value);
    // A leading =, +, - or @ turns a cell into a formula in Excel. Neutralise it.
    const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  const lines = [headers.map(escape).join(",")];
  for (const row of rows) lines.push(headers.map((h) => escape(row[h])).join(","));
  return lines.join("\r\n");
}
