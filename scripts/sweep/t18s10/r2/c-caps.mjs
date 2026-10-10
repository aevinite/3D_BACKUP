// Block C — lib/staffCaps.ts, every exported function and branch, against the REAL file.
import { chk, assert, eq } from "./core.mjs";
import * as C from "@/lib/staffCaps";
import * as T from "@/lib/accessTree";

const F = "lib/staffCaps.ts", node = "node: the real export";
const K = (c, h, fn) => chk(F, c, h, fn);
const E = T.emptyState, st = (o) => ({ ...E(), ...o });
const cap = (r, k) => C.capsForRole(r).find((c) => c.key === k);
const fake = (o) => ({ key: "x", group: "g", node: { id: "x", name: "x", what: "x.", bind: { t: "grant", flag: "x" } }, pin: false, perPerson: true, ...o });

await K("the group names are the Access screen's own words", node, () => eq([C.GROUP_MENUS, C.GROUP_MANAGE, C.GROUP_MGRSET, C.GROUP_OWNER, C.GROUP_WAITER_MONEY, C.GROUP_WAITER_FLOOR], [T.NODE_BY_ID.mgr_menu_group.name, T.NODE_BY_ID.mgr_may.name, T.NODE_BY_ID.mgr_manage.name, T.NODE_BY_ID.own_menu_group.name, T.NODE_BY_ID.wtr_money.name, T.NODE_BY_ID.wtr_floor.name]));
await K("ROLES_WITH_OVERRIDES is manager · tablet; hasOverrides agrees for every role", node, () => { eq([...C.ROLES_WITH_OVERRIDES], ["manager", "tablet"]); eq(["manager", "tablet", "owner", "kitchen", "admin", ""].map(C.hasOverrides), [true, true, false, false, false, false]); });
// manager
const mgr = C.capsForRole("manager");
await K("manager: the list in order — menus, then may, then settings (the Access screen's own order)", node, () => { const groups = [...new Set(mgr.map((c) => c.group))]; eq(groups, [C.GROUP_MENUS, C.GROUP_MANAGE, C.GROUP_MGRSET]); });
await K("manager: grant rows are perPerson switch rows keyed by the bare flag, featureFrom = the parent's feature row", node, () => { const c = cap("manager", "edit_menu"); eq([c.perPerson, c.kind, c.pin], [true, "switch", false]); eq(c.featureFrom, undefined); });
await K("manager: an Edit-menu part inherits the Editor tab row as featureFrom (via)", node, () => eq(cap("manager", "opt:edit_menu.manager.add_dish").featureFrom?.id, "mgr_tab_editor"));
await K("manager: a pick-one opt is a VALUE row; an on/off opt is a SWITCH row", node, () => { eq(cap("manager", "opt:view_dashboard.manager.range").kind, "value"); eq(cap("manager", "opt:edit_menu.manager.edit_price").kind, "switch"); });
await K("manager: limit rows are read-only VALUE rows inheriting their action's feature", node, () => { const c = cap("manager", "limit:give_discounts.manager"); eq([c.kind, c.perPerson, c.featureFrom?.id], ["value", false, "mgr_give_discounts"]); });
await K("manager: the money/printing grants carry no featureFrom of their own (their featureBind IS on the node)", node, () => { const c = cap("manager", "void_bills"); eq(c.featureFrom, undefined); eq(c.node.featureBind?.t, "has"); });
await K("manager: mgrset section rows are read-only switches keyed mgrset:<key>", node, () => { for (const k of ["tables", "users", "access"]) { const c = cap("manager", `mgrset:${k}`); eq([c.perPerson, c.kind, c.group], [false, "switch", C.GROUP_MGRSET]); } });
await K("manager: the three Users switches are on the page, read-only, under Manager settings (item 4)", node, () => { for (const k of ["create", "reset_pw", "disable"]) { const c = cap("manager", `opt:manage_staff.manager.${k}`); assert(c, k); eq([c.perPerson, c.group], [false, C.GROUP_MGRSET]); } });
await K("manager: no tablet column and no section row ever appears", node, () => assert(mgr.every((c) => !c.key.startsWith("tablet_") && !c.key.startsWith("section:"))));
// tablet
const wtr = C.capsForRole("tablet");
await K("tablet: money rows first, then floor rows (the Access screen's order)", node, () => eq([...new Set(wtr.map((c) => c.group))], [C.GROUP_WAITER_MONEY, C.GROUP_WAITER_FLOOR]));
await K("tablet: a tablet row is keyed by its column; a capTablet row by cap:<id>; both perPerson", node, () => { eq(cap("tablet", "tablet_mark_paid").perPerson, true); eq(cap("tablet", "cap:close_unpaid").perPerson, true); });
await K("tablet: pin follows the row's own `pin`", node, () => { eq(cap("tablet", "tablet_mark_paid").pin, true); eq(cap("tablet", "tablet_parcel").pin, false); });
await K("tablet: the discount row's featureFrom is undefined (its featureBind is on the node itself)", node, () => { const c = cap("tablet", "tablet_discount"); eq(c.featureFrom, undefined); eq(c.node.featureBind?.id, "give_discounts"); });
await K("tablet: the waiter ceiling inherits the discount row as featureFrom", node, () => eq(cap("tablet", "limit:give_discounts.waiter").featureFrom?.id, "wtr_give_discounts"));
await K("tablet: no opt row exists in the Waiter section, so none is listed", node, () => assert(!wtr.some((c) => c.key.startsWith("opt:"))));
// owner
const own = C.capsForRole("owner");
await K("owner: every row is read-only and in Owner's menu", node, () => assert(own.every((c) => !c.perPerson && c.group === C.GROUP_OWNER)));
await K("owner: sections keyed section:<key>; the two Audit views keyed opt:view_logs.owner.<view>", node, () => { assert(cap("owner", "section:reports")); assert(cap("owner", "opt:view_logs.owner.removals")); assert(!cap("owner", "opt:view_logs.owner.customers")); });
await K("owner: 14 rows — 12 sections and 2 views", node, () => { eq(own.length, 14); eq(own.filter((c) => c.key.startsWith("section:")).length, 12); });
await K("kitchen and any unknown role: no rows", node, () => { eq(C.capsForRole("kitchen"), []); eq(C.capsForRole("chef"), []); eq(C.capsForRole(""), []); });
// capGroupsForRole
await K("capGroupsForRole: each group once, caps in their original order", node, () => { for (const r of ["manager", "tablet", "owner"]) { const g = C.capGroupsForRole(r); eq(g.flatMap((x) => x.caps.map((c) => c.key)), C.capsForRole(r).map((c) => c.key)); eq(new Set(g.map((x) => x.group)).size, g.length); } });
await K("capGroupsForRole('kitchen') is []", node, () => eq(C.capGroupsForRole("kitchen"), []));
// capKeysForRole / capStates / isCapValue
await K("capKeysForRole: manager 8 · tablet 9 · owner 0 · kitchen 0", node, () => eq(["manager", "tablet", "owner", "kitchen"].map((r) => C.capKeysForRole(r).length), [8, 9, 0, 0]));
await K("capStates: with pin default·on·pin·off; without default·on·off", node, () => { eq(C.capStates(true), ["default", "on", "pin", "off"]); eq(C.capStates(false), ["default", "on", "off"]); });
await K("isCapValue: strings in the list only; pin only where offered; numbers/null/objects never", node, () => { assert(C.isCapValue("off", false)); assert(!C.isCapValue("pin", false)); assert(C.isCapValue("pin", true)); for (const v of [1, null, undefined, {}, "ON", ""]) assert(!C.isCapValue(v, true), String(v)); });
// capVisible
await K("capVisible: no state loaded → always visible", node, () => assert(C.capVisible(cap("manager", "void_bills"), null)));
await K("capVisible: a cap with neither featureBind nor featureFrom → visible", node, () => assert(C.capVisible(cap("manager", "view_dashboard"), st({ config: { void_bills: { on: false } } }))));
await K("capVisible: own featureBind (has) off → hidden; on / absent → shown", node, () => { const c = cap("manager", "void_bills"); assert(!C.capVisible(c, st({ config: { void_bills: { on: false } } }))); assert(C.capVisible(c, st({ config: { void_bills: { on: true } } }))); assert(C.capVisible(c, E())); });
await K("capVisible: own featureBind (tab) off → hidden", node, () => assert(!C.capVisible(cap("manager", "edit_menu"), st({ tabs: { manager: { editor: false } } }))));
await K("capVisible: an inherited feature (featureFrom) decides for a sub-row", node, () => { const c = cap("manager", "opt:view_logs.manager.activity"); assert(!C.capVisible(c, st({ tabs: { manager: { log: false } } }))); assert(C.capVisible(c, st({ tabs: { manager: { log: true } } }))); });
await K("capVisible: a node with featureBind wins over a featureFrom (own feature is asked)", node, () => { const c = fake({ node: { ...T.NODE_BY_ID.mgr_void_bills }, featureFrom: T.NODE_BY_ID.mgr_tab_editor }); assert(!C.capVisible(c, st({ config: { void_bills: { on: false } }, tabs: { manager: { editor: true } } }))); });
// roleDefault
await K("roleDefault: no state → null; a todo: key → null", node, () => { eq(C.roleDefault(cap("manager", "void_bills"), null), null); eq(C.roleDefault(fake({ key: "todo:x" }), E()), null); });
await K("roleDefault: a tri-state string maps to itself; any other string → off", node, () => { eq(C.roleDefault(cap("tablet", "tablet_mark_paid"), st({ settings: { tablet_mark_paid: "pin" } })), "pin"); eq(C.roleDefault(cap("tablet", "tablet_take_orders"), E()), "on"); eq(C.roleDefault(cap("manager", "opt:view_dashboard.manager.range"), E()), "off"); });
await K("roleDefault: a boolean maps to on/off", node, () => { eq(C.roleDefault(cap("manager", "give_discounts"), E()), "on"); eq(C.roleDefault(cap("manager", "void_bills"), E()), "off"); });
// roleValueLabel
await K("roleValueLabel: no state → null", node, () => eq(C.roleValueLabel(cap("manager", "limit:give_discounts.manager"), null), null));
await K("roleValueLabel: a choice row answers its label", node, () => eq(C.roleValueLabel(cap("manager", "opt:view_bills.manager.range"), st({ config: { view_bills: { manager_opts: { range: "today_yesterday" } } } })), "Today + yesterday"));
await K("roleValueLabel: a unit row answers value+unit ('5 min', '50%')", node, () => { eq(C.roleValueLabel(cap("manager", "limit:void_bills.minutes"), E()), "5 min"); eq(C.roleValueLabel(cap("manager", "limit:give_discounts.manager"), E()), "50%"); });
await K("roleValueLabel: a switch row answers On / Off", node, () => { eq(C.roleValueLabel(cap("manager", "give_discounts"), E()), "On"); eq(C.roleValueLabel(cap("manager", "void_bills"), E()), "Off"); });
await K("roleValueLabel: a value with no choice match and no unit answers the raw string", node, () => eq(C.roleValueLabel(cap("tablet", "tablet_mark_paid"), st({ settings: { tablet_mark_paid: "pin" } })), "pin"));
await K("roleValueLabel: a null value answers '—', never 'null'", node, () => eq(C.roleValueLabel(fake({ node: { id: "x", name: "x", what: "x.", bind: { t: "none" } } }), E()), "—"));
// effectiveCap / countOverrides
await K("effectiveCap: own on/off/pin wins on a perPerson row", node, () => { const c = cap("tablet", "tablet_parcel"); for (const v of ["on", "off", "pin"]) eq(C.effectiveCap(c, E(), { tablet_parcel: v }), v); });
await K("effectiveCap: own 'default', junk or missing → the restaurant's answer", node, () => { const c = cap("tablet", "tablet_mark_paid"); for (const p of [{ tablet_mark_paid: "default" }, { tablet_mark_paid: "x" }, {}, null, undefined]) eq(C.effectiveCap(c, E(), p), "off"); });
await K("effectiveCap: a restaurant-wide row ignores any stored per-person value", node, () => eq(C.effectiveCap(cap("manager", "mgrset:tables"), st({ tabs: { mgrset: { tables: false } } }), { "mgrset:tables": "on" }), "off"));
await K("effectiveCap: no state and no own value → null", node, () => eq(C.effectiveCap(cap("tablet", "tablet_mark_paid"), null, {}), null));
await K("countOverrides: counts on/off/pin of that role's own keys only", node, () => eq(C.countOverrides("tablet", { tablet_mark_paid: "on", "cap:close_unpaid": "pin", tablet_parcel: "off", tablet_x: "on", void_bills: "on", tablet_banquet: "default" }), 3));
await K("countOverrides: null / undefined / a kitchen role → 0", node, () => { eq(C.countOverrides("tablet", null), 0); eq(C.countOverrides("tablet", undefined), 0); eq(C.countOverrides("kitchen", { tablet_mark_paid: "on" }), 0); });
