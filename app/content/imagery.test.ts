import { readFileSync } from "node:fs";
import { existsSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { HOUSE_STYLE, SHOTS, fullPrompt, shot, shotSrc } from "./imagery";

describe("the photography set", () => {
  it("has a unique, file-safe id for every shot", () => {
    const ids = SHOTS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9-]+$/);
  });

  it("never asks for people", () => {
    // Generated faces are the fastest way to look synthetic, and a photograph
    // of a volunteer who doesn't exist sits badly on a page arguing that our
    // numbers are computed rather than invented.
    expect(HOUSE_STYLE).toMatch(/no people/i);
    expect(HOUSE_STYLE).toMatch(/no faces/i);

    // The scene description, not the full prompt — the house style is where
    // "no people" lives, and searching that for the word finds its own
    // instruction. Word boundaries because "man" is inside "woman"; and only
    // words that name a person, because "hand" is inside "second-hand" and
    // "face" inside "surface". A check that cries wolf gets ignored, and this
    // one has already cried wolf twice.
    for (const s of SHOTS) {
      for (const word of ["person", "people", "woman", "man", "child", "volunteer", "customer", "shopper"]) {
        expect(
          new RegExp(`\\b${word}s?\\b`, "i").test(s.prompt),
          `${s.id} asks for "${word}"`
        ).toBe(false);
      }
    }
  });

  it("never asks for text, signage or a price", () => {
    // A legible price on a generated tag would be a number we didn't compute,
    // and legible signage would make an invented shop look like a real one.
    expect(HOUSE_STYLE).toMatch(/no text/i);
    expect(HOUSE_STYLE).toMatch(/no signage/i);
    expect(HOUSE_STYLE).toMatch(/no logos/i);

    for (const s of SHOTS) {
      expect(s.prompt.toLowerCase(), s.id).not.toMatch(/\bpriced? tag reading|\$\d/);
    }
  });

  it("describes every shot for whoever regenerates it", () => {
    for (const s of SHOTS) {
      expect(s.purpose.length, s.id).toBeGreaterThan(20);
      expect(s.alt.length, s.id).toBeGreaterThan(20);
      expect(s.prompt.length, s.id).toBeGreaterThan(80);
    }
  });

  it("resolves a shot by id, and nothing by a made-up one", () => {
    expect(shot("rail")?.id).toBe("rail");
    expect(shot("not-a-shot")).toBeUndefined();
    expect(shotSrc("rail")).toBe("/img/rail.jpg");
  });
});

describe("what actually shipped", () => {
  const drawn = SHOTS.filter((s) => existsSync(`public/img/${s.id}.jpg`));

  it("has drawn every shot in the set", () => {
    const missing = SHOTS.filter((s) => !existsSync(`public/img/${s.id}.jpg`)).map((s) => s.id);
    expect(missing, `not drawn yet: ${missing.join(", ")}`).toEqual([]);
  });

  it("keeps every image to a web weight", () => {
    // The model returns roughly 780 KB apiece. Shipping that unrecompressed
    // once already happened; this is the check that says so out loud.
    for (const s of drawn) {
      const kb = statSync(`public/img/${s.id}.jpg`).size / 1024;
      expect(kb, `${s.id} is ${Math.round(kb)} KB`).toBeLessThan(200);
    }
  });
});

describe("placement", () => {
  const photo = readFileSync("app/components/photo.tsx", "utf8");

  it("hides decorative photography from screen readers", () => {
    // These carry mood, not information. A screen reader announcing "a rail of
    // second-hand wool coats" between two paragraphs about payment fees is
    // noise, not access.
    expect(photo).toContain('alt=""');
    expect(photo).toContain('aria-hidden="true"');
    expect(photo).not.toMatch(/alt=\{[^}]*\.alt\}/);
  });

  it("always sets dimensions, so a late photo can't shove the page down", () => {
    const imgs = photo.match(/<img[\s\S]*?\/>/g) ?? [];
    expect(imgs.length).toBeGreaterThan(0);
    for (const img of imgs) {
      expect(img).toMatch(/width=\{/);
      expect(img).toMatch(/height=\{/);
    }
  });
});
