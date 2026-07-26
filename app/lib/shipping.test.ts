import { describe, expect, it } from "vitest";
import {
  ASSUMED_GRAMS,
  SUGGESTED_BANDS,
  lbsToGrams,
  orderGrams,
  quoteFor,
  type ShippableLine,
  type ShippingBand,
} from "./shipping";

const bands: ShippingBand[] = SUGGESTED_BANDS.map((b, i) => ({ ...b, id: `sb_${i}` }));

const line = (title: string, weightLbs: number | null): ShippableLine => ({
  itemId: `it_${title}`,
  title,
  weightLbs,
});

describe("weight", () => {
  it("converts pounds to grams the way a scale would", () => {
    expect(lbsToGrams(1)).toBe(454);
    expect(lbsToGrams(2.2)).toBe(998);
    expect(lbsToGrams(0.5)).toBe(227);
  });

  it("assumes a weight for an item nobody weighed, and says which", () => {
    // Not zero. Zero would post a coat in the cheapest band and lose the shop
    // money on every unweighed item — silent and compounding.
    const { grams, assumed } = orderGrams([line("Wool coat", null), line("Paperback", 0.6)]);
    expect(grams).toBe(ASSUMED_GRAMS + lbsToGrams(0.6));
    expect(assumed).toEqual(["Wool coat"]);
  });

  it("treats a zero or negative recorded weight as unrecorded", () => {
    // A scale that read zero is a scale nobody put the item on.
    expect(orderGrams([line("Ghost", 0)]).assumed).toEqual(["Ghost"]);
    expect(orderGrams([line("Impossible", -3)]).assumed).toEqual(["Impossible"]);
  });

  it("adds nothing for packaging", () => {
    // Padding here is a second, invisible price rise on top of the band. A shop
    // that wants to cover boxes should say so in the band price.
    expect(orderGrams([line("Mug", 1)]).grams).toBe(lbsToGrams(1));
  });
});

describe("quoting a band", () => {
  it("picks the cheapest band that will carry the order", () => {
    expect(quoteFor([line("Scarf", 0.4)], bands).band?.label).toMatch(/Large letter/);
    expect(quoteFor([line("Jumper", 1.5)], bands).band?.label).toMatch(/Small parcel/);
    expect(quoteFor([line("Winter coat", 6)], bands).band?.label).toMatch(/^Parcel/);
  });

  it("treats a band's weight as inclusive", () => {
    // 750g in a 750g band. An exclusive bound would bump an exactly-on-the-line
    // order into the next price for no reason a customer could understand.
    const exact: ShippingBand[] = [{ id: "sb_x", label: "Exactly", max_grams: 750, price_cents: 100, sort_order: 0 }];
    expect(quoteFor([{ itemId: "i", title: "t", weightLbs: 750 / 453.59237 }], exact).band).not.toBeNull();
  });

  it("sums a multi-item order rather than pricing the heaviest", () => {
    const q = quoteFor([line("Jumper", 1.2), line("Jeans", 1.4), line("Boots", 2.5)], bands);
    expect(q.grams).toBe(lbsToGrams(1.2) + lbsToGrams(1.4) + lbsToGrams(2.5));
    expect(q.band?.label).toMatch(/^Parcel/);
  });

  it("sorts by weight, not by price, so a mispriced band stays visible", () => {
    // A shop that priced its heavy band cheaper has made a mistake. Quietly
    // picking the cheaper one hides it; picking by weight lets them find it.
    const odd: ShippingBand[] = [
      { id: "a", label: "Light", max_grams: 500, price_cents: 900, sort_order: 0 },
      { id: "b", label: "Heavy", max_grams: 5000, price_cents: 100, sort_order: 1 },
    ];
    expect(quoteFor([line("Sock", 0.2)], odd).band?.label).toBe("Light");
    expect(quoteFor([line("Sock", 0.2)], odd).priceCents).toBe(900);
  });

  it("refuses an order heavier than every band, and says what to do instead", () => {
    const q = quoteFor([line("Cast iron bath", 200)], bands);
    expect(q.band).toBeNull();
    expect(q.priceCents).toBe(0);
    // Collection is very often the answer, and a shopper left with "too heavy"
    // has nothing to do next.
    expect(q.reason).toMatch(/collect/i);
  });

  it("says postage isn't set up rather than quoting nothing at zero", () => {
    const q = quoteFor([line("Scarf", 0.3)], []);
    expect(q.band).toBeNull();
    expect(q.priceCents).toBe(0);
    expect(q.reason).toMatch(/postage/i);
    expect(q.reason).toMatch(/collect/i);
  });

  it("never returns a price without a band behind it", () => {
    // The invariant the checkout depends on: a quote either has a band and a
    // price, or has neither and a reason.
    for (const lines of [[line("a", 0.1)], [line("b", 500)], []]) {
      const q = quoteFor(lines, bands);
      expect(Boolean(q.band), JSON.stringify(lines)).toBe(q.priceCents > 0 || q.band !== null);
      if (!q.band) expect(q.priceCents).toBe(0);
    }
  });

  it("carries the assumed-weight list through to the quote", () => {
    // The shop needs to see what it's guessing at, on the order, not only at
    // intake where it's too late to matter.
    const q = quoteFor([line("Unweighed lamp", null)], bands);
    expect(q.assumed).toEqual(["Unweighed lamp"]);
  });
});

describe("the suggested bands", () => {
  it("rise in both weight and price", () => {
    for (let i = 1; i < SUGGESTED_BANDS.length; i++) {
      expect(SUGGESTED_BANDS[i].max_grams).toBeGreaterThan(SUGGESTED_BANDS[i - 1].max_grams);
      expect(SUGGESTED_BANDS[i].price_cents).toBeGreaterThan(SUGGESTED_BANDS[i - 1].price_cents);
    }
  });

  it("does not let a jumper through at the letter rate", () => {
    // The regression these defaults were written wrong for: a 1.5lb jumper is
    // inside every letter *weight* limit and will never go as one, because
    // letters are limited by thickness. Weight has to stand in for a dimension
    // we can't measure, and it must err toward the parcel rate.
    expect(quoteFor([line("Jumper", 1.5)], bands).band?.label).toMatch(/parcel/i);
  });

  it("covers an ordinary armful of clothing", () => {
    // The common case is two or three garments. If that doesn't fit a band out
    // of the box, the defaults are wrong.
    const q = quoteFor([line("Shirt", 0.6), line("Jumper", 1.2), line("Jeans", 1.4)], bands);
    expect(q.band).not.toBeNull();
  });

  it("describes each band in things, not in grams", () => {
    // "Large letter — a scarf, a book" is checkable by someone holding a scarf.
    for (const b of SUGGESTED_BANDS) expect(b.label).toMatch(/—/);
  });
});
