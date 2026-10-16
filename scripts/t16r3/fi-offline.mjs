// Family I — SECOND PASS, AIMED BY COVERAGE: the "saved on this device" bar and sheet (offline.js) and
// the queue states behind them (outbox.js). The first pass never reached most of what a person reads
// here — the coverage report said 200 of offline.js's 360 code lines had never run. Each check below
// puts the queue in one real state and reads the WORDS on the screen, and taps what a person would tap.
import { C, ok } from "./lib.mjs";
import { page, open, setApi, log, sleep, until } from "./server.mjs";

const PACE = (stuck, slow) => slow ? `window.LFH_TEST_PACING={first:60,base:4000,max:4000,wake:0,stuck:${stuck}};` : `window.LFH_TEST_PACING={first:60,base:80,max:240,wake:0,stuck:${stuck}};`;
const ONLINE = "Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>window.__on!==false});if(sessionStorage.getItem('off')==='1')window.__on=false;";
const BODY = '<div class="topbar">Top</div><main><div data-t="5" style="width:80px;height:60px">T5</div><div data-t="6" style="width:80px;height:60px">T6</div></main>';
const P = (stuck = 60000, extra = "", slow = false) => page(`i-off-${stuck}-${extra.length}-${slow}`, { pre: PACE(stuck, slow) + ONLINE + extra, body: BODY, scripts: ["backstack.js", "outbox.js", "offline.js"] });
async function fresh(path, o) {
  const h = await open(path, o);
  await h.page.evaluate(() => new Promise((r) => { const q = indexedDB.deleteDatabase("lfh_outbox"); q.onsuccess = q.onerror = q.onblocked = () => r(); })).catch(() => {});
  await h.page.reload(); await h.page.waitForFunction(() => !!window.LFH_OUTBOX && !!window.LFH_OFF);
  return h;
}
const bar = (p) => p.evaluate(() => { const b = document.getElementById("lfhOffBar"); return b ? { text: b.innerText.replace(/\s+/g, " ").trim(), tone: b.className, buttons: [...b.querySelectorAll("button")].map((x) => x.innerText.trim()), role: b.getAttribute("role") } : null; });
const sheetText = (p) => p.evaluate(() => { const s = document.querySelector(".lfh-off-sheet"); return s ? s.innerText.replace(/\s+/g, " ").trim() : null; });
const send = (p, t, k = "discount") => p.evaluate(([t, k]) => window.LFH_OUTBOX.send({ base: "/api/editor", method: "POST", path: `/tables/${t}/${k}`, body: { x: 1 }, table: t }).catch((e) => ({ thrown: e.message })), [t, k]);
const offline = (p) => p.evaluate(() => { sessionStorage.setItem("off", "1"); window.__on = false; window.dispatchEvent(new Event("offline")); });

C("I", "offline.js", "no signal and a change waiting: the bar says 'No internet — you can keep working · 1 change waiting to send' as a status, See opens 'Saved on this device' with the change 'waiting for internet'; the table's tile carries ⏳ with a spoken name", async () => {
  setApi(() => ({ status: 200, body: { ok: true } }));
  const h = await fresh(P()); const p = h.page;
  await offline(p); await send(p, "5"); await sleep(500);
  const b = await bar(p);
  const chip = await p.evaluate(() => { const c = document.querySelector('[data-t="5"] .lfh-pend-chip'); const c6 = document.querySelector('[data-t="6"] .lfh-pend-chip'); return c ? { t: c.textContent, aria: c.getAttribute("aria-label"), other: !!c6 } : null; });
  await p.click("#lfhOffBar button"); await sleep(300);
  const s = await sheetText(p);
  await h.close();
  return ok(b && /No internet — you can keep working/.test(b.text) && /1 change waiting to send/.test(b.text) && b.role === "status" && b.buttons.includes("See") && chip && chip.t === "⏳" && /1 change on this table not sent yet/.test(chip.aria) && !chip.other && /Saved on this device/.test(s) && /Nothing is lost/.test(s) && /waiting for internet/.test(s) && /Apply discount/.test(s), JSON.stringify({ b, chip, s }));
});
C("I", "offline.js", "a change the server refuses while replaying: the bar turns to '1 change needs you · Tap Review', the sheet opens BY ITSELF with what happened and what to do, the tile still shows ⏳ (it CAN be sent again — outbox.js blockedByTable), 'Try again' sends it again", async () => {
  setApi(() => ({ status: 503, body: { error: "busy" } }));
  const h = await fresh(P()); const p = h.page;
  await send(p, "5", "pay");
  setApi(() => ({ status: 400, body: { error: "That table has already been settled." } }));
  await p.evaluate(() => window.LFH_OUTBOX.flush());
  await until(() => p.evaluate(() => window.LFH_OUTBOX.getSnapshot().failed.length === 1), 6000); await sleep(400);
  const b = await bar(p), s = await sheetText(p);
  const chip = await p.evaluate(() => { const c = document.querySelector('[data-t="5"] .lfh-pend-chip'); return c && { t: c.textContent, aria: c.getAttribute("aria-label") }; });
  setApi(() => ({ status: 200, body: { ok: true } })); const before = log.length;
  const again = await p.evaluate(() => { const x = [...document.querySelectorAll(".lfh-off-sheet button")].find((y) => /Try again/.test(y.textContent)); if (x) x.click(); return !!x; });
  await until(() => log.length > before, 4000); await sleep(400);
  const after = await p.evaluate(() => window.LFH_OUTBOX.getSnapshot()); const s2 = await sheetText(p);
  await h.close();
  return ok(b && /1 change needs you/.test(b.text) && /Tap Review/.test(b.text) && b.buttons.includes("Review") && s && /These changes need you/.test(s) && /Settle bill/.test(s) && /already been settled|wouldn't accept/i.test(s) && /→/.test(s) && /You did this a moment ago/.test(s) && chip && chip.t === "⏳" && again && after.failed.length === 0 && after.queued.length === 0 && /Everything has been sent/.test(s2 || ""),
    JSON.stringify({ b, s: (s || "").slice(0, 300), chip, again, after: { f: after.failed.length, q: after.queued.length }, s2 }));
});
C("I", "offline.js", "a clash (it can never be re-sent as it is) marks its table ⚠ 'need you' and offers no Try again; 'Not needed anymore' asks twice: the first tap only arms it ('Tap again to discard'), it disarms by itself after 4 s, and the second tap removes the change", async () => {
  setApi(() => ({ status: 503, body: {} }));
  const h = await fresh(P()); const p = h.page;
  await send(p, "6", "tag");
  setApi(() => ({ status: 409, body: { error: "clash", clash: { plain: "Someone else changed this table.", todo: "Look again.", retryable: false } } }));
  await p.evaluate(() => window.LFH_OUTBOX.flush());
  await until(() => p.evaluate(() => window.LFH_OUTBOX.getSnapshot().failed.length === 1), 6000); await sleep(300);
  const tap = () => p.evaluate(() => { const x = [...document.querySelectorAll(".lfh-off-sheet button")].find((y) => /Not needed|Tap again/.test(y.textContent)); if (x) x.click(); return x ? x.textContent : null; });
  const noTry = await p.evaluate(() => ![...document.querySelectorAll(".lfh-off-sheet button")].some((y) => /Try again/.test(y.textContent)));
  const chip = await p.evaluate(() => { const c = document.querySelector('[data-t="6"] .lfh-pend-chip'); return c && { t: c.textContent, aria: c.getAttribute("aria-label") }; });
  await tap(); const armed = await p.evaluate(() => [...document.querySelectorAll(".lfh-off-sheet button")].map((y) => y.textContent).join("|"));
  const still1 = await p.evaluate(() => window.LFH_OUTBOX.getSnapshot().failed.length);
  await sleep(4400); const disarmed = await p.evaluate(() => [...document.querySelectorAll(".lfh-off-sheet button")].map((y) => y.textContent).join("|"));
  await tap(); await tap(); await sleep(300);
  const left = await p.evaluate(() => window.LFH_OUTBOX.getSnapshot().failed.length);
  await h.close();
  return ok(noTry && chip && chip.t === "⚠" && /need you/.test(chip.aria) && /Tap again to discard/.test(armed) && still1 === 1 && /Not needed anymore/.test(disarmed) && left === 0, JSON.stringify({ noTry, chip, armed, still1, disarmed, left }));
});
C("I", "offline.js", "online, a change waiting longer than it should with the next try still seconds away: the bar says it 'is waiting — next try in about N s' and Send now sends it at once", async () => {
  let held = true; setApi(() => (held ? { status: 503, body: {} } : { status: 200, body: { ok: true } }));
  const h = await fresh(P(1200, "", true), {}); const p = h.page;
  await send(p, "5");
  await sleep(2600);
  const b = await until(async () => { const x = await bar(p); return x && /hasn't sent yet|is waiting/.test(x.text) ? x : false; }, 9000) && await bar(p);
  held = false; const before = log.length;
  await p.evaluate(() => { const x = [...document.querySelectorAll("#lfhOffBar button")].find((y) => /Send now/.test(y.textContent)); if (x) x.click(); });
  await until(() => log.length > before, 4000);
  await until(() => p.evaluate(() => window.LFH_OUTBOX.getSnapshot().queued.length === 0), 6000);
  const gone = await bar(p);
  await h.close();
  return ok(b && /is waiting/.test(b.text) && /next try in about \d+s/.test(b.text) && /Send now/.test(b.buttons.join()) && log.length > before && !gone, JSON.stringify({ b, sentAfterTap: log.length - before, gone }));
});
C("I", "outbox.js + offline.js", "a device that will not let the app store anything: the bar says plainly the changes are NOT saved on this device and to keep the panel open", async () => {
  setApi(() => ({ status: 503, body: {} }));
  const deny = "try{const o=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(){throw new DOMException('denied','QuotaExceededError')};}catch(e){}";
  const h = await open(P(60000, deny)); const p = h.page;
  await p.waitForFunction(() => !!window.LFH_OUTBOX && !!window.LFH_OFF);
  await send(p, "5"); await sleep(600);
  const b = await bar(p), unsafe = await p.evaluate(() => window.LFH_OUTBOX.storageFailed());
  await h.close();
  return ok(unsafe && b && /NOT saved on this device/.test(b.text) && /Keep it open/.test(b.text), JSON.stringify({ unsafe, b }));
});
C("I", "outbox.js", "more changes than a device can hold (201 with no signal): the oldest is set aside — listed, in plain words, not retryable — and none is silently lost", async () => {
  setApi(() => ({ status: 200, body: { ok: true } }));
  const h = await fresh(P()); const p = h.page;
  await offline(p);
  await p.evaluate(async () => { for (let i = 0; i < 201; i++) await window.LFH_OUTBOX.send({ base: "/api/editor", method: "POST", path: `/tables/${1 + (i % 30)}/tag`, body: { i }, table: String(1 + (i % 30)) }); });
  const s = await p.evaluate(() => { const x = window.LFH_OUTBOX.getSnapshot(); return { q: x.queued.length, f: x.failed.map((y) => ({ i: y.body && y.body.i, plain: y.plain, retryable: y.retryable })) }; });
  await h.close();
  return ok(s.q === 200 && s.f.length === 1 && s.f[0].i === 0 && /more unsent changes than it can keep/.test(s.f[0].plain) && s.f[0].retryable === false, JSON.stringify(s));
});
C("I", "offline.js", "a reply the offline layer served from its saved copy while the connection struggles: 'Connection is struggling · Showing saved data from …'; a fresh reply takes the bar away; a reply marked offline says No internet", async () => {
  setApi(() => ({ status: 200, body: {} }));
  const h = await open(P(60000, "window.LFH_RT={getStatus:()=>window.__rt||'weak',everConnected:()=>true};")); const p = h.page;
  await p.waitForFunction(() => !!window.LFH_OFF);
  const mk = (hd) => p.evaluate((hd) => window.LFH_OFF.noteResponse(new Response("{}", { status: 200, headers: hd })), hd);
  await mk({ "X-LFH-From-Cache": "1", "X-LFH-Cached-At": String(Date.now() - 5 * 60000) }); await sleep(300);
  const a = await bar(p), stale = await p.evaluate(() => [window.LFH_OFF.isStale(), window.LFH_OFF.stamp() > 0]);
  await mk({}); await sleep(200); const b = await bar(p);
  await mk({ "X-LFH-Offline": "1" }); await sleep(200); const c = await bar(p);
  await h.close();
  return ok(a && /Connection is struggling/.test(a.text) && /saved data from 5 min ago/.test(a.text) && stale[0] && stale[1] && !b && c && /No internet/.test(c.text), JSON.stringify({ a, stale, b, c }));
});
C("I", "offline.js", "after a saved-copy reply, once the signal is fine the panel is asked to refresh itself (lfh:stale-refresh) — and the 'saved data' note forgets itself if nothing fresh arrives", async () => {
  setApi(() => ({ status: 200, body: {} }));
  const h = await open(P(60000, "window.LFH_RT={getStatus:()=>'weak',everConnected:()=>true};window.__ref=0;addEventListener('lfh:stale-refresh',()=>window.__ref++);"), { clock: true }); const p = h.page;
  await p.waitForFunction(() => !!window.LFH_OFF);
  await p.evaluate(() => window.LFH_OFF.noteResponse(new Response("{}", { status: 200, headers: { "X-LFH-From-Cache": "1" } })));
  await p.clock.runFor(3000); const ref = await p.evaluate(() => window.__ref);
  await p.clock.runFor(26000); const after = await p.evaluate(() => window.LFH_OFF.isStale());
  await h.close();
  return ok(ref === 1 && after === false, JSON.stringify({ ref, staleAfter25s: after }));
});
C("I", "offline.js", "the panels' error tests: a busy server is busy and never 'offline'; a dropped request is offline; neither is the other", async () => {
  const h = await open(P()); const p = h.page; await p.waitForFunction(() => !!window.LFH_OFF);
  const r = await p.evaluate(() => { const O = window.LFH_OFF; return [O.isBusyErr({ status: 503 }), O.isBusyErr({ busy: true }), O.isBusyErr({ status: 503, offline: true }), O.isBusyErr({ status: 400 }), O.isOfflineErr({ offline: true }), O.isOfflineErr({ message: "Load failed" }), O.isOfflineErr({ status: 503 }), O.isOfflineErr(null), O.canReadOffline()]; });
  await h.close();
  return ok(JSON.stringify(r) === JSON.stringify([true, true, false, false, true, true, false, false, false]), JSON.stringify(r));
});
C("I", "offline.js", "a change waiting behind an earlier one on the same table reads 'Waiting for an earlier change on this table'", async () => {
  let n = 0; setApi((req) => (/tables\/5\/pay/.test(req.path) && n++ < 50 ? { status: 503, body: {} } : { status: 200, body: { ok: true } }));
  const h = await fresh(P()); const p = h.page;
  await send(p, "5", "pay"); await send(p, "5", "discount"); await sleep(600);
  await p.evaluate(() => window.LFH_OFF.open()); await sleep(300);
  const s = await sheetText(p);
  await h.close();
  return ok(s && /Waiting for an earlier change on this table/.test(s), (s || "").slice(0, 300));
});
