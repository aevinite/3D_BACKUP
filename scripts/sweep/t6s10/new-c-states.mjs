// BLOCK C · from P175138 — THE STATES THE HAPPY PATH NEVER VISITS: a read that fails, a server too
// busy to answer, no signal, an empty restaurant, a second restaurant, the back button and Escape
// inside every popup my half opens. Driven in the real panel; api() replaced for one check at a time
// and put back in a finally, so nothing is written. Subject file named in every row.
import { check, ev, evAdmin } from "./lib.mjs";

const F = "`public/panels/editor/app.js`";
let n = 175138;
const id = () => "P" + n++;
// FAIL(path, kind): replace api() so ONE path fails (offline | busy | refused) and run body.
const FAIL = (match, kind, body) => `(async () => {
  const keep = api;
  api = async (m, p, b, o) => { if (new RegExp(${JSON.stringify(match)}).test(String(p))) { const e = new Error(${JSON.stringify(kind === "offline" ? "Failed to fetch" : kind === "busy" ? "TimeoutError" : "Not allowed")}); ${kind === "offline" ? "e.offline = true;" : kind === "busy" ? "e.busy = true; e.status = 503;" : "e.status = 403;"} throw e; } return keep(m, p, b, o); };
  try { return await (async () => { ${body} })(); } finally { api = keep; }
})()`;
const txt = (sel) => `((document.querySelector(${JSON.stringify(sel)}) || {}).textContent || '').replace(/\\s+/g, ' ').trim()`;
const C = (what, how, expr, cmp) => check(id(), `${F} — ${what}`, `LIVE: ${how}`, async () => {
  let g; try { g = await ev(expr); } catch (e) { return { ok: false, note: "threw: " + e.message }; }
  return { ok: !!cmp(g), note: JSON.stringify(g).slice(0, 170) };
});

// ── a read that fails says so, in words, and never pretends to be empty ──────────────────────
for (const [kind, label] of [["offline", "with no signal"], ["busy", "while the server is too busy"], ["refused", "when the server refuses"]]) {
  C(`the Dashboard ${label} says it could not load its numbers — never a zero dashboard`, `/stats fails (${kind})`,
    FAIL("^/stats", kind, `setTab('dash'); await new Promise((f) => setTimeout(f, 1500)); return ${txt("#dashBody")};`),
    (g) => /Couldn't load stats/.test(g) && !/₹0/.test(g));
  C(`Rating review ${label} says it could not load, rather than 'No guest ratings yet'`, `/ratings fails (${kind})`,
    FAIL("^/ratings", kind, `const b = document.createElement('div'); b.id = 'ratingsBody'; document.body.appendChild(b); try { await loadRatings(); return b.textContent.trim(); } finally { b.remove(); }`),
    (g) => /Couldn't load ratings/.test(g) && !/No guest ratings yet/.test(g));
  C(`Pay Later ${label} says it could not load the book, rather than 'No pay-later bills'`, `/khata fails (${kind})`,
    FAIL("^/khata$", kind, `const k = state.khataBook, t = state.khataLoadedAt; state.khataBook = null; state.khataLoadedAt = 0; try { await loadKhataBook(); return ordersKhataHtml(); } finally { state.khataBook = k; state.khataLoadedAt = t; }`),
    (g) => /Couldn't load Pay Later/.test(g) && !/No pay-later bills/.test(g));
  C(`the Z report ${label} says it could not be built`, `/zreport fails (${kind})`,
    FAIL("^/zreport", kind, `await openZReport(); const t = ${txt(".zr-overlay #zrBody")}; document.querySelector('.zr-overlay')?.remove(); return t;`),
    (g) => /Couldn't build the report/.test(g));
  C(`the GST report ${label} says it could not load`, `/gst-report fails (${kind})`,
    FAIL("^/gst-report", kind, `openGstReport(); await new Promise((f) => setTimeout(f, 400)); const t = ${txt(".gst-overlay #gstBody")}; document.querySelector('.gst-overlay')?.remove(); return t;`),
    (g) => /Couldn't load/.test(g));
  C(`Staff watch ${label} says it could not load, rather than 'nothing to flag'`, `/staff-risk fails (${kind})`,
    FAIL("^/staff-risk", kind, `await openStaffRisk(); const t = ${txt(".sr-overlay #srBody")}; document.querySelector('.sr-overlay')?.remove(); return t;`),
    (g) => /Couldn't load/.test(g) && !/nothing to flag/.test(g));
  C(`the Printing board ${label} keeps an honest error, never 'you have no printers'`, `/printing/state fails (${kind})`,
    FAIL("^/printing/state", kind, `const kb = state.printBoard, ke = state.printBoardErr; state.printBoard = null; try { await loadPrintBoard(); return { err: state.printBoardErr, board: state.printBoard }; } finally { state.printBoard = kb; state.printBoardErr = ke; }`),
    (g) => !!g.err && g.board === null);
}
C("the Previous-bills record with its read failing shows what the device has and says why (item 7)", "/orders?bills=1 fails (offline)",
  FAIL("^/orders\\?bills=1", "offline", `const k = state.billsRec, ke = state.billsRecErr; state.billsRec = null; state.billsRecErr = null; try { setTab('orders'); state.ordersView = 'previous'; renderEditor(); await new Promise((f) => setTimeout(f, 800)); return ${txt("#editor")}; } finally { state.billsRec = k; state.billsRecErr = ke; renderEditor(); }`),
  (g) => /No internet right now — these are the bills this device already has/.test(g) && !/Still reading/.test(g));
C("…and a busy server gets the other sentence, not 'no internet'", "/orders?bills=1 fails (busy)",
  FAIL("^/orders\\?bills=1", "busy", `const k = state.billsRec, ke = state.billsRecErr; state.billsRec = null; state.billsRecErr = null; try { setTab('orders'); state.ordersView = 'previous'; renderEditor(); await new Promise((f) => setTimeout(f, 800)); return ${txt("#editor")}; } finally { state.billsRec = k; state.billsRecErr = ke; renderEditor(); }`),
  (g) => /didn't answer just now/.test(g) && !/No internet/.test(g));
C("a failed bills read is retried on a clock, not on every repaint (one read for five repaints)", "count /orders?bills=1 calls across five renders after a failure",
  `(async () => { const keep = api; let n = 0; api = async (m, p) => { if (/^\\/orders\\?bills=1/.test(p)) { n++; const e = new Error('x'); e.offline = true; throw e; } return keep(m, p); };
    const k = state.billsRec, ke = state.billsRecErr; state.billsRec = null; state.billsRecErr = null;
    try { setTab('orders'); state.ordersView = 'previous'; for (let i = 0; i < 5; i++) { renderEditor(); await new Promise((f) => setTimeout(f, 60)); } return n; } finally { api = keep; state.billsRec = k; state.billsRecErr = ke; renderEditor(); } })()`,
  (g) => g === 1);
C("the Users card on a refused staff read says the server's reason, not an empty team", "loadStaffTeam with /api/owner/staff refused",
  `(async () => { const kf = window.fetch; window.fetch = async (u, o) => (/\\/api\\/owner\\/staff/.test(String(u)) ? new Response(JSON.stringify({ error: 'Your owner has not given you staff access.' }), { status: 403 }) : kf(u, o));
    const k = [state.staffLoaded, state.staffDenied, state.staffTeam]; try { await loadStaffTeam(); return userSettingCardHtml(); } finally { window.fetch = kf; [state.staffLoaded, state.staffDenied, state.staffTeam] = k; } })()`,
  (g) => /Your owner has not given you staff access\./.test(g) && !/No staff yet/.test(g));
C("…and with no network at all it says it could not reach the server", "loadStaffTeam with fetch throwing",
  `(async () => { const kf = window.fetch; window.fetch = async (u, o) => { if (/\\/api\\/owner\\/staff/.test(String(u))) throw new TypeError('Failed to fetch'); return kf(u, o); };
    const k = [state.staffLoaded, state.staffDenied, state.staffTeam]; try { await loadStaffTeam(); return userSettingCardHtml(); } finally { window.fetch = kf; [state.staffLoaded, state.staffDenied, state.staffTeam] = k; } })()`,
  (g) => /Couldn(?:'|&#39;)t reach the server\./.test(g));
C("the waiter-sections card on a refused read says why, not 'no waiter logins yet'", "loadTableSections refused",
  `(async () => { const kf = window.fetch; window.fetch = async (u, o) => (/table-sections/.test(String(u)) ? new Response(JSON.stringify({ error: 'Sections are not part of this restaurant.' }), { status: 403 }) : kf(u, o));
    const k = [state.sections, state.sectionsDenied, state.sectionsLoaded]; try { await loadTableSections(); return tableSectionsCardHtml(); } finally { window.fetch = kf; [state.sections, state.sectionsDenied, state.sectionsLoaded] = k; } })()`,
  (g) => /Sections are not part of this restaurant\./.test(g) && !/No waiter logins yet/.test(g));
C("a rota save refused as a clash says the server's own sentence and re-reads the rota", "saveWaiterTables with a 409 clash",
  `(async () => { const keep = api, kl = loadTableSections, kt = toast; const said = []; let reread = 0;
    api = async () => { const e = new Error('clash_changed_elsewhere'); e.status = 409; e.data = { clash: { plain: 'Someone else changed Asha’s tables a moment ago.' } }; throw e; };
    loadTableSections = async () => { reread++; }; toast = (m) => said.push(m);
    const ONE = [1]; const ks = state.sections; state.sections = { tableCount: 4, waiters: [{ id: 'w1', name: 'Asha', active: true, assigned_tables: ONE }] };
    try { await saveWaiterTables('w1', [1, 2]); return { said, reread, back: state.sections.waiters[0].assigned_tables }; }
    finally { api = keep; loadTableSections = kl; toast = kt; state.sections = ks; renderEditor(); } })()`,
  (g) => g.said.some((m) => /Someone else changed/.test(m)) && g.reread === 1 && JSON.stringify(g.back) === "[1]");
C("a rota save with no signal keeps the new grid and says it will send by itself", "saveWaiterTables answered queued",
  `(async () => { const keep = api, kt = toast; const said = []; api = async () => ({ ok: true, queued: true, action_id: 'r' }); toast = (m) => said.push(m);
    const ONE = [1]; const ks = state.sections; state.sections = { tableCount: 4, waiters: [{ id: 'w1', name: 'Asha', active: true, assigned_tables: ONE }] };
    try { await saveWaiterTables('w1', [1, 2]); return { said, now: state.sections.waiters[0].assigned_tables }; } finally { api = keep; toast = kt; state.sections = ks; renderEditor(); } })()`,
  (g) => g.said.some((m) => /Saved on this device/.test(m)) && JSON.stringify(g.now) === "[1,2]");
C("a bills search on a day past the window's cap asks the server; a normal day asks nothing", "loadBillHistory types",
  `(async () => { const keep = api; let n = 0; api = async (m, p, b, o) => { if (/history=1/.test(p)) { n++; return []; } return keep(m, p, b, o); }; try { loadBillHistory('42', 'amount'); await new Promise((f) => setTimeout(f, 400)); const a = n; loadBillHistory('42', 'inv'); await new Promise((f) => setTimeout(f, 400)); return [a, n]; } finally { api = keep; state.billHistRows = []; } })()`,
  (g) => g[0] === 0 && g[1] === 1);
C("typing fast into the bills history search costs ONE read (debounced)", "five calls in a row",
  `(async () => { const keep = api; let n = 0; api = async (m, p, b, o) => { if (/history=1/.test(p)) { n++; return []; } return keep(m, p, b, o); }; try { for (const q of ['4', '42', '420', '4201', '42013']) loadBillHistory(q, 'inv'); await new Promise((f) => setTimeout(f, 500)); return n; } finally { api = keep; state.billHistRows = []; } })()`,
  (g) => g === 1);
C("a slow older bills-history answer cannot overwrite a newer one", "two searches, the first answering last",
  `(async () => { const keep = api; api = async (m, p) => { const slow = /q=old/.test(p); await new Promise((f) => setTimeout(f, slow ? 700 : 20)); return [{ id: slow ? 'OLD' : 'NEW' }]; };
    try { loadBillHistory('old', 'inv'); await new Promise((f) => setTimeout(f, 320)); loadBillHistory('new', 'inv'); await new Promise((f) => setTimeout(f, 1200)); return state.billHistRows.map((x) => x.id); } finally { api = keep; state.billHistRows = []; } })()`,
  (g) => JSON.stringify(g) === '["NEW"]');
C("a Pay Later person search answers latest-wins too", "two khata searches, the first slow",
  `(async () => { const keep = api; api = async (m, p) => { const slow = /q=a$/.test(p); await new Promise((f) => setTimeout(f, slow ? 600 : 10)); return { customers: [{ id: slow ? 'OLD' : 'NEW', name: slow ? 'Old' : 'New' }] }; };
    const p = openKhataPersonPicker(100, 7); await new Promise((f) => setTimeout(f, 50)); const w = document.querySelector('.khata-overlay'); const s = w.querySelector('#khataSearch');
    try { s.value = 'a'; s.oninput(); await new Promise((f) => setTimeout(f, 300)); s.value = 'ab'; s.oninput(); await new Promise((f) => setTimeout(f, 900)); return [...w.querySelectorAll('.khata-pick-row b')].map((b) => b.textContent); } finally { api = keep; w.__lfhClose(); await p; } })()`,
  (g) => JSON.stringify(g) === '["New"]');
C("the Pay Later picker refuses to park with no person and no name, out loud", "press Park on an empty picker",
  `(async () => { const keep = api, kt = toast; const said = []; api = async () => ({ customers: [] }); toast = (m) => said.push(m); const p = openKhataPersonPicker(100, 7); await new Promise((f) => setTimeout(f, 50)); const w = document.querySelector('.khata-overlay');
    try { w.querySelector('#khataParkBtn').click(); return { said, open: document.body.contains(w) }; } finally { api = keep; toast = kt; w.__lfhClose(); await p; } })()`,
  (g) => g.open && g.said.some((m) => /Pick a person from the list, or type a name/.test(m)));
C("the Pay Later picker hands back the picked person's NAME with the id", "pick a row, press Park",
  `(async () => { const keep = api; api = async () => ({ customers: [{ id: 'c9', name: 'Riya', phone: '98', outstanding: 120 }] }); const p = openKhataPersonPicker(100, 7); await new Promise((f) => setTimeout(f, 80)); const w = document.querySelector('.khata-overlay');
    try { w.querySelector('.khata-pick-row').click(); w.querySelector('#khataParkBtn').click(); return await p; } finally { api = keep; } })()`,
  (g) => g && g.customer_id === "c9" && g.name === "Riya");
C("a person who already owes is badged so, in the picker", "a customer with outstanding > 0",
  `(async () => { const keep = api; api = async () => ({ customers: [{ id: 'c9', name: 'Riya', phone: '98', outstanding: 120 }] }); const p = openKhataPersonPicker(100, 7); await new Promise((f) => setTimeout(f, 80)); const w = document.querySelector('.khata-overlay');
    try { return ${txt(".khata-pick-owes")}; } finally { api = keep; w.__lfhClose(); await p; } })()`,
  (g) => /owes ₹120/.test(g));

// ── an empty restaurant / a quiet day ────────────────────────────────────────────────────────
C("Bills → Live with nothing open says how orders arrive, not a blank page", "ordersLiveHtml([])", `ordersLiveHtml([])`, (g) => /No active orders right now/.test(g));
C("Calls with none waiting says so", "ordersCallsHtml with no calls", `(() => { const k = state.data.calls; state.data.calls = []; try { return ordersCallsHtml(); } finally { state.data.calls = k; } })()`, (g) => /No waiter calls right now/.test(g));
C("Pay Later with an empty book tells the manager how a bill lands there", "ordersKhataHtml with an empty book",
  `(() => { const k = state.khataBook, t = state.khataLoadedAt; state.khataBook = { customers: [], total: 0, collectedToday: 0 }; state.khataLoadedAt = Date.now(); try { return ordersKhataHtml(); } finally { state.khataBook = k; state.khataLoadedAt = t; } })()`,
  (g) => /Settle a table with/.test(g) && !/khata-search/.test(g));
C("the On-the-house card with no report access says it needs the dashboard permission", "ordersKhataHtml with no report",
  `(() => { const k = state.khataBook, t = state.khataLoadedAt, o = state.onhouseReport; state.khataBook = { customers: [], total: 0 }; state.khataLoadedAt = Date.now(); state.onhouseReport = null; try { return ordersKhataHtml(); } finally { state.khataBook = k; state.khataLoadedAt = t; state.onhouseReport = o; } })()`,
  (g) => /needs the dashboard permission/.test(g));
C("the On-the-house card's window is the server's (a today-only reach reads 'today', not 'Last 30 days')", "ordersKhataHtml with windowLabel today",
  `(() => { const k = state.khataBook, t = state.khataLoadedAt, o = state.onhouseReport; state.khataBook = { customers: [], total: 0 }; state.khataLoadedAt = Date.now(); state.onhouseReport = { bills: [], count: 0, total: 0, windowLabel: 'today' }; try { return ordersKhataHtml(); } finally { state.khataBook = k; state.khataLoadedAt = t; state.onhouseReport = o; } })()`,
  (g) => /No on-the-house bills today\./.test(g) && !/30 days/.test(g));
C("a Pay Later search that matches nobody says so with what was typed", "khataSearch = zz",
  `(() => { const k = state.khataBook, t = state.khataLoadedAt, s = state.khataSearch; state.khataBook = { customers: [{ id: 'a', name: 'Riya', phone: '98', outstanding: 10, bills: [] }], total: 10 }; state.khataLoadedAt = Date.now(); state.khataSearch = 'zz'; try { return ordersKhataHtml(); } finally { state.khataBook = k; state.khataLoadedAt = t; state.khataSearch = s; } })()`,
  (g) => /No one matches “zz”/.test(g));
C("a Pay Later phone typed with a space still finds the stored number", "khataSearch = '98250 12345'",
  `(() => { const k = state.khataBook, t = state.khataLoadedAt, s = state.khataSearch; state.khataBook = { customers: [{ id: 'a', name: 'Riya', phone: '9825012345', outstanding: 10, bills: [] }], total: 10 }; state.khataLoadedAt = Date.now(); state.khataSearch = '98250 12345'; try { return /Riya/.test(ordersKhataHtml()); } finally { state.khataBook = k; state.khataLoadedAt = t; state.khataSearch = s; } })()`,
  (g) => g === true);
C("the Dashboard on a day with one busy hour names it instead of drawing a lonely bar", "loadDashboard over a one-hour /stats", `(async () => { const keep = api; const hours = Array(24).fill(0); hours[13] = 4;
    api = async (m, p) => (/^\\/stats/.test(p) ? { revenue: 0, paid: 0, unpaid: 0, orderCount: 4, hours, series: [], dayParts: [], topDishes: [], cats: {}, paymentMethods: [], channels: {}, prev: {} } : keep(m, p));
    try { loadDashboard._last = null; setTab('dash'); await new Promise((f) => setTimeout(f, 2500)); return ${txt("#dashBody")}; } finally { api = keep; loadDashboard._last = null; } })()`,
  (g) => /Every order so far came in between 13:00 and 14:00/.test(g) && /No sales in this range yet/.test(g));
C("a quiet Dashboard says 'no paid bills yet' and 'clean sheet', never NaN", "loadDashboard over an empty /stats", `(async () => { const keep = api;
    api = async (m, p) => (/^\\/stats/.test(p) ? { revenue: 0, paid: 0, unpaid: 0, orderCount: 0, hours: Array(24).fill(0), series: [], dayParts: [], topDishes: [], cats: {}, paymentMethods: [], channels: {}, prev: {} } : keep(m, p));
    try { loadDashboard._last = null; setTab('dash'); await new Promise((f) => setTimeout(f, 2500)); return ${txt("#dashBody")}; } finally { api = keep; loadDashboard._last = null; } })()`,
  (g) => /no paid bills yet/.test(g) && /clean sheet/.test(g) && !/NaN|undefined/.test(g));
C("an oversized range says its totals read a little low, rather than claiming the full sum", "/stats truncated", `(async () => { const keep = api;
    api = async (m, p) => (/^\\/stats/.test(p) ? { truncated: true, statsCap: 5000, revenue: 10, paid: 1, unpaid: 0, orderCount: 1, avgOrder: 10, hours: Array(24).fill(0), series: [], dayParts: [], topDishes: [], cats: {}, paymentMethods: [], channels: {}, prev: {} } : keep(m, p));
    try { loadDashboard._last = null; setTab('dash'); await new Promise((f) => setTimeout(f, 2500)); return ${txt("#dashBody")}; } finally { api = keep; loadDashboard._last = null; } })()`,
  (g) => /Showing the most recent 5,000 orders/.test(g));
C("the Z report with nothing collected says so instead of an empty table", "openZReport over an empty day", `(async () => { const keep = api;
    api = async (m, p) => (/^\\/zreport/.test(p) ? { restaurant: { name: 'X' }, date: '2026-10-12', grandTotal: 0, dineIn: { bills: 0, orderCount: 0, gross: 0, discount: 0, taxable: 0, tax: 0, net: 0, paidCount: 0, paidNet: 0, unpaidCount: 0, unpaidNet: 0, cancelled: 0 }, platform: { count: 0, revenue: 0 }, payments: { rows: [], total: 0 }, invoicesGenerated: 0, invoicesVoided: 0 } : keep(m, p));
    try { await openZReport(); const t = ${txt(".zr-overlay #zrBody")}; document.querySelector('.zr-overlay')?.remove(); return t; } finally { api = keep; } })()`,
  (g) => /Nothing collected yet today/.test(g) && /Every number accounted for/.test(g));
C("the Z report names a broken bill ledger as a sentence for the owner", "openZReport with a chain problem", `(async () => { const keep = api;
    api = async (m, p) => (/^\\/zreport/.test(p) ? { restaurant: { name: 'X' }, date: '2026-10-12', grandTotal: 0, dineIn: { bills: 0 }, platform: { count: 0, revenue: 0 }, payments: { rows: [], total: 0 }, chain: { ok: false, problems: [{ kind: 'bill_changed', bill_no: 7, detail: 'total moved' }], notes: [] } } : keep(m, p));
    try { await openZReport(); const t = ${txt(".zr-overlay #zrBody")}; document.querySelector('.zr-overlay')?.remove(); return t; } finally { api = keep; } })()`,
  (g) => /1 thing on the bill ledger need the owner/.test(g) && /bill #7 changed after signing/.test(g));
C("the Z report's chain check failing is said as 'could not be checked', never as clean", "chain.error", `(async () => { const keep = api;
    api = async (m, p) => (/^\\/zreport/.test(p) ? { restaurant: { name: 'X' }, date: 'd', grandTotal: 0, dineIn: { bills: 0 }, platform: { count: 0, revenue: 0 }, payments: { rows: [], total: 0 }, chain: { error: 'timeout' } } : keep(m, p));
    try { await openZReport(); const t = ${txt(".zr-overlay #zrBody")}; document.querySelector('.zr-overlay')?.remove(); return t; } finally { api = keep; } })()`,
  (g) => /could not be checked/.test(g) && !/signed and unchanged/.test(g));
C("the Z report names numbers on no bill as a WARN line", "numbering.unaccounted", `(async () => { const keep = api;
    api = async (m, p) => (/^\\/zreport/.test(p) ? { restaurant: { name: 'X' }, date: 'd', grandTotal: 0, dineIn: { bills: 0 }, platform: { count: 0, revenue: 0 }, payments: { rows: [], total: 0 }, numbering: { issued: 5, from: 1, to: 5, unaccounted: [3], unaccountedTotal: 1 } } : keep(m, p));
    try { await openZReport(); const t = ${txt(".zr-overlay #zrBody")}; document.querySelector('.zr-overlay')?.remove(); return t; } finally { api = keep; } })()`,
  (g) => /Not on any bill \(1\)/.test(g) && /#3/.test(g));
C("money settled with no method recorded is named on the Z report, not hidden", "paidNet above the methods' total", `(async () => { const keep = api;
    api = async (m, p) => (/^\\/zreport/.test(p) ? { restaurant: { name: 'X' }, date: 'd', grandTotal: 500, dineIn: { bills: 1, paidNet: 500 }, platform: { count: 0, revenue: 0 }, payments: { rows: [{ method: 'Cash', bills: 1, amount: 300 }], total: 300 } } : keep(m, p));
    try { await openZReport(); const t = ${txt(".zr-overlay #zrBody")}; document.querySelector('.zr-overlay')?.remove(); return t; } finally { api = keep; } })()`,
  (g) => /Settled with no method recorded/.test(g) && /200/.test(g));

// ── the back button and Escape inside every popup my half opens ──────────────────────────────
const POPS = [
  ["the yes/no question", "confirmDialog('T6', 'Yes')", ".confirm-overlay"],
  ["the reason box", "promptDialog('T6', {})", ".confirm-overlay"],
  ["the bill popup", "openBillModal((state.data.orders.find((o) => o.session_id) || {}).session_id || 'none')", ".bill-overlay"],
  ["the pay sheet", "openPaymentMethodModal(100, 'T6', {})", ".pay-overlay"],
  ["the Pay Later picker", "openKhataPersonPicker(100, 7)", ".khata-overlay"],
  ["the table-mark popup", "openTagModal(7)", ".tag-overlay"],
  ["Staff watch", "openStaffRisk()", ".sr-overlay"],
  ["Menu winners", "openMenuMatrix()", ".mm-overlay"],
  ["the GST report", "openGstReport()", ".gst-overlay"],
  ["the Z report", "openZReport()", ".zr-overlay"],
];
for (const [what, open, sel] of POPS) {
  C(`${what} registers with the phone's BACK button and BACK takes it away`, "open it, fire LFH_BACK's top layer (history back), count it",
    `(async () => { const before = document.querySelectorAll(${JSON.stringify(sel)}).length; const p = (async () => { try { return await ${open}; } catch (e) { return 'threw ' + e.message; } })();
      await new Promise((f) => setTimeout(f, 700)); const opened = document.querySelectorAll(${JSON.stringify(sel)}).length > before;
      if (opened) { history.back(); await new Promise((f) => setTimeout(f, 700)); }
      const after = document.querySelectorAll(${JSON.stringify(sel)}).length; document.querySelectorAll(${JSON.stringify(sel)}).forEach((x) => (x.__lfhClose ? x.__lfhClose() : x.remove()));
      return { opened, closedByBack: opened && after === before, stillOnPanel: /panels\\/editor/.test(location.pathname) }; })()`,
    (g) => g.opened && g.closedByBack && g.stillOnPanel);
}
C("Escape closes the bill popup on a desktop", "press Escape", `(async () => { const k = (state.data.orders.find((o) => o.session_id) || {}).session_id; if (!k) return 'no bill'; openBillModal(k); await new Promise((f) => setTimeout(f, 100)); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); await new Promise((f) => setTimeout(f, 300)); return !document.querySelector('.bill-overlay'); })()`,
  (g) => g === true || g === "no bill");
C("Escape answers 'no' to the yes/no question", "press Escape", `(async () => { const p = confirmDialog('T6', 'Yes'); await new Promise((f) => setTimeout(f, 50)); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); return await p; })()`, (g) => g === false);
C("Enter submits the reason box once something is typed", "type, press Enter", `(async () => { const p = promptDialog('T6', {}); await new Promise((f) => setTimeout(f, 400)); document.querySelector('.confirm-input').value = 'typed'; document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })); return await p; })()`, (g) => g === "typed");
C("Escape on a section picker closes ONLY the top one", "two section overlays, one Escape", `(async () => { const ONE = [1]; const ks = state.sections; state.sections = { tableCount: 3, waiters: [{ id: 'w1', name: 'A', active: true, assigned_tables: ONE }] };
    try { openSectionPicker('w1'); openTableHolderPicker(2); await new Promise((f) => setTimeout(f, 50)); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); const left = document.querySelectorAll('.sx-modal-overlay').length; document.querySelectorAll('.sx-modal-overlay').forEach((x) => x.__lfhClose()); return left; } finally { state.sections = ks; } })()`,
  (g) => g === 1);
C("a tap on the dark backdrop of the bill popup closes it; a tap inside does not", "click the overlay vs the card", `(async () => { const k = (state.data.orders.find((o) => o.session_id) || {}).session_id; if (!k) return 'no bill'; openBillModal(k); await new Promise((f) => setTimeout(f, 50)); const w = document.querySelector('.bill-overlay'); w.querySelector('.bill-modal').click(); const inside = document.body.contains(w); w.click(); await new Promise((f) => setTimeout(f, 250)); return inside && !document.body.contains(w); })()`,
  (g) => g === true || g === "no bill");
C("a fast double-tap on Confirm is HELD, not dropped, and answers once", "two clicks 150ms after opening", `(async () => { const p = confirmDialog('T6', 'Yes'); await new Promise((f) => setTimeout(f, 150)); const b = document.querySelector('.confirm-overlay:not([data-closing]) .confirm-ok'); b.click(); b.click(); return await Promise.race([p, new Promise((f) => setTimeout(() => f('PENDING'), 900))]); })()`, (g) => g === true);
C("a tap in the first 120ms (the tail of a double-click) is refused visibly, not silently", "click at once", `(async () => { await new Promise((f) => setTimeout(f, 300)); const p = confirmDialog('T6', 'Yes'); const w = document.querySelector('.confirm-overlay:not([data-closing])'); w.querySelector('.confirm-ok').click(); const nudged = w.classList.contains('confirm-nudge'); await new Promise((f) => setTimeout(f, 400)); w.querySelector('.confirm-cancel').click(); await Promise.race([p, new Promise((f) => setTimeout(f, 1500))]); return nudged; })()`, (g) => g === true);

// ── a second restaurant, READ only (Aangan is the control — nothing written to it) ───────────
check(id(), `${F} — the admin's view of a restaurant pins every call to THAT restaurant (?rid on each request)`, "LIVE: the admin view of French House, ridQ on a path", async () => {
  const g = await evAdmin(`ridQ('/stats?range=today')`); return { ok: /\/stats\?range=today&rid=00000000-0000-0000-0000-000000000001$/.test(g), note: g };
});
check(id(), `${F} — the top bar names the restaurant being looked at, from its OWN record`, "LIVE: brandRest in the admin view", async () => {
  const g = await evAdmin(`[document.getElementById('brandRest').textContent, (state.data.restaurant || {}).id]`); return { ok: !!g[0] && g[1] === "00000000-0000-0000-0000-000000000001", note: JSON.stringify(g) };
});
check(id(), `${F} — a real manager's login carries no ?rid at all — the server decides the restaurant`, "LIVE: ridQ in the manager's own panel", async () => {
  const g = await ev(`ridQ('/stats')`); return { ok: g === "/stats", note: g };
});
check(id(), `${F} — the bill shows the restaurant's OWN logo or none (never restaurant #1's by default)`, "LIVE: billLogo()", async () => {
  const g = await ev(`[billLogo(), (state.data.restaurant || {}).logo_url || '']`); return { ok: g[0] === "" || g[0] === g[1], note: JSON.stringify(g) };
});
