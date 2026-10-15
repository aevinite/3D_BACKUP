// scripts/sweep/t3s10/r3/mutate.mjs — MUTATION TESTING of terminal 3's seven code files (round 3).
//
//   node scripts/sweep/t3s10/r3/mutate.mjs [--max=500] [--workers=6] [--seed=1] [--file lib/guestOutbox.ts] [--json=out.json]
//   node scripts/sweep/t3s10/r3/mutate.mjs --retry=<an earlier --json> --json=<new>     (only what survived it)
//
// Coverage says a line RAN; it says nothing about whether any check would NOTICE that line being wrong.
// So this makes one small break at a time in a COPY of one file — a comparison flipped, a "not" dropped,
// and/or swapped, a boundary moved by one, true/false swapped, ?? turned into ||, a return emptied — and
// runs the round-3 in-memory suite against that copy (./hooks.mjs T3R3_SWAP, --bail stops at the first
// red). A break nothing notices SURVIVES: each survivor is a missing check, or a line that does nothing.
// The real files are never touched; copies live in .t3mut/ at the repo root (deleted after) — NOT under
// node_modules, where Node will not strip types and every copy would "fail" for the wrong reason. So a
// CONTROL runs first: an unchanged copy of each file through the very same path must pass.
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join, basename } from "node:path";
import { ROOT, CODE_FILES, rd, rng } from "./h.mjs";

const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.split("=").slice(1).join("=") : d; };
const MAX = Number(arg("max", 500)), WORKERS = Number(arg("workers", 6)), OUT = arg("json", ""), SEED = Number(arg("seed", 1));
const FILES = arg("file", "") ? [arg("file")] : CODE_FILES;
const SKIP_DONE = arg("skip", "") ? new Set(JSON.parse(rd(arg("skip"))).map((r) => `${r.file}:${r.line}:${r.col}:${r.to}`)) : new Set();

function codeMask(L) {   // where on a line is code — not inside a string, not after //
  const m = new Array(L.length).fill(false); let q = null;
  for (let i = 0; i < L.length; i++) { const c = L[i];
    if (q) { if (c === "\\") { i++; continue; } if (c === q) q = null; continue; }
    if (c === "/" && L[i + 1] === "/") break;
    if (c === '"' || c === "'" || c === "`") { q = c; continue; }
    m[i] = true; }
  return m;
}
const OPS = [
  [/ === /g, " !== "], [/ !== /g, " === "], [/ && /g, " || "], [/ \|\| /g, " && "],
  [/ >= /g, " > "], [/ <= /g, " < "], [/ > /g, " >= "], [/ < /g, " <= "],
  [/if \(!/g, "if ("], [/return true\b/g, "return false"], [/return false\b/g, "return true"],
  [/ \?\? /g, " || "], [/\+ 1\b/g, "- 1"], [/- 1\b/g, "+ 1"], [/\+\+/g, "--"],
  [/return \[\];/g, "return [{}];"], [/return "";/g, "return \"x\";"], [/return null;/g, "return undefined;"],
  [/\.slice\(0, (\d+)\)/g, (m, n) => `.slice(0, ${Number(n) + 1})`], [/\bcontinue;/g, "break;"],
  [/ = true;/g, " = false;"], [/ = false;/g, " = true;"], [/\? 1 : 0/g, "? 0 : 1"],
];
// --ops=2: a SECOND family, for convergence once the first is exhausted — every whole number in the code
// nudged by one (limits, counts, milliseconds, list sizes), and every reason code the code answers with
// replaced by nonsense. (Strings are otherwise never touched, so the reason codes need their own operator.)
const OPS2 = arg("ops", "1") === "2";
const sites = [];
for (const rel of FILES) {
  const lines = rd(rel).split("\n"); let inBlock = false;
  for (let k = 0; k < lines.length; k++) {
    const L = lines[k], t = L.trim();
    if (t.startsWith("/*")) inBlock = !t.includes("*/");
    const comment = inBlock || t.startsWith("//") || t.startsWith("*") || t.startsWith("/*");
    if (inBlock && t.includes("*/")) inBlock = false;
    if (!t || comment || t.startsWith("import ") || t.startsWith("export type") || L.includes("`")) continue;
    const mask = codeMask(L);
    if (OPS2) {
      for (const m of L.matchAll(/(?<![\w.$])(\d+)(?![\w.])/g)) if (mask[m.index] && Number(m[1]) >= 1) sites.push({ file: rel, line: k + 1, col: m.index, len: m[0].length, to: String(Number(m[1]) + 1), from: m[0] });
      for (const m of L.matchAll(/(reason|kind): "([a-z_]+)"/g)) { const at = m.index + m[1].length + 3; sites.push({ file: rel, line: k + 1, col: at, len: m[2].length, to: "zz_mut", from: m[2] }); }
      for (const m of L.matchAll(/=== "([a-z_]+)"/g)) { const at = m.index + 5; if (mask[m.index]) sites.push({ file: rel, line: k + 1, col: at, len: m[1].length, to: "zz_mut", from: m[1] }); }
      continue;
    }
    for (const [re, to] of OPS) for (const m of L.matchAll(re)) if (mask[m.index] && mask[m.index + m[0].length - 1]) {
      const rep = typeof to === "function" ? m[0].replace(re, to) : to;
      const key = `${rel}:${k + 1}:${m.index}:${rep}`; if (SKIP_DONE.has(key)) continue;
      sites.push({ file: rel, line: k + 1, col: m.index, len: m[0].length, to: rep, from: m[0] });
    }
  }
}
// a seeded spread across every file, so a run of --max is a fair sample and a new --seed a new one
const r = rng(SEED); for (let i = sites.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [sites[i], sites[j]] = [sites[j], sites[i]]; }
// --retry=<json of an earlier run>: run exactly the breaks that SURVIVED it (each pass closes gaps, the next
// pass re-tries only what is left — "until 0 errors" is convergence, not resampling)
const RETRY = arg("retry", "");
const chosen = RETRY ? JSON.parse(readFileSync(RETRY, "utf8")).filter((x) => x.status === "SURVIVED").map(({ file, line, col, len, to, from }) => ({ file, line, col, len, to, from })) : sites.slice(0, MAX);
console.log(`${sites.length} mutable sites in ${FILES.length} file(s); running ${chosen.length}, ${WORKERS} at a time`);

const base = join(ROOT, ".t3mut"); rmSync(base, { recursive: true, force: true });
const runCopy = (rel, abs) => new Promise((res) => {
  const p = spawn("node", ["--no-warnings", "--import", "./scripts/sweep/t3s10/r3/hooks.mjs", "scripts/sweep/t3s10/r3/run.mjs", "--bail", "--quiet"],
    { cwd: ROOT, env: { ...process.env, T3R3_SWAP: `${rel}=${abs}`, T3R3_WALKS: process.env.T3R3_WALKS || "24", T3R3_STEPS: "28" }, stdio: ["ignore", "pipe", "pipe"] });
  let out = ""; p.stdout.on("data", (d) => { out += d; }); p.stderr.on("data", () => {});
  const kill = setTimeout(() => { p.kill("SIGKILL"); res({ code: "timeout", out }); }, 180_000);
  p.on("close", (c) => { clearTimeout(kill); res({ code: c, out }); });
});
for (const rel of [...new Set(chosen.map((s) => s.file))]) {   // THE CONTROL, per file
  const dir = join(base, "control"); mkdirSync(dir, { recursive: true });
  const abs = join(dir, basename(rel)); writeFileSync(abs, rd(rel));
  const c = await runCopy(rel, abs);
  if (c.code !== 0) { console.error(`CONTROL FAILED for ${rel} — an unchanged copy does not pass, so no result can be trusted:\n${c.out.slice(-600)}`); rmSync(base, { recursive: true, force: true }); process.exit(2); }
}
console.log("control: an unchanged copy of every file passes the whole suite — results can be trusted");
const results = []; let next = 0;
async function worker(w) {
  const dir = join(base, `w${w}`); mkdirSync(dir, { recursive: true });
  while (next < chosen.length) {
    const s = chosen[next++]; const lines = rd(s.file).split("\n"); const L = lines[s.line - 1];
    lines[s.line - 1] = L.slice(0, s.col) + s.to + L.slice(s.col + s.len);
    const abs = join(dir, basename(s.file)); writeFileSync(abs, lines.join("\n"));
    const t0 = Date.now(); const c = await runCopy(s.file, abs);
    const by = (c.out.match(/^❌ (R3-\w+)/m) || [])[1] || null;
    results.push({ ...s, before: L.trim().slice(0, 150), status: c.code === 0 ? "SURVIVED" : c.code === "timeout" ? "timeout" : "caught", by, ms: Date.now() - t0 });
    if (results.length % 25 === 0) console.log(`  ${results.length}/${chosen.length} · survived so far: ${results.filter((x) => x.status === "SURVIVED").length}`);
  }
}
await Promise.all(Array.from({ length: WORKERS }, (_, i) => worker(i)));
rmSync(base, { recursive: true, force: true });
const surv = results.filter((x) => x.status === "SURVIVED").sort((a, b) => (a.file + a.line).localeCompare(b.file + b.line));
console.log(`\n${results.length} breaks · ${results.length - surv.length} caught · ${surv.length} SURVIVED · ${results.filter((x) => x.status === "timeout").length} timed out (counted caught)`);
for (const x of surv) console.log(`  ${x.file}:${x.line}  [${x.from.trim()} → ${x.to.trim()}]  ${x.before}`);
if (OUT) writeFileSync(OUT, JSON.stringify(results, null, 1));
process.stdout.write("", () => process.exit(0));
