/**
 * Auth — PBKDF2 password hashing, opaque session cookies, tenant-scoped roles.
 *
 * Passwords are salted and hashed with PBKDF2 via WebCrypto and are never
 * reversible. Session tokens are opaque and live in an HttpOnly/Secure/SameSite
 * cookie. `requireUser` is memoized per request so a loader with six parallel
 * reads still only resolves the session once.
 */
import { first, run } from "./db";
import { newId, newToken } from "./ids";

/**
 * The most PBKDF2 iterations Workers' WebCrypto will perform.
 *
 * This is a hard platform ceiling, not a tuning choice:
 *
 *   Pbkdf2 failed: iteration counts above 100000 are not supported
 *
 * It is enforced only on Workers. Node — which is what the local dev server
 * and the tests run on — happily does any number, so a value above this
 * passes every check on a laptop and then makes signup, login, password
 * reset, and the demo shop all throw in production. It did exactly that.
 * app/lib/auth.test.ts fails the build if this is raised again.
 */
export const PBKDF2_MAX_ITERATIONS = 100_000;

const PBKDF2_ITERATIONS = PBKDF2_MAX_ITERATIONS;
const SESSION_DAYS = 30;
export const SESSION_COOKIE = "tos_session";

export type Role = "owner" | "admin" | "staff" | "volunteer";

/** Roles in descending authority. A role satisfies any requirement at or below it. */
const ROLE_RANK: Record<Role, number> = {
  owner: 4,
  admin: 3,
  staff: 2,
  volunteer: 1,
};

export function roleAtLeast(role: string, required: Role): boolean {
  const have = ROLE_RANK[role as Role] ?? 0;
  return have >= ROLE_RANK[required];
}

export interface SessionUser {
  id: string;
  orgId: string;
  email: string;
  name: string;
  role: Role;
  orgName: string;
  orgSlug: string;
  isDemo: boolean;
}

/* ─── Password hashing ──────────────────────────────────────────────────── */

/** The scheme tag stored alongside every hash. */
const SCHEME = "pbkdf2-sha256";

/**
 * What an unlabelled hash was made with.
 *
 * Hashes written before the stored format carried its own parameters. Kept so
 * those accounts can still sign in wherever the platform can compute them,
 * which is the whole reason the parameters are stored now.
 */
const LEGACY_ITERATIONS = 210_000;

async function derive(password: string, saltHex: string, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: hexToBytes(saltHex), iterations, hash: "SHA-256" },
    key,
    256
  );
  return bytesToHex(new Uint8Array(bits));
}

/**
 * Hash a password, storing the parameters with it.
 *
 * `pbkdf2-sha256$100000$<hex>` rather than a bare digest, so the iteration
 * count can ever be changed again without every existing account being locked
 * out — the verifier reads what a hash was made with instead of assuming.
 */
export async function hashPassword(
  password: string,
  saltHex?: string
): Promise<{ hash: string; salt: string }> {
  const salt = saltHex ?? newToken(16);
  const digest = await derive(password, salt, PBKDF2_ITERATIONS);
  return { hash: `${SCHEME}$${PBKDF2_ITERATIONS}$${digest}`, salt };
}

function storedParams(stored: string): { iterations: number; digest: string } | null {
  if (!stored.startsWith(`${SCHEME}$`)) {
    return { iterations: LEGACY_ITERATIONS, digest: stored };
  }
  const [, rawIterations, digest] = stored.split("$");
  const iterations = Number(rawIterations);
  if (!Number.isInteger(iterations) || iterations <= 0 || !digest) return null;
  return { iterations, digest };
}

export async function verifyPassword(
  password: string,
  hash: string,
  salt: string
): Promise<boolean> {
  const params = storedParams(hash);
  if (!params) return false;

  try {
    const candidate = await derive(password, salt, params.iterations);
    return timingSafeEqual(candidate, params.digest);
  } catch (err) {
    // A hash this platform can no longer compute is not a match. Failing
    // closed is the only safe answer, but it is indistinguishable from a wrong
    // password to the person typing, so it must be visible to us.
    console.error("password verification could not run:", err instanceof Error ? err.message : err);
    return false;
  }
}

/** Constant-time compare so a wrong password leaks nothing through timing. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Tokens (invites, resets) are stored hashed at rest — a DB leak grants nothing. */
export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return bytesToHex(new Uint8Array(digest));
}

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(hex.length / 2));
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/* ─── Sessions ──────────────────────────────────────────────────────────── */

export async function createSession(
  db: D1Database,
  userId: string,
  orgId: string
): Promise<string> {
  const token = newToken(32);
  const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000).toISOString();
  await run(
    db,
    `INSERT INTO sessions (token, user_id, org_id, expires_at) VALUES (?, ?, ?, ?)`,
    token,
    userId,
    orgId,
    expires
  );
  return token;
}

export function sessionCookie(token: string, secure = true): string {
  const parts = [
    `${SESSION_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${SESSION_DAYS * 86_400}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export function readSessionToken(request: Request): string | null {
  const header = request.headers.get("Cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === SESSION_COOKIE) return rest.join("=") || null;
  }
  return null;
}

/**
 * Memoized per request. A loader that calls this five times in a Promise.all
 * still costs one query.
 */
const requestCache = new WeakMap<Request, Promise<SessionUser | null>>();

export function getUser(request: Request, db: D1Database): Promise<SessionUser | null> {
  const cached = requestCache.get(request);
  if (cached) return cached;

  const promise = (async (): Promise<SessionUser | null> => {
    const token = readSessionToken(request);
    if (!token) return null;

    const row = await first<{
      id: string;
      org_id: string;
      email: string;
      name: string;
      role: string;
      status: string;
      org_name: string;
      org_slug: string;
      is_demo: number;
      expires_at: string;
    }>(
      db,
      `SELECT u.id, u.org_id, u.email, u.name, u.role, u.status,
              o.name AS org_name, o.slug AS org_slug, o.is_demo,
              s.expires_at
         FROM sessions s
         JOIN users u ON u.id = s.user_id
         JOIN orgs  o ON o.id = s.org_id
        WHERE s.token = ?`,
      token
    );

    if (!row) return null;
    if (row.status !== "active") return null;
    if (new Date(row.expires_at).getTime() < Date.now()) return null;

    return {
      id: row.id,
      orgId: row.org_id,
      email: row.email,
      name: row.name,
      role: row.role as Role,
      orgName: row.org_name,
      orgSlug: row.org_slug,
      isDemo: row.is_demo === 1,
    };
  })();

  requestCache.set(request, promise);
  return promise;
}

export async function requireUser(request: Request, db: D1Database): Promise<SessionUser> {
  const user = await getUser(request, db);
  if (!user) {
    const url = new URL(request.url);
    throw new Response(null, {
      status: 302,
      headers: { Location: `/login?next=${encodeURIComponent(url.pathname + url.search)}` },
    });
  }
  return user;
}

export async function requireRole(
  request: Request,
  db: D1Database,
  required: Role
): Promise<SessionUser> {
  const user = await requireUser(request, db);
  if (!roleAtLeast(user.role, required)) {
    throw new Response("You don't have access to this. Ask an owner or admin to help.", {
      status: 403,
    });
  }
  return user;
}

/** Removing a member kills their sessions everywhere, immediately. */
export async function revokeAllSessions(db: D1Database, userId: string): Promise<void> {
  await run(db, `DELETE FROM sessions WHERE user_id = ?`, userId);
}

export async function createUser(
  db: D1Database,
  input: { orgId: string; email: string; name: string; password: string | null; role: Role }
): Promise<string> {
  const id = newId("user");
  const creds = input.password ? await hashPassword(input.password) : null;
  await run(
    db,
    `INSERT INTO users (id, org_id, email, name, password_hash, password_salt, role)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    id,
    input.orgId,
    input.email.toLowerCase().trim(),
    input.name.trim(),
    creds?.hash ?? null,
    creds?.salt ?? null,
    input.role
  );
  return id;
}
