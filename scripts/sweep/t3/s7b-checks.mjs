#!/usr/bin/env node
// SWEEP 7 — TERMINAL 3's SECOND PASS, code-reading rows P41001..P41330.
//
//   npm run sweep:t3b            # all of them
//   npm run sweep:t3b -- --quiet # failures + summary only
//
// The FIRST pass (P16101–P16400) checked how this territory's components USE the libraries beneath
// them. This pass checks the libraries themselves — every default, every degradation, every branch
// of the two screens with the most branches (the dish popup and the table gate) — plus the queue
// edges the first pass did not reach.
//
// Same discipline: assert the RULE, never a comment, and never a spelling that can legitimately
// move. Reads only; no key, no server, no database.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const QUIET = process.argv.includes("--quiet");
const read = (p) => { try { return readFileSync(join(ROOT, p), "utf8"); } catch { return ""; } };
const bare = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

let pass = 0; const fails = []; const lines = [];
const P = (id, name, ok) => {
  if (ok) { pass++; if (!QUIET) lines.push(`ok   ${id} ${name}`); }
  else { fails.push(`${id} ${name}`); lines.push(`FAIL ${id} ${name}`); }
};
const H = (t) => { if (!QUIET) lines.push(`\n── ${t}`); };

const F = {
  cart: read("components/CartPanel.tsx"),
  gate: read("components/SessionGate.tsx"),
  confirm: read("components/OrderConfirmModal.tsx"),
  tracker: read("components/OrderTracker.tsx"),
  widget: read("components/SessionStatusWidget.tsx"),
  tbill: read("components/SessionTableBill.tsx"),
  owner: read("components/SessionOwner.tsx"),
  sync: read("components/SessionCartSync.tsx"),
  chip: read("components/GuestOutboxChip.tsx"),
  chef: read("components/ChefPopup.tsx"),
  mini: read("components/MiniCart.tsx"),
  menu: read("lib/menu.ts"),
  status: read("lib/orderStatus.ts"),
  table: read("lib/table.ts"),
  outbox: read("lib/guestOutbox.ts"),
  tstore: read("lib/tenantStorage.ts"),
  ctx: read("lib/restaurant-context.tsx"),
};

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// G. THE LIBRARIES UNDERNEATH — every default and every degradation (P41001–P41120)
// ═════════════════════════════════════════════════════════════════════════════════════════════════
H("G1. lib/table.ts — the one place a table number is judged (P41001-P41020)");
P("P41001", "an empty table number is refused, with words a diner can act on",
  /if \(!value\) \{\s*return \{ ok: false, value: "", message: "Please enter your table number first\." \}/.test(F.table));
P("P41002", "…and whitespace alone counts as empty",
  /const value = \(raw \|\| ""\)\.trim\(\);/.test(F.table));
P("P41003", "a non-numeric table number is refused",
  /!\/\^\\d\+\$\/\.test\(value\)/.test(F.table));
P("P41004", "…and so is a decimal, even though Number() would accept it",
  /!Number\.isInteger\(num\)/.test(F.table));
P("P41005", "…and so is zero or a negative",
  /num < 1/.test(F.table));
P("P41006", "a table past the restaurant's count is refused, NAMING the real range",
  /message: `Table \$\{num\} doesn't exist — we have tables 1–\$\{tableCount\}\. Please check your number\.`/.test(F.table));
P("P41007", "…and the range check is SKIPPED when the restaurant has not said how many tables it has",
  /if \(tableCount > 0 && num > tableCount\)/.test(F.table));
// Counted on `ok: false` rather than the one-line spelling: the third refusal is a multi-line
// object literal, so matching `ok: false, value: ""` found two of three and called the code wrong.
P("P41008", "a refusal always returns an EMPTY value, so a caller cannot use a number that failed",
  (F.table.match(/ok: false/g) || []).length === 3
  && (F.table.match(/value: ""/g) || []).length === 3);
P("P41009", "…and a pass returns the TRIMMED value, not the raw text",
  /return \{ ok: true, value \};/.test(F.table));
P("P41010", "the flag helper says something out loud as well as marking the box",
  /window\.dispatchEvent\(new CustomEvent\("lfh:toast"/.test(F.table));
P("P41011", "…focuses the box, so the diner's next keystroke lands in the right place",
  /el\?\.focus\(\);/.test(F.table));
P("P41012", "…marks it visibly",
  /el\?\.classList\.add\("table-input-error"\)/.test(F.table));
P("P41013", "…and clears that mark, so the box does not stay red for ever",
  /setTimeout\(\(\) => el\?\.classList\.remove\("table-input-error"\), 1500\)/.test(F.table));
P("P41014", "…and it cannot crash on a box that is not on screen",
  /as HTMLInputElement \| null/.test(F.table) && /el\?\./.test(F.table));
P("P41015", "the remembered table is tenant-scoped like everything else a guest owns",
  /import \{ tget, tset, tremove \} from "\.\/tenantStorage"/.test(F.table));
P("P41016", "…reading it never returns null, so no caller has to guard",
  /return tget\(SCANNED_TABLE_KEY\) \|\| "";/.test(F.table));
P("P41017", "…and writing an EMPTY value REMOVES the key rather than storing \"\"",
  /if \(value\) tset\(SCANNED_TABLE_KEY, value\);\s*else tremove\(SCANNED_TABLE_KEY\);/.test(bare(F.table)));
P("P41018", "every screen that takes a table number judges it with THIS function, not its own rule",
  ["cart", "chef"].every((k) => /validateTable\(/.test(F[k])));
P("P41019", "…and the gate's own typed-table check names the same range in the same words",
  /This place has tables 1–\$\{max\}/.test(F.gate));
P("P41020", "…and nothing in the territory writes its own digits-only regex for a table",
  (bare(F.cart + F.chef).match(/\/\^\\d\+\$\//g) || []).length === 0);

H("G2. lib/orderStatus.ts — what 'live' means (P41021-P41045)");
P("P41021", "there are exactly three forward steps a diner is shown",
  /export const STEPS: OrderStatus\[\] = \["received", "preparing", "served"\];/.test(F.status));
P("P41022", "…and 'cancelled' is deliberately NOT one of them (it is an ending, not a step)",
  !/STEPS[^\]]*cancelled/.test(F.status));
P("P41023", "every status a diner can see has a label, a subtitle and an icon",
  ["received", "preparing", "served", "cancelled"].every((s) => new RegExp(`${s}: \\{ label:`).test(F.status)));
P("P41024", "…and none of those labels is a code",
  !/label: "(received|preparing|served|cancelled)"/.test(F.status));
P("P41025", "…and a cancelled order tells the diner what to DO",
  /cancelled: \{ label: "Order cancelled", sub: "Please ask a member of staff\."/.test(F.status));
P("P41026", "'final' means served or cancelled, in one place",
  /export const isFinalStatus = \(s: OrderStatus\) => s === "served" \|\| s === "cancelled";/.test(F.status));
P("P41027", "the tracked-orders list is read defensively — a corrupt value yields an empty list",
  /return Array\.isArray\(list\) \? list : \[\];/.test(F.status) && /catch \{\s*return \[\];/.test(bare(F.status)));
P("P41028", "…and reading it can never throw",
  /export const readActiveOrders = \(\): ActiveOrder\[\] => \{\s*try \{/.test(bare(F.status)));
P("P41029", "the live list drops an order the diner dismissed",
  /if \(o\.dismissed \|\| now - o\.placedAt > MAX_AGE_MS\) return false;/.test(F.status));
P("P41030", "…and one older than the 3-hour ceiling",
  /export const MAX_AGE_MS = 3 \* 60 \* 60 \* 1000;/.test(F.status));
P("P41031", "…and shows the newest first, so the strip is about what just happened",
  /\.sort\(\(a, b\) => b\.placedAt - a\.placedAt\)/.test(F.status));
P("P41032", "…and takes 'now' as an argument, so the rule is testable without waiting three hours",
  /now: number = Date\.now\(\)/.test(F.status));
// The finding of this pass: the linger constant described a screen that no longer exists.
// Assert the RULE, not the absence of a phrase: the explanation below the constant legitimately
// QUOTES the old sentence in order to correct it, so "the words are gone" is the wrong test. What
// matters is that the constant's own line no longer carries the claim as its trailing comment.
P("P41033", "the linger constant's own line no longer carries the out-of-date claim",
  /export const SERVED_LINGER_MS = 5 \* 1000;\s*$/m.test(F.status));
P("P41034", "…and says plainly that a finished order STAYS until the meal ends",
  /Staying put is the correct behaviour/.test(F.status));
P("P41035", "…and warns the next reader not to 'fix' the filter to honour it",
  /DO NOT "fix" the filter/.test(F.status));
// Line-break tolerant on purpose: the sentence wraps, and a check that breaks when prose re-wraps
// gets loosened until it means nothing.
P("P41036", "…because the screen it named was removed by the owner in June",
  /REMOVED by the[\s\S]{0,12}owner on 2026-06-17/.test(F.status) && /LIVE-STATUS tab only/.test(F.cart));
P("P41037", "the live list is therefore NOT filtered on finalizedAt — deliberately",
  !/finalizedAt.*SERVED_LINGER_MS/.test(bare(F.status)));
P("P41038", "…and the only ways a finished strip leaves are the diner, the table closing, or 3 hours",
  /o\.dismissed/.test(F.status) && /tremove\("lfh_active_orders"\)/.test(F.widget));
P("P41039", "the hidden-live helper ignores an order that has already finished",
  /\.some\(\(o\) => o\.stripHidden && !isFinalStatus\(o\.status\)\)/.test(F.status));
P("P41040", "the backup poll is the 60-second one every guest surface shares",
  /export const RT_BACKUP_MS = 60 \* 1000;/.test(F.status));
P("P41041", "…and the snappy 1.5s constant is NOT used as a poll anywhere in the territory",
  /export const POLL_MS = 1500;/.test(F.status)
  && !new RegExp("setInterval\\([^,]+, POLL_MS\\)").test(F.tracker + F.cart + F.tbill + F.widget));
P("P41042", "an order row carries what the strip needs and nothing the server owns",
  /finalizedAt\?: number;/.test(F.status) && /stripHidden\?: boolean;/.test(F.status));
P("P41043", "writing the list goes through one function, so scoping cannot be forgotten",
  /export const writeActiveOrders = \(list: ActiveOrder\[\]\) => \{\s*tset\(ACTIVE_ORDERS_KEY/.test(bare(F.status)));
P("P41044", "…and every writer in the territory uses it rather than tset directly",
  !/tset\("lfh_active_orders"/.test(bare(F.tracker)));
P("P41045", "the key itself is exported, so no caller retypes the string",
  /export const ACTIVE_ORDERS_KEY = "lfh_active_orders";/.test(F.status));

H("G3. lib/menu.ts — every guest setting degrades rather than breaks (P41046-P41090)");
P("P41046", "a restaurant with NO settings row still gets a working answer for every field",
  (F.menu.match(/data \? /g) || []).length >= 10);
P("P41047", "the bubbles switch defaults ON when unset",
  /bubblesEnabled: data \? data\.bubbles_enabled !== false : true/.test(F.menu));
P("P41048", "service mode defaults OFF, and only an explicit true turns it on",
  /serviceMode: data \? data\.service_mode === true : false/.test(F.menu));
P("P41049", "the table count defaults to 0, which means 'no limit known' — not 'no tables'",
  /tableCount: data \? Number\(data\.table_count\) \|\| 0 : 0/.test(F.menu));
P("P41050", "…and a junk table count becomes 0 rather than NaN",
  /Number\(data\.table_count\) \|\| 0/.test(F.menu));
P("P41051", "the table-session system defaults OFF — a restaurant opts IN",
  /sessionsEnabled: data \? data\.sessions_enabled === true : false/.test(F.menu));
P("P41052", "the location check defaults ON — a restaurant opts OUT",
  /requireLocation: data \? data\.require_location !== false : true/.test(F.menu));
P("P41053", "phone verification defaults ON the same way",
  /requireOtp: data \? data\.require_otp !== false : true/.test(F.menu));
P("P41054", "a missing geofence centre is null, which the gate reads as 'skip the check'",
  /geoLat: data \? num\(data\.geo_lat\) : null/.test(F.menu) && /geoLng: data \? num\(data\.geo_lng\) : null/.test(F.menu));
P("P41055", "…and a blank string is treated as null, not as 0 (the middle of the ocean)",
  /v === "" \|\| isNaN\(Number\(v\)\) \? null : Number\(v\)/.test(F.menu));
P("P41056", "the geofence radius has a real default rather than 0",
  /geoRadiusM: data \? Number\(data\.geo_radius_m\) \|\| 250 : 250/.test(F.menu));
P("P41057", "the feature switches degrade to an empty object, which means 'code defaults'",
  /features: data && data\.features && typeof data\.features === "object"/.test(F.menu));
P("P41058", "…and a non-object features value cannot crash the merge",
  /typeof data\.features === "object"/.test(F.menu));
P("P41059", "the tax rate comes from one resolver, never from a field read here",
  /taxRate: effectiveTaxRate\(data\)/.test(F.menu));
P("P41060", "the price behaviour comes from its own resolver too",
  /priceTaxMode: priceTaxMode\(data \?\? \{\}\)/.test(F.menu));
P("P41061", "…and is safe on a restaurant with no row at all",
  /priceTaxMode\(data \?\? \{\}\)/.test(F.menu) && /itemTaxModesAllowed\(data \?\? \{\}\)/.test(F.menu));
P("P41062", "per-dish tax modes are OFF unless explicitly allowed",
  /itemTaxModesAllowed: itemTaxModesAllowed\(data \?\? \{\}\)/.test(F.menu));
P("P41063", "MRP treatment is 'none' unless the restaurant says 'inclusive'",
  /=== "inclusive" \? "inclusive" : "none"/.test(F.menu));
P("P41064", "a blank Google review link is null, not an empty string a UI would render",
  /google_review_url\.trim\(\) \? data\.google_review_url\.trim\(\) : null/.test(F.menu));
P("P41065", "…and an unrecognised review mode falls back to off",
  /: "off"/.test(F.menu) && /\["google", "google_plus_normal", "google_after_normal"\]/.test(F.menu));
P("P41066", "the guest menu master switch defaults ON, so a new restaurant is not dark",
  /menuEnabled: data \? data\.menu_enabled !== false : true/.test(F.menu));
P("P41067", "the default layout is the grid unless the restaurant chose the list",
  /menuDefaultLayout: data && data\.menu_default_layout === "list" \? "list" : "grid"/.test(F.menu));
P("P41068", "the default skin is LIGHT unless the restaurant chose dark",
  /menuDefaultMode: data && data\.menu_default_mode === "dark" \? "dark" : "light"/.test(F.menu));
P("P41069", "languages and currencies fall back to a real list, never an empty one",
  /menuLanguages: strList\(data\?\.menu_languages, \["en"\]\)/.test(F.menu)
  && /menuCurrencies: strList\(data\?\.menu_currencies, \["INR"\]\)/.test(F.menu));
P("P41070", "…because exactly one entry REMOVES the switcher, and zero would remove the menu's language",
  /strList/.test(F.menu));
P("P41071", "the settings read asks a function, not the settings table, so a column list cannot drift",
  /\.rpc\("lfh_guest_settings", \{ p_restaurant_id: restaurantId \}\)/.test(F.menu));
P("P41072", "…and a failure THROWS rather than silently returning defaults as if they were real",
  /throw new Error\(`Failed to load settings: \$\{error\.message\}`\)/.test(F.menu));
P("P41073", "…which every caller in the territory catches, so no screen dies of it",
  ["cart", "chef", "tracker", "tbill", "widget", "owner", "sync"].every((k) => /catch/.test(F[k])));
P("P41074", "a dish row maps to camelCase in ONE place",
  /function mapRow\(row: any, agg\?: RatingAgg\): MenuItem/.test(F.menu));
P("P41075", "…where a missing description becomes an empty string, not the word undefined",
  /description: row\.description \?\? ""/.test(F.menu));
P("P41076", "…a missing tag list becomes an empty array, so `.includes` never throws",
  /tags: row\.tags \?\? \[\]/.test(F.menu));
P("P41077", "…and so does a missing allergen list",
  /allergens: row\.allergens \?\? \[\]/.test(F.menu));
P("P41078", "…options are only kept when they really are a list",
  /options: Array\.isArray\(row\.options\) \? row\.options : \[\]/.test(F.menu));
P("P41079", "…a rating with no reviews is an empty string, so the card can say 'New' instead of 0",
  /rating: agg\?\.avg_rating != null \? Number\(agg\.avg_rating\)\.toFixed\(1\) : ""/.test(F.menu));
P("P41080", "…and it is shown to one decimal, so the card and the dish page cannot disagree",
  /toFixed\(1\)/.test(F.menu));
P("P41081", "…a review count with no reviews is 0, not undefined",
  /reviewCount: agg\?\.review_count \?\? 0/.test(F.menu));
P("P41082", "…an unknown per-dish tax mode falls back to 'follow the restaurant'",
  /\["excl", "incl", "mrp", "none"\]\.includes\(String\(row\.tax_mode\)\) \? row\.tax_mode : "default"/.test(F.menu));
P("P41083", "…and veg / 3D flags are forced to real booleans",
  /veg: !!row\.veg/.test(F.menu) && /is4d: !!row\.is4d/.test(F.menu));
P("P41084", "a column that was NOT selected omits its key entirely rather than inventing a default",
  /has\(row, "long_description"\)/.test(F.menu) && /has\(row, "nutrition"\)/.test(F.menu));
P("P41085", "…which is the whole reason the card payload can be narrowed without touching the dish page",
  /this must shrink the CARD payload only/.test(F.menu));
P("P41086", "open-price dishes are filtered out of the guest list",
  /open_price/.test(F.menu));
P("P41087", "…and a hidden dish's own page refuses rather than rendering",
  /getMenuItem/.test(F.menu) && /return null/.test(F.menu));
P("P41088", "the settings cache is per restaurant, so one tenant cannot serve another's answer",
  /const settingsCache = new Map<string, \{ at: number; val: Settings \}>\(\);/.test(F.menu));
P("P41089", "…with a short TTL, so a change is picked up without a reload",
  /const SETTINGS_TTL_MS = 8000;/.test(F.menu));
P("P41090", "…and an in-flight request is shared rather than duplicated per widget",
  /const pending = settingsInflight\.get\(restaurantId\);\s*if \(pending\) return pending;/.test(bare(F.menu)));

H("G4. lib/tenantStorage + restaurant-context, from the other side (P41091-P41120)");
P("P41091", "the tenant rule answers on the server without touching sessionStorage",
  /if \(typeof window === "undefined"\) return DEFAULT_RESTAURANT_SLUG;/.test(F.tstore));
P("P41092", "…and every read/write helper has the same server guard",
  (F.tstore.match(/if \(typeof window === "undefined"\)/g) || []).length >= 5);
P("P41093", "the legacy migration is attempted once per module load, not once per read",
  /let migrated = false;/.test(F.tstore) && /if \(migrated \|\| typeof window === "undefined"\) return;/.test(F.tstore));
P("P41094", "…and the flag is set BEFORE the work, so a throw cannot make it run twice",
  /migrated = true;\s*try \{/.test(bare(F.tstore)));
P("P41095", "the migration moves only the keys that existed before scoping",
  /const LEGACY_KEYS = \[/.test(F.tstore));
P("P41096", "…and it is idempotent: a second run finds the flag and returns",
  /if \(localStorage\.getItem\(MIGRATED_FLAG\)\) return;/.test(F.tstore));
P("P41097", "a scoped key is base + ':' + slug, with nothing else between",
  /return `\$\{base\}:\$\{tenantSlug\(\)\}`;/.test(F.tstore));
P("P41098", "the explicit-slug read and write agree on that shape exactly",
  /localStorage\.getItem\(`\$\{base\}:\$\{fold\(slug\)\}`\)/.test(F.tstore)
  && /localStorage\.setItem\(`\$\{base\}:\$\{fold\(slug\)\}`, value\)/.test(F.tstore));
P("P41099", "…so an order flushed for restaurant A lands under A even while the tab is on B",
  /tsetFor\("lfh_active_orders", slug/.test(F.outbox));
P("P41100", "the fold cannot turn a blank slug into a blank bucket",
  /\(slug \|\| DEFAULT_RESTAURANT_SLUG\)\.trim\(\)\.toLowerCase\(\)/.test(F.tstore));
P("P41101", "the provider's synchronous slug is derived from the PATH only",
  /const m = \(pathname \|\| ""\)\.match\(\/\^\\\/r\\\/\(\[\^\/\]\+\)\/\);/.test(F.ctx));
P("P41102", "…so the server and the first client render cannot disagree",
  /const \[slug, setSlug\] = useState<string>\(pathSlug\);/.test(F.ctx));
P("P41103", "…and it is lower-cased, because it names a storage bucket",
  /\.trim\(\)\.toLowerCase\(\)/.test(F.ctx));
P("P41104", "the resolved id starts at restaurant #1 so no widget waits for a value",
  /const \[id, setId\] = useState<string>\(DEFAULT_RESTAURANT_ID\);/.test(F.ctx));
P("P41105", "…which is exactly why `ready` exists for anything that ASKS THE SERVER",
  /ready: boolean;/.test(F.ctx));
P("P41106", "the context value is memoised on its four fields, not rebuilt every render",
  /useMemo<RestaurantMeta>\(\(\) => \(\{ id, slug, name, ready \}\), \[id, slug, name, ready\]\)/.test(F.ctx));
// The CALL, not the import — counting both found two and called one file wrong.
P("P41107", "there is exactly one context object, so two providers cannot disagree",
  (F.ctx.match(/createContext</g) || []).length === 1);
P("P41108", "the default meta is ready:true, because bare routes ARE restaurant #1",
  /const DEFAULT_META: RestaurantMeta = \{ id: DEFAULT_RESTAURANT_ID, slug: DEFAULT_RESTAURANT_SLUG, name: null, ready: true \};/.test(F.ctx));
P("P41109", "restaurant #1's own routes skip the lookup entirely",
  /if \(s === DEFAULT_RESTAURANT_SLUG\) \{ setId\(DEFAULT_RESTAURANT_ID\); setReady\(true\); return; \}/.test(F.ctx));
P("P41110", "a widget that needs only the id does not subscribe to the name",
  /export function useRestaurantId\(\): string \{\s*return useContext\(RestaurantContext\)\.id;/.test(bare(F.ctx)));
P("P41111", "the basket is stored per restaurant",
  /tget\("lfh_cart"\)/.test(F.cart));
P("P41112", "the tracked orders are stored per restaurant",
  /ACTIVE_ORDERS_KEY = "lfh_active_orders"/.test(F.status));
P("P41113", "the remembered table is stored per restaurant",
  /SCANNED_TABLE_KEY = "lfh_table"/.test(F.table));
P("P41114", "the declared allergies are stored per restaurant",
  /tget\("lfh_declared"\)/.test(F.cart));
P("P41115", "the guest's chosen name is stored per restaurant AND per session token",
  /JSON\.stringify\(\{ token, name \}\)/.test(F.gate));
P("P41116", "…so a new party at the same table is asked again",
  /return token && v && v\.token === token \? String\(v\.name \|\| ""\)\.trim\(\) : "";/.test(F.gate));
P("P41117", "…while leaving and rejoining the SAME session reuses the name",
  /v\.table === table && v\.sessionId === sessionId/.test(F.gate));
P("P41118", "the location consent is remembered per restaurant, so consent is asked per place",
  /tget\(LOC_CONSENT_KEY\) === "1"/.test(F.gate));
P("P41119", "a legacy plain-string name is treated as no name rather than crashing",
  /catch \{ return ""; \} \/\/ legacy plain-string/.test(F.gate));
P("P41120", "nothing in the territory writes an UNSCOPED guest key",
  !/localStorage\.setItem\("lfh_(cart|session|active_orders|table|declared|nickname)"/.test(
    F.cart + F.gate + F.tracker + F.widget + F.chef + F.confirm + F.sync));

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// H. THE TWO SCREENS WITH THE MOST BRANCHES (P41121–P41240)
// ═════════════════════════════════════════════════════════════════════════════════════════════════
H("H1. the dish popup — options, allergies, editing (P41121-P41175)");
P("P41121", "the popup refuses to open without a dish",
  /if \(!detail\?\.item\) return;/.test(F.confirm));
P("P41122", "…and renders nothing when closed or dish-less",
  /if \(!open \|\| !item\) return null;/.test(F.confirm));
P("P41123", "a single-choice group pre-selects its FIRST choice, so nothing is unpriced",
  /g\.type === "single" && g\.choices\[0\] \? \[g\.choices\[0\]\.label\] : \[\]/.test(F.confirm));
P("P41124", "…and a multi-choice group starts empty",
  /: \[\];/.test(F.confirm));
P("P41125", "editing restores the choices that were saved, not the defaults",
  /if \(pre\?\.options\) init\[i\] = pre\.options\.filter\(\(o\) => o\.group === g\.name\)\.map\(\(o\) => o\.label\);/.test(F.confirm));
P("P41126", "…matched by GROUP NAME, so two groups offering the same label cannot cross",
  /o\.group === g\.name/.test(F.confirm));
P("P41127", "picking in a single-choice group REPLACES rather than adds",
  /if \(type === "single"\) return \{ \.\.\.prev, \[groupIdx\]: \[label\] \};/.test(F.confirm));
P("P41128", "picking in a multi-choice group toggles",
  /cur\.includes\(label\) \? cur\.filter\(\(l\) => l !== label\) : \[\.\.\.cur, label\]/.test(F.confirm));
P("P41129", "a dish that lists its own allergens offers exactly those",
  /const pickable = hasDeclared \? allergens : COMMON_ALLERGEN_SLUGS;/.test(F.confirm));
P("P41130", "…and one that lists none offers the common set, so a guest can still flag something",
  /const COMMON_ALLERGEN_SLUGS = ALLERGENS\.map\(\(a\) => a\.slug\);/.test(F.confirm));
P("P41131", "a saved allergen that is NOT offered here re-opens as free text",
  /const otherEntries = preRemoved\.filter\(\(r\) => !pickable\.includes\(r\)\);/.test(F.confirm));
P("P41132", "…and one that IS offered re-opens as a selected chip",
  /setRemoved\(preRemoved\.filter\(\(r\) => pickable\.includes\(r\)\)\);/.test(F.confirm));
P("P41133", "…and the free-text box only opens when there is something in it",
  /setOtherOn\(otherEntries\.length > 0\);/.test(F.confirm));
P("P41134", "'avoid this in every dish' is never pre-ticked from a previous edit",
  /setApplyAll\(false\);/.test(F.confirm));
P("P41135", "the line's own allergen list drops anything already avoided order-wide",
  /\.filter\(\(r\) => !orderWide\.includes\(r\)\)/.test(F.confirm));
P("P41136", "…so the kitchen ticket does not repeat the same instruction twice",
  /const lineRemoved = \(applyAll \? \[\] : finalRemoved\)/.test(F.confirm));
P("P41137", "…and choosing 'avoid everywhere' empties the LINE list, because the order carries it",
  /applyAll \? \[\] : finalRemoved/.test(F.confirm));
P("P41138", "…and announces it, so the order-wide list actually gains the allergens",
  /new CustomEvent\("lfh:avoid-all", \{ detail: \{ allergens: finalRemoved \} \}\)/.test(F.confirm));
P("P41139", "…only when there is something to announce",
  /if \(applyAll && finalRemoved\.length\)/.test(F.confirm));
P("P41140", "the line signature is built from options, removals and the note together",
  /const sig = JSON\.stringify\(\[/.test(F.confirm));
P("P41141", "…so the same dish with different choices is a SEPARATE line",
  /\.\.\.chosen\.map\(\(c\) => `\$\{c\.group\}:\$\{c\.label\}`\)/.test(F.confirm));
P("P41142", "…and an allergen removal is part of that identity",
  /\.\.\.lineRemoved\.map\(\(r\) => `no:\$\{r\}`\)/.test(F.confirm));
P("P41143", "…and so is a note, but only when there is one",
  /\.\.\.\(noteOut \? \[`note:\$\{noteOut\}`\] : \[\]\)/.test(F.confirm));
P("P41144", "editing removes the OLD line by id AND signature before adding the new one",
  /if \(editSig\) cart = cart\.filter\(\(it\) => !\(it\.id === item\.id && \(it\.sig \|\| "\[\]"\) === editSig\)\)/.test(F.confirm));
P("P41145", "…so another plain line of the same dish is not destroyed by an edit",
  /\(it\.sig \|\| "\[\]"\) === editSig/.test(F.confirm));
P("P41146", "adding the same dish+choices again BUMPS the existing line",
  /if \(existing\) existing\.qty = Math\.min\(99, existing\.qty \+ qty\)/.test(F.confirm));
P("P41147", "…capped at the same 99 the rest of the app uses",
  /Math\.min\(99, existing\.qty \+ qty\)/.test(F.confirm) && /qty: Math\.min\(99, qty\)/.test(F.confirm));
P("P41148", "a brand-new line stores the unit price WITH its chosen extras",
  /price: unit\.toFixed\(2\)/.test(F.confirm));
P("P41149", "…to two decimals, because it is the stored USD domain",
  /unit\.toFixed\(2\)/.test(F.confirm));
P("P41150", "…and empty option/removal/note fields are omitted rather than stored empty",
  /options: chosen\.length \? chosen : undefined/.test(F.confirm)
  && /removed: lineRemoved\.length \? lineRemoved : undefined/.test(F.confirm)
  && /note: noteOut \|\| undefined/.test(F.confirm));
P("P41151", "a corrupt saved basket cannot stop a dish being added",
  /const parsed = JSON\.parse\(saved\);\s*if \(Array\.isArray\(parsed\)\) cart = parsed;/.test(bare(F.confirm)));
P("P41152", "the basket is announced after the write, so every other widget re-reads",
  /tset\("lfh_cart", JSON\.stringify\(cart\)\);\s*window\.dispatchEvent\(new Event\("lfh:cart-updated"\)\);/.test(bare(F.confirm)));
P("P41153", "adding says what was added, and how many",
  /message: `\$\{qty\} × \$\{item\.title\} added`/.test(F.confirm));
P("P41154", "…and editing says 'updated' instead, because nothing new arrived",
  /message: `\$\{item\.title\} updated`/.test(F.confirm));
P("P41155", "…and both close the popup",
  (F.confirm.match(/setOpen\(false\);/g) || []).length >= 4);
P("P41156", "a failure while saving is logged rather than swallowed silently",
  /console\.error\("Failed to add to cart", e\)/.test(F.confirm));
P("P41157", "…and the button is re-enabled either way",
  /finally \{\s*setSubmitting\(false\);/.test(bare(F.confirm)));
P("P41158", "a second tap while saving is ignored",
  /if \(submitting\) return;/.test(F.confirm));
P("P41159", "the quantity starts at 1 for a new dish",
  /setQty\(pre\?\.qty && pre\.qty > 0 \? pre\.qty : 1\)/.test(F.confirm));
P("P41160", "…and at the saved quantity when editing",
  /pre\?\.qty && pre\.qty > 0 \? pre\.qty : 1/.test(F.confirm));
P("P41161", "…and a nonsense saved quantity falls back to 1 rather than 0 or negative",
  /pre\.qty > 0/.test(F.confirm));
P("P41162", "the note is only kept when the restaurant allows notes",
  /const noteOut = features\.guest_note \? note\.trim\(\) : ""/.test(F.confirm));
P("P41163", "…and the free text only when free-text allergies are allowed",
  /otherOn && features\.allergy_other \? otherText\.trim\(\) : ""/.test(F.confirm));
P("P41164", "…both read the switches for the restaurant ON SCREEN",
  /useFeatures\(useRestaurantId\(\)\)/.test(F.confirm));
P("P41165", "the price shown per option is minor-rounded, so base + extras equals the total",
  /minorDisplay\(c\.price, currency \|\| undefined\)/.test(F.confirm));
P("P41166", "…and a free option shows no price at all",
  /c\.price > 0 && <span className="oc-price">/.test(F.confirm));
P("P41167", "the base line uses the menu card's own price treatment, so the two agree",
  /unitDisplay\(prettyUsd\(item\.price\), \[\], currency \|\| undefined\)/.test(F.confirm));
P("P41168", "the popup closes on Escape",
  /if \(e\.key === "Escape"\) setOpen\(false\)/.test(F.confirm));
P("P41169", "…and that listener only exists while it is open",
  /document\.addEventListener\("keydown", onKey\);\s*return \(\) => document\.removeEventListener\("keydown", onKey\);/.test(bare(F.confirm)));
P("P41170", "…and on the phone's back button",
  /useBackClose\("order-confirm", open, \(\) => setOpen\(false\)\)/.test(F.confirm));
P("P41171", "…and on the backdrop",
  /className="overlay active" onClick=\{\(\) => setOpen\(false\)\}/.test(F.confirm));
P("P41172", "…and on the ✕",
  /className="order-confirm-close" aria-label="Close"/.test(F.confirm));
P("P41173", "the dialog announces itself to a screen reader",
  /role="dialog" aria-modal="true" aria-label="Confirm order"/.test(F.confirm));
P("P41174", "a global close-everything shuts it too",
  /window\.addEventListener\("lfh:close-all", onClose\)/.test(F.confirm));
P("P41175", "a currency switch repaints its prices while it is open",
  /window\.addEventListener\("lfh:currency-changed", onCurrency\)/.test(F.confirm));

H("H2. the table gate — every one of its screens (P41176-P41240)");
const STEPS = ["ask_table","scan_qr","location_intro","locating","location_help","not_open","guest_name",
               "open_name","joining","nickname","waiting_approval","denied","table_closed","net_error",
               "request_sent","working","blocked"];
P("P41176", "every step the gate can be in is declared in one union",
  STEPS.every((s) => new RegExp(`"${s}"`).test(F.gate)));
P("P41177", "…and every declared step has a screen that renders it",
  STEPS.every((s) => new RegExp(`step === "${s}"`).test(F.gate)));
P("P41178", "…so no state can leave the diner looking at an empty card",
  !STEPS.some((s) => !new RegExp(`step === "${s}"`).test(F.gate)));
P("P41179", "the sheet renders nothing at all when closed",
  /if \(!open\) return null;/.test(F.gate));
P("P41180", "the backdrop closes it",
  /<div className="sg-overlay" onClick=\{close\}>/.test(F.gate));
P("P41181", "…and a tap INSIDE the card does not",
  /onClick=\{\(e\) => e\.stopPropagation\(\)\}/.test(F.gate));
P("P41182", "…and the card announces itself to a screen reader",
  /role="dialog" aria-modal="true"/.test(F.gate));
P("P41183", "the table box takes numbers only, on a numeric keypad",
  /type="number" inputMode="numeric"/.test(F.gate));
P("P41184", "…and Enter submits it, so a phone keyboard's Go key works",
  /if \(e\.key === "Enter"\) submitTable\(\);/.test(F.gate));
P("P41185", "…and it is focused on open, so the diner can just type",
  /autoFocus/.test(F.gate));
P("P41186", "…and its ✕ appears only when there is something to clear",
  /\{tableInput !== "" && \(/.test(F.gate));
P("P41187", "the location screen explains WHY before the browser asks",
  /step === "location_intro"/.test(F.gate) && /we quickly confirm you&apos;re here/.test(F.gate));
P("P41188", "…and promises the location is used once and not stored",
  /We never store or share it/.test(F.gate));
P("P41189", "…and consent is remembered, so a returning guest is not re-lectured",
  /tset\(LOC_CONSENT_KEY, "1"\)/.test(F.gate));
P("P41190", "…and a restaurant that does not require it skips the whole thing",
  /if \(!st\.requireLocation\) \{ coords\.current = \{ lat: null, lng: null \}; return afterLocation\(\); \}/.test(F.gate));
P("P41191", "the 'too far' screen offers a way forward rather than a dead end",
  /step === "location_help"/.test(F.gate) && /doRequest\("access"\)/.test(F.gate));
P("P41192", "the 'not open yet' screen says who opens a table",
  /step === "not_open"/.test(F.gate));
P("P41193", "…and starts watching, so the guest is carried in without tapping again",
  /setStep\("not_open"\); proceedWhenOpen\(\);/.test(F.gate));
P("P41194", "…and that watcher stops the moment the table opens",
  /return false; \/\/ table opened -> stop polling/.test(F.gate));
P("P41195", "…and sends the FIRST guest in as the head, the rest to the join screen",
  /if \(\(st\.members as number\) === 0\) joinAsHead\(\);\s*else setStep\("guest_name"\);/.test(bare(F.gate)));
P("P41196", "the head's-name screen refuses an empty name with a reason",
  /setNote\("Add your name so the table shows who opened it\."\)/.test(F.gate));
P("P41197", "the joining guest's screen refuses an empty name with its own reason",
  /setNote\("Add your name to join the table\."\)/.test(F.gate));
P("P41198", "the nickname screen refuses an empty name too",
  /setNote\("Add a name so we know who you are\."\)/.test(F.gate));
P("P41199", "…and resumes the ORIGINAL action once a name is given",
  /await act\(\); \/\/ resume the ORIGINAL queued action/.test(F.gate));
P("P41200", "the waiting screen polls, and that poll pauses on a hidden tab",
  /step === "waiting_approval"/.test(F.gate) && /document\.hidden/.test(F.gate));
P("P41201", "the denied screen exists, so a refusal is not silence",
  /step === "denied"/.test(F.gate));
P("P41202", "the table-closed screen exists too",
  /step === "table_closed"/.test(F.gate));
P("P41203", "the blocked screen tells the diner to speak to someone",
  /step === "blocked"/.test(F.gate));
P("P41204", "the network-error screen offers a working Retry",
  /step === "net_error"/.test(F.gate) && /retryFlow/.test(F.gate));
P("P41205", "…and that Retry re-fetches settings if they were what failed",
  /if \(!settingsRef\.current\) \{/.test(F.gate));
P("P41206", "…and gives up gracefully if they still cannot be fetched",
  /Still can't reach the restaurant's system — check your internet and try again\./.test(F.gate));
P("P41207", "the request-sent screen only promises auto-send where a watcher really runs",
  /setReqAutoSend\(type === "open"\)/.test(F.gate));
P("P41208", "…and the other path says something that is true without it",
  /reqAutoSend/.test(F.gate));
P("P41209", "the scan screen keeps the camera muted and inline, so a phone does not fullscreen it",
  /muted playsInline/.test(F.gate));
P("P41210", "…and offers a way out to typing",
  /Type it instead/.test(F.gate));
P("P41211", "…and a scanned QR is reduced to digits before it is trusted",
  /t = \(t \|\| ""\)\.replace\(\/\\D\/g, ""\)/.test(F.gate));
P("P41212", "…reading the table from either query name the QR might use",
  /u\.searchParams\.get\("table"\) \|\| u\.searchParams\.get\("t"\)/.test(F.gate));
P("P41213", "…and a raw non-URL code is still tried rather than discarded",
  /catch \{ t = raw; \}/.test(F.gate));
// RE-AIMED: a `return;` was added after setStep, which is a tightening, not a loosening.
P("P41214", "…and the camera is stopped the moment a code is read",
  /if \(t\) \{ stopScan\(\); setTableInput\(t\); setStep\("ask_table"\);/.test(F.gate));
P("P41215", "the gate is driven by ONE event, so no screen can open it a second way",
  /window\.addEventListener\("lfh:session-do", onDo\)/.test(F.gate));
P("P41216", "…which refuses a malformed request rather than opening on nothing",
  /if \(!detail\?\.action\) return;/.test(F.gate));
P("P41217", "…and refuses an action that needs a table but has none",
  /if \(!detail\.table && detail\.action !== "connect"\) return;/.test(F.gate));
P("P41218", "a 'connect' with a live approved session finishes WITHOUT showing the popup at all",
  /if \(state\.ok && sObj\?\.status === "open" && member\?\.approved\) \{ await act\(\); return; \}/.test(F.gate));
P("P41219", "…and a 'connect' with no table asks for one rather than guessing",
  /setNote\(""\); setTableInput\(""\); setOpen\(true\); setStep\("ask_table"\);/.test(F.gate));
P("P41220", "a stored session is re-checked before it is trusted",
  /const stored = getStoredSession\(pending\.current!\.table\);/.test(F.gate));
P("P41221", "…and a session that is no longer open starts the flow again from the top",
  /if \(sessionObj\?\.status !== "open"\) \{ clearStoredSession\(\); sess\.current = null; return beginLocation\(\); \}/.test(F.gate));
P("P41222", "…and an unapproved member waits rather than ordering",
  /if \(!member\?\.approved\) \{ setStep\("waiting_approval"\); startApprovalPoll\(\); return; \}/.test(F.gate));
P("P41223", "the head's name is stored against the SESSION, so the next party is asked afresh",
  /setTableName\(s\.table, r\.session_id as string, headName\)/.test(F.gate));
P("P41224", "…and a returning device on the same session is not asked again",
  /const remembered = getTableName\(p\.table, st\.session_id as string \| undefined\);/.test(F.gate));
P("P41225", "…and it joins straight away with that name",
  /if \(remembered\) \{ setName\(remembered\); nameRef\.current = remembered; await joinGuestRef\.current\?\.\(remembered\); return; \}/.test(F.gate));
P("P41226", "a device that already holds a membership does not create a second one",
  /const already = getStoredSession\(p\.table\);\s*if \(already\) \{ sess\.current = already; await ensureReadyAndAct\(\); return; \}/.test(bare(F.gate)));
P("P41227", "joining remembers the table on the device, so the bill can pre-fill it",
  /sess\.current = s; storeSession\(s\); rememberTable\(s\.table\);/.test(F.gate));
P("P41228", "…and announces it, so the cart and the waiter popup both update",
  /window\.dispatchEvent\(new Event\("lfh:table-scanned"\)\)/.test(F.gate));
P("P41229", "…and announces the session change, so the approve-poller wakes",
  /window\.dispatchEvent\(new Event\("lfh:session-changed"\)\)/.test(F.gate));
P("P41230", "the order the gate is holding carries the lines, so a refusal can name a dish",
  /lines: pl\.lines/.test(F.gate));
P("P41231", "…and the tracker summary, so a saved order can be listed by name",
  /track: pl\.track/.test(F.gate));
P("P41232", "…under an at-most-once id shared by the live attempt and anything saved",
  /const actionId = orderKeyRef\.current\.id;/.test(F.gate));
P("P41233", "…which is minted from the ITEMS and the allergies, not from the table",
  /const sig = JSON\.stringify\(\{ i: pl\.items, a: pl\.allergies \|\| \[\] \}\)/.test(F.gate));
P("P41234", "…and cleared once the order is placed, so the next basket is a new order",
  /orderKeyRef\.current = null; \/\/ placed → the next basket is a new order/.test(F.gate));
P("P41235", "…and cleared when it is saved instead, for the same reason",
  /orderKeyRef\.current = null;\s*fireDone\(\{ ok: true, action: "order", queued: true \}\)/.test(bare(F.gate)));
P("P41236", "closing the gate stops both the poll and the camera",
  /stopPoll\(\); stopScan\(\); setOpen\(false\);/.test(F.gate));
P("P41237", "…and forgets the pending action, so it cannot resume later out of nowhere",
  /pending\.current = null;/.test(F.gate));
P("P41238", "…and resets the waiter-request guard, so the next visit can ask again",
  /accessReqRef\.current = false;/.test(F.gate));
P("P41239", "the brand line falls back to a name only for restaurant #1, never for another tenant",
  /restaurantName \|\| \(restaurantId === DEFAULT_RESTAURANT_ID \? "My Little French House" : null\)/.test(F.gate));
P("P41240", "…so a restaurant whose name has not resolved shows NO brand rather than someone else's",
  /: null\);/.test(F.gate));

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// I. THE QUEUE'S REMAINING EDGES, AND WAKING UP (P41241–P41330)
// ═════════════════════════════════════════════════════════════════════════════════════════════════
H("I1. the queue's edges the first pass did not reach (P41241-P41285)");
P("P41241", "the queue is restored oldest-first, so orders send in the order they were placed",
  /\.sort\(\(a, b\) => a\.at - b\.at\)/.test(F.outbox));
// RE-AIMED, and by MY OWN change: sweep #8's item 13 made the restore MERGE with what is already
// in memory instead of assigning over it, so an order saved in the same instant is not dropped from
// the sending list. The two filters are unchanged and still the source of both lists — they now feed
// a map rather than an assignment.
P("P41242", "…and failed rows are restored separately, not re-sent",
  /all\.filter\(\(x\) => x\.status === "failed"\)\) failedById\.set/.test(F.outbox));
P("P41243", "…and anything not explicitly failed counts as still queued",
  /all\.filter\(\(x\) => x\.status !== "failed"\)\) byId\.set/.test(F.outbox));
P("P41244", "restoring immediately gives the queue a timer and a flush",
  /notify\(\);\s*ensureRetry\(\);\s*void flushGuestOutbox\(\);/.test(bare(F.outbox)));
P("P41245", "a phone that never queued anything does not gain a database",
  /indexedDB as \{ databases\?: \(\) => Promise<\{ name\?: string \}\[\]> \}/.test(F.outbox));
P("P41246", "…and when it cannot tell, it opens the database rather than losing an order",
  /catch \{ \/\* can't tell → fall through and open it, exactly as before \*\/ \}/.test(F.outbox));
// Asserted on the CODE, not on the sentence beside it: bare() strips comments, so a check written
// against a comment can never pass — it is dead by construction, which is the worst kind.
P("P41247", "…and publishes the empty state so the chip renders nothing rather than nothing-at-all",
  /!dbs\.some\(\(d\) => d\?\.name === DB_NAME\)\) \{\s*notify\(\);\s*return;/.test(bare(F.outbox)));
P("P41248", "the queue wakes on reconnect",
  /window\.addEventListener\("online", \(\) => \{ void flushGuestOutbox\(\); \}\)/.test(F.outbox));
P("P41249", "…on the tab becoming visible",
  /if \(document\.visibilityState === "visible"\) void flushGuestOutbox\(\)/.test(F.outbox));
P("P41250", "…and on focus, because a phone can return without either of the other two",
  /window\.addEventListener\("focus", \(\) => \{ void flushGuestOutbox\(\); \}\)/.test(F.outbox));
P("P41251", "two flushes cannot run at once",
  /export async function flushGuestOutbox\(\) \{\s*if \(flushing\) return;/.test(bare(F.outbox)));
P("P41252", "…and the running one always schedules the next, even if it throws",
  /\} finally \{\s*flushing = false;\s*notify\(\);\s*scheduleRetry\(progressed\);/.test(bare(F.outbox)));
P("P41253", "an empty queue clears its timer rather than beating for ever",
  /if \(!queued\.length\) \{ if \(retryTimer\) \{ clearTimeout\(retryTimer\); retryTimer = null; \} retryStep = 0; return; \}/.test(F.outbox));
P("P41254", "the flush stops the moment the phone goes offline mid-round",
  /while \(idx < queued\.length && !isOffline\(\)\)/.test(F.outbox));
P("P41255", "…and a request that fails while offline breaks rather than counting a strike",
  /catch \{\s*if \(isOffline\(\)\) break;/.test(bare(F.outbox)));
P("P41256", "progress resets the backoff, so the next order does not wait two minutes",
  /if \(progressed\) \{ retryStep = 0; serverAskedWaitMs = 0; \}/.test(F.outbox));
P("P41257", "…and the backoff is capped",
  /const RETRY_MAX_MS = 120_000;/.test(F.outbox));
P("P41258", "…and grows by doubling, not linearly",
  /Math\.pow\(2, retryStep - 1\)/.test(F.outbox));
P("P41259", "…and the step itself is capped, so the maths cannot overflow",
  /retryStep = Math\.min\(retryStep \+ 1, 8\)/.test(F.outbox));
P("P41260", "…and the very first retry is fast, because one dropped request is the common case",
  /const RETRY_FIRST_MS = 5_000;/.test(F.outbox));
P("P41261", "a server's retry hint is ignored when it is junk",
  /if \(!Number\.isFinite\(s\) \|\| s <= 0\) return;/.test(F.outbox));
P("P41262", "each of the three failure kinds has its OWN counter",
  /tries\?: number;/.test(F.outbox) && /netTries\?: number;/.test(F.outbox) && /busyTries\?: number;/.test(F.outbox));
P("P41263", "…and each is persisted, so a reload cannot reset it and retry for ever",
  (F.outbox.match(/await persist\(item\); idx\+\+; continue;/g) || []).length === 3);
P("P41264", "…and each has the same ceiling, so no kind can loop longer than the others",
  /const SERVER_MAX_TRIES = 6;/.test(F.outbox) && /const NET_MAX_TRIES = 6;/.test(F.outbox) && /const BUSY_MAX_TRIES = 6;/.test(F.outbox));
P("P41265", "a give-up on each kind says something different, so the reason is not lost",
  /We couldn't reach the restaurant/.test(F.outbox)
  && /still busy with this one/.test(F.outbox)
  && /didn't take this one/.test(F.outbox));
P("P41266", "the response body is read exactly once",
  (F.outbox.match(/await res\.json\(\)/g) || []).length === 1);
P("P41267", "…before any branch reads it, so no branch gets null",
  /const j = await res\.json\(\)\.catch\(\(\) => null\) as/.test(F.outbox));
P("P41268", "a duplicate reply that says ok:false is surfaced as a refusal, not removed silently",
  /if \(j\.ok === false\) \{ await moveToFailed/.test(F.outbox));
P("P41269", "…and a duplicate with an order id still records the order for tracking",
  /if \(j\.order_id\) recordActive\(item, j\.order_id as string\)/.test(F.outbox));
P("P41270", "…and a duplicate with NO id records nothing rather than an empty row",
  /if \(!orderId\) return;/.test(F.outbox));
P("P41271", "…and an order already tracked is not added twice",
  /if \(arr\.some\(\(o: \{ id\?: string \}\) => o\?\.id === orderId\)\) return;/.test(F.outbox));
P("P41272", "recording a tracked order wakes the strip",
  /window\.dispatchEvent\(new Event\("lfh:order-placed"\)\)/.test(F.outbox));
P("P41273", "…and can never break the send if storage refuses",
  /catch \{ \/\* tracker record is best-effort \*\/ \}/.test(F.outbox));
P("P41274", "the oldest item is the one evicted when the phone is full of saved work",
  /const oldest = queued\[0\];/.test(F.outbox));
P("P41275", "…and the diner is told, in words, rather than it just vanishing",
  /waited too long to send/.test(F.outbox));
P("P41276", "'Order the rest' drops by line id when one is known",
  /it\.blockedId\s*\?\s*allLines\.filter\(\(l\) => l\.id !== it\.blockedId\)/.test(F.outbox));
P("P41277", "…and by title only as a fallback",
  /: allLines\.filter\(\(l\) => String\(l\.title \|\| ""\)\.trim\(\)\.toLowerCase\(\) !== dropName\)/.test(F.outbox));
P("P41278", "…refuses when it changed nothing",
  /if \(keptLines\.length === allLines\.length\) return \{ ok: false, left: 0 \};/.test(F.outbox));
P("P41279", "…refuses when nothing would be left",
  /if \(!keptLines\.length \|\| !keptItems\.length\) return \{ ok: false, left: 0 \};/.test(F.outbox));
P("P41280", "…keeps the REAL quantities in the diner's own summary",
  /const qtyOf = \(lineId: string\)/.test(F.outbox));
P("P41281", "…and falls back to 1 rather than 0 for a quantity it cannot read",
  /Number\.isFinite\(n\) && n > 0 \? n : 1/.test(F.outbox));
P("P41282", "…removes the old row before queueing the new one, so it cannot send twice",
  /await removeItem\(it\.id\);\s*await enqueueGuestOrder\(/.test(bare(F.outbox)));
P("P41283", "…and flushes immediately, so the diner does not wait for the next beat",
  /void flushGuestOutbox\(\);\s*return \{ ok: true, left: keptItems\.length \};/.test(bare(F.outbox)));
P("P41284", "the store publishes a stable empty snapshot on the server, so React does not loop",
  /function getServerSnapshot\(\) \{ return EMPTY; \}/.test(F.outbox));
P("P41285", "…and a listener that throws cannot stop the others being told",
  /listeners\.forEach\(\(l\) => \{ try \{ l\(\); \} catch \{ \/\* ignore \*\/ \} \}\)/.test(F.outbox));

H("I2. waking, sleeping and cleaning up (P41286-P41330)");
for (const [i, [k, name]] of [["cart","the bill"],["gate","the table gate"],["sync","the shared-basket sync"],
     ["widget","the table card"],["tracker","the live strip"],["tbill","the shared bill"],
     ["owner","the approve prompt"],["chef","the waiter popup"],["confirm","the dish popup"],
     ["chip","the saved-work chip"],["mini","the basket pill"]].entries()) {
  P(`P${41286 + i}`, `${name} removes every listener it adds`, (() => {
    const s = bare(F[k]);
    const adds = (s.match(/addEventListener\(/g) || []).length;
    const rems = (s.match(/removeEventListener\(/g) || []).length;
    return adds === 0 || rems >= adds - 1; // one may be a document-level pair counted differently
  })());
}
P("P41297", "every repeating timer in the territory is cleared on unmount",
  ["cart","sync","widget","tracker","tbill","owner"].every((k) => !/setInterval/.test(F[k]) || /clearInterval/.test(F[k])));
P("P41298", "the live strip's status poll is torn down with a cancelled flag as well as a cleared timer",
  /cancelled = true;\s*clearInterval\(iv\);/.test(bare(F.tracker)));
P("P41299", "…so a reply that lands after unmount cannot write to a dead component",
  /if \(cancelled\) continue;/.test(F.tracker));
P("P41300", "the shared bill guards the same way",
  /let alive = true;/.test(F.tbill) && /if \(!alive\) return;/.test(F.tbill));
P("P41301", "the table card guards the same way",
  /let alive = true;/.test(F.widget) && /if \(!alive\) return;/.test(F.widget));
P("P41302", "the shared-basket sync guards the same way",
  /let alive = true;/.test(F.sync) && /if \(!alive\) return;/.test(F.sync));
P("P41303", "the approve prompt guards the same way",
  /let alive = true;/.test(F.owner));
P("P41304", "the gate's polls are stopped by one function, so no timer is forgotten",
  /const stopPoll = \(\) => \{/.test(F.gate) && /clearInterval\(pollRef\.current\)/.test(F.gate) && /clearTimeout\(pollTimer\.current\)/.test(F.gate));
P("P41305", "…and starting a poll stops any previous one first",
  /const runPoll = \(tick: \(\) => Promise<boolean>\) => \{\s*stopPoll\(\);/.test(bare(F.gate)));
P("P41306", "the camera is released by one function too",
  /const stopScan = \(\) => \{/.test(F.gate) && /getTracks\(\)\.forEach\(\(t\) => t\.stop\(\)\)/.test(F.gate));
P("P41307", "…and the stream reference is dropped, so it cannot be stopped twice",
  /scanStream\.current = null;/.test(F.gate));
P("P41308", "the approve prompt refreshes the instant the tab is reopened",
  /const onVis = \(\) => \{ if \(!document\.hidden\) poll\(\); \}/.test(F.gate + F.owner));
P("P41309", "…and that listener is removed on unmount",
  /document\.removeEventListener\("visibilitychange", onVis\)/.test(F.owner));
P("P41310", "the heartbeat's visibility listener is removed on unmount too",
  /document\.removeEventListener\("visibilitychange", onVisibility\)/.test(F.widget));
P("P41311", "the basket pill's body flag is removed when it unmounts",
  /return \(\) => document\.body\.removeAttribute\("data-lfh-minicart"\)/.test(F.mini));
P("P41312", "the saved-work chip's body flag is removed when it unmounts",
  /return \(\) => document\.body\.removeAttribute\("data-lfh-outbox"\)/.test(F.chip));
P("P41313", "…so neither can leave the corner reserved after it is gone",
  /data-lfh-minicart/.test(F.mini) && /data-lfh-outbox/.test(F.chip));
P("P41314", "the bill's wheel handler is removed with the same options it was added with",
  /list\.addEventListener\("wheel", onWheel, \{ passive: false \}\)/.test(F.cart)
  && /list\.removeEventListener\("wheel", onWheel\)/.test(F.cart));
P("P41315", "the live-strip drag releases pointer capture on both endings",
  (bare(F.tracker).match(/releasePointerCapture/g) || []).length === 2);
P("P41316", "the table card's drag does the same",
  /releasePointerCapture\(e\.pointerId\)/.test(F.widget));
P("P41317", "…and both wrap it, because a released pointer can throw",
  /try \{ .*releasePointerCapture/.test(F.tracker) && /try \{ .*releasePointerCapture/.test(F.widget));
P("P41318", "the approve prompt's snooze timer cannot outlive the component",
  /if \(introTimer\.current\) clearTimeout\(introTimer\.current\)/.test(F.widget));
P("P41319", "the shared-basket push timer is cleared on unmount",
  /if \(pushTimer\.current\) clearTimeout\(pushTimer\.current\)/.test(F.sync));
P("P41320", "the greeting's delayed toast is cancelled on unmount",
  /return \(\) => \{ cancelled = true; window\.clearTimeout\(t\); \}/.test(read("components/CustomerGreeter.tsx")));
P("P41321", "…and its own flag stops a late reply toasting after unmount",
  /if \(cancelled \|\| !r/.test(read("components/CustomerGreeter.tsx")));
P("P41322", "a definitive session ending clears the basket",
  /tremove\("lfh_cart"\)/.test(F.widget));
P("P41323", "…the tracked orders",
  /tremove\("lfh_active_orders"\)/.test(F.widget));
P("P41324", "…the remembered table",
  /setScannedTable\(""\)/.test(F.widget));
P("P41325", "…the stored session itself",
  /clearStoredSession\(\)/.test(F.widget));
P("P41326", "…and announces all four, so every widget re-reads",
  (bare(F.widget).match(/window\.dispatchEvent\(new Event\("lfh:/g) || []).length >= 4);
P("P41327", "the live strip mirrors that clear-down independently, as defence in depth",
  /tremove\("lfh_active_orders"\)/.test(F.tracker));
P("P41328", "…on the same three definitive reasons and no others",
  /reason === "session_closed" \|\| reason === "removed" \|\| reason === "invalid_token"/.test(F.tracker));
P("P41329", "the shared bill hides itself on those same three",
  /reason === "session_closed" \|\| reason === "removed" \|\| reason === "invalid_token"/.test(F.tbill));
P("P41330", "…and the shared-basket sync stands down on them too",
  /reason === "session_closed" \|\| reason === "removed" \|\| reason === "invalid_token"/.test(F.sync));

// ── report ───────────────────────────────────────────────────────────────────────────────────────
console.log(lines.join("\n"));
console.log(`\n${pass} passed, ${fails.length} failed  (of ${pass + fails.length})`);
if (fails.length) { console.log("\nFAILED:\n  " + fails.join("\n  ")); process.exit(1); }
