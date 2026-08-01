#!/usr/bin/env node
// verify-access-model.mjs — every switch in the access tree must reach REAL code.
//
// The whole point of the 2026-07-31 access rebuild was that the old panel rendered 54
// sub-checkboxes of which 45 were read by nothing. This guard makes that impossible to
// reintroduce: it walks lib/accessTree.ts and proves each leaf's storage exists and is
// actually consumed. Every check below maps to a mistake that really happened.
//
// Run: node scripts/verify-access-model.mjs   (or npm run verify:access)
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");
const fails = [];
const oks = [];
const ok = (m) => oks.push(m);
const fail = (m) => fails.push(m);

// The model itself, compiled. `npm run verify:access` bundles it first (see package.json), so
// these are the REAL exported values — every generated row included.
const { MANAGER_GRANT_DEFAULTS, isConfigurableGrant } = await import("../node_modules/.cache/accessTree.mjs");

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
// A column the screen writes has to EXIST — but it may have been created by any migration, not
// only 235. The hand-typed allow-list of "pre-existing" names below had to be extended by hand
// every time an older column was surfaced on this screen, and it failed the moment one was
// (bubbles_enabled, 2026-08-01 — a column from the very first migrations). Scan the whole folder
// instead: that is the real question, and it needs no maintenance.
const allMigrations = readdirSync(join(root, "supabase/migrations"))
  .filter((f) => f.endsWith(".sql"))
  .map((f) => { try { return readFileSync(join(root, "supabase/migrations", f), "utf8"); } catch { return ""; } })
  .join("\n");
let colMiss = 0;
for (const c of settingCols) {
  if (allMigrations.includes(c)) continue;
  fail(`settings column "${c}" is written by the Access screen but no migration ever creates it`); colMiss++;
}
if (!colMiss) ok(`all ${settingCols.size} settings columns the tree writes exist`);

// ── 3 · module switches must be READ by a server gate ───────────────────────
// A module column nothing reads is the "saves but does nothing" bug in its purest form.
for (const m of tree.matchAll(/t:\s*"module",\s*key:\s*"([^"]+)"/g)) {
  const mod = m[1];
  if (!tableTags.includes(`${mod}_allowed`)) fail(`module "${mod}" has no ladder in lib/tableTags.ts — its switch would save and never be enforced`);
  else ok(`module "${mod}" is read by a ladder in lib/tableTags.ts`);
}

// ── 4 · every manager row must reach code, and every enforced power must have a home ─────
//
// THE CHECK THAT WASN'T HERE, AND WHY (2026-08-01). This section used to ask only "is this flag
// listed as a power in lib/accessModel.ts?". Being LISTED is not being READ: `mark_paid` and
// `print_invoice` were listed, had rows on this screen, and no code anywhere consulted them —
// so an admin could switch "Mark a bill paid" off and a manager kept settling bills. It also
// never looked the other way, at flags the SERVER enforces that no row offers, which is how ~14
// powers ended up permanently refused with no screen able to grant them. Both directions now.
// Read the flags from the BUILT model, not from the source text. Regexing `flag: "..."` out of
// the file finds only the rows written by hand — and the ten that matter most (give a discount,
// mark a bill paid, generate bills, void, delete, take an order, move tables, manage staff,
// change settings, mark a table's type) are generated from one ACTIONS table, so a text scan
// could not see a single one of them. That blind spot is why this guard stayed green through
// the whole fault.
const grantFlags = Object.keys(MANAGER_GRANT_DEFAULTS);
const inventoryApi = read("app/api/inventory/[...path]/route.ts");
// EVERY server route, not just the two panel ones. `manage_staff` is enforced in
// app/api/owner/staff/route.ts, so a two-file scan reported it as an unread row — a false alarm
// is as corrosive as a missed one, because it teaches you to skim past this output.
const allRoutes = (function walk(dir, acc = []) {
  for (const e of readdirSync(join(root, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) walk(rel, acc);
    else if (e.name === "route.ts") acc.push(read(rel));
  }
  return acc;
})("app/api").join("\n");
const serverCode = allRoutes + editorApi + inventoryApi + read("lib/staffProfile.ts");

for (const f of grantFlags) {
  // A flag has to be CONSULTED somewhere, by name, or the row is decoration. Any of the real
  // shapes counts: managerCan(g, rid, "x"), invCan(..., "x"), or a direct read of the column.
  const named = new RegExp(`(managerCan\\([^)]*"${f}"|invCan\\([^)]*"${f}"|manager_permissions[?.\\[]+"?${f}\\b)`);
  if (!named.test(serverCode))
    fail(`"${f}" has a row on the Access screen but NO code reads it — switching it off would change nothing (this is exactly what mark_paid and print_invoice did)`);
}
ok(`all ${grantFlags.length} manager rows are read by real server code`);

// The other direction: a power the server refuses on must be reachable from SOME screen, or be
// answered permanently-on by the model. Anything else is a manager locked out with no way back.
const enforced = new Set([
  ...[...serverCode.matchAll(/managerCan\(g,\s*rid,\s*"([a-z_]+)"\)/g)].map((m) => m[1]),
  ...[...serverCode.matchAll(/invCan\(g,\s*rid,\s*"([a-z_]+)"\)/g)].map((m) => m[1]),
]);
const onScreen = new Set(grantFlags);
const strandable = [...enforced].filter((f) => !onScreen.has(f));
// `isConfigurableGrant` is what makes a flag with no row answer ON instead of OFF. Without that
// single line every one of these is refused forever.
if (strandable.length && !/isConfigurableGrant/.test(tree))
  fail(`${strandable.length} powers are enforced with no row on the screen (${strandable.join(", ")}) and lib/accessTree.ts has no rule making them permanently on — a manager would be refused with nothing able to grant it`);
else ok(`${strandable.length} powers with no row (${strandable.join(", ") || "none"}) are answered permanently-on by the model`);

// ── 4b · what the screen SHOWS and what the server ASSUMES must be the same number ────────
// A new restaurant used to be seeded from a hand-typed list that had drifted from this screen —
// six rows read ON while the stored value was false. Deriving it is the only way they stay equal.
const accessConfigLib = read("lib/accessConfig.ts");
if (!/MP_DEFAULT[\s\S]{0,400}managerGrantValue/.test(accessConfigLib))
  fail("MP_DEFAULT in lib/accessConfig.ts no longer derives from managerGrantValue() — a new restaurant can be born disagreeing with its own Access screen");
else ok("a new restaurant is seeded from the same rule the screen displays");

// The absent-key rule must be the SHARED one, not re-implemented per route.
for (const [file, src] of [["editor", editorApi], ["inventory", inventoryApi]]) {
  if (/return\s+!!\s*r\?\.manager_permissions\?\.\[flag\]/.test(src))
    fail(`the ${file} route still reads an absent manager permission as NO — that is the bug: the screen shows the row's default, which is usually YES`);
}
ok("both routes answer a missing permission the same way the screen does");

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
  // `panel:` is real storage too — the row opens one of the editor cards that moved here off the
  // restaurant-detail page (2026-08-01), which loads and saves through its own endpoint. Without
  // this the check reads "Colours, logo & wording" as a dead switch when it is the whole branding
  // form.
  if (/children:/.test(own) || /leftToBuild:\s*true/.test(own) || /link:\s*\{/.test(own) || /panel:\s*"/.test(own)) continue;
  fail(`"${id}" is a switch with no storage and no "left to build" label — exactly the dead control this rebuild removed`);
  deadRows++;
}
if (!deadRows) ok("no row is a switch with nothing behind it");

// ── 9b · THE BIG ONE: every switch's key must be READ by code somewhere ──────
// The original version of this guard only proved a switch's STORAGE existed. That is not
// the same question as "does anything read it", and the gap let four switches ship that
// saved happily and did nothing — payroll_in_reports, inventory_in_reports and the two
// dashboard picks (found by the whole-app sweep, 2026-07-31). A switch nothing reads is the
// exact fault this whole rebuild removed, so it now fails here.
// A row honestly marked `leftToBuild` is exempt: it says so on screen.
{
  const SEARCH_DIRS = ["app", "lib", "components", "public/panels"];
  const files = [];
  const walk = (d) => {
    let ents = []; try { ents = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const full = join(d, e.name);
      if (e.isDirectory()) { if (e.name !== "node_modules" && e.name !== ".next") walk(full); }
      else if (/\.(ts|tsx|js|mjs)$/.test(e.name)) files.push(full);
    }
  };
  for (const d of SEARCH_DIRS) walk(join(root, d));
  // Kept PER FILE, not concatenated: an opt row needs one reader that mentions BOTH its
  // record and its sub-key. Searching a single blob let "range" match an unrelated file and
  // hid the two dashboard picks on the first attempt.
  const sources = files
    .filter((f) => !/lib\/accessTree\.ts$/.test(f) && !/scripts\//.test(f))
    .map((f) => { try { return readFileSync(f, "utf8"); } catch { return ""; } });
  const corpus = sources.join("\n");
  const someFileHasBoth = (a, b) => sources.some((t) => t.includes(a) && t.includes(b));

  // Pull every node together with the keys it writes and whether it is labelled unbuilt.
  // A NODE start is `id: "x", name:` — a bind's `id:` is followed by side/key instead. Using
  // the bare /id:/ truncated every node's text at its own bind, so the sub-key was never
  // found and each opt row passed by accident.
  const nodeBlocks = [...tree.matchAll(/\bid:\s*"([a-z0-9_]+)",\s*name:/g)];
  const dead = [];
  for (let i = 0; i < nodeBlocks.length; i++) {
    const id = nodeBlocks[i][1];
    const own = tree.slice(nodeBlocks[i].index, i + 1 < nodeBlocks.length ? nodeBlocks[i + 1].index : tree.length);
    if (/leftToBuild:\s*true/.test(own)) continue;
    const bind = own.match(/bind:\s*\{\s*t:\s*"([a-z]+)"(?:,\s*(?:key|flag|id):\s*"([^"]+)")?/);
    if (!bind) continue;
    const [, kind, key] = bind;
    if (!key) continue;
    // What a reader would have to mention to consult this switch.
    let seen;
    if (kind === "module") seen = corpus.includes(`${key}_allowed`);
    else if (kind === "opt") {
      // These live at access_config[<perm>].<side>_opts[<subKey>]. A real reader therefore
      // indexes an "_opts" object BY THIS SUB-KEY — so require the two within a few hundred
      // characters of each other in one file. Merely mentioning the words somewhere in a
      // big file is not evidence (that is how the two dashboard picks first slipped past).
      const sub = (own.match(/key:\s*"([^"]+)"\s*\}/) || [])[1];
      seen = !sub ? corpus.includes(key)
        : sources.some((t) => new RegExp(`_opts[\\s\\S]{0,300}\\b${sub}\\b|\\b${sub}\\b[\\s\\S]{0,300}_opts`).test(t));
    } else if (kind === "limit") {
      // access_config[<perm>].limit[<side>] — lib/discountCap.ts reads exactly this.
      seen = sources.some((t) => new RegExp(`\\b${key}\\b[\\s\\S]{0,300}\\blimit\\b`).test(t));
    } else if (kind === "tab") {
      // A tab/section key is a word like "tables" or "log" — asking whether it appears ANYWHERE
      // in the codebase is no evidence at all, and that is how the six manager-settings rows
      // first passed while nothing read them (2026-08-01). Require the reader that actually
      // governs them: the panel's own off-list helper, and a server refusal behind it.
      seen = /managerSettingsOff|managerTabsOff|managerTabOn/.test(corpus);
    } else seen = corpus.includes(key);
    if (!seen) dead.push(`${id} (${kind}:${key})`);
  }
  if (dead.length) fail(`switches that NOTHING reads — they would save and do nothing: ${dead.join(", ")}`);
  else ok(`every switch's key is read by real code (or is honestly labelled "left to build")`);
}

// ── 9c · NOTHING may still read a column the tree stopped writing ───────────
// The access rebuild moved parcel_*/platform_* onto ONE takeaway_* module. Seven places kept
// reading the retired columns, so the panels and the server disagreed: a 403 console error on
// every manager load, and — worse — switching Takeaway ON did not show the Platform tab,
// because the panel's own check read a column the Access screen no longer writes. A switch
// that appears to work and does nothing is exactly what this rebuild removed, so it fails here.
{
  const RETIRED = ["parcel_allowed", "parcel_owner_control", "parcel_enabled",
                   "platform_allowed", "platform_owner_control", "platform_enabled"];
  const dirs = ["app", "lib", "components", "public/panels"];
  const files = [];
  const walk = (d) => {
    let ents = []; try { ents = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const full = join(d, e.name);
      if (e.isDirectory()) { if (e.name !== "node_modules" && e.name !== ".next") walk(full); }
      else if (/\.(ts|tsx|js)$/.test(e.name)) files.push(full);
    }
  };
  for (const d of dirs) walk(join(root, d));
  const offenders = [];
  for (const f of files) {
    // settingsClone deliberately still WRITES the old columns for rollback safety.
    if (/lib\/settingsClone\.ts$/.test(f)) continue;
    let t = ""; try { t = readFileSync(f, "utf8"); } catch { continue; }
    for (const col of RETIRED) {
      // Only flag a READ (a comparison or a select), not a mention in a comment.
      const re = new RegExp(`${col}\\s*(===|!==|==|:)|select\\([^)]*${col}`);
      if (re.test(t)) { offenders.push(`${f.replace(root + "/", "")} → ${col}`); break; }
    }
  }
  if (offenders.length) fail(`still reading a RETIRED column (the Access screen no longer writes it): ${offenders.join(", ")}`);
  else ok("nothing reads a column the access tree stopped writing");
}

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
