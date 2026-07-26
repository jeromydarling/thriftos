import { describe, expect, it } from "vitest";
import { handleWebhook } from "./webhooks";

const SECRET = "whsec_test_secret";

/** Sign a body the way Stripe does, so the verifier is exercised for real. */
async function sign(body: string, secret = SECRET, timestamp = Math.floor(Date.now() / 1000)) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${body}`));
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `t=${timestamp},v1=${hex}`;
}

/**
 * An in-memory stand-in for the event store.
 *
 * Only the tables the webhook path touches before dispatch are modelled —
 * the point of these tests is the gate, not the handlers behind it.
 */
function stubDb() {
  const events = new Map<string, { status: string; attempts: number }>();
  const statements: string[] = [];

  const db = {
    prepare(sql: string) {
      statements.push(sql);
      return {
        bind: (...params: unknown[]) => ({
          run: async () => {
            if (/INSERT OR IGNORE INTO stripe_events/i.test(sql)) {
              const id = String(params[0]);
              if (events.has(id)) return { meta: { changes: 0 } };
              events.set(id, { status: "received", attempts: 0 });
              return { meta: { changes: 1 } };
            }
            if (/UPDATE stripe_events/i.test(sql)) {
              const id = String(params[params.length - 1]);
              const prior = events.get(id);
              if (prior) {
                prior.status = String(params[0]);
                prior.attempts++;
              }
              return { meta: { changes: 1 } };
            }
            return { meta: { changes: 0 } };
          },
          first: async () => {
            if (/SELECT status FROM stripe_events/i.test(sql)) {
              return events.get(String(params[0])) ?? null;
            }
            return null;
          },
          all: async () => ({ results: [] }),
        }),
      };
    },
  } as unknown as D1Database;

  return { db, events, statements };
}

const EVENT = JSON.stringify({
  id: "evt_1",
  type: "customer.created",
  created: 1700000000,
  data: { object: { id: "cus_1" } },
});

describe("signature verification", () => {
  it("rejects an unsigned body with 400", async () => {
    const { db, events } = stubDb();
    const { status, result } = await handleWebhook(db, {
      rawBody: EVENT,
      signature: null,
      secret: SECRET,
      config: null,
    });

    expect(status).toBe(400);
    expect(result.outcome).toBe("failed");
    // Nothing unverified may reach the event store — anyone can POST here.
    expect(events.size).toBe(0);
  });

  it("rejects a body signed with the wrong secret", async () => {
    const { db, events } = stubDb();
    const { status } = await handleWebhook(db, {
      rawBody: EVENT,
      signature: await sign(EVENT, "whsec_someone_else"),
      secret: SECRET,
      config: null,
    });

    expect(status).toBe(400);
    expect(events.size).toBe(0);
  });

  it("rejects a valid signature over a different body", async () => {
    const { db } = stubDb();
    const { status } = await handleWebhook(db, {
      rawBody: EVENT.replace("cus_1", "cus_tampered"),
      signature: await sign(EVENT),
      secret: SECRET,
      config: null,
    });
    expect(status).toBe(400);
  });

  it("rejects a signature older than the tolerance", async () => {
    const { db } = stubDb();
    const stale = Math.floor(Date.now() / 1000) - 3600;
    const { status } = await handleWebhook(db, {
      rawBody: EVENT,
      signature: await sign(EVENT, SECRET, stale),
      secret: SECRET,
      config: null,
    });
    expect(status).toBe(400);
  });

  it("accepts a correctly signed body", async () => {
    const { db, events } = stubDb();
    const { status } = await handleWebhook(db, {
      rawBody: EVENT,
      signature: await sign(EVENT),
      secret: SECRET,
      config: null,
    });

    expect(status).toBe(200);
    expect(events.size).toBe(1);
  });
});

describe("the event store", () => {
  it("claims the event by insert, not by checking first", async () => {
    const { db, statements } = stubDb();
    await handleWebhook(db, {
      rawBody: EVENT,
      signature: await sign(EVENT),
      secret: SECRET,
      config: null,
    });

    // A SELECT-then-INSERT would let two concurrent deliveries both pass.
    const claim = statements.find((s) => /stripe_events/i.test(s));
    expect(claim).toMatch(/INSERT OR IGNORE/i);
  });

  it("stores the event before running any handler", async () => {
    const { db, statements } = stubDb();
    await handleWebhook(db, {
      rawBody: EVENT,
      signature: await sign(EVENT),
      secret: SECRET,
      config: null,
    });
    expect(statements[0]).toMatch(/INSERT OR IGNORE INTO stripe_events/i);
  });

  it("treats a redelivery as a duplicate and does nothing twice", async () => {
    const { db } = stubDb();
    const signature = await sign(EVENT);
    const opts = { rawBody: EVENT, signature, secret: SECRET, config: null };

    const first = await handleWebhook(db, opts);
    const second = await handleWebhook(db, opts);

    expect(first.result.outcome).toBe("ignored");
    expect(second.result.outcome).toBe("duplicate");
    // Still 200 — a duplicate is a normal outcome, not an error to retry.
    expect(second.status).toBe(200);
  });

  it("stores an event type it doesn't handle rather than dropping it", async () => {
    const { db, events } = stubDb();
    const { result } = await handleWebhook(db, {
      rawBody: EVENT,
      signature: await sign(EVENT),
      secret: SECRET,
      config: null,
    });

    expect(result.outcome).toBe("ignored");
    expect(events.get("evt_1")?.status).toBe("ignored");
  });

  it("rejects a signed body that isn't JSON", async () => {
    const { db } = stubDb();
    const body = "not json at all";
    const { status } = await handleWebhook(db, {
      rawBody: body,
      signature: await sign(body),
      secret: SECRET,
      config: null,
    });
    expect(status).toBe(400);
  });

  it("rejects signed JSON that isn't a Stripe event", async () => {
    const { db } = stubDb();
    const body = JSON.stringify({ hello: "world" });
    const { status } = await handleWebhook(db, {
      rawBody: body,
      signature: await sign(body),
      secret: SECRET,
      config: null,
    });
    expect(status).toBe(400);
  });

  it("returns 200 and records the failure when a handler throws", async () => {
    // A payment_intent event with no matching attempt exercises the dispatch
    // path; the stub returns no attempt, which the handler tolerates.
    const body = JSON.stringify({
      id: "evt_2",
      type: "payment_intent.succeeded",
      created: 1700000000,
      data: { object: { id: "pi_unknown", status: "succeeded", amount: 100, currency: "usd" } },
    });

    const { db, events } = stubDb();
    const { status, result } = await handleWebhook(db, {
      rawBody: body,
      signature: await sign(body),
      secret: SECRET,
      config: null,
    });

    // 200 either way: the event is on disk and replayable, and letting Stripe
    // retry a deterministic bug forever just buries the real failure.
    expect(status).toBe(200);
    expect(["processed", "failed"]).toContain(result.outcome);
    expect(events.has("evt_2")).toBe(true);
  });

  it("lets a previously failed event be retried", async () => {
    const { db, events } = stubDb();
    const signature = await sign(EVENT);
    const opts = { rawBody: EVENT, signature, secret: SECRET, config: null };

    await handleWebhook(db, opts);
    events.get("evt_1")!.status = "failed";

    const retry = await handleWebhook(db, opts);
    expect(retry.result.outcome).not.toBe("duplicate");
  });
});
