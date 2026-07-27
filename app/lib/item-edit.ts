/**
 * Correcting an item after it has been logged.
 *
 * Until now an item could be created and never changed, which is a strange
 * thing to ask of a shop: the guess at intake is a guess, prices get typed
 * wrong, and a coat pulled off the floor for a repair has nowhere to go. This
 * is the screen behind that, and most of the file is about the things it
 * refuses to do.
 *
 * Three rules, all of them about not rewriting history:
 *
 *   A sold item's money is fixed. Its price is what somebody paid, its sale is
 *   in the ledger and in this month's figures, and editing it here would make
 *   the two disagree with no record of why. Descriptive fields stay editable —
 *   fixing a misspelled title on a sold item harms nobody.
 *
 *   A held item's status is not yours to change. Something held is part-way
 *   through a payment. Marking it recycled underneath a shopper who is typing
 *   their card number is how one coat gets sold twice.
 *
 *   Every change is written to the audit log with what it was and what it
 *   became. A price that changed with nobody's name against it is the thing
 *   somebody will ask about in six months.
 */
import { first, run } from "./db";
import { newId } from "./ids";

export const ITEM_STATUSES = ["available", "held", "sold", "recycled", "pulled"] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];

/** What a person is allowed to set by hand. */
export const CONDITIONS = ["new", "excellent", "good", "fair", "flawed"] as const;

export class ItemEditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ItemEditError";
  }
}

export interface ItemRow {
  id: string;
  title: string;
  description: string | null;
  category: string | null;
  brand: string | null;
  color: string | null;
  size: string | null;
  material: string | null;
  condition: string;
  condition_notes: string | null;
  price_cents: number;
  retail_estimate_cents: number;
  weight_lbs: number;
  tag_color: string | null;
  tag_number: string | null;
  intake_date: string;
  status: string;
  location_id: string | null;
  photo_key: string | null;
  photo_enhanced_key: string | null;
  photo_enhanced_at: string | null;
  sold_at: string | null;
  sold_price_cents: number | null;
  held_by_transaction_id: string | null;
}

export async function itemById(
  db: D1Database,
  orgId: string,
  itemId: string
): Promise<ItemRow | null> {
  return (
    (await first<ItemRow>(
      db,
      `SELECT id, title, description, category, brand, color, size, material, condition,
              condition_notes, price_cents, retail_estimate_cents, weight_lbs, tag_color,
              tag_number, intake_date, status, location_id, photo_key, photo_enhanced_key,
              photo_enhanced_at, sold_at, sold_price_cents, held_by_transaction_id
         FROM items WHERE id = ? AND org_id = ?`,
      itemId,
      orgId
    )) ?? null
  );
}

/** True when the money on this item is settled and must not move. */
export function moneyIsSettled(item: Pick<ItemRow, "status" | "sold_at">): boolean {
  return item.status === "sold" || item.sold_at !== null;
}

/** True when something else is mid-transaction against this item. */
export function isHeld(item: Pick<ItemRow, "status" | "held_by_transaction_id">): boolean {
  return item.status === "held" || item.held_by_transaction_id !== null;
}

export interface ItemEdits {
  title: string;
  description: string;
  category: string;
  brand: string;
  color: string;
  size: string;
  material: string;
  condition: string;
  conditionNotes: string;
  priceCents: number;
  retailCents: number;
  weightLbs: number;
  tagColor: string;
  tagNumber: string;
  locationId: string;
  status: string;
}

/**
 * Read a form into a shape, without deciding whether it's allowed.
 *
 * Parsing and permission are separate on purpose: the rules below are easier
 * to read when they aren't tangled with `String(form.get(...))`.
 */
export function readItemForm(form: {
  get(name: string): FormDataEntryValue | null;
}): ItemEdits {
  const text = (name: string) => String(form.get(name) ?? "").trim();
  const cents = (name: string) => {
    // Typed as dollars, stored as integer cents. Anything unparseable is a
    // zero rather than a NaN that would reach the database, and the strip to
    // digits means a stray minus is dropped rather than making a price
    // negative — "-5" reads as five dollars.
    const raw = Number.parseFloat(text(name).replace(/[^0-9.]/g, ""));
    return Number.isFinite(raw) ? Math.max(0, Math.round(raw * 100)) : 0;
  };

  return {
    title: text("title"),
    description: text("description"),
    category: text("category"),
    brand: text("brand"),
    color: text("color"),
    size: text("size"),
    material: text("material"),
    condition: text("condition"),
    conditionNotes: text("condition_notes"),
    priceCents: cents("price"),
    retailCents: cents("retail"),
    weightLbs: Math.max(0, Number.parseFloat(text("weight_lbs")) || 0),
    tagColor: text("tag_color"),
    tagNumber: text("tag_number"),
    locationId: text("location_id"),
    status: text("status"),
  };
}

/** Field-by-field, what actually changed. Empty when nothing did. */
export function diffItem(before: ItemRow, edits: ItemEdits): Record<string, [unknown, unknown]> {
  const pairs: [string, unknown, unknown][] = [
    ["title", before.title, edits.title],
    ["description", before.description ?? "", edits.description],
    ["category", before.category ?? "", edits.category],
    ["brand", before.brand ?? "", edits.brand],
    ["color", before.color ?? "", edits.color],
    ["size", before.size ?? "", edits.size],
    ["material", before.material ?? "", edits.material],
    ["condition", before.condition, edits.condition],
    ["condition_notes", before.condition_notes ?? "", edits.conditionNotes],
    ["price_cents", before.price_cents, edits.priceCents],
    ["retail_estimate_cents", before.retail_estimate_cents, edits.retailCents],
    ["weight_lbs", before.weight_lbs, edits.weightLbs],
    ["tag_color", before.tag_color ?? "", edits.tagColor],
    ["tag_number", before.tag_number ?? "", edits.tagNumber],
    ["location_id", before.location_id ?? "", edits.locationId],
    ["status", before.status, edits.status],
  ];

  const changed: Record<string, [unknown, unknown]> = {};
  for (const [key, was, now] of pairs) {
    if (String(was) !== String(now)) changed[key] = [was, now];
  }
  return changed;
}

/**
 * Apply an edit, or refuse it and say why.
 *
 * Returns the fields that changed, so the screen can tell somebody what it
 * did rather than just going quiet.
 */
export async function saveItem(
  db: D1Database,
  opts: { orgId: string; userId: string; itemId: string; edits: ItemEdits }
): Promise<{ changed: string[] }> {
  const before = await itemById(db, opts.orgId, opts.itemId);
  if (!before) throw new ItemEditError("We can't find that item.");

  const edits = { ...opts.edits };

  if (!edits.title) throw new ItemEditError("An item needs a name — it's what everything else hangs off.");

  if (!ITEM_STATUSES.includes(edits.status as ItemStatus)) {
    throw new ItemEditError("That isn't a status we know.");
  }

  // Rule 1: a sold item's money is what somebody paid.
  if (moneyIsSettled(before)) {
    if (edits.priceCents !== before.price_cents) {
      throw new ItemEditError(
        "This one is sold, so its price is what the customer paid and can't be edited here. If the sale itself was wrong, refund it from the sale — that leaves a record."
      );
    }
    if (edits.status !== before.status) {
      throw new ItemEditError(
        "This one is sold. Putting it back on the floor by changing its status would leave the sale in your figures with nothing sold against it — refund the sale instead."
      );
    }
  }

  // Rule 2: something held is part-way through being paid for.
  if (isHeld(before) && edits.status !== before.status) {
    throw new ItemEditError(
      "Somebody is part-way through paying for this one. Wait for that to finish or fail — it clears itself within half an hour."
    );
  }

  const changed = diffItem(before, edits);
  if (Object.keys(changed).length === 0) return { changed: [] };

  await run(
    db,
    `UPDATE items
        SET title = ?, description = ?, category = ?, brand = ?, color = ?, size = ?,
            material = ?, condition = ?, condition_notes = ?, price_cents = ?,
            retail_estimate_cents = ?, weight_lbs = ?, tag_color = ?, tag_number = ?,
            location_id = ?, status = ?, updated_at = datetime('now')
      WHERE id = ? AND org_id = ?`,
    edits.title,
    edits.description || null,
    edits.category || null,
    edits.brand || null,
    edits.color || null,
    edits.size || null,
    edits.material || null,
    edits.condition,
    edits.conditionNotes || null,
    edits.priceCents,
    edits.retailCents,
    edits.weightLbs,
    edits.tagColor || null,
    edits.tagNumber || null,
    edits.locationId || null,
    edits.status,
    opts.itemId,
    opts.orgId
  );

  // Rule 3: what it was, what it became, and whose name is on it.
  await run(
    db,
    `INSERT INTO audit_log (id, org_id, user_id, action, entity, entity_id, meta_json)
     VALUES (?, ?, ?, 'item.edited', 'item', ?, ?)`,
    newId("audit"),
    opts.orgId,
    opts.userId,
    opts.itemId,
    JSON.stringify(changed)
  );

  return { changed: Object.keys(changed) };
}
