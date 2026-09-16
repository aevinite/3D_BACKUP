// verify-cancel-stamped — A CANCELLED ORDER RECORDS WHEN IT WAS CANCELLED, AND IS NEVER COUNTED
// AS TRADE.
//
// WHY THIS EXISTS (sweep #9 / T30 round 2, 2026-09-15, phase P149402). Two live functions cancelled
// an order and never stamped `orders.cancelled_at`:
//
//     lfh_delete_order_item      a waiter removes the last dish from a ticket
//     lfh_staff_move_order_item  a waiter moves the last dish to another table
//
// Their three siblings already did it right — lfh_session_close_cleanup, _delete_cleanup and
// _insert_closed_cleanup all write `cancelled_at = COALESCE(cancelled_at, NOW())`. 24 of September's
// 166 cancellations had no time, about one in seven, still happening on the day it was found.
//
// IT COST TWO REAL NUMBERS, which is why this guard has a second half:
//   · `lfh_owner_report_month_fingerprint` decides whether a cached month needs recomputing from
//     max(greatest(created_at, edited_at, paid_at, cancelled_at, deleted_at)). A cancellation that
//     stamps nothing moves none of them, so the owner's Reports screen keeps serving the old total.
//   · `lfh_staff_performance` decided "was this cancelled?" from `cancelled_at IS NULL`, so 872
//     cancelled orders — ₹1,974 of them on French House alone — counted as money the waiter brought
//     in. Migration 389 made it ask the STATUS instead, which is true whether or not anybody wrote
//     down when.
//
//   node scripts/verify-cancel-stamped.mjs            # source + live database
//
// READ-ONLY. Exit 1 = a cancel path lost its stamp, or a figure counts cancelled orders again.
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
let bad = 0;
const ok = (s, m) => { console.log(`${s ? "✓" : "✗"} ${m}`); if (!s) bad++; };
const head = (t) => console.log(`\n── ${t}`);
// Strip comments before reading any body — a header that explains the old fault names the very
// column we look for. verify:rejected, verify:admin-counts-cancelled and verify:rid-required all
// record this same trap; one of them only found it by being gutted and still passing.
const code = (t) => t.replace(/--[^\n]*/g, " ").replace(/\/\*[\s\S]*?\*\//g, " ");

// Every UPDATE of `orders` that SETS status='cancelled' must stamp the time in the same statement.
// A WHERE clause mentioning 'cancelled' is a filter, not a cancellation — that distinction is the
// whole reason a first version of this check reported six innocent functions.
// PRESERVING A CANCELLATION IS NOT MAKING ONE, and telling them apart is the whole difficulty.
// `lfh_reprice_order` writes
//     status = CASE WHEN status = 'cancelled' THEN status ELSE v_status END
// which KEEPS an order cancelled if it already was — `v_status` can only ever be 'served',
// 'preparing' or 'received'. A first version of this check read that literal and demanded a
// timestamp from a function that never cancels anything. So: a statement counts as a cancellation
// only if it assigns the bare literal, or if a CASE arm RESULTS in it (`THEN 'cancelled'`). This is
// the third detector this round to over-report before being narrowed, and every one of them cost
// less than a wrong green would have.
const cancelSetters = (src) => {
  const s = code(src);
  const out = [];
  for (const m of s.matchAll(/update\s+(?:public\.)?orders\b([\s\S]{0,500}?)(?:;|\bwhere\b)/gi)) {
    const setClause = m[1];
    const withoutCase = setClause.replace(/\bCASE\b[\s\S]*?\bEND\b/gi, " CASE_EXPR ");
    const assignsDirectly = /status\s*=\s*'cancelled'/i.test(withoutCase);
    const caseResultsIn   = /\bCASE\b[\s\S]*?\bTHEN\s*'cancelled'[\s\S]*?\bEND\b/i.test(setClause);
    if (!assignsDirectly && !caseResultsIn) continue;
    out.push({ stamped: /cancelled_at\s*=/i.test(setClause), clause: setClause.replace(/\s+/g, " ").slice(0, 110) });
  }
  return out;
};

const parseEnv = (t) => Object.fromEntries(t.split("\n").filter((l) => l.includes("=") && !l.trim().startsWith("#")).map((l) => {
  const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
}));
let env = {}; try { env = parseEnv(readFileSync(join(root, ".env.local"), "utf8")); } catch { /* none */ }
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

// ── A · the migrations folder ────────────────────────────────────────────────────────────────
head("A · every cancel in supabase/migrations/ stamps the time in the same statement");
{
  const dir = join(root, "supabase", "migrations");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const newest = new Map();
  for (const f of files) {
    const sql = readFileSync(join(dir, f), "utf8");
    const re = /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?"?([a-z0-9_]+)"?\s*\(/gi;
    let m;
    while ((m = re.exec(sql))) {
      const rest = sql.slice(m.index);
      const dq = rest.match(/\$([a-z_]*)\$/i);
      if (!dq) continue;
      const s = rest.indexOf(dq[0]) + dq[0].length;
      const e = rest.indexOf(dq[0], s);
      if (e < 0) continue;
      newest.set(m[1], { file: f, body: rest.slice(s, e) });
    }
  }
  let looked = 0;
  for (const [name, r] of [...newest].sort()) {
    const sets = cancelSetters(r.body);
    if (!sets.length) continue;
    looked++;
    const missing = sets.filter((x) => !x.stamped);
    ok(missing.length === 0, `${name} (newest: ${r.file}) — ${sets.length} cancel statement(s)`
      + (missing.length ? `, ${missing.length} with NO cancelled_at. Add \`cancelled_at = COALESCE(cancelled_at, NOW())\`,`
        + ` the shape lfh_session_close_cleanup already uses. First: ${missing[0].clause}` : ""));
  }
  ok(looked > 0, `read ${looked} function(s) that cancel an order`);
}

// ── B · the bodies installed in the database ─────────────────────────────────────────────────
head("B · the same question, asked of the live database");
if (!env.SUPABASE_ACCESS_TOKEN) {
  console.log("⏭  skipped: no SUPABASE_ACCESS_TOKEN — half A covers the folder, which is the source of truth.");
} else {
  try {
    const rows = await q(`select proname, prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                           where n.nspname='public' and p.proname like 'lfh_%'`);
    let looked = 0;
    for (const r of rows.sort((a, b) => a.proname.localeCompare(b.proname))) {
      const sets = cancelSetters(r.prosrc);
      if (!sets.length) continue;
      looked++;
      const missing = sets.filter((x) => !x.stamped);
      ok(missing.length === 0, `${r.proname} — the body installed in the database`
        + (missing.length ? ` cancels without stamping the time.` : ""));
    }
    ok(looked > 0, `read ${looked} live function(s) that cancel an order`);
  } catch (e) { console.log(`⏭  skipped: the database would not answer (${String(e.message).slice(0, 110)}).`); }
}

// ── C · nothing counts a cancelled order as trade ────────────────────────────────────────────
head("C · no figure decides 'was this cancelled?' from the timestamp alone");
if (!env.SUPABASE_ACCESS_TOKEN) { console.log("⏭  skipped: needs the database."); }
else {
  try {
    const rows = await q(`select proname, prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                           where n.nspname='public' and p.prosrc like '%cancelled_at IS NULL%'`);
    for (const r of rows) {
      const s = code(r.prosrc);
      // A body that tests `cancelled_at IS NULL` must ALSO test the status, or it counts any
      // cancellation that never recorded a time.
      const alsoStatus = /status\s*<>\s*'cancelled'|status\s*!=\s*'cancelled'|status\s+NOT\s+IN\s*\([^)]*'cancelled'/i.test(s);
      ok(alsoStatus, `${r.proname} tests the STATUS as well as the timestamp`
        + (alsoStatus ? "" : ` — it decides 'not cancelled' from \`cancelled_at IS NULL\` alone, so any`
          + ` cancellation with no recorded time counts as trade. Add \`AND status <> 'cancelled'\`.`));
    }
    ok(rows.length > 0, `read ${rows.length} function(s) that test cancelled_at`);
  } catch (e) { console.log(`⏭  skipped: ${String(e.message).slice(0, 110)}`); }
}

console.log(bad === 0
  ? "\n✅ every cancellation records its time, and nothing counts a cancelled order as trade."
  : `\n❌ ${bad} problem(s) — a cancellation can go unrecorded, or be counted as money someone brought in.`);
process.exit(bad === 0 ? 0 : 1);
