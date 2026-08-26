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
const {
  MANAGER_GRANT_DEFAULTS, isConfigurableGrant, MODULE_KEYS, HAS_IDS, ALL_NODES,
  nodePatch, defOf, SETTING_KEYS, CHOICE_KEYS, LIST_KEYS, TEXT_KEYS, TABLET_COLS,
  GRANT_FLAGS, SECTION_ENTITLEMENTS, CHANNEL_KEYS, CREDS_KEYS, FEATURE_KEYS, TAB_KEYS,
  waiterCapValue, WAITER_NEVER, MENU_PART_DEFAULTS, CHANNEL_DEFAULTS, WAITER_FEATURE_OF,
  nodeExpect, expectHeader,
} = await import("../node_modules/.cache/accessTree.mjs");

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
const staffApi = read("app/api/owner/staff/route.ts");
const editorApp = read("public/panels/editor/app.js");

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

// ── 6 · the nine Edit-menu parts must be in the editor's MENU_PART_KEYS ────
// "Customisation" (edit_options) was added by this rebuild and was missing at first, which
// would have made that row save and never be read. (The list was called MENU_SUB_KEYS and
// lived inside whoami until 2026-08-03; it is now one exported resolver shared by whoami,
// the save path and the delete path — npm run verify:menu-parts checks the rest of that
// wiring, this check stays the "the model and the server agree on the LIST" one.)
const partsBlock = tree.match(/const EDIT_MENU_PARTS[^=]*=\s*\[([\s\S]*?)\n\];/);
const partIds = partsBlock ? [...partsBlock[1].matchAll(/id:\s*"([a-z0-9_]+)"/g)].map((m) => m[1]) : [];
if (!partsBlock) fail("could not find EDIT_MENU_PARTS in lib/accessTree.ts");
const subKeysLine = editorApi.match(/MENU_PART_KEYS = \[([\s\S]*?)\]/);
if (!subKeysLine) fail("could not find MENU_PART_KEYS in the editor API");
else {
  const known = subKeysLine[1];
  const missing = partIds.filter((id) => !known.includes(`"${id}"`));
  if (missing.length) fail(`Edit-menu parts missing from the editor API's MENU_PART_KEYS: ${missing.join(", ")}`);
  else ok(`all ${partIds.length} Edit-menu parts are enforced by resolveMenuParts()`);
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
  // this the check reads "Theme and logo" as a dead switch when it is the whole branding
  // form.
  // `info: true` = a row that exists only for its words (declared in the Node type) — it
  // renders no control at all, so it cannot be a dead switch. `leftToBuild: false` used to be
  // written here in the hope of the same effect; it never matched anything.
  if (/info:\s*true/.test(own)) continue;
  if (/children:/.test(own) || /leftToBuild:\s*true/.test(own) || /link:\s*\{/.test(own) || /panel:\s*"/.test(own)) continue;
  fail(`"${id}" is a switch with no storage and no "left to build" label — exactly the dead control this rebuild removed`);
  deadRows++;
}
if (!deadRows) ok("no row is a switch with nothing behind it");

// ── 8b · a "has" row must be in HAS_IDS, or the save silently drops it ──────
// The write route allow-lists config[id].on from HAS_IDS. That list was built from featureBind
// only, so "Put menu on maintenance" — whose has-bind is its MAIN bind — was missing: the switch
// moved on screen, wrote nothing, and read back off on every restaurant. A dead switch inside the
// list whose whole job is to prevent dead switches (2026-08-02).
{
  const missing = ALL_NODES
    .filter((n) => n.bind?.t === "has" || n.featureBind?.t === "has")
    .map((n) => ({ id: n.id, key: n.bind?.t === "has" ? n.bind.id : n.featureBind.id }))
    .filter((x) => !HAS_IDS.includes(x.key));
  if (missing.length) fail(`a "has" switch is not in HAS_IDS, so the write route will drop it: ${missing.map((m) => `${m.id} → config.${m.key}.on`).join(", ")}`);
  else ok(`all ${HAS_IDS.length} "has" switches are allow-listed for saving`);
}

// ── 8c · every switch states its factory default ON THE NODE ───────────────
// set-access-defaults and the QA suite's per-restaurant check both read node.def. A default
// hiding inside the bind reads as `undefined`, so the row is reported as drifted on every
// restaurant for ever — with a fix command that cannot fix it (2026-08-02, "Put menu on
// maintenance is undefined"). Rows with no stored value of their own are exempt.
{
  const EXEMPT = new Set(["none", "creds", "text", "opt"]);
  const undef = ALL_NODES.filter((n) => !n.info && !n.leftToBuild && !n.panel && !n.children
    && n.bind && !EXEMPT.has(n.bind.t) && n.def === undefined);
  if (undef.length) fail(`switch(es) with no factory default on the node — every defaults tool reads node.def: ${undef.map((n) => n.id).join(", ")}`);
  else ok("every switch states its factory default where the tools read it");
}

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
  // DERIVED from the tree, not hand-typed (2026-08-02). A prefix that the tree writes today
  // is NOT retired — mig 259 gave the counter parcel its own switch back, and a hand-typed
  // list said parcel_* was dead while the Access screen was writing it, failing every correct
  // read of it. Whatever the tree no longer writes stays flagged.
  const LEGACY_PREFIXES = ["parcel", "platform"];
  const RETIRED = LEGACY_PREFIXES
    .filter((p) => !MODULE_KEYS.includes(p))
    .flatMap((p) => [`${p}_allowed`, `${p}_owner_control`, `${p}_enabled`]);
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
      // (?<![a-z0-9_]) so a NEW column that merely ends with a retired name — qop_parcel_allowed
      // contains "parcel_allowed" — can never read as the retired one (false alarm, 2026-08-02).
      const re = new RegExp(`(?<![a-z0-9_])${col}\\s*(===|!==|==|:)|select\\([^)]*(?<![a-z0-9_])${col}`);
      if (re.test(t)) { offenders.push(`${f.replace(root + "/", "")} → ${col}`); break; }
    }
  }
  if (offenders.length) fail(`still reading a RETIRED column (the Access screen no longer writes it): ${offenders.join(", ")}`);
  else ok("nothing reads a column the access tree stopped writing");
}

// ── 11 · the manager panel's Users card may not offer what a manager can't have ──
// The owner opened a MANAGER's panel (their profile → "Visit their panel"), went to
// Settings → Users, and found a "manager" option in every role dropdown and a red Remove
// on every row — because that card branched on the ACTOR, so an admin/owner looking in got
// the ADMIN's powers on the manager's own screen (2026-08-04). His rule: a manager creates
// and disables kitchen + tablet logins, nothing else, and never deletes a person. A control
// a role can never have does not belong on that role's screen for ANY viewer.
{
  const card = editorApp.match(/function userSettingCardHtml\(\)[\s\S]*?\n}\n/);
  if (!card) fail("can't find userSettingCardHtml() in the manager panel — this guard needs updating");
  else {
    const body = card[0];
    const roles = body.match(/const ROLES = ([^;]+);/);
    if (!roles) fail("the Users card no longer declares ROLES — check what it offers now");
    else if (/manager/.test(roles[1])) fail(`the manager panel's Users card offers the MANAGER role: ${roles[1].trim()}`);
    else ok("the manager panel's Users card offers kitchen + tablet only, for every viewer");
    if (/data-staff-del/.test(body)) fail("the manager panel's Users card renders a Remove button — a manager disables, never deletes");
    else ok("the manager panel's Users card has no Remove button");
  }
  // …and no live handler may be left behind for one: a stray marker would make it work again.
  if (/data-staff-del/.test(editorApp)) fail("the manager panel still wires a delete handler for a staff login");
  else ok("the manager panel has no delete-a-person code path at all");
  // The server keeps saying the same thing (this is the gate that actually refuses).
  if (!/s\.actor === "manager"[\s\S]{0,240}?403/.test(staffApi)) fail("the staff route no longer refuses a manager's DELETE");
  else ok("the staff route refuses a manager's request to delete a login");
}

// ── 12 · a "see it as this manager" tab must be ANSWERED as that manager ──────
// whoami has honoured ?as=<person> / ?view=real since they shipped, but /api/owner/staff —
// which is what the Users card reads to decide who is looking — ignored both, so a tab whose
// promise is "this is what they see" reported actor:"admin" and listed other managers.
{
  if (!staffApi.includes("managerViewPin")) fail("the staff route ignores the panel's ?as= / ?view=real pins — a manager view would be answered as the admin");
  else if (!/actor: shownActor\(s\)/.test(staffApi)) fail("the staff route resolves the manager-view pin but still reports the raw actor");
  else ok("a pinned manager view is answered as that manager (list + reported actor)");
}

// ── 10 · the read/write route must allow-list from the model, not by hand ──
if (!treeRoute.includes('from "@/lib/accessTree"')) fail("the access-tree route does not derive its allow-lists from lib/accessTree.ts");
else ok("the read/write route derives every allow-list from the model");

// ── 11 · EVERY ROW'S OWN SAVE MUST SURVIVE THE WRITE ROUTE ────────────────
//
// THE TWO BUGS THIS EXISTS TO CATCH, both live while all ten checks above passed (2026-08-04):
//   • "Put menu on maintenance" wrote { config: { maintenance: { on: true } } }, and the route
//     gated that path on HAS_IDS — which was built from `featureBind` only, so a row carrying its
//     has-bind as its MAIN bind was dropped. The save answered { ok: true } and read back OFF for
//     every restaurant, forever.
//   • the per-person write route refused `delete_bill` — a row this very screen shows.
// The checks above prove a row's KEY is read by real code. Neither proved the row's SAVE gets past
// the route's own filters, which is the other half of "a switch that changes nothing".
//
// So: build each node's real patch with nodePatch(), then assert the route has an allow-list entry
// that will let every key in it through. Static, no database, no server.
{
  const allowed = {
    features: new Set([...FEATURE_KEYS, "ratings"]),
    settings: new Set([...SETTING_KEYS, ...CHOICE_KEYS, ...LIST_KEYS, ...TEXT_KEYS, ...TABLET_COLS,
      ...MODULE_KEYS.flatMap((m) => [`${m}_allowed`, `${m}_enabled`])]),
    channels: new Set(CHANNEL_KEYS),
    creds: new Set(CREDS_KEYS),
    grants: new Set(GRANT_FLAGS),
    sections: new Set(SECTION_ENTITLEMENTS),
  };
  const tabAllowed = new Set(TAB_KEYS.map((b) => `${b.panel}|${b.key}`));
  const configOpts = new Set(), configLimits = new Set(), configTablet = new Set();
  for (const n of ALL_NODES) {
    const b = n.bind;
    if (b.t === "opt") configOpts.add(`${b.id}|${b.side}|${b.key}`);
    if (b.t === "limit") configLimits.add(`${b.id}|${b.side}`);
    if (b.t === "capTablet") configTablet.add(b.id);
  }
  const dead = [];
  const sample = (n) => {
    const b = n.bind;
    if (b.t === "tablet" || b.t === "capTablet") return "on";
    if (b.t === "choice" || (b.t === "opt" && n.choices)) return (n.choices || [{ value: "x" }])[0].value;
    if (b.t === "list") return [(n.choices || [{ value: "en" }])[0].value];
    if (b.t === "text") return "x";
    if (b.t === "creds") return "abcd1234";
    if (b.t === "limit") return Number(defOf(n)) || 5;
    return true;
  };
  for (const n of ALL_NODES) {
    const binds = [n.bind, ...(n.featureBind ? [n.featureBind] : [])];
    for (const bind of binds) {
      if (bind.t === "none") continue;
      const patch = nodePatch({ ...n, bind }, sample({ ...n, bind }));
      for (const [family, obj] of Object.entries(patch)) {
        if (family === "tabs") {
          for (const [panel, keys] of Object.entries(obj))
            for (const k of Object.keys(keys))
              if (!tabAllowed.has(`${panel}|${k}`)) dead.push(`${n.id} → tabs.${panel}.${k}`);
          continue;
        }
        if (family === "config") {
          for (const [id, sides] of Object.entries(obj))
            for (const [side, v] of Object.entries(sides)) {
              if (side === "on") { if (!HAS_IDS.includes(id)) dead.push(`${n.id} → config.${id}.on`); continue; }
              if (side === "tablet") { if (!configTablet.has(id)) dead.push(`${n.id} → config.${id}.tablet`); continue; }
              if (side === "limit") { for (const sd of Object.keys(v)) if (!configLimits.has(`${id}|${sd}`)) dead.push(`${n.id} → config.${id}.limit.${sd}`); continue; }
              const m = side.match(/^(owner|manager|waiter)_opts$/);
              if (!m) { dead.push(`${n.id} → config.${id}.${side} (the route ignores that side)`); continue; }
              for (const k of Object.keys(v)) if (!configOpts.has(`${id}|${m[1]}|${k}`)) dead.push(`${n.id} → config.${id}.${side}.${k}`);
            }
          continue;
        }
        const set = allowed[family];
        if (!set) { dead.push(`${n.id} → the route has no "${family}" branch at all`); continue; }
        for (const k of Object.keys(obj)) if (!set.has(k)) dead.push(`${n.id} → ${family}.${k}`);
      }
    }
  }
  if (dead.length) fail(`a row's own save would be DROPPED by the write route (the switch moves and nothing changes): ${dead.join(", ")}`);
  else ok(`all ${ALL_NODES.length} rows: every key their own save writes is one the route accepts`);
}

// ── 12 · a person's per-person rows must be writable by the routes that save them ──
{
  const { capsForRole } = await import("../node_modules/.cache/staffCaps.mjs").catch(() => ({ capsForRole: null }));
  if (!capsForRole) ok("per-person allow-lists: skipped (staffCaps bundle not built)");
  else {
    const adminRoute = read("app/api/admin/users/route.ts");
    const ownerRoute = read("app/api/owner/staff/route.ts");
    const bad = [];
    for (const r of ["manager", "tablet"]) {
      const keys = capsForRole(r).filter((c) => c.perPerson).map((c) => c.key);
      if (!keys.length) bad.push(`${r} has no per-person rows at all`);
    }
    // Both write routes must derive from staffCaps INSIDE their set_permissions handler, never from
    // a hand-picked constant. That drift is what made "Delete a bill" impossible to set on one
    // screen and fine on the other. Checked on the HANDLER, not the file: an unused import at the
    // top would otherwise satisfy a whole-file search while the handler used something else.
    const handlerOf = (src, file) => {
      const i = src.indexOf('action === "set_permissions"');
      if (i < 0) { bad.push(`${file}: no set_permissions handler found — if it moved, update this guard`); return ""; }
      const j = src.indexOf('\n  if (action === ', i + 30);
      // CODE ONLY. The handler's own comments name the retired constants (explaining why they are
      // gone), and a naive search on the raw text flagged the very comment that documents the fix.
      return src.slice(i, j > 0 ? j : i + 4000).replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
    };
    for (const [src, file] of [[adminRoute, "app/api/admin/users"], [ownerRoute, "app/api/owner/staff"]]) {
      const h = handlerOf(src, file);
      if (!h) continue;
      if (!/capsForRole\(/.test(h)) bad.push(`${file}: set_permissions does not build its allow-list from capsForRole()`);
      if (/TABLET_PERM_KEYS|MANAGER_POWER_FLAGS/.test(h)) bad.push(`${file}: set_permissions still allow-lists from a hand-picked constant`);
    }
    if (bad.length) fail(`per-person permissions: ${bad.join("; ")}`);
    else ok("both write routes allow-list a person's rows from the ONE list (lib/staffCaps)");
  }
}

// ── 13 · a waiter can never print an invoice or reopen a bill (owner's rule, 2026-08-04) ──
{
  const bad = [];
  if (!WAITER_NEVER.includes("tablet_invoice")) bad.push("tablet_invoice is not on the never-list");
  if (waiterCapValue("tablet_invoice", "on") !== "off") bad.push("a stored 'on' can still grant the invoice");
  // and no row may offer either of them
  for (const n of ALL_NODES) {
    if (n.bind.t === "tablet" && WAITER_NEVER.includes(n.bind.key)) bad.push(`a row (${n.id}) offers ${n.bind.key}, which a waiter may never have`);
    if (n.bind.t === "capTablet" && n.bind.id === "void_bills") bad.push(`a row (${n.id}) still offers a waiter the reopen-a-bill tri-state`);
  }
  const tabletApi = read("app/api/tablet/[...path]/route.ts");
  if (!tabletApi.includes("WAITER_NEVER")) bad.push("the tablet API does not consult WAITER_NEVER — hiding would be the only guard");
  // an unlisted floor capability must read ON, or a waiter is stuck with no switch to fix it
  if (waiterCapValue("tablet_something_new", undefined) !== "on") bad.push("an unlisted waiter capability reads OFF — that is the bug that stuck 8 of 9 restaurants");
  if (bad.length) fail(`waiter rules: ${bad.join("; ")}`);
  else ok("a waiter can never print an invoice or reopen a bill, and an unlisted floor action stays on");
}

// ── 14 · every search synonym must name a real row ──────────────────────────
{
  const src = read("components/admin/AccessSearch.tsx");
  const body = (src.match(/const SYNONYMS: Record<string, string> = \{([\s\S]*?)\n\};/) || [])[1] || "";
  const keys = [...body.matchAll(/\n  ([a-z0-9_]+): "/g)].map((m) => m[1]);
  const ids = new Set(ALL_NODES.map((n) => n.id));
  const stale = keys.filter((k) => !ids.has(k));
  if (!keys.length) fail("could not read the SYNONYMS map — if it moved, update this guard");
  else if (stale.length) fail(`${stale.length} search synonym key(s) name a row that does not exist, so those words match nothing: ${stale.join(", ")}`);
  else ok(`all ${keys.length} search synonyms name a real row`);
}

// ── 15 · every row must actually RENDER a control (sweep 2026-08-05) ────────
// THE BUG THIS EXISTS TO KILL: "Put menu on maintenance" is the one row whose MAIN bind is `has`,
// and `has` was missing from AccessTree's isBoolBind list. Control() therefore fell through every
// branch and returned null, so the row shipped with a name, help text and NO SWITCH — an empty gap
// where every neighbouring row has a toggle. Nothing caught it: the key was allow-listed for
// saving (check 11), it was read by real code (check 9), and the save path worked perfectly. It
// was simply unreachable. Check 9 asks "does this switch reach code"; this asks the other half,
// "can a person reach this switch".
{
  const tree = read("components/admin/AccessTree.tsx");
  const listed = new Set(((tree.match(/const isBoolBind = \(n: Node\) =>\s*\[([^\]]*)\]/) || [])[1] || "")
    .split(",").map((x) => x.trim().replace(/^"|"$/g, "")).filter(Boolean));
  // Every OTHER bind kind Control() draws by name. Keep in step with that function.
  const drawn = new Set(["tablet", "capTablet", "choice", "limit", "list", "text", "creds", "opt"]);
  const bad = [];
  for (const n of ALL_NODES) {
    if (n.leftToBuild || n.bind.t === "none") continue;              // deliberately no control
    if (listed.has(n.bind.t) || drawn.has(n.bind.t)) continue;
    bad.push(`${n.id} (bind "${n.bind.t}") renders no control at all`);
  }
  // The feature half of a two-control row is drawn by FeatureRow, which needs the same answer.
  for (const n of ALL_NODES) {
    if (!n.featureBind) continue;
    if (!listed.has(n.featureBind.t) && !drawn.has(n.featureBind.t))
      bad.push(`${n.id}'s Feature half (bind "${n.featureBind.t}") renders no control`);
  }
  if (bad.length) fail(`a row a person cannot reach: ${bad.join("; ")}`);
  else ok(`all ${ALL_NODES.filter((n) => !n.leftToBuild && n.bind.t !== "none").length} switchable rows render a control someone can tap`);
}

// ── 16 · the defaults tool must see BOTH halves of a two-control row ────────
// Aangan — the control restaurant the QA suite checks against the model's defaults — had its
// manager Rating review FEATURE switched off while `npm run access:defaults` reported "already at
// the factory defaults". The script read n.bind only, and every two-control row keeps half its
// state in n.featureBind. A tool that cannot see a drift can never restore it.
{
  const src = read("scripts/set-access-defaults.mjs");
  const twoControl = ALL_NODES.filter((n) => n.featureBind && !n.leftToBuild).length;
  if (!src.includes("featureBind"))
    fail(`the defaults script ignores featureBind, so it is blind to the Feature half of all ${twoControl} two-control rows`);
  else ok(`the defaults tool reads both halves of all ${twoControl} two-control rows`);
}

// ── 17 · BOTH SIDES MUST ANSWER A *MISSING* KEY THE SAME WAY ────────────────
// THE BUG THIS EXISTS TO KILL (sweep T6, 2026-08-10 — it was live on 7 of 9 restaurants). The
// Access screen reads an unstored Edit-menu sub-option as "use this row's default" (nodeValue →
// present()), and eight of the nine default to ON. The editor API read the same unstored value as
// NO, because it treated "the restaurant has ANY stored manager_opts" as "everything not explicitly
// true is false". So an admin read "Change a price: ON" and the manager was refused, with no switch
// anywhere able to fix it — the screen-says-ON-server-says-NO drift this whole model removes.
//
// Every check in this file until now asked "is this key READ by real code?". None asked "do the two
// readers AGREE?", which is why a green suite sat on top of it for days.
{
  const parts = Object.keys(MENU_PART_DEFAULTS);
  if (!parts.length) fail("MENU_PART_DEFAULTS is empty — the nine Edit-menu rows are no longer derivable from the model");
  else if (!editorApi.includes("MENU_PART_DEFAULTS"))
    fail("resolveMenuParts() in app/api/editor no longer resolves a MISSING Edit-menu key through MENU_PART_DEFAULTS — the screen and the server can drift apart again (7 of 9 restaurants were wrong the last time)");
  else if (/configured \? mo!\[k\] === true/.test(editorApi))
    fail("resolveMenuParts() still has the old \"configured ⇒ only an explicit true allows\" branch, which reads a missing key as NO while the screen reads it as the row's default");
  else ok(`both readers answer a MISSING Edit-menu key the same way (all ${parts.length} parts, via MENU_PART_DEFAULTS)`);
}

// ── 18 · A NEW RESTAURANT MUST BE BORN AGREEING WITH THE SCREEN ─────────────
// The reset tool writes node.def and the QA suite compares Aangan against node.def — but nothing
// compared node.def against what a BRAND-NEW restaurant is actually given. That gap is where
// "Own website: On by default" sat while every new restaurant got it OFF, which also meant
// `set-access-defaults` would have switched an inbound order channel ON as part of a reset.
//
// Only the columns lib/settingsClone.ts is RESPONSIBLE for are checked. The guest-menu look
// columns are deliberately cloned from the template restaurant (docs/REJECTED-IDEAS.md R8), so
// they are not part of this contract and must not be reported.
{
  const clone = read("lib/settingsClone.ts");
  const bad = [];
  if (!clone.includes("CHANNEL_DEFAULTS"))
    bad.push("platform_channels is not seeded from CHANNEL_DEFAULTS, so a new restaurant can be born disagreeing with the Own website / Zomato / Swiggy rows");
  for (const [k, v] of Object.entries(CHANNEL_DEFAULTS)) {
    const node = ALL_NODES.find((n) => n.bind.t === "channel" && n.bind.key === k);
    if (node && (defOf(node) === true) !== v.on) bad.push(`channel "${k}" default disagrees with its own row`);
  }
  // Every tablet tri-state must have an explicit default in the clone file — a waiter power that
  // silently inherits the template restaurant's value is the bug migration 295 had to repair.
  for (const col of TABLET_COLS) {
    if (!new RegExp(`base\\.${col}\\s*=`).test(clone)) bad.push(`${col} has no explicit default in cleanClonedSettings — a new restaurant would inherit the template's waiter power`);
  }
  if (bad.length) fail(`a new restaurant is born disagreeing with the Access screen: ${bad.join("; ")}`);
  else ok(`a new restaurant is born matching the screen for all ${Object.keys(CHANNEL_DEFAULTS).length} channels + all ${TABLET_COLS.length} waiter columns`);
}

// ── 19 · THE TABLET MUST HIDE WHAT THE RESTAURANT DOES NOT HAVE ─────────────
// The manager panel folds the Feature half into what it SHOWS (effectivePowers = hasFeature &&
// granted). The tablet did not: switching "Discount a bill" off for a restaurant left the Discount
// button on the tablet and the waiter found out by tapping it in front of a guest. The map of which
// waiter column sits under which Feature half was also hand-typed in the route, covering exactly
// one column — correct for today and silently wrong for the next row added.
{
  const tabletApi = read("app/api/tablet/[...path]/route.ts");
  const bad = [];
  if (Object.keys(WAITER_FEATURE_OF).length === 0)
    bad.push("WAITER_FEATURE_OF is empty — no waiter row's Feature half is derivable from the model");
  if (/const WAITER_FEATURE_OF: Record<string, string> = \{/.test(tabletApi))
    bad.push("app/api/tablet keeps its own hand-typed WAITER_FEATURE_OF instead of the derived one");
  if (!/resolveWaiterCaps|waiterFeatureOffCols/.test(tabletApi) || !/overlayUserPerms\([^)]*accessConfig|accessConfig\?: unknown/.test(tabletApi))
    bad.push("overlayUserPerms() no longer takes the restaurant's access_config, so the tablet can show a button the server refuses");
  if (bad.length) fail(`the tablet can show what the restaurant does not have: ${bad.join("; ")}`);
  else ok(`the tablet hides every waiter row whose Feature half is off (${Object.keys(WAITER_FEATURE_OF).length} mapped, derived from the rows)`);
}

// ── 20 · THE ACCESS SCREEN MUST NOT SILENTLY OVERWRITE ANOTHER ADMIN ────────
// Project rule 11 ("first save wins, the loser is told") was enforced nowhere on the one screen
// that decides what anyone can do, and scripts/verify-clash-coverage.mjs did not know the route
// existed — so it reported green over the gap.
{
  const route = read("app/api/admin/restaurants/access-tree/route.ts");
  const screen = read("components/admin/AccessTree.tsx");
  const bad = [];
  if (!route.includes("expectClash")) bad.push("the access-tree route no longer reads an expectation");
  if (!screen.includes("X-LFH-Expect")) bad.push("the Access screen no longer SENDS what it was editing from");
  if (!tree.includes("export function nodeExpect")) bad.push("nodeExpect() is gone from the model, so the screen has nothing to send");
  if (bad.length) fail(`two admins can silently overwrite each other on Access & permissions: ${bad.join("; ")}`);
  else ok("a second admin's tap on the same switch is refused, not silently applied");
  // …AND THE REFUSAL HAS TO READ AS ENGLISH. The gate quotes the value it found, and it was saying
  // a permission "now says “false”" — a word that appears nowhere on the screen the admin is
  // looking at. The owner's standing rule is that these lines read like a person wrote them.
  const clash = read("lib/clash.ts");
  if (!/typeof v === "boolean"/.test(clash) || !/"pin"/.test(clash))
    fail("lib/clash.ts describe() no longer says on/off for a switch — a refused permission change would quote \"true\"/\"false\"/\"pin\" at an admin");
  else ok("a refused permission change is described in the words the screen uses (on / off / manager PIN)");
  // …AND EVERY SCREEN THAT SENDS AN EXPECTATION HAS TO READ THE ANSWER THE SAME WAY. The staff
  // profile sends X-LFH-Expect on the job, the pay and every profile card, but its ADMIN host read
  // `j.error` — which is the machine code — so a refused save printed "clash_changed_elsewhere" at
  // the person. The owner's copy of the same panel has always read `clash.plain`. (T15, 2026-08-18)
  // CODE ONLY — both files EXPLAIN this rule in a comment, so a naive text search reads its own
  // documentation and passes over the very line that was wrong (it did, on the first draft).
  const codeOf = (s) => s.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  for (const [file, raw] of [["components/admin/StaffProfile.tsx", read("components/admin/StaffProfile.tsx")],
                             ["components/owner/ownerProfileHost.ts", read("components/owner/ownerProfileHost.ts")]]) {
    const src = codeOf(raw);
    if (!/X-LFH-Expect/.test(src) && !/clash/.test(src)) continue;   // this host doesn't opt in
    if (!/\.clash\b[\s\S]{0,200}\bplain\b/.test(src))
      fail(`${file} shows a refused save as the raw code instead of the plain sentence lib/clash.ts sends`);
    else ok(`${file} shows a refused save in plain words`);
  }
}

// ── 21 · THE SCREEN MUST NOT OFFER A PERMISSION THE OWNER DELETED (R27) ─────
// THE BUG THIS EXISTS TO KILL (sweep T15, 2026-08-18). "Delete a bill" left the manager's money
// list on 2026-08-16 (docs/REJECTED-IDEAS.md R27 — cancel is the only route out of a bill for
// anyone at the restaurant). The ROW went; the WORDS around it did not. "Permission for manager"
// still told the admin, in its own description, that the group holds "delete a bill", and the Bills
// row still said "Reopen, delete and discount keep their own rows above". So the one screen that
// decides what a manager may do advertised a power the product refuses on compliance grounds —
// and every check in this file passed, because they all ask about SWITCHES and none reads the
// prose beside them.
//
// A sentence is allowed to say the thing does NOT exist; that is the correction. It may not list
// it as something a role can be given.
{
  const bad = [];
  for (const n of ALL_NODES) {
    if (n.bind?.t === "grant" && n.bind.flag === "delete_bill") bad.push(`a row (${n.id}) offers the delete_bill grant`);
    if (/^\s*delete (a|the) bill\s*$/i.test(n.name || "")) bad.push(`a row (${n.id}) is named "${n.name}"`);
    // PER OCCURRENCE, not per string: a sentence that both denies the power AND lists it would
    // otherwise pass on the strength of the denial. Only the 60 characters immediately BEFORE each
    // mention decide whether that mention is a prohibition or an offer.
    const text = `${n.name || ""} ${n.what || ""}`;
    for (const m of text.matchAll(/delete (a|the) bill/gi)) {
      const before = text.slice(Math.max(0, m.index - 60), m.index);
      if (!/\b(no|not|never|cannot|can't|without|refuses|gone|nobody)\b/i.test(before))
        bad.push(`"${n.name}" lists deleting a bill as something a role may be given — R27 says nobody at the restaurant may`);
    }
  }
  const doc = read("docs/ACCESS-MODEL.md");
  const bLine = (doc.match(/\n2\. \*\*Permission for manager\*\*[\s\S]{0,300}/) || [""])[0];
  if (/`Delete a bill`\s*·/.test(bLine))
    bad.push("docs/ACCESS-MODEL.md still lists `Delete a bill` as a live Permission-for-manager row");
  if (bad.length) fail(`the access model still offers "delete a bill" (docs/REJECTED-IDEAS.md R27): ${bad.join("; ")}`);
  else ok("nothing on the Access screen offers a manager the power to delete a bill (R27)");
}

// ── 22 · A ROW'S HELP PICTURES MUST NAME A ROW THAT EXISTS ──────────────────
// Same shape as check 14 (the search synonyms), and for the same reason. HELP_SHOTS in
// components/admin/AccessTree.tsx maps a ROW ID to the screenshots its ⓘ shows. Rows get renamed —
// "Audit" became "Audit & logs" and `own_logs` became `own_audit` on 2026-08-02 — and a map keyed
// by the old id keeps its entry, matches nothing, and silently stops showing the picture it was
// written for. Nothing said so, because a name with no file is dropped by the <img> onError, which
// is the same outcome as a key that never matched. (sweep T15, 2026-08-18)
{
  const src = read("components/admin/AccessTree.tsx");
  const body = (src.match(/const HELP_SHOTS: Record<string, string\[\]> = \{([\s\S]*?)\n\};/) || [])[1] || "";
  // EVERY key, not the first one on each line: entries are written several to a line
  // ("mgr_tab_editor: […], own_menu: […]"), and a `\n\s*`-anchored scan saw 16 of the 20 —
  // including none of the four the first version of this guard was written to catch.
  const keys = [...body.replace(/\/\/[^\n]*/g, "").matchAll(/(?:^|[\s{,])([a-z0-9_]+):\s*\[/g)].map((m) => m[1]);
  const ids = new Set(ALL_NODES.map((n) => n.id));
  const stale = keys.filter((k) => !ids.has(k));
  if (!keys.length) fail("could not read the HELP_SHOTS map — if it moved, update this guard");
  else if (stale.length) fail(`${stale.length} help-picture key(s) name a row that does not exist, so those rows silently show no picture: ${stale.join(", ")}`);
  else ok(`all ${keys.length} help-picture keys name a real row`);

  // ── AND THE FILE IT PROMISES MUST BE IN THE REPO (sweep #7 T15, 2026-08-27) ────────────────
  // The half above checks the KEY. Nobody was checking the VALUE, and two entries named a
  // picture that has never been in `public/admin-help` — `allergy_other → allergy-other.png`
  // and `guest_note → guest-note.png`. Nothing looked broken, which is exactly why it lasted:
  // since the 2026-08-18 fix a row with no picture says "there wasn't a good picture for this
  // one", and a row whose named file is missing says the identical thing. So an EXPLICIT entry —
  // whose whole meaning is "I have a picture for this row" — degrades into the same screen as no
  // entry at all, and the person who forgot to commit the .png is never told.
  //
  // Only the explicit list is checked. The derived fallback (a row with no entry probes
  // `<id>.png` and `<id-with-dashes>.png`) is a guess by design and is allowed to miss.
  {
    const named = [...body.replace(/\/\/[^\n]*/g, "").matchAll(/"([a-z0-9_\-]+)"/g)].map((m) => m[1]);
    const gone = [...new Set(named)].filter((n) => {
      try { readFileSync(join(root, "public/admin-help", `${n}.png`)); return false; } catch { return true; }
    });
    if (gone.length) fail(`${gone.length} help-picture(s) are promised by name and are not in public/admin-help, so those rows say "there wasn't a good picture" while the code claims one: ${gone.join(", ")}`);
    else ok(`all ${new Set(named).size} explicitly-named help pictures are in the repo`);
  }
}

// ── 23 · A MODULE GATE WITH NO SWITCH ON THE SCREEN ─────────────────────────
// THE FAULT THIS EXISTS TO CATCH (sweep T15, 2026-08-18 — it is live on 7 of 9 restaurants).
//
// lib/accessModel.ts still carries a `module:` binding on some permissions. The editor's whoami
// loops over those and forces the power OFF when the module's `<x>_allowed` column is false; the
// tablet route does the same to the matching tablet_* tri-state. That is correct ONLY while the
// Access screen has a switch for that module — otherwise a stored `false` is unreachable for ever
// and the screen shows the capability as ON while both panels are refused. lib/accessModel.ts says
// so in as many words, at the parcel/platform rows: "Do not re-add a module binding without a
// switch on the Access screen to go with it: a gate no admin can see is the dead switch the access
// rebuild deleted."
//
// Three bindings were left behind when the rebuild removed their rows. Measured on the backup
// database, 2026-08-18: table_ops_allowed was false on burger-barn, sakura-sushi, demo-bistro,
// green-bowl, taco-fiesta, pizza-palace and spice-route (true only on french-house and aangan), and
// table_tags_allowed on the same seven minus pizza-palace — while Access → Waiter → "Move, merge or
// split a table" read ON and no screen could put it right.
//
// RESOLVED (owner, 2026-08-18): "I want that toggle thing where you can able to check… I want to
// turn on and turn off the feature if the restaurant required or not required." All three now have
// a switch in Main features, so their `module:` bindings are correct again and the list below is
// empty. It stays as a list so a FOURTH module losing its row fails here immediately.
{
  const HANDOFF_PENDING = [];
  // ONE SLICE PER PERMISSION, anchored on its `{ id: "x", group: "y"` opening and ending at the
  // next one. A looser "id … within 900 characters … module:" scan reads across the boundary and
  // reports the module of the row BELOW (it blamed print_invoice for khata's binding while this
  // check was being written), so the guard would name the wrong row on the day it matters.
  const anchors = [...accessModel.matchAll(/\{\s*id:\s*"([a-z0-9_]+)",\s*group:\s*"/g)];
  const withModule = anchors.map((a, i) => {
    const own = accessModel.slice(a.index, i + 1 < anchors.length ? anchors[i + 1].index : accessModel.length);
    const m = own.match(/\bmodule:\s*\{\s*allowed:\s*"([a-z0-9_]+)_allowed"/);
    return m ? { id: a[1], mod: m[1] } : null;
  }).filter(Boolean);
  if (!anchors.length) fail("could not read the permission list in lib/accessModel.ts — if its shape changed, update this guard");
  const stranded = withModule.filter((p) => !MODULE_KEYS.includes(p.mod));
  const unexpected = stranded.filter((p) => !HANDOFF_PENDING.includes(p.mod));
  const healed = HANDOFF_PENDING.filter((m) => !stranded.some((p) => p.mod === m));
  if (unexpected.length)
    fail(`a module gate with NO switch on the Access screen — a stored false is unreachable for ever and the screen would show it ON: ${unexpected.map((p) => `${p.id} → settings.${p.mod}_allowed`).join(", ")}`);
  else if (healed.length)
    fail(`${healed.join(", ")} no longer needs its place on the T15 handoff list in this check — take the name(s) out of HANDOFF_PENDING in the same commit as the fix`);
  else ok(HANDOFF_PENDING.length
    ? `no NEW module gate is unreachable from the screen (${HANDOFF_PENDING.length} known and handed off: ${HANDOFF_PENDING.join(", ")})`
    : `every one of the ${withModule.length} module gates has a switch on the Access screen`);
}

// ── 24 · THE SPEC'S MENU TABLE MUST LIST EVERY MENU ROW ─────────────────────
// docs/ACCESS-MODEL.md section A1 is a row-by-row table of what sits under Menu, and the next
// session builds from it. It had drifted: "Prep time on a dish" had been on the screen for days
// with no line in the table, and the table put Bubble effect above Design and styling and called
// the latter "(last)" when it is not. A count check is enough to catch a row added or removed on
// one side and not the other, and it needs no name matching between two vocabularies. (T15)
{
  const doc = read("docs/ACCESS-MODEL.md");
  const a1 = (doc.match(/### A1 · Menu[\s\S]*?\n\| Sub-option \| Default \| What it does \|\n\|[-|\s]+\|\n([\s\S]*?)\n\n/) || [])[1];
  const menuNode = ALL_NODES.find((n) => n.id === "menu");
  if (!a1 || !menuNode) fail("could not read section A1's table, or the Menu row — if either moved, update this guard");
  else {
    const docRows = a1.split("\n").filter((l) => l.trim().startsWith("|")).length;
    const treeRows = (menuNode.children || []).length;
    if (docRows !== treeRows)
      fail(`docs/ACCESS-MODEL.md A1 lists ${docRows} sub-options and Menu has ${treeRows} — the spec and the screen disagree about what is under Menu`);
    else ok(`the spec's Menu table lists all ${treeRows} of the rows the screen shows`);
  }
}

// ── 25 · THE ADMIN MUST BE ABLE TO CREATE A WAITER ──────────────────────────
// THE FAULT THIS EXISTS TO KILL (sweep T15, 2026-08-18). newWaiterTables() in lib/tableAssign.ts
// REFUSES a waiter created with an empty table pick — for every restaurant, with no module check
// (owner, 2026-07-30: "block it — must pick at least one"). POST /api/admin/users calls it for
// every `tablet` role. The admin's own Add-a-user form never sent `tables` and had no control for
// one, so creating a waiter from /aevinite → Users was IMPOSSIBLE: the form submitted and the
// server answered "Pick at least one table for this waiter … Use 'Select all' for the whole
// floor", naming a control that was not on the screen. Watched happen, then watched work.
//
// Two halves, and both have to hold: the server still demands it, and the form still asks for it.
{
  const assign = read("lib/tableAssign.ts");
  const form = read("app/aevinite/users/page.tsx");
  const route = read("app/api/admin/users/route.ts");
  const demanded = /Pick at least one table for this waiter/.test(assign) && /newWaiterTables/.test(route);
  const bad = [];
  if (demanded) {
    if (!/tables:\s*newTables/.test(form)) bad.push("the admin's Add-a-user form does not send `tables`, so every waiter create is refused");
    if (!/Tables this waiter will serve/.test(form)) bad.push("the admin's Add-a-user form has no table picker, so there is no way to answer the question the server asks");
    if (!/Select all/.test(form)) bad.push('the form has no "Select all" — the owner\'s one-tap whole floor (2026-07-30)');
  }
  if (!demanded) ok("waiter creation: the server no longer demands a table pick, so the form need not ask");
  else if (bad.length) fail(`the admin cannot create a waiter: ${bad.join("; ")}`);
  else ok("the admin's Add-a-user form asks which tables a new waiter serves, which is what the server demands");
}

// ── 26 · AN EXPECTATION HEADER MUST BE PURE ASCII, OR NOTHING IS SENT AT ALL ──
// THE BUG THIS EXISTS TO KILL (sweep T15, 2026-08-18). A header value must be ISO-8859-1, and
// fetch() throws away the WHOLE request if it is not: "String contains non ISO-8859-1 code point".
// The X-LFH-Expect header carries the row's NAME as its label, and two rows on the Access screen are
// named with an em dash — "Quick order — send to a table" and "Parcel — send it out". Both were
// therefore impossible to save from the screen at all: the toggle did not move, no request was made,
// and the save line read "Not saved" with nothing to explain it. Every other check in this file
// passed straight over it, because the ROW, the KEY, the ROUTE and the ALLOW-LIST were all perfect.
//
// The staff profile had the same trap waiting, where the fields are a person's own typing.
{
  const bad = [];
  for (const [file, src] of [["components/admin/AccessTree.tsx", read("components/admin/AccessTree.tsx")],
                             ["components/admin/StaffProfile.tsx", read("components/admin/StaffProfile.tsx")]]) {
    if (!/X-LFH-Expect/.test(src)) continue;
    if (/"X-LFH-Expect":\s*JSON\.stringify/.test(src))
      bad.push(`${file} builds the header with a bare JSON.stringify — one em dash in a row name or in a person's typing and the whole save is thrown away by the browser`);
    else if (!/"X-LFH-Expect":\s*expectHeader\(/.test(src))
      bad.push(`${file} no longer builds the header with expectHeader()`);
  }
  if (!/export function expectHeader/.test(tree)) bad.push("expectHeader() is gone from lib/accessTree.ts");
  // …and prove it on the real rows: every expectation this model can produce must escape to ASCII.
  const st = { features: {}, settings: {}, channels: {}, grants: {}, sections: {}, tabs: {}, config: {}, creds: {} };
  for (const n of ALL_NODES) {
    const b = n.bind;
    if (b.t === "feature") st.features[b.key] = true;
    else if (["setting", "choice", "text", "list", "tablet"].includes(b.t)) st.settings[b.key] = "x";
    else if (b.t === "module") st.settings[`${b.key}_allowed`] = true;
    else if (b.t === "grant") st.grants[b.flag] = true;
    else if (b.t === "section") st.sections[b.key] = true;
  }
  const notAscii = ALL_NODES.map((n) => [n, nodeExpect(n, st, "rid")]).filter(([, e]) => e)
    .filter(([, e]) => [...expectHeader(e)].some((c) => c.charCodeAt(0) > 127))
    .map(([n]) => n.id);
  if (notAscii.length) bad.push(`expectHeader() still leaves a non-ASCII character in the header for: ${notAscii.join(", ")}`);
  if (bad.length) fail(`a save the browser will refuse to send: ${bad.join("; ")}`);
  else ok(`every expectation header is pure ASCII, for all ${ALL_NODES.length} rows and for a person's own typing`);
}

// ── 27 · A REFUSED SAVE MUST STILL BE ON SCREEN A SECOND LATER ──────────────
// The Access screen answers a refusal by setting the sentence AND reloading the row, so you can see
// what it really says now. load() cleared the error on success — on the same tick — so the sentence
// was gone before anyone could read it and the switch just snapped back. Sampled every 100ms: there
// at +0ms, gone by +100ms. (sweep T15, 2026-08-18)
{
  const src = read("components/admin/AccessTree.tsx");
  const bad = [];
  if (!/const load = useCallback\(\(id: string, keepError = false\)/.test(src))
    bad.push("load() no longer takes the keep-the-message flag");
  if (!/setSaving\("err"\); load\(rid, true\)/.test(src))
    bad.push("the refusal path reloads WITHOUT keeping its own message, so the sentence is wiped by the reload it asked for");
  if (/connection dropped[\s\S]{0,40}load\(rid\)/.test(src))
    bad.push("the dropped-connection path reloads without keeping its message");
  if (bad.length) fail(`a refused save on the Access screen says nothing: ${bad.join("; ")}`);
  else ok("a refused save keeps its explanation on screen after the reload it triggers");
}

// ── 28 · THE ACTIVITY LINE SAYS A WAITER'S PIN STATE IN WORDS ───────────────
// The "Recent changes here" strip is the only place an admin sees what they just did, and the
// owner's standing rule is that the log reads as English. A waiter's tri-state came through the
// plain settings loop, so it wrote "Mark a bill paid: pin" — a word that is on no screen — while
// the capTablet branch of the SAME function said "on, with a manager PIN" for the same idea. Six of
// the eight waiter rows are column-bound, so the wrong form was the common one. (T15, 2026-08-18)
{
  // CODE ONLY — the loop EXPLAINS this rule in a comment, and a naive search reads its own
  // documentation and passes over the very line that was wrong (it did, on the first draft).
  const route = read("app/api/admin/restaurants/access-tree/route.ts")
    .replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  const settingsLoop = (route.match(/for \(const \[k, v\] of Object\.entries\(obj\(patch\.settings\)\)\) \{[\s\S]*?\n  \}/) || [""])[0];
  if (!settingsLoop) fail("could not find describeAccessPatch's settings loop — if it moved, update this guard");
  else if (!/manager PIN/.test(settingsLoop))
    fail('the activity line writes a waiter tri-state raw, so the Recent-changes strip says "pin" instead of "on, with a manager PIN"');
  else ok("the activity line says a waiter's PIN state in words, the same way both of its branches do");
}

// ── 51 · A FOLDER BUILT FROM A GENERATED LIST MUST STILL DESCRIBE ITSELF ───
// "Permission for manager" takes its rows from `...ACTIONS.map(mgrAction)`, so adding a row to
// ACTIONS puts it on the screen with the folder's own description unchanged and nobody reminded.
// That is exactly what happened on 2026-08-26: "May be the printer" joined ACTIONS while the
// folder still told the admin it held "The money actions … reopen a bill … and discount a bill" —
// two of three, and the third is not a money action at all. The ⓘ of a folder is the only thing
// that explains a group before you open it, so a stale one describes a restaurant's permissions
// wrongly on the one screen that decides them. (sweep #7 T15, 2026-08-27)
//
// PINNED TO THE GENERATED FOLDERS ONLY, and that is deliberate. Two earlier drafts of this check
// tried to judge every folder's prose and both cried wolf on good writing — "Design and styling"
// says "its theme, logo and wording", which happens to contain three of its rows' words while
// enumerating nothing, and "What a waiter can do on the floor" mentions khata and parcel only to
// say a module can hide them. Prose is not a list and a guard cannot tell them apart. A folder
// whose children are SPREAD IN FROM AN ARRAY is the one shape where the screen can grow a row
// with no human editing the sentence beside it, so that is the only shape checked here.
{
  const spread = [...tree.matchAll(/\.\.\.([A-Z_]+)\.map\(/g)].map((m) => m[1]);
  if (!spread.length) fail("no folder is built from a generated list any more — if that is right, delete check 51");
  else {
    const STOP = new Set(["a","an","the","and","or","of","for","to","on","off","in","at","be","is","it","its",
      "their","they","them","this","that","own","may","can","with","how","what","which","who","only","new"]);
    const sig = (str) => str.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 3 && !STOP.has(w));
    // Which folders those arrays feed: the ones whose children are exactly the array's rows.
    const generated = ALL_NODES.filter((n) => n.bind.t === "none" && n.children?.length
      && tree.includes(`id: "${n.id}"`) && new RegExp(`id: "${n.id}"[\\s\\S]{0,900}?\\.\\.\\.[A-Z_]+\\.map\\(`).test(tree));
    if (!generated.length) fail("check 51 could not find the folder built from ACTIONS — if it moved, update this guard");
    const misses = [];
    for (const f of generated) {
      const text = (f.what || "").toLowerCase();
      for (const kid of f.children) {
        if (kid.leftToBuild) continue;
        const ws = sig(kid.name);
        if (ws.length && !ws.some((w) => text.includes(w.replace(/s$/, ""))))
          misses.push(`"${f.name}" never mentions its own row "${kid.name}"`);
      }
    }
    if (misses.length) fail(`a folder whose rows are generated has a stale description: ${misses.join("; ")}`);
    else ok(`the ${generated.length} folder(s) built from a generated list still name every row inside them`);
  }
}

// ── report ─────────────────────────────────────────────────────────────────
for (const m of oks) console.log("  ok   " + m);
for (const m of fails) console.log("  FAIL " + m);
console.log(fails.length
  ? `\n${fails.length} problem${fails.length > 1 ? "s" : ""} — a switch on the Access screen would not reach real code.`
  : `\nAll ${oks.length} checks passed — every switch on the Access screen reaches real code.`);
process.exit(fails.length ? 1 : 0);
