// lib/paySplit.ts — every branch of settleBillInParts / badSplitShape / reverseSplitLegs, real code,
// in-memory database (writes are recorded, nothing is sent anywhere).
import { suite, quiet } from "./lib.mjs";
import { W, world } from "./sb.mjs";
const t = suite("lib/paySplit.ts", 168141, 120);
const P = await import("@/lib/paySplit.ts");
const { BUSY_MESSAGE } = await import("@/lib/dbRefusal.ts");
const RID = "rid-A";
const ord = (o) => ({ id: "o" + Math.random().toString(36).slice(2, 7), restaurant_id: RID, table_number: "5", session_id: "s1", status: "served", payment_status: "pending", deleted_at: null, archived: false, subtotal: 500, total: 525, discount: 0, taxable_base: 500, nontax_amount: 0, mrp_amount: 0, tax_rate: 0.05, ...o });
const base = (orders, extra = {}) => world({ sessions: [{ id: "s1", restaurant_id: RID, table_number: "5", status: "open", last_activity_at: "2026-10-09T10:00:00Z" }], orders, settings: [{ restaurant_id: RID, tax_rate: 0.05 }], session_payments: [], khata_customers: [], ...extra });
const settle = (splits, table = "5") => quiet(() => P.settleBillInParts((globalThis.__sbAdmin), { rid: RID, table, splits }));
globalThis.__sbAdmin = (await import("./sb.mjs")).supabaseAdmin;
const two = (a = 262.5, b = 262.5, m1 = "Cash", m2 = "UPI") => [{ amount: a, method: m1 }, { amount: b, method: m2 }];
const legs = () => (W.FIX.session_payments || []);
// shape
t("badSplitShape: not a list → refused", !!P.badSplitShape("x") && !!P.badSplitShape(null));
t("badSplitShape: one part → refused; 13 parts → refused; 2 and 12 accepted", !!P.badSplitShape([{ amount: 1, method: "Cash" }]) && !!P.badSplitShape(Array(13).fill({ amount: 1, method: "Cash" })) && P.badSplitShape(Array(2).fill({ amount: 1, method: "Cash" })) === null && P.badSplitShape(Array(12).fill({ amount: 1, method: "Cash" })) === null);
t("badSplitShape: 0, negative, NaN, a string amount → refused", [0, -1, NaN, "abc"].every((a) => /above zero/.test(P.badSplitShape([{ amount: a, method: "Cash" }, { amount: 1, method: "UPI" }]) || "")));
t("badSplitShape: an amount given as the string '5' is accepted (it is a number above zero)", P.badSplitShape([{ amount: "5", method: "Cash" }, { amount: 1, method: "UPI" }]) === null);
t("badSplitShape: an unknown method → refused", /invalid payment method/.test(P.badSplitShape([{ amount: 1, method: "Bitcoin" }, { amount: 1, method: "UPI" }]) || ""));
t("badSplitShape: a 201-character note → refused, 200 accepted, no note accepted", !!P.badSplitShape([{ amount: 1, method: "Other", note: "x".repeat(201) }, { amount: 1, method: "UPI" }]) && P.badSplitShape([{ amount: 1, method: "Other", note: "x".repeat(200) }, { amount: 1, method: "UPI" }]) === null);
t("badSplitShape: a pay-later part with neither a person id nor a name → refused", /needs a person/.test(P.badSplitShape([{ amount: 1, method: "Cash" }, { amount: 1, method: "Pay later" }]) || ""));
t("badSplitShape: a pay-later part with only an id is accepted; with only a name is accepted", P.badSplitShape([{ amount: 1, method: "Cash" }, { amount: 1, method: "Pay later", khataCustomerId: "k" }]) === null && P.badSplitShape([{ amount: 1, method: "Cash" }, { amount: 1, method: "Pay later", khataName: "A" }]) === null);
t("badSplitShape: two pay-later parts → refused", /Only one part/.test(P.badSplitShape([{ amount: 1, method: "Pay later", khataName: "A" }, { amount: 1, method: "Pay later", khataName: "B" }]) || ""));
t("SPLIT_METHODS = the four + 'Pay later'; PAY_LATER is spelled once", P.SPLIT_METHODS.join() === "UPI,Cash,Card,Other,Pay later" && P.PAY_LATER === "Pay later");
// the happy path
base([ord({ id: "a" }), ord({ id: "b" })]);
{ const r = await settle(two(600, 450));
  t("settle: two ₹525 orders at 5% → due ₹1,050, two parts, both orders marked paid with method 'Split'", r.ok && r.due === 1050 && r.count === 2 && W.FIX.orders.every((o) => o.payment_status === "paid" && o.payment_method === "Split"), JSON.stringify(r).slice(0, 160));
  t("…the parts carry the session, the restaurant, one shared settle group and no pay-later person", legs().length === 2 && legs().every((l) => l.session_id === "s1" && l.restaurant_id === RID && l.settle_group === legs()[0].settle_group && l.khata_customer_id === null));
  t("…the note reads '2-way split: ₹600 Cash + ₹450 UPI' and is stored on the orders", r.note === "2-way split: ₹600 Cash + ₹450 UPI" && W.FIX.orders[0].payment_note === r.note);
  t("…not parked, nothing owed, all collected", r.parked === false && r.owed === 0 && r.collected === 1050 && r.customer === null);
  t("…and it returns the session id and both order ids", r.sessionId === "s1" && r.orderIds.sort().join() === "a,b"); }
// which orders are the bill
base([ord({ id: "keep" }), ord({ id: "cancelled", status: "cancelled" }), ord({ id: "received", status: "received" }), ord({ id: "paid", payment_status: "paid" }), ord({ id: "binned", deleted_at: "2026-10-09" }), ord({ id: "other", restaurant_id: "rid-B" }), ord({ id: "othersess", session_id: "s-old" })]);
{ const r = await settle(two());
  t("settle: cancelled, not-yet-accepted, already-paid, binned, another restaurant's and another session's orders are NOT on the bill", r.ok && r.orderIds.join() === "keep", r.orderIds && r.orderIds.join()); }
world({ sessions: [], orders: [ord({ id: "x", session_id: "s9", archived: false }), ord({ id: "arch", session_id: "s9", archived: true })], settings: [{ restaurant_id: RID, tax_rate: 0.05 }], session_payments: [] });
{ const r = await settle(two());
  t("settle: no open session → it falls back to the table's un-archived orders and uses their session", r.ok && r.orderIds.join() === "x" && r.sessionId === "s9", JSON.stringify(r).slice(0, 120)); }
world({ sessions: [], orders: [ord({ id: "x", session_id: null })], settings: [], session_payments: [] });
{ const r = await settle(two()); t("settle: no open session and no session on the orders → 409 'no live bill session'", !r.ok && r.status === 409 && /no live bill session/.test(r.message)); }
base([]);
{ const r = await settle(two()); t("settle: nothing to settle → 409 and nothing written", !r.ok && r.status === 409 && /Nothing to settle/.test(r.message) && W.WRITES.length === 0); }
base(Array.from({ length: 400 }, () => ord()));
{ const r = await settle(two()); t("settle: 400 orders → refused (409) rather than settling part of the bill", !r.ok && r.status === 409 && /too many orders/.test(r.message) && W.WRITES.length === 0); }
base([ord()]);
{ const r = await settle([{ amount: 1, method: "Cash" }]); t("settle: a bad shape is refused 400 before any read", !r.ok && r.status === 400 && W.READS.length === 0); }
// the due
base([ord()]);
{ const r = await settle(two(262.51, 262.51)); t("settle: parts 2 paise over the due are accepted (rounding tolerance)", r.ok); }
base([ord()]);
{ const r = await settle(two(262.52, 262.51)); t("settle: 3 paise over → 409 naming both figures, nothing written", !r.ok && r.status === 409 && /₹525\.03 but the bill due is ₹525\.00/.test(r.message) && W.WRITES.length === 0, r.message); }
base([ord()]);
{ await settle(two(262.504, 262.496)); t("settle: each part is rounded ONCE to the paisa and that is what is stored", legs().map((l) => l.amount).join() === "262.5,262.5"); }
const due = async (orders, settings = { tax_rate: 0.05 }) => { base(orders); W.FIX.settings = [{ restaurant_id: RID, ...settings }]; const r = await settle(two(9999, 9999)); const m = /bill due is ₹(-?[\d.]+)/.exec(r.message || ""); return m ? Number(m[1]) : NaN; };
t("due: a ₹100 discount on ₹500 at 5% → ₹420 (discount before tax)", (await due([ord({ discount: 100 })])) === 420);
t("due: 18% and 5% orders on one bill are each taxed at their own rate → ₹1,115", (await due([ord({ tax_rate: 0.18 }), ord()])) === 1115);
t("due: a legacy order with no taxable_base is taxed on its subtotal", (await due([ord({ taxable_base: null })])) === 525);
t("due: a legacy order with no stamped rate takes the restaurant's rate", (await due([ord({ tax_rate: null })], { tax_rate: 0.12 })) === 560);
t("due: a composition restaurant (stamped 0) charges no tax", (await due([ord({ tax_rate: 0, total: 500 })], { price_tax_mode: "composition" })) === 500);
t("due: an untaxed MRP line adds to the due untaxed", (await due([ord({ nontax_amount: 40, mrp_amount: 40 })])) === 565);
t("due: an over-cap legacy discount is clamped — the due never goes negative", (await due([ord({ discount: 5000 })])) === 0);
t("due: at a zero rate the discount may come off untaxed (non-MRP) lines", (await due([ord({ tax_rate: 0, subtotal: 500, taxable_base: 0, nontax_amount: 500, mrp_amount: 0, discount: 100 })], { price_tax_mode: "composition" })) === 400);
t("due: at a zero rate a sealed MRP line cannot be discounted", (await due([ord({ tax_rate: 0, subtotal: 100, taxable_base: 0, nontax_amount: 100, mrp_amount: 100, discount: 100 })], { price_tax_mode: "composition" })) === 100);
t("due: a negative stored discount counts as zero", (await due([ord({ discount: -50 })])) === 525);
t("due: junk money fields count as zero rather than NaN", (await due([ord({ subtotal: "x", taxable_base: "y", discount: "z", nontax_amount: "q", mrp_amount: null })])) === 0);
// a NaN sum can never pass
base([ord()]);
{ const r = await settle([{ amount: 1e308, method: "Cash" }, { amount: 1e308, method: "UPI" }]); t("settle: parts that overflow to Infinity are refused 400 'not a real amount', nothing written", !r.ok && r.status === 400 && /not a real amount/.test(r.message) && W.WRITES.length === 0, r.message); }
// pay later
base([ord()], { khata_customers: [{ id: "k1", restaurant_id: RID, name: "Ravi", phone: "900" }, { id: "kB", restaurant_id: "rid-B", name: "Other", phone: "901" }] });
{ const r = await settle([{ amount: 300, method: "Cash" }, { amount: 225, method: "Pay later", khataCustomerId: "k1" }]);
  t("pay later (existing person): parked, owed ₹225, collected ₹300, the person named", r.ok && r.parked && r.owed === 225 && r.collected === 300 && r.customer.name === "Ravi");
  t("…the bill is NOT stamped paid; the orders go into the book and off the floor", W.FIX.orders[0].payment_status === "pending" && W.FIX.orders[0].khata_customer_id === "k1" && W.FIX.orders[0].archived === true && !!W.FIX.orders[0].khata_at);
  t("…only the tab part carries the person", legs().find((l) => l.method === "Pay later").khata_customer_id === "k1" && legs().find((l) => l.method === "Cash").khata_customer_id === null);
  t("…and the note ends with \"(Ravi's tab)\"", /\(Ravi's tab\)$/.test(r.note)); }
base([ord()], { khata_customers: [{ id: "kB", restaurant_id: "rid-B", name: "Other" }] });
{ const r = await settle([{ amount: 300, method: "Cash" }, { amount: 225, method: "Pay later", khataCustomerId: "kB" }]); t("pay later: a person from ANOTHER restaurant's book → 404, nothing written", !r.ok && r.status === 404 && W.WRITES.length === 0); }
base([ord()], { khata_customers: [{ id: "k1", restaurant_id: RID, name: "Ravi", phone: "900" }] });
{ const r = await settle([{ amount: 300, method: "Cash" }, { amount: 225, method: "Pay later", khataName: "R. Kumar", khataPhone: "900" }]); t("pay later (name + a phone already in the book): the existing person is reused, no second row", r.ok && r.customer.id === "k1" && W.FIX.khata_customers.length === 1); }
base([ord()]);
{ const r = await settle([{ amount: 300, method: "Cash" }, { amount: 225, method: "Pay later", khataName: "  Asha  ", khataPhone: "  " }]);
  t("pay later (new name, blank phone): one person is added, name trimmed, phone stored as nothing", r.ok && W.FIX.khata_customers.length === 1 && W.FIX.khata_customers[0].name === "Asha" && W.FIX.khata_customers[0].phone === null && W.FIX.khata_customers[0].restaurant_id === RID); }
base([ord()]);
{ await settle([{ amount: 300, method: "Cash" }, { amount: 225, method: "Pay later", khataName: "N".repeat(100), khataPhone: "1".repeat(30) }]);
  t("pay later: a name is capped at 80 characters and a phone at 20", W.FIX.khata_customers[0].name.length === 80 && W.FIX.khata_customers[0].phone.length === 20); }
base([ord()]);
{ const r = await settle([{ amount: 300, method: "Cash" }, { amount: 225, method: "Pay later", khataCustomerId: "   ", khataName: "Z" }]); t("pay later: an id of only spaces falls back to the name", r.ok && r.customer.name === "Z"); }
// item 4 — a failed read
for (const [what, key, splits] of [["the open session", "sessions:select"], ["the orders", "orders:select"], ["the tax settings", "settings:select"],
  ["the pay-later person (by id)", "khata_customers:select", [{ amount: 300, method: "Cash" }, { amount: 225, method: "Pay later", khataCustomerId: "k1" }]],
  ["the pay-later person (by phone)", "khata_customers:select", [{ amount: 300, method: "Cash" }, { amount: 225, method: "Pay later", khataName: "A", khataPhone: "1" }]]]) {
  base([ord()]); W.FAIL[key] = { message: "timeout", code: "57014" };
  const r = await settle(splits || two());
  t(`item 4: when the read of ${what} fails → 503 busy reply, nothing written`, !r.ok && r.status === 503 && r.message === BUSY_MESSAGE && W.WRITES.length === 0, r.message);
}
// item 6 — a failed save
for (const [what, key, splits, word] of [["recording the parts", "session_payments:insert", null, "record the payment parts"], ["adding the person", "khata_customers:insert", [{ amount: 300, method: "Cash" }, { amount: 225, method: "Pay later", khataName: "A" }], "add that person"], ["stamping the bill", "orders:update", null, "mark the bill settled"]]) {
  for (const [kind, err, status] of [["a refused value", { code: "23505", message: "duplicate key value violates unique constraint" }, 400], ["no answer", { code: "57014", message: "statement timeout" }, 503], ["an unexplained failure", { code: "XX000", message: "internal error" }, 500]]) {
    base([ord()]); W.FAIL[key] = err;
    const r = await settle(splits || two());
    t(`item 6: ${what} fails with ${kind} → ${status}, a sentence about the bill, no database words`, !r.ok && r.status === status && (status === 503 ? r.message === BUSY_MESSAGE : new RegExp(word).test(r.message)) && !/violates|internal error|timeout/.test(r.message), r.message);
  }
}
base([ord()]); W.FAIL["orders:update"] = { code: "XX000", message: "x" };
await settle(two());
t("item 6: a failed stamp stamps its own parts REVERSED (by 'auto · the bill was not settled'), never deletes them", legs().length === 2 && legs().every((l) => l.reversed_at && l.reversed_by === "auto · the bill was not settled") && !W.WRITES.some((w) => w.op === "delete"));
base([ord()]); W.FAIL["orders:update"] = { code: "XX000", message: "x" }; W.FAIL_NTH["session_payments:update"] = { at: 1, mode: "throw" };
{ const r = await settle(two()); t("item 6: …and if even that reversal throws, the person is still told it failed (no crash)", !r.ok && r.status === 500); }
// item 5 — first save wins
base([ord({ id: "a" }), ord({ id: "b" })]);
W.FIX.orders.forEach((o) => (o.payment_status = "pending"));
{ const orig = W.FIX.orders; const sb = globalThis.__sbAdmin; const realFrom = sb.from;
  sb.from = (tbl) => { const q = realFrom(tbl); if (tbl === "orders") { const u = q.update; q.update = (p) => { orig.forEach((o) => (o.payment_status = "paid")); return u.call(q, p); }; } return q; };
  const r = await settle(two(525, 525));
  sb.from = realFrom;
  t("item 5: another device settled the whole bill between our read and our stamp → 409 'Someone else settled this bill'", !r.ok && r.status === 409 && /Someone else settled this bill a moment ago/.test(r.message), r.message);
  t("item 5: …our parts are stamped reversed ('someone else settled this bill first'), none deleted", legs().length === 2 && legs().every((l) => l.reversed_by === "auto · someone else settled this bill first")); }
base([ord({ id: "a" }), ord({ id: "b" })]);
{ const sb = globalThis.__sbAdmin; const realFrom = sb.from; let first = true;
  sb.from = (tbl) => { const q = realFrom(tbl); if (tbl === "orders") { const u = q.update; q.update = (p) => { if (first) { first = false; W.FIX.orders.find((o) => o.id === "a").payment_status = "paid"; } return u.call(q, p); }; } return q; };
  const r = await settle(two(525, 525));
  sb.from = realFrom;
  t("item 5: another device settled PART of it → 409 'settled part of this bill'", !r.ok && r.status === 409 && /settled part of this bill/.test(r.message), r.message);
  t("item 5: …the row WE reached goes back to unsettled exactly (status, paid_at, method, note cleared)", (() => { const b = W.FIX.orders.find((o) => o.id === "b"); return b.payment_status === "pending" && b.paid_at === null && b.payment_method === null && b.payment_note === null; })());
  t("item 5: …the row the other device settled is left alone", W.FIX.orders.find((o) => o.id === "a").payment_status === "paid"); }
base([ord({ id: "a" })]);
{ const sb = globalThis.__sbAdmin; const realFrom = sb.from;
  sb.from = (tbl) => { const q = realFrom(tbl); if (tbl === "orders") { const u = q.update; q.update = (p) => { W.FIX.orders[0].khata_at = "2026-10-09"; return u.call(q, p); }; } return q; };
  const r = await settle([{ amount: 300, method: "Cash" }, { amount: 225, method: "Pay later", khataName: "A" }]);
  sb.from = realFrom;
  t("item 5: a tab that lost the race (the bill was already on a tab) → 409, parts reversed", !r.ok && r.status === 409 && legs().every((l) => !!l.reversed_at)); }
base([ord({ id: "a" }), ord({ id: "b" })]);
{ const sb = globalThis.__sbAdmin; const realFrom = sb.from; let first = true;
  sb.from = (tbl) => { const q = realFrom(tbl); if (tbl === "orders") { const u = q.update; q.update = (p) => { if (first) { first = false; W.FIX.orders.find((o) => o.id === "a").khata_at = "x"; } return u.call(q, p); }; } return q; };
  await settle([{ amount: 300, method: "Cash" }, { amount: 750, method: "Pay later", khataName: "A" }]);
  sb.from = realFrom;
  t("item 5: a tab that reached only part of the bill puts that part back (off the book, back on the floor)", (() => { const b = W.FIX.orders.find((o) => o.id === "b"); return b.khata_at === null && b.khata_customer_id === null && b.archived === false && b.archived_at === null; })()); }
base([ord({ id: "a" }), ord({ id: "b" })]);
{ const sb = globalThis.__sbAdmin; const realFrom = sb.from; let first = true;
  sb.from = (tbl) => { const q = realFrom(tbl); if (tbl === "orders") { const u = q.update; q.update = (p) => { if (first) { first = false; W.FIX.orders.find((o) => o.id === "a").payment_status = "paid"; } else throw new Error("put-back failed"); return u.call(q, p); }; } return q; };
  const r = await settle(two(525, 525));
  sb.from = realFrom;
  t("item 5: if putting the reached row back throws, the person is still told (409), parts still reversed", !r.ok && r.status === 409 && legs().every((l) => !!l.reversed_at)); }
// reverseSplitLegs
world({ session_payments: [{ id: "l1", session_id: "s1", restaurant_id: RID, amount: 100.1, reversed_at: null, created_at: "2026-10-09T10:00:00Z" }, { id: "l2", session_id: "s1", restaurant_id: RID, amount: 200.2, reversed_at: null, created_at: "2026-10-09T10:05:00Z" }, { id: "old", session_id: "s1", restaurant_id: RID, amount: 50, reversed_at: null, created_at: "2026-10-08T10:00:00Z" }, { id: "done", session_id: "s1", restaurant_id: RID, amount: 7, reversed_at: "2026-10-09T09:00:00Z", created_at: "2026-10-09T10:01:00Z" }, { id: "B", session_id: "s1", restaurant_id: "rid-B", amount: 9, reversed_at: null, created_at: "2026-10-09T10:02:00Z" }] });
{ const r = await P.reverseSplitLegs(globalThis.__sbAdmin, { rid: RID, sessionId: "s1", since: "2026-10-09T00:00:00Z", actor: "Asha", reason: "undo" });
  const by = (id) => W.FIX.session_payments.find((l) => l.id === id);
  t("reverseSplitLegs: reverses exactly the live parts of this session, this restaurant, since the settle (2 parts, ₹300.30)", r.reversed === 2 && r.amount === 300.3, JSON.stringify(r));
  t("…stamped with who and why, never deleted", by("l1").reversed_by === "Asha" && by("l1").reversed_reason === "undo" && W.FIX.session_payments.length === 5);
  t("…an older part, an already-reversed part and another restaurant's part are untouched", by("old").reversed_at === null && by("done").reversed_at === "2026-10-09T09:00:00Z" && by("B").reversed_at === null); }
world({ session_payments: [] });
{ const r = await P.reverseSplitLegs(globalThis.__sbAdmin, { rid: RID, sessionId: "s1", since: "2026-10-09" }); t("reverseSplitLegs: nothing to reverse → {0, 0} and no write", r.reversed === 0 && r.amount === 0 && W.WRITES.length === 0); }
world({ session_payments: [{ id: "l1", session_id: "s1", restaurant_id: RID, amount: 5, reversed_at: null, created_at: "2026-10-09T10:00:00Z" }] });
{ const r = await P.reverseSplitLegs(globalThis.__sbAdmin, { rid: RID, sessionId: "s1", since: "2026-10-09", actor: "", reason: "" }); t("reverseSplitLegs: a blank actor and reason are stored as nothing, not ''", r.reversed === 1 && W.FIX.session_payments[0].reversed_by === null && W.FIX.session_payments[0].reversed_reason === null); }
world({ session_payments: [{ id: "l1", session_id: "s1", restaurant_id: RID, amount: 5, reversed_at: null, created_at: "2026-10-09T10:00:00Z" }] }); W.FAIL["session_payments:update"] = { message: "down" };
{ let threw = ""; try { await P.reverseSplitLegs(globalThis.__sbAdmin, { rid: RID, sessionId: "s1", since: "2026-10-09" }); } catch (e) { threw = e.message; }
  t("reverseSplitLegs: if the trail cannot be corrected it THROWS (the person undoing the payment must know)", /couldn't reverse the payment legs/.test(threw), threw); }
world({ session_payments: [{ id: "l1", session_id: "s1", restaurant_id: RID, amount: "x", reversed_at: null, created_at: "2026-10-09T10:00:00Z" }] });
{ const r = await P.reverseSplitLegs(globalThis.__sbAdmin, { rid: RID, sessionId: "s1", since: "2026-10-09" }); t("reverseSplitLegs: a junk amount counts as ₹0 in the total, never NaN", r.amount === 0 && r.reversed === 1); }
world({ session_payments: [{ id: "l1", session_id: "s1", restaurant_id: RID, amount: 5, reversed_at: null, created_at: "2026-10-09T10:00:00Z" }] }); W.FAIL["session_payments:select"] = { message: "down" };
{ const r = await P.reverseSplitLegs(globalThis.__sbAdmin, { rid: RID, sessionId: "s1", since: "2026-10-09" }); t("reverseSplitLegs: if the read of the parts fails, nothing is reversed and nothing is written", r.reversed === 0 && W.WRITES.length === 0); }
// branches the first pass left unrun (coverage.mjs)
base([ord()]); W.FAIL["orders:select"] = { code: "57014" };
{ const r = await settle(two()); t("item 4: a failed read whose error has no message still gives the busy reply", !r.ok && r.status === 503); }
base([ord()]); W.FAIL["session_payments:insert"] = { code: "23505" };
{ const r = await settle(two()); t("item 6: a failed save whose error has no message still gives the plain sentence (400)", !r.ok && r.status === 400 && /record the payment parts/.test(r.message)); }
base([ord()]); W.FIX.settings = [];
{ const r = await settle(two(262.5, 262.5)); t("settle: a restaurant with no settings row prices at the 5% default (and says so by accepting ₹525)", r.ok && r.due === 525); }
t("due: a legacy order (no taxable_base) whose subtotal is junk counts ₹0", (await due([ord({ taxable_base: null, subtotal: "junk" })])) === 0);
base([ord()]); W.FAIL["session_payments:insert"] = "nodata";
{ const r = await settle(two()); t("settle: if the parts insert answers no rows, the bill is still stamped and the answer is ok (no ids to reverse later)", r.ok); }
base([ord()]); W.FAIL["session_payments:insert"] = "nodata"; W.FAIL["orders:update"] = { code: "XX000", message: "x" };
{ const r = await settle(two()); t("settle: a failed stamp with no part ids to reverse still answers the failure", !r.ok && r.status === 500 && !W.WRITES.some((w) => w.table === "session_payments" && w.op === "update")); }
base([ord()]); W.FAIL["orders:update"] = "nodata";
{ const r = await settle(two()); t("settle: a stamp that reports reaching NO rows is treated as someone else having settled it (409), parts reversed", !r.ok && r.status === 409 && legs().every((l) => !!l.reversed_at)); }
// ── round-2 mutation survivors, closed (scripts/t30-harness/mutate.mjs) ──
for (const d of [200, 1, 525]) {
  base([ord({ subtotal: d / 1.05, taxable_base: d / 1.05 })]); W.FIX.orders[0].subtotal = W.FIX.orders[0].taxable_base = Math.round(d / 1.05 * 100) / 100;
  const due = Math.round(W.FIX.orders[0].taxable_base * 1.05 * 100) / 100;
  const r = await settle([{ amount: Math.round((due / 2 + 0.01) * 100) / 100, method: "Cash" }, { amount: Math.round((due / 2 + 0.01) * 100) / 100, method: "UPI" }]);
  t(`item 23: parts exactly 2 paise over a ₹${due} bill are ACCEPTED (the same rule on every bill, counted in paise)`, r.ok, r.message || "");
}
base([ord()]);
{ const r = await settle([{ amount: 262.52, method: "Cash" }, { amount: 262.51, method: "UPI" }]); t("item 23: …and 3 paise over is refused on every bill", !r.ok && r.status === 409); }
base([ord()]);
{ await settle([{ amount: 262.5, method: "Other", note: "  table 4 card  " }, { amount: 262.5, method: "UPI" }]);
  const l = legs(); t("a part's note is stored (capped at 200, blank → nothing)", l.find((x) => x.method === "Other").note === "  table 4 card  ".slice(0, 200) && l.find((x) => x.method === "UPI").note === null); }
world({ sessions: [{ id: "s-old", restaurant_id: RID, table_number: "5", status: "open", last_activity_at: "2026-10-09T08:00:00Z" }, { id: "s-new", restaurant_id: RID, table_number: "5", status: "open", last_activity_at: "2026-10-09T11:00:00Z" }], orders: [ord({ session_id: "s-new" })], settings: [{ restaurant_id: RID, tax_rate: 0.05 }], session_payments: [] });
{ const r = await settle(two()); t("settle: with two open sessions on one table (should never exist) it settles the MOST RECENTLY ACTIVE one", r.ok && r.sessionId === "s-new"); }
