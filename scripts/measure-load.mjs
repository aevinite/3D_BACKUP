// measure-load.mjs — pinpoint WHERE the lag is under load (owner 2026-06-27: find root cause).
// Times three layers through the SAME pooled path the app uses (supabase-js), so we can
// compare idle vs under-load and see which one degrades:
//   1) ping        — `select 1`  → pure DB compute/connection latency (isolates the DB instance)
//   2) floorRead   — the heavy floor-board read (sessions+members+items+calls for one restaurant)
//   3) placeOrder  — one real order write (RPC, fires triggers + realtime breadcrumb)
// If even `ping` balloons under load → the DB INSTANCE (free-tier compute) is the bottleneck.
// If only floorRead balloons → query/data inefficiency. If placeOrder → write/trigger cost.
//
// Usage: node scripts/measure-load.mjs [label] [iterations=15]
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
const env = readFileSync(".env.local", "utf8");
const get = (k) => ((env.match(new RegExp("^" + k + "=(.*)$", "m")) || [])[1] || "").trim().replace(/^["']|["']$/g, "");
const sb = createClient(get("NEXT_PUBLIC_SUPABASE_URL"), get("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
const LABEL = process.argv[2] || "run";
const N = parseInt(process.argv[3] || "15", 10);
const RID = "00000000-0000-0000-0000-000000000001";
const med = (a) => { const s = [...a].sort((x, y) => x - y); return Math.round(s[Math.floor(s.length / 2)]); };
const p95 = (a) => { const s = [...a].sort((x, y) => x - y); return Math.round(s[Math.floor(0.95 * (s.length - 1))]); };

async function timeIt(fn) { const t = performance.now(); try { await fn(); } catch (e) {} return performance.now() - t; }

async function ping() { await sb.rpc("noop_does_not_exist").then(() => {}, () => {}); /* fallback */ await sb.from("restaurants").select("id").limit(1); }
async function floorRead() {
  const { data: sess } = await sb.from("sessions").select("*").eq("restaurant_id", RID).neq("status", "closed").order("last_activity_at", { ascending: false });
  const ids = (sess || []).map((s) => s.id);
  await Promise.all([
    ids.length ? sb.from("session_members").select("*").in("session_id", ids).eq("removed", false) : Promise.resolve({}),
    ids.length ? sb.from("order_items").select("*").in("session_id", ids) : Promise.resolve({}),
    sb.from("waiter_calls").select("*").eq("restaurant_id", RID).order("created_at", { ascending: false }).limit(100),
  ]);
}
async function rpcFloor() { await sb.rpc("lfh_floor_bundle", { p_restaurant_id: RID, p_table: null }); } // NEW: 1 round-trip
async function placeOrder() {
  const { data: items } = await sb.from("menu_items").select("id").eq("restaurant_id", RID).limit(3);
  const p = (items || []).map((i) => ({ id: i.id, qty: 1 }));
  if (p.length) await sb.rpc("lfh_staff_place_order", { p_table: String(1 + Math.floor(Math.random() * 12)), p_items: p, p_allergies: [], p_note: "measure", p_restaurant_id: RID });
}

(async () => {
  const samples = { ping: [], floorRead: [], rpcFloor: [], placeOrder: [] };
  for (let i = 0; i < N; i++) {
    samples.ping.push(await timeIt(ping));
    samples.floorRead.push(await timeIt(floorRead));     // OLD multi-query path
    samples.rpcFloor.push(await timeIt(rpcFloor));        // NEW single-RPC path
    samples.placeOrder.push(await timeIt(placeOrder));
  }
  console.log(`\n[${LABEL}] median / p95 latency (ms), n=${N}:`);
  for (const k of Object.keys(samples)) console.log(`  ${k.padEnd(11)} median=${med(samples[k])}  p95=${p95(samples[k])}`);
})();
