/**
 * Email. Fire-and-forget, suppression-aware, and fully functional with no
 * provider key at all — sends become log rows instead of failures.
 */
import { first, run } from "./db";
import { newId } from "./ids";
import type { AppEnv } from "./env";

export interface SendInput {
  orgId: string;
  to: string;
  subject: string;
  template: string;
  html: string;
  text?: string;
  replyTo?: string;
}

/**
 * Never throws. A failed receipt email must not take down the donation that
 * caused it. Callers pass this to `ctx.waitUntil`.
 */
export async function sendEmail(env: AppEnv, input: SendInput): Promise<{ sent: boolean; reason: string }> {
  const to = input.to.trim().toLowerCase();

  if (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
    await logEmail(env, input, "failed", "invalid address");
    return { sent: false, reason: "invalid address" };
  }

  // The suppression list is honoured everywhere, always, with no exceptions.
  const suppressed = await first<{ id: string }>(
    env.DB,
    `SELECT id FROM email_suppressions WHERE org_id = ? AND email = ? LIMIT 1`,
    input.orgId,
    to
  );
  if (suppressed) {
    await logEmail(env, input, "logged", "suppressed");
    return { sent: false, reason: "suppressed" };
  }

  if (!env.RESEND_API_KEY) {
    await logEmail(env, input, "logged", "no provider key");
    return { sent: false, reason: "no provider key" };
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: env.EMAIL_FROM ?? "ThriftOS <hello@thriftos.app>",
        to,
        subject: input.subject,
        html: input.html,
        text: input.text,
        reply_to: input.replyTo,
      }),
    });

    if (!res.ok) {
      // Surface the provider's own words — a vague failure wastes an afternoon.
      const detail = (await res.text()).slice(0, 400);
      await logEmail(env, input, "failed", detail);
      return { sent: false, reason: detail };
    }

    await logEmail(env, input, "sent", null);
    return { sent: true, reason: "sent" };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    await logEmail(env, input, "failed", detail);
    return { sent: false, reason: detail };
  }
}

async function logEmail(
  env: AppEnv,
  input: SendInput,
  status: "sent" | "failed" | "logged",
  error: string | null
): Promise<void> {
  try {
    await run(
      env.DB,
      `INSERT INTO email_log (id, org_id, to_email, template, subject, status, error)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      newId("email"),
      input.orgId,
      input.to.trim().toLowerCase(),
      input.template,
      input.subject,
      status,
      error
    );
  } catch (err) {
    console.warn("email log write failed:", err);
  }
}

export async function suppress(
  db: D1Database,
  orgId: string,
  email: string,
  reason: "unsubscribed" | "bounced" | "complained" = "unsubscribed"
): Promise<void> {
  await run(
    db,
    `INSERT OR IGNORE INTO email_suppressions (id, org_id, email, reason) VALUES (?, ?, ?, ?)`,
    newId("suppression"),
    orgId,
    email.trim().toLowerCase(),
    reason
  );
}

/* ─── Templates ─────────────────────────────────────────────────────────
   Warm, short, and honest. Every one carries a real reply-to and, where it
   isn't transactional, a one-click way out. */

export function layout(orgName: string, body: string, footer?: string): string {
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#F7F5F1;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1F2937;line-height:1.6">
<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:32px">
<p style="margin:0 0 20px;font-weight:600;color:#2F6F5E">${escapeHtml(orgName)}</p>
${body}
</div>
<p style="max-width:560px;margin:16px auto 0;font-size:12px;color:#6B7280;text-align:center">
${footer ?? `Sent by ${escapeHtml(orgName)} using ThriftOS.`}
</p>
</body></html>`;
}

export function donationReceiptEmail(opts: {
  orgName: string;
  donorName: string;
  receiptNumber: string;
  receivedOn: string;
  description: string;
}): { subject: string; html: string; text: string } {
  const subject = `Your donation receipt from ${opts.orgName}`;
  const html = layout(
    opts.orgName,
    `<p>Hello ${escapeHtml(opts.donorName)},</p>
     <p>Thank you — your donation on ${escapeHtml(opts.receivedOn)} is what keeps our shelves full and our doors open.</p>
     <p>Your receipt <strong>${escapeHtml(opts.receiptNumber)}</strong> is attached to your record and describes what you gave:</p>
     <p style="padding:12px 16px;background:#F7F5F1;border-radius:8px">${escapeHtml(opts.description)}</p>
     <p style="font-size:13px;color:#6B7280">We're required to note that no goods or services were provided in exchange for this donation. Assigning a dollar value to donated items is up to you and your tax adviser — we can describe what we received, but we can't value it for you.</p>
     <p>With thanks,<br>${escapeHtml(opts.orgName)}</p>`
  );
  const text = `Hello ${opts.donorName},\n\nThank you for your donation on ${opts.receivedOn}.\nReceipt ${opts.receiptNumber}: ${opts.description}\n\nNo goods or services were provided in exchange for this donation. Valuing donated items is up to you and your tax adviser.\n\n${opts.orgName}`;
  return { subject, html, text };
}

export function welcomeEmail(opts: { orgName: string; name: string; appUrl: string }) {
  return {
    subject: `Welcome to ThriftOS, ${opts.name}`,
    html: layout(
      opts.orgName,
      `<p>Hello ${escapeHtml(opts.name)},</p>
       <p>Your shop is set up and ready. The fastest way to see what ThriftOS does is to photograph one donated item and watch the intake form fill itself in — you correct it rather than type it.</p>
       <p><a href="${escapeHtml(opts.appUrl)}/app/intake" style="display:inline-block;padding:10px 18px;background:#2F6F5E;color:#fff;border-radius:8px;text-decoration:none">Log your first item</a></p>
       <p>If anything is confusing, reply to this email — a person reads it.</p>`
    ),
    text: `Hello ${opts.name},\n\nYour shop is set up. Log your first item: ${opts.appUrl}/app/intake\n\nReply to this email if anything is confusing — a person reads it.`,
  };
}

export function passwordResetEmail(opts: { orgName: string; resetUrl: string }) {
  return {
    subject: "Reset your ThriftOS password",
    html: layout(
      opts.orgName,
      `<p>Someone asked to reset the password on this account. If that was you, here's the link:</p>
       <p><a href="${escapeHtml(opts.resetUrl)}" style="display:inline-block;padding:10px 18px;background:#2F6F5E;color:#fff;border-radius:8px;text-decoration:none">Set a new password</a></p>
       <p style="font-size:13px;color:#6B7280">The link works once and expires in an hour. If this wasn't you, nothing has changed and you can ignore this.</p>`
    ),
    text: `Reset your password: ${opts.resetUrl}\n\nWorks once, expires in an hour. If this wasn't you, nothing has changed.`,
  };
}

export function inviteEmail(opts: { orgName: string; inviterName: string; inviteUrl: string }) {
  return {
    subject: `${opts.inviterName} invited you to help at ${opts.orgName}`,
    html: layout(
      opts.orgName,
      `<p>${escapeHtml(opts.inviterName)} has invited you to join ${escapeHtml(opts.orgName)} on ThriftOS.</p>
       <p>You'll pick your own password — nobody else will know it.</p>
       <p><a href="${escapeHtml(opts.inviteUrl)}" style="display:inline-block;padding:10px 18px;background:#2F6F5E;color:#fff;border-radius:8px;text-decoration:none">Accept the invitation</a></p>`
    ),
    text: `${opts.inviterName} invited you to join ${opts.orgName} on ThriftOS.\n\nAccept: ${opts.inviteUrl}`,
  };
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
