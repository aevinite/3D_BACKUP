// verify-order-line-keys.mjs — AN ORDER LINE NAMES ITS DISH BY `id`. NOTHING MAY JOIN ON `slug`.
//
// ── WHY THIS EXISTS (2026-10-03, after the same fault shipped three times) ───────────────────
// Every order line in this app is built by ONE function, lfh_price_order(), which emits exactly:
//     id, title, price, qty, options, removed, note, tax_mode, is_mrp
// There is no `slug`. All three order doors (guest, staff, tablet) go through it.
//
// Three separate migrations have nonetheless joined menu_items on `it->>'slug'`, which matches
// nothing, and each time the failure was SILENT because a join that matches nothing returns a
// number rather than an error:
//   · mig 089  owner "Revenue by category" — every dish collapsed into one "Other" row.
//              Found 2026-07-06 and fixed by mig 130, whose header spells the shape out.
//   · mig 224  automatic stock depletion — the trigger's inner filter was
//              `WHERE COALESCE(it->>'slug','') <> ''`, so it discarded every line before the
//              recipe join. It never fired once, and being deliberately fail-open it never
//              logged either. Selling a dish never moved its stock.
//   · mig 227  lfh_inv_dish_cost + lfh_inv_coverage — "sold qty", "revenue", "covered revenue"
//              and "total dishes" were hard zeros. lfh_inv_coverage is the function the UI
//              divides by to print the food-cost %, and mig 227 calls it "the honesty gate on
//              every percentage" — a zero denominator is the one thing it existed to prevent.
// All three fixed by mig 409.
//
// A code-reading guard cannot catch this: the SQL is valid, the column exists on menu_items,
// and the migration that introduced it looks exactly like the one that fixed it. So this asks
// the RUNNING DATABASE instead — the same question, against the objects actually installed.
//
// READ-ONLY. Two SELECTs against pg_proc. Safe to run while other sessions are working.
//
//   node scripts/verify-order-line-keys.mjs
//   node scripts/verify-order-line-keys.mjs --quiet    # only failures
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const parseEnv = (t) => Object.fromEntries(t.split("\n").filter((l) => l.includes("=") && !l.trim().startsWith("#")).map((l) => {
  const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
}));
const QUIET = process.argv.includes("--quiet");
let failed = 0;
const pass = (m) => { if (!QUIET) console.log("  ✓ " + m); };
const fail = (m) => { console.log("  ✗ " + m); failed++; };

const env = parseEnv(readFileSync(join(root, ".env.local"), "utf8"));
const q = async (sql) => {
  const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql, read_only: true }),
  });
  if (!r.ok) throw new Error(`${ref.slice(0, 6)}…: ${(await r.text()).slice(0, 200)}`);
  return r.json();
};

console.log("\nAn order line names its dish by `id`");

// ── 1. the writer still emits `id` ───────────────────────────────────────────────────────────
// If lfh_price_order ever stopped writing `id`, every join below would be correct and still
// broken, so the guard checks the source of the key before it checks the readers of it.
const [writer] = await q(`
  SELECT pg_get_functiondef(p.oid) AS def FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'lfh_price_order'`);
if (!writer) fail("lfh_price_order is missing — the single order-line builder is gone");
else if (!/'id',\s*v_mi\.id/.test(writer.def)) fail("lfh_price_order no longer writes 'id' onto each order line — every dish join is now dead");
else pass("lfh_price_order writes `id` onto every order line");

// ── 2. nothing reads a `slug` off an order line ──────────────────────────────────────────────
// Deliberately matched on the function BODY rather than a file, because the database is what
// runs. A function is only flagged when it reads ->>'slug' AND walks orders.items, so an
// unrelated use of a slug column (restaurants.slug, menu_items.slug) is not a false positive.
const readers = await q(`
  SELECT p.proname AS name FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prokind = 'f'
     AND pg_get_functiondef(p.oid) LIKE '%>>''slug''%'
     AND pg_get_functiondef(p.oid) LIKE '%jsonb_array_elements%'
     AND pg_get_functiondef(p.oid) ILIKE '%orders%'
   ORDER BY 1`);
if (readers.length) {
  fail(`${readers.length} database function(s) join an order line on 'slug', which no order line has:`);
  for (const r of readers) console.log("      · " + r.name);
  console.log("      Join on the dish id instead: menu_items.id::text = (it->>'id'). See mig 409.");
} else {
  pass("no database function joins an order line on `slug`");
}

console.log(failed ? `\n✗ ${failed} check(s) failed\n` : "\n✓ every dish join goes through the key the order actually carries\n");
process.exit(failed ? 1 : 0);
