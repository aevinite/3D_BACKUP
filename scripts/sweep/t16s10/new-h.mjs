// scripts/sweep/t16s10/new-h.mjs — NEW checks, sweep #10 T16 ROUND 2, ids from P185727.
// errlog.js — the crash reporter every staff panel loads, driven where the round-2 coverage run found
// it had NEVER been run: a REAL error thrown by a script file (its stack read into "file@version:line"),
// a failed promise after a tap, a crash with no stack, the offline stash and its later delivery, a
// beacon the browser refused, a device with no beacon at all, and the tap batches. Every report is
// answered by the test (browser.mjs harness) — nothing is filed anywhere and nobody's phone buzzes.
/* eslint-disable @typescript-eslint/no-unused-vars -- a check suite: helpers are imported whole */
import { R, ok, eq, tag } from "./lib.mjs";
import { harness, sleep, until } from "./browser.mjs";

const done = tag("new-h");
let id = 185727;
const N = (what, fn) => R(`P${id++}`, "errlog.js", what, fn, "headless: the real errlog.js, a test script that throws, every report answered (and read) by the test");
// A script FILE that throws from two levels deep, loaded with a version stamp like the panels' own.
const BOOM = `function inner(){ throw new Error("kaboom " + (window.__n = (window.__n || 0) + 1)); }
function outer(){ inner(); }
window.__boom = function(){ setTimeout(outer, 0); };
window.__same = function(){ setTimeout(function(){ throw new Error("same twice"); }, 0); };
window.__plain = function(){ setTimeout(function(){ throw "a plain string"; }, 0); };
window.__rej = function(){ Promise.reject(new Error("rejected one")); };`;
async function page(o = {}) {
  const h = await harness({
    pre: o.pre || "", path: o.path, body: o.body || '<div class="topbar"><button id="settle">Settle</button></div>',
    scripts: ["errlog.js"], after: o.after,
    pages: o.pages,
    before: async (p) => { await p.route("**/__t16/boom.js*", (r) => r.fulfill({ contentType: "application/javascript", body: BOOM })); if (o.before) await o.before(p); },
    api: (rec) => (o.api ? o.api(rec) : { status: 200, body: { ok: true } }),
  });
  if (o.boom !== false) await h.page.addScriptTag({ url: "/__t16/boom.js?v=abc123" });
  return h;
}
const reports = (h) => h.sent.filter((r) => /client-error/.test(r.path)).map((r) => { try { return JSON.parse(r.body); } catch { return { raw: r.body }; } });
const errors = (h) => reports(h).filter((x) => x.kind === "error");
const PEND = "lfh_errlog_pending";

// ── 1. a real crash from a script file ───────────────────────────────────────────────────────
const C = {};
async function crash() {
  if (C.r) return C.r;
  const h = await page(); await h.page.evaluate(() => window.__boom()); await until(() => errors(h).length >= 1, 4000);
  C.r = errors(h)[0] || {}; await h.close(); return C.r;
}
N("A real crash is filed as an error, with the browser's own message", async () => { const r = await crash(); return ok(r.kind === "error" && /kaboom 1/.test(r.message), JSON.stringify(r)); });
N("…'where' is the two innermost frames, as file@version:line", async () => { const r = await crash(); return ok(/^boom\.js@abc123:1 <- boom\.js@abc123:2$/.test(r.where), r.where); });
N("…errlog's own listener frame is never one of them", async () => { const r = await crash(); return ok(!/errlog/.test(r.where), r.where); });
N("…and it names the panel ('manager' off a panel page)", async () => { const r = await crash(); return ok(r.panel === "manager", r.panel); });
N("The SAME crash twice in five seconds is filed once", async () => { const h = await page(); await h.page.evaluate(() => { window.__same(); window.__same(); }); await sleep(700); const n = errors(h).filter((x) => /same twice/.test(x.message)).length; await h.close(); return ok(n === 1, `${n} filed`); });
N("…two DIFFERENT crashes are both filed", async () => { const h = await page(); await h.page.evaluate(() => { window.__boom(); window.__boom(); }); await until(() => errors(h).length >= 2, 4000); const n = errors(h).length; await h.close(); return ok(n === 2, `${n} filed`); });
// Under a fake clock a timer's throw goes back to the test, not to the page — so this one reports
// directly and lets the clock decide the five-second window.
N("…and the same crash after the five-second window is filed again", async () => { const h = await page({ before: (p) => p.clock.install() }); await h.page.evaluate(() => window.LFH_ERRLOG.report("same twice", "x")); await h.page.clock.runFor(4000); await h.page.evaluate(() => window.LFH_ERRLOG.report("same twice", "x")); await h.page.clock.runFor(2000); await h.page.evaluate(() => window.LFH_ERRLOG.report("same twice", "x")); await sleep(300); const n = errors(h).filter((x) => /same twice/.test(x.message)).length; await h.close(); return ok(n === 2, `${n} filed (0 s, 4 s: folded, 6 s: filed)`); });
N("A throw with no stack (a plain string) still says which file and line", async () => { const h = await page(); await h.page.evaluate(() => window.__plain()); await until(() => errors(h).length >= 1, 4000); const r = errors(h)[0] || {}; await h.close(); return ok(/a plain string/.test(r.message) && /^boom\.js@abc123:\d+$/.test(r.where), JSON.stringify(r)); });
N("A crash in a file with no version stamp is just file:line", async () => { const h = await page({ boom: false }); await h.page.addScriptTag({ url: "/__t16/boom.js" }); await h.page.evaluate(() => window.__boom()); await until(() => errors(h).length >= 1, 4000); const r = errors(h)[0] || {}; await h.close(); return ok(/^boom\.js:1 <- boom\.js:2$/.test(r.where), r.where); });
N("A crash inside the page's own inline script is filed too", async () => { const h = await page({ boom: false }); await h.page.evaluate(() => { const s = document.createElement("script"); s.textContent = "setTimeout(function(){ throw new Error('inline one'); }, 0);"; document.body.appendChild(s); }); await until(() => errors(h).length >= 1, 4000); const r = errors(h)[0] || {}; await h.close(); return ok(/inline one/.test(r.message), JSON.stringify(r)); });

// ── 2. failed promises ───────────────────────────────────────────────────────────────────────
N("A promise rejected with an Error is filed with its own stack (file@version:line)", async () => { const h = await page(); await h.page.evaluate(() => window.__rej()); await until(() => errors(h).length >= 1, 4000); const r = errors(h)[0] || {}; await h.close(); return ok(/rejected one/.test(r.message) && /^boom\.js@abc123:\d+/.test(r.where), JSON.stringify(r)); });
N("A rejection with no stack, straight after a tap, names the tap", async () => { const h = await page(); await h.page.click("#settle"); await h.page.evaluate(() => { Promise.reject("nope"); }); await until(() => errors(h).length >= 1, 4000); const r = errors(h)[0] || {}; await h.close(); return ok(r.message === "nope" && r.where === "promise · after tap: Settle", JSON.stringify(r)); });
N("…and says how long after the tap it happened", async () => { const h = await page({ before: (p) => p.clock.install() }); await h.page.click("#settle"); await h.page.clock.runFor(3000); await h.page.evaluate(() => { Promise.reject("later"); }); await h.page.clock.runFor(50); await sleep(300); const r = errors(h)[0] || {}; await h.close(); return ok(r.where === "promise · after tap: Settle (3s earlier)", JSON.stringify(r)); });
N("…with no tap at all it says just 'promise'", async () => { const h = await page(); await h.page.evaluate(() => { Promise.reject("alone"); }); await until(() => errors(h).length >= 1, 4000); const r = errors(h)[0] || {}; await h.close(); return ok(r.where === "promise", JSON.stringify(r)); });
N("…an empty rejection still files something readable ('unhandled rejection')", async () => { const h = await page(); await h.page.evaluate(() => { Promise.reject(); }); await until(() => errors(h).length >= 1, 4000); const r = errors(h)[0] || {}; await h.close(); return ok(r.message === "unhandled rejection", JSON.stringify(r)); });

// ── 3. noise that is never a crash ───────────────────────────────────────────────────────────
for (const [m, what] of [["Failed to fetch", "Chrome's 'Failed to fetch'"], ["NetworkError when attempting to fetch resource.", "Firefox's whole sentence"], ["Load failed", "Safari's 'Load failed'"], ["The network connection was lost.", "iOS's 'connection was lost'"], ["The Internet connection appears to be offline.", "iOS's 'appears to be offline'"]]) {
  N(`A dropped connection is not a crash: ${what}`, async () => { const h = await page(); await h.page.evaluate((m) => { Promise.reject(new TypeError(m)); }, m); await sleep(500); const n = errors(h).length; await h.close(); return ok(n === 0, `${n} filed`); });
}
N("…nor the print dialog being blocked", async () => { const h = await page(); await h.page.evaluate(() => window.LFH_ERRLOG.report("Failed to execute 'print' on 'Window': Blocked", "x")); await sleep(300); const n = errors(h).length; await h.close(); return ok(n === 0); });
N("…but a sentence that merely CONTAINS 'failed to fetch' is a real crash and is filed", async () => { const h = await page(); await h.page.evaluate(() => window.LFH_ERRLOG.report("Menu failed to fetch its photos, then crashed", "x")); await sleep(300); const n = errors(h).length; await h.close(); return ok(n === 1); });

// ── 4. no signal ─────────────────────────────────────────────────────────────────────────────
const OFF = "Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>window.__on!==false}); window.__on=false;";
N("With no signal a crash is KEPT on the device, not sent", async () => { const h = await page({ pre: OFF }); await h.page.evaluate(() => window.LFH_ERRLOG.report("offline crash", "here")); await sleep(300); const kept = await h.page.evaluate((k) => JSON.parse(localStorage.getItem(k) || "[]"), PEND); const n = reports(h).length; await h.close(); return ok(n === 0 && kept.length === 1 && kept[0].message === "offline crash" && kept[0].offlineAt > 0, JSON.stringify(kept)); });
N("…the same crash kept twice is kept once", async () => { const h = await page({ pre: OFF }); await h.page.evaluate(() => { window.LFH_ERRLOG.report("twice", "a"); }); await sleep(5200); await h.page.evaluate(() => window.LFH_ERRLOG.report("twice", "b")); await sleep(200); const kept = await h.page.evaluate((k) => JSON.parse(localStorage.getItem(k) || "[]"), PEND); await h.close(); return ok(kept.length === 1, JSON.stringify(kept.map((x) => x.where))); });
N("…at most the last five are kept", async () => { const h = await page({ pre: OFF }); await h.page.evaluate(() => { for (let i = 1; i <= 7; i++) window.LFH_ERRLOG.report("crash " + i, "x"); }); await sleep(200); const kept = await h.page.evaluate((k) => JSON.parse(localStorage.getItem(k) || "[]").map((x) => x.message), PEND); await h.close(); return ok(kept.join() === "crash 3,crash 4,crash 5,crash 6,crash 7", kept.join()); });
N("…a tap batch is never kept (breadcrumbs are not worth the space)", async () => { const h = await page({ pre: OFF }); await h.page.click("#settle"); await h.page.evaluate(() => document.dispatchEvent(new Event("visibilitychange"))); await h.page.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, get: () => true }); document.dispatchEvent(new Event("visibilitychange")); }); await sleep(200); const kept = await h.page.evaluate((k) => JSON.parse(localStorage.getItem(k) || "[]"), PEND); await h.close(); return ok(kept.length === 0, JSON.stringify(kept)); });
N("When the signal returns, kept crashes are sent, saying how long ago they happened", async () => { const h = await page({ pre: OFF }); await h.page.evaluate(() => window.LFH_ERRLOG.report("late one", "the bill")); await h.page.evaluate(() => { window.__on = true; window.dispatchEvent(new Event("online")); }); await until(() => errors(h).length >= 1, 4000); const r = errors(h)[0] || {}; const left = await h.page.evaluate((k) => localStorage.getItem(k), PEND); await h.close(); return ok(r.message === "late one" && r.where === "the bill · offline, under a minute earlier" && !("offlineAt" in r) && left === "[]", JSON.stringify({ r, left })); });
N("…several kept crashes are spaced out (1.5 s apart), not sent in one burst", async () => { const h = await page({ pre: OFF, before: (p) => p.clock.install() }); await h.page.evaluate(() => { window.LFH_ERRLOG.report("a1", "x"); window.LFH_ERRLOG.report("a2", "x"); window.LFH_ERRLOG.report("a3", "x"); }); await h.page.evaluate(() => { window.__on = true; window.dispatchEvent(new Event("online")); }); await h.page.clock.runFor(10); await sleep(200); const n0 = errors(h).length; await h.page.clock.runFor(1500); await sleep(200); const n1 = errors(h).length; await h.page.clock.runFor(1500); await sleep(200); const n2 = errors(h).length; await h.close(); return ok(n0 === 1 && n1 === 2 && n2 === 3, `${n0} → ${n1} → ${n2}`); });
N("…kept crashes left from a previous visit are sent as soon as a page opens with signal", async () => { const h = await page({ pre: `localStorage.setItem("${PEND}", JSON.stringify([{ kind: "error", message: "from yesterday", where: "w", panel: "manager", offlineAt: Date.now() - 600000 }]));` }); await until(() => errors(h).length >= 1, 4000); const r = errors(h)[0] || {}; await h.close(); return ok(r.message === "from yesterday" && /· offline, 10 min earlier$/.test(r.where), JSON.stringify(r)); });
N("…a kept crash that already says 'offline, … earlier' is re-worded, not stamped twice", async () => { const h = await page({ pre: `localStorage.setItem("${PEND}", JSON.stringify([{ kind: "error", message: "stamped", where: "w · offline, 3 min earlier", offlineAt: Date.now() }]));` }); await until(() => errors(h).length >= 1, 4000); const r = errors(h)[0] || {}; await h.close(); return ok(r.where === "w · offline, under a minute earlier", r.where); });
N("…a kept list the device garbled is ignored, and crashes still file normally", async () => { const h = await page({ pre: `localStorage.setItem("${PEND}", "{not json");` }); await h.page.evaluate(() => window.LFH_ERRLOG.report("after garble", "x")); await until(() => errors(h).length >= 1, 3000); const r = errors(h); await h.close(); return ok(r.length === 1 && r[0].message === "after garble" && !h.errors.length, JSON.stringify(r)); });
N("A beacon the browser REFUSES is kept on the device instead of lost", async () => { const h = await page({ pre: "navigator.sendBeacon = function(){ return false; };" }); await h.page.evaluate(() => window.LFH_ERRLOG.report("refused beacon", "x")); await sleep(200); const kept = await h.page.evaluate((k) => JSON.parse(localStorage.getItem(k) || "[]"), PEND); await h.close(); return ok(kept.length === 1 && kept[0].message === "refused beacon", JSON.stringify(kept)); });
N("A device with no beacon at all files through fetch (keepalive), as JSON", async () => { const h = await page({ pre: "navigator.sendBeacon = undefined;" }); await h.page.evaluate(() => window.LFH_ERRLOG.report("no beacon", "x")); await until(() => errors(h).length >= 1, 3000); const r = h.sent.find((x) => /client-error/.test(x.path)) || {}; await h.close(); return ok(r.method === "POST" && /application\/json/.test(r.headers["content-type"] || "") && JSON.parse(r.body).message === "no beacon", JSON.stringify({ m: r.method, ct: r.headers && r.headers["content-type"] })); });
N("…and if that fetch fails, the crash is kept on the device", async () => { const h = await page({ pre: "navigator.sendBeacon = undefined; window.fetch = function(){ return Promise.reject(new TypeError('Failed to fetch')); };" }); await h.page.evaluate(() => window.LFH_ERRLOG.report("fetch failed", "x")); await sleep(300); const kept = await h.page.evaluate((k) => JSON.parse(localStorage.getItem(k) || "[]"), PEND); await h.close(); return ok(kept.length === 1 && kept[0].message === "fetch failed", JSON.stringify(kept)); });

// ── 5. what a report carries ─────────────────────────────────────────────────────────────────
N("A message is cut to 300 characters and 'where' to 120", async () => { const h = await page(); await h.page.evaluate(() => window.LFH_ERRLOG.report("m".repeat(500), "w".repeat(400))); await until(() => errors(h).length >= 1, 3000); const r = errors(h)[0]; await h.close(); return ok(r.message.length === 300 && r.where.length === 120); });
N("…it carries the restaurant when live updates know it", async () => { const h = await page({ pre: "window.LFH_RT = { getRid: function(){ return 'rid-123'; } };" }); await h.page.evaluate(() => window.LFH_ERRLOG.report("with rid", "x")); await until(() => errors(h).length >= 1, 3000); const r = errors(h)[0]; await h.close(); return ok(r.rid === "rid-123", JSON.stringify(r)); });
N("…and none when they do not (or when asking throws)", async () => { const h = await page({ pre: "window.LFH_RT = { getRid: function(){ throw new Error('x'); } };" }); await h.page.evaluate(() => window.LFH_ERRLOG.report("no rid", "x")); await until(() => errors(h).length >= 1, 3000); const r = errors(h)[0]; await h.close(); return ok(!("rid" in r), JSON.stringify(r)); });
for (const [path, want] of [["/panels/tablet/t16.html", "tablet"], ["/panels/kitchen/t16.html", "kitchen"], ["/panels/editor/t16.html", "manager"]]) {
  N(`A crash on ${path.split("/")[2]}'s page is filed as '${want}'`, async () => { const h = await page({ path, boom: false, pages: { [path]: `<!doctype html><meta charset="utf-8"><body><script src="/panels/errlog.js"></script>` } }); await h.page.waitForFunction(() => !!window.LFH_ERRLOG); await h.page.evaluate(() => window.LFH_ERRLOG.report("which panel", "x")); await until(() => errors(h).length >= 1, 3000); const r = errors(h)[0] || {}; await h.close(); return ok(r.panel === want, JSON.stringify(r)); });
}

// ── 6. the tap breadcrumbs ───────────────────────────────────────────────────────────────────
const hide = (p) => p.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, get: () => true }); document.dispatchEvent(new Event("visibilitychange")); });
const taps = (h) => reports(h).filter((x) => x.kind === "taps").map((x) => JSON.parse(x.detail));
const TAPBODY = `<div class="topbar"><button id="a" data-log="Pay bill">x</button><button id="b" aria-label="Close">✕</button><button id="c" title="More">…</button>
  <button id="d">Visible<span hidden>SECRET</span><span style="display:none">ALSO</span></button><a class="btn" id="e">Link btn</a>
  <div class="lfh-conn"><button id="f">pill</button></div><span id="g">not a button</span></div>`;
N("Taps are sent in a batch when the page is hidden", async () => { const h = await page({ body: TAPBODY }); await h.page.click("#a"); await h.page.click("#b"); await hide(h.page); await sleep(200); const t = taps(h); await h.close(); return ok(t.length === 1 && t[0].length === 2, JSON.stringify(t)); });
N("…each tap is named by data-log, then aria-label, then title, then its visible words", async () => { const h = await page({ body: TAPBODY }); for (const s of ["#a", "#b", "#c", "#e"]) await h.page.click(s); await hide(h.page); await sleep(200); const t = (taps(h)[0] || []).map((x) => x.l); await h.close(); return ok(t.join("|") === "Pay bill|Close|More|Link btn", t.join("|")); });
N("…hidden words inside a button are never part of its name", async () => { const h = await page({ body: TAPBODY }); await h.page.click("#d"); await hide(h.page); await sleep(200); const t = (taps(h)[0] || []).map((x) => x.l); await h.close(); return ok(t.join() === "Visible", t.join()); });
N("…taps on the connection pill, and on things that are not buttons, are not recorded", async () => { const h = await page({ body: TAPBODY }); await h.page.click("#f"); await h.page.click("#g"); await h.page.click("#a"); await hide(h.page); await sleep(200); const t = (taps(h)[0] || []).map((x) => x.l); await h.close(); return ok(t.join() === "Pay bill", t.join()); });
N("…a tap whose handler stops the event is still recorded (the listener runs first)", async () => { const h = await page({ body: TAPBODY, after: "document.getElementById('a').addEventListener('click', function(e){ e.stopPropagation(); });" }); await h.page.click("#a"); await hide(h.page); await sleep(200); const t = (taps(h)[0] || []).map((x) => x.l); await h.close(); return ok(t.join() === "Pay bill", t.join()); });
N("…no taps, no batch", async () => { const h = await page({ body: TAPBODY }); await hide(h.page); await sleep(200); const n = taps(h).length; await h.close(); return ok(n === 0); });
N("…at most the last 60 taps are held between batches", async () => { const h = await page({ body: TAPBODY }); await h.page.evaluate(() => { const b = document.getElementById("a"); for (let i = 0; i < 75; i++) b.click(); }); await hide(h.page); await sleep(200); const t = taps(h)[0] || []; await h.close(); return ok(t.length === 60, `${t.length} held`); });
N("…the batch is also sent every 30 seconds while the page stays open", async () => { const h = await page({ body: TAPBODY, before: (p) => p.clock.install() }); await h.page.click("#a"); await h.page.clock.runFor(30500); await sleep(200); const n = taps(h).length; await h.close(); return ok(n === 1, `${n} batch(es)`); });
N("…and when the page is closed (pagehide)", async () => { const h = await page({ body: TAPBODY }); await h.page.click("#a"); await h.page.evaluate(() => window.dispatchEvent(new Event("pagehide"))); await sleep(200); const n = taps(h).length; await h.close(); return ok(n === 1); });
N("…a tap batch is cut to 1,500 characters", async () => { const h = await page({ body: '<div class="topbar"><button id="a" data-log="' + "x".repeat(40) + '">x</button></div>' }); await h.page.evaluate(() => { const b = document.getElementById("a"); for (let i = 0; i < 60; i++) b.click(); }); await hide(h.page); await sleep(200); const r = reports(h).find((x) => x.kind === "taps"); await h.close(); return ok(r && r.detail.length === 1500, r && r.detail.length); });

done();
