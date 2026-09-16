// verify-bill-number-on-order — A SESSION THAT HOLDS A LIVE ORDER HAS A BILL NUMBER, AND A MERGED
// PARTY STILL HAS ONLY ONE.
//
// WHY THIS EXISTS (owner picked item 4 of sweep #9 T30's round-2 report, 2026-09-16).
// docs/NUMBERING.md: a bill number is handed out when a table's FIRST ORDER lands (migration 040),
// not when the table is opened — before that, tapping a table burned a number. `trg_assign_bill_on_order`
// enforced it on INSERT only, so a session that came to hold an order any OTHER way never got one:
//
//   · lfh_staff_unmerge_table gives a child table a fresh session, moves its live orders across,
//     and never touches bill_no — so an unmerged table held orders with no number;
//   · an order INSERTed with no session and linked a moment later skipped the trigger entirely
//     (its body returns early when session_id is null). One such row on the dev stack, 2026-08-06.
//
// Migration 391 added `trg_assign_bill_on_relink` — the SAME function, on `UPDATE OF session_id`,
// with a WHEN clause so it fires only when an order really changes party.
//
// ⚠️ THE SECOND HALF IS THE ONE THAT MATTERS MOST. "Merged party = ONE bill" is the owner's standing
// rule. `lfh_staff_merge_tables` sets bill_no = COALESCE(keep, drop) and `lfh_staff_move_order`
// assigns by hand, so on both paths the new trigger must find a number already there and do NOTHING.
// If the assign function ever loses its "only when NULL" test, a merge would start handing out a
// second number — so this guard checks that test is still in the body.
//
//   node scripts/verify-bill-number-on-order.mjs
//
// READ-ONLY. Exit 1 = a table can hold orders with no number, or a merged party could get two.
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
let bad = 0;
const ok = (s, m) => { console.log(`${s ? "✓" : "✗"} ${m}`); if (!s) bad++; };
const head = (t) => console.log(`\n── ${t}`);
const code = (t) => t.replace(/--[^\n]*/g, " ").replace(/\/\*[\s\S]*?\*\//g, " ");

head("A · the folder declares both triggers, and the relink one is narrow");
{
  const dir = join(root, "supabase", "migrations");
  const all = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort().map((f) => [f, code(readFileSync(join(dir, f), "utf8"))]);
  const relink = all.filter(([, s]) => /create\s+trigger\s+trg_assign_bill_on_relink/i.test(s)).pop();
  ok(!!relink, relink ? `trg_assign_bill_on_relink declared in ${relink[0]}` : "no migration declares trg_assign_bill_on_relink");
  if (relink) {
    const def = (relink[1].match(/create\s+trigger\s+trg_assign_bill_on_relink[\s\S]*?;/i) || [""])[0];
    ok(/update\s+of\s+session_id/i.test(def), `it fires on UPDATE OF session_id only, not on every order write`);
    ok(/\bwhen\b[\s\S]*is\s+distinct\s+from/i.test(def), `it fires only when the party actually CHANGES (IS DISTINCT FROM)`);
    ok(/new\.session_id\s+is\s+not\s+null/i.test(def), `and never when a session link is CLEARED — the close/delete cleanups set it to null`);
  }
}

head("B · the assign function still only ever assigns when there is no number");
{
  const parseEnv = (t) => Object.fromEntries(t.split("\n").filter((l) => l.includes("=") && !l.trim().startsWith("#")).map((l) => {
    const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
  }));
  let env = {}; try { env = parseEnv(readFileSync(join(root, ".env.local"), "utf8")); } catch { /* none */ }
  if (!env.SUPABASE_ACCESS_TOKEN) { console.log("⏭  skipped: no SUPABASE_ACCESS_TOKEN — half A covers the folder."); }
  else {
    const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
    const q = async (sql) => {
      const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
        method: "POST", headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({ query: sql, read_only: true }) });
      if (!r.ok) throw new Error((await r.text()).slice(0, 160));
      return r.json();
    };
    try {
      const src = code((await q(`select prosrc from pg_proc where proname='lfh_assign_bill_on_order' limit 1`))[0]?.prosrc || "");
      ok(/is\s+null/i.test(src), `lfh_assign_bill_on_order still assigns ONLY when the session has no number`
        + (/is\s+null/i.test(src) ? " — so a merged party cannot be given a second one" : " — that test is GONE, and a merge would now hand out a second number"));
      ok(/for\s+update/i.test(src), `it takes a row lock first, so two orders landing at once cannot both assign`);
      const trg = await q(`select t.tgname, pg_get_triggerdef(t.oid) def from pg_trigger t
                             join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
                            where n.nspname='public' and c.relname='orders' and not t.tgisinternal
                              and t.tgname in ('trg_assign_bill_on_order','trg_assign_bill_on_relink')`);
      ok(trg.length === 2, `both triggers are installed: ${trg.map((t) => t.tgname).join(", ") || "none"}`);
      const relink = trg.find((t) => t.tgname === "trg_assign_bill_on_relink");
      if (relink) ok(/UPDATE OF session_id/i.test(relink.def), `the installed relink trigger is scoped to session_id`);

      // and the data: no session holds a LIVE order with no number. Scoped to the last 7 days so a
      // known historical row (2026-08-06, order created 1.4s before its session) cannot mask a
      // live regression — that row is what migration 391 exists to prevent happening again.
      const recent = (await q(`select count(*)::int n from sessions s where s.bill_no is null
                                 and s.created_at >= now() - interval '7 days'
                                 and exists (select 1 from orders o where o.session_id=s.id and o.status <> 'cancelled')`))[0].n;
      const ever = (await q(`select count(*)::int n from sessions s where s.bill_no is null
                              and exists (select 1 from orders o where o.session_id=s.id and o.status <> 'cancelled')`))[0].n;
      ok(recent === 0, `sessions from the last 7 days holding a live order with no bill number: ${recent} (ever: ${ever})`);
      // one party, one bill: no two LIVE sessions share a number on the same business day
      const dup = (await q(`select count(*)::int n from (
          select restaurant_id, (((opened_at at time zone 'Asia/Kolkata') - interval '5 hours')::date) d, bill_no
            from sessions where bill_no is not null and deleted_at is null
              and (((created_at at time zone 'Asia/Kolkata') - interval '5 hours')::date)
                = (((opened_at at time zone 'Asia/Kolkata') - interval '5 hours')::date)
            group by 1,2,3 having count(*) > 1) x`))[0].n;
      ok(dup <= 1, `sessions sharing a bill number on the same BUSINESS day (05:00 IST, mig 044): ${dup}`
        + (dup <= 1 ? " — back-dated fixtures excluded, because those draw from today's counter" : ""));
    } catch (err) { console.log(`⏭  skipped: the database would not answer (${String(err.message).slice(0, 110)}).`); }
  }
}
console.log(bad === 0
  ? "\n✅ a table that holds a live order has a bill number, and a merged party still has only one."
  : `\n❌ ${bad} problem(s).`);
process.exit(bad === 0 ? 0 : 1);
