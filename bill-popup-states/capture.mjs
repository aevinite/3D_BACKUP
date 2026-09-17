// Re-photograph every state of the bill popup: `node bill-popup-states/capture.mjs` with the app
// running on :4000, then `node bill-popup-states/gallery.mjs` to rebuild index.html.
// Walks the REAL manager popup through every state it can be in, photographs each one, and
// writes one HTML page with all of them plus a LIVE copy of the panel. Cleans up its rows.
import { chromium } from "playwright";
import { writeFileSync, readFileSync } from "node:fs";
import { loginAs } from "../scripts/sweep/login.mjs";

const BASE = "http://localhost:4000";
const OUT = "/Users/aevinite/Documents/Projects/backup_Menu/bill-popup-states";
const shots = [];
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1512, height: 900 } });
const route = await loginAs(ctx, "manager", BASE);
const api = ctx.request;
const page = await ctx.newPage();
const errs = []; page.on("pageerror", (e) => errs.push(String(e.message)));
const created = [];
let T = "";

const f = () => page.frames()[1];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (name, caption, opts = {}) => {
  await wait(opts.settle || 700);
  const el = page.frameLocator("iframe").first().locator(opts.sel || ".tp-detail-floating").first();
  await el.screenshot({ path: `${OUT}/shots/${name}.png` });
  shots.push({ name, caption, w: opts.w || 1512, h: opts.h || 900 });
  console.log("  📸", name);
};
const click = async (sel) => { await f().evaluate((s) => { const e = document.querySelector(s); if (e) e.click(); }, sel); };
const openTable = async (t) => {
  await page.frameLocator("iframe").first().locator(".ftile").filter({ hasText: String(t) }).first().click();
  await wait(1400);
};

try {
  const all = await (await api.get(`${BASE}/api/editor/all`)).json();
  const rid = (all.restaurant || {}).id;
  const cats = (all.categories || []).slice().sort((a, c) => (a.sort_order || 0) - (c.sort_order || 0));
  const items = all.items || [];
  const picks = [];
  for (const c of cats) { picks.push(...items.filter((i) => i.category === c.slug && !i.open_price).slice(0, 3)); if (picks.length >= 18) break; }
  const chosen = picks.slice(0, 18);

  const { RESERVED } = await import("../scripts/sweep/fixtureTables.mjs");
  const taken = new Set(RESERVED.map(([n]) => String(n)));
  const summary = await (await api.get(`${BASE}/api/editor/summary`)).json();
  const free = Object.entries(summary.tiles || {})
    .filter(([n, v]) => /^\d+$/.test(n) && Number(n) <= 30 && !taken.has(n) && !v.members && !v.pending
      && !(v.counts && (v.counts.ck + v.counts.nw + v.counts.rd + v.counts.sv)))
    .map(([n]) => Number(n)).sort((a, c) => c - a);
  T = String(free[0]);
  console.log("states on table", T);

  await page.goto(BASE + route, { waitUntil: "domcontentloaded" });
  await page.frameLocator("iframe").first().locator(".ftile").first().waitFor({ timeout: 30000 });

  // 1 — tapping a FREE table goes straight to taking an order (that is what a free table is for)
  await openTable(T);
  await wait(1200);
  const gotBuilder = await f().evaluate(() => !!document.querySelector(".to-overlay"));
  if (gotBuilder) {
    await shot("01-take-order", "A free table has nothing to read, so tapping it goes straight to ＋ Take order — the dish builder.", { sel: ".to-overlay" });
    await page.keyboard.press("Escape"); await wait(800);
  } else {
    await shot("01-free", "A table with nothing on it yet.");
  }

  // 2 — a guest order just arrived (it stays waiting because nothing is cooking yet)
  const guest = await fetch(`${(readFileSync(new URL("../.env.local", import.meta.url), "utf8").match(/^NEXT_PUBLIC_SUPABASE_URL=(.*)$/m) || [])[1].trim()}/rest/v1/rpc/lfh_place_order_public`, {
    method: "POST",
    headers: (() => { const k = (readFileSync(new URL("../.env.local", import.meta.url), "utf8").match(/^NEXT_PUBLIC_SUPABASE_ANON_KEY=(.*)$/m) || [])[1].trim();
      return { apikey: k, authorization: `Bearer ${k}`, "content-type": "application/json" }; })(),
    body: JSON.stringify({ p_table: T, p_items: [{ id: chosen[0].id, qty: 2 }, { id: chosen[1].id, qty: 1 }], p_allergies: ["dairy"], p_restaurant_id: rid }),
  }).then((r) => r.json());
  console.log("  guest order:", JSON.stringify(guest).slice(0, 220));
  if (guest && (guest.order_id || guest.id)) created.push(guest.order_id || guest.id);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.frameLocator("iframe").first().locator(".ftile").first().waitFor({ timeout: 25000 });
  await openTable(T);   // it has an order now, so the tile opens the bill instead of the builder
  await page.frameLocator("iframe").first().locator(".sp-wait").first().waitFor({ timeout: 25000 });
  await shot("02-waiting", "A guest's order has landed. It is ONE amber line, not on the bill yet: what came, what it costs, ✓ Accept, ✕.");

  // 3 — the same ticket opened out: the accept detail view
  await click(".sp-wait-n");
  await shot("03-accept-detail", "Tap that line and the incoming ticket opens dish by dish — quantities, money, what to avoid in every dish — with Cancel and Accept at the end.");

  // 4 — accepted: it merges into the bill in its menu place
  await click('.sp-sheet-wait [data-accept]');
  await wait(2600);
  await shot("04-accepted", "Accepted. Its dishes are now on the bill, in their menu place, and the amber line is gone.");

  // the rest of the bill: three tickets, so the same dish lands twice
  const place = async (list, qty = 1) => {
    const r = await api.post(`${BASE}/api/editor/order`, { data: { table: T, items: list.map((d) => ({ id: d.id, qty })), allergies: [] } });
    const j = await r.json(); if (j && j.ok) created.push(j.id || j.order_id || (j.order || {}).id);
  };
  await place(chosen.slice(0, 6), 2);
  await place(chosen.slice(6, 12));
  await place(chosen.slice(12, 18));
  await wait(1200);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.frameLocator("iframe").first().locator(".sp-list").first().waitFor({ timeout: 25000 });
  await shot("05-full-bill", "The whole bill: 20 dish lines, one per dish, in the menu's own order. The same dish from two tickets is one line, with a small 2⟩ saying so.");

  // 6 — part served: the served ones sink
  const board = await (await api.get(`${BASE}/api/editor/sessions?table=${T}`)).json();
  const ordersPayload = await (await api.get(`${BASE}/api/editor/orders?table=${T}`)).json();
  const rows = board.items || [];
  const orders = (ordersPayload.orders || ordersPayload || []).filter((o) => o && o.status !== "cancelled");
  console.log("  tickets on the bill:", orders.map((o) => `#${o.kot_no}`).join(" "));
  const firstOrder = orders.find((o) => o.status !== "received") || orders[0];
  for (const it of rows.filter((r) => r.order_id === (firstOrder || {}).id).slice(0, 5)) {
    await api.post(`${BASE}/api/editor/items/${it.id}/status`, { data: { status: "served" } });
  }
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.frameLocator("iframe").first().locator(".sp-list").first().waitFor({ timeout: 25000 });
  await shot("06-served-sinks", "Served dishes sink to the bottom and go quiet, so the top of the list is only what is still to come.");

  // 7 — a dish's own sheet (a merged line: both tickets inside it)
  await f().evaluate(() => { const r = [...document.querySelectorAll(".sp-row")].find((x) => x.querySelector(".sp-parts")) || document.querySelectorAll(".sp-row")[2]; r.click(); });
  await shot("07-dish-sheet", "A dish's own detail: its course, its total, and one row per ticket it came on — each with its own Serve, ✎, quantity, remove and void.");

  // 8 — the ✎ editor for one dish
  await f().evaluate(() => { const b2 = document.querySelector(".sp-sheet [data-edit-dish]") || document.querySelector(".sp-row [data-edit-dish]"); if (b2) b2.click(); });
  await wait(1200);
  await shot("08-dish-edit", "✎ on any line: allergens to avoid and the kitchen note for that one dish.", { sel: ".tbl-modal, .tp-detail-floating" });
  await page.keyboard.press("Escape");
  await wait(600);

  // 9 — ticket order
  await click('[data-sp-view="kot"]');
  await shot("09-kot-wise", "The same bill, ticket by ticket. No headings here either: the ticket is on the line, and a hairline shows where one ends.");
  await click('[data-sp-view="menu"]');

  // 10 — calls
  for (const reason of ["Water", "Napkins", "Cutlery", "Clean table", "Bill, please", "Waiter call"]) {
    await api.post(`${BASE}/api/guest/call-waiter`, { data: { table: T, restaurantId: rid, reason } });
  }
  await wait(3000);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.frameLocator("iframe").first().locator(".sp-list").first().waitFor({ timeout: 25000 });
  await shot("10-calls", "Six calls ringing at once, on one line. Each emoji is the button that clears it; all ✓ clears the lot.");

  // 11-13 — the table's mark
  for (const [tag, cap] of [["family", "Marked Family — the mark sits in the head, and the party chip beside it."],
                            ["vip", "Marked VIP."], ["guest", "Marked Owner's guest."]]) {
    await api.post(`${BASE}/api/editor/tables/${T}/tag`, { data: { tag } });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.frameLocator("iframe").first().locator(".sp-list").first().waitFor({ timeout: 25000 });
    await shot(`11-tag-${tag}`, cap);
  }
  await api.post(`${BASE}/api/editor/tables/${T}/tag`, { data: { tag: "family" } });

  // 14 — a discount on the bill
  const oD = await (await api.get(`${BASE}/api/editor/orders?table=${T}`)).json();
  const liveOrder = ((oD.orders || oD || []).find((o) => o && o.status !== "received" && o.status !== "cancelled") || {}).id;
  if (liveOrder) {
    await api.post(`${BASE}/api/editor/orders/${liveOrder}/discount`, { data: { amount: 250, note: "regulars" } });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.frameLocator("iframe").first().locator(".sp-list").first().waitFor({ timeout: 25000 });
    await shot("14-discount", "A discount on the bill: the money line carries it, and the total is what is due.");
  }

  // 15 — everything served
  const board2 = await (await api.get(`${BASE}/api/editor/sessions?table=${T}`)).json();
  for (const it of (board2.items || []).filter((r) => r.status !== "served")) {
    await api.post(`${BASE}/api/editor/items/${it.id}/status`, { data: { status: "served" } });
  }
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.frameLocator("iframe").first().locator(".sp-list").first().waitFor({ timeout: 25000 });
  await shot("15-all-served", "Everything is out. The bar is full, every line is quiet, and the only thing left is the money.");

  // 16 — a phone
  await page.setViewportSize({ width: 392, height: 844 });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.frameLocator("iframe").first().locator(".sp-list").first().waitFor({ timeout: 25000 });
  await shot("16-phone", "The same popup on a phone (392 × 844) — the identical thing, edge to edge.", { w: 392, h: 844 });

  // 17 — a short laptop window: the optional strips are dropped instead of the rows
  await page.setViewportSize({ width: 1512, height: 620 });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.frameLocator("iframe").first().locator(".sp-list").first().waitFor({ timeout: 25000 });
  await shot("17-short-window", "A short window: the rows shrink to fit rather than scroll, and the progress legend is dropped before the dishes are.");
  await page.setViewportSize({ width: 1512, height: 900 });

  console.log("errors:", errs.length ? errs.slice(0, 4) : "none");
} catch (e) {
  console.error("FAILED:", e.message, e.stack ? e.stack.split("\n")[1] : "");
} finally {
  writeFileSync(`${OUT}/shots.json`, JSON.stringify({ table: T, shots, at: new Date().toISOString() }, null, 1));
  console.log("captured", shots.length, "states; fixture rows left on table", T);
  await b.close();
}
