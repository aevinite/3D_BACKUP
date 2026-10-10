// Block B — lib/accessModel.ts · lib/accessConfig.ts · lib/accessState.ts, against the REAL files.
import { chk, assert, eq, db, calls } from "./core.mjs";
import * as M from "@/lib/accessModel";
import * as AC from "@/lib/accessConfig";
import * as AS from "@/lib/accessState";
import * as T from "@/lib/accessTree";

const node = "node: the real export";
const K = (f, c, h, fn) => chk(f, c, h, fn);
const AM = "lib/accessModel.ts", CF = "lib/accessConfig.ts", ST = "lib/accessState.ts";

// ── accessModel ──────────────────────────────────────────────────────────────────────────────────
await K(AM, "it exports exactly the six values real code imports (item 7)", node, () => eq(Object.keys(M).sort(), ["ABSENT_ON_POWERS", "MANAGER_POWER_FLAGS", "MODULE_DEFS", "PERMISSIONS", "TABLET_PERM_KEYS", "moduleKey"]));
await K(AM, "every permission has an id and a name, and carries a power, a module or a waiter column (wiring only, item 25)", node, () => assert(M.PERMISSIONS.every((p) => p.id && p.name && (p.power || p.module || p.tablet))));
await K(AM, "no permission carries a display field of the retired panel (item 25)", node, () => { const WIRING = new Set(["id", "name", "power", "tablet", "tabletNew", "isNew", "absentOn", "module", "moduleBag", "moduleLabel"]); eq(M.PERMISSIONS.flatMap((p) => Object.keys(p).filter((k) => !WIRING.has(k)).map((k) => `${p.id}.${k}`)), []); });
await K(AM, "every module label is the Access screen's own name for that module (item 25)", node, () => { const names = Object.fromEntries(T.ALL_NODES.filter((n) => n.bind.t === "module" || n.bind.t === "moduleBag").map((n) => [n.bind.key, n.name])); for (const m of M.MODULE_DEFS) eq(m.label, names[m.key], m.key); });
await K(AM, "no two permissions share an id", node, () => eq(new Set(M.PERMISSIONS.map((p) => p.id)).size, M.PERMISSIONS.length));
await K(AM, "no two permissions share a power flag", node, () => { const f = M.PERMISSIONS.filter((p) => p.power).map((p) => p.power); eq(new Set(f).size, f.length); });
await K(AM, "MANAGER_POWER_FLAGS = every power that is not isNew, in list order", node, () => eq([...M.MANAGER_POWER_FLAGS], M.PERMISSIONS.filter((p) => p.power && !p.isNew).map((p) => p.power)));
await K(AM, "ABSENT_ON_POWERS = view_logs + the two low-risk pay powers, and they match lib/staffProfileShared", node, async () => { const P = await import("@/lib/staffProfileShared"); eq([...M.ABSENT_ON_POWERS].sort(), ["edit_staff_profiles", "record_staff_payment", "view_logs"]); for (const f of P.ABSENT_ON_PAY_POWERS) assert(M.ABSENT_ON_POWERS.has(f), f); });
await K(AM, "TABLET_PERM_KEYS = tablet columns of the non-tabletNew rows; void_bills (tabletNew) is not one", node, () => { eq([...M.TABLET_PERM_KEYS], M.PERMISSIONS.filter((p) => p.tablet && !p.tabletNew).map((p) => p.tablet)); assert(!M.TABLET_PERM_KEYS.includes(undefined)); });
await K(AM, "every TABLET_PERM_KEYS column exists on the Access screen, except tablet_invoice (WAITER_NEVER)", node, () => eq(M.TABLET_PERM_KEYS.filter((k) => !T.TABLET_COLS.includes(k)), ["tablet_invoice"]));
await K(AM, "MODULE_DEFS: one entry per module even where several permissions share one (payroll ×3, inventory ×2)", node, () => { const keys = M.MODULE_DEFS.map((m) => m.key); eq(keys, ["khata", "loyalty", "take_orders", "table_ops", "table_tags", "banquet", "payroll", "inventory"]); });
await K(AM, "MODULE_DEFS: the labels, as the Access screen words them", node, () => eq(Object.fromEntries(M.MODULE_DEFS.map((m) => [m.key, m.label])), { khata: "Pay later (khata)", loyalty: "Loyalty points", take_orders: "Take a new order", table_ops: "Move, merge & split tables", table_tags: "Table types (VIP / Family / Guest)", banquet: "Banquet billing", payroll: "Staff profiles & pay", inventory: "Inventory management" }));
await K(AM, "MODULE_DEFS: only the bag module carries bag:true; column modules carry no bag key at all", node, () => { eq(M.MODULE_DEFS.filter((m) => m.bag).map((m) => m.key), ["loyalty"]); assert(M.MODULE_DEFS.filter((m) => m.key !== "loyalty").every((m) => !("bag" in m))); });
await K(AM, "MODULE_DEFS keeps the three column names of a column module", node, () => eq(M.MODULE_DEFS.find((m) => m.key === "banquet"), { key: "banquet", label: "Banquet billing", allowed: "banquet_allowed", control: "banquet_owner_control", enabled: "banquet_enabled" }));
await K(AM, "MODULE_DEFS falls back to the permission's name when no moduleLabel is given (no entry needs it today)", node, () => eq(M.PERMISSIONS.filter((p) => p.module && !p.moduleLabel).length, 0));
await K(AM, "every column module in MODULE_DEFS has a module row on the Access screen", node, () => { const tree = new Set([...T.MODULE_KEYS, ...T.MODULE_BAG_KEYS]); eq(M.MODULE_DEFS.map((m) => m.key).filter((k) => !tree.has(k)), []); });
await K(AM, "moduleKey: strips _allowed for a module permission, '' for a plain power", node, () => { const by = Object.fromEntries(M.PERMISSIONS.map((p) => [p.id, p])); eq(M.moduleKey(by.khata), "khata"); eq(M.moduleKey(by.staff_pay_view), "payroll"); eq(M.moduleKey(by.view_logs), ""); eq(M.moduleKey(by.loyalty), "loyalty"); });
await K(AM, "no permission offers a delete-a-bill sub-option (R27)", node, () => assert(!M.PERMISSIONS.some((p) => (p.sub || []).some((s) => /delete_bill/.test(s.id)))));
await K(AM, "no permission is named after print setup (retired 2026-09-14)", node, () => assert(!M.PERMISSIONS.some((p) => /print_setup/.test(p.id + (p.power || "")))));

// ── accessConfig ─────────────────────────────────────────────────────────────────────────────────
await K(CF, "MP_DEFAULT is the only export", node, () => eq(Object.keys(AC), ["MP_DEFAULT"]));
await K(CF, "MP_DEFAULT covers every power flag and every grant row, minus the three payroll powers", node, () => { const want = [...new Set([...M.MANAGER_POWER_FLAGS, ...Object.keys(T.MANAGER_GRANT_DEFAULTS)])].filter((f) => !["see_staff_pay", "record_staff_payment", "edit_staff_profiles"].includes(f)).sort(); eq(Object.keys(AC.MP_DEFAULT).sort(), want); });
await K(CF, "every MP_DEFAULT value is exactly what managerGrantValue answers with nothing stored", node, () => { for (const [f, v] of Object.entries(AC.MP_DEFAULT)) eq(v, T.managerGrantValue(f, undefined), f); });
await K(CF, "MP_DEFAULT: the two OFF grants are reopen and clear-the-queue; everything else is ON", node, () => eq(Object.entries(AC.MP_DEFAULT).filter(([, v]) => !v).map(([k]) => k).sort(), ["print_clear", "void_bills"]));
await K(CF, "the create-restaurant route seeds manager_permissions from MP_DEFAULT", "read app/api/admin/restaurants/route.ts", async () => { const { src } = await import("./core.mjs"); assert(/=\s*\{\s*\.\.\.MP_DEFAULT\s*\}/.test(src("app/api/admin/restaurants/route.ts")), "no { ...MP_DEFAULT } seed"); });

// ── accessState (the database client is the in-memory stand-in) ──────────────────────────────────
const RID = "11111111-1111-1111-1111-111111111111";
const reply = (rest, set, o = {}) => (q) => q.table === "restaurants" ? (o.rErr ? { data: null, error: { message: "x" } } : { data: rest, error: null }) : (o.sErr ? { data: null, error: { message: "x" } } : { data: set, error: null });
const read = async (rest, set, o) => { db(reply(rest, set, o)); return AS.accessStateFor(RID); };
await K(ST, "the restaurants read: three named columns · one id · maybeSingle", "drive accessStateFor with the in-memory client", async () => { await read({}, {}); const q = calls()[0]; eq(q.table, "restaurants"); eq(q.ops[0], ["select", "manager_permissions, owner_entitlements, access_config"]); eq(q.ops[1], ["eq", "id", RID]); eq(q.ops[2], ["maybeSingle"]); });
await K(ST, "the settings read: features + platform_channels + modules + every tree column, de-duplicated, one restaurant", "drive", async () => { await read({}, {}); const q = calls()[1]; const cols = q.ops[0][1].split(", "); eq(cols.slice(0, 3), ["features", "platform_channels", "modules"]); eq(new Set(cols).size, cols.length); for (const c of T.SETTINGS_COLUMNS) assert(cols.includes(c), c); eq(q.ops[1], ["eq", "restaurant_id", RID]); });
await K(ST, "exactly two reads, in that order", "drive", async () => { await read({}, {}); eq(calls().map((q) => q.table), ["restaurants", "settings"]); });
await K(ST, "a failed restaurants read → null, and settings is never read", "drive", async () => { eq(await read(null, {}, { rErr: true }), null); eq(calls().length, 1); });
await K(ST, "no such restaurant → null", "drive", async () => eq(await read(null, {}), null));
await K(ST, "a failed settings read → null (never 'at its defaults')", "drive", async () => eq(await read({}, null, { sErr: true }), null));
await K(ST, "no settings row at all → a state (every key present, channels OFF)", "drive", async () => { const s = await read({}, null); eq(Object.keys(s).sort(), Object.keys(T.emptyState()).sort()); eq(s.channels, { website: false, zomato: false, swiggy: false }); });
const sorted = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
await K(ST, "features: only known keys + ratings, each coerced === true", "drive", async () => eq(sorted((await read({}, { features: { reviews: "yes", ratings: true, scrollspy: false, prep_time: true } })).features), { prep_time: true, ratings: true, reviews: false }));
await K(ST, "features stored as an array or a string reads as nothing stored", "drive", async () => { eq((await read({}, { features: [true] })).features, {}); eq((await read({}, { features: "x" })).features, {}); });
await K(ST, "settings: only tree columns are copied, including a stored null", "drive", async () => { const s = await read({}, { menu_enabled: null, unrelated: 5, tablet_mark_paid: "pin" }); assert("menu_enabled" in s.settings && s.settings.menu_enabled === null); assert(!("unrelated" in s.settings)); eq(s.settings.tablet_mark_paid, "pin"); });
await K(ST, "modules: only MODULE_BAG_KEYS, each entry read as an object", "drive", async () => eq((await read({}, { modules: { loyalty: { allowed: true }, other: { allowed: true } } })).modules, { loyalty: { allowed: true } }));
await K(ST, "modules: a bag that is not an object reads as {}", "drive", async () => eq((await read({}, { modules: "x" })).modules, {}));
await K(ST, "channels: on === true only; channelsStored true only where `on` is a real boolean (item 15)", "drive", async () => { const s = await read({}, { platform_channels: { website: { on: false }, zomato: { on: "true" }, swiggy: {} } }); eq(s.channels, { website: false, zomato: false, swiggy: false }); eq(s.channelsStored, { website: true, zomato: false, swiggy: false }); });
await K(ST, "creds: through credHint — long key masked to its last four, short key dots only, none ''", "drive", async () => eq((await read({}, { platform_channels: { website: { key: "abc" }, zomato: { key: "zomato-key-9999" }, swiggy: {} } })).creds, { website: "••••", zomato: "••••9999", swiggy: "" }));
await K(ST, "creds: `key` wins over the legacy `api_key`; api_key alone is still read", "drive", async () => eq((await read({}, { platform_channels: { website: { key: "KEYKEY11", api_key: "APIAPI22" }, zomato: { api_key: "APIAPI33" } } })).creds, { website: "••••EY11", zomato: "••••PI33", swiggy: "" }));
await K(ST, "creds: an empty `key` falls back to api_key", "drive", async () => eq((await read({}, { platform_channels: { zomato: { key: "", api_key: "ABCDEFGH" } } })).creds.zomato, "••••EFGH"));
await K(ST, "creds: the raw key never appears anywhere in the returned state", "drive", async () => { const s = await read({}, { platform_channels: { zomato: { key: "SECRET-KEY-77" } } }); assert(!JSON.stringify(s).includes("SECRET-KEY")); });
await K(ST, "grants: only GRANT_FLAGS, each === true", "drive", async () => eq((await read({ manager_permissions: { void_bills: true, give_discounts: "true", khata: true } }, {})).grants, { void_bills: true, give_discounts: false }));
await K(ST, "sections: only real booleans of SECTION_ENTITLEMENTS", "drive", async () => eq((await read({ owner_entitlements: { reports: false, menu: "false", power_x: false } }, {})).sections, { reports: false }));
await K(ST, "config: only KNOWN_CONFIG_IDS + menus", "drive", async () => eq(Object.keys((await read({ access_config: { maintenance: { on: true }, delete_bill: {}, menus: {}, stray: 1 } }, {})).config).sort(), ["maintenance", "menus"]));
await K(ST, "tabs: every TAB_ALLOWED panel gets an object; only allowed keys with boolean values", "drive", async () => { const s = await read({ access_config: { menus: { manager: { editor: false, bills: false, log: "no" }, mgrset: { users: true } } } }, {}); eq(s.tabs, { manager: { editor: false }, mgrset: { users: true } }); });
await K(ST, "tabs: menus missing entirely → every panel present and empty", "drive", async () => eq((await read({}, {})).tabs, { manager: {}, mgrset: {} }));
await K(ST, "a restaurant row whose three columns are null reads as empty grants/sections/config", "drive", async () => { const s = await read({ manager_permissions: null, owner_entitlements: null, access_config: null }, {}); eq([s.grants, s.sections, s.config], [{}, {}, {}]); });
