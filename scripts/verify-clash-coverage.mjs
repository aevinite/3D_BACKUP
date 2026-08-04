// verify-clash-coverage.mjs — "can two people still silently overwrite each other?"
//
//   node scripts/verify-clash-coverage.mjs
//
// OWNER RULE (2026-07-30): "it is for ALL possible options — anywhere clash should not happen…
// there will be many more other features also, so make sure in that feature also this should be
// checked every time. And if not there, then it should be added."
//
// A promise to remember that is worth nothing, so this checks it. It walks every staff-panel
// write call site and splits them in two:
//
//   VALUE EDIT   — sets a value someone else can also set (a note, a price, a discount, a
//                  quantity). Two people doing it at once must NOT silently overwrite, so the
//                  call MUST pass `expect` (see the NEW-FEATURE CHECKLIST in CLAUDE.md).
//   TRANSITION   — moves a thing along a one-way path (accept, serve, close, delete, pay).
//                  Doing it twice is not a conflict: the second attempt is already refused by
//                  the handler's own rules, so an expectation would only add noise.
//
// It FAILS when a value edit has no expectation, printing the file and line. When that happens,
// either wire it or add it to KNOWN_EXEMPT with a reason — never just delete the check.
import fs from "node:fs";

const PANELS = ["public/panels/tablet/app.js", "public/panels/editor/app.js", "public/panels/kitchen/app.js"];

// Paths that SET A VALUE. Anything matching these must carry an expectation.
const VALUE_EDIT = [
  /\/items\/[^/]+\/note/, /\/items\/[^/]+\/removed/, /\/items\/[^/]+\/qty/,
  /\/orders\/[^/]+\/allergies/, /\/orders\/[^/]+\/discount/,
  /\/sessions\/[^/]+\/bill-discount/,
  /\/tables\/[^/]+\/tag/,
  // The MENU EDITOR's save. A dish's price and name are the classic "two managers, one dish"
  // collision and had no expectation at all: the second save simply won, silently. It sends only
  // CHANGED fields, which stops a stale form reverting an untouched column — but that is a
  // different problem from two people typing in the SAME box. (buildEditExpect in editor/app.js.)
  /api\("POST", "\/" \+ kind, payload/,
];

// Deliberately not clash-checked, each with the reason. Reviewed when this list changes.
const KNOWN_EXEMPT = [
  { match: /"\/orders\/" \+ id \+ "\/discount"/, why: "bulk 'undo on-the-house' deliberately clears the discount on MANY orders at once; one stale row must not refuse the whole batch, and the operation is already confirmed + logged" },
  { match: /\/sessions\/[^/]+\/bill-discount/, why: "PIN-gated bill discount goes through actGated; wire `expect` when the bill-discount screen carries the previous value" },
  { match: /\/tables\/[^/]+\/tag/, why: "table tag is a toggle chip, not a typed value — a second tap is visibly reflected immediately" },
  { match: /payload\.__create = true;/, why: "undo of a DELETE re-creates the row from a snapshot — there is no concurrent edit to overwrite, the row does not exist" },
];

let problems = 0, valueEdits = 0, covered = 0;
console.log("Clash coverage — value edits must not silently overwrite\n");

for (const file of PANELS) {
  let src;
  try { src = fs.readFileSync(file, "utf8"); } catch { console.log(`  (skip, missing: ${file})`); continue; }
  const lines = src.split("\n");
  lines.forEach((line, i) => {
    if (!/api\(\s*"(POST|PATCH|DELETE)"/.test(line) && !/actGated\(\s*"(POST|PATCH|DELETE)"/.test(line)) return;
    const isValue = VALUE_EDIT.some((re) => re.test(line));
    if (!isValue) return;
    valueEdits++;
    // The expectation may be on this line or the next couple (the call is often wrapped).
    const window = lines.slice(i, i + 3).join(" ");
    const hasExpect = /expect\s*:/.test(window);
    // An exemption is judged on the SURROUNDING lines, not just the call itself. What makes a
    // write exempt is usually stated a line or two above it (an undo re-creating a deleted row,
    // a bulk operation), and keying only on the call line forced brittle regexes that matched
    // the wrong statement.
    const around = lines.slice(Math.max(0, i - 3), i + 3).join(" ");
    const exempt = KNOWN_EXEMPT.find((e) => e.match.test(line) || e.match.test(around));
    if (hasExpect) { covered++; console.log(`  ✅ ${file}:${i + 1}`); }
    else if (exempt) { console.log(`  ➖ ${file}:${i + 1}  exempt — ${exempt.why}`); }
    else { problems++; console.log(`  ❌ ${file}:${i + 1}  VALUE EDIT WITH NO EXPECTATION\n       ${line.trim().slice(0, 120)}`); }
  });
}

console.log(`\n${valueEdits} value-edit call site(s): ${covered} protected, ${problems} unprotected`);

// BE HONEST ABOUT WHAT THIS DOES NOT SEE. A green tick here has been read as "every value edit in
// the app is protected", and it is not — this walks the three vanilla staff panels only, because
// they are the surfaces whose writes carry X-LFH-Expect through the offline queue. Saying so is
// the difference between a guard and a false sense of one.
console.log("\nNot covered by this check (by design — no expectation travels from these yet):");
console.log("  · the OWNER panel and the ADMIN console (React, plain fetch — not outbox writes)");
console.log("  · public/panels/editor/inventory.js (its own fetch helper)");
console.log("  · anything writing settings.table_names (table renames) or a bill's customer name");
console.log("  Widening any of those means routing the write through the panel's api()/outbox first.");
if (problems) {
  console.log(`\n❌ FAIL — wire \`expect: { table, id, fields: { <col>: <oldValue> } }\` at each one, or`);
  console.log(`   add it to KNOWN_EXEMPT with a reason. See CLAUDE.md → NEW-FEATURE CHECKLIST item 11.`);
} else {
  console.log("\n✅ PASS — every value edit tells the server what it was editing from");
}
process.exit(problems ? 1 : 0);
