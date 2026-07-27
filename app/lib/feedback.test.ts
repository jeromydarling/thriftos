import { describe, expect, it } from "vitest";
import {
  FEEDBACK_KINDS,
  FeedbackError,
  MAX_BODY,
  feedbackEmail,
  isFeedbackKind,
  pathOnly,
  readFeedbackForm,
  recordFeedback,
} from "./feedback";
import type { AppEnv } from "./env";

const form = (fields: Record<string, string>) => new URLSearchParams(fields);

const WHO = {
  orgId: "org_1",
  orgName: "Second Chances",
  userId: "usr_1",
  userEmail: "jo@secondchances.org",
  userName: "Jo",
};

describe("reading a report", () => {
  it("takes the words and works out the rest", () => {
    const input = readFeedbackForm(
      form({ kind: "idea", body: "  Let me print a shelf label.  ", path: "/app/inventory" }),
      "Mozilla/5.0"
    );
    expect(input).toMatchObject({
      kind: "idea",
      body: "Let me print a shelf label.",
      path: "/app/inventory",
      userAgent: "Mozilla/5.0",
    });
  });

  it("refuses an empty one, because there'd be nothing to read", () => {
    expect(() => readFeedbackForm(form({ body: "   " }))).toThrow(FeedbackError);
  });

  it("falls back to a bug rather than storing a kind nobody knows", () => {
    expect(readFeedbackForm(form({ kind: "complaint", body: "x" })).kind).toBe("bug");
    expect(isFeedbackKind("bug")).toBe(true);
    expect(isFeedbackKind("rant")).toBe(false);
  });

  it("caps the body rather than letting one report fill the table", () => {
    const long = readFeedbackForm(form({ body: "a".repeat(MAX_BODY + 500) }));
    expect(long.body).toHaveLength(MAX_BODY);
  });
});

describe("what a report is allowed to carry", () => {
  it("keeps the path and drops the query string", () => {
    // Query strings on this app carry receipt tokens and Stripe return codes.
    // This table is read by people, and those must not be in it.
    expect(pathOnly("/r/tok_secret123?email=jo@x.com")).toBe("/r/tok_secret123");
    expect(pathOnly("https://thriftos.app/app/sales/tx_1?token=abc")).toBe("/app/sales/tx_1");
    expect(
      readFeedbackForm(form({ body: "x", path: "/app/orders?stripe_session=cs_live_abc" })).path
    ).toBe("/app/orders");
  });

  it("stores no path at all rather than a broken one", () => {
    expect(pathOnly("")).toBeUndefined();
    expect(readFeedbackForm(form({ body: "x" })).path).toBeUndefined();
  });
});

describe("the email it becomes", () => {
  const input = {
    kind: "bug" as const,
    body: "The price went weird after I saved.",
    path: "/app/inventory/it_1",
    eventId: "abc123",
    userAgent: "Mozilla/5.0",
  };

  it("names the shop in the subject, because that's the first question", () => {
    expect(feedbackEmail(input, WHO).subject).toContain("Second Chances");
  });

  it("carries the context nobody should have to type", () => {
    const text = feedbackEmail(input, WHO).text;
    expect(text).toContain("The price went weird after I saved.");
    expect(text).toContain("/app/inventory/it_1");
    expect(text).toContain("abc123");
    expect(text).toContain("Jo");
  });

  it("escapes the body, so a report about angle brackets isn't one about HTML", () => {
    const html = feedbackEmail({ ...input, body: "<script>alert(1)</script>" }, WHO).html;
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("covers every kind it offers", () => {
    for (const kind of FEEDBACK_KINDS) {
      expect(feedbackEmail({ ...input, kind: kind.id }, WHO).subject).toContain(kind.label);
    }
  });
});

describe("saving it", () => {
  function dbSpy() {
    const writes: { sql: string; args: unknown[] }[] = [];
    const db = {
      prepare: (sql: string) => ({
        bind: (...args: unknown[]) => ({
          run: async () => (writes.push({ sql, args }), { success: true }),
          first: async () => null,
          all: async () => ({ results: [] }),
        }),
      }),
    } as unknown as D1Database;
    return { db, writes };
  }

  it("writes the row before anything is emailed", async () => {
    const { db, writes } = dbSpy();
    const env = { DB: db } as unknown as AppEnv;

    const { id, deliver } = await recordFeedback(
      env,
      { kind: "bug", body: "Broken.", path: "/app" },
      WHO
    );

    // Durable first. An email that fails must not lose the report — that's the
    // whole reason the table exists.
    expect(id).toMatch(/^fb_/);
    expect(writes).toHaveLength(1);
    expect(writes[0].sql).toContain("INSERT INTO feedback");
    expect(writes[0].args).toContain("org_1");
    expect(writes[0].args).toContain("Broken.");
    expect(typeof deliver).toBe("function");
  });
});
