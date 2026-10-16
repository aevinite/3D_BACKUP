// scripts/sweep/t4s10/covmap.mjs — turn V8 coverage of BUNDLED code back into lines of my 24 files.
//
// Sweep #10 T4 round 2 (2026-10-15). My checks never run a file directly: the in-memory blocks bundle the
// real file with esbuild (lib.mjs → load()), the screen lab bundles the screens for a browser (lab/).
// Both bundles carry an inline source map when T4_COVER=1, so a V8 range in the bundle maps back to a
// line and column of the file a person reads. This module does that mapping for both, and unions the
// result across every process and page (V8 only writes a nested range where its count DIFFERS from the
// enclosing one — an arm taken in one run leaves nothing to cancel a zero from another run, so a position
// counts as RUN if any run ran it).
//
//   addScript(bundleText, ranges)   — one script instance (a Node process's module, or a page's script)
//   report(files)                   — { file: { codeLines, runLines, neverRun:[line], arms:[{line,col,text}] } }
import { TraceMap, eachMapping } from "@jridgewell/trace-mapping";
import { readFileSync } from "node:fs";
import { join, resolve, dirname, relative } from "node:path";
import { ROOT } from "./lib.mjs";

const ran = new Map();     // file → Set("line:col") of original positions some run executed
const seen = new Map();    // file → Set("line:col") of original positions that exist in some bundle
const zeroes = new Map();  // file → Map("line:col" → first original position of a zero-count range)
const add = (m, f, k, v = true) => { if (!m.has(f)) m.set(f, m === zeroes ? new Map() : new Set()); const s = m.get(f); if (m === zeroes) { if (!s.has(k)) s.set(k, v); } else s.add(k); };

function inlineMap(text) {
  const m = text.match(/\/\/# sourceMappingURL=data:application\/json;(?:charset=utf-8;)?base64,([A-Za-z0-9+/=]+)\s*$/);
  return m ? JSON.parse(Buffer.from(m[1], "base64").toString("utf8")) : null;
}

/** One script instance: its full text (with the inline map) and V8's function ranges for it. */
const parsed = new Map(); // cacheKey → { segs } — one bundle's mapping, parsed once however many pages ran it
export function addScript(text, functions, bundleDir, cacheKey) {
  let pre = cacheKey ? parsed.get(cacheKey) : null;
  if (!pre) {
    const map = inlineMap(text);
    if (!map) return false;
    const tm = new TraceMap(map);
    const starts = [0]; for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
    const segs0 = [];
    eachMapping(tm, (m) => {
      if (m.source == null || m.originalLine == null) return;
      const file = relative(ROOT, resolve(bundleDir, decodeURIComponent(m.source))); // esbuild escapes "[restaurant]" as %5B…%5D
      if (file.startsWith("..") || file.startsWith("node_modules") || file.startsWith("scripts/")) return;
      segs0.push({ file, key: `${m.originalLine}:${m.originalColumn}`, off: starts[m.generatedLine - 1] + m.generatedColumn });
    });
    segs0.sort((a, b) => a.off - b.off);
    pre = { segs: segs0 };
    if (cacheKey) parsed.set(cacheKey, pre);
  }
  return addRanges(pre.segs, functions);
}
function addRanges(segs, functions) {
  const ranges = []; for (const fn of functions) for (const r of fn.ranges) ranges.push(r);
  // V8's ranges nest. Sweep the (sorted) segments once, keeping a stack of the ranges that are open at
  // that offset: the top of the stack is the innermost range, whose count decides "run or not".
  const byStart = [...ranges].sort((a, b) => a.startOffset - b.startOffset || (b.endOffset - b.startOffset) - (a.endOffset - a.startOffset));
  const stack = []; let ri = 0;
  for (const sg of segs) {
    while (ri < byStart.length && byStart[ri].startOffset <= sg.off) {
      const r = byStart[ri++]; while (stack.length && stack[stack.length - 1].endOffset <= r.startOffset) stack.pop(); stack.push(r);
    }
    while (stack.length && stack[stack.length - 1].endOffset <= sg.off) stack.pop();
    const count = stack.length ? stack[stack.length - 1].count : -1;
    add(seen, sg.file, sg.key); if (count > 0) add(ran, sg.file, sg.key);
  }
  // a zero-count range: remember the first original position inside it (the arm's start); segs are sorted
  const lowerBound = (off) => { let lo = 0, hi = segs.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (segs[mid].off < off) lo = mid + 1; else hi = mid; } return lo; };
  for (const r of ranges) if (r.count === 0) {
    const inside = []; for (let i = lowerBound(r.startOffset); i < segs.length && segs[i].off < r.endOffset; i++) inside.push(segs[i]);
    if (!inside.length) continue;
    const first = inside.reduce((a, b) => (a.off <= b.off ? a : b));
    for (const s of inside) add(zeroes, s.file, `${r.startOffset}:${r.endOffset}:${s.key}`, { first: first.key, all: inside.filter((x) => x.file === s.file).map((x) => x.key) });
  }
  return true;
}

/** Read a NODE_V8_COVERAGE directory written by Node processes that required t4s10 bundles. */
export function addNodeDir(dir, readdirSync) {
  let n = 0;
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    const j = JSON.parse(readFileSync(join(dir, f), "utf8"));
    for (const s of j.result || []) {
      const url = decodeURIComponent(s.url || "");
      if (!/\/t4s10-[^/]*\.cjs$/.test(url)) continue;
      const path = url.replace(/^file:\/\//, "");
      let text; try { text = readFileSync(path, "utf8"); } catch { continue; }
      if (addScript(text, s.functions, dirname(path))) n++;
    }
  }
  return n;
}

const isCodeLine = (t) => t && !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*") && !/^[})\];,]+$/.test(t) && !/^(import |export \{|export type |type |\} from|interface )/.test(t);

export function report(files) {
  const out = {};
  for (const file of files) {
    const src = readFileSync(join(ROOT, file), "utf8").split("\n");
    const sn = seen.get(file) || new Set(), rn = ran.get(file) || new Set();
    const lineHas = new Map(), lineRan = new Map();
    for (const k of sn) { const l = Number(k.split(":")[0]); lineHas.set(l, true); if (rn.has(k)) lineRan.set(l, true); }
    const neverRun = [...lineHas.keys()].filter((l) => !lineRan.get(l) && isCodeLine((src[l - 1] || "").trim())).sort((a, b) => a - b);
    const codeLines = [...lineHas.keys()].filter((l) => isCodeLine((src[l - 1] || "").trim())).length;
    // an arm is untaken when NONE of the original positions inside its zero range ran in any run
    const arms = new Map();
    for (const v of (zeroes.get(file) || new Map()).values()) {
      if (v.all.some((k) => rn.has(k))) continue;
      const [l, c] = v.first.split(":").map(Number);
      if (!neverRun.includes(l)) arms.set(v.first, { line: l, col: c, text: (src[l - 1] || "").slice(c, c + 80).trim() });
    }
    out[file] = { inBundle: sn.size > 0, codeLines, runLines: codeLines - neverRun.length, neverRun, arms: [...arms.values()].sort((a, b) => a.line - b.line || a.col - b.col) };
  }
  return out;
}

export function print(rep) {
  let tl = 0, tr = 0, ta = 0;
  for (const [file, r] of Object.entries(rep)) {
    tl += r.codeLines; tr += r.runLines; ta += r.arms.length;
    console.log(`${r.inBundle ? "" : "(never loaded) "}${file}: ${r.runLines}/${r.codeLines} code lines run · ${r.neverRun.length} never · ${r.arms.length} branch arm(s) never taken`);
    const src = readFileSync(join(ROOT, file), "utf8").split("\n");
    const runs = []; for (const n of r.neverRun) { const last = runs[runs.length - 1]; if (last && n === last[1] + 1) last[1] = n; else runs.push([n, n]); }
    for (const [a, b] of runs) console.log(`    L${a === b ? a : `${a}–${b}`}: ${src[a - 1].trim().slice(0, 110)}`);
    for (const a of r.arms) console.log(`    arm L${a.line}:${a.col}  ${a.text}`);
  }
  console.log(`\nTOTAL: ${tr}/${tl} code lines run (${tl ? ((tr / tl) * 100).toFixed(1) : 0}%) · ${tl - tr} never · ${ta} arms never taken`);
}
