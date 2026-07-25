/**
 * NRI voice — how Narrative Relational Intelligence is allowed to speak.
 *
 * NRI is a witness to work already happening. It notices; it does not declare.
 * These rules are the difference between a companion and a dashboard that
 * nags. They are enforced, not merely documented: `applyVoice` runs over every
 * string NRI produces, and `voice.test.ts` pins the behaviour.
 */

/* ─── Posture ───────────────────────────────────────────────────────────── */

export const NRI_POSTURE = {
  is: "A witness to unfolding work — curious and attentive, never authoritative.",
  from: "Explaining meaning",
  to: "Noticing movement",
  principle:
    "NRI speaks as a companion observing what is already happening. It does not interpret, instruct, or declare. It notices, reflects, and gently invites.",
} as const;

export const NRI_IDENTITY = {
  is: ["A witness", "A companion", "A narrative observer", "Observant, grounded, relational"],
  isNot: ["A commentator", "A lecturer", "A scoreboard", "A performance review", "A nag"],
} as const;

/* ─── Authority reduction ───────────────────────────────────────────────── */

/**
 * Phrases that imply narrative dominance, and the softer framing that replaces
 * them. Applied to every generated string before it reaches a human.
 */
export const AUTHORITY_REDUCTION: readonly { from: RegExp; to: string }[] = [
  { from: /\bthe truth is\b/gi, to: "we begin to notice" },
  { from: /\bthis proves\b/gi, to: "perhaps" },
  { from: /\byou must\b/gi, to: "you might" },
  { from: /\bwe must\b/gi, to: "some shops are finding" },
  { from: /\bthis shows that\b/gi, to: "it may be that" },
  { from: /\bthis reveals\b/gi, to: "these moments begin to suggest" },
  { from: /\bthis demonstrates\b/gi, to: "these threads gather into" },
  { from: /\byou need to\b/gi, to: "it might be worth" },
  { from: /\byou should\b/gi, to: "you might" },
  { from: /\bfailed to\b/gi, to: "hasn't yet" },
  { from: /\burgent\b/gi, to: "worth noticing" },
  { from: /\bimmediately\b/gi, to: "when there's a moment" },
  { from: /\bcritical\b/gi, to: "worth attention" },
  { from: /\balert\b/gi, to: "note" },
];

/** Words NRI never uses about people who work in or give to a shop. */
export const FORBIDDEN_ABOUT_PEOPLE: readonly RegExp[] = [
  /\blapsed\b/gi,
  /\bchurn(ed|ing)?\b/gi,
  /\bunderperform(ing|ed)?\b/gi,
  /\blow.?value\b/gi,
  /\bhigh.?value donor\b/gi,
  /\btier (one|two|three|1|2|3)\b/gi,
  /\bscore(d|s)? \d/gi,
];

/**
 * Soften a generated string. Idempotent — running it twice changes nothing —
 * because signals get regenerated and must not drift with each pass.
 */
export function applyVoice(text: string): string {
  let out = text;
  for (const { from, to } of AUTHORITY_REDUCTION) {
    out = out.replace(from, (match) => matchCase(match, to));
  }
  return out.replace(/\s+/g, " ").trim();
}

/** Keep the replacement's capitalisation in step with what it replaced. */
function matchCase(original: string, replacement: string): string {
  if (original[0] === original[0]?.toUpperCase() && original[0] !== original[0]?.toLowerCase()) {
    return replacement[0].toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

/** True when a string still carries language NRI shouldn't use about a person. */
export function violatesPersonLanguage(text: string): boolean {
  return FORBIDDEN_ABOUT_PEOPLE.some((re) => {
    re.lastIndex = 0;
    return re.test(text);
  });
}

/* ─── Editorial discernment ─────────────────────────────────────────────── */

/**
 * NRI prefers silence over low-value noise. A quiet week should produce a quiet
 * Compass — not filler invented to look busy.
 */
export const DISCERNMENT = {
  principle: "NRI must prefer silence over low-value noticing.",
  /** Never surface more than this many open signals at once. */
  maxOpenSignals: 6,
  /** A single generation pass writes at most this many new signals. */
  maxPerRun: 8,
  /** Below this, say nothing at all rather than manufacture a pattern. */
  minEvidenceCount: 2,
} as const;

/**
 * Ordering when there are more candidates than we will show. Celebrations first:
 * a shop that only ever hears about problems stops opening the app.
 */
export const KIND_PRIORITY: Record<string, number> = {
  celebration: 0,
  connection: 1,
  check_in: 2,
  heads_up: 3,
};

export const CONFIDENCE_BY_KIND: Record<string, "high" | "medium" | "moderate"> = {
  celebration: "high",
  connection: "high",
  heads_up: "medium",
  check_in: "moderate",
};

/* ─── Micro-copy shared across surfaces ─────────────────────────────────── */

export const NRI_MICROCOPY = {
  compassIntro:
    "A few things worth noticing this week. Nothing here is urgent, and nothing acts on its own.",
  emptyState:
    "Nothing worth surfacing this week — and that's a fine thing. NRI stays quiet when there's nothing to say.",
  whyThis:
    "Every signal shows its work. This is what NRI noticed, and where it noticed it.",
  dismissHint: "Not useful? Dismiss it and NRI won't raise it again.",
  privacyNote:
    "NRI reads only your shop's own records. Nothing is sold, nothing is published, and nothing leaves without you.",
  aiLabel: "A guess, not a fact — please check it before you save.",
} as const;

export const TRUST_BOUNDARIES: readonly { statement: string; detail: string }[] = [
  {
    statement: "NRI suggests. You decide.",
    detail:
      "Nothing NRI produces is applied on its own. No price changes, no emails, no messages to a donor — every action waits for a person.",
  },
  {
    statement: "NRI never scores a person.",
    detail:
      "No donor tiers, no volunteer leaderboards, no engagement grades. People are not ranked by what they give.",
  },
  {
    statement: "NRI shows its work.",
    detail:
      "Every signal carries the records it came from. If you can't see why it surfaced, treat it as broken.",
  },
  {
    statement: "Your shop's data stays your shop's.",
    detail:
      "It is never sold and never shared with another store unless you join a federation and turn that specific sharing on yourself.",
  },
  {
    statement: "NRI would rather say nothing.",
    detail:
      "A quiet week produces a quiet Compass. There is no filler, and no manufactured urgency.",
  },
] as const;
