#!/usr/bin/env node
// verify-merge-party.mjs — A MERGED PARTY IS ONE BILL, EVERYWHERE (owner, 2026-08-03).
//
// Static, instant. Each check maps to a bug that actually reached a screen on 2026-08-03:
//   · the manager's bill preview showed ₹662 of a ₹1,323 joint bill (half the party)
//   · after "Serve all", one tile turned green and its merged partner stayed stale
//   · the SELECTED parent's tile read "0/2 served" while the server said "0/4"
//   · the waiter tablet called a merged child "free" and its Mark-paid settled half a bill
//   · the tablet's full refresh wiped the party's slices and re-pulled only ONE table
//
// Run: node scripts/verify-merge-party.mjs   (also part of the repo's static guard set)
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

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

const editor = read("public/panels/editor/app.js");
const billdoc = read("public/panels/billdoc.js");
const tablet = read("public/panels/tablet/app.js");
// The ONE refusal-wording list, shared by every panel's queue (moved here 2026-08-06).
const outbox = read("public/panels/outbox.js");
const editorRoute = read("app/api/editor/[...path]/route.ts");
const tabletRoute = read("app/api/tablet/[...path]/route.ts");

let fail = 0;
const check = (name, ok) => { console.log((ok ? "  ok   " : "  FAIL ") + name); if (!ok) fail++; };
const fnBody = (src, name) => {
  const i = src.indexOf(name);
  return i < 0 ? "" : src.slice(i, i + 4000);
};

// ── manager panel ───────────────────────────────────────────────────────────
check("manager: the bill preview gathers the WHOLE party (openBillPreview → partyOrders)",
  /async function openBillPreview[\s\S]{0,600}partyOrders\(/.test(editor));
check("manager: splitting a bill splits the PARTY's bill (openSplitSettle → partyOrders)",
  /async function openSplitSettle[\s\S]{0,600}partyOrders\(/.test(editor));
check("manager: a targeted poll refreshes the whole party (pollTables → partyTablesOf)",
  /async function pollTables[\s\S]{0,2000}partyTablesOf/.test(editor));
check("manager: a targeted poll carries the fresh merges list",
  /latest\.merges/.test(fnBody(editor, "async function pollTables")));
check("manager: the selected tile counts the party, not one table (tableTileStateFromBoard → partyOrders)",
  /function tableTileStateFromBoard[\s\S]{0,900}partyOrders\(/.test(editor));
// combineBillLines MOVED into /panels/billdoc.js on 2026-08-04, together with the rest of the bill
// assembly, so the WAITER panel could print a bill at all. The behaviour is unchanged and now
// shared — so this checks it where it lives, and that the shared assembler still applies it.
check("the printed bill combines identical dish lines (combineBillLines, shared)",
  /function combineBillLines/.test(billdoc) && /combineBillLines\(live\.reduce/.test(billdoc));
check("manager: the paper bill names every table of the party — but ONLY on a LIVE bill (a reprint of yesterday's solo bill must not wear today's merge)",
  /const tableDisp = \(opts\.party && mergeGroupLabel\(tnum\)\)/.test(editor)
  && /printBill\(t, ss \|\| \{ invoice_no: null, bill_no: null \}, live\(\), \{ party: true \}/.test(editor));
check("manager: a merged child's Print re-reads the session via the party head (no silent no-paper return)",
  /const head = mergeParentOf\(t\) \|\| String\(t\);[\s\S]{0,500}printBill\(head/.test(editor));
check("manager: the on-the-house undo snapshot covers the whole party",
  /async function onHouseSettle[\s\S]{0,700}partyOrders\(t\)/.test(editor));

// ── waiter tablet ───────────────────────────────────────────────────────────
check("tablet: knows the live merges (mergeParentOf/partyTablesOf/partyOrders exist)",
  /function mergeParentOf/.test(tablet) && /function partyTablesOf/.test(tablet) && /function partyOrders/.test(tablet));
check("tablet: a merged member's tile wears the PARTY's state (tileState resolves the parent)",
  /function tileState\(t\)[\s\S]{0,400}mergeParentOf\(t\)/.test(tablet));
check("tablet: a merged child's session is its parent's (sessionOf resolves the merge)",
  /const sessionOf = \(t\) => rawSessionOf\(t\) \|\| \(mergeParentOf\(t\)/.test(tablet));
check("tablet: the full refresh re-pulls EVERY party slice, not just the selected table",
  /async function loadImpl[\s\S]{0,7000}partyTablesOf\(sel\)/.test(tablet));
check("tablet: the detail lists the whole party's orders (renderPanel → partyOrders)",
  /const os = partyOrders\(t\), calls = callsOf\(t\)/.test(tablet));
check("tablet: paying optimistically flips the whole party's orders",
  /function optimisticPay[\s\S]{0,700}partyTablesOf/.test(tablet));

// ── server routes: acting on a TABLE NUMBER resolves the merge first ────────
const acts = ["restart", "pay-split", "pay", "on-the-house", "khata"];
for (const route of [["editor", editorRoute], ["tablet", tabletRoute]]) {
  const [name, src] = route;
  for (const a of acts) {
    // pay-split exists in both; unpay/customer-capture are tablet-shaped — check what exists.
    // Anchored to the TABLES handler ('a === "tables" && c === …') so e.g. the platform
    // board's own "pay" action can never satisfy — or fail — a table check.
    const i = src.indexOf(`a === "tables" && c === "${a}"`);
    if (i < 0) continue;
    // Slice to the START OF THE NEXT tables handler, not a fixed byte count. A hard 800-char
    // window silently became wrong the moment a handler grew: `restart` gained a permission
    // comment, which pushed its mergeParentTable() call past the cut-off and turned this red
    // while the behaviour was untouched. A guard that fails for a reason that isn't the fault
    // it names costs the same trust as one that passes for the wrong reason — and it trains
    // people to ignore the output.
    const next = src.indexOf(`a === "tables" && c === "`, i + 10);
    const body = src.slice(i, next > i ? next : i + 4000);
    check(`${name} route: tables/:t/${a} resolves a merged child to its parent`, /mergeParentTable\(/.test(body));
  }
}
check("tablet route: tables/:t/unpay resolves a merged child to its parent",
  /c === "unpay"[\s\S]{0,700}mergeParentTable\(/.test(tabletRoute));
check("tablet route: the waiter summary carries the live merges list",
  /table_merges[\s\S]{0,300}summaryOut/.test(tabletRoute));
check("lib/tableMerge.ts exists (the one shared resolver)",
  read("lib/tableMerge.ts").includes("export async function mergeParentTable"));

// ── round 2 (mig 264): every remaining path respects a live merge ───────────
const mig264 = migrationSrcWith("lfh_staff_move_order");
check("mig 264: a guest order at a merged table joins the party (lfh_place_order_public)",
  /lfh_place_order_public[\s\S]{0,4500}lfh_merge_parent_table\(v_rid, v_tbl\)/.test(mig264));
check("mig 264: the recreate KEPT mig 253's open-price guest guard (staff_priced_item)",
  /lfh_place_order_public[\s\S]{0,2500}staff_priced_item/.test(mig264));
check("mig 264: a merged party refuses to shift (party_merged)",
  /lfh_staff_shift_table[\s\S]{0,1500}party_merged/.test(mig264));
check("mig 264: nothing shifts ONTO a joined table (merged_child, checked under the lock)",
  /pg_advisory_xact_lock[\s\S]{0,900}merged_child/.test(mig264));
check("mig 264: moving a KOT to a joined table joins that party's bill",
  /lfh_staff_move_order\(p_order[\s\S]{0,1800}lfh_merge_parent_table\(p_rid, p_to\)/.test(mig264));
check("mig 264: moving a single dish to a joined table joins that party's bill",
  /lfh_staff_move_order_item[\s\S]{0,1800}lfh_merge_parent_table\(p_rid, p_to\)/.test(mig264));
check("manager: the Change-table row says 'unmerge first' on a merged party (both menus)",
  (editor.match(/why: mergeGroupLabel\(t\) \? "unmerge first"/g) || []).length >= 2);
// This used to look for `&& !mergeParentOf(i)` twice — the shape the two pickers had while they
// HID an unavailable table. #907 (2026-08-07) stopped hiding them, because the owner asked to see
// the whole floor with the unavailable ones greyed out, so each picker now names the reason in one
// place (`whyBlocked` / `shiftBlocked`) and builds its free list from exactly that. The rule is
// unchanged and still true — a merged child is refused — but the old regex could not see it, so
// this went red on a picker that is behaving correctly. Assert the RULE, in both doors: a merged
// child is classified blocked ("joined"), and the free list is precisely "not blocked", which is
// what stops the list and the label from ever disagreeing.
check("manager: no shift picker offers a merged child as a free table",
  (editor.match(/if \(mergeParentOf\(i\)\) return "joined";/g) || []).length >= 2
  && /if \(!whyBlocked\(i\)\) free\.push\(i\)/.test(editor)
  && /if \(!shiftBlocked\(i\)\) out\.push\(i\)/.test(editor));
// The LIST moved to public/panels/outbox.js (2026-08-06) so the waiter tablet and the "Needs you"
// sheet speak the same sentences as the manager's toast instead of showing raw codes — this used
// to assert the object literal lived in editor/app.js, which was checking WHERE it is rather than
// THAT it works. Now: the one list exists, the manager still looks reasons up in it, and — new —
// the merge refusals this file is about are actually IN it, which the old check never verified.
check("the refusal wording is one shared list (outbox.js REASONS), not a per-panel copy",
  /const REASONS = \{/.test(outbox) && /reasonText\(/.test(outbox) && /REASONS,/.test(outbox));
check("manager: refusal reasons are shown in plain words (KOT_REASON_TEXT reads that list)",
  /const KOT_REASON_TEXT = \(window\.LFH_OUTBOX && window\.LFH_OUTBOX\.REASONS\)/.test(editor)
  && /KOT_REASON_TEXT\[r\.reason\]/.test(editor));
check("…and the merge refusals are in it, in words (party_merged / merged_child)",
  /party_merged: "[^"]{15,}"/.test(outbox) && /merged_child: "[^"]{15,}"/.test(outbox));
check("tablet: the Change-table row says 'unmerge first' on a merged party",
  /mergeGroupLabel\(t\) \? "Change table — unmerge first"/.test(tablet));
check("tablet route: shiftErrMsg speaks the two merge refusals",
  /party_merged/.test(tabletRoute) && /merged_child/.test(tabletRoute));
check("both routes: an on-the-house mark counts on ANY member of the party",
  /in\("table_number", \[t, \.\.\.partyKids/.test(editorRoute) && /in\("table_number", \[t, \.\.\.partyKids/.test(tabletRoute));

console.log(fail ? `\n${fail} merge-party check(s) FAILED` : "\nAll merge-party checks passed — a merged party is one bill everywhere.");
process.exit(fail ? 1 : 0);
