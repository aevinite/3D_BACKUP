// seed-history-all-restaurants.mjs
// Generate ~6 months of GENUINE-looking daily order history for a set of
// restaurants on the PRODUCTION DB, so owner/admin analytics graphs look real:
// lunch+dinner peaks, Fri/Sat busiest, CLOSED Sundays, slow growth trend, real
// menu dishes, discounts, cancellations, payment methods, ratings.
//
// Generalized from seed-history-french-house.mjs (which stays untouched and
// only ever targets #1). This script targets the 8 empty sample/demo
// restaurants PLUS Aangan (which already has a handful of real orders).
//
// SAFETY: PURE INSERT ONLY — no delete/cleanup step. Every restaurant this
// script targets had zero prior demo-seed history at the time it was written,
// so there is nothing to clear. Re-running it will ADD a second batch on top
// (do not re-run blindly — see cleanup SQL printed at the end for each rid).
//
// Default mode is --dry (in-memory, NO writes; prints stats per restaurant).
// Pass --write to actually insert. Reads prod creds from the MAIN .env.local.

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const MAIN_ENV = "/Users/aevinite/Documents/Projects/backup_Menu/.env.local";
const TAG = "demo-seed";
const WRITE = process.argv.includes("--write");
const DAYS = Number((process.argv.find((a) => a.startsWith("--days=")) || "").split("=")[1]) || 183;

const TARGETS = [
  "pizza-palace", "burger-barn", "spice-route", "sakura-sushi",
  "taco-fiesta", "green-bowl", "demo-bistro", "og-s-cafe",
  "aangan-garden-restaurant",
];

const env = Object.fromEntries(
  readFileSync(MAIN_ENV, "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; })
);
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// ── deterministic RNG (mulberry32), seeded per restaurant so each looks distinct ──
function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function seedFromSlug(slug) { let h = 0; for (const c of slug) h = (h * 31 + c.charCodeAt(0)) | 0; return (h ^ 0x9e3779b9) >>> 0; }

const WEEKDAY = { 0: 0, 1: 0.82, 2: 0.86, 3: 0.92, 4: 1.0, 5: 1.28, 6: 1.4 }; // Sun closed
const COMMENTS = ["Loved the ambience","Food was delicious","A bit slow but worth it","Best in town","Great service","Portions were generous","Will come again","Great value","Dessert was heavenly","Cozy place","Slightly pricey","Staff very friendly"];
const NAMES = ["Aarav","Diya","Vivaan","Ananya","Kabir","Isha","Rohan","Meera","Arjun","Saanvi","Devansh","Aisha","Reyansh","Riya","Kunal","Nisha","Aditya","Pooja","Karan","Tara"];
const PAY = [["UPI", 0.5], ["Cash", 0.22], ["Card", 0.25], ["Other", 0.03]];
const DISC_NOTES = ["", "", "", "", "Loyalty regular", "Happy hour", "Birthday treat", "Weekday special", "Combo offer", "Manager comp", "Repeat guest", ""];
const RATING = [[5, 0.55], [4, 0.25], [3, 0.12], [2, 0.05], [1, 0.03]];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function insertChunked(db, table, rows, cols) {
  const size = 400; let done = 0; const ids = [];
  for (let i = 0; i < rows.length; i += size) {
    const slice = rows.slice(i, i + size).map((r) => { const o = {}; for (const c of cols) o[c] = r[c]; return o; });
    let lastErr = null;
    for (let attempt = 1; attempt <= 5; attempt++) {
      const { data, error } = await db.from(table).insert(slice).select("id");
      if (!error) { for (const x of data) ids.push(x.id); lastErr = null; break; }
      lastErr = error;
      process.stdout.write(`\n     ${table} @${i}: attempt ${attempt} failed (${error.message}) — retrying in ${attempt}s\n`);
      await sleep(attempt * 1000);
    }
    if (lastErr) throw new Error(`${table} insert @${i} after 5 attempts: ${lastErr.message}`);
    done += slice.length; process.stdout.write(`\r     ${table}: ${done}/${rows.length}`);
  }
  console.log("");
  return ids;
}

async function seedRestaurant(rest, tableCount, isLive) {
  const rand = rng(seedFromSlug(rest.slug));
  const randInt = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const wpick = (pairs) => { let s = pairs.reduce((a, [, w]) => a + w, 0), r = rand() * s; for (const [v, w] of pairs) { if ((r -= w) <= 0) return v; } return pairs[0][0]; };
  function gauss(mean, sd, lo, hi) { let u = 0, v = 0; while (!u) u = rand(); while (!v) v = rand(); const g = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); return Math.min(hi, Math.max(lo, mean + g * sd)); }

  const { data: menu, error: mErr } = await db.from("menu_items").select("slug,title,price,category").eq("restaurant_id", rest.id);
  if (mErr) throw new Error(`${rest.slug} menu_items: ${mErr.message}`);
  if (!menu?.length) { console.log(`  ⚠ ${rest.slug}: no menu items — skipping`); return null; }
  const menuW = menu.map((m) => ({ ...m, price: Number(m.price) || 250, w: Math.pow(rand(), 2) * 9 + 0.3 }));

  const maxTable = Math.min(Math.max(tableCount || 20, 10), 40); // realistic bill-history spread, cap at 40 even if the row says 300

  function orderTime(dateIST) {
    const slot = rand();
    let h;
    if (slot < 0.42) h = gauss(13.2, 0.7, 11.5, 15.0);
    else if (slot < 0.96) h = gauss(20.5, 0.95, 18.5, 22.9);
    else h = pick([11.3, 15.5, 16.5, 17.5, 18.0]);
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

  // "busy realistic" volume: ~2x French House's proven model (BASE 150→260, cap 230→400)
  const BASE = 260;
  const orders = [], feedback = [];
  const nowIST = new Date(Date.now() + 5.5 * 3600e3);
  const todayISTStr = nowIST.toISOString().slice(0, 10);
  let byMonth = {}, statusTally = { paid: 0, cancelled: 0, live: 0 }, revenue = 0;

  for (let d = DAYS - 1; d >= 0; d--) {
    const dayMs = Date.parse(todayISTStr + "T00:00:00+05:30") - d * 86400e3;
    const dISTStr = new Date(dayMs + 5.5 * 3600e3).toISOString().slice(0, 10);
    const istDow = new Date(dayMs).getUTCDay();
    if (WEEKDAY[istDow] === 0) continue; // closed Sundays

    const trend = 0.82 + (1 - d / DAYS) * 0.32;
    const noise = 0.9 + rand() * 0.22;
    let count = Math.round(BASE * trend * WEEKDAY[istDow] * noise);
    count = Math.min(400, Math.max(150, count));
    const isToday = dISTStr === todayISTStr;
    if (isToday) { const frac = Math.min(1, (Date.now() - dayMs) / 86400e3 * 1.6); count = Math.round(count * frac); }

    const dayOrders = [];
    for (let i = 0; i < count; i++) {
      const at = orderTime(dISTStr);
      const { items, subtotal } = makeItems();
      const tax = Math.round(subtotal * 0.05 * 100) / 100;
      const total = Math.round((subtotal + tax) * 100) / 100;
      const cancelled = rand() < 0.07;
      const live = isToday && !cancelled && rand() < 0.12;
      // A discount can never be larger than the food it comes off. This line used to pick from
      // the list below without looking at the order it was attaching to, so on a ₹39 bill it
      // could hand out ₹200 — and every money surface reads `total − discount × (1 + rate)`, so
      // 40 seeded bills came out NEGATIVE (−₹519.75 on Aangan alone, −₹1,399.65 across six
      // restaurants). The database now clamps this too (migration 295), but a seeder that plants
      // a nonsense figure and relies on being corrected is still a seeder that lies about what
      // it wrote. Cap it at the subtotal here, at the source.
      const wanted = (!cancelled && rand() < 0.16) ? wpick([[50,4],[75,3],[100,3],[125,2],[150,2],[200,1]]) : 0;
      const discount = Math.min(wanted, subtotal);
      const paid = !cancelled && !live;
      const dnote = discount > 0 ? (pick(DISC_NOTES) || null) : TAG;
      dayOrders.push({
        restaurant_id: rest.id,
        table_number: String(randInt(1, maxTable)),
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

  console.log(`\n▶ ${rest.slug} (${rest.name}) — menu=${menu.length} tables=1-${maxTable}`);
  console.log(`   generated ${orders.length} orders  paid=${statusTally.paid} cancelled=${statusTally.cancelled} live=${statusTally.live}`);
  console.log(`   modelled paid revenue ≈ ₹${Math.round(revenue).toLocaleString("en-IN")}  avg order ≈ ₹${Math.round(revenue / Math.max(1, statusTally.paid))}`);

  if (!WRITE) return { orders: orders.length, revenue };

  const ORDER_COLS = ["restaurant_id","table_number","items","subtotal","tax","total","discount","discount_note","status","payment_status","archived","payment_method","paid_at","created_at","kot_no"];
  const ids = await insertChunked(db, "orders", orders, ORDER_COLS);
  orders.forEach((o, i) => { o.id = ids[i]; });
  for (const o of orders) {
    if (o._cancelled || !o._paid) continue;
    if (rand() < 0.24) {
      feedback.push({
        order_id: o.id, restaurant_id: rest.id, table_number: o.table_number,
        rating: wpick(RATING),
        comment: rand() < 0.3 ? pick(COMMENTS) : null,
        name: rand() < 0.4 ? pick(NAMES) : null,
        acknowledged: rand() < 0.6,
        created_at: new Date(o._at + randInt(20, 120) * 60000).toISOString(),
      });
    }
  }
  const FB_COLS = ["order_id","restaurant_id","table_number","rating","comment","name","acknowledged","created_at"];
  await insertChunked(db, "feedback", feedback, FB_COLS);

  let sessions = [];
  if (isLive) {
    console.log(`   ⚠ ${rest.slug} has real pre-existing orders — skipping fake open-table sessions (would collide with real live floor state)`);
  } else {
    sessions = Array.from({ length: 6 }, (_, i) => ({
      restaurant_id: rest.id, table_number: String(i + 1), status: "open", opened_by: "waiter",
      void_reason: TAG, opened_at: new Date(Date.now() - randInt(8, 95) * 60000).toISOString(),
    }));
    await insertChunked(db, "sessions", sessions, ["restaurant_id","table_number","status","opened_by","void_reason","opened_at"]);
  }

  console.log(`   ✓ inserted orders=${orders.length} feedback=${feedback.length} open_tables=${sessions.length}`);
  return { orders: orders.length, revenue };
}

// ── main ───────────────────────────────────────────────────────────────────
const ONLY = (process.argv.find((a) => a.startsWith("--only=")) || "").split("=")[1];
const RUN_TARGETS = ONLY ? ONLY.split(",") : TARGETS;
const { data: rests, error: rErr } = await db.from("restaurants").select("id,slug,name").in("slug", RUN_TARGETS);
if (rErr) throw new Error(rErr.message);
const { data: settingsRows } = await db.from("settings").select("restaurant_id,table_count").in("restaurant_id", rests.map((r) => r.id));
const tableCountById = Object.fromEntries((settingsRows || []).map((s) => [s.restaurant_id, s.table_count]));

console.log(`▶ target DB: ${env.NEXT_PUBLIC_SUPABASE_URL}`);
console.log(`▶ mode: ${WRITE ? "WRITE" : "DRY-RUN"}  days: ${DAYS}  restaurants: ${rests.length}/${RUN_TARGETS.length}`);
const missing = RUN_TARGETS.filter((s) => !rests.some((r) => r.slug === s));
if (missing.length) console.log(`⚠ not found, skipping: ${missing.join(", ")}`);

// snapshot pre-existing order ids per restaurant BEFORE inserting, so a later
// cleanup can exclude real rows (this matters for aangan-garden-restaurant,
// which already has real orders) instead of matching on created_at (the
// seeded rows carry HISTORICAL timestamps spread over 6 months, not "now").
const preExistingIds = {};
for (const rest of rests) {
  const { data: existing, error } = await db.from("orders").select("id").eq("restaurant_id", rest.id);
  if (error) throw new Error(`pre-check ${rest.slug}: ${error.message}`);
  preExistingIds[rest.id] = (existing || []).map((r) => r.id);
}

let totalOrders = 0;
for (const rest of rests) {
  const res = await seedRestaurant(rest, tableCountById[rest.id], preExistingIds[rest.id].length > 0);
  if (res) totalOrders += res.orders;
}

console.log(`\n${WRITE ? "✓ DONE" : "DRY-RUN COMPLETE"} — total orders across ${rests.length} restaurants: ${totalOrders}`);
if (!WRITE) {
  console.log("Run again with --write to actually insert into PRODUCTION.");
} else {
  console.log(`\nTo remove this seeded batch later (keeps any real orders that existed BEFORE this run):`);
  for (const rest of rests) {
    const keep = preExistingIds[rest.id];
    if (keep.length === 0) {
      console.log(`  DELETE FROM orders   WHERE restaurant_id='${rest.id}';  -- ${rest.slug}, had 0 real orders before seeding`);
    } else {
      console.log(`  DELETE FROM orders   WHERE restaurant_id='${rest.id}' AND id NOT IN ('${keep.join("','")}');  -- ${rest.slug}, keeps ${keep.length} pre-existing real order(s)`);
    }
    console.log(`  DELETE FROM sessions WHERE restaurant_id='${rest.id}' AND void_reason='${TAG}';`);
  }
}
