// scripts/sweep/t16s10/new-k.mjs — NEW checks, sweep #10 T16 ROUND 2, ids from P185861.
// The last reachable lines the third coverage run still listed as never run: an old phone with no
// AbortSignal.timeout, the number fitter loaded before the page body, a garbled "seen" list once the
// bell has rows, "My profile & pay" loaded late, the swipe hint on a browser that refuses a smooth
// scroll, a warm-up message the browser throws on, the shrinker's last-resort catch, and the offline
// bar letting go of a saved-copy notice after 25 seconds. Every request is answered by the test.
/* eslint-disable @typescript-eslint/no-unused-vars -- a check suite: helpers are imported whole */
import { R, ok, tag } from "./lib.mjs";
import { harness, sleep, until, PACE } from "./browser.mjs";

const done = tag("new-k");
let id = 185861;
const N = (file, what, fn) => R(`P${id++}`, file, what, fn, "headless: the real shared file(s), every request answered by the test");
const TOP = '<div class="topbar"><div class="top-actions"><button id="myProfileBtn" hidden>me</button></div></div>';

N("realtime.js", "A phone with no AbortSignal.timeout still puts a deadline on the live-updates start-up read", async () => {
  const h = await harness({ pre: "AbortSignal.timeout = undefined; window.__sig = null; const f = window.fetch; window.fetch = function (u, o) { if (/rt-config/.test(String(u))) window.__sig = !!(o && o.signal); return f.apply(this, arguments); };", body: TOP, scripts: ["realtime.js"], after: "window.LFH_RT.start({ handlers: { ops: function(){} } });", api: (rec) => (/rt-config/.test(rec.path) ? { status: 503, body: {} } : { status: 200, body: {} }) });
  await sleep(600); const r = { sig: await h.page.evaluate(() => window.__sig), e: h.errors }; await h.close();
  return ok(r.sig === true && !r.e.length, JSON.stringify(r));
});
N("fitnums.js", "Loaded in the page's HEAD (before there is a body), the fitter waits for the page and then fits", async () => {
  const h = await harness({ head: '<script src="/panels/fitnums.js"></script>', body: '<div style="width:40px"><span data-fit-num style="font-size:30px;white-space:nowrap;display:inline-block;max-width:40px">₹1,23,456</span></div>', scripts: [], api: () => ({ status: 200, body: {} }) });
  await sleep(400); const r = await h.page.evaluate(() => ({ has: !!window.LFH_FITNUM, fs: document.querySelector("[data-fit-num]").style.fontSize })); await h.close();
  return ok(r.has && parseFloat(r.fs) < 30, JSON.stringify(r));
});
N("guestbell.js", "A 'seen' list the device garbled is ignored once the bell has rows — every row counts as new", async () => {
  const h = await harness({ pre: "localStorage.setItem('lfh_bell_seen', '{not json');", body: TOP, scripts: ["backstack.js", "guestbell.js"], api: () => ({ status: 200, body: {} }) });
  await h.page.evaluate(() => window.LFH_BELL.sync({ menuOn: true, rows: [{ kind: "call", table: 4, key: "c4", at: Date.now(), text: "Water please" }, { kind: "order", table: 9, key: "o9", at: Date.now() }] }));
  await sleep(150); const r = { n: await h.page.evaluate(() => window.LFH_BELL.count()), e: h.errors }; await h.close();
  return ok(r.n === 2 && !r.e.length, JSON.stringify(r));
});
N("myprofile.js", "Loaded after the page has parsed, 'My profile & pay' still wires its button", async () => {
  const me = { staff: true, id: "u1", username: "w1", role: "manager", name: "A", phone: "1", profileModule: true, profile: {}, completeness: { filled: 1, total: 8 }, job: {} };
  const h = await harness({ body: TOP, scripts: [], api: (rec) => (/panel-profile/.test(rec.path) ? { status: 200, body: me } : { status: 200, body: {} }) });
  await h.page.addScriptTag({ url: "/panels/myprofile.js" });
  const shown = await until(() => h.page.evaluate(() => !document.getElementById("myProfileBtn").hidden), 4000); await h.close();
  return ok(shown);
});
N("swipehint.js", "On a browser that refuses a smooth scroll, the 'more' chip still moves the row along", async () => {
  const h = await harness({ pre: "Element.prototype.scrollBy = function () { throw new TypeError('no smooth scroll here'); };",
    body: '<div><div data-swipe-hint data-swipe-count style="width:200px;overflow-x:auto;white-space:nowrap">' + Array.from({ length: 8 }, (_, i) => '<span style="display:inline-block;width:120px">tab ' + i + "</span>").join("") + "</div></div>", scripts: ["swipehint.js"], api: () => ({ status: 200, body: {} }) });
  await sleep(500);
  const r = await h.page.evaluate(async () => { const chip = document.querySelector(".lfh-swipe-more"); const row = document.querySelector("[data-swipe-hint]"); const before = row.scrollLeft; if (chip) chip.click(); await new Promise((x) => setTimeout(x, 100)); return { chip: !!chip, before, after: row.scrollLeft }; });
  const e = h.errors; await h.close();
  return ok(r.chip && r.after === r.before + 160 && !e.length, JSON.stringify({ r, e }));
});
N("swreg.js", "A warm-up message the browser THROWS on is swallowed — the panel never sees an error", async () => {
  const h = await harness({ pre: `Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: { controller: { postMessage: function () { throw new Error("DataCloneError"); } }, register: function () { return Promise.resolve({ update: function () {} }); }, getRegistrations: function () { return Promise.resolve([]); }, addEventListener: function () {} } });`, body: TOP, scripts: ["swreg.js"], api: () => ({ status: 200, body: {} }) });
  await sleep(300); await h.page.evaluate(() => { window.LFH_WARM.data("/api/editor/summary", "{}"); });
  await sleep(200); const e = h.errors; await h.close(); return ok(!e.length, e.join(" | "));
});
N("swreg.js", "…a read offered before the layer took over is held, then handed over, and a throw then is swallowed too", async () => {
  const h = await harness({ pre: `window.__posts = []; Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: { controller: null, register: function () { return new Promise(function (r) { window.__go = function () { navigator.serviceWorker.controller = { postMessage: function (m) { window.__posts.push(m.type); if (m.type === "LFH_WARM_DATA") throw new Error("DataCloneError"); } }; r({ update: function () {} }); }; }); }, getRegistrations: function () { return Promise.resolve([]); }, addEventListener: function () {} } });`, body: TOP, scripts: ["swreg.js"], api: () => ({ status: 200, body: {} }) });
  await sleep(200); await h.page.evaluate(() => { window.LFH_WARM.data("/api/editor/summary", "{}"); window.__go(); });
  await sleep(300); const r = { p: await h.page.evaluate(() => window.__posts), e: h.errors }; await h.close();
  return ok(r.p.includes("LFH_WARM_DATA") && !r.e.length, JSON.stringify(r));
});
N("shrinkimg.js", "Something the shrinker cannot even read is handed back exactly as given, never an error", async () => {
  const h = await harness({ body: "<div></div>", scripts: ["shrinkimg.js"], api: () => ({ status: 200, body: {} }) });
  const r = await h.page.evaluate(async () => { const odd = { size: 10, get type() { throw new Error("unreadable"); } }; try { const out = await window.LFH_IMG.shrink(odd); return { same: out.file === odd, changed: out.changed }; } catch (e) { return { threw: e.message }; } });
  await h.close(); return ok(r.same === true && r.changed === false, JSON.stringify(r));
});
N("offline.js", "A 'showing a saved copy' notice lets go by itself 25 seconds after the last saved reply", async () => {
  const h = await harness({ pre: "window.LFH_OUTBOX = { onChange: function (cb) { cb({ queued: [], failed: [], count: 0 }); }, waitingSince: function () { return 0; }, nextTryAt: function () { return 0; }, storageFailed: function () { return false; }, pendingByTable: function () { return {}; }, blockedByTable: function () { return {}; } }; window.LFH_RT = { getStatus: function () { return 'connecting'; }, everConnected: function () { return true; } };",
    body: TOP, scripts: ["backstack.js", "offline.js"], before: (p) => p.clock.install(), api: () => ({ status: 200, body: {} }) });
  // A panel's api() hands every GET reply to noteResponse(); the offline layer marks a saved copy
  // with X-LFH-From-Cache / X-LFH-Cached-At. One such reply, ten minutes old:
  await h.page.evaluate(() => window.LFH_OFF.noteResponse(new Response("{}", { headers: { "X-LFH-From-Cache": "1", "X-LFH-Cached-At": String(Date.now() - 600000) } })));
  await h.page.clock.runFor(3000); const during = await h.page.evaluate(() => (document.querySelector(".lfh-offbar") || {}).textContent || "");
  await h.page.clock.runFor(26000); const after = await h.page.evaluate(() => (document.querySelector(".lfh-offbar") || {}).textContent || "");
  const e = h.errors; await h.close();
  return ok(during && !after && !e.length, JSON.stringify({ during, after, e }));
});

done();
