/**
 * Where a write says what it did.
 *
 * One stack, bottom of the screen, above everything. It exists in the document
 * from the first paint — an empty `aria-live` region that messages are dropped
 * into — because a live region created at the same moment as its first message
 * is a live region screen readers ignore. That single detail is the difference
 * between this working and this being decoration.
 *
 * Successes fade. Errors don't: a message that tells you something went wrong
 * and then takes itself away before you've read it is worse than silence.
 *
 * Undo is a form post, not a client-side rewind (see `lib/toast`), so the whole
 * thing here is hidden inputs and a button. Its answer becomes the next toast,
 * which is why the undo is honest about failing — if the thing can't be put
 * back, you're told, instead of watching a button flash and nothing happen.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useFetcher, useLocation } from "react-router";
import { toastFrom, toastLife, type ToastMessage } from "../lib/toast";

interface Live extends ToastMessage {
  id: number;
}

interface ToastApi {
  show: (toast: ToastMessage) => void;
  dismiss: (id: number) => void;
  /**
   * The last error reference we showed anybody, if we showed one.
   *
   * Remembered so that "tell us what happened" can carry it without the person
   * having to copy a hex string off a toast that has since gone. It's what
   * turns a report saying "the save didn't work" into the exact stack trace.
   */
  lastEventId?: string;
}

const Ctx = createContext<ToastApi | null>(null);

/**
 * Used by a screen that wants to say something without a round trip — a copied
 * link, a queued offline sale. Safe outside the provider, where it does
 * nothing: a missing toast should never be the thing that white-screens a
 * register mid-sale.
 */
export function useToast(): ToastApi {
  const api = useContext(Ctx);
  const noop = useMemo<ToastApi>(() => ({ show: () => {}, dismiss: () => {} }), []);
  return api ?? noop;
}

/** At most this many on screen. Older ones drop off the top. */
const MAX_STACK = 3;

export function ToastHost({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Live[]>([]);
  const nextId = useRef(1);

  // Where an undo posts, when nobody said. This host lives above the router's
  // outlet, so a form inside it would otherwise submit to the *root* route —
  // which has no action, and answers by doing nothing at all. Stamped when the
  // toast appears rather than when the button is pressed, so a message that
  // outlives the screen it came from still undoes the right thing.
  const here = useRef("/");
  here.current = useLocation().pathname;

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const [lastEventId, setLastEventId] = useState<string | undefined>(undefined);

  const show = useCallback((toast: ToastMessage) => {
    const stamped: ToastMessage = toast.undo
      ? { ...toast, undo: { ...toast.undo, action: toast.undo.action ?? here.current } }
      : toast;
    if (toast.eventId) setLastEventId(toast.eventId);
    setToasts((current) => [...current, { ...stamped, id: nextId.current++ }].slice(-MAX_STACK));
  }, []);

  const api = useMemo(() => ({ show, dismiss, lastEventId }), [show, dismiss, lastEventId]);

  return (
    <Ctx.Provider value={api}>
      {children}
      <ul
        // Always here, always live, usually empty. See the note at the top.
        aria-live="polite"
        aria-relevant="additions"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 px-3 pb-3 sm:items-end sm:px-4 sm:pb-4"
      >
        {toasts.map((toast) => (
          <ToastRow key={toast.id} toast={toast} onDismiss={dismiss} onShow={show} />
        ))}
      </ul>
    </Ctx.Provider>
  );
}

const SKIN: Record<ToastMessage["tone"], string> = {
  good: "border-moss/30 bg-white text-bark",
  warn: "border-clay/40 bg-white text-bark",
  info: "border-line bg-white text-bark",
};

const DOT: Record<ToastMessage["tone"], string> = {
  good: "bg-moss",
  warn: "bg-clay",
  info: "bg-slate-soft",
};

function ToastRow({
  toast,
  onDismiss,
  onShow,
}: {
  toast: Live;
  onDismiss: (id: number) => void;
  onShow: (toast: ToastMessage) => void;
}) {
  const [paused, setPaused] = useState(false);
  const life = toastLife(toast);
  const undo = useFetcher();
  const seen = useRef<unknown>(null);

  useEffect(() => {
    if (life === 0 || paused) return;
    const timer = setTimeout(() => onDismiss(toast.id), life);
    return () => clearTimeout(timer);
  }, [life, paused, toast.id, onDismiss]);

  // Whatever the undo said becomes the next toast, and this one goes. Told
  // once, not twice: the ref survives React's development double-invoke, which
  // would otherwise announce every undo in stereo.
  useEffect(() => {
    if (!undo.data || seen.current === undo.data) return;
    seen.current = undo.data;
    const next = toastFrom(undo.data);
    onDismiss(toast.id);
    if (next) onShow(next);
  }, [undo.data, toast.id, onDismiss, onShow]);

  const undoing = undo.state !== "idle";

  return (
    <li
      // Errors interrupt; the rest wait their turn behind whatever is being
      // read out. Both still land in the region above, so neither is missed.
      role={toast.tone === "warn" ? "alert" : "status"}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className={`motion-safe:animate-rise pointer-events-auto flex w-full max-w-md gap-3 rounded-xl border p-3 shadow-lg shadow-bark/10 ${SKIN[toast.tone]}`}
    >
      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${DOT[toast.tone]}`} aria-hidden="true" />

      <div className="min-w-0 flex-1">
        <p className="text-sm leading-relaxed">{toast.message}</p>
        {toast.detail ? (
          <p className="mt-1 text-sm leading-relaxed text-slate-soft">{toast.detail}</p>
        ) : null}

        {toast.undo ? (
          <undo.Form method="post" action={toast.undo.action} className="mt-2">
            {Object.entries(toast.undo.fields).map(([name, value]) => (
              <input key={name} type="hidden" name={name} value={value} />
            ))}
            <button
              type="submit"
              disabled={undoing}
              className="min-h-[2rem] rounded-lg border border-line px-3 py-1 text-sm font-medium text-moss hover:bg-linen disabled:opacity-60"
            >
              {undoing ? "Putting it back…" : (toast.undo.label ?? "Undo")}
            </button>
          </undo.Form>
        ) : null}

        {toast.eventId ? (
          <p className="mt-1.5 font-mono text-[11px] text-slate-soft">
            Reference {toast.eventId.slice(0, 8)}
          </p>
        ) : null}
      </div>

      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        // 2rem square rather than the app's usual 3rem: this sits inside a
        // small floating card and a thumb-sized X would be most of it. Still
        // comfortably over the 24px WCAG asks for.
        className="-m-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-soft hover:bg-linen"
      >
        <span aria-hidden="true">×</span>
        <span className="sr-only">Dismiss</span>
      </button>
    </li>
  );
}

/**
 * The bridge from an action's result to the stack.
 *
 * A component rather than a hook so it drops in exactly where the pair of
 * `Notice` blocks used to sit, including inside the nested components that
 * render their own bit of a screen. It draws nothing.
 */
export function ToastFrom({ data }: { data: unknown }) {
  const { show } = useToast();
  const seen = useRef<unknown>(null);

  useEffect(() => {
    // Identity, not contents. Two saves in a row with the same message are two
    // events and should be announced twice; a re-render of one of them is not.
    if (!data || seen.current === data) return;
    seen.current = data;
    const toast = toastFrom(data);
    if (toast) show(toast);
  }, [data, show]);

  return null;
}
