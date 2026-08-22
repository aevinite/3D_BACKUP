#!/usr/bin/env node
// RE-RUN TERMINAL 3'S 500 PHASES — one command.
//
//   npm run sweep:t3          # needs a dev server on 4103 (npm run dev -- -p 4103)
//   T3_BASE=http://localhost:4203 npm run sweep:t3     # …or on whatever port is proved YOURS
//
// PORT. Every sweep terminal is given its own port, and 4103 was sweep #6's. A hard-coded base URL
// meant a later run either measured NOTHING (nothing answers there) or, worse, measured ANOTHER
// live session's dev server and reported its state as this branch's. So all four runners now read
// `T3_BASE` and fall back to 4103. Set it to the port you have proved is yours
// (CLAUDE.md: "verify on a port you PROVED is yours").
//
// The ledger (.claude/sweep/LEDGER/T3.md) is the permanent record of WHAT is checked; these
// runners are the permanent record of HOW. They were scratch on the first sweep and had to be
// rebuilt from the ledger's "how to verify" column the next time the owner asked for a re-run —
// which is exactly the cost the ledger exists to avoid, so they live here now.
//
// Blocks 1+2 (the 300 static rows) are encoded in `npm run verify:guest-doors` plus the named
// verify gates; blocks 3, 4 and 5 are the three runners below. Block 6 is judgment and is read,
// not run.
//
// Aangan is the READ-ONLY control throughout. Every row created on French House is removed by its
// own id in the same run, in a finally, and a table another party is already on is never joined.
import { spawnSync } from "node:child_process";

// BE GENTLE WITH THE APP'S OWN LIMITS — the rule this suite broke once.
//
// Run back to back, blocks 3a, 3b and 5 all drive the SAME restaurant: 3a works the table gate
// several times, then 3b places an order, then 5 places another with two phones. Together that
// crossed the per-table ordering limit, so place-order started coming back refused and SEVEN rows
// went red — on nothing but the load this suite itself was making. Run singly, every one of them
// passes. A test that trips the product's own protections is measuring itself, not the product, and
// CLAUDE.md forbids it outright ("never trip the app's own rate limits while testing").
//
// So the blocks that write wait for the limit window to roll over. It costs the run about two and a
// half minutes and buys results that mean something.
// Two lengths, because the blocks are not equally heavy on the restaurant's guest limits: 3b joins
// once and places one order; block 5 joins TWICE (two phones) and places another, arriving last with
// the whole run's spend already behind it. 75s was enough before 3b and not before 5.
const COOLDOWN_MS = 75_000;
const LONG_COOLDOWN_MS = 165_000;
const cool = (why, ms = COOLDOWN_MS) => {
  const s = Math.round(ms / 1000);
  console.log(`\n⏳ waiting ${s}s before ${why} — letting the restaurant's own per-table limits roll over, so the next block measures the product and not this suite's load.`);
  return new Promise((r) => setTimeout(r, ms));
};
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", "..");
const run = (label, file, args = []) => {
  console.log(`\n################ ${label} ################`);
  const r = spawnSync(process.execPath, [file, ...args], { cwd: root, stdio: "inherit" });
  return r.status === 0;
};

const results = [];
results.push(["blocks 1+2 — the static rules", run("BLOCKS 1+2 — the static rules", join(root, "scripts/verify-guest-doors.mjs"))]);
// Sweep 7's own 300 code-reading rows, P16101..P16400. Same idea as the line above: the ledger says
// WHAT is checked, this says HOW, so a re-run never has to be rebuilt from the ledger's prose.
results.push(["sweep 7 block A — the 300 code-reading rows", run("SWEEP 7 BLOCK A — the 300 code-reading rows (P16101-P16400)", join(here, "s7-checks.mjs"), ["--quiet"])]);
results.push(["block 3a — the basket, the doors, no signal", run("BLOCK 3a — the basket, the doors, no signal", join(here, "basket-and-doors.mjs"))]);
await cool("the end-to-end order block");
results.push(["block 3b — the whole journey, end to end", run("BLOCK 3b — the whole journey, end to end", join(here, "order-end-to-end.mjs"))]);
// Block 4 only browses and screenshots — no order, so it needs no cooldown and doubles as one.
results.push(["block 4 — the captures + the bottom-corner hit-test", run("BLOCK 4 — the captures + the hit-test", join(here, "screens.mjs"))]);
await cool("the cross-panel block — two phones joining and another order, the heaviest of the five", LONG_COOLDOWN_MS);
results.push(["block 5 — tracing a change across panels", run("BLOCK 5 — tracing a change across panels", join(here, "across-panels.mjs"))]);

console.log("\n================ T3 SUMMARY ================");
let bad = 0;
for (const [name, ok] of results) { console.log(`${ok ? "✅" : "❌"} ${name}`); if (!ok) bad++; }
console.log(bad
  ? `\n❌ ${bad} block(s) failed — read the rows above, then the ledger row with the same id.`
  : "\n✅ every block green. Block 6 is judgment — read it in .claude/sweep/LEDGER/T3.md.");
console.log("Screenshots must still be OPENED AND LOOKED AT — a green run is not evidence the screen is right.");
if (!results[4][1]) {
  console.log("\nNOTE ON BLOCK 5: it drives TWO phones, two joins, an order, a table rename and a table");
  console.log("close on a restaurant up to ten other terminals are also driving — whose tables carry");
  console.log("sessions left open since early August. It has failed three times on that contention and");
  console.log("never once on a product fault. If it is red here, run it on its own while the restaurant");
  console.log("is quiet before believing it:");
  console.log("    node scripts/sweep/t3/across-panels.mjs");
  console.log("The lasting fix is a table range (or a restaurant) no other terminal touches — a decision");
  console.log("about the shared test stack, recorded for the owner in .claude/sweep/LEDGER/T3.md.");
}
process.exit(bad ? 1 : 0);
