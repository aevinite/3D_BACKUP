// scripts/sweep/t9s10/mutate.mjs — MUTATION TESTING of my half of the manager route (round 2).
//
//   node scripts/sweep/t9s10/mutate.mjs [--max=400] [--workers=6] [--json=<out file>]
//
// "Every line ran" (coverage) says nothing about whether a test would NOTICE that line being wrong.
// So this makes one small deliberate break at a time — a comparison flipped, a "not" dropped, and/or
// swapped, true/false swapped, a restaurant filter REMOVED — in a COPY of route.ts, and runs the whole
// in-memory suite against that copy (blocks a, b, c, e, g, h; --bail stops at the first red). A break the
// suite does not notice SURVIVES, and each survivor is either a missing test or a line that does
// nothing. The real route.ts is never touched; copies live in .t9mut/ at the repo root (deleted after) —
// NOT under node_modules, where Node refuses to strip TypeScript types: the first run of this file put
// them there, every copy failed to LOAD, and all 454 mutants read as "killed". So a CONTROL now runs
// first — an unchanged copy through the very same path — and nothing is reported unless it passes.
//
// Lines 1 … the end of the table-sections branch only — sweep #10 terminal 9's boundary.
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { ROOT, src, MY_END } from "./lib.mjs";

const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.split("=")[1] : d; };
const MAX = Number(arg("max", 400)), WORKERS = Number(arg("workers", 6)), OUT = arg("json", "");
const lines = src.split("\n");
const myLines = src.slice(0, MY_END).split("\n").length;

// Where on a line is code (not a string, not a comment)? Lines holding a template literal are left
// to the scope operator only — a crude tokenizer cannot see inside `${…}` safely.
function codeMask(L) {
  const m = new Array(L.length).fill(false); let q = null;
  for (let i = 0; i < L.length; i++) {
    const c = L[i];
    if (q) { if (c === "\\") { i++; continue; } if (c === q) q = null; continue; }
    if (c === "/" && L[i + 1] === "/") break;
    if (c === '"' || c === "'" || c === "`") { q = c; continue; }
    m[i] = true;
  }
  return m;
}
const OPS = [
  { name: "=== → !==", re: / === /g, to: " !== " }, { name: "!== → ===", re: / !== /g, to: " === " },
  { name: "&& → ||", re: / && /g, to: " || " }, { name: "|| → &&", re: / \|\| /g, to: " && " },
  { name: ">= → >", re: / >= /g, to: " > " }, { name: "<= → <", re: / <= /g, to: " < " },
  { name: "> → >=", re: / > /g, to: " >= " }, { name: "< → <=", re: / < /g, to: " <= " },
  { name: "drop !", re: /if \(!/g, to: "if (" },
  { name: "true → false", re: /return true\b/g, to: "return false" }, { name: "false → true", re: /return false\b/g, to: "return true" },
];
const SCOPE = /\.eq\("restaurant_id", rid\)/g;
const sites = [];
for (let k = 0; k < myLines; k++) {
  const L = lines[k]; const t = L.trim();
  if (!t || t.startsWith("//") || t.startsWith("*") || t.startsWith("/*") || t.startsWith("import ")) continue;
  for (const m of L.matchAll(SCOPE)) sites.push({ line: k + 1, col: m.index, len: m[0].length, to: "", name: "drop restaurant filter", prio: 0 });
  if (L.includes("`")) continue;
  const mask = codeMask(L);
  for (const op of OPS) for (const m of L.matchAll(op.re)) if (mask[m.index] && mask[m.index + m[0].length - 1])
    sites.push({ line: k + 1, col: m.index, len: m[0].length, to: op.to, name: op.name, prio: /drop !|true|false/.test(op.name) ? 1 : 2 });
}
// Every scope and every gate/boolean mutant, then an even spread of the operator ones.
const must = sites.filter((s) => s.prio < 2), rest = sites.filter((s) => s.prio === 2);
const stride = Math.max(1, Math.ceil(rest.length / Math.max(1, MAX - must.length)));
const chosen = [...must, ...rest.filter((_, i) => i % stride === 0)].slice(0, Math.max(MAX, must.length));
console.log(`${sites.length} mutable sites in lines 1–${myLines}; running ${chosen.length} (${must.length} scope/gate/boolean + ${chosen.length - must.length} operator), ${WORKERS} at a time`);

const base = join(ROOT, ".t9mut");
rmSync(base, { recursive: true, force: true });
const runCopy = (file) => new Promise((res) => {
  const p = spawn("node", ["--no-warnings", "--import", "./scripts/sweep/t9s10/hooks.mjs", "scripts/sweep/t9s10/run.mjs", "--block", "a,b,c,e,g,h", "--stub-only", "--bail", "--quiet"],
    { cwd: ROOT, env: { ...process.env, T9_COVERAGE: "1", T9_ROUTE_ABS: file }, stdio: ["ignore", "pipe", "pipe"] });
  let out = ""; p.stdout.on("data", (d) => { out += d; }); p.stderr.on("data", () => {});
  const kill = setTimeout(() => { p.kill("SIGKILL"); res({ code: "timeout", out }); }, 90000);
  p.on("close", (c) => { clearTimeout(kill); res({ code: c, out }); });
});
{ // THE CONTROL: an unchanged copy must pass every check, or every "kill" below would be a lie.
  const dir = join(base, "control"); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "route.ts"), src);
  const c = await runCopy(join(dir, "route.ts"));
  if (c.code !== 0) { console.error("CONTROL FAILED — an unchanged copy does not pass, so no mutant result can be trusted:\n" + c.out.slice(-800)); rmSync(base, { recursive: true, force: true }); process.exit(2); }
  console.log("control: an unchanged copy passes every check — mutant results can be trusted");
}
const results = [];
let next = 0;
async function worker(w) {
  const dir = join(base, `w${w}`); mkdirSync(dir, { recursive: true });
  const file = join(dir, "route.ts");
  while (next < chosen.length) {
    const s = chosen[next++];
    const L = lines[s.line - 1];
    const mutated = [...lines]; mutated[s.line - 1] = L.slice(0, s.col) + s.to + L.slice(s.col + s.len);
    writeFileSync(file, mutated.join("\n"));
    const t0 = Date.now();
    const code = await runCopy(file);
    const killedBy = (code.out.match(/^❌ (P\d+)/m) || [])[1] || null;
    results.push({ ...s, before: L.trim().slice(0, 140), status: code.code === 0 ? "SURVIVED" : code.code === "timeout" ? "timeout" : "killed", killedBy, ms: Date.now() - t0 });
    if (results.length % 25 === 0) console.log(`  ${results.length}/${chosen.length} · survived so far: ${results.filter((r) => r.status === "SURVIVED").length}`);
  }
}
await Promise.all(Array.from({ length: WORKERS }, (_, i) => worker(i)));
rmSync(base, { recursive: true, force: true });
const surv = results.filter((r) => r.status === "SURVIVED").sort((a, b) => a.line - b.line);
console.log(`\n${results.length} mutants · ${results.length - surv.length} killed · ${surv.length} SURVIVED · ${results.filter((r) => r.status === "timeout").length} timed out (counted killed)`);
for (const r of surv) console.log(`  L${r.line} [${r.name}]  ${r.before}`);
if (OUT) writeFileSync(OUT, JSON.stringify(results, null, 1));
process.stdout.write("", () => process.exit(0));
