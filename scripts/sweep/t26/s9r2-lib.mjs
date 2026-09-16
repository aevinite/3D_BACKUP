// T26 · sweep #9 round 2 — the shared machinery for the 500.
//
// Kept apart from the checks so the checks read as a list of questions rather than as plumbing,
// and so a later round can ask new questions of the same 25 files without copying any of this.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");

/** The territory, RE-DERIVED every run — never a list typed into a file. The tree was 49 routes when
 *  the sweep-#9 prompts were written and is 51 today, which is why nothing here trusts a number. */
export function myFiles() {
  const all = [];
  (function walk(d) {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (e === "route.ts") all.push(relative(ROOT, p).replace(/\\/g, "/"));
    }
  })(join(ROOT, "app/api/admin"));
  return all.sort().slice(0, 25);
}

export const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

/**
 * Source with COMMENTS REMOVED. Every fix in this codebase quotes the bug it replaced in prose
 * directly above the fix, so a check that greps the raw file fires on the very comment that
 * documents the fix. LINE comments come off FIRST — these files describe themselves in prose and
 * that prose contains `/*`, which would otherwise open a block comment that eats real code. The
 * canary below proves nothing was eaten. (Both lessons are verify-admin-api-a's, learned the hard
 * way; they are repeated here rather than imported because this file must stand on its own.)
 */
export const strip = (src) => src
  .replace(/(^|[^:'"`\\])\/\/[^\n]*/gm, "$1")
  .replace(/\/\*[\s\S]*?\*\//g, "");

/** Did the stripper eat code? Every function the raw file DECLARES must survive. */
export function stripperSafe(rel) {
  const raw = read(rel), src = strip(raw);
  const codeOnly = raw.split(/\n/).filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
  const declared = [...codeOnly.matchAll(/(?:async\s+function|function)\s+([A-Za-z_$][\w$]*)\s*\(/g)].map((m) => m[1]);
  return declared.every((n) => new RegExp(`(?:async\\s+function|function)\\s+${n}\\s*\\(`).test(src));
}

/** The exported HTTP handlers this file declares, in source order. */
export function handlers(rel) {
  const src = strip(read(rel));
  const out = [];
  for (const m of src.matchAll(/export\s+(?:async\s+function|const)\s+(GET|POST|PATCH|DELETE|PUT)\b/g)) out.push(m[1]);
  return [...new Set(out)];
}

/** `/api/admin/…` for a route file, with a catch-all turned into a real first segment. */
export const urlOf = (rel) => "/" + rel.replace(/^app\//, "").replace(/\/route\.ts$/, "").replace(/\/\[\.\.\.[^\]]+\]$/, "");

/** Every `searchParams.get("x")` a file reads. */
export function queryParams(rel) {
  const src = strip(read(rel));
  return [...new Set([...src.matchAll(/searchParams\.get\(\s*["']([a-zA-Z_][\w-]*)["']\s*\)/g)].map((m) => m[1]))].sort();
}

/** Every `body.x` / `body?.x` a file reads — the POST/PATCH surface. */
export function bodyFields(rel) {
  const src = strip(read(rel));
  return [...new Set([...src.matchAll(/\bbody\??\.\s*([a-zA-Z_][\w]*)/g)].map((m) => m[1]))].filter((x) => x !== "json").sort();
}

/** Every supabase read/write statement, as { verb, chain } — one entry per `.from(…)`/`.rpc(…)`. */
export function dbCalls(rel) {
  const src = strip(read(rel));
  const out = [];
  const re = /\b(?:sb|supabaseAdmin|supabase)\s*\.\s*(from|rpc)\s*\(\s*["']([^"']+)["']\s*\)/g;
  for (const m of src.matchAll(re)) {
    // The chain is everything up to the statement's end. It stops at the SEMICOLON and at nothing
    // else — an earlier version also stopped at a blank line, which was wrong in the one way that
    // matters: stripping a comment out of the middle of a chain LEAVES a blank line, so a read
    // whose `.limit()` sat below its own explanatory comment looked unbounded. That reported five
    // properly-bounded reads as faults on its first run. A chain can run to 1,400 characters here
    // because these files explain themselves inside their own statements.
    const tail = src.slice(m.index, m.index + 1400);
    const end = tail.indexOf(";");
    out.push({ kind: m[1], table: m[2], chain: tail.slice(0, end > 0 ? end : 1400), at: src.slice(0, m.index).split("\n").length });
  }
  return out;
}

/** Every sentence this file can put on the admin's screen. */
export function sentences(rel) {
  const src = strip(read(rel));
  const out = [];
  for (const m of src.matchAll(/\b(?:err|bad)\(\s*(?:`([^`]{4,180})`|"([^"]{4,180})")/g)) out.push(m[1] || m[2]);
  for (const m of src.matchAll(/error:\s*(?:`([^`]{4,180})`|"([^"]{4,180})")/g)) out.push(m[1] || m[2]);
  for (const m of src.matchAll(/adminFail\(\s*"([^"]{2,80})"/g)) out.push("[adminFail] " + m[1]);
  return [...new Set(out)];
}

// ── the runner ───────────────────────────────────────────────────────────────────────────────────
export function Runner(firstId) {
  let n = firstId - 1;
  const rows = [];
  let pass = 0, fail = 0, skip = 0;
  const add = async (block, what, how, fn) => {
    n++;
    let v;
    try { v = await fn(); } catch (e) { v = { ok: false, note: "threw: " + (e instanceof Error ? e.message : String(e)).slice(0, 120) }; }
    const r = v === true ? { ok: true } : v === false ? { ok: false } : (v || { ok: false, note: "no result" });
    const mark = r.skip ? "⏭" : r.ok ? "✅" : "❌";
    if (r.skip) skip++; else if (r.ok) pass++; else fail++;
    rows.push({ id: "P" + n, block, what, how, mark, note: (r.note || "").replace(/\|/g, "·").replace(/\n/g, " ") });
    if (!r.ok || process.env.T26_VERBOSE) console.log(`${mark} P${n} [${block}] ${what}${r.note ? "  — " + r.note : ""}`);
    return r;
  };
  return {
    add,
    get count() { return n - firstId + 1; },
    get rows() { return rows; },
    report(label) {
      console.log(`\n${label}: ${pass} passed · ${fail} failed · ${skip} skipped · ${rows.length} checks (P${firstId}–P${n})`);
      return fail;
    },
  };
}
