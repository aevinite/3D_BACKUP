// verify-merge-records-who.mjs — joining two tables must record WHO did it.
//
// THE GAP THIS EXISTS FOR (owner, 2026-08-08). `table_merges` has carried `merged_by` /
// `merged_by_id` since migration 249, and the UNMERGE half has always filled `ended_by` — but every
// merge row on the dev database read `merged_by = NULL`. Migration 249 took the actor from
// `current_setting('lfh.actor', true)`, a session GUC nothing in this codebase ever set, and which
// could not work anyway: PostgREST hands each `sb.rpc()` a pooled connection, so a `SET` from one
// request is not the connection the next one runs on. So the trail said WHAT and WHEN but never WHO,
// on the one action that puts two tables' money onto a single bill.
//
// Migration 308 gives merge the same `p_actor` parameter its own mirror image already had, and both
// panel routes pass it. This checks the whole chain — the function takes it, the record keeps it,
// and the panel that calls it sends a real name — because each half can be right on its own while
// the trail still comes out empty.
//
//   node scripts/verify-merge-records-who.mjs                              # dev server on :4937
//   node scripts/verify-merge-records-who.mjs --base https://3-d-backup.vercel.app
//
// It builds its own two tables, and puts them back on the way out.
import fs from "node:fs";

const ARG = (f, d) => { const i = process.argv.indexOf(f); return i > -1 ? process.argv[i + 1] : d; };
const B = ARG("--base", "http://localhost:4937");
const env = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const g = (k) => (env.match(new RegExp("^" + k + "=(.+)$", "m")) || [])[1]?.trim();
const REF = ARG("--db", "wnsfcizclkbobwzcxqsf"), RID = "00000000-0000-0000-0000-000000000001";
const q = async (sql) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: "POST", headers: { Authorization: "Bearer " + g("SUPABASE_ACCESS_TOKEN"), "content-type": "application/json" },
    body: JSON.stringify({ query: sql }) });
  const t = await r.text(); if (!r.ok) throw new Error(t.slice(0, 200)); return JSON.parse(t);
};
const A = "23", C = "24", BOTH = `'${A}','${C}'`;
let fails = 0;
const check = (n, ok, d = "") => { console.log(`  ${ok ? "ok  " : "FAIL"} ${n}${d ? " — " + d : ""}`); if (!ok) fails++; };

console.log(`\nA MERGE MUST NAME WHO DID IT — ${B}\n`);

// ── 1. the function itself: one signature, and it accepts an actor ──────────────────────────────
const sigs = await q(`select p.oid::regprocedure::text as sig from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname='public' and p.proname='lfh_staff_merge_tables'`);
check("exactly ONE merge function exists (no ambiguous overload)", sigs.length === 1, sigs.map((s) => s.sig).join(" | "));
check("…and it takes the actor as a parameter", /uuid,text,uuid,text,uuid/.test((sigs[0] || {}).sig || ""), (sigs[0] || {}).sig || "-");
const grants = await q(`select has_function_privilege('anon','lfh_staff_merge_tables(uuid,text,uuid,text,uuid)','execute') as anon,
  has_function_privilege('authenticated','lfh_staff_merge_tables(uuid,text,uuid,text,uuid)','execute') as auth,
  has_function_privilege('service_role','lfh_staff_merge_tables(uuid,text,uuid,text,uuid)','execute') as svc`);
check("staff-only: anon/authenticated cannot execute it, service_role can",
  grants[0] && !grants[0].anon && !grants[0].auth && grants[0].svc, JSON.stringify(grants[0]));

// ── 2. the record really keeps the name ─────────────────────────────────────────────────────────
const wipe = async () => {
  await q(`delete from table_merges where restaurant_id='${RID}' and (child_table in (${BOTH}) or parent_table in (${BOTH}))`);
  await q(`update orders set status='cancelled', archived=true, archived_at=now(), cancelled_at=now()
           where restaurant_id='${RID}' and table_number in (${BOTH}) and not archived`);
  await q(`update sessions set status='closed', closed_at=now()
           where restaurant_id='${RID}' and table_number in (${BOTH}) and status='open'`);
};
await wipe();
try {
  const dish = (await q(`select id from menu_items where restaurant_id='${RID}' limit 1`))[0].id;
  for (const t of [A, C]) await q(`select lfh_staff_place_order('${t}','[{"id":"${dish}","qty":1}]'::jsonb,'{}',null,'${RID}',true)`);
  const sid = async (t) => (await q(`select id from sessions where restaurant_id='${RID}' and table_number='${t}' and status='open' order by created_at desc limit 1`))[0]?.id;
  const who = "Rekha (verify)";
  const whoId = (await q(`select id from staff_users where restaurant_id='${RID}' limit 1`))[0]?.id || null;
  await q(`select lfh_staff_merge_tables('${await sid(C)}','${A}','${RID}', '${who}', ${whoId ? `'${whoId}'` : "null"})`);
  const row = (await q(`select parent_table, child_table, merged_by, merged_by_id from table_merges
    where restaurant_id='${RID}' and child_table='${C}' and ended_at is null limit 1`))[0];
  check("the merge happened", !!row, row ? `T${row.child_table} joined T${row.parent_table}` : "no row");
  check("…and the record NAMES the person", !!row && row.merged_by === who, row ? String(row.merged_by) : "-");
  check("…and keeps their id, so reports can join on it", !!row && (!whoId || row.merged_by_id === whoId), row ? String(row.merged_by_id) : "-");

  // The old 3-argument call must still work (a not-yet-redeployed panel), recording nobody rather
  // than failing — that is what the DEFAULTs are for.
  await q(`select lfh_staff_unmerge_table('${RID}','${C}','cleanup')`);
  await q(`select lfh_staff_merge_tables('${await sid(C)}','${A}','${RID}')`);
  const legacy = (await q(`select merged_by from table_merges where restaurant_id='${RID}' and child_table='${C}' and ended_at is null limit 1`))[0];
  check("an old 3-argument caller still works (records nobody, doesn't error)", !!legacy && legacy.merged_by === null, legacy ? String(legacy.merged_by) : "no row");
} finally {
  await wipe();
}

// ── 3. the PANELS actually send a name ──────────────────────────────────────────────────────────
// Read the deployed/served route source? No — these are server files, so read them from the repo,
// which is the only place they exist. The DB half above proves the record keeps what it is given;
// this proves the two callers give it something.
const root = new URL("..", import.meta.url).pathname;
for (const [panel, file] of [["manager", "app/api/editor/[...path]/route.ts"], ["waiter tablet", "app/api/tablet/[...path]/route.ts"]]) {
  const src = fs.readFileSync(root + file, "utf8");
  // Find the RPC CALL, not merely a mention: the manager route names this function in a comment
  // hundreds of lines above the real call, and matching that gave a false FAIL the first time.
  const i = src.indexOf('rpc("lfh_staff_merge_tables"');
  const call = i < 0 ? "" : src.slice(i, i + 500);
  check(`${panel}: its merge call passes p_actor`, /p_actor\s*:/.test(call),
    i < 0 ? "no merge call found" : (/p_actor\s*:/.test(call) ? "" : "the record will say NULL for every merge from this panel"));
  check(`${panel}: …and p_actor_id`, /p_actor_id\s*:/.test(call));
}

console.log(`\n${fails ? `❌ ${fails} check(s) failed` : "✅ PASS — a merge names the person who made it"}\n`);
process.exit(fails ? 1 : 0);
