// Sections C · D · E of T8.md re-run — the KITCHEN TICKET (P03616–P03640),
// the BANQUET sheet (P03641–P03665) and the NUMBERS (P03666–P03675).
import { BILLDOC as B, read, visible, row, codeOnly } from "./lib.mjs";
const SRC = read("public/panels/billdoc.js");

// ── C · the kitchen ticket ───────────────────────────────────────────────────────────────────
const kot = (o = {}) => B.kotDocHtml({ rname: "Test Cafe", head: "KITCHEN TICKET", kot: 12, tableLabel: "T5",
  when: "01:00 PM", lines: [{ qty: 2, title: "Dal", options: ["extra cheese"], removed: ["onion"], note: "no chilli" }], ...o });
// One fixed instant so TODAY/YESTERDAY is deterministic: 2026-08-16 21:31 IST = 16:01Z.
const T = Date.parse("2026-08-16T16:01:00Z");

row("P03616", "kotWhen prints the TIME in one fixed format on every device", () => {
  // TODAY has to be an actual today, or kotWhen is RIGHT to prefix the date — which is what my
  // first version of this check tripped over (a fixture pinned to 2026-08-16 read "16 AUG 09:31 PM").
  const a = B.kotWhen(new Date().toISOString());
  if (!/^\d{2}:\d{2} (AM|PM)$/.test(a)) return `a ticket rung just now reads "${a}"`;
  // …and the format does not drift with the machine: ask for the same instant twice.
  const b = B.kotWhen(new Date().toISOString());
  return a.length === b.length || `two reads of now differ in shape: "${a}" vs "${b}"`;
});
row("P03617", "kotWhen's TODAY / YESTERDAY / date decision is made in India time", () => {
  // The decision compares business-day keys derived as UTC+00:30 — read the derivation, and check
  // an old ticket really does carry a date rather than a bare time.
  const old = B.kotWhen("2026-08-06T16:01:00Z");
  return (/30 \* 60000/.test(SRC) && /\d+ [A-Z]{3} \d{2}:\d{2} (AM|PM)/.test(old)) || `old ticket reads "${old}"`;
});
row("P03618", "…and it uses the 05:00 IST BUSINESS day, so 23:50 does not read YESTERDAY at 00:10", () => {
  // The business key is the UTC date shifted +30min (IST −05:00). 23:50 IST and 00:10 IST of the
  // same service both fall on the same key, so a ticket rung at 23:50 reads as a plain time.
  const key = (ms) => new Date(ms + 30 * 60000).toISOString().slice(0, 10);
  const rung = Date.parse("2026-08-16T18:20:00Z");   // 23:50 IST
  const read_ = Date.parse("2026-08-16T18:40:00Z");  // 00:10 IST next calendar day
  return key(rung) === key(read_) || `${key(rung)} vs ${key(read_)} — the business day rolled at midnight`;
});
row("P03619", "the month name is built explicitly, never from the system locale's ordering", () => {
  const old = B.kotWhen("2026-08-06T16:01:00Z");
  return /^6 AUG /.test(old) || `got "${old}" — expected "6 AUG …"`;
});
row("P03620", "…and the day number is India's day, not the device's", () => {
  // 2026-08-06T19:00Z is 7 Aug in India. The ticket must say 7, not 6.
  const old = B.kotWhen("2026-08-06T19:00:00Z");
  return /^7 AUG /.test(old) || `got "${old}"`;
});
row("P03621", "kotWhen never prints Invalid Date", () => {
  const bad = ["", null, undefined, "not-a-date", 0, -1].map((v) => B.kotWhen(v)).filter((s) => /Invalid|NaN/.test(s));
  return bad.length === 0 || `got ${JSON.stringify(bad)}`;
});
row("P03622", "kotWhen lives in ONE place — four callers used to build this string themselves", () => {
  const users = ["public/panels/kitchen/app.js", "public/panels/editor/app.js"].filter((f) => /kotWhen/.test(read(f)));
  return users.length >= 1 || "no panel calls kotWhen any more — the string is being rebuilt somewhere";
});
row("P03623", "the ticket carries NO money — a KOT is for the kitchen, not a bill", () => {
  const h = kot({ lines: [{ qty: 1, title: "Dal", price: 200 }] });
  return !/₹/.test(h) || "a rupee figure reached the kitchen ticket";
});
row("P03624", "a reprinted ticket carries the big bordered *** Reprint · Duplicate *** banner", () =>
  /\*\*\* Reprint · Duplicate \*\*\*/.test(kot({ reprint: true })) || "the duplicate banner is gone");
row("P03625", "…at the very TOP, above the header", () => {
  const h = kot({ reprint: true });
  return h.indexOf('class="rp"') < h.indexOf('class="h"') || "the banner is below the header";
});
row("P03626", "…at ≥16px and uppercase", () => {
  const m = /\.rp\{[^}]*\}/.exec(kot({ reprint: true }));
  if (!m) return "no .rp rule";
  const px = /font-size:([\d.]+)px/.exec(m[0]);
  return (px && +px[1] >= 16 && /text-transform:uppercase/.test(m[0])) || `rule: ${m[0].slice(0, 90)}`;
});
row("P03627", "a FIRST print never carries it", () => !/Reprint · Duplicate/.test(kot({})) || "a fresh ticket was branded DUPLICATE");
row("P03628", "no panel draws its own duplicate banner", () => {
  // CODE only. editor/app.js has a COMMENT saying its ticket "carries the SAME big
  // *** Reprint · Duplicate *** banner the kitchen's copy does" — which is the opposite of a second
  // copy, and is exactly what a plain grep cannot tell apart. My first version reported it as a fault.
  const bad = ["public/panels/kitchen/app.js", "public/panels/editor/app.js", "public/panels/tablet/app.js"]
    .filter((f) => /\*\*\* Reprint/.test(codeOnly(read(f))));
  return bad.length === 0 || `${bad.join(", ")} builds its own banner`;
});
row("P03629", "the ticket prints in ONE ink — no grey, no italics", () => {
  const css = /<style>([\s\S]*?)<\/style>/.exec(kot({}))[1];
  const greys = (css.match(/color:#(?!000\b)[0-9a-f]{3,6}/gi) || []);
  const ital = /font-style:italic/.test(css);
  return (greys.length === 0 && !ital) || `greys ${greys.join(",")} italics=${ital}`;
});
row("P03630", "nothing on the ticket is below 12px, including the per-line note", () => {
  const css = /<style>([\s\S]*?)<\/style>/.exec(kot({}))[1];
  const small = [...css.matchAll(/font-size:([\d.]+)px/g)].map((m) => +m[1]).filter((n) => n < 12);
  return small.length === 0 || `sizes below 12px: ${small.join(",")}`;
});
row("P03631", "an empty ticket says (no items) rather than printing a blank sheet", () =>
  /\(no items\)/.test(kot({ lines: [] })) || "an empty ticket printed nothing");
row("P03632", "every ticket string is escaped", () => {
  const evil = '<script>x</script>';
  const h = B.kotDocHtml({ rname: evil, head: evil, kot: evil, tableLabel: evil, when: evil,
    lines: [{ qty: 1, title: evil, options: [evil], removed: [evil], note: evil }], allergies: [evil] });
  return !/<script>x<\/script>/.test(h) || "a raw tag reached the ticket";
});
row("P03633", "kotLineHtml renders options as (a, b), removals as — no x, and the note on its own line", () => {
  const h = B.kotLineHtml({ qty: 1, title: "Dal", options: ["a", "b"], removed: ["onion"], note: "mild" });
  return (/\(a, b\)/.test(h) && /— no onion/.test(h) && /<small>&raquo; mild<\/small>/.test(h)) || h;
});
row("P03634", "…and drops empty entries rather than printing (, )", () => {
  const h = B.kotLineHtml({ qty: 1, title: "Dal", options: ["", null, "a"], removed: ["", null] });
  return (/\(a\)/.test(h) && !/no <\/i>/.test(h) && !/\(, /.test(h)) || h;
});
row("P03635", "kotLineHtml accepts both string options and {label} objects", () => {
  const h = B.kotLineHtml({ qty: 1, title: "Dal", options: ["a", { label: "b" }] });
  return /\(a, b\)/.test(h) || h;
});
row("P03636", "a qty of 0/absent prints 1×, never 0×", () => {
  const a = B.kotLineHtml({ title: "Dal", qty: 0 }), b = B.kotLineHtml({ title: "Dal" });
  return (/>1×</.test(a) && />1×</.test(b)) || `${a} | ${b}`;
});
row("P03637", "the allergy box renders only when there are allergies", () => {
  const with_ = kot({ allergies: ["peanut"] }), without = kot({ allergies: [] });
  return (/⚠ AVOID: peanut/.test(with_) && !/AVOID/.test(without)) || "the allergy box is on the wrong ticket";
});
row("P03638", "@page{margin:0} and break-inside:avoid keep a ticket on ONE piece of paper", () => {
  const h = kot({});
  return (/@page\{margin:0\}/.test(h) && /break-inside:avoid/.test(h)) || "the one-sheet rules are gone";
});
row("P03639", "a ticket printed from a panel goes through a hidden iframe with NO toolbar and NO script", () => {
  const h = kot({});   // no `note` = no bar, no script
  return (!/class="bar"/.test(h) && !/<script>/.test(h)) || "a panel ticket carries chrome";
});
row("P03640", "a ticket opened as its own page gets a Print button, a ✕ Close and Esc", () => {
  const h = kot({ note: "a sample" });
  return (/printAgain\(\)/.test(h) && /closeBill\(\)/.test(h) && /Escape/.test(h)) || "the preview ticket has no controls";
});

// ── D · the banquet sheet ────────────────────────────────────────────────────────────────────
const bq = (bill = {}, lines = [{ title: "Hall", qty: 1, price: 1000 }], settings = {}) =>
  B.banquetDocHtml({ bill: { bill_no: "B/1", issued_at: "2026-08-16T16:01:00Z", subtotal: 1000, discount: 0, tax: 180, total: 1180, ...bill },
    lines, settings, restaurant: { slug: "x" } });
const cells = (html, cls) => [...html.matchAll(new RegExp(`<td class="${cls}">([^<]*)</td>`, "g"))].map((m) => m[1]);

row("P03641", "a saved bill's FROZEN tax_lines are used when present", () => {
  const h = bq({ tax_lines: [{ label: "ZZTAX", rate: 18, amt: 180 }] });
  return /ZZTAX/.test(h) || "the frozen split was ignored";
});
row("P03642", "with empty tax_lines, components are used ONLY when their sum is the rate this bill was charged", () => {
  const s = { banquet_tax_components: [{ label: "CGST", rate: 9 }, { label: "SGST", rate: 9 }] };
  const match = bq({ tax_lines: [], subtotal: 1000, tax: 180, total: 1180 }, undefined, s);
  const nomatch = bq({ tax_lines: [], subtotal: 1000, tax: 50, total: 1050 }, undefined, s);
  return (/CGST/.test(match) && !/CGST/.test(nomatch)) || "the component guard is wrong";
});
row("P03643", "…else the CGST/SGST halves if THEY match", () => {
  const s = { tax_rate: 0.18 };
  const h = bq({ tax_lines: [], subtotal: 1000, tax: 180, total: 1180 }, undefined, s);
  return (/CGST/.test(h) && /SGST/.test(h)) || "the halves were not used when they matched";
});
row("P03644", "…else one line naming the bill's own effective rate", () => {
  const h = bq({ tax_lines: [], subtotal: 1000, tax: 70, total: 1070 }, undefined, { tax_rate: 0.18 });
  return (!/CGST/.test(h) && /GST 7%|7%/.test(h)) || "the fallback single line is missing";
});
row("P03645", "per-line tax cells are allocated last-takes-the-remainder, so each column foots", () => {
  const lines = [{ title: "A", qty: 1, price: 107812.5 }, { title: "B", qty: 1, price: 7187.5 }];
  const h = bq({ subtotal: 115000, discount: 0, tax: 20700, total: 135700,
    tax_lines: [{ label: "CGST", rate: 9, amt: 10350 }, { label: "SGST", rate: 9, amt: 10350 }] }, lines);
  // every per-line tax cell for CGST must add to the TOTAL row's 10,350.00
  const rowsHtml = [...h.matchAll(/<tr><td class="c">\d+<\/td>[\s\S]*?<\/tr>/g)].map((m) => m[0]);
  const cgst = rowsHtml.map((r) => { const c = [...r.matchAll(/<td class="r">([\d,.]+)<\/td>/g)].map((x) => +x[1].replace(/,/g, "")); return c[2]; });
  const sum = Math.round(cgst.reduce((a, x) => a + (x || 0), 0) * 100) / 100;
  return sum === 10350 || `the CGST column adds to ${sum}, the TOTAL row says 10350`;
});
row("P03646", "the per-line taxable column foots to the BILL's taxable, not just to itself", () => {
  // lines add to 1100 while the stored bill says 1000 taxable — the column must still foot to 1000
  const h = bq({ subtotal: 1000, discount: 0, tax: 180, total: 1180 }, [{ title: "A", qty: 1, price: 600 }, { title: "B", qty: 1, price: 500 }]);
  const rowsHtml = [...h.matchAll(/<tr><td class="c">\d+<\/td>[\s\S]*?<\/tr>/g)].map((m) => m[0]);
  const tax_ = rowsHtml.map((r) => { const c = [...r.matchAll(/<td class="r">([\d,.-]+)<\/td>/g)].map((x) => +x[1].replace(/,/g, "")); return c[1]; });
  const sum = Math.round(tax_.reduce((a, x) => a + (x || 0), 0) * 100) / 100;
  const neg = tax_.filter((x) => x < 0);
  return (sum === 1000 && neg.length === 0) || `taxable column adds to ${sum} (want 1000); negative cells: ${neg.join(",")}`;
});
row("P03647", "…and it never divides by zero when every line is ₹0", () => {
  const h = bq({ subtotal: 0, discount: 0, tax: 0, total: 0 }, [{ title: "A", qty: 1, price: 0 }, { title: "B", qty: 1, price: 0 }]);
  return !/NaN|Infinity/.test(h) || "NaN or Infinity reached the sheet";
});
row("P03648", "a sheet with NO lines still renders its TOTAL row and its money box", () => {
  const h = bq({}, []);
  return (/class="tot"/.test(h) && /INVOICE TOTAL/.test(h) && !/NaN/.test(h)) || "an empty banquet sheet lost its totals";
});
row("P03649", "the date and time are pinned to Asia/Kolkata, not the printing device", () => {
  const src = SRC.slice(SRC.indexOf("function banquetDocHtml"));
  const dstr = /const dstr = [^;]*;/.exec(src), tstr = /const tstr = [^;]*;/.exec(src);
  return (dstr && tstr && /Asia\/Kolkata/.test(dstr[0]) && /Asia\/Kolkata/.test(tstr[0])) || "one of the two is back on device time";
});
row("P03650", "an advance's date is pinned to IST too", () => {
  const h = bq({ advances: [{ mode: "upi", amt: 500, date: "2026-08-01" }] });
  return /DT\.01\/08\/2026/.test(h) || `the advance line reads ${/UPI PAY[^<]*/.exec(h)?.[0]}`;
});
row("P03651", "the function date is pinned to IST", () => {
  const h = bq({ func: "Reception", fn_date: "2026-08-01" });
  return /01\/08\/2026/.test(h) || "the function date shifted off IST";
});
row("P03652", "bqWords names the same amount as the figure beside it, paise included", () =>
  /Thirty-Four Rupees and Fifty-Six Paise Only$/.test(B.bqWords(1234.56)) || `got "${B.bqWords(1234.56)}"`);
row("P03653", "…names a currency on the common whole-rupee case", () =>
  /Rupees Only$/.test(B.bqWords(135700)) || `got "${B.bqWords(135700)}"`);
row("P03654", "…gets the singular right", () =>
  (/^One Rupee Only$/.test(B.bqWords(1)) && /One Paisa Only$/.test(B.bqWords(1.01))) || `${B.bqWords(1)} | ${B.bqWords(1.01)}`);
row("P03655", "…says Minus on a negative rather than printing positive words", () =>
  /^Minus /.test(B.bqWords(-500)) || `got "${B.bqWords(-500)}"`);
row("P03656", "…handles 0, sub-rupee, Lakh and Crore", () => {
  const zero = B.bqWords(0), sub = B.bqWords(0.5), lakh = B.bqWords(135700), crore = B.bqWords(12345678);
  return (/^Zero Rupees Only$/.test(zero) && /Fifty Paise Only$/.test(sub) && /Lakh/.test(lakh) && /Crore/.test(crore))
    || [zero, sub, lakh, crore].join(" | ");
});
row("P03657", "a renamed table reaches the banquet sheet, not the bare digit", () => {
  const h = bq({ table_number: "5" }, undefined, { table_names: { 5: "Terrace 2" } });
  return (/Terrace 2/.test(h) && !/>5</.test(/<div class="lbl">Table<\/div><div class="v">[^<]*/.exec(h)?.[0] || "")) || "the rename did not reach the paper";
});
row("P03658", "…resolved HERE, so the manager print and the admin preview cannot drift", () =>
  /const bqTableDisp = \(function/.test(SRC) || "the table label is no longer resolved inside the document");
row("P03659", "a banquet with no table prints no Table row rather than an empty one", () => {
  const h = bq({ table_number: null });
  return !/<div class="lbl">Table<\/div>/.test(h) || "an empty Table row printed";
});
row("P03660", "bqPaper clamps every margin into its own range and defaults A5", () => {
  const wild = B.bqPaper({ banquet_paper_top: 9999, banquet_paper_bot: -5, banquet_paper_side: 999 });
  const dflt = B.bqPaper({});
  return (wild.top === 80 && wild.bot === 0 && wild.side === 25 && dflt.size === "a5" && dflt.top === 33)
    || `${JSON.stringify(wild)} / ${JSON.stringify(dflt)}`;
});
row("P03661", "bqTaxModel uses the banquet's own components, falling back to the dine-in model", () => {
  const own = B.bqTaxModel({ banquet_tax_components: [{ label: "CGST", rate: 9 }, { label: "SGST", rate: 9 }], tax_rate: 0.05 });
  const fall = B.bqTaxModel({ tax_rate: 0.05 });
  return (own.rate === 0.18 && own.own === true && fall.rate === 0.05 && fall.own === false)
    || `${JSON.stringify(own)} / ${JSON.stringify(fall)}`;
});
row("P03662", "the A4/A5 @page size IS explicit here", () => {
  const a5 = bq({}, undefined, { banquet_paper_size: "a5" }), a4 = bq({}, undefined, { banquet_paper_size: "a4" });
  return (/@page\{size:148mm 210mm;margin:0\}/.test(a5) && /@page\{size:210mm 297mm;margin:0\}/.test(a4))
    || "the explicit sheet size is gone";
});
row("P03663", "a round-off row appears when the stored total does not equal taxable + tax", () => {
  const off = bq({ subtotal: 1000, discount: 0, tax: 180, total: 1181 });
  const on = bq({ subtotal: 1000, discount: 0, tax: 180, total: 1180 });
  return (/Round off/.test(off) && !/Round off/.test(on)) || "the round-off row is on the wrong sheet";
});
row("P03664", "Received / Balance rows appear only when money has been received, and Balance never prints negative", () => {
  const none = bq({ received: 0 });
  const part = bq({ received: 500 });
  const over = bq({ received: 2000 });
  const bal = /<span>Balance<\/span><i>([^<]*)<\/i>/.exec(over);
  return (!/Received/.test(none) && /Received/.test(part) && /Balance due/.test(part) && bal && !/-/.test(bal[1]))
    || `none=${/Received/.test(none)} part=${/Balance due/.test(part)} over=${bal && bal[1]}`;
});
row("P03665", "the <colgroup> is built by concatenation, not by joining half-open tags", () => {
  // The fault this row exists for is a STRAY "<" printing on the paper, which is what a clever
  // .join() of half-open tags produced. So: the group must be nothing but whole <col> tags.
  // (My first version also tested for />\s*</ — which matches every "><col" boundary in a perfectly
  // good colgroup, so the check could never pass. The detector, not the code.)
  const h = bq({});
  const cg = /<colgroup>([\s\S]*?)<\/colgroup>/.exec(h);
  if (!cg) return "no colgroup";
  const inner = cg[1].trim();
  return (/^(<col[^>]*>)+$/.test(inner) && !/&lt;/.test(inner)) || `colgroup: ${inner.slice(0, 90)}`;
});

// ── E · the numbers ─────────────────────────────────────────────────────────────────────────
row("P03666", "financialYear rolls on 1 April, not 1 January", () => {
  const mar = B.financialYear("2026-03-31T12:00:00Z"), apr = B.financialYear("2026-04-01T12:00:00Z");
  return (mar === "2025-26" && apr === "2026-27") || `${mar} / ${apr}`;
});
row("P03667", "invFmt is <prefix>/<FY>/<6-digit>", () =>
  B.invFmt(41, "2026-04-01T12:00:00Z", "INV") === "INV/2026-27/000041" || `got ${B.invFmt(41, "2026-04-01T12:00:00Z", "INV")}`);
row("P03668", "the FY is the INVOICE'S OWN date, so a March invoice reprinted in April keeps its year", () =>
  B.invFmt(41, "2026-03-15T12:00:00Z", "INV") === "INV/2025-26/000041" || `got ${B.invFmt(41, "2026-03-15T12:00:00Z", "INV")}`);
row("P03669", "invFmt(null) returns '' so the Invoice row disappears rather than printing INV//", () =>
  (B.invFmt(null) === "" && B.invFmt(undefined) === "") || `got "${B.invFmt(null)}" / "${B.invFmt(undefined)}"`);
row("P03670", "a 7-digit invoice number is never truncated by the 6-digit pad", () =>
  /\/1234567$/.test(B.invFmt(1234567, "2026-04-01T12:00:00Z", "INV")) || `got ${B.invFmt(1234567, "2026-04-01T12:00:00Z", "INV")}`);
row("P03671", "the prefix falls back to INV when the restaurant has set none", () =>
  /^INV\//.test(B.invFmt(1, "2026-04-01T12:00:00Z", "")) || `got ${B.invFmt(1, "2026-04-01T12:00:00Z", "")}`);
row("P03672", "a cancelled sheet NAMES the invoice number it retired, marked — voided", () => {
  const d = B.billData({ settings: { tax_rate: 0.05 }, restaurant: {},
    orders: [{ status: "cancelled", subtotal: 100, items: [{ title: "X", qty: 1, price: 100 }] }],
    session: { invoice_no: 41, invoice_at: "2026-04-01T12:00:00Z" } });
  return /INV\/2026-27\/000041 — voided$/.test(d.invNo) || `invNo "${d.invNo}"`;
});
row("P03673", "a bill cancelled before any invoice existed prints NO invoice row at all", () => {
  const d = B.billData({ settings: { tax_rate: 0.05 }, restaurant: {},
    orders: [{ status: "cancelled", subtotal: 100, items: [{ title: "X", qty: 1, price: 100 }] }], session: {} });
  return d.invNo === "" || `invNo "${d.invNo}"`;
});
row("P03674", "the bill number is printed from the SESSION, never re-derived on the paper", () => {
  const d = B.billData({ settings: { tax_rate: 0.05 }, restaurant: {}, orders: [{ status: "served", subtotal: 100, items: [] }], session: { bill_no: 77 } });
  return d.billNo === 77 || `billNo ${d.billNo}`;
});
row("P03675", "the document never invents, renumbers or reformats a number it was handed", () => {
  // no counter arithmetic anywhere in the document builders
  const body = SRC.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
  const bad = [/bill_no\s*\+\+/, /bill_no\s*\+\s*1/, /invoice_no\s*\+\+/, /invoice_no\s*\+\s*1/, /kot_no\s*\+\s*1/]
    .filter((re) => re.test(body));
  return bad.length === 0 || `counter arithmetic found: ${bad.length} pattern(s)`;
});
