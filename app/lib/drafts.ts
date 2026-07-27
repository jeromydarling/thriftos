/**
 * Not losing what somebody typed.
 *
 * A charity shop's laptop is not a developer's laptop. It goes to sleep on a
 * counter, gets its browser closed by the next volunteer, runs out of battery,
 * and loses its connection in a back room with a stone wall. Any of those, part
 * way through describing a coat, currently costs the whole description.
 *
 * So a form keeps a copy of itself in this browser as it's typed, and offers it
 * back if it finds one on the way in. Three rules about that:
 *
 *   It is never restored on its own. A form that silently fills itself in with
 *   something a person doesn't remember typing is worse than an empty one —
 *   they might not notice, and then they'd save it. The draft is offered; a
 *   person decides.
 *
 *   It expires. This is a shared till as often as it's a personal machine, and
 *   yesterday's half-written donation record should not be offered to whoever
 *   opens the app tomorrow morning. Twelve hours: long enough to survive a
 *   lunch break and a flat battery, short enough not to outlive a shift.
 *
 *   It never holds a password. Nothing else here is a secret — this is the
 *   shop's own stock, on the shop's own machine — but a password in local
 *   storage is a different kind of thing entirely, and the filter is here
 *   rather than at each call site so nobody has to remember it.
 *
 * Everything in this file is pure and takes its storage as an argument, which
 * is what makes it testable without a browser.
 */

export const DRAFT_PREFIX = "thriftos.draft.";

/** Twelve hours. See the note above about shared tills. */
export const DRAFT_LIFE_MS = 12 * 60 * 60 * 1000;

export interface Draft {
  /** When it was last written, so we can tell somebody how old it is. */
  at: number;
  fields: Record<string, string>;
}

/**
 * Field names that never go in a draft.
 *
 * `intent` and the underscore-prefixed ones are the app talking to itself —
 * restoring them would replay a decision rather than restore a keystroke. A
 * CSRF token restored twelve hours later is worse than useless.
 */
export function isDraftable(name: string): boolean {
  if (!name) return false;
  if (name.startsWith("_")) return false;
  return name !== "intent" && name !== "csrf" && name !== "redirectTo";
}

/** One key per form per person, so a shared till doesn't cross the streams. */
export function draftKey(name: string, scope?: string): string {
  return `${DRAFT_PREFIX}${scope ? `${scope}.` : ""}${name}`;
}

/**
 * The typed values, and only those.
 *
 * Files are dropped — a draft cannot hold a photograph, and pretending
 * otherwise would restore a form that looks complete and isn't.
 */
export function fieldsFrom(data: Iterable<[string, FormDataEntryValue]>): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const [name, value] of data) {
    if (!isDraftable(name)) continue;
    if (typeof value !== "string") continue;
    fields[name] = value;
  }
  return fields;
}

/** True when nothing was actually typed — nothing worth offering back. */
export function isEmpty(fields: Record<string, string>): boolean {
  return Object.values(fields).every((v) => v.trim() === "");
}

/** True when the draft would actually change something on screen. */
export function differs(draft: Record<string, string>, current: Record<string, string>): boolean {
  return Object.keys(draft).some((key) => (draft[key] ?? "") !== (current[key] ?? ""));
}

/** The smallest slice of `Storage` this needs, so a Map stands in for it. */
export interface DraftStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * Read one, and take the opportunity to throw away anything past its date.
 *
 * Anything unparseable is treated as expired rather than repaired. A draft is
 * a convenience; a half-understood one is a liability.
 */
export function loadDraft(store: DraftStore, key: string, now: number): Draft | null {
  let raw: string | null = null;
  try {
    raw = store.getItem(key);
  } catch {
    // Private browsing, a full quota, a locked-down device. All of them mean
    // "no drafts", none of them mean "break the page".
    return null;
  }
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<Draft>;
    const at = typeof parsed?.at === "number" ? parsed.at : 0;
    const fields = parsed?.fields;

    if (!fields || typeof fields !== "object" || now - at > DRAFT_LIFE_MS) {
      store.removeItem(key);
      return null;
    }

    const clean = fieldsFrom(Object.entries(fields as Record<string, string>));
    if (isEmpty(clean)) {
      store.removeItem(key);
      return null;
    }

    return { at, fields: clean };
  } catch {
    store.removeItem(key);
    return null;
  }
}

export function saveDraft(
  store: DraftStore,
  key: string,
  fields: Record<string, string>,
  now: number
): void {
  try {
    const clean = fieldsFrom(Object.entries(fields));
    if (isEmpty(clean)) {
      store.removeItem(key);
      return;
    }
    store.setItem(key, JSON.stringify({ at: now, fields: clean } satisfies Draft));
  } catch {
    // A full quota must not stop somebody typing.
  }
}

export function clearDraft(store: DraftStore, key: string): void {
  try {
    store.removeItem(key);
  } catch {
    // Nothing to do, and nothing worth saying.
  }
}

/** "3 minutes ago". Plain, and never more precise than it's useful to be. */
export function howLongAgo(at: number, now: number): string {
  const minutes = Math.round((now - at) / 60_000);
  if (minutes < 1) return "a moment ago";
  if (minutes === 1) return "a minute ago";
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  return hours === 1 ? "an hour ago" : `${hours} hours ago`;
}
