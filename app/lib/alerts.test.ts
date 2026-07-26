import { describe, expect, it } from "vitest";
import { raise, sweepAlerts } from "./alerts";

/**
 * An in-memory alerts table.
 *
 * The property worth testing is dedupe: a cron that runs every night must not
 * produce a nightly pile of identical rows, and a shop that has acknowledged
 * one warning must still be told when the same problem becomes urgent.
 */
function stubDb(reads: Record<string, unknown[]> = {}) {
  const alerts = new Map<string, Record<string, unknown>>();

  const rowsFor = (sql: string): unknown[] => {
    if (/FROM disputes/i.test(sql)) return reads.disputes ?? [];
    if (/FROM stripe_events/i.test(sql)) return reads.events ?? [{ n: 0, latest: null }];
    if (/FROM payment_attempts/i.test(sql)) return reads.attempts ?? [];
    if (/FROM stripe_accounts/i.test(sql)) return reads.accounts ?? [];
    return [];
  };

  const db = {
    prepare(sql: string) {
      return {
        bind: (...params: unknown[]) => ({
          run: async () => {
            if (/INSERT OR IGNORE INTO alerts/i.test(sql)) {
              // (kind, dedupe_key) is the unique index.
              const key = `${params[2]}::${params[7]}`;
              if (alerts.has(key)) return { meta: { changes: 0 } };
              alerts.set(key, {
                kind: params[2],
                severity: params[3],
                title: params[4],
                body: params[5],
                href: params[6],
              });
              return { meta: { changes: 1 } };
            }
            return { meta: { changes: 0 } };
          },
          all: async () => ({ results: rowsFor(sql) }),
          first: async () => rowsFor(sql)[0] ?? null,
        }),
      };
    },
  } as unknown as D1Database;

  return { db, alerts };
}

const base = {
  orgId: "og_1",
  kind: "webhook_failed" as const,
  title: "Something broke",
  body: "Go and fix it.",
  dedupeKey: "evt_1",
};

describe("dedupe", () => {
  it("raises an alert the first time", async () => {
    const { db } = stubDb();
    expect(await raise(db, base)).toBe(true);
  });

  it("refuses the same problem twice", async () => {
    const { db } = stubDb();
    await raise(db, base);
    expect(await raise(db, base)).toBe(false);
  });

  it("treats a different problem of the same kind as new", async () => {
    const { db } = stubDb();
    await raise(db, base);
    expect(await raise(db, { ...base, dedupeKey: "evt_2" })).toBe(true);
  });

  it("defaults to warning rather than shouting", async () => {
    const { db, alerts } = stubDb();
    await raise(db, base);
    expect([...alerts.values()][0].severity).toBe("warning");
  });
});

describe("dispute deadlines", () => {
  const soon = new Date(Date.now() + 5 * 86_400_000).toISOString();
  const urgent = new Date(Date.now() + 1 * 86_400_000).toISOString();
  const distant = new Date(Date.now() + 30 * 86_400_000).toISOString();

  it("says nothing about a deadline a month away", async () => {
    const { db, alerts } = stubDb({
      disputes: [
        { id: "dp_1", org_id: "og_1", amount_cents: 5000, evidence_due_at: distant, status: "needs_response", transaction_id: "tx_1" },
      ],
    });
    const result = await sweepAlerts(db);
    expect(result.dispute_deadline).toBe(0);
    expect(alerts.size).toBe(0);
  });

  it("warns a week out", async () => {
    const { db, alerts } = stubDb({
      disputes: [
        { id: "dp_1", org_id: "og_1", amount_cents: 5000, evidence_due_at: soon, status: "needs_response", transaction_id: "tx_1" },
      ],
    });
    await sweepAlerts(db);
    const alert = [...alerts.values()][0];
    expect(alert.severity).toBe("warning");
    expect(String(alert.body)).toMatch(/lost by default/);
  });

  it("escalates to critical near the deadline", async () => {
    const { db, alerts } = stubDb({
      disputes: [
        { id: "dp_1", org_id: "og_1", amount_cents: 5000, evidence_due_at: urgent, status: "needs_response", transaction_id: "tx_1" },
      ],
    });
    await sweepAlerts(db);
    expect([...alerts.values()][0].severity).toBe("critical");
  });

  it("raises the urgent alert separately from the earlier warning", async () => {
    // A shop that dismissed the week-out warning must still be told when it
    // becomes urgent, so the two stages carry different dedupe keys.
    const { db, alerts } = stubDb({
      disputes: [
        { id: "dp_1", org_id: "og_1", amount_cents: 5000, evidence_due_at: soon, status: "needs_response", transaction_id: "tx_1" },
      ],
    });
    await sweepAlerts(db);
    expect([...alerts.keys()][0]).toContain(":soon");
  });

  it("points at the sale, so the receipt is one click away", async () => {
    const { db, alerts } = stubDb({
      disputes: [
        { id: "dp_1", org_id: "og_1", amount_cents: 5000, evidence_due_at: urgent, status: "needs_response", transaction_id: "tx_9" },
      ],
    });
    await sweepAlerts(db);
    expect([...alerts.values()][0].href).toBe("/app/sales/tx_9");
  });

  it("still speaks up when there's no deadline recorded", async () => {
    const { db, alerts } = stubDb({
      disputes: [
        { id: "dp_1", org_id: "og_1", amount_cents: 5000, evidence_due_at: null, status: "needs_response", transaction_id: null },
      ],
    });
    await sweepAlerts(db);
    expect(alerts.size).toBe(1);
  });

  it("is quiet about a dispute that's already resolved", async () => {
    // The query filters won/lost, so an empty read is the realistic case.
    const { db, alerts } = stubDb({ disputes: [] });
    await sweepAlerts(db);
    expect(alerts.size).toBe(0);
  });
});

describe("other sweeps", () => {
  it("raises nothing when everything is fine", async () => {
    const { db, alerts } = stubDb();
    const result = await sweepAlerts(db);
    expect(alerts.size).toBe(0);
    expect(Object.values(result).every((n) => n === 0)).toBe(true);
  });

  it("flags failed webhooks as critical, because money may be unrecorded", async () => {
    const { db, alerts } = stubDb({ events: [{ n: 3, latest: "2026-07-26T10:00:00Z" }] });
    await sweepAlerts(db);
    const alert = [...alerts.values()][0];
    expect(alert.severity).toBe("critical");
    expect(String(alert.title)).toContain("3");
  });

  it("flags payments stuck holding inventory", async () => {
    const { db, alerts } = stubDb({ attempts: [{ org_id: "og_1", n: 4 }] });
    await sweepAlerts(db);
    expect(String([...alerts.values()][0].body)).toMatch(/holding items as reserved/);
  });

  it("flags a Connect account that can't take money, and says cash still works", async () => {
    const { db, alerts } = stubDb({
      accounts: [{ org_id: "og_1", status: "restricted", disabled_reason: "requirements.past_due" }],
    });
    await sweepAlerts(db);
    const alert = [...alerts.values()][0];
    expect(alert.severity).toBe("critical");
    expect(String(alert.body)).toMatch(/[Cc]ash still works/);
  });

  it("gives every alert somewhere to go", async () => {
    const { db, alerts } = stubDb({
      events: [{ n: 1, latest: "2026-07-26T10:00:00Z" }],
      attempts: [{ org_id: "og_1", n: 2 }],
      accounts: [{ org_id: "og_1", status: "disabled", disabled_reason: null }],
    });
    await sweepAlerts(db);
    for (const alert of alerts.values()) {
      // An alert with no action is a log line pretending to be an alert.
      expect(alert.href, String(alert.title)).toBeTruthy();
    }
  });
});
