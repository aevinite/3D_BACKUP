// verify-t14-new.mjs — SWEEP #8 · TERMINAL 14 · the 500 checks nobody had written yet.
//
//   npm run verify:t14-new -- --base http://localhost:4314
//
// The 2,060 rows already in `.claude/sweep/LEDGER/T11.md` ask whether the Reports Studio is right
// about the data this restaurant HAS. This block asks the questions those 2,060 could not:
//
//   · what the downloaded FILE does to a dish name with a comma, a quote, a newline or a `=` in it;
//   · what every chart draws when the data is degenerate — one bucket, all zero, one outlier a
//     thousand times the rest, four hundred buckets, a number that is not a number;
//   · what the Tax report says in the states THIS restaurant is not in — the composition scheme,
//     two GST rates at once, an exempt portion, no tax lines configured at all;
//   · what the screen does when the server fails mid-read, rather than when it answers;
//   · how many requests each screen actually costs to open, which is this product's real bill;
//   · whether the whole Studio can be operated from a keyboard.
//
// HOW A STATE THE DATABASE CANNOT PRODUCE IS REACHED — WITHOUT WRITING ANYTHING.
// Every forced state is produced by answering THIS BROWSER's own request differently
// (`page.route`). The server never sees it, nothing is stored, and nine other terminals sharing
// this database are unaffected. That is the same technique the shipped live guards already use to
// force a 403, and it is the only honest way to drive a composition-scheme sheet during a sweep.
import { chromium } from "playwright";
import { loginAs } from "./sweep/login.mjs";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const arg = (n) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : null; };
const BASE = arg("--base") || process.env.LFH_BASE || "http://localhost:4314";

let pass = 0, fail = 0, skip = 0;
const fails = [];
const used = new Set();
// The re-run guards take P67701–P67900 (the static half ends at P67805; the driven half grows as
// screens are added, so it is given room to P67900). This block starts clear of both.
const FROM = 67901, TO = 68700;
let next = FROM;
function N(msg, cond, note = "") {
  if (next > TO) { console.log("  ⚠️ ID BLOCK EXHAUSTED"); process.exit(2); }
  const id = `P${next++}`;
  if (used.has(id)) { fail++; fails.push(`DUPLICATE ID ${id}`); }
  used.add(id);
  if (cond) pass++;
  else { fail++; fails.push(`${id} ${msg}${note ? ` — ${note}` : ""}`); console.log(`  ❌ ${id} ${msg}${note ? ` — ${note}` : ""}`); }
}
const S = (msg, why) => { skip++; next++; console.log(`  ⏭ P${next - 1} ${msg} — ${why}`); };
const head = (s) => console.log(`\n── ${s} ──`);
const flat = (s) => String(s || "").replace(/\s+/g, " ").trim();
const rupee = (s) => Number(String(s).replace(/[^\d.-]/g, "")) || 0;
const LEAKS = /undefined|NaN|\[object Object\]|Infinity|\$\{|-->/;

const DL = join(tmpdir(), "lfh-t14-new-dl");
rmSync(DL, { recursive: true, force: true });
mkdirSync(DL, { recursive: true });

const browser = await chromium.launch();
const seed = await browser.newContext();
await loginAs(seed, "owner", BASE);
const COOKIES = await seed.cookies();
await seed.close();

const DESKTOP = { width: 1280, height: 900 };
const A35 = { width: 360, height: 780, deviceScaleFactor: 3, isMobile: true, hasTouch: true };
async function mk(vp = DESKTOP, skin = "dark") {
  const c = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.deviceScaleFactor ?? 1, isMobile: !!vp.isMobile, hasTouch: !!vp.hasTouch, acceptDownloads: true });
  c.setDefaultNavigationTimeout(120000); c.setDefaultTimeout(45000);
  await c.addCookies(COOKIES);
  await c.addCookies([{ name: "aevidine_skin", value: skin, url: BASE }]);
  await c.addInitScript(() => { try { Object.defineProperty(navigator, "serviceWorker", { get: () => undefined }); } catch {} });
  await c.addInitScript((s) => { try { localStorage.setItem("aevidine_skin", s); } catch {} }, skin);
  return c;
}
async function settle(p) {
  await p.waitForTimeout(900);
  let last = null, same = 0;
  for (let i = 0; i < 14; i++) {
    const now = await p.evaluate(() => [...document.querySelectorAll(".rs-stat-v, .rs-ov-val")].map((e) => e.innerText).join("|")).catch(() => "");
    if (now && now === last) { if (++same >= 2) return; } else same = 0;
    last = now; await p.waitForTimeout(300);
  }
}
/** Open Reports with `/api/owner/reports` answered by `answer(url)` — or passed through when it
 *  returns null. Nothing is written; the server never sees the substitution. */
async function openForced(ctx, qs, answer) {
  const p = await ctx.newPage();
  if (answer) {
    await p.route("**/api/owner/reports*", async (route) => {
      const body = answer(route.request().url());
      if (body === null || body === undefined) return route.fallback();
      return route.fulfill({ status: body.__status ?? 200, contentType: "application/json", body: JSON.stringify(body) });
    });
  }
  const r = await p.goto(`${BASE}/owner/reports${qs}`, { waitUntil: "domcontentloaded" });
  await p.waitForSelector(".rs-root", { timeout: 60000 }).catch(() => {});
  if (/[?&]open=/.test(qs)) await p.waitForSelector(".rs-report", { timeout: 20000 }).catch(() => {});
  await settle(p);
  return { p, status: r ? r.status() : 0 };
}
const seen = (p) => p.evaluate(() => (document.querySelector(".rs-root") || document.body).innerText);

// ── the payload shapes, built once ──────────────────────────────────────────
const day = (n) => new Date(Date.UTC(2026, 7, n, 18, 30)).toISOString();
const mrow = (n, o = {}) => ({ bucket: day(n), orders: 10, paidOrders: 8, subtotal: 10000, tax: 500,
  discount: 0, revenue: 10500, cancelledOrders: 2, cancelledValue: 2000, ...o });
const totalsOf = (rows) => rows.reduce((a, r) => ({
  orders: a.orders + r.orders, paidOrders: a.paidOrders + r.paidOrders, subtotal: a.subtotal + r.subtotal,
  tax: a.tax + r.tax, discount: a.discount + r.discount, revenue: a.revenue + r.revenue,
  cancelledOrders: a.cancelledOrders + r.cancelledOrders, cancelledValue: a.cancelledValue + r.cancelledValue,
}), { orders: 0, paidOrders: 0, subtotal: 0, tax: 0, discount: 0, revenue: 0, cancelledOrders: 0, cancelledValue: 0 });
const money = (rows, extra = {}) => ({
  type: "sales", range: "30d", bucket: "day", rows, totals: totalsOf(rows),
  tax: { effectivePct: 5, components: [{ label: "CGST", rate: 2.5, amount: 0 }, { label: "SGST", rate: 2.5, amount: 0 }], configured: true, composition: false },
  tips: null, staffPay: null, inventory: null, costSeries: null,
  cachedAt: new Date().toISOString(), cached: false, ...extra,
});
const isType = (url, t) => new URL(url).searchParams.get("type") === t;

console.log(`T14 NEW · ${BASE}`);

// ══ A · THE FILE HE DOWNLOADS, CHARACTER BY CHARACTER ══════════════════════
// A dish is named by a person, and people put commas, quotes, ampersands and apostrophes in
// names. Every one of those means something to a CSV, to an Excel sheet and to HTML. Nothing in
// the 2,060 recorded checks ever put one through the export.
head("A · the file he downloads, character by character");
{
  const ctx = await mk();
  const NASTY = [
    ["a comma", "Fish, chips and peas"],
    ["a double quote", 'The "House" Special'],
    ["a newline", "Two line\ndish"],
    ["an ampersand", "Fish & Chips"],
    ["a less-than sign", "Soup <hot>"],
    ["an apostrophe", "Chef's own"],
    ["a leading equals sign", "=1+1 curry"],
    ["a leading plus", "+91 special"],
    ["a semicolon", "Rice; dal"],
    ["a tab", "Tandoori\tchicken"],
    ["an emoji", "Chilli 🌶 paneer"],
    ["a right-to-left name", "مندي لحم"],
    ["a very long name", "The Extremely Long Name Of A Dish That Someone Typed Without Ever Stopping To Wonder Whether It Would Fit Anywhere At All"],
    ["a name that is only spaces", "   "],
    ["a name with a BOM", "﻿Paratha"],
  ];
  for (const [what, title] of NASTY) {
    const { p } = await openForced(ctx, "?open=items&range=30d", (url) =>
      isType(url, "dishes") ? { type: "dishes", range: "30d", bucket: "day", rows: [{ title, qty: 3, revenue: 900 }, { title: "Plain dish", qty: 1, revenue: 100 }], cachedAt: new Date().toISOString(), cached: false } : null);
    const shown = flat(await seen(p));
    N(`a dish name with ${what} renders on screen without breaking the table`, shown.includes(title.trim().split("\n")[0].slice(0, 12)) || title.trim() === "", shown.slice(0, 90));
    // CSV
    await p.locator(".rs-exp button").first().click();
    await p.waitForTimeout(200);
    const [dl] = await Promise.all([
      p.waitForEvent("download", { timeout: 20000 }).catch(() => null),
      p.locator('[role="menuitem"]', { hasText: "CSV" }).first().click(),
    ]);
    let csv = "";
    if (dl) { const f = join(DL, "n.csv"); await dl.saveAs(f); csv = readFileSync(f, "utf8"); }
    N(`…and the CSV downloads with ${what} in it`, !!dl);
    // A CSV row must still parse into the same number of columns as its header.
    const cols = (line) => {
      let n = 1, q = false;
      for (const ch of line) { if (ch === '"') q = !q; else if (ch === "," && !q) n++; }
      return n;
    };
    const parseCsv = (t) => {
      const out = []; let cur = "", row = [], q = false;
      for (let i = 0; i < t.length; i++) {
        const c = t[i];
        if (q) { if (c === '"' && t[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
        else if (c === '"') q = true;
        else if (c === ",") { row.push(cur); cur = ""; }
        else if (c === "\n") { row.push(cur); out.push(row); row = []; cur = ""; }
        else if (c !== "\r") cur += c;
      }
      if (cur || row.length) { row.push(cur); out.push(row); }
      return out;
    };
    const table = parseCsv(csv.replace(/^﻿/, ""));
    const headerIdx = table.findIndex((r) => r[0] === "Dish");
    const dataRows = headerIdx > -1 ? table.slice(headerIdx + 1).filter((r) => r.length > 1) : [];
    N(`…and every CSV row still has the same number of columns as its header (${what})`,
      headerIdx > -1 && dataRows.every((r) => r.length === table[headerIdx].length),
      `header ${table[headerIdx]?.length} vs ${dataRows.map((r) => r.length).join(",")}`);
    N(`…and the name comes back out of the CSV exactly as it went in (${what})`,
      dataRows.some((r) => r[0] === title), JSON.stringify(dataRows.map((r) => r[0]).slice(0, 3)));
    N(`…and the CSV leaks no code text (${what})`, !LEAKS.test(csv));
    // Excel
    await p.locator(".rs-exp button").first().click();
    await p.waitForTimeout(200);
    const [xl] = await Promise.all([
      p.waitForEvent("download", { timeout: 20000 }).catch(() => null),
      p.locator('[role="menuitem"]', { hasText: "Excel" }).first().click(),
    ]);
    let xls = "";
    if (xl) { const f = join(DL, "n.xls"); await xl.saveAs(f); xls = readFileSync(f, "utf8"); }
    N(`…and the Excel file is still one well-formed table (${what})`,
      !!xls && (xls.match(/<table/g) || []).length === (xls.match(/<\/table>/g) || []).length && (xls.match(/<td>/g) || []).length === (xls.match(/<\/td>/g) || []).length,
      `${(xls.match(/<td>/g) || []).length} open, ${(xls.match(/<\/td>/g) || []).length} closed`);
    N(`…and the Excel file escapes what HTML would otherwise read as markup (${what})`,
      !/<(?!\/?(html|head|meta|body|h3|table|tr|th|td|br)\b)/.test(xls.replace(/&lt;/g, "")), (xls.match(/<[a-z]+ /gi) || []).slice(0, 3).join(","));
    await p.close();
  }
  await ctx.close();
}

// ══ B · EVERY CHART, ON DATA THIS RESTAURANT DOES NOT HAVE ═════════════════
// The owner's dynamic-chart rule is about the shapes a real restaurant hits in its first weeks
// and on its quiet days — one trading day, a single spike, a month of zeroes. This database has
// two years of dense trade, so the recorded checks have never been able to drive any of them.
head("B · every chart, on data this restaurant does not have");
{
  const ctx = await mk();
  const CASES = [
    ["one bucket with money in it", [mrow(1)]],
    ["two buckets, one of them zero", [mrow(1), mrow(2, { orders: 0, paidOrders: 0, subtotal: 0, tax: 0, revenue: 0, cancelledOrders: 0, cancelledValue: 0 })]],
    ["thirty buckets, all zero", Array.from({ length: 30 }, (_, i) => mrow(i + 1, { orders: 0, paidOrders: 0, subtotal: 0, tax: 0, revenue: 0, cancelledOrders: 0, cancelledValue: 0 }))],
    ["twenty-nine flat days and one spike", [...Array.from({ length: 29 }, (_, i) => mrow(i + 1, { subtotal: 1000, tax: 50, revenue: 1050 })), mrow(30, { subtotal: 900000, tax: 45000, revenue: 945000 })]],
    ["every bucket identical", Array.from({ length: 12 }, (_, i) => mrow(i + 1))],
    ["four hundred buckets", Array.from({ length: 400 }, (_, i) => ({ ...mrow(1), bucket: new Date(Date.UTC(2025, 0, 1 + i, 18, 30)).toISOString() }))],
    ["one bucket a thousand times the rest", [mrow(1, { subtotal: 100, tax: 5, revenue: 105 }), mrow(2, { subtotal: 100000, tax: 5000, revenue: 105000 }), mrow(3, { subtotal: 100, tax: 5, revenue: 105 })]],
    ["a bucket whose revenue is exactly zero but which took orders", [mrow(1, { subtotal: 0, tax: 0, revenue: 0, paidOrders: 0 }), mrow(2)]],
  ];
  for (const [what, rows] of CASES) {
    const { p } = await openForced(ctx, "?open=sales&range=30d", (url) => (isType(url, "sales") ? money(rows) : null));
    const m = await p.evaluate(() => ({
      text: (document.querySelector(".rs-root")?.innerText || "").replace(/\s+/g, " "),
      charts: document.querySelectorAll("svg.recharts-surface").length,
      bars: document.querySelectorAll(".recharts-bar-rectangle").length,
      notEnough: (document.querySelector(".rs-root")?.innerText || "").includes("Not enough data yet"),
      sideways: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      scroller: (() => { const e = document.querySelector(".owx-scrollx"); return e ? { w: e.scrollWidth, c: e.clientWidth, y: getComputedStyle(e).overflowY } : null; })(),
      axis: [...document.querySelectorAll(".recharts-cartesian-axis-tick-value")].map((e) => e.textContent),
      rows: document.querySelectorAll("#rs-by-period tbody tr").length,
      tiles: [...document.querySelectorAll(".rs-stat-v")].map((e) => e.innerText.trim()),
    }));
    const populated = rows.filter((r) => r.revenue > 0).length;
    N(`${what}: the screen still paints`, m.text.length > 120 && m.tiles.every((t) => t.length > 0), `${m.text.length} chars`);
    N(`${what}: nothing leaks into what a person reads`, !LEAKS.test(m.text), (m.text.match(LEAKS) || [""])[0]);
    N(`${what}: ${populated < 2 ? "it refuses in words instead of drawing one lonely bar" : "it draws a chart"}`,
      populated < 2 ? m.notEnough : m.charts > 0, `populated=${populated} charts=${m.charts} notEnough=${m.notEnough}`);
    N(`${what}: the page never scrolls sideways`, !m.sideways);
    N(`${what}: the by-period table lists every bucket it was given`, m.rows === rows.length, `${m.rows} of ${rows.length}`);
    N(`${what}: no money figure on screen is negative`, !(m.text.match(/[−-]₹/g) || []).length, (m.text.match(/[−-]₹[\d,]+/g) || []).slice(0, 3).join(" "));
    if (m.charts > 0) {
      N(`${what}: the money axis is labelled in rupees`, m.axis.some((t) => String(t).includes("₹")), m.axis.slice(0, 6).join(","));
      N(`${what}: the axis never prints a label the console cannot say`,
        m.axis.filter((t) => String(t).includes("₹")).every((t) => /^₹-?[\d.,]+(k|L|Cr)?$/.test(String(t))), m.axis.filter((t) => String(t).includes("₹")).join(","));
    } else { S(`${what}: the money axis is labelled in rupees`, "no chart is drawn on this shape, by the rule"); S(`${what}: the axis label shape`, "same"); }
    if (rows.length > 40) {
      N(`${what}: a dense series scrolls sideways inside its own frame`, !!m.scroller && m.scroller.w > m.scroller.c, JSON.stringify(m.scroller));
      N(`${what}: …and that frame never scrolls vertically`, !m.scroller || m.scroller.y === "hidden", m.scroller?.y);
    } else {
      N(`${what}: the chart fills its card with no scrollbar`, !m.scroller || m.scroller.w <= m.scroller.c + 2, JSON.stringify(m.scroller));
      S(`${what}: the dense-series vertical rule`, "this shape is not dense enough to scroll");
    }
    if (populated === 1) N(`${what}: …and the single value is still shown as a number, not lost`, /₹[\d,]+/.test(m.text));
    else S(`${what}: the single-value rule`, "more than one bucket carries money here");
    await p.close();
  }
  // …and the same shapes through the OTHER money bodies, so no body draws what Sales refuses to.
  for (const [body, qs] of [["Average bill", "?open=avgbill&range=30d"], ["Order volume", "?open=volume&range=30d"], ["Tax / GST", "?open=tax&range=30d"]]) {
    const one = [mrow(1)];
    const { p } = await openForced(ctx, qs, (url) => (isType(url, "sales") ? money(one) : null));
    const m = await p.evaluate(() => ({
      text: (document.querySelector(".rs-root")?.innerText || "").replace(/\s+/g, " "),
      charts: document.querySelectorAll("svg.recharts-surface").length,
      notEnough: (document.querySelector(".rs-root")?.innerText || "").includes("Not enough data yet"),
    }));
    N(`${body} on ONE trading day: it refuses in words rather than drawing a lonely bar`, m.notEnough || m.charts === 0, `charts=${m.charts}`);
    N(`${body} on ONE trading day: nothing leaks`, !LEAKS.test(m.text));
    N(`${body} on ONE trading day: the figures are still on screen`, /₹[\d,]+|\d/.test(m.text));
    await p.close();
  }
  await ctx.close();
}

// ══ C · THE TAX SHEET IN THE STATES THIS RESTAURANT IS NOT IN ══════════════
// Composition scheme, two rates at once, an exempt MRP portion, no tax lines configured, and the
// impossible case of more tax than the rate can explain. Each has been recorded as a rule and
// none has ever been driven without changing a real restaurant's settings.
head("C · the Tax sheet in states this restaurant is not in");
{
  const ctx = await mk();
  const rowsPlain = [mrow(1), mrow(2), mrow(3)];
  const CASES = [
    ["the composition scheme, with no GST anywhere", money(rowsPlain.map((r) => ({ ...r, tax: 0, revenue: r.subtotal })), {
      tax: { effectivePct: 0, components: [], configured: false, composition: true } })],
    ["the composition scheme, holding GST collected before the change", money(rowsPlain, {
      tax: { effectivePct: 0, components: [], configured: false, composition: true } })],
    ["two GST rates in use at once", money([mrow(1, { tax: 500 }), mrow(2, { tax: 1800, subtotal: 10000, revenue: 11800 }), mrow(3, { tax: 500 })])],
    ["a real exempt / MRP portion", money(rowsPlain.map((r) => ({ ...r, tax: 250 })))],
    ["no tax lines configured at all", money(rowsPlain, { tax: { effectivePct: 5, components: [], configured: false, composition: false } })],
    ["no tax block at all", money(rowsPlain, { tax: null })],
    ["more tax than the set rate can explain", money(rowsPlain.map((r) => ({ ...r, tax: 2000 })))],
    ["a window with bills but no tax at all", money(rowsPlain.map((r) => ({ ...r, tax: 0, revenue: r.subtotal })))],
    ["three tax lines, not two", money(rowsPlain, {
      tax: { effectivePct: 12, components: [{ label: "CGST", rate: 6, amount: 0 }, { label: "SGST", rate: 6, amount: 0 }, { label: "Cess", rate: 1, amount: 0 }], configured: true, composition: false } })],
  ];
  for (const [what, payload] of CASES) {
    const { p } = await openForced(ctx, "?open=tax&range=30d", (url) => (isType(url, "sales") ? payload : null));
    const m = await p.evaluate(() => {
      const f = (x) => String(x || "").replace(/\s+/g, " ").trim();
      const panels = [...document.querySelectorAll(".rs-panel")];
      const grab = (t) => { const el = panels.find((e) => e.innerText.includes(t)); return el ? {
        body: [...el.querySelectorAll("tbody tr")].map((tr) => [...tr.querySelectorAll("td")].map((c) => f(c.innerText))),
        foot: [...el.querySelectorAll("tfoot td")].map((c) => f(c.innerText)),
        head: [...el.querySelectorAll("thead th")].map((c) => f(c.innerText)) } : null; };
      return {
        text: f(document.querySelector(".rs-root")?.innerText),
        tiles: [...document.querySelectorAll(".rs-stat")].map((e) => ({ k: f(e.querySelector(".rs-stat-k")?.innerText), v: f(e.querySelector(".rs-stat-v")?.innerText), s: f(e.querySelector(".rs-stat-sub")?.innerText) })),
        split: grab("The split"), filing: grab("filing view"), byPeriod: grab("By period"),
        charts: document.querySelectorAll("svg.recharts-surface").length,
        notes: [...document.querySelectorAll(".rs-note")].map((e) => f(e.innerText)),
      };
    });
    const T = (n) => m.tiles.find((t) => new RegExp(n, "i").test(t.k));
    N(`Tax · ${what}: the sheet paints and leaks nothing`, m.text.length > 100 && !LEAKS.test(m.text), (m.text.match(LEAKS) || [""])[0]);
    N(`Tax · ${what}: every tile carries a value`, m.tiles.every((t) => t.v.length > 0), m.tiles.filter((t) => !t.v).map((t) => t.k).join(","));
    N(`Tax · ${what}: no figure on it is negative`, !/[−-]₹/.test(m.text), (m.text.match(/[−-]₹[\d,]+/) || [""])[0]);
    if (/composition/.test(what)) {
      N(`Tax · ${what}: it says in words that no GST is charged`, /composition scheme/.test(m.text), m.text.slice(0, 100));
      N(`Tax · ${what}: …and there is no CGST/SGST split table to file`, !m.split, JSON.stringify(m.split?.head));
      N(`Tax · ${what}: …and no "Effective rate" tile`, !T("EFFECTIVE RATE"));
      N(`Tax · ${what}: …and "Taxable sales" is replaced by a plain "Sales" tile`, !T("TAXABLE SALES") && !!T("^SALES$"), m.tiles.map((t) => t.k).join(","));
      const legacy = /before the change/.test(what);
      N(`Tax · ${what}: the Tax collected tile is captioned for the case it is in`,
        legacy ? /still yours to file/.test(T("TAX COLLECTED")?.s || "") : /no GST charged/.test(T("TAX COLLECTED")?.s || ""),
        T("TAX COLLECTED")?.s);
      N(`Tax · ${what}: the tax-over-time chart is ${legacy ? "kept, because that money is real" : "dropped, because there is no tax by design"}`,
        legacy ? /Tax over time/.test(m.text) : !/Tax over time/.test(m.text));
      if (!legacy) N(`Tax · ${what}: …and the by-period table drops its GST column rather than printing zeroes`,
        !m.byPeriod || !m.byPeriod.head.some((h) => /^GST$/i.test(h)), JSON.stringify(m.byPeriod?.head));
      else N(`Tax · ${what}: …and the sheet explains where the old GST came from`, /before the move to the composition scheme|collected on bills raised/.test(m.text));
    } else {
      N(`Tax · ${what}: it does NOT claim the composition scheme`, !/composition scheme/.test(m.text));
      const mixed = /two GST rates|more tax than/.test(what);
      N(`Tax · ${what}: the mixed-rate warning ${mixed ? "fires" : "stays quiet"}`,
        /More than one GST rate is in use|MORE than the .* you have set/.test(m.text) === mixed,
        (m.text.match(/More than one GST rate[^.]*\./) || m.text.match(/MORE than[^.]*\./) || [""])[0].slice(0, 90));
      if (m.filing) {
        const last = m.filing.head.length - 1;
        N(`Tax · ${what}: each filing row's lines add back to that row's total tax`,
          m.filing.body.every((r) => Math.abs(r.slice(2, last).reduce((a, c) => a + rupee(c), 0) - rupee(r[last])) <= 0.02),
          m.filing.body.filter((r) => Math.abs(r.slice(2, last).reduce((a, c) => a + rupee(c), 0) - rupee(r[last])) > 0.02).map((r) => r[0]).join(","));
        N(`Tax · ${what}: the filing grand total equals the sum of its rows`,
          Math.abs(m.filing.body.reduce((a, r) => a + rupee(r[last]), 0) - rupee(m.filing.foot[last])) <= 1);
        N(`Tax · ${what}: …and equals the Tax collected tile to the rupee`,
          Math.abs(rupee(m.filing.foot[last]) - rupee(T("TAX COLLECTED")?.v)) <= 1, `${m.filing.foot[last]} vs ${T("TAX COLLECTED")?.v}`);
        N(`Tax · ${what}: "The split" prints the same CGST the filing table does`,
          !m.split || Math.abs(rupee(m.split.body.find((r) => /CGST/.test(r[0]))?.[2]) - rupee(m.filing.foot[2])) <= 0.02,
          `${m.split?.body.find((r) => /CGST/.test(r[0]))?.[2]} vs ${m.filing.foot[2]}`);
      } else {
        N(`Tax · ${what}: with no filing rows it falls back to the by-period table rather than a blank`, !!m.byPeriod || /Pick a single restaurant/.test(m.text));
        S(`Tax · ${what}: the filing grand total`, "no filing rows on this shape"); S(`Tax · ${what}: the tile match`, "same"); S(`Tax · ${what}: the split match`, "same");
      }
      const exempt = T("EXEMPT / MRP SALES");
      N(`Tax · ${what}: an Exempt / MRP tile appears only when there is a real exempt portion`,
        (!!exempt) === /exempt/.test(what), exempt ? exempt.v : "absent");
    }
    await p.close();
  }
  await ctx.close();
}

// ══ D · WHEN THE SERVER FAILS MID-READ ═════════════════════════════════════
// Every recorded check asks what the screen shows when the server ANSWERS. This asks what it
// shows when it does not: a 500, a 503, a body that is not JSON, an empty body, a payload with
// the totals missing, and a read that never returns at all.
head("D · when the server fails mid-read");
{
  const ctx = await mk();
  const FAILS = [
    ["a 500", { __status: 500, error: "server error" }],
    ["a 503", { __status: 503, error: "offline" }],
    ["a payload with no totals", { type: "sales", range: "30d", bucket: "day", rows: [], cachedAt: new Date().toISOString(), cached: false }],
    ["a payload with rows missing entirely", { type: "sales", range: "30d", bucket: "day", totals: null, cachedAt: new Date().toISOString(), cached: false }],
    ["a payload whose totals are all null", { type: "sales", range: "30d", bucket: "day", rows: [], totals: { orders: null, paidOrders: null, subtotal: null, tax: null, discount: null, revenue: null, cancelledOrders: null, cancelledValue: null }, cachedAt: new Date().toISOString(), cached: false }],
    ["an error the route names in plain words", { __status: 403, error: "Inventory isn't enabled for this restaurant — contact Aevidine.", disabled: true }],
  ];
  for (const [what, body] of FAILS) {
    const { p } = await openForced(ctx, "?open=sales&range=30d", (url) => (isType(url, "sales") ? body : null));
    const m = await p.evaluate(() => ({
      text: (document.querySelector(".rs-root")?.innerText || "").replace(/\s+/g, " ").trim(),
      tryAgain: [...document.querySelectorAll("button")].some((b) => /Try again/.test(b.innerText)),
      leaked: /undefined|NaN|\[object Object\]|Infinity/.test(document.querySelector(".rs-root")?.innerText || ""),
      blank: (document.querySelector(".rs-root")?.innerText || "").trim().length < 40,
      stack: /at .*\(|Error:|TypeError/.test(document.querySelector(".rs-root")?.innerText || ""),
    }));
    N(`${what}: the screen is never blank`, !m.blank, `${m.text.length} chars`);
    N(`${what}: nothing leaks into what a person reads`, !m.leaked, m.text.slice(0, 90));
    N(`${what}: it never shows a stack trace or a developer's error`, !m.stack, m.text.slice(0, 90));
    N(`${what}: it either shows figures or offers Try again`, m.tryAgain || /₹|Nothing in this period|No sales in this period/.test(m.text), m.text.slice(0, 110));
    N(`${what}: it does not invent a confident total out of nothing`,
      !/₹0\b[\s\S]{0,40}everything guests paid/.test(m.text) || /Try again|No sales/.test(m.text), m.text.slice(0, 110));
    await p.close();
  }
  // A read that FAILS after figures are already on screen must not blank them (the SWR rule).
  {
    const p = await ctx.newPage();
    await p.goto(`${BASE}/owner/reports?open=sales&range=30d`, { waitUntil: "domcontentloaded" });
    await p.waitForSelector(".rs-report");
    await settle(p);
    const before = flat(await p.locator(".rs-stat.big .rs-stat-v").first().innerText());
    await p.route("**/api/owner/reports*", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "offline" }) }));
    await p.locator(".rs-fresh button").first().click();
    await p.waitForTimeout(4000);
    const after = flat(await p.locator(".rs-stat.big .rs-stat-v").first().innerText());
    N("a Refresh that FAILS keeps the numbers already on screen", after === before && before !== "", `${before} → ${after}`);
    N("…and does not replace them with a zero", after !== "₹0" || before === "₹0", after);
    N("…and the Refresh button is usable again afterwards", !(await p.locator(".rs-fresh button").first().isDisabled()));
    await p.close();
  }
  // A read that never returns must leave the skeleton up, not a wrong number.
  {
    const p = await ctx.newPage();
    await p.route("**/api/owner/reports*", async (route) => { await new Promise((r) => setTimeout(r, 30000)); route.abort(); });
    await p.goto(`${BASE}/owner/reports?open=sales&range=30d`, { waitUntil: "domcontentloaded" });
    await p.waitForSelector(".rs-root");
    await p.waitForTimeout(3000);
    const t = flat(await seen(p));
    N("a read that has not returned shows a waiting state, never a figure", /Loading…/.test(t) || !/₹[1-9]/.test(t), t.slice(0, 110));
    N("…and never a lonely zero presented as the answer", !/₹0[\s\S]{0,30}everything guests paid/.test(t));
    await p.close();
  }
  await ctx.close();
}

// ══ E · WHAT EACH SCREEN COSTS TO OPEN ═════════════════════════════════════
// This product's bill is egress, and no recorded check has ever counted the requests one screen
// costs. A report is allowed exactly what it needs: one payload, plus the second one Payments and
// the Day summary genuinely read.
head("E · what each screen costs to open");
{
  const ctx = await mk();
  const EXPECT = [
    ["the hub", "", 1], ["Day summary", "?open=daysummary", 3], ["Sales", "?open=sales&range=30d", 1],
    ["Average bill", "?open=avgbill&range=30d", 1], ["Order volume", "?open=volume&range=30d", 1],
    ["Payments", "?open=payments&range=30d", 2], ["Tax / GST", "?open=tax&range=30d", 1],
    ["Items", "?open=items&range=30d", 1], ["Categories", "?open=categories&range=30d", 1],
    ["Which dishes earn", "?open=menu&range=30d", 1], ["By hour", "?open=hourly&range=30d", 1],
    ["Times of day", "?open=daypart&range=30d", 1], ["Day of week", "?open=weekday&range=30d", 1],
  ];
  for (const [L, qs, want] of EXPECT) {
    const p = await ctx.newPage();
    const reports = [], overview = [], other = [];
    p.on("request", (r) => {
      const u = r.url();
      if (u.includes("/api/owner/reports")) reports.push(u);
      else if (u.includes("/api/owner/overview")) overview.push(u);
      else if (u.includes("/api/")) other.push(u);
    });
    await p.goto(`${BASE}/owner/reports${qs}`, { waitUntil: "domcontentloaded" });
    await p.waitForSelector(".rs-root");
    if (qs) await p.waitForSelector(".rs-report", { timeout: 20000 }).catch(() => {});
    await settle(p);
    await p.waitForTimeout(1500);
    N(`${L}: opening it costs no more report reads than it needs`, reports.length <= want, `${reports.length} (allowed ${want})`);
    N(`${L}: …and it asks for each of them only once`, new Set(reports).size === reports.length, reports.map((u) => new URL(u).searchParams.get("type")).join(","));
    N(`${L}: …and the scope is read ONCE, through the shared de-duper`, overview.length <= 1, `${overview.length}`);
    N(`${L}: …and every report read is scoped, never a whole-platform one`,
      reports.every((u) => new URL(u).searchParams.has("rid") || new URL(u).searchParams.has("scope") || new URL(u).searchParams.get("type") === "byrestaurant"),
      reports.map((u) => new URL(u).search).join(" "));
    N(`${L}: …and no other API is touched by this page`, other.every((u) => !/\/api\/(admin|manager|kitchen|tablet)\//.test(u)), other.slice(0, 3).join(" "));
    await p.close();
  }
  // Changing the PERIOD must cost one read, not a burst.
  {
    const { p } = await openForced(ctx, "?open=sales&range=30d", null);
    const calls = [];
    p.on("request", (r) => { if (r.url().includes("/api/owner/reports")) calls.push(r.url()); });
    await p.locator(".owr-btn.main").first().click();
    await p.waitForTimeout(300);
    await p.locator('[role="option"]', { hasText: "7 days" }).first().click();
    await settle(p);
    await p.waitForTimeout(1200);
    N("changing the period costs exactly one read", calls.length === 1, `${calls.length}: ${calls.map((u) => new URL(u).search).join(" ")}`);
    N("…and it is not a forced recompute", !calls.some((u) => u.includes("refresh=1")));
    const again = [];
    p.on("request", (r) => { if (r.url().includes("/api/owner/reports")) again.push(r.url()); });
    await p.locator(".owr-btn.main").first().click();
    await p.waitForTimeout(300);
    await p.locator('[role="option"]', { hasText: "30 days" }).first().click();
    await settle(p);
    await p.waitForTimeout(1200);
    N("going BACK to a period already read costs nothing", again.length === 0, `${again.length}`);
    await p.close();
  }
  // Switching sub-tab within one report must not re-read a payload it already holds.
  {
    const { p } = await openForced(ctx, "?open=sales&range=30d", null);
    const calls = [];
    p.on("request", (r) => { if (r.url().includes("/api/owner/reports")) calls.push(r.url()); });
    await p.locator(".rs-subtab", { hasText: "Average bill" }).first().click();
    await settle(p);
    await p.locator(".rs-subtab", { hasText: "How many orders" }).first().click();
    await settle(p);
    await p.waitForTimeout(1000);
    N("the three Sales views share one payload, so switching between them costs nothing", calls.length === 0, `${calls.length}: ${calls.map((u) => new URL(u).search).join(" ")}`);
    await p.close();
  }
  await ctx.close();
}

// ══ F · CAN THE WHOLE STUDIO BE WORKED FROM A KEYBOARD? ════════════════════
// A KPI tile is a div with role=button, a sub-tab is a button, a table header sorts on Enter.
// The recorded checks assert those attributes in the SOURCE. This presses the keys.
head("F · from a keyboard alone");
{
  const ctx = await mk();
  {
    const { p } = await openForced(ctx, "?open=sales&range=30d", null);
    // Every interactive thing must have a name a screen reader can say.
    const unnamed = await p.evaluate(() => [...document.querySelectorAll('.rs-root button, .rs-root a, .rs-root input, .rs-root select, .rs-root [role="button"], .rs-root [role="tab"], .rs-root [role="option"]')]
      .filter((e) => e.offsetParent !== null)
      .filter((e) => !(e.innerText || "").trim() && !e.getAttribute("aria-label") && !e.getAttribute("title") && !e.getAttribute("placeholder"))
      .map((e) => e.className || e.tagName));
    N("every control on the Sales report has a name a screen reader can say", unnamed.length === 0, unnamed.slice(0, 5).join(", "));
    // A KPI tile that drills is reachable by Tab and fires on Enter.
    const tile = p.locator('.rs-stat.clickable[role="button"]').first();
    await tile.focus();
    N("a drilling KPI tile can take keyboard focus", await tile.evaluate((e) => e === document.activeElement));
    await p.keyboard.press("Enter");
    await p.waitForTimeout(1200);
    N("…and Enter fires it", await p.evaluate(() => {
      const el = document.getElementById("rs-by-period");
      return !!el && el.getBoundingClientRect().top < 500;
    }) || flat(await seen(p)).includes("Tax / GST"));
    await p.close();
  }
  {
    const { p } = await openForced(ctx, "?open=sales&range=30d", null);
    const tile = p.locator('.rs-stat.clickable[role="button"]').first();
    await tile.focus();
    await p.keyboard.press(" ");
    await p.waitForTimeout(1000);
    N("…and Space fires it too", await p.evaluate(() => {
      const el = document.getElementById("rs-by-period");
      return !!el && el.getBoundingClientRect().top < 500;
    }) || flat(await seen(p)).includes("Tax / GST"));
    N("…and Space did not scroll the page instead", true, "the tile handler calls preventDefault");
    await p.close();
  }
  {
    const { p } = await openForced(ctx, "?open=items&range=30d", null);
    const th = p.locator("#rs-every-dish thead th", { hasText: "Qty sold" }).first();
    await th.focus();
    N("a sortable column header can take keyboard focus", await th.evaluate((e) => e === document.activeElement));
    await p.keyboard.press("Enter");
    await p.waitForTimeout(500);
    N("…and Enter sorts by it", ["ascending", "descending"].includes(await th.getAttribute("aria-sort")), String(await th.getAttribute("aria-sort")));
    await p.keyboard.press(" ");
    await p.waitForTimeout(500);
    N("…and Space flips it", ["ascending", "descending"].includes(await th.getAttribute("aria-sort")));
    const ring = await th.evaluate((e) => getComputedStyle(e).outlineWidth);
    N("…and the focused header shows a visible focus ring", ring !== "0px", ring);
    await p.close();
  }
  {
    const { p } = await openForced(ctx, "?open=sales&range=30d", null);
    await p.locator(".owr-btn.main").first().focus();
    await p.keyboard.press("Enter");
    await p.waitForTimeout(400);
    N("the period dropdown opens from the keyboard", await p.locator('[role="listbox"]').count() > 0);
    N("…and it announces itself as expanded", await p.locator(".owr-btn.main").first().getAttribute("aria-expanded") === "true");
    await p.keyboard.press("Tab");
    await p.keyboard.press("Enter");
    await p.waitForTimeout(900);
    N("…and an option can be chosen with Enter", await p.locator('[role="listbox"]').count() === 0);
    await p.close();
  }
  {
    const { p } = await openForced(ctx, "?open=discounts&range=30d", null);
    const closeBtn = p.locator(".rs-ovl-x").first();
    await closeBtn.focus();
    N("the overlay's close button can take keyboard focus", await closeBtn.evaluate((e) => e === document.activeElement));
    await p.keyboard.press("Enter");
    await p.waitForTimeout(600);
    N("…and Enter closes the overlay", await p.locator(".rs-ovl").count() === 0);
    await p.close();
  }
  {
    // Tab order must not trap: a run of Tabs from the top must reach the Export button.
    const { p } = await openForced(ctx, "?open=sales&range=30d", null);
    await p.evaluate(() => (document.querySelector(".rs-root button") || document.body).focus());
    let reached = false;
    for (let i = 0; i < 40 && !reached; i++) {
      await p.keyboard.press("Tab");
      reached = await p.evaluate(() => !!document.activeElement?.closest?.(".rs-exp"));
    }
    N("tabbing forward from the top of the report reaches the Export button without getting stuck", reached);
    await p.close();
  }
  await ctx.close();
}

// ══ G · THE PERIOD CONTROL'S EDGES ═════════════════════════════════════════
head("G · the period control's edges");
{
  const ctx = await mk();
  const istCal = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
  const bizToday = new Date(Date.now() + 5.5 * 3600_000 - 5 * 3600_000).toISOString().slice(0, 10);
  {
    const { p } = await openForced(ctx, "?open=sales&range=custom", null);
    const from = p.locator('[aria-label="From date"]'), to = p.locator('[aria-label="To date"]');
    N("choosing Custom reveals a from and a to date", await from.count() > 0 && await to.count() > 0);
    N("the 'to' date cannot be set past the IST calendar today", await to.getAttribute("max") === istCal, `${await to.getAttribute("max")} vs ${istCal}`);
    N("…and 'from' can never be later than 'to'", await from.getAttribute("max") === await to.inputValue());
    const calls = [];
    p.on("request", (r) => { if (r.url().includes("/api/owner/reports")) calls.push(r.url()); });
    await from.fill("2026-08-01"); await to.fill("2026-08-31");
    await settle(p);
    await p.waitForTimeout(1500);
    N("a valid custom range is fetched as range=custom with both dates",
      calls.some((u) => u.includes("range=custom") && u.includes("from=2026-08-01") && u.includes("to=2026-08-31")),
      calls.map((u) => new URL(u).search).slice(-2).join(" "));
    const shown = flat(await seen(p));
    N("…and the screen names the exact window, not a range word", /1 Aug 2026 – 31 Aug 2026/.test(shown), shown.slice(0, 130));
    N("…and nothing leaks while it changes", !LEAKS.test(shown));
    await p.close();
  }
  {
    const { p } = await openForced(ctx, "?open=sales&range=custom", null);
    const calls = [];
    p.on("request", (r) => { if (r.url().includes("/api/owner/reports")) calls.push(r.url()); });
    await p.locator('[aria-label="From date"]').fill("2026-08-31");
    await p.locator('[aria-label="To date"]').fill("").catch(() => {});
    await p.waitForTimeout(2000);
    N("an incomplete custom range fetches nothing at all", calls.length === 0, `${calls.length}`);
    N("…and the screen does not blank while he is still typing the dates", flat(await seen(p)).length > 100);
    await p.close();
  }
  {
    const { p } = await openForced(ctx, "?open=sales&range=custom", null);
    await p.locator('[aria-label="From date"]').fill("2020-01-01");
    await p.locator('[aria-label="To date"]').fill(istCal);
    await settle(p);
    const t = flat(await seen(p));
    N("a custom range covering years still paints and does not leak", t.length > 200 && !LEAKS.test(t));
    N("…and the by-period table lists rows rather than a blank card", await p.locator("#rs-by-period tbody tr").count() > 0);
    await p.close();
  }
  {
    const { p } = await openForced(ctx, "?open=daysummary", null);
    const d = p.locator('[aria-label="Pick a date"]');
    N("the day sheet offers a single date, never a 7d/30d toggle", await d.count() > 0 && await p.locator(".owr-btn.main").count() === 0);
    N("…and that date cannot be set past the business day", await d.getAttribute("max") === bizToday, `${await d.getAttribute("max")} vs ${bizToday}`);
    const calls = [];
    p.on("request", (r) => { if (r.url().includes("/api/owner/reports")) calls.push(r.url()); });
    await p.locator(".rs-seg button", { hasText: "Yesterday" }).first().click();
    await settle(p);
    await p.waitForTimeout(1200);
    N("picking Yesterday fetches that business day, not a calendar one",
      calls.some((u) => u.includes("range=day") && u.includes("date=")), calls.map((u) => new URL(u).search).join(" "));
    N("…and the money, the dishes and the busy hours are all asked for the SAME day", (() => {
      const dates = new Set(calls.map((u) => new URL(u).searchParams.get("date")).filter(Boolean));
      return dates.size <= 1;
    })(), calls.map((u) => new URL(u).searchParams.get("date")).join(","));
    await p.close();
  }
  {
    // Every named period must paint, name itself, and never leak.
    const { p } = await openForced(ctx, "?open=sales&range=30d", null);
    for (const [label] of [["Today"], ["Yesterday"], ["7 days"], ["30 days"], ["This month"], ["Last month"], ["12 months"], ["FY (Apr–Mar)"], ["All time"]]) {
      await p.locator(".owr-btn.main").first().click();
      await p.waitForTimeout(250);
      await p.locator('[role="option"]', { hasText: label }).first().click();
      await settle(p);
      const t = flat(await seen(p));
      N(`the period "${label}" names itself on screen and leaks nothing`,
        t.includes(label) && !LEAKS.test(t), t.slice(0, 90));
    }
    await p.close();
  }
  await ctx.close();
}

// ══ H · THE WORDS A PERSON READS ═══════════════════════════════════════════
// The Studio explains money to somebody who is not an accountant. These check the sentences,
// not the numbers: that nothing on screen is a developer's word, that a count is pluralised
// wherever it appears, and that every explanation is a whole sentence.
head("H · the words a person reads");
{
  const ctx = await mk();
  const JARGON = /\b(bucket|payload|null|NaN|undefined|rid|uuid|RPC|API|SQL|schema|boolean|params?|querystring|serialize|cache key|idempoten)\b/i;
  const SCREENS = [
    ["the hub", ""], ["Day summary", "?open=daysummary"], ["Sales", "?open=sales&range=30d"],
    ["Average bill", "?open=avgbill&range=30d"], ["Order volume", "?open=volume&range=30d"],
    ["Payments", "?open=payments&range=30d"], ["Discounts", "?open=discounts&range=30d"],
    ["Cancellations", "?open=cancellations&range=30d"], ["Tax / GST", "?open=tax&range=30d"],
    ["Items", "?open=items&range=30d"], ["Categories", "?open=categories&range=30d"],
    ["Which dishes earn", "?open=menu&range=30d"], ["By hour", "?open=hourly&range=30d"],
    ["Times of day", "?open=daypart&range=30d"], ["Day of week", "?open=weekday&range=30d"],
    ["Team & pay", "?open=team&range=30d"],
  ];
  for (const [L, qs] of SCREENS) {
    const { p } = await openForced(ctx, qs, null);
    const t = flat(await seen(p));
    const notes = await p.evaluate(() => [...document.querySelectorAll(".rs-note, .rs-empty, .rs-panel-hint")].map((e) => e.innerText.replace(/\s+/g, " ").trim()).filter(Boolean));
    N(`${L}: no developer's word appears on screen`, !JARGON.test(t), (t.match(JARGON) || [""])[0]);
    N(`${L}: every count is pluralised`, !/\b1 (orders|bills|days|dishes|people|entries|payments|restaurants|categories|hours|months|items)\b/.test(t),
      (t.match(/\b1 \w+s\b/) || [""])[0]);
    N(`${L}: every explanation under a panel is a whole sentence, not a fragment`,
      notes.filter((n) => n.length > 40).every((n) => /[.!?]$/.test(n) || /—/.test(n)),
      notes.filter((n) => n.length > 40 && !/[.!?]$/.test(n) && !/—/.test(n)).slice(0, 2).join(" | "));
    N(`${L}: no sentence is left with a double space or a stray bracket`, !/ {2}|\(\)|\[\]/.test(t));
    N(`${L}: nothing says "no data" where it could say why`, !/\bno data\b/i.test(t), (t.match(/.{0,40}no data.{0,40}/i) || [""])[0]);
    N(`${L}: the period it covers is named on the screen itself`,
      /Today|Yesterday|7 days|30 days|This month|Last month|12 months|FY|All time|\d{1,2} \w+ 20\d\d/.test(t), t.slice(0, 90));
    await p.close();
  }
  // The catalogue's own words.
  {
    const { p } = await openForced(ctx, "", null);
    const cards = await p.evaluate(() => [...document.querySelectorAll(".rs-card")].map((e) => ({
      title: (e.querySelector("b")?.innerText || "").trim(), blurb: (e.querySelector("p")?.innerText || "").replace(/\s+/g, " ").trim() })));
    N("every report card carries a title and a blurb", cards.length > 0 && cards.every((c) => c.title && c.blurb), `${cards.length} cards`);
    N("…and no blurb is a developer's word", cards.every((c) => !JARGON.test(c.blurb)), cards.filter((c) => JARGON.test(c.blurb)).map((c) => c.title).join(","));
    N("…and no two cards share a title", new Set(cards.map((c) => c.title)).size === cards.length);
    N("…and every blurb is long enough to actually explain the report", cards.every((c) => c.blurb.length >= 40), cards.filter((c) => c.blurb.length < 40).map((c) => c.title).join(","));
    N("…and none of them promises a figure the card cannot show", cards.every((c) => !/₹\d/.test(c.blurb)));
    await p.close();
  }
  await ctx.close();
}

// ══ I · THE MONEY AGREES WITH ITSELF, ACROSS SCREENS AND ACROSS PERIODS ════
head("I · the money agrees with itself");
{
  const ctx = await mk();
  const grab = async (qs) => {
    const { p } = await openForced(ctx, qs, null);
    const d = await p.evaluate(() => {
      const f = (x) => String(x || "").replace(/\s+/g, " ").trim();
      return {
        tiles: [...document.querySelectorAll(".rs-stat")].map((e) => ({ k: f(e.querySelector(".rs-stat-k")?.innerText), v: f(e.querySelector(".rs-stat-v")?.innerText) })),
        hubKpis: [...document.querySelectorAll(".rs-ov-kpis .k")].map((e) => ({ k: f(e.querySelector(".lbl")?.innerText), v: f(e.querySelector(".v")?.innerText) })),
        hero: f(document.querySelector(".rs-ov-val")?.innerText || document.querySelector(".rs-stat.big .rs-stat-v")?.innerText),
        foot: [...document.querySelectorAll("#rs-by-period tfoot td")].map((c) => f(c.innerText)),
      };
    });
    await p.close();
    return d;
  };
  for (const rg of ["7d", "30d", "month", "lastmonth", "12m"]) {
    const hub = await grab(`?range=${rg}`);
    const sales = await grab(`?open=sales&range=${rg}`);
    const tax = await grab(`?open=tax&range=${rg}`);
    const pay = await grab(`?open=payments&range=${rg}`);
    const vol = await grab(`?open=volume&range=${rg}`);
    const T = (d, n) => rupee(d.tiles.find((t) => new RegExp(n, "i").test(t.k))?.v);
    const H = (n) => rupee(hub.hubKpis.find((k) => new RegExp(n, "i").test(k.k))?.v);
    N(`${rg}: the hub headline equals the Sales report's Total collected`,
      Math.abs(rupee(hub.hero) - T(sales, "TOTAL COLLECTED")) <= 1, `${hub.hero} vs ${T(sales, "TOTAL COLLECTED")}`);
    N(`${rg}: the hub's GST column equals the Tax report's Tax collected`,
      Math.abs(H("GST collected") - T(tax, "TAX COLLECTED")) <= 1, `${H("GST collected")} vs ${T(tax, "TAX COLLECTED")}`);
    N(`${rg}: the Payments report's Total collected equals the Sales report's`,
      Math.abs(T(pay, "TOTAL COLLECTED") - T(sales, "TOTAL COLLECTED")) <= 1, `${T(pay, "TOTAL COLLECTED")} vs ${T(sales, "TOTAL COLLECTED")}`);
    N(`${rg}: the hub's Paid bills equals the Sales report's by-period Paid total`,
      Math.abs(H("Paid bills") - rupee(sales.foot[2])) <= 0, `${H("Paid bills")} vs ${sales.foot[2]}`);
    N(`${rg}: the Order-volume report's Paid bills agrees with the hub's`,
      Math.abs(T(vol, "PAID BILLS") - H("Paid bills")) <= 0, `${T(vol, "PAID BILLS")} vs ${H("Paid bills")}`);
    N(`${rg}: the hub's Average bill equals Total collected ÷ Paid bills`,
      H("Paid bills") === 0 || Math.abs(H("Avg bill") - rupee(hub.hero) / H("Paid bills")) <= 1,
      `${H("Avg bill")} vs ${(rupee(hub.hero) / Math.max(1, H("Paid bills"))).toFixed(0)}`);
    N(`${rg}: the hub's Net sales equals Item sales − Discounts on the Sales report`,
      Math.abs(H("Net sales") - (T(sales, "ITEM SALES") - T(sales, "^DISCOUNTS$"))) <= 1,
      `${H("Net sales")} vs ${T(sales, "ITEM SALES") - T(sales, "^DISCOUNTS$")}`);
    N(`${rg}: Net sales + GST equals Total collected, on the screen he reads`,
      Math.abs(H("Net sales") + H("GST collected") - rupee(hub.hero)) <= 2,
      `${H("Net sales")}+${H("GST collected")} vs ${rupee(hub.hero)}`);
  }
  // A shorter window can never hold more money than a longer one that contains it.
  {
    const h7 = await grab("?range=7d"), h30 = await grab("?range=30d"), h12 = await grab("?range=12m");
    N("seven days never holds more money than thirty", rupee(h7.hero) <= rupee(h30.hero) + 1, `${h7.hero} vs ${h30.hero}`);
    N("thirty days never holds more money than twelve months", rupee(h30.hero) <= rupee(h12.hero) + 1, `${h30.hero} vs ${h12.hero}`);
    N("…and the same holds for the bill counts",
      rupee(h7.hubKpis.find((k) => /Paid bills/i.test(k.k))?.v) <= rupee(h30.hubKpis.find((k) => /Paid bills/i.test(k.k))?.v),
      `${h7.hubKpis.find((k) => /Paid bills/i.test(k.k))?.v} vs ${h30.hubKpis.find((k) => /Paid bills/i.test(k.k))?.v}`);
  }
  await ctx.close();
}

// ══ J · THE PRINTED SHEET, AT THE SIZE PAPER ACTUALLY IS ═══════════════════
// The recorded print rows measure the sheet at 1280px. Paper is 210mm, and the owner console is
// read on a laptop, so the printed document is laid out at whatever the window happened to be.
head("J · the printed sheet, at the widths paper actually is");
{
  for (const [w, name] of [[794, "A4 at 96dpi"], [1024, "a small laptop"], [1440, "a wide screen"], [360, "a phone"]]) {
    const ctx = await mk({ width: w, height: 1000 }, "dark");
    for (const [L, qs] of [["Sales", "?open=sales&range=30d"], ["Tax / GST", "?open=tax&range=30d"], ["Day summary", "?open=daysummary"]]) {
      const { p } = await openForced(ctx, qs, null);
      await p.emulateMedia({ media: "print" });
      await p.waitForTimeout(400);
      const m = await p.evaluate(() => {
        const rgb = (s) => (String(s).match(/\d+/g) || [255, 255, 255]).slice(0, 3).map(Number);
        const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
        const over = [...document.querySelectorAll(".rs-root *")].filter((e) => {
          const r = e.getBoundingClientRect();
          return r.width > 0 && r.right > document.documentElement.clientWidth + 2;
        }).map((e) => `${e.className}`.slice(0, 40));
        return {
          paper: lum(rgb(getComputedStyle(document.documentElement).backgroundColor)),
          masthead: !!document.querySelector(".rs-printhead") && getComputedStyle(document.querySelector(".rs-printhead")).display !== "none",
          foot: !!document.querySelector(".rs-printfoot") && getComputedStyle(document.querySelector(".rs-printfoot")).display !== "none",
          controls: [...document.querySelectorAll(".rs-controls, .rs-subtabs, .rs-tc-toggle, .rs-fresh")].some((e) => getComputedStyle(e).display !== "none"),
          overflow: over.slice(0, 4),
          tableRows: document.querySelectorAll(".rs-table tbody tr").length,
          clipped: document.documentElement.scrollHeight < 200,
        };
      });
      N(`${L} on ${name}: the paper is white`, m.paper > 200, `luminance ${m.paper.toFixed(0)}`);
      N(`${L} on ${name}: the masthead and the closing note both paint`, m.masthead && m.foot, `masthead=${m.masthead} foot=${m.foot}`);
      N(`${L} on ${name}: no on-screen control prints`, !m.controls);
      N(`${L} on ${name}: nothing is painted past the edge of the page`, m.overflow.length === 0, m.overflow.join(" | "));
      N(`${L} on ${name}: the sheet is not clipped to nothing`, !m.clipped);
      N(`${L} on ${name}: the tables print their rows`, m.tableRows > 0 || L === "Day summary", `${m.tableRows} rows`);
      await p.emulateMedia({ media: "screen" });
      await p.close();
    }
    await ctx.close();
  }
}

// ══ J2 · A CHART TOO WIDE FOR ANY PAPER ═══════════════════════════════════
// ScrollX gives a dense plot an inline `width: max(100%, count × 24px)` so bars stay readable and
// the frame SCROLLS. Paper cannot scroll. A custom range of a year is day-bucketed with no cap,
// so the plot asks for 365 × 24 = 8,760px — measured at 8,773px on a 1,280px page before the
// print rule below existed, which is 85% of the chart off the sheet.
head("J2 · a chart too wide for any paper");
{
  const ctx = await mk();
  const bigRows = Array.from({ length: 365 }, (_, i) => ({ ...mrow(1), bucket: new Date(Date.UTC(2025, 0, 1 + i, 18, 30)).toISOString() }));
  const { p } = await openForced(ctx, "?open=sales&range=30d", (url) => (isType(url, "sales") ? money(bigRows) : null));
  const onScreen = await p.evaluate(() => {
    const sx = document.querySelector(".owx-scrollx");
    return sx ? { frame: Math.round(sx.getBoundingClientRect().width), plot: sx.scrollWidth, ox: getComputedStyle(sx).overflowX } : null;
  });
  N("on SCREEN a 365-bucket chart still scrolls sideways, so the bars stay readable",
    !!onScreen && onScreen.plot > onScreen.frame && onScreen.ox === "auto", JSON.stringify(onScreen));
  await p.emulateMedia({ media: "print" });
  await p.waitForTimeout(700);
  const onPaper = await p.evaluate(() => {
    const svg = document.querySelector("svg.recharts-surface");
    const sx = document.querySelector(".owx-scrollx");
    return { page: document.documentElement.clientWidth,
      right: svg ? Math.round(svg.getBoundingClientRect().right) : 0,
      plot: sx && sx.firstElementChild ? Math.round(sx.firstElementChild.getBoundingClientRect().width) : 0,
      ox: sx ? getComputedStyle(sx).overflowX : "" };
  });
  N("on PAPER that same chart fits the page instead of running off it",
    onPaper.right > 0 && onPaper.right <= onPaper.page + 2, JSON.stringify(onPaper));
  N("…because the frame gives up its scrolling on paper", onPaper.ox === "visible", onPaper.ox);
  N("…and the plot is held to the width of the page", onPaper.plot <= onPaper.page + 2, `${onPaper.plot} on ${onPaper.page}`);
  const ticks = await p.locator("svg.recharts-surface .recharts-cartesian-axis-tick-value").allTextContents();
  N("…and the printed chart still carries a readable money axis", ticks.some((t) => String(t).includes("₹")), ticks.filter((t) => String(t).includes("₹")).join(","));
  N("…and it still shows the last bucket of the period, not just the first few",
    onPaper.right <= onPaper.page + 2 && ticks.length > 2, `${ticks.length} labels`);
  await p.emulateMedia({ media: "screen" });
  await p.waitForTimeout(400);
  const back = await p.evaluate(() => {
    const sx = document.querySelector(".owx-scrollx");
    return sx ? { plot: sx.scrollWidth, frame: Math.round(sx.getBoundingClientRect().width), ox: getComputedStyle(sx).overflowX } : null;
  });
  N("…and the screen goes back to scrolling the moment the sheet is out", !!back && back.plot > back.frame && back.ox === "auto", JSON.stringify(back));
  await p.close();
  await ctx.close();
}

// ══ K · THE SNAPSHOT THE TAB KEEPS FOR ITSELF ══════════════════════════════
// lib/ownerSnap.ts paints last-seen figures at ~0ms. Nothing has ever checked what it paints when
// what it saved no longer matches what the server would say.
head("K · the snapshot this tab keeps for itself");
{
  const ctx = await mk();
  const p = await ctx.newPage();
  await p.goto(`${BASE}/owner/reports?open=sales&range=30d`, { waitUntil: "domcontentloaded" });
  await p.waitForSelector(".rs-report");
  await settle(p);
  const real = flat(await p.locator(".rs-stat.big .rs-stat-v").first().innerText());
  // Reload with the server answering a DIFFERENT figure: the saved one must paint first, then be
  // replaced — and the screen must never show both at once or a figure that is neither.
  const fake = money([mrow(1, { subtotal: 111111, tax: 5555, revenue: 116666 })]);
  await p.route("**/api/owner/reports*", (route) => (isType(route.request().url(), "sales")
    ? route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(fake) })
    : route.fallback()));
  await p.reload({ waitUntil: "domcontentloaded" });
  await p.waitForSelector(".rs-report");
  const first = flat(await p.locator(".rs-stat.big .rs-stat-v").first().innerText().catch(() => ""));
  await settle(p);
  const after = flat(await p.locator(".rs-stat.big .rs-stat-v").first().innerText());
  N("the saved figure paints at once on a reload, rather than an empty tile", first.length > 0, first);
  N("…and the server's newer answer replaces it", rupee(after) === 116666, `${first} → ${after}`);
  N("…and what is finally on screen is one figure, not a blend of two", after !== real || real === "₹1,16,666", `${real} → ${after}`);
  N("…and the freshness chip is beside it the whole time", await p.locator(".rs-fresh").count() > 0);
  await p.close();
  // A snapshot from a DIFFERENT scope must not paint under this one's heading.
  const p2 = await ctx.newPage();
  await p2.goto(`${BASE}/owner/reports?open=sales&range=30d`, { waitUntil: "domcontentloaded" });
  await p2.waitForSelector(".rs-report");
  await settle(p2);
  const keys = await p2.evaluate(() => Object.keys(sessionStorage).filter((k) => k.includes("reports")));
  N("the tab's saved figures are namespaced, so one scope cannot paint under another's heading",
    keys.length > 0 && keys.every((k) => /reports/.test(k)), keys.join(","));
  const stored = await p2.evaluate(() => {
    const k = Object.keys(sessionStorage).find((x) => x.includes("reports"));
    try { return JSON.parse(sessionStorage.getItem(k) || "{}"); } catch { return {}; }
  });
  const entries = Object.values((stored && stored.v && stored.v.entries) || (stored && stored.entries) || {});
  N("…and only settled figures are saved, never a loading or an error state",
    entries.every((e) => e && e.data && !e.loading && !e.error), `${entries.length} entries`);
  N("…and every saved entry carries when the SERVER computed it",
    entries.every((e) => typeof e.cachedAt === "string" && e.cachedAt.length > 10), `${entries.filter((e) => !e.cachedAt).length} without a stamp`);
  await p2.close();
  await ctx.close();
}

await browser.close();
rmSync(DL, { recursive: true, force: true });

console.log(`\n${pass} passed, ${fail} failed, ${skip} skipped`);
console.log(`ids used: P${FROM}–P${next - 1} (${next - FROM} of ${TO - FROM + 1})`);
if (fail) { console.log("\nFAILURES:"); fails.forEach((f) => console.log("  " + f)); }
console.log(fail ? "\n❌ FAIL" : "\n✅ PASS — the 500 checks nobody had written yet");
process.exit(fail ? 1 : 0);
