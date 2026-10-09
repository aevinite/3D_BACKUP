#!/usr/bin/env node
// verify:voided-stays — a CANCELLED ticket stays cancelled until somebody RESTORES it.
//
// Sweep #10 T10, item 1. The manager route has one sanctioned way back from a cancel — PATCH
// /orders/:id with status 'received' (30-minute window, `order_uncancel` in the Activity log). Four
// other doors used to move a cancelled order's status with neither: POST orders/:id/accept, POST
// orders/:id/item, POST items/:id/status and PATCH /orders/:id with 'preparing' / 'served'. A stale
// floor tile plus a colleague's cancel on another device was enough to bring the ticket back to the
// kitchen and its money back onto the bill, with nothing written down.
//
// This drives the REAL route (bundled with esbuild, called in memory against scripts/panel-stubs —
// the harness terminal 9 built) and asserts what the handler actually WROTE, not what the file
// says. The second half proves the gate is not refusing everything: the same doors still work on a
// live ticket, and Restore still works on a cancelled one.
import { world, call } from "./sweep/t9s10/lib.mjs";

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log(`  ✓ ${m}`); };
const bad = (m) => { fail++; console.log(`  ✗ ${m}`); };
const RID = "rest-1";
const recent = new Date(Date.now() - 5 * 60_000).toISOString();

const cancelledWorld = (extra = {}) => world({
  fix: {
    orders: [{ id: "o1", restaurant_id: RID, status: "cancelled", cancelled_at: recent, payment_status: "pending", archived: false,
      session_id: "s1", table_number: "4", items: [{ id: "d1", status: "received", qty: 1 }] }],
    order_items: [{ id: "i1", restaurant_id: RID, order_id: "o1", status: "received" }],
    ...extra,
  },
});
const ordersWrites = (G) => G.WRITES.filter((w) => w.table === "orders" || w.table === "order_items");

console.log("verify:voided-stays — a cancelled ticket is never revived except by Restore");

const DOORS = [
  ["POST", "orders/o1/accept", {}, "✓ Accept & Prepare"],
  ["POST", "orders/o1/item", { index: 0, status: "served" }, "one dish's status inside the order"],
  ["POST", "items/i1/status", { status: "served" }, "serving one dish"],
  ["POST", "items/i1/status", { status: "preparing" }, "sending one dish back to preparing"],
  ["PATCH", "orders/o1", { status: "preparing" }, "PATCH status preparing"],
  ["PATCH", "orders/o1", { status: "served" }, "PATCH status served"],
];
for (const [verb, path, body, what] of DOORS) {
  const G = await cancelledWorld();
  const r = await call(verb, path, { body });
  const o = G.FIX.orders[0];
  if (r.status === 409 && /cancelled/.test(r.text)) ok(`${what} on a cancelled ticket is refused (409)`);
  else bad(`${what} on a cancelled ticket answered ${r.status} ${r.text.slice(0, 80)}`);
  if (o.status === "cancelled" && ordersWrites(G).length === 0) ok(`…and nothing about the ticket or its dishes changed`);
  else bad(`…but the ticket now reads '${o.status}' after ${ordersWrites(G).length} write(s)`);
}

// ── the gate is not refusing everything ─────────────────────────────────────────────────────
{
  const G = await world({ fix: { orders: [{ id: "o2", restaurant_id: RID, status: "received", items: [{ id: "d", status: "received" }] }] } });
  const r = await call("POST", "orders/o2/accept", { body: {} });
  if (r.status === 200 && G.FIX.orders[0].status === "preparing") ok("a LIVE ticket is still accepted (200, now preparing)");
  else bad(`a live ticket's accept answered ${r.status}, status ${G.FIX.orders[0].status}`);
}
{
  const G = await world({ fix: { orders: [{ id: "o3", restaurant_id: RID, status: "preparing", items: [{ id: "d", status: "preparing" }] }],
    order_items: [{ id: "i3", restaurant_id: RID, order_id: "o3", status: "preparing" }] } });
  const r = await call("POST", "items/i3/status", { body: { status: "served" } });
  if (r.status === 200 && G.FIX.order_items[0].status === "served" && G.FIX.orders[0].status === "served") ok("a dish on a LIVE ticket is still served, and the ticket rolls up to served");
  else bad(`a live dish's serve answered ${r.status}, dish ${G.FIX.order_items[0].status}, order ${G.FIX.orders[0].status}`);
}
{
  const G = await world({ fix: { orders: [{ id: "o4", restaurant_id: RID, status: "preparing", items: [{ id: "d", status: "preparing" }] }] } });
  const r = await call("POST", "orders/o4/item", { body: { index: 0, status: "served" } });
  if (r.status === 200 && G.FIX.orders[0].status === "served") ok("one dish inside a LIVE ticket is still set (the order rolls up)");
  else bad(`a live order's item answered ${r.status}, status ${G.FIX.orders[0].status}`);
}
{
  const G = await cancelledWorld();
  const r = await call("PATCH", "orders/o1", { body: { status: "received" } });
  if (r.status === 200 && G.FIX.orders[0].status === "received" && G.LOGS.some((l) => l.action === "order_uncancel"))
    ok("Restore (status 'received') still brings a cancelled ticket back — and is logged as order_uncancel");
  else bad(`Restore answered ${r.status}, status ${G.FIX.orders[0].status}`);
}
{
  const G = await world({ fix: { order_items: [] } });
  const r = await call("POST", "items/gone/status", { body: { status: "served" } });
  if (r.status === 404 && G.WRITES.length === 0) ok("a dish that is gone still answers 404, and nothing is written");
  else bad(`a gone dish answered ${r.status} with ${G.WRITES.length} write(s)`);
}

console.log(`\n${fail ? "✗ FAIL" : "✓ PASS"} — ${pass} checks passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
