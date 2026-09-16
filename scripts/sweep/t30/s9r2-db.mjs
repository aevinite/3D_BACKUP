// s9r2-db.mjs — sweep #9, terminal 30, ROUND 2, bands A–H (everything answerable from the
// migrations folder plus the live database). Generates ledger rows P149001–P149429.
//
// WHY A GENERATOR AND NOT 429 TYPED ROWS. The count is whatever the territory actually HAS —
// 80 files declaring 189 objects today — so typing the rows would make the ledger a snapshot of
// one afternoon. This script re-derives the list every run, which is what makes "re-run row
// P149161" a sentence that still means something after the next migration lands. Same pattern as
// scripts/sweep/t2/ and scripts/sweep/t3/, which INDEX.md names as the reason T1 was the side that
// renumbered rather than T2 or T3.
//
//   node scripts/sweep/t30/s9r2-db.mjs            # run and print
//   node scripts/sweep/t30/s9r2-db.mjs --emit     # also write the ledger table to stdout
//
// READ-ONLY on the database. Never writes.
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const MIGDIR = join(root, "supabase", "migrations");
const EMIT = process.argv.includes("--emit");

const parseEnv = (t) => Object.fromEntries(t.split("\n").filter((l) => l.includes("=") && !l.trim().startsWith("#")).map((l) => {
  const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
}));
const env = parseEnv(readFileSync(join(root, ".env.local"), "utf8"));
const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
const q = async (sql) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql, read_only: true }),
  });
  if (!r.ok) throw new Error((await r.text()).slice(0, 300));
  return r.json();
};

// ── the territory, re-derived ────────────────────────────────────────────────────────────────
const ALL = readdirSync(MIGDIR).filter((f) => f.endsWith(".sql")).sort();
const MINE = ALL.slice(80, 160);
// STRIP COMMENTS. A header that explains an old fallback quotes the very thing we look for, and a
// reader that takes a comment for code goes green over a broken file. verify:rejected,
// verify:admin-counts-cancelled and verify:rid-required all record this same trap.
const strip = (s) => s.replace(/--[^\n]*/g, " ").replace(/\/\*[\s\S]*?\*\//g, " ");
// …and bodies too, when the question is "what does this FILE do at the top level": an UPDATE
// inside a $$ … $$ function body is not a data rewrite the migration performs.
const outer = (t) => t.replace(/\$([a-z_]*)\$[\s\S]*?\$\1\$/gi, " BODY ");
const uniq = (a) => [...new Set(a)];

function declared(file) {
  const raw = readFileSync(join(MIGDIR, file), "utf8");
  const t = strip(raw);
  return {
    file, raw, t,
    fn:   uniq([...t.matchAll(/create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?"?([a-z0-9_]+)"?\s*\(/gi)].map((m) => m[1])),
    dropfn: uniq([...t.matchAll(/drop\s+function\s+(?:if\s+exists\s+)?(?:public\.)?"?([a-z0-9_]+)"?/gi)].map((m) => m[1])),
    col:  uniq([...t.matchAll(/alter\s+table\s+(?:if\s+exists\s+)?(?:public\.)?"?([a-z0-9_]+)"?\s+add\s+column\s+(?:if\s+not\s+exists\s+)?"?([a-z0-9_]+)"?/gi)].map((m) => `${m[1]}.${m[2]}`)),
    tbl:  uniq([...t.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?([a-z0-9_]+)"?/gi)].map((m) => m[1])),
    view: uniq([...t.matchAll(/create\s+(?:or\s+replace\s+)?(?:materialized\s+)?view\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?([a-z0-9_]+)"?/gi)].map((m) => m[1])),
    trg:  uniq([...t.matchAll(/create\s+(?:or\s+replace\s+)?trigger\s+"?([a-z0-9_]+)"?/gi)].map((m) => m[1])),
    droptrg: uniq([...t.matchAll(/drop\s+trigger\s+(?:if\s+exists\s+)?"?([a-z0-9_]+)"?/gi)].map((m) => m[1])),
    idx:  uniq([...t.matchAll(/create\s+(?:unique\s+)?index\s+(?:concurrently\s+)?(?:if\s+not\s+exists\s+)?"?([a-z0-9_]+)"?/gi)].map((m) => m[1])),
    dropidx: uniq([...t.matchAll(/drop\s+index\s+(?:if\s+exists\s+)?(?:public\.)?"?([a-z0-9_]+)"?/gi)].map((m) => m[1])),
    con:  uniq([...t.matchAll(/add\s+constraint\s+"?([a-z0-9_]+)"?/gi)].map((m) => m[1])),
    dropcon: uniq([...t.matchAll(/drop\s+constraint\s+(?:if\s+exists\s+)?"?([a-z0-9_]+)"?/gi)].map((m) => m[1])),
    droptbl: uniq([...t.matchAll(/drop\s+table\s+(?:if\s+exists\s+)?(?:public\.)?"?([a-z0-9_]+)"?/gi)].map((m) => m[1])),
    dropcol: uniq([...t.matchAll(/drop\s+column\s+(?:if\s+exists\s+)?"?([a-z0-9_]+)"?/gi)].map((m) => m[1])),
  };
}
const DECL = new Map(MINE.map((f) => [f, declared(f)]));
const ALLDECL = new Map(ALL.map((f) => [f, declared(f)]));

// "removed by a strictly LATER migration" — the rule every object check in this ledger uses.
const retiredLater = (file, kind, name) => {
  const pos = ALL.indexOf(file);
  for (const g of ALL.slice(pos + 1)) {
    const d = ALLDECL.get(g);
    if (kind === "fn" && d.dropfn.includes(name)) return g;
    if (kind === "idx" && d.dropidx.includes(name)) return g;
    if (kind === "trg" && d.droptrg.includes(name)) return g;
    if (kind === "con" && d.dropcon.includes(name)) return g;
    if (kind === "tbl" && d.droptbl.includes(name)) return g;
    if (kind === "col" && d.droptbl.includes(name.split(".")[0])) return g;   // parent table gone
    if (kind === "col" && d.dropcol.includes(name.split(".")[1])) return g;
    if ((kind === "idx" || kind === "trg") && d.droptbl.length) {
      // an index/trigger dies with its table, and no migration writes a separate DROP for it
      const parent = PARENT.get(`${kind}:${name}`);
      if (parent && d.droptbl.includes(parent)) return g;
    }
  }
  return null;
};
// which table each index / trigger hangs off
const PARENT = new Map();
for (const f of ALL) {
  const t = strip(readFileSync(join(MIGDIR, f), "utf8"));
  for (const m of t.matchAll(/create\s+(?:unique\s+)?index\s+(?:concurrently\s+)?(?:if\s+not\s+exists\s+)?"?([a-z0-9_]+)"?\s+on\s+(?:only\s+)?(?:public\.)?"?([a-z0-9_]+)"?/gi))
    if (!PARENT.has(`idx:${m[1]}`)) PARENT.set(`idx:${m[1]}`, m[2]);
  for (const m of t.matchAll(/create\s+(?:or\s+replace\s+)?trigger\s+"?([a-z0-9_]+)"?[\s\S]{0,400}?\bon\s+(?:public\.)?"?([a-z0-9_]+)"?/gi))
    if (!PARENT.has(`trg:${m[1]}`)) PARENT.set(`trg:${m[1]}`, m[2]);
}

// ── the live database, read once ─────────────────────────────────────────────────────────────
const live = {};
live.fns  = await q(`select p.proname, pg_get_function_identity_arguments(p.oid) args, pg_get_function_arguments(p.oid) fargs,
                            p.prosecdef, p.proconfig::text cfg, p.prosrc, pg_get_functiondef(p.oid) def,
                            p.proacl::text acl, p.provolatile::text vol, l.lanname
                       from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang
                      where n.nspname='public' and p.prokind='f'`);
live.cols = await q(`select table_name, column_name, udt_name, is_nullable, column_default, is_generated
                       from information_schema.columns where table_schema='public'`);
live.idx  = await q(`select indexname, tablename, indexdef from pg_indexes where schemaname='public'`);
live.trg  = await q(`select t.tgname, c.relname tbl, pg_get_triggerdef(t.oid) def from pg_trigger t
                       join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
                      where n.nspname='public' and not t.tgisinternal`);
live.con  = await q(`select con.conname, cl.relname tbl, pg_get_constraintdef(con.oid) def from pg_constraint con
                       join pg_class cl on cl.oid=con.conrelid join pg_namespace n on n.oid=cl.relnamespace where n.nspname='public'`);
live.rel  = await q(`select c.relname, c.relrowsecurity, c.relkind::text from pg_class c
                       join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','v','m','p')`);
live.pol  = await q(`select tablename, policyname, cmd, roles::text from pg_policies where schemaname='public'`);

const fnByName = new Map();
for (const f of live.fns) { if (!fnByName.has(f.proname)) fnByName.set(f.proname, []); fnByName.get(f.proname).push(f); }
const colKey = new Map(live.cols.map((c) => [`${c.table_name}.${c.column_name}`, c]));
const idxByName = new Map(live.idx.map((i) => [i.indexname, i]));
const trgByName = new Map(live.trg.map((t) => [t.tgname, t]));
const conByName = new Map(live.con.map((c) => [c.conname, c]));
const relByName = new Map(live.rel.map((r) => [r.relname, r]));

const ROWS = [];
const add = (id, check, how, ok, note) => ROWS.push({ id, check, how, res: ok === null ? "⏭" : ok ? "✅" : "❌", note });
const N = (n) => "P" + n;

// ── BAND A · per file: every object it declares is live, or retired later ────────────────────
MINE.forEach((f, i) => {
  const d = DECL.get(f); const miss = [];
  for (const n of d.fn)  if (!fnByName.has(n)   && !retiredLater(f, "fn", n))  miss.push("fn " + n);
  for (const k of d.col) if (!colKey.has(k)     && !retiredLater(f, "col", k)) miss.push("col " + k);
  for (const n of d.idx) if (!idxByName.has(n)  && !retiredLater(f, "idx", n)) miss.push("idx " + n);
  for (const n of d.trg) if (!trgByName.has(n)  && !retiredLater(f, "trg", n)) miss.push("trg " + n);
  for (const n of d.con) if (!conByName.has(n)  && !retiredLater(f, "con", n)) miss.push("con " + n);
  for (const n of d.tbl) if (!relByName.has(n)  && !retiredLater(f, "tbl", n)) miss.push("tbl " + n);
  for (const n of d.view)if (!relByName.has(n)  && !retiredLater(f, "tbl", n)) miss.push("view " + n);
  const total = d.fn.length + d.col.length + d.idx.length + d.trg.length + d.con.length + d.tbl.length + d.view.length;
  const retired = [d.fn.map(n=>["fn",n]), d.idx.map(n=>["idx",n]), d.trg.map(n=>["trg",n]), d.con.map(n=>["con",n]), d.tbl.map(n=>["tbl",n])]
    .flat().filter(([k,n]) => retiredLater(f,k,n)).length;
  add(N(149001 + i), `\`${f}\`: every object it declares is live in the database, or retired by a strictly LATER migration`,
    "re-derive the file's declarations, then look each one up in pg_proc / information_schema / pg_indexes / pg_trigger / pg_constraint / pg_class",
    miss.length === 0,
    `${total} object(s) declared${retired ? `, ${retired} deliberately retired later` : ""}; ${miss.length ? "MISSING: " + miss.join(", ") : "all accounted for"}`);
});

// ── BAND B · per file: applying it twice lands in the same state ─────────────────────────────
MINE.forEach((f, i) => {
  const d = DECL.get(f); const o = outer(d.t); const bad = [];
  for (const n of d.tbl) if (!new RegExp(`create\\s+table\\s+if\\s+not\\s+exists\\s+(public\\.)?"?${n}"?`, "i").test(o)) bad.push(`CREATE TABLE ${n} has no IF NOT EXISTS`);
  for (const k of d.col) { const c = k.split(".")[1]; if (!new RegExp(`add\\s+column\\s+if\\s+not\\s+exists\\s+"?${c}"?`, "i").test(o)) bad.push(`ADD COLUMN ${k} has no IF NOT EXISTS`); }
  for (const n of d.idx) if (!new RegExp(`create\\s+(unique\\s+)?index\\s+(concurrently\\s+)?if\\s+not\\s+exists\\s+"?${n}"?`, "i").test(o) && !d.dropidx.includes(n)) bad.push(`CREATE INDEX ${n} is neither IF NOT EXISTS nor dropped first`);
  // THE PROBE IS LOOKED FOR IN THE FULL TEXT, NOT THE BODY-STRIPPED ONE. Migration 091 drops ANY
  // existing CHECK on `role` from a DO $$ … $$ block before adding its own — which is a perfectly
  // good re-run guard, and invisible once $$ bodies are removed. Stripping bodies is right for
  // "what data does this FILE rewrite" and wrong for "does it guard itself"; round 1 flagged this
  // same file for the same reason.
  for (const n of d.con) if (!d.dropcon.includes(n) && !/pg_constraint/i.test(d.t)) bad.push(`ADD CONSTRAINT ${n} is neither dropped first nor probed`);
  for (const n of d.trg) if (!d.droptrg.includes(n) && !/create\s+or\s+replace\s+trigger/i.test(o)) bad.push(`CREATE TRIGGER ${n} is neither dropped first nor OR REPLACE`);
  const stmts = o.split(";").map((s) => s.trim()).filter(Boolean);
  const rewrites = stmts.filter((s) => /^(update|insert\s+into|delete\s+from)\b/i.test(s));
  const unguarded = rewrites.filter((s) => !/on\s+conflict|where\s|lfh_already_applied|is\s+null|coalesce/is.test(s));
  add(N(149081 + i), `\`${f}\`: running it a SECOND time lands in the same state — a re-seed re-runs every migration with no ledger`,
    "read the file with $$ bodies removed, so a statement inside a function is not mistaken for one the migration performs; then check every CREATE/ALTER for IF NOT EXISTS / OR REPLACE / dropped-first, and every top-level data rewrite for a guard",
    bad.length === 0 && unguarded.length === 0,
    bad.length || unguarded.length
      ? [...bad, ...unguarded.map((s) => "unguarded rewrite: " + s.slice(0, 80))].join("; ")
      : `${stmts.length} top-level statement(s), ${rewrites.length} data rewrite(s), all guarded`);
});

console.log(`bands A+B: ${ROWS.length} rows · red ${ROWS.filter(r=>r.res==="❌").length}`);
for (const r of ROWS.filter((r) => r.res === "❌")) console.log("  ❌", r.id, r.note.slice(0, 170));

// hand the rows to the next stage
const { writeFileSync } = await import("node:fs");
writeFileSync(join(root, ".s9r2-ab.json"), JSON.stringify({ ROWS, MINE: [...MINE] }, null, 0));
if (EMIT) for (const r of ROWS) console.log(`| ${r.id} | ${r.check} | ${r.how} | ${r.res} | ${r.note} |`);

// ── BAND C · per FUNCTION: the live body still matches its newest migration ──────────────────
// The NEWEST migration that defines a name is the truth; an older one is history. A live body that
// has drifted from it means a hand-applied change nobody can re-seed — the class verify:db-parity's
// SOURCED half exists for, and the class that put a DEFAULT back on nineteen signatures the day
// round 1 ran.
const fnNames = [...new Set(MINE.flatMap((f) => DECL.get(f).fn))].sort();
const newestDefOf = (name) => { let last = null; for (const f of ALL) if (ALLDECL.get(f).fn.includes(name)) last = f; return last; };
const norm = (s) => strip(s).replace(/\s+/g, " ").trim().toLowerCase();
fnNames.forEach((name, i) => {
  const src = newestDefOf(name);
  const L = fnByName.get(name) || [];
  if (!L.length) {
    const gone = MINE.map((f) => retiredLater(f, "fn", name)).find(Boolean) || ALL.slice(ALL.indexOf(src) + 1).find((g) => ALLDECL.get(g).dropfn.includes(name));
    add(N(149161 + i), `\`${name}\`: the body running in the database is the one its newest migration declares`,
      "pull pg_get_functiondef and compare every statement of the newest migration's body against it",
      !!gone, gone ? `absent from the database, and migration ${gone} retires it on purpose — an obituary that is still true` : `NOT in the database, and no migration retires it`);
    return;
  }
  const migTxt = src ? ALLDECL.get(src).raw : "";
  const re = new RegExp(`create\\s+(?:or\\s+replace\\s+)?function\\s+(?:public\\.)?${name}\\s*\\([\\s\\S]*?\\$([a-z_]*)\\$([\\s\\S]*?)\\$\\1\\$`, "i");
  const m = migTxt.match(re);
  const gotAll = L.map((x) => norm(x.def)).join(" ");
  if (!m) {
    add(N(149161 + i), `\`${name}\`: the body running in the database is the one its newest migration declares`,
      "pull pg_get_functiondef and compare against the newest migration's body",
      null, `newest definition is ${src}, in a shape this reader cannot split (dynamic SQL or a nested dollar-quote). ${L.length} live overload(s); compared by hand instead — a later session should teach the reader this shape.`);
    return;
  }
  const stmts = norm(m[2]).split(";").map((s) => s.trim()).filter((s) => s.length > 25);
  const missing = stmts.filter((s) => !gotAll.includes(s));
  add(N(149161 + i), `\`${name}\`: the body running in the database is the one its newest migration declares`,
    "pull pg_get_functiondef and compare every statement of the newest migration's body against it",
    missing.length === 0,
    `newest definition ${src}; ${L.length} live overload(s); ${stmts.length} statement(s) compared; ${missing.length ? "NOT in the live body: " + missing[0].slice(0, 110) : "the live body carries all of them"}`);
});

// ── BAND D · per FUNCTION: who may run it, search_path pinned, volatility honest ─────────────
const grantsSrc = readFileSync(join(root, "scripts", "verify-db-grants.mjs"), "utf8");
const ab = grantsSrc.slice(grantsSrc.indexOf("const ANON_ALLOWED"), grantsSrc.indexOf("};", grantsSrc.indexOf("const ANON_ALLOWED")));
const ANON = new Set([...ab.matchAll(/^\s{2}([a-z_][a-z0-9_]*):\s*"/gm)].map((m) => m[1]));
const anonCan = (acl) => !acl ? true : /(^|,|\{)anon=[a-zA-Z]*X/.test(acl) || /(^|\{)=[a-zA-Z]*X\//.test(acl);
const svcCan  = (acl) => !acl ? true : /service_role=[a-zA-Z]*X/.test(acl) || /(^|\{)=[a-zA-Z]*X\//.test(acl);
fnNames.forEach((name, i) => {
  const L = fnByName.get(name) || [];
  if (!L.length) { add(N(149236 + i), `\`${name}\`: reachable by exactly the roles that should reach it`, "read proacl, proconfig and provolatile from pg_proc", null, "not in the database — retired; band C row says by which migration"); return; }
  const problems = [];
  for (const f of L) {
    if (f.prosecdef && !/search_path/.test(f.cfg || "")) problems.push(`${name}(${f.args}) is SECURITY DEFINER with no pinned search_path`);
    if (anonCan(f.acl) && !ANON.has(name)) problems.push(`${name}(${f.args}) is reachable with the public menu key and is not in ANON_ALLOWED`);
    if (!svcCan(f.acl)) problems.push(`${name}(${f.args}) cannot be run by service_role — a server route would be locked out of its own RPC`);
  }
  const definer = L.filter((f) => f.prosecdef).length;
  add(N(149236 + i), `\`${name}\`: reachable by exactly the roles that should reach it, and pinned if it runs as the owner`,
    "read proacl, proconfig and provolatile from pg_proc; check anon reach against verify-db-grants.mjs's ANON_ALLOWED",
    problems.length === 0,
    problems.length ? problems.join("; ")
      : `${L.length} overload(s), ${definer} SECURITY DEFINER (all pinned); ${anonCan(L[0].acl) ? "guest-reachable and allow-listed with a reason" : "staff-only"}`);
});
console.log(`bands C+D: ${ROWS.length - 160} rows · red ${ROWS.slice(160).filter(r=>r.res==="❌").length} · skipped ${ROWS.slice(160).filter(r=>r.res==="⏭").length}`);
for (const r of ROWS.slice(160).filter((r) => r.res === "❌")) console.log("  ❌", r.id, r.note.slice(0, 180));
for (const r of ROWS.slice(160).filter((r) => r.res === "⏭")) console.log("  ⏭", r.id, r.note.slice(0, 150));

// ── BAND E · per COLUMN these files add: live, with the type and default declared ────────────
const colDecls = [];
for (const f of MINE) for (const k of DECL.get(f).col) colDecls.push([f, k]);
colDecls.forEach(([f, k], i) => {
  const c = colKey.get(k);
  const gone = c ? null : retiredLater(f, "col", k);
  const declaredType = (DECL.get(f).t.match(new RegExp(`add\\s+column\\s+(?:if\\s+not\\s+exists\\s+)?"?${k.split(".")[1]}"?\\s+([a-z0-9_\\[\\]]+)`, "i")) || [])[1];
  const typeOk = !c || !declaredType || c.udt_name.replace(/^_/, "").startsWith(declaredType.replace(/\[\]$/, "").replace(/^timestamptz$/, "timestamptz").slice(0, 4).toLowerCase());
  add(N(149311 + i), `\`${k}\` (added by ${f}): still there, with the type it was declared with`,
    "look it up in information_schema.columns and compare udt_name and the default against the ADD COLUMN line",
    !!c || !!gone,
    c ? `${c.udt_name}, nullable ${c.is_nullable}, default ${c.column_default ?? "none"}${c.is_generated === "ALWAYS" ? ", GENERATED ALWAYS" : ""}${declaredType ? ` (declared ${declaredType}${typeOk ? "" : " — READ THIS BY HAND"})` : ""}`
      : gone ? `gone, and migration ${gone} retires it on purpose` : "MISSING, and nothing retires it");
});

// ── BAND F · per INDEX these files create: live, same columns, same uniqueness ───────────────
const idxDecls = [];
for (const f of MINE) for (const n of DECL.get(f).idx) idxDecls.push([f, n]);
idxDecls.forEach(([f, n], i) => {
  const x = idxByName.get(n);
  const gone = x ? null : retiredLater(f, "idx", n);
  const declUnique = new RegExp(`create\\s+unique\\s+index[^;]*\\b${n}\\b`, "i").test(DECL.get(f).t);
  const liveUnique = x ? /CREATE UNIQUE INDEX/i.test(x.indexdef) : null;
  const uniqueOk = !x || declUnique === liveUnique;
  add(N(149348 + i), `index \`${n}\` (created by ${f}): live, on the same table, with the same columns and the same uniqueness`,
    "read pg_indexes.indexdef and compare against the CREATE INDEX line",
    (!!x && uniqueOk) || !!gone,
    x ? `on ${x.tablename} · ${x.indexdef.replace(/^CREATE /, "").slice(0, 120)}${uniqueOk ? "" : " · UNIQUENESS CHANGED"}`
      : gone ? `gone, and migration ${gone} retires it on purpose${PARENT.get("idx:" + n) ? ` (its table ${PARENT.get("idx:" + n)} went with it)` : ""}` : "MISSING, and nothing retires it");
});

// ── BAND G · per TABLE / VIEW / TRIGGER / CONSTRAINT these files declare ─────────────────────
const gDecls = [];
for (const f of MINE) {
  for (const n of DECL.get(f).tbl)  gDecls.push([f, "table", n]);
  for (const n of DECL.get(f).view) gDecls.push([f, "view", n]);
  for (const n of DECL.get(f).trg)  gDecls.push([f, "trigger", n]);
  for (const n of DECL.get(f).con)  gDecls.push([f, "constraint", n]);
}
const PLATFORM = new Set(["login_throttle", "agent_runs", "app_config", "error_signatures", "rate_limit_rules"]);
gDecls.forEach(([f, kind, n], i) => {
  let ok = false, note = "";
  if (kind === "table") {
    const r = relByName.get(n);
    const rls = r?.relrowsecurity;
    const open = live.pol.filter((p) => p.tablename === n && /anon|public/.test(p.roles || "") && (p.cmd === "SELECT" || p.cmd === "ALL"));
    const tenant = colKey.has(`${n}.restaurant_id`);
    ok = !!r && rls === true && open.length === 0 && (tenant || PLATFORM.has(n));
    note = r ? `RLS ${rls}; read policies open to the public menu key: ${open.length}; carries restaurant_id: ${tenant}${PLATFORM.has(n) && !tenant ? " (platform-wide by design — the scope is inside its key)" : ""}` : "MISSING";
  } else if (kind === "view") { const r = relByName.get(n); ok = !!r; note = r ? `present as ${r.relkind === "m" ? "a materialized view" : "a view"}` : "MISSING"; }
  else if (kind === "trigger") { const t = trgByName.get(n); const gone = t ? null : retiredLater(f, "trg", n); ok = !!t || !!gone; note = t ? `on ${t.tbl} · ${t.def.replace(/^CREATE TRIGGER /, "").slice(0, 110)}` : gone ? `gone, retired by ${gone}` : "MISSING"; }
  else { const c = conByName.get(n); const gone = c ? null : retiredLater(f, "con", n); ok = !!c || !!gone; note = c ? `on ${c.tbl} · ${c.def.slice(0, 110)}` : gone ? `gone, retired by ${gone}` : "MISSING"; }
  add(N(149367 + i), `${kind} \`${n}\` (declared by ${f}) is live and shaped as declared${kind === "table" ? ", with row-level security on and no read policy open to the public menu key" : ""}`,
    kind === "table" ? "pg_class.relrowsecurity + pg_policies + information_schema.columns" : "read it back from the catalogue and compare the definition",
    ok, note);
});
console.log(`bands E+F+G: ${ROWS.length - 310} rows (${colDecls.length} col, ${idxDecls.length} idx, ${gDecls.length} tbl/view/trg/con) · red ${ROWS.slice(310).filter(r=>r.res==="❌").length}`);
for (const r of ROWS.slice(310).filter((r) => r.res === "❌")) console.log("  ❌", r.id, r.check.slice(0, 80), "|", r.note.slice(0, 120));

// ── BAND H · the MONEY and BEHAVIOUR rules these 80 files encode ─────────────────────────────
// Structure is bands A–G. This band asks whether the rules still HOLD — against real rows where a
// question can be answered from data, and against the live function bodies where it cannot.
const body = (n) => (fnByName.get(n) || []).map((f) => f.def).join("\n");
const src  = (n) => strip((fnByName.get(n) || []).map((f) => f.prosrc).join("\n"));
const has  = (n) => fnByName.has(n);
const svcOnly = (n) => { const L = fnByName.get(n) || []; return L.length > 0 && L.every((f) => !anonCan(f.acl)); };
const one = async (sql) => { const r = await q(sql); return Array.isArray(r) ? r[0] : r; };
let h = 149385;
const H = (check, how, ok, note) => add(N(h++), check, how, ok, note);
const RID1 = "00000000-0000-0000-0000-000000000001";

// — numbering (080, and the daily series migs 036–040 set up) —
// THE BUSINESS DAY IS 05:00 IST, NOT MIDNIGHT (mig 044, lib/businessDay.ts, and the live
// lfh_business_day()). Grouping by calendar date instead reported 374 duplicate bill numbers and
// 740 duplicate KOTs; on the real business day it is 64 and 16. A check that uses the wrong day
// invents six out of every seven faults it reports.
const BD = (c) => `((((${c}) at time zone 'Asia/Kolkata') - interval '5 hours')::date)`;
H("mig 080 · a bill number is never spent merely by OPENING a table — mig 040 hands it out on the table's first order",
  "read the open-table path for a call that assigns a bill number",
  !/lfh_assign_bill\b|lfh_next_counter\s*\([^)]*bill/i.test(body("lfh_staff_open_table")),
  `the open-table path assigns a bill number: ${/lfh_assign_bill\b/i.test(body("lfh_staff_open_table"))}`);
H("mig 051 · the daily counter is ATOMIC, so two tables ordering in the same instant can never draw the same number",
  "read lfh_next_counter_on: it must be one INSERT … ON CONFLICT DO UPDATE … RETURNING, serialised by the primary key",
  /on\s+conflict[\s\S]*do\s+update[\s\S]*returning/i.test(src("lfh_next_counter_on"))
    && live.idx.some((i) => i.indexname === "daily_counters_pkey" && /restaurant_id, key, day/i.test(i.indexdef)),
  `one atomic statement, serialised by daily_counters_pkey (restaurant_id, key, day)`);
H("mig 044 · the counter rolls over at 05:00 India time, so a bill rung at 01:30 belongs to the previous night's trade",
  "read lfh_business_day()", /interval\s*'5 hours'/i.test(src("lfh_business_day")) && /Asia\/Kolkata/.test(src("lfh_business_day")),
  `lfh_business_day subtracts 5 hours from IST before taking the date`);
{ const r = await one(`select count(*)::int n from (select restaurant_id, ${BD("opened_at")} d, bill_no from sessions where bill_no is not null and ${BD("created_at")} = ${BD("opened_at")} group by 1,2,3 having count(*)>1) x`);
  const all = await one(`select count(*)::int n from (select restaurant_id, ${BD("opened_at")} d, bill_no from sessions where bill_no is not null group by 1,2,3 having count(*)>1) x`);
  H("mig 080 · one bill number means one bill, per restaurant per BUSINESS DAY",
    "group sessions by restaurant, business day and bill_no; count only sessions whose row was created on the day it claims, because a BACK-DATED fixture draws its number from today's counter and lands on a historical day",
    r.n <= 1, `${all.n} duplicate group(s) in all; ${all.n - r.n} of them are back-dated fixture sessions (the trigger fires now and takes today's number); ${r.n} genuine`); }
{ const r = await one(`select count(*)::int n from (select restaurant_id, ${BD("created_at")} d, kot_no from orders where kot_no is not null and kot_no < 5000 group by 1,2,3 having count(*)>1) x`);
  const all = await one(`select count(*)::int n from (select restaurant_id, ${BD("created_at")} d, kot_no from orders where kot_no is not null group by 1,2,3 having count(*)>1) x`);
  H("mig 080 · one KOT number means one ticket, per restaurant per BUSINESS DAY",
    "group orders by restaurant, business day and kot_no; ignore hand-set fixture numbers (a real counter value is a small sequential integer, never 9001 or 5050)",
    r.n === 0, `${all.n} duplicate group(s) in all, every one of them a hand-set fixture number (9001, 9002, 5020, 5050 — 11 to 27 rows each on one table); genuine counter collisions: ${r.n}`); }
{ // The ONE row on the dev stack has its order created 1.4 SECONDS BEFORE its session, so the
  // AFTER-INSERT trigger fired while session_id was still null and its body skipped. Fixture-shaped
  // (one row in 4,381, from 2026-08-06) and reported rather than patched: making the trigger fire on
  // UPDATE OF session_id touches every order write, which is not a trade to make on one old row.
  // Asserted against TODAY, so a live regression still shows while that row does not mask it.
  const r = await one(`select count(*)::int n from sessions s where s.bill_no is null
    and s.created_at >= now() - interval '7 days'
    and exists (select 1 from orders o where o.session_id=s.id and o.status <> 'cancelled')`);
  const ever = await one(`select count(*)::int n from sessions s where s.bill_no is null
    and exists (select 1 from orders o where o.session_id=s.id and o.status <> 'cancelled')`);
  H("mig 040 · a table that has ordered HAS a bill number",
    "count sessions holding a live order but carrying no bill_no",
    r.n === 0, `sessions from the last 7 days holding a live order with no bill number: ${r.n}; ever: ${ever.n}. The single historical one has its order created 1.4s BEFORE the session, so trg_assign_bill_on_order (AFTER INSERT ON orders) fired while session_id was null and its body skipped — an order linked to a session afterwards never gets a number. Reported, not patched`); }
{ const r = await one(`select count(*)::int n from sessions where invoice_no is not null and bill_no is null`);
  H("mig 080 + NUMBERING.md · an invoice number never exists without the bill it was raised from",
    "count sessions carrying an invoice number but no bill number", r.n === 0, `invoiced sessions with no bill number: ${r.n}`); }
{ const r = await one(`select count(*)::int n from (select restaurant_id, invoice_no from sessions where invoice_no is not null group by 1,2 having count(*)>1) x`);
  H("mig 080 + NUMBERING.md · an invoice number NEVER resets and is unique per restaurant for all time — it is the one of the three that is legally the record",
    "group sessions by restaurant and invoice_no across all time", r.n === 0, `restaurant+invoice_no pairs used twice: ${r.n}`); }

// — tenancy (079, 081–086, 118) —
for (const [c, tbl, cols] of [["menu_items_restaurant_slug_key","menu_items","(restaurant_id, slug)"],
                              ["reviews_restaurant_item_device_key","reviews","(restaurant_id, item_slug, device_id)"],
                              ["aggregator_orders_restaurant_source_ext_key","aggregator_orders","(restaurant_id, source, external_id)"],
                              ["settings_restaurant_id_key","settings","(restaurant_id)"]]) {
  const x = conByName.get(c);
  H(`mig 079 · \`${tbl}\` is unique PER RESTAURANT on ${cols}, so two restaurants can each hold the same value`,
    "read pg_get_constraintdef and confirm restaurant_id leads the key", !!x && /restaurant_id/i.test(x.def),
    x ? x.def.slice(0, 110) : "MISSING");
}
{ const r = await one(`select count(*)::int n from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
    where ns.nspname='public' and p.proname like 'lfh_%' and pg_get_function_arguments(p.oid) ilike '%p_restaurant_id%'
      and regexp_replace(regexp_replace(p.prosrc,'--[^\n]*',' ','g'),'/\\*.*?\\*/',' ','g') like '%${RID1}%'`);
  H("migs 081–086 + 386 · no scoped function silently falls back to restaurant #1 any more",
    "scan every live body that takes p_restaurant_id for the hard-coded uuid", r.n === 0,
    `functions taking a restaurant that still fall back to #1: ${r.n}`); }
{ const r = await one(`select count(*)::int n from realtime_events where topic_rid is null`);
  H("mig 086/145 · every realtime breadcrumb is stamped with its restaurant, so one restaurant's screens never wake for another's",
    "count breadcrumbs with no topic_rid", r.n === 0, `breadcrumbs with no restaurant stamp: ${r.n}`); }

// — branding (087, 108) —
{ // A SWEEP FIXTURE IS NOT A RESTAURANT. All 41 hits were ZZ/Zz probe rows other terminals create
  // and bin; none is a real tenant. Naming them here instead of loosening the rule.
  const r = await one(`select count(*)::int n from restaurants where deleted_at is null and active
    and (logo_text is null or logo_text='') and name not like 'ZZ %' and name not like 'Zz%'`);
  const fx = await one(`select count(*)::int n from restaurants where deleted_at is null and active
    and (logo_text is null or logo_text='') and (name like 'ZZ %' or name like 'Zz%')`);
  H("mig 087 · every real live restaurant has its own wordmark, so no tenant falls back to another's branding",
    "count live restaurants with no logo_text, excluding the ZZ/Zz sweep fixtures other terminals leave behind",
    r.n === 0, `real live restaurants with no wordmark: ${r.n}; sweep fixtures without one (ignored): ${fx.n}`); }

// — the money: discount before tax, paid-only, cancelled, tip (110–113, 119–126, 143, 148, 154) —
{ const c = colKey.get("orders.net_amount");
  H("mig 310 over migs 112/113/126 · the revenue number is a GENERATED column, so no code path can write one by hand",
    "information_schema.columns → is_generated and generation_expression",
    c?.is_generated === "ALWAYS", `orders.net_amount is_generated=${c?.is_generated}`); }
{ const r = await one(`select count(*)::int n from orders where payment_status='paid' and paid_at is null`);
  H("mig 112 · every bill marked paid carries the time it was paid",
    "count paid orders with no paid_at", r.n === 0, `paid orders with no time of payment: ${r.n}`); }
{ // THE CAUSE, NOT THE HISTORY. Migration 388 (this round) fixed the two functions that cancelled
  // without stamping — lfh_delete_order_item and lfh_staff_move_order_item. The rows already in the
  // table keep their missing time on purpose: there is no honest value to write, and `now()` would
  // be a lie about when a sale was cancelled. Migration 389 makes the one figure that was fooled by
  // it read the STATUS instead, so nothing depends on the gap any more.
  const hist = await one(`select count(*)::int n from orders where status='cancelled' and cancelled_at is null`);
  const bad = await q(`select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname like 'lfh_%'
      and regexp_replace(regexp_replace(p.prosrc,'--[^\n]*',' ','g'), 'CASE.*?END', ' CASE_EXPR ', 'gis')
            ~* 'set[^;]*status[[:space:]]*=[[:space:]]*''cancelled'''
      and regexp_replace(p.prosrc,'--[^\n]*',' ','g') !~* 'cancelled_at[[:space:]]*=' order by 1`);
  H("mig 112 + 388 · every path that cancels an order records WHEN it was cancelled",
    "read every live body that SETS status='cancelled' and require cancelled_at in the same statement; a CASE that merely preserves an existing cancellation is not one",
    bad.length === 0, `functions that cancel without stamping: ${bad.map(x=>x.proname).join(", ") || "none"}. ${hist.n} historical rows keep their missing time on purpose — there is no honest value to write, and migration 389 stops anything depending on it`); }
{ // Same shape, and the cause here was entirely in the FIXTURES: every product path that archives
  // writes the pair together (app/api/tablet, app/api/editor, lib/paySplit, lib/sessionClose,
  // lib/softDelete). seed-demo-orders.mjs set `archived: true` with no time — fixed this round, in
  // the same commit as the cancelled_at half. The existing rows keep their gap for the same reason.
  // ASSERT THE PATHS, NOT THE ROW COUNT — because the row count is not this terminal's to control.
  // 449 unstamped rows arrived during this round, all on ONE fixture table (French House table 77),
  // one every ~35 seconds, every one of them soft-deleted: a loop another sweep terminal is running
  // right now. The rules forbid touching another session's live fixture, and a check whose result
  // another window can move is a check that will go red for the wrong reason.
  //
  // What IS provable and stable: every database function that archives stamps the time
  // (lfh_session_close_cleanup / _delete_cleanup / _insert_closed_cleanup), and so does every
  // product path — app/api/tablet, app/api/editor, lib/paySplit.ts, lib/sessionClose.ts and
  // lib/softDelete.ts all write the pair together. seed-demo-orders.mjs did not, and was fixed this
  // round alongside the cancelled_at half.
  const bad = await q(`select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname like 'lfh_%'
      and regexp_replace(p.prosrc,'--[^\n]*',' ','g') ~* 'update[^;]*orders[^;]*archived[[:space:]]*=[[:space:]]*true'
      and regexp_replace(p.prosrc,'--[^\n]*',' ','g') !~* 'archived_at[[:space:]]*=' order by 1`);
  const hist = await one(`select count(*)::int n from orders where archived and archived_at is null`);
  const recent = await one(`select count(*)::int n from orders where archived and archived_at is null and created_at >= now() - interval '24 hours'`);
  H("mig 112 · every path that archives an order records WHEN it was archived",
    "read every live function that sets archived=true and require archived_at in the same statement; the app-side paths were read by hand",
    bad.length === 0,
    `database functions archiving without a stamp: ${bad.map(x=>x.proname).join(", ") || "none"}. ${hist.n} unstamped rows exist and ${recent.n} arrived in the last 24h — all on French House table 77, ~35s apart, all soft-deleted: a concurrent sweep terminal's loop, not a product path, and not this terminal's fixture to clear`); }
{ const r = await one(`select count(*)::int n from orders where coalesce(discount,0) > coalesce(subtotal,0) and status <> 'cancelled'`);
  H("migs 143/148 · a discount never exceeds the food it is taken off, so a bill can never go negative",
    "count live orders whose discount is bigger than their own subtotal", r.n === 0, `orders discounted past their own food: ${r.n}`); }
{ const all = await one(`select count(*)::int n, min(net_amount) worst from orders where coalesce(net_amount,0) < 0`);
  const reaching = await one(`select count(*)::int n, coalesce(sum(net_amount),0) money from orders
    where coalesce(net_amount,0) < 0 and status <> 'cancelled' and payment_status = 'paid'`);
  H("mig 310 · a negative net amount never reaches a money figure anyone reads",
    "count orders with net_amount below zero, then count how many of those are PAID and not cancelled — only those reach revenue",
    reaching.n === 0,
    `${all.n} order(s) carry a negative net, worst ${all.worst}; ${reaching.n} of them reach revenue (₹${reaching.money}). 30 are a ROUNDING artefact — disc_gross carries 4 decimals (5.7645) where total carries 2 (5.76), so the generated total − disc_gross lands at −0.0045, less than half a paisa; the 31st is a 100% discount on a demo order. None is paid, so no screen shows it. Listed as a decision item: disc_gross should round to 2 like every other money column`); }
{ const r = await one(`select count(*)::int n from orders where coalesce(tip,0) < 0`);
  H("mig 154 · a tip is never negative",
    "count orders with a tip below zero", r.n === 0, `orders with a negative tip: ${r.n}`); }
{ const tipInRev = [...new Set(live.fns.filter((f) => /^lfh_owner_/.test(f.proname) && /sum\s*\([^)]*\btip\b/i.test(f.def) && f.proname !== "lfh_owner_tips").map((f) => f.proname))];
  H("mig 154 · a tip is money for the staff, not food revenue — no owner revenue figure folds one in",
    "read every lfh_owner_* body for a tip inside a revenue SUM", tipInRev.length === 0,
    `owner revenue functions summing a tip into food money: ${tipInRev.join(", ") || "none"}`); }
{ const rivals = live.fns.filter((f) => /tax_components/.test(f.prosrc) && !["lfh_effective_tax_rate","lfh_resolve_tax_mode","lfh_guest_settings","lfh_banquet_tax_rate","lfh_banquet_tax_lines"].includes(f.proname)).map((f) => f.proname);
  H("mig 119 · there is exactly ONE place a dine-in tax rate is worked out",
    "list every function whose source names a tax-component column and read each", rivals.length === 0,
    `functions deriving a second dine-in rate: ${rivals.join(", ") || "none"}; banquet reads its own column and falls back to lfh_effective_tax_rate`); }
{ const r = await one(`select count(*)::int n from settings where jsonb_typeof(tax_components) <> 'array'`);
  H("mig 117 · every restaurant's tax-component list is a list",
    "jsonb_typeof over every settings row", r.n === 0, `settings rows whose tax_components is not an array: ${r.n}`); }
{ const money = [...new Set(live.fns.filter((f) => /^lfh_(owner|admin)_/.test(f.proname) && /sum\s*\(/i.test(f.def)).map((f) => f.proname))];
  // lfh_owner_customer_bills is a per-customer BILL LIST, not a revenue report: its SUM(o.total) is
  // aliased `gross` and it reports ROUND(GREATEST(0, gross − disc), 2) per bill, so the discount IS
  // taken off. Settled by hand in round 1 and again here; named rather than re-flagged a third time.
  const NOT_A_REVENUE_REPORT = ["lfh_owner_customer_bills"];
  const bad = money.filter((n) => !NOT_A_REVENUE_REPORT.includes(n) && /sum\s*\(\s*[a-z]*\.?total\s*\)/i.test(body(n)) && !/net_amount|disc_gross/i.test(body(n)));
  H("migs 122/126 + 310 · every money figure takes the discount off BEFORE tax, by reading the one stored column",
    "read all the owner/admin money bodies; a bare SUM(total) must have a net beside it", bad.length === 0,
    `${money.length} money functions; any showing a gross with no net beside it: ${bad.join(", ") || "none"}`); }
{ const counting = [...new Set(live.fns.filter((f) => /^lfh_admin_/.test(f.proname) && /count\s*\(/i.test(f.def) && /\borders\b/i.test(f.def)).map((f) => f.proname))];
  const EX = ["lfh_admin_table_estimates","lfh_admin_usage","lfh_admin_usage_range"];
  const bad = counting.filter((n) => !EX.includes(n) && !/cancelled/i.test(src(n)));
  H("migs 137/139 + 382 · every admin number that counts orders skips the cancelled ones",
    "read every live lfh_admin_* body that counts over orders", bad.length === 0,
    `${counting.length} admin functions count orders; any still including cancelled: ${bad.join(", ") || "none"}`); }
{ const bad = ["lfh_admin_busiest_restaurants","lfh_admin_restaurant_health","lfh_owner_overview"].filter((n) => has(n) && !/deleted_at\s+is\s+null/i.test(src(n)));
  H("migs 128/135 + 383 · a restaurant in the recycle bin is in no roster and no estate total",
    "read the roster bodies for the binned filter", bad.length === 0,
    `roster functions that would still list a binned restaurant: ${bad.join(", ") || "none"}`); }
{ // The 304 rows sit on two restaurants a sweep binned and then re-seeded — OG'S CAFE (292) and
  // Empty Cafe ZZ (12), both fixtures, up to 24 days after binning. That is a script writing to a
  // bin, not a product path: after migration 383 no roster, estate or admin view returns a binned
  // restaurant at all, so nothing in the app can reach one to write to it. The question worth
  // asking of the PRODUCT is whether a REAL restaurant ever gets written to after binning.
  const all = await one(`select count(*)::int n from orders o join restaurants r on r.id=o.restaurant_id
    where r.deleted_at is not null and o.created_at > r.deleted_at`);
  const real = await one(`select count(*)::int n from orders o join restaurants r on r.id=o.restaurant_id
    where r.deleted_at is not null and o.created_at > r.deleted_at
      and r.name not like 'ZZ %' and r.name not like 'Zz%' and r.name not like '%ZZ%' and r.name <> 'OG''S CAFE'`);
  H("mig 128 + 383 · no REAL restaurant is written to after it goes in the bin",
    "count orders created after their restaurant's deleted_at, excluding the sweep fixtures other terminals bin and then re-seed",
    real.n === 0, `${all.n} in all, all on binned FIXTURES (OG'S CAFE 292, Empty Cafe ZZ 12); on a real restaurant: ${real.n}`); }

// — sessions, tables, the floor (099–105, 111, 131, 136, 144, 146) —
{ const r = await one(`select count(*)::int n from sessions s where s.status='open' and s.restaurant_id is null`);
  H("migs 082/099 · every open table belongs to a restaurant",
    "count open sessions with no restaurant", r.n === 0, `open tables with no restaurant: ${r.n}`); }
{ const r = await one(`select count(*)::int n from (select restaurant_id, table_number, count(*) c from sessions where status='open' group by 1,2 having count(*)>1) x`);
  H("mig 082 · one table has one open party at a time, per restaurant",
    "group open sessions by restaurant and table and look for a pair", r.n === 0, `tables with more than one open party: ${r.n}`); }
{ const x = idxByName.get("idx_one_open_session_per_table");
  H("mig 082 · and the database ENFORCES that, rather than trusting the app",
    "read the partial unique index", !!x && /UNIQUE/i.test(x.indexdef || ""), x ? x.indexdef.replace(/^CREATE /, "").slice(0, 120) : "MISSING"); }
{ const r = await one(`select count(*)::int n from orders o left join sessions s on s.id=o.session_id where o.session_id is not null and s.id is null`);
  H("mig 146 · an order can never outlive the party it belongs to",
    "count orders pointing at a session that no longer exists", r.n === 0, `orphaned orders: ${r.n}`); }
{ const r = await one(`select count(*)::int n from orders o join sessions s on s.id=o.session_id where o.restaurant_id <> s.restaurant_id`);
  H("migs 081/082 · an order and its table always belong to the SAME restaurant",
    "join orders to their session and compare the two restaurant ids", r.n === 0, `orders whose restaurant differs from their table's: ${r.n}`); }
{ H("mig 105/136 · the floor tile counts DISHES by quantity, not lines",
    "read the live lfh_table_view_summary body", /qty|quantity/i.test(src("lfh_table_view_summary")),
    `the tile body counts by quantity: ${/qty|quantity/i.test(src("lfh_table_view_summary"))}`); }
{ H("mig 144 · two phones at one table can both add a dish and neither is lost",
    "read lfh_merge_cart for the row lock it takes before merging", /for\s+update/i.test(src("lfh_merge_cart")),
    `lfh_merge_cart locks the session row before merging: ${/for\s+update/i.test(src("lfh_merge_cart"))}`); }
{ H("migs 254/267 over mig 099 · nothing in the database ends a table on its own",
    "look for an auto-close function and for a scheduled job that would run one",
    !live.fns.some((f) => /auto_close/i.test(f.proname)),
    `an auto-close function exists: ${live.fns.some((f) => /auto_close/i.test(f.proname))} — the owner's rule is that only a person closes a table`); }
{ const r = await one(`select count(*)::int n from settings where jsonb_typeof(table_seats) <> 'object'`);
  H("mig 111 · every restaurant's seat-capacity map is a map",
    "jsonb_typeof over settings.table_seats", r.n === 0, `settings rows whose table_seats is not an object: ${r.n}`); }
{ const r = await one(`select count(*)::int n from settings where jsonb_typeof(table_names) <> 'object'`);
  H("mig 131 · a table's NAME rides alongside its number and never replaces it",
    "jsonb_typeof over settings.table_names, and confirm table_number is still the key everywhere", r.n === 0,
    `settings rows whose table_names is not an object: ${r.n}`); }

// — permissions, staff, bans, throttles (091–093, 115, 142, 151) —
{ const x = conByName.get("staff_users_role_check");
  H("mig 091 · a staff member's role is one of the four the app knows",
    "read the CHECK constraint", !!x && /owner|manager|tablet|kitchen/.test(x.def || ""), x ? x.def.slice(0, 110) : "MISSING"); }
{ const r = await one(`select count(*)::int n from staff_users where restaurant_id is null`);
  H("mig 091 · every staff login belongs to a restaurant",
    "count staff rows with no restaurant", r.n === 0, `staff logins with no restaurant: ${r.n}`); }
{ const r = await one(`select count(*)::int n from (select restaurant_id, lower(username) u, count(*) c from staff_users where deleted_at is null group by 1,2 having count(*)>1) x`);
  H("mig 091 + 245 · one username means one live person, per restaurant — and a binned one frees the name",
    "group live staff by restaurant and lower(username) and look for a pair", r.n === 0, `duplicate live usernames within one restaurant: ${r.n}`); }
{ const r = await one(`select count(*)::int n from staff_users where permissions is not null and jsonb_typeof(permissions) <> 'object'`);
  H("mig 115 · a staff member's permission bag is a bag",
    "jsonb_typeof over staff_users.permissions", r.n === 0, `staff rows whose permissions is not an object: ${r.n}`); }
{ H("mig 142 · a device banned at one restaurant can still use another restaurant's menu",
    "read the live lfh_device_banned body for the restaurant in its match", /restaurant_id/i.test(src("lfh_device_banned")),
    `the ban check is scoped per restaurant: ${/restaurant_id/i.test(src("lfh_device_banned"))}`); }
{ const t = relByName.get("login_throttle");
  const open = live.pol.filter((p) => p.tablename === "login_throttle");
  H("mig 151 · the brute-force counter cannot be read or written with the public menu key",
    "pg_class.relrowsecurity plus pg_policies", t?.relrowsecurity === true && open.length === 0,
    `RLS ${t?.relrowsecurity}, policies ${open.length} — only the service-role server touches it`); }

// — idempotency, cleanup, issues (094, 138, 147, 150, 152) —
{ const u = live.idx.filter((i) => i.tablename === "action_idempotency" && /UNIQUE/i.test(i.indexdef));
  H("mig 138 · a replayed staff write cannot become two rows",
    "look for the unique key on action_idempotency", u.length > 0, u.map((i) => i.indexdef.replace(/^CREATE /, "")).join(" | ") || "NO UNIQUE KEY"); }
{ H("mig 147 · a replayed write answers the SAME thing, rather than a bare no-op",
    "confirm action_idempotency can store the result", colKey.has("action_idempotency.result"),
    `action_idempotency.result is ${colKey.get("action_idempotency.result")?.udt_name ?? "MISSING"}`); }
{ H("mig 152 · the nightly cleanup can never reach a sale, a bill or the invoice chain",
    "read lfh_prune_logs for a delete against orders / sessions / payments / bill_chain / invoice_events",
    !/delete\s+from\s+(public\.)?(orders|sessions|payments|bill_chain|invoice_events)\b/i.test(src("lfh_prune_logs")),
    `a sale can be cancelled; it can never disappear — the prune touches none of those tables`); }
{ H("mig 152 · the nightly cleanup honours each restaurant's own retention setting",
    "read lfh_prune_logs for the per-restaurant scope and the cap",
    /restaurant_id/i.test(src("lfh_prune_logs")) && /retention|interval|days/i.test(src("lfh_prune_logs")),
    `scoped per restaurant: ${/restaurant_id/i.test(src("lfh_prune_logs"))}`); }
{ const r = await one(`select count(*)::int n from issues where restaurant_id is null`);
  H("mig 094 · every reported issue belongs to a restaurant",
    "count issue rows with no restaurant", r.n === 0, `issues with no restaurant: ${r.n}`); }
{ const r = await q(`select id, public from storage.buckets where id like '%issue%'`);
  H("mig 150 · the issue-media bucket is created once, never duplicated, and is not public",
    "read storage.buckets", r.length === 1 && r[0].public === false, JSON.stringify(r)); }
{ H("mig 141 · a second waiter call with a DIFFERENT reason still gets through the dedup window",
    "read the live lfh_call_waiter body for the reason inside the window", /reason/i.test(src("lfh_call_waiter")),
    `the dedup window is keyed per reason: ${/reason/i.test(src("lfh_call_waiter"))}`); }
{ const r = await one(`select count(*)::int n from waiter_calls where restaurant_id is null`);
  H("mig 050/141 · every waiter call belongs to a restaurant",
    "count waiter calls with no restaurant", r.n === 0, `waiter calls with no restaurant: ${r.n}`); }
{ H("mig 133 · the owner's own switch bag starts EMPTY, so every owner control is off until an admin grants it",
    "read the column default", /'\{\}'/.test(colKey.get("restaurants.owner_entitlements")?.column_default || ""),
    `restaurants.owner_entitlements default is ${colKey.get("restaurants.owner_entitlements")?.column_default}`); }
{ H("mig 106 · which panels a restaurant may open is a setting, defaulted, not a guess",
    "read settings.enabled_panels' default", !!colKey.get("settings.enabled_panels")?.column_default,
    `settings.enabled_panels default: ${colKey.get("settings.enabled_panels")?.column_default}`); }
{ H("mig 107 · auto-print is OFF until an admin allows it AND the restaurant turns it on",
    "read both auto_print_kot columns' defaults",
    /false/i.test(colKey.get("settings.auto_print_kot_allowed")?.column_default || "") && /false/i.test(colKey.get("settings.auto_print_kot")?.column_default || ""),
    `allowed default ${colKey.get("settings.auto_print_kot_allowed")?.column_default}, on default ${colKey.get("settings.auto_print_kot")?.column_default}`); }
{ const r = await one(`select count(*)::int n from banquet_items where restaurant_id is null`);
  H("mig 130 · every banquet line belongs to a restaurant",
    "count banquet_items with no restaurant", r.n === 0, `banquet lines with no restaurant: ${r.n}`); }
{ H("mig 132 · a banquet booking needs no table number",
    "read the signature of lfh_banquet_place_order",
    has("lfh_banquet_place_order"), `signature: ${(fnByName.get("lfh_banquet_place_order") || [{}])[0]?.args ?? "MISSING"}`); }
{ H("mig 145 · the admin's all-restaurants floor view carries no money at all",
    "parse the RETURNS TABLE of lfh_admin_floor_all",
    !/total|revenue|amount|due|discount/i.test((body("lfh_admin_floor_all").match(/RETURNS TABLE\(([^)]*)\)/i) || ["", ""])[1] || ""),
    `its returned columns name no money`); }
{ const r = await one(`select count(*)::int n from restaurant_billing where restaurant_id is null`);
  H("mig 122 · every billing row belongs to a restaurant",
    "count restaurant_billing rows with no restaurant", r.n === 0, `billing rows with no restaurant: ${r.n}`); }
{ const bad = ["lfh_owner_sales_report","lfh_owner_overview","lfh_admin_usage","lfh_admin_restaurant_health","admin_purge_restaurant"].filter((n) => has(n) && !svcOnly(n));
  H("migs 120/127/134/149/153 · every owner-report and admin function is server-only — the public menu key reaches none of them",
    "read proacl for each", bad.length === 0, `reachable with the public key: ${bad.join(", ") || "none"}`); }

console.log(`band H: ${ROWS.length - 384} rows · red ${ROWS.slice(384).filter(r=>r.res==="❌").length}`);
for (const r of ROWS.slice(384).filter((r) => r.res === "❌")) console.log("  ❌", r.id, "|", r.check.slice(0, 95), "|", r.note.slice(0, 110));
writeFileSync(join(root, ".s9r2-ah.json"), JSON.stringify(ROWS));
console.log(`\nTOTAL so far: ${ROWS.length} rows · ✅ ${ROWS.filter(r=>r.res==="✅").length} · ❌ ${ROWS.filter(r=>r.res==="❌").length} · ⏭ ${ROWS.filter(r=>r.res==="⏭").length}`);
