/**
 * A minimal Stripe REST client for Workers.
 *
 * Deliberately not the official SDK: it is Node-shaped, large, and we need
 * perhaps a dozen endpoints. `fetch` against the REST API is smaller, has no
 * bundling surprises in a Worker, and keeps the request shape visible.
 *
 * Two rules this file exists to hold:
 *   • The secret key never leaves the server. There is no client-side path here.
 *   • Every mutating call takes an idempotency key. Stripe will then collapse a
 *     retry into the original request rather than charging twice, which matters
 *     because a Worker can be retried for reasons that have nothing to do with us.
 */

export interface StripeConfig {
  secretKey: string;
  /** Act on behalf of a connected account (the Stripe-Account header). */
  stripeAccount?: string;
}

export class StripeError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly type?: string
  ) {
    super(message);
    this.name = "StripeError";
  }

  /** True where retrying the identical request might succeed. */
  get isRetryable(): boolean {
    return this.status >= 500 || this.status === 429;
  }
}

const API = "https://api.stripe.com/v1";

/**
 * Stripe takes form-encoded bodies with bracket notation for nested values.
 * Flattening here rather than at each call site keeps the callers readable.
 */
export function toFormBody(
  data: Record<string, unknown>,
  prefix = ""
): URLSearchParams {
  const params = new URLSearchParams();

  const append = (key: string, value: unknown) => {
    if (value === undefined || value === null) return;

    if (Array.isArray(value)) {
      value.forEach((entry, i) => append(`${key}[${i}]`, entry));
      return;
    }
    if (typeof value === "object") {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        append(`${key}[${k}]`, v);
      }
      return;
    }
    params.append(key, String(value));
  };

  for (const [key, value] of Object.entries(data)) {
    append(prefix ? `${prefix}[${key}]` : key, value);
  }

  return params;
}

export async function stripeRequest<T>(
  config: StripeConfig,
  method: "GET" | "POST" | "DELETE",
  path: string,
  data?: Record<string, unknown>,
  idempotencyKey?: string
): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.secretKey}`,
    "Content-Type": "application/x-www-form-urlencoded",
    "Stripe-Version": "2026-06-30.basil",
  };

  if (config.stripeAccount) headers["Stripe-Account"] = config.stripeAccount;
  // Only mutating calls need one; sending it on GET is harmless but pointless.
  if (idempotencyKey && method !== "GET") headers["Idempotency-Key"] = idempotencyKey;

  const body = data ? toFormBody(data) : undefined;
  const url = method === "GET" && body ? `${API}${path}?${body}` : `${API}${path}`;

  const res = await fetch(url, {
    method,
    headers,
    body: method === "GET" ? undefined : body,
  });

  const payload = (await res.json().catch(() => ({}))) as {
    error?: { message?: string; code?: string; type?: string };
  };

  if (!res.ok) {
    throw new StripeError(
      payload.error?.message ?? `Stripe returned ${res.status}`,
      res.status,
      payload.error?.code,
      payload.error?.type
    );
  }

  return payload as T;
}

/* ─── Webhook signature verification ────────────────────────────────────── */

/**
 * Verify a Stripe signature against the **raw** body.
 *
 * Parsing the JSON first and re-serialising it will not verify — key order and
 * whitespace change the bytes. The caller must hand us exactly what arrived.
 */
export async function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
  toleranceSeconds = 300,
  now = Math.floor(Date.now() / 1000)
): Promise<{ valid: boolean; reason?: string }> {
  if (!signatureHeader) return { valid: false, reason: "missing signature header" };

  const parts = signatureHeader.split(",").reduce<Record<string, string[]>>((acc, part) => {
    const [k, v] = part.split("=");
    if (!k || !v) return acc;
    (acc[k.trim()] ??= []).push(v.trim());
    return acc;
  }, {});

  const timestamp = parts.t?.[0];
  const signatures = parts.v1 ?? [];

  if (!timestamp) return { valid: false, reason: "no timestamp" };
  if (signatures.length === 0) return { valid: false, reason: "no v1 signature" };

  // Reject replays of an old, validly-signed payload.
  const age = Math.abs(now - Number(timestamp));
  if (!Number.isFinite(age) || age > toleranceSeconds) {
    return { valid: false, reason: "timestamp outside tolerance" };
  }

  const expected = await hmacSha256Hex(secret, `${timestamp}.${rawBody}`);

  // Constant-time compare against each candidate — Stripe sends more than one
  // during a secret rotation.
  const matched = signatures.some((candidate) => timingSafeEqual(candidate, expected));
  return matched ? { valid: true } : { valid: false, reason: "signature mismatch" };
}

async function hmacSha256Hex(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* ─── Configuration guard ───────────────────────────────────────────────── */

export interface StripeReadiness {
  configured: boolean;
  missing: string[];
}

/**
 * What is missing before payment routes may run.
 *
 * Payment routes refuse to operate rather than half-working: a shop that thinks
 * it is taking cards but isn't is far worse off than one told plainly that
 * payments aren't switched on yet.
 */
/**
 * The Stripe credentials, from the environment.
 *
 * Exported so there is one of these rather than a private one-liner per file
 * that calls Stripe — which is how one of them ends up reading a different
 * variable, or forgetting the non-null assertion, and failing only in
 * production where the key is actually set.
 */
export function stripeConfigFrom(env: { STRIPE_SECRET_KEY?: string }): StripeConfig {
  return { secretKey: env.STRIPE_SECRET_KEY ?? "" };
}

export function stripeReadiness(env: {
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_CONNECT_WEBHOOK_SECRET?: string;
}): StripeReadiness {
  const missing: string[] = [];
  if (!env.STRIPE_SECRET_KEY) missing.push("STRIPE_SECRET_KEY");
  if (!env.STRIPE_WEBHOOK_SECRET) missing.push("STRIPE_WEBHOOK_SECRET");
  // A separate Connect endpoint secret is optional; we fall back to the platform
  // one when it isn't set.
  return { configured: missing.length === 0, missing };
}

/** True when the key is a test-mode key. Used to label the UI honestly. */
export function isTestMode(secretKey: string | undefined): boolean {
  return Boolean(secretKey?.startsWith("sk_test_") || secretKey?.startsWith("rk_test_"));
}
