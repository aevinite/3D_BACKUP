// verify-dish-counts.mjs — the floor and the kitchen must agree about what is on an order.
//
// WHY THIS EXISTS. An order's dishes live in two places: `order_items` rows, and the `orders.items`
// JSON ticket. 96% of orders (all the imported history) have ONLY the JSON, so that fallback is
// permanent — it is not a remnant to delete. What went wrong three times was not the two sources; it
// was that each reader spelled the counting rule out in its OWN words and they drifted:
//
//   · mig 105 fixed the floor tile to count PLATES (SUM of qty), not dish ROWS — the tile said
//     "2 cooking" while the detail said 4.
//   · mig 122 branched off a PRE-105 copy of the same function and silently reverted it.
//   · mig 136 had to restore it, and the owner had already seen the wrong number twice.
//
// Migration 323 wrote the rule down ONCE as the view `order_dish_lines`, and the kitchen board reads
// it. The FLOOR summary deliberately does NOT: reading the view from `lfh_table_view_summary` — as a
// plain join and as a LATERAL — took it from 162 ms to 5,286 ms on French House, because the planner
// materialises the view's JSON branch across ~30,000 historical orders, and that function is the
// hottest read in the product (mig 238: "do not simplify this back").
//
// So the floor keeps its own pass, and THIS file is what stops it drifting again: for every live
// order in the database it computes the counts BOTH ways — the view, and the floor's own SQL — and
// requires the same answer. If someone edits either spelling, this fails.
//
// READ-ONLY. One aggregate query plus two catalog reads.
//
//   node scripts/verify-dish-counts.mjs            (npm run verify:dish-counts)
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
const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
const q = async (sql) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql, read_only: true }),
  });
  if (!r.ok) throw new Error(`${ref.slice(0, 6)}…: ${(await r.text()).slice(0, 300)}`);
  return r.json();
};

console.log("\nManager/Tablet → Tables floor vs Kitchen panel: do they count the same dishes?");

// 1. the one definition still exists, and still says what it should
const v = await q(`SELECT count(*)::int n FROM pg_views WHERE schemaname='public' AND viewname='order_dish_lines'`);
if (v[0].n === 1) pass("order_dish_lines exists — the one written-down rule (mig 323)");
else fail("the view order_dish_lines is gone; the kitchen reads it (mig 323/324)");

const def = await q(`SELECT pg_get_viewdef('public.order_dish_lines'::regclass, true) AS d`);
const d = def[0]?.d || "";
// Postgres REWRITES `NOT EXISTS (…)` as `NOT (EXISTS (…))` when it stores a view, so match both
// spellings — the first version of this check failed on a view that was perfectly correct, which is
// the sort of false alarm that teaches people to ignore a guard.
/NOT\s*\(?\s*EXISTS/i.test(d) && /order_items oi2/i.test(d)
  ? pass("it still prefers dish ROWS and falls back to the JSON ticket only when there are none")
  : fail("order_dish_lines lost its NOT EXISTS guard — an order with rows would be counted TWICE");
/~ '\^-\?\[0-9\]\+\$'/.test(d) || /\[0-9\]/.test(d) ? pass("it still refuses a qty that is not an integer (mig 238's guard)")
  : fail("order_dish_lines no longer guards a non-integer qty");
/jsonb_typeof/.test(d) ? pass("a non-array ticket still reads as empty rather than aborting (mig 229's guard)")
  : fail("order_dish_lines lost the jsonb_typeof guard — a scalar `items` would abort the caller");

// 2. THE REAL CHECK — both spellings, every live order, same answer.
const rows = await q(`
  WITH live AS (
    SELECT o.id, o.items FROM orders o
     WHERE o.status <> 'cancelled' AND NOT o.archived
  ),
  -- the ONE definition
  vw AS (
    SELECT dl.order_id,
           SUM(dl.qty) FILTER (WHERE dl.status = 'received')  nw,
           SUM(dl.qty) FILTER (WHERE dl.status = 'preparing') ck,
           SUM(dl.qty) FILTER (WHERE dl.status = 'ready')     rd,
           SUM(dl.qty) FILTER (WHERE dl.status = 'served')    sv
      FROM order_dish_lines dl JOIN live l ON l.id = dl.order_id
     GROUP BY 1
  ),
  -- the floor summary's OWN spelling, copied from lfh_table_view_summary's lines CTE
  fl AS (
    SELECT id AS order_id,
           SUM(qty) FILTER (WHERE st = 'received')  nw,
           SUM(qty) FILTER (WHERE st = 'preparing') ck,
           SUM(qty) FILTER (WHERE st = 'ready')     rd,
           SUM(qty) FILTER (WHERE st = 'served')    sv
      FROM (
        SELECT l.id, LOWER(COALESCE(oi.status, 'received')) st, GREATEST(COALESCE(oi.qty, 1), 0) qty
          FROM live l JOIN order_items oi ON oi.order_id = l.id
        UNION ALL
        SELECT l.id, LOWER(COALESCE(el->>'status', 'received')),
               GREATEST(COALESCE(CASE WHEN el->>'qty' ~ '^-?[0-9]+$' THEN (el->>'qty')::int END, 1), 0)
          FROM live l
          CROSS JOIN LATERAL jsonb_array_elements(
            CASE WHEN jsonb_typeof(l.items) = 'array' THEN l.items ELSE '[]'::jsonb END) el
         WHERE NOT EXISTS (SELECT 1 FROM order_items oi2 WHERE oi2.order_id = l.id)
      ) x GROUP BY 1
  )
  SELECT (SELECT count(*) FROM live)::int AS live_orders,
         count(*)::int AS compared,
         count(*) FILTER (WHERE COALESCE(vw.nw,0) IS DISTINCT FROM COALESCE(fl.nw,0)
                             OR COALESCE(vw.ck,0) IS DISTINCT FROM COALESCE(fl.ck,0)
                             OR COALESCE(vw.rd,0) IS DISTINCT FROM COALESCE(fl.rd,0)
                             OR COALESCE(vw.sv,0) IS DISTINCT FROM COALESCE(fl.sv,0))::int AS disagree
    FROM vw FULL JOIN fl USING (order_id)`);
const r0 = rows[0];
if (r0.disagree === 0) pass(`the view and the floor's own pass agree on all ${r0.compared} live orders (of ${r0.live_orders})`);
else fail(`${r0.disagree} live order(s) are counted differently by the floor summary and order_dish_lines — one of the two spellings has drifted. This is exactly what migs 105/122/136 were.`);

// 3. and the floor must still be counting PLATES, not rows — the original bug
const src = await q(`SELECT pg_get_functiondef(p.oid) AS def FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname='public' AND p.proname='lfh_table_view_summary'`);
/SUM\(qty\)/i.test(src[0]?.def || "")
  ? pass("the floor tile still counts SUM(qty) — plates, not dish rows (mig 105's fix, reverted once by 122)")
  : fail("lfh_table_view_summary is counting rows again, not plates — that is mig 105's bug back for a third time");

// 4. the kitchen must be ON the shared definition (that is the half we could afford to share)
const kt = await q(`SELECT pg_get_functiondef(p.oid) AS def FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname='public' AND p.proname='lfh_kitchen_tickets'`);
/order_dish_lines/.test(kt[0]?.def || "")
  ? pass("the kitchen board reads the shared definition")
  : fail("lfh_kitchen_tickets stopped reading order_dish_lines — it is back to its own copy of the rule");

console.log(failed
  ? `\n✗ ${failed} check${failed === 1 ? "" : "s"} failed — the floor and the kitchen can disagree about a dish again`
  : "\n✓ one way to count a dish, and both readers still agree");
process.exit(failed ? 1 : 0);
