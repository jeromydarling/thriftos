/**
 * The savings calculator.
 *
 * All arithmetic comes from lib/savings, so this component cannot quote a
 * number the model doesn't stand behind — including the cases where ThriftOS
 * costs *more*. Those are rendered plainly rather than hidden, because a shop
 * will find them with a spreadsheet in about four minutes, and finding them
 * themselves is far more damaging than reading it here first.
 */
import { useMemo, useState } from "react";
import {
  calculateSavings,
  COMPETITORS,
  percentFeeCrossoverVolumeCents,
} from "../lib/savings";
import { formatBps, formatCents, formatDollars } from "../lib/pricing";

const VOLUME_STEPS = [
  500_000, 1_000_000, 1_500_000, 2_500_000, 4_000_000, 6_000_000, 8_000_000, 12_000_000,
  20_000_000,
];

export function SavingsCalculator({ compact = false }: { compact?: boolean }) {
  const [volumeIndex, setVolumeIndex] = useState(2); // $15k
  const [avgTicket, setAvgTicket] = useState(1_200);
  const [competitorId, setCompetitorId] = useState("thriftcart");
  const [needsReader, setNeedsReader] = useState(false);

  const volume = VOLUME_STEPS[volumeIndex];

  const result = useMemo(
    () =>
      calculateSavings({
        monthlyCardVolumeCents: volume,
        averageTicketCents: avgTicket,
        competitorId,
        needsReader,
      }),
    [volume, avgTicket, competitorId, needsReader]
  );

  const crossover = useMemo(
    () => percentFeeCrossoverVolumeCents(competitorId, avgTicket),
    [competitorId, avgTicket]
  );

  const max = Math.max(result.incumbent.totalCents, result.thriftos.totalCents) || 1;
  const wins = result.monthlySavingsCents > 0;

  return (
    <div className="rounded-2xl border border-line bg-white p-6 sm:p-8">
      <div className="grid gap-6 lg:grid-cols-[18rem_1fr]">
        {/* ── Inputs ── */}
        <div className="space-y-5">
          <div>
            <label htmlFor="volume" className="block text-sm font-medium text-bark">
              Card sales a month
            </label>
            <output className="mt-1 block font-display text-2xl text-moss">
              {formatDollars(volume)}
            </output>
            <input
              id="volume"
              type="range"
              min={0}
              max={VOLUME_STEPS.length - 1}
              step={1}
              value={volumeIndex}
              onChange={(e) => setVolumeIndex(Number(e.target.value))}
              className="mt-2 w-full accent-[var(--color-moss)]"
            />
            <p className="mt-1 text-xs text-slate-soft">
              Card only — cash costs you nothing beyond the subscription.
            </p>
          </div>

          <div>
            <label htmlFor="ticket" className="block text-sm font-medium text-bark">
              Average sale
            </label>
            <output className="mt-1 block font-display text-xl text-bark">
              {formatCents(avgTicket)}
            </output>
            <input
              id="ticket"
              type="range"
              min={500}
              max={4_000}
              step={100}
              value={avgTicket}
              onChange={(e) => setAvgTicket(Number(e.target.value))}
              className="mt-2 w-full accent-[var(--color-moss)]"
            />
            <p className="mt-1 text-xs text-slate-soft">
              ≈ {result.transactionsPerMonth.toLocaleString("en-US")} sales a month
            </p>
          </div>

          <div>
            <label htmlFor="competitor" className="block text-sm font-medium text-bark">
              What you're on now
            </label>
            <select
              id="competitor"
              value={competitorId}
              onChange={(e) => setCompetitorId(e.target.value)}
              className="mt-1.5 w-full rounded-xl border border-line bg-white px-3 py-2.5 text-sm text-bark outline-none focus:border-moss"
            >
              {COMPETITORS.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <p className="mt-1.5 text-xs leading-relaxed text-slate-soft">
              {result.competitor.note}
            </p>
          </div>

          <label className="flex items-start gap-2.5">
            <input
              type="checkbox"
              checked={needsReader}
              onChange={(e) => setNeedsReader(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-[var(--color-moss)]"
            />
            <span className="text-sm text-bark">
              I need a card reader
              <span className="block text-xs text-slate-soft">
                $59 once, spread over six months. Untick if you'll use Tap to Pay on a phone.
              </span>
            </span>
          </label>
        </div>

        {/* ── Result ── */}
        <div>
          <div className="space-y-4">
            <CostBar
              label={result.competitor.name}
              total={result.incumbent.totalCents}
              max={max}
              tone="#B8543F"
              rows={[
                { label: "Software", cents: result.incumbent.softwareCents },
                ...(result.incumbent.hardwareCents > 0
                  ? [{ label: "Hardware lease", cents: result.incumbent.hardwareCents }]
                  : []),
                { label: "Card processing", cents: result.incumbent.processingCents },
              ]}
            />

            <CostBar
              label={`ThriftOS ${result.plan.name}`}
              total={result.thriftos.totalCents}
              max={max}
              tone="#2F6F5E"
              rows={[
                { label: "Subscription", cents: result.thriftos.softwareCents },
                ...(result.thriftos.hardwareCents > 0
                  ? [{ label: "Reader (amortised)", cents: result.thriftos.hardwareCents }]
                  : []),
                { label: "Stripe card-present", cents: result.thriftos.processingCents },
                {
                  label: `ThriftOS fee (${formatBps(result.plan.platformFeeBps)})`,
                  cents: result.thriftos.platformFeeCents,
                },
              ]}
            />
          </div>

          {/* ── The verdict, whichever way it falls ── */}
          <div
            className={`mt-6 rounded-xl border p-5 ${
              wins ? "border-moss/30 bg-moss/5" : "border-clay/30 bg-clay/5"
            }`}
          >
            {wins ? (
              <>
                <p className="text-xs uppercase tracking-wide text-slate-soft">
                  You'd save about
                </p>
                <p className="mt-1 font-display text-3xl text-moss">
                  {formatCents(result.monthlySavingsCents)}
                  <span className="text-base text-slate-soft"> a month</span>
                </p>
                <p className="mt-1 text-sm text-bark">
                  {formatDollars(result.annualSavingsCents)} a year ·{" "}
                  {(result.savingsBps / 100).toFixed(1)}% lower
                </p>

                {result.isModest ? (
                  <p className="mt-3 border-t border-moss/20 pt-3 text-xs leading-relaxed text-slate-soft">
                    That's real, but it's not dramatic — and we'd rather say so than dress it
                    up. On price alone this is a sensible switch, not an urgent one. The
                    bigger argument is what you're <em>not</em> signing: no lease, no
                    contract, no hardware to send back.
                  </p>
                ) : (
                  <p className="mt-3 border-t border-moss/20 pt-3 text-xs leading-relaxed text-slate-soft">
                    Most of that gap is hardware. You're currently renting a terminal
                    {result.leaseBuyoutCents > 0 ? (
                      <>
                        {" "}
                        on an agreement worth{" "}
                        <strong className="text-bark">
                          {formatDollars(result.leaseBuyoutCents)}
                        </strong>{" "}
                        over its full term
                      </>
                    ) : null}
                    . Ours costs $59, or nothing at all if you tap on a phone.
                  </p>
                )}
              </>
            ) : (
              <>
                <p className="text-xs uppercase tracking-wide text-slate-soft">
                  Straight answer
                </p>
                <p className="mt-1 font-display text-2xl text-clay">
                  At this volume, we'd cost you more.
                </p>
                <p className="mt-2 text-sm leading-relaxed text-bark">
                  About {formatCents(Math.abs(result.monthlySavingsCents))} a month more than{" "}
                  {result.competitor.name}. Our platform fee is a percentage, so it grows with
                  your card volume while their flat software price doesn't.
                </p>
                <p className="mt-3 border-t border-clay/20 pt-3 text-xs leading-relaxed text-slate-soft">
                  Try a lower tier — Volunteer is the cheapest plan at every volume, since the
                  fee is capped at the subscription either way. If it still comes out higher,
                  what you have is a good deal and you should keep it. We're not going to put a
                  number on this page that your own spreadsheet would contradict.
                </p>
              </>
            )}
          </div>

          {!compact ? (
            Number.isFinite(crossover) ? (
              <p className="mt-3 text-xs leading-relaxed text-slate-soft">
                Against {result.competitor.name}, ThriftOS is cheaper up to about{" "}
                <strong className="text-bark">{formatDollars(crossover)}</strong> a month in
                card sales. Above that their flat pricing wins on cost alone — that's
                arithmetic, not modesty.
              </p>
            ) : (
              <p className="mt-3 rounded-lg border border-moss/25 bg-moss/5 px-3 py-2 text-xs leading-relaxed text-slate-soft">
                Your platform fee is capped at{" "}
                <strong className="text-bark">
                  {formatCents(result.plan.maxPlatformFeeCents ?? 0)}
                </strong>{" "}
                a month, so it stops growing while their percentage processing keeps climbing.
                There is no volume at which {result.competitor.name} becomes cheaper.
              </p>
            )
          ) : null}

          <p className="mt-3 text-[11px] leading-relaxed text-slate-soft">
            Assumes your current processor charges 2.6% + 10¢, a common nonprofit rate.
            ThriftOS uses Stripe's published card-present pricing (2.7% + 5¢) plus our
            platform fee. Cash sales carry no processing or platform fee at all.
          </p>
        </div>
      </div>
    </div>
  );
}

function CostBar({
  label,
  total,
  max,
  tone,
  rows,
}: {
  label: string;
  total: number;
  max: number;
  tone: string;
  rows: { label: string; cents: number }[];
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium text-bark">{label}</span>
        <span className="font-display text-xl text-bark">{formatCents(total)}<span className="text-xs text-slate-soft">/mo</span></span>
      </div>

      <div className="mt-2 flex h-7 overflow-hidden rounded-lg bg-linen">
        {rows.map((row, i) => (
          <div
            key={row.label}
            className="h-full transition-[width] duration-500 ease-out"
            style={{
              width: `${(row.cents / max) * 100}%`,
              backgroundColor: tone,
              opacity: 1 - i * 0.18,
            }}
            title={`${row.label}: ${formatCents(row.cents)}`}
          />
        ))}
      </div>

      <dl className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5">
        {rows.map((row) => (
          <div key={row.label} className="flex items-baseline gap-1.5">
            <dt className="text-[11px] text-slate-soft">{row.label}</dt>
            <dd className="text-[11px] font-medium text-bark">{formatCents(row.cents)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
