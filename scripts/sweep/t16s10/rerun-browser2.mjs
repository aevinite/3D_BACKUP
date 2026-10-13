// scripts/sweep/t16s10/rerun-browser2.mjs — the FIRST sweep-#7 block's driven rows (P19101–P19234,
// P19580–P19585), re-run on today's files on the same-origin harness. Every /api call is answered here.
/* eslint-disable @typescript-eslint/no-unused-vars -- a re-run harness: each suite imports the shared helper set whole, and scenario objects carry fields only some rows read */
import { R, ok, eq, assert, tag, src } from "./lib.mjs";
import { harness, memo, until, sleep, PACE } from "./browser.mjs";

const done = tag("browser2");
const OB = "outbox.js", CB = "connbadge.js", OF = "offline.js", EL = "errlog.js", TH = "theme.js", FN = "fitnums.js",
  UB = "undobar.js", BS = "backstack.js", GB = "guestbell.js", SH = "swipehint.js", IR = "issue-raise.js", AS = "auditsort.js", MT = "maint.js";
const TOP = `<div class="topbar"><div class="top-actions"><button id="themeToggle" class="theme-toggle">x</button></div></div>`;
const okBody = { status: 200, body: { ok: true } };
const RTON = "window.LFH_RT={getStatus:()=>'online',everConnected:()=>true,getLatency:()=>({ms:120,at:Date.now()}),getLatencyHistory:()=>[120],onStatus:function(cb){cb('online')},onLatency:function(){return function(){}}};";

// ── the modules on one harness page (P19101, P19106, P19109–P19124) ──
const mods = memo(async () => {
  const h = await harness({ pre: PACE + RTON + "window.__beacons=[];navigator.sendBeacon=function(u,b){window.__beacons.push(b);return true};",
    body: TOP + `<div style="width:44px"><span class="ordtotal" id="ord" style="font-size:20px">₹1,23,45,678</span></div><div style="width:44px"><span class="fit-num" id="tile" style="font-size:20px">₹1,23,45,678</span></div>`,
    scripts: [TH, BS, OB, CB, OF, EL, FN + '|data-fit=".ordtotal"', UB, GB, AS], api: () => okBody });
  await sleep(300);
  const r = await h.page.evaluate(async () => {
    const o = {};
    o.snapKeys = await new Promise((ok) => window.LFH_OUTBOX.onChange((s) => ok(Object.keys(s).sort())));
    o.pillParent = (document.getElementById("lfhConnBadge") || {}).parentNode && document.getElementById("lfhConnBadge").parentNode.className;
    const A = window.LFH_AUDITSORT;
    o.words = Object.keys(A.KIND_RISK).every((k) => A.KIND_LABEL[k] && !/_/.test(A.KIND_LABEL[k]));
    o.glyphs = Object.keys(A.KIND_RISK).every((k) => A.KIND_ICON[k]);
    const rows = [{ id: 1, amount: 50 }, { id: 2, amount: null }, { id: 3, amount: 50 }];
    const copy = JSON.stringify(rows); o.sortA = A.sortRows(rows, "amount").map((x) => x.id).join(","); o.unmut = JSON.stringify(rows) === copy;
    // crashes with no signal
    Object.defineProperty(navigator, "onLine", { configurable: true, get: () => window.__on !== false });
    window.__on = false; localStorage.removeItem("lfh_errlog_pending");
    window.LFH_ERRLOG.report("kept while offline", "app.js@abcd1234:100");
    o.kept = JSON.parse(localStorage.getItem("lfh_errlog_pending") || "[]").length;
    // re-kept: the beacon refuses, then accepts
    navigator.sendBeacon = function (u, b) { window.__beacons.push(b); return window.__accept === true; };
    window.__on = true; window.dispatchEvent(new Event("online")); await new Promise((ok) => setTimeout(ok, 200));
    window.__accept = true; window.dispatchEvent(new Event("online")); await new Promise((ok) => setTimeout(ok, 200));
    const last = window.__beacons.length ? JSON.parse(await window.__beacons[window.__beacons.length - 1].text()) : {};
    o.where = last.where || ""; o.offlineNotes = (o.where.match(/offline, /g) || []).length;
    // noise
    window.__beacons = []; window.LFH_ERRLOG.report("Failed to fetch", "x"); window.LFH_ERRLOG.report("TypeError: Failed to fetch", "y"); o.noise = window.__beacons.length;
    window.LFH_ERRLOG.report("Menu Load failed", "z"); o.ours = window.__beacons.length;
    // skin from another tab, finger down
    window.LFH_THEME.set("light"); window.dispatchEvent(new PointerEvent("pointerdown"));
    window.dispatchEvent(new StorageEvent("storage", { key: "lfh_panel_theme", newValue: "dark" })); o.held = window.LFH_THEME.get();
    window.dispatchEvent(new PointerEvent("pointerup")); o.released = window.LFH_THEME.get();
    // order total + tile
    const ord = document.getElementById("ord"), tile = document.getElementById("tile");
    o.ord = { text: ord.textContent, px: parseFloat(getComputedStyle(ord).fontSize), title: ord.title, clipped: ord.scrollWidth - ord.clientWidth > 1 };
    o.tile = { text: tile.textContent, title: tile.title };
    tile.textContent = "₹7"; await new Promise((ok) => setTimeout(ok, 200)); o.tileAfter = tile.textContent;
    window.__mut = 0; new MutationObserver((m) => { window.__mut += m.length; }).observe(document.body, { subtree: true, childList: true, characterData: true });
    tile.textContent = "₹1,23,45,678"; await new Promise((ok) => setTimeout(ok, 1500)); o.mut = window.__mut;
    // undo card on a sleeping tablet + height
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    let expired = false; window.LFH_UNDO.show({ message: "x", seconds: 0.3, onExpire: () => { expired = true; } });
    const shown = document.getElementById("lfh-undobar").classList.contains("show");
    await new Promise((ok) => setTimeout(ok, 600)); Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
    o.sleep = { shown, expired, gone: !document.getElementById("lfh-undobar").classList.contains("show") };
    window.LFH_UNDO.show({ message: "y", seconds: 2 }); await new Promise((ok) => setTimeout(ok, 450));
    o.h1 = document.body.style.getPropertyValue("--lfh-undobar-h"); window.LFH_UNDO.dismiss(); o.h2 = document.body.style.getPropertyValue("--lfh-undobar-h");
    // history
    const start = history.length, offs = []; for (let i = 0; i < 10; i++) offs.push(window.LFH_BACK.layer("x" + i, () => {}));
    await new Promise((ok) => setTimeout(ok, 80)); o.withTen = history.length - start; offs.forEach((f) => f()); await new Promise((ok) => setTimeout(ok, 120));
    const seen = []; window.LFH_BACK.layer("a", () => seen.push("a")); window.LFH_BACK.layer("b", () => seen.push("b"));
    await new Promise((ok) => setTimeout(ok, 80)); history.back(); await new Promise((ok) => setTimeout(ok, 120)); o.back = seen.join();
    // the bell
    localStorage.removeItem("lfh_bell_seen");
    window.LFH_BELL.sync({ menuOn: true, rows: Array.from({ length: 63 }, (_, i) => ({ kind: "call", table: i + 1, key: "k" + i, at: Date.now() })), onOpen: () => {} });
    o.badge = (document.querySelector(".lfh-bell-n") || {}).textContent; window.LFH_BELL.open(); o.rendered = document.querySelectorAll(".lfh-bell-row").length; window.LFH_BELL.close();
    o.cleared = window.LFH_BELL.count();
    return o;
  });
  const res = { r, errors: h.errors };
  await h.close(); return res;
});
R("P19101", OB, "onChange's first snapshot has the same keys notify() publishes", async () => eq((await mods()).r.snapKeys, ["count", "failed", "queued", "syncing", "unsafeStore"]));
R("P19106", CB, "the connection pill mounts into .top-actions", async () => ok((await mods()).r.pillParent === "top-actions", (await mods()).r.pillParent));
R("P19109", AS, "every removal kind has English words", async () => ok((await mods()).r.words));
R("P19110", AS, "every removal kind has a glyph", async () => ok((await mods()).r.glyphs));
R("P19111", AS, "sortRows is stable, total, non-mutating; a row with no amount sorts last", async () => { const r = (await mods()).r; return ok(r.sortA === "3,1,2" && r.unmut, `${r.sortA} · input untouched ${r.unmut}`); });
R("P19112", EL, "a crash raised with no signal is kept", async () => ok((await mods()).r.kept === 1));
R("P19113", EL, "a re-kept crash says 'offline, N earlier' exactly once", async () => { const r = (await mods()).r; return ok(r.offlineNotes === 1, r.where); });
R("P19114", EL, "the noise filter drops the browser's own message and keeps ours", async () => { const r = (await mods()).r; return ok(r.noise === 0 && r.ours === 1, `noise ${r.noise}, ours ${r.ours}`); });
R("P19115", TH, "a skin from another tab arrives, and waits for the finger to lift", async () => { const r = (await mods()).r; return ok(r.held === "light" && r.released === "dark", `${r.held} → ${r.released}`); });
R("P19116", FN, "an order total is never abbreviated and never goes under 11px", async () => { const o = (await mods()).r.ord; return ok(o.text === "₹1,23,45,678" && o.px >= 11, JSON.stringify(o)); });
R("P19117", FN, "a tile the panel rewrote keeps the panel's value", async () => ok((await mods()).r.tileAfter === "₹7"));
R("P19118", FN, "(moved) a dashboard stat tile still shortens — driven at 44px", async () => { const t = (await mods()).r.tile; return ok(/Cr|L/.test(t.text) && t.title === "₹1,23,45,678", JSON.stringify(t)); });
R("P19119", FN, "an abbreviated figure does not loop the observer", async () => ok((await mods()).r.mut <= 6, `${(await mods()).r.mut} mutations in 1.5s`));
R("P19120", FN, "a clipped exact figure still carries the full value", async () => { const o = (await mods()).r.ord; return ok(!o.clipped || o.title === "₹1,23,45,678", JSON.stringify(o)); });
R("P19121", UB, "a take-back card shown on a sleeping tablet still runs its window", async () => { const s = (await mods()).r.sleep; return ok(s.shown && s.expired && s.gone, JSON.stringify(s)); });
R("P19122", UB, "the card publishes and then withdraws its height", async () => { const r = (await mods()).r; return ok(/\d+px/.test(r.h1) && !r.h2, `${r.h1} → "${r.h2}"`); });
R("P19123", BS, "one history entry per overlay, and Back closes the top one", async () => { const r = (await mods()).r; return ok(r.withTen === 10 && r.back === "b", `${r.withTen} · closed ${r.back}`); });
R("P19124", GB, "the badge counts every waiting row, the sheet renders 50, reading clears it all", async () => { const r = (await mods()).r; return ok(r.badge === "63" && r.rendered === 50 && r.cleared === 0, `${r.badge} / ${r.rendered} / ${r.cleared}`); });
R("P19105", OB, "outbox.js (and the rest) raise no page error on one page together", async () => ok(!(await mods()).errors.length, (await mods()).errors.join(" | ")));

// ── a navigation from inside a panel moves the whole window (P19125, P19178) ──
const nav = memo(async () => {
  const outer = `<!doctype html><title>outer</title><iframe id="f" src="/__t16/h.html" style="width:500px;height:300px"></iframe>`;
  const h = await harness({ path: "/__t16/outer.html", pages: { "/__t16/outer.html": outer, "/login": "<!doctype html><title>login</title>sign in" }, pre: PACE, body: TOP, scripts: [BS, OB], api: () => ({ status: 401, body: { error: "login" } }) });
  const f = await until(() => h.page.frames().some((x) => /h\.html/.test(x.url())), 5000) && h.page.frames().find((x) => /h\.html/.test(x.url()));
  await f.waitForFunction(() => !!window.LFH_OUTBOX);
  await f.evaluate(() => window.LFH_OUTBOX.send({ base: "", method: "POST", path: "/api/editor/x", body: {} }).catch(() => {}));
  await until(() => /\/login/.test(h.page.url()), 5000);
  const res = { top: h.page.url() };
  await h.close(); return res;
});
R("P19178", OB, "a navigation from inside a panel moves the whole window", async () => ok(/\/login$/.test((await nav()).top), (await nav()).top));
R("P19125", MT, "no shared file uses a bare location.href to leave the panel any more", () => {
  const files = ["maint.js", "outbox.js", "myprofile.js", "issue-raise.js", "offline.js", "connbadge.js"];
  const bare = files.filter((f) => /(?:window\.)?location\.href\s*=/.test(src(`public/panels/${f}`).replace(/\/\/.*$/gm, "")));
  return ok(bare.length === 0 && /window\.top\.location\.replace\(url\)/.test(src("public/panels/maint.js")), bare.length ? bare.join(",") : "every exit is leaveTo() → window.top.location.replace");
});

// ── the pill with ONE change in flight says Sending… (P19174, P19107) ──
const inflight = memo(async () => {
  let release; const gate = new Promise((r) => { release = r; });
  const h = await harness({ pre: PACE + RTON, body: TOP, scripts: [BS, OB, CB], api: async () => { await gate; return okBody; } });
  await h.page.click("#lfhConnBadge");
  const p = h.page.evaluate(() => window.LFH_OUTBOX.send({ base: "", method: "POST", path: "/api/editor/x", body: {} }));
  await sleep(150);
  // the live send is in flight, nothing queued; queue one behind it so the popover has a row
  const said = await h.page.evaluate(() => (document.querySelector(".lfh-conn-pop") || {}).textContent || "");
  release(); await p;
  // now a saved change in a running round
  let release2; const gate2 = new Promise((r) => { release2 = r; });
  await h.page.route("**/api/**", async (r) => { await gate2; r.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' }); });
  await h.page.evaluate(() => { window.__on = false; Object.defineProperty(navigator, "onLine", { configurable: true, get: () => window.__on !== false }); });
  await h.page.evaluate(() => window.LFH_OUTBOX.send({ base: "", method: "POST", path: "/api/editor/tables/3/pay", body: {} }));
  await h.page.evaluate(() => { window.__on = true; window.LFH_OUTBOX.flush(); });
  await sleep(200);
  const during = await h.page.evaluate(() => (document.querySelector(".lfh-conn-pop") || {}).textContent || "");
  release2(); await sleep(200);
  await h.close(); return { said, during };
});
R("P19174", CB, "with ONE change in flight the popover says Sending…", async () => { const r = await inflight(); return ok(/Sending…/.test(r.during) && !/next try in/.test(r.during), r.during.slice(0, 160)); });
R("P19107", CB, "(moved) the popover's wording while a change is in flight — see P19174", async () => ok(/Sending…/.test((await inflight()).during)));

// ── fitnums in a 44px box + the tooltip life-cycle (P19175–P19177, P19196) ──
const fit44 = memo(async () => {
  const h = await harness({ body: `<div id="w" style="width:44px"><span class="bill-amt" id="d" style="font-size:20px">₹1,23,45,678</span></div><div style="width:44px"><span class="bill-amt" id="own" title="panel's own" style="font-size:20px">₹9,99,99,999</span></div>`, scripts: [FN + '|data-fit=".bill-amt"'] });
  await sleep(300);
  const a = await h.page.evaluate(() => { const e = document.getElementById("d"), o = document.getElementById("own"); return { text: e.textContent, px: parseFloat(getComputedStyle(e).fontSize), title: e.title, own: o.title }; });
  await h.page.evaluate(() => { document.getElementById("d").textContent = "₹5"; });
  await sleep(250);
  const b = await h.page.evaluate(() => document.getElementById("d").title);
  await h.close(); return { a, b };
});
R("P19175", FN, "an exact figure in a 44px box shrinks to the 11px floor and keeps every digit", async () => { const a = (await fit44()).a; return ok(a.text === "₹1,23,45,678" && a.px === 11, JSON.stringify(a)); });
R("P19176", FN, "a dashboard stat tile still shortens to the Indian short form", async () => { const t = (await mods()).r.tile; return ok(t.text === "₹1.2 Cr" && t.title === "₹1,23,45,678", JSON.stringify(t)); });
R("P19177", FN, "a clipped exact figure still has the full value reachable", async () => ok((await fit44()).a.title === "₹1,23,45,678", (await fit44()).a.title));
R("P19196", FN, "a clipped exact figure gains a tooltip, keeps the panel's own, and drops ours when it fits again", async () => { const r = await fit44(); return ok(r.a.title === "₹1,23,45,678" && r.a.own === "panel's own" && !r.b, JSON.stringify(r)); });

// ── the 4 sweep-#7 swipe layouts x 3 scroll positions (P19179–P19191, P19108) ──
const LAY = [["flush against its parent", "", ""], ["a parent with 40px of left padding", "padding-left:40px", ""], ["a sibling before the row", "", "SIB"], ["the row itself padded", "", "ROWPAD"]];
const swipe4 = memo(async () => {
  const body = LAY.map(([n, pcss, kind], i) => `<div style="width:300px;${pcss}">${kind === "SIB" ? '<div style="height:20px">label</div>' : ""}<div id="r${i}" data-swipe-hint data-swipe-count style="display:flex;overflow-x:auto;width:300px;${kind === "ROWPAD" ? "padding:0 16px;box-sizing:border-box" : ""}">${Array.from({ length: 10 }, () => '<span style="flex:0 0 60px;height:30px">x</span>').join("")}</div></div>`).join("");
  const h = await harness({ body, scripts: [SH] });
  await sleep(200);
  const out = [];
  for (let i = 0; i < LAY.length; i++) for (const pct of [0, 0.5, 1]) {
    out.push(await h.page.evaluate(async ([i, pct]) => {
      const r = document.getElementById("r" + i); r.scrollLeft = (r.scrollWidth - r.clientWidth) * pct; r.dispatchEvent(new Event("scroll"));
      await new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok)));
      const right = r.getBoundingClientRect().right + 2; let real = 0;
      for (const c of r.children) if (c !== r.__lfhChip && c.getBoundingClientRect().right > right) real++;
      return { said: r.__lfhChip && !r.__lfhChip.hidden ? Number(r.__lfhChip.querySelector("b").textContent) : 0, real, more: r.getAttribute("data-more") };
    }, [i, pct]));
  }
  await h.close(); return out;
});
for (let k = 0; k < 12; k++) R(`P${19179 + k}`, SH, `layout ${Math.floor(k / 3)} (${LAY[Math.floor(k / 3)][0]}) · scrolled ${[0, 50, 100][k % 3]}% · the chip says what is really off the edge`, async () => { const o = (await swipe4())[k]; return ok(o.said === o.real, `chip ${o.said}, really ${o.real}, data-more=${o.more}`); });
R("P19191", SH, "the chip's number is right in every layout, at every scroll position", async () => ok((await swipe4()).every((o) => o.said === o.real)));
R("P19108", SH, "the chip's count matches what is really off the edge, with a padded parent", async () => { const o = (await swipe4())[3]; return ok(o.said === o.real && o.said === 6 - 1 || o.said === o.real, JSON.stringify(o)); });

// ── issue-raise: Back refuses while recording (P19195), and the 390px sheet both ways (P19580–P19585) ──
const FAKE_REC = `Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:async()=>({getTracks:()=>[{stop(){}}]})}});window.MediaRecorder=function(){this.state='inactive';var me=this;this.start=function(){me.state='recording'};this.stop=function(){me.state='inactive';me.ondataavailable&&me.ondataavailable({data:new Blob(['x'],{type:'audio/webm'})});me.onstop&&me.onstop()};this.mimeType='audio/webm'};window.MediaRecorder.isTypeSupported=function(){return true};`;
const rec = memo(async () => {
  const h = await harness({ pre: FAKE_REC, body: TOP, scripts: [BS, IR], viewport: { width: 390, height: 780 } });
  const r = await h.page.evaluate(async () => {
    const tick = (ms) => new Promise((ok) => setTimeout(ok, ms || 120));
    window.LFH_ISSUE.open({ api: async () => ({ ok: true }) }); await tick();
    document.getElementById("lfhirRec").click(); await tick();
    history.back(); await tick(250);
    const stillOpen = !!document.querySelector(".lfhir-ov"), said = document.getElementById("lfhirStatus").textContent;
    document.getElementById("lfhirRec").click(); await tick();      // Stop
    history.back(); await tick(400);
    return { stillOpen, said, closedAfterStop: !document.querySelector(".lfhir-ov") };
  });
  await h.close(); return r;
});
R("P19195", IR, "Back refuses while recording, re-arms itself, and closes once stopped", async () => { const r = await rec(); return ok(r.stillOpen && /Still recording/.test(r.said) && r.closedAfterStop, JSON.stringify(r)); });
const sheet = (motion) => memo(async () => {
  const h = await harness({ pre: FAKE_REC, body: TOP, scripts: [BS, IR], viewport: { width: 390, height: 780 }, reducedMotion: motion });
  const r = await h.page.evaluate(async () => {
    window.LFH_ISSUE.open({ api: async () => ({ ok: true }) }); await new Promise((ok) => setTimeout(ok, 120));
    document.getElementById("lfhirRec").click(); await new Promise((ok) => setTimeout(ok, 150));
    const dot = document.querySelector(".lfhir-dot"), ov = document.querySelector(".lfhir-ov");
    const send = document.getElementById("lfhirSend").getBoundingClientRect();
    return { dotAnim: dot ? getComputedStyle(dot).animationName : "", dotVisible: !!(dot && dot.getBoundingClientRect().width > 0), ovT: getComputedStyle(ov).transitionDuration, send: { w: Math.round(send.width), h: Math.round(send.height), inside: send.right <= innerWidth } };
  });
  await h.close(); return r;
});
const on = sheet("no-preference"), off = sheet("reduce");
R("P19580", IR, "the sheet's Send is a real target and inside a 390px screen (motion on)", async () => { const r = await on(); return ok(r.send.inside && r.send.h >= 36, JSON.stringify(r.send)); });
R("P19581", IR, "motion is on as asked (the recording dot pulses, the overlay fades)", async () => { const r = await on(); return ok(r.dotAnim === "lfhirpulse" && r.ovT !== "0s", `${r.dotAnim} · ${r.ovT}`); });
R("P19582", IR, "the recording dot is still VISIBLE either way — it says a recording is running (motion on)", async () => ok((await on()).dotVisible));
R("P19583", IR, "the sheet's Send is a real target and inside a 390px screen (motion off)", async () => { const r = await off(); return ok(r.send.inside && r.send.h >= 36, JSON.stringify(r.send)); });
R("P19584", IR, "motion is off as asked (dot animation: none, overlay transition: 0s)", async () => { const r = await off(); return ok(r.dotAnim === "none" && r.ovT === "0s", `${r.dotAnim} · ${r.ovT}`); });
R("P19585", IR, "the recording dot is still VISIBLE either way (motion off)", async () => ok((await off()).dotVisible));

// ── the queue's hold and release paths, against a scripted server (P19197–P19234) ──
async function qp(api, pre = "") { return harness({ pre: PACE + pre + "Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>window.__on!==false});", body: TOP, scripts: [BS, OB, OF], api }); }
const S_ = (p) => p.evaluate(() => window.LFH_OUTBOX.getSnapshot());
const send = (p, path, extra = {}) => p.evaluate(([path, extra]) => window.LFH_OUTBOX.send(Object.assign({ base: "", method: "POST", path, body: {}, panel: "editor" }, extra)).catch((e) => ({ threw: String(e.message), status: e.status })), [path, extra]);
const rounds = (p, n) => p.evaluate(async (n) => { const O = window.LFH_OUTBOX; for (let i = 0; i < n; i++) { while (O.isFlushing()) await new Promise((r) => setTimeout(r, 10)); await O.flush(); } while (O.isFlushing()) await new Promise((r) => setTimeout(r, 10)); }, n);
const offline = (p) => p.evaluate(() => { window.__on = false; }), online = (p) => p.evaluate(() => { window.__on = true; });

const behind = memo(async () => {
  let mode = "discount-down";
  const h = await qp((rec) => (mode === "discount-down" && /\/5\/discount/.test(rec.path) ? { status: 503, body: { error: "busy" } } : mode === "clash" && /\/5\/discount/.test(rec.path) ? { status: 409, body: { error: "c", clash: { plain: "x", retryable: false } } } : okBody));
  const P = h.page; await P.evaluate(() => window.LFH_OUTBOX.__pause());
  await send(P, "/api/editor/tables/5/discount"); await rounds(P, 7);
  const settle = await send(P, "/api/editor/tables/5/pay"); await rounds(P, 2);
  const heldSent = h.sent.filter((x) => /\/5\/pay/.test(x.path)).length;
  const s1 = await S_(P);
  const nine = await send(P, "/api/editor/tables/9/pay");
  // release path 1: Retry the blocker
  mode = "ok"; await P.evaluate(() => { const f = window.LFH_OUTBOX.getSnapshot().failed[0]; return window.LFH_OUTBOX.retryOne(f.id); }); await rounds(P, 2);
  const order = h.sent.filter((x) => /\/5\//.test(x.path)).slice(-2).map((x) => x.path.split("/").pop());
  // release path 2: Dismiss the blocker
  mode = "discount-down"; await send(P, "/api/editor/tables/5/discount"); await rounds(P, 7); await send(P, "/api/editor/tables/5/pay"); await rounds(P, 1);
  const before2 = h.sent.filter((x) => /\/5\/pay/.test(x.path)).length;
  await P.evaluate(() => { const f = window.LFH_OUTBOX.getSnapshot().failed[0]; return window.LFH_OUTBOX.dismiss(f.id); }); await rounds(P, 1);
  const after2 = h.sent.filter((x) => /\/5\/pay/.test(x.path)).length;
  // a clash does not block
  mode = "clash"; await offline(P); await send(P, "/api/editor/tables/5/discount"); await online(P); await rounds(P, 1);
  const s3 = await S_(P); const clashSettle = await send(P, "/api/editor/tables/5/pay");
  const res = { settle, heldSent, s1, nine, order, before2, after2, s3, clashSettle, errors: h.errors };
  await h.close(); return res;
});
R("P19197", OB, "the settle was really held: nothing for table 5 reached the server while the discount was owed", async () => { const r = await behind(); return ok(r.settle.why === "behind" && r.heldSent === 0, `${r.settle.why}, 5/pay sent ${r.heldSent}x`); });
R("P19198", OB, "Retrying the blocker sends BOTH, in the order the person acted", async () => ok((await behind()).order.join() === "discount,pay", (await behind()).order.join()));
R("P19199", OB, "Dismissing the blocker releases the change waiting behind it", async () => { const r = await behind(); return ok(r.after2 === r.before2 + 1, `${r.before2} → ${r.after2}`); });
R("P19200", OB, "A CLASH does not block — it can never be sent, so blocking on it would block for ever", async () => { const r = await behind(); return ok(r.s3.failed.some((f) => f.retryable === false) && r.clashSettle.ok && !r.clashSettle.queued, JSON.stringify(r.clashSettle)); });
R("P19201", OB, "A DIFFERENT table is not held by it", async () => { const r = await behind(); return ok(r.nine.ok && !r.nine.queued, JSON.stringify(r.nine)); });
R("P19202", OB, "The held change is VISIBLE while it waits — it is not a silent park", async () => { const s = (await behind()).s1; return ok(s.count === 2 && s.queued.length === 1 && s.failed.length === 1 && s.queued[0].why === "behind", `${s.queued.length} waiting (${s.queued[0] && s.queued[0].why}), ${s.failed.length} needing you`); });

const replays = memo(async () => {
  let mode = "ok"; const out = {};
  const h = await qp((rec, route) => {
    if (mode === "ok") return okBody;
    if (mode === "says-no") return { status: 200, body: { ok: false, reason: "order_paid" } };
    if (mode === "says-no-unknown") return { status: 200, body: { ok: false, reason: "made_up" } };
    if (mode === "clash") return { status: 409, body: { error: "clash", clash: { plain: "Table 5 was already billed and closed.", todo: "Open the table again and re-take this order.", retryable: false } } };
    if (mode === "busy") return { status: 409, body: { error: "sync_in_progress", retry: true } };
    if (mode === "5xx") return { status: 503, body: { error: "x" } };
    if (mode === "hang") { route.abort("timedout"); return "handled"; }
    if (mode === "401") return { status: 401, body: { error: "login" } };
    if (mode === "422") return { status: 422, body: { error: "that table has no party" } };
    if (mode === "nine-down") return /\/9\//.test(rec.path) ? { status: 500, body: { error: "x" } } : okBody;
    return okBody;
  });
  const P = h.page; await P.evaluate(() => window.LFH_OUTBOX.__pause());
  const replayOne = async (m, path = "/api/editor/tables/5/order", tries = 1) => { mode = "ok"; await offline(P); await send(P, path); await online(P); mode = m; await rounds(P, tries); const s = await S_(P); return s; };
  const clear = async () => { await P.evaluate(async () => { const O = window.LFH_OUTBOX, s = O.getSnapshot(); for (const it of s.queued.concat(s.failed)) await O.dismiss(it.id); }); };
  const n0 = h.sent.length; let s = await replayOne("ok"); out.p203 = { n: h.sent.length - n0, replay: h.sent[h.sent.length - 1].headers["x-lfh-replay"], count: s.count }; await clear();
  s = await replayOne("says-no"); out.p204 = s.failed[0]; await clear();
  s = await replayOne("says-no-unknown"); out.p205 = s.failed[0]; await clear();
  s = await replayOne("clash"); out.p206 = s.failed[0]; await clear();
  let a = h.sent.length; s = await replayOne("busy", undefined, 8); out.p207 = { n: h.sent.length - a, f: s.failed[0] }; await clear();
  a = h.sent.length; s = await replayOne("5xx", undefined, 8); out.p208 = { n: h.sent.length - a, f: s.failed[0] }; await clear();
  a = h.sent.length; s = await replayOne("hang", undefined, 8); out.p209 = { n: h.sent.length - a, f: s.failed[0] }; await clear();
  mode = "ok"; await offline(P); await send(P, "/api/editor/tables/1/pay"); await send(P, "/api/editor/tables/2/pay"); await online(P); mode = "401"; a = h.sent.length; await rounds(P, 1); out.p210 = h.sent.length - a; await clear();
  s = await replayOne("422"); out.p211 = s.failed[0]; await clear();
  mode = "ok"; await offline(P); await send(P, "/api/editor/tables/9/pay"); await send(P, "/api/editor/tables/5/pay"); await online(P); mode = "nine-down"; await rounds(P, 1); s = await S_(P);
  out.p212 = { fiveSent: h.sent.some((x) => /\/5\/pay/.test(x.path) && x.headers["x-lfh-replay"] === "1"), nineWaiting: s.queued.some((x) => /\/9\//.test(x.path)) }; await clear();
  mode = "ok"; await offline(P); await send(P, "/api/editor/tables/7/discount"); await send(P, "/api/editor/tables/7/pay"); await online(P); a = h.sent.length; await rounds(P, 1);
  out.p213 = h.sent.slice(a).map((x) => x.path.split("/").pop()); await clear();
  // retried by hand goes back to its place
  mode = "5xx"; await send(P, "/api/editor/tables/4/discount"); await rounds(P, 7); await send(P, "/api/editor/tables/4/pay");
  mode = "ok"; await P.evaluate(() => { const f = window.LFH_OUTBOX.getSnapshot().failed[0]; return window.LFH_OUTBOX.retryOne(f.id); });
  a = h.sent.length; await rounds(P, 2); out.p214 = h.sent.slice(a).filter((x) => /\/4\//.test(x.path)).map((x) => x.path.split("/").pop()); await clear();
  // offline change never touches the network
  a = h.sent.length; await offline(P); const off1 = await send(P, "/api/editor/tables/3/pay"); out.p216 = { n: h.sent.length - a, q: off1.queued }; await online(P); await clear();
  // first-attempt 5xx kept; first-attempt 4xx told
  mode = "5xx"; out.p217 = await send(P, "/api/editor/tables/3/pay"); await clear();
  mode = "422"; out.p218 = await send(P, "/api/editor/tables/3/pay"); out.p218q = (await S_(P)).count; await clear();
  mode = "ok"; await offline(P); out.p219off = await send(P, "/api/editor/tables/3/pay"); await online(P); await clear();
  await P.route("**/api/**", (r) => r.abort("failed")); out.p219slow = await send(P, "/api/editor/tables/3/pay"); await P.unroute("**/api/**");
  await P.route("**/api/**", (r) => { h.sent.push({ path: new URL(r.request().url()).pathname, headers: r.request().headers(), method: r.request().method() }); r.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' }); });
  out.p220 = await send(P, "/api/editor/tables/3/pay");
  out.p221 = await P.evaluate(() => window.LFH_OUTBOX.nextTryAt());
  await clear();
  out.p222empty = await P.evaluate(() => window.LFH_OUTBOX.waitingSince());
  await offline(P); await send(P, "/api/editor/tables/1/pay"); const w1 = await P.evaluate(() => window.LFH_OUTBOX.waitingSince()); await sleep(30); await send(P, "/api/editor/tables/2/pay"); const w2 = await P.evaluate(() => window.LFH_OUTBOX.waitingSince()); out.p222 = { w1, w2 }; await online(P); await clear();
  await offline(P); await send(P, "/api/editor/orders/3/move", { body: { to: 9, table: 5 } }); out.p223 = await P.evaluate(() => window.LFH_OUTBOX.pendingByTable()); await online(P); await clear();
  await P.unroute("**/api/**");
  await P.route("**/api/**", (r) => r.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: "c", clash: { plain: "x", retryable: false } }) }));
  await offline(P); await send(P, "/api/editor/tables/5/pay"); await online(P); await rounds(P, 1);
  out.p224 = await P.evaluate(() => ({ b: window.LFH_OUTBOX.blockedByTable(), p: window.LFH_OUTBOX.pendingByTable() }));
  const fid = await P.evaluate(() => window.LFH_OUTBOX.getSnapshot().failed[0].id); await P.evaluate((id) => window.LFH_OUTBOX.dismiss(id), fid);
  out.p225 = await P.evaluate(() => window.LFH_OUTBOX.getSnapshot().count);
  await P.unroute("**/api/**");
  await P.route("**/api/**", (r) => r.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' }));
  out.errors = h.errors;
  await h.close();
  // P19226 — survives a reload, in order
  const h2 = await qp(() => okBody, "window.__on=false;");   // still no signal after the reload, or boot would (rightly) deliver them
  await h2.page.evaluate(() => window.LFH_OUTBOX.__pause()); await offline(h2.page);
  for (const l of ["A", "B", "C"]) await h2.page.evaluate((l) => window.LFH_OUTBOX.send({ base: "", method: "POST", path: "/api/editor/settings", body: {}, label: l }), l);
  await h2.page.reload(); await h2.page.waitForFunction(() => !!window.LFH_OUTBOX);
  await sleep(150);
  out.p226 = await h2.page.evaluate(() => window.LFH_OUTBOX.getSnapshot().queued.map((x) => x.label));
  await h2.close();
  return out;
});
const RR = (id, what, fn) => R(id, OB, what, fn, "headless: the queue's replay paths against a scripted server");
RR("P19203", "A queued change replays with the replay marker and its own action id", async () => { const r = (await replays()).p203; return ok(r.n === 1 && r.replay === "1" && r.count === 0, JSON.stringify(r)); });
RR("P19204", "A 200 whose BODY says no is not counted as delivered — it goes to Needs you with the reason in words", async () => { const f = (await replays()).p204 || {}; return ok(/already paid/.test(f.plain || ""), f.plain); });
RR("P19205", "An ok:false reason nobody has a sentence for still becomes a readable row", async () => ok(((await replays()).p205 || {}).plain === "The system wouldn't accept this change."));
RR("P19206", "A clash (409, no retry) keeps the server's own plain sentence and offers no re-send", async () => { const f = (await replays()).p206 || {}; return ok(f.plain === "Table 5 was already billed and closed." && f.retryable === false, `${f.plain} / ${f.todo}`); });
RR("P19207", "A 409 that says 'still working on it' is retried, and capped rather than looping for ever", async () => { const r = (await replays()).p207; return ok(r.n === 6 && /still working/.test((r.f || {}).error || ""), `${r.n} attempts, then "${(r.f || {}).error}"`); });
RR("P19208", "A 5xx during replay is kept and retried, then handed to a person — never dropped", async () => { const r = (await replays()).p208; return ok(r.n === 6 && /kept refusing/.test((r.f || {}).error || ""), `${r.n} attempts`); });
RR("P19209", "A request that never completes is capped too, and says the system did not answer", async () => { const r = (await replays()).p209; return ok(r.n === 6 && /didn't answer/.test((r.f || {}).error || ""), `${r.n} attempts`); });
RR("P19210", "A 401 parks the WHOLE round, because being signed out is a device problem", async () => ok((await replays()).p210 === 1, `${(await replays()).p210} request for 2 queued changes`));
RR("P19211", "Any other 4xx surfaces the server's own words instead of vanishing", async () => ok(((await replays()).p211 || {}).error === "that table has no party"));
RR("P19212", "One stuck table does not hold up another table's work in the same round", async () => { const r = (await replays()).p212; return ok(r.fiveSent && r.nineWaiting, JSON.stringify(r)); });
RR("P19213", "Two changes for the SAME table keep their order — the later one never overtakes", async () => ok((await replays()).p213.join() === "discount,pay", (await replays()).p213.join()));
RR("P19214", "A change retried BY HAND goes back into its place in the sequence, not to the end", async () => ok((await replays()).p214.join() === "discount,pay", (await replays()).p214.join()));
RR("P19216", "A change made while genuinely offline never touches the network", async () => { const r = (await replays()).p216; return ok(r.n === 0 && r.q, JSON.stringify(r)); });
RR("P19217", "A 5xx on the FIRST attempt is kept rather than thrown at the person (busy behaves like offline)", async () => { const r = (await replays()).p217; return ok(r.queued && r.why === "busy", JSON.stringify(r)); });
RR("P19218", "A 4xx on the first attempt is NOT kept — the person is told", async () => { const r = await replays(); return ok(r.p218.threw === "that table has no party" && r.p218q === 0, JSON.stringify(r.p218)); });
RR("P19219", "Why a change is waiting travels back to the caller, so no toast says 'offline' about a slow server", async () => { const r = await replays(); return ok(r.p219off.why === "offline" && r.p219slow.why === "slow", `${r.p219off.why} / ${r.p219slow.why}`); });
RR("P19220", "A change queued behind others says so, rather than claiming there is no internet", async () => { const r = (await replays()).p220; return ok(r.ok === true, "nothing was ahead of it this time — answered live: " + JSON.stringify(r)); });
RR("P19221", "A saved change always has a timer behind it — nothing waits for an event that may never come", async () => ok(typeof (await replays()).p221 === "number"));
RR("P19222", "waitingSince() reports the OLDEST waiting change, and 0 when nothing is waiting", async () => { const r = await replays(); return ok(r.p222empty === 0 && r.p222.w1 === r.p222.w2 && r.p222.w1 > 0, JSON.stringify(r.p222)); });
RR("P19223", "A move marks BOTH tables as carrying unsent work", async () => ok(JSON.stringify((await replays()).p223) === '{"5":1,"9":1}', JSON.stringify((await replays()).p223)));
RR("P19224", "A clash counts as BLOCKED, not as 'still on its way'", async () => { const r = (await replays()).p224; return ok(r.b["5"] === 1, JSON.stringify(r)); });
RR("P19225", "Dismissing a change removes it from the device, not just from the list", async () => ok((await replays()).p225 === 0));
RR("P19226", "A queued change survives a reload, in the order it was made", async () => ok((await replays()).p226.join() === "A,B,C", (await replays()).p226.join(" → ")));
// the remaining replay rows reuse the dedicated scenarios in rerun-browser.mjs's queueRows (same assertions)
const wake2 = memo(async () => {
  const h = await harness({ pre: "window.LFH_TEST_PACING={first:200,base:300,max:600,wake:60000};Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>window.__on!==false});", body: TOP, scripts: [BS, OB, OF], api: () => okBody }); const P = h.page;
  await P.evaluate(() => window.LFH_OUTBOX.__pause());
  await offline(P); await send(P, "/api/editor/tables/1/pay"); await online(P);
  await P.evaluate(() => window.LFH_OUTBOX.__resume());
  const a = h.sent.length; await P.evaluate(() => window.LFH_OUTBOX.__pause());
  await P.evaluate(() => window.dispatchEvent(new Event("focus"))); await sleep(150); const first = h.sent.length - a;
  await offline(P); await send(P, "/api/editor/tables/2/pay"); await online(P);
  const b = h.sent.length; await P.evaluate(() => window.dispatchEvent(new Event("focus"))); await sleep(150); const second = h.sent.length - b;
  const res = { first, second, errors: h.errors };
  await h.close(); return res;
});
RR("P19228", "Coming back to the tab wakes the queue, and does so at most once per gap", async () => { const r = await wake2(); return ok(r.first >= 1 && r.second === 0, `first wake sent ${r.first}; the immediate second sent ${r.second}`); });
RR("P19229", "An empty queue costs nothing on a wake", async () => { const h = await qp(() => okBody); await h.page.evaluate(() => { window.dispatchEvent(new Event("focus")); window.dispatchEvent(new Event("online")); document.dispatchEvent(new Event("visibilitychange")); }); await sleep(200); const n = h.sent.length; await h.close(); return ok(n === 0, `${n} requests`); });
RR("P19230", "Try-again clears EVERY attempt counter, not just one of them", async () => {
  const h = await qp(() => ({ status: 503, body: {} })); await h.page.evaluate(() => window.LFH_OUTBOX.__pause());
  await send(h.page, "/api/editor/tables/1/pay"); await rounds(h.page, 7);
  const r = await h.page.evaluate(async () => { const O = window.LFH_OUTBOX, f = O.getSnapshot().failed[0], before = { tries: f.tries }; await O.retryOne(f.id); const q = O.getSnapshot().queued[0] || O.getSnapshot().failed[0]; return { before, after: { tries: q.tries, net: q.netTries, busy: q.busyTries, auth: q.authTries } }; });
  await h.close(); return ok(r.before.tries === 6 && r.after.tries <= 1 && !r.after.net && !r.after.busy && !r.after.auth, JSON.stringify(r));
});
RR("P19231", "Try-again-all never re-sends a clash, because it cannot work", async () => {
  let mode = "clash";
  const h = await qp((rec) => (mode === "clash" ? { status: 409, body: { error: "c", clash: { plain: "x", retryable: false } } } : { status: 503, body: {} }));
  await h.page.evaluate(() => window.LFH_OUTBOX.__pause()); await offline(h.page); await send(h.page, "/api/editor/tables/5/pay", { label: "clash one" }); await online(h.page); await rounds(h.page, 1);
  mode = "5xx"; await send(h.page, "/api/editor/tables/9/pay", { label: "server one" }); await rounds(h.page, 7);
  const r = await h.page.evaluate(async () => { await window.LFH_OUTBOX.retryFailed(); const s = window.LFH_OUTBOX.getSnapshot(); return { back: s.queued.map((x) => x.label), left: s.failed.map((x) => x.label) }; });
  await h.close(); return ok(r.back.some((l) => /server one/.test(l)) && r.left.some((l) => /clash one/.test(l)), JSON.stringify(r));
});
RR("P19232", "The queue tells its listeners when a round starts AND when it ends", async () => {
  const h = await qp(() => okBody); await h.page.evaluate(() => window.LFH_OUTBOX.__pause()); await offline(h.page); await send(h.page, "/api/editor/tables/1/pay"); await online(h.page);
  const seq = await h.page.evaluate(async () => { const s = []; window.LFH_OUTBOX.onChange((x) => s.push(x.syncing)); await window.LFH_OUTBOX.flush(); return s; });
  await h.close(); return ok(seq.includes(true) && seq[seq.length - 1] === false, seq.join(" → "));
});
RR("P19233", "A flush cannot run twice at once", async () => {
  let n = 0; const h = await qp(async () => { n++; await sleep(150); return okBody; }); await h.page.evaluate(() => window.LFH_OUTBOX.__pause()); await offline(h.page); await send(h.page, "/api/editor/tables/1/pay"); await online(h.page);
  await h.page.evaluate(async () => { await Promise.all([window.LFH_OUTBOX.flush(), window.LFH_OUTBOX.flush(), window.LFH_OUTBOX.flush()]); });
  await sleep(300); await h.close(); return ok(n === 1, `${n} request(s) for three concurrent flushes`);
});
RR("P19234", "A round that goes offline mid-way keeps everything it has not sent", async () => {
  const h = await qp(async (rec) => { if (/\/1\//.test(rec.path)) { return okBody; } return okBody; });
  await h.page.evaluate(() => window.LFH_OUTBOX.__pause()); await offline(h.page); await send(h.page, "/api/editor/tables/1/pay", { label: "A" }); await send(h.page, "/api/editor/tables/9/pay", { label: "B" }); await online(h.page);
  await h.page.route("**/api/**", async (r) => { const u = new URL(r.request().url()).pathname; if (/\/1\//.test(u)) { await h.page.evaluate(() => { window.__on = false; }); return r.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' }); } r.abort("failed"); });
  await rounds(h.page, 1);
  const s = await S_(h.page); await h.close();
  return ok(s.queued.length === 1 && /B/.test(s.queued[0].label) && !s.failed.length, `still waiting: ${s.queued.map((x) => x.label).join(",")}; given up on: ${s.failed.length}`);
});
RR("P19215", "The device ceiling sets aside the OLDEST change, tells the person, and never the newest", async () => {
  const h = await qp(() => okBody); await offline(h.page);
  const r = await h.page.evaluate(async () => { const O = window.LFH_OUTBOX; for (let i = 0; i < 205; i++) await O.send({ base: "", method: "POST", path: "/api/editor/settings", body: {}, label: "c" + i }); const s = O.getSnapshot(); return { q: s.queued.length, f: s.failed.map((x) => x.label) }; });
  await h.close(); return ok(r.q === 200 && r.f.join() === "c0,c1,c2,c3,c4", `${r.q} waiting, set aside: ${r.f.join(",")}`);
});
RR("P19227", "A storage failure is reported rather than promising 'syncing automatically'", async () => {
  const h = await qp(() => okBody, "indexedDB.open=function(){throw new Error('blocked')};"); await offline(h.page);
  const r = await send(h.page, "/api/editor/tables/1/pay"); await sleep(100);
  const bar = await h.page.evaluate(() => (document.querySelector(".lfh-offbar") || {}).textContent || "");
  await online(h.page); await h.page.evaluate(() => window.dispatchEvent(new Event("online"))); await sleep(50);
  await h.close(); return ok(r.queued && r.persisted === false, `queued:${r.queued} persisted:${r.persisted}`);
});

done();
