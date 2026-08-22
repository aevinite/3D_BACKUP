// verify-bill-preview.mjs — the BILL PREVIEW's geometry: the toolbar never covers the bill, the
// whole sheet fits the window, and nothing on screen can reach the paper.
//
//   node scripts/verify-bill-preview.mjs
//
// WHY THIS EXISTS (T8 sweep #7, 2026-08-22). The preview grew a zoom layer on 2026-08-19 (owner:
// "make sure the preview looks in a small screen … I could able to see the whole bill in preview")
// and nothing watches it. It immediately broke a property the ledger had already checked and
// passed: the bar is `position:fixed` and wound back to life-size with the INVERSE zoom, so its
// height on screen is constant — while the space kept clear for it, `body{padding-top:calc(2mm +
// 34px)}`, sits INSIDE the zoomed body and shrinks with the zoom. The two scale in opposite
// directions, so as soon as the fit landed at or below about 1.0 the bar ate the restaurant name:
//
//     A35 360x780, 8-line bill    zoom 1.02   covered by 4px
//     A35 360x780, 60-line bill   zoom 0.60   covered by 26px — the whole name
//     desktop 1280x900, 60 lines  zoom 0.60   covered by 26px
//
// A 60-line bill is not a corner — the owner's own Aangan bill is 178mm of paper, which is why the
// 0.6 floor is in billdoc.js at all. This is kept OUT of verify-billdoc-paper.mjs deliberately:
// that guard is static by design (no database, no login, no browser) and this one needs a browser.
// It needs NO dev server and NO key — it renders the document straight into the page.
import { chromium } from "playwright";
import { createRequire } from "node:module";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const BILLDOC = require(join(ROOT, "public/panels/billdoc.js"));

let fails = 0;
const ok = (m) => console.log(`  ok   ${m}`);
const bad = (m, detail) => { fails++; console.log(`  FAIL ${m}`); if (detail) console.log(`         ${detail}`); };

const SETTINGS = {
  tax_components: [{ label: "CGST", rate: 2.5 }, { label: "SGST", rate: 2.5 }],
  gstin: "24ABCDE1234F1Z5",
  // a real name, long enough to wrap onto two lines on 66mm — that is the case that gets covered
  restaurant_name: "Aangan Garden Restaurant",
};
const bill = (n) => BILLDOC.billDocHtml(BILLDOC.billData({
  settings: SETTINGS, restaurant: {}, autoPrint: false, session: { bill_no: 41 },
  orders: [{ status: "served", subtotal: 100 * n, taxable_base: 100 * n, nontax_amount: 0,
    discount: 0, tax_rate: 0.05,
    items: Array.from({ length: n }, (_, i) => ({ title: "Dish " + (i + 1), qty: 1, price: 100, tax_mode: "excl" })) }],
}));

const VIEWPORTS = [
  ["a desktop window", { width: 1280, height: 900 }],
  ["a laptop window", { width: 1440, height: 700 }],
  ["a short window", { width: 1280, height: 420 }],
  ["a narrow window", { width: 520, height: 800 }],
  ["a Samsung A35", { width: 360, height: 780 }],
  ["an iPad upright", { width: 768, height: 1024 }],
];
const LENGTHS = [1, 2, 8, 30, 60, 120];

const browser = await chromium.launch({ headless: true });

// ── 1. THE TOOLBAR NEVER COVERS THE BILL ──────────────────────────────────────────────────────
{
  const covered = [];
  for (const [vWhat, vp] of VIEWPORTS) {
    for (const n of LENGTHS) {
      const ctx = await browser.newContext({ viewport: vp });
      const page = await ctx.newPage();
      await page.setContent(bill(n), { waitUntil: "load" });
      await page.waitForTimeout(180);
      const r = await page.evaluate(() => {
        const bar = document.querySelector(".bar");
        const h2 = document.querySelector("h2");
        if (!bar || !h2) return null;
        const b = bar.getBoundingClientRect(), t = h2.getBoundingClientRect();
        return { zoom: Number(getComputedStyle(document.body).zoom) || 1,
          over: Math.round(b.bottom - t.top), name: h2.textContent.trim() };
      });
      await ctx.close();
      if (!r) { covered.push(`${vWhat}/${n}: no toolbar or no name rendered`); continue; }
      if (r.over > 0) covered.push(`${vWhat}, ${n} lines (zoom ${r.zoom.toFixed(2)}): covered by ${r.over}px`);
    }
  }
  covered.length === 0
    ? ok(`the toolbar covers no part of the bill, across ${VIEWPORTS.length} window sizes x ${LENGTHS.length} bill lengths`)
    : bad(`the toolbar covers the restaurant name: ${covered.slice(0, 4).join(" · ")}${covered.length > 4 ? ` (+${covered.length - 4} more)` : ""}`,
      "the room reserved for the bar sits inside the ZOOMED body while the bar itself is life-size — measure the bar and divide the allowance by the zoom");
}

// ── 2. THE WHOLE SHEET IS ON SCREEN, OR SCROLLS ONLY AT THE FLOOR ─────────────────────────────
{
  const bads = [];
  for (const [vWhat, vp] of VIEWPORTS) {
    for (const n of LENGTHS) {
      const ctx = await browser.newContext({ viewport: vp });
      const page = await ctx.newPage();
      await page.setContent(bill(n), { waitUntil: "load" });
      await page.waitForTimeout(180);
      const r = await page.evaluate(() => ({
        zoom: Number(getComputedStyle(document.body).zoom) || 1,
        docH: document.documentElement.scrollHeight, winH: innerHeight,
        docW: document.documentElement.scrollWidth, winW: innerWidth }));
      await ctx.close();
      if (r.zoom < 0.6 - 1e-9 || r.zoom > 2 + 1e-9) bads.push(`${vWhat}/${n}: zoom ${r.zoom} outside 0.6–2`);
      else if (r.docW > r.winW + 2) bads.push(`${vWhat}/${n}: wider than the window (${r.docW} > ${r.winW})`);
      else if (r.docH > r.winH + 2 && r.zoom > 0.6 + 1e-9) bads.push(`${vWhat}/${n}: still scrolls at zoom ${r.zoom.toFixed(2)}, above the floor`);
    }
  }
  bads.length === 0
    ? ok("every bill opens with the whole sheet on screen, and scrolls only once it has hit the 0.6 floor")
    : bad(`a bill does not fit its window: ${bads.slice(0, 4).join(" · ")}`,
      "zFit must solve content*zoom + toolbar <= window — the toolbar does not scale with the zoom");
}

// ── 3. NOTHING ON SCREEN REACHES THE PAPER ────────────────────────────────────────────────────
{
  const bads = [];
  for (const n of [2, 8, 60]) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 420 } });
    const page = await ctx.newPage();
    await page.setContent(bill(n), { waitUntil: "load" });
    await page.waitForTimeout(180);
    // nudge the size by hand first, so a remembered zoom is in play
    await page.evaluate(() => { try { zStep(-1); zStep(-1); } catch (e) {} });
    await page.emulateMedia({ media: "print" });
    const r = await page.evaluate(() => ({
      zoom: getComputedStyle(document.body).zoom,
      width: Math.round(document.body.getBoundingClientRect().width),
      pad: getComputedStyle(document.body).paddingTop,
      overflow: document.body.scrollWidth,
      bar: (() => { const b = document.querySelector(".bar"); return b ? getComputedStyle(b).display : "gone"; })(),
      rows: document.querySelectorAll("tbody tr").length }));
    await ctx.close();
    if (r.zoom !== "1") bads.push(`${n} lines: printed zoom is ${r.zoom}`);
    if (r.width < 248 || r.width > 252) bads.push(`${n} lines: printed column is ${r.width}px, not 66mm`);
    if (r.overflow > 252) bads.push(`${n} lines: printed content overflows at ${r.overflow}px`);
    if (r.bar !== "none") bads.push(`${n} lines: the toolbar is ${r.bar} on the paper`);
    if (parseFloat(r.pad) > 8) bads.push(`${n} lines: the screen's toolbar allowance (${r.pad}) reached the paper`);
    if (r.rows !== n) bads.push(`${n} lines: ${r.rows} rows printed`);
  }
  bads.length === 0
    ? ok("the printed sheet is 66mm at zoom 1 with no toolbar and no screen padding, whatever the screen was doing")
    : bad(`the screen reached the paper: ${bads.join(" · ")}`,
      "the @media print rules carry !important so they beat an inline style — keep it that way");
}

await browser.close();
console.log(fails
  ? `\n${fails} check(s) FAILED — the bill preview does not show the whole bill, or the screen reached the paper.`
  : "\nAll checks passed — the preview shows the whole bill, uncovered, and the paper is untouched.");
process.exit(fails ? 1 : 0);
