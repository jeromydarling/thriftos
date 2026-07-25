/**
 * The NRI rules — Recognize · Synthesize · Prioritize.
 *
 * Every signal in ThriftOS is derived here, deterministically, from records the
 * shop already has. No model decides what matters. AI is never in this path;
 * at most it rephrases a sentence downstream, and even that is logged and
 * optional. That is the whole point: a shop can read this file and know exactly
 * why it saw what it saw.
 *
 * `deriveSignals` is pure. Give it a snapshot and a clock and it returns the
 * same signals every time — which is what makes the thresholds testable, and
 * what makes the "Why this?" drawer honest.
 */
import type {
  CandidateSignal,
  DonorSnapshot,
  NriSnapshot,
  SignalKind,
} from "./types";
import { applyVoice, CONFIDENCE_BY_KIND, DISCERNMENT, KIND_PRIORITY } from "./voice";

/* ─── Thresholds ─────────────────────────────────────────────────────────
   Named, gathered, and deliberately conservative. NRI would rather miss a
   noticing than manufacture one. */

export const THRESHOLDS = {
  /** A donor is "quiet" once they're this many times past their own rhythm. */
  quietDonorGapMultiplier: 2,
  /** ...but never flag anyone before this many days, however brisk their rhythm. */
  quietDonorMinDays: 45,
  /** Only donors with a real pattern — one visit is not a rhythm. */
  quietDonorMinDonations: 3,
  /** A return counts as a reconnection after this long away. */
  returningDonorMinGapDays: 90,
  /** First-time donors deserve a thank-you within this window. */
  firstDonorAckDays: 7,
  /** Receipts owed before it's worth mentioning at all. */
  missingReceiptsMin: 3,
  missingReceiptsAgeDays: 14,
  /** A volunteer with a steady rhythm who hasn't been on the schedule. */
  quietVolunteerDays: 30,
  quietVolunteerMinShifts: 3,
  /** Backlog: intake outpacing sales by this ratio, with enough volume to mean it. */
  backlogRatio: 1.6,
  backlogMinIntake: 25,
  /** Aged stock worth a gentle word. */
  finalMarkdownMin: 40,
  pastRotationMin: 25,
  unpricedMin: 15,
  /** Story capture falling off. */
  reflectionDropRatio: 0.4,
  reflectionPrevMin: 5,
  /** Diversion milestones, in pounds. */
  diversionMilestones: [1_000, 5_000, 10_000, 25_000, 50_000, 100_000, 250_000],
  /** Volunteer-hour milestones for a single month. */
  volunteerHourMilestones: [50, 100, 250, 500, 1_000],
  /** Value-delivered milestones for a single month, in cents. */
  valueDeliveredMilestones: [100_000, 500_000, 1_000_000, 5_000_000],
  /** Someone holding three roles at once is a genuine relationship. */
  multiRoleMin: 2,
} as const;

/** Largest milestone crossed, or null. Milestones fire once, on the way past. */
function crossedMilestone(value: number, milestones: readonly number[]): number | null {
  let hit: number | null = null;
  for (const m of milestones) if (value >= m) hit = m;
  return hit;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return n === 1 ? one : many;
}

function fmtLbs(lbs: number): string {
  return Math.round(lbs).toLocaleString("en-US");
}

function fmtDollars(cents: number): string {
  return `$${Math.round(cents / 100).toLocaleString("en-US")}`;
}

function build(
  kind: SignalKind,
  parts: Omit<CandidateSignal, "kind" | "confidence"> & { confidence?: CandidateSignal["confidence"] }
): CandidateSignal {
  return {
    kind,
    title: applyVoice(parts.title),
    summary: applyVoice(parts.summary),
    evidence: parts.evidence,
    confidence: parts.confidence ?? CONFIDENCE_BY_KIND[kind] ?? "moderate",
    subjectType: parts.subjectType,
    subjectId: parts.subjectId,
    dedupeKey: parts.dedupeKey,
  };
}

/** Week-stamp used in dedupe keys so a noticing can recur next week, not today. */
export function weekStamp(now: Date): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() - (day === 0 ? 6 : day - 1)); // back to Monday
  return d.toISOString().slice(0, 10);
}

export function monthStamp(now: Date): string {
  return now.toISOString().slice(0, 7);
}

/* ─── The rules ─────────────────────────────────────────────────────────── */

export function deriveSignals(snap: NriSnapshot, now: Date = new Date()): CandidateSignal[] {
  const out: CandidateSignal[] = [];
  const week = weekStamp(now);
  const month = monthStamp(now);
  const seen = new Set(snap.celebratedMilestones);

  /* ── RECOGNIZE: people ─────────────────────────────────────────────── */

  // A donor whose own rhythm suggests they'd normally have been back.
  // Not "lapsed" — quiet. There are a hundred good reasons to be quiet.
  for (const donor of snap.quietDonors.slice(0, 3)) {
    if (donor.donationCount < THRESHOLDS.quietDonorMinDonations) continue;
    if (donor.daysSinceLast < THRESHOLDS.quietDonorMinDays) continue;

    out.push(
      build("check_in", {
        title: "A quiet stretch worth noticing",
        summary: `${donor.name} has dropped things off ${donor.donationCount} times, usually every ${donor.medianGapDays ?? "few"} days or so. It's been ${donor.daysSinceLast} days. No news is often just no news — but it might be a nice moment to say hello.`,
        evidence: {
          donations: donor.donationCount,
          usual_gap_days: donor.medianGapDays,
          days_since_last: donor.daysSinceLast,
          first_donation: donor.firstDonationAt.slice(0, 10),
          last_donation: donor.lastDonationAt.slice(0, 10),
        },
        subjectType: "contact",
        subjectId: donor.contactId,
        dedupeKey: `check_in:donor_quiet:${donor.contactId}:${month}`,
      })
    );
  }

  // Someone came back after a long gap. Worth a moment.
  for (const donor of snap.returningDonors.slice(0, 3)) {
    out.push(
      build("celebration", {
        title: "Someone came back",
        summary: `${donor.name} dropped things off again after ${donor.daysSinceLast > 0 ? "a while" : "a long while"} away. Reconnections like this are easy to miss in a busy week.`,
        evidence: {
          donations: donor.donationCount,
          returned_on: donor.lastDonationAt.slice(0, 10),
          gap_days: donor.medianGapDays,
        },
        subjectType: "contact",
        subjectId: donor.contactId,
        dedupeKey: `celebration:donor_return:${donor.contactId}:${donor.lastDonationAt.slice(0, 10)}`,
      })
    );
  }

  // A first-time donor nobody has thanked yet.
  const unthanked = snap.firstTimeDonorsUnacknowledged;
  if (unthanked.length > 0) {
    const names = unthanked.slice(0, 3).map((d) => d.name).join(", ");
    out.push(
      build("check_in", {
        title: `${unthanked.length} first-time ${plural(unthanked.length, "donor")} to thank`,
        summary: `${names}${unthanked.length > 3 ? `, and ${unthanked.length - 3} more` : ""} gave for the first time and haven't heard back yet. A first thank-you is the one that decides whether there's a second visit.`,
        evidence: {
          count: unthanked.length,
          within_days: THRESHOLDS.firstDonorAckDays,
          contact_ids: unthanked.slice(0, 10).map((d) => d.contactId),
        },
        subjectType: "org",
        dedupeKey: `check_in:first_donor_ack:${week}`,
      })
    );
  }

  // A volunteer with a steady rhythm who has drifted off the schedule.
  for (const vol of snap.quietVolunteers.slice(0, 3)) {
    if (vol.shiftsLast90 < THRESHOLDS.quietVolunteerMinShifts) continue;
    out.push(
      build("check_in", {
        title: "A familiar face has been away",
        summary: `${vol.name} worked ${vol.shiftsLast90} ${plural(vol.shiftsLast90, "shift")} recently and hasn't been on the schedule for ${vol.daysSinceLast} days. Might be worth a note — people often drift off simply because nobody asked.`,
        evidence: {
          shifts_last_90: vol.shiftsLast90,
          hours_last_90: Math.round(vol.hoursLast90 * 10) / 10,
          days_since_last: vol.daysSinceLast,
          last_shift: vol.lastShiftAt?.slice(0, 10) ?? null,
        },
        subjectType: "contact",
        subjectId: vol.contactId,
        dedupeKey: `check_in:volunteer_quiet:${vol.contactId}:${month}`,
      })
    );
  }

  /* ── SYNTHESIZE: relationships that cross roles ────────────────────── */

  // The same person giving, working, and shopping is the shape of a real
  // relationship — and it is invisible unless something joins it up.
  for (const contact of snap.multiRoleContacts.slice(0, 3)) {
    if (contact.roles.length < THRESHOLDS.multiRoleMin) continue;
    if (contact.newRoles.length === 0) continue;

    const roleWords = contact.roles.join(", ");
    out.push(
      build("connection", {
        title: "A relationship widening",
        summary: `${contact.name} now shows up in your records as ${roleWords}. What started one way has quietly become something more.`,
        evidence: {
          roles: contact.roles,
          newly_added: contact.newRoles,
        },
        subjectType: "contact",
        subjectId: contact.contactId,
        dedupeKey: `connection:multi_role:${contact.contactId}:${contact.roles.slice().sort().join("+")}`,
      })
    );
  }

  /* ── RECOGNIZE: the floor ──────────────────────────────────────────── */

  const inv = snap.inventory;

  // Intake running well ahead of sales — a backroom filling up.
  if (
    inv.intakeLast7 >= THRESHOLDS.backlogMinIntake &&
    inv.soldLast7 > 0 &&
    inv.intakeLast7 / inv.soldLast7 >= THRESHOLDS.backlogRatio
  ) {
    out.push(
      build("heads_up", {
        title: "The backroom is filling faster than the floor is clearing",
        summary: `${inv.intakeLast7} items came in this week and ${inv.soldLast7} went out. That gap is fine for a week or two — it's the third week that starts to hurt.`,
        evidence: {
          intake_last_7: inv.intakeLast7,
          sold_last_7: inv.soldLast7,
          intake_prev_7: inv.intakePrev7,
          sold_prev_7: inv.soldPrev7,
          ratio: Math.round((inv.intakeLast7 / inv.soldLast7) * 100) / 100,
        },
        subjectType: "org",
        dedupeKey: `heads_up:backlog:${week}`,
      })
    );
  }

  // Stock that has run out the full rotation.
  if (inv.atFinalMarkdown >= THRESHOLDS.finalMarkdownMin) {
    out.push(
      build("heads_up", {
        title: `${inv.atFinalMarkdown} items have reached their last markdown`,
        summary: `These have been through the whole rotation without finding anyone. Some shops pull them for a bulk or rag-out channel at this point; others run a fill-a-bag day. Either way, they're taking up rack space that new donations need.`,
        evidence: {
          at_final_markdown: inv.atFinalMarkdown,
          past_rotation: inv.pastRotation,
          oldest_available_days: inv.oldestAvailableDays,
        },
        subjectType: "org",
        dedupeKey: `heads_up:final_markdown:${week}`,
      })
    );
  }

  // Items on the floor with no price.
  if (inv.unpriced >= THRESHOLDS.unpricedMin) {
    out.push(
      build("heads_up", {
        title: `${inv.unpriced} items are on the floor without a price`,
        summary: `A shopper who can't find a price usually puts the thing back down. These are quick to clear in one pass.`,
        evidence: { unpriced: inv.unpriced, available: inv.available },
        subjectType: "org",
        dedupeKey: `heads_up:unpriced:${week}`,
      })
    );
  }

  // Receipts owed. Said plainly, without alarm — but donors need these at tax time.
  if (
    snap.donationsMissingReceipts >= THRESHOLDS.missingReceiptsMin &&
    snap.donationsMissingReceiptsOldestDays >= THRESHOLDS.missingReceiptsAgeDays
  ) {
    out.push(
      build("heads_up", {
        title: `${snap.donationsMissingReceipts} donations are still waiting on a receipt`,
        summary: `The oldest has been waiting ${snap.donationsMissingReceiptsOldestDays} days. Donors need these come tax time, and they're much easier to issue now than in a January rush.`,
        evidence: {
          missing: snap.donationsMissingReceipts,
          oldest_days: snap.donationsMissingReceiptsOldestDays,
        },
        subjectType: "org",
        dedupeKey: `heads_up:receipts_pending:${week}`,
      })
    );
  }

  // Story capture falling away. NRI notices its own diet thinning.
  if (
    snap.reflectionsPrev30 >= THRESHOLDS.reflectionPrevMin &&
    snap.reflectionsLast30 <= snap.reflectionsPrev30 * THRESHOLDS.reflectionDropRatio
  ) {
    out.push(
      build("heads_up", {
        title: "Fewer notes are being written down",
        summary: `${snap.reflectionsLast30} ${plural(snap.reflectionsLast30, "note")} in the last month, down from ${snap.reflectionsPrev30}. The work hasn't slowed — but when the writing stops, next year's grant report gets much harder to assemble.`,
        evidence: {
          last_30: snap.reflectionsLast30,
          prev_30: snap.reflectionsPrev30,
        },
        subjectType: "org",
        dedupeKey: `heads_up:reflection_drop:${month}`,
      })
    );
  }

  /* ── PRIORITIZE: what the work added up to ─────────────────────────── */

  const impact = snap.impact;

  // Landfill diversion milestone.
  const lbsMilestone = crossedMilestone(
    impact.diversionLbsTotal,
    THRESHOLDS.diversionMilestones
  );
  if (lbsMilestone && !seen.has(`diversion:${lbsMilestone}`)) {
    out.push(
      build("celebration", {
        title: `${fmtLbs(lbsMilestone)} pounds kept out of a landfill`,
        summary: `Your shop has now moved ${fmtLbs(impact.diversionLbsTotal)} pounds of goods back into use. That's the number a board wants and a grant application asks for — it's on your impact page whenever you need it.`,
        evidence: {
          milestone_lbs: lbsMilestone,
          total_lbs: Math.round(impact.diversionLbsTotal),
          items_rehomed: impact.itemsRehomedTotal,
        },
        subjectType: "org",
        dedupeKey: `celebration:diversion:${lbsMilestone}`,
      })
    );
  }

  // Volunteer hours in a month.
  const hoursMilestone = crossedMilestone(
    impact.volunteerHoursThisMonth,
    THRESHOLDS.volunteerHourMilestones
  );
  if (hoursMilestone && !seen.has(`volunteer_hours:${month}:${hoursMilestone}`)) {
    out.push(
      build("celebration", {
        title: `${hoursMilestone} volunteer hours this month`,
        summary: `${impact.volunteerHeadcountThisMonth} ${plural(impact.volunteerHeadcountThisMonth, "person", "people")} gave ${Math.round(impact.volunteerHoursThisMonth)} hours this month. Worth saying out loud to them, not just recording.`,
        evidence: {
          milestone_hours: hoursMilestone,
          hours_this_month: Math.round(impact.volunteerHoursThisMonth * 10) / 10,
          hours_prev_month: Math.round(impact.volunteerHoursPrevMonth * 10) / 10,
          headcount: impact.volunteerHeadcountThisMonth,
        },
        subjectType: "org",
        dedupeKey: `celebration:volunteer_hours:${month}:${hoursMilestone}`,
      })
    );
  }

  // Value delivered to shoppers — the quiet half of a thrift store's purpose.
  const valueMilestone = crossedMilestone(
    impact.valueDeliveredCentsThisMonth,
    THRESHOLDS.valueDeliveredMilestones
  );
  if (valueMilestone && !seen.has(`value_delivered:${month}:${valueMilestone}`)) {
    out.push(
      build("celebration", {
        title: `${fmtDollars(valueMilestone)} of value delivered this month`,
        summary: `Shoppers took home ${fmtDollars(impact.valueDeliveredCentsThisMonth)} worth of goods for far less than that. That difference is real money that stayed in people's pockets.`,
        evidence: {
          milestone_cents: valueMilestone,
          value_delivered_cents: impact.valueDeliveredCentsThisMonth,
          items_rehomed_this_month: impact.itemsRehomedThisMonth,
        },
        subjectType: "org",
        dedupeKey: `celebration:value_delivered:${month}:${valueMilestone}`,
      })
    );
  }

  return prioritize(out);
}

/**
 * Order and trim. Celebrations first, then connections, then the gentler
 * nudges — and never more than a person can actually hold in one sitting.
 */
export function prioritize(signals: CandidateSignal[]): CandidateSignal[] {
  const deduped = new Map<string, CandidateSignal>();
  for (const s of signals) if (!deduped.has(s.dedupeKey)) deduped.set(s.dedupeKey, s);

  return [...deduped.values()]
    .sort((a, b) => (KIND_PRIORITY[a.kind] ?? 9) - (KIND_PRIORITY[b.kind] ?? 9))
    .slice(0, DISCERNMENT.maxPerRun);
}

/** Convenience for tests and the seed: a donor's typical gap, in whole days. */
export function medianGapDays(donationDates: string[]): number | null {
  if (donationDates.length < 2) return null;
  const sorted = [...donationDates].sort();
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const ms = new Date(sorted[i]).getTime() - new Date(sorted[i - 1]).getTime();
    if (Number.isFinite(ms)) gaps.push(Math.max(0, Math.floor(ms / 86_400_000)));
  }
  if (gaps.length === 0) return null;
  gaps.sort((a, b) => a - b);
  const mid = Math.floor(gaps.length / 2);
  return gaps.length % 2 === 0 ? Math.round((gaps[mid - 1] + gaps[mid]) / 2) : gaps[mid];
}

export type { CandidateSignal, DonorSnapshot, NriSnapshot };
