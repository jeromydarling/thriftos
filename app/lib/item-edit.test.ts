import { describe, expect, it } from "vitest";
import {
  ITEM_STATUSES,
  ItemEditError,
  diffItem,
  isHeld,
  moneyIsSettled,
  readItemForm,
  saveItem,
  type ItemEdits,
  type ItemRow,
} from "./item-edit";

const BASE: ItemRow = {
  id: "it_1",
  title: "Navy wool peacoat",
  description: "Heavy navy wool.",
  category: "Outerwear",
  brand: null,
  color: "navy",
  size: "M",
  material: null,
  condition: "good",
  condition_notes: null,
  price_cents: 2200,
  retail_estimate_cents: 9000,
  weight_lbs: 2.4,
  tag_color: "green",
  tag_number: "W100",
  intake_date: "2026-07-20",
  status: "available",
  location_id: null,
  photo_key: "photos/demo/peacoat.jpg",
  photo_enhanced_key: null,
  photo_enhanced_at: null,
  sold_at: null,
  sold_price_cents: null,
  held_by_transaction_id: null,
};

function editsFrom(item: ItemRow, over: Partial<ItemEdits> = {}): ItemEdits {
  return {
    title: item.title,
    description: item.description ?? "",
    category: item.category ?? "",
    brand: item.brand ?? "",
    color: item.color ?? "",
    size: item.size ?? "",
    material: item.material ?? "",
    condition: item.condition,
    conditionNotes: item.condition_notes ?? "",
    priceCents: item.price_cents,
    retailCents: item.retail_estimate_cents,
    weightLbs: item.weight_lbs,
    tagColor: item.tag_color ?? "",
    tagNumber: item.tag_number ?? "",
    locationId: item.location_id ?? "",
    status: item.status,
    ...over,
  };
}

/** A D1 stand-in: serves one item row and records what was written. */
function dbFor(item: ItemRow | null) {
  const writes: { sql: string; args: unknown[] }[] = [];
  const db = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            first: async () => item,
            run: async () => {
              writes.push({ sql, args });
              return { success: true };
            },
            all: async () => ({ results: [] }),
          };
        },
      };
    },
  } as unknown as D1Database;
  return { db, writes };
}

const save = (item: ItemRow | null, over: Partial<ItemEdits> = {}) => {
  const { db, writes } = dbFor(item);
  return {
    writes,
    run: () =>
      saveItem(db, {
        orgId: "org_1",
        userId: "usr_1",
        itemId: "it_1",
        edits: editsFrom(item ?? BASE, over),
      }),
  };
};

describe("reading the form", () => {
  it("takes dollars and stores integer cents", () => {
    const form = new FormData();
    form.set("title", "  A coat  ");
    form.set("price", "$22.50");
    form.set("retail", "90");
    form.set("weight_lbs", "2.4");
    const edits = readItemForm(form);
    expect(edits.title).toBe("A coat");
    expect(edits.priceCents).toBe(2250);
    expect(edits.retailCents).toBe(9000);
    expect(edits.weightLbs).toBe(2.4);
  });

  it("never lets a NaN reach the database", () => {
    const form = new FormData();
    form.set("price", "what");
    form.set("weight_lbs", "heavy");
    const edits = readItemForm(form);
    expect(edits.priceCents).toBe(0);
    expect(edits.weightLbs).toBe(0);
  });

  it("drops a stray minus rather than storing a negative price", () => {
    // The sign is stripped before parsing, so "-5" reads as $5 — not as a
    // clamp to zero. Worth knowing which of the two it is: a negative price
    // must never reach the database, and this is the reason it can't.
    const form = new FormData();
    form.set("price", "-5");
    expect(readItemForm(form).priceCents).toBe(500);
    expect(readItemForm(form).priceCents).toBeGreaterThanOrEqual(0);
  });
});

describe("what counts as settled or held", () => {
  it("treats a sold item as settled", () => {
    expect(moneyIsSettled({ status: "sold", sold_at: null })).toBe(true);
    expect(moneyIsSettled({ status: "available", sold_at: "2026-07-01" })).toBe(true);
    expect(moneyIsSettled({ status: "available", sold_at: null })).toBe(false);
  });

  it("treats a reserved item as held even if its status lags", () => {
    // The hold is set by the reservation, and status can be a step behind.
    expect(isHeld({ status: "available", held_by_transaction_id: "tx_1" })).toBe(true);
    expect(isHeld({ status: "held", held_by_transaction_id: null })).toBe(true);
  });
});

describe("the rules that protect money", () => {
  it("refuses to change the price of a sold item", async () => {
    const sold = { ...BASE, status: "sold", sold_at: "2026-07-25", sold_price_cents: 2200 };
    await expect(save(sold, { priceCents: 100 }).run()).rejects.toBeInstanceOf(ItemEditError);
    await expect(save(sold, { priceCents: 100 }).run()).rejects.toThrow(/refund it from the sale/i);
  });

  it("refuses to put a sold item back on the floor", async () => {
    const sold = { ...BASE, status: "sold", sold_at: "2026-07-25" };
    await expect(save(sold, { status: "available" }).run()).rejects.toThrow(/refund the sale/i);
  });

  it("still lets a sold item's description be corrected", async () => {
    const sold = { ...BASE, status: "sold", sold_at: "2026-07-25" };
    const { run, writes } = save(sold, { title: "Navy wool pea coat" });
    await expect(run()).resolves.toEqual({ changed: ["title"] });
    expect(writes.some((w) => w.sql.includes("UPDATE items"))).toBe(true);
  });

  it("refuses to change the status of something being paid for", async () => {
    const held = { ...BASE, status: "available", held_by_transaction_id: "tx_9" };
    await expect(save(held, { status: "recycled" }).run()).rejects.toThrow(/half an hour/i);
  });

  it("lets a held item's description be corrected", async () => {
    const held = { ...BASE, held_by_transaction_id: "tx_9" };
    await expect(save(held, { description: "Lining is sound." }).run()).resolves.toEqual({
      changed: ["description"],
    });
  });

  it("refuses a status it doesn't know", async () => {
    await expect(save(BASE, { status: "vaporised" }).run()).rejects.toThrow(/isn't a status/i);
  });

  it("refuses an item with no name", async () => {
    await expect(save(BASE, { title: "" }).run()).rejects.toThrow(/needs a name/i);
  });

  it("refuses an item it can't find", async () => {
    await expect(save(null).run()).rejects.toThrow(/can't find/i);
  });
});

describe("the record it leaves", () => {
  it("writes an audit row with what changed, and what it was", async () => {
    const { run, writes } = save(BASE, { priceCents: 1800, title: "Navy peacoat" });
    await run();

    const audit = writes.find((w) => w.sql.includes("audit_log"));
    expect(audit).toBeDefined();
    const meta = JSON.parse(String(audit!.args.at(-1)));
    expect(meta.price_cents).toEqual([2200, 1800]);
    expect(meta.title).toEqual(["Navy wool peacoat", "Navy peacoat"]);
    // Whose name is on it.
    expect(audit!.args).toContain("usr_1");
  });

  it("writes nothing at all when nothing changed", async () => {
    const { run, writes } = save(BASE);
    await expect(run()).resolves.toEqual({ changed: [] });
    expect(writes).toHaveLength(0);
  });

  it("compares as strings, so 2.40 and 2.4 aren't a change", () => {
    expect(diffItem(BASE, editsFrom(BASE, { weightLbs: 2.4 }))).toEqual({});
    expect(diffItem(BASE, editsFrom(BASE, { weightLbs: 2.5 }))).toHaveProperty("weight_lbs");
  });

  it("counts clearing a field as a change", () => {
    expect(diffItem(BASE, editsFrom(BASE, { category: "" }))).toHaveProperty("category");
  });
});

describe("the statuses offered", () => {
  it("covers what the items table documents", () => {
    for (const s of ["available", "held", "sold", "recycled", "pulled"]) {
      expect(ITEM_STATUSES).toContain(s);
    }
  });
});
