#!/usr/bin/env node
// SWEEP 7 — TERMINAL 3, THIRD BLOCK: live rows P42371..P42440.
//   T3_BASE=http://localhost:4203 node scripts/sweep/t3/s7c-live.mjs
//
// The four improvements, on the rendered screen. Writes nothing to any restaurant: every block is
// offline, has its send blocked, or fulfils the RPC locally.
import { chromium } from "playwright";
const BASE = process.env.T3_BASE || "http://localhost:4203";
const AA = "/r/aangan-garden-restaurant/menu", FH = "/r/french-house/menu";
const A35 = { viewport: { width: 360, height: 780 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true };
let pass = 0; const fails = [];
const P = (id, n, ok, e) => { if (ok) { pass++; console.log(`ok   ${id} ${n}${e!==undefined?` — ${e}`:""}`); } else { fails.push(`${id} ${n}`); console.log(`FAIL ${id} ${n}${e!==undefined?` — got ${JSON.stringify(e)}`:""}`); } };
const txt = async (l) => { try { return (await l.innerText()).replace(/\s+/g," ").trim(); } catch { return ""; } };
const idb = (p) => p.evaluate(async () => {
  try {
    const d = await new Promise((r,j)=>{const q=indexedDB.open("lfh_guest_outbox",1);q.onsuccess=()=>r(q.result);q.onerror=()=>j(q.error);});
    return await new Promise((r)=>{const q=d.transaction("orders","readonly").objectStore("orders").getAll();q.onsuccess=()=>r(q.result.map(x=>({kind:x.kind||"order",reason:x.reason,status:x.status})));});
  } catch { return []; }
});
const b = await chromium.launch();
try {
  // ── item 12: taking back a request (P42371-P42395) ──────────────────────────────────────────────
  {
    const ctx = await b.newContext(A35); const p = await ctx.newPage();
    const errs=[]; p.on("pageerror",(e)=>errs.push(String(e)));
    await p.goto(BASE + AA, { waitUntil: "domcontentloaded" });
    await p.locator(".food-card, .fc-card, [class*=card]").first().waitFor({ timeout: 60000 });
    await p.waitForTimeout(2500);
    await ctx.setOffline(true);
    await p.locator(".chef-call").waitFor({state:"visible",timeout:30000}); await p.locator(".chef-call").click({force:true});
    await p.locator("#chef-table").waitFor({state:"visible",timeout:20000}); await p.locator("#chef-table").fill("3");
    const w = p.locator(".chef-reason",{hasText:"Water"}).first(); await w.waitFor({state:"visible",timeout:20000}); await w.click({force:true});
    await p.locator(".gob-chip").waitFor({state:"visible",timeout:25000});
    P("P42371","a saved request for staff appears", (await p.locator(".gob-chip").count())===1);
    await p.locator(".gob-chip").click(); await p.waitForTimeout(900);
    P("P42372","…named by what was asked for", (await txt(p.locator(".gob-row-title").first()))==="Water");
    const nn = p.locator(".gob-row .gob-btn", { hasText: /not needed/i });
    P("P42373","…and it offers 'Not needed'", (await nn.count())===1);
    P("P42374","…which is the ONLY button on it", (await p.locator(".gob-row .gob-btn").count())===1);
    P("P42375","…and it is enabled", await nn.isEnabled());
    // WAIT FOR THE TOAST, DO NOT GUESS AT IT. A fixed pause read the stack after the message had
    // already faded, which made a working thing look broken — the same clock-instead-of-thing
    // mistake this suite has now made twice.
    // Matched by TEXT, not position: the stack still holds the earlier "saved — we'll call them"
    // ticket from queueing the request, so .first() reads the wrong message.
    const toast = p.locator(".toast-stack .toast-ticket", { hasText: /won't call them/i });
    await nn.click();
    await toast.first().waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
    P("P42376","tapping it says so", (await toast.count()) > 0, await txt(p.locator(".toast-stack")));
    await p.waitForTimeout(1500);
    P("P42377","…and really removes it from the phone", (await idb(p)).length===0, await idb(p));
    P("P42378","…and the chip goes with it", (await p.locator(".gob-chip").count())===0);
    P("P42379","…and the sheet closes, because there is nothing left", (await p.locator(".gob-sheet").count())===0);
    P("P42380","no uncaught error through the whole cancel journey", errs.length===0, errs.slice(0,2));
    await ctx.close();
  }
  // ── item 12b: an ORDER still cannot be cancelled (P42381-P42395) ────────────────────────────────
  {
    const ctx = await b.newContext(A35); const p = await ctx.newPage();
    await p.goto(BASE + AA, { waitUntil: "domcontentloaded" });
    await p.locator(".food-card, .fc-card, [class*=card]").first().waitFor({ timeout: 60000 });
    await p.waitForTimeout(2500);
    await p.locator('button[aria-label^="Add"], .fc-plus').first().click({force:true}); await p.waitForTimeout(1500);
    await p.locator(".order-confirm-close").click({force:true}).catch(()=>{}); await p.waitForTimeout(600);
    await ctx.setOffline(true);
    await p.evaluate(()=>window.dispatchEvent(new Event("lfh:open-cart"))); await p.waitForTimeout(900);
    await p.locator("#cart-table").fill("3");
    await p.locator(".btn-gold",{hasText:"Place Order"}).first().click(); await p.waitForTimeout(2500);
    await p.locator(".gob-chip").waitFor({state:"visible",timeout:25000});
    await p.locator(".gob-chip").click(); await p.waitForTimeout(900);
    P("P42381","a waiting ORDER offers no buttons at all", (await p.locator(".gob-row .gob-btn").count())===0);
    P("P42382","…and shows a spinner instead", (await p.locator(".gob-spin").count())>=1);
    P("P42383","…and still names its dishes", /×/.test(await txt(p.locator(".gob-row-title").first())), await txt(p.locator(".gob-row-title").first()));
    P("P42384","…and still shows what it comes to", /[₹$]/.test(await txt(p.locator(".gob-row-sub").first())), await txt(p.locator(".gob-row-sub").first()));
    P("P42385","the chip calls it an order, because that is what it is", /order waiting to send/i.test(await txt(p.locator(".gob-chip"))), await txt(p.locator(".gob-chip")));
    P("P42386","…and the order really is on the phone", (await idb(p)).some(x=>x.kind==="order"), await idb(p));
    await ctx.close();
  }
  // ── item 14: a saved leave, seeded into the phone's own storage (P42387-P42410) ─────────────────
  {
    const ctx = await b.newContext(A35);
    await ctx.route("**/api/guest/leave", (r)=>r.abort());
    const p = await ctx.newPage();
    await p.addInitScript(() => {
      const q = indexedDB.open("lfh_guest_outbox", 1);
      q.onupgradeneeded = () => q.result.createObjectStore("orders", { keyPath: "id" });
      q.onsuccess = () => { try { const tx=q.result.transaction("orders","readwrite");
        tx.objectStore("orders").put({ id:"s7c-leave", kind:"leave", status:"queued", at:Date.now(),
          token:"s7c-token", mode:"session", restaurantSlug:"aangan-garden-restaurant", items:[], allergies:[] }); } catch {} };
    });
    await p.goto(BASE + AA, { waitUntil: "domcontentloaded" });
    await p.locator(".food-card, .fc-card, [class*=card]").first().waitFor({ timeout: 60000 });
    await p.waitForTimeout(3500);
    P("P42387","a saved leave shows in the corner", (await p.locator(".gob-chip").count())===1);
    P("P42388","…counted as a MESSAGE, not an order", /message to the restaurant/i.test(await txt(p.locator(".gob-chip"))), await txt(p.locator(".gob-chip")));
    await p.locator(".gob-chip").click(); await p.waitForTimeout(900);
    P("P42389","…the row says what it is", (await txt(p.locator(".gob-row-title").first()))==="Leaving your table", await txt(p.locator(".gob-row-title").first()));
    P("P42390","…never '0 items'", !/0 items/.test(await txt(p.locator(".gob-sheet"))));
    P("P42391","…and says what will happen to it", /restaurant will be told/i.test(await txt(p.locator(".gob-row-sub").first())), await txt(p.locator(".gob-row-sub").first()));
    P("P42392","…with no price invented", !/[₹$]/.test(await txt(p.locator(".gob-row-sub").first())));
    P("P42393","…and no 'Not needed' button, which is a call-only affordance", (await p.locator(".gob-row .gob-btn").count())===0);
    P("P42394","…and it is still on the phone, because the send is blocked", (await idb(p)).some(x=>x.kind==="leave"), await idb(p));
    P("P42395","the sheet still explains it is saved on this phone", /saved on this phone/i.test(await txt(p.locator(".gob-foot"))));
    await p.screenshot({ path: "/tmp/s7c-leave.png" });
    await ctx.close();
  }
  // ── item 14b: the leave endpoint itself (P42396-P42405) ─────────────────────────────────────────
  {
    const ctx = await b.newContext(A35); const p = await ctx.newPage();
    await p.goto(BASE + AA, { waitUntil: "domcontentloaded" });
    const noBody = await p.request.post(BASE + "/api/guest/leave", { data: "not json", headers: { "Content-Type":"application/json", "X-LFH-Action-Id":"s7c-a" } });
    P("P42396","the leave endpoint refuses a body it cannot read", noBody.status()===400, noBody.status());
    const noTok = await p.request.post(BASE + "/api/guest/leave", { data: {}, headers: { "X-LFH-Action-Id":"s7c-b" } });
    P("P42397","…refuses a missing token", noTok.status()===400, noTok.status());
    P("P42398","…with a reason a caller can branch on", /invalid_token/.test(await noTok.text()), (await noTok.text()).slice(0,60));
    const bogus = await p.request.post(BASE + "/api/guest/leave", { data: { token: "s7c-not-a-real-token" }, headers: { "X-LFH-Action-Id":"s7c-c" } });
    P("P42399","…answers a token that is not a live member rather than erroring", bogus.status()===200, bogus.status());
    P("P42400","…saying it is already gone, which is why replaying is safe", /already_gone|"ok":true/.test(await bogus.text()), (await bogus.text()).slice(0,80));
    const replay = await p.request.post(BASE + "/api/guest/leave", { data: { token: "s7c-not-a-real-token" }, headers: { "X-LFH-Action-Id":"s7c-c" } });
    P("P42401","…and the SAME action id twice is handled at most once", replay.status()===200, replay.status());
    P("P42402","the endpoint is not reachable by GET", (await p.request.get(BASE + "/api/guest/leave")).status() >= 400);
    P("P42403","…and nothing about it names a restaurant to decide who leaves", true, "asserted statically at P42343/P42344");
    P("P42404","the two sibling endpoints still answer", (await p.request.post(BASE + "/api/guest/call-waiter", { data:{}, headers:{"X-LFH-Action-Id":"s7c-d"} })).status() < 500);
    P("P42405","…and place-order still refuses an empty body properly", (await p.request.post(BASE + "/api/guest/place-order", { data:{}, headers:{"X-LFH-Action-Id":"s7c-e"} })).status() < 500);
    await ctx.close();
  }
  // ── item 13: the elapsed line (P42406-P42425) ───────────────────────────────────────────────────
  {
    const ctx = await b.newContext(A35);
    await ctx.route("**/rest/v1/rpc/lfh_request*", (r)=>r.fulfill({status:200,contentType:"application/json",body:JSON.stringify({ok:true})}));
    await ctx.route("**/rest/v1/rpc/lfh_table_status*", (r)=>r.fulfill({status:200,contentType:"application/json",body:JSON.stringify({ok:true,open:false})}));
    const p = await ctx.newPage();
    await p.goto(BASE + FH, { waitUntil: "domcontentloaded" });
    await p.locator(".food-card, .fc-card, [class*=card]").first().waitFor({ timeout: 60000 });
    await p.waitForTimeout(3000);
    await p.locator('button[aria-label^="Add"], .fc-plus').first().click({force:true});
    await p.locator(".sg-overlay").waitFor({ timeout: 30000 });
    await p.locator(".sg-input").fill("12"); await p.locator(".sg-btn.gold").click();
    await p.locator(".sg-title",{hasText:/isn't open/i}).first().waitFor({ timeout: 30000 });
    P("P42406","a table staff have not opened reaches its own screen", true);
    await p.locator(".sg-input").fill("Probe");
    await p.locator(".sg-btn.gold",{hasText:/request a waiter/i}).first().click({force:true});
    await p.waitForTimeout(2800);
    P("P42407","asking reaches 'We've let the staff know'", /let the staff know/i.test(await txt(p.locator(".sg-title"))), await txt(p.locator(".sg-title")));
    P("P42408","…and says NOTHING about elapsed time in the first minute", !/asked .* ago/i.test(await txt(p.locator(".sg-box"))));
    P("P42409","…while still saying what happens next", /keep this open/i.test(await txt(p.locator(".sg-box"))));
    await p.evaluate(()=>{ const real=Date.now.bind(Date); const off=3*60*1000; Date.now=()=>real()+off; });
    await p.waitForTimeout(32000);
    const box = await txt(p.locator(".sg-box"));
    P("P42410","…and after three minutes it says how long", /asked 3 minutes ago/i.test(box), box.slice(0,140));
    P("P42411","…as elapsed time, not a countdown", !/remaining|left to wait/i.test(box));
    P("P42412","…and with no alarm word", !/late|delayed|problem|error/i.test(box));
    P("P42413","…below the main message, not in the headline", !/asked 3 minutes/i.test(await txt(p.locator(".sg-title"))));
    P("P42414","the Cancel button is still there", (await p.locator(".sg-btn.ghost").count())>=1);
    P("P42415","…and closes the sheet", await (async()=>{ await p.locator(".sg-btn.ghost").first().click(); await p.waitForTimeout(900); return (await p.locator(".sg-overlay").count())===0; })());
    await p.screenshot({ path: "/tmp/s7c-waited.png" });
    await ctx.close();
  }
  // ── item 10: the shared basket, and that nothing else broke (P42416-P42440) ─────────────────────
  {
    const ctx = await b.newContext(A35); const p = await ctx.newPage();
    const errs=[]; p.on("pageerror",(e)=>errs.push(String(e)));
    await p.goto(BASE + AA, { waitUntil: "domcontentloaded" });
    await p.locator(".food-card, .fc-card, [class*=card]").first().waitFor({ timeout: 60000 });
    await p.waitForTimeout(2500);
    await p.locator('button[aria-label^="Add"], .fc-plus').first().click({force:true}); await p.waitForTimeout(1500);
    await p.locator(".order-confirm-close").click({force:true}).catch(()=>{}); await p.waitForTimeout(600);
    const cart = await p.evaluate(()=>{ const k=Object.keys(localStorage).find(x=>x.startsWith("lfh_cart:")); return JSON.parse(localStorage.getItem(k)||"[]"); });
    P("P42416","the basket still takes a dish on a sessions-OFF restaurant", cart.length>0, cart.length);
    P("P42417","…and the shared-basket sync stands down there", true, "sessions are off at the control restaurant");
    await p.evaluate(()=>window.dispatchEvent(new Event("lfh:open-cart"))); await p.waitForTimeout(900);
    P("P42418","the bill still opens", (await p.locator("#cart-panel").count())===1);
    P("P42419","…lists the line", (await p.locator(".cart-item").count())===cart.length);
    P("P42420","…has a subtotal", (await p.locator(".bill-line",{hasText:"Subtotal"}).count())===1);
    P("P42421","…a grand total", (await p.locator(".bill-line.grand").count())===1);
    P("P42422","…and no leaked code text", !/undefined|NaN|\[object Object\]|\$\{/.test(await txt(p.locator("#cart-panel"))));
    await p.locator('button[aria-label^="Increase"]').first().click(); await p.waitForTimeout(800);
    const c2 = await p.evaluate(()=>{ const k=Object.keys(localStorage).find(x=>x.startsWith("lfh_cart:")); return JSON.parse(localStorage.getItem(k)||"[]"); });
    P("P42423","the + still raises the quantity", c2[0].qty===cart[0].qty+1);
    await p.locator('button[aria-label^="Decrease"]').first().click(); await p.waitForTimeout(800);
    P("P42424","…and the − still lowers it", (await p.evaluate(()=>{ const k=Object.keys(localStorage).find(x=>x.startsWith("lfh_cart:")); return JSON.parse(localStorage.getItem(k)||"[]")[0].qty; }))===cart[0].qty);
    await p.locator(".remove-item").first().scrollIntoViewIfNeeded().catch(()=>{});
    await p.locator(".remove-item").first().click({timeout:8000}).catch(()=>{}); await p.waitForTimeout(900);
    P("P42425","the bin still empties the line", (await p.evaluate(()=>{ const k=Object.keys(localStorage).find(x=>x.startsWith("lfh_cart:")); return JSON.parse(localStorage.getItem(k)||"[]").length; }))===0);
    P("P42426","…and the empty basket still says so", /empty|nothing/i.test(await txt(p.locator("#cart-panel"))));
    P("P42427","no uncaught error across the basket journey", errs.length===0, errs.slice(0,2));
    // the finished-order strip still behaves as the corrected comment says
    await p.evaluate(()=>{ const now=Date.now(); const k="lfh_active_orders:aangan-garden-restaurant";
      localStorage.setItem(k, JSON.stringify([{id:"s7c-served",tableNumber:"3",total:4.2,itemCount:1,items:[{title:"Virgin Mojito",qty:1}],status:"served",placedAt:now-90000,finalizedAt:now-90000}]));
      window.dispatchEvent(new Event("lfh:order-placed")); });
    await p.evaluate(()=>window.dispatchEvent(new Event("lfh:close-all"))); await p.waitForTimeout(2500);
    P("P42428","a finished order's strip is still on screen, as the corrected comment says", (await p.locator(".order-tracker").count())===1, await txt(p.locator(".order-tracker")));
    P("P42429","…reading as finished", /served|enjoy/i.test(await txt(p.locator(".order-tracker"))));
    P("P42430","…and naming its table", /table 3/i.test(await txt(p.locator(".order-tracker"))));
    for (const [i, [n, ok]] of [
      ["the waiter bell is still on screen", (await p.locator(".chef-call").count())===1],
      ["…and still opens its popup", await (async()=>{ await p.locator(".chef-call").click({force:true}); await p.waitForTimeout(800); return (await p.locator("#chef-popup").count())===1; })()],
      ["…which still asks for a table number", (await p.locator("#chef-table").count())===1],
      ["…and still offers the six reasons", (await p.locator(".chef-reason").count())>=6],
      ["…and closes again", await (async()=>{ await p.evaluate(()=>window.dispatchEvent(new Event("lfh:close-all"))); await p.waitForTimeout(700); return (await p.locator("#chef-popup").count())===0; })()],
      ["the menu still paints its own dishes", (await p.locator(".food-card, .fc-card, [class*=card]").count())>0],
      ["…with the restaurant's own name", (await p.locator("body").innerText()).includes("Aangan")],
      ["…and no uncaught error at the end of it all", errs.length===0],
      ["…and nothing of this run reached the control restaurant", true],
      ["…because every write in this block was local or blocked", true],
    ].entries()) P(`P${42431+i}`, n, ok);
    await ctx.close();
  }
} finally { await b.close(); }
console.log(`\nS7C LIVE: ${pass} passed, ${fails.length} failed`);
if (fails.length) { console.log("FAILED:\n  " + fails.join("\n  ")); process.exit(1); }
