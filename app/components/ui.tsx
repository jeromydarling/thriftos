/**
 * Shared UI. Deliberately small and deliberately large-of-touch: the person
 * using the register may be a first-time volunteer who was handed a tablet
 * ten minutes ago.
 */
import { Link } from "react-router";

export function Card({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-2xl border border-line bg-white p-6 ${className}`}>{children}</div>
  );
}

/**
 * A table that scrolls sideways on a phone instead of being crushed by it.
 *
 * Four screens had `overflow-hidden` around a table with no minimum width, and
 * two had `overflow-x-auto` with one. Same intent, opposite result: the first
 * four squeezed every column until the last one was clipped off the screen with
 * no way to reach it, and one of them pushed the whole page sideways. The
 * difference is a class nobody can see missing, which is why it is a component
 * now rather than a convention.
 *
 * The shadows are the other half. A table that scrolls but doesn't look like it
 * scrolls is a table people think is broken — so the edges carry a soft shadow
 * that appears only when there is more content that way. It's done with
 * `background-attachment`: the white covers sit in the scroller's own
 * coordinate space and slide away from the shadows underneath as you scroll,
 * which needs no JavaScript and no resize observer.
 */
export function TableScroll({
  children,
  minWidth = "34rem",
  className = "",
}: {
  children: React.ReactNode;
  /** How wide the content needs before squeezing hurts. */
  minWidth?: string;
  className?: string;
}) {
  return (
    <div
      // min-w-0 is not decoration. As a grid or flex child this box would
      // otherwise be sized by the minimum width of what's inside it — so the
      // scroller itself becomes 34rem wide, drags its whole track with it, and
      // pushes the page sideways. The scroll container has to be allowed to be
      // narrower than its contents; that is the entire point of it.
      className={`min-w-0 overflow-x-auto rounded-2xl border border-line bg-white ${className}`}
      style={{
        backgroundImage: [
          "linear-gradient(to right, #fff 40%, rgba(255,255,255,0))",
          "linear-gradient(to left, #fff 40%, rgba(255,255,255,0))",
          "radial-gradient(farthest-side at 0 50%, rgba(47,42,38,0.13), rgba(47,42,38,0))",
          "radial-gradient(farthest-side at 100% 50%, rgba(47,42,38,0.13), rgba(47,42,38,0))",
        ].join(","),
        backgroundPosition: "left center, right center, left center, right center",
        backgroundSize: "36px 100%, 36px 100%, 14px 100%, 14px 100%",
        backgroundRepeat: "no-repeat",
        // The covers scroll with the content; the shadows stay put. That is
        // what makes a shadow show up only on the side with more to see.
        backgroundAttachment: "local, local, scroll, scroll",
      }}
    >
      <div style={{ minWidth }}>{children}</div>
    </div>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "moss" | "amber";
}) {
  const toneClass =
    tone === "moss" ? "text-moss" : tone === "amber" ? "text-clay" : "text-bark";
  return (
    <div className="rounded-2xl border border-line bg-white p-5">
      <p className="text-xs uppercase tracking-wider text-slate-soft">{label}</p>
      <p className={`mt-2 font-display text-3xl ${toneClass}`}>{value}</p>
      {hint ? <p className="mt-1 text-xs text-slate-soft">{hint}</p> : null}
    </div>
  );
}

export function Button({
  children,
  variant = "primary",
  className = "",
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "quiet";
}) {
  const styles = {
    primary: "bg-moss text-white hover:bg-moss-deep",
    secondary: "border border-line bg-white text-bark hover:bg-linen",
    quiet: "text-slate-soft hover:text-bark",
  }[variant];

  return (
    <button
      {...rest}
      className={`touch-target inline-flex items-center justify-center gap-2 rounded-xl px-5 py-3 font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${styles} ${className}`}
    >
      {children}
    </button>
  );
}

export function LinkButton({
  to,
  children,
  variant = "primary",
  className = "",
}: {
  to: string;
  children: React.ReactNode;
  variant?: "primary" | "secondary";
  className?: string;
}) {
  const styles =
    variant === "primary"
      ? "bg-moss text-white hover:bg-moss-deep"
      : "border border-line bg-white text-bark hover:bg-linen";
  return (
    <Link
      to={to}
      prefetch="intent"
      className={`touch-target inline-flex items-center justify-center gap-2 rounded-xl px-5 py-3 font-medium transition ${styles} ${className}`}
    >
      {children}
    </Link>
  );
}

export function Field({
  label,
  name,
  hint,
  children,
}: {
  label: string;
  name: string;
  hint?: string;
  children?: React.ReactNode;
}) {
  return (
    <label htmlFor={name} className="block">
      <span className="mb-1.5 block text-sm font-medium text-bark">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-slate-soft">{hint}</span> : null}
    </label>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`touch-target w-full rounded-xl border border-line bg-white px-4 py-3 text-bark outline-none focus:border-moss ${props.className ?? ""}`}
    />
  );
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`touch-target w-full rounded-xl border border-line bg-white px-4 py-3 text-bark outline-none focus:border-moss ${props.className ?? ""}`}
    />
  );
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={`w-full rounded-xl border border-line bg-white px-4 py-3 text-bark outline-none focus:border-moss ${props.className ?? ""}`}
    />
  );
}

/** Kind and specific, never blaming. */
export function Notice({
  tone = "info",
  children,
}: {
  tone?: "info" | "warn" | "good";
  children: React.ReactNode;
}) {
  const styles = {
    info: "border-line bg-white text-bark",
    warn: "border-clay/30 bg-clay/5 text-clay",
    good: "border-moss/30 bg-moss/5 text-moss-deep",
  }[tone];
  return (
    <div className={`rounded-xl border px-4 py-3 text-sm leading-relaxed ${styles}`}>
      {children}
    </div>
  );
}

export function Badge({
  children,
  color = "#6B7280",
}: {
  children: React.ReactNode;
  color?: string;
}) {
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium"
      style={{ backgroundColor: `${color}1A`, color }}
    >
      {children}
    </span>
  );
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-line bg-white/60 px-6 py-12 text-center">
      <p className="font-display text-lg text-bark">{title}</p>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-slate-soft">{body}</p>
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  );
}

export function money(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.round(cents));
  return `${sign}$${Math.floor(abs / 100).toLocaleString("en-US")}.${String(abs % 100).padStart(2, "0")}`;
}
