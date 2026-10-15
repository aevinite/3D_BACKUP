// scripts/sweep/t3s10/r3/cover.mjs — WHICH LINES AND BRANCHES OF TERMINAL 3'S CODE DID NOTHING RUN?
//
//   node scripts/sweep/t3s10/r3/cover.mjs [--areas B,C,D,E,F] [--file lib/guestOutbox.ts]
//
// Runs the round-3 in-memory suite under NODE_V8_COVERAGE with the REAL files (./hooks.mjs), then reads
// V8's ranges per file. Node strips types by blanking them, so offsets are offsets into the file. A
// character "ran" if the innermost range over it had a count above 0 in ANY process; a code line none
// of whose characters ran is reported, and so is every zero-count branch arm inside lines that did run.
// (Method: scripts/sweep/t9s10/coverage.mjs — union the executed characters across processes, because
// V8 only writes a nested range where its count differs from the one around it.)
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ROOT, CODE_FILES, rd } from "./h.mjs";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const areas = arg("--areas", "B,C,D,E,F");
const files = arg("--file", null) ? [arg("--file")] : CODE_FILES;
const dir = mkdtempSync(join(tmpdir(), "t3r3cov-"));
try {
  try {
    execFileSync("node", ["--no-warnings", "--import", "./scripts/sweep/t3s10/r3/hooks.mjs", "scripts/sweep/t3s10/r3/run.mjs", "--areas", areas, "--quiet"],
      { cwd: ROOT, env: { ...process.env, NODE_V8_COVERAGE: dir, T3R3_WALKS: process.env.T3R3_WALKS || "80" }, stdio: "pipe", timeout: 1_200_000 });
  } catch { /* a red check still leaves coverage; the suite's own run says which */ }
  const perFile = readdirSync(dir).map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")));
  let totalCode = 0, totalMissed = 0, totalArms = 0;
  for (const rel of files) {
    const src = rd(rel); const N = src.length; const suffix = "/" + rel;
    const runAny = new Uint8Array(N); let seen = false;
    const best = new Int32Array(N), bestLen = new Float64Array(N);
    // EACH LOADED COPY ON ITS OWN. ./h.mjs real() imports a fresh copy per scenario (`?r3=<n>`), and V8
    // reports each copy as its own script. Pooling their ranges let a copy that was loaded and never
    // called (every count 0) overwrite one that ran, wherever the two ranges had the same length — the
    // first report said parseActive never ran while 4,096 status lists went through it.
    for (const j of perFile) for (const s of j.result || []) {
      if (!decodeURIComponent(s.url).split("?")[0].endsWith(suffix)) continue;
      const rs = []; for (const fn of s.functions) for (const r of fn.ranges) rs.push(r);
      if (!rs.length) continue; seen = true;
      best.fill(-1); bestLen.fill(Infinity);
      for (const r of rs) { const len = r.endOffset - r.startOffset; for (let i = r.startOffset; i < Math.min(r.endOffset, N); i++) if (len <= bestLen[i]) { bestLen[i] = len; best[i] = r.count; } }
      for (let i = 0; i < N; i++) if (best[i] > 0) runAny[i] = 1;
    }
    if (!seen) { console.log(`\n${rel}: NOTHING RAN IT`); continue; }
    const lines = src.split("\n"); let off = 0; const missed = []; let code = 0; let inBlock = false;
    for (let k = 0; k < lines.length; k++) {
      const L = lines[k], t = L.trim();
      if (t.startsWith("/*")) inBlock = !t.includes("*/");
      const comment = inBlock || t.startsWith("//") || t.startsWith("*") || t.startsWith("/*");
      if (inBlock && t.includes("*/")) inBlock = false;
      const isCode = t && !comment && !/^[})\];,]+$/.test(t) && !/^(import|export \{|type |export type |interface |\} from)/.test(t);
      if (isCode) { code++; let any = false, hasCode = false; for (let i = off; i < off + L.length; i++) { if (/\s/.test(src[i])) continue; hasCode = true; if (runAny[i]) { any = true; break; } } if (hasCode && !any) missed.push(k + 1); }
      off += L.length + 1;
    }
    // zero-count arms inside lines that ran
    const ranIn = (r) => { for (let i = r.startOffset; i < Math.min(r.endOffset, N); i++) if (!/\s/.test(src[i]) && runAny[i]) return true; return false; };
    const arms = new Map();
    for (const j of perFile) for (const s of j.result || []) if (decodeURIComponent(s.url).split("?")[0].endsWith(suffix)) for (const fn of s.functions) for (const r of fn.ranges)
      if (r.count === 0 && !ranIn(r)) { const t = src.slice(r.startOffset, Math.min(r.endOffset, r.startOffset + 200)).replace(/\/\/[^\n]*/g, "").trim(); if (t.length > 1) arms.set(r.startOffset + ":" + r.endOffset, r); }
    const armLines = [...new Set([...arms.values()].map((r) => src.slice(0, r.startOffset).split("\n").length))].filter((ln) => !missed.includes(ln)).sort((a, b) => a - b);
    totalCode += code; totalMissed += missed.length; totalArms += armLines.length;
    console.log(`\n${rel}: ${code} code lines · ${code - missed.length} run (${((1 - missed.length / code) * 100).toFixed(1)}%) · ${missed.length} never run · ${armLines.length} line(s) with a branch never taken`);
    const runs = []; for (const n of missed) { const last = runs[runs.length - 1]; if (last && n === last[1] + 1) last[1] = n; else runs.push([n, n]); }
    for (const [a, b] of runs) console.log(`   ${a === b ? a : `${a}–${b}`}: ${lines[a - 1].trim().slice(0, 110)}`);
    for (const ln of armLines) console.log(`   arm L${ln}: ${lines[ln - 1].trim().slice(0, 110)}`);
  }
  console.log(`\nALL: ${totalCode} code lines · ${totalMissed} never run · ${totalArms} lines with an untaken branch`);
} finally { rmSync(dir, { recursive: true, force: true }); }
