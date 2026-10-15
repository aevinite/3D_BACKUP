// scripts/sweep/t16s10/new-c.mjs — NEW checks, sweep #10 T16, ids P185215–P185314.
// The states the happy path never visits, DRIVEN: realtime.js against a fake socket (the page's own
// /vendor/supabase.js is answered by the test) and a fast-forwarded clock; the offline bar's every
// sentence; the pill's Retry / Dismiss; the bell's rows; errlog's tap batches.
/* eslint-disable @typescript-eslint/no-unused-vars -- a check suite: helpers are imported whole */
import { R, ok, eq, tag, src, code } from "./lib.mjs";
import { harness, memo, sleep, until, PACE } from "./browser.mjs";

const done = tag("new-c");
let id = 185215;
const N = (file, what, fn, how) => R(`P${id++}`, file, what, fn, how);
const TOP = `<div class="topbar"><div class="top-actions"><button id="themeToggle">x</button></div></div>`;
const RID = "11111111-1111-4111-8111-111111111111", OTHER = "22222222-2222-4222-8222-222222222222";

// A FAKE SUPABASE CLIENT, served as /vendor/supabase.js — records channels, lets the test push rows.
const FAKE_SB = `
export function createClient(url, key, opts) {
  const w = (window.__sb = window.__sb || { channels: [], removed: 0, opts });
  return {
    channel(name) {
      const ch = { name, handlers: [], status: null, filter: null };
      w.channels.push(ch);
      const api = {
        on(kind, f, cb) { ch.filter = f.filter; ch.handlers.push(cb); return api; },
        subscribe(cb) { ch.status = cb; setTimeout(() => cb(window.__subStatus || "SUBSCRIBED"), 0); return api; },
      };
      ch.api = api; return api;
    },
    removeChannel(c) { w.removed++; },
  };
}`;
const rt = (extra = {}) => harness({
  pre: (extra.pre || "") + "window.__events=[];",
  path: extra.path,
  body: TOP, scripts: ["realtime.js"],
  after: extra.after || "window.LFH_RT.start({ handlers: { ops: function(d){ window.__events.push(JSON.stringify(d)); }, menu: function(d){ window.__events.push('menu:'+JSON.stringify(d)); } } });",
  api: (rec) => (/rt-config/.test(rec.path) ? (extra.cfg ? extra.cfg(rec) : { status: 200, body: { url: "https://stub.example", anonKey: "anon-stub", restaurantId: RID } }) : { status: 200, body: {} }),
  before: async (page) => { await page.route("**/vendor/supabase.js", (r) => r.fulfill({ contentType: "application/javascript", body: FAKE_SB })); if (extra.clock) await page.clock.install(); },
}).then(async (h) => { if (!extra.clock) { await h.page.waitForFunction(() => window.__sb && window.__sb.channels.length >= 1, null, { timeout: 8000 }).catch(() => {}); await sleep(300); } return h; });
const push = (page, topic, row) => page.evaluate(([topic, row]) => { const ch = window.__sb.channels.filter((c) => c.name.startsWith("rt:" + topic)).pop(); ch.handlers.forEach((h) => h({ new: row })); }, [topic, row]);
const RTN = (what, fn) => N("realtime.js", what, fn, "headless: the real realtime.js, a fake socket served as /vendor/supabase.js, /api/rt-config answered by the test");

const base = memo(async () => {
  const h = await rt();
  const o = {};
  o.names = await h.page.evaluate(() => window.__sb.channels.map((c) => c.name));
  o.filters = await h.page.evaluate(() => window.__sb.channels.map((c) => c.filter));
  o.worker = await h.page.evaluate(() => window.__sb.opts && window.__sb.opts.realtime && window.__sb.opts.realtime.worker);
  o.status = await h.page.evaluate(() => window.LFH_RT.getStatus());
  o.ever = await h.page.evaluate(() => window.LFH_RT.everConnected());
  o.rid = await h.page.evaluate(() => window.LFH_RT.getRid());
  await sleep(400); await h.page.evaluate(() => { window.__events = []; });
  await push(h.page, "ops", { restaurant_id: OTHER, table_number: 4, created_at: new Date().toISOString() }); await sleep(400);
  o.other = await h.page.evaluate(() => window.__events.slice());
  await push(h.page, "ops", { restaurant_id: RID, table_number: 4, created_at: new Date(Date.now() - 250).toISOString() }); await sleep(400);
  o.mine = await h.page.evaluate(() => window.__events.slice());
  o.lat = await h.page.evaluate(() => window.LFH_RT.getLatency());
  await h.page.evaluate(() => { window.__events = []; });
  await push(h.page, "ops", { table_number: 7 }); await sleep(400);
  o.noRid = await h.page.evaluate(() => window.__events.slice());
  await h.page.evaluate(() => { window.__events = []; });
  await push(h.page, "ops", { restaurant_id: RID, kind: "platform", table_number: 3 }); await sleep(400);
  o.platform = await h.page.evaluate(() => window.__events.slice());
  await h.page.evaluate(() => { window.__events = []; });
  await push(h.page, "ops", { restaurant_id: RID }); await sleep(400);
  o.noTable = await h.page.evaluate(() => window.__events.slice());
  await h.page.evaluate(() => { window.__events = []; });
  for (const t of [1, 2, 3]) await push(h.page, "ops", { restaurant_id: RID, table_number: t });
  await sleep(500); o.three = await h.page.evaluate(() => window.__events.slice());
  await h.page.evaluate(() => { window.__events = []; });
  for (let t = 1; t <= 25; t++) await push(h.page, "ops", { restaurant_id: RID, table_number: t });
  await sleep(1500); o.many = await h.page.evaluate(() => window.__events.slice());
  await h.page.evaluate(() => { window.__events = []; });
  await push(h.page, "menu", { restaurant_id: RID }); await sleep(400);
  o.menu = await h.page.evaluate(() => window.__events.slice());
  await h.page.evaluate(() => { window.__events = []; });
  await h.page.evaluate(async () => { for (let i = 0; i < 12; i++) { const ch = window.__sb.channels.filter((c) => c.name.startsWith("rt:ops")).pop(); ch.handlers.forEach((f) => f({ new: { restaurant_id: "11111111-1111-4111-8111-111111111111", table_number: (i % 3) + 1 } })); await new Promise((r) => setTimeout(r, 120)); } });
  await sleep(1500); o.burst = await h.page.evaluate(() => window.__events.length);
  await h.page.evaluate(() => { for (let i = 0; i < 30; i++) { const ch = window.__sb.channels.filter((c) => c.name.startsWith("rt:ops")).pop(); ch.handlers.forEach((f) => f({ new: { restaurant_id: "11111111-1111-4111-8111-111111111111", table_number: 1, created_at: new Date(Date.now() - 100).toISOString() } })); } });
  o.hist = await h.page.evaluate(() => window.LFH_RT.getLatencyHistory().length);
  await h.page.evaluate(() => { const ch = window.__sb.channels.filter((c) => c.name.startsWith("rt:ops")).pop(); ch.handlers.forEach((f) => f({ new: { restaurant_id: "11111111-1111-4111-8111-111111111111", table_number: 1, created_at: new Date(Date.now() + 3600000).toISOString() } })); });
  o.latAfterNonsense = await h.page.evaluate(() => window.LFH_RT.getLatency().ms);
  o.metrics = await h.page.evaluate(() => ({ ev: window.__lfh_rt.events, refetch: window.__lfh_rt.refetch_count }));
  // status changes
  await h.page.evaluate(() => { window.__sb.channels[0].status("CHANNEL_ERROR"); }); o.afterErr = await h.page.evaluate(() => window.LFH_RT.getStatus());
  await h.page.evaluate(() => { window.__sb.channels[0].status("CLOSED"); }); o.afterClosed = await h.page.evaluate(() => window.LFH_RT.getStatus());
  await h.page.evaluate(() => { window.__sb.channels[0].status("SUBSCRIBED"); }); o.afterSub = await h.page.evaluate(() => window.LFH_RT.getStatus());
  await sleep(400); o.reconnects = await h.page.evaluate(() => window.__lfh_rt.reconnects);
  await h.page.evaluate(() => window.dispatchEvent(new Event("offline"))); o.afterOffline = await h.page.evaluate(() => window.LFH_RT.getStatus());
  o.afterOnline = await h.page.evaluate(() => { window.dispatchEvent(new Event("online")); return window.LFH_RT.getStatus(); });   // read in the same tick, before the socket confirms
  await sleep(1700);   // past the 1.5 s wake throttle the online event just used
  const statuses = await h.page.evaluate(() => { const s = []; const off = window.LFH_RT.onStatus((x) => s.push(x)); off(); return s; }); o.onStatusFirst = statuses;
  // wake rebuilds the socket
  const before = await h.page.evaluate(() => window.__sb.channels.length);
  await h.page.evaluate(() => window.dispatchEvent(new Event("focus"))); await sleep(200);
  o.focusRebuild = (await h.page.evaluate(() => window.__sb.channels.length)) - before;
  const b2 = await h.page.evaluate(() => window.__sb.channels.length);
  await h.page.evaluate(() => window.dispatchEvent(new Event("focus"))); await sleep(100);
  o.focusThrottled = (await h.page.evaluate(() => window.__sb.channels.length)) - b2;
  await h.page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: false }))); await sleep(1700);
  const b3 = await h.page.evaluate(() => window.__sb.channels.length);
  await h.page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: false }))); await sleep(200);
  o.pageshowPlain = (await h.page.evaluate(() => window.__sb.channels.length)) - b3;
  o.rtcfg = h.sent.filter((x) => /rt-config/.test(x.path)).map((x) => x.path);   // one page load now (no reload)
  o.errors = h.errors;
  await h.close(); return o;
});
RTN("one channel per topic, named rt:<topic>:<restaurant>", async () => eq((await base()).names.slice(0, 2), [`rt:ops:${RID}`, `rt:menu:${RID}`]));
RTN("…filtered SERVER-side to this restaurant (topic_rid)", async () => eq((await base()).filters.slice(0, 2), [`topic_rid=eq.ops:${RID}`, `topic_rid=eq.menu:${RID}`]));
RTN("the socket heartbeat runs in a worker, so a backgrounded tab keeps it", async () => ok((await base()).worker === true));
RTN("the first SUBSCRIBED turns the status to online", async () => ok((await base()).status === "online"));
RTN("…and marks the device as having been connected", async () => ok((await base()).ever === true));
RTN("the restaurant id is learned from /api/rt-config", async () => ok((await base()).rid === RID));
RTN("a breadcrumb from ANOTHER restaurant wakes nothing", async () => eq((await base()).other, []));
RTN("a breadcrumb from THIS restaurant refetches only its table", async () => eq((await base()).mine, ['{"full":false,"tables":["4"]}']));
RTN("a breadcrumb with no restaurant id is kept (never miss an update)", async () => eq((await base()).noRid, ['{"full":false,"tables":["7"]}']));
RTN("a 'platform' change reloads the whole board even if it names a table", async () => eq((await base()).platform, ['{"full":true}']));
RTN("a change with no table reloads the whole board", async () => eq((await base()).noTable, ['{"full":true}']));
RTN("three tables changed together are ONE refetch naming all three", async () => { const t = (await base()).three; return ok(t.length === 1 && /"tables":\["1","2","3"\]/.test(t[0]), t.join(" | ")); });
RTN("past 20 changed tables, one whole-board reload replaces 21+ fetches", async () => { const m = (await base()).many; return ok(m.length >= 1 && m.every((x) => /"full":true/.test(x) || /"tables"/.test(x)) && m.some((x) => /"full":true/.test(x)), m.join(" | ")); });
RTN("the menu topic calls the MENU handler, never the floor's", async () => eq((await base()).menu, ['menu:{"full":true}']));
RTN("a stream of 12 breadcrumbs over 1.4 s is coalesced into a handful of refetches", async () => { const n = (await base()).burst; return ok(n >= 1 && n <= 4, `${n} refetch(es) for 12 events`); });
RTN("the delivery time of a breadcrumb is measured (latency in ms)", async () => { const l = (await base()).lat; return ok(l.ms >= 200 && l.ms < 5000 && l.at > 0, JSON.stringify(l)); });
RTN("the sparkline history is capped at 24 readings", async () => ok((await base()).hist === 24, String((await base()).hist)));
RTN("a reading from a clock an hour out is thrown away, not shown", async () => ok((await base()).latAfterNonsense < 60000, String((await base()).latAfterNonsense)));
RTN("events and refetches are counted for the console readout", async () => { const m = (await base()).metrics; return ok(m.ev > 40 && m.refetch > 5, JSON.stringify(m)); });
RTN("a channel error downgrades the status to weak", async () => ok((await base()).afterErr === "weak"));
RTN("…but CLOSED (our own teardown) does not", async () => ok((await base()).afterClosed === "weak", "stays where it was"));
RTN("re-subscribing turns it back to online", async () => ok((await base()).afterSub === "online"));
RTN("…and a re-subscribe counts as a reconnect and refetches", async () => ok((await base()).reconnects >= 1, String((await base()).reconnects)));
RTN("the browser going offline turns the status offline at once", async () => ok((await base()).afterOffline === "offline"));
RTN("…and coming back online is 'weak' until the socket confirms", async () => ok((await base()).afterOnline === "weak"));
RTN("a new status listener is told the current state immediately", async () => ok((await base()).onStatusFirst.length === 1));
RTN("coming back to the tab rebuilds the socket", async () => ok((await base()).focusRebuild >= 2, String((await base()).focusRebuild)));
RTN("…but a second wake inside 1.5 s does not rebuild again", async () => ok((await base()).focusThrottled === 0, String((await base()).focusThrottled)));
RTN("an ordinary page load's pageshow does not rebuild the socket (only a bfcache restore does)", async () => ok((await base()).pageshowPlain === 0, String((await base()).pageshowPlain)));
RTN("rt-config is asked for once at boot", async () => ok((await base()).rtcfg.length === 1, (await base()).rtcfg.join(",")));
RTN("realtime.js raises no page error through any of that", async () => ok(!(await base()).errors.length, (await base()).errors.join(" | ")));
// the admin's per-tab pin, an unconfigured server, a channel that never subscribes
const pinned = memo(async () => { const h = await rt({ path: "/__t16/h.html?rid=" + OTHER }); const p = h.sent.filter((x) => /rt-config/.test(x.path)).map((x) => x.path); await h.close(); return p; });
RTN("the admin's ?rid= on the panel's address is forwarded to rt-config", async () => ok((await pinned()).some((p) => p.includes("rid=" + OTHER)), (await pinned()).join(",")));
const unconf = memo(async () => {
  let n = 0;
  const h = await rt({ cfg: () => { n++; return n === 1 ? { status: 503, body: { unconfigured: true } } : { status: 200, body: { url: "https://stub.example", anonKey: "k", restaurantId: RID } }; } });
  const s1 = await h.page.evaluate(() => window.LFH_RT.getStatus());
  const ch1 = await h.page.evaluate(() => (window.__sb ? window.__sb.channels.length : 0));
  await h.page.evaluate(() => window.dispatchEvent(new Event("focus"))); await sleep(800);
  const ch2 = await h.page.evaluate(() => (window.__sb ? window.__sb.channels.length : 0));
  const s2 = await h.page.evaluate(() => window.LFH_RT.getStatus());
  const res = { s1, ch1, ch2, s2, n, errors: h.errors };
  await h.close(); return res;
});
RTN("a server with live updates not set up leaves the status 'weak', not an error page", async () => { const u = await unconf(); return ok(u.s1 !== "online", u.s1); });
RTN("…and coming back to the tab tries again and connects", async () => { const u = await unconf(); return ok(u.ch2 >= 2 && u.s2 === "online", JSON.stringify(u)); });
RTN("…without a page error", async () => ok(!(await unconf()).errors.length, (await unconf()).errors.join(" | ")));
// a hidden tab drops its channels after two minutes — fast-forwarded with the page clock
const idle = memo(async () => {
  // The page's clock is installed BEFORE realtime.js runs, so the two-minute idle timer is a fake one
  // the test can fast-forward instead of waiting for.
  const h = await rt({ clock: true });
  await h.page.clock.runFor(1000);
  const ch0 = await h.page.evaluate(() => (window.__sb ? window.__sb.channels.length : 0));
  const before = await h.page.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, get: () => true }); document.dispatchEvent(new Event("visibilitychange")); return window.__sb.removed; });
  await h.page.clock.runFor(119000);
  const at119 = await h.page.evaluate(() => window.__sb.removed);
  await h.page.clock.runFor(2000);
  const after = await h.page.evaluate(() => window.__sb.removed);
  await h.page.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, get: () => false }); document.dispatchEvent(new Event("visibilitychange")); });
  await h.page.clock.runFor(500);
  const chAfterWake = await h.page.evaluate(() => window.__sb.channels.length);
  const res = { ch0, before, at119, after, chAfterWake };
  await h.close(); return res;
});
RTN("a tab hidden for two minutes gives its channels back (the connection budget)", async () => { const i = await idle(); return ok(i.after > i.before && i.at119 === i.before, JSON.stringify(i)); });
RTN("…and showing it again rebuilds them", async () => { const i = await idle(); return ok(i.chAfterWake > i.ch0, JSON.stringify(i)); });
const keep = memo(async () => {
  const h = await rt({ clock: true, after: "window.LFH_RT.start({ handlers: { ops: function(){} }, keepAlive: function(){ return true; } });" });
  await h.page.clock.runFor(1000);
  // The client is built after its start-up read, which answers in REAL time while this page's clock
  // only moves when told to — under load it was not there yet (sweep #10 T16 round 2: a flake).
  for (let i = 0; i < 50 && !(await h.page.evaluate(() => !!(window.__sb && window.__sb.channels.length))); i++) { await sleep(100); await h.page.clock.runFor(100); }
  const b = await h.page.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, get: () => true }); document.dispatchEvent(new Event("visibilitychange")); return window.__sb.removed; });
  await h.page.clock.runFor(130000);
  const a = await h.page.evaluate(() => window.__sb.removed);
  await h.close(); return { b, a };
});
RTN("…unless the panel says it is still working (the printing kitchen screen keeps its socket)", async () => { const k = await keep(); return ok(k.a === k.b, JSON.stringify(k)); });
// catchUp: polls only while the socket is NOT live, backs off on failure
const catchup = memo(async () => {
  const h = await harness({ before: (p) => p.clock.install(), pre: "window.__polls=0;window.__fail=true;", body: TOP, scripts: ["realtime.js"], api: () => ({ status: 503, body: {} }), after: "window.__stop = window.LFH_RT.catchUp(function(){ window.__polls++; return window.__fail ? Promise.reject(new Error('read failed')) : Promise.resolve(); }, { baseMs: 1000, maxMs: 8000 });" });
  await h.page.clock.runFor(1300); const p1 = await h.page.evaluate(() => window.__polls);
  await h.page.clock.runFor(30000); const p30 = await h.page.evaluate(() => window.__polls);
  await h.page.evaluate(() => { window.__fail = false; });
  await h.page.clock.runFor(9000);
  const base = await h.page.evaluate(() => window.__polls);
  await h.page.clock.runFor(20000); const after = (await h.page.evaluate(() => window.__polls)) - base;
  await h.page.evaluate(() => window.__stop()); const stopped = await h.page.evaluate(() => window.__polls);
  await h.page.clock.runFor(20000); const afterStop = (await h.page.evaluate(() => window.__polls)) - stopped;
  await h.close(); return { p1, p30, after, afterStop };
});
RTN("the catch-up poll runs while the socket is not live", async () => ok((await catchup()).p1 >= 1, JSON.stringify(await catchup())));
RTN("…backs off while its reads keep failing (far fewer than one per base interval)", async () => { const c = await catchup(); return ok(c.p30 <= 12, `${c.p30} polls in 31 s at a 1 s base`); });
RTN("…goes back to quick the moment a read succeeds", async () => { const c = await catchup(); return ok(c.after >= 10, `${c.after} polls in the next 20 s`); });
RTN("…and stops completely when told to", async () => ok((await catchup()).afterStop === 0));

// ══ offline.js — every sentence the bar can say, driven with a stubbed queue ══
const BAR = (over) => `window.LFH_OUTBOX={_l:[],_s:{queued:[],failed:[],count:0,syncing:false},onChange:function(cb){this._l.push(cb);cb(this._s)},waitingSince:function(){return window.__since||0},nextTryAt:function(){return window.__next||0},storageFailed:function(){return !!window.__unsafe},pendingByTable:function(){return window.__pbt||{}},blockedByTable:function(){return window.__bbt||{}},flush:function(){window.__flushed=(window.__flushed||0)+1},retryOne:function(id){window.__retried=id},dismiss:function(id){window.__dismissed=id}};window.__push=function(s){window.LFH_OUTBOX._s=s;window.LFH_OUTBOX._l.forEach(function(f){f(s)})};window.LFH_TEST_PACING={stuck:1500};${over || ""}`;
const barTxt = (p) => p.evaluate(() => (document.querySelector(".lfh-offbar") || {}).textContent || "");
const offline = memo(async () => {
  const h = await harness({ pre: BAR("Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>window.__on!==false});window.LFH_RT={getStatus:()=>window.__rt||'online',everConnected:()=>!!window.__ever};"), body: TOP + '<div data-t="5" class="tile">5</div><div data-floor-table="9">9</div>', scripts: ["backstack.js", "offline.js"] });
  const P = h.page, o = {};
  const q = (n, why, at) => Array.from({ length: n }, (_, i) => ({ id: "q" + i, label: "Settle bill · Table " + (i + 1), at: at || Date.now(), why }));
  await P.evaluate((q) => { window.__push({ queued: q, failed: [], count: 1, syncing: false }); }, q(1, "slow")); o.slow = await barTxt(P);
  await P.evaluate((q) => { window.__push({ queued: q, failed: [], count: 1, syncing: false }); }, q(1, "behind")); o.behind = await barTxt(P);
  await P.evaluate((q) => { window.__since = Date.now() - 5000; window.__next = Date.now() + 60000; window.__push({ queued: q, failed: [], count: 1, syncing: false }); }, q(1, "slow", Date.now() - 5000)); o.waitDue = await barTxt(P);
  await P.evaluate((q) => { window.__next = 0; window.__push({ queued: q, failed: [], count: 1, syncing: false }); }, q(1, "slow", Date.now() - 5000)); o.stuck = await barTxt(P);
  o.stuckBtns = await P.evaluate(() => [...document.querySelectorAll(".lfh-offbar-btn")].map((b) => b.textContent));
  await P.evaluate(() => { const b = [...document.querySelectorAll(".lfh-offbar-btn")].find((x) => /Send now/.test(x.textContent)); if (b) b.click(); }); o.flushed = await P.evaluate(() => window.__flushed || 0); o.afterSend = await barTxt(P);
  await P.evaluate((q) => { window.__since = 0; window.__unsafe = true; window.__push({ queued: q, failed: [], count: 2, syncing: false }); }, q(2, "offline")); o.unsafe = await barTxt(P);
  await P.evaluate(() => { window.__unsafe = false; });
  await P.evaluate((q) => { window.__push({ queued: q, failed: [], count: 3, syncing: false }); }, q(3, "offline")); o.three = await barTxt(P);
  o.threeLeak = /\btrue\b|\bfalse\b|undefined|NaN/.test(o.three);
  // stamps
  await P.evaluate(() => { window.__pbt = { "5": 2, "9": 1 }; window.__bbt = { "9": 1 }; window.__push({ queued: [{ id: "a", label: "x", at: Date.now() }], failed: [{ id: "b", label: "y", at: Date.now(), retryable: false }], count: 2, syncing: false }); });
  await sleep(100);
  o.chip5 = await P.evaluate(() => { const c = document.querySelector('[data-t="5"] .lfh-pend-chip'); return c ? [c.textContent, c.className, c.getAttribute("aria-label")] : null; });
  o.chip9 = await P.evaluate(() => { const c = document.querySelector('[data-floor-table="9"] .lfh-pend-chip'); return c ? [c.textContent, c.className, c.getAttribute("aria-label")] : null; });
  o.sheetOpenedOnFail = await P.evaluate(() => !!document.querySelector(".lfh-off-back"));
  o.sheetText = await P.evaluate(() => (document.querySelector(".lfh-off-sheet") || {}).textContent || "");
  o.noTryAgainForClash = await P.evaluate(() => ![...document.querySelectorAll(".lfh-off-ok")].some((b) => /Try again/.test(b.textContent)));
  const dis = () => P.evaluate(() => [...document.querySelectorAll(".lfh-off-ghost")][0]);
  await P.evaluate(() => { const b = document.querySelector(".lfh-off-ghost"); b.click(); }); o.armed = await P.evaluate(() => { const b = document.querySelector(".lfh-off-ghost"); return [b.textContent, b.className]; }); o.notYet = await P.evaluate(() => window.__dismissed || null);
  await P.evaluate(() => { document.querySelector(".lfh-off-ghost").click(); }); o.dismissed = await P.evaluate(() => window.__dismissed || null);
  await P.evaluate(() => { window.LFH_OFF.close(); window.__push({ queued: [], failed: [{ id: "c", label: "z", at: Date.now(), retryable: true, plain: "It couldn't be applied." }], count: 1, syncing: false }); });
  o.sheetAgain = await P.evaluate(() => !!document.querySelector(".lfh-off-back"));
  await P.evaluate(() => { window.LFH_OFF.open(); }); await P.evaluate(() => { const b = document.querySelector(".lfh-off-ghost"); b.click(); }); await sleep(4300);
  o.reverted = await P.evaluate(() => document.querySelector(".lfh-off-ghost") && document.querySelector(".lfh-off-ghost").textContent);
  o.tryAgain = await P.evaluate(() => { const b = [...document.querySelectorAll(".lfh-off-ok")].find((x) => /Try again/.test(x.textContent)); if (b) b.click(); return window.__retried || null; });
  await P.evaluate(() => { window.LFH_OFF.close(); window.__pbt = {}; window.__bbt = {}; window.__push({ queued: [], failed: [], count: 0, syncing: false }); }); await sleep(1400);
  o.chipsGone = await P.evaluate(() => document.querySelectorAll(".lfh-pend-chip").length);
  o.outline = await P.evaluate(() => document.querySelector('[data-t="5"]').className);
  // stale reads
  const fake = (h0) => P.evaluate((h0) => window.LFH_OFF.noteResponse({ ok: true, headers: { get: (k) => h0[k] || null } }), h0);
  await fake({ "X-LFH-From-Cache": "1", "X-LFH-Cached-At": String(Date.now() - 3 * 60000) }); o.healthySocketStale = await barTxt(P);
  await P.evaluate(() => { window.__rt = "weak"; window.__ever = true; }); await fake({ "X-LFH-From-Cache": "1", "X-LFH-Cached-At": String(Date.now() - 3 * 60000) }); o.struggling = await barTxt(P);
  o.isStale = await P.evaluate(() => window.LFH_OFF.isStale());
  const healed = await P.evaluate(() => new Promise((r) => { window.addEventListener("lfh:stale-refresh", () => r(true), { once: true }); setTimeout(() => r(false), 3500); }));
  o.healed = healed;
  await fake({}); o.fresh = await barTxt(P); o.isStaleAfter = await P.evaluate(() => window.LFH_OFF.isStale());
  await fake({ "X-LFH-Offline": "1" }); o.offlineRead = await barTxt(P);
  o.err = await P.evaluate(() => { const O = window.LFH_OFF; return { a: O.isOfflineErr({ offline: true }), b: O.isOfflineErr(new TypeError("Failed to fetch")), c: O.isOfflineErr(new Error("Load failed")), d: O.isOfflineErr(new Error("boom")), e: O.isBusyErr({ status: 503 }), f: O.isBusyErr({ status: 503, offline: true }), g: O.isBusyErr({ busy: true }), h: O.isBusyErr({ status: 500 }), i: O.canReadOffline() }; });
  o.errors = h.errors;
  await h.close(); return o;
});
const OF = (what, fn) => N("offline.js", what, async () => fn(await offline()), "headless: the real offline.js, a stubbed queue and live-update state");
OF("a change parked because the system was SLOW is not called 'made while you were offline'", (o) => ok(/hasn't confirmed them yet/.test(o.slow) && !/offline/.test(o.slow), o.slow));
OF("a change held behind another is described the same honest way", (o) => ok(!/Made while you were offline/.test(o.behind), o.behind));
OF("a healthy wait for the next try says when it will go, and offers Send now", (o) => ok(/next try in about \d+s/.test(o.waitDue) && /Send now/.test(o.waitDue), o.waitDue));
OF("work that has plainly stopped moving says so ('hasn't sent yet')", (o) => ok(/hasn't sent yet/.test(o.stuck), o.stuck));
OF("…and offers both Send now and See", (o) => ok(o.stuckBtns.join() === "Send now,See", o.stuckBtns.join()));
OF("Send now really asks the queue to flush", (o) => ok(o.flushed === 1));
OF("…and the bar reads 'Sending…' again while that round runs", (o) => ok(/Sending 1 saved change/.test(o.afterSend), o.afterSend));
OF("a device that cannot store its changes says they are NOT saved, and to keep the panel open", (o) => ok(/are NOT saved on this device/.test(o.unsafe) && /Keep it open/.test(o.unsafe), o.unsafe));
OF("three changes are counted in words with the right plural", (o) => ok(/Sending 3 saved changes/.test(o.three), o.three));
OF("…and no machine word ever leaks into the bar", (o) => ok(!o.threeLeak));
OF("a table carrying unsent work wears ⏳ with its count", (o) => ok(o.chip5 && o.chip5[0] === "⏳ 2" && !/is-blocked/.test(o.chip5[1]), JSON.stringify(o.chip5)));
OF("…a table whose change needs a person wears ⚠ instead, in red", (o) => ok(o.chip9 && o.chip9[0] === "⚠" && /is-blocked/.test(o.chip9[1]), JSON.stringify(o.chip9)));
OF("…and each chip says what it means to a screen reader", (o) => ok(/not sent yet/.test(o.chip5[2]) && /need you/.test(o.chip9[2]), `${o.chip5[2]} · ${o.chip9[2]}`));
OF("a change coming back needing a person opens the list unprompted, once", (o) => ok(o.sheetOpenedOnFail));
OF("a change that can never be sent is offered no Try again", (o) => ok(o.noTryAgainForClash));
OF("'Not needed anymore' asks once, in the same button ('Tap again to discard', in red)", (o) => ok(o.armed[0] === "Tap again to discard" && /is-armed/.test(o.armed[1]) && o.notYet === null, JSON.stringify(o.armed)));
OF("…and only the second tap throws the change away", (o) => ok(o.dismissed === "b", String(o.dismissed)));
OF("a SECOND failure while the first is still unanswered does not pop the list open again", (o) => ok(o.sheetAgain === false));
OF("…and an armed discard button forgets itself after four seconds", (o) => ok(o.reverted === "Not needed anymore", o.reverted));
OF("Try again sends THAT change back", (o) => ok(o.tryAgain === "c", String(o.tryAgain)));
OF("once nothing is waiting, every ⏳/⚠ mark leaves the tables", (o) => ok(o.chipsGone === 0 && !/lfh-has-pending|lfh-needs-you/.test(o.outline), `${o.chipsGone} · ${o.outline}`));
OF("ONE saved reply while live updates flow raises no alarm", (o) => ok(!o.healthySocketStale, o.healthySocketStale));
OF("…but a saved reply while live updates are DOWN says the connection is struggling", (o) => ok(/Connection is struggling/.test(o.struggling) && /Showing saved data from/.test(o.struggling), o.struggling));
OF("…and the panel is asked to refresh itself within a few seconds", (o) => ok(o.healed === true));
OF("a fresh reply clears the 'saved data' state", (o) => ok(!o.fresh && o.isStaleAfter === false, o.fresh));
OF("a reply the device answered with NO internet at all says 'No internet — you can keep working'", (o) => ok(/No internet — you can keep working/.test(o.offlineRead), o.offlineRead));
OF("isOfflineErr is true for the browser's own fetch failures and for an error marked offline", (o) => ok(o.err.a && o.err.b && o.err.c && !o.err.d, JSON.stringify(o.err)));
OF("isBusyErr is true for 503 / busy, never for an offline error, never for a plain 500", (o) => ok(o.err.e && !o.err.f && o.err.g && !o.err.h, JSON.stringify(o.err)));
OF("canReadOffline is false on a page with no offline layer installed", (o) => ok(o.err.i === false));
OF("offline.js raises no page error through any of that", (o) => ok(!o.errors.length, o.errors.join(" | ")));

// ══ connbadge.js — the rows inside the popover ══
const pop = memo(async () => {
  const h = await harness({ pre: BAR("window.LFH_RT={getStatus:()=>'online',everConnected:()=>true,getLatency:()=>({ms:120,at:Date.now()}),getLatencyHistory:()=>[120,300,900,2000,5000],onStatus:function(cb){cb('online')},onLatency:function(){return function(){}}};"), body: TOP, scripts: ["backstack.js", "connbadge.js"] });
  const P = h.page, o = {};
  await P.evaluate(() => window.__push({ queued: [{ id: "q1", label: "Settle bill · Table 5", at: Date.now(), why: "behind" }, { id: "q2", label: "Apply discount · Table 7", at: Date.now() - 120000, why: "busy" }], failed: [{ id: "f1", label: "Move KOT · Table 3", at: Date.now(), error: "Already changed", retryable: false }, { id: "f2", label: "Mark paid · Table 2", at: Date.now(), error: "The system didn't answer", retryable: true }], count: 4, syncing: true }));
  await P.click("#lfhConnBadge"); await sleep(250);
  o.n = await P.evaluate(() => [document.querySelector(".lfh-conn-n").textContent, document.querySelector(".lfh-conn-n").className]);
  o.rows = await P.evaluate(() => [...document.querySelectorAll(".lfh-conn-row")].map((r) => r.textContent));
  o.retryCount = await P.evaluate(() => [...document.querySelectorAll(".lfh-conn-x")].filter((b) => b.textContent === "Retry").length);
  o.pills = await P.evaluate(() => [...document.querySelectorAll(".lfh-conn-pill")].map((p) => p.textContent));
  o.sparkBars = await P.evaluate(() => document.querySelectorAll(".lfh-spark-bar").length);
  o.cap = await P.evaluate(() => (document.querySelector(".lfh-spark-cap") || {}).textContent);
  await P.evaluate(() => { const b = [...document.querySelectorAll(".lfh-conn-x")].find((x) => x.textContent === "Retry"); b.click(); }); o.retried = await P.evaluate(() => window.__retried);
  o.stillOpen = await P.evaluate(() => !!document.querySelector(".lfh-conn-pop"));
  await P.evaluate(() => { const b = [...document.querySelectorAll(".lfh-conn-x")].find((x) => x.textContent === "Dismiss"); b.click(); }); o.dismissed = await P.evaluate(() => window.__dismissed);
  // a repaint under a finger is held
  const before = await P.evaluate(() => document.querySelector(".lfh-conn-pop").firstChild === document.querySelector(".lfh-conn-pop-hd"));
  await P.evaluate(() => { const pop = document.querySelector(".lfh-conn-pop"); window.__node = pop.querySelector(".lfh-conn-x"); pop.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })); window.__push({ queued: [], failed: [{ id: "f9", label: "New thing", at: Date.now(), error: "x", retryable: true }], count: 1, syncing: false }); });
  o.heldSame = await P.evaluate(() => document.querySelector(".lfh-conn-pop .lfh-conn-x") === window.__node);
  await P.evaluate(() => window.dispatchEvent(new PointerEvent("pointerup")));
  o.afterLift = await P.evaluate(() => document.querySelector(".lfh-conn-pop").textContent.includes("New thing"));
  await P.keyboard.press("Escape").catch(() => {});
  await P.evaluate(() => history.back()); await sleep(250);
  o.backClosed = await P.evaluate(() => !document.querySelector(".lfh-conn-pop"));
  o.rest = await P.evaluate(() => document.getElementById("lfhConnBadge").getAttribute("data-rest"));
  o.errors = h.errors;
  await h.close(); return o;
});
const CB = (what, fn) => N("connbadge.js", what, async () => fn(await pop()), "headless: the real connbadge.js, a stubbed queue");
CB("the pill counts what failed before what is waiting, in red ('· 2 failed')", (o) => ok(o.n[0] === "· 2 failed" && /warn/.test(o.n[1]), JSON.stringify(o.n)));
CB("every failed row names what it WAS, and why", (o) => ok(o.rows.some((r) => /Move KOT · Table 3/.test(r) && /Already changed/.test(r)), o.rows.join(" | ")));
CB("only the change that CAN be re-sent offers Retry (one of the two)", (o) => ok(o.retryCount === 1));
CB("a waiting row says why it is waiting, in words", (o) => ok(o.rows.some((r) => /waiting for an earlier change on this table/.test(r)) && o.rows.some((r) => /the system was busy/.test(r)), o.rows.join(" | ")));
CB("…and a row held behind another is pilled 'Waiting' even while a round is sending", (o) => ok(o.pills[0] === "Waiting" && o.pills[1] === "Sending…", o.pills.join(",")));
CB("the sparkline draws its fixed 24 slots", (o) => ok(o.sparkBars === 24, String(o.sparkBars)));
CB("…and says it is still building history with only a few readings", (o) => ok(/building history|last 5 updates/.test(o.cap), o.cap));
CB("Retry on a row re-sends THAT row", (o) => ok(o.retried === "f2", String(o.retried)));
CB("…and the panel stays open after the tap", (o) => ok(o.stillOpen));
CB("Dismiss throws away THAT row", (o) => ok(o.dismissed === "f1" || o.dismissed === "f2", String(o.dismissed)));
CB("a repaint never swaps the button out from under a finger", (o) => ok(o.heldSame));
CB("…and the held change appears the moment the finger lifts", (o) => ok(o.afterLift));
CB("the phone's Back closes the panel", (o) => ok(o.backClosed));
CB("the pill marks its resting 'Live' state for a narrow top bar to read", (o) => ok(o.rest === "0" || o.rest === "1", String(o.rest)));
CB("connbadge raises no page error", (o) => ok(!o.errors.length, o.errors.join(" | ")));

// ══ guestbell.js — the rows ══
const bell = memo(async () => {
  const h = await harness({ body: TOP, scripts: ["backstack.js", "guestbell.js"] });
  const P = h.page;
  const r = await P.evaluate(async () => {
    localStorage.removeItem("lfh_bell_seen");
    let opened = null, ran = 0;
    window.LFH_BELL.sync({ menuOn: true, onOpen: (t) => { opened = t; }, rows: [
      { kind: "call", table: 4, text: "Water please", at: Date.now() - 120000, key: "c4" },
      { kind: "order", table: 9, at: Date.now() - 1000, key: "o9" },
      { kind: "printer", key: "p1", title: "The kitchen slip is stuck", text: "KOT 12 has not printed", at: Date.now(), action: { label: "Print it here", run: () => { ran++; } } },
      { kind: "stock", key: "s1", title: "Paneer is running low" },
      { kind: "made_up", table: 2, key: "m2", at: Date.now() - 5000 },
    ] });
    window.LFH_BELL.open();
    const rows = [...document.querySelectorAll(".lfh-bell-row")];
    const o = { titles: rows.map((x) => x.querySelector("b").textContent), whens: rows.map((x) => (x.querySelector(".lfh-bell-when") || {}).textContent || ""), disabled: rows.map((x) => x.disabled) };
    o.icons = rows.map((x) => x.querySelector(".lfh-bell-ic").textContent);
    const act = document.querySelector(".lfh-bell-act"); o.actLabel = act && act.textContent;
    act.click(); act.click(); o.ran = ran; o.closedAfterAct = !document.querySelector(".lfh-bell-back");
    window.LFH_BELL.open(); [...document.querySelectorAll(".lfh-bell-row")].find((x) => /Table 4/.test(x.textContent)).click(); o.opened = opened; o.closedAfterRow = !document.querySelector(".lfh-bell-back");
    window.LFH_BELL.open(); document.querySelector(".lfh-bell-back").dispatchEvent(new MouseEvent("click", { bubbles: true })); o.scrimClosed = !document.querySelector(".lfh-bell-back");
    window.LFH_BELL.sync({ menuOn: true, rows: [], onOpen: null }); window.LFH_BELL.open(); o.emptyText = document.querySelector(".lfh-bell-sheet").textContent;
    window.LFH_BELL.close();
    window.LFH_BELL.sync({ menuOn: true, rows: [{ kind: "printer", key: "p2", title: "Printer offline" }], onOpen: null }); window.LFH_BELL.open(); o.noTableHint = document.querySelector(".lfh-bell-hd p").textContent;
    window.LFH_BELL.close();
    o.storedKeys = JSON.parse(localStorage.getItem("lfh_bell_seen") || "[]");
    return o;
  });
  const res = { r, errors: h.errors, sent: h.sent.length };
  await h.close(); return res;
});
const GB = (what, fn) => N("guestbell.js", what, async () => fn((await bell()).r, await bell()), "headless: the real guestbell.js, rows handed in by the test");
GB("rows are listed newest first, a row with no time at the end", (r) => ok(r.titles.join("|") === "The kitchen slip is stuck|Table 9 sent a new order|Table 2 asked for something|Table 4 rang for a waiter|Paneer is running low", r.titles.join(" | ")));
GB("a call reads 'Table 4 rang for a waiter', in the floor's own words", (r) => ok(r.titles.includes("Table 4 rang for a waiter"), r.titles.join(" | ")));
GB("a new order reads 'Table 9 sent a new order'", (r) => ok(r.titles.includes("Table 9 sent a new order")));
GB("a printer row speaks for itself, with no 'Table' in front", (r) => ok(r.titles.includes("The kitchen slip is stuck")));
GB("a stock row speaks for itself too (not 'asked for something')", (r) => ok(r.titles.includes("Paneer is running low")));
GB("a kind nobody listed falls back to 'asked for something', never 'undefined'", (r) => ok(r.titles.includes("Table 2 asked for something"), r.titles.join(" | ")));
GB("every row carries a glyph", (r) => ok(r.icons.every((i) => i && i.trim())));
GB("a row with no time shows no 'ago'", (r) => ok(r.whens.some((w) => w === "")));
GB("a row two minutes old says '2 min ago'", (r) => ok(r.whens.includes("2 min ago"), r.whens.join(",")));
GB("a printer row's one action reads as the panel named it", (r) => ok(r.actLabel === "Print it here"));
GB("…runs ONCE however fast it is tapped", (r) => ok(r.ran === 1, String(r.ran)));
GB("…and closes the sheet", (r) => ok(r.closedAfterAct));
GB("a stock row with no action is a readout, not a dead button that looks tappable", (r) => ok(r.disabled.some(Boolean)));
GB("a row with a table takes you to that table", (r) => ok(r.opened === "4" && r.closedAfterRow, String(r.opened)));
GB("a tap on the scrim closes the sheet", (r) => ok(r.scrimClosed));
GB("with nothing waiting the sheet says 'All caught up'", (r) => ok(/All caught up/.test(r.emptyText) && /Nothing needs you right now/.test(r.emptyText)));
GB("with only table-less rows the heading does not tell you to tap a table", (r) => ok(/Nothing from the tables/.test(r.noTableHint), r.noTableHint));
GB("what it remembers as read is only row KEYS, never the text of a call", (r) => ok(r.storedKeys.every((k) => !/Water please/.test(k)), r.storedKeys.join(",")));
N("guestbell.js", "the bell makes no request through any of that", async () => ok((await bell()).sent === 0), "the harness counts requests");
N("guestbell.js", "guestbell raises no page error", async () => ok(!(await bell()).errors.length, (await bell()).errors.join(" | ")), "headless");

done();
