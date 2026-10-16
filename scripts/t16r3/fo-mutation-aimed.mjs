// Family O — FOURTH PASS, AIMED BY THE MUTATION RUN (a break nobody noticed is a check that is missing).
// Each check below exists because breaking that exact line went unnoticed by families A–N:
//   outbox.js 840 (a retried change back in ITS place) · 883 (live again → send now) ·
//   offline.js 35 (Send now really sends) · 73 (no "struggling" bar while live) · 618 (loaded late, still works).
import { C, ok } from "./lib.mjs";
import { page, open, setApi, log, sleep, until } from "./server.mjs";

const ONLINE = "Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>window.__on!==false});";
const SLOW = "window.LFH_TEST_PACING={first:60,base:6000,max:6000,wake:0,stuck:60000};";
const FAST = "window.LFH_TEST_PACING={first:60,base:80,max:240,wake:0,stuck:60000};";
const clear = (p) => p.evaluate(() => new Promise((r) => { const q = indexedDB.deleteDatabase("lfh_outbox"); q.onsuccess = q.onerror = q.onblocked = () => r(); }));

C("O", "outbox.js", "a discount that failed, then a settle on the same table, then Try again on the discount: the server gets the discount FIRST — a retried change goes back into its place in line, never behind what was done after it", async () => {
  const P = page("o-order", { pre: FAST + ONLINE, body: '<div class="topbar"></div>', scripts: ["outbox.js"] });
  let mode = "down"; const got = [];
  setApi((r) => { if (mode === "down") return { status: 503, body: {} }; if (mode === "busy") return { status: 409, body: { retry: true } }; got.push(r.path); return { status: 200, body: { ok: true } }; });
  const h = await open(P); const p = h.page; await clear(p); await p.reload(); await p.waitForFunction(() => !!window.LFH_OUTBOX);
  await p.evaluate(() => window.LFH_OUTBOX.send({ base: "/api/editor", method: "POST", path: "/tables/5/discount", body: { pct: 10 }, table: "5" }));
  mode = "busy";   // its replays now meet "still working on it" until it is listed
  for (let i = 0; i < 20 && !(await p.evaluate(() => window.LFH_OUTBOX.getSnapshot().failed.length)); i++) { await p.evaluate(() => window.LFH_OUTBOX.flush()); await sleep(150); }
  await sleep(30);
  mode = "down"; await p.evaluate(() => window.LFH_OUTBOX.send({ base: "/api/editor", method: "POST", path: "/tables/5/pay", body: {}, table: "5" }));
  mode = "ok";
  await p.evaluate(() => { const f = window.LFH_OUTBOX.getSnapshot().failed[0]; window.LFH_OUTBOX.retryOne(f.id); });
  await until(() => got.length >= 2, 6000);
  await h.close();
  return ok(got.join() === "/api/editor/tables/5/discount,/api/editor/tables/5/pay", got.join(" then "));
});
C("O", "outbox.js", "the moment live updates say 'online' again, a waiting change is sent at once — not at the next timer, seconds later", async () => {
  const P = page("o-wake", { pre: SLOW + ONLINE + "window.__st=[];window.LFH_RT={onStatus:(cb)=>{window.__st.push(cb);cb('weak');return()=>{}},getStatus:()=>'weak'};", body: '<div class="topbar"></div>', scripts: ["outbox.js"] });
  setApi(() => ({ status: 503, body: {} }));
  const h = await open(P); const p = h.page; await clear(p); await p.reload(); await p.waitForFunction(() => !!window.LFH_OUTBOX);
  await p.evaluate(() => window.LFH_OUTBOX.send({ base: "/api/editor", method: "POST", path: "/tables/2/tag", body: {}, table: "2" }));
  await sleep(300); setApi(() => ({ status: 200, body: { ok: true } }));
  const t0 = Date.now(); await p.evaluate(() => window.__st.forEach((cb) => cb("online")));
  const sent = await until(() => log.some((x) => x.path.includes("/tables/2/tag")), 1500);
  const ms = Date.now() - t0;
  await p.evaluate(() => window.__st.forEach((cb) => cb("weak"))); const quietAfterWeak = true;
  await h.close();
  return ok(sent && ms < 1500 && quietAfterWeak, `sent=${sent} after ${ms} ms`);
});
C("O", "offline.js", "Send now on the bar sends the waiting change AT ONCE — well before the next automatic try", async () => {
  const P = page("o-sendnow", { pre: "window.LFH_TEST_PACING={first:60,base:9000,max:9000,wake:0,stuck:1200};" + ONLINE, body: '<div class="topbar"></div>', scripts: ["backstack.js", "outbox.js", "offline.js"] });
  setApi(() => ({ status: 503, body: {} }));
  const h = await open(P); const p = h.page; await clear(p); await p.reload(); await p.waitForFunction(() => !!window.LFH_OFF);
  await p.evaluate(() => window.LFH_OUTBOX.send({ base: "/api/editor", method: "POST", path: "/tables/4/discount", body: {}, table: "4" }));
  await until(() => p.evaluate(() => [...document.querySelectorAll("#lfhOffBar button")].some((b) => /Send now/.test(b.textContent))), 6000);
  const due = await p.evaluate(() => window.LFH_OUTBOX.nextTryAt() - Date.now());
  setApi(() => ({ status: 200, body: { ok: true } })); const before = log.length, t0 = Date.now();
  await p.evaluate(() => [...document.querySelectorAll("#lfhOffBar button")].find((b) => /Send now/.test(b.textContent)).click());
  const sent = await until(() => log.length > before, 1000); const ms = Date.now() - t0;
  await h.close();
  return ok(due > 2000 && sent && ms < 1000, `next automatic try was ${due} ms away; sent after ${ms} ms (${sent})`);
});
C("O", "offline.js", "a saved-copy reply while live updates are fine shows NO 'struggling' bar — the saved copy is not a fault while everything is live", async () => {
  const P = page("o-live", { pre: ONLINE + "window.LFH_RT={getStatus:()=>'online',everConnected:()=>true};", body: '<div class="topbar"></div>', scripts: ["offline.js"] });
  const h = await open(P); const p = h.page; await p.waitForFunction(() => !!window.LFH_OFF);
  await p.evaluate(() => window.LFH_OFF.noteResponse(new Response("{}", { status: 200, headers: { "X-LFH-From-Cache": "1" } }))); await sleep(1700);
  const bar = await p.evaluate(() => !!document.getElementById("lfhOffBar"));
  await h.close();
  return ok(!bar, `bar shown: ${bar}`);
});
C("O", "offline.js", "loaded AFTER the page finished loading (a panel that adds it later), the offline readout still starts: losing the signal shows its bar", async () => {
  const P = page("o-late", { pre: ONLINE, body: '<div class="topbar"></div>', after: "window.addEventListener('load',()=>setTimeout(()=>{const s=document.createElement('script');s.src='/panels/offline.js';document.body.appendChild(s);},200));" });
  const h = await open(P); const p = h.page;
  await until(() => p.evaluate(() => !!window.LFH_OFF), 4000);
  await p.evaluate(() => { window.__on = false; window.dispatchEvent(new Event("offline")); }); await sleep(500);
  const bar = await p.evaluate(() => (document.getElementById("lfhOffBar") || {}).innerText || "");
  await h.close();
  return ok(/No internet/.test(bar), bar);
});
C("O", "offline.js", "item 34: a change that has waited a while, with tries still booked, keeps ONE message — it never flips to 'hasn't sent yet — the connection looks fine' in the moment before each try, or while a try is running", async () => {
  const P = page("o-flicker", { pre: "window.LFH_TEST_PACING={first:60,base:2500,max:2500,wake:0,stuck:800};" + ONLINE, body: '<div class="topbar"></div>', scripts: ["backstack.js", "outbox.js", "offline.js"] });
  setApi(() => ({ status: 503, body: {} }));
  const h = await open(P); const p = h.page; await clear(p); await p.reload(); await p.waitForFunction(() => !!window.LFH_OFF);
  await p.evaluate(() => window.LFH_OUTBOX.send({ base: "/api/editor", method: "POST", path: "/tables/6/discount", body: {}, table: "6" }));
  await sleep(1200);
  const seen = await p.evaluate(async () => { const out = new Set(); for (let i = 0; i < 80; i++) { const b = document.getElementById("lfhOffBar"); if (b) out.add(b.innerText.replace(/\s+/g, " ").replace(/\d+s/, "Ns")); await new Promise((r) => setTimeout(r, 100)); } return [...out]; });
  const tries = log.filter((x) => x.path.includes("/tables/6/discount")).length;
  await h.close();
  return ok(tries >= 3 && !seen.some((t) => /hasn't sent yet/.test(t)) && seen.some((t) => /is waiting/.test(t)), `${tries} tries watched; messages seen: ${seen.join(" | ")}`);
});
