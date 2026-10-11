// scripts/sweep/t13s10/coverage.mjs — which lines of terminal 13's seven files did NO check execute?
//
//   node scripts/sweep/t13s10/coverage.mjs                 # every in-memory suite, every file
//   node scripts/sweep/t13s10/coverage.mjs --file=lib/liveBoard.ts --show   (--show prints each line + the fragment not run)
//
// Runs the in-memory suites (blocks a–c and round 2's, the re-run rows, verify:tablet-twins) under
// NODE_V8_COVERAGE against the REAL source files (./hooks.mjs). A character is "not run" when the
// innermost V8 block range covering it has count 0; a line is reported when any CODE on it was not
// run (blank lines and comment-only lines are ignored). This is how "every single bit" is measured
// rather than claimed.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url)).replace(/\/$/, "");
const FILES = ["app/api/tablet/[...path]/route.ts", "lib/cancelWatch.ts", "lib/floorSummary.ts", "lib/liveBoard.ts", "lib/managerCan.ts", "lib/tableOfAction.ts", "lib/tableTags.ts"];
const only = (process.argv.find((a) => a.startsWith("--file=")) || "").split("=")[1];
const SHOW = process.argv.includes("--show");
const dir = mkdtempSync(join(tmpdir(), "t13cov-"));
const env = { ...process.env, NODE_V8_COVERAGE: dir, T13_COVERAGE: "1", T13_BLOCKS: process.env.T13_BLOCKS || "a,b,c,e,f,g,h,i" };
const runs = [
  ["scripts/sweep/t13s10/run.mjs", "--quiet"],
  ["scripts/sweep/t13s10/rerun-rows.mjs"],
  ["scripts/verify-tablet-twin-rules.mjs"],
];
try {
  for (const [f, ...a] of runs) {
    try { execFileSync("node", ["--no-warnings", "--import", "./scripts/sweep/t13s10/hooks.mjs", f, ...a], { cwd: ROOT, env, stdio: "pipe", timeout: 900000 }); }
    catch (e) { if (!String(e.stdout || "").length) console.error(`  (${f} exited ${e.status}: ${String(e.stderr || e.message).slice(0, 200)})`); }
  }
  let total = 0;
  for (const rel of FILES) {
    if (only && rel !== only) continue;
    const src = readFileSync(join(ROOT, rel), "utf8");
    const ranges = [];
    for (const f of readdirSync(dir)) {
      const j = JSON.parse(readFileSync(join(dir, f), "utf8"));
      for (const s of j.result || []) if (decodeURIComponent(s.url).endsWith(rel)) for (const fn of s.functions) for (const r of fn.ranges) ranges.push(r);
    }
    if (!ranges.length) { console.log(`✗ ${rel}: no coverage recorded at all`); total++; continue; }
    // count per char: the innermost (shortest) range covering it wins; a char is run if ANY process ran it
    const run = new Uint8Array(src.length), seen = new Uint8Array(src.length);
    const byProc = new Map();
    for (const f of readdirSync(dir)) {
      const j = JSON.parse(readFileSync(join(dir, f), "utf8"));
      for (const s of j.result || []) if (decodeURIComponent(s.url).endsWith(rel)) {
        const rs = s.functions.flatMap((fn) => fn.ranges).sort((a, b) => (b.endOffset - b.startOffset) - (a.endOffset - a.startOffset));
        const cnt = new Int32Array(src.length).fill(-1);
        for (const r of rs) for (let i = r.startOffset; i < Math.min(r.endOffset, src.length); i++) cnt[i] = r.count;
        for (let i = 0; i < src.length; i++) { if (cnt[i] >= 0) seen[i] = 1; if (cnt[i] > 0) run[i] = 1; }
        byProc.set(f, true);
      }
    }
    const lines = src.split("\n"); let off = 0; const miss = []; const frag = new Map();
    for (let ln = 0; ln < lines.length; ln++) {
      const L = lines[ln], code = L.replace(/\/\/.*$/, "").trim();
      if (code && !/^[*/]/.test(code) && !/^[})\];,]+$/.test(code)) {
        let bad = false;
        for (let i = 0; i < L.length; i++) { const ch = L[i]; if (/\s/.test(ch)) continue; if (L.slice(i).startsWith("//")) break; if (seen[off + i] && !run[off + i]) { bad = true; break; } }
        if (bad) { miss.push(ln + 1); frag.set(ln + 1, L.replace(/\S/g, (ch, i) => (seen[off + i] && !run[off + i] ? ch : "·")).replace(/·+/g, "·").trim()); }
      }
      off += L.length + 1;
    }
    total += miss.length;
    console.log(`${miss.length ? "✗" : "✓"} ${rel}: ${miss.length} line(s) with code no check ran${miss.length ? " — " + compress(miss) : ""}`);
    if (SHOW) for (const m of miss) console.log(`    ${String(m).padStart(5)}  ${lines[m - 1].trim().slice(0, 150)}\n           not run: ${frag.get(m).slice(0, 150)}`);
  }
  console.log(`\n${total} uncovered line(s) across ${only ? 1 : FILES.length} file(s)`);
} finally { rmSync(dir, { recursive: true, force: true }); }
function compress(a) { const out = []; for (let i = 0; i < a.length; i++) { let j = i; while (j + 1 < a.length && a[j + 1] === a[j] + 1) j++; out.push(i === j ? `${a[i]}` : `${a[i]}–${a[j]}`); i = j; } return out.join(", "); }
