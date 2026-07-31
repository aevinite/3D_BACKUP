// check-floor-timeouts.mjs — did migration 238 actually stop the floor reads timing out?
//
//   npm run check:floor-timeouts              # the normal check (last 48h)
//   npm run check:floor-timeouts -- --hours 24
//   npm run check:floor-timeouts -- --since 2026-08-01T00:00:00Z
//
// WHY THIS EXISTS. The manager and waiter panels were logging "GET summary — canceling statement
// due to statement timeout" — 206 rows in 48h at its worst. Two fixes went in: sharing one floor
// computation between devices (lib/floorSummary.ts) and then migration 238, which made the read
// itself 15-58x cheaper. The second one landed too late in the day to prove anything: timeouts had
// already stopped for the evening, so "none since" meant nothing. This script is the follow-up
// check, so the question gets answered by data instead of by hope.
//
// It is READ-ONLY and it never deletes or resolves an error row. A timeout row is a real record of
// something a real screen suffered; the rule in this project is that an error is never hidden.
//
// Full plan, and what to do if it is NOT fixed: docs/FLOOR-TIMEOUT-WATCH.md
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const env = Object.fromEntries(
  readFileSync(join(root, ".env.local"), "utf8").split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }),
);
const pat = env.SUPABASE_ACCESS_TOKEN;
const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
if (!pat) { console.error("Missing SUPABASE_ACCESS_TOKEN in .env.local"); process.exit(1); }

const ARGS = process.argv.slice(2);
const argOf = (n, d) => { const i = ARGS.indexOf(n); return i >= 0 ? ARGS[i + 1] : d; };
const HOURS = Number(argOf("--hours", "48"));

// When migration 238 became the live definition on the backup database and STAYED that way. It was
// applied earlier in the day, reverted while a decision was open, then re-applied for good just
// before PR #616 merged (merge commit 19b4f1b1, 2026-07-31 17:08 IST = 11:38 UTC). 11:30 UTC is the
// conservative anchor: anything after this was served by the new function.
const ANCHOR = argOf("--since", "2026-07-31T11:30:00Z");

const sql = async (query) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST", headers: { Authorization: `Bearer ${pat}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }), signal: AbortSignal.timeout(120000),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${t.slice(0, 300)}`);
  return JSON.parse(t);
};

const TIMEOUT_WHERE = `(detail::text ILIKE '%canceling statement%' OR detail::text ILIKE '%statement timeout%')`;

console.log(`\nfloor-timeout follow-up · backup database · last ${HOURS}h · migration 238 live since ${ANCHOR}`);
console.log("─".repeat(94));

// ── 1. is the rewrite even still the live definition? ──────────────────────────────────────────
// This repo has been bitten by a later migration re-creating a function from a stale copy and
// silently undoing a fix, so the first thing to check is that what we are judging is what shipped.
const [{ def }] = await sql(`SELECT pg_get_functiondef('lfh_table_view_summary(uuid,text)'::regprocedure) AS def`);
const isOnePass = def.includes("array_append(v_keys") && !def.includes("count(*) FILTER (WHERE NOT archived");
console.log(isOnePass
  ? "✓ the live floor summary IS still migration 238's one-pass version"
  : "✗ the live floor summary is NOT migration 238 any more — a later migration or a hand-edit\n" +
    "   replaced it. Everything below is judging the WRONG function. Re-apply\n" +
    "   supabase/migrations/238_floor_summary_one_pass.sql and find what overwrote it.");

// ── 2. the timeout rows, split at the moment the fix went live ─────────────────────────────────
const [counts] = await sql(`
  SELECT
    count(*) FILTER (WHERE created_at <  '${ANCHOR}'::timestamptz) AS before,
    count(*) FILTER (WHERE created_at >= '${ANCHOR}'::timestamptz) AS since,
    count(*) FILTER (WHERE created_at >= '${ANCHOR}'::timestamptz AND detail::text ILIKE 'GET summary%') AS since_floor,
    (EXTRACT(epoch FROM (now() - '${ANCHOR}'::timestamptz)) / 3600)::numeric(6,1) AS hours_live,
    max(created_at) FILTER (WHERE created_at >= '${ANCHOR}'::timestamptz)::text AS newest_since
  FROM staff_actions
  WHERE created_at > now() - interval '${HOURS} hours' AND ${TIMEOUT_WHERE}`);

console.log(`\nstatement timeouts in the window:`);
console.log(`  BEFORE the fix went live : ${counts.before}`);
console.log(`  SINCE the fix went live  : ${counts.since}   (of those, floor reads: ${counts.since_floor})`);
console.log(`  the fix has been live for : ${counts.hours_live} h`);
if (counts.newest_since) console.log(`  newest one since         : ${counts.newest_since}`);

// ── 3. per hour, so a burst is visible rather than averaged away ────────────────────────────────
const byHour = await sql(`
  SELECT date_trunc('hour', created_at)::text AS hr, count(*) AS n,
         count(*) FILTER (WHERE detail::text ILIKE 'GET summary%') AS floor_n
    FROM staff_actions
   WHERE created_at > now() - interval '${HOURS} hours' AND ${TIMEOUT_WHERE}
   GROUP BY 1 ORDER BY 1`);
if (byHour.length) {
  console.log(`\nby hour (■ = before the fix, □ = after):`);
  for (const h of byHour) {
    const after = new Date(h.hr.replace(" ", "T")) >= new Date(ANCHOR);
    const bar = (after ? "□" : "■").repeat(Math.min(40, Math.max(1, Math.round(Number(h.n) / 4))));
    console.log(`  ${h.hr.slice(0, 16)}  ${String(h.n).padStart(4)}  ${bar}${Number(h.floor_n) ? `  (${h.floor_n} floor)` : ""}`);
  }
}

// ── 4. which floors, and what the read costs right now ─────────────────────────────────────────
const who = await sql(`
  SELECT COALESCE(r.slug, 'unknown') AS slug, COALESCE(s.table_count, 0) AS tables, count(*) AS n
    FROM staff_actions a
    LEFT JOIN restaurants r ON r.id = a.restaurant_id
    LEFT JOIN settings s ON s.restaurant_id = a.restaurant_id
   WHERE a.created_at >= '${ANCHOR}'::timestamptz AND ${TIMEOUT_WHERE.replace(/detail/g, "a.detail")}
   GROUP BY 1, 2 ORDER BY n DESC LIMIT 8`);
if (who.length) {
  console.log(`\nwhich restaurants timed out SINCE the fix:`);
  for (const w of who) console.log(`  ${w.slug.padEnd(26)} ${String(w.tables).padStart(4)} tables   ${w.n}`);
}

await sql(`CREATE OR REPLACE FUNCTION zz_floor_probe(p_rid uuid, p_reps int) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE t0 timestamptz; ms numeric[] := '{}'; i int; r json; BEGIN
  FOR i IN 1..p_reps LOOP t0 := clock_timestamp();
    SELECT lfh_table_view_summary(p_rid, NULL) INTO r;
    ms := ms || (EXTRACT(epoch FROM (clock_timestamp() - t0)) * 1000); END LOOP;
  RETURN jsonb_build_object('min', round((SELECT min(x) FROM unnest(ms) x),1),
                            'max', round((SELECT max(x) FROM unnest(ms) x),1)); END; $$;`);
console.log(`\nwhat a whole-floor read costs right now (measured inside the database):`);
const biggest = await sql(`SELECT r.slug, r.id, COALESCE(s.table_count,0) tables FROM restaurants r
  LEFT JOIN settings s ON s.restaurant_id = r.id ORDER BY COALESCE(s.table_count,0) DESC LIMIT 2`);
let slowest = 0;
for (const b of biggest) {
  const [{ t }] = await sql(`SELECT zz_floor_probe('${b.id}', 5) AS t`);
  slowest = Math.max(slowest, Number(t.max));
  console.log(`  ${b.slug.padEnd(26)} ${String(b.tables).padStart(4)} tables   ${t.min}–${t.max} ms`);
}
await sql(`DROP FUNCTION IF EXISTS zz_floor_probe(uuid, int)`);

// ── 5. the verdict, and it is allowed to say "too early to tell" ───────────────────────────────
console.log("\n" + "─".repeat(94));
const since = Number(counts.since), sinceFloor = Number(counts.since_floor), live = Number(counts.hours_live);
if (!isOnePass) {
  console.log("VERDICT: cannot judge — the live function is not migration 238. Fix that first.");
  process.exit(1);
} else if (sinceFloor === 0 && live >= 12) {
  console.log(`VERDICT: FIXED. No floor read has timed out in the ${live}h since the change,`);
  console.log(`         against ${counts.before} in the window before it. A whole-floor read now`);
  console.log(`         costs ${slowest}ms at worst on the biggest floor.`);
  console.log("\nNothing to do. This check can be retired — say so in docs/FLOOR-TIMEOUT-WATCH.md.");
  process.exit(0);
} else if (sinceFloor === 0) {
  console.log(`VERDICT: TOO EARLY — clean so far, but only ${live}h of evidence, and the timeouts came`);
  console.log(`         in bursts during service hours. Run this again after a busy period.`);
  process.exit(0);
} else {
  console.log(`VERDICT: NOT FIXED — ${sinceFloor} floor read(s) still timed out AFTER the change.`);
  console.log(`         A whole-floor read costs ${slowest}ms at worst, so if that is small, the`);
  console.log(`         remaining cause is CONTENTION, not this query. Work the ordered list in`);
  console.log(`         docs/FLOOR-TIMEOUT-WATCH.md → "If it is still timing out".`);
  process.exit(1);
}
