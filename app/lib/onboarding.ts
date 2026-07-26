/**
 * Onboarding — getting a shop from empty to genuinely useful.
 *
 * The problem this solves: a new shop logs in and sees zeroes. Zeroes teach
 * nobody anything, and a shop that can't tell whether the software is any good
 * stops opening it. There are three honest ways out, and a shop picks one:
 *
 *   • migrating  — import real records from the old system. Instantly real.
 *   • new        — a short checklist that reaches real data in about 20 minutes.
 *   • exploring  — clearly-labelled sample data, removable in one click.
 *
 * What we don't do is quietly seed a real shop with invented records and let
 * them turn up in a board report six months later.
 */
import { all, first, run } from "./db";
import { newId } from "./ids";

export type OnboardingPath = "new" | "migrating" | "exploring";

export interface OnboardingStep {
  id: string;
  title: string;
  detail: string;
  /** Where the work happens. */
  href: string;
  cta: string;
  /** Steps we can verify from the data rather than trusting a checkbox. */
  autoDetected: boolean;
  /** Paths this step appears on. */
  paths: OnboardingPath[];
}

/**
 * The checklist. Ordered so the shop is trading as early as possible — details
 * that can wait, wait.
 */
export const ONBOARDING_STEPS: readonly OnboardingStep[] = [
  {
    id: "shop_details",
    title: "Confirm your shop's details",
    detail:
      "Name and address, plus your legal name and EIN if you'll issue donation receipts. Receipts sent without an EIN have to be reissued, so this is worth two minutes now.",
    href: "/app/settings",
    cta: "Open settings",
    autoDetected: true,
    paths: ["new", "migrating", "exploring"],
  },
  {
    id: "import_data",
    title: "Bring your records across",
    detail:
      "Import people, donation history, and current stock from a CSV. People first, then donations, then items — that order lets everything attach to the right records.",
    href: "/app/import",
    cta: "Start importing",
    autoDetected: true,
    paths: ["migrating"],
  },
  {
    id: "markdown_rules",
    title: "Set your colour-tag rotation",
    detail:
      "We've shipped a sensible six-colour ladder. If your shop already runs a rotation, match it here — staff muscle memory beats our defaults.",
    href: "/app/settings",
    cta: "Review the rotation",
    autoDetected: false,
    paths: ["new", "migrating"],
  },
  {
    id: "first_items",
    title: "Log twenty items",
    detail:
      "Twenty is where the app starts telling you something. Photograph each one and correct what the guess got wrong — it's faster than typing, and it's a job for someone's first shift.",
    href: "/app/intake",
    cta: "Log an item",
    autoDetected: true,
    paths: ["new"],
  },
  {
    id: "first_sale",
    title: "Ring up a sale",
    detail:
      "Cash is fine. This is the moment the dashboard stops being theoretical — and it's worth doing before a customer is standing there.",
    href: "/app/register",
    cta: "Open the register",
    autoDetected: true,
    paths: ["new", "migrating"],
  },
  {
    id: "first_donation",
    title: "Record a donation and issue a receipt",
    detail:
      "Log what came in with a donor's name, then issue the acknowledgement. The required language is already in place — you just press the button.",
    href: "/app/donations",
    cta: "Record a donation",
    autoDetected: true,
    paths: ["new", "migrating"],
  },
  {
    id: "invite_team",
    title: "Invite whoever else works here",
    detail:
      "Individual logins are free and unlimited. Sharing one password makes the audit trail useless and means removing one person locks everyone out.",
    href: "/app/settings",
    cta: "Invite someone",
    autoDetected: true,
    paths: ["new", "migrating"],
  },
  {
    id: "payments",
    title: "Switch on card payments",
    detail:
      "About twenty minutes, and you'll need bank details and a responsible person's ID. Leave it until the shop is quiet — cash works with no setup at all.",
    href: "/app/settings#payments",
    cta: "Set up payments",
    autoDetected: true,
    paths: ["new", "migrating"],
  },
] as const;

export interface OnboardingState {
  path: OnboardingPath | null;
  /** Step id → done. */
  done: Record<string, boolean>;
  dismissed: boolean;
  completed: boolean;
}

export interface OnboardingView extends OnboardingState {
  steps: (OnboardingStep & { done: boolean })[];
  completedCount: number;
  totalCount: number;
  nextStep: (OnboardingStep & { done: boolean }) | null;
  hasSampleData: boolean;
}

function parseSteps(json: string | null | undefined): Record<string, boolean> {
  if (!json) return {};
  try {
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Work out where a shop is.
 *
 * Most steps are detected from the data rather than a stored checkbox, so the
 * checklist can't claim someone hasn't logged items when the shop is full of
 * them. Manual ticks are only used where there's nothing observable — reviewing
 * the markdown rotation leaves no trace, so we have to take their word for it.
 */
export async function getOnboardingState(
  db: D1Database,
  orgId: string
): Promise<OnboardingView> {
  const [row, counts, sampleBatch] = await Promise.all([
    first<{
      path: string | null;
      steps_json: string;
      dismissed_at: string | null;
      completed_at: string | null;
    }>(
      db,
      `SELECT path, steps_json, dismissed_at, completed_at
         FROM onboarding_progress WHERE org_id = ?`,
      orgId
    ),
    first<{
      items: number;
      sales: number;
      donations: number;
      receipts: number;
      users: number;
      has_ein: number;
      imports: number;
      payments: number;
    }>(
      db,
      `SELECT
         -- Sample data doesn't count as progress; imported data does, because
         -- it's real. That distinction is the whole point of is_sample.
         (SELECT COUNT(*) FROM items WHERE org_id = ?1 AND is_sample = 0) AS items,
         (SELECT COUNT(*) FROM transactions WHERE org_id = ?1 AND is_sample = 0) AS sales,
         (SELECT COUNT(*) FROM donations WHERE org_id = ?1 AND is_sample = 0) AS donations,
         (SELECT COUNT(*) FROM donation_receipts r
            JOIN donations d ON d.id = r.donation_id
           WHERE r.org_id = ?1 AND d.is_sample = 0) AS receipts,
         (SELECT COUNT(*) FROM users WHERE org_id = ?1) AS users,
         (SELECT COUNT(*) FROM orgs
           WHERE id = ?1 AND ein IS NOT NULL AND ein <> '' AND ein <> '00-0000000') AS has_ein,
         (SELECT COUNT(*) FROM import_batches
           WHERE org_id = ?1 AND kind <> 'sample' AND status = 'complete') AS imports,
         (SELECT COUNT(*) FROM stripe_accounts
           WHERE org_id = ?1 AND status = 'enabled') AS payments`,
      orgId
    ),
    first<{ n: number }>(
      db,
      `SELECT COUNT(*) AS n FROM import_batches
        WHERE org_id = ? AND kind = 'sample' AND status = 'complete'`,
      orgId
    ),
  ]);

  const manual = parseSteps(row?.steps_json);
  const path = (row?.path as OnboardingPath | null) ?? null;

  // Detected from data where we can, manual only where we can't.
  const detected: Record<string, boolean> = {
    shop_details: Number(counts?.has_ein ?? 0) > 0,
    import_data: Number(counts?.imports ?? 0) > 0,
    first_items: Number(counts?.items ?? 0) >= 20,
    first_sale: Number(counts?.sales ?? 0) > 0,
    first_donation: Number(counts?.receipts ?? 0) > 0,
    invite_team: Number(counts?.users ?? 0) > 1,
    payments: Number(counts?.payments ?? 0) > 0,
  };

  const relevant = ONBOARDING_STEPS.filter(
    (step) => !path || step.paths.includes(path)
  );

  const steps = relevant.map((step) => ({
    ...step,
    done: step.autoDetected ? (detected[step.id] ?? false) : Boolean(manual[step.id]),
  }));

  const completedCount = steps.filter((s) => s.done).length;

  return {
    path,
    done: Object.fromEntries(steps.map((s) => [s.id, s.done])),
    dismissed: Boolean(row?.dismissed_at),
    completed: completedCount === steps.length && steps.length > 0,
    steps,
    completedCount,
    totalCount: steps.length,
    nextStep: steps.find((s) => !s.done) ?? null,
    hasSampleData: Number(sampleBatch?.n ?? 0) > 0,
  };
}

export async function setOnboardingPath(
  db: D1Database,
  orgId: string,
  path: OnboardingPath
): Promise<void> {
  await run(
    db,
    `INSERT INTO onboarding_progress (org_id, path)
     VALUES (?, ?)
     ON CONFLICT (org_id) DO UPDATE SET path = excluded.path, updated_at = datetime('now')`,
    orgId,
    path
  );
}

/** Tick a step we can't observe. */
export async function markStepDone(
  db: D1Database,
  orgId: string,
  stepId: string
): Promise<void> {
  const row = await first<{ steps_json: string }>(
    db,
    `SELECT steps_json FROM onboarding_progress WHERE org_id = ?`,
    orgId
  );
  const steps = parseSteps(row?.steps_json);
  steps[stepId] = true;

  await run(
    db,
    `INSERT INTO onboarding_progress (org_id, steps_json)
     VALUES (?, ?)
     ON CONFLICT (org_id) DO UPDATE SET steps_json = excluded.steps_json, updated_at = datetime('now')`,
    orgId,
    JSON.stringify(steps)
  );
}

export async function dismissOnboarding(db: D1Database, orgId: string): Promise<void> {
  await run(
    db,
    `INSERT INTO onboarding_progress (org_id, dismissed_at)
     VALUES (?, datetime('now'))
     ON CONFLICT (org_id) DO UPDATE SET dismissed_at = datetime('now'), updated_at = datetime('now')`,
    orgId
  );
}

/* ─── Reversible batches ────────────────────────────────────────────────── */

/**
 * Rows that hang off a batch row but don't carry the batch id themselves.
 * Deleted first, by walking down from their parent.
 *
 * These have ON DELETE CASCADE declared, but SQLite only honours that when
 * foreign keys are enforced, and a reversal that silently leaves orphaned
 * receipts behind is exactly the kind of thing nobody notices until an
 * auditor does. Deleting them explicitly costs one statement each.
 */
const BATCH_CHILDREN = [
  { table: "transaction_items", fk: "transaction_id", parent: "transactions" },
  { table: "donation_receipts", fk: "donation_id", parent: "donations" },
] as const;

/**
 * Tables a batch can create rows in, in dependency order for safe removal.
 * Items before donations, because items point at donations. Contacts last,
 * because nearly everything points at them.
 */
const BATCH_TABLES = [
  "transactions",
  "items",
  "donations",
  "shifts",
  "contacts",
] as const;

export async function createBatch(
  db: D1Database,
  orgId: string,
  kind: string,
  source: string,
  userId?: string | null
): Promise<string> {
  const id = newId("batch");
  await run(
    db,
    `INSERT INTO import_batches (id, org_id, kind, source, status, created_by)
     VALUES (?, ?, ?, ?, 'complete', ?)`,
    id,
    orgId,
    kind,
    source,
    userId ?? null
  );
  return id;
}

export async function finishBatch(
  db: D1Database,
  batchId: string,
  stats: { created: number; updated: number; skipped: number; notes?: unknown }
): Promise<void> {
  await run(
    db,
    `UPDATE import_batches
        SET rows_created = ?, rows_updated = ?, rows_skipped = ?, notes_json = ?
      WHERE id = ?`,
    stats.created,
    stats.updated,
    stats.skipped,
    JSON.stringify(stats.notes ?? {}),
    batchId
  );
}

/**
 * Remove everything a batch created — and nothing else.
 *
 * Scoped by both org and batch id, so a shop's own hand-entered records are
 * untouchable by an undo. Rows the batch *updated* rather than created keep
 * their updates; reversing an update isn't something we can do honestly, and
 * pretending otherwise would be worse than saying so.
 */
export async function reverseBatch(
  db: D1Database,
  orgId: string,
  batchId: string
): Promise<Record<string, number>> {
  const removed: Record<string, number> = {};

  for (const child of BATCH_CHILDREN) {
    const res = await run(
      db,
      `DELETE FROM ${child.table}
        WHERE org_id = ?
          AND ${child.fk} IN (
            SELECT id FROM ${child.parent} WHERE org_id = ? AND import_batch_id = ?
          )`,
      orgId,
      orgId,
      batchId
    );
    removed[child.table] = res.meta?.changes ?? 0;
  }

  for (const table of BATCH_TABLES) {
    const res = await run(
      db,
      `DELETE FROM ${table} WHERE org_id = ? AND import_batch_id = ?`,
      orgId,
      batchId
    );
    removed[table] = res.meta?.changes ?? 0;
  }

  // Signals derived from records that no longer exist would point at nothing,
  // and the Compass would ask someone to check in on a person who was never
  // real. Clear anything whose subject has gone.
  await run(
    db,
    `DELETE FROM nri_signals
      WHERE org_id = ?
        AND subject_type = 'contact'
        AND subject_id IS NOT NULL
        AND subject_id NOT IN (SELECT id FROM contacts WHERE org_id = ?)`,
    orgId,
    orgId
  );

  await run(
    db,
    `UPDATE import_batches SET status = 'reversed', reversed_at = datetime('now')
      WHERE id = ? AND org_id = ?`,
    batchId,
    orgId
  );

  return removed;
}

export async function listBatches(db: D1Database, orgId: string) {
  return all<{
    id: string;
    kind: string;
    source: string | null;
    status: string;
    rows_created: number;
    rows_updated: number;
    rows_skipped: number;
    created_at: string;
  }>(
    db,
    `SELECT id, kind, source, status, rows_created, rows_updated, rows_skipped, created_at
       FROM import_batches WHERE org_id = ? ORDER BY created_at DESC LIMIT 25`,
    orgId
  );
}

/** The live sample batch, if the shop has one loaded. */
export async function sampleBatchId(db: D1Database, orgId: string): Promise<string | null> {
  const row = await first<{ id: string }>(
    db,
    `SELECT id FROM import_batches
      WHERE org_id = ? AND kind = 'sample' AND status = 'complete'
      ORDER BY created_at DESC LIMIT 1`,
    orgId
  );
  return row?.id ?? null;
}
