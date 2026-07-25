/**
 * The CRM spine. One gentle contacts table, roles that stack.
 *
 * The rule that makes this work: every inbound event finds-or-creates the
 * contact and merges the role. Nobody hand-enters a person the system already
 * saw — a donor who later volunteers is the same row, now carrying both roles.
 */
import { all, decodeCursor, encodeCursor, first, run } from "./db";
import { newId } from "./ids";

export const ROLES = ["donor", "shopper", "volunteer", "worker", "referrer", "partner"] as const;
export type ContactRole = (typeof ROLES)[number];

export interface Contact {
  id: string;
  org_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  roles: string;
  notes: string | null;
  is_subscribed: number;
  first_seen_at: string;
  last_seen_at: string;
}

export function parseRoles(roles: string | null | undefined): ContactRole[] {
  if (!roles) return [];
  return roles
    .split(",")
    .map((r) => r.trim().toLowerCase())
    .filter((r): r is ContactRole => (ROLES as readonly string[]).includes(r));
}

/** Union of existing and added roles, stable order, no duplicates. */
export function mergeRoles(existing: string | null | undefined, add: ContactRole[]): string {
  const set = new Set<ContactRole>([...parseRoles(existing), ...add]);
  return ROLES.filter((r) => set.has(r)).join(",");
}

export function roleLabel(role: string): string {
  const labels: Record<string, string> = {
    donor: "Donor",
    shopper: "Shopper",
    volunteer: "Volunteer",
    worker: "Worker",
    referrer: "Referrer",
    partner: "Partner",
  };
  return labels[role] ?? role;
}

/**
 * Find by email (the only reliable key we get), else create. Always merges the
 * role and touches last_seen_at, so a contact's record keeps up with reality
 * without anyone maintaining it.
 */
export async function findOrCreateContact(
  db: D1Database,
  input: {
    orgId: string;
    name?: string | null;
    email?: string | null;
    phone?: string | null;
    roles: ContactRole[];
  }
): Promise<string> {
  const email = input.email?.trim().toLowerCase() || null;
  const name = input.name?.trim() || null;

  if (email) {
    const existing = await first<{ id: string; roles: string; name: string }>(
      db,
      `SELECT id, roles, name FROM contacts WHERE org_id = ? AND email = ? LIMIT 1`,
      input.orgId,
      email
    );
    if (existing) {
      await run(
        db,
        `UPDATE contacts
            SET roles = ?, last_seen_at = datetime('now'), updated_at = datetime('now'),
                name = COALESCE(NULLIF(?, ''), name),
                phone = COALESCE(?, phone)
          WHERE id = ?`,
        mergeRoles(existing.roles, input.roles),
        name ?? "",
        input.phone?.trim() || null,
        existing.id
      );
      return existing.id;
    }
  }

  const id = newId("contact");
  await run(
    db,
    `INSERT INTO contacts (id, org_id, name, email, phone, roles)
     VALUES (?, ?, ?, ?, ?, ?)`,
    id,
    input.orgId,
    name || "Friend of the shop",
    email,
    input.phone?.trim() || null,
    mergeRoles(null, input.roles)
  );
  return id;
}

export interface ContactPage {
  contacts: Contact[];
  nextCursor: string | null;
}

/**
 * Keyset pagination — `WHERE (name, id) > (?, ?)`, never OFFSET. Page 900
 * costs what page 1 costs, which matters once a shop has 40,000 contacts.
 */
export async function listContacts(
  db: D1Database,
  orgId: string,
  opts: { cursor?: string | null; limit?: number; role?: string | null; search?: string | null } = {}
): Promise<ContactPage> {
  const limit = Math.min(100, Math.max(1, opts.limit ?? 50));
  const after = decodeCursor(opts.cursor ?? null);

  const where: string[] = ["org_id = ?"];
  const params: unknown[] = [orgId];

  if (after) {
    where.push("(name > ? OR (name = ? AND id > ?))");
    params.push(after[0], after[0], after[1]);
  }
  if (opts.role) {
    where.push("(',' || roles || ',') LIKE ?");
    params.push(`%,${opts.role},%`);
  }
  if (opts.search) {
    where.push("(name LIKE ? OR email LIKE ?)");
    params.push(`%${opts.search}%`, `%${opts.search}%`);
  }

  const rows = await all<Contact>(
    db,
    `SELECT id, org_id, name, email, phone, roles, notes, is_subscribed, first_seen_at, last_seen_at
       FROM contacts
      WHERE ${where.join(" AND ")}
      ORDER BY name, id
      LIMIT ?`,
    ...params,
    limit + 1
  );

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];

  return {
    contacts: page,
    nextCursor: hasMore && last ? encodeCursor(last.name, last.id) : null,
  };
}
