// Block H — the branch arms coverage found untaken after blocks A–E.
//   · the REACHABLE ones get a real check each;
//   · the ones today's rows can never reach get an INVARIANT row: it asserts the condition that keeps
//     the arm dead. If a future row creates that shape, the row goes red and names the arm that would
//     then be running untested — so "unreachable" is a checked claim, not a shrug.
import { chk, assert, eq } from "./core.mjs";
import * as T from "@/lib/accessTree";
import * as C from "@/lib/staffCaps";
import * as P from "@/lib/staffProfileShared";

const K = (f, c, h, fn) => chk(f, c, h, fn);
const node = "node: the real export", inv = "invariant over every row of the real tree";
const AT = "lib/accessTree.ts", SC = "lib/staffCaps.ts", SS = "lib/staffProfileShared.ts";
const B = T.NODE_BY_ID;

// reachable — accessTree
await K(AT, "waiterFeatureOffCols(null) and (undefined) answer [] (the `|| {}` arm, L1308)", node, () => { eq(T.waiterFeatureOffCols(null), []); eq(T.waiterFeatureOffCols(undefined), []); eq(T.waiterFeatureOffCols(0), []); });
await K(AT, "applyPatch merges an OBJECT into a key the state does not have yet (the `cur[kk] || {}` arm, L1727)", node, () => eq(T.applyPatch(T.emptyState(), { config: { maintenance: { on: true } } }).config, { maintenance: { on: true } }));
await K(AT, "applyPatch deep-merges into a nested key that does not exist yet (the `a?.[k] || {}` arm, L1738)", node, () => eq(T.applyPatch({ ...T.emptyState(), config: { edit_menu: {} } }, { config: { edit_menu: { manager_opts: { edit_price: false } } } }).config, { edit_menu: { manager_opts: { edit_price: false } } }));
// reachable — staffProfileShared
await K(SS, "an ID / bank tail sent as null clears the field (the `v ?? \"\"` arm in digits, L151)", node, () => { eq(P.mergeProfilePatch({ id_last4: "1234" }, { id_last4: null }, P.PROFILE_FIELDS), {}); eq(P.mergeProfilePatch({ bank_last4: "1" }, { bank_last4: undefined }, P.PROFILE_FIELDS), {}); });
await K(SS, "a birth date sent as null clears it (the `v ?? \"\"` arms in isoDate L168 and the dob line L201)", node, () => { eq(P.mergeProfilePatch({ dob: "1990-01-01" }, { dob: null }, P.PROFILE_FIELDS), {}); eq(P.mergeProfilePatch({ dob: "1990-01-01" }, { dob: undefined }, P.PROFILE_FIELDS), {}); });
await K(SS, "pay_extras sent as a non-list stores [] (the `: []` arm, L252)", node, () => { for (const v of ["x", null, 5, { a: 1 }]) eq(P.jobPatchFrom({ pay_extras: v }).pay_extras, [], JSON.stringify(v)); });
await K(SS, "jobPatchFrom: pay_extras given [] stores []", node, () => eq(P.jobPatchFrom({ pay_extras: [] }).pay_extras, []));

// invariants — accessTree
await K(AT, "every channel row and every Edit-menu part declares its own def (keeps defOfEarly's fallback arm, L1268, dead)", inv, () => { const bad = T.ALL_NODES.filter((n) => (n.bind.t === "channel" || (n.bind.t === "opt" && n.bind.id === "edit_menu" && n.bind.side === "manager")) && n.def === undefined).map((n) => n.id); eq(bad, []); });
await K(AT, "no capTablet row has a Feature half (keeps the `cap:<id>` arm of WAITER_FEATURE_OF, L1300, and item 8's lookup, L1642, dead)", inv, () => eq(T.ALL_NODES.filter((n) => n.bind.t === "capTablet" && n.featureBind).map((n) => n.id), []));
await K(AT, "there is at least one channel row (keeps SETTINGS_COLUMNS' `: []` arm, L1316, dead)", inv, () => assert(T.CHANNEL_KEYS.length > 0));
await K(AT, "every tablet row's def is a real tri-state (keeps waiterCapValue's `: \"off\"` fallback, L1628, dead)", inv, () => eq(T.ALL_NODES.filter((n) => n.bind.t === "tablet" && !["off", "on", "pin"].includes(T.defOf(n))).map((n) => n.id), []));
await K(AT, "every capTablet row's def is a real tri-state (keeps waiterConfigCapValue's `: \"off\"` fallback, L1645, dead)", inv, () => eq(T.ALL_NODES.filter((n) => n.bind.t === "capTablet" && !["off", "on", "pin"].includes(T.defOf(n))).map((n) => n.id), []));
// invariants — staffCaps
await K(SC, "the Manager section exists and holds mgr_menu_group · mgr_may · mgr_manage (keeps the four `?? []` arms, L93/L112/L113/L117, dead)", inv, () => eq((T.SECTION_BY_ID.mgrMenu?.children || []).map((n) => n.id), ["mgr_menu_group", "mgr_may", "mgr_manage"]));
await K(SC, "the Waiter section exists and holds wtr_money · wtr_floor (keeps L141/L154/L155 `?? []` dead)", inv, () => eq((T.SECTION_BY_ID.waiter?.children || []).map((n) => n.id), ["wtr_money", "wtr_floor"]));
await K(SC, "the Owner section exists (keeps L188 `?? []` dead)", inv, () => assert(T.SECTION_BY_ID.ownMenu?.children?.length));
await K(SC, "no opt row under Manager settings or Owner has choices (keeps the `\"value\"` arms of L126 and L181 dead)", inv, () => { const rows = []; T.walk(T.SECTION_BY_ID.mgrMenu.children.find((n) => n.id === "mgr_manage").children, (n) => rows.push(n)); T.walk(T.SECTION_BY_ID.ownMenu.children, (n) => rows.push(n)); eq(rows.filter((n) => n.bind.t === "opt" && n.choices?.length).map((n) => n.id), []); });
await K(SC, "the Waiter section holds no opt row (keeps the waiter walk's opt branch, L150, dead)", inv, () => { const rows = []; T.walk(T.SECTION_BY_ID.waiter.children, (n) => rows.push(n)); eq(rows.filter((n) => n.bind.t === "opt").map((n) => n.id), []); });
await K(SC, "the Owner section holds no childless `none` row (keeps the `todo:` placeholder arm, L182, dead)", inv, () => { const rows = []; T.walk(T.SECTION_BY_ID.ownMenu.children, (n) => rows.push(n)); eq(rows.filter((n) => n.bind.t === "none" && !n.children?.length).map((n) => n.id), []); });
await K(SC, "and therefore no person's page ever shows a 'left to build' placeholder row", node, () => assert(["owner", "manager", "tablet"].every((r) => !C.capsForRole(r).some((c) => c.key.startsWith("todo:")))));
await K(AT, "every row a waiter walk could meet is one of tablet · capTablet · limit · none (nothing falls through unlisted)", inv, () => { const rows = []; T.walk(T.SECTION_BY_ID.waiter.children, (n) => rows.push(n)); eq([...new Set(rows.map((n) => n.bind.t))].sort(), ["capTablet", "limit", "none", "tablet"]); });
await K(AT, "every row a manager walk could meet is one of grant · opt · limit · tab · none", inv, () => { const rows = []; T.walk(T.SECTION_BY_ID.mgrMenu.children, (n) => rows.push(n)); eq([...new Set(rows.map((n) => n.bind.t))].sort(), ["grant", "limit", "none", "opt", "tab"]); });
await K(AT, "every row an owner walk could meet is one of section · opt · none", inv, () => { const rows = []; T.walk(T.SECTION_BY_ID.ownMenu.children, (n) => rows.push(n)); eq([...new Set(rows.map((n) => n.bind.t))].sort(), ["none", "opt", "section"]); });
void B;
