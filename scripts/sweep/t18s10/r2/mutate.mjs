// scripts/sweep/t18s10/r2/mutate.mjs — MUTATION TESTING of terminal 18's ten library files.
//
//   node scripts/sweep/t18s10/r2/mutate.mjs [--files=accessTree,staffCaps] [--max=600] [--workers=6] [--seed=1] [--json=<out>]
//
// Coverage says a line RAN; it does not say a check would notice the line being WRONG. So this makes one
// small break at a time in a COPY of a file — a comparison flipped, a "not" dropped, and/or swapped,
// true/false swapped, `??` turned into `||`, a slice bound moved, a filter removed, a returned word
// changed — and runs the in-memory blocks (a–e, h) against the copy, stopping at the first red. A break
// nobody notices SURVIVES, and each survivor is a missing check or a line that does nothing.
//
// Copies live in .t18mut/ at the repo root (deleted after) — NOT under node_modules, where Node refuses
// to strip TypeScript types (sweep #10 T9's lesson: every copy failed to load and all read "killed").
// A CONTROL runs first — every file copied unchanged, the very same path — and nothing is reported
// unless it passes. The real files are never touched.
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./core.mjs";

const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.split("=")[1] : d; };
const ALL = ["accessTree", "accessModel", "accessState", "accessConfig", "staffCaps", "staffProfile", "staffProfileShared", "features", "ownerEntitlements", "viewAsPerson"];
const FILES = arg("files", ALL.join(",")).split(",");
const MAX = Number(arg("max", 600)), WORKERS = Number(arg("workers", 6)), SEED = Number(arg("seed", 1)), OUT = arg("json", "");
const SKIP = new Set((arg("skip", "") ? readFileSync(arg("skip", ""), "utf8") : "").split("\n").filter(Boolean)); // "file:line:col:to" already tried
const srcOf = Object.fromEntries(ALL.map((f) => [f, readFileSync(join(ROOT, "lib", `${f}.ts`), "utf8")]));

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
  [/ === /g, " !== ", "=== → !=="], [/ !== /g, " === ", "!== → ==="], [/ && /g, " || ", "&& → ||"], [/ \|\| /g, " && ", "|| → &&"],
  [/ >= /g, " > ", ">= → >"], [/ <= /g, " < ", "<= → <"], [/ > /g, " >= ", "> → >="], [/ < /g, " <= ", "< → <="],
  [/ \?\? /g, " || ", "?? → ||"], [/\(!/g, "(", "drop !"], [/ !(?=[a-zA-Z(])/g, " ", "drop !"],
  [/\btrue\b/g, "false", "true → false"], [/\bfalse\b/g, "true", "false → true"],
  [/return null\b/g, "return undefined", "null → undefined"], [/\.slice\(0, (\d+)\)/g, (m, n) => `.slice(0, ${Number(n) + 1})`, "slice +1"],
  [/\.slice\(-(\d+)\)/g, (m, n) => `.slice(-${Number(n) + 1})`, "slice tail +1"], [/ \+ 1\b/g, " + 2", "+1 → +2"], [/ - 1\b/g, " - 2", "-1 → -2"],
  [/\.filter\(/g, ".filter(() => true || ", "filter → keep all"], [/ \? /g, " ? ", null],
];
const STRING_OPS = [[/"off"/g, '"on"', '"off" → "on"'], [/"on"/g, '"off"', '"on" → "off"'], [/"pin"/g, '"on"', '"pin" → "on"']];
const sites = [];
for (const f of FILES) {
  const lines = srcOf[f].split("\n");
  let inType = false;   // inside a multi-line `type X = { … };` — types vanish at run time, so a break there is no break
  lines.forEach((L, k) => {
    const t = L.trim();
    if (/^(export )?type \w+.*=\s*(Partial<)?\{\s*$/.test(t)) { inType = true; return; }
    if (inType) { if (/^\}>?;/.test(t)) inType = false; return; }
    if (!t || t.startsWith("//") || t.startsWith("*") || t.startsWith("/*") || /^(import|export \*|type |export type)/.test(t)) return;
    const mask = codeMask(L);
    for (const [re, to, name] of OPS) {
      if (!name) continue;
      for (const m of L.matchAll(re)) if (mask[m.index] && mask[m.index + m[0].length - 1]) {
        const rep = typeof to === "function" ? m[0].replace(re, to) : to;
        sites.push({ file: f, line: k + 1, col: m.index, len: m[0].length, to: rep, name });
      }
    }
    // the quoted tri-state words, only where they are RETURNED or compared (not in a help sentence)
    if (/return |=== |!== | \? /.test(L) && !/what:|name:|label:/.test(L))
      for (const [re, to, name] of STRING_OPS) for (const m of L.matchAll(re)) sites.push({ file: f, line: k + 1, col: m.index, len: m[0].length, to, name });
  });
}
const keyOf = (s) => `${s.file}:${s.line}:${s.col}:${s.to}`;
const uniq = [...new Map(sites.map((s) => [keyOf(s), s])).values()].filter((s) => !SKIP.has(keyOf(s)));
// a seeded shuffle, so a later pass with a NEW seed tries different points first
let x = SEED >>> 0 || 1; const rnd = () => ((x ^= x << 13), (x ^= x >>> 17), (x ^= x << 5), (x >>> 0) / 4294967296);
for (let i = uniq.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [uniq[i], uniq[j]] = [uniq[j], uniq[i]]; }
const chosen = uniq.slice(0, MAX);
console.log(`${sites.length} mutation points in ${FILES.length} file(s), ${uniq.length} not yet tried; running ${chosen.length}, ${WORKERS} at a time (seed ${SEED})`);

const base = join(ROOT, ".t18mut");
rmSync(base, { recursive: true, force: true });
const run = (dir) => new Promise((res) => {
  const p = spawn("node", ["--no-warnings", "--import", "./scripts/sweep/t18s10/r2/hooks.mjs", "scripts/sweep/t18s10/r2/run.mjs", "--only=a,b,c,d,e,h,i", "--no-live", "--bail", "--quiet"],
    { cwd: ROOT, env: { ...process.env, T18_LIB_DIR: dir }, stdio: ["ignore", "pipe", "pipe"] });
  let out = ""; p.stdout.on("data", (d) => { out += d; }); p.stderr.on("data", (d) => { out += d; });
  const kill = setTimeout(() => { p.kill("SIGKILL"); res({ code: "timeout", out }); }, 120000);
  p.on("close", (c) => { clearTimeout(kill); res({ code: c, out }); });
});
const lay = (dir, override) => { mkdirSync(dir, { recursive: true }); for (const f of ALL) writeFileSync(join(dir, `${f}.ts`), override?.file === f ? override.text : srcOf[f]); };
{
  const dir = join(base, "control"); lay(dir);
  const c = await run(dir);
  if (c.code !== 0) { console.error("CONTROL FAILED — an unchanged copy does not pass, so no mutant result can be trusted:\n" + c.out.slice(-1200)); rmSync(base, { recursive: true, force: true }); process.exit(2); }
  console.log("control: an unchanged copy of every file passes every in-memory check — mutant results can be trusted");
}
const results = []; let next = 0;
async function worker(w) {
  const dir = join(base, `w${w}`);
  while (next < chosen.length) {
    const s = chosen[next++];
    const lines = srcOf[s.file].split("\n"); const L = lines[s.line - 1];
    lines[s.line - 1] = L.slice(0, s.col) + s.to + L.slice(s.col + s.len);
    lay(dir, { file: s.file, text: lines.join("\n") });
    const r = await run(dir);
    const by = (r.out.match(/^❌ (P\d+)/m) || [])[1] || null;
    const loadFail = /SyntaxError|ERR_|crashed/.test(r.out) && !by;
    results.push({ ...s, before: L.trim().slice(0, 150), after: lines[s.line - 1].trim().slice(0, 150), status: r.code === 0 ? "SURVIVED" : r.code === "timeout" ? "timeout" : loadFail ? "unloadable" : "killed", killedBy: by });
    if (results.length % 50 === 0) console.log(`  ${results.length}/${chosen.length} · survived so far ${results.filter((q) => q.status === "SURVIVED").length}`);
  }
}
await Promise.all(Array.from({ length: WORKERS }, (_, i) => worker(i)));
rmSync(base, { recursive: true, force: true });
const surv = results.filter((r) => r.status === "SURVIVED").sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
const n = (k) => results.filter((r) => r.status === k).length;
console.log(`\n${results.length} mutants · ${n("killed")} killed · ${surv.length} SURVIVED · ${n("unloadable")} would not load (a broken file — counted killed) · ${n("timeout")} timed out`);
for (const r of surv) console.log(`  ${r.file}:${r.line} [${r.name}]  ${r.before}`);
if (OUT) writeFileSync(OUT, JSON.stringify(results, null, 1));
process.stdout.write("", () => process.exit(0));
