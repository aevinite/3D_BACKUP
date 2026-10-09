// scripts/sweep/t9s10/coverage.mjs — which lines of MY half did the in-memory checks never execute?
//
//   node scripts/sweep/t9s10/coverage.mjs            # runs blocks a, b, c (+ round 2) against the real route.ts
//
// Runs the blocks under NODE_V8_COVERAGE with the REAL file (./hooks.mjs), then reads V8's block
// ranges for route.ts. Node strips types by blanking them, so offsets are offsets into the file.
// A character is "not run" when the innermost range covering it has count 0. Reported per line, for
// lines 1 … the end of the table-sections branch only — the boundary of sweep #10 terminal 9.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ROOT, ROUTE_REL, src, MY_END } from "./lib.mjs";

const dir = mkdtempSync(join(tmpdir(), "t9cov-"));
const blocks = (process.argv.find((a) => a.startsWith("--blocks=")) || "--blocks=a,b,c,e").split("=")[1].split(",");
try {
  for (const b of blocks) {
    try {
      execFileSync("node", ["--no-warnings", "--import", "./scripts/sweep/t9s10/hooks.mjs", "scripts/sweep/t9s10/run.mjs", "--block", b, "--quiet", "--stub-only"],
        { cwd: ROOT, env: { ...process.env, NODE_V8_COVERAGE: dir, T9_COVERAGE: "1" }, stdio: "pipe", timeout: 600000 });
    } catch { /* a red check still produces coverage; the run's own report says which */ }
  }
  const want = "route.ts";
  const ranges = [];
  for (const f of readdirSync(dir)) {
    const j = JSON.parse(readFileSync(join(dir, f), "utf8"));
    for (const s of j.result || []) if (decodeURIComponent(s.url).endsWith(ROUTE_REL)) for (const fn of s.functions) for (const r of fn.ranges) ranges.push(r);
  }
  if (!ranges.length) throw new Error(`no coverage was recorded for ${want}`);
  // Per offset: innermost (shortest) range wins; a char is run if ANY process ran it.
  const N = MY_END;
  const best = new Int32Array(N).fill(-1), bestLen = new Float64Array(N).fill(Infinity), runAny = new Uint8Array(N);
  // Group by process: a range set is per-script-instance, so evaluate each file separately.
  const perFile = readdirSync(dir).map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")));
  for (const j of perFile) {
    const rs = []; for (const s of j.result || []) if (decodeURIComponent(s.url).endsWith(ROUTE_REL)) for (const fn of s.functions) for (const r of fn.ranges) rs.push(r);
    if (!rs.length) continue;
    best.fill(-1); bestLen.fill(Infinity);
    for (const r of rs) { const len = r.endOffset - r.startOffset; for (let i = r.startOffset; i < Math.min(r.endOffset, N); i++) if (len <= bestLen[i]) { bestLen[i] = len; best[i] = r.count; } }
    for (let i = 0; i < N; i++) if (best[i] > 0) runAny[i] = 1;
  }
  const lines = src.slice(0, N).split("\n");
  let off = 0; const missed = [];
  let codeLines = 0;
  for (let k = 0; k < lines.length; k++) {
    const L = lines[k]; const t = L.trim();
    const isCode = t && !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*") && !/^[})\];,]+$/.test(t) && !/^(import|export \{|type |\} from)/.test(t);
    if (isCode) {
      codeLines++;
      let anyRun = false, anyCode = false;
      for (let i = off; i < off + L.length; i++) { if (/\s/.test(src[i])) continue; anyCode = true; if (runAny[i]) { anyRun = true; break; } }
      if (anyCode && !anyRun) missed.push(k + 1);
    }
    off += L.length + 1;
  }
  // BRANCH ARMS: a zero-count V8 range inside a line that DID run is a branch arm no test took.
  // (A range is counted as taken if any run took it.) Reported with --branches.
  if (process.argv.includes("--branches")) {
    const zero = [];
    const taken = new Set();
    for (const j of perFile) for (const s2 of j.result || []) if (decodeURIComponent(s2.url).endsWith(ROUTE_REL)) for (const fn of s2.functions) for (const r of fn.ranges) {
      const key = r.startOffset + ":" + r.endOffset;
      if (r.count > 0) taken.add(key); else if (r.startOffset < N) zero.push(r);
    }
    // V8 writes a nested range only where its count DIFFERS from the enclosing one, so an arm taken in
    // one test process leaves no matching entry there to cancel a zero entry from another process.
    // Judge each zero range by the union of executed characters across processes instead (runAny).
    const ranIn = (r) => { for (let i = r.startOffset; i < Math.min(r.endOffset, N); i++) if (!/\s/.test(src[i]) && runAny[i]) return true; return false; };
    const arms = [...new Map(zero.filter((r) => !taken.has(r.startOffset + ":" + r.endOffset) && !ranIn(r)).map((r) => [r.startOffset + ":" + r.endOffset, r])).values()]
      .filter((r) => { const t = src.slice(r.startOffset, Math.min(r.endOffset, r.startOffset + 200)).replace(/\/\/[^\n]*/g, "").trim(); return t.length > 1; })
      .sort((a, b) => a.startOffset - b.startOffset);
    console.log(`branch arms never taken in lines 1–${src.slice(0, N).split("\n").length}: ${arms.length}`);
    for (const r of arms) { const ln = src.slice(0, r.startOffset).split("\n").length; console.log(`  L${ln}: ${src.slice(r.startOffset, Math.min(r.endOffset, r.startOffset + 90)).replace(/\s+/g, " ")}`); }
  }
  console.log(`route.ts lines 1–${lines.length}: ${codeLines} code lines, ${codeLines - missed.length} executed (${((1 - missed.length / codeLines) * 100).toFixed(1)}%), ${missed.length} never executed`);
  // Collapse runs for reading.
  const runs = []; for (const n of missed) { const last = runs[runs.length - 1]; if (last && n === last[1] + 1) last[1] = n; else runs.push([n, n]); }
  for (const [a, b] of runs) console.log(`  ${a === b ? a : `${a}–${b}`}: ${lines[a - 1].trim().slice(0, 110)}`);
} finally { rmSync(dir, { recursive: true, force: true }); }
