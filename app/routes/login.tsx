import { Form, Link, redirect, useNavigation } from "react-router";
import type { Route } from "./+types/login";
import { createSession, getUser, sessionCookie, verifyPassword } from "../lib/auth";
import { first, run } from "../lib/db";
import { clientIp, clearAttempts, LIMITS, rateLimit, recordAttempt } from "../lib/ratelimit";
import { Button, Card, Field, Input, Notice } from "../components/ui";
import { marketingMeta } from "../lib/seo";
import { envFrom } from "../lib/env";

export function meta() {
  return marketingMeta({
    title: "Sign in",
    description: "Sign in to your ThriftOS shop.",
    path: "/login",
    noindex: true,
  });
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = envFrom(context);
  const user = await getUser(request, env.DB);
  if (user) throw redirect("/app");
  return null;
}

export async function action({ request, context }: Route.ActionArgs) {
  const env = envFrom(context);
  const form = await request.formData();
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  const next = String(form.get("next") ?? "/app");

  if (!email || !password) {
    return { error: "We need your email and password to sign you in." };
  }

  // Per-IP + email. Only failures count — typing your own password correctly
  // forty times in a day is not suspicious behaviour.
  const key = `login:${clientIp(request)}:${email}`;
  const limit = await rateLimit(env.KV, key, LIMITS.login);
  if (!limit.allowed) {
    return {
      error: `That's a few too many tries. Give it ${Math.ceil(limit.retryAfterSeconds / 60)} minutes and try again.`,
    };
  }

  const user = await first<{
    id: string;
    org_id: string;
    password_hash: string | null;
    password_salt: string | null;
    status: string;
  }>(
    env.DB,
    `SELECT id, org_id, password_hash, password_salt, status FROM users WHERE email = ? LIMIT 1`,
    email
  );

  const ok =
    user?.password_hash && user.password_salt
      ? await verifyPassword(password, user.password_hash, user.password_salt)
      : false;

  if (!user || !ok || user.status !== "active") {
    await recordAttempt(env.KV, key, LIMITS.login);
    // Same message either way — never confirm whether an account exists.
    return { error: "That email and password don't match. Have another go?" };
  }

  await clearAttempts(env.KV, key, LIMITS.login);
  await run(env.DB, `UPDATE users SET last_login_at = datetime('now') WHERE id = ?`, user.id);

  const token = await createSession(env.DB, user.id, user.org_id);
  const secure = new URL(request.url).protocol === "https:";

  return redirect(next.startsWith("/") ? next : "/app", {
    headers: { "Set-Cookie": sessionCookie(token, secure) },
  });
}

export default function Login({ actionData }: Route.ComponentProps) {
  const navigation = useNavigation();
  const busy = navigation.state === "submitting";

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-16">
      <Link to="/" className="mb-8 text-center font-display text-2xl text-moss">
        ThriftOS
      </Link>

      <Card>
        <h1 className="font-display text-2xl text-bark">Welcome back</h1>
        <p className="mt-1.5 text-sm text-slate-soft">Sign in to your shop.</p>

        <Form method="post" className="mt-6 space-y-4">
          <input type="hidden" name="next" value="/app" />

          <Field label="Email" name="email">
            <Input id="email" name="email" type="email" autoComplete="email" required />
          </Field>

          <Field label="Password" name="password">
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </Field>

          {actionData?.error ? <Notice tone="warn">{actionData.error}</Notice> : null}

          <Button type="submit" disabled={busy} className="w-full">
            {busy ? "Signing you in…" : "Sign in"}
          </Button>
        </Form>

        <p className="mt-6 border-t border-line pt-4 text-center text-sm text-slate-soft">
          No account yet?{" "}
          <Link to="/signup" className="font-medium text-moss underline underline-offset-2">
            Set up your shop
          </Link>
        </p>
        <p className="mt-2 text-center text-sm text-slate-soft">
          Or{" "}
          <Link to="/demo" className="font-medium text-moss underline underline-offset-2">
            look around the demo shop
          </Link>{" "}
          — no signup, nothing to undo.
        </p>
      </Card>
    </main>
  );
}
