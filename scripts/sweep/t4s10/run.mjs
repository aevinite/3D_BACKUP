// scripts/sweep/t4s10/run.mjs — sweep #10 terminal 4's new checks (the table session), all blocks.
//   node scripts/sweep/t4s10/run.mjs              — run, print failures + totals
//   node scripts/sweep/t4s10/run.mjs --all        — print every row
//   node scripts/sweep/t4s10/run.mjs --ledger     — print ledger rows (`| id | file — what | how | ✅ | note |`)
//   node scripts/sweep/t4s10/run.mjs --only P173001,P173002
//   T4S10_BLOCKS=a,b node …                        — only some blocks (block h needs the app on T4_BASE, default :4404)
import { runAll } from "./lib.mjs";
const blocks = (process.env.T4S10_BLOCKS || "a,b,c,d,e,f,g,h").split(",");
const files = { a: "./new-a-tenant.mjs", b: "./new-b-table.mjs", c: "./new-c-session.mjs", d: "./new-d-small.mjs",
  e: "./new-e-server-libs.mjs", f: "./new-f-routes.mjs", g: "./new-g-src.mjs", h: "./new-h-live.mjs" };
for (const k of blocks) if (files[k]) await import(files[k]).catch((e) => { if (!/Cannot find module/.test(e.message)) throw e; });
const a = process.argv;
const onlyArg = a.find((x) => x.startsWith("--only"));
const only = onlyArg ? (onlyArg.split("=")[1] || a[a.indexOf(onlyArg) + 1]).split(",") : null;
const quietLog = console.error; if (!a.includes("--noisy")) { console.error = () => {}; console.warn = () => {}; }
await runAll({ ledger: a.includes("--ledger"), quiet: !a.includes("--all"), only });
console.error = quietLog;
process.stdout.write("", () => process.exit(0));
