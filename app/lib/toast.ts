/**
 * What an action tells the person who ran it.
 *
 * Every write in this app used to answer with a hand-rolled `{ ok }` or
 * `{ error }` and every screen rendered its own pair of `Notice` blocks — six
 * lines of the same conditional, twenty-one times, none of it announced to a
 * screen reader and none of it offering a way back. Which meant the two things
 * that matter most about a write were both missing: a blind volunteer had no
 * idea it had happened, and a sighted one who'd just done the wrong thing had
 * no idea what to do about it.
 *
 * So the result of a write is a value with a name. One shape, one reader
 * (`toastFrom`), one place it's rendered (`ToastHost`). Anything a screen wants
 * to add — a longer explanation, a way to undo it — is a field here rather
 * than another bespoke banner.
 *
 * Two ways to write one, on purpose:
 *
 *     return ok("Saved.")                            // the common case
 *     return ok("Price changed.", { undo: {...} })   // when there's more to say
 *
 * and the bare `{ ok: "..." }` / `{ error: "..." }` that most of the app
 * already returns still reads as a toast, because a shorthand that works is
 * better than a migration that half-lands.
 */

export type Tone = "good" | "warn" | "info";

/**
 * A way to put it back.
 *
 * Deliberately a form post rather than a client-side rollback: the undo goes
 * through the same action, the same permission check and the same rules as the
 * change it reverses. So an undo can't rewrite a price on a sold item, or
 * un-refund a refund, for exactly the same reason the original write couldn't
 * — nobody has to remember to check twice.
 */
export interface UndoOffer {
  /** Where to post. Defaults to the screen the toast appeared on. */
  action?: string;
  /**
   * The hidden fields that reverse it. Usually the values from before.
   *
   * A value can be a list, because plenty of forms here post repeated names —
   * a set of postage bands, the blocks on a page. Without that, undo would
   * only ever work for forms with one of everything.
   */
  fields: Record<string, string | string[]>;
  /** Button text. "Undo" reads fine almost everywhere. */
  label?: string;
}

export interface ToastMessage {
  tone: Tone;
  /** One sentence, past tense, plain. "Price changed to $12." */
  message: string;
  /** What to do about it, when the message alone leaves someone stuck. */
  detail?: string;
  undo?: UndoOffer;
  /**
   * The Sentry event this came from, when the failure was reported. Lets a
   * shop's "something went wrong" turn into a specific thing we can look at,
   * rather than a support thread that starts from nothing.
   */
  eventId?: string;
}

/** What an action returns. Spread it, so a screen can add its own fields. */
export interface Toasted {
  toast: ToastMessage;
}

export function ok(
  message: string,
  extra: Omit<ToastMessage, "tone" | "message"> = {}
): Toasted {
  return { toast: { tone: "good", message, ...extra } };
}

export function failed(
  message: string,
  extra: Omit<ToastMessage, "tone" | "message"> = {}
): Toasted {
  return { toast: { tone: "warn", message, ...extra } };
}

export function noted(
  message: string,
  extra: Omit<ToastMessage, "tone" | "message"> = {}
): Toasted {
  return { toast: { tone: "info", message, ...extra } };
}

/**
 * How long it stays, in milliseconds. Zero means until dismissed.
 *
 * Errors never time out. A message that tells you something went wrong and
 * then removes itself before you've finished reading it is worse than no
 * message, because now you know something happened and not what.
 */
export const TOAST_LIFE: Record<Tone, number> = {
  good: 6000,
  info: 8000,
  warn: 0,
};

/**
 * Longer, when there's an undo on offer — the whole point of it is the moment
 * afterwards where you realise. Six seconds is not that moment.
 */
export const UNDO_LIFE = 15000;

export function toastLife(toast: ToastMessage): number {
  if (toast.tone === "warn") return 0;
  return toast.undo ? UNDO_LIFE : TOAST_LIFE[toast.tone];
}

const TONES: Tone[] = ["good", "warn", "info"];

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function undoFrom(value: unknown): UndoOffer | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  if (!raw.fields || typeof raw.fields !== "object") return undefined;

  const scalar = (v: unknown): string | null =>
    // Coerced rather than dropped: a number that survived the trip as a number
    // is still a perfectly good form value, and silently losing one field out
    // of an undo is how you get an undo that half-works.
    typeof v === "string" || typeof v === "number" || typeof v === "boolean" ? String(v) : null;

  const fields: Record<string, string | string[]> = {};
  for (const [key, v] of Object.entries(raw.fields as Record<string, unknown>)) {
    if (v === null || v === undefined) continue;
    if (Array.isArray(v)) {
      const list = v.map(scalar).filter((x): x is string => x !== null);
      // An empty list still means something — "there were no bands" — so it is
      // kept, unlike a value we couldn't read at all.
      fields[key] = list;
      continue;
    }
    const one = scalar(v);
    if (one !== null) fields[key] = one;
  }
  if (Object.keys(fields).length === 0) return undefined;

  return { fields, action: str(raw.action), label: str(raw.label) };
}

/**
 * The single reader.
 *
 * Defensive because this value crossed the wire: it is whatever the server
 * serialised, reached us through a framework, and a screen that throws while
 * rendering a success message is a spectacular way to turn a good outcome into
 * a bad one. Anything unrecognisable is simply not a toast.
 */
export function toastFrom(data: unknown): ToastMessage | null {
  if (!data || typeof data !== "object") return null;
  const raw = data as Record<string, unknown>;

  if (raw.toast && typeof raw.toast === "object") {
    const t = raw.toast as Record<string, unknown>;
    const message = str(t.message);
    if (!message) return null;
    const tone = TONES.includes(t.tone as Tone) ? (t.tone as Tone) : "info";
    return {
      tone,
      message,
      detail: str(t.detail),
      undo: undoFrom(t.undo),
      eventId: str(t.eventId),
    };
  }

  const error = str(raw.error);
  if (error) return { tone: "warn", message: error };

  const good = str(raw.ok);
  if (good) return { tone: "good", message: good };

  return null;
}
