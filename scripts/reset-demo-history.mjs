// reset-demo-history.mjs — replace the demo restaurants' invented history with a SMALL, realistic
// two months, so this database fits in the memory the machine actually has.
//
//   npm run demo:reset              # plan only, writes nothing
//   npm run demo:reset -- --apply   # do it
//
// WHY. The backup database had **399 449 orders** — 281 MB of a 322 MB database on a machine whose
// Postgres can only cache **224 MB**. Nothing fit, so every report read from disk and evicted the
// floor's hot pages, which is how one heavy query made unrelated panels slow enough to be cancelled
// at the 8-second wall. None of it was real: 338 748 rows carried the `demo-seed` tag and most of the
// rest were the same generator's discounted rows (`Happy hour`, `Manager comp`, …), seeded as ~6
// months × 9 restaurants at ~400 orders/day each. That is far more history than any real restaurant
// produces, and it bought nothing except load.
//
// This replaces it with **~3 000 orders a week across all demo restaurants for the last two months**
// — a believable trading pattern instead of a synthetic mountain.
//
// WHAT IT DOES NOT TOUCH: restaurants, settings, menu_items, categories, filters, staff_users,
// permissions, owners. Only trading history. Aangan keeps its factory-default permission set (it is
// the QA control), and every restaurant keeps its menu — so the 501-phase suite still has what it
// needs.
//
// ON THE COMPLIANCE RULE. An issued bill can never be hard-deleted: a BEFORE DELETE trigger
// (mig 190) blocks it for everyone including the service role, because the product must be
// incapable of hiding a sale. That rule is about REAL sales. These rows are generated fixtures on the
// dev/backup database — no sale ever happened, no GST was ever charged, no customer ever paid. The
// trigger's own audited escape hatch (`lfh.allow_purge`, transaction-local) is used, the same one the
// 90-day restaurant purge uses. Deliberately NO new permanent purge function is added — that would
// widen the surface the rule exists to protect. This is a one-off maintenance run, and it refuses to
// point at anything but the backup database.
import { readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const env = Object.fromEntries(
  readFileSync(join(ROOT, ".env.local"), "utf8").split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }),
);
const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
const BACKUP_REF = "wnsfcizclkbobwzcxqsf";
if (ref !== BACKUP_REF) {
  console.error(`This points at project "${ref}", not the backup database (${BACKUP_REF}). Refusing.`);
  console.error("Demo history is never reset on the client stack.");
  process.exit(1);
}
const APPLY = process.argv.includes("--apply");

// Never pull the data out from under a running test suite — that is how a green suite turns into
// forty confusing failures that are the rig's fault, not the product's.
if (APPLY) {
  const lock = join(ROOT, ".claude", "verify-everything.lock");
  let running = false;
  try { running = /verify-everything\.mjs/.test(execSync("ps -Ao command", { encoding: "utf8" })); } catch { /* can't check → fall through */ }
  if (existsSync(lock) || running) {
    console.error("A full test suite is running against this database. Wait for it — deleting its data mid-run");
    console.error("would produce failures that look like product bugs. (Check: ps -Ao pid,etime,command | grep verify-)");
    process.exit(2);
  }
}

const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const pat = env.SUPABASE_ACCESS_TOKEN;
const sql = async (query) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST", headers: { Authorization: `Bearer ${pat}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }), signal: AbortSignal.timeout(600000),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${t.slice(0, 300)}`);
  return JSON.parse(t);
};

const TAG = "demo-seed";
const DAYS = 61;                       // the last two months

// Orders per WEEK, per restaurant. Totals ~3 000/week across the demos, which is what a busy real
// place does — and about 7% of what was here before. The flagship carries most of it because that is
// the one people open and the one the suite writes to.
const WEEKLY = {
  "french-house": 1000,
  "aangan-garden-restaurant": 600,
  "green-bowl": 500,
  "demo-bistro": 250,
  "pizza-palace": 200,
  "spice-route": 150,
  "burger-barn": 120,
  "sakura-sushi": 100,
  "taco-fiesta": 100,
  "og-s-cafe": 80,
};

// Sunday is the BUSIEST day, not a closed one (owner: "sunday some time rush hour"). Monday and
// Tuesday are the quiet ones, which is what actually happens in a restaurant.
const DOW_WEIGHT = { 0: 1.45, 1: 0.80, 2: 0.78, 3: 0.88, 4: 0.98, 5: 1.22, 6: 1.38 };

const PAY = [["UPI", 0.5], ["Cash", 0.22], ["Card", 0.25], ["Other", 0.03]];
const DISC_NOTES = ["Loyalty regular", "Happy hour", "Birthday treat", "Weekday special", "Combo offer", "Manager comp", "Repeat guest"];
const RATING = [[5, 0.55], [4, 0.25], [3, 0.12], [2, 0.05], [1, 0.03]];
const COMMENTS = ["Loved the ambience", "Food was delicious", "A bit slow but worth it", "Best in town", "Great service", "Portions were generous", "Will come again", "Great value", "Dessert was heavenly", "Cozy place", "Slightly pricey", "Staff very friendly"];
const NAMES = ["Aarav", "Diya", "Vivaan", "Ananya", "Kabir", "Isha", "Rohan", "Meera", "Arjun", "Saanvi", "Devansh", "Aisha", "Reyansh", "Riya", "Kunal", "Nisha", "Aditya", "Pooja", "Karan", "Tara"];

// deterministic per restaurant, so a re-run reproduces the same history
const rng = (seed) => { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const seedFromSlug = (s) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return (h ^ 0x9e3779b9) >>> 0; };

async function insertChunked(table, rows, cols) {
  const size = 400; let done = 0; const ids = [];
  for (let i = 0; i < rows.length; i += size) {
    const slice = rows.slice(i, i + size).map((r) => { const o = {}; for (const c of cols) o[c] = r[c]; return o; });
    let lastErr = null;
    for (let attempt = 1; attempt <= 5; attempt++) {
      const { data, error } = await db.from(table).insert(slice).select("id");
      if (!error) { for (const x of data) ids.push(x.id); lastErr = null; break; }
      lastErr = error;
      await new Promise((r) => setTimeout(r, attempt * 1000));
    }
    if (lastErr) throw new Error(`${table} insert @${i}: ${lastErr.message}`);
    done += slice.length;
    process.stdout.write(`\r     ${table}: ${done}/${rows.length}   `);
  }
  process.stdout.write("\n");
  return ids;
}

const rests = await sql(`
  SELECT r.id, r.slug, r.name, COALESCE(s.table_count, 20) AS table_count,
         lfh_effective_tax_rate(r.id) AS rate
    FROM restaurants r LEFT JOIN settings s ON s.restaurant_id = r.id
   WHERE r.slug = ANY(ARRAY[${Object.keys(WEEKLY).map((s) => `'${s}'`).join(",")}])
   ORDER BY r.slug`);

console.log(`\ndemo history reset · last ${DAYS} days · ${APPLY ? "APPLYING" : "plan only (add --apply to act)"}`);
console.log("─".repeat(94));
const [{ before_orders, before_size }] = await sql(
  `SELECT (SELECT count(*) FROM orders) AS before_orders, pg_size_pretty(pg_database_size(current_database())) AS before_size`);
console.log(`today: ${Number(before_orders).toLocaleString()} orders, database ${before_size}\n`);

let planned = 0;
const perRest = [];
for (const r of rests) {
  const weekly = WEEKLY[r.slug];
  const n = Math.round((weekly / 7) * DAYS);
  planned += n;
  perRest.push({ ...r, weekly, n });
  console.log(`  ${r.slug.padEnd(26)} ${String(weekly).padStart(5)}/week → ~${String(n).padStart(6)} orders   tax ${(Number(r.rate) * 100).toFixed(0)}%`);
}
console.log(`\n  total ≈ ${planned.toLocaleString()} orders (was ${Number(before_orders).toLocaleString()} — about ${(planned / Number(before_orders) * 100).toFixed(0)}%)`);

if (!APPLY) {
  console.log("\nNothing was changed. Re-run with --apply to wipe the old history and write this.");
  process.exit(0);
}

// ── 1. remove the old invented history ──────────────────────────────────────────────────────────
// IN BATCHES, and with the LIVE-ONLY triggers suspended inside each batch.
//
// The first attempt did it in one statement and was cancelled at the wall, because every deleted
// order fires `rt_emit_orders` → lfh_rt_emit() → lfh_rt_prune(): removing 370 000 rows meant 370 000
// realtime breadcrumbs and prunes for history nobody is watching. Suspending those three
// live-behaviour triggers took a 40 000-row batch to ~50s.
//
// Each batch is ONE statement, so it is one transaction: if anything fails, the DISABLE rolls back
// with it and the triggers can never be left switched off. `trg_block_issued_delete` — the guard that
// stops the product hiding a sale — is deliberately NOT disabled; the audited `lfh.allow_purge` flag
// is used instead, which is the door that guard was built with.
console.log("\nremoving the old invented history (in batches, live triggers suspended per batch)…");
const ids = rests.map((r) => `'${r.id}'`).join(",");

// the small dependent tables first — they are quick and it lightens the order deletes
await sql(`
  SELECT set_config('lfh.allow_purge', 'on', true);
  DELETE FROM order_items    WHERE restaurant_id IN (${ids});
  DELETE FROM feedback       WHERE restaurant_id IN (${ids});
  DELETE FROM payments       WHERE restaurant_id IN (${ids});
  DELETE FROM invoice_events WHERE restaurant_id IN (${ids});
  DELETE FROM session_members WHERE restaurant_id IN (${ids});
  DELETE FROM waiter_calls   WHERE restaurant_id IN (${ids});
  DELETE FROM requests       WHERE restaurant_id IN (${ids});
`);
console.log("  dependent rows cleared");

const BATCH = 40000;
for (let pass = 1; ; pass++) {
  const t0 = Date.now();
  const res = await sql(`
    SELECT set_config('lfh.allow_purge', 'on', true);
    ALTER TABLE public.orders DISABLE TRIGGER rt_emit_orders;
    ALTER TABLE public.orders DISABLE TRIGGER trg_orders_watermark;
    ALTER TABLE public.orders DISABLE TRIGGER trg_resplit_bill_discount;
    ALTER TABLE public.orders DISABLE TRIGGER trg_inv_deplete_order;
    WITH doomed AS (SELECT id FROM orders WHERE restaurant_id IN (${ids}) LIMIT ${BATCH})
    DELETE FROM orders o USING doomed d WHERE o.id = d.id;
    ALTER TABLE public.orders ENABLE TRIGGER rt_emit_orders;
    ALTER TABLE public.orders ENABLE TRIGGER trg_orders_watermark;
    ALTER TABLE public.orders ENABLE TRIGGER trg_resplit_bill_discount;
    ALTER TABLE public.orders ENABLE TRIGGER trg_inv_deplete_order;
    SELECT count(*)::text AS left FROM orders WHERE restaurant_id IN (${ids});`);
  const left = Number(res[0]?.left ?? 0);
  console.log(`  pass ${String(pass).padStart(2)}: ${left.toLocaleString()} left  (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  if (!left) break;
  if (pass > 40) throw new Error("too many passes — stopping rather than looping forever");
}

// sessions last: their own delete trigger cancels orders, which is pointless once the orders are gone
await sql(`
  SELECT set_config('lfh.allow_purge', 'on', true);
  ALTER TABLE public.sessions DISABLE TRIGGER rt_emit_sessions;
  ALTER TABLE public.sessions DISABLE TRIGGER trg_session_delete;
  DELETE FROM sessions       WHERE restaurant_id IN (${ids});
  DELETE FROM daily_counters WHERE restaurant_id IN (${ids});
  ALTER TABLE public.sessions ENABLE TRIGGER rt_emit_sessions;
  ALTER TABLE public.sessions ENABLE TRIGGER trg_session_delete;
`);

// never leave a trigger off: prove every one is back before writing anything
const off = await sql(`SELECT c.relname||'.'||t.tgname AS n FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
  WHERE c.relname IN ('orders','sessions') AND NOT t.tgisinternal AND t.tgenabled <> 'O'`);
if (off.length) {
  console.error("\nTRIGGERS LEFT DISABLED — fix before anything else:");
  for (const x of off) console.error(`  ${x.n}`);
  process.exit(1);
}
console.log("  all triggers verified enabled again");

// ── 2. write the new two months ─────────────────────────────────────────────────────────────────
const nowIST = new Date(Date.now() + 5.5 * 3600e3);
const todayIST = nowIST.toISOString().slice(0, 10);

for (const r of perRest) {
  const rand = rng(seedFromSlug(r.slug));
  const randInt = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));
  const pick = (a) => a[Math.floor(rand() * a.length)];
  const wpick = (pairs) => { let s = pairs.reduce((a, [, w]) => a + w, 0), x = rand() * s; for (const [v, w] of pairs) if ((x -= w) <= 0) return v; return pairs[0][0]; };
  const gauss = (mean, sd, lo, hi) => { let u = 0, v = 0; while (!u) u = rand(); while (!v) v = rand(); const g = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); return Math.min(hi, Math.max(lo, mean + g * sd)); };

  const { data: menu } = await db.from("menu_items").select("slug,title,price").eq("restaurant_id", r.id);
  if (!menu?.length) { console.log(`  ⚠ ${r.slug}: no menu — skipped`); continue; }
  const menuW = menu.map((m) => ({ ...m, price: Number(m.price) || 250, w: Math.pow(rand(), 2) * 9 + 0.3 }));
  const rate = Number(r.rate) || 0.05;
  const maxTable = Math.min(Math.max(Number(r.table_count) || 20, 8), 30);

  // RUSH HOURS. Lunch 12–15 and dinner 19–23, dinner heavier — and on Sundays the lunch peak grows
  // (families eat out at midday), which is what "Sunday rush" actually looks like.
  function orderTime(dateIST, dow) {
    const lunchShare = dow === 0 ? 0.52 : 0.40;
    const x = rand();
    let h;
    if (x < lunchShare) h = gauss(13.2, 0.75, 11.5, 15.2);
    else if (x < 0.965) h = gauss(20.4, 1.0, 18.5, 22.9);
    else h = pick([11.2, 15.6, 16.4, 17.4, 18.1, 23.2]);
    const hh = Math.floor(h), mm = Math.floor((h - hh) * 60);
    return new Date(`${dateIST}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:${String(randInt(0, 59)).padStart(2, "0")}+05:30`);
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

  const perDay = r.weekly / 7;
  const orders = [];
  let paidN = 0, cancelledN = 0, revenue = 0;

  for (let d = DAYS - 1; d >= 0; d--) {
    const dayMs = Date.parse(todayIST + "T00:00:00+05:30") - d * 86400e3;
    const dISTStr = new Date(dayMs + 5.5 * 3600e3).toISOString().slice(0, 10);
    // The IST weekday, not the UTC one. `dayMs` is midnight IST = 18:30 UTC the day BEFORE, so
    // getUTCDay() on it returns the previous day and every weight lands one day early — the first
    // run put Sunday's rush on Monday. Shift into IST first, exactly as dISTStr above does.
    const dow = new Date(dayMs + 5.5 * 3600e3).getUTCDay();
    // a real week is uneven, and roughly one day in twelve is unusually busy (a match, a festival,
    // a big booking) — that is the "rush" the owner means, not a uniform average
    const rush = rand() < 0.085 ? 1.45 : 1;
    const count = Math.max(1, Math.round(perDay * DOW_WEIGHT[dow] * (0.85 + rand() * 0.3) * rush));
    const isToday = dISTStr === todayIST;
    const n = isToday ? Math.max(1, Math.round(count * Math.min(1, (Date.now() - dayMs) / 86400e3 * 1.6))) : count;

    const day = [];
    for (let i = 0; i < n; i++) {
      // NEVER date an order in the future. Today's COUNT is scaled by how much of the day has gone,
      // but the TIME was still drawn from the whole 11:00–23:00 spread — so a morning run wrote
      // dinner orders that had not happened yet. They then sat on the same tables the test suite
      // uses, and its freshly placed order read back a total of 2247 instead of 1100 (phase 172).
      // Redraw a few times, then fall back to a moment just before now.
      let at = orderTime(dISTStr, dow);
      if (isToday) {
        for (let tries = 0; tries < 8 && at.getTime() > Date.now(); tries++) at = orderTime(dISTStr, dow);
        if (at.getTime() > Date.now()) at = new Date(Date.now() - randInt(60, 7200) * 1000);
      }
      const { items, subtotal } = makeItems();
      const tax = Math.round(subtotal * rate * 100) / 100;
      const total = Math.round((subtotal + tax) * 100) / 100;
      const cancelled = rand() < 0.025;                       // a real kitchen cancels a few
      // NOTHING is left "live". These history rows carry no session_id (like a banquet or a legacy
      // row), and by the table-ownership rule a session-less order that is not archived belongs to
      // its TABLE forever — so a handful of "still cooking" seeds became permanent ghost parties
      // sitting on free tables, which is the exact fault the owner hit when a free table showed
      // "Preparing · ₹1,150 due". Phase 183 caught it. History is finished business; the only live
      // orders on a floor should be ones somebody actually placed.
      const live = false;
      // A DISCOUNT CAN NEVER BE BIGGER THAN THE BILL (clamped 2026-08-02). The flat amounts below
      // are picked before the bill is known, and on a small ₹40 order a ₹150 "Birthday treat"
      // produced a bill the real app cannot produce — it clamps with Math.max(0, subtotal −
      // discount) in five places, so nothing is ever stored below zero. Unrealistic fixture data
      // is not harmless: the integrity check for "no bill goes below zero" had to carry a
      // hardcoded date window to skip these rows, and that window silently went stale the moment
      // the seeder started writing right up to today. Cap it, and the check can just be true.
      const wanted = (!cancelled && rand() < 0.08) ? wpick([[50, 4], [75, 3], [100, 3], [150, 2], [200, 1]]) : 0;
      const discount = Math.min(wanted, Math.floor(total));
      const paid = !cancelled && !live;
      day.push({
        restaurant_id: r.id,
        table_number: String(randInt(1, maxTable)),
        items, subtotal, tax, total,
        discount, discount_note: discount > 0 ? pick(DISC_NOTES) : TAG,
        status: cancelled ? "cancelled" : (live ? pick(["received", "preparing"]) : "served"),
        payment_status: paid ? "paid" : "pending",
        archived: paid || cancelled,
        payment_method: paid ? wpick(PAY) : null,
        paid_at: paid ? at.toISOString() : null,
        created_at: at.toISOString(),
        _at: at.getTime(), _paid: paid, _cancelled: cancelled,
      });
      if (cancelled) cancelledN++; else if (paid) { paidN++; revenue += total - discount * (1 + rate); }
    }
    day.sort((a, b) => a._at - b._at);
    day.forEach((o, i) => { o.kot_no = i + 1; });   // KOT numbers restart each day, as they do really
    orders.push(...day);
  }

  console.log(`\n▶ ${r.slug} — ${orders.length} orders  paid=${paidN} cancelled=${cancelledN}  revenue ≈ ₹${Math.round(revenue).toLocaleString("en-IN")}`);
  const ORDER_COLS = ["restaurant_id", "table_number", "items", "subtotal", "tax", "total", "discount", "discount_note", "status", "payment_status", "archived", "payment_method", "paid_at", "created_at", "kot_no"];
  const oids = await insertChunked("orders", orders, ORDER_COLS);
  orders.forEach((o, i) => { o.id = oids[i]; });

  const feedback = [];
  for (const o of orders) {
    if (o._cancelled || !o._paid || rand() >= 0.14) continue;
    feedback.push({
      order_id: o.id, restaurant_id: r.id, table_number: o.table_number,
      rating: wpick(RATING),
      comment: rand() < 0.3 ? pick(COMMENTS) : null,
      name: rand() < 0.4 ? pick(NAMES) : null,
      acknowledged: rand() < 0.6,
      created_at: new Date(o._at + randInt(20, 120) * 60000).toISOString(),
    });
  }
  if (feedback.length) await insertChunked("feedback", feedback, ["order_id", "restaurant_id", "table_number", "rating", "comment", "name", "acknowledged", "created_at"]);
  console.log(`     feedback: ${feedback.length}`);
}

// ── 3. reclaim the space the deletes freed, and refresh the rollups ─────────────────────────────
console.log("\nreclaiming space and refreshing what reads it…");
await sql(`VACUUM (ANALYZE) public.orders`);
await sql(`VACUUM (ANALYZE) public.feedback`);
for (const idx of ["orders_pkey", "idx_orders_analytics_covering", "idx_orders_effective_date", "idx_orders_restaurant_created", "idx_orders_created_covering", "feedback_pkey", "idx_feedback_rid_created"]) {
  try { await sql(`REINDEX INDEX CONCURRENTLY public.${idx}`); } catch { /* not fatal */ }
}
// ── PUT THE TICKET COUNTERS BACK WHERE THE DATA LEFT THEM ───────────────────────────────────────
// This script deletes every daily_counters row (above) and then writes orders carrying its OWN
// kot_no, restarting at 1 each day — which is right, that is how a real day looks. What was
// missing is the other half: the LIVE counter then also restarts at 1 for today, so the next real
// order taken on a demo restaurant is handed a number this script already used, and two kitchen
// tickets in one day print the same number. That is what "86 repeated ticket numbers" in the QA
// run actually was (found 2026-08-02) — our own fixture, not the ordering path, whose counter is
// atomic per restaurant per business day.
//
// So: for every restaurant and every business day this script just wrote, set the counter to the
// highest number it used. The next live order continues ABOVE the demo data instead of colliding
// with it. Business day = 05:00 IST (mig 044) — the same boundary lfh_next_counter uses; getting
// this wrong by using the UTC date would leave a collidable gap either side of 23:30 UTC.
console.log("\nre-seeding the ticket counters so live orders continue above the demo data…");
const [{ n: fixedDays }] = await sql(`
  WITH per_day AS (
    SELECT restaurant_id,
           ((created_at AT TIME ZONE 'Asia/Kolkata') - interval '5 hours')::date AS day,
           MAX(kot_no) AS max_kot
      FROM orders
     WHERE restaurant_id IN (${ids}) AND kot_no IS NOT NULL
     GROUP BY 1, 2),
  ins AS (
    INSERT INTO daily_counters(key, day, n, restaurant_id)
    SELECT 'kot', day, max_kot, restaurant_id FROM per_day
    ON CONFLICT (key, day, restaurant_id) DO UPDATE SET n = GREATEST(daily_counters.n, EXCLUDED.n)
    RETURNING 1)
  SELECT count(*)::int AS n FROM ins`);
const [{ n: fixedBills }] = await sql(`
  WITH per_day AS (
    SELECT restaurant_id,
           ((created_at AT TIME ZONE 'Asia/Kolkata') - interval '5 hours')::date AS day,
           MAX(bill_no) AS max_bill
      FROM sessions
     WHERE restaurant_id IN (${ids}) AND bill_no IS NOT NULL
     GROUP BY 1, 2),
  ins AS (
    INSERT INTO daily_counters(key, day, n, restaurant_id)
    SELECT 'bill', day, max_bill, restaurant_id FROM per_day
    ON CONFLICT (key, day, restaurant_id) DO UPDATE SET n = GREATEST(daily_counters.n, EXCLUDED.n)
    RETURNING 1)
  SELECT count(*)::int AS n FROM ins`);
console.log(`  ${fixedDays} ticket-day counter(s) and ${fixedBills} bill-day counter(s) set to the numbers just written`);

// the daily/monthly rollups now describe orders that no longer exist
try { await sql(`SELECT lfh_refresh_orders_daily_agg()`); } catch (e) { console.log(`  daily rollup: ${String(e.message).slice(0, 80)}`); }
try { await sql(`SELECT lfh_refresh_orders_report_monthly_agg()`); } catch (e) { console.log(`  monthly rollup: ${String(e.message).slice(0, 80)}`); }
// snapshots computed from the old mountain are now wrong
try { await sql(`DELETE FROM owner_analytics_cache`); } catch { /* fine */ }

const [{ after_orders, after_size }] = await sql(
  `SELECT (SELECT count(*) FROM orders) AS after_orders, pg_size_pretty(pg_database_size(current_database())) AS after_size`);
console.log("\n" + "─".repeat(94));
console.log(`orders ${Number(before_orders).toLocaleString()} → ${Number(after_orders).toLocaleString()};  database ${before_size} → ${after_size}`);
console.log("shared_buffers is 224 MB — the point of this is that the whole thing now fits in it.");
