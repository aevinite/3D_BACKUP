// cleanup-stale-orders.mjs — retire the leftovers a test stack accumulates, the way the PRODUCT
// retires them. Never a hard delete: a sale can be cancelled, it can never disappear.
//
// TWO SHAPES OF LEFTOVER, and the second one is why this file was rewritten (T29, 2026-09-17).
//
//   1. AN ORDER WHOSE TABLE HAS NO LIVE SESSION. The original job of this script: rows stranded by
//      sessions closed before the server learned to clear their orders. They used to keep painting
//      a floor tile "Preparing".
//
//   3. A PLATFORM OR PARCEL ORDER STUCK PART-WAY. These do not live in `orders` at all — migration
//      071 put them in `aggregator_orders`, and a parcel has no table, so NEITHER of the two shapes
//      below can see one. That is how a 27-day-old "Lifecycle parcel" was still sitting in the
//      kitchen's COOKING column after the other twelve tickets had been cleared, and two more on
//      another restaurant were 45 days old. Retired through migration 071's own
//      `lfh_platform_set_status`, so the status history records the cancellation like any other.
//
//   2. A SESSION LEFT OPEN AND UNTOUCHED FOR DAYS, with its orders still on it. This script could
//      not see these AT ALL — its only test was "no live session", and these have one. That is how
//      the test restaurant's KITCHEN BOARD came to carry twelve tickets between five and eighteen
//      days old, nine of them called "QA Test Dish", from sweep fixtures that never cleared up.
//      Measured on the backup database 2026-09-17; the oldest was 18 days.
//
// AND A TENANCY BUG IN THE OLD QUERY, fixed here. It matched a session to an order on
// `s.table_number = o.table_number` and NOTHING ELSE — so "table 5 at Aangan" counted as a live
// session for "table 5 at French House", and a real stale order was spared while another
// restaurant's live one could have been caught. This is the same fault migrations 051 and 311 were
// written to undo, in a script that BULK-UPDATES ORDERS. It is now scoped by restaurant throughout.
//
// HOW IT RETIRES, and why this is safer than it looks: for shape 2 it simply CLOSES the abandoned
// session. `lfh_session_close_cleanup` (migration 020, per-restaurant since 311) then does the rest
// itself — cancels the unpaid, unserved orders, archives them, resolves the table's waiter calls,
// denies its pending requests and ends any merge. That is the product's own rule for what closing a
// table means, so this script cannot invent a different one. A PAID or khata order is never
// cancelled by that trigger, only archived.
//
//   node scripts/cleanup-stale-orders.mjs                 # show what it would do, change nothing
//   node scripts/cleanup-stale-orders.mjs --apply         # do it
//   node scripts/cleanup-stale-orders.mjs --apply --days 7
//
// The age threshold exists because this stack is shared: several sweep terminals run at once, and a
// fixture seated a minute ago must never be swept out from under a running test. Two days is far
// longer than any run.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { refuseUnlessDevTestDb } from "./sweep/devStacks.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const DAYS = Number((argv[argv.indexOf("--days") + 1] || "").match(/^\d+$/)?.[0] || 2);
// AANGAN IS THE READ-ONLY CONTROL RESTAURANT and is skipped unless you ask for it. Its orders and
// tables are writable — the standing pre-empt is explicit that the read-only rule covers its
// permission and feature switches, "never about orders, tables or bills" — but a control only earns
// its name by being left alone, and nothing here needs it. `--include-control` takes it too.
const CONTROL = "aangan-garden-restaurant";
const SKIP_CONTROL = !argv.includes("--include-control");
const notControl = SKIP_CONTROL
  ? `and o.restaurant_id <> (select id from restaurants where slug = '${CONTROL}')`
  : "";
const notControlS = SKIP_CONTROL
  ? `and s.restaurant_id <> (select id from restaurants where slug = '${CONTROL}')`
  : "";

const env = {};
for (const line of readFileSync(join(root, ".env.local"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
const token = env.SUPABASE_ACCESS_TOKEN;
// Which database is this? One shared allow-list in scripts/sweep/devStacks.mjs, which knows about
// BOTH dev stacks and never about the client one.
refuseUnlessDevTestDb(env.NEXT_PUBLIC_SUPABASE_URL, "this bulk-updates orders and closes sessions");
const ref = ((env.NEXT_PUBLIC_SUPABASE_URL || "").match(/https?:\/\/([a-z0-9]+)\.supabase\.co/) || [])[1];
if (!token) { console.error("missing SUPABASE_ACCESS_TOKEN"); process.exit(1); }
if (!ref) { console.error("could not derive project ref"); process.exit(1); }

const q = async (sql, readOnly) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(readOnly ? { query: sql, read_only: true } : { query: sql }),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${text.slice(0, 300)}`);
  try { return JSON.parse(text); } catch { return []; }
};

console.log(`database ${ref} · threshold ${DAYS} day(s) · ${SKIP_CONTROL ? "Aangan (the control) skipped" : "including the control"} · ${APPLY ? "APPLYING" : "dry run — nothing will change"}\n`);

// ── 1 · an order whose table has no live session, FOR ITS OWN RESTAURANT ──────────────────────
const orphans = await q(`
  select o.id, o.restaurant_id, o.table_number, o.status, o.kot_no
    from orders o
   where o.archived = false and o.deleted_at is null
     and o.created_at < now() - interval '${DAYS} days'
     ${notControl}
     and not exists (
       select 1 from sessions s
        where s.restaurant_id = o.restaurant_id      -- the fix: a table belongs to a RESTAURANT
          and s.table_number  = o.table_number
          and s.status <> 'closed')
   order by o.created_at`, true);
console.log(`1 · orders whose table has no live session: ${orphans.length}`);
for (const o of orphans.slice(0, 10)) console.log(`     #${o.kot_no} table ${o.table_number} (${o.status})`);

// ── 2 · a session open and untouched for longer than the threshold, still carrying orders ─────
const abandoned = await q(`
  select s.id, s.restaurant_id, s.table_number, s.last_activity_at,
         count(o.id) filter (where not o.archived and o.deleted_at is null) as live_orders
    from sessions s
    left join orders o on o.session_id = s.id
   where s.status = 'open'
     and coalesce(s.last_activity_at, s.opened_at, s.created_at) < now() - interval '${DAYS} days'
     ${notControlS}
   group by s.id
   having count(o.id) filter (where not o.archived and o.deleted_at is null) > 0
   order by s.last_activity_at`, true);
console.log(`\n2 · sessions left open and untouched, still carrying live orders: ${abandoned.length}`);
for (const s of abandoned) console.log(`     table ${s.table_number} · ${s.live_orders} order(s) · last active ${String(s.last_activity_at).slice(0, 16)}`);

// ── 3 · a platform or parcel order stuck part-way, in a table neither query above can reach ───
const parcels = await q(`
  select a.id, a.kot_no, a.source, a.status, a.customer_name, a.created_at
    from aggregator_orders a
   where a.status not in ('handed_over', 'cancelled')
     and a.created_at < now() - interval '${DAYS} days'
     ${SKIP_CONTROL ? `and a.restaurant_id <> (select id from restaurants where slug = '${CONTROL}')` : ""}
   order by a.created_at`, true);
console.log(`\n3 · platform/parcel orders stuck part-way: ${parcels.length}`);
for (const a of parcels) console.log(`     #${a.kot_no} ${a.source} "${a.customer_name}" (${a.status}) from ${String(a.created_at).slice(0, 10)}`);

if (!APPLY) { console.log(`\nnothing changed. re-run with --apply to retire them.`); process.stdout.write("", () => process.exit(0)); }
else {
  // Shape 2 first, and ONLY by closing the session: migration 020's trigger owns what closing a
  // table means, so this cannot invent a different rule. Paid and khata orders are archived, never
  // cancelled, by that trigger.
  if (abandoned.length) {
    const ids = abandoned.map((s) => `'${s.id}'`).join(",");
    const closed = await q(`update sessions set status = 'closed', closed_at = now()
                             where id in (${ids}) and status = 'open' returning id, table_number`);
    console.log(`\n   closed ${closed.length} abandoned session(s) — migration 020's trigger retired what was on them`);
  }
  // Then shape 1, which by definition has no session to close.
  const swept = await q(`
    update orders o
       set status = case when o.status in ('received','preparing') then 'cancelled' else o.status end,
           archived = true,
           archived_at = coalesce(o.archived_at, now()),
           cancelled_at = case when o.status in ('received','preparing') then coalesce(o.cancelled_at, now()) else o.cancelled_at end
     where o.archived = false and o.deleted_at is null
       and o.created_at < now() - interval '${DAYS} days'
       ${notControl}
       and not exists (
         select 1 from sessions s
          where s.restaurant_id = o.restaurant_id
            and s.table_number  = o.table_number
            and s.status <> 'closed')
    returning o.id, o.table_number, o.status`);
  console.log(`   retired ${swept.length} order(s) whose table had no live session`);

  // Shape 3, through migration 071's own RPC so the status history records it like any other move.
  if (parcels.length) {
    for (const a of parcels) await q(`select lfh_platform_set_status('${a.id}'::uuid, 'cancelled', 'stale-cleanup')`);
    console.log(`   cancelled ${parcels.length} stuck platform/parcel order(s) through lfh_platform_set_status`);
  }

  const left = await q(`select count(*) n from orders
                         where archived = false and deleted_at is null
                           and status in ('received','preparing','served')
                           and created_at < now() - interval '${DAYS} days'`, true);
  const leftP = await q(`select count(*) n from aggregator_orders
                          where status not in ('handed_over','cancelled')
                            and created_at < now() - interval '${DAYS} days'`, true);
  console.log(`\n✓ tickets older than ${DAYS} day(s) still on any kitchen board: ${left[0]?.n ?? "?"} dine-in · ${leftP[0]?.n ?? "?"} platform/parcel`);
  process.stdout.write("", () => process.exit(0));
}
