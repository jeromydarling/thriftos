import { describe, expect, it } from "vitest";
import {
  guessDelimiter,
  guessMapping,
  normaliseCondition,
  normaliseEmail,
  normaliseRoles,
  parseCsv,
  parseCsvGrid,
  parseDate,
  parseMoneyCents,
} from "./csv";

describe("parseCsvGrid", () => {
  it("reads quoted fields containing the delimiter", () => {
    const grid = parseCsvGrid('a,b\n"Smith, John",42\n');
    expect(grid[1]).toEqual(["Smith, John", "42"]);
  });

  it("reads quoted fields containing newlines", () => {
    const grid = parseCsvGrid('note,n\n"line one\nline two",7\n');
    expect(grid[1]).toEqual(["line one\nline two", "7"]);
  });

  it("reads doubled quotes as a literal quote", () => {
    const grid = parseCsvGrid('a\n"He said ""hi"""\n');
    expect(grid[1]).toEqual(['He said "hi"']);
  });

  it("handles CRLF line endings", () => {
    const grid = parseCsvGrid("a,b\r\n1,2\r\n");
    expect(grid).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("strips a UTF-8 BOM so the first header still matches", () => {
    const grid = parseCsvGrid("﻿Name,Email\nA,b@c.com\n");
    expect(grid[0][0]).toBe("Name");
  });

  it("does not emit a phantom row for a trailing newline", () => {
    expect(parseCsvGrid("a\n1\n")).toHaveLength(2);
  });
});

describe("parseCsv", () => {
  it("skips wholly blank lines without calling them errors", () => {
    const parsed = parseCsv("name,email\nA,a@b.com\n\n\nB,b@c.com\n");
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.malformed).toHaveLength(0);
  });

  it("pads short rows rather than discarding them", () => {
    const parsed = parseCsv("name,email,phone\nA,a@b.com\n");
    expect(parsed.rows[0]).toEqual({ name: "A", email: "a@b.com", phone: "" });
    expect(parsed.malformed).toHaveLength(1);
  });

  it("reports over-long rows rather than silently truncating", () => {
    const parsed = parseCsv("name,email\nA,a@b.com,extra\n");
    expect(parsed.rows).toHaveLength(0);
    expect(parsed.malformed[0].line).toBe(2);
  });

  it("names blank headers rather than colliding them", () => {
    const parsed = parseCsv("name,,\nA,x,y\n");
    expect(parsed.headers).toEqual(["name", "Column 2", "Column 3"]);
  });
});

describe("guessDelimiter", () => {
  it("finds semicolons", () => {
    expect(guessDelimiter("a;b;c\n1;2;3")).toBe(";");
  });
  it("finds tabs", () => {
    expect(guessDelimiter("a\tb\tc\n1\t2\t3")).toBe("\t");
  });
  it("defaults to a comma when there is one column", () => {
    expect(guessDelimiter("name\nA\nB")).toBe(",");
  });
});

describe("guessMapping", () => {
  it("matches headers regardless of punctuation and case", () => {
    const m = guessMapping(["Donor E-Mail", "Full Name", "Phone Number"], "contacts");
    expect(m["Donor E-Mail"]).toBe("email");
    expect(m["Full Name"]).toBe("name");
    expect(m["Phone Number"]).toBe("phone");
  });

  it("gives an exact header the field ahead of a vaguer one", () => {
    const m = guessMapping(["Donor Name", "Name"], "contacts");
    expect(m["Name"]).toBe("name");
  });

  it("claims each field at most once", () => {
    const m = guessMapping(["Email", "Email Address"], "contacts");
    const emails = Object.values(m).filter((v) => v === "email");
    expect(emails).toHaveLength(1);
  });

  it("maps a thrift export's item columns", () => {
    const m = guessMapping(
      ["SKU", "Item Name", "Sale Price", "Department", "Date Added", "Condition"],
      "items"
    );
    expect(m["SKU"]).toBe("tag_number");
    expect(m["Item Name"]).toBe("title");
    expect(m["Sale Price"]).toBe("price_cents");
    expect(m["Department"]).toBe("category");
    expect(m["Date Added"]).toBe("intake_date");
    expect(m["Condition"]).toBe("condition");
  });
});

describe("parseMoneyCents", () => {
  it("reads dollars with a currency symbol", () => {
    expect(parseMoneyCents("$12.50")).toBe(1250);
  });
  it("reads thousands separators", () => {
    expect(parseMoneyCents("1,234.56")).toBe(123456);
  });
  it("reads European decimal commas", () => {
    expect(parseMoneyCents("1.234,56")).toBe(123456);
  });

  it("reads a bare decimal comma with no thousands separator", () => {
    // Caught in a live import: "7,00" was reading as $700.00. A hundredfold
    // error on every price in a European-formatted export.
    expect(parseMoneyCents("7,00")).toBe(700);
    expect(parseMoneyCents("24,5")).toBe(2450);
    expect(parseMoneyCents("0,99")).toBe(99);
    expect(parseMoneyCents("125,00")).toBe(12500);
  });

  it("still reads a comma before three digits as a thousands separator", () => {
    expect(parseMoneyCents("7,000")).toBe(700000);
    expect(parseMoneyCents("1,234")).toBe(123400);
    expect(parseMoneyCents("1,234,567")).toBe(123456700);
  });
  it("reads parentheses as negative", () => {
    expect(parseMoneyCents("(4.00)")).toBe(-400);
  });
  it("rounds rather than truncating, so no cent is lost", () => {
    expect(parseMoneyCents("12.35")).toBe(1235);
    expect(parseMoneyCents("0.07")).toBe(7);
    expect(parseMoneyCents("29.99")).toBe(2999);
  });
  it("returns null for anything unreadable rather than zero", () => {
    expect(parseMoneyCents("call for price")).toBeNull();
    expect(parseMoneyCents("")).toBeNull();
    expect(parseMoneyCents("--")).toBeNull();
  });
});

describe("parseDate", () => {
  it("takes ISO as-is", () => {
    expect(parseDate("2024-03-09")).toBe("2024-03-09");
    expect(parseDate("2024-03-09T14:00:00Z")).toBe("2024-03-09");
  });

  it("respects the day-first hint when the date is ambiguous", () => {
    expect(parseDate("03/09/2024", false)).toBe("2024-03-09");
    expect(parseDate("03/09/2024", true)).toBe("2024-09-03");
  });

  it("ignores the hint when only one reading is possible", () => {
    expect(parseDate("25/12/2024", false)).toBe("2024-12-25");
    expect(parseDate("12/25/2024", true)).toBe("2024-12-25");
  });

  it("expands two-digit years", () => {
    expect(parseDate("01/02/99")).toBe("1999-01-02");
    expect(parseDate("01/02/24")).toBe("2024-01-02");
  });

  it("reads named months without ambiguity", () => {
    expect(parseDate("March 12, 2024")).toBe("2024-03-12");
  });

  it("rejects impossible dates rather than rolling them over", () => {
    expect(parseDate("02/31/2024")).toBeNull();
    expect(parseDate("13/13/2024")).toBeNull();
  });

  it("returns null for unreadable text", () => {
    expect(parseDate("last Tuesday")).toBeNull();
    expect(parseDate("")).toBeNull();
  });
});

describe("normaliseCondition", () => {
  it("takes our own vocabulary directly", () => {
    expect(normaliseCondition("Excellent")).toEqual({ value: "excellent", guessed: false });
  });
  it("maps common aliases", () => {
    expect(normaliseCondition("NWT").value).toBe("new");
    expect(normaliseCondition("Like New").value).toBe("excellent");
    expect(normaliseCondition("as-is").value).toBe("flawed");
  });
  it("falls back to good and says it was a guess", () => {
    expect(normaliseCondition("Tier 3")).toEqual({ value: "good", guessed: true });
  });
  it("does not call an empty column a guess", () => {
    expect(normaliseCondition("")).toEqual({ value: "good", guessed: false });
  });
});

describe("normaliseRoles", () => {
  it("reads a delimited list", () => {
    expect(normaliseRoles("donor, volunteer")).toEqual(["donor", "volunteer"]);
  });
  it("recognises near-misses", () => {
    expect(normaliseRoles("Volunteers")).toEqual(["volunteer"]);
    expect(normaliseRoles("Customer")).toEqual(["shopper"]);
    expect(normaliseRoles("Employee")).toEqual(["worker"]);
  });
  it("drops anything it doesn't understand rather than inventing a role", () => {
    expect(normaliseRoles("Tier A Member")).toEqual([]);
  });
  it("de-duplicates", () => {
    expect(normaliseRoles("donor;Donors;donation")).toEqual(["donor"]);
  });
});

describe("normaliseEmail", () => {
  it("lowercases and trims", () => {
    expect(normaliseEmail("  A@B.COM ")).toBe("a@b.com");
  });
  it("rejects anything that isn't an address", () => {
    expect(normaliseEmail("none")).toBeNull();
    expect(normaliseEmail("a@b")).toBeNull();
    expect(normaliseEmail("")).toBeNull();
  });
});
