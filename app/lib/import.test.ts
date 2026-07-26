import { describe, expect, it } from "vitest";
import { previewImport } from "./import";
import type { ImportOptions } from "./import";
import { guessMapping } from "./csv";

/**
 * A stub standing in for D1's read side.
 *
 * The dry run only ever reads — that's the property worth protecting, and this
 * stub enforces it: anything that tries to write throws. The rows it returns
 * stand for records already in the shop, which is what makes it possible to
 * test the create-versus-update decision without a database.
 */
function stubDb(existing: {
  contacts?: { id: string; email: string | null; roles: string | null }[];
  items?: { id: string; tag_number: string }[];
  donations?: {
    contact_id: string | null;
    received_at: string;
    est_weight_lbs: number;
    amount_cents: number;
  }[];
}): D1Database {
  const results = (sql: string) => {
    if (/FROM contacts/i.test(sql)) return existing.contacts ?? [];
    if (/FROM items/i.test(sql)) return existing.items ?? [];
    if (/FROM donations/i.test(sql)) return existing.donations ?? [];
    return [];
  };

  return {
    prepare(sql: string) {
      if (/^\s*(INSERT|UPDATE|DELETE)/i.test(sql)) {
        throw new Error(`A dry run must not write. Attempted: ${sql.slice(0, 40)}`);
      }
      return {
        bind: () => ({
          all: async () => ({ results: results(sql) }),
          first: async () => results(sql)[0] ?? null,
          run: async () => {
            throw new Error("A dry run must not write");
          },
        }),
      };
    },
  } as unknown as D1Database;
}

function opts(headers: string[], kind: ImportOptions["kind"], extra: Partial<ImportOptions> = {}) {
  return { kind, mapping: guessMapping(headers, kind), ...extra } as ImportOptions;
}

const HEADERS_CONTACTS = ["Name", "Email", "Phone", "Roles"];

describe("previewImport — contacts", () => {
  const csv = [
    HEADERS_CONTACTS.join(","),
    "Marta Ellison,marta@example.com,555-0101,donor",
    "Ray Whitfield,RAY@EXAMPLE.COM,555-0102,volunteer",
    ",nobody@example.com,,donor",
  ].join("\n");

  it("creates people who aren't here yet", async () => {
    const plan = await previewImport(stubDb({}), "og_1", csv, opts(HEADERS_CONTACTS, "contacts"));
    expect(plan.creates).toBe(2);
    expect(plan.updates).toBe(0);
  });

  it("skips a row with no name, and says which line", async () => {
    const plan = await previewImport(stubDb({}), "og_1", csv, opts(HEADERS_CONTACTS, "contacts"));
    expect(plan.skipped).toHaveLength(1);
    expect(plan.skipped[0].line).toBe(4);
    expect(plan.skipped[0].reason).toMatch(/no name/i);
  });

  it("matches an existing person by email regardless of case", async () => {
    const db = stubDb({
      contacts: [{ id: "ct_ray", email: "ray@example.com", roles: "donor" }],
    });
    const plan = await previewImport(db, "og_1", csv, opts(HEADERS_CONTACTS, "contacts"));
    expect(plan.updates).toBe(1);
    expect(plan.creates).toBe(1);
  });

  it("merges roles onto a matched person rather than replacing them", async () => {
    const db = stubDb({
      contacts: [{ id: "ct_ray", email: "ray@example.com", roles: "donor,shopper" }],
    });
    const plan = await previewImport(db, "og_1", csv, opts(HEADERS_CONTACTS, "contacts"));
    const ray = plan.preview.find((p) => p.action === "update");
    expect(String(ray?.roles).split(",").sort()).toEqual(["donor", "shopper", "volunteer"]);
  });

  it("running the same file twice would update, not duplicate", async () => {
    const db = stubDb({
      contacts: [
        { id: "ct_1", email: "marta@example.com", roles: "donor" },
        { id: "ct_2", email: "ray@example.com", roles: "volunteer" },
      ],
    });
    const plan = await previewImport(db, "og_1", csv, opts(HEADERS_CONTACTS, "contacts"));
    expect(plan.creates).toBe(0);
    expect(plan.updates).toBe(2);
  });

  it("refuses the whole file when a required column isn't mapped", async () => {
    const plan = await previewImport(stubDb({}), "og_1", csv, {
      kind: "contacts",
      mapping: { Email: "email" },
    });
    expect(plan.creates).toBe(0);
    expect(plan.skipped[0].reason).toMatch(/Name must be mapped/);
  });
});

const HEADERS_ITEMS = ["SKU", "Item Name", "Sale Price", "Date Added", "Condition"];

describe("previewImport — items", () => {
  it("skips a row whose price can't be read rather than importing it as free", async () => {
    const csv = [
      HEADERS_ITEMS.join(","),
      "T1,Wool coat,call for price,2024-03-01,good",
      "T2,Denim jacket,$18.00,2024-03-02,good",
    ].join("\n");

    const plan = await previewImport(stubDb({}), "og_1", csv, opts(HEADERS_ITEMS, "items"));
    expect(plan.creates).toBe(1);
    expect(plan.skipped[0].reason).toMatch(/could not read the price/i);
  });

  it("derives the colour tag from the intake date", async () => {
    const csv = [HEADERS_ITEMS.join(","), "T1,Wool coat,$20,2024-03-01,good"].join("\n");
    const plan = await previewImport(stubDb({}), "og_1", csv, opts(HEADERS_ITEMS, "items"));
    expect(plan.preview[0].tag_color).toBeTruthy();
    expect(plan.preview[0].intake_date).toBe("2024-03-01");
  });

  it("warns rather than skips when a date is unreadable, and starts today", async () => {
    const csv = [HEADERS_ITEMS.join(","), "T1,Wool coat,$20,last Tuesday,good"].join("\n");
    const plan = await previewImport(stubDb({}), "og_1", csv, opts(HEADERS_ITEMS, "items"));
    expect(plan.creates).toBe(1);
    expect(plan.warnings[0].reason).toMatch(/colour rotation today/);
    expect(plan.preview[0].intake_date).toBe(new Date().toISOString().slice(0, 10));
  });

  it("warns when a condition had to be guessed", async () => {
    const csv = [HEADERS_ITEMS.join(","), "T1,Wool coat,$20,2024-03-01,Tier 3"].join("\n");
    const plan = await previewImport(stubDb({}), "og_1", csv, opts(HEADERS_ITEMS, "items"));
    expect(plan.warnings[0].reason).toMatch(/isn't one we recognise/);
    expect(plan.preview[0].condition).toBe("good");
  });

  it("updates an item that already carries the same tag number", async () => {
    const csv = [HEADERS_ITEMS.join(","), "T1,Wool coat,$20,2024-03-01,good"].join("\n");
    const db = stubDb({ items: [{ id: "it_1", tag_number: "T1" }] });
    const plan = await previewImport(db, "og_1", csv, opts(HEADERS_ITEMS, "items"));
    expect(plan.updates).toBe(1);
    expect(plan.creates).toBe(0);
  });

  it("reads a day-first file when told to", async () => {
    const csv = [HEADERS_ITEMS.join(","), "T1,Wool coat,$20,03/09/2024,good"].join("\n");
    const plan = await previewImport(
      stubDb({}),
      "og_1",
      csv,
      opts(HEADERS_ITEMS, "items", { dayFirst: true })
    );
    expect(plan.preview[0].intake_date).toBe("2024-09-03");
  });

  it("keeps unmapped columns in the notes when asked", async () => {
    const headers = [...HEADERS_ITEMS, "Loyalty Points"];
    const csv = [headers.join(","), "T1,Wool coat,$20,2024-03-01,good,450"].join("\n");
    const plan = await previewImport(stubDb({}), "og_1", csv, {
      kind: "items",
      mapping: guessMapping(HEADERS_ITEMS, "items"),
      unmappedToNotes: true,
    });
    expect(plan.creates).toBe(1);
    // The point of the option: the column we have no field for is preserved
    // verbatim rather than discarded, with its original header for context.
    expect(plan.preview[0].notes).toContain("Loyalty Points: 450");
  });

  it("discards unmapped columns when not asked to keep them", async () => {
    const headers = [...HEADERS_ITEMS, "Loyalty Points"];
    const csv = [headers.join(","), "T1,Wool coat,$20,2024-03-01,good,450"].join("\n");
    const plan = await previewImport(stubDb({}), "og_1", csv, {
      kind: "items",
      mapping: guessMapping(HEADERS_ITEMS, "items"),
    });
    expect(plan.preview[0].notes).toBe("");
  });
});

const HEADERS_DONATIONS = ["Date", "Donor Email", "Donor", "Bags", "Weight"];

describe("previewImport — donations", () => {
  const csv = [
    HEADERS_DONATIONS.join(","),
    "2024-03-01,marta@example.com,Marta Ellison,3,24",
    "not a date,ray@example.com,Ray Whitfield,2,18",
  ].join("\n");

  it("skips a donation with no readable date", async () => {
    const db = stubDb({ contacts: [{ id: "ct_1", email: "marta@example.com", roles: "donor" }] });
    const plan = await previewImport(db, "og_1", csv, opts(HEADERS_DONATIONS, "donations"));
    expect(plan.creates).toBe(1);
    expect(plan.skipped[0].reason).toMatch(/could not read the date/i);
  });

  it("warns when it has to invent a donor rather than doing it silently", async () => {
    const db = stubDb({});
    const plan = await previewImport(db, "og_1", csv, opts(HEADERS_DONATIONS, "donations"));
    expect(plan.warnings.some((w) => /creating one/.test(w.reason))).toBe(true);
  });

  it("skips a donation already recorded, so a second run doesn't double it", async () => {
    const db = stubDb({
      contacts: [{ id: "ct_1", email: "marta@example.com", roles: "donor" }],
      donations: [
        {
          contact_id: "ct_1",
          received_at: "2024-03-01T12:00:00.000Z",
          est_weight_lbs: 24,
          amount_cents: 0,
        },
      ],
    });
    const plan = await previewImport(db, "og_1", csv, opts(HEADERS_DONATIONS, "donations"));
    expect(plan.creates).toBe(0);
    expect(plan.skipped.some((s) => /already recorded/i.test(s.reason))).toBe(true);
  });

  it("does not treat two genuinely different donations as the same", async () => {
    const twice = [
      HEADERS_DONATIONS.join(","),
      "2024-03-01,marta@example.com,Marta Ellison,3,24",
      "2024-03-01,marta@example.com,Marta Ellison,3,31",
    ].join("\n");
    const db = stubDb({ contacts: [{ id: "ct_1", email: "marta@example.com", roles: "donor" }] });
    const plan = await previewImport(db, "og_1", twice, opts(HEADERS_DONATIONS, "donations"));
    expect(plan.creates).toBe(2);
  });
});

describe("the dry run", () => {
  it("writes nothing at all", async () => {
    // The stub throws on any write, so reaching the end is the assertion.
    const csv = [HEADERS_CONTACTS.join(","), "Marta,marta@example.com,555,donor"].join("\n");
    await expect(
      previewImport(stubDb({}), "og_1", csv, opts(HEADERS_CONTACTS, "contacts"))
    ).resolves.toBeTruthy();
  });
});
