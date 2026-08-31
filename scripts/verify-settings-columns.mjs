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
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname, relative } from "node:path";
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

// 3b. EVERY LADDER COLUMN THAT EXISTS MUST HAVE AN EXPLICIT DEFAULT IN THE CLONE
//     (T25, sweep #7, 2026-08-28.)
//
// A new restaurant's `settings` row is CLONED from restaurant #1's (lib/settingsClone.ts — it is
// the cheapest way to satisfy every NOT-NULL column). So any ladder column that file forgets is
// inherited from the flagship, silently, for ever. That is the "#1 leaks onto restaurant #2" class
// the whole file exists to stop, and the checklist rule it breaks is written down: a new module
// defaults OFF.
//
// cleanClonedSettings() already has a drift tripwire for exactly this — and it is a `console.warn`,
// fired at RUNTIME, inside the request that creates a restaurant. Nobody reads a server log. It had
// been naming nine columns (khata_*, payroll_*, inventory_*) on every creation, and restaurant #1
// holds payroll_allowed=true and payroll_owner_control=true, so every restaurant made since was
// born with staff PAYROLL live and the owner already holding the switch.
//
// So the same rule is asserted HERE, where a red line stops a merge. The runtime warn stays: it is
// right that creating a restaurant never FAILS over a missing default.
{
  const cloneSrc = readFileSync(join(root, "lib/settingsClone.ts"), "utf8");
  // Assignments only — a column NAMED in a comment is documentation, not a default. (Strip the
  // line comments; never a block-comment stripper, which eats a file at the first `/*` in a regex.)
  const cloneCode = cloneSrc.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
  const assigned = new Set([...cloneCode.matchAll(/\bbase\.([a-z0-9_]+)\s*=/g)].map((m) => m[1]));
  // ── A DERIVED SEED COUNTS, AND IS BETTER THAN A HAND-TYPED ONE (2026-08-30) ────────────────────
  // This check was written on 2026-08-28 looking for a literal `base.<col> = …`. The same day another
  // lane fixed the same fault a better way: the module admin rungs are seeded from
  // MODULE_ALLOWED_DEFAULTS in lib/accessTree.ts — the `def` on each module's own row on the Access
  // screen — so a module added tomorrow is seeded correctly with no line written in the clone, and
  // the ⓘ a person reads cannot disagree with the value they get.
  //
  // So a guard looking only for the literal form ACCUSED THE BETTER FIX. That map is built at runtime
  // from ALL_NODES (`.filter(n => n.bind.t === "module").map(n => [`${key}_allowed`, n.def === true])`),
  // so its DOMAIN is provably every module's `_allowed` column — nothing to enumerate and nothing to
  // keep in step. When the loop is present, every `*_allowed` ladder column is seeded by it.
  //
  // The other two rungs are NOT in that map and still need their own line, which is why the check
  // stays useful: `_owner_control` and `_enabled` are decided per module in the clone, and the loop
  // does not touch them. Delete the loop and every `_allowed` column drops out of `assigned` again.
  const derivesAllowed =
    /for \(const \[col, on\] of Object\.entries\(MODULE_ALLOWED_DEFAULTS\)\) base\[col\] = on;/.test(cloneCode) &&
    /MODULE_ALLOWED_DEFAULTS[\s\S]{0,400}n\.bind\.t === "module"/.test(readFileSync(join(root, "lib/accessTree.ts"), "utf8"));
  const nulled = /const NULL_COLUMNS = \[([\s\S]*?)\]/.exec(cloneSrc);
  for (const n of (nulled ? [...nulled[1].matchAll(/"([a-z0-9_]+)"/g)].map((m) => m[1]) : [])) assigned.add(n);
  // A DEAD COLUMN NEEDS NO DEFAULT, and saying otherwise would make this guard cry wolf on its
  // first run: settings.table_assign_* still exists (mig 222) but lib/tableAssign.ts answers that
  // ladder from a hard-coded always-on function and says in as many words that "nothing reads
  // them". Inheriting a value nothing reads changes nothing for anybody. So the rule is: a ladder
  // column needs an explicit default the moment some SOURCE FILE reads it — which also means the
  // day one of these wakes up, this guard asks for its default without anyone remembering to.
  const readSomewhere = (col) => {
    const stack = [join(root, "app"), join(root, "lib"), join(root, "components"), join(root, "public")];
    while (stack.length) {
      const d = stack.pop();
      let entries = [];
      try { entries = readdirSync(d, { withFileTypes: true }); } catch { continue; }
      for (const e of entries) {
        if (e.name === "node_modules" || e.name.startsWith(".")) continue;
        const full = join(d, e.name);
        if (e.isDirectory()) { stack.push(full); continue; }
        if (!/\.(ts|tsx|mjs|js)$/.test(e.name)) continue;
        if (full.endsWith("lib/settingsClone.ts")) continue;      // the writer is not a reader
        // Line comments dropped, so a comment EXPLAINING a retired column is not counted as a
        // reader. (Never a block-comment stripper — a `/*` inside a regex literal pairs with a
        // `*/` tens of thousands of characters later and silently eats the file.)
        const noComments = readFileSync(full, "utf8").replace(/(^|[^:\\])\/\/[^\n]*/g, "$1 ");
        if (noComments.includes(col)) return true;
      }
    }
    return false;
  };
  // ── THIS CHECK BUILDS ITS OWN COLUMN LIST (2026-08-30) ────────────────────────────────────────
  // It used to reuse `ladder` from check 2, which is filtered by NOT_A_MODULE — a list written for a
  // DIFFERENT question ("is this a NEW module's column?"), and it excludes
  // table_tags_owner_control and table_tags_enabled as "covered by table_tags, listed for clarity".
  // Right there, wrong here: those two ARE real columns a clone inherits, so removing their line in
  // lib/settingsClone.ts left this check green. Caught by driving it, not by reading it.
  //
  // So the list comes straight from the catalog: every ladder-shaped column that belongs to one of
  // the legacy modules. `auto_print_kot_allowed` and the plain on/off switches (menu_enabled,
  // sessions_enabled, qop_*, …) are still excluded, because they are not module ladders at all —
  // but they are excluded by NOT BEING a legacy module's column, which is the honest test.
  const myLadder = names.filter((n) => {
    const m = /^(.+?)_(allowed|owner_control|enabled)$/.exec(n);
    return !!m && LEGACY_MODULES.has(m[1]);
  });
  const missing = [...myLadder, ...tabs]
    .filter((n) => !assigned.has(n))
    .filter((n) => !(derivesAllowed && n.endsWith("_allowed")))
    .filter(readSomewhere);
  if (!missing.length) {
    pass(`all ${myLadder.length + tabs.length} ladder and tablet-rung columns get an EXPLICIT default in lib/settingsClone.ts`);
  } else for (const n of missing) {
    fail(`lib/settingsClone.ts sets no explicit default for settings.${n} — a new restaurant therefore INHERITS restaurant #1's value for it. Add \`base.${n} = …\` beside the other ladders (a module starts admin-held: allowed false, owner_control false, enabled true).`);
  }
}

// 3c. AND NOBODY READS THE WHOLE `settings` TABLE (T25, sweep #7, 2026-08-28).
//
// lib/aggregators.ts → resolveWebhookRestaurant() did: `select("restaurant_id, platform_channels")`
// with no filter and no limit, on the PUBLIC webhook path, with the reasoning written beside it —
// "Small: it is an opt-in integration." It was true (17 rows, 2.3 KB, measured) and it fails in two
// directions that both get worse quietly: PostgREST caps an unlimited select at 1,000 rows with NO
// error, so past a thousand restaurants an inbound order's own restaurant is simply missing from the
// answer; and `platform_channels` holds the per-channel connection KEYS, which is why it is on
// PRIVATE_SETTINGS_COLUMNS in the first place.
//
// A read of `settings` must therefore carry a filter or a limit. One row per restaurant is the
// widest row in this database and it only ever grows.
{
  const libDir = join(root, "lib");
  const bad = [];
  for (const f of readdirSync(libDir).filter((n) => /\.tsx?$/.test(n))) {
    const rel = `lib/${f}`;
    const src = readFileSync(join(libDir, f), "utf8");
    const code = src.split("\n").filter((l) => !/^\s*(\/\/|\*\s|\*\/|\/\*|\*$)/.test(l)).join("\n");
    // Walk each statement by brackets, not by a regex lookahead — a fluent chain wraps over lines,
    // and a lookahead that stops at the first newline accuses correctly-filtered reads. (That is the
    // same mistake bodyOf() in verify-id-chunks.mjs records at length.)
    let i = 0;
    const needle = 'from("settings")';
    while ((i = code.indexOf(needle, i)) !== -1) {
      let j = i, depth = 0, inStr = null;
      for (; j < code.length; j++) {
        const c = code[j];
        if (inStr) { if (c === "\\") j++; else if (c === inStr) inStr = null; continue; }
        if (c === '"' || c === "'" || c === "`") { inStr = c; continue; }
        if (c === "(" || c === "[" || c === "{") depth++;
        else if (c === ")" || c === "]" || c === "}") { depth--; if (depth < 0) break; }
        else if (c === ";" && depth === 0) break;
      }
      const chain = code.slice(i, j);
      i += needle.length;
      if (/\.(update|insert|upsert|delete)\(/.test(chain)) continue;         // a write, narrowed elsewhere
      if (/\.eq\(|\.in\(|\.limit\(|\.range\(|maybeSingle|head: true/.test(chain)) continue;
      bad.push(`${rel}: ${chain.replace(/\s+/g, " ").slice(0, 90)}…`);
    }
  }
  if (!bad.length) pass("no lib/ file reads the whole settings table — every read carries a filter or a limit");
  else for (const b of bad) {
    fail(`${b}\n         → settings is one row per restaurant and holds the delivery-platform keys. PostgREST silently caps an unlimited select at 1,000 rows, so this comes back SHORT with no error. Push the test into Postgres (lib/aggregators.ts uses .eq("platform_channels->zomato->>on","true"), verified against the database to return the identical set) and add a .limit().`);
  }
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

// 5. NOTHING MAY READ `settings` BY THE PRE-MULTI-TENANT SINGLE-ROW KEY (T25 sweep, 2026-08-21).
//
// Migration 003 created `settings` with `id TEXT PRIMARY KEY` and one row, `id = 'site'`. Everything
// since is keyed on `restaurant_id` — but that row is still there, and measured on the dev database
// it IS restaurant #1's row. So a `.eq("id", "site")` read is not "the site's setting" any more; it
// is "My Little French House's setting, answering for every restaurant on the platform".
//
// lib/aggregators.ts did exactly that for the one door an outside company POSTs through, and on a
// stack trimmed down to one client's restaurant (no #1) it would have answered `false` for ever with
// nothing on any screen to explain why. Guarded here because this is a rule about the SHAPE of the
// settings row, which is what this file is for — rather than as a third new guard nobody remembers.
const LEGACY_KEY = /\.eq\(\s*["']id["']\s*,\s*["']site["']\s*\)/;
/**
 * Source with LINE comments blanked — and DELIBERATELY NOT block comments.
 *
 * ⚠️ A NAIVE `/\*[\s\S]*?\*\/` STRIPPER SILENTLY EATS THE FILE. Measured on
 * app/api/editor/[...path]/route.ts: 412,233 chars in, 370,262 out — 42 KB gone, including the whole
 * of `canDeleteBill()`, because a `/*` inside a regex literal or a string pairs with a `*\/` tens of
 * thousands of characters later. A guard that cannot see the code it is checking reports a PASS, and
 * a guard that invents a pass is worse than no guard at all.
 *
 * Line comments are enough: every explanatory note in this repo's own style is `//`, and the
 * `[^:\\]` guard keeps a `//` inside a URL intact.
 */
const stripped = (t) => t.replace(/(^|[^:\\])\/\/[^\n]*/g, "$1 ");
// SCOPED TO lib/ ON PURPOSE, and this is not laziness — it is the difference between a guard that
// is trusted and one that is muted. Widening it to app/ finds two more, and BOTH turn out to be
// deliberate legacy fallbacks for the flagship row, documented where they sit:
//
//   · app/api/admin/settings/route.ts — the log-retention numbers. One platform-wide policy read
//     off #1's row. Arguably it should be its own table, but there is no per-restaurant screen for
//     it, so today "restaurant #1's value" and "the platform's value" are the same statement.
//   · app/api/admin/maintenance/route.ts — falls back to `id='site'` only when no restaurant_id was
//     given, and says so in its own comment: "`rid` is null for the legacy flagship row".
//
// Failing on those would make this guard red on clean main for two things nobody agreed are wrong,
// which is how a guard stops being run at all. They are named in the T25 handoff notes for the
// terminal that owns app/api/admin instead. `lib/` is where it was a real fault and where the rule
// is unambiguous: a shared library must never answer a per-restaurant question from one row.
const legacyReaders = [];
for (const dir of ["lib"]) {
  const stack = [join(root, dir)];
  while (stack.length) {
    const d = stack.pop();
    let entries = [];
    try { entries = readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      const full = join(d, e.name);
      if (e.isDirectory()) { stack.push(full); continue; }
      if (!/\.(ts|tsx|mjs|js)$/.test(e.name)) continue;
      // Code only — a comment EXPLAINING the retired key (lib/aggregators.ts has a long one) is
      // documentation, and counting it would make this guard accuse the file that fixed the fault.
      if (LEGACY_KEY.test(stripped(readFileSync(full, "utf8")))) legacyReaders.push(relative(root, full));
    }
  }
}
if (legacyReaders.length) {
  for (const f of legacyReaders) {
    fail(`${f} reads settings by the pre-multi-tenant key .eq("id","site") — that is restaurant #1's row answering for everybody. Key it on restaurant_id, and for a platform-wide question ask "does ANY restaurant have it?" (lib/aggregators.ts is the worked example).`);
  }
} else {
  pass('nothing reads settings by the retired single-row key .eq("id","site")');
}


// ── A MODULE LADDER LIVES IN settings.modules, AND THE DECLARATION IS WHAT PUTS IT THERE ──────────
// (T25 round 2, 2026-08-31.) Everything above catches a NEW COLUMN appearing on settings. This is the
// other half: `moduleBag: true` in lib/accessModel.ts is what sends a module's ladder to
// settings.modules instead of a column of its own, and lib/tableTags.ts reads it from there. Turning
// that flag off is how the column comes back — and sabotage showed this guard stayed GREEN when it
// was. Found by breaking it, not by reading it.
{
  const model = readFileSync(join(root, "lib/accessModel.ts"), "utf8");
  const bags = (model.match(/moduleBag:\s*true/g) || []).length;
  if (bags < 1) {
    fail("lib/accessModel.ts no longer declares `moduleBag: true` for any module — every new module ladder would need its own settings column again (mig 326, and settings already has 110 columns)");
  } else {
    pass(`${bags} module(s) declare moduleBag: true, so their ladders live in settings.modules`);
  }
  const tags = readFileSync(join(root, "lib/tableTags.ts"), "utf8");
  if (!/moduleBag/.test(tags) && !/settings\.modules|\bmodules\b/.test(tags)) {
    fail("lib/tableTags.ts stopped reading the shared module bag — the declaration would be decoration");
  }
}

// ── A COLUMN DEFAULT ONLY DECIDES A VALUE THE INSERT LEAVES OUT (T25 round 3, item 47, 2026-08-31) ─
//
// `settings.floor_per_row` is how many table tiles the manager's floor puts in a row, and the answer
// for a NEW restaurant is written down in three places that must agree:
//
//   1. lib/floorLayout.ts → FLOOR_PER_ROW_DEFAULT = 12, "compact by default (owner, 2026-07-31)";
//   2. the column's DEFAULT in supabase/migrations (226 said 6, four days before that decision;
//      373 moved it to 12);
//   3. lib/settingsClone.ts, which is what actually runs when a restaurant is created — the admin
//      route clones restaurant #1's whole settings row, so the INSERT names every column and the
//      column default never gets a turn.
//
// Fixing (2) alone was half a fix: the clone still handed the insert French House's 7. Measured on
// the dev estate that day: 13 of 17 restaurants on 6, 2 on 7, 2 on 12 — not one of them a choice.
// So this asserts all three say the same number.
{
  const floorSrc = readFileSync(join(root, "lib/floorLayout.ts"), "utf8");
  const constant = Number((/FLOOR_PER_ROW_DEFAULT\s*=\s*(\d+)/.exec(floorSrc) || [])[1]);
  const clone = readFileSync(join(root, "lib/settingsClone.ts"), "utf8");
  // The column default: the LAST migration that sets one wins, so read them in file order.
  const migDir = join(root, "supabase/migrations");
  let columnDefault = null, setBy = "";
  for (const f of readdirSync(migDir).filter((f) => f.endsWith(".sql")).sort()) {
    const m = /floor_per_row[\s\S]{0,120}?SET DEFAULT\s+(\d+)|floor_per_row[^;\n]*?\bDEFAULT\s+(\d+)/i.exec(readFileSync(join(migDir, f), "utf8"));
    if (m) { columnDefault = Number(m[1] ?? m[2]); setBy = f; }
  }
  if (!Number.isFinite(constant)) {
    fail("lib/floorLayout.ts no longer states FLOOR_PER_ROW_DEFAULT — there is nothing for the column and the clone to agree WITH");
  } else if (columnDefault === null) {
    fail("no migration sets a DEFAULT for settings.floor_per_row — a restaurant inserted without it would get NULL");
  } else if (columnDefault !== constant) {
    fail(`the tables-per-row default disagrees: lib/floorLayout.ts says ${constant}, the column says ${columnDefault} (set by ${setBy}) — the column is what a new restaurant gets`);
  } else if (!/base\.floor_per_row\s*=\s*FLOOR_PER_ROW_DEFAULT/.test(clone)) {
    fail("lib/settingsClone.ts does not reset floor_per_row to FLOOR_PER_ROW_DEFAULT — creating a restaurant clones #1's whole row, so the column default never applies and the new floor inherits restaurant #1's tile width");
  } else {
    pass(`a new restaurant starts on ${constant} tiles per row in all three places (the constant, ${setBy}, and the clone)`);
  }
}

console.log(failed
  ? `\n✗ ${failed} check${failed === 1 ? "" : "s"} failed — the settings row is growing again`
  : "\n✓ a new module needs no new column");
process.exit(failed ? 1 : 0);
