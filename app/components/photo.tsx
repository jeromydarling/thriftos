import { shot, shotSrc } from "../content/imagery";

/**
 * The homepage photography, placed.
 *
 * Every image here is decorative — it carries mood, not information, and
 * everything it might be said to convey is already in the prose beside it. So
 * they are hidden from assistive technology rather than given descriptions
 * that would be read aloud to no purpose. The written alt text in
 * app/content/imagery.ts is there for whoever regenerates the set, not for the
 * page; a screen reader announcing "a rail of second-hand wool coats" between
 * two paragraphs about payment fees is noise, not access.
 *
 * Dimensions are always set. The images are square and 1024px, and a photo
 * that arrives after the text has painted shoves the page down under the
 * reader's cursor.
 */

const SIZE = 1024;

/**
 * A photograph behind a section, washed out enough to read text over.
 *
 * Sits underneath the aurora and grid layers rather than replacing them —
 * the gradient is what makes the page feel like software and the photograph is
 * what makes it feel like a shop, and the page wants both.
 */
export function Backdrop({
  id,
  className = "",
  eager = false,
}: {
  id: string;
  className?: string;
  eager?: boolean;
}) {
  if (!shot(id)) return null;

  return (
    <div className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`} aria-hidden="true">
      <img
        src={shotSrc(id)}
        alt=""
        width={SIZE}
        height={SIZE}
        loading={eager ? "eager" : "lazy"}
        decoding="async"
        fetchPriority={eager ? "high" : "auto"}
        className="h-full w-full object-cover"
      />
    </div>
  );
}

/**
 * A full-bleed photographic band between two sections.
 *
 * The homepage is a dense run of live product demos, and running them back to
 * back reads as a specification rather than an argument. These are the breaths
 * between — which is also why they're short, and why most carry no text at all.
 */
export function Band({
  id,
  children,
  tall = false,
}: {
  id: string;
  children?: React.ReactNode;
  tall?: boolean;
}) {
  if (!shot(id)) return null;

  return (
    <section
      className={`relative overflow-hidden border-y border-line ${tall ? "h-72 sm:h-96" : "h-40 sm:h-56"}`}
    >
      <img
        src={shotSrc(id)}
        alt=""
        aria-hidden="true"
        width={SIZE}
        height={SIZE}
        loading="lazy"
        decoding="async"
        className="absolute inset-0 h-full w-full object-cover"
      />
      {children ? (
        <div className="relative flex h-full items-center justify-center px-4">
          {/* Scrim rather than a lighter photograph: the words have to stay
              readable whichever part of the image lands behind them. */}
          <div className="absolute inset-0 bg-bark/45" aria-hidden="true" />
          <p className="relative max-w-2xl text-center font-display text-xl leading-relaxed text-linen sm:text-2xl">
            {children}
          </p>
        </div>
      ) : null}
    </section>
  );
}
