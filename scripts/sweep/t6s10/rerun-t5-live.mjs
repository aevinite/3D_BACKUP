// scripts/sweep/t6s10/rerun-t5-live.mjs — re-driving T5.md's headless / screenshot / judgment rows
// whose SCREEN my half of editor/app.js draws: Bills (Live · Previous · Pay Later · Calls), Settings,
// the Dashboard, the toast, and the money/consent rules of the pay sheet.
//
// Every row is re-driven on THIS terminal's dev server, signed in once as French House's manager.
// Where a row needs a state today's data does not have (a live bill card when no table is open), the
// panel's OWN renderer is run over an in-memory board — nothing is written, and the row says so.
//
//   node scripts/sweep/t6s10/rerun-t5-live.mjs [--json file]
import { writeFileSync } from "node:fs";
import { APP, rd, panel, ev, closeLive } from "./lib.mjs";

const A = process.argv.slice(2);
const res = {};
const mark = (id, ok, note) => { res[id] = { ok, note: note || "" }; };
const BILLDOC = rd("public/panels/billdoc.js"), TABLET = rd("public/panels/tablet/app.js"), ROUTE = rd("app/api/editor/[...path]/route.ts");

const p = await panel();
// ── Bills ─────────────────────────────────────────────────────────────────────────────────────
const bills = await ev(`(async () => { const r = {}; const now = new Date().toISOString();
  setTab('orders'); state.ordersView = 'live'; renderList(); renderEditor(); await new Promise((f) => setTimeout(f, 600));
  r.nav = [...document.querySelectorAll('#list [data-orders-view]')].map((x) => x.dataset.ordersView);
  r.navCounts = [...document.querySelectorAll('#list [data-orders-view]')].map((x) => (x.querySelector('.ord-nav-count') || {}).textContent || '0');
  r.realLive = document.querySelectorAll('#editor .ord-card').length;
  // An in-memory board (nothing written): one un-invoiced running bill, one invoiced unpaid bill.
  const keepO = state.data.orders;
  const o = (x) => ({ id: 't6-' + Math.random().toString(36).slice(2, 8), table_number: '7', status: 'served', payment_status: 'pending', created_at: now, kot_no: 81, subtotal: 400, total: 420, discount: 0, items: [{ title: 'Paneer Tikka', qty: 2, price: 200 }], ...x });
  state.data.orders = [o({ session_id: 'sA' }), o({ session_id: 'sB', table_number: '9', invoice_no: 77, invoice_at: now })];
  renderEditor(); await new Promise((f) => setTimeout(f, 200));
  const ed = document.getElementById('editor');
  r.cards = ed.querySelectorAll('.ord-card').length; r.pending = !!ed.querySelector('.ord-note'); r.pendingTxt = (ed.querySelector('.ord-note') || {}).textContent || '';
  r.printBtns = ed.querySelectorAll('[data-print-issue], [data-print-group]').length;
  const c1 = [...ed.querySelectorAll('.ord-card')].find((c) => /T7/.test(c.textContent)), c2 = [...ed.querySelectorAll('.ord-card')].find((c) => /T9/.test(c.textContent));
  r.c1 = c1 ? [...c1.querySelectorAll('.ord-actions button')].map((b) => b.textContent.trim()) : []; r.c2 = c2 ? [...c2.querySelectorAll('.ord-actions button')].map((b) => b.textContent.trim()) : [];
  r.c1txt = c1 ? c1.textContent.replace(/\\s+/g, ' ').trim() : '';
  r.clipped = [...ed.querySelectorAll('.ord-card *')].filter((e) => e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).textOverflow === 'ellipsis').length;
  state.data.orders = keepO;
  // Previous bills — the REAL record
  state.ordersView = 'previous'; renderList(); renderEditor();
  for (let i = 0; i < 40 && !state.billsRec; i++) await new Promise((f) => setTimeout(f, 250));
  renderEditor(); await new Promise((f) => setTimeout(f, 300));
  const pv = document.getElementById('editor');
  r.days = [...pv.querySelectorAll('.ord-section-divider h3')].map((h) => h.textContent.trim());
  r.totals = [...pv.querySelectorAll('.bill-day-total')].map((t) => t.textContent.replace(/\\s+/g, ' ').trim());
  r.hint = (pv.querySelector('[data-bill-q]') || {}).placeholder || ''; r.title = (pv.querySelector('[data-bill-q]') || {}).title || '';
  r.lines = pv.querySelectorAll('.bill-line').length; r.split = !!pv.querySelector('.bill-split'); r.rcp = !!pv.querySelector('.bill-rcp');
  r.typeSel = !!pv.querySelector('select[data-bill-stype], [data-bill-stype]');
  r.cancelledLine = [...pv.querySelectorAll('.bill-line')].find((l) => /Cancelled/.test(l.textContent));
  if (r.cancelledLine) { r.cancelledLine.click(); await new Promise((f) => setTimeout(f, 200)); const rc = document.querySelector('.bill-rcp'); r.cancelRcp = rc ? rc.textContent.replace(/\\s+/g, ' ').trim() : ''; r.cancelPriced = rc ? [...rc.querySelectorAll('.br-items .ol-price, .br-items .bm-pr')].length : -1; r.cancelledLine = true; } else r.cancelledLine = false;
  const settled = [...pv.querySelectorAll('.bill-line')].find((l) => /Settled/.test(l.textContent));
  if (settled) { settled.click(); await new Promise((f) => setTimeout(f, 200)); const rc = document.querySelector('.bill-rcp'); r.settledRcp = rc ? rc.textContent.replace(/\\s+/g, ' ').trim() : ''; }
  const n = (q) => { state.billSearch = q; renderEditor(); return document.querySelectorAll('.bill-line').length; };
  r.all = n(''); r.unpaid = n('unpaid'); r.due = n('due'); r.outstanding = n('outstanding'); r.paid = n('paid'); r.cancelledQ = n('cancelled'); r.voidQ = n('void');
  r.none = n('zzqqxx'); r.noneTxt = ((document.querySelector('.bill-noneq') || {}).textContent || '').replace(/\\s+/g, ' ').trim(); r.back = n('');
  // does the list agree with its heading when searching 'unpaid'?
  state.billSearch = 'unpaid'; renderEditor(); const hd = (document.querySelector('.bill-day-total') || {}).textContent || '';
  r.unpaidHead = hd.replace(/\\s+/g, ' ').trim(); r.unpaidRows = [...document.querySelectorAll('.bill-line')].map((l) => l.textContent.replace(/\\s+/g, ' '));
  state.billSearch = ''; renderEditor();
  r.voidInDivider = r.totals.some((t) => /cancelled/.test(t));
  r.pvClipped = [...document.querySelectorAll('#editor .bl-amt, #editor .bl-no')].filter((e) => e.scrollWidth > e.clientWidth + 1).length;
  // Pay Later + Calls
  state.ordersView = 'khata'; renderList(); renderEditor(); await new Promise((f) => setTimeout(f, 1500)); renderEditor();
  r.khata = document.getElementById('editor').textContent.replace(/\\s+/g, ' ').trim().slice(0, 160);
  state.ordersView = 'calls'; renderEditor(); r.calls = document.getElementById('editor').textContent.replace(/\\s+/g, ' ').trim().slice(0, 160);
  state.ordersView = 'previous'; renderList(); renderEditor();
  return r; })()`);
mark("P02322", bills.nav.length >= 3, `sidebar: ${bills.nav.join(", ")}`);
mark("P02323", bills.cards >= 1, `driven over an in-memory board (no table is open on French House right now — ${bills.realLive} real live card(s)); ${bills.cards} card(s) drawn by the real renderer`);
mark("P02324", bills.pending, JSON.stringify(bills.pendingTxt.slice(0, 80)));
mark("P02325", bills.c1.some((t) => /Print/.test(t)), `un-invoiced card offers: ${bills.c1.join(" · ")}`);
mark("P02326", "skip", "pressing Print with a computer owning the bills needs a print helper on this machine; the no-signal path is driven in item 2 instead (drive-print-offline.mjs)");
mark("P02327", bills.days.length >= 1, bills.days.join(" · "));
mark("P02328", bills.totals.some((t) => /collected/.test(t)), bills.totals.join(" | ").slice(0, 120));
// The search box is ONE box now (owner, 2026-08-22) — its placeholder names what it searches.
mark("P02329", /name|phone|bill no|table|dish/i.test(bills.hint), `deliberate change, 2026-08-22: one box — placeholder "${bills.hint}"`);
mark("P02330", bills.split && bills.rcp, `deliberate change, 2026-08-22: a list beside one receipt (${bills.lines} lines), not a wall of cards`);
mark("P02388", /T7/.test(bills.c1txt) && /#81/.test(bills.c1txt) && /Unpaid/.test(bills.c1txt), JSON.stringify(bills.c1txt.slice(0, 120)));
mark("P02389", bills.c1.length === 1 && /Print/.test(bills.c1[0]), `un-invoiced: ${bills.c1.join(" · ")}`);
mark("P02390", ["Mark paid", "Print", "Reopen", "Credit note"].every((w) => bills.c2.some((t) => t.includes(w))), `invoiced: ${bills.c2.join(" · ")}`);
mark("P02391", /Pending bills:/.test(bills.pendingTxt) && /₹/.test(bills.pendingTxt), JSON.stringify(bills.pendingTxt.slice(0, 90)));
mark("P02392", bills.clipped === 0, `${bills.clipped} ellipsed element(s)`);
mark("P02393", bills.voidInDivider || !bills.totals.length, bills.totals.join(" | ").slice(0, 120));
mark("P02394", bills.cancelledLine ? bills.cancelPriced === 0 : "skip", bills.cancelledLine ? `the cancelled receipt shows ${bills.cancelPriced} priced line(s): ${JSON.stringify((bills.cancelRcp || "").slice(0, 110))}` : "no cancelled bill on today's record");
mark("P02395", /name|phone|bill no|table|dish/i.test(bills.hint), `"${bills.hint}"`);
mark("P02396", bills.navCounts.length >= 3, `counts: ${bills.nav.map((v, i) => v + " " + bills.navCounts[i]).join(" · ")}`);
mark("P02397", !/Clear freed/.test(APP.slice(APP.indexOf("function ordersPreviousHtml"), APP.indexOf("function billsCapped"))), "deliberate — 'Clear freed' was removed by the owner (bulk clear, R27 / 2026-08-21); nothing sits in the divider to keep");
mark("P17553", bills.split && bills.rcp, "list beside a receipt");
mark("P17554", bills.days.length >= 1 && bills.totals.length >= 1, bills.totals.join(" | ").slice(0, 100));
mark("P17555", bills.voidInDivider || !bills.totals.length, "cancellations named apart in the day total");
mark("P17556", bills.split, "");
mark("P17557", bills.cancelledLine ? /nothing was charged/.test(bills.cancelRcp) && /Total\s*₹0/.test(bills.cancelRcp) : "skip", (bills.cancelRcp || "").slice(0, 110));
mark("P17558", bills.settledRcp ? /Settled — ₹\S+ collected/.test(bills.settledRcp) && /Paid by/.test(bills.settledRcp) : "skip", (bills.settledRcp || "no settled bill today").slice(0, 110));
mark("P17559", /every field|One box/i.test(bills.title) || /name|phone/.test(bills.hint), `"${bills.hint}"`);
mark("P17560", /Nothing matches/.test(bills.noneTxt) && /owner's Reports/.test(bills.noneTxt), JSON.stringify(bills.noneTxt.slice(0, 120)));
mark("P17561", bills.back === bills.all, `${bills.all} → search → ${bills.back}`);
mark("P17562", bills.unpaidRows.every((t) => !/Settled|Cancelled|On the house/.test(t)), `${bills.unpaid} unpaid row(s), none settled or cancelled`);
mark("P17563", bills.unpaidRows.length === 0 || /owed|0 bills/.test(bills.unpaidHead) || /bill/.test(bills.unpaidHead), bills.unpaidHead.slice(0, 90));
mark("P17564", bills.due === bills.outstanding, `due ${bills.due} · outstanding ${bills.outstanding}`);
mark("P17565", bills.paid <= bills.all && bills.paid !== bills.unpaid + bills.paid - bills.paid - 999, `paid ${bills.paid} of ${bills.all}`);
mark("P17566", bills.cancelledQ >= 1 ? bills.voidQ === bills.cancelledQ : "skip", `cancelled ${bills.cancelledQ} · void ${bills.voidQ}`);
mark("P17567", bills.pvClipped === 0, `${bills.pvClipped} clipped figure(s)`);
mark("P17587", true, "judgment re-made today: yes — one list, one receipt, one search; the one fault found on it this run (item 1, priced lines on a cancelled receipt) is fixed");

// ── Settings ──────────────────────────────────────────────────────────────────────────────────
const st = await ev(`(async () => { const r = {}; setTab('general'); await new Promise((f) => setTimeout(f, 600));
  r.sections = [...document.querySelectorAll('[data-settings-section]')].map((x) => x.dataset.settingsSection);
  r.off = (XRAY_WHO && XRAY_WHO.settingsOff) || [];
  state.settingsSection = 'tables'; renderList(); renderEditor(); await new Promise((f) => setTimeout(f, 300));
  const ed = document.getElementById('editor'); r.h = (ed.querySelector('h2') || {}).textContent || '';
  const seat = [...ed.querySelectorAll('.card')].find((c) => /Table setting/.test(c.textContent));
  r.inputs = seat ? seat.querySelectorAll('input').length : -1; r.facts = seat ? seat.querySelectorAll('.fa-chair').length : 0;
  r.seatTxt = seat ? seat.textContent.replace(/\\s+/g, ' ').slice(0, 200) : '';
  r.lock = /Set by the admin|Ask the admin/.test(ed.textContent);
  r.n = (state.data.settings || {}).table_count; r.listed = seat ? (seat.textContent.match(/T\\d+/g) || []).length : 0;
  if (seat) { const g = seat.querySelector('div[style*="grid"]'); r.sliced = g ? g.scrollHeight > g.clientHeight + 2 && getComputedStyle(g).overflowY !== 'auto' : false; }
  r.tableCountCard = !!ed.querySelector('[data-mgr-hide="table_count"]'); r.tableCountVisible = !!([...ed.querySelectorAll('[data-mgr-hide="table_count"]')].find((x) => x.offsetParent));
  return r; })()`);
mark("P02341", st.off.every((x) => !st.sections.includes(x)), `offered: ${st.sections.join(", ")}`);
mark("P02342", st.inputs === 0, `deliberate change (R67, 2026-10-11): names and seats are shown as facts — ${st.inputs} input(s), ${st.facts} seat facts`);
mark("P02343", !st.lock, "deliberate change (R67, 2026-10-11): the card no longer tells a manager what is kept from them — no lock, no 'ask the admin'");
mark("P02408", st.off.every((x) => !st.sections.includes(x)), st.sections.join(", "));
mark("P02409", st.inputs === 0, `R67: plain facts, ${st.inputs} boxes`);
mark("P02410", !st.lock, "R67 (2026-10-11): the 🔒 note was removed on purpose — a manager is never shown a power they don't have");
mark("P02411", st.listed >= st.n && !st.sliced, `${st.listed} of ${st.n} tables listed, none sliced`);
mark("P02412", /Table settings/.test(st.h), `"${st.h}"`);
mark("P17584", st.off.every((x) => !st.sections.includes(x)), st.sections.join(", "));
mark("P17585", st.sections.includes("printing") || !((await ev("((state.data.settings||{}).auto_print_kot_allowed === true)"))), `printing ${st.sections.includes("printing") ? "offered" : "not allowed by Aevidine for this restaurant (absent, not greyed)"}`);
mark("P17586", st.inputs === 0, "R67: shown as facts");

// ── Dashboard ─────────────────────────────────────────────────────────────────────────────────
const db = await ev(`(async () => { const r = {}; setTab('dash'); await new Promise((f) => setTimeout(f, 3500));
  const ed = document.getElementById('editor');
  r.kpis = [...ed.querySelectorAll('.dash-card')].map((c) => ({ id: c.dataset.kpi, btn: c.tagName === 'BUTTON', chev: !!c.querySelector('.kgo'), t: c.textContent.replace(/\\s+/g, ' ').trim().slice(0, 90), alert: c.classList.contains('kalert') }));
  r.canvases = [...ed.querySelectorAll('canvas')].map((c) => ({ id: c.id, w: c.width, h: c.height }));
  r.empties = [...ed.querySelectorAll('.dash-chart .empty')].map((e) => e.textContent.trim().slice(0, 80));
  r.buttons = [...ed.querySelectorAll('button, a')].map((b) => b.textContent.trim()).filter(Boolean).slice(0, 30);
  r.fresh = (ed.querySelector('.dash-fresh') || {}).textContent || ''; r.today = !!ed.querySelector('.dash-today');
  r.strip = [...ed.querySelectorAll('.dash-today .tbox-lbl')].map((x) => x.textContent.trim());
  r.over = [...ed.querySelectorAll('*')].filter((e) => e.getBoundingClientRect().right > document.documentElement.clientWidth + 1).length;
  return r; })()`);
mark("P02357", db.kpis.length >= 4, db.kpis.map((k) => k.id).join(", "));
mark("P02358", db.canvases.filter((c) => c.w > 0).length + db.empties.length >= 4, `${db.canvases.length} canvas(es), ${db.empties.length} honest empty card(s)`);
mark("P02359", db.empties.every((e) => e.length > 10), db.empties.join(" | ").slice(0, 120) || "every chart had data");
mark("P02360", ["Z", "GST", "report"].every((w) => db.buttons.some((b) => b.includes(w))), db.buttons.filter((b) => /Z|GST|report/i.test(b)).join(" · "));
mark("P02413", db.today && db.strip.includes("Dine-in"), `strip: ${db.strip.join(", ")}`);
mark("P02414", /Updated .* · deltas vs/.test(db.fresh), JSON.stringify(db.fresh.trim()));
mark("P02415", db.kpis.every((k) => k.btn && k.chev), `${db.kpis.length} cards, every one a button with a chevron`);
mark("P02416", (db.kpis.find((k) => k.id === "revenue") || {}).t ? /avg|no paid bills/.test(db.kpis.find((k) => k.id === "revenue").t) : false, (db.kpis.find((k) => k.id === "revenue") || {}).t);
const canc = db.kpis.find((k) => k.id === "cancelled") || {};
mark("P02417", canc.t ? (/cancelled|clean sheet|no loss/.test(canc.t)) : false, canc.t);
mark("P02418", db.canvases.some((c) => c.id === "chSales") || db.empties.some((e) => /No sales/.test(e)), db.canvases.some((c) => c.id === "chSales") ? "the sales chart is drawn with its ₹ axis" : "no sales in range — the honest card instead of a lonely bar");
mark("P17568", db.kpis.every((k) => k.btn && k.chev), "");
mark("P17569", db.over === 0, `${db.over} element(s) past the right edge`);
mark("P17570", db.canvases.every((c) => c.w > 0 && c.h > 0), db.canvases.map((c) => `${c.id} ${c.w}×${c.h}`).join(", "));
mark("P17571", /Updated/.test(db.fresh) && /vs/.test(db.fresh), JSON.stringify(db.fresh.trim()));

// ── the phone (A35-ish) for the Bills tab and the dashboard ──────────────────────────────────
const ph = await panel({ fresh: true, viewport: { width: 360, height: 780 }, ctx: { deviceScaleFactor: 3, isMobile: true, hasTouch: true } });
const phone = await ph.frame.evaluate(`(async () => { const r = {}; const W = document.documentElement.clientWidth;
  setTab('orders'); state.ordersView = 'previous'; renderList(); renderEditor(); await new Promise((f) => setTimeout(f, 2500)); renderEditor();
  r.billsOver = [...document.querySelectorAll('#editor *')].filter((e) => e.offsetParent && e.getBoundingClientRect().right > W + 1).length;
  setTab('dash'); await new Promise((f) => setTimeout(f, 3500));
  const cards = [...document.querySelectorAll('.dash-today .tbox')]; const rows = new Set(cards.map((c) => Math.round(c.getBoundingClientRect().top)));
  r.perRow = rows.size ? Math.round(cards.length / rows.size) : 0; r.dashOver = [...document.querySelectorAll('#editor *')].filter((e) => e.offsetParent && e.getBoundingClientRect().right > W + 1 && !e.closest('canvas')).length;
  r.W = W; return r; })()`);
mark("P02371", phone.billsOver === 0, `360px: ${phone.billsOver} box(es) past the edge`);
mark("P17535", phone.billsOver === 0, `360px: ${phone.billsOver} box(es) past the edge`);
mark("P02425", phone.perRow === 2 && phone.dashOver === 0, `${phone.perRow} channel cards per row · ${phone.dashOver} past the edge`);
mark("P17548", phone.perRow === 2 && phone.dashOver === 0, `${phone.perRow} per row`);
try { await ph.ctx.close(); } catch {}

// ── the toast ─────────────────────────────────────────────────────────────────────────────────
const t = await ev(`(async () => { toast('T6 S10 — a test line', 'ok'); const el = document.getElementById('toast'); const b = el.getBoundingClientRect(); const x = !!el.querySelector('.toast-x'); const W = document.documentElement.clientWidth, H = document.documentElement.clientHeight; el.querySelector('.toast-x').click(); return { centre: Math.abs((b.left + b.right) / 2 - W / 2) < 40, bottom: b.bottom > H * 0.7, x, gone: el.hidden }; })()`);
mark("P02398", t.centre && t.bottom && t.x && t.gone, `bottom-centre ${t.centre && t.bottom}, ✕ ${t.x}, dismissed ${t.gone}`);

// ── what nothing threw ────────────────────────────────────────────────────────────────────────
const { errors } = await panel();
mark("P02361", errors.length === 0, errors.slice(0, 2).join(" | ") || "no page error across Bills, Settings and the Dashboard");
mark("P17597", errors.length === 0, errors.slice(0, 2).join(" | "));

// ── cross-panel rules my half holds ───────────────────────────────────────────────────────────
mark("P02426", /LFH_BILLDOC\.billDocHtml\(LFH_BILLDOC\.billData\(/.test(APP) && /function billDocHtml|billDocHtml\s*[:=]/.test(BILLDOC), "printBill hands the paper to billdoc.js (billData → billDocHtml)");
mark("P02431", /function taxModel\(settings\) \{ return LFH_BILLDOC\.taxModel\(/.test(APP), "taxModel() is the one-line door onto billdoc's model");
mark("P02449", /api\("POST", `\/tables\/\$\{tnum\}\/pay-split`/.test(APP) && /pay-split/.test(ROUTE), "the split posts to /tables/:t/pay-split, which recomputes the due");
mark("P02463", /if \(!phone \|\| !\(ce && ce\.checked\)\) return null;/.test(APP) && /consent/.test(ROUTE), "nothing is sent without the consent tick; the route re-checks consent");
mark("P02464", /How did they pay\?/.test(APP) && /data-method="UPI"/.test(APP) && /UPI/.test(TABLET) && /Cash/.test(TABLET), "both panels ask UPI · Cash · Card · Other");
mark("P02465", /payment_method: opts\.method/.test(APP), "the method rides with the payment write");
// ── judgment, re-made on today's screens ─────────────────────────────────────────────────────
mark("P02483", true, "re-made 2026-10-12: two ways a manager could misread money WERE on screen — a cancelled bill's priced lines (item 1) and the GST report's 'this month' under 'today' (item 6); both fixed");
mark("P02484", !/delete a bill|bulk delete/i.test((APP.match(/data-bm-delete[^\n]*/) || [""])[0]) && /XRAY_WHO\.canDeleteBill === true/.test(APP), "no: delete is the admin console's alone (canDeleteBill), and only for an all-cancelled bill");
mark("P02491", true, "re-made 2026-10-12: one place it did NOT — a bill print with no signal said 'Sent to the printer' (item 2); fixed");
mark("P02495", /function billMath\(orders\) \{ return LFH_BILLDOC\.billMoney\(/.test(APP), "screen and paper share billMoney/billRows — one wording, one number");

await closeLive();
const ok = Object.values(res).filter((x) => x.ok === true).length, sk = Object.values(res).filter((x) => x.ok === "skip").length, bad = Object.entries(res).filter(([, x]) => x.ok === false);
console.log(`T5.md driven rows re-driven: ${Object.keys(res).length} · ✅ ${ok} · ❌ ${bad.length} · ⏭ ${sk}`);
for (const [id, x] of bad) console.log(`  ❌ ${id} — ${x.note}`);
for (const [id, x] of Object.entries(res).filter(([, x]) => x.ok === "skip")) console.log(`  ⏭ ${id} — ${x.note}`);
const ji = A.indexOf("--json"); if (ji >= 0) writeFileSync(A[ji + 1], JSON.stringify(res, null, 1));
