import { describe, expect, it } from "vitest";
import { confidenceLabel, parseExtraction } from "./ai";

describe("parsing model output defensively", () => {
  it("reads a clean JSON response", () => {
    const result = parseExtraction(
      JSON.stringify({
        title: "Blue wool peacoat",
        category: "Outerwear",
        brand: "Pendleton",
        color: "navy",
        condition: "good",
        suggested_price_low: 12,
        suggested_price_high: 18,
        retail_estimate: 90,
        confidence: 0.8,
      })
    );
    expect(result?.title).toBe("Blue wool peacoat");
    expect(result?.suggestedPriceLowCents).toBe(1200);
    expect(result?.retailEstimateCents).toBe(9000);
    expect(result?.confidence).toBe(0.8);
  });

  it("digs the object out of a markdown fence", () => {
    const result = parseExtraction('```json\n{"title": "Red mug"}\n```');
    expect(result?.title).toBe("Red mug");
  });

  it("digs the object out of surrounding chatter", () => {
    const result = parseExtraction('Sure! Here is the JSON:\n{"title": "Red mug"}\nHope that helps.');
    expect(result?.title).toBe("Red mug");
  });

  it("returns null rather than guessing when there's no JSON at all", () => {
    expect(parseExtraction("I can't see the image clearly.")).toBeNull();
    expect(parseExtraction("")).toBeNull();
    expect(parseExtraction("{not valid json")).toBeNull();
  });
});

describe("never inventing a fact", () => {
  it("treats a model's stand-in words as null, not as a brand", () => {
    // A brand of "unknown" printed on a tag would be worse than a blank field.
    for (const value of ["null", "N/A", "none", "unknown", "unclear", "not visible", "  "]) {
      const result = parseExtraction(JSON.stringify({ brand: value }));
      expect(result?.brand, value).toBeNull();
    }
  });

  it("nulls a condition it doesn't recognise", () => {
    expect(parseExtraction(JSON.stringify({ condition: "pristine" }))?.condition).toBeNull();
    expect(parseExtraction(JSON.stringify({ condition: "good" }))?.condition).toBe("good");
  });

  it("nulls a missing field rather than filling it in", () => {
    const result = parseExtraction(JSON.stringify({ title: "Mug" }));
    expect(result?.brand).toBeNull();
    expect(result?.size).toBeNull();
    expect(result?.suggestedPriceLowCents).toBeNull();
  });
});

describe("money never becomes a float", () => {
  it("converts dollars to integer cents", () => {
    const result = parseExtraction(JSON.stringify({ suggested_price_low: 12.34 }));
    expect(result?.suggestedPriceLowCents).toBe(1234);
    expect(Number.isInteger(result?.suggestedPriceLowCents)).toBe(true);
  });

  it("rejects negative and non-numeric prices", () => {
    expect(parseExtraction(JSON.stringify({ suggested_price_low: -5 }))?.suggestedPriceLowCents).toBeNull();
    expect(parseExtraction(JSON.stringify({ suggested_price_low: "lots" }))?.suggestedPriceLowCents).toBeNull();
  });

  it("clamps an absurd price rather than putting it on a tag", () => {
    const result = parseExtraction(JSON.stringify({ suggested_price_low: 9_999_999 }));
    expect(result?.suggestedPriceLowCents).toBe(50_000);
  });

  it("drops a high price that sits below the low one", () => {
    const result = parseExtraction(
      JSON.stringify({ suggested_price_low: 20, suggested_price_high: 5 })
    );
    expect(result?.suggestedPriceHighCents).toBeNull();
  });
});

describe("confidence", () => {
  it("clamps out-of-range values", () => {
    expect(parseExtraction(JSON.stringify({ confidence: 5 }))?.confidence).toBe(1);
    expect(parseExtraction(JSON.stringify({ confidence: -2 }))?.confidence).toBe(0);
  });

  it("describes itself in words a volunteer can act on", () => {
    expect(confidenceLabel(0.9).tone).toBe("high");
    expect(confidenceLabel(0.5).tone).toBe("medium");
    expect(confidenceLabel(0.1).tone).toBe("low");
    // Never presented as certainty.
    expect(confidenceLabel(0.99).label.toLowerCase()).not.toContain("certain");
  });
});
