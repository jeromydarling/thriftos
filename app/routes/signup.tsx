import { Form, Link, redirect, useNavigation } from "react-router";
import type { Route } from "./+types/signup";
import { createSession, createUser, getUser, sessionCookie } from "../lib/auth";
import { batch, first } from "../lib/db";
import { newId, slugify } from "../lib/ids";
import { DEFAULT_MARKDOWN_RULES } from "../lib/markdown";
import { Button, Card, Field, Input, Notice } from "../components/ui";
import { marketingMeta } from "../lib/seo";
import { ctxFrom, envFrom } from "../lib/env";
import { sendEmail, welcomeEmail } from "../lib/email";

export function meta() {
  return marketingMeta({
    title: "Set up your shop",
    description:
      "Set up a ThriftOS shop in about a minute. No card, no sales call, no setup fee.",
    path: "/signup",
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

  const shopName = String(form.get("shop_name") ?? "").trim();
  const name = String(form.get("name") ?? "").trim();
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");

  if (!shopName || !name || !email || !password) {
    return { error: "We need your shop's name, your name, an email, and a password. That's all." };
  }
  if (password.length < 10) {
    return { error: "Passwords need to be at least 10 characters — it's the one thing worth fussing over." };
  }

  const taken = await first<{ id: string }>(
    env.DB,
    `SELECT id FROM users WHERE email = ? LIMIT 1`,
    email
  );
  if (taken) {
    return { error: "That email is already set up. Try signing in instead?" };
  }

  // Slugs must be unique; walk a suffix rather than failing the signup.
  let slug = slugify(shopName) || "shop";
  for (let i = 0; i < 40; i++) {
    const clash = await first<{ id: string }>(env.DB, `SELECT id FROM orgs WHERE slug = ?`, slug);
    if (!clash) break;
    slug = `${slugify(shopName)}-${i + 2}`;
  }

  const orgId = newId("org");
  const locationId = newId("location");

  await batch(env.DB, [
    env.DB.prepare(
      `INSERT INTO orgs (id, slug, name, email, plan) VALUES (?, ?, ?, ?, 'stall')`
    ).bind(orgId, slug, shopName, email),
    env.DB.prepare(
      `INSERT INTO locations (id, org_id, name, kind, is_default) VALUES (?, ?, 'Sales floor', 'salesfloor', 1)`
    ).bind(locationId, orgId),
    // Ship the default rotation so markdown works from day one, editable at once.
    ...DEFAULT_MARKDOWN_RULES.map((rule) =>
      env.DB.prepare(
        `INSERT INTO markdown_rules (id, org_id, tag_color, week_index, discount_pct, age_days)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).bind(newId("markdownRule"), orgId, rule.tagColor, rule.weekIndex, rule.discountPct, rule.ageDays)
    ),
  ]);

  const userId = await createUser(env.DB, {
    orgId,
    email,
    name,
    password,
    role: "owner",
  });

  const token = await createSession(env.DB, userId, orgId);
  const secure = new URL(request.url).protocol === "https:";

  const welcome = welcomeEmail({ orgName: shopName, name, appUrl: env.APP_URL });
  ctxFrom(context).waitUntil(
    sendEmail(env, {
      orgId,
      to: email,
      template: "welcome",
      subject: welcome.subject,
      html: welcome.html,
      text: welcome.text,
    })
  );

  return redirect("/app", { headers: { "Set-Cookie": sessionCookie(token, secure) } });
}

export default function Signup({ actionData }: Route.ComponentProps) {
  const navigation = useNavigation();
  const busy = navigation.state === "submitting";

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-16">
      <Link to="/" className="mb-8 text-center font-display text-2xl text-moss">
        ThriftOS
      </Link>

      <Card>
        <h1 className="font-display text-2xl text-bark">Set up your shop</h1>
        <p className="mt-1.5 text-sm leading-relaxed text-slate-soft">
          About a minute. No card, no sales call. You can log your first item straight after.
        </p>

        <Form method="post" className="mt-6 space-y-4">
          <Field label="Shop name" name="shop_name">
            <Input id="shop_name" name="shop_name" required placeholder="Second Chances Thrift" />
          </Field>

          <Field label="Your name" name="name">
            <Input id="name" name="name" required autoComplete="name" />
          </Field>

          <Field label="Email" name="email">
            <Input id="email" name="email" type="email" required autoComplete="email" />
          </Field>

          <Field label="Password" name="password" hint="At least 10 characters.">
            <Input
              id="password"
              name="password"
              type="password"
              required
              minLength={10}
              autoComplete="new-password"
            />
          </Field>

          {actionData?.error ? <Notice tone="warn">{actionData.error}</Notice> : null}

          <Button type="submit" disabled={busy} className="w-full">
            {busy ? "Setting things up…" : "Set up my shop"}
          </Button>
        </Form>

        <p className="mt-6 border-t border-line pt-4 text-center text-sm text-slate-soft">
          Already set up?{" "}
          <Link to="/login" className="font-medium text-moss underline underline-offset-2">
            Sign in
          </Link>
        </p>
      </Card>
    </main>
  );
}
