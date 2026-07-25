/**
 * Rate limiting on KV.
 *
 * The one rule that matters: **fail open**. A limiter that breaks must never
 * lock every volunteer out of the register. If KV is unhappy we log and allow.
 */

export interface LimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export interface LimitOptions {
  /** Requests permitted inside the window. */
  limit: number;
  /** Window length in seconds. */
  windowSeconds: number;
}

const ALLOW = (limit: number): LimitResult => ({
  allowed: true,
  remaining: limit,
  retryAfterSeconds: 0,
});

/**
 * Fixed-window counter. Only *failed* attempts should be counted for login —
 * a person typing their password correctly forty times is not an attacker.
 */
export async function rateLimit(
  kv: KVNamespace | undefined,
  key: string,
  opts: LimitOptions
): Promise<LimitResult> {
  if (!kv) return ALLOW(opts.limit);

  const window = Math.floor(Date.now() / 1000 / opts.windowSeconds);
  const bucket = `rl:${key}:${window}`;

  try {
    const raw = await kv.get(bucket);
    const used = raw ? parseInt(raw, 10) || 0 : 0;

    if (used >= opts.limit) {
      const elapsed = Math.floor(Date.now() / 1000) % opts.windowSeconds;
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.max(1, opts.windowSeconds - elapsed),
      };
    }

    return { allowed: true, remaining: opts.limit - used - 1, retryAfterSeconds: 0 };
  } catch (err) {
    console.warn("rateLimit read failed, allowing through:", err);
    return ALLOW(opts.limit);
  }
}

/** Record one attempt against the bucket. Never throws. */
export async function recordAttempt(
  kv: KVNamespace | undefined,
  key: string,
  opts: LimitOptions
): Promise<void> {
  if (!kv) return;
  const window = Math.floor(Date.now() / 1000 / opts.windowSeconds);
  const bucket = `rl:${key}:${window}`;
  try {
    const raw = await kv.get(bucket);
    const used = raw ? parseInt(raw, 10) || 0 : 0;
    await kv.put(bucket, String(used + 1), { expirationTtl: opts.windowSeconds + 60 });
  } catch (err) {
    console.warn("rateLimit write failed, ignoring:", err);
  }
}

/** Clear a bucket after a success, so one bad day doesn't linger. */
export async function clearAttempts(
  kv: KVNamespace | undefined,
  key: string,
  opts: LimitOptions
): Promise<void> {
  if (!kv) return;
  const window = Math.floor(Date.now() / 1000 / opts.windowSeconds);
  try {
    await kv.delete(`rl:${key}:${window}`);
  } catch {
    /* best effort */
  }
}

export const LIMITS = {
  login: { limit: 10, windowSeconds: 900 },
  passwordReset: { limit: 5, windowSeconds: 3600 },
  publicForm: { limit: 8, windowSeconds: 3600 },
  aiIntake: { limit: 120, windowSeconds: 3600 },
  api: { limit: 600, windowSeconds: 60 },
} as const;

export function clientIp(request: Request): string {
  return (
    request.headers.get("CF-Connecting-IP") ??
    request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ??
    "unknown"
  );
}
