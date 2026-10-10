// scripts/sweep/t10s10/coverage.mjs — which lines and branch arms of MY half did no check execute?
//
//   node scripts/sweep/t10s10/coverage.mjs [--branches] [--json out.json]
//
// Runs every in-memory check this terminal owns — blocks a, b, c, the re-run, the round-3 blocks and
// the two item guards — against the REAL route.ts (terminal 9's ./hooks.mjs loads the file itself,
// types stripped in place, so V8's offsets ARE offsets into route.ts). Then reads V8's block ranges
// for my range only: the `customer-capture` branch to the end of the file.
//
// A character is "not run" when the innermost range covering it has count 0 in EVERY process.
// A line is "missed" when none of its code characters ran. With --branches, a zero-count range that
// sits inside a line that DID run is a branch arm nobody took (an `if` that was never true, a `?:`
// side never chosen) — which is what "every bit" has to mean, because a line can run without ever
// taking its second half.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ROOT, ROUTE_REL, src, MY_START } from "./lib.mjs";

const dir = mkdtempSync(join(tmpdir(), "t10cov-"));
const RUNS = [
  ["scripts/sweep/t10s10/run.mjs", ["--block", "a", "--quiet"]],
  ["scripts/sweep/t10s10/run.mjs", ["--block", "b", "--quiet"]],
  ["scripts/sweep/t10s10/run.mjs", ["--block", "c", "--quiet"]],
  ["scripts/sweep/t10s10/run.mjs", ["--block", "r3", "--quiet"]],
  ["scripts/sweep/t10s10/rerun.mjs", ["--quiet", "--stub-only"]],
  ["scripts/verify-voided-stays-voided.mjs", []],
  ["scripts/verify-t10-manager-writes.mjs", []],
];
try {
  for (const [script, args] of RUNS) {
    try {
      execFileSync("node", ["--no-warnings", "--import", "./scripts/sweep/t9s10/hooks.mjs", script, ...args],
        { cwd: ROOT, env: { ...process.env, NODE_V8_COVERAGE: dir, T9_COVERAGE: "1" }, stdio: "pipe", timeout: 900000 });
    } catch { /* a red check still leaves coverage; the run's own report says which */ }
  }
  const N = src.length;
  const runAny = new Uint8Array(N);
  const zeroRanges = [];
  let sawFile = false;
  for (const f of readdirSync(dir)) {
    const j = JSON.parse(readFileSync(join(dir, f), "utf8"));
    const rs = [];
    for (const s of j.result || []) if (decodeURIComponent(s.url).endsWith(ROUTE_REL)) for (const fn of s.functions) for (const r of fn.ranges) rs.push(r);
    if (!rs.length) continue;
    sawFile = true;
    const best = new Int32Array(N).fill(-1), bestLen = new Float64Array(N).fill(Infinity);
    for (const r of rs) {
      const len = r.endOffset - r.startOffset;
      for (let i = Math.max(r.startOffset, MY_START); i < Math.min(r.endOffset, N); i++) if (len <= bestLen[i]) { bestLen[i] = len; best[i] = r.count; }
      if (r.count === 0 && r.endOffset > MY_START) zeroRanges.push([r.startOffset, r.endOffset]);
    }
    for (let i = MY_START; i < N; i++) if (best[i] > 0) runAny[i] = 1;
  }
  if (!sawFile) throw new Error("no coverage was recorded for route.ts — the hooks did not load the real file");
  const lines = src.split("\n");
  let off = 0; const missed = []; let codeLines = 0;
  const lineOfOff = (o) => src.slice(0, o).split("\n").length;
  for (let k = 0; k < lines.length; k++) {
    const L = lines[k]; const t = L.trim();
    if (off + L.length >= MY_START) {
      const isCode = t && !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*") && !/^[})\];,]+$/.test(t);
      if (isCode) {
        codeLines++;
        let anyRun = false, anyCode = false;
        for (let i = Math.max(off, MY_START); i < off + L.length; i++) { if (/\s/.test(src[i])) continue; anyCode = true; if (runAny[i]) { anyRun = true; break; } }
        if (anyCode && !anyRun) missed.push(k + 1);
      }
    }
    off += L.length + 1;
  }
  // Branch arms: a zero range none of whose characters any process ran, inside a line that did run.
  const arms = [];
  if (process.argv.includes("--branches")) {
    const seen = new Set();
    for (const [a, b] of zeroRanges) {
      const s0 = Math.max(a, MY_START);
      let ran = false; for (let i = s0; i < b; i++) if (runAny[i]) { ran = true; break; }
      if (ran) continue;
      const ln = lineOfOff(s0);
      if (missed.includes(ln)) continue;
      const key = `${ln}:${src.slice(s0, Math.min(b, s0 + 50)).replace(/\s+/g, " ")}`;
      if (!seen.has(key)) { seen.add(key); arms.push({ line: ln, text: src.slice(s0, Math.min(b, s0 + 70)).replace(/\s+/g, " ") }); }
    }
  }
  const pct = ((1 - missed.length / codeLines) * 100).toFixed(1);
  console.log(`route.ts, my range (line ${lineOfOff(MY_START)}–${lines.length}): ${codeLines} code lines · ${codeLines - missed.length} run · ${missed.length} never run · ${pct}%`);
  if (process.argv.includes("--branches")) console.log(`branch arms never taken inside lines that ran: ${arms.length}`);
  const out = process.argv.includes("--json") ? process.argv[process.argv.indexOf("--json") + 1] : null;
  if (out) writeFileSync(out, JSON.stringify({ missed, arms }, null, 1));
  else { console.log("missed lines:", missed.join(" ")); for (const a of arms.slice(0, 400)) console.log(`  arm L${a.line}: ${a.text}`); }
} finally { rmSync(dir, { recursive: true, force: true }); }
