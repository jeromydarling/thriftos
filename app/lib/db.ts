/**
 * Thin D1 helpers. Every query in this app is org-scoped — there is no helper
 * here that lets you forget the tenant, and that is deliberate.
 */

export type Row = Record<string, unknown>;

export async function all<T = Row>(
  db: D1Database,
  sql: string,
  ...params: unknown[]
): Promise<T[]> {
  const res = await db
    .prepare(sql)
    .bind(...params)
    .all<T>();
  return res.results ?? [];
}

export async function first<T = Row>(
  db: D1Database,
  sql: string,
  ...params: unknown[]
): Promise<T | null> {
  return (await db
    .prepare(sql)
    .bind(...params)
    .first<T>()) as T | null;
}

export async function run(
  db: D1Database,
  sql: string,
  ...params: unknown[]
): Promise<D1Result> {
  return db
    .prepare(sql)
    .bind(...params)
    .run();
}

/** Batch writes — the per-request subrequest budget is tight, so prefer this. */
export async function batch(db: D1Database, stmts: D1PreparedStatement[]) {
  if (stmts.length === 0) return [];
  return db.batch(stmts);
}

export async function count(
  db: D1Database,
  sql: string,
  ...params: unknown[]
): Promise<number> {
  const row = await first<{ n: number }>(db, sql, ...params);
  return Number(row?.n ?? 0);
}

/**
 * Keyset pagination cursor. We page with `WHERE (sort, id) > (?, ?)` rather
 * than OFFSET so page 900 costs the same as page 1.
 */
export function encodeCursor(sortValue: string, id: string): string {
  return btoa(JSON.stringify([sortValue, id]));
}

export function decodeCursor(cursor: string | null): [string, string] | null {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(atob(cursor));
    if (!Array.isArray(parsed) || parsed.length !== 2) return null;
    return [String(parsed[0]), String(parsed[1])];
  } catch {
    return null;
  }
}

/** The org's stored JSON settings blob, parsed defensively. */
export function parseSettings(json: string | null | undefined): Record<string, unknown> {
  if (!json) return {};
  try {
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
