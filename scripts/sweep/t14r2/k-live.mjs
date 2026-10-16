// scripts/sweep/t14r2/k-live.mjs — round 2 · bank K — DRIVEN ON THE RUNNING APP (P214561–P214600).
//   node --experimental-strip-types --no-warnings scripts/sweep/t14r2/k-live.mjs --base http://localhost:<port> --shots <dir>
// One login per role (scripts/sweep/login.mjs caches it). Nothing is written: the customer sheet is opened
// with a stand-in for the network, and every bill is rendered in the page, never issued.
import { sec, runAll, onDone, read, root, ARGV } from "../t14s10/lib.mjs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { loginAs, adminHeaders } from "../login.mjs";

const arg = (k, d) => { const i = ARGV.indexOf(k); return i >= 0 && ARGV[i + 1] ? ARGV[i + 1] : d; };
const BASE = arg("--base", "http://localhost:4414");
if (/:4000\b/.test(BASE)) throw new Error("never port 4000 — the owner's own window");
const SHOTS = arg("--shots", null); if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const { chromium } = await import(join(root, "node_modules/playwright/index.mjs"));
let browser = null; const ctxs = new Map();
async function panel(role, vp = { width: 1280, height: 800 }, theme = null) {
  if (!browser) { browser = await chromium.launch(); onDone(() => browser.close()); }
  const key = `${role}|${vp.width}x${vp.height}|${theme}`; if (ctxs.has(key)) return ctxs.get(key);
  const touch = vp.width < 1100;
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: touch ? 3 : 1, hasTouch: touch, isMobile: touch && vp.width < 800 });
  const route = await loginAs(ctx, role, BASE); const page = await ctx.newPage();
  await page.goto(BASE + route, { waitUntil: "domcontentloaded", timeout: 90000 });
  let frame = null;
  for (let i = 0; i < 60 && !frame; i++) { for (const f of page.frames()) { try { if (await f.evaluate(() => typeof LFH_BILLDOC !== "undefined" && typeof state !== "undefined" && (Array.isArray(state.orders) || !!(state.data && state.data.restaurant && state.data.restaurant.id)))) { frame = f; break; } } catch { /* next */ } } if (!frame) await page.waitForTimeout(500); }
  if (frame && theme) await frame.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
  const v = { page, frame }; ctxs.set(key, v); return v;
}
const k = sec(214560);
const BD = "public/panels/billdoc.js", BC = "public/panels/billcustomer.css";
let n = 1;
for (const p of ["editor", "tablet", "kitchen"]) {
  const id = n++;
  k(id, BD, `the ${p} shell is served today's billdoc.js — the stamp is the file's hash and the bytes are the file`, "GET the shell, then the stamped file", async () => {
    const html = await (await fetch(`${BASE}/panels/${p}/index.html`)).text(); const v = (html.match(/billdoc\.js\?v=([a-z0-9]+)/) || [])[1];
    const body = await (await fetch(`${BASE}/panels/billdoc.js?v=${v}`)).text();
    return (v === createHash("sha1").update(read(BD)).digest("hex").slice(0, 8) && body === read(BD) && /function gstRegistered/.test(body) && /function namedLinesFor/.test(body) && /function moduleOn/.test(body)) || `stamp ${v}`;
  });
}
// n = 4
async function sheetIn(frame, opts = "{ api, required: true, print: true, loyalty: !!(LFH_BILLDOC.moduleOn && LFH_BILLDOC.moduleOn(state.data.settings, 'loyalty')) }") {
  return frame.evaluate(`(async () => {
    document.querySelector(".bcust-overlay")?.remove();
    const api = async () => ({ matches: [1,2,3,4].map((i) => ({ phone: "982501111" + i, name: "Guest " + i, visits: 1 })), whole: true });
    LFH_BILLCUST.ask(${opts});
    await new Promise((r) => setTimeout(r, 150));
    const ph = document.querySelector(".bc-phone"); ph.value = "982501"; ph.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 500));
    const m = document.querySelector(".bcust-modal"); m.scrollTop = 1e5; await new Promise((r) => setTimeout(r, 80));
    const mr = m.getBoundingClientRect(), g = document.querySelector(".bc-go").getBoundingClientRect(), c = document.querySelector(".bc-cancel").getBoundingClientRect();
    const rgb = (s) => { const v = (s.match(/[\\d.]+/g) || []).slice(0, 3).map(Number); return /^color\\(srgb/.test(s) ? v.map((x) => x * 255) : v; };
    const lum = ([r, g2, b]) => { const f = (x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g2) + 0.0722 * f(b); };
    const bg = (el) => { while (el) { const cc = getComputedStyle(el).backgroundColor; if (cc && !/rgba\\(0, 0, 0, 0\\)|transparent/.test(cc)) return rgb(cc); el = el.parentElement; } return [255, 255, 255]; };
    const t = document.querySelector(".bcust-htxt h3"); const [L1, L2] = [lum(rgb(getComputedStyle(t).color)), lum(bg(document.querySelector(".bcust-head")))].sort((a, b) => b - a);
    const out = { reach: g.bottom <= mr.bottom + 1 && c.bottom <= mr.bottom + 1, inside: mr.left >= -0.5 && mr.right <= innerWidth + 0.5, contrast: (L1 + 0.05) / (L2 + 0.05), text: m.innerText, rewards: /reward/i.test(m.innerText) };
    return out;
  })()`);
}
for (const role of ["manager", "tablet"]) for (const [label, w, h] of [["desktop 1280×800", 1280, 800], ["Samsung A35 360×780", 360, 780], ["A35 sideways 780×360", 780, 360], ["iPad 1194×834", 1194, 834]]) for (const theme of ["light", "dark"]) {
  const id = n++;
  k(id, BC, `${role === "manager" ? "manager panel" : "waiter tablet"} · ${label} · ${theme} skin: the customer sheet fits, both buttons can be reached, and its title is readable`, "the real sheet with four suggestions, scrolled to the end", async () => {
    const { frame, page } = await panel(role, { width: w, height: h }, theme); if (!frame) return "the panel never loaded";
    const r = await sheetIn(frame);
    if (SHOTS && (w === 360 || w === 780)) await page.screenshot({ path: `${SHOTS}/sheet-${role}-${w}-${theme}.png` });
    await frame.evaluate(() => document.querySelector(".bcust-overlay")?.remove());
    return (r.reach && r.inside && r.contrast >= 4.5 && !/undefined|NaN|\[object/.test(r.text)) || JSON.stringify({ ...r, text: undefined });
  });
}
// n = 20
for (const role of ["manager", "tablet"]) { const id = n++; k(id, BC, `${role === "manager" ? "manager panel" : "waiter tablet"} at French House (Loyalty OFF): the sheet says nothing about rewards (item 6)`, "the sheet opened the way the panel opens it", async () => { const { frame } = await panel(role); const on = await frame.evaluate(() => LFH_BILLDOC.moduleOn(state.data.settings, "loyalty")); const r = await sheetIn(frame); await frame.evaluate(() => document.querySelector(".bcust-overlay")?.remove()); return (on === false && r.rewards === false) || `loyalty ${on}, rewards mentioned ${r.rewards}`; }); }
// n = 22
k(22, BD, "the manager panel's own bill for a real French House table prints the same TOTAL as the panel's own money function", "billData on the panel's own orders for one session", async () => {
  const { frame } = await panel("manager");
  const r = await frame.evaluate(() => { const pool = [].concat(state.data.orders || [], (state.board && (state.board.orders || [])) || []); const os = pool.filter((o) => o && o.session_id && o.status !== "cancelled" && !o.deleted_at); if (!os.length) return { skip: true }; const sid = os[0].session_id; const mine = pool.filter((o) => o && o.session_id === sid); const h = LFH_BILLDOC.billDocHtml(LFH_BILLDOC.billData({ settings: state.data.settings, restaurant: state.data.restaurant, orders: mine })); const shown = Number(((h.match(/TOTAL<\/span><span>₹([\d,]+)</) || [])[1] || "NaN").replace(/,/g, "")); return { shown, money: Math.round(LFH_BILLDOC.billMoney(mine, state.data.settings).total), clean: !/undefined|NaN|\[object/.test(h) }; });
  if (r.skip) return { skip: "no table bill in the panel's data right now" };
  return (r.shown === r.money && r.clean) || JSON.stringify(r);
});
k(23, BD, "the waiter tablet's bill helper reaches the same rate the manager panel does (one restaurant, one rate)", "taxModel in both frames", async () => { const a = await (await panel("manager")).frame.evaluate(() => LFH_BILLDOC.taxModel(state.data.settings).rate); const b = await (await panel("tablet")).frame.evaluate(() => (typeof effRate === "function" ? effRate() : LFH_BILLDOC.taxModel(state.data.settings).rate)); return a === b || `manager ${a}, tablet ${b}`; });
k(24, BD, "the kitchen board's ticket for a real order on its board prints that order's KOT number", "kotDocHtml in the kitchen frame on its first board order", async () => { const { frame } = await panel("kitchen"); const r = await frame.evaluate(() => { const list = state.orders || []; const o = Array.isArray(list) ? list.find((x) => x && x.kot_no) : null; if (!o) return { skip: true }; const h = LFH_BILLDOC.kotDocHtml({ kot: o.kot_no, lines: o.items || [], tableLabel: "T" + o.table_number }); return { ok: h.includes("KOT #" + o.kot_no + "<") && !/undefined|NaN/.test(h) }; }); if (r.skip) return { skip: "no order on the kitchen board right now" }; return r.ok || "ticket wrong"; });
const prev = async (q) => { const r = await fetch(`${BASE}/api/admin/restaurants/bill-preview?${q}`, { headers: adminHeaders(BASE) }); return { s: r.status, t: await r.text() }; };
k(25, "lib/billPreview.ts", "the admin's preview for French House: bill, ticket and parcel all draw, with no stray value and no word of loyalty (it is off there)", "GET bill-preview ×3", async () => { for (const m of ["bill", "kot", "parcel"]) { const r = await prev(`rid=00000000-0000-0000-0000-000000000001&mode=${m}`); if (r.s !== 200 || /undefined|NaN|\[object/.test(r.t) || /points|loyalty/i.test(r.t.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/g, ""))) return `${m}: ${r.s}`; } return true; });
k(26, "lib/billPreview.ts", "the admin's preview for Aevidine (Loyalty ON) shows the points lines", "GET bill-preview", async () => { const r = await prev("rid=00000000-0000-0000-0000-0000000000a1&mode=bill"); return (r.s === 200 && /Points on this bill: \d+/.test(r.t)) || `status ${r.s}, points ${/Points on this bill/.test(r.t)}`; });
k(27, "lib/billPreview.ts", "the admin's preview for the GSTIN-less café shows a Bill with no tax rows (item 12)", "GET bill-preview", async () => { const r = await prev("rid=4bebeb35-5c4f-46bd-8b30-ef1d3cadd22e&mode=bill"); return (r.s === 200 && /class="kind">Bill</.test(r.t) && !/CGST|SGST|Taxable value/.test(r.t)) || `status ${r.s}`; });
k(28, "lib/billPreview.ts", "the preview refuses a missing or garbled restaurant — never the flagship's bill", "GET with no rid / a bad rid", async () => { const a = await prev("mode=bill"), b = await prev("rid=zzz&mode=bill"); return (a.s >= 400 && b.s >= 400 && !/LITTLE FRENCH/i.test(a.t + b.t)) || `${a.s}/${b.s}`; });
k(29, "lib/billPreview.ts", "on a phone the preview's explanation sits on its own row (item 10)", "the live preview at 360px", async () => { if (!browser) { browser = await chromium.launch(); onDone(() => browser.close()); } const p = await browser.newPage({ viewport: { width: 360, height: 780 } }); await p.setContent((await prev("rid=00000000-0000-0000-0000-000000000001&mode=bill")).t, { waitUntil: "load" }); await p.waitForTimeout(400); const r = await p.evaluate(() => { const n = document.querySelector(".bar .note"); return { w: n.getBoundingClientRect().width, h: n.getBoundingClientRect().height }; }); if (SHOTS) await p.screenshot({ path: `${SHOTS}/preview-360.png` }); await p.close(); return (r.w > 300 && r.h < 100) || JSON.stringify(r); });
k(30, BD, "the manager panel's printing board says '1 minute', never '1 minutes' (item 9, the served code)", "fmtWaited in the manager frame", async () => { const { frame } = await panel("manager"); const r = await frame.evaluate(() => typeof fmtWaited === "function" ? [fmtWaited(60000), fmtWaited(3570000), fmtWaited(84600000)] : null); return (r && r.join("|") === "1 minute|1 hour|a whole day") || JSON.stringify(r); });

await runAll("T14 round 2 · driven on " + BASE);
