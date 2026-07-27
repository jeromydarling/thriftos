import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  MAX_SNAPSHOT,
  pageSnapshot,
  readSnapshot,
  type PageRow,
  BLOCKS,
  DEFAULT_HOME,
  RESERVED_PAGE_SLUGS,
  pageSlugAvailable,
  parseBlocks,
  serialiseBlocks,
  suggestSlug,
} from "./site";

/**
 * The reserved-slug list, read from the migrations rather than duplicated.
 *
 * A shop's page lives at /{slug}, so its slug shares a namespace with every
 * system route. This is the check that would have caught the demo shop losing
 * its own page to the /demo login route — and, worse, its old address
 * redirecting visitors somewhere that signed them in.
 */
function reservedSlugs(): Set<string> {
  const files = ["migrations/0017_brand_site.sql", "migrations/0018_demo_slug.sql"];
  const slugs = new Set<string>();

  for (const file of files) {
    const sql = readFileSync(file, "utf8");
    for (const match of sql.matchAll(/\(\s*'([a-z0-9.\-]+)'\s*,\s*'[^']*'\s*\)/g)) {
      slugs.add(match[1]);
    }
  }
  return slugs;
}

/**
 * Top-level path segments the router claims.
 *
 * Depth-tracked, because nested children live inside the parent's array —
 * `route("inventory", ...)` under `route("app", ...)` serves /app/inventory and
 * cannot collide with a shop. Counting every `route(` call would flag those
 * and make the test useless noise.
 */
function topLevelRoutes(): string[] {
  const source = readFileSync("app/routes.ts", "utf8");
  const body = source.slice(source.indexOf("export default ["));
  const paths: string[] = [];

  let depth = 0;
  for (let i = 0; i < body.length; i++) {
    const char = body[i];
    if (char === "[") depth++;
    else if (char === "]") depth--;
    // Depth 1 is the top-level array; anything deeper is a child route.
    else if (depth === 1 && body.startsWith('route("', i)) {
      const end = body.indexOf('"', i + 7);
      const path = body.slice(i + 7, end);
      // The catch-all shop routes are what's being protected, not a claim.
      const segment = path.split("/")[0];
      if (segment && !segment.startsWith(":")) paths.push(segment);
    }
  }
  return [...new Set(paths)];
}

describe("no route can steal a shop's address", () => {
  const reserved = reservedSlugs();

  it("reserves every top-level route", () => {
    const missing = topLevelRoutes().filter((segment) => !reserved.has(segment));
    expect(
      missing,
      `These routes aren't reserved, so a shop could claim them and lose its page: ${missing.join(", ")}`
    ).toEqual([]);
  });

  it("reserves the paths served from public/ and the build", () => {
    for (const path of ["assets", "favicon.svg", "manifest.webmanifest", "sw.js", "robots.txt"]) {
      expect(reserved.has(path), path).toBe(true);
    }
  });

  it("reserves the demo shop's own slug", () => {
    // It has a page at /second-chances; nobody else may claim that.
    expect(reserved.has("second-chances")).toBe(true);
  });

  it("does not reserve a plausible shop name", () => {
    // Over-reserving is its own failure — a shop called Mill Road Thrift must
    // be able to have that address.
    for (const slug of ["mill-road-thrift", "second-chances-thrift", "rummage", "the-attic"]) {
      expect(reserved.has(slug), slug).toBe(false);
    }
  });
});

describe("suggestSlug", () => {
  it("makes a usable address from a shop name", () => {
    expect(suggestSlug("Second Chances Thrift")).toBe("second-chances-thrift");
    expect(suggestSlug("Mill Road Thrift")).toBe("mill-road-thrift");
  });

  it("spells out an ampersand rather than dropping it", () => {
    expect(suggestSlug("Bell & Sons")).toBe("bell-and-sons");
  });

  it("strips punctuation and collapses separators", () => {
    expect(suggestSlug("St. Mary's  Op-Shop!!")).toBe("st-mary-s-op-shop");
  });

  it("never returns an empty or trailing-hyphen slug", () => {
    expect(suggestSlug("!!!")).toBe("shop");
    expect(suggestSlug("")).toBe("shop");
    expect(suggestSlug("A".repeat(80)).endsWith("-")).toBe(false);
  });
});

describe("blocks", () => {
  it("round-trips", () => {
    const blocks = [
      { kind: "intro" as const, heading: "Hello", body: "Some words" },
      { kind: "featured" as const, heading: "In now", body: "" },
    ];
    expect(parseBlocks(serialiseBlocks(blocks))).toEqual(blocks);
  });

  it("renders an empty page rather than throwing on corrupt data", () => {
    // A shop's public website must never 500 because a blob failed to parse.
    expect(parseBlocks("{not json")).toEqual([]);
    expect(parseBlocks("null")).toEqual([]);
    expect(parseBlocks('{"kind":"intro"}')).toEqual([]);
    expect(parseBlocks(null)).toEqual([]);
  });

  it("drops a block kind we don't ship", () => {
    const parsed = parseBlocks('[{"kind":"iframe","heading":"x","body":"y"}]');
    expect(parsed).toEqual([]);
  });

  it("keeps the good blocks when one is bad", () => {
    const parsed = parseBlocks('[{"kind":"nope"},{"kind":"hours","heading":"Open"}]');
    expect(parsed).toHaveLength(1);
    expect(parsed[0].kind).toBe("hours");
  });

  it("caps a page rather than letting one render forever", () => {
    const many = JSON.stringify(Array.from({ length: 60 }, () => ({ kind: "text" })));
    expect(parseBlocks(many).length).toBeLessThanOrEqual(24);
  });

  it("truncates oversized text instead of storing it", () => {
    const parsed = parseBlocks(
      JSON.stringify([{ kind: "text", heading: "x".repeat(500), body: "y".repeat(9000) }])
    );
    expect(parsed[0].heading.length).toBeLessThanOrEqual(120);
    expect(parsed[0].body.length).toBeLessThanOrEqual(2000);
  });

  it("every block kind has a spec", () => {
    const kinds = new Set(BLOCKS.map((b) => b.kind));
    for (const block of DEFAULT_HOME) {
      expect(kinds.has(block.kind), block.kind).toBe(true);
    }
  });

  it("the default page is mostly live blocks", () => {
    // A shop that never opens the editor should still get a correct page.
    const live = DEFAULT_HOME.filter(
      (b) => BLOCKS.find((spec) => spec.kind === b.kind)?.live
    );
    expect(live.length).toBeGreaterThan(DEFAULT_HOME.length / 2);
  });

  it("marks a block live only if it reads records", () => {
    const staticKinds = BLOCKS.filter((b) => !b.live).map((b) => b.kind);
    expect(staticKinds).toEqual(["intro", "text"]);
  });
});

describe("page addresses a shop may not take", () => {
  it("refuses the ones the shop's own pages use", () => {
    // A page called "basket" would shadow the one thing on the site that takes
    // money, and it would read as our bug rather than a name somebody chose.
    for (const slug of RESERVED_PAGE_SLUGS) {
      const check = pageSlugAvailable(slug);
      expect(check.ok, slug).toBe(false);
      expect(check.reason, slug).toBeTruthy();
    }
  });

  it("allows the front page, which has no address at all", () => {
    expect(pageSlugAvailable("").ok).toBe(true);
  });

  it("allows the pages a shop actually wants", () => {
    for (const slug of ["about", "donate", "find-us", "our-story", "volunteering"]) {
      expect(pageSlugAvailable(slug).ok, slug).toBe(true);
    }
  });

  it("refuses an address that isn't one", () => {
    for (const slug of ["Basket", "-leading", "with space", "with/slash", "..", "with?query"]) {
      expect(pageSlugAvailable(slug).ok, slug).toBe(false);
    }
  });

  it("reserves every segment the shop routes actually claim", () => {
    // Read from the router rather than trusted, so a new /{shop}/thing route
    // that nobody reserved fails here instead of in a shop's face.
    const routes = readFileSync("app/routes.ts", "utf8");
    const claimed = [...routes.matchAll(/route\("\:slug\/([a-z0-9.]+)/g)].map((m) => m[1]);
    expect(claimed.length).toBeGreaterThan(0);
    for (const segment of claimed) {
      expect(RESERVED_PAGE_SLUGS, `/{shop}/${segment} is a route but isn't reserved`).toContain(
        segment
      );
    }
  });
});

describe("deleting a page, and putting it back", () => {
  const PAGE: PageRow = {
    id: "sp_1",
    slug: "about",
    title: "About us",
    blocks_json: JSON.stringify([{ kind: "text", heading: "Who we are", body: "Since 1994." }]),
    status: "published",
    nav_order: 20,
    nav_label: "About",
    seo_description: "A charity shop in town.",
    published_at: "2026-07-01 09:00:00",
  };

  it("round-trips a page through the form the undo posts", () => {
    const fields = pageSnapshot(PAGE);
    expect(fields).not.toBeNull();
    const back = readSnapshot(new URLSearchParams(fields!));

    // The id comes back with it, so anything pointing at the page still does.
    expect(back).toEqual(PAGE);
  });

  it("round-trips a page with nothing optional set", () => {
    const bare: PageRow = {
      ...PAGE,
      blocks_json: "[]",
      status: "draft",
      nav_order: null,
      nav_label: null,
      seo_description: null,
      published_at: null,
    };
    expect(readSnapshot(new URLSearchParams(pageSnapshot(bare)!))).toEqual(bare);
  });

  it("posts the restore intent, so the undo button needs nothing added to it", () => {
    expect(pageSnapshot(PAGE)?.intent).toBe("restore");
  });

  it("declines to promise an undo it can't carry", () => {
    // The snapshot travels as hidden form fields. A button that silently
    // restores half a page is worse than a plain "deleted".
    const huge = { ...PAGE, blocks_json: JSON.stringify([{ kind: "text", heading: "", body: "x".repeat(MAX_SNAPSHOT) }]) };
    expect(pageSnapshot(huge)).toBeNull();
  });

  it("restores an empty page rather than storing something the renderer chokes on", () => {
    const back = readSnapshot(new URLSearchParams({ ...pageSnapshot(PAGE)!, blocks: "{not json" }));
    expect(back?.blocks_json).toBe("[]");
  });

  it("won't restore something with no id, because that isn't a page", () => {
    expect(readSnapshot(new URLSearchParams({ slug: "about", title: "About" }))).toBeNull();
  });
});
