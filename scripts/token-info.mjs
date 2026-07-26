/**
 * Say which Cloudflare token this is, and what it can do.
 *
 * Cloudflare's answer to a token missing a permission is a bare
 * "Authentication error" that names neither the token nor the permission. If
 * nobody remembers creating the token — which is the usual case for one that
 * has been sitting in a repository secret doing its job — that is not enough
 * to act on.
 *
 * Prints the token's name, id, status, expiry and permission groups. Never any
 * part of the credential: everything here is metadata you could read off the
 * dashboard once you know which row to look at, which is the point.
 *
 *   CLOUDFLARE_API_TOKEN=... node scripts/token-info.mjs
 */
const API = "https://api.cloudflare.com/client/v4";
const token = process.env.CLOUDFLARE_API_TOKEN;

if (!token) {
  console.error("CLOUDFLARE_API_TOKEN is not set.");
  process.exit(1);
}

async function cf(path) {
  const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok && body.success, status: res.status, body };
}

const verify = await cf("/user/tokens/verify");
if (!verify.ok) {
  console.error(
    `The token did not verify (${verify.status}): ` +
      (verify.body.errors?.map((e) => e.message).join("; ") ?? "no detail")
  );
  process.exit(1);
}

const { id, status, expires_on } = verify.body.result;
console.log(`Token id      ${id}`);
console.log(`Status        ${status}`);
console.log(`Expires       ${expires_on ?? "never"}`);

// Whether this is readable depends on what the token itself may read. A token
// scoped only to Workers cannot describe itself, which is normal — the id
// above is still enough to find the right row in the dashboard.
const detail = await cf(`/user/tokens/${id}`);
if (detail.ok) {
  const t = detail.body.result;
  console.log(`Name          ${t.name}`);
  console.log(`Created       ${t.issued_on ?? "unknown"}`);
  console.log(`\nPermissions:`);
  for (const policy of t.policies ?? []) {
    const scopes = Object.keys(policy.resources ?? {}).join(", ");
    for (const group of policy.permission_groups ?? []) {
      console.log(`  ${policy.effect === "allow" ? "✓" : "✗"} ${group.name}   [${scopes}]`);
    }
  }
} else {
  console.log(
    `\nName and permissions aren't readable with this token — it isn't allowed ` +
      `to describe itself, which is normal for a narrowly scoped one. ` +
      `Find it by the id above under My Profile → API Tokens, or under ` +
      `Manage Account → API Tokens if it belongs to the account rather than a user.`
  );
}

const accounts = await cf("/accounts");
if (accounts.ok) {
  console.log(`\nAccounts it can see:`);
  for (const a of accounts.body.result) console.log(`  ${a.name}   ${a.id}`);
}
