import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { hashPassword, verifyPassword, PBKDF2_MAX_ITERATIONS } from "./auth";

/**
 * Password hashing, and the platform limit that broke it.
 *
 * The first production deploy had PBKDF2 at 210,000 iterations. Node performs
 * any number, so every test and the whole local dev server were happy; Workers
 * refuses above 100,000, so signup, login, password reset and the demo shop
 * all threw the moment they ran for real. Nobody could create an account.
 *
 * These tests run on Node too, so they cannot reproduce the failure by
 * hashing. They pin the constant instead — which is the only check that would
 * have caught it.
 */
describe("PBKDF2 stays inside what Workers will run", () => {
  it("never asks for more iterations than the platform allows", () => {
    expect(PBKDF2_MAX_ITERATIONS).toBeLessThanOrEqual(100_000);
  });

  it("uses the ceiling as the working value, not something lower", () => {
    // The ceiling is low for PBKDF2. Sitting below it as well would be giving
    // away work factor we're allowed to have.
    const source = readFileSync("app/lib/auth.ts", "utf8");
    expect(source).toMatch(/const PBKDF2_ITERATIONS = PBKDF2_MAX_ITERATIONS/);
  });
});

describe("hashPassword", () => {
  it("stores the parameters with the hash", async () => {
    // Without this the iteration count can never change again without locking
    // every existing account out — which is what made the fix awkward.
    const { hash } = await hashPassword("correct horse battery staple");
    expect(hash).toMatch(/^pbkdf2-sha256\$100000\$[0-9a-f]{64}$/);
  });

  it("gives two identical passwords different hashes", async () => {
    const a = await hashPassword("same password");
    const b = await hashPassword("same password");
    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).not.toBe(b.hash);
  });

  it("is deterministic for a given salt", async () => {
    const a = await hashPassword("same password");
    const b = await hashPassword("same password", a.salt);
    expect(b.hash).toBe(a.hash);
  });
});

describe("verifyPassword", () => {
  it("accepts the right password", async () => {
    const { hash, salt } = await hashPassword("a long enough password");
    expect(await verifyPassword("a long enough password", hash, salt)).toBe(true);
  });

  it("rejects the wrong one", async () => {
    const { hash, salt } = await hashPassword("a long enough password");
    for (const wrong of ["a long enough passwore", "", "A long enough password", " a long enough password"]) {
      expect(await verifyPassword(wrong, hash, salt), JSON.stringify(wrong)).toBe(false);
    }
  });

  it("still verifies a hash written before the format carried its parameters", async () => {
    // A bare digest means the old iteration count. Node can compute it, so
    // an account created before the fix still signs in on a dev machine.
    const legacy = await legacyHash("an old account", "a1b2c3d4e5f60718293a4b5c6d7e8f90");
    expect(await verifyPassword("an old account", legacy, "a1b2c3d4e5f60718293a4b5c6d7e8f90")).toBe(
      true
    );
    expect(await verifyPassword("wrong", legacy, "a1b2c3d4e5f60718293a4b5c6d7e8f90")).toBe(false);
  });

  it("refuses a stored value it cannot make sense of rather than throwing", async () => {
    // A corrupt row must fail the login, not 500 the login page.
    for (const stored of ["pbkdf2-sha256$", "pbkdf2-sha256$abc$deadbeef", "pbkdf2-sha256$0$x"]) {
      expect(await verifyPassword("anything", stored, "00ff"), stored).toBe(false);
    }
  });
});

/** The old bare-digest format, rebuilt here so the fallback has something real to verify. */
async function legacyHash(password: string, saltHex: string): Promise<string> {
  const salt = new Uint8Array(saltHex.match(/../g)!.map((b) => parseInt(b, 16)));
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 210_000, hash: "SHA-256" },
    key,
    256
  );
  return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
