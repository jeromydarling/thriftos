/**
 * Where a report lands. No screen of its own — the form lives in the app
 * shell, posts here with a fetcher, and the answer comes back as a toast, so
 * nobody loses the page they were on to tell us something about it.
 */
import type { Route } from "./+types/app.feedback";
import { requireUser } from "../lib/auth";
import { ctxFrom, envFrom } from "../lib/env";
import { FeedbackError, readFeedbackForm, recordFeedback } from "../lib/feedback";
import { failed, ok } from "../lib/toast";

export async function action({ request, context }: Route.ActionArgs) {
  const env = envFrom(context);
  const user = await requireUser(request, env.DB);
  const form = await request.formData();

  try {
    const input = readFeedbackForm(form, request.headers.get("user-agent") ?? undefined);

    const { deliver } = await recordFeedback(env, input, {
      orgId: user.orgId,
      orgName: user.orgName,
      userId: user.id,
      userEmail: user.email,
      userName: user.name,
    });

    // The row is already durable, so the send happens after the answer. A shop
    // shouldn't wait on a mail provider to be told we've got it.
    ctxFrom(context).waitUntil(deliver());

    return ok(
      input.kind === "bug"
        ? "Got it — thank you. We read every one of these."
        : "Got it — thank you. Ideas from shops are where most of this came from."
    );
  } catch (err) {
    if (err instanceof FeedbackError) return failed(err.message);
    // Deliberately not rethrown: somebody trying to report a problem should
    // never be met with a second one.
    console.error("feedback failed:", err);
    return failed(
      "That didn't send, which is embarrassing given what it's for. Email hello@thriftos.app and we'll pick it up there."
    );
  }
}

/** Reached directly, which nobody should do. Bounce them somewhere useful. */
export async function loader() {
  return Response.redirect("/app/help", 302);
}
