#!/usr/bin/env node
/* compare-schemas.mjs — is AV live's SCHEMA identical to the dev/backup one? (owner, 2026-08-19:
 * "make av exactly like backup fully identical… not the data, just the functions and stuff")
 *
 * READ-ONLY, both databases, and it never prints a credential. It compares the SHAPE only — tables,
 * columns, functions (name + argument list), triggers, indexes, RLS policies, enum types — and never
 * a single row of anybody's data.
 *
 *   node scripts/compare-schemas.mjs            (npm run compare:schemas)
 *
 * WHY IT EXISTS. verify:db-parity answers "is every LIVE function written down in migrations", which
 * is the question that protects a rebuild. This answers the owner's different question: "are the two
 * databases the same shape right now, and if not, exactly what differs" — with the two sides named, so
 * the fix is obvious (a missing migration to run vs. an unrecorded edit somebody made on dev).
 */
import { readFileSync } from "node:fs";

const parse = (t) => Object.fromEntries(t.split("\n").filter((l) => l.includes("=") && !l.trim().startsWith("#")).map((l) => {
  const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
}));
const DEV = parse(readFileSync("/Users/aevinite/Documents/Projects/backup_Menu/.env.local", "utf8"));
const AV = parse(readFileSync("/Users/aevinite/Documents/Projects/backup_Menu/.env.AV.live", "utf8"));
const refOf = (e) => new URL(e.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
const AV_REF = "kclqkmdxnwlhtyrducku";
if (refOf(AV) !== AV_REF) { console.error("REFUSING: those AV credentials are not AV live's."); process.exit(2); }

const q = async (env, sql) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${refOf(env)}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql, read_only: true }),
  });
  if (!r.ok) throw new Error(`${refOf(env).slice(0, 6)}…: ${(await r.text()).slice(0, 200)}`);
  return r.json();
};

const Q = {
  tables: `select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by 1`,
  columns: `select table_name||'.'||column_name||' '||data_type from information_schema.columns where table_schema='public' order by 1`,
  functions: `select p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' order by 1`,
  triggers: `select tgname||' on '||c.relname from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not tgisinternal order by 1`,
  indexes: `select indexname from pg_indexes where schemaname='public' order by 1`,
  policies: `select tablename||' · '||policyname from pg_policies where schemaname='public' order by 1`,
  rls: `select relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relrowsecurity order by 1`,
  enums: `select t.typname||' = '||string_agg(e.enumlabel, ',' order by e.enumsortorder) from pg_type t join pg_enum e on e.enumtypid=t.oid join pg_namespace n on n.oid=t.typnamespace where n.nspname='public' group by t.typname order by 1`,
};

// Function BODIES too, hashed — a name-only match would miss the exact drift the owner is asking about.
const BODY_SQL = `select p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' as sig,
  md5(regexp_replace(regexp_replace(pg_get_functiondef(p.oid), '--[^\\n]*', '', 'g'), '\\s+', ' ', 'g')) as h
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' order by 1`;

console.log("\n  SCHEMA COMPARISON · dev/backup ⇄ AV live   (read-only · shape only, never a row of data)\n");
let diffs = 0;
for (const [what, sql] of Object.entries(Q)) {
  const [d, a] = await Promise.all([q(DEV, sql), q(AV, sql)]);
  const key = (rows) => new Set(rows.map((r) => String(Object.values(r)[0])));
  const D = key(d), A = key(a);
  const onlyDev = [...D].filter((x) => !A.has(x));
  const onlyAv = [...A].filter((x) => !D.has(x));
  // postgres_fdw_* are left over from July's data mirror on AV live and belong to an extension, not us.
  const ext = (x) => /^postgres_fdw_|^dblink|^pg_stat_statements/.test(x);
  const oDev = onlyDev.filter((x) => !ext(x)), oAv = onlyAv.filter((x) => !ext(x));
  const hidden = (onlyDev.length - oDev.length) + (onlyAv.length - oAv.length);
  if (!oDev.length && !oAv.length) {
    console.log(`  ✓ ${what.padEnd(10)} identical — ${D.size} on dev, ${A.size} on AV live${hidden ? ` (${hidden} extension object(s) ignored)` : ""}`);
  } else {
    diffs++;
    console.log(`  ✗ ${what.padEnd(10)} ${oDev.length} only on DEV · ${oAv.length} only on AV LIVE`);
    for (const x of oDev.slice(0, 8)) console.log(`       only dev:     ${x}`);
    for (const x of oAv.slice(0, 8)) console.log(`       only AV live: ${x}`);
    if (oDev.length > 8 || oAv.length > 8) console.log("       …");
  }
}
// bodies
{
  const [d, a] = await Promise.all([q(DEV, BODY_SQL), q(AV, BODY_SQL)]);
  const map = (rows) => new Map(rows.map((r) => [r.sig, r.h]));
  const D = map(d), A = map(a);
  const changed = [...D.keys()].filter((s) => A.has(s) && A.get(s) !== D.get(s));
  if (!changed.length) console.log(`  ✓ ${"bodies".padEnd(10)} every function that exists on both sides has the SAME body (comments and spacing ignored)`);
  else {
    diffs++;
    console.log(`  ✗ ${"bodies".padEnd(10)} ${changed.length} function(s) exist on both sides with DIFFERENT bodies:`);
    for (const s of changed.slice(0, 10)) console.log(`       ${s}`);
  }
}
console.log(diffs ? `\n  ${diffs} kind(s) of difference — see above\n` : "\n  ✓ the two databases are the same shape\n");
process.exit(0);
