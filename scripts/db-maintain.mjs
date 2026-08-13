// db-maintain.mjs — reclaim the memory this database wastes on bloated indexes and dead rows.
//
//   npm run db:maintain              # report only, changes nothing
//   npm run db:maintain -- --apply   # actually rebuild and vacuum
//
// WHY THIS EXISTS (measured 2026-07-31/08-01). This instance is small: shared_buffers is **224 MB**
// and effective_cache_size 384 MB (a ~1 GB machine). The database was **367 MB** — so the working set
// did not fit, every large scan read from disk AND evicted the floor's hot pages, and that is the
// mechanism by which heavy analytics made unrelated panel reads slow enough to hit the 8-second
// statement wall.
//
// A third of that was pure waste. `realtime_events` holds ~300 live rows (breadcrumbs are inserted
// and pruned constantly) and its indexes had grown to **29 MB** — one of them was **19.4 MB for 306
// rows**. A B-tree never gives those pages back on its own: VACUUM frees space *inside* index pages
// but does not shrink the index, so a high-churn table's indexes only ever grow. REINDEX is the only
// thing that reclaims them. One pass took the database from **367 MB to 321 MB**.
//
// It will happen again — that is the nature of a churn queue — so this is a command rather than a
// one-off fix. It is NOT a cron: the owner's rule is no blind scheduled recompute. Run it when the
// report below says there is something to reclaim.
//
// SAFETY. Everything here is CONCURRENTLY or plain VACUUM: no table is locked, no write is blocked,
// no row is touched. It changes no data and cannot change a single figure any screen shows. It
// refuses to point at the AV LIVE database.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const env = Object.fromEntries(
  readFileSync(join(ROOT, ".env.local"), "utf8").split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }),
);
const pat = env.SUPABASE_ACCESS_TOKEN;
const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];

// AV LIVE is read-only by standing rule. Its project ref is kclqkmdxnwlhtyrducku; this refuses to
// run anywhere but the backup database, so no maintenance can be aimed at clients by accident.
// ONE shared allow-list (T10 sweep, 2026-08-12). This carried its own copy of a single
// hard-coded project id, so it refused on BACKUP-2 — the failover stack the owner uses when
// backup-1 hits its 100-deploys-a-day cap, i.e. the only place a merged fix can be checked that
// day. scripts/sweep/devStacks.mjs knows both dev stacks and has never known the client one.
refuseUnlessDevTestDb(env.NEXT_PUBLIC_SUPABASE_URL, "this runs database maintenance");

const APPLY = process.argv.includes("--apply");
const sql = async (query) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST", headers: { Authorization: `Bearer ${pat}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }), signal: AbortSignal.timeout(600000),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${t.slice(0, 200)}`);
  return JSON.parse(t);
};
const mb = (b) => (Number(b) / 1048576).toFixed(1);

const [cfg] = await sql(`SELECT current_setting('shared_buffers') buf, pg_database_size(current_database()) size`);
console.log(`\ndatabase ${mb(cfg.size)} MB · shared_buffers ${cfg.buf} · ${APPLY ? "APPLYING" : "report only (add --apply to act)"}`);
console.log("─".repeat(88));

// ── bloated indexes: far larger than the rows they cover ────────────────────────────────────────
// The ratio, not the size, is what identifies bloat: 19 MB for 306 rows is waste, 32 MB for 400k
// rows is a legitimately big index. 200 bytes/row is generous for a btree entry.
const bloated = await sql(`
  SELECT s.indexrelname AS idx, s.relname AS tbl, pg_relation_size(s.indexrelid) AS bytes, t.n_live_tup AS live
    FROM pg_stat_user_indexes s JOIN pg_stat_user_tables t ON t.relid = s.relid
   WHERE pg_relation_size(s.indexrelid) > 1000000
     AND pg_relation_size(s.indexrelid) > GREATEST(t.n_live_tup, 1) * 200
   ORDER BY pg_relation_size(s.indexrelid) DESC`);

if (!bloated.length) console.log("\n✓ no bloated indexes — nothing to rebuild");
else {
  console.log(`\n${bloated.length} bloated index(es) — big for the rows they cover:`);
  let freed = 0;
  for (const b of bloated) {
    process.stdout.write(`  ${mb(b.bytes).padStart(7)} MB  ${b.tbl}.${b.idx} (${Number(b.live).toLocaleString()} rows)`);
    if (!APPLY) { console.log("   → would rebuild"); continue; }
    try {
      await sql(`REINDEX INDEX CONCURRENTLY public.${b.idx}`);
      const [after] = await sql(`SELECT pg_relation_size('${b.idx}'::regclass) AS bytes`);
      freed += Number(b.bytes) - Number(after.bytes);
      console.log(`   → ${mb(after.bytes)} MB`);
    } catch (e) { console.log(`   → SKIPPED: ${String(e.message).slice(0, 70)}`); }
  }
  if (APPLY) console.log(`  reclaimed ${mb(freed)} MB`);
}

// ── dead rows the autovacuum threshold will not reach for a long time ───────────────────────────
// Postgres waits for threshold + scale_factor × rows. On a 400k-row table that is ~80 000 dead rows,
// so `orders` sat 11 days with 13k dead rows that every sequential scan still had to walk past.
const dead = await sql(`
  SELECT relname AS tbl, n_dead_tup AS dead, n_live_tup AS live,
         COALESCE(to_char(last_autovacuum, 'MM-DD HH24:MI'), 'never') AS vac
    FROM pg_stat_user_tables
   WHERE n_dead_tup > 2000 ORDER BY n_dead_tup DESC`);
if (!dead.length) console.log("\n✓ no table is carrying a meaningful number of dead rows");
else {
  console.log(`\n${dead.length} table(s) carrying dead rows:`);
  for (const d of dead) {
    process.stdout.write(`  ${String(Number(d.dead).toLocaleString()).padStart(9)} dead / ${Number(d.live).toLocaleString()} live  ${d.tbl}  (last autovacuum ${d.vac})`);
    if (!APPLY) { console.log("   → would vacuum"); continue; }
    await sql(`VACUUM (ANALYZE) public.${d.tbl}`);
    const [a] = await sql(`SELECT n_dead_tup AS dead FROM pg_stat_user_tables WHERE relname='${d.tbl}'`);
    console.log(`   → ${Number(a.dead).toLocaleString()} dead`);
  }
}

const [end] = await sql(`SELECT pg_database_size(current_database()) size`);
console.log("\n" + "─".repeat(88));
console.log(`database ${mb(cfg.size)} MB → ${mb(end.size)} MB${APPLY ? "" : "  (nothing changed — this was a report)"}`);
if (!APPLY && (bloated.length || dead.length)) console.log("Run again with --apply to reclaim it. Nothing is locked and no data is touched.");
