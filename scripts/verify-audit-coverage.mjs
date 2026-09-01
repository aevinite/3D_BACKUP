#!/usr/bin/env node
// verify-audit-coverage.mjs — every change that lowers a bill must leave an Audit record.
//
// WHY THIS EXISTS. Migration 251 built the Removals record and named five kinds. Only TWO were
// ever written, and the BROWSER wrote them, so the ones app.js forgot were recorded nowhere: a
// dish taken off an order, a reopened bill, a deleted menu item — and the waiter panel recorded
// nothing at all. Every check below is one of those, turned into a test so it cannot come back.
//
// Static + instant, so it runs in the same breath as the other verify scripts.
// Run: node scripts/verify-audit-coverage.mjs   (or npm run verify:audit)
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
// The shared bill money itself, so the stamped-rate rule can be ASKED rather than grepped for.
import BILLDOC from "../public/panels/billdoc.js";
// The ONE map of removal words, read the same way the owner and admin screens read it.
import AUDITSORT from "../public/panels/auditsort.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => { try { return readFileSync(join(root, p), "utf8"); } catch { return ""; } };

// A migration's NUMBER is not an identifier: parallel branches get RENUMBERED on merge (18 numbers
// are already duplicated on main), and a guard that hard-codes a filename breaks for everyone the
// moment someone else's migration lands first — which is exactly what happened to
// verify-owner-reports.mjs (fixed in c9eff489). So find the migration by its CONTENT.
const migrationSrcWith = (needle) => {
  try {
    const dir = join(root, "supabase/migrations");
    return readdirSync(dir).filter((f) => f.endsWith(".sql"))
      .map((f) => readFileSync(join(dir, f), "utf8"))
      .filter((sql) => sql.includes(needle)).join("\n");
  } catch { return ""; }
};
const fails = [];
const oks = [];
const ok = (m) => oks.push(m);
const fail = (m) => fails.push(m);

// HOOK MODE (--hook): the harness pipes the tool call in on stdin after every edit. Stay silent
// when clean; exit 2 with an explanation to refuse the edit. Same contract as the sibling guards
// (verify-ui-integrity.mjs, verify-tap-guard.mjs) so they share one hook. Only the files that can
// actually break this are worth checking, so an unrelated edit costs nothing.
const HOOK = process.argv.includes("--hook");
if (HOOK) {
  let touched = null;
  try {
    const j = JSON.parse(readFileSync(0, "utf8") || "{}");
    touched = (j.tool_input && (j.tool_input.file_path || j.tool_input.path)) || null;
  } catch { /* unreadable input → run everything, better than skipping */ }
  const RELEVANT = /(app\/api\/|lib\/(removalAudit|sessionClose|oplog)\.ts|public\/panels\/editor\/app\.js|components\/admin\/shared\.tsx|app\/aevinite\/(logs|repair|bill-audit)\/page\.tsx|app\/owner\/activity\/page\.tsx)/;
  if (touched && !RELEVANT.test(touched)) process.exit(0);
}

const editor = read("app/api/editor/[...path]/route.ts");
const tablet = read("app/api/tablet/[...path]/route.ts");
const lib = read("lib/removalAudit.ts");
const panel = read("public/panels/editor/app.js");
const adminPage = read("app/aevinite/logs/page.tsx");
const ownerPage = read("app/owner/activity/page.tsx");
const closeLib = read("lib/sessionClose.ts");
const adminBills = read("app/api/admin/bills/route.ts");

// ── 1 · the recorder is SERVER-side, and the panel no longer writes records ───
if (!lib.includes("lfh_record_removal")) fail("lib/removalAudit.ts no longer calls lfh_record_removal — nothing would be recorded");
else ok("one shared server-side recorder (lib/removalAudit.ts → lfh_record_removal)");

if (/api\(\s*["']POST["']\s*,\s*["']\/audit["']/.test(panel))
  fail("the manager panel POSTs /audit again — recording from the browser is what left four kinds unwritten; record it in the endpoint instead");
else ok("the manager panel does not record removals itself");

// ── 2 · every money-lowering endpoint records ────────────────────────────────
// Each entry: a marker that identifies the handler, and the kind it must record.
const MUST_RECORD = [
  ["editor", editor, 'a === "items" && c === "delete"', "dish_removed", "removing one dish from an order"],
  ["editor", editor, 'a === "items" && c === "qty"', "qty_reduced", "lowering a dish's quantity"],
  ["editor", editor, 'c === "void-invoice"', "invoice_voided", "reopening a settled bill"],
  ["editor", editor, 'c === "discount"', "discount_given", "discounting a bill"],
  ["tablet", tablet, 'a === "items" && c === "delete"', "dish_removed", "a waiter removing a dish"],
];
// "On the house" is matched on the whole file: its handler is long and its marker sits far from
// the record (an offset window would be brittle).
if (/kind:\s*"on_the_house"/.test(editor)) ok('settling on the house records "on_the_house"');
else fail('settling on the house does NOT record "on_the_house" — a bill settled with no money would leave no Audit row');
for (const [where, src, marker, kind, label] of MUST_RECORD) {
  const at = src.indexOf(marker);
  if (at < 0) { fail(`could not find the ${where} handler for ${label} (looked for \`${marker}\`) — if it moved, update this guard`); continue; }
  // Look inside the handler: from its marker to the next ~4500 chars is comfortably one block.
  const block = src.slice(at, at + 6500);
  if (new RegExp(`recordRemoval\\([\\s\\S]{0,400}?kind:\\s*"${kind}"`).test(block)) ok(`${label} records "${kind}" (${where})`);
  else fail(`${label} does NOT record "${kind}" in the ${where} route — the change would leave no Audit row`);
}
// These two live further from their marker, so they are matched on the whole file.
for (const [kind, label] of [["payment_reverted", "reverting a payment"], ["order_cancelled", "cancelling a ticket"], ["order_deleted", "deleting a bill"], ["menu_item_deleted", "deleting a menu item"]]) {
  if (new RegExp(`kind:\\s*"${kind}"`).test(editor)) ok(`${label} records "${kind}"`);
  else fail(`${label} does NOT record "${kind}" — the change would leave no Audit row`);
}

// ── 2b · THE WAITER TABLET LOWERS MONEY TOO (2026-08-03) ─────────────────────
// PR #727 moved recording server-side but only finished the manager's half: the tablet recorded a
// removed dish and nothing else, so a waiter could discount a bill, halve a quantity, delete a
// bill, settle on the house or un-mark a payment and the Removals record stayed empty. Each of
// these is the waiter twin of a manager path already checked above.
const TABLET_MUST = [
  ['a === "items" && c === "qty"', "qty_reduced", "a waiter lowering a dish's quantity"],
  ['a === "orders" && c === "discount"', "discount_given", "a waiter discounting one ticket"],
  ['a === "sessions" && c === "bill-discount"', "discount_given", "a waiter discounting the whole bill"],
  ['a === "orders" && c === "delete"', "order_deleted", "a waiter deleting a bill"],
  ['a === "tables" && c === "on-the-house"', "on_the_house", "a waiter settling on the house"],
  ['a === "tables" && c === "unpay"', "payment_reverted", "a waiter un-marking a bill as paid"],
];
for (const [marker, kind, label] of TABLET_MUST) {
  const at = tablet.indexOf(marker);
  if (at < 0) { fail(`could not find the tablet handler for ${label} (looked for \`${marker}\`) — if it moved, update this guard`); continue; }
  const block = tablet.slice(at, at + 6000);
  if (new RegExp(`recordRemoval\\([\\s\\S]{0,400}?kind:\\s*"${kind}"`).test(block)) ok(`${label} records "${kind}" (tablet)`);
  else fail(`${label} does NOT record "${kind}" in the tablet route — money would come off a bill with no Audit row`);
}

// ── 2c · a bill that was never generated cannot be "reopened" ────────────────
// lfh_void_invoice no-ops when there is no invoice, but the route recorded anyway: tapping Reopen
// on a table with no bill answered "done" and wrote "Bill reopened · ₹460" for an event that never
// happened (found 2026-08-03 by driving it on Aangan). An audit that invents an event is worse
// than no audit, and a tap that changed nothing must never look like it worked.
if (/hasn't been generated yet, so there's nothing to reopen/.test(editor)) ok("reopening a bill that was never generated is refused, not recorded");
else fail("void-invoice no longer refuses a session with no invoice — a phantom \"Bill reopened\" row would be written for a tap that did nothing");

// ── 2d · closing a table on an unpaid bill is a write-off, and is recorded ───
// The single largest money-lowering event in the product: "close anyway" cancels every unpaid
// order. It lived only in the activity log, where nobody looking at "what was removed" finds it.
if (/recordRemoval\([\s\S]{0,600}?kind:\s*"order_cancelled"/.test(closeLib) && /closed_unpaid:\s*true/.test(closeLib))
  ok("closing a table with an unpaid bill records the write-off in the Audit");
else fail("closeSession no longer records the unpaid orders it cancels — a walk-out would leave no Audit row");

// ── 2e · the admin's own bill ledger records what it deletes ─────────────────
if (/recordRemoval\([\s\S]{0,400}?kind:\s*"order_deleted"/.test(adminBills))
  ok("the admin bill ledger records a deleted bill in the Audit");
else fail("the admin bill ledger deletes bills without an Audit row — the admin must be recorded exactly like everyone else");

// ── 2f · the ACTIVITY log next to it reads as English, not as database keys ──
// The Removals record was perfect while its neighbour — the Activity log in the same "Audit &
// logs" tab — printed the raw action code for anything its map missed: `order_item_qty`,
// `invoice_void`, `order_delete`, `menu_delete`, sitting between "Placed order" and "Signed in"
// (found 2026-08-03 by screenshotting the tab, not by reading the map). The manager panel's copy
// held 19 of ~130 codes. Three checks keep it honest.
{
  const shared = read("components/admin/shared.tsx");
  const panelJs = panel;
  const keysOf = (src, marker) => {
    const at = src.indexOf(marker);
    if (at < 0) return null;
    const end = src.indexOf("\n};", at);
    return new Set([...src.slice(at, end).matchAll(/(?:^|[{,\s])([a-z][a-z0-9_]*)\s*:/g)].map((m) => m[1]));
  };
  const sharedKeys = keysOf(shared, "export const ACT_LABEL: Record<string, string> = {");
  const panelKeys = keysOf(panelJs, "const OP_ACTION_LABELS = {");

  // Every action code the code can actually WRITE. logAction("panel","action") / log("panel",
  // "action") / the tablet+kitchen's log("action") — the panel names are subtracted.
  const PANEL_NAMES = new Set(["editor", "manager", "kitchen", "tablet", "owner", "admin", "guest", "db", "menu"]);
  const written = new Set();
  const scan = (dir) => {
    for (const e of readdirSync(join(root, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) { if (e.name !== "node_modules") scan(rel); continue; }
      if (!/\.(ts|tsx)$/.test(e.name)) continue;
      const body = read(rel);
      for (const m of body.matchAll(/\blog(?:Action)?\(\s*"([a-z0-9_]+)"\s*,\s*(?:"([a-z0-9_]+)"\s*,)?/g)) {
        if (m[2]) written.add(m[2]);
        else if (!PANEL_NAMES.has(m[1])) written.add(m[1]);
      }
      // A TERNARY second argument writes TWO codes and the literal pattern above sees NEITHER.
      // Twelve codes hid behind this for months — `active ? "staff_enable" : "staff_disable"`
      // had a label for the false branch only, so "Staff enable" printed as a prettified
      // database key beside real sentences (T15 sweep, 2026-08-05). Read both branches.
      // Two shapes: logAction(panel, cond ? "a" : "b", …) and the panels' log(cond ? "a" : "b", …).
      // `[^,;){:]` keeps the run before the `?` inside the ARGUMENT — without excluding `{` and `:`
      // it walked into a later `{ detail: value ? "on" : "off" }` and recorded "on"/"off" as codes.
      for (const re of [/\blog(?:Action)?\(\s*[^,]+,\s*[^,;){:]*?\?\s*"([a-z0-9_]+)"\s*:\s*"([a-z0-9_]+)"/g,
                        /\blog(?:Action)?\(\s*[^,;){:"]*?\?\s*"([a-z0-9_]+)"\s*:\s*"([a-z0-9_]+)"/g]) {
        for (const m of body.matchAll(re)) { written.add(m[1]); written.add(m[2]); }
      }
    }
  };
  scan("app"); scan("lib");

  if (!sharedKeys || !panelKeys) fail("could not find ACT_LABEL / OP_ACTION_LABELS — if either moved, update this guard");
  else {
    const missShared = [...written].filter((k) => !sharedKeys.has(k)).sort();
    const missPanel = [...written].filter((k) => !panelKeys.has(k)).sort();
    if (missShared.length) fail(`action codes with no label on the admin/owner screens (they render as raw keys): ${missShared.join(", ")}`);
    else ok(`all ${written.size} action codes have a plain-English label on the admin/owner screens`);
    if (missPanel.length) fail(`action codes with no label in the MANAGER panel's Activity log: ${missPanel.join(", ")}`);
    else ok("…and every one of them has a label in the manager panel too");
    const drift = [...sharedKeys].filter((k) => panelKeys.has(k) === false);
    if (drift.length > 0 && drift.length === sharedKeys.size) fail("the manager panel's label map is unrelated to the shared one — regenerate it");
  }
  // A missing label must never reach the screen as a raw key: both sides prettify.
  if (/export function actLabel\(/.test(shared)) ok("the admin/owner screens prettify an unknown action code instead of printing it raw");
  else fail("actLabel() is gone from components/admin/shared.tsx — an unlabelled action would print its raw database key");
  if (/function actLabel\(code\)/.test(panelJs)) ok("…and so does the manager panel");
  else fail("actLabel() is gone from the manager panel — an unlabelled action would print its raw database key");
  if (/ACT_LABEL\[[a-z.]+\.action\] \|\| [a-z]+\.action/.test(read("app/aevinite/logs/page.tsx") + read("app/owner/activity/page.tsx")))
    fail("a log screen still renders `ACT_LABEL[x] || x` — that is the fallback that prints raw codes; call actLabel(x)");
  else ok("no log screen falls back to printing the raw code");
  // ── AND THE SCREEN HAS TO ACTUALLY CALL IT (T15 improvement 2, 2026-08-14) ──────────────────
  // Everything above proves a LABEL EXISTS for every action code. It never proved a screen USES
  // one — and that is exactly how the bug shipped: app/owner/page.tsx's "Recent activity" card
  // rendered `{a.action}` and `{a.panel}` bare, so the owner's home screen showed `order_place`
  // and `editor` while /owner/activity one click away showed "Placed order" and "Manager panel".
  // This guard was green the whole time, because it was reading the dictionary and not the page.
  //
  // So: no React screen may print a row's `.action` or `.panel` straight into JSX. Both
  // translators (actLabel / panelLabel) are exported from components/admin/shared.tsx and cost one
  // word at the call site. If this fires on a new file, wrap the value — do not widen the pattern
  // to excuse it.
  const RAW_ACTION = /\{\s*([a-z]|[a-z]\w*)\.(action|panel)\s*\}/g;   // {a.action} / {row.panel}
  const screens = [
    "app/owner/page.tsx", "app/owner/activity/page.tsx", "app/aevinite/logs/page.tsx",
    "components/admin/LogDetailModal.tsx", "components/admin/shared.tsx",
  ];
  const rawHits = [];
  for (const f of screens) {
    const src = read(f);
    if (!src) continue;
    for (const rawLine of src.split("\n")) {
      // STRIP the places where a raw key is legitimately a CSS hook or an attribute value, then
      // look at what is LEFT — which is the text a person actually reads.
      //
      // This used to `continue` on any line containing `className`, and that made the whole guard
      // useless: the bug it was written for lived on
      //     <span className="tx">{a.action}{a.table_number ? …}</span>
      // — a line with a className on it. Skipping the line skipped the bug. (Proven by putting the
      // bug back and watching this stay green.) Strip, don't skip.
      const line = rawLine
        .replace(/className=\{[^}]*\}/g, "")   // className={`pn pn-${a.panel}`}
        .replace(/className="[^"]*"/g, "")      // className="tx"
        .replace(/`[^`]*`/g, "")                // any other template literal
        .replace(/\b(aria-[a-z]+|data-[a-z-]+|key|title|id)=\{[^}]*\}/g, "");
      if (!line.trim()) continue;
      // TWO SHAPES ARE CORRECT, and both were found by this guard's very first run — so they are
      // written down here rather than left for the next person to re-investigate:
      //  · `trail.panel` / `trail.action` — lib/logTrail.ts's trailOf() has ALREADY translated
      //    these (`panel: panelName(row.panel)`), so the value in hand is "Manager panel", not
      //    "editor". Wrapping it again would be wrong, not right.
      //  · a `mono` field — components/admin/LogDetailModal.tsx deliberately shows the raw code
      //    under a "Reference" heading labelled "Action code", beside the log id, for support.
      //    That is the ONE place a person is meant to see the key, and it says so on the label.
      // Anything else printing .action/.panel bare is the bug this guard exists for.
      if (/\btrail\.(action|panel)\b/.test(line)) continue;
      if (/\bmono\b/.test(line)) continue;
      const m = line.match(RAW_ACTION);
      if (m) rawHits.push(`${f}: ${m.join(", ")}`);
    }
  }
  if (rawHits.length) fail(`a screen prints a raw action/panel key instead of calling actLabel()/panelLabel(): ${rawHits.join(" · ")}`);
  else ok("no screen renders a row's action or panel key raw — every one goes through actLabel()/panelLabel()");
  // The "Where" column must never print stored JSON: the tap batches are formatted on BOTH sides.
  if (/function opDetailText\(/.test(panelJs) && /opDetailText\(r\.action, r\.detail\)/.test(panelJs))
    ok("the manager panel turns a stored tap batch into readable words, not JSON");
  else fail("the manager panel prints r.detail raw — a ui_taps row would show [{\"t\":3,\"l\":\"Close\"}] on screen");
  // The bill trail's "Where" column must name the table + bill, not a session uuid.
  if (/detail: `session \$\{b\}/.test(editor))
    fail("an invoice log line still writes `session <uuid>` as its detail — the Activity log's Where column must name the table and bill");
  else ok("the invoice log lines name the table and the bill, not a session id");
}

// ── 3 · every kind the recorder can write has a LABEL in all three panels ────
const kinds = [...lib.matchAll(/^\s*\|\s*"([a-z_]+)"/gm)].map((m) => m[1]);
if (kinds.length < 8) fail(`only found ${kinds.length} kinds in RemovalKind — the list looks truncated`);
else {
  // A screen may either LIST every kind itself, or derive its labels from the one shared map in
  // RemovalDetail (`KIND_LABEL`). Deriving is stronger than listing — it cannot fall behind — so
  // it counts as covered. Before the T15 sweep there were three hand-written maps and the owner's
  // row and the card it opened disagreed on six of the nine kinds.
  // DERIVING IS NOW REQUIRED, NOT MERELY ACCEPTED (T7 pass 2, 2026-08-12).
  // This used to let a screen EITHER derive from the shared map or list every kind itself. Two of the
  // three listed — and drifted: SIX of the eleven types were named differently in each, so one
  // database row read "Bill reopened" to the owner and "Invoice voided" to the manager looking at the
  // same removal, whose own button says "Reopen bill". Listing is what allowed that, so listing is no
  // longer a pass. The words live in /panels/auditsort.js (a plain-JS module the manager panel can
  // load as a bare <script>) and all three read them.
  const derives = (src) =>
    (/KIND_LABEL/.test(src) && /Object\.(keys|fromEntries)\s*\(/.test(src))
    || /LFH_AUDITSORT/.test(src);          // the manager panel's door onto the same map
  const missing = [];
  for (const [name, src] of [["manager panel", panel], ["admin page", adminPage], ["owner page", ownerPage]]) {
    if (derives(src)) continue;
    missing.push(`${name} writes its own list of removal names instead of reading /panels/auditsort.js — that is how six of eleven ended up with a different name per panel`);
  }
  if (missing.length) fail(`kinds with no label — they render as a raw key like "qty_reduced": ${missing.join(", ")}`);
  else ok(`all ${kinds.length} kinds have a label in the manager, admin and owner views`);

  // …AND THE SHARED MAP ITSELF HAS WORDS FOR EVERY KIND (T9 sweep #7, 2026-08-22).
  //
  // The check above proves all three screens read the ONE map. It never asked whether the map has
  // an entry for each kind the recorder can write — so `customer_erased` (owner → Customers → Erase)
  // sat in KIND_RISK and KIND_TAGS with no words and no glyph, and every screen dutifully printed
  // the raw code "customer_erased". Worse, the owner's Activity and the admin's Logs both build
  // their type chips from `Object.keys(KIND_LABEL)`, so the row could not be filtered by type at
  // all. Deriving from a shared map only helps if the map is complete.
  const A = AUDITSORT;
  if (!A || !A.KIND_LABEL) fail("public/panels/auditsort.js did not load — the shared removal words could not be checked");
  else {
    const noWords = kinds.filter((k) => !A.KIND_LABEL[k]);
    const noGlyph = kinds.filter((k) => !A.KIND_ICON[k]);
    if (noWords.length) fail(`public/panels/auditsort.js has no WORDS for ${noWords.join(", ")} — the Activity and Logs screens print the raw code, and offer no chip for it`);
    else ok(`the shared removal map has English words for all ${kinds.length} kinds the recorder can write`);
    if (noGlyph.length) fail(`public/panels/auditsort.js has no glyph for ${noGlyph.join(", ")}`);
    else ok("…and a glyph for each of them");
  }
}

// ── 4 · recording a removal is never gated by a menu switch ──────────────────
// Switching the Audit menu off must not stop the RECORD being written — that would quietly end
// the compliance trail. The tab gate covers GET only.
if (/\(\(p === "audit" \|\| p === "users"\) && method === "GET"\)/.test(editor))
  ok("the Audit menu gate covers reads only — recording a removal is never refused");
else fail("the Audit menu gate no longer limits itself to GET — switching the menu off could stop removals being recorded");

// ── 5 · the live floor is not gated by the MENU EDITOR switch ────────────────
// `items` means two things: a menu dish, and a dish on a live order. Gating both behind Edit-menu
// stopped a manager marking food served, removing a cancelled dish and fixing a quantity — the
// floor, refused with "the menu editor isn't part of this restaurant's manager panel" (Aangan,
// 2026-08-02, which has Edit menu off).
if (/ORDER_ITEM_ACTION\s*=\s*\/\^items\\\/\[\^\/\]\+\\\/\(delete\|qty\|note\|removed\|status\)\$\//.test(editor))
  ok("live-order dish actions are excluded from the menu-editor gate");
else fail("the menu-editor gate no longer excludes live-order dish actions — switching Edit menu off would break serving food and fixing an order");

if (/tab: "editor", test: \(p\) => .*ORDER_ITEM_ACTION/.test(editor)) ok("…and the editor tab row applies that exclusion");
else fail("the editor tab row does not use ORDER_ITEM_ACTION — the exclusion is not wired in");

// ── 6 · cancelling a ticket is not behind Reopen-a-bill ─────────────────────
// Both hung off void_bills; when Reopen went OFF by default (owner, 2026-08-02) a manager could no
// longer clear a walk-out or a mistaken ticket at all.
if (/patch\.status === "cancelled" && cur\.status !== "cancelled" && !\(await managerCan\(g, rid, "void_bills"\)\)/.test(editor))
  fail("cancelling a ticket is gated by void_bills again — with Reopen-a-bill OFF by default that leaves a manager unable to clear a walk-out");
else ok("cancelling a ticket is not gated by Reopen-a-bill (it is recorded instead)");

if (/selector: "\[data-cancel-order\]", flag: "void_bills"/.test(panel))
  fail("the panel hides ✕ Cancel behind void_bills again — the button would vanish for every restaurant on the default");
else ok("the panel shows ✕ Cancel without the void_bills power");

// ── A DELETED BILL LEAVES THE PANEL, BUT NEVER THE RECORDS (owner, 2026-08-04) ─────────────
// "It will show only to admin — it will delete from manager and stuff like that." It did not:
// softDeleteOrders stamps deleted_at AND archived, the manager's buckets read archived as
// "freed", so a deleted bill simply moved into the Bills record and stayed readable, printable
// and restorable by whoever deleted it. The panel has never referenced deleted_at at all.
{
  const editorRoute = read("app/api/editor/[...path]/route.ts");
  // The working list hides them...
  /let oq = sb\s*\n?\s*\.?from\("orders"\)[\s\S]{0,400}?oq\.is\("deleted_at", null\)|oq = oq\.is\("deleted_at", null\)/.test(editorRoute)
    ? ok("the manager's bills/board read hides a deleted bill (only the admin ledger shows it)")
    : fail("the manager panel can see deleted bills again — add .is(\"deleted_at\", null) to the /orders read");
  // ...but the RECORDS must still contain them. Hiding a sale from the OPERATOR is a permissions
  // decision; hiding it from the day-close or the tax return is the illegal one.
  const zSlice = editorRoute.slice(editorRoute.indexOf('if (p === "zreport")'), editorRoute.indexOf('if (p === "gst-report")'));
  // WHAT MATTERS IS THE FILTER, NOT THE WORD (T7, 2026-08-06). This banned the string `deleted_at`
  // anywhere in the Z-report block, which is a proxy for the real rule and it went wrong the first
  // time the sheet had an honest reason to READ that column: the day's numbering section names WHY a
  // bill number is flagged, and "deleted" is one of the answers. Selecting the column explains a
  // number; only a WHERE clause could shrink the takings. So the ban is now on the filter forms —
  // which is the thing COMPLIANCE §3 actually forbids here.
  const zFilters = /\.is\(\s*"deleted_at"\s*,\s*null\s*\)|\.not\(\s*"deleted_at"\s*,\s*"is"\s*,\s*null\s*\)|deleted_at\s*(?:is\s+)?(?:=|IS)\s*null/i.test(zSlice);
  zSlice && !zFilters
    ? ok("the Z-report still counts deleted bills (a delete may never shrink the day's takings)")
    : fail("the Z-report now FILTERS on deleted_at — docs/COMPLIANCE-GUARDRAILS.md requires voids and deletes to be included");
  // And specifically the query the MONEY is summed from: the paged read of the day's orders.
  const zOrders = zSlice.slice(zSlice.indexOf('from("orders")'), zSlice.indexOf('const [invQ'));
  zOrders && !/deleted_at/.test(zOrders)
    ? ok("  …and the day's ORDERS read — the one the takings are summed from — is unfiltered")
    : fail("the Z-report's orders read now mentions deleted_at — the takings must include deleted bills");
  // Only the admin can put one back, and must be able to find it whatever its age.
  const ledger = read("app/api/admin/bills/route.ts");
  /stateFilter === "deleted"\)\s*sq = sq\.not\("deleted_at", "is", null\)/.test(ledger)
    ? ok("the admin ledger asks the DATABASE for deleted bills (not the newest page, then sieved)")
    : fail("the admin ledger filters deleted bills inside a window again — a bill deleted yesterday becomes unreachable");
  /"before"|nextBefore/.test(ledger) && /searchParams\.get\("from"\)/.test(ledger)
    ? ok("the admin ledger can page and date-filter back to any bill")
    : fail("the admin ledger lost its date window / paging cursor — the 90-day restore stops being reachable");
  /A reason is required to delete a bill/.test(ledger)
    ? ok("the admin's own bill delete requires a reason, like every other removal")
    : fail("the admin can delete a bill with no reason — the Removals record would say \"no reason recorded\" for the strongest delete in the product");
}

// ── THE REPAIR KIT IS A MONEY PATH TOO ─────────────────────────────────────────────────────
// It was the last one recording only to the activity log, so an admin voiding or removing
// someone's bill was invisible on the Audit screen the OWNER and the MANAGER actually read.
{
  const repair = read("app/api/admin/repair/route.ts");
  /recordRemoval\(\{[\s\S]{0,300}kind: "invoice_voided"/.test(repair)
    ? ok("the Repair Kit's void reaches the Audit (Removals), not just the activity log")
    : fail("the Repair Kit can void a bill with no Audit row — the owner's Removals view would not show it");
  /recordRemoval\(\{[\s\S]{0,300}kind: "order_deleted"/.test(repair)
    ? ok("the Repair Kit's delete reaches the Audit (Removals) too")
    : fail("the Repair Kit can delete a bill with no Audit row");
  /p_actor: "Admin \(repair\)"/.test(repair)
    ? ok("a Repair Kit void names its actor in the append-only invoice history")
    : fail("the Repair Kit voids without p_actor — the invoice history records who as NULL");
}

// ── AN AUDIT ROW MUST BE OPENABLE, AND SAY WHAT WAS ON IT (owner, 2026-08-04) ───────────────
// "Click and view the full — how it was and what he changed, which KOT he deleted and what was the
// item, with time, day, everything, who has done it, with restaurant." The Audit recorded a deleted
// bill's VALUE and its table and NOTHING about what was on it, so "Bill deleted · Table 6 · ₹1,150"
// could not be checked or argued with. And nothing was clickable on any of the three screens.
{
  const audit = read("lib/removalAudit.ts");
  /async function snapshotOrder/.test(audit) && /if \(a\.orderId && !\("was" in meta\)\)/.test(audit)
    ? ok("a removal snapshots the order it removes (kot, items, totals) into meta.was")
    : fail("removals no longer capture what was on the bill — the Audit goes back to recording only an amount");
  /items: items\.slice\(0, 60\)/.test(audit)
    ? ok("the snapshot is capped, and says so when it truncates")
    : fail("the item snapshot is uncapped — one huge order would bloat every audit row");
  /return null;   \/\/ the removal already happened/.test(audit)
    ? ok("a failed snapshot never undoes the removal it was describing")
    : fail("snapshotOrder can throw into the removal path — gathering evidence must never fail the action");

  // All three surfaces must offer the detail, and it must be LAZY (the snapshot never rides along
  // with a 200-row list — that is the whole-board read the egress rules forbid).
  for (const [file, what] of [
    ["app/api/admin/audit/route.ts", "the admin audit route"],
    ["app/api/owner/audit/route.ts", "the owner audit route"],
    ["app/api/editor/[...path]/route.ts", "the manager audit endpoint"],
  ]) {
    /searchParams\.get\("detail"\)|nextUrl\.searchParams\.get\("detail"\)/.test(read(file))
      ? ok(`${what} serves one removal in full on ?detail=`)
      : fail(`${what} has no ?detail= — an audit row cannot be opened there`);
  }
  const adminAudit = read("app/api/admin/audit/route.ts");
  const ownerAudit = read("app/api/owner/audit/route.ts");
  // The rule is "no SNAPSHOT in the list", not "no mention of meta". Since 2026-08-18 the list also
  // sends ONE scalar out of meta — `made:meta->>made`, whether a cancelled order's food was cooked —
  // which is a text field per row, not an order snapshot, and is what lets a row wear its loss tag
  // without anything being opened. So a JSON-path selection is allowed and the bare column is not.
  const shipsSnapshot = (src) => {
    const line = (src.match(/^const COLS[^\n]*/m) || [""])[0];
    // strip every `meta->>x` / `meta->x` path, then look for a bare `meta`
    return /\bmeta\b/.test(line.replace(/meta\s*->>?\s*[a-z_]+/gi, ""));
  };
  !shipsSnapshot(adminAudit) && !shipsSnapshot(ownerAudit)
    ? ok("the audit LIST still carries no snapshot — only the one scalar, the rest on a click")
    : fail("the audit list now ships every snapshot — that is a whole-board read on a screen nobody has opened");

  // ONLY THE ADMIN CHANGES ANYTHING. The owner sees the identical evidence and gets no write path.
  /canRestore: false/.test(ownerAudit)
    ? ok("the owner's removal detail never offers a restore")
    : fail("the owner route may now offer canRestore — only the admin puts a bill back (owner rule)");
  // ── NARROWED, NOT DROPPED (owner, 2026-08-19: "can be change by owner or manager") ─────────────
  // This used to be "the owner audit route is GET-only". He has since asked for one write, and only
  // one: answering whether a cancelled order's food was actually cooked. That undoes nothing, edits no
  // row and puts no bill back — it appends a `removal_classified` row and moves stock and one expense
  // (migration 337). The record itself stays immutable, which is what the rule was protecting.
  //
  // So the rule is now about WHAT the write does, not whether one exists: the only RPC the owner route
  // may call is the classifier, and nothing that restores, deletes or rewrites a removal.
  {
    const banned = /lfh_restore|restore_removal|\.delete\(\)|\.update\(\s*\{[^}]*(amount|reason_code|reason_note|kind)\s*:/;
    // Look INSIDE the write handler only. The GET legitimately calls read RPCs — the per-type chip
    // counts among them — and judging the whole file flagged those as writes.
    const postBody = (ownerAudit.match(/export async function POST[\s\S]*$/) || [""])[0];
    const rpcs = [...postBody.matchAll(/\.rpc\("([a-z_]+)"/g)].map((m) => m[1]);
    const strayRpc = rpcs.filter((n) => n !== "lfh_cancel_classify");
    !banned.test(postBody) && strayRpc.length === 0
      ? ok(`the owner audit route writes ONE thing only — the "was the food made?" answer (${rpcs.length} rpc call${rpcs.length === 1 ? "" : "s"}, all the classifier)`)
      : fail(`the owner audit route can now change the record itself${strayRpc.length ? ` (it calls: ${strayRpc.join(", ")})` : ""} — answering is the only write an owner gets; restoring, deleting or rewriting a removal is Aevidine's alone`);
  }
  !/export async function (POST|PATCH|PUT|DELETE)/.test(adminAudit)
    ? ok("restoring still goes through the audited bill-ledger path, not a second door on the audit view")
    : fail("the admin audit route grew its own write path — keep the one audited restore in /api/admin/bills");

  // One shape on every screen, and the panel's copy registers with the back-stack like every overlay.
  const shared = read("components/admin/RemovalDetail.tsx");
  /export function RemovalDetail\(/.test(shared) && /export function RemovalDetailModal\(/.test(shared)
    ? ok("admin and owner render ONE shared removal-detail component")
    : fail("the removal detail is no longer shared — two copies drift, which is how one row reads two ways");
  /useBackClose\("removal-detail"/.test(shared)
    ? ok("the removal detail closes on a phone's Back instead of leaving the page")
    : fail("the removal detail is not registered with the back-stack (CLAUDE.md rule for every overlay)");
  const panel = read("public/panels/editor/app.js");
  /async function openRemovalDetail\(/.test(panel) && /data-au-open/.test(panel)
    ? ok("the manager panel's audit rows open the same full record")
    : fail("the manager panel's audit rows are not clickable — the owner asked for it on every screen");
  /wrap\.__lfhClose = close;/.test(panel.slice(panel.indexOf("async function openRemovalDetail")))
    ? ok("the panel's removal detail answers the hardware Back button")
    : fail("the panel's removal detail does not set __lfhClose — phone Back would leave the panel");
}

// ── THE BILL TOMBSTONE MUST ACTUALLY LAND (found live 2026-08-04) ───────────────────────────
// softDeleteOrders built ONE stamp and sent it to both tables. `orders` has archived/archived_at;
// `sessions` has NEITHER, so every session UPDATE was rejected by PostgREST — and its error was
// never checked, so it failed in silence. The tombstone had therefore never worked: 138 bills on
// the live database had every order deleted while the session still read alive. The ledger looked
// fine because deriveBillState ALSO derives "deleted" from orders.every(deleted) in JS, so the
// screen was right while sessions.deleted_at — which the 90-day retention, idx_sessions_deleted
// and the admin's restore all read — stayed NULL. Repaired by mig 280.
{
  const sd = read("lib/softDelete.ts");
  /const sessionStamp = \{/.test(sd) && !/from\("sessions"\)\.update\(orderStamp\)/.test(sd)
    ? ok("the session tombstone sends only the columns sessions HAS (no archived/archived_at)")
    : fail("softDeleteOrders sends `archived` to sessions again — the UPDATE is rejected and the bill is never tombstoned");
  /throw new Error\(`bill tombstone failed/.test(sd)
    ? ok("a failed bill tombstone THROWS instead of failing silently")
    : fail("the session tombstone's error is swallowed again — that is how this hid for months");
  /soft-delete failed/.test(sd)
    ? ok("a failed order soft-delete throws too")
    : fail("the order soft-delete's error is unchecked");
  const mig = migrationSrcWith("HAVING count(*) FILTER (WHERE o.deleted_at IS NULL) = 0");
  /HAVING count\(\*\) FILTER \(WHERE o\.deleted_at IS NULL\) = 0/.test(mig)
    ? ok("mig 280 repairs only bills whose every order is already deleted")
    : fail("mig 280 is missing or no longer scoped to fully-deleted bills");
  /max\(o\.deleted_at\)/.test(mig)
    ? ok("the repaired tombstone takes its time from the ORDERS, so retention runs from the real removal")
    : fail("mig 280 stamps now() — the 90-day retention window would restart on every repair");
}

// ── A STORED TAX RATE MUST BE ONE THE RESTAURANT IS ACTUALLY ON (found live 2026-08-04) ─────
// mig 284 derives orders.tax_rate as tax / COALESCE(taxable_base, subtotal) and the readers
// (billMath, the Z-report, paySplit) then TRUST it over the settings. Driving the deployed site
// showed 15 rows stamped with rates that are not rates — 0.045 (= 0.05 x (1 - 50/500), i.e. the
// stored tax had been computed on the DISCOUNTED base) and 0.025836 (tax and base simply disagree).
// Each one would make billMath quote a wrong total for that bill, and billMath is what the payment
// sheet asks the manager to collect. mig 288 makes the derivation able to say "I don't know".
{
  const m287 = migrationSrcWith("lfh_plausible_tax_rate");  // was 287, landed as 288 — find it by content
  /CREATE OR REPLACE FUNCTION lfh_plausible_tax_rate/.test(m287)
    ? ok("a derived tax rate is credibility-checked before it is stored")
    : fail("mig 288 is missing — an implausible derived rate would be trusted as the bill's rate");
  /NEW\.tax_rate := v_rate;/.test(m287) && /lfh_plausible_tax_rate\(COALESCE\(NEW\.restaurant_id/.test(m287)
    ? ok("the stamp leaves the rate NULL when it cannot vouch for it (the reader falls back to settings)")
    : fail("the stamp writes a rate without checking it is one the restaurant is on");
  /UPDATE orders o SET tax_rate = NULL/.test(m287)
    ? ok("rates already written that we do not believe are un-stamped")
    : fail("mig 287 no longer clears the implausible rates it was written to clear");
  // AND THE READERS MUST TREAT A STAMPED RATE CORRECTLY — ASKED OF THE CODE, NOT OF ITS TEXT.
  //
  // This used to be `/Number\(o\.tax_rate\) > 0/.test(read("public/panels/billdoc.js"))`. That string
  // is still the first clause of orderTaxRate, so the check kept passing — while the BEHAVIOUR it
  // claimed to guard had been deliberately changed underneath it (a stamped 0 from an order carrying
  // money is now honoured, which is what stops a 0%-era bill reprinting with tax nobody charged).
  // A guard that greps for a phrase asserts nothing once the phrase outlives the rule, and it would
  // have gone on passing if someone reverted the fix. So it asks the function instead (T7, 2026-08-06).
  {
    const rateOf = BILLDOC.orderTaxRate;
    const S = 0.05;   // what the restaurant's settings answer today
    const cases = [
      ["a POSITIVE stamped rate is what the order was charged", { tax_rate: 0.18, subtotal: 1000 }, 0.18],
      ["a stamped ZERO on an order carrying money is a real rate, not a missing one", { tax_rate: 0, subtotal: 1000 }, 0],
      ["a NULL rate falls back to the restaurant's settings", { tax_rate: null, subtotal: 1000 }, S],
      ["an unstamped legacy row falls back to the settings", { subtotal: 1000 }, S],
      ["a stamped 0 on a ₹0 line cannot drag a taxed bill to nothing", { tax_rate: 0, subtotal: 0 }, S],
    ];
    let bad = null;
    for (const [, row, want] of cases) if (rateOf(row, S) !== want) { bad = [row, want, rateOf(row, S)]; break; }
    bad
      ? fail(`orderTaxRate(${JSON.stringify(bad[0])}) answered ${bad[2]}, expected ${bad[1]}`,
        "the bill's rate is what the payment sheet asks a manager to collect")
      : ok("the shared bill money reads a stamped rate correctly (positive / real 0 / fall back) — behaviour, not a grep");
    // …and pay-in-parts must use that SAME function, or the paper and the split screen can disagree
    // about what is owed while both look right on their own.
    /BILLDOC\.orderTaxRate\(/.test(read("lib/paySplit.ts"))
      ? ok("  …and settling a bill in parts uses that one definition, not a second copy of the rule")
      : fail("lib/paySplit.ts decides an order's tax rate on its own again — the two drifted once already");

  // …AND SO MUST THE Z-REPORT — the sheet a manager signs at closing time (T7 finding F8, fixed
  // 2026-08-11). It borrowed ONE rate for a whole bill (`g.find(o => o.tax_rate > 0)`), the very
  // rule the printed bill and pay-in-parts were rebuilt away from on 2026-08-05. A banquet at its
  // own 18% shares a table's open session with 5% food (migs 237/239), so the day-close reported
  // 150 of tax on a bill the paper charged 410 for. COMPLIANCE section 3: they must reconcile.
  //
  // BEHAVIOUR, NOT A GREP (the lesson two checks up). billTaxOf() is pure, so it is lifted out of
  // the route source and RUN against the same bills billMoney() prices — if the two ever disagree
  // again this fails with both numbers, rather than passing on a phrase that outlived the rule.
  {
    const src = read("app/api/editor/[...path]/route.ts");
    const fn = (src.match(/function billTaxOf\([\s\S]*?\n}\n/) || [])[0];
    const dbo = (src.match(/function discountBaseOf\([\s\S]*?\n}\n/) || [])[0];
    if (!fn || !dbo) {
      fail("billTaxOf() / discountBaseOf() are no longer in the editor route — the Z-report's per-rate tax cannot be checked",
        "if the Z-report went back to one rate per bill, the day-close stops matching the printed bills");
    } else {
      // Drop the TypeScript annotations so the pure function can be run as plain JS, then hand it
      // the REAL orderTaxRate so it is the shared definition being exercised.
      const js = (fn + dbo)
        .replace(/: *\{[^{}]*\}/g, "")
        .replace(/: *[A-Za-z_][A-Za-z0-9_.]*(\[\])?( *\| *[A-Za-z_][A-Za-z0-9_.]*(\[\])?)*/g, "")
        .replace(/<[^<>]*>/g, "");
      let billTaxOf = null;
      try {
        billTaxOf = new Function("BILLDOC", js + "; return billTaxOf;")(BILLDOC);
      } catch (e) {
        fail("billTaxOf() could not be run: " + e.message, "the Z-report's per-rate tax is then unguarded");
      }
      if (billTaxOf) {
        const ord = (o) => Object.assign({ status: "served", payment_status: "pending", items: [] }, o);
        const S = { tax_components: [{ label: "CGST", rate: 2.5 }, { label: "SGST", rate: 2.5 }] };
        const food = (extra) => ord(Object.assign({ subtotal: 1000, taxable_base: 1000, tax_rate: 0.05, items: [{ title: "F", qty: 1, price: 1000, tax_mode: "excl" }] }, extra || {}));
        const banq = () => ord({ subtotal: 2000, taxable_base: 2000, tax_rate: 0.18, items: [{ title: "B", qty: 1, price: 2000, tax_mode: "excl" }] });
        const bills = [
          ["a banquet at 18% beside 5% food", [food(), banq()]],
          ["the same bill, banquet order first", [banq(), food()]],
          ["two rates AND a discount", [food({ discount: 200 }), banq()]],
          ["one ordinary 5% bill (nothing may move)", [food({ discount: 100 })]],
          ["a composition bill (the rate really is 0)", [ord({ subtotal: 880, taxable_base: 0, nontax_amount: 880, tax_rate: 0, discount: 50, items: [{ title: "T", qty: 2, price: 440, tax_mode: "exempt" }] })]],
        ];
        let off = null;
        for (const pair of bills) {
          const paper = BILLDOC.billMoney(pair[1], S);
          const z = billTaxOf(pair[1], BILLDOC.taxModel(S).rate);
          if (Math.abs(z.tax - paper.tax) > 0.005 || Math.abs(z.disc - paper.disc) > 0.005) {
            off = pair[0] + ": the paper charges tax " + paper.tax + " / discount " + paper.disc + ", the Z-report says " + z.tax + " / " + z.disc;
            break;
          }
        }
        off
          ? fail(off, "the day-close sheet must equal the sum of the bills already handed to guests (COMPLIANCE section 3)")
          : ok("the Z-report taxes each order at ITS OWN rate — the day-close agrees with the printed bill on a mixed-rate bill");
      }
    }
  }
  }
}

// ── AND THE TOMBSTONE HOLDS WHOEVER DID THE DELETING (mig 291) ───────────────────────────────
// mig 280 fixed the APP's delete path and repaired 138 bills. Asking the database again hours later
// found 37 MORE in the same state — every order deleted, the session still reading alive — with
// deleted_by and delete_reason both null, which the app path never leaves. They came from scripts
// stamping deleted_at directly through the service role. To the admin the symptom is identical: the
// bill is invisible to the ledger and cannot be put back. So the rule moved onto the row change
// itself, exactly as mig 232 did for closing a table.
{
  const m291 = migrationSrcWith("lfh_tombstone_fully_deleted_bill");
  /CREATE TRIGGER trg_tombstone_fully_deleted_bill/.test(m291)
    ? ok("a fully-deleted bill tombstones itself, whoever wrote the delete")
    : fail("mig 291 is missing — a script or a hand-run UPDATE would hide a bill from the admin ledger again");
  /AFTER UPDATE OF deleted_at ON orders/.test(m291)
    ? ok("...on the row change itself, not in a caller that can be bypassed")
    : fail("the tombstone rule is not on the orders row change — a direct write would skip it");
  /WHEN \(NEW\.deleted_at IS NOT NULL AND OLD\.deleted_at IS NULL\)/.test(m291)
    ? ok("and it only fires when a delete actually happens (an ordinary edit costs nothing)")
    : fail("the trigger fires on every order update — that is a cost on the hot path");
  /max\(o\.deleted_at\)/.test(m291)
    ? ok("its repair dates the tombstone from the ORDERS, so retention runs from the real removal")
    : fail("mig 291's repair stamps now() — the 90-day window would restart on every repair");
}

// ── report ───────────────────────────────────────────────────────────────────
if (!HOOK) for (const m of oks) console.log("  ok   " + m);
// ── A DISCOUNT IS GROSSED AT THE RATE IT WAS CHARGED (mig 301, T7 sweep F16) ─────────────────
// `orders.total` carries tax on the PRE-discount subtotal, so every money surface computes the net
// as `total - discount x (1 + rate)`. Migration 284 made an order remember its OWN rate; that
// reached the bill, the Z-report and pay-in-parts and NOT ONE analytics function — they all used
// the rate configured right now, so a discounted bill whose rate later changed (or a banquet at its
// own rate) made the owner's revenue disagree with the guest's paper. Mig 301 moved that arithmetic
// to write time (`orders.disc_gross`), which is also what keeps mig 155's per-row-free read path.
// These checks exist because the fault's shape is "someone re-issues one of these functions and
// quietly reverts it" — which is exactly how it survived mig 126 -> 284 in the first place.
{
  const migAll = readdirSync(join(root, "supabase/migrations")).sort()
    .map((f) => [f, readFileSync(join(root, "supabase/migrations", f), "utf8")]);
  // The LATEST definition of each money reader is the only one that matters — an older migration
  // may legitimately still contain the old expression.
  const latestBody = (fn) => {
    let found = "";
    for (const [, src] of migAll) {
      const m = src.match(new RegExp(String.raw`create\s+or\s+replace\s+function\s+(?:public\.)?${fn}\s*\([\s\S]*?\$(?:function|)\$;`, "i"));
      if (m) found = m[0];
    }
    return found;
  };
  const READERS = ["lfh_owner_overview", "lfh_owner_payment_breakdown", "lfh_owner_restaurant_revenue",
    "lfh_owner_revenue_timeseries", "lfh_owner_sales_report", "lfh_owner_hourly",
    "lfh_owner_records", "lfh_owner_payment_trend", "lfh_owner_heatmap"];
  let reverted = [];
  for (const fn of READERS) {
    const b = latestBody(fn);
    if (!b) { fail(`${fn} has no definition in supabase/migrations — this guard cannot see it`); continue; }
    // The fault, in either of the two shapes it took: a discount multiplied by a LIVE rate.
    if (/o\.discount\s*\*\s*\(1\s*\+/.test(b) || /\(1\s*\+\s*rt\.rate\)\s*\*\s*c?\.?dp\b/.test(b)) reverted.push(fn);
  }
  reverted.length === 0
    ? ok(`all ${READERS.length} owner money functions subtract the discount as it was CHARGED, not as today's rate would gross it`)
    : fail(`${reverted.join(", ")} gross a discount at the rate configured NOW — the owner's revenue will disagree with the printed bill for any bill whose rate has since changed (use orders.disc_gross, mig 301)`);

  const g = migrationSrcWith("lfh_fill_disc_gross");
  /NULLIF\(NEW\.tax_rate, 0\)/.test(g) && /lfh_effective_tax_rate/.test(g)
    ? ok("orders.disc_gross is filled from the order's OWN rate, falling back to the restaurant's")
    : fail("the disc_gross trigger no longer prefers the order's own stamped rate (mig 301)");
  /BEFORE INSERT OR UPDATE OF discount, tax_rate/.test(g)
    ? ok("...and it is re-derived whenever the discount or the stamped rate changes")
    : fail("the disc_gross trigger does not fire on a discount or rate change — a later edit would leave it stale");
  // The rollups must carry it too, or a reader falls back to the old maths for frozen history.
  const r = migrationSrcWith("disc_gross_paid");
  /orders_daily_agg\s+ADD COLUMN IF NOT EXISTS disc_gross_paid/.test(r) && /orders_report_monthly_agg ADD COLUMN IF NOT EXISTS disc_gross_paid/.test(r)
    ? ok("both pre-aggregated rollups carry the grossed discount, so frozen history uses it too")
    : fail("a rollup does not carry disc_gross_paid — its history would still be grossed at today's rate");
}

// ── THE RISK MAP HAS ONE ANSWER, NOT TWO (owner, 2026-08-13) ────────────────────────────────────
// He asked the Audit to show "the whole risk, money-wise — how much money is there which reverted",
// and for an edit after the bill to land in the MINOR section. That split now exists twice by
// necessity: in public/panels/auditsort.js (KIND_RISK — what the three screens read) and in the
// database (lfh_audit_risk — what the per-type counts are grouped by). If those two ever disagree,
// the strip at the top of the screen contradicts the list underneath it, which is the exact fault
// this whole file exists to prevent. So they are compared, kind by kind.
{
  const shared = read("public/panels/auditsort.js");
  const sqlRisk = migrationSrcWith("lfh_audit_risk");
  const jsRisk = {};
  const block = shared.match(/var KIND_RISK = \{([\s\S]*?)\};/);
  if (block) for (const m of block[1].matchAll(/([a-z_]+)\s*:\s*"(money|record|data)"/g)) jsRisk[m[1]] = m[2];
  // The SQL is a CASE list: everything named is money/data, everything else falls to 'record'.
  const sqlNamed = {};
  for (const m of sqlRisk.matchAll(/WHEN\s+'([a-z_]+)'\s+THEN\s+'(money|record|data)'/g)) sqlNamed[m[1]] = m[2];
  const kinds = Object.keys(jsRisk);
  kinds.length >= 12
    ? ok(`the screens' risk map covers all ${kinds.length} removal kinds`)
    : fail(`public/panels/auditsort.js KIND_RISK only covers ${kinds.length} kinds — every kind needs one`);
  const disagree = kinds.filter((k) => (sqlNamed[k] || "record") !== jsRisk[k]);
  disagree.length === 0
    ? ok("the database and the screens agree, kind by kind, on which rows are about money")
    : fail(`lfh_audit_risk and auditsort.js KIND_RISK disagree on: ${disagree.join(", ")} — the money strip would contradict the list below it`);
  // ── AND THE TAG MAP HAS ONE ANSWER TOO (owner, 2026-08-18: "make tags for all kind of audit") ──
  // Same shape, same reason as the risk map above: the tags exist twice — KIND_TAGS in
  // auditsort.js (what the chips on all three screens read) and lfh_audit_tags() in migration 337
  // (what the per-type counts are grouped by). Two answers to "what is this row about" is how one
  // screen's chips start disagreeing with another's.
  const sqlTags = migrationSrcWith("lfh_audit_tags");
  const jsTags = {};
  const tblock = shared.match(/var KIND_TAGS = \{([\s\S]*?)\n  \};/);
  if (tblock) for (const m of tblock[1].matchAll(/([a-z_]+)\s*:\s*\[([^\]]*)\]/g)) {
    jsTags[m[1]] = m[2].split(",").map((x) => x.trim().replace(/^["']|["']$/g, "")).filter(Boolean).sort();
  }
  const sqlTagNamed = {};
  for (const m of sqlTags.matchAll(/WHEN\s+'([a-z_]+)'\s+THEN\s+ARRAY\[([^\]]*)\]/g)) {
    sqlTagNamed[m[1]] = m[2].split(",").map((x) => x.trim().replace(/^'|'$/g, "")).filter(Boolean).sort();
  }
  const tagKinds = Object.keys(jsTags);
  tagKinds.length >= 13
    ? ok(`the screens' tag map covers all ${tagKinds.length} kinds`)
    : fail(`public/panels/auditsort.js KIND_TAGS only covers ${tagKinds.length} kinds — every kind needs its tags`);
  const tagDisagree = tagKinds.filter((k) => (sqlTagNamed[k] || []).join("|") !== jsTags[k].join("|"));
  tagDisagree.length === 0 && tagKinds.length > 0
    ? ok("the database and the screens agree, kind by kind, on the tags a row carries")
    : fail(`lfh_audit_tags and auditsort.js KIND_TAGS disagree on: ${tagDisagree.join(", ") || "(nothing parsed — did the map move?)"} — one screen's chips would contradict another's`);
  // The answer tags are the point of the feature: a cancellation must be able to say it lost food,
  // lost nothing, or has not been answered — and "unanswered" must never quietly become "no loss".
  const jsShared = shared;
  /loss"?\s*:\s*"Food lost"/.test(jsShared) && /unanswered"?\s*:\s*"Not answered yet"/.test(jsShared)
    ? ok("a cancellation can say it lost food, lost nothing, or is not answered yet")
    : fail("auditsort.js lost the loss / no-loss / unanswered tag words — the whole point of asking");
  /made === true \? "loss" : made === false \? "no-loss" : "unanswered"/.test(jsShared)
    ? ok("an unanswered cancellation stays unanswered, never guessed as \"nothing lost\"")
    : fail("auditsort.js tagsOf() no longer keeps \"unanswered\" as its own state — guessing it as no-loss would hide a real food loss");

  // The one the owner asked for by name: an edit after the bill must NOT count as money.
  jsRisk.bill_annotated === "record" && (sqlNamed.bill_annotated || "record") === "record"
    ? ok("a note/allergy changed after settling is recorded as MINOR, never as money moved")
    : fail("bill_annotated is classified as money — the owner's instruction was the minor section, no money");
  // And it must actually be recorded, from the endpoint, not the browser.
  const ed = read("app/api/editor/[...path]/route.ts");
  /kind:\s*"bill_annotated"/.test(ed) && /data\?\.settled/.test(ed)
    ? ok("the note edit records it server-side, and only when the bill was already settled")
    : fail("editing a settled bill's note leaves no Audit row — record it via lib/removalAudit.ts");
  /payment_status === "paid" && \(justAdded\.length \|\| justRemoved\.length\)/.test(ed)
    ? ok("an allergy changed on a settled bill records it too")
    : fail("an allergy change on a settled bill leaves no Audit row");
  // And the settled ticket itself must be PATCHED, never rebuilt.
  const noteFn = migrationSrcWith("patch ONLY this line's note");
  /jsonb_set\(line, '\{note\}'/.test(noteFn) && /line->>'id'\) = p_item::text/.test(noteFn)
    ? ok("a settled bill's ticket is patched on the one line, matched by that line's own id")
    : fail("lfh_staff_edit_item_note rebuilds a settled bill's whole ticket again — patch the one line");
}

if (fails.length) {
  const body = fails.map((m) => "  FAIL " + m).join("\n");
  if (HOOK) {
    console.error("Audit-coverage guard refused this edit — a change that lowers a bill would leave no record:\n" + body);
    console.error("\n(Migration 251 named five removal kinds and only two were ever written, because the\n BROWSER wrote them. Record it in the endpoint via lib/removalAudit.ts, then re-run:\n node scripts/verify-audit-coverage.mjs)");
    process.exit(2);
  }
  console.log("\n" + body);
  console.log(`\n${fails.length} of ${fails.length + oks.length} checks failed — a money-lowering change would leave no record.`);
  process.exit(1);
}

if (!HOOK) console.log(`\nAll ${oks.length} checks passed — every change that lowers a bill leaves a record.`);
