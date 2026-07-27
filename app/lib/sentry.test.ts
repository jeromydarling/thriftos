import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  buildEvent,
  envelopeUrl,
  newEventId,
  parseDsn,
  reportError,
  stackFrames,
} from "./sentry";
import type { AppEnv } from "./env";

const DSN = "https://abc123@o4504.ingest.us.sentry.io/4507";

const envWith = (dsn?: string) => ({ SENTRY_DSN: dsn }) as unknown as AppEnv;

afterEach(() => vi.unstubAllGlobals());

describe("reading a DSN", () => {
  it("pulls the three parts out", () => {
    expect(parseDsn(DSN)).toEqual({
      host: "o4504.ingest.us.sentry.io",
      projectId: "4507",
      publicKey: "abc123",
    });
  });

  it("refuses anything that isn't one, rather than half-parsing it", () => {
    expect(parseDsn(undefined)).toBeNull();
    expect(parseDsn("")).toBeNull();
    expect(parseDsn("not a url")).toBeNull();
    expect(parseDsn("https://o4504.ingest.us.sentry.io/4507")).toBeNull(); // no key
    expect(parseDsn("https://abc123@o4504.ingest.us.sentry.io")).toBeNull(); // no project
  });

  it("builds the envelope URL Sentry expects", () => {
    expect(envelopeUrl(parseDsn(DSN)!)).toBe(
      "https://o4504.ingest.us.sentry.io/api/4507/envelope/?sentry_key=abc123&sentry_version=7"
    );
  });

  it("makes event ids in the only shape Sentry accepts", () => {
    expect(newEventId()).toMatch(/^[0-9a-f]{32}$/);
    expect(newEventId()).not.toBe(newEventId());
  });
});

describe("what gets sent", () => {
  const event = (err: unknown, ctx = {}) => buildEvent(err, ctx, "e".repeat(32), 1_700_000_000_000);

  it("carries the error's type, message and stack", () => {
    const err = new TypeError("cannot read x of undefined");
    err.stack = "TypeError: x\n    at save (worker.js:10:5)\n    at handle (worker.js:99:1)";
    const values = (event(err).exception as { values: Record<string, unknown>[] }).values;

    expect(values[0].type).toBe("TypeError");
    expect(values[0].value).toBe("cannot read x of undefined");
    expect((values[0].stacktrace as { frames: { function: string }[] }).frames.map((f) => f.function)).toEqual(
      // Oldest first — the crash is the last frame Sentry draws.
      ["handle", "save"]
    );
  });

  it("copes with something thrown that isn't an Error at all", () => {
    const values = (event("everything is fine").exception as { values: { value: string }[] }).values;
    expect(values[0].value).toBe("everything is fine");
  });

  it("sends no headers, no body, no query string and no names", () => {
    const built = event(new Error("boom"), {
      path: "/app/inventory/it_1",
      method: "POST",
      orgId: "org_1",
    });

    const json = JSON.stringify(built);
    // The three things that would leak a session, a token, or a person.
    expect(json).not.toContain("cookie");
    expect(json).not.toContain("headers");
    expect(built).not.toHaveProperty("user");
    expect(built.request).toEqual({ url: "/app/inventory/it_1", method: "POST" });
    expect(built.tags).toMatchObject({ org: "org_1", method: "POST" });
  });
});

describe("reporting", () => {
  it("does nothing at all without a DSN, which is the normal local state", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect(reportError(envWith(undefined), new Error("boom"))).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("posts an envelope and hands back the id straight away", () => {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal("fetch", (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return Promise.resolve(new Response(""));
    });

    const id = reportError(envWith(DSN), new Error("boom"), { path: "/app" });
    expect(id).toMatch(/^[0-9a-f]{32}$/);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain("/api/4507/envelope/");

    // Three newline-separated JSON objects: header, item header, event.
    const lines = String(calls[0].init.body).trim().split("\n");
    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[0]).event_id).toBe(id);
    expect(JSON.parse(lines[1])).toEqual({ type: "event" });
    expect(JSON.parse(lines[2]).exception.values[0].value).toBe("boom");
  });

  it("never throws, whatever the network does", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new Error("no network")));
    expect(() => reportError(envWith(DSN), new Error("boom"))).not.toThrow();

    // And the rejection is swallowed rather than left unhandled, which in a
    // Worker would take out the request that was already failing.
    vi.stubGlobal("fetch", () => {
      throw new Error("synchronously broken");
    });
    expect(reportError(envWith(DSN), new Error("boom"))).toBeNull();
  });

  it("hands the send to waitUntil, so nobody waits on Sentry", () => {
    const waiting: Promise<unknown>[] = [];
    vi.stubGlobal("fetch", () => Promise.resolve(new Response("")));
    reportError(envWith(DSN), new Error("boom"), {}, { waitUntil: (p) => void waiting.push(p) });
    expect(waiting).toHaveLength(1);
  });
});

describe("where it's wired in", () => {
  it("reports loader and action failures, and ignores the deliberate ones", () => {
    const entry = readFileSync(new URL("../entry.server.tsx", import.meta.url), "utf8");
    expect(entry).toContain("export function handleError");
    // A thrown Response is a 404 or a 403 the app meant. An aborted request is
    // somebody navigating away. Neither is a fault, and both would otherwise
    // bury the real ones.
    expect(entry).toContain("request.signal.aborted");
    expect(entry).toContain("error instanceof Response");
  });

  it("catches what falls out of the API", () => {
    const api = readFileSync(new URL("../api/index.ts", import.meta.url), "utf8");
    expect(api).toContain("api.onError(");
    expect(api).toContain("reportError(");
  });
});

describe("stack parsing", () => {
  it("skips lines that aren't frames", () => {
    expect(stackFrames("Error: nope\n    at go (a.js:1:2)\nrandom text")).toEqual([
      { function: "go", filename: "a.js", lineno: 1, colno: 2 },
    ]);
  });

  it("handles a bare frame with no function name", () => {
    expect(stackFrames("    at a.js:4:9")).toEqual([
      { function: "<anonymous>", filename: "a.js", lineno: 4, colno: 9 },
    ]);
  });

  it("returns nothing for no stack, rather than a frame full of undefined", () => {
    expect(stackFrames(undefined)).toEqual([]);
  });
});
