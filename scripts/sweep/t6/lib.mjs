// Shared plumbing for terminal 6's re-runnable check suites (the manager panel, lines 1..9,300 of
// public/panels/editor/app.js).
//
// WHY THESE EXIST AS COMMITTED SCRIPTS. Sweep #8 T6 filed 1,000 ledger rows (P59701-P60700) and ran
// every one of them from throwaway files in a scratch directory, which were then deleted as temp
// files. The rows survived; the ability to RE-RUN them did not — and the whole point of the ledger
// is that "re-run row P59842" is a sentence that means something. T7, T8 and T9 committed theirs
// (scripts/sweep/t7, t8, t9); this is T6 catching up. Written 2026-09-03, immediately after the
// owner asked "have you retested everything?" and the honest answer was "not against the merged
// code, and not with anything that still exists".
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const arg = process.argv.slice(2).find((a) => !a.startsWith("-"));
export const ROOT = arg && existsSync(join(arg, "package.json"))
  ? arg : join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
export const read = (p) => (existsSync(join(ROOT, p)) ? readFileSync(join(ROOT, p), "utf8") : "");

/** The one-pass stripper verify-panel-scope uses: comments and strings become spaces, newlines are
 *  kept, so a line number here is a line number in the file. A name inside a comment is NOT a
 *  reference — that distinction is what found four dead constants whose notes described live
 *  behaviour (round 1, item 8) and five dead screens (round 2, item 12). */
export function strip(src) {
  let out = "", i = 0; const n = src.length;
  const keep = (c) => (out += c); const hide = (c) => (out += c === "\n" ? "\n" : " ");
  const beforeRegex = /[([{=,:;!&|?+\-*%~^]$|\b(?:return|typeof|case|in|of|new|delete|void|do|else|yield|await)$/;
  const tmpl = [];
  while (i < n) {
    const c = src[i], c2 = src[i + 1];
    if (c === "/" && c2 === "/") { while (i < n && src[i] !== "\n") hide(src[i++]); continue; }
    if (c === "/" && c2 === "*") { hide(src[i++]); hide(src[i++]); while (i < n && !(src[i] === "*" && src[i + 1] === "/")) hide(src[i++]); hide(src[i++] || ""); hide(src[i++] || ""); continue; }
    if (c === '"' || c === "'") { const q = c; hide(src[i++]); while (i < n && src[i] !== q) { if (src[i] === "\\") hide(src[i++]); hide(src[i++]); } hide(src[i++] || ""); continue; }
    if (c === "`") { hide(src[i++]); while (i < n) { if (src[i] === "\\") { hide(src[i++]); hide(src[i++]); continue; } if (src[i] === "`") { hide(src[i++]); break; } if (src[i] === "$" && src[i + 1] === "{") { hide(src[i++]); hide(src[i++]); tmpl.push(1); break; } hide(src[i++]); } continue; }
    if (c === "}" && tmpl.length) { tmpl.pop(); keep(src[i++]); while (i < n) { if (src[i] === "\\") { hide(src[i++]); hide(src[i++]); continue; } if (src[i] === "`") { hide(src[i++]); break; } if (src[i] === "$" && src[i + 1] === "{") { hide(src[i++]); hide(src[i++]); tmpl.push(1); break; } hide(src[i++]); } continue; }
    if (c === "/") { const before = out.replace(/\s+$/, ""); if (beforeRegex.test(before)) { hide(src[i++]); let cls = false; while (i < n && src[i] !== "\n") { if (src[i] === "\\") { hide(src[i++]); hide(src[i++]); continue; } if (src[i] === "[") cls = true; else if (src[i] === "]") cls = false; else if (src[i] === "/" && !cls) { hide(src[i++]); break; } hide(src[i++]); } continue; } }
    keep(src[i++]);
  }
  return out;
}

/** THE LINE THIS TERMINAL'S TERRITORY ENDS AT. Lines 1..9,300 of editor/app.js are T6's; the rest
 *  is T7's. 9,400 with slack at the seam, which is where the two halves' notes overlap. */
export const MINE_END = 9400;

export function reporter(label) {
  const rows = [];
  return {
    rows,
    add(check, pass, note) {
      rows.push({ check, result: pass === true ? "PASS" : pass === "skip" ? "SKIP" : "FAIL", note: note || "" });
    },
    done() {
      const p = rows.filter((r) => r.result === "PASS").length;
      const f = rows.filter((r) => r.result === "FAIL").length;
      const s = rows.filter((r) => r.result === "SKIP").length;
      console.log(`\n${label}: ${rows.length} checks · ${p} PASS · ${f} FAIL · ${s} SKIP`);
      for (const r of rows.filter((x) => x.result === "FAIL")) console.log(`  FAIL  ${r.check}\n        ${r.note}`);
      for (const r of rows.filter((x) => x.result === "SKIP")) console.log(`  SKIP  ${r.check}\n        ${r.note}`);
      return f;
    },
  };
}
