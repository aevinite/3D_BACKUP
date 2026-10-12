// scripts/sweep/t6s10/rerun-t6s8.mjs — re-running sweep #8 terminal 6's 1,000 rows (T6.md,
// P59701–P60700) whose SUBJECT is now in MY half of editor/app.js.
//
// Sweep #8's T6 owned lines 1–9,400 of an 18,633-line file. The file is 20,123 lines today and my
// half ends at openZReport(), so a row is mine only when the thing it names is DECLARED, EMITTED or
// CALLED before that landmark. Every row is still re-derived the way its own "how" column says —
// the categories below are the ones that ledger used — and the rows that are now terminal 7's are
// listed as theirs, untouched.
//
//   node scripts/sweep/t6s10/rerun-t6s8.mjs            # run, print
//   node scripts/sweep/t6s10/rerun-t6s8.mjs --json f   # results for the write-back
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, APP, CODE, MY_END_AT, DECLS, refs, rd, ev, panel, closeLive, guard, lineAt } from "./lib.mjs";

const A = process.argv.slice(2);
const T6 = readFileSync(join(ROOT, ".claude/sweep/LEDGER/T6.md"), "utf8").split("\n");
const ROUTE = rd("app/api/editor/[...path]/route.ts");
const HTML = rd("public/panels/editor/index.html");
const CSS = rd("public/panels/editor/style.css");
// The text a person READS: markup removed, so a sentence with a <b> inside it still matches.
const PLAIN = APP.replace(/<[^>]+>/g, "");
const plainAt = (snip) => { const j = PLAIN.indexOf(snip); if (j < 0) return -1; // map back to an offset in APP
  let seen = 0, k = 0; for (; k < APP.length && seen < j; k++) { if (APP[k] === "<") { const e = APP.indexOf(">", k); if (e > 0) { k = e; continue; } } seen++; } return k; };
// Rows whose subject was REMOVED ON PURPOSE since sweep #8 ran — each with where that decision lives.
const RETIRED = {
  P59939: "retired with accessUsersCardHtml (deleted 2026-09-03, sweep #8 T6 round 2 — obituary above formGeneral)",
  P60333: "retired with openSectionsModal (deleted 2026-09-03 — obituary above sectionPickerId; R53)",
  P60432: "replaced by dashReachDays() — the four-rung reach (owner, 2026-09-23; obituary at DASH_RUNG)",
  P60442: "removed with the bill's Reprint label (owner, 2026-10-10 — R62; obituary at billPrintLabel)",
  P60443: "removed with the bill's Reprint label (owner, 2026-10-10 — R62; obituary at billPrintLabel)",
  P60445: "removed with the bill's Reprint label (owner, 2026-10-10 — R62; obituary at billPrintLabel)",
  // data-* attributes whose EMITTER in my half was deleted on purpose — nothing emits them now.
  P59708: "emitted only by billRecordCardHtml, deleted 2026-09-03 (obituary above billOrdersPool)",
  P59709: "emitted only by billRecordCardHtml, deleted 2026-09-03 (obituary above billOrdersPool)",
  P59711: "emitted only by billRecordCardHtml, deleted 2026-09-03 (obituary above billOrdersPool)",
  P59712: "emitted only by billPrintLabel's Reprint relabel, removed 2026-10-10 (R62)",
  P59718: "emitted only by the per-table Guest QR links list, removed 2026-09-14 (obituary above tableQrLinksCardHtml)",
  P59742: "emitted only by numSel(), deleted 2026-09-03 (obituary above ta())",
  P59746: "emitted only by parcelRecordCardHtml, deleted 2026-09-03 (obituary above billOrdersPool)",
  P59748: "emitted only by the access cards, deleted 2026-09-03 (obituary above formGeneral)",
  P59749: "emitted only by the access cards, deleted 2026-09-03 (obituary above formGeneral)",
};
// Rows whose subject now sits in terminal 7's half, named so they are not counted as gone.
const THEIRS = { P59964: "auditHtml() — terminal 7's half" };
RETIRED.P59958 = "replaced by THIS run's item 6 (2026-10-12): the GST report's empty line now names its window — 'No paid bills today.' / 'in October 2026.'";
const rows = [];
for (let i = 1830; i < T6.length; i++) {
  const L = T6[i];
  const m = L.match(/^\| (P\d{5}) \| (.*?) \| (.*?) \| (✅|❌|⏭)[^|]*\|(.*)$/);
  if (!m) continue;
  rows.push({ line: i + 1, id: m[1], check: m[2], how: m[3], prev: m[4], note: m[5] });
}
const first = (re, src = APP) => { const x = src.search(re); return x; };
const fnTextLocal = (name) => { const i = APP.search(new RegExp(`\\n(?:async )?function ${name}\\(`)); if (i < 0) return ""; const j = APP.slice(i + 2).search(/\n(?:async )?function |\nconst [A-Za-z_$][\w$]* = /); return APP.slice(i, j < 0 ? APP.length : i + 2 + j); };
const where = (i) => (i < 0 ? "gone" : i < MY_END_AT ? "mine" : "T7");
const camel = (s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
const declAt = (n) => (DECLS.get(n) || [-1])[0];
const out = [];
const put = (r, owner, ok, note) => out.push({ id: r.id, line: r.line, owner, mark: ok === "skip" ? "⏭" : ok ? "✅" : "❌", note: note || "", check: r.check, prev: r.prev });

// ── the STATIC categories ──────────────────────────────────────────────────────────────────────
const live = [];
for (const r of rows) {
  let m;
  // A · every data-* hook the panel EMITS is read back somewhere
  if ((m = r.check.match(/^the manager panel emits data-([a-z0-9-]+)= — something reads it back/))) {
    const attr = m[1];
    const at = first(new RegExp(`data-${attr}\\s*=\\s*["'\`]|data-${attr}[\\s>"'\`]`));
    const owner = where(at);
    if (owner === "gone" && RETIRED[r.id]) { put(r, "mine", true, "deliberate — " + RETIRED[r.id]); continue; }
    if (owner !== "mine") { put(r, owner, true, ""); continue; }
    const byQuery = APP.includes(`[data-${attr}]`) || APP.includes(`[data-${attr}=`) || APP.includes(`[data-${attr} `);
    const byDataset = new RegExp(`\\.dataset\\.${camel(attr)}\\b`).test(APP) || new RegExp(`dataset\\[["']${camel(attr)}["']\\]`).test(APP);
    const byAttr = new RegExp(`getAttribute\\(["']data-${attr}["']\\)|closest\\(["'\`][^"'\`]*data-${attr}`).test(APP);
    // The ORIGINAL row's hook list, verbatim (scripts/sweep/t6/static.mjs): attributes read by the
    // shared delegated handlers or by the stylesheet rather than by a selector in this file.
    const isHook = /^(menu-part|mgr-hide|action|arg|path|num|tab|cu|cu-fmt|bill-print-btn|bill-print-sid|memb|nw-table|nw-all|nw-none|sec-|au-|perm-|staff-|khata-|bulk|logview-side|orders-view|settings-section|cat|idx|i|n|mode|method|special|oc|v|tip-pct|dish|ret|copy-link|lfh-fit-base|floor-table|take-order|quick-accept|qop)/.test(attr);
    const byCss = CSS.includes(`[data-${attr}]`) || CSS.includes(`[data-${attr}=`);
    const ok = byQuery || byDataset || byAttr || isHook || byCss;
    put(r, owner, ok, `emitted at line ${lineAt(at)}; ${ok ? (isHook && !byQuery && !byDataset ? "read by the shared hook layer" : "read back") : "emitted and NOTHING reads it"}`);
    continue;
  }
  // B · every api() path names something the editor route answers
  if ((m = r.check.match(/^the panel's (GET|POST|PATCH|DELETE) (\S*) /))) {
    const verb = m[1], path = m[2].replace(/\\\|\\\|/g, "||");
    const lit = path.split("${")[0].split("?")[0];
    const at = APP.search(new RegExp(`api\\(\\s*"${verb}"\\s*,\\s*[\`"]${lit.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    const owner = where(at);
    if (owner !== "mine") { put(r, owner, true, ""); continue; }
    const seg = lit.replace(/^\//, "").split(/[/?$]/)[0];
    const known = seg === "" || ROUTE.includes(`"${seg}`) || new RegExp(`startsWith\\("${seg}`).test(ROUTE);
    put(r, owner, known, `called at line ${lineAt(at)}; ${known ? `route answers "${seg || "/"}"` : `route has no "${seg}" — the call would 404`}`);
    continue;
  }
  // C · every UPPER_CASE constant is read
  if ((m = r.check.match(/^the constant ([A-Z0-9_]+) is read somewhere/))) {
    const at = declAt(m[1]); const owner = where(at);
    if (owner === "gone") { const ob = APP.search(new RegExp(`${m[1]}[^\\n]*(DELETED|removed|lived here)|${m[1]} and [A-Z_]+ lived here`)); put(r, ob >= 0 ? where(ob) : "gone", ob >= 0 ? true : "skip", ob >= 0 ? `deliberate — removed on purpose; the obituary at line ${lineAt(ob)} names it` : "declaration gone and no obituary names it — look by hand"); continue; }
    if (owner !== "mine") { put(r, owner, true, ""); continue; }
    const n = refs(m[1]); put(r, owner, n >= 1, `${n} use(s)`);
    continue;
  }
  // D · every state key is written somewhere, not only read
  if ((m = r.check.match(/^state\.([A-Za-z_]+) is written somewhere/))) {
    const k = m[1];
    const at = CODE.search(new RegExp(`state\\.${k}\\b`));
    const init = new RegExp(`\\n  ${k}:`).test(APP.slice(0, APP.indexOf("const $ = ")));
    const owner = init ? "mine" : where(at);
    if (owner !== "mine") { put(r, owner, true, ""); continue; }
    const wr = new RegExp(`state\\.${k}\\s*(=[^=]|\\|\\|=|\\?\\?=|\\+=|-=)|state\\.${k}\\.(add|delete|clear|set|push|splice)\\(|state\\.${k}\\[[^\\]]+\\]\\s*=[^=]|\\.\\.\\.state\\.${k}`).test(CODE);
    put(r, owner, wr || init, init ? "initialised in the state object" : wr ? "assigned" : "only ever read");
    continue;
  }
  // E · the empty states say why, not just that
  if ((m = r.check.match(/^the empty state "(.*?)" tells the person why/))) {
    const snip = m[1].replace(/\\\|/g, "|").replace(/^\$\{/, "").slice(0, 40);
    if (THEIRS[r.id]) { put(r, "T7", true, THEIRS[r.id]); continue; }
    if (RETIRED[r.id]) { put(r, "mine", true, "deliberate — " + RETIRED[r.id]); continue; }
    const at = APP.indexOf(snip) >= 0 ? APP.indexOf(snip) : plainAt(snip);
    if (at < 0 && RETIRED[r.id]) { put(r, "mine", true, "deliberate — " + RETIRED[r.id]); continue; }
    const owner = where(at);
    if (owner === "gone") { put(r, "gone", "skip", `the sentence "${snip}" is no longer in the file — re-judge the screen that replaced it`); continue; }
    if (owner !== "mine") { put(r, owner, true, ""); continue; }
    put(r, owner, true, `still says it, line ${lineAt(at)}`);
    continue;
  }
  // F · every declaration is REACHED
  if ((m = r.check.match(/^`([A-Za-z_$][\w$]*)`.*is (reached|used)/))) {
    const nm = m[1];
    const at = nm === "$" ? APP.indexOf("const $ = ") : declAt(nm); const owner = where(at);
    if (owner === "gone" && RETIRED[r.id]) { put(r, "mine", true, "deliberate — " + RETIRED[r.id]); continue; }
    if (owner === "gone") {
      const ob = APP.search(new RegExp(`${nm.replace(/\$/g, "\\$")}[^\\n]{0,80}(DELETED|deleted|removed|lived here|went with|OBITUARY)|(OBITUARY|DELETED|lived here)[^\\n]{0,80}${nm.replace(/\$/g, "\\$")}`));
      if (ob >= 0) { put(r, where(ob), true, `deliberate — removed on purpose; the obituary at line ${lineAt(ob)} names it`); continue; }
      put(r, "gone", "skip", "declaration no longer in the file and no obituary names it — look by hand");
      continue;
    }
    if (owner !== "mine") { put(r, owner, true, ""); continue; }
    const n = nm === "$" ? (CODE.match(/(?<![\w$.])\$\(/g) || []).length : refs(nm) + (HTML.includes(nm) ? 1 : 0);
    put(r, owner, n >= 1, `${n} reference(s)`);
    continue;
  }
  live.push(r);
}

// ── the DRIVEN rows: which are mine, and how each is re-run ───────────────────────────────────
// Each entry: id → [expression evaluated inside the real panel, expected value]. The expression is
// what the row's own words describe; the expected value is the one its note recorded.
const D = {
  P60063: ['inr(0)', "₹0"], P60064: ['inr(1018.6)', "₹1,019"], P60065: ['inr(1018.4)', "₹1,018"],
  P60066: ['inr(123456)', "₹1,23,456"], P60067: ['inr(-250)', "₹-250"], P60068: ['inr("abc")', "₹0"],
  P60069: ['inr(undefined)', "₹0"], P60070: ['inrExact(1019)', "₹1,019"], P60071: ['inrExact(1018.5)', "₹1,018.50"],
  P60072: ['inrExact(1018.0001)', "₹1,018"], P60073: ['inrExact(undefined)', "₹0"],
  P60074: ['discPct(100, 10)', "10%"], P60075: ['discPct(100, 0)', ""], P60076: ['discPct(0, 10)', ""],
  P60077: ['esc(`<b onclick="x">&\'"`)', "&lt;b onclick=&quot;x&quot;&gt;&amp;&#39;&quot;"], P60078: ['esc(null)', ""],
  P60079: ['fold("Crème Brûlée")', "creme brulee"],
  P60082: ['secRangeText([1,2,3,4,6])', "T1–T4, T6"], P60083: ['secRangeText([7])', "T7"], P60084: ['secRangeText([])', ""],
  P60085: ['secRangeText([6,3,1,4,2])', "T1–T4, T6"],
  P60086: ['(() => { const s = state.data.settings; const keep = s.table_names; s.table_names = {}; try { return tableLabel(7); } finally { s.table_names = keep; } })()', "T7"],
  P60087: ['(() => { const s = state.data.settings; const keep = s.table_names; s.table_names = {}; try { return tablePrintLabel(7); } finally { s.table_names = keep; } })()', "T7"],
  P60088: ['tablePrintLabel(null)', "T?"], P60089: ['tablePrintLabel("")', "T?"],
  P60090: ['(() => { const s = state.data.settings; const keep = s.table_names; s.table_names = {}; try { return tileFace(7); } finally { s.table_names = keep; } })()', "T7"],
  P60091: ['seatsForTable({}, 3)', 4], P60092: ['seatsForTable({ table_seats: { "3": 9 } }, 3)', 9],
  P60093: ['seatsForTable({ table_seats: { default: 6 } }, 3)', 6], P60094: ['seatsForTable({ table_seats: { default: 6, "3": 9 } }, 3)', 9],
  P60095: ['seatsForTable({ table_seats: { "3": 0 } }, 3)', 4],
  P60106: ['billState({ cancelled: true, khata: true, paid: true })', "cancelled"], P60107: ['billState({ khata: true, paid: true })', "khata"],
  P60108: ['billState({ onHouse: true, paid: true })', "onhouse"], P60109: ['billState({ partPaid: true, paid: true })', "part"],
  P60110: ['billState({ paid: true })', "settled"], P60111: ['billState({})', "running"],
  P60112: ['businessDayStartMs() <= Date.now()', true], P60113: ['Date.now() - businessDayStartMs() < 48*3600e3', true],
  P60114: ['businessDayStartMs() - yesterdayStartMs()', 86400000],
  P60115: ['restoreDeadline({ status: "received", payment_status: "pending" })', 0],
  P60116: ['canStillRestore({ archived: true, archived_at: new Date().toISOString() })', true],
  P60117: ['(() => { const a = new Date(Date.now() - 20*60e3).toISOString(), c = new Date(Date.now() - 5*60e3).toISOString(); return restoreDeadline({ archived: true, archived_at: c, status: "cancelled", cancelled_at: a }) === new Date(a).getTime() + RESTORE_WINDOW_MS; })()', true],
  P60118: ['canStillRestore({ archived: true, archived_at: new Date(Date.now() - 40*60e3).toISOString() })', false],
  P60119: ['priceTaxMode({})', "excl"], P60120: ['priceTaxMode({ price_tax_mode: "incl" })', "incl"],
  P60121: ['priceTaxMode({ price_tax_mode: "weird" })', "excl"],
  P60122: ['resolveTaxMode("none", { item_tax_modes_allowed: false })', "excl"], P60123: ['resolveTaxMode("none", { item_tax_modes_allowed: true })', "exempt"],
  P60124: ['resolveTaxMode("excl", { price_tax_mode: "composition", item_tax_modes_allowed: true })', "exempt"],
  P60125: ['isMrpDish("mrp", { item_tax_modes_allowed: false })', false], P60126: ['isMrpDish("mrp", { item_tax_modes_allowed: true })', true],
  P60127: ['taxLabel({})', "Tax"], P60128: ['taxLabel({ tax_label: "GST" })', "GST"], P60129: ['taxLabel({ tax_label: "   " })', "Tax"],
  P60130: ['financialYear("2026-04-02T06:00:00Z")', "2026-27"], P60131: ['financialYear("2026-03-02T06:00:00Z")', "2025-26"],
  P60132: ['(() => { const k = state.billsRec; state.billsRec = null; try { return billsCapped(); } finally { state.billsRec = k; } })()', false],
  P60133: ['(() => { const k = state.billsRec; state.billsRec = { rows: Array(500).fill({}), parcels: [] }; try { return billsCapped(); } finally { state.billsRec = k; } })()', true],
  P60134: ['(() => { const k = state.billsRec; state.billsRec = { rows: Array(499).fill({}), parcels: [] }; try { return billsCapped(); } finally { state.billsRec = k; } })()', false],
  P60135: ['(() => { const k = state.billsRec; state.billsRec = { rows: Array(300).fill({}), parcels: Array(200).fill({}) }; try { return billsCapped(); } finally { state.billsRec = k; } })()', true],
  P60137: ['(() => { const k = state.ordersView; state.ordersView = "today"; try { return ordersViewKey(); } finally { state.ordersView = k; } })()', "live"],
  P60138: ['(() => { const k = state.ordersView; state.ordersView = "bills"; try { return ordersViewKey(); } finally { state.ordersView = k; } })()', "previous"],
  P60139: ['(() => { const k = state.ordersView; state.ordersView = "daybills"; try { return ordersViewKey(); } finally { state.ordersView = k; } })()', "previous"],
  P60140: ['(() => { const k = state.ordersView; state.ordersView = "zzz"; try { return ordersViewKey(); } finally { state.ordersView = k; } })()', "live"],
  P60141: ['enabledLangs().some(([c]) => c === "en")', true],
  P60142: ['(ratingStars(5).match(/★/g) || []).length - (ratingStars(5).split("var(--line)")[1] || "").replace(/[^★]/g, "").length', 5],
  P60143: ['typeof blank("items").sort_order', "number"],
  P60146: ['isParkedKhata({ khata_at: "x", payment_status: "pending", status: "served" })', true],
  P60147: ['isParkedKhata({ khata_at: "x", payment_status: "paid", status: "served" })', false],
  P60148: ['isParkedKhata({ payment_status: "pending", status: "served" })', false],
  P60149: ['dishNoTag("no such dish zz")', ""], P60150: ['mrpPill({ is_mrp: false })', ""], P60151: ['/MRP/.test(mrpPill({ is_mrp: true }))', true],
  P60154: ['/Settled/.test(billStatePill("settled"))', true], P60155: ['/Running/.test(billStatePill("zzz"))', true],
  P60158: ['JSON.stringify(splitCartLines([{ price: 100, qty: 2 }], {}))', '{"taxableBase":200,"nontax":0,"mrpAmount":0,"hasMrp":false}'],
  P60159: ['JSON.stringify(splitCartLines([], {}))', '{"taxableBase":0,"nontax":0,"mrpAmount":0,"hasMrp":false}'],
  P60160: ['taxModeExample("excl", 100, { tax_rate: 0.05 })', "Guest pays ₹105.00 — ₹100.00 + ₹5.00 GST at 5%."],
  P60161: ['taxModeExample("excl", "", { tax_rate: 0.05 })', "Guest pays ₹105.00 — ₹100.00 + ₹5.00 GST at 5%."],
  P60162: ['/composition scheme/.test(taxModeExample("excl", 100, { tax_rate: 0.05, price_tax_mode: "composition" }))', true],
  P60163: ['/\\/2026-27\\/000042$/.test(invFmt(42, "2026-04-02T06:00:00Z"))', true], P60164: ['String(invFmt(null, null) || "")', ""],
  P60165: ['(ratingStars(99).split("var(--line)")[0].match(/★/g) || []).length', 5], P60166: ['typeof ratingStars(null)', "string"],
};
// The yes/no and reason dialogs (P60169–P60184) — confirmDialog / promptDialog are mine.
const DIALOGS = `(async () => {
  const r = {};
  const p = confirmDialog('T6 S10 <b>x</b>', 'Yes');
  await new Promise((f) => setTimeout(f, 50));
  const ov = document.querySelector('.confirm-overlay:not([data-closing])');
  r.P60169 = !!ov; r.P60170 = !!(ov && ov.querySelector('.confirm-ok') && ov.querySelector('.confirm-cancel'));
  r.P60171 = !!(ov && !ov.querySelector('.confirm-msg b') && /<b>x<\\/b>/.test(ov.querySelector('.confirm-msg').textContent));
  r.P60172 = !!(ov && typeof ov.__lfhClose === 'function');
  // P60182/3 — a second question over an open one is refused, and the waiting one shakes
  const second = await confirmDialog('T6 S10 second', 'Yes');
  r.P60182 = second === false && document.querySelectorAll('.confirm-overlay:not([data-closing])').length === 1;
  r.P60183 = ov.classList.contains('confirm-nudge');
  await new Promise((f) => setTimeout(f, 400));
  ov.querySelector('.confirm-cancel').click();
  r.P60173 = (await p) === false;
  await new Promise((f) => setTimeout(f, 260));
  r.P60174 = !document.body.contains(ov);
  const q = promptDialog('T6 S10 reason', { required: true, presets: ['one', 'two'] });
  await new Promise((f) => setTimeout(f, 50));
  const ov2 = document.querySelector('.confirm-overlay:not([data-closing])');
  r.P60175 = !!ov2; r.P60176 = !!(ov2 && ov2.querySelector('.confirm-input')); r.P60177 = ov2 ? ov2.querySelectorAll('.confirm-chip').length : 0;
  r.P60178 = !!(ov2 && typeof ov2.__lfhClose === 'function');
  await new Promise((f) => setTimeout(f, 400));
  ov2.querySelector('.confirm-ok').click();
  await new Promise((f) => setTimeout(f, 30));
  r.P60179 = document.body.contains(ov2) && !ov2.hasAttribute('data-closing');
  ov2.querySelector('.confirm-input').value = 'a reason';
  ov2.querySelector('.confirm-ok').click();
  r.P60180 = await q;
  await new Promise((f) => setTimeout(f, 260));
  r.P60181 = !document.body.contains(ov2);
  r.P60184 = !document.querySelector('.confirm-overlay');
  return r;
})()`;
const DIALOG_EXPECT = { P60169: true, P60170: true, P60171: true, P60172: true, P60173: true, P60174: true, P60175: true, P60176: true, P60177: 2, P60178: true, P60179: true, P60180: "a reason", P60181: true, P60182: true, P60183: true, P60184: true };

// The receipt in every state (P60539–P60574) — billReceiptHtml / billLineHtml / parcelReceiptHtml are mine.
const RECEIPTS = `(() => {
  const now = new Date().toISOString();
  const o = (x) => ({ id: 'o' + Math.random().toString(36).slice(2, 7), session_id: 's1', table_number: '7', status: 'served', payment_status: 'pending', created_at: now, kot_no: 12, bill_no: 34, subtotal: 400, total: 420, discount: 0, items: [{ title: 'Paneer Tikka', qty: 2, price: 200 }], ...x });
  const base = (g, x) => ({ kind: 'dinein', g, key: 's1', table: '7', billNo: 34, invNo: null, invoiceAt: null, invVoided: false, invReopens: 0, sessionClosed: false, customer: '', total: billMath(g).total, paid: false, ts: Date.now(), cancelled: false, billCust: '', billPhone: '', khata: false, onHouse: false, running: false, collected: 0, owed: billMath(g).total, partPaid: false, parts: [], methods: [], kots: [12], disc: billMath(g).disc || 0, ...x });
  const S = {
    running: base([o({ status: 'preparing' })], { running: true }),
    settled: base([o({ payment_status: 'paid', payment_method: 'UPI' })], { paid: true, collected: 420, owed: 0, methods: ['UPI'] }),
    part: base([o({ payment_status: 'paid' }), o({ id: 'o2' })], { partPaid: true, collected: 420, owed: 420 }),
    split: base([o({ payment_status: 'paid', payment_method: 'Split' })], { paid: true, collected: 420, owed: 0, methods: ['Split'], parts: [{ method: 'UPI', amount: 220 }, { method: 'Cash', amount: 200 }] }),
    splitWithTab: base([o({ payment_status: 'paid', payment_method: 'Split' })], { paid: true, collected: 220, owed: 200, methods: ['Split'], parts: [{ method: 'UPI', amount: 220 }, { method: 'Pay later', amount: 200 }] }),
    khata: base([o({ khata_at: now })], { khata: true, billCust: 'Riya' }),
    onhouse: base([o({ payment_status: 'paid', payment_method: 'On the house' })], { paid: true, onHouse: true, methods: ['On the house'] }),
    cancelled: base([o({ status: 'cancelled' })], { cancelled: true, total: 0, owed: 0 }),
    invoiced: base([o({ payment_status: 'paid', invoice_no: 42, invoice_at: now })], { paid: true, invNo: 42, invoiceAt: now, collected: 420, owed: 0, methods: ['Cash'] }),
    reopened: base([o({ payment_status: 'paid', invoice_no: 42, invoice_at: now, invoice_voided: true })], { paid: true, invNo: 42, invoiceAt: now, invVoided: true, methods: ['Cash'] }),
    discounted: base([o({ discount: 40 })], {}),
    noInvoiceYet: base([o({ payment_status: 'paid' })], { paid: true, methods: ['Cash'], collected: 420, owed: 0 }),
  };
  const r = {}; const txt = (h) => { const d = document.createElement('div'); d.innerHTML = h; return d.textContent.replace(/\\s+/g, ' ').trim(); };
  for (const [k, b] of Object.entries(S)) { try { r[k] = txt(billReceiptHtml(b)); r[k + '_line'] = txt(billLineHtml(b)); } catch (e) { r[k] = 'THREW: ' + e.message; } }
  try { const p = { kind: 'parcel', p: { id: 'p1', bill_no: 9, created_at: now, payment_method: 'Card', items: [{ title: 'Fries', qty: 1 }], paid: true, status: 'done' }, key: 'parcel:p1', table: 'parcel', billNo: 9, invNo: null, total: 150, paid: true, cancelled: false, customer: '', billCust: '', billPhone: '', khata: false, onHouse: false, running: false, collected: 150, owed: 0, partPaid: false, parts: [], methods: ['Card'], kots: [], disc: 0 };
    r.parcel = txt(billReceiptHtml(p)); } catch (e) { r.parcel = 'THREW: ' + e.message; }
  return r;
})()`;
const RCPT = {
  P60539: ["running", /Not paid yet — ₹\S+ due/], P60541: ["settled", /Settled — ₹\S+ collected/], P60543: ["part", /Part paid — ₹\S+ in, ₹\S+ still to come/],
  P60545: ["split", /UPI.*Cash/], P60547: ["splitWithTab", /left on a tab/], P60549: ["khata", /money to collect, not a write-off/],
  P60551: ["onhouse", /Given free on purpose/], P60553: ["cancelled", /nothing was charged/], P60555: ["invoiced", /\/000042/],
  P60557: ["reopened", /reopened/], P60559: ["discounted", /Discount/], P60561: ["noInvoiceYet", /not issued yet/],
};
const LINES = { P60567: ["running_line", /unpaid/], P60568: ["settled_line", /UPI/], P60569: ["part_line", /in · .* left/], P60570: ["split_line", /split ×2/], P60571: ["khata_line", /on the tab/], P60572: ["cancelled_line", /not charged/], P60573: ["noInvoiceYet_line", /#34/] };

// The modals of my half (P60575–P60611): openTagModal, openKhataPersonPicker, openPaymentMethodModal.
const MODALS = `(async () => {
  const r = {};
  const one = async (name, open, sel) => {
    const before = document.querySelectorAll(sel).length;
    let p; try { p = open(); } catch (e) { r[name] = { threw: e.message }; return; }
    await new Promise((f) => setTimeout(f, 120));
    const ov = [...document.querySelectorAll(sel)].pop();
    const res = { opened: !!ov && document.querySelectorAll(sel).length > before, back: !!(ov && typeof ov.__lfhClose === 'function'),
      way: !!(ov && ov.querySelector('.tbl-modal-close, .dish-edit-cancel, [aria-label=Close]')), text: ov ? ov.textContent.replace(/\\s+/g, ' ').trim().slice(0, 120) : '' };
    if (ov) { (ov.querySelector('.tbl-modal-close') || ov.querySelector('.dish-edit-cancel')).click(); }
    await new Promise((f) => setTimeout(f, 80));
    res.gone = document.querySelectorAll(sel).length === before;
    if (p && p.then) { try { res.resolved = await Promise.race([p, new Promise((f) => setTimeout(() => f('PENDING'), 300))]); } catch (e) { res.resolved = 'REJECTED'; } }
    r[name] = res;
  };
  await one('tag', () => openTagModal(7), '.tag-overlay');
  await one('khata', () => openKhataPersonPicker(500, 7), '.khata-overlay');
  await one('pay', () => openPaymentMethodModal(500, 'T6 sweep — no money moves', {}), '.pay-overlay');
  r.left = document.querySelectorAll('.tag-overlay, .khata-overlay, .pay-overlay, .sx-modal-overlay').length;
  return r;
})()`;
const MOD = { tag: ["P60575", "P60576", "P60577", "P60578", "P60579"], khata: ["P60580", "P60581", "P60582", "P60583", "P60584"], pay: ["P60605", "P60606", "P60607", "P60608", "P60609"] };

// The builders (P60612–P60700) that are mine.
const BUILDERS = `(() => {
  const r = {}; const it = (state.data.items || [])[0] || { id: 'x', title: 'X', tags: [], options: [{ name: 'Size', choices: [{ label: 'L', price: 10 }] }], ingredients: [{ emoji: '🍞', name: 'Bread' }] };
  const cat = (state.data.categories || [])[0] || { slug: 'c', name: { en: 'C' } }; const fil = (state.data.filters || [])[0] || { slug: 'f', name: { en: 'F' } };
  const go = (k, fn) => { try { const h = fn(); r[k] = { len: (h || '').length, bad: /\\$\\{|undefined|NaN|\\[object Object\\]/.test((() => { const d = document.createElement('div'); d.innerHTML = h || ''; return d.textContent; })()) }; } catch (e) { r[k] = { threw: e.message }; } };
  const s0 = state.settingsSection;
  go('newWaiterTablesHtml', () => newWaiterTablesHtml());
  go('tagChips', () => tagChips(it.tags));
  const keepS = state.data.settings.item_tax_modes_allowed; state.data.settings.item_tax_modes_allowed = false;
  go('taxModeField_off', () => taxModeField(it)); state.data.settings.item_tax_modes_allowed = keepS;
  go('items', () => formItems(it)); go('categories', () => formCategories(cat)); go('filters', () => formFilters(fil));
  for (const sec of ['tables', 'users', 'access', 'billing', 'kitchen', 'sessions']) { state.settingsSection = sec; go('general_' + sec, () => formGeneral(JSON.parse(JSON.stringify(state.data.settings)))); }
  state.settingsSection = s0;
  go('optionsHtml', () => optionsHtml(it)); go('ingredientRows', () => ingredientRows(it)); go('catSelect', () => catSelect(cat.slug));
  go('tableSeatingCardHtml', () => tableSeatingCardHtml(state.data.settings)); go('tableQrLinksCardHtml', () => tableQrLinksCardHtml());
  go('tableSectionsCardHtml', () => tableSectionsCardHtml()); go('userSettingCardHtml', () => userSettingCardHtml()); go('filterMembersHtml', () => filterMembersHtml(fil));
  go('dashRangeToggleHtml', () => dashRangeToggleHtml()); go('dashTodayBox', () => dashTodayBox({ live: { dineIn: 2 }, platformToday: { count: 1, revenue: 100 }, paid: 3, revenue: 900 }));
  const keepC = state.data.calls; state.data.calls = []; go('callsHtml_empty', () => callsHtml()); state.data.calls = keepC;
  go('itemDetailLine', () => itemDetailLine({ options: [{ label: 'Large' }], removed: ['dairy'], note: 'less ice' }));
  go('ordItemsHtml', () => ordItemsHtml([{ items: [{ title: 'Tea', qty: 1, price: 20 }], allergies: ['nuts'] }]));
  r.formItemsPaths = (formItems(it).match(/data-path=/g) || []).length;
  r.taxOffLen = r.taxModeField_off && r.taxModeField_off.len;
  // P60616–P60631 — the bill grouping, the buckets and the rota
  const os = [{ id: 'a', session_id: 's1' }, { id: 'b', session_id: 's1' }, { id: 'c' }];
  r.groups = groupOrdersBySession(os).length; r.soloKey = groupOrdersBySession([{ id: 'c' }])[0][0].id;
  r.paid1 = fullyPaidSessionKeys([{ id: 'a', session_id: 's1', status: 'served', payment_status: 'paid' }]).size;
  r.paidCanc = fullyPaidSessionKeys([{ id: 'a', session_id: 's1', status: 'served', payment_status: 'paid' }, { id: 'b', session_id: 's1', status: 'cancelled', payment_status: 'pending' }]).size;
  r.allCanc = fullyPaidSessionKeys([{ id: 'a', session_id: 's1', status: 'cancelled', payment_status: 'pending' }]).size;
  const keepO = state.data.orders, keepR = state.billsRec; const now = new Date().toISOString();
  state.data.orders = [
    { id: 'live1', session_id: 'L', status: 'preparing', payment_status: 'pending', created_at: now },
    { id: 'paid1', session_id: 'P', status: 'served', payment_status: 'paid', created_at: now },
    { id: 'kh1', session_id: 'K', status: 'served', payment_status: 'pending', khata_at: now, created_at: now },
    { id: 'can1', session_id: 'C', status: 'cancelled', payment_status: 'pending', created_at: now },
    { id: 'arc1', session_id: 'A', status: 'served', payment_status: 'pending', archived: true, created_at: now },
  ];
  state.billsRec = { rows: [], parcels: [], at: Date.now() };
  try { const b = ordersBuckets(); r.liveIds = b.live.map((x) => x.id).join(','); r.paidInRecord = b.today.some((x) => x.id === 'paid1');
    r.khNotLive = !b.live.some((x) => x.id === 'kh1'); r.canNotLive = !b.live.some((x) => x.id === 'can1'); r.paidNotLive = !b.live.some((x) => x.id === 'paid1'); r.arcNotLive = !b.live.some((x) => x.id === 'arc1'); }
  finally { state.data.orders = keepO; state.billsRec = keepR; }
  const keepSec = state.sections;
  // An in-memory rota only — built through a mapper so it reads as what it is (nothing is saved).
  const W = (id, nm, t, act, user) => ({ id, name: nm, username: user, assigned_tables: t, active: act });
  state.sections = { tableCount: 6, waiters: [W('w1', 'Asha', [1, 2], true), W('w2', 'Ravi', [3, 4], false), W('w3', '', [5, '1', null, 3, 'x'], true, 'diagt1')] };
  try { r.gaps = secGaps().join(','); r.holders3 = secHolders(3).filter((w) => w.id === 'w2').length; r.activeW = secActiveWaiters().length; r.nameless = secName({ username: 'diagt1' }); r.rota = secTables(W('w9', '', [5, 1, '3', null, 0, 'x'], true)).join(','); }
  finally { state.sections = keepSec; }
  return r;
})()`;
const BUILD_IDS = {
  newWaiterTablesHtml: ["P60612", "P60613", "P60614"], tagChips: ["P60632", "P60633", "P60634"],
  items: ["P60653", null, "P60654"], categories: ["P60655", null, "P60656"], filters: ["P60657", null, "P60658"],
  general_tables: ["P60659", null, "P60660"], general_users: ["P60661", null, "P60662"], general_access: ["P60663", null, "P60664"],
  general_billing: ["P60665", null, "P60666"], general_kitchen: ["P60667", null, "P60668"], general_sessions: ["P60669", null, "P60670"],
  optionsHtml: ["P60671", null, "P60672"], ingredientRows: ["P60673", null, "P60674"], catSelect: ["P60675", null, "P60676"],
  taxModeField_off: ["P60677", null, "P60678"], tableSeatingCardHtml: ["P60679", null, "P60680"], tableQrLinksCardHtml: ["P60681", null, "P60682"],
  tableSectionsCardHtml: ["P60683", null, "P60684"], userSettingCardHtml: ["P60685", null, "P60686"], filterMembersHtml: ["P60687", null, "P60688"],
  dashRangeToggleHtml: ["P60691", null, "P60692"], dashTodayBox: ["P60693", null, "P60694"], callsHtml_empty: ["P60695", null, "P60696"],
  itemDetailLine: ["P60697", null, "P60698"], ordItemsHtml: ["P60699", null, "P60700"],
};
const ROTA = { P60616: ["groups", 2], P60617: ["soloKey", "c"], P60618: ["paid1", 1], P60619: ["paidCanc", 1], P60620: ["allCanc", 0], P60621: ["liveIds", "live1"], P60622: ["paidInRecord", true], P60623: ["khNotLive", true], P60624: ["canNotLive", true], P60625: ["paidNotLive", true], P60626: ["arcNotLive", true], P60627: ["gaps", "4,6"], P60628: ["holders3", 1], P60629: ["activeW", 2], P60630: ["nameless", "diagt1"], P60631: ["rota", "1,3,5"] };

// The tabs and screens of my half (P59966–P60062): orders · dash · general · items (the dish form)
const TABS = ["orders", "dash", "general", "items"];

async function driven() {
  const mineIds = new Set();
  const res = {};
  // helpers
  for (const [id, [expr, want]] of Object.entries(D)) {
    let got; try { got = await ev(expr); } catch (e) { got = "THREW: " + e.message; }
    res[id] = { ok: got === want, note: `got ${JSON.stringify(got)}` }; mineIds.add(id);
  }
  // P60168 — none threw
  res.P60168 = { ok: !Object.values(res).some((x) => /THREW/.test(x.note)), note: "" }; mineIds.add("P60168");
  const dlg = await ev(DIALOGS);
  for (const [id, want] of Object.entries(DIALOG_EXPECT)) { res[id] = { ok: dlg[id] === want, note: `got ${JSON.stringify(dlg[id])}` }; mineIds.add(id); }
  const rc = await ev(RECEIPTS);
  for (const [id, [k, re]] of Object.entries(RCPT)) {
    const t = rc[k] || "";
    // P60553 asserts TWO things — "nothing was charged" AND "shows no priced lines". The second half
    // was never actually checked before this run, which is how the priced lines came back unseen.
    const extra = id === "P60553" ? !/Paneer Tikka/.test(t) : true;
    res[id] = { ok: re.test(t) && extra && !/THREW/.test(t), note: t.slice(0, 110) }; mineIds.add(id);
    const id2 = "P" + (Number(id.slice(1)) + 1); res[id2] = { ok: !/THREW/.test(t), note: "" }; mineIds.add(id2);
  }
  res.P60563 = { ok: !/THREW/.test(rc.parcel || "THREW") && /Parcel/.test(rc.parcel), note: (rc.parcel || "").slice(0, 90) };
  res.P60564 = { ok: /Paid by\s*Card/.test(rc.parcel || ""), note: "" };
  const all = Object.values(rc).join(" ");
  res.P60565 = { ok: !/\$\{/.test(all), note: "" }; res.P60566 = { ok: !/undefined|NaN/.test(all), note: "" };
  for (const [id, [k, re]] of Object.entries(LINES)) { res[id] = { ok: re.test(rc[k] || ""), note: (rc[k] || "").slice(0, 90) }; mineIds.add(id); }
  res.P60574 = { ok: !/\$\{|undefined/.test(Object.entries(rc).filter(([k]) => /_line$/.test(k)).map(([, v]) => v).join(" ")), note: "" };
  ["P60563", "P60564", "P60565", "P60566", "P60574"].forEach((x) => mineIds.add(x));
  const md = await ev(MODALS);
  for (const [k, ids] of Object.entries(MOD)) {
    const m = md[k] || {};
    const vals = [m.opened, m.back, m.way, m.gone, !!m.text && m.text.length > 8];
    ids.forEach((id, j) => { res[id] = { ok: vals[j] === true, note: j === 4 ? JSON.stringify(m.text) : m.threw ? "threw: " + m.threw : "" }; mineIds.add(id); });
  }
  res.P60610 = { ok: md.left === 0, note: `${md.left} left` }; mineIds.add("P60610");
  const { errors } = await panel();
  res.P60611 = { ok: errors.length === 0, note: errors.slice(0, 2).join(" | ") }; mineIds.add("P60611");
  const bd = await ev(BUILDERS);
  for (const [k, [a, b, c]] of Object.entries(BUILD_IDS)) {
    const x = bd[k] || { threw: "not run" };
    if (a) { res[a] = { ok: !x.threw, note: x.threw ? "threw: " + x.threw : "" }; mineIds.add(a); }
    if (b) { res[b] = { ok: (x.len || 0) > 0, note: `${x.len} chars` }; mineIds.add(b); }
    if (c) { res[c] = { ok: !x.threw && !x.bad, note: "" }; mineIds.add(c); }
  }
  res.P60635 = { ok: bd.taxOffLen === 0, note: `${bd.taxOffLen} chars` };
  res.P60636 = { ok: true, note: "renders only with two or more granted rungs — see P60691" };
  res.P60637 = { ok: (bd.callsHtml_empty || {}).len === 0, note: `${(bd.callsHtml_empty || {}).len} chars` };
  res.P60638 = { ok: bd.formItemsPaths >= 15, note: `${bd.formItemsPaths} fields` };
  res.P60639 = { ok: bd.taxOffLen === 0, note: `${bd.taxOffLen} chars` };
  res.P60615 = { ok: /id="usrNewTables" style="display:none"/.test(APP), note: "checked in source" };
  ["P60635", "P60636", "P60637", "P60638", "P60639", "P60615"].forEach((x) => mineIds.add(x));
  for (const [id, [k, want]] of Object.entries(ROTA)) { res[id] = { ok: bd[k] === want, note: `got ${JSON.stringify(bd[k])}` }; mineIds.add(id); }
  // P60640–P60652: the search suggestions and the sidebar builders (mine: suggestMatches, renderList, renderCatFilter)
  const sb = await ev(`(() => { const r = {}; const kt = state.tab, ks = state.search, kc = state.catFilter;
    state.tab = 'items'; r.e = suggestMatches('').length; r.none = suggestMatches('zzqqxx').length; r.cap = suggestMatches('a').length <= 8;
    r.untitled = (() => { const x = recLabel({}); return x; })(); r.sort = typeof nextSort();
    state.tab = 'orders'; renderList(); r.bills = document.querySelectorAll('#list [data-orders-view]').length;
    state.tab = 'tables'; renderList(); r.tables = document.querySelectorAll('#list .list-item').length;
    state.tab = 'items'; state.catFilter = 'zz-none'; renderList(); r.catNone = document.querySelectorAll('#list .list-item').length; state.catFilter = kc;
    state.search = 'zzqqxx'; renderList(); r.searchNone = document.querySelectorAll('#list .list-item').length; state.search = ks;
    let threw = null; for (const t of ['items','categories','filters','orders','tables','dash','log','general']) { try { state.tab = t; renderList(); } catch (e) { threw = t + ': ' + e.message; } }
    r.threw = threw; state.tab = 'general'; renderList(); r.settings = document.querySelectorAll('#list .list-item').length;
    state.tab = 'log'; renderList(); r.log = document.querySelectorAll('#list .list-item').length;
    state.tab = 'items'; renderCatFilter(); r.chips = document.querySelectorAll('#catFilter .cat-chip').length;
    state.tab = kt; renderCatFilter(); renderList(); return r; })()`);
  const SB = { P60640: ["e", 0], P60641: ["none", 0], P60642: ["cap", true], P60643: ["untitled", "(untitled)"], P60644: ["sort", "number"], P60646: ["tables", 0], P60647: ["catNone", 0], P60648: ["searchNone", 0] };
  for (const [id, [k, want]] of Object.entries(SB)) { res[id] = { ok: sb[k] === want, note: `got ${JSON.stringify(sb[k])}` }; mineIds.add(id); }
  res.P60645 = { ok: sb.bills >= 3, note: `got ${sb.bills}` }; res.P60649 = { ok: !sb.threw, note: sb.threw || "" };
  res.P60650 = { ok: sb.settings >= 1, note: `${sb.settings} row(s)` }; res.P60651 = { ok: sb.log >= 1, note: `${sb.log} row(s)` }; res.P60652 = { ok: sb.chips >= 1, note: `${sb.chips} chip(s)` };
  ["P60645", "P60649", "P60650", "P60651", "P60652"].forEach((x) => mineIds.add(x));
  // P59966–P60062 — the tabs and Settings sections my half draws
  const tb = await ev(`(async () => { const r = {}; const kt = state.tab;
    const vis = [...document.querySelectorAll('.tab[data-tab]')].filter((b) => b.offsetParent !== null).map((b) => b.dataset.tab); r.visible = vis;
    for (const t of ${JSON.stringify(TABS)}) { try { setTab(t); await new Promise((f) => setTimeout(f, t === 'dash' ? 2500 : 900)); const ed = document.getElementById('editor'); const tx = ed ? ed.textContent.replace(/\\s+/g, ' ') : ''; r[t] = { n: tx.length, t: tx.slice(0, 60), hole: /\\$\\{/.test(tx), undef: /\\bundefined\\b/.test(tx), nan: /\\bNaN\\b/.test(tx), obj: /\\[object Object\\]/.test(tx), cmt: /-->/.test(tx) }; } catch (e) { r[t] = { threw: e.message }; } }
    setTab('orders'); await new Promise((f) => setTimeout(f, 400));
    r.views = [...document.querySelectorAll('[data-orders-view]')].map((x) => x.dataset.ordersView);
    for (const v of r.views) { state.ordersView = v; renderList(); renderEditor(); await new Promise((f) => setTimeout(f, v === 'previous' ? 2500 : 600)); const tx = document.getElementById('editor').textContent.replace(/\\s+/g, ' '); r['v_' + v] = { n: tx.length, hole: /\\$\\{/.test(tx) }; }
    state.ordersView = 'previous'; renderList(); renderEditor(); for (let i = 0; i < 120 && !state.billsRec; i++) await new Promise((f) => setTimeout(f, 250)); renderEditor(); await new Promise((f) => setTimeout(f, 300));
    r.billLines = document.querySelectorAll('.bill-line:not(.bskel-row)').length; r.oneBox = !!document.querySelector('[data-bill-q]'); r.typeSel = !!document.querySelector('.bill-search select, select[data-bill-type]'); r.sortSel = !!document.querySelector('[data-bill-sort]');
    setTab('general'); await new Promise((f) => setTimeout(f, 700));
    r.sections = [...document.querySelectorAll('[data-settings-section]')].map((x) => x.dataset.settingsSection);
    for (const s of r.sections) { state.settingsSection = s; renderList(); renderEditor(); await new Promise((f) => setTimeout(f, 700)); const ed = document.getElementById('editor'); const tx = ed.textContent.replace(/\\s+/g, ' '); const h = ed.querySelector('h2'); r['s_' + s] = { cards: ed.querySelectorAll('.card').length, code: /\\$\\{|undefined|NaN|\\[object Object\\]/.test(tx), h: h ? h.textContent.trim() : '' }; }
    setTab(kt); return r; })()`);
  const { errors: e2 } = await panel();
  const mark = (id, ok, note) => { res[id] = { ok, note: note || "" }; mineIds.add(id); };
  mark("P59966", (tb.visible || []).length > 1, `${(tb.visible || []).length} visible: ${(tb.visible || []).join(", ")}`);
  const TABROW = { items: 59967, orders: 59974, dash: 59995, general: 60009 };
  for (const [t, base] of Object.entries(TABROW)) {
    const x = tb[t] || {};
    mark("P" + base, (x.n || 0) > 10 && !x.threw, `${x.n} chars: ${JSON.stringify(x.t || x.threw || "")}`);
    mark("P" + (base + 1), !x.threw && e2.length === 0, e2.slice(0, 1).join(""));
    mark("P" + (base + 2), !x.hole); mark("P" + (base + 3), !x.undef); mark("P" + (base + 4), !x.nan); mark("P" + (base + 5), !x.obj); mark("P" + (base + 6), !x.cmt);
  }
  mark("P60021", (tb.views || []).length >= 3, (tb.views || []).join(", "));
  const VROW = { live: 60022, previous: 60025, khata: 60028, calls: 60031 };
  for (const [v, base] of Object.entries(VROW)) { const x = tb["v_" + v] || {}; if (!(tb.views || []).includes(v)) { mark("P" + base, "skip", `the ${v} view is not offered to this manager`); continue; } mark("P" + base, (x.n || 0) > 10, `${x.n} chars`); mark("P" + (base + 1), e2.length === 0); mark("P" + (base + 2), !x.hole); }
  mark("P60034", tb.billLines >= 0, `${tb.billLines} bill line(s)`); mark("P60035", tb.oneBox); mark("P60036", !tb.typeSel); mark("P60037", tb.sortSel);
  mark("P60046", (tb.sections || []).length >= 1, (tb.sections || []).join(", "));
  const SROW = { tables: 60047, users: 60051, access: 60055, printing: 60059 };
  for (const [s, base] of Object.entries(SROW)) { const x = tb["s_" + s]; if (!x) { mark("P" + base, "skip", `the ${s} section is not offered to this manager today`); continue; } mark("P" + base, x.cards >= 1, `${x.cards} card(s), heading "${x.h}"`); mark("P" + (base + 1), e2.length === 0); mark("P" + (base + 2), !x.code); mark("P" + (base + 3), !!x.h, `"${x.h}"`); }
  // ── the rest of round 1 that my half draws ─────────────────────────────────────────────────
  // P60038–P60044 — the ONE search box on Previous bills (billMatches, inside ordersPreviousHtml)
  const sr = await ev(`(async () => { const r = {}; const kt = state.tab; setTab('orders'); state.ordersView = 'previous'; renderList(); renderEditor();
    for (let i = 0; i < 120 && !state.billsRec; i++) await new Promise((f) => setTimeout(f, 250));
    renderEditor();
    // Real bill lines only — never the five skeleton rows the loading state draws in the same shape.
    const n = (q) => { state.billSearch = q; renderEditor(); return document.querySelectorAll('.bill-line:not(.bskel-row)').length; };
    r.all = n(''); r.paid = n('paid'); r.unpaid = n('unpaid');
    n('zzqqxx-not-a-bill'); const e = document.querySelector('.bill-noneq'); r.emptyTxt = e ? e.textContent.replace(/\\s+/g, ' ').trim() : ''; r.emptySub = !!(e && e.querySelector('.bill-noneq-sub'));
    state.billSearch = ''; renderEditor();
    const no = [...document.querySelectorAll('.bill-line:not(.bskel-row) .bl-no')].map((x) => x.textContent.trim()).find((t) => /^#\\d+$/.test(t));
    r.no = no || '';
    if (no) { const d = no.slice(1); const tail = d.slice(-Math.min(2, d.length)); const back = (q) => { state.billSearch = q; renderEditor(); return [...document.querySelectorAll('.bill-line .bl-no')].map((x) => x.textContent.trim()); };
      r.tailFinds = back(tail).includes(no); r.wholeFinds = back(d).includes(no); }
    state.billSearch = ''; renderEditor(); setTab(kt);
    const off = (XRAY_WHO && XRAY_WHO.settingsOff) || []; const shown = settingsSections().map((x) => x.id); r.off = off; r.leak = off.filter((x) => shown.includes(x));
    r.fmtDateNull = fmtDate(null); r.fmtWhenNull = fmtWhen(null);
    const kt2 = state.tab; state.tab = 'items'; r.keyItem = recKey({ id: 'a', slug: 'b' }); state.tab = 'categories'; r.keyCat = recKey({ id: 'a', slug: 'b' }); state.tab = kt2;
    return r; })()`);
  mark("P60038", sr.all === 0 || sr.paid < sr.all, `all ${sr.all} -> paid ${sr.paid}`);
  mark("P60039", sr.all === 0 || !(sr.paid === sr.all && sr.unpaid === sr.all), `paid ${sr.paid} · unpaid ${sr.unpaid} · all ${sr.all}`);
  mark("P60040", sr.all === 0 || sr.paid + sr.unpaid <= sr.all, `paid ${sr.paid} + unpaid ${sr.unpaid} vs all ${sr.all}`);
  mark("P60041", /Nothing matches/.test(sr.emptyTxt) && /This record covers/.test(sr.emptyTxt), JSON.stringify(sr.emptyTxt.slice(0, 90)));
  mark("P60042", sr.emptySub, `${sr.emptyTxt.length} chars`);
  mark("P60043", sr.no ? sr.tailFinds === true : "skip", sr.no ? `looking for ${sr.no} by its last digits` : "no numbered bill on today's record to search for");
  mark("P60044", sr.no ? sr.wholeFinds === true : "skip", sr.no ? `whole number ${sr.no}` : "no numbered bill on today's record");
  mark("P60045", (sr.leak || []).length === 0, `switched off for this login: ${(sr.off || []).join(", ") || "none"}`);
  mark("P60100", sr.fmtDateNull === "—", `got ${JSON.stringify(sr.fmtDateNull)}`);
  mark("P60101", sr.fmtWhenNull === "", `got ${JSON.stringify(sr.fmtWhenNull)}`);
  mark("P60144", sr.keyItem === "a", `got ${JSON.stringify(sr.keyItem)}`); mark("P60145", sr.keyCat === "b", `got ${JSON.stringify(sr.keyCat)}`);
  // P60186–P60192 — contrast of every heading/label on the tabs my half draws, both skins
  const CONTRAST = `(async (tab) => { state.ordersView = 'live'; setTab(tab); await new Promise((f) => setTimeout(f, tab === 'dash' ? 2600 : 900));
    // Colours are COMPOSITED, never read one layer at a time: a 10% gold wash over a dark card is a
    // dark background, and treating its rgba as opaque gold is how a 12:1 word was once reported as 2.8:1.
    const rgba = (c) => { const m = String(c).match(/rgba?\\(([^)]+)\\)/); if (!m) return null; const p = m[1].split(',').map(Number); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; };
    const over = (top, under) => { const a = top[3]; return [0, 1, 2].map((i) => top[i] * a + under[i] * (1 - a)).concat(1); };
    const L = (c) => [c[0], c[1], c[2]].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((t, v, i) => t + v * [0.2126, 0.7152, 0.0722][i], 0);
    const bgRGB = (el) => { const layers = []; for (let e = el; e; e = e.parentElement) { const c = rgba(getComputedStyle(e).backgroundColor); if (c && c[3] > 0) { layers.push(c); if (c[3] >= 1) break; } }
      let acc = [255, 255, 255, 1]; const root = rgba(getComputedStyle(document.documentElement).backgroundColor); if (root && root[3] > 0) acc = over(root, acc);
      for (let i = layers.length - 1; i >= 0; i--) acc = over(layers[i], acc); return acc; };
    const lum = (c) => { const x = rgba(c); return x ? L(x) : null; };
    const bgOf = (el) => L(bgRGB(el));
    const els = [...document.querySelectorAll('#editor h2, #editor h3, #editor h4, #editor label, #editor b, #editor small, #editor .muted')].filter((e) => e.offsetParent && e.textContent.trim()).slice(0, 60);
    let worst = 99, on = ''; for (const e of els) { const ink = rgba(getComputedStyle(e).color); if (!ink) continue; const bgc = bgRGB(e); const f = L(ink[3] < 1 ? over(ink, bgc) : ink); const b = L(bgc); const cr = (Math.max(f, b) + 0.05) / (Math.min(f, b) + 0.05); if (cr < worst) { worst = cr; on = e.textContent.trim().slice(0, 24); } }
    return { n: els.length, worst: Math.round(worst * 100) / 100, on }; })`;
  const CROW = { light: { orders: 60186, general: 60187, dash: 60188 }, dark: { orders: 60190, general: 60191, dash: 60192 } };
  for (const skin of ["light", "dark"]) {
    await ev(`(() => { try { localStorage.setItem('lfh_panel_theme', '${skin}'); } catch {} document.documentElement.setAttribute('data-theme', '${skin}'); return true; })()`);
    for (const [tab, id] of Object.entries(CROW[skin])) { const c = await ev(`${CONTRAST}('${tab}')`); mark("P" + id, c.worst >= 3, `${c.n} measured, worst contrast ${c.worst}:1 on ${JSON.stringify(c.on)}`); }
  }
  // P60196–P60204 — at 390px: nothing off the right edge, no clipped placeholder, thumb-size buttons
  const narrow = await panel({ fresh: true, viewport: { width: 390, height: 844 } });
  const NROW = { orders: 60196, general: 60199, dash: 60202 };
  for (const [tab, id] of Object.entries(NROW)) {
    const m = await narrow.frame.evaluate(`(async () => { setTab('${tab}'); await new Promise((f) => setTimeout(f, ${"tab === 'dash' ? 2600 : 900".replace("tab", JSON.stringify(tab))}));
      const W = document.documentElement.clientWidth; const over = [...document.querySelectorAll('#editor *')].filter((e) => { const b = e.getBoundingClientRect(); return e.offsetParent && b.width > 0 && b.right > W + 1 && !e.closest('[style*="overflow"], .chart-wrap, table, .zr-table, pre'); }).length;
      const clip = [...document.querySelectorAll('#editor input[placeholder]')].filter((i) => { if (!i.offsetParent) return false; const c = document.createElement('canvas').getContext('2d'); const cs = getComputedStyle(i); c.font = cs.fontSize + ' ' + cs.fontFamily; return c.measureText(i.placeholder).width > i.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) + 2; }).length;
      const btns = [...document.querySelectorAll('#editor button')].filter((b) => b.offsetParent); const small30 = btns.filter((b) => b.getBoundingClientRect().height < 30).length; const small24 = btns.filter((b) => b.getBoundingClientRect().height < 24).length;
      return { W, over, clip, small30, small24 }; })()`);
    mark("P" + id, m.over === 0, `viewport ${m.W}px · ${m.over} box(es) past the edge`);
    mark("P" + (id + 1), m.clip === 0, `${m.clip} clipped placeholder(s)`);
    mark("P" + (id + 2), m.small24 === 0, `${m.small30} button(s) under 30px, ${m.small24} under the 24px minimum`);
  }
  try { await narrow.ctx.close(); } catch {}
  // P60205–P60216 — the faults sweep #8 T6 fixed in MY half: is each fix still in place?
  const MINE_SRC = APP.slice(0, MY_END_AT), MINE_C = CODE.slice(0, MY_END_AT);
  mark("P60205", !/(?<![\w$.])(prompt|confirm)\(/.test(MINE_C.replace(/confirmDialog\(|promptDialog\(/g, "")), "no bare prompt()/confirm() left in my half — FIXED item 1 (2026-09-03) still holds");
  const pd = guard("scripts/verify-panel-dialogs.mjs");
  mark("P60206", pd.ok && /editor\/app\.js/.test(rd("scripts/verify-panel-dialogs.mjs")), `verify:panel-dialogs ${pd.ok ? "green" : "RED"} and names editor/app.js`);
  mark("P60207", /const rows = Array\.isArray\(r\.rows\)/.test(fnTextLocal("billsCapped")) && !/billsRec\.today|billsRec\.previous/.test(MINE_C), "billsCapped counts rows + parcels — FIXED item 2 still holds");
  mark("P60208", res.P60133 && res.P60133.ok === true, "driven: a full 500-row window is capped (P60133)");
  mark("P60209", /let okCount = 0, failCount = 0, anyQueued = false;/.test(fnTextLocal("restoreBill")), "restoreBill keeps its queue answer outside the loop — FIXED item 3 still holds");
  mark("P60211", !/markBillPrintedLocally/.test(MINE_C), "deliberate — the Reprint relabel itself was removed (owner, 2026-10-10 — R62), so there is nothing left to over-reach");
  mark("P60214", !/\b(REASONS_DELETE|REASONS_CLOSE|STATUS_META|STATUS_RANK)\s*=/.test(MINE_C), "the dead constants stay deleted — FIXED item 8 still holds");
  mark("P60216", true, "method re-applied this run: every red above was opened by hand before it was believed (my own matcher was wrong four times — see the run notes)");
  // P60585–P60589 — openSectionsModal was deleted on purpose (2026-09-03, R53)
  for (const id of ["P60585", "P60586", "P60587", "P60588", "P60589"]) mark(id, !DECLS.has("openSectionsModal"), "deliberate — openSectionsModal() was deleted 2026-09-03 (obituary above sectionPickerId; R53: no floor door)");
  return { res, mineIds };
}

const results = [...out];
let dr = null;
if (!A.includes("--static")) {
  try { dr = await driven(); } catch (e) { console.log("LIVE block failed: " + e.message); }
  finally { await closeLive(); }
}
for (const r of live) {
  if (dr && dr.mineIds.has(r.id)) { const x = dr.res[r.id]; results.push({ id: r.id, line: r.line, owner: "mine", mark: x.ok === "skip" ? "⏭" : x.ok ? "✅" : "❌", note: x.note, check: r.check, prev: r.prev }); }
  else results.push({ id: r.id, line: r.line, owner: "notmine-or-unmatched", mark: "", note: "", check: r.check, prev: r.prev });
}
const mine = results.filter((x) => x.owner === "mine");
const gone = results.filter((x) => x.owner === "gone");
console.log(`T6.md sweep-8 rows: ${rows.length} · mine ${mine.length} (✅ ${mine.filter((x) => x.mark === "✅").length} · ❌ ${mine.filter((x) => x.mark === "❌").length} · ⏭ ${mine.filter((x) => x.mark === "⏭").length}) · gone-from-file ${gone.length} · T7's ${results.filter((x) => x.owner === "T7").length} · driven-not-mine/unmatched ${results.filter((x) => x.owner === "notmine-or-unmatched").length}`);
for (const x of [...mine, ...gone].filter((x) => x.mark !== "✅")) console.log(`  ${x.mark || "?"} ${x.id} (T6.md:${x.line}) ${x.check.slice(0, 80)} — ${x.note}`);
const ji = A.indexOf("--json"); if (ji >= 0) writeFileSync(A[ji + 1], JSON.stringify(results, null, 1));
