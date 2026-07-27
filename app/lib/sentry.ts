/**
 * Telling us when something broke, without telling us anything about anyone.
 *
 * This is a hand-written envelope rather than `@sentry/cloudflare`. The trade
 * is deliberate and worth stating: no dependency, nothing added to a Worker
 * bundle that is already large, no build step, no second auth token — against
 * no automatic breadcrumbs, no tracing, and stack frames that aren't mapped
 * back through the bundler. For "a shop hit a 500 and we should know", that's
 * the right side of the trade. If we ever want traces, the SDK replaces this
 * file and nothing else has to move, because everything upstream only ever
 * calls `reportError` and only ever gets back an id.
 *
 * Two rules the whole file exists to keep:
 *
 *   It never throws. A reporter that can break the thing it's reporting on is
 *   worse than no reporter. Every path here is wrapped, and a bad DSN, a dead
 *   network or a malformed error all end the same way — silently.
 *
 *   It never sends anything private. No headers (the session cookie lives
 *   there), no bodies, no query strings (tokens live there), no names, no
 *   email addresses. A path, a method, an org id and the error itself. If a
 *   field isn't on that list it isn't sent, and adding one is a decision
 *   somebody should have to make on purpose.
 *
 * The event id is generated here rather than taken from Sentry's reply, so the
 * caller gets it immediately and the send can happen after the response has
 * gone out. That id is what turns "something went wrong" on a shop's screen
 * into a specific thing we can open.
 */
import type { AppEnv } from "./env";

export interface Dsn {
  host: string;
  projectId: string;
  publicKey: string;
}

/** `https://<key>@<host>/<projectId>`, or null if it isn't one. */
export function parseDsn(dsn: string | undefined): Dsn | null {
  if (!dsn) return null;
  try {
    const url = new URL(dsn);
    const projectId = url.pathname.replace(/^\//, "");
    if (!url.username || !url.host || !projectId) return null;
    return { host: url.host, projectId, publicKey: url.username };
  } catch {
    return null;
  }
}

export function envelopeUrl(dsn: Dsn): string {
  return `https://${dsn.host}/api/${dsn.projectId}/envelope/?sentry_key=${dsn.publicKey}&sentry_version=7`;
}

/** 32 hex characters, which is the only shape Sentry accepts. */
export function newEventId(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

interface Frame {
  filename: string;
  function: string;
  lineno?: number;
  colno?: number;
}

/**
 * Turn a V8 stack string into frames.
 *
 * Unmapped, so the filenames are bundle chunks. Still worth doing: a list of
 * function names in order is the difference between an issue you can start
 * reading and a wall of text.
 */
export function stackFrames(stack: string | undefined): Frame[] {
  if (!stack) return [];

  const frames: Frame[] = [];
  for (const line of stack.split("\n")) {
    const match = /^\s*at\s+(?:(.+?)\s+\()?([^()\s]+?):(\d+):(\d+)\)?\s*$/.exec(line);
    if (!match) continue;
    frames.push({
      function: match[1] ?? "<anonymous>",
      filename: match[2],
      lineno: Number(match[3]),
      colno: Number(match[4]),
    });
  }

  // Sentry draws oldest first and puts the crash at the bottom; V8 hands them
  // over the other way round.
  return frames.reverse();
}

export interface ErrorContext {
  /** What was being served. Path only — a query string can carry a token. */
  path?: string;
  method?: string;
  /** Which shop, so a fault that only affects one is visible as one. */
  orgId?: string;
  /** Free-form, and *not* a place for anything a person typed. */
  tags?: Record<string, string>;
}

export function buildEvent(
  err: unknown,
  context: ErrorContext,
  eventId: string,
  now: number
): Record<string, unknown> {
  const error = err instanceof Error ? err : new Error(String(err));

  return {
    event_id: eventId,
    timestamp: now / 1000,
    platform: "javascript",
    level: "error",
    logger: "thriftos",
    environment: "production",
    exception: {
      values: [
        {
          type: error.name || "Error",
          value: error.message || String(err),
          stacktrace: { frames: stackFrames(error.stack) },
        },
      ],
    },
    // Not `user`, deliberately. Sentry's user object is where names and email
    // addresses go, and none of that belongs here — the org id is enough to
    // tell "every shop" from "one shop", which is the only question we ask.
    tags: {
      ...context.tags,
      ...(context.orgId ? { org: context.orgId } : {}),
      ...(context.method ? { method: context.method } : {}),
    },
    request: context.path ? { url: context.path, method: context.method } : undefined,
  };
}

function envelope(event: Record<string, unknown>, eventId: string, sentAt: string): string {
  return (
    `${JSON.stringify({ event_id: eventId, sent_at: sentAt })}\n` +
    `${JSON.stringify({ type: "event" })}\n` +
    `${JSON.stringify(event)}\n`
  );
}

/**
 * Report it, and hand back the id.
 *
 * Returns null when there's no DSN — which is the normal state of a local
 * checkout, and must be a no-op rather than a warning nobody can act on.
 *
 * The send is handed to `waitUntil` when there's a context to hand it to, so
 * nobody waits on Sentry to find out their save failed.
 */
export function reportError(
  env: AppEnv,
  err: unknown,
  context: ErrorContext = {},
  ctx?: { waitUntil(promise: Promise<unknown>): void }
): string | null {
  const dsn = parseDsn(env.SENTRY_DSN);
  if (!dsn) return null;

  try {
    const eventId = newEventId();
    const now = Date.now();
    const body = envelope(buildEvent(err, context, eventId, now), eventId, new Date(now).toISOString());

    const send = fetch(envelopeUrl(dsn), {
      method: "POST",
      headers: { "content-type": "application/x-sentry-envelope" },
      body,
    })
      .then(() => undefined)
      // Swallowed on purpose. There is nothing useful to do when the thing
      // that reports failures fails, and rethrowing here would turn a handled
      // error into an unhandled one.
      .catch(() => undefined);

    if (ctx) ctx.waitUntil(send);
    return eventId;
  } catch {
    return null;
  }
}
