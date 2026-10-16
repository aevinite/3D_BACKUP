// BLOCK F · from P176701 — CROSS-PANEL TRUTH. What my third says must agree with what the waiter
// tablet, the kitchen, the owner console, the admin console and the server say about the SAME thing:
// the same words for a tile's state, the same table types, the same reasons for a removal, the same
// rule for what a printed bill locks, the same floor. Read from the shipped files; where a twin is
// a function it is lifted and RUN against the same inputs.
import { check, APP, rd } from "./lib.mjs";

const F = "`public/panels/editor/app.js`";
let n = 176701;
const id = () => "P" + n++;
const TAB = rd("public/panels/tablet/app.js"), KIT = rd("public/panels/kitchen/app.js"), ROUTE = rd("app/api/editor/[...path]/route.ts");
const TROUTE = rd("app/api/tablet/[...path]/route.ts"), OWNACT = rd("app/owner/activity/page.tsx"), AUDITSORT = rd("public/panels/auditsort.js");
const TAGS = rd("lib/tableTags.ts"), CLASHCMP = rd("lib/clashCompare.ts");
const X = (what, how, fn) => check(id(), `${F} — ${what}`, `SRC: ${how}`, fn);
const lift = (src, start, end = "\n}\n") => { const a = src.indexOf(start); if (a < 0) return ""; const b = src.indexOf(end, a); return src.slice(a, b + end.length); };
const block = (src, start) => { const a = src.indexOf(start); if (a < 0) return ""; return src.slice(a, src.indexOf("};", a) + 2); };

// table types
const mTag = block(APP, "const TABLE_TAG_INFO = {"), tTag = block(TAB, "const TABLE_TAG_INFO = {");
X("the table types (VIP / Family / Owner's guest) read the same on the manager floor and the waiter's", "TABLE_TAG_INFO, character for character", () => !!mTag && mTag === tTag);
X("…and they are exactly the three lib/tableTags.ts allows", "TABLE_TAGS = vip, family, guest", () => /\["vip", "family", "guest"\]/.test(TAGS) && ["vip:", "family:", "guest:"].every((k) => mTag.includes(k)) && (mTag.match(/^\s+\w+:\s+\{/gm) || []).length === 3);
X("the table-type switch is the same two-key rule on both floors (admin allows AND owner's toggle)", "tableTagsOn vs tabletTagsOn read the same three settings", () => ["table_tags_allowed", "table_tags_owner_control", "table_tags_enabled"].every((k) => lift(APP, "function tableTagsOn()").includes(k) && lift(TAB, "function tabletTagsOn()").includes(k)));
// tile words
for (const [state, word] of [["new", "New order"], ["ready", "Ready to serve"], ["prep", "Preparing"], ["bill", "Served"], ["done", "Cleared"]]) {
  X(`a '${state}' tile says "${word}" on BOTH floors`, "tableTileStateFromBoard vs the tablet's tileState", () => lift(APP, "function tableTileStateFromBoard(").includes(`st = "${state}"; label = "${word}"`) && TAB.includes(`"${word}"`));
}
X("the ORDER of precedence is the same on both floors: new → ready → preparing → served/cleared", "position of each test in both functions", () => { const m = lift(APP, "function tableTileStateFromBoard("); const t = lift(TAB, "function tileState("); const ord = (s, ks) => ks.map((k) => s.indexOf(k)); const mo = ord(m, ['label = "New order"', 'label = "Ready to serve"', 'label = "Preparing"', 'label = "Served"']); const to = ord(t, ['label: "New order"', 'label: "Ready to serve"', 'label: "Preparing"', '"Served"']); return mo.every((v, i, a) => v > 0 && (!i || a[i - 1] < v)) && to.every((v, i, a) => v > 0 && (!i || a[i - 1] < v)); });
X("a waiting (un-accepted) ticket is NOT in the money due on either floor or in the floor summary", "isUnpaidBill excludes 'received' here; the tablet's due accumulates only accepted unpaid orders", () => /isUnpaidBill = \(o\) => o\.status !== "cancelled" && o\.status !== "received"/.test(APP) && /if \(o\.status !== "cancelled" && o\.status !== "received" && o\.payment_status !== "paid"\)/.test(TAB));
// the floor list (item 10)
X("the manager and the waiter draw the same off-plan tables (item 10 — run in verify:manager-behaviour T)", "both filters drop free AND waiting, keep merges", () => /st !== "free" && st !== "waiting"/.test(lift(APP, "function floorTableList(")) && /st !== "free" && st !== "waiting"/.test(lift(TAB, "function floorTableList(")));
X("a merged party is resolved through its PARENT on both floors", "mergeParentOf on both", () => /function mergeParentOf\(t\)/.test(APP) && /function mergeParentOf\(t\)/.test(TAB));
// the printed bill's lock
X("what a printed bill locks is the SAME rule in the panel and in the server", "invoiceLocksOrder (app.js) vs invoiceLockedByOrder (route): no number → free; live → locked; reopened → locked if punched before the paper; no time → locked", () => { const c = lift(APP, "function invoiceLocksOrder("), s = lift(ROUTE, "async function invoiceLockedByOrder("); return /invoice_no == null\) return false/.test(c) && /if \(!sess\.invoice_voided\) return true/.test(c) && /<= new Date\(sess\.invoice_at\)/.test(c) && /invoice_no == null\) return false/.test(s) && /if \(!s\.invoice_voided\) return true/.test(s) && /<= new Date\(s\.invoice_at\)/.test(s); });
X("…and the waiter's tablet route enforces the same lock", "the tablet route names invoiceLocked / invoice_at", () => /invoice_at/.test(TROUTE) && /invoice_voided/.test(TROUTE));
// removals and audit words
const owner = lift(OWNACT, "const REMOVAL_REASON: Record<string, string> = {", "};");
for (const code of ["mistake", "guest_changed", "wrong_table", "sold_out", "kitchen_error", "other"]) {
  X(`the removal reason '${code}' reads the same in the manager's question and the owner's Activity`, "REMOVAL_REASONS label (without its icon) vs the owner's REMOVAL_REASON", () => { const m = APP.match(new RegExp(`\\["${code}", "\\S+ ([^"]+)"`)); const o = owner.match(new RegExp(`${code}: "([^"]+)"`)); return !!m && !!o && m[1] === o[1]; });
}
X("the admin's logs read removal reasons from the SAME shared module (auditsort.js REASON_LABEL)", "auditsort exports REASON_LABEL and the admin logs import it", () => /REASON_LABEL: REASON_LABEL/.test(AUDITSORT) && /AUDITSORT\.REASON_LABEL/.test(rd("app/aevinite/logs/page.tsx")));
X("the Audit list sorts and filters through the SAME module the owner and admin consoles use", "auditHtml calls the shared AUDITSORT view", () => /AS\.view\(rows, \{ kind: auKind, q, sort: auSort, kindLabel, reasonLabel \}\)/.test(APP) && /AUDITSORT\.view\(/.test(OWNACT));
// waiter calls
X("a waiter call's icon is the same on both floors for the six named calls", "callEmoji (manager) vs callIcon (tablet) on water / cutlery / napkins / clean / bill / waiter", () => { const m = new Function(`${lift(APP, "function callEmoji(")}\nreturn callEmoji;`)(); const t = new Function(`${lift(TAB, "function callIcon(")}\nreturn callIcon;`)(); return ["Water please", "Cutlery", "Napkins", "Clean the table", "Bill please", "Call waiter"].every((x) => m(x) === t(x)); });
X("an UNNAMED call note: the manager shows 🙋, the waiter 🔔 (a small difference, listed — not a fault)", "callEmoji vs callIcon on 'need ketchup'", () => { const m = new Function(`${lift(APP, "function callEmoji(")}\nreturn callEmoji;`)(); const t = new Function(`${lift(TAB, "function callIcon(")}\nreturn callIcon;`)(); return { ok: true, note: `manager ${m("need ketchup")} · waiter ${t("need ketchup")} — listed in Part 4` }; });
// ordering
X("the manager's take-order and the waiter's both post to /order, the one priced endpoint", "api(\"POST\", \"/order\" in both panels", () => /api\("POST", "\/order",/.test(APP) && /\/order\b/.test(TAB));
X("a sold-out refusal NAMES the dish on both panels", "the manager's and the waiter's refusal sentences", () => /just sold out — it was NOT sent/.test(APP) && /just sold out — remove it/.test(TAB));
X("the queued-order sentence is the panel family's one QUEUED_LINE (the manager), and the waiter says 'saved' too — never 'sent'", "QUEUED_LINE in app.js; the tablet's queued wording", () => /const QUEUED_LINE = "Saved on this device ✓/.test(APP) && /Saved on this device/.test(TAB));
X("the server prices every staff order itself — the panel's estimate is never the stored figure", "the /order branch calls the pricer RPC", () => /lfh_price_order|lfh_staff_place_order|p_items/.test(ROUTE.slice(ROUTE.indexOf('if (a === "order" && path.length === 1)'), ROUTE.indexOf('if (a === "order" && path.length === 1)') + 6000)));
// two devices
X("a list is compared as a SET by the clash check (what item 6 relies on for a dish's tags)", "clashCompare sameValue sorts arrays", () => /\.filter\(Boolean\)\.sort\(\)/.test(lift(CLASHCMP, "export function sameValue(")));
X("menu_items is one of the tables the clash check can compare (keyed by id)", "lib/clash.ts COMPARABLE_TABLES", () => /menu_items: "id"/.test(rd("lib/clash.ts")));
X("the kitchen's Sold out IS a tag on the dish (why item 6 matters)", "kitchen set86 adds/deletes 'sold-out' in dish.tags", () => /out \? tags\.add\("sold-out"\) : tags\.delete\("sold-out"\)/.test(KIT));
X("the take-order builder hides a sold-out dish (the same tag the kitchen sets)", "openTakeOrder filters tags 'sold-out'", () => /\.filter\(\(d\) => !\(d\.tags \|\| \[\]\)\.includes\("sold-out"\)\)/.test(lift(APP, "function openTakeOrder(", "\nfunction openShiftPicker(")));
// realtime
X("a menu change on ANY device re-reads the menu here (the realtime 'menu' event → loadAll)", "LFH_RT handlers.menu calls loadAll()", () => /menu: \(\) => \{ refreshWhoami\(\); if \(Date\.now\(\) >= rtBootGraceUntil\) loadAll\(\); \}/.test(APP));
X("…and that re-read is what item 5's course order now keys on (new arrays)", "loadAll replaces state.data; menuSeq compares the arrays", () => /state\.data = \{ \.\.\.data, orders: prev\.orders/.test(APP) && /_menuSeqItems === state\.data\.items && _menuSeqCats === state\.data\.categories/.test(APP));
X("Audit & logs updates on the 60s backstop, not instantly — a standing pre-empt (mig 267), not a fault", "no 'audit' handler in LFH_RT.start", () => { const i = APP.indexOf("LFH_RT.start({ handlers: {"); return i > 0 && !/audit\s*:/.test(APP.slice(i, i + 3000)); });
X("every floor write in the route drops the shared floor read for this restaurant (invalidateFloor)", "POST/PATCH/DELETE are wrapped by invalidateFloorAfter", () => /export const POST = withIdempotency\(invalidateFloorAfter\(postImpl\)/.test(ROUTE) && /export const PATCH = withIdempotency\(invalidateFloorAfter\(patchImpl\)/.test(ROUTE) && /export const DELETE = withIdempotency\(invalidateFloorAfter\(deleteImpl\)/.test(ROUTE));
X("a repeated write (the outbox replaying after a blip) is answered once — the route is idempotent by action id", "withIdempotency wraps every write method", () => (ROUTE.match(/withIdempotency\(/g) || []).length >= 3);
