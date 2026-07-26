import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * How a request is routed to a shop.
 *
 * These are source-level checks rather than round-trips through a database,
 * because the bug they exist to prevent was not in any query — it was in the
 * decision of *which* query to run. The first production deploy had APP_URL
 * set to a hostname the worker didn't answer on, every request therefore
 * looked like it had arrived on a custom domain, the first path segment was
 * read as a page rather than a shop, and every storefront 404'd while the
 * marketing pages happily returned 200.
 */
describe("a shop's address does not depend on APP_URL", () => {
  const shopRoute = readFileSync("app/routes/shop.tsx", "utf8");
  const homeRoute = readFileSync("app/routes/home.tsx", "utf8");
  const storefront = readFileSync("app/lib/storefront.ts", "utf8");

  it("decides 'is this a custom hostname' from the database, not from config", () => {
    // The check must be a lookup against active custom domains. Comparing the
    // request's hostname to a configured one is the thing that broke.
    expect(shopRoute).toContain("shopForHostname");
    // Reading it — `env.APP_URL` — is the failure; naming it in the comment
    // that explains why we don't is the point.
    expect(shopRoute).not.toContain("env.APP_URL");
    expect(shopRoute).not.toContain("appHost");
  });

  it("falls back to the slug when the hostname belongs to no shop", () => {
    // Without this, a hostname we don't recognise serves nothing at all.
    expect(shopRoute).toMatch(/shopForHostname\([^)]*\)[\s\S]{0,200}shopForSlug/);
  });

  it("only serves a shop on a hostname whose domain is active", () => {
    // A hostname mid-provisioning must not serve a half-configured page.
    const fn = storefront.slice(storefront.indexOf("export async function shopForHostname"));
    expect(fn).toContain("d.status = 'active'");
    expect(fn).toContain("o.status = 'active'");
  });

  it("serves the shop, not our marketing page, at the root of a custom domain", () => {
    // '/' is the one address a custom domain is guaranteed to be visited at.
    expect(homeRoute).toContain("shopForHostname");
    expect(homeRoute).toContain("Storefront");
  });
});

describe("the deploy checks the routes that would catch this", () => {
  const workflow = readFileSync(".github/workflows/deploy.yml", "utf8");

  it("smoke-tests a shop page, not only marketing pages", () => {
    // Marketing pages returned 200 throughout the outage. A shop page is the
    // only one of the four that would have failed the build.
    expect(workflow).toContain("/second-chances");
  });

  it("reads the base URL from the same APP_URL the worker runs on", () => {
    // A second hardcoded copy of the hostname is a second thing to get wrong.
    expect(workflow).toContain("APP_URL");
    expect(workflow).not.toContain("https://thriftos.jeromydarling.workers.dev");
  });

  it("migrates before it deploys", () => {
    const migrate = workflow.indexOf("Apply database migrations");
    // The step, not the workflow's own `name: Deploy` at the top of the file.
    const deploy = workflow.indexOf("- name: Deploy");
    expect(migrate).toBeGreaterThan(-1);
    expect(deploy).toBeGreaterThan(migrate);
  });
});
