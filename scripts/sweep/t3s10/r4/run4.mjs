// scripts/sweep/t3s10/r4/run4.mjs — ROUND 4 (re-planned from zero, 2026-10-16). node scripts/sweep/t3s10/r4/run4.mjs [--areas B,A,…]
import { runAll } from "./h4.mjs";
const areas = (process.argv.includes("--areas") ? process.argv[process.argv.indexOf("--areas") + 1] : "B").split(",");
const PARTS = { B: "./b-db.mjs", A: "./a-http.mjs", C: "./c-money.mjs", D: "./d-twice.mjs", E: "./e-doors.mjs", F: "./f-engines.mjs", G: "./g-a11y.mjs", H: "./h-lang.mjs", I: "./i-storage.mjs", J: "./j-soak.mjs", K: "./k-rating.mjs", M: "./m-mem.mjs" };
for (const a of areas) await import(PARTS[a]);
const r = await runAll({ areas });
const { closeBrowser } = await import("./live4.mjs").catch(() => ({}));
if (closeBrowser) await closeBrowser();
process.stdout.write("", () => process.exit(r.bad ? 1 : 0));
