/**
 * Prefixed random IDs. One helper, used everywhere — the prefix makes a stray
 * id in a log line instantly readable.
 */

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

export const ID_PREFIX = {
  org: "og",
  user: "us",
  session: "se",
  invite: "iv",
  reset: "pr",
  location: "lo",
  contact: "ct",
  item: "it",
  donation: "dn",
  receipt: "rc",
  transaction: "tx",
  txItem: "ti",
  shift: "sh",
  patronage: "pl",
  impact: "im",
  signal: "ns",
  reflection: "nr",
  aiLog: "al",
  audit: "au",
  markdownRule: "mr",
  fedGroup: "fg",
  fedLink: "fl",
  fedOffer: "fo",
  email: "em",
  suppression: "su",
  run: "ru",
  batch: "ib",
  attempt: "pa",
  ledger: "le",
  register: "rg",
  registerShift: "rs",
  cashMovement: "cm",
  terminalLocation: "tl",
  terminalReader: "tr",
  refund: "rf",
  dispute: "dp",
  alert: "ax",
  sitePage: "sp",
  customDomain: "cd",
  brandAsset: "ba",
} as const;

export type IdKind = keyof typeof ID_PREFIX;

/** 22 chars of entropy after the prefix — plenty, and still double-clickable. */
export function newId(kind: IdKind, length = 22): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return `${ID_PREFIX[kind]}_${out}`;
}

/** URL-safe opaque token for sessions, invites, resets, and ICS feeds. */
export function newToken(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return [...buf].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function slugify(text: string, max = 60): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, max);
}
