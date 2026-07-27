/**
 * "This is wrong" and "this should exist", from inside the app.
 *
 * Written for a person standing behind a counter who has thirty seconds and a
 * queue. Everything a bug report normally asks for — which screen, which
 * browser, which shop, which error — the app already knows, so it fills all of
 * it in and the only thing anybody has to do is describe what happened in
 * their own words. A support form that asks a volunteer to reproduce the issue
 * and paste a console log is a support form nobody uses.
 *
 * Stored first, emailed second, and the email is best-effort. A report that
 * exists only as an email is one lost send away from never having happened,
 * and the worst possible outcome here is a shop taking the trouble to tell us
 * something and hearing nothing because a provider key had expired.
 */
import { newId } from "./ids";
import { run } from "./db";
import { sendEmail } from "./email";
import type { AppEnv } from "./env";

export const FEEDBACK_KINDS = [
  {
    id: "bug",
    label: "Something's wrong",
    prompt: "What were you doing, and what happened instead?",
  },
  {
    id: "idea",
    label: "Something's missing",
    prompt: "What would you like to be able to do?",
  },
] as const;

export type FeedbackKind = (typeof FEEDBACK_KINDS)[number]["id"];

export function isFeedbackKind(value: string): value is FeedbackKind {
  return FEEDBACK_KINDS.some((k) => k.id === value);
}

/** Long enough to be worth reading, short enough to fit in an email. */
export const MAX_BODY = 4000;

export class FeedbackError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FeedbackError";
  }
}

export interface FeedbackInput {
  kind: FeedbackKind;
  body: string;
  path?: string;
  eventId?: string;
  userAgent?: string;
}

/**
 * Read a form into a report.
 *
 * The path is reduced to a pathname here rather than trusted as sent: it
 * arrives from a hidden field, and a query string on this app can carry a
 * receipt token or a Stripe return code. Neither belongs in a table people
 * read, or in an email.
 */
export function readFeedbackForm(
  form: { get(name: string): FormDataEntryValue | null },
  userAgent?: string
): FeedbackInput {
  const text = (name: string) => String(form.get(name) ?? "").trim();

  const kindRaw = text("kind");
  const body = text("body").slice(0, MAX_BODY);
  if (!body) throw new FeedbackError("Tell us what happened and we'll look at it.");

  return {
    kind: isFeedbackKind(kindRaw) ? kindRaw : "bug",
    body,
    path: pathOnly(text("path")),
    eventId: text("eventId") || undefined,
    userAgent: userAgent?.slice(0, 300),
  };
}

/** Just the pathname, whatever shape the input was in. */
export function pathOnly(value: string): string | undefined {
  if (!value) return undefined;
  try {
    // Relative paths need a base; the host is thrown away either way.
    return new URL(value, "https://x.invalid").pathname.slice(0, 200);
  } catch {
    return undefined;
  }
}

export interface FeedbackContext {
  orgId: string;
  orgName: string;
  userId: string;
  /** So a reply goes to the person who wrote it, not to a shared inbox. */
  userEmail?: string;
  userName?: string;
}

/** Where reports land. Overridden by EMAIL_FROM's domain in a real setup. */
export const FEEDBACK_INBOX = "hello@thriftos.app";

export function feedbackEmail(
  input: FeedbackInput,
  who: FeedbackContext
): { subject: string; text: string; html: string } {
  const kind = FEEDBACK_KINDS.find((k) => k.id === input.kind);

  const lines = [
    input.body,
    "",
    "—",
    `${kind?.label ?? input.kind} · ${who.orgName}`,
    who.userName ? `From ${who.userName}${who.userEmail ? ` <${who.userEmail}>` : ""}` : null,
    input.path ? `On ${input.path}` : null,
    input.eventId ? `Error reference ${input.eventId}` : null,
    input.userAgent ? input.userAgent : null,
  ].filter(Boolean) as string[];

  const text = lines.join("\n");

  return {
    // The shop's name in the subject, because the first question about any
    // report is always "who is this?".
    subject: `${kind?.label ?? "Feedback"} — ${who.orgName}`,
    text,
    html: `<pre style="font:14px/1.6 ui-monospace,monospace;white-space:pre-wrap">${escapeHtml(text)}</pre>`,
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Save it, then try to send it.
 *
 * The row is written before the email is attempted and the send is never
 * awaited by the caller's critical path — a shop pressing Send should see
 * "got it" the moment it's durable, not when a mail provider gets round to
 * accepting it.
 */
export async function recordFeedback(
  env: AppEnv,
  input: FeedbackInput,
  who: FeedbackContext
): Promise<{ id: string; deliver: () => Promise<void> }> {
  const id = newId("feedback");

  await run(
    env.DB,
    `INSERT INTO feedback (id, org_id, user_id, kind, body, path, event_id, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    who.orgId,
    who.userId,
    input.kind,
    input.body,
    input.path ?? null,
    input.eventId ?? null,
    input.userAgent ?? null
  );

  const deliver = async () => {
    const message = feedbackEmail(input, who);
    const result = await sendEmail(env, {
      orgId: who.orgId,
      to: FEEDBACK_INBOX,
      subject: message.subject,
      html: message.html,
      text: message.text,
      template: "feedback",
      // Reply goes to the person, so a question about their report reaches
      // them rather than a support address they never see.
      replyTo: who.userEmail,
    });
    if (result.sent) {
      await run(env.DB, `UPDATE feedback SET emailed_at = datetime('now') WHERE id = ?`, id);
    }
  };

  return { id, deliver };
}
