// scripts/sweep/t4s10/mutate.mjs — DELIBERATE BREAKS (mutation testing) of my 24 files (sweep #10 T4 round 2).
//
//   node scripts/sweep/t4s10/mutate.mjs [--files=lib/session.ts,components/BanGate.tsx] [--max=60] [--workers=4]
//                                       [--seed=1] [--skip=<json of already-tried keys>] [--json=<out>]
//
// "Every line ran" (cover.mjs) says nothing about whether a check would NOTICE that line being wrong. So
// this makes ONE small break at a time in a COPY of a file — a comparison flipped, a "not" dropped, and/or
// swapped, true/false swapped, `??` turned into `||`, a number moved by one, a restaurant filter removed —
// and runs that file's own behaviour checks against the copy (STUB in memory, LAB in Chromium; never SRC,
// which would "catch" a break just by reading different text, and never LIVE). A break no check notices
// SURVIVES: each survivor is a missing check, a real bug, or a line that makes no difference.
//
// The real files are never touched: copies live in .t4mut/ at the repo root (deleted after) — NOT under
// node_modules, where Node will not strip TypeScript. A CONTROL runs first for every file — the unchanged
// copy through the very same path — and that file's results are not reported unless it passes.
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join, basename } from "node:path";
import { ROOT, FILES } from "./lib.mjs";

const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.split("=").slice(1).join("=") : d; };
const ONLY = arg("files", "") ? arg("files").split(",") : Object.values(FILES);
const MAX = Number(arg("max", 60)), WORKERS = Number(arg("workers", 4)), SEED = Number(arg("seed", 1)), OUT = arg("json", "");
const SKIP = new Set(arg("skip", "") ? JSON.parse(readFileSync(arg("skip"), "utf8")) : []);
const isScreen = (f) => f.endsWith(".tsx");
const blocksFor = (f) => (isScreen(f) ? "j,k,m" : "a,b,c,d,e,f,i,k");
const kindsFor = (f) => (isScreen(f) ? "LAB" : "STUB");

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
  { name: "?? → ||", re: / \?\? /g, to: " || " },
  { name: ">= → >", re: / >= /g, to: " > " }, { name: "<= → <", re: / <= /g, to: " < " },
  { name: "> → >=", re: / > /g, to: " >= " }, { name: "< → <=", re: / < /g, to: " <= " },
  { name: "drop !", re: /\(!(?=[a-zA-Z_(])/g, to: "(" },
  { name: "true → false", re: /\btrue\b/g, to: "false" }, { name: "false → true", re: /\bfalse\b/g, to: "true" },
  { name: "return null → undefined", re: /return null;/g, to: "return undefined;" },
  { name: "n → n+1", re: /(?<![.\d])\b([1-9]\d{0,5})\b(?![.\dx_])/g, to: (m) => String(Number(m) + 1) }, // not inside a decimal
];
const SCOPE = /\.eq\("restaurant_id", [a-zA-Z.]+\)/g;
// a small fixed-seed shuffle, so a later pass can ask for a DIFFERENT sample of never-tried points
const rand = (() => { let s = SEED * 9301 + 49297; return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; }; })();

function sitesOf(rel) {
  const src = readFileSync(join(ROOT, rel), "utf8"); const lines = src.split("\n"); const out = [];
  let inBlock = false;
  for (let k = 0; k < lines.length; k++) {
    const L = lines[k]; const t = L.trim();
    // a comment that spans lines — including a JSX `{/* … */}` one, whose middle lines start with plain text
    if (inBlock) { if (t.includes("*/")) inBlock = false; continue; }
    const open = L.lastIndexOf("/*"), close = L.lastIndexOf("*/");
    if (open >= 0 && open > close && codeMask(L)[open]) { inBlock = true; if (t.startsWith("/*") || t.startsWith("{/*")) continue; }
    if (!t || t.startsWith("//") || t.startsWith("*") || t.startsWith("import ") || t.startsWith("{/*") || t.startsWith("/*")) continue;
    for (const m of L.matchAll(SCOPE)) out.push({ rel, line: k + 1, col: m.index, len: m[0].length, to: "", name: "drop restaurant filter", prio: 0 });
    if (L.includes("`")) continue;
    const mask = codeMask(L);
    for (const op of OPS) for (const m of L.matchAll(op.re)) {
      if (!mask[m.index] || !mask[m.index + m[0].length - 1]) continue;
      if (op.name === "n → n+1" && /\b(?:[A-Z_]+_MS|ms|width|height|zIndex|top|right|left|bottom|fontSize|slice|padStart)\b/.test(L) === false && /^\s*[<{]/.test(L)) continue; // JSX layout numbers: not behaviour
      out.push({ rel, line: k + 1, col: m.index, len: m[0].length, to: typeof op.to === "function" ? op.to(m[0]) : op.to, name: op.name, prio: /drop|true|false|scope|null/.test(op.name) ? 1 : 2 });
    }
  }
  return { src, lines, sites: out.filter((s) => !SKIP.has(`${s.rel}:${s.line}:${s.col}:${s.name}`)) };
}

const base = join(ROOT, ".t4mut");
rmSync(base, { recursive: true, force: true });
const runCopy = (rel, file) => new Promise((res) => {
  const p = spawn("node", ["scripts/sweep/t4s10/run.mjs", `--file=${rel}`, `--kinds=${kindsFor(rel)}`, "--bail"],
    { cwd: ROOT, env: { ...process.env, T4S10_BLOCKS: blocksFor(rel), T4_MUT_FILE: rel, T4_MUT_SRC: file }, stdio: ["ignore", "pipe", "pipe"] });
  let out = ""; p.stdout.on("data", (d) => { out += d; }); p.stderr.on("data", (d) => { out += d; });
  const kill = setTimeout(() => { p.kill("SIGKILL"); res({ code: "timeout", out }); }, isScreen(rel) ? 600000 : 120000);
  p.on("close", (c) => { clearTimeout(kill); res({ code: c, out }); });
});
const passed = (r) => r.code === 0 && /checks · \d+ ✅ · 0 ❌/.test(r.out) && !/^❌ /m.test(r.out);

const results = []; const controls = {};
const jobs = [];
for (const rel of ONLY) {
  const { src, lines, sites } = sitesOf(rel);
  const must = sites.filter((s) => s.prio < 2), rest = sites.filter((s) => s.prio === 2).sort(() => rand() - 0.5);
  const chosen = [...must, ...rest].slice(0, Math.max(MAX, Math.min(must.length, MAX)));
  jobs.push({ rel, src, lines, chosen, total: sites.length });
}
// --count: how many break points each file still has that no pass has tried (with --skip), then stop
if (process.argv.includes("--count")) {
  let t = 0; for (const j of jobs) { t += j.total; if (j.total) console.log(`${j.rel.padEnd(44)} ${j.total} never tried`); }
  console.log(`TOTAL never tried: ${t}`); process.exit(0);
}
console.log(`${jobs.reduce((n, j) => n + j.chosen.length, 0)} breaks across ${jobs.length} file(s) (${jobs.map((j) => `${basename(j.rel)} ${j.chosen.length}/${j.total}`).join(", ")}), ${WORKERS} at a time`);
// CONTROLS first — an unchanged copy of each file must pass its own checks, or its "kills" would be lies.
for (const j of jobs) {
  const dir = join(base, "control"); mkdirSync(dir, { recursive: true }); const f = join(dir, basename(j.rel)); writeFileSync(f, j.src);
  const r = await runCopy(j.rel, f); controls[j.rel] = passed(r);
  if (!controls[j.rel]) console.log(`CONTROL FAILED for ${j.rel} — its breaks are NOT run:\n${r.out.slice(-500)}`);
}
// --retry=<an earlier --json>: run exactly that run's SURVIVORS again (e.g. with fewer browsers at once, so a
// survivor that only lived because the machine was slow is told apart from a real one)
const RETRY = arg("retry", "");
let queue = jobs.filter((j) => controls[j.rel]).flatMap((j) => j.chosen.map((s) => ({ ...s, j })));
if (RETRY) {
  const prev = JSON.parse(readFileSync(RETRY, "utf8")).results.filter((r) => r.status === "SURVIVED" && ONLY.includes(r.rel));
  const byRel = new Map(jobs.map((j) => [j.rel, j]));
  queue = prev.filter((r) => controls[r.rel]).map((r) => ({ rel: r.rel, line: r.line, col: r.col, len: r.len, to: r.to, name: r.name, prio: r.prio, j: byRel.get(r.rel) }));
  console.log(`retrying ${queue.length} earlier survivor(s)`);
}
let next = 0;
async function worker(w) {
  const dir = join(base, `w${w}`); mkdirSync(dir, { recursive: true });
  while (next < queue.length) {
    const s = queue[next++]; const L = s.j.lines[s.line - 1];
    const mutated = [...s.j.lines]; mutated[s.line - 1] = L.slice(0, s.col) + s.to + L.slice(s.col + s.len);
    const file = join(dir, basename(s.rel)); writeFileSync(file, mutated.join("\n"));
    const t0 = Date.now(); const r = await runCopy(s.rel, file);
    const killedBy = (r.out.match(/^❌ (P\d+)/m) || [])[1] || null;
    const status = passed(r) ? "SURVIVED" : r.code === "timeout" ? "timeout" : killedBy ? "killed" : "broke-load";
    const rest = { ...s }; delete rest.j; results.push({ ...rest, before: L.trim().slice(0, 150), status, killedBy, ms: Date.now() - t0 });
    if (results.length % 20 === 0) console.log(`  ${results.length}/${queue.length} · survived so far ${results.filter((x) => x.status === "SURVIVED").length}`);
  }
}
await Promise.all(Array.from({ length: WORKERS }, (_, i) => worker(i)));
rmSync(base, { recursive: true, force: true });
const surv = results.filter((r) => r.status === "SURVIVED").sort((a, b) => a.rel.localeCompare(b.rel) || a.line - b.line);
const by = (st) => results.filter((r) => r.status === st).length;
console.log(`\n${results.length} breaks · ${by("killed")} caught by a check · ${by("broke-load")} broke the file itself · ${by("timeout")} timed out · ${surv.length} SURVIVED`);
for (const r of surv) console.log(`  ${r.rel}:${r.line} [${r.name}]  ${r.before}`);
if (OUT) writeFileSync(OUT, JSON.stringify({ controls, results }, null, 1));
process.stdout.write("", () => process.exit(0));
