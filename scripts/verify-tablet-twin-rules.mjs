#!/usr/bin/env node
// verify:tablet-twins — the waiter's handheld obeys the same money rules the manager's till does.
//
// Sweep #10, terminal 13. The waiter tablet's server route (app/api/tablet/[...path]/route.ts) is a
// TWIN of the manager's (app/api/editor/[...path]/route.ts): about forty actions with the same names
// and no shared code. Every rule below was added to the manager's route and NOT to the tablet's, so
// the same tap was refused at the till and accepted on the handheld. Each section is one numbered
// item of the T13 report, and each was proved by driving the handler before it was fixed.
//
// This drives the REAL tablet route (bundled with esbuild, called in memory against
// scripts/panel-stubs plus scripts/sweep/t13s10/stubs — no socket opens) and asserts what the
// handler actually WROTE, not what the file says. Every section also proves the gate is not refusing
// everything: the same door still works on a live ticket.
import { world, call, writesOn, RID } from "./sweep/t13s10/lib.mjs";

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log(`  ✓ ${m}`); };
const bad = (m) => { fail++; console.log(`  ✗ ${m}`); };
const recent = new Date(Date.now() - 5 * 60_000).toISOString();

console.log("verify:tablet-twins — the waiter's handheld follows the manager's money rules");

// ── 1. A CANCELLED TICKET STAYS CANCELLED (item 1) ─────────────────────────────────────────────────
// The one way back from a cancel is Restore on the manager panel. Two doors on the tablet recompute a
// ticket's status and used to bring a cancelled one back to the kitchen and onto the bill, unlogged.
console.log("\n1. a cancelled ticket is never revived from the handheld");
const cancelledWorld = () => world({
  fix: {
    orders: [{ id: "o1", restaurant_id: RID, status: "cancelled", cancelled_at: recent, payment_status: "pending", archived: false,
      session_id: "s1", table_number: "4", items: [{ id: "d1", status: "received", qty: 1 }] }],
    order_items: [{ id: "i1", restaurant_id: RID, order_id: "o1", status: "received" }],
  },
});
for (const [path, body, what] of [
  ["orders/o1/accept", {}, "✓ Accept"],
  ["items/i1/status", { status: "served" }, "serving one dish"],
  ["items/i1/status", { status: "preparing" }, "sending one dish to preparing"],
  ["orders/o1/serve-all", {}, "Serve all"],
]) {
  const G = await cancelledWorld();
  const r = await call("POST", path, { body });
  if (r.status === 409 && /cancelled|voided/.test(r.text)) ok(`${what} on a cancelled ticket is refused (409)`);
  else bad(`${what} on a cancelled ticket answered ${r.status} ${r.text.slice(0, 90)}`);
  const o = G.FIX.orders[0];
  if (o.status === "cancelled" && writesOn(G, "orders", "order_items").length === 0) ok("…and nothing about the ticket or its dishes changed");
  else bad(`…but the ticket now reads '${o.status}' after ${writesOn(G, "orders", "order_items").length} write(s)`);
}
{
  const G = await world({ fix: { orders: [{ id: "o2", restaurant_id: RID, status: "received", table_number: "6", items: [{ id: "d", status: "received" }] }] } });
  const r = await call("POST", "orders/o2/accept", { body: {} });
  if (r.status === 200 && G.FIX.orders[0].status === "preparing") ok("a LIVE ticket is still accepted (200, now preparing)");
  else bad(`a live ticket's accept answered ${r.status}, status ${G.FIX.orders[0].status}`);
}
{
  const G = await world({ fix: { orders: [{ id: "o3", restaurant_id: RID, status: "preparing", table_number: "6", items: [] }],
    order_items: [{ id: "i3", restaurant_id: RID, order_id: "o3", status: "preparing" }] } });
  const r = await call("POST", "items/i3/status", { body: { status: "served" } });
  if (r.status === 200 && G.FIX.order_items[0].status === "served" && G.FIX.orders[0].status === "served") ok("a dish on a LIVE ticket is still served, and the ticket rolls up to served");
  else bad(`a live dish's serve answered ${r.status}, dish ${G.FIX.order_items[0].status}, order ${G.FIX.orders[0].status}`);
}

console.log(`\n${fail ? "✗ FAIL" : "✓ PASS"} — ${pass} checks passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
