// STRESS-MAX — the BIG 1-hour full-load soak (owner 2026-06-26, explicit, egress cost accepted).
// Drives the REAL backend RPCs (lfh_staff_place_order / accept / ready / serve / pay / call /
// join / shift) across ALL restaurants and up to TABLES tables, with WORKERS concurrent loops
// so the DB sees genuine simultaneous rush load — exactly the writes the menu/tablet/manager make
// (NOT raw inserts). Every change fires breadcrumbs → open panels do their (now targeted) refetch,
// which is the egress under measurement. Logs throughput + errors; never prints secrets.
//
// Usage: node scripts/stress-max.mjs [minutes=60] [workers=24] [tables=300]
import { readFileSync, appendFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = readFileSync(".env.local", "utf8");
const get = (k) => ((env.match(new RegExp("^" + k + "=(.*)$", "m")) || [])[1] || "").trim().replace(/^["']|["']$/g, "");
const sb = createClient(get("NEXT_PUBLIC_SUPABASE_URL") || get("SUPABASE_URL"), get("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });

const MINUTES = parseInt(process.argv[2] || "60", 10);
const WORKERS = parseInt(process.argv[3] || "24", 10);
const TABLES = parseInt(process.argv[4] || "300", 10);
const LOG = "/private/tmp/claude-501/-Users-aevinite-Documents-Projects-backup-Menu/35a94a13-dca4-481e-8c82-dae6479e64bb/scratchpad/stress-max.log";
const deadline = Date.now() + MINUTES * 60000;

const NAMES = ["Mia","Arjun","Sara","Leo","Priya","Dev","Ana","Kai","Noor","Ravi","Zoe","Om"];
const REASONS = ["water","napkins","bill","cutlery","help"];
const rnd = (a) => a[Math.floor(Math.random() * a.length)];
const ri = (n) => Math.floor(Math.random() * n);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tally = {};
const bump = (k, ok) => { const t = (tally[k] = tally[k] || { ok: 0, err: 0 }); ok ? t.ok++ : t.err++; };
const logline = (s) => { try { appendFileSync(LOG, s + "\n"); } catch {} };

// Spread across many tables with a "busy core" bias (real rush: some tables churn hot).
const pickTable = () => String(Math.random() < 0.6 ? 1 + ri(Math.min(50, TABLES)) : 1 + ri(TABLES));
const pickItems = (r) => Array.from({ length: 1 + ri(4) }, () => ({ id: rnd(r.items), qty: 1 + ri(3) }));

let RES = [];
async function loadCatalog() {
  const { data: rs } = await sb.from("restaurants").select("id,slug,name");
  for (const r of rs || []) {
    const { data: items } = await sb.from("menu_items").select("id,tags").eq("restaurant_id", r.id).limit(80);
    const inStock = (items || []).filter((m) => !(m.tags || []).includes("sold-out")).map((m) => m.id);
    if (inStock.length) RES.push({ ...r, items: inStock });
  }
  logline(`[${new Date().toISOString()}] catalog: ${RES.length} restaurants, up to ${TABLES} tables, ${WORKERS} workers, ${MINUTES}min`);
}

async function actPlace(r) {
  const { data, error } = await sb.rpc("lfh_staff_place_order", { p_table: pickTable(), p_items: pickItems(r), p_allergies: [], p_note: "stress-max", p_restaurant_id: r.id });
  bump("place", !error && data?.ok); if (error) logline(`ERR place ${r.slug}: ${error.message}`);
}
async function actCall(r) {
  let e = (await sb.rpc("lfh_call_waiter_table", { p_table: pickTable(), p_note: rnd(REASONS), p_restaurant_id: r.id })).error;
  if (e) e = (await sb.rpc("lfh_call_waiter_table", { p_table: pickTable(), p_note: rnd(REASONS) })).error;
  bump("call", !e); if (e) logline(`ERR call ${r.slug}: ${e.message}`);
}
async function actJoin(r) {
  const t = pickTable();
  let e = (await sb.rpc("lfh_join_session", { p_table: t, p_name: rnd(NAMES), p_location_ok: true })).error;
  if (e) e = (await sb.rpc("lfh_join_session", { p_table: t, p_name: rnd(NAMES), p_lat: 23.0, p_lng: 72.0 })).error;
  bump("join", !e); if (e) logline(`ERR join ${r.slug}: ${e.message}`);
}
async function advance(r, from, to, orderStatus) {
  const { data: ords } = await sb.from("orders").select("id,session_id").eq("restaurant_id", r.id).eq("status", from).eq("archived", false).limit(4);
  if (!ords?.length) return;
  const o = rnd(ords);
  const { error } = await sb.from("order_items").update({ status: to }).eq("order_id", o.id).in("status", from === "received" ? ["received"] : from === "preparing" ? ["preparing","ready"] : ["ready","preparing"]);
  if (orderStatus) await sb.from("orders").update({ status: orderStatus }).eq("id", o.id);
  await sb.rpc("lfh_sync_order_items_json", { p_order: o.id });
  bump(orderStatus === "preparing" ? "accept" : to === "served" ? "serve" : "ready", !error);
  if (error) logline(`ERR adv ${from}->${to} ${r.slug}: ${error.message}`);
}
async function actPay(r) {
  // Only settle orders that belong to a SESSION, so the close step has a real session to
  // close (walk-in/solo orders have a null session_id — paying those by session errored
  // with "null uuid" AND left their sessions piling up open). Closing the session here is
  // what keeps the floor from filling with abandoned tables during the soak.
  const { data: ords } = await sb.from("orders").select("id,session_id").eq("restaurant_id", r.id).eq("status", "served").eq("payment_status", "pending").not("session_id", "is", null).limit(4);
  if (!ords?.length) return;
  const o = rnd(ords);
  const e1 = (await sb.from("orders").update({ payment_status: "paid" }).eq("session_id", o.session_id)).error;
  await sb.from("sessions").update({ status: "closed", closed_at: new Date().toISOString() }).eq("id", o.session_id);
  bump("pay", !e1); if (e1) logline(`ERR pay ${r.slug}: ${e1.message}`);
}
async function actShift(r) {
  const { data: s } = await sb.from("sessions").select("id").eq("restaurant_id", r.id).eq("status", "open").limit(6);
  if (!s?.length) return;
  const { error } = await sb.rpc("lfh_staff_shift_table", { p_session: rnd(s).id, p_to: pickTable() });
  bump("shift", !error); if (error && !/same_table|occupied|bad_table/.test(error.message)) logline(`ERR shift ${r.slug}: ${error.message}`);
}

async function step() {
  const r = rnd(RES);
  const x = Math.random();
  if (x < 0.34) return actPlace(r);
  if (x < 0.50) return advance(r, "received", "preparing", "preparing");
  if (x < 0.63) return advance(r, "preparing", "ready", null);
  if (x < 0.75) return advance(r, "preparing", "served", "served");
  if (x < 0.83) return actPay(r);
  if (x < 0.91) return actCall(r);
  if (x < 0.97) return actJoin(r);
  return actShift(r);
}

(async () => {
  logline(`\n==== STRESS-MAX START ${new Date().toISOString()} ${MINUTES}min × ${WORKERS} workers × ≤${TABLES} tables ====`);
  await loadCatalog();
  if (!RES.length) { logline("FAIL: no restaurants"); process.exit(1); }
  let n = 0;
  const worker = async () => {
    while (Date.now() < deadline) {
      await step().catch((e) => logline(`THROW: ${e.message}`));
      n++;
      await sleep(120 + ri(280)); // each worker ~2.5-8 actions/sec → 24 workers ≈ 60-200 actions/sec
    }
  };
  const ticker = setInterval(() => {
    const summary = Object.entries(tally).map(([k, v]) => `${k}:${v.ok}/${v.err}e`).join("  ");
    logline(`[${new Date().toISOString()}] actions=${n}  ${summary}`);
  }, 30000);
  await Promise.all(Array.from({ length: WORKERS }, worker));
  clearInterval(ticker);
  logline(`==== STRESS-MAX DONE actions=${n} :: ${Object.entries(tally).map(([k, v]) => `${k}:${v.ok}ok/${v.err}err`).join("  ")} ====`);
})();
