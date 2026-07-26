import { afterEach, describe, expect, it, vi } from "vitest";
import { bindLog, log, newRequestId, redact } from "./log";

/** Capture what actually reaches the console. */
function capture() {
  const lines: string[] = [];
  const spy = (...args: unknown[]) => lines.push(String(args[0]));
  vi.spyOn(console, "log").mockImplementation(spy);
  vi.spyOn(console, "warn").mockImplementation(spy);
  vi.spyOn(console, "error").mockImplementation(spy);
  return lines;
}

afterEach(() => vi.restoreAllMocks());

describe("redaction", () => {
  it("strips a Stripe secret key", () => {
    expect(redact("failed with sk_test_abc123XYZ")).not.toContain("sk_test_abc123XYZ");
    expect(redact("failed with sk_live_abc123XYZ")).toContain("[redacted]");
  });

  it("strips a webhook signing secret", () => {
    expect(redact("whsec_supersecretvalue")).toBe("[redacted]");
  });

  it("strips anything that looks like a card number", () => {
    expect(redact("card 4242424242424242 declined")).toBe("card [redacted] declined");
    expect(redact("card 4242 declined")).toBe("card 4242 declined");
  });

  it("strips email addresses", () => {
    expect(redact("no account for marta@example.com")).toBe("no account for [redacted]");
  });

  it("leaves our own ids alone — they're what makes a log useful", () => {
    const text = "tx_abc123 attempt pa_def456 intent pi_ghi789";
    expect(redact(text)).toBe(text);
  });
});

describe("log lines", () => {
  it("emits one JSON object per line", () => {
    const lines = capture();
    log.info("something happened", { orgId: "og_1" });
    expect(lines).toHaveLength(1);
    expect(() => JSON.parse(lines[0])).not.toThrow();
  });

  it("carries the level, message, and timestamp", () => {
    const lines = capture();
    log.warn("careful", {});
    const parsed = JSON.parse(lines[0]);
    expect(parsed.level).toBe("warn");
    expect(parsed.msg).toBe("careful");
    expect(typeof parsed.at).toBe("string");
  });

  it("keeps the correlation fields a payment investigation needs", () => {
    const lines = capture();
    log.info("payment", {
      requestId: "r1",
      orgId: "og_1",
      transactionId: "tx_1",
      attemptId: "pa_1",
      stripeObjectId: "pi_1",
      idempotencyKey: "tx_1:1",
    });
    const parsed = JSON.parse(lines[0]);
    expect(parsed).toMatchObject({
      requestId: "r1",
      orgId: "og_1",
      transactionId: "tx_1",
      attemptId: "pa_1",
      stripeObjectId: "pi_1",
      idempotencyKey: "tx_1:1",
    });
  });

  it("drops fields that aren't on the allowlist", () => {
    const lines = capture();
    // A careless caller spreading a customer record must not leak it.
    log.info("oops", { email: "marta@example.com", cardNumber: "4242424242424242" } as never);
    const parsed = JSON.parse(lines[0]);
    expect(parsed.email).toBeUndefined();
    expect(parsed.cardNumber).toBeUndefined();
  });

  it("redacts secrets inside an error message", () => {
    const lines = capture();
    log.error("stripe rejected", { error: "bad key sk_test_leakedvalue for marta@example.com" });
    expect(lines[0]).not.toContain("sk_test_leakedvalue");
    expect(lines[0]).not.toContain("marta@example.com");
  });

  it("omits fields that weren't provided rather than logging nulls", () => {
    const lines = capture();
    log.info("minimal", { orgId: "og_1" });
    const parsed = JSON.parse(lines[0]);
    expect("transactionId" in parsed).toBe(false);
  });

  it("keeps numeric fields as numbers, so a log tool can aggregate them", () => {
    const lines = capture();
    log.info("sale", { amountCents: 2140, feeCents: 15, durationMs: 42 });
    const parsed = JSON.parse(lines[0]);
    expect(parsed.amountCents).toBe(2140);
    expect(parsed.durationMs).toBe(42);
  });

  it("sends errors to console.error so they're separable", () => {
    const errors: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...a) => errors.push(String(a[0])));
    vi.spyOn(console, "log").mockImplementation(() => {});
    log.error("bad", {});
    expect(errors).toHaveLength(1);
  });
});

describe("bindLog", () => {
  it("carries the bound fields onto every call", () => {
    const lines = capture();
    const logger = bindLog({ requestId: "r1", orgId: "og_1" });
    logger.info("first", { transactionId: "tx_1" });
    logger.info("second", { transactionId: "tx_2" });

    const parsed = lines.map((l) => JSON.parse(l));
    expect(parsed[0]).toMatchObject({ requestId: "r1", orgId: "og_1", transactionId: "tx_1" });
    expect(parsed[1]).toMatchObject({ requestId: "r1", orgId: "og_1", transactionId: "tx_2" });
  });

  it("lets a call add detail without losing the bound ids", () => {
    const lines = capture();
    bindLog({ orgId: "og_1" }).warn("careful", { outcome: "retried" });
    const parsed = JSON.parse(lines[0]);
    expect(parsed.orgId).toBe("og_1");
    expect(parsed.outcome).toBe("retried");
  });
});

describe("newRequestId", () => {
  it("is short enough to read and long enough to be unique", () => {
    const id = newRequestId();
    expect(id).toHaveLength(16);
    expect(id).toMatch(/^[a-f0-9]+$/);
  });

  it("differs between calls", () => {
    expect(newRequestId()).not.toBe(newRequestId());
  });
});
