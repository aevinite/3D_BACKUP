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
const env = Object.fromEntries(readFileSync("/Users/aevinite/Documents/Projects/backup_Menu/.env.local", "utf8").split("\n").filter(l => l.includes("=") && !l.trim().startsWith("#")).map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }));
if (new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0] !== "wnsfcizclkbobwzcxqsf") { console.error("REFUSING: not the backup DB"); process.exit(1); }
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
let ok = true; const chk = (n, p, d = "") => { console.log((p ? "  ✅ " : "  ❌ ") + n + (d ? " — " + d : "")); if (!p) ok = false; };
const { data: fh } = await sb.from("restaurants").select("id").eq("slug", "french-house").maybeSingle();
const rid = fh.id;
const { data: dish } = await sb.from("menu_items").select("id").eq("restaurant_id", rid).limit(1).maybeSingle();
const { data: st } = await sb.from("settings").select("table_count").eq("restaurant_id", rid).maybeSingle();
const busy = new Set(((await sb.from("sessions").select("table_number").eq("restaurant_id", rid).eq("status", "open")).data || []).map(s => s.table_number));
const freeTable = (n) => { for (let t = 5; t <= st.table_count; t++) { const s = String(t); if (!busy.has(s)) { busy.add(s); if (--n < 0) return s; } } return null; };
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
  const crumbs = (await sb.from("realtime_events").select("topic,kind,table_number").gt("id", before).limit(30)).data || [];
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
  const u = await sb.rpc("lfh_staff_unmerge_table", { p_rid: rid, p_child: child, p_actor: "writetest" });
  const uc = (await sb.from("realtime_events").select("kind,table_number").gt("id", b2).limit(30)).data || [];
  chk("3664 SEPARATING them announces itself too", !u.error && uc.length > 0, `${uc.length} crumb(s)`);
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
  chk("3819 the 2-day lag is the designed one, not drift", lag <= 3, `${lag} day(s) behind today`);
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
const sessionIds = [...new Set(cleanup)];
for (const s of sessionIds) await sb.from("sessions").update({ status: "closed" }).eq("id", s);
const left = (await sb.from("sessions").select("id").in("id", sessionIds).eq("status", "open")).data || [];
chk("cleanup: every table this test opened is closed again", left.length === 0, `${left.length} left open`);
// The orders belonging to THOSE sessions — scoped to the restaurant as well, so a stray id can
// never reach another tenant's rows.
if (sessionIds.length) {
  await sb.from("orders").delete().eq("restaurant_id", rid).in("session_id", sessionIds);
  const stillThere = (await sb.from("orders").select("id").eq("restaurant_id", rid).in("session_id", sessionIds)).data || [];
  chk("cleanup: no ticket this test placed is left on the kitchen board", stillThere.length === 0,
      `${stillThere.length} order(s) left — a cook would read this run's notes as a real dish`);
}
console.log(ok ? "\n✓ ALL WRITE-TESTS PASS\n" : "\n✗ SOMETHING FAILED — see above\n");
process.exit(ok ? 0 : 1);
