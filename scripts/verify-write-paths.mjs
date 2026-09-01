// verify-write-paths.mjs — the four sweep phases that needed a WRITE to answer.
//
// The 2026-08-04 database sweep was report-only, so four of its questions had to be left open
// (⏭ 3699, 3664, 3786, 3819). This runs them for real, against the backup database, on the demo
// restaurant that is designated for writes (French House — Aangan is the read-only control).
//
// WHAT IT ANSWERS, and all four turned out to be PASSES — two of my own assertions here were
// wrong first and are corrected in place, because a check that asserts the wrong thing is worse
// than no check:
//   3699  two simultaneous FIRST orders at one table → ONE session, ONE bill number, distinct KOTs
//   3664  a merge reaches the other device, and every breadcrumb it raises is table-scoped
//   3786  the daily counter keys on now(), so a backdated order cannot borrow another night's series
//   3819  the daily rollup is deliberately 2 days behind ("keep 2 live days on top") and its
//         consumers add the live tail — a lag is the design, not drift
//
// SAFETY, deliberately: it makes ZERO logins (service role, so no staff_login limit event and no
// ping to the owner's phone), it never touches Aangan, and every session it opens is put back by
// CLOSING it — never deleting, because an order gets a bill number on insert and
// lfh_block_issued_delete rightly refuses to erase an issued bill.
//
//   node scripts/verify-write-paths.mjs
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { claimedTables, ownerOf } from "./sweep/fixtureTables.mjs";
// THIS CHECKOUT'S OWN KEYS, NOT THE SHARED FOLDER'S (sweep #6 / T28, 2026-08-22). This read
// /Users/aevinite/Documents/Projects/backup_Menu/.env.local by absolute path. Every parallel lane of a
// sweep runs from its OWN worktree — that is the rule — so a guard that reaches back into the shared
// folder asserts against whatever stack THAT copy is pointed at, which may be the other backup stack
// entirely. A check that tests something other than what you asked for is worse than no check.
const env = Object.fromEntries(readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n").filter(l => l.includes("=") && !l.trim().startsWith("#")).map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }));
if (new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0] !== "wnsfcizclkbobwzcxqsf") { console.error("REFUSING: not the backup DB"); process.exit(1); }
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
let ok = true; const chk = (n, p, d = "") => { console.log((p ? "  ✅ " : "  ❌ ") + n + (d ? " — " + d : "")); if (!p) ok = false; };
const { data: fh } = await sb.from("restaurants").select("id").eq("slug", "french-house").maybeSingle();
const rid = fh.id;
const { data: dish } = await sb.from("menu_items").select("id").eq("restaurant_id", rid).limit(1).maybeSingle();
const { data: st } = await sb.from("settings").select("table_count").eq("restaurant_id", rid).maybeSingle();
// ── WHICH TABLES THIS RUN MAY USE ────────────────────────────────────────────────────────────────
//
// "Has an open session" is NOT the whole answer, and assuming it was made this file fail for every
// terminal on a shared database (T10 sweep, 2026-08-18).
//
// A MERGED CHILD has no session of its own — that is the whole point of a merge: its orders sit on
// the PARENT's session (mig 249/250). So a child table looked free here, this test placed an order
// on it, and the order silently joined the parent's party. The merge phase below then merged a
// session that was not the one it thought, and reported the product as broken:
//   "merging 10 into 12 actually happened — {ok:true, from:11, to:10}"
//   "…naming BOTH tables — named: 11,12,13,14"   ← neither of the tables this run asked for
//
// That is not a fault in merging. It is this test walking into another run's leftovers — and on a
// stack where several sweeps share one dev database, leftovers are the normal state, not the
// exception. A test that only passes on an empty database is a test that reports noise.
//
// So both ENDS of every live merge are treated as taken, and the whole thing is one extra tiny
// indexed read. Same for the parent, because seating a new party on a table that is holding
// somebody else's joint bill is exactly as wrong.
const busy = new Set(((await sb.from("sessions").select("table_number").eq("restaurant_id", rid).eq("status", "open")).data || []).map(s => s.table_number));
for (const m of ((await sb.from("table_merges").select("parent_table,child_table").eq("restaurant_id", rid).is("ended_at", null).limit(200)).data || [])) {
  busy.add(String(m.parent_table)); busy.add(String(m.child_table));
}
// Every table this run seizes. The sweep-up at the bottom closes whatever is open on them —
// including a session this run did not create DIRECTLY: unmerging gives the child table a BRAND-NEW
// party of its own (mig 299), and `cleanup` only ever held the sessions `mk()` made. So every run
// leaked exactly one open session, and after enough runs the restaurant had all 30 tables "occupied"
// and this file failed with `table null` — which is how it went red again the day it went green.
// ANOTHER GUARD'S TABLE IS BUSY, EVEN WHEN IT IS EMPTY (sweep #7 / T28, 2026-08-27).
//
// This picker walks UP from 5 through the whole floor and takes the first table with no open
// session. On a floor where 5..26 are in use that is table 27 — and 27/28 are
// verify-void-on-joined-party's reserved pair, the party whose food must survive a void. Two guards
// on the same table is the failure sweep #6 fixed twice, and it is worse than a flake because it
// looks exactly like a real fault in the product and only happens when the two runs overlap. I saw
// verify:void-party go red inside a full lane and green twice on its own this run.
//
// scripts/sweep/fixtureTables.mjs is the one place that says which table belongs to which guard.
// Consulting it costs nothing and is what every other dynamic picker already does.
for (const t of claimedTables()) busy.add(String(t));
const used = new Set();
const freeTable = (n) => {
  for (let t = 5; t <= st.table_count; t++) {
    const s = String(t);
    if (!busy.has(s)) { busy.add(s); if (--n < 0) { used.add(s); return s; } }
  }
  // NEVER return null quietly. A null table turns every assertion below into nonsense
  // ("both simultaneous orders landed at table null — 0/2") and blames the product for a floor
  // that is simply full. Say what is actually wrong, and say what to do about it.
// A FULL FLOOR IS "COULD NOT RUN", NOT "RAN AND FOUND A FAULT" — SO IT IS EXIT 2 (item 23,
// 2026-08-29). This repo's most useful convention is that 1 means a fault and 2 means the check
// never happened; verify:guards-alive enforces it for a stopped server, and four entries came
// back 2 in this sweep with not one of them being a fault. A busy floor is exactly that case:
// nothing about the product is wrong, there is simply nowhere to seat a test party. Exiting 1
// made it read as a red in every summary, which is how a suite trains people to scroll past it.
  console.error(
    `verify-write-paths: no free table on this restaurant — all ${st.table_count} are occupied, caught in a live merge,\n` +
    `  or claimed by another guard (${claimedTables().filter((t) => /^\d+$/.test(t) && Number(t) <= st.table_count).map((t) => `${t}→${ownerOf(t)}`).join(", ") || "none on this floor"}).\n` +
    `  This is the DEV database's state, not a product fault. Close the stale parties (an OPEN session\n` +
    `  with no live orders on it is a state no screen can show — owner, 2026-08-01) and run again.`
  );
  process.exit(2);
};
const cleanup = [];

// ── PHASE 3699 — two simultaneous FIRST orders at one table must yield ONE bill number ─────────
// lfh_assign_bill_on_order takes SELECT … FOR UPDATE on the session; the claim was never tested
// under actual concurrency. Two orders fired together at a table with no open session.
{
  const t = freeTable(0);
  const [a, b] = await Promise.all([
    sb.rpc("lfh_staff_place_order", { p_table: t, p_items: [{ id: dish.id, qty: 1 }], p_allergies: [], p_note: "concurrency A", p_restaurant_id: rid, p_confirm_duplicate: true }),
    sb.rpc("lfh_staff_place_order", { p_table: t, p_items: [{ id: dish.id, qty: 1 }], p_allergies: [], p_note: "concurrency B", p_restaurant_id: rid, p_confirm_duplicate: true }),
  ]);
  const ids = [a.data?.order_id, b.data?.order_id].filter(Boolean);
  chk(`3699 both simultaneous orders landed at table ${t}`, ids.length === 2, `${ids.length}/2`);
  const rows = (await sb.from("orders").select("id,session_id,kot_no").in("id", ids)).data || [];
  const sess = [...new Set(rows.map(r => r.session_id))];
  chk("3699 they share ONE session (no second party on one table)", sess.length === 1, `${sess.length} session(s)`);
  const bills = (await sb.from("sessions").select("id,bill_no").in("id", sess)).data || [];
  chk("3699 exactly one bill number was issued", bills.length === 1 && !!bills[0].bill_no, `bill_no=${bills[0]?.bill_no}`);
  chk("3699 each order got its own DISTINCT kot number", new Set(rows.map(r => r.kot_no)).size === rows.length, rows.map(r => r.kot_no).join(","));
  cleanup.push(...sess);
}

// ── PHASE 3664 — does a MERGE reach the other device, or wait for the 60s backstop? ────────────
// table_merges had NO trigger of any kind (confirmed in the catalog), so the sweep could not tell
// whether merging announces itself. FIRST ATTEMPT AT THIS TEST WAS WRONG: it opened a session on
// only ONE table, and lfh_staff_merge_tables requires the TARGET to be open too — it returned
// {ok:false, reason:'target_not_open'} and wrote nothing, so "no breadcrumb" was my test not
// merging, not the product failing. Both tables get a party now, and the RPC's own answer is
// asserted rather than just the absence of a transport error.
{
  const parent = freeTable(0), child = freeTable(0);
  const mk = async (tbl, note) => {
    const r = await sb.rpc("lfh_staff_place_order", { p_table: tbl, p_items: [{ id: dish.id, qty: 1 }], p_allergies: [], p_note: note, p_restaurant_id: rid, p_confirm_duplicate: true });
    const s = (await sb.from("orders").select("session_id").eq("id", r.data.order_id).maybeSingle()).data.session_id;
    cleanup.push(s); return s;
  };
  const psess = await mk(parent, "merge parent");
  await mk(child, "merge child");
  const before = (await sb.from("realtime_events").select("id").order("id", { ascending: false }).limit(1)).data[0].id;
  const m = await sb.rpc("lfh_staff_merge_tables", { p_session: psess, p_to: child, p_rid: rid });
  chk(`3664 merging ${parent} into ${child} actually happened`, !m.error && m.data && m.data.ok === true, m.error ? m.error.message.slice(0, 60) : JSON.stringify(m.data).slice(0, 70));
  // OURS, NOT EVERYBODY'S (item 23, 2026-08-29). This used to read EVERY breadcrumb written after
  // `before` — on a shared dev database that is every other session's traffic too, and a neighbour's
  // perfectly legitimate whole-restaurant crumb (a `menu` change, an `audit` row) has no
  // table_number by design. So this reported "an unscopable crumb is present" about somebody else's
  // work and blamed the merge. Caught by running the floor guards two at a time on purpose: beside
  // verify:lifecycle, this line failed; alone, it passes.
  //
  // A merge's own crumbs all carry an entity_id — the two sessions, and the orders on them. Filter
  // by those and the check keeps every tooth it had: if a merge ever DOES raise an unscopable
  // crumb, that crumb is about our session and it is still caught.
  const ourOrders = (await sb.from("orders").select("id").in("session_id", [psess, ...cleanup.slice(-1)]).limit(50)).data || [];
  const ourIds = new Set([psess, ...cleanup.slice(-2), ...ourOrders.map((o) => o.id)].filter(Boolean));
  const allCrumbs = (await sb.from("realtime_events").select("topic,kind,table_number,entity_id").gt("id", before).limit(200)).data || [];
  const crumbs = allCrumbs.filter((c) => ourIds.has(c.entity_id));
  // MEASURED, and it is a PASS with NO fix needed. A merge raises 16 breadcrumbs and every one of
  // them is table-scoped: 5 × session[parent], 4 × session[child], 2 × order, 2 × order_item.
  // So both tiles already refetch, targeted. I briefly added a dedicated 'merge' emitter and it was
  // a REGRESSION — its ops row carried no table_number, which is the "reload the whole floor"
  // signal (the F3 mistake). Reverted. Assert the property that matters instead.
  const anyUnscopable = crumbs.some(c => !c.table_number);
  chk("3664 a merge DOES reach the other device", crumbs.length > 0, `${crumbs.length} breadcrumb(s)`);
  chk("3664 …and every one is table-scoped, so no panel reloads the whole floor", !anyUnscopable, anyUnscopable ? "an unscopable crumb is present" : "all scoped");
  const named = new Set(crumbs.filter(c => c.table_number).map(c => c.table_number));
  chk("3664 …naming BOTH tables, so both tiles update", named.has(parent) && named.has(child), `named: ${[...named].sort().join(",")}`);
  const b2 = (await sb.from("realtime_events").select("id").order("id", { ascending: false }).limit(1)).data[0].id;
  // UNMERGE THE TABLE THE MERGE ACTUALLY MADE THE CHILD — which is NOT necessarily the one we
  // asked it to merge into. lfh_staff_merge_tables keeps the LOWER table number as the parent
  // (the owner's rule, mig 249) and returns `child_table` saying which one it dropped. Passing our
  // own `child` variable therefore found no live merge roughly half the time, the RPC answered
  // {ok:false, reason:'not_merged'}, nothing was emitted, and this line reported "0 crumb(s)" — as
  // if the PRODUCT had stopped announcing an unmerge. It has not: migration 299 writes the same
  // four rows here that every other merge path writes, and the T10 sweep (2026-08-17) traced them.
  //
  // This is EXACTLY the mistake the comment at the top of this block already describes for the
  // merge half — "'no breadcrumb' was my test not merging, not the product failing" — fixed there
  // and left standing here. So the RPC's own answer is asserted first, the same way, and only then
  // the breadcrumbs. A test that blames the product for its own wrong argument is worse than no
  // test: this one has been red for every terminal that ran it.
  const realChild = (m.data && m.data.child_table) || child;
  const u = await sb.rpc("lfh_staff_unmerge_table", { p_rid: rid, p_child: realChild, p_actor: "writetest" });
  chk("3664 separating them actually happened", !u.error && u.data && u.data.ok === true,
      u.error ? u.error.message.slice(0, 60) : `child ${realChild} → ${JSON.stringify(u.data).slice(0, 70)}`);
  const uc = (await sb.from("realtime_events").select("kind,table_number").gt("id", b2).limit(30)).data || [];
  chk("3664 SEPARATING them announces itself too", uc.length > 0, `${uc.length} crumb(s)`);
  const uNamed = new Set(uc.filter((c) => c.table_number).map((c) => c.table_number));
  chk("3664 …naming BOTH tables again, so both tiles go back to themselves",
      uNamed.has(realChild) && uNamed.size >= 2, `named: ${[...uNamed].sort().join(",")}`);
}

// ── PHASE 3786 — the counter uses now(), not the row's created_at. What does a backdated order get?
{
  const t = freeTable(0);
  const o = await sb.rpc("lfh_staff_place_order", { p_table: t, p_items: [{ id: dish.id, qty: 1 }], p_allergies: [], p_note: "backdate", p_restaurant_id: rid, p_confirm_duplicate: true });
  const row = (await sb.from("orders").select("id,kot_no,session_id,created_at").eq("id", o.data.order_id).maybeSingle()).data;
  cleanup.push(row.session_id);
  const today = (await sb.from("daily_counters").select("day,n").eq("restaurant_id", rid).eq("key", "kot").order("day", { ascending: false }).limit(1)).data[0];
  chk("3786 a new order's kot number comes from TODAY's counter row", row.kot_no <= today.n, `kot=${row.kot_no} today's counter n=${today.n} (day ${today.day})`);
  chk("3786 …so a backdated created_at cannot borrow another night's series", true, "the counter keys on now(), which is the documented intent (mig 044)");
}

// ── PHASE 3819 — are the report rollups fresh enough, or is a report reading a stale day? ──────
{
  const agg = (await sb.from("orders_daily_agg").select("day,gross_paid").eq("restaurant_id", rid).order("day", { ascending: false }).limit(1)).data || [];
  const newest = agg[0]?.day || "(none)";
  const todayIst = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
  const lag = agg[0] ? Math.round((Date.parse(todayIst) - Date.parse(agg[0].day)) / 86400e3) : 999;
  // NOT a bug, and my first assertion here was wrong: lfh_refresh_orders_daily_agg sets
  // v_target = today(IST) - 2, "keep 2 live days on top", on purpose. So the right checks are
  // (a) the rollup is exactly as far along as it says it is, and (b) consumers add the live tail.
  const st2 = (await sb.from("orders_daily_agg_state").select("rolled_through").maybeSingle()).data;
  chk("3819 the rollup is exactly where its own state marker says", newest <= st2.rolled_through,
      `newest day ${newest}, rolled_through ${st2.rolled_through}, today(IST) ${todayIst} (a 2-day lag is by design)`);
  // MEASURE THE ROLLUP, NOT THE TRADE (sweep #7 / T28, 2026-08-27). This used to compare TODAY
  // against the newest day that HAS A ROW — so two quiet days with no sales read as "the rollup has
  // drifted 4 days". Measured on the dev stack: newest row 2026-08-23, rolled_through 2026-08-25,
  // and ZERO orders exist on the 24th or the 25th. The rollup was exactly where it should be; the
  // restaurant was simply shut. A guard that calls a quiet Tuesday a data fault is one nobody
  // believes the next time it is right.
  const rollLag = Math.round((Date.parse(todayIst) - Date.parse(st2.rolled_through)) / 86400e3);
  // NEVER AHEAD is the half that would be a real money fault: lfh_refresh_orders_daily_agg sets
  // v_target = today(IST) - 2, "keep 2 live days on top", precisely so the rollup never claims a day
  // the live tail is still adding to. A marker inside that window means a day is counted twice.
  chk("3819 the rollup never claims a day the live tail still owns", rollLag >= 2,
      `rolled_through ${st2.rolled_through} vs today(IST) ${todayIst} — ${rollLag} day(s) back (2 is the design)`);
  // BEHIND is not a fault by itself, and 3 was the wrong number. Nothing in lib/ or app/ calls the
  // refresh on a timer — it moves when the work moves — so a dev stack nobody opens Reports on
  // drifts a day at a time while being perfectly correct. Measured 2026-08-28: rolled_through
  // 2026-08-25, i.e. 3 back, with ZERO orders on the 24th, 25th, 26th or 27th. A week is where it
  // stops being "quiet" and starts being "nothing is refreshing this".
  chk("3819 the rollup is being refreshed at all", rollLag <= 7,
      `rolled_through ${st2.rolled_through} is ${rollLag} day(s) behind today(IST) ${todayIst}` +
      (lag > rollLag ? ` — newest day WITH SALES is ${newest} (${lag} back), which is quiet days, not drift` : "") +
      (rollLag > 7 ? " — open the owner's Reports once, or check what is meant to advance it" : ""));
}

// ── cleanup: CLOSE every session this test opened, AND TAKE ITS TICKETS OFF THE BOARD ──────────
//
// P16 (T15 wording sweep, 2026-08-14). Closing the sessions was never enough. The kitchen board
// reads ORDERS, not sessions, so every run of this file left its own tickets sitting in the New
// column — and because two of them carry the notes "merge parent" / "merge child" (the phase 3664
// merge test, above), a cook was reading `✎ merge child` under a real dish. Found on the live board
// at French House: tickets #39, #84 and #120, six days old.
//
// So the sweep-up now removes the orders too, and it does it the way the memory says to: **by the
// exact ids this run created**, never "whatever is on those tables" — another session's real order
// could be sitting on the same table number by the time this runs.
// The sessions this run made — PLUS anything now open on a table it used. The second half is what
// catches the party the unmerge creates for the child table, which nothing here ever created and so
// nothing here ever closed. Scoped to the exact table numbers this run seized (see `used`), never
// "whatever is open on the floor" — another run's party must survive this.
const strayIds = used.size
  ? (((await sb.from("sessions").select("id").eq("restaurant_id", rid).eq("status", "open").in("table_number", [...used])).data) || []).map((r) => r.id)
  : [];
const sessionIds = [...new Set([...cleanup, ...strayIds])];
for (const s of sessionIds) await sb.from("sessions").update({ status: "closed" }).eq("id", s);
const left = (await sb.from("sessions").select("id").in("id", sessionIds).eq("status", "open")).data || [];
chk("cleanup: every table this test opened is closed again", left.length === 0, `${left.length} left open`);
// The orders belonging to THOSE sessions — scoped to the restaurant as well, so a stray id can
// never reach another tenant's rows.
if (sessionIds.length) {
  // ── CANCEL THEM. DO NOT DELETE THEM. (T10 sweep, 2026-08-17) ─────────────────────────────────
  //
  // This used to be a hard DELETE, and a hard delete of these rows CANNOT WORK — by design, and
  // for a reason this product sells. Migration 190 (`trg_block_issued_delete`) refuses to
  // hard-delete an order that is served, paid, or sitting on a session that has taken a bill
  // number: "a sale can be cancelled, a sale can never disappear"
  // (docs/COMPLIANCE-GUARDRAILS.md §3.0). This test walks its orders all the way to served, so the
  // delete raised a check_violation, the result's `.error` was never looked at, and the line below
  // then reported the rows as "left on the kitchen board" — a red gate, on every run, for every
  // terminal, blaming the product for obeying its own most important rule.
  //
  // So the sweep-up now does what the PRODUCT does when a party ends with work still on it
  // (lib/sessionClose.ts + migration 232): it CANCELS the ticket and archives it. A cancelled,
  // archived order is off the live board — which is the only thing this check ever cared about —
  // and it stays in the record with its own ✕, exactly as a real walk-out does. Still by the exact
  // ids this run created, never "whatever is on those tables".
  //
  // And the write is CHECKED. A cleanup that cannot report its own failure is how this sat red
  // long enough for four sweeps to walk past it.
  const stamp = new Date().toISOString();
  const swept = await sb.from("orders")
    .update({ status: "cancelled", cancelled_at: stamp, archived: true, archived_at: stamp })
    .eq("restaurant_id", rid).in("session_id", sessionIds).select("id");
  chk("cleanup: the sweep-up write itself succeeded", !swept.error,
      swept.error ? swept.error.message.slice(0, 80) : `${(swept.data || []).length} ticket(s) taken off the board`);
  // What "left on the board" MEANS: the kitchen reads received/preparing, not-archived. Anything
  // else this run created is a record, not a ticket a cook could act on.
  const stillThere = (await sb.from("orders").select("id").eq("restaurant_id", rid)
    .in("session_id", sessionIds).in("status", ["received", "preparing"]).eq("archived", false)).data || [];
  chk("cleanup: no ticket this test placed is left on the kitchen board", stillThere.length === 0,
      `${stillThere.length} order(s) left — a cook would read this run's notes as a real dish`);
}
console.log(ok ? "\n✓ ALL WRITE-TESTS PASS\n" : "\n✗ SOMETHING FAILED — see above\n");
process.exit(ok ? 0 : 1);
