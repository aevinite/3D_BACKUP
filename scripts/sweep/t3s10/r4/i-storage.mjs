// Round 4 · I — A PHONE WHOSE STORAGE FIGHTS BACK. Private browsing, a full phone, a browser that blocks site
// data, an old WebView with no IndexedDB: the menu must still take an order, and must never claim to have
// SAVED something it could not save. Each mode is set before the page's own code runs. Orders are caught in
// the browser; the offline step closes its page while still offline.
import { check } from "./h4.mjs";
import { page, open, addDish, openBill } from "./live4.mjs";

const MODES = [
  ["a full phone (every localStorage write refused: QuotaExceededError)", () => { const s = Storage.prototype.setItem; Storage.prototype.setItem = function (k, v) { if (k === "lfh_theme" || k === "lfh_language") return s.call(this, k, v); throw new DOMException("The quota has been exceeded.", "QuotaExceededError"); }; }],
  ["site data blocked (localStorage itself throws SecurityError)", () => { Object.defineProperty(window, "localStorage", { configurable: true, get() { throw new DOMException("The operation is insecure.", "SecurityError"); } }); }],
  ["no IndexedDB at all (an old in-app browser)", () => { Object.defineProperty(window, "indexedDB", { configurable: true, value: undefined }); }],
  ["IndexedDB that fails to open (private mode on some phones)", () => { const real = indexedDB; Object.defineProperty(window, "indexedDB", { configurable: true, value: new Proxy(real, { get(t, k) { if (k === "open") return () => { const req = { onerror: null, onsuccess: null, onupgradeneeded: null, onblocked: null, error: new DOMException("blocked", "InvalidStateError"), result: null, addEventListener(ev, fn) { if (ev === "error") setTimeout(() => fn({ target: req }), 0); } }; setTimeout(() => req.onerror && req.onerror({ target: req }), 0); return req; }; const v = Reflect.get(t, k); return typeof v === "function" ? v.bind(t) : v; } }) }); }],
];
const watch = () => { window.__r4toasts = []; window.addEventListener("lfh:toast", (e) => window.__r4toasts.push(`${e.detail?.message || ""} ${e.detail?.subtitle || ""}`.trim())); };
let k = 0;
for (const [name, mode] of MODES) {
  k++; const mine = k;   // each check keeps ITS mode's number (k itself has moved on by the time a check runs)
  check(`R4-I${k}1`, "I", `${name}: the menu opens, a dish goes in the basket, the bill shows it and Place order is sent — no page error`, async () => {
    const { ctx, p, errs } = await page({ w: 390, init: mode });
    try {
      const sent = []; await p.route("**/api/guest/place-order", (r) => { sent.push(1); r.fulfill({ status: 200, contentType: "application/json", body: '{"ok":false,"reason":"sold_out","item":"round-4 test"}' }); });
      await p.route("**/rest/v1/rpc/lfh_place_order*", (r) => r.abort());
      await open(p); await addDish(p, 0); await openBill(p);
      const lines = await p.locator("#cart-panel .cart-item").count();
      await p.locator("#cart-table").fill("29"); await p.locator(".cart-foot .btn-gold").click();
      for (let i = 0; i < 20 && !sent.length; i++) await p.waitForTimeout(300);
      return { ok: lines >= 1 && sent.length === 1 && !errs.length, note: `${lines} line(s) on the bill · order sent ${sent.length}×${errs.length ? " · page error " + errs[0] : ""}` };
    } finally { await ctx.close(); }
  });
  check(`R4-I${k}2`, "I", `${name}: offline, Place order tells the truth — "saved" only if it really was, otherwise that it was NOT sent`, async () => {
    const { ctx, p, errs } = await page({ w: 390, init: mode });
    await p.addInitScript(watch);
    try {
      await p.route("**/api/guest/**", (r) => r.abort()); await p.route("**/rest/v1/rpc/lfh_place_order*", (r) => r.abort());
      await open(p); await addDish(p, 0); await openBill(p); await p.locator("#cart-table").fill("29");
      await ctx.setOffline(true); await p.locator(".cart-foot .btn-gold").click(); await p.waitForTimeout(3000);
      const said = await p.evaluate(() => (window.__r4toasts || []).join(" / "));
      const panel = (await p.locator("#cart-panel").innerText().catch(() => "")).replace(/\s+/g, " ");
      const savedInIdb = await p.evaluate(() => new Promise((res) => { try { if (!window.indexedDB || !indexedDB.databases) return res(-1); indexedDB.databases().then((d) => res(d.some((x) => /outbox/.test(x.name)) ? 1 : 0), () => res(-1)); } catch { res(-1); } }));
      const claimsSaved = /saved|on this phone|will send|send it/i.test(said + " " + panel);
      const idbUsable = mine <= 2;   // modes 1–2 break localStorage only; IndexedDB (where the queue lives) still works
      const honest = idbUsable ? claimsSaved : !/saved on this phone|we'll send it|will send it/i.test(said);
      return { ok: honest && !errs.length, note: `told: "${(said || panel).slice(0, 140)}" · queue database present: ${savedInIdb}${errs.length ? " · page error " + errs[0] : ""}` };
    } finally { await ctx.close(); }   // closed while offline: anything it saved dies with it
  });
}
// ── "Saved — keep this page open, it sends the moment you're back online" must be TRUE where there is no
// IndexedDB to save in. The connection is switched back on with every order still caught in the browser
// (answered by the test, never reaching French House): did the order the page promised actually go out?
for (const [kk, [name, mode]] of [[3, MODES[2]], [4, MODES[3]]]) {
  check(`R4-I${kk}3`, "I", `${name}: the order it said it would send when the connection is back IS sent (caught by the test, never reaching the restaurant)`, async () => {
    const { ctx, p, errs } = await page({ w: 390, init: mode });
    try {
      const sent = []; await p.route("**/api/guest/place-order", (r) => { sent.push(r.request().postDataJSON()); r.fulfill({ status: 200, contentType: "application/json", body: '{"ok":false,"reason":"sold_out","item":"round-4 test"}' }); });
      await p.route("**/rest/v1/rpc/lfh_place_order*", (r) => r.abort());
      await open(p); await addDish(p, 0); await openBill(p); await p.locator("#cart-table").fill("29");
      await ctx.setOffline(true); await p.locator(".cart-foot .btn-gold").click(); await p.waitForTimeout(2500);
      const whileOffline = sent.length;
      await ctx.setOffline(false);   // safe ONLY because every order route above is caught by this test
      for (let i = 0; i < 40 && sent.length === whileOffline; i++) await p.waitForTimeout(500);
      return { ok: whileOffline === 0 && sent.length === 1 && sent[0]?.table === "29" && !errs.length, note: `sent while offline: ${whileOffline} · sent after the connection came back: ${sent.length - whileOffline}${errs.length ? " · " + errs[0] : ""}` };
    } finally { await ctx.close(); }
  });
}
