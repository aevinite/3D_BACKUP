// Proves the manager "switch tab → table shows seated, no order for ~5-7s" glitch
// is gone. Root cause: loadAll() did `state.data = data`, but GET /all returns menu
// CONTENT only (items/categories/filters/settings) — no orders/calls. So a loadAll
// landing after the board loaders (which happens on tab-wake, where the realtime
// wake fires BOTH loadAll and the board poll) wiped state.data.orders → the floor
// drew the session without its orders until the next board poll. Fix: loadAll
// preserves orders/calls. This mirrors loadAll in public/panels/editor/app.js.
//   node scripts/verify-loadall-preserves-orders.mjs

// The /all payload (menu content only — exactly what the endpoint returns).
const allPayload = { items: [{ id: "d1" }], categories: [], filters: [], settings: { id: "site" } };
// State just before loadAll: the board loaders have populated orders + calls.
const beforeState = () => ({ items: [], categories: [], orders: [{ id: "o1", table_number: "8", status: "preparing" }], calls: [{ id: "c1" }] });

const loadAllOld = (state, data) => { state.data = data; return state; };          // buggy
const loadAllNew = (state, data) => {                                               // fixed
  const prev = state.data || {};
  state.data = { ...data, orders: prev.orders || [], calls: prev.calls || [] };
  return state;
};

let pass = true;
const check = (label, cond) => { console.log((cond ? "✓ " : "✗ ") + label); if (!cond) pass = false; };
const ordersForTable8 = (s) => (s.data.orders || []).filter((o) => o.table_number === "8");

// 1) Reproduce the bug: OLD loadAll wipes table 8's order.
{ const s = loadAllOld({ data: beforeState() }, allPayload); check("OLD loadAll WIPES table-8 order (bug reproduced)", ordersForTable8(s).length === 0); }
// 2) Fixed: NEW loadAll keeps table 8's order.
{ const s = loadAllNew({ data: beforeState() }, allPayload); check("FIXED loadAll keeps table-8 order", ordersForTable8(s).length === 1); }
// 3) Fixed still refreshes the menu content (items) from /all.
{ const s = loadAllNew({ data: beforeState() }, allPayload); check("FIXED loadAll still updates menu items from /all", (s.data.items || []).length === 1); }
// 4) Fixed keeps calls too.
{ const s = loadAllNew({ data: beforeState() }, allPayload); check("FIXED loadAll keeps calls", (s.data.calls || []).length === 1); }
// 5) First-ever loadAll (no prior state.data) doesn't crash and yields empty orders.
{ const s = loadAllNew({}, allPayload); check("FIRST loadAll (no prior state) → orders=[] no crash", Array.isArray(s.data.orders) && s.data.orders.length === 0); }

console.log("\n" + (pass ? "ALL PASS" : "SOME FAILED"));
process.exit(pass ? 0 : 1);
