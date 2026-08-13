// scripts/seed-demo-orders.mjs
// SANDBOX-ONLY demo order seeder: inserts a realistic spread of orders (and a few
// open dining sessions) across ALL restaurants, so the OWNER dashboard (`/owner`)
// shows meaningful numbers — varying order counts, varying totals, and some orders
// from earlier dates so "today" and "all-time" differ.
//
// It reads ONLY the SUPABASE_DEV_* keys from .env.local, so it physically cannot
// touch production. Run:  node scripts/seed-demo-orders.mjs
//
// IDEMPOTENT: every row it makes is tagged so a re-run can find + replace ONLY
// its own rows (orders via discount_note='demo-seed'; sessions are marked with a
// fixed sentinel UUID in `void_reason`, since `opened_by` is CHECK-constrained to
// waiter/guest). A re-run deletes those tagged rows first, so numbers don't pile
// up. It never touches real (non-demo) orders/sessions.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { refuseUnlessDevTestDb } from "./sweep/devStacks.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
function parseEnv(t) {
  const o = {};
  for (const l of t.split(/\r?\n/)) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m) o[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return o;
}
const env = parseEnv(readFileSync(join(root, ".env.local"), "utf8"));
// Which database is this? (T10 sweep, 2026-08-12 — this script had no answer.)
// One shared allow-list, in scripts/sweep/devStacks.mjs, so it knows about BOTH dev stacks
// (backup-1 and the backup-2 failover) and never about the client one.
refuseUnlessDevTestDb(env.SUPABASE_DEV_URL, "this creates demo orders");

const URL_ = env.SUPABASE_DEV_URL;
const SERVICE = env.SUPABASE_DEV_SERVICE_ROLE_KEY;
if (!URL_ || !SERVICE) {
  throw new Error("Missing SUPABASE_DEV_URL / SUPABASE_DEV_SERVICE_ROLE_KEY — this seeder is sandbox-only and refuses to run without them.");
}
console.log("▶ DEV sandbox target:", URL_);
const db = createClient(URL_, SERVICE, { auth: { persistSession: false } });

const DEMO_TAG = "demo-seed";        // orders marker (discount_note) for idempotent re-runs
const DEMO_SESSION_TAG = "demo-seed"; // sessions marker (void_reason) — opened_by is CHECK-constrained

// Deterministic PRNG so every run produces the same realistic-looking spread
// (no flaky "different numbers each time"). Mulberry32 — tiny, good enough here.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(20260625);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const randInt = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));

// 1) Load restaurants + their menu items (real prices → realistic order totals).
const { data: restaurants, error: rErr } = await db
  .from("restaurants").select("id,slug,name").order("name");
if (rErr) throw new Error("restaurants: " + rErr.message);
if (!restaurants?.length) throw new Error("No restaurants found — run seed-demo-restaurants.mjs first.");

const { data: items, error: iErr } = await db
  .from("menu_items").select("restaurant_id,slug,title,price");
if (iErr) throw new Error("menu_items: " + iErr.message);
const itemsByRest = {};
for (const it of items || []) (itemsByRest[it.restaurant_id] ||= []).push(it);

// 2) Wipe ONLY previously-seeded demo rows (idempotent re-runs). Demo orders are
//    served/paid = "issued", so a plain DELETE is refused by the issued-bill lock
//    (mig 190). Route through the narrow, service-role-only test-cleanup door, which
//    sets the purge flag for exactly these tagged rows.
{
  const d = await db.rpc("lfh_test_clear_demo", { p_tag: DEMO_TAG, p_session_tag: DEMO_SESSION_TAG });
  if (d.error) throw new Error("clear demo seed: " + d.error.message);
}

// 3) Build a realistic spread per restaurant. Each restaurant gets a different
//    "busyness" so the dashboard cards clearly differ. Statuses lean toward
//    completed/paid, with a few live + the odd cancellation (which revenue
//    excludes). Some orders are back-dated so all-time > today.
const PAID_DONE = { status: "served", payment_status: "paid", archived: true };
const LIVE = [
  { status: "received", payment_status: "pending", archived: false },
  { status: "preparing", payment_status: "pending", archived: false },
];
const CANCELLED = { status: "cancelled", payment_status: "pending", archived: true };

const startOfTodayIST = () => {
  // 05:00 IST business-day start, expressed as a UTC instant (matches the RPC).
  const nowIST = new Date(Date.now() + 5.5 * 3600e3); // shift into IST wall-clock
  const day = new Date(nowIST); day.setUTCHours(0, 0, 0, 0);
  // business day starts at 05:00 IST → subtract 5h from midnight-IST, then back to UTC
  return new Date(day.getTime() + 5 * 3600e3 - 5.5 * 3600e3);
};
const TODAY_START = startOfTodayIST();

// per-restaurant order budget [todayCount, pastDays' total count] — varied.
const PLAN = [
  { today: [8, 14], pastPerDay: [4, 9], pastDays: 6, openTables: [2, 4] }, // busy
  { today: [4, 9],  pastPerDay: [2, 6], pastDays: 6, openTables: [1, 3] }, // medium
  { today: [2, 5],  pastPerDay: [1, 4], pastDays: 6, openTables: [0, 2] }, // quiet
];

function randomItemsLine(rest) {
  const menu = itemsByRest[rest.id] || [];
  const n = randInt(1, 4);
  const line = [];
  let total = 0;
  for (let k = 0; k < n; k++) {
    const it = menu.length ? pick(menu) : { slug: "item", title: "Item", price: "150" };
    const qty = randInt(1, 3);
    const price = Number(it.price) || 150;
    total += price * qty;
    line.push({ slug: it.slug, title: it.title, qty, price });
  }
  return { items: line, total };
}

function makeOrder(rest, createdAt, live) {
  const { items: line, total } = randomItemsLine(rest);
  // ~1 in 12 cancelled; otherwise the requested live/done mix.
  const roll = rand();
  const st = roll < 0.08 ? CANCELLED : live ? pick(LIVE) : PAID_DONE;
  const discount = !live && rand() < 0.18 ? randInt(10, 60) : 0; // occasional discount
  return {
    restaurant_id: rest.id,
    table_number: String(randInt(1, 12)),
    items: line,
    subtotal: total,
    tax: Math.round(total * 0.05 * 100) / 100,
    total,
    discount,
    discount_note: DEMO_TAG, // ← the idempotency marker
    created_at: createdAt.toISOString(),
    ...st,
  };
}

const ordersToInsert = [];
const sessionsToInsert = [];
let planIdx = 0;
const summary = [];

for (const rest of restaurants) {
  const plan = PLAN[planIdx % PLAN.length];
  planIdx++;

  // a) TODAY's orders (spread through the day so far).
  const todayN = randInt(plan.today[0], plan.today[1]);
  const sinceStartMs = Date.now() - TODAY_START.getTime();
  let liveCount = 0;
  for (let i = 0; i < todayN; i++) {
    const at = new Date(TODAY_START.getTime() + Math.floor(rand() * Math.max(sinceStartMs, 1)));
    const live = i < Math.min(3, Math.floor(todayN / 3)); // a few still live
    if (live) liveCount++;
    ordersToInsert.push(makeOrder(rest, at, live));
  }

  // b) EARLIER days' orders (so all-time clearly exceeds today).
  let pastN = 0;
  for (let d = 1; d <= plan.pastDays; d++) {
    const perDay = randInt(plan.pastPerDay[0], plan.pastPerDay[1]);
    for (let i = 0; i < perDay; i++) {
      const at = new Date(TODAY_START.getTime() - d * 86400e3 + Math.floor(rand() * 80000e3));
      ordersToInsert.push(makeOrder(rest, at, false));
      pastN++;
    }
  }

  // c) A few OPEN dining sessions → the "open tables" card. Table numbers MUST be
  //    distinct per restaurant (a unique partial index allows only one open session
  //    per table), so we deal out tables 1..N rather than picking at random.
  const openN = randInt(plan.openTables[0], plan.openTables[1]);
  for (let i = 0; i < openN; i++) {
    sessionsToInsert.push({
      restaurant_id: rest.id,
      table_number: String(i + 1),     // 1,2,3… — guaranteed unique within this restaurant
      status: "open",
      opened_by: "waiter",              // CHECK-constrained to waiter/guest
      void_reason: DEMO_SESSION_TAG,    // ← idempotency marker (safe: only set on voided invoices, never on open sessions)
      opened_at: new Date(Date.now() - randInt(5, 90) * 60000).toISOString(),
    });
  }

  summary.push({ name: rest.name, today: todayN, past: pastN, open: openN });
}

// 4) Insert (chunked to stay well under any payload limits).
async function insertChunked(table, rows) {
  const size = 200;
  for (let i = 0; i < rows.length; i += size) {
    const { error } = await db.from(table).insert(rows.slice(i, i + size));
    if (error) throw new Error(`${table} insert: ${error.message}`);
  }
}
await insertChunked("orders", ordersToInsert);
await insertChunked("sessions", sessionsToInsert);

console.log(`\n✓ Inserted ${ordersToInsert.length} demo orders + ${sessionsToInsert.length} open sessions across ${restaurants.length} restaurants:`);
for (const s of summary) {
  console.log(`  • ${s.name.padEnd(24)} today=${String(s.today).padStart(2)}  earlier=${String(s.past).padStart(3)}  openTables=${s.open}`);
}
console.log("\nDone. The /owner dashboard now has meaningful numbers. Re-running this script is safe (it replaces only its own demo rows).");
