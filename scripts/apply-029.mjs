// One-off: apply ONLY migration 029 (server-authoritative pricing) and verify it.
// Deliberately does NOT re-upsert menu data, so live sold-out tags etc. are safe.
//   Run with:  node scripts/apply-029.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// Tiny .env parser (same as seed-supabase.mjs — no dotenv dependency).
function parseEnv(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}
const env = parseEnv(readFileSync(join(root, ".env.local"), "utf8"));
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const pat = env.SUPABASE_ACCESS_TOKEN;
if (!SUPABASE_URL || !pat) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_ACCESS_TOKEN in .env.local");
const projectRef = new URL(SUPABASE_URL).hostname.split(".")[0];

async function runSql(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${pat}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`SQL failed (${res.status}): ${body}`);
  return body ? JSON.parse(body) : [];
}

// 1) Apply the migration.
const sql = readFileSync(join(root, "supabase", "migrations", "029_server_authoritative_pricing.sql"), "utf8");
await runSql(sql);
console.log("✓ applied 029_server_authoritative_pricing.sql");

// 2) Confirm the four functions exist (with argument counts).
const fns = await runSql(
  `SELECT proname, pronargs FROM pg_proc
   WHERE proname IN ('lfh_nice_usd','lfh_price_order','lfh_place_order','lfh_place_order_public')
   ORDER BY proname, pronargs;`
);
console.log("functions:", JSON.stringify(fns));

// 3) Confirm the wide-open INSERT policy is GONE.
const pol = await runSql(`SELECT policyname FROM pg_policies WHERE tablename = 'orders';`);
console.log("orders policies left:", JSON.stringify(pol));

// 4) Price a real dish two ways to prove server math works.
const sample = await runSql(`SELECT id, price, title FROM menu_items WHERE NOT ('sold-out' = ANY(tags)) ORDER BY sort_order LIMIT 1;`);
if (sample.length) {
  const it = sample[0];
  const priced = await runSql(
    `SELECT lfh_price_order('[{"id":${JSON.stringify(it.id)},"qty":2}]'::jsonb) AS r;`
  );
  console.log(`sample dish "${it.title}" raw price ${it.price} ->`, JSON.stringify(priced[0].r));
}

// 5) Prove a sold-out dish is rejected (if one exists).
const so = await runSql(`SELECT id, title FROM menu_items WHERE 'sold-out' = ANY(tags) LIMIT 1;`);
if (so.length) {
  const rej = await runSql(`SELECT lfh_price_order('[{"id":${JSON.stringify(so[0].id)},"qty":1}]'::jsonb) AS r;`);
  console.log(`sold-out dish "${so[0].title}" ->`, JSON.stringify(rej[0].r));
} else {
  console.log("(no sold-out dish in the DB to test rejection against)");
}

// 6) Prove an unknown id is rejected.
const unk = await runSql(`SELECT lfh_price_order('[{"id":"__nope__","qty":1}]'::jsonb) AS r;`);
console.log("unknown id ->", JSON.stringify(unk[0].r));
console.log("✓ verification done");
