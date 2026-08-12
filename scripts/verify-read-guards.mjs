#!/usr/bin/env node
// verify-read-guards.mjs — the three rules the T9 fix pass (2026-08-12) put in, turned into tests so
// they cannot quietly come back.
//
// WHY THIS EXISTS. Ten findings in one sweep were the same missing line — `x.data || []` with no
// `.error` check — and each had been fixed by hand before, in a different file. Hand-fixing does not
// hold: the next route starts from zero. So the rules are checked here.
//
//   1. A LOG-VISIBILITY SWITCH MUST FAIL CLOSED. Nothing outside lib/logVisibility.ts may filter
//      activity rows by reading `owner_entitlements` itself.
//   2. THE INVENTORY MONTH HAS ONE DEFINITION. Neither inventory screen may build its own window.
//   3. THE ROUTES THIS PASS FIXED MUST KEEP THEIR GUARD. A named list, so a later "simplification"
//      that strips the ReadSet out gets caught.
//
// Static + instant. Run: node scripts/verify-read-guards.mjs   (or npm run verify:read-guards)
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const readRaw = (p) => { try { return readFileSync(join(root, p), "utf8"); } catch { return ""; } };

/**
 * Source with COMMENTS REMOVED.
 *
 * This matters more than it looks. Every fix in this codebase leaves a comment explaining the bug it
 * replaced — which means the old, wrong code is quoted verbatim, in prose, a few lines above the
 * right code. A guard that greps the raw file therefore fires on the very comment that documents the
 * fix. (Both of this file's rules did exactly that on their first run.) So: strip comments, then
 * grep. The prose is for humans; the check is about what actually executes.
 */
const read = (p) => readRaw(p)
  .replace(/\/\*[\s\S]*?\*\//g, "")            // block comments
  .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, "$1");  // line comments, without eating a URL's "//"
const fails = [];
const oks = [];
const ok = (m) => oks.push(m);
const fail = (m) => fails.push(m);

// ── 1. the log-visibility switch fails CLOSED ────────────────────────────────────────────────────
const VIS = read("lib/logVisibility.ts");
if (!VIS) fail("lib/logVisibility.ts is gone — the log switches would be back to failing open");
else {
  if (/ok:\s*false/.test(VIS) && /ok:\s*true/.test(VIS)) ok("loadLogVisibility returns a loaded-or-not union (no permissive fallback)");
  else fail("loadLogVisibility no longer distinguishes 'loaded' from 'could not load' — that IS finding F23");
  // canSee must return false for a restaurant it has no entitlements for.
  const canSee = VIS.slice(VIS.indexOf("canSee("));
  if (/if\s*\(!ents\)\s*return false/.test(canSee)) ok("canSee() hides a row it cannot check");
  else fail("canSee() no longer returns false for an unknown restaurant — a switched-off log kind would show");
  if (/if\s*\(!restaurantId\)\s*return false/.test(canSee)) ok("canSee() hides a row with no restaurant");
  else fail("canSee() no longer refuses a row with no restaurant_id");
}

// Nobody else may do this filtering by hand.
for (const p of ["app/api/owner/oplog/route.ts", "app/api/owner/staff/route.ts"]) {
  const src = read(p);
  if (!src) { fail(`${p} is missing`); continue; }
  // The old shape: reading owner_entitlements AND filtering activity rows in the same file.
  const readsEnts = /owner_entitlements/.test(src);
  const filtersActivity = /logKindKey|logKindOf\s*\(/.test(src) && /\.filter\(/.test(src);
  if (readsEnts && filtersActivity) {
    fail(`${p} filters activity rows off owner_entitlements by hand again — use loadLogVisibility() (finding F23)`);
  } else ok(`${p} does not hand-roll the log-visibility filter`);
  if (/loadLogVisibility/.test(src)) ok(`${p} goes through lib/logVisibility`);
  else fail(`${p} no longer calls loadLogVisibility — its activity rows are ungated`);
}

// ── 2. one definition of the inventory month ─────────────────────────────────────────────────────
const WIN = read("lib/inventoryWindow.ts");
if (!WIN) fail("lib/inventoryWindow.ts is gone — the two inventory screens can drift again (F27)");
else ok("lib/inventoryWindow.ts is the shared month definition");

const invPage = read("app/api/owner/inventory/route.ts");
if (/inventoryMonthWindow\s*\(/.test(invPage)) ok("the Inventory page takes its month from the shared definition");
else fail("app/api/owner/inventory builds its own month again — that is finding F27");
// The page must ask the SAME function as the report.
if (/lfh_inv_report_summary/.test(invPage)) ok("the Inventory page and the Inventory report call the same summary function");
else fail("the Inventory page is back on a different summary function from the report (F27)");
if (/lfh_inv_stock_summary/.test(invPage)) fail("the Inventory page is calling lfh_inv_stock_summary again — it counts waste from a different source than the report (F27)");

// ── 3. the routes this pass fixed keep their guard ───────────────────────────────────────────────
// file → what must still be true, in plain words for whoever trips this.
const GUARDED = [
  ["app/api/owner/inventory/route.ts", "the seven stock reads are checked (F1)"],
  ["app/api/owner/reports/route.ts", "the staff-pay / performance / inventory fan-outs are checked (F3, F4, F5)"],
  ["app/api/owner/staff/route.ts", "the person + pay-history reads are checked (F6, F7)"],
  ["app/api/owner/customers/route.ts", "the guest tiles are counted, not defaulted to 0 (F13)"],
  ["app/api/owner/audit/route.ts", "opening one removal tells a blip from 'not found' (F8)"],
];
for (const [p, why] of GUARDED) {
  const src = read(p);
  if (!src) { fail(`${p} is missing`); continue; }
  if (/from "@\/lib\/readGuard"/.test(src)) ok(`${p} still uses the read guard — ${why}`);
  else fail(`${p} no longer imports lib/readGuard — ${why}`);
}

// A read that was made fatal must not be softened back to a silent empty list.
const reports = read("app/api/owner/reports/route.ts");
for (const [needle, why] of [
  ['reads.rows("cash")', "Team & pay would print 'paid out ₹0' when the read failed (F3)"],
  ['reads.rows<any>("perf")', "the team leaderboard would read as 'nobody did anything' (F4)"],
  ['invReads.rows<Row>("dish")', "food cost would be computed from a zero numerator (F5)"],
]) {
  if (reports.includes(needle)) ok(`owner/reports keeps its fatal read: ${why.split(" would ")[0]}`);
  else fail(`owner/reports softened a fatal read back to a tolerant one — ${why}`);
}

// The erase must cover every table that holds a guest's name or phone.
const cust = read("app/api/owner/customers/route.ts");
for (const t of ["customer_visits", "customer_devices"]) {
  if (new RegExp(`from\\("${t}"\\)\\.delete`).test(cust)) ok(`the guest erase clears ${t}`);
  else fail(`the guest erase no longer clears ${t} — personal data would survive an erasure request (F26)`);
}
// `khata_customers` is ANONYMISED rather than deleted: `orders.khata_customer_id` is a foreign key
// onto it, so a delete fails for anyone who actually used pay-later, and removing the referencing
// order instead would be destroying a sales record. Clearing the person is the whole requirement.
if (/from\("khata_customers"\)\s*\n?\s*\.update\(/.test(cust) && /phone:\s*null/.test(cust)) {
  ok("the guest erase empties the pay-later person book row (name/phone/note)");
} else {
  fail("the guest erase no longer clears the guest out of khata_customers — their name and number would survive (F26)");
}
if (/from\("khata_customers"\)\.delete/.test(cust)) {
  fail("the guest erase tries to DELETE a khata_customers row — the orders foreign key makes that fail for any real pay-later guest; anonymise it instead");
}
if (/deletion_audit/.test(cust)) ok("the guest erase is recorded in the Removals record");
else fail("the guest erase no longer writes an audit row — an irreversible erase with no trace");

// ── report ───────────────────────────────────────────────────────────────────────────────────────
for (const m of oks) console.log(`  ok   ${m}`);
if (fails.length) {
  console.error("\nverify-read-guards FAILED:");
  for (const m of fails) console.error(`  FAIL ${m}`);
  console.error("\nThese rules exist because each one was a real bug that printed a wrong number to");
  console.error("the owner. If a change genuinely needs to break one, change THIS FILE in the same");
  console.error("commit and say why.");
  process.exit(1);
}
console.log(`\nAll ${oks.length} checks passed — no read can quietly print a zero nobody read.`);
