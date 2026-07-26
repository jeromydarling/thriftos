/**
 * Rendering a shop's page.
 *
 * Every block is handed already-gathered live data. Nothing here queries, so
 * the storefront loader can fetch once and render many blocks without turning
 * one page into a dozen round trips.
 *
 * A live block with nothing to show renders nothing at all rather than an empty
 * heading. A public page is not the place to advertise that a shop hasn't
 * filled something in.
 */
import { Link } from "react-router";
import type { Block } from "../lib/site";
import type { RenderPalette } from "../lib/brand";

export interface PageData {
  /** The shop's path prefix, so a card can link to /{shop}/item/{id}. */
  base: string;
  shopName: string;
  tagline: string;
  addressLines: string[];
  phone: string | null;
  hours: string[];
  donationHours: string[];
  accepted: string[];
  notAccepted: string[];
  ladder: { tagColor: string; discountPct: number; ageDays: number }[];
  featured: {
    id: string;
    title: string;
    category: string | null;
    priceCents: number;
    listPriceCents: number;
    discountPct: number;
    photoKey: string | null;
  }[];
  impact: {
    diversionLbs: number;
    itemsRehomed: number;
    volunteerHours: number;
    valueDeliveredCents: number;
  } | null;
  openShifts: { label: string; when: string }[];
}

const money = (cents: number) => `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;

const TAG_HEX: Record<string, string> = {
  green: "#3E8E5A",
  yellow: "#E0B62C",
  blue: "#3D6FA8",
  red: "#C0453A",
  white: "#F2F0EC",
  orange: "#D4762C",
  purple: "#7A5A9E",
  pink: "#C96792",
};

export function Blocks({
  blocks,
  data,
  palette,
  fonts,
}: {
  blocks: Block[];
  data: PageData;
  palette: RenderPalette;
  fonts: { display: string; body: string };
}) {
  return (
    <>
      {blocks.map((block, i) => (
        <BlockView key={`${block.kind}-${i}`} block={block} data={data} palette={palette} fonts={fonts} />
      ))}
    </>
  );
}

function Section({
  heading,
  palette,
  fonts,
  children,
}: {
  heading: string;
  palette: RenderPalette;
  fonts: { display: string; body: string };
  children: React.ReactNode;
}) {
  return (
    <section className="mx-auto max-w-5xl px-4 py-10">
      {heading ? (
        <h2
          className="text-2xl"
          style={{ fontFamily: fonts.display, color: palette.headingText }}
        >
          {heading}
        </h2>
      ) : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function BlockView({
  block,
  data,
  palette,
  fonts,
}: {
  block: Block;
  data: PageData;
  palette: RenderPalette;
  fonts: { display: string; body: string };
}) {
  const body = <span style={{ color: palette.bodyText }} />;
  void body;

  switch (block.kind) {
    case "intro": {
      const heading = block.heading || data.shopName;
      const text = block.body || data.tagline;
      return (
        <section className="mx-auto max-w-5xl px-4 pb-4 pt-12">
          <h1 className="text-4xl" style={{ fontFamily: fonts.display, color: palette.headingText }}>
            {heading}
          </h1>
          {text ? (
            <p
              className="mt-4 max-w-2xl text-lg leading-relaxed"
              style={{ color: palette.bodyText }}
            >
              {text}
            </p>
          ) : null}
        </section>
      );
    }

    case "text":
      if (!block.heading && !block.body) return null;
      return (
        <Section heading={block.heading} palette={palette} fonts={fonts}>
          {block.body ? (
            <div className="max-w-2xl space-y-4 leading-relaxed" style={{ color: palette.bodyText }}>
              {block.body.split(/\n{2,}/).map((para) => (
                <p key={para}>{para}</p>
              ))}
            </div>
          ) : null}
        </Section>
      );

    case "hours":
      if (data.hours.length === 0 && data.donationHours.length === 0) return null;
      return (
        <Section heading={block.heading || "When we're open"} palette={palette} fonts={fonts}>
          <div className="grid gap-6 sm:grid-cols-2">
            {data.hours.length > 0 ? (
              <div>
                <p className="text-sm font-medium" style={{ color: palette.headingText }}>
                  The shop
                </p>
                <ul className="mt-2 space-y-1 leading-relaxed" style={{ color: palette.bodyText }}>
                  {data.hours.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {data.donationHours.length > 0 ? (
              <div>
                <p className="text-sm font-medium" style={{ color: palette.headingText }}>
                  Donations
                </p>
                <ul className="mt-2 space-y-1 leading-relaxed" style={{ color: palette.bodyText }}>
                  {data.donationHours.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </Section>
      );

    case "featured":
      if (data.featured.length === 0) return null;
      return (
        <Section heading={block.heading || "In at the moment"} palette={palette} fonts={fonts}>
          <p className="mb-5 max-w-2xl text-sm leading-relaxed" style={{ color: palette.bodyText }}>
            Everything here is one of a kind, and this list is what's genuinely on the floor right
            now. When something sells it drops off on its own.
          </p>
          {/* items-start, so a card with no photograph is a short card rather
              than a tall one with a hole in it. Stretching every card to the
              tallest in its row is what made a mixed grid look broken. */}
          <ul className="grid items-start gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {data.featured.map((item) => (
              <li
                key={item.id}
                className="overflow-hidden rounded-2xl border transition hover:shadow-md"
                style={{ borderColor: `${palette.primary}22`, background: "#fff" }}
              >
                {/* The whole card is the link. A shopper on a phone aiming at a
                    small title is a shopper who doesn't reach the item. */}
                <a href={`${data.base}/item/${item.id}`} className="block">
                {/* Square, because that is what the photo cleanup produces and
                    a grid of squares is the whole point of it. A 4:3 tile crops
                    a quarter off a tidied square, which is how a hem leaves the
                    picture after all the work taken not to crop it. */}
                {item.photoKey ? (
                  <img
                    src={`/api/media/${item.photoKey}?w=600`}
                    alt=""
                    loading="lazy"
                    className="aspect-square w-full object-cover"
                  />
                ) : null}
                <div className="p-4">
                  <p className="font-medium" style={{ color: palette.headingText }}>
                    {item.title}
                  </p>
                  {item.category ? (
                    <p className="mt-0.5 text-xs" style={{ color: palette.bodyText }}>
                      {item.category}
                    </p>
                  ) : null}
                  <p className="mt-2 flex items-baseline gap-2">
                    <span className="text-lg font-medium" style={{ color: palette.headingText }}>
                      {money(item.priceCents)}
                    </span>
                    {item.discountPct > 0 ? (
                      <span className="text-xs line-through" style={{ color: palette.bodyText }}>
                        {money(item.listPriceCents)}
                      </span>
                    ) : null}
                  </p>
                </div>
                </a>
              </li>
            ))}
          </ul>
        </Section>
      );

    case "impact": {
      if (!data.impact) return null;
      const figures = [
        data.impact.diversionLbs > 0
          ? [
              data.impact.diversionLbs >= 2000
                ? `${(data.impact.diversionLbs / 2000).toFixed(1)} tons`
                : `${Math.round(data.impact.diversionLbs)} lbs`,
              "kept out of landfill",
            ]
          : null,
        data.impact.itemsRehomed > 0
          ? [data.impact.itemsRehomed.toLocaleString("en-US"), "items given a second life"]
          : null,
        data.impact.volunteerHours > 0
          ? [Math.round(data.impact.volunteerHours).toLocaleString("en-US"), "volunteer hours"]
          : null,
        data.impact.valueDeliveredCents > 0
          ? [money(data.impact.valueDeliveredCents), "saved by people shopping here"]
          : null,
      ].filter((f): f is string[] => f !== null);

      // Every figure zero means nothing worth saying, not a row of zeroes.
      if (figures.length === 0) return null;

      return (
        <Section heading={block.heading || "What your shopping does"} palette={palette} fonts={fonts}>
          <dl className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {figures.map(([value, label]) => (
              <div key={label}>
                <dt
                  className="text-3xl"
                  style={{ fontFamily: fonts.display, color: palette.headingText }}
                >
                  {value}
                </dt>
                <dd className="mt-1 text-sm leading-relaxed" style={{ color: palette.bodyText }}>
                  {label}
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-6 max-w-2xl text-xs leading-relaxed" style={{ color: palette.bodyText }}>
            Diversion is the weight of goods that actually left for reuse, not what arrived. Value
            saved counts only items where a comparable retail price was recorded — where none was,
            it counts nothing rather than an estimate.
          </p>
        </Section>
      );
    }

    case "donate":
      if (data.donationHours.length === 0 && data.accepted.length === 0) return null;
      return (
        <Section heading={block.heading || "Donating things"} palette={palette} fonts={fonts}>
          {block.body ? (
            <p className="mb-5 max-w-2xl leading-relaxed" style={{ color: palette.bodyText }}>
              {block.body}
            </p>
          ) : null}
          {data.donationHours.length > 0 ? (
            <p className="mb-5 leading-relaxed" style={{ color: palette.bodyText }}>
              Bring donations {data.donationHours.join("; ")}.
            </p>
          ) : null}
          <div className="grid gap-6 sm:grid-cols-2">
            {data.accepted.length > 0 ? (
              <div>
                <p className="text-sm font-medium" style={{ color: palette.headingText }}>
                  We can take
                </p>
                <ul className="mt-2 space-y-1 leading-relaxed" style={{ color: palette.bodyText }}>
                  {data.accepted.map((line) => (
                    <li key={line}>· {line}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {data.notAccepted.length > 0 ? (
              <div>
                <p className="text-sm font-medium" style={{ color: palette.headingText }}>
                  We can't take
                </p>
                <ul className="mt-2 space-y-1 leading-relaxed" style={{ color: palette.bodyText }}>
                  {data.notAccepted.map((line) => (
                    <li key={line}>· {line}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </Section>
      );

    case "tags":
      if (data.ladder.length === 0) return null;
      return (
        <Section heading={block.heading || "How our tags work"} palette={palette} fonts={fonts}>
          <p className="mb-5 max-w-2xl leading-relaxed" style={{ color: palette.bodyText }}>
            Every item gets a coloured tag the day it reaches the floor. As it ages the price steps
            down on its own — the till always charges today's price.
          </p>
          <ul className="space-y-2">
            {data.ladder.map((rule) => (
              <li key={rule.tagColor} className="flex items-center gap-3">
                <span
                  className="h-6 w-6 shrink-0 rounded"
                  style={{
                    background: TAG_HEX[rule.tagColor.toLowerCase()] ?? palette.accent,
                    border: `1px solid ${palette.primary}22`,
                  }}
                  aria-hidden="true"
                />
                <span className="font-medium capitalize" style={{ color: palette.headingText }}>
                  {rule.tagColor}
                </span>
                <span style={{ color: palette.bodyText }}>
                  {rule.discountPct === 0
                    ? "full price"
                    : `${rule.discountPct}% off after ${rule.ageDays} days`}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      );

    case "volunteer":
      return (
        <Section heading={block.heading || "Could you spare a few hours?"} palette={palette} fonts={fonts}>
          <p className="max-w-2xl leading-relaxed" style={{ color: palette.bodyText }}>
            {block.body ||
              "We need people on the floor, on the till, and sorting donations. No experience needed — we'll show you everything."}
          </p>
          {data.openShifts.length > 0 ? (
            <ul className="mt-4 space-y-1" style={{ color: palette.bodyText }}>
              {data.openShifts.map((shift) => (
                <li key={`${shift.label}-${shift.when}`}>
                  · {shift.label} — {shift.when}
                </li>
              ))}
            </ul>
          ) : null}
        </Section>
      );

    case "contact":
      if (data.addressLines.length === 0 && !data.phone) return null;
      return (
        <Section heading={block.heading || "Where to find us"} palette={palette} fonts={fonts}>
          <address className="not-italic leading-relaxed" style={{ color: palette.bodyText }}>
            {data.addressLines.map((line) => (
              <div key={line}>{line}</div>
            ))}
            {data.phone ? (
              <div className="mt-2">
                <a href={`tel:${data.phone.replace(/[^\d+]/g, "")}`} className="underline">
                  {data.phone}
                </a>
              </div>
            ) : null}
          </address>
        </Section>
      );
  }
}

/** The shop's own navigation, from its published pages. */
export function SiteNav({
  base,
  pages,
  palette,
  fonts,
  shopName,
}: {
  base: string;
  pages: { slug: string; label: string }[];
  palette: RenderPalette;
  fonts: { display: string; body: string };
  shopName: string;
}) {
  return (
    <header style={{ borderBottom: `1px solid ${palette.primary}22`, background: "#fff" }}>
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-4">
        <Link
          to={base || "/"}
          className="text-xl"
          style={{ fontFamily: fonts.display, color: palette.headingText }}
        >
          {shopName}
        </Link>
        {pages.length > 0 ? (
          <nav>
            <ul className="flex flex-wrap gap-4 text-sm">
              {pages.map((page) => (
                <li key={page.slug}>
                  <Link
                    to={page.slug ? `${base}/${page.slug}` : base || "/"}
                    style={{ color: palette.bodyText }}
                    className="hover:underline"
                  >
                    {page.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}
      </div>
    </header>
  );
}
