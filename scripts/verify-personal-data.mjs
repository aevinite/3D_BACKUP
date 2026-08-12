#!/usr/bin/env node
// verify-personal-data.mjs — a new table that stores a guest's phone number must join the erasure
// list, or the "erase my data" button quietly stops being true.
//
// WHY (improvement I15, owner 2026-08-12). The erase named its tables by hand. That list was wrong
// for months: `khata_customers` held a name and a phone from the day pay-later shipped, and nothing
// in the erase knew — so an "erased" guest stayed searchable on the floor staff's screen. It was
// only correct afterwards because somebody had just gone looking, which is not a mechanism.
//
// This is the mechanism. Every table with a guest phone column must appear in lib/personalData.ts
// with a policy (erase / anonymise / keep). Adding one and forgetting fails the build.
//
// Deliberately NOT checked here: STAFF phone numbers (`staff_users.phone`) and SUPPLIER ones
// (`inv_vendors.phone`). A guest's right to erasure is not the same right as an employee's payroll
// record or a vendor's contact — those are governed by employment and accounting rules and have
// their own lifecycles. Mixing them into one erase is how you delete an employment record by
// accident. They are excluded by name, so the exclusion is a decision rather than an oversight.
//
// Run: node scripts/verify-personal-data.mjs   (or npm run verify:personal-data)
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fails = [];
const oks = [];
const ok = (m) => oks.push(m);
const fail = (m) => fails.push(m);

// Tables whose phone column is NOT a guest's — see the header.
const NOT_A_GUEST = new Set(["staff_users", "inv_vendors"]);

// ── what the list says ───────────────────────────────────────────────────────────────────────────
const listSrc = readFileSync(join(root, "lib/personalData.ts"), "utf8");
const declared = new Map();
for (const m of listSrc.matchAll(/table:\s*"([a-z_]+)"[\s\S]{0,400}?policy:\s*"(erase|anonymise|keep)"/g)) {
  declared.set(m[1], m[2]);
}
if (!declared.size) fail("lib/personalData.ts declares no tables — the erase has nothing to walk");
else ok(`lib/personalData.ts declares ${declared.size} place(s) a guest's details live`);

// ── what the schema actually has ─────────────────────────────────────────────────────────────────
// Read every migration and find columns that hold a phone. Both shapes: a column inside a CREATE
// TABLE, and one bolted on later with ALTER TABLE ... ADD COLUMN.
const dir = join(root, "supabase/migrations");
const sqlRaw = readdirSync(dir).filter((f) => f.endsWith(".sql"))
  .map((f) => readFileSync(join(dir, f), "utf8")).join("\n");
// STRING LITERALS ARE NOT COLUMN NAMES. `settings` was flagged on the first run because migration
// 237 has `ADD COLUMN banquet_fields jsonb DEFAULT '["cust_name","cust_phone",…]'` — a DEFAULT VALUE
// that happens to list field names. Blanking quoted literals removes that whole class of false
// positive, and a real column name is never inside quotes.
//
// ORDER MATTERS, and getting it wrong is worse than not doing it: `-- the restaurant's phone` has a
// lone apostrophe, so stripping literals FIRST treats everything from that apostrophe to the next
// one in the file as a string and erases real SQL in between — which silently hid four tables that
// had been correctly detected a moment earlier. Comments go first, then literals.
const sql = sqlRaw
  .replace(/--[^\n]*/g, "")           // line comments (and their stray apostrophes)
  .replace(/\/\*[\s\S]*?\*\//g, "")   // block comments
  .replace(/'(?:[^']|'')*'/g, "''");  // now the quotes that remain really are literals

const found = new Set();
// CREATE TABLE x ( ... phone ... )
for (const m of sql.matchAll(/CREATE TABLE IF NOT EXISTS\s+([a-z_]+)\s*\(([\s\S]*?)\n\);/gi)) {
  const [, table, body] = m;
  if (/^\s*(phone|cust_phone|customer_phone)\s+/im.test(body)) found.add(table);
}
// ALTER TABLE x ADD COLUMN ... phone ...
for (const m of sql.matchAll(/ALTER TABLE\s+([a-z_]+)([\s\S]*?);/gi)) {
  const [, table, body] = m;
  if (/ADD COLUMN[^;]*?\b(phone|cust_phone|customer_phone)\b/i.test(body)) found.add(table);
}

const guestTables = [...found].filter((t) => !NOT_A_GUEST.has(t)).sort();
ok(`the schema has ${guestTables.length} table(s) carrying a guest phone: ${guestTables.join(", ")}`);

for (const t of guestTables) {
  if (declared.has(t)) ok(`  ${t} → ${declared.get(t)}`);
  else fail(`${t} stores a guest's phone number and is NOT in lib/personalData.ts — an erase would silently miss it (this is exactly how khata_customers was missed)`);
}
// And nothing declared that no longer exists, which would make the erase write to a dead table.
for (const t of declared.keys()) {
  if (!found.has(t)) fail(`lib/personalData.ts names "${t}", which has no phone column in any migration — stale entry`);
}

// ── the route must USE the list, not its own memory ──────────────────────────────────────────────
const route = readFileSync(join(root, "app/api/owner/customers/route.ts"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:'"`\\])\/\/[^\n]*/g, "$1");
if (/from "@\/lib\/personalData"/.test(route)) ok("the erase is driven by the declared list");
else fail("app/api/owner/customers no longer imports lib/personalData — it is back to a hand-typed list of tables");
if (/ERASABLE/.test(route)) ok("…and walks ERASABLE rather than naming tables inline");
else fail("the erase no longer walks ERASABLE");
if (/erasureSummary/.test(route)) ok("…and tells the owner what was kept, and why");
else fail("the erase no longer reports what it kept — an incomplete erasure would look complete");

// A `keep` must always carry its reason, or the disclosure is empty.
for (const m of listSrc.matchAll(/policy:\s*"keep"([\s\S]{0,300}?)scoped:/g)) {
  if (!/why:\s*"/.test(m[1])) fail("a 'keep' entry has no `why` — the owner would be told something survived with no reason");
}
ok("every retained field explains itself");

for (const m of oks) console.log(`  ok   ${m}`);
if (fails.length) {
  console.error("\nverify-personal-data FAILED:");
  for (const m of fails) console.error(`  FAIL ${m}`);
  console.error("\nIf a new table genuinely holds a guest's details, add it to lib/personalData.ts with");
  console.error("a policy. If its phone is NOT a guest's (staff, supplier), add it to NOT_A_GUEST here");
  console.error("with a note saying why.");
  process.exit(1);
}
console.log(`\nAll ${oks.length} checks passed — the erase knows every place a guest's details live.`);
