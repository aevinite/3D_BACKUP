// scripts/sweep/t3s10/run.mjs — sweep #10 terminal 3's new checks (ordering: the basket, placing an
// order, calling staff, rating), all blocks.
//   node scripts/sweep/t3s10/run.mjs              — run, print failures + totals
//   node scripts/sweep/t3s10/run.mjs --all        — print every row
//   node scripts/sweep/t3s10/run.mjs --ledger     — print ledger rows (`| id | file — what | how | ✅ | note |`)
//   node scripts/sweep/t3s10/run.mjs --only P172001,P172002
//   T3S10_BLOCKS=a,b node …                        — only some blocks (live blocks need T3_BASE, default :4403)
import { runAll } from "./lib.mjs";
const blocks = (process.env.T3S10_BLOCKS || "a,b,c,d,e,f,g,h,i,j,k,m,o,l,p,n").split(",");
const load = async (k, f) => { if (blocks.includes(k)) await import(f).catch((e) => { if (!/Cannot find module/.test(e.message)) throw e; }); };
await load("a", "./new-a-outbox.mjs");
await load("b", "./new-b-status.mjs");
await load("c", "./new-c-routes.mjs");
await load("d", "./new-d-src.mjs");
await load("e", "./new-e-money.mjs");
await load("f", "./new-f-live.mjs");
await load("g", "./new-g-screens.mjs");
// round 2 (2026-10-12): the fixes the owner picked and the second comb found, and the matrices
await load("h", "./r2-h-fixes.mjs");
await load("i", "./r2-i-matrix.mjs");
await load("j", "./r2-j-queue.mjs");
await load("j", "./r2-j2-kinds.mjs");
await load("k", "./r2-k-words.mjs");
await load("m", "./r2-m-src.mjs");
await load("o", "./r2-o-fuzz.mjs");
await load("l", "./r2-l-devices.mjs");
await load("p", "./r2-p-journeys.mjs");
await load("n", "./r2-n-live.mjs");
const a = process.argv;
const onlyArg = a.find((x) => x.startsWith("--only"));
const only = onlyArg ? (onlyArg.split("=")[1] || a[a.indexOf(onlyArg) + 1]).split(",") : null;
const quietLog = console.error; if (!a.includes("--noisy")) { console.error = () => {}; console.warn = () => {}; }
await runAll({ ledger: a.includes("--ledger"), quiet: !a.includes("--all"), only });
console.error = quietLog;
process.stdout.write("", () => process.exit(0));
