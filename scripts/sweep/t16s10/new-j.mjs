// scripts/sweep/t16s10/new-j.mjs — NEW checks, sweep #10 T16 ROUND 2, ids from P185821.
// The smaller files' never-run lines (round-2 coverage): the queue's stock-sheet labels and its
// "signed out mid-tap" path, the offline sheet's Send now / times / host, the undo card's swipe away,
// the number shortener, the offline-layer registrar (kill switch, update, warm-up), the photo
// shrinker's fall-backs, and every shared file loaded LATE (after the page had finished parsing —
// the tablet's iframe re-mount). Every request is answered by the test. Nothing reaches a server.
/* eslint-disable @typescript-eslint/no-unused-vars -- a check suite: helpers are imported whole */
import { R, ok, eq, tag } from "./lib.mjs";
import { harness, sleep, until, PACE } from "./browser.mjs";

const done = tag("new-j");
let id = 185821;
const N = (file, what, fn) => R(`P${id++}`, file, what, fn, "headless: the real shared file(s), every request answered by the test");
const TOP = '<div class="topbar"><div class="top-actions"><button id="themeToggle">t</button></div></div>';
const OFF = "Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>window.__on!==false});";

// ── 1. outbox.js — the stock sheet's labels, and signed out mid-tap ──────────────────────────
const LBL = {};
async function labels() {
  if (LBL.r) return LBL.r;
  const h = await harness({ pre: OFF + "window.__on=false;" + PACE, body: TOP, scripts: ["outbox.js"], api: () => ({ status: 200, body: {} }) });
  const paths = ["/production", "/counts/c1/line", "/counts/c1/submit", "/counts/c1/discard", "/counts", "/expenses", "/expenses/e1/void", "/purchases", "/purchases/p1/void", "/waste", "/waste/w1/void", "/vendors/v1", "/recipes/r1", "/items", "/something-else"];
  LBL.r = await h.page.evaluate(async (paths) => { const out = {}; for (const p of paths) { await window.LFH_OUTBOX.send({ base: "/api/inventory", method: "POST", path: p + "?x=1", body: {} }); } window.LFH_OUTBOX.getSnapshot().queued.forEach((q) => { out[q.path.split("?")[0]] = q.label; }); return out; }, paths);
  await h.close(); return LBL.r;
}
N("outbox.js", "Stock sheet: a count's three steps each have their own words", async () => { const r = await labels(); return ok(r["/counts"] === "Start a stock count" && r["/counts/c1/line"] === "Save a counted quantity" && r["/counts/c1/submit"] === "Submit the stock count" && r["/counts/c1/discard"] === "Discard the stock count", JSON.stringify(r)); });
N("outbox.js", "…an expense, and striking one out", async () => { const r = await labels(); return ok(r["/expenses"] === "Record an expense" && r["/expenses/e1/void"] === "Strike out an expense"); });
N("outbox.js", "…a purchase, and voiding one", async () => { const r = await labels(); return ok(r["/purchases"] === "Record a purchase" && r["/purchases/p1/void"] === "Void a purchase"); });
N("outbox.js", "…waste, and undoing it", async () => { const r = await labels(); return ok(r["/waste"] === "Record waste" && r["/waste/w1/void"] === "Undo a waste entry"); });
N("outbox.js", "…a batch, a supplier, a recipe and an ingredient", async () => { const r = await labels(); return ok(r["/production"] === "Make a batch" && r["/vendors/v1"] === "Save a supplier" && r["/recipes/r1"] === "Save a recipe" && r["/items"] === "Save an ingredient", JSON.stringify(r)); });
N("outbox.js", "…and a stock path with no words of its own still gets a readable label, never the raw path", async () => { const r = await labels(); const l = r["/something-else"] || ""; return ok(l === "Something else", l); });
async function signedOut(frame) {
  const h = await harness({ pre: PACE, path: frame ? "/__t16/outer.html" : undefined, body: TOP, scripts: ["outbox.js"],
    pages: { "/login": "<!doctype html><title>login</title>sign in", "/__t16/outer.html": '<!doctype html><title>outer</title><iframe src="/__t16/h.html"></iframe>' },
    api: (rec) => (/tables\/4\/pay/.test(rec.path) ? { status: 401, body: { error: "login" } } : { status: 200, body: {} }) });
  const f = frame ? await until(() => !!h.page.frames().find((x) => /h\.html/.test(x.url())), 5000).then(() => h.page.frames().find((x) => /h\.html/.test(x.url()))) : h.page;
  await f.waitForFunction(() => !!window.LFH_OUTBOX);
  const p = f.evaluate(() => window.LFH_OUTBOX.send({ base: "", method: "POST", path: "/api/editor/tables/4/pay", body: {} }).catch((e) => "threw:" + e.message));
  const left = await until(() => /\/login$/.test(h.page.url()), 5000, 50);
  const r = { left, url: h.page.url(), threw: await p.catch(() => "gone") };
  await h.close(); return r;
}
N("outbox.js", "Signed out mid-tap (401): the change is KEPT and the window goes to the sign-in page", async () => { const r = await signedOut(false); return ok(r.left, JSON.stringify(r)); });
N("outbox.js", "…from inside a panel frame it is the WHOLE window that goes, not the frame", async () => { const r = await signedOut(true); return ok(r.left && /\/login$/.test(r.url), JSON.stringify(r)); });
N("outbox.js", "…and the kept change is in the device's store, marked 'signedout', ready for after sign-in", async () => {
  const h = await harness({ pre: PACE, body: TOP, scripts: ["outbox.js"], pages: { "/login": "<!doctype html>sign in" }, api: (rec) => (/pay/.test(rec.path) ? { status: 401, body: {} } : { status: 200, body: {} }) });
  await h.page.evaluate(() => { window.LFH_OUTBOX.send({ base: "", method: "POST", path: "/api/editor/tables/4/pay", body: { a: 1 } }).catch(() => {}); });
  await until(() => /\/login$/.test(h.page.url()), 5000, 50);
  const kept = await h.page.evaluate(() => new Promise((res) => { const o = indexedDB.open("lfh_outbox"); o.onsuccess = () => { const d = o.result; const st = [...d.objectStoreNames][0]; const r = d.transaction(st).objectStore(st).getAll(); r.onsuccess = () => res(r.result.map((x) => ({ p: x.path, w: x.why, s: x.status }))); r.onerror = () => res("err"); }; o.onerror = () => res("noopen"); }));
  await h.close(); return ok(Array.isArray(kept) && kept.some((x) => /tables\/4\/pay/.test(x.p)), JSON.stringify(kept));
});

// ── 2. offline.js — the sheet's Send now, the times, and where the bar sits ──────────────────
const BAR = (over) => `window.LFH_OUTBOX={_l:[],_s:{queued:[],failed:[],count:0,syncing:false},onChange:function(cb){this._l.push(cb);cb(this._s)},waitingSince:function(){return window.__since||0},nextTryAt:function(){return window.__next||0},storageFailed:function(){return false},pendingByTable:function(){return {}},blockedByTable:function(){return {}},flush:function(){window.__flushed=(window.__flushed||0)+1},retryOne:function(){},dismiss:function(){}};window.__push=function(s){window.LFH_OUTBOX._s=s;window.LFH_OUTBOX._l.forEach(function(f){f(s)})};window.LFH_TEST_PACING={stuck:300};${over || ""}`;
async function sheet(items, o = {}) {
  const h = await harness({ pre: BAR(OFF + "window.LFH_RT={getStatus:()=>'online',everConnected:()=>true};"), body: o.noTopbar ? "<main id=m>panel</main>" : TOP, scripts: ["backstack.js", "offline.js"], api: () => ({ status: 200, body: {} }) });
  await h.page.evaluate((q) => window.__push({ queued: q, failed: [], count: q.length, syncing: false }), items);
  await sleep(o.wait || 500);
  await h.page.evaluate(() => window.LFH_OFF && window.LFH_OFF.open && window.LFH_OFF.open()); await sleep(250);
  return h;
}
const ago = (ms) => Date.now() - ms;
N("offline.js", "A change that hasn't gone through for a while gets ONE 'Send now' button, on the first row", async () => { const h = await sheet([{ id: "a", label: "Settle bill · Table 1", at: ago(5000), why: "slow" }, { id: "b", label: "Apply discount · Table 2", at: ago(5000), why: "slow" }]); const n = await h.page.evaluate(() => [...document.querySelectorAll(".lfh-off-sheet .lfh-off-ok")].filter((b) => b.textContent === "Send now").length); await h.close(); return ok(n === 1, `${n} button(s)`); });
N("offline.js", "…tapping it sends the whole queue, in order", async () => { const h = await sheet([{ id: "a", label: "Settle bill · Table 1", at: ago(5000), why: "slow" }]); await h.page.evaluate(() => { const b = [...document.querySelectorAll(".lfh-off-sheet .lfh-off-ok")].find((x) => x.textContent === "Send now"); b && b.click(); }); await sleep(200); const f = await h.page.evaluate(() => window.__flushed || 0); await h.close(); return ok(f >= 1, `${f} flush(es)`); });
N("offline.js", "…a change made just now is 'Sending now…' with no button (not nagged straight away)", async () => { const h = await sheet([{ id: "a", label: "Settle bill · Table 1", at: Date.now(), why: "slow" }], { wait: 50 }); const r = await h.page.evaluate(() => ({ t: (document.querySelector(".lfh-off-sheet") || {}).textContent || "", n: [...document.querySelectorAll(".lfh-off-sheet .lfh-off-ok")].filter((b) => b.textContent === "Send now").length })); await h.close(); return ok(/Sending now…/.test(r.t) && r.n === 0, JSON.stringify(r)); });
N("offline.js", "Times read the way a person says them: 'a moment ago', 'N min ago', then the clock", async () => { const h = await sheet([{ id: "a", label: "A", at: Date.now() }, { id: "b", label: "B", at: ago(7 * 60000) }, { id: "c", label: "C", at: new Date(new Date().setHours(9, 5, 0, 0)).getTime() - 86400000 /* yesterday: never "N min ago", whatever the hour now */ }]); const t = await h.page.evaluate(() => [...document.querySelectorAll(".lfh-off-when")].map((x) => x.textContent)); await h.close(); return ok(t[0] === "You did this a moment ago" && t[1] === "You did this 7 min ago" && /^You did this 9:05 am$/.test(t[2]), JSON.stringify(t)); });
N("offline.js", "…an afternoon time says pm, and noon reads 12, not 0", async () => { const h = await sheet([{ id: "a", label: "A", at: new Date(new Date().setHours(12, 40, 0, 0)).getTime() - 86400000 }, { id: "b", label: "B", at: new Date(new Date().setHours(21, 3, 0, 0)).getTime() - 86400000 }]); const t = await h.page.evaluate(() => [...document.querySelectorAll(".lfh-off-when")].map((x) => x.textContent)); await h.close(); return ok(t[0] === "You did this 12:40 pm" && t[1] === "You did this 9:03 pm", JSON.stringify(t)); });
N("offline.js", "…a change with no time on it reads 'earlier', never 'NaN'", async () => { const h = await sheet([{ id: "a", label: "A", at: 0 }]); const t = await h.page.evaluate(() => [...document.querySelectorAll(".lfh-off-when")].map((x) => x.textContent)); await h.close(); return ok(t[0] === "You did this earlier", JSON.stringify(t)); });
N("offline.js", "On a page with no top bar the offline bar goes at the very top of the page", async () => { const h = await harness({ pre: BAR(OFF + "window.__on=false;"), body: "<main id=m>panel</main>", scripts: ["backstack.js", "offline.js"], api: () => ({ status: 200, body: {} }) }); await h.page.evaluate(() => window.dispatchEvent(new Event("offline"))); await sleep(300); const r = await h.page.evaluate(() => { const b = document.querySelector(".lfh-offbar"); return { has: !!b, first: b && document.body.firstElementChild === b }; }); await h.close(); return ok(r.has && r.first, JSON.stringify(r)); });

// ── 3. undobar.js — swiping the card away ────────────────────────────────────────────────────
async function undo() {
  const h = await harness({ body: TOP, scripts: ["undobar.js"], api: () => ({ status: 200, body: {} }) });
  await h.page.evaluate(() => { window.__undone = 0; window.LFH_UNDO.show({ message: "Removed Paneer Tikka", ms: 20000, onUndo: function () { window.__undone++; } }); });
  await sleep(250); return h;
}
const card = (p) => p.evaluate(() => { const c = document.getElementById("lfh-undobar"); if (!c) return null; const r = c.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, shown: c.classList.contains("show"), t: c.style.transform, o: c.style.opacity }; });
const drag = async (p, dx, dy, at) => { const c = at || await card(p); await p.mouse.move(c.x, c.y); await p.mouse.down(); for (let i = 1; i <= 6; i++) await p.mouse.move(c.x + (dx * i) / 6, c.y + (dy * i) / 6); const mid = await card(p); await p.mouse.up(); await sleep(400); return mid; };
N("undobar.js", "A flick of 80 px sideways throws the undo card away", async () => { const h = await undo(); await drag(h.page, 80, 0); const c = await card(h.page); const u = await h.page.evaluate(() => window.__undone); await h.close(); return ok((!c || !c.shown) && u === 0, JSON.stringify({ c, u })); });
N("undobar.js", "…so does a flick of 80 px downwards", async () => { const h = await undo(); await drag(h.page, 0, 80); const c = await card(h.page); await h.close(); return ok(!c || !c.shown, JSON.stringify(c)); });
N("undobar.js", "…a 30 px wobble while reading does NOT — the card snaps back into place", async () => { const h = await undo(); await drag(h.page, 30, 0); const c = await card(h.page); await h.close(); return ok(c && c.shown && !c.t, JSON.stringify(c)); });
N("undobar.js", "…dragging UP never moves it (only down and sideways)", async () => { const h = await undo(); const mid = await drag(h.page, 0, -80); const c = await card(h.page); await h.close(); return ok(/translate\(0px, 0px\)/.test(mid.t) && c && c.shown, JSON.stringify({ mid, c })); });
N("undobar.js", "…the card fades as it goes, never below a quarter", async () => { const h = await undo(); const c0 = await card(h.page); await h.page.mouse.move(c0.x, c0.y); await h.page.mouse.down(); await h.page.mouse.move(c0.x + 80, c0.y); const a = await card(h.page); await h.page.mouse.move(c0.x + 400, c0.y); const b = await card(h.page); await h.page.mouse.up(); await h.close(); return ok(Number(a.o) === 0.5 && Number(b.o) === 0.25, JSON.stringify({ a: a.o, b: b.o })); });
N("undobar.js", "…a drag that starts ON the UNDO button is not a swipe — the tap still undoes", async () => { const h = await undo(); const b = await h.page.evaluate(() => { const r = document.querySelector(".lfh-undo-btn").getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }); const mid = await drag(h.page, 80, 0, b); await h.page.click(".lfh-undo-btn").catch(() => {}); await sleep(200); const u = await h.page.evaluate(() => window.__undone); await h.close(); return ok(!mid.t && u === 1, JSON.stringify({ mid, u })); });

// ── 4. fitnums.js — shortening a count that will not fit ─────────────────────────────────────
async function fitText(text, exact) {
  const h = await harness({ body: `<div style="width:26px;overflow:hidden"><span id="n" data-fit-num ${exact ? "data-fit-exact" : ""} style="font-size:20px;white-space:nowrap;display:inline-block;max-width:26px">${text}</span></div>`, scripts: ["fitnums.js"], api: () => ({ status: 200, body: {} }) });
  await sleep(300); await h.page.evaluate(() => window.LFH_FITNUM.scan()); await sleep(100);
  const t = await h.page.evaluate(() => document.getElementById("n").textContent); await h.close(); return t;
}
N("fitnums.js", "A count too wide to fit is shortened the Indian way: 1,50,000 → 1.5 L", async () => { const t = await fitText("1,50,000"); return ok(t === "1.5 L", t); });
N("fitnums.js", "…1,23,45,678 → 1.2 Cr", async () => { const t = await fitText("1,23,45,678"); return ok(t === "1.2 Cr", t); });
N("fitnums.js", "…25,000 → 25K, keeping what is around the number", async () => { const t = await fitText("×25,000 seen"); return ok(t === "×25K seen", t); });
N("fitnums.js", "…but money marked exact is NEVER shortened, however narrow", async () => { const t = await fitText("₹1,50,000", true); return ok(t === "₹1,50,000", t); });
N("fitnums.js", "…and a figure under 1,000 is never shortened", async () => { const t = await fitText("999"); return ok(t === "999", t); });

// ── 5. swreg.js — the offline layer's registrar ──────────────────────────────────────────────
const SW = `window.__sw = { reg: [], kill: 0, unreg: 0, upd: 0, posts: [] };
Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: {
  controller: window.__ctl ? { postMessage: function (m) { window.__sw.posts.push(m); } } : null,
  register: function (u, o) { window.__sw.reg.push([u, o && o.scope]); return Promise.resolve({ update: function () { window.__sw.upd++; } }); },
  getRegistrations: function () { return Promise.resolve([{ active: { postMessage: function (m) { if (m.type === "LFH_SW_KILL") window.__sw.kill++; } }, unregister: function () { window.__sw.unreg++; } }]); },
  addEventListener: function (n, f) { window.__sw.cc = f; },
} });`;
async function swreg(o = {}) { const h = await harness({ pre: (o.ctl ? "window.__ctl = true;" : "") + SW, path: o.path, body: TOP, scripts: ["swreg.js"], api: () => ({ status: 200, body: {} }) }); await sleep(300); return h; }
N("swreg.js", "A panel registers the offline layer at /sw.js for the whole site", async () => { const h = await swreg(); const r = await h.page.evaluate(() => window.__sw.reg); await h.close(); return ok(JSON.stringify(r) === '[["/sw.js","/"]]', JSON.stringify(r)); });
N("swreg.js", "…coming back to the tab asks the layer to check for a newer version", async () => { const h = await swreg(); await h.page.evaluate(() => { Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" }); document.dispatchEvent(new Event("visibilitychange")); }); await sleep(100); const u = await h.page.evaluate(() => window.__sw.upd); await h.close(); return ok(u === 1, `${u} update(s)`); });
N("swreg.js", "…?nosw switches the layer OFF: it is told to stop and unregistered, and nothing new registers", async () => { const h = await swreg({ path: "/__t16/h.html?nosw=1" }); const r = await h.page.evaluate(() => window.__sw); await h.close(); return ok(r.kill === 1 && r.unreg === 1 && r.reg.length === 0, JSON.stringify(r)); });
N("swreg.js", "…an already-controlled page warms the layer with this page and its own assets", async () => { const h = await swreg({ ctl: true }); const p = await h.page.evaluate(() => window.__sw.posts.find((m) => m.type === "LFH_WARM_SHELL")); await h.close(); return ok(p && /h\.html/.test(p.url) && Array.isArray(p.assets) && p.assets.every((a) => a.startsWith("http://localhost")), JSON.stringify(p)); });
N("swreg.js", "…a page not yet controlled warms it the moment the layer takes over", async () => { const h = await swreg(); const before = await h.page.evaluate(() => window.__sw.posts.length); await h.page.evaluate(() => { navigator.serviceWorker.controller = { postMessage: function (m) { window.__sw.posts.push(m); } }; window.__sw.cc && window.__sw.cc(); }); const after = await h.page.evaluate(() => window.__sw.posts.map((m) => m.type)); await h.close(); return ok(before === 0 && after.includes("LFH_WARM_SHELL"), JSON.stringify({ before, after })); });
N("swreg.js", "A browser with no offline layer at all is left alone, with no error", async () => { const h = await harness({ pre: "delete Navigator.prototype.serviceWorker;", body: TOP, scripts: ["swreg.js"], api: () => ({ status: 200, body: {} }) }); await sleep(200); const e = h.errors; await h.close(); return ok(!e.length, e.join(" | ")); });

// ── 6. shrinkimg.js — its fall-backs hand back the ORIGINAL ──────────────────────────────────
async function shrinkWith(pre) {
  const h = await harness({ pre, body: "<div></div>", scripts: ["shrinkimg.js"], api: () => ({ status: 200, body: {} }) });
  const r = await h.page.evaluate(async () => { const c = document.createElement("canvas"); c.width = 2600; c.height = 1800; const x = c.getContext && HTMLCanvasElement.prototype.__realGet ? HTMLCanvasElement.prototype.__realGet.call(c, "2d") : null; const b = await new Promise((res) => (HTMLCanvasElement.prototype.__realToBlob || HTMLCanvasElement.prototype.toBlob).call(c, res, "image/png")); const f = new File([b], "big.png", { type: "image/png" }); const out = await window.LFH_IMG.shrink(f); return { same: out.file === f, changed: out.changed, note: out.note }; });
  await h.close(); return r;
}
N("shrinkimg.js", "A device whose canvas gives no drawing surface keeps the original photo", async () => { const r = await shrinkWith("HTMLCanvasElement.prototype.__realToBlob = HTMLCanvasElement.prototype.toBlob; HTMLCanvasElement.prototype.getContext = function(){ return null; };"); return ok(r.same && r.changed === false && r.note === "", JSON.stringify(r)); });
N("shrinkimg.js", "…a device with no toBlob keeps the original photo", async () => { const r = await shrinkWith("HTMLCanvasElement.prototype.__realToBlob = HTMLCanvasElement.prototype.toBlob; HTMLCanvasElement.prototype.toBlob = undefined;"); return ok(r.same && r.changed === false, JSON.stringify(r)); });

// ── 7. every shared file loaded LATE (after the page finished parsing) ───────────────────────
async function late(file, check) {
  const h = await harness({ body: TOP + '<div class="hscroll" style="width:120px;overflow-x:auto;white-space:nowrap"><span style="display:inline-block;width:600px">wide</span></div><span data-fit-num style="font-size:20px">12</span>', scripts: [], api: () => ({ status: 200, body: {} }) });
  await h.page.addScriptTag({ url: "/panels/" + file }); await sleep(300);
  const r = await h.page.evaluate(check); const e = h.errors; await h.close(); return { r, e };
}
N("theme.js", "Loaded after the page has parsed, the theme button is still wired", async () => { const x = await late("theme.js", () => { const b = document.getElementById("themeToggle"); const before = document.documentElement.dataset.theme || document.documentElement.className; b.click(); return { wired: !!b.__themeWired, changed: (document.documentElement.dataset.theme || document.documentElement.className) !== before }; }); return ok(x.r.wired && x.r.changed && !x.e.length, JSON.stringify(x)); });
N("fitnums.js", "Loaded late, the number fitter still starts", async () => { const x = await late("fitnums.js", () => !!window.LFH_FITNUM); return ok(x.r && !x.e.length, JSON.stringify(x)); });
N("swipehint.js", "Loaded late, the swipe hint still starts and raises no error", async () => { const x = await late("swipehint.js", () => !!window.LFH_SWIPE); return ok(x.r && !x.e.length, JSON.stringify(x)); });
N("auditsort.js", "An action no group names lands in 'Everything else', never nowhere", async () => { const h = await harness({ body: "<div></div>", scripts: ["auditsort.js"], api: () => ({ status: 200, body: {} }) }); const r = await h.page.evaluate(() => [window.LFH_AUDITSORT.activityGroupOf("zz_made_up"), window.LFH_AUDITSORT.activityGroupOf(""), window.LFH_AUDITSORT.activityGroupOf(null)]); await h.close(); return ok(r.every((x) => x === "other"), JSON.stringify(r)); });
N("guestbell.js", "A 'seen' list the device garbled is ignored, and the bell still works", async () => { const h = await harness({ pre: "localStorage.setItem('lfh_bell_seen', '{not json');", body: TOP, scripts: ["backstack.js", "guestbell.js"], api: () => ({ status: 200, body: {} }) }); await sleep(300); const r = { e: h.errors, bell: await h.page.evaluate(() => !!window.LFH_BELL) }; await h.close(); return ok(r.bell && !r.e.length, JSON.stringify(r)); });

done();
