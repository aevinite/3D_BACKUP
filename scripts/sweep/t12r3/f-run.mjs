// scripts/sweep/t12r3/f-run.mjs — band F (the fixture world) of sweep #10 T12 round 3.
//   node scripts/sweep/t12r3/f-run.mjs [--base http://localhost:4412] [--groups FB,FC,…] [--ledger out.md] [--quiet] [--bail]
// Ids are handed out in a FIXED order per group (each group owns a hundred), so a group that grows
// never renumbers another: FA P213001+, FB P213101+, FC P213201+, … FH P213701+, FI (split + discount) P213801+. Nothing here writes
// anywhere — every data answer comes from the check's own world (f-world.mjs).
import { writeFileSync } from "node:fs";
import { makeRunner, ledgerLine, closeBrowser } from "../t12s10/lib.mjs";

const GROUPS = [["FA", "./fa-floor.mjs", "blockFA"], ["FB", "./fb-table.mjs", "blockFB"], ["FC", "./fc-kot.mjs", "blockFC"], ["FD", "./fd-bill.mjs", "blockFD"],
  ["FE", "./fe-order.mjs", "blockFE"], ["FF", "./ff-xray.mjs", "blockFF"], ["FG", "./fg-shell.mjs", "blockFG"], ["FH", "./fh-banquet.mjs", "blockFH"], ["FI", "./fi-split.mjs", "blockFI"], ["FJ", "./fj-rest.mjs", "blockFJ"], ["FT", "./ft-host.mjs", "blockFT"], ["FK", "./fk-mut.mjs", "blockFK"]];
// FJ (the coverage top-up, written after the first measurement) gets a narrower range so the host-page
// rows (band T, P213961–P213975) and the mutation rows (band M, P213976–P213999) keep theirs.
// P213988–P213992 = item 25's rows, P213993–P213999 = the mutation passes (written by hand in the ledger).
const RANGE = { FJ: [213901, 213935], FK: [213936, 213976], FT: [213977, 213987] };
const want = (() => { const i = process.argv.indexOf("--groups"); return i > 0 ? new Set(process.argv[i + 1].split(",")) : null; })();
const R = makeRunner("T12 round 3 · band F — the fixture world");
const bail = process.argv.includes("--bail");
for (const [k, file, fn] of GROUPS) {
  if (want && !want.has(k)) continue;
  let mod; try { mod = await import(file); } catch (e) { if (/Cannot find module|ERR_MODULE_NOT_FOUND/.test(String(e))) continue; throw e; }
  let n = RANGE[k] ? RANGE[k][0] : 213001 + GROUPS.findIndex((g) => g[0] === k) * 100;
  const end = RANGE[k] ? RANGE[k][1] : n + 99;
  const id = () => { if (n > end) throw new Error(`group ${k} ran past its hundred ids`); return "P" + n++; };
  const before = R.rows.length;
  try { await mod[fn](R, id); } catch (e) { console.log(`group ${k} stopped: ${String(e.message || e).split("\n")[0].slice(0, 240)}`); R.rows.push({ id: id(), file: "scripts/sweep/t12r3/f-run.mjs", title: `group ${k} ran to the end`, how: "the runner", mark: "❌", note: String(e.message || e).split("\n")[0].slice(0, 200) }); }
  if (bail && R.rows.slice(before).some((r) => r.mark === "❌")) break;
}
const { rows, counts } = R.done();
await closeBrowser();
const i = process.argv.indexOf("--ledger");
if (i > 0) writeFileSync(process.argv[i + 1], rows.map(ledgerLine).join("\n") + "\n");
process.stdout.write("", () => process.exit(counts["❌"] ? 1 : 0));
