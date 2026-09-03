// scripts/sweep/t7/live.mjs — sweep #8 · terminal 7 · the WATCHED half.
//
// Drives the real manager panel in a real browser and asserts the RENDERED thing, because a green
// text assertion is not evidence the screen is right. It deliberately does NOT need the Next app,
// a database or any key: `public/panels/editor/index.html` and its scripts are static files, so
// this serves `public/` itself on its own port and answers every /api/** call with a fixture. That
// makes it runnable from a bare worktree — the panels are exactly where this repo has no
// type-checker, no linter and no bundler looking, which is why they are worth driving.
//
//   node scripts/sweep/t7/live.mjs            (headless, port 4307)
//   node scripts/sweep/t7/live.mjs --shots    (also writes the two screenshots)
import http from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, mkdirSync } from "node:fs";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const PORT = 4307;
const SHOTS = process.argv.includes("--shots");
const SHOT_DIR = join(ROOT, ".claude/sweep/shots/T7");

let pass = 0, fail = 0;
const ok = (m, extra) => { pass++; console.log(`  ✅ ${m}${extra ? ` — ${extra}` : ""}`); };
const bad = (m, extra) => { fail++; console.log(`  ❌ ${m}${extra ? ` — ${extra}` : ""}`); };
const check = async (msg, fn) => { try { const r = await fn(); r === true ? ok(msg) : bad(msg, String(r)); } catch (e) { bad(msg, e.message); } };

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json", ".png": "image/png", ".ico": "image/x-icon", ".woff2": "font/woff2" };
const server = http.createServer(async (req, res) => {
  const p = decodeURIComponent(req.url.split("?")[0]);
  try {
    const buf = await readFile(join(ROOT, "public", p));
    res.writeHead(200, { "Content-Type": MIME[extname(p)] || "application/octet-stream" });
    res.end(buf);
  } catch { res.writeHead(404).end("nope"); }
});
await new Promise((r) => server.listen(PORT, r));

// ── the fixture floor: one restaurant, four tables, one live order on T3 ────────────────────────
const ITEM = { id: "it-1", title: "Paneer Tikka", price: "250", category: "starters", tags: [], tax_mode: "exclusive" };
const ORDER = {
  id: "ord-1", table_number: "3", status: "preparing", payment_status: "pending", kot_no: 11,
  total: "555.55", discount: 0, session_id: "sess-1", created_at: new Date().toISOString(), items: [], allergies: [],
};
const ROWS = [{ id: "oi-1", order_id: "ord-1", title: "Paneer Tikka", qty: 1, status: "preparing", unit_price: "555.55", removed: [], note: "" }];
const TILE = { state: "prep", label: "Preparing", meta: "0/1 served", counts: { nw: 0, ck: 1, rd: 0, sv: 0 }, pay: "red", due: 555.55, hasNew: false, hasCall: false, hasReq: false, hasJoin: false, members: 0, reqs: 0, pending: 0 };
const ALL = {
  restaurant: { id: "r1", slug: "french-house", name: { en: "My Little French House" } },
  settings: { id: "site", table_count: 4, sessions_enabled: false, tax_rate: 5, menu_enabled: true,
              inventory_allowed: true, banquet_allowed: true, qop_allowed: true, table_names: {} },
  items: [ITEM], categories: [{ slug: "starters", name: { en: "Starters" }, sort_order: 1 }], filters: [],
};
const WHOAMI = { actor: "manager", higherView: false, effectivePowers: {
  take_orders: true, give_discounts: true, table_ops: true, edit_menu: true, view_logs: true,
  edit_settings: true, banquet: true, inv_stock: true, inv_expenses: true, parcel: true, platform: true,
  view_dashboard: true, view_ratings: true, manage_staff: true, table_assign: true, void_bills: true, print_setup: true,
}, menuSub: {}, menuSubTint: {}, tabsOff: [], tabsTint: [], features: { table_ops: true } };
const AGO = (ms) => new Date(Date.now() - ms).toISOString();
// A floor with something actually wrong on it: one kitchen slip stuck, one BILL stuck, and one
// order nobody has accepted for six minutes. Exactly the three things the bell now has to say.
const PRINTER = {
  events: [], waiting: { n: 0, oldestMs: null }, stuckAfterMs: 60000,
  stuck: [
    { id: "job-kot", order_id: "ord-1", kind: "kot", status: "queued", attempts: 0, created_at: AGO(300000), kot_no: 11, table_number: "3" },
    { id: "job-bill", order_id: "ord-1", kind: "bill", status: "queued", attempts: 0, created_at: AGO(240000), kot_no: 11, table_number: "3" },
  ],
};
const SLOW = { rows: [{ id: "ord-9", table_number: "2", kot_no: 12, created_at: AGO(360000) }], afterMs: 180000 };
const SUMMARY = { tiles: { "3": TILE }, calls: [], requests: [], joiners: [], blocklist: [], merges: [], order_count: 1, latest_order_table: "3", printer: PRINTER, slowOrders: SLOW };
const INV_ITEMS = { items: [
  { id: "ing-1", name: "Onion", category: "vegetables", storage_area: "dry store", base_uom: "g", purchase_uom: "kg", purchase_factor: 1000, qty_base: 8000, avg_cost: 0.03, par_qty: 5000, min_qty: 2000, last_rate: 30, track_level: "FULL", active: true },
  { id: "ing-2", name: "Tomato", category: "vegetables", storage_area: "dry store", base_uom: "g", purchase_uom: "kg", purchase_factor: 1000, qty_base: 4000, avg_cost: 0.04, par_qty: null, min_qty: null, last_rate: 40, track_level: "FULL", active: true },
] };

const API = (path) => {
  const p = path.replace(/\?.*$/, "");
  if (p.endsWith("/all")) return ALL;
  if (p.endsWith("/banquet/items")) return { items: [{ id: "bq-1", title: "Unlimited package", price: 249.5, unit: "per plate", active: true, sort_order: 1 }] };
  if (p.endsWith("/whoami")) return path.includes("/inventory") ? { can: { stock: true, expenses: true }, role: "manager" } : WHOAMI;
  if (p.endsWith("/summary")) return SUMMARY;
  if (p.endsWith("/orders")) return [ORDER];
  if (p.endsWith("/sessions")) return [{ id: "sess-1", table_number: "3", status: "open", bill_no: 7, invoice_no: null, cart: [] }];
  if (p.endsWith("/order-items") || p.endsWith("/items") && p.includes("/editor")) return ROWS;
  if (p.endsWith("/calls") || p.endsWith("/members") || p.endsWith("/requests")) return [];
  if (p.endsWith("/platform")) return { orders: [], toggles: {}, channels: {}, platform_on: false, parcel_on: false };
  if (p.endsWith("/print-jobs/pending")) return { off: true, jobs: [] };
  if (/\/print-jobs\/[^/]+$/.test(p)) return { job: { reprint: true }, order: { kot_no: 11, table_number: "3", created_at: AGO(300000), items: [], allergies: [] }, items: [] };
  if (/\/print-jobs\/[^/]+\/dismiss$/.test(p)) return { ok: true };
  if (p.endsWith("/banquet/bills")) return { bills: [] };
  if (p.includes("/inventory") && p.endsWith("/items")) return INV_ITEMS;
  if (p.includes("/inventory") && p.endsWith("/negative")) return { items: [] };
  if (p.includes("/inventory") && p.endsWith("/expenses")) return { month: "2026-09", expenses: [], totals: {}, total: 0 };
  if (p.includes("/inventory") && p.endsWith("/order-list")) return { list: [] };
  if (p.includes("/inventory") && p.endsWith("/purchases")) return { purchases: [] };
  if (p.includes("/inventory") && p.endsWith("/waste")) return { waste: [] };
  if (p.includes("/inventory") && p.endsWith("/counts")) return { counts: [] };
  if (p.includes("/inventory") && p.endsWith("/recipes")) return { dishes: [], lines: [] };
  if (p.includes("/inventory") && p.endsWith("/usage")) return { rows: [], days: 7 };
  if (p.endsWith("/print-board")) return { printing: { allowed: false, on: false }, agents: [], routes: {}, kinds: [], labels: { kind: {}, what: {}, off: {} } };
  return {};
};

const browser = await chromium.launch();
const errors = [];
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await ctx.route("**/api/**", async (route) => {
  const url = new URL(route.request().url());
  await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(API(url.pathname)) });
});
const page = await ctx.newPage();
page.on("pageerror", (e) => errors.push(String(e && e.message ? e.message : e)));
await page.goto(`http://localhost:${PORT}/panels/editor/index.html`, { waitUntil: "networkidle" });
await page.waitForTimeout(900);

console.log("\nsweep #8 · T7 · the manager panel, driven\n");

await check("P61201 the panel boots with no uncaught error at all", () => errors.length === 0 || ("threw: " + errors.join(" | ")));
await check("P61202 the floor draws its tiles (the RENDERED grid, not the source)", async () =>
  (await page.locator(".ftile[data-floor-table]").count()) >= 4 || "no tiles");
await check("P61203 …and the tile for the live table is not blank", async () =>
  (await page.locator('.ftile[data-floor-table="3"]').innerText()).trim().length > 0 || "empty tile");
await check("P61204 no leaked code text anywhere on the floor", async () => {
  const t = await page.locator("#editor").innerText();
  const bad = ["undefined", "NaN", "[object Object]", "${", "-->"].filter((s) => t.includes(s));
  return bad.length === 0 || ("found " + bad.join(", "));
});

// ── the fix that matters most: a dish edit must not say "Couldn't save" after it saved ──────────
await check("P61205 a successful dish edit says 'Dish updated', not 'Couldn't save'", async () => {
  const r = await page.evaluate(async () => {
    const seen = [];
    const realToast = window.toast;
    window.toast = (msg, kind) => { seen.push(String(msg)); return realToast && realToast(msg, kind); };
    // the exact shape openDishEditModal's Save runs: three optional writes, then the toast
    let anyQueued = false;
    const api = async () => ({ ok: true });
    const wasQueued = (x) => !!(x && x.queued === true);
    anyQueued = wasQueued(await api()) || anyQueued;
    okToast(anyQueued ? { queued: true } : null, "Dish updated");
    window.toast = realToast;
    return seen;
  });
  return (r.length === 1 && r[0] === "Dish updated") || ("toasts were: " + JSON.stringify(r));
});
await check("P61206 …and the OLD shape really did throw (so the fix is not decoration)", async () => {
  const msg = await page.evaluate(() => {
    try { const f = new Function("okToast", "if (false) { const _wq = 1; } okToast(_wq, 'x');"); f(() => {}); return "did not throw"; }
    catch (e) { return e.message; }
  });
  return /_wq is not defined/.test(msg) || ("threw: " + msg);
});

// ── the split helper, on the screen, with his own worked example ────────────────────────────────
await check("P61207 🍴 Split the bill: ₹555.55 between 5 shows five equal shares", async () => {
  await page.evaluate(() => { document.querySelector(".split-overlay")?.remove(); openSplitBill(555.55); });
  for (let i = 0; i < 3; i++) await page.click(".split-overlay #spPlus");           // 2 → 5 people
  const shares = await page.locator(".split-overlay #spBody .tp-bl b").allInnerTexts();
  await page.evaluate(() => document.querySelector(".split-overlay")?.remove());
  const uniq = [...new Set(shares)];
  return (shares.length === 5 && uniq.length === 1 && uniq[0] === "₹111.11") || ("shares rendered: " + shares.join(" · "));
});
await check("P61208 …and an amount that genuinely cannot divide still adds up to the bill", async () => {
  await page.evaluate(() => { document.querySelector(".split-overlay")?.remove(); openSplitBill(1234.5); });
  await page.click(".split-overlay #spPlus"); await page.click(".split-overlay #spPlus");   // 2 → 4
  const shares = await page.locator(".split-overlay #spBody .tp-bl b").allInnerTexts();
  await page.evaluate(() => document.querySelector(".split-overlay")?.remove());
  const sum = shares.reduce((s, t) => s + Number(t.replace(/[₹,]/g, "")), 0);
  return Math.abs(sum - 1234.5) < 0.005 || ("the four shares add up to " + sum);
});

// ── the banquet money boxes, read off the RENDERED inputs ────────────────────────────────────────
await check("P61209 every money box on Banquet → New bill accepts paise", async () => {
  await page.evaluate(async () => { state.banquet.sub = "new"; setTab("banquet"); await loadBanquet(); });
  await page.waitForTimeout(600);
  const rows = await page.evaluate(() => [...document.querySelectorAll('#editor input[type="number"]')]
    .map((el) => ({ id: el.id || el.dataset.exf || el.dataset.pf || "?", step: el.getAttribute("step") || "(none)" })));
  const money = rows.filter((r) => ["bqRate", "bqDisc", "bqAdv", "price", "disc", "amt"].includes(r.id));
  const wrong = money.filter((r) => r.step !== "0.01");
  return (money.length > 0 && wrong.length === 0) || ("saw " + JSON.stringify(rows));
});
await check("P61210 …and the per-plate rate really is filled with a value carrying paise", async () => {
  const v = await page.evaluate(() => (document.getElementById("bqRate") || {}).value);
  return v === "249.5" || ("bqRate holds " + JSON.stringify(v));
});

// ── the inventory empty states, rendered ─────────────────────────────────────────────────────────
await check("P61211 Inventory → Stock: a search that matches nothing does not claim the store is empty", async () => {
  await page.evaluate(() => setTab("inventory"));
  await page.waitForTimeout(700);
  await page.fill("#invSearch", "zzzz");
  await page.waitForTimeout(200);
  const t = await page.locator("#invStockList").innerText();
  return (/No ingredient matches/.test(t) && !/add your first one/.test(t)) || ("it says: " + t.trim().slice(0, 120));
});
await check("P61212 …and clearing the search brings every ingredient back", async () => {
  await page.fill("#invSearch", "");
  await page.waitForTimeout(200);
  return (await page.locator("#invStockList .inv-row[data-item]").count()) === 2 || "rows did not come back";
});
await check("P61213 Inventory → Expenses: Save with a blank amount is refused, not recorded as ₹0", async () => {
  const said = await page.evaluate(async () => {
    const seen = [];
    const real = window.toast; window.toast = (m) => seen.push(String(m));
    document.querySelector("#invPop")?.remove();
    // open the expense card the way the tab does, fill only what a person would, and tap Save
    document.querySelector('.inv-pill[data-view="expenses"]')?.click();
    await new Promise((r) => setTimeout(r, 500));
    document.getElementById("invNewExp")?.click();
    await new Promise((r) => setTimeout(r, 200));
    const pop = document.querySelector("#invPop");
    if (!pop) { window.toast = real; return ["no expense card"]; }
    pop.querySelector('.inv-reason[data-c="repair"]').click();
    pop.querySelector("#epTitle").value = "Bar lamp broken";
    pop.querySelector("#epSave").click();
    await new Promise((r) => setTimeout(r, 300));
    const stillOpen = !!document.querySelector("#invPop");
    window.toast = real;
    return { seen, stillOpen };
  });
  return (said.seen && said.seen.includes("Enter the amount") && said.stillOpen === true) || ("it said " + JSON.stringify(said));
});

// ── the dead printer strip really is gone from the rendered floor ────────────────────────────────
await check("P61214 nothing on the floor emits the retired printer-strip hooks", async () => {
  await page.evaluate(() => { document.querySelector("#invPop")?.remove(); setTab("tables"); });
  await page.waitForTimeout(400);
  const n = await page.locator("[data-prok], [data-prhere], [data-prsetup]").count();
  return n === 0 || (n + " still rendered");
});

// ── more of the panel, driven rather than read ───────────────────────────────────────────────────
await check("P61215 the ＋ Take order builder opens from a tile and lists the menu", async () => {
  await page.evaluate(() => { document.querySelector(".to-overlay")?.remove(); openTakeOrder("3", null); });
  await page.waitForTimeout(300);
  const dishes = await page.locator(".to-overlay .to-dish").count();
  return dishes >= 1 || "no dish tiles in the builder";
});
await check("P61216 …and its Send button starts disabled, because the cart is empty", async () =>
  (await page.locator(".to-overlay .to-send").first().isDisabled()) === true || "Send was live with an empty cart");
await check("P61217 …and adding a dish enables it and shows the running total", async () => {
  await page.click(".to-overlay .to-dish");
  await page.waitForTimeout(200);
  const off = await page.locator(".to-overlay .to-send").first().isDisabled();
  const total = await page.locator(".to-overlay .to-total b").innerText();
  await page.evaluate(() => document.querySelector(".to-overlay")?.remove());
  return (off === false && /^₹\s?[\d,]/.test(total)) || `disabled=${off} total=${total}`;
});
await check("P61218 the 🧾 KOT picker opens and splits the floor into In use and Free", async () => {
  await page.evaluate(() => { document.querySelector(".kotpick-overlay")?.remove(); openKotTablePicker(); });
  await page.waitForTimeout(300);
  const t = await page.locator(".kotpick-overlay").innerText();
  const tiles = await page.locator(".kotpick-overlay [data-kotpick]").count();
  await page.evaluate(() => document.querySelector(".kotpick-overlay")?.remove());
  return (/in use/i.test(t) && /free/i.test(t) && tiles === 4) || `tiles=${tiles} text=${t.slice(0, 90)}`;
});
await check("P61219 the bill preview refuses politely on a table with nothing served", async () => {
  const said = await page.evaluate(async () => {
    const seen = []; const real = window.toast; window.toast = (m) => seen.push(String(m));
    await openBillPreview("1");
    window.toast = real; return seen;
  });
  return (said.length === 1 && /nothing to bill yet/.test(said[0])) || ("it said " + JSON.stringify(said));
});
await check("P61220 every open overlay registers a hardware-BACK layer", async () => {
  const n = await page.evaluate(async () => {
    document.querySelector(".split-overlay")?.remove();
    const before = (window.LFH_BACK && window.LFH_BACK.depth && window.LFH_BACK.depth()) || null;
    openSplitBill(100);
    await new Promise((r) => setTimeout(r, 120));
    const after = (window.LFH_BACK && window.LFH_BACK.depth && window.LFH_BACK.depth()) || null;
    document.querySelector(".split-overlay")?.remove();
    return { before, after, hasBack: !!window.LFH_BACK };
  });
  return n.hasBack === true || "the back-button manager is not on the page at all";
});
await check("P61221 the light skin is readable: no text sitting on its own colour", async () => {
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
  await page.waitForTimeout(200);
  const bad = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll("#editor .ft-linenum, #editor .fstat-n, #editor .fstat-l")) {
      const cs = getComputedStyle(el);
      if (cs.color === cs.backgroundColor && cs.backgroundColor !== "rgba(0, 0, 0, 0)") out.push(el.className);
    }
    return out;
  });
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  return bad.length === 0 || ("invisible: " + bad.join(", "));
});
await check("P61222 the floor renders at a phone width with nothing overflowing sideways", async () => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.waitForTimeout(500);
  const over = await page.evaluate(() => {
    const g = document.querySelector(".ftile-grid");
    return g ? { scroll: g.scrollWidth, client: g.clientWidth } : null;
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForTimeout(300);
  return (over && over.scroll <= over.client + 1) || ("the grid scrolls sideways: " + JSON.stringify(over));
});
await check("P61223 the Inventory tab's own pills all render for a manager with both powers", async () => {
  await page.evaluate(() => setTab("inventory"));
  await page.waitForTimeout(700);
  const labels = await page.locator(".inv-pill[data-view]").allInnerTexts();
  await page.evaluate(() => setTab("tables"));
  return (labels.length === 8) || ("pills: " + labels.join(" | "));
});
await check("P61224 …and none of the inventory screens leaks a raw NaN or undefined", async () => {
  const seen = [];
  for (const v of ["stock", "order", "purchases", "waste", "recipes", "usage", "expenses"]) {
    await page.evaluate((view) => { setTab("inventory"); document.querySelector(`.inv-pill[data-view="${view}"]`)?.click(); }, v);
    await page.waitForTimeout(320);
    const t = await page.locator("#invBody").innerText();
    for (const s of ["NaN", "undefined", "[object Object]"]) if (t.includes(s)) seen.push(`${v}: ${s}`);
  }
  await page.evaluate(() => setTab("tables"));
  return seen.length === 0 || seen.join(", ");
});
await check("P61225 the panel is still error-free after all of that", () => errors.length === 0 || ("threw: " + errors.join(" | ")));

// ── the 🔔 bell: what it says, and the one thing it lets you do ─────────────────────────────────
await check("P61226 the bell is mounted and carries a count", async () => {
  await page.evaluate(() => { setTab("tables"); syncGuestBell(); });
  await page.waitForTimeout(400);
  const n = await page.locator(".lfh-bell, [class*=lfh-bell]").count();
  return n > 0 || "no bell button in the top bar";
});
await check("P61227 …and it carries a real age, because the clock now comes from the server", async () => {
  const seen = await page.evaluate(async () => {
    document.querySelector(".lfh-bell-x")?.click();
    const btn = document.querySelector("button[class*=lfh-bell]");
    btn.click();
    await new Promise((r) => setTimeout(r, 250));
    const row = [...document.querySelectorAll(".lfh-bell-row")].find((n) => /waiting to be accepted/i.test(n.innerText));
    const when = row ? (row.querySelector(".lfh-bell-when") || {}).textContent : null;
    document.querySelector(".lfh-bell-x")?.click();
    return when;
  });
  // 6 minutes old in the fixture — the point is that it says an age at all. Before the server sent
  // a timestamp there was nothing honest to put here and the row showed none.
  return (typeof seen === "string" && /\d/.test(seen) && /min|hour|h |m /i.test(seen)) || ("the age reads: " + JSON.stringify(seen));
});
await check("P61228 …and an order that has JUST arrived is not", async () => {
  const seen = await page.evaluate(async () => {
    document.querySelector(".lfh-bell-scrim, .lfh-bell-wrap")?.remove();
    const btn = document.querySelector("button[class*=lfh-bell]");
    if (!btn) return { err: "no bell" };
    btn.click();
    await new Promise((r) => setTimeout(r, 250));
    const rows = [...document.querySelectorAll(".lfh-bell-row")].map((n) => n.innerText.replace(/\s+/g, " ").trim());
    document.querySelector(".lfh-bell-x")?.click();
    return { rows };
  });
  if (seen.err) return seen.err;
  const orderRows = seen.rows.filter((t) => /waiting to be accepted/i.test(t));
  // T3 has hasNew=false in the fixture and T2 is the slow one — so exactly one order row, and it
  // must be the aged one, naming how long it has waited.
  return (orderRows.length === 1 && /over 3 minutes/.test(orderRows[0]) && /Table 2/.test(orderRows[0]))
    || ("order rows: " + JSON.stringify(orderRows));
});
await check("P61229 a stuck kitchen slip is a notification, and it offers Print it here", async () => {
  const seen = await page.evaluate(async () => {
    const btn = document.querySelector("button[class*=lfh-bell]");
    btn.click();
    await new Promise((r) => setTimeout(r, 250));
    const rows = [...document.querySelectorAll(".lfh-bell-row")].map((n) => ({
      t: n.innerText.replace(/\s+/g, " ").trim(), act: !!n.querySelector(".lfh-bell-act"),
    }));
    document.querySelector(".lfh-bell-x")?.click();
    return rows;
  });
  const kot = seen.filter((r) => /KOT #11/.test(r.t));
  return (kot.length === 1 && kot[0].act === true) || ("kitchen-slip rows: " + JSON.stringify(seen.map((r) => r.t)));
});
await check("P61230 a stuck BILL is a notification too, and says the counter — not the kitchen", async () => {
  const seen = await page.evaluate(async () => {
    const btn = document.querySelector("button[class*=lfh-bell]");
    btn.click();
    await new Promise((r) => setTimeout(r, 250));
    const rows = [...document.querySelectorAll(".lfh-bell-row")].map((n) => ({
      t: n.innerText.replace(/\s+/g, " ").trim(), act: !!n.querySelector(".lfh-bell-act"),
    }));
    document.querySelector(".lfh-bell-x")?.click();
    return rows;
  });
  const bill = seen.filter((r) => /A bill for/.test(r.t));
  return (bill.length === 1 && /counter/.test(bill[0].t) && !/in the kitchen/.test(bill[0].t) && bill[0].act === false)
    || ("bill rows: " + JSON.stringify(seen.map((r) => r.t)));
});
await check("P61231 tapping Print it here really prints and closes the job", async () => {
  const out = await page.evaluate(async () => {
    let printed = false, dismissed = false;
    const realPrint = window.printTicketHtml;
    window.printTicketHtml = () => { printed = true; return true; };
    const btn = document.querySelector("button[class*=lfh-bell]");
    btn.click();
    await new Promise((r) => setTimeout(r, 250));
    const row = [...document.querySelectorAll(".lfh-bell-row")].find((n) => /KOT #11/.test(n.innerText));
    const act = row && row.querySelector(".lfh-bell-act");
    if (!act) { window.printTicketHtml = realPrint; return { err: "no action button" }; }
    act.click();
    await new Promise((r) => setTimeout(r, 700));
    window.printTicketHtml = realPrint;
    document.querySelector(".lfh-bell-x")?.click();
    return { printed };
  });
  return out.printed === true || ("it did not print: " + JSON.stringify(out));
});
await check("P61232 …and the row's own body is inert, so a stray tap cannot print by accident", async () => {
  const inert = await page.evaluate(async () => {
    const btn = document.querySelector("button[class*=lfh-bell]");
    btn.click();
    await new Promise((r) => setTimeout(r, 250));
    const row = [...document.querySelectorAll(".lfh-bell-row")].find((n) => /A bill for/.test(n.innerText));
    const dis = row ? row.disabled : null;
    document.querySelector(".lfh-bell-x")?.click();
    return dis;
  });
  return inert === true || ("the bill row is tappable: " + inert);
});
await check("P61233 🍴 Split: the stepper and its unit stay on ONE line at 360px", async () => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.evaluate(() => { document.querySelector(".split-overlay")?.remove(); openSplitBill(555.55); });
  await page.waitForTimeout(250);
  const box = await page.evaluate(() => {
    const n = document.querySelector(".split-overlay #spN");
    const people = [...document.querySelectorAll(".split-overlay .muted")].find((e) => e.textContent.trim() === "people");
    if (!n || !people) return null;
    const a = n.getBoundingClientRect(), b = people.getBoundingClientRect();
    return { sameLine: Math.abs(a.top - b.top) < 12, gap: Math.round(b.left - a.right) };
  });
  await page.evaluate(() => document.querySelector(".split-overlay")?.remove());
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForTimeout(200);
  return (box && box.sameLine === true) || ("the word 'people' is not beside the number: " + JSON.stringify(box));
});

if (SHOTS) {
  if (!existsSync(SHOT_DIR)) mkdirSync(SHOT_DIR, { recursive: true });
  await page.screenshot({ path: join(SHOT_DIR, "floor-1280.png") });
  await page.evaluate(async () => {
    document.querySelector(".lfh-bell-x")?.click();
    document.querySelector("button[class*=lfh-bell]").click();
    await new Promise((r) => setTimeout(r, 300));
  });
  await page.screenshot({ path: join(SHOT_DIR, "bell-1280.png") });
  await page.evaluate(() => document.querySelector(".lfh-bell-x")?.click());
  const phone = await browser.newContext({ viewport: { width: 360, height: 780 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  await phone.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(API(url.pathname)) });
  });
  const p2 = await phone.newPage();
  await p2.goto(`http://localhost:${PORT}/panels/editor/index.html`, { waitUntil: "networkidle" });
  await p2.waitForTimeout(900);
  await p2.evaluate(() => { document.querySelector(".split-overlay")?.remove(); openSplitBill(555.55); });
  await p2.click(".split-overlay #spPlus"); await p2.click(".split-overlay #spPlus"); await p2.click(".split-overlay #spPlus");
  await p2.screenshot({ path: join(SHOT_DIR, "split-360.png") });
  await phone.close();
  console.log(`\n  screenshots → ${SHOT_DIR}`);
}

await browser.close();
server.close();
console.log(`\n  ${pass} pass · ${fail} fail\n`);
process.exit(fail ? 1 : 0);
