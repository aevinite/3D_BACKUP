// verify-summary-parity.mjs — proves a rewritten floor-summary answers EXACTLY what the old one
// answered, for every restaurant and every table, before anything is switched over.
//
// WHY. lfh_table_view_summary is TIER 1 of the Table view: it decides what every tile SAYS and
// what money it shows on the manager floor and every waiter tablet. It was rewritten because it
// asked the database 6-7 questions PER TABLE inside one call — 2 182 ms on a 300-table restaurant
// against 8 ms for the set-based lfh_floor_bundle, and it was logging real statement timeouts. A
// rewrite of something that decides money is only safe if you can show the answers didn't move,
// so this compares the two functions byte for byte rather than trusting a reading of the diff.
//
//   node scripts/verify-summary-parity.mjs --snapshot <file>   # save what the floor says today
//   node scripts/verify-summary-parity.mjs --against <file>    # prove it still says the same
//   node scripts/verify-summary-parity.mjs                     # compare live vs a twin function
//
// USE IT LIKE THIS next time this function is touched (mig 237 was proved exactly this way):
//   1. snapshot the answers  ->  --snapshot /tmp/floor-before.json
//   2. create the candidate ALONGSIDE the live one, named lfh_table_view_summary_v2
//      (copy the live body with `SELECT pg_get_functiondef('lfh_table_view_summary(uuid,text)'
//      ::regprocedure)`, rename it, then edit — never edit the live one to "try something")
//   3. run with no flags: it compares the two, in the same instant, tile by tile
//   4. only when that says IDENTICAL, write the migration and drop the twin
//
// Two things this harness does deliberately, because both were needed to trust it:
//   · a reported difference is RE-READ before it is believed (this database is shared with other
//     sessions and with real panels, so data moving mid-read must not look like a logic change) —
//     a difference in logic is deterministic and survives, live drift does not, and drift is
//     REPORTED as unstable rather than swallowed;
//   · it was checked against deliberate faults — a trailing space in a label, money rounded to 1
//     decimal instead of 2, an off-by-one in the "ready" threshold — and caught all three. A
//     green check that cannot go red is not evidence.
import fs from "node:fs";

const env = Object.fromEntries(
  fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n").filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }),
);
const U = env.NEXT_PUBLIC_SUPABASE_URL, K = env.SUPABASE_SERVICE_ROLE_KEY;
const H = { apikey: K, Authorization: `Bearer ${K}`, "Content-Type": "application/json" };
const ARGS = process.argv.slice(2);
const argOf = (n) => { const i = ARGS.indexOf(n); return i >= 0 ? ARGS[i + 1] : null; };
const SNAPSHOT = argOf("--snapshot");
const AGAINST = argOf("--against");

// This machine's link to the Mumbai database stalls now and then, and a stall must never read as
// a parity failure — retry, and only give up loudly.
async function rpc(fn, args, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(`${U}/rest/v1/rpc/${fn}`, { method: "POST", headers: H, body: JSON.stringify(args), signal: AbortSignal.timeout(120000) });
      if (!r.ok) return { __err: `${r.status} ${(await r.text()).slice(0, 160)}` };
      return await r.json();
    } catch (e) { if (i === tries - 1) return { __err: String(e).slice(0, 120) }; await new Promise((s) => setTimeout(s, 2500)); }
  }
}
const get = async (p) => {
  for (let i = 0; i < 4; i++) {
    try { const r = await fetch(`${U}/rest/v1/${p}`, { headers: H, signal: AbortSignal.timeout(60000) }); if (r.ok) return await r.json(); }
    catch { await new Promise((s) => setTimeout(s, 2000)); }
  }
  return [];
};

// First differing path, in words — "they differ" is useless when the object has 300 tiles.
function firstDiff(a, b, path = "") {
  if (a === b) return null;
  if (typeof a !== typeof b || a === null || b === null) return `${path || "(root)"}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`;
  if (typeof a !== "object") return `${path || "(root)"}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`;
  if (Array.isArray(a) !== Array.isArray(b)) return `${path}: array vs object`;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return `${path}: ${a.length} items vs ${b.length}`;
    for (let i = 0; i < a.length; i++) { const d = firstDiff(a[i], b[i], `${path}[${i}]`); if (d) return d; }
    return null;
  }
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  for (const k of keys) {
    if (!(k in a)) return `${path}.${k}: missing on the OLD side`;
    if (!(k in b)) return `${path}.${k}: missing on the NEW side`;
    const d = firstDiff(a[k], b[k], `${path}.${k}`); if (d) return d;
  }
  return null;
}

const OLD_FN = "lfh_table_view_summary";
const NEW_FN = "lfh_table_view_summary_v2";
let checks = 0, fails = 0;
const problems = [];
const unstable = [];   // differed once then agreed — reported, never hidden
const snap = {};

async function compare(label, rid, table) {
  const args = { p_restaurant_id: rid, p_table: table };
  const key = `${rid}|${table ?? "ALL"}`;

  // The two functions are read one after the other, and this database is shared with other
  // sessions and with real panels — so a waiter call or an order landing BETWEEN the two reads
  // looks exactly like a difference. That would be the test crying wolf. A difference in LOGIC
  // is deterministic and reproduces every time, so a reported difference is re-checked from
  // scratch and only counts if it survives. Nothing is suppressed: a stable difference still
  // fails, and a difference that comes and goes is REPORTED as unstable rather than swallowed.
  let d = null, oldAns = null, newAns = null;
  const TRIES = 3;
  for (let attempt = 1; attempt <= TRIES; attempt++) {
    oldAns = AGAINST ? (JSON.parse(fs.readFileSync(AGAINST, "utf8"))[key] ?? null) : await rpc(OLD_FN, args);
    if (SNAPSHOT) { snap[key] = oldAns; checks++; return; }
    if (AGAINST && oldAns === null) return;                     // not in the snapshot, skip
    newAns = AGAINST ? await rpc(OLD_FN, args) : await rpc(NEW_FN, args);
    if (attempt === 1) checks++;
    for (const [side, v] of [["old", oldAns], ["new", newAns]]) {
      if (v && v.__err) { fails++; problems.push(`${label}: the ${side} call failed — ${v.__err}`); return; }
    }
    d = firstDiff(oldAns, newAns);
    if (!d) {
      if (attempt > 1) unstable.push(`${label} — differed once, then agreed on re-check (live data moved mid-read)`);
      return;
    }
    if (attempt < TRIES) await new Promise((s) => setTimeout(s, 400));
  }
  fails++;
  problems.push(`${label} (same difference on ${TRIES} independent re-reads)\n      ${d}`);
}

// Without a twin there is nothing to compare against, and silently "passing" would be the worst
// possible answer — so say what to do instead.
if (!SNAPSHOT && !AGAINST) {
  const probe = await rpc(NEW_FN, { p_restaurant_id: "00000000-0000-0000-0000-000000000001", p_table: "1" }, 1);
  if (probe && probe.__err && /could not find|does not exist|PGRST202/i.test(probe.__err)) {
    console.error(`No ${NEW_FN} on this database, so there is no candidate to compare the live floor against.\n`);
    console.error("Either snapshot today's answers and re-check them later:");
    console.error("  node scripts/verify-summary-parity.mjs --snapshot /tmp/floor-before.json");
    console.error("  …make the change…");
    console.error("  node scripts/verify-summary-parity.mjs --against /tmp/floor-before.json\n");
    console.error(`or create the candidate alongside the live function as ${NEW_FN} and run this again`);
    console.error("(see the notes at the top of this file — that is how migration 237 was proved).");
    process.exit(2);
  }
}

const rests = await get("restaurants?select=id,slug&order=slug&limit=30");
console.log(`floor-summary parity · ${rests.length} restaurants · ${AGAINST ? "live vs snapshot " + AGAINST : SNAPSHOT ? "snapshotting the live answers" : `${OLD_FN} vs ${NEW_FN}`}\n`);

for (const r of rests) {
  // 1. the whole floor — the call the panels make on load and on every full refresh
  await compare(`${r.slug} · whole floor`, r.id, null);

  // 2. every table that actually HAS something (a session or a live order) — where the tile logic
  //    does real work — plus a spread of empty ones, which is where "free"/"req" is decided.
  const [sess, ord, cnt] = await Promise.all([
    get(`sessions?select=table_number&restaurant_id=eq.${r.id}&status=neq.closed&limit=100`),
    get(`orders?select=table_number&restaurant_id=eq.${r.id}&archived=eq.false&status=neq.cancelled&limit=200`),
    get(`settings?select=table_count&restaurant_id=eq.${r.id}`),
  ]);
  const withData = [...new Set([...sess, ...ord].map((x) => String(x.table_number)).filter(Boolean))];
  const max = Number(cnt?.[0]?.table_count) || 0;
  const spread = [];
  for (const n of [1, 2, Math.floor(max / 2), max, max + 1]) if (n >= 1) spread.push(String(n));
  const tables = [...new Set([...withData, ...spread])];
  for (const t of tables) await compare(`${r.slug} · table ${t}`, r.id, t);
  process.stdout.write(`  ${r.slug.padEnd(26)} ${tables.length + 1} call(s) compared\n`);
}

if (SNAPSHOT) {
  fs.writeFileSync(SNAPSHOT, JSON.stringify(snap, null, 0));
  console.log(`\nsnapshotted ${checks} answers -> ${SNAPSHOT}`);
  process.exit(0);
}
console.log(`\n${checks} comparisons`);
if (unstable.length) {
  console.log(`\n${unstable.length} comparison(s) moved while being read — live data, not a logic difference:`);
  for (const u of unstable) console.log(`  · ${u}`);
}
if (fails) {
  console.error(`\n${fails} DIFFERENCE(S) — the rewrite changes what a tile says:\n\n  - ${problems.join("\n\n  - ")}\n`);
  console.error("A tile decides what staff believe about a table and what it owes. No difference is cosmetic.");
  if (AGAINST) {
    console.error("\nBUT NOTE which mode this is: --against compares the floor NOW to a file written EARLIER,");
    console.error("so anything that genuinely happened in between (an order placed, a table closed, another");
    console.error("session's test) is a real difference in the data, not a fault in the function. Fields like");
    console.error("latest_order_table and order_count move on their own. Take a fresh snapshot immediately");
    console.error("before the change you want to check, or better, compare against a twin function with no");
    console.error("flags — that reads both in the same instant and cannot drift.");
  }
  process.exit(1);
}
console.log("\nIDENTICAL — every tile, every table, every restaurant.");
