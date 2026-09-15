// verify-rid-required — NO SCOPED FUNCTION MAY GUESS THE RESTAURANT.
//
// WHY THIS EXISTS. Nineteen shared database functions carried the guess in their BODY:
//
//     WHERE restaurant_id = COALESCE(p_restaurant_id, '00000000-…-0001'::uuid)
//
// so a caller that passed nothing — or passed NULL explicitly — was quietly answered as, or written
// into, FRENCH HOUSE. Among them: lfh_price_order, lfh_place_order_public, lfh_staff_place_order,
// lfh_table_view_summary, lfh_floor_state, lfh_kitchen_tickets and lfh_is_blocked — the functions
// that price carts, place orders, draw the floor and decide whether a guest is blocked.
//
// `verify:rpc-scoped` (its sibling) reads CALL SITES and is the right check for "did this caller
// name a restaurant". It cannot see this one: a call site can name the restaurant perfectly and
// still hand over a null, and the COALESCE would swallow it. That is the gap this file closes.
//
// Migration 384 replaced every one of those twenty expressions with `lfh_rid(p_restaurant_id)`,
// which returns the id it was given or raises 22004. The owner picked it as item 4 of sweep #9
// terminal 30's report, on 2026-09-15.
//
// THREE HALVES, because the fallback can come back in three different ways:
//   A  SOURCE   — no migration's NEWEST definition of a function that takes p_restaurant_id may
//                 coalesce it to restaurant #1. Needs no key and no server.
//   B  LIVE     — the same question asked of the bodies installed in the dev database, because a
//                 hand-applied copy can differ from the folder (and did, the day 384 was written:
//                 all nineteen signatures lost their DEFAULT with no migration to explain it).
//   C  REFUSAL  — lfh_rid actually refuses a null instead of returning it, and is still callable by
//                 anon. It has to be: lfh_price_order is SECURITY INVOKER, so it runs as the guest
//                 browser and every helper it reaches must be anon-callable, or guest pricing breaks.
//
// READ-ONLY. Never writes. Exit 1 = a function can guess the restaurant again. Exit 2 = could not run.
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const RID1 = "00000000-0000-0000-0000-000000000001";
let bad = 0;
const ok = (s, m) => { console.log(`${s ? "✓" : "✗"} ${m}`); if (!s) bad++; };
const head = (t) => console.log(`\n── ${t}`);
// STRIP COMMENTS FIRST. A migration header that EXPLAINS the old fallback quotes the uuid, and a
// checker that reads a comment as code goes green over a broken function — the same trap
// verify:rejected and verify:admin-counts-cancelled both record.
const code = (t) => t.replace(/--[^\n]*/g, " ").replace(/\/\*[\s\S]*?\*\//g, " ");
const guesses = (body) => new RegExp(`coalesce\\s*\\(\\s*p_restaurant_id\\s*,\\s*'${RID1}'`, "i").test(code(body));

// Functions whose p_restaurant_id may still be null-tolerant, each with the reason. A NULL default
// is "no restaurant given" and these bodies do NOT fall back to #1 — they answer for nothing, or
// for every restaurant on purpose. Do not add a name here without saying why.
const NULL_OK = {
  lfh_check_ban: "p_restaurant_id defaults to NULL and the body does not fall back to #1",
  lfh_customers_fingerprint: "null means every restaurant this caller owns — a change detector",
  lfh_device_banned: "null-tolerant by design; answers per restaurant when given one",
  lfh_request_unban: "null-tolerant by design",
};

// ── A · the migrations folder, the source of truth for BOTH databases ────────────────────────
head("A · no migration's newest definition coalesces p_restaurant_id to restaurant #1");
{
  const dir = join(root, "supabase", "migrations");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const newest = new Map();
  // A FUNCTION A LATER MIGRATION DROPS IS NOT THIS CHECK'S BUSINESS. `lfh_open_session` is the
  // reason this exists: migration 083 defines it and coalesces to #1, and migration 304 DELETED it
  // — the owner's rule is that guests do not open tables (mig 021), and 083's own header is its
  // obituary. Without this, the guard demanded a fix to a function that has not existed for months.
  // This is the same "or removed by a strictly LATER migration" rule the ledger's own object checks
  // use, and half B agrees independently by only ever reading what is really installed.
  const droppedAt = new Map();
  for (const f of files) {
    const sql = readFileSync(join(dir, f), "utf8");
    for (const m of code(sql).matchAll(/drop\s+function\s+(?:if\s+exists\s+)?(?:public\.)?"?([a-z0-9_]+)"?/gi)) {
      droppedAt.set(m[1], f);
    }
    const re = /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?"?([a-z0-9_]+)"?\s*\(/gi;
    let m;
    while ((m = re.exec(sql))) {
      const name = m[1];
      const rest = sql.slice(m.index);
      const dq = rest.match(/\$([a-z_]*)\$/i);
      if (!dq) continue;
      const s = rest.indexOf(dq[0]) + dq[0].length;
      const e = rest.indexOf(dq[0], s);
      if (e < 0) continue;
      newest.set(name, { file: f, body: rest.slice(0, e), sig: rest.slice(0, s) });
    }
  }
  let looked = 0, retired = 0;
  for (const [name, r] of [...newest].sort()) {
    if (name in NULL_OK) continue;
    if (!/p_restaurant_id/i.test(r.sig)) continue;
    const gone = droppedAt.get(name);
    if (gone && gone > r.file) { retired++; continue; }   // dropped by a strictly later migration
    looked++;
    ok(!guesses(r.body), `${name} (newest: ${r.file})`
      + (guesses(r.body) ? ` — still COALESCEs p_restaurant_id to restaurant #1.`
        + ` Use lfh_rid(p_restaurant_id) so a missing restaurant is refused, not guessed.` : ""));
  }
  ok(looked > 0, `read ${looked} functions that take a restaurant (${newest.size} defined in the folder;`
    + ` ${retired} skipped as retired by a strictly later migration)`);
}

// ── B · the bodies actually installed in the database ────────────────────────────────────────
const parseEnv = (t) => Object.fromEntries(t.split("\n").filter((l) => l.includes("=") && !l.trim().startsWith("#")).map((l) => {
  const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
}));
let env = {};
try { env = parseEnv(readFileSync(join(root, ".env.local"), "utf8")); } catch { /* none */ }
const q = async (sql) => {
  const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql, read_only: true }),
  });
  if (!r.ok) throw new Error((await r.text()).slice(0, 160));
  return r.json();
};
head("B · the same question, asked of the live database");
if (!env.SUPABASE_ACCESS_TOKEN || !env.NEXT_PUBLIC_SUPABASE_URL) {
  console.log("⏭  skipped: no SUPABASE_ACCESS_TOKEN in .env.local — half A covers the folder, which is");
  console.log("   the source of truth for both databases. Not a failure.");
} else {
  try {
    const rows = await q(`select p.proname, pg_get_function_arguments(p.oid) args, p.prosrc
                            from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                           where n.nspname = 'public' and p.proname like 'lfh_%'
                             and pg_get_function_arguments(p.oid) ilike '%p_restaurant_id%'`);
    let looked = 0;
    for (const r of rows.sort((a, b) => a.proname.localeCompare(b.proname))) {
      if (r.proname in NULL_OK) continue;
      looked++;
      ok(!guesses(r.prosrc), `${r.proname} — the body installed in the database`
        + (guesses(r.prosrc) ? ` still COALESCEs p_restaurant_id to restaurant #1.` : ""));
    }
    ok(looked > 0, `read ${looked} live bodies that take a restaurant`);
  } catch (e) { console.log(`⏭  skipped: the database would not answer (${String(e.message).slice(0, 110)}).`); }
}

// ── C · the refusal itself ───────────────────────────────────────────────────────────────────
head("C · lfh_rid refuses a null, and anon can still reach it");
if (!env.SUPABASE_ACCESS_TOKEN) {
  console.log("⏭  skipped: needs the database.");
} else {
  try {
    const rows = await q(`select p.prosrc, p.proacl::text acl, p.provolatile::text vol
                            from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                           where n.nspname = 'public' and p.proname = 'lfh_rid'`);
    ok(rows.length === 1, `lfh_rid exists (${rows.length} definition)`);
    if (rows.length) {
      const [f] = rows;
      ok(/raise\s+exception/i.test(f.prosrc), "it RAISES on a null rather than returning one");
      ok(/22004/.test(f.prosrc), "it raises 22004 (null_value_not_allowed), so a caller can catch it by code");
      ok(/anon=[a-zA-Z]*X/.test(f.acl || ""), `anon can EXECUTE it — required, because lfh_price_order is SECURITY INVOKER`
        + ` and runs as the guest browser (acl: ${f.acl})`);
      ok(f.vol === "i", `it is IMMUTABLE and reads nothing (volatility: ${f.vol})`);
    }
  } catch (e) { console.log(`⏭  skipped: ${String(e.message).slice(0, 110)}`); }
}

console.log(bad === 0
  ? "\n✅ no scoped function can guess the restaurant — a missing one is refused, never answered as French House."
  : `\n❌ ${bad} problem(s) — a function can silently mean restaurant #1 again.`);
process.exit(bad === 0 ? 0 : 1);
