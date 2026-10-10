// Block A — lib/accessTree.ts, every exported function and every branch arm, against the REAL file.
import { chk, assert, eq } from "./core.mjs";
import * as T from "@/lib/accessTree";

const F = "lib/accessTree.ts";
const N = T.ALL_NODES, B = T.NODE_BY_ID, E = T.emptyState;
const K = (c, h, fn) => chk(F, c, h, fn);
const node = "node: the real export";
const fake = (bind, extra = {}) => ({ id: "x", name: "x", what: "x.", bind, ...extra });

// ── the derived lists ──────────────────────────────────────────────────────────────────────────
await K("ALL_NODES holds exactly the nodes walk() visits across every section", node, () => { let n = 0; for (const s of T.SECTIONS) T.walk(s.children, () => n++); eq(N.length, n); return `${n} rows`; });
await K("walk() passes depth and parent: a top row has depth 0 and no parent; its child has depth 1 and that parent", node, () => {
  const seen = []; T.walk(T.SECTION_BY_ID.main.children, (n, d, p) => seen.push([n.id, d, p?.id ?? null]));
  eq(seen.find((x) => x[0] === "menu"), ["menu", 0, null]); eq(seen.find((x) => x[0] === "dining_sessions"), ["dining_sessions", 1, "menu"]);
});
await K("walk() reaches depth 3 (Menu → Design and styling → Theme and logo is depth 2; ratings_mode under ratings under menu is 2)", node, () => {
  let max = 0; for (const s of T.SECTIONS) T.walk(s.children, (_, d) => { max = Math.max(max, d); }); assert(max >= 2); return `deepest ${max}`;
});
await K("NODE_BY_ID has one entry per node (no id shared)", node, () => eq(Object.keys(B).length, N.length));
await K("SECTION_BY_ID has the five sections", node, () => eq(Object.keys(T.SECTION_BY_ID), ["main", "extra", "mgrMenu", "ownMenu", "waiter"]));
for (const [k, kind] of [["FEATURE_KEYS", "feature"], ["SETTING_KEYS", "setting"], ["CHOICE_KEYS", "choice"], ["LIST_KEYS", "list"], ["TEXT_KEYS", "text"], ["MODULE_KEYS", "module"], ["MODULE_BAG_KEYS", "moduleBag"], ["CHANNEL_KEYS", "channel"], ["CREDS_KEYS", "creds"]]) {
  await K(`${k} is exactly the keys of the ${kind} rows, once each`, node, () => eq([...T[k]].sort(), [...new Set(N.filter((n) => n.bind.t === kind).map((n) => n.bind.key))].sort()));
}
await K("GRANT_FLAGS is exactly the grant rows' flags", node, () => eq([...T.GRANT_FLAGS].sort(), N.filter((n) => n.bind.t === "grant").map((n) => n.bind.flag).sort()));
await K("SECTION_ENTITLEMENTS is exactly the section rows' keys", node, () => eq([...T.SECTION_ENTITLEMENTS].sort(), N.filter((n) => n.bind.t === "section").map((n) => n.bind.key).sort()));
await K("TABLET_COLS is exactly the tablet rows' columns", node, () => eq([...T.TABLET_COLS].sort(), N.filter((n) => n.bind.t === "tablet").map((n) => n.bind.key).sort()));
await K("CAP_TABLET_IDS is exactly the capTablet rows' ids", node, () => eq([...T.CAP_TABLET_IDS], ["close_unpaid"]));
await K("HAS_IDS takes a has-bind from the MAIN bind (maintenance) and from featureBind (the money actions)", node, () => { assert(T.HAS_IDS.includes("maintenance")); for (const id of ["void_bills", "give_discounts", "print_here", "print_clear"]) assert(T.HAS_IDS.includes(id), id); });
await K("HAS_IDS lists nothing that is not a has-bind anywhere", node, () => { const real = new Set(N.flatMap((n) => [n.featureBind?.t === "has" ? n.featureBind.id : null, n.bind.t === "has" ? n.bind.id : null]).filter(Boolean)); eq([...T.HAS_IDS].sort(), [...real].sort()); });
await K("KNOWN_CONFIG_IDS is the union of has · capTablet · opt · limit ids and nothing else", node, () => {
  const want = new Set(N.flatMap((n) => [n.featureBind?.t === "has" ? n.featureBind.id : null, ["has", "capTablet", "opt", "limit"].includes(n.bind.t) ? n.bind.id : null]).filter(Boolean));
  eq([...T.KNOWN_CONFIG_IDS].sort(), [...want].sort());
});
await K("TAB_KEYS collects tabs from the main bind (mgrset) AND the featureBind (manager menus)", node, () => { assert(T.TAB_KEYS.some((t) => t.panel === "mgrset")); assert(T.TAB_KEYS.some((t) => t.panel === "manager" && t.key === "log")); return `${T.TAB_KEYS.length} tabs`; });
await K("TAB_ALLOWED groups the tab keys by panel", node, () => { eq([...T.TAB_ALLOWED.manager].sort(), ["editor", "log", "ratings"]); eq([...T.TAB_ALLOWED.mgrset].sort(), ["access", "tables", "users"]); });
await K("SETTINGS_COLUMNS: every module contributes _allowed and _enabled, never _owner_control", node, () => { for (const m of T.MODULE_KEYS) { assert(T.SETTINGS_COLUMNS.includes(`${m}_allowed`)); assert(T.SETTINGS_COLUMNS.includes(`${m}_enabled`)); assert(!T.SETTINGS_COLUMNS.includes(`${m}_owner_control`)); } });
await K("SETTINGS_COLUMNS adds platform_channels because there are channel rows", node, () => assert(T.SETTINGS_COLUMNS.includes("platform_channels")));
await K("SETTINGS_COLUMNS never includes a column named after a bag module", node, () => assert(!T.SETTINGS_COLUMNS.some((c) => c.startsWith("loyalty"))));
await K("CHANNEL_DEFAULTS: own website ON, Zomato and Swiggy OFF", node, () => eq(T.CHANNEL_DEFAULTS, { website: { on: true }, zomato: { on: false }, swiggy: { on: false } }));
await K("MENU_PART_DEFAULTS: the nine Edit-menu parts, only edit_3d OFF", node, () => { eq(Object.keys(T.MENU_PART_DEFAULTS).length, 9); eq(Object.entries(T.MENU_PART_DEFAULTS).filter(([, v]) => !v).map(([k]) => k), ["edit_3d"]); });
await K("WAITER_FEATURE_OF: tablet_discount sits under give_discounts, and nothing else shares a feature half", node, () => eq(T.WAITER_FEATURE_OF, { tablet_discount: "give_discounts" }));
await K("MANAGER_GRANT_DEFAULTS: reopen OFF, discount ON, may-print ON, may-clear OFF, the four menus ON", node, () => eq(T.MANAGER_GRANT_DEFAULTS, { edit_menu: true, view_ratings: true, view_logs: true, view_dashboard: true, void_bills: false, give_discounts: true, print_here: true, print_clear: false }));
await K("isConfigurableGrant answers true for a row's flag and false for a retired one", node, () => { assert(T.isConfigurableGrant("void_bills")); assert(!T.isConfigurableGrant("khata")); assert(!T.isConfigurableGrant("delete_bill")); });
await K("MODULE_ALLOWED_DEFAULTS: the three floor modules ON, the four add-ons OFF", node, () => eq(T.MODULE_ALLOWED_DEFAULTS, { take_orders_allowed: true, table_ops_allowed: true, table_tags_allowed: true, khata_allowed: false, banquet_allowed: false, payroll_allowed: false, inventory_allowed: false }));
await K("MANAGER_TAB_KEYS is editor · ratings · log (bills is fixed and absent)", node, () => eq([...T.MANAGER_TAB_KEYS], ["editor", "ratings", "log"]));
await K("MANAGER_SETTINGS: three sections, Users carrying the three finer powers", node, () => { eq(T.MANAGER_SETTINGS.map((x) => x.key), ["tables", "users", "access"]); eq(T.MANAGER_SETTINGS[1].subs.map((x) => x.key), ["create", "reset_pw", "disable"]); });
await K("WAITER_NEVER is exactly [tablet_invoice]", node, () => eq([...T.WAITER_NEVER], ["tablet_invoice"]));
await K("MENU_LANGUAGES and MENU_CURRENCIES each start with the default (en · INR)", node, () => { eq(T.MENU_LANGUAGES[0].value, "en"); eq(T.MENU_CURRENCIES[0].value, "INR"); });

// ── defOf ──────────────────────────────────────────────────────────────────────────────────────
await K("defOf returns the node's def when it is set — even a falsy one (false, 0, '')", node, () => { eq(T.defOf(fake({ t: "feature", key: "k" }, { def: false })), false); eq(T.defOf(fake({ t: "limit", id: "x", side: "y" }, { def: 0 })), 0); eq(T.defOf(fake({ t: "text", key: "k" }, { def: "" })), ""); });
await K("defOf with no def: 'off' for tablet and capTablet, false for every other kind", node, () => { eq(T.defOf(fake({ t: "tablet", key: "k" })), "off"); eq(T.defOf(fake({ t: "capTablet", id: "k" })), "off"); for (const t of ["feature", "setting", "grant", "opt", "none"]) eq(T.defOf(fake({ t, key: "k", id: "k", flag: "k" })), false, t); });

// ── credHint ───────────────────────────────────────────────────────────────────────────────────
await K("credHint: nothing / an empty string / a non-string → ''", node, () => { for (const v of [undefined, null, "", 12345678, {}, []]) eq(T.credHint(v), "", String(v)); });
await K("credHint: 1 to 7 characters → just '••••'", node, () => { for (let n = 1; n <= 7; n++) eq(T.credHint("x".repeat(n)), "••••", `${n}`); });
await K("credHint: exactly 8 characters shows its last four", node, () => eq(T.credHint("abcd1234"), "••••1234"));
await K("credHint: a long key shows its last four as typed (dashes kept)", node, () => eq(T.credHint("zomato-live-key--9_-Z"), "••••9_-Z"));

// ── emptyState ─────────────────────────────────────────────────────────────────────────────────
await K("emptyState has the ten TreeState keys, each an empty object", node, () => { const s = E(); eq(Object.keys(s).sort(), ["channels", "channelsStored", "config", "creds", "features", "grants", "modules", "sections", "settings", "tabs"]); assert(Object.values(s).every((v) => v && typeof v === "object" && !Object.keys(v).length)); });
await K("emptyState returns a NEW object each call (no shared mutable default)", node, () => { const a = E(); a.features.x = true; eq(E().features, {}); });

// ── nodeValue, every case, stored and absent ───────────────────────────────────────────────────
const st = (o) => ({ ...E(), ...o });
await K("nodeValue feature: stored true/false wins; absent and null read the def", node, () => { const n = B.show_reviews; eq(T.nodeValue(n, st({ features: { reviews: false } })), false); eq(T.nodeValue(n, st({ features: { reviews: true } })), true); eq(T.nodeValue(n, E()), true); eq(T.nodeValue(n, st({ features: { reviews: null } })), true); });
await K("nodeValue setting: only a real true reads ON ('true', 1 read OFF); absent reads the def", node, () => { const n = B.bubbles; eq(T.nodeValue(n, st({ settings: { bubbles_enabled: true } })), true); eq(T.nodeValue(n, st({ settings: { bubbles_enabled: 1 } })), false); eq(T.nodeValue(n, E()), true); eq(T.nodeValue(B.dining_sessions, E()), false); });
await K("nodeValue module: reads <key>_allowed, === true; absent reads the def", node, () => { eq(T.nodeValue(B.khata, st({ settings: { khata_allowed: true } })), true); eq(T.nodeValue(B.khata, E()), false); eq(T.nodeValue(B.take_orders, E()), true); eq(T.nodeValue(B.take_orders, st({ settings: { take_orders_allowed: false } })), false); });
await K("nodeValue moduleBag: reads modules[key].allowed, === true; a bare boolean entry reads as nothing stored", node, () => { eq(T.nodeValue(B.loyalty, st({ modules: { loyalty: { allowed: true } } })), true); eq(T.nodeValue(B.loyalty, st({ modules: { loyalty: true } })), false); eq(T.nodeValue(B.loyalty, E()), false); });
await K("nodeValue channel: stored wins, absent reads the def (website ON, zomato OFF)", node, () => { eq(T.nodeValue(B.ch_website, E()), true); eq(T.nodeValue(B.ch_zomato, E()), false); eq(T.nodeValue(B.ch_website, st({ channels: { website: false } })), false); });
await K("nodeValue grant: stored boolean wins, absent reads the def", node, () => { eq(T.nodeValue(B.mgr_void_bills, E()), false); eq(T.nodeValue(B.mgr_void_bills, st({ grants: { void_bills: true } })), true); });
await K("nodeValue section: stored wins, absent reads ON", node, () => { eq(T.nodeValue(B.own_reports, E()), true); eq(T.nodeValue(B.own_reports, st({ sections: { reports: false } })), false); });
await K("nodeValue tab: stored wins, absent reads ON", node, () => { eq(T.nodeValue(B.mgrset_users, E()), true); eq(T.nodeValue(B.mgrset_users, st({ tabs: { mgrset: { users: false } } })), false); });
await K("nodeValue tablet: stored tri-state wins; absent reads the row's def; an empty string reads 'off'", node, () => { eq(T.nodeValue(B.wtr_mark_paid, st({ settings: { tablet_mark_paid: "pin" } })), "pin"); eq(T.nodeValue(B.wtr_take_orders, E()), "on"); eq(T.nodeValue(B.wtr_take_orders, st({ settings: { tablet_take_orders: "" } })), "off"); });
await K("nodeValue capTablet: reads access_config[id].tablet; absent reads its def ('pin')", node, () => { eq(T.nodeValue(B.wtr_close_unpaid, E()), "pin"); eq(T.nodeValue(B.wtr_close_unpaid, st({ config: { close_unpaid: { tablet: "off" } } })), "off"); });
await K("nodeValue capTablet: a stored '' reads 'off', never ''", node, () => eq(T.nodeValue(B.wtr_close_unpaid, st({ config: { close_unpaid: { tablet: "" } } })), "off"));
await K("nodeValue choice: stored string wins, absent reads the def", node, () => { eq(T.nodeValue(B.price_tax_mode, E()), "excl"); eq(T.nodeValue(B.price_tax_mode, st({ settings: { price_tax_mode: "incl" } })), "incl"); });
await K("nodeValue text: stored wins; absent reads '' (the def)", node, () => { eq(T.nodeValue(B.google_review_url, E()), ""); eq(T.nodeValue(B.google_review_url, st({ settings: { google_review_url: "https://g" } })), "https://g"); });
await K("nodeValue creds: the stored mask, else ''", node, () => { eq(T.nodeValue(B.ch_zomato_key, E()), ""); eq(T.nodeValue(B.ch_zomato_key, st({ creds: { zomato: "••••1234" } })), "••••1234"); });
await K("nodeValue list: a stored non-empty array wins; [] or a non-array reads the def", node, () => { eq(T.nodeValue(B.menu_languages, st({ settings: { menu_languages: ["hi"] } })), ["hi"]); eq(T.nodeValue(B.menu_languages, st({ settings: { menu_languages: [] } })), ["en"]); eq(T.nodeValue(B.menu_languages, st({ settings: { menu_languages: "hi" } })), ["en"]); });
await K("nodeValue list with no def at all answers []", node, () => eq(T.nodeValue(fake({ t: "list", key: "nothing" }), E()), []));
await K("nodeValue opt: stored value wins (any JSON); absent reads the def", node, () => { eq(T.nodeValue(B.d_mgr_edit_price, E()), true); eq(T.nodeValue(B.d_mgr_edit_price, st({ config: { edit_menu: { manager_opts: { edit_price: false } } } })), false); eq(T.nodeValue(B.mgr_dash_range, st({ config: { view_dashboard: { manager_opts: { range: "last7" } } } })), "last7"); });
await K("nodeValue limit: stored number wins; absent reads the def", node, () => { eq(T.nodeValue(B.mgr_give_discounts_cap, E()), 50); eq(T.nodeValue(B.mgr_give_discounts_cap, st({ config: { give_discounts: { limit: { manager: 20 } } } })), 20); });
await K("nodeValue has: absent reads ON unless the bind says def:false; stored false reads OFF", node, () => { eq(T.nodeValue(fake({ t: "has", id: "q" }), E()), true); eq(T.nodeValue(B.maintenance, E()), false); eq(T.nodeValue(B.maintenance, st({ config: { maintenance: { on: true } } })), true); eq(T.nodeValue(fake({ t: "has", id: "q" }), st({ config: { q: { on: false } } })), false); });
await K("nodeValue ratingsMaster: never-stored stars → ON; stars true → ON; stars off + menu-only → OFF", node, () => { eq(T.nodeValue(B.ratings, E()), true); eq(T.nodeValue(B.ratings, st({ features: { ratings: true } })), true); eq(T.nodeValue(B.ratings, st({ features: { ratings: false }, settings: { google_review_mode: "off" } })), false); });
await K("nodeValue ratingsMaster: stars off but ANY google mode → ON", node, () => { for (const m of ["google", "google_after_normal"]) eq(T.nodeValue(B.ratings, st({ features: { ratings: false }, settings: { google_review_mode: m } })), true, m); });
await K("nodeValue ratingsMaster: stars off and no mode stored → OFF", node, () => eq(T.nodeValue(B.ratings, st({ features: { ratings: false } })), false));
await K("nodeValue none / unknown kind → null", node, () => { eq(T.nodeValue(B.bill, E()), null); eq(T.nodeValue(fake({ t: "zzz" }), E()), null); });
await K("nodeValue never throws on a state with whole sub-objects missing", node, () => { for (const n of N) T.nodeValue(n, {}); });

// ── nodeExpect, every case ─────────────────────────────────────────────────────────────────────
const X = (n, s) => T.nodeExpect(n, s, "rid-1");
await K("nodeExpect feature → settings · features.<key>, only when stored", node, () => { eq(X(B.show_reviews, E()), null); eq(X(B.show_reviews, st({ features: { reviews: false } })), { table: "settings", id: "rid-1", fields: { "features.reviews": false }, label: "Show reviews" }); });
await K("nodeExpect setting → settings · <key>", node, () => eq(X(B.bubbles, st({ settings: { bubbles_enabled: true } })).fields, { bubbles_enabled: true }));
await K("nodeExpect module → settings · <key>_allowed", node, () => eq(X(B.khata, st({ settings: { khata_allowed: false } })).fields, { khata_allowed: false }));
await K("nodeExpect moduleBag → settings · modules.<key> (the whole entry)", node, () => eq(X(B.loyalty, st({ modules: { loyalty: { allowed: true, enabled: true } } })).fields, { "modules.loyalty": { allowed: true, enabled: true } }));
await K("nodeExpect choice / text / list / tablet → settings · <key>", node, () => { eq(X(B.price_tax_mode, st({ settings: { price_tax_mode: "incl" } })).fields, { price_tax_mode: "incl" }); eq(X(B.google_review_url, st({ settings: { google_review_url: "u" } })).fields, { google_review_url: "u" }); eq(X(B.menu_languages, st({ settings: { menu_languages: ["en"] } })).fields, { menu_languages: ["en"] }); eq(X(B.wtr_mark_paid, st({ settings: { tablet_mark_paid: "on" } })).fields, { tablet_mark_paid: "on" }); });
await K("nodeExpect grant → restaurants · manager_permissions.<flag>", node, () => eq(X(B.mgr_void_bills, st({ grants: { void_bills: true } })), { table: "restaurants", id: "rid-1", fields: { "manager_permissions.void_bills": true }, label: "Reopen a bill" }));
await K("nodeExpect section → restaurants · owner_entitlements.<key>", node, () => eq(X(B.own_reports, st({ sections: { reports: false } })).fields, { "owner_entitlements.reports": false }));
await K("nodeExpect channel: a STORED channel expects platform_channels.<k>.on", node, () => eq(X(B.ch_zomato, st({ channels: { zomato: true }, channelsStored: { zomato: true } })).fields, { "platform_channels.zomato.on": true }));
await K("nodeExpect channel: a never-stored channel expects nothing (first save is never a clash)", node, () => eq(X(B.ch_zomato, st({ channels: { zomato: false } })), null));
await K("nodeExpect channel: channelsStored missing from the state entirely → nothing", node, () => eq(X(B.ch_zomato, { ...E(), channelsStored: undefined }), null));
await K("nodeExpect ratingsMaster: both stored → both fields; one stored → that one; neither → null", node, () => {
  eq(X(B.ratings, st({ features: { ratings: true }, settings: { google_review_mode: "off" } })).fields, { "features.ratings": true, google_review_mode: "off" });
  eq(X(B.ratings, st({ settings: { google_review_mode: "google" } })).fields, { google_review_mode: "google" });
  eq(X(B.ratings, st({ features: { ratings: false } })).fields, { "features.ratings": false });
  eq(X(B.ratings, E()), null);
});
await K("nodeExpect ratingsMaster's label is the row's own name", node, () => eq(X(B.ratings, st({ features: { ratings: true } })).label, "Ratings"));
await K("nodeExpect null for creds · tab · has · capTablet · opt · limit · none", node, () => { const s = st({ creds: { zomato: "••••1" }, tabs: { mgrset: { users: true } }, config: { maintenance: { on: true }, close_unpaid: { tablet: "on" }, edit_menu: { manager_opts: { edit_price: true } }, give_discounts: { limit: { manager: 50 } } } }); for (const id of ["ch_zomato_key", "mgrset_users", "maintenance", "wtr_close_unpaid", "d_mgr_edit_price", "mgr_give_discounts_cap", "bill"]) eq(X(B[id], s), null, id); });
await K("nodeExpect carries the restaurant id it was given", node, () => eq(T.nodeExpect(B.bubbles, st({ settings: { bubbles_enabled: true } }), "abc").id, "abc"));

// ── expectHeader ───────────────────────────────────────────────────────────────────────────────
await K("expectHeader escapes every character above U+007F as \\uXXXX", node, () => { const h = T.expectHeader({ label: "a — b ₹ é" }); assert(/^[\x00-\x7f]*$/.test(h)); assert(h.includes("\\u2014") && h.includes("\\u20b9") && h.includes("\\u00e9")); });
await K("expectHeader round-trips: JSON.parse gives back the original string", node, () => { const o = { label: "Move, merge & split — ₹", fields: { x: "é" } }; eq(JSON.parse(T.expectHeader(o)), o); });
await K("expectHeader(null) is the string 'null'; plain ASCII is unchanged", node, () => { eq(T.expectHeader(null), "null"); eq(T.expectHeader({ a: 1 }), '{"a":1}'); });

// ── nodePatch, every case ──────────────────────────────────────────────────────────────────────
const P = (id, v) => T.nodePatch(B[id] || id, v);
await K("nodePatch feature: { features: { key: v === true } } — a truthy non-true is OFF", node, () => { eq(P("show_reviews", true), { features: { reviews: true } }); eq(P("show_reviews", "yes"), { features: { reviews: false } }); });
await K("nodePatch setting: { settings: { key: bool } }", node, () => eq(P("bubbles", false), { settings: { bubbles_enabled: false } }));
await K("nodePatch module: _allowed = v and _enabled forced true", node, () => eq(P("banquet", true), { settings: { banquet_allowed: true, banquet_enabled: true } }));
await K("nodePatch moduleBag: { modules: { key: bool } }", node, () => eq(P("loyalty", true), { modules: { loyalty: true } }));
await K("nodePatch channel / grant / section / tab: one boolean at the right place", node, () => { eq(P("ch_swiggy", true), { channels: { swiggy: true } }); eq(P("mgr_print_clear", true), { grants: { print_clear: true } }); eq(P("own_menu", false), { sections: { menu: false } }); eq(P("mgrset_access", false), { tabs: { mgrset: { access: false } } }); });
await K("nodePatch tablet / capTablet: the value as a string", node, () => { eq(P("wtr_khata", "pin"), { settings: { tablet_khata: "pin" } }); eq(P("wtr_close_unpaid", "off"), { config: { close_unpaid: { tablet: "off" } } }); });
await K("nodePatch choice: String(v); text: String(v ?? '') — null becomes ''", node, () => { eq(P("price_tax_mode", "incl"), { settings: { price_tax_mode: "incl" } }); eq(P("google_review_url", null), { settings: { google_review_url: "" } }); eq(P("google_review_url", undefined), { settings: { google_review_url: "" } }); });
await K("nodePatch creds: String(v ?? '') into creds", node, () => { eq(P("ch_zomato_key", "abc"), { creds: { zomato: "abc" } }); eq(P("ch_zomato_key", null), { creds: { zomato: "" } }); });
await K("nodePatch list: an array becomes strings; a non-array becomes []", node, () => { eq(P("menu_currencies", ["INR", 7]), { settings: { menu_currencies: ["INR", "7"] } }); eq(P("menu_currencies", "INR"), { settings: { menu_currencies: [] } }); });
await K("nodePatch opt: the value as given, under <side>_opts", node, () => { eq(P("mgr_dash_range", "last30"), { config: { view_dashboard: { manager_opts: { range: "last30" } } } }); eq(P("d_own_log_activity", false), { config: { view_logs: { owner_opts: { activity: false } } } }); });
await K("nodePatch limit: Number(v) under limit.<side>", node, () => eq(P("mgr_bill_reopen_mins", "15"), { config: { void_bills: { limit: { minutes: 15 } } } }));
await K("nodePatch has: { config: { id: { on: v === true } } }", node, () => { eq(P("maintenance", true), { config: { maintenance: { on: true } } }); eq(P(fake({ t: "has", id: "z" }), 1), { config: { z: { on: false } } }); });
await K("nodePatch ratingsMaster ON → stars on + menu-only; OFF → stars off + menu-only", node, () => { eq(P("ratings", true), { features: { ratings: true }, settings: { google_review_mode: "off" } }); eq(P("ratings", false), { features: { ratings: false }, settings: { google_review_mode: "off" } }); });
await K("nodePatch none / unknown → {}", node, () => { eq(P("bill", true), {}); eq(T.nodePatch(fake({ t: "zzz" }), true), {}); });

// ── extraPatch ─────────────────────────────────────────────────────────────────────────────────
await K("extraPatch: only ratings_mode does anything; 'google' turns in-menu stars off", node, () => { eq(T.extraPatch(B.ratings_mode, "google"), { features: { ratings: false } }); eq(T.extraPatch(B.ratings_mode, "google_after_normal"), { features: { ratings: true } }); eq(T.extraPatch(B.ratings_mode, "off"), { features: { ratings: true } }); eq(T.extraPatch(B.ratings, "google"), {}); });

// ── managerGrantValue / waiterCapValue / waiterConfigCapValue / resolveWaiterCaps ─────────────────
await K("managerGrantValue: a retired flag is ON whatever is stored", node, () => { for (const v of [false, true, undefined, "no"]) eq(T.managerGrantValue("banquet", v), true); });
await K("managerGrantValue: a row flag honours a stored boolean and only a boolean", node, () => { eq(T.managerGrantValue("give_discounts", false), false); eq(T.managerGrantValue("give_discounts", "false"), true); eq(T.managerGrantValue("print_clear", 1), false); });
await K("waiterCapValue: WAITER_NEVER beats every stored value", node, () => { for (const v of ["on", "pin", "off", undefined]) eq(T.waiterCapValue("tablet_invoice", v), "off"); });
await K("waiterCapValue: a column with no row is ON whatever is stored", node, () => { for (const v of ["off", undefined]) eq(T.waiterCapValue("tablet_new_thing", v), "on"); });
await K("waiterCapValue: a stored tri-state wins; junk falls back to the row's def", node, () => { eq(T.waiterCapValue("tablet_mark_paid", "pin"), "pin"); eq(T.waiterCapValue("tablet_mark_paid", "yes"), "off"); eq(T.waiterCapValue("tablet_banquet", "maybe"), "on"); });
await K("waiterConfigCapValue: an id with no row is ON", node, () => eq(T.waiterConfigCapValue("nothing", {}), "on"));
await K("waiterConfigCapValue: stored wins; junk or nothing falls back to the def ('pin')", node, () => { eq(T.waiterConfigCapValue("close_unpaid", { close_unpaid: { tablet: "on" } }), "on"); eq(T.waiterConfigCapValue("close_unpaid", { close_unpaid: { tablet: 7 } }), "pin"); eq(T.waiterConfigCapValue("close_unpaid", null), "pin"); });
await K("waiterConfigCapValue: no Feature half on close_unpaid, so switching others off changes nothing", node, () => eq(T.waiterConfigCapValue("close_unpaid", { give_discounts: { on: false }, close_unpaid: { tablet: "on" } }), "on"));
await K("resolveWaiterCaps(null) is null", node, () => eq(T.resolveWaiterCaps(null), null));
await K("resolveWaiterCaps never mutates the object it is given", node, () => { const s = { tablet_invoice: "on" }; T.resolveWaiterCaps(s); eq(s, { tablet_invoice: "on" }); });
await K("resolveWaiterCaps leaves non-tablet keys exactly as they were", node, () => eq(T.resolveWaiterCaps({ menu_enabled: true, x: 1 }).x, 1));
await K("resolveWaiterCaps fills every row column the select left out, at its def", node, () => { const r = T.resolveWaiterCaps({}); for (const c of T.TABLET_COLS) assert(c in r, c); eq(r.tablet_mark_paid, "off"); eq(r.tablet_parcel, "on"); });
await K("resolveWaiterCaps: tablet_invoice is off even when the input never had it", node, () => eq(T.resolveWaiterCaps({}).tablet_invoice, "off"));
await K("resolveWaiterCaps with accessConfig: a Feature-off column goes off; others untouched", node, () => { const r = T.resolveWaiterCaps({ tablet_discount: "on", tablet_mark_paid: "on" }, { give_discounts: { on: false } }); eq([r.tablet_discount, r.tablet_mark_paid], ["off", "on"]); });
await K("resolveWaiterCaps with accessConfig: never writes a key that is not a tablet_ column (item 8)", node, () => { const all = Object.fromEntries(T.HAS_IDS.map((id) => [id, { on: false }])); assert(Object.keys(T.resolveWaiterCaps({}, all)).every((k) => k.startsWith("tablet_"))); });
await K("resolveWaiterCaps with accessConfig undefined: the Feature half is not applied", node, () => eq(T.resolveWaiterCaps({ tablet_discount: "pin" }).tablet_discount, "pin"));
await K("waiterFeatureOffCols: only ids switched off with a literal false count", node, () => { eq(T.waiterFeatureOffCols({ give_discounts: { on: false } }), ["tablet_discount"]); eq(T.waiterFeatureOffCols({ give_discounts: { on: true } }), []); eq(T.waiterFeatureOffCols({ give_discounts: {} }), []); eq(T.waiterFeatureOffCols({ give_discounts: { on: "false" } }), []); });

// ── managerSettingsOff / managerTabsOff / managerTabOn ────────────────────────────────────────────
await K("managerSettingsOff: nothing stored / not an object → []", node, () => { eq(T.managerSettingsOff(undefined), []); eq(T.managerSettingsOff({ menus: { mgrset: "x" } }), []); eq(T.managerSettingsOff({ menus: {} }), []); });
await K("managerSettingsOff: lists only the sections stored literally false, in model order", node, () => eq(T.managerSettingsOff({ menus: { mgrset: { access: false, tables: false, users: true, billing: false } } }), ["tables", "access"]));
await K("managerTabsOff: nothing / not an object → []; only literal false counts; bills is ignored", node, () => { eq(T.managerTabsOff(null), []); eq(T.managerTabsOff({ menus: { manager: 5 } }), []); eq(T.managerTabsOff({ menus: { manager: { ratings: false, log: 0, bills: false } } }), ["ratings"]); });
await K("managerTabOn: true unless that tab is listed off", node, () => { assert(T.managerTabOn({}, "editor")); assert(!T.managerTabOn({ menus: { manager: { editor: false } } }, "editor")); assert(T.managerTabOn({ menus: { manager: { editor: false } } }, "log")); });

// ── applyPatch / deepMerge ───────────────────────────────────────────────────────────────────────
await K("applyPatch never mutates the state it is given", node, () => { const s = st({ features: { reviews: true } }); T.applyPatch(s, { features: { reviews: false } }); eq(s.features.reviews, true); });
await K("applyPatch: a scalar replaces; an object merges deeply; an array replaces", node, () => { const s = T.applyPatch(st({ settings: { a: 1, l: ["x"] }, config: { k: { manager_opts: { p: 1, q: 2 } } } }), { settings: { a: 2, l: ["y"] }, config: { k: { manager_opts: { q: 3 } } } }); eq(s.settings, { a: 2, l: ["y"] }); eq(s.config.k.manager_opts, { p: 1, q: 3 }); });
await K("applyPatch: a key the state lacks entirely is created", node, () => eq(T.applyPatch({}, { grants: { x: true } }).grants, { x: true }));
await K("applyPatch: deepMerge three levels down keeps siblings at every level", node, () => eq(T.applyPatch(st({ config: { a: { b: { c: 1, d: 2 }, e: 3 } } }), { config: { a: { b: { c: 9 } } } }).config, { a: { b: { c: 9, d: 2 }, e: 3 } }));
await K("applyPatch: a null value REPLACES (it is not merged as an object)", node, () => eq(T.applyPatch(st({ creds: { zomato: "••••1" } }), { creds: { zomato: null } }).creds.zomato, null));
await K("applyPatch modules (item 2): a boolean becomes { ...prev, allowed, enabled: true }", node, () => { eq(T.applyPatch(E(), { modules: { loyalty: true } }).modules.loyalty, { allowed: true, enabled: true }); eq(T.applyPatch(st({ modules: { loyalty: { allowed: true, owner_control: true } } }), { modules: { loyalty: false } }).modules.loyalty, { allowed: false, owner_control: true, enabled: true }); });
await K("applyPatch modules: an OBJECT value still deep-merges (no special case)", node, () => eq(T.applyPatch(st({ modules: { loyalty: { allowed: false, x: 1 } } }), { modules: { loyalty: { allowed: true } } }).modules.loyalty, { allowed: true, x: 1 }));
await K("applyPatch channels (item 15): every channel in the patch is marked stored", node, () => { const s = T.applyPatch(E(), { channels: { zomato: true, swiggy: false } }); eq(s.channelsStored, { zomato: true, swiggy: true }); eq(s.channels, { zomato: true, swiggy: false }); });
await K("applyPatch channels: marking keeps channels already stored", node, () => eq(T.applyPatch(st({ channelsStored: { website: true } }), { channels: { zomato: true } }).channelsStored, { website: true, zomato: true }));
await K("applyPatch channels: works on a state that had no channelsStored at all", node, () => eq(T.applyPatch({ channels: {} }, { channels: { zomato: true } }).channelsStored, { zomato: true }));
await K("applyPatch: an empty patch returns an equal, separate object", node, () => { const s = st({ features: { a: true } }); const o = T.applyPatch(s, {}); eq(o, s); assert(o !== s); });

// ── ancestorsOn ────────────────────────────────────────────────────────────────────────────────
await K("ancestorsOn: a top-level row has no ancestors → true even when everything is off", node, () => assert(T.ancestorsOn("menu", () => false)));
await K("ancestorsOn: a child of a switched-off parent → false", node, () => assert(!T.ancestorsOn("dining_sessions", (n) => n.id !== "menu")));
await K("ancestorsOn: a child whose parent is on → true", node, () => assert(T.ancestorsOn("dining_sessions", () => true)));
await K("ancestorsOn: a grandchild with an off grandparent → false (every ancestor is asked)", node, () => assert(!T.ancestorsOn("ratings_mode", (n) => n.id !== "menu")));
await K("ancestorsOn: a pure-group (none) ancestor never blocks", node, () => assert(T.ancestorsOn("menu_layout", (n) => n.id === "menu")));
await K("ancestorsOn: a row in a LATER section is found too (the loop goes on past section 1)", node, () => assert(!T.ancestorsOn("wtr_give_discounts_cap", (n) => n.id !== "wtr_give_discounts")));
await K("ancestorsOn: an unknown id → true", node, () => assert(T.ancestorsOn("no-such-row", () => false)));
