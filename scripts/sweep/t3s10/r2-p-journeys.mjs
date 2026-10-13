// Round 2 · Block P — whole JOURNEYS a diner makes through the territory's screens, on the built app:
// customising a dish (French House's Espresso has a Size and a Milk group and lists dairy), editing a
// line from the bill, the bill's extras (pairing, a typed allergy, the order-wide warning, a QR table),
// fixing a wrong table on a placed order (the database answer faked), and the saved list's "Order the
// rest" (the door's answers faked). Nothing reaches the restaurant; saved work is deleted on close.
import { chromium } from "playwright";
import { check } from "./lib.mjs";

const BASE = process.env.T3_BASE || "http://localhost:4403";
const FHS = "/r/french-house/menu";
const A35 = { viewport: { width: 360, height: 780 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true };
const HOW = `LIVE — built app on ${BASE}, French House, any database answer faked per request`;
const up = await fetch(BASE + FHS).then((r) => r.status).catch(() => 0);
const live = (fn) => async () => (up !== 200 ? `skip: nothing answered on ${BASE}` : fn());
const settle = (p, ms = 700) => p.waitForTimeout(ms);
const money = (s) => Number(String(s || "").replace(/[^0-9.]/g, "")) || 0;
const cart = (p) => p.evaluate(() => JSON.parse(localStorage.getItem("lfh_cart:french-house") || "[]"));
const toasts = async (p) => (await p.locator(".toast-ticket").allTextContents()).join(" | ").replace(/\n/g, " ");
async function withPage(fn, path = FHS) {
  const b = await chromium.launch();
  try {
    const ctx = await b.newContext(A35); const p = await ctx.newPage();
    await p.goto(BASE + path, { waitUntil: "domcontentloaded" });
    await p.locator('button[aria-label^="Add"], .fc-plus').first().waitFor({ timeout: 20000 }).catch(() => {}); await settle(p, 1200);
    try { return await fn(p, ctx); } finally { await p.evaluate(() => new Promise((r) => { const q = indexedDB.deleteDatabase("lfh_guest_outbox"); q.onsuccess = q.onerror = q.onblocked = () => r(); })).catch(() => {}); }
  } finally { await b.close(); }
}
const espresso = (p) => p.evaluate(async () => (await (await fetch("/api/r/french-house/menu-data")).json()).items.find((i) => i.title === "Espresso"));
const openPopup = (p, d) => p.evaluate((d) => window.dispatchEvent(new CustomEvent("lfh:open-order-confirm", { detail: { item: { id: d.id, title: d.title, price: String(d.price), image: d.image }, options: d.options, allergens: d.allergens } })), d);

// ── the dish popup, start to finish ────────────────────────────────────────────────────────────
const POP = {};
async function popupJourney() {
  return withPage(async (p) => {
    const d = await espresso(p); if (!d) return { none: true };
    await openPopup(p, d); await settle(p);
    const r = { title: await p.locator(".order-confirm-title").innerText(), base: money(await p.locator(".order-confirm-unit").innerText()) };
    r.sizeOn = await p.locator(".oc-choice.on").allInnerTexts();
    r.total0 = money(await p.locator(".order-confirm-total-val").innerText());
    await p.locator(".oc-choice", { hasText: "Large" }).click(); await settle(p, 300);
    r.total1 = money(await p.locator(".order-confirm-total-val").innerText());
    r.largeOn = (await p.locator(".oc-choice.on", { hasText: "Large" }).count()) === 1 && (await p.locator(".oc-choice.on", { hasText: "Small" }).count()) === 0;
    await p.locator(".oc-allergen", { hasText: /Dairy/i }).first().click(); await settle(p, 300);
    r.removedText = await p.locator(".oc-allergen", { hasText: /Dairy/i }).first().innerText();
    r.applyAll = (await p.locator(".oc-applyall").count()) === 1;
    r.note = (await p.locator(".oc-note").count()) === 1;
    await p.locator('[aria-label="Decrease quantity"]').click({ force: true }); await settle(p, 200);
    r.qtyFloor = await p.locator(".order-confirm-qty span").innerText();
    await p.locator('[aria-label="Increase quantity"]').click(); await settle(p, 200);
    r.total2 = money(await p.locator(".order-confirm-total-val").innerText());
    await p.locator(".order-confirm-add").click(); await settle(p, 700);
    r.toast = await toasts(p);
    r.line = (await cart(p))[0];
    // edit it from the bill
    await p.evaluate(() => window.dispatchEvent(new Event("lfh:open-cart"))); await settle(p, 1300);
    await p.locator(".cart-edit-btn").first().click(); await settle(p, 800);
    r.editLabel = await p.locator(".order-confirm-add").innerText().catch(() => "");
    r.editLarge = (await p.locator(".oc-choice.on", { hasText: "Large" }).count()) === 1;
    await p.locator(".oc-choice", { hasText: "Oat" }).click(); await settle(p, 300);
    await p.locator(".order-confirm-add").click(); await settle(p, 800);
    r.after = await cart(p);
    // Escape and the back button close it; Cancel changes nothing
    await openPopup(p, d); await settle(p, 500); await p.keyboard.press("Escape"); await settle(p, 400);
    r.escClosed = (await p.locator(".order-confirm").count()) === 0;
    await openPopup(p, d); await settle(p, 500); await p.goBack().catch(() => {}); await settle(p, 700);
    r.backClosed = (await p.locator(".order-confirm").count()) === 0;
    const before = JSON.stringify(await cart(p));
    await openPopup(p, d); await settle(p, 500); await p.locator(".order-confirm-cancel").click(); await settle(p, 400);
    r.cancelSame = JSON.stringify(await cart(p)) === before && (await p.locator(".order-confirm").count()) === 0;
    return r;
  });
}
const P = (id, file, what, fn) => check(id, file, what, HOW, live(async () => { POP.r ||= await popupJourney(); return POP.r.none ? "skip: French House has no Espresso with options today" : fn(POP.r); }));
const CM = "components/OrderConfirmModal.tsx";
P("P172579", CM, "popup: opens on the dish with its name and its base price", (r) => ({ ok: r.title === "Espresso" && r.base > 0, note: `${r.title} · ₹${r.base}` }));
P("P172580", CM, "popup: a single-choice group starts on its first choice (Size: Small, Milk: Regular)", (r) => ({ ok: r.sizeOn.some((x) => /Small/.test(x)) && r.sizeOn.some((x) => /Regular/.test(x)), note: r.sizeOn.join(", ") }));
P("P172581", CM, "popup: choosing Large adds exactly its ₹42 to the total", (r) => ({ ok: r.total1 - r.total0 === 42, note: `${r.total0} → ${r.total1}` }));
P("P172582", CM, "popup: a single-choice group holds ONE choice (Large on, Small off)", (r) => r.largeOn);
P("P172583", CM, "popup: tapping Dairy marks it removed, in words", (r) => ({ ok: /removed/i.test(r.removedText), note: r.removedText }));
P("P172584", CM, "popup: once something is removed, 'avoid it in all my dishes' is offered", (r) => r.applyAll);
P("P172585", CM, "popup: French House has guest notes on, so the note box is there", (r) => r.note);
P("P172586", CM, "popup: the quantity cannot go below 1", (r) => ({ ok: r.qtyFloor === "1", note: r.qtyFloor }));
P("P172587", CM, "popup: two of them doubles the total, line by line (unit × qty)", (r) => ({ ok: r.total2 === r.total1 * 2, note: `${r.total1} × 2 = ${r.total2}` }));
P("P172588", CM, "popup: Add confirms with '2 × Espresso added'", (r) => ({ ok: /2 × Espresso added/.test(r.toast), note: r.toast }));
P("P172589", CM, "popup: the saved line carries the choices, the removal and the quantity — and no price the kitchen trusts", (r) => ({ ok: r.line?.qty === 2 && r.line.options?.some((o) => o.label === "Large") && (r.line.removed || []).includes("dairy"), note: JSON.stringify(r.line).slice(0, 140) }));
P("P172590", CM, "popup: Edit from the bill re-opens it pre-filled, labelled 'Update Order'", (r) => ({ ok: /Update Order/i.test(r.editLabel) && r.editLarge, note: r.editLabel }));
P("P172591", CM, "popup: Update replaces THAT line (one line, now with Oat milk) — nothing duplicated", (r) => ({ ok: r.after.length === 1 && r.after[0].options?.some((o) => o.label === "Oat"), note: JSON.stringify(r.after.map((l) => l.options?.map((o) => o.label))) }));
P("P172592", CM, "popup: Escape closes it", (r) => r.escClosed);
P("P172593", CM, "popup: the phone's back button closes it", (r) => r.backClosed);
P("P172594", CM, "popup: Cancel closes it and changes nothing in the basket", (r) => r.cancelSame);

// ── the bill's extras ──────────────────────────────────────────────────────────────────────────
const BILL = {};
async function billJourney() {
  return withPage(async (p) => {
    const r = {};
    await p.locator('button[aria-label^="Add"], .fc-plus').first().click(); await settle(p, 800);
    await p.evaluate(() => window.dispatchEvent(new Event("lfh:open-cart"))); await settle(p, 1400);
    r.pairing = await p.locator(".pairing-name").innerText().catch(() => "");
    if (r.pairing) { await p.locator(".pairing-add").click(); await settle(p, 700); r.afterPair = (await cart(p)).map((l) => l.title); r.pairToast = await toasts(p); }
    // the dairy chip — the order-wide warning, and the red ring on a dish that holds it
    await p.locator(".allergy-toggle", { hasText: /Dairy/i }).click(); await settle(p, 400);
    r.warning = await p.locator(".allergy-warning").innerText().catch(() => "");
    r.flagDots = await p.locator(".allergen-dot.flag").count();
    // a typed allergy
    await p.locator(".allergy-toggle", { hasText: "Other" }).click(); await settle(p, 300);
    await p.locator('input[aria-label="Other allergy"]').fill("No Sesame"); await p.keyboard.press("Enter"); await settle(p, 300);
    r.customChip = await p.locator(".allergy-toggle.on", { hasText: "sesame" }).count();
    return r;
  });
}
const BL = (id, what, fn) => check(id, "components/CartPanel.tsx", what, HOW, live(async () => { BILL.r ||= await billJourney(); return fn(BILL.r); }));
BL("P172595", "bill: 'Goes well with' suggests a drink or dessert NOT already on the bill", (r) => ({ ok: !!r.pairing, note: r.pairing }));
BL("P172596", "bill: its '+ Add' puts that dish on the bill and says so", (r) => ({ ok: (r.afterPair || []).includes(r.pairing) && /added/.test(r.pairToast || ""), note: `${(r.afterPair || []).join(", ")} · ${r.pairToast}` }));
BL("P172597", "bill: ticking Dairy warns that the order contains it", (r) => ({ ok: /contains/i.test(r.warning) && /dairy/i.test(r.warning), note: r.warning }));
BL("P172598", "bill: …and rings the dairy dot red on the dish that holds it", (r) => ({ ok: r.flagDots >= 1, note: `${r.flagDots} ringed` }));
BL("P172599", "bill: a typed 'No Sesame' becomes its own removable chip, 'sesame' (the 'No' is dropped)", (r) => ({ ok: r.customChip === 1, note: `${r.customChip}` }));
check("P172600", "components/CartPanel.tsx", "bill: a QR link with ?table=12 fills the table box and says it came from the QR", HOW, live(() => withPage(async (p) => {
  await p.locator('button[aria-label^="Add"], .fc-plus').first().click(); await settle(p, 800);
  await p.evaluate(() => window.dispatchEvent(new Event("lfh:open-cart"))); await settle(p, 1300);
  const v = await p.locator("#cart-table").inputValue(); const note = await p.locator(".table-scanned-note").innerText().catch(() => "");
  return { ok: v === "12" && /from your table's QR/.test(note), note: `${v} · ${note}` };
}, FHS + "?table=12")));
// ── a wrong table on a placed order (the database's answer faked) ───────────────────────────────
async function fixTable(answer) {
  return withPage(async (p) => {
    await p.route("**/rest/v1/rpc/set_order_table_number", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(answer) }));
    await p.route("**/rest/v1/rpc/get_order_status", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([{ status: "received", table_number: "28", created_at: new Date().toISOString() }]) }));
    await p.route("**/rest/v1/rpc/get_order_dishes", (r) => r.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
    await p.evaluate(() => localStorage.setItem("lfh_active_orders:french-house", JSON.stringify([{ id: "00000000-0000-4000-8000-0000000000ee", tableNumber: "28", total: 399, itemCount: 1, items: [{ title: "Tea", qty: 1 }], status: "received", placedAt: Date.now() }])));
    await p.evaluate(() => { window.dispatchEvent(new Event("lfh:open-cart")); window.dispatchEvent(new Event("lfh:show-previous-orders")); }); await settle(p, 1300);
    await p.locator(".live-order-fixlink").click(); await settle(p, 300);
    await p.locator('input[aria-label="Correct table number"]').fill("27"); await p.locator(".live-order-fixtable button", { hasText: "Save" }).click();
    await settle(p, 900);
    const t = await toasts(p); const stored = await p.evaluate(() => JSON.parse(localStorage.getItem("lfh_active_orders:french-house"))[0].tableNumber);
    return { t, stored };
  });
}
check("P172601", "components/CartPanel.tsx", "wrong table: a correction the server accepts says 'Moved to table 27 · the kitchen has been told' and updates the card", HOW, live(async () => { const r = await fixTable([{ id: "x" }]); return { ok: /Moved to table 27/.test(r.t) && r.stored === "27", note: `${r.t} · ${r.stored}` }; }));
check("P172602", "components/CartPanel.tsx", "wrong table: one the server refuses (already served) says so, and the card keeps its table", HOW, live(async () => { const r = await fixTable([]); return { ok: /Couldn't move that order/.test(r.t) && r.stored === "28", note: `${r.t} · ${r.stored}` }; }));
// ── the saved list's "Order the rest" (the door's answers faked) ────────────────────────────────
check("P172603", "components/GuestOutboxChip.tsx", "saved list: a saved basket refused for ONE sold-out dish offers 'Order the rest', and that sends the basket WITHOUT it", HOW, live(() => withPage(async (p, ctx) => {
  const bodies = []; let k = 0;
  for (let i = 0; i < 2; i++) { await p.locator('button[aria-label^="Add"], .fc-plus').nth(i).click(); await settle(p, 600); }
  const titles = (await cart(p)).map((l) => l.title);
  // first send: refused for the FIRST dish being sold out; the rest: placed
  await p.route("**/api/guest/place-order", (r) => { const body = r.request().postDataJSON(); bodies.push(body); k++;
    return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(k === 1 ? { ok: false, reason: "sold_out", item: titles[0] } : { ok: true, order_id: "00000000-0000-4000-8000-0000000000ef" }) }); });
  await p.locator(".mini-cart").click(); await settle(p, 1100); await p.locator("#cart-table").fill("28");
  await ctx.setOffline(true); await p.locator(".cart-foot .btn-gold").click(); await settle(p, 1200);
  await p.evaluate(() => window.dispatchEvent(new Event("lfh:close-all"))); await ctx.setOffline(false);
  await p.evaluate(() => window.dispatchEvent(new Event("online"))); await settle(p, 2500);
  await p.locator(".gob-chip").click(); await settle(p, 600);
  const row = await p.locator(".gob-row-failed").innerText().catch(() => "");
  await p.locator(".gob-rest").click().catch(() => {}); await settle(p, 2500);
  const second = bodies[1]?.items?.length; const chipGone = (await p.locator(".gob-chip").count()) === 0;
  return { ok: /sold out/i.test(row) && bodies.length === 2 && bodies[0].items.length === 2 && second === 1 && chipGone, note: `row "${row.replace(/\n/g, " ").slice(0, 60)}" · sends ${bodies.map((b) => b.items.length).join("→")} · chip gone ${chipGone}` };
})));
check("P172604", "components/MiniCart.tsx", "the basket pill hides while the bill is open, and comes back when it shuts", HOW, live(() => withPage(async (p) => {
  await p.locator('button[aria-label^="Add"], .fc-plus').first().click(); await settle(p, 700);
  const a = await p.locator(".mini-cart").count(); await p.locator(".mini-cart").click(); await settle(p, 900);
  const b = await p.locator(".mini-cart").count(); await p.evaluate(() => window.dispatchEvent(new Event("lfh:close-all"))); await settle(p, 700);
  const c = await p.locator(".mini-cart").count(); return { ok: a === 1 && b === 0 && c === 1, note: `${a}/${b}/${c}` };
})));
check("P172605", "components/ChefCallButton.tsx", "keyboard: Tab reaches the bell and Enter opens 'Need something?'", HOW, live(() => withPage(async (p) => {
  await p.locator(".chef-call").focus(); await p.keyboard.press("Enter"); await settle(p, 600);
  return (await p.locator("#chef-popup").count()) === 1;
})));
check("P172606", "components/OrderTracker.tsx", "the order strip: a drag released AWAY from the cross springs back — the order is not hidden", HOW, live(() => withPage(async (p) => {
  await p.route("**/rest/v1/rpc/get_order_status", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([{ status: "received", table_number: "28", created_at: new Date().toISOString() }]) }));
  await p.evaluate(() => { localStorage.setItem("lfh_active_orders:french-house", JSON.stringify([{ id: "00000000-0000-4000-8000-0000000000ab", tableNumber: "28", total: 399, itemCount: 1, items: [], status: "received", placedAt: Date.now() }])); window.dispatchEvent(new Event("lfh:order-placed")); });
  await settle(p, 900); const bx = await p.locator(".order-tracker").boundingBox(); if (!bx) return { ok: false, note: "no strip" };
  await p.mouse.move(bx.x + bx.width / 2, bx.y + bx.height / 2); await p.mouse.down(); await p.mouse.move(60, 200, { steps: 8 }); await p.mouse.up(); await settle(p, 600);
  const still = await p.locator(".order-tracker").count(); const hidden = await p.evaluate(() => JSON.parse(localStorage.getItem("lfh_active_orders:french-house"))[0].stripHidden);
  return { ok: still === 1 && !hidden, note: `strip ${still} · hidden ${hidden}` };
})));
// ── item 24: the order strip and the fixed bell, on the widths phones really are ────────────────
async function stripVsBell(w, theme) {
  const b = await chromium.launch();
  try {
    const ctx = await b.newContext({ viewport: { width: w, height: 780 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }); const p = await ctx.newPage();
    await p.addInitScript((t) => { localStorage.setItem("lfh_theme", t); localStorage.setItem("lfh_active_orders:french-house", JSON.stringify([{ id: "00000000-0000-4000-8000-0000000000f3", tableNumber: "28", total: 399, itemCount: 1, items: [], status: "preparing", placedAt: Date.now() }])); }, theme);
    await p.route("**/rest/v1/rpc/get_order_status", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([{ status: "preparing", table_number: "28", created_at: new Date().toISOString() }]) }));
    await p.goto(BASE + FHS, { waitUntil: "domcontentloaded" }); await p.locator(".order-tracker").waitFor({ timeout: 30000 }); await settle(p, 1500);
    return await p.evaluate(() => {
      const s = document.querySelector(".order-tracker").getBoundingClientRect(), bell = document.querySelector(".chef-call").getBoundingClientRect();
      const t = document.querySelector(".ot-table").getBoundingClientRect(), g = document.querySelector(".ot-grip").getBoundingClientRect();
      const under = (r) => { const h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!h && !!h.closest(".order-tracker"); };
      return { gap: Math.round(bell.left - s.right), tableSeen: under(t), gripSeen: under(g), full: s.right <= innerWidth - 16 };
    });
  } finally { await b.close(); }
}
const SB = {};
const sbRow = (id, w, theme, what, fn) => check(id, "components/OrderTracker.tsx", `item 24 — ${w}px ${theme}: ${what}`, HOW, live(async () => { SB[w + theme] ||= await stripVsBell(w, theme); return fn(SB[w + theme]); }));
sbRow("P172607", 360, "dark", "the strip ends before the bell begins", (r) => ({ ok: r.gap >= 8, note: `${r.gap}px clear` }));
sbRow("P172608", 360, "dark", "the table number on the strip is not under the bell", (r) => r.tableSeen);
sbRow("P172609", 360, "dark", "the strip's drag handle is not under the bell", (r) => r.gripSeen);
sbRow("P172610", 390, "light", "the strip ends before the bell begins, table number and handle visible", (r) => ({ ok: r.gap >= 8 && r.tableSeen && r.gripSeen, note: `${r.gap}px clear` }));
sbRow("P172611", 412, "dark", "the strip ends before the bell begins, table number and handle visible", (r) => ({ ok: r.gap >= 8 && r.tableSeen && r.gripSeen, note: `${r.gap}px clear` }));
