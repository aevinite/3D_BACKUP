// verify-guest-read.mjs — "can a guest actually READ what we said they could?"
//
// WHY THIS EXISTS: on 2026-08-04 the guest menu was returning 500 for every restaurant on the
// backup site, and had been for some time. Nothing in the code was wrong. `settings` and
// `restaurants` each carried a public SELECT *policy*, but the anon role had lost its SELECT
// *grant* on both — and those are two separate gates that BOTH have to pass. A policy without
// the grant is a no-op, PostgREST answers `42501 permission denied`, and the menu cannot
// render. Every existing check passed, because every existing check ran as the service role.
//
// So this one asks the question the way a guest asks it: with the ANON key, over HTTP.
//
// Usage: node scripts/verify-guest-read.mjs
// Refuses to run against anything but the dev/test database.

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const env = Object.fromEntries(
  readFileSync(join(root, ".env.local"), "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; })
);
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const anon = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const ref = new URL(url).hostname.split(".")[0];

if (ref !== "wnsfcizclkbobwzcxqsf") {
  console.error(`REFUSING: this script only runs against the dev/test database, not ${ref}.`);
  process.exit(2);
}

// Everything the guest menu must read before it can render a single dish. Each is a table the
// project has deliberately given a public read policy.
const MUST_READ = [
  ["menu_items", "id,title,price,tax_mode"],
  ["categories", "slug"],
  ["filters", "slug"],
  ["realtime_events", "id,topic"],   // AppShell watches the `menu` breadcrumb here (mig 282)
];

// `restaurants` and `settings` USED to be in the list above. They are not any more, and that is
// the point of migration 282: the guest no longer reads those tables at all, it calls ONE DOOR
// per table — a SECURITY DEFINER function returning `to_jsonb(row)` minus a denylist. So the
// question "can a guest read what it needs?" is now asked of the doors, and the extra question
// "and does the door withhold what isn't theirs?" can be asked at the same time.
//
// Why a function rather than a column grant or a view: both of those ENUMERATE columns, so they
// must stay in lockstep with the column list in the code — and code and migrations do not deploy
// together. That mismatch 500'd every guest menu on 2026-08-04. A key missing from an object is
// `undefined` and falls back to a default; a column missing from a grant is a hard 42501.
const MUST_OPEN = [
  { fn: "lfh_guest_restaurant", args: { p_slug: "french-house" }, want: ["id", "slug", "name", "active", "deleted_at", "logo_url"], deny: ["access_config", "manager_permissions", "owner_entitlements", "owner_user_id"] },
  { fn: "lfh_guest_settings", argsFrom: "rid", want: ["restaurant_id", "features", "menu_enabled", "tax_rate", "price_tax_mode"], deny: ["gstin", "restaurant_phone", "restaurant_address", "invoice_prefix", "enabled_panels", "bill_footer"] },
];

let pass = 0;
const fails = [];

for (const [table, cols] of MUST_READ) {
  const r = await fetch(`${url}/rest/v1/${table}?select=${cols}&limit=1`, {
    headers: { apikey: anon, Authorization: `Bearer ${anon}` },
  });
  const body = await r.json().catch(() => ({}));
  if (r.ok && Array.isArray(body)) {
    pass++;
    console.log(`  ✓ ${table} — a guest can read it`);
  } else {
    const why = body && body.message ? body.message : `HTTP ${r.status}`;
    fails.push(`${table}: ${why}`);
    console.log(`  ✗ ${table} — ${why}`);
  }
}

// THE TWO DOORS (mig 282) — asked with the anon key over HTTP, exactly as a guest asks. Both
// halves matter: the door must OPEN (or every menu is dead) and it must WITHHOLD (or the finding
// this replaced is still open).
let rid = null;
for (const d of MUST_OPEN) {
  const args = d.argsFrom === "rid" ? { p_restaurant_id: rid } : d.args;
  const r = await fetch(`${url}/rest/v1/rpc/${d.fn}`, {
    method: "POST",
    headers: { apikey: anon, Authorization: `Bearer ${anon}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  const body = await r.json().catch(() => null);
  if (!r.ok || !body || typeof body !== "object") {
    const why = (body && body.message) || `HTTP ${r.status}`;
    fails.push(`${d.fn}: ${why}`);
    console.log(`  ✗ ${d.fn} — the guest's door will not open: ${why}`);
    continue;
  }
  if (d.fn === "lfh_guest_restaurant") rid = body.id;
  const missing = d.want.filter((k) => !(k in body));
  const leaked = d.deny.filter((k) => k in body);
  if (missing.length) {
    fails.push(`${d.fn}: missing ${missing.join(", ")}`);
    console.log(`  ✗ ${d.fn} — the guest needs ${missing.join(", ")} and the door does not return it`);
  } else {
    pass++;
    console.log(`  ✓ ${d.fn} — opens for a guest and returns all ${d.want.length} fields it needs (${Object.keys(body).length} keys)`);
  }
  if (leaked.length) {
    fails.push(`${d.fn}: returns ${leaked.join(", ")}`);
    console.log(`  ✗ ${d.fn} — still hands the guest ${leaked.join(", ")}; add it to the denylist in mig 282`);
  } else {
    pass++;
    console.log(`  ✓ ${d.fn} — withholds all ${d.deny.length} staff-only fields`);
  }
}

// THE DELAYED TRAP THIS DESIGN EXISTS TO AVOID. Once the guest reads through the doors, nothing
// carrying the anon key may go back to reading those two tables directly — a single
// `.from("settings")` added later would need the table grant back, and the finding reopens
// silently. Static, so it fails in review rather than in a restaurant.
const ANON_CLIENT_FILES = ["lib/menu.ts", "lib/tenant.ts", "lib/session.ts", "components/AppShell.tsx", "components/RealtimeProvider.tsx"];
const direct = [];
for (const f of ANON_CLIENT_FILES) {
  let src = "";
  try { src = readFileSync(join(root, f), "utf8"); } catch { continue; }
  for (const m of src.matchAll(/\.from\(\s*"(settings|restaurants)"\s*\)|table:\s*"(settings|restaurants)"/g)) {
    direct.push(`${f} → ${m[0]}`);
  }
}
if (direct.length) {
  fails.push(`direct anon read of settings/restaurants: ${direct.join("; ")}`);
  console.log(`  ✗ a file that holds the anon key reads those tables directly again: ${direct.join("; ")}`);
  console.log(`      Use lfh_guest_settings / lfh_guest_restaurant, or the grant has to come back and the finding reopens.`);
} else {
  pass++;
  console.log(`  ✓ no anon-key file reads settings/restaurants directly — the doors are the only way in`);
}

// The structural version of the same question, so a NEW table with a public policy and no
// grant is caught the day it is added rather than the day a guest hits it.
const q = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: "POST",
  headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    query: `SELECT p.tablename FROM pg_policies p
             WHERE p.cmd='SELECT' AND p.schemaname='public' AND p.roles::text LIKE '%public%'
               AND NOT EXISTS (SELECT 1 FROM information_schema.role_table_grants g
                                WHERE g.table_name=p.tablename AND g.table_schema='public'
                                  AND g.grantee='anon' AND g.privilege_type='SELECT')
             GROUP BY p.tablename ORDER BY 1`,
  }),
});
const orphans = await q.json();
if (Array.isArray(orphans) && orphans.length) {
  orphans.forEach((o) => fails.push(`${o.tablename}: has a public read policy but no anon SELECT grant — the policy does nothing`));
  console.log(`  ✗ ${orphans.length} table(s) carry a read policy that cannot take effect`);
} else {
  pass++;
  console.log("  ✓ every public read policy is backed by a real grant");
}

// ── The other half of the same lesson ────────────────────────────────────────────────────
// This project's tables follow Supabase's default posture: the anon role holds INSERT/UPDATE/
// DELETE on ~56 tables and RLS is what actually refuses the write (almost none of them have a
// write policy at all). That is a normal, working arrangement — the grants are inert — but it
// has ONE failure mode, and it is silent: if RLS is ever switched off on one of those tables,
// the grant underneath is suddenly the only thing left, and nothing anywhere would say so.
// So the invariant worth checking is not "who holds a grant" but "is the gate still on".
const rls = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: "POST",
  headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    query: `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname='public' AND c.relkind='r' AND NOT c.relrowsecurity
               AND EXISTS (SELECT 1 FROM information_schema.role_table_grants g
                            WHERE g.table_name=c.relname AND g.table_schema='public'
                              AND g.grantee='anon' AND g.privilege_type IN ('INSERT','UPDATE','DELETE'))
             ORDER BY 1`,
  }),
});
const noRls = await rls.json();
if (Array.isArray(noRls) && noRls.length) {
  noRls.forEach((t) => fails.push(`${t.relname}: the guest key may write it and RLS is OFF — nothing is refusing the write`));
  console.log(`  ✗ ${noRls.length} table(s) are guest-writable with RLS switched off`);
} else {
  pass++;
  console.log("  ✓ RLS is on for every table the guest key could write");
}

console.log(`\n${fails.length ? "✗ FAIL" : "✓ PASS"} — ${pass} checks passed, ${fails.length} failed`);
if (fails.length) {
  fails.forEach((f) => console.log("   · " + f));
  console.log("\nA read POLICY and a table GRANT are separate gates and both must pass.");
  console.log("Fix: GRANT SELECT ON TABLE public.<table> TO anon, authenticated;  (see mig 274)");
  process.exit(1);
}
