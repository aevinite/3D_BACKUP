// scripts/sweep/t11/browser.mjs — one place that puts a REAL printed document in a REAL browser.
//
// Sections K and L of the inherited ledger, and NEW D/E/G of its sweep-#7 block, all say the same
// thing in their headers: assert what is ON SCREEN or ON THE PDF, never the source string. So the
// documents are rendered by the shipped billdoc.js, served from the running site, loaded into
// Chromium, and measured there.
//
// SERVED, NOT IMPORTED. The page fetches /panels/billdoc.js from the dev server and injects it, so
// what is measured is the bytes a restaurant's browser would actually run — the lesson this repo
// records as "test the served site, not the source".
import { BILLDOC } from "./lib.mjs";

export const BASE = process.env.T11_BASE || "http://localhost:4311";
const pwMod = await import("playwright").catch(() => null);
export const reachable = await fetch(BASE + "/panels/billdoc.js").then((r) => r.ok).catch(() => false);
export const canDrive = !!(pwMod && reachable);

let browser = null;
export async function getBrowser() {
  if (!canDrive) return null;
  if (!browser) browser = await pwMod.chromium.launch();
  return browser;
}
export async function closeBrowser() { if (browser) { await browser.close(); browser = null; } }

/** 66mm of an 80mm roll at 96dpi ≈ 249px — the width the paper recipe is built to. */
export const ROLL_PX = Math.round(66 / 25.4 * 96);

/**
 * Render one of the three documents in a real page and hand back a probe.
 * `kind` — "bill" | "kot" | "banquet"; `data` — what that builder takes.
 * Options: { width, tz, locale, media } — media "print" applies the print stylesheet.
 */
export async function renderDoc(kind, data, opts = {}) {
  const b = await getBrowser();
  if (!b) return null;
  const ctx = await b.newContext({
    viewport: { width: opts.width || 1280, height: opts.height || 900 },
    deviceScaleFactor: opts.dpr || 1,
    ...(opts.tz ? { timezoneId: opts.tz } : {}),
    ...(opts.locale ? { locale: opts.locale } : {}),
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e).slice(0, 180)));
  page.on("console", (m) => m.type() === "error" && errs.push(m.text().slice(0, 180)));
  const html = kind === "bill" ? BILLDOC.billDocHtml(data)
    : kind === "kot" ? BILLDOC.kotDocHtml(data)
      : BILLDOC.banquetDocHtml(data);
  // A real same-origin page, so relative URLs and storage behave as they do in a bill window.
  await page.goto(BASE + "/print-setup.html", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.setContent(html, { waitUntil: "load", timeout: 60000 });
  if (opts.media) await page.emulateMedia({ media: opts.media });
  await page.waitForTimeout(opts.settle ?? 450);
  return { page, ctx, errs, html, close: async () => { await ctx.close(); } };
}

/** Everything a person can read on the page, as trimmed lines. */
export const seenText = (page) => page.evaluate(() => document.body.innerText.split("\n").map((s) => s.trim()).filter(Boolean));

/** The widest thing the PAPER actually paints, in CSS pixels.
 *  The screen-only toolbar is `position:fixed;left:0;right:0`, so it is as wide as the window and
 *  has nothing to do with the roll — measuring it made a perfectly good 249px bill read as 1280px
 *  the first time this helper ran. It is excluded here, and `@media print` hides it anyway. */
export const inkWidth = (page) => page.evaluate(() => {
  // MEASURED FROM THE SHEET'S OWN LEFT EDGE, not from the window's. The paper column is
  // `margin:0 auto`, so in a 1280px viewport a perfectly correct 249mm-wide bill sits at x=515 and
  // ends at x=765 — and reading the absolute `right` called that a 765px overflow. The question is
  // how wide the INK is, not where the window happened to centre it.
  const b0 = document.body.getBoundingClientRect();
  let max = 0;
  for (const el of document.querySelectorAll("body *")) {
    if (el.closest(".bar")) continue;                    // screen chrome, never on paper
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.position === "fixed") continue;
    const r = el.getBoundingClientRect();
    if (r.width > 0 && (r.right - b0.left) > max) max = r.right - b0.left;
  }
  return Math.round(max);
});

/** The document's own column width — what the paper recipe declares. */
export const bodyWidth = (page) => page.evaluate(() => Math.round(document.body.getBoundingClientRect().width));

/** Print the page to PDF and hand back its text and page count. */
export async function toPdf(page, opts = {}) {
  const buf = await page.pdf({ printBackground: true, preferCSSPageSize: true, ...opts });
  const s = buf.toString("latin1");
  const pages = (s.match(/\/Type\s*\/Page[^s]/g) || []).length;
  return { bytes: buf.length, pages: Math.max(1, pages), raw: s };
}

/** Does the RENDERED page contain this text, as a person would see it? */
export const showsText = async (page, needle) => (await seenText(page)).some((l) => l.includes(needle));
