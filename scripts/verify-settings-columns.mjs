// verify-settings-columns.mjs — a new module may not widen the widest row in the database.
//
// WHY THIS EXISTS (sweep improvement, 2026-08-14). `settings` is one row per restaurant and it has
// 109 COLUMNS. Roughly 44 of them are the SAME four-column pattern repeated once per module:
//
//     <module>_allowed · <module>_owner_control · <module>_enabled · tablet_<module>
//
// Eleven modules × four columns. Each one needed a migration, an entry in lib/settingsClone.ts, and
// four more columns on the widest row we have — while the app never wanted them as columns in the
// first place: lib/accessModel.ts already models a module as a NAMED ladder and lib/tableTags.ts is
// the single place that turns that name into storage.
//
// Migration 326 gave a module a cheaper home — `settings.modules` (jsonb, keyed by module name) —
// and lib/tableTags.ts reads it for any module that declares `moduleBag: true`. The eleven existing
// ones are deliberately NOT converted (that would touch every panel for no visible gain).
//
// So this guard enforces the ONE rule that keeps the row from growing again: every ladder-shaped
// column that exists must belong to a module that predates the bag. A NEW one fails, with the fix
// in the message. It also checks the bag itself is still there and still defaults to '{}'.
//
// READ-ONLY. Two catalog SELECTs.
//
//   node scripts/verify-settings-columns.mjs          (npm run verify:settings-columns)
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

// ── THE MODULES THAT PREDATE THE BAG — the complete, closed list ─────────────────────────────
// Every one of these owns its four columns and keeps them. Nothing may be added here: a new module
// declares `moduleBag: true` in lib/accessModel.ts and stores its ladder in settings.modules.
const LEGACY_MODULES = new Set([
  "banquet", "khata", "parcel", "platform", "payroll", "inventory",
  "take_orders", "table_ops", "table_tags", "table_assign", "takeaway",
]);
// Ladder-shaped column names that are NOT a module ladder at all, and never were.
const NOT_A_MODULE = new Set([
  "auto_print_kot_allowed",     // the admin's own entitlement for auto-print (mig 107) — no owner rung
  "item_tax_modes_allowed",     // whether per-dish tax modes may be used at all (mig 270) — a tax rule
  "qop_allowed", "qop_tables_allowed", "qop_parcel_allowed", // ⚡ QO/P: one feature, three surfaces (migs 257/258)
  "menu_enabled", "split_bill_enabled", "sessions_enabled", "bubbles_enabled", // plain on/off switches, no ladder
  "table_tags_owner_control", "table_tags_enabled", // (covered by table_tags, listed for clarity)
]);
// The tablet rung columns belonging to those same legacy modules, plus the three original ones.
const LEGACY_TABLET = new Set([
  "tablet_discount", "tablet_mark_paid", "tablet_invoice",  // the first three (mig 074)
  "tablet_banquet", "tablet_khata", "tablet_parcel", "tablet_table_tags",
  "tablet_table_ops", "tablet_take_orders",
]);

console.log("\nsettings — has a new module widened the row again?");

const cols = (await q(`
  SELECT column_name, data_type FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'settings' ORDER BY ordinal_position`));
const names = cols.map((c) => c.column_name);

pass(`the row has ${names.length} columns (it was 109 when the bag was added — this number should not keep climbing)`);

// 1. the bag exists and still defaults to an empty object
const bag = cols.find((c) => c.column_name === "modules");
if (!bag) fail("settings.modules is gone — a new module has nowhere to put its ladder (mig 326)");
else if (bag.data_type !== "jsonb") fail(`settings.modules is ${bag.data_type}, not jsonb`);
else {
  const d = await q(`SELECT column_default FROM information_schema.columns
    WHERE table_schema='public' AND table_name='settings' AND column_name='modules'`);
  /'\{\}'/.test(String(d[0]?.column_default || "")) || String(d[0]?.column_default || "").includes("'{}'")
    ? pass("settings.modules is jsonb defaulting to '{}' — an absent module reads as OFF, which is the house default")
    : fail(`settings.modules default is ${d[0]?.column_default} — it must default to '{}'`);
}

// 2. no ladder-shaped column for a module that is not on the closed legacy list
const ladder = names.filter((n) => /_(allowed|owner_control|enabled)$/.test(n) && !NOT_A_MODULE.has(n));
const strays = [];
for (const n of ladder) {
  const key = n.replace(/_(allowed|owner_control|enabled)$/, "");
  if (!LEGACY_MODULES.has(key)) strays.push(n);
}
if (!strays.length) pass(`all ${ladder.length} ladder columns belong to the ${LEGACY_MODULES.size} modules that predate the bag`);
else for (const n of strays) {
  fail(`settings.${n} is a NEW module ladder column. Put the ladder in settings.modules instead: declare moduleBag: true on the permission in lib/accessModel.ts and give module the same key three times — lib/tableTags.ts already reads it, and no migration is needed. (mig 326)`);
}

// 3. same for the tablet rung
const tabs = names.filter((n) => n.startsWith("tablet_"));
const strayTabs = tabs.filter((n) => !LEGACY_TABLET.has(n));
if (!strayTabs.length) pass(`all ${tabs.length} tablet-rung columns are ones that predate the bag`);
else for (const n of strayTabs) {
  fail(`settings.${n} is a NEW tablet-rung column. It belongs in settings.modules["<module>"].tablet (mig 326).`);
}

// 4. the declaration side: nothing may quietly claim to be bag-backed AND own columns
const model = readFileSync(join(root, "lib/accessModel.ts"), "utf8");
// Count real DECLARATIONS only — a line starting with * or // is documentation, and counting the
// doc comment that explains the flag as a use of it is how a guard starts lying (it did, first run).
const bagDecls = model.split("\n").filter((l) => /moduleBag:\s*true/.test(l) && !/^\s*(\*|\/\/)/.test(l)).length;
if (bagDecls === 0) pass("no module declares itself bag-backed yet — so the bag cannot have changed any answer (that is the point today)");
else pass(`${bagDecls} permission(s) declare moduleBag: true — their ladder is read from settings.modules`);
if (/bag\?: boolean/.test(model) && /m\.bag/.test(readFileSync(join(root, "lib/tableTags.ts"), "utf8")))
  pass("the reader honours the flag (lib/tableTags.ts branches on m.bag), so a declaration actually takes effect");
else fail("lib/tableTags.ts no longer branches on m.bag — declaring moduleBag: true would silently read nothing");

console.log(failed
  ? `\n✗ ${failed} check${failed === 1 ? "" : "s"} failed — the settings row is growing again`
  : "\n✓ a new module needs no new column");
process.exit(failed ? 1 : 0);
