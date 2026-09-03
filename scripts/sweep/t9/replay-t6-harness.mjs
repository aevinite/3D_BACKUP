// ITEM 10 — THE 1,002 CHECKS NOBODY COULD RE-RUN, MADE RE-RUNNABLE.
//
// `.claude/sweep/LEDGER/T6.md` holds three blocks of checks for the kitchen screen. 1,002 of its
// rows say their verification is *"re-runnable in this terminal's harness"* / *"in this session's
// harness"* — and that harness was a script in a worktree that no longer exists. It was never put
// in the repo, so those 1,002 checks could not be replayed by anyone.
//
// THE TRAP THAT MAKES THIS WORTH FIXING: a check nobody can run looks EXACTLY like a check that
// passed. All 1,002 carry a ✅ and no one — me included — could tell whether they still held. This
// repo has been bitten five times by a guard that asserted nothing while printing all-pass.
//
// So every one of those ids gets a real predicate here, against the shipped files, keyed to its own
// number: `npm run verify:kitchen -- --only P17601` works, forever.
//
// TABLE-DRIVEN ON PURPOSE. One line per check keeps 1,002 of them readable and makes the pattern
// obvious to whoever adds the next. A predicate is either a RegExp (must match), a string (must be
// contained), or a function (given the sources). Prefix a RegExp/string with `!` in the mode column
// to require ABSENCE.
import { row, APP, APPC, HTML, CSS, CSSC, ROUTE, ROUTEC, PAGE, LAYOUT, P, src, contentHash } from "./lib.mjs";
import { readFileSync, existsSync } from "node:fs";

// which source each check reads
const SRC = {
  A: () => APPC(),        // app.js, comments stripped — judge the code, never the prose about it
  Araw: () => APP(),      // app.js as shipped (for rows that are ABOUT a comment/obituary)
  H: () => HTML(),
  C: () => CSSC(),
  Craw: () => CSS(),
  R: () => ROUTEC(),
  Rraw: () => ROUTE(),
  PG: () => PAGE(),
  L: () => LAYOUT(),
  BD: () => readFileSync(P("public/panels/billdoc.js"), "utf8"),
  PQ: () => readFileSync(P("lib/printQueue.ts"), "utf8"),
  PH: () => readFileSync(P("lib/printHelpers.ts"), "utf8"),
  TH: () => readFileSync(P("public/panels/theme.js"), "utf8"),
  TAB: () => readFileSync(P("public/panels/tablet/app.js"), "utf8"),
  ED: () => readFileSync(P("public/panels/editor/app.js"), "utf8"),
  SP: () => readFileSync(P("lib/staffProfileShared.ts"), "utf8"),
};

/** Register one replayed row. `where` is a SRC key; `want` is a RegExp, a string, or a function. */
export function t6(id, label, where, want) {
  row(id, label, () => {
    const get = SRC[where];
    if (!get) return `unknown source key "${where}"`;
    const text = get();
    if (typeof want === "function") return want(text, SRC);
    if (want instanceof RegExp) return want.test(text) || `no match for ${want}`;
    if (typeof want === "string") {
      if (want.startsWith("!")) { const n = want.slice(1); return !text.includes(n) || `still present: ${n}`; }
      return text.includes(want) || `missing: ${want}`;
    }
    return "no predicate given";
  });
}
/** A row whose subject genuinely cannot be settled by reading a file. Recorded as skipped, honestly. */
export function t6skip(id, label, why) {
  row(id, label, () => `⏭ ${why}`);
}
