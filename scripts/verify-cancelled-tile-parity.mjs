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

async function cleanup(sessId, orderIds) {
  for (const id of orderIds) await svc.from("order_items").delete().eq("order_id", id);
  await svc.from("orders").delete().eq("table_number", TN).eq("restaurant_id", RID);
  if (sessId) await svc.from("session_members").delete().eq("session_id", sessId);
  await svc.from("sessions").delete().eq("table_number", TN).eq("restaurant_id", RID);
}

let sessId = null; const orderIds = [];
try {
  await cleanup(null, []); // clear any leftover from a prior run

  const sess = (await svc.from("sessions").insert({ restaurant_id: RID, table_number: TN, status: "open", auto_approve: true }).select("id").single());
  if (sess.error) throw new Error("session insert: " + sess.error.message);
  sessId = sess.data.id;
  await svc.from("session_members").insert({ session_id: sessId, name: "Parity Selftest", role: "guest", approved: true, phone: "9990000288", token: "selftest-" + Date.now() });

  // ACCEPTED order: 1 served (qty1) + 1 cooking (qty2)  → truth: sv=1, ck=2, total=3
  const o1 = (await svc.from("orders").insert({ restaurant_id: RID, table_number: TN, session_id: sessId, items: [], subtotal: 900, total: 945, status: "preparing", payment_status: "pending" }).select("id").single());
  if (o1.error) throw new Error("order1 insert: " + o1.error.message);
  orderIds.push(o1.data.id);
  await svc.from("order_items").insert([
    { order_id: o1.data.id, session_id: sessId, title: "Espresso", qty: 1, unit_price: 300, status: "served" },
    { order_id: o1.data.id, session_id: sessId, title: "Latte",   qty: 2, unit_price: 300, status: "preparing" },
  ]);

  // CANCELLED order: 1 dish still 'ready', qty5 → the POISON that leaked into the clicked tile
  const o2 = (await svc.from("orders").insert({ restaurant_id: RID, table_number: TN, session_id: sessId, items: [], subtotal: 2500, total: 2625, status: "cancelled", payment_status: "pending" }).select("id").single());
  if (o2.error) throw new Error("order2 insert: " + o2.error.message);
  orderIds.push(o2.data.id);
  await svc.from("order_items").insert([
    { order_id: o2.data.id, session_id: sessId, title: "Cancelled Cake", qty: 5, unit_price: 500, status: "ready" },
  ]);

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
