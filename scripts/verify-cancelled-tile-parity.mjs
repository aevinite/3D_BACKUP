// Prove the fix for the "clicked tile counts cancelled-order dishes" bug, against
// the LIVE production DB (the one Vercel serves). Builds the exact poison state:
// a table with an ACCEPTED order (some served, some cooking) PLUS a CANCELLED order
// whose dish row still reads 'ready'. Then compares three counts of the same table:
//   • summaryRPC  — lfh_table_view_summary → what EVERY un-clicked tile shows
//   • newBoard    — the SHIPPED client math (tableTileStateFromBoard, cancelled EXCLUDED)
//   • oldBoard    — the BUGGY client math (cancelled INCLUDED) — for contrast
// PASS = summaryRPC === newBoard (fix agrees with all other views) AND oldBoard != summaryRPC
// (the bug really existed). Cleans up after itself.
//   node scripts/verify-cancelled-tile-parity.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createClient } from "@supabase/supabase-js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const env = Object.fromEntries(readFileSync(join(root, ".env.local"), "utf8").split(/\r?\n/)
  .map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i)).filter(Boolean)
  .map((m) => [m[1], m[2].replace(/^["']|["']$/g, "")]));
const svc = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const RID = "00000000-0000-0000-0000-000000000001"; // Little French House
const TN = "288";                                    // throwaway table (within 1..table_count, unused)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// exact mirror of the client helpers (public/panels/editor/app.js)
const qtyOf = (i) => Math.max(0, parseInt(i.qty, 10) || 1);
const countBy = (items) => ({
  nw: items.filter((i) => i.status === "received").reduce((a, i) => a + qtyOf(i), 0),
  ck: items.filter((i) => i.status === "preparing").reduce((a, i) => a + qtyOf(i), 0),
  rd: items.filter((i) => i.status === "ready").reduce((a, i) => a + qtyOf(i), 0),
  sv: items.filter((i) => i.status === "served").reduce((a, i) => a + qtyOf(i), 0),
});
const same = (a, b) => a.nw === b.nw && a.ck === b.ck && a.rd === b.rd && a.sv === b.sv;
const show = (c) => `nw=${c.nw} ck=${c.ck} rd=${c.rd} sv=${c.sv}`;

// TEARDOWN FOLLOWS THE PRODUCT'S OWN RULE, NOT `delete` (sweep #6 / T28, 2026-08-22).
//
// It used to hard-DELETE the orders and the session. The database refuses that: `trg_block_issued_delete`
// raises a check_violation for any order that has a kot_no (every order gets one at insert, mig 036)
// and for any session that has a bill_no (mig 190 — an issued bill is never erased). The refusals were
// never read, because none of these calls looked at `.error`. So the fixture SURVIVED every run, and
// the next run died at the very first step:
//
//     ERROR: session insert: duplicate key value violates unique constraint "idx_one_open_session_per_table"
//
// One open session on table 288 killed this guard permanently. Worse, its leftover order stayed LIVE,
// and the floor unions off-plan table numbers onto the plan — so "288 · 4 · Preparing · ＋ Take order"
// sat on My Little French House's Tables floor after table 30, with a red unpaid ring, and the header
// counted it (1/31 occupied on a 30-table restaurant). Measured and screenshotted at 1280x800 and at
// 360x780 dpr3 before this was written.
//
// So: retire the rows the way a real cancellation does — cancel + archive the orders, close +
// soft-delete the session — and SAY OUT LOUD when a step will not go, instead of leaving the next
// run to discover it.
async function cleanup(sessId, orderIds) {
  const say = (what, error) => { if (error) console.log(`   cleanup: ${what} did not go — ${error.message}`); };
  for (const id of orderIds) say(`order_items of ${id}`, (await svc.from("order_items").delete().eq("order_id", id)).error);
  say("retire the test orders", (await svc.from("orders")
    .update({ status: "cancelled", archived: true, archived_at: new Date().toISOString(), cancelled_at: new Date().toISOString() })
    .eq("table_number", TN).eq("restaurant_id", RID).is("archived", false)).error);
  if (sessId) say("session members", (await svc.from("session_members").delete().eq("session_id", sessId)).error);
  say("close the test session", (await svc.from("sessions")
    .update({ status: "closed", closed_at: new Date().toISOString(), deleted_at: new Date().toISOString() })
    .eq("table_number", TN).eq("restaurant_id", RID).eq("status", "open")).error);
  // The one thing that MUST be true when we leave: nothing live is left on this table, or the
  // manager's floor grows a table that does not exist and the next run cannot even start.
  const left = await svc.from("sessions").select("id").eq("restaurant_id", RID).eq("table_number", TN).eq("status", "open").limit(5);
  if ((left.data || []).length) {
    console.log(`   ⚠ table ${TN} still has ${left.data.length} OPEN session(s) — the next run will fail at the unique index`);
    return false;
  }
  return true;
}

// A refused write must STOP the run, not be discovered three prints later as "test setup issue".
const ins = (what, res) => { if (res.error) throw new Error(`${what}: ${res.error.message}`); return res; };

let sessId = null; const orderIds = [];
try {
  await cleanup(null, []); // clear any leftover from a prior run

  const sess = (await svc.from("sessions").insert({ restaurant_id: RID, table_number: TN, status: "open", auto_approve: true }).select("id").single());
  if (sess.error) throw new Error("session insert: " + sess.error.message);
  sessId = sess.data.id;
  ins("the session member", await svc.from("session_members").insert({ restaurant_id: RID, session_id: sessId, name: "Parity Selftest", role: "guest", approved: true, phone: "9990000288", token: "selftest-" + Date.now() }));

  // ACCEPTED order: 1 served (qty1) + 1 cooking (qty2)  → truth: sv=1, ck=2, total=3
  const o1 = (await svc.from("orders").insert({ restaurant_id: RID, table_number: TN, session_id: sessId, items: [], subtotal: 900, total: 945, status: "preparing", payment_status: "pending" }).select("id").single());
  if (o1.error) throw new Error("order1 insert: " + o1.error.message);
  orderIds.push(o1.data.id);
  // EVERY INSERT'S ERROR IS READ (sweep #6 / T28, 2026-08-22). `order_items.restaurant_id` became
  // NOT NULL when the app went multi-tenant, and these two rows never carried it — so both inserts
  // were refused, in silence, and the whole comparison below ran on ZERO dishes. nw=0 ck=0 rd=0 sv=0
  // on both sides, so "the shipped math agrees with the summary" printed a ✓ that proved nothing: a
  // false green, on the one property this file exists to hold. The only visible symptom was the
  // SECOND line saying it "could not reproduce the old mismatch (test setup issue)".
  ins("the accepted order's dishes", await svc.from("order_items").insert([
    { restaurant_id: RID, order_id: o1.data.id, session_id: sessId, title: "Espresso", qty: 1, unit_price: 300, status: "served" },
    { restaurant_id: RID, order_id: o1.data.id, session_id: sessId, title: "Latte",   qty: 2, unit_price: 300, status: "preparing" },
  ]));

  // CANCELLED order: 1 dish still 'ready', qty5 → the POISON that leaked into the clicked tile
  const o2 = (await svc.from("orders").insert({ restaurant_id: RID, table_number: TN, session_id: sessId, items: [], subtotal: 2500, total: 2625, status: "cancelled", payment_status: "pending" }).select("id").single());
  if (o2.error) throw new Error("order2 insert: " + o2.error.message);
  orderIds.push(o2.data.id);
  ins("the cancelled order's dish", await svc.from("order_items").insert([
    { restaurant_id: RID, order_id: o2.data.id, session_id: sessId, title: "Cancelled Cake", qty: 5, unit_price: 500, status: "ready" },
  ]));

  await sleep(500);

  // 1) PROD summary RPC — the source every un-clicked tile renders from
  const rpc = await svc.rpc("lfh_table_view_summary", { p_restaurant_id: RID, p_table: TN });
  if (rpc.error) throw new Error("rpc: " + rpc.error.message);
  const tile = (rpc.data.tiles || {})[TN] || {};
  const summaryRPC = tile.counts || { nw: 0, ck: 0, rd: 0, sv: 0 };

  // 2) fetch the raw slice the client would load, and compute BOTH client maths
  const orders = (await svc.from("orders").select("id,status,archived").eq("table_number", TN).eq("restaurant_id", RID)).data.filter((o) => !o.archived);
  const items = (await svc.from("order_items").select("order_id,qty,status").in("order_id", orders.map((o) => o.id))).data;
  const rowsFor = (os) => os.flatMap((o) => items.filter((i) => i.order_id === o.id));
  const oldBoard = countBy(rowsFor(orders));                                       // BUGGY: cancelled included
  const newBoard = countBy(rowsFor(orders.filter((o) => o.status !== "cancelled"))); // SHIPPED: cancelled excluded

  console.log("summary RPC (un-clicked tile):", show(summaryRPC));
  console.log("newBoard  (SHIPPED clicked)  :", show(newBoard));
  console.log("oldBoard  (BUGGY clicked)    :", show(oldBoard), "\n");
  console.log("tile meta (RPC):", tile.meta, "| state:", tile.state, "\n");

  const fixAgrees = same(summaryRPC, newBoard);
  const bugExisted = !same(summaryRPC, oldBoard);
  console.log(fixAgrees ? "✓ FIX: shipped clicked-tile math == prod summary (they agree, cancelled excluded)"
                        : "✗ FIX BROKEN: shipped math disagrees with prod summary");
  console.log(bugExisted ? "✓ BUG CONFIRMED: old math (cancelled included) would have shown wrong counts"
                         : "✗ could not reproduce the old mismatch (test setup issue)");

  await cleanup(sessId, orderIds);
  process.exit(fixAgrees && bugExisted ? 0 : 1);
} catch (e) {
  console.error("ERROR:", e.message);
  await cleanup(sessId, orderIds);
  process.exit(2);
}
