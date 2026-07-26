import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Do the columns the code writes actually exist?
 *
 * TypeScript cannot see inside a SQL string, so a write to a column that was
 * never created typechecks, builds, deploys, and then throws the first time a
 * volunteer presses the button. That is exactly what happened here: the
 * fulfilment code set `updated_at` on `transactions`, a table which has never
 * had one, and nothing anywhere objected.
 *
 * This reads the schema out of the migrations and the column names out of the
 * UPDATE and INSERT statements, and compares them. It is not a SQL parser and
 * doesn't try to be — it catches the cheap, common mistake of naming a column
 * that isn't there.
 */

function schema(): Map<string, Set<string>> {
  const tables = new Map<string, Set<string>>();
  const files = readdirSync("migrations").filter((f) => f.endsWith(".sql")).sort();

  for (const file of files) {
    const sql = readFileSync(`migrations/${file}`, "utf8").replace(/--[^\n]*/g, "");

    for (const match of sql.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?(\w+)\s*\(([\s\S]*?)\n\s*\);/g)) {
      const [, table, body] = match;
      const cols = new Set<string>();
      for (const line of body.split("\n")) {
        const m = line.trim().match(/^(\w+)\s+(TEXT|INTEGER|REAL|BLOB|NUMERIC)/i);
        if (m) cols.add(m[1]);
      }
      tables.set(table, cols);
    }

    for (const match of sql.matchAll(/ALTER TABLE (\w+) ADD COLUMN (\w+)/g)) {
      const [, table, column] = match;
      if (!tables.has(table)) tables.set(table, new Set());
      tables.get(table)!.add(column);
    }
  }

  return tables;
}

/**
 * Just the SQL.
 *
 * The first version of this scanned whole files and reported that we write to
 * tables called "inside", "isn" and "when" — it was matching English in the
 * comments, which is a good reminder that a check nobody can trust is worse
 * than no check. Comments go first, then only backtick-quoted strings survive.
 */
function sqlIn(source: string): string {
  const withoutComments = source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/[^\n]*$/gm, " ")
    .replace(/([^:])\/\/[^\n]*$/gm, "$1 ");

  return [...withoutComments.matchAll(/`([^`]*)`/g)].map((m) => m[1]).join("\n;\n");
}

function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(path);
      else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".test.ts")) out.push(path);
    }
  };
  walk("app");
  return out;
}

const tables = schema();

describe("the schema knows every column the code writes", () => {
  it("parsed the migrations at all", () => {
    // If this regex ever stops matching, every check below passes vacuously.
    expect(tables.size).toBeGreaterThan(20);
    expect(tables.get("transactions")?.size ?? 0).toBeGreaterThan(20);
    expect(tables.get("items")?.has("photo_enhanced_key")).toBe(true);
  });

  it("has no updated_at on transactions, which is what started this", () => {
    expect(tables.get("transactions")?.has("updated_at")).toBe(false);
  });

  it("names only real columns in every UPDATE", () => {
    const problems: string[] = [];

    for (const file of sourceFiles()) {
      const src = sqlIn(readFileSync(file, "utf8"));

      // Plain updates, and the SET clause of an upsert — which names its table
      // back in the INSERT INTO, not next to the word UPDATE.
      const statements: { table: string; assignments: string }[] = [];

      // Bounded by the `;` this joins template literals with, so a match can't
      // run out of one SQL string and into the next — which is how a SELECT's
      // `AS diversion_lbs` got reported as a column being written.
      for (const m of src.matchAll(/UPDATE\s+(\w+)\s+SET\s+([^;]*?)(?:\bWHERE\b|;)/gi)) {
        if (m[1].toUpperCase() === "SET") continue; // `DO UPDATE SET`, handled below
        statements.push({ table: m[1], assignments: m[2] });
      }

      for (const m of src.matchAll(
        /INSERT(?:\s+OR\s+\w+)?\s+INTO\s+(\w+)[^;]*?ON CONFLICT[^)]*\)\s*DO UPDATE SET\s+([^;]*?)(?:\bWHERE\b|;)/gi
      )) {
        statements.push({ table: m[1], assignments: m[2] });
      }

      for (const { table, assignments } of statements) {
        const columns = tables.get(table);
        if (!columns) continue; // not a table we created (or a typo the next test catches)

        // Left-hand sides only: `foo = ?`, at the start or after a comma.
        for (const assign of assignments.matchAll(/(?:^|,)\s*(\w+)\s*=/g)) {
          const column = assign[1];
          // CASE WHEN ... THEN ... ELSE col END puts bare names on the right too;
          // those aren't assignments and are skipped by the comma anchor above.
          if (!columns.has(column)) problems.push(`${file}: UPDATE ${table} SET ${column}`);
        }
      }
    }

    expect(problems, `columns written that the schema doesn't have:\n${problems.join("\n")}`).toEqual(
      []
    );
  });

  it("names only real columns in every INSERT column list", () => {
    const problems: string[] = [];

    for (const file of sourceFiles()) {
      const src = sqlIn(readFileSync(file, "utf8"));

      for (const match of src.matchAll(/INSERT(?:\s+OR\s+\w+)?\s+INTO\s+(\w+)\s*\(([^)]*)\)/gi)) {
        const [, table, list] = match;
        const columns = tables.get(table);
        if (!columns) continue;

        for (const raw of list.split(",")) {
          const column = raw.trim().replace(/[\s\n]+/g, "");
          if (!column || !/^\w+$/.test(column)) continue;
          if (!columns.has(column)) problems.push(`${file}: INSERT INTO ${table} (${column})`);
        }
      }
    }

    expect(problems, `columns inserted that the schema doesn't have:\n${problems.join("\n")}`).toEqual(
      []
    );
  });

  it("writes only to tables that exist", () => {
    const problems: string[] = [];
    // Names the checker knows are not tables: SQLite internals and CTE aliases.
    const notTables = new Set(["sqlite_master", "sqlite_sequence"]);

    for (const file of sourceFiles()) {
      const src = sqlIn(readFileSync(file, "utf8"));
      for (const match of src.matchAll(/(?:INSERT(?:\s+OR\s+\w+)?\s+INTO|UPDATE)\s+(\w+)/gi)) {
        const table = match[1];
        // `ON CONFLICT (...) DO UPDATE SET` — an upsert, whose table was named
        // by the INSERT that opened the statement.
        if (table.toUpperCase() === "SET") continue;
        if (notTables.has(table) || tables.has(table)) continue;
        // `UPDATE ${table}` — a template hole, not a name. wipeOrgData does this.
        if (/^\$/.test(table)) continue;
        problems.push(`${file}: writes to unknown table "${table}"`);
      }
    }

    expect(problems, problems.join("\n")).toEqual([]);
  });
});
