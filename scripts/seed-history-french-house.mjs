// seed-history-french-house.mjs
// Generate ~6 months of GENUINE-looking daily order history for restaurant #1
// ("My Little French House") on the PRODUCTION DB, so the owner analytics graphs
// look real: lunch+dinner peaks, Fri/Sat busiest, CLOSED Sundays, a slow upward
// growth trend, real menu dishes, discounts, cancellations, payment methods, ratings.
//
// SAFETY: only ever touches restaurant #1, and only rows tagged discount_note/
// void_reason='demo-seed'. Default mode is --dry (in-memory, NO writes; prints stats).
// Pass --write to actually clean+insert. Reads prod creds from the MAIN .env.local.
//
// Delete everything later with:
//   DELETE FROM orders   WHERE restaurant_id='…001' AND discount_note='demo-seed';
//   DELETE FROM sessions WHERE restaurant_id='…001' AND void_reason='demo-seed';
//   (feedback rows cascade when their order is deleted)

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { refuseUnlessDevTestDb } from "./sweep/devStacks.mjs";

const MAIN_ENV = "/Users/aevinite/Documents/Projects/backup_Menu/.env.local";
const RID = "00000000-0000-0000-0000-000000000001";
const TAG = "demo-seed";
const WRITE = process.argv.includes("--write");
const DAYS = Number((process.argv.find((a) => a.startsWith("--days=")) || "").split("=")[1]) || 183;

const env = Object.fromEntries(
  readFileSync(MAIN_ENV, "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; })
);
// Which database is this? (T10 sweep, 2026-08-12 — this script had no answer.)
// One shared allow-list, in scripts/sweep/devStacks.mjs, so it knows about BOTH dev stacks
// (backup-1 and the backup-2 failover) and never about the client one.
refuseUnlessDevTestDb(env.NEXT_PUBLIC_SUPABASE_URL, "this writes months of trading history");

const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// ── deterministic RNG (mulberry32) so a re-run is reproducible ────────────────
function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rand = rng(20260707);
const randInt = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
// weighted pick: entries [value, weight]
const wpick = (pairs) => { let s = pairs.reduce((a, [, w]) => a + w, 0), r = rand() * s; for (const [v, w] of pairs) { if ((r -= w) <= 0) return v; } return pairs[0][0]; };
// gaussian via Box-Muller, clamped
function gauss(mean, sd, lo, hi) { let u = 0, v = 0; while (!u) u = rand(); while (!v) v = rand(); const g = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); return Math.min(hi, Math.max(lo, mean + g * sd)); }

// ── verify target restaurant before doing anything ────────────────────────────
const { data: rest, error: rErr } = await db.from("restaurants").select("id,slug,name").eq("id", RID).single();
if (rErr || !rest) throw new Error("restaurant #1 not found: " + (rErr?.message || "none"));
console.log(`▶ target DB: ${env.NEXT_PUBLIC_SUPABASE_URL}`);
console.log(`▶ restaurant: ${rest.name} (${rest.slug})  mode: ${WRITE ? "WRITE" : "DRY-RUN"}  days: ${DAYS}`);
if (rest.slug !== "french-house") throw new Error("slug mismatch — refusing (safety).");

// ── real menu → realistic totals + resolvable dish/category charts ────────────
const { data: menu, error: mErr } = await db.from("menu_items").select("slug,title,price,category").eq("restaurant_id", RID);
if (mErr) throw new Error("menu_items: " + mErr.message);
if (!menu?.length) throw new Error("no menu items for #1");
// give each dish a stable popularity weight (a few bestsellers, a long tail)
const menuW = menu.map((m) => ({ ...m, price: Number(m.price) || 250, w: Math.pow(rand(), 2) * 9 + 0.3 }));
console.log(`▶ menu items: ${menu.length}  price range ₹${Math.min(...menuW.map(m=>m.price))}–₹${Math.max(...menuW.map(m=>m.price))}`);

// ── genuine-history model ─────────────────────────────────────────────────────
const WEEKDAY = { 0: 0, 1: 0.82, 2: 0.86, 3: 0.92, 4: 1.0, 5: 1.28, 6: 1.4 }; // Sun closed
const BASE = 150;
const COMMENTS = ["Loved the ambience","Food was delicious","A bit slow but worth it","Best French food in town","Great service","Portions were generous","Will come again","Wine pairing was perfect","Dessert was heavenly","Cozy place","Slightly pricey","Staff very friendly"];
const NAMES = ["Aarav","Diya","Vivaan","Ananya","Kabir","Isha","Rohan","Meera","Arjun","Saanvi","Devansh","Aisha","Reyansh","Riya","Kunal","Nisha","Aditya","Pooja","Karan","Tara"];
const PAY = [["UPI", 0.5], ["Cash", 0.22], ["Card", 0.25], ["Other", 0.03]];
// Realistic discount reasons. The manager/tablet order view SHOWS discount_note
// whenever discount>0, so discounted rows must NOT carry the 'demo-seed' tag (it
// would read as planted). Zero-discount rows keep the tag (never rendered). Removal
// therefore keys off restaurant + created_at cutoff, not the note (see footer).
const DISC_NOTES = ["", "", "", "", "Loyalty regular", "Happy hour", "Birthday treat", "Weekday special", "Combo offer", "Manager comp", "Repeat guest", ""];
const RATING = [[5, 0.55], [4, 0.25], [3, 0.12], [2, 0.05], [1, 0.03]];

function orderTime(dateIST) {
  // dateIST = "YYYY-MM-DD". Returns a UTC Date at a realistic meal-time on that IST day.
  const slot = rand();
  let h; // IST wall-clock hour (fractional)
  if (slot < 0.42) h = gauss(13.2, 0.7, 11.5, 15.0);        // lunch peak
  else if (slot < 0.96) h = gauss(20.5, 0.95, 18.5, 22.9);  // dinner peak
  else h = pick([11.3, 15.5, 16.5, 17.5, 18.0]);            // off-peak trickle
  const hh = Math.floor(h), mm = Math.floor((h - hh) * 60), ss = randInt(0, 59);
  return new Date(`${dateIST}T${String(hh).padStart(2,"0")}:${String(mm).padStart(2,"0")}:${String(ss).padStart(2,"0")}+05:30`);
}
function makeItems() {
  const n = wpick([[1, 0.30], [2, 0.38], [3, 0.22], [4, 0.10]]);
  const line = []; let subtotal = 0;
  for (let k = 0; k < n; k++) {
    const it = wpick(menuW.map((m) => [m, m.w]));
    const qty = wpick([[1, 0.68], [2, 0.24], [3, 0.08]]);
    subtotal += it.price * qty;
    line.push({ slug: it.slug, title: it.title, qty, price: it.price });
  }
  return { items: line, subtotal };
}

// ── build all rows ────────────────────────────────────────────────────────────
const orders = [], feedback = [];
const nowIST = new Date(Date.now() + 5.5 * 3600e3);
const todayISTStr = nowIST.toISOString().slice(0, 10);
let byMonth = {}, statusTally = { paid: 0, cancelled: 0, live: 0 }, revenue = 0, ratingCount = 0;

for (let d = DAYS - 1; d >= 0; d--) {
  const dayMs = Date.parse(todayISTStr + "T00:00:00+05:30") - d * 86400e3;
  const dISTStr = new Date(dayMs + 5.5 * 3600e3).toISOString().slice(0, 10);
  const dow = new Date(dISTStr + "T12:00:00+05:30").getUTCDay(); // day-of-week in a stable way
  const istDow = new Date(dayMs).getUTCDay(); // dayMs is IST-midnight-as-UTC-instant; getUTCDay → IST weekday
  if (WEEKDAY[istDow] === 0) continue; // CLOSED Sundays

  const trend = 0.82 + (1 - d / DAYS) * 0.32;           // slow growth over 6 months
  const noise = 0.9 + rand() * 0.22;
  let count = Math.round(BASE * trend * WEEKDAY[istDow] * noise);
  count = Math.min(230, Math.max(90, count));
  const isToday = dISTStr === todayISTStr;
  if (isToday) { const frac = Math.min(1, (Date.now() - dayMs) / 86400e3 * 1.6); count = Math.round(count * frac); }

  // generate this day's orders, then sort by time to assign a daily kot_no sequence
  const dayOrders = [];
  for (let i = 0; i < count; i++) {
    const at = orderTime(dISTStr);
    const { items, subtotal } = makeItems();
    const tax = Math.round(subtotal * 0.05 * 100) / 100;
    const total = Math.round((subtotal + tax) * 100) / 100;
    const cancelled = rand() < 0.07;
    const live = isToday && !cancelled && rand() < 0.12;
    const discount = (!cancelled && rand() < 0.16) ? wpick([[50,4],[75,3],[100,3],[125,2],[150,2],[200,1]]) : 0;
    const paid = !cancelled && !live;
    // discounted rows get a human note (shown in the UI); zero-discount rows carry
    // the invisible 'demo-seed' tag.
    const dnote = discount > 0 ? (pick(DISC_NOTES) || null) : TAG;
    dayOrders.push({
      restaurant_id: RID,
      table_number: String(randInt(1, 14)),
      items, subtotal, tax, total,
      discount, discount_note: dnote,
      status: cancelled ? "cancelled" : (live ? pick(["received", "preparing"]) : "served"),
      payment_status: paid ? "paid" : "pending",
      archived: paid || cancelled,
      payment_method: paid ? wpick(PAY) : null,
      paid_at: paid ? at.toISOString() : null,
      created_at: at.toISOString(),
      _at: at.getTime(), _paid: paid, _cancelled: cancelled,
    });
  }
  dayOrders.sort((a, b) => a._at - b._at);
  dayOrders.forEach((o, idx) => { o.kot_no = idx + 1; });

  for (const o of dayOrders) {
    const mk = dISTStr.slice(0, 7);
    byMonth[mk] = (byMonth[mk] || 0) + 1;
    if (o._cancelled) statusTally.cancelled++;
    else if (!o._paid) statusTally.live++;
    else { statusTally.paid++; revenue += o.total - o.discount * 1.05; }
    orders.push(o);
  }
}

// tag feedback onto a subset of PAID orders (needs a real order id → assigned after insert)
console.log(`\n▶ generated ${orders.length} orders`);
console.log(`   paid=${statusTally.paid}  cancelled=${statusTally.cancelled}  live/today=${statusTally.live}`);
console.log(`   modelled paid revenue ≈ ₹${Math.round(revenue).toLocaleString("en-IN")}`);
console.log(`   avg order (paid) ≈ ₹${Math.round(revenue / Math.max(1, statusTally.paid))}`);
console.log("   orders per month:");
for (const [m, c] of Object.entries(byMonth).sort()) console.log(`     ${m}: ${c}`);

if (!WRITE) {
  console.log("\nDRY-RUN — no rows written. Sample orders:");
  for (const o of [orders[0], orders[Math.floor(orders.length/2)], orders[orders.length-1]]) {
    console.log(`   ${o.created_at}  kot#${o.kot_no}  ${o.status}/${o.payment_status}  ₹${o.total}  ${o.payment_method||"-"}  items=${o.items.length}`);
  }
  console.log("\nRun again with --write to clean+insert into PRODUCTION.");
  process.exit(0);
}

// ── WRITE: clean prior demo-seed rows, then insert ────────────────────────────
console.log("\n▶ WRITE mode: clearing prior seeded rows for #1 …");
{
  // Discounted rows no longer carry the tag (they get human notes), so a re-run
  // clears ALL of #1's orders dated before this run — safe while #1 holds only
  // seeded history. (Guard: if #1 ever takes REAL orders, narrow this first.)
  const runStart = new Date().toISOString();
  const d1 = await db.from("orders").delete().eq("restaurant_id", RID).lte("created_at", runStart);
  if (d1.error) throw new Error("clear orders: " + d1.error.message);
  const d2 = await db.from("sessions").delete().eq("restaurant_id", RID).eq("void_reason", TAG);
  if (d2.error) throw new Error("clear sessions: " + d2.error.message);
}
async function insertChunked(table, rows, cols) {
  const size = 400; let done = 0; const ids = [];
  for (let i = 0; i < rows.length; i += size) {
    const slice = rows.slice(i, i + size).map((r) => { const o = {}; for (const c of cols) o[c] = r[c]; return o; });
    const { data, error } = await db.from(table).insert(slice).select("id");
    if (error) throw new Error(`${table} insert @${i}: ${error.message}`);
    for (const x of data) ids.push(x.id);
    done += slice.length; process.stdout.write(`\r   ${table}: ${done}/${rows.length}`);
  }
  console.log("");
  return ids;
}
const ORDER_COLS = ["restaurant_id","table_number","items","subtotal","tax","total","discount","discount_note","status","payment_status","archived","payment_method","paid_at","created_at","kot_no"];
const ids = await insertChunked("orders", orders, ORDER_COLS);

// attach ids back (insert preserves order within each chunk) and build feedback for a subset
orders.forEach((o, i) => { o.id = ids[i]; });
for (const o of orders) {
  if (o._cancelled || !o._paid) continue;
  if (rand() < 0.24) {
    feedback.push({
      order_id: o.id, restaurant_id: RID, table_number: o.table_number,
      rating: wpick(RATING),
      comment: rand() < 0.3 ? pick(COMMENTS) : null,
      name: rand() < 0.4 ? pick(NAMES) : null,
      acknowledged: rand() < 0.6,
      created_at: new Date(o._at + randInt(20, 120) * 60000).toISOString(),
    });
  }
}
const FB_COLS = ["order_id","restaurant_id","table_number","rating","comment","name","acknowledged","created_at"];
await insertChunked("feedback", feedback, FB_COLS);

// a few OPEN tables today so the live cockpit isn't empty
const sessions = [];
for (let i = 0; i < 6; i++) sessions.push({
  restaurant_id: RID, table_number: String(i + 1), status: "open", opened_by: "waiter",
  void_reason: TAG, opened_at: new Date(Date.now() - randInt(8, 95) * 60000).toISOString(),
});
await insertChunked("sessions", sessions, ["restaurant_id","table_number","status","opened_by","void_reason","opened_at"]);

console.log(`\n✓ DONE. orders=${orders.length}  feedback=${feedback.length}  open_tables=${sessions.length}`);
console.log("Delete this seeded history (run BEFORE any real orders accrue on #1):");
console.log("  DELETE FROM orders   WHERE restaurant_id='"+RID+"' AND created_at <= now();");
console.log("  DELETE FROM sessions WHERE restaurant_id='"+RID+"' AND void_reason='"+TAG+"';");
