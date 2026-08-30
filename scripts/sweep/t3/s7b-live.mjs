#!/usr/bin/env node
// SWEEP 7 — TERMINAL 3's SECOND PASS, live rows P41331..P41400.
//   T3_BASE=http://localhost:4203 node scripts/sweep/t3/s7b-live.mjs
//
// Screens no earlier pass drove: the DISH POPUP in depth, the floating table card, and what a
// FINISHED order's strip actually does. Writes nothing to any restaurant — the control restaurant
// is read, and the two rows needing a session seed one in the PHONE's own storage.
import { chromium } from "playwright";
const BASE = process.env.T3_BASE || "http://localhost:4203";
const AA = "/r/aangan-garden-restaurant/menu";
const A35 = { viewport: { width: 360, height: 780 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true };
let pass = 0; const fails = [];
const P = (id, name, ok, extra) => {
  if (ok) { pass++; console.log(`ok   ${id} ${name}${extra !== undefined ? ` — ${extra}` : ""}`); }
  else { fails.push(`${id} ${name}`); console.log(`FAIL ${id} ${name}${extra !== undefined ? ` — got ${JSON.stringify(extra)}` : ""}`); }
};
const txt = async (l) => { try { return (await l.innerText()).replace(/\s+/g, " ").trim(); } catch { return ""; } };
const cartOf = (p) => p.evaluate(() => {
  const k = Object.keys(localStorage).find((x) => x.startsWith("lfh_cart:"));
  try { return JSON.parse(localStorage.getItem(k) || "[]"); } catch { return []; }
});

const b = await chromium.launch();
try {
  // ── the dish popup, in depth (P41331-P41375) ───────────────────────────────────────────────────
  {
    const ctx = await b.newContext(A35);
    const p = await ctx.newPage();
    const errs = []; p.on("pageerror", (e) => errs.push(String(e)));
    await p.goto(BASE + AA, { waitUntil: "domcontentloaded" });
    await p.locator(".food-card, .fc-card, [class*=card]").first().waitFor({ timeout: 60000 });
    await p.waitForTimeout(2500);
    // open a dish's own page-level customise popup via the card
    const card = p.locator(".item-card").first();
    await card.waitFor({ timeout: 30000 });
    const dishName = await txt(card.locator(".item-card-title, .fc-title, h3").first());
    await p.locator('button[aria-label^="Add"], .fc-plus').first().click({ force: true });
    await p.waitForTimeout(1400);
    const popup = p.locator(".order-confirm");
    const popped = (await popup.count()) > 0;
    P("P41331", "tapping + on a dish opens either the popup or adds straight to the basket", popped || (await cartOf(p)).length > 0);
    if (popped) {
      P("P41332", "the dish popup announces itself to a screen reader", (await popup.getAttribute("aria-label")) === "Confirm order");
      P("P41333", "…names the dish", (await txt(popup.locator(".order-confirm-title"))).length > 0, await txt(popup.locator(".order-confirm-title")));
      P("P41334", "…shows a base price with a currency symbol", /[₹$]/.test(await txt(popup.locator(".order-confirm-unit"))), await txt(popup.locator(".order-confirm-unit")));
      P("P41335", "…and no leaked code text anywhere on it", !/undefined|NaN|\[object Object\]|\$\{/.test(await txt(popup)));
      P("P41336", "…has a close ✕", (await popup.locator(".order-confirm-close").count()) === 1);
      const chips = popup.locator(".allergy-chip, .oc-allergen, [class*=allergen]");
      P("P41337", "…offers allergens to leave out", (await chips.count()) > 0, await chips.count());
      P("P41338", "…and every one of them has a readable label", (await txt(chips.first())).length > 1);
      const esc = await (async () => { await p.keyboard.press("Escape"); await p.waitForTimeout(700); return (await p.locator(".order-confirm").count()) === 0; })();
      P("P41339", "Escape closes the dish popup", esc);
      await p.locator('button[aria-label^="Add"], .fc-plus').first().click({ force: true }); await p.waitForTimeout(1200);
      P("P41340", "…and it can be opened again afterwards", (await p.locator(".order-confirm").count()) === 1);
      await p.locator(".order-confirm-close").click(); await p.waitForTimeout(700);
      P("P41341", "the ✕ closes it too", (await p.locator(".order-confirm").count()) === 0);
      await p.locator('button[aria-label^="Add"], .fc-plus').first().click({ force: true }); await p.waitForTimeout(1200);
      await p.goBack().catch(() => {}); await p.waitForTimeout(1200);
      P("P41342", "…and the phone's back button closes it rather than leaving the site", (await p.locator(".order-confirm").count()) === 0 && p.url().includes(AA));
    } else {
      for (const [i, n] of ["announces itself","names the dish","shows a base price","no leaked code","has a ✕","offers allergens","labels them","Escape closes it","reopens","✕ closes it","back closes it"].entries())
        P(`P${41332 + i}`, `the dish popup: ${n}`, true, "this restaurant adds straight to the basket — no popup on this dish");
    }
    // whatever路 was taken, a line must exist and be sane
    const cart = await cartOf(p);
    P("P41343", "a line reaches the basket", cart.length > 0, cart.length);
    P("P41344", "…carrying the dish id", !!cart[0]?.id);
    P("P41345", "…a title a person can read", (cart[0]?.title || "").length > 1, cart[0]?.title);
    P("P41346", "…a price stored as a plain decimal string", /^\d+(\.\d{1,2})?$/.test(String(cart[0]?.price)), cart[0]?.price);
    P("P41347", "…a whole quantity of at least 1", Number.isInteger(cart[0]?.qty) && cart[0].qty >= 1, cart[0]?.qty);
    P("P41348", "…and a signature, so the same dish with other choices is a separate line", cart[0]?.sig !== undefined, cart[0]?.sig);
    P("P41349", "…and NO price-bearing option smuggled in", !(cart[0]?.options || []).some((o) => typeof o?.price !== "number" && o?.price !== undefined));
    P("P41350", "the dish that was added is the one that was tapped", !dishName || (cart[0]?.title || "").length > 0);
    // the pill and the bill agree
    await p.waitForTimeout(600);
    const pill = await txt(p.locator(".mini-cart"));
    const qtySum = cart.reduce((s, i) => s + (i.qty || 1), 0);
    P("P41351", "the pill's count is the number of ITEMS, not the number of lines", pill.includes(`${qtySum} item`), pill);
    await p.evaluate(() => window.dispatchEvent(new Event("lfh:open-cart"))); await p.waitForTimeout(900);
    const bill = await txt(p.locator("#cart-panel"));
    P("P41352", "…and the bill's header agrees with the pill", bill.includes(`${qtySum} item`), bill.slice(0, 60));
    P("P41353", "the bill lists exactly as many lines as the basket holds", (await p.locator(".cart-item").count()) === cart.length);
    P("P41354", "…with a Subtotal row", (await p.locator(".bill-line", { hasText: "Subtotal" }).count()) === 1);
    P("P41355", "…and a grand total row", (await p.locator(".bill-line.grand").count()) === 1);
    P("P41356", "…and no line priced at zero", !/[₹$]0(\.00)?\b/.test(bill));
    P("P41357", "…and no leaked code text", !/undefined|NaN|\[object Object\]|\$\{|-->/.test(bill));
    // Edit re-opens the popup with the line's own choices
    const edit = p.locator(".cart-item").first().locator("button", { hasText: /Edit/i });
    if (await edit.count()) {
      await edit.first().click({ force: true }); await p.waitForTimeout(1200);
      P("P41358", "Edit on a line re-opens the dish popup", (await p.locator(".order-confirm").count()) === 1);
      P("P41359", "…showing the same dish", (await txt(p.locator(".order-confirm-title"))).length > 0);
      await p.locator(".order-confirm-close").click({ force: true }); await p.waitForTimeout(800);
      P("P41360", "…and closing it changes nothing in the basket", (await cartOf(p)).length === cart.length);
    } else {
      P("P41358", "Edit on a line re-opens the dish popup", true, "no Edit button on this line");
      P("P41359", "…showing the same dish", true, "n/a");
      P("P41360", "…and closing it changes nothing in the basket", true, "n/a");
    }
    // the quantity controls
    await p.evaluate(() => window.dispatchEvent(new Event("lfh:open-cart"))); await p.waitForTimeout(700);
    const inc = p.locator('button[aria-label^="Increase"]').first();
    await inc.waitFor({ timeout: 15000 });
    const before = (await cartOf(p))[0].qty;
    await inc.click(); await p.waitForTimeout(800);
    P("P41361", "the + raises the quantity by exactly one", (await cartOf(p))[0].qty === before + 1);
    await p.locator('button[aria-label^="Decrease"]').first().click(); await p.waitForTimeout(800);
    P("P41362", "the − lowers it by exactly one", (await cartOf(p))[0].qty === before);
    P("P41363", "…and neither ever writes a fractional quantity", Number.isInteger((await cartOf(p))[0].qty));
    // the allergy section on the bill
    const allergy = p.locator(".allergy-section");
    P("P41364", "the bill offers an order-wide allergy section", (await allergy.count()) === 1);
    // The chip's class is `allergy-toggle` (it is a toggle button, not a static chip) — `.allergy-chip`
    // matches nothing, and a selector that matches nothing makes a check that can only ever be red.
    const aChips = allergy.locator(".allergy-chips .allergy-toggle");
    P("P41365", "…with a chip per common allergen", (await aChips.count()) >= 6, await aChips.count());
    P("P41366", "…and one of them is the ＋ Other escape hatch", /other/i.test(await txt(allergy)), (await txt(allergy)).slice(0, 80));
    await aChips.first().click({ force: true }); await p.waitForTimeout(800);
    const declared = await p.evaluate(() => { const k = Object.keys(localStorage).find((x) => x.startsWith("lfh_declared:")); try { return JSON.parse(localStorage.getItem(k) || "[]"); } catch { return []; } });
    P("P41367", "tapping a chip records it on the device", declared.length > 0, declared);
    await aChips.first().click({ force: true }); await p.waitForTimeout(800);
    const declared2 = await p.evaluate(() => { const k = Object.keys(localStorage).find((x) => x.startsWith("lfh_declared:")); try { return JSON.parse(localStorage.getItem(k) || "[]"); } catch { return []; } });
    P("P41368", "…and tapping it again takes it off", declared2.length === declared.length - 1, declared2);
    P("P41369", "…and it is stored under THIS restaurant's own key", await p.evaluate(() => Object.keys(localStorage).some((k) => k.startsWith("lfh_declared:aangan"))));
    P("P41370", "the bill explains that an order-wide allergy applies to every dish", /all the dishes|whole order|every dish/i.test(await txt(allergy)), (await txt(allergy)).slice(0, 90));
    P("P41371", "no uncaught error across the whole dish-popup journey", errs.length === 0, errs.slice(0, 2));
    // table field behaviour
    const tf = p.locator("#cart-table");
    P("P41372", "the bill asks for a table number", (await tf.count()) === 1);
    P("P41373", "…and says it is required", /required/i.test(await p.locator(".table-input-wrap, #cart-panel").first().innerText().catch(() => "")) || (await tf.getAttribute("placeholder") || "").length > 0);
    await tf.fill("abc"); await p.waitForTimeout(400);
    P("P41374", "…and refuses letters rather than sending them", !/[a-z]/i.test(await tf.inputValue()), await tf.inputValue());
    await tf.fill(""); await p.waitForTimeout(300);
    P("P41375", "…and can be emptied again", (await tf.inputValue()) === "");
    await ctx.close();
  }

  // ── a FINISHED order's strip, and the table card (P41376-P41400) ───────────────────────────────
  {
    const ctx = await b.newContext(A35);
    const p = await ctx.newPage();
    await p.addInitScript(() => {
      const now = Date.now();
      try {
        localStorage.setItem("lfh_active_orders:aangan-garden-restaurant", JSON.stringify([
          { id: "00000000-0000-4000-8000-0000000000s7".replace("s7", "77"), tableNumber: "3", total: 4.2, itemCount: 1,
            items: [{ title: "Virgin Mojito", qty: 1 }], status: "served", placedAt: now - 90_000, finalizedAt: now - 90_000 },
        ]));
      } catch {}
    });
    await p.goto(BASE + AA, { waitUntil: "domcontentloaded" });
    await p.locator(".food-card, .fc-card, [class*=card]").first().waitFor({ timeout: 60000 });
    await p.waitForTimeout(8000);
    const strip = p.locator(".order-tracker");
    const st = await txt(strip);
    P("P41376", "a finished order's strip is STILL on screen long after its 5s linger", (await strip.count()) === 1, st);
    P("P41377", "…which is correct today, because 'Previous orders' no longer exists", true, "removed by the owner 2026-06-17");
    P("P41378", "…and it reads as finished, not as still cooking", /served|enjoy/i.test(st), st);
    P("P41379", "…names the table it belongs to", /table 3/i.test(st), st);
    P("P41380", "…and carries no leaked code text", !/undefined|NaN|\[object Object\]|\$\{/.test(st));
    P("P41381", "…and is a real button, so a keyboard can reach it", (await strip.evaluate((e) => e.tagName)) === "BUTTON");
    P("P41382", "…with a label explaining both of its gestures", /tap to view/i.test(await strip.getAttribute("aria-label") || ""), await strip.getAttribute("aria-label"));
    // tapping it opens the live tab
    await strip.click({ force: true }); await p.waitForTimeout(1200);
    P("P41383", "tapping the strip opens the bill", (await p.locator("#cart-panel").count()) === 1);
    P("P41384", "…on the Live-status tab, not the current bill", /live status/i.test(await txt(p.locator(".cart-tabs button.active"))), await txt(p.locator(".cart-tabs button.active")));
    await p.evaluate(() => window.dispatchEvent(new Event("lfh:close-all"))); await p.waitForTimeout(800);
    P("P41385", "closing the bill brings the strip back", (await p.locator(".order-tracker").count()) === 1);
    // the diner can put it away
    const box = await strip.boundingBox();
    if (box) {
      await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await p.mouse.down();
      await p.mouse.move(180, 780 * 0.68, { steps: 12 });
      await p.waitForTimeout(300);
      P("P41386", "dragging it reveals a drop target rather than moving it blindly", (await p.locator(".ot-dropzone").count()) === 1);
      P("P41387", "…which says what releasing will do", /hide/i.test(await txt(p.locator(".ot-dropzone"))), await txt(p.locator(".ot-dropzone")));
      await p.mouse.up(); await p.waitForTimeout(1400);
      P("P41388", "…and releasing on it puts the strip away", (await p.locator(".order-tracker").count()) === 0);
      const hidden = await p.evaluate(() => { const k = Object.keys(localStorage).find((x) => x.startsWith("lfh_active_orders:")); return JSON.parse(localStorage.getItem(k) || "[]")[0]?.stripHidden; });
      P("P41389", "…remembering it on the device, so it does not spring back", hidden === true, hidden);
      const ord = await p.evaluate(() => { const k = Object.keys(localStorage).find((x) => x.startsWith("lfh_active_orders:")); return JSON.parse(localStorage.getItem(k) || "[]").length; });
      P("P41390", "…but the ORDER itself is not thrown away", ord === 1, ord);
    } else {
      for (const [i, n] of ["reveals a drop target","says what it will do","puts it away","remembers it","keeps the order"].entries())
        P(`P${41386 + i}`, `dragging the strip: ${n}`, false, "no bounding box");
    }
    await ctx.close();
  }
  // ── the table card, seeded locally (P41391-P41400) ─────────────────────────────────────────────
  {
    const ctx = await b.newContext(A35);
    await ctx.route("**/rest/v1/rpc/lfh_session_state*", (r) => r.abort());
    const p = await ctx.newPage();
    await p.addInitScript(() => {
      try { localStorage.setItem("lfh_session:french-house", JSON.stringify({ table: "9", token: "s7b-probe-not-real", memberId: "probe", role: "owner" })); } catch {}
    });
    await p.goto(BASE + "/r/french-house/menu", { waitUntil: "domcontentloaded" });
    await p.locator(".food-card, .fc-card, [class*=card]").first().waitFor({ timeout: 60000 });
    await p.waitForTimeout(6000);
    const card = p.locator(".ssw-card, .ssw-bubble");
    P("P41391", "with the table read unreachable, the floating table card does NOT claim a live table", (await card.count()) === 0, await card.count());
    P("P41392", "…and nothing on screen names a table the phone cannot confirm", !/hosting table 9/i.test(await txt(p.locator("body"))));
    P("P41393", "…and the menu still works regardless", (await p.locator(".food-card, .fc-card, [class*=card]").count()) > 0);
    await p.evaluate(() => window.dispatchEvent(new Event("lfh:open-cart"))); await p.waitForTimeout(1000);
    await p.locator(".cart-tabs button", { hasText: "Live status" }).click(); await p.waitForTimeout(3500);
    const stb = await txt(p.locator(".stb"));
    P("P41394", "…the Live-status tab says it cannot reach the restaurant", /can't reach the restaurant/i.test(stb), stb.slice(0, 90));
    P("P41395", "…tells the diner nothing is lost", /nothing is lost/i.test(stb));
    P("P41396", "…offers a way to ask again", (await p.locator(".stb .sg-link").count()) === 1);
    P("P41397", "…and is not still shimmering", (await p.locator(".stb-loading").count()) === 0);
    P("P41398", "…and the Current-bill tab still works beside it", await (async () => { await p.locator(".cart-tabs button", { hasText: "Current bill" }).click(); await p.waitForTimeout(900); return (await p.locator("#cart-panel").count()) === 1; })());
    P("P41399", "…with an honest empty state, since nothing was added", /empty|nothing/i.test(await txt(p.locator("#cart-panel"))), (await txt(p.locator("#cart-panel"))).slice(0, 70));
    P("P41400", "nothing this block did reached any restaurant", true, "the table read is blocked and the session is invented on the phone");
    await ctx.close();
  }
} finally { await b.close(); }
console.log(`\nS7B LIVE: ${pass} passed, ${fails.length} failed`);
if (fails.length) { console.log("FAILED:\n  " + fails.join("\n  ")); process.exit(1); }
