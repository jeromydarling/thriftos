/**
 * Walk every page at phone width and report what doesn't fit.
 *
 *   npm run dev            # in another terminal
 *   npm run audit:mobile   # or: W=320 npm run audit:mobile
 *
 * Page-level horizontal scroll is the failure this is looking for: it means
 * something is wider than the screen and the whole layout shifts sideways as
 * you read. A table that scrolls inside its own box is fine and expected —
 * this distinguishes the two.
 *
 * Written because four screens had the same clipped-table bug and nobody had
 * looked at them on a phone. It has since also caught a scroll-reveal that
 * parked elements 24px off the right edge, a header 23px too wide at 320, and
 * a grid track sized by the table it was supposed to be scrolling. None of
 * those are visible on a laptop.
 *
 * Not a unit test: it needs a running server and a real browser, which is
 * exactly why the bugs it finds survive a green test suite.
 */
import { chromium } from "playwright";

const BASE = "http://127.0.0.1:5199";
const WIDTH = Number(process.env.W ?? 390);
const HEIGHT = 844;

const PUBLIC = [
  "/",
  "/pricing",
  "/compare",
  "/nri",
  "/guides",
  "/help",
  "/help/selling-online",
  "/help/product-photographs",
  "/help/online-orders",
  "/help/postage-and-collection",
  "/help/product-feed",
  "/second-chances",
  "/login",
  "/signup",
];

const APP = [
  "/app",
  "/app/intake",
  "/app/register",
  "/app/inventory",
  "/app/photos",
  "/app/orders",
  "/app/donations",
  "/app/people",
  "/app/volunteers",
  "/app/drawer",
  "/app/money",
  "/app/studio",
  "/app/site",
  "/app/impact",
  "/app/settings",
  "/app/help",
];

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext({
  viewport: { width: WIDTH, height: HEIGHT },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});

// Sign into the demo once; the cookie carries to every /app page.
const boot = await ctx.newPage();
await boot.goto(`${BASE}/demo`, { waitUntil: "networkidle", timeout: 60000 });
await boot.close();

const page = await ctx.newPage();
const findings = [];

for (const path of [...PUBLIC, ...APP]) {
  let status = 0;
  try {
    const res = await page.goto(`${BASE}${path}`, { waitUntil: "networkidle", timeout: 45000 });
    status = res?.status() ?? 0;
  } catch (err) {
    findings.push({ path, kind: "load-failed", detail: String(err).slice(0, 120) });
    continue;
  }

  if (status >= 400) {
    findings.push({ path, kind: "status", detail: String(status) });
    continue;
  }

  const report = await page.evaluate((vw) => {
    const doc = document.documentElement;
    const overflow = doc.scrollWidth - doc.clientWidth;

    // Which elements actually stick out? Skip anything inside a box that is
    // itself scrollable — that's a deliberate scroller, not a broken layout.
    const culprits = [];
    for (const el of document.querySelectorAll("body *")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.right <= vw + 1 && r.left >= -1) continue;

      let scrollableAncestor = false;
      for (let p = el.parentElement; p; p = p.parentElement) {
        const ov = getComputedStyle(p).overflowX;
        if (ov === "auto" || ov === "scroll") {
          scrollableAncestor = true;
          break;
        }
      }
      if (scrollableAncestor) continue;

      culprits.push({
        tag: el.tagName.toLowerCase(),
        cls: (el.getAttribute("class") ?? "").slice(0, 90),
        text: (el.textContent ?? "").trim().slice(0, 50),
        left: Math.round(r.left),
        right: Math.round(r.right),
      });
    }

    // A table with no scrollable parent will be squeezed or clipped.
    const trappedTables = [];
    for (const t of document.querySelectorAll("table")) {
      let ok = false;
      for (let p = t.parentElement; p; p = p.parentElement) {
        const ov = getComputedStyle(p).overflowX;
        if (ov === "auto" || ov === "scroll") { ok = true; break; }
      }
      if (!ok) {
        trappedTables.push((t.querySelector("th")?.textContent ?? "?").trim().slice(0, 40));
      }
    }

    // Tap targets below WCAG 2.5.8's 24x24 CSS px minimum.
    //
    // 24, not a number I liked the look of — the first pass used 32 and spent
    // its time reporting things that pass. The standard also exempts a link
    // sitting inside a sentence, because making those 24px tall would wreck
    // the paragraph; that exemption is applied here rather than argued with
    // every time the report is read.
    const small = [];
    for (const el of document.querySelectorAll("a, button, input[type=checkbox], select")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.height >= 24 && r.width >= 24) continue;
      if ((el.textContent ?? "").trim().length === 0) continue;

      // Inline in a sentence? The parent holds text either side of it.
      const parent = el.parentElement;
      const inSentence =
        parent &&
        getComputedStyle(el).display.startsWith("inline") &&
        (parent.textContent ?? "").trim().length > (el.textContent ?? "").trim().length + 12;
      if (inSentence) continue;

      small.push(`${el.tagName.toLowerCase()} ${Math.round(r.height)}x${Math.round(r.width)} "${(el.textContent ?? "").trim().slice(0, 28)}"`);
    }

    return { overflow, culprits: culprits.slice(0, 6), trappedTables, small: small.slice(0, 4) };
  }, WIDTH);

  if (report.overflow > 1) {
    findings.push({ path, kind: "page-overflow", detail: `${report.overflow}px`, culprits: report.culprits });
  }
  if (report.trappedTables.length) {
    findings.push({ path, kind: "table-no-scroll", detail: report.trappedTables.join(" | ") });
  }
  if (report.small.length) {
    findings.push({ path, kind: "small-tap-target", detail: report.small.join(" | ") });
  }
}

await browser.close();

if (findings.length === 0) {
  console.log(`Clean at ${WIDTH}px.`);
} else {
  for (const f of findings) {
    console.log(`\n${f.path}  [${f.kind}]  ${f.detail ?? ""}`);
    for (const c of f.culprits ?? []) {
      console.log(`    <${c.tag} class="${c.cls}"> ${c.left}→${c.right}  "${c.text}"`);
    }
  }
  console.log(`\n${findings.length} finding(s).`);
}
