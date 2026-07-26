/**
 * Secrets are Worker secrets — never in code, never in the repo, never in chat.
 * They're declared here as optional so the whole app typechecks and *runs*
 * without a single one of them set. Every integration degrades to a friendly
 * "not switched on yet" rather than a crash.
 *
 * To activate one:  npx wrangler secret put STRIPE_SECRET_KEY
 */
import type { RouterContextProvider } from "react-router";
import { cloudflareContext } from "./cf-context";

export interface AppEnv extends Env {
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  /** Optional: a separate signing secret for the Connect endpoint. */
  STRIPE_CONNECT_WEBHOOK_SECRET?: string;
  STRIPE_PUBLISHABLE_KEY?: string;
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  SENTRY_DSN?: string;
  /** Cloudflare for SaaS, for shops using their own domain. */
  CLOUDFLARE_API_TOKEN?: string;
  CLOUDFLARE_ZONE_ID?: string;
}

export type IntegrationKey = "stripe" | "email" | "ai" | "images";

export interface IntegrationStatus {
  key: IntegrationKey;
  label: string;
  live: boolean;
  /** What the app does while it's dark. Shown verbatim in settings. */
  fallback: string;
  /** The exact one-line command to switch it on. */
  activate: string;
}

export function integrationStatus(env: AppEnv): IntegrationStatus[] {
  return [
    {
      key: "stripe",
      label: "Card payments & payouts",
      // Both are needed: without the webhook secret we could take a payment and
      // never hear that it succeeded, which is worse than not taking it.
      live: Boolean(env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET),
      fallback:
        "Cash and 'other' tenders work normally. Card sales are recorded but not charged.",
      activate:
        "npx wrangler secret put STRIPE_SECRET_KEY && npx wrangler secret put STRIPE_WEBHOOK_SECRET",
    },
    {
      key: "email",
      label: "Receipts & notifications by email",
      live: Boolean(env.RESEND_API_KEY),
      fallback:
        "Receipts still generate and download as PDFs. Sends are written to the email log instead.",
      activate: "npx wrangler secret put RESEND_API_KEY",
    },
    {
      key: "ai",
      label: "Photo intake",
      live: Boolean(env.AI),
      fallback: "The intake form opens empty and staff type the details.",
      activate: "Add the `ai` binding in wrangler.jsonc (already configured).",
    },
    {
      key: "images",
      label: "Photo resizing",
      live: Boolean(env.IMAGES),
      fallback: "Photos are served at their original size.",
      activate: "Add the `images` binding in wrangler.jsonc (already configured).",
    },
  ];
}

/**
 * Loaders receive a `Readonly<RouterContextProvider>`, so accept anything that
 * can read a context rather than the concrete class.
 */
type ContextReader = Pick<RouterContextProvider, "get">;

/** Read the Cloudflare bindings off a React Router loader/action context. */
export function envFrom(context: ContextReader): AppEnv {
  return context.get(cloudflareContext).env;
}

/** The execution context, for `waitUntil` on fire-and-forget work. */
export function ctxFrom(context: ContextReader): ExecutionContext {
  return context.get(cloudflareContext).ctx;
}
