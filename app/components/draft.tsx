/**
 * Drop this inside a form and it stops losing things.
 *
 *     <Form method="post">
 *       <DraftKeeper name={`item.${item.id}`} />
 *       …
 *     </Form>
 *
 * It finds its own form through the hidden input it renders — every form
 * control has a `.form` property pointing at its owner — so adopting it is one
 * line and there is no ref to thread through a component that didn't want one.
 *
 * Only for forms whose inputs are uncontrolled, which in this app is most of
 * them. The brand studio and the site editor keep their fields in React state
 * so their previews can move as you type; writing values into those from the
 * outside would set the DOM and leave the state behind it, which looks like it
 * worked until you press save. They'd need their own draft of that state, and
 * that's a different mechanism rather than a flag on this one.
 *
 * The rules about what's kept, for how long, and why it is never restored
 * without being asked, are all in `lib/drafts`.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouteLoaderData } from "react-router";
import {
  clearDraft,
  differs,
  draftKey,
  fieldsFrom,
  howLongAgo,
  loadDraft,
  saveDraft,
  type Draft,
} from "../lib/drafts";

/** Long enough that a fast typist isn't writing on every keystroke. */
const SETTLE_MS = 700;

export function DraftKeeper({ name }: { name: string }) {
  const anchor = useRef<HTMLInputElement>(null);
  const [offer, setOffer] = useState<Draft | null>(null);
  const [now, setNow] = useState(0);

  // Scoped to the person, so two volunteers sharing a till at the counter
  // don't hand each other half-finished records. Falls back to unscoped
  // outside the app shell, which is where it's never used anyway.
  const shell = useRouteLoaderData("routes/app") as { user?: { id?: string } } | undefined;
  const key = draftKey(name, shell?.user?.id);

  const readForm = useCallback((form: HTMLFormElement) => {
    const data = new FormData(form);
    // Passwords are stripped here rather than in `fieldsFrom`, because the
    // type is a property of the element and FormData has already forgotten it.
    for (const el of Array.from(form.elements)) {
      if (el instanceof HTMLInputElement && el.type === "password" && el.name) {
        data.delete(el.name);
      }
    }
    return fieldsFrom(data.entries());
  }, []);

  // On the way in: is there something to offer?
  useEffect(() => {
    const form = anchor.current?.form;
    if (!form || typeof window === "undefined") return;

    const at = Date.now();
    const draft = loadDraft(window.localStorage, key, at);
    // Nothing to say if it matches what's already on screen — which is the
    // usual case, because the last thing that happened was a successful save.
    if (draft && differs(draft.fields, readForm(form))) {
      setNow(at);
      setOffer(draft);
    } else if (draft) {
      clearDraft(window.localStorage, key);
    }
  }, [key, readForm]);

  // While they type.
  useEffect(() => {
    const form = anchor.current?.form;
    if (!form || typeof window === "undefined") return;

    let timer: ReturnType<typeof setTimeout> | undefined;

    const remember = () => {
      clearTimeout(timer);
      timer = setTimeout(() => saveDraft(window.localStorage, key, readForm(form), Date.now()), SETTLE_MS);
    };

    // Saved on the way out too. A tab closed inside the settle window would
    // otherwise lose the last few seconds, which is exactly the moment this
    // exists for.
    const flush = () => {
      clearTimeout(timer);
      saveDraft(window.localStorage, key, readForm(form), Date.now());
    };

    // Submitted means it's on its way to the server; the copy here has done
    // its job. A submission that fails leaves the values in the boxes, so
    // nothing is lost by having let go of them.
    const done = () => {
      clearTimeout(timer);
      clearDraft(window.localStorage, key);
      setOffer(null);
    };

    form.addEventListener("input", remember);
    form.addEventListener("change", remember);
    form.addEventListener("submit", done);
    window.addEventListener("pagehide", flush);

    return () => {
      clearTimeout(timer);
      form.removeEventListener("input", remember);
      form.removeEventListener("change", remember);
      form.removeEventListener("submit", done);
      window.removeEventListener("pagehide", flush);
    };
  }, [key, readForm]);

  const restore = () => {
    const form = anchor.current?.form;
    if (!form || !offer) return;

    for (const [field, value] of Object.entries(offer.fields)) {
      const el = form.elements.namedItem(field);
      if (
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        el instanceof HTMLSelectElement
      ) {
        el.value = value;
      }
    }
    setOffer(null);
  };

  const discard = () => {
    if (typeof window !== "undefined") clearDraft(window.localStorage, key);
    setOffer(null);
  };

  return (
    <>
      {/* How the component finds its form. Not draftable, hence the underscore. */}
      <input ref={anchor} type="hidden" name="_draft" value="" />

      {/* Stacked rather than a row. This sits inside whatever column its form
          is in — sometimes a 22rem sidebar — and side-by-side text and buttons
          in that space wraps to one word per line. */}
      {offer ? (
        <div
          role="status"
          className="mb-4 rounded-xl border border-amber/40 bg-amber/10 px-4 py-3 text-sm"
        >
          <p className="leading-relaxed text-bark">
            You were part way through this {howLongAgo(offer.at, now)} and didn't save it.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={restore}
              className="min-h-[2.25rem] rounded-lg bg-moss px-4 py-1.5 font-medium text-white hover:bg-moss-deep"
            >
              Put it back
            </button>
            <button
              type="button"
              onClick={discard}
              className="min-h-[2.25rem] rounded-lg border border-line bg-white px-4 py-1.5 text-slate-soft hover:bg-linen"
            >
              Discard it
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
