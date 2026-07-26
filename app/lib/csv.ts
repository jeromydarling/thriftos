/**
 * CSV parsing and column guessing, with no dependency.
 *
 * Shops arrive with exports from software written across three decades. The
 * parser therefore has to cope with quoted fields containing commas and
 * newlines, doubled quotes, a UTF-8 BOM from anything Microsoft touched, and
 * CRLF line endings. That's the whole of RFC 4180 plus the two things everyone
 * gets wrong, and it's about ninety lines — far less than the cost of shipping
 * a parser to a Worker.
 *
 * Nothing here touches the database. Parsing and mapping are pure so they can
 * be tested against real awful files without a D1 instance.
 */

export type CsvRow = Record<string, string>;

export interface ParsedCsv {
  headers: string[];
  rows: CsvRow[];
  /** Rows whose column count didn't match the header, kept so we can say so. */
  malformed: { line: number; reason: string }[];
}

/** Split CSV text into a grid. Quoted fields may contain commas and newlines. */
export function parseCsvGrid(text: string, delimiter = ","): string[][] {
  // Strip a BOM. Left in place it becomes part of the first header name and
  // every mapping guess silently fails on the first column.
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  const grid: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let i = 0;

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    grid.push(row);
    row = [];
  };

  while (i < input.length) {
    const ch = input[i];

    if (quoted) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }

    if (ch === '"' && field === "") {
      quoted = true;
      i++;
      continue;
    }
    if (ch === delimiter) {
      endField();
      i++;
      continue;
    }
    if (ch === "\r") {
      // CRLF or a lone CR; either way the row is over.
      endRow();
      i += input[i + 1] === "\n" ? 2 : 1;
      continue;
    }
    if (ch === "\n") {
      endRow();
      i++;
      continue;
    }

    field += ch;
    i++;
  }

  // A trailing newline shouldn't produce a phantom empty row.
  if (field !== "" || row.length > 0) endRow();

  return grid;
}

/**
 * Guess the delimiter. Semicolons are the norm in European locales, and tabs
 * appear whenever somebody pasted out of a spreadsheet.
 */
export function guessDelimiter(text: string): string {
  const sample = text.slice(0, 4000).split(/\r?\n/).slice(0, 5).join("\n");
  const counts = [",", ";", "\t", "|"].map((d) => ({
    d,
    n: sample.split(d).length - 1,
  }));
  counts.sort((a, b) => b.n - a.n);
  return counts[0].n > 0 ? counts[0].d : ",";
}

export function parseCsv(text: string, delimiter?: string): ParsedCsv {
  const grid = parseCsvGrid(text, delimiter ?? guessDelimiter(text));
  const malformed: ParsedCsv["malformed"] = [];

  if (grid.length === 0) return { headers: [], rows: [], malformed };

  const headers = grid[0].map((h, i) => h.trim() || `Column ${i + 1}`);
  const rows: CsvRow[] = [];

  for (let r = 1; r < grid.length; r++) {
    const cells = grid[r];
    // Wholly blank lines are noise, not errors — exports end with them.
    if (cells.every((c) => c.trim() === "")) continue;

    if (cells.length !== headers.length) {
      malformed.push({
        line: r + 1,
        reason: `Expected ${headers.length} columns, found ${cells.length}`,
      });
      // Still readable if it's merely short — pad rather than discard, because
      // a missing trailing column is usually an empty optional field.
      if (cells.length > headers.length) continue;
    }

    const row: CsvRow = {};
    headers.forEach((h, c) => {
      row[h] = (cells[c] ?? "").trim();
    });
    rows.push(row);
  }

  return { headers, rows, malformed };
}

/* ─── Column guessing ───────────────────────────────────────────────────── */

/**
 * Field names we can import into, and the header text that means them.
 *
 * Patterns are matched against the header lowercased with non-alphanumerics
 * stripped, so "Donor E-Mail", "donor_email", and "DonorEmail" all collapse to
 * the same thing.
 */
export interface FieldSpec {
  key: string;
  label: string;
  hint?: string;
  required?: boolean;
  patterns: string[];
}

export const CONTACT_FIELDS: readonly FieldSpec[] = [
  { key: "name", label: "Name", required: true, patterns: ["name", "fullname", "donorname", "contactname", "displayname", "customer"] },
  { key: "email", label: "Email", hint: "Used to match people who are already here", patterns: ["email", "emailaddress", "donoremail", "mail"] },
  { key: "phone", label: "Phone", patterns: ["phone", "telephone", "mobile", "cell", "phonenumber"] },
  { key: "roles", label: "Roles", hint: "donor, volunteer, shopper, worker", patterns: ["role", "roles", "type", "contacttype", "category"] },
  { key: "street", label: "Street", patterns: ["street", "address", "address1", "addressline1", "mailingaddress"] },
  { key: "city", label: "City", patterns: ["city", "town"] },
  { key: "state", label: "State", patterns: ["state", "province", "region"] },
  { key: "postal_code", label: "Postcode", patterns: ["zip", "zipcode", "postal", "postalcode", "postcode"] },
  { key: "notes", label: "Notes", patterns: ["note", "notes", "comment", "comments", "memo"] },
] as const;

export const ITEM_FIELDS: readonly FieldSpec[] = [
  { key: "title", label: "Title", required: true, patterns: ["title", "name", "item", "itemname", "description", "product"] },
  { key: "price_cents", label: "Price", hint: "Dollars or cents — we read both", patterns: ["price", "amount", "cost", "saleprice", "retailprice", "tagprice"] },
  { key: "category", label: "Category", patterns: ["category", "department", "dept", "type", "class"] },
  { key: "brand", label: "Brand", patterns: ["brand", "make", "manufacturer", "label"] },
  { key: "color", label: "Colour", patterns: ["color", "colour"] },
  { key: "size", label: "Size", patterns: ["size"] },
  { key: "condition", label: "Condition", hint: "new, excellent, good, fair, flawed", patterns: ["condition", "grade", "quality"] },
  { key: "intake_date", label: "Intake date", hint: "Drives colour tags and markdowns", patterns: ["intakedate", "dateadded", "datein", "received", "receiveddate", "created", "createddate", "date"] },
  { key: "tag_number", label: "Tag number", patterns: ["tag", "tagnumber", "sku", "barcode", "itemnumber", "itemid", "id"] },
  { key: "weight_lbs", label: "Weight (lbs)", patterns: ["weight", "weightlbs", "lbs", "pounds"] },
  { key: "retail_estimate_cents", label: "Retail estimate", hint: "Comparable new price, for value delivered", patterns: ["retail", "retailestimate", "msrp", "newprice", "compareat"] },
  { key: "notes", label: "Notes", patterns: ["note", "notes", "comment", "comments", "conditionnotes"] },
] as const;

export const DONATION_FIELDS: readonly FieldSpec[] = [
  { key: "received_at", label: "Date received", required: true, patterns: ["date", "datereceived", "receiveddate", "donationdate", "received", "created"] },
  { key: "donor_email", label: "Donor email", hint: "How the donation finds the right person", patterns: ["email", "donoremail", "emailaddress", "mail"] },
  { key: "donor_name", label: "Donor name", patterns: ["donor", "name", "donorname", "contact", "contactname"] },
  { key: "item_count", label: "Item count", patterns: ["items", "itemcount", "quantity", "qty", "count", "bags"] },
  { key: "est_weight_lbs", label: "Estimated weight (lbs)", patterns: ["weight", "lbs", "pounds", "estweight", "estimatedweight"] },
  { key: "amount_cents", label: "Cash amount", hint: "Cash donations only", patterns: ["amount", "value", "cash", "cashamount", "total"] },
  { key: "description", label: "Description", patterns: ["description", "desc", "goods", "notes", "note"] },
] as const;

export type ImportKind = "contacts" | "items" | "donations";

export const FIELDS_FOR: Record<ImportKind, readonly FieldSpec[]> = {
  contacts: CONTACT_FIELDS,
  items: ITEM_FIELDS,
  donations: DONATION_FIELDS,
};

const normalise = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Map header → field key, best guess. Each field is claimed at most once.
 *
 * Three passes of decreasing confidence — exact, then suffix, then substring —
 * so a header that merely contains a pattern can never beat one that matches it
 * outright. Within a pass we walk each field's patterns in their declared
 * order, which is why those lists are written most-canonical-first: given both
 * "Name" and "Donor Name", the plain one takes the `name` slot.
 *
 * Guesses are a starting point, not a decision. Everything here is shown on the
 * mapping screen for a person to correct before anything is written.
 */
export function guessMapping(
  headers: readonly string[],
  kind: ImportKind
): Record<string, string> {
  const fields = FIELDS_FOR[kind];
  const mapping: Record<string, string> = {};
  const claimed = new Set<string>();
  const norms = headers.map((h) => ({ header: h, norm: normalise(h) }));

  const pass = (test: (norm: string, pattern: string) => boolean) => {
    for (const field of fields) {
      if (claimed.has(field.key)) continue;

      for (const pattern of field.patterns) {
        const hit = norms.find(
          ({ header, norm }) => norm && !mapping[header] && test(norm, pattern)
        );
        if (hit) {
          mapping[hit.header] = field.key;
          claimed.add(field.key);
          break;
        }
      }
    }
  };

  pass((norm, pattern) => norm === pattern);
  pass((norm, pattern) => norm.endsWith(pattern));
  pass((norm, pattern) => pattern.length > 3 && norm.includes(pattern));

  return mapping;
}

/* ─── Value coercion ────────────────────────────────────────────────────── */

/**
 * Money → integer cents.
 *
 * Accepts "$12.50", "12.50", "1250" (as cents when there's no separator and
 * a cents column was declared), "12,50" for European decimals, and "(4.00)"
 * for the accounting convention of parentheses meaning negative.
 *
 * Returns null rather than 0 for anything unreadable. A price that silently
 * becomes zero is worse than a row we refused to import.
 */
export function parseMoneyCents(raw: string): number | null {
  const text = raw.trim();
  if (!text) return null;

  const negative = /^\(.*\)$/.test(text);
  let cleaned = text.replace(/[()$£€\s]/g, "");

  // Decide what the comma means before doing anything else, because getting it
  // wrong is a hundredfold error on a price rather than a rounding difference.
  //
  // A comma is a decimal separator when it's the last one, is followed by
  // exactly one or two digits, and no dot is present. "7,00" is seven euros;
  // "7,000" is seven thousand, because thousands groups are always three
  // digits. That distinction is the whole rule and it is unambiguous — nobody
  // writes a thousands separator with two digits after it.
  const decimalComma = !cleaned.includes(".") && /,\d{1,2}$/.test(cleaned);

  if (decimalComma) {
    cleaned = cleaned.replace(/,(?=.*,)/g, "").replace(",", ".");
  } else {
    // "1.234,56" — thousands dot with a decimal comma.
    if (/^-?\d{1,3}(\.\d{3})+,\d{1,2}$/.test(cleaned)) {
      cleaned = cleaned.replace(/\./g, "").replace(",", ".");
    } else {
      cleaned = cleaned.replace(/,/g, "");
    }
  }

  if (!/^-?\d*\.?\d+$/.test(cleaned)) return null;

  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;

  // Round rather than truncate: 0.1 + 0.2 arithmetic means 12.35 can arrive as
  // 1234.9999999999998, and truncating loses a cent on a real sale.
  const cents = Math.round(value * 100);
  return negative ? -cents : cents;
}

/**
 * Date → ISO yyyy-mm-dd.
 *
 * Ambiguous numeric dates are the single most damaging thing in an import: a
 * day/month swap quietly ruins donor rhythms and ages stock wrongly. So we
 * take a `dayFirst` hint from the mapping screen rather than guessing, and we
 * only guess when the day is unambiguously above 12.
 */
export function parseDate(raw: string, dayFirst = false): string | null {
  const text = raw.trim();
  if (!text) return null;

  // ISO, or ISO with a time on the end. Unambiguous, so take it as-is.
  const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    return validDate(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]));
  }

  const parts = text.match(/^(\d{1,4})[/.\-](\d{1,2})[/.\-](\d{2,4})/);
  if (parts) {
    const a = Number(parts[1]);
    const b = Number(parts[2]);
    let year = Number(parts[3]);

    // yyyy/mm/dd
    if (a > 31) return validDate(a, b, year);

    if (year < 100) year += year < 70 ? 2000 : 1900;

    // If one of the two is above 12 it can only be the day, whatever the hint.
    let month: number;
    let dayOfMonth: number;
    if (a > 12) {
      dayOfMonth = a;
      month = b;
    } else if (b > 12) {
      month = a;
      dayOfMonth = b;
    } else {
      dayOfMonth = dayFirst ? a : b;
      month = dayFirst ? b : a;
    }
    return validDate(year, month, dayOfMonth);
  }

  // "12 March 2024", "March 12, 2024" — unambiguous because the month is named.
  const parsed = Date.parse(text);
  if (Number.isFinite(parsed)) {
    return new Date(parsed).toISOString().slice(0, 10);
  }

  return null;
}

function validDate(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (year < 1900 || year > 2200) return null;

  const d = new Date(Date.UTC(year, month - 1, day));
  // Rejects 31 February rather than letting it roll into March.
  if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;

  return d.toISOString().slice(0, 10);
}

export function parseNumber(raw: string): number | null {
  const cleaned = raw.trim().replace(/[,\s]/g, "");
  if (!cleaned) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

const CONDITIONS = ["new", "excellent", "good", "fair", "flawed"] as const;

/**
 * Map somebody else's condition scale onto ours.
 *
 * Deliberately conservative: anything we don't recognise becomes "good" and is
 * reported as a guess, because quietly grading unknown stock as "excellent"
 * would put a claim on a price tag that nobody made.
 */
export function normaliseCondition(raw: string): { value: string; guessed: boolean } {
  const norm = normalise(raw);
  if (!norm) return { value: "good", guessed: false };

  for (const c of CONDITIONS) {
    if (norm === c) return { value: c, guessed: false };
  }

  const aliases: Record<string, string> = {
    mint: "new",
    bnwt: "new",
    newwithtags: "new",
    nwt: "new",
    likenew: "excellent",
    verygood: "excellent",
    vg: "excellent",
    a: "excellent",
    b: "good",
    used: "good",
    average: "good",
    acceptable: "fair",
    c: "fair",
    worn: "fair",
    damaged: "flawed",
    poor: "flawed",
    asis: "flawed",
    d: "flawed",
  };

  const mapped = aliases[norm];
  return mapped ? { value: mapped, guessed: false } : { value: "good", guessed: true };
}

/** Roles column → our stacked role list, dropping anything unrecognised. */
export function normaliseRoles(raw: string): string[] {
  const known = ["donor", "volunteer", "shopper", "worker"];
  const found = raw
    .toLowerCase()
    .split(/[,;/|]+/)
    .map((r) => r.trim())
    .flatMap((r) => {
      if (known.includes(r)) return [r];
      if (r.includes("volunt")) return ["volunteer"];
      if (r.includes("donor") || r.includes("donat")) return ["donor"];
      if (r.includes("custom") || r.includes("shop") || r.includes("buyer")) return ["shopper"];
      if (r.includes("staff") || r.includes("employee") || r.includes("worker")) return ["worker"];
      return [];
    });

  return [...new Set(found)];
}

/** Normalised for matching. Case and surrounding space are not identity. */
export function normaliseEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}
