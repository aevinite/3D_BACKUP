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
import { readFileSync } from "node:fs";
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
  const RELEVANT = /(app\/api\/(editor|tablet)\/|app\/api\/admin\/bills\/|lib\/(removalAudit|sessionClose)\.ts|public\/panels\/editor\/app\.js|app\/aevinite\/logs\/page\.tsx|app\/owner\/activity\/page\.tsx)/;
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
  const block = src.slice(at, at + 4500);
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
