#!/usr/bin/env node
// verify-panel-twins.mjs — do the manager, kitchen and waiter versions of the SAME action agree?
//
// WHY THIS EXISTS. About forty endpoint names are shared by the three staff panel routes
// (app/api/editor, /kitchen, /tablet) with no shared code between them, so a fix applied to one is a
// fix the other two silently don't get. That is not a hypothetical: PR #852 found five fixes that had
// skipped the tablet, and the T4 sweep (2026-08-06) found two more of exactly that shape by hand —
// `requests/:id/resolve` missing the manager's `.eq("status","pending")` (a stale Approve could open a
// table nobody asked for), and six branches answering 200 when their update had matched no row while
// every sibling in the same file already 404'd.
//
// Hand-comparing three files is how both were found, and hand-comparing is exactly what stops
// happening once the sweep is over. So this turns the comparison into a guard.
//
// WHAT IT COMPARES — not the code, which legitimately differs, but the SAFETY SET each branch carries:
//   · does it 404/refuse when the row it targets is gone?      (a tap must never report success)
//   · is every query scoped by restaurant_id?                  (service-role means that IS the boundary)
//   · does it write an action-log row?                         (who did this, and when)
//   · does it record a Removal when it lowers money?           (the audit trail)
//   · does it stamp edited_at when it edits a placed order?    (the "✎ Edited" badge)
// A twin that has fewer of these than its sibling is the shape of every drift found so far.
//
// INTENTIONAL differences are allow-listed below WITH THE REASON — the kitchen owns "ready", the
// manager owns "reopen", and so on. An unexplained difference fails; an explained one doesn't.
// Read-only. `npm run verify:twins`.
import { readFileSync, existsSync } from "node:fs";

const ROUTES = {
  manager: "app/api/editor/[...path]/route.ts",
  kitchen: "app/api/kitchen/[...path]/route.ts",
  waiter: "app/api/tablet/[...path]/route.ts",
};

// ── differences we have decided are correct, and why ─────────────────────────────────────────────
// key: "<endpoint>|<panel>|<missing-trait>"  →  the reason it is missing ON PURPOSE.
const ALLOWED = {
  // The kitchen is a cooking display: it holds no bills, so nothing it does can lower money.
  "orders/accept|kitchen|removal": "the kitchen takes no money off a bill — nothing to audit",
  "orders/ready|kitchen|removal": "same — cooking a dish is not a money change",
  "items/status|kitchen|removal": "same",
  "items/status|waiter|removal": "serving a dish moves no money",
  "items/status|manager|removal": "serving a dish moves no money",
  "orders/accept|waiter|removal": "accepting an order does not lower a bill",
  "orders/accept|manager|removal": "accepting an order does not lower a bill",
  "orders/serve-all|kitchen|removal": "the kitchen never serves — that is the waiter's action",
  "orders/serve-all|waiter|removal": "serving is not a money change",
  "orders/serve-all|manager|removal": "serving is not a money change",
  // edited_at marks a change to what the kitchen will COOK. Status moves are not edits.
  "items/status|kitchen|edited": "a status move is not an edit to the ticket's contents",
  "items/status|waiter|edited": "a status move is not an edit to the ticket's contents",
  "items/status|manager|edited": "a status move is not an edit to the ticket's contents",
  "orders/accept|kitchen|edited": "accepting is not an edit",
  "orders/accept|waiter|edited": "accepting is not an edit",
  "orders/accept|manager|edited": "accepting is not an edit",
  "orders/ready|kitchen|edited": "marking cooked is not an edit",
  "orders/serve-all|kitchen|edited": "not an edit",
  "orders/serve-all|waiter|edited": "not an edit",
  "orders/serve-all|manager|edited": "not an edit",
  "orders/allergies|kitchen|edited": "the kitchen has no allergy-edit endpoint of its own",
  // The kitchen's own actions are logged, but it has no Removal/edited concept at all.
  "dishes/sold-out|kitchen|removal": "the 86 board changes availability, not money",
  "dishes/sold-out|kitchen|edited": "the 86 board edits the MENU, not a placed order",
  // ── differences that are a different JOB, not a missing guard ──────────────────────────────────
  "sessions/invoice|waiter|removal":
    "the manager's branch records `bill_changed_after_reopen` because only a MANAGER can void an "
    + "invoice and re-issue it; a waiter can only ever generate a first one, and generating is not a "
    + "money-lowering act. Nothing to audit on this side.",
  "sessions/open|waiter|refuses":
    "opening a table CREATES the row, so there is no 'the row is gone' case to refuse. The waiter "
    + "branch validates the table number against table_count instead (and openTableSession is "
    + "race-tolerant, so a concurrent open returns the session that won rather than failing).",
  "orders/delete|manager|refuses":
    "the manager's is a BULK delete ({ ids, all }) — a different operation from the waiter's single "
    + "orders/:id/delete. An id that has since gone is simply absent from the set, so there is nothing "
    + "to 404 on; it refuses on PERMISSION (void_bills + canDeleteBill) instead.",
  "tables/restart|waiter|refuses":
    "the two panels gate this differently ON PURPOSE: the manager REFUSES outright without the "
    + "void_bills power, while the waiter is asked for a MANAGER PIN (managerPinGate) when the round "
    + "still has food cooking or money owed. A PIN prompt is the waiter's refusal.",
};

let pass = true;
const problems = [];
const note = (m) => console.log("  " + m);

const src = {};
for (const [panel, f] of Object.entries(ROUTES)) {
  if (!existsSync(f)) { console.log(`✗ missing route file: ${f}`); process.exit(1); }
  src[panel] = readFileSync(f, "utf8");
}

// ── pull out each branch body by brace-matching from its `if (…) {` ──────────────────────────────
// Branches look like:  if (a === "orders" && c === "accept") {   …   }
// (also `b === "…"`, and `path.length === 1` forms, which we normalise to <a>/<b|c>.)
function branches(code) {
  const out = new Map();
  const re = /if \(a === "([a-z-]+)"(?:\s*&&\s*(?:b|c) === "([a-z-]+)")?(?:\s*&&\s*path\.length === 1)?\)\s*\{/g;
  let m;
  while ((m = re.exec(code))) {
    const name = m[2] ? `${m[1]}/${m[2]}` : m[1];
    let i = re.lastIndex - 1, depth = 0;
    // walk forward to the matching close brace (string/comment aware enough for this codebase)
    for (; i < code.length; i++) {
      const ch = code[i];
      if (ch === '"' || ch === "'" || ch === "`") {           // skip a string
        const q = ch; i++;
        while (i < code.length && code[i] !== q) { if (code[i] === "\\") i++; i++; }
        continue;
      }
      if (ch === "/" && code[i + 1] === "/") { while (i < code.length && code[i] !== "\n") i++; continue; }
      if (ch === "/" && code[i + 1] === "*") { i += 2; while (i < code.length && !(code[i] === "*" && code[i + 1] === "/")) i++; i++; continue; }
      if (ch === "{") depth++;
      else if (ch === "}") { depth--; if (depth === 0) break; }
    }
    const body = code.slice(m.index, i + 1);
    // A name can appear twice (e.g. a GET and a POST branch) — keep the LONGEST, which is the writer.
    if (!out.has(name) || out.get(name).length < body.length) out.set(name, body);
  }
  return out;
}

// ── the safety traits ────────────────────────────────────────────────────────────────────────────
const TRAITS = {
  // "does it refuse when the row it targets is gone?" — the SHAPE, not the status code. err() defaults
  // to 400, so a `if (!item) return err("…")` with no status is a perfectly good refusal and an earlier
  // version of this guard wrongly flagged three branches for it. `.single()` counts too: PostgREST
  // errors on zero rows, must() rethrows, and the catch turns it into a failure rather than a success.
  // The guarded expression can be a call or an index, not just a bare name — `if (!must(ownsShift))`
  // and `if (!row[0])` are the same promise to the person tapping, so both count.
  refuses: (b) => /if \(![\w.$]+(?:\([^)]*\))?(?:\[[^\]]*\])?(?:\?\.[\w.]+)?\)\s*(?:\{\s*)?return (?:err|NextResponse)/.test(b)
    || /if \(!\w+ \|\| /.test(b)
    || /if \(!\(/.test(b)                       // `if (!(await sb.from(…)).data) return err(…)`
    || /\.single\(\)/.test(b)
    || /ok:\s*false/.test(b)
    || /\.ok === false|ok === false/.test(b),
  scoped: (b) => !/\bsb\s*\n?\s*\.from\(|from\("/.test(b) || /\.eq\("restaurant_id", rid\)|p_rid|p_restaurant_id|mergeParentTable|closeSession|softDeleteOrders|settleBillInParts/.test(b),
  logs: (b) => /\blog\(|logAction\(/.test(b),
  removal: (b) => /recordRemoval\(/.test(b),
  edited: (b) => /stampEdited\(|edited_at/.test(b),
};
// Which traits are worth comparing for a given endpoint: only ones at least one twin HAS.
const per = {};
for (const [panel, code] of Object.entries(src)) per[panel] = branches(code);

const names = new Set();
for (const p of Object.keys(per)) for (const n of per[p].keys()) names.add(n);

if (process.argv.includes("--list")) {
  for (const p of Object.keys(per)) console.log(`\n${p}: ${[...per[p].keys()].sort().join(", ")}`);
  process.exit(0);
}
let shared = 0;
for (const name of [...names].sort()) {
  const have = Object.keys(per).filter((p) => per[p].has(name));
  if (have.length < 2) continue;                 // not a twin — nothing to compare
  shared++;
  const traits = {};
  for (const p of have) { traits[p] = {}; for (const [t, fn] of Object.entries(TRAITS)) traits[p][t] = fn(per[p].get(name)); }
  for (const t of Object.keys(TRAITS)) {
    const hasIt = have.filter((p) => traits[p][t]);
    const lacks = have.filter((p) => !traits[p][t]);
    if (!hasIt.length || !lacks.length) continue; // all agree — fine either way
    const unexplained = lacks.filter((p) => !ALLOWED[`${name}|${p}|${t}`]);
    if (unexplained.length) {
      pass = false;
      problems.push(`${name}: ${hasIt.join("+")} ${t === "refuses" ? "refuse when the row is gone" : t === "scoped" ? "scope by restaurant_id" : t === "logs" ? "log the action" : t === "removal" ? "record a Removal" : "stamp edited_at"}, ${unexplained.join("+")} do${unexplained.length > 1 ? "" : "es"} NOT`
        + `\n      → if that is deliberate, add "${name}|${unexplained[0]}|${t}" to ALLOWED in this file WITH the reason`);
    }
  }
}

note(`${names.size} endpoint branches found across the three panel routes`);
note(`${shared} of them exist in two or more panels (the twins this guard compares)`);
if (shared < 15) { pass = false; problems.push(`only ${shared} twins detected — the branch parser has probably stopped matching; fix it rather than trusting a green run`); }

if (problems.length) { console.log(""); for (const p of problems) console.log("  ✗ " + p); }
console.log(pass
  ? "\n✅ PASS — every shared action carries the same safety set in each panel (or has a recorded reason not to)"
  : "\n❌ FAIL — a fix that one panel got, its twin did not");
process.exit(pass ? 0 : 1);
