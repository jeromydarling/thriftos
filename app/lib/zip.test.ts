import { describe, expect, it } from "vitest";
import { buildZip, crc32 } from "./zip";

const FIXED = new Date(Date.UTC(2026, 6, 26, 12, 0, 0));

function u32(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer).getUint32(offset, true);
}
function u16(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer).getUint16(offset, true);
}

describe("crc32", () => {
  it("matches the known value for a standard input", () => {
    // "123456789" → 0xCBF43926 is the canonical CRC-32 check value.
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });

  it("is zero for empty input", () => {
    expect(crc32(new Uint8Array(0))).toBe(0);
  });
});

describe("buildZip", () => {
  const entries = [
    { name: "people.csv", content: "name,email\nMarta,marta@example.com\n" },
    { name: "items.csv", content: "title,price\nWool coat,20.00\n" },
  ];

  it("starts with the local file header signature", () => {
    const zip = buildZip(entries, FIXED);
    expect(u32(zip, 0)).toBe(0x04034b50);
  });

  it("ends with an end-of-central-directory record naming every entry", () => {
    const zip = buildZip(entries, FIXED);
    const eocdOffset = zip.length - 22;
    expect(u32(zip, eocdOffset)).toBe(0x06054b50);
    expect(u16(zip, eocdOffset + 8)).toBe(2);
    expect(u16(zip, eocdOffset + 10)).toBe(2);
  });

  it("stores rather than compresses, so any unzip tool can read it", () => {
    const zip = buildZip(entries, FIXED);
    expect(u16(zip, 8)).toBe(0);
  });

  it("records a correct CRC and size for the first entry", () => {
    const zip = buildZip(entries, FIXED);
    const data = new TextEncoder().encode(entries[0].content);
    expect(u32(zip, 14)).toBe(crc32(data));
    expect(u32(zip, 18)).toBe(data.length);
    expect(u32(zip, 22)).toBe(data.length);
  });

  it("keeps the file content intact and findable", () => {
    const zip = buildZip(entries, FIXED);
    const text = new TextDecoder().decode(zip);
    expect(text).toContain("Marta,marta@example.com");
    expect(text).toContain("Wool coat,20.00");
    expect(text).toContain("people.csv");
  });

  it("flags filenames as UTF-8 so a shop with an accent in its name survives", () => {
    const zip = buildZip([{ name: "café.csv", content: "a\n" }], FIXED);
    expect(u16(zip, 6) & 0x0800).toBe(0x0800);
  });

  it("is reproducible — same input, same bytes", () => {
    expect(buildZip(entries, FIXED)).toEqual(buildZip(entries, FIXED));
  });

  it("handles an empty archive without producing something unreadable", () => {
    const zip = buildZip([], FIXED);
    expect(zip.length).toBe(22);
    expect(u32(zip, 0)).toBe(0x06054b50);
  });

  it("handles an entry with empty content", () => {
    const zip = buildZip([{ name: "empty.csv", content: "" }], FIXED);
    expect(u32(zip, 18)).toBe(0);
    expect(u32(zip, zip.length - 22)).toBe(0x06054b50);
  });
});
