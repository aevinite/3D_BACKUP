// scripts/sweep/t4s10/run.mjs — sweep #10 terminal 4's new checks (the table session), all blocks.
//   node scripts/sweep/t4s10/run.mjs              — run, print failures + totals
//   node scripts/sweep/t4s10/run.mjs --all        — print every row
//   node scripts/sweep/t4s10/run.mjs --ledger     — print ledger rows (`| id | file — what | how | ✅ | note |`)
//   node scripts/sweep/t4s10/run.mjs --only P173001,P173002
//   T4S10_BLOCKS=a,b node …                        — only some blocks (block h needs the app on T4_BASE, default :4404)
//   --file=lib/session.ts   only the checks whose subject is that file · --kinds=STUB,LAB   only those sources
//   --bail                  stop at the first red (the deliberate-break runs)
import { runAll } from "./lib.mjs";
const blocks = (process.env.T4S10_BLOCKS || "a,b,c,d,e,f,g,h,i,j,k,l,m,n").split(",");
const files = { a: "./new-a-tenant.mjs", b: "./new-b-table.mjs", c: "./new-c-session.mjs", d: "./new-d-small.mjs",
  e: "./new-e-server-libs.mjs", f: "./new-f-routes.mjs", g: "./new-g-src.mjs", h: "./new-h-live.mjs",
  // round 2 (2026-10-15): i closes measured in-memory gaps · j is the screen lab · k kills surviving breaks
  i: "./new-i-cover.mjs", j: "./new-j-lab.mjs", k: "./new-k-kill.mjs", l: "./new-l-live.mjs", m: "./new-m-pass4.mjs", n: "./new-n-qr.mjs" };
for (const k of blocks) if (files[k]) await import(files[k]).catch((e) => { if (!/Cannot find module/.test(e.message)) throw e; });
const a = process.argv;
const onlyArg = a.find((x) => x.startsWith("--only"));
const only = onlyArg ? (onlyArg.split("=")[1] || a[a.indexOf(onlyArg) + 1]).split(",") : null;
const quietLog = console.error; if (!a.includes("--noisy")) { console.error = () => {}; console.warn = () => {}; }
const val = (k) => { const x = a.find((y) => y.startsWith(`--${k}=`)); return x ? x.split("=")[1] : null; };
await runAll({ ledger: a.includes("--ledger"), quiet: !a.includes("--all"), only, file: val("file"), kinds: val("kinds") ? val("kinds").split(",") : null, bail: a.includes("--bail") });
console.error = quietLog;
// the browser-driving blocks own a Chromium each; close them so the process can end
for (const m of [await import("./new-l-live.mjs").catch(() => null), await import("./lab/page.mjs").catch(() => null)]) {
  if (m && m.closeL) await m.closeL(); if (m && m.closeBrowser) await m.closeBrowser();
}
process.stdout.write("", () => process.exit(0));
