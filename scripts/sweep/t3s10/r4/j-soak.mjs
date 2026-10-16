// Round 4 · J — A DINER WHO KEEPS THE MENU OPEN ALL EVENING. 40 rounds of opening and closing the bill, the
// bell popup and the dish popup, then: are timers, listeners, page elements and memory back where they
// started, and did the opening and closing itself cost requests? A leak here is a phone that gets slower
// and hotter the longer a table sits. Orders and calls are caught in the browser; nothing is sent.
import { check } from "./h4.mjs";
import { page, open, addDish, openBill, closeAll } from "./live4.mjs";

const COUNT = () => {
  const iv = new Set(); const si = window.setInterval, ci = window.clearInterval;
  window.setInterval = function (...a) { const id = si.apply(this, a); iv.add(id); return id; };
  window.clearInterval = function (id) { iv.delete(id); return ci.call(this, id); };
  const L = new Map(); const ae = EventTarget.prototype.addEventListener, re = EventTarget.prototype.removeEventListener;
  const key = (t, type, fn, o) => (t === window || t === document) ? `${t === window ? "w" : "d"}:${type}:${typeof o === "boolean" ? o : !!o?.capture}` : null;
  EventTarget.prototype.addEventListener = function (type, fn, o) { const k = key(this, type, fn, o); if (k && fn) { const s = L.get(k) || new Set(); s.add(fn); L.set(k, s); } return ae.call(this, type, fn, o); };
  EventTarget.prototype.removeEventListener = function (type, fn, o) { const k = key(this, type, fn, o); if (k && fn) L.get(k)?.delete(fn); return re.call(this, type, fn, o); };
  window.__r4count = () => ({ intervals: iv.size, listeners: [...L.values()].reduce((n, s) => n + s.size, 0), nodes: document.getElementsByTagName("*").length });
};
check("R4-J01", "J", "40 rounds of opening and closing the bill, the bell and the dish popup: timers, window listeners and page elements come back to where they started", async () => {
  const { ctx, p, errs } = await page({ w: 390, init: COUNT });
  try {
    await p.route("**/api/guest/**", (r) => r.fulfill({ status: 200, contentType: "application/json", body: '{"ok":false,"reason":"sold_out"}' }));
    await p.route("**/rest/v1/rpc/lfh_call_waiter_table*", (r) => r.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' }));
    await open(p); await addDish(p, 0); await addDish(p, 2); await p.waitForTimeout(3000);
    // one warm-up round first: the first open of each popup loads its code and sets up for good
    const round = async () => { await openBill(p); await closeAll(p); await p.locator(".chef-call").evaluate((el) => el.click()); await p.waitForTimeout(500); await closeAll(p); await p.locator(".customize-btn").first().evaluate((b) => b.click()); await p.waitForTimeout(500); await closeAll(p); };
    await round(); await p.waitForTimeout(1500);
    const cdp = await ctx.newCDPSession(p); await cdp.send("HeapProfiler.collectGarbage");
    const a = await p.evaluate(() => ({ ...window.__r4count(), heap: performance.memory.usedJSHeapSize }));
    let reqs = 0; p.on("request", (r) => { if (/\/rest\/v1\/|\/api\//.test(r.url())) reqs++; });
    for (let i = 0; i < 40; i++) await round();
    await p.waitForTimeout(2500); await cdp.send("HeapProfiler.collectGarbage");
    const b = await p.evaluate(() => ({ ...window.__r4count(), heap: performance.memory.usedJSHeapSize }));
    const heapMb = (b.heap - a.heap) / 1048576;
    const ok = b.intervals - a.intervals <= 0 && b.listeners - a.listeners <= 2 && Math.abs(b.nodes - a.nodes) <= 40 && heapMb < 6 && reqs <= 40 && !errs.length;
    return { ok, note: `timers ${a.intervals}→${b.intervals} · window/document listeners ${a.listeners}→${b.listeners} · page elements ${a.nodes}→${b.nodes} · memory ${heapMb >= 0 ? "+" : ""}${heapMb.toFixed(1)} MB · ${reqs} requests over 120 opens${errs.length ? " · " + errs[0] : ""}` };
  } finally { await ctx.close(); }
});
check("R4-J02", "J", "a menu left open 3 minutes with a live order on the strip asks the server only on its slow backstop — never a fast poll", async () => {
  const seed = () => { try { localStorage.setItem("lfh_active_orders:french-house", JSON.stringify([{ id: "00000000-0000-4000-8000-0000000000d1", tableNumber: "4", total: 840, itemCount: 1, items: [{ title: "Caffè Latte", qty: 1 }], status: "preparing", placedAt: Date.now() - 60000 }])); } catch { /* blocked */ } };
  const { ctx, p, errs } = await page({ w: 390, init: seed });
  try {
    await p.route("**/rest/v1/rpc/get_order_status*", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([{ status: "preparing", table_number: "4", created_at: new Date().toISOString() }]) }));
    await open(p); await p.waitForTimeout(5000);
    const hits = new Map(); p.on("request", (r) => { const u = r.url(); if (!/\/rest\/v1\/|\/api\//.test(u)) return; const k = u.split("?")[0].replace(/^https?:\/\/[^/]+/, ""); hits.set(k, (hits.get(k) || 0) + 1); });
    await p.waitForTimeout(180_000);
    const worst = [...hits.entries()].sort((x, y) => y[1] - x[1]);
    // the backstop is 60 s (CLAUDE.md, rule 9): at most 3–4 asks per address in 3 minutes
    return { ok: worst.every(([, n]) => n <= 4) && !errs.length, note: worst.slice(0, 5).map(([k, n]) => `${k.split("/").pop()}×${n}`).join(", ") || "no requests at all in 3 minutes" };
  } finally { await ctx.close(); }
});
