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
// Read a repo file, or null when it has moved (which is itself reported as a failure below —
// a guard that silently skips a file it cannot find is a guard that stops guarding).
const read = (f) => { try { return fs.readFileSync(f, "utf8"); } catch { return null; } };
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

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// PASS 2 — THE REACT SCREENS (added 2026-08-04, sweep finding F21)
//
// Until now this file scanned the three vanilla panels ONLY, and said so in a footnote. A footnote
// is not a guard: the exit code was 0 while the entire owner + admin surface — every person's PAY,
// their job, a restaurant's settings — could silently overwrite, because nothing there sent an
// expectation and no route there read one.
//
// The React screens don't go through the outbox, so they can't be matched by URL path the way the
// panels are. They are matched by the ACTION they send instead, which is how those routes dispatch.
// Two things must be true for each, and BOTH are checked, because either alone is theatre:
//   1. the CALL SITE sends what it was editing from (`expect:` → the X-LFH-Expect header), and
//   2. the ROUTE reads it (`expectClash`), or the header goes nowhere.
const REACT_VALUE_EDITS = [
  {
    // INVENTORY (added 2026-08-04, sweep finding F4). This module was listed in the footnote at
    // the bottom of this file as "not covered — its own fetch helper", and that footnote was the
    // whole problem: a stock count is the likeliest two-people-at-once edit in the product (the
    // count sheet is shared by design) and `POST /counts/:id/line` upserts on (count_id, item_id),
    // so the second person to save silently won and `submit` adjusted stock to their figure.
    // Matched by ACTION like the React screens below, because inventory.js posts by path+body
    // rather than through the panels' api().
    file: "public/panels/editor/inventory.js",
    route: "app/api/inventory/[...path]/route.ts",
    patterns: [
      { re: /inv\("POST",\s*`\/counts\/\$\{[^}]+\}\/line`/, name: "save a stock-count line" },
      { re: /inv\("POST",\s*isNew \? "\/items" : "\/items\/"/, name: "save an ingredient" },
    ],
  },
  {
    file: "components/admin/StaffProfile.tsx",
    route: "app/api/admin/users/route.ts",
    // A typed value someone else can also type. `set_permissions` is a dropdown (a toggle whose
    // second tap is visibly reflected) and `set_active`/`set_pin` are transitions, so they are not
    // listed — same split as the panel pass above.
    actions: ["set_job", "set_profile"],
    // Stated exemptions, judged the same way the panel pass judges its own: a TOGGLE whose second
    // tap is visibly reflected, and a one-way TRANSITION, are not conflicts.
    exempt: [
      { match: /in_payroll:\s*on/, why: "on/off the pay list is a toggle — the second tap is visibly reflected, and the amount itself IS protected" },
      { match: /left_on:\s*new Date/, why: "marking someone as left is a one-way transition (it also switches the login off), not a value two people type" },
      { match: /left_on:\s*""/, why: "un-marking a leaver is the undo of that transition — the same reasoning" },
    ],
  },
  // ── THE OWNER PANEL (added by the T9 sweep, 2026-08-05) ──────────────────────────────────────
  // This was the footnote at the bottom of this file — "the OWNER panel's own writes … no
  // expectation travels from these yet" — and a footnote is not a guard, which is the exact lesson
  // the 2026-08-04 pass wrote down one block above and then repeated here.
  //
  // What made it matter rather than merely untidy: the owner panel has its OWN profile page
  // (app/owner/staff/[id]/page.tsx) writing the SAME staff_users columns as the admin's
  // StaffProfile — pay_type/pay_amount/pay_day/pay_mode included. So a person's SALARY was
  // protected through /api/admin/users and completely open through /api/owner/staff. The check
  // above proved the admin door; nothing proved the owner's.
  {
    file: "app/owner/staff/[id]/page.tsx",
    route: "app/api/owner/staff/route.ts",
    // `set_permissions` is a dropdown and `set_payroll`/`set_own_pay` are toggles — same split as
    // every other pass here. `void_payment` is a one-way transition with a mandatory reason.
    actions: ["set_job", "set_profile"],
    exempt: [
      { match: /in_payroll:/, why: "on/off the pay list is a toggle — the rate itself IS protected" },
    ],
  },
  {
    file: "app/owner/staff/page.tsx",
    route: "app/api/owner/staff/route.ts",
    // The roster's inline rename: a name and a phone number typed into a box.
    actions: ["edit"],
    exempt: [
      { match: /action:\s*"set_active"/, why: "enable/disable is a toggle, visibly reflected" },
      { match: /action:\s*"set_role"/, why: "a role change is a transition the server re-validates" },
      { match: /action:\s*"reset_password"/, why: "issuing a new password is a transition, not a value two people type" },
      { match: /action:\s*"set_payroll"/, why: "pay-list on/off is a toggle" },
    ],
  },
  {
    file: "app/owner/issues/page.tsx",
    route: "app/api/owner/ratings/route.ts",
    // The internal reply NOTE on a guest rating — a free-text box any co-owner can open on the
    // same rating. Acknowledging is a transition and deliberately sends nothing.
    patterns: [{ re: /body:\s*JSON\.stringify\(\{\s*id,\s*note:/, name: "reply note on a rating" }],
  },
];

for (const spec of REACT_VALUE_EDITS) {
  const src = read(spec.file);
  if (!src) { console.log(`\n  ❌ ${spec.file} — not found (if it moved, update this guard)`); problems++; continue; }
  const routeSrc = read(spec.route);
  console.log(`\n${spec.file}  (React — matched by action, not by path)`);

  // (2) first: does the route even read an expectation? If not, every call site below is theatre.
  const routeReads = !!routeSrc && /expectClash\s*\(/.test(routeSrc);
  if (routeReads) console.log(`  ✅ ${spec.route} reads the expectation (expectClash)`);
  else { problems++; console.log(`  ❌ ${spec.route} NEVER CALLS expectClash — an X-LFH-Expect header sent from the screen would be ignored`); }

  // (1) then each call site. `actions` are matched as quoted strings (how the React screens send
  // an action name); `patterns` are matched as regexes, which is what a panel written with
  // template literals needs — `api("POST", `/counts/${id}/line`)` contains no quoted action, so
  // the string form silently matched NOTHING and the file looked covered when it was not.
  const lines = src.split(/\r?\n/);
  lines.forEach((line, i) => {
    const act = (spec.actions || []).find((a) => line.includes(`"${a}"`))
      || (spec.patterns || []).map((p) => (p.re.test(line) ? p.name : null)).find(Boolean);
    if (!act) return;
    valueEdits++;
    // The expectation is usually the patch() call's SECOND argument, so it can be a few lines DOWN
    // — but when the call is a plain fetch() the X-LFH-Expect header sits in the `headers` object
    // ABOVE the body line this loop matches on. Looking only forward marked two genuinely-protected
    // owner-panel writes as unprotected (T9 sweep, 2026-08-05), and "move your code so the regex
    // can see it" is the wrong way round. The panel pass above already judges its exemptions on the
    // surrounding lines for the same reason; this window now does too.
    const window = lines.slice(Math.max(0, i - 8), i + 8).join(" ");
    const ex = (spec.exempt || []).find((e) => e.match.test(line));
    // Case-INSENSITIVE on purpose: a helper that builds the expectation is usually camelCase
    // (`profileExpect(...)`), and the first version of this check missed all four of them because
    // it only looked for a lowercase "expect". A guard that misses the real shape of the fix is a
    // guard that gets deleted.
    if (/expect|fields\s*:/i.test(window)) { covered++; console.log(`  ✅ ${spec.file}:${i + 1}  ${act}`); }
    else if (ex) { console.log(`  ➖ ${spec.file}:${i + 1}  ${act} — exempt: ${ex.why}`); }
    else { problems++; console.log(`  ❌ ${spec.file}:${i + 1}  ${act} — VALUE EDIT WITH NO EXPECTATION\n       ${line.trim().slice(0, 110)}`); }
  });
}

console.log(`\n${valueEdits} value-edit call site(s): ${covered} protected, ${problems} unprotected`);

// BE HONEST ABOUT WHAT THIS DOES NOT SEE. A green tick here has been read as "every value edit in
// the app is protected", and it is not — this walks the three vanilla staff panels only, because
// they are the surfaces whose writes carry X-LFH-Expect through the offline queue. Saying so is
// the difference between a guard and a false sense of one.
console.log("\nNot covered by this check (by design — no expectation travels from these yet):");
console.log("  · owner/settings module toggles (a switch, visibly reflected; the admin owns these now)");
console.log("  · a bill's customer name (its capture RPC is idempotent, so a repeat is harmless)");
// THE OWNER PANEL used to be listed here as a whole, and that footnote is what let a person's
// SALARY stay overwritable: the owner panel's own profile page writes the same staff_users columns
// the admin's StaffProfile does, so "not covered by design" quietly covered money. Its three typed
// surfaces (staff job/profile, the roster rename, a rating's reply note) are checked ABOVE now.
// INVENTORY used to be listed here, and being listed here was never a defence: a shared stock-count
// sheet is the likeliest silent overwrite in the whole product, and it sat under this footnote while
// `POST /counts/:id/line` upserted last-wins. It is checked ABOVE now — both of its value edits, and
// that its route actually reads the expectation.
// TABLE RENAMES used to be listed here as unprotected. They no longer are: the settings save
// sends an expectation too (buildEditExpect → `general`), which needed lib/clashCompare.ts to
// compare OBJECTS by content — every table name lives inside one `table_names` blob, and the old
// comparator turned every object into "[object Object]", so the check could never have fired.
console.log("  (table renames and staff pay/permissions WERE listed here — both are protected now.)");
console.log("  Widening any of those means routing the write through the panel's api()/outbox first.");
if (problems) {
  console.log(`\n❌ FAIL — wire \`expect: { table, id, fields: { <col>: <oldValue> } }\` at each one, or`);
  console.log(`   add it to KNOWN_EXEMPT with a reason. See CLAUDE.md → NEW-FEATURE CHECKLIST item 11.`);
} else {
  console.log("\n✅ PASS — every value edit tells the server what it was editing from");
}
process.exit(problems ? 1 : 0);
