import { describe, expect, it } from "vitest";
import {
  DRAFT_LIFE_MS,
  clearDraft,
  differs,
  draftKey,
  fieldsFrom,
  howLongAgo,
  isDraftable,
  isEmpty,
  loadDraft,
  saveDraft,
  type DraftStore,
} from "./drafts";

function store(): DraftStore & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

const NOW = 1_760_000_000_000;

describe("what a draft is allowed to hold", () => {
  it("keeps what somebody typed", () => {
    expect(
      fieldsFrom([
        ["title", "Navy peacoat"],
        ["price", "22.00"],
      ])
    ).toEqual({ title: "Navy peacoat", price: "22.00" });
  });

  it("drops the app talking to itself", () => {
    // Restoring `intent` would replay a decision rather than a keystroke, and
    // a CSRF token restored twelve hours later is worse than useless.
    expect(isDraftable("intent")).toBe(false);
    expect(isDraftable("csrf")).toBe(false);
    expect(isDraftable("redirectTo")).toBe(false);
    expect(isDraftable("_draft")).toBe(false);
    expect(isDraftable("title")).toBe(true);

    expect(fieldsFrom([["intent", "save"], ["title", "x"]])).toEqual({ title: "x" });
  });

  it("drops files, rather than restoring a form that looks complete", () => {
    const file = new File(["x"], "coat.jpg");
    expect(fieldsFrom([["photo", file], ["title", "x"]])).toEqual({ title: "x" });
  });

  it("scopes the key to the person, so a shared till doesn't cross the streams", () => {
    expect(draftKey("donation", "usr_1")).not.toBe(draftKey("donation", "usr_2"));
    expect(draftKey("donation", "usr_1")).toContain("donation");
  });
});

describe("keeping and offering one", () => {
  it("round-trips", () => {
    const s = store();
    saveDraft(s, "k", { title: "Navy peacoat" }, NOW);
    expect(loadDraft(s, "k", NOW + 1000)).toEqual({ at: NOW, fields: { title: "Navy peacoat" } });
  });

  it("stores nothing for a form nobody typed in", () => {
    const s = store();
    saveDraft(s, "k", { title: "", notes: "   " }, NOW);
    expect(s.map.size).toBe(0);
    expect(isEmpty({ a: "", b: " " })).toBe(true);
  });

  it("forgets one that's outlived a shift, and cleans it up on the way past", () => {
    const s = store();
    saveDraft(s, "k", { title: "Yesterday's coat" }, NOW);
    expect(loadDraft(s, "k", NOW + DRAFT_LIFE_MS + 1)).toBeNull();
    expect(s.map.size).toBe(0);
  });

  it("throws away something it can't understand rather than repairing it", () => {
    const s = store();
    s.map.set("k", "{not json");
    expect(loadDraft(s, "k", NOW)).toBeNull();
    expect(s.map.size).toBe(0);

    s.map.set("k", JSON.stringify({ at: NOW, fields: "nope" }));
    expect(loadDraft(s, "k", NOW)).toBeNull();
  });

  it("filters on the way out as well as the way in", () => {
    // A draft written by an older build could hold a field we've since decided
    // not to keep. The read is the last line of defence.
    const s = store();
    s.map.set("k", JSON.stringify({ at: NOW, fields: { intent: "save", title: "x" } }));
    expect(loadDraft(s, "k", NOW)?.fields).toEqual({ title: "x" });
  });

  it("survives a browser that won't let it store anything", () => {
    const dead: DraftStore = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => {
        throw new Error("nope");
      },
    };
    // Private browsing and locked-down devices mean "no drafts", never "break
    // the page somebody is trying to type into".
    expect(() => saveDraft(dead, "k", { a: "b" }, NOW)).not.toThrow();
    expect(loadDraft(dead, "k", NOW)).toBeNull();
    expect(() => clearDraft(dead, "k")).not.toThrow();
  });
});

describe("whether it's worth mentioning", () => {
  it("says nothing when the draft matches what's on screen", () => {
    expect(differs({ title: "x" }, { title: "x", extra: "y" })).toBe(false);
    expect(differs({ title: "x" }, { title: "y" })).toBe(true);
    // A field the form no longer has still counts as a difference — it's
    // something they typed that isn't there now.
    expect(differs({ gone: "x" }, {})).toBe(true);
  });

  it("puts an age on it in words", () => {
    expect(howLongAgo(NOW, NOW + 10_000)).toBe("a moment ago");
    expect(howLongAgo(NOW, NOW + 60_000)).toBe("a minute ago");
    expect(howLongAgo(NOW, NOW + 25 * 60_000)).toBe("25 minutes ago");
    expect(howLongAgo(NOW, NOW + 60 * 60_000)).toBe("an hour ago");
    expect(howLongAgo(NOW, NOW + 3 * 60 * 60_000)).toBe("3 hours ago");
  });
});
