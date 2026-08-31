// verify-purge-classified.mjs — a purge can no longer forget a table.
//
// WHERE THIS BITES: Admin console → Restaurants → Recycle bin → "Remove permanently" (no waiting
// period since mig 342 — the admin can clear a restaurant he binned this morning). It permanently clears a restaurant's data, and it does it by naming child tables ONE
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
    "DERIVED from the kept bills (best day, biggest bill, busiest hour — mig 327) and rebuilt nightly, "
    + "so purging it would be undone by the next refresh anyway. It holds no row a purge could orphan: "
    + "the restaurants row itself is kept (mig 309), which is what it is keyed on."],
  ["bill_chain",
    "the tamper-evidence for the bills a purge KEEPS (mig 332). Not a preference: mig 332's "
    + "trg_bill_chain_append_only trigger REFUSES a delete, so purging it would raise and abort the "
    + "whole purge — and it is what proves the kept sales were never altered. Classified mig 346."],
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

// ── SELF-CLEARING — a third answer, and the only one this file does not take on trust ────────────
//
// mig 078's rule is that tenant foreign keys have NO cascade, which is why the purge has to name
// every table by hand. A handful of tables are a genuine exception: they hold a HANDSHAKE, not a
// record, every row carries its own expiry, and something deletes expired rows for the whole
// platform rather than per restaurant. Naming such a table in the purge would be dead code.
//
// "It cleans itself up" is exactly the kind of claim that rots, so an entry here is NOT an
// allowance — it is a claim this guard PROVES on every run, against the live schema and the live
// source. If the expiry column goes, or the sweeper starts filtering by restaurant, the entry fails
// like any other missing table.
const SELF_CLEARING = new Map([
  ["print_pairings", {
    expiry: "expires_at",
    sweeper: "lib/printPair.ts",
    why: "a print-helper handshake (mig 368), dead in 10 minutes; lib/printPair.ts deletes every expired row platform-wide at the start of each new pairing, so a purged restaurant's rows are gone within the hour whatever anyone does",
  }],
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

const unclassified = tenant.filter((t) => !purged.has(t) && !KEEP.has(t) && !UNDECIDED.has(t) && !SELF_CLEARING.has(t));

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

// ── PROVE every SELF_CLEARING claim, rather than believing it ──────────────────────────────────
for (const [t, c] of SELF_CLEARING) {
  if (!tenant.includes(t)) { fail(`${t} is listed as self-clearing but no longer carries a restaurant_id — remove the stale entry`); continue; }
  // (a) the expiry column is really there, and really has a default, so a row cannot be immortal.
  const col = await q(`
    SELECT a.attname AS n, pg_get_expr(d.adbin, d.adrelid) AS dflt
    FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace AND ns.nspname = 'public'
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = '${c.expiry}' AND NOT a.attisdropped
    LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
    WHERE c.relname = '${t}'`);
  if (!col.length) { fail(`${t} is listed as self-clearing on ${c.expiry}, but that column is gone — it now needs a line in admin_purge_restaurant()`); continue; }
  if (!col[0].dflt) { fail(`${t}.${c.expiry} has no default, so a row can be written with no expiry and live for ever — it needs a purge line`); continue; }
  // (b) something really deletes the expired rows, and does it for the WHOLE platform. A sweeper
  //     that filtered by restaurant_id would never reach a purged restaurant's leftovers.
  let src = "";
  try { src = readFileSync(join(root, c.sweeper), "utf8"); } catch { }
  const sweep = new RegExp(`from\\("${t}"\\)[\\s\\S]{0,200}?\\.delete\\(\\)[\\s\\S]{0,200}?\\.lt\\(\\s*"${c.expiry}"`).test(src);
  const scoped = new RegExp(`from\\("${t}"\\)[\\s\\S]{0,200}?\\.delete\\(\\)[\\s\\S]{0,200}?restaurant_id`).test(src);
  if (!sweep) fail(`${c.sweeper} no longer sweeps expired ${t} rows — ${t} is not self-clearing any more and needs a line in admin_purge_restaurant()`);
  else if (scoped) fail(`${c.sweeper} now sweeps ${t} per restaurant, so a purged restaurant's rows would never be reached — ${t} needs a purge line`);
  else pass(`${t} is left out of the purge on purpose, and it really does clear itself: ${c.why}`);
}

// A stale name in either list is just as misleading as a missing table.
for (const t of [...KEEP.keys(), ...UNDECIDED.keys(), ...SELF_CLEARING.keys()]) {
  if (!tenant.includes(t)) fail(`${t} is listed here but no longer has a restaurant_id column — remove the stale entry`);
}
if (![...KEEP.keys(), ...UNDECIDED.keys(), ...SELF_CLEARING.keys()].some((t) => !tenant.includes(t))) pass("no stale entries in any list");

// The two guards the owner's own rules put on this function must still be there.
if (/never be purged/i.test(def)) pass("restaurant #1 still can never be purged");
else fail("the 'default restaurant can never be purged' guard is gone from admin_purge_restaurant()");
// THE WAIT IS GONE ON PURPOSE (owner, 2026-08-20, migration 342: "you can able to dlete from
// recycyle bin"). This check used to assert the opposite and had been RED ever since, which is the
// worst state for a guard to be in — a failing check everybody learns to scroll past. It now guards
// his decision in the direction he actually made it: the lock coming BACK is the regression.
// Read ENFORCEMENT, not prose: mig 345's body carries the comment "THE RETENTION LOCK IS GONE",
// and a guard that greps a comment reports on the wording instead of on the product (this check's
// first version did exactly that and went red on the migration that removed the lock). So strip
// every -- comment first, then look for the raise that would actually block the admin.
const defCode = def.replace(/--[^\n]*/g, "");
if (/Retention lock/i.test(defCode) || /90 days/.test(defCode)) {
  fail("the 90-day retention lock is BACK in admin_purge_restaurant() — the owner removed that wait "
    + "on 2026-08-20 (mig 342); a recreate from an older migration has undone it");
} else pass("the retention lock stays removed, as the owner asked (mig 342)");

console.log(failed
  ? `\n✗ ${failed} check${failed === 1 ? "" : "s"} failed — a purge would silently leave a table behind`
  : "\n✓ every tenant table is either purged or kept on purpose");
process.exit(failed ? 1 : 0);
