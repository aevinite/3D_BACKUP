#!/usr/bin/env node
// verify:one-bill-delete — a bill is deleted ONE BILL AT A TIME. There is no bulk clear.
//
// ── WHY (owner, 2026-08-21) ──────────────────────────────────────────────────────────────────────
//
// Asked what the manager panel's bulk clear-out was, he answered: *"we don't want that option,
// remove that option completely from manager panel"*, and on what may still be deleted: *"he can
// delete one bill but with reason."*
//
// What was there:
//   · `🗑 Clear freed` on the Bills record divider — one tap took every freed table in the day.
//   · a tick-box bulk bar (`#ordDeleteSelected`) — already dead, nothing rendered its checkboxes,
//     but the wiring was still binding handlers as if it were a feature.
//   · `deleteOrders(ids, all = true)` → `POST /orders/delete { all: true }` → the server read up to
//     300 deletable bills for the restaurant and tombstoned the lot. NO SCREEN passed `all` any
//     more, so it was a live bulk delete reachable only by hand-forming a request.
//
// ── THE RULE, AND WHY IT IS "ONE BILL" AND NOT "ONE ID" ─────────────────────────────────────────
//
// One bill is genuinely several order rows — a table's successive KOTs all hang off one session, and
// both the cancelled-bill card and the per-session delete hand over that whole group. So the server
// does not count ids; it checks they resolve to a SINGLE SESSION, which is what a bill actually is in
// this schema (there is no `bills` table — see lib/billLedger.ts). An order with no session (a
// counter parcel, a standalone banquet line) is its own bill, so exactly one of those may be named.
//
// That is the part worth guarding: a count cap can be widened by one number, whereas "the ids must
// be one bill" cannot be turned back into "clear the day" by any caller.
//
// R27 sits above all of this and is checked separately: `canDeleteBill()` is true for the Aevidine
// admin console only — a manager and an owner cancel, they never delete. Confirmed by the owner on
// 2026-08-21 when asked directly ("No — keep R27 exactly as it is"), so this guard asserts it too.
import { readFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");
/**
 * Source with LINE comments blanked — and DELIBERATELY NOT block comments.
 *
 * ⚠️ A NAIVE `/\*[\s\S]*?\*\/` STRIPPER SILENTLY EATS THE FILE. Measured on
 * app/api/editor/[...path]/route.ts: 412,233 chars in, 370,262 out — 42 KB gone, including the whole
 * of `canDeleteBill()`, because a `/*` inside a regex literal or a string pairs with a `*\/` tens of
 * thousands of characters later. A guard that cannot see the code it is checking reports a PASS, and
 * a guard that invents a pass is worse than no guard at all.
 *
 * Line comments are enough: every explanatory note in this repo's own style is `//`, and the
 * `[^:\\]` guard keeps a `//` inside a URL intact.
 */
const code = (t) => t.replace(/(^|[^:\\])\/\/[^\n]*/g, "$1 ");

let failed = 0;
const pass = (m) => console.log("  ok   " + m);
const fail = (m) => { console.log("  FAIL " + m); failed++; };

const panel = code(read("public/panels/editor/app.js"));
const route = code(read("app/api/editor/[...path]/route.ts"));
const tablet = code(read("public/panels/tablet/app.js"));

// ── 1. no bulk control anywhere in the manager panel ────────────────────────────────────────────
for (const [needle, what] of [
  ["clearFreed", "the 🗑 Clear freed button"],
  ["ordDeleteSelected", "the tick-box bulk delete"],
  ["ordSelectAll", "the select-all checkbox"],
]) {
  if (panel.includes(needle)) fail(`public/panels/editor/app.js still wires ${what} (${needle}) — bulk deleting was removed on 2026-08-21`);
  else pass(`no ${what} in the manager panel`);
}

// ── 2. nothing asks the server to sweep ────────────────────────────────────────────────────────
for (const [file, src] of [["public/panels/editor/app.js", panel], ["public/panels/tablet/app.js", tablet]]) {
  if (/\ball:\s*true\b/.test(src)) fail(`${file} posts { all: true } to a delete endpoint — the sweep is gone; name the bill's ids`);
  else pass(`${file} never asks for a sweep`);
}

// ── 3. the server has no sweep branch left ─────────────────────────────────────────────────────
for (const [needle, what] of [
  ["CLEAR_ALL_BATCH", "the 300-bill clear-all batch"],
  ["moreToClear", "the 'there are more to clear' reply"],
  ["cleared_all", "the cleared_all audit flavour"],
]) {
  if (route.includes(needle)) fail(`app/api/editor route still has ${what} (${needle})`);
  else pass(`the server has no ${what}`);
}

// ── 4. …and it ENFORCES one bill, rather than merely not offering a sweep ──────────────────────
// Assert the ENFORCEMENT, not the wording: the delete branch must group the named orders by session
// and refuse more than one. A guard that matched the sentence would go red the first time somebody
// reworded the error, which is how a guard stops being trusted.
const delBranch = route.slice(route.indexOf('a === "orders" && b === "delete"'));
const branch = delBranch.slice(0, delBranch.indexOf('return ok({ ok: true, deleted:'));
if (!branch) fail("could not find the orders/delete branch — this guard needs updating with it");
else {
  const selectsSession = /select\(\s*["'][^"']*session_id[^"']*["']\s*\)/.test(branch);
  // Bounded [\s\S], not [^)]* — the real line is `new Set(candidates.map((o) => o.session_id))`,
  // whose nested parens stop a [^)]* class dead. That made this check fail on correct code.
  const groupsSessions = /new Set\([\s\S]{0,120}?session_id/.test(branch);
  const refusesMany = /sessions\.size\s*>\s*1/.test(branch);
  if (selectsSession && groupsSessions && refusesMany) {
    pass("orders/delete resolves the named orders to their session and refuses more than one bill");
  } else {
    fail(`orders/delete no longer enforces one bill (reads session_id: ${selectsSession}, groups them: ${groupsSessions}, refuses >1: ${refusesMany})`);
  }
  if (/MAX_ORDERS_PER_BILL/.test(branch)) pass("…and an absurdly long id list is refused before any read");
  else fail("orders/delete no longer caps the id list before reading — a huge list should be refused up front");
}

// ── 5. R27: only the Aevidine admin console may delete at all ─────────────────────────────────
const gate = route.match(/async function canDeleteBill[\s\S]{0,200}?\n}/);
if (!gate) fail("canDeleteBill() is gone — R27 says a restaurant cancels and never deletes (docs/REJECTED-IDEAS.md R27)");
else if (/return\s*!g\.user\s*;/.test(gate[0])) pass("R27 holds: canDeleteBill() is true for the admin console only — a manager and an owner cancel");
else fail(`canDeleteBill() no longer returns !g.user. R27 (owner, 2026-08-16, re-confirmed 2026-08-21) says nobody at the restaurant deletes a bill:\n         ${gate[0].replace(/\s+/g, " ").slice(0, 160)}`);

console.log(failed
  ? `\n✗ verify:one-bill-delete — ${failed} check${failed === 1 ? "" : "s"} failed. Bulk bill-deleting was removed on the owner's instruction; do not bring it back.`
  : "\n✓ verify:one-bill-delete — one bill at a time, admin console only, no sweep anywhere");
process.exit(failed ? 1 : 0);
