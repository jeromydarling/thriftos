import { redirect } from "react-router";
import type { Route } from "./+types/demo";
import { createSession, sessionCookie } from "../lib/auth";
import { first, run } from "../lib/db";
import { newId } from "../lib/ids";
import { DEMO_EMAIL, ensureDemoSeeded } from "../lib/seed";
import { envFrom } from "../lib/env";

/**
 * Auto-login to the demo shop.
 *
 * It self-heals on the way in: if the demo has been emptied or never seeded,
 * it's rebuilt before the visitor sees a thing. An empty demo is worse than no
 * demo at all, and this is the page most first-time visitors land on.
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  const env = envFrom(context);

  // A rebuild that fails must not reach a visitor as "Unexpected Server
  // Error". This is the link in our own marketing copy, so it gets a sentence
  // a person can read — and the reason goes into system_runs, where the same
  // failure from the nightly cron is already recorded, rather than into a log
  // nobody reads.
  try {
    await ensureDemoSeeded(env);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("demo rebuild failed:", message);
    await run(
      env.DB,
      `INSERT INTO system_runs (id, job, status, error) VALUES (?, 'demo_rebuild', 'error', ?)`,
      newId("run"),
      message
    ).catch(() => {});

    throw new Response(
      "The demo shop is being rebuilt and isn't ready yet. Try again in a few minutes — everything else works.",
      { status: 503 }
    );
  }

  const user = await first<{ id: string; org_id: string }>(
    env.DB,
    `SELECT id, org_id FROM users WHERE email = ? LIMIT 1`,
    DEMO_EMAIL
  );

  if (!user) {
    throw new Response("The demo shop is being rebuilt — try again in a moment.", {
      status: 503,
    });
  }

  const token = await createSession(env.DB, user.id, user.org_id);
  const secure = new URL(request.url).protocol === "https:";

  return redirect("/app", {
    headers: { "Set-Cookie": sessionCookie(token, secure) },
  });
}
