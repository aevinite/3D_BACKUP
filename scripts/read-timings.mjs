#!/usr/bin/env node
// read-timings.mjs — WHICH of the owner-facing reads are slow enough to be the "blips"?
//
// The owner, 2026-08-12: "fix major error like why they are failed to load and read, that should
// not happen."
//
// `lib/readRetry.ts` answers half of that — a dropped connection is retried once and never reaches
// a human. This script answers the OTHER half: a read that is genuinely close to the statement
// timeout will keep failing however many times you retry it, and the only fix is to make it faster.
//
// So: run every read the owner screens actually make, against the dev database, and report how long
// each takes. Anything creeping toward the timeout is a real problem with a real fix (an index, a
// narrower window); anything fast is not, and adding an index "just in case" costs write speed and
// disk for nothing.
//
// READ-ONLY. It runs the same queries the app runs and writes nothing.
// Run: node scripts/read-timings.mjs
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const env = {};
try {
  for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch { /* process env */ }
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !KEY) { console.error("missing supabase env"); process.exit(1); }
if (!URL_.includes("wnsfcizclkbobwzcxqsf")) { console.error("not the dev database — refusing"); process.exit(1); }
const sb = createClient(URL_, KEY, { auth: { persistSession: false } });

const RID = "00000000-0000-0000-0000-000000000001";
const IST = 5.5 * 3600_000;
const now = Date.now();
const iso = (ms) => new Date(ms).toISOString();
const DAY = 86_400_000;
const todayIST = new Date(now + IST).toISOString().slice(0, 10);
const monthStart = todayIST.slice(0, 8) + "01";

// Each entry: [label, what it feeds, run()]
const READS = [
  ["orders fingerprint · 30d", "every cached owner screen",
    () => sb.rpc("lfh_owner_orders_fingerprint", { p_ids: [RID], p_from: iso(now - 30 * DAY), p_to: iso(now) })],
  ["orders fingerprint · ALL TIME", "the 'All time' dashboard — the one that timed out before",
    () => sb.rpc("lfh_owner_orders_fingerprint", { p_ids: [RID], p_from: "2020-01-01T00:00:00Z", p_to: iso(now) })],
  ["month fingerprint · ALL TIME", "the cheap detector that replaced it past 35 days",
    () => sb.rpc("lfh_owner_report_month_fingerprint", { p_ids: [RID], p_from: "2020-01-01T00:00:00Z", p_to: iso(now) })],
  ["owner overview", "the cockpit's headline cards",
    () => sb.rpc("lfh_owner_overview", { p_ids: [RID] })],
  ["restaurant revenue · 30d", "the 'who earns more' bar",
    () => sb.rpc("lfh_owner_restaurant_revenue", { p_from: iso(now - 30 * DAY), p_to: iso(now), p_ids: [RID] })],
  ["revenue timeseries · 30d", "the dashboard trend line",
    () => sb.rpc("lfh_owner_revenue_timeseries", { p_restaurant_id: RID, p_from: iso(now - 30 * DAY), p_to: iso(now), p_bucket: "day" })],
  ["sales report · 30d", "Sales / Tax / Discounts / Cancellations",
    () => sb.rpc("lfh_owner_sales_report", { p_restaurant_id: RID, p_from: iso(now - 30 * DAY), p_to: iso(now), p_bucket: "day" })],
  ["sales report · ALL TIME", "the widest money window there is",
    () => sb.rpc("lfh_owner_sales_report", { p_restaurant_id: RID, p_from: "2020-01-01T00:00:00Z", p_to: iso(now), p_bucket: "month" })],
  ["dish breakdown · 30d", "the dishes report",
    () => sb.rpc("lfh_owner_dish_breakdown", { p_restaurant_id: RID, p_from: iso(now - 30 * DAY), p_to: iso(now) })],
  ["heatmap · 90d", "the busy-hours grid",
    () => sb.rpc("lfh_owner_heatmap", { p_restaurant_id: RID, p_from: iso(now - 90 * DAY), p_to: iso(now) })],
  ["payment breakdown · 30d", "how the money arrived",
    () => sb.rpc("lfh_owner_payment_breakdown", { p_restaurant_id: RID, p_from: iso(now - 30 * DAY), p_to: iso(now) })],
  ["khata outstanding", "Pay Later — who owes what",
    () => sb.rpc("lfh_khata_outstanding", { p_restaurant_ids: [RID], p_limit: 500 })],
  ["khata summary", "the 'total outstanding' headline",
    () => sb.rpc("lfh_khata_outstanding_summary", { p_restaurant_ids: [RID] })],
  ["ratings summary", "the stars tile",
    () => sb.rpc("lfh_ratings_summary", { p_ids: [RID] })],
  ["staff pay summary · month", "the roster's 'paid this month'",
    () => sb.rpc("lfh_staff_pay_summary", { p_restaurant: RID, p_from: monthStart, p_to: todayIST })],
  ["staff performance · month", "the team leaderboard",
    () => sb.rpc("lfh_staff_performance", { p_restaurant: RID, p_from: iso(now - 30 * DAY), p_to: iso(now) })],
  ["customers head-count", "the guest tiles",
    () => sb.from("customers").select("phone", { count: "exact", head: true }).in("restaurant_id", [RID])],
  ["activity log · 200 rows", "the owner's Activity page",
    () => sb.from("staff_actions")
      .select("id, panel, action, actor, actor_id, device_id, order_id, detail, table_number, restaurant_id, level, created_at")
      .eq("restaurant_id", RID).not("panel", "in", "(admin,db)").or("level.is.null,level.neq.error")
      .neq("action", "ui_taps").order("created_at", { ascending: false }).limit(200)],
  ["activity log · SEARCH", "the same page with a word typed in — the one with no index to use",
    () => sb.from("staff_actions").select("id, action, detail, created_at")
      .eq("restaurant_id", RID).or("action.ilike.%table%,detail.ilike.%table%")
      .order("created_at", { ascending: false }).limit(200)],
  ["removals · 200 rows", "the Removals record",
    () => sb.from("deletion_audit")
      .select("id, at, kind, reason_code, actor, table_number, bill_no, amount, restaurant_id")
      .eq("restaurant_id", RID).order("at", { ascending: false }).limit(200)],
  ["issues open head-count", "the complaints badge (added 2026-08-12)",
    () => sb.from("issues").select("id", { count: "exact", head: true }).eq("restaurant_id", RID).eq("status", "open")],
];

// The statement timeout this database enforces. Anything approaching it is a future outage.
const TIMEOUT_MS = 8000;
const WARN_MS = 1500;

// HOW MUCH DATA IS BEHIND THESE TIMINGS. Without this the numbers mean nothing: 150ms over 200
// rows and 150ms over 400,000 rows are completely different findings, and only the second one says
// "no index needed".
console.log(`\n── how much data is behind these timings ────────────────────────────────────────\n`);
for (const t of ["orders", "staff_actions", "sessions", "deletion_audit", "customers", "issues", "feedback", "staff_payments"]) {
  const r = await sb.from(t).select("*", { count: "exact", head: true });
  console.log(`  ${t.padEnd(18)} ${r.error ? "ERR " + r.error.message : String(r.count ?? 0).padStart(9) + " rows"}`);
}

console.log(`\n── read timings · dev database · ${new Date().toISOString()} ────────────────────\n`);
console.log("  Each read is run twice; the SECOND time is reported (the first pays for the");
console.log("  connection being opened, which is not what we are measuring).\n");

const results = [];
for (const [label, feeds, run] of READS) {
  try {
    await run();                              // warm
    const t0 = Date.now();
    const r = await run();                    // measure
    const ms = Date.now() - t0;
    const rows = Array.isArray(r.data) ? r.data.length : (r.count ?? (r.data ? 1 : 0));
    results.push({ label, feeds, ms, rows, error: r.error?.message || null });
  } catch (e) {
    results.push({ label, feeds, ms: -1, rows: 0, error: e instanceof Error ? e.message : String(e) });
  }
}

results.sort((a, b) => b.ms - a.ms);
let slow = 0;
for (const r of results) {
  const flag = r.error ? "ERR " : r.ms > TIMEOUT_MS * 0.5 ? "SLOW" : r.ms > WARN_MS ? "warn" : "ok  ";
  if (flag === "SLOW") slow++;
  console.log(`  ${flag} ${String(r.ms).padStart(6)}ms  ${r.label.padEnd(34)} ${r.error ? `— ${r.error}` : `(${r.rows} rows) · ${r.feeds}`}`);
}

console.log(`\n  statement timeout is ~${TIMEOUT_MS}ms. "SLOW" = over half of it, i.e. one busy night from failing.`);
console.log(slow
  ? `\n  ${slow} read(s) need attention — an index or a narrower window.\n`
  : "\n  Nothing is close to the timeout on this data. The remaining failures are connection\n  blips, which lib/readRetry.ts already absorbs.\n");
