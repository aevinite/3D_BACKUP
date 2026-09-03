#!/usr/bin/env node
// scripts/verify-kitchen-screen.mjs — THE KITCHEN SCREEN'S OWN GUARD.
//
// WHY THIS EXISTS. Sweep #8's terminal 9 owns the kitchen screen: `app/kitchen/**`,
// `app/api/kitchen/[...path]/route.ts` and `public/panels/kitchen/**`. That territory is covered by
// 1,515 permanent numbered checks in `.claude/sweep/LEDGER/T6.md` plus 145 more scattered across
// eleven other ledgers — and the ledger's whole value is that the NEXT sweep can re-run it instead
// of inventing a different 500. Re-reading those rows by eye takes a day and leaves nothing
// re-runnable, so every row whose verification is "read the file" / "grep both files" is an
// assertion in here, keyed by its own ledger id:
//
//     npm run verify:kitchen                       # everything
//     npm run verify:kitchen -- --only P02534      # exactly one ledger row, forever
//     npm run verify:kitchen -- --only P62701,P62740
//
// ROUND 2's DRIVEN blocks are NOT in here, on purpose — they need a browser and a running server,
// which a PostToolUse hook cannot have. Run them yourself against your own port:
//     node scripts/sweep/t9/round2-values.mjs   --base=http://localhost:4309   # 266 rows
//     node scripts/sweep/t9/round2-states.mjs   --base=http://localhost:4309   #  70 rows
//     node scripts/sweep/t9/round2-overlays.mjs --base=http://localhost:4309   #  49 rows
//     node scripts/sweep/t9/live.mjs            --base=http://localhost:4309   #  46 rows
//     node scripts/sweep/t9/replay-t6-driven.mjs  --base=http://localhost:4309 # 170 rows (item 10)
//     node scripts/sweep/t9/replay-t6-driven2.mjs --base=http://localhost:4309 # 132 rows (item 10)
// Round 2's STATIC blocks (D and E, 115 rows) ARE in here and run with everything else.
//
// It is a STATIC guard on purpose — it takes about a second and needs no server, so it can run in
// the PostToolUse hook on a kitchen edit. The rows that need a running browser live in
// `scripts/sweep/t9/live.mjs` (headless, `--base=http://localhost:<port>`), and the rows that need
// a screenshot looked at cannot be mechanised and stay a human read.
//
// JUDGE THIS GUARD BY READING IT, NEVER BY ITS GREEN. It was sabotage-tested six ways while it was
// being written (narrow `boardSig` back to a field list · let `tshort` print "Tnull" · a flat 2s
// poll · a silent `return` on a tap · a stale asset hash · drop the 86 drawer's back layer) and
// five of the six went red on the right rows. The sixth did NOT — there was no row anywhere
// asserting `tshort`'s null guard — which is now `P63221` below. A guard that cannot fail is worse
// than no guard, so if you add a row here, break the thing it defends and watch it go red.
import { runRows, report, row, APP, APPC, hasRe } from "./sweep/t9/lib.mjs";

for (const m of ["replay-block1", "replay-block1b", "replay-block2", "replay-contracts",
                 "new-a-blocked-and-menu", "new-c-printing", "new-e-route-and-rest",
                 "replay-other-ledgers", "new-f-items789",
                 "round2-contracts", "round2-crosspanel",
                 "replay-t6-b1", "replay-t6-b2", "replay-t6-b3", "replay-t6-b4", "replay-t6-b5",
                 "round3-branches", "round3-paths"]) {
  await import("./sweep/t9/" + m + ".mjs");
}

// ── THE ROW THE SABOTAGE PASS FOUND MISSING — P63221–P63230 ──────────────────────────────────
// Sabotaging `tshort()` back to `tname(t) || \`T${t}\`` — the exact fault that printed the literal
// "Tnull" in a ticket header a cook reads — left this whole suite GREEN. P02539 asserts the `T<n>`
// fallback and P02540 asserts `tlong`'s "T?", but NOTHING asserted `tshort`'s null guard, which is
// the half that was fixed later and the half that reaches the SCREEN.
row("P63221", "tshort() answers \"T?\" for a null or empty table, so a banquet ticket cannot read \"Tnull\"", () =>
  hasRe(APPC(), /const tshort = \(t\) => \(t == null \|\| t === "" \? "T\?" :/));
row("P63222", "tshort() and tlong() give the SAME answer for a missing table, so screen and paper agree", () => {
  const a = APPC();
  const s = (a.match(/const tshort = \(t\) => \(t == null \|\| t === "" \? "([^"]*)"/) || [])[1];
  const l = (a.match(/const tlong = \(t\) => \(t == null \|\| t === "" \? "([^"]*)"/) || [])[1];
  return (s && l && s === l) || `tshort says "${s}", tlong says "${l}"`;
});
row("P63223", "neither can emit the literal string \"null\", \"undefined\" or \"NaN\" into a ticket header", () => {
  const a = APPC();
  const both = (a.match(/const tshort = [^\n]*\n/) || [""])[0] + (a.match(/const tlong = [^\n]*\n/) || [""])[0];
  return (/t == null/.test(both) && (both.match(/t == null/g) || []).length === 2) || "one of the two is unguarded";
});
row("P63224", "the ticket header's title attribute is guarded against the same value", () =>
  hasRe(APPC(), /o\.table_number == null \|\| o\.table_number === "" \? "" : ` title=/));
// EXPECTATION CHANGED by item 9: a DINE-IN ticket still takes its label from the guarded helper,
// and a DELIVERY passes its own (it has no table). Both halves matter, so both are asserted.
row("P63225", "the printed KOT still takes a dine-in table label from the same guarded helper", () =>
  hasRe(APPC(), /const tlab = \(opts && opts\.tableLabel\) \|\| whereFor\(order, true\);/));

const only = (process.argv.find((a) => a.startsWith("--only")) || "").replace(/^--only=?/, "").trim()
  || (process.argv[process.argv.indexOf("--only") + 1] || "").trim();
const ids = only && /^P\d/.test(only) ? only.split(",").map((s) => s.trim()) : null;

const res = runRows(ids ? { only: ids } : {});
const ok = report("THE KITCHEN SCREEN — static ledger replay + sweep #8 T9 checks", res);
if (!ok) console.log(`\n  re-run just this:  npm run verify:kitchen -- --only ${res.failures.map((f) => f.id).join(",")}`);
process.exit(ok ? 0 : 1);
