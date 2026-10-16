// Family J — SECOND PASS, AIMED BY COVERAGE: live updates (realtime.js), the connection pill fed by them
// (connbadge.js), and the offline layer's installer (swreg.js). The first pass ran 0% of realtime.js and
// swreg.js. Here the REAL helpers run against stand-ins at the addresses they load: a live-update client
// at /vendor/supabase.js that records every channel and lets a check push events and statuses, and an
// offline worker at /sw.js that echoes every message back to the page. Nothing connects anywhere.
import { C, ok } from "./lib.mjs";
import { page, open, setApi, file, log, sleep, until } from "./server.mjs";

const RID = "11111111-1111-4111-8111-111111111111", OTHER = "22222222-2222-4222-8222-222222222222";
file("/vendor/supabase.js", "application/javascript", `
export function createClient(url, key, opts) {
  const F = window.__rtFake = window.__rtFake || { channels: [], removed: 0, created: 0 };
  F.created++; F.opts = opts; F.url = url;
  return {
    channel(name) {
      const ch = { name, handlers: [], statusCb: null,
        on(type, filter, cb) { ch.handlers.push({ type, filter, cb }); return ch; },
        subscribe(cb) { ch.statusCb = cb; F.channels.push(ch); setTimeout(() => cb(F.next || "SUBSCRIBED"), 10); return ch; } };
      return ch;
    },
    removeChannel(ch) { F.removed++; F.channels = F.channels.filter((c) => c !== ch); try { ch.statusCb && ch.statusCb("CLOSED"); } catch (e) {} },
  };
}
window.__rtEmit = (row) => (window.__rtFake.channels || []).forEach((c) => c.handlers.forEach((h) => h.cb({ new: row })));
window.__rtStatus = (s) => (window.__rtFake.channels || []).forEach((c) => c.statusCb && c.statusCb(s));
`);
const cfg = { url: "http://127.0.0.1:9/stub", anonKey: "anon", restaurantId: RID };
const api = (over) => (r) => (r.path.startsWith("/api/rt-config") ? (over ? over(r) : { status: 200, body: cfg }) : { status: 200, body: {} });
const ONLINE = "Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>window.__on!==false});";
const RTP = page("j-rt", { pre: ONLINE, scripts: ["realtime.js"], after: "window.__calls=[];window.__startRt=(o)=>window.LFH_RT.start(Object.assign({handlers:{ops:(d)=>window.__calls.push(d)}},o||{}));" });
const hideTab = (p, on) => p.evaluate((on) => { Object.defineProperty(document, "hidden", { configurable: true, get: () => on }); Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (on ? "hidden" : "visible") }); document.dispatchEvent(new Event("visibilitychange")); }, on);

C("J", "realtime.js", "start: asks for its config ONCE, opens one channel named for this restaurant and filtered to it, goes 'online', loads once at start", async () => {
  setApi(api());
  const h = await open(RTP); const p = h.page;
  await p.evaluate(() => window.__startRt()); await sleep(400);
  const r = await p.evaluate(() => ({ status: window.LFH_RT.getStatus(), ever: window.LFH_RT.everConnected(), rid: window.LFH_RT.getRid(), ch: window.__rtFake.channels.map((c) => ({ n: c.name, f: c.handlers[0] && c.handlers[0].filter })), calls: window.__calls.length, worker: window.__rtFake.opts.realtime.worker }));
  const asked = log.filter((x) => x.path.startsWith("/api/rt-config")).length;
  await h.close();
  return ok(asked === 1 && r.status === "online" && r.ever && r.rid === RID && r.ch.length === 1 && r.ch[0].n === "rt:ops:" + RID && r.ch[0].f.filter === "topic_rid=eq.ops:" + RID && r.calls === 1 && r.worker === true, JSON.stringify({ asked, r }));
});
C("J", "realtime.js", "events: a flurry on one table becomes ONE reload naming that table; another restaurant's event is ignored completely; an event with no table, or a platform order, reloads everything; more than 20 tables at once reloads everything", async () => {
  setApi(api());
  const h = await open(RTP); const p = h.page;
  await p.evaluate(() => window.__startRt()); await sleep(400);
  const r = await p.evaluate(async ([RID, OTHER]) => {
    const sl = (ms) => new Promise((x) => setTimeout(x, ms)); window.__calls.length = 0;
    for (let i = 0; i < 3; i++) window.__rtEmit({ restaurant_id: RID, table_number: 7, created_at: new Date(Date.now() - 300).toISOString() });
    await sl(500); const a = window.__calls.splice(0);
    window.__rtEmit({ restaurant_id: OTHER, table_number: 3 }); await sl(500); const b = window.__calls.splice(0);
    window.__rtEmit({ restaurant_id: RID }); await sl(500); const c = window.__calls.splice(0);
    window.__rtEmit({ restaurant_id: RID, table_number: 2, kind: "platform" }); await sl(500); const d = window.__calls.splice(0);
    for (let t = 1; t <= 21; t++) window.__rtEmit({ restaurant_id: RID, table_number: t }); await sl(1500); const e = window.__calls.splice(0);
    return { a, b, c, d, e, lat: window.LFH_RT.getLatency(), hist: window.LFH_RT.getLatencyHistory().length };
  }, [RID, OTHER]);
  await h.close();
  return ok(r.a.length === 1 && r.a[0].full === false && r.a[0].tables.join() === "7" && r.b.length === 0 && r.c.length === 1 && r.c[0].full && r.d.length === 1 && r.d[0].full && r.e.length >= 1 && r.e.some((x) => x.full) && r.lat.ms >= 250 && r.lat.ms < 3000 && r.hist === 3, JSON.stringify(r).slice(0, 600));
});
C("J", "realtime.js", "a burst (a device emptying its queue): 40 events over 2 s cause a handful of reloads, never one per event, and the first waits no more than about 1.2 s", async () => {
  setApi(api());
  const h = await open(RTP); const p = h.page;
  await p.evaluate(() => window.__startRt()); await sleep(400);
  const r = await p.evaluate(async (RID) => {
    window.__calls.length = 0; const t0 = Date.now(); const at = [];
    const orig = window.__calls.push.bind(window.__calls); window.__calls.push = (x) => { at.push(Date.now() - t0); return orig(x); };
    for (let i = 0; i < 40; i++) { window.__rtEmit({ restaurant_id: RID, table_number: 1 + (i % 5) }); await new Promise((x) => setTimeout(x, 50)); }
    await new Promise((x) => setTimeout(x, 1600));
    return { n: window.__calls.length, at };
  }, RID);
  await h.close();
  return ok(r.n >= 1 && r.n <= 6 && r.at[0] <= 1400, JSON.stringify(r));
});
C("J", "realtime.js", "live updates not set up on the server (503 unconfigured): the panel stays usable ('weak', nothing thrown), and coming back to the tab asks again", async () => {
  let n = 0; setApi(api(() => (++n === 1 ? { status: 503, body: { unconfigured: true } } : { status: 200, body: cfg })));
  const h = await open(RTP); const p = h.page;
  await p.evaluate(() => window.__startRt()); await sleep(300);
  const a = await p.evaluate(() => window.LFH_RT.getStatus());
  await hideTab(p, true); await hideTab(p, false); await sleep(500);
  const b = await p.evaluate(() => ({ s: window.LFH_RT.getStatus(), ch: (window.__rtFake || { channels: [] }).channels.length }));
  const errs = h.errors.slice(); await h.close();
  return ok(a === "weak" && n === 2 && b.s === "online" && b.ch === 1 && !errs.length, JSON.stringify({ a, asked: n, b, errs }));
});
C("J", "realtime.js", "a config read that is accepted and never answered gives up after 8 s, so the next wake really asks again (it used to wait for ever)", async () => {
  let n = 0; setApi(api(() => (++n === 1 ? "hang" : { status: 200, body: cfg })));
  const h = await open(RTP); const p = h.page;
  p.evaluate(() => window.__startRt()).catch(() => {});
  await sleep(9000);
  await p.evaluate(() => window.dispatchEvent(new Event("focus"))); await sleep(600);
  const s = await p.evaluate(() => window.LFH_RT.getStatus());
  await h.close();
  return ok(n === 2 && s === "online", JSON.stringify({ asked: n, s }));
});
C("J", "realtime.js", "hidden for over 2 minutes the channels are let go (no live connection costing anything); back on the tab they come back and the panel reloads once", async () => {
  setApi(api());
  const h = await open(RTP, { clock: true }); const p = h.page;
  await p.evaluate(() => window.__startRt()); await p.clock.runFor(500);
  await hideTab(p, true); await p.clock.runFor(121000);
  const hidden = await p.evaluate(() => ({ ch: window.__rtFake.channels.length, removed: window.__rtFake.removed }));
  await p.evaluate(() => { window.__calls.length = 0; }); await hideTab(p, false); await p.clock.runFor(1000);
  const back = await p.evaluate(() => ({ ch: window.__rtFake.channels.length, calls: window.__calls.length, full: window.__calls[0] && window.__calls[0].full }));
  await h.close();
  return ok(hidden.ch === 0 && hidden.removed >= 1 && back.ch === 1 && back.calls === 1 && back.full === true, JSON.stringify({ hidden, back }));
});
C("J", "realtime.js", "a panel that must stay awake while hidden (the kitchen while it is the printer: keepAlive) keeps its channel past 2 minutes", async () => {
  setApi(api());
  const h = await open(RTP, { clock: true }); const p = h.page;
  await p.evaluate(() => window.__startRt({ keepAlive: () => true })); await p.clock.runFor(500);
  await hideTab(p, true); await p.clock.runFor(125000);
  const ch = await p.evaluate(() => window.__rtFake.channels.length);
  await h.close();
  return ok(ch === 1, `channels after 125 s hidden: ${ch}`);
});
C("J", "realtime.js", "a channel that errors makes the status 'weak' (or 'offline' with no signal); a reconnect counts as one and reloads; status listeners hear every change, once", async () => {
  setApi(api());
  const h = await open(RTP); const p = h.page;
  await p.evaluate(() => window.__startRt()); await sleep(300);
  const r = await p.evaluate(async () => {
    const heard = []; window.LFH_RT.onStatus((s) => heard.push(s));
    window.__rtStatus("CHANNEL_ERROR"); const a = window.LFH_RT.getStatus();
    window.__on = false; window.__rtStatus("TIMED_OUT"); const b = window.LFH_RT.getStatus(); window.__on = true;
    window.__calls.length = 0; window.__rtStatus("SUBSCRIBED"); await new Promise((x) => setTimeout(x, 400));
    return { a, b, c: window.LFH_RT.getStatus(), heard, reloads: window.__calls.length, reconnects: window.LFH_RT.metrics.reconnects };
  });
  await h.close();
  return ok(r.a === "weak" && r.b === "offline" && r.c === "online" && r.heard.join() === "online,weak,offline,online" && r.reloads === 1 && r.reconnects >= 1, JSON.stringify(r));
});
C("J", "realtime.js", "catchUp(): while live updates are down but reads work it polls with a growing gap; it rests while live, hidden, or offline; a stop really stops it", async () => {
  setApi(api(() => ({ status: 503, body: { unconfigured: true } })));
  const h = await open(RTP, { clock: true }); const p = h.page;
  await p.evaluate(() => window.__startRt()); await p.clock.runFor(200);
  const r = await p.evaluate(async () => {
    window.__polls = 0; window.__stop = window.LFH_RT.catchUp(() => { window.__polls++; return Promise.reject(new Error("still down")); }, { baseMs: 1000, maxMs: 8000 });
    return true;
  });
  await p.clock.runFor(30000); const down = await p.evaluate(() => window.__polls);
  await p.evaluate(() => { window.__on = false; window.__polls = 0; }); await p.clock.runFor(20000); const off = await p.evaluate(() => window.__polls);
  await p.evaluate(() => { window.__on = true; window.__stop(); window.__polls = 0; }); await p.clock.runFor(20000); const stopped = await p.evaluate(() => window.__polls);
  await h.close();
  return ok(r && down >= 3 && down <= 8 && off === 0 && stopped === 0, JSON.stringify({ down, off, stopped }));
});

// ── the connection pill, fed by the REAL live-update helper ───────────────────────────────────
const CBP = page("j-cb", { pre: ONLINE + "window.LFH_TEST_PACING={first:60,base:80,max:240,wake:0,stuck:60000};", body: '<div class="topbar"><div class="top-actions"></div></div>', scripts: ["realtime.js", "outbox.js", "connbadge.js"], after: "window.LFH_RT.start({handlers:{ops:()=>{}}});" });
const pill = (p) => p.evaluate(() => { const b = document.getElementById("lfhConnBadge"); return b ? { text: b.innerText.replace(/\s+/g, " ").trim(), name: b.getAttribute("aria-label") || b.title } : null; });
const popText = (p) => p.evaluate(() => { const x = document.querySelector(".lfh-conn-pop"); return x ? x.innerText.replace(/\s+/g, " ").trim() : null; });
C("J", "connbadge.js", "the pill tells the truth at each stage: Connecting… → Live → a speed word once events flow (Excellent ≤ 0.7 s, Slow 1.5–3 s, Poor beyond) → Reconnecting after a drop → Offline with no signal; the panel's first line says the same in a sentence", async () => {
  let hold = true; setApi(api(() => (hold ? "hang" : { status: 200, body: cfg })));
  const h = await open(CBP); const p = h.page; await sleep(300);
  const s = {};
  s.connecting = await pill(p);
  // The first config read hangs; its 8 s deadline drops it, and the NEXT wake asks again.
  hold = false; await sleep(8600); await p.evaluate(() => window.dispatchEvent(new Event("focus"))); await sleep(1200);
  s.live = await pill(p);
  await p.evaluate((RID) => window.__rtEmit({ restaurant_id: RID, table_number: 1, created_at: new Date(Date.now() - 200).toISOString() }), RID); await sleep(1300);
  s.fast = await pill(p);
  await p.evaluate((RID) => window.__rtEmit({ restaurant_id: RID, table_number: 1, created_at: new Date(Date.now() - 2000).toISOString() }), RID); await sleep(1300);
  s.slow = await pill(p);
  await p.evaluate((RID) => window.__rtEmit({ restaurant_id: RID, table_number: 1, created_at: new Date(Date.now() - 5000).toISOString() }), RID); await sleep(1300);
  s.poor = await pill(p);
  await p.click("#lfhConnBadge"); await sleep(300); s.popOnline = await popText(p); await p.click("#lfhConnBadge").catch(() => {});
  await p.evaluate(() => window.__rtStatus("CHANNEL_ERROR")); await sleep(1300); s.re = await pill(p);
  await p.evaluate(() => { window.__on = false; window.dispatchEvent(new Event("offline")); }); await sleep(1300); s.off = await pill(p);
  await p.click("#lfhConnBadge"); await sleep(300); s.popOff = await popText(p);
  await h.close();
  const t = (x) => (x && (x.text + " " + x.name)) || "";
  return ok(/Connecting/.test(t(s.connecting)) && /Live/.test(t(s.live)) && /Excellent/.test(t(s.fast)) && /Slow/.test(t(s.slow)) && /Poor/.test(t(s.poor)) && /Recent speed/i.test(s.popOnline || "") && /last 3 updates|building history/.test(s.popOnline || "") && /Reconnecting/.test(t(s.re)) && /Offline/.test(t(s.off)) && /No internet connection/.test(s.popOff || ""), JSON.stringify(s).slice(0, 900));
});
C("J", "connbadge.js", "the Connection panel lists every waiting change by name with how long ago, a failed one with its reason, Retry (only if it can be retried) and Dismiss — and the buttons do what they say", async () => {
  setApi((r) => (r.path.startsWith("/api/rt-config") ? { status: 200, body: cfg } : { status: 409, body: { error: "clash", clash: { plain: "Someone else changed this.", todo: "Look again.", retryable: false } } }));
  const h = await open(CBP); const p = h.page; await sleep(400);
  await p.evaluate(() => { window.__on = false; window.dispatchEvent(new Event("offline")); });
  await p.evaluate(() => window.LFH_OUTBOX.send({ base: "/api/editor", method: "POST", path: "/tables/4/discount", body: {}, table: "4" }));
  await p.evaluate(() => window.LFH_OUTBOX.send({ base: "/api/editor", method: "POST", path: "/tables/9/tag", body: {}, table: "9" }));
  await p.click("#lfhConnBadge"); await sleep(300); const waiting = await popText(p); await p.click("#lfhConnBadge").catch(() => {});
  await p.evaluate(() => { window.__on = true; window.dispatchEvent(new Event("online")); window.LFH_OUTBOX.flush(); });
  await until(() => p.evaluate(() => window.LFH_OUTBOX.getSnapshot().failed.length === 2), 6000);
  await p.click("#lfhConnBadge"); await sleep(300); const failed = await popText(p);
  const buttons = await p.evaluate(() => [...document.querySelectorAll(".lfh-conn-pop button")].map((b) => b.textContent));
  await p.evaluate(() => { const b = [...document.querySelectorAll(".lfh-conn-pop button")].find((x) => x.textContent === "Dismiss"); b && b.click(); }); await sleep(300);
  const left = await p.evaluate(() => window.LFH_OUTBOX.getSnapshot().failed.length);
  await h.close();
  return ok(/Apply discount/.test(waiting || "") && /Tag/.test(waiting || "") && /ago|just now/.test(waiting || "") && /Couldn't send/i.test(failed || "") && /Someone else changed this/.test(failed || "") && !buttons.includes("Retry") && buttons.filter((b) => b === "Dismiss").length === 2 && left === 1, JSON.stringify({ waiting, failed, buttons, left }).slice(0, 900));
});

// ── the offline layer's installer ─────────────────────────────────────────────────────────────
// (The stand-in offline worker at /sw.js lives in server.mjs, shared with family P.)
const SWP = page("j-sw", { head: '<link rel="stylesheet" href="/panels/editor/style.css">', scripts: ["swreg.js"], pre: "window.__got=[];navigator.serviceWorker&&navigator.serviceWorker.addEventListener('message',(e)=>window.__got.push(e.data.echo));" });
C("J", "swreg.js", "installs the offline layer once, for the whole site; once it is in charge it is told to keep this panel's page and its own files — and nothing from another site", async () => {
  const h = await open(SWP); const p = h.page;
  await until(() => p.evaluate(() => !!navigator.serviceWorker.controller), 6000);
  await until(() => p.evaluate(() => window.__got.some((m) => m.type === "LFH_WARM_SHELL")), 6000);
  const r = await p.evaluate(async () => ({ scope: (await navigator.serviceWorker.getRegistration()).scope, shell: window.__got.find((m) => m.type === "LFH_WARM_SHELL") }));
  await h.close();
  const origin = r.scope.replace(/\/$/, "");
  return ok(r.scope.endsWith("/") && r.shell && r.shell.url.startsWith(origin) && r.shell.assets.length >= 1 && r.shell.assets.every((a) => a.startsWith(origin)) && r.shell.assets.some((a) => a.includes("style.css")), JSON.stringify(r).slice(0, 500));
});
C("J", "swreg.js", "LFH_WARM.data: before the layer is in charge up to 12 are held and handed over when it takes charge; a non-text body is ignored", async () => {
  const P2 = page("j-sw2", { scripts: ["swreg.js"], pre: "window.__got=[];navigator.serviceWorker.addEventListener('message',(e)=>window.__got.push(e.data.echo));", after: "for(let i=0;i<14;i++)window.LFH_WARM.data('/api/editor/x'+i,'{\"i\":'+i+'}');window.LFH_WARM.data('/api/editor/obj',{a:1});" });
  const h = await open(P2); const p = h.page;
  await until(() => p.evaluate(() => window.__got.filter((m) => m.type === "LFH_WARM_DATA").length >= 12), 8000); await sleep(500);
  const d = await p.evaluate(() => window.__got.filter((m) => m.type === "LFH_WARM_DATA").map((m) => m.url));
  await h.close();
  return ok(d.length === 12 && !d.includes("/api/editor/obj") && d[0] === "/api/editor/x0", JSON.stringify(d));
});
C("J", "swreg.js", "?nosw takes the offline layer away again (a way out when it misbehaves): the worker is told to stop and unregistered", async () => {
  const h = await open(SWP); const p = h.page;
  await until(() => p.evaluate(() => !!navigator.serviceWorker.controller), 6000);
  await p.goto(p.url().split("?")[0] + "?nosw=1"); await sleep(1500);
  const regs = await p.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length);
  await h.close();
  return ok(regs === 0, `registrations left: ${regs}`);
});
