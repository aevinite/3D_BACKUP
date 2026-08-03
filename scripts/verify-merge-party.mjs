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
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const editor = read("public/panels/editor/app.js");
const tablet = read("public/panels/tablet/app.js");
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
check("manager: the printed bill combines identical dish lines (combineBillLines)",
  /function combineBillLines/.test(editor) && /combineBillLines\(live\.reduce/.test(editor));
check("manager: the paper bill names every table of the party (mergeGroupLabel in printBill)",
  /const tableDisp = mergeGroupLabel\(tnum\)/.test(editor));

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
    const body = src.slice(i, i + 800);
    check(`${name} route: tables/:t/${a} resolves a merged child to its parent`, /mergeParentTable\(/.test(body));
  }
}
check("tablet route: tables/:t/unpay resolves a merged child to its parent",
  /c === "unpay"[\s\S]{0,700}mergeParentTable\(/.test(tabletRoute));
check("tablet route: the waiter summary carries the live merges list",
  /table_merges[\s\S]{0,300}summaryOut/.test(tabletRoute));
check("lib/tableMerge.ts exists (the one shared resolver)",
  read("lib/tableMerge.ts").includes("export async function mergeParentTable"));

console.log(fail ? `\n${fail} merge-party check(s) FAILED` : "\nAll merge-party checks passed — a merged party is one bill everywhere.");
process.exit(fail ? 1 : 0);
