// verify-server-only-tables — A TABLE ONLY THE SERVER TOUCHES MUST NOT BE REACHABLE WITH THE PUBLIC
// MENU KEY, AND MUST NOT QUIETLY GET THAT REACH BACK.
//
// WHY THIS EXISTS. Migration 362 took Supabase's default anon/authenticated grants off 23 tables the
// service-role server alone touches, on the owner's approval. Ten more arrived afterwards and never
// got it — the printing set, the banquet bill, the bill chain, a recipe table, the owner join table
// and the retired-address table. Migration 392 revoked those ten (owner picked item 5, 2026-09-16).
//
// RLS was already on all of them with no policy, so the public key got no rows either way. The point
// is that WITHOUT this the absence of a policy is the only thing standing there; with it, two things
// are. Migration 204 set that standard: "defence in depth — same spirit as the REVOKE staff RPCs
// from anon rule".
//
// ⚠️ FIFTEEN MORE TABLES STILL CARRY THE GRANT ON PURPOSE, and this guard must not be "fixed" by
// adding them. They are the pre-tenancy GUEST tables — orders, sessions, session_members,
// order_items, customers, payments, waiter_calls, requests, blocklist, otp_codes, daily_counters,
// seq_counters, staff_actions, feedback, aggregator_orders. `lfh_assign_bill_on_order` is
// anon-reachable AND SECURITY INVOKER AND writes `sessions`, so it runs as the guest's own browser:
// revoking there breaks a diner placing an order. They need their own pass with every INVOKER path
// traced, and that is a separate decision. This file therefore watches a NAMED list, and says so.
//
//   node scripts/verify-server-only-tables.mjs
//
// READ-ONLY. Exit 1 = one of the ten got its public reach back.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
let bad = 0;
const ok = (s, m) => { console.log(`${s ? "✓" : "✗"} ${m}`); if (!s) bad++; };

// The ten migration 392 revoked. Each is reached only through `supabaseAdmin` — checked call site by
// call site when 392 was written, including the two outside app/api and lib
// (app/owner/manager/page.tsx and app/r/[restaurant]/owner/route.ts, both importing supabaseAdmin).
const SERVER_ONLY = [
  "banquet_bills", "bill_chain", "inv_recipe_lines", "print_agents", "print_jobs",
  "print_setup_codes", "print_stations", "printer_events", "restaurant_owners",
  "restaurant_slug_history",
];
// Known to still carry the grant, deliberately — see the warning above. Listed so the count below
// is meaningful rather than alarming.
const GUEST_LEGACY = new Set([
  "orders", "sessions", "session_members", "order_items", "customers", "payments", "waiter_calls",
  "requests", "blocklist", "otp_codes", "daily_counters", "seq_counters", "staff_actions",
  "feedback", "aggregator_orders",
]);

const parseEnv = (t) => Object.fromEntries(t.split("\n").filter((l) => l.includes("=") && !l.trim().startsWith("#")).map((l) => {
  const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
}));
let env = {}; try { env = parseEnv(readFileSync(join(root, ".env.local"), "utf8")); } catch { /* none */ }
if (!env.SUPABASE_ACCESS_TOKEN) {
  console.log("⏭  skipped: no SUPABASE_ACCESS_TOKEN in .env.local — this check is entirely about live grants.");
  process.exit(0);
}
const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
const q = async (sql) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST", headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql, read_only: true }) });
  if (!r.ok) throw new Error((await r.text()).slice(0, 160));
  return r.json();
};

console.log("\n── the ten server-only tables");
const rows = await q(`select c.relname,
    has_table_privilege('anon', c.oid, 'SELECT')          a_sel,
    has_table_privilege('anon', c.oid, 'INSERT')          a_ins,
    has_table_privilege('authenticated', c.oid, 'SELECT') u_sel,
    has_table_privilege('service_role', c.oid, 'SELECT')  s_sel,
    c.relrowsecurity rls
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relname = any('{${SERVER_ONLY.join(",")}}'::text[]) order by 1`);
ok(rows.length === SERVER_ONLY.length, `all ${SERVER_ONLY.length} are present (${rows.length} found)`);
for (const r of rows) {
  const clean = !r.a_sel && !r.a_ins && !r.u_sel;
  ok(clean, `${r.relname}: reachable with the public menu key = ${r.a_sel || r.a_ins || r.u_sel}`
    + (clean ? ` · RLS ${r.rls} · service_role still reads it: ${r.s_sel}` : ` — a grant came back. Add a REVOKE in a new migration.`));
  // the server must still be able to do its job — a revoke that locks the app out is worse
  ok(r.s_sel, `${r.relname}: the service-role server can still read it`);
  ok(r.rls === true, `${r.relname}: row-level security is still on`);
}

console.log("\n── and the fifteen left alone on purpose");
const still = (await q(`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname='public' and c.relkind='r' and c.relrowsecurity
   and not exists (select 1 from pg_policies p where p.schemaname='public' and p.tablename = c.relname)
   and has_table_privilege('anon', c.oid, 'SELECT') order by 1`)).map((r) => r.relname);
const unexpected = still.filter((t) => !GUEST_LEGACY.has(t));
ok(unexpected.length === 0, `tables still carrying the grant: ${still.length} — all of them the known guest set`
  + (unexpected.length ? `, EXCEPT ${unexpected.join(", ")}. A new server-only table has arrived with Supabase's default grant; add it to SERVER_ONLY here and revoke it in a migration.` : ""));

console.log(bad === 0
  ? "\n✅ the ten server-only tables are out of the public key's reach, and the server still reaches them."
  : `\n❌ ${bad} problem(s).`);
process.exit(bad === 0 ? 0 : 1);
