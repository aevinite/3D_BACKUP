// scripts/sweep/t12r3/f-world.mjs — THE FIXTURE WORLD: the waiter tablet against a server the test owns.
//
// The real panel files (index.html, app.js, the shared /panels/*.js helpers) are served by the app as
// usual. Every DATA request they make — /api/tablet/*, and the shared helpers' /api/* — is answered
// HERE, from a model the check builds, and recorded. The service worker is blocked so nothing can
// answer from a saved copy, and realtime gets no address so nothing reaches the database's socket.
//
// So a check can build any restaurant (0 tables, 300, sections, merged parties, every bill state) and
// any server behaviour (a refusal, a clash, a 5xx, a hang, a blocked device) in one line — and NOTHING
// is written anywhere, which is also what makes a mutation run (mutate.mjs) safe to do hundreds of
// times. The model starts from REAL answers recorded off the app (f-record.mjs → fixtures/), so the
// shapes are the server's, not a guess.
//
//   const w = makeWorld();                       // French House as recorded
//   w.answer("POST", /^\/orders\/[^/]+\/accept/, { status: 409, body: { clash: {...} } });
//   const { page } = await openWorld(w);         // the panel, booted, floor drawn
//   w.sent("POST", /\/orders\//)                 // what the panel asked for, in order
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { browser } from "../t12s10/lib.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const BASE = (() => { const i = process.argv.indexOf("--base"); return (i > 0 && process.argv[i + 1]) || process.env.T12_BASE || "http://localhost:4412"; })();
const FX = Object.fromEntries(readdirSync(join(HERE, "fixtures")).filter((f) => f.endsWith(".json"))
  .map((f) => [f.replace(/\.json$/, ""), JSON.parse(readFileSync(join(HERE, "fixtures", f), "utf8")).body]));
export const fx = (k) => structuredClone(FX[k]);
export const EMPTY_SLICE = () => ({ sessions: [], members: [], calls: [], orders: [], items: [], requests: [] });

export function makeWorld() {
  const w = {
    summary: fx("summary"),
    slices: { "1": fx("state_table_1"), "2": fx("state_table_2"), "6": fx("state_table_6") },
    whoami: fx("whoami"),
    profile: fx("api_panel-profile"),
    menuSig: fx("menu-sig"),
    khata: fx("khata_customers"),
    banquet: fx("banquet-items"),
    maintenance: { maintenance: false },
    recognize: { match: null },
    log: [],            // every request the page made: { method, path, query, body, headers, at }
    errors: [],         // /api/log/client-error reports + page errors + console errors
    unexpected: [],     // an /api/ address the world has no answer for
    overrides: [],      // answer(...) rules, first match wins
    hold: null,         // a Promise every data request waits on (freeze the server)
  };
  /** answer(method, pathRegex, { status, body, delayMs, once, abort, fn(req) }) */
  w.answer = (method, re, a) => { w.overrides.unshift({ method, re, ...a }); return w; };
  w.sent = (method, re) => w.log.filter((r) => (!method || r.method === method) && (!re || re.test(r.path)));
  w.clear = () => { w.log.length = 0; };
  w.table = (n, tile, slice) => { w.summary.tiles[String(n)] = tile; if (slice) w.slices[String(n)] = slice; return w; };
  return w;
}

function defaultAnswer(w, req) {
  const p = req.path, q = req.query;
  if (req.method === "GET") {
    if (p === "/summary") {
      const t = q.get("table");
      if (t != null) {
        const one = {}; for (const x of t.split(",")) if (w.summary.tiles[x]) one[x] = w.summary.tiles[x];
        const s = w.summary; return { tiles: one, order_count: s.order_count, latest_order_table: s.latest_order_table, calls: s.calls, requests: s.requests, joiners: s.joiners, blocklist: s.blocklist, merges: s.merges };
      }
      if (q.get("nomenu") === "1") { const { dishes, categories, ...rest } = w.summary; return rest; }
      return w.summary;
    }
    if (p === "/state") return w.slices[q.get("table")] || EMPTY_SLICE();
    if (p === "/whoami") return w.whoami;
    if (p === "/menu-sig") return w.menuSig;
    if (p === "/khata/customers") return w.khata;
    if (p === "/banquet-items") return w.banquet;
    if (p === "/customer-recognize") return w.recognize;
    if (p === "/customer-search") return w.custSearch || { matches: [], customers: [], results: [] };
    return null;
  }
  return { ok: true };
}

export async function openWorld(w, device = {}, { query = "", wait = true } = {}) {
  const b = await browser();
  const ctx = await b.newContext({
    viewport: { width: device.width || 1194, height: device.height || 834 },
    hasTouch: device.touch !== false, isMobile: !!device.mobile, deviceScaleFactor: device.dpr || 1,
    colorScheme: device.dark ? "dark" : "light", serviceWorkers: "block",
  });
  if (device.offline) await ctx.setOffline(true);
  await ctx.route(/\/api\//, async (route) => {
    const r = route.request();
    const u = new URL(r.url());
    let body = null; try { body = r.postDataJSON(); } catch { body = r.postData(); }
    const isTablet = u.pathname.startsWith("/api/tablet");
    const path = isTablet ? u.pathname.slice("/api/tablet".length) || "/" : u.pathname;
    const req = { method: r.method(), path, query: u.searchParams, body, headers: r.headers(), at: Date.now(), tablet: isTablet };
    w.log.push(req);
    if (w.hold) await w.hold;
    if (isTablet) {
      const o = w.overrides.find((x) => (!x.method || x.method === req.method) && x.re.test(path + (u.search || "")));
      if (o) {
        if (o.once) w.overrides.splice(w.overrides.indexOf(o), 1);
        if (o.delayMs) await new Promise((res) => setTimeout(res, o.delayMs));
        if (o.abort) return route.abort("failed");
        const out = o.fn ? await o.fn(req, w) : { status: o.status || 200, body: o.body, headers: o.headers };
        return route.fulfill({ status: out.status || 200, contentType: "application/json", headers: out.headers || {}, body: JSON.stringify(out.body ?? {}) });
      }
      const d = defaultAnswer(w, req);
      if (d === null) { w.unexpected.push(req.method + " " + path); return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "not in the fixture world" }) }); }
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(d) });
    }
    // The shared helpers' own addresses.
    if (path === "/api/rt-config") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ url: "", anonKey: "", restaurantId: w.summary.restaurant?.id || "" }) });
    if (path === "/api/panel-profile" && req.method === "GET") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(w.profile) });
    if (path === "/api/maintenance") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(w.maintenance) });
    if (path === "/api/admin/act-as") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
    if (path === "/api/log/client-error") { w.errors.push("client-error report: " + JSON.stringify(body).slice(0, 300)); return route.fulfill({ status: 204, body: "" }); }
    w.unexpected.push(req.method + " " + path);
    return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "not in the fixture world" }) });
  });
  // Nothing may reach the database's own socket or any outside host from inside the world.
  await ctx.route(/supabase\.co/, (r) => r.abort("blockedbyclient"));
  const page = await ctx.newPage();
  page.on("pageerror", (e) => w.errors.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|ERR_BLOCKED|net::ERR_FAILED/.test(m.text())) w.errors.push("console: " + m.text().slice(0, 240)); });
  await page.goto(`${BASE}/panels/tablet/index.html${query ? "?" + query.replace(/^\?/, "") : ""}`, { waitUntil: "domcontentloaded" });
  if (wait) await page.waitForFunction(() => typeof state !== "undefined" && state.settingsSettled && typeof TABLET_WHO !== "undefined" && TABLET_WHO, null, { timeout: 30000 });
  return { ctx, page };
}
/** The floor tiles the waiter can see right now: [{ n, label, state }] */
export const tiles = (page) => page.evaluate(() => [...document.querySelectorAll("#floor [data-floor-table], #floor .t-tile, #floor .tile")].map((t) => ({ n: t.dataset.floorTable || t.dataset.table || "", text: t.innerText.replace(/\s+/g, " ").trim() })));

// ── building a restaurant ─────────────────────────────────────────────────────────────────────
let _seq = 0;
const uid = (p) => `${p}${String(++_seq).padStart(4, "0")}-0000-4000-8000-000000000000`.slice(0, 36);
/** An empty floor: every table free, nobody seated, no calls — the start of most checks. */
export function freshWorld(settings = {}) {
  const w = makeWorld();
  w.summary.tiles = {}; w.summary.calls = []; w.summary.requests = []; w.summary.joiners = []; w.summary.merges = []; w.summary.blocklist = [];
  w.summary.order_count = 0; w.summary.latest_order_table = null;
  w.slices = {};
  Object.assign(w.summary.settings, settings);
  return w;
}
const DISH = { id: "mint-melon-juice", title: "Mint Melon Juice", price: 380 };
/**
 * seat(w, n, { orders, members, calls, requests, session, tile }) — a party at table n, its session,
 * every order with its dish rows, and the floor tile that goes with it. An order line is
 * { id, title, price, qty, status, note, removed, added, removedFlag, is_mrp }; an order is
 * { status, payment_status, discount, tip, kot_no, allergies, member_id, items, table, db:false }.
 */
export function seat(w, n, { orders = [], members = [], calls = [], requests = [], session = {}, tile = {} } = {}) {
  const sid = session.id || uid("5e55");
  const now = Date.now();
  const s = { id: sid, table_number: String(n), status: "open", opened_at: new Date(now - 40 * 60e3).toISOString(), closed_at: null, bill_no: 41,
    invoice_no: null, invoice_at: null, invoice_voided: false, discount: 0, discount_note: null, cust_name: null, cust_phone: null, ...session };
  const os = [], items = [];
  orders.forEach((o, k) => {
    const oid = o.id || uid("0rd0");
    const status = o.status || "preparing";
    const lines = (o.items || [DISH]).map((l) => ({ qty: 1, ...l }));
    const sub = lines.reduce((a, l) => a + Number(l.price) * l.qty, 0);
    os.push({ id: oid, created_at: new Date(now - (30 - k) * 60e3).toISOString(), session_id: o.noSession ? null : sid, table_number: String(o.table || n),
      status, payment_status: o.payment_status || "pending", total: o.total ?? Math.round(sub * 1.05 * 100) / 100, discount: o.discount || 0,
      discount_note: null, kot_no: o.kot_no === undefined ? 100 + k : o.kot_no, member_id: o.member_id || null, allergies: o.allergies || [], tip: o.tip || 0,
      items: lines.map((l) => ({ id: l.id || DISH.id, qty: l.qty, note: l.note || null, price: String(l.price), title: l.title, is_mrp: !!l.is_mrp, status: l.status || status, options: l.options || null, removed: l.removed || [], tax_mode: l.tax_mode || (l.is_mrp ? "exempt" : "excl") })),
      taxable_base: sub, nontax_amount: 0, mrp_amount: 0, archived: false, ...(o.extra || {}) });
    if (o.db !== false) lines.forEach((l) => items.push({ id: l.itemId || uid("17e0"), order_id: oid, title: l.title, qty: l.qty, status: l.status || status,
      note: l.note || null, options: l.options || null, removed: l.removed || [], added_allergens: l.added || [], removed_flag: !!l.removedFlag,
      unit_price: Number(l.price), created_at: new Date(now - (30 - k) * 60e3).toISOString(), tax_mode: l.tax_mode || (l.is_mrp ? "exempt" : "excl"), is_mrp: !!l.is_mrp }));
  });
  const mem = members.map((m, i) => ({ id: m.id || uid("3e3b"), session_id: sid, name: m.name || `Guest ${i + 1}`, role: m.role || (i === 0 ? "owner" : "guest"), approved: m.approved !== false, ...m }));
  const cls = calls.map((c) => ({ id: c.id || uid("ca11"), table_number: String(n), note: c.note || "Water", status: "open", created_at: new Date(now - 60e3).toISOString(), ...c }));
  const rqs = requests.map((r) => ({ id: r.id || uid("4e9a"), table_number: String(n), type: r.type || "join", name: r.name || "Asha", status: "pending", ...r }));
  w.slices[String(n)] = { sessions: [s], members: mem, calls: cls, orders: os, items, requests: rqs };
  const live = os.filter((o) => o.status !== "cancelled");
  const unpaid = live.filter((o) => o.payment_status !== "paid");
  const due = Math.round(unpaid.reduce((a, o) => a + Number(o.total) - Number(o.discount) * 1.05, 0) * 100) / 100;
  const cnt = { nw: 0, ck: 0, rd: 0, sv: 0 };
  for (const it of items) { if (it.status === "received") cnt.nw += it.qty; else if (it.status === "preparing") cnt.ck += it.qty; else if (it.status === "ready") cnt.rd += it.qty; else if (it.status === "served") cnt.sv += it.qty; }
  // The server's own precedence (mig 136, mirrored by the panel's patchTileFromSlice): new → ready →
  // prep → "bill" (all served, money owed) → "done" (all served and paid).
  const st = !live.length ? (mem.length ? "seated" : "waiting") : live.some((o) => o.status === "received") ? "new" : cnt.rd ? "ready" : cnt.ck ? "prep" : unpaid.length ? "bill" : "done";
  w.summary.tiles[String(n)] = { due, pay: unpaid.length ? "red" : live.length ? "green" : "", tag: "", meta: live.length ? `${cnt.sv}/${cnt.nw + cnt.ck + cnt.rd + cnt.sv} served · ₹${due} due` : "waiting for guests",
    reqs: rqs.length, calls: cls.length, label: { new: "New order", prep: "Preparing", ready: "Ready to serve", bill: "Served", done: "Cleared", waiting: "Open", seated: "Seated · " + mem.length }[st], state: st,
    counts: { ck: cnt.ck, nw: cnt.nw, rd: cnt.rd, sv: cnt.sv }, hasNew: st === "new", hasReq: rqs.length > 0, hasCall: cls.length > 0, hasJoin: mem.some((m) => !m.approved),
    members: mem.length, pending: 0, ...tile };
  w.summary.calls.push(...cls.map((c) => ({ id: c.id, table_number: c.table_number, note: c.note })));
  return { s, orders: os, items, members: mem, calls: cls, requests: rqs };
}

// ── driving the panel ─────────────────────────────────────────────────────────────────────────
export async function openTable(page, n) {
  await page.evaluate((t) => selectTable(String(t)), String(n));
  await page.waitForFunction((t) => state.table === String(t) && document.querySelector("#panel .detail-pop"), String(n), { timeout: 15000 });
  await page.waitForTimeout(250);
}
/** Tap via the real element (a click, not a function call) so the handler the screen wired is the one that runs. */
export const tap = (page, sel) => page.click(sel, { timeout: 8000 });
export const confirmShown = (page) => page.evaluate(() => !document.getElementById("confirmOverlay").hidden && document.getElementById("confirmText").textContent);
export async function answerConfirm(page, yes) {
  await page.waitForFunction(() => !document.getElementById("confirmOverlay").hidden, null, { timeout: 8000 });
  const text = await page.evaluate(() => document.getElementById("confirmText").textContent);
  await page.click(yes ? "#confirmYes" : "#confirmNo");
  return text;
}
export async function typePin(page, digits) {
  await page.waitForSelector(".pp-in", { timeout: 8000 });
  await page.fill(".pp-in", digits);
  await page.click(".pp-ok");
}
export const toastsNow = (page) => page.evaluate(() => [...document.querySelectorAll("#toasts .toast span")].map((x) => x.textContent));
export const clearToastsNow = (page) => page.evaluate(() => { document.getElementById("toasts").innerHTML = ""; });
export const undoBar = (page) => page.evaluate(() => { const b = document.getElementById("lfh-undobar"); return b && b.classList.contains("show") ? b.innerText.replace(/\s+/g, " ").trim() : null; });
export const tapUndo = (page) => page.click("#lfh-undobar .lfh-undo-btn");
export const waitToast = (page, re, ms = 6000) => page.waitForFunction((src) => [...document.querySelectorAll("#toasts .toast span")].some((x) => new RegExp(src).test(x.textContent)), re.source, { timeout: ms }).then(() => true, () => false);
export const settle = (page, ms = 400) => page.waitForTimeout(ms);
