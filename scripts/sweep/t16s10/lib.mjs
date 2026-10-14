// scripts/sweep/t16s10/lib.mjs — the shared harness for sweep #10, terminal 16 (shared panel plumbing).
//
// Territory: the small public/panels/*.js scripts every staff panel loads (outbox, offline, netretry,
// realtime, connbadge, errlog, theme, fitnums, backstack, undobar, guestbell, myprofile, maint,
// issue-raise, swipehint, swreg, shrinkimg, auditsort + .d.ts, vendor/chart.umd.min.js) and the three
// deliberately-public endpoints /api/health, /api/log/client-error, /api/maintenance.
//
// Every check carries the LEDGER ID it answers for, names its SUBJECT FILE (so the per-file row count
// in S10-RULES rule 3 can see it), and returns true/false, { ok, note }, or "skip: <why>". A check
// that throws is red. Nothing here writes to the database: the browser suites answer every /api call
// themselves (route.fulfill) unless a row says it drives the live app, and those only read.
//
//   node scripts/sweep/t16s10/run.mjs [--only P19309] [--suite static] [--json out.json]
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
export const PANELS = "public/panels";
export const MY_FILES = [
  "outbox.js", "offline.js", "netretry.js", "realtime.js", "connbadge.js", "errlog.js", "theme.js",
  "fitnums.js", "backstack.js", "undobar.js", "guestbell.js", "myprofile.js", "maint.js",
  "issue-raise.js", "swipehint.js", "swreg.js", "shrinkimg.js", "auditsort.js",
];
export const ROUTES = {
  health: "app/api/health/route.ts",
  clientError: "app/api/log/client-error/route.ts",
  maintenance: "app/api/maintenance/route.ts",
  ownerSettings: "app/api/owner/settings/route.ts",
};
const cache = new Map();
/** The file's text as it is on disk today. Throws if it is missing — a check must never read nothing. */
export function src(rel) {
  const p = rel.includes("/") || !rel.endsWith(".js") ? rel : `${PANELS}/${rel}`;
  if (!cache.has(p)) {
    const abs = join(ROOT, p);
    if (!existsSync(abs)) throw new Error(`t16s10: ${p} is not in this checkout`);
    cache.set(p, readFileSync(abs, "utf8"));
  }
  return cache.get(p);
}
/** Comments removed, LINE comments first (the order that once hid 190 lines from two guards). Strings
 *  are left in place: a "//" inside a string literal is rare in these files, and is handled by the
 *  quote-aware scan below. */
export function strip(code) {
  let out = "", i = 0, q = null;
  while (i < code.length) {
    const c = code[i], n = code[i + 1];
    if (q) { out += c; if (c === "\\") { out += n || ""; i += 2; continue; } if (c === q) q = null; i++; continue; }
    if (c === '"' || c === "'" || c === "`") { q = c; out += c; i++; continue; }
    if (c === "/" && n === "/") { while (i < code.length && code[i] !== "\n") i++; continue; }
    if (c === "/" && n === "*") { const e = code.indexOf("*/", i + 2); i = e < 0 ? code.length : e + 2; continue; }
    out += c; i++;
  }
  return out;
}
export const code = (rel) => strip(src(rel));
export const count = (t, re) => (t.match(new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g")) || []).length;
/** The body of the first function whose header starts with `head`, by brace matching on stripped code. */
export function fnBody(text, head) {
  const i = text.indexOf(head);
  if (i < 0) return "";
  // Skip the parameter list first (it may hold a destructuring brace), then take the next "{".
  let open = text.indexOf("{", i);
  const p0 = text.indexOf("(", i + head.length - 1);
  if (p0 >= 0 && p0 < open + 1) {
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
export const lineOf = (text, idx) => text.slice(0, idx).split("\n").length;
export function git(...args) { return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }); }
export function originMain(rel) { try { return git("show", `origin/main:${rel}`); } catch { return null; } }
export function npmRun(script, args = []) {
  try { return { ok: true, out: execFileSync("npm", ["run", "-s", script, "--", ...args], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 }) }; }
  catch (e) { return { ok: false, out: String(e.stdout || "") + String(e.stderr || "") }; }
}

// ── the registry ─────────────────────────────────────────────────────────────────────────────
const defs = [];
/** R(id, file, what, fn, how?) — `file` is the subject (a path or a bare panels file name). */
export function R(id, file, what, fn, how) { defs.push({ id, file, what, fn, how }); }
export const all = () => defs;

export const ok = (cond, note) => ({ ok: !!cond, note: note == null ? "" : String(note) });
export function eq(a, b, what = "") {
  const A = JSON.stringify(a), B = JSON.stringify(b);
  if (A !== B) throw new Error(`${what ? what + ": " : ""}got ${A.slice(0, 160)} expected ${B.slice(0, 160)}`);
  return true;
}
export function assert(c, msg = "assertion failed") { if (!c) throw new Error(msg); return true; }

export async function runAll({ only = null, suites = null, quiet = false } = {}) {
  const seen = new Set();
  for (const d of defs) { if (seen.has(d.id)) throw new Error(`t16s10: duplicate id ${d.id}`); seen.add(d.id); }
  const rows = [];
  for (const d of defs) {
    if (only && !only.has(d.id)) continue;
    if (suites && !suites.has(d.suite)) continue;
    let res, note = "";
    const t0 = Date.now();
    try { res = await d.fn(); } catch (e) { res = false; note = `threw: ${(e && e.message) || e}`.slice(0, 220); }
    let mark;
    if (typeof res === "string" && res.startsWith("skip:")) { mark = "⏭"; note = res.slice(5).trim(); }
    else if (res && typeof res === "object" && "ok" in res) { mark = res.ok ? "✅" : "❌"; note = res.note || note; }
    else if (typeof res === "string") { mark = "✅"; note = res; }
    else mark = res === false ? "❌" : "✅";
    rows.push({ id: d.id, file: d.file, what: d.what, how: d.how || "", mark, note: String(note).replace(/\s+/g, " ").slice(0, 300), ms: Date.now() - t0 });
    if (!quiet && mark !== "✅") console.log(`  ${mark} ${d.id}  ${d.what}${note ? ` — ${note}` : ""}`);
  }
  return rows;
}
export function tag(suite) { const start = defs.length; return () => { for (let i = start; i < defs.length; i++) defs[i].suite = defs[i].suite || suite; }; }
