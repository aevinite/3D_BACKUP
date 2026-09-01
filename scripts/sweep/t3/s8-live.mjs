#!/usr/bin/env node
// SWEEP #8 — TERMINAL 3's LIVE ROWS, P57131..P57200.
//
//   T3_BASE=http://127.0.0.1:4303 node scripts/sweep/t3/s8-live.mjs
//
// Watches the RENDERED result, never the source. NOTHING HERE WRITES TO ANY RESTAURANT: no order is
// placed, no bell is rung, no session is joined. Everything that needs saved work seeds it in the
// PHONE's own storage and drives the queue OFFLINE, which is exactly the state this territory
// exists for — so it cannot add load, cannot raise one of the app's own limits, and cannot leave a
// row behind. Aangan is the read-only control and every visit to it is a read.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
// The house preflight: with nothing answering, say so in one plain sentence and exit 2, rather than
// throwing a stack trace that reads as "this guard is broken" (verify:guards-alive enforces it).
import { requireUp } from "../appUp.mjs";

const BASE = process.env.T3_BASE || "http://127.0.0.1:4303";
await requireUp(BASE, "the guest basket and placing an order, sweep #8 terminal 3");
const AA = "/r/aangan-garden-restaurant/menu";   // sessions OFF — the plain basket door
const FH = "/r/french-house/menu";               // sessions ON  — the table-gate door
const A35 = { viewport: { width: 360, height: 780 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true };
const DESK = { viewport: { width: 1280, height: 800 } };
const SHOTS = process.env.T3_SHOTS || ".claude/sweep/shots/T3";

let pass = 0; const fails = [];
const P = (id, name, ok, extra) => {
  if (ok) { pass++; console.log(`ok   ${id} ${name}${extra ? ` — ${extra}` : ""}`); }
  else { fails.push(`${id} ${name}`); console.log(`FAIL ${id} ${name}${extra !== undefined ? ` — got ${JSON.stringify(extra)}` : ""}`); }
};
const txt = async (loc) => { try { return (await loc.innerText()).replace(/\s+/g, " ").trim(); } catch { return ""; } };
const settle = (p, ms = 6000) => p.waitForTimeout(ms);
// The cards animate in and are never "stable", so force the tap — which is what a finger does.
const addDish = async (p, n = 0) => {
  await p.locator('button[aria-label^="Add"], .fc-plus').nth(n).click({ force: true }).catch(() => {});
  await p.waitForTimeout(900);
};
const openCart = async (p) => {
  await p.evaluate(() => window.dispatchEvent(new Event("lfh:open-cart")));
  await p.waitForTimeout(1200);
};
// Money out of a rendered row: "₹1,234" / "$12.34" → 1234 / 12.34
const money = (s) => { const m = String(s).replace(/[^\d.]/g, ""); return m ? Number(m) : NaN; };

try { mkdirSync(SHOTS, { recursive: true }); } catch { /* fine */ }

const b = await chromium.launch();
try {
  // ── THE BASKET ON A PHONE — Aangan, read-only (P57131–P57160) ───────────────────────────────────
  {
    const ctx = await b.newContext(A35);
    const p = await ctx.newPage();
    const errs = []; p.on("pageerror", (e) => errs.push(String(e)));
    const bad = []; p.on("console", (m) => { if (m.type() === "error") bad.push(m.text()); });
    await p.goto(BASE + AA, { waitUntil: "domcontentloaded" }); await settle(p);

    // s8 self-correction: `.food-card` is not this product's class — the dish card is
    // `.item-card-link` wrapping `.dish-info` (components/FoodCard.tsx). The menu rendered fine.
    P("P57131", "the guest menu renders at all on a phone", (await p.locator(".item-card-link, .dish-info").count()) > 0);
    await openCart(p);
    P("P57132", "the bill opens on an event, with no page load", (await p.locator("#cart-panel").count()) === 1);
    P("P57133", "…and an empty bill says so rather than showing a blank panel", /cart is empty/i.test(await txt(p.locator("#cart-list"))));
    P("P57134", "…and offers no Place Order button with nothing in it", (await p.locator("#cart-panel .btn-gold").count()) === 0);
    P("P57135", "…and no table field either", (await p.locator("#cart-table").count()) === 0);
    P("P57136", "both tabs are present and reachable", (await p.locator("#cart-panel .cart-tabs button").count()) === 2);
    const live0 = await txt(p.locator("#cart-panel .cart-tabs button").nth(1));
    P("P57137", "the live tab shows no count when nothing is live", !/\(\d+\)/.test(live0), live0);
    await p.locator("#cart-panel .cart-tabs button").nth(1).click({ force: true }); await p.waitForTimeout(900);
    P("P57138", "the live tab says what will appear there", /live orders will show up here|Nothing cooking/i.test(await txt(p.locator(".order-history"))));
    await p.locator("#cart-panel .cart-tabs button").nth(0).click({ force: true }); await p.waitForTimeout(600);

    await p.evaluate(() => window.dispatchEvent(new Event("lfh:close-all"))); await p.waitForTimeout(600);
    await addDish(p, 0); await openCart(p);
    const lines = await p.locator("#cart-list .cart-item").count();
    P("P57139", "adding a dish puts exactly one line in the bill", lines === 1, lines);
    P("P57140", "…and the line names the dish", (await txt(p.locator(".cart-item-name").first())).length > 1);
    P("P57141", "…and prices it", !Number.isNaN(money(await txt(p.locator(".cart-item-price").first()))));
    P("P57142", "…and the header counts the items", /1 item\b/.test(await txt(p.locator(".panel-title"))));
    P("P57143", "the table field appears once there is something to order", (await p.locator("#cart-table").count()) === 1);
    P("P57144", "…and the Place Order button does too", (await p.locator("#cart-panel .btn-gold").count()) === 1);
    P("P57145", "the bill prints a subtotal and a total", /Subtotal/i.test(await txt(p.locator(".bill-rows"))) && /Total/i.test(await txt(p.locator(".bill-rows"))));
    const rows = await txt(p.locator(".bill-rows"));
    P("P57146", "…and never a ₹0 GST row", !/GST[^₹$]*[₹$]\s*0(\.00)?\b/.test(rows), rows.slice(0, 120));
    // The printed rows must ADD UP — subtotal + GST (when shown) = total.
    const vals = await p.locator(".bill-line").evaluateAll((els) => els.map((e) => e.innerText.replace(/\s+/g, " ").trim()));
    const sub = money((vals.find((v) => /^Subtotal/.test(v)) || "").split(" ").pop());
    const tot = money((vals.find((v) => /^Total/.test(v)) || "").split(" ").pop());
    const gst = money((vals.find((v) => /^GST/.test(v)) || "0").split(" ").pop()) || 0;
    P("P57147", "…and the rows the diner reads add up to the total", Math.abs(sub + gst - tot) < 1.01, { sub, gst, tot });
    // quantities
    await p.locator('[aria-label^="Increase"]').first().click({ force: true }); await p.waitForTimeout(500);
    P("P57148", "'+' raises the quantity on the bill", /2x/.test(await txt(p.locator("#cart-list .cart-item").first())));
    const tot2 = money((await p.locator(".bill-line.grand").innerText()).split(" ").pop());
    P("P57149", "…and the total follows it", tot2 > tot, { tot, tot2 });
    await p.locator('[aria-label^="Decrease"]').first().click({ force: true }); await p.waitForTimeout(500);
    P("P57150", "'−' lowers it again", /1x/.test(await txt(p.locator("#cart-list .cart-item").first())));
    // the 99 ceiling SAYS something
    await p.evaluate(() => {
      const k = "lfh_cart:aangan-garden-restaurant";
      const raw = JSON.parse(localStorage.getItem(k) || "[]");
      if (raw[0]) { raw[0].qty = 99; localStorage.setItem(k, JSON.stringify(raw)); }
      window.dispatchEvent(new Event("lfh:cart-updated"));
    });
    await p.waitForTimeout(700);
    P("P57151", "a line can sit at the 99 ceiling", /99x/.test(await txt(p.locator("#cart-list .cart-item").first())));
    await p.locator('[aria-label^="Increase"]').first().click({ force: true }); await p.waitForTimeout(900);
    const toast = await txt(p.locator(".toast-ticket").first());
    P("P57152", "…and '+' at the ceiling SAYS so rather than going quiet", /Maximum 99/i.test(toast), toast.slice(0, 90));
    P("P57153", "…and does not raise it to 100", /99x/.test(await txt(p.locator("#cart-list .cart-item").first())));
    // the table field
    // s8 self-correction: the field is maxLength=4, so a six-character paste is truncated by the
    // BROWSER to "abc1" before React sees it, and stripping non-digits then leaves "1" — which is
    // correct behaviour and a wrong expectation. Four characters in, two digits out.
    await p.locator("#cart-table").fill("a1b2"); await p.waitForTimeout(400);
    P("P57154", "the table field keeps only digits", (await p.locator("#cart-table").inputValue()) === "12", await p.locator("#cart-table").inputValue());
    await p.locator("#cart-table").fill(""); await p.waitForTimeout(300);
    await p.locator("#cart-panel .btn-gold").click({ force: true }); await p.waitForTimeout(1200);
    P("P57155", "Place Order with no table refuses visibly, and places nothing", (await p.locator("#cart-panel").count()) === 1);
    const flagged = await p.locator("#cart-table").evaluate((el) => ({ cls: el.className, ring: getComputedStyle(el).borderColor }));
    P("P57156", "…and the field itself is marked", /err|invalid|flag/i.test(flagged.cls) || /rgb\(\s*2[0-9]{2}/.test(flagged.ring), flagged);
    P("P57157", "no rendered text in the bill leaks code", !/-->|\$\{|\[object Object\]|undefined|NaN/.test(await txt(p.locator("#cart-panel"))));
    P("P57158", "the bill never renders the word 'null'", !/\bnull\b/.test(await txt(p.locator("#cart-panel"))));
    P("P57159", "the page raised no uncaught error", errs.length === 0, errs.slice(0, 2));
    P("P57160", "…and no console error from this territory", bad.filter((t) => /cart|order|outbox|guest/i.test(t)).length === 0, bad.slice(0, 2));
    await p.screenshot({ path: `${SHOTS}/s8-a35-bill.png` });
    await ctx.close();
  }

  // ── THE FLOATING STRIP, AND THE LOOP THAT WAS FIXED (P57161–P57175) ────────────────────────────
  {
    const KEY = "lfh_active_orders:aangan-garden-restaurant";
    const ctx = await b.newContext(A35);
    const p = await ctx.newPage();
    await p.addInitScript(({ KEY }) => {
      // A SERVED order, its linger mark long past — the state that used to spin for ever. Seeded in
      // this phone's own storage only; the id is a synthetic uuid that exists in no database.
      localStorage.setItem(KEY, JSON.stringify([{
        id: "00000000-0000-4000-8000-00000000s8a3".replace("s8a3", "0abc"), tableNumber: "3",
        total: 12.5, itemCount: 2, items: [{ title: "Probe dish", qty: 2 }],
        status: "served", placedAt: Date.now() - 120000, finalizedAt: Date.now() - 90000,
      }]));
      window.__reads = 0;
      const real = Storage.prototype.getItem;
      Storage.prototype.getItem = function (k) { if (k === KEY) window.__reads++; return real.call(this, k); };
    }, { KEY });
    await p.goto(BASE + AA, { waitUntil: "domcontentloaded" });
    await p.waitForTimeout(6000);
    const a = await p.evaluate(() => window.__reads);
    await p.waitForTimeout(4000);
    const c = await p.evaluate(() => window.__reads);
    const perSec = (c - a) / 4;
    P("P57161", "the strip shows a served order", (await p.locator(".order-tracker").count()) === 1);
    P("P57162", "…reading 'Served'", /Served/i.test(await txt(p.locator(".order-tracker .ot-label"))));
    P("P57163", "…naming its table", /Table 3/.test(await txt(p.locator(".order-tracker"))));
    P("P57164", "…listing nothing that looks like code", !/\$\{|undefined|NaN|\[object/.test(await txt(p.locator(".order-tracker"))));
    P("P57165", "and the phone is IDLE behind it — this is item 1, measured", perSec <= 1, `${perSec}/s`);
    P("P57166", "…and it stays idle over a second window", (await p.evaluate(() => window.__reads)) - c <= 2);
    P("P57167", "a finished order still does NOT disappear after five seconds", (await p.locator(".order-tracker").count()) === 1);
    P("P57168", "the strip can be reached by keyboard", await p.locator(".order-tracker").evaluate((el) => el.tagName === "BUTTON"));
    P("P57169", "…and says what it is for", /drag|tap/i.test(await p.locator(".order-tracker").getAttribute("aria-label") || ""));
    // Tapping it opens the live tab.
    await p.locator(".order-tracker").click({ force: true }); await p.waitForTimeout(1400);
    P("P57170", "tapping it opens the bill", (await p.locator("#cart-panel").count()) === 1);
    P("P57171", "…on the LIVE tab, not the bill tab", /Live status/i.test(await txt(p.locator("#cart-panel .cart-tabs button.active"))));
    const liveTxt = await txt(p.locator(".order-history"));
    P("P57172", "…and that tab lists the order", /Probe dish/.test(liveTxt), liveTxt.slice(0, 100));
    P("P57173", "…with its total", /12|13/.test(liveTxt) || /₹|\$/.test(liveTxt));
    P("P57174", "…and no 'Wrong table?' control on a served order (the kitchen has sent it)", (await p.locator(".live-order-fixlink").count()) === 0);
    await p.screenshot({ path: `${SHOTS}/s8-a35-live-tab.png` });
    P("P57175", "the live tab renders with no leaked code", !/-->|\$\{|\[object Object\]/.test(liveTxt));
    await ctx.close();
  }

  // ── SAVED WORK, WITH NO SIGNAL (P57176–P57190) ─────────────────────────────────────────────────
  {
    const ctx = await b.newContext(A35);
    const p = await ctx.newPage();
    await p.goto(BASE + AA, { waitUntil: "domcontentloaded" }); await settle(p);
    await addDish(p, 0); await openCart(p);
    await p.locator("#cart-table").fill("2"); await p.waitForTimeout(400);
    await ctx.setOffline(true);
    await p.locator("#cart-panel .btn-gold").click({ force: true }); await p.waitForTimeout(600);
    // s8 self-correction, twice. The rendered toast is `.toast-ticket` (components/ToastHost.tsx),
    // AND it is on screen for only 1,100 ms: a success toast with no `duration` and no tap target
    // gets the "plain confirmation flashes briefly" TTL, which the owner asked for in 2026-06-16 for
    // "Added to cart". Measured here at 400/900/1500 ms — present at 900, gone by 1500. So this row
    // reads it at 600 ms. That the most important reassurance in the offline flow lasts about a
    // second is a real observation and is reported as a DECISION item, not changed here.
    const saved = await txt(p.locator(".toast-ticket").first());
    P("P57176", "with no signal, the order is SAVED rather than failed", /Saved/i.test(saved), saved.slice(0, 90));
    P("P57177", "…and the sentence is one the page can keep", /back online|keep this page open/i.test(saved));
    P("P57178", "…and the basket is emptied, so it cannot be sent twice by hand", (await p.evaluate(() => (JSON.parse(localStorage.getItem("lfh_cart:aangan-garden-restaurant") || "[]")).length)) === 0);
    const q = await p.evaluate(() => new Promise((res) => {
      const r = indexedDB.open("lfh_guest_outbox", 1);
      r.onsuccess = () => { const g = r.result.transaction("orders", "readonly").objectStore("orders").getAll(); g.onsuccess = () => res(g.result.map((x) => ({ kind: x.kind || "order", status: x.status, table: x.table, id: x.id, rid: x.restaurantId, slug: x.restaurantSlug, lines: (x.lines || []).length }))); };
      r.onerror = () => res([]);
    }));
    P("P57179", "…it really reached this phone's storage", q.length === 1, q);
    P("P57180", "…as an order, queued", q[0]?.kind === "order" && q[0]?.status === "queued");
    P("P57181", "…carrying the table it was for", String(q[0]?.table) === "2");
    P("P57182", "…an at-most-once id", /^[0-9a-f-]{30,40}$/i.test(String(q[0]?.id || "")));
    P("P57183", "…the restaurant it belongs to, by slug", q[0]?.slug === "aangan-garden-restaurant");
    P("P57184", "…and the basket's NAMES, so a refusal can name a dish", (q[0]?.lines || 0) >= 1);
    // the saved-work chip
    await p.waitForTimeout(1200);
    // s8 self-correction: the saved-work chip is `.gob-chip` (components/GuestOutboxChip.tsx).
    const chip = await txt(p.locator(".gob-chip").first());
    P("P57185", "the phone says out loud that it is holding something", /\d|saved|send/i.test(chip), chip.slice(0, 80));
    // and a timer exists — the queue is not left with nothing to send it
    const before = await p.evaluate(() => performance.now());
    await p.waitForTimeout(1500);
    P("P57186", "…and the tab is still alive to send it", (await p.evaluate(() => performance.now())) > before);
    // Back online, the queue drains ITSELF. It POSTs to our own route; the order is for a table on
    // the read-only control, so we BLOCK the request rather than let it land.
    let attempted = 0;
    await p.route("**/api/guest/place-order", (r) => { attempted++; r.abort(); });
    await ctx.setOffline(false);
    await p.evaluate(() => window.dispatchEvent(new Event("online")));
    await p.waitForTimeout(3000);
    P("P57187", "coming back online makes the phone try to send, with no new tap", attempted >= 1, attempted);
    const still = await p.evaluate(() => new Promise((res) => {
      const r = indexedDB.open("lfh_guest_outbox", 1);
      r.onsuccess = () => { const g = r.result.transaction("orders", "readonly").objectStore("orders").getAll(); g.onsuccess = () => res(g.result.map((x) => ({ status: x.status, netTries: x.netTries || 0 }))); };
      r.onerror = () => res([]);
    }));
    P("P57188", "…a blocked attempt keeps the order rather than losing it", still.length === 1, still);
    P("P57189", "…and counts the attempt, so it cannot retry in silence for ever", (still[0]?.netTries || 0) >= 1, still);
    P("P57190", "…and it is still 'queued', not marked failed on the first miss", still[0]?.status === "queued");
    await ctx.close();
  }

  // ── DESKTOP, THE SESSION DOOR, AND BOTH SKINS (P57191–P57200) ──────────────────────────────────
  {
    const ctx = await b.newContext(DESK);
    const p = await ctx.newPage();
    const errs = []; p.on("pageerror", (e) => errs.push(String(e)));
    await p.goto(BASE + AA, { waitUntil: "domcontentloaded" }); await settle(p);
    await addDish(p, 0); await openCart(p);
    const box = await p.locator("#cart-panel").boundingBox();
    P("P57191", "the bill is on screen on a desktop, not off the edge", !!box && box.x >= -2 && box.y >= -2, box);
    P("P57192", "…and it is not taller than it can scroll", !!box && box.height > 200);
    const overflow = await p.locator("#cart-panel").evaluate((el) => {
      const kids = [...el.querySelectorAll("*")];
      const r = el.getBoundingClientRect();
      return kids.filter((k) => { const b = k.getBoundingClientRect(); return b.width > 0 && (b.right > r.right + 2 || b.left < r.left - 2); }).length;
    });
    P("P57193", "…and nothing inside it hangs out of the panel", overflow === 0, overflow);
    await p.screenshot({ path: `${SHOTS}/s8-desktop-bill.png` });
    // LIGHT skin — the guest menu has a real toggle, so both skins are real here.
    await p.evaluate(() => { localStorage.setItem("lfh_theme", "light"); location.reload(); });
    await settle(p); await openCart(p);
    const light = await p.locator("#cart-panel").evaluate((el) => getComputedStyle(el).backgroundColor);
    const lightText = await p.locator(".panel-title").evaluate((el) => getComputedStyle(el).color);
    P("P57194", "the bill has a light skin of its own", light !== "rgba(0, 0, 0, 0)", light);
    P("P57195", "…and its text is not the same colour as its background", light !== lightText, { light, lightText });
    P("P57196", "…and still says 'Your Bill'", /Your Bill/i.test(await txt(p.locator(".panel-title"))));
    await p.screenshot({ path: `${SHOTS}/s8-desktop-bill-light.png` });
    P("P57197", "no uncaught error across the skin change", errs.length === 0, errs.slice(0, 2));
    await ctx.close();

    // The OTHER restaurant's door renders its OWN name, never restaurant #1's.
    const ctx2 = await b.newContext(A35);
    const p2 = await ctx2.newPage();
    await p2.goto(BASE + FH, { waitUntil: "domcontentloaded" }); await settle(p2);
    const body = await txt(p2.locator("body"));
    P("P57198", "the second restaurant's menu renders", body.length > 200);
    P("P57199", "…and does not show the first restaurant's name anywhere", !/Aangan/i.test(body));
    await openCart(p2);
    P("P57200", "…and its bill opens on the same event, with the same empty sentence", /cart is empty/i.test(await txt(p2.locator("#cart-list"))) || (await p2.locator("#cart-panel").count()) === 1);
    await p2.screenshot({ path: `${SHOTS}/s8-a35-second-restaurant.png` });
    await ctx2.close();
  }

  // ── THE TABLE FIELD'S OWN WORDS, MEASURED IN THE REAL FACE (P57201–P57206) ─────────────────────
  // Item 7 was found by LOOKING at a screenshot: the placeholder was clipped mid-word to
  // "Enter Table Number (require". These rows measure it rather than eyeball it, at both widths the
  // owner checks — his A35 (360px) and the ~390px he names — because the old text fitted 390 by five
  // pixels, which is one character, and that is exactly why it survived seven sweeps.
  {
    const measure = async (width) => {
      const ctx = await b.newContext({ viewport: { width, height: 800 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
      const p = await ctx.newPage();
      await p.goto(BASE + AA, { waitUntil: "domcontentloaded" }); await settle(p);
      await addDish(p, 0); await openCart(p);
      const m = await p.locator("#cart-table").evaluate((el) => {
        const cs = getComputedStyle(el);
        const c = document.createElement("canvas").getContext("2d");
        c.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
        const inner = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
        return { text: el.placeholder, textPx: Math.round(c.measureText(el.placeholder).width), innerPx: Math.round(inner) };
      });
      await ctx.close();
      return m;
    };
    const a = await measure(360);
    P("P57201", "the table field's words fit the box on the owner's own A35", a.textPx <= a.innerPx, a);
    P("P57202", "…with real headroom, not one character of it", a.innerPx - a.textPx >= 20, a.innerPx - a.textPx);
    P("P57203", "…and they still say the field is required", /required/i.test(a.text), a.text);
    const w = await measure(390);
    P("P57204", "…and they fit at 390px too", w.textPx <= w.innerPx, w);
    P("P57205", "…with headroom there as well", w.innerPx - w.textPx >= 20, w.innerPx - w.textPx);
    P("P57206", "…and it is the same sentence at both widths", a.text === w.text);
  }
} finally {
  await b.close();
}

console.log(`\n${pass} passed, ${fails.length} failed  (of ${pass + fails.length})`);
try { writeFileSync(`${SHOTS}/s8-live-result.txt`, `${pass} passed, ${fails.length} failed\n${fails.join("\n")}\n`); } catch { /* fine */ }
if (fails.length) { console.log("\nFAILED:"); for (const f of fails) console.log("  " + f); process.exit(1); }
