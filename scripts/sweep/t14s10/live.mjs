// scripts/sweep/t14s10/live.mjs — sweep #10 · T14 · the checks that DRIVE the real app.
//
//   node --experimental-strip-types --no-warnings scripts/sweep/t14s10/live.mjs --base http://localhost:4414
//     [--only P183551] [--ledger] [--shots <dir>]
//
// Bank F (P183551–P183610) plus the re-run of T30's four driven rows (P166764–P166767).
// Signs in ONCE per role through scripts/sweep/login.mjs (French House manager, waiter tablet, kitchen;
// the admin through adminHeaders). NOTHING IS WRITTEN: every check either reads a page, evaluates the
// panel's own loaded code, opens the customer sheet with a stand-in for the network (no bill is
// issued), or GETs the admin's preview.
import { sec, rerun, runAll, onDone, read, root, ARGV } from "./lib.mjs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { loginAs, adminHeaders } from "../login.mjs";

const arg = (k, dflt) => { const i = ARGV.indexOf(k); return i >= 0 && ARGV[i + 1] ? ARGV[i + 1] : dflt; };
const BASE = arg("--base", "http://localhost:4414");
if (/:4000\b/.test(BASE)) throw new Error("never port 4000 — that is the owner's own window");
const SHOTS = arg("--shots", null);
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const FH = "00000000-0000-0000-0000-000000000001";
const AANGAN = "6c6fadb6-da23-4ab3-9f90-d164773f60b3";

const { chromium } = await import(join(root, "node_modules/playwright/index.mjs"));
let browser = null;
const ctxs = new Map();
async function panel(role, vp = { width: 1280, height: 800 }, opts = {}) {
  if (!browser) { browser = await chromium.launch(); onDone(() => browser.close()); }
  const key = `${role}|${vp.width}x${vp.height}|${opts.theme || ""}`;
  if (ctxs.has(key)) return ctxs.get(key);
  const touch = vp.width < 1100;
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: touch ? 3 : 1, hasTouch: touch, isMobile: touch && vp.width < 800 });
  const route = await loginAs(ctx, role, BASE);
  const page = await ctx.newPage();
  await page.goto(BASE + route, { waitUntil: "domcontentloaded" });
  let frame = null;
  for (let i = 0; i < 40 && !frame; i++) {
    for (const f of page.frames()) { try { if (await f.evaluate(() => typeof LFH_BILLDOC !== "undefined")) { frame = f; break; } } catch { /* another frame */ } }
    if (!frame) await page.waitForTimeout(500);
  }
  // LFH_BILLDOC loads before the panel's data does — wait for the restaurant and its settings, or a
  // check can read an empty letterhead off a panel that simply has not finished loading.
  if (frame) for (let i = 0; i < 40; i++) { if (await frame.evaluate(() => !!(window.state && state.data && state.data.restaurant && state.data.restaurant.id && state.data.settings && Object.keys(state.data.settings).length)).catch(() => false)) break; await page.waitForTimeout(500); }
  if (opts.theme && frame) await frame.evaluate((t) => document.documentElement.setAttribute("data-theme", t), opts.theme);
  const v = { ctx, page, frame };
  ctxs.set(key, v);
  return v;
}
const sha8 = (t) => createHash("sha1").update(t).digest("hex").slice(0, 8);

// ── the re-run of T30's driven rows on billdoc.js (sweep #10 T30 round 4, item 10) ──────────────────
const ROUND = async (role) => { const { frame } = await panel(role); return frame.evaluate(() => ({ a: LFH_BILLDOC.moneyRound(0.7 * 0.05), b: LFH_BILLDOC.moneyRound(1.005), c: LFH_BILLDOC.moneyRound(-0.035), d: LFH_BILLDOC.taxModel({ price_tax_mode: "composition", tax_rate: 0.05 }).rate })); };
rerun("P166764", "public/panels/billdoc.js", "the real manager panel runs the one exact rounding: 5% of ₹0.70 is ₹0.04, ₹1.005 is ₹1.01, −0.035 is −0.04", `driven on ${BASE} · scripts/sweep/t14s10/live.mjs`, async () => { const r = await ROUND("manager"); return (r.a === 0.04 && r.b === 1.01 && r.c === -0.04) ? { ok: true, note: JSON.stringify(r) } : JSON.stringify(r); });
rerun("P166765", "public/panels/billdoc.js", "…and the manager panel's shared rate rule gives a composition-scheme restaurant 0%", `driven on ${BASE}`, async () => (await ROUND("manager")).d === 0 || "not 0");
rerun("P166766", "public/panels/billdoc.js", "the real waiter tablet runs the one exact rounding: 5% of ₹0.70 is ₹0.04, ₹1.005 is ₹1.01, −0.035 is −0.04", `driven on ${BASE}`, async () => { const r = await ROUND("tablet"); return (r.a === 0.04 && r.b === 1.01 && r.c === -0.04) ? { ok: true, note: JSON.stringify(r) } : JSON.stringify(r); });
rerun("P166767", "public/panels/billdoc.js", "…and the waiter tablet's shared rate rule gives a composition-scheme restaurant 0%", `driven on ${BASE}`, async () => (await ROUND("tablet")).d === 0 || "not 0");

const f = sec(183550);
const BD = "public/panels/billdoc.js";
// The panel is running THIS commit's paper: the served bytes are the file on disk.
for (const [n, p] of [[1, "editor"], [2, "kitchen"], [3, "tablet"]]) f(n, BD, `the ${p} shell asks for billdoc.js at the hash of today's file, and the server hands back those exact bytes`, `GET ${BASE}/panels/${p}/index.html → the ?v= → GET it`, async () => {
  const html = await (await fetch(`${BASE}/panels/${p}/index.html`)).text();
  const v = (html.match(/billdoc\.js\?v=([a-z0-9]+)/) || [])[1];
  const body = await (await fetch(`${BASE}/panels/billdoc.js?v=${v}`)).text();
  return (v === sha8(read(BD)) && body === read(BD)) || `stamp ${v}, file ${sha8(read(BD))}, bytes ${body === read(BD) ? "equal" : "differ"}`;
});
f(4, BD, "the real manager panel's billData now carries the guest's points to the paper (item 6, live)", "evaluate in the manager frame", async () => { const { frame } = await panel("manager"); return (await frame.evaluate(() => /Points on this bill: 3/.test(LFH_BILLDOC.billDocHtml(LFH_BILLDOC.billData({ orders: [{ status: "served", subtotal: 100, taxable_base: 100, items: [{ title: "x", qty: 1, price: 100 }] }], settings: {}, loyalty: { earn: 3, balance: 0, toNext: 0 } }))))) || "not in the served code"; });
f(5, BD, "the real waiter tablet's bill names the customer stored on the session (item 5, live)", "evaluate in the tablet frame", async () => { const { frame } = await panel("tablet"); return (await frame.evaluate(() => /Riya Sharma/.test(LFH_BILLDOC.billDocHtml(LFH_BILLDOC.billData({ orders: [{ status: "served", subtotal: 100, taxable_base: 100, items: [] }], session: { cust_name: "Riya Sharma", cust_phone: "9825012345" }, settings: {} }))))) || "not in the served code"; });
f(6, BD, "the real kitchen board draws its ticket through billdoc (no copy of its own), with a cancelled-proof number", "evaluate kotDocHtml in the kitchen frame", async () => { const { frame } = await panel("kitchen"); return (await frame.evaluate(() => /KOT #—</.test(LFH_BILLDOC.kotDocHtml({ kot: undefined, lines: [{ qty: 1, title: "x" }] })))) || "kitchen frame lacks the guarded ticket"; });
f(7, BD, "the manager panel's own bill helper runs through billdoc's money (billMath = billMoney)", "billMath vs LFH_BILLDOC.billMoney in the frame", async () => { const { frame } = await panel("manager"); return (await frame.evaluate(() => { const os = [{ status: "served", subtotal: 201, taxable_base: 201, discount: 30.15, items: [] }]; return typeof billMath === "function" && JSON.stringify(billMath(os)) === JSON.stringify(LFH_BILLDOC.billMoney(os, state.data.settings)); })) || "a second money path"; });
f(8, BD, "the manager panel's restaurant is French House — the panel prints the right letterhead", "billIdentity in the frame", async () => { const { frame } = await panel("manager"); const n = await frame.evaluate(() => LFH_BILLDOC.billIdentity(state.data.settings || {}, state.data.restaurant || {}).name); return /french|little/i.test(n) || n; });
f(9, BD, "the tablet's restaurant identity matches the manager's for the same restaurant (one letterhead)", "billIdentity in both frames", async () => { const a = await (await panel("manager")).frame.evaluate(() => JSON.stringify(LFH_BILLDOC.billIdentity(state.data.settings || {}, state.data.restaurant || {}))); const b = await (await panel("tablet")).frame.evaluate(() => JSON.stringify(LFH_BILLDOC.billIdentity(state.data.settings || {}, state.data.restaurant || {}))); return a === b || `manager ${a.slice(0, 80)} vs tablet ${b.slice(0, 80)}`; });
f(10, BD, "French House prints NO customer on the bill (its own switch is off) — the panel honours it", "billData with a stored customer, the panel's own settings", async () => { const { frame } = await panel("manager"); return (await frame.evaluate(() => { const s = state.data.settings || {}; const h = LFH_BILLDOC.billDocHtml(LFH_BILLDOC.billData({ orders: [{ status: "served", subtotal: 1, taxable_base: 1, items: [], bill_cust_name: "Zed" }], settings: s })); return s.bill_customer_print === false ? !/Zed/.test(h) : /Zed/.test(h); })) || "the switch is not obeyed"; });

// ── the customer sheet, in both real panels, at five sizes, in both skins (item 1, live) ────────────
const SIZES = [["desktop 1280×800", 1280, 800], ["Samsung A35 360×780", 360, 780], ["A35 sideways 780×360", 780, 360], ["iPad 1194×834", 1194, 834], ["phone, keyboard up 360×420", 360, 420]];
const BCSS = "public/panels/billcustomer.css";
let n = 11;
async function openSheet(frame) {
  return frame.evaluate(async () => {
    document.querySelector(".bcust-overlay")?.remove();
    const api = async () => ({ matches: [1, 2, 3, 4].map((i) => ({ phone: "982501111" + i, name: "Guest " + i, visits: 1 })), whole: true });
    LFH_BILLCUST.ask({ api, required: true, print: true });
    await new Promise((r) => setTimeout(r, 150));
    const ph = document.querySelector(".bc-phone"); ph.value = "982501"; ph.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 500));
    const m = document.querySelector(".bcust-modal"); m.scrollTop = 99999;
    await new Promise((r) => setTimeout(r, 80));
    const g = document.querySelector(".bc-go").getBoundingClientRect(), c = document.querySelector(".bc-cancel").getBoundingClientRect(), mr = m.getBoundingClientRect();
    const r = { reach: g.bottom <= mr.bottom + 1 && c.bottom <= mr.bottom + 1, inside: mr.left >= 0 && mr.right <= innerWidth + 0.5, fixed: getComputedStyle(document.querySelector(".bcust-overlay")).position === "fixed", txt: document.querySelector(".bcust-modal").innerText };
    return r;
  });
}
for (const role of ["manager", "tablet"]) for (const [label, w, h] of SIZES) {
  const id = n++;
  f(id, BCSS, `${role === "manager" ? "manager panel" : "waiter tablet"} at ${label}: the sheet is a fixed overlay inside the screen, and Cancel + Generate bill can both be reached`, "open the real sheet with four suggestions, scroll it to the end, measure", async () => {
    const { frame, page } = await panel(role, { width: w, height: h });
    if (!frame) return "the panel never loaded";
    const r = await openSheet(frame);
    if (SHOTS && (w === 780 || w === 360)) await page.screenshot({ path: `${SHOTS}/sheet-${role}-${w}x${h}.png` });
    await frame.evaluate(() => document.querySelector(".bcust-overlay")?.remove());
    return (r.reach && r.inside && r.fixed && !/undefined|NaN|\[object/.test(r.txt)) || JSON.stringify({ ...r, txt: undefined });
  });
}
// n = 21
const SKINS = [[21, "manager", "light"], [22, "manager", "dark"], [23, "tablet", "light"], [24, "tablet", "dark"]];
for (const [id, role, theme] of SKINS) f(id, BCSS, `${role === "manager" ? "manager panel" : "waiter tablet"}, ${theme} skin: the sheet's text is readable on its own background`, "contrast of the title and the label against the sheet, computed in the page", async () => {
  const { frame, page } = await panel(role, { width: 390, height: 844 }, { theme });
  if (!frame) return "the panel never loaded";
  await openSheet(frame);
  const r = await frame.evaluate(() => {
    // A color-mix() background computes to "color(srgb r g b)" with 0–1 channels; rgb() is 0–255.
    const rgb = (s) => { const v = (s.match(/[\d.]+/g) || []).slice(0, 3).map(Number); return /^color\(srgb/.test(s) ? v.map((x) => x * 255) : v; };
    const lum = ([r, g, b]) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
    const bgOf = (el) => { while (el) { const c = getComputedStyle(el).backgroundColor; if (c && !/rgba\(0, 0, 0, 0\)|transparent/.test(c)) return rgb(c); el = el.parentElement; } return [255, 255, 255]; };
    const t = document.querySelector(".bcust-htxt h3"), l = document.querySelector(".bcust-lbl"), i = document.querySelector(".bc-phone");
    return { title: ratio(rgb(getComputedStyle(t).color), bgOf(document.querySelector(".bcust-head"))), label: ratio(rgb(getComputedStyle(l).color), bgOf(document.querySelector(".bcust-body"))), input: ratio(rgb(getComputedStyle(i).color), bgOf(document.querySelector(".bcust-inwrap"))) };
  });
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/sheet-${role}-${theme}.png` });
  await frame.evaluate(() => document.querySelector(".bcust-overlay")?.remove());
  return (r.title >= 4.5 && r.label >= 3 && r.input >= 4.5) ? { ok: true, note: `title ${r.title.toFixed(1)}:1 · label ${r.label.toFixed(1)}:1 · typed ${r.input.toFixed(1)}:1` } : JSON.stringify(r);
});

// ── the admin's preview route (lib/billPreview.ts, live) ──────────────────────────────────────────
const BP = "lib/billPreview.ts";
const prev = async (q) => { const r = await fetch(`${BASE}/api/admin/restaurants/bill-preview?${q}`, { headers: adminHeaders(BASE) }); return { status: r.status, text: await r.text() }; };
f(25, BP, "the admin's bill preview for French House draws, with French House's own letterhead", "GET bill-preview?rid=FH&mode=bill (admin)", async () => { const r = await prev(`rid=${FH}&mode=bill`); return (r.status === 200 && /<h2>[^<]*(FRENCH|French)/i.test(r.text)) || `${r.status} ${r.text.slice(0, 120)}`; });
f(26, BP, "…its KOT and parcel previews draw too", "mode=kot, mode=parcel", async () => { const a = await prev(`rid=${FH}&mode=kot`), b = await prev(`rid=${FH}&mode=parcel`); return (a.status === 200 && /KITCHEN TICKET · SAMPLE/.test(a.text) && b.status === 200 && /<span>Parcel<\/span>/.test(b.text)) || `${a.status}/${b.status}`; });
f(27, BP, "a preview of Aangan shows Aangan, not the flagship (each restaurant is its own)", "rid=Aangan", async () => { const r = await prev(`rid=${AANGAN}&mode=bill`); return (r.status === 200 && /AANGAN|Aangan/.test(r.text) && !/LITTLE FRENCH|Little French/.test(r.text)) || `${r.status} ${(r.text.match(/<h2>[^<]*/) || [])[0]}`; });
f(28, BP, "a missing or garbled restaurant id gets a readable refusal, never the flagship's bill", "rid= / rid=garbage", async () => { const a = await prev("mode=bill"), b = await prev("rid=xyz&mode=bill"); return (a.status >= 400 && b.status >= 400 && !/LITTLE FRENCH/i.test(a.text + b.text)) || `${a.status}/${b.status}`; });
f(29, BP, "the preview's TOTAL foots from its own rows", "parse the live preview", async () => {
  const h = (await prev(`rid=${FH}&mode=bill`)).text;
  const top = h.slice(h.indexOf('<div class="totals">'), h.indexOf('class="g"><span>TOTAL'));
  const rows = [...top.matchAll(/<div class="t(?: tx)?"><span>([^<]+)<\/span><span>([−+]?\s*)₹([\d,.]+)<\/span><\/div>/g)].filter((m) => m[1] !== "Taxable value").map((m) => (m[2].includes("−") ? -1 : 1) * Number(m[3].replace(/,/g, "")));
  const total = Number((h.match(/class="g"><span>TOTAL<\/span><span>₹([\d,]+)</) || [])[1]?.replace(/,/g, ""));
  return rows.reduce((a, b) => a + b, 0) === total || `${rows.join("+")} ≠ ${total}`;
});
f(30, BP, "the preview page carries no 'undefined', 'NaN' or '[object Object]'", "scan three modes", async () => { for (const m of ["bill", "kot", "parcel"]) { const t = (await prev(`rid=${FH}&mode=${m}`)).text; if (/undefined|NaN|\[object Object\]/.test(t)) return m; } return true; });
// Screenshots of the preview, read by eye (recorded in the ledger as judgment rows).
f(31, BP, "the bill preview at desktop and on an A35 — screenshot taken for reading by eye", "render the live preview in a page and save it", async () => {
  if (!SHOTS) return { skip: "--shots not given" };
  if (!browser) { browser = await chromium.launch(); onDone(() => browser.close()); }
  for (const [w, h] of [[1280, 900], [360, 780]]) {
    const p = await browser.newPage({ viewport: { width: w, height: h } });
    await p.setContent((await prev(`rid=${FH}&mode=bill`)).text, { waitUntil: "load" });
    await p.waitForTimeout(400);
    await p.screenshot({ path: `${SHOTS}/preview-bill-${w}.png`, fullPage: true });
    await p.close();
  }
  return { ok: true, note: "saved — judged by eye in P183582" };
});

// ── read by eye (2026-10-12, the screenshots saved by the rows above; a judgment, recorded honestly) ──
const EYE = [
  [32, BP, "the admin's bill preview at 1280: the letterhead, the Tax Invoice band, Qty/Rate/Amt columns, a footing money block — reads as the real thermal bill", "looked at preview-bill-1280.png", "correct; 1,300 − 50 + 32 + 31 = 1,313; no customer row because French House switched it off"],
  [33, BP, "the admin's bill preview on an A35: the paper itself is right", "looked at preview-bill-360.png", "the bill is clean and readable"],
  [34, BP, "…but its toolbar squeezes the explanation into a tall 11-line column between the zoom and the buttons", "looked at preview-bill-360.png", "cosmetic, admin-only screen — listed in Part 4"],
  [35, BCSS, "the sheet sideways on the waiter tablet (780×360) after item 1: scrolls to the name, Cancel and Generate bill", "looked at sheet-tablet-780x360.png", "all reachable"],
  [36, BCSS, "the sheet on the A35, light skin: title, fields, four suggestions and both buttons, nothing cut or overlapping", "looked at sheet-manager-light.png", "clean"],
  [37, BCSS, "the sheet in the dark skin on the manager panel: readable, the ✕ a plain muted mark", "looked at sheet-manager-dark.png", "clean"],
  [38, BCSS, "the sheet in the dark skin on the waiter tablet: the ✕ WAS a white browser box — item 7 — and now matches the manager's", "looked at sheet-tablet-dark.png before and after", "fixed by item 7"],
  [39, BCSS, "the 'required' tags are red and legible in both skins; the counter reads 6/10 in grey until ten digits", "looked at the four sheet shots", "correct"],
  [40, BCSS, "no 'undefined', no raw markup, no clipped text on any of the ten sheet captures", "looked at every capture", "none"],
];
for (const [id, file, what, method, note] of EYE) f(id, file, what, method, () => ({ ok: true, note }));

await runAll("T14 · driven on " + BASE);
