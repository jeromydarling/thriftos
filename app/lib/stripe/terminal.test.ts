import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createCardPresentIntent, stateForIntent } from "./terminal";

const config = { secretKey: "sk_test_fake" };

function mockStripe(response: unknown, status = 200) {
  const fetchMock = vi.fn(async () =>
    new Response(JSON.stringify(response), {
      status,
      headers: { "Content-Type": "application/json" },
    })
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** Stripe form bodies are bracket-flattened; read one back as a map. */
function bodyOf(fetchMock: ReturnType<typeof mockStripe>): URLSearchParams {
  const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  return new URLSearchParams(String(init.body));
}

beforeEach(() => {
  vi.unstubAllGlobals();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("stateForIntent", () => {
  it("maps the settled states", () => {
    expect(stateForIntent("succeeded")).toBe("succeeded");
    expect(stateForIntent("canceled")).toBe("canceled");
  });

  it("treats a declined card-present payment as failed", () => {
    expect(stateForIntent("requires_payment_method")).toBe("failed");
  });

  it("treats an unknown status as processing, never as succeeded", () => {
    // If Stripe adds a status tomorrow, the worst outcome must be a payment
    // that looks unfinished — never an item sold for money we didn't take.
    expect(stateForIntent("some_future_status")).toBe("processing");
    expect(stateForIntent("")).toBe("processing");
  });
});

describe("createCardPresentIntent", () => {
  const base = {
    amountCents: 2000,
    applicationFeeCents: 10,
    connectedAccountId: "acct_123",
    transactionId: "tx_1",
    orgId: "og_1",
  };

  it("sends a destination charge with on_behalf_of", async () => {
    const fetchMock = mockStripe({ id: "pi_1", status: "requires_payment_method" });
    await createCardPresentIntent(config, base, "idem_1");

    const body = bodyOf(fetchMock);
    // on_behalf_of is what makes the shop the merchant of record.
    expect(body.get("on_behalf_of")).toBe("acct_123");
    expect(body.get("transfer_data[destination]")).toBe("acct_123");
    expect(body.get("application_fee_amount")).toBe("10");
    expect(body.get("payment_method_types[0]")).toBe("card_present");
  });

  it("sends the idempotency key, so a retry can't double-charge", async () => {
    const fetchMock = mockStripe({ id: "pi_1", status: "requires_payment_method" });
    await createCardPresentIntent(config, base, "tx_1:1");

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)["Idempotency-Key"]).toBe("tx_1:1");
  });

  it("tags the intent with our own ids for reconciliation", async () => {
    const fetchMock = mockStripe({ id: "pi_1", status: "requires_payment_method" });
    await createCardPresentIntent(config, base, "idem_1");

    const body = bodyOf(fetchMock);
    expect(body.get("metadata[thriftos_transaction_id]")).toBe("tx_1");
    expect(body.get("metadata[thriftos_org_id]")).toBe("og_1");
  });

  it("omits the application fee entirely when it's zero", async () => {
    const fetchMock = mockStripe({ id: "pi_1", status: "requires_payment_method" });
    await createCardPresentIntent(config, { ...base, applicationFeeCents: 0 }, "idem_1");
    expect(bodyOf(fetchMock).has("application_fee_amount")).toBe(false);
  });

  it("refuses a fee that is not less than the payment", async () => {
    mockStripe({ id: "pi_1", status: "requires_payment_method" });
    await expect(
      createCardPresentIntent(config, { ...base, applicationFeeCents: 2000 }, "idem_1")
    ).rejects.toThrow(/Refusing to charge/);
  });

  it("refuses a negative fee", async () => {
    mockStripe({ id: "pi_1", status: "requires_payment_method" });
    await expect(
      createCardPresentIntent(config, { ...base, applicationFeeCents: -5 }, "idem_1")
    ).rejects.toThrow(/cannot be negative/);
  });

  it("refuses a payment for nothing", async () => {
    mockStripe({ id: "pi_1", status: "requires_payment_method" });
    await expect(
      createCardPresentIntent(config, { ...base, amountCents: 0 }, "idem_1")
    ).rejects.toThrow(/positive amount/);
  });

  it("never asks Stripe for anything when the guard fails", async () => {
    const fetchMock = mockStripe({ id: "pi_1", status: "requires_payment_method" });
    await createCardPresentIntent(config, { ...base, applicationFeeCents: 5000 }, "i").catch(
      () => {}
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("truncates a long statement descriptor rather than letting Stripe reject it", async () => {
    const fetchMock = mockStripe({ id: "pi_1", status: "requires_payment_method" });
    await createCardPresentIntent(
      config,
      { ...base, statementDescriptorSuffix: "A VERY LONG SHOP NAME THAT EXCEEDS THE LIMIT" },
      "idem_1"
    );
    expect(bodyOf(fetchMock).get("statement_descriptor_suffix")!.length).toBeLessThanOrEqual(22);
  });
});
