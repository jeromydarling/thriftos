import { describe, expect, it } from "vitest";
import { ASSETS, esc, renderAsset, wrap, type ShopFacts } from "./assets";
import { DEFAULT_BRAND } from "../brand";

const FULL: ShopFacts = {
  name: "Second Chances Thrift",
  tagline: "Second-hand, first-rate",
  addressLines: ["418 Mill Street", "Rockbridge, OH 43149"],
  phone: "(740) 555-0142",
  siteUrl: "thriftos.app/second-chances",
  ladder: [
    { tagColor: "green", discountPct: 0, ageDays: 0 },
    { tagColor: "yellow", discountPct: 25, ageDays: 14 },
    { tagColor: "blue", discountPct: 50, ageDays: 28 },
  ],
  impact: {
    diversionLbs: 8400,
    itemsRehomed: 1240,
    volunteerHours: 960,
    valueDeliveredCents: 4_120_00,
  },
  arrivals: [{ title: "Wool peacoat", priceCents: 2400, category: "Outerwear" }],
  openShifts: [{ label: "Sorting", when: "Thursday, Aug 6" }],
  hours: ["Tue–Sat, 10–5"],
  donationHours: ["Tue–Fri, 10–4"],
  accepted: ["Clean clothing"],
  notAccepted: ["Mattresses"],
};

/** A shop that has only just signed up. */
const EMPTY: ShopFacts = {
  ...FULL,
  ladder: [],
  impact: null,
  arrivals: [],
  openShifts: [],
  hours: [],
  donationHours: [],
  accepted: [],
  notAccepted: [],
};

function render(kind: Parameters<typeof renderAsset>[0], facts = FULL) {
  return renderAsset(kind, DEFAULT_BRAND, facts);
}

describe("every asset", () => {
  for (const spec of ASSETS) {
    it(`${spec.kind} renders valid, sized SVG`, () => {
      const svg = render(spec.kind);
      expect(svg.startsWith("<svg")).toBe(true);
      expect(svg.trimEnd().endsWith("</svg>")).toBe(true);
      expect(svg).toContain(`viewBox="0 0 ${spec.width} ${spec.height}"`);
      // Unbalanced angle brackets mean a broken document in a print dialog.
      expect((svg.match(/</g) ?? []).length).toBe((svg.match(/>/g) ?? []).length);
    });

    it(`${spec.kind} survives a shop with no data`, () => {
      const svg = render(spec.kind, EMPTY);
      expect(svg.startsWith("<svg")).toBe(true);
      expect(svg).not.toContain("undefined");
      expect(svg).not.toContain("NaN");
      expect(svg).not.toContain("null");
    });

    it(`${spec.kind} is deterministic`, () => {
      expect(render(spec.kind)).toBe(render(spec.kind));
    });

    it(`${spec.kind} carries an accessible label`, () => {
      expect(render(spec.kind)).toContain('role="img"');
    });
  }
});

describe("assets tell the truth", () => {
  it("prints the shop's real discount, not a made-up one", () => {
    const svg = render("sale_sign");
    // Blue is the deepest live markdown in FULL, at 50%.
    expect(svg).toContain("Blue tags");
    expect(svg).toContain("50% off");
  });

  it("says there's no sale rather than inventing one", () => {
    const svg = render("sale_sign", EMPTY);
    // Headline text is wrapped across separate <text> elements, so assert on
    // the words rather than the whole sentence.
    expect(svg).toContain("No markdowns");
    expect(svg).not.toContain("% off");
  });

  it("refuses to print four zeroes as an impact report", () => {
    const svg = render("impact_poster", EMPTY);
    expect(svg).toContain("Nothing to report yet");
    expect(svg).not.toMatch(/>0 lbs</);
  });

  it("states the method beside the impact figures", () => {
    const svg = render("impact_poster");
    expect(svg).toMatch(/actually left for reuse/);
    expect(svg).toMatch(/counts nothing rather than an estimate/);
  });

  it("shows real tons rather than a rounded-up boast", () => {
    // 8400 lbs is 4.2 tons.
    expect(render("impact_poster")).toContain("4.2 tons");
  });

  it("posts about stock that's genuinely on the floor", () => {
    const svg = render("social_arrival");
    expect(svg).toContain("Wool peacoat");
    expect(svg).toContain("$24");
  });

  it("admits it when there's nothing to post about", () => {
    expect(render("social_arrival", EMPTY)).toContain("Nothing listed");
  });

  it("lists the shifts actually unfilled", () => {
    expect(render("volunteer_call")).toContain("Sorting");
  });

  it("lists the whole rotation on the tag sheet", () => {
    const svg = render("tag_ladder");
    expect(svg).toContain("Green");
    expect(svg).toContain("Yellow");
    expect(svg).toContain("Blue");
    expect(svg).toContain("Full price");
  });
});

describe("escaping", () => {
  it("escapes the five XML characters", () => {
    expect(esc(`<&>"'`)).toBe("&lt;&amp;&gt;&quot;&apos;");
  });

  it("a shop name with an ampersand doesn't break the document", () => {
    const svg = render("hours_card", { ...FULL, name: "Bell & Sons Thrift" });
    expect(svg).toContain("Bell &amp; Sons Thrift");
    expect(svg).not.toContain("Bell & Sons");
  });

  it("a shop name containing a tag is neutralised", () => {
    const svg = renderAsset("hours_card", DEFAULT_BRAND, {
      ...FULL,
      name: '<script>alert(1)</script>',
    });
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("&lt;script&gt;");
  });
});

describe("wrap", () => {
  it("breaks on whole words", () => {
    expect(wrap("the quick brown fox", 10)).toEqual(["the quick", "brown fox"]);
  });

  it("stops at the line limit and marks the truncation", () => {
    const lines = wrap("one two three four five six seven eight nine ten", 8, 2);
    expect(lines).toHaveLength(2);
    expect(lines[1].endsWith("…")).toBe(true);
  });

  it("doesn't mark a truncation when everything fitted", () => {
    expect(wrap("short", 20, 2)).toEqual(["short"]);
  });

  it("returns nothing for empty text rather than a blank line", () => {
    expect(wrap("   ", 20)).toEqual([]);
  });
});

describe("the brand is honoured", () => {
  it("uses the shop's own colours", () => {
    const svg = renderAsset("tag_ladder", { ...DEFAULT_BRAND, primary: "#123456" }, FULL);
    expect(svg).toContain("#123456");
  });

  it("corrects a colour that would be unreadable rather than printing it", () => {
    // Pale yellow headings on a cream page: legible to nobody.
    const svg = renderAsset(
      "tag_ladder",
      { ...DEFAULT_BRAND, primary: "#f5e6a8", surface: "#faf7f2" },
      FULL
    );
    // The raw colour still appears as a block fill, but heading text must not
    // be drawn in it.
    expect(svg).toMatch(/<text[^>]*fill="#(?!f5e6a8)[0-9a-f]{6}"[^>]*>How our tags work/);
  });
});
