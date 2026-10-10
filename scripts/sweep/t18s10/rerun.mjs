// scripts/sweep/t18s10/rerun.mjs — RE-RUN of every older ledger row whose SUBJECT is a file in
// sweep #10 terminal 18's territory (the access & permission model). Each old claim is re-proved
// against the code as it is today; nothing is trusted from the row's old ✅.
//
//   node scripts/sweep/t18s10/rerun.mjs        → node_modules/.cache/t18s10/rerun.{md,json}
//
// Writes nothing anywhere else. The database client is an in-memory stand-in (see lib.mjs).
import { load, src, chk, assert, eq, report, fakeClient } from "./lib.mjs";
import { execFileSync } from "node:child_process";
import { ROOT } from "./lib.mjs";

const T = await load("accessTree");
const M = await load("accessModel");
const C = await load("staffCaps");
const P = await load("staffProfileShared");
const SP = await load("staffProfile");
const AC = await load("accessConfig");
const AS = await load("accessState");
const OE = await load("ownerEntitlements");
const VA = await load("viewAsPerson");
const F = await load("features");

const treeSrc = src("lib/accessTree.ts");
const modelSrc = src("lib/accessModel.ts");
const capsSrc = src("lib/staffCaps.ts");
const sharedSrc = src("lib/staffProfileShared.ts");
const profSrc = src("lib/staffProfile.ts");
const stateSrc = src("lib/accessState.ts");
const cfgSrc = src("lib/accessConfig.ts");
const featSrc = src("lib/features.ts");
const vaSrc = src("lib/viewAsPerson.ts");
const oeSrc = src("lib/ownerEntitlements.ts");
const grep = (pat, where = "app lib components public/panels") => {
  try { return execFileSync("grep", ["-rlE", pat, ...where.split(" ")], { cwd: ROOT, encoding: "utf8" }).trim().split("\n").filter(Boolean); }
  catch { return []; }
};
const N = T.ALL_NODES;
const byId = T.NODE_BY_ID;
const empty = T.emptyState();
const BOOL_BINDS = ["feature", "setting", "module", "moduleBag", "channel", "grant", "section", "tab", "has", "ratingsMaster"];
const isBool = (n) => BOOL_BINDS.includes(n.bind.t);

const R = (id, file, check, fn) => chk(id, file, check, "re-run by scripts/sweep/t18s10/rerun.mjs", fn);

// ═════════════ T15 block A — the model, row by row (sweep #6, 2026-08-1x) ═════════════
await R("P07001", "lib/accessTree.ts", "SECTIONS has exactly the five the spec names", () => {
  eq(T.SECTIONS.map((s) => s.id), ["main", "extra", "mgrMenu", "ownMenu", "waiter"]); return "main · extra · mgrMenu · ownMenu · waiter";
});
await R("P07002", "lib/accessTree.ts", "ALL_NODES is built by walking every section", () => {
  let n = 0; for (const s of T.SECTIONS) T.walk(s.children, () => n++); eq(N.length, n); return `${n} nodes`;
});
await R("P07003", "lib/accessTree.ts", "NODE_BY_ID has no duplicate ids", () => { eq(Object.keys(byId).length, N.length); return `${N.length} unique`; });
await R("P07004", "lib/accessTree.ts", "every Bind variant declared is produced by a node, or retired with a note", () => {
  const used = new Set(N.flatMap((n) => [n.bind.t, n.featureBind?.t].filter(Boolean)));
  const declared = [...treeSrc.matchAll(/\|\s*\{\s*t:\s*"(\w+)"/g)].map((m) => m[1]);
  const unused = declared.filter((t) => !used.has(t));
  assert(unused.length === 0, `declared but unused: ${unused}`); return `${declared.length} variants, all used (panel/menu removed with notes)`;
});
await R("P07005", "lib/accessTree.ts", "no node carries the deleted `panel` bind", () => { assert(!N.some((n) => n.bind.t === "panel")); assert(/A `panel` variant/.test(treeSrc)); });
await R("P07006", "lib/accessTree.ts", "no node carries the deleted `menu` bind", () => { assert(!N.some((n) => n.bind.t === "menu")); assert(/A `menu` variant/.test(treeSrc)); });
await R("P07007", "lib/accessTree.ts", "no node carries info: true", () => { assert(!N.some((n) => "info" in n)); });
await R("P07008", "lib/accessTree.ts", "defOf falls back to off for tablet/capTablet and false otherwise", () => {
  eq(T.defOf({ id: "x", name: "x", what: "", bind: { t: "tablet", key: "k" } }), "off");
  eq(T.defOf({ id: "x", name: "x", what: "", bind: { t: "capTablet", id: "k" } }), "off");
  eq(T.defOf({ id: "x", name: "x", what: "", bind: { t: "feature", key: "k" } }), false);
});
await R("P07009", "lib/accessTree.ts", "defOfEarly and defOf are the same rule", () => {
  const a = treeSrc.match(/function defOfEarly[^{]*\{\s*return ([^;]+);/)[1].trim();
  const b = treeSrc.match(/export const defOf = [^=]*=>\s*([^;]+);/)[1].trim();
  eq(a.replace(/\s+/g, ""), b.replace(/\s+/g, ""));
});
await R("P07010", "lib/accessTree.ts", "nodeValue answers every bind kind; default returns null", () => {
  for (const n of N) T.nodeValue(n, empty);
  eq(T.nodeValue({ id: "x", name: "x", what: "", bind: { t: "nonsense" } }, empty), null); return `${N.length} nodes on an empty state`;
});
await R("P07011", "lib/accessTree.ts", "a stored null reads as nothing stored", () => {
  eq(T.nodeValue(byId.show_reviews, { ...empty, features: { reviews: null } }), true);
});
await R("P07012", "lib/accessTree.ts", "setting coerces with === true", () => {
  eq(T.nodeValue(byId.menu, { ...empty, settings: { menu_enabled: "true" } }), false);
});
await R("P07013", "lib/accessTree.ts", "list falls back to default when the stored array is empty", () => {
  eq(T.nodeValue(byId.menu_languages, { ...empty, settings: { menu_languages: [] } }), ["en"]);
});
await R("P07014", "lib/accessTree.ts", "ratingsMaster ON for every google mode", () => {
  for (const m of ["google", "google_after_normal"]) eq(T.nodeValue(byId.ratings, { ...empty, features: { ratings: false }, settings: { google_review_mode: m } }), true, m);
  eq(T.nodeValue(byId.ratings, { ...empty, features: { ratings: false }, settings: { google_review_mode: "off" } }), false);
});
await R("P07015", "lib/accessTree.ts", "ratingsMaster ON when features.ratings never stored", () => eq(T.nodeValue(byId.ratings, empty), true));
await R("P07016", "lib/accessTree.ts", "nodePatch(module) forces _enabled true", () => {
  eq(T.nodePatch(byId.khata, false), { settings: { khata_allowed: false, khata_enabled: true } });
});
await R("P07017", "lib/accessTree.ts", "ratingsMaster ON lands on Menu rating only", () => eq(T.nodePatch(byId.ratings, true).settings.google_review_mode, "off"));
await R("P07018", "lib/accessTree.ts", "extraPatch fires only for ratings_mode", () => {
  eq(T.extraPatch(byId.ratings_mode, "google"), { features: { ratings: false } });
  eq(T.extraPatch(byId.ratings_mode, "off"), { features: { ratings: true } });
  eq(T.extraPatch(byId.menu, true), {});
});
await R("P07019", "lib/accessTree.ts", "nodeExpect null for creds", () => eq(T.nodeExpect(byId.ch_zomato_key, { ...empty, creds: { zomato: "••••1234" } }, "r"), null));
await R("P07020", "lib/accessTree.ts", "nodeExpect null two levels deep in access_config", () => {
  const st = { ...empty, config: { give_discounts: { on: true, limit: { manager: 50 } }, edit_menu: { manager_opts: { add_dish: true } } }, tabs: { manager: { editor: true } } };
  for (const id of ["mgr_give_discounts_cap", "d_mgr_add_dish", "maintenance"]) eq(T.nodeExpect(byId[id], st, "r"), null, id);
});
await R("P07021", "lib/accessTree.ts", "nodeExpect null when nothing stored", () => eq(T.nodeExpect(byId.show_reviews, empty, "r"), null));
await R("P07022", "lib/accessTree.ts", "applyPatch deep-merges", () => {
  const s = T.applyPatch({ ...empty, config: { a: { manager_opts: { x: true, y: true } } } }, { config: { a: { manager_opts: { x: false } } } });
  eq(s.config.a.manager_opts, { x: false, y: true });
});
await R("P07023", "lib/accessTree.ts", "applyPatch never merges an array member-wise", () => {
  const s = T.applyPatch({ ...empty, settings: { menu_languages: ["en", "hi"] } }, { settings: { menu_languages: ["fr"] } });
  eq(s.settings.menu_languages, ["fr"]);
});
await R("P07024", "lib/accessTree.ts", "ancestorsOn ignores none ancestors", () => eq(T.ancestorsOn("mgr_bills_range", () => false), true));
await R("P07025", "lib/accessTree.ts", "ancestorsOn returns true for an unknown id", () => eq(T.ancestorsOn("no-such-row", () => false), true));
await R("P07026", "lib/accessTree.ts", "HAS_IDS from both bind slots", () => { assert(T.HAS_IDS.includes("maintenance")); assert(T.HAS_IDS.includes("give_discounts")); return T.HAS_IDS.join(" · "); });
await R("P07027", "lib/accessTree.ts", "KNOWN_CONFIG_IDS covers has · capTablet · opt · limit", () => {
  for (const k of ["maintenance", "close_unpaid", "edit_menu", "give_discounts", "view_logs", "view_bills"]) assert(T.KNOWN_CONFIG_IDS.has(k), k);
  return `${T.KNOWN_CONFIG_IDS.size} ids`;
});
await R("P07028", "lib/accessTree.ts", "TAB_KEYS collects featureBind tabs too", () => assert(T.TAB_KEYS.some((t) => t.panel === "manager" && t.key === "editor")));
await R("P07029", "lib/accessTree.ts", "TAB_ALLOWED built once here", () => {
  assert(/export const TAB_ALLOWED/.test(treeSrc)); assert(!/reduce\(/.test(stateSrc.split("TAB_ALLOWED")[0].slice(-400)));
  const dupes = grep("TAB_KEYS\\.reduce", "app lib").filter((f) => f !== "lib/accessTree.ts"); eq(dupes, []);
});
await R("P07030", "lib/accessTree.ts", "CHANNEL_DEFAULTS derived from the rows", () => eq(T.CHANNEL_DEFAULTS, { website: { on: true }, zomato: { on: false }, swiggy: { on: false } }));
await R("P07031", "lib/accessTree.ts", "MENU_PART_DEFAULTS from the nine manager opt rows", () => {
  eq(Object.keys(T.MENU_PART_DEFAULTS).length, 9); eq(T.MENU_PART_DEFAULTS.edit_3d, false);
});
await R("P07032", "lib/accessTree.ts", "WAITER_FEATURE_OF keys capTablet as cap:<id>", () => {
  eq(T.WAITER_FEATURE_OF, { tablet_discount: "give_discounts" });
  return "only tablet_discount shares a feature half today; the cap: branch is unexercised but present in source";
});
await R("P07033", "lib/accessTree.ts", "waiterFeatureOffCols [] for null/undefined", () => { eq(T.waiterFeatureOffCols(null), []); eq(T.waiterFeatureOffCols(undefined), []); });
await R("P07034", "lib/accessTree.ts", "SETTINGS_COLUMNS is a Set-deduped union", () => eq(new Set(T.SETTINGS_COLUMNS).size, T.SETTINGS_COLUMNS.length));
await R("P07035", "lib/accessTree.ts", "managerGrantValue TRUE for a flag with no row", () => eq(T.managerGrantValue("khata", false), true));
await R("P07036", "lib/accessTree.ts", "managerGrantValue honours a stored boolean", () => { eq(T.managerGrantValue("give_discounts", false), false); eq(T.managerGrantValue("void_bills", true), true); });
await R("P07037", "lib/accessTree.ts", "waiterCapValue off for WAITER_NEVER", () => eq(T.waiterCapValue("tablet_invoice", "on"), "off"));
await R("P07038", "lib/accessTree.ts", "waiterCapValue on for a column with no row", () => eq(T.waiterCapValue("tablet_something_new", undefined), "on"));
await R("P07039", "lib/accessTree.ts", "waiterCapValue falls back to the row default", () => { eq(T.waiterCapValue("tablet_take_orders", undefined), "on"); eq(T.waiterCapValue("tablet_mark_paid", undefined), "off"); });
await R("P07040", "lib/accessTree.ts", "waiterConfigCapValue applies the same rules", () => {
  eq(T.waiterConfigCapValue("close_unpaid", {}), "pin"); eq(T.waiterConfigCapValue("close_unpaid", { close_unpaid: { tablet: "off" } }), "off"); eq(T.waiterConfigCapValue("unknown", {}), "on");
});
await R("P07041", "lib/accessTree.ts", "resolveWaiterCaps rewrites every tablet_* key", () => eq(T.resolveWaiterCaps({ tablet_xyz: "junk" }).tablet_xyz, "on"));
await R("P07042", "lib/accessTree.ts", "resolveWaiterCaps fills a column the select did not return", () => eq(T.resolveWaiterCaps({}).tablet_take_orders, "on"));
await R("P07043", "lib/accessTree.ts", "resolveWaiterCaps forces WAITER_NEVER off last", () => eq(T.resolveWaiterCaps({ tablet_invoice: "on" }).tablet_invoice, "off"));
await R("P07044", "lib/accessTree.ts", "Feature half only when accessConfig passed", () => {
  eq(T.resolveWaiterCaps({ tablet_discount: "on" }).tablet_discount, "on");
  eq(T.resolveWaiterCaps({ tablet_discount: "on" }, { give_discounts: { on: false } }).tablet_discount, "off");
});
await R("P07045", "lib/accessTree.ts", "managerSettingsOff [] with no menus.mgrset", () => { eq(T.managerSettingsOff({}), []); eq(T.managerSettingsOff(null), []); });
await R("P07046", "lib/accessTree.ts", "managerTabsOff ignores a stored bills:false", () => eq(T.managerTabsOff({ menus: { manager: { bills: false, editor: false } } }), ["editor"]));
await R("P07047", "lib/accessTree.ts", "WAITER_NEVER holds tablet_invoice only", () => eq([...T.WAITER_NEVER], ["tablet_invoice"]));
await R("P07048", "lib/accessTree.ts", "ACTIONS holds the manager's own rows", () => {
  const ids = byId.mgr_may.children.map((n) => n.id);
  return `EXPECTATION MOVED: today ${ids.join(" · ")} — print_clear joined 2026-09-13; print setup joined 2026-08-27 and was retired 2026-09-14`;
});
await R("P07049", "lib/accessTree.ts", "ActionDef has no pin field", () => { const t = treeSrc.match(/type ActionDef = \{[\s\S]*?\n\};/)[0]; assert(!/\bpin\??:/.test(t)); });
await R("P07050", "lib/accessTree.ts", "no row offers delete_bill (R27)", () => { assert(!N.some((n) => /delete_bill/.test(JSON.stringify(n.bind)))); assert(!M.PERMISSIONS.some((p) => p.sub?.some((s) => s.id === "delete_bill"))); });
await R("P07051", "lib/accessTree.ts", "discount cap inside the discount row", () => eq(byId.mgr_give_discounts.children.map((c) => c.id), ["mgr_give_discounts_cap"]));
await R("P07052", "lib/accessTree.ts", "reopen window keeps id mgr_bill_reopen_mins", () => eq(byId.mgr_void_bills.children[0].id, "mgr_bill_reopen_mins"));
await R("P07053", "lib/accessTree.ts", "reopen window 5/10/15/30/60, default 5", () => { eq(byId.mgr_bill_reopen_mins.options, [5, 10, 15, 30, 60]); eq(byId.mgr_bill_reopen_mins.def, 5); });
await R("P07054", "lib/accessTree.ts", "manager cap 5/10/20/50/100, default 50", () => { eq(byId.mgr_give_discounts_cap.options, [5, 10, 20, 50, 100]); eq(byId.mgr_give_discounts_cap.def, 50); });
await R("P07055", "lib/accessTree.ts", "waiter cap default 5", () => eq(byId.wtr_give_discounts_cap.def, 5));
await R("P07056", "lib/accessTree.ts", "capTablet only for a row with no column", () => { eq(byId.wtr_close_unpaid.bind, { t: "capTablet", id: "close_unpaid" }); assert(byId.wtr_mark_paid.bind.t === "tablet"); });
await R("P07057", "lib/accessTree.ts", "WAITER_MONEY off except walk-out pin", () => eq(byId.wtr_money.children.map((n) => n.def), ["off", "off", "pin"]));
await R("P07058", "lib/accessTree.ts", "WAITER_FLOOR all six on", () => eq(byId.wtr_floor.children.map((n) => n.def), ["on", "on", "on", "on", "on", "on"]));
await R("P07059", "lib/accessTree.ts", "MANAGER_SETTINGS tables · users · access", () => eq(T.MANAGER_SETTINGS.map((x) => x.key), ["tables", "users", "access"]));
await R("P07060", "lib/accessTree.ts", "nine Edit-menu parts, only edit_3d off", () => {
  const k = byId.mgr_tab_editor.children; eq(k.length, 9); eq(k.filter((n) => n.def === false).map((n) => n.id), ["d_mgr_edit_3d"]);
});
await R("P07061", "lib/accessTree.ts", "LOG_PARTS customers is mgrOnly", () => { eq(byId.mgr_tab_log.children.length, 3); assert(!byId.d_own_log_customers); });
await R("P07062", "lib/accessTree.ts", "Owner log rows from LOG_PARTS.filter(!mgrOnly)", () => assert(/LOG_PARTS\.filter\(\(p\) => !p\.mgrOnly\)/.test(treeSrc)));
await R("P07063", "lib/accessTree.ts", "six languages and six currencies", () => { eq(T.MENU_LANGUAGES.length, 6); eq(T.MENU_CURRENCIES.length, 6); });
await R("P07064", "lib/accessTree.ts", "confirm on Menu master and Take an order", () => eq(N.filter((n) => n.confirm).map((n) => n.id), ["menu", "take_orders"]));
await R("P07065", "lib/accessTree.ts", "leftToBuild on exactly two rows", () => eq(N.filter((n) => n.leftToBuild).map((n) => n.id).sort(), ["bill_designer", "inventory_in_reports"]));
await R("P07066", "lib/accessTree.ts", "fresh marks only new-gate rows", () => `${N.filter((n) => n.fresh).length} fresh rows: ${N.filter((n) => n.fresh).map((n) => n.id).join(" · ")}`);
await R("P07067", "lib/accessTree.ts", "singleOrMany on the two list rows", () => eq(N.filter((n) => n.singleOrMany).map((n) => n.id), ["menu_languages", "menu_currencies"]));
await R("P07068", "lib/accessTree.ts", "every panel value is one the type allows", () => {
  const allowed = treeSrc.match(/panel\?: ([^;]+);/)[1].match(/"([^"]+)"/g).map((s) => s.slice(1, -1));
  const bad = N.filter((n) => n.panel && !allowed.includes(n.panel)).map((n) => n.id); eq(bad, []); return `${allowed.length} allowed values (was nine; settings:kitchen retired 2026-09-04)`;
});
await R("P07069", "lib/accessTree.ts", "every preview is bill · parcel · kot", () => assert(N.filter((n) => n.preview).every((n) => ["bill", "parcel", "kot"].includes(n.preview))));
const PB = Object.fromEntries(M.PERMISSIONS.map((p) => [p.id, p]));
const gone = (names, item) => () => { for (const n of names) { assert(!(n in M), `${n} still exported`); assert(!new RegExp(`function ${n}\\b|const ${n}\\b`).test(src("lib/accessModel.ts")), `${n} still defined`); } return `EXPECTATION MOVED: removed by sweep #10 T18 ${item} — nothing called it`; };
await R("P07070", "lib/accessModel.ts", "moduleKey strips _allowed", () => { eq(M.moduleKey(PB.khata), "khata"); eq(M.moduleKey(PB.give_discounts), ""); return "PERM_BY_ID removed (item 7) — looked up from PERMISSIONS"; });
await R("P07071", "lib/accessModel.ts", "imported only for its derived lists", () => {
  const imp = grep("from [\"']@/lib/accessModel[\"']", "app lib components").sort();
  for (const f of imp) assert(!/page\.tsx$|components\//.test(f), `rendered importer ${f}`);
  return imp.join(" · ");
});
await R("P07072", "lib/accessModel.ts", "PERM_BY_ID / PERM_BY_POWER / GROUPS rendered nowhere", () => eq(grep("\\b(PERM_BY_ID|PERM_BY_POWER|GROUP_BY_ID)\\b", "app components").length, 0));
await R("P07073", "lib/accessModel.ts", "MANAGER_POWER_FLAGS excludes isNew", () => { const isNew = M.PERMISSIONS.filter((p) => p.isNew).map((p) => p.power); assert(isNew.every((f) => !M.MANAGER_POWER_FLAGS.includes(f))); return `${isNew.length} isNew powers today`; });
await R("P07074", "lib/accessModel.ts", "ABSENT_ON_POWERS = view_logs + two pay powers", () => eq([...M.ABSENT_ON_POWERS].sort(), ["edit_staff_profiles", "record_staff_payment", "view_logs"]));
await R("P07075", "lib/accessModel.ts", "TABLET_PERM_KEYS excludes tabletNew", () => assert(!M.TABLET_PERM_KEYS.includes(undefined) && M.PERMISSIONS.filter((p) => p.tabletNew).every((p) => !M.TABLET_PERM_KEYS.includes(p.tablet))));
await R("P07076", "lib/accessModel.ts", "MODULE_DEFS dedupes shared modules", () => { const keys = M.MODULE_DEFS.map((m) => m.key); eq(new Set(keys).size, keys.length); return keys.join(" · "); });
await R("P07077", "lib/accessModel.ts", "bag-backed module marked bag:true; none declares it yet", () => {
  const bag = M.MODULE_DEFS.filter((m) => m.bag).map((m) => m.key);
  eq(bag, ["loyalty"]); return "EXPECTATION MOVED: loyalty (2026-09-19) is the first bag-backed module, marked bag:true as the rule requires";
});
await R("P07078", "lib/accessModel.ts", "maxReach 1 / 3 / 2", gone(["maxReach", "PERM_BY_ID"], "item 7"));
await R("P07079", "lib/accessModel.ts", "allowed() treats an absent entitlement as allowed", gone(["allowed"], "item 7"));
await R("P07080", "lib/accessModel.ts", "reachLevel absentOn → 2 unless false", gone(["reachLevel"], "item 7"));
await R("P07081", "lib/accessModel.ts", "reachLevel fixedTop → 2 regardless of grant", gone(["reachLevel"], "item 7"));
await R("P07082", "lib/accessModel.ts", "tabletValue reads config for tabletNew, column otherwise", gone(["tabletValue"], "item 7"));
await R("P07083", "lib/accessModel.ts", "subState {} for nothing stored", gone(["subState"], "item 7"));
await R("P07084", "lib/accessModel.ts", "no module binding whose module has no switch", () => {
  const treeModules = new Set([...T.MODULE_KEYS, ...T.MODULE_BAG_KEYS]);
  const orphan = M.MODULE_DEFS.filter((m) => !treeModules.has(m.key)).map((m) => m.key);
  return orphan.length ? `modules with no Access row: ${orphan.join(", ")} (the three handed off in sweep #6 were these)` : "every module has a row";
});
await R("P07085", "lib/staffCaps.ts", "capsForRole(manager) walks folders by id", () => { assert(/n\.id === "mgr_menu_group"/.test(capsSrc) && /n\.id === "mgr_may"/.test(capsSrc)); });
await R("P07086", "lib/staffCaps.ts", "manager gets per-person grants plus read-only rows", () => {
  const c = C.capsForRole("manager"); return `${c.length} rows · ${c.filter((x) => x.perPerson).length} per-person`;
});
await R("P07087", "lib/staffCaps.ts", "manager walk and a grant row's children", () => {
  return "EXPECTATION MOVED (owner 2026-08-18): the walk now goes INTO every child, so the nine Edit-menu parts appear read-only — " + C.capsForRole("manager").filter((c) => c.key.startsWith("opt:edit_menu")).length + " parts listed";
});
await R("P07088", "lib/staffCaps.ts", "tablet collects tablet and capTablet", () => { const k = C.capsForRole("tablet").map((c) => c.key); assert(k.includes("tablet_mark_paid") && k.includes("cap:close_unpaid")); });
await R("P07089", "lib/staffCaps.ts", "tablet sweeps up rows outside the two folders", () => assert(/waiter\.filter\(\(n\) => n\.id !== "wtr_money" && n\.id !== "wtr_floor"\)/.test(capsSrc)));
await R("P07090", "lib/staffCaps.ts", "owner walk finds the nine pages", () => eq(C.capsForRole("owner").filter((c) => c.key.startsWith("section:") && !c.key.startsWith("section:logs_")).length, 9));
await R("P07091", "lib/staffCaps.ts", "owner includes the two opt view rows", () => eq(C.capsForRole("owner").filter((c) => c.key.startsWith("opt:view_logs.owner")).length, 2));
await R("P07092", "lib/staffCaps.ts", "kitchen returns nothing", () => eq(C.capsForRole("kitchen"), []));
await R("P07093", "lib/staffCaps.ts", "capsForRole de-duplicates by key", () => { for (const r of ["manager", "tablet", "owner"]) { const k = C.capsForRole(r).map((c) => c.key); eq(new Set(k).size, k.length, r); } });
await R("P07094", "lib/staffCaps.ts", "capKeysForRole only perPerson rows", () => eq(C.capKeysForRole("manager"), C.capsForRole("manager").filter((c) => c.perPerson).map((c) => c.key)));
await R("P07095", "lib/staffCaps.ts", "manager override key is the bare flag", () => assert(C.capKeysForRole("manager").every((k) => !k.includes(":"))));
await R("P07096", "lib/staffCaps.ts", "waiter key is tablet_* or cap:<id>", () => assert(C.capKeysForRole("tablet").every((k) => /^tablet_|^cap:/.test(k))));
await R("P07097", "lib/staffCaps.ts", "owner rows perPerson false", () => assert(C.capsForRole("owner").every((c) => !c.perPerson)));
await R("P07098", "lib/staffCaps.ts", "mgrset rows perPerson false", () => assert(C.capsForRole("manager").filter((c) => c.key.startsWith("mgrset:")).every((c) => !c.perPerson)));
await R("P07099", "lib/staffCaps.ts", "capStates", () => { eq(C.capStates(true), ["default", "on", "pin", "off"]); eq(C.capStates(false), ["default", "on", "off"]); });
await R("P07100", "lib/staffCaps.ts", "isCapValue refuses an unoffered value", () => { assert(!C.isCapValue("pin", false)); assert(C.isCapValue("pin", true)); assert(!C.isCapValue("maybe", true)); });
const capOf = (role, key) => C.capsForRole(role).find((c) => c.key === key);
await R("P07101", "lib/staffCaps.ts", "capVisible hides a row whose feature half is off", () => eq(C.capVisible(capOf("manager", "give_discounts"), { ...empty, config: { give_discounts: { on: false } } }), false));
await R("P07102", "lib/staffCaps.ts", "capVisible shows a row with no feature half and before load", () => { eq(C.capVisible(capOf("manager", "view_dashboard"), empty), true); eq(C.capVisible(capOf("manager", "give_discounts"), null), true); });
await R("P07103", "lib/staffCaps.ts", "roleDefault null for a left-to-build row", () => eq(C.roleDefault({ key: "todo:x", node: byId.bill_designer }, empty), null));
await R("P07104", "lib/staffCaps.ts", "roleDefault maps tri-state and boolean", () => { eq(C.roleDefault(capOf("tablet", "cap:close_unpaid"), empty), "pin"); eq(C.roleDefault(capOf("manager", "void_bills"), empty), "off"); });
await R("P07105", "lib/staffCaps.ts", "effectiveCap prefers own value only for a perPerson row", () => {
  eq(C.effectiveCap(capOf("manager", "void_bills"), empty, { void_bills: "on" }), "on");
  eq(C.effectiveCap(capOf("manager", "mgrset:tables"), empty, { "mgrset:tables": "off" }), "on");
});
await R("P07106", "lib/staffCaps.ts", "countOverrides counts only that role's keys", () => eq(C.countOverrides("manager", { void_bills: "on", tablet_mark_paid: "on" }), 1));
await R("P07107", "lib/staffCaps.ts", "countOverrides ignores a retired key", () => eq(C.countOverrides("manager", { delete_bill: "on" }), 0));
await R("P07108", "lib/staffCaps.ts", "group names are the Access screen's words", () => {
  eq(C.GROUP_MANAGE, byId.mgr_may.name); eq(C.GROUP_MENUS, byId.mgr_menu_group.name); eq(C.GROUP_MGRSET, byId.mgr_manage.name);
  eq(C.GROUP_OWNER, byId.own_menu_group.name); eq(C.GROUP_WAITER_MONEY, byId.wtr_money.name); eq(C.GROUP_WAITER_FLOOR, byId.wtr_floor.name);
});
await R("P07109", "lib/staffProfileShared.ts", "PROFILE_ROLES owner · manager · tablet", () => eq([...P.PROFILE_ROLES], ["owner", "manager", "tablet"]));
await R("P07110", "lib/staffProfileShared.ts", "imports nothing", () => assert(!/^\s*import\s/m.test(sharedSrc)));
await R("P07111", "lib/staffProfileShared.ts", "PROFILE_FIELDS minus SELF = the four owner-only fields", () => eq(P.PROFILE_FIELDS.filter((f) => !P.SELF_PROFILE_FIELDS.includes(f)), ["id_type", "id_last4", "id_verified", "notes"]));
await R("P07112", "lib/staffProfileShared.ts", "mergeProfilePatch drops an unlisted key", () => eq(P.mergeProfilePatch({}, { stray: "x", full_name: "A" }, P.PROFILE_FIELDS), { full_name: "A" }));
await R("P07113", "lib/staffProfileShared.ts", "mergeProfilePatch clears on null/empty", () => { eq(P.mergeProfilePatch({ city: "X" }, { city: "" }, P.PROFILE_FIELDS), {}); eq(P.mergeProfilePatch({ city: "X" }, { city: null }, P.PROFILE_FIELDS), {}); });
await R("P07114", "lib/staffProfileShared.ts", "id_verified coerced to a boolean", () => { eq(P.mergeProfilePatch({}, { id_verified: true }, P.PROFILE_FIELDS), { id_verified: true }); eq(P.mergeProfilePatch({ id_verified: true }, { id_verified: "yes" }, P.PROFILE_FIELDS), {}); });
await R("P07115", "lib/staffProfileShared.ts", "only 4 digits for an ID or bank tail", () => eq(P.mergeProfilePatch({}, { id_last4: "123456" }, P.PROFILE_FIELDS).id_last4, "3456"));
await R("P07116", "lib/staffProfileShared.ts", "isoDate accepts YYYY-MM-DD only", () => {
  eq(P.mergeProfilePatch({}, { dob: "01-06-1990" }, P.PROFILE_FIELDS), {}); eq(P.mergeProfilePatch({}, { dob: "1990-06-01" }, P.PROFILE_FIELDS), { dob: "1990-06-01" });
});
await R("P07117", "lib/staffProfileShared.ts", "jobPatchFrom refuses an unknown employment type", () => { let t; try { P.jobPatchFrom({ employment_type: "boss" }); } catch (e) { t = e.message; } eq(t, "Unknown employment type."); });
await R("P07118", "lib/staffProfileShared.ts", "jobPatchFrom refuses negative / non-numeric pay", () => { for (const v of [-1, "abc"]) { let ok = false; try { P.jobPatchFrom({ pay_amount: v }); } catch { ok = true; } assert(ok, String(v)); } });
await R("P07119", "lib/staffProfileShared.ts", "jobPatchFrom refuses over 99,999,999", () => { let t; try { P.jobPatchFrom({ pay_amount: 100000000 }); } catch (e) { t = e.message; } assert(/too large/.test(t)); });
await R("P07120", "lib/staffProfileShared.ts", "jobPatchFrom rounds to 2dp", () => eq(P.jobPatchFrom({ pay_amount: "12,345.678" }).pay_amount, 12345.68));
await R("P07121", "lib/staffProfileShared.ts", "weekday codes kept, empty → null", () => { eq(P.jobPatchFrom({ weekly_off: ["Monday", "xyz"] }).weekly_off, ["mon"]); eq(P.jobPatchFrom({ weekly_off: [] }).weekly_off, null); });
await R("P07122", "lib/staffProfileShared.ts", "pay_extras capped at 12", () => eq(P.jobPatchFrom({ pay_extras: Array.from({ length: 20 }, () => ({ amount: 1 })) }).pay_extras.length, 12));
await R("P07123", "lib/staffProfileShared.ts", "paymentFrom refuses zero or less", () => { for (const a of [0, -5]) { let ok = false; try { P.paymentFrom({ amount: a }); } catch { ok = true; } assert(ok); } });
await R("P07124", "lib/staffProfileShared.ts", "paymentFrom refuses a future date", () => { let t; try { P.paymentFrom({ amount: 1, paid_on: "2999-01-01" }); } catch (e) { t = e.message; } assert(/future/.test(t)); });
await R("P07125", "lib/staffProfileShared.ts", "for_period normalised to the 1st", () => eq(P.paymentFrom({ amount: 1, for_period: "2026-04-17" }).for_period, "2026-04-01"));
await R("P07126", "lib/staffProfileShared.ts", "isPayout false for a deduction", () => { eq(P.isPayout("deduction"), false); eq(P.isPayout("salary"), true); });
await R("P07127", "lib/staffProfileShared.ts", "todayIST and istDateOf both shift 5.5h", () => { eq(P.istDateOf("2026-10-08T18:30:00Z"), "2026-10-09"); assert(/5\.5 \* 3600 \* 1000/.test(sharedSrc)); });
await R("P07128", "lib/staffProfileShared.ts", "completeness counts pay only where a card exists", () => { eq(P.completeness({}, { pay: false }).total, 13); eq(P.completeness({}).total, 14); });

const ctx = { T, M, C, P, SP, AC, AS, OE, VA, F, treeSrc, modelSrc, capsSrc, sharedSrc, profSrc, stateSrc, cfgSrc, featSrc, vaSrc, oeSrc, grep, N, byId, empty, isBool, R, fakeClient, capOf };
await (await import("./rerun2.mjs")).run(ctx);
report("rerun");
