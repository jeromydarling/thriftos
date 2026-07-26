/**
 * The demo shop. This is the best sales tool the product has, so it must never
 * be empty and never be broken.
 *
 * It seeds a plausible small-town shop with enough history that NRI has real
 * patterns to notice — a donor who's gone quiet, a volunteer who's drifted off
 * the schedule, aging stock, and a diversion milestone worth celebrating. A
 * demo where the Compass is empty teaches the visitor nothing.
 */
import { batch, first, run } from "./db";
import { newId } from "./ids";
import { DEFAULT_MARKDOWN_RULES, tagColorForIntake } from "./markdown";
import { hashPassword } from "./auth";
import { DEFAULT_SETTINGS, serialiseOrgSettings } from "./settings";

// Not "demo": that's the auto-login route, and a shop page now lives at
// /{slug}. A shop whose slug matched a route would be unreachable, and the
// redirect from its old address would have signed visitors in by accident.
export const DEMO_SLUG = "second-chances";
export const DEMO_EMAIL = "demo@thriftos.app";
export const DEMO_PASSWORD = "demo-shop-1234";

const DAY = 86_400_000;
const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * DAY).toISOString();
const day = (daysAgo: number) => iso(daysAgo).slice(0, 10);

/** Deterministic pseudo-random so the demo looks the same each reset. */
function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

const CATEGORIES = [
  { name: "Outerwear", items: ["Wool peacoat", "Denim jacket", "Rain shell", "Puffer vest"], low: 800, high: 2400, retail: 9000, lbs: 2.4 },
  { name: "Tops", items: ["Flannel shirt", "Cotton blouse", "Band t-shirt", "Cable knit sweater"], low: 300, high: 900, retail: 3200, lbs: 0.6 },
  { name: "Housewares", items: ["Pyrex casserole dish", "Cast iron skillet", "Ceramic mug set", "Table lamp"], low: 400, high: 1800, retail: 4500, lbs: 3.1 },
  { name: "Books", items: ["Paperback novel", "Cookbook", "Field guide", "Children's picture book"], low: 100, high: 400, retail: 1600, lbs: 0.8 },
  { name: "Furniture", items: ["Oak side table", "Reading chair", "Bookshelf", "Dining chair"], low: 2500, high: 8500, retail: 24000, lbs: 22 },
  { name: "Toys & Games", items: ["Wooden puzzle", "Board game", "Building blocks", "Stuffed bear"], low: 200, high: 700, retail: 2400, lbs: 1.2 },
];

const COLORS = ["navy", "cream", "forest green", "rust", "charcoal", "burgundy", "mustard"];
const CONDITIONS = ["excellent", "good", "good", "good", "fair"];

const PEOPLE = [
  "Marta Ellison", "Ray Whitfield", "Dolores Nkemi", "Sam Oyelaran", "Judith Barr",
  "Tomas Reyes", "Priya Raghavan", "Eleanor Voss", "Curtis Mbeki", "Hannah Lindqvist",
  "Ana Beltrán", "Desmond Achebe", "Ruth Kimura", "Ollie Fenwick", "Grace Adeyemi",
  "Nadia Haddad", "Walter Brzezinski", "Sofia Marchetti", "Ben Okoro", "Ingrid Sørensen",
];

export interface SeedResult {
  orgId: string;
  items: number;
  contacts: number;
  donations: number;
  transactions: number;
  shifts: number;
}

/** Wipe every org-scoped table for this org. Listed in one place on purpose:
 *  when a migration adds an org-scoped table, it must be added here too. */
export const ORG_SCOPED_TABLES = [
  "nri_reflections",
  "nri_signals",
  "nri_ai_log",
  "transaction_items",
  "transactions",
  "patronage_ledger",
  "shifts",
  "impact_metrics",
  "donation_receipts",
  "items",
  "donations",
  "markdown_rules",
  "federation_offers",
  "federation_links",
  "email_log",
  "email_suppressions",
  "audit_log",
  "contacts",
  "locations",
  "invites",
] as const;

export async function wipeOrgData(db: D1Database, orgId: string): Promise<void> {
  for (const table of ORG_SCOPED_TABLES) {
    await run(db, `DELETE FROM ${table} WHERE org_id = ?`, orgId);
  }
}

/** Create-or-reset the demo shop. Idempotent — safe on every cron tick. */
export async function seedDemoOrg(db: D1Database): Promise<SeedResult> {
  const existing = await first<{ id: string }>(
    db,
    `SELECT id FROM orgs WHERE slug = ?`,
    DEMO_SLUG
  );

  let orgId: string;

  if (existing) {
    orgId = existing.id;
    await wipeOrgData(db, orgId);
    await run(db, `DELETE FROM users WHERE org_id = ? AND email <> ?`, orgId, DEMO_EMAIL);
  } else {
    orgId = newId("org");
    await run(
      db,
      `INSERT INTO orgs (id, slug, name, legal_name, ein, street, city, state, postal_code,
                         phone, email, is_nonprofit, plan, is_demo, brand_primary, brand_accent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'core', 1, '#2F6F5E', '#E4A33C')`,
      orgId,
      DEMO_SLUG,
      "Second Chances Thrift",
      "Second Chances Community Thrift, Inc.",
      "00-0000000",
      "418 Mill Street",
      "Rockbridge",
      "OH",
      "43149",
      "(740) 555-0142",
      "hello@secondchances.example"
    );
  }

  // The demo shop's own website details.
  //
  // Written every reset, not only on creation, because the demo is the first
  // thing most visitors see and a shop page with no hours and no donation list
  // renders almost nothing — the live blocks correctly show nothing rather
  // than an empty heading, which is right behaviour and a poor showcase.
  await run(
    db,
    `UPDATE orgs SET settings_json = ?, updated_at = datetime('now') WHERE id = ?`,
    serialiseOrgSettings({
      ...DEFAULT_SETTINGS,
      taxRateBps: 700,
      roundUpCause: "our winter coat drive",
      openingHours: [
        "Tuesday to Friday, 10 – 5",
        "Saturday, 10 – 4",
        "Sunday, 12 – 4",
        "Closed Mondays and bank holidays",
      ].join("\n"),
      donationHours: [
        "Tuesday to Friday, until 4",
        "Saturday mornings",
        "Please don't leave bags outside — they get rained on",
      ].join("\n"),
      accepted: [
        "Clean clothing, shoes and bags",
        "Books, records and DVDs",
        "Kitchenware and small homeware",
        "Toys with all their pieces",
        "Working small electricals",
      ].join("\n"),
      notAccepted: [
        "Mattresses and divan bases",
        "Large appliances",
        "Anything damp, damaged or broken",
        "Car seats and cot mattresses",
        "Paint, chemicals and gas bottles",
      ].join("\n"),
    }),
    orgId
  );

  // Demo login, always present and always the same password.
  const demoUser = await first<{ id: string }>(
    db,
    `SELECT id FROM users WHERE org_id = ? AND email = ?`,
    orgId,
    DEMO_EMAIL
  );
  const { hash, salt } = await hashPassword(DEMO_PASSWORD);
  if (demoUser) {
    await run(
      db,
      `UPDATE users SET password_hash = ?, password_salt = ?, role = 'owner', status = 'active' WHERE id = ?`,
      hash,
      salt,
      demoUser.id
    );
  } else {
    await run(
      db,
      `INSERT INTO users (id, org_id, email, name, password_hash, password_salt, role)
       VALUES (?, ?, ?, ?, ?, ?, 'owner')`,
      newId("user"),
      orgId,
      DEMO_EMAIL,
      "Demo Manager",
      hash,
      salt
    );
  }

  const rand = seeded(20260725);
  const stmts: D1PreparedStatement[] = [];

  // Locations
  const floorId = newId("location");
  const backId = newId("location");
  stmts.push(
    db.prepare(`INSERT INTO locations (id, org_id, name, kind, is_default) VALUES (?, ?, 'Sales floor', 'salesfloor', 1)`).bind(floorId, orgId),
    db.prepare(`INSERT INTO locations (id, org_id, name, kind, is_default) VALUES (?, ?, 'Back room', 'backroom', 0)`).bind(backId, orgId)
  );

  // Markdown rules — the store's own rotation.
  for (const rule of DEFAULT_MARKDOWN_RULES) {
    stmts.push(
      db
        .prepare(
          `INSERT INTO markdown_rules (id, org_id, tag_color, week_index, discount_pct, age_days)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .bind(newId("markdownRule"), orgId, rule.tagColor, rule.weekIndex, rule.discountPct, rule.ageDays)
    );
  }

  // People. Roles stack, exactly as they do in a real shop.
  const contactIds: string[] = [];
  PEOPLE.forEach((name, i) => {
    const id = newId("contact");
    contactIds.push(id);
    const roles: string[] = ["donor"];
    if (i % 3 === 0) roles.push("volunteer");
    if (i % 4 === 1) roles.push("shopper");
    if (i === 2 || i === 7) roles.push("worker");

    const slug = name.toLowerCase().replace(/[^a-z]+/g, ".").replace(/^\.|\.$/g, "");
    stmts.push(
      db
        .prepare(
          `INSERT INTO contacts (id, org_id, name, email, phone, roles, first_seen_at, last_seen_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          id,
          orgId,
          name,
          `${slug}@example.com`,
          `(740) 555-0${String(100 + i).slice(-3)}`,
          roles.join(","),
          iso(300 - i * 4),
          iso(Math.floor(rand() * 40)),
          // A few updated recently, so the multi-role rule has something to notice.
          i % 5 === 0 ? iso(Math.floor(rand() * 20)) : iso(120)
        )
    );
  });

  // Donations spread over the last year, so donor rhythms are real.
  const donationIds: string[] = [];
  let donationCount = 0;
  contactIds.forEach((contactId, i) => {
    // A steady core, a quiet one, and a returner.
    const visits = i === 0 ? 8 : i === 1 ? 6 : i < 8 ? 4 : 2;
    for (let v = 0; v < visits; v++) {
      let daysAgo: number;
      if (i === 3) {
        // Marta-style: regular for months, then quiet for a while.
        daysAgo = 120 + v * 28;
      } else if (i === 5) {
        // Came back last week after a long absence.
        daysAgo = v === 0 ? 4 : 200 + v * 25;
      } else {
        daysAgo = Math.floor(10 + v * 30 + rand() * 12);
      }

      const id = newId("donation");
      donationIds.push(id);
      donationCount++;
      const weight = 6 + Math.floor(rand() * 30);
      stmts.push(
        db
          .prepare(
            `INSERT INTO donations (id, org_id, contact_id, kind, received_at, item_count, est_weight_lbs, description)
             VALUES (?, ?, ?, 'goods', ?, ?, ?, ?)`
          )
          .bind(
            id,
            orgId,
            contactId,
            iso(daysAgo),
            2 + Math.floor(rand() * 8),
            weight,
            `${2 + Math.floor(rand() * 8)} bags and boxes of household goods and clothing`
          )
      );

      // Most, but not all, get a receipt — so the "receipts pending" rule has work.
      if (v > 0 || i % 4 !== 0) {
        stmts.push(
          db
            .prepare(
              `INSERT INTO donation_receipts
                 (id, org_id, donation_id, contact_id, receipt_number, issued_at, description, goods_services_statement)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
            )
            .bind(
              newId("receipt"),
              orgId,
              id,
              contactId,
              `SC-${String(donationCount).padStart(5, "0")}`,
              iso(Math.max(0, daysAgo - 1)),
              "Donated household goods and clothing",
              "No goods or services were provided in exchange for this contribution."
            )
        );
      }
    }
  });

  // Inventory across the full age range, so markdown colors span the rotation.
  const itemIds: { id: string; priceCents: number; retail: number; intake: string; sold: boolean }[] = [];
  for (let i = 0; i < 260; i++) {
    const cat = CATEGORIES[Math.floor(rand() * CATEGORIES.length)];
    const name = cat.items[Math.floor(rand() * cat.items.length)];
    const color = COLORS[Math.floor(rand() * COLORS.length)];
    const condition = CONDITIONS[Math.floor(rand() * CONDITIONS.length)];
    const price = cat.low + Math.floor(rand() * (cat.high - cat.low));
    const ageDays = Math.floor(rand() * 84);
    const intake = day(ageDays);
    const id = newId("item");

    // Older stock is likelier to have sold; some deliberately lingers.
    const sold = rand() < (ageDays > 56 ? 0.25 : 0.42);
    const priced = i % 17 !== 0; // a handful genuinely unpriced

    itemIds.push({ id, priceCents: price, retail: cat.retail, intake, sold });

    stmts.push(
      db
        .prepare(
          `INSERT INTO items (id, org_id, location_id, donation_id, tag_number, title, description,
                              category, brand, color, size, condition, price_cents, original_price_cents,
                              retail_estimate_cents, weight_lbs, tag_color, intake_date, status,
                              sold_at, sold_price_cents, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          id,
          orgId,
          rand() < 0.85 ? floorId : backId,
          donationIds[Math.floor(rand() * donationIds.length)] ?? null,
          `T${String(1000 + i)}`,
          `${color.charAt(0).toUpperCase() + color.slice(1)} ${name.toLowerCase()}`,
          `A ${condition} ${name.toLowerCase()} in ${color}. Please look it over — every item here is one of a kind.`,
          cat.name,
          null,
          color,
          cat.name === "Tops" || cat.name === "Outerwear" ? ["S", "M", "L", "XL"][Math.floor(rand() * 4)] : null,
          condition,
          priced ? price : 0,
          priced ? price : 0,
          cat.retail,
          cat.lbs,
          tagColorForIntake(intake),
          intake,
          sold ? "sold" : "available",
          sold ? iso(Math.floor(rand() * ageDays)) : null,
          sold ? price : null,
          iso(ageDays)
        )
    );
  }

  // Sales, so the register has history and value-delivered has something to add up.
  let txCount = 0;
  const soldItems = itemIds.filter((it) => it.sold);
  for (let i = 0; i < soldItems.length; i += 2) {
    const lines = soldItems.slice(i, i + 2);
    if (lines.length === 0) continue;
    const txId = newId("transaction");
    const subtotal = lines.reduce((s, l) => s + l.priceCents, 0);
    const roundup = rand() < 0.35 ? 100 - (subtotal % 100 || 100) : 0;
    const createdAt = lines[0].sold ? iso(Math.floor(rand() * 30)) : iso(5);
    txCount++;

    stmts.push(
      db
        .prepare(
          `INSERT INTO transactions (id, org_id, location_id, subtotal_cents, tax_cents,
                                     roundup_cents, total_cents, tender, created_at)
           VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?)`
        )
        .bind(txId, orgId, floorId, subtotal, roundup, subtotal + roundup, rand() < 0.6 ? "cash" : "card", createdAt)
    );

    for (const line of lines) {
      stmts.push(
        db
          .prepare(
            `INSERT INTO transaction_items (id, org_id, transaction_id, item_id, title, price_cents, retail_estimate_cents, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .bind(newId("txItem"), orgId, txId, line.id, "Item", line.priceCents, line.retail, createdAt)
      );
    }
  }

  // Volunteer shifts. One steady crew, and one person who has drifted away.
  let shiftCount = 0;
  contactIds.forEach((contactId, i) => {
    if (i % 3 !== 0) return;
    const drifted = i === 6; // hasn't been on the schedule in a while
    const count = drifted ? 5 : 8;
    for (let s = 0; s < count; s++) {
      const daysAgo = drifted ? 45 + s * 7 : s * 7 + 2;
      const start = new Date(Date.now() - daysAgo * DAY);
      start.setUTCHours(14, 0, 0, 0);
      const end = new Date(start.getTime() + 4 * 3600_000);
      shiftCount++;
      stmts.push(
        db
          .prepare(
            `INSERT INTO shifts (id, org_id, location_id, contact_id, role_label, starts_at, ends_at, status, hours_logged)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'completed', 4)`
          )
          .bind(
            newId("shift"),
            orgId,
            floorId,
            contactId,
            ["floor", "sorting", "register"][s % 3],
            start.toISOString(),
            end.toISOString()
          )
      );
    }

    // A couple of upcoming shifts for the steady crew.
    if (!drifted) {
      const start = new Date(Date.now() + (2 + i) * DAY);
      start.setUTCHours(14, 0, 0, 0);
      shiftCount++;
      stmts.push(
        db
          .prepare(
            `INSERT INTO shifts (id, org_id, location_id, contact_id, role_label, starts_at, ends_at, status, hours_logged)
             VALUES (?, ?, ?, ?, 'floor', ?, ?, 'scheduled', 0)`
          )
          .bind(
            newId("shift"),
            orgId,
            floorId,
            contactId,
            start.toISOString(),
            new Date(start.getTime() + 4 * 3600_000).toISOString()
          )
      );
    }
  });

  // A few written notes, so NRI has narrative to work with — and so the
  // "notes are thinning" rule has a baseline to compare against.
  const NOTES = [
    "A woman came in looking for work clothes for an interview on Thursday. We found her a blazer that fit and she nearly cried. Waived the price.",
    "Ray brought his late wife's book collection today. He wanted to talk about her for a while before he left. We let the sorting wait.",
    "The Tuesday crew cleared the whole back room. Six weeks of backlog, gone in one afternoon.",
    "Regular customer mentioned she furnished her daughter's first apartment entirely from here. Four rooms.",
    "Had to turn away a truck of water-damaged mattresses. Hard conversation, but the right call.",
    "Kids' section was picked clean by noon. School starts in two weeks — we should have seen that coming.",
    "Someone donated a wedding dress, still in the bag. No note. It sold within the day.",
  ];
  NOTES.forEach((body, i) => {
    stmts.push(
      db
        .prepare(
          `INSERT INTO nri_reflections (id, org_id, subject_type, body, is_private, created_at)
           VALUES (?, ?, 'org', ?, 1, ?)`
        )
        .bind(newId("reflection"), orgId, body, iso(35 + i * 4))
    );
  });

  // Batch in chunks — the per-request subrequest budget is not generous.
  for (let i = 0; i < stmts.length; i += 40) {
    await batch(db, stmts.slice(i, i + 40));
  }

  return {
    orgId,
    items: 260,
    contacts: PEOPLE.length,
    donations: donationCount,
    transactions: txCount,
    shifts: shiftCount,
  };
}

/** Self-heal: if the demo is ever found empty, rebuild it before anyone notices. */
export async function ensureDemoSeeded(db: D1Database): Promise<string | null> {
  const org = await first<{ id: string }>(db, `SELECT id FROM orgs WHERE slug = ?`, DEMO_SLUG);
  if (!org) {
    const result = await seedDemoOrg(db);
    return result.orgId;
  }
  const items = await first<{ n: number }>(
    db,
    `SELECT COUNT(*) AS n FROM items WHERE org_id = ?`,
    org.id
  );
  if (Number(items?.n ?? 0) === 0) {
    await seedDemoOrg(db);
  }
  return org.id;
}
