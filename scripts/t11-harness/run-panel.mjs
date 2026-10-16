// SWEEP #10 T11 ROUND 2 · THE KITCHEN SCREEN, every section in one browser, then the merged coverage of app.js.
//   node scripts/t11-harness/run-panel.mjs [--only a,b]      (no server needed — p-lib.mjs serves the panel itself)
import { coverage, finish } from "./p-lib.mjs";
const arg = (k1) => { const i = process.argv.indexOf(k1); return i > 0 ? process.argv[i + 1] : null; };
const want = (arg("--only") || "a,b,c,d,e,f").split(",");
const SECTIONS = { a: "./p-a-board.mjs", b: "./p-b-taps.mjs", c: "./p-c-print.mjs", d: "./p-d-live.mjs", e: "./p-e-phone.mjs", f: "./p-f-corners.mjs" };
for (const s of want) { const m = await import(SECTIONS[s]); await m.default(); }
const c = coverage();
console.log(`\napp.js coverage over ${c.pages} page(s): ${c.pct}% of ${c.codeLines} code lines ran · ${c.fnsTotal - c.fnsNever.length}/${c.fnsTotal} named functions ran`);
if (process.env.T11_COV) { console.log("never ran (functions):", c.fnsNever.join(", ")); console.log("never ran (lines):", c.linesNever.join(",")); }
globalThis.__T11_COV = c;
await finish("panel");
