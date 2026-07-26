/**
 * The payments panel in Settings.
 *
 * Two things it must always do honestly:
 *   • never imply payments are on when Stripe hasn't said so
 *   • make clear that cash keeps working regardless, so a shop that can't or
 *     won't finish onboarding doesn't think the product is broken
 */
import { useState } from "react";
import { Badge, Button, Card, Notice } from "./ui";

export interface ConnectStatusPayload {
  configured: boolean;
  missingSecrets: string[];
  status: string;
  explanation: { headline: string; detail: string; tone: "good" | "warn" | "info" };
  canAcceptPayments: boolean;
  account: {
    stripeAccountId: string;
    chargesEnabled: boolean;
    payoutsEnabled: boolean;
    detailsSubmitted: boolean;
    disabledReason: string | null;
    currentlyDue: string[];
    eventuallyDue: string[];
    lastSyncedAt: string | null;
  } | null;
}

const TONE_COLOR = { good: "#2F6F5E", warn: "#B8543F", info: "#2B6CB0" } as const;

export function ConnectPanel({
  initial,
  testMode,
}: {
  initial: ConnectStatusPayload;
  testMode: boolean;
}) {
  const [state, setState] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function call(path: string, then?: (data: Record<string, unknown>) => void) {
    setBusy(path);
    setError(null);
    try {
      const res = await fetch(path, { method: "POST" });
      const data = (await res.json()) as Record<string, unknown>;
      if (!res.ok) {
        setError(String(data.error ?? "That didn't work."));
        return;
      }
      then?.(data);
    } catch {
      setError("We couldn't reach Stripe. Nothing was changed.");
    } finally {
      setBusy(null);
    }
  }

  async function refresh() {
    const res = await fetch("/api/stripe/connect/status");
    if (res.ok) setState((await res.json()) as ConnectStatusPayload);
  }

  // Not deployed with Stripe secrets — say so plainly rather than showing
  // buttons that will fail.
  if (!state.configured) {
    return (
      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-display text-lg text-bark">Card payments</h2>
          <Badge color="#B8860B">Not switched on</Badge>
        </div>
        <p className="mt-2 text-sm leading-relaxed text-slate-soft">
          Card payments aren't configured on this deployment yet. Cash sales work normally,
          and card sales can still be recorded — they just aren't charged through us.
        </p>
        <p className="mt-3 text-xs text-slate-soft">Needed on the Worker:</p>
        <code className="mt-1.5 block rounded-lg bg-linen px-3 py-2 text-xs text-bark">
          {state.missingSecrets.map((s) => `npx wrangler secret put ${s}`).join("\n")}
        </code>
      </Card>
    );
  }

  const tone = TONE_COLOR[state.explanation.tone];
  const account = state.account;

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-display text-lg text-bark">Card payments</h2>
          <Badge color={tone}>{state.canAcceptPayments ? "Live" : "Not yet"}</Badge>
          {testMode ? <Badge color="#6B46C1">Test mode</Badge> : null}
        </div>
        {account ? (
          <button
            type="button"
            onClick={() => call("/api/stripe/connect/refresh", refresh)}
            disabled={busy !== null}
            className="text-xs text-slate-soft underline underline-offset-2 hover:text-bark disabled:opacity-50"
          >
            {busy === "/api/stripe/connect/refresh" ? "Checking…" : "Check with Stripe"}
          </button>
        ) : null}
      </div>

      <p className="mt-3 font-medium text-bark">{state.explanation.headline}</p>
      <p className="mt-1 text-sm leading-relaxed text-slate-soft">{state.explanation.detail}</p>

      {account?.disabledReason ? (
        <div className="mt-3">
          <Notice tone="warn">Stripe's reason: {account.disabledReason}</Notice>
        </div>
      ) : null}

      {account && account.currentlyDue.length > 0 ? (
        <div className="mt-3 rounded-xl border border-line bg-linen/60 p-3">
          <p className="text-xs font-medium text-bark">Stripe still needs</p>
          <ul className="mt-1.5 space-y-1">
            {account.currentlyDue.slice(0, 6).map((item) => (
              <li key={item} className="text-xs text-slate-soft">
                · {item.replace(/[._]/g, " ")}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {error ? (
        <div className="mt-3">
          <Notice tone="warn">{error}</Notice>
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4">
        {!account ? (
          <Button
            type="button"
            disabled={busy !== null}
            onClick={() =>
              call("/api/stripe/connect/account", (data) => {
                if (typeof data.onboardingUrl === "string") {
                  window.location.href = data.onboardingUrl;
                }
              })
            }
          >
            {busy ? "Setting up…" : "Activate payments"}
          </Button>
        ) : state.canAcceptPayments ? (
          <Button
            type="button"
            variant="secondary"
            disabled={busy !== null}
            onClick={() =>
              call("/api/stripe/connect/dashboard-link", (data) => {
                if (typeof data.dashboardUrl === "string") {
                  window.open(String(data.dashboardUrl), "_blank", "noopener");
                }
              })
            }
          >
            Open your Stripe dashboard
          </Button>
        ) : (
          <Button
            type="button"
            disabled={busy !== null}
            onClick={() =>
              call("/api/stripe/connect/onboarding-link", (data) => {
                if (typeof data.onboardingUrl === "string") {
                  window.location.href = data.onboardingUrl;
                }
              })
            }
          >
            {busy ? "One moment…" : "Finish setting up"}
          </Button>
        )}
      </div>

      <div className="mt-4 space-y-2 border-t border-line pt-4 text-xs leading-relaxed text-slate-soft">
        <p>
          <strong className="text-bark">Your shop is the merchant of record.</strong> Receipts
          carry your name and payouts land in your account. You keep your own Stripe dashboard.
        </p>
        <p>
          Stripe charges its published card-present rate. Our platform fee sits on top, capped
          each month at your subscription — both appear on every transaction record.
        </p>
        <p>
          <strong className="text-bark">Cash always works.</strong> None of this affects the
          register's ability to take cash, today or ever.
        </p>
      </div>
    </Card>
  );
}
