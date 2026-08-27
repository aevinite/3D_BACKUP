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
// AND THE OTHER HALF, ADDED BY SWEEP #7 (T23, 2026-08-28). The check above only ever asked "is this
// table accounted for SOMEWHERE" — so a table could sit on the KEEP list, with a written reason
// saying it survives forever, while admin_purge_restaurant() deleted it, and nothing said a word.
// Four tables were in exactly that state: `expenses`, `inv_purchases`, `inv_purchase_lines` (all
// three carrying money-out reasons) and `aggregator_orders`, a parcel sale that holds its own
// total, payment method and invoice number and has no mirror row in `orders`. A list that promises
// something the function does not do is worse than no list. So KEEP now has to mean KEPT: a KEEP
// table the purge deletes FAILS. The four are parked in DISPUTED, printed loudly on every run,
// until the owner rules on them — and the tables the purge deletes with no reason written down
// anywhere are counted too, because that silence is how `aggregator_orders` got there.
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
  ["staff_payments", "payroll paid — money out"],
  // `expenses`, `inv_purchases` and `inv_purchase_lines` used to be here, with money-out reasons —
  // and the purge deletes all three. Moved to DISPUTED below (sweep #7, T23, 2026-08-28) so this
  // list only ever names tables that really do survive. Nothing about the purge itself changed.
  ["khata_customers", "a kept pay-later bill points at the person who owes it"],
  ["owner_records_agg",
    "DERIVED from the kept bills (best day, biggest bill, busiest hour — mig 327) and rebuilt nightly, "
    + "so purging it would be undone by the next refresh anyway. It holds no row a purge could orphan: "
    + "the restaurants row itself is kept (mig 309), which is what it is keyed on."],
  ["bill_chain",
    "the tamper-evidence for the bills a purge KEEPS (mig 332). Not a preference: mig 332's "
    + "trg_bill_chain_append_only trigger REFUSES a delete, so purging it would raise and abort the "
    + "whole purge — and it is what proves the kept sales were never altered. Classified mig 346."],
]);

// ── DELETED, AND THAT IS THE INTENTION ─────────────────────────────────────────────────────────
// `settings` and `staff_users` used to sit in KEEP with the note "deleted LAST by the purge, after
// every child". That note was true and the list was the wrong place for it: KEEP means "survives a
// purge", and these two do not. They are here so KEEP means exactly one thing (sweep #7, T23).
const DELETED_LAST = new Map([
  ["settings", "deleted LAST by the purge, after every child — the recycle-bin screen says so in words"],
  ["staff_users", "deleted LAST by the purge, after every child — the recycle-bin screen says so in words"],
]);

// ── ON KEEP IN SPIRIT, DELETED IN FACT — awaiting the owner's decision ─────────────────────────
// Found by sweep #7 (T23, 2026-08-28) by comparing KEEP against the delete list for the first time.
// Each of these is a FINANCIAL record that admin_purge_restaurant() deletes today. Nothing is
// changed here: what a purge removes is the owner's call, not a guard's. They are listed so the
// contradiction is printed on every run instead of being invisible, and so the KEEP/deleted check
// below can be strict about everything else.
const DISPUTED = new Map([
  ["aggregator_orders",
    "a PARCEL / platform sale. It carries total, paid, paid_at, payment_method, bill_no, invoice_no "
    + "and invoice_at, and migration 261 draws those numbers from the SAME series a dine-in bill "
    + "uses. Measured 2026-08-28: 43 rows, 32 of them invoiced, and NOT ONE has a mirror row in "
    + "`orders` (order_id is null on all 43) — so a purge is the only thing that touches them and "
    + "the sale is gone while its invoice number stays consumed in seq_counters. KEEP already says "
    + "'a banquet bill IS a sale'; a parcel bill is the same thing. Needs the owner's yes."],
  ["expenses",
    "money out. KEEP's own reason for this table was 'a financial record, same reasoning as a "
    + "sale' — and the purge deletes it. One of the two is wrong; the owner decides which."],
  ["inv_purchases",
    "stock bought — money out. Same contradiction as `expenses`."],
  ["inv_purchase_lines",
    "the lines of those purchases. Same contradiction as `expenses`."],
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

const known = (t) => KEEP.has(t) || UNDECIDED.has(t) || DELETED_LAST.has(t) || DISPUTED.has(t);
const unclassified = tenant.filter((t) => !purged.has(t) && !known(t));

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

// ── KEEP HAS TO MEAN KEPT ──────────────────────────────────────────────────────────────────────
// The check above only ever asked "is this table accounted for SOMEWHERE". A table could therefore
// sit on KEEP — "money out, a financial record, same reasoning as a sale" — while
// admin_purge_restaurant() deleted it, and nothing said a word. Sweep #7 (T23) found four tables in
// exactly that state. So: a table on KEEP that the purge DELETES is now a failure. The four known
// ones live in DISPUTED until the owner rules on them, which is a decision he can see rather than a
// promise the guard was quietly breaking.
const keptButDeleted = [...KEEP.keys()].filter((t) => purged.has(t));
if (keptButDeleted.length === 0) pass("every table on the KEEP list really does survive a purge");
else for (const t of keptButDeleted) {
  fail(`${t} is on the KEEP list ("${KEEP.get(t)}") but admin_purge_restaurant() DELETES it — `
    + `one of the two is wrong. Move it to DISPUTED with the reason, or stop deleting it.`);
}
for (const t of DELETED_LAST.keys()) {
  if (!purged.has(t)) fail(`${t} is listed as "deleted last by the purge" but the purge does not delete it any more — move it to KEEP`);
}
if ([...DELETED_LAST.keys()].every((t) => purged.has(t))) pass(`${DELETED_LAST.size} tables are deleted LAST, on purpose, after every child`);
if (DISPUTED.size) {
  console.log(`  … ⚠ ${DISPUTED.size} FINANCIAL tables are deleted by a purge and somebody has written down that they should not be.`);
  console.log(`      This is the owner's decision, not a guard's — it is printed every run so it cannot go quiet again:`);
  if (!QUIET) for (const [t, why] of DISPUTED) console.log(`      · ${t} — ${why}`);
}
// And the other half of the same blind spot: a table can be DELETED with no reason written down
// anywhere. That is how aggregator_orders came to be purged. Reported, not failed — writing the
// remaining reasons is a job someone has to do deliberately.
const deletedWithNoReason = [...purged].filter((t) => !known(t)).sort();
if (deletedWithNoReason.length === 0) pass("every table the purge deletes has a written reason");
else console.log(`  … ${deletedWithNoReason.length} tables are deleted with no reason written down anywhere: ${deletedWithNoReason.join(", ")}`);

// A stale name in any list is just as misleading as a missing table.
const allListed = [...KEEP.keys(), ...UNDECIDED.keys(), ...DELETED_LAST.keys(), ...DISPUTED.keys()];
for (const t of allListed) {
  if (!tenant.includes(t)) fail(`${t} is listed here but no longer has a restaurant_id column — remove the stale entry`);
}
if (!allListed.some((t) => !tenant.includes(t))) pass("no stale entries in any list");

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
