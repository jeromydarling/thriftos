import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { failed, noted, ok, toastFrom, toastLife, TOAST_LIFE, UNDO_LIFE } from "./toast";

describe("what an action says", () => {
  it("carries the message and the tone", () => {
    expect(toastFrom(ok("Saved."))).toEqual({
      tone: "good",
      message: "Saved.",
      detail: undefined,
      undo: undefined,
      eventId: undefined,
    });
    expect(toastFrom(failed("Nope."))?.tone).toBe("warn");
    expect(toastFrom(noted("Queued."))?.tone).toBe("info");
  });

  it("still reads the plain shorthand the rest of the app returns", () => {
    expect(toastFrom({ error: "That sale doesn't exist." })).toMatchObject({
      tone: "warn",
      message: "That sale doesn't exist.",
    });
    expect(toastFrom({ ok: "Domain verified." })).toMatchObject({
      tone: "good",
      message: "Domain verified.",
    });
  });

  it("says nothing about a result that isn't a message", () => {
    // `{ ok: true }` is how several actions signal "it worked, now re-render"
    // — a screen showing a toast that says "true" would be worse than silence.
    expect(toastFrom({ ok: true })).toBeNull();
    expect(toastFrom({ ok: "   " })).toBeNull();
    expect(toastFrom(null)).toBeNull();
    expect(toastFrom("saved")).toBeNull();
    expect(toastFrom({ nothing: "here" })).toBeNull();
  });

  it("survives a mangled toast rather than throwing on screen", () => {
    expect(toastFrom({ toast: { message: "Hm.", tone: "purple" } })?.tone).toBe("info");
    expect(toastFrom({ toast: { tone: "good" } })).toBeNull();
    expect(toastFrom({ toast: "Saved." })).toBeNull();
  });

  it("keeps a repeated field as a list, so a form with several of one name undoes", () => {
    const undo = toastFrom(
      ok("Bands saved.", {
        // The numbers are deliberately off-type — they crossed the wire, and
        // the reader has to cope with what arrives rather than what we declared.
        undo: {
          fields: { intent: "bands", bandLabel: ["Small", "Large"], bandPrice: [3.5, 7] } as never,
        },
      })
    )?.undo;
    expect(undo?.fields).toEqual({
      intent: "bands",
      bandLabel: ["Small", "Large"],
      bandPrice: ["3.5", "7"],
    });
  });

  it("keeps an empty list, because 'there were none' is a thing to restore", () => {
    expect(toastFrom(ok("x", { undo: { fields: { bandLabel: [] } } }))?.undo?.fields).toEqual({
      bandLabel: [],
    });
  });

  it("keeps an undo's fields as strings, and drops one with nothing in it", () => {
    const undo = toastFrom(
      // Deliberately off-type: this crossed the wire, so the reader has to
      // cope with whatever actually arrives rather than what we declared.
      ok("Price changed.", {
        undo: { fields: { intent: "save", price: 1250, keep: null } as never },
      })
    )?.undo;
    expect(undo?.fields).toEqual({ intent: "save", price: "1250" });

    expect(toastFrom(ok("x", { undo: { fields: {} } }))?.undo).toBeUndefined();
    expect(toastFrom(ok("x", { undo: undefined }))?.undo).toBeUndefined();
  });
});

describe("how long it stays", () => {
  it("never takes an error away on its own", () => {
    expect(TOAST_LIFE.warn).toBe(0);
    expect(toastLife({ tone: "warn", message: "x" })).toBe(0);
  });

  it("waits longer when there's something to undo", () => {
    expect(toastLife({ tone: "good", message: "x" })).toBe(TOAST_LIFE.good);
    expect(toastLife({ tone: "good", message: "x", undo: { fields: { a: "b" } } })).toBe(UNDO_LIFE);
    expect(UNDO_LIFE).toBeGreaterThan(TOAST_LIFE.good);
  });
});

describe("the stack itself", () => {
  const source = readFileSync(new URL("../components/toast.tsx", import.meta.url), "utf8");

  it("keeps the live region in the document rather than creating it with the first message", () => {
    // A region inserted at the same moment as its first message is a region
    // screen readers do not announce. The <ul> must be unconditional.
    const region = source.slice(source.indexOf('aria-live="polite"'));
    expect(source).toContain('aria-live="polite"');
    expect(region).toContain("{toasts.map(");
    expect(source).not.toMatch(/toasts\.length\s*(>|===)[^\n]*\?\s*\(?\s*<ul/);
  });

  it("interrupts for an error and waits its turn for anything else", () => {
    expect(source).toContain('role={toast.tone === "warn" ? "alert" : "status"}');
  });

  it("undoes by posting a form, so the action's own rules still apply", () => {
    expect(source).toContain("<undo.Form method=\"post\"");
    expect(source).toContain('type="hidden"');
  });
});
