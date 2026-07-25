import { redirect } from "react-router";
import type { Route } from "./+types/demo";
import { createSession, sessionCookie } from "../lib/auth";
import { first } from "../lib/db";
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

  await ensureDemoSeeded(env.DB);

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
