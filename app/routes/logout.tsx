import { redirect } from "react-router";
import type { Route } from "./+types/logout";
import { clearSessionCookie, readSessionToken } from "../lib/auth";
import { run } from "../lib/db";
import { envFrom } from "../lib/env";

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = envFrom(context);
  const token = readSessionToken(request);
  if (token) await run(env.DB, `DELETE FROM sessions WHERE token = ?`, token);
  return redirect("/", { headers: { "Set-Cookie": clearSessionCookie() } });
}

export async function action({ request, context }: Route.ActionArgs) {
  return loader({ request, context } as Route.LoaderArgs);
}
