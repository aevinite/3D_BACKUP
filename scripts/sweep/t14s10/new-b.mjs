// Bank B — the paper a print helper is handed, and the printing board's words.
//   lib/printDocs.ts       (P183121–P183200) — had ONE ledger row by subject before sweep #10
//   lib/printBoard.ts      (P183201–P183230) — had two
//   lib/printBoardWords.ts (P183231–P183270) — had one
// The builders are DRIVEN against the dev database (SELECTs only — they read, they never write), so
// a row here is the real function producing the real piece of paper for a real French House bill.
import { sec, read, imp, sql, code, block, NO_DB } from "./lib.mjs";

// The builders reach the database through lib/supabaseAdmin, which reads process.env. Point it at the
// DEV project only — refuseUnlessDevTestDb throws on anything else before a single read is made.
const env = Object.fromEntries(read(".env.local").split(/\r?\n/).map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i)).filter(Boolean).map((m) => [m[1], m[2].replace(/^["']|["']$/g, "")]));
const { refuseUnlessDevTestDb } = await imp("scripts/sweep/devStacks.mjs");
refuseUnlessDevTestDb(env.NEXT_PUBLIC_SUPABASE_URL, "sweep #10 T14 bank B (read-only)");
process.env.NEXT_PUBLIC_SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
process.env.SUPABASE_SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

const PDS = read("lib/printDocs.ts");
const PD = await imp("lib/printDocs.ts");
const BILLDOC = (await imp("public/panels/billdoc.js")).default;
const FH = "00000000-0000-0000-0000-000000000001";
const AANGAN = "6c6fadb6-da23-4ab3-9f90-d164773f60b3";
const F = "lib/printDocs.ts";
const c = sec(183120);
const dbOnly = (fn) => async () => (NO_DB ? { skip: "--no-db" } : fn());

// ── kotTableLabel — "T7", never "Table 7"; the name when the owner set one; "T?" when there is none ──
const L = PD.kotTableLabel;
const LBL = [
  [1, "a plain table number reads T7", { table_number: 7 }, null, "T7"],
  [2, "a table stored as text reads the same", { table_number: "7" }, {}, "T7"],
  [3, "a table the owner named prints its name", { table_number: "5" }, { 5: "Terrace 2" }, "Terrace 2"],
  [4, "a name of spaces falls back to T5", { table_number: "5" }, { 5: "   " }, "T5"],
  [5, "no table at all (a banquet left blank) reads T?", { table_number: null }, {}, "T?"],
  [6, "an empty string reads T?, never a bare T", { table_number: "" }, {}, "T?"],
  [7, "spaces around a number are trimmed", { table_number: " 9 " }, null, "T9"],
  [8, "a name is trimmed too", { table_number: "3" }, { 3: "  Patio " }, "Patio"],
  [9, "a table_names that is not an object is ignored", { table_number: "4" }, "oops", "T4"],
];
for (const [n, what, ord, names, want] of LBL) c(n, F, `kotTableLabel: ${what}`, `kotTableLabel(${JSON.stringify(ord)}, ${JSON.stringify(names)})`, () => L(ord, names) === want || `got ${JSON.stringify(L(ord, names))}`);
c(10, F, "kotTableLabel agrees with the kitchen board's tlong() for every shape (the parity verify:print-helper holds)", "the kitchen's rule written out and run over the same inputs", () => {
  const tlong = (t, names) => (t == null || t === "" ? "T?" : ((names && typeof names === "object" && names[String(t).trim()] && String(names[String(t).trim()]).trim()) || `T${String(t).trim()}`));
  const bad = LBL.filter(([, , o, nm]) => L(o, nm) !== tlong(o.table_number == null ? null : String(o.table_number).trim(), nm));
  return bad.length === 0 || `disagree on ${bad.map((b) => b[0]).join(",")}`;
});

// ── withPaper — the page size a helper's headless Chrome is told, and the column narrowed to fit ──
const KOT = BILLDOC.kotDocHtml({ kot: 1, lines: [{ qty: 1, title: "Dal" }] });
const BILL = BILLDOC.billDocHtml({ lines: [{ title: "Dal", qty: 1, price: 100 }], subtotal: 100, total: 105, taxRows: [{ label: "GST", rate: 5, amt: 5 }] });
const BQ = BILLDOC.banquetDocHtml({ bill: { subtotal: 100, tax: 5, total: 105 }, lines: [] });
c(11, F, "withPaper: no paper known → the document is returned untouched", "withPaper(html, null)", () => PD.withPaper(KOT, null) === KOT || "changed");
c(12, F, "withPaper: a document that declares its own page size (the banquet sheet) is left alone", "withPaper(banquet, 80mm)", () => PD.withPaper(BQ, { wMm: 79.7, hMm: 64.2 }) === BQ || "the A4/A5 size was overridden");
c(13, F, "withPaper: an 80mm roll gets the page size and NO narrowing (66mm stays 66mm)", "withPaper(kot, 79.7×64.2)", () => { const h = PD.withPaper(KOT, { wMm: 79.7, hMm: 64.2 }); return (/@page\{size:79\.7mm 64\.2mm;margin:0\}/.test(h) && !/@media print\{html body\{width/.test(h)) || "wrong rule"; });
c(14, F, "withPaper: a 58mm roll narrows the column to 48mm and centres it", "withPaper(bill, 57.8×64.2)", () => /html body\{width:48mm !important;margin:0 auto !important\}/.test(PD.withPaper(BILL, { wMm: 57.8, hMm: 64.2 })) || "not 48mm centred");
c(15, F, "withPaper: …and on 58mm a column heading may not break over two lines", "thead nowrap rule present", () => /thead td,thead th\{font-size:10px !important;white-space:nowrap/.test(PD.withPaper(BILL, { wMm: 57.8, hMm: 64.2 })) || "headings can wrap");
c(16, F, "withPaper: the rule goes LAST, after the document's own 66mm rule (or the 66mm wins)", "position of the injected <style> in the bill fragment", () => { const h = PD.withPaper(BILL, { wMm: 57.8, hMm: 64.2 }); return h.lastIndexOf("@page{size:57.8mm") > h.lastIndexOf("width:66mm !important") || "injected before the document's own rule"; });
c(17, F, "withPaper: on a full document it goes just before </body>", "kot doc", () => { const h = PD.withPaper(KOT, { wMm: 57.8, hMm: 64.2 }); return /@page\{size:57\.8mm 64\.2mm;margin:0\}[^<]*<\/style><\/body>/.test(h.replace(/@media print\{[^}]*\}[^}]*\}[^}]*\}[^}]*\}/, "")) || h.indexOf("</body>") > h.indexOf("@page{size:57.8mm") || "not before </body>"; });
c(18, F, "withPaper: an absurdly narrow paper is floored at a 30mm column, never 0", "withPaper(kot, 20mm)", () => /width:30mm !important/.test(PD.withPaper(KOT, { wMm: 20, hMm: 50 })) || "no floor");
c(19, F, "withPaper: A4 handed to a thermal ticket keeps the 66mm column (never wider than drawn)", "withPaper(kot, A4)", () => !/html body\{width/.test(PD.withPaper(KOT, { wMm: 210, hMm: 297 })) || "widened past 66mm");

// ── testHtml / testBand / the sample documents — never mistaken for a sale ──
c(20, F, "testHtml escapes every value it prints", "a printer named <b>&\"", () => { const h = PD.testHtml({ restaurant: "<i>", printer: '<b>&"', agent: "a", when: "now" }); return (!/<b>&"/.test(h) && /&lt;b&gt;&amp;&quot;/.test(h)) || "raw markup on the test page"; });
c(21, F, "testHtml says nothing was charged or recorded", "read the page", () => /Nothing was charged and nothing was recorded as a sale/.test(PD.testHtml({ restaurant: "r", printer: "p", agent: "a", when: "w" })) || "missing");
const sampleK = NO_DB ? "" : await PD.sampleKotHtml(FH);
const sampleB = NO_DB ? "" : await PD.sampleBillHtml(FH);
const sampleQ = NO_DB ? "" : await PD.sampleBanquetHtml(FH);
c(22, F, "the sample KOT carries the TEST PRINT band, top and bottom", "sampleKotHtml(French House)", dbOnly(() => (/TEST PRINT — NOT A BILL/.test(sampleK) && /End of test print/.test(sampleK)) || "band missing"));
c(23, F, "…and the band sits INSIDE <body>, after it opens (a full document)", "position", dbOnly(() => sampleK.indexOf("TEST PRINT") > sampleK.indexOf("<body>") || "band before <body>"));
c(24, F, "the sample KOT is NOT branded DUPLICATE (it would teach a cook the wrong thing)", "read it", dbOnly(() => !/Reprint · Duplicate/i.test(sampleK) || "branded DUPLICATE"));
c(25, F, "the sample BILL's band comes AFTER the doctype (the quirks-mode blank page, 2026-09-14)", "the bill is a fragment with no <body>", dbOnly(() => sampleB.startsWith("<!doctype html>") && sampleB.indexOf("TEST PRINT") > sampleB.lastIndexOf("</style>") || "band ahead of the doctype or inside the style"));
c(26, F, "the sample BILL carries NO number — no Invoice row, no Bill no row", "read it", dbOnly(() => (!/<span>Invoice<\/span>/.test(sampleB) && !/<span>Bill no<\/span>/.test(sampleB)) || "a number was printed on a test"));
c(27, F, "the sample BILL's rows add up: subtotal ₹1,555 and a TOTAL that is not ₹0", "read the money", dbOnly(() => (/Subtotal<\/span><span>₹1,555</.test(sampleB) && !/TOTAL<\/span><span>₹0</.test(sampleB)) || "the sample does not add up"));
c(28, F, "the sample BILL's TOTAL is subtotal + the restaurant's own tax, to the rupee", "billMoney over the same synthetic order", dbOnly(async () => {
  const s = (await sql(`select tax_rate, tax_components, price_tax_mode from settings where restaurant_id='${FH}'`))[0] || {};
  const m = BILLDOC.billMoney([{ status: "served", subtotal: 1555, taxable_base: 1555, discount: 0, items: [] }], s);
  return new RegExp(`TOTAL</span><span>₹${Math.round(m.total).toLocaleString("en-IN")}<`).test(sampleB) || `expected ₹${Math.round(m.total)}`;
}));
c(29, F, "the sample BANQUET sheet carries the band and no bill number", "sampleBanquetHtml", dbOnly(() => (/TEST PRINT/.test(sampleQ) && /Invoice No\.<\/div><div class="v">—</.test(sampleQ)) || "band or number wrong"));
c(30, F, "the sample BANQUET sheet is taxed at the restaurant's own banquet rate, not 0%", "tax row vs bqTaxModel", dbOnly(async () => {
  const s = (await sql(`select tax_rate, tax_components, banquet_tax_components, price_tax_mode from settings where restaurant_id='${FH}'`))[0] || {};
  const tm = BILLDOC.bqTaxModel(s);
  return tm.pct > 0 ? (/GST 0%|0%<\/span>/.test(sampleQ) ? "printed 0%" : true) : { ok: true, note: "restaurant charges 0% — nothing to show" };
}));
c(31, F, "sampleHtmlFor sends each kind to its own builder", "kot/bill/banquet → the three samples", dbOnly(async () => (/KITCHEN TICKET/.test(await PD.sampleHtmlFor(FH, "kot")) && /class="kind"/.test(await PD.sampleHtmlFor(FH, "bill")) && /Tax Invoice/.test(await PD.sampleHtmlFor(FH, "banquet"))) || "a kind reached the wrong builder"));
c(32, F, "the band is injected AFTER the document is built — billdoc.js never learns tests exist", "no `test` flag anywhere in billdoc.js", () => !/\btest\s*:/.test(code(read("public/panels/billdoc.js"))) || "billdoc.js carries a test flag");

// ── every read in the file is scoped to the restaurant that asked ──
const froms = [...PDS.matchAll(/sb\.from\("([a-z_]+)"\)\.select\(([^)]*)\)([^;]*?)(?:\.maybeSingle\(\)|\.limit\(\d+\))/g)];
c(33, F, "every database read in the file is scoped by restaurant_id (or is the restaurants row itself, by id)", `${froms.length} reads found`, () => {
  const bad = froms.filter((m) => !(m[1] === "restaurants" ? /\.eq\("id", rid\)/.test(m[3]) : /\.eq\("restaurant_id", rid\)/.test(m[3])));
  return (froms.length >= 14 && bad.length === 0) || `${froms.length} reads, unscoped: ${bad.map((m) => m[1]).join(", ")}`;
});
c(34, F, "every read names its columns, except a single row read by id (session, restaurant, banquet bill)", "select(\"*\") only on a .maybeSingle() by id", () => {
  const star = froms.filter((m) => /"\*"/.test(m[2]));
  const bad = star.filter((m) => !/maybeSingle/.test(m[0]) && !(m[1] === "orders" && /\.limit\(500\)/.test(m[0])));
  return bad.length === 0 || bad.map((m) => m[1]).join(", ");
});
c(35, F, "the one list read (a bill's orders) is bounded at 500 — a silent 1,000 cap would drop food", "billHtmlForSession orders read", () => /from\("orders"\)\.select\("\*"\)\.eq\("session_id", sessionId\)\.eq\("restaurant_id", rid\)\.limit\(500\)/.test(PDS) || "unbounded");
c(36, F, "the restaurant a builder prints for always comes from the print helper's own token, never the request", "every builder call in the print-agent route passes agent.restaurant_id", () => {
  const r = read("app/api/print-agent/[...path]/route.ts");
  const calls = [...r.matchAll(/(kotHtmlForOrder|billHtmlForSession|banquetHtmlForBill|sampleHtmlFor|kotHtmlForAggregator)\(([^,]+),/g)];
  const bad = calls.filter((m) => m[2].trim() !== "agent.restaurant_id");
  return (calls.length >= 5 && bad.length === 0) || `${calls.length} calls; other first argument: ${bad.map((m) => m[2]).join(", ")}`;
});
c(37, F, "…and that token is checked before any job is read", "whoIsAsking(req) precedes the job read in each handler", () => {
  const r = read("app/api/print-agent/[...path]/route.ts");
  return /const agent = await whoIsAsking\(req\);[\s\S]{0,600}if \(!agent\)/.test(r) || "no early refusal visible";
});
c(38, F, "the print job itself is read back scoped to that restaurant before its paper is built", "print_jobs read .eq(restaurant_id, agent.restaurant_id)", () => /\.eq\("id", seg\[1\]\)\.eq\("restaurant_id", agent\.restaurant_id\)\.maybeSingle\(\)/.test(read("app/api/print-agent/[...path]/route.ts")) || "job read not scoped");
c(39, F, "a first automatic kitchen slip is queued CLEAN (reprint false) — only a manual tap is DUPLICATE", "mig 335's trigger insert", () => /INSERT INTO print_jobs \(restaurant_id, kind, order_id, reprint, requested_by\)\s*VALUES \(NEW\.restaurant_id, 'kot', NEW\.id, false, 'Auto-print'\)/.test(read("supabase/migrations/335_a_kitchen_ticket_queues_itself.sql")) || "the trigger no longer says false");
c(40, F, "every app-side kitchen-slip insert decides the DUPLICATE banner on purpose (never the column's default)", "7 print_jobs inserts each name `reprint`", () => {
  const files = ["app/api/tablet/[...path]/route.ts", "app/api/kitchen/[...path]/route.ts", "app/api/editor/[...path]/route.ts", "lib/printHelpers.ts"];
  const bad = [];
  for (const f of files) { const t = read(f); for (const m of t.matchAll(/from\("print_jobs"\)\.insert\(\{([\s\S]{0,700}?)\}\)/g)) if (!/reprint/.test(m[1])) bad.push(f); }
  return bad.length === 0 || `an insert leaves it to the default (true = DUPLICATE): ${bad.join(", ")}`;
});

// ── the builders against REAL French House rows ──
const realSess = NO_DB ? [] : await sql(`select s.id from sessions s where s.restaurant_id='${FH}' and s.status='closed' and exists (select 1 from orders o where o.session_id=s.id and o.deleted_at is null and o.status<>'cancelled') order by s.closed_at desc limit 40`);
c(41, F, "billHtmlForSession builds a real closed French House bill", "the newest closed bill with food", dbOnly(async () => { const h = await PD.billHtmlForSession(FH, realSess[0].id); return (h && /TOTAL<\/span><span>₹/.test(h)) || "no document"; }));
c(42, F, "…and that printed TOTAL equals the database's own figure (SUM of net_amount) on 40 real bills", "billHtmlForSession vs SQL, to the rupee", dbOnly(async () => {
  const bad = [];
  for (const { id } of realSess) {
    const h = await PD.billHtmlForSession(FH, id);
    const shown = Number(((h || "").match(/TOTAL<\/span><span>₹([\d,]+)</) || [])[1]?.replace(/,/g, ""));
    const db = (await sql(`select round(coalesce(sum(net_amount),0))::int t from orders where session_id='${id}' and deleted_at is null and status<>'cancelled'`))[0].t;
    if (shown !== db) bad.push(`${id.slice(0, 8)} paper ₹${shown} db ₹${db}`);
  }
  return bad.length === 0 ? { ok: true, note: `${realSess.length} bills, paper = database on every one` } : bad.slice(0, 4).join(" · ");
}));
c(43, F, "the helper's bill names the invoice number it carries (when it has one), not the bill number", "an invoiced session", dbOnly(async () => {
  const s = (await sql(`select s.id, s.invoice_no, s.bill_no from sessions s where s.restaurant_id='${FH}' and s.invoice_no is not null and s.invoice_no < 100000 and exists (select 1 from orders o where o.session_id=s.id and o.deleted_at is null and o.status<>'cancelled') order by s.closed_at desc nulls last limit 1`))[0];
  if (!s) return { skip: "no invoiced bill on French House" };
  const h = await PD.billHtmlForSession(FH, s.id);
  return (new RegExp(`/${String(s.invoice_no).padStart(6, "0")}<`).test(h) && !/<span>Bill no<\/span>/.test(h)) || "wrong number row";
}));
c(44, F, "billHtmlForSession answers nothing for a session that is not this restaurant's", "an Aangan session asked for under French House", dbOnly(async () => {
  const s = (await sql(`select id from sessions where restaurant_id='${AANGAN}' limit 1`))[0];
  if (!s) return { skip: "Aangan has no session" };
  return (await PD.billHtmlForSession(FH, s.id)) === null || "printed another restaurant's bill";
}));
c(45, F, "billHtmlForSession answers nothing for an unknown session", "a random uuid", dbOnly(async () => (await PD.billHtmlForSession(FH, "00000000-0000-0000-0000-00000000dead")) === null || "printed something"));
c(46, F, "the helper's bill carries no toolbar and no script — nobody is looking at it", "noBar", dbOnly(async () => { const h = await PD.billHtmlForSession(FH, realSess[0].id); return (!/class="bar"/.test(h) && !/<script/.test(h)) || "toolbar or script in a headless print"; }));
c(47, F, "…and it never prints itself (there is no window to open a dialog in)", "no setTimeout(printAgain", dbOnly(async () => !/printAgain/.test(await PD.billHtmlForSession(FH, realSess[0].id)) || "auto-print in a headless print"));
const realOrd = NO_DB ? [] : await sql(`select id, kot_no from orders where restaurant_id='${FH}' and deleted_at is null and status<>'cancelled' and kot_no is not null and created_at < now() - interval '1 hour' order by created_at desc limit 1`);   // an hour old: other terminals create and clean up test orders all day
c(48, F, "kotHtmlForOrder builds a real French House ticket with its own KOT number", "a live order at least an hour old", dbOnly(async () => { const h = await PD.kotHtmlForOrder(FH, realOrd[0].id, false); return (h && h.includes(`KOT #${realOrd[0].kot_no}<`)) || "wrong or no ticket"; }));
c(49, F, "…a reprint flag brands it DUPLICATE, a first print does not", "both ways on the same order", dbOnly(async () => (/Reprint · Duplicate/.test(await PD.kotHtmlForOrder(FH, realOrd[0].id, true)) && !/Reprint · Duplicate/.test(await PD.kotHtmlForOrder(FH, realOrd[0].id, false))) || "banner not decided by the flag"));
c(50, F, "kotHtmlForOrder refuses a cancelled order — no food on the rail nobody ordered", "a cancelled French House order", dbOnly(async () => {
  const o = (await sql(`select id from orders where restaurant_id='${FH}' and status='cancelled' limit 1`))[0];
  if (!o) return { skip: "no cancelled order" };
  return (await PD.kotHtmlForOrder(FH, o.id, false)) === null || "printed a cancelled order";
}));
c(51, F, "kotHtmlForOrder refuses a soft-deleted order", "a tombstoned order", dbOnly(async () => {
  const o = (await sql(`select id from orders where restaurant_id='${FH}' and deleted_at is not null limit 1`))[0];
  if (!o) return { skip: "no tombstoned order on French House" };
  return (await PD.kotHtmlForOrder(FH, o.id, false)) === null || "printed a deleted order";
}));
c(52, F, "kotHtmlForOrder answers nothing for another restaurant's order", "an Aangan order asked for under French House", dbOnly(async () => {
  const o = (await sql(`select id from orders where restaurant_id='${AANGAN}' limit 1`))[0];
  if (!o) return { skip: "Aangan has no order" };
  return (await PD.kotHtmlForOrder(FH, o.id, false)) === null || "printed another restaurant's ticket";
}));
c(53, F, "the delivery-ticket labels match the kitchen board's PLAT_META, channel for channel", "PLAT_LABEL vs kitchen/app.js", () => {
  const k = read("public/panels/kitchen/app.js");
  const pairs = [["zomato", "ZOMATO"], ["swiggy", "SWIGGY"], ["takeaway", "WEBSITE"], ["parcel", "PARCEL"], ["other", "PLATFORM"]];
  const bad = pairs.filter(([src, lbl]) => !new RegExp(`${src}:\\s*\\{ label: "${lbl}"`).test(k) || !new RegExp(`${src}: "${lbl}"`).test(PDS));
  return bad.length === 0 || `disagree on ${bad.map((b) => b[0]).join(", ")}`;
});
const realAgg = NO_DB ? [] : await sql(`select id, source, customer_name, kot_no from aggregator_orders where restaurant_id='${FH}' and status<>'cancelled' order by created_at desc limit 1`);
c(54, F, "kotHtmlForAggregator builds a real delivery ticket labelled CHANNEL · customer", "the newest live platform order", dbOnly(async () => {
  if (!realAgg.length) return { skip: "no platform order on French House" };
  const h = await PD.kotHtmlForAggregator(FH, realAgg[0].id, false);
  const lbl = { zomato: "ZOMATO", swiggy: "SWIGGY", takeaway: "WEBSITE", parcel: "PARCEL" }[realAgg[0].source] || "PLATFORM";
  return (h && h.includes(lbl)) || "label missing";
}));
c(55, F, "banquetHtmlForBill builds a real French House banquet sheet, or there is none to build", "the newest banquet_bills row", dbOnly(async () => {
  const b = (await sql(`select id, bill_no from banquet_bills where restaurant_id='${FH}' order by created_at desc limit 1`))[0];
  if (!b) return { skip: "no banquet bill on French House" };
  const h = await PD.banquetHtmlForBill(FH, b.id);
  return (h && /Tax Invoice/.test(h) && /INVOICE TOTAL/.test(h)) || "no sheet";
}));
c(56, F, "banquetHtmlForBill answers nothing for another restaurant's sheet", "any other restaurant's banquet bill asked for under French House", dbOnly(async () => {
  const b = (await sql(`select id from banquet_bills where restaurant_id <> '${FH}' limit 1`))[0];
  if (!b) return { skip: "no other restaurant has a banquet bill" };
  return (await PD.banquetHtmlForBill(FH, b.id)) === null || "printed another restaurant's sheet";
}));
c(57, F, "the banquet read selects the sheet's paper settings (the A5-instead-of-A4 fault)", "BANQUET_PAPER_COLUMNS in both banquet reads", () => (PDS.match(/BANQUET_PAPER_COLUMNS\}/g) || []).length === 2 || "a banquet read lost its paper columns");
c(58, F, "the loyalty block is asked for only when the bill has a phone (no extra read otherwise)", "read billHtmlForSession", () => /if \(custPhone\) \{\s*const st = await loyaltyStateFor/.test(PDS) || "loyalty asked for without a phone");
c(59, F, "the points a bill promises come from the same settledTotalOf() the settle uses", "read", () => /const total = await settledTotalOf\(rid, sessionId\);/.test(PDS) || "a second total");
c(60, F, "restName strips the asterisks some names carry and falls back to 'Kitchen'", "read restName", () => /replace\(\/\\\*\/g, ""\)\.trim\(\) \|\| "Kitchen"/.test(PDS) || "changed");
c(61, F, "a sample is never built from a real customer's row (no session/order id is read)", "sample builders read only settings + restaurants", () => {
  const s = block(PDS, /export async function sampleKotHtml/) + block(PDS, /export async function sampleBillHtml/) + block(PDS, /export async function sampleBanquetHtml/);
  return !/from\("(orders|sessions|banquet_bills|aggregator_orders)"\)/.test(s) || "a sample reads a real sale";
});
c(62, F, "the sample banquet's tax rounds by the one exact paisa rule — or it is noted as a sample-only difference", "round2 in sampleBanquetHtml", () => /const round2 = \(n: number\) => Math\.round\(n \* 100\) \/ 100;/.test(PDS)
  ? { ok: true, note: "float rounding on a TEST sheet only (no sale, no screen to disagree with) — listed in Part 4" } : true);

// ── lib/printBoard.ts ──
const PB = read("lib/printBoard.ts");
const B = "lib/printBoard.ts";
const b = sec(183200);
b(1, B, "it holds no gate of its own and says so — every caller is behind its own door", "header + callers", () => /It holds no gate of its own/.test(PB) || "header changed");
b(2, B, "the admin caller checks the admin token before it reads the board", "app/api/admin/printing route: tokenIsValid before printBoardState", () => { const r = read("app/api/admin/printing/[...path]/route.ts"); const t = r.indexOf("tokenIsValid"), p = r.indexOf("printBoardState("); return (t >= 0 && p > t) || "no token check before the board read"; });
b(3, B, "the panel caller takes the restaurant from requireRole, never from the request", "editor route: printBoardState(rid…) inside a requireRole'd handler", () => { const r = read("app/api/editor/[...path]/route.ts"); return (/requireRole/.test(r) && /printBoardState\(rid/.test(r)) || "printBoardState not fed the session's rid"; });
b(4, B, "the owner caller is scoped by ownerScope", "app/api/owner/printing/route.ts", () => { const r = read("app/api/owner/printing/route.ts"); return /ownerScope/.test(r) || "no ownerScope"; });
b(5, B, "every board read is scoped to one restaurant", "settings + print_jobs reads", () => (PB.match(/\.eq\("restaurant_id", rid\)/g) || []).length >= 2 || "unscoped read");
b(6, B, "the job list asks for between 5 and 30 rows, whatever a caller passes", "Math.min(30, Math.max(5, …))", () => /Math\.min\(30, Math\.max\(5, opts\?\.recent \?\? 12\)\)/.test(PB) || "unclamped");
b(7, B, "the job list names its columns", "JOB_COLS", () => /select\(JOB_COLS\)/.test(PB) && /const JOB_COLS = "id, kind, status, printer, printed_by, attempts, error, created_at, done_at";/.test(PB) || "changed");
b(8, B, "the WAITING total is the sum of the per-printer rows — one read, never a second count", "waiting = waitingBy.reduce", () => /waiting: waitingBy\.reduce\(\(n, q\) => n \+ q\.n, 0\)/.test(PB) && !/waitingCount\(/.test(code(PB)) || "a second count is back");
b(9, B, "'stopped' is read from modules.printing.paused === true only", "paused derivation", () => /m\.printing\.paused === true/.test(PB) || "changed");
b(10, B, "printing.allowed/on are true only when the setting is literally true", "=== true", () => /allowed: s\.auto_print_kot_allowed === true, on: s\.auto_print_kot === true/.test(PB) || "truthy reads");
b(11, B, "'this computer' is found only for a non-empty device id", "dv ? … : null", () => /thisComputer: dv \? agents\.find\(\(a\) => a\.owner_device === dv\) \|\| null : null/.test(PB) || "changed");
b(12, B, "the setup code itself is never sent — only whether one is live and until when", "setupCode type has no `code`", () => /setupCode: \{ live: boolean; expiresAt: string \| null; oldFileAt: string \| null \}/.test(PB) || "the board shape changed");
b(13, B, "the helper and station files hold no secret — only the site address", "helperFiles/stationFiles take origin only", () => /helperScript\(os, \{ origin \}\)/.test(PB) && /stationScript\(os, \{ origin, panel \}\)/.test(PB) || "a file builder takes more than the site");
b(14, B, "there is NO `mode` on the board (owner, 2026-08-31: \"we don't need toggle\")", "BoardState keys", () => !/^\s*mode\??:/m.test(code(PB)) || "a mode field is back");
b(15, B, "the board's words come from printBoardWords, not a copy", "re-exports + imports", () => /from "@\/lib\/printBoardWords"/.test(PB) || "words copied in");
b(16, B, "every board read runs in one Promise.all, not one after another", "nine reads in one Promise.all", () => /const \[agents, routes, setRow, jobs, stuck, setupCode, kinds, waitingBy, live\] = await Promise\.all\(\[/.test(PB) || "reads serialised");
const PBW = await imp("lib/printBoardWords.ts");
b(17, B, "the board drives for French House and every field has the documented type", "printBoardState(French House)", dbOnly(async () => {
  const PBM = await imp("lib/printBoard.ts");
  const st = await PBM.printBoardState(FH);
  const ok = Array.isArray(st.agents) && typeof st.waiting === "number" && typeof st.paused === "boolean" && Array.isArray(st.recent) && st.recent.length <= 12 && typeof st.stuck.afterMs === "number" && !("mode" in st);
  return ok || JSON.stringify(Object.keys(st));
}));
b(18, B, "…and its WAITING total equals the rows beneath it", "waiting vs sum(waitingBy)", dbOnly(async () => { const st = await (await imp("lib/printBoard.ts")).printBoardState(FH); return st.waiting === st.waitingBy.reduce((n, q) => n + q.n, 0) || `${st.waiting} vs rows`; }));
b(19, B, "…and every recent job it shows is French House's own", "print_jobs ids vs SQL restaurant", dbOnly(async () => {
  const st = await (await imp("lib/printBoard.ts")).printBoardState(FH);
  if (!st.recent.length) return { skip: "no jobs" };
  const ids = st.recent.map((j) => `'${j.id}'`).join(",");
  const r = await sql(`select count(*)::int n from print_jobs where id in (${ids}) and restaurant_id <> '${FH}'`);
  return r[0].n === 0 || `${r[0].n} job(s) from another restaurant`;
}));
b(20, B, "…and a recent=999 request is held to 30", "printBoardState(FH, {recent: 999})", dbOnly(async () => (await (await imp("lib/printBoard.ts")).printBoardState(FH, { recent: 999 })).recent.length <= 30 || "more than 30"));
void PBW;

// ── lib/printBoardWords.ts ──
const W = "lib/printBoardWords.ts";
const WS = read(W);
const w = sec(183230);
w(1, W, "the file imports nothing — the admin console (a client page) imports it", "no import statement", () => !/^\s*import\s/m.test(WS) || "it imports something");
const WAIT = [[0, ""], [-5, ""], [null, ""], [30_000, "under a minute"], [59_999, "under a minute"], [600_000, "10 minutes"], [7_200_000, "2 hours"], [172_800_000, "2 days"], [86_400_000, "a whole day"], [3 * 86_400_000 + 1, "3 days"]];
let wn = 2;
for (const [ms, want] of WAIT) { const n0 = wn++; w(n0, W, `waitedWords(${ms}) reads "${want}"`, "run it", () => PBW.waitedWords(ms) === want || `got "${PBW.waitedWords(ms)}"`); }
// wn = 12
w(12, W, "waitedWords never stops at hours past a day ('76 hours' was the owner's complaint)", "76h", () => PBW.waitedWords(76 * 3_600_000) === "3 days" || PBW.waitedWords(76 * 3_600_000));
w(13, W, "waitedWords says '1 minutes' / '1 hours' at exactly one unit — a grammar slip on the admin Printing screen", "60_000 and 3_600_000", () => PBW.waitedWords(60_000) === "1 minutes" ? { ok: true, note: "true today; the manager panel carries a hand-kept twin (fmtWaited) outside this boundary — a fix must change both, listed in Part 4" } : true);
w(14, W, "waitedShort fits the all-restaurants list: 'min', 'h', 'd'", "three cases", () => PBW.waitedShort(600_000) === "10 min" && PBW.waitedShort(7_200_000) === "2h" && PBW.waitedShort(172_800_000) === "2d" || "changed");
const NOW = new Date("2026-10-12T12:00:00+05:30");
w(15, W, "whenWords: a job from today shows only the clock", "today 09:15 IST", () => /^0?9:15\s?(am|AM)$/.test(PBW.whenWords("2026-10-12T09:15:00+05:30", NOW)) || PBW.whenWords("2026-10-12T09:15:00+05:30", NOW));
w(16, W, "whenWords: yesterday says Yesterday", "yesterday 21:00 IST", () => /^Yesterday · /.test(PBW.whenWords("2026-10-11T21:00:00+05:30", NOW)) || PBW.whenWords("2026-10-11T21:00:00+05:30", NOW));
w(17, W, "whenWords: older says the day, and no year inside the same year", "3 Oct", () => /^3 Oct · /.test(PBW.whenWords("2026-10-03T21:00:00+05:30", NOW)) || PBW.whenWords("2026-10-03T21:00:00+05:30", NOW));
w(18, W, "whenWords: a different year says the year", "Dec 2025", () => /2025 · /.test(PBW.whenWords("2025-12-30T21:00:00+05:30", NOW)) || PBW.whenWords("2025-12-30T21:00:00+05:30", NOW));
w(19, W, "whenWords: 00:30 IST is TODAY in Mumbai even though it is yesterday in UTC", "2026-10-12T00:30 IST", () => !/Yesterday/.test(PBW.whenWords("2026-10-12T00:30:00+05:30", NOW)) || "the browser's midnight was used");
w(20, W, "whenWords: nothing or garbage reads '' — never 'Invalid Date'", "null / 'x'", () => PBW.whenWords(null) === "" && PBW.whenWords("x") === "" || "printed something");
w(21, W, "isPrinterState accepts exactly the four states", "four yes, others no", () => ["ready", "paused", "offline", "unknown"].every(PBW.isPrinterState) && !PBW.isPrinterState("Ready") && !PBW.isPrinterState(null) || "wrong");
w(22, W, "'unknown' is its own state and never reads as offline (an old helper must not send someone to a working printer)", "PRINTER_STATE_WORDS.unknown", () => PBW.PRINTER_STATE_WORDS.unknown.label === "Not reported" && PBW.PRINTER_STATE_WORDS.unknown.label !== PBW.PRINTER_STATE_WORDS.offline.label || "folded into offline");
w(23, W, "only 'ready' is ok", "ok flags", () => Object.entries(PBW.PRINTER_STATE_WORDS).every(([k, v]) => v.ok === (k === "ready")) || "wrong ok flag");
w(24, W, "every state carries a 'why' that says what to do", "non-empty why", () => Object.values(PBW.PRINTER_STATE_WORDS).every((v) => v.why.length > 15) || "a state has no explanation");
w(25, W, "the banquet sheet offers no paper choice here — its size lives on the Banquet screen", "papersFor('banquet')", () => PBW.papersFor("banquet").length === 0 && /Banquet screen/.test(PBW.PAPER_ELSEWHERE.banquet) || "a dead dropdown is back");
w(26, W, "kitchen slips and bills get every preset", "papersFor kot/bill", () => PBW.papersFor("kot").length === PBW.PAPER_PRESETS.length && PBW.papersFor("bill").length === PBW.PAPER_PRESETS.length || "presets missing");
w(27, W, "'As the printer says' is first and carries no size", "PAPER_PRESETS[0]", () => PBW.PAPER_PRESETS[0].id === "auto" && PBW.PAPER_PRESETS[0].paper === null || "changed");
w(28, W, "the 80mm and 58mm presets match the sizes withPaper was measured on (79.7 / 57.8)", "preset widths", () => PBW.PAPER_PRESETS.find((p) => p.id === "roll80").paper.wMm === 79.7 && PBW.PAPER_PRESETS.find((p) => p.id === "roll58").paper.wMm === 57.8 || "changed");
w(29, W, "paperLabel says 'as the printer says' for no size and 'W × H mm' for one", "two cases", () => PBW.paperLabel(null) === "as the printer says" && PBW.paperLabel({ wMm: 80, hMm: 60 }) === "80 × 60 mm" || "changed");
w(30, W, "'Nobody' on the bill line is worded honestly — a window still opens", "KIND_OFF_LABEL.bill", () => /window opens/.test(PBW.KIND_OFF_LABEL.bill) && /do not print by themselves/.test(PBW.KIND_OFF_LABEL.kot) || "the off wording lies");
w(31, W, "the restaurant's words, never ours: no label says 'kot'", "KIND_LABEL values", () => !Object.values(PBW.KIND_LABEL).some((v) => /\bkot\b/i.test(v)) || "jargon on screen");
w(32, W, "step one is the numbered string the manager panel asserts", "STEPS.one", () => PBW.STEPS.one === "1 · Is printing switched on" || PBW.STEPS.one);
w(33, W, "the three who-prints answers are computer / screen / nobody", "WHO_CHOICES ids", () => PBW.WHO_CHOICES.map((x) => x.id).join() === "computer,screen,off" || "changed");
w(34, W, "the two ways each have a title, a what, and an on/off sentence", "WAYS", () => ["computer", "screen"].every((k) => PBW.WAYS[k].title && PBW.WAYS[k].what && PBW.WAYS[k].onWhat && PBW.WAYS[k].offWhat) || "a way is missing a sentence");
w(35, W, "the times are India's (Asia/Kolkata), stated once", "const IST", () => /const IST = "Asia\/Kolkata";/.test(WS) || "changed");
