// Round 2 · Block L — THE SAME BILL ON THREE SCREENS AND TWO SKINS. For each of phone (A35 360×780),
// iPad (1194×834) and laptop (1280×800), dark and light: the bill fits, prints nothing broken, its rows
// add up, Place Order can be reached, the saved-orders list fits and agrees with the bill, and the bell
// is the thing under a finger. Saved work is made with the phone offline and deleted before closing,
// so nothing reaches the restaurant. Captures go to .claude/sweep/shots/S10-T3/ to be looked at.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { check, ROOT } from "./lib.mjs";

const BASE = process.env.T3_BASE || "http://localhost:4403";
const OUT = join(ROOT, ".claude/sweep/shots/S10-T3");
const DEVS = [
  ["phone", { viewport: { width: 360, height: 780 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }],
  ["iPad", { viewport: { width: 1194, height: 834 }, hasTouch: true }],
  ["laptop", { viewport: { width: 1280, height: 800 } }],
];
const HOW = `LIVE — built app on ${BASE}, French House, offline for the saved part (nothing sent)`;
const up = await fetch(BASE + "/r/french-house/menu").then((r) => r.status).catch(() => 0);
const money = (s) => Number(String(s || "").replace(/[^0-9.]/g, "")) || 0;
const R = {};
async function look(dev, opts, skin) {
  mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch();
  try {
    const ctx = await b.newContext(opts); const p = await ctx.newPage();
    await p.addInitScript((s) => { try { localStorage.setItem("lfh_theme", s); } catch {} }, skin);
    await p.goto(BASE + "/r/french-house/menu", { waitUntil: "domcontentloaded" });
    await p.locator('button[aria-label^="Add"], .fc-plus').first().waitFor({ timeout: 20000 }); await p.waitForTimeout(1500);
    const bell = await p.evaluate(() => { const el = document.querySelector(".chef-call"); if (!el) return null; const r = el.getBoundingClientRect(); const h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return { onTop: !!h && (h === el || el.contains(h)), inView: r.right <= innerWidth && r.bottom <= innerHeight && r.left >= 0 && r.top >= 0 }; });
    for (let i = 0; i < 2; i++) { await p.locator('button[aria-label^="Add"], .fc-plus').nth(i).click(); await p.waitForTimeout(700); }
    await p.evaluate(() => window.dispatchEvent(new Event("lfh:open-cart"))); await p.waitForTimeout(1300);
    const text = await p.locator("#cart-panel").innerText();
    const rows = await p.locator(".bill-line").allInnerTexts();
    const val = (re) => money((rows.find((r) => re.test(r)) || "").split(/\s/).pop());
    const sub = val(/^Subtotal/), gst = val(/^GST/), total = val(/^Total/);
    const overflow = await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
    const box = await p.locator("#cart-panel").boundingBox();
    await p.screenshot({ path: `${OUT}/${dev}-${skin}-bill.png` });
    await p.evaluate(() => { const el = document.getElementById("cart-panel"); if (el) el.scrollTop = el.scrollHeight; }); await p.waitForTimeout(400);
    const btn = await p.locator(".cart-foot .btn-gold").boundingBox();
    const vh = opts.viewport.height, vw = opts.viewport.width;
    await p.locator("#cart-table").fill("28");
    await ctx.setOffline(true);
    await p.locator(".cart-foot .btn-gold").click(); await p.waitForTimeout(1500);
    await p.evaluate(() => window.dispatchEvent(new Event("lfh:close-all"))); await p.waitForTimeout(700);
    await p.locator(".gob-chip").click(); await p.waitForTimeout(800);
    const sheet = await p.locator(".gob-sheet").innerText().catch(() => "");
    const sb = await p.locator(".gob-sheet").boundingBox().catch(() => null);
    await p.screenshot({ path: `${OUT}/${dev}-${skin}-saved.png` });
    await p.evaluate(() => new Promise((r) => { const q = indexedDB.deleteDatabase("lfh_guest_outbox"); q.onsuccess = q.onerror = q.onblocked = () => r(); }));
    await ctx.close();
    return { text, sub, gst, total, overflow, box, btn, vh, vw, sheet, sb, bell };
  } finally { await b.close(); }
}
let n = 172718;
for (const [dev, opts] of DEVS) for (const skin of ["dark", "light"]) {
  const key = `${dev}-${skin}`;
  const L = (what, fn) => check(`P${n++}`, "components/CartPanel.tsx", `${dev}, ${skin}: ${what}`, HOW, async () => { if (up !== 200) return `skip: nothing answered on ${BASE}`; R[key] ||= await look(dev, opts, skin); return fn(R[key]); });
  L("the page never scrolls sideways with the bill open", (r) => !r.overflow);
  L("nothing on the bill reads undefined / NaN / [object …] / ${", (r) => ({ ok: !/undefined|NaN|\[object|\$\{/.test(r.text), note: `${r.text.length} chars` }));
  L("Subtotal + GST = Total, on screen", (r) => ({ ok: r.total > 0 && r.sub + r.gst === r.total, note: `${r.sub} + ${r.gst} = ${r.total}` }));
  L("Place Order is reachable inside the screen", (r) => ({ ok: !!r.btn && r.btn.y >= 0 && r.btn.y + r.btn.height <= r.vh, note: JSON.stringify(r.btn && { y: Math.round(r.btn.y), h: Math.round(r.btn.height) }) }));
  L("the bill sits inside the screen's width", (r) => ({ ok: !!r.box && r.box.x >= 0 && r.box.x + r.box.width <= r.vw + 1, note: JSON.stringify(r.box && { x: Math.round(r.box.x), w: Math.round(r.box.width) }) }));
  L("the saved-orders list fits on screen and shows the bill's own total (item 2)", (r) => { const t = money((r.sheet.match(/₹[\d,]+/) || [""])[0]); return { ok: !!r.sb && r.sb.y >= 0 && r.sb.y + r.sb.height <= r.vh && t === r.total, note: `list ₹${t} · bill ₹${r.total}` }; });
  L("the waiter bell is on screen and is what a finger touches", (r) => ({ ok: !!r.bell && r.bell.onTop && r.bell.inView, note: JSON.stringify(r.bell) }));
}
// n = 172760
check("P172760", "components/CartPanel.tsx", "the twelve captures were written for a person to open (.claude/sweep/shots/S10-T3)", "LIVE — the files", async () => {
  if (up !== 200) return `skip: nothing answered on ${BASE}`;
  const { readdirSync } = await import("node:fs"); const f = readdirSync(OUT).filter((x) => /-(bill|saved)\.png$/.test(x)); return { ok: f.length >= 12, note: `${f.length} captures` };
});
