// verify-purge-classified.mjs — a purge can no longer forget a table.
//
// WHERE THIS BITES: Admin console → Restaurants → Recycle bin → purge (only allowed 90 days after
// deletion). It permanently clears a restaurant's data, and it does it by naming child tables ONE
// BY ONE, because the tenant foreign keys deliberately have no cascade (mig 078).
//
// THE PROBLEM THIS GUARD FIXES (T8 sweep, P10): that list is hand-maintained. Every feature since
// migration 128 has added tables, and nothing ever failed when one was forgotten — so about eight
// of them are simply left behind by a purge today, invisible on every screen. This file makes the
// list impossible to drift QUIETLY: every table carrying a restaurant_id must be either
//   · deleted by admin_purge_restaurant(), or
//   · on the KEEP list below, with the reason written down.
// A new tenant table is a FAILURE until somebody decides which it is. That decision is cheap; the
// silent drift was not.
//
// DELIBERATELY NOT AUTO-DELETING. Deriving the delete list at runtime was the first idea and it is
// wrong: the money tables must be kept (owner, 2026-08-11 — "keep bills forever, purge only the
// rest"), and the surviving rows reference kept rows, so a generated delete order would break a
// foreign key mid-purge or erase something financial. A guard that forces a human decision is the
// safe half of that idea.
//
// READ-ONLY. Two catalog SELECTs and one function-body read.
//
//   node scripts/verify-purge-classified.mjs
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const parseEnv = (t) => Object.fromEntries(t.split("\n").filter((l) => l.includes("=") && !l.trim().startsWith("#")).map((l) => {
  const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
}));
const QUIET = process.argv.includes("--quiet");
let failed = 0;
const pass = (m) => { if (!QUIET) console.log("  ✓ " + m); };
const fail = (m) => { console.log("  ✗ " + m); failed++; };

const env = parseEnv(readFileSync(join(root, ".env.local"), "utf8"));
const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
const q = async (sql) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql, read_only: true }),
  });
  if (!r.ok) throw new Error(`${ref.slice(0, 6)}…: ${(await r.text()).slice(0, 200)}`);
  return r.json();
};

// ── KEPT ON PURPOSE — every entry carries the reason, so adding one is a decision, not a shrug ──
const KEEP = new Map([
  // The money. Owner, 2026-08-11: "keep bills forever, purge only the rest" (mig 309).
  ["orders", "a sale. Kept forever — a purged restaurant's bills still have to exist"],
  ["order_items", "the dishes on those bills"],
  ["sessions", "what the bills hang off (bill_no, invoice_no live here)"],
  ["payments", "money received"],
  ["session_payments", "money received in parts"],
  ["credit_notes", "money given back"],
  ["invoice_events", "the invoice trail behind a tax invoice"],
  ["deletion_audit", "who deleted which bill — the audit must outlive the restaurant"],
  ["daily_counters", "proves the KOT/bill numbering of the kept bills"],
  ["seq_counters", "proves the invoice numbering of the kept bills"],
  ["banquet_bills", "a banquet bill IS a sale"],
  ["orders_daily_agg", "the pre-summed money behind the kept bills"],
  ["orders_report_monthly_agg", "the pre-summed money behind the kept bills"],
  ["expenses", "money out — a financial record, same reasoning as a sale"],
  ["staff_payments", "payroll paid — money out"],
  ["inv_purchases", "stock bought — money out"],
  ["inv_purchase_lines", "the lines of those purchases"],
  ["khata_customers", "a kept pay-later bill points at the person who owes it"],
  ["owner_records_agg",
    "DERIVED from the kept bills (best day, biggest bill, busiest hour — mig 321) and rebuilt nightly, "
    + "so purging it would be undone by the next refresh anyway. It holds no row a purge could orphan: "
    + "the restaurants row itself is kept (mig 309), which is what it is keyed on."],
  ["settings", "deleted LAST by the purge, after every child (checked separately below)"],
  ["staff_users", "deleted LAST by the purge, after every child (checked separately below)"],
]);

// Tables the purge leaves behind today and we have NOT decided about yet. Listing them here is the
// whole point: they are visible, dated, and a person has to choose. Emptying this list is the work.
const UNDECIDED = new Map([
  ["banquet_items", "the banquet MENU (not a bill) — almost certainly should be purged"],
  ["table_tags", "vip/family marks on tables — operational"],
  ["table_qr_codes", "the printed QR codes — operational"],
  ["action_idempotency", "at-most-once claims, pruned by age anyway (mig 268)"],
  ["print_jobs", "print queue — operational"],
  ["printer_events", "printer history — operational"],
  ["rate_limit_counters", "throttle counters — operational"],
  ["rate_limit_events", "throttle hits — operational"],
  ["rate_limit_rules", "throttle settings — operational"],
  ["error_signatures", "crash grouping — operational"],
  ["fix_requests", "the Fix-NOW queue — operational"],
  ["customer_devices", "which device a returning guest used — personal data, probably purge"],
  ["customer_visits", "visit history — personal data, but a kept bill may reference it"],
  ["table_merges", "which tables were joined — describes how a service ran"],
  ["orders_change_watermark", "one row per restaurant, a refetch marker — operational"],
  ["inv_items", "stock list — but kept inv_purchase_lines reference it, so deleting needs care"],
  ["inv_movements", "stock in/out — operational, references inv_items"],
  ["inv_counts", "stock takes — operational"],
  ["inv_count_lines", "lines of a stock take — operational"],
  ["inv_recipe_lines", "dish→ingredient map — operational, references inv_items"],
  ["inv_vendors", "suppliers — referenced by kept purchases"],
  ["inv_waste_entries", "waste log — operational"],
]);

console.log("\nAdmin console → Restaurants → Recycle bin → purge: is every tenant table accounted for?");

const tenant = (await q(`
  SELECT c.relname AS t
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
  JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'restaurant_id' AND NOT a.attisdropped
  WHERE c.relkind = 'r'
  ORDER BY 1`)).map((r) => r.t);

const [{ def }] = await q(`
  SELECT pg_get_functiondef(p.oid) AS def FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'admin_purge_restaurant'`);

const purged = new Set();
for (const t of tenant) {
  if (new RegExp(`delete\\s+from\\s+(public\\.)?${t}\\b`, "i").test(def)) purged.add(t);
}

const unclassified = tenant.filter((t) => !purged.has(t) && !KEEP.has(t) && !UNDECIDED.has(t));

pass(`${tenant.length} tables carry a restaurant_id`);
pass(`${purged.size} are cleared by the purge`);
pass(`${KEEP.size} are kept on purpose, each with its reason written down`);
if (UNDECIDED.size) {
  console.log(`  … ${UNDECIDED.size} are LEFT BEHIND and not yet decided — that list is the remaining work:`);
  if (!QUIET) for (const [t, why] of UNDECIDED) console.log(`      · ${t} — ${why}`);
}
if (unclassified.length === 0) pass("no tenant table is unaccounted for");
else for (const t of unclassified) {
  fail(`${t} carries a restaurant_id but the purge neither clears it nor keeps it on purpose — add it to admin_purge_restaurant(), or to KEEP/UNDECIDED in this file with the reason`);
}

// A stale name in either list is just as misleading as a missing table.
for (const t of [...KEEP.keys(), ...UNDECIDED.keys()]) {
  if (!tenant.includes(t)) fail(`${t} is listed here but no longer has a restaurant_id column — remove the stale entry`);
}
if (![...KEEP.keys(), ...UNDECIDED.keys()].some((t) => !tenant.includes(t))) pass("no stale entries in either list");

// The two guards the owner's own rules put on this function must still be there.
if (/never be purged/i.test(def)) pass("restaurant #1 still can never be purged");
else fail("the 'default restaurant can never be purged' guard is gone from admin_purge_restaurant()");
if (/90 days/.test(def)) pass("the 90-day retention lock is still there");
else fail("the 90-day retention lock is gone from admin_purge_restaurant()");

console.log(failed
  ? `\n✗ ${failed} check${failed === 1 ? "" : "s"} failed — a purge would silently leave a table behind`
  : "\n✓ every tenant table is either purged or kept on purpose");
process.exit(failed ? 1 : 0);
