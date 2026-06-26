// STRESS / SOAK test — realistic restaurant chaos across ALL restaurants, looped
// until a deadline. Drives the REAL backend (RPCs + the same table writes the panels
// make), so it exercises triggers + realtime exactly like live use. Logs every action
// and ERROR to a file so breakages are reviewable.
//
// Usage: node scripts/stress.mjs <minutes> [actionsPerSec]
//   e.g. node scripts/stress.mjs 60 3
// Prints a running tally; never prints secrets.
import { readFileSync, appendFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = readFileSync(".env.local", "utf8");
const get = (k) => ((env.match(new RegExp("^" + k + "=(.*)$", "m")) || [])[1] || "").trim().replace(/^["']|["']$/g, "");
const sb = createClient(get("NEXT_PUBLIC_SUPABASE_URL") || get("SUPABASE_URL"), get("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });

const MINUTES = parseInt(process.argv[2] || "60", 10);
const APS = parseFloat(process.argv[3] || "3"); // actions per second (total across all restaurants)
const LOG = process.argv[4] || "/private/tmp/claude-501/-Users-aevinite-Documents-Projects-backup-Menu/35a94a13-dca4-481e-8c82-dae6479e64bb/scratchpad/stress.log";
const deadline = Date.now() + MINUTES * 60000;

const NAMES = ["Mia", "Arjun", "Sara", "Leo", "Priya", "Dev", "Ana", "Kai", "Noor", "Ravi", "Zoe", "Om"];
const REASONS = ["water", "napkins", "bill", "cutlery", "help"];
const rnd = (a) => a[Math.floor(Math.random() * a.length)];
const ri = (n) => Math.floor(Math.random() * n);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tally = {};
const bump = (k, ok) => { const t = (tally[k] = tally[k] || { ok: 0, err: 0 }); ok ? t.ok++ : t.err++; };
function logline(s) { try { appendFileSync(LOG, s + "\n"); } catch {} }

let RES = []; // [{id, slug, name, items:[id], tables:[n]}]

async function loadCatalog() {
  const { data: rs } = await sb.from("restaurants").select("id,slug,name");
  for (const r of rs || []) {
    const { data: items } = await sb.from("menu_items").select("id,tags").eq("restaurant_id", r.id).limit(60);
    const inStock = (items || []).filter((m) => !(m.tags || []).includes("sold-out")).map((m) => m.id);
    if (inStock.length) RES.push({ ...r, items: inStock });
  }
  logline(`[${new Date().toISOString()}] catalog: ${RES.length} restaurants ready`);
}

const pickItems = (r) => Array.from({ length: 1 + ri(3) }, () => ({ id: rnd(r.items), qty: 1 + ri(2) }));
// 65% reuse a small "busy" set of tables (same-table buildup), 35% a fresh table 1..20
const pickTable = () => (Math.random() < 0.65 ? String(1 + ri(6)) : String(1 + ri(20)));

async function actPlace(r) {
  const { data, error } = await sb.rpc("lfh_staff_place_order", { p_table: pickTable(), p_items: pickItems(r), p_allergies: [], p_note: "stress", p_restaurant_id: r.id });
  bump("place", !error && data?.ok); if (error) logline(`ERR place ${r.slug}: ${error.message}`);
}
async function actCall(r) {
  // table-scoped waiter call (try restaurant-scoped 3-arg, fall back to 2-arg, then direct insert)
  let e = (await sb.rpc("lfh_call_waiter_table", { p_table: pickTable(), p_note: rnd(REASONS), p_restaurant_id: r.id })).error;
  if (e) e = (await sb.rpc("lfh_call_waiter_table", { p_table: pickTable(), p_note: rnd(REASONS) })).error;
  bump("call", !e); if (e) logline(`ERR call ${r.slug}: ${e.message}`);
}
async function actJoin(r) {
  // partner joins a busy table (best-effort across signatures)
  const t = String(1 + ri(6));
  let e = (await sb.rpc("lfh_join_session", { p_table: t, p_name: rnd(NAMES), p_location_ok: true })).error;
  if (e) e = (await sb.rpc("lfh_join_session", { p_table: t, p_name: rnd(NAMES), p_lat: 23.0, p_lng: 72.0 })).error;
  bump("join", !e); if (e) logline(`ERR join ${r.slug}: ${e.message}`);
}
async function advance(r, from, to, orderStatus) {
  const { data: ords } = await sb.from("orders").select("id,session_id").eq("restaurant_id", r.id).eq("status", from).eq("archived", false).limit(3);
  if (!ords?.length) return false;
  const o = rnd(ords);
  const { error } = await sb.from("order_items").update({ status: to }).eq("order_id", o.id).in("status", from === "received" ? ["received"] : from === "preparing" ? ["preparing", "ready"] : ["ready", "preparing"]);
  if (orderStatus) await sb.from("orders").update({ status: orderStatus }).eq("id", o.id);
  await sb.rpc("lfh_sync_order_items_json", { p_order: o.id });
  bump(orderStatus === "preparing" ? "accept" : to === "served" ? "serve" : "ready", !error);
  if (error) logline(`ERR adv ${from}->${to} ${r.slug}: ${error.message}`);
  return true;
}
async function actPay(r) {
  const { data: ords } = await sb.from("orders").select("id,session_id").eq("restaurant_id", r.id).eq("status", "served").eq("payment_status", "pending").limit(3);
  if (!ords?.length) return;
  const o = rnd(ords);
  const e1 = (await sb.from("orders").update({ payment_status: "paid" }).eq("session_id", o.session_id)).error;
  if (o.session_id) await sb.from("sessions").update({ status: "closed", closed_at: new Date().toISOString() }).eq("id", o.session_id);
  bump("pay", !e1); if (e1) logline(`ERR pay ${r.slug}: ${e1.message}`);
}
async function actShift(r) {
  const { data: s } = await sb.from("sessions").select("id").eq("restaurant_id", r.id).eq("status", "open").limit(5);
  if (!s?.length) return;
  const { error } = await sb.rpc("lfh_staff_shift_table", { p_session: rnd(s).id, p_to: String(7 + ri(12)) });
  bump("shift", !error); if (error && !/same_table|occupied|bad_table/.test(error.message)) logline(`ERR shift ${r.slug}: ${error.message}`);
}

// weighted action picker — lots of placing + advancing, sprinkle calls/joins/shift/pay
async function step() {
  const r = rnd(RES);
  const x = Math.random();
  if (x < 0.34) return actPlace(r);
  if (x < 0.50) return advance(r, "received", "preparing", "preparing"); // accept (manager/tablet)
  if (x < 0.63) return advance(r, "preparing", "ready", null);           // kitchen ready (item-level)
  if (x < 0.75) return advance(r, "preparing", "served", "served");      // serve (preparing/ready items → served, order done)
  if (x < 0.83) return actPay(r);
  if (x < 0.91) return actCall(r);
  if (x < 0.97) return actJoin(r);
  return actShift(r);
}

(async () => {
  logline(`\n==== STRESS START ${new Date().toISOString()} for ${MINUTES}min @ ~${APS}/s ====`);
  await loadCatalog();
  if (!RES.length) { logline("FAIL: no restaurants"); process.exit(1); }
  const gap = Math.max(40, Math.round(1000 / APS));
  let n = 0;
  while (Date.now() < deadline) {
    await step().catch((e) => logline(`THROW: ${e.message}`));
    if (++n % 100 === 0) {
      const summary = Object.entries(tally).map(([k, v]) => `${k}:${v.ok}/${v.err}e`).join("  ");
      logline(`[${new Date().toISOString()}] actions=${n}  ${summary}`);
    }
    await sleep(gap + ri(gap));
  }
  logline(`==== STRESS DONE actions=${n} :: ${Object.entries(tally).map(([k, v]) => `${k}:${v.ok}ok/${v.err}err`).join("  ")} ====`);
})();
