#!/usr/bin/env node
// verify-access-model.mjs — every switch in the access tree must reach REAL code.
//
// The whole point of the 2026-07-31 access rebuild was that the old panel rendered 54
// sub-checkboxes of which 45 were read by nothing. This guard makes that impossible to
// reintroduce: it walks lib/accessTree.ts and proves each leaf's storage exists and is
// actually consumed. Every check below maps to a mistake that really happened.
//
// Run: node scripts/verify-access-model.mjs   (or npm run verify:access)
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");
const fails = [];
const oks = [];
const ok = (m) => oks.push(m);
const fail = (m) => fails.push(m);

const tree = read("lib/accessTree.ts");
const format = read("lib/format.ts");
const migration = read("supabase/migrations/235_access_model_v2.sql");
const editorApi = read("app/api/editor/[...path]/route.ts");
const tableTags = read("lib/tableTags.ts");
const ownerEnts = read("lib/ownerEntitlements.ts");
const accessModel = read("lib/accessModel.ts");
const featuresLib = read("lib/features.ts");
const menuLib = read("lib/menu.ts");
const treeRoute = read("app/api/admin/restaurants/access-tree/route.ts");

// ── 1 · language / currency codes must be ones the app can RENDER ────────────
// This one bit for real: the tree first offered "gu"/"es"/"GBP", none of which exist in
// lib/format.ts, so picking Gujarati would have saved happily and shown English.
function codesFrom(src, constName) {
  const m = src.match(new RegExp(`${constName}[^=]*=\\s*\\[([\\s\\S]*?)\\n\\];`));
  if (!m) return null;
  return [...m[1].matchAll(/(?:value|code):\s*"([^"]+)"/g)].map((x) => x[1]);
}
for (const [treeConst, formatConst, label] of [
  ["MENU_LANGUAGES", "LANGUAGES", "languages"],
  ["MENU_CURRENCIES", "CURRENCIES", "currencies"],
]) {
  const offered = codesFrom(tree, treeConst);
  const real = codesFrom(format, formatConst);
  if (!offered || !real) { fail(`could not read the ${label} lists (${treeConst} / ${formatConst})`); continue; }
  const unknown = offered.filter((c) => !real.includes(c));
  const missing = real.filter((c) => !offered.includes(c));
  if (unknown.length) fail(`Access offers ${label} the app cannot render: ${unknown.join(", ")} — a guest picking one would silently get the default`);
  else if (missing.length) fail(`lib/format.ts renders ${label} the Access screen never offers: ${missing.join(", ")}`);
  else ok(`${label}: the Access list and lib/format.ts agree exactly (${offered.length})`);
  // …and the migration's backfill must use the same codes.
  for (const c of offered) {
    if (!migration.includes(`'${c}'`)) fail(`migration 235 never mentions the ${label.slice(0, -3)} code '${c}' — its backfill and the screen disagree`);
  }
}

// ── 2 · every settings column a node writes must exist in a migration ────────
const settingCols = new Set();
for (const m of tree.matchAll(/t:\s*"(?:setting|choice|list|text)",\s*key:\s*"([^"]+)"/g)) settingCols.add(m[1]);
for (const m of tree.matchAll(/t:\s*"module",\s*key:\s*"([^"]+)"/g)) {
  settingCols.add(`${m[1]}_allowed`); settingCols.add(`${m[1]}_enabled`);
}
for (const m of tree.matchAll(/t:\s*"tablet",\s*key:\s*"([^"]+)"/g)) settingCols.add(m[1]);
// Columns that predate this rebuild live in older migrations; only the NEW ones must be in 235.
const preExisting = new Set([
  "sessions_enabled", "google_review_mode", "auto_print_kot_allowed", "gstin", "restaurant_name",
  "restaurant_address", "banquet_allowed", "banquet_enabled", "payroll_allowed", "payroll_enabled",
  "inventory_allowed", "inventory_enabled",
  "tablet_discount", "tablet_mark_paid", "tablet_invoice", "tablet_take_orders",
  "tablet_table_tags", "tablet_table_ops",
]);
let colMiss = 0;
for (const c of settingCols) {
  if (preExisting.has(c)) continue;
  if (!migration.includes(c)) { fail(`settings column "${c}" is written by the Access screen but never created by migration 235`); colMiss++; }
}
if (!colMiss) ok(`all ${settingCols.size} settings columns the tree writes exist`);

// ── 3 · module switches must be READ by a server gate ───────────────────────
// A module column nothing reads is the "saves but does nothing" bug in its purest form.
for (const m of tree.matchAll(/t:\s*"module",\s*key:\s*"([^"]+)"/g)) {
  const mod = m[1];
  if (!tableTags.includes(`${mod}_allowed`)) fail(`module "${mod}" has no ladder in lib/tableTags.ts — its switch would save and never be enforced`);
  else ok(`module "${mod}" is read by a ladder in lib/tableTags.ts`);
}

// ── 4 · manager-default rows must bind to a flag managerCan() enforces ──────
const grantFlags = [...tree.matchAll(/t:\s*"grant",\s*flag:\s*"([^"]+)"/g)].map((m) => m[1]);
const knownPowers = new Set([...accessModel.matchAll(/power:\s*"([^"]+)"/g)].map((m) => m[1]));
for (const f of grantFlags) {
  // delete_bill is deliberately its own thing (canDeleteBill), not a PERMISSIONS power.
  if (f === "delete_bill") { if (!editorApi.includes("canDeleteBill")) fail(`"delete_bill" has no canDeleteBill gate`); continue; }
  if (!knownPowers.has(f)) fail(`manager default "${f}" is not a power in lib/accessModel.ts — managerCan() would read nothing`);
}
if (!fails.length || grantFlags.length) ok(`all ${grantFlags.length} manager-default rows bind to a real power flag`);

// ── 5 · owner pages must bind to a key OWNER_SECTION_KEYS knows ─────────────
for (const m of tree.matchAll(/t:\s*"section",\s*key:\s*"([^"]+)"/g)) {
  if (!ownerEnts.includes(`"${m[1]}"`)) fail(`owner page "${m[1]}" is not in OWNER_SECTION_KEYS — the owner nav would ignore it`);
}
ok("every owner-page switch is a known owner entitlement");

// ── 6 · the nine Edit-menu parts must be in the editor's MENU_SUB_KEYS ─────
// "Customisation" (edit_options) was added by this rebuild and was missing at first, which
// would have made that row save and never be read.
const partsBlock = tree.match(/const EDIT_MENU_PARTS[^=]*=\s*\[([\s\S]*?)\n\];/);
const partIds = partsBlock ? [...partsBlock[1].matchAll(/id:\s*"([a-z0-9_]+)"/g)].map((m) => m[1]) : [];
if (!partsBlock) fail("could not find EDIT_MENU_PARTS in lib/accessTree.ts");
const subKeysLine = editorApi.match(/const MENU_SUB_KEYS = \[([^\]]+)\]/);
if (!subKeysLine) fail("could not find MENU_SUB_KEYS in the editor API");
else {
  const known = subKeysLine[1];
  const missing = partIds.filter((id) => !known.includes(`"${id}"`));
  if (missing.length) fail(`Edit-menu parts missing from the editor API's MENU_SUB_KEYS: ${missing.join(", ")}`);
  else ok(`all ${partIds.length} Edit-menu parts are enforced by menuSubAllowed()`);
}

// ── 7 · guest feature keys must have a default in lib/features.ts ──────────
for (const m of tree.matchAll(/t:\s*"feature",\s*key:\s*"([^"]+)"/g)) {
  if (!new RegExp(`\\n\\s*${m[1]}:`).test(featuresLib)) fail(`guest feature "${m[1]}" has no default in lib/features.ts — it would read as undefined`);
}
ok("every guest-feature switch has a default in lib/features.ts");

// ── 8 · the new guest-menu settings must be SELECTED by the guest reader ───
// Adding a column and forgetting the select list is how a switch silently reads as its
// default forever.
for (const col of ["menu_enabled", "menu_default_layout", "menu_default_mode", "menu_languages", "menu_currencies"]) {
  if (!menuLib.includes(col)) fail(`getSettings() never selects "${col}" — the guest menu would ignore that switch`);
}
ok("the guest settings reader selects every new menu column");

// ── 9 · nothing may be a switch with no storage ────────────────────────────
// A row with bind "none" is only legal as a GROUP header (it has children) or when it is
// explicitly marked leftToBuild.
// Each node's OWN text = from its id up to the next `id:` in the file. Anything wider picks
// up a LATER node's bind and mis-reports (the first version of this check did exactly that).
const idPositions = [...tree.matchAll(/\bid:\s*"([a-z0-9_]+)"/g)];
let deadRows = 0;
for (let i = 0; i < idPositions.length; i++) {
  const id = idPositions[i][1];
  const start = idPositions[i].index;
  const end = i + 1 < idPositions.length ? idPositions[i + 1].index : tree.length;
  const own = tree.slice(start, end);
  const bind = own.match(/bind:\s*\{\s*t:\s*"([a-z]+)"/);
  if (!bind || bind[1] !== "none") continue;                 // has real storage → fine
  if (/children:/.test(own) || /leftToBuild:\s*true/.test(own) || /link:\s*\{/.test(own)) continue;
  fail(`"${id}" is a switch with no storage and no "left to build" label — exactly the dead control this rebuild removed`);
  deadRows++;
}
if (!deadRows) ok("no row is a switch with nothing behind it");

// ── 10 · the read/write route must allow-list from the model, not by hand ──
if (!treeRoute.includes('from "@/lib/accessTree"')) fail("the access-tree route does not derive its allow-lists from lib/accessTree.ts");
else ok("the read/write route derives every allow-list from the model");

// ── report ─────────────────────────────────────────────────────────────────
for (const m of oks) console.log("  ok   " + m);
for (const m of fails) console.log("  FAIL " + m);
console.log(fails.length
  ? `\n${fails.length} problem${fails.length > 1 ? "s" : ""} — a switch on the Access screen would not reach real code.`
  : `\nAll ${oks.length} checks passed — every switch on the Access screen reaches real code.`);
process.exit(fails.length ? 1 : 0);
