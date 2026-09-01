// verify-migration-truth.mjs — DOES THE DATABASE STILL CONTAIN WHAT THE MIGRATIONS SAY IT DOES?
//
// WHY THIS EXISTS. `supabase/migrations/` is the single source of truth for BOTH databases, and a
// migration file is a promise: "after this ran, these objects exist". Nothing in this repo checked
// that promise object by object. `verify-db-grants.mjs` checks WHO may run a function;
// `verify-migration-run-alone.mjs` checks that re-running one old file cannot undo a later
// decision; `verify-db-parity.mjs` compares the two databases to each other. None of them answers
// the plainest question of all — "is the thing this file created actually still there?"
//
// It matters because the dev database is shared and hand-edited. A function can be dropped by a
// hand-run, a column renamed in the dashboard, an index dropped to save space — and every existing
// guard stays green: parity compares two databases that can both be wrong together, and the grants
// allow-list is keyed by name, so it cannot notice an absence at all. This project has already been
// bitten twice by a function that existed in the migrations and not in the database (migs 296/297).
//
// The sweep-#6 pass over migrations 001–118 (2026-08-21) ran exactly this check 120 times and
// recorded the results as permanent ledger rows P10001–P10120 — but the script it used lived in a
// throw-away worktree and was never committed, so 120 permanent checks pointed at a command that
// existed nowhere. This file is that check, made permanent, and it covers all 375 files rather
// than the 120 the sweep happened to own.
//
// WHAT IT ASSERTS, per migration file:
//   every object the file DECLARES (table, added column, function, view, trigger, index, policy)
//   is either PRESENT in the database, or REMOVED LATER in the sequence.
//
// "Removed later" is the important half, and it is positional, not numeric: later means a file
// further down the sorted list, or the same file further down its own text (migration 040 creates
// `lfh_check_verification` at line 55 and retires it at line 84). Retiring an object is normal and
// deliberate — migration 297 is literally named "undo a resurrection" — so an absence is only a
// fault when nothing in the sequence accounts for it.
//
// WHAT IT DELIBERATELY DOES NOT ASSERT:
//   · function SIGNATURES — `verify-migration-run-alone.mjs` owns the stale-overload question;
//   · function BODIES — `verify-db-parity.mjs` owns that;
//   · objects named only in dynamic SQL (`EXECUTE format('… %I …')` inside a DO block), because
//     nothing static can name them. Migration 078's loop that adds `restaurant_id` to 25 tables is
//     the case that matters: those columns are real and are covered by other files' rows.
//
// READ-ONLY. Seven SELECTs against the catalog and nothing else. Writes nothing, creates nothing,
// and is safe to run while other sessions are working.
//
//   node scripts/verify-migration-truth.mjs                       # every migration file
//   node scripts/verify-migration-truth.mjs --only 001_menu_items.sql
//   node scripts/verify-migration-truth.mjs --range 1-120          # positions in the sorted list
//   node scripts/verify-migration-truth.mjs --counts               # the per-file object tally only
//   node scripts/verify-migration-truth.mjs --quiet                # failures only
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const MIG = join(root, "supabase", "migrations");
const KINDS = ["tbl", "col", "fn", "view", "trg", "idx", "pol"];
const KIND_NAME = { tbl: "table", col: "column", fn: "function", view: "view", trg: "trigger", idx: "index", pol: "policy" };

const argv = process.argv.slice(2);
const flag = (n) => { const i = argv.indexOf(n); return i === -1 ? null : argv[i + 1]; };
const ONLY = flag("--only");
const RANGE = flag("--range");
const COUNTS = argv.includes("--counts");
const QUIET = argv.includes("--quiet");

let failed = 0;
const pass = (m) => { if (!QUIET) console.log("  ✓ " + m); };
const fail = (m) => { console.log("  ✗ " + m); failed++; };

// ── comments out, so a commented-out CREATE is not read as a promise ──────────────────────────
const strip = (sql) => sql
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
  .split("\n").map((l) => {
    let out = "", q = null;
    for (let i = 0; i < l.length; i++) {
      const c = l[i];
      if (q) { out += c; if (c === q) q = null; continue; }
      if (c === "'" || c === '"') { q = c; out += c; continue; }
      if (c === "-" && l[i + 1] === "-") { out += " ".repeat(l.length - i); break; }
      out += c;
    }
    return out;
  }).join("\n");

// ── dynamic SQL out (see the header) — blanked, not deleted, so offsets stay meaningful ───────
const noStrings = (sql) => sql.replace(/'(?:[^']|'')*'/g, (m) => " ".repeat(m.length));

const bare = (n) => (n || "").replace(/^public\./i, "").replace(/^"|"$/g, "").trim().toLowerCase();
const real = (n) => n && !n.includes("%") && !/^(if|not|exists|concurrently|unique|or|replace)$/.test(n);

// Each map is name → the offset in the file where it is named. For declarations we keep the
// FIRST offset, for removals the LAST — that is what makes "created then retired in one file" read
// correctly whichever order they appear in.
const put = (map, key, off, keepLast) => {
  if (!real(key.split(".").pop()) || key.startsWith(".") || key.endsWith(".")) return;
  if (keepLast || !map.has(key)) map.set(key, off);
};

function declares(sql) {
  const d = Object.fromEntries(KINDS.map((k) => [k, new Map()]));
  const re = (p) => new RegExp(p, "gi");
  for (const m of sql.matchAll(re(String.raw`\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([\w".]+)`)))
    put(d.tbl, bare(m[1]), m.index);
  for (const m of sql.matchAll(re(String.raw`\bALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?([\w".]+)([\s\S]*?);`))) {
    const t = bare(m[1]);
    for (const c of m[2].matchAll(re(String.raw`\bADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?([\w"]+)`)))
      put(d.col, `${t}.${bare(c[1])}`, m.index + c.index);
  }
  for (const m of sql.matchAll(re(String.raw`\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([\w".]+)\s*\(`)))
    put(d.fn, bare(m[1]), m.index);
  for (const m of sql.matchAll(re(String.raw`\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:MATERIALIZED\s+)?VIEW\s+(?:IF\s+NOT\s+EXISTS\s+)?([\w".]+)`)))
    put(d.view, bare(m[1]), m.index);
  for (const m of sql.matchAll(re(String.raw`\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:CONSTRAINT\s+)?TRIGGER\s+([\w"]+)`)))
    put(d.trg, bare(m[1]), m.index);
  for (const m of sql.matchAll(re(String.raw`\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?([\w"]+)`)))
    put(d.idx, bare(m[1]), m.index);
  for (const m of sql.matchAll(re(String.raw`\bCREATE\s+POLICY\s+("[^"]+"|[\w]+)\s+ON\s+([\w".]+)`)))
    put(d.pol, `${bare(m[2])}.${bare(m[1])}`, m.index);
  return d;
}

function removes(sql) {
  const r = Object.fromEntries(KINDS.map((k) => [k, new Map()]));
  const re = (p) => new RegExp(p, "gi");
  const list = (s) => s.split(",").map((x) => bare(x));
  for (const m of sql.matchAll(re(String.raw`\bDROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?([\w".,\s]+?)\s*(?:CASCADE|RESTRICT|;)`)))
    for (const one of list(m[1])) put(r.tbl, one, m.index, true);
  for (const m of sql.matchAll(re(String.raw`\bALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?([\w".]+)([\s\S]*?);`))) {
    const t = bare(m[1]);
    for (const c of m[2].matchAll(re(String.raw`\bDROP\s+COLUMN\s+(?:IF\s+EXISTS\s+)?([\w"]+)`)))
      put(r.col, `${t}.${bare(c[1])}`, m.index + c.index, true);
    for (const c of m[2].matchAll(re(String.raw`\bRENAME\s+COLUMN\s+([\w"]+)\s+TO\s+([\w"]+)`)))
      put(r.col, `${t}.${bare(c[1])}`, m.index + c.index, true);
    if (!/RENAME\s+COLUMN/i.test(m[2]))
      for (const c of m[2].matchAll(re(String.raw`\bRENAME\s+TO\s+([\w"]+)`)))
        put(r.tbl, t, m.index + c.index, true);
  }
  for (const m of sql.matchAll(re(String.raw`\bDROP\s+FUNCTION\s+(?:IF\s+EXISTS\s+)?([\w".]+)`)))
    put(r.fn, bare(m[1]), m.index, true);
  for (const m of sql.matchAll(re(String.raw`\bALTER\s+FUNCTION\s+(?:IF\s+EXISTS\s+)?([\w".]+)\s*\([^)]*\)\s*RENAME\s+TO`)))
    put(r.fn, bare(m[1]), m.index, true);
  for (const m of sql.matchAll(re(String.raw`\bDROP\s+(?:MATERIALIZED\s+)?VIEW\s+(?:IF\s+EXISTS\s+)?([\w".,\s]+?)\s*(?:CASCADE|RESTRICT|;)`)))
    for (const one of list(m[1])) put(r.view, one, m.index, true);
  for (const m of sql.matchAll(re(String.raw`\bDROP\s+TRIGGER\s+(?:IF\s+EXISTS\s+)?([\w"]+)`)))
    put(r.trg, bare(m[1]), m.index, true);
  for (const m of sql.matchAll(re(String.raw`\bDROP\s+INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+EXISTS\s+)?([\w".,\s]+?)\s*(?:CASCADE|RESTRICT|;)`)))
    for (const one of list(m[1])) put(r.idx, one, m.index, true);
  for (const m of sql.matchAll(re(String.raw`\bALTER\s+INDEX\s+(?:IF\s+EXISTS\s+)?([\w".]+)\s+RENAME\s+TO`)))
    put(r.idx, bare(m[1]), m.index, true);
  for (const m of sql.matchAll(re(String.raw`\bDROP\s+POLICY\s+(?:IF\s+EXISTS\s+)?("[^"]+"|[\w]+)\s+ON\s+([\w".]+)`)))
    put(r.pol, `${bare(m[2])}.${bare(m[1])}`, m.index, true);
  return r;
}

// ── the database's own answer ────────────────────────────────────────────────────────────────
const parseEnv = (t) => Object.fromEntries(t.split("\n")
  .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
  .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }));

async function live() {
  const envPath = join(root, ".env.local");
  if (!existsSync(envPath)) return null;
  const env = parseEnv(readFileSync(envPath, "utf8"));
  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_ACCESS_TOKEN) return null;
  const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
  const q = async (sql) => {
    const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: sql, read_only: true }),
    });
    if (!res.ok) throw new Error(`${ref.slice(0, 6)}…: ${(await res.text()).slice(0, 200)}`);
    return res.json();
  };
  const set = (rows, f) => new Set(rows.map(f));
  const [tbl, col, fn, vw, trg, idx, pol] = await Promise.all([
    q(`select tablename from pg_tables where schemaname='public'`),
    q(`select table_name, column_name from information_schema.columns where table_schema='public'`),
    q(`select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'`),
    q(`select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('v','m')`),
    q(`select t.tgname from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal`),
    q(`select indexname from pg_indexes where schemaname='public'`),
    q(`select tablename, policyname from pg_policies where schemaname='public'`),
  ]);
  return {
    ref,
    tbl: set(tbl, (r) => r.tablename.toLowerCase()),
    col: set(col, (r) => `${r.table_name.toLowerCase()}.${r.column_name.toLowerCase()}`),
    fn: set(fn, (r) => r.proname.toLowerCase()),
    view: set(vw, (r) => r.relname.toLowerCase()),
    trg: set(trg, (r) => r.tgname.toLowerCase()),
    idx: set(idx, (r) => r.indexname.toLowerCase()),
    pol: set(pol, (r) => `${r.tablename.toLowerCase()}.${r.policyname.toLowerCase()}`),
  };
}

// ── the sequence ─────────────────────────────────────────────────────────────────────────────
const files = readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort();
const parsed = files.map((f, i) => {
  const sql = noStrings(strip(readFileSync(join(MIG, f), "utf8")));
  return { f, pos: i, d: declares(sql), r: removes(sql) };
});

// Is `name` retired anywhere strictly after the point (file, offset) where it was declared?
const retiredAfter = (kind, name, pos, off) => parsed.some((p) => {
  if (!p.r[kind].has(name)) return false;
  return p.pos > pos || (p.pos === pos && p.r[kind].get(name) > off);
});

// Objects retired by something other than a DROP in the sequence. Every line is a written-down
// decision, not a silent allowance. Empty today, and that is the point — it should stay empty.
const RETIRED_ELSEWHERE = {};

// ── run ──────────────────────────────────────────────────────────────────────────────────────
const db = COUNTS ? null : await live();
if (!COUNTS && !db) {
  console.log("\nsupabase/migrations — every object a file declares is still there");
  console.log("  – skipped: no .env.local, so there is no database to ask");
  process.exit(0);
}

let selected = parsed;
if (ONLY) {
  const want = ONLY.endsWith(".sql") ? ONLY : ONLY + ".sql";
  selected = selected.filter((p) => p.f === want);
}
if (RANGE) {
  const [a, b] = RANGE.split("-").map(Number);
  selected = selected.filter((p) => p.pos + 1 >= a && p.pos + 1 <= b);
}
if (!selected.length) { console.log(`  ✗ nothing matched (--only ${ONLY ?? "-"} --range ${RANGE ?? "-"})`); process.exit(1); }

console.log(`\nsupabase/migrations — every object a file declares is present, or retired later in the sequence`);
console.log(`  ${COUNTS ? "counts only" : "database " + db.ref.slice(0, 6) + "…"} · ${selected.length} of ${files.length} files\n`);

let objects = 0, retired = 0;
for (const p of selected) {
  const tally = KINDS.map((k) => `${p.d[k].size}${k}`).join("/");
  const total = KINDS.reduce((n, k) => n + p.d[k].size, 0);
  if (COUNTS) { console.log(`  ${String(p.pos + 1).padStart(3)} ${p.f.padEnd(50)} ${String(total).padStart(3)} (${tally})`); objects += total; continue; }

  const missing = [];
  for (const kind of KINDS) {
    for (const [name, off] of p.d[kind]) {
      objects++;
      if (db[kind].has(name)) continue;
      if (retiredAfter(kind, name, p.pos, off) || RETIRED_ELSEWHERE[kind]?.[name]) { retired++; continue; }
      missing.push(`${KIND_NAME[kind]} ${name}`);
    }
  }
  if (missing.length) fail(`${p.f} — ${missing.length} of ${total} gone with nothing retiring them: ${missing.join(", ")}`);
  else pass(`${p.f} — all ${total} (${tally})`);
}

console.log("");
if (COUNTS) { console.log(`  ${objects} declared objects across ${selected.length} files`); process.exit(0); }
if (failed) { console.log(`✗ ${failed} migration file(s) promise something the database does not have`); process.exit(1); }
console.log(`✓ ${objects} declared objects accounted for across ${selected.length} files (${retired} deliberately retired later in the sequence)`);
