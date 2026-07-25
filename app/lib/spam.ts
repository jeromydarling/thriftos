/**
 * Public-form spam scoring. Layered, because a honeypot alone stopped working
 * years ago.
 *
 * The scorer is pure so real spam samples can be pinned in tests — when a new
 * kind gets through, the fix is a failing test first.
 */

export interface SpamInput {
  name: string;
  email: string;
  message: string;
  /** Hidden field a human never fills in. */
  honeypot?: string;
  /** Client-stamped render time. Instant submits are machines. */
  renderedAt?: number;
  now?: number;
}

export interface SpamVerdict {
  isSpam: boolean;
  score: number;
  reasons: string[];
}

const SPAM_THRESHOLD = 5;

/** Openers that only ever appear in bulk outreach. */
const FORM_LETTER_OPENERS = [
  /^(hi|hello|hey|dear)\s+(there|sir|madam|team|admin|webmaster|owner)\b/i,
  /^i (came across|stumbled upon|was browsing) your (site|website)\b/i,
  /^my name is \w+ and i (am|represent)\b/i,
  /^quick question about your (site|website|seo|ranking)\b/i,
];

const PITCH_PHRASES = [
  /\b(seo|search engine optimi[sz]ation)\b/i,
  /\bfirst page of google\b/i,
  /\b(backlinks?|link building|guest post)\b/i,
  /\b(crypto|bitcoin|forex|binary options)\b/i,
  /\b(viagra|cialis|pharmacy)\b/i,
  /\b(loan|casino|betting|gambling)\b/i,
  /\bincrease your (traffic|sales|revenue) by \d+/i,
  /\b(web ?design|mobile app) services\b/i,
  /\bwork from home\b/i,
  /\bmake money (fast|online|from home)\b/i,
  /\bguaranteed (income|profit|results|returns)\b/i,
  /\bno experience (needed|required)\b/i,
  /\bunsubscribe from (this|these) (email|list)/i,
];

/** Domains that mimic a real provider closely enough to be worth flagging. */
const LOOKALIKE_DOMAINS = [
  /@gmial\./i, /@gmai\./i, /@gnail\./i, /@yahooo\./i, /@hotmial\./i, /@outlok\./i,
];

export function scoreSpam(input: SpamInput): SpamVerdict {
  const reasons: string[] = [];
  let score = 0;

  // Honeypot: only a bot fills a hidden field. Decisive on its own.
  if (input.honeypot && input.honeypot.trim().length > 0) {
    score += 10;
    reasons.push("honeypot filled");
  }

  // Timing trap: humans take longer than three seconds to write a message.
  if (input.renderedAt && input.now) {
    const elapsed = input.now - input.renderedAt;
    if (elapsed >= 0 && elapsed < 3000) {
      score += 6;
      reasons.push("submitted too fast");
    }
  }

  const message = input.message ?? "";

  const links = (message.match(/https?:\/\//gi) ?? []).length;
  if (links >= 3) {
    score += 5;
    reasons.push(`${links} links`);
  } else if (links === 2) {
    score += 2;
    reasons.push("2 links");
  }

  if (message.includes("[url=") || /<a\s+href=/i.test(message)) {
    score += 6;
    reasons.push("markup links");
  }

  for (const phrase of PITCH_PHRASES) {
    if (phrase.test(message)) {
      score += 3;
      reasons.push("pitch phrase");
      break;
    }
  }

  for (const opener of FORM_LETTER_OPENERS) {
    if (opener.test(message.trim())) {
      score += 2;
      reasons.push("form-letter opening");
      break;
    }
  }

  for (const lookalike of LOOKALIKE_DOMAINS) {
    if (lookalike.test(input.email ?? "")) {
      score += 4;
      reasons.push("look-alike sender domain");
      break;
    }
  }

  // All-caps shouting over a decent length.
  const letters = message.replace(/[^a-zA-Z]/g, "");
  if (letters.length > 30) {
    const upper = (message.match(/[A-Z]/g) ?? []).length;
    if (upper / letters.length > 0.6) {
      score += 3;
      reasons.push("mostly capitals");
    }
  }

  if (message.trim().length > 0 && message.trim().length < 12) {
    score += 2;
    reasons.push("very short");
  }

  // Cyrillic or CJK in an otherwise English form is a strong bulk signal.
  if (/[Ѐ-ӿ一-鿿]/.test(message) && /[a-z]/i.test(message)) {
    score += 3;
    reasons.push("mixed scripts");
  }

  return { isSpam: score >= SPAM_THRESHOLD, score, reasons };
}
