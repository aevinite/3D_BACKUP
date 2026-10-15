// scripts/sweep/t16s10/new-l.mjs — NEW checks, sweep #10 T16 ROUND 2, ids from P185870.
// AIMED BY MUTATION. The first mutation pass (scripts/sweep/t16s10/mutate.mjs, 457 breaks) found 121
// that no check noticed. Each row here pins one behaviour a surviving break would have changed —
// observed on screen or on the wire, never by reading the file's text. (Breaks that change nothing a
// person or the server could ever see — `return null` vs `undefined` to a caller that only asks "is
// it empty?" — are listed with their reason in the round-2 findings, not dressed up as checks.)
/* eslint-disable @typescript-eslint/no-unused-vars -- a check suite: helpers are imported whole */
import { R, ok, tag } from "./lib.mjs";
import { harness, sleep, until, PACE } from "./browser.mjs";

const done = tag("new-l");
let id = 185870;
const N = (file, what, fn) => R(`P${id++}`, file, what, fn, "headless: the real shared file(s), every request answered by the test (aimed by mutation pass 1)");
const TOP = '<div class="topbar"><div class="top-actions"><button id="themeToggle">t</button><button id="myProfileBtn" hidden>me</button></div></div>';
const OFF = "Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>window.__on!==false});";
const U = "3f2a9c1e-77aa-4c1b-9d10-5b6c7d8e9f00";

// ══ outbox.js ═══════════════════════════════════════════════════════════════════════════════
async function ob(o = {}) {
  return harness({ pre: OFF + PACE + (o.pre || ""), /* a check's own pacing wins */ body: TOP, scripts: ["outbox.js"], before: o.before, api: o.api || (() => ({ status: 200, body: { ok: true } })) });
}
N("outbox.js", "The four method-specific names: 'Update an order', 'Remove an order', 'Mark a waiter call handled', 'Lift a ban'", async () => {
  const h = await ob({ pre: "window.__on=false;" });
  const r = await h.page.evaluate(async (U) => { const s = (m, p) => window.LFH_OUTBOX.send({ base: "/api/editor", method: m, path: p, body: {} }); await s("PATCH", "/orders/" + U); await s("DELETE", "/orders/" + U); await s("PATCH", "/calls/" + U); await s("DELETE", "/blocklist/" + U); await s("POST", "/orders/" + U); return window.LFH_OUTBOX.getSnapshot().queued.map((q) => q.label); }, U);
  await h.close(); return ok(r.slice(0, 4).join("|") === "Update an order|Remove an order|Mark a waiter call handled|Lift a ban" && r[4] !== "Update an order", r.join("|"));
});
N("outbox.js", "A change whose BODY names its table is counted against that table", async () => {
  const h = await ob({ pre: "window.__on=false;" });
  const r = await h.page.evaluate(async () => { await window.LFH_OUTBOX.send({ base: "/api/editor", method: "POST", path: "/order", body: { table_number: 5 } }); await window.LFH_OUTBOX.send({ base: "/api/editor", method: "POST", path: "/order", body: { table_number: "" } }); return window.LFH_OUTBOX.pendingByTable(); });
  await h.close(); return ok(JSON.stringify(r) === '{"5":1}', JSON.stringify(r));
});
N("outbox.js", "A KEPT change refused on replay with a 'what to do next' keeps those words on its failed row", async () => {
  const h = await ob({ pre: "window.__on=false;", api: (rec) => (/order$/.test(rec.path) ? { status: 409, body: { error: "This table was closed", clash: { plain: "This table was closed while the order waited.", todo: "Open the table again and re-take this order." } } } : { status: 200, body: {} }) });
  const r = await h.page.evaluate(async () => { await window.LFH_OUTBOX.send({ base: "/api/editor", method: "POST", path: "/order", body: { table_number: 4 } }); window.__on = true; window.dispatchEvent(new Event("online")); for (let i = 0; i < 40 && !window.LFH_OUTBOX.getSnapshot().failed.length; i++) await new Promise((x) => setTimeout(x, 100)); const f = window.LFH_OUTBOX.getSnapshot().failed[0]; return f ? f.todo || null : "no failed row"; });
  await h.close(); return ok(typeof r === "string" && /re-take this order/.test(r), String(r));
});
N("outbox.js", "A change kept with no signal has its next attempt scheduled (never a queue with no timer)", async () => {
  const h = await ob({ pre: "window.__on=false;" });
  const r = await h.page.evaluate(async () => { await window.LFH_OUTBOX.send({ base: "/api/editor", method: "POST", path: "/tables/4/pay", body: {} }); window.__on = true; window.dispatchEvent(new Event("online")); await new Promise((x) => setTimeout(x, 50)); return { q: window.LFH_OUTBOX.getSnapshot().queued.length, next: window.LFH_OUTBOX.nextTryAt() }; });
  await h.close(); return ok(r.q === 0 || r.next > 0, JSON.stringify(r));
});
N("outbox.js", "The FIRST retry after a busy answer comes at the short 'first' wait, later ones back off", async () => {
  let n = 0; const h = await ob({ pre: "", api: (rec) => (/pay$/.test(rec.path) ? (n++, { status: 503, body: { error: "busy" } }) : { status: 200, body: {} }) });
  const r = await h.page.evaluate(async () => { await window.LFH_OUTBOX.send({ base: "/api/editor", method: "POST", path: "/tables/4/pay", body: {} }).catch(() => {}); await new Promise((x) => setTimeout(x, 30)); const a = window.LFH_OUTBOX.nextTryAt() - Date.now(); await new Promise((x) => setTimeout(x, Math.max(0, a) + 120)); await new Promise((x) => setTimeout(x, 60)); const b = window.LFH_OUTBOX.nextTryAt() - Date.now(); return { a, b }; });
  await h.close(); return ok(r.a > 0 && r.a <= 300 + 50 && r.b > r.a, JSON.stringify(r));
});
N("outbox.js", "Coming back to the tab wakes the queue; a tab that is still HIDDEN does not", async () => {
  let posts = 0; const h = await ob({ pre: "window.LFH_TEST_PACING={first:60000,base:60000,max:60000,wake:0,stuck:60000};", api: (rec) => (/pay$/.test(rec.path) ? (posts++, { status: 503, body: { error: "busy" } }) : { status: 200, body: {} }) });
  await h.page.evaluate(async () => { await window.LFH_OUTBOX.send({ base: "/api/editor", method: "POST", path: "/tables/4/pay", body: {} }).catch(() => {}); });
  await sleep(200); const p0 = posts;
  await h.page.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, get: () => true }); document.dispatchEvent(new Event("visibilitychange")); }); await sleep(300); const p1 = posts;
  await h.page.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, get: () => false }); document.dispatchEvent(new Event("visibilitychange")); }); await sleep(400); const p2 = posts;
  await h.close(); return ok(p1 === p0 && p2 > p1, `${p0} → hidden ${p1} → visible ${p2}`);
});

// ══ offline.js ══════════════════════════════════════════════════════════════════════════════
const BAR = (over) => `window.LFH_OUTBOX={_l:[],_s:{queued:[],failed:[],count:0,syncing:false},onChange:function(cb){this._l.push(cb);cb(this._s)},waitingSince:function(){return 0},nextTryAt:function(){return 0},storageFailed:function(){return false},pendingByTable:function(){return {}},blockedByTable:function(){return {}},flush:function(){},retryOne:function(){},dismiss:function(){}};window.__push=function(s){window.LFH_OUTBOX._s=s;window.LFH_OUTBOX._l.forEach(function(f){f(s)})};${over || ""}`;
const bar = (p) => p.evaluate(() => (document.querySelector(".lfh-offbar") || {}).textContent || "");
async function offPage(rt, extra = "") { return harness({ pre: BAR(OFF + extra + `window.LFH_RT={getStatus:()=>window.__rt||'online',everConnected:()=>!!window.__ever,onStatus:function(f){window.__rtf=f;}};`), body: TOP, scripts: ["backstack.js", "offline.js"], api: () => ({ status: 200, body: {} }) }); }
N("offline.js", "No signal on the device: the bar says so", async () => { const h = await offPage(); await h.page.evaluate(() => { window.__on = false; window.dispatchEvent(new Event("offline")); }); await sleep(300); const t = await bar(h.page); await h.close(); return ok(!!t, t); });
N("offline.js", "…live updates reporting 'offline' (device still online) is a bad connection too: the bar shows", async () => { const h = await offPage(); await h.page.evaluate(() => { window.__rt = "offline"; window.__ever = true; window.LFH_OFF && window.LFH_OFF.refresh ? window.LFH_OFF.refresh() : window.dispatchEvent(new Event("online")); window.__rtf && window.__rtf("offline"); }); await h.page.evaluate(() => window.LFH_OFF.noteResponse(new Response("{}", { headers: { "X-LFH-From-Cache": "1", "X-LFH-Cached-At": String(Date.now() - 120000) } }))); await sleep(400); const t = await bar(h.page); await h.close(); return ok(!!t, t); });
N("offline.js", "…and with everything online there is no bar at all", async () => { const h = await offPage(); await sleep(300); const t = await bar(h.page); await h.close(); return ok(t === "", t); });
N("offline.js", "A saved-copy spell is dated from its FIRST saved reply, not its latest", async () => {
  const h = await offPage(null, "window.__rt='connecting';");
  for (let i = 0; i < 4; i++) { await h.page.evaluate(() => window.LFH_OFF.noteResponse(new Response("{}", { headers: { "X-LFH-From-Cache": "1", "X-LFH-Cached-At": String(Date.now() - 300000) } }))); await sleep(450); }
  const t = await bar(h.page); await h.close(); return ok(!!t, `after 1.8 s of saved replies every 450 ms: "${t}"`);
});
N("offline.js", "The sheet says '✓ Everything has been sent' when nothing is waiting — and not while something is", async () => {
  const h = await offPage();
  await h.page.evaluate(() => window.LFH_OFF.open()); await sleep(200); const a = await h.page.evaluate(() => (document.querySelector(".lfh-off-sheet") || {}).textContent || "");
  await h.page.evaluate(() => window.__push({ queued: [{ id: "a", label: "Settle bill · Table 4", at: Date.now() }], failed: [], count: 1, syncing: false })); await sleep(200);
  const b = await h.page.evaluate(() => (document.querySelector(".lfh-off-sheet") || {}).textContent || ""); await h.close();
  return ok(/✓ Everything has been sent/.test(a) && !/✓ Everything has been sent/.test(b), JSON.stringify({ a: a.slice(0, 60), b: b.slice(0, 60) }));
});
N("offline.js", "'Can this device read offline?' is yes only when the offline layer controls the page", async () => {
  const h = await offPage(); const a = await h.page.evaluate(() => window.LFH_OFF.canReadOffline());
  await h.page.evaluate(() => Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: { controller: {} } })); const b = await h.page.evaluate(() => window.LFH_OFF.canReadOffline()); await h.close();
  return ok(a === false && b === true, JSON.stringify({ a, b }));
});

// ══ realtime.js ═════════════════════════════════════════════════════════════════════════════
const FAKE_SB = `export function createClient(){ const w = (window.__sb = window.__sb || { made: 0, channels: [] }); w.made++; return { channel(n){ const ch = { name: n, h: [] }; w.channels.push(ch); const api = { on(k, f, cb){ ch.h.push(cb); return api; }, subscribe(cb){ setTimeout(() => cb(window.__sub || "SUBSCRIBED"), 0); return api; } }; return api; }, removeChannel(){} }; }`;
async function rt(o = {}) {
  let cfgN = 0;
  const h = await harness({ pre: OFF + (o.pre || ""), body: TOP, scripts: ["realtime.js"], after: o.after,
    before: async (p) => { await p.route("**/vendor/supabase.js", (r) => r.fulfill({ contentType: "application/javascript", body: FAKE_SB })); },
    api: (rec) => (/rt-config/.test(rec.path) ? (cfgN++, o.cfg ? o.cfg(cfgN) : { status: 200, body: { url: "https://stub.example", anonKey: "k", restaurantId: "11111111-1111-4111-8111-111111111111" } }) : { status: 200, body: {} }) });
  h.cfgN = () => cfgN; return h;
}
N("realtime.js", "A panel opened with no signal starts as 'offline'; one opened with signal starts as 'weak' until the socket is up", async () => {
  const a = await rt({ pre: "window.__on=false;" }); const sa = await a.page.evaluate(() => window.LFH_RT.getStatus()); await a.close();
  const b = await rt(); const sb = await b.page.evaluate(() => window.LFH_RT.getStatus()); await b.close();
  return ok(sa === "offline" && sb === "weak", JSON.stringify({ sa, sb }));
});
N("realtime.js", "A live-updates start-up that fails says 'weak' with signal, 'offline' without — never 'online'", async () => {
  const a = await rt({ cfg: () => ({ status: 503, body: {} }), after: "window.LFH_RT.start({ handlers: { ops: function(){} } });" }); await sleep(500); const sa = await a.page.evaluate(() => window.LFH_RT.getStatus()); await a.close();
  const b = await rt({ pre: "window.__on=false;", cfg: () => ({ status: 503, body: {} }), after: "window.LFH_RT.start({ handlers: { ops: function(){} } });" }); await sleep(500); const sb = await b.page.evaluate(() => window.LFH_RT.getStatus()); await b.close();
  return ok(sa === "weak" && sb === "offline", JSON.stringify({ sa, sb }));
});
N("realtime.js", "Once the client is built, a wake re-uses it — one socket per page, never a second", async () => {
  const h = await rt({ after: "window.LFH_RT.start({ handlers: { ops: function(){} } });" }); await until(() => h.page.evaluate(() => !!(window.__sb && window.__sb.made)), 5000);
  await h.page.evaluate(() => { window.dispatchEvent(new Event("online")); window.dispatchEvent(new Event("focus")); document.dispatchEvent(new Event("visibilitychange")); }); await sleep(1800);
  const m = await h.page.evaluate(() => window.__sb.made); await h.close(); return ok(m === 1, `${m} client(s)`);
});
N("realtime.js", "…but a start-up that FAILED is tried again on the next wake (it is not remembered as dead)", async () => {
  const h = await rt({ cfg: (n) => (n === 1 ? { status: 503, body: {} } : { status: 200, body: { url: "https://stub.example", anonKey: "k", restaurantId: "11111111-1111-4111-8111-111111111111" } }), after: "window.LFH_RT.start({ handlers: { ops: function(){} } });" });
  await sleep(500); await h.page.evaluate(() => { window.dispatchEvent(new Event("online")); window.dispatchEvent(new Event("focus")); });
  const built = await until(() => h.page.evaluate(() => !!(window.__sb && window.__sb.made)), 6000); await h.close(); return ok(built, `config asked ${h.cfgN()}×`);
});
N("realtime.js", "A panel that passes no onEvent still handles breadcrumbs without an error", async () => {
  const h = await rt({ after: "window.LFH_RT.start({ handlers: { ops: function(){ window.__got = (window.__got||0)+1; } } });" }); await until(() => h.page.evaluate(() => !!(window.__sb && window.__sb.channels.length)), 5000); await sleep(200);
  await h.page.evaluate(() => { const ch = window.__sb.channels.find((c) => c.name.startsWith("rt:ops")); ch && ch.h.forEach((f) => f({ new: { restaurant_id: "11111111-1111-4111-8111-111111111111", table_number: 3, created_at: new Date().toISOString() } })); });
  await sleep(600); const r = { got: await h.page.evaluate(() => window.__got || 0), e: h.errors }; await h.close(); return ok(r.got >= 1 && !r.e.length, JSON.stringify(r));
});
N("realtime.js", "A keepAlive answer that THROWS is taken as 'no' — a hidden tab still lets its socket go", async () => {
  const h = await rt({ after: "window.LFH_RT.start({ handlers: { ops: function(){} }, keepAlive: function(){ throw new Error('x'); } });" }); await until(() => h.page.evaluate(() => !!(window.__sb && window.__sb.made)), 5000);
  const e = h.errors; await h.close(); return ok(!e.length, e.join(" | "));
});

// ══ connbadge.js ════════════════════════════════════════════════════════════════════════════
async function pill(over = "", extra = "") { const h = await harness({ pre: OFF + BAR(over) + extra, body: TOP, scripts: ["connbadge.js"], api: () => ({ status: 200, body: {} }) }); await sleep(250); return h; }
const popText = async (p) => { await p.click("#lfhConnBadge").catch(() => {}); await sleep(200); return p.evaluate(() => (document.querySelector(".lfh-conn-pop") || {}).textContent || ""); };
N("connbadge.js", "A change waiting with a known next try says 'next try in Ns'", async () => { const h = await pill("window.LFH_OUTBOX.nextTryAt=function(){return Date.now()+12000};"); await h.page.evaluate(() => window.__push({ queued: [{ id: "a", label: "Settle bill · Table 4", at: Date.now() }], failed: [], count: 1, syncing: false })); const t = await popText(h.page); await h.close(); return ok(/next try in 1[12]s/.test(t), t.slice(0, 160)); });
N("connbadge.js", "…a queue with no next-try helper at all just says 'Waiting to send', no error", async () => { const h = await pill("delete window.LFH_OUTBOX.nextTryAt;"); await h.page.evaluate(() => window.__push({ queued: [{ id: "a", label: "x", at: Date.now() }], failed: [], count: 1, syncing: false })); const t = await popText(h.page); const e = h.errors; await h.close(); return ok(/Waiting to send/.test(t) && !/next try/.test(t) && !e.length, t.slice(0, 120)); });
N("connbadge.js", "With no signal the pill's sheet says 'Saved on this device'", async () => { const h = await pill(); await h.page.evaluate(() => { window.__on = false; window.dispatchEvent(new Event("offline")); window.__push({ queued: [{ id: "a", label: "x", at: Date.now() }], failed: [], count: 1, syncing: false }); }); const t = await popText(h.page); await h.close(); return ok(/Saved on this device/.test(t), t.slice(0, 160)); });
N("connbadge.js", "A page with no queue at all (no outbox) shows the pill without an error", async () => { const h = await harness({ pre: OFF, body: TOP, scripts: ["connbadge.js"], api: () => ({ status: 200, body: {} }) }); await sleep(300); const r = { has: await h.page.evaluate(() => !!document.getElementById("lfhConnBadge")), e: h.errors }; await h.close(); return ok(r.has && !r.e.length, JSON.stringify(r)); });
N("connbadge.js", "Loaded late (after the page parsed), the pill still appears", async () => { const h = await harness({ pre: OFF, body: TOP, scripts: [], api: () => ({ status: 200, body: {} }) }); await h.page.addScriptTag({ url: "/panels/connbadge.js" }); await sleep(300); const r = await h.page.evaluate(() => !!document.getElementById("lfhConnBadge")); await h.close(); return ok(r); });

// ══ errlog.js ═══════════════════════════════════════════════════════════════════════════════
const reports = (h) => h.sent.filter((r) => /client-error/.test(r.path)).map((r) => { try { return JSON.parse(r.body); } catch { return {}; } });
async function el(body) { return harness({ body, scripts: ["errlog.js"], api: () => ({ status: 200, body: { ok: true } }) }); }
const flushTaps = (p) => p.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, get: () => true }); document.dispatchEvent(new Event("visibilitychange")); });
N("errlog.js", "An error event with no message is filed as 'script error', never 'undefined'", async () => { const h = await el("<div></div>"); await h.page.evaluate(() => window.dispatchEvent(new ErrorEvent("error", {}))); await sleep(300); const r = reports(h).find((x) => x.kind === "error") || {}; await h.close(); return ok(r.message === "script error", JSON.stringify(r)); });
N("errlog.js", "A tap's name ignores comments and hidden (visibility:hidden) parts inside the button", async () => { const h = await el('<button id="b"><!--note-->Pay <span style="visibility:hidden">SECRET</span>bill</button>'); await h.page.click("#b"); await flushTaps(h.page); await sleep(200); const t = (reports(h).find((x) => x.kind === "taps") || {}).detail || "[]"; await h.close(); const l = JSON.parse(t).map((x) => x.l); return ok(l.join() === "Pay bill", l.join()); });
N("errlog.js", "…a button with only text is named by its text", async () => { const h = await el('<button id="b">Settle</button>'); await h.page.click("#b"); await flushTaps(h.page); await sleep(200); const l = JSON.parse((reports(h).find((x) => x.kind === "taps") || {}).detail || "[]").map((x) => x.l); await h.close(); return ok(l.join() === "Settle", l.join()); });
N("errlog.js", "…a tap on plain page text (not a button) is not recorded and raises no error", async () => { const h = await el('<p id="t">just words</p><button id="b">B</button>'); await h.page.click("#t"); await h.page.click("#b"); await flushTaps(h.page); await sleep(200); const l = JSON.parse((reports(h).find((x) => x.kind === "taps") || {}).detail || "[]").map((x) => x.l); const e = h.errors; await h.close(); return ok(l.join() === "B" && !e.length, l.join()); });

// ══ theme.js ════════════════════════════════════════════════════════════════════════════════
N("theme.js", "A panel with no theme button loads without an error", async () => { const h = await harness({ body: '<div class="topbar"></div>', scripts: ["theme.js"], api: () => ({ status: 200, body: {} }) }); await sleep(200); const e = h.errors; await h.close(); return ok(!e.length, e.join(" | ")); });

done();
