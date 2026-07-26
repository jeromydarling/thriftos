/**
 * Custom domains, through Cloudflare for SaaS.
 *
 * Every shop is reachable at thriftos.app/{slug} for nothing. This is the
 * optional extra for a shop that already owns theirthriftshop.org and would
 * rather use it.
 *
 * The rule that matters, and it's the same one the payments code follows:
 * **status is written from what Cloudflare tells us, never inferred locally.**
 * A DNS lookup from a Worker can succeed while the hostname isn't provisioned,
 * and a domain we've marked active but Cloudflare hasn't finished is a shop's
 * website returning a certificate error to its customers. So we ask, and we
 * store the answer.
 *
 * Degrades cleanly. Without `CF_SAAS_API_TOKEN` and `CF_SAAS_ZONE_ID`
 * the feature reports itself as not switched on, and everything else — the
 * shop's page at /{slug}, the studio, the CMS — carries on working.
 */
import { all, first, run } from "./db";
import { newId } from "./ids";

export interface DomainConfig {
  apiToken: string;
  zoneId: string;
  /** What a shop's CNAME should point at. */
  cnameTarget: string;
}

export interface DomainReadiness {
  configured: boolean;
  reason: string | null;
}

export function domainReadiness(env: {
  CF_SAAS_API_TOKEN?: string;
  CF_SAAS_ZONE_ID?: string;
}): DomainReadiness {
  if (!env.CF_SAAS_API_TOKEN || !env.CF_SAAS_ZONE_ID) {
    return {
      configured: false,
      reason:
        "Custom domains aren't switched on yet. Your shop is still reachable at its ThriftOS address, and nothing else is affected.",
    };
  }
  return { configured: true, reason: null };
}

export type DomainStatus = "pending" | "verifying" | "active" | "failed" | "removed";

export interface CustomDomain {
  id: string;
  org_id: string;
  hostname: string;
  cf_hostname_id: string | null;
  status: DomainStatus;
  verification_txt_name: string | null;
  verification_txt_value: string | null;
  cname_target: string | null;
  ssl_status: string | null;
  last_error: string | null;
  verified_at: string | null;
  created_at: string;
}

/* ─── Hostname validation ───────────────────────────────────────────────── */

export class DomainError extends Error {}

/**
 * Check a hostname before we ask Cloudflare about it.
 *
 * Cloudflare would reject most of these too, but its errors are written for a
 * developer. A shop owner typing their domain wrong deserves an answer they
 * can act on.
 */
export function validateHostname(raw: string, appHost: string): { ok: boolean; reason: string | null; hostname: string } {
  const hostname = raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/\.$/, "");

  if (!hostname) {
    return { ok: false, reason: "Type the domain you want to use.", hostname };
  }
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(hostname)) {
    return {
      ok: false,
      reason: "That doesn't look like a domain. It should be something like shop.example.org.",
      hostname,
    };
  }
  if (hostname.length > 253) {
    return { ok: false, reason: "That domain is too long.", hostname };
  }
  if (hostname.split(".").length < 2) {
    return { ok: false, reason: "Include the full domain, ending in .org, .com, and so on.", hostname };
  }

  const app = appHost.replace(/^https?:\/\//, "").replace(/:\d+$/, "").toLowerCase();
  // The second test is not redundant with the first: APP_URL has been wrong in
  // production before, and a wrong APP_URL must not be the only thing standing
  // between a shop and claiming the hostname the platform answers on. Nothing
  // on workers.dev can be a custom hostname anyway — Cloudflare for SaaS needs
  // a zone, and workers.dev isn't ours.
  if (
    (app && (hostname === app || hostname.endsWith(`.${app}`))) ||
    hostname === "workers.dev" ||
    hostname.endsWith(".workers.dev")
  ) {
    return {
      ok: false,
      reason: "That's a ThriftOS address. Use a domain you own — your ThriftOS address already works.",
      hostname,
    };
  }

  return { ok: true, reason: null, hostname };
}

/* ─── Cloudflare API ────────────────────────────────────────────────────── */

interface CfResponse<T> {
  success: boolean;
  result?: T;
  errors?: { code: number; message: string }[];
}

interface CfCustomHostname {
  id: string;
  hostname: string;
  status: string;
  ssl?: {
    status?: string;
    validation_errors?: { message: string }[];
  };
  ownership_verification?: { type?: string; name?: string; value?: string };
  verification_errors?: string[];
}

async function cf<T>(
  config: DomainConfig,
  method: "GET" | "POST" | "DELETE" | "PATCH",
  path: string,
  body?: unknown
): Promise<T> {
  const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${config.zoneId}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${config.apiToken}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const payload = (await res.json().catch(() => ({}))) as CfResponse<T>;

  if (!res.ok || !payload.success) {
    const message =
      payload.errors?.map((e) => e.message).join("; ") || `Cloudflare returned ${res.status}`;
    throw new DomainError(message);
  }

  return payload.result as T;
}

/**
 * Map Cloudflare's status onto ours.
 *
 * Conservative, like the payment-state mapping: anything unrecognised becomes
 * `verifying` rather than `active`. The worst outcome of an unknown status
 * should be a shop being told to wait, never a page served on a hostname that
 * isn't actually provisioned.
 */
export function deriveDomainStatus(hostname: CfCustomHostname): DomainStatus {
  const ssl = hostname.ssl?.status ?? "";

  if (hostname.status === "active" && ssl === "active") return "active";
  if (hostname.status === "blocked" || hostname.status === "moved") return "failed";
  if (ssl === "validation_timed_out" || ssl === "deleted") return "failed";
  if (hostname.status === "pending" || hostname.status === "active") return "verifying";

  return "verifying";
}

/** What the shop must do next, in words they can act on. */
export function domainInstructions(domain: CustomDomain, cnameTarget: string): string {
  switch (domain.status) {
    case "active":
      return "This domain is live. Nothing more to do.";
    case "failed":
      return (
        domain.last_error ??
        "Something went wrong provisioning this domain. Check the DNS records below, then remove it and add it again."
      );
    case "pending":
    case "verifying":
      return `Add a CNAME record at your domain provider pointing ${domain.hostname} to ${cnameTarget}. It usually goes live within a few minutes, occasionally up to an hour.`;
    default:
      return "";
  }
}

/* ─── Operations ────────────────────────────────────────────────────────── */

export async function listDomains(db: D1Database, orgId: string): Promise<CustomDomain[]> {
  return all<CustomDomain>(
    db,
    `SELECT * FROM custom_domains WHERE org_id = ? AND status <> 'removed'
      ORDER BY created_at DESC`,
    orgId
  );
}

/**
 * Claim a hostname for a shop.
 *
 * The local row is written before Cloudflare is called, so a request that dies
 * halfway leaves a record to reconcile rather than an orphaned custom hostname
 * nobody knows about. The unique index on hostname is what stops two shops
 * claiming the same domain — a routing ambiguity we must never have to resolve
 * at request time.
 */
export async function addDomain(
  db: D1Database,
  config: DomainConfig,
  opts: { orgId: string; hostname: string; userId?: string | null }
): Promise<CustomDomain> {
  const taken = await first<{ org_id: string }>(
    db,
    `SELECT org_id FROM custom_domains WHERE hostname = ? AND status <> 'removed'`,
    opts.hostname
  );
  if (taken) {
    throw new DomainError(
      taken.org_id === opts.orgId
        ? "You've already added that domain."
        : "That domain is already in use by another shop. If it's yours, get in touch and we'll sort it out."
    );
  }

  const id = newId("customDomain");
  await run(
    db,
    `INSERT INTO custom_domains (id, org_id, hostname, status, cname_target, created_by)
     VALUES (?, ?, ?, 'pending', ?, ?)`,
    id,
    opts.orgId,
    opts.hostname,
    config.cnameTarget,
    opts.userId ?? null
  );

  try {
    const created = await cf<CfCustomHostname>(config, "POST", "/custom_hostnames", {
      hostname: opts.hostname,
      ssl: {
        method: "http",
        type: "dv",
        settings: { min_tls_version: "1.2" },
      },
    });

    await run(
      db,
      `UPDATE custom_domains
          SET cf_hostname_id = ?, status = ?, ssl_status = ?,
              verification_txt_name = ?, verification_txt_value = ?,
              last_checked_at = datetime('now'), updated_at = datetime('now')
        WHERE id = ?`,
      created.id,
      deriveDomainStatus(created),
      created.ssl?.status ?? null,
      created.ownership_verification?.name ?? null,
      created.ownership_verification?.value ?? null,
      id
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Cloudflare refused that domain.";
    await run(
      db,
      `UPDATE custom_domains SET status = 'failed', last_error = ?, updated_at = datetime('now')
        WHERE id = ?`,
      message,
      id
    );
    throw new DomainError(message);
  }

  const domain = await first<CustomDomain>(db, `SELECT * FROM custom_domains WHERE id = ?`, id);
  if (!domain) throw new DomainError("The domain record vanished immediately after being written.");
  return domain;
}

/**
 * Ask Cloudflare where a domain has got to.
 *
 * Called when a shop opens the screen and from the daily cron, because a shop
 * that added a CNAME on Tuesday evening shouldn't have to come back and press
 * a button to find out it worked.
 */
export async function refreshDomain(
  db: D1Database,
  config: DomainConfig,
  domain: CustomDomain
): Promise<CustomDomain> {
  if (!domain.cf_hostname_id) return domain;

  try {
    const current = await cf<CfCustomHostname>(
      config,
      "GET",
      `/custom_hostnames/${domain.cf_hostname_id}`
    );

    const status = deriveDomainStatus(current);
    const error =
      current.ssl?.validation_errors?.map((e) => e.message).join("; ") ||
      current.verification_errors?.join("; ") ||
      null;

    await run(
      db,
      `UPDATE custom_domains
          SET status = ?, ssl_status = ?, last_error = ?,
              verification_txt_name = COALESCE(?, verification_txt_name),
              verification_txt_value = COALESCE(?, verification_txt_value),
              verified_at = CASE WHEN ? = 'active' AND verified_at IS NULL
                                 THEN datetime('now') ELSE verified_at END,
              last_checked_at = datetime('now'), updated_at = datetime('now')
        WHERE id = ?`,
      status,
      current.ssl?.status ?? null,
      error,
      current.ownership_verification?.name ?? null,
      current.ownership_verification?.value ?? null,
      status,
      domain.id
    );
  } catch (err) {
    // A failed check is not a failed domain. Record why and leave the status
    // alone — Cloudflare being briefly unreachable must not take a shop's
    // working website offline in our own records.
    await run(
      db,
      `UPDATE custom_domains SET last_error = ?, last_checked_at = datetime('now')
        WHERE id = ?`,
      err instanceof Error ? err.message : "Could not reach Cloudflare",
      domain.id
    );
  }

  const fresh = await first<CustomDomain>(
    db,
    `SELECT * FROM custom_domains WHERE id = ?`,
    domain.id
  );
  return fresh ?? domain;
}

/** Remove a domain, at Cloudflare and here. */
export async function removeDomain(
  db: D1Database,
  config: DomainConfig | null,
  orgId: string,
  domainId: string
): Promise<void> {
  const domain = await first<CustomDomain>(
    db,
    `SELECT * FROM custom_domains WHERE id = ? AND org_id = ?`,
    domainId,
    orgId
  );
  if (!domain) return;

  if (config && domain.cf_hostname_id) {
    // Best effort. A hostname left behind at Cloudflare is untidy; a shop
    // unable to remove a domain from its own screen is worse.
    await cf(config, "DELETE", `/custom_hostnames/${domain.cf_hostname_id}`).catch(() => {});
  }

  await run(
    db,
    `UPDATE custom_domains SET status = 'removed', updated_at = datetime('now')
      WHERE id = ? AND org_id = ?`,
    domainId,
    orgId
  );
}

/** Domains still waiting, for the cron to chase. */
export async function pendingDomains(db: D1Database, limit = 50): Promise<CustomDomain[]> {
  return all<CustomDomain>(
    db,
    `SELECT * FROM custom_domains
      WHERE status IN ('pending','verifying') AND cf_hostname_id IS NOT NULL
      ORDER BY last_checked_at IS NULL DESC, last_checked_at
      LIMIT ?`,
    limit
  );
}
