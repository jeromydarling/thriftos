/**
 * Sample data — filling an empty shop so a person can judge the software.
 *
 * A new shop sees zeroes on every screen. Zeroes are honest but useless: they
 * can't tell you whether the Compass notices anything worth noticing, or what
 * a markdown rotation looks like once stock has aged into it. So a shop can
 * load a set of invented records, look around, and remove every trace.
 *
 * Two rules govern everything in this file:
 *
 *   1. It is always labelled. Every record carries is_sample = 1, contacts and
 *      items are visibly named as samples, and a banner sits across the app for
 *      as long as any of it exists. Nobody should ever have to wonder whether a
 *      number on their screen is real.
 *
 *   2. It never counts. is_sample = 1 is excluded from impact reporting, from
 *      NRI's aggregate figures, and from billing. A shop that explores for a
 *      week and then goes live must not find invented weight in its first
 *      board report.
 *
 * The dataset is deliberately smaller than the public demo shop (app/lib/seed.ts).
 * The demo is a sales tool and wants a year of history; this runs inside a real
 * shop's database and wants to be quick to load and quick to remove.
 */
import { batch, first, run } from "./db";
import { newId } from "./ids";
import { tagColorForIntake } from "./markdown";
import { createBatch, finishBatch, reverseBatch, sampleBatchId } from "./onboarding";

/** Prefixed onto every sample name, so no list can hide what these are. */
export const SAMPLE_LABEL = "SAMPLE";

const DAY = 86_400_000;

/** Deterministic, so two shops that load samples see the same shop. */
function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

const CATEGORIES = [
  { name: "Outerwear", items: ["Wool peacoat", "Denim jacket", "Rain shell"], low: 800, high: 2400, retail: 9000, lbs: 2.4 },
  { name: "Tops", items: ["Flannel shirt", "Cotton blouse", "Cable knit sweater"], low: 300, high: 900, retail: 3200, lbs: 0.6 },
  { name: "Housewares", items: ["Pyrex casserole dish", "Cast iron skillet", "Table lamp"], low: 400, high: 1800, retail: 4500, lbs: 3.1 },
  { name: "Books", items: ["Paperback novel", "Cookbook", "Field guide"], low: 100, high: 400, retail: 1600, lbs: 0.8 },
  { name: "Furniture", items: ["Oak side table", "Reading chair", "Bookshelf"], low: 2500, high: 8500, retail: 24000, lbs: 22 },
  { name: "Toys & Games", items: ["Wooden puzzle", "Board game", "Stuffed bear"], low: 200, high: 700, retail: 2400, lbs: 1.2 },
];

const COLORS = ["navy", "cream", "forest green", "rust", "charcoal", "burgundy"];
const CONDITIONS = ["excellent", "good", "good", "good", "fair"];

/**
 * Obviously-invented names. Real-sounding names would be a small cruelty: a
 * manager scrolling People should never wonder whether they've met this person.
 */
const PEOPLE = [
  "Sample Donor One",
  "Sample Donor Two",
  "Sample Donor Three",
  "Sample Donor Four",
  "Sample Donor Five",
  "Sample Donor Six",
  "Sample Volunteer One",
  "Sample Volunteer Two",
  "Sample Volunteer Three",
  "Sample Shopper One",
];

export interface SampleDataResult {
  batchId: string;
  contacts: number;
  donations: number;
  items: number;
  transactions: number;
  shifts: number;
}

export interface SampleDataSummary {
  batchId: string;
  loadedAt: string;
  counts: Record<string, number>;
}

/**
 * Load sample data into a real shop.
 *
 * Refuses if a sample batch is already loaded, rather than doubling it — the
 * second press of a button that seemed to do nothing is a real thing people do.
 */
export async function loadSampleData(
  db: D1Database,
  orgId: string,
  userId?: string | null
): Promise<SampleDataResult> {
  const existing = await sampleBatchId(db, orgId);
  if (existing) {
    throw new Error("Sample data is already loaded. Clear it before loading again.");
  }

  const batchId = await createBatch(db, orgId, "sample", "sample-data", userId);

  const location = await first<{ id: string }>(
    db,
    `SELECT id FROM locations WHERE org_id = ? ORDER BY is_default DESC, created_at LIMIT 1`,
    orgId
  );
  const locationId = location?.id ?? null;

  const rand = seeded(20260726);
  const stmts: D1PreparedStatement[] = [];
  const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * DAY).toISOString();
  const day = (daysAgo: number) => iso(daysAgo).slice(0, 10);

  /* People. Roles stack, exactly as they do in a real shop. */
  const contactIds: string[] = [];
  PEOPLE.forEach((name, i) => {
    const id = newId("contact");
    contactIds.push(id);
    const roles = name.includes("Volunteer")
      ? ["volunteer", "donor"]
      : name.includes("Shopper")
        ? ["shopper"]
        : ["donor"];

    stmts.push(
      db
        .prepare(
          `INSERT INTO contacts (id, org_id, name, email, roles, first_seen_at, last_seen_at,
                                 import_batch_id, is_sample, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`
        )
        .bind(
          id,
          orgId,
          name,
          `sample${i + 1}@example.invalid`,
          roles.join(","),
          iso(280 - i * 6),
          iso(Math.floor(rand() * 40)),
          batchId,
          iso(Math.floor(rand() * 60))
        )
    );
  });

  /* Donations, spread so donor rhythms are real enough for NRI to read. */
  const donationIds: string[] = [];
  let receiptNo = 0;
  contactIds.forEach((contactId, i) => {
    if (PEOPLE[i].includes("Shopper")) return;

    // One donor deliberately goes quiet, so the Compass has a check-in to raise.
    const quiet = i === 2;
    const visits = quiet ? 4 : 3 + (i % 3);

    for (let v = 0; v < visits; v++) {
      const daysAgo = quiet ? 95 + v * 30 : Math.floor(8 + v * 26 + rand() * 10);
      const id = newId("donation");
      donationIds.push(id);

      stmts.push(
        db
          .prepare(
            `INSERT INTO donations (id, org_id, contact_id, kind, received_at, item_count,
                                    est_weight_lbs, description, import_batch_id, is_sample)
             VALUES (?, ?, ?, 'goods', ?, ?, ?, ?, ?, 1)`
          )
          .bind(
            id,
            orgId,
            contactId,
            iso(daysAgo),
            2 + Math.floor(rand() * 6),
            6 + Math.floor(rand() * 24),
            `${SAMPLE_LABEL} — bags of household goods and clothing`,
            batchId
          )
      );

      // Most get a receipt, but not all — so "receipts pending" has work to show.
      if (v > 0 || i % 3 !== 0) {
        receiptNo++;
        stmts.push(
          db
            .prepare(
              `INSERT INTO donation_receipts
                 (id, org_id, donation_id, contact_id, receipt_number, issued_at,
                  description, goods_services_statement)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
            )
            .bind(
              newId("receipt"),
              orgId,
              id,
              contactId,
              `SAMPLE-${String(receiptNo).padStart(4, "0")}`,
              iso(Math.max(0, daysAgo - 1)),
              `${SAMPLE_LABEL} — donated household goods and clothing`,
              "No goods or services were provided in exchange for this contribution."
            )
        );
      }
    }
  });

  /* Inventory across the full age range, so the colour rotation is visible. */
  const sold: { id: string; price: number; retail: number; ageDays: number }[] = [];
  const ITEM_COUNT = 90;

  for (let i = 0; i < ITEM_COUNT; i++) {
    const cat = CATEGORIES[Math.floor(rand() * CATEGORIES.length)];
    const name = cat.items[Math.floor(rand() * cat.items.length)];
    const color = COLORS[Math.floor(rand() * COLORS.length)];
    const condition = CONDITIONS[Math.floor(rand() * CONDITIONS.length)];
    const price = cat.low + Math.floor(rand() * (cat.high - cat.low));
    const ageDays = Math.floor(rand() * 84);
    const intake = day(ageDays);
    const id = newId("item");

    // Older stock is likelier to have sold; some deliberately lingers, so the
    // aging-stock rule has something to point at.
    const isSold = rand() < (ageDays > 56 ? 0.25 : 0.42);
    if (isSold) sold.push({ id, price, retail: cat.retail, ageDays });

    stmts.push(
      db
        .prepare(
          `INSERT INTO items (id, org_id, location_id, donation_id, tag_number, title, description,
                              category, color, size, condition, price_cents, original_price_cents,
                              retail_estimate_cents, weight_lbs, tag_color, intake_date, status,
                              sold_at, sold_price_cents, import_batch_id, is_sample, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`
        )
        .bind(
          id,
          orgId,
          locationId,
          donationIds[Math.floor(rand() * donationIds.length)] ?? null,
          `SAMPLE-${String(1000 + i)}`,
          `${SAMPLE_LABEL} — ${color} ${name.toLowerCase()}`,
          `A ${condition} ${name.toLowerCase()} in ${color}. This is sample data, not a real item.`,
          cat.name,
          color,
          cat.name === "Tops" || cat.name === "Outerwear"
            ? ["S", "M", "L", "XL"][Math.floor(rand() * 4)]
            : null,
          condition,
          price,
          price,
          cat.retail,
          cat.lbs,
          tagColorForIntake(intake),
          intake,
          isSold ? "sold" : "available",
          isSold ? iso(Math.floor(rand() * (ageDays + 1))) : null,
          isSold ? price : null,
          batchId,
          iso(ageDays)
        )
    );
  }

  /* Sales, so the register has history and value-delivered adds up. */
  let txCount = 0;
  for (let i = 0; i < sold.length; i += 2) {
    const lines = sold.slice(i, i + 2);
    if (lines.length === 0) continue;

    const txId = newId("transaction");
    const subtotal = lines.reduce((s, l) => s + l.price, 0);
    const roundup = rand() < 0.35 ? 100 - (subtotal % 100 || 100) : 0;
    const createdAt = iso(Math.floor(rand() * 30));
    txCount++;

    stmts.push(
      db
        .prepare(
          `INSERT INTO transactions (id, org_id, location_id, subtotal_cents, tax_cents,
                                     roundup_cents, total_cents, tender, import_batch_id,
                                     is_sample, created_at)
           VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, 1, ?)`
        )
        .bind(
          txId,
          orgId,
          locationId,
          subtotal,
          roundup,
          subtotal + roundup,
          rand() < 0.6 ? "cash" : "card",
          batchId,
          createdAt
        )
    );

    for (const line of lines) {
      stmts.push(
        db
          .prepare(
            `INSERT INTO transaction_items (id, org_id, transaction_id, item_id, title,
                                            price_cents, retail_estimate_cents, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .bind(
            newId("txItem"),
            orgId,
            txId,
            line.id,
            `${SAMPLE_LABEL} item`,
            line.price,
            line.retail,
            createdAt
          )
      );
    }
  }

  /* Volunteer shifts. A steady crew, and one person who has drifted off. */
  let shiftCount = 0;
  contactIds.forEach((contactId, i) => {
    if (!PEOPLE[i].includes("Volunteer")) return;
    const drifted = PEOPLE[i].endsWith("Three");
    const count = drifted ? 4 : 8;

    for (let s = 0; s < count; s++) {
      const daysAgo = drifted ? 48 + s * 7 : s * 7 + 2;
      const start = new Date(Date.now() - daysAgo * DAY);
      start.setUTCHours(14, 0, 0, 0);
      shiftCount++;

      stmts.push(
        db
          .prepare(
            `INSERT INTO shifts (id, org_id, location_id, contact_id, role_label, starts_at,
                                 ends_at, status, hours_logged, import_batch_id, is_sample)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'completed', 4, ?, 1)`
          )
          .bind(
            newId("shift"),
            orgId,
            locationId,
            contactId,
            ["floor", "sorting", "register"][s % 3],
            start.toISOString(),
            new Date(start.getTime() + 4 * 3600_000).toISOString(),
            batchId
          )
      );
    }

    if (!drifted) {
      const start = new Date(Date.now() + (2 + i) * DAY);
      start.setUTCHours(14, 0, 0, 0);
      shiftCount++;
      stmts.push(
        db
          .prepare(
            `INSERT INTO shifts (id, org_id, location_id, contact_id, role_label, starts_at,
                                 ends_at, status, hours_logged, import_batch_id, is_sample)
             VALUES (?, ?, ?, ?, 'floor', ?, ?, 'scheduled', 0, ?, 1)`
          )
          .bind(
            newId("shift"),
            orgId,
            locationId,
            contactId,
            start.toISOString(),
            new Date(start.getTime() + 4 * 3600_000).toISOString(),
            batchId
          )
      );
    }
  });

  // Chunked — the per-request subrequest budget is not generous.
  for (let i = 0; i < stmts.length; i += 40) {
    await batch(db, stmts.slice(i, i + 40));
  }

  const result: SampleDataResult = {
    batchId,
    contacts: contactIds.length,
    donations: donationIds.length,
    items: ITEM_COUNT,
    transactions: txCount,
    shifts: shiftCount,
  };

  await finishBatch(db, batchId, {
    created:
      result.contacts + result.donations + result.items + result.transactions + result.shifts,
    updated: 0,
    skipped: 0,
    notes: { sample: true, ...result },
  });

  return result;
}

/**
 * Remove every sample record, and nothing else.
 *
 * Delegates to the same reversal used by CSV imports. One undo path, one set of
 * bugs to find — and it can only ever touch rows carrying the batch id, so
 * anything a person entered by hand is out of reach by construction.
 */
export async function clearSampleData(
  db: D1Database,
  orgId: string
): Promise<{ cleared: boolean; removed: Record<string, number> }> {
  const batchId = await sampleBatchId(db, orgId);
  if (!batchId) return { cleared: false, removed: {} };

  const removed = await reverseBatch(db, orgId, batchId);

  // Belt and braces. If a future code path ever writes a sample row without a
  // batch id, this catches it rather than leaving invented records in a real
  // shop's reports forever.
  for (const table of ["transactions", "items", "donations", "shifts", "contacts"]) {
    await run(db, `DELETE FROM ${table} WHERE org_id = ? AND is_sample = 1`, orgId);
  }

  return { cleared: true, removed };
}

/** What's loaded right now, for the banner and the welcome screen. */
export async function sampleDataSummary(
  db: D1Database,
  orgId: string
): Promise<SampleDataSummary | null> {
  const row = await first<{ id: string; created_at: string; notes_json: string }>(
    db,
    `SELECT id, created_at, notes_json FROM import_batches
      WHERE org_id = ? AND kind = 'sample' AND status = 'complete'
      ORDER BY created_at DESC LIMIT 1`,
    orgId
  );
  if (!row) return null;

  let counts: Record<string, number> = {};
  try {
    const parsed = JSON.parse(row.notes_json) as Record<string, unknown>;
    counts = Object.fromEntries(
      Object.entries(parsed)
        .filter(([, v]) => typeof v === "number")
        .map(([k, v]) => [k, v as number])
    );
  } catch {
    counts = {};
  }

  return { batchId: row.id, loadedAt: row.created_at, counts };
}
