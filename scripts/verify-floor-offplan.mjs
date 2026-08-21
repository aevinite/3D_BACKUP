// verify-floor-offplan.mjs — the Live floor shows an OFF-PLAN table only while it is live, and
// never hides one that is.
//
// WHERE THIS BITES: Admin console → Live floor → a restaurant's mini tile grid (and the same rule
// feeds the manager panel's Tables floor). A tile whose number is outside the restaurant's own
// 1..table_count plan is "off-plan": a party seated on a number nobody laid out.
//
// WHY THIS GUARD EXISTS — a bug report that turned out to be correct behaviour (sweep T16, handoff
// H4, closed 2026-08-21). My Little French House showed eight SEVEN-DIGIT tiles, which read like
// junk on the floor, and the obvious "fix" was to drop any number outside the plan. Checking the
// data first said otherwise:
//
//   · all eight had a real bill number and exactly one order — genuine recorded sales, not noise;
//   · they vanished on their own once their sessions closed, because lfh_admin_floor_all()'s
//     `universe` CTE already unions ONLY open sessions and un-archived, un-cancelled orders;
//   · and at that same moment table "288" was live on a 30-table floor with food PREPARING.
//
// So dropping off-plan numbers would have hidden a real open order — the one thing a floor must
// never do. Nothing was wrong; the display fix (a clipped label, mig-free) was the whole job. This
// guard pins BOTH directions of that rule so the next person cannot "tidy" the floor into hiding
// live work, and cannot let dead tiles pile back up either.
//
// READ-ONLY: one RPC + three scoped catalog/table reads, no writes.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const env = Object.fromEntries(readFileSync(join(root, ".env.local"), "utf8").split(/\r?\n/)
  .map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i)).filter(Boolean)
  .map((m) => [m[1], m[2].replace(/^["']|["']$/g, "")]));
const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
const q = async (sql) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(t.slice(0, 300));
  return JSON.parse(t);
};
const QUIET = process.argv.includes("--quiet");
let failed = 0;
const want = (cond, msg) => { if (cond) { if (!QUIET) console.log("  ✓ " + msg); } else { console.log("  ✗ " + msg); failed++; } };

// ── 1. NO DEAD TILES: every off-plan tile must have something live on it right now ───────────
const dead = await q(`
  with f as (select lfh_admin_floor_all()::jsonb j),
  tile as (select (r->>'restaurant_id')::uuid rid, e->>'n' n
             from f, jsonb_array_elements(f.j) r, jsonb_array_elements(r->'tables') e),
  plan as (select s.restaurant_id rid, coalesce(s.table_count,0) tcount from settings s),
  offplan as (select t.rid, t.n from tile t join plan p on p.rid = t.rid
               where t.n !~ '^[0-9]+$' or t.n::bigint < 1 or t.n::bigint > p.tcount)
  select r.slug, o.n
    from offplan o join restaurants r on r.id = o.rid
   where not exists (select 1 from sessions s where s.restaurant_id=o.rid and s.table_number=o.n and s.status='open')
     and not exists (select 1 from orders x  where x.restaurant_id=o.rid and x.table_number=o.n and not x.archived and x.status<>'cancelled')
   limit 20`);
want(dead.length === 0,
  `no off-plan tile lingers after its party left${dead.length ? " — dead: " + dead.map((d) => `${d.slug}#${d.n}`).join(", ") : ""}`);

// ── 2. NOTHING LIVE IS HIDDEN: the far more dangerous direction ──────────────────────────────
const hidden = await q(`
  with f as (select lfh_admin_floor_all()::jsonb j),
  tile as (select (r->>'restaurant_id')::uuid rid, e->>'n' n
             from f, jsonb_array_elements(f.j) r, jsonb_array_elements(r->'tables') e),
  livework as (
    select s.restaurant_id rid, s.table_number n from sessions s
      where s.status='open' and s.table_number is not null
    union
    select o.restaurant_id, o.table_number from orders o
      where not o.archived and o.status<>'cancelled' and o.table_number is not null)
  select r.slug, l.n
    from livework l
    join restaurants r on r.id = l.rid and r.deleted_at is null
   where not exists (select 1 from tile t where t.rid=l.rid and t.n=l.n)
   limit 20`);
want(hidden.length === 0,
  `every table with live work has a tile, off-plan or not${hidden.length ? " — HIDDEN: " + hidden.map((h) => `${h.slug}#${h.n}`).join(", ") : ""}`);

// ── 3. the two filters that make rule 1 true must stay in the function ───────────────────────
const def = (await q(`select pg_get_functiondef('public.lfh_admin_floor_all()'::regprocedure) d`))[0].d;
const universe = def.slice(def.indexOf("universe AS"), def.indexOf("sess AS"));
want(/status = 'open'/.test(universe),
  "the table universe still takes only OPEN sessions (a closed one must not leave a tile behind)");
want(/NOT o\.archived/.test(universe) && /status <> 'cancelled'/.test(universe),
  "…and only un-archived, un-cancelled orders");
want(/generate_series\(1, GREATEST/.test(universe) && /UNION/.test(universe),
  "…and it still UNIONS the off-plan numbers onto the plan rather than replacing them");

// ── 4. a live off-plan label must stay INSIDE its tile (the display half, sweep T16 item 9) ──
const ui = readFileSync(join(root, "app/aevinite/floor/page.tsx"), "utf8");
want(/String\(t\.n\)\.slice\(-2\)/.test(ui) && /overflow: "hidden"/.test(ui),
  "a long off-plan label is clipped in the mini grid instead of smearing over its neighbours");

console.log(failed
  ? `\n✗ ${failed} check${failed === 1 ? "" : "s"} failed — the Live floor is lying about who is seated\n`
  : "\n✓ the floor shows every live table, off-plan ones included, and drops them when they close\n");
process.exit(failed ? 1 : 0);
