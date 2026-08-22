// verify-manager-live-rush.mjs — RUSH HOUR on the manager's Table view (owner, 2026-07-30:
// "manager live table view is the most important thing — test with live orders and rush hour
// and check the manager panel simultaneously, in each restaurant").
//
// What it does: opens the manager's Tables tab for TWO restaurants at the SAME TIME, then
// fires a rush at them through the real staff order path (lfh_staff_place_order — the same RPC
// the panels call) and measures how long each event takes to APPEAR on the open panel without
// anyone touching it. Then it advances dishes (accept → cooking → ready → served), pays a bill
// and closes a table, checking the tile follows every step.
//
// It asserts three things the owner cares about:
//   1. LIVE — a new order shows up on the open Table view on its own, within SLA_MS.
//   2. RIGHT — the tile's dish counts and ₹ due match the DB for THAT table, and no other
//      table's tile moves (no bleed between tables or between restaurants).
//   3. CHEAP — a single table's change refetches only that table (?table=N), never the floor.
//
// SAFETY: dev/test stack only (it refuses any other Supabase project), one login per role
// (the cached loginAs, so our own tests can't trip the login limit), and every row it creates
// is taken off the floor the way the app does it (archived + deleted_at — the DB rightly
// refuses to hard-delete an issued bill).
//
//   node scripts/verify-manager-live-rush.mjs                      # against the deployed backup
//   node scripts/verify-manager-live-rush.mjs --base http://localhost:4000
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import { loginAs } from "./sweep/login.mjs";
import { dismissTicketsFor } from "./sweep/tickets.mjs";
import { claimedTables } from "./sweep/fixtureTables.mjs";
import { requireUp } from "./sweep/appUp.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const parseEnv = (t) => Object.fromEntries(t.split("\n").filter((l) => l.includes("=") && !l.trim().startsWith("#")).map((l) => {
  const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
}));
const env = parseEnv(readFileSync(join(root, ".env.local"), "utf8"));
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : d; };
const BASE = arg("--base", "https://3-d-backup.vercel.app");
const SLA_MS = Number(arg("--sla", 15000));   // a change must reach an open panel within this
const ROUNDS = Number(arg("--rounds", 6));    // orders per restaurant in the rush

if (!/wnsfcizclkbobwzcxqsf/.test(env.NEXT_PUBLIC_SUPABASE_URL)) {
  console.error("refusing: this test places real orders and may only run against the dev/test database");
// Nothing answering = "could not run" (exit 2), said in plain words — never a raw ECONNREFUSED
// stack, which reads as "this guard is broken". (sweep #6 / T28, 2026-08-22)
await requireUp(BASE, "the live rush");
  process.exit(1);
}
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const must = (r) => { if (r.error) throw new Error(r.error.message); return r.data; };

let failed = 0;
const pass = (m) => console.log("  ✓ " + m);
const fail = (m) => { console.log("  ✗ " + m); failed++; };
const info = (m) => console.log("  · " + m);
const head = (m) => console.log("\n" + m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The two restaurants to run simultaneously: each needs its own diag manager login.
const CREWS = [
  { name: "My Little French House", creds: { username: "diagm1", password: "diag-mgr-2026", route: "/manager" } },
  { name: "Aangan Garden", creds: { username: "diagm11", password: "diag-mgr-2026", route: "/manager" } },
];

// ── one restaurant's live-floor crew: a browser on the Tables tab, and helpers that read it ──
async function openFloor(browser, creds) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const route = await loginAs(ctx, "manager", BASE, creds);
  const page = await ctx.newPage();
  const errs = [], reqs = [];
  page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
  page.on("request", (r) => { const u = r.url(); if (/\/api\/editor\/(orders|sessions|summary|calls)/.test(u)) reqs.push(u); });
  await page.goto(BASE + route, { waitUntil: "domcontentloaded" });
  const fr = page.frameLocator("iframe").first();
  await fr.locator('.tab[data-tab="tables"]').waitFor({ timeout: 90000 });
  // Tap Tables until the floor is actually there: a tap that lands while the panel is still
  // booting can be swallowed, and then we'd sit waiting for tiles that were never asked for.
  let tiles = 0;
  for (let attempt = 0; attempt < 4 && !tiles; attempt++) {
    await fr.locator('.tab[data-tab="tables"]').click();
    for (let i = 0; i < 16 && !tiles; i++) { await sleep(1000); tiles = await fr.locator(".ftile").count(); }
  }
  if (!tiles) throw new Error("the manager's Table view never rendered any tiles");
  // whoami deliberately doesn't hand out the restaurant id, so take it from the diag
  // account's own row — the panel is scoped server-side from the same login either way.
  const rid = must(await sb.from("staff_users").select("restaurant_id").eq("username", creds.username).limit(1))[0]?.restaurant_id;
  if (!rid) throw new Error(`no staff_users row for ${creds.username}`);
  return { ctx, page, fr, errs, reqs, rid };
}
// WHAT A TILE ACTUALLY PUBLISHES (sweep #6 / T28, 2026-08-22). A tile with dishes on it prints the
// SERVED COUNTER as its visible line — "0/1 served" — and carries the state phrase ("New order",
// "Ready to serve", "Served") in that line's `title`, with the colour strip as the at-a-glance signal.
// Only an EMPTY table prints its label as text ("Free"). This helper read innerText alone, so sixteen
// checks were comparing the counter against a phrase that is no longer text: "tile 1 · 4 · 0/1 served
// vs database New order", on a floor that was completely correct. Read both, because both are on the
// tile — otherwise the guard is asserting where the words sit, not whether the state arrived.
const tileText = async (crew, t) => {
  try {
    const el = crew.fr.locator(`.ftile[data-floor-table="${t}"]`);
    const txt = (await el.innerText()).replace(/\n/g, " · ");
    const titles = await el.locator("[title]").evaluateAll((els) => els.map((e) => e.getAttribute("title")).filter(Boolean));
    return [txt, ...titles].join(" · ");
  } catch { return ""; }
};
// waitForTile: poll the OPEN page (never reload it) until the tile matches — that is the whole
// point: the panel has to update itself.
async function waitForTile(crew, t, re, label) {
  const t0 = Date.now();
  while (Date.now() - t0 < SLA_MS) {
    const txt = await tileText(crew, t);
    if (re.test(txt)) { pass(`${label} — showed up by itself in ${((Date.now() - t0) / 1000).toFixed(1)}s ("${txt}")`); return true; }
    await sleep(500);
  }
  fail(`${label} — still not on the open Table view after ${SLA_MS / 1000}s (tile reads "${await tileText(crew, t)}")`);
  return false;
}

const created = { orders: [], sessions: [], tables: new Set() };   // "<rid>|<table>" for every table this run touched
async function placeOrder(rid, table, dish, qty = 1) {
  // TWO ROUNDS OF THE SAME DISH WITHIN THREE SECONDS ARE ONE ORDER TO THIS APP (sweep #6 / T28,
  // 2026-08-22). lfh_staff_place_order carries a double-tap guard: a non-cancelled order for the same
  // table with the same item signature in the last 3 seconds comes back
  // `{ ok:false, duplicateWarning:true }` and NO order_id. A guard that walks a table through several
  // rounds trips it constantly — and because nothing here read `ok`, the undefined id travelled six
  // lines and died as `invalid input syntax for type uuid: "undefined"`, which names neither the cause
  // nor the file. That made this guard fail intermittently: whether it passed depended on whether the
  // previous identical round happened to be more than three seconds ago.
  //
  // p_confirm_duplicate is the product's own way to say "yes, another round" — it is what the waiter's
  // own "send anyway" sends — so it is the honest thing for a script that means exactly that. The
  // double-tap guard itself is held by verify:order-retry and verify:guest-recovery.
  const r = await sb.rpc("lfh_staff_place_order", {
    p_table: String(table), p_items: [{ id: dish.id, qty }], p_allergies: [], p_note: null, p_restaurant_id: rid,
    p_confirm_duplicate: true,
  });
  if (r.error) throw new Error(r.error.message);
  if (!r.data || r.data.ok !== true) throw new Error(`place order on ${table} was refused: ${JSON.stringify(r.data)}`);
  const id = r.data?.order_id;
  if (id) created.orders.push(id);
  created.tables.add(`${rid}|${String(table)}`);
  return r.data;
}

const browser = await chromium.launch();
try {
  head(`RUSH HOUR against ${BASE} — SLA ${SLA_MS / 1000}s per change, ${ROUNDS} orders per restaurant`);
  const crews = [];
  for (const c of CREWS) {
    const crew = await openFloor(browser, c.creds);
    crew.label = c.name;
    // dishes + a free table block for this restaurant
    crew.dishes = must(await sb.from("menu_items").select("id,title,price").eq("restaurant_id", crew.rid).limit(6));
    const busy = new Set([
      ...must(await sb.from("sessions").select("table_number").eq("restaurant_id", crew.rid).neq("status", "closed")).map((s) => String(s.table_number)),
      ...must(await sb.from("orders").select("table_number").eq("restaurant_id", crew.rid).eq("archived", false).is("deleted_at", null).neq("status", "cancelled").limit(2000)).map((o) => String(o.table_number)),
      // …and the tables other guards own, so a whole-suite run cannot have two lanes at one table
      // (scripts/sweep/fixtureTables.mjs). A collision there looks exactly like a product fault.
      ...claimedTables(),
    ]);
    const count = must(await sb.from("settings").select("table_count").eq("restaurant_id", crew.rid).limit(1))[0]?.table_count || 10;
    const freeList = [...Array(count).keys()].map((n) => String(n + 1)).filter((n) => !busy.has(n)).slice(0, ROUNDS + 1);
    crew.timed = freeList.length > 1 ? freeList.pop() : null; // held back for the timed single order
    crew.tables = freeList;
    crews.push(crew);
    info(`${crew.label}: panel open on Tables, ${crew.dishes.length} dishes, free tables ${crew.tables.join(",")}`);
    if (crew.tables.length < 3) fail(`${crew.label}: fewer than 3 free tables — rush test needs room`);
  }

  // ── 1) THE RUSH: orders landing on both floors at once, panels untouched ────
  head("1) Orders flooding in while both Table views sit open");
  const reqBefore = crews.map((c) => c.reqs.length);
  for (let i = 0; i < ROUNDS; i++) {
    await Promise.all(crews.map(async (crew, ci) => {
      const t = crew.tables[i % crew.tables.length];
      if (!t) return;
      const dish = crew.dishes[i % crew.dishes.length];
      await placeOrder(crew.rid, t, dish, 1 + (i % 3));
    }));
    await sleep(1200); // real waiters aren't simultaneous to the millisecond
  }
  info("rush sent — now watching the two open panels update themselves");
  for (const crew of crews) {
    for (const t of crew.tables.slice(0, Math.min(3, crew.tables.length))) {
      await waitForTile(crew, t, /New order|Preparing|served|₹/, `${crew.label} T${t}: a new order`);
    }
  }

  // ── 1b) THE MEASUREMENT that matters: one order, timed from send to on-screen ──
  head("1b) How long before a brand-new order is ON the open Table view?");
  for (const crew of crews) {
    const t = crew.timed; // deliberately held out of the rush so it is still Free
    const before = await tileText(crew, t);
    if (!t || !/Free/.test(before)) { info(`${crew.label}: no untouched free table left to time`); continue; }
    const t0 = Date.now();
    await placeOrder(crew.rid, t, crew.dishes[0], 2);
    let seen = null;
    while (Date.now() - t0 < SLA_MS) {
      const now = await tileText(crew, t);
      if (!/Free/.test(now)) { seen = { ms: Date.now() - t0, now }; break; }
      await sleep(250);
    }
    seen
      ? pass(`${crew.label} T${t}: waiter sent an order → manager saw it ${(seen.ms / 1000).toFixed(1)}s later, untouched ("${seen.now}")`)
      : fail(`${crew.label} T${t}: an order sent while the panel was open never appeared within ${SLA_MS / 1000}s`);
  }

  // ── 2) RIGHT: every tile matches the DB for its own table, and only its own ──
  head("2) Do the tiles tell the truth, table by table?");
  for (const crew of crews) {
    const tiles = must(await sb.rpc("lfh_table_view_summary", { p_restaurant_id: crew.rid })).tiles || {};
    for (const t of crew.tables) {
      const shown = await tileText(crew, t);
      const truth = tiles[t];
      if (!truth) continue;
      const okLabel = shown.includes(truth.label);
      const dueTruth = Number(truth.due) > 0 ? Math.round(Number(truth.due)) : 0;
      const dueShown = (shown.match(/₹([\d,]+)/) || [])[1];
      const dueOk = dueTruth === 0 ? true : dueShown && Math.abs(Number(dueShown.replace(/,/g, "")) - dueTruth) <= 1;
      okLabel && dueOk
        ? pass(`${crew.label} T${t}: tile "${shown}" matches the database (${truth.label}${dueTruth ? `, ₹${dueTruth} due` : ""})`)
        : fail(`${crew.label} T${t}: tile "${shown}" vs database "${truth.label}"${dueTruth ? ` ₹${dueTruth} due` : ""}`);
    }
    const others = Object.keys(tiles).filter((t) => !crew.tables.includes(t) && tiles[t].state === "free");
    let bled = 0;
    for (const t of others.slice(0, 6)) { const s = await tileText(crew, t); if (/₹|Preparing|New order|Ready/.test(s)) { bled++; fail(`${crew.label} T${t} should be Free but reads "${s}"`); } }
    if (!bled) pass(`${crew.label}: untouched tables stayed Free — the rush didn't bleed onto them`);
  }

  // ── 3) The dish lifecycle, watched live on the tile ──────────────────────────
  head("3) Accept → cooking → ready → served → paid → closed, followed live");
  for (const crew of crews) {
    const t = crew.tables[0];
    const sess = must(await sb.from("sessions").select("id").eq("restaurant_id", crew.rid).eq("table_number", t).eq("status", "open").limit(1))[0];
    if (!sess) { fail(`${crew.label} T${t}: no open session to advance`); continue; }
    const ords = must(await sb.from("orders").select("id").eq("session_id", sess.id).eq("archived", false).neq("status", "cancelled"));
    const ids = ords.map((o) => o.id);
    // everything READY (the pink "Ready to serve" tile the waiter watches for)
    must(await sb.from("order_items").update({ status: "ready" }).in("order_id", ids).select("id"));
    must(await sb.from("orders").update({ status: "preparing" }).in("id", ids).select("id"));
    await waitForTile(crew, t, /Ready to serve/, `${crew.label} T${t}: kitchen marked it ready`);
    // everything SERVED
    must(await sb.from("order_items").update({ status: "served" }).in("order_id", ids).select("id"));
    must(await sb.from("orders").update({ status: "served" }).in("id", ids).select("id"));
    await waitForTile(crew, t, /Served|Cleared/, `${crew.label} T${t}: all dishes served`);
    // PAID — the tile's outline is the payment signal (red = owed, green = settled), so check
    // the CLASS, not the label: "Served" was already on screen and would pass by accident.
    const ringBefore = (await crew.fr.locator(`.ftile[data-floor-table="${t}"]`).getAttribute("class")) || "";
    /pay-red/.test(ringBefore)
      ? pass(`${crew.label} T${t}: unpaid table wears the red ring`)
      : fail(`${crew.label} T${t}: an unpaid table should wear the red ring (class "${ringBefore}")`);
    must(await sb.from("orders").update({ payment_status: "paid", paid_at: new Date().toISOString() }).in("id", ids).select("id"));
    {
      const t0 = Date.now(); let ok = false, cls = ringBefore;
      while (Date.now() - t0 < SLA_MS) {
        cls = (await crew.fr.locator(`.ftile[data-floor-table="${t}"]`).getAttribute("class")) || "";
        if (/pay-green/.test(cls) && !/pay-red/.test(cls)) { ok = true; break; }
        await sleep(400);
      }
      ok
        ? pass(`${crew.label} T${t}: bill settled → ring turned green by itself in ${((Date.now() - t0) / 1000).toFixed(1)}s`)
        : fail(`${crew.label} T${t}: the tile still doesn't show the bill as paid (class "${cls}")`);
    }
    // CLOSED — the tile must go back to Free, with nothing left behind
    must(await sb.from("sessions").update({ status: "closed" }).eq("id", sess.id).select("id"));
    await waitForTile(crew, t, /Free/, `${crew.label} T${t}: table closed and free again`);
    const left = must(await sb.from("orders").select("id").eq("session_id", sess.id).eq("archived", false).is("deleted_at", null).neq("status", "cancelled"));
    left.length === 0
      ? pass(`${crew.label} T${t}: nothing left on the floor after the close (mig 232)`)
      : fail(`${crew.label} T${t}: ${left.length} order(s) still live after closing — the next party would inherit them`);
  }

  // ── 4) CHEAP: the rush refetched tables, not the whole floor ─────────────────
  head("4) Did the live updates stay cheap?");
  crews.forEach((crew, ci) => {
    const fresh = crew.reqs.slice(reqBefore[ci]);
    const targeted = fresh.filter((u) => /[?&]table=/.test(u)).length;
    const whole = fresh.filter((u) => /\/api\/editor\/orders(\?rid=[^&]*)?$/.test(u)).length;
    info(`${crew.label}: ${fresh.length} floor requests — ${targeted} scoped to one table, ${whole} whole-board`);
    whole <= 2
      ? pass(`${crew.label}: live updates refetched single tables, not the whole floor`)
      : fail(`${crew.label}: ${whole} whole-board order reads during the rush — that's the egress pattern we forbid`);
  });

  head("5) Console");
  for (const crew of crews) {
    const real = crew.errs.filter((e) => !/favicon|model-viewer|Failed to load resource: the server responded with a status of 40[34]/.test(e));
    real.length ? fail(`${crew.label}: ${real.length} console error(s): ${real.slice(0, 2).join(" | ")}`) : pass(`${crew.label}: no console errors through the whole rush`);
  }
} finally {
  await browser.close();
  // Take every test row off the floor the way the app does — archived + soft-deleted, so the
  // ledger keeps the record and the DB's "an issued bill can't be hard-deleted" rule holds.
  if (created.orders.length) {
    await sb.from("orders").update({ archived: true, archived_at: new Date().toISOString(), deleted_at: new Date().toISOString() }).in("id", created.orders);
  }
  // ONLY THE TABLES THIS RUN TOUCHED (sweep #6 / T28, 2026-08-22). This used to read EVERY non-closed
  // session in each crew's restaurant and close the lot — while printing "closed the tables they
  // opened", which is not what it did. The rush picks FREE tables at the start, so any party that
  // arrived while it ran (another sweep lane, a real phone, the owner's own tab) was ended at the end;
  // and closing a session fires migration 232's trigger, which cancels and archives every unpaid live
  // order on it. On a real restaurant that ends every meal in the house. It also explains flakes seen
  // during this sweep: it was deleting other lanes' fixtures mid-run.
  const byRid = new Map();
  for (const key of created.tables) { const [rid, t] = key.split("|"); if (!byRid.has(rid)) byRid.set(rid, []); byRid.get(rid).push(t); }
  let closed = 0;
  for (const [rid, tables] of byRid) {
    const open = must(await sb.from("sessions").select("id").eq("restaurant_id", rid).in("table_number", tables).neq("status", "closed"));
    for (const s of open) { await sb.from("sessions").update({ status: "closed" }).eq("restaurant_id", rid).eq("id", s.id); closed++; }
    // …and the kitchen tickets those orders queued, or the manager's floor keeps a red "hasn't printed
    // — is the kitchen screen open?" banner for each one. By order id, never by restaurant.
    await dismissTicketsFor(sb, rid, created.orders, info);
  }
  console.log(`\n· cleaned up ${created.orders.length} test orders and closed the ${closed} table(s) they opened`);
}
console.log(failed ? `\n✗ ${failed} check(s) failed — the manager's live Table view is not trustworthy yet` : "\n✓ the manager's Table view kept up with the rush, on both restaurants");
process.exit(failed ? 1 : 0);
