/**
 * Structured logging for the payment paths.
 *
 * The runbook in docs/PAYMENTS.md says to check `stripe_events`,
 * `payment_attempts`, and the ledger by hand when a shop reports "it took the
 * money but didn't record the sale". That works, but it starts from a database
 * rather than from the request that went wrong, and there was no way to get
 * from one to the other.
 *
 * Every line here is a single JSON object on one line, which is what
 * Cloudflare's log pipeline and every log aggregator expect. Fields are named
 * consistently so a search for one transaction id returns the whole story:
 * the quote, the attempt, the Stripe call, the webhook, the ledger write.
 *
 * What must never appear in a log line: a card number, a CVC, a full Stripe
 * secret, a customer's email, or a session token. `redact()` is applied to
 * every value, and the field allowlist below is deliberately short — a log
 * that leaks is worse than no log at all.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

/**
 * The fields worth correlating on. Anything not in here is dropped rather
 * than logged, so a careless caller can't leak a customer record by spreading
 * an object into the context.
 */
export interface LogContext {
  requestId?: string;
  orgId?: string;
  userId?: string;
  transactionId?: string;
  attemptId?: string;
  refundId?: string;
  shiftId?: string;
  /** pi_..., ch_..., re_..., du_..., evt_... */
  stripeObjectId?: string;
  /** acct_... */
  connectedAccountId?: string;
  readerId?: string;
  idempotencyKey?: string;
  eventType?: string;
  /** The state machine move, as "from→to". */
  transition?: string;
  amountCents?: number;
  feeCents?: number;
  outcome?: string;
  durationMs?: number;
  error?: string;
}

const ALLOWED: readonly (keyof LogContext)[] = [
  "requestId",
  "orgId",
  "userId",
  "transactionId",
  "attemptId",
  "refundId",
  "shiftId",
  "stripeObjectId",
  "connectedAccountId",
  "readerId",
  "idempotencyKey",
  "eventType",
  "transition",
  "amountCents",
  "feeCents",
  "outcome",
  "durationMs",
  "error",
];

/**
 * Patterns that must never reach a log, checked on every string value.
 *
 * Belt and braces on top of the allowlist: an error message is free text and
 * can contain anything Stripe decided to put in it.
 */
const SECRETS: readonly RegExp[] = [
  /sk_(live|test)_[A-Za-z0-9]+/g,
  /rk_(live|test)_[A-Za-z0-9]+/g,
  /whsec_[A-Za-z0-9]+/g,
  // Any 13-19 digit run — a card number, however it got there.
  /\b\d{13,19}\b/g,
  // Anything that looks like an email address.
  /\b[^\s@]+@[^\s@]+\.[^\s@]{2,}\b/g,
];

export function redact(value: string): string {
  let out = value;
  for (const pattern of SECRETS) out = out.replace(pattern, "[redacted]");
  return out;
}

/** A correlation id for one request, so its lines can be found together. */
export function newRequestId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 16);
}

function emit(level: LogLevel, message: string, context: LogContext): void {
  const line: Record<string, unknown> = {
    level,
    msg: redact(message),
    at: new Date().toISOString(),
  };

  for (const key of ALLOWED) {
    const value = context[key];
    if (value === undefined || value === null) continue;
    line[key] = typeof value === "string" ? redact(value) : value;
  }

  const serialised = JSON.stringify(line);
  if (level === "error") console.error(serialised);
  else if (level === "warn") console.warn(serialised);
  else console.log(serialised);
}

export const log = {
  debug: (message: string, context: LogContext = {}) => emit("debug", message, context),
  info: (message: string, context: LogContext = {}) => emit("info", message, context),
  warn: (message: string, context: LogContext = {}) => emit("warn", message, context),
  error: (message: string, context: LogContext = {}) => emit("error", message, context),
};

/**
 * A logger with fields pre-bound, so a request handler doesn't repeat itself.
 *
 * Bound fields are merged under per-call ones, so a specific call can add
 * detail but never accidentally overwrite the correlation ids.
 */
export function bindLog(base: LogContext) {
  const merge = (context: LogContext) => ({ ...base, ...context });
  return {
    debug: (message: string, context: LogContext = {}) => log.debug(message, merge(context)),
    info: (message: string, context: LogContext = {}) => log.info(message, merge(context)),
    warn: (message: string, context: LogContext = {}) => log.warn(message, merge(context)),
    error: (message: string, context: LogContext = {}) => log.error(message, merge(context)),
  };
}
