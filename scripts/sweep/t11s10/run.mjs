// node scripts/sweep/t11s10/run.mjs [--ledger] [--only P180041,P180042] [--blocks a,b,…]
// Sweep #10 terminal 11's new checks. Blocks: a = the route in memory (no server needed) ·
// b = the panel's own functions run in the real panel · c = the rendered board driven ·
// d = screenshots + cross-panel + live rows · e = project-rule conformance read off the source.
// b, c and d need this terminal's dev server (T11_BASE, default http://localhost:4411).
import { runAll, closeAll } from "./lib.mjs";
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const blocks = (arg("--blocks") || "a,b,c,d,e").split(",");
const files = { a: "new-a-route.mjs", b: "new-b-helpers.mjs", c: "new-c-board.mjs", d: "new-d-live.mjs", e: "new-e-rules.mjs" };
for (const b of blocks) await import("./" + files[b]);
const only = arg("--only") ? arg("--only").split(",") : null;
const rows = await runAll({ ledger: process.argv.includes("--ledger"), only, quiet: process.argv.includes("--quiet") });
await closeAll();
process.exit(rows.some((r) => r.mark === "❌") ? 1 : 0);
