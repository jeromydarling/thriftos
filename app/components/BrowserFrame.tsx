import { useEffect, useRef, useState } from "react";
/**
 * A chromeless browser frame for the product demos.
 *
 * Deliberately minimal — a soft window, a faint URL pill, no toolbars or
 * bookmark bars. The point is to say "this is the real thing, running" without
 * making the visitor look at browser furniture.
 *
 * Everything inside these frames is live React, not a screenshot. That matters:
 * screenshots go stale the week after you take them, and these can't.
 */

export function BrowserFrame({
  url,
  children,
  className = "",
  tone = "app",
  floating = false,
  reserve = false,
}: {
  url: string;
  children: React.ReactNode;
  className?: string;
  tone?: "app" | "pos";
  floating?: boolean;
  /**
   * Hold the content area open at the tallest height it has been.
   *
   * For a frame whose contents cycle. Without it the frame is the height of
   * whichever demo is showing, so the page grows and shrinks under someone
   * reading further down it — measured at up to 445px of movement on a phone,
   * which is half a screen.
   *
   * Measured rather than configured. A fixed pixel floor was the first attempt
   * and it was wrong: these demos wrap on a narrow viewport, so the tallest one
   * is 400px on a laptop and 819px on a phone, and any single number is either
   * too short somewhere or leaves a hole everywhere else.
   */
  reserve?: boolean;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [floor, setFloor] = useState(0);

  useEffect(() => {
    const el = contentRef.current;
    if (!reserve || !el || typeof ResizeObserver === "undefined") return;

    // Grow-only, so it settles: once the floor is the tallest demo, every
    // measurement equals the floor and nothing changes again.
    let width = window.innerWidth;
    const observer = new ResizeObserver(() => {
      // A different viewport width means different wrapping, and the old floor
      // would leave a gap under the content forever. Start again.
      if (window.innerWidth !== width) {
        width = window.innerWidth;
        setFloor(0);
        return;
      }
      const height = Math.ceil(el.getBoundingClientRect().height);
      setFloor((current) => (height > current ? height : current));
    });

    observer.observe(el);
    return () => observer.disconnect();
  }, [reserve]);

  return (
    <div
      className={`browser-frame overflow-hidden rounded-2xl border border-line/80 bg-white shadow-[0_24px_60px_-24px_rgba(47,42,38,0.35)] ${
        floating ? "motion-safe:animate-float" : ""
      } ${className}`}
    >
      <div className="flex items-center gap-3 border-b border-line/70 bg-linen/70 px-4 py-2.5">
        <div className="flex gap-1.5" aria-hidden="true">
          <span className="h-2.5 w-2.5 rounded-full bg-line" />
          <span className="h-2.5 w-2.5 rounded-full bg-line" />
          <span className="h-2.5 w-2.5 rounded-full bg-line" />
        </div>
        <div className="flex-1">
          <div className="mx-auto w-fit max-w-full truncate rounded-md bg-white/80 px-3 py-1 text-[11px] text-slate-soft">
            {url}
          </div>
        </div>
        <span
          className={`h-2 w-2 rounded-full ${tone === "pos" ? "bg-moss" : "bg-line"} ${
            tone === "pos" ? "motion-safe:animate-pulse-soft" : ""
          }`}
          aria-hidden="true"
        />
      </div>
      <div ref={contentRef} className="relative bg-linen/40" style={floor ? { minHeight: floor } : undefined}>
        {children}
      </div>
    </div>
  );
}

/** A tablet shell, for the register demo. Thrift shops run on tablets. */
export function TabletFrame({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`overflow-hidden rounded-[1.75rem] border-[10px] border-bark/85 bg-white shadow-[0_28px_70px_-28px_rgba(47,42,38,0.5)] ${className}`}
    >
      <div className="relative bg-linen/40">{children}</div>
    </div>
  );
}
