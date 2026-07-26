/**
 * CSV import — dry run first, then commit under a reversible batch.
 *
 * The shape of this file follows one conviction: a shop migrating its records
 * is at its most vulnerable, and the worst outcome is not a failed import but a
 * successful one that quietly got something wrong. So:
 *
 *   • Every import is previewed. The same code path builds the preview and the
 *     commit, so what you were shown is what you get.
 *   • Rows we can't read are reported with a reason and a line number, never
 *     coerced into something plausible. A price that won't parse is a skipped
 *     row, not a zero.
 *   • Every import is a batch, and a batch can be reversed.
 *   • Re-running the same file updates rather than duplicates, so a shop that
 *     isn't sure whether the first run worked can just run it again.
 */
import { all, batch as runBatch, first } from "./db";
import { newId } from "./ids";
import { tagColorForIntake } from "./markdown";
import {
  FIELDS_FOR,
  normaliseCondition,
  normaliseEmail,
  normaliseRoles,
  parseCsv,
  parseDate,
  parseMoneyCents,
  parseNumber,
  type CsvRow,
  type ImportKind,
} from "./csv";
import { createBatch, finishBatch } from "./onboarding";

export interface ImportOptions {
  kind: ImportKind;
  /** Header text → field key. Anything unmapped is dropped or noted. */
  mapping: Record<string, string>;
  /** Whether ambiguous numeric dates are day/month rather than month/day. */
  dayFirst?: boolean;
  /** Keep unmapped columns in the record's notes rather than discarding them. */
  unmappedToNotes?: boolean;
}

export interface RowIssue {
  line: number;
  reason: string;
}

export interface ImportPlan {
  kind: ImportKind;
  totalRows: number;
  creates: number;
  updates: number;
  skipped: RowIssue[];
  warnings: RowIssue[];
  /** The first few records as they would actually be written. */
  preview: Record<string, unknown>[];
}

const PREVIEW_ROWS = 8;
/** A ceiling, so one enormous file can't exhaust a request. */
export const MAX_ROWS = 5000;

/** Field values pulled out of one CSV row, already coerced. */
type Draft = Record<string, unknown>;

/**
 * Plan an import without writing anything, then optionally write it.
 *
 * `commit` being a parameter rather than a separate function is the point: a
 * preview that runs different code from the commit is a preview that lies.
 */
async function planImport(
  db: D1Database,
  orgId: string,
  csvText: string,
  opts: ImportOptions,
  commit: { batchId: string; userId?: string | null } | null
): Promise<ImportPlan> {
  const parsed = parseCsv(csvText);
  const skipped: RowIssue[] = [];
  const warnings: RowIssue[] = [];

  for (const bad of parsed.malformed) {
    skipped.push({ line: bad.line, reason: bad.reason });
  }

  const rows = parsed.rows.slice(0, MAX_ROWS);
  if (parsed.rows.length > MAX_ROWS) {
    warnings.push({
      line: 0,
      reason: `File has ${parsed.rows.length} rows; only the first ${MAX_ROWS} were read. Split the file and import the rest.`,
    });
  }

  // header → field, inverted to field → header for straightforward lookup.
  const byField: Record<string, string> = {};
  for (const [header, field] of Object.entries(opts.mapping)) {
    if (field) byField[field] = header;
  }

  const unmappedHeaders = parsed.headers.filter((h) => !opts.mapping[h]);

  const required = FIELDS_FOR[opts.kind].filter((f) => f.required);
  const missing = required.filter((f) => !byField[f.key]);
  if (missing.length > 0) {
    return {
      kind: opts.kind,
      totalRows: rows.length,
      creates: 0,
      updates: 0,
      skipped: [
        {
          line: 1,
          reason: `Nothing was imported: ${missing
            .map((f) => f.label)
            .join(" and ")} must be mapped to a column first.`,
        },
        ...skipped,
      ],
      warnings,
      preview: [],
    };
  }

  const ctx = await loadMatchContext(db, orgId, opts.kind);

  const stmts: D1PreparedStatement[] = [];
  const preview: Record<string, unknown>[] = [];
  let creates = 0;
  let updates = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const line = i + 2; // 1-based, and the header occupies line 1.

    const get = (field: string) => (byField[field] ? (row[byField[field]] ?? "").trim() : "");

    let built: BuiltRow | null;
    try {
      built = buildRow(opts.kind, get, line, opts, unmappedHeaders, row, ctx, skipped, warnings);
    } catch (err) {
      skipped.push({ line, reason: err instanceof Error ? err.message : "Could not read this row" });
      continue;
    }
    if (!built) continue;

    if (built.action === "create") creates++;
    else updates++;

    if (preview.length < PREVIEW_ROWS) {
      preview.push({ line, action: built.action, ...built.draft });
    }

    if (commit) {
      stmts.push(...built.statements(db, orgId, commit.batchId, commit.userId ?? null));
      // Later rows in the same file must see what earlier rows created, or a
      // donor appearing three times in one export becomes three people.
      built.remember?.(ctx);
    }
  }

  if (commit && stmts.length > 0) {
    for (let i = 0; i < stmts.length; i += 40) {
      await runBatch(db, stmts.slice(i, i + 40));
    }
  }

  return {
    kind: opts.kind,
    totalRows: rows.length,
    creates,
    updates,
    skipped,
    warnings,
    preview,
  };
}

export function previewImport(
  db: D1Database,
  orgId: string,
  csvText: string,
  opts: ImportOptions
): Promise<ImportPlan> {
  return planImport(db, orgId, csvText, opts, null);
}

export async function commitImport(
  db: D1Database,
  orgId: string,
  csvText: string,
  opts: ImportOptions,
  source: string,
  userId?: string | null
): Promise<ImportPlan & { batchId: string }> {
  const batchId = await createBatch(db, orgId, opts.kind, source, userId);
  const plan = await planImport(db, orgId, csvText, opts, { batchId, userId });

  await finishBatch(db, batchId, {
    created: plan.creates,
    updated: plan.updates,
    skipped: plan.skipped.length,
    notes: {
      skipped: plan.skipped.slice(0, 100),
      warnings: plan.warnings.slice(0, 50),
    },
  });

  return { ...plan, batchId };
}

/* ─── Matching ──────────────────────────────────────────────────────────── */

interface ExistingContact {
  id: string;
  /** Carried so roles can be merged rather than replaced. */
  roles: string[];
}

interface MatchContext {
  /** Lowercased email → the person already here. */
  contactsByEmail: Map<string, ExistingContact>;
  /** Tag number → item id. */
  itemsByTag: Map<string, string>;
  /** Synthetic donation key → true, for re-run detection. */
  donationKeys: Set<string>;
}

async function loadMatchContext(
  db: D1Database,
  orgId: string,
  kind: ImportKind
): Promise<MatchContext> {
  const ctx: MatchContext = {
    contactsByEmail: new Map(),
    itemsByTag: new Map(),
    donationKeys: new Set(),
  };

  // People are needed for contacts (dedupe) and donations (attachment).
  if (kind === "contacts" || kind === "donations") {
    const contacts = await all<{ id: string; email: string | null; roles: string | null }>(
      db,
      `SELECT id, email, roles FROM contacts
        WHERE org_id = ? AND email IS NOT NULL AND email <> ''`,
      orgId
    );
    for (const c of contacts) {
      const email = normaliseEmail(c.email ?? "");
      if (!email || ctx.contactsByEmail.has(email)) continue;
      ctx.contactsByEmail.set(email, {
        id: c.id,
        roles: (c.roles ?? "").split(",").map((r) => r.trim()).filter(Boolean),
      });
    }
  }

  if (kind === "items") {
    const items = await all<{ id: string; tag_number: string }>(
      db,
      `SELECT id, tag_number FROM items
        WHERE org_id = ? AND tag_number IS NOT NULL AND tag_number <> ''`,
      orgId
    );
    for (const it of items) ctx.itemsByTag.set(it.tag_number, it.id);
  }

  if (kind === "donations") {
    const donations = await all<{
      contact_id: string | null;
      received_at: string;
      est_weight_lbs: number;
      amount_cents: number;
    }>(
      db,
      `SELECT contact_id, received_at, est_weight_lbs, amount_cents
         FROM donations WHERE org_id = ?`,
      orgId
    );
    for (const d of donations) ctx.donationKeys.add(donationKey(d.contact_id, d.received_at, d.est_weight_lbs, d.amount_cents));
  }

  return ctx;
}

/**
 * Donations have no natural key, so this is the closest honest thing to one:
 * the same donor bringing the same weight on the same day is almost certainly
 * the same drop-off, seen twice.
 *
 * It can be wrong — a donor really can come back the same afternoon with an
 * identical load — which is why a matched donation is skipped rather than
 * merged, and reported as skipped so a person can look.
 */
function donationKey(
  contactId: string | null,
  receivedAt: string,
  weightLbs: number,
  amountCents: number
): string {
  return [contactId ?? "anon", receivedAt.slice(0, 10), weightLbs, amountCents].join("|");
}

/* ─── Row building ──────────────────────────────────────────────────────── */

interface BuiltRow {
  action: "create" | "update";
  draft: Draft;
  statements: (
    db: D1Database,
    orgId: string,
    batchId: string,
    userId: string | null
  ) => D1PreparedStatement[];
  remember?: (ctx: MatchContext) => void;
}

function buildRow(
  kind: ImportKind,
  get: (field: string) => string,
  line: number,
  opts: ImportOptions,
  unmappedHeaders: string[],
  raw: CsvRow,
  ctx: MatchContext,
  skipped: RowIssue[],
  warnings: RowIssue[]
): BuiltRow | null {
  const leftovers = opts.unmappedToNotes
    ? unmappedHeaders
        .filter((h) => (raw[h] ?? "").trim())
        .map((h) => `${h}: ${raw[h].trim()}`)
        .join("\n")
    : "";

  if (kind === "contacts") {
    return buildContact(get, line, leftovers, ctx, skipped);
  }
  if (kind === "items") {
    return buildItem(get, line, opts, leftovers, ctx, skipped, warnings);
  }
  return buildDonation(get, line, opts, leftovers, ctx, skipped, warnings);
}

function buildContact(
  get: (f: string) => string,
  line: number,
  leftovers: string,
  ctx: MatchContext,
  skipped: RowIssue[]
): BuiltRow | null {
  const name = get("name");
  if (!name) {
    skipped.push({ line, reason: "No name in this row" });
    return null;
  }

  const email = normaliseEmail(get("email"));
  const roles = normaliseRoles(get("roles"));
  const notes = [get("notes"), leftovers].filter(Boolean).join("\n");
  const existing = email ? ctx.contactsByEmail.get(email) : undefined;
  const newRoles = roles.length ? roles : ["donor"];

  const draft: Draft = {
    name,
    email: email ?? "",
    phone: get("phone"),
    roles: newRoles.join(","),
  };

  if (existing) {
    // Merged, never replaced. Importing a volunteer list must not strip the
    // donor role off somebody who is both — that's the single most common way
    // a migration quietly loses information.
    const merged = [...new Set([...existing.roles, ...newRoles])];

    return {
      action: "update",
      draft: { ...draft, roles: merged.join(","), matched: "existing person with this email" },
      statements: (db, orgId) => [
        db
          .prepare(
            `UPDATE contacts
                SET name = ?,
                    phone = COALESCE(NULLIF(?, ''), phone),
                    street = COALESCE(NULLIF(?, ''), street),
                    city = COALESCE(NULLIF(?, ''), city),
                    state = COALESCE(NULLIF(?, ''), state),
                    postal_code = COALESCE(NULLIF(?, ''), postal_code),
                    notes = COALESCE(NULLIF(?, ''), notes),
                    roles = ?,
                    updated_at = datetime('now')
              WHERE id = ? AND org_id = ?`
          )
          .bind(
            name,
            get("phone"),
            get("street"),
            get("city"),
            get("state"),
            get("postal_code"),
            notes,
            merged.join(","),
            existing.id,
            orgId
          ),
      ],
      remember: (c) => {
        // So a second row for the same person in this file sees the merge.
        if (email) c.contactsByEmail.set(email, { id: existing.id, roles: merged });
      },
    };
  }

  const id = newId("contact");
  return {
    action: "create",
    draft,
    statements: (db, orgId, batchId) => [
      db
        .prepare(
          `INSERT INTO contacts (id, org_id, name, email, phone, roles, street, city, state,
                                 postal_code, notes, import_batch_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          id,
          orgId,
          name,
          email,
          get("phone") || null,
          newRoles.join(","),
          get("street") || null,
          get("city") || null,
          get("state") || null,
          get("postal_code") || null,
          notes || null,
          batchId
        ),
    ],
    remember: (c) => {
      if (email) c.contactsByEmail.set(email, { id, roles: newRoles });
    },
  };
}

function buildItem(
  get: (f: string) => string,
  line: number,
  opts: ImportOptions,
  leftovers: string,
  ctx: MatchContext,
  skipped: RowIssue[],
  warnings: RowIssue[]
): BuiltRow | null {
  const title = get("title");
  if (!title) {
    skipped.push({ line, reason: "No title in this row" });
    return null;
  }

  const rawPrice = get("price_cents");
  const price = rawPrice ? parseMoneyCents(rawPrice) : 0;
  if (rawPrice && price === null) {
    skipped.push({ line, reason: `Could not read the price "${rawPrice}"` });
    return null;
  }
  if (price !== null && price < 0) {
    skipped.push({ line, reason: `Negative price "${rawPrice}"` });
    return null;
  }

  const rawIntake = get("intake_date");
  let intake = rawIntake ? parseDate(rawIntake, opts.dayFirst) : null;
  if (rawIntake && !intake) {
    warnings.push({
      line,
      reason: `Could not read the date "${rawIntake}" — this item will start its colour rotation today`,
    });
  }
  if (!intake) intake = new Date().toISOString().slice(0, 10);

  const condition = normaliseCondition(get("condition"));
  if (condition.guessed) {
    warnings.push({
      line,
      reason: `Condition "${get("condition")}" isn't one we recognise — imported as "good"`,
    });
  }

  const retailRaw = get("retail_estimate_cents");
  const retail = retailRaw ? (parseMoneyCents(retailRaw) ?? 0) : 0;
  const weight = parseNumber(get("weight_lbs")) ?? 0;
  const tag = get("tag_number");
  const notes = [get("notes"), leftovers].filter(Boolean).join("\n");
  const existingId = tag ? ctx.itemsByTag.get(tag) : undefined;

  const draft: Draft = {
    title,
    tag_number: tag,
    price: price ?? 0,
    category: get("category"),
    condition: condition.value,
    intake_date: intake,
    tag_color: tagColorForIntake(intake),
    notes,
  };

  if (existingId) {
    return {
      action: "update",
      draft: { ...draft, matched: "existing item with this tag number" },
      statements: (db, orgId) => [
        db
          .prepare(
            `UPDATE items
                SET title = ?, description = COALESCE(NULLIF(?, ''), description),
                    category = COALESCE(NULLIF(?, ''), category),
                    brand = COALESCE(NULLIF(?, ''), brand),
                    color = COALESCE(NULLIF(?, ''), color),
                    size = COALESCE(NULLIF(?, ''), size),
                    condition = ?, price_cents = ?, original_price_cents = ?,
                    retail_estimate_cents = ?, weight_lbs = ?,
                    intake_date = ?, tag_color = ?, updated_at = datetime('now')
              WHERE id = ? AND org_id = ?`
          )
          .bind(
            title,
            notes,
            get("category"),
            get("brand"),
            get("color"),
            get("size"),
            condition.value,
            price ?? 0,
            price ?? 0,
            retail,
            weight,
            intake,
            tagColorForIntake(intake),
            existingId,
            orgId
          ),
      ],
    };
  }

  const id = newId("item");
  return {
    action: "create",
    draft,
    statements: (db, orgId, batchId, userId) => [
      db
        .prepare(
          `INSERT INTO items (id, org_id, tag_number, title, description, category, brand, color,
                              size, condition, price_cents, original_price_cents,
                              retail_estimate_cents, weight_lbs, tag_color, intake_date,
                              status, created_by, import_batch_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'available', ?, ?)`
        )
        .bind(
          id,
          orgId,
          tag || null,
          title,
          notes || null,
          get("category") || null,
          get("brand") || null,
          get("color") || null,
          get("size") || null,
          condition.value,
          price ?? 0,
          price ?? 0,
          retail,
          weight,
          tagColorForIntake(intake),
          intake,
          userId,
          batchId
        ),
    ],
    remember: (c) => {
      if (tag) c.itemsByTag.set(tag, id);
    },
  };
}

function buildDonation(
  get: (f: string) => string,
  line: number,
  opts: ImportOptions,
  leftovers: string,
  ctx: MatchContext,
  skipped: RowIssue[],
  warnings: RowIssue[]
): BuiltRow | null {
  const rawDate = get("received_at");
  const received = parseDate(rawDate, opts.dayFirst);
  if (!received) {
    skipped.push({
      line,
      reason: rawDate ? `Could not read the date "${rawDate}"` : "No date in this row",
    });
    return null;
  }

  const email = normaliseEmail(get("donor_email"));
  const donorName = get("donor_name");
  let contactId = email ? (ctx.contactsByEmail.get(email)?.id ?? null) : null;

  // A donation whose donor we've never seen. Creating the person is better than
  // orphaning the record, but it's worth saying so — importing people first
  // gives a much better result.
  let createContact: { id: string; name: string; email: string } | null = null;
  if (!contactId && email) {
    createContact = { id: newId("contact"), name: donorName || email, email };
    contactId = createContact.id;
    warnings.push({
      line,
      reason: `No existing person with ${email} — creating one. Importing your people file first gives a better match.`,
    });
  } else if (!contactId && donorName) {
    warnings.push({
      line,
      reason: `"${donorName}" has no email in this file, so this donation is recorded without a donor attached.`,
    });
  }

  const weight = parseNumber(get("est_weight_lbs")) ?? 0;
  const itemCount = Math.max(0, Math.round(parseNumber(get("item_count")) ?? 0));
  const rawAmount = get("amount_cents");
  const amount = rawAmount ? parseMoneyCents(rawAmount) : 0;
  if (rawAmount && amount === null) {
    skipped.push({ line, reason: `Could not read the amount "${rawAmount}"` });
    return null;
  }

  const cents = amount ?? 0;
  const key = donationKey(contactId, received, weight, cents);
  if (ctx.donationKeys.has(key)) {
    skipped.push({
      line,
      reason: "Already recorded — same donor, same day, same amount. Skipped so a second run doesn't double it.",
    });
    return null;
  }

  const description = [get("description"), leftovers].filter(Boolean).join("\n");
  const id = newId("donation");

  return {
    action: "create",
    draft: {
      received_at: received,
      donor: donorName || email || "Anonymous",
      item_count: itemCount,
      est_weight_lbs: weight,
      amount_cents: cents,
    },
    statements: (db, orgId, batchId) => {
      const out: D1PreparedStatement[] = [];
      if (createContact) {
        out.push(
          db
            .prepare(
              `INSERT INTO contacts (id, org_id, name, email, roles, import_batch_id)
               VALUES (?, ?, ?, ?, 'donor', ?)`
            )
            .bind(createContact.id, orgId, createContact.name, createContact.email, batchId)
        );
      }
      out.push(
        db
          .prepare(
            `INSERT INTO donations (id, org_id, contact_id, kind, received_at, item_count,
                                    est_weight_lbs, amount_cents, description, import_batch_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .bind(
            id,
            orgId,
            contactId,
            cents > 0 ? "cash" : "goods",
            `${received}T12:00:00.000Z`,
            itemCount,
            weight,
            cents,
            description || null,
            batchId
          )
      );
      return out;
    },
    remember: (c) => {
      c.donationKeys.add(key);
      if (createContact) {
        c.contactsByEmail.set(createContact.email, { id: createContact.id, roles: ["donor"] });
      }
    },
  };
}

/** A batch's stored skip reasons, for the "what happened" screen. */
export async function batchNotes(
  db: D1Database,
  orgId: string,
  batchId: string
): Promise<{ skipped: RowIssue[]; warnings: RowIssue[] }> {
  const row = await first<{ notes_json: string }>(
    db,
    `SELECT notes_json FROM import_batches WHERE id = ? AND org_id = ?`,
    batchId,
    orgId
  );
  if (!row) return { skipped: [], warnings: [] };
  try {
    const parsed = JSON.parse(row.notes_json) as { skipped?: RowIssue[]; warnings?: RowIssue[] };
    return { skipped: parsed.skipped ?? [], warnings: parsed.warnings ?? [] };
  } catch {
    return { skipped: [], warnings: [] };
  }
}
