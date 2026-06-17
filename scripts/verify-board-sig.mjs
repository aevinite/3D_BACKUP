// Reproduces + verifies the "kitchen/tablet don't auto-repaint an allergy/note/
// discount/auto-approve edit" bug. The panels skip render() when boardSig is
// unchanged; the OLD sig omitted the editable fields, so a realtime-fetched edit
// looked identical → no repaint (manual refresh worked because lastSig resets).
//   node scripts/verify-board-sig.mjs

// ---- OLD kitchen sig (buggy): omits allergies/removed/note/options ----
const kitchenSigOld = (d) => JSON.stringify([
  (d.orders || []).map((o) => [o.id, o.status, o.kot_no]),
  (d.items || []).map((i) => [i.id, i.status]),
  (d.dishes || []).map((x) => [x.id, (x.tags || []).includes("sold-out")]),
]);
// ---- NEW kitchen sig (fixed): includes the drawn editable fields ----
const kitchenSigNew = (d) => JSON.stringify([
  (d.orders || []).map((o) => [o.id, o.status, o.kot_no, o.allergies]),
  (d.items || []).map((i) => [i.id, i.status, i.removed, i.note, i.options]),
  (d.dishes || []).map((x) => [x.id, (x.tags || []).includes("sold-out")]),
]);
// ---- NEW tablet sig (fixed) ----
const tabletSigNew = (d) => JSON.stringify([
  (d.sessions || []).map((s) => [s.id, s.table_number, s.status, s.bill_no, s.auto_approve, s.cart]),
  (d.orders || []).map((o) => [o.id, o.table_number, o.status, o.total, o.kot_no, o.payment_status, o.discount, o.allergies]),
  (d.items || []).map((i) => [i.id, i.order_id, i.status, i.removed, i.note, i.options]),
  (d.calls || []).map((c) => [c.id, c.table_number]),
  (d.members || []).map((m) => [m.id, m.session_id, m.approved, m.removed, m.role, m.name]),
  (d.requests || []).map((r) => [r.id, r.table_number, r.type, r.status]),
  (d.settings || {}).table_count,
]);

let pass = true;
const check = (label, cond) => { console.log((cond ? "✓ " : "✗ ") + label); if (!cond) pass = false; };

// A running order before/after the manager adds "no nuts" (order-wide allergy).
const before = { orders: [{ id: "o1", status: "preparing", kot_no: 5, allergies: [] }], items: [{ id: "i1", order_id: "o1", status: "preparing", removed: [], note: "", options: [] }], dishes: [] };
const afterAllergy = JSON.parse(JSON.stringify(before)); afterAllergy.orders[0].allergies = ["nuts"];
const afterNote = JSON.parse(JSON.stringify(before)); afterNote.items[0].note = "extra hot";

// 1) Reproduce the bug: OLD kitchen sig is UNCHANGED by an allergy edit.
check("BUG reproduced: old kitchen sig ignores an allergy edit", kitchenSigOld(before) === kitchenSigOld(afterAllergy));
// 2) Fixed: NEW kitchen sig CHANGES on an allergy edit (→ render runs).
check("FIX: new kitchen sig changes on allergy edit", kitchenSigNew(before) !== kitchenSigNew(afterAllergy));
// 3) Fixed: NEW kitchen sig changes on a per-dish note edit.
check("FIX: new kitchen sig changes on note edit", kitchenSigNew(before) !== kitchenSigNew(afterNote));

// Tablet: the new features must each flip the signature.
const tb = { sessions: [{ id: "s1", table_number: "3", status: "open", bill_no: 1, auto_approve: false, cart: [] }], orders: [{ id: "o1", table_number: "3", status: "preparing", total: 100, kot_no: 5, payment_status: "pending", discount: 0, allergies: [] }], items: [{ id: "i1", order_id: "o1", status: "preparing", removed: [], note: "", options: [] }], calls: [], members: [{ id: "m1", session_id: "s1", approved: true, removed: false, role: "guest", name: "A" }], requests: [], settings: { table_count: 12 } };
const flip = (mut) => { const c = JSON.parse(JSON.stringify(tb)); mut(c); return tabletSigNew(tb) !== tabletSigNew(c); };
check("FIX: tablet sig changes on auto-approve toggle", flip((c) => c.sessions[0].auto_approve = true));
check("FIX: tablet sig changes on building-cart change", flip((c) => c.sessions[0].cart = [{ id: "x", qty: 1 }]));
check("FIX: tablet sig changes on discount", flip((c) => c.orders[0].discount = 20));
check("FIX: tablet sig changes on order allergy", flip((c) => c.orders[0].allergies = ["nuts"]));
check("FIX: tablet sig changes on dish note", flip((c) => c.items[0].note = "no ice"));

console.log("\n" + (pass ? "ALL PASS" : "SOME FAILED"));
process.exit(pass ? 0 : 1);
