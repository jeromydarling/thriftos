/**
 * NRI marketing copy — one source of truth, so the explainer page, the in-app
 * tooltips, and the FAQ schema can never drift apart.
 */

export const NRI_HERO = {
  eyebrow: "Narrative Relational Intelligence",
  title: "The part of the software that notices things",
  subtitle:
    "NRI isn't AI that decides for you. It's a quiet layer that watches what a machine should watch — so you can do the part only a person can do.",
  footnote: "It suggests. You decide. Always that way round.",
} as const;

export const CORE_LOOP = {
  heading: "Recognize · Synthesize · Prioritize",
  intro:
    "NRI does three things, and only three things. Everything below is a rule you could read in the source — no model decides what matters in your shop.",
  steps: [
    {
      label: "Recognize",
      description:
        "It watches for change against a shop's own patterns — not a schedule imposed from outside. A donor's personal rhythm breaking, a volunteer drifting off the roster, stock aging past its rotation, a milestone quietly crossed.",
      examples: [
        "Someone who came by every six weeks hasn't in four months",
        "Forty items have reached their final markdown",
        "Intake ran well ahead of sales this week",
      ],
    },
    {
      label: "Synthesize",
      description:
        "Scattered records get gathered into something a person can act on. The donor, the volunteer, and the Saturday regular turn out to be the same person — and that only becomes visible when something joins it up.",
      examples: [
        "Donations, shifts, and sales resolve to one relationship",
        "A month of receipts becomes a diversion figure a board understands",
        "Written notes become the raw material of next year's grant report",
      ],
    },
    {
      label: "Prioritize",
      description:
        "A handful of things worth your attention, in one calm place. Not a task list, not a score, not a red badge. Celebrations come first, because a shop that only hears about problems stops opening the app.",
      examples: [
        "At most six open signals at a time",
        "Each one shows the exact records behind it",
        "A quiet week produces a quiet Compass",
      ],
    },
  ],
  closing:
    "All of it lives in one place — the Compass — rather than scattered as alerts across the interface.",
} as const;

export const AI_LIMITS = {
  heading: "What we won't pretend",
  body: [
    "A model can tell a coat from a lamp. It cannot tell that the woman buying the blazer has an interview on Thursday, or that the man donating his late wife's books needs to talk about her for a minute before he leaves.",
    "Those are the moments a thrift store is actually for, and no amount of inference reaches them.",
    "So NRI is deliberately bounded. It handles the counting, the noticing, and the remembering. The meaning stays with the people who were in the room.",
  ],
  closing: "The machine organizes. You decide what it means.",
} as const;

export const PRINCIPLES = [
  {
    name: "Subsidiarity",
    definition: "The person closest to the relationship holds it.",
    example:
      "The volunteer who has known a donor for six years understands them better than any pattern. NRI surfaces the change and then gets out of the way — it never sends the message.",
  },
  {
    name: "Solidarity",
    definition: "Shared burdens without exposed private detail.",
    example:
      "Stores in a federation can compare aggregate movement without revealing anyone's records. Each store opts into each kind of sharing separately, and can revoke it.",
  },
  {
    name: "Common good",
    definition: "Shared flourishing needs shared awareness.",
    example:
      "Diversion weight and value delivered are computed the same way for every shop, so the numbers mean the same thing when a network adds them up.",
  },
] as const;

export const HOW_IT_DIFFERS = [
  {
    claim: "Every signal is a rule, not a guess.",
    detail:
      "Signals come from deterministic thresholds over your own records. Run it twice on the same data and you get exactly the same result — which is what makes the 'why am I seeing this?' answer honest.",
  },
  {
    claim: "AI is nowhere near the decisions.",
    detail:
      "The only place a model touches your shop is reading a photo at intake, where it fills a form you then correct. It never decides what's worth your attention.",
  },
  {
    claim: "Nobody gets scored.",
    detail:
      "No donor tiers, no volunteer leaderboards, no engagement grades. The vocabulary isn't in the product, and the word 'lapsed' is on a blocklist.",
  },
  {
    claim: "Silence is a valid output.",
    detail:
      "Thresholds are set so a quiet week produces nothing. There is no filler content, and no manufactured urgency to drive engagement.",
  },
] as const;

export const NRI_FAQ = [
  {
    question: "What is NRI?",
    answer:
      "Narrative Relational Intelligence — a layer that recognizes changes in your shop's own patterns, gathers scattered records into something coherent, and surfaces a small number of things worth your attention. It suggests; it never acts.",
  },
  {
    question: "Is NRI just AI with a different name?",
    answer:
      "No. NRI signals are produced by deterministic rules over your own records, not by a model. The only AI in ThriftOS reads photos at intake to pre-fill a form you correct. Nothing a model produces is ever saved without a person accepting it.",
  },
  {
    question: "Will it email my donors?",
    answer:
      "Never on its own. NRI can notice that a first-time donor hasn't been thanked; issuing the thanks is always a person pressing a button.",
  },
  {
    question: "Does it rank or score people?",
    answer:
      "No. There are no donor tiers, volunteer leaderboards, or engagement scores — by design, not as a setting you can switch on.",
  },
  {
    question: "Can I see why a signal appeared?",
    answer:
      "Yes, on every signal. Each one carries the counts, dates, and records it was derived from, shown in full. If you can't see why something surfaced, treat that as a bug.",
  },
  {
    question: "Who can see our data?",
    answer:
      "Your shop. It's never sold, and it's never shared with another store unless you join a federation and turn on that specific kind of sharing yourself — which you can revoke at any time without leaving the group.",
  },
] as const;
