/**
 * The Compass — the one calm place NRI speaks.
 *
 * Deliberately *not* scattered alerts across the interface. Signals gather in
 * one spot, each one shows its evidence, and each one can be dismissed. There
 * are no badges, no counts, no red dots: nothing here is trying to make anyone
 * anxious enough to click.
 */
import { useState } from "react";
import { Link } from "react-router";
import { Badge, Button, EmptyState } from "./ui";
import { NRI_MICROCOPY } from "../lib/nri/voice";

export interface CompassSignal {
  id: string;
  kind: string;
  title: string;
  summary: string;
  evidence: Record<string, unknown>;
  confidence: string;
  subjectType: string | null;
  subjectId: string | null;
  createdAt: string;
}

const KIND_META: Record<string, { label: string; color: string; glyph: string }> = {
  celebration: { label: "Worth celebrating", color: "#2F6F5E", glyph: "✳" },
  connection: { label: "A connection", color: "#2B6CB0", glyph: "◈" },
  check_in: { label: "Worth a check-in", color: "#B8860B", glyph: "◔" },
  heads_up: { label: "A gentle heads-up", color: "#B8543F", glyph: "◇" },
};

export function Compass({ signals }: { signals: CompassSignal[] }) {
  if (signals.length === 0) {
    return (
      <EmptyState
        title="Nothing worth surfacing this week"
        body={NRI_MICROCOPY.emptyState}
      />
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm leading-relaxed text-slate-soft">{NRI_MICROCOPY.compassIntro}</p>
      {signals.map((signal) => (
        <SignalCard key={signal.id} signal={signal} />
      ))}
    </div>
  );
}

function SignalCard({ signal }: { signal: CompassSignal }) {
  const [showEvidence, setShowEvidence] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);
  const meta = KIND_META[signal.kind] ?? KIND_META.check_in;

  async function dismiss() {
    setBusy(true);
    try {
      const res = await fetch(`/api/nri/signals/${signal.id}/dismiss`, { method: "POST" });
      if (res.ok) setDismissed(true);
    } finally {
      setBusy(false);
    }
  }

  if (dismissed) return null;

  const evidenceEntries = Object.entries(signal.evidence ?? {}).filter(
    ([, v]) => v !== null && v !== undefined && v !== ""
  );

  return (
    <article className="rounded-2xl border border-line bg-white p-5">
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="mt-0.5 text-lg leading-none"
          style={{ color: meta.color }}
        >
          {meta.glyph}
        </span>
        <div className="min-w-0 flex-1">
          <Badge color={meta.color}>{meta.label}</Badge>
          <h3 className="mt-2 font-display text-lg leading-snug text-bark">{signal.title}</h3>
          <p className="mt-1.5 text-sm leading-relaxed text-slate-soft">{signal.summary}</p>

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
            <button
              type="button"
              onClick={() => setShowEvidence((v) => !v)}
              className="text-xs font-medium text-moss underline underline-offset-2 hover:text-moss-deep"
              aria-expanded={showEvidence}
            >
              {showEvidence ? "Hide the evidence" : "Why am I seeing this?"}
            </button>

            {signal.subjectType === "contact" && signal.subjectId ? (
              <Link
                to={`/app/people?focus=${signal.subjectId}`}
                prefetch="intent"
                className="text-xs font-medium text-moss underline underline-offset-2 hover:text-moss-deep"
              >
                Open their record
              </Link>
            ) : null}

            <button
              type="button"
              onClick={dismiss}
              disabled={busy}
              className="text-xs text-slate-soft underline underline-offset-2 hover:text-bark disabled:opacity-50"
            >
              {busy ? "Dismissing…" : "Not useful"}
            </button>
          </div>

          {showEvidence ? (
            <div className="mt-4 rounded-xl border border-line bg-linen/60 p-4">
              <p className="text-xs leading-relaxed text-slate-soft">{NRI_MICROCOPY.whyThis}</p>

              <dl className="mt-3 grid gap-2 sm:grid-cols-2">
                {evidenceEntries.map(([key, value]) => (
                  <div key={key} className="rounded-lg border border-line bg-white px-3 py-2">
                    <dt className="text-[11px] uppercase tracking-wide text-slate-soft">
                      {key.replace(/_/g, " ")}
                    </dt>
                    <dd className="mt-0.5 text-sm text-bark">{formatValue(value)}</dd>
                  </div>
                ))}
              </dl>

              <p className="mt-3 text-[11px] text-slate-soft">
                Noticed {new Date(signal.createdAt).toLocaleDateString(undefined, {
                  month: "long",
                  day: "numeric",
                  year: "numeric",
                })}
                {" · "}
                confidence: {signal.confidence}
                {" · "}
                found by a rule, not a model
              </p>
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function formatValue(value: unknown): string {
  if (Array.isArray(value)) return value.length > 4 ? `${value.slice(0, 4).join(", ")}…` : value.join(", ");
  if (typeof value === "object" && value !== null) return JSON.stringify(value);
  return String(value);
}

/** Small print used wherever NRI output appears next to a save button. */
export function AiGuessNote({ children }: { children?: React.ReactNode }) {
  return (
    <p className="text-xs leading-relaxed text-slate-soft">
      {children ?? NRI_MICROCOPY.aiLabel}
    </p>
  );
}

export function CompassAside() {
  return (
    <aside className="rounded-2xl border border-line bg-white p-5">
      <h2 className="font-display text-base text-bark">What NRI will never do</h2>
      <ul className="mt-3 space-y-2 text-xs leading-relaxed text-slate-soft">
        <li>· Change a price, send an email, or contact anyone on its own.</li>
        <li>· Score, rank, or grade a donor, a volunteer, or a member of staff.</li>
        <li>· Surface anything it can't show you the evidence for.</li>
        <li>· Invent a number it doesn't have.</li>
      </ul>
      <p className="mt-4 border-t border-line pt-3 text-xs leading-relaxed text-slate-soft">
        {NRI_MICROCOPY.privacyNote}
      </p>
      <Link
        to="/nri"
        prefetch="intent"
        className="mt-3 inline-block text-xs font-medium text-moss underline underline-offset-2"
      >
        How NRI works
      </Link>
    </aside>
  );
}
