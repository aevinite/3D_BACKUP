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
