import { describe, expect, it } from "vitest";
import { scoreSpam } from "./spam";

const REAL_MESSAGE = {
  name: "Janet Okoro",
  email: "janet.okoro@gmail.com",
  message:
    "Hi — I volunteer at a small church thrift shop in Ohio and we're drowning in paperwork. Does ThriftOS handle donation receipts? We have about 30 donors a month.",
};

describe("real messages get through", () => {
  it("lets a genuine enquiry through", () => {
    expect(scoreSpam(REAL_MESSAGE).isSpam).toBe(false);
  });

  it("allows a single link in an otherwise human message", () => {
    const verdict = scoreSpam({
      ...REAL_MESSAGE,
      message: `${REAL_MESSAGE.message} Our site is https://example.org if that helps.`,
    });
    expect(verdict.isSpam).toBe(false);
  });

  it("doesn't punish a slow, thoughtful writer", () => {
    const verdict = scoreSpam({
      ...REAL_MESSAGE,
      renderedAt: Date.now() - 600_000,
      now: Date.now(),
    });
    expect(verdict.isSpam).toBe(false);
  });
});

describe("spam is caught", () => {
  it("catches a filled honeypot on its own", () => {
    const verdict = scoreSpam({ ...REAL_MESSAGE, honeypot: "http://spam.example" });
    expect(verdict.isSpam).toBe(true);
    expect(verdict.reasons).toContain("honeypot filled");
  });

  it("catches an instant submission", () => {
    const now = Date.now();
    const verdict = scoreSpam({
      ...REAL_MESSAGE,
      message: "check this out https://a.example and https://b.example",
      renderedAt: now - 400,
      now,
    });
    expect(verdict.isSpam).toBe(true);
  });

  it("catches the classic SEO pitch", () => {
    const verdict = scoreSpam({
      name: "Alex",
      email: "alex@marketingpro.example",
      message:
        "Hi there, I came across your website and noticed it isn't ranking on the first page of Google. We offer SEO services and quality backlinks that will increase your traffic by 300%. Visit https://a.example https://b.example https://c.example",
    });
    expect(verdict.isSpam).toBe(true);
  });

  it("catches embedded markup links", () => {
    const verdict = scoreSpam({
      ...REAL_MESSAGE,
      message: "great site [url=http://spam.example]cheap pills[/url]",
    });
    expect(verdict.isSpam).toBe(true);
  });

  it("catches look-alike sender domains", () => {
    const verdict = scoreSpam({
      ...REAL_MESSAGE,
      email: "someone@gmial.com",
      message: "Hello there, quick question about your website seo ranking",
    });
    expect(verdict.isSpam).toBe(true);
  });

  it("catches shouting", () => {
    const verdict = scoreSpam({
      ...REAL_MESSAGE,
      message: "MAKE MONEY FAST FROM HOME GUARANTEED INCOME EVERY SINGLE DAY NO EXPERIENCE NEEDED",
    });
    expect(verdict.isSpam).toBe(true);
  });
});

describe("scoring behaviour", () => {
  it("always explains itself", () => {
    const verdict = scoreSpam({ ...REAL_MESSAGE, honeypot: "x" });
    expect(verdict.reasons.length).toBeGreaterThan(0);
    expect(verdict.score).toBeGreaterThan(0);
  });

  it("handles empty input without throwing", () => {
    expect(() => scoreSpam({ name: "", email: "", message: "" })).not.toThrow();
  });
});
