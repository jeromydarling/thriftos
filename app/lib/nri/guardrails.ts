/**
 * NRI scope guardrails — pre-screening before anything reaches a model.
 *
 * NRI is a companion for a thrift shop's relational work. It is not a therapist,
 * not a search engine, and not a general chatbot. Screening here protects the
 * person asking (some of these questions deserve a real human, not an AI),
 * protects the shop's AI budget, and keeps the product honest about what it is.
 *
 * Thrift shops sit close to hard situations — people in crisis walk through the
 * door. A volunteer typing something heavy into the only box on screen is a
 * realistic Tuesday, and it must be met with kindness and a real phone number.
 */

export interface ScopeCheckResult {
  allowed: boolean;
  reason?: ScopeDenialReason;
  /** Shown to the person instead of calling the model. */
  gentleResponse?: string;
}

export type ScopeDenialReason =
  | "crisis_topic"
  | "emotional_support"
  | "professional_advice"
  | "off_topic"
  | "prompt_injection";

/* ─── Crisis: these deserve real help, immediately ──────────────────────── */

const CRISIS_PATTERNS: readonly RegExp[] = [
  /\b(suicid|kill myself|end my life|want to die|don'?t want to live)\b/i,
  // Match the verb loosely — "hurting myself" and "hurt myself" are the same
  // message, and a missed crisis is the worst failure this file can have.
  /\b(self.?harm(ing)?|cut(ting)? myself|hurt(ing)? myself|harm(ing)? myself)\b/i,
  /\b(abuse[dr]?|abusing|domestic violence|sexual assault|trafficking)\b/i,
  /\b(eating disorder|anorexia|bulimia)\b/i,
  /\b(overdose|substance abuse|drug problem|alcoholi[sc])\b/i,
  /\b(homeless(ness)? (and|but) (scared|unsafe|desperate))\b/i,
];

/* ─── Emotional support seeking ─────────────────────────────────────────── */

const EMOTIONAL_PATTERNS: readonly RegExp[] = [
  /\bi feel (so )?(sad|lonely|anxious|scared|depressed|overwhelmed|broken|empty|hopeless|worthless)\b/i,
  /\bi need (someone to talk to|emotional support|therapy|counseling)\b/i,
  /\bcan you (be my|act as a) (therapist|counselor|psychologist|friend)\b/i,
  /\bmy (marriage|divorce|breakup|spouse|partner) (is|has|was)\b/i,
  /\bi'?m (going through|struggling with) (a lot|grief|loss)\b/i,
  /\b(need to vent|just need to talk|listen to me vent)\b/i,
];

/* ─── Medical / legal / tax / financial advice ──────────────────────────── */

const PROFESSIONAL_PATTERNS: readonly RegExp[] = [
  /\b(diagnos(e|is|ed)|symptoms?|medication|prescri(be|ption)|medical advice)\b/i,
  /\b(legal advice|sue|lawsuit|attorney|lawyer|liability for)\b/i,
  // Note: valuing a donation is the donor's job and their accountant's — never ours.
  /\b(how much can (i|they) (deduct|write off)|appraise this for taxes|tax deduction value)\b/i,
  /\b(invest|stock market|crypto|trading advice)\b/i,
];

/* ─── General knowledge / free-form chat / injection ────────────────────── */

const FREEFORM_PATTERNS: readonly RegExp[] = [
  /\bwrite me (a |an )?(poem|song|story|essay|joke|haiku|limerick)\b/i,
  /\btell me (a |about )?(joke|riddle|fun fact)\b/i,
  /\bwhat is the (meaning of life|capital of|population of|weather|stock price)\b/i,
  /\bwho (is|was) (the president|elon musk|taylor swift)\b/i,
  /\bexplain (quantum|relativity|blockchain|cryptocurrency|bitcoin)\b/i,
  /\bhelp me with (my homework|an essay|a paper|coding|programming)\b/i,
  /\bwrite (code|python|javascript|html|css|sql|a program)\b/i,
  /\btranslate .{3,} (to|into) (spanish|french|german|chinese|japanese)\b/i,
  /\b(recipe for|how to cook|how to bake)\b/i,
  /\bplay (a game|20 questions|trivia)\b/i,
  /\b(roleplay|pretend (you are|to be))\b/i,
  /\bare you (sentient|conscious|alive|real|human)\b/i,
];

const INJECTION_PATTERNS: readonly RegExp[] = [
  /ignore .{0,30}(instructions|rules|prompt|system|guardrails)/i,
  /disregard .{0,30}(instructions|rules|prompt|above)/i,
  /\b(jailbreak|dan mode|developer mode)\b/i,
  /\byour (system )?prompt\b/i,
  /\breveal .{0,20}(instructions|prompt)\b/i,
];

/* ─── Responses ─────────────────────────────────────────────────────────── */

const CRISIS_RESPONSE = `It sounds like something serious is going on, and I'm not the right kind of help for it — I only know about this shop's donations, inventory, and volunteers.

Please reach out to someone who can actually help:
• **988 Suicide & Crisis Lifeline** — call or text **988**
• **Crisis Text Line** — text **HOME** to **741741**
• **SAMHSA Helpline** — **1-800-662-4357**
• **National DV Hotline** — **1-800-799-7233**

These are free, confidential, and answered by real people, day and night.`;

const EMOTIONAL_RESPONSE = `Thank you for saying that. I'm not built for this part — I only know your shop's records, and you deserve a real person rather than a piece of software.

If it would help to talk to someone:
• **988 Suicide & Crisis Lifeline** — call or text **988**
• **Crisis Text Line** — text **HOME** to **741741**

I'm here whenever you want to get back to the shop's work.`;

const PROFESSIONAL_RESPONSE = `I can't give medical, legal, or tax advice — and on donation values in particular, I shouldn't: what a donated item is worth for a deduction is the donor's determination, not the shop's. Stating a value on a receipt is exactly what a charity is supposed to avoid.

I can help with recording the donation, issuing a proper acknowledgement, and everything else about the shop.`;

const FREEFORM_RESPONSE = `I only know about this shop. Here's what I'm actually good for:

• **Donations** — "Log a donation from Marta, four bags of clothes"
• **Inventory** — "What's been on the floor longest?"
• **People** — "Who used to volunteer regularly but hasn't lately?"
• **Impact** — "How many pounds have we diverted this year?"
• **Notes** — "Write a note about today's pickup"

What can I help you with?`;

const RULES: readonly { patterns: readonly RegExp[]; reason: ScopeDenialReason; response: string }[] = [
  // Order matters: crisis first, always.
  { patterns: CRISIS_PATTERNS, reason: "crisis_topic", response: CRISIS_RESPONSE },
  { patterns: INJECTION_PATTERNS, reason: "prompt_injection", response: FREEFORM_RESPONSE },
  { patterns: EMOTIONAL_PATTERNS, reason: "emotional_support", response: EMOTIONAL_RESPONSE },
  { patterns: PROFESSIONAL_PATTERNS, reason: "professional_advice", response: PROFESSIONAL_RESPONSE },
  { patterns: FREEFORM_PATTERNS, reason: "off_topic", response: FREEFORM_RESPONSE },
];

/**
 * Screen a message before it reaches a model. Short greetings pass through —
 * "hi" is not a threat, and treating it as one makes the product feel hostile.
 */
export function checkScope(message: string): ScopeCheckResult {
  const trimmed = message.trim();
  if (trimmed.length < 5) return { allowed: true };

  for (const rule of RULES) {
    for (const pattern of rule.patterns) {
      pattern.lastIndex = 0;
      if (pattern.test(trimmed)) {
        return { allowed: false, reason: rule.reason, gentleResponse: rule.response };
      }
    }
  }

  return { allowed: true };
}

/** Crisis replies are never logged with content — that conversation is theirs. */
export function isLoggable(reason: ScopeDenialReason | undefined): boolean {
  return reason !== "crisis_topic" && reason !== "emotional_support";
}
