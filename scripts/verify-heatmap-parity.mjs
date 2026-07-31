// verify-heatmap-parity.mjs — proves the rewritten busiest-times heatmap reports the SAME money as
// the old one, for every restaurant and several ranges, before it replaces it.
//
// WHY. lfh_owner_heatmap shows the owner which hours earn. It resolved the tax rate once PER ORDER
// ROW, which made it take 10.8-11.9s against the app's 8s statement limit — so over a long range the
// report always failed. Migration 241 resolves the rate once per restaurant instead. That is a
// change to a revenue calculation, and "it should be the same" is not evidence, so the two are
// compared bucket by bucket.
//
//   node scripts/verify-heatmap-parity.mjs
//
// It expects the OLD implementation to be present alongside as lfh_owner_heatmap_old. Create it by
// capturing the live definition BEFORE applying the migration:
//   pg_get_functiondef → rename to lfh_owner_heatmap_old → apply → run this → drop the old one.
import fs from "node:fs";

const env = Object.fromEntries(
  fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }),
);
const pat = env.SUPABASE_ACCESS_TOKEN;
const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];

async function sql(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST", headers: { Authorization: `Bearer ${pat}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }), signal: AbortSignal.timeout(180000),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${t.slice(0, 200)}`);
  return JSON.parse(t);
}

const OLD = "lfh_owner_heatmap_old";
const NEW = "lfh_owner_heatmap";

const present = await sql(`SELECT count(*)::int n FROM pg_proc WHERE proname = '${OLD}'`);
if (!present[0].n) {
  console.error(`No ${OLD} on this database, so there is nothing to compare against.`);
  console.error("Capture the OLD definition first (see the notes at the top of this file).");
  process.exit(2);
}

const rests = await sql(`SELECT id, slug FROM restaurants ORDER BY slug`);
const RANGES = [
  ["all of 2026", "'2026-01-01'::timestamptz", "now()"],
  ["July only", "'2026-07-01'::timestamptz", "'2026-08-01'::timestamptz"],
  ["one quiet week", "'2026-07-07'::timestamptz", "'2026-07-14'::timestamptz"],
  ["a range with no orders at all", "'2020-01-01'::timestamptz", "'2020-02-01'::timestamptz"],
];

let checks = 0, fails = 0;
const problems = [];

// Compare inside the database: one query returns every bucket where the two disagree, so a
// difference of a single paisa in a single hour cannot hide.
async function compare(label, args) {
  checks++;
  const diff = await sql(`
    WITH a AS (SELECT * FROM ${OLD}(${args})), b AS (SELECT * FROM ${NEW}(${args}))
    SELECT COALESCE(a.dow, b.dow) dow, COALESCE(a.hr, b.hr) hr,
           a.orders a_orders, b.orders b_orders, a.revenue a_revenue, b.revenue b_revenue
      FROM a FULL OUTER JOIN b ON a.dow = b.dow AND a.hr = b.hr
     WHERE a.dow IS NULL OR b.dow IS NULL
        OR a.orders IS DISTINCT FROM b.orders
        OR a.revenue IS DISTINCT FROM b.revenue
     ORDER BY 1, 2 LIMIT 5`);
  if (diff.length) {
    fails++;
    problems.push(`${label}\n      ` + diff.map((d) =>
      `dow ${d.dow} hour ${d.hr}: orders ${d.a_orders} vs ${d.b_orders}, revenue ${d.a_revenue} vs ${d.b_revenue}`).join("\n      "));
  }
}

console.log(`\nheatmap parity · ${rests.length} restaurants × ${RANGES.length} ranges · ${OLD} vs ${NEW}\n`);
for (const r of rests) {
  for (const [rl, from, to] of RANGES) await compare(`${r.slug} · ${rl}`, `'${r.id}'::uuid, ${from}, ${to}, NULL`);
  process.stdout.write(`  ${r.slug.padEnd(26)} ${RANGES.length} range(s) compared\n`);
}
// the portfolio shape: several restaurants in ONE call, which is the only path where rows in the
// same call carry DIFFERENT tax rates — the whole reason this needed a join rather than a parameter
const ids = rests.map((r) => `'${r.id}'`).join(",");
await compare("ALL restaurants together · all of 2026", `NULL::uuid, '2026-01-01'::timestamptz, now(), ARRAY[${ids}]::uuid[]`);
await compare("ALL restaurants together · July", `NULL::uuid, '2026-07-01'::timestamptz, '2026-08-01'::timestamptz, ARRAY[${ids}]::uuid[]`);
console.log(`  ${"(all restaurants in one call)".padEnd(26)} 2 range(s) compared`);

console.log(`\n${checks} comparisons`);
if (fails) {
  console.error(`\n${fails} DIFFERENCE(S) — the rewrite changes the owner's revenue figures:\n\n  - ${problems.join("\n\n  - ")}\n`);
  process.exit(1);
}
console.log("\nIDENTICAL — every day, every hour, every restaurant, orders and revenue alike.");
