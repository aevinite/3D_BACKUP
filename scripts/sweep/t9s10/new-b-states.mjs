// scripts/sweep/t9s10/new-b-states.mjs — block B of sweep #10 T9's 500 (P178201–P178400).
// The money arithmetic and the states the happy path never visits — an empty restaurant, a read
// that fails, a mixed-rate bill, a split, a comp, a cancellation nobody answered, a switched-off
// lock — DRIVEN in memory through the real route. Every fixture names only invented rows.
import { check, world, call, SUBJECT, RID, RID2 } from "./lib.mjs";

let N = 178201;
const id = () => { if (N > 178400) throw new Error("block B is full"); return "P" + N++; };
const NOW = () => new Date().toISOString();
const OLD = "2000-01-01T00:00:00.000Z";
const bizDay = () => new Date(Date.now() + (330 - 300) * 60000).toISOString().slice(0, 10);
const C = (what, how, fn) => check(id(), `${SUBJECT} — ${what}`, how, fn);
const eq = (a, b) => Math.abs(Number(a) - Number(b)) < 0.011;

// ═══ B1 · THE DAY-CLOSE SHEET, ONE REAL-SHAPED DAY ════════════════════════════════════════════
// A: food ₹1,000 @5%, cash.  B: food ₹1,000 @5% + banquet ₹2,000 @18% on ONE bill, UPI.
// C: ₹400 on the house.  D: ₹300 @5% still unpaid.  E: ₹300 @5% settled in parts — ₹200 cash + ₹115 UPI.
// F: an open table that has paid ₹100 of a bill not yet finished.  A ₹50 leg reversed on A.
// Three cancelled tickets: one never cooked (made=false), one cooked (made=true), one never answered.
// The counter says 6 bill numbers went out; only 1–5 are on anything.
const ZO = (id_, sid, o) => ({ id: id_, restaurant_id: RID, session_id: sid, created_at: NOW(), status: "served", payment_status: "paid", tip: 0, discount: 0, nontax_amount: 0, mrp_amount: 0, ...o });
const ZFIX = {
  orders: [
    ZO("a1", "sA", { subtotal: 1000, taxable_base: 1000, tax_rate: 0.05, payment_method: "Cash", tip: 20 }),
    ZO("b1", "sB", { subtotal: 1000, taxable_base: 1000, tax_rate: 0.05, payment_method: "UPI" }),
    ZO("b2", "sB", { subtotal: 2000, taxable_base: 2000, tax_rate: 0.18, payment_method: "UPI" }),
    ZO("c1", "sC", { subtotal: 400, taxable_base: 400, tax_rate: 0.05, discount: 400, payment_method: "On the house" }),
    ZO("d1", "sD", { subtotal: 300, taxable_base: 300, tax_rate: 0.05, payment_status: "pending", payment_method: null }),
    ZO("e1", "sE", { subtotal: 300, taxable_base: 300, tax_rate: 0.05, payment_method: "Split" }),
    ZO("x1", "sX", { subtotal: 150, taxable_base: 150, tax_rate: 0.05, status: "cancelled", payment_status: "pending" }),
    ZO("x2", "sX", { subtotal: 200, taxable_base: 200, tax_rate: 0.05, status: "cancelled", payment_status: "pending" }),
    ZO("x3", "sX", { subtotal: 100, taxable_base: 100, tax_rate: 0.05, status: "cancelled", payment_status: "pending" }),
    // …and one from ANOTHER restaurant, the same day, which must change nothing.
    { id: "zz", restaurant_id: RID2, session_id: "sZ", created_at: NOW(), status: "served", payment_status: "paid", subtotal: 99999, taxable_base: 99999, tax_rate: 0.05, discount: 0, payment_method: "Cash" },
  ],
  sessions: [
    ...["sA", "sB", "sC", "sD", "sE"].map((s, i) => ({ id: s, restaurant_id: RID, bill_no: i + 1, table_number: String(i + 1), created_at: NOW(), closed_at: s === "sD" ? null : NOW(), invoice_at: OLD, void_at: OLD, invoice_voided: false, deleted_at: null })),
    { id: "sX", restaurant_id: RID, bill_no: null, table_number: "8", created_at: NOW(), closed_at: NOW(), invoice_at: OLD, void_at: OLD },
    { id: "sF", restaurant_id: RID, bill_no: null, table_number: "9", created_at: NOW(), closed_at: null, invoice_at: OLD, void_at: OLD },
  ],
  session_payments: [
    { session_id: "sE", restaurant_id: RID, amount: 200, method: "Cash", reversed_at: null, created_at: NOW() },
    { session_id: "sE", restaurant_id: RID, amount: 115, method: "UPI", reversed_at: null, created_at: NOW() },
    { session_id: "sF", restaurant_id: RID, amount: 100, method: "Cash", reversed_at: null, created_at: NOW() },
    { session_id: "sA", restaurant_id: RID, amount: 50, method: "Cash", reversed_at: NOW(), created_at: NOW() },
  ],
  deletion_audit: [
    { restaurant_id: RID, order_id: "x1", kind: "order_cancelled", at: NOW(), made: "false" },
    { restaurant_id: RID, order_id: "x2", kind: "order_cancelled", at: NOW(), made: "true" },
  ],
  daily_counters: [{ restaurant_id: RID, key: "bill", day: bizDay(), n: 6 }],
  aggregator_orders: [],
};
let Z = null;
const zday = async () => { if (Z) return Z; await world({ fix: ZFIX, rpc: { lfh_verify_bill_chain: [{ kind: "checked", seq: 5 }] } }); Z = await call("GET", "zreport"); return Z; };
const ZC = (what, f) => C(`Z-report: ${what}`, "STUB · one invented business day, every figure worked out by hand first", async () => { const z = await zday(); return f(z.json || {}, z); });
ZC("answers 200 for a manager who has the dashboard", (j, z) => ({ ok: z.status === 200, note: `${z.status}` }));
ZC("counts 6 live orders (the three cancelled ones and the other restaurant's are not orders)", (j) => ({ ok: j.dineIn?.orderCount === 6, note: `${j.dineIn?.orderCount}` }));
ZC("groups them into 5 bills — B's food and banquet are ONE bill", (j) => ({ ok: j.dineIn?.bills === 5, note: `${j.dineIn?.bills}` }));
ZC("gross is ₹5,000 (everything sold, before the comp)", (j) => ({ ok: eq(j.dineIn?.gross, 5000), note: `${j.dineIn?.gross}` }));
ZC("the only discount is the ₹400 comp", (j) => ({ ok: eq(j.dineIn?.discount, 400), note: `${j.dineIn?.discount}` }));
ZC("taxable is ₹4,600 — gross less the comp", (j) => ({ ok: eq(j.dineIn?.taxable, 4600), note: `${j.dineIn?.taxable}` }));
ZC("tax is ₹490 — B charged at 5% on its food AND 18% on its banquet (₹410), never one rate for the bill", (j) => ({ ok: eq(j.dineIn?.tax, 490), note: `${j.dineIn?.tax}` }));
ZC("net is ₹5,090, and taxable + tax + MRP = net", (j) => ({ ok: eq(j.dineIn?.net, 5090) && eq(j.dineIn.taxable + j.dineIn.tax + j.dineIn.mrp, j.dineIn.net), note: `${j.dineIn?.net}` }));
ZC("3 bills are paid (A, B, E) for ₹4,775 — the comp is NOT counted as money collected", (j) => ({ ok: j.dineIn?.paidCount === 3 && eq(j.dineIn.paidNet, 4775), note: `${j.dineIn?.paidCount} · ${j.dineIn?.paidNet}` }));
ZC("1 bill is on the house, worth ₹0 collected", (j) => ({ ok: j.dineIn?.onHouseCount === 1 && eq(j.dineIn.onHouseNet, 0), note: `${j.dineIn?.onHouseCount} · ${j.dineIn?.onHouseNet}` }));
ZC("1 bill is still unpaid, ₹315", (j) => ({ ok: j.dineIn?.unpaidCount === 1 && eq(j.dineIn.unpaidNet, 315), note: `${j.dineIn?.unpaidCount} · ${j.dineIn?.unpaidNet}` }));
ZC("paid + unpaid + on-the-house = the day's bills", (j) => ({ ok: j.dineIn.paidCount + j.dineIn.unpaidCount + j.dineIn.onHouseCount === j.dineIn.bills }));
ZC("only food that was MADE is a loss: 2 cancellations count (one cooked, one unanswered), worth ₹300", (j) => ({ ok: j.dineIn?.cancelled === 2 && eq(j.dineIn.cancelledNet, 300), note: `${j.dineIn?.cancelled} · ${j.dineIn?.cancelledNet}` }));
ZC("…the never-cooked ticket is reported apart, as costing nothing", (j) => ({ ok: j.dineIn?.cancelledNoLoss === 1, note: `${j.dineIn?.cancelledNoLoss}` }));
ZC("…and the one nobody answered is counted AND reported, so the gap is visible, not silent", (j) => ({ ok: j.dineIn?.cancelledUnanswered === 1, note: `${j.dineIn?.cancelledUnanswered}` }));
ZC("tips are their own figure (₹20), never part of revenue", (j) => ({ ok: eq(j.dineIn?.tips, 20) && eq(j.dineIn.net, 5090), note: `${j.dineIn?.tips}` }));
ZC("the till: Cash ₹1,250 over 2 bills (A's ₹1,050 + E's cash part)", (j) => { const r = (j.payments?.rows || []).find((x) => x.method === "Cash"); return { ok: !!r && eq(r.amount, 1250) && r.bills === 2, note: JSON.stringify(r) }; });
ZC("the till: UPI ₹3,525 over 2 bills (B's ₹3,410 + E's UPI part)", (j) => { const r = (j.payments?.rows || []).find((x) => x.method === "UPI"); return { ok: !!r && eq(r.amount, 3525) && r.bills === 2, note: JSON.stringify(r) }; });
ZC("the till never prints the word 'Split' — a bill settled in parts is told by its parts", (j) => ({ ok: !(j.payments?.rows || []).some((x) => x.method === "Split") }));
ZC("the till's total equals the money collected (₹4,775), so the drawer reconciles", (j) => ({ ok: eq(j.payments?.total, j.dineIn?.paidNet), note: `${j.payments?.total} vs ${j.dineIn?.paidNet}` }));
ZC("the reversed ₹50 leg is reported on its own line, never in the till", (j) => ({ ok: eq(j.payments?.reversed, 50) && j.payments.reversedCount === 1 }));
ZC("the ₹100 taken from a table still sitting is 'aside', not today's takings", (j) => ({ ok: eq(j.payments?.aside, 100) && j.payments.asideCount === 1 }));
ZC("the comp bill puts nothing in the till", (j) => ({ ok: !(j.payments?.rows || []).some((x) => x.method === "On the house") }));
ZC("numbering: the counter's 6 numbers, 5 of them on file", (j) => ({ ok: j.numbering?.issued === 6 && j.numbering.onFile === 5 && j.numbering.from === 1 && j.numbering.to === 6, note: JSON.stringify(j.numbering) }));
ZC("numbering: number 6 is named as on nothing at all, with the real count", (j) => ({ ok: JSON.stringify(j.numbering?.unaccounted) === "[6]" && j.numbering.unaccountedTotal === 1 }));
ZC("numbering: an ordinary settled bill is not listed as flagged (the don't-cry-wolf rule)", (j) => ({ ok: (j.numbering?.flagged || []).length === 0, note: JSON.stringify(j.numbering?.flagged) }));
ZC("the other restaurant's ₹99,999 order is nowhere in it", (z, raw) => ({ ok: !raw.text.includes("99999") }));
ZC("GRAND TOTAL is money collected plus platform revenue — never the still-open bills", (j) => ({ ok: eq(j.grandTotal, 4775), note: `${j.grandTotal}` }));
ZC("the signed ledger line rides along (5 bills checked, no problems)", (j) => ({ ok: j.chain?.ok === true && j.chain.bills === 5, note: JSON.stringify(j.chain) }));
ZC("its restaurant name and GSTIN are this restaurant's own", (j) => ({ ok: j.restaurant?.name === "French House" && j.restaurant.gstin === "24AAAAA0000A1Z5" }));
ZC("the sheet carries the window it covers (since = this business day's 05:00 IST)", (j) => ({ ok: typeof j.since === "string" && /T23:30:00\.000Z$/.test(j.since), note: j.since }));
// ── B2 · the day-close sheet in the states nobody sees on a normal night ─────────────────────
C("Z-report on an EMPTY restaurant: every figure is zero, nothing is NaN, numbering says 0 issued", "STUB · no rows at all",
  async () => { await world(); const z = await call("GET", "zreport"); const t = z.text;
    return { ok: z.status === 200 && z.json.dineIn.bills === 0 && z.json.numbering.issued === 0 && z.json.numbering.from === 0 && !/NaN|null,"net"|undefined/.test(t), note: `${z.status} · ${t.length} bytes` }; });
C("Z-report when the bill verifier cannot run: the sheet still prints every figure and says 'could not be checked'", "STUB · lfh_verify_bill_chain answers an error",
  async () => { await world({ fix: ZFIX, fail: { "rpc:lfh_verify_bill_chain": "error" } }); const z = await call("GET", "zreport");
    return { ok: z.status === 200 && z.json.chain?.ok === false && z.json.chain.error === "could not be checked" && eq(z.json.dineIn.net, 5090), note: JSON.stringify(z.json?.chain) }; });
C("Z-report when the verifier throws outright: same — the day-close is never the casualty", "STUB · the verifier unreachable",
  async () => { await world({ fix: ZFIX, fail: { "rpc:lfh_verify_bill_chain": "throw" } }); const z = await call("GET", "zreport");
    return { ok: z.status === 200 && z.json.chain?.ok === false, note: `${z.status}` }; });
C("Z-report when the orders read fails: a plain sentence and a 5xx, never Postgres prose or a stub message", "STUB · orders read errors",
  async () => { await world({ fix: ZFIX, fail: { "orders:select": "error" } }); const z = await call("GET", "zreport");
    return { ok: z.status >= 500 && !/stub:/.test(z.text) && (z.json?.error || "").length > 10, note: `${z.status} "${z.json?.error}"` }; });
C("…and that failure is written to the error board naming WHICH read failed (GET zreport)", "STUB · the error diary",
  async () => { const G = await world({ fix: ZFIX, fail: { "orders:select": "error" } }); await call("GET", "zreport");
    const e = G.ERRORS.find((x) => x.action === "route_error"); return { ok: !!e && e.detail === "GET zreport" && e.restaurant_id === RID, note: JSON.stringify(e) }; });
C("Z-report pages past the database's ~1,000-row cap: 2,500 orders are all counted", "STUB · paging honoured, 2,500 invented orders",
  async () => { const many = Array.from({ length: 2500 }, (_, i) => ZO(`m${i}`, `sm${i}`, { subtotal: 10, taxable_base: 10, tax_rate: 0.05, payment_method: "Cash" }));
    await world({ fix: { orders: many } }); const z = await call("GET", "zreport");
    return { ok: z.json?.dineIn?.orderCount === 2500 && eq(z.json.dineIn.gross, 25000), note: `${z.json?.dineIn?.orderCount}` }; });
C("Z-report: a bill whose every order was cancelled is flagged 'cancelled' beside its number", "STUB · one numbered, all-cancelled bill",
  async () => { await world({ fix: { orders: [ZO("q1", "sQ", { subtotal: 50, status: "cancelled", payment_status: "pending" })], sessions: [{ id: "sQ", restaurant_id: RID, bill_no: 1, table_number: "4", created_at: NOW(), closed_at: NOW(), invoice_at: OLD, void_at: OLD }], daily_counters: [{ restaurant_id: RID, key: "bill", day: bizDay(), n: 1 }] } });
    const z = await call("GET", "zreport"); const f = (z.json?.numbering?.flagged || [])[0];
    return { ok: !!f && f.no === 1 && /cancelled/.test(f.note) && z.json.numbering.unaccountedTotal === 0, note: JSON.stringify(f) }; });
C("Z-report: a binned bill keeps its number and is flagged 'deleted — <reason>' (a sale can be cancelled, never disappear)", "STUB · a soft-deleted numbered session",
  async () => { await world({ fix: { orders: [ZO("q2", "sQ2", { subtotal: 50 })], sessions: [{ id: "sQ2", restaurant_id: RID, bill_no: 1, table_number: "4", created_at: NOW(), closed_at: NOW(), deleted_at: NOW(), delete_reason: "test bill", invoice_at: OLD, void_at: OLD }], daily_counters: [{ restaurant_id: RID, key: "bill", day: bizDay(), n: 1 }] } });
    const z = await call("GET", "zreport"); const f = (z.json?.numbering?.flagged || [])[0];
    return { ok: !!f && /deleted — test bill/.test(f.note) && eq(z.json.dineIn.gross, 50), note: JSON.stringify(f) }; });
C("Z-report: an invoice voided today is counted under invoicesVoided", "STUB · a session with void_at today",
  async () => { await world({ fix: { sessions: [{ id: "sV", restaurant_id: RID, created_at: NOW(), invoice_at: NOW(), void_at: NOW(), closed_at: NOW() }] } });
    const z = await call("GET", "zreport"); return { ok: z.json?.invoicesVoided === 1 && z.json.invoicesGenerated === 1, note: `${z.json?.invoicesGenerated}/${z.json?.invoicesVoided}` }; });
C("Z-report: platform revenue leaves out cancelled and still-'new' delivery orders", "STUB · four aggregator rows",
  async () => { await world({ fix: { aggregator_orders: [
    { restaurant_id: RID, total: 100, status: "accepted", created_at: NOW() }, { restaurant_id: RID, total: 200, status: "handed_over", created_at: NOW() },
    { restaurant_id: RID, total: 400, status: "new", created_at: NOW() }, { restaurant_id: RID, total: 800, status: "cancelled", created_at: NOW() }] } });
    const z = await call("GET", "zreport"); return { ok: z.json?.platform?.count === 2 && eq(z.json.platform.revenue, 300) && eq(z.json.grandTotal, 300), note: JSON.stringify(z.json?.platform) }; });
C("Z-report: a cancelled PARCEL's number is flagged '<source> · cancelled' (numbers are one series, mig 261)", "STUB · one cancelled parcel",
  async () => { await world({ fix: { aggregator_orders: [{ restaurant_id: RID, bill_no: 1, status: "cancelled", source: "parcel", created_at: NOW(), total: 0 }], daily_counters: [{ restaurant_id: RID, key: "bill", day: bizDay(), n: 1 }] } });
    const z = await call("GET", "zreport"); const f = (z.json?.numbering?.flagged || [])[0];
    return { ok: !!f && f.note === "parcel · cancelled" && z.json.numbering.unaccountedTotal === 0, note: JSON.stringify(f) }; });
C("Z-report: a legacy order with no stamped rate is taxed at the restaurant's settings rate", "STUB · tax_rate null",
  async () => { await world({ fix: { orders: [ZO("l1", "sL", { subtotal: 1000, taxable_base: null, tax_rate: null, payment_method: "Cash" })] } });
    const z = await call("GET", "zreport"); return { ok: eq(z.json?.dineIn?.tax, 50), note: `${z.json?.dineIn?.tax}` }; });
C("Z-report: a stamped ZERO rate is a real 0%, never 'missing' (no tax charged)", "STUB · tax_rate 0",
  async () => { await world({ fix: { orders: [ZO("l2", "sL2", { subtotal: 1000, taxable_base: 1000, tax_rate: 0, payment_method: "Cash" })] } });
    const z = await call("GET", "zreport"); return { ok: eq(z.json?.dineIn?.tax, 0) && eq(z.json.dineIn.net, 1000), note: `${z.json?.dineIn?.tax}` }; });
C("Z-report: an MRP bottle is its own line and never discounted (mig 270/272)", "STUB · ₹500 food + ₹200 MRP, ₹600 comp asked",
  async () => { await world({ fix: { orders: [ZO("m1", "sM", { subtotal: 700, taxable_base: 500, nontax_amount: 200, mrp_amount: 200, tax_rate: 0.05, discount: 600, payment_method: "Cash" })] } });
    const z = await call("GET", "zreport"); const d = z.json?.dineIn || {};
    return { ok: eq(d.mrp, 200) && eq(d.discount, 500) && eq(d.taxable, 0) && eq(d.net, 200), note: `mrp ${d.mrp} disc ${d.discount} taxable ${d.taxable} net ${d.net}` }; });

// ═══ B3 · THE GST REPORT ══════════════════════════════════════════════════════════════════════
const gst = async (reach, query = "", fix = {}) => { await world({ accessConfig: reach ? { view_dashboard: { manager_opts: { range: reach } } } : {}, fix }); return call("GET", "gst-report", { query }); };
const istMonth = (d = 0) => { const n = new Date(Date.now() + 5.5 * 3600e3); return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth() + d, 1)).toISOString().slice(0, 7); };
C("GST report on a today-only reach: no month picker, the window said as 'today'", "STUB · reach today, ?month= asked",
  async () => { const r = await gst("today", `?month=${istMonth(-1)}`); return { ok: r.json?.monthMode === false && r.json.months.length === 0 && r.json.windowLabel === "today" && r.json.month === istMonth(0), note: JSON.stringify({ m: r.json?.month, l: r.json?.windowLabel }) }; });
C("GST report on an unset reach behaves exactly as today-only", "STUB · no reach stored",
  async () => { const r = await gst(null); return { ok: r.json?.monthMode === false && r.json.reach === "today", note: r.json?.reach }; });
C("GST report on a 2-day reach says 'today and yesterday'", "STUB · reach today_yesterday",
  async () => { const r = await gst("today_yesterday"); return { ok: r.json?.windowLabel === "today and yesterday" && r.json.monthMode === false }; });
C("GST report on a 7-day reach says 'the last 7 days'", "STUB · reach last7",
  async () => { const r = await gst("last7"); return { ok: r.json?.windowLabel === "the last 7 days" && r.json.monthMode === false }; });
C("GST report on the 30-day rung offers this month AND last month — and only those", "STUB · reach last30",
  async () => { const r = await gst("last30"); return { ok: r.json?.monthMode === true && JSON.stringify(r.json.months) === JSON.stringify([istMonth(0), istMonth(-1)]), note: JSON.stringify(r.json?.months) }; });
C("…last month, when asked for, is honoured", "STUB · reach last30, ?month=<last month>",
  async () => { const r = await gst("last30", `?month=${istMonth(-1)}`); return { ok: r.json?.month === istMonth(-1), note: r.json?.month }; });
C("…a month further back is answered with THIS month, never an error", "STUB · reach last30, ?month=2020-01",
  async () => { const r = await gst("last30", "?month=2020-01"); return { ok: r.status === 200 && r.json?.month === istMonth(0), note: r.json?.month }; });
C("…a nonsense month is answered with this month, never an error", "STUB · ?month=banana",
  async () => { const r = await gst("last30", "?month=banana"); return { ok: r.status === 200 && r.json?.month === istMonth(0) }; });
C("…a malformed but month-shaped value (2026-13) cannot crash the window either", "STUB · ?month=2026-13",
  async () => { const r = await gst("last30", "?month=2026-13"); return { ok: r.status === 200, note: `${r.status} ${r.json?.month}` }; });
const GSTFIX = { orders: [
  ZO("g1", "sG", { subtotal: 1000, taxable_base: 1000, tax_rate: 0.05 }), ZO("g2", "sG", { subtotal: 2000, taxable_base: 2000, tax_rate: 0.18 }),
  ZO("g3", "sH", { subtotal: 300, taxable_base: 300, tax_rate: 0.05, payment_status: "pending" }),
  ZO("g4", "sI", { subtotal: 900, taxable_base: 900, tax_rate: 0.05, status: "cancelled" }),
  ZO("g5", "sJ", { subtotal: 700, taxable_base: 500, nontax_amount: 200, tax_rate: 0.05 }),
] };
C("GST report: a mixed-rate bill is taxed at each order's own rate (₹50 + ₹360)", "STUB · today, one bill 5% + 18%",
  async () => { const r = await gst("today", "", GSTFIX); return { ok: eq(r.json?.totals?.tax, 435), note: `tax ${r.json?.totals?.tax} (410 + 25 on the MRP bill's food)` }; });
C("GST report: unpaid and cancelled bills are not on the filing", "STUB · same day",
  async () => { const r = await gst("today", "", GSTFIX); return { ok: r.json?.totals?.bills === 2, note: `${r.json?.totals?.bills} bills` }; });
C("GST report: MRP turnover is its own line and the note says so", "STUB · same day",
  async () => { const r = await gst("today", "", GSTFIX); return { ok: eq(r.json?.totals?.mrp, 200) && /MRP \/ nil-rated turnover is listed separately/.test(r.json.note), note: `${r.json?.totals?.mrp}` }; });
C("GST report: taxable + tax + MRP = gross, to the paisa", "STUB · same day",
  async () => { const r = await gst("today", "", GSTFIX); const t = r.json?.totals || {}; return { ok: eq(t.taxable + t.tax + t.mrp, t.gross), note: `${t.taxable}+${t.tax}+${t.mrp} vs ${t.gross}` }; });
C("GST report: CGST + SGST add back to the total tax exactly (the last part absorbs the rounding)", "STUB · components 2.5% + 2.5%",
  async () => { await world({ settings: { tax_components: [{ label: "CGST", rate: 0.025 }, { label: "SGST", rate: 0.025 }] }, fix: { orders: [ZO("h1", "sK", { subtotal: 333.33, taxable_base: 333.33, tax_rate: 0.05 })] } });
    const r = await call("GET", "gst-report"); const sum = (r.json?.components || []).reduce((a, c) => a + c.amount, 0);
    return { ok: (r.json?.components || []).length === 2 && eq(sum, r.json.totals.tax), note: `${JSON.stringify(r.json?.components)} vs ${r.json?.totals?.tax}` }; });
C("GST report: the day rows add back to the window's total", "STUB · same day",
  async () => { const r = await gst("today", "", GSTFIX); const s = (r.json?.days || []).reduce((a, d) => a + d.gross, 0); return { ok: eq(s, r.json?.totals?.gross), note: `${s}` }; });
C("GST report on an empty restaurant: zero bills, empty days, no NaN", "STUB · nothing",
  async () => { const r = await gst("today"); return { ok: r.json?.totals?.bills === 0 && (r.json.days || []).length === 0 && !/NaN/.test(r.text) }; });
C("GST report: the restaurant's own name and GSTIN head the filing", "STUB",
  async () => { const r = await gst("today"); return { ok: r.json?.restaurant?.name === "French House" && r.json.restaurant.gstin === "24AAAAA0000A1Z5" }; });
C("GST report: 'ratePct' is the restaurant's effective rate as a percentage", "STUB · settings tax 5%",
  async () => { const r = await gst("today"); return { ok: r.json?.ratePct === 5, note: `${r.json?.ratePct}` }; });

// ═══ B4 · THE DASHBOARD ═══════════════════════════════════════════════════════════════════════
const stats = async (reach, range, fix = {}) => { await world({ accessConfig: reach ? { view_dashboard: { manager_opts: { range: reach } } } : {}, fix }); return call("GET", "stats", { query: range ? `?range=${range}` : "" }); };
C("Dashboard: ?range=year on a today-only reach is answered as today, never an error", "STUB · reach today",
  async () => { const r = await stats("today", "year"); return { ok: r.status === 200 && r.json?.range === "today", note: r.json?.range }; });
C("Dashboard: 'yesterday' needs the two-day rung — on today-only it is answered as today", "STUB · reach today, ?range=yesterday",
  async () => { const r = await stats("today", "yesterday"); return { ok: r.json?.range === "today" }; });
C("Dashboard: on the two-day rung 'yesterday' is honoured", "STUB · reach today_yesterday",
  async () => { const r = await stats("today_yesterday", "yesterday"); return { ok: r.json?.range === "yesterday" }; });
C("Dashboard: last7 is refused (answered as today) on the two-day rung", "STUB · reach today_yesterday, ?range=last7",
  async () => { const r = await stats("today_yesterday", "last7"); return { ok: r.json?.range === "today" }; });
C("Dashboard: on the 7-day rung last7 draws 7 daily points, and its ghost line has 7 too", "STUB · reach last7",
  async () => { const r = await stats("last7", "last7"); return { ok: r.json?.range === "last7" && r.json.series.length === 7 && r.json.prev.series.length === 7, note: `${r.json?.series?.length}/${r.json?.prev?.series?.length}` }; });
C("Dashboard: a single day draws 24 hourly points", "STUB · today",
  async () => { const r = await stats("today", "today"); return { ok: r.json?.series?.length === 24 && r.json.prev.series.length === 24 && r.json.hours.length === 24 }; });
const DFIX = { orders: [
  ZO("d1", "s1", { subtotal: 1000, total: 1050, payment_method: "Cash", items: [{ id: "i1", title: "Paneer", qty: 2, price: 500 }] }),
  ZO("d2", "s1", { subtotal: 500, total: 525, discount: 100, payment_method: "Cash", items: [{ id: "i2", title: "Naan", qty: 5, price: 100 }] }),
  ZO("d3", "s2", { subtotal: 300, total: 315, payment_status: "pending", items: [] }),
  ZO("d4", "s3", { subtotal: 800, total: 840, deleted_at: NOW(), payment_method: "Cash", items: [] }),
  ZO("d5", "s4", { subtotal: 200, total: 210, status: "cancelled", payment_status: "pending", items: [] }),
  ZO("d6", "s5", { subtotal: 100, total: 105, status: "cancelled", payment_status: "pending", items: [] }),
], deletion_audit: [{ restaurant_id: RID, order_id: "d6", kind: "order_cancelled", at: NOW(), made: "false" }], menu_items: [{ id: "i1", restaurant_id: RID, title: "Paneer", category: "mains" }] };
C("Dashboard: a binned bill is not counted (owner, 2026-08-04: 'it will delete from manager')", "STUB · one deleted paid order",
  async () => { const r = await stats("today", "today", DFIX); return { ok: r.json?.paid === 2 && !JSON.stringify(r.json).includes("840"), note: `${r.json?.paid} paid` }; });
C("Dashboard: revenue is per BILL, discount grossed at the rate — (1050+525) − 100×1.05 = ₹1,470", "STUB",
  async () => { const r = await stats("today", "today", DFIX); return { ok: eq(r.json?.revenue, 1470), note: `${r.json?.revenue}` }; });
C("Dashboard: the average is per paid BILL, not per order (₹1,470 / 1 bill)", "STUB",
  async () => { const r = await stats("today", "today", DFIX); return { ok: eq(r.json?.avgOrder, 1470), note: `${r.json?.avgOrder}` }; });
C("Dashboard: orderCount = paid + unpaid, never counting the cancelled", "STUB",
  async () => { const r = await stats("today", "today", DFIX); return { ok: r.json?.orderCount === 3 && r.json.paid + r.json.unpaid === 3 }; });
C("Dashboard: a cancelled ticket nobody cooked is 'no loss', the other one is lost business", "STUB",
  async () => { const r = await stats("today", "today", DFIX); return { ok: r.json?.cancelled === 1 && r.json.cancelledNoLoss === 1 && r.json.cancelledUnanswered === 1, note: `${r.json?.cancelled}/${r.json?.cancelledNoLoss}/${r.json?.cancelledUnanswered}` }; });
C("Dashboard: top dishes count units (Naan ×5 before Paneer ×2)", "STUB",
  async () => { const r = await stats("today", "today", DFIX); return { ok: JSON.stringify(r.json?.topDishes?.[0]) === JSON.stringify(["Naan", 5]), note: JSON.stringify(r.json?.topDishes) }; });
C("Dashboard: a dish missing from the menu map is bucketed 'other', never undefined", "STUB · Naan not in menu_items",
  async () => { const r = await stats("today", "today", DFIX); return { ok: r.json?.cats?.other === 5 && !("undefined" in (r.json?.cats || {})), note: JSON.stringify(r.json?.cats) }; });
C("Dashboard: payment methods are per bill (Cash: 1 bill)", "STUB",
  async () => { const r = await stats("today", "today", DFIX); const c = (r.json?.paymentMethods || []).find((x) => x[0] === "Cash"); return { ok: !!c && c[2] === 1, note: JSON.stringify(r.json?.paymentMethods) }; });
C("Dashboard: the old heatmap field is an empty array, so an older cached panel cannot throw", "STUB",
  async () => { const r = await stats("today", "today"); return { ok: Array.isArray(r.json?.heatmap) && r.json.heatmap.length === 0 }; });
C("Dashboard: parcel is always a counted channel (it is permanent)", "STUB",
  async () => { const r = await stats("today", "today"); return { ok: r.json?.channelsOn?.parcel === true }; });
C("Dashboard on an empty restaurant: zeros everywhere, no NaN, biggestBill null", "STUB",
  async () => { const r = await stats("today", "today"); return { ok: r.json?.revenue === 0 && r.json.biggestBill === null && !/NaN/.test(r.text) }; });
C("Dashboard: 'open tables' is a head COUNT of open sessions — it cannot be capped at 1,000", "STUB · 3 open sessions",
  async () => { const r = await stats("today", "today", { sessions: [1, 2, 3].map((i) => ({ id: `os${i}`, restaurant_id: RID, status: "open" })) }); return { ok: r.json?.live?.dineIn === 3, note: `${r.json?.live?.dineIn}` }; });
C("Dashboard: a failed open-sessions count raises instead of reporting '0 tables open'", "STUB · sessions read errors",
  async () => { await world({ fail: { "sessions:select": "error" } }); const r = await call("GET", "stats"); return { ok: r.status >= 500, note: `${r.status}` }; });
C("Staff watch: ?range=year on a today-only reach is answered as today", "STUB · reach today",
  async () => { await world(); const r = await call("GET", "staff-risk", { query: "?range=year" }); return { ok: r.status === 200 && r.json?.range === "today" && Array.isArray(r.json.rows) }; });
C("Staff watch: last30 is honoured on the 30-day rung", "STUB · reach last30",
  async () => { await world({ accessConfig: { view_dashboard: { manager_opts: { range: "last30" } } } }); const r = await call("GET", "staff-risk", { query: "?range=last30" }); return { ok: r.json?.range === "last30" }; });

// ═══ B5 · WHO AM I — what the panel shows must be what the server allows ════════════════════
const who = async (o = {}, query = "") => { await world(o); return call("GET", "whoami", { query }); };
C("whoami for a manager: actor manager, no higher view, not the admin", "STUB",
  async () => { const r = await who(); return { ok: r.json?.actor === "manager" && r.json.higherView === false && r.json.isAdmin === false }; });
C("whoami for a manager: no Delete-bill button, ever (R27)", "STUB",
  async () => { const r = await who(); return { ok: r.json?.canDeleteBill === false }; });
C("whoami for the admin console: Delete-bill true (the only door), isAdmin, nothing hidden", "STUB · admin",
  async () => { const r = await who({ who: "admin" }); return { ok: r.json?.canDeleteBill === true && r.json.isAdmin === true && r.json.tabsOff.length === 0 && r.json.settingsOff.length === 0 }; });
C("whoami for the OWNER: no Delete-bill either — the owner is inside the restaurant (R27)", "STUB · owner",
  async () => { const r = await who({ who: "owner" }); return { ok: r.json?.canDeleteBill === false && r.json.higherView === true, note: `${r.json?.canDeleteBill}` }; });
C("whoami: a manager may not change log retention, and is told why", "STUB",
  async () => { const r = await who(); return { ok: r.json?.retention?.canEdit === false && r.json.retention.why === "retention_manager_blocked" }; });
C("whoami: the owner may, while the admin has not locked it", "STUB · owner, no lock row",
  async () => { const r = await who({ who: "owner" }); return { ok: r.json?.retention?.canEdit === true && r.json.retention.locked === false }; });
C("whoami: once the admin LOCKS it the owner may not, and the panel is told 'retention_locked'", "STUB · app_config lock row",
  async () => { const r = await who({ who: "owner", fix: { app_config: [{ key: "log_retention_lock", value: { locked: true, at: "2026-10-01T00:00:00Z" } }] } });
    return { ok: r.json?.retention?.canEdit === false && r.json.retention.why === "retention_locked" && r.json.retention.lockedAt === "2026-10-01T00:00:00Z" }; });
C("whoami: a FAILED read of the lock is treated as locked, never as unlocked", "STUB · app_config read errors",
  async () => { const r = await who({ who: "owner", fail: { "app_config:select": "error" } }); return { ok: r.json?.retention?.locked === true && r.json.retention.canEdit === false }; });
C("whoami: the admin's 'view as a manager' (?view=real) answers exactly as a real manager", "STUB · admin, ?view=real",
  async () => { const r = await who({ who: "admin" }, "?view=real"); return { ok: r.json?.actor === "manager" && r.json.simulated === true && r.json.canDeleteBill === false && r.json.retention.canEdit === false && r.json.higherView === false }; });
C("whoami: ?view=real from a REAL manager changes nothing (it is the admin's lens only)", "STUB · manager, ?view=real",
  async () => { const r = await who({}, "?view=real"); return { ok: r.json?.simulated === false && r.json.actor === "manager" }; });
C("whoami: a manager's menu parts on an unconfigured restaurant are the Access screen's defaults (3D off)", "STUB · no manager_opts",
  async () => { const r = await who(); const m = r.json?.menuSub || {}; return { ok: m.edit_3d === false && m.add_dish === true && m.edit_price === true, note: JSON.stringify(m) }; });
C("whoami: a stored 'Change a price: off' reaches the manager's menuSub as false", "STUB · edit_menu.manager_opts.edit_price=false",
  async () => { const r = await who({ accessConfig: { edit_menu: { manager_opts: { edit_price: false } } } }); return { ok: r.json?.menuSub?.edit_price === false && r.json.menuSub.add_dish === true }; });
C("whoami: the owner gets every menu part except the 3D model", "STUB · owner",
  async () => { const r = await who({ who: "owner" }); const m = r.json?.menuSub || {}; return { ok: m.edit_3d === false && Object.entries(m).filter(([k]) => k !== "edit_3d").every(([, v]) => v === true) }; });
C("whoami: the admin gets all nine, 3D included", "STUB · admin",
  async () => { const r = await who({ who: "admin" }); const m = r.json?.menuSub || {}; return { ok: Object.keys(m).length === 9 && Object.values(m).every((v) => v === true) }; });
C("whoami: menuSubTint is always the MANAGER's answer, so the admin can see what a manager lacks", "STUB · admin, edit_3d default off",
  async () => { const r = await who({ who: "admin" }); return { ok: r.json?.menuSubTint?.edit_3d === false }; });
C("whoami: the log views default ON for a manager", "STUB",
  async () => { const r = await who(); return { ok: JSON.stringify(r.json?.logParts) === JSON.stringify({ removals: true, activity: true, customers: true }) }; });
C("whoami: a switched-off Customers view reaches the manager's logParts", "STUB · customers=false",
  async () => { const r = await who({ accessConfig: { view_logs: { manager_opts: { customers: false } } } }); return { ok: r.json?.logParts?.customers === false && r.json.logParts.removals === true }; });
C("whoami: …but not the owner's — managers only", "STUB · owner",
  async () => { const r = await who({ who: "owner", accessConfig: { view_logs: { manager_opts: { customers: false } } } }); return { ok: r.json?.logParts?.customers === true }; });
C("whoami: a switched-off Rating review tab is in the manager's tabsOff", "STUB · menus.manager.ratings=false",
  async () => { const r = await who({ accessConfig: { menus: { manager: { ratings: false } } } }); return { ok: JSON.stringify(r.json?.tabsOff) === '["ratings"]' }; });
C("whoami: …and the admin gets it in tabsTint instead (marked, not removed)", "STUB · admin",
  async () => { const r = await who({ who: "admin", accessConfig: { menus: { manager: { ratings: false } } } }); return { ok: r.json?.tabsOff.length === 0 && JSON.stringify(r.json.tabsTint) === '["ratings"]' }; });
C("whoami: a switched-off Sections section is in the manager's settingsOff (the panel hides it; item 1 refuses it)", "STUB · mgrset.access=false",
  async () => { const r = await who({ accessConfig: { menus: { mgrset: { access: false } } } }); return { ok: JSON.stringify(r.json?.settingsOff) === '["access"]' }; });
C("whoami: the dashboard reach the panel draws its rail from is the one /stats clamps to", "STUB · reach last7",
  async () => { const r = await who({ accessConfig: { view_dashboard: { manager_opts: { range: "last7" } } } }); return { ok: r.json?.dashReach === "last7" }; });
C("whoami: an unknown stored reach falls back to 'today'", "STUB · range='decade'",
  async () => { const r = await who({ accessConfig: { view_dashboard: { manager_opts: { range: "decade" } } } }); return { ok: r.json?.dashReach === "today" }; });
C("whoami: the bills reach defaults to today", "STUB",
  async () => { const r = await who(); return { ok: r.json?.billsReach === "today" }; });
C("whoami: the admin's discount cap is null (uncapped)", "STUB · admin",
  async () => { const r = await who({ who: "admin" }); return { ok: r.json?.discountCapPct === null, note: `${r.json?.discountCapPct}` }; });
C("whoami: a manager's discount cap is a number", "STUB",
  async () => { const r = await who(); return { ok: typeof r.json?.discountCapPct === "number", note: `${r.json?.discountCapPct}` }; });
C("whoami: every module-backed capability gets an entry in features (khata, banquet, table_ops, take_orders…)", "STUB",
  async () => { const r = await who(); const f = r.json?.features || {}; return { ok: ["khata", "banquet", "table_ops", "take_orders"].every((k) => k in f), note: Object.keys(f).join(",") }; });
C("whoami: a manager's own 'off' override for give_discounts makes effectivePowers say false", "STUB · permissions.give_discounts='off'",
  async () => { const r = await who({ user: { permissions: { give_discounts: "off" } } }); return { ok: r.json?.effectivePowers?.give_discounts === false }; });
C("whoami: the feature half switched off is reported as offByAdmin", "STUB · access_config.give_discounts.on=false",
  async () => { const r = await who({ accessConfig: { give_discounts: { on: false } } }); return { ok: r.json?.offByAdmin?.give_discounts === true && r.json.effectivePowers.give_discounts === false }; });
C("whoami: a module that is off zeroes its power in effectivePowers (khata off → khata false)", "STUB · khata module off",
  async () => { const r = await who(); return { ok: r.json?.effectivePowers?.khata === false, note: `${r.json?.effectivePowers?.khata}` }; });
C("whoami: makes no write of any kind", "STUB",
  async () => { const G = await world(); await call("GET", "whoami"); return { ok: G.WRITES.length === 0 }; });

// ═══ B6 · THE SMALLER READS, AT THEIR EDGES ═══════════════════════════════════════════════════
C("customer-recognize with no phone answers {known:false} without asking the database", "STUB",
  async () => { const G = await world(); const r = await call("GET", "customer-recognize"); return { ok: r.json?.known === false && G.RPCS.length === 0 }; });
C("customer-recognize trims a 30-character phone to 20 before it reaches the database", "STUB",
  async () => { const G = await world({ rpc: { lfh_recognize_customer: { known: false } } }); await call("GET", "customer-recognize", { query: "?phone=" + "9".repeat(30) });
    const a = G.RPCS[0]?.args?.p_phone || ""; return { ok: a.length === 20, note: `${a.length}` }; });
C("customer-recognize: a database failure is a sentence, never the database's own words", "STUB · rpc errors",
  async () => { await world({ fail: { "rpc:lfh_recognize_customer": "error" } }); const r = await call("GET", "customer-recognize", { query: "?phone=9876543210" });
    return { ok: r.status >= 500 && !/stub/.test(r.text), note: `${r.status} "${r.json?.error}"` }; });
C("customer-search under 3 digits answers an empty list without asking", "STUB · q=98",
  async () => { const G = await world(); const r = await call("GET", "customer-search", { query: "?q=98" }); return { ok: Array.isArray(r.json?.matches) && r.json.matches.length === 0 && G.RPCS.length === 0 }; });
C("customer-search keeps only digits ('+91 98-765' → 9198765)", "STUB",
  async () => { const G = await world({ rpc: { lfh_customer_phone_search: [] } }); await call("GET", "customer-search", { query: "?q=" + encodeURIComponent("+91 98-765") }); return { ok: G.RPCS[0]?.args?.p_prefix === "9198765", note: G.RPCS[0]?.args?.p_prefix }; });
C("customer-search caps the prefix at 15 digits", "STUB",
  async () => { const G = await world({ rpc: { lfh_customer_phone_search: [] } }); await call("GET", "customer-search", { query: "?q=" + "1".repeat(25) }); return { ok: (G.RPCS[0]?.args?.p_prefix || "").length === 15 }; });
C("customer-search asks for 12 rows and says the answer is NOT whole when 12 come back", "STUB · 12 matches",
  async () => { await world({ rpc: { lfh_customer_phone_search: Array.from({ length: 12 }, (_, i) => ({ phone: `98765${i}` })) } }); const r = await call("GET", "customer-search", { query: "?q=98765" });
    return { ok: r.json?.whole === false && r.json.matches.length === 12 }; });
C("…and IS whole when fewer come back, so the sheet may narrow it on the device", "STUB · 3 matches",
  async () => { await world({ rpc: { lfh_customer_phone_search: [{}, {}, {}] } }); const r = await call("GET", "customer-search", { query: "?q=98765" }); return { ok: r.json?.whole === true }; });
C("customer-search: a non-array answer from the database is read as no matches, not a crash", "STUB · rpc answers an object",
  async () => { await world({ rpc: { lfh_customer_phone_search: { weird: true } } }); const r = await call("GET", "customer-search", { query: "?q=98765" }); return { ok: r.status === 200 && r.json.matches.length === 0 }; });
const BQ = { banquet_allowed: true, banquet_owner_control: false, banquet_enabled: true };
C("banquet/bill with no id says 'id required' (400)", "STUB · banquet on",
  async () => { await world({ settings: BQ }); const r = await call("GET", "banquet/bill"); return { ok: r.status === 400 && r.json?.error === "id required" }; });
C("banquet/bill for an unknown id is 404 'bill not found'", "STUB",
  async () => { await world({ settings: BQ }); const r = await call("GET", "banquet/bill", { query: "?id=nope" }); return { ok: r.status === 404 }; });
C("banquet/bill returns its frozen bill AND the order it came from", "STUB · bill with order",
  async () => { await world({ settings: BQ, fix: { banquet_bills: [{ id: "bb1", restaurant_id: RID, order_id: "bo1", total: 500 }], orders: [{ id: "bo1", restaurant_id: RID, total: 500 }] } });
    const r = await call("GET", "banquet/bill", { query: "?id=bb1" }); return { ok: r.json?.bill?.id === "bb1" && r.json.order?.id === "bo1" }; });
C("banquet/bill with no linked order answers order:null rather than failing", "STUB",
  async () => { await world({ settings: BQ, fix: { banquet_bills: [{ id: "bb2", restaurant_id: RID, order_id: null }] } }); const r = await call("GET", "banquet/bill", { query: "?id=bb2" }); return { ok: r.status === 200 && r.json.order === null }; });
C("banquet/bills: a search with the PostgREST grammar's own characters (',' ')') is answered, never a broken query", "STUB · q='Sharma, R)'",
  async () => { await world({ settings: BQ }); const r = await call("GET", "banquet/bills", { query: "?q=" + encodeURIComponent("Sharma, R)") }); return { ok: r.status === 200, note: JSON.stringify(r.json).slice(0, 80) }; });
C("banquet/bills: ?limit=abc falls back to the normal page, never an error", "STUB",
  async () => { await world({ settings: BQ }); const r = await call("GET", "banquet/bills", { query: "?limit=abc" }); return { ok: r.status === 200 }; });
const KH = { khata_allowed: true, khata_owner_control: false, khata_enabled: true };
C("khata groups two open bills of one person into one row, owing the sum", "STUB · two bills for Ravi",
  async () => { await world({ settings: KH, rpc: { lfh_khata_outstanding: [{ khata_customer_id: "k1", name: "Ravi", bill_amount: 100.1 }, { khata_customer_id: "k1", name: "Ravi", bill_amount: 200.2 }, { khata_customer_id: "k2", name: "Asha", bill_amount: 50 }], lfh_khata_collected: [{ collected: 75 }] } });
    const r = await call("GET", "khata"); const ravi = r.json?.customers?.[0];
    return { ok: ravi?.name === "Ravi" && eq(ravi.outstanding, 300.3) && ravi.bills.length === 2 && eq(r.json.total, 350.3) && eq(r.json.collectedToday, 75), note: JSON.stringify({ o: ravi?.outstanding, t: r.json?.total }) }; });
C("khata on an empty book: zero owed, zero collected, no NaN", "STUB",
  async () => { await world({ settings: KH, rpc: { lfh_khata_outstanding: [], lfh_khata_collected: [] } }); const r = await call("GET", "khata"); return { ok: r.json?.total === 0 && r.json.collectedToday === 0 && r.json.customers.length === 0 }; });
C("khata/customers shows each person's CURRENT debt from the book's own function", "STUB · Ravi owes ₹161",
  async () => { await world({ settings: KH, fix: { khata_customers: [{ id: "k1", restaurant_id: RID, name: "Ravi", created_at: NOW() }, { id: "k2", restaurant_id: RID, name: "Asha", created_at: NOW() }] }, rpc: { lfh_khata_outstanding: [{ khata_customer_id: "k1", bill_amount: 161 }] } });
    const r = await call("GET", "khata/customers"); const by = Object.fromEntries((r.json?.customers || []).map((c) => [c.name, c.outstanding]));
    return { ok: by.Ravi === 161 && by.Asha === 0, note: JSON.stringify(by) }; });
C("khata/customers with nobody found does not ask the book at all", "STUB · empty picker",
  async () => { const G = await world({ settings: KH }); await call("GET", "khata/customers", { query: "?q=zz" }); return { ok: !G.RPCS.some((c) => c.name === "lfh_khata_outstanding") }; });
const TT = { table_tags_allowed: true, table_tags_owner_control: false, table_tags_enabled: true };
C("onhouse groups a comped table's two orders into ONE bill and adds their item counts", "STUB · reach today",
  async () => { await world({ settings: TT, fix: { orders: [
    { id: "h1", restaurant_id: RID, session_id: "sh", table_number: "6", total: 300, items: [{ qty: 2 }], paid_at: NOW(), payment_method: "On the house", payment_status: "paid" },
    { id: "h2", restaurant_id: RID, session_id: "sh", table_number: "6", total: 200, items: [{ qty: 1 }, {}], paid_at: NOW(), payment_method: "On the house", payment_status: "paid" }] } });
    const r = await call("GET", "onhouse"); const b = r.json?.bills?.[0];
    return { ok: r.json?.count === 1 && b.items === 4 && eq(b.would_be, 500) && eq(r.json.total, 500), note: JSON.stringify(b) }; });
C("onhouse: ?days=-5 cannot reach backwards past today", "STUB",
  async () => { await world({ settings: TT }); const r = await call("GET", "onhouse", { query: "?days=-5" }); return { ok: r.json?.days === 1 }; });
C("onhouse: an ordinary (cash) bill is never on the comp list", "STUB",
  async () => { await world({ settings: TT, fix: { orders: [{ id: "h3", restaurant_id: RID, total: 100, items: [], paid_at: NOW(), payment_method: "Cash", payment_status: "paid" }] } }); const r = await call("GET", "onhouse"); return { ok: r.json?.count === 0 }; });
C("all: a restaurant with no settings row still boots the panel (a minimal default row)", "STUB · settings empty",
  async () => { await world({ settingsRows: [] }); const r = await call("GET", "all"); return { ok: r.status === 200 && r.json?.settings?.id === "site" && r.json.settings.bubbles_enabled === true }; });
C("all: the delivery apps' connection keys never leave the server", "STUB · platform_channels stored",
  async () => { await world({ settings: { platform_channels: { zomato: { on: true, key: "SECRET-KEY" } } } }); const r = await call("GET", "all"); return { ok: !r.text.includes("SECRET-KEY") && !("platform_channels" in (r.json?.settings || {})) }; });
C("all: a missing restaurant row answers restaurant:null, not a crash", "STUB · restaurants empty",
  async () => { await world({ restaurants: [] }); const r = await call("GET", "all"); return { ok: r.status === 200 && r.json.restaurant === null }; });
C("ratings: a failed summary read is 'Couldn't load the ratings summary — please try again.' and nothing else", "STUB · rpc errors",
  async () => { await world({ fail: { "rpc:lfh_ratings_summary": "error" } }); const r = await call("GET", "ratings"); return { ok: r.status === 500 && r.json?.error === "Couldn't load the ratings summary — please try again." }; });
C("ratings: the summary's five-star distribution is always five numbers", "STUB · rpc answers partial",
  async () => { await world({ rpc: { lfh_ratings_summary: [{ total: 3, s5: 3 }] } }); const r = await call("GET", "ratings"); return { ok: JSON.stringify(r.json?.summary?.dist) === "[0,0,0,0,3]" }; });
C("ratings ?filter=unhandled shows only the ones nobody has acknowledged", "STUB · one of each",
  async () => { await world({ rpc: { lfh_ratings_summary: [{}] }, fix: { feedback: [{ id: "f1", restaurant_id: RID, acknowledged: false }, { id: "f2", restaurant_id: RID, acknowledged: true }] } });
    const r = await call("GET", "ratings", { query: "?filter=unhandled" }); return { ok: r.json?.ratings?.length === 1 && r.json.ratings[0].id === "f1" }; });

// ═══ B7 · THE ORDERS READ ═════════════════════════════════════════════════════════════════════
// An order from YESTERDAY's business day, whatever the clock says now: one hour after yesterday's
// 05:00-IST start. ("30 hours ago" fell before that start at some hours of the morning.)
const YDAY = () => { const IST = 5.5 * 3600e3, F = 5 * 3600e3; const i = Math.floor((Date.now() + IST - F) / 864e5); return new Date(i * 864e5 + F - IST - 864e5 + 3600e3).toISOString(); };
const O = (id_, o = {}) => ({ id: id_, restaurant_id: RID, table_number: "5", session_id: "s5", status: "served", payment_status: "paid", archived: false, deleted_at: null, created_at: NOW(), subtotal: 100, total: 105, items: [], ...o });
C("orders?bills=1 leaves a binned bill out of the manager's Bills record", "STUB · one deleted",
  async () => { await world({ fix: { orders: [O("b1"), O("b2", { deleted_at: NOW() })] } }); const r = await call("GET", "orders", { query: "?bills=1" }); return { ok: r.json?.rows?.length === 1 && r.json.rows[0].id === "b1" }; });
C("orders (the live floor) leaves a binned bill out too", "STUB",
  async () => { await world({ fix: { orders: [O("b1"), O("b2", { deleted_at: NOW() })] } }); const r = await call("GET", "orders"); return { ok: r.json?.length === 1 }; });
C("orders?bills=1 on a today-only bills reach leaves yesterday's bill out", "STUB · one bill from 30 hours ago",
  async () => { await world({ fix: { orders: [O("b1"), O("b3", { created_at: YDAY() })] } }); const r = await call("GET", "orders", { query: "?bills=1" });
    return { ok: r.json?.rows?.length === 1 && r.json.reach === "today", note: `${r.json?.rows?.length} · ${r.json?.reach}` }; });
C("…and on the today+yesterday reach it is included", "STUB · bills reach today_yesterday",
  async () => { await world({ accessConfig: { view_bills: { manager_opts: { range: "today_yesterday" } } }, fix: { orders: [O("b1"), O("b3", { created_at: YDAY() })] } });
    const r = await call("GET", "orders", { query: "?bills=1" }); return { ok: r.json?.reach === "today_yesterday" && r.json.rows.length === 2, note: `${r.json?.reach} · ${r.json?.rows?.length}` }; });
C("orders: each bill row carries its session's bill number, invoice state and who it is made out to", "STUB · session with invoice",
  async () => { await world({ fix: { orders: [O("b1")], sessions: [{ id: "s5", restaurant_id: RID, status: "closed", bill_no: 12, invoice_no: 7, invoice_voided: false, invoice_at: NOW(), cust_name: "Mehta", bill_printed_at: NOW() }] } });
    const r = await call("GET", "orders", { query: "?bills=1" }); const o = r.json?.rows?.[0] || {};
    return { ok: o.bill_no === 12 && o.invoice_no === 7 && o.session_status === "closed" && o.bill_cust_name === "Mehta" && !!o.bill_printed_at, note: JSON.stringify({ b: o.bill_no, i: o.invoice_no }) }; });
C("orders: a split bill carries its parts, oldest first", "STUB · two legs",
  async () => { await world({ fix: { orders: [O("b1")], sessions: [{ id: "s5", restaurant_id: RID }], session_payments: [{ session_id: "s5", restaurant_id: RID, amount: 60, method: "Cash", created_at: NOW() }, { session_id: "s5", restaurant_id: RID, amount: 45, method: "UPI", created_at: NOW() }] } });
    const r = await call("GET", "orders", { query: "?bills=1" }); const p = r.json?.rows?.[0]?.pay_parts || [];
    return { ok: p.length === 2 && p[0].method === "Cash" && p[1].amount === 45, note: JSON.stringify(p) }; });
C("orders: when a session has two chain links, the bill prints the LATEST one", "STUB · seq 3 and seq 9",
  async () => { await world({ fix: { orders: [O("b1")], sessions: [{ id: "s5", restaurant_id: RID }], bill_chain: [{ session_id: "s5", restaurant_id: RID, seq: 3, chain_hash: "old" }, { session_id: "s5", restaurant_id: RID, seq: 9, chain_hash: "new" }] } });
    const r = await call("GET", "orders", { query: "?bills=1" }); const o = r.json?.rows?.[0] || {}; return { ok: o.chain_seq === 9 && o.chain_hash === "new" }; });
C("orders: a failed read of the split parts does not lose the bill (the parts are simply absent)", "STUB · session_payments errors",
  async () => { await world({ fix: { orders: [O("b1")], sessions: [{ id: "s5", restaurant_id: RID }] }, fail: { "session_payments:select": "error" } });
    const r = await call("GET", "orders", { query: "?bills=1" }); return { ok: r.status === 200 && r.json.rows.length === 1 && !r.json.rows[0].pay_parts }; });
C("orders history: a full formatted invoice number pasted in ('INV/2025-26/000042') finds invoice 42", "STUB · session invoice_no 42",
  async () => { await world({ fix: { orders: [O("b1")], sessions: [{ id: "s5", restaurant_id: RID, invoice_no: 42 }] } }); const r = await call("GET", "orders", { query: "?history=1&type=inv&q=" + encodeURIComponent("INV/2025-26/000042") });
    return { ok: Array.isArray(r.json) && r.json.length === 1, note: `${r.json?.length}` }; });
C("orders history: a bill search with no digits answers [] without reading the orders", "STUB · q=abc",
  async () => { const G = await world({ fix: { orders: [O("b1")] } }); const r = await call("GET", "orders", { query: "?history=1&type=bill&q=abc" });
    return { ok: Array.isArray(r.json) && r.json.length === 0 && !G.READS.some((x) => x.table === "orders") }; });
C("orders history: a date that is not a date answers [] — never 'everything'", "STUB · q=not-a-date",
  async () => { await world({ fix: { orders: [O("b1")] } }); const r = await call("GET", "orders", { query: "?history=1&type=date&q=not-a-date" }); return { ok: Array.isArray(r.json) && r.json.length === 0 }; });
C("orders history: a customer name nobody has answers []", "STUB · type=cust",
  async () => { await world({ fix: { orders: [O("b1")] } }); const r = await call("GET", "orders", { query: "?history=1&type=cust&q=zzzz" }); return { ok: Array.isArray(r.json) && r.json.length === 0 }; });
C("orders history: the one-box search with no hit answers []", "STUB · type=any",
  async () => { await world({ fix: { orders: [O("b1")] } }); const r = await call("GET", "orders", { query: "?history=1&type=any&q=zzzz" }); return { ok: Array.isArray(r.json) && r.json.length === 0 }; });
C("orders history: the one-box search finds a bill by the last digits of its number", "STUB · bill_no 1234, q=234",
  async () => { await world({ fix: { orders: [O("b1")], sessions: [{ id: "s5", restaurant_id: RID, bill_no: 1234, created_at: NOW() }] } }); const r = await call("GET", "orders", { query: "?history=1&type=any&q=234" });
    return { ok: Array.isArray(r.json) && r.json.length === 1 }; });
C("orders?table=N never hands back an ARCHIVED order (a party that has left)", "STUB · archived at table 5",
  async () => { await world({ fix: { orders: [O("t1", { archived: true }), O("t2")] } }); const r = await call("GET", "orders", { query: "?table=5" }); return { ok: (r.json || []).every((o) => o.id !== "t1") }; });
C("calls?table=N narrows to that table", "STUB · calls at 3 and 4",
  async () => { await world({ fix: { waiter_calls: [{ id: "c3", restaurant_id: RID, table_number: "3" }, { id: "c4", restaurant_id: RID, table_number: "4" }] } }); const r = await call("GET", "calls", { query: "?table=3" }); return { ok: r.json?.length === 1 && r.json[0].id === "c3" }; });

// ═══ B8 · THE FLOOR, THE PRINTER STRIP, THE SESSIONS ══════════════════════════════════════════
C("summary?table=abc is a full, correct whole-floor read — never a database error", "STUB",
  async () => { const G = await world({ rpc: { lfh_table_view_summary: { tiles: {} } } }); const r = await call("GET", "summary", { query: "?table=abc" }); const c = G.RPCS.find((x) => x.name === "lfh_table_view_summary");
    return { ok: r.status === 200 && c && c.args.p_table === null }; });
C("summary?table=%207%20 is read as table 7", "STUB",
  async () => { const G = await world({ rpc: { lfh_table_view_summary: { tiles: {} } } }); await call("GET", "summary", { query: "?table=%207%20" }); return { ok: G.RPCS[0]?.args?.p_table === "7" }; });
C("summary (whole floor) carries the printer strip and the slow-order clock", "STUB",
  async () => { await world({ rpc: { lfh_table_view_summary: { tiles: {} } } }); const r = await call("GET", "summary"); return { ok: !!r.json?.printer && !!r.json.slowOrders && Array.isArray(r.json.merges) }; });
C("summary?table=N carries neither (a tile refetch never pays for them)", "STUB",
  async () => { await world({ rpc: { lfh_table_view_summary: { tiles: {} } } }); const r = await call("GET", "summary", { query: "?table=4" }); return { ok: !("printer" in (r.json || {})) && !("slowOrders" in (r.json || {})) && Array.isArray(r.json.merges) }; });
C("summary: a database that answers nothing still gives the floor its empty shape", "STUB · rpc answers null",
  async () => { await world({ rpc: { lfh_table_view_summary: null } }); const r = await call("GET", "summary", { query: "?table=4" }); return { ok: r.status === 200 && typeof r.json.tiles === "object" && Array.isArray(r.json.calls) }; });
C("summary: a failed floor read is a failure answer (never a half-empty floor that looks real)", "STUB · rpc errors",
  async () => { await world({ fail: { "rpc:lfh_table_view_summary": "error" } }); const r = await call("GET", "summary", { query: "?table=4" }); return { ok: r.status >= 500, note: `${r.status}` }; });
C("summary: the printer strip names the KOT and table of a stuck job", "STUB · one failed job",
  async () => { await world({ rpc: { lfh_table_view_summary: { tiles: {} } }, fix: { print_jobs: [{ id: "j1", restaurant_id: RID, order_id: "oj", kind: "kot", status: "failed", created_at: OLD }], orders: [{ id: "oj", restaurant_id: RID, kot_no: 44, table_number: "7" }] } });
    // The printer strip is SHARED for 1.5s per restaurant (lib/floorSummary) — the previous check's
    // read is still being served, which is the design. Wait it out rather than defeat it.
    await new Promise((res) => setTimeout(res, 1600));
    const r = await call("GET", "summary"); const j = r.json?.printer?.stuck?.[0] || {}; return { ok: j.kot_no === 44 && j.table_number === "7", note: JSON.stringify(j) }; });
C("sessions passes the restaurant and a null table for the whole floor", "STUB",
  async () => { const G = await world({ rpc: { lfh_floor_bundle: {} } }); await call("GET", "sessions"); const c = G.RPCS[0]; return { ok: c?.args?.p_restaurant_id === RID && c.args.p_table === null }; });
C("sessions: a database that answers nothing still gives the panel five empty lists", "STUB · rpc null",
  async () => { await world({ rpc: { lfh_floor_bundle: null } }); const r = await call("GET", "sessions"); return { ok: ["sessions", "members", "items", "requests", "blocklist"].every((k) => Array.isArray(r.json?.[k])) }; });
C("print-jobs/<id>: a job whose order is gone says 'That KOT's order is gone.'", "STUB",
  async () => { await world({ fix: { print_jobs: [{ id: "pj1", restaurant_id: RID, order_id: "gone", status: "failed" }] } }); const r = await call("GET", "print-jobs/pj1"); return { ok: r.status === 404 && r.json?.error === "That KOT's order is gone." }; });
C("print-jobs/<id>: a live job hands back the job, its order and its lines", "STUB",
  async () => { await world({ fix: { print_jobs: [{ id: "pj2", restaurant_id: RID, order_id: "o9", status: "failed" }], orders: [{ id: "o9", restaurant_id: RID, kot_no: 3 }], order_items: [{ id: "it", order_id: "o9", restaurant_id: RID, title: "Tea" }] } });
    const r = await call("GET", "print-jobs/pj2"); return { ok: r.json?.job?.id === "pj2" && r.json.order.kot_no === 3 && r.json.items.length === 1 }; });
C("an unknown GET path is 404 'unknown GET endpoint', and is not written to the error board", "STUB",
  async () => { const G = await world(); const r = await call("GET", "nope/nope"); return { ok: r.status === 404 && r.json?.error === "unknown GET endpoint" && G.ERRORS.length === 0 }; });
C("audit?detail=abc is 'bad id' (400), and the database is not asked", "STUB",
  async () => { const G = await world(); const r = await call("GET", "audit", { query: "?detail=abc" }); return { ok: r.status === 400 && r.json?.error === "bad id" && !G.READS.some((x) => x.table === "deletion_audit") }; });
C("audit: the 'was the food made?' answers are not themselves listed as removals", "STUB · one cancellation, one answer",
  async () => { await world({ fix: { deletion_audit: [{ id: 1, restaurant_id: RID, kind: "order_cancelled", at: NOW() }, { id: 2, restaurant_id: RID, kind: "removal_classified", at: NOW() }] } });
    const r = await call("GET", "audit"); return { ok: r.json?.length === 1 && r.json[0].kind === "order_cancelled" }; });
C("audit: a removal the ADMIN made is shown to a manager with no name on it (the admin stays invisible)", "STUB · actor_role admin",
  async () => { await world({ fix: { deletion_audit: [{ id: 1, restaurant_id: RID, kind: "order_cancelled", at: NOW(), actor: "Aevidine admin", actor_role: "admin", amount: 50 }] } });
    const r = await call("GET", "audit"); const x = r.json?.[0] || {}; return { ok: x.actor === null && x.actor_role === null && x.amount === 50 }; });
C("…and the admin console sees its own name on the same row", "STUB · admin",
  async () => { await world({ who: "admin", fix: { deletion_audit: [{ id: 1, restaurant_id: RID, kind: "order_cancelled", at: NOW(), actor: "Aevidine admin", actor_role: "admin" }] } });
    const r = await call("GET", "audit"); return { ok: r.json?.[0]?.actor === "Aevidine admin" }; });
C("audit?detail=<id>: the one record comes back with the bill's before/after attached", "STUB",
  async () => { await world({ fix: { deletion_audit: [{ id: 5, restaurant_id: RID, kind: "order_cancelled", at: NOW(), meta: {} }] } }); const r = await call("GET", "audit", { query: "?detail=5" });
    return { ok: r.status === 200 && r.json?.id === 5 && "__after" in r.json && "__billSides" in r.json, note: `${r.status}` }; });
C("users answers its five lists, each an array", "STUB",
  async () => { await world(); const r = await call("GET", "users"); return { ok: ["members", "customers", "blocklist", "orders", "calls"].every((k) => Array.isArray(r.json?.[k])) }; });
C("table-sections GET answers the real table count and the names map", "STUB · 20 tables",
  async () => { await world({ settings: { table_names: { 1: "Window" } } }); const r = await call("GET", "table-sections"); return { ok: r.json?.tableCount === 20 && r.json.tableNames?.["1"] === "Window" && r.json.moduleOn === true }; });
C("table-sections GET lists waiters only — never a manager or a kitchen login", "STUB · one of each role",
  async () => { await world({ fix: { staff_users: ["tablet", "manager", "kitchen"].map((role) => ({ id: role, restaurant_id: RID, role, name: role, deleted_at: null })) } }); const r = await call("GET", "table-sections");
    return { ok: r.json?.waiters?.length === 1 && r.json.waiters[0].role === "tablet" }; });
C("table-sections GET leaves a binned waiter out", "STUB · deleted waiter",
  async () => { await world({ fix: { staff_users: [{ id: "w1", restaurant_id: RID, role: "tablet", deleted_at: NOW() }] } }); const r = await call("GET", "table-sections"); return { ok: r.json?.waiters?.length === 0 }; });

console.log(`block B: ${N - 178201} checks defined (P178201–P${N - 1})`);
