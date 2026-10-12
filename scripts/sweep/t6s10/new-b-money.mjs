// BLOCK B · from P175061 — THE MONEY, DRIVEN. Every check runs the panel's REAL functions inside the
// real manager panel on port 4406, over in-memory orders, with api() (and the dialogs) replaced for
// the length of one check and put back in a finally — so nothing is written, nothing is sent, and no
// row exists that would need cleaning up. Subject file named in every row.
import { check, ev } from "./lib.mjs";

const F = "`public/panels/editor/app.js`";
let n = 175061;
const id = () => "P" + n++;
const L = (what, how, expr, want, cmp) => check(id(), `${F} — ${what}`, `LIVE: ${how}`, async () => {
  let got; try { got = await ev(expr); } catch (e) { return { ok: false, note: "threw: " + e.message }; }
  const ok = cmp ? cmp(got) : JSON.stringify(got) === JSON.stringify(want);
  return { ok, note: `got ${JSON.stringify(got).slice(0, 160)}` };
});
// A stub harness, in the frame: STUB(fn) runs fn with api / confirmDialog / promptDialog replaced.
const STUB = (body, answers = "{}") => `(async () => {
  const keep = { api, confirmDialog, promptDialog, toast, askRemovalReason: typeof askRemovalReason === 'function' ? askRemovalReason : null, orders: state.data.orders, calls: state.data.calls, rec: state.billsRec };
  const A = ${answers}; const sent = []; const said = [];
  api = async (m, p, b, o) => { sent.push({ m, p, b, o }); const f = A[m + ' ' + p] || A[m + ' ' + String(p).split('?')[0]] || A.any; if (typeof f === 'function') return f(b); if (f === 'THROW') { const e = new Error('refused by test'); e.status = 409; throw e; } if (f === 'OFFLINE') { const e = new Error('Failed to fetch'); e.offline = true; throw e; } return f === undefined ? { ok: true } : f; };
  confirmDialog = async () => (A.confirm === undefined ? true : A.confirm); promptDialog = async () => (A.prompt === undefined ? 'test reason' : A.prompt);
  toast = (msg, type) => { said.push({ msg: String(msg), type }); };
  if (keep.askRemovalReason) askRemovalReason = async () => (A.reason === undefined ? { code: 'mistake', note: '' } : A.reason);
  try { const r = await (async () => { ${body} })(); return { r, sent: sent.map((x) => x.m + ' ' + x.p), bodies: sent.map((x) => x.b), said }; }
  finally { api = keep.api; confirmDialog = keep.confirmDialog; promptDialog = keep.promptDialog; toast = keep.toast; if (keep.askRemovalReason) askRemovalReason = keep.askRemovalReason; state.data.orders = keep.orders; state.data.calls = keep.calls; state.billsRec = keep.rec; renderEditor(); }
})()`;
const O = (x) => `({ id: 'o' + Math.random().toString(36).slice(2, 8), session_id: 's1', table_number: '7', status: 'served', payment_status: 'pending', created_at: new Date().toISOString(), kot_no: 12, subtotal: 400, total: 420, discount: 0, items: [{ title: 'Paneer Tikka', qty: 2, price: 200 }], ${x || ""} })`;

// ── the bill's figures, through the one door ─────────────────────────────────────────────────
L("a ₹400 bill at 5% totals ₹420 through billMath", "billMath([order])", `billMath([${O()}]).total`, 420);
L("a ₹40 discount comes off BEFORE tax — ₹378, never ₹380", "billMath with discount 40", `billMath([${O("discount: 40")}]).total`, 378);
L("two tickets on one bill add up as one bill", "billMath of two orders", `billMath([${O()}, ${O("subtotal: 100, total: 105, items: [{ title: 'Tea', qty: 1, price: 100 }]")}]).total`, 525);
L("a cancelled ticket on the bill adds nothing to its total", "billMath with one cancelled", `billMath([${O()}, ${O("status: 'cancelled'")}]).total`, 420);
L("an all-cancelled bill totals ₹0", "billMath all cancelled", `billMath([${O("status: 'cancelled'")}]).total`, 0);
L("the card's Total line is billMath's total, printed by inr()", "mergedOrderCardHtml → .ord-total", `(() => { const d = document.createElement('div'); d.innerHTML = mergedOrderCardHtml([${O("discount: 40")}]); return d.querySelector('.ord-total').textContent.replace(/\\s+/g, ''); })()`, "Total₹378");
L("the card's Discount row says the percentage it took off the food", "ordTotalsRows discount row", `(() => { const d = document.createElement('div'); d.innerHTML = ordTotalsRows(billMath([${O("discount: 40")}])); return d.querySelector('.ord-disc').textContent.replace(/\\s+/g, ' ').trim(); })()`, null, (g) => /Discount \(10%\)/.test(g) && /40/.test(g));
L("a composition-scheme restaurant's card prints NO tax row at all", "ordTotalsRows composition", `(() => { const m = billMath([${O()}]); m.composition = true; m.tax = 0; const d = document.createElement('div'); d.innerHTML = ordTotalsRows(m); return [...d.children].map((x) => x.textContent.trim()).join('|'); })()`, null, (g) => !/Tax/.test(g));
L("the receipt pane's MRP row sits after tax and before the total", "mrpTotalsRows with an MRP part", `(() => { const m = { subtotal: 500, taxableBase: 400, nontax: 100, disc: 0, tax: 20, rate: 0.05, total: 520 }; const d = document.createElement('div'); d.innerHTML = mrpTotalsRows(m, 5); return [...d.children].map((x) => x.textContent.replace(/\\s+/g, ' ').trim().split(' ')[0]).join(','); })()`, null, (g) => /Food,.*Tax,MRP/.test(g) || /Food.*Tax.*MRP/.test(g));
L("with an MRP part the first row says 'Food subtotal' and shows only the taxable part", "mrpTotalsRows", `(() => { const d = document.createElement('div'); d.innerHTML = mrpTotalsRows({ subtotal: 500, taxableBase: 400, nontax: 100, disc: 0, tax: 20, rate: 0.05, total: 520 }, 5); return d.children[0].textContent.replace(/\\s+/g, ''); })()`, "Foodsubtotal₹400");
L("a round-off row appears only when the column would not add up", "roundOffRow on a clean bill", `roundOffRow(billMath([${O()}]), 'ord-sub')`, "");
L("a QO/P cart line priced 'incl' is un-grossed per line, to the paisa", "splitCartLines incl", `splitCartLines([{ price: 105, qty: 1, tax_mode: 'incl' }], { tax_rate: 0.05, item_tax_modes_allowed: true }).taxableBase`, 100);
L("an MRP cart line is untaxed AND locked from discount", "splitCartLines mrp", `JSON.stringify(splitCartLines([{ price: 60, qty: 2, tax_mode: 'mrp' }], { tax_rate: 0.05, item_tax_modes_allowed: true }))`, '{"taxableBase":0,"nontax":120,"mrpAmount":120,"hasMrp":true}');
L("a cart line with a junk price counts as ₹0, never NaN", "splitCartLines junk price", `splitCartLines([{ price: 'abc', qty: 3 }], {}).taxableBase`, 0);
L("a cart line with no quantity counts as one", "splitCartLines qty missing", `splitCartLines([{ price: 50 }], {}).taxableBase`, 50);
L("'GST inside' explains the split in money", "taxModeExample incl", `taxModeExample('incl', 105, { tax_rate: 0.05, item_tax_modes_allowed: true })`, "Guest pays ₹105.00 — ₹100.00 + ₹5.00 GST is already inside it.");
L("'None' tells the guest nothing is added", "taxModeExample none", `taxModeExample('none', 80, { tax_rate: 0.05, item_tax_modes_allowed: true })`, "Guest pays exactly ₹80.00 — nothing is added.");
L("a typed price with a ₹ sign still reads as the number", "taxModeExample '₹200'", `taxModeExample('excl', '₹200', { tax_rate: 0.05 })`, "Guest pays ₹210.00 — ₹200.00 + ₹10.00 GST at 5%.");

// ── the pay sheet: the split, driven through its own buttons ─────────────────────────────────
const SHEET = (due, opts, body) => `(async () => {
  document.querySelector('.pay-overlay')?.remove();
  const p = openPaymentMethodModal(${due}, 'T6 S10 — nothing is saved', ${opts});
  await new Promise((f) => setTimeout(f, 60));
  const w = document.querySelector('.pay-overlay'); const q = (s) => w.querySelector(s); const qa = (s) => [...w.querySelectorAll(s)];
  const sumLine = () => (q('.pay-split-sum') || {}).textContent || '';
  let out;
  try { out = await (async () => { ${body} })(); }
  finally { if (document.body.contains(w)) w.__lfhClose(); }
  const res = await Promise.race([p, new Promise((f) => setTimeout(() => f('PENDING'), 200))]);
  return { out, res };
})()`;
const sheet = (what, due, opts, body, cmp) => check(id(), `${F} — ${what}`, "LIVE: the real pay sheet, driven through its own buttons (nothing is saved — no caller is waiting on it)", async () => {
  let g; try { g = await ev(SHEET(due, opts, body)); } catch (e) { return { ok: false, note: "threw: " + e.message }; }
  return { ok: !!cmp(g), note: JSON.stringify(g).slice(0, 170) };
});
sheet("Split payment opens on two even parts that add up to the bill", 459.9, "{ split: true }", "q('.pay-special-split').click(); await new Promise((f) => setTimeout(f, 30)); return { amts: qa('.psr-amt').map((i) => i.value), line: sumLine() };",
  (g) => g.out.amts.length === 2 && Math.round(g.out.amts.reduce((a, x) => a + Number(x), 0) * 100) === 45990 && /add up/.test(g.out.line));
sheet("three ways on ₹459.90: everyone the same and the last part carries the odd paise", 459.9, "{ split: true }", "q('.pay-special-split').click(); qa('.pay-split-n').find((b) => b.dataset.n === '3').click(); return qa('.psr-amt').map((i) => i.value);",
  (g) => JSON.stringify(g.out) === JSON.stringify(["153.3", "153.3", "153.3"]) || (g.out[0] === g.out[1] && Math.round(g.out.reduce((a, x) => a + Number(x), 0) * 100) === 45990));
sheet("₹555.55 five ways is ₹111.11 each — nobody pays the others' rounding", 555.55, "{ split: true }", "q('.pay-special-split').click(); qa('.pay-split-n').find((b) => b.dataset.n === '5').click(); return qa('.psr-amt').map((i) => i.value);",
  (g) => g.out.every((v) => v === "111.11"));
sheet("the count chip follows the rows: Add another part highlights 3", 300, "{ split: true }", "q('.pay-special-split').click(); q('.pay-split-add').click(); return { rows: qa('.pay-split-row').length, sel: (qa('.pay-split-n.sel')[0] || {}).dataset?.n };",
  (g) => g.out.rows === 3 && g.out.sel === "3");
sheet("an added part on a covered bill starts EMPTY, and the line says a part needs an amount", 300, "{ split: true }", "q('.pay-special-split').click(); q('.pay-split-add').click(); return sumLine();",
  (g) => /needs an amount/.test(g.out));
sheet("Take payment refuses an empty part out loud (the button stays enabled)", 300, "{ split: true }", "const said = []; const kt = toast; toast = (m) => said.push(m); try { q('.pay-special-split').click(); q('.pay-split-add').click(); q('.pay-split-go').click(); } finally { toast = kt; } return { said, disabled: q('.pay-split-go').disabled };",
  (g) => g.out.disabled === false && g.out.said.some((m) => /amount above zero/.test(m)));
sheet("a split that does not add up is refused with how much is uncovered", 300, "{ split: true }", "const said = []; const kt = toast; toast = (m) => said.push(m); try { q('.pay-special-split').click(); const a = qa('.psr-amt')[0]; a.value = '100'; a.oninput({ target: a }); q('.pay-split-go').click(); } finally { toast = kt; } return { said, line: sumLine() };",
  (g) => g.out.said.some((m) => /still uncovered/.test(m)) && /still to cover/.test(g.out.line));
sheet("over-collecting is refused too, by how much", 300, "{ split: true }", "const said = []; const kt = toast; toast = (m) => said.push(m); try { q('.pay-special-split').click(); const a = qa('.psr-amt')[0]; a.value = '250'; a.oninput({ target: a }); q('.pay-split-go').click(); } finally { toast = kt; } return said;",
  (g) => g.out.some((m) => /more than the bill/.test(m)));
sheet("a Pay later part must name who owes it before payment is taken", 300, "{ split: true }", "const said = []; const kt = toast; toast = (m) => said.push(m); try { q('.pay-special-split').click(); const s = qa('.psr-method')[1]; s.value = 'Pay later'; s.onchange({ target: s }); q('.pay-split-go').click(); } finally { toast = kt; } return { said, who: !!q('.psr-who') };",
  (g) => g.out.who && g.out.said.some((m) => /Who owes this/.test(m)));
sheet("only ONE part may be pay later", 300, "{ split: true }", "const said = []; const kt = toast; toast = (m) => said.push(m); try { q('.pay-special-split').click(); for (const i of [0, 1]) { const s = qa('.psr-method')[i]; s.value = 'Pay later'; s.onchange({ target: s }); } const L0 = qa('.psr-who'); return { n: L0.length }; } finally { toast = kt; }",
  (g) => g.out.n === 2);
sheet("By kitchen ticket on a one-ticket bill is refused with a reason, never a split of one", 300, "{ split: true, orders: [{ id: 'a', status: 'served', total: 315, subtotal: 300, items: [] }] }", "const said = []; const kt = toast; toast = (m) => said.push(m); try { q('.pay-special-split').click(); qa('.pay-split-tab').find((b) => b.dataset.mode === 'ticket').click(); } finally { toast = kt; } return { said, rows: qa('.pay-split-row').length };",
  (g) => g.out.rows === 2 && g.out.said.some((m) => /one kitchen ticket/.test(m)));
sheet("By kitchen ticket on two tickets: one part per ticket, the last carrying the remainder", 525, "{ split: true, orders: [{ id: 'a', status: 'served', kot_no: 1, subtotal: 400, total: 420, items: [] }, { id: 'b', status: 'served', kot_no: 2, subtotal: 100, total: 105, items: [] }] }", "q('.pay-special-split').click(); qa('.pay-split-tab').find((b) => b.dataset.mode === 'ticket').click(); return { amts: qa('.psr-amt').map((i) => i.value), labels: qa('.psr-label').map((x) => x.textContent.trim()), nrow: getComputedStyle(q('.pay-split-nrow')).display };",
  (g) => g.out.amts.join() === "420,105" && g.out.labels.join() === "KOT #1,KOT #2" && g.out.nrow === "none");
sheet("an un-accepted ticket is left out of By kitchen ticket (nobody pays for food the kitchen has not taken)", 420, "{ split: true, orders: [{ id: 'a', status: 'served', kot_no: 1, subtotal: 400, total: 420, items: [] }, { id: 'b', status: 'received', kot_no: 2, subtotal: 100, total: 105, items: [] }] }", "q('.pay-special-split').click(); return qa('.pay-split-tab').find((b) => b.dataset.mode === 'ticket').classList.contains('pay-split-tab-off');",
  (g) => g.out === true);
sheet("By dish: each person's share scales to the real due and the parts still add up", 525, "{ split: true, orders: [{ id: 'a', status: 'served', subtotal: 500, total: 525, items: [{ title: 'Tea', qty: 1, price: 100 }, { title: 'Thali', qty: 1, price: 400 }] }] }", "q('.pay-special-split').click(); qa('.pay-split-tab').find((b) => b.dataset.mode === 'dish').click(); qa('.pay-split-dish')[1].click(); return qa('.psr-amt').map((i) => Number(i.value));",
  (g) => g.out.length === 2 && Math.round((g.out[0] + g.out[1]) * 100) === 52500 && g.out[0] === 105 && g.out[1] === 420);
sheet("more than twelve parts is refused, the server's own limit said first", 1200, "{ split: true }", "const said = []; const kt = toast; toast = (m) => said.push(m); try { q('.pay-special-split').click(); for (let i = 0; i < 12; i++) q('.pay-split-add').click(); } finally { toast = kt; } return { rows: qa('.pay-split-row').length, said };",
  (g) => g.out.rows === 12 && g.out.said.some((m) => /at most 12 parts/.test(m)));
sheet("removing a part is offered only once there are three or more", 300, "{ split: true }", "q('.pay-special-split').click(); const two = qa('.psr-del').length; q('.pay-split-add').click(); const three = qa('.psr-del').length; return [two, three];",
  (g) => g.out[0] === 0 && g.out[1] === 3);
sheet("a split that adds up resolves with the legs, rounded to the paisa, and the sheet closes", 459.9, "{ split: true }", "q('.pay-special-split').click(); q('.pay-split-go').click(); return document.body.contains(w);",
  (g) => g.out === false && g.res && g.res.method === "Split" && Math.round(g.res.splitLegs.reduce((a, l) => a + l.amount, 0) * 100) === 45990);
sheet("a tip chip of 10% on ₹500 puts ₹50 in the tip and ₹550 in 'They paid'", 500, "{}", "qa('.pay-tip-pick').find((c) => c.dataset.tipPct === '10').click(); return { tip: q('#payTipInput').value, paid: q('#payPaidInput').value };",
  (g) => g.out.tip === "50" && g.out.paid === "550");
sheet("typing what they handed over works the tip out (₹560 on ₹500 → ₹60, 12%)", 500, "{}", "const p = q('#payPaidInput'); p.value = '560'; p.oninput(); return { tip: q('#payTipInput').value, pct: q('#payTipPct').value };",
  (g) => g.out.tip === "60" && g.out.pct === "12");
sheet("a blank 'They paid' box is 'about to type', never 'they paid ₹0' — the tip stays", 500, "{}", "qa('.pay-tip-pick').find((c) => c.dataset.tipPct === '10').click(); const p = q('#payPaidInput'); p.value = ''; p.oninput(); return q('#payTipInput').value;",
  (g) => g.out === "50");
sheet("paying less than the bill says the box is the TOTAL handed over", 500, "{}", "const p = q('#payPaidInput'); p.value = '400'; p.oninput(); return (q('#payTipMsg') || {}).textContent || '';",
  (g) => /less than the bill/.test(g.out));
sheet("a tip larger than the bill is asked about, not refused", 500, "{}", "const t = q('#payTipInput'); t.value = '800'; t.oninput(); return { msg: q('#payTipMsg').textContent, tip: t.value };",
  (g) => /bigger than the bill/.test(g.out.msg));
sheet("a tip past the typo ceiling is clamped and said, and the boxes snap back on blur", 500, "{}", "const t = q('#payTipInput'); t.value = '9999999'; t.oninput(); const msg = q('#payTipMsg').textContent; t.onblur(); return { msg, after: t.value };",
  (g) => /most a tip can be/.test(g.out.msg) && Number(g.out.after) <= 100000);
sheet("a methodOnly sheet has no tip boxes, and its method buttons still answer", 300, "{ methodOnly: true }", "const tipBox = !!q('#payTipInput'); qa('.pay-method-btn').find((b) => b.dataset.method === 'Cash').click(); return tipBox;",
  (g) => g.out === false && g.res && g.res.method === "Cash");
sheet("Other opens its text box, and Enter confirms what was typed", 300, "{}", "qa('.pay-method-btn').find((b) => b.dataset.method === 'Other').click(); const i = q('#payOtherInput'); i.value = 'cheque'; i.onkeydown({ key: 'Enter', preventDefault() {} }); return true;",
  (g) => g.res && g.res.method === "Other" && g.res.note === "cheque");
sheet("the consent box decides: a phone with no tick sends no customer", 300, "{}", "q('.pay-cust-phone').value = '9825012345'; qa('.pay-method-btn').find((b) => b.dataset.method === 'UPI').click(); return true;",
  (g) => g.res && g.res.cust === null);
sheet("…and with the tick the customer rides with the payment", 300, "{}", "q('.pay-cust-phone').value = '9825012345'; q('.pay-cust-name').value = 'Riya'; q('.pay-cust-consent').checked = true; qa('.pay-method-btn').find((b) => b.dataset.method === 'UPI').click(); return true;",
  (g) => g.res && g.res.cust && g.res.cust.phone === "9825012345" && g.res.cust.consent === true);
sheet("a customer already saved for the table is shown as a fact, not asked again", 300, "{ knownCust: { phone: '9825012345', name: 'Riya' } }", "return { box: !!q('.pay-cust-phone'), have: (q('.pay-cust-have') || {}).textContent };",
  (g) => g.out.box === false && /Riya · 9825012345/.test(g.out.have));
sheet("'Change' brings the boxes back PRE-FILLED with what was saved", 300, "{ knownCust: { phone: '9825012345', name: 'Riya' } }", "q('.pay-cust-change').click(); return { phone: q('.pay-cust-phone').value, name: q('.pay-cust-name').value, tick: q('.pay-cust-consent').checked };",
  (g) => g.out.phone === "9825012345" && g.out.name === "Riya" && g.out.tick === true);
sheet("Cancel answers null, so the caller settles nothing", 300, "{}", "q('.dish-edit-cancel').click(); return true;", (g) => g.res === null);
sheet("the hardware BACK closes the sheet AND answers null (never a promise left hanging)", 300, "{}", "w.__lfhClose(); return true;", (g) => g.res === null);
sheet("Pay Later and On the house resolve as their own markers, not as a payment", 300, "{ khata: true, onHouse: true }", "q('.pay-special-khata').click(); return true;", (g) => g.res && g.res.special === "khata");

// ── settling: what is sent, and what is said ─────────────────────────────────────────────────
const stub = (what, body, answers, cmp) => check(id(), `${F} — ${what}`, "LIVE: the real function, api() and the dialogs stubbed for this one check (nothing sent)", async () => {
  let g; try { g = await ev(STUB(body, answers)); } catch (e) { return { ok: false, note: "threw: " + e.message }; }
  return { ok: !!cmp(g), note: JSON.stringify({ r: g.r, sent: g.sent, said: g.said.map((s) => s.msg) }).slice(0, 180) };
});
stub("an un-accepted order is never settled: nothing is sent and the toast says accept it first", `return await payOrdersWithMethod([${O("status: 'received'")}], 'T6');`, "{}",
  (g) => g.r === false && g.sent.length === 0 && g.said.some((s) => /Accept the new order first/.test(s.msg)));
stub("nothing to settle says so, in the success colour", `return await payOrdersWithMethod([], 'T6');`, "{}", (g) => g.said.some((s) => /Nothing to settle/.test(s.msg) && s.type === "ok"));
stub("a cash settle marks each accepted order paid WITH the method", `const keepM = openPaymentMethodModal; openPaymentMethodModal = async () => ({ method: 'Cash', note: null, tip: 0, cust: null }); try { state.data.orders = [${O("id: 'x1'")}]; return await payOrdersWithMethod(state.data.orders, 'T6'); } finally { openPaymentMethodModal = keepM; }`, "{}",
  (g) => g.r === true && g.sent.includes("PATCH /orders/x1") && g.bodies.some((b) => b && b.payment_status === "paid" && b.payment_method === "Cash"));
stub("a refused settle says it could not settle, never 'paid'", `const keepM = openPaymentMethodModal; openPaymentMethodModal = async () => ({ method: 'Cash', note: null, tip: 0, cust: null }); try { state.data.orders = [${O("id: 'x2'")}]; return await payOrdersWithMethod(state.data.orders, 'T6'); } finally { openPaymentMethodModal = keepM; }`, "{ 'PATCH /orders/x2': 'THROW' }",
  (g) => g.r === false && g.said.some((s) => /Couldn't settle/.test(s.msg) && s.type === "err") && !g.said.some((s) => /Marked paid/.test(s.msg)));
stub("a tip is written to the first order that ACTUALLY settled", `const keepM = openPaymentMethodModal; openPaymentMethodModal = async () => ({ method: 'UPI', note: null, tip: 30, cust: null }); try { state.data.orders = [${O("id: 'y1'")}, ${O("id: 'y2'")}]; return await payOrdersWithMethod(state.data.orders, 'T6'); } finally { openPaymentMethodModal = keepM; }`, "{ 'PATCH /orders/y1': 'THROW' }",
  (g) => g.sent.includes("POST /orders/y2/tip") && !g.sent.includes("POST /orders/y1/tip"));
stub("a refused tip is SAID, after the bill is paid — never swallowed", `const keepM = openPaymentMethodModal; openPaymentMethodModal = async () => ({ method: 'UPI', note: null, tip: 30, cust: null }); try { state.data.orders = [${O("id: 'z1'")}]; return await payOrdersWithMethod(state.data.orders, 'T6'); } finally { openPaymentMethodModal = keepM; }`, "{ 'POST /orders/z1/tip': 'THROW' }",
  (g) => g.said.some((s) => /tip was not recorded/.test(s.msg) && s.type === "err"));
stub("a split saved only on this device says so, never 'Marked paid in 2 parts'", `const keepM = openPaymentMethodModal, keepP = pollTables; pollTables = async () => {}; openPaymentMethodModal = async () => ({ method: 'Split', splitLegs: [{ amount: 210, method: 'UPI' }, { amount: 210, method: 'Cash' }], tip: 0, cust: null }); try { state.data.orders = [${O("id: 'w1'")}]; return await payOrdersWithMethod(state.data.orders, 'T6'); } finally { openPaymentMethodModal = keepM; pollTables = keepP; }`, "{ 'POST /tables/7/pay-split': { ok: true, queued: true, action_id: 'a1' } }",
  (g) => g.said.some((s) => /Saved on this device/.test(s.msg)) && !g.said.some((s) => /^Marked paid/.test(s.msg)));
stub("the split posts the legs to the table's pay-split, in ONE call", `const keepM = openPaymentMethodModal, keepP = pollTables; pollTables = async () => {}; openPaymentMethodModal = async () => ({ method: 'Split', splitLegs: [{ amount: 210, method: 'UPI' }, { amount: 210, method: 'Cash' }], tip: 0, cust: null }); try { state.data.orders = [${O("id: 'w2'")}]; return await payOrdersWithMethod(state.data.orders, 'T6'); } finally { openPaymentMethodModal = keepM; pollTables = keepP; }`, "{ 'POST /tables/7/pay-split': { ok: true, count: 1 } }",
  (g) => g.sent.filter((s) => /pay-split/.test(s)).length === 1 && g.bodies.some((b) => b && Array.isArray(b.splits) && b.splits.length === 2));
stub("marking one order paid asks first, and a 'no' sends nothing", `state.data.orders = [${O("id: 'q1'")}]; return await setOrderPayment('q1', true);`, "{ confirm: false }",
  (g) => g.r === false && g.sent.length === 0);
stub("reverting a PAID order with no reason is refused and sends nothing", `state.data.orders = [${O("id: 'q2', payment_status: 'paid'")}]; return await setOrderPayment('q2', false);`, "{ prompt: '' }",
  (g) => g.r === false && g.sent.length === 0 && g.said.some((s) => /reason is required/.test(s.msg)));
stub("a refused payment puts the screen back the way it was", `state.data.orders = [${O("id: 'q3'")}]; const ok = await setOrderPayment('q3', true, { skipConfirm: true }); return { ok, now: state.data.orders[0].payment_status };`, "{ 'PATCH /orders/q3': 'THROW' }",
  (g) => g.r.ok === false && g.r.now === "pending");
stub("an on-the-house settle saved on this device says so, never 'undefined orders settled'", `const kp = pollTables, ke = ensurePartySlices; pollTables = async () => {}; ensurePartySlices = async () => {}; try { await onHouseSettle('7'); } finally { pollTables = kp; ensurePartySlices = ke; } return true;`, "{ 'POST /tables/7/on-the-house': { ok: true, queued: true, action_id: 'q' } }",
  (g) => g.said.some((s) => /Saved on this device/.test(s.msg)) && !g.said.some((s) => /undefined/.test(s.msg)));
stub("a Pay Later park saved on this device leaves the table where it is", `const kp = openKhataPersonPicker; openKhataPersonPicker = async () => ({ name: 'Riya' }); state.selectedTable = '7'; try { await khataParkFlow('7', [${O()}]); } finally { openKhataPersonPicker = kp; } return state.selectedTable;`, "{ 'POST /tables/7/khata': { ok: true, queued: true, action_id: 'k' } }",
  (g) => g.r === "7" && g.said.some((s) => /Saved on this device/.test(s.msg)));
stub("deleting asks a reason, keeps a PAID bill and says so", `state.data.orders = [${O("id: 'd1', payment_status: 'paid'")}]; await deleteOrders(['d1']); return state.data.orders.length;`, "{}",
  (g) => g.sent.length === 0 && g.said.some((s) => /paid bills are kept as records/.test(s.msg)));
stub("a delete that fails brings the bill's rows back on screen", `state.data.orders = [${O("id: 'd2', status: 'cancelled'")}]; await deleteOrders(['d2']); return state.data.orders.map((o) => o.id);`, "{ any: 'THROW' }",
  (g) => JSON.stringify(g.r) === '["d2"]');
stub("restoring a bill past its 30-minute window is refused before anything is sent", `const old = new Date(Date.now() - 45 * 60e3).toISOString(); await restoreBill([${O("archived: true, archived_at: old")}]); return true;`, "{}",
  (g) => g.sent.length === 0 && g.said.some((s) => /more than 30 minutes/.test(s.msg)));
stub("restoring a PAID bill asks ONE reason for the whole bill and sends it with every order", `const now = new Date().toISOString(); await restoreBill([${O("id: 'r1', payment_status: 'paid', paid_at: now")}, ${O("id: 'r2', payment_status: 'paid', paid_at: now")}]); return true;`, "{}",
  (g) => g.sent.length === 2 && g.bodies.every((b) => b.revert_reason === "test reason" && b.payment_status === "pending"));
// A bill none of whose orders was ever settled has no restore window at all (deadline 0), so it is
// refused before anything is sent. (The "Nothing on this bill needed restoring" branch below it can
// only be reached by an order that is settled AND needs no change — which no order can be.)
stub("a bill that was never settled cannot be 'restored' — refused, nothing sent", `await restoreBill([${O("id: 'r3'")}]); return true;`, "{}",
  (g) => g.sent.length === 0 && g.said.some((s) => /can no longer be restored/.test(s.msg)));
stub("a half-failed restore says how many failed", `const now = new Date().toISOString(); await restoreBill([${O("id: 'r4', archived: true, archived_at: now")}, ${O("id: 'r5', archived: true, archived_at: now")}]); return true;`, "{ 'PATCH /orders/r5': 'THROW' }",
  (g) => g.said.some((s) => /Restored 1 of 2 orders — 1 failed/.test(s.msg)));
stub("marking a call attended takes it off the list at once, and puts it back if refused", `state.data.calls = [{ id: 'c1', table_number: '7', created_at: new Date().toISOString() }]; await resolveCall('c1'); return state.data.calls.length;`, "{ any: 'THROW' }",
  (g) => g.r === 1 && g.said.some((s) => /Couldn't update the call/.test(s.msg)));
stub("a refused status change rolls the order back and says why", `state.data.orders = [${O("id: 's9', status: 'received'")}]; await setOrderStatus('s9', 'preparing'); return state.data.orders[0].status;`, "{ any: 'THROW' }",
  (g) => g.r === "received" && g.said.some((s) => /Couldn't update the order/.test(s.msg)));
stub("bulk sold-out says the split when some dishes could not be saved, in red", `const keep = state.data.items; state.data.items = [{ id: 'i1', tags: [] }, { id: 'i2', tags: [] }]; state.bulkSel = new Set(['i1', 'i2']); let n = 0; const kApi = api; api = async (m, p, b) => { if (++n === 2) throw new Error('no'); return { ok: true }; }; try { await bulkSoldOut(true); } finally { api = kApi; state.data.items = keep; state.bulkSel = new Set(); } return true;`, "{}",
  (g) => g.said.some((s) => /1 marked sold-out — 1 could NOT be saved/.test(s.msg) && s.type === "err"));
stub("bulk sold-out over dishes already sold out says there was nothing to change", `const keep = state.data.items; state.data.items = [{ id: 'i3', tags: ['sold-out'] }]; state.bulkSel = new Set(['i3']); try { await bulkSoldOut(true); } finally { state.data.items = keep; state.bulkSel = new Set(); } return true;`, "{}",
  (g) => g.sent.length === 0 && g.said.some((s) => /Nothing to change — that dish is already sold-out/.test(s.msg)));
stub("Pay Later loyalty: with the module off the strip stays hidden", `const w = document.createElement('div'); w.innerHTML = '<div class=\"pay-loyalty\" style=\"display:none\"></div>'; await renderLoyalty(w, '7', '9825012345'); return w.querySelector('.pay-loyalty').style.display;`, "{ 'POST /loyalty': { on: false } }",
  (g) => g.r === "none");
stub("a points redeem saved on this device says so and does not redraw the strip as spent", `const w = document.createElement('div'); w.innerHTML = '<div class=\"pay-loyalty\"></div>'; document.body.appendChild(w); try { await renderLoyalty(w, '7', '98'); const b = w.querySelector('.pay-loyalty-use'); b.onclick(); await new Promise((f) => setTimeout(f, 50)); return b.textContent; } finally { w.remove(); }`, "{ 'POST /loyalty': { on: true, balance: 200, min_redeem: 100, point_value_paise: 100 }, 'POST /loyalty-redeem': { ok: true, queued: true, action_id: 'l' } }",
  (g) => /Saved — sends when back online/.test(g.r) && !g.said.some((s) => /undefined/.test(s.msg)));
stub("the bill's points line needs a phone: no phone, no line", `return await loyaltyForBill('7', { cust_phone: '' }, { total: 500 });`, "{}", (g) => g.r === null && g.sent.length === 0);
stub("…and with one, it earns from THIS bill and quotes the balance BEFORE it", `return await loyaltyForBill('7', { cust_phone: '98' }, { total: 450 });`, "{ 'POST /loyalty': { on: true, earn_per_100: 10, balance: 30, min_redeem: 100 } }",
  (g) => g.r && g.r.earn === 45 && g.r.balance === 30 && g.r.toNext === 25);
