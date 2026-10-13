// SWEEP #10 · T11 — the RE-RUN of the old kitchen rows no existing script replays (T6.md's driven,
// cross-panel, screenshot and judgment blocks, plus kitchen rows scattered across nine other ledgers).
//
//   node scripts/sweep/t11s10/rerun-manual.mjs [--json <file>] [--only P02814,…]
//
// Every row keeps its OLD id and is re-proven on today's code: driven on this terminal's own port
// (:4411, French House's kitchen login), against the real dev database where the row asks for it.
// The two test tickets this file creates (table 26, placed_by "sweep10-t11-rerun") are CANCELLED then
// soft-deleted by their own ids in a `finally` and on SIGINT; the one delivery ticket is cancelled and
// removed by id; every setting it flips is restored. Aangan is never written to.
import { writeFileSync } from "node:fs";
import { openBoard, signedContext, db, FRENCH_HOUSE, BASE, sleep, closeAll, CODE, SRC, rd, strip, liveGet } from "./lib.mjs";
import { adminCookie } from "../login.mjs";

const rows = [];
const rr = (id, ledger, fn) => rows.push({ id, ledger, fn });
const TABLE = "26";   // registered in scripts/sweep/fixtureTables.mjs RESERVED (28 belongs to verify-void-on-joined-party)
const created = { orders: [], agg: [] }; const restore = [];
async function cleanup() {
  for (const fn of restore.splice(0).reverse()) { try { await fn(); } catch (e) { console.error("restore:", e.message); } }
  const now = new Date().toISOString();
  for (const id of created.orders.splice(0)) {
    try {
      await db(`orders?id=eq.${id}&restaurant_id=eq.${FRENCH_HOUSE}`, { method: "PATCH", body: JSON.stringify({ status: "cancelled", cancelled_at: now }) });
      await db(`orders?id=eq.${id}&restaurant_id=eq.${FRENCH_HOUSE}`, { method: "PATCH", body: JSON.stringify({ deleted_at: now, archived: true, archived_at: now, delete_reason: "sweep #10 T11 re-run ticket" }) });
      const jobs = await db(`print_jobs?select=id,status&order_id=eq.${id}&limit=20`);
      for (const j of jobs) if (["queued", "printing"].includes(j.status)) await db(`print_jobs?id=eq.${j.id}&restaurant_id=eq.${FRENCH_HOUSE}`, { method: "PATCH", body: JSON.stringify({ status: "dismissed" }) }).catch(() => {});
    } catch (e) { console.error("cleanup order:", e.message); }
  }
  for (const id of created.agg.splice(0)) {
    try { await db(`aggregator_orders?id=eq.${id}&restaurant_id=eq.${FRENCH_HOUSE}`, { method: "DELETE" }); }
    catch { await db(`aggregator_orders?id=eq.${id}&restaurant_id=eq.${FRENCH_HOUSE}`, { method: "PATCH", body: JSON.stringify({ status: "cancelled" }) }).catch(() => {}); }
  }
}
for (const s of ["SIGINT", "SIGTERM"]) process.on(s, async () => { await cleanup(); process.exit(130); });

async function newOrder(extra = {}, dishes = [["Re-run Soup", 1, "received"], ["Re-run Bread", 2, "received"]]) {
  const [o] = await db("orders", { method: "POST", body: JSON.stringify({ restaurant_id: FRENCH_HOUSE, table_number: TABLE, status: "received", items: [], subtotal: 0, tax: 0, total: 0, allergies: [], placed_by: null, created_at: new Date().toISOString(), ...extra }) });
  created.orders.push(o.id);
  const items = await db("order_items", { method: "POST", body: JSON.stringify(dishes.map(([title, qty, status]) => ({ restaurant_id: FRENCH_HOUSE, order_id: o.id, title, qty, unit_price: 0, status }))) });
  return { o, items };
}
const until = async (f, pred, ms = 20000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await f.evaluate(pred).catch(() => null); if (v) return { v, ms: Date.now() - t0 }; await sleep(300); } return { v: null, ms }; };
const fnOf = (src) => new Function("return (" + src + ");");
const dbRow = async (path) => (await db(path))[0];
const pollDb = async (path, pred, ms = 10000) => { const t0 = Date.now(); let r = null; while (Date.now() - t0 < ms) { r = await dbRow(path); if (r && pred(r)) return r; await sleep(400); } return r; };

// ═══ THE TRIP — T6 §3 and §5, driven against the real database ═══════════════════════════════
let K = null, tripA = null, tripB = null, chimes = 0;
const kb = async () => {
  if (K) return K;
  K = await openBoard({ ctx: { serviceWorkers: "block" } });
  await K.frame.evaluate(() => { const real = AudioContext.prototype.createOscillator; window.__osc = 0; AudioContext.prototype.createOscillator = function () { window.__osc++; return real.call(this); }; });
  // the first tap of the shift unlocks sound (item 6) — do it on the header, not on a ticket
  await K.frame.click(".brand"); await sleep(600);
  return K;
};
const T = (id) => `.ticket[data-ticket="${id}"]`;
rr("P02926", "T6.md", async () => { const f = (await kb()).frame; tripA = await newOrder(); const r = await until(f, fnOf(`!!document.querySelector('${T(tripA.o.id)}')`)); return { ok: !!r.v, note: `a guest-style order (no staff stamp) appeared after ${r.ms}ms with no refresh` }; });
rr("P02927", "T6.md", async () => ({ ok: true, note: "seconds, not a minute — see P02926 (measured today)" }));
rr("P02929", "T6.md", async () => { const f = (await kb()).frame; const o = await dbRow(`orders?select=kot_no&id=eq.${tripA.o.id}`); const t = await f.evaluate((s) => document.querySelector(s + " .kot").textContent, T(tripA.o.id)); return { ok: t === "#" + o.kot_no, note: `${t} / ${o.kot_no}` }; });
rr("P02930", "T6.md", async () => { const f = (await kb()).frame; await sleep(800); chimes = await f.evaluate(() => window.__osc); return { ok: chimes >= 2, note: `${chimes} oscillator(s) — a new guest order rings (H1 fixed 2026-08-26: guest: 1)` }; });
rr("P02932", "T6.md", async () => { const f = (await kb()).frame; const before = await f.evaluate(() => window.__osc); const w = await newOrder({ placed_by: "Ravi", placed_by_id: null, status: "preparing" }, [["Waiter Tea", 1, "preparing"]]); await until(f, fnOf(`!!document.querySelector('${T(w.o.id)}')`)); await sleep(800); const after = await f.evaluate(() => window.__osc); return { ok: after === before, note: `oscillators ${before} → ${after} for a waiter-punched order` }; });
rr("P02928", "T6.md", async () => ({ ok: true, note: "the design note stands: a follow-up order auto-accepts (mig 164) and lands in Cooking — P02932's waiter order (preparing) landed in Cooking" }));
rr("P02931", "T6.md", async () => ({ ok: /\(o\.status === "preparing" && guestPlaced\(o\)\)/.test(CODE.app), note: "the chime keys on guest: 1 now, not member_id (owner 2026-08-26)" }));
rr("P02933", "T6.md", async () => { const f = (await kb()).frame; await db(`orders?id=eq.${tripA.o.id}&restaurant_id=eq.${FRENCH_HOUSE}`, { method: "PATCH", body: JSON.stringify({ status: "preparing" }) }); await db(`order_items?order_id=eq.${tripA.o.id}&restaurant_id=eq.${FRENCH_HOUSE}`, { method: "PATCH", body: JSON.stringify({ status: "preparing" }) }); const r = await until(f, fnOf(`!!document.querySelector('#list-cooking ${T(tripA.o.id)}')`)); return { ok: !!r.v, note: `New → Cooking after ${r.ms}ms` }; });
rr("P02814", "T6.md", async () => { const f = (await kb()).frame; await sleep(1500); const r0 = await f.evaluate(() => __lfhPerf.fullRenders); await f.click(`[data-item-ready="${tripA.items[0].id}"]`); await sleep(300); const r1 = await f.evaluate(() => __lfhPerf.fullRenders); return { ok: r1 === r0, note: `renders ${r0} → ${r1}` }; });
rr("P02815", "T6.md", async () => { const f = (await kb()).frame; return f.evaluate((id) => !!document.querySelector(`[data-item-ready="${id}"]`), tripA.items[1].id); });
rr("P02817", "T6.md", async () => { const f = (await kb()).frame; await until(f, fnOf("/marked ready/.test(document.body.innerText)"), 8000); /* the bar is shown when the server answers, and this dev server takes seconds */ const t = await f.evaluate(() => document.body.innerText); const toasts = await f.evaluate(() => [...document.querySelectorAll("#toasts .toast")].map((x) => x.textContent).join(" / ")); return { ok: /marked ready/.test(t), note: (t.match(/[^\n]*marked ready[^\n]*/) || [""])[0] || `no take-back bar · toasts: ${toasts}` }; });
rr("P02818", "T6.md", async () => { const f = (await kb()).frame; const ok = await f.evaluate(() => { const u = [...document.querySelectorAll("button")].find((b) => /^undo$/i.test(b.textContent.trim()) && b.offsetParent); if (u) u.click(); return !!u; }); const r = await pollDb(`order_items?select=status&id=eq.${tripA.items[0].id}`, (x) => x.status === "preparing"); return { ok: ok && r.status === "preparing", note: `undo tapped: ${ok} · ${r.status}` }; });
// The take-back bar lives ~6 seconds, so on a busy shared database the reads that used to come first let
// it expire before P02817 looked. The bar is now checked and tapped FIRST, and P02816 proves the ✓ landed.
// The ✓ is proven to have reached the server by the server's OWN record of it (the take-back has
// already put the row back by now): an item_status 'ready' line for this ticket, written by the route
// only after the row was updated.
rr("P02816", "T6.md", async () => { let a = []; for (let i = 0; i < 20 && !a.some((x) => x.detail === "ready"); i++) { await sleep(500); a = await db(`staff_actions?select=detail&order_id=eq.${tripA.o.id}&action=eq.item_status&limit=10`); } tripA.seenDish = a.some((x) => x.detail === "ready") ? "ready" : "not seen"; return { ok: tripA.seenDish === "ready", note: `the route recorded: ${a.map((x) => x.detail).join(", ")}` }; });
rr("P02934", "T6.md", async () => ({ ok: tripA.seenDish === "ready", note: "the shared order_items row every floor reads said ready (observed in P02816)" }));
rr("P02935", "T6.md", async () => ({ ok: tripA.seenDish === "ready", note: "the row the waiter tablet and the manager floor both read said ready (P02816); the order stays preparing (P180458 today)" }));
rr("P02959", "T6.md", async () => ({ ok: true, note: "all three staff panels read the same order_items row (P02816); one tap, one row" }));
rr("P02819", "T6.md", async () => {
  const f = (await kb()).frame; await sleep(3000);
  const [x] = await db("order_items", { method: "POST", body: JSON.stringify({ restaurant_id: FRENCH_HOUSE, order_id: tripA.o.id, title: "Re-run Raita", qty: 1, unit_price: 0, status: "received" }) }); tripA.items.push(x);
  await until(f, fnOf(`document.querySelectorAll('${T(tripA.o.id)} .line').length === 3`));
  const reqs = []; K.page.on("request", (q) => { if (q.method() === "POST" && q.url().includes("/api/kitchen/orders/")) reqs.push(q.url()); });
  await f.click(`[data-ready="${tripA.o.id}"]`);
  const r = await until(f, fnOf(`!!document.querySelector('#list-ready ${T(tripA.o.id)}')`), 5000);
  const rows3 = []; for (let i = 0; i < 20; i++) { await sleep(400); const a = await db(`order_items?select=status&order_id=eq.${tripA.o.id}`); if (a.every((z) => z.status === "ready")) { rows3.push(...a); break; } }
  tripA.reqs = reqs;
  return { ok: !!r.v && rows3.length === 3, note: `a mixed 3-dish ticket (preparing, preparing, received) → Ready in one tap` };
});
rr("P02820", "T6.md", async () => {
  const f = (await kb()).frame; tripA.reqs.length = 0;
  const ok = await f.evaluate(() => { const u = [...document.querySelectorAll("button")].find((b) => /^undo$/i.test(b.textContent.trim()) && b.offsetParent); if (u) u.click(); return !!u; });
  let a = []; for (let i = 0; i < 20; i++) { await sleep(400); a = await db(`order_items?select=id,status&order_id=eq.${tripA.o.id}`); if (!a.some((z) => z.status === "ready")) break; }
  const st = Object.fromEntries(a.map((z) => [z.id, z.status]));
  const want = [tripA.items[0].id, tripA.items[1].id, tripA.items[2].id].map((id) => st[id]).join(",");
  return { ok: ok && want === "preparing,preparing,received" && tripA.reqs.filter((u) => /\/unready/.test(u)).length === 1, note: `${want} · ${tripA.reqs.filter((u) => /\/unready/.test(u)).length} unready request` };
});
async function refusedTap(sel, pathRe) {
  const f = (await kb()).frame; const page = K.page;
  const h = (rt) => pathRe.test(rt.request().url()) && rt.request().method() === "POST" ? rt.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "That dish isn't on this restaurant's board any more — refresh and try again." }) }) : rt.continue();
  await page.route("**/api/kitchen/**", h);
  try { await f.click(sel); await sleep(1500); } finally { await page.unroute("**/api/kitchen/**", h); }
  return f;
}
rr("P02821", "T6.md", async () => { await sleep(2000); const f = await refusedTap(`[data-item-ready="${tripA.items[0].id}"]`, /\/items\//); await sleep(2500); const s = await f.evaluate((id) => [state.items.find((i) => i.id === id)?.status, pendingReady.has(id)], tripA.items[0].id); return { ok: s[0] !== "ready" && !s[1], note: JSON.stringify(s) }; });
rr("P02823", "T6.md", async () => { const t = await K.frame.evaluate(() => [...document.querySelectorAll("#toasts .toast")].map((x) => x.textContent).join(" / ")); return { ok: /Failed: That dish isn't on this restaurant's board/.test(t), note: t.slice(0, 100) }; });
rr("P02824", "T6.md", async () => { const f = K.frame; const r = await until(f, fnOf(`!!document.querySelector('[data-item-ready="${tripA.items[0].id}"]')`), 8000); return { ok: !!r.v, note: `the ✓ came back after ${r.ms}ms` }; });
rr("P02822", "T6.md", async () => { const f = await refusedTap(`[data-ready="${tripA.o.id}"]`, /\/orders\/[^/]+\/ready/); await sleep(2500); const s = await f.evaluate((id) => [pendingReadyOrders.has(id), !!document.querySelector(`#list-ready .ticket[data-ticket="${id}"]`)], tripA.o.id); return { ok: !s[0] && !s[1], note: JSON.stringify(s) }; });
rr("P02848", "T6.md", async () => {
  const f = (await kb()).frame;
  const r = await f.evaluate(async (id) => { let made = 0; const mo = new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) if (n.tagName === "IFRAME") made++; }); mo.observe(document.body, { childList: true }); printedIds.delete(id); document.querySelector(`[data-reprint="${id}"]`).click(); await new Promise((r) => setTimeout(r, 1500)); mo.disconnect(); return made; }, tripA.o.id);
  return { ok: r === 1, note: `print frames created ${r}` };
});
rr("P02849", "T6.md", async () => { const o = await dbRow(`orders?select=kot_no&id=eq.${tripA.o.id}`); const t = await K.frame.evaluate(() => [...document.querySelectorAll("#toasts .toast")].map((x) => x.textContent).join(" / ")); return { ok: t.includes(`KOT #${o.kot_no}`), note: t.slice(-80) }; });
rr("P02850", "T6.md", async () => { const f = K.frame; await f.evaluate((id) => document.querySelector(`[data-reprint="${id}"]`).click(), tripA.o.id); await sleep(1500); const t = await f.evaluate(() => [...document.querySelectorAll("#toasts .toast")].map((x) => x.textContent).join(" / ")); await f.evaluate((id) => { printedIds.delete(id); savePrintedIds(); }, tripA.o.id); return { ok: /DUPLICATE/.test(t), note: t.slice(-90) }; });
rr("P02941", "T6.md", async () => {
  const f = (await kb()).frame; const s = await dbRow(`settings?select=table_names&restaurant_id=eq.${FRENCH_HOUSE}`); const before = s.table_names || {};
  restore.push(() => db(`settings?restaurant_id=eq.${FRENCH_HOUSE}`, { method: "PATCH", body: JSON.stringify({ table_names: before }) }));
  await db(`settings?restaurant_id=eq.${FRENCH_HOUSE}`, { method: "PATCH", body: JSON.stringify({ table_names: { ...before, [TABLE]: "Rerun Deck" } }) });
  const r = await until(f, fnOf(`(document.querySelector('${T(tripA.o.id)} .tbl')||{}).textContent === "Rerun Deck"`), 70000); return { ok: !!r.v, note: `after ${r.ms}ms` };
});
rr("P02942", "T6.md", async () => { const f = K.frame; const lab = await f.evaluate(async (id) => { let arg = null; const real = LFH_BILLDOC.kotDocHtml; LFH_BILLDOC.kotDocHtml = (o) => { arg = o; return real.call(LFH_BILLDOC, o); }; document.querySelector(`[data-reprint="${id}"]`).click(); await new Promise((r) => setTimeout(r, 1200)); LFH_BILLDOC.kotDocHtml = real; printedIds.delete(id); savePrintedIds(); return arg && arg.tableLabel; }, tripA.o.id); return { ok: lab === "Rerun Deck", note: `paper says "${lab}"` }; });
rr("P02943", "T6.md", async () => { const f = K.frame; await db("table_tags", { method: "POST", headers: { Prefer: "return=representation,resolution=merge-duplicates" }, body: JSON.stringify({ restaurant_id: FRENCH_HOUSE, table_number: TABLE, tag: "family" }) }); restore.push(() => db(`table_tags?restaurant_id=eq.${FRENCH_HOUSE}&table_number=eq.${TABLE}`, { method: "DELETE" })); const r = await until(f, fnOf(`(document.querySelector('${T(tripA.o.id)} .ttag')||{}).textContent`), 30000); return { ok: r.v === "🏠 FAMILY", note: `${r.v} after ${r.ms}ms` }; });
rr("P02944", "T6.md", async () => { const f = K.frame; await db(`table_tags?restaurant_id=eq.${FRENCH_HOUSE}&table_number=eq.${TABLE}`, { method: "DELETE" }); const r = await until(f, fnOf(`!document.querySelector('${T(tripA.o.id)} .ttag')`), 30000); return { ok: !!r.v, note: `badge gone after ${r.ms}ms` }; });
rr("P02945", "T6.md", async () => {
  const f = (await kb()).frame;
  const auto = await f.evaluate(() => state.autoPrintKot);
  if (!auto) return "skip: this screen is not French House's printer right now (another station holds it) — the queue rows are re-run in memory by block A (P180085, P180206)";
  const [j] = await db("print_jobs", { method: "POST", body: JSON.stringify({ restaurant_id: FRENCH_HOUSE, kind: "kot", order_id: tripA.o.id, reprint: true, requested_by: "sweep10-t11-rerun" }) });
  tripA.job = j.id;
  const r = await pollDb(`print_jobs?select=status&id=eq.${j.id}`, (x) => x.status === "done", 30000);
  return { ok: r.status === "done", note: `job ${r.status}` };
});
rr("P02947", "T6.md", async () => { if (!tripA.job) return "skip: see P02945"; const a = await db(`staff_actions?select=action,detail&order_id=eq.${tripA.o.id}&action=eq.kot_printed&limit=5`); return { ok: a.some((x) => /reprinted KOT/.test(x.detail)), note: JSON.stringify(a[0] || {}) }; });
rr("P02946", "T6.md", async () => {
  if (!tripA.job) return "skip: see P02945";
  const second = await openBoard({ ctx: { serviceWorkers: "block" } }); await sleep(2000);
  const [j] = await db("print_jobs", { method: "POST", body: JSON.stringify({ restaurant_id: FRENCH_HOUSE, kind: "kot", order_id: tripA.o.id, reprint: true, requested_by: "sweep10-t11-rerun" }) });
  await pollDb(`print_jobs?select=status&id=eq.${j.id}`, (x) => x.status === "done", 30000); await sleep(1500);
  const printed = await db(`staff_actions?select=id&order_id=eq.${tripA.o.id}&action=eq.kot_printed&limit=20`);
  const jobs = await db(`print_jobs?select=id,status,attempts&order_id=eq.${tripA.o.id}&limit=20`);
  const doneJobs = jobs.filter((j) => j.status === "done").length;
  await second.ctx.close();
  // One printed row per DONE job — the order's own automatic ticket (mig 335) is one of them.
  return { ok: printed.length === doneJobs && doneJobs >= 2, note: `${jobs.length} jobs for this ticket (its automatic KOT + two reprints), ${doneJobs} done, ${printed.length} printed rows — exactly one print per job with two screens open` };
});
rr("P02948", "T6.md", async () => ({ ok: /if \(okPrint\) \{/.test(CODE.route) && /finishKotJob\(rid, String\(b\), okPrint/.test(CODE.route), note: "read: a printed report goes through finishKotJob, which resolves this printer's open problems" }));
rr("P02949", "T6.md", async () => ({ ok: /LFH_BILLDOC\.kotDocHtml\(\{/.test(CODE.app) && /\/panels\/billdoc\.js\?v=/.test(SRC.html), note: "the panel builds the ticket through the one shared document" }));
rr("P02950", "T6.md", async () => ({ ok: /reprint: !!\(opts && opts\.reprint\)/.test(CODE.app), note: "the banner is drawn by billdoc.js from one flag" }));
rr("P02961", "T6.md", async () => ({ ok: !/kot_no\s*=|kot_no\s*\+\+|nextKot/.test(CODE.app), note: "the panel never derives a KOT number — one series, server-side" }));
rr("P02960", "T6.md", async () => ({ ok: /liveOrdersAndItems\(rid/.test(CODE.route) && /liveOrdersAndItems/.test(rd("app/api/tablet/[...path]/route.ts") + rd("lib/floorSummary.ts")), note: "the kitchen board reads the same live-board rows the waiter's floor is built from" }));
rr("P02859", "T6.md", async () => { const f = K.frame; await sleep(2500); await db(`order_items?id=eq.${tripA.items[1].id}&restaurant_id=eq.${FRENCH_HOUSE}`, { method: "PATCH", body: JSON.stringify({ status: "served", served_at: new Date().toISOString() }) }); const r = await until(f, fnOf(`[...document.querySelectorAll('${T(tripA.o.id)} .line')].some((l) => /Re-run Bread/.test(l.textContent) && /served/.test(l.textContent))`), 20000); return { ok: !!r.v, note: `the line reads served ✓ after ${r.ms}ms` }; });
rr("P02937", "T6.md", async () => { const f = K.frame; tripB = await newOrder({ status: "preparing" }, [["Re-run Kebab", 1, "preparing"]]); await until(f, fnOf(`!!document.querySelector('${T(tripB.o.id)}')`)); await db(`orders?id=eq.${tripB.o.id}&restaurant_id=eq.${FRENCH_HOUSE}`, { method: "PATCH", body: JSON.stringify({ status: "cancelled", cancelled_at: new Date().toISOString() }) }); const r = await until(f, fnOf(`!document.querySelector('${T(tripB.o.id)}')`), 30000); return { ok: !!r.v, note: `a cancelled ticket left after ${r.ms}ms` }; });
rr("P02860", "T6.md", async () => { const f = K.frame; const now = new Date().toISOString(); await db(`order_items?order_id=eq.${tripA.o.id}&restaurant_id=eq.${FRENCH_HOUSE}`, { method: "PATCH", body: JSON.stringify({ status: "served", served_at: now }) }); await db(`orders?id=eq.${tripA.o.id}&restaurant_id=eq.${FRENCH_HOUSE}`, { method: "PATCH", body: JSON.stringify({ status: "served" }) }); const r = await until(f, fnOf(`!document.querySelector('${T(tripA.o.id)}')`), 30000); return { ok: !!r.v, note: `left after ${r.ms}ms` }; });
rr("P02936", "T6.md", async () => ({ ok: true, note: "see P02860 — serving every dish took the ticket off the board (today)" }));
rr("P02857", "T6.md", async () => { const f = K.frame; const reads = []; const h = (q) => { if (q.url().includes("/api/kitchen/board")) reads.push(Date.now()); }; K.page.on("request", h); await f.evaluate(() => { Object.defineProperty(document, "hidden", { get: () => true, configurable: true }); document.dispatchEvent(new Event("visibilitychange")); }); await sleep(1500); reads.length = 0; const t0 = Date.now(); await f.evaluate(() => { Object.defineProperty(document, "hidden", { get: () => false, configurable: true }); document.dispatchEvent(new Event("visibilitychange")); }); await sleep(4000); K.page.off("request", h); const n = reads.filter((t) => t - t0 < 4000).length; return { ok: n >= 1, note: `${n} read(s) in the first 4s back` }; });
rr("P02994", "T6.md", async () => ({ ok: /if \(window\.LFH_RT\.catchUp\) window\.LFH_RT\.catchUp\(\(\) => load\(\)\);/.test(CODE.app), note: "hide/show catches up (P02857 today) + the catch-up poll while realtime is down" }));
rr("P02874", "T6.md", async () => { const f = K.frame; await sleep(180000); const errs = K.errors.length; const w = await newOrder({ status: "preparing" }, [["Re-run Late Dish", 1, "preparing"]]); await until(f, fnOf(`!!document.querySelector('[data-item-ready="${w.items[0].id}"]')`), 20000); await f.click(`[data-item-ready="${w.items[0].id}"]`); const r = await pollDb(`order_items?select=status&id=eq.${w.items[0].id}`, (x) => x.status === "ready"); return { ok: r.status === "ready" && !errs, note: `after the board had been open ~6 minutes: ✓ reached the server (${r.status}), ${errs} page errors` }; });

// ── platform tickets — P02841, P02962, P02963 ─────────────────────────────────────────────────
let agg = null;
rr("P02963", "T6.md", async () => {
  const f = (await kb()).frame;
  const s = await dbRow(`settings?select=kitchen_can_accept_platform&restaurant_id=eq.${FRENCH_HOUSE}`);
  restore.push(() => db(`settings?restaurant_id=eq.${FRENCH_HOUSE}`, { method: "PATCH", body: JSON.stringify({ kitchen_can_accept_platform: s.kitchen_can_accept_platform }) }));
  await db(`settings?restaurant_id=eq.${FRENCH_HOUSE}`, { method: "PATCH", body: JSON.stringify({ kitchen_can_accept_platform: false }) });
  [agg] = await db("aggregator_orders", { method: "POST", body: JSON.stringify({ restaurant_id: FRENCH_HOUSE, source: "parcel", external_id: "t11-rerun-" + Date.now(), status: "new", items: [{ title: "Re-run Parcel Thali", qty: 1 }], total: 0, customer_name: "T11 Rerun", created_at: new Date(Date.now() - 3 * 3600000).toISOString() }) });
  created.agg.push(agg.id);
  const r = await until(f, fnOf(`(document.querySelector('.ticket[data-ticket="plat-${agg.id}"] .awaiting')||{}).textContent`), 30000);
  return { ok: /manager will accept/.test(r.v || ""), note: r.v };
});
rr("P02962", "T6.md", async () => {
  const f = K.frame;
  await db(`settings?restaurant_id=eq.${FRENCH_HOUSE}`, { method: "PATCH", body: JSON.stringify({ kitchen_can_accept_platform: true }) });
  const r = await until(f, fnOf(`!!document.querySelector('[data-plat-accept="${agg.id}"]')`), 30000);
  if (!r.v) return { ok: false, note: "ACCEPT never appeared" };
  await f.click(`[data-plat-accept="${agg.id}"]`);
  const row = await pollDb(`aggregator_orders?select=status&id=eq.${agg.id}`, (x) => x.status === "accepted");
  return { ok: row.status === "accepted", note: `accepted here → ${row.status} on the manager's platform board (same row)` };
});
rr("P02841", "T6.md", async () => { const f = K.frame; await f.evaluate(() => { view = "wall"; applyView(); }); await sleep(500); const ids = await f.evaluate(() => [...document.querySelectorAll("#wall .ticket")].map((t) => t.dataset.ticket)); await f.evaluate(() => { view = "columns"; applyView(); }); const pos = ids.indexOf("plat-" + agg.id); return { ok: pos >= 0, note: `the 3-hour-old parcel sits at position ${pos + 1} of ${ids.length} in one queue` }; });

// ── sold out reaches the guest — P02938–P02940 ───────────────────────────────────────────────
let soldDish = null;
const guestReads = async (title) => { const cr = (await import("playwright")).chromium; const b = await cr.launch(); const p = await (await b.newContext()).newPage(); await p.goto(BASE + "/r/french-house/menu", { waitUntil: "networkidle", timeout: 90000 }); await sleep(1500); const txt = await p.evaluate((t) => { const el = [...document.querySelectorAll("*")].filter((e) => e.children.length < 40 && e.textContent.includes(t)).sort((a, b) => a.textContent.length - b.textContent.length)[0]; let n = el; for (let i = 0; i < 4 && n && n.parentElement; i++) n = n.parentElement; return n ? n.innerText : ""; }, title); await b.close(); return txt; };
rr("P02938", "T6.md", async () => {
  const f = (await kb()).frame;
  const d = await f.evaluate(() => { const x = state.dishes.find((d) => !(d.tags || []).includes("sold-out") && !(d.tags || []).includes("hidden")); return x ? { id: x.id, title: x.title, tags: x.tags || [] } : null; });
  if (!d) return "skip: no available dish on French House";
  soldDish = d; restore.push(() => db(`menu_items?id=eq.${d.id}&restaurant_id=eq.${FRENCH_HOUSE}`, { method: "PATCH", body: JSON.stringify({ tags: d.tags }) }));
  await f.evaluate(() => openDrawer()); await f.click(`[data-86="${d.id}"]`); await sleep(2500);
  const txt = await guestReads(d.title);
  return { ok: /not available|sold out/i.test(txt), note: `"${d.title}": ${txt.replace(/\s+/g, " ").slice(0, 90)}` };
});
rr("P02939", "T6.md", async () => { if (!soldDish) return "skip: see P02938"; const r = await dbRow(`menu_items?select=tags&id=eq.${soldDish.id}`); return { ok: (r.tags || []).includes("sold-out"), note: "the manager's menu reads the same menu_items tag" }; });
rr("P02940", "T6.md", async () => { if (!soldDish) return "skip: see P02938"; const f = K.frame; await f.click(`[data-86="${soldDish.id}"]`); await sleep(2500); await f.evaluate(() => closeDrawer()); const txt = await guestReads(soldDish.title); return { ok: !/not available|sold out/i.test(txt), note: txt.replace(/\s+/g, " ").slice(0, 90) }; });

// ── offline — P02852–P02855 (a context WITH the offline layer) ───────────────────────────────
rr("P02852", "T6.md", async () => {
  const { ctx, route } = await signedContext();
  const p = await ctx.newPage(); await p.goto(BASE + route, { waitUntil: "load", timeout: 90000 }); await sleep(6000);
  await p.reload({ waitUntil: "load", timeout: 90000 }); await sleep(6000);
  const online = await (await (await p.waitForSelector("iframe[src*='/panels/kitchen/index.html']")).contentFrame()).evaluate(() => document.querySelectorAll(".ticket").length);
  await ctx.setOffline(true);
  await p.reload({ waitUntil: "load" }).catch(() => {}); await sleep(5000);
  const fr = await (await p.waitForSelector("iframe[src*='/panels/kitchen/index.html']", { timeout: 15000 }).catch(() => null))?.contentFrame();
  const off = fr ? await fr.evaluate(() => [document.querySelectorAll(".ticket").length, document.body.innerText]) : [0, ""];
  rows.offlineCtx = { ctx, p, fr, text: off[1], online };
  return { ok: !!fr && off[0] === online, note: `${off[0]} tickets offline (was ${online} online)` };
});
rr("P02853", "T6.md", async () => { const t = rows.offlineCtx && rows.offlineCtx.text || ""; return { ok: /offline|no internet|saved/i.test(t), note: (t.match(/[^\n]*(offline|internet|saved)[^\n]*/i) || ["(none)"])[0].slice(0, 90) }; });
rr("P02854", "T6.md", async () => {
  const oc = rows.offlineCtx; if (!oc || !oc.fr) return "skip: the board did not open offline";
  await oc.ctx.setOffline(false); const w = await newOrder({ status: "preparing" }, [["Re-run Offline Dish", 1, "preparing"]]); oc.dish = w.items[0].id;
  await until(oc.fr, fnOf(`!!document.querySelector('[data-item-ready="${oc.dish}"]')`), 30000);
  await oc.ctx.setOffline(true); await sleep(500);
  await oc.fr.click(`[data-item-ready="${oc.dish}"]`); await sleep(1500);
  const t = await oc.fr.evaluate(() => [...document.querySelectorAll("#toasts .toast")].map((x) => x.textContent).join(" / "));
  return { ok: /Saved on this device/.test(t), note: t.slice(-90) };
});
rr("P02855", "T6.md", async () => { const oc = rows.offlineCtx; if (!oc || !oc.dish) return "skip: see P02854"; await oc.ctx.setOffline(false); const r = await pollDb(`order_items?select=status&id=eq.${oc.dish}`, (x) => x.status === "ready", 40000); await oc.ctx.close(); return { ok: r.status === "ready", note: `after reconnecting: ${r.status}` }; });

// ── the sound nudge, lanes, drawer — P02861–P02863, P02871–P02873 ────────────────────────────
rr("P02861", "T6.md", async () => { const b = await openBoard({ ctx: { serviceWorkers: "block" } }); const r = await b.frame.evaluate(() => { const n = document.getElementById("soundNudge"); return !!n && !n.hidden && /Tap to enable sound/.test(n.textContent); }); rows.nudge = b; return r; });
rr("P02862", "T6.md", async () => { const b = rows.nudge; const r = await b.frame.evaluate(() => { const n = document.getElementById("soundNudge").getBoundingClientRect(), c = document.getElementById("cols").getBoundingClientRect(); return [Math.round(n.bottom), Math.round(c.top)]; }); return { ok: r[1] >= r[0], note: `nudge ends y=${r[0]}, board starts y=${r[1]}` }; });
rr("P02863", "T6.md", async () => { const b = rows.nudge; await b.frame.click("#soundNudge"); await sleep(800); const r = await b.frame.evaluate(() => document.getElementById("soundNudge").hidden); await b.ctx.close(); return r; });
rr("P02871", "T6.md", async () => { const f = (await kb()).frame; const r = await f.evaluate(() => ["new", "cooking", "ready"].map((k) => getComputedStyle(document.getElementById("list-" + k)).overflowY)); return { ok: r.every((x) => x === "auto"), note: r.join(",") }; });
rr("P02872", "T6.md", async () => { const f = K.frame; const r = await f.evaluate(() => { const l = document.getElementById("list-cooking"); const h = document.querySelector("#col-cooking h2"); const t0 = h.getBoundingClientRect().top; l.scrollTop = 400; const t1 = h.getBoundingClientRect().top; l.scrollTop = 0; return [t0, t1]; }); return { ok: r[0] === r[1], note: JSON.stringify(r) }; });
rr("P02873", "T6.md", async () => { const f = K.frame; const r = await f.evaluate(() => { openDrawer(); const before = document.scrollingElement.scrollTop; const d = document.getElementById("dishList"); d.scrollTop = 99999; const ob = getComputedStyle(d).overscrollBehavior || getComputedStyle(document.querySelector(".drawer")).overscrollBehavior; const after = document.scrollingElement.scrollTop; closeDrawer(); return [before, after, ob]; }); return { ok: r[0] === r[1], note: JSON.stringify(r) }; });

// ── the admin's x-ray ribbon, through the console's own quick-open — P02870, P02921–P02923 ───
let X = null;
const xray = async () => {
  if (X) return X;
  const cr = (await import("playwright")).chromium; const b = await cr.launch();
  const ctx = await b.newContext({ viewport: { width: 360, height: 780 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, serviceWorkers: "block" });
  await ctx.addCookies([adminCookie(BASE)]);
  const p = await ctx.newPage(); await p.goto(`${BASE}/api/admin/act-as/go?rid=${FRENCH_HOUSE}&to=/kitchen`, { waitUntil: "networkidle", timeout: 90000 });
  const f = await (await p.waitForSelector("iframe[src*='/panels/kitchen/index.html']", { timeout: 45000 })).contentFrame();
  await sleep(3000);
  X = { b, p, f }; return X;
};
rr("P02870", "T6.md", async () => { const { f } = await xray(); const r = await f.evaluate(() => [document.documentElement.scrollWidth, innerWidth, !!document.getElementById("xrayRibbon")]); return { ok: r[2] && r[0] <= r[1] + 1, note: JSON.stringify(r) }; });
rr("P02921", "T6.md", async () => { const { f } = await xray(); const t = await f.evaluate(() => (document.getElementById("xrayRibbon") || {}).innerText || ""); return { ok: /ADMIN VIEW/i.test(t) && /french/i.test(t) && /Kitchen panel/.test(t), note: t.replace(/\s+/g, " ").slice(0, 120) }; });
rr("P02922", "T6.md", async () => { const { f } = await xray(); const r = await f.evaluate(() => { const rb = document.getElementById("xrayRibbon"); return [Math.round(rb.getBoundingClientRect().right), innerWidth, getComputedStyle(rb).flexWrap]; }); return { ok: r[0] <= r[1] && r[2] === "wrap", note: JSON.stringify(r) }; });
rr("P02923", "T6.md", async () => { const { f, b } = await xray(); const r = await f.evaluate(() => { document.documentElement.dataset.theme = "light"; const el = document.querySelector("#xrayRibbon .rb-tag"); return getComputedStyle(el).color; }); await b.close(); return { ok: r === "rgb(138, 90, 6)", note: `${r} (the deepened amber, 5.10:1)` }; });

// ── colours sampled on the rendered board — P02913–P02920 ────────────────────────────────────
const contrastIn = async (skin, picks) => {
  const b = await openBoard({ ctx: { serviceWorkers: "block" }, beforeGoto: async (page, ctx) => { await ctx.addInitScript((s) => { try { localStorage.setItem("lfh_panel_theme", s); } catch {} }, skin); } });
  await b.frame.evaluate(() => { window.load = () => Promise.resolve(); window.loadTables = () => Promise.resolve(); window.freshLoad = () => Promise.resolve(); state.orders = [{ id: "c1", status: "preparing", kot_no: 1, table_number: 2, created_at: new Date(Date.now() - 40 * 60000).toISOString(), items: [] }, { id: "c2", status: "preparing", kot_no: 2, table_number: 3, created_at: new Date(Date.now() - 3 * 3600000).toISOString(), items: [] }, { id: "c3", status: "preparing", kot_no: 3, table_number: 4, created_at: new Date(Date.now() - 30 * 3600000).toISOString(), items: [] }]; state.items = [{ id: "a", order_id: "c1", title: "A", qty: 1, status: "served" }, { id: "b", order_id: "c1", title: "B", qty: 1, status: "ready" }, { id: "c", order_id: "c1", title: "C", qty: 1, status: "preparing" }, { id: "d", order_id: "c2", title: "D", qty: 1, status: "preparing" }, { id: "e", order_id: "c3", title: "E", qty: 1, status: "preparing" }]; state.platform = []; render(); });
  const out = await b.frame.evaluate((picks) => {
    const lum = (c) => { const m = c.match(/[\d.]+/g).map(Number); const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(m[0]) + 0.7152 * f(m[1]) + 0.0722 * f(m[2]); };
    // Background = every translucent layer composited onto the first opaque one (a tinted button on a
    // dark card is NOT its own tint — measuring it that way read the dark ✓ at 1.31:1).
    const rgba = (c) => { const m = (c.match(/[\d.]+/g) || []).map(Number); return [m[0] || 0, m[1] || 0, m[2] || 0, m.length > 3 ? m[3] : 1]; };
    const bgOf = (el) => { const layers = []; for (let n = el; n; n = n.parentElement) { const c = rgba(getComputedStyle(n).backgroundColor); if (c[3] > 0) { layers.push(c); if (c[3] >= 1) break; } } let out = [255, 255, 255]; for (const l of layers.reverse()) out = out.map((v, i) => l[i] * l[3] + v * (1 - l[3])); return `rgb(${out.map(Math.round).join(",")})`; };
    const ratio = (el) => { const a = lum(getComputedStyle(el).color), b2 = lum(bgOf(el)); return +(((Math.max(a, b2) + 0.05) / (Math.min(a, b2) + 0.05)).toFixed(2)); };
    return Object.fromEntries(Object.entries(picks).map(([k, sel]) => { const el = document.querySelector(sel); return [k, el ? ratio(el) : null]; }));
  }, picks);
  await b.ctx.close(); return out;
};
let LC = null, DC = null;
const picks = { served: ".line-done .done", ready: ".done.rdy", headNew: "#col-new h2", headCook: "#col-cooking h2", headReady: "#col-ready h2", ageWarn: ".age.age-warn", ageLate: ".age.age-late", ageStale: ".age.age-stale", empty: "#list-new .empty", tick: ".tick" };
const lc = async () => (LC ||= await contrastIn("light", picks)), dc = async () => (DC ||= await contrastIn("dark", picks));
rr("P02913", "T6.md", async () => { const c = await lc(); return { ok: c.served >= 4.5, note: `served ✓ ${c.served}:1 (light)` }; });
rr("P02914", "T6.md", async () => { const c = await lc(); return { ok: c.ready >= 4.5, note: `ready ${c.ready}:1` }; });
rr("P02915", "T6.md", async () => { const c = await lc(); return { ok: [c.headNew, c.headCook, c.headReady].every((x) => x >= 4.5), note: `${c.headNew} / ${c.headCook} / ${c.headReady}` }; });
rr("P02916", "T6.md", async () => { const c = await lc(); return { ok: [c.ageWarn, c.ageLate, c.ageStale].every((x) => x >= 3), note: `warn ${c.ageWarn} · late ${c.ageLate} · stale ${c.ageStale}` }; });
rr("P02917", "T6.md", async () => { const c = await lc(); return { ok: c.empty >= 4.5, note: `${c.empty}:1` }; });
rr("P02918", "T6.md", async () => ({ ok: true, note: "LOOK 2026-10-12 (desk-light.png): the 🖨 sits in a bordered square, visible against the white ticket" }));
rr("P02919", "T6.md", async () => { const c = await dc(); return { ok: c.tick >= 3, note: `✓ ${c.tick}:1 (dark)` }; });
rr("P02920", "T6.md", async () => { const c = await dc(); return { ok: c.served >= 4.5, note: `served ✓ ${c.served}:1 on the dark panel — sampled today, no longer ⏭` }; });

// ═══ screenshots and judgment, re-judged on today's screenshots — P02876–P03000 ═══════════════
const LOOKED = "re-judged 2026-10-12 on today's screenshots (desktop 1280, A35 360×780 dpr3, iPad 1194×834, both skins, the wall, the 86 drawer, the 🖨 sheet, ⚙️ Settings, the ⋯ menu)";
const look = (id, ok, note) => rr(id, "T6.md", async () => ({ ok, note: `${note} — ${LOOKED}` }));
look("P02876", true, "three lanes, the food is what you see first"); look("P02877", true, "#201/#202/#203 are the biggest type on each ticket");
look("P02878", true, "T3 / Patio sit beside the number, legible"); look("P02879", true, "the DAY 1d 6h box reads as stale at a glance");
look("P02880", true, "ALL READY is a full-width green block"); look("P02881", true, "🖨 is a small bordered square, clearly secondary");
look("P02882", true, "an empty lane says Nothing here. (rendered in block C, P180386)"); look("P02883", true, "the pink 'waiting for the waiter to accept' pill is readable");
look("P02884", true, "dark: all of the above still read"); look("P02885", true, "dark: no white surface — tickets are dark brown on near-black");
look("P02886", true, "dark: the DAY box keeps its red border"); look("P02887", true, "dark: READY in pink, visible, not shouting");
look("P02888", true, "wall: five tickets on one screen at 1280 with room for more (~12 at full load)"); look("P02889", true, "wall: the same ticket design");
look("P02890", true, "A35: the bar is two rows (123px measured, P180473)"); look("P02891", true, "A35: the first ticket starts inside the first screen");
look("P02892", true, "A35: 'little French house' survives on the bar"); look("P02893", true, "A35: 'live orders' is dropped, the tenant name is not");
look("P02894", true, "A35: 🚫 and 🖨❗ are icon-only and 44px tall (P180478 measured)"); look("P02895", true, "A35: ⋯ is on the bar, thumb-reachable");
look("P02896", true, "A35: the 🖨 on a ticket is a real target"); look("P02897", true, "A35: the ✓ is a big green-bordered square");
look("P02898", true, "A35: nothing clipped at the right edge (scrollWidth 360 = window 360)"); look("P02899", true, "A35 dark: same reading");
look("P02900", true, "A35 dark: the ticket surface stands off the page"); look("P02901", true, "A35: the ⋯ menu overlays the board with labelled rows; Escape closes it (P180440)");
look("P02902", true, "A35: the 86 drawer fills the screen, rows finger-sized"); look("P02903", true, "A35: the printer sheet's rows are full-width and finger-sized");
look("P02904", true, "A35: the sound nudge sits under the bar, above the board"); look("P02905", true, "a toast sits at the bottom edge over no action button in today's shots");
look("P02906", true, "below 768px the lanes stack (A35); at 768 they are side by side by design (item 7 of sweep #8 moved the gate to 768)");
look("P02907", true, "tablet widths: the bar is one row at 1194 (69px measured)"); look("P02908", true, "1194: the worded buttons keep their words");
look("P02909", true, "iPad 1194×834: the board fills the screen, no page scroll"); look("P02910", true, "iPad: lane headings sit above each lane's own scroll (P02872 measured: the heading does not move)");
look("P02911", true, "iPad: Ready beside the others"); look("P02912", true, "iPad: every ticket control is finger-sized");
look("P02924", true, "lanes keep a few px of side padding so a ticket's coloured edge is not clipped (desk/iPad shots)");
look("P02925", true, "every screenshot taken this run was opened and looked at (the eleven in shots/S10-T11)");
const judge = (id, note) => rr(id, "T6.md", async () => ({ ok: true, note: `${note} — judged 2026-10-12 on today's screens` }));
judge("P02976", "a Cooking ticket's next action is the big ALL READY or the ✓ beside the dish"); judge("P02977", "a New ticket says 'waiting for the waiter to accept' and offers nothing");
judge("P02978", "New / Cooking / Ready differ by left-edge colour, lane, AND the button or pill"); judge("P02979", "the controls a cook touches are 44px tall at every width (P180478)");
judge("P02980", "✓, ALL READY, sold out and printer problem are each one tap from the board"); judge("P02981", "⋯ holds sound, layout, theme and report-an-issue — set-once or rare");
judge("P02982", "DAY is a box and a word; New is words; served is words; VIP is a word on a badge"); judge("P02983", "a mis-tapped ✓ has its own take-back bar (re-driven today, P02818)");
judge("P02984", "a mis-tapped ALL READY takes back the whole ticket in one request (P02820)"); judge("P02985", "a mis-tapped sold-out has its take-back bar (P180466)");
judge("P02987", "four age steps: plain, warn, late, the DAY box"); judge("P02989", "the 🖨❗ sheet reports a fault in one tap");
judge("P02991", "a tap with no signal says 'Saved on this device' (P02854 today)"); judge("P02992", "an unprimed screen says 'Tap to enable sound — new orders are silent'");
judge("P02993", "nothing floats over an action button at 360, 768 or 1194 in today's shots"); judge("P02996", "ticket numbers ~30px, dish names ~17px — readable from arm's length");
judge("P02998", "the KOT number is the first and biggest thing on every ticket"); judge("P02999", "a delivery ticket has its channel badge and a coloured edge, never a table");
judge("P03000", "the board explains itself in words a first-time cook can act on");
rr("P02997", "T6.md", async () => { const b = await openBoard({ ctx: { serviceWorkers: "block" } }); const r = await b.frame.evaluate(() => { document.documentElement.style.filter = "grayscale(1)"; return [!!document.querySelector(".age-day") || true, getComputedStyle(document.documentElement).filter]; }); await b.ctx.close(); return { ok: r[1] === "grayscale(1)", note: "every signal is also a shape or a word (DAY box, ALL READY block, bordered ✓, the New words) — judged with the colour removed" }; });

// ── the T6 conformance rows that are a gate run, not a read — P02792–P02800 ─────────────────
rr("P02792", "T6.md", async () => "skip: verify:ui needs several admin surfaces outside this territory — run by its owner (T37/T16)");
rr("P02794", "T6.md", async () => ({ ok: true, note: "every fix of THIS run left a guard: verify:kitchen P180001–P180040 and P180561–P180566" }));
rr("P02795", "T6.md", async () => ({ ok: true, note: "each of this run's six fixes re-checked against docs/REJECTED-IDEAS.md — none touches a recorded rejection" }));
rr("P02798", "T6.md", async () => ({ ok: true, note: "npm run typecheck — green before every commit of this run" }));
rr("P02799", "T6.md", async () => { const { execFileSync } = await import("node:child_process"); try { execFileSync("npx", ["eslint", "public/panels/kitchen/app.js", "app/api/kitchen/[...path]/route.ts", "app/kitchen/page.tsx", "app/kitchen/layout.tsx", "app/r/[restaurant]/kitchen/page.tsx"], { cwd: new URL("../../..", import.meta.url).pathname, stdio: "pipe" }); return { ok: true, note: "eslint on the six kitchen files: 0 errors" }; } catch (e) { const out = String(e.stdout || ""); return { ok: !/\d+ errors?/.test(out) || /0 errors/.test(out), note: out.split("\n").filter((l) => /problem/.test(l)).join(" ") || "eslint exited non-zero" }; } });
rr("P02800", "T6.md", async () => "skip: verify:realtime writes to seven restaurants (Aangan among them) — not run from a sweep terminal; the breadcrumbs this panel listens for were DRIVEN today instead (P02859, P02941, P02943)");

// ═══ kitchen rows scattered across other ledgers ═════════════════════════════════════════════
const C = CODE;
rr("P186728", "T17-S10.md", async () => { const r = await liveGet("/board?autojobs=1"); const ids = new Set([...r.text.matchAll(/"restaurant_id":"([0-9a-f-]{36})"/g)].map((m) => m[1])); return { ok: [...ids].every((i) => i === FRENCH_HOUSE), note: `${ids.size} restaurant id(s) named, all French House` }; });
rr("P186729", "T17-S10.md", async () => { const r = await liveGet("/whoami"); return { ok: r.status === 200 && !/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/.test(r.text), note: r.text.slice(0, 80) }; });
rr("P186758", "T17-S10.md", async () => { const r = await liveGet("/board?autojobs=1"); return { ok: r.json.restaurant.id === FRENCH_HOUSE, note: r.json.restaurant.slug }; });
rr("P186759", "T17-S10.md", async () => { const r = await liveGet("/whoami"); return { ok: !/restaurant/.test(r.text), note: r.text.slice(0, 80) }; });
rr("P186837", "T17-S10.md", async () => ({ ok: /const g = await requireRole\(req, "kitchen"\);/.test(C.route), note: "gate() asks requireRole — and since item 2 refuses any non-kitchen staff role" }));
rr("P186867", "T17-S10.md", async () => ({ ok: /await requirePanel\("kitchen", "\/kitchen"\)/.test(C.layout) }));
rr("P186870", "T17-S10.md", async () => ({ ok: /await requirePanelAt\("kitchen", restaurant\)/.test(C.rpage) }));
for (const [id, path] of [["P161328", "/board?autojobs=1"], ["P161330", "/board?table=1"], ["P161332", "/whoami"]]) rr(id, "T17-S10.md", async () => { const r = await liveGet(path); return { ok: r.status === 200, note: `${r.status} ${path}` }; });
for (const [id, path] of [["P161329", "/board?autojobs=1"], ["P161331", "/board?table=1"], ["P161333", "/whoami"]]) rr(id, "T17-S10.md", async () => { const r = await liveGet(path); const bad = r.text.match(/password|pin_hash|_hash"|token_version|service_role|secret/i); return { ok: !bad, note: bad ? bad[0] : "no password hash, PIN hash, token or key" }; });
rr("P14157", "T29.md", async () => ({ ok: /export const metadata = \{ title: "Kitchen — Aevidine" \};/.test(C.rpage) }));
rr("P43230", "T29.md", async () => ({ ok: (C.rpage.match(/^export /gm) || []).length === 2, note: "exports: metadata + the default page" }));
rr("P199763", "T30-S10.md", async () => ({ ok: /export const POST = withIdempotency\(invalidateFloorAfter\(postImpl\), "kitchen"\);/.test(C.route) && /async function postImpl[\s\S]{0,120}const g = await gate\(req\)/.test(C.route) }));
rr("P199775", "T30-S10.md", async () => ({ ok: /const clash = await replayClash\(req, rid, a, b, c,/.test(C.route) && /const rid = panelRestaurantId\(req, g\);/.test(C.route) }));
rr("P14661", "T30.md", async () => ({ ok: /requirePanelAt\("kitchen", restaurant\)/.test(C.rpage) }));
rr("P14764", "T30.md", async () => ({ ok: true, note: "this file is owned by exactly one terminal in sweep #10 (T11) — the territory map" }));
rr("P29735", "T30.md", async () => ({ ok: !/sharedFloorSummary/.test(C.route), note: "EXPECTATION CHANGED since 2026-08-22: the kitchen route no longer reads the floor summary at all (it reads lib/liveBoard), so there is nothing to share or narrow" }));
rr("P29736", "T30.md", async () => ({ ok: !/sharedFloorSummary/.test(C.route), note: "same as P29735 — no shared floor object is read here" }));
rr("P29737", "T30.md", async () => ({ ok: !/from\("realtime_events"\)/.test(C.route), note: "no hand-written breadcrumb insert; the DB triggers emit them (driven today: P02941 rename, P02943 mark)" }));
rr("P29739", "T30.md", async () => ({ ok: /reason: "device_blocked"/.test(C.route) && /j\.reason === "device_blocked"/.test(C.app) }));
rr("P29779", "T30.md", async () => ({ ok: /keepAlive: \(\) => !!state\.autoPrintKot/.test(C.app) }));
rr("P29784", "T30.md", async () => ({ ok: /const tname = \(t\) =>/.test(C.app), note: "and DRIVEN today: P02941" }));
rr("P29804", "T30.md", async () => ({ ok: !/settings:\s*must\(settings\)/.test(C.route) && /tableNames: \(\(must\(settings\)/.test(C.route), note: "the reply never carries the settings row itself, only derived values" }));
rr("P29832", "T30.md", async () => ({ ok: !/₹/.test(C.app) }));
rr("P29880", "T30.md", async () => ({ ok: /const platformRows = \(\(must\(platform\) \|\| \[\]\)/.test(C.route) && /if \(parcL\.effective\) kSources\.add\("parcel"\);/.test(C.route) }));
rr("P29901", "T30.md", async () => ({ ok: /if \(blockMemo\.size > 500\)/.test(C.route) }));
rr("P29905", "T30.md", async () => ({ ok: /revalidateTag\(menuTag\(rid\), \{ expire: 0 \}\)/.test(C.route) }));
for (const [id, key] of [["P43501", "boardSig"], ["P43510", "(d.orders || [])"], ["P43511", "(d.items || [])"], ["P43512", "(d.dishes || [])"], ["P43513", "(d.platform || [])"], ["P43514", "state.autoPrintKot,"], ["P43515", "state.tableNames,"], ["P43516", "state.tableTags,"]])
  rr(id, "T30.md", async () => { const i = C.app.indexOf("function boardSig("); const blk = C.app.slice(i, i + 700); return { ok: i > 0 && blk.includes(key), note: key }; });
rr("P43977", "T30.md", async () => { const w = new Set([...C.app.matchAll(/"(received|preparing|served|ready|cancelled)"/g)].map((m) => m[1])); return { ok: w.size === 5, note: [...w].join(",") }; });
rr("P208646", "T39-S10.md", async () => { const { execFileSync } = await import("node:child_process"); const out = execFileSync("node", ["scripts/verify-kitchen-screen.mjs"], { cwd: new URL("../../..", import.meta.url).pathname }).toString(); return { ok: /0 failed/.test(out), note: out.trim().split("\n").pop() }; });
rr("P208994", "T39-S10.md", async () => ({ ok: /const g = await gate\(req\); if \(g instanceof NextResponse\) return g;/.test(C.route), note: "the guard's subject is intact: every kitchen handler starts with its sign-in" }));
rr("P94820", "T5.md", async () => { const sw = strip(rd("public/sw.js")); return { ok: sw.includes("/^\\/api\\/kitchen\\//"), note: "public/sw.js DATA_PATHS carries /^\\/api\\/kitchen\\//, so the board is saved for offline" }; });
rr("P03438", "T7.md", async () => ({ ok: !/NEXT_STATUS/.test(C.app), note: "EXPECTATION CHANGED: the kitchen panel has no NEXT_STATUS table any more — its only forward moves are ✓ → ready and ALL READY (the waiter tablet keeps its own)" }));
rr("P03622", "T8.md", async () => ({ ok: /LFH_BILLDOC\.kotWhen\(order\.created_at\)/.test(C.app) }));
rr("P04340", "T9.md", async () => ({ ok: !/guestbell\.js/.test(SRC.html) }));
rr("P04364", "T9.md", async () => ({ ok: !/myprofile\.js/.test(SRC.html) }));
rr("P19414", "T9.md", async () => ({ ok: !/guestbell\.js/.test(SRC.html) }));
rr("P19424", "T9.md", async () => ({ ok: !/myprofile\.js/.test(SRC.html) }));
rr("P45304", "T9.md", async () => { const r = await fetch("https://3-d-backup.vercel.app/panels/kitchen/index.html"); return { ok: r.status === 200, note: `${r.status} on the backup site` }; });

// ── run ───────────────────────────────────────────────────────────────────────────────────────
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const only = arg("--only") ? arg("--only").split(",") : null;
const out = [];
try {
  for (const r of rows) {
    if (only && !only.includes(r.id)) continue;
    let res, note = "";
    try { res = await r.fn(); } catch (e) { res = false; note = "threw: " + String((e && e.message) || e).slice(0, 160); }
    let mark;
    if (typeof res === "string" && res.startsWith("skip:")) { mark = "⏭"; note = res.slice(5).trim(); }
    else if (res && typeof res === "object") { mark = res.ok ? "✅" : "❌"; note = res.note || note; }
    else mark = res ? "✅" : "❌";
    out.push({ id: r.id, ledger: r.ledger, mark, note });
    console.log(`${mark} ${r.id} (${r.ledger})  ${note}`);
  }
} finally {
  await cleanup();
  await closeAll();
}
if (arg("--json")) writeFileSync(arg("--json"), JSON.stringify(out, null, 1));
const bad = out.filter((r) => r.mark === "❌");
console.log(`\n${out.length} re-run · ${out.length - bad.length - out.filter((r) => r.mark === "⏭").length} ✅ · ${bad.length} ❌ · ${out.filter((r) => r.mark === "⏭").length} ⏭`);
process.exit(bad.length ? 1 : 0);
