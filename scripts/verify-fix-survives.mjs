#!/usr/bin/env node
// verify-fix-survives.mjs — A REWRITTEN DATABASE FUNCTION MAY NOT QUIETLY DROP A FIX IT ALREADY HAD.
//
//   node scripts/verify-fix-survives.mjs
//
// WHY THIS EXISTS. The big money functions in this project get rewritten constantly — the sales
// report twelve times, the guest ordering functions eleven. Every rewrite starts from a COPY of an
// older definition, and three times now the copy came from the wrong ancestor and threw away a fix
// nobody noticed was gone:
//
//   · migration 119 made every restaurant price at ITS OWN tax rate instead of a flat 5%.
//     Migrations 203 and 215 copied an older lfh_price_order and put `v_rate := 0.05` back. It
//     stood for 55 migrations; migration 270 found it and says so in its own header.
//   · migration 185 made a pay-later bill count as revenue on the day it was COLLECTED.
//     Migration 190 rewrote four report functions onto the rollup and dropped that from all four.
//     266 restored one. The other three were still wrong 130 migrations later (T16 finding 7517).
//   · migration 264's first draft dropped migration 253's open-price guard the same way. That one
//     WAS caught, by hand, and is why scripts/verify-hidden-dishes.mjs exists for two functions.
//
// The sweep that reported all of this then did it AGAIN while fixing it: its first draft copied
// three report bodies out of 301/310 without noticing 315 and 317 had rewritten them, and would
// have reverted both. That is the whole argument for this file. A guard nobody can forget beats
// three people remembering.
//
// WHAT IT DOES. For each function below it works out the NEWEST definition in supabase/migrations —
// by scanning the whole folder in filename order, never by a number someone remembered — and
// asserts the listed markers are still in it. A marker is one earlier decision, in the shortest
// piece of text that can only be there on purpose.
//
// WHEN IT GOES RED. Either you dropped a fix (put it back), or the fix was DELIBERATELY superseded
// — the tax rate moving from settings to orders.tax_rate, say. In that case update the marker in
// the SAME commit and say why in the `why` field. Never delete a row to make the light go green
// without writing down what replaced it; that is how the 5% came back.
//
// LIMIT, STATED OUT LOUD. This reads the migrations FOLDER. A function whose live body was last
// written by dynamic SQL (migration 284 rewrote lfh_banquet_bill_create out of pg_get_functiondef)
// cannot be checked here, so it is listed in CANNOT_CHECK and REPORTED rather than skipped in
// silence — a quiet skip is how migration 296's two missing cron jobs went unnoticed for months.
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const MIG = join(root, "supabase", "migrations");
let fail = 0;
const ok = (s) => console.log("  ok   " + s);
const bad = (s) => { console.log("  FAIL " + s); fail++; };

// ── the newest definition of every function, computed, never assumed ─────────────────────────
const files = readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort();
const latest = new Map();   // name -> { file, body }
for (const f of files) {
  const sql = readFileSync(join(MIG, f), "utf8");
  const re = /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+(?:public\.)?([a-z0-9_]+)\s*\(/gi;
  let m;
  while ((m = re.exec(sql))) {
    const name = m[1].toLowerCase();
    const tag = /\bAS\s+(\$[a-z_]*\$)/i.exec(sql.slice(m.index, m.index + 4000));
    if (!tag) continue;
    const from = m.index + tag.index + tag[0].length;
    const end = sql.indexOf(tag[1], from);
    if (end < 0) continue;
    latest.set(name, { file: f, body: sql.slice(m.index, end + tag[1].length) });
  }
}

// ── the decisions that must survive the next rewrite ─────────────────────────────────────────
// Keep the `why` short and true: it is what the next person reads when this goes red.
const KHATA_DAY = /khata_at IS NOT NULL AND o\.paid_at IS NOT NULL THEN o\.paid_at ELSE o\.created_at/i;
const MUST = [
  // ── the pay-later day (migs 185 · 317 · 321) ──
  ...["lfh_owner_sales_report", "lfh_owner_overview", "lfh_owner_hourly", "lfh_owner_heatmap",
      "lfh_owner_payment_trend", "lfh_owner_dish_breakdown", "lfh_owner_category_breakdown",
      "lfh_owner_samehour_compare", "lfh_owner_payment_breakdown", "lfh_owner_restaurant_revenue",
      "lfh_owner_revenue_timeseries", "lfh_refresh_orders_daily_agg",
      "lfh_refresh_orders_report_monthly_agg"].map((fn) => ({
    fn, marker: KHATA_DAY,
    why: "mig 185: a pay-later bill's revenue belongs to the day it was COLLECTED. Dropped from four functions by mig 190; the last three were repaired by 321. If this is red the money moved days again.",
  })),
  // ── the tax rate is the restaurant's own (migs 119 · 270) ──
  { fn: "lfh_price_order", marker: /lfh_effective_tax_rate/i,
    why: "mig 119: price at THIS restaurant's rate. Migs 203/215 copied an older body and put a flat 5% back for 55 migrations (mig 270 found it)." },
  { fn: "lfh_price_order", marker: /^(?!.*v_rate\s+numeric\s*:=\s*0\.05\s*;\s*$).*$/s, banned: /v_rate\s+numeric\s*:=\s*0\.05\s*;\s*\n(?![\s\S]*lfh_effective_tax_rate)/i,
    why: "…and the flat 0.05 must not be the LAST word on the rate." },
  // ── the guest ordering doors (migs 253 · 264 · 306) ──
  ...["lfh_place_order", "lfh_place_order_public"].flatMap((fn) => [
    { fn, marker: /staff_priced_item/i,
      why: "mig 253: a guest may not price an open-price dish. Mig 264's first draft dropped this once already." },
    { fn, marker: /hidden_item/i,
      why: "mig 306: a hidden dish cannot be ordered by a guest." },
  ]),
  { fn: "lfh_place_order_public", marker: /lfh_merge_parent_table/i,
    why: "mig 264: a guest ordering at a joined table joins the party's bill, not a new one." },
  { fn: "lfh_place_order_public", marker: /unknown_table/i,
    why: "mig 281: an order for a table this restaurant does not have is refused, with a code." },
  // ── the floor tile (migs 229 · 234 · 321) ──
  { fn: "lfh_table_view_summary", marker: /jsonb_typeof\(b\.items\) = 'array'/i,
    why: "mig 229: orders.items can be a scalar; expanding it blind took the whole floor down." },
  { fn: "lfh_table_view_summary", marker: /~ '\^-\?\[0-9\]\+\$'/,
    why: "mig 234: a non-numeric qty must not make a tile read NaN." },
  { fn: "lfh_table_view_summary", marker: /any_prep_order/i,
    why: "mig 321: with no countable lines, fall back to the order's own status — cooking food must never read as 'Served'." },
  // ── money is one definition (migs 301 · 310 · 315) ──
  { fn: "lfh_table_view_summary", marker: /net_amount/i,
    why: "mig 310: every money reader sums orders.net_amount instead of working the net out itself." },
  { fn: "lfh_owner_payment_breakdown", marker: /reversed_at IS NULL/i,
    why: "mig 285: a reversed payment leg is kept, and must not be counted as money taken." },
  // ── an order can never outlive its session (migs 232 · 302 · 321) ──
  { fn: "lfh_session_close_cleanup", marker: /khata_at IS NULL/i,
    why: "mig 232: a parked pay-later tab is money to collect later — closing the table must not cancel it." },
  { fn: "lfh_session_close_cleanup", marker: /table_merges/i,
    why: "mig 249: closing the surviving party ends the merge record too." },
  { fn: "lfh_staff_place_order", marker: /session_closed/i,
    why: "mig 321: never answer 'sent' for an order mig 302's trigger has just voided." },
  { fn: "lfh_staff_place_order", marker: /lfh_merge_parent_table/i,
    why: "mig 250: a staff order at a joined table lands on the party's session." },
  // ── who did it (migs 262 · 308) ──
  { fn: "lfh_staff_merge_tables", marker: /merged_by/i,
    why: "mig 308: the merge record names WHO joined the two tables." },
  { fn: "lfh_record_removal", marker: /deletion_audit/i,
    why: "migs 251/262: one writer for the removal audit, so every panel is recorded by construction." },
  // ── the guest's own door stays narrow (mig 282) ──
  { fn: "lfh_guest_settings", marker: /to_jsonb\(s\) - ARRAY\[/i,
    why: "mig 282: the guest slice is a DENYLIST, so a new column reaches the menu instead of taking it down." },
  { fn: "lfh_guest_settings", marker: /'gstin'/i,
    why: "…and gstin is one of the things it withholds." },
  // ── the cheap change-detector stays cheap, and complete (migs 246 · 321) ──
  { fn: "lfh_owner_orders_fingerprint", marker: /orders_change_watermark/i,
    why: "mig 246: this must read the watermark. Asking `orders` directly was a 21.6s scan that took the database down." },
  { fn: "lfh_bump_orders_watermark", marker: /NEW\.paid_at AT TIME ZONE/i,
    why: "mig 321: collecting a pay-later bill must move the day the money landed on, or the report snapshot is never rebuilt." },
  // ── a purge clears what it should (migs 309 · 321) ──
  { fn: "admin_purge_restaurant", marker: /purged_at = now\(\)/i,
    why: "mig 309: the restaurants row STAYS, marked — the kept bills hang off it." },
  { fn: "admin_purge_restaurant", marker: /delete from inv_items/i,
    why: "mig 321: the operational tables are named explicitly; they used to ride on a cascade that no longer fires." },
];

// A function whose LIVE body was last written by dynamic SQL. Reading the folder cannot tell the
// truth about these, so say so instead of passing.
const CANNOT_CHECK = {
  lfh_banquet_bill_create:
    "migration 284 rewrote it through EXECUTE pg_get_functiondef(...), so the newest text in this "
    + "folder is NOT what runs. Check it with: select pg_get_functiondef(oid) from pg_proc where "
    + "proname='lfh_banquet_bill_create'; before recreating it (mig 328's header explains why).",
};

// ── one-time DATA migrations must still refuse a second run ──────────────────────────────────
// verify-db-grants.mjs already guards 043 and 093. These are the four the T16 sweep added, plus the
// file that could only ever run once at all.
const GUARDED_ONCE = {
  "198_parcel_default_manager_on.sql": "198_parcel_default_manager_on",
  "209_platform_module.sql": "209_platform_module_defaults",
  "295_waiter_caps_reach_a_switch.sql": "295_waiter_caps_default_on",
  "288_only_stamp_a_rate_we_believe.sql": "288_null_implausible_tax_rates",
};

console.log("\nverify-fix-survives — a rewrite may not drop a fix that was already made\n");
console.log("1) every decision below is still in the NEWEST definition of its function");
for (const { fn, marker, banned, why } of MUST) {
  const found = latest.get(fn);
  if (!found) { bad(`${fn} — no definition found in supabase/migrations at all (renamed? dropped?)`); continue; }
  const good = banned ? !banned.test(found.body) : marker.test(found.body);
  if (good) ok(`${fn} (newest: ${found.file})`);
  else bad(`${fn} LOST a fix — newest definition is ${found.file}\n         ${why}`);
}

console.log("\n2) the one-time data migrations still refuse a second run");
for (const [file, key] of Object.entries(GUARDED_ONCE)) {
  let sql = "";
  try { sql = readFileSync(join(MIG, file), "utf8"); }
  catch { bad(`${file} is gone — if it was renumbered, update GUARDED_ONCE in this file`); continue; }
  if (sql.includes(`lfh_already_applied('${key}')`)) ok(`${file} still checks lfh_already_applied('${key}')`);
  else bad(`${file} lost its re-run guard — a re-seed would undo an admin's choices (see mig 307)`);
}
{
  const f = "219_error_signatures_no_muting.sql";
  let sql = "";
  try { sql = readFileSync(join(MIG, f), "utf8"); } catch { sql = ""; }
  if (!sql) bad(`${f} is gone — if it was renumbered, update this check`);
  else if (/information_schema\.columns[\s\S]{0,200}error_signatures[\s\S]{0,120}'state'/i.test(sql))
    ok(`${f} still asks whether the column exists before reading it`);
  else bad(`${f} reads error_signatures.state without checking it exists — that file DELETES that `
         + `column, so the whole re-seed dies there and migrations after it never run (finding 7620)`);
}

console.log("\n3) what this file honestly cannot check from the migrations folder");
for (const [fn, note] of Object.entries(CANNOT_CHECK)) console.log(`  note  ${fn}: ${note}`);

console.log(fail
  ? `\n❌ ${fail} check(s) FAILED — a rewrite dropped something that was already fixed. Put it back, `
    + `or update the marker IN THE SAME COMMIT and say what replaced it.`
  : `\n✅ ${MUST.length + Object.keys(GUARDED_ONCE).length + 1} checks passed — every earlier fix is still standing in the newest definition.`);
process.exit(fail ? 1 : 0);
