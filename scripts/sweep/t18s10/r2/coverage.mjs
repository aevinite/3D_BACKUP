// scripts/sweep/t18s10/r2/coverage.mjs — which lines and branch arms of terminal 18's eleven library
// files did the round-2 checks never execute?
//
//   node scripts/sweep/t18s10/r2/coverage.mjs [--only=a,b] [--files=accessTree,staffCaps]
//
// Runs r2/run.mjs (in-memory blocks only) under NODE_V8_COVERAGE with the REAL files, then reads V8's
// block ranges. Node strips types by blanking them, so offsets are offsets into each .ts file. A
// character is "run" if, in any process, the innermost range covering it had a count above 0. A branch
// arm is a zero-count range whose characters no process ran.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ROOT } from "./core.mjs";

const FILES = ["accessTree", "accessModel", "accessState", "accessConfig", "staffCaps", "staffProfile", "staffProfileShared", "features", "ownerEntitlements", "viewAsPerson"];
const want = (process.argv.find((a) => a.startsWith("--files=")) || "").split("=")[1]?.split(",") || FILES;
const onlyArg = process.argv.find((a) => a.startsWith("--only="));
const dir = mkdtempSync(join(tmpdir(), "t18cov-"));
try {
  try {
    execFileSync("node", ["--no-warnings", "--import", "./scripts/sweep/t18s10/r2/hooks.mjs", "scripts/sweep/t18s10/r2/run.mjs", "--no-live", "--quiet", ...(onlyArg ? [onlyArg] : [])],
      { cwd: ROOT, env: { ...process.env, NODE_V8_COVERAGE: dir }, stdio: "pipe", timeout: 900000 });
  } catch { /* a red check still yields coverage; run.mjs reports reds itself */ }
  const perProc = readdirSync(dir).map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")));
  let totalCode = 0, totalMissed = 0, totalArms = 0;
  for (const name of want) {
    const rel = `lib/${name}.ts`, src = readFileSync(join(ROOT, rel), "utf8"), N = src.length;
    const runAny = new Uint8Array(N); const zero = [];
    let seen = false;
    for (const j of perProc) {
      const rs = []; for (const s of j.result || []) if (decodeURIComponent(s.url).endsWith("/" + rel)) for (const fn of s.functions) for (const r of fn.ranges) rs.push(r);
      if (!rs.length) continue;
      seen = true;
      const best = new Int32Array(N).fill(-1), bestLen = new Float64Array(N).fill(Infinity);
      for (const r of rs) { const len = r.endOffset - r.startOffset; for (let i = r.startOffset; i < Math.min(r.endOffset, N); i++) if (len <= bestLen[i]) { bestLen[i] = len; best[i] = r.count; } }
      for (let i = 0; i < N; i++) if (best[i] > 0) runAny[i] = 1;
      for (const r of rs) if (r.count === 0) zero.push(r);
    }
    if (!seen) { console.log(`${rel}: NOT LOADED by any check`); continue; }
    const lines = src.split("\n"); let off = 0; const missed = []; let code = 0;
    for (let k = 0; k < lines.length; k++) {
      const L = lines[k], t = L.trim();
      const isCode = t && !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*") && !/^[})\];,]+$/.test(t) && !/^(import|export \{|export \*|type |\} from)/.test(t);
      if (isCode) { code++; let any = false, anyCode = false; for (let i = off; i < off + L.length; i++) { if (/\s/.test(src[i])) continue; anyCode = true; if (runAny[i]) { any = true; break; } } if (anyCode && !any) missed.push(k + 1); }
      off += L.length + 1;
    }
    const ranIn = (r) => { for (let i = r.startOffset; i < Math.min(r.endOffset, N); i++) if (!/\s/.test(src[i]) && runAny[i]) return true; return false; };
    const arms = [...new Map(zero.filter((r) => !ranIn(r)).map((r) => [r.startOffset + ":" + r.endOffset, r])).values()]
      .filter((r) => src.slice(r.startOffset, Math.min(r.endOffset, r.startOffset + 200)).replace(/\/\/[^\n]*/g, "").trim().length > 1)
      .sort((a, b) => a.startOffset - b.startOffset);
    totalCode += code; totalMissed += missed.length; totalArms += arms.length;
    console.log(`${rel}: ${code} code lines · ${code - missed.length} run (${((1 - missed.length / Math.max(1, code)) * 100).toFixed(1)}%) · ${missed.length} never run · ${arms.length} branch arm(s) never taken`);
    for (const n of missed) console.log(`    line ${n}: ${lines[n - 1].trim().slice(0, 110)}`);
    for (const r of arms) { const ln = src.slice(0, r.startOffset).split("\n").length; console.log(`    arm  L${ln}: ${src.slice(r.startOffset, Math.min(r.endOffset, r.startOffset + 100)).replace(/\s+/g, " ")}`); }
  }
  console.log(`TOTAL: ${totalCode} code lines · ${totalMissed} never run · ${totalArms} branch arms never taken`);
} finally { rmSync(dir, { recursive: true, force: true }); }
