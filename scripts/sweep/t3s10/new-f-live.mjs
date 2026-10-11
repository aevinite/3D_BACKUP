// Block F — DRIVEN against this terminal's own built app (T3_BASE, default http://localhost:4403,
// never 4000), the way a diner would: a phone (A35 360×780 dpr3, touch), a laptop (1280×800), an
// iPad (1194×834). French House is the one written to; ONE real QR order is placed on a free floor
// table and retired by its own id in a finally (and on a crash). Aangan is only browsed.
//
// The four doors are also asked with BAD input — malformed, missing, oversize — which every one
// refuses before any database call, so nothing here can trip a limit or ring the floor.
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { check, ROOT } from "./lib.mjs";
import { join } from "node:path";

const BASE = process.env.T3_BASE || "http://localhost:4403";
const FHS = "/r/french-house/menu", AAS = "/r/aangan-garden-restaurant/menu";
const FH = "00000000-0000-0000-0000-000000000001";
const A35 = { viewport: { width: 360, height: 780 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true };
const DESK = { viewport: { width: 1280, height: 800 } };
const IPAD = { viewport: { width: 1194, height: 834 }, hasTouch: true };
const HOW = `LIVE — built app on ${BASE}, headless Chromium`;
const env = Object.fromEntries(readFileSync(join(ROOT, ".env.local"), "utf8").split("\n").filter((l) => l.includes("=") && !l.trim().startsWith("#"))
  .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }));
async function rest(path, method = "GET", body) {
  const r = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${path}`, { method, headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json", Prefer: "return=representation" }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); return t ? JSON.parse(t) : null;
}
const up = await fetch(BASE + FHS).then((r) => r.status).catch(() => 0);
const live = (fn) => async () => (up !== 200 ? `skip: nothing answered on ${BASE}` : fn());
const R = {};          // results gathered by one drive, read by many rows
const money = (s) => Number(String(s || "").replace(/[^0-9.]/g, "")) || 0;
const settle = (p, ms = 900) => p.waitForTimeout(ms);
async function openMenu(b, ctxOpts, path = FHS, theme = "dark") {
  const ctx = await b.newContext(ctxOpts); const p = await ctx.newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(String(e.message || e)));
  await p.addInitScript((th) => { try { localStorage.setItem("lfh_theme", th); } catch {} }, theme);
  await p.goto(BASE + path, { waitUntil: "domcontentloaded" });
  await p.locator('button[aria-label^="Add"], .fc-plus').first().waitFor({ timeout: 20000 }).catch(() => {});
  await settle(p, 1500);
  return { ctx, p, errs };
}
const bodyText = (p) => p.evaluate(() => document.body.innerText);

// ── the one driven journey on French House (phone) ───────────────────────────────────────────────
let myOrder = null, myTable = null;
async function retire() {
  if (!myOrder) return;
  const now = new Date().toISOString();
  await rest(`orders?restaurant_id=eq.${FH}&id=eq.${myOrder}`, "PATCH", { status: "cancelled", archived: true, archived_at: now, cancelled_at: now }).catch(() => {});
  const jobs = (await rest(`print_jobs?restaurant_id=eq.${FH}&order_id=eq.${myOrder}&status=eq.queued&select=id&limit=20`).catch(() => [])) || [];
  for (const j of jobs) await rest(`print_jobs?restaurant_id=eq.${FH}&id=eq.${j.id}`, "PATCH", { status: "dismissed", done_at: now, error: "the order was cancelled before this ticket printed" }).catch(() => {});
  // …and the table session placing it opened (a QR order seats a party even with dining sessions off),
  // closed by its own id — but only if nothing but this one order is on it.
  const row = ((await rest(`orders?id=eq.${myOrder}&select=session_id`).catch(() => [])) || [])[0];
  if (row?.session_id) {
    const others = ((await rest(`orders?session_id=eq.${row.session_id}&id=neq.${myOrder}&select=id&limit=1`).catch(() => [])) || []).length;
    if (!others) await rest(`sessions?id=eq.${row.session_id}&restaurant_id=eq.${FH}&status=eq.open`, "PATCH", { status: "closed", closed_at: now, deleted_at: now }).catch(() => {});
    R.sessionClosed = !others;
  }
  R.retired = myOrder; myOrder = null;
}
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, async () => { await retire(); process.exit(1); });

async function journey() {
  if (R.done) return R;
  R.done = true;
  if (up !== 200) return R;
  const b = await chromium.launch();
  try {
    // a free floor table: no open session and no live order on it today
    for (const t of ["28", "27", "26", "24", "23"]) {
      const s = (await rest(`sessions?restaurant_id=eq.${FH}&table_number=eq.${t}&status=eq.open&select=id&limit=1`)) || [];
      const o = (await rest(`orders?restaurant_id=eq.${FH}&table_number=eq.${t}&archived=is.false&status=in.(received,preparing)&select=id&limit=1`)) || [];
      if (!s.length && !o.length) { myTable = t; break; }
    }
    R.table = myTable;
    const { ctx, p, errs } = await openMenu(b, A35);
    R.firstErrs = errs.slice();
    await p.locator('button[aria-label^="Add"], .fc-plus').first().click(); await settle(p, 1200);
    R.gateOpened = (await p.locator(".sg-overlay").count()) > 0;
    R.pill = await p.locator(".mini-cart").innerText().catch(() => "");
    R.pillPrice = money(await p.locator(".mini-cart-price").innerText().catch(() => ""));
    await p.locator(".mini-cart").click(); await settle(p, 1200);
    R.billOpen = (await p.locator("#cart-panel").count()) === 1;
    R.ticketHead = await p.locator(".cart-ticket-head").innerText().catch(() => "");
    const rows = await p.locator(".bill-line").allInnerTexts();
    R.rows = rows;
    const val = (re) => money((rows.find((r) => re.test(r)) || "").split(/\s/).pop());
    R.sub = val(/^Subtotal/); R.gst = val(/^GST/); R.total = val(/^Total/);
    R.lineSum = (await p.locator(".cart-item-price").allInnerTexts()).reduce((s, x) => s + money(x), 0);
    R.billText = await p.locator("#cart-panel").innerText();
    // quantities — the line reads "N×" since the ticket redesign (owner, 2026-09-20)
    const qtyText = async () => (await p.locator("#cart-list .cart-item .cart-item-qty").first().innerText().catch(() => "")).trim();
    R.q1 = await qtyText();
    await p.locator('[aria-label^="Increase"]').first().click(); await settle(p, 500);
    R.q2 = await qtyText(); R.total2 = money((await p.locator(".bill-line.grand").innerText()).split(/\s/).pop());
    await p.locator('[aria-label^="Decrease"]').first().click(); await settle(p, 500);
    R.q3 = await qtyText(); R.total3 = money((await p.locator(".bill-line.grand").innerText()).split(/\s/).pop());
    await p.evaluate(() => { const k = "lfh_cart:french-house"; const c = JSON.parse(localStorage.getItem(k) || "[]"); if (c[0]) c[0].qty = 99; localStorage.setItem(k, JSON.stringify(c)); window.dispatchEvent(new Event("lfh:cart-updated")); });
    await settle(p, 600);
    await p.locator('[aria-label^="Increase"]').first().click(); await settle(p, 500);
    R.q99 = await qtyText(); R.toast99 = await p.locator(".toast-ticket, [class*=toast]").allInnerTexts().catch(() => []);
    await p.evaluate(() => { const k = "lfh_cart:french-house"; const c = JSON.parse(localStorage.getItem(k) || "[]"); if (c[0]) c[0].qty = 1; localStorage.setItem(k, JSON.stringify(c)); window.dispatchEvent(new Event("lfh:cart-updated")); });
    await settle(p, 600);
    R.rows2 = await p.locator(".bill-line").allInnerTexts();
    R.chips = await p.locator(".allergy-toggle").count();
    const chip = p.locator(".allergy-toggle").first();
    await chip.click(); await settle(p, 300); R.chipOn = await chip.getAttribute("aria-pressed");
    await chip.click(); await settle(p, 300); R.chipOff = await chip.getAttribute("aria-pressed");
    R.tableEmpty = (await p.locator("#cart-table").inputValue()) === "";
    await p.locator(".cart-foot .btn-gold").click(); await settle(p, 700);
    R.flagged = await p.evaluate(() => { const el = document.getElementById("cart-table"); return !!el && (el.classList.contains("input-error") || el.getAttribute("aria-invalid") === "true" || /error|invalid|shake/.test(el.className)); });
    R.keptAfterNoTable = (await p.locator(".cart-item").count()) === 1;
    await p.locator("#cart-table").fill("31"); await p.locator(".cart-foot .btn-gold").click(); await settle(p, 900);
    R.toast31 = await p.locator(".toast-ticket, [class*=toast]").first().innerText().catch(() => "");
    R.keptAfter31 = (await p.locator(".cart-item").count()) === 1;
    R.overflowPhone = await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
    if (!myTable) { await ctx.close(); return R; }
    // NO SIGNAL: place it, read the saved list, come back, watch it send itself
    await p.locator("#cart-table").fill(myTable);
    await ctx.setOffline(true);
    await p.locator(".cart-foot .btn-gold").click();
    await p.locator(".toast-ticket", { hasText: /Saved|fail|didn/i }).first().waitFor({ timeout: 5000 }).catch(() => {});
    R.offToast = await p.locator(".toast-ticket").allInnerTexts().catch(() => []);
    await settle(p, 1200);
    R.basketEmptied = await p.evaluate(() => { const v = localStorage.getItem("lfh_cart:french-house"); return !v || v === "[]"; });
    await p.evaluate(() => window.dispatchEvent(new Event("lfh:close-all"))); await settle(p, 800);
    R.chip = await p.locator(".gob-chip").innerText().catch(() => "");
    await p.locator(".gob-chip").click(); await settle(p, 800);
    R.sheet = await p.locator(".gob-sheet").innerText().catch(() => "");
    R.sheetButtons = await p.locator(".gob-row:not(.gob-row-failed) button").count();
    R.idbRows = await p.evaluate(() => new Promise((res) => { const r = indexedDB.open("lfh_guest_outbox"); r.onsuccess = () => { try { const g = r.result.transaction("orders").objectStore("orders").getAll(); g.onsuccess = () => res(g.result.length); g.onerror = () => res(-1); } catch { res(-2); } }; r.onerror = () => res(-3); }));
    await p.reload({ waitUntil: "domcontentloaded" }).catch(() => {}); await settle(p, 2500);
    R.chipAfterReload = await p.locator(".gob-chip").innerText().catch(() => "");
    await ctx.setOffline(false);
    await p.evaluate(() => window.dispatchEvent(new Event("online")));
    await p.locator(".gob-chip").waitFor({ state: "detached", timeout: 30000 }).catch(() => {});
    R.chipGone = (await p.locator(".gob-chip").count()) === 0;
    const tracked = await p.evaluate(() => JSON.parse(localStorage.getItem("lfh_active_orders:french-house") || "[]"));
    myOrder = tracked[tracked.length - 1]?.id || null; R.order = myOrder; R.trackedTotal = tracked[tracked.length - 1]?.total;
    await settle(p, 1500);
    R.strip = await p.locator(".order-tracker").innerText().catch(() => "");
    if (myOrder) {
      const rows2 = (await rest(`orders?id=eq.${myOrder}&select=id,restaurant_id,table_number,status,total,session_id`)) || [];
      R.server = rows2[0] || null;
      const all = (await rest(`orders?restaurant_id=eq.${FH}&table_number=eq.${myTable}&archived=is.false&created_at=gte.${new Date(Date.now() - 10 * 60_000).toISOString()}&select=id&limit=5`)) || [];
      R.serverCount = all.length;
    }
    // tap the strip → Live status; then drag it onto the cross
    await p.locator(".order-tracker").click().catch(() => {}); await settle(p, 1200);
    R.tapOpensLive = (await p.locator(".order-history").count()) === 1;
    R.liveText = await p.locator(".order-history").innerText().catch(() => "");
    R.liveTotal = money((await p.locator(".live-order-total span").last().innerText().catch(() => "")));
    R.fixLink = await p.locator(".live-order-fixlink").count();
    await p.evaluate(() => window.dispatchEvent(new Event("lfh:close-all"))); await settle(p, 700);
    const box = await p.locator(".order-tracker").boundingBox();
    if (box) {
      await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await p.mouse.down();
      await p.mouse.move(180, 400, { steps: 8 }); await p.mouse.move(180, 780 * 0.68, { steps: 8 }); await settle(p, 200);
      R.dropzone = await p.locator(".ot-dropzone").innerText().catch(() => "");
      await p.mouse.up(); await settle(p, 900);
      R.hideToast = await p.locator(".toast-ticket, [class*=toast]").allInnerTexts().catch(() => []);
      R.stripGone = (await p.locator(".order-tracker").count()) === 0;
      R.hiddenDot = (await p.locator(".tab-live-dot, [class*=live-dot]").count());
    }
    R.errs = errs;
    await ctx.close();
  } finally { await retire(); await b.close(); }
  return R;
}
const J = (fn) => live(async () => { await journey(); return fn(R); });

check("P172460", "components/CartPanel.tsx", "French House with dining sessions OFF: tapping + adds straight to the basket (no join-a-table gate)", HOW, J((r) => ({ ok: r.gateOpened === false && r.pill.includes("1 item"), note: r.pill })));
check("P172461", "components/MiniCart.tsx", "the basket pill says '1 item', a price and 'View bill'", HOW, J((r) => ({ ok: /1 item/.test(r.pill) && /₹\d/.test(r.pill) && /View bill/.test(r.pill), note: r.pill.replace(/\n/g, " ") })));
check("P172462", "components/MiniCart.tsx", "the pill's price equals the bill's Subtotal", HOW, J((r) => ({ ok: r.pillPrice > 0 && r.pillPrice === r.sub, note: `pill ${r.pillPrice} · subtotal ${r.sub}` })));
check("P172463", "components/CartPanel.tsx", "the bill opens as the ticket, headed 'Your order'", HOW, J((r) => ({ ok: r.billOpen && /your order/i.test(r.ticketHead), note: r.ticketHead })));
check("P172464", "components/CartPanel.tsx", "the printed lines add up to the Subtotal", HOW, J((r) => ({ ok: r.lineSum === r.sub, note: `${r.lineSum} vs ${r.sub}` })));
check("P172465", "components/CartPanel.tsx", "Subtotal + GST = Total, on the screen", HOW, J((r) => ({ ok: r.sub + r.gst === r.total && r.total > 0, note: r.rows.join(" | ").replace(/\n/g, " ") })));
check("P172466", "components/CartPanel.tsx", "GST is French House's own 5%, shown as 'GST (5%)'", HOW, J((r) => ({ ok: r.rows.some((x) => /^GST \(5%\)/.test(x)), note: r.rows.find((x) => /^GST/.test(x)) || "no GST row" })));
check("P172467", "components/CartPanel.tsx", "nothing on the bill reads undefined / NaN / [object Object] / ${", HOW, J((r) => ({ ok: !/undefined|NaN|\[object Object\]|\$\{/.test(r.billText), note: `${r.billText.length} chars read` })));
check("P172468", "components/CartPanel.tsx", "on a restaurant with no QR table the table box starts empty", HOW, J((r) => r.tableEmpty));
check("P172469", "components/CartPanel.tsx", "Place Order with no table flags the box and keeps the basket", HOW, J((r) => ({ ok: r.flagged && r.keptAfterNoTable, note: `flagged ${r.flagged} · kept ${r.keptAfterNoTable}` })));
check("P172470", "components/CartPanel.tsx", "table 31 on a 30-table restaurant is refused on the phone, naming the real range, basket kept", HOW, J((r) => ({ ok: /30/.test(r.toast31) && r.keptAfter31, note: r.toast31.replace(/\n/g, " ") })));
check("P172471", "components/CartPanel.tsx", "the bill never scrolls sideways on a 360px phone", HOW, J((r) => r.overflowPhone === false));
check("P172472", "components/CartPanel.tsx", "with no signal, Place Order SAVES the order and says so (not 'failed')", HOW, J((r) => r.table ? ({ ok: r.offToast.some((t) => /Saved/i.test(t)) && !r.offToast.some((t) => /fail|didn't go/i.test(t)), note: r.offToast.join(" | ").replace(/\n/g, " ") }) : "skip: no free floor table on French House to place one order on"));
check("P172473", "components/CartPanel.tsx", "…and empties the basket so it cannot be sent twice", HOW, J((r) => (r.table ? r.basketEmptied : "skip: no free table")));
check("P172474", "components/GuestOutboxChip.tsx", "a chip appears: '1 order waiting to send'", HOW, J((r) => (r.table ? ({ ok: /1 order waiting to send/.test(r.chip), note: r.chip }) : "skip: no free table")));
check("P172475", "components/GuestOutboxChip.tsx", "its list names the dish, 'Waiting to send', and the SAME total the bill showed (item 2)", HOW, J((r) => {
  if (!r.table) return "skip: no free table";
  const t = money((r.sheet.match(/₹[\d,]+/) || [""])[0]);
  return { ok: /Waiting to send/.test(r.sheet) && t === r.total, note: `list ₹${t} · bill ₹${r.total}` };
}));
check("P172476", "components/GuestOutboxChip.tsx", "a waiting ORDER has no buttons in the list (no cancel of something the kitchen may have)", HOW, J((r) => (r.table ? ({ ok: r.sheetButtons === 0, note: `${r.sheetButtons} button(s)` }) : "skip: no free table")));
check("P172477", "lib/guestOutbox.ts", "the saved order really is in the phone's storage", HOW, J((r) => (r.table ? ({ ok: r.idbRows === 1, note: `${r.idbRows} row(s)` }) : "skip: no free table")));
check("P172478", "lib/guestOutbox.ts", "…and survives a reload with no signal", HOW, J((r) => (r.table ? ({ ok: /1 order waiting to send/.test(r.chipAfterReload), note: r.chipAfterReload }) : "skip: no free table")));
check("P172479", "lib/guestOutbox.ts", "the signal coming back sends it by itself — the chip goes", HOW, J((r) => (r.table ? r.chipGone : "skip: no free table")));
check("P172480", "app/api/guest/place-order/route.ts", "the order reached French House's kitchen, on the diner's table, as 'received'", "LIVE + DB — one read-only row by its own id", J((r) => (r.table ? ({ ok: !!r.server && r.server.restaurant_id === FH && String(r.server.table_number) === r.table && r.server.status === "received", note: JSON.stringify(r.server) }) : "skip: no free table")));
check("P172481", "app/api/guest/place-order/route.ts", "…exactly ONE order, not two (the replay was at-most-once)", "LIVE + DB — scoped, limited read", J((r) => (r.table ? ({ ok: r.serverCount === 1, note: `${r.serverCount} order(s) on table ${r.table} in the last 10 min` }) : "skip: no free table")));
check("P172482", "components/CartPanel.tsx", "the total the phone stored is the server's total for that order (item 4)", "LIVE + DB", J((r) => (r.table && r.server ? ({ ok: Math.abs(Number(r.server.total) - Number(r.trackedTotal)) < 0.001, note: `stored ${r.trackedTotal} · server ${r.server.total}` }) : "skip: no order to compare")));
check("P172483", "components/OrderTracker.tsx", "the live strip appears, reading 'Awaiting accept' with the table", HOW, J((r) => (r.table ? ({ ok: /Awaiting accept/.test(r.strip) && r.strip.includes(r.table), note: r.strip.replace(/\n/g, " ") }) : "skip: no free table")));
check("P172484", "components/OrderTracker.tsx", "tapping the strip opens the bill's Live-status tab", HOW, J((r) => (r.table ? r.tapOpensLive : "skip: no free table")));
check("P172485", "components/CartPanel.tsx", "the Live-status card shows the order with the same Total as the bill", HOW, J((r) => (r.table ? ({ ok: r.liveTotal === r.total, note: `card ₹${r.liveTotal} · bill ₹${r.total}` }) : "skip: no free table")));
check("P172486", "components/CartPanel.tsx", "…and, still early, offers 'Wrong table? Fix it'", HOW, J((r) => (r.table ? ({ ok: r.fixLink === 1, note: `${r.fixLink}` }) : "skip: no free table")));
check("P172487", "components/OrderTracker.tsx", "dragging the strip shows the drop target", HOW, J((r) => (r.table ? ({ ok: /Drop here to hide|Release to hide/.test(r.dropzone), note: r.dropzone }) : "skip: no free table")));
check("P172488", "components/OrderTracker.tsx", "dropping it hides it and says it is 'still in Live status' (item 3)", HOW, J((r) => (r.table ? ({ ok: r.hideToast.some((t) => /Tracker hidden/i.test(t) && /Live status/i.test(t)) && r.stripGone, note: r.hideToast.join(" | ").replace(/\n/g, " ") }) : "skip: no free table")));
check("P172489", "components/CartPanel.tsx", "no page error on the whole journey", HOW, J((r) => ({ ok: (r.errs || r.firstErrs || []).length === 0, note: (r.errs || []).join(" | ").slice(0, 160) })));
check("P172490", "app/api/guest/place-order/route.ts", "the order this block placed — and the table session it opened — were retired by their own ids afterwards", "LIVE + DB", J((r) => (r.table ? ({ ok: !!r.retired && r.sessionClosed === true, note: `retired ${r.retired} · session closed ${r.sessionClosed}` }) : "skip: no order placed")));

// ── the bell, on a phone (French House, sessions OFF) ───────────────────────────────────────────
const BELL = {};
async function bell() {
  if (BELL.done) return BELL; BELL.done = true; if (up !== 200) return BELL;
  const b = await chromium.launch();
  try {
    const { ctx, p } = await openMenu(b, A35);
    BELL.bellBox = await p.locator(".chef-call").boundingBox();
    BELL.bellTag = await p.locator(".chef-call").evaluate((e) => e.tagName + "|" + (e.getAttribute("aria-label") || ""));
    // The bell FLOATS on purpose (R29 — the owner's 12px idle float), so it is never "stable" and the
    // robot will not click it. A finger can: what matters is that the bell is the thing under the
    // finger, so assert that, then tap it at its centre.
    BELL.hit = await p.evaluate(() => { const el = document.querySelector(".chef-call"); const r = el.getBoundingClientRect(); const h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!h && (h === el || el.contains(h)); });
    await p.locator(".chef-call").click({ force: true }); await settle(p, 700);
    BELL.open = (await p.locator("#chef-popup").count()) === 1;
    BELL.reasons = await p.locator(".chef-reason").allInnerTexts();
    BELL.popupText = await p.locator("#chef-popup").innerText().catch(() => "");
    await p.keyboard.press("Escape"); await settle(p, 500);
    BELL.escClosed = (await p.locator("#chef-popup").count()) === 0;
    await p.locator(".chef-call").click({ force: true }); await settle(p, 600);
    await p.goBack().catch(() => {}); await settle(p, 700);
    BELL.backClosed = (await p.locator("#chef-popup").count()) === 0;
    BELL.stillOnMenu = /\/r\/french-house\/menu/.test(p.url());
    await p.locator(".chef-call").click({ force: true }); await settle(p, 600);
    await p.locator(".chef-reason").first().click(); await settle(p, 600);
    BELL.noTableFlag = (await p.locator("#chef-popup").count()) === 1;
    await p.locator("#chef-table").fill("7"); await settle(p, 300);
    BELL.clearBtn = (await p.locator(".table-input-clear").count()) === 1;
    await p.locator(".table-input-clear").click(); await settle(p, 300);
    BELL.cleared = (await p.locator("#chef-table").inputValue()) === "";
    BELL.scannedAfterClear = await p.evaluate(() => Object.keys(localStorage).filter((k) => /lfh_table/.test(k)).map((k) => localStorage.getItem(k)).join(","));
    // no signal → a SAVED call, then take it back with "Not needed"
    await p.locator("#chef-table").fill("7");
    await ctx.setOffline(true);
    await p.locator(".chef-reason", { hasText: "Water" }).click();
    await p.locator(".toast-ticket", { hasText: /Saved|Couldn/i }).first().waitFor({ timeout: 5000 }).catch(() => {});
    BELL.offToast = await p.locator(".toast-ticket").allInnerTexts().catch(() => []);
    await settle(p, 600);
    await p.evaluate(() => window.dispatchEvent(new Event("lfh:close-all"))); await settle(p, 600);
    BELL.chip = await p.locator(".gob-chip").innerText().catch(() => "");
    await p.locator(".gob-chip").click(); await settle(p, 600);
    BELL.sheet = await p.locator(".gob-sheet").innerText().catch(() => "");
    await p.locator(".gob-sheet button", { hasText: "Not needed" }).click().catch(() => {}); await settle(p, 900);
    BELL.notNeededToast = await p.locator(".toast-ticket, [class*=toast]").allInnerTexts().catch(() => []);
    BELL.chipGone = (await p.locator(".gob-chip").count()) === 0;
    await ctx.setOffline(false); await settle(p, 1500);
    await ctx.close();
  } finally { await b.close(); }
  return BELL;
}
const B = (fn) => live(async () => { await bell(); return fn(BELL); });
check("P172491", "components/ChefCallButton.tsx", "the bell is a real button named 'Call a waiter', and it is what is under a finger at its centre", HOW, B((r) => ({ ok: r.bellTag === "BUTTON|Call a waiter" && r.hit === true, note: `${r.bellTag} · on top: ${r.hit}` })));
check("P172492", "components/ChefCallButton.tsx", "the bell sits fully on screen in the bottom-right corner of a 360px phone, at least 44px", HOW, B((r) => { const x = r.bellBox; return { ok: !!x && x.x + x.width <= 360 && x.y + x.height <= 780 && x.x > 180 && x.width >= 44 && x.height >= 44, note: JSON.stringify(x && { x: Math.round(x.x), y: Math.round(x.y), w: Math.round(x.width), h: Math.round(x.height) }) }; }));
check("P172493", "components/ChefPopup.tsx", "tapping it opens 'Need something?' with the six requests", HOW, B((r) => ({ ok: r.open && /Need something\?/.test(r.popupText) && r.reasons.length === 6, note: r.reasons.map((x) => x.replace(/\s+/g, " ").trim()).join(" · ") })));
check("P172494", "components/ChefPopup.tsx", "Escape closes it", HOW, B((r) => r.escClosed));
check("P172495", "components/ChefPopup.tsx", "the phone's back button closes it and stays on the menu", HOW, B((r) => ({ ok: r.backClosed && r.stillOnMenu, note: `closed ${r.backClosed} · on menu ${r.stillOnMenu}` })));
check("P172496", "components/ChefPopup.tsx", "a request with no table keeps the popup open (the box is flagged, nothing sent)", HOW, B((r) => r.noTableFlag));
check("P172497", "components/ChefPopup.tsx", "the ✕ clears the box AND the remembered table", HOW, B((r) => ({ ok: r.clearBtn && r.cleared && !/\b7\b/.test(r.scannedAfterClear), note: `remembered now: "${r.scannedAfterClear}"` })));
check("P172498", "components/ChefPopup.tsx", "with no signal a request is SAVED and the diner is told it will be sent", HOW, B((r) => ({ ok: r.offToast.some((t) => /Saved/i.test(t) && /Water/i.test(t)), note: r.offToast.join(" | ").replace(/\n/g, " ") })));
check("P172499", "components/GuestOutboxChip.tsx", "…the chip reads '1 request for staff', never '0 items'", HOW, B((r) => ({ ok: /1 request for staff/.test(r.chip) && !/0 items/.test(r.sheet), note: r.chip })));
check("P172500", "components/GuestOutboxChip.tsx", "…its row names 'Water' and 'Staff will be called'", HOW, B((r) => ({ ok: /Water/.test(r.sheet) && /Staff will be called/.test(r.sheet), note: r.sheet.replace(/\n/g, " ").slice(0, 120) })));
check("P172501", "components/GuestOutboxChip.tsx", "'Not needed' takes the call back, says so, and the chip goes", HOW, B((r) => ({ ok: r.notNeededToast.some((t) => /won't call/i.test(t)) && r.chipGone, note: r.notNeededToast.join(" | ").replace(/\n/g, " ") })));

// ── the four doors asked with bad input (nothing reaches the database) ───────────────────────────
async function door(path, body, raw) {
  if (up !== 200) return null;
  const r = await fetch(BASE + path, { method: "POST", headers: { "content-type": "application/json" }, body: raw !== undefined ? raw : JSON.stringify(body) });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: r.status, json, text };
}
const D = (path, body, want, raw) => live(async () => { const r = await door(path, body, raw); return { ok: r.status === want.status && (!want.reason || r.json?.reason === want.reason), note: `${r.status} ${r.text.slice(0, 90)}` }; });
const many = (n) => Array.from({ length: n }, () => ({ id: "x", qty: 1 }));
check("P172502", "app/api/guest/place-order/route.ts", "malformed JSON bytes answer 400 bad_body, not 500", "LIVE — POST on :4403", D("/api/guest/place-order", null, { status: 400, reason: "bad_body" }, "{oops"));
check("P172503", "app/api/guest/place-order/route.ts", "a seated order with no token answers 400 invalid_token", "LIVE — POST on :4403", D("/api/guest/place-order", { mode: "session", items: [] }, { status: 400, reason: "invalid_token" }));
check("P172504", "app/api/guest/place-order/route.ts", "a QR order with no restaurant answers 400 unknown_restaurant", "LIVE — POST on :4403", D("/api/guest/place-order", { mode: "public", table: "4", items: [] }, { status: 400, reason: "unknown_restaurant" }));
check("P172505", "app/api/guest/place-order/route.ts", "201 lines answer 400 order_too_big", "LIVE — POST on :4403", D("/api/guest/place-order", { mode: "public", restaurantId: FH, table: "4", items: many(201) }, { status: 400, reason: "order_too_big" }));
check("P172506", "app/api/guest/place-order/route.ts", "41 allergies answer 400 allergies_too_long", "LIVE — POST on :4403", D("/api/guest/place-order", { mode: "public", restaurantId: FH, table: "4", items: [], allergies: Array.from({ length: 41 }, (_, i) => "a" + i) }, { status: 400, reason: "allergies_too_long" }));
check("P172507", "app/api/guest/call-waiter/route.ts", "malformed JSON answers 400 bad_body", "LIVE — POST on :4403", D("/api/guest/call-waiter", null, { status: 400, reason: "bad_body" }, "]"));
check("P172508", "app/api/guest/call-waiter/route.ts", "an unreadable 'at' answers call_too_old (200), ringing nothing", "LIVE — POST on :4403", D("/api/guest/call-waiter", { mode: "public", restaurantId: FH, table: "4", at: "abc" }, { status: 200, reason: "call_too_old" }));
check("P172509", "app/api/guest/call-waiter/route.ts", "a call stamped an hour ago answers call_too_old", "LIVE — POST on :4403", D("/api/guest/call-waiter", { mode: "public", restaurantId: FH, table: "4", at: Date.now() - 3_600_000 }, { status: 200, reason: "call_too_old" }));
check("P172510", "app/api/guest/call-waiter/route.ts", "a seated call with no token answers 400 invalid_token", "LIVE — POST on :4403", D("/api/guest/call-waiter", { mode: "session" }, { status: 400, reason: "invalid_token" }));
check("P172511", "app/api/guest/call-waiter/route.ts", "a QR call with no restaurant answers 400 unknown_restaurant", "LIVE — POST on :4403", D("/api/guest/call-waiter", { mode: "public", table: "4" }, { status: 400, reason: "unknown_restaurant" }));
check("P172512", "app/api/guest/leave/route.ts", "malformed JSON answers 400 bad_body", "LIVE — POST on :4403", D("/api/guest/leave", null, { status: 400, reason: "bad_body" }, "{"));
check("P172513", "app/api/guest/leave/route.ts", "no token answers 400 invalid_token", "LIVE — POST on :4403", D("/api/guest/leave", {}, { status: 400, reason: "invalid_token" }));
check("P172514", "app/api/guest/limit-hit/route.ts", "an empty body answers 200 ok", "LIVE — POST on :4403", D("/api/guest/limit-hit", null, { status: 200 }, ""));
check("P172515", "app/api/guest/limit-hit/route.ts", "an unknown function answers 200 ok (and pings nobody)", "LIVE — POST on :4403", D("/api/guest/limit-hit", { fn: "nope" }, { status: 200 }));
check("P172516", "app/api/guest/place-order/route.ts", "a GET on the order door is not a way in (405, no page, no data)", "LIVE — GET on :4403", live(async () => { const r = await fetch(BASE + "/api/guest/place-order"); return { ok: r.status === 405, note: String(r.status) }; }));
check("P172517", "app/api/guest/place-order/route.ts", "no door's refusal carries a database word (relation / column / permission / pgrst)", "LIVE — the replies above", live(async () => {
  const rs = await Promise.all([door("/api/guest/place-order", null, "{"), door("/api/guest/call-waiter", { mode: "public", table: "4" }), door("/api/guest/leave", {})]);
  return { ok: rs.every((r) => !/relation|column|permission|pgrst|supabase|postgres/i.test(r.text)), note: rs.map((r) => r.status).join(",") };
}));

// ── the same bill on a laptop and an iPad, and Aangan's own name ─────────────────────────────────
async function lookAt(dev, path, theme = "dark") {
  if (up !== 200) return null;
  const b = await chromium.launch();
  try {
    const { ctx, p, errs } = await openMenu(b, dev, path, theme);
    await p.locator('button[aria-label^="Add"], .fc-plus').first().click(); await settle(p, 1000);
    await p.evaluate(() => window.dispatchEvent(new Event("lfh:open-cart"))); await settle(p, 1400);
    const box = await p.locator("#cart-panel").boundingBox();
    const btn = await p.locator(".cart-foot .btn-gold").boundingBox();
    const text = await p.locator("#cart-panel").innerText();
    const over = await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
    const vh = dev.viewport.height;
    const page = await bodyText(p);
    await ctx.close();
    return { box, btn, text, over, vh, errs, page };
  } finally { await b.close(); }
}
const LOOK = {};
const L = (key, dev, path, theme, fn) => live(async () => { LOOK[key] ||= await lookAt(dev, path, theme); return fn(LOOK[key]); });
check("P172518", "components/CartPanel.tsx", "on a 1280×800 laptop the bill is a centred card, not a full-width sheet", HOW, L("desk", DESK, FHS, "dark", (r) => ({ ok: r.box.width <= 520 && r.box.x > 300, note: `x ${Math.round(r.box.x)} w ${Math.round(r.box.width)}` })));
check("P172519", "components/CartPanel.tsx", "…and Place Order is visible without scrolling (the sticky foot, owner item 2)", HOW, L("desk", DESK, FHS, "dark", (r) => ({ ok: !!r.btn && r.btn.y + r.btn.height <= r.vh, note: JSON.stringify(r.btn && { y: Math.round(r.btn.y) }) })));
check("P172520", "components/CartPanel.tsx", "on a 1194×834 iPad the bill fits and nothing scrolls sideways", HOW, L("ipad", IPAD, FHS, "dark", (r) => ({ ok: !r.over && r.box.x >= 0 && r.box.x + r.box.width <= 1194, note: `w ${Math.round(r.box.width)}` })));
check("P172521", "components/CartPanel.tsx", "the LIGHT skin bill renders every row, with no broken text", HOW, L("light", A35, FHS, "light", (r) => ({ ok: /Subtotal/.test(r.text) && /Total/.test(r.text) && !/undefined|NaN|\[object/.test(r.text), note: `${r.text.length} chars` })));
check("P172522", "components/CartPanel.tsx", "Aangan's bill carries no French House name anywhere (each restaurant is its own)", HOW, L("aangan", A35, AAS, "dark", (r) => ({ ok: !/french house/i.test(r.page), note: "page text scanned" })));
check("P172523", "components/CartPanel.tsx", "Aangan's bill shows a GST row and a Total for its own basket", HOW, L("aangan", A35, AAS, "dark", (r) => ({ ok: /Total/.test(r.text) && /Subtotal/.test(r.text), note: r.text.split("\n").filter((l) => /Subtotal|GST|Total/.test(l)).join(" · ") })));
check("P172524", "components/CartPanel.tsx", "no page error while opening the bill on a laptop, an iPad or in light skin", HOW, live(async () => {
  for (const [k, d, pth, th] of [["desk", DESK, FHS, "dark"], ["ipad", IPAD, FHS, "dark"], ["light", A35, FHS, "light"]]) LOOK[k] ||= await lookAt(d, pth, th);
  const e = ["desk", "ipad", "light"].flatMap((k) => LOOK[k].errs); return { ok: e.length === 0, note: e.join(" | ").slice(0, 160) };
}));

// ── the star row on a dish page (the widget only; nothing is submitted) ──────────────────────────
const STAR = {};
async function stars() {
  if (STAR.done) return STAR; STAR.done = true; if (up !== 200) return STAR;
  const b = await chromium.launch();
  try {
    for (const [rest_, path] of [["fh", FHS], ["aa", AAS]]) {
      const ctx = await b.newContext(A35); const p = await ctx.newPage();
      await p.goto(BASE + path, { waitUntil: "domcontentloaded" }); await settle(p, 3000);
      const href = await p.locator('a[href*="/item/"]').first().getAttribute("href").catch(() => null);
      if (href) { await p.goto(BASE + href, { waitUntil: "domcontentloaded" }); await settle(p, 3500); }
      STAR[rest_] = { href, count: await p.locator(".sr-toggle").count() };
      if (STAR[rest_].count) {
        const t = p.locator(".sr-toggle").nth(3); await t.scrollIntoViewIfNeeded(); await t.focus(); await p.keyboard.press("Enter"); await settle(p, 2200);
        STAR[rest_].pill = await p.locator(".sr-score-num").innerText().catch(() => "");
        STAR[rest_].active = await p.locator(".sr-li.active").count();
        STAR[rest_].box = await p.locator(".sr-toggle").first().boundingBox();
        STAR[rest_].rowW = await p.locator(".sr-rating").evaluate((e) => ({ w: e.scrollWidth, cw: e.clientWidth, top: [...e.children].map((c) => Math.round(c.getBoundingClientRect().top)) }));
        STAR[rest_].labels = await p.locator(".sr-toggle").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
      }
      await ctx.close();
    }
  } finally { await b.close(); }
  return STAR;
}
const ST = (fn) => live(async () => { await stars(); return fn(STAR); });
check("P172525", "components/StarRating.tsx", "the star row appears on a restaurant with ratings ON, or is absent with ratings OFF — never half-drawn", HOW, ST((s) => ({ ok: [s.fh, s.aa].every((x) => x && (x.count === 0 || x.count === 5)), note: `French House ${s.fh?.count} · Aangan ${s.aa?.count}` })));
const anyStars = (s) => (s.fh?.count === 5 ? s.fh : s.aa?.count === 5 ? s.aa : null);
check("P172526", "components/StarRating.tsx", "keyboard Enter on the 4th star sets the rating to 4 and lights four stars", HOW, ST((s) => { const x = anyStars(s); return x ? { ok: x.pill === "4" && x.active === 4, note: `pill ${x.pill} · lit ${x.active}` } : "skip: neither restaurant has ratings switched on today"; }));
check("P172527", "components/StarRating.tsx", "each star names the rating it sets ('Rate 1 star' … 'Rate 5 stars')", HOW, ST((s) => { const x = anyStars(s); return x ? { ok: x.labels.join("|") === "Rate 1 star|Rate 2 stars|Rate 3 stars|Rate 4 stars|Rate 5 stars", note: x.labels.join(", ") } : "skip: neither restaurant has ratings switched on today"; }));
check("P172528", "components/StarRating.tsx", "five stars sit on ONE row on a 360px phone", HOW, ST((s) => { const x = anyStars(s); return x ? { ok: new Set(x.rowW.top).size === 1 && x.rowW.w <= x.rowW.cw + 1, note: JSON.stringify(x.rowW) } : "skip: neither restaurant has ratings switched on today"; }));
check("P172529", "components/StarRating.tsx", "a star is at least 32px to tap", HOW, ST((s) => { const x = anyStars(s); return x ? { ok: x.box.width >= 32 && x.box.height >= 32, note: `${Math.round(x.box.width)}×${Math.round(x.box.height)}` } : "skip: neither restaurant has ratings switched on today"; }));

check("P172530", "components/CartPanel.tsx", "'+' on a bill line raises it from 1× to 2× and the Total follows", HOW, J((r) => ({ ok: r.q1 === "1×" && r.q2 === "2×" && r.total2 > r.total, note: `${r.q1} → ${r.q2} · ₹${r.total} → ₹${r.total2}` })));
check("P172531", "components/CartPanel.tsx", "'−' lowers it back to 1× and the Total returns", HOW, J((r) => ({ ok: r.q3 === "1×" && r.total3 === r.total, note: `${r.q3} · ₹${r.total3}` })));
check("P172532", "components/CartPanel.tsx", "'+' at 99 stays at 99 and SAYS 'Maximum 99 per dish'", HOW, J((r) => ({ ok: r.q99 === "99×" && r.toast99.some((t) => /Maximum 99/i.test(t)), note: `${r.q99} · ${r.toast99.join(" | ").replace(/\n/g, " ").slice(0, 80)}` })));
check("P172533", "components/CartPanel.tsx", "the allergy chips are offered (French House has allergies on)", HOW, J((r) => ({ ok: r.chips >= 6, note: `${r.chips} chips` })));
check("P172534", "components/CartPanel.tsx", "tapping a chip turns it on for a screen reader too (aria-pressed true), and again turns it off", HOW, J((r) => ({ ok: r.chipOn === "true" && r.chipOff === "false", note: `${r.chipOn} → ${r.chipOff}` })));
