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

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => { try { return readFileSync(join(root, p), "utf8"); } catch { return ""; } };
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
      for (const m of read(rel).matchAll(/\blog(?:Action)?\(\s*"([a-z0-9_]+)"\s*,\s*(?:"([a-z0-9_]+)"\s*,)?/g)) {
        if (m[2]) written.add(m[2]);
        else if (!PANEL_NAMES.has(m[1])) written.add(m[1]);
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
  const missing = [];
  for (const k of kinds) {
    for (const [name, src] of [["manager panel", panel], ["admin page", adminPage], ["owner page", ownerPage]])
      if (!src.includes(`${k}:`)) missing.push(`${k} (${name})`);
  }
  if (missing.length) fail(`kinds with no label — they render as a raw key like "qty_reduced": ${missing.join(", ")}`);
  else ok(`all ${kinds.length} kinds have a label in the manager, admin and owner views`);
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
  zSlice && !/deleted_at/.test(zSlice)
    ? ok("the Z-report still counts deleted bills (a delete may never shrink the day's takings)")
    : fail("the Z-report now filters deleted bills — docs/COMPLIANCE-GUARDRAILS.md requires voids and deletes to be included");
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
  !/^const COLS[^\n]*meta/m.test(adminAudit) && !/^const COLS[^\n]*meta/m.test(ownerAudit)
    ? ok("the audit LIST still does not carry meta (the snapshot is fetched only on a click)")
    : fail("the audit list now ships every snapshot — that is a whole-board read on a screen nobody has opened");

  // ONLY THE ADMIN CHANGES ANYTHING. The owner sees the identical evidence and gets no write path.
  /canRestore: false/.test(ownerAudit)
    ? ok("the owner's removal detail never offers a restore")
    : fail("the owner route may now offer canRestore — only the admin puts a bill back (owner rule)");
  !/export async function (POST|PATCH|PUT|DELETE)/.test(ownerAudit)
    ? ok("the owner audit route is GET-only — the owner can look and change nothing")
    : fail("the owner audit route grew a write handler — the owner must not be able to change a record");
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
  /bill tombstone failed for session/.test(sd)
    ? ok("a failed bill tombstone THROWS instead of failing silently")
    : fail("the session tombstone's error is swallowed again — that is how this hid for months");
  /soft-delete failed/.test(sd)
    ? ok("a failed order soft-delete throws too")
    : fail("the order soft-delete's error is unchecked");
  const mig = read("supabase/migrations/280_the_bill_tombstone_that_never_landed.sql");
  /HAVING count\(\*\) FILTER \(WHERE o\.deleted_at IS NULL\) = 0/.test(mig)
    ? ok("mig 280 repairs only bills whose every order is already deleted")
    : fail("mig 280 is missing or no longer scoped to fully-deleted bills");
  /max\(o\.deleted_at\)/.test(mig)
    ? ok("the repaired tombstone takes its time from the ORDERS, so retention runs from the real removal")
    : fail("mig 280 stamps now() — the 90-day retention window would restart on every repair");
}

// ── report ───────────────────────────────────────────────────────────────────
if (!HOOK) for (const m of oks) console.log("  ok   " + m);
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
