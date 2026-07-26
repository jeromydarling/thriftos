import { describe, expect, it } from "vitest";
import {
  deriveDomainStatus,
  domainInstructions,
  domainReadiness,
  validateHostname,
  type CustomDomain,
  type DomainStatus,
} from "./domains";

describe("domainReadiness", () => {
  it("says the feature is off when either secret is missing", () => {
    for (const env of [
      {},
      { CLOUDFLARE_API_TOKEN: "t" },
      { CLOUDFLARE_ZONE_ID: "z" },
      { CLOUDFLARE_API_TOKEN: "", CLOUDFLARE_ZONE_ID: "z" },
    ]) {
      expect(domainReadiness(env).configured, JSON.stringify(env)).toBe(false);
    }
  });

  it("explains the shop is unaffected, without naming a secret", () => {
    const reason = domainReadiness({}).reason ?? "";
    expect(reason).toMatch(/ThriftOS address/);
    // A shop owner reading this must not be shown our configuration.
    expect(reason).not.toMatch(/CLOUDFLARE|token|zone/i);
  });

  it("is configured when both secrets are present", () => {
    expect(domainReadiness({ CLOUDFLARE_API_TOKEN: "t", CLOUDFLARE_ZONE_ID: "z" })).toEqual({
      configured: true,
      reason: null,
    });
  });
});

describe("validateHostname", () => {
  const app = "thriftos.app";

  it("accepts a domain a shop would actually own", () => {
    for (const raw of ["shop.example.org", "millroadthrift.co.uk", "a.b.c.example.com"]) {
      expect(validateHostname(raw, app).ok, raw).toBe(true);
    }
  });

  it("forgives how the domain was pasted", () => {
    // Copied from a browser bar, typed in capitals, trailing dot from a DNS tool.
    expect(validateHostname("  HTTPS://Shop.Example.ORG/about?x=1  ", app)).toMatchObject({
      ok: true,
      hostname: "shop.example.org",
    });
    expect(validateHostname("shop.example.org.", app).hostname).toBe("shop.example.org");
  });

  it("rejects things that aren't domains, with advice", () => {
    for (const raw of ["", "   ", "localhost", "example", "shop example.org", "-bad.example.org", "shop..example.org"]) {
      const check = validateHostname(raw, app);
      expect(check.ok, raw).toBe(false);
      expect(check.reason, raw).toBeTruthy();
    }
  });

  it("refuses our own hostname and anything under it", () => {
    // Claiming thriftos.app as a custom hostname would point the platform at
    // itself; claiming a subdomain lets a shop take an address we may need.
    for (const raw of ["thriftos.app", "www.thriftos.app", "anything.thriftos.app"]) {
      const check = validateHostname(raw, app);
      expect(check.ok, raw).toBe(false);
      expect(check.reason, raw).toMatch(/ThriftOS address/);
    }
  });

  it("compares against the app host however it was configured", () => {
    // APP_URL carries a scheme in production and a port in development.
    expect(validateHostname("thriftos.app", "https://thriftos.app").ok).toBe(false);
    expect(validateHostname("localhost.dev", "http://localhost.dev:5173").ok).toBe(false);
  });

  it("refuses workers.dev even when APP_URL is wrong", () => {
    // APP_URL has been wrong in production, so it must not be the only thing
    // standing between a shop and the hostname the platform answers on.
    for (const raw of ["thriftos.jer-f84.workers.dev", "anything.workers.dev", "workers.dev"]) {
      expect(validateHostname(raw, "https://wrong-host.example").ok, raw).toBe(false);
    }
  });

  it("does not reject a domain that merely ends in the same letters", () => {
    // 'notthriftos.app' ends with 'thriftos.app' as a string but is a
    // different domain, and a shop that owns it must be able to use it.
    expect(validateHostname("notthriftos.app", app).ok).toBe(true);
  });
});

describe("deriveDomainStatus", () => {
  const hostname = (over: Record<string, unknown>) =>
    ({ id: "cf_1", hostname: "shop.example.org", status: "pending", ...over }) as Parameters<
      typeof deriveDomainStatus
    >[0];

  it("goes active only when the hostname and its certificate both are", () => {
    expect(deriveDomainStatus(hostname({ status: "active", ssl: { status: "active" } }))).toBe(
      "active"
    );
  });

  it("will not call a hostname active on a certificate that isn't ready", () => {
    // This is the failure that serves a shop's customers a certificate
    // warning, so it is the one worth being paranoid about.
    for (const ssl of ["pending_validation", "pending_issuance", "initializing", undefined, ""]) {
      expect(deriveDomainStatus(hostname({ status: "active", ssl: { status: ssl } })), String(ssl)).toBe(
        "verifying"
      );
    }
  });

  it("fails a hostname Cloudflare has blocked or given up on", () => {
    expect(deriveDomainStatus(hostname({ status: "blocked" }))).toBe("failed");
    expect(deriveDomainStatus(hostname({ status: "moved" }))).toBe("failed");
    expect(
      deriveDomainStatus(hostname({ status: "active", ssl: { status: "validation_timed_out" } }))
    ).toBe("failed");
    expect(deriveDomainStatus(hostname({ status: "active", ssl: { status: "deleted" } }))).toBe(
      "failed"
    );
  });

  it("treats a status we don't recognise as still waiting", () => {
    // Cloudflare adding a status must never promote a domain to live.
    for (const status of ["provisioning", "something_new", ""]) {
      expect(deriveDomainStatus(hostname({ status, ssl: { status: "active" } })), status).not.toBe(
        "active"
      );
    }
  });
});

describe("domainInstructions", () => {
  const domain = (over: Partial<CustomDomain>): CustomDomain =>
    ({
      id: "d_1",
      org_id: "o_1",
      hostname: "shop.example.org",
      cf_hostname_id: "cf_1",
      status: "pending" as DomainStatus,
      verification_txt_name: null,
      verification_txt_value: null,
      cname_target: "thriftos.app",
      ssl_status: null,
      last_error: null,
      verified_at: null,
      created_at: "2026-01-01",
      ...over,
    }) as CustomDomain;

  it("tells a waiting shop the exact record to add", () => {
    const text = domainInstructions(domain({ status: "verifying" }), "thriftos.app");
    expect(text).toContain("shop.example.org");
    expect(text).toContain("thriftos.app");
    expect(text).toMatch(/CNAME/);
  });

  it("says there is nothing to do once it's live", () => {
    expect(domainInstructions(domain({ status: "active" }), "thriftos.app")).toMatch(/live/i);
  });

  it("surfaces Cloudflare's own reason when there is one", () => {
    const text = domainInstructions(
      domain({ status: "failed", last_error: "caa_error: CAA record forbids issuance" }),
      "thriftos.app"
    );
    expect(text).toContain("CAA record forbids issuance");
  });

  it("still says something useful when a failure has no reason", () => {
    const text = domainInstructions(domain({ status: "failed" }), "thriftos.app");
    expect(text.length).toBeGreaterThan(20);
  });

  it("says nothing about a removed domain", () => {
    expect(domainInstructions(domain({ status: "removed" }), "thriftos.app")).toBe("");
  });
});
