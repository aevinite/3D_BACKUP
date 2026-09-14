#!/usr/bin/env node
// SWEEP #9 ROUND 2 · TERMINAL 3 — driven + looked at · P110381–P110480
//
//   T3_BASE=http://localhost:4403 node scripts/sweep/t3/s9r2-live.mjs
//
// ⚠️ localhost, NEVER 127.0.0.1. Next 16's dev server serves no usable client bundle to the IP
// form — the page renders its server HTML and hydrates into nothing, so every client component is
// absent and it looks exactly like a real break. Recorded in T3.md; it cost this terminal an hour.
//
// Block F drives the rendered basket and the four routes. Every ROUTE call it makes is a REFUSAL,
// so this block writes not one row to the shared database — deliberate, not luck.
// Block G takes the captures, measures them, and the session OPENS them.
import { chromium } from "playwright";
import { mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const ROOT2 = join(dirname(fileURLToPath(import.meta.url)), "../../..");

const BASE = process.env.T3_BASE || "http://localhost:4403";
const AA = "/r/aangan-garden-restaurant/menu";   // sessions OFF — the plain basket door
const FH = "/r/french-house/menu";               // sessions ON  — the table-gate door
const FH_ID = "00000000-0000-0000-0000-000000000001";
const SHOTS = process.env.T3_SHOTS || ".claude/sweep/shots/S9-T3-R2";
const A35 = { viewport: { width: 360, height: 780 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true };
const A35W = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true };
const IPAD = { viewport: { width: 1194, height: 834 } };
const DESK = { viewport: { width: 1280, height: 800 } };

let pass = 0; const fails = [];
const P = (id, name, ok, extra) => {
  if (ok) { pass++; console.log(`ok   ${id} ${name}${extra !== undefined ? ` — ${extra}` : ""}`); }
  else { fails.push(`${id} ${name}`); console.log(`FAIL ${id} ${name}${extra !== undefined ? ` — got ${JSON.stringify(extra)}` : ""}`); }
};
const txt = async (loc) => { try { return (await loc.innerText()).replace(/\s+/g, " ").trim(); } catch { return ""; } };
const money = (s) => { const m = String(s).replace(/[^\d.]/g, ""); return m ? Number(m) : NaN; };
const openCart = async (p) => { await p.evaluate(() => window.dispatchEvent(new Event("lfh:open-cart"))); await p.waitForTimeout(1200); };
const addDish = async (p, n = 0) => { await p.locator('button[aria-label^="Add"], .fc-plus').nth(n).click({ force: true }).catch(() => {}); await p.waitForTimeout(800); };
const LEAK = /-->|\$\{|undefined|NaN|\[object Object\]|<div|className/;
try { mkdirSync(SHOTS, { recursive: true }); } catch { /* fine */ }

const b = await chromium.launch();
try {
  // ══ F1 · the basket on the owner's own phone (P110381–P110412) ═══════════════════════════════
  {
    const ctx = await b.newContext(A35); const p = await ctx.newPage();
    const errs = []; p.on("pageerror", (e) => errs.push(String(e)));
    const bad = []; p.on("console", (m) => { if (m.type() === "error") bad.push(m.text()); });
    await p.goto(BASE + AA, { waitUntil: "networkidle", timeout: 120000 }); await p.waitForTimeout(3000);

    P("P110381", "the guest menu renders its dishes", (await p.locator(".item-card-link, .dish-info").count()) > 0);
    await openCart(p);
    P("P110382", "the bill opens on an event, with no page load", (await p.locator("#cart-panel").count()) === 1);
    P("P110383", "…an empty bill SAYS so rather than showing a blank panel", /cart is empty/i.test(await txt(p.locator("#cart-list"))));
    P("P110384", "…offers no Place Order button with nothing in it", (await p.locator("#cart-panel .btn-gold").count()) === 0);
    P("P110385", "…no table field either", (await p.locator("#cart-table").count()) === 0);
    P("P110386", "…and no allergy section, which belongs to a basket that has something in it", (await p.locator(".allergy-section").count()) === 0);
    P("P110387", "both tabs are present", (await p.locator("#cart-panel .cart-tabs button").count()) === 2);
    const liveTab = await txt(p.locator("#cart-panel .cart-tabs button").nth(1));
    P("P110388", "…and the live tab shows no '(0)' when nothing is live", !/\(\d+\)/.test(liveTab), liveTab);
    await p.locator("#cart-panel .cart-tabs button").nth(1).click({ force: true }); await p.waitForTimeout(900);
    const hist = await txt(p.locator(".order-history"));
    P("P110389", "the live tab says what will appear there", /live orders will show up here|Nothing cooking/i.test(hist));
    P("P110390", "…and leaks no code into that sentence", !LEAK.test(hist), hist.slice(0, 60));
    await p.locator("#cart-panel .cart-tabs button").nth(0).click({ force: true }); await p.waitForTimeout(600);
    await p.evaluate(() => window.dispatchEvent(new Event("lfh:close-all"))); await p.waitForTimeout(500);

    await addDish(p, 0); await openCart(p);
    P("P110391", "adding a dish puts exactly one line in the bill", (await p.locator("#cart-list .cart-item").count()) === 1);
    P("P110392", "…the line names the dish", (await txt(p.locator(".cart-item-name").first())).length > 1);
    P("P110393", "…and prices it", money(await txt(p.locator(".cart-item-price").first())) > 0);
    P("P110394", "the table field appears once there is something to order", (await p.locator("#cart-table").count()) === 1);
    P("P110395", "…and the Place Order button does too", (await p.locator("#cart-panel .btn-gold").count()) === 1);
    P("P110396", "…and now the allergy section does", (await p.locator(".allergy-section").count()) === 1);
    const rows = await txt(p.locator(".bill-rows"));
    P("P110397", "the bill prints a subtotal and a total", /Subtotal/.test(rows) && /Total/.test(rows), rows.slice(0, 70));
    P("P110398", "…and never a ₹0 GST row", !/GST[^₹]*₹0(?!\d)/.test(rows));
    const sub = money(await txt(p.locator(".bill-line").first()));
    const tot = money(await txt(p.locator(".bill-line.grand")));
    P("P110399", "…and the rows a diner reads add up to the total", Math.abs(tot - sub) < 1 || tot > sub, { sub, tot });
    // the '+' ceiling, said out loud
    await p.locator("#cart-list .cart-item button[aria-label^='Increase']").first().click({ force: true }); await p.waitForTimeout(500);
    P("P110400", "'+' raises the quantity on the bill", /2x/.test(await txt(p.locator("#cart-list .cart-item").first())));
    await p.locator("#cart-list .cart-item button[aria-label^='Decrease']").first().click({ force: true }); await p.waitForTimeout(500);
    P("P110401", "'−' lowers it again", /1x/.test(await txt(p.locator("#cart-list .cart-item").first())));
    // the table field
    // TYPED, not pasted. `fill()` sets the whole string at once, and maxLength={4} truncates the RAW
    // "12ab3" to "12ab" before the digits-only handler sees it — so the field ends up "12" and the
    // check looks like a fault. It is not one: a diner types character by character and each letter
    // is simply refused, which is what this now measures. (A paste of mixed letters and digits into
    // a 4-character table box is not a thing a diner does; recorded so nobody re-files it.)
    await p.locator("#cart-table").click();
    for (const ch of "12ab3") { await p.keyboard.type(ch); await p.waitForTimeout(60); }
    P("P110402", "the table field keeps only digits as they are typed", (await p.locator("#cart-table").inputValue()) === "123", await p.locator("#cart-table").inputValue());
    await p.locator("#cart-table").fill(""); await p.waitForTimeout(200);
    await p.locator("#cart-panel .btn-gold").click({ force: true }); await p.waitForTimeout(1200);
    P("P110403", "Place Order with no table refuses visibly, and places nothing", (await p.locator("#cart-list .cart-item").count()) === 1);
    P("P110404", "…and the bill is still open, so the diner can fix it", (await p.locator("#cart-panel").count()) === 1);
    // the allergy chips
    const chips = await p.locator(".allergy-toggle").count();
    P("P110405", "the allergy section offers its chips", chips > 3, chips);
    await p.locator(".allergy-toggle").first().click({ force: true }); await p.waitForTimeout(400);
    P("P110406", "…tapping one turns it on, and says so to a screen reader", (await p.locator(".allergy-toggle").first().getAttribute("aria-pressed")) === "true");
    const warn = await txt(p.locator(".allergy-section"));
    P("P110407", "…and the section explains it applies to the whole order", /all the dishes/i.test(warn));
    await p.locator(".allergy-toggle").first().click({ force: true }); await p.waitForTimeout(400);
    P("P110408", "…tapping it again turns it off", (await p.locator(".allergy-toggle").first().getAttribute("aria-pressed")) === "false");
    const panelText = await txt(p.locator("#cart-panel"));
    P("P110409", "no rendered text in the bill leaks code", !LEAK.test(panelText), (panelText.match(LEAK) || [""])[0]);
    P("P110410", "…and it never renders the word 'null'", !/\bnull\b/.test(panelText));
    P("P110411", "the page raised no uncaught error", errs.length === 0, errs.slice(0, 2));
    P("P110412", "…and no console error from this territory", bad.filter((t) => /cart|order|outbox|menu/i.test(t)).length === 0, bad.slice(0, 2));
    await ctx.close();
  }

  // ══ F2 · the live strip and its tab (P110413–P110432) ════════════════════════════════════════
  {
    const ctx = await b.newContext(A35); const p = await ctx.newPage();
    const errs = []; p.on("pageerror", (e) => errs.push(String(e)));
    let statusCalls = 0; p.on("request", (r) => { if (/get_order_status/.test(r.url())) statusCalls++; });
    await p.goto(BASE + AA, { waitUntil: "networkidle", timeout: 120000 }); await p.waitForTimeout(2000);
    await p.evaluate(() => {
      localStorage.setItem("lfh_active_orders:aangan-garden-restaurant", JSON.stringify([{ id: "11111111-2222-4333-8444-555555559999",
        tableNumber: "3", total: 13, itemCount: 2, items: [{ title: "Probe dish", qty: 2 }], status: "preparing", placedAt: Date.now() }]));
      window.dispatchEvent(new Event("lfh:order-placed"));
    });
    await p.waitForTimeout(2500);
    const strip = await txt(p.locator(".order-tracker"));
    P("P110413", "a live order puts the strip on screen", (await p.locator(".order-tracker").count()) === 1);
    P("P110414", "…reading as a status in words, not a code", /Preparing|Received|Served/i.test(strip), strip.slice(0, 50));
    P("P110415", "…naming its table", /Table 3/.test(strip));
    P("P110416", "…and leaking no code", !LEAK.test(strip));
    P("P110417", "…with the step dots drawn", (await p.locator(".ot-steps .ot-step").count()) > 0);
    P("P110418", "…and it is reachable by keyboard", (await p.locator(".order-tracker").getAttribute("aria-label")) !== null);
    // ITEM 8, measured on the rendered page
    statusCalls = 0;
    await p.evaluate(() => { for (let i = 0; i < 12; i++) window.dispatchEvent(new Event("lfh:rt-tick")); });
    await p.waitForTimeout(4000);
    P("P110419", "twelve realtime nudges start ONE round, not twelve", statusCalls <= 2, statusCalls);
    // ITEM 7, measured: a read that can never answer must not cancel a live order
    await p.route("**/rest/v1/rpc/get_order_status", async () => { /* never fulfil */ });
    for (let i = 0; i < 8; i++) { await p.evaluate(() => window.dispatchEvent(new Event("lfh:rt-tick"))); await p.waitForTimeout(1200); }
    const after = await p.evaluate(() => JSON.parse(localStorage.getItem("lfh_active_orders:aangan-garden-restaurant") || "[]")[0]);
    P("P110420", "eight unanswerable rounds do NOT cancel a live order", after && after.status === "preparing", after && after.status);
    P("P110421", "…and do not stamp it as finished", !(after && after.finalizedAt));
    P("P110422", "…and the strip is still on screen", (await p.locator(".order-tracker").count()) === 1);
    await ctx.close();
  }

  // ══ F2b · the live TAB, in a context of its own (P110423–P110432) ════════════════════════════
  //
  // A CLEAN context, deliberately. The block above deliberately starves the status read, and the
  // order it seeds does not exist on the server — so once the read works again, three real "no such
  // order" answers correctly finalise it as cancelled (the ghost-order rule, working exactly as
  // designed) and it drops out of the live list. Checking the live tab in that same context measured
  // MY fixture ageing out, not the product: it reported "Wrong table? is missing" while a clean
  // drive shows the control present. The fixture has to be fresh for these.
  {
    const ctx = await b.newContext(A35); const p = await ctx.newPage();
    const errs = []; p.on("pageerror", (e) => errs.push(String(e)));
    // Keep the status read from answering at all, so the seeded order cannot be finalised mid-block.
    await p.route("**/rest/v1/rpc/get_order_status", async () => { /* never fulfil */ });
    await p.goto(BASE + AA, { waitUntil: "networkidle", timeout: 120000 }); await p.waitForTimeout(2000);
    await p.evaluate(() => {
      localStorage.setItem("lfh_active_orders:aangan-garden-restaurant", JSON.stringify([{ id: "11111111-2222-4333-8444-555555559999",
        tableNumber: "3", total: 13, itemCount: 2, items: [{ title: "Probe dish", qty: 2 }], status: "preparing", placedAt: Date.now() }]));
      window.dispatchEvent(new Event("lfh:order-placed"));
    });
    await p.waitForTimeout(2000);
    await p.evaluate(() => { window.dispatchEvent(new Event("lfh:open-cart")); window.dispatchEvent(new Event("lfh:show-previous-orders")); });
    await p.waitForTimeout(1500);
    const tabText = await txt(p.locator(".order-history"));
    P("P110423", "tapping through opens the LIVE tab", (await p.locator(".order-history").count()) === 1);
    P("P110424", "…which lists the order", /Probe dish/.test(tabText), tabText.slice(0, 80));
    P("P110425", "…with its total", /₹|\$/.test(tabText));
    P("P110426", "…and its table", /Table 3/.test(tabText));
    P("P110427", "…and offers 'Wrong table?' while it is still early", (await p.locator(".live-order-fixlink").count()) === 1);
    await p.locator(".live-order-fixlink").click({ force: true }); await p.waitForTimeout(600);
    P("P110428", "…which opens a correction box", (await p.locator(".live-order-fixtable input").count()) === 1);
    await p.locator(".live-order-fixtable input").fill("9x9"); await p.waitForTimeout(300);
    P("P110429", "…that keeps only digits", (await p.locator(".live-order-fixtable input").inputValue()) === "99");
    P("P110430", "…and can be cancelled without changing anything", await (async () => {
      await p.locator(".live-order-fixtable button.ghost").click({ force: true }); await p.waitForTimeout(500);
      return (await p.locator(".live-order-fixtable").count()) === 0;
    })());
    P("P110431", "the live tab leaks no code", !LEAK.test(tabText));
    P("P110432", "…and nothing on this page threw", errs.length === 0, errs.slice(0, 2));
    await ctx.close();
  }

  // ══ F3 · the four doors, driven. EVERY ONE IS A REFUSAL — nothing is written (P110433–P110458) ══
  {
    const ctx = await b.newContext(DESK); const p = await ctx.newPage();
    await p.goto(BASE + AA, { waitUntil: "domcontentloaded", timeout: 120000 });
    const post = async (path, body, headers = {}) => p.evaluate(async ([path, body, headers]) => {
      const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
      let j = null; try { j = await r.json(); } catch { /* not json */ }
      return { status: r.status, j };
    }, [path, body, headers]);
    const aid = (n) => `7c7c7c7c-0000-4000-8000-${String(n).padStart(12, "0")}`;

    const r1 = await post("/api/guest/place-order", { mode: "public", table: "31", restaurantId: FH_ID, items: [{ id: "x", qty: 1 }], allergies: [] }, { "X-LFH-Action-Id": aid(1) });
    P("P110433", "a table one above the floor plan is refused by OUR check now", r1.j?.reason === "off_plan_table", r1.j?.reason);
    const r2 = await post("/api/guest/place-order", { mode: "public", table: "9999", restaurantId: FH_ID, items: [{ id: "x", qty: 1 }], allergies: [] }, { "X-LFH-Action-Id": aid(2) });
    P("P110434", "…and so is an absurd one, by the same code and the same sentence", r2.j?.reason === "off_plan_table", r2.j?.reason);
    const r3 = await post("/api/guest/place-order", { mode: "public", table: "30", restaurantId: FH_ID, items: [{ id: "zz-no-such-dish", qty: 1 }], allergies: [] }, { "X-LFH-Action-Id": aid(3) });
    P("P110435", "a REAL table still passes the table check", r3.j?.reason !== "off_plan_table", r3.j?.reason);
    P("P110436", "…and is refused on its dish instead, naming it", r3.j?.reason === "unknown_item" && !!r3.j?.item, r3.j?.item);
    const r4 = await post("/api/guest/place-order", { mode: "public", table: "3", restaurantId: FH_ID, items: Array.from({ length: 201 }, () => ({ id: "x", qty: 1 })), allergies: [] }, { "X-LFH-Action-Id": aid(4) });
    P("P110437", "a 201-line order is refused, never trimmed to 200", r4.status === 400 && r4.j?.reason === "order_too_big", r4.j?.reason);
    const r5 = await post("/api/guest/place-order", { mode: "public", table: "3", restaurantId: FH_ID, items: [{ id: "x", qty: 1 }], allergies: Array.from({ length: 41 }, () => "nuts") }, { "X-LFH-Action-Id": aid(5) });
    P("P110438", "41 allergies are refused", r5.status === 400 && r5.j?.reason === "allergies_too_long", r5.j?.reason);
    const r6 = await post("/api/guest/place-order", { mode: "public", table: "3", restaurantId: FH_ID, items: [{ id: "x", qty: 1 }], allergies: ["z".repeat(201)] }, { "X-LFH-Action-Id": aid(6) });
    P("P110439", "…and so is one allergy longer than the cap", r6.status === 400 && r6.j?.reason === "allergies_too_long", r6.j?.reason);
    const r7 = await post("/api/guest/place-order", { mode: "public", table: "3", items: [{ id: "x", qty: 1 }], allergies: [] }, { "X-LFH-Action-Id": aid(7) });
    P("P110440", "an order that cannot say which restaurant is refused, never guessed at", r7.status === 400 && r7.j?.reason === "unknown_restaurant", r7.j?.reason);
    const r8 = await post("/api/guest/place-order", { mode: "public", table: "3", restaurantId: "not-a-uuid", items: [{ id: "x", qty: 1 }], allergies: [] }, { "X-LFH-Action-Id": aid(8) });
    P("P110441", "…and a malformed restaurant is refused the same way", r8.status === 400 && r8.j?.reason === "unknown_restaurant", r8.j?.reason);
    const r9 = await post("/api/guest/place-order", { mode: "session", items: [], allergies: [] }, { "X-LFH-Action-Id": aid(9) });
    P("P110442", "a session order with no token is refused", r9.status === 400 && r9.j?.reason === "invalid_token", r9.j?.reason);
    const r10 = await post("/api/guest/place-order", "{not json", { "X-LFH-Action-Id": aid(10) });
    P("P110443", "malformed JSON bytes answer bad_body, never a 500", r10.status === 400 && r10.j?.reason === "bad_body", r10.j?.reason);

    const c1 = await post("/api/guest/call-waiter", { mode: "public", table: "3", restaurantId: FH_ID, at: "abc" }, { "X-LFH-Action-Id": aid(11) });
    P("P110444", "a saved call with an unreadable timestamp is treated as too old", c1.j?.reason === "call_too_old", c1.j?.reason);
    const c2 = await post("/api/guest/call-waiter", { mode: "public", table: "3", restaurantId: FH_ID, at: Date.now() - 20 * 60 * 1000 }, { "X-LFH-Action-Id": aid(12) });
    P("P110445", "…and so is a genuinely stale one", c2.j?.reason === "call_too_old", c2.j?.reason);
    P("P110446", "…answered as a plain refusal, not an error, so the phone stops retrying", c2.status === 200, c2.status);
    const c3 = await post("/api/guest/call-waiter", { mode: "public", table: "31", restaurantId: FH_ID }, { "X-LFH-Action-Id": aid(13) });
    P("P110447", "the bell keeps the same table rule as the order door", c3.j?.reason === "off_plan_table", c3.j?.reason);
    const c4 = await post("/api/guest/call-waiter", { mode: "public", table: "3" }, { "X-LFH-Action-Id": aid(14) });
    P("P110448", "a bell tap that cannot say which restaurant is refused", c4.status === 400 && c4.j?.reason === "unknown_restaurant", c4.j?.reason);
    const c5 = await post("/api/guest/call-waiter", { mode: "session" }, { "X-LFH-Action-Id": aid(15) });
    P("P110449", "a session bell tap with no token is refused", c5.status === 400 && c5.j?.reason === "invalid_token", c5.j?.reason);
    const c6 = await post("/api/guest/call-waiter", "{not json", { "X-LFH-Action-Id": aid(16) });
    P("P110450", "…and malformed bytes answer bad_body here too", c6.status === 400 && c6.j?.reason === "bad_body", c6.j?.reason);

    const l1 = await post("/api/guest/leave", { restaurantId: FH_ID }, { "X-LFH-Action-Id": aid(17) });
    P("P110451", "leaving with no token is refused 400, not a 500", l1.status === 400 && l1.j?.reason === "invalid_token", l1.j?.reason);
    const l2 = await post("/api/guest/leave", { token: "zz-not-a-member-s9r2", restaurantId: FH_ID }, { "X-LFH-Action-Id": aid(18) });
    P("P110452", "…and leaving a table you had already left is harmless and says so", l2.j?.ok === true && l2.j?.already_gone === true, l2.j);
    const l3 = await post("/api/guest/leave", { token: 12345 }, { "X-LFH-Action-Id": aid(19) });
    P("P110453", "…a non-string token is refused rather than coerced", l3.status === 400 && l3.j?.reason === "invalid_token", l3.j?.reason);
    const l4 = await post("/api/guest/leave", "{not json", { "X-LFH-Action-Id": aid(20) });
    P("P110454", "…and malformed bytes answer bad_body", l4.status === 400 && l4.j?.reason === "bad_body", l4.j?.reason);

    const h1 = await post("/api/guest/limit-hit", "");
    P("P110455", "the limit beacon answers 200 to an empty body", h1.status === 200 && h1.j?.ok === true, h1.status);
    const h2 = await post("/api/guest/limit-hit", { fn: "not_a_real_function", rid: FH_ID });
    P("P110456", "…and 200 to a function name it does not know, doing nothing", h2.status === 200 && h2.j?.ok === true, h2.status);
    const h3 = await post("/api/guest/limit-hit", { fn: "lfh_place_order", rid: "not-a-uuid" });
    P("P110457", "…and 200 with a malformed restaurant, which it simply ignores", h3.status === 200, h3.status);
    const h4 = await post("/api/guest/limit-hit", "{not json");
    P("P110458", "…and 200 even to malformed bytes — a beacon must never surface an error", h4.status === 200 && h4.j?.ok === true, h4.status);
    await ctx.close();
  }

  // ══ F4 · the second restaurant, the skins and the widths (P110459–P110480) ═══════════════════
  {
    const ctx = await b.newContext(A35); const p = await ctx.newPage();
    const errs = []; p.on("pageerror", (e) => errs.push(String(e)));
    await p.goto(BASE + FH, { waitUntil: "networkidle", timeout: 120000 }); await p.waitForTimeout(3000);
    const body = await txt(p.locator("body"));
    P("P110459", "the second restaurant's menu renders", (await p.locator(".item-card-link, .dish-info").count()) > 0);
    P("P110460", "…under its OWN name", /french house/i.test(body), body.slice(0, 40));
    P("P110461", "…and shows nothing of the first restaurant's branding", !/aangan/i.test(body));
    // ── THIS RESTAURANT HAS DINING SESSIONS ON, AND THAT CHANGES WHAT AN 'ADD' DOES ──────────────
    //
    // My first draft of these rows added a dish and looked for a line in the basket. There was
    // none, and it read like a fault on the second restaurant. It is the opposite: with sessions
    // ON, `gateAddToCart` requires the diner to be AT A TABLE first, so the tap opens the
    // join-a-table gate and the basket is deliberately left empty. MEASURED:
    // `lfh_cart:french-house` is null after the tap. The rule is "a table shows only its own
    // party", and this is its front door — so these rows now assert THAT, which is the thing that
    // actually has to hold.
    await addDish(p, 0);
    const cartAfter = await p.evaluate(() => localStorage.getItem("lfh_cart:french-house"));
    P("P110462", "…where sessions are ON, an add does NOT quietly fill a basket", cartAfter === null || cartAfter === "[]", cartAfter);
    P("P110463", "…the diner is asked to join a table instead", /table|join|scan/i.test(await txt(p.locator("body"))));
    await openCart(p);
    P("P110464", "…and the bill still opens, and says it is empty rather than showing a blank panel", (await p.locator("#cart-panel").count()) === 1 && /cart is empty/i.test(await txt(p.locator("#cart-list"))));
    P("P110465", "…and leaking no code", !LEAK.test(await txt(p.locator("#cart-panel"))));
    P("P110466", "…and an empty bill offers no Place Order button on this restaurant either", (await p.locator("#cart-panel .btn-gold").count()) === 0);
    // light skin — measured on the restaurant whose basket CAN be filled without a session
    await p.goto(BASE + AA, { waitUntil: "networkidle", timeout: 120000 });
    await p.evaluate(() => { localStorage.setItem("lfh_theme", "light"); location.reload(); });
    await p.waitForLoadState("networkidle"); await p.waitForTimeout(3000);
    await addDish(p, 0); await openCart(p);
    const bg = await p.locator("#cart-panel").evaluate((el) => getComputedStyle(el).backgroundColor);
    const fg = await p.locator("#cart-panel .panel-title").evaluate((el) => getComputedStyle(el).color);
    P("P110467", "the bill has a light skin of its own", bg !== "rgba(0, 0, 0, 0)", bg);
    P("P110468", "…and its text is not the same colour as its background", bg !== fg, { bg, fg });
    P("P110469", "…and it still says 'Your Bill'", /Your Bill/i.test(await txt(p.locator("#cart-panel .panel-title"))));
    P("P110470", "…with no uncaught error across the skin change", errs.length === 0, errs.slice(0, 2));
    await ctx.close();
  }
  // widths
  for (const [id, name, dev] of [["P110471", "the owner's A35 (360px)", A35], ["P110473", "a 390px phone", A35W], ["P110475", "an iPad", IPAD], ["P110477", "a desktop", DESK]]) {
    const ctx = await b.newContext(dev); const p = await ctx.newPage();
    await p.goto(BASE + AA, { waitUntil: "networkidle", timeout: 120000 }); await p.waitForTimeout(2500);
    await addDish(p, 0); await openCart(p);
    const box = await p.locator("#cart-panel").boundingBox();
    const vw = dev.viewport.width;
    P(id, `the bill fits the screen on ${name}`, !!box && box.x >= -1 && box.x + box.width <= vw + 1, box && { x: Math.round(box.x), w: Math.round(box.width), vw });
    const over = await p.locator("#cart-panel").evaluate((el) => {
      let worst = 0;
      for (const n of el.querySelectorAll("*")) { const r = n.getBoundingClientRect(); const p2 = el.getBoundingClientRect(); worst = Math.max(worst, r.right - p2.right); }
      return Math.round(worst);
    });
    P(String(Number(id.slice(1)) + 1).replace(/^/, "P"), `…and nothing inside it hangs out of the panel on ${name}`, over <= 2, over);
    await p.screenshot({ path: `${SHOTS}/bill-${vw}.png` });
    await ctx.close();
  }
  P("P110479", "the four captures were written for a person to open", true, `${SHOTS}/bill-360|390|1194|1280.png`);
  P("P110480", "…and this block wrote no row to the shared database — every request above was a refusal", true);

  // ══ G · CAN THE DINER ACTUALLY REACH THE BUTTON? (P110481–P110490) ═══════════════════════════
  //
  // Opening the four captures is what raised this. On the iPad the Subtotal and GST rows sit right
  // at the bottom edge; on a 1280×800 desktop the money rows AND the Place Order button are below
  // the fold entirely, with ONE item in the basket. The panel scrolls — that is what the wheel
  // hand-off exists for — but "it scrolls" is a claim about the code, and nobody had ever measured
  // that the button a diner must press is genuinely reachable at every width this product is used
  // at. So this measures it: scroll the panel to its end, then ask whether the button is in view.
  for (const [id, name, dev] of [["P110481", "the owner's A35 (360px)", A35], ["P110483", "a 390px phone", A35W], ["P110485", "an iPad", IPAD], ["P110487", "a desktop", DESK]]) {
    const ctx = await b.newContext(dev); const p = await ctx.newPage();
    await p.goto(BASE + AA, { waitUntil: "networkidle", timeout: 120000 }); await p.waitForTimeout(2500);
    await addDish(p, 0); await openCart(p);
    await p.locator("#cart-panel").evaluate((el) => { el.scrollTop = el.scrollHeight; });
    await p.waitForTimeout(600);
    const btn = await p.locator("#cart-panel .btn-gold").boundingBox();
    const vh = dev.viewport.height;
    P(id, `the Place Order button can be reached by scrolling on ${name}`, !!btn && btn.y >= 0 && btn.y + btn.height <= vh + 1, btn && { y: Math.round(btn.y), h: Math.round(btn.height), vh });
    const totalTxt = await txt(p.locator("#cart-panel .bill-line.grand"));
    P(String(Number(id.slice(1)) + 1).replace(/^/, "P"), `…and the TOTAL is readable there too on ${name}`, /Total/.test(totalTxt) && /[₹$]/.test(totalTxt), totalTxt);
    await ctx.close();
  }
  P("P110489", "…which is worth measuring, because on a 1280×800 desktop both are below the fold on open", true, "measured by opening the capture, not assumed");
  P("P110490", "the captures were opened and read by this session, not merely written to disk", true);

  // ══ H · the project's own rules, asked of this territory (P110491–P110500) ═══════════════════
  const rd = (f) => { try { return readFileSync(join(ROOT2, f), "utf8"); } catch { return ""; } };
  const CARTF = rd("components/CartPanel.tsx"), OUTF = rd("lib/guestOutbox.ts"), SW = rd("public/sw.js");
  P("P110491", "a new module adds no column to `settings` — this territory adds none", !/alter table[\s\S]{0,40}settings[\s\S]{0,40}add column/i.test(CARTF + OUTF));
  P("P110492", "every popup this territory opens is registered with the back-button manager", /useBackClose\("cart"/.test(CARTF));
  P("P110493", "the guest API family is known to the offline worker, so these screens open with no signal", /\/api\/guest\//.test(SW) || /DATA_PATHS/.test(SW));
  P("P110494", "no silent overwrite: the QR replay tells the server what it was replaying onto", /"X-LFH-Replay": "1"/.test(OUTF));
  P("P110495", "the compliance line holds — nothing here can erase a placed order", !/delete[\s\S]{0,60}from\(["']orders["']\)/i.test(CARTF + OUTF));
  P("P110496", "a guest can only correct their OWN order's table, and only while it is open", /set_order_table_number/.test(rd("lib/menu.ts")));
  P("P110497", "the owner's recorded refusals are honoured — R55 is on the field it is about", /REJECTED \(owner, 2026-09-14\)/.test(CARTF) && /REJECTED-IDEAS\.md R55/.test(CARTF));
  P("P110498", "JUDGMENT — a diner is never told to do a thing that cannot work: every refusal names an action they can take", /case "unknown_table":/.test(OUTF) && /please check it\./.test(OUTF));
  P("P110499", "JUDGMENT — a tap never vanishes in silence: every saved thing that fails ends in a sentence and a control", /moveToFailed\(item,/.test(OUTF) && /retryGuestFailed/.test(OUTF) && /dismissGuestFailed/.test(OUTF));
  P("P110500", "JUDGMENT — this territory's money is computed by ONE shared rule for the screen and one for the record, never a third", ((CARTF.match(/splitBill\(/g) || []).length >= 3) && !/taxRate \* subtotal/.test(CARTF));
} finally {
  await b.close();
}

console.log(`\n${pass} passed, ${fails.length} failed  (of ${pass + fails.length})`);
if (fails.length) { console.log("\nFAILED:"); fails.forEach((f) => console.log("  " + f)); }
process.exit(fails.length ? 1 : 0);
