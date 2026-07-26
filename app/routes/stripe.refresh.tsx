import { redirect } from "react-router";
import type { Route } from "./+types/stripe.refresh";
import { requireRole } from "../lib/auth";
import { envFrom } from "../lib/env";
import { createOnboardingLink, getAccount } from "../lib/stripe/connect";

/**
 * Stripe sends a shop here when an onboarding link has expired.
 *
 * Account links are single-use and short-lived, so the only correct response is
 * to mint a fresh one and send them straight back — never to show an error for
 * something that is entirely routine.
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  const env = envFrom(context);
  const user = await requireRole(request, env.DB, "admin");

  const record = await getAccount(env.DB, user.orgId);
  if (!record || !env.STRIPE_SECRET_KEY) {
    throw redirect("/app/settings?payments=restart");
  }

  const url = await createOnboardingLink(
    { secretKey: env.STRIPE_SECRET_KEY },
    record.stripeAccountId,
    env.APP_URL
  );

  return redirect(url);
}
