#!/usr/bin/env node
// RE-RUN TERMINAL 3'S 500 PHASES — one command.
//
//   npm run sweep:t3          # needs a dev server on 4103 (npm run dev -- -p 4103)
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
results.push(["block 3a — the basket, the doors, no signal", run("BLOCK 3a — the basket, the doors, no signal", join(here, "basket-and-doors.mjs"))]);
results.push(["block 3b — the whole journey, end to end", run("BLOCK 3b — the whole journey, end to end", join(here, "order-end-to-end.mjs"))]);
results.push(["block 4 — the captures + the bottom-corner hit-test", run("BLOCK 4 — the captures + the hit-test", join(here, "screens.mjs"))]);
results.push(["block 5 — tracing a change across panels", run("BLOCK 5 — tracing a change across panels", join(here, "across-panels.mjs"))]);

console.log("\n================ T3 SUMMARY ================");
let bad = 0;
for (const [name, ok] of results) { console.log(`${ok ? "✅" : "❌"} ${name}`); if (!ok) bad++; }
console.log(bad
  ? `\n❌ ${bad} block(s) failed — read the rows above, then the ledger row with the same id.`
  : "\n✅ every block green. Block 6 is judgment — read it in .claude/sweep/LEDGER/T3.md.");
console.log("Screenshots must still be OPENED AND LOOKED AT — a green run is not evidence the screen is right.");
process.exit(bad ? 1 : 0);
