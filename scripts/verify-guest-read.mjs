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
  ["restaurants", "id,slug"],
  ["settings", "restaurant_id"],
  ["menu_items", "id,title,price,tax_mode"],
  ["categories", "slug"],
  ["filters", "slug"],
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

console.log(`\n${fails.length ? "✗ FAIL" : "✓ PASS"} — ${pass} checks passed, ${fails.length} failed`);
if (fails.length) {
  fails.forEach((f) => console.log("   · " + f));
  console.log("\nA read POLICY and a table GRANT are separate gates and both must pass.");
  console.log("Fix: GRANT SELECT ON TABLE public.<table> TO anon, authenticated;  (see mig 274)");
  process.exit(1);
}
