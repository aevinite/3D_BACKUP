// verify-heatmap-live.mjs — THE BUSIEST-TIMES HEATMAP STILL ANSWERS, AND STILL ANSWERS IN TIME.
//
// ── WHAT THIS REPLACED, AND WHY (sweep #7 / T28, 2026-08-28) ─────────────────────────────────────
//
// This file used to be `verify-heatmap-parity.mjs`. It compared the rewritten heatmap against the
// old one, bucket by bucket, to prove migration 241 did not change a single paisa of the owner's
// revenue. That was exactly the right check to write — and it was a ONE-OFF. It needed
// `lfh_owner_heatmap_old` staged beside the live function, the migration landed long ago, and
// nothing creates that copy any more. So for months it did this, on every single run:
//
//     No lfh_owner_heatmap_old on this database, so there is nothing to compare against.
//     → exit 2
//
// Honest, and useless. A line in the suite that can never say anything is a line people learn to
// skip, and the habit of skipping lines is what lets a real red hide.
//
// So the comparison is retired and the ONGOING risk it was really about is checked instead. That
// risk is not "did the rewrite change the numbers" — that question is answered and closed. It is:
//
//   **the heatmap must never go back to being too slow to answer.**
//
// ── THE FAULT THIS EXISTS TO CATCH ───────────────────────────────────────────────────────────────
//
// Owner console → Reports → the busiest-times heatmap. It shows which hours earn. The original
// version resolved the tax rate once PER ORDER ROW — `lfh_effective_tax_rate` is STABLE and reads
// `settings`, so Postgres called it again for every row — and over a long range it took 10.8–11.9
// SECONDS against the app's 8-second statement limit. The owner did not see a slow chart. He saw
// the report FAIL, every time, for any range worth looking at.
//
// Migration 241 fixed it by reading the rate once per restaurant into a CTE and joining. Nothing
// stops the next person editing that function and putting the per-row call back — it looks tidier,
// and it is only wrong at scale, which is exactly the kind of wrong nobody notices on a dev stack
// with a few hundred orders.
//
// So this asks three things, and every one of them can actually be answered on any database:
//
//   1. the live definition still reads the rate ONCE per restaurant (the mig-241 shape), and does
//      not resolve it per row again;
//   2. the function really RUNS, for every restaurant and for all of them at once, over the widest
//      range there is — and comes back inside the app's own statement limit with room to spare;
//   3. what it returns is shaped like a heatmap: hours 0–23, days 0–6, no negative money.
//
// READ-ONLY. It calls a STABLE function and reads its rows. It writes nothing and creates nothing.
//
//   node scripts/verify-heatmap-live.mjs
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
    body: JSON.stringify({ query }), signal: AbortSignal.timeout(120000),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${t.slice(0, 200)}`);
  return JSON.parse(t);
}

// The app's own statement limit is 8s — the wall the original version hit.
//
// TIMING ON A SHARED DEV DATABASE IS NOT A PROPERTY OF THE FUNCTION (corrected 2026-08-29, having
// watched my own first version go red for the wrong reason). My first draft FAILED past 4s, half the
// budget. It then went red at 4816ms while a deliberate five-guard collision experiment was hammering
// the same database, on a stack that has grown to 75 restaurants because every parallel session
// leaves test ones behind. Neither of those is the heatmap getting slower, and a guard that goes red
// because a neighbour is busy is exactly the crying wolf this whole terminal spent two days removing.
//
// So the timing is a CANARY, not the verdict:
//   · past 8s it FAILS — that is the real wall, and past it the owner's Reports do not load at all;
//   · between 4s and 8s it WARNS and says so plainly, without turning the suite red;
//   · and every measurement is the FASTEST OF THREE, so one busy moment cannot decide it.
//
// The fault this guard actually exists for — the tax rate resolved per order row — is caught by the
// STATIC checks above, deterministically, on any machine at any load. That is where the teeth are.
const LIMIT_MS = 8000, WARN_MS = 4000, TRIES = 3;

/** The fastest of three, because a shared database's slowest moment is not the function's speed. */
async function fastest(query) {
  let best = Infinity, rows = [];
  for (let i = 0; i < TRIES; i++) {
    const t0 = Date.now();
    rows = await sql(query);
    const ms = Date.now() - t0;
    if (ms < best) best = ms;
    if (best < 800) break;             // already comfortably fast; three runs would be waste
  }
  return { rows, ms: best };
}

let pass = 0, fail = 0;
const ok = (m, d = "") => { pass++; console.log(`  ok   ${m}${d ? ` — ${d}` : ""}`); };
const bad = (m, d = "") => { fail++; console.log(`  FAIL ${m}${d ? `\n       ${d}` : ""}`); };

console.log("\nOwner console → Reports → busiest-times heatmap: does it still answer, and in time?\n");

// ── 1 · the shape migration 241 introduced is still in the LIVE definition ───────────────────────
const [{ def }] = await sql(
  `SELECT pg_get_functiondef(p.oid) def FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'lfh_owner_heatmap'
    ORDER BY p.oid DESC LIMIT 1`);

// ONE REVENUE NUMBER (owner, 2026-08-12: "everywhere should be the same data … only that revenue
// taken and calculated elsewhere"). Migration 310 put every money surface onto the STORED
// `orders.net_amount` instead of each one working the net out for itself. That is what the heatmap
// reads today, and it is the reason the per-row tax lookup is gone for good rather than merely
// hoisted: there is no rate in the sum at all any more.
//
// MY FIRST DRAFT OF THIS CHECK ASSERTED MIGRATION 241'S ARRANGEMENT — a rates CTE joined to orders
// — and went red on a function that had moved on to something strictly better. That is the exact
// mistake this whole terminal spent the day fixing in other people's guards, so it is written down
// here: assert the DECISION (one stored number, never a per-row rate lookup), never the shape a
// particular migration happened to use to reach it.
const readsStoredNet = /SUM\s*\(\s*o\.net_amount\s*\)/i.test(def);
if (readsStoredNet) {
  ok("revenue comes from the stored net_amount — the one number every money screen shares (mig 310)");
} else {
  bad("lfh_owner_heatmap no longer reads the stored net_amount",
    "Owner, 2026-08-12: \"everywhere should be the same data\". Migration 310 exists because five money\n       "
    + "screens each worked the net out for themselves and disagreed. Recomputing it here brings that back —\n       "
    + "and a discount is grossed at the rate it was CHARGED at, not the rate configured right now (mig 301).");
}

// AND THE SPEED DECISION THAT STILL HOLDS. Migration 241 exists because the rate was resolved once
// PER ORDER ROW — lfh_effective_tax_rate is STABLE and reads settings, so Postgres called it again
// for every row — and the report took 10.8-11.9s against an 8s limit. It does not matter HOW that
// is avoided; it matters that it is never done again inside the per-row sum.
const perRowRate = /SUM\s*\([^)]{0,200}lfh_effective_tax_rate\s*\(\s*o\./i.test(def);
if (!perRowRate) ok("…and the tax rate is never resolved per ORDER ROW inside the sum (the mig-241 lesson)");
else bad("the tax rate is being resolved per order row again inside SUM()",
  "That is exactly what took the owner's busiest-times report from working to failing: 10.8-11.9s\n       "
  + "against an 8s statement limit, so it did not load at all for any range worth looking at.");

// A leftover, not a fault — said out loud so nobody mistakes it for load-bearing. The `rates` CTE
// and its LEFT JOIN were migration 241's mechanism; migration 310 removed the only thing that used
// them. Postgres will not evaluate the CTE's function calls for a column nobody selects, so it
// costs nothing measurable — but it reads as if the rate still matters here, and it does not.
if (/LEFT\s+JOIN\s+rates\s+rt/i.test(def) && !/rt\.rate/i.test(def)) {
  console.log("  ⏭  the `rates` CTE and its join are LEFT OVER from migration 241 — nothing selects rt.rate any more.\n       Harmless and unmeasurable, but a tidy-up worth doing next time this function is touched.");
}

// ── 2 · it actually runs, and it runs fast ───────────────────────────────────────────────────────
const rests = await sql("SELECT id, slug FROM restaurants ORDER BY slug");
if (rests.length < 1) { bad("no restaurants on this database — nothing to ask the heatmap about"); }

// The widest range there is: everything, from before this product existed to now.
const WIDE = "'2000-01-01'::timestamptz, now()";
let slowest = { slug: "", ms: 0 };
for (const r of rests) {
  const { rows, ms } = await fastest(`SELECT * FROM lfh_owner_heatmap('${r.id}'::uuid, ${WIDE}, NULL)`);
  if (ms > slowest.ms) slowest = { slug: r.slug, ms };
  // Shape: a heatmap has 7 days and 24 hours, and money is never negative.
  const oddBucket = rows.find((x) => x.dow < 0 || x.dow > 6 || x.hr < 0 || x.hr > 23);
  const negative = rows.find((x) => Number(x.revenue) < 0);
  if (oddBucket) bad(`${r.slug}: a bucket outside a week`, `dow ${oddBucket.dow}, hour ${oddBucket.hr}`);
  else if (negative) bad(`${r.slug}: negative money in a bucket`, `dow ${negative.dow} hour ${negative.hr}: ${negative.revenue}`);
}
ok(`every one of ${rests.length} restaurant(s) answered over ALL of history, and every bucket is a real day and hour`,
   `slowest ${slowest.slug} at ${slowest.ms}ms`);

// The portfolio shape — several restaurants in ONE call. This is the only path where rows in the
// same call carry DIFFERENT tax rates, which is the whole reason migration 241 needed a JOIN rather
// than a single parameter. It is also the slowest thing the admin's money view can ask for.
{
  const ids = rests.map((r) => `'${r.id}'`).join(",");
  const { rows, ms } = await fastest(`SELECT * FROM lfh_owner_heatmap(NULL::uuid, ${WIDE}, ARRAY[${ids}]::uuid[])`);
  if (ms > slowest.ms) slowest = { slug: "all restaurants in one call", ms };
  ok(`all ${rests.length} restaurants in ONE call, over all of history, came back with ${rows.length} bucket(s)`, `${ms}ms`);
}

// A range with nothing in it must answer emptily, not fall over — the owner opens January of a year
// the restaurant did not exist in, and a report that errors there reads as a broken report.
{
  const rows = await sql(`SELECT * FROM lfh_owner_heatmap('${rests[0].id}'::uuid, '2001-01-01'::timestamptz, '2001-02-01'::timestamptz, NULL)`);
  const money = rows.reduce((s, x) => s + Number(x.revenue || 0), 0);
  if (money === 0) ok("a range with no trading in it answers empty rather than failing", `${rows.length} bucket(s), ₹0`);
  else bad("a range with no trading in it reported money", `₹${money}`);
}

// ── 3 · the verdict on speed ─────────────────────────────────────────────────────────────────────
if (slowest.ms >= LIMIT_MS) {
  bad(`the heatmap is past the app's own ${LIMIT_MS / 1000}s statement limit — the owner's Reports will FAIL, not merely feel slow`,
    `${slowest.slug} took ${slowest.ms}ms. This is the exact failure migration 241 was written for.`);
} else if (slowest.ms >= WARN_MS) {
  // A warning, deliberately NOT a failure — see the note on LIMIT_MS above. It is said in full so
  // nobody has to guess whether it matters.
  pass(`⚠ the heatmap's fastest run was ${slowest.ms}ms (${slowest.slug}) — over half the ${LIMIT_MS / 1000}s budget, but not past it`,
    `${rests.length} restaurants on this database. Worth a look if it keeps climbing; not a fault, and NOT red — `
    + "on a shared dev stack this reads high whenever another session is busy.");
} else {
  ok(`the slowest ask is well inside the ${LIMIT_MS / 1000}s statement limit`, `${slowest.ms}ms on ${slowest.slug}`);
}

console.log(fail
  ? `\n✗ verify:heatmap — ${fail} check(s) failed, ${pass} passed.\n`
  : `\n✅ verify:heatmap — ${pass} checks passed: the busiest-times chart answers for every restaurant, over all of history, well inside the limit that used to break it.\n`);
process.exit(fail ? 1 : 0);
