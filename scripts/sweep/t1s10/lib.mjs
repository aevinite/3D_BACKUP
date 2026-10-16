// scripts/sweep/t1s10/lib.mjs — the shared harness for sweep #10, terminal 1: THE GUEST MENU AND ITS THREE DOORS.
//
// Territory: /menu, /r/<slug>/menu, /q/<code>, the home and not-found pages, the error boundaries, the root
// layout, the middleware, MenuView and every component it draws (FoodCard, Header, NavPicker, HeroTitle,
// IntroSplash, GuestChrome, GuestNotFound, ComingSoon, Maintenance, CustomerGreeter, InfinityLoader,
// Particles, VegIcon) and the libraries under them (lib/menu, lib/menuDataServer, lib/tenant, lib/accent,
// lib/allergens, lib/brandText, lib/brandTheme, lib/restaurantColor, lib/searchText, lib/starterMenu).
//
// Every check carries the LEDGER ID it answers for and names its SUBJECT FILE, and returns true/false,
// { ok, note }, or "skip: <why>". A check that throws is red. Nothing in this harness writes to the
// database unless the row says so, and every such row puts back what it changed in a `finally`.
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const require = createRequire(import.meta.url);
const ts = require(join(ROOT, "node_modules/typescript"));

const cache = new Map();
/** The file's text as it is on disk today. Throws if it is missing — a check must never read nothing. */
export function src(rel) {
  if (!cache.has(rel)) {
    const abs = join(ROOT, rel);
    if (!existsSync(abs)) throw new Error(`t1s10: ${rel} is not in this checkout`);
    cache.set(rel, readFileSync(abs, "utf8"));
  }
  return cache.get(rel);
}

/** Comments removed using the TypeScript PARSER — every token's leading/trailing comment ranges are found on the
 *  real syntax tree, so a regex literal like /^\/r\/([^/]+)\// or a "//" inside a string or JSX text can never be
 *  mistaken for a comment (a hand-rolled stripper got exactly that wrong in sweep #8). Comments are replaced by
 *  nothing; line structure is kept by leaving their newlines. */
const stripCache = new Map();
export function strip(text, jsx = true) {
  const key = (jsx ? "x" : "s") + text;
  if (stripCache.has(key)) return stripCache.get(key);
  const sf = ts.createSourceFile(jsx ? "f.tsx" : "f.ts", text, ts.ScriptTarget.Latest, true, jsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const ranges = new Map();
  const visit = (n) => {
    if (n.kind !== ts.SyntaxKind.JsxText) {
      for (const r of ts.getLeadingCommentRanges(text, n.pos) || []) ranges.set(r.pos, r.end);
      for (const r of ts.getTrailingCommentRanges(text, n.end) || []) ranges.set(r.pos, r.end);
    }
    for (const c of n.getChildren(sf)) visit(c);
  };
  visit(sf);
  for (const r of ts.getLeadingCommentRanges(text, sf.endOfFileToken.pos) || []) ranges.set(r.pos, r.end);
  const sorted = [...ranges.entries()].sort((x, y) => x[0] - y[0]);
  let out = "", at = 0;
  for (const [s0, e0] of sorted) {
    if (s0 < at) continue;
    out += text.slice(at, s0) + text.slice(s0, e0).replace(/[^\n]/g, "");
    at = e0;
  }
  out += text.slice(at);
  stripCache.set(key, out);
  return out;
}
/** JSX files: comments inside {/* … *\/} braces are JSX expression comments and are stripped too. A crude
 *  but sufficient rule for this code base: the scanner sees them as MultiLineCommentTrivia already. */
export const code = (rel) => strip(src(rel), /\.tsx$/.test(rel));
export const count = (t, re) => (t.match(new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g")) || []).length;

/** The body of the first function/arrow whose header starts with `head`, by brace matching. */
export function fnBody(text, head) {
  const i = text.indexOf(head);
  if (i < 0) return "";
  let open = text.indexOf("{", i + head.length);
  const p0 = text.indexOf("(", i + head.length - 1);
  if (p0 >= 0 && p0 < open) {
    let d = 0, j = p0;
    for (; j < text.length; j++) { if (text[j] === "(") d++; else if (text[j] === ")") { d--; if (d === 0) break; } }
    open = text.indexOf("{", j);
  }
  let d = 0;
  for (let j = open; j < text.length; j++) {
    if (text[j] === "{") d++;
    else if (text[j] === "}") { d--; if (d === 0) return text.slice(i, j + 1); }
  }
  return text.slice(i);
}

export class Fail extends Error {}
export const assert = (c, msg) => { if (!c) throw new Fail(msg || "assertion failed"); };
export const ok = (c, note = "") => ({ ok: !!c, note });

// ── the registry ──────────────────────────────────────────────────────────────────────────────────────────
export const ROWS = [];
/** R(id, subjectFile, title, fn, how?) — `how` names the method in the ledger row. */
export function R(id, file, title, fn, how) { ROWS.push({ id, file, title, fn, how }); }

// ── the DEV database — refuses to start unless .env.local points at the dev project ─────────────────────────
let ENV = null;
export function env() {
  if (ENV) return ENV;
  ENV = Object.fromEntries(readFileSync(join(ROOT, ".env.local"), "utf8").split("\n")
    .map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\n]*)"?\s*$/)).filter(Boolean).map((m) => [m[1], m[2]]));
  const ref = (ENV.NEXT_PUBLIC_SUPABASE_URL.match(/https?:\/\/([a-z0-9]+)\.supabase\.co/) || [])[1];
  if (ref !== "wnsfcizclkbobwzcxqsf") { console.error("t1s10: .env.local is not the dev project — refusing to run"); process.exit(2); }
  ENV.REF = ref;
  return ENV;
}
const pause = (k) => new Promise((s) => setTimeout(s, Math.min(30_000, 2000 * 2 ** k)));
/** One read-only (unless the row says otherwise) SQL statement through the Management API, dev project only. */
export async function sql(query) {
  const e = env();
  for (let k = 0; k < 8; k++) {
    const r = await fetch(`https://api.supabase.com/v1/projects/${e.REF}/database/query`, { method: "POST", headers: { Authorization: `Bearer ${e.SUPABASE_ACCESS_TOKEN}`, "content-type": "application/json" }, body: JSON.stringify({ query }) });
    const t = await r.text();
    if (r.status === 429 || r.status >= 500) { await pause(k); continue; }
    if (!r.ok) throw new Error(`sql ${r.status}: ${t.slice(0, 300)}`);
    return JSON.parse(t);
  }
  throw new Error("sql: the database did not answer after 8 tries");
}
/** PostgREST with the PUBLIC key — exactly what a diner's phone holds. */
export async function anon(path, { method = "GET", body } = {}) {
  const e = env();
  const r = await fetch(`${e.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${path}`, { method, headers: { apikey: e.NEXT_PUBLIC_SUPABASE_ANON_KEY, Authorization: `Bearer ${e.NEXT_PUBLIC_SUPABASE_ANON_KEY}`, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { /* not json */ }
  return { status: r.status, json: j, text: t };
}

export const BASE = process.env.T1_BASE || "http://localhost:4401";
export const FH = "00000000-0000-0000-0000-000000000001";

/** Import the REAL TypeScript file (bundled by esbuild, `@/` resolved to the repo root) so a check runs the
 *  function as shipped, never a re-typed copy. Modules that need a database or Next are not loaded this way. */
const tsMods = new Map();
export async function importTs(rel) {
  if (tsMods.has(rel)) return tsMods.get(rel);
  const esbuild = require(join(ROOT, "node_modules/esbuild"));
  const out = await esbuild.build({ entryPoints: [join(ROOT, rel)], bundle: true, format: "esm", platform: "node", write: false, logLevel: "silent",
    alias: { "@": ROOT }, external: ["next", "next/*", "react", "@supabase/*"] });
  const url = "data:text/javascript;base64," + Buffer.from(out.outputFiles[0].text).toString("base64");
  const m = await import(url);
  tsMods.set(rel, m);
  return m;
}

/** The old ledger rows for an id range, read from this checkout's own T1.md — so a re-run row can carry the
 *  exact wording it is re-asking (the generated families of earlier sweeps are re-run from their own text). */
let ledgerRows = null;
export function oldRows(from, to, ledger = "T1.md") {
  if (!ledgerRows) {
    ledgerRows = [];
    for (const line of readFileSync(join(ROOT, ".claude/sweep/LEDGER", ledger), "utf8").split("\n")) {
      const m = line.match(/^\| (P\d+) \| (.*?) \| (.*?) \| (✅|❌|⏭)/);
      if (m) ledgerRows.push({ id: m[1], check: m[2], how: m[3] });
    }
  }
  const n = (id) => Number(id.slice(1));
  return ledgerRows.filter((r) => n(r.id) >= n(from) && n(r.id) <= n(to));
}
