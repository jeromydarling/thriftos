/**
 * Save something, undo it, report it, and check the screen told the truth.
 *
 *   npm run dev         # or: npx wrangler dev --port 8788
 *   npm run check:live  # BASE=http://127.0.0.1:8788 npm run check:live
 *
 * The unit tests cover the shape of a message and the rules an undo has to
 * obey. They cannot cover the two things that actually broke:
 *
 *   The undo posted to the root route. The toast host sits above the router's
 *   outlet, so a form inside it defaulted to the root — which has no action,
 *   and answered by doing nothing. Every test passed.
 *
 *   The undo worked and the screen didn't move. The edit form's inputs are
 *   uncontrolled, so they kept the text that was typed into them while the
 *   database went back to what it was. Press Undo, see nothing change, press
 *   it again, and you have redone the edit you were removing.
 *
 * Both needed a browser to find. Hence this.
 */
import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://127.0.0.1:5199";

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });

// Sign into the demo once; the cookie carries.
const boot = await ctx.newPage();
await boot.goto(`${BASE}/demo`, { waitUntil: "networkidle", timeout: 60000 });
await boot.close();

const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("PAGE ERROR:", e.message));

const failures = [];
const check = (what, got, want) => {
  const passed = got === want;
  console.log(`${passed ? "  ok" : "FAIL"}  ${what}: ${JSON.stringify(got)}`);
  if (!passed) failures.push(`${what}: got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);
};

await page.goto(`${BASE}/app/inventory`, { waitUntil: "networkidle" });
const href = await page.locator('a[href^="/app/inventory/"]').first().getAttribute("href");
if (!href) throw new Error("No items in the demo shop to edit.");
await page.goto(`${BASE}${href}`, { waitUntil: "networkidle" });

const title = page.locator("#title");
const toasts = page.locator('ul[aria-live="polite"] li');
const settle = () => page.waitForTimeout(1500);

// A known starting point, so a half-finished previous run can't muddy this.
const WAS = await title.inputValue();
const NOW = `${WAS} (check)`;

check("the live region is there before anything is said", await page.locator('ul[aria-live="polite"]').count(), 1);

// ─── A save says so, and offers a way back ──────────────────────────────────
await title.fill(NOW);
await page.locator('button[type="submit"]').first().click();
await toasts.first().waitFor({ timeout: 10000 });

check("says what it did", await toasts.first().locator("p").first().innerText(), "Saved. 1 field updated.");
check("waits its turn rather than interrupting", await toasts.first().getAttribute("role"), "status");
check("the box shows the new value", await title.inputValue(), NOW);
check(
  "the undo posts at the screen it came from",
  await toasts.first().locator("form").getAttribute("action"),
  href
);

// ─── Undo puts it back, on screen as well as in the database ────────────────
await toasts.locator('button:has-text("Undo")').first().click();
await page.waitForTimeout(2500);
check("undo moved what's on screen", await title.inputValue(), WAS);
await page.reload({ waitUntil: "networkidle" });
check("and it stuck", await title.inputValue(), WAS);

// ─── An error interrupts, and stays put ─────────────────────────────────────
await title.fill("   "); // Passes the browser's `required`, trims to empty server-side.
await page.locator('button[type="submit"]').first().click();
await toasts.first().waitFor({ timeout: 10000 });
check("an error interrupts", await toasts.first().getAttribute("role"), "alert");
await page.waitForTimeout(9000);
check("and does not take itself away", await toasts.count(), 1);

// ─── A success gets out of the way ──────────────────────────────────────────
await page.reload({ waitUntil: "networkidle" });
await title.fill(NOW);
await page.locator('button[type="submit"]').first().click();
await toasts.first().waitFor({ timeout: 10000 });
await page.mouse.move(10, 10); // Nothing hovered, so nothing is paused.
await page.waitForTimeout(17000);
check("a success clears itself", await toasts.count(), 0);

// Leave the demo as we found it.
await page.reload({ waitUntil: "networkidle" });
await title.fill(WAS);
await page.locator('button[type="submit"]').first().click();
await settle();

// ─── Telling us about it ────────────────────────────────────────────────────
await page.locator('button:has-text("Something wrong? Tell us")').click();
await page.waitForTimeout(300);
check("the dialog opens", await page.locator("dialog[open]").count(), 1);

await page.locator("#feedback-body").fill("Live check — ignore this one.");
await page.locator('dialog button[type="submit"]').click();
await page.waitForTimeout(2500);
// Only on success. A failed send has to leave their words where they typed them.
check("it closes once it's sent", await page.locator("dialog[open]").count(), 0);
check(
  "and says so",
  ((await toasts.last().innerText()).startsWith("Got it")),
  true
);

await browser.close();

console.log(
  failures.length ? `\n${failures.length} failed:\n  ${failures.join("\n  ")}` : "\nAll good."
);
process.exit(failures.length ? 1 : 0);
