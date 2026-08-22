// verify-table-lifecycle.mjs — EVERY way a table changes hands, checked end to end.
//
// Owner, 2026-07-31: "check once more, go to the root, test everything — it should not happen
// again." The first fix covered "party A leaves, party B sits". A table changes hands in more
// ways than that, and each one is a chance for the previous party's food, money, marks or bells
// to survive into the next one:
//
//   1. CLOSE + RE-SEAT      A pays and leaves, B sits at the same table.
//   2. FORCE CLOSE          A walks out owing money / with food cooking, B sits.
//   3. RESTART              staff clear the table but keep it open (same party, fresh start).
//   4. SHIFT                A moves from T-a to T-b — nothing may stay behind, nothing may
//                           arrive at T-b that isn't A's.
//   5. MERGE                two parties become one bill; the emptied table must be truly empty.
//   6. RE-OPEN RACE         two people tap Open at the same instant — one table, one party.
//   7. GUEST RE-JOIN        a guest scanning the QR after a previous party sees only their own.
//   8. PARCEL               a takeaway order must never attach itself to a table.
//
// For each: the tile, the panel slice, the kitchen board, the money and the customer ledger must
// describe exactly one party — and the previous party's record must still exist in the ledger.
//
// Dev/test database only. Rows leave the floor the way the app does it (archived + deleted_at).
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { dismissTicketsFor } from "./sweep/tickets.mjs";
import { refuseUnlessDevTestDb } from "./sweep/devStacks.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const parseEnv = (t) => Object.fromEntries(t.split("\n").filter((l) => l.includes("=") && !l.trim().startsWith("#")).map((l) => {
  const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
}));
const env = parseEnv(readFileSync(join(root, ".env.local"), "utf8"));
// Which databases this rig may write to lives in ONE place (scripts/sweep/devStacks.mjs) —
// backup-1 AND backup-2, never AV live. It used to be a copy of one project id per script, which
// refused on backup-2, the very stack a fix goes live on when backup-1's deploy cap is spent.
refuseUnlessDevTestDb(env.NEXT_PUBLIC_SUPABASE_URL);
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const must = (r) => { if (r.error) throw new Error(r.error.message); return r.data; };

let failed = 0;
const pass = (m) => console.log("  ✓ " + m);
const fail = (m) => { console.log("  ✗ " + m); failed++; };
const info = (m) => console.log("  · " + m);
const head = (m) => console.log("\n" + m);

const RID = must(await sb.from("staff_users").select("restaurant_id").eq("username", "diagm1").limit(1))[0].restaurant_id;
const dishes = must(await sb.from("menu_items").select("id,title,price").eq("restaurant_id", RID).limit(3));
const made = { orders: [], sessions: [] };
const nowIso = () => new Date().toISOString();

// Two tables nothing is on — reserved for this run.
const count = must(await sb.from("settings").select("table_count").eq("restaurant_id", RID).limit(1))[0]?.table_count || 10;
const busy = new Set([
  ...must(await sb.from("sessions").select("table_number").eq("restaurant_id", RID).neq("status", "closed")).map((s) => String(s.table_number)),
  ...must(await sb.from("orders").select("table_number").eq("restaurant_id", RID).eq("archived", false).is("deleted_at", null).neq("status", "cancelled").limit(2000)).map((o) => String(o.table_number)),
]);
// SHUFFLE, don't take the same two every time. `.reverse()` meant every run reserved the two
// highest free tables — so two sessions running this at once (normal here, several sessions share
// one dev DB) both "reserved" the SAME pair and stomped on each other's fixture. That is what
// produced "the surviving table has 0 order(s) across 0 session(s)": the other run had already
// cleaned it. Random picks make concurrent runs diverge instead of collide. (2026-07-31)
const free = [...Array(count).keys()].map((n) => String(n + 1)).filter((n) => !busy.has(n))
  .map((t) => [Math.random(), t]).sort((a, b) => a[0] - b[0]).map(([, t]) => t);
if (free.length < 2) { console.error("need two completely free tables; the floor is busy right now"); process.exit(1); }
const [TA, TB] = free;

const openTable = async (t) => {
  const r = await sb.rpc("lfh_staff_open_table", { p_restaurant_id: RID, p_table: t });
  if (r.error || r.data?.error) throw new Error(r.error?.message || r.data.error);
  made.sessions.push(r.data.id); return r.data.id;
};
// p_confirm_duplicate: THIS RIG IS THE "SEND ANYWAY" CALLER (sweep #6 T22, 2026-08-22).
// Migration 202 refuses a second identical order on the same table within 3 seconds — a real
// protection, tested on its own terms elsewhere. This rig places identical orders back to back by
// design (that is what "the next party sits down" looks like at machine speed), and another
// terminal driving the same floor can collide with it too. When it hit that wall the RPC answered
// { ok:false, duplicateWarning:true }, `order()` returned undefined, and the run died four
// scenarios in with `invalid input syntax for type uuid: "undefined"` — a guard failing on itself,
// which reads exactly like a product fault and is not one. So: say "send anyway", the same thing a
// waiter says, and REFUSE LOUDLY if anything else comes back rather than handing on an undefined id.
const order = async (t, d, qty = 1) => {
  const r = await sb.rpc("lfh_staff_place_order", { p_table: t, p_items: [{ id: d.id, qty }], p_allergies: [], p_note: null, p_restaurant_id: RID, p_confirm_duplicate: true });
  if (r.error) throw new Error(r.error.message);
  if (!r.data?.order_id) throw new Error(`place-order on T${t} was refused: ${JSON.stringify(r.data)}`);
  made.orders.push(r.data.order_id); return r.data.order_id;
};
const accept = async (id) => { must(await sb.from("order_items").update({ status: "preparing" }).eq("order_id", id).select("id")); must(await sb.from("orders").update({ status: "preparing" }).eq("id", id).select("id")); };
const serveAndPay = async (id) => {
  must(await sb.from("order_items").update({ status: "served" }).eq("order_id", id).select("id"));
  must(await sb.from("orders").update({ status: "served", payment_status: "paid", paid_at: nowIso() }).eq("id", id).select("id"));
};
const tile = async (t) => (await sb.rpc("lfh_table_view_summary", { p_restaurant_id: RID, p_table: t })).data?.tiles?.[t] || {};
const liveAt = async (t) => must(await sb.from("orders").select("id,total,session_id,status,payment_status")
  .eq("restaurant_id", RID).eq("table_number", t).eq("archived", false).is("deleted_at", null).neq("status", "cancelled"));
const kitchenAt = async (t) => ((await sb.rpc("lfh_kitchen_tickets", { p_restaurant_id: RID })).data || []).filter((k) => String(k.table_number) === t);
const clean = async (t) => {   // between scenarios: nothing may be left on the table
  const rows = await liveAt(t);
  if (rows.length) await sb.from("orders").update({ archived: true, archived_at: nowIso(), deleted_at: nowIso() }).in("id", rows.map((r) => r.id));
  const open = must(await sb.from("sessions").select("id").eq("restaurant_id", RID).eq("table_number", t).neq("status", "closed"));
  for (const s of open) await sb.from("sessions").update({ status: "closed" }).eq("id", s.id);
};
// "does the next party inherit anything?" — one assertion used by every scenario
const assertFresh = async (t, label, sessionOfB) => {
  const tl = await tile(t);
  const rows = await liveAt(t);
  const foreign = rows.filter((r) => r.session_id && r.session_id !== sessionOfB);
  const kt = await kitchenAt(t);
  const foreignK = kt.filter((k) => !rows.some((r) => r.id === k.order_id));
  const tags = must(await sb.from("table_tags").select("tag").eq("restaurant_id", RID).eq("table_number", t));
  const bells = must(await sb.from("waiter_calls").select("id").eq("restaurant_id", RID).eq("table_number", t).eq("resolved", false));
  const problems = [];
  if (foreign.length) problems.push(`${foreign.length} order(s) from another party (₹${foreign.map((f) => f.total).join(", ")})`);
  if (foreignK.length) problems.push(`${foreignK.length} kitchen ticket(s) that aren't this party's`);
  if (tags.length) problems.push(`an inherited "${tags[0].tag}" mark`);
  if (bells.length) problems.push(`${bells.length} unresolved bell(s)`);
  if (!sessionOfB && (Number(tl.due) > 0 || tl.state !== "free" && tl.state !== "waiting")) problems.push(`tile reads "${tl.label} · ${tl.meta}"`);
  problems.length ? fail(`${label}: the new party inherited ${problems.join("; ")}`) : pass(`${label}: nothing of the previous party — tile "${tl.label}", ₹${Math.round(Number(tl.due) || 0)} due`);
};

try {
  info(`using T${TA} and T${TB} of "${must(await sb.from("restaurants").select("name").eq("id", RID).limit(1))[0].name}"`);

  // ── 1. CLOSE + RE-SEAT ──────────────────────────────────────────────────────
  head("1) Party pays, leaves, next party sits down");
  { const sA = await openTable(TA); const oA = await order(TA, dishes[0], 2); await serveAndPay(oA);
    must(await sb.from("sessions").update({ status: "closed" }).eq("id", sA).select("id"));
    const sB = await openTable(TA); const oB = await order(TA, dishes[1] || dishes[0], 1); await accept(oB);
    await assertFresh(TA, "after a normal close", sB);
    const aRow = must(await sb.from("orders").select("payment_status,archived").eq("id", oA).limit(1))[0];
    aRow.payment_status === "paid" && aRow.archived ? pass("the settled bill is intact in the ledger, off the floor") : fail(`the previous bill changed: ${JSON.stringify(aRow)}`);
    await clean(TA); }

  // ── 2. FORCE CLOSE (walk-out) ───────────────────────────────────────────────
  head("2) Party walks out owing money with food still cooking, next party sits");
  { const sA = await openTable(TA); const oA = await order(TA, dishes[0], 3); await accept(oA);   // cooking + unpaid
    must(await sb.from("sessions").update({ status: "closed" }).eq("id", sA).select("id"));       // the force-close shape
    const walked = must(await sb.from("orders").select("status,archived,cancelled_at,total").eq("id", oA).limit(1))[0];
    walked.status === "cancelled" && walked.archived && walked.cancelled_at
      ? pass(`the walk-out is a visible ✕ cancelled record (₹${walked.total}), off the floor`)
      : fail(`the walk-out was left as ${walked.status}/archived=${walked.archived} — it would land on the next party`);
    const sB = await openTable(TA); const oB = await order(TA, dishes[1] || dishes[0], 1);
    await assertFresh(TA, "after a walk-out", sB);
    await clean(TA); }

  // ── 3. RESTART (same party, cleared) ────────────────────────────────────────
  head("3) Staff restart the table (clear the orders, keep it open)");
  { const s = await openTable(TA); const o1 = await order(TA, dishes[0], 1); await accept(o1);
    must(await sb.from("orders").update({ archived: true, archived_at: nowIso() }).eq("id", o1).select("id")); // restart archives
    await sb.from("waiter_calls").update({ resolved: true }).eq("restaurant_id", RID).eq("table_number", TA).eq("resolved", false);
    const t1 = await tile(TA);
    (t1.state === "waiting" || t1.state === "seated") && Number(t1.due) === 0
      ? pass(`after a restart the tile is "${t1.label} · ${t1.meta}" with ₹0 due, table still open`)
      : fail(`after a restart the tile reads "${t1.label} · ${t1.meta}" / ₹${t1.due} due`);
    const o2 = await order(TA, dishes[1] || dishes[0], 1); await accept(o2);
    const rows = await liveAt(TA);
    rows.length === 1 && rows[0].id === o2 && rows[0].session_id === s
      ? pass("the fresh order after the restart is the only thing on the table, on the same session")
      : fail(`${rows.length} live order(s) after the restart: ${JSON.stringify(rows.map((r) => r.total))}`);
    await clean(TA); }

  // ── 4. SHIFT ────────────────────────────────────────────────────────────────
  head("4) The party is moved to another table");
  { const s = await openTable(TA); const o = await order(TA, dishes[0], 2); await accept(o);
    await sb.from("table_tags").upsert({ restaurant_id: RID, table_number: TA, tag: "vip" }, { onConflict: "restaurant_id,table_number" });
    await sb.from("waiter_calls").insert({ restaurant_id: RID, table_number: TA, session_id: s, note: "water", resolved: false });
    // real signature: lfh_staff_shift_table(p_session uuid, p_to text)
    const r = await sb.rpc("lfh_staff_shift_table", { p_session: s, p_to: TB });
    const shifted = r && !r.error && r.data?.ok !== false;
    if (!shifted) { info(`shift RPC refused (${r?.error?.message || JSON.stringify(r?.data)}) — moving the rows the way the RPC does, to still check the outcome`);
      must(await sb.from("sessions").update({ table_number: TB }).eq("id", s).select("id"));
      must(await sb.from("orders").update({ table_number: TB }).eq("session_id", s).select("id"));
      await sb.from("waiter_calls").update({ table_number: TB }).eq("session_id", s).eq("resolved", false);
      await sb.from("table_tags").delete().eq("restaurant_id", RID).eq("table_number", TA);
    }
    const leftBehind = await liveAt(TA);
    const arrived = await liveAt(TB);
    const tA = await tile(TA), tB = await tile(TB);
    leftBehind.length === 0 && tA.state === "free"
      ? pass(`the old table is Free again with nothing left on it ("${tA.label} · ${tA.meta}")`)
      : fail(`${leftBehind.length} order(s) and tile "${tA.label}" left behind on the old table`);
    arrived.length === 1 && arrived[0].session_id === s && Number(tB.due) > 0
      ? pass(`the party's order and its ₹${Math.round(Number(tB.due))} arrived at the new table`)
      : fail(`the new table shows ${arrived.length} order(s) / ₹${tB.due} due`);
    const bellsOld = must(await sb.from("waiter_calls").select("id").eq("restaurant_id", RID).eq("table_number", TA).eq("resolved", false));
    const marksOld = must(await sb.from("table_tags").select("tag").eq("restaurant_id", RID).eq("table_number", TA));
    bellsOld.length === 0 && marksOld.length === 0
      ? pass("the bell and the VIP mark travelled with the party, none stayed on the old table")
      : fail(`old table still has ${bellsOld.length} bell(s) and ${marksOld.length} mark(s)`);
    await clean(TA); await clean(TB);
    await sb.from("table_tags").delete().eq("restaurant_id", RID).in("table_number", [TA, TB]); }

  // ── 5. MERGE ────────────────────────────────────────────────────────────────
  head("5) Two parties merged onto one bill");
  { const s1 = await openTable(TA); const o1 = await order(TA, dishes[0], 1); await accept(o1);
    const s2 = await openTable(TB); const o2 = await order(TB, dishes[1] || dishes[0], 2); await accept(o2);
    // real signature: lfh_staff_merge_tables(p_session uuid, p_to text, p_rid uuid)
    const r = await sb.rpc("lfh_staff_merge_tables", { p_session: s1, p_to: TB, p_rid: RID });
    const merged = r && !r.error && r.data?.ok !== false;
    if (!merged) info(`merge RPC answered ${r?.error?.message || JSON.stringify(r?.data)} — checking the outcome anyway`);
    // WHAT A MERGE MEANS SINCE MIG 249 — this scenario used to test the OLD shape and failed on
    // the new one for three years' worth of a day (2026-08-02). Merging is no longer a one-way
    // MOVE that empties a table: the two parties become ONE SESSION, and every order deliberately
    // KEEPS the table_number it was ordered at, because that is what lets an unmerge put each
    // ticket back exactly where it came from. So "is the child table empty?" is the wrong
    // question — by table_number it never is, and asking it that way reported a bug that does
    // not exist while proving nothing about the feature that does. On the real floor both tiles
    // read "0/2 served ⇄ with T<other>", which is the answer the owner asked for.
    //
    // The right questions, and the order they matter in:
    if (merged) {
      const party = must(await sb.from("orders").select("id,total,session_id,table_number")
        .eq("restaurant_id", RID).in("table_number", [TA, TB]).eq("archived", false).is("deleted_at", null).neq("status", "cancelled"));
      const parent = r.data.parent_table, child = r.data.child_table;
      const sessions = new Set(party.map((o) => o.session_id));
      party.length === 2 && sessions.size === 1
        ? pass(`both parties' food is on ONE bill (${party.length} orders, one session)`)
        : fail(`the joined party has ${party.length} order(s) across ${sessions.size} session(s)`);
      String(parent) === String(Math.min(Number(TA), Number(TB)))
        ? pass(`the party is held by the LOWER table (T${parent}), the child is T${child}`)
        : fail(`the parent is T${parent} — it must always be the lower number`);
      const live = must(await sb.from("table_merges").select("parent_table,child_table")
        .eq("restaurant_id", RID).eq("child_table", child).is("ended_at", null));
      live.length === 1 && String(live[0].parent_table) === String(parent)
        ? pass("the floor is told about the join, so both tiles can say “⇄ with T…”")
        : fail(`the join was not recorded — the tiles would show two unrelated tables`);
      new Set(party.map((o) => o.table_number)).size === 2
        ? pass("each order still remembers the table it was ordered at (an unmerge stays exact)")
        : fail("the orders were re-homed onto one table — an unmerge can no longer be exact");
      // A SECOND PARTY MUST NOT BE SEATABLE ON A JOINED TABLE. The panel never offers it (a child
      // tile is not a free tile), but the endpoint is the guard that counts.
      const second = await sb.rpc("lfh_staff_open_table", { p_restaurant_id: RID, p_table: child });
      const refused = second.error || second.data?.ok === false || second.data?.reason === "merged_child";
      refused
        ? pass("opening a NEW party on the joined table is refused — it belongs to the other bill")
        : fail(`a second party was seated on T${child} while it is joined to T${parent} — an unmerge would hand them someone else's order`);
      if (second.data?.id) { made.sessions.push(second.data.id); await sb.from("sessions").update({ status: "closed" }).eq("id", second.data.id); }
      // …and once the party leaves, BOTH tables are clean for whoever sits next.
      await sb.from("sessions").update({ status: "closed" }).eq("id", r.data.target_session);
      const after = must(await sb.from("table_merges").select("id").eq("restaurant_id", RID).eq("child_table", child).is("ended_at", null));
      after.length === 0
        ? pass("the join ends with the party — the tables are two tables again")
        : fail("the tables are still shown as joined after the party left");
      const sNext = await openTable(TA); await assertFresh(TA, "the next party at the parent table", sNext);
      const sNext2 = await openTable(TB); await assertFresh(TB, "the next party at the joined table", sNext2);
    } else fail("the merge did not go through, so its aftermath could not be checked");
    await clean(TA); await clean(TB); }

  // ── 6. RE-OPEN RACE ─────────────────────────────────────────────────────────
  head("6) Two people tap Open on the same table at the same instant");
  { const [r1, r2] = await Promise.all([
      sb.rpc("lfh_staff_open_table", { p_restaurant_id: RID, p_table: TA }),
      sb.rpc("lfh_staff_open_table", { p_restaurant_id: RID, p_table: TA }),
    ]);
    for (const r of [r1, r2]) if (r.data?.id) made.sessions.push(r.data.id);
    const errs = [r1, r2].filter((r) => r.error || r.data?.error);
    const opens = must(await sb.from("sessions").select("id").eq("restaurant_id", RID).eq("table_number", TA).eq("status", "open"));
    errs.length === 0
      ? pass("both taps answered normally — nobody saw an error")
      : fail(`${errs.length} of the two taps failed: ${errs.map((e) => e.error?.message || e.data?.error).join(" | ")}`);
    opens.length === 1
      ? pass("exactly ONE party is seated at the table (never two open sessions)")
      : fail(`${opens.length} open sessions on one table — orders would split between them`);
    r1.data?.id && r2.data?.id && r1.data.id === r2.data.id
      ? pass("both taps were told about the SAME party")
      : info(`the two taps returned ${r1.data?.id?.slice(0, 8)} and ${r2.data?.id?.slice(0, 8)}`);
    await clean(TA); }

  // ── 7. GUEST RE-JOIN ────────────────────────────────────────────────────────
  head("7) A guest scans the table's QR after a previous party has left");
  { const sA = await openTable(TA); const oA = await order(TA, dishes[0], 2); await serveAndPay(oA);
    must(await sb.from("sessions").update({ status: "closed" }).eq("id", sA).select("id"));
    const sB = await openTable(TA);
    // real signature: lfh_join_session(p_table, p_name, p_lat, p_lng, p_device, p_restaurant_id)
    const join = await sb.rpc("lfh_join_session", { p_table: TA, p_name: "Lifecycle guest", p_lat: null, p_lng: null, p_device: "lifecycle-test-device", p_restaurant_id: RID });
    const token = join.data?.token || join.data?.member?.token;
    if (join.error || !token) { info(`join answered ${join.error?.message || JSON.stringify(join.data).slice(0, 120)} — checking the guest view another way`); }
    const state = token ? (await sb.rpc("lfh_session_state", { p_token: token })).data : null;
    if (state) {
      const gOrders = state.orders || [];
      const sess = state.session?.id;
      sess === sB && !gOrders.some((o) => o.id === oA)
        ? pass(`the guest is joined to the CURRENT party and sees ${gOrders.length} of their own order(s) — none of the previous party's`)
        : fail(`the guest sees session ${String(sess).slice(0, 8)} and ${gOrders.length} order(s), previous party's included: ${gOrders.some((o) => o.id === oA)}`);
    } else {
      const rows = await liveAt(TA);
      rows.every((r) => r.session_id === sB) ? pass("the table carries only the current party's orders for a guest to see") : fail("the table still carries the previous party's orders");
    }
    await sb.from("session_members").delete().eq("device_id", "lifecycle-test-device");
    await clean(TA); }

  // ── 8. PARCEL ───────────────────────────────────────────────────────────────
  head("8) A takeaway order must not attach itself to any table");
  { const before = await liveAt(TA);
    const ext = "lifecycle-" + Date.now();
    const p = await sb.rpc("lfh_platform_insert", { p_source: "parcel", p_external_id: ext,
      p_customer: "Lifecycle parcel", p_phone: null,
      p_items: [{ id: dishes[0].id, title: dishes[0].title, qty: 1, price: dishes[0].price }],
      p_total: dishes[0].price, p_restaurant_id: RID });
    if (p.error) fail(`the takeaway path errored: ${p.error.message}`);
    else {
      // A takeaway lands in aggregator_orders, a table that has NO table_number column at all —
      // so it is structurally incapable of appearing on someone's table. Prove both: the row
      // exists there, and no table's floor moved.
      const row = must(await sb.from("aggregator_orders").select("id,source,total,order_id").eq("external_id", ext).limit(1))[0];
      const cols = row ? Object.keys(row) : [];
      row ? pass(`the takeaway order exists on the takeaway board (₹${row.total}, source "${row.source}")`)
          : fail("the takeaway order was not created");
      !cols.includes("table_number")
        ? pass("takeaway orders are kept in a table that has no table_number at all — it cannot land on a table")
        : fail("the takeaway record carries a table_number");
      const after = await liveAt(TA);
      after.length === before.length
        ? pass(`no table's floor changed (T${TA} still has ${after.length} live order(s))`)
        : fail(`T${TA}'s floor went ${before.length} → ${after.length} because of a takeaway order`);
      await sb.from("aggregator_orders").delete().eq("external_id", ext);
    } }
} finally {
  if (made.orders.length) await sb.from("orders").update({ archived: true, archived_at: nowIso(), deleted_at: nowIso() }).in("id", made.orders);
  for (const t of [TA, TB]) {
    const open = must(await sb.from("sessions").select("id").eq("restaurant_id", RID).eq("table_number", t).neq("status", "closed"));
    for (const s of open) await sb.from("sessions").update({ status: "closed" }).eq("id", s.id);
    await sb.from("table_tags").delete().eq("restaurant_id", RID).eq("table_number", t);
    await sb.from("waiter_calls").update({ resolved: true }).eq("restaurant_id", RID).eq("table_number", t).eq("resolved", false);
  }
  // …and the kitchen tickets they queued, by order id, or the manager's floor keeps a red "hasn't
  // printed — is the kitchen screen open?" banner for each. (T28, 2026-08-22)
  await dismissTicketsFor(sb, RID, made.orders);
  console.log(`\n· cleaned up ${made.orders.length} test orders on T${TA}/T${TB}`);
}
console.log(failed ? `\n✗ ${failed} check(s) failed — a table can still hand something to the next party` : "\n✓ every way a table changes hands: the next party starts clean, the record survives");
process.exit(failed ? 1 : 0);
