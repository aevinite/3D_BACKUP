// scripts/sweep/t14s10/lib.mjs — sweep #10 · terminal 14 · the bill and KOT document.
//
// The registry every T14 bank writes into, and the one runner that executes them.
//
// EVERY ROW HAS A PERMANENT ID WRITTEN AS A LITERAL in the bank that declares it — `sec(183000)`
// then `c(1, …)` is P183001 for ever. Nothing is numbered by position, so deleting or adding a check
// can never move another row's id (sweep #8 T11's new-J.mjs refused to load the day one of its rows
// was removed, because it counted them).
//
//   node --experimental-strip-types --no-warnings scripts/sweep/t14s10/run.mjs
//     [--only P183001] [--from P183400] [--quiet] [--ledger] [--no-db]
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { registerHooks } from "node:module";

export const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
export const read = (p) => { try { return readFileSync(join(root, p), "utf8"); } catch { return ""; } };
export const exists = (p) => existsSync(join(root, p));

// `@/…` resolves the way Next does, so lib/*.ts runs as the server runs it.
registerHooks({ resolve(spec, ctx, next) {
  if (spec.startsWith("@/")) {
    let p = join(root, spec.slice(2));
    if (!existsSync(p)) for (const ext of [".ts", ".tsx", ".js", ".mjs"]) if (existsSync(p + ext)) { p += ext; break; }
    return next(pathToFileURL(p).href, ctx);
  }
  return next(spec, ctx);
} });
export const imp = (p) => import(pathToFileURL(join(root, p)).href);

export const ARGV = process.argv.slice(2);
const argOf = (k) => { const i = ARGV.indexOf(k); return i >= 0 && ARGV[i + 1] ? ARGV[i + 1] : null; };

const ROWS = [];
const SEEN = new Set();
/** sec(183000) → c(1, file, what, method, fn) declares P183001. fn returns true, or a string saying
 *  what was found instead, or { skip: "why" }. A throw is a failure carrying its message. */
export function sec(base) {
  return (n, file, what, method, fn) => {
    const id = "P" + String(base + n);
    if (SEEN.has(id)) throw new Error(`${id} declared twice`);
    SEEN.add(id);
    ROWS.push({ id, file, what, method, fn });
  };
}
/** The re-run rows keep the id they were born with. */
export function rerun(id, file, what, method, fn) {
  if (SEEN.has(id)) throw new Error(`${id} declared twice`);
  SEEN.add(id);
  ROWS.push({ id, file, what, method, fn, old: true });
}

const DONE = [];
/** Work to run once every picked row has run (closing a browser). */
export const onDone = (fn) => DONE.push(fn);

const pipe = (s) => String(s).replace(/\|/g, "\\|").replace(/\n/g, " ");

export async function runAll(label) {
  const only = argOf("--only"), from = argOf("--from");
  let picked = ROWS;
  if (only) picked = ROWS.filter((r) => r.id === only);
  else if (from) picked = ROWS.filter((r) => Number(r.id.slice(1)) >= Number(from.slice(1)));
  if (!picked.length) {
    console.log(`\n${label}: NOTHING RAN — ${only || from || "(no filter)"} matched 0 of ${ROWS.length} rows.`);
    process.exitCode = 1;
    return [];
  }
  const out = [];
  for (const r of picked) {
    let res, note = "";
    try {
      const v = await r.fn();
      if (v === true) res = "✅";
      else if (v && typeof v === "object" && v.skip) { res = "⏭"; note = v.skip; }
      else if (v && typeof v === "object" && v.ok === true) { res = "✅"; note = v.note || ""; }
      else { res = "❌"; note = typeof v === "string" ? v : JSON.stringify(v); }
    } catch (e) { res = "❌"; note = "threw: " + (e && e.message || e); }
    out.push({ ...r, res, note });
  }
  for (const fn of DONE) { try { await fn(); } catch { /* closing is best-effort */ } }
  const n = (k) => out.filter((r) => r.res === k).length;
  if (ARGV.includes("--ledger")) {
    for (const r of out) console.log(`| ${r.id} | \`${r.file}\` — ${pipe(r.what)} | ${pipe(r.method)} | ${r.res} | ${pipe(r.note || "")} |`);
  } else {
    for (const r of out) if (!ARGV.includes("--quiet") || r.res !== "✅") console.log(`  ${r.res} ${r.id}  [${r.file}] ${r.what}${r.note ? "  — " + r.note : ""}`);
    console.log("─".repeat(78));
    console.log(`${label}: ${out.length} rows · ${n("✅")} passed · ${n("❌")} failed · ${n("⏭")} skipped`);
  }
  if (n("❌")) process.exitCode = 1;
  return out;
}

// ── read-only SQL on the DEV database (the same door scripts/sweep/t30s10/parity.mjs uses) ─────────
const env = Object.fromEntries(read(".env.local").split(/\r?\n/)
  .map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i)).filter(Boolean)
  .map((m) => [m[1], m[2].replace(/^["']|["']$/g, "")]));
export const NO_DB = ARGV.includes("--no-db");
let ref = null;
export async function sql(q) {
  if (NO_DB) throw new Error("--no-db");
  if (!/^\s*(select|with)\b/i.test(q)) throw new Error("read-only: SELECT/WITH only");
  if (!ref) {
    const { refuseUnlessDevTestDb } = await imp("scripts/sweep/devStacks.mjs");
    refuseUnlessDevTestDb(env.NEXT_PUBLIC_SUPABASE_URL, "sweep #10 T14 (read-only)");
    ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
  }
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: q }),
    });
    const t = await r.text();
    if (r.ok) return JSON.parse(t);
    // The management API allows a fixed number of queries a minute; a 429 is its own budget, not a
    // fault in the code under test — wait it out (up to ~2 minutes) instead of filing a red row.
    if (attempt < 7 && (r.status === 429 || r.status >= 500)) { await new Promise((ok) => setTimeout(ok, Math.min(30000, 2000 * 2 ** attempt))); continue; }
    throw new Error(`SQL ${r.status}: ${t.slice(0, 200)}`);
  }
}
export const lit = (s) => "'" + String(s).replace(/'/g, "''") + "'";

/** A block of code: from the line matching `start` up to (not including) the next top-level
 *  `function`/`export` declaration — enough to read one function's body without a parser. */
export function block(src, start) {
  const i = src.search(start);
  if (i < 0) return "";
  const rest = src.slice(i + 1);
  const j = rest.search(/\n(?:export (?:async )?function|export const|async function|function) /);
  return src.slice(i, j < 0 ? undefined : i + 1 + j);
}
/** Strip comments so a word inside a comment cannot make a code check pass. */
// LINE comments first, then block: a `/*` inside a `//` line would otherwise open a block comment that
// swallows real code up to the next `*/` (the trap verify:kitchen P99916 guards in scripts/).
export const code = (s) => s.replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1").replace(/\/\*[\s\S]*?\*\//g, "");
