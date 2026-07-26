import { Link, redirect } from "react-router";
import type { Route } from "./+types/stripe.return";
import { requireRole } from "../lib/auth";
import { envFrom } from "../lib/env";
import { Card, LinkButton, Notice } from "../components/ui";
import {
  getAccount,
  retrieveAccount,
  statusExplanation,
  syncAccount,
} from "../lib/stripe/connect";

export function meta() {
  return [{ title: "Payments setup | ThriftOS" }];
}

/**
 * Where Stripe sends a shop back after onboarding.
 *
 * Landing here proves nothing — a shop can reach this URL by closing a tab
 * halfway through. So we fetch the account and read its real capabilities
 * rather than assuming success from the redirect.
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  const env = envFrom(context);
  const user = await requireRole(request, env.DB, "admin");

  const record = await getAccount(env.DB, user.orgId);
  if (!record) throw redirect("/app/settings?payments=none");

  if (!env.STRIPE_SECRET_KEY) {
    return { status: record.status, explanation: statusExplanation(record.status), stale: true };
  }

  const account = await retrieveAccount(
    { secretKey: env.STRIPE_SECRET_KEY },
    record.stripeAccountId
  );
  const updated = await syncAccount(env.DB, user.orgId, account);

  return {
    status: updated.status,
    explanation: statusExplanation(updated.status),
    currentlyDue: updated.currentlyDue,
    stale: false,
  };
}

export default function StripeReturn({ loaderData }: Route.ComponentProps) {
  const { status, explanation, currentlyDue = [] } = loaderData;

  return (
    <main className="mx-auto max-w-lg px-6 py-20">
      <Card>
        <h1 className="font-display text-2xl text-bark">{explanation.headline}</h1>
        <p className="mt-2 leading-relaxed text-slate-soft">{explanation.detail}</p>

        {currentlyDue.length > 0 ? (
          <div className="mt-4">
            <Notice tone="warn">
              Stripe still needs: {currentlyDue.slice(0, 5).join(", ")}
              {currentlyDue.length > 5 ? `, and ${currentlyDue.length - 5} more` : ""}.
            </Notice>
          </div>
        ) : null}

        <div className="mt-6 flex flex-wrap gap-3">
          <LinkButton to="/app/settings">Back to settings</LinkButton>
          {status !== "enabled" ? (
            <LinkButton to="/app/settings#payments" variant="secondary">
              Finish setting up
            </LinkButton>
          ) : null}
        </div>

        <p className="mt-6 border-t border-line pt-4 text-xs leading-relaxed text-slate-soft">
          Cash sales work regardless of any of this. Nothing about your register depends
          on Stripe being finished.
        </p>
      </Card>
    </main>
  );
}
