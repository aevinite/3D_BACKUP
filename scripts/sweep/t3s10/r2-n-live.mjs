// Round 2 · Block N — DRIVEN on this terminal's built app (T3_BASE, default :4403), with the database's
// answer FAKED for one request at a time (Playwright `page.route` — the repo's tool for "a failing
// server per request"). So every refusal, every busy moment and every limit is shown to the screen
// WITHOUT one real order placed, one real call rung or one real limit tripped. French House is the
// restaurant on screen (dining sessions OFF, its factory default); anything saved on the phone is
// deleted before the page closes.
import { chromium } from "playwright";
import { check } from "./lib.mjs";

const BASE = process.env.T3_BASE || "http://localhost:4403";
const FHS = "/r/french-house/menu", FH = "00000000-0000-0000-0000-000000000001";
const A35 = { viewport: { width: 360, height: 780 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true };
const HOW = `LIVE — built app on ${BASE}, the database's answer faked per request (no row written)`;
const up = await fetch(BASE + FHS).then((r) => r.status).catch(() => 0);
const live = (fn) => async () => (up !== 200 ? `skip: nothing answered on ${BASE}` : fn());
let browser = null;
const B = async () => (browser ||= await chromium.launch());
process.on("beforeExit", async () => { if (browser) { const b = browser; browser = null; await b.close(); } });
const settle = (p, ms = 800) => p.waitForTimeout(ms);
async function page(init, arg) {
  const ctx = await (await B()).newContext(A35); const p = await ctx.newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(String(e.message || e)));
  // Every toast is RECORDED the moment it fires, so a check never depends on catching it before it fades.
  await p.addInitScript(() => { window.__toasts = []; window.addEventListener("lfh:toast", (e) => { const d = e.detail || {}; window.__toasts.push(`${d.message || ""} ${d.subtitle || ""}`.trim()); }); });
  if (init) await p.addInitScript(init, arg);
  return { ctx, p, errs };
}
const fired = (p) => p.evaluate(() => (window.__toasts || []).join(" | "));
async function openMenu(p) { await p.goto(BASE + FHS, { waitUntil: "domcontentloaded" }); await p.locator('button[aria-label^="Add"], .fc-plus').first().waitFor({ timeout: 20000 }).catch(() => {}); await settle(p, 1200); }
const toast = async (p, re) => { await p.locator(".toast-ticket", { hasText: re }).first().waitFor({ timeout: 5000 }).catch(() => {}); return (await p.locator(".toast-ticket").allTextContents()).join(" | ").replace(/\n/g, " "); };
const wipePhone = (p) => p.evaluate(() => new Promise((r) => { const q = indexedDB.deleteDatabase("lfh_guest_outbox"); q.onsuccess = q.onerror = q.onblocked = () => r(); })).catch(() => {});
const rpc = (name) => `**/rest/v1/rpc/${name}`;

// ── N1. the QR bell, every answer the database can give (items 1, 10, 17, 21) ───────────────────
async function ring(answer, { beacon } = {}) {
  const { ctx, p, errs } = await page(); const seen = { limit: null, rpc: 0 };
  try {
    await p.route(rpc("lfh_call_waiter_table"), (r) => { seen.rpc++; return typeof answer === "function" ? answer(r) : r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(answer) }); });
    await p.route("**/api/guest/limit-hit", (r) => { seen.limit = r.request().postDataJSON(); return r.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' }); });
    await p.route("**/api/guest/call-waiter", (r) => r.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' }));   // a saved call's replay, if one goes
    await openMenu(p);
    await p.locator(".chef-call").click({ force: true });
    await p.locator("#chef-popup").waitFor({ timeout: 10000 });
    await p.locator("#chef-table").fill("7");
    await p.locator(".chef-reason", { hasText: "Water" }).click({ timeout: 15000 });
    const t = await toast(p, /./); await settle(p, 900);
    const chip = await p.locator(".gob-chip").innerText().catch(() => "");
    const popupOpen = (await p.locator("#chef-popup").count()) === 1;
    if (beacon) await settle(p, 500);
    return { t, chip, popupOpen, seen, errs };
  } finally { await wipePhone(p); await ctx.close(); }
}
const BELL = {};
const bellRow = (id, file, what, key, answer, judge, opts) => check(id, file, what, HOW, live(async () => { BELL[key] ||= await ring(answer, opts); return judge(BELL[key]); }));
bellRow("P172941", "components/ChefPopup.tsx", "bell: a call that LANDED says 'On our way!' with what was asked for", "ok", { ok: true }, (r) => ({ ok: /On our way!/.test(r.t) && /Water/.test(r.t) && !r.popupOpen, note: r.t }));
bellRow("P172942", "components/ChefPopup.tsx", "bell: 'already_sent' reassures ('Already sent') — no new call claimed", "dup", { ok: true, reason: "already_sent" }, (r) => ({ ok: /Already sent/.test(r.t), note: r.t }));
bellRow("P172943", "components/ChefPopup.tsx", "bell: 'capped' says requests are pending — never 'staff notified'", "cap", { ok: true, reason: "capped" }, (r) => ({ ok: /requests pending/.test(r.t) && !/notified/.test(r.t), note: r.t }));
bellRow("P172944", "components/ChefPopup.tsx", "bell: a blocked table is told it can't call staff", "blk", { ok: false, reason: "blocked" }, (r) => ({ ok: /Can't call staff from this table/.test(r.t), note: r.t }));
bellRow("P172945", "components/ChefPopup.tsx", "item 1 — bell: the table's own LIMIT refusing the call reads as a refusal, never 'staff notified'", "rl", { ok: true, reason: "rate_limited" }, (r) => ({ ok: /Too many calls from this table/.test(r.t) && !/notified|On our way/.test(r.t), note: r.t }), { beacon: true });
bellRow("P172946", "components/ChefPopup.tsx", "item 1 — …and the popup stays open, so the diner is not left thinking it went", "rl", null, (r) => r.popupOpen);
check("P172947", "components/ChefPopup.tsx", "item 10 — …and the owner's limit beacon is sent, naming the QR call and French House", HOW, live(async () => { BELL.rl ||= await ring({ ok: true, reason: "rate_limited" }, { beacon: true }); const l = BELL.rl.seen.limit; return { ok: !!l && l.fn === "lfh_call_waiter_table" && l.rid === FH, note: JSON.stringify(l) }; }));
check("P172948", "components/ChefPopup.tsx", "item 10 — an ordinary landed call sends NO beacon", HOW, live(async () => { BELL.ok ||= await ring({ ok: true }); return BELL.ok.seen.limit === null; }));
bellRow("P172949", "components/ChefPopup.tsx", "item 21 — bell: an answer it does not know ('no_table') is said honestly, never 'Already sent'", "unk", { ok: false, reason: "no_table" }, (r) => ({ ok: /Couldn't call staff from here/.test(r.t) && !/Already sent/.test(r.t), note: r.t }));
bellRow("P172950", "components/ChefPopup.tsx", "item 17 — bell: the restaurant's server not ANSWERING (connection fails) SAVES the call", "drop", (r) => r.abort("failed"), (r) => ({ ok: /Saved/.test(r.t) && /answers/.test(r.t), note: r.t }));
bellRow("P172951", "components/GuestOutboxChip.tsx", "item 17 — …and it waits on the phone as '1 request for staff'", "drop", null, (r) => ({ ok: /1 request for staff/.test(r.chip), note: r.chip }));
bellRow("P172952", "components/ChefPopup.tsx", "item 17 — bell: a gateway timeout from the server is treated the same (saved)", "gw", (r) => r.fulfill({ status: 504, contentType: "application/json", body: JSON.stringify({ message: "upstream request timeout" }) }), (r) => ({ ok: /Saved/.test(r.t), note: r.t }));
bellRow("P172953", "components/ChefPopup.tsx", "bell: a refusal the database words as an ERROR (a broken value, not a busy one) is not saved for later", "val", (r) => r.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ code: "22P02", message: "invalid input syntax for type uuid" }) }), (r) => ({ ok: /Couldn't reach staff/.test(r.t) && !/Saved/.test(r.t), note: r.t }));
check("P172954", "components/ChefPopup.tsx", "no page error in any of the bell's answers", HOW, live(async () => { const e = Object.values(BELL).flatMap((r) => r.errs || []); return { ok: e.length === 0, note: e.join(" | ").slice(0, 120) }; }));

// ── N2. placing a QR order, every refusal the door can send back (CartPanel → reasonMsg) ─────────
async function place(reply) {
  const { ctx, p, errs } = await page(); let posts = 0;
  try {
    await p.route("**/api/guest/place-order", (r) => { posts++; return typeof reply === "function" ? reply(r) : r.fulfill({ status: reply.status || 200, contentType: "application/json", body: JSON.stringify(reply.json) }); });
    await openMenu(p);
    await p.locator('button[aria-label^="Add"], .fc-plus').first().click(); await settle(p, 900);
    const dish = (await p.evaluate(() => JSON.parse(localStorage.getItem("lfh_cart:french-house") || "[]")[0]?.title)) || "";
    await p.locator(".mini-cart").click(); await settle(p, 1100);
    await p.locator("#cart-table").fill("28");
    await p.locator(".cart-foot .btn-gold").click();
    const t = await toast(p, /./); await settle(p, 900);
    const kept = (await p.evaluate(() => JSON.parse(localStorage.getItem("lfh_cart:french-house") || "[]").length));
    const chip = await p.locator(".gob-chip").innerText().catch(() => "");
    return { t, kept, chip, posts, errs, dish };
  } finally { await wipePhone(p); await ctx.close(); }
}
const PLACE = {};
const REFUSALS = [
  ["sold_out", (d) => ({ ok: false, reason: "sold_out", item: d }), /Sold out:/],
  ["hidden_item", (d) => ({ ok: false, reason: "hidden_item", item: d }), /isn't on the menu/],
  ["staff_priced_item", () => ({ ok: false, reason: "staff_priced_item" }), /member of staff/],
  ["empty_order", () => ({ ok: false, reason: "empty_order" }), /nothing in your order/],
  ["rate_limited", () => ({ ok: false, reason: "rate_limited" }), /wait a moment/],
  ["unknown_table", () => ({ ok: false, reason: "unknown_table" }), /isn't one this restaurant has/],
  ["off_plan_table", () => ({ ok: false, reason: "off_plan_table" }), /isn't one this restaurant has/],
  ["unknown_restaurant", () => ({ ok: false, reason: "unknown_restaurant" }), /which restaurant/],
  ["order_too_big", () => ({ ok: false, reason: "order_too_big" }), /too many items/],
  ["allergies_too_long", () => ({ ok: false, reason: "allergies_too_long" }), /allergy note was too long/],
  ["bad_body", () => ({ ok: false, reason: "bad_body" }), /Something was wrong with this order/],
  ["session_closed", () => ({ ok: false, reason: "session_closed" }), /closed/],
];
let pid = 172955;
for (const [code, body, re] of REFUSALS) {
  check(`P${pid++}`, "components/CartPanel.tsx", `order refused '${code}': the diner reads the true reason, the basket is KEPT, nothing is saved for later`, HOW, live(async () => {
    const r = await place((route) => route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify(body(PLACE.dish || "x")) }));
    PLACE.dish ||= r.dish;
    return { ok: re.test(r.t) && r.kept === 1 && !r.chip && !/try again/i.test(code === "rate_limited" ? r.t : ""), note: `${r.t} · kept ${r.kept}` };
  }));
}
// pid = 172967
check("P172967", "components/CartPanel.tsx", "order: a refusal that names a dish names it by its NAME on screen, never an id", HOW, live(async () => {
  const r = await place((route) => route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ ok: false, reason: "sold_out", item: PLACE.dish || "Caffè Latte" }) }));
  return { ok: r.dish && r.t.includes(r.dish) && !/__[0-9a-f]{8}/.test(r.t), note: r.t };
}));
check("P172968", "components/CartPanel.tsx", "order: a 502 'server_busy' SAVES the basket on the phone and says it is going through by itself", HOW, live(async () => {
  const r = await place({ status: 502, json: { ok: false, reason: "server_busy", retryAfter: 30 } });
  return { ok: /Saved/.test(r.t) && /very busy/.test(r.t) && r.kept === 0 && /1 order/.test(r.chip), note: `${r.t} · chip ${r.chip}` };
}));
check("P172969", "components/CartPanel.tsx", "order: a connection that never reaches the server SAVES the basket too (busy = offline)", HOW, live(async () => {
  const r = await place((route) => route.abort("failed"));
  return { ok: /Saved/.test(r.t) && r.kept === 0 && /1 order/.test(r.chip), note: `${r.t} · chip ${r.chip}` };
}));
check("P172970", "components/CartPanel.tsx", "order: a placed order (faked) says 'Order placed · table 28 · sent to kitchen' and empties the basket", HOW, live(async () => {
  const r = await place({ status: 200, json: { ok: true, order_id: "00000000-0000-4000-8000-0000000000cc" } });
  return { ok: /Order placed/.test(r.t) && /table 28/.test(r.t) && r.kept === 0 && r.posts === 1, note: r.t };
}));
check("P172971", "components/CartPanel.tsx", "order: one tap = one request to the door (no double send)", HOW, live(async () => { PLACE.ok ||= await place({ status: 200, json: { ok: true, order_id: "00000000-0000-4000-8000-0000000000cd" } }); return { ok: PLACE.ok.posts === 1, note: `${PLACE.ok.posts}` }; }));
check("P172972", "components/CartPanel.tsx", "no page error across any of the order answers", HOW, live(async () => { PLACE.ok ||= await place({ status: 200, json: { ok: true, order_id: "00000000-0000-4000-8000-0000000000ce" } }); return { ok: PLACE.ok.errs.length === 0, note: PLACE.ok.errs.join(" | ") }; }));

// ── N3. the floating strip, every status answer (items 11, 23) ──────────────────────────────────
// The status travels as an ARGUMENT: a closure variable does not survive the trip into the page (that
// slip is what made the first run seed an order with no status at all).
const seedOrder = (st) => localStorage.setItem("lfh_active_orders:french-house", JSON.stringify([{ id: "00000000-0000-4000-8000-0000000000dd", tableNumber: "28", total: 399, itemCount: 1, items: [{ title: "Tea", qty: 1 }], status: st, placedAt: Date.now() }]));
async function strip(statusAnswer, ticks = 1) {
  const { ctx, p, errs } = await page(seedOrder, "received");
  try {
    await p.route(rpc("get_order_status"), (r) => (typeof statusAnswer === "function" ? statusAnswer(r) : r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(statusAnswer) })));
    await openMenu(p);
    for (let i = 0; i < ticks; i++) { await p.evaluate(() => window.dispatchEvent(new Event("lfh:rt-tick"))); await settle(p, 900); }
    const s = await p.locator(".order-tracker").innerText().catch(() => "");
    const t = await fired(p);
    const stored = await p.evaluate(() => JSON.parse(localStorage.getItem("lfh_active_orders:french-house") || "[]")[0]?.status);
    return { s: s.replace(/\n/g, " "), t, stored, errs };
  } finally { await ctx.close(); }
}
const row = (st) => [{ status: st, table_number: "28", created_at: new Date().toISOString() }];
check("P172973", "components/OrderTracker.tsx", "strip: the kitchen accepting it moves the strip to 'Preparing your order', with a toast", HOW, live(async () => { const r = await strip(row("preparing")); return { ok: /Preparing your order/.test(r.s) && /Preparing/.test(r.t) && r.stored === "preparing", note: `${r.s} · ${r.t}` }; }));
check("P172974", "components/OrderTracker.tsx", "strip: served reads 'Served — enjoy!'", HOW, live(async () => { const r = await strip(row("served")); return { ok: /Served — enjoy!/.test(r.s) && r.stored === "served", note: r.s }; }));
check("P172975", "components/OrderTracker.tsx", "strip: the staff-only 'ready' is never shown — the strip keeps a guest word", HOW, live(async () => { const r = await strip(row("ready")); return { ok: !/ready/i.test(r.s) && !/undefined/.test(r.s), note: r.s }; }));
check("P172976", "components/OrderTracker.tsx", "strip: an order the server truly no longer has (three empty answers) is finalised as cancelled", HOW, live(async () => { const r = await strip([], 4); return { ok: r.stored === "cancelled" && /no longer active/i.test(r.t), note: `${r.stored} · ${r.t}` }; }));
check("P172977", "components/OrderTracker.tsx", "item 23 — strip: FOUR dropped connections (phone online) leave a cooking order exactly as it was", HOW, live(async () => { const r = await strip((rt) => rt.abort("failed"), 4); return { ok: r.stored === "received" && /Awaiting accept/.test(r.s) && !/cancel/i.test(r.s + r.t), note: `${r.stored} · ${r.s}` }; }));
check("P172978", "components/OrderTracker.tsx", "item 23 — strip: four gateway timeouts leave it alone too", HOW, live(async () => { const r = await strip((rt) => rt.fulfill({ status: 504, contentType: "application/json", body: '{"message":"upstream request timeout"}' }), 4); return { ok: r.stored === "received", note: r.stored }; }));
check("P172979", "components/OrderTracker.tsx", "no page error across the strip's answers", HOW, live(async () => { const r = await strip(row("preparing")); return { ok: r.errs.length === 0, note: r.errs.join(" | ") }; }));
async function dishReads(openTab, ms = 20000, tick = false) {
  const { ctx, p } = await page(seedOrder, "preparing"); let n = 0;
  try {
    await p.route(rpc("get_order_dishes"), (r) => { n++; return r.fulfill({ status: 200, contentType: "application/json", body: "[]" }); });
    await p.route(rpc("get_order_status"), (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(row("preparing")) }));
    await openMenu(p);
    await p.evaluate((tab) => { window.dispatchEvent(new Event("lfh:open-cart")); if (tab) window.dispatchEvent(new Event("lfh:show-previous-orders")); }, openTab);
    await p.waitForTimeout(ms);
    const before = n; if (tick) { await p.evaluate(() => window.dispatchEvent(new Event("lfh:rt-tick"))); await settle(p, 1500); }
    return { n, before };
  } finally { await ctx.close(); }
}
check("P172980", "components/CartPanel.tsx", "item 11 — 20 seconds on the Live-status tab with one live order: ONE dish read, not four", HOW, live(async () => { const r = await dishReads(true); return { ok: r.n === 1, note: `${r.n} read(s)` }; }));
check("P172981", "components/CartPanel.tsx", "item 11 — 20 seconds on the CURRENT bill tab: no dish reads at all (the cards are not on screen)", HOW, live(async () => { const r = await dishReads(false); return { ok: r.n === 0, note: `${r.n} read(s)` }; }));
check("P172982", "components/CartPanel.tsx", "item 11 — a realtime nudge for the table asks again, once", HOW, live(async () => { const r = await dishReads(true, 4000, true); return { ok: r.before === 1 && r.n === 2, note: `${r.before} → ${r.n}` }; }));

// ── N4. the dish popup (item 6), the pill (item 18), the stars (item 16), the doors (items 20, 22) ──
check("P172983", "components/OrderConfirmModal.tsx", "item 6 — 'Add to Order' onto a line already at 95 stops at 99 and SAYS 'Maximum 99 per dish'", HOW, live(async () => {
  const { ctx, p } = await page(); try {
    await openMenu(p);
    const dish = await p.evaluate(async () => { const r = await fetch(`/api/r/french-house/menu-data`); const j = await r.json(); return j.items.find((i) => !(i.tags || []).includes("sold-out")); });
    await p.evaluate((d) => { localStorage.setItem("lfh_cart:french-house", JSON.stringify([{ id: d.id, title: d.title, price: String(d.price), image: d.image, qty: 95, sig: "[]" }])); window.dispatchEvent(new Event("lfh:cart-updated")); }, dish);
    await p.evaluate((d) => window.dispatchEvent(new CustomEvent("lfh:open-order-confirm", { detail: { item: { id: d.id, title: d.title, price: String(d.price), image: d.image }, options: [], allergens: [] } })), dish);
    await settle(p, 700);
    for (let i = 0; i < 9; i++) await p.locator('[aria-label="Increase quantity"]').click();
    await p.locator(".order-confirm-add").click();
    const t = await toast(p, /Maximum 99/);
    const q = await p.evaluate(() => JSON.parse(localStorage.getItem("lfh_cart:french-house"))[0].qty);
    return { ok: /Maximum 99 per dish/.test(t) && q === 99, note: `${t} · line ${q}` };
  } finally { await ctx.close(); }
}));
check("P172984", "components/OrderConfirmModal.tsx", "item 6 — an ordinary add still says '1 × <dish> added'", HOW, live(async () => {
  const { ctx, p } = await page(); try {
    await openMenu(p);
    const dish = await p.evaluate(async () => { const j = await (await fetch(`/api/r/french-house/menu-data`)).json(); return j.items[0]; });
    await p.evaluate((d) => window.dispatchEvent(new CustomEvent("lfh:open-order-confirm", { detail: { item: { id: d.id, title: d.title, price: String(d.price), image: d.image }, options: [], allergens: [] } })), dish);
    await settle(p, 600); await p.locator(".order-confirm-add").click();
    const t = await toast(p, /added/); return { ok: /1 × .* added/.test(t) && !/Maximum/.test(t), note: t };
  } finally { await ctx.close(); }
}));
check("P172985", "components/MiniCart.tsx", "item 18 — a corrupted saved quantity of 150 shows on the pill as 99 items, the bill's own number", HOW, live(async () => {
  const { ctx, p } = await page(); try {
    await openMenu(p);
    await p.evaluate(() => { localStorage.setItem("lfh_cart:french-house", JSON.stringify([{ id: "x", title: "Tea", price: "100", image: "", qty: 150, sig: "[]" }])); window.dispatchEvent(new Event("lfh:cart-updated")); });
    await settle(p, 600); const pill = await p.locator(".mini-cart").innerText();
    return { ok: /99 items/.test(pill) && /₹9,900/.test(pill), note: pill.replace(/\n/g, " ") };
  } finally { await ctx.close(); }
}));
async function stars() {
  const { ctx, p } = await page(); try {
    await openMenu(p);
    const href = await p.locator('a[href*="/item/"]').first().getAttribute("href");
    await p.goto(BASE + href, { waitUntil: "domcontentloaded" }); await settle(p, 2500);
    await p.locator(".review-tab-btn").first().click(); await settle(p, 700);
    const t = await p.evaluate(() => new Promise((res) => { const lis = [...document.querySelectorAll(".sr-li")]; const t0 = performance.now(); const at = {}; const tick = () => { lis.forEach((li, i) => { if (at[i] === undefined && li.classList.contains("active")) at[i] = Math.round(performance.now() - t0); }); if (performance.now() - t0 < 2200) requestAnimationFrame(tick); else res(at); }; lis[2].querySelector(".sr-toggle").click(); tick(); }));
    await settle(p, 600);
    const pill = await p.locator(".sr-score-num").innerText();
    const t2 = await p.evaluate(() => new Promise((res) => { const lis = [...document.querySelectorAll(".sr-li")]; const t0 = performance.now(); const off = {}; const tick = () => { lis.forEach((li, i) => { if (off[i] === undefined && !li.classList.contains("active")) off[i] = Math.round(performance.now() - t0); }); if (performance.now() - t0 < 1800) requestAnimationFrame(tick); else res(off); }; lis[0].querySelector(".sr-toggle").click(); tick(); }));
    await settle(p, 900);
    const lit = await p.locator(".sr-li.active").count();
    return { t, t2, pill, lit };
  } finally { await ctx.close(); }
}
let STARS = null;
check("P172986", "components/StarRating.tsx", "item 16 — tapping star 3 lights stars 1–3 one after another, each after its dive (≥ 0.5 s), not on the tap", HOW, live(async () => { STARS ||= await stars(); const t = STARS.t; return { ok: t[0] >= 500 && t[1] > t[0] && t[2] > t[1], note: JSON.stringify(t) }; }));
check("P172987", "components/StarRating.tsx", "item 16 — …and the score reads 3", HOW, live(async () => { STARS ||= await stars(); return { ok: STARS.pill === "3", note: STARS.pill }; }));
check("P172988", "components/StarRating.tsx", "item 16 — lowering to 1 un-lights stars 2–3 only after their crush (≥ 0.5 s)", HOW, live(async () => { STARS ||= await stars(); const o = STARS.t2; return { ok: o[1] >= 500 && o[2] >= 500, note: JSON.stringify(o) }; }));
check("P172989", "components/StarRating.tsx", "item 16 — …and ends with exactly one star lit", HOW, live(async () => { STARS ||= await stars(); return { ok: STARS.lit === 1, note: `${STARS.lit}` }; }));
const door = async (path, raw) => { const r = await fetch(BASE + path, { method: "POST", headers: { "content-type": "application/json" }, body: raw }); return { s: r.status, t: await r.text() }; };
let did = 172990;
for (const path of ["place-order", "call-waiter", "leave"]) {
  for (const raw of ["null", "[]", "7"]) {
    check(`P${did++}`, `app/api/guest/${path}/route.ts`, `item 20 — POST /api/guest/${path} with the body ${raw} answers 400 bad_body (it answered 500 before)`, "LIVE — POST on :4403", live(async () => { const r = await door(`/api/guest/${path}`, raw); return { ok: r.s === 400 && /bad_body/.test(r.t), note: `${r.s} ${r.t}` }; }));
  }
}
// did = 172999
check("P172999", "app/api/guest/limit-hit/route.ts", "item 20 — POST /api/guest/limit-hit with the body null answers 200 ok (it answered 500 before)", "LIVE — POST on :4403", live(async () => { const r = await door("/api/guest/limit-hit", "null"); return { ok: r.s === 200 && /"ok":true/.test(r.t), note: `${r.s} ${r.t}` }; }));
check("P173000", "app/api/guest/limit-hit/route.ts", "item 22 — the beacon answers a list-typed function name with 200 and does nothing else", "LIVE — POST on :4403", live(async () => { const r = await door("/api/guest/limit-hit", JSON.stringify({ fn: ["lfh_place_order"], rid: FH })); return { ok: r.s === 200, note: `${r.s} ${r.t}` }; }));
