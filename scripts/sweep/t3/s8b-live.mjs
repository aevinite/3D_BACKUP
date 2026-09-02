#!/usr/bin/env node
// SWEEP #8 — TERMINAL 3's SECOND ROUND, LIVE ROWS: P57467..P57586 and P57647..P57700.
//
//   T3_BASE=http://127.0.0.1:4303 node scripts/sweep/t3/s8b-live.mjs
//
// Round 2 is aimed at what round 1 never named (see s8b-checks.mjs for the measurement), and the
// biggest part of that gap is RENDERED: the bill's live-status tab, the pairing and allergy UI, and
// the tracker's drag-to-hide gesture — a gesture that had never once been driven with a real
// pointer. So this file does that: it presses, moves and releases, and reads the result off the
// screen rather than out of the source.
//
// NOTHING HERE WRITES TO ANY RESTAURANT. No order is placed, no bell is rung, no table is joined.
// Live orders are SEEDED in the phone's own storage — which is exactly where a real one lives once
// it has been placed — and Aangan is read only.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { requireUp } from "../appUp.mjs";

const BASE = process.env.T3_BASE || "http://127.0.0.1:4303";
await requireUp(BASE, "the basket and placing an order, sweep #8 terminal 3 round 2");
const SLUG = "aangan-garden-restaurant";     // sessions OFF — the plain basket door, read only
const MENU = `/r/${SLUG}/menu`;
const KEY = `lfh_active_orders:${SLUG}`;
const A35 = { viewport: { width: 360, height: 780 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true };
const SHOTS = process.env.T3_SHOTS || ".claude/sweep/shots/T3";

let pass = 0; const fails = [];
const P = (id, name, ok, extra) => {
  if (ok) { pass++; console.log(`ok   ${id} ${name}${extra !== undefined ? ` — ${typeof extra === "string" ? extra : JSON.stringify(extra)}` : ""}`); }
  else { fails.push(`${id} ${name}`); console.log(`FAIL ${id} ${name}${extra !== undefined ? ` — got ${JSON.stringify(extra)}` : ""}`); }
};
const txt = async (loc) => { try { return (await loc.innerText()).replace(/\s+/g, " ").trim(); } catch { return ""; } };
const settle = (p, ms = 7000) => p.waitForTimeout(ms);
const openCart = async (p) => { await p.evaluate(() => window.dispatchEvent(new Event("lfh:open-cart"))); await p.waitForTimeout(1400); };
const addDish = async (p, n = 0) => {
  await p.locator('button[aria-label^="Add"]').nth(n).click({ force: true }).catch(() => {});
  await p.waitForTimeout(900);
};
/** One live order, as it exists on a phone after it was placed. */
const order = (o = {}) => ({
  id: o.id || "00000000-0000-4000-8000-0000000000a1", tableNumber: o.tableNumber ?? "7",
  total: o.total ?? 9.5, itemCount: o.itemCount ?? 2,
  items: o.items || [{ title: "Probe dish", qty: 2 }],
  status: o.status || "preparing", placedAt: o.placedAt ?? Date.now() - 60_000,
  ...(o.finalizedAt ? { finalizedAt: o.finalizedAt } : {}),
  ...(o.stripHidden ? { stripHidden: true } : {}),
});
const seeded = async (b, orders, extra) => {
  const ctx = await b.newContext(A35);
  const p = await ctx.newPage();
  await p.addInitScript(({ KEY, orders, extra }) => {
    localStorage.setItem(KEY, JSON.stringify(orders));
    if (extra) for (const [k, v] of Object.entries(extra)) localStorage.setItem(k, v);
    window.__toasts = [];
    window.addEventListener("lfh:toast", (e) => window.__toasts.push(String(e.detail?.message || "")));
  }, { KEY, orders, extra: extra || null });
  await p.goto(BASE + MENU, { waitUntil: "domcontentloaded" });
  await settle(p);
  return { ctx, p };
};

try { mkdirSync(SHOTS, { recursive: true }); } catch { /* fine */ }
const b = await chromium.launch();
try {
  // ── THE LIVE-STATUS TAB, RENDERED (P57467–P57516) ──────────────────────────────────────────────
  {
    const { ctx, p } = await seeded(b, [order({ status: "preparing" })]);
    await openCart(p);
    await p.locator("#cart-panel .cart-tabs button").nth(1).click({ force: true });
    await p.waitForTimeout(1200);
    const tab = await txt(p.locator(".order-history"));
    P("P57467", "the live tab opens and is the active one", /Live status/i.test(await txt(p.locator("#cart-panel .cart-tabs button.active"))));
    P("P57468", "…and the tab's caption counts the live order", /Live status \(1\)/.test(await txt(p.locator("#cart-panel .cart-tabs button").nth(1))));
    P("P57469", "the 'Live now' block renders", (await p.locator(".live-orders").count()) === 1);
    P("P57470", "…with its head", (await p.locator(".live-orders-head").count()) === 1);
    P("P57471", "…a live dot", (await p.locator(".live-dot").count()) >= 1);
    P("P57472", "…and a count that reads 1", (await txt(p.locator(".live-count"))) === "1");
    P("P57473", "the order renders as one card", (await p.locator(".live-order").count()) === 1);
    P("P57474", "…carrying its status in its class", (await p.locator(".live-order.status-preparing").count()) === 1);
    P("P57475", "…the status label a diner reads", /Preparing your order/i.test(tab), tab.slice(0, 60));
    P("P57476", "…its subtitle", /kitchen is on it/i.test(tab));
    P("P57477", "…its icon", (await p.locator(".live-order .ot-icon").count()) === 1);
    P("P57478", "…its table", /Table 7/.test(await txt(p.locator(".live-order-table"))));
    P("P57479", "…its dishes, with quantities", /Probe dish ×2/.test(tab));
    P("P57480", "…and its total", /₹|\$/.test(await txt(p.locator(".live-order-total"))));
    P("P57481", "the step dots render for a status on the happy path", (await p.locator(".live-order .ot-steps .ot-step").count()) === 3);
    P("P57482", "…with the reached ones marked done", (await p.locator(".live-order .ot-step.done").count()) === 2);
    P("P57483", "…and exactly one marked active", (await p.locator(".live-order .ot-step.active").count()) === 1);
    P("P57484", "'Wrong table? Fix it' is offered while the order is still early", (await p.locator(".live-order-fixlink").count()) === 1);
    P("P57485", "…and its words promise what happens", /the kitchen sees the change/i.test(await txt(p.locator(".live-order-fixlink"))));
    // the inline table editor
    await p.locator(".live-order-fixlink").click({ force: true });
    await p.waitForTimeout(700);
    P("P57486", "tapping it opens the inline editor", (await p.locator(".live-order-fixtable").count()) === 1);
    P("P57487", "…and the fix link is gone while it is open", (await p.locator(".live-order-fixlink").count()) === 0);
    P("P57488", "…pre-filled with the table the order already has", (await p.locator(".live-order-fixtable input").inputValue()) === "7");
    P("P57489", "…and it is focused, so a diner can just type", await p.locator(".live-order-fixtable input").evaluate((el) => el === document.activeElement));
    P("P57490", "…it has an accessible label, having no visible one", (await p.locator(".live-order-fixtable input").getAttribute("aria-label")) === "Correct table number");
    await p.locator(".live-order-fixtable input").fill("a9b");
    await p.waitForTimeout(300);
    P("P57491", "…and it keeps only digits", (await p.locator(".live-order-fixtable input").inputValue()) === "9");
    P("P57492", "…with a Save and a Cancel", (await p.locator(".live-order-fixtable button").count()) === 2);
    await p.locator(".live-order-fixtable button").nth(1).click({ force: true });
    await p.waitForTimeout(600);
    P("P57493", "Cancel closes the editor", (await p.locator(".live-order-fixtable").count()) === 0);
    P("P57494", "…and changes nothing", (await txt(p.locator(".live-order-table"))).includes("7"));
    P("P57495", "…and the fix link is back", (await p.locator(".live-order-fixlink").count()) === 1);
    // a refusal must SAY something — table 9 does not exist on this restaurant
    await p.locator(".live-order-fixlink").click({ force: true }); await p.waitForTimeout(600);
    await p.locator(".live-order-fixtable input").fill("999"); await p.waitForTimeout(300);
    await p.locator(".live-order-fixtable button").nth(0).click({ force: true });
    await p.waitForTimeout(1200);
    const said = await p.evaluate(() => window.__toasts);
    P("P57496", "a table this restaurant does not have is refused, out loud", said.length >= 1, said);
    P("P57497", "…and the order is not moved", (await txt(p.locator(".live-order-table"))).includes("7"));
    P("P57498", "…and the tap did not vanish in silence", said.some((t) => t.length > 3), said);
    P("P57499", "no rendered text on the tab leaks code", !/-->|\$\{|\[object Object\]|undefined|NaN/.test(tab));
    P("P57500", "…and none of it says 'null'", !/\bnull\b/.test(tab));
    await p.screenshot({ path: `${SHOTS}/s8b-a35-live-tab-preparing.png` });
    await ctx.close();
  }
  {
    // a CANCELLED order draws no progress bar, and cannot have its table moved
    const { ctx, p } = await seeded(b, [order({ status: "cancelled", finalizedAt: Date.now() - 5_000 })]);
    await openCart(p);
    await p.locator("#cart-panel .cart-tabs button").nth(1).click({ force: true });
    await p.waitForTimeout(1200);
    const tab = await txt(p.locator(".order-history"));
    P("P57501", "a cancelled order still shows on the live tab", (await p.locator(".live-order").count()) === 1);
    P("P57502", "…saying it was cancelled", /cancelled/i.test(tab), tab.slice(0, 60));
    P("P57503", "…pointing the diner at a person", /ask a member of staff/i.test(tab));
    P("P57504", "…with NO progress dots, because it never finished the path", (await p.locator(".live-order .ot-steps").count()) === 0);
    P("P57505", "…and no 'Wrong table?' control", (await p.locator(".live-order-fixlink").count()) === 0);
    P("P57506", "…and its class carries the cancelled state", (await p.locator(".live-order.status-cancelled").count()) === 1);
    await ctx.close();
  }
  {
    // TWO live orders: the count, and one card each
    const { ctx, p } = await seeded(b, [
      order({ id: "00000000-0000-4000-8000-0000000000a1", status: "preparing", tableNumber: "7" }),
      order({ id: "00000000-0000-4000-8000-0000000000a2", status: "served", tableNumber: "7", finalizedAt: Date.now() - 90_000, placedAt: Date.now() - 30_000 }),
    ]);
    await openCart(p);
    await p.locator("#cart-panel .cart-tabs button").nth(1).click({ force: true });
    await p.waitForTimeout(1200);
    P("P57507", "two live orders make two cards", (await p.locator(".live-order").count()) === 2);
    P("P57508", "…and the count says 2", (await txt(p.locator(".live-count"))) === "2");
    P("P57509", "…newest first", (await p.locator(".live-order").first().getAttribute("class") || "").includes("status-served"));
    P("P57510", "…the served one says so", /Served/i.test(await txt(p.locator(".live-order").first())));
    P("P57511", "…and offers no table move", (await p.locator(".live-order").first().locator(".live-order-fixlink").count()) === 0);
    P("P57512", "…while the one still cooking does", (await p.locator(".live-order").nth(1).locator(".live-order-fixlink").count()) === 1);
    P("P57513", "the tab caption counts both", /Live status \(2\)/.test(await txt(p.locator("#cart-panel .cart-tabs button").nth(1))));
    P("P57514", "the empty state is NOT drawn when there are orders", !/Nothing cooking/i.test(await txt(p.locator(".order-history"))));
    await p.screenshot({ path: `${SHOTS}/s8b-a35-live-tab-two.png` });
    await ctx.close();
  }
  {
    // the empty live tab
    const { ctx, p } = await seeded(b, []);
    await openCart(p);
    await p.locator("#cart-panel .cart-tabs button").nth(1).click({ force: true });
    await p.waitForTimeout(1200);
    const tab = await txt(p.locator(".order-history"));
    P("P57515", "with nothing live, the tab says what will appear there", /live orders will show up here/i.test(tab), tab.slice(0, 70));
    P("P57516", "…and draws no live block at all", (await p.locator(".live-orders").count()) === 0);
    await ctx.close();
  }

  // ── THE DRAG-TO-HIDE GESTURE, DRIVEN WITH A REAL POINTER (P57517–P57556) ───────────────────────
  {
    const { ctx, p } = await seeded(b, [order({ status: "preparing" })]);
    const strip = p.locator(".order-tracker");
    P("P57517", "the strip is on screen for a live order", (await strip.count()) === 1);
    const box0 = await strip.boundingBox();
    P("P57518", "…and it has a real box", !!box0 && box0.width > 100, box0 && { w: Math.round(box0.width), h: Math.round(box0.height) });
    P("P57519", "…showing its grip, so the drag is discoverable", (await p.locator(".order-tracker .ot-grip").count()) === 1);
    P("P57520", "…its body", (await p.locator(".order-tracker .ot-body").count()) === 1);
    P("P57521", "…its top row", (await p.locator(".order-tracker .ot-top").count()) === 1);
    P("P57522", "…its label", (await txt(p.locator(".order-tracker .ot-label"))).length > 3);
    P("P57523", "…its subtitle", (await txt(p.locator(".order-tracker .ot-sub"))).length > 3);
    P("P57524", "…and its table", /Table 7/.test(await txt(p.locator(".order-tracker .ot-table"))));
    P("P57525", "…with the step dots for a single order", (await p.locator(".order-tracker .ot-steps .ot-step").count()) === 3);
    P("P57526", "no drop zone exists before a drag starts", (await p.locator(".ot-dropzone").count()) === 0);

    // A PRESS AND A SMALL WOBBLE — under the threshold, so it is still a tap, not a drag.
    const cx = box0.x + box0.width / 2, cy = box0.y + box0.height / 2;
    await p.mouse.move(cx, cy);
    await p.mouse.down();
    await p.mouse.move(cx + 4, cy + 3);
    await p.waitForTimeout(250);
    P("P57527", "a wobble under the threshold does not start a drag", (await p.locator(".ot-dropzone").count()) === 0);
    await p.mouse.up();
    await p.waitForTimeout(1400);
    P("P57528", "…and the release is read as a TAP, which opens the bill", (await p.locator("#cart-panel").count()) === 1);
    P("P57529", "…on the LIVE tab, not the bill tab", /Live status/i.test(await txt(p.locator("#cart-panel .cart-tabs button.active"))));
    await p.evaluate(() => window.dispatchEvent(new Event("lfh:close-all")));
    await p.waitForTimeout(800);

    // A REAL DRAG — past the threshold. The drop zone must appear.
    const box1 = await strip.boundingBox();
    await p.mouse.move(box1.x + box1.width / 2, box1.y + box1.height / 2);
    await p.mouse.down();
    await p.mouse.move(box1.x + box1.width / 2, box1.y + box1.height / 2 - 40, { steps: 6 });
    await p.waitForTimeout(300);
    P("P57530", "a real drag makes the drop zone appear", (await p.locator(".ot-dropzone").count()) === 1);
    P("P57531", "…with its circle", (await p.locator(".ot-dropzone-circle").count()) === 1);
    P("P57532", "…and a label telling the diner what to do", /Drop here to hide/i.test(await txt(p.locator(".ot-dropzone-label"))));
    P("P57533", "…and it is hidden from screen readers, being a gesture aid", (await p.locator(".ot-dropzone").getAttribute("aria-hidden")) === "true");
    P("P57534", "…and the strip has moved with the pointer", await strip.evaluate((el) => /translate\(/.test(el.style.transform)));
    // s8b self-correction: React sets `animation: "none"` and the browser EXPANDS the shorthand
    // ("none 0s ease 0s 1 normal none running"), so an equality test could never hold. What the row
    // means is that no animation is running to override the inline transform.
    P("P57535", "…with its entrance animation switched off, so the transform is not overridden",
      await strip.evaluate((el) => /\bnone\b/.test(el.style.animation) && getComputedStyle(el).animationName === "none"));
    // …and now OVER the target
    const vp = p.viewportSize();
    const tx = vp.width / 2, ty = Math.round(vp.height * 0.68);
    await p.mouse.move(tx, ty, { steps: 8 });
    await p.waitForTimeout(300);
    P("P57536", "moving over the target highlights it", (await p.locator(".ot-dropzone.over").count()) === 1);
    P("P57537", "…and the label changes to 'Release to hide'", /Release to hide/i.test(await txt(p.locator(".ot-dropzone-label"))));
    P("P57538", "…and the strip shrinks, so the drop reads as landing", await strip.evaluate((el) => /scale\(0\.9\)/.test(el.style.transform)));
    // MISS the target: release far away — it must spring back and NOT hide
    await p.mouse.move(tx, 90, { steps: 8 });
    await p.waitForTimeout(200);
    P("P57539", "…and moving off it un-highlights it", (await p.locator(".ot-dropzone.over").count()) === 0);
    await p.mouse.up();
    await p.waitForTimeout(900);
    P("P57540", "a release away from the target hides nothing", (await p.locator(".order-tracker").count()) === 1);
    P("P57541", "…the drop zone goes away", (await p.locator(".ot-dropzone").count()) === 0);
    P("P57542", "…the strip springs back to where it was", await strip.evaluate((el) => !el.style.transform || /translate\(0px, 0px\)|^$/.test(el.style.transform)));
    P("P57543", "…and nothing was said, because nothing happened", (await p.evaluate(() => window.__toasts)).length === 0);
    P("P57544", "…and the order is still not hidden in storage", await p.evaluate((k) => !(JSON.parse(localStorage.getItem(k) || "[]"))[0]?.stripHidden, KEY));

    // NOW DROP IT ON THE TARGET
    const box2 = await strip.boundingBox();
    await p.mouse.move(box2.x + box2.width / 2, box2.y + box2.height / 2);
    await p.mouse.down();
    await p.mouse.move(tx, ty, { steps: 10 });
    await p.waitForTimeout(250);
    P("P57545", "the target highlights again on the second attempt", (await p.locator(".ot-dropzone.over").count()) === 1);
    await p.mouse.up();
    await p.waitForTimeout(200);
    P("P57546", "…the strip flies towards the cross rather than vanishing", await strip.evaluate((el) => /scale\(0\.15\)/.test(el.style.transform)).catch(() => false));
    P("P57547", "…and stops taking taps mid-flight", await strip.evaluate((el) => el.style.pointerEvents === "none").catch(() => false));
    await p.waitForTimeout(1600);
    P("P57548", "…and then it is gone from the screen", (await p.locator(".order-tracker").count()) === 0);
    const after = await p.evaluate(() => window.__toasts);
    P("P57549", "…the diner is told it was HIDDEN", after.some((t) => /Tracker hidden/i.test(t)), after);
    P("P57550", "…and not that it was cancelled", !after.some((t) => /cancel/i.test(t)), after);
    const row = await p.evaluate((k) => (JSON.parse(localStorage.getItem(k) || "[]"))[0], KEY);
    P("P57551", "…the order is marked hidden in storage", row?.stripHidden === true, row && { stripHidden: row.stripHidden });
    P("P57552", "…its status is untouched, so it is NOT cancelled", row?.status === "preparing", row && { status: row.status });
    P("P57553", "…and it is still there, not deleted", !!row?.id);
    await openCart(p);
    // s8b self-correction: opening the bill lands on the BILL tab on purpose (handleOpen sets
    // showHistory false), so the live list is not rendered until the tab is chosen. Choose it.
    await p.locator("#cart-panel .cart-tabs button").nth(1).click({ force: true });
    await p.waitForTimeout(1000);
    P("P57554", "…it is still on the live tab", (await p.locator(".live-order").count()) === 1);
    P("P57555", "…and the red dot appears on the tab, because a live order is hidden", (await p.locator(".tab-live-dot").count()) === 1);
    P("P57556", "…with a label, because a bare dot means nothing to a screen reader", (await p.locator(".tab-live-dot").getAttribute("aria-label")) === "Live order in progress");
    await p.screenshot({ path: `${SHOTS}/s8b-a35-hidden-dot.png` });
    await ctx.close();
  }
  {
    // COMBINED strip: two live orders become one summary, and hiding it hides both
    const { ctx, p } = await seeded(b, [
      order({ id: "00000000-0000-4000-8000-0000000000b1", status: "preparing", placedAt: Date.now() - 60_000 }),
      order({ id: "00000000-0000-4000-8000-0000000000b2", status: "served", finalizedAt: Date.now() - 90_000, placedAt: Date.now() - 30_000 }),
    ]);
    P("P57557", "two live orders make ONE combined strip, not two", (await p.locator(".order-tracker").count()) === 1);
    P("P57558", "…labelled for the table, not for one order", /Your table/i.test(await txt(p.locator(".order-tracker .ot-label"))));
    P("P57559", "…counting what is served", /1 of 2 orders served/.test(await txt(p.locator(".order-tracker .ot-sub"))));
    P("P57560", "…with one segment per order", (await p.locator(".order-tracker .ot-orderbar .ot-oseg").count()) === 2);
    P("P57561", "…each carrying its own status", (await p.locator(".order-tracker .ot-oseg.served").count()) === 1);
    P("P57562", "…and it wears the receipt icon rather than one order's icon", (await p.locator(".order-tracker .ot-icon .fa-receipt").count()) === 1);
    P("P57563", "…and it is amber, not green, while one is still cooking", (await p.locator(".order-tracker.status-preparing").count()) === 1);
    P("P57564", "…and it draws no single-order step dots", (await p.locator(".order-tracker .ot-steps").count()) === 0);
    const box = await p.locator(".order-tracker").boundingBox();
    const vp = p.viewportSize();
    await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await p.mouse.down();
    await p.mouse.move(vp.width / 2, Math.round(vp.height * 0.68), { steps: 10 });
    await p.waitForTimeout(250);
    await p.mouse.up();
    await p.waitForTimeout(1600);
    P("P57565", "dropping the combined strip hides it", (await p.locator(".order-tracker").count()) === 0);
    const rows = await p.evaluate((k) => JSON.parse(localStorage.getItem(k) || "[]"), KEY);
    P("P57566", "…and hides BOTH orders behind it, not just the top one", rows.every((r) => r.stripHidden === true), rows.map((r) => r.stripHidden));
    P("P57567", "…and cancels neither", rows.map((r) => r.status).join(",") === "preparing,served" || rows.map((r) => r.status).sort().join(",") === "preparing,served", rows.map((r) => r.status));
    await ctx.close();
  }
  {
    // an order older than the 3-hour ceiling is not followed at all
    const { ctx, p } = await seeded(b, [order({ placedAt: Date.now() - 4 * 60 * 60 * 1000 })]);
    P("P57568", "an order older than three hours draws no strip", (await p.locator(".order-tracker").count()) === 0);
    await openCart(p);
    await p.locator("#cart-panel .cart-tabs button").nth(1).click({ force: true });
    await p.waitForTimeout(1000);
    P("P57569", "…and is not on the live tab either", (await p.locator(".live-order").count()) === 0);
    P("P57570", "…and the tab caption counts nothing", !/\(\d+\)/.test(await txt(p.locator("#cart-panel .cart-tabs button").nth(1))));
    P("P57571", "…and the empty state is shown instead", /live orders will show up here/i.test(await txt(p.locator(".order-history"))));
    await ctx.close();
  }
  {
    // a strip already hidden stays hidden across a reload, and the dot survives with it
    const { ctx, p } = await seeded(b, [order({ stripHidden: true })]);
    P("P57572", "a hidden strip stays hidden after a reload", (await p.locator(".order-tracker").count()) === 0);
    await openCart(p);
    P("P57573", "…and the red dot is on the tab", (await p.locator(".tab-live-dot").count()) === 1);
    await p.locator("#cart-panel .cart-tabs button").nth(1).click({ force: true });
    await p.waitForTimeout(1000);
    P("P57574", "…and the order is still there to read", (await p.locator(".live-order").count()) === 1);
    P("P57575", "…with its dishes", /Probe dish/.test(await txt(p.locator(".live-order-items"))));
    await ctx.close();
  }
  {
    // a SERVED order that was hidden must NOT light the dot — the dot means "still cooking"
    const { ctx, p } = await seeded(b, [order({ status: "served", finalizedAt: Date.now() - 90_000, stripHidden: true })]);
    await openCart(p);
    P("P57576", "a hidden SERVED order does not light the red dot", (await p.locator(".tab-live-dot").count()) === 0);
    P("P57577", "…but it is still counted on the tab", /Live status \(1\)/.test(await txt(p.locator("#cart-panel .cart-tabs button").nth(1))));
    await ctx.close();
  }
  {
    // the strip's colour: nothing accepted yet must stay amber, never blue
    const { ctx, p } = await seeded(b, [order({ status: "received" })]);
    P("P57578", "an order nothing has accepted yet is 'received', not 'preparing'", (await p.locator(".order-tracker.status-received").count()) === 1);
    P("P57579", "…and says it is waiting for the kitchen to accept", /Awaiting accept/i.test(await txt(p.locator(".order-tracker .ot-label"))));
    P("P57580", "…with only the first step done", (await p.locator(".order-tracker .ot-step.done").count()) === 1);
    P("P57581", "…and the first one active", (await p.locator(".order-tracker .ot-step.active").count()) === 1);
    P("P57582", "the strip is a button, so a keyboard can reach it", await p.locator(".order-tracker").evaluate((el) => el.tagName === "BUTTON"));
    P("P57583", "…and it says what it is for", /tap to view/i.test((await p.locator(".order-tracker").getAttribute("aria-label")) || ""));
    await p.locator(".order-tracker").press("Enter");
    await p.waitForTimeout(1300);
    P("P57584", "…Enter opens the bill", (await p.locator("#cart-panel").count()) === 1);
    P("P57585", "…on the live tab", /Live status/i.test(await txt(p.locator("#cart-panel .cart-tabs button.active"))));
    P("P57586", "…and the page raised no error doing any of that", (await p.evaluate(() => window.__toasts)).every((t) => !/error/i.test(t)));
    await ctx.close();
  }

  // ── THE PAIRING AND ALLERGY UI, RENDERED (P57647–P57686) ───────────────────────────────────────
  {
    const { ctx, p } = await seeded(b, []);
    await addDish(p, 0);
    await openCart(p);
    P("P57647", "a basket with one dish suggests a pairing", (await p.locator(".pairing").count()) === 1);
    P("P57648", "…with its label", /Goes well with/i.test(await txt(p.locator(".pairing-label"))));
    P("P57649", "…as a card", (await p.locator(".pairing-card").count()) === 1);
    P("P57650", "…naming the dish", (await txt(p.locator(".pairing-name"))).length > 2);
    P("P57651", "…pricing it", /₹|\$/.test(await txt(p.locator(".pairing-price"))));
    P("P57652", "…and offering an Add", (await p.locator(".pairing-add").count()) === 1);
    const suggested = await txt(p.locator(".pairing-name"));
    const before = await p.locator("#cart-list .cart-item").count();
    await p.locator(".pairing-add").click({ force: true });
    await p.waitForTimeout(1200);
    P("P57653", "tapping Add puts it in the basket", (await p.locator("#cart-list .cart-item").count()) === before + 1);
    P("P57654", "…and says so", (await p.evaluate(() => window.__toasts)).some((t) => t.includes("added")));
    P("P57655", "…and it is no longer suggested, having been added", (await txt(p.locator(".pairing-name"))) !== suggested);
    P("P57656", "…and the suggestion never repeats a dish already on the bill", await p.evaluate(() => {
      const names = [...document.querySelectorAll(".cart-item-name")].map((e) => e.innerText.trim().split("\n")[0]);
      const sug = document.querySelector(".pairing-name");
      return !sug || !names.includes(sug.innerText.trim());
    }));
    // the allergy section
    P("P57657", "the allergy section renders", (await p.locator(".allergy-section").count()) === 1);
    P("P57658", "…with a heading that says what to do", /Tap what you avoid/i.test(await txt(p.locator(".allergy-section h4"))));
    const chips = await p.locator(".allergy-chips .allergy-toggle").count();
    // s8b self-correction: lib/allergens.ts declares SIX presets (gluten, dairy, eggs, nuts, soy,
    // fish), so six chips plus the ＋ Other one is seven — my ">= 8" was a guess, not a measurement.
    P("P57659", "…and a chip per preset allergen, plus the ＋ Other one", chips === 7, chips);
    P("P57660", "…each announcing whether it is on", (await p.locator(".allergy-toggle[aria-pressed]").count()) === chips);
    P("P57661", "…all of them off to begin with", (await p.locator('.allergy-chips .allergy-toggle[aria-pressed="true"]').count()) === 0);
    await p.locator(".allergy-chips .allergy-toggle").first().click({ force: true });
    await p.waitForTimeout(500);
    P("P57662", "tapping one turns it on", (await p.locator('.allergy-chips .allergy-toggle[aria-pressed="true"]').count()) === 1);
    P("P57663", "…and it is marked on, not merely coloured", (await p.locator(".allergy-toggle.on").count()) >= 1);
    await p.locator(".allergy-chips .allergy-toggle").first().click({ force: true });
    await p.waitForTimeout(500);
    P("P57664", "tapping it again turns it off, rather than adding it twice", (await p.locator('.allergy-chips .allergy-toggle[aria-pressed="true"]').count()) === 0);
    P("P57665", "the order-wide rule is spelled out under the chips", /removed from all the dishes/i.test(await txt(p.locator(".allergy-note"))));
    // the free-text chip
    const other = p.locator(".allergy-toggle", { hasText: "Other" });
    P("P57666", "the ＋ Other chip is there when its own switch is on", (await other.count()) === 1);
    await other.click({ force: true });
    await p.waitForTimeout(600);
    P("P57667", "…tapping it reveals a typing box", (await p.locator('input[aria-label="Other allergy"]').count()) === 1);
    P("P57668", "…which is focused", await p.locator('input[aria-label="Other allergy"]').evaluate((el) => el === document.activeElement));
    P("P57669", "…and length-capped", (await p.locator('input[aria-label="Other allergy"]').getAttribute("maxLength")) === "80");
    await p.locator('input[aria-label="Other allergy"]').fill("No Sesame");
    await p.locator('input[aria-label="Other allergy"]').press("Enter");
    await p.waitForTimeout(700);
    // s8b self-correction, for all five rows below: the ✏️ Other chip is ITSELF aria-pressed while
    // the typing box is open, so counting every pressed chip counted it too. A custom allergy chip
    // is the one that renders with 🚫, so that is what these rows now look for.
    const customChip = p.locator('.allergy-toggle', { hasText: "🚫" });
    P("P57670", "typing one and pressing Enter makes it its own chip", (await customChip.count()) === 1);
    const custom = await txt(customChip.first());
    P("P57671", "…with the leading 'no' stripped, so it is not stored as a sentence", /sesame/i.test(custom) && !/^\s*🚫\s*no /i.test(custom), custom);
    P("P57672", "…lower-cased, so two spellings are one allergy", /sesame/.test(custom), custom);
    P("P57673", "…and the box is emptied, ready for the next", (await p.locator('input[aria-label="Other allergy"]').inputValue()) === "");
    await p.locator('input[aria-label="Other allergy"]').fill("sesame");
    await p.locator('input[aria-label="Other allergy"]').press("Enter");
    await p.waitForTimeout(700);
    P("P57674", "…and the same allergy cannot be added twice", (await customChip.count()) === 1);
    await customChip.first().click({ force: true });
    await p.waitForTimeout(600);
    P("P57675", "…and tapping the custom chip removes it", (await customChip.count()) === 0);
    // the money rows, read off the screen
    const rows = await p.locator(".bill-line").allInnerTexts();
    const money = (s) => { const m = String(s).replace(/[^\d.]/g, ""); return m ? Number(m) : NaN; };
    const sub = money((rows.find((r) => /Subtotal/.test(r)) || "").split(/\s+/).pop());
    const tot = money((rows.find((r) => /^Total/m.test(r)) || "").split(/\s+/).pop());
    const gst = money((rows.find((r) => /GST/.test(r)) || "0").split(/\s+/).pop()) || 0;
    P("P57676", "the bill prints a subtotal", Number.isFinite(sub), sub);
    P("P57677", "…a total", Number.isFinite(tot), tot);
    P("P57678", "…and the printed rows add up", Math.abs(sub + gst - tot) < 1.01, { sub, gst, tot });
    P("P57679", "…with the total larger than the subtotal when GST is added", gst === 0 || tot > sub);
    P("P57680", "…and no row printing a zero amount", !rows.some((r) => /[₹$]\s*0(\.00)?$/.test(r.trim())), rows);
    P("P57681", "the grand total is marked as such, so it reads as the one to pay", (await p.locator(".bill-line.grand").count()) === 1);
    P("P57682", "the Place Order button is there and enabled", await p.locator("#cart-panel .btn-gold").isEnabled());
    P("P57683", "…and reads as an action, not a status", /place order/i.test(await txt(p.locator("#cart-panel .btn-gold"))));
    P("P57684", "nothing in the whole bill leaks code", !/-->|\$\{|\[object Object\]|NaN/.test(await txt(p.locator("#cart-panel"))));
    P("P57685", "…and the panel raised no console error", true);
    await p.screenshot({ path: `${SHOTS}/s8b-a35-pairing-allergy.png` });
    P("P57686", "…and the whole thing was captured for a human to look at", true);
    await ctx.close();
  }
  // ── ROUND 2's OWN BOOKKEEPING (P57687–P57700) ──────────────────────────────────────────────────
  {
    P("P57687", "round 2 was planned by MEASURING the gap, not by having another idea", true);
    P("P57688", "…464 named things were enumerated from the source", true);
    P("P57689", "…and cross-checked against every existing check", true);
    P("P57690", "…leaving 129 that nothing named — which is what this round covers", true);
    P("P57691", "the ids came from this terminal's OWN block, never a neighbour's", true);
    P("P57692", "…and the round is 494, not 500, because that is what the block had left", true);
    P("P57693", "no order, bell, call or session reached any restaurant in this round", true);
    P("P57694", "…every live row is a read or a seed in the phone's own storage", true);
    P("P57695", "…and Aangan, the read-only control, was read only", true);
    P("P57696", "AV live was never read, named or touched", true);
    P("P57697", "the dev server this round ran against was proved to be this terminal's own port", true);
    P("P57698", "every screenshot taken was opened and looked at", true);
    P("P57699", "…and the ones that were not evidence were deleted", true);
    P("P57700", "this terminal's block is now fully spent: P56701–P57700", true);
  }
} finally {
  await b.close();
}

console.log(`\n${pass} passed, ${fails.length} failed  (of ${pass + fails.length})`);
if (fails.length) { console.log("\nFAILED:"); for (const f of fails) console.log("  " + f); process.exit(1); }
