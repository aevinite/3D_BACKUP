// scripts/sweep/t16s10/new-n.mjs — NEW checks, sweep #10 T16 ROUND 2, ids from P185954.
// AIMED BY MUTATION, pass 2's survivors that change something a person or the server can see. (The
// ones that change nothing — listed with their reason in the round-2 findings — get no row.)
/* eslint-disable @typescript-eslint/no-unused-vars -- a check suite: helpers are imported whole */
import { R, ok, tag, ROUTES } from "./lib.mjs";
import { harness, sleep, until, PACE } from "./browser.mjs";
import { call, world, g } from "./routes.mjs";

const done = tag("new-n");
let id = 185954;
const N = (file, what, fn, how) => R(`P${id++}`, file, what, fn, how || "headless: the real shared file(s), every request answered by the test (aimed by mutation pass 2)");
const TOP = '<div class="topbar"><div class="top-actions"></div></div>';
const OFF = "Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>window.__on!==false});";

// ══ auditsort.js — the tie-breaks ═══════════════════════════════════════════════════════════
async function as() { return harness({ body: "<div></div>", scripts: ["auditsort.js"], api: () => ({ status: 200, body: {} }) }); }
N("auditsort.js", "Type chips with the SAME count are listed A–Z (never in arrival order)", async () => { const h = await as(); const r = await h.page.evaluate(() => window.LFH_AUDITSORT.kindCounts([{ kind: "void" }, { kind: "discount" }, { kind: "void" }, { kind: "discount" }, { kind: "comp" }], { void: "Voids", discount: "Discounts", comp: "On the house" }).map((x) => x.label)); await h.close(); return ok(r.join() === "Discounts,Voids,On the house", r.join()); });
N("auditsort.js", "Activity 'Type (A–Z)': different types made at the SAME moment sort by type name, not by row id", async () => { const h = await as(); const r = await h.page.evaluate(() => { const L = window.LFH_AUDITSORT; const at = "2026-10-01T10:00:00Z"; const rows = [{ id: 1, action: "maintenance_on", created_at: at }, { id: 2, action: "kot_printed", created_at: at }, { id: 3, action: "password_change", created_at: at }]; const s = L.ACTIVITY_SORTS.find((x) => x.id === "kind"); const lab = (a) => L.activityGroupLabel(L.activityGroupOfRow(a)); return rows.slice().sort(s.cmp).map(lab); }); await h.close(); const sorted = r.slice().sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())); return ok(r.join() === sorted.join() && new Set(r).size > 1, r.join(" | ")); });
N("auditsort.js", "Activity 'Restaurant (A–Z)': two restaurants at the SAME moment sort by name, not by row id", async () => { const h = await as(); const r = await h.page.evaluate(() => { const s = window.LFH_AUDITSORT.ACTIVITY_SORTS.find((x) => x.id === "restaurant"); const at = "2026-10-01T10:00:00Z"; return [{ id: 1, restaurant_name: "Zest", created_at: at }, { id: 2, restaurant_name: "Aangan", created_at: at }].sort(s.cmp).map((x) => x.restaurant_name); }); await h.close(); return ok(r.join() === "Aangan,Zest", r.join()); });

// ══ realtime.js — keep-alive and catch-up ═══════════════════════════════════════════════════
const FAKE_SB = `export function createClient(){ const w = (window.__sb = window.__sb || { made: 0, channels: [], removed: 0 }); w.made++; return { channel(n){ const ch = { name: n, h: [] }; w.channels.push(ch); const api = { on(k, f, cb){ ch.h.push(cb); return api; }, subscribe(cb){ setTimeout(() => cb("SUBSCRIBED"), 0); return api; } }; return api; }, removeChannel(){ w.removed++; } }; }`;
async function rt(after, o = {}) {
  const h = await harness({ pre: OFF + (o.pre || ""), body: TOP, scripts: ["realtime.js"], after,
    before: async (p) => { await p.route("**/vendor/supabase.js", (r) => r.fulfill({ contentType: "application/javascript", body: FAKE_SB })); if (o.clock) await p.clock.install(); },
    api: (rec) => (/rt-config/.test(rec.path) ? { status: 200, body: { url: "https://stub.example", anonKey: "k", restaurantId: "11111111-1111-4111-8111-111111111111" } } : { status: 200, body: {} }) });
  if (o.clock) for (let i = 0; i < 60 && !(await h.page.evaluate(() => !!(window.__sb && window.__sb.channels.length))); i++) { await sleep(100); await h.page.clock.runFor(100); }
  return h;
}
const hide = (p) => p.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, get: () => true }); document.dispatchEvent(new Event("visibilitychange")); });
N("realtime.js", "A keep-alive answer that THROWS counts as 'no': a hidden tab still lets its socket go after two minutes", async () => { const h = await rt("window.LFH_RT.start({ handlers: { ops: function(){} }, keepAlive: function(){ throw new Error('x'); } });", { clock: true }); await hide(h.page); await h.page.clock.runFor(125000); const r = await h.page.evaluate(() => window.__sb.removed); await h.close(); return ok(r >= 1, `${r} channel(s) let go`); });
N("realtime.js", "Catch-up never polls while the socket is live", async () => { const h = await rt("window.__polls = 0; window.LFH_RT.start({ handlers: { ops: function(){} } }); window.__stop = window.LFH_RT.catchUp(function(){ window.__polls++; return Promise.resolve(); }, { baseMs: 1000, maxMs: 2000 });", { clock: true }); await h.page.clock.runFor(1500); const st = await h.page.evaluate(() => window.LFH_RT.getStatus()); await h.page.evaluate(() => { window.__polls = 0; }); await h.page.clock.runFor(10000); const n = await h.page.evaluate(() => window.__polls); await h.close(); return ok(st === "online" && n === 0, JSON.stringify({ st, n })); });
N("realtime.js", "…nor while the tab is hidden, when a keep-alive that throws says 'no'", async () => { const h = await harness({ pre: OFF, before: (p) => p.clock.install(), body: TOP, scripts: ["realtime.js"], after: "window.__polls = 0; window.LFH_RT.start({ handlers: { ops: function(){} }, keepAlive: function(){ throw new Error('x'); } }); window.LFH_RT.catchUp(function(){ window.__polls++; return Promise.resolve(); }, { baseMs: 1000, maxMs: 2000 });", api: (rec) => (/rt-config/.test(rec.path) ? { status: 503, body: {} } : { status: 200, body: {} }) }); await hide(h.page); await h.page.evaluate(() => { window.__polls = 0; }); await h.page.clock.runFor(10000); const n = await h.page.evaluate(() => window.__polls); await h.close(); return ok(n === 0, `${n} polls while hidden`); });
N("realtime.js", "The older calling style ({ topics, onEvent }) with no onEvent still runs, quietly", async () => { const h = await rt("window.LFH_RT.start({ topics: ['ops'] });"); await until(() => h.page.evaluate(() => !!(window.__sb && window.__sb.channels.length)), 5000); await h.page.evaluate(() => { const ch = window.__sb.channels.find((c) => c.name.startsWith("rt:ops")); ch && ch.h.forEach((f) => f({ new: { restaurant_id: "11111111-1111-4111-8111-111111111111", table_number: 3, created_at: new Date().toISOString() } })); }); await sleep(700); const r = { e: h.errors, m: await h.page.evaluate(() => (window.LFH_RT.getMetrics ? window.LFH_RT.getMetrics().errors : 0)) }; await h.close(); return ok(!r.e.length && !r.m, JSON.stringify(r)); });

// ══ errlog.js — a tap's name ════════════════════════════════════════════════════════════════
const taps = async (body, sel) => { const h = await harness({ body, scripts: ["errlog.js"], api: () => ({ status: 200, body: { ok: true } }) }); await h.page.click(sel); await h.page.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, get: () => true }); document.dispatchEvent(new Event("visibilitychange")); }); await sleep(200); const r = h.sent.filter((x) => /client-error/.test(x.path)).map((x) => JSON.parse(x.body)).find((x) => x.kind === "taps"); await h.close(); return r ? JSON.parse(r.detail).map((x) => x.l) : []; };
N("errlog.js", "A button whose words are inside a child element is named by those words — and its hidden child is left out", async () => { const l = await taps('<button id="b"><span>Pay</span><span hidden>SECRET</span></button>', "#b"); return ok(l.join() === "Pay", l.join()); });
N("errlog.js", "…a child hidden by style (display:none) is left out too", async () => { const l = await taps('<button id="b"><b>Close</b> <i style="display:none">table 4 internals</i></button>', "#b"); return ok(l.join() === "Close", l.join()); });
N("errlog.js", "…a button with a title and no words is named by its title", async () => { const l = await taps('<button id="b" title="More options"></button>', "#b"); return ok(l.join() === "More options", l.join()); });

// ══ swreg.js ════════════════════════════════════════════════════════════════════════════════
N("swreg.js", "Reads offered before the layer is ready are held — EXACTLY 12 — and handed over when it takes over; malformed ones are dropped", async () => {
  const h = await harness({ pre: `window.__posts = []; window.__ctlcb = null; Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: { controller: null, register: function () { return new Promise(function (r) { window.__go = function () { navigator.serviceWorker.controller = { postMessage: function (m) { window.__posts.push(m); } }; r({ update: function () {} }); }; }); }, getRegistrations: function () { return Promise.resolve([]); }, addEventListener: function (n, f) { window.__ctlcb = f; } } });`, body: "<div></div>", scripts: ["swreg.js"], api: () => ({ status: 200, body: {} }) });
  await sleep(200);
  await h.page.evaluate(() => { for (let i = 0; i < 15; i++) window.LFH_WARM.data("/api/editor/summary?i=" + i, "{}"); window.LFH_WARM.data("", "{}"); window.LFH_WARM.data("/api/x", 5); window.__go(); });
  await sleep(300); const r = await h.page.evaluate(() => window.__posts.filter((m) => m.type === "LFH_WARM_DATA").map((m) => m.url)); await h.close();
  return ok(r.length === 12 && r[0] === "/api/editor/summary?i=0" && !r.includes("") && !r.includes("/api/x"), `${r.length} handed over`);
});

// ══ myprofile.js ════════════════════════════════════════════════════════════════════════════
N("myprofile.js", "When ONLY the phone write is kept for later (the details went through), it still says 'Saved here for now'", async () => {
  const me = { staff: true, id: "u1", username: "w1", role: "tablet", phone: "1111111111", profileModule: true, profile: {}, completeness: { filled: 1, total: 8 }, job: {} };
  const h = await harness({ pre: PACE, body: TOP, scripts: ["backstack.js", "maint.js", "myprofile.js"], api: (rec) => (rec.method === "GET" ? { status: 200, body: me } : { status: 200, body: { ok: true } }) });
  await until(() => h.page.evaluate(() => !!window.LFH_ME), 5000);
  await h.page.evaluate(() => { const real = window.LFH_PROFILE_SAVE; window.LFH_PROFILE_SAVE = async function (body, o) { if ("phone" in body) return { ok: true, queued: true }; return real(body, o); }; });
  await h.page.evaluate(() => window.LFH_ME.open()); await h.page.waitForSelector("#meForm"); await h.page.fill('input[name="phone"]', "2222222222"); await h.page.click(".me-save"); await sleep(600);
  const d = await h.page.evaluate(() => { const o = [...document.querySelectorAll(".lfh-ov")].pop(); return o ? (o.querySelector(".lfh-h1") || {}).textContent : null; }); await h.close();
  return ok(d === "Saved here for now", String(d));
});
N("myprofile.js", "A profile read that THROWS (not just a 5xx) also keeps the button hidden and asks again later", async () => {
  let n = 0; const h = await harness({ pre: PACE + "window.LFH_TEST_PACING=Object.assign({},window.LFH_TEST_PACING,{boot:250});", body: '<div class="topbar"><div class="top-actions"><button id="myProfileBtn" hidden>me</button></div></div>', scripts: ["outbox.js", "myprofile.js"], api: async (rec, route) => { if (rec.method === "GET" && /panel-profile/.test(rec.path)) { n++; if (n === 1) { await route.abort("internetdisconnected"); return "handled"; } return { status: 200, body: { staff: true, profileModule: true, role: "manager", username: "m" } }; } return { status: 200, body: {} }; } });
  await sleep(150); const a = await h.page.evaluate(() => document.getElementById("myProfileBtn").hidden);
  const b = await until(() => h.page.evaluate(() => !document.getElementById("myProfileBtn").hidden), 4000); await h.close();
  return ok(a === true && b && n >= 2, JSON.stringify({ hiddenFirst: a, shownLater: b, reads: n }));
});

// ══ swipehint.js ════════════════════════════════════════════════════════════════════════════
const ROW = (id) => `<div id="${id}"><div data-swipe-hint data-swipe-count style="width:200px;overflow-x:auto;white-space:nowrap">` + Array.from({ length: 4 }, () => '<span style="display:inline-block;width:120px">t</span>').join("") + "</div></div>";
N("swipehint.js", "scan(part) watches every row inside that part — the first, the last and only those", async () => { const h = await harness({ pre: "window.MutationObserver = undefined;", body: `<div id="p">${ROW("a")}${ROW("b")}</div>${ROW("c")}`, scripts: [], api: () => ({ status: 200, body: {} }) }); await h.page.addScriptTag({ content: "document.querySelectorAll('[data-swipe-hint]').forEach(function(r){ r.setAttribute('data-wait', '1'); r.removeAttribute('data-swipe-hint'); });" }); await h.page.addScriptTag({ url: "/panels/swipehint.js" }); await h.page.evaluate(() => { document.querySelectorAll("[data-wait]").forEach((r) => r.setAttribute("data-swipe-hint", "")); window.LFH_SWIPE.scan(document.getElementById("p")); }); await sleep(300); const r = await h.page.evaluate(() => ["a", "b", "c"].map((x) => !!document.querySelector("#" + x + " .lfh-swipe-more"))); await h.close(); return ok(r.join() === "true,true,false", r.join()); });
N("swipehint.js", "A row whose ATTRIBUTE arrives on a node added later is watched; a text node added is ignored", async () => { const h = await harness({ body: "<div id=host></div>", scripts: ["swipehint.js"], api: () => ({ status: 200, body: {} }) }); await h.page.evaluate((html) => { const t = document.createElement("template"); t.innerHTML = html; const row = t.content.firstElementChild.firstElementChild; document.getElementById("host").appendChild(document.createTextNode("x")); document.getElementById("host").appendChild(row); }, ROW("z")); await sleep(350); const r = { chip: await h.page.evaluate(() => !!document.querySelector(".lfh-swipe-more")), e: h.errors }; await h.close(); return ok(r.chip && !r.e.length, JSON.stringify(r)); });

// ══ shrinkimg.js ════════════════════════════════════════════════════════════════════════════
N("shrinkimg.js", "An image file of size 0, and one the browser decodes with height 0, are both left alone", async () => { const h = await harness({ body: "<div></div>", scripts: ["shrinkimg.js"], api: () => ({ status: 200, body: {} }) }); const r = await h.page.evaluate(async () => { window.__decoded = 0; const real = window.createImageBitmap; window.createImageBitmap = async (f) => { window.__decoded++; return { width: 2000, height: 0, close() {} }; }; const empty = new File([], "e.png", { type: "image/png" }); const a = await window.LFH_IMG.shrink(empty); const c = document.createElement("canvas"); c.width = 10; c.height = 10; const bl = await new Promise((x) => c.toBlob(x, "image/png")); const f = new File([bl], "h0.png", { type: "image/png" }); const b = await window.LFH_IMG.shrink(f); return { emptySame: a.file === empty, emptyNotDecoded: window.__decoded === 1, h0Same: b.file === f && !b.changed }; }); await h.close(); return ok(r.emptySame && r.emptyNotDecoded && r.h0Same, JSON.stringify(r)); });

// ══ undobar.js ══════════════════════════════════════════════════════════════════════════════
N("undobar.js", "A downward drag of EXACTLY 60 px is still a wobble — only past 60 throws the card away", async () => { const h = await harness({ body: TOP, scripts: ["undobar.js"], api: () => ({ status: 200, body: {} }) }); await h.page.evaluate(() => window.LFH_UNDO.show({ message: "Removed", ms: 20000, onUndo: function () {} })); await sleep(250); const c = await h.page.evaluate(() => { const r = document.getElementById("lfh-undobar").getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }); await h.page.mouse.move(c.x, c.y); await h.page.mouse.down(); for (let i = 1; i <= 6; i++) await h.page.mouse.move(c.x, c.y + i * 10); await h.page.mouse.up(); await sleep(300); const a = await h.page.evaluate(() => document.getElementById("lfh-undobar").classList.contains("show")); await h.close(); return ok(a, `shown=${a}`); });

// ══ the client-error route — how the owner's phone alert reads ══════════════════════════════
N(ROUTES.clientError, "A crash alert names the screen in words when it knows it ('Owner dashboard › Feedback & problems')", async () => {
  await world(); await call("clientError", "POST", { body: { panel: "manager", message: "Cannot read properties of undefined", where: "/owner/issues" } }); await Promise.all(g().AFTER || []); const a = (g().ALERTS[0] || {}).text || "";
  return ok(/Screen: Owner dashboard › Feedback & problems/.test(a), a.slice(0, 200));
}, "in memory: the real route file, the stand-in alert (records, sends nothing)");
N(ROUTES.clientError, "…and the raw place, as reported, when no screen name fits it", async () => {
  await world(); await call("clientError", "POST", { body: { panel: "manager", message: "Odd boom", where: "zz-unknown-place" } }); await Promise.all(g().AFTER || []); const b = (g().ALERTS[0] || {}).text || "";
  return ok(/Screen: zz-unknown-place/.test(b), b.slice(0, 200));
}, "in memory: the real route file, the stand-in alert (records, sends nothing)");

done();
