/**
 * Motion primitives.
 *
 * No animation library — these are small enough to own, and the marketing site
 * ships from the same Worker as the app, so every kilobyte is one the register
 * also pays for.
 *
 * Everything here degrades to "just visible" without JavaScript, and every
 * animation is switched off by `prefers-reduced-motion` in app.css. A page that
 * makes someone motion-sick is not a page that converts.
 */
import { useEffect, useRef, useState } from "react";

/** Fires once when the element first scrolls into view. */
export function useInView<T extends HTMLElement>(options?: { threshold?: number; rootMargin?: string }) {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    // No IntersectionObserver (or SSR hydration edge) — show it rather than
    // leaving content invisible forever.
    if (typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setInView(true);
            observer.disconnect();
          }
        }
      },
      { threshold: options?.threshold ?? 0.15, rootMargin: options?.rootMargin ?? "0px 0px -60px 0px" }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [options?.threshold, options?.rootMargin]);

  return { ref, inView };
}

export function Reveal({
  children,
  delay = 0,
  as: Tag = "div",
  className = "",
  from = "up",
}: {
  children: React.ReactNode;
  delay?: number;
  as?: "div" | "section" | "li" | "span";
  className?: string;
  from?: "up" | "left" | "right" | "scale";
}) {
  const { ref, inView } = useInView<HTMLDivElement>();

  // The sideways entrances are desktop-only, and that is a bug fix rather than
  // a taste call. A transform doesn't move the layout but it does count toward
  // scrollable overflow — so on a 390px screen an element still waiting to
  // slide in from the right sat 24px past the edge and gave the whole page a
  // horizontal scrollbar. You felt it as the page twitching sideways while you
  // read. Vertically there is nothing to hit, so `up` stays as it is.
  const hidden = {
    up: "translate-y-6",
    left: "sm:-translate-x-6",
    right: "sm:translate-x-6",
    scale: "scale-95",
  }[from];

  return (
    <Tag
      ref={ref as never}
      style={{ transitionDelay: `${delay}ms` }}
      className={`motion-safe:transition-all motion-safe:duration-700 motion-safe:ease-out ${
        inView ? "opacity-100 translate-x-0 translate-y-0 scale-100" : `opacity-0 ${hidden}`
      } ${className}`}
    >
      {children}
    </Tag>
  );
}

/**
 * Counts up to a number when scrolled into view.
 *
 * The value is rendered server-side at its final figure, so a visitor without
 * JavaScript — or a search crawler — sees the real number, not a zero.
 */
export function CountUp({
  to,
  duration = 1400,
  format = (n: number) => n.toLocaleString("en-US"),
  className = "",
}: {
  to: number;
  duration?: number;
  format?: (n: number) => string;
  className?: string;
}) {
  const { ref, inView } = useInView<HTMLSpanElement>();
  const [value, setValue] = useState(to);
  const started = useRef(false);

  useEffect(() => {
    // Only animate on the client, and only once.
    if (!inView || started.current) return;
    if (typeof window === "undefined") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

    started.current = true;
    setValue(0);
    const start = performance.now();

    let frame = 0;
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / duration);
      // easeOutExpo — fast, then settles.
      const eased = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);
      setValue(Math.round(to * eased));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [inView, to, duration]);

  return (
    <span ref={ref} className={className}>
      {format(value)}
    </span>
  );
}

/** Steps through children on an interval, for auto-playing showcases. */
export function useCycle(length: number, intervalMs = 4200, paused = false) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (paused || length <= 1) return;
    if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      return;
    }
    const timer = setInterval(() => setIndex((i) => (i + 1) % length), intervalMs);
    return () => clearInterval(timer);
  }, [length, intervalMs, paused]);

  return [index, setIndex] as const;
}

/**
 * A step sequence that plays, holds, then restarts — used by the register and
 * intake demos so a visitor sees the whole flow without touching anything.
 */
export function useSequence(steps: number, stepMs = 1100, holdMs = 2200) {
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setStep(steps - 1); // show the finished state
      return;
    }

    const delay = step === steps - 1 ? holdMs : stepMs;
    const timer = setTimeout(() => setStep((s) => (s + 1) % steps), delay);
    return () => clearTimeout(timer);
  }, [step, steps, stepMs, holdMs]);

  return step;
}

/** Infinite horizontal scroller. Duplicates children so the loop is seamless. */
export function Marquee({
  children,
  speed = 40,
  className = "",
}: {
  children: React.ReactNode;
  speed?: number;
  className?: string;
}) {
  return (
    <div className={`marquee ${className}`} aria-hidden="true">
      <div className="marquee-track" style={{ animationDuration: `${speed}s` }}>
        <div className="marquee-group">{children}</div>
        <div className="marquee-group">{children}</div>
      </div>
    </div>
  );
}

/** Types a string out character by character, looping through a list. */
export function Typewriter({
  phrases,
  className = "",
  typeMs = 55,
  holdMs = 1800,
}: {
  phrases: string[];
  className?: string;
  typeMs?: number;
  holdMs?: number;
}) {
  const [text, setText] = useState(phrases[0] ?? "");
  const [phraseIndex, setPhraseIndex] = useState(0);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

    const phrase = phrases[phraseIndex] ?? "";

    if (!deleting && text === phrase) {
      const timer = setTimeout(() => setDeleting(true), holdMs);
      return () => clearTimeout(timer);
    }

    if (deleting && text === "") {
      setDeleting(false);
      setPhraseIndex((i) => (i + 1) % phrases.length);
      return;
    }

    const timer = setTimeout(
      () => {
        setText((current) =>
          deleting ? phrase.slice(0, current.length - 1) : phrase.slice(0, current.length + 1)
        );
      },
      deleting ? typeMs / 2 : typeMs
    );
    return () => clearTimeout(timer);
  }, [text, deleting, phraseIndex, phrases, typeMs, holdMs]);

  // The phrases are different lengths, so a naively rendered typewriter
  // changes the width — and at some viewport widths the line count — of the
  // heading it sits in on every keystroke, and the whole page shuffles up and
  // down under the reader while they are trying to read it.
  //
  // Both spans occupy the same grid cell, so the box is always the size of the
  // longest phrase and the animated text is painted over the top of it.
  // Reserving a fixed width would be wrong: the longest phrase might wrap to
  // two lines on a narrow screen, and then two lines is the honest height.
  const longest = phrases.reduce((a, b) => (b.length > a.length ? b : a), "");

  return (
    <span className={`relative inline-grid ${className}`}>
      {/* Holds the space open. `invisible` rather than opacity-0 so it is out
          of the accessibility tree as well as out of sight. */}
      <span className="invisible col-start-1 row-start-1" aria-hidden="true">
        {longest}
      </span>

      {/* Announced instead of the animation. A heading that reads "Stop
          renting your card termin" to a screen reader is worse than one that
          doesn't move at all. */}
      <span className="sr-only">{phrases[0]}</span>

      <span className="col-start-1 row-start-1" aria-hidden="true">
        {text}
        <span className="caret" aria-hidden="true" />
      </span>
    </span>
  );
}
