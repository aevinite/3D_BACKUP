// SWEEP #10 T11 ROUND 2 · MUTATION TESTING OF THE KITCHEN ROUTE — "is every bit of it actually checked?"
//
// Coverage says a line RAN; it does not say a check would notice if the line were wrong. So this makes one small
// break at a time in app/api/kitchen/[...path]/route.ts — === ↔ !==, && ↔ ||, true ↔ false, a refusal turned into
// a success, a status code changed, a restaurant filter DROPPED — runs the four route suites with T11_STRICT=1 (stop at
// the first failed check), and records whether any check noticed ("killed") or none did ("survived").
// The file is restored BYTE FOR BYTE after every mutant, in a `finally`, and on SIGINT/SIGTERM.
//
//   node scripts/t11-harness/mutate.mjs [--limit 240] [--out <file.json>] [--lines 236,547]   (--lines: only mutants on those lines, all of them)
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
const here = dirname(fileURLToPath(import.meta.url)), root = join(here, "..", "..");
const FILE = join(root, "app/api/kitchen/[...path]/route.ts");
const ORIGINAL = readFileSync(FILE);
const restore = () => writeFileSync(FILE, ORIGINAL);
for (const s of ["SIGINT", "SIGTERM"]) process.on(s, () => { restore(); process.exit(130); });
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const LIMIT = +arg("--limit", 240), OUT = arg("--out", null);
const LINES = arg("--lines", null) ? new Set(arg("--lines").split(",").map(Number)) : null;

const text = ORIGINAL.toString("utf8");
const lines = text.split("\n");
// Code positions only: skip comment lines, and the comment tail of a line.
const codeOf = (l) => { if (/^\s*(\/\/|\*|\/\*)/.test(l)) return ""; const i = l.indexOf(" // "); return i >= 0 ? l.slice(0, i) : l; };
const OPS = [
  ["===", "!=="], ["!==", "==="], [" && ", " || "], [" || ", " && "], ["true", "false"], ["false", "true"],
  ["return err(", "return ok("], [", 409)", ", 200)"], [", 404)", ", 200)"], [", 403 }", ", 200 }"], [", 400)", ", 200)"],
  ['.eq("restaurant_id", rid)', ""], ["if (!", "if ("], [" > ", " >= "], [" < ", " <= "], ["slice(0, 20)", "slice(0, 21)"], ["slice(0, 200)", "slice(0, 201)"],
  ["slice(0, 300)", "slice(0, 301)"], ['"served"', '"servedX"'], ['"ready"', '"readyX"'], ["must(", "("],
];
const mutants = [];
lines.forEach((l, i) => {
  if (LINES && !LINES.has(i + 1)) return;
  const c = codeOf(l);
  if (!c.trim()) return;
  for (const [from, to] of OPS) {
    let at = c.indexOf(from);
    while (at >= 0) { mutants.push({ line: i + 1, col: at, from, to }); at = c.indexOf(from, at + from.length); }
  }
});
// Even sample across the file when there are more than LIMIT.
const step = Math.max(1, mutants.length / LIMIT);
const pick = []; for (let x = 0; x < mutants.length && pick.length < LIMIT; x += step) pick.push(mutants[Math.floor(x)]);
console.log(`${mutants.length} possible mutants · running ${pick.length}`);
const results = [];
try {
  for (const m of pick) {
    const ls = text.split("\n"); const l = ls[m.line - 1];
    ls[m.line - 1] = l.slice(0, m.col) + m.to + l.slice(m.col + m.from.length);
    writeFileSync(FILE, ls.join("\n"));
    let killed = false, by = "";
    for (const suite of ["u-route.mjs", "u-route3.mjs", "u-route4.mjs", "u-route2.mjs"]) {
      const r = spawnSync(process.execPath, [join(here, suite)], { cwd: root, env: { ...process.env, T11_STRICT: "1" }, encoding: "utf8", timeout: 300000 });
      const out = (r.stdout || "") + (r.stderr || "");
      if (r.status !== 0) { killed = true; by = (out.match(/KILLED by (P\d+)/) || [])[1] || (/SyntaxError|TypeError|ReferenceError/.test(out) ? "crash" : "exit " + r.status); break; }
    }
    results.push({ ...m, killed, by, code: l.trim().slice(0, 140) });
    process.stdout.write(killed ? "." : "S");
  }
} finally { restore(); }
const surv = results.filter((r) => !r.killed);
console.log(`\n${results.length} mutants · ${results.length - surv.length} killed · ${surv.length} survived`);
for (const s of surv) console.log(`  SURVIVED line ${s.line}: ${s.from} → ${s.to || "(dropped)"}  ::  ${s.code}`);
if (OUT) writeFileSync(OUT, JSON.stringify(results, null, 1));
const now = readFileSync(FILE); console.log(now.equals(ORIGINAL) ? "route.ts restored byte for byte" : "!!! route.ts DIFFERS from the original");
