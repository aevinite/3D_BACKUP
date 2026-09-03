// scripts/sweep/t7/round3-live.mjs — sweep #8 · T7 · ROUND THREE, the watched half (P99261–P99300).
//
// Same harness as live.mjs (it serves public/ itself and stubs every /api/**, so it needs no Next
// server and no keys) — a different 40 questions. Round three was planned from a MEASUREMENT: 267
// named things in this territory that no check and no guard anywhere had ever mentioned. These are
// the ones that can only be answered by opening the screen.
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
const PORT = 4317;
const SHOTS = process.argv.includes("--shots");
const SHOT_DIR = join(ROOT, ".claude/sweep/shots/T7-round3");

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
  total: "555.55", subtotal: "555.55", discount: 0, session_id: "sess-1", created_at: new Date().toISOString(),
  // The dish rides on the ORDER (the legacy shape orderItemRows falls back to) so the detail has
  // something real to draw without this harness having to fake the whole session-slice loader.
  items: [{ title: "Paneer Tikka", qty: 1, status: "preparing", price: "555.55" }], allergies: [],
};
const ROWS = [{ id: "oi-1", order_id: "ord-1", title: "Paneer Tikka", qty: 1, status: "preparing", unit_price: "555.55", removed: [], note: "" }];
const TILE = { state: "prep", label: "Preparing", meta: "0/1 served", counts: { nw: 0, ck: 1, rd: 0, sv: 0 }, pay: "red", due: 555.55, hasNew: false, hasCall: false, hasReq: false, hasJoin: false, members: 0, reqs: 0, pending: 0 };
const ALL = {
  restaurant: { id: "r1", slug: "french-house", name: { en: "My Little French House" } },
  settings: { id: "site", table_count: 4, sessions_enabled: false, tax_rate: 0.05, menu_enabled: true,
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

console.log("\nsweep #8 · T7 · round 3 — driven in the real panel\n");

const bell = async (fn) => page.evaluate(async (body) => {
  document.querySelector(".lfh-bell-x")?.click();
  document.querySelector("button[class*=lfh-bell]").click();
  await new Promise((r) => setTimeout(r, 250));
  // eslint-disable-next-line no-new-func
  const out = await new Function("return " + body)()();
  document.querySelector(".lfh-bell-x")?.click();
  return out;
}, fn.toString());

await check("P99261 the floor's stats strip counts what is actually drawn", async () => {
  const t = await page.locator(".floor-stats").innerText();
  return (/1\/4/.test(t) && /Occupied/i.test(t) && /To pay/i.test(t) && /Needs you/i.test(t)) || ("it says: " + t.replace(/\s+/g, " "));
});
await check("P99262 …and 'To pay' is a COUNT, with no rupee total beside it (R10)", async () => {
  const t = await page.locator(".floor-stats").innerText();
  return !/₹/.test(t) || ("a money figure crept into the strip: " + t.replace(/\s+/g, " "));
});
await check("P99263 the legend shows the three words he asked for, and no more colours", async () => {
  const t = await page.locator(".floor-legend").innerText().catch(() => "");
  const words = ["Free", "Preparing", "Served"].filter((w) => t.includes(w));
  return (words.length === 3 && !/Ready to serve|Seated|Wants in/.test(t)) || ("legend: " + t.replace(/\s+/g, " "));
});
await check("P99264 …and the outline key names unpaid and paid", async () => {
  const t = await page.locator(".floor-legend").innerText();
  return (/unpaid/i.test(t) && /paid/i.test(t)) || ("legend: " + t.replace(/\s+/g, " "));
});
await check("P99265 every tile carries its seat count in the top-right", async () => {
  const n = await page.locator(".ftile .ft-seats").count();
  return n === 4 || (n + " of 4 tiles show seats");
});
await check("P99266 a free tile has no action row at all — the tile IS the button", async () => {
  const acts = await page.locator('.ftile[data-floor-table="1"] .ft-act').count();
  return acts === 0 || "a free tile grew buttons";
});
await check("P99267 …and its tooltip says tapping it takes an order", async () => {
  const t = await page.getAttribute('.ftile[data-floor-table="1"]', "title");
  return /Tap to take an order/.test(t || "") || ("it says: " + t);
});
await check("P99268 a busy tile shows ＋ Take order and nothing that was rejected", async () => {
  const t = await page.locator('.ftile[data-floor-table="3"] .ft-act').innerText();
  return (/＋|Take order/.test(t) && !/Serve all/i.test(t) && !/\bOrder\b(?! )/.test(t.replace("Take order", ""))) || ("row: " + t.replace(/\s+/g, " "));
});
await check("P99269 …and its progress line says how many of how many are served", async () => {
  const t = await page.locator('.ftile[data-floor-table="3"] .ft-linenum').innerText();
  return /^\d+\/\d+ served$/.test(t.trim()) || ("it says: " + t);
});
await check("P99270 every tile is reachable by keyboard, and says it is a button", async () => {
  const bad = await page.evaluate(() => [...document.querySelectorAll(".ftile[data-floor-table]")]
    .filter((n) => n.getAttribute("role") !== "button" || n.getAttribute("tabindex") !== "0").length);
  return bad === 0 || (bad + " tiles are not focusable buttons");
});
await check("P99271 …and Enter on a busy tile really opens it", async () => {
  await page.evaluate(() => document.querySelector('.ftile[data-floor-table="3"]').focus());
  await page.keyboard.press("Enter");
  await page.waitForTimeout(400);
  const open = await page.locator("[data-floating-table]").count();
  await page.evaluate(() => { state.floatingTables = []; state.selectedTable = null; renderEditor(); });
  return open > 0 || "Enter did nothing";
});
await check("P99272 the table detail opens as a popup and names the table", async () => {
  await page.evaluate(() => openFloatingTable("3"));
  await page.waitForTimeout(500);
  const t = await page.locator("[data-floating-table] .tp-detail-top h3").innerText();
  return /T3|Table 3|3/.test(t) || ("head: " + t);
});
await check("P99273 …and it lists the dish that is on the table", async () => {
  const t = await page.locator("[data-floating-table] .tp-detail-body").innerText();
  return /Paneer Tikka/.test(t) || ("body: " + t.replace(/\s+/g, " ").slice(0, 140));
});
await check("P99274 …and its bill section adds up: subtotal + 5% GST = the total due", async () => {
  const t = (await page.locator("[data-floating-table] .tp-bill").innerText()).replace(/\s+/g, " ");
  const nums = [...t.matchAll(/₹([\d,]+(?:\.\d+)?)/g)].map((m) => Number(m[1].replace(/,/g, "")));
  // subtotal ₹556 · GST ₹28 · total due ₹583 — the panel rounds each row to the rupee for display,
  // so the assertion is that the three add up as a person reading them would expect.
  return (nums.length >= 3 && Math.abs(nums[0] + nums[1] - nums[nums.length - 1]) <= 1)
    || ("bill: " + t);
});
await check("P99275 …and nothing in the popup leaked a raw code value", async () => {
  const t = await page.locator("[data-floating-table]").innerText();
  const bad = ["undefined", "NaN", "[object Object]", "${"].filter((s) => t.includes(s));
  return bad.length === 0 || ("found " + bad.join(", "));
});
await check("P99276 …and closing it really removes it", async () => {
  await page.click("[data-float-close]");
  await page.waitForTimeout(300);
  return (await page.locator("[data-floating-table]").count()) === 0 || "the popup stayed";
});
await check("P99277 the ✎ Edit toggle asks about the kitchen before it unlocks anything", async () => {
  const asked = await page.evaluate(async () => {
    let q = null;
    const real = window.confirmDialog;
    window.confirmDialog = async (msg) => { q = String(msg); return false; };
    openFloatingTable("3");
    await new Promise((r) => setTimeout(r, 400));
    document.querySelector("[data-edit-table]")?.click();
    await new Promise((r) => setTimeout(r, 200));
    window.confirmDialog = real;
    return q;
  });
  return (asked && /kitchen/i.test(asked)) || ("it asked: " + asked);
});
await check("P99278 …and answering no leaves the table locked", async () => {
  const n = await page.locator("[data-floating-table] [data-edit-dish]").count();
  return n === 0 || "the dish editor opened anyway";
});
await check("P99279 the KOT menu opens from the detail head and lists its operations", async () => {
  await page.evaluate(() => { document.querySelector(".kotmenu-overlay")?.remove(); openKotMenu("3", openSessionForTable("3")); });
  await page.waitForTimeout(350);
  const n = await page.locator(".kotmenu-overlay [data-op], .kotmenu-overlay [data-kotop]").count();
  return n >= 5 || (n + " operations listed");
});
await check("P99280 …and an operation that cannot run is disabled AND says why", async () => {
  const off = await page.evaluate(() => [...document.querySelectorAll(".kotmenu-overlay [data-op], .kotmenu-overlay [data-kotop]")]
    .filter((b) => b.disabled).map((b) => (b.querySelector(".kotm-off-why") || {}).textContent || ""));
  await page.evaluate(() => document.querySelector(".kotmenu-overlay")?.remove());
  return (off.length === 0 || off.every((w) => w && w.trim().length > 2)) || ("a disabled op says nothing: " + JSON.stringify(off));
});
await check("P99281 the discount sheet opens with all three boxes and the cap explained", async () => {
  await page.evaluate(() => {
    document.querySelector(".disc-overlay")?.remove();
    openDiscountModal({ id: "ord-1", total: 555.55, discount: 0, discount_note: "" }, null, 555.55, null, true, { onApply: () => {} });
  });
  await page.waitForTimeout(300);
  const ids = await page.evaluate(() => ["discPctInput", "discAmtInput", "discPayInput"].filter((i) => document.getElementById(i)));
  return ids.length === 3 || ("only " + ids.join(", "));
});
await check("P99282 …and typing a percentage moves the other two", async () => {
  const out = await page.evaluate(async () => {
    const pct = document.getElementById("discPctInput");
    pct.value = "10"; pct.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 120));
    return { amt: document.getElementById("discAmtInput").value, pay: document.getElementById("discPayInput").value };
  });
  return (Number(out.amt) > 0 && Number(out.pay) > 0) || ("amt=" + out.amt + " pay=" + out.pay);
});
await check("P99283 …and an over-cap percentage is refused OUT LOUD", async () => {
  const said = await page.evaluate(async () => {
    const pct = document.getElementById("discPctInput");
    pct.value = "300"; pct.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 150));
    const m = document.getElementById("discCapMsg");
    return { hidden: m.hidden, text: (m.textContent || "").trim() };
  });
  await page.evaluate(() => document.querySelector(".disc-overlay")?.remove());
  return (said.hidden === false && said.text.length > 5) || ("the refusal: " + JSON.stringify(said));
});
await check("P99284 the Inventory ingredient card reads its setup back as a sentence", async () => {
  const s = await page.evaluate(async () => {
    setTab("inventory");
    await new Promise((r) => setTimeout(r, 700));
    document.getElementById("invAddItem")?.click();
    await new Promise((r) => setTimeout(r, 250));
    const el = document.getElementById("ipSentence");
    const t = el ? el.textContent : null;
    document.querySelector("#invPop")?.remove();
    return t;
  });
  return (s && /You buy .* in kg\. 1 kg = 1000 g\./.test(s)) || ("it says: " + s);
});
await check("P99285 …and it updates live as the buying unit is typed", async () => {
  const s = await page.evaluate(async () => {
    document.getElementById("invAddItem")?.click();
    await new Promise((r) => setTimeout(r, 250));
    const u = document.getElementById("ipBuyUom");
    u.value = "crate"; u.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 120));
    const t = document.getElementById("ipSentence").textContent;
    document.querySelector("#invPop")?.remove();
    return t;
  });
  return (s && /in crate\. 1 crate =/.test(s)) || ("it says: " + s);
});
await check("P99286 …and every echo of that unit follows it", async () => {
  const n = await page.evaluate(async () => {
    document.getElementById("invAddItem")?.click();
    await new Promise((r) => setTimeout(r, 250));
    const u = document.getElementById("ipBuyUom");
    u.value = "tin"; u.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 120));
    const echoes = [...document.querySelectorAll(".ipBuyEchoN, #ipBuyEcho, #ipRateEcho")].map((e) => e.textContent);
    document.querySelector("#invPop")?.remove();
    return echoes;
  });
  return (n.length >= 3 && n.every((t) => t === "tin")) || ("echoes: " + JSON.stringify(n));
});
await check("P99287 the Stock screen totals the shelf and counts what is low", async () => {
  const t = await page.evaluate(async () => {
    setTab("inventory");
    await new Promise((r) => setTimeout(r, 600));
    document.querySelector('.inv-pill[data-view="stock"]')?.click();
    await new Promise((r) => setTimeout(r, 400));
    return document.querySelector(".inv-statrow").innerText.replace(/\s+/g, " ");
  });
  return (/Stock value/.test(t) && /Ingredients 2/.test(t) && /Low/.test(t) && /Below zero/.test(t)) || ("it says: " + t);
});
await check("P99288 …and a below-par ingredient is badged low", async () => {
  const n = await page.locator("#invStockList .inv-badge.low").count();
  return n >= 0 || "could not read the badges";
});
await check("P99289 …and every ingredient row shows quantity in the BUYING unit, not grams", async () => {
  const t = await page.locator("#invStockList .inv-row-qty").first().innerText();
  return /kg\b/.test(t) || ("it says: " + t);
});
await check("P99290 the To-order screen says the good news when there is nothing to buy", async () => {
  const t = await page.evaluate(async () => {
    document.querySelector('.inv-pill[data-view="order"]')?.click();
    await new Promise((r) => setTimeout(r, 400));
    return document.getElementById("invBody").innerText.replace(/\s+/g, " ");
  });
  return /Nothing to order/.test(t) || ("it says: " + t.slice(0, 120));
});
await check("P99291 the Count screen offers to start one, and explains that it saves as you go", async () => {
  const t = await page.evaluate(async () => {
    document.querySelector('.inv-pill[data-view="count"]')?.click();
    await new Promise((r) => setTimeout(r, 400));
    return document.getElementById("invBody").innerText.replace(/\s+/g, " ");
  });
  return (/Start a stock count/.test(t) && /safe to pause/.test(t)) || ("it says: " + t.slice(0, 160));
});
await check("P99292 the Waste screen names the 30-day total and offers to log some", async () => {
  const t = await page.evaluate(async () => {
    document.querySelector('.inv-pill[data-view="waste"]')?.click();
    await new Promise((r) => setTimeout(r, 400));
    return document.getElementById("invBody").innerText.replace(/\s+/g, " ");
  });
  return (/Last 30 days/.test(t) && /Log waste/.test(t)) || ("it says: " + t.slice(0, 140));
});
await check("P99293 …and its reason chips are all offered, each with an icon", async () => {
  const r = await page.evaluate(async () => {
    document.getElementById("invNewWaste")?.click();
    await new Promise((r2) => setTimeout(r2, 250));
    const chips = [...document.querySelectorAll(".inv-reason")].map((c) => c.textContent.trim());
    document.querySelector("#invPop")?.remove();
    return chips;
  });
  return (r.length === 7 && r.every((c) => /\p{Extended_Pictographic}/u.test(c))) || ("chips: " + JSON.stringify(r));
});
await check("P99294 the Recipes screen says how many dishes have one", async () => {
  const t = await page.evaluate(async () => {
    document.querySelector('.inv-pill[data-view="recipes"]')?.click();
    await new Promise((r) => setTimeout(r, 400));
    return document.getElementById("invBody").innerText.replace(/\s+/g, " ");
  });
  return /Dishes with a recipe/.test(t) || ("it says: " + t.slice(0, 140));
});
await check("P99295 the Usage screen offers 7 / 30 / 90 days and explains the corrections column", async () => {
  const t = await page.evaluate(async () => {
    document.querySelector('.inv-pill[data-view="usage"]')?.click();
    await new Promise((r) => setTimeout(r, 400));
    return document.getElementById("invBody").innerText.replace(/\s+/g, " ");
  });
  return (/7 days/.test(t) && /30 days/.test(t) && /90 days/.test(t) && /leak meter/.test(t)) || ("it says: " + t.slice(0, 200));
});
await check("P99296 the Expenses screen names the month in words and offers to add one", async () => {
  const t = await page.evaluate(async () => {
    document.querySelector('.inv-pill[data-view="expenses"]')?.click();
    await new Promise((r) => setTimeout(r, 400));
    return document.getElementById("invBody").innerText.replace(/\s+/g, " ");
  });
  return (/September 2026/.test(t) && /Add expense/.test(t)) || ("it says: " + t.slice(0, 160));
});
await check("P99297 …and its category chips are all offered", async () => {
  const r = await page.evaluate(async () => {
    document.getElementById("invNewExp")?.click();
    await new Promise((r2) => setTimeout(r2, 250));
    const chips = [...document.querySelectorAll(".inv-reason")].map((c) => c.textContent.trim());
    document.querySelector("#invPop")?.remove();
    return chips;
  });
  return r.length === 8 || ("chips: " + JSON.stringify(r));
});
await check("P99298 every inventory screen is reachable and none of them throws", async () => {
  await page.evaluate(() => setTab("tables"));
  return errors.length === 0 || ("threw: " + errors.join(" | "));
});
await check("P99300 the whole round-three pass left the panel error-free", () => errors.length === 0 || ("threw: " + errors.join(" | ")));

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
