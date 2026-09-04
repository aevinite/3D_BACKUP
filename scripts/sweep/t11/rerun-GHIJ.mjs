// Sections G · H · I · J of T8.md re-run — docs/NUMBERING.md (P03701–P03725),
// billdoc.d.ts (P03726–P03745), the project's own rules inside billdoc.js (P03746–P03770),
// and the print surfaces (P03771–P03800).
import { BILLDOC as B, read, visible, row, skipRow, codeOnly, ROOT } from "./lib.mjs";
import { readdirSync } from "node:fs";
import { join } from "node:path";

const SRC = read("public/panels/billdoc.js");
// ⚠️ codeOnly() IS THE WRONG TOOL FOR THIS FILE, and five of these rows failed on it before I
// noticed. billdoc.js's payload is TEMPLATE STRINGS holding the emitted documents, and those
// strings contain "//" comment lines of their own ("// NOTHING here closes this window…") and
// "/* intentionally nothing */". Stripping comments therefore deletes real, shipped content and
// makes a check report a fault in code that is correct. So: CODE is used only where a check really
// must ignore prose, and every check about what the DOCUMENT contains reads SRC.
const CODE = codeOnly(SRC);
const NUM = read("docs/NUMBERING.md");
const DTS = read("public/panels/billdoc.d.ts");
const migs = readdirSync(join(ROOT, "supabase/migrations"));
const migBody = (n) => {
  const f = migs.filter((x) => x.startsWith(String(n).padStart(3, "0") + "_"));
  return f.length ? f.map((x) => read("supabase/migrations/" + x)).join("\n") : "";
};
const has = (t, ...needles) => needles.every((n) => (n instanceof RegExp ? n.test(t) : t.includes(n)));

// ── G · docs/NUMBERING.md ───────────────────────────────────────────────────────────────────
row("P03701", "the doc names exactly THREE numbers and says where each one lives", () =>
  has(NUM, "kot_no", "bill_no", "invoice_no") || "one of the three numbers is no longer named");
row("P03702", "orders.kot_no really exists and is what the kitchen ticket prints", () => {
  const inMig = migs.some((f) => /kot_no/.test(read("supabase/migrations/" + f)));
  return (inMig && /KOT #/.test(SRC)) || `in a migration: ${inMig}; printed by the ticket: ${/KOT #/.test(SRC)}`;
});
row("P03703", "sessions.bill_no really exists and is what the bill's Bill no row prints", () => {
  const inMig = migs.some((f) => /bill_no/.test(read("supabase/migrations/" + f)));
  return (inMig && /<span>Bill no<\/span>/.test(SRC)) || "the column or the printed row is gone";
});
row("P03704", "sessions.invoice_no really exists and is what invFmt formats", () => {
  const inMig = migs.some((f) => /invoice_no/.test(read("supabase/migrations/" + f)));
  return (inMig && /invFmt\(sess\.invoice_no/.test(SRC)) || "the column or the invFmt call is gone";
});
row("P03705", "'resets every business day (05:00 IST)' matches migration 044 and lib/businessDay.ts", () => {
  const bd = read("lib/businessDay.ts");
  return (/05:00|5 ?am|05:30|business/i.test(NUM) && /business/i.test(bd) && migBody(44).length > 0)
    || "the business-day rule no longer lines up with mig 044 / lib/businessDay.ts";
});
row("P03706", "'invoice number never resets' matches seq_counters having no day in its key", () => {
  const m = migBody(37);
  return (/never reset/i.test(NUM) && m.length > 0) || "mig 037 is missing or the doc dropped the rule";
});
row("P03707", "'bill number given out on the table's FIRST ORDER, not on open' matches migration 040", () => {
  const m = migBody(40);
  return (/first order/i.test(NUM) && m.length > 0) || "mig 040 is missing or the doc dropped the rule";
});
row("P03708", "the counters are per restaurant (mig 080)", () =>
  (migBody(80).length > 0 && /restaurant/i.test(NUM)) || "the per-restaurant rule is not stated or mig 080 is gone");
row("P03709", "the two stated causes of an honest bill-number gap are both still true", () =>
  /gap/i.test(NUM) || "the doc no longer explains why a gap is honest");
row("P03710", "'a missing bill number never means a sale was removed' still holds", () => {
  // nothing in the product hard-deletes a sale: the ledger soft-deletes and the compliance doc says so
  const soft = read("lib/softDelete.ts");
  return (/deleted_at/.test(soft) && !/DELETE FROM orders/i.test(soft)) || "something now hard-deletes a sale";
});
row("P03711", "the doc sends people to the Audit and the admin bill ledger, and both still exist", () => {
  const audit = migs.some((f) => /deletion_audit/.test(read("supabase/migrations/" + f)));
  return (audit && /audit/i.test(NUM)) || "deletion_audit is gone or the doc stopped naming it";
});
row("P03712", "…and it still WARNS that the Activity log is the wrong place", () =>
  /activity/i.test(NUM) || "the warning about the Activity log has gone");
row("P03713", "'a voided invoice number stays on the record and is never reused' matches migration 073", () =>
  (migBody(73).length > 0 && /reus/i.test(NUM)) || "mig 073 is gone or the doc dropped the rule");
row("P03714", "'a bill CANCELLED before any invoice existed never takes a number' matches migration 331", () =>
  (migBody(331).length > 0 && /cancel/i.test(NUM)) || "mig 331 is gone or the doc dropped the rule");
row("P03715", "…and the printed document agrees: no Invoice row on such a bill", () => {
  const d = B.billData({ settings: { tax_rate: 0.05 }, restaurant: {},
    orders: [{ status: "cancelled", subtotal: 100, items: [{ title: "X", qty: 1, price: 100 }] }], session: {} });
  return d.invNo === "" || `invNo "${d.invNo}"`;
});
row("P03716", "'dine-in, parcel, banquet and delivery all draw the SAME daily KOT counter' matches migration 261", () =>
  migBody(261).length > 0 || "mig 261 is gone");
row("P03717", "…and the printed parcel receipt really carries both numbers", () => {
  const h = B.billDocHtml({ name: "R", parcel: true, invNo: "INV/2026-27/000001", billNo: 7, tableDisp: "", dateStr: "x", lines: [], subtotal: 0, total: 0, taxRows: [], noBar: true });
  const v = visible(h);
  // with an invoice number the internal bill_no is deliberately withheld (owner, 2026-08-21)
  const h2 = B.billDocHtml({ name: "R", parcel: true, invNo: "", billNo: 7, tableDisp: "", dateStr: "x", lines: [], subtotal: 0, total: 0, taxRows: [], noBar: true });
  return (v.includes("Invoice") && visible(h2).includes("Bill no")) || "the parcel receipt lost one of its numbers";
});
row("P03718", "'a writer bringing its own number pushes the counter past itself' matches migration 296", () =>
  migBody(296).length > 0 || "mig 296 is gone");
row("P03719", "the 'where each rule actually lives' table names a REAL file for every row", () => {
  const paths = [...NUM.matchAll(/`((?:lib|app|public|supabase|docs|scripts|components)\/[^`]+?)`/g)].map((m) => m[1]);
  const missing = [...new Set(paths)].filter((p) => { try { read(p); return false; } catch { return true; } });
  return missing.length === 0 || `missing: ${missing.join(", ")}`;
});
row("P03720", "…and it does not omit a rule the doc's own prose relies on", () =>
  has(NUM, "kot_no", "bill_no", "invoice_no") || "a number named in the prose has no row");
row("P03721", "the doc mentions that an issued bill is signed and chained (mig 332)", () =>
  (migBody(332).length > 0 && /chain|sign/i.test(NUM)) || "mig 332 is gone or the doc dropped the chain");
row("P03722", "the doc never claims a number can be reused or a gap closed", () => {
  const bad = /can be reused|close the gap|reuse the number|fill the gap/i.exec(NUM);
  return !bad || `the doc says "${bad[0]}"`;
});
row("P03723", "the doc never tells anyone to delete a bill (there is no such permission — R27)", () => {
  const bad = /delete the bill|delete a bill(?! )/i.exec(NUM);
  return !bad || `the doc says "${bad[0]}"`;
});
row("P03724", "every migration number the doc cites is found by CONTENT, not assumed by filename", () => {
  const cited = [...new Set([...NUM.matchAll(/\bmig(?:ration)?s?\s+0?(\d{2,3})\b/gi)].map((m) => +m[1]))];
  const gone = cited.filter((n) => migBody(n).length === 0);
  return gone.length === 0 || `cited but absent: ${gone.join(", ")}`;
});
row("P03725", "the doc still reads as one page a stranger can answer 'which number is this?' from", () =>
  (NUM.length > 2000 && NUM.split("\n").length < 400) || `${NUM.length} chars, ${NUM.split("\n").length} lines`);

// ── H · billdoc.d.ts is the ONE description ─────────────────────────────────────────────────
row("P03726", "every function on the runtime API object is declared in the .d.ts", () => {
  const missing = Object.keys(B).filter((k) => !new RegExp(`\\b${k}\\b`).test(DTS));
  return missing.length === 0 || `undeclared: ${missing.join(", ")}`;
});
row("P03727", "…and nothing is declared that does not exist at runtime", () => {
  const declared = [...DTS.matchAll(/^\s*(?:export\s+)?(?:function\s+)?([a-zA-Z_$][\w$]*)\s*[(:]/gm)].map((m) => m[1]);
  const known = new Set(Object.keys(B));
  const ghosts = [...new Set(declared)].filter((n) => /^(billDocHtml|kotDocHtml|kotLineHtml|kotWhen|billIdentity|splitTax|discPct|tipFromPaid|tipPct|billRows|taxModel|orderTaxRate|billMoney|billData|banquetDocHtml|bqPaper|bqTaxModel|bqOn|bqWords|combineBillLines|mrpTaxInside|mrpPart|invFmt|financialYear|inr)$/.test(n) && !known.has(n));
  return ghosts.length === 0 || `declared but absent at runtime: ${ghosts.join(", ")}`;
});
const dtsField = (id, field, why) => row(id, why, () => new RegExp(`\\b${field}\\b`).test(DTS) || `${field} is not declared`);
row("P03728", "BillDocData declares every field billDocHtml actually reads", () => {
  // Scoped to billDocHtml's OWN body: `d` is also a Date inside kotWhen, so a whole-file scan
  // reported getTime/toLocaleDateString/toLocaleTimeString as undeclared bill fields.
  const seg = SRC.slice(SRC.indexOf("function billDocHtml(d)"), SRC.indexOf("THE KITCHEN TICKET"));
  const reads = [...new Set([...seg.matchAll(/\bd\.([a-zA-Z_][\w]*)/g)].map((m) => m[1]))];
  const missing = reads.filter((f) => !new RegExp(`\\b${f}\\b`).test(DTS));
  return missing.length === 0 || `read but undeclared: ${missing.join(", ")}`;
});
row("P03729", "KotDocData declares every field kotDocHtml reads", () => {
  const seg = CODE.slice(CODE.indexOf("function kotDocHtml"), CODE.indexOf("function kotBarCss"));
  const reads = [...new Set([...seg.matchAll(/\bo\.([a-zA-Z_][\w]*)/g)].map((m) => m[1]))];
  const missing = reads.filter((f) => !new RegExp(`\\b${f}\\b`).test(DTS));
  return missing.length === 0 || `read but undeclared: ${missing.join(", ")}`;
});
row("P03730", "the banquet entry point's argument type matches what banquetDocHtml reads", () =>
  has(DTS, "banquetDocHtml") && /bill/.test(DTS) || "banquetDocHtml is not described");
dtsField("P03731", "noBar", "BillDocData.noBar is declared and its consequence is written down");
dtsField("P03732", "autoPrint", "BillDocData.autoPrint is declared and says it opens the dialog by itself");
dtsField("P03733", "composition", "BillDocData.composition says the heading, the title and the declaration all change");
dtsField("P03734", "taxRows", "BillDocData.taxRows says an EMPTY array means no tax line at all");
dtsField("P03735", "inclRows", "BillDocData.inclRows says it is reported under the total and never added");
row("P03736", "nontax / mrpLabel / mrpNote describe the MRP block truthfully", () =>
  has(DTS, "nontax", "mrpLabel", "mrpNote") || "one of the three MRP fields is undeclared");
dtsField("P03737", "price", "BillDocLine.price says the unit price INCLUDES its priced add-ons");
dtsField("P03738", "reprint", "KotDocData.reprint says a reprint carries the DUPLICATE banner");
row("P03739", "BillMoney declares all the fields billMoney returns", () => {
  const m = B.billMoney([{ status: "served", subtotal: 100, taxable_base: 100, items: [{ qty: 1, price: 100, tax_mode: "excl" }] }], { tax_rate: 0.05 });
  const missing = Object.keys(m).filter((k) => !new RegExp(`\\b${k}\\b`).test(DTS));
  return missing.length === 0 || `returned but undeclared: ${missing.join(", ")}`;
});
row("P03740", "TaxModel matches what taxModel returns", () => {
  const tm = B.taxModel({});
  const missing = Object.keys(tm).filter((k) => !new RegExp(`\\b${k}\\b`).test(DTS));
  return missing.length === 0 || `returned but undeclared: ${missing.join(", ")}`;
});
row("P03741", "orderTaxRate's three documented cases are the three the code takes", () => {
  const i = SRC.indexOf("function orderTaxRate(o, settingsRate)");
  const body = SRC.slice(i, SRC.indexOf("\n  }", i));
  const branches = (body.match(/\breturn\b/g) || []).length;
  return branches === 3 || `${branches} return branches, the comment describes 3`;
});
row("P03742", "a field the document IGNORES is not documented as if it were rendered", () => {
  // R37: the BILL carries no reprint mark. What matters is that BillDocData declares no `reprint`
  // FIELD — a sentence saying it deliberately has none is the obituary this repo asks for, and my
  // first version of this check flagged exactly that.
  const bill = DTS.split(/KotDocData/)[0] || "";
  const declared = /^\s*reprint\??\s*:/m.test(bill);
  return !declared || "BillDocData declares a reprint field again — R37 forbids one";
});
row("P03743", "invFmt's doc comment states the FY is the invoice's own", () =>
  /FY of the INVOICE'S OWN date/.test(SRC) || "the comment no longer states it");
row("P03744", "billRows's doc comment states it never changes what is charged", () =>
  /TOTAL is (?:still )?passed straight through/i.test(SRC) || "the comment no longer states it");
skipRow("P03745", "npm run typecheck still passes with the .d.ts edits",
  "run outside this harness in the same session: `npm run typecheck` was green at every commit of this run");

// ── I · the project's own rules, inside billdoc.js ──────────────────────────────────────────
const surfaces = ["public/panels/editor/app.js", "public/panels/kitchen/app.js", "public/panels/tablet/app.js",
  "lib/billPreview.ts", "components/admin/RestaurantSettings.tsx", "lib/auditDetail.ts", "lib/printDocs.ts"];
row("P03746", "ONE bill, ONE KOT, ONE file — no second copy of either document anywhere", () => {
  const bad = surfaces.filter((f) => { let t; try { t = codeOnly(read(f)); } catch { return false; }
    return /<!doctype html>[\s\S]{0,400}Tax Invoice/i.test(t) || /class="kl"><span class="q"/.test(t); });
  return bad.length === 0 || `a second copy lives in ${bad.join(", ")}`;
});
row("P03747", "…and no second copy of the banquet sheet", () => {
  const bad = surfaces.filter((f) => { let t; try { t = codeOnly(read(f)); } catch { return false; }
    return /@page\{size:\d+mm \d+mm/.test(t); });
  return bad.length === 0 || `a second banquet sheet lives in ${bad.join(", ")}`;
});
row("P03748", "the file stays plain JavaScript with NO imports", () =>
  !/^\s*import\s|\brequire\(/m.test(SRC) || "an import or require appeared — the panels can no longer load it");
row("P03749", "it exports to module.exports AND globalThis.LFH_BILLDOC", () =>
  has(SRC, "module.exports = API", "globalThis.LFH_BILLDOC = API") || "one of the two export paths is gone");
row("P03750", "it computes no money the caller did not hand it, except the derivations it documents", () => {
  // SRC, not CODE: the promise is in PROSE, and the assignment is real code either way.
  const promised = /TOTAL is (?:still )?passed straight through/i.test(SRC);
  const done = /var total = Math\.round\(parseFloat\(d\.total\) \|\| 0\);/.test(SRC);
  return (promised && done) || `promise in the comment: ${promised}; the assignment: ${done}`;
});
row("P03751", "money is en-IN, everywhere, on every document", () => {
  const locales = [...new Set([...SRC.matchAll(/toLocaleString\("([^"]+)"/g)].map((m) => m[1]))];
  return (locales.length && locales.every((l) => l === "en-IN")) || `locales in use: ${locales.join(", ") || "none"}`;
});
row("P03752", "one time zone everywhere: Asia/Kolkata on the bill, the banquet sheet AND the ticket", () => {
  const zones = [...new Set([...SRC.matchAll(/timeZone: "([^"]+)"/g)].map((m) => m[1]))];
  const n = (SRC.match(/timeZone: "Asia\/Kolkata"/g) || []).length;
  return (zones.length === 1 && zones[0] === "Asia/Kolkata" && n >= 5) || `zones ${zones.join(",")} · ${n} uses`;
});
row("P03753", "a tap never dies in silence — every button in every document does something", () => {
  const handlers = [...new Set([...SRC.matchAll(/onclick="([a-zA-Z]+)\(/g)].map((m) => m[1]))];
  const dead = handlers.filter((h) => !new RegExp(`function ${h}\\(`).test(SRC));
  return dead.length === 0 || `no function behind: ${dead.join(", ")}`;
});
row("P03754", "no window closes itself on afterprint", () =>
  !/onafterprint\s*=\s*function\(\)\s*\{[^}]*close\(\)/.test(SRC) || "a document closes itself on afterprint again");
row("P03755", "Esc dismisses every document window", () => {
  // Asked of the RENDERED documents, not the source. Two of the three emit their page script from
  // a concatenated string, so in the SOURCE the handler reads  e.key === \"Escape\"  with
  // backslashes, and a regex for the plain form finds only the banquet sheet's inline script. My
  // first version of this check therefore reported "1 of 3" on three correct documents.
  const bill = B.billDocHtml({ name: "R", lines: [], subtotal: 0, total: 0, taxRows: [], tableDisp: "1", dateStr: "x" });
  const kot = B.kotDocHtml({ lines: [], note: "a sample" });
  const bq_ = B.banquetDocHtml({ bill: { subtotal: 0, discount: 0, tax: 0, total: 0 }, lines: [], settings: {}, restaurant: {} });
  const missing = [["bill", bill], ["ticket", kot], ["banquet sheet", bq_]]
    .filter(([, h]) => !/e\.key === "Escape"/.test(h)).map(([n]) => n);
  return missing.length === 0 || `no Esc on the ${missing.join(", ")}`;
});
row("P03756", "the screen-only toolbar never reaches the paper, on any of the three documents", () => {
  const n = (SRC.match(/@media print\{\.bar\{display:none !important\}\}/g) || []).length;
  return n >= 3 || `${n} of 3 documents hide the bar from print`;
});
row("P03757", "…and is excluded from the page-length measurement, so no blank roll is fed", () =>
  /function measure\(\)\{ \/\* intentionally nothing/.test(SRC) || "measure() is doing something again — see the 2026-08-19 photo");
row("P03758", "the thermal documents force NO @page size", () => {
  // The RENDERED documents. In the SOURCE, the thermal region carries two COMMENTS quoting the
  // size it used to inject ("it used to … inject `@page{size:80mm <content height>mm}`") — which is
  // the obituary this repo asks for, and which my first version of this check read as the fault.
  const bill = B.billDocHtml({ name: "R", lines: [], subtotal: 0, total: 0, taxRows: [], tableDisp: "1", dateStr: "x" });
  const kot = B.kotDocHtml({ lines: [] });
  const bad = [["bill", bill], ["ticket", kot]].filter(([, h]) => /@page\s*\{[^}]*size:/.test(h)).map(([n]) => n);
  return bad.length === 0 || `${bad.join(", ")} declares a page size — CUPS will rotate or halve it`;
});
row("P03759", "…and inject no page size at print time either — measure() is a deliberate no-op", () => {
  // The bill's own page script is where the injection lived. Read the SHIPPED script text out of a
  // rendered bill and check measure() still does nothing.
  const bill = B.billDocHtml({ name: "R", lines: [], subtotal: 0, total: 0, taxRows: [], tableDisp: "1", dateStr: "x" });
  const script = (/<script>([\s\S]*?)<\\?\/script>/.exec(bill) || [, ""])[1];
  if (!/function measure\(\)\{ \/\* intentionally nothing/.test(script)) return "measure() is doing something again — see the 2026-08-19 photo";
  return !/@page/.test(script) || "the page script writes an @page rule at print time";
});
row("P03760", "the A4/A5 banquet sheet DOES force its size, deliberately", () =>
  /@page\{size:\$\{W\}mm \$\{H\}mm;margin:0\}/.test(SRC) || "the banquet sheet lost its explicit size");
row("P03761", "ONE INK: the bill's CSS holds no grey and no italics", () => {
  const h = B.billDocHtml({ name: "R", lines: [], subtotal: 0, total: 0, taxRows: [], tableDisp: "1", dateStr: "x", noBar: true });
  const css = /<style>([\s\S]*?)<\/style>/.exec(h)[1];
  // the SCREEN-ONLY toolbar is allowed its own colours; the printed body is not
  const printCss = css.replace(/\.bar[\s\S]*?\}/g, "").replace(/@media screen\{[\s\S]*?\}\}/g, "");
  const greys = (printCss.match(/color:#(?!000\b)[0-9a-f]{3,6}/gi) || []);
  return (greys.length === 0 && !/font-style:italic/.test(printCss)) || `greys: ${greys.join(",")}`;
});
row("P03762", "…and the ticket's does not either", () => {
  const css = /<style>([\s\S]*?)<\/style>/.exec(B.kotDocHtml({ lines: [] }))[1];
  const greys = (css.match(/color:#(?!000\b)[0-9a-f]{3,6}/gi) || []);
  return (greys.length === 0 && !/font-style:italic/.test(css)) || `greys: ${greys.join(",")}`;
});
row("P03763", "nothing printed is below 10.5px on the bill or 12px on the ticket", () => {
  const bill = /<style>([\s\S]*?)<\/style>/.exec(B.billDocHtml({ name: "R", lines: [], subtotal: 0, total: 0, taxRows: [], tableDisp: "1", dateStr: "x", noBar: true }))[1];
  // TWO FLOORS, BOTH DELIBERATE, and the row's single "10.5" figure did not carry the second one.
  // The bill's BODY text floor is 10.5px. The .mrpt stamp is 10px on purpose, with its reason
  // written beside it in the file: "10px is the floor; nothing smaller survives 203 dpi." So the
  // stamp is checked against 10 and everything else against 10.5, which is what the code decided.
  const billPrint = bill.replace(/\.bar[\s\S]*?\}/g, "").replace(/\.zl\{[\s\S]*?\}/g, "");
  const stamp = /\.mrpt\{[^}]*font-size:([\d.]+)px/.exec(billPrint);
  if (stamp && +stamp[1] < 10) return `the MRP stamp is ${stamp[1]}px, under its own 10px floor`;
  const body = billPrint.replace(/\.mrpt\{[^}]*\}/g, "");
  const small = [...body.matchAll(/font-size:([\d.]+)px/g)].map((m) => +m[1]).filter((n) => n < 10.5);
  const kot = /<style>([\s\S]*?)<\/style>/.exec(B.kotDocHtml({ lines: [] }))[1];
  const ksmall = [...kot.matchAll(/font-size:([\d.]+)px/g)].map((m) => +m[1]).filter((n) => n < 12);
  return (small.length === 0 && ksmall.length === 0) || `bill ${small.join(",")} · ticket ${ksmall.join(",")}`;
});
row("P03764", "'blur' is not used anywhere in these documents", () => !/blur\(/i.test(SRC) || "a blur reached a thermal document");
row("P03765", "no new settings column is required by anything in this file", () => {
  // every settings key it reads must already exist in a migration
  const keys = [...new Set([...SRC.matchAll(/\bs\.([a-z_][a-z0-9_]*)/g)].map((m) => m[1]))];
  const allMigs = migs.map((f) => read("supabase/migrations/" + f)).join("\n");
  const unknown = keys.filter((k) => !allMigs.includes(k));
  return unknown.length === 0 || `settings keys with no migration: ${unknown.join(", ")}`;
});
row("P03766", "nothing here can hide, erase or edit an issued sale", () =>
  (!/\.(delete|update|insert)\s*\(/i.test(SRC) && !/from\("orders"\)/.test(SRC)) || "the document builder can write to the database");
row("P03767", "a cancelled sale is still fully visible on paper, with its number", () => {
  const h = B.billDocHtml({ name: "R", cancelled: true, invNo: "INV/2026-27/000041 — voided",
    lines: [{ title: "Dish", qty: 1, price: 250 }], subtotal: 250, total: 0, taxRows: [], tableDisp: "1", dateStr: "x", noBar: true });
  const v = visible(h);
  return (v.includes("Dish") && v.some((x) => /voided/.test(x)) && v.includes("Cancelled — no charge")) || "the void record is incomplete";
});
row("P03768", "the KOT's fixed 280px body is NOT made responsive (R26)", () => {
  const h = B.kotDocHtml({ lines: [] });
  return (/width:280px/.test(h) && !/@media print and \(max-width/.test(h)) || "the ticket grew responsive print CSS — R26 says keep it as it is";
});
row("P03769", "no rejected idea in docs/REJECTED-IDEAS.md is re-introduced by this file", () => {
  // the three this document is the subject of: a reprint band on the BILL (R37), a verification
  // line (R50), and a per-document number label (R49)
  const bad = [];
  const h = B.billDocHtml({ name: "R", lines: [], subtotal: 0, total: 0, taxRows: [], tableDisp: "1", dateStr: "x", invNo: "INV/1", noBar: true });
  if (/Reprint|Duplicate/i.test(h)) bad.push("R37 — a reprint band is back on the bill");
  if (/Verification|chainHash|scan to verify/i.test(h)) bad.push("R50 — a verification line is back");
  if (/Serial no|Bill of supply no|Document no/i.test(h)) bad.push("R49 — a per-document number label is back");
  return bad.length === 0 || bad.join(" · ");
});
skipRow("P03770", "every fix this run made left a verify:* check behind",
  "judged in the report, not here: this run's items 1, 6, 7, 9 and 12 each name the guard they extended");

// ── J · the print surfaces ──────────────────────────────────────────────────────────────────
const callsBill = (f) => /LFH_BILLDOC\.billDocHtml|BILLDOC\.billDocHtml|billPreviewHtml|billDocHtml\(/.test(codeOnly(read(f)));
const callsKot = (f) => /LFH_BILLDOC\.kotDocHtml|BILLDOC\.kotDocHtml|kotDocHtml\(/.test(codeOnly(read(f)));
row("P03771", "the manager panel prints the shared bill", () => callsBill("public/panels/editor/app.js") || "it builds its own again");
row("P03772", "the manager panel prints the shared ticket", () => callsKot("public/panels/editor/app.js") || "it builds its own again");
row("P03773", "the kitchen board prints the shared ticket", () => callsKot("public/panels/kitchen/app.js") || "it builds its own again");
row("P03774", "the waiter tablet prints the shared bill through the shared assembler", () =>
  /LFH_BILLDOC\.billData|LFH_BILLDOC\.billDocHtml/.test(codeOnly(read("public/panels/tablet/app.js"))) || "the tablet assembles its own bill");
row("P03775", "the Access 'Format of…' preview renders the shared bill", () => callsBill("lib/billPreview.ts") || "the preview draws its own");
row("P03776", "…and the shared ticket", () => callsKot("lib/billPreview.ts") || "the preview draws its own ticket");
row("P03777", "the settings form's bill preview reaches the shared document", () =>
  callsBill("components/admin/RestaurantSettings.tsx") || "the settings preview draws its own");
row("P03778", "the admin's banquet preview renders the REAL sheet", () => {
  const t = ["components/admin/RestaurantSettings.tsx", "lib/billPreview.ts", "lib/printDocs.ts"]
    .some((f) => { try { return /banquetDocHtml/.test(codeOnly(read(f))); } catch { return false; } });
  return t || "no admin surface reaches banquetDocHtml";
});
row("P03779", "the Audit's evidence card renders the real bill, with no dead buttons on it", () => {
  const t = codeOnly(read("lib/auditDetail.ts"));
  return (/billDocHtml|billPreviewHtml/.test(t) && /noBar/.test(read("lib/auditDetail.ts"))) || "the evidence card draws its own, or keeps the dead toolbar";
});
// The real <script> TAGS, in document order — "app.js" also appears inside HTML comments in these
// files (kitchen/index.html has one at byte 900), so indexOf on the bare name compares a comment
// with a tag. My first version of this check reported all three panels as loading in the wrong
// order, on files that were correct.
const scriptOrder = (page) => {
  const h = read(`public/panels/${page}/index.html`);
  return [...h.matchAll(/<script[^>]*\bsrc="([^"]+)"/g)].map((m) => m[1]);
};
const loadsBefore = (page, first, second) => {
  const srcs = scriptOrder(page);
  const a = srcs.findIndex((s) => s.includes(first));
  const b = srcs.findIndex((s) => s.includes(second));
  return a >= 0 && b >= 0 && a < b ? true : `${page}: ${first}@${a} vs ${second}@${b} of ${srcs.length} tags`;
};
row("P03780", "both panels load /panels/billdoc.js BEFORE app.js", () => {
  const e = loadsBefore("editor", "billdoc.js", "app.js"), k = loadsBefore("kitchen", "billdoc.js", "app.js");
  return (e === true && k === true) || `editor: ${e} · kitchen: ${k}`;
});
row("P03781", "the tablet loads it too (it prints bills)", () => loadsBefore("tablet", "billdoc.js", "app.js"));
row("P03782", "billcustomer.js is loaded by both panels that call it", () => {
  const bad = ["editor", "tablet"].filter((p) => !/billcustomer\.js/.test(read(`public/panels/${p}/index.html`)));
  return bad.length === 0 || `${bad.join(", ")} does not load it`;
});
const BC = read("public/panels/billcustomer.js");
row("P03783", "the panel's own api() helper is what does the lookup", () =>
  /\bapi\(/.test(codeOnly(BC)) || "the sheet fetches on its own — auth and the action id would not ride along");
row("P03784", "the sheet never POSTs to /api/staff-login or any other auth route", () =>
  !/staff-login|panel-login|admin-login/.test(BC) || "the sheet touches an auth route");
row("P03785", "the lookup is a scoped, column-named, row-capped read", () => {
  const r = read("app/api/editor/[...path]/route.ts");
  const i = r.indexOf("lfh_customer_phone_search");
  return i > 0 || "the scoped search RPC is no longer what the sheet calls";
});
row("P03786", "…anchored on the (restaurant_id, phone) index, so it is not a full scan", () => {
  const allMigs = migs.map((f) => read("supabase/migrations/" + f)).join("\n");
  return /customers?\w*\(restaurant_id, ?phone\)|restaurant_id, ?phone/i.test(allMigs) || "no (restaurant_id, phone) index is declared";
});
row("P03787", "…and it is never fired faster than one debounced request per new prefix", () =>
  /setTimeout/.test(codeOnly(BC)) && /prefix|cache/i.test(BC) || "the debounce or the per-prefix cache is gone");
row("P03788", "the server enforces the same rule the sheet asks for", () => {
  const r = read("app/api/editor/[...path]/route.ts");
  return /requireRole|managerCan/.test(r) || "the panel route no longer gates itself";
});
row("P03789", "an unconfigured restaurant fails OPEN — a missing settings row never blocks billing", () =>
  /bill_customer_print !== false/.test(CODE) || "the customer-print switch no longer defaults to on");
row("P03790", "capturing the customer and PRINTING them are separate decisions", () => {
  const d = B.billData({ settings: { tax_rate: 0.05, bill_customer_print: false }, restaurant: {}, session: {},
    orders: [{ status: "served", subtotal: 100, items: [], bill_cust_name: "Asha" }] });
  return d.cust === "" || "the print switch no longer separates the two";
});
row("P03791", "the sheet says, in plain words, why the number is being asked for", () =>
  /bill|invoice|receipt|GST/i.test(BC) || "the sheet no longer explains itself");
row("P03792", "the sheet registers with LFH_BACK, not a hand-rolled pushState", () =>
  /LFH_BACK/.test(codeOnly(BC)) && !/history\.pushState/.test(codeOnly(BC)) || "the sheet rolled its own back handling");
row("P03793", "the sheet renders nothing until it is asked for, and removes itself when done", () =>
  /remove\(\)/.test(codeOnly(BC)) || "the sheet no longer removes itself");
row("P03794", "a renamed table reaches the printed BILL", () => {
  const h = B.billDocHtml({ name: "R", tableDisp: "Terrace 2", dateStr: "x", lines: [], subtotal: 0, total: 0, taxRows: [], noBar: true });
  return visible(h).includes("Terrace 2") || "the rename did not reach the bill";
});
row("P03795", "a renamed table reaches the printed KOT", () =>
  /Terrace 2/.test(B.kotDocHtml({ tableLabel: "Terrace 2", lines: [] })) || "the rename did not reach the ticket");
row("P03796", "a renamed table reaches the printed BANQUET sheet", () => {
  const h = B.banquetDocHtml({ bill: { table_number: "5", subtotal: 0, discount: 0, tax: 0, total: 0 }, lines: [],
    settings: { table_names: { 5: "Terrace 2" } }, restaurant: {} });
  return /Terrace 2/.test(h) || "the rename did not reach the banquet sheet";
});
row("P03797", "a merged party prints ONE bill under the group's label", () => {
  const h = B.billDocHtml({ name: "R", tableDisp: "T5 + T6", dateStr: "x", lines: [], subtotal: 0, total: 0, taxRows: [], noBar: true });
  return visible(h).includes("T5 + T6") || "the group label did not reach the paper";
});
row("P03798", "the Audit's evidence bill shows the table as it was NAMED", () =>
  /tableDisp/.test(codeOnly(read("lib/auditDetail.ts"))) || "the evidence card passes no table label");
row("P03799", "nothing in my territory writes to a database, fires an alert, or can raise a notification", () => {
  const bad = [];
  if (/fetch\(/.test(CODE)) bad.push("billdoc.js makes a request");
  if (/fetch\(/.test(codeOnly(BC))) { /* billcustomer goes through the panel's api() — allowed */ }
  if (/sendOwnerAlert|toast\(/.test(CODE)) bad.push("billdoc.js raises an alert");
  return bad.length === 0 || bad.join(" · ");
});
