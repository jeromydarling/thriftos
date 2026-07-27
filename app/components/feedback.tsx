/**
 * The "tell us" button, on every app screen.
 *
 * A dialog rather than a page, because the alternative is asking somebody to
 * leave the screen they want to complain about — losing whatever they'd typed
 * on it — in order to complain about it. It posts with a fetcher for the same
 * reason: nothing navigates, nothing is lost, and the answer arrives as a
 * toast like every other write in the app.
 *
 * The form asks for one thing: what happened, in their words. The screen, the
 * shop, the browser and the error reference are already known and go along
 * with it — a volunteer on their third day should not be asked to produce a
 * reproduction case.
 */
import { useEffect, useRef, useState } from "react";
import { useFetcher, useLocation } from "react-router";
import { FEEDBACK_KINDS, MAX_BODY, type FeedbackKind } from "../lib/feedback";
import { toastFrom } from "../lib/toast";
import { useToast } from "./toast";

export function FeedbackButton() {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<FeedbackKind>("bug");
  const dialog = useRef<HTMLDialogElement>(null);
  const fetcher = useFetcher();
  const location = useLocation();
  // Picked up from the toast that told them it broke, so the report carries
  // the reference without anybody having to copy it down.
  const { show, lastEventId: eventId } = useToast();
  const seen = useRef<unknown>(null);

  // `open` as state *and* showModal(), rather than the `open` attribute: only
  // showModal gives the focus trap, the backdrop and Escape-to-close, and all
  // three are what make this feel like a dialog rather than a floating div.
  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  useEffect(() => {
    if (!fetcher.data || seen.current === fetcher.data) return;
    seen.current = fetcher.data;
    const toast = toastFrom(fetcher.data);
    if (toast) show(toast);
    // Closed only on success. A failure leaves what they wrote on screen —
    // losing somebody's words while they're telling you the app loses things
    // is not a mistake to make twice.
    if (toast?.tone === "good") setOpen(false);
  }, [fetcher.data, show]);

  const sending = fetcher.state !== "idle";
  const prompt = FEEDBACK_KINDS.find((k) => k.id === kind)?.prompt ?? "";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-block py-1 text-slate-soft underline underline-offset-2 hover:text-bark"
      >
        Something wrong? Tell us
      </button>

      <dialog
        ref={dialog}
        onClose={() => setOpen(false)}
        // Clicking the backdrop is the dialog element itself; clicking the
        // card inside it isn't. Stopping there means "click outside to close"
        // works without a second overlay to keep in sync.
        onClick={(e) => {
          if (e.target === dialog.current) setOpen(false);
        }}
        // m-auto is doing real work: the CSS reset zeroes the margin a
        // modal dialog relies on to centre itself, so without it this opens
        // pinned to the top-left corner of the screen.
        className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-2xl border border-line bg-white p-0 text-bark backdrop:bg-bark/40"
      >
        <fetcher.Form method="post" action="/app/feedback" className="p-6">
          <input type="hidden" name="path" value={location.pathname} />
          {eventId ? <input type="hidden" name="eventId" value={eventId} /> : null}

          <h2 className="font-display text-xl text-bark">Tell us</h2>
          <p className="mt-2 text-sm leading-relaxed text-slate-soft">
            We read all of these. You don't need to work out what went wrong — we can see
            which screen you were on.
          </p>

          <div className="mt-4 flex flex-wrap gap-2">
            {FEEDBACK_KINDS.map((k) => (
              <label
                key={k.id}
                className={`cursor-pointer rounded-lg border px-3 py-2 text-sm ${
                  kind === k.id
                    ? "border-moss bg-moss/5 font-medium text-moss-deep"
                    : "border-line text-slate-soft hover:bg-linen"
                }`}
              >
                <input
                  type="radio"
                  name="kind"
                  value={k.id}
                  checked={kind === k.id}
                  onChange={() => setKind(k.id)}
                  className="sr-only"
                />
                {k.label}
              </label>
            ))}
          </div>

          <label htmlFor="feedback-body" className="mt-4 block text-sm font-medium text-bark">
            {prompt}
          </label>
          <textarea
            id="feedback-body"
            name="body"
            rows={5}
            required
            maxLength={MAX_BODY}
            autoFocus
            className="mt-2 w-full rounded-xl border border-line bg-white px-4 py-3 text-bark outline-none focus:border-moss"
          />

          {eventId ? (
            <p className="mt-2 font-mono text-[11px] text-slate-soft">
              Sending error reference {eventId.slice(0, 8)} with this.
            </p>
          ) : null}

          <div className="mt-5 flex items-center gap-3">
            <button
              type="submit"
              disabled={sending}
              className="touch-target rounded-xl bg-moss px-5 py-3 font-medium text-white hover:bg-moss-deep disabled:opacity-60"
            >
              {sending ? "Sending…" : "Send"}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="touch-target rounded-xl border border-line px-5 py-3 text-slate-soft hover:bg-linen"
            >
              Cancel
            </button>
          </div>
        </fetcher.Form>
      </dialog>
    </>
  );
}
