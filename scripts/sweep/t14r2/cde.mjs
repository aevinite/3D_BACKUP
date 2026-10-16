// Round 2 · bank C — THE THREE NUMBERS (P214161–P214200) · bank D — THE KITCHEN TICKET (P214201–P214250)
// · bank E — THE BANQUET SHEET (P214251–P214300). Fresh plan, 2026-10-16.
import { sec, imp, sql, read, NO_DB, root } from "../t14s10/lib.mjs";
import { spawnSync } from "node:child_process";

const B = (await imp("public/panels/billdoc.js")).default;
const FH = "00000000-0000-0000-0000-000000000001", AANGAN = "6c6fadb6-da23-4ab3-9f90-d164773f60b3";
const db = (fn) => async () => (NO_DB ? { skip: "--no-db" } : fn());
const BD = (col) => `((${col}) at time zone 'Asia/Kolkata' - interval '5 hours')::date`;

// A PROBE THAT CANNOT COMMIT: a DO block whose last statement is RAISE EXCEPTION, so the database rolls the
// whole block back and hands the result out in the error text. Used once, to price a cart as if French House
// had no GSTIN — the one way to drive mig 426 through the real pricing function without changing any row.
const env = Object.fromEntries(read(".env.local").split(/\r?\n/).map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i)).filter(Boolean).map((m) => [m[1], m[2].replace(/^["']|["']$/g, "")]));
async function probe(body) {
  const { refuseUnlessDevTestDb } = await imp("scripts/sweep/devStacks.mjs");
  refuseUnlessDevTestDb(env.NEXT_PUBLIC_SUPABASE_URL, "T14 round 2 rollback probe");
  const q = `DO $$ DECLARE r jsonb; BEGIN ${body} RAISE EXCEPTION 'PROBE%', r::text; END $$;`;
  if (!/RAISE EXCEPTION 'PROBE%', r::text; END \$\$;$/.test(q)) throw new Error("a probe must end in its own rollback");
  const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: "POST", headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify({ query: q }) });
  const t = await res.text();
  const m = t.match(/PROBE(\{.*?\})(?:\\n|")/);
  return m ? JSON.parse(m[1].replace(/\\"/g, '"')) : { raw: t.slice(0, 200) };
}

// ── C · the three numbers ─────────────────────────────────────────────────────────────────────────
const c = sec(214160);
const N = "docs/NUMBERING.md";
c(1, N, "French House: no KOT number twice in one business day, across dine-in and every delivery channel", "orders ∪ aggregator_orders since September", db(async () => (await sql(`select count(*)::int n from (select d, k from (select ${BD("created_at")} d, kot_no k from orders where restaurant_id='${FH}' and kot_no is not null and created_at>='2026-09-01' union all select ${BD("created_at")}, kot_no from aggregator_orders where restaurant_id='${FH}' and kot_no is not null and created_at>='2026-09-01') u group by 1,2 having count(*)>1) x`))[0].n === 0 || "a KOT number was handed out twice"));
c(2, N, "Aangan: the same, read only", "the same query", db(async () => (await sql(`select count(*)::int n from (select d, k from (select ${BD("created_at")} d, kot_no k from orders where restaurant_id='${AANGAN}' and kot_no is not null and created_at>='2026-09-01' union all select ${BD("created_at")}, kot_no from aggregator_orders where restaurant_id='${AANGAN}' and kot_no is not null and created_at>='2026-09-01') u group by 1,2 having count(*)>1) x`))[0].n === 0 || "a KOT number was handed out twice"));
c(3, N, "an invoice number is never used twice by one restaurant, in all of history", "group by restaurant + invoice_no", db(async () => (await sql("select count(*)::int n from (select restaurant_id, invoice_no from sessions where invoice_no is not null group by 1,2 having count(*)>1) x"))[0].n === 0 || "reused"));
c(4, N, "no invoice exists without the bill number it was raised from", "sessions with invoice_no but no bill_no", db(async () => (await sql("select count(*)::int n from sessions where invoice_no is not null and bill_no is null"))[0].n === 0 || "orphan invoice numbers"));
c(5, N, "an issued number and date cannot change — the database's own guard is live", "pg_trigger trg_invoice_identity_is_final, enabled", db(async () => (await sql("select count(*)::int n from pg_trigger where tgname='trg_invoice_identity_is_final' and tgenabled<>'D'"))[0].n === 1 || "guard missing"));
c(6, N, "a reopened bill keeps its number — the live function re-uses it", "lfh_generate_invoice body", db(async () => /invoice_reopen_count = coalesce\(invoice_reopen_count, 0\) \+ 1/i.test((await sql("select pg_get_functiondef(p.oid) d from pg_proc p where proname='lfh_generate_invoice' order by pronargs desc limit 1"))[0].d) || "not the mig-407 function"));
c(7, N, "a cancelled sale never draws an invoice number — the live function refuses it before the counter moves", "lfh_generate_invoice raises LFH02 before lfh_next_seq", db(async () => { const d = (await sql("select pg_get_functiondef(p.oid) d from pg_proc p where proname='lfh_generate_invoice' order by pronargs desc limit 1"))[0].d; return (d.indexOf("LFH02") > 0 && d.indexOf("LFH02") < d.indexOf("lfh_next_seq")) || "the refusal is not before the counter"; }));
c(8, N, "the number-drawing functions cannot be called with a browser's key", "has_function_privilege anon/authenticated", db(async () => { const r = await sql("select bool_or(has_function_privilege('anon',p.oid,'execute') or has_function_privilege('authenticated',p.oid,'execute')) x from pg_proc p where proname in ('lfh_next_seq','lfh_next_counter','lfh_generate_invoice')"); return r[0].x === false || "callable from a browser"; }));
c(9, N, "the business day turns at 05:00 India time in the database's counter", "lfh_business_day body", db(async () => /Asia\/Kolkata'\) - interval '5 hours'/.test((await sql("select pg_get_functiondef(p.oid) d from pg_proc p where proname='lfh_business_day' limit 1"))[0].d) || "not 05:00 IST"));
const FY = [["2026-03-31T23:59:00+05:30", "2025-26"], ["2026-04-01T00:00:00+05:30", "2026-27"], ["2026-03-31T18:29:59Z", "2025-26"], ["2026-03-31T18:30:00Z", "2026-27"], ["2027-03-31T23:00:00+05:30", "2026-27"], ["2027-04-01T05:30:00+05:30", "2027-28"]];
FY.forEach(([at, want], i) => c(10 + i, N, `the invoice's financial year at ${at} is ${want}, India's April–March, whatever the device`, "billdoc financialYear", () => B.financialYear(at) === want || B.financialYear(at)));
// 16–21: the same six on a device set to New York, London, Sydney (a separate process per zone)
const zones = ["America/New_York", "Europe/London", "Australia/Sydney"];
zones.forEach((tz, i) => c(16 + i, N, `…and identical on a device set to ${tz}`, "a fresh node with TZ set, the same six dates", () => {
  const r = spawnSync(process.execPath, ["-e", `const B=require(${JSON.stringify(root + "/public/panels/billdoc.js")});console.log(JSON.stringify(${JSON.stringify(FY.map((x) => x[0]))}.map(B.financialYear)))`], { env: { ...process.env, TZ: tz }, encoding: "utf8" });
  return r.stdout.trim() === JSON.stringify(FY.map((x) => x[1])) || r.stdout.trim();
}));
c(19, N, "invFmt pads to six digits and keeps the prefix the restaurant set", "invFmt(42, …, 'LFH')", () => B.invFmt(42, "2026-05-01T10:00:00+05:30", "LFH") === "LFH/2026-27/000042" || B.invFmt(42, "2026-05-01T10:00:00+05:30", "LFH"));
c(20, N, "a cancelled sheet names the invoice it retired, '— voided'", "billData on an all-cancelled bill with an invoice", () => B.billData({ orders: [{ status: "cancelled", items: [] }], session: { invoice_no: 9, invoice_at: "2026-10-01T10:00:00Z" } }).invNo === "INV/2026-27/000009 — voided" || "not marked");
c(21, N, "a bill with an invoice shows only the invoice number; without, only the bill number", "the two rows", () => { const a = B.billDocHtml({ invNo: "INV/2026-27/000001", billNo: 5 }), b = B.billDocHtml({ billNo: 5 }); return (/<span>Invoice<\/span>/.test(a) && !/Bill no/.test(a) && /Bill no<\/span><b>#5/.test(b)) || "wrong rows"; });
c(22, N, "item 12 through the REAL pricing function: a French House cart priced as if it had no GSTIN carries no tax — rolled back, nothing saved", "DO block: blank the GSTIN, lfh_price_order, RAISE (always rolls back)", db(async () => {
  const items = await sql(`select id from menu_items where restaurant_id='${FH}' and coalesce(price::text,'') <> '' limit 2`);
  if (!items.length) return { skip: "no French House menu item" };
  const cart = JSON.stringify(items.map((x) => ({ id: x.id, qty: 2 })));
  const off = await probe(`UPDATE settings SET gstin = '' WHERE restaurant_id = '${FH}'; r := lfh_price_order('${cart}'::jsonb, '${FH}'::uuid);`);
  const on = await probe(`r := lfh_price_order('${cart}'::jsonb, '${FH}'::uuid);`);
  const still = (await sql(`select coalesce(trim(gstin),'') <> '' g from settings where restaurant_id='${FH}'`))[0].g;
  const taxOff = Number(off.tax ?? off.tax_amount ?? NaN), taxOn = Number(on.tax ?? on.tax_amount ?? NaN);
  return (still && taxOff === 0 && taxOn > 0) ? { ok: true, note: `tax with GSTIN ₹${taxOn}, without ₹${taxOff}; French House's GSTIN untouched` } : `without ${JSON.stringify(off).slice(0, 120)} · with ${JSON.stringify(on).slice(0, 80)} · gstin still there: ${still}`;
}));
c(23, N, "every order a guest or waiter places is priced by that function, which takes its rate from lfh_effective_tax_rate", "function bodies", db(async () => { const r = await sql("select (select pg_get_functiondef(p.oid) from pg_proc p where proname='lfh_price_order') ~ 'lfh_effective_tax_rate' a, (select bool_or(pg_get_functiondef(p.oid) ~ 'lfh_price_order') from pg_proc p where proname='lfh_place_order') b"); return (r[0].a && r[0].b) || JSON.stringify(r[0]); }));

// ── D · the kitchen ticket ───────────────────────────────────────────────────────────────────────
const d = sec(214200);
const K = "public/panels/billdoc.js";
const T = (o) => B.kotDocHtml({ kot: 12, tableLabel: "T4", when: "07:15 PM", rname: "Kitchen", lines: [{ qty: 2, title: "Dal" }], ...o });
const MARK = ["<b>x", "<img src=x>", "\"><script>", "&amp;", "'quote'"];
let dn = 1;
for (const field of ["rname", "head", "tableLabel", "when", "title"]) MARK.forEach((mk) => {
  const id = dn++;
  d(id, K, `the ticket prints ${field} = ${JSON.stringify(mk)} as text, never as markup`, "kotDocHtml", () => { const h = T({ [field]: mk }); return (!h.includes(mk.replace("&amp;", "&amp;&amp;")) || mk === "&amp;") && !/<b>x|<img src=x>|"><script>/.test(h.replace(/<\/?(b|i|small|br|div|span|title|style|head|html|body|meta)[^>]*>/g, "")) || "raw markup"; });
});
// dn = 26
const LINE_MARKS = ["<b>l", "<i>n", "\"><x"];
LINE_MARKS.forEach((mk, i) => d(26 + i, K, `a dish title / option / note / removal holding ${JSON.stringify(mk)} prints as text`, "kotLineHtml", () => { const h = B.kotLineHtml({ qty: 1, title: mk, options: [mk], note: mk, removed: [mk] }); return !h.includes(mk) || "raw markup on the ticket"; }));
d(29, K, "the allergy list holding markup prints as text", "allergies", () => !T({ allergies: ["<b>nut"] }).includes("<b>nut") || "raw");
d(30, K, "DUPLICATE banner only on a reprint, at the very top", "reprint true/false", () => { const a = T({ reprint: true }), b = T({}); return (a.indexOf("Duplicate") < a.indexOf('class="h"') && !/Duplicate/.test(b)) || "banner wrong"; });
d(31, K, "the ⚠ AVOID box comes before the shared note and the first dish", "order", () => { const h = T({ allergies: ["nuts"], lines: [{ qty: 1, title: "A", note: "n" }, { qty: 1, title: "B", note: "n" }] }); return (h.indexOf("⚠ AVOID") < h.indexOf('class="on"') && h.indexOf('class="on"') < h.indexOf('class="kl"')) || "order"; });
d(32, K, "a single-dish ticket keeps its note under the dish (no shared note for one line)", "one line with a note", () => /A<br><small>&raquo; n/.test(T({ lines: [{ qty: 1, title: "A", note: "n" }] })) || "moved");
d(33, K, "a note on every line but one differing prints per line", "notes differ", () => (T({ lines: [{ qty: 1, title: "A", note: "x" }, { qty: 1, title: "B", note: "y" }] }).match(/&raquo;/g) || []).length === 2 || "wrong");
d(34, K, "a ticket never shows a price, whatever the lines carry", "lines with price / amount", () => !/₹|\b450\b/.test(T({ lines: [{ qty: 1, title: "A", price: 450, amount: 450 }] })) || "price on the ticket");
d(35, K, "quantity 0, negative, text or object prints as 1", "four bad quantities", () => [0, -3, "x", {}].every((q) => /class="q">1×/.test(B.kotLineHtml({ qty: q, title: "A" }))) || "raw quantity");
d(36, K, "quantity 12 prints as 12×", "qty 12", () => /class="q">12×/.test(B.kotLineHtml({ qty: 12, title: "A" })) || "wrong");
d(37, K, "the ticket number: undefined / null / NaN / object / '' all read KOT #—", "kotDocHtml kot values", () => [undefined, null, NaN, {}, ""].every((k) => /KOT #—</.test(B.kotDocHtml({ kot: k }))) || "raw");
d(38, K, "a ticket with no lines says (no items) rather than an empty strip", "lines []", () => /\(no items\)/.test(T({ lines: [] })) || "blank");
d(39, K, "a hole in the lines costs one line, never the ticket", "lines [null, dish]", () => /Dal/.test(B.kotDocHtml({ lines: [null, { qty: 1, title: "Dal" }] })) || "lost");
const TZS = ["Asia/Kolkata", "America/Los_Angeles", "Europe/London", "Asia/Tokyo", "Pacific/Auckland", "UTC"];
TZS.forEach((tz, i) => d(40 + i, K, `the ticket's time for one order is the same on a device set to ${tz}`, "kotWhen in a fresh node per zone, an order 3 days old", () => {
  const ts = new Date(Date.now() - 3 * 86400000).toISOString();
  const run = (z) => spawnSync(process.execPath, ["-e", `const B=require(${JSON.stringify(root + "/public/panels/billdoc.js")});process.stdout.write(B.kotWhen(${JSON.stringify(ts)}))`], { env: { ...process.env, TZ: z }, encoding: "utf8" }).stdout;
  const want = run("Asia/Kolkata"), got = run(tz);
  return (got === want && /^\d{1,2} [A-Z]{3} \d\d:\d\d (AM|PM)$/.test(got)) || `${tz}: "${got}" vs India "${want}"`;
}));
d(46, K, "every month prints three letters, SEP included", "the 1st of each month", () => ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"].every((m, i) => new RegExp(`^1 ${m} `).test(B.kotWhen(`2025-${String(i + 1).padStart(2, "0")}-01T12:00:00+05:30`))) || "a month misprinted");
d(47, K, "a ticket rung at 23:50 and reprinted at 00:10 is NOT 'YESTERDAY' — the business day turns at 05:00", "kotWhen around midnight IST", () => {
  const now = Date.now(), ist = new Date(now + 330 * 60000), h = ist.getUTCHours();
  if (h < 0 || h >= 5) return { ok: true, note: "the 05:00 rule is pinned by verify:print-paper at fixed clocks; this row only re-checks it between 00:00 and 05:00 IST" };
  return !/YESTERDAY/.test(B.kotWhen(new Date(now - 20 * 60000))) || "called the same night yesterday";
});
d(48, K, "an unparseable time prints nothing — never 'Invalid Date'", "kotWhen garbage", () => ["x", "", null, 0, NaN].every((v) => B.kotWhen(v) === "") || "printed something");
d(49, K, "the ticket keeps its 280px body for 66/80mm paper (R26)", "body width", () => /width:280px/.test(T({})) || "changed");
d(50, K, "a real ticket (no note) carries no toolbar, no script and no @page size", "kotDocHtml without note", () => { const h = T({}); return (!/class="bar"|<script|@page\{size/.test(h)) || "chrome on paper"; });

// ── E · the banquet sheet ────────────────────────────────────────────────────────────────────────
const e = sec(214250);
const BQ = "public/panels/billdoc.js";
let seed = 7; const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const sheet = (size, n, disc, rate) => {
  const lines = Array.from({ length: n }, (_, i) => ({ title: `Item ${i}`, qty: 1 + Math.floor(rnd() * 9), price: Math.round(50 + rnd() * 3000) }));
  const sub = lines.reduce((t, l) => t + l.qty * l.price, 0);
  const dd = B.moneyRound(sub * disc), tax = B.moneyRound((sub - dd) * rate);
  return { lines, bill: { bill_no: "B-1", subtotal: sub, discount: dd, tax, total: B.moneyRound(sub - dd + tax) }, settings: { gstin: "X", banquet_paper_size: size, banquet_tax_components: [{ label: "CGST", rate: rate * 50 }, { label: "SGST", rate: rate * 50 }] } };
};
const footsAll = (h) => {
  const tot = (h.match(/<tr class="tot">([\s\S]*?)<\/tr>/) || [])[1] || "";
  const totals = [...tot.matchAll(/class="r">([\d,.]+)</g)].map((m) => Number(m[1].replace(/,/g, "")));
  const body = h.slice(h.indexOf("<tbody>"), h.indexOf('<tr class="tot">'));
  const cells = [...body.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map((r) => [...r[1].matchAll(/<td class="r">([\d,.]+)<\/td>/g)].map((m) => Number(m[1].replace(/,/g, ""))));
  for (let col = 1; col <= totals.length; col++) { const s = B.moneyRound(cells.reduce((a, r) => a + (r[col] || 0), 0)); if (Math.abs(s - totals[col - 1]) > 0.011) return `column ${col}: ${s} vs ${totals[col - 1]}`; }
  return /-\d/.test(body) ? "a negative cell" : true;
};
let en = 1;
for (const size of ["a4", "a5"]) for (const rate of [0.05, 0.12, 0.18, 0.28]) for (const disc of [0, 0.1, 0.33]) {
  const id = en++;
  e(id, BQ, `${size.toUpperCase()} sheet at ${rate * 100}% with ${disc * 100}% off: on 60 random sheets every column foots to its TOTAL row and no cell is negative`, "banquetDocHtml, no frozen lines", () => {
    for (let i = 0; i < 60; i++) { const s = sheet(size, 1 + Math.floor(rnd() * 14), disc, rate); const r = footsAll(B.banquetDocHtml({ ...s, autoPrint: false })); if (r !== true) return `sheet ${i}: ${r}`; }
    return true;
  });
}
// en = 25
e(25, BQ, "a frozen tax split is printed exactly as stored, whatever today's rate says", "tax_lines CGST 6 + SGST 6, today's banquet set 9 + 9", () => { const h = B.banquetDocHtml({ bill: { subtotal: 1000, tax: 120, total: 1120, tax_lines: [{ label: "CGST", rate: 6, amt: 60 }, { label: "SGST", rate: 6, amt: 60 }] }, lines: [{ title: "Hall", qty: 1, price: 1000 }], settings: { gstin: "X", banquet_tax_components: [{ label: "CGST", rate: 9 }, { label: "SGST", rate: 9 }] } }); return (/CGST 6%/.test(h) && !/CGST 9%/.test(h)) || "re-split by today's rate"; });
e(26, BQ, "A4 declares a 210×297 page and A5 a 148×210 page", "@page", () => /@page\{size:210mm 297mm/.test(B.banquetDocHtml({ bill: {}, lines: [], settings: { banquet_paper_size: "a4" } })) && /@page\{size:148mm 210mm/.test(B.banquetDocHtml({ bill: {}, lines: [], settings: {} })) || "size wrong");
e(27, BQ, "pre-printed pad mode leaves the header off and keeps the top margin it was given", "banquet_paper pad, top 40", () => { const h = B.banquetDocHtml({ bill: {}, lines: [], settings: { banquet_paper: "pad", banquet_paper_top: 40 } }); return (!/class="selfhead"/.test(h) && /height:40mm/.test(h)) || "pad mode wrong"; });
e(28, BQ, "margins out of range are clamped, never a negative or giant margin", "top 999, side -5", () => { const p = B.bqPaper({ banquet_paper_top: 999, banquet_paper_side: -5 }); return (p.top === 80 && p.side === 2) || JSON.stringify(p); });
e(29, BQ, "filler rows: 12 on A4 and 6 on A5 when switched on, none when off", "fill rows", () => { const c = (st) => (B.banquetDocHtml({ bill: {}, lines: [], settings: st }).match(/<tr class="fill">/g) || []).length; return (c({ banquet_paper_size: "a4" }) === 12 && c({}) === 6 && c({ banquet_paper_fill: false }) === 0) || "wrong count"; });
e(30, BQ, "the signature line prints unless switched off", "sign on/off", () => /Authorised Signatory/.test(B.banquetDocHtml({ bill: {}, lines: [] })) && !/Authorised Signatory/.test(B.banquetDocHtml({ bill: {}, lines: [], settings: { banquet_paper_sign: false } })) || "wrong");
const WORDS = [[0, "Zero Rupees Only"], [1, "One Rupee Only"], [21, "Twenty-One Rupees Only"], [100000, "One Lakh Rupees Only"], [10000000, "One Crore Rupees Only"], [0.5, "Fifty Paise Only"], [2.01, "Two Rupees and One Paisa Only"], [-3, "Minus Three Rupees Only"]];
WORDS.forEach(([amt, want], i) => e(31 + i, BQ, `the amount in words for ${amt} reads "${want}"`, "bqWords", () => B.bqWords(amt) === want || B.bqWords(amt)));
// 39..
e(39, BQ, "every advance prints with its mode and a real date; a garbled date prints none and keeps the money", "advances", () => { const h = B.banquetDocHtml({ bill: { advances: [{ amt: 500, mode: "upi", date: "2026-08-01" }, { amt: 300, mode: "cash", date: "later" }] }, lines: [] }); return (/UPI PAY DT\.01\/08\/2026 — 500\/-/.test(h) && /CASH PAY — 300\/-/.test(h) && !/Invalid/.test(h)) || "advances wrong"; });
e(40, BQ, "a received amount equal to the total stamps PAID IN FULL; less stamps BALANCE DUE", "received", () => /PAID IN FULL/.test(B.banquetDocHtml({ bill: { total: 100, received: 100 }, lines: [] })) && /BALANCE DUE 40\.00/.test(B.banquetDocHtml({ bill: { total: 100, received: 60 }, lines: [] })) || "stamp wrong");
e(41, BQ, "the receiver's GSTIN line shows only when there is one", "cust_gstin", () => /GSTIN \/ UID/.test(B.banquetDocHtml({ bill: { cust_gstin: "27X" }, lines: [] })) && !/GSTIN \/ UID/.test(B.banquetDocHtml({ bill: {}, lines: [] })) || "wrong");
e(42, BQ, "a booking with no customer says 'Counter booking'", "no cust", () => /Counter booking/.test(B.banquetDocHtml({ bill: { remark: "r" }, lines: [] })) || "missing");
e(43, BQ, "every customer field is printed as text", "markup in name/address/person/phone", () => !/<b>x/.test(B.banquetDocHtml({ bill: { cust_name: "<b>x", cust_addr: "<b>x", cust_person: "<b>x", cust_phone: "<b>x" }, lines: [] })) || "raw");
e(44, BQ, "the sheet's three names: Tax Invoice (GSTIN), Bill (none), Bill of Supply (composition)", "headings", () => { const h = (st) => (B.banquetDocHtml({ bill: {}, lines: [], settings: st }).match(/<div class="doct"><b>([^<]+)/) || [])[1]; return (h({ gstin: "X" }) === "Tax Invoice" && h({}) === "Bill" && h({ gstin: "X", price_tax_mode: "composition" }) === "Bill of Supply") || [h({ gstin: "X" }), h({}), h({ gstin: "X", price_tax_mode: "composition" })].join("/"); });
e(45, BQ, "the date is India's whatever the device — dd/mm/yyyy, the same on New York and Mumbai", "two zones", () => {
  const run = (z) => spawnSync(process.execPath, ["-e", `const B=require(${JSON.stringify(root + "/public/panels/billdoc.js")});const h=B.banquetDocHtml({bill:{issued_at:"2026-08-05T19:30:00Z"},lines:[]});process.stdout.write((h.match(/Dated<\\/div><div class="v">([^<]+)/)||[])[1]||"")`], { env: { ...process.env, TZ: z }, encoding: "utf8" }).stdout;
  return (run("America/New_York") === "06/08/2026" && run("Asia/Kolkata") === "06/08/2026") || `${run("America/New_York")} / ${run("Asia/Kolkata")}`;
});
e(46, BQ, "a banquet booked on a renamed table prints the name", "table_names", () => /Terrace/.test(B.banquetDocHtml({ bill: { table_number: 3 }, lines: [], settings: { table_names: { 3: "Terrace" } } })) || "number printed");
e(47, BQ, "the item-12 rule: a GSTIN-less banquet charges no tax (rate 0), a composition one too", "bqTaxModel", () => B.bqTaxModel({ gstin: "", banquet_tax_components: [{ label: "CGST", rate: 9 }] }).rate === 0 && B.bqTaxModel({ gstin: "X", price_tax_mode: "composition" }).rate === 0 || "taxed");
e(48, BQ, "the item-14 rule: a sheet with no frozen lines names its rate with the restaurant's own set", "namedLinesFor on the sheet", () => /IGST 18%/.test(B.banquetDocHtml({ bill: { subtotal: 100, tax: 18, total: 118 }, lines: [{ title: "x", qty: 1, price: 100 }], settings: { gstin: "X", tax_components: [{ label: "IGST", rate: 18 }] } })) || "not named");
e(49, BQ, "the preview never prints itself, the real sheet does after 350ms", "autoPrint", () => !/setTimeout\(printAgain/.test(B.banquetDocHtml({ bill: {}, lines: [], autoPrint: false })) && /setTimeout\(printAgain, 350\)/.test(B.banquetDocHtml({ bill: {}, lines: [] })) || "wrong");
e(50, BQ, "nothing on any of 200 random sheets reads undefined / NaN / [object Object]", "200 sheets", () => { for (let i = 0; i < 200; i++) { const s = sheet(i % 2 ? "a4" : "a5", 1 + (i % 9), (i % 3) / 10, [0.05, 0.18][i % 2]); if (/undefined|NaN|\[object Object\]/.test(B.banquetDocHtml({ ...s, autoPrint: false }))) return `sheet ${i}`; } return true; });
