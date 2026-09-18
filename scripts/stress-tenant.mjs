// stress-tenant.mjs — ONE RESTAURANT'S REAL DAY, driven through the REAL doors.
//
// REWRITTEN 2026-09-18. The first version of this file measured almost nothing, and it is worth
// saying exactly why, because the failure looked like a product failure and was reported as one:
//
//   · It ran as SERVICE ROLE, so RLS — the thing that actually separates 62 restaurants — was
//     switched off for the whole test.
//   · It placed guest orders with `lfh_staff_place_order`, a STAFF rpc. The real online guest
//     order goes through our own route (/api/guest/place-order) so the at-most-once id, the
//     deadline and the busy-backpressure apply. None of that was exercised.
//   · Worst: ALL 30 TABLES of a restaurant polled the same `status=received&limit=3` orders and
//     then raced each other to PATCH those same rows. Thirty writers fighting over three rows is
//     lock contention no restaurant can produce — one kitchen screen accepts an order, not thirty
//     diners. The locks piled up, held their connections, and every other query on the instance
//     starved waiting for one. That is what "the app collapsed at 6 writes/sec" really was.
//
// So this version models the actual building. Per restaurant:
//   1 waiter    — seats tables, takes payment, closes the session. SERIALISED: one waiter does
//                 one thing at a time, which is also what stops the contention above.
//   30 phones   — anon key, the guest's own door: join → browse → cart → order → poll → leave.
//   1 kitchen   — the ONLY writer of order status: board → accept → ready.
//   1 floor     — the manager's board, /api/tablet/summary, on its poll.
//
// WE HONOUR THE APP'S BACKPRESSURE. /api/guest/place-order answers a 502 `server_busy` with a
// jittered Retry-After when the database is unhappy (improvement I10) — a real phone waits that
// long. A rig that ignores it and retries immediately BECOMES the retry storm the feature exists
// to prevent, and then reports the storm as the app's fault. A busy answer is counted apart from
// a failure: the app saying "not now, wait 30s" is the app working.
import { stdout } from "node:process";
import { randomUUID } from "node:crypto";

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf("--" + n); return i >= 0 ? argv[i + 1] : d; };
const URL_ = arg("url");
const SITE = arg("site");
// FROM THE ENVIRONMENT, NOT argv — `ps` shows every command line on the machine, and the panel
// cookie holds sha256(ADMIN_PASSWORD), which the gate accepts as proof by itself. See the note
// beside the spawn in stress-fleet.mjs.
const ANON = process.env.LFH_ANON;
const COOKIE = process.env.LFH_COOKIE;  // admin auth cookie + act-as, built by the orchestrator
if (!ANON || !COOKIE) { console.error("stress-tenant: LFH_ANON / LFH_COOKIE missing from the environment"); process.exit(1); }
const RID = arg("rid");
const SLUG = arg("slug");
const TABLES = Number(arg("tables", "30"));
const DEADLINE = Number(arg("deadline"));
const PHASES = JSON.parse(arg("phases"));
const MENU = JSON.parse(arg("menu"));  // [menu_item.id, ...]
const FILL_MS = Number(arg("fill", "180000"));            // how long the dining room takes to fill
// WHEN THIS RESTAURANT OPENS ITS DOORS. The ladder climbs the NUMBER of live restaurants, so a
// tenant in phase 4 must sit closed until phase 4 begins. All 62 processes are spawned up front
// (spawning 31 of them mid-run would itself be a spike), so the gate has to live here — and it has
// to cover every actor, not just the tables: a kitchen screen or a floor board polling from second
// one is exactly the standing read load the ladder is trying to measure. Leaving this out made a
// "4 restaurants" phase actually 62, which is how the first ladder run reported failures in what
// it had labelled its gentlest phase.
const START_SEC = Number(arg("startSec", "0"));
const openAt = () => PHASES.startedAt + START_SEC * 1000;
const waitForOpening = async () => {
  const ms = openAt() - Date.now();
  if (ms > 0) await sleep(ms);
};
// Inlined rather than ri() on purpose: ri is declared below, and a const arrow used above its
// own declaration is a temporal-dead-zone crash that node --check cannot see — it would have
// killed all 62 workers on startup with "Cannot access 'ri' before initialization".
const RESTAURANT_OFFSET = Math.floor(Math.random() * 30000);

const H_ANON = { apikey: ANON, Authorization: `Bearer ${ANON}`, "Content-Type": "application/json" };
const H_PANEL = { Cookie: COOKIE, "Content-Type": "application/json" };
const NAMES = ["Mia", "Arjun", "Sara", "Leo", "Priya", "Dev", "Ana", "Kai", "Noor", "Ravi", "Zoe", "Om"];
const REASONS = ["water", "napkins", "cutlery", "help"];
const rnd = (a) => a[Math.floor(Math.random() * a.length)];
const ri = (n) => Math.floor(Math.random() * n);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = (ms) => ms / 2 + ri(ms);

// ── stats ──────────────────────────────────────────────────────────────────────────────────────
// THREE outcomes, not two. `ok` it worked · `refused` the app deliberately said no (rate limit,
// table closed, sold out — correct behaviour, and counting it as a failure is how you end up
// reporting a working guard as an outage) · `err` nobody answered, or answered 5xx.
const stats = {};
const cell = (phase, action) => {
  const k = phase + "|" + action;
  return (stats[k] = stats[k] || { phase, action, ok: 0, err: 0, refused: 0, busy: 0, lat: [], errs: {}, refusals: {}, bytes: 0 });
};
function record(phase, action, ms, kind, text, bytes) {
  const c = cell(phase, action);
  c[kind]++;
  if (c.lat.length < 4000) c.lat.push(Math.round(ms));
  c.bytes += bytes || 0;
  if (kind === "err" && text) { const t = String(text).slice(0, 160); c.errs[t] = (c.errs[t] || 0) + 1; }
  if (kind === "refused" && text) { const t = String(text).slice(0, 80); c.refusals[t] = (c.refusals[t] || 0) + 1; }
}
const phaseNow = () => {
  const el = (Date.now() - PHASES.startedAt) / 1000;
  for (const p of PHASES.list) if (el < p.untilSec) return p;
  return PHASES.list[PHASES.list.length - 1];
};

// ── one timed call, with a deadline of its own ─────────────────────────────────────────────────
// A stress test with no per-request timeout measures nothing: one wedged socket and the loop stops
// for the rest of the run, which LOOKS like a quiet, healthy database.
async function call(action, url, init, opts = {}) {
  const ph = phaseNow().name;
  const t0 = performance.now();
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), opts.timeoutMs || 20000);
  try {
    const r = await fetch(url, { ...init, signal: ctrl.signal });
    const body = await r.text();
    const ms = performance.now() - t0;
    let data = null; try { data = body ? JSON.parse(body) : null; } catch {}
    // ── "TOLD TO WAIT" IS NOT "BROKE", AND THE DIFFERENCE IS THE WHOLE REPORT ───────────────────
    // Three shapes of the same designed behaviour, and counting any of them as a failure is
    // exactly how the first rig reached "68% of orders failed":
    //   · 502 { reason: "server_busy", retryAfter } — /api/guest/place-order's own backpressure.
    //   · 503 + X-LFH-Busy — lib/dbRefusal.ts translating a saturated database into a sentence a
    //     waiter can read ("very busy right now — this will come back by itself").
    //   · a raw 500 carrying Postgres 57014 (statement timeout) or the 53300/08xxx family, which
    //     is the same condition reaching a caller that has no such wrapper in front of it — the
    //     guest RPCs go straight to PostgREST, so they see the bare code.
    // A phone or a panel responds to all three by waiting and re-sending; nothing is lost.
    const busyHeader = r.headers.get("x-lfh-busy");
    const rawDbBusy = r.status >= 500 && /"code"\s*:\s*"(57014|53300|08[0-9A-Z]{3})"/.test(body);
    if ((r.status === 502 && data?.reason === "server_busy") || (r.status === 503 && (busyHeader || /very busy/i.test(body))) || rawDbBusy) {
      record(ph, action, ms, "busy", null, body.length);
      return { busy: true, retryAfter: Number(data?.retryAfter) || Number(r.headers.get("retry-after")) || 20 };
    }
    if (!r.ok) {
      // 4xx = the app decided. 5xx / no answer = the app could not.
      const kind = r.status >= 400 && r.status < 500 ? "refused" : "err";
      record(ph, action, ms, kind, `HTTP ${r.status} ${(data?.reason || data?.error || body).toString().slice(0, 100)}`, body.length);
      return { ok: false, status: r.status, data };
    }
    // A 200 can still carry a refusal: the guest RPCs answer { ok:false, reason:'rate_limited' }.
    if (data && typeof data === "object" && data.ok === false) {
      record(ph, action, ms, "refused", String(data.reason || "refused"), body.length);
      return { ok: false, refused: String(data.reason || "refused"), data };
    }
    record(ph, action, ms, "ok", null, body.length);
    return { ok: true, data };
  } catch (e) {
    const ms = performance.now() - t0;
    record(ph, action, ms, "err", e.name === "AbortError" ? `TIMEOUT after ${opts.timeoutMs || 20000}ms` : `${e.name}: ${e.message}`, 0);
    return { ok: false, timeout: e.name === "AbortError" };
  } finally { clearTimeout(to); }
}
// The guest's own door: the anon key, exactly what the phone in the diner's hand carries.
const rpcAnon = (action, fn, body) =>
  call(action, `${URL_}/rest/v1/rpc/${fn}`, { method: "POST", headers: H_ANON, body: JSON.stringify(body) });
const getAnon = (action, q) => call(action, `${URL_}/rest/v1/${q}`, { method: "GET", headers: H_ANON });
// A staff screen's door: our own routes, gated by requireRole.
const panelGET = (action, path) => call(action, `${SITE}${path}`, { method: "GET", headers: H_PANEL, cache: "no-store" });
const panelPOST = (action, path, body) =>
  call(action, `${SITE}${path}`, { method: "POST", headers: H_PANEL, body: JSON.stringify(body || {}) });

// ── THE WAITER — one person, one thing at a time ───────────────────────────────────────────────
// Serialising this is not a detail. Thirty parallel "seat me" calls on one restaurant is the
// contention bug the old rig had; a real floor has one or two waiters working a queue.
// A 30-table restaurant has a few waiters, not one, and not thirty. Strict serialisation was a
// bottleneck of the rig's own making — one 20-second call and every other table's seating queued
// behind it, so the number being reported was my queue rather than the app's latency. Thirty
// parallel writers was the OLD rig's contention bug. Three is the floor a real dining room has.
const WAITERS = 3;
let waiterBusy = 0;
const waiterQ = [];
async function viaWaiter(fn) {
  if (waiterBusy >= WAITERS) await new Promise((r) => waiterQ.push(r));
  waiterBusy++;
  try { return await fn(); }
  finally { waiterBusy--; const next = waiterQ.shift(); if (next) next(); }
}

// ── ONE TABLE: seated → joins → browses → orders → pays → leaves ───────────────────────────────
const tableState = [];
async function guestTable(tableNo) {
  const st = { token: null, sessionId: null, orders: 0 };
  tableState[tableNo] = st;
  await waitForOpening();
  // A DINING ROOM FILLS OVER TIME. The first run seated all 1,860 tables inside eight seconds —
  // 62 restaurants x 30 parties walking through the door simultaneously — and the resulting
  // stampede, not the steady load, is what took the deployment down in the first minute. Real
  // tables arrive spread out, so table N of 30 sits down partway through the fill window, with
  // jitter, and with a per-restaurant offset so the 62 buildings are not in lock-step either.
  await sleep((tableNo / TABLES) * FILL_MS + ri(20000) + RESTAURANT_OFFSET);   // …then the room fills

  while (Date.now() < DEADLINE) {
    const ph = phaseNow();
    try {
      if (!st.token) {
        // 1. THE WAITER SEATS THE TABLE. A guest cannot open a session — lfh_join_session answers
        //    'no_open_session' — because a table belongs to a PARTY, and staff decide who is
        //    sitting there. This is the app's rule, so the rig obeys it.
        const seated = await viaWaiter(() => panelPOST("waiter_seat", "/api/tablet/sessions/open", { table: String(tableNo) }));
        if (!seated?.ok) { await sleep(jitter(6000)); continue; }
        markFloor(tableNo);
        // 2. The phone scans and joins.
        const j = await rpcAnon("guest_join", "lfh_join_session", {
          p_table: String(tableNo), p_name: rnd(NAMES), p_lat: null, p_lng: null,
          p_device: `crowd-${SLUG}-t${tableNo}`, p_restaurant_id: RID,
        });
        if (!j.ok || !j.data?.token) { await sleep(jitter(8000)); continue; }
        st.token = j.data.token; st.sessionId = j.data.session_id; st.orders = 0;
        // 3. Browsing: the settings + the menu, exactly what the guest screen reads on open.
        await rpcAnon("guest_settings", "lfh_guest_settings", { p_restaurant_id: RID });
        await getAnon("guest_menu_read", `menu_items?restaurant_id=eq.${RID}&select=id,title,price,category,veg&limit=100`);
      }

      // 4. Put things in the basket (the cart is saved server-side so the party shares it).
      const items = Array.from({ length: 1 + ri(3) }, () => ({ id: rnd(MENU), qty: 1 + ri(2) }));
      await rpcAnon("guest_cart", "lfh_set_cart", { p_token: st.token, p_cart: items, p_seen: null });

      // 5. THE ORDER — through our own route, with an at-most-once id, like every real order.
      const actionId = randomUUID();
      const r = await call("guest_order", `${SITE}/api/guest/place-order`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-LFH-Action-Id": actionId },
        body: JSON.stringify({ mode: "session", token: st.token, restaurantId: RID, items, allergies: [] }),
      });
      if (r.busy) {
        // The restaurant said "not now". A real phone saves it and waits the time it was given.
        await sleep(r.retryAfter * 1000);
        continue;
      }
      if (r.ok) { st.orders++; markKitchen(tableNo); }
      else if (r.refused === "invalid_token" || r.refused === "session_closed") { st.token = null; continue; }

      // 6. Watching their own order come along, and the occasional wave at a waiter.
      await rpcAnon("guest_poll", "lfh_session_state", { p_token: st.token });
      if (Math.random() < 0.10) await rpcAnon("guest_call_waiter", "lfh_call_waiter", { p_token: st.token, p_reason: rnd(REASONS) });

      // 7. Done eating? The party leaves and the waiter settles the table — but NOT instantly.
      //    The app refuses to close a table whose food is still cooking ("serve them first"),
      //    which is correct and which the first version of this rig read as 15 failures. A real
      //    waiter comes back when the plates are out, so the settle joins a queue and is retried.
      // How many rounds a party orders before it asks for the bill. This SCALES WITH THE PACE on
      // purpose: a party is a party, not a number of orders. At the real rush a table orders two
      // or three times across its meal; at 16× the same ten minutes of dining contains far more
      // rounds. Fixing it at "2 to 4" would have made every table settle every 90 seconds in the
      // fast phases, so the run would have measured settling rather than ordering.
      const roundsThisParty = Math.min(12, Math.max(2, Math.round(600000 / ph.orderEveryMs)));
      if (st.orders >= roundsThisParty) {
        await rpcAnon("guest_leave", "lfh_leave_session", { p_token: st.token });
        const job = { sessionId: st.sessionId, tableNo, tries: 0, paid: false, done: !st.sessionId };
        if (st.sessionId) toSettle.push(job);
        st.token = null;
        // AND THE TABLE STAYS EMPTY UNTIL IT IS ACTUALLY FREE. Re-seating immediately is what
        // deadlocked the second smoke: openTableSession is idempotent, so the "new party" joined
        // the SAME session that was still being settled, ordered again, and the close was refused
        // for food still cooking — forever, 64 times. A table that is settling takes no new party.
        const waitUntil = Date.now() + 180000;
        while (!job.done && Date.now() < waitUntil && Date.now() < DEADLINE) await sleep(1000);
      }
    } catch (e) {
      record(phaseNow().name, "table_loop_threw", 0, "err", `${e.name}: ${e.message}`, 0);
      st.token = null;
    }
    // THE PACE IS THE PHASE. orderEveryMs is how often ONE table orders — the single knob the
    // ladder turns. Everything else (kitchen, floor, waiter) follows the work that creates.
    await sleep(jitter(ph.orderEveryMs));
  }
}

// ── HOW OFTEN A SCREEN ACTUALLY READS ─────────────────────────────────────────────────────────
// NOT every five seconds. public/panels/realtime.js subscribes to a breadcrumb channel and
// refetches when one names this restaurant, falling back to a 60-SECOND backstop when nothing
// arrives — and CLAUDE.md states the rule outright: "no poll faster than the 60s backstop".
//
// The first run of this rig polled the kitchen board and the floor board every 5 seconds, which is
// twelve times the real read rate. Across 62 restaurants that is ~25 requests a second of the two
// most expensive reads in the app, and it was enough ON ITS OWN to saturate the deployment:
// /api/health stopped answering inside sixty seconds. The rig was the outage.
//
// So the boards wait for WORK — the flag below stands in for the realtime breadcrumb — or for the
// backstop, whichever comes first.
const BACKSTOP_MS = 60000;
// A BREADCRUMB NAMES A TABLE, AND THE PANELS USE THAT. This rig used to refetch the WHOLE floor
// (and the whole dish list with it) on every change — the most expensive call the app has, ~77 KB
// of which ~50 KB is dishes. The real panels do neither:
//   public/panels/tablet/app.js:5465   api("GET", "/summary?table=" + t)   ← one tile, ~5 kB
//   public/panels/tablet/app.js:5559   api("GET", "/summary?nomenu=1")     ← recurring refresh
//   public/panels/editor/app.js:17207  api("GET", "/summary?table=" + t)
// and the kitchen board carries the same targeted slice (?table=N). Measuring the app with a
// client heavier than its own panels is how you report a ceiling that does not exist.
const work = { kitchen: false, floor: false, kitchenTables: new Set(), floorTables: new Set() };
const markKitchen = (table) => {                      // a new ticket for this table
  work.kitchen = true; work.floor = true;
  if (table != null) { work.kitchenTables.add(String(table)); work.floorTables.add(String(table)); }
};
const markFloor = (table) => {                        // anything else that moved on this table
  work.floor = true;
  if (table != null) work.floorTables.add(String(table));
};
// How many named tables are worth patching one-by-one before a whole-floor read is cheaper.
const TARGETED_MAX = 4;
function takeTables(key) {
  const set = work[key + "Tables"];
  const list = [...set];
  set.clear();
  return list;
}
// A FLOOR under a 2.5s minimum, because a breadcrumb is not an instruction to refetch instantly
// and forever. At the top of the ladder an order lands every 0.7 seconds per restaurant, so a
// board that refetched on every single one would spin as fast as the network allows — the same
// hammer the 5-second poll was, wearing a different hat. The real panels coalesce; so does this.
const MIN_GAP_MS = 2500;
async function waitForWork(key) {
  await sleep(MIN_GAP_MS);
  const until = Date.now() + BACKSTOP_MS - MIN_GAP_MS;
  while (Date.now() < until && Date.now() < DEADLINE) {
    if (work[key]) break;
    await sleep(1000);
  }
  work[key] = false;
}

// ── THE WAITER SETTLING UP — pay, then close, and come back if the food isn't out yet ─────────
const toSettle = [];
async function waiterSettles() {
  await waitForOpening();
  while (Date.now() < DEADLINE) {
    const job = toSettle.shift();
    if (!job) { await sleep(3000); continue; }
    await viaWaiter(async () => {
      // Pay ONCE. Re-sending it on every retry earned 17 "Nothing to settle on this bill" refusals
      // in the smoke — the app was right and the rig was asking twice. A 409 here means somebody
      // already settled it, which is the state we wanted anyway.
      if (!job.paid) {
        const pRes = await panelPOST("waiter_pay", `/api/tablet/tables/${job.tableNo}/pay`, { method: "cash" });
        if (pRes.ok || pRes.status === 409) job.paid = true;
      }
      const c = await panelPOST("waiter_close", `/api/tablet/sessions/${job.sessionId}/close`, {});
      markFloor(job.tableNo);
      // A refusal is the app protecting the party's food, not a failure — the kitchen has dishes
      // still on the pass. Come back when they are out. No new party sits down meanwhile, so this
      // now converges instead of chasing a table that keeps re-filling.
      if (c.ok) { job.done = true; return; }
      if (job.tries < 25) { job.tries++; setTimeout(() => toSettle.push(job), 6000); }
      else job.done = true;   // stop holding the table hostage to a settle that will not land
    });
    await sleep(jitter(1000));
  }
}

// ── THE KITCHEN SCREEN — the only writer of order status, which is the point ────────────────────
async function kitchenScreen() {
  await waitForOpening();
  const cooking = new Map();  // order id -> when it comes off the pass
  const toServe = new Map();  // order id -> when a waiter carries it out
  const tableOf = new Map();  // order id -> its table, so a later breadcrumb can name it
  while (Date.now() < DEADLINE) {
    // Same shape as the floor: one tile's worth when a breadcrumb named a table, the whole board
    // only on the backstop or a broad change.
    const kTables = takeTables("kitchen");
    const b = kTables.length && kTables.length <= TARGETED_MAX
      ? await panelGET("kitchen_slice", `/api/kitchen/board?table=${encodeURIComponent(kTables[0])}`)
      : await panelGET("kitchen_board", "/api/kitchen/board");
    const orders = b.ok ? (b.data?.orders || []) : [];
    const items = b.ok ? (b.data?.items || []) : [];
    const itemsOf = new Map();
    for (const it of Array.isArray(items) ? items : []) {
      if (!it?.id || !it.order_id) continue;
      if (!itemsOf.has(it.order_id)) itemsOf.set(it.order_id, []);
      itemsOf.get(it.order_id).push(it);
    }
    for (const o of Array.isArray(orders) ? orders : []) {
      if (!o?.id || cooking.has(o.id) || toServe.has(o.id)) continue;
      if (o.table_number != null) tableOf.set(o.id, o.table_number);
      if (o.status === "received") {
        const a = await panelPOST("kitchen_accept", `/api/kitchen/orders/${o.id}/accept`, {});
        if (a.ok) { cooking.set(o.id, Date.now() + 20000 + ri(40000)); markFloor(o.table_number); }   // 20-60s on the stove
      } else if (o.status === "preparing") {
        // A FOLLOW-UP ORDER IS ALREADY 'preparing' AND NOBODY PRESSED ACCEPT. Migration 163/357:
        // once staff have accepted one order for a seating, later rounds skip straight to the
        // pass. Without this branch the kitchen only ever finishes the FIRST round of each party
        // and every later dish sits cooking forever — which then blocks the table from closing.
        cooking.set(o.id, Date.now() + 20000 + ri(40000));
      }
    }
    for (const [id, when] of [...cooking]) {
      if (Date.now() < when) continue;
      const r = await panelPOST("kitchen_ready", `/api/kitchen/orders/${id}/ready`, {});
      cooking.delete(id);
      if (r.ok) { toServe.set(id, Date.now() + 5000 + ri(15000)); markFloor(tableOf.get(id)); }
    }
    for (const [id, when] of [...toServe]) {
      if (Date.now() < when) continue;
      toServe.delete(id);
      // The dish leaves the pass. Order-level status stays coarse and rolls up to 'served' on
      // its own once every dish is out (kitchen route, items/:id/status) — which is what finally
      // lets the table be closed.
      for (const it of itemsOf.get(id) || []) {
        await panelPOST("waiter_serve", `/api/kitchen/items/${it.id}/status`, { status: "served" });
      }
    }
    await waitForWork("kitchen");
  }
}

// ── THE FLOOR BOARD — the manager's screen, on its own poll ────────────────────────────────────
async function floorScreen() {
  await waitForOpening();
  // The first paint is the only one that needs the dish list; after that the panel keeps its own
  // cached menu and asks for the floor without it.
  await panelGET("floor_full", "/api/tablet/summary");
  while (Date.now() < DEADLINE) {
    await waitForWork("floor");
    const tables = takeTables("floor");
    if (tables.length && tables.length <= TARGETED_MAX) {
      // Targeted: patch just the tiles that actually changed. Never shared, so a tile updates the
      // instant its order lands — which is exactly why the app offers it.
      for (const t of tables) await panelGET("floor_tile", `/api/tablet/summary?table=${encodeURIComponent(t)}`);
    } else {
      await panelGET("floor_refresh", "/api/tablet/summary?nomenu=1");
    }
  }
}

// ── report ─────────────────────────────────────────────────────────────────────────────────────
const pct = (a, p) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.floor((p / 100) * (s.length - 1))]; };
function snapshot(final) {
  const cells = Object.values(stats).map((c) => ({
    phase: c.phase, action: c.action, ok: c.ok, err: c.err, refused: c.refused, busy: c.busy, bytes: c.bytes,
    p50: pct(c.lat, 50), p95: pct(c.lat, 95), max: pct(c.lat, 100),
    errs: Object.entries(c.errs).sort((a, b) => b[1] - a[1]).slice(0, 5),
    refusals: Object.entries(c.refusals).sort((a, b) => b[1] - a[1]).slice(0, 5),
  }));
  stdout.write(JSON.stringify({ slug: SLUG, final, at: Date.now(), cells }) + "\n");
}

// REPORT BEFORE DYING. The orchestrator's ceiling rail ends a run by SIGTERM-ing every worker, and
// the report only keeps snapshots marked `final` — so the first time the rail fired, all 62 workers
// were killed mid-flight and the per-action detail for the whole run was lost. The per-phase totals
// survived only because the orchestrator's own tick log had been printing them. A worker that can
// be stopped on purpose has to hand in its work on the way out.
for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, () => { try { snapshot(true); } catch {} process.exit(0); });
}

const ticker = setInterval(() => snapshot(false), 15000);
await Promise.all([
  ...Array.from({ length: TABLES }, (_, i) => guestTable(i + 1)),
  kitchenScreen(),
  floorScreen(),
  waiterSettles(),
]);
clearInterval(ticker);
snapshot(true);
