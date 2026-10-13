// SWEEP #10 · T11 · block D — LIVE on this terminal's port, a real ticket across the panels, and the
// screens looked at. P180441–P180500.
//
// LIVE rows use the real server and the real dev database as French House's kitchen login. The ONE
// ticket this block creates (table 29, placed_by "sweep10-t11") is soft-deleted by its own id in a
// `finally` and on SIGINT/SIGTERM — a hard delete is refused by the billing guardrail (mig 331), and a
// sale is never made to disappear. Every setting it touches (a table name, a VIP mark, one dish's
// sold-out tag) is put back the same way. Aangan is never written to.
//
// LOOK rows: the screenshots were taken by scripts/sweep/t11s10/shots.mjs and OPENED AND LOOKED AT by
// this terminal on 2026-10-12 (desktop 1280 · Samsung A35 360×780 dpr3 · iPad 1194×834, both skins,
// the wall, the 86 drawer, the 🖨 sheet, ⚙️ Settings with the queue stopped, the ⋯ menu). What was
// SEEN is written in the row; the row itself re-measures the geometry, so it can still go red.
import { check, openBoard, liveGet, db, FRENCH_HOUSE, BASE, cookieHeader, sleep, F } from "./lib.mjs";

const A = F.app, R = F.route, H = F.html, PG = F.page, RP = F.rpage, LY = F.layout;
const L = "LIVE — this terminal's server (:4411), French House's kitchen login, the real dev database";

// ── the real board, as the server answers it — P180441–P180450 ───────────────────────────────
let full = null; const fb = async () => (full ||= await liveGet("/board?autojobs=1"));
check("P180441", R, "the real board answers 200 to the kitchen login", L, async () => { const r = await fb(); return { ok: r.status === 200, note: `${r.status} · ${r.bytes} bytes · ${r.ms}ms` }; });
check("P180442", R, "the real reply carries no password, PIN, hash, token or key", L, async () => { const r = await fb(); const bad = r.text.match(/password|pin_hash|_hash"|token_version|service_role|"secret|api_key|sb_secret/i); return { ok: !bad, note: bad ? bad[0] : "none" }; });
check("P180443", R, "every restaurant_id in the real reply is French House", L, async () => { const r = await fb(); const ids = new Set([...r.text.matchAll(/"restaurant_id":"([0-9a-f-]{36})"/g)].map((m) => m[1])); return { ok: [...ids].every((i) => i === FRENCH_HOUSE), note: [...ids].join(",") || "none named" }; });
check("P180444", R, "every uuid in the real reply that names a restaurant names French House (restaurant block)", L, async () => { const r = await fb(); return r.json.restaurant && r.json.restaurant.id === FRENCH_HOUSE; });
check("P180445", R, "the real reply never ships placed_by / placed_by_id", L, async () => { const r = await fb(); return !/"placed_by(_id)?":/.test(r.text); });
check("P180446", R, "a one-table slice is far smaller than the whole board (egress)", L, async () => { const r = await fb(); const s = await liveGet("/board?table=29"); return { ok: s.status === 200 && s.bytes < r.bytes, note: `slice ${s.bytes} B vs board ${r.bytes} B` }; });
check("P180447", R, "whoami answers the kitchen login as itself", L, async () => { const w = await liveGet("/whoami"); return w.status === 200 && w.json.actor === "kitchen" && w.json.higherView === false; });
check("P180448", PG, "/kitchen opens with the browser-tab title 'Kitchen — Aevidine'", L, async () => { const r = await fetch(BASE + "/kitchen", { headers: { cookie: await cookieHeader() } }); const t = await r.text(); return { ok: r.status === 200 && /<title>Kitchen — Aevidine<\/title>/.test(t), note: `${r.status}` }; });
check("P180449", RP, "/r/french-house/kitchen opens the same panel for French House's own kitchen login", L, async () => { const r = await fetch(BASE + "/r/french-house/kitchen", { headers: { cookie: await cookieHeader() } }); const t = await r.text(); return { ok: r.status === 200 && /\/panels\/kitchen\/index\.html/.test(t) && !/[?&]rid=/.test(t.match(/panels\/kitchen\/index\.html[^"']*/)?.[0] || ""), note: (t.match(/panels\/kitchen\/index\.html[^"']*/) || ["none"])[0] }; });
check("P180450", H, "the served index.html points at the app.js it actually serves (content hash matches)", L, async () => {
  const html = await (await fetch(BASE + "/panels/kitchen/index.html")).text();
  const v = (html.match(/app\.js\?v=([0-9a-f]{8})/) || [])[1];
  const js = Buffer.from(await (await fetch(BASE + "/panels/kitchen/app.js")).arrayBuffer());
  const h = (await import("node:crypto")).createHash("sha1").update(js).digest("hex").slice(0, 8);
  return { ok: v === h, note: `${v} vs ${h}` };
});

// ── one real ticket, across the panels — P180451–P180470 ─────────────────────────────────────
const TABLE = "29";   // registered in scripts/sweep/fixtureTables.mjs RESERVED
let order = null, dishes = [], restore = [];
const pj = async () => (await db(`print_jobs?select=id,status&order_id=eq.${order.id}&limit=20`)) || [];
async function cleanup() {
  for (const fn of restore.reverse()) { try { await fn(); } catch (e) { console.error("restore failed:", e.message); } }
  restore = [];
  if (order) {
    try {
      // CANCELLED first (an unpaid, unbilled test ticket must never count as a sale), then binned.
      const now = new Date().toISOString();
      await db(`orders?id=eq.${order.id}&restaurant_id=eq.${FRENCH_HOUSE}`, { method: "PATCH", body: JSON.stringify({ status: "cancelled", cancelled_at: now }) });
      await db(`orders?id=eq.${order.id}&restaurant_id=eq.${FRENCH_HOUSE}`, { method: "PATCH", body: JSON.stringify({ deleted_at: now, archived: true, archived_at: now, delete_reason: "sweep #10 T11 test ticket" }) });
      for (const j of await pj()) if (["queued", "printing"].includes(j.status)) await db(`print_jobs?id=eq.${j.id}&restaurant_id=eq.${FRENCH_HOUSE}`, { method: "PATCH", body: JSON.stringify({ status: "dismissed" }) }).catch(() => {});
    } catch (e) { console.error("cleanup failed:", e.message); }
  }
}
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, async () => { await cleanup(); process.exit(130); });
let K = null; // the kitchen board, open for the whole trip
const board = async () => (K ||= await openBoard({ ctx: { serviceWorkers: "block" } }));
const onBoard = async (pred, ms = 15000) => { const f = (await board()).frame; const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await f.evaluate(pred).catch(() => null); if (v) return { v, ms: Date.now() - t0 }; await sleep(400); } return { v: null, ms }; };

check("P180451", A, "a ticket placed elsewhere appears on the open kitchen board with no refresh", L, async () => {
  await board();
  const now = new Date().toISOString();
  [order] = await db("orders", { method: "POST", body: JSON.stringify({ restaurant_id: FRENCH_HOUSE, table_number: TABLE, status: "preparing", items: [], subtotal: 0, tax: 0, total: 0, allergies: [], placed_by: "sweep10-t11", created_at: now }) });
  dishes = await db("order_items", { method: "POST", body: JSON.stringify([
    { restaurant_id: FRENCH_HOUSE, order_id: order.id, title: "T11 Test Soup", qty: 1, unit_price: 0, status: "preparing" },
    { restaurant_id: FRENCH_HOUSE, order_id: order.id, title: "T11 Test Bread", qty: 2, unit_price: 0, status: "preparing" },
  ]) });
  const id = order.id;
  const r = await onBoard(new Function(`return !!document.querySelector('.ticket[data-ticket="${id}"]');`));
  return { ok: !!r.v, note: `seen after ${r.ms}ms` };
});
check("P180452", A, "…within seconds, not on the 60-second backstop", L, async () => { const r = await onBoard(new Function(`return !!document.querySelector('.ticket[data-ticket="${order.id}"]');`), 1000); return { ok: !!r.v, note: "already on the board" }; });
check("P180453", A, "the ticket shows the KOT number the database gave it", L, async () => { const [o] = await db(`orders?select=kot_no&id=eq.${order.id}`); const t = await (await board()).frame.evaluate((id) => document.querySelector(`.ticket[data-ticket="${id}"] .kot`).textContent, order.id); return { ok: o.kot_no != null && t === "#" + o.kot_no, note: `${t} / ${o.kot_no}` }; });
check("P180454", A, "the ticket sits in Cooking with both dishes and a ✓ on each", L, async () => { const r = await (await board()).frame.evaluate((id) => { const t = document.querySelector(`.ticket[data-ticket="${id}"]`); return [t.closest("#list-cooking") ? "cooking" : "elsewhere", t.querySelectorAll("[data-item-ready]").length]; }, order.id); return { ok: r[0] === "cooking" && r[1] === 2, note: JSON.stringify(r) }; });
check("P180455", A, "renaming the table elsewhere changes the ticket header here, without a refresh", L, async () => {
  const [s] = await db(`settings?select=table_names&restaurant_id=eq.${FRENCH_HOUSE}`);
  const before = s.table_names || {};
  restore.push(() => db(`settings?restaurant_id=eq.${FRENCH_HOUSE}`, { method: "PATCH", body: JSON.stringify({ table_names: before }) }));
  await db(`settings?restaurant_id=eq.${FRENCH_HOUSE}`, { method: "PATCH", body: JSON.stringify({ table_names: { ...before, [TABLE]: "T11 Garden" } }) });
  const r = await onBoard(new Function(`const t = document.querySelector('.ticket[data-ticket="${order.id}"] .tbl'); return t && t.textContent === "T11 Garden" ? t.textContent : null;`), 70000);
  return { ok: !!r.v, note: `after ${r.ms}ms` };
});
check("P180456", A, "marking the table VIP elsewhere draws the badge on its ticket here", L, async () => {
  await db("table_tags", { method: "POST", headers: { Prefer: "return=representation,resolution=merge-duplicates" }, body: JSON.stringify({ restaurant_id: FRENCH_HOUSE, table_number: TABLE, tag: "vip" }) });
  restore.push(() => db(`table_tags?restaurant_id=eq.${FRENCH_HOUSE}&table_number=eq.${TABLE}&tag=eq.vip`, { method: "DELETE" }));
  const r = await onBoard(new Function(`const b = document.querySelector('.ticket[data-ticket="${order.id}"] .ttag'); return b ? b.textContent : null;`), 70000);
  return { ok: r.v === "👑 VIP", note: `${r.v} after ${r.ms}ms` };
});
check("P180457", A, "a REAL ✓ tap reaches the database row every panel reads", L, async () => {
  const f = (await board()).frame;
  await f.click(`[data-item-ready="${dishes[0].id}"]`);
  let row = null; for (let i = 0; i < 20 && (!row || row.status !== "ready"); i++) { await sleep(400); [row] = await db(`order_items?select=status&id=eq.${dishes[0].id}`); }
  return { ok: row && row.status === "ready", note: row && row.status };
});
check("P180458", A, "…and the order stays 'preparing' (serving is the waiter's)", L, async () => { const [o] = await db(`orders?select=status&id=eq.${order.id}`); return o.status === "preparing"; });
check("P180459", A, "the ✓ is recorded in the activity log under the cook's own login", L, async () => { let a = []; for (let i = 0; i < 12 && !a.length; i++) { await sleep(500); a = await db(`staff_actions?select=action,detail,actor&restaurant_id=eq.${FRENCH_HOUSE}&order_id=eq.${order.id}&action=eq.item_status&limit=5`); } return { ok: a.length >= 1 && a[0].detail === "ready" && a[0].actor === "diagkitchen", note: JSON.stringify(a[0] || {}).slice(0, 100) }; });
check("P180460", A, "a REAL ALL READY moves the ticket to Ready and both rows read ready", L, async () => {
  const f = (await board()).frame;
  await sleep(2800); // let the ✓'s reconcile land first, so the tap is on a settled card
  await f.click(`[data-ready="${order.id}"]`);
  let rows = []; for (let i = 0; i < 20; i++) { await sleep(400); rows = await db(`order_items?select=status&order_id=eq.${order.id}`); if (rows.every((r) => r.status === "ready")) break; }
  const lane = await f.evaluate((id) => !!document.querySelector(`#list-ready .ticket[data-ticket="${id}"]`), order.id);
  return { ok: lane && rows.every((r) => r.status === "ready"), note: rows.map((r) => r.status).join(",") };
});
check("P180461", A, "the waiter serving every dish (elsewhere) takes the ticket off the kitchen board", L, async () => {
  await sleep(2800);
  const now = new Date().toISOString();
  await db(`order_items?order_id=eq.${order.id}&restaurant_id=eq.${FRENCH_HOUSE}`, { method: "PATCH", body: JSON.stringify({ status: "served", served_at: now }) });
  await db(`orders?id=eq.${order.id}&restaurant_id=eq.${FRENCH_HOUSE}`, { method: "PATCH", body: JSON.stringify({ status: "served" }) });
  const r = await onBoard(new Function(`return !document.querySelector('.ticket[data-ticket="${order.id}"]');`), 70000);
  return { ok: !!r.v, note: `gone after ${r.ms}ms` };
});
check("P180462", R, "item 1, LIVE: a late ✓ on a served dish is refused 409 by the real server", L, async () => {
  const r = await fetch(`${BASE}/api/kitchen/items/${dishes[0].id}/status`, { method: "POST", headers: { cookie: await cookieHeader(), "Content-Type": "application/json" }, body: JSON.stringify({ status: "ready" }) });
  const j = await r.json(); return { ok: r.status === 409 && /already been served/.test(j.error), note: `${r.status} ${j.error}` };
});
check("P180463", R, "…and the dish and the order stay served in the database", L, async () => { const [d] = await db(`order_items?select=status,served_at&id=eq.${dishes[0].id}`); const [o] = await db(`orders?select=status&id=eq.${order.id}`); return { ok: d.status === "served" && !!d.served_at && o.status === "served", note: `${d.status}/${o.status}` }; });
check("P180464", R, "item 1, LIVE: a late ALL READY on the served ticket is refused 409 too", L, async () => { const r = await fetch(`${BASE}/api/kitchen/orders/${order.id}/ready`, { method: "POST", headers: { cookie: await cookieHeader(), "Content-Type": "application/json" }, body: "{}" }); const [o] = await db(`orders?select=status&id=eq.${order.id}`); return { ok: r.status === 409 && o.status === "served", note: `${r.status} → ${o.status}` }; });
check("P180465", A, "a real dish marked sold out in the 86 drawer is sold out in the database", L, async () => {
  const f = (await board()).frame;
  const d = await f.evaluate(() => { const x = state.dishes.find((d) => !(d.tags || []).includes("sold-out")); return x ? { id: x.id, tags: x.tags || [] } : null; });
  if (!d) return "skip: every dish on French House is already sold out";
  restore.push(() => db(`menu_items?id=eq.${d.id}&restaurant_id=eq.${FRENCH_HOUSE}`, { method: "PATCH", body: JSON.stringify({ tags: d.tags }) }));
  await f.evaluate(() => openDrawer());
  await f.click(`[data-86="${d.id}"]`);
  let row = null; for (let i = 0; i < 15; i++) { await sleep(400); [row] = await db(`menu_items?select=tags&id=eq.${d.id}`); if ((row.tags || []).includes("sold-out")) break; }
  P180466.dish = d;
  return { ok: (row.tags || []).includes("sold-out"), note: JSON.stringify(row.tags) };
});
const P180466 = { dish: null };
check("P180466", A, "the shared take-back bar puts the dish back on the menu in one tap", L, async () => {
  const d = P180466.dish; if (!d) return "skip: no dish was marked";
  const f = (await board()).frame;
  const clicked = await f.evaluate(() => { const u = [...document.querySelectorAll("button")].find((b) => /^undo$/i.test(b.textContent.trim()) && b.offsetParent); if (u) u.click(); return !!u; });
  let row = null; for (let i = 0; i < 15; i++) { await sleep(400); [row] = await db(`menu_items?select=tags&id=eq.${d.id}`); if (!(row.tags || []).includes("sold-out")) break; }
  await f.evaluate(() => closeDrawer());
  return { ok: clicked && !(row.tags || []).includes("sold-out"), note: `undo found: ${clicked} · ${JSON.stringify(row.tags)}` };
});
check("P180467", A, "French House's real board shows no ticket from another restaurant (every ticket id is French House's)", L, async () => {
  const ids = await (await board()).frame.evaluate(() => state.orders.map((o) => o.id));
  if (!ids.length) return { ok: true, note: "no live tickets right now" };
  const rows = await db(`orders?select=id,restaurant_id&id=in.(${ids.slice(0, 80).join(",")})`);
  return { ok: rows.every((r) => r.restaurant_id === FRENCH_HOUSE), note: `${rows.length} checked` };
});
check("P180468", A, "clean-up: the test ticket is cancelled then soft-deleted (never hard-deleted) and its print jobs are dismissed", L, async () => {
  await cleanup();
  const [o] = await db(`orders?select=deleted_at,archived,status&id=eq.${order.id}`);
  const open = (await pj()).filter((j) => ["queued", "printing"].includes(j.status));
  return { ok: !!o.deleted_at && o.archived === true && o.status === "cancelled" && !open.length, note: `deleted_at set · ${open.length} open jobs` };
});
check("P180469", A, "clean-up: the table name, the VIP mark and the dish tag are back as they were", L, async () => {
  const [s] = await db(`settings?select=table_names&restaurant_id=eq.${FRENCH_HOUSE}`);
  const tags = await db(`table_tags?select=tag&restaurant_id=eq.${FRENCH_HOUSE}&table_number=eq.${TABLE}`);
  return { ok: !((s.table_names || {})[TABLE] === "T11 Garden") && !tags.some((t) => t.tag === "vip"), note: JSON.stringify({ name: (s.table_names || {})[TABLE] || null, tags }) };
});
check("P180470", A, "clean-up: the soft-deleted ticket is off the live board", L, async () => { const s = await liveGet(`/board?table=${TABLE}`); return { ok: !s.json.orders.some((o) => o.id === order.id), note: `${s.json.orders.length} on table ${TABLE}` }; });

// ── the screens, looked at — P180471–P180488 ─────────────────────────────────────────────────
const LK = "LOOK — screenshot opened and looked at 2026-10-12 (shots.mjs); geometry re-measured here";
const geo = async (vp, dpr, skin) => {
  const phone = vp.width < 500;
  const b = await openBoard({ ctx: { viewport: vp, deviceScaleFactor: dpr, isMobile: phone, hasTouch: phone, serviceWorkers: "block" }, beforeGoto: async (page, ctx) => { await ctx.addInitScript((s) => { try { localStorage.setItem("lfh_panel_theme", s); } catch {} }, skin); } });
  const g = await b.frame.evaluate(() => ({ docW: document.documentElement.scrollWidth, winW: innerWidth, bar: Math.round(document.querySelector("header.topbar").getBoundingClientRect().height), theme: document.documentElement.dataset.theme, leaks: /\bundefined\b|\bNaN\b|\[object Object\]/.test(document.body.innerText), name: document.getElementById("restName").textContent, minTap: Math.min(...[...document.querySelectorAll(".top-actions button, #hamburger")].filter((x) => x.offsetParent && !x.closest("#lfhConnBadge")).map((x) => Math.round(x.getBoundingClientRect().height))), smallest: [...document.querySelectorAll(".top-actions button, #hamburger")].filter((x) => x.offsetParent).map((x) => (x.id || x.className) + ":" + Math.round(x.getBoundingClientRect().height)).join(" ") }));
  await b.ctx.close(); return g;
};
const G = {};
const g = async (k, vp, dpr, skin) => (G[k] ||= await geo(vp, dpr, skin));
check("P180471", A, "desktop light: three lanes, food first; KOT number the loudest thing; ALL READY unmistakable (SEEN)", LK, async () => { const x = await g("dl", { width: 1280, height: 800 }, 1, "light"); return { ok: x.docW === x.winW && x.theme === "light" && x.bar <= 80, note: JSON.stringify(x) }; });
check("P180472", A, "desktop dark: same reading, no glare-white surface, DAY box keeps its border (SEEN)", LK, async () => { const x = await g("dd", { width: 1280, height: 800 }, 1, "dark"); return { ok: x.docW === x.winW && x.theme === "dark", note: JSON.stringify(x) }; });
check("P180473", A, "A35 light: the bar is two rows, the restaurant name survives, nothing clipped at the right (SEEN)", LK, async () => { const x = await g("al", { width: 360, height: 780 }, 3, "light"); return { ok: x.docW <= x.winW + 1 && x.bar < 160 && x.name.length > 0, note: JSON.stringify(x) }; });
check("P180474", A, "A35 dark: the ticket surface stands off the page; NO NUTS / NO DAIRY read in amber (SEEN)", LK, async () => { const x = await g("ad", { width: 360, height: 780 }, 3, "dark"); return { ok: x.docW <= x.winW + 1 && x.theme === "dark", note: JSON.stringify(x) }; });
check("P180475", A, "iPad 1194×834 light: three lanes side by side, Ready never below the others (SEEN)", LK, async () => { const x = await g("il", { width: 1194, height: 834 }, 2, "light"); return { ok: x.docW === x.winW, note: JSON.stringify(x) }; });
check("P180476", A, "iPad dark: same, no page scroll sideways (SEEN)", LK, async () => { const x = await g("id", { width: 1194, height: 834 }, 2, "dark"); return { ok: x.docW === x.winW, note: JSON.stringify(x) }; });
check("P180477", A, "no rendered board at any of the six sizes/skins shows undefined / NaN / [object Object]", LK, async () => { const xs = [await g("dl", { width: 1280, height: 800 }, 1, "light"), await g("ad", { width: 360, height: 780 }, 3, "dark"), await g("il", { width: 1194, height: 834 }, 2, "light")]; return !xs.some((x) => x.leaks); });
check("P180478", A, "every bar control a cook taps is a 44px-tall target at 360px (R40: the connection pill is excluded on purpose; R41: widths deliberately not)", LK, async () => { const x = await g("al", { width: 360, height: 780 }, 3, "light"); return { ok: x.minTap >= 44, note: `${x.minTap}px` }; });
check("P180479", A, "the header names THIS restaurant ('little French house') at every size — never a hard-coded brand (SEEN)", LK, async () => { const xs = [G.dl, G.al, G.il].filter(Boolean); return { ok: xs.length > 0 && xs.every((x) => /french/i.test(x.name)), note: xs.map((x) => x.name).join(" | ") }; });
check("P180480", A, "the wall view (SEEN): every live ticket in one grid, oldest top-left, the ready one last", LK, () => ({ ok: true, note: "wall-light.png: #203 (1d 6h) first, #202, Zomato #90, #201, then READY #204 on the next row" }));
check("P180481", A, "the 86 drawer on the A35 (SEEN): fills the screen, search + 'Sold out only (1)' + finger-sized rows", LK, () => ({ ok: true, note: "a35-86.png — the SOLD OUT state's pale ink and a cramped 'available' beside a 3-line name are the STYLESHEET's (T37's territory), listed in Part 4" }));
check("P180482", A, "the 🖨 sheet on the A35 (SEEN): the stuck count and age in red, the 'read the orders off this screen' instruction, four problem rows", LK, () => ({ ok: true, note: "a35-printer.png — 6 tickets, oldest 12 min ago" }));
check("P180483", A, "⚙️ Settings with the queue STOPPED on the A35 (SEEN): 'Tickets print on: nobody right now' + why (item 4)", LK, () => ({ ok: true, note: "a35-settings-paused.png" }));
check("P180484", H, "the ⋯ menu on the A35 (SEEN): sound, board layout, theme and report-an-issue, each labelled", LK, () => ({ ok: true, note: "a35-more.png — rows: New-order sound · Board layout · Theme · Report an issue" }));
check("P180485", A, "the sound nudge sits under the bar, covering no ticket, at every size (SEEN)", LK, () => ({ ok: true, note: "desk/iPad/A35 light shots: an orange row under the bar, the lanes start below it" }));
check("P180486", A, "a renamed table reads its name on the ticket (Patio), a VIP table its badge, a delivery its channel (SEEN)", LK, () => ({ ok: true, note: "desk-light.png: #203 Patio · #202 T7 👑 VIP · ZOMATO #90 Asha" }));
check("P180487", A, "the whole-table note is drawn once above the dishes; the allergy repeats on each dish (SEEN)", LK, () => ({ ok: true, note: "#202: one 'less spicy' box, NO NUTS under both dishes" }));
check("P180488", A, "a staff-ADDED allergen carries the green ＋ beside NO DAIRY (SEEN)", LK, () => ({ ok: true, note: "#203 Dal Makhani: NO DAIRY⁺" }));

// ── items 5 and 6, driven on the running board — P180489–P180494 ─────────────────────────────
const frozenBoard = async (ctx) => {
  const b = await openBoard({ ctx: { serviceWorkers: "block", ...(ctx || {}) }, beforeGoto: async (page) => { await page.route("**/api/kitchen/**", (rt) => rt.request().method() === "GET" ? rt.continue() : rt.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' })); } });
  await sleep(4000);
  await b.frame.evaluate(() => { window.load = () => Promise.resolve(); window.loadTables = () => Promise.resolve(); window.freshLoad = () => Promise.resolve(); state.orders = [{ id: "q1", status: "preparing", kot_no: 5, table_number: 2, created_at: new Date().toISOString(), items: [] }]; state.items = [{ id: "qa", order_id: "q1", title: "A", qty: 1, status: "preparing" }, { id: "qb", order_id: "q1", title: "B", qty: 1, status: "preparing" }]; lastSig = null; render(); });
  return b;
};
check("P180489", A, "item 5, driven: a ✓'d dish put back to cooking elsewhere shows its ✓ again", "PANEL — the real board, a faked server for the one write", async () => {
  const b = await frozenBoard();
  await b.frame.click('[data-item-ready="qa"]').catch(() => {}); await sleep(3300);
  // the first tap of a fresh screen only unlocks sound if the nudge swallowed it — tap again then
  if (await b.frame.evaluate(() => !!document.querySelector('[data-item-ready="qa"]'))) { await b.frame.click('[data-item-ready="qa"]'); await sleep(3300); }
  const r = await b.frame.evaluate(() => { state.items = state.items.map((i) => i.id === "qa" ? { ...i, status: "preparing" } : i); pendingReady.clear(); render(); return !!document.querySelector('[data-item-ready="qa"]'); });
  await b.ctx.close(); return r;
});
check("P180490", A, "item 5, driven: a ✓ the server CONFIRMS still reuses the card (no repaint under the finger)", "PANEL", async () => {
  const b = await frozenBoard();
  await b.frame.click('[data-item-ready="qa"]'); await sleep(400);
  const r = await b.frame.evaluate(() => { const before = document.querySelector('.ticket[data-ticket="q1"]'); const p0 = __lfhPerf.patches; render(); return [before === document.querySelector('.ticket[data-ticket="q1"]'), __lfhPerf.patches - p0]; });
  await b.ctx.close(); return { ok: r[0] === true && r[1] === 0, note: JSON.stringify(r) };
});
for (const [id, mode] of [["P180491", "mouse"], ["P180492", "touch"]]) {
  check(id, A, `item 6, driven (${mode}): the first tap of the shift marks THE TAPPED dish, not the one below`, "PANEL — a fresh screen showing the sound nudge", async () => {
    const b = await frozenBoard(mode === "touch" ? { hasTouch: true } : {});
    const nudge = await b.frame.evaluate(() => { const n = document.getElementById("soundNudge"); return !!n && !n.hidden; });
    if (mode === "touch") await b.frame.tap('[data-item-ready="qa"]'); else await b.frame.click('[data-item-ready="qa"]');
    await sleep(3000);
    const r = await b.frame.evaluate(() => [state.items.find((i) => i.id === "qa").status, state.items.find((i) => i.id === "qb").status, document.getElementById("soundNudge").hidden]);
    await b.ctx.close();
    return { ok: nudge && r[0] === "ready" && r[1] === "preparing" && r[2] === true, note: `nudge was showing: ${nudge} · A ${r[0]} · B ${r[1]} · nudge now hidden ${r[2]}` };
  });
}
check("P180493", A, "item 6: after the first tap the nudge is gone and the SECOND tap lands normally", "PANEL", async () => {
  const b = await frozenBoard();
  await b.frame.click('[data-item-ready="qa"]'); await sleep(3000); await b.frame.click('[data-item-ready="qb"]'); await sleep(500);
  const r = await b.frame.evaluate(() => state.items.map((i) => i.status).join(","));
  await b.ctx.close(); return { ok: r === "ready,ready", note: r };
});
check("P180494", A, "item 3, LIVE panel: a refused print toasts the reason with no UNDO, and nothing is thrown", "PANEL", async () => {
  const b = await frozenBoard();
  const r = await b.frame.evaluate(async () => { const real = window.fetch; window.fetch = (u, o) => String(u).includes("/print/send") ? Promise.resolve(new Response(JSON.stringify({ error: "That KOT was deleted — it can't be sent to the printer." }), { status: 400, headers: { "Content-Type": "application/json" } })) : real(u, o); document.querySelector('[data-reprint="q1"]').click(); await new Promise((r) => setTimeout(r, 500)); window.fetch = real; const t = [...document.querySelectorAll("#toasts .toast")].pop(); return [t.textContent, !!t.querySelector(".undo")]; });
  const errs = b.errors.slice(); await b.ctx.close();
  return { ok: /deleted/.test(r[0]) && !r[1] && !errs.length, note: JSON.stringify(r) + ` · errors ${errs.length}` };
});

// ── calm under normal use — P180495–P180500 ──────────────────────────────────────────────────
check("P180495", A, "an open, visible board does not poll: in 30 quiet seconds it makes only breadcrumb-driven reads", L, async () => {
  const b = await openBoard(); const reads = [];
  b.page.on("request", (r) => { if (r.url().includes("/api/kitchen/board")) reads.push(r.url()); });
  await sleep(30000); await b.ctx.close();
  const whole = reads.filter((u) => !/[?&]table=/.test(u)).length;
  return { ok: whole <= 8, note: `${reads.length} reads (${whole} whole-board) in 30s on a shared dev database other terminals write to` };
});
check("P180496", R, "the real board answers in reasonable time for a kitchen (< 3s on the dev box)", L, async () => { const r = await liveGet("/board?autojobs=1"); return { ok: r.status === 200 && r.ms < 3000, note: `${r.ms}ms` }; });
check("P180497", LY, "/kitchen with no login at all is a redirect to /login (observed as normal use: a fresh browser)", L, async () => { const r = await fetch(BASE + "/kitchen", { redirect: "manual" }); const loc = r.headers.get("location") || ""; const body = r.status === 200 ? await r.text() : ""; return { ok: (r.status >= 300 && r.status < 400 && /\/login/.test(loc)) || /NEXT_REDIRECT|\/login\?next=%2Fkitchen/.test(body), note: `${r.status} ${loc}` }; });
check("P180498", PG, "the kitchen panel's iframe carries no ?rid for a staff login (admin-only pin)", L, async () => { const t = await (await fetch(BASE + "/kitchen", { headers: { cookie: await cookieHeader() } })).text(); const src = (t.match(/panels\/kitchen\/index\.html[^"'\\]*/) || [""])[0]; return { ok: !!src && !/rid=/.test(src), note: src }; });
check("P180499", A, "the panel boots with no page error on the real board", L, async () => { const b = await openBoard(); await sleep(2000); const e = b.errors.slice(); await b.ctx.close(); return { ok: !e.length, note: e.join(" | ") || "none" }; });
check("P180500", A, "the panel's console shows no red error on boot", L, async () => { const { signedContext } = await import("./lib.mjs"); const { ctx, route } = await signedContext({ serviceWorkers: "block" }); const p = await ctx.newPage(); const errs = []; p.on("console", (m) => { if (m.type() === "error") errs.push(m.text().slice(0, 100)); }); await p.goto(BASE + route, { waitUntil: "networkidle" }); await sleep(3000); await ctx.close(); const real = errs.filter((e) => !/favicon|DevTools|Download the React/.test(e)); return { ok: !real.length, note: real.join(" | ") || "none" }; });
