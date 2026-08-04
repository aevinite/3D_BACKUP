/* billdoc.js — THE two pieces of paper this product prints, written down ONCE.
 *
 * WHY THIS FILE EXISTS (owner, 2026-08-02): "the format of KOT is different, but in the manager
 * panel if you print, it is different… whatever the manager panel prints, that is the format, and
 * the preview should only be that. Both should be sync — and it should not change the manager
 * bill." Before this file there were SIX templates for two documents:
 *
 *   the bill  → the manager panel's printBill()            ← the real one, the owner's reference
 *               lib/billPreview.ts (Access → Format of…)   ← a different layout entirely
 *               RestaurantSettings.previewBill()           ← a third one, on the same screen
 *   the KOT   → the manager panel's kotTicketHtml()        ← the real one
 *               the kitchen panel's printKot()             ← a hand-kept copy of it
 *               RestaurantSettings.previewKot()            ← the old two-page sample
 *
 * So the admin could set a bill up, look at the preview, approve it, and the printer would hand
 * the guest something else. Now every one of those call sites builds its DATA and comes here for
 * the DOCUMENT. Change a margin here and the preview, the manager, the kitchen and the admin
 * screens all change together — there is no second place to remember.
 *
 * WHAT DID NOT CHANGE: the manager panel's bill and the kitchen ticket print byte-for-byte what
 * they printed before. This file is their markup, moved, not redesigned. The npm script
 * 'verify:print-format' fails if a second copy of either document ever appears again.
 *
 * LOADED FROM THREE WORLDS, so it is deliberately plain JavaScript with no imports:
 *   · the panels     — <script src="/panels/billdoc.js">  → window.LFH_BILLDOC
 *   · the Next server— import BILLDOC from "@/public/panels/billdoc.js"  (module.exports)
 *   · React (admin)  — the same import
 */
(function () {
  "use strict";

  var esc = function (v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };
  // Money exactly as the manager panel writes it: whole rupees, Indian grouping (1,07,880).
  // (INR_RATE has been 1 since migration 043 — prices are stored in rupees.)
  var inr = function (v) { return "₹" + Math.round(parseFloat(v) || 0).toLocaleString("en-IN"); };
  var pn = function (v) { return Math.round(Number(v) || 0).toLocaleString("en-IN"); };

  /* discPct(subtotal, disc) — a discount written as a PERCENTAGE of the pre-discount subtotal
     (owner, 2026-08-01: "in the bill it should show how much percentage of discount you have
     given — and on the printed bill the percentage should show too"). The app stores a discount
     as an AMOUNT, so every screen that wants the percentage has to derive it, and each one that
     derived it privately rounded it its own way: the manager bill said "12.5%", the admin preview
     "12.5%", the guest's own bill nothing at all. It is decided ONCE here, next to the money
     formatter, so the paper and every screen quote the same figure.
     Whole numbers read clean ("10%"), anything else keeps one decimal ("12.5%"). Returns "" when
     there is nothing to say, so a call site can drop it in with no guard of its own. */
  function discPct(subtotal, disc) {
    var sub = Number(subtotal) || 0, d = Number(disc) || 0;
    if (sub <= 0 || d <= 0) return "";
    var pct = Math.round((d / sub) * 1000) / 10;      // one decimal, no floating dust
    if (!pct) return "";
    return (pct % 1 === 0 ? pct.toFixed(0) : pct.toFixed(1)) + "%";
  }

  /* splitTax(taxWhole, comps) — the printed tax lines MUST add up EXACTLY to the tax on the
     total. Every line is rounded to whole rupees, so rounding each component on its own drifts:
     ₹380 @ 5% = ₹19 of tax, but CGST 2.5% + SGST 2.5% each round(9.5) = ₹10 → ₹20, and the
     invoice then foots to ₹400 instead of ₹399. So: round every line except the LAST and give
     the last the remainder — the same rule the owner GST report uses. (audit fix 2026-07-09) */
  function splitTax(taxWhole, comps) {
    var list = (comps && comps.length) ? comps : [];
    var sum = list.reduce(function (a, c) { return a + (Number(c.rate) || 0); }, 0) || 1;
    var run = 0;
    return list.map(function (c, i) {
      var amt = i === list.length - 1 ? (taxWhole - run) : Math.round(taxWhole * ((Number(c.rate) || 0) / sum));
      run += amt;
      return { label: c.label, rate: c.rate, amt: amt };
    });
  }

  /* billIdentity(settings, restaurant) — the EFFECTIVE identity + wording a bill carries RIGHT
     NOW: the restaurant's own Settings › Billing values, falling back to the defaults the printer
     has always used (the flagship keeps its Little French House identity; everyone else gets the
     temporary Aevidine placeholders and a per-cuisine sign-off until they fill their own).
     It lives HERE with the document because the preview has to resolve the name, address and
     footer exactly as the printer does, or it would show the admin a header nobody is handed.
     Returns RAW (unescaped) strings; the document escapes them. */
  function billIdentity(settings, restaurant) {
    var s = settings || {}, r = restaurant || {};
    var isDefault = r.slug === "french-house" || r.id === "00000000-0000-0000-0000-000000000001";
    var DEFAULT_BILL = { address: "Aevidine, Ahmedabad, Gujarat 380015, India", phone: "+91 90000 00000" };
    var FOOTERS = {
      "pizza-palace": "Grazie — a presto! 🍕",
      "sakura-sushi": "Arigato — mata kite ne 🍣",
      "taco-fiesta": "¡Gracias — vuelve pronto! 🌮",
      "burger-barn": "Y'all come back now! 🍔",
      "spice-route": "Dhanyavaad — padharo! 🍛",
      "green-bowl": "Stay fresh — see you soon! 🥗",
    };
    return {
      isDefault: isDefault,
      name: s.restaurant_name || (isDefault ? "Little French House" : (r.logo_text || (r.name && r.name.en) || "Restaurant")),
      address: s.restaurant_address || (isDefault ? "" : DEFAULT_BILL.address),
      phone: s.restaurant_phone || (isDefault ? "+91 90999 14418" : DEFAULT_BILL.phone),
      // NEVER fall back to a placeholder GSTIN — a fake tax number on a real bill is illegal.
      // Empty prints no GSTIN line (the document handles it).
      gstin: s.gstin || "",
      prefix: s.invoice_prefix || "INV",
      footer: s.bill_footer || FOOTERS[r.slug] || (isDefault ? "Merci — see you again soon 🥐" : "Thank you — please visit again"),
      taxLabel: ((s.tax_label || "Tax") + "").trim() || "Tax",
    };
  }

  /* ───────────────────────────── THE BILL ─────────────────────────────
   * d = {
   *   logo, name, addr, phone, gstin, footer,          // identity (raw, escaped here)
   *   invNo, billNo, parcel, tableDisp, dateStr,       // the header rows ("" hides a row)
   *   cust, custPhone,                                 // who it is for ("" hides the block)
   *   lines: [{ title, qty, price, options:[{label,price}] }],   // price = unit INCLUDING add-ons
   *   subtotal, discount, discLabel, taxable, taxRows:[{label,rate,amt}], total,
   *   autoPrint,                                       // true = open the print dialog by itself
   *   note                                             // a line in the toolbar (a preview says so)
   * }
   * A PARCEL prints THIS document, not a layout of its own (owner, 2026-08-02: "the bill format
   * should be exactly like a KOT bill — just the top changes"): the one difference is the header
   * line, which reads "Parcel" with nothing where a table number would go. */
  function billDocHtml(d) {
    d = d || {};
    var name = esc(d.name), addr = esc(d.addr), phone = esc(d.phone);
    var gstin = esc(d.gstin), footer = esc(d.footer);

    // Item rows: base + each priced add-on as a sub-line (the unit price already includes
    // add-ons, so base = unit − add-ons → the lines sum to the subtotal). Every figure is
    // measured, so the money columns below are sized to THIS bill instead of a fixed guess.
    var widest = { qty: 3, rate: 4, amt: 3 };   // never narrower than the QTY/RATE/AMT headings
    var measure = function (k, v) { widest[k] = Math.max(widest[k], String(v).length); };
    var rows = (d.lines || []).map(function (i) {
      var q = Number(i.qty) || 1;
      var opts = Array.isArray(i.options) ? i.options.filter(function (x) { return Number(x.price); }) : [];
      var addUnit = opts.reduce(function (a, x) { return a + (Number(x.price) || 0); }, 0);
      var baseUnit = (parseFloat(i.price) || 0) - addUnit;
      measure("qty", pn(q)); measure("rate", pn(baseUnit)); measure("amt", pn(baseUnit * q));
      var r = '<tr><td class="n">' + esc(i.title) + '</td><td class="c">' + pn(q) + '</td><td class="r">' + pn(baseUnit) + '</td><td class="r">' + pn(baseUnit * q) + "</td></tr>";
      for (var k = 0; k < opts.length; k++) {
        var x = opts[k];
        measure("rate", pn(x.price)); measure("amt", pn(Number(x.price) * q));
        r += '<tr class="ex"><td class="n" colspan="2">+ ' + esc(x.label) + '</td><td class="r">' + pn(x.price) + '</td><td class="r">' + pn(Number(x.price) * q) + "</td></tr>";
      }
      return r;
    }).join("");

    var taxRows = (d.taxRows || []).map(function (c) {
      return '<div class="t"><span>' + esc(c.label) + " " + c.rate + '%</span><span>' + inr(c.amt) + "</span></div>";
    }).join("");

    var disc = Number(d.discount) || 0;
    var discBlock = disc > 0
      ? '<div class="t"><span>Discount' + (d.discLabel ? " (" + esc(d.discLabel) + ")" : "") + "</span><span>− " + inr(disc) + '</span></div><div class="t tx"><span>Taxable value</span><span>' + inr(d.taxable) + "</span></div>"
      : "";

    var custBlock = (d.cust || d.custPhone)
      ? '<div class="dash"></div>'
        + (d.cust ? '<div class="kv"><span>Customer</span><b>' + esc(d.cust) + "</b></div>" : "")
        + (d.custPhone ? '<div class="kv"><span>Mobile</span><b>' + esc(d.custPhone) + "</b></div>" : "")
      : "";

    return '<!doctype html><title>Tax Invoice — ' + name + "</title>\n"
+ "<style>\n"
+ "  /* Thermal-roll print recipe — VALIDATED offline through the real CUPS+ESC/POS driver\n"
+ "     chain (2026-07-21, see aangan-thermal-printer-setup memory). Three rules:\n"
+ "     · @page margin:0 kills the browser's own header/footer (\"about:blank\", page numbers).\n"
+ "     · NO @page size override — a forced size smaller/squarer than the paper gets rotated\n"
+ "       or bottom-anchored by CUPS (sideways prints + 20cm blank lead-ins). The queue's\n"
+ "       own short receipt paper does the pagination; Chrome never slices a text line.\n"
+ "     · Content ≤66mm CENTERED: the 80mm head only prints ~70mm, offset ~5mm from the\n"
+ "       left paper edge — a full-width 80mm body loses ~8mm of every line on the right. */\n"
+ "  @page{margin:0}\n"
+ "  @media print{body{margin:0 !important;padding:2mm 5mm !important}\n"
+ "    /* a bill spanning several printer pages: print the ITEM header ONCE (browsers\n"
+ "       otherwise repeat <thead> on every page — it showed up mid-bill), and never split\n"
+ "       a row across a page boundary (a fragmented flex row shifted every amount one\n"
+ "       line down — owner's 18:04 invoice). Validated in the offline print simulator. */\n"
+ "    thead{display:table-row-group}\n"
+ "    tr,.t,.g,.kv,h2,.sub{break-inside:avoid;page-break-inside:avoid}}\n"
+ "  /* ── ONE INK: pure black at NORMAL weight (owner, 2026-07-30) ──────────────────\n"
+ "     A thermal head can only burn a dot or not — it has no grey, so grey is faked with\n"
+ "     sparse dots and light text came out broken and pale (the old #777 labels, #444\n"
+ "     address, #333 totals, #555 footer, dotted #e2e2e2 rules). Everything here is #000\n"
+ "     at weight 400; hierarchy comes from SIZE, small caps + letter-spacing, spacing and\n"
+ "     solid rules. Bold is spent on exactly two things: the restaurant name and the TOTAL.\n"
+ "     Nothing below 10.5px and no italics — both smear at 203 dpi. */\n"
+ "  *{-webkit-print-color-adjust:exact;print-color-adjust:exact}\n"
+ "  body{font-family:'Helvetica Neue',Helvetica,Arial,'Liberation Sans',sans-serif;\n"
+ "       font-size:12.5px;line-height:1.44;margin:22px 30px;color:#000;font-weight:400;\n"
+ "       font-variant-numeric:tabular-nums}\n"
+ "  .logo{display:block;height:46px;margin:0 auto 8px;filter:grayscale(1) contrast(1.4)}\n"
+ "  h2{font-size:19px;font-weight:700;letter-spacing:.03em;text-transform:uppercase;text-align:center;margin:0 0 4px}\n"
+ "  .sub{text-align:center;font-size:11px;line-height:1.5}\n"
+ "  .kind{border-top:1px solid #000;border-bottom:1px solid #000;margin:9px 0 8px;padding:4px 0;\n"
+ "        text-align:center;font-size:11px;letter-spacing:.24em;text-transform:uppercase}\n"
+ "  .kv{display:flex;justify-content:space-between;gap:10px;font-size:12px;padding:1.5px 0}\n"
+ "  .kv span:first-child{font-size:11px;letter-spacing:.09em;text-transform:uppercase;white-space:nowrap}\n"
+ "  .kv b{font-weight:400;text-align:right}\n"
+ "  .dash{border-top:1px solid #000;margin:8px 0}\n"
+ "  /* fixed columns, sized from THIS bill's own figures (see widest{}) so a ₹1,07,880 line\n"
+ "     and a long dish name can never crowd each other */\n"
+ "  table{width:100%;border-collapse:collapse;margin-top:2px;table-layout:fixed}\n"
+ "  th{font-size:11px;letter-spacing:.09em;text-transform:uppercase;text-align:left;font-weight:400;\n"
+ "     border-bottom:1px solid #000;padding:0 0 4px}\n"
+ "  th.c,td.c{text-align:center;padding-left:4px}\n"
+ "  th.r,td.r{text-align:right;padding-left:7px}\n"
+ "  td{font-size:12.5px;padding:5px 0;vertical-align:top;border:0}\n"
+ "  td.n{padding-right:4px;word-break:break-word}\n"
+ "  tr.ex td{font-size:11px;padding:0 0 5px 9px}\n"
+ "  tbody tr:last-child td{padding-bottom:6px}\n"
+ "  .t{display:flex;justify-content:space-between;font-size:12px;padding:2.5px 0}\n"
+ "  .t.tx{border-top:1px solid #000;margin-top:4px;padding-top:5px}\n"
+ "  .totals{margin-top:6px;border-top:1px solid #000;padding-top:6px}\n"
+ "  .g{display:flex;justify-content:space-between;align-items:baseline;border-top:2px solid #000;\n"
+ "     border-bottom:2px solid #000;margin-top:7px;padding:6px 0;font-weight:700;font-size:16px;letter-spacing:.02em}\n"
+ "  .foot{text-align:center;font-size:11px;margin-top:11px}\n"
+ "  /* Screen-only toolbar. The window stays open after the print dialog closes (Print and\n"
+ "     Cancel are indistinguishable to the page — see closeBill() below), so this bar is how it\n"
+ "     goes away, and how a second copy is printed without rebuilding the bill. It is hidden\n"
+ "     from the paper by display:none AND excluded from the page-length measurement below. */\n"
+ "  .bar{position:sticky;top:0;z-index:9;display:flex;gap:8px;justify-content:flex-end;\n"
+ "       margin:-22px -30px 14px;padding:10px 12px;background:#f2f2f4;border-bottom:1px solid #d8d8dc}\n"
+ "  .bar button{font:inherit;font-size:13px;padding:7px 13px;border-radius:8px;cursor:pointer;\n"
+ "              border:1px solid #b9b9c0;background:#fff;color:#000}\n"
+ "  .bar button.x{background:#111;color:#fff;border-color:#111}\n"
+ (d.note
? "  .bar .note{margin-right:auto;align-self:center;text-align:left;max-width:52%;\n"
+ "             font:11.5px/1.35 system-ui,sans-serif;color:#3a3a42}\n"
: "")
+ "  @media print{.bar{display:none !important}}\n"
+ "</style>\n"
+ '<div class="bar">'
+   (d.note ? '<span class="note">' + esc(d.note) + "</span>" : "")
+   '<button onclick="printAgain()">🖨 Print' + (d.autoPrint ? " again" : " this") + "</button>"
+   '<button class="x" onclick="closeBill()">✕ Close</button></div>\n'
+ (d.logo ? '<img class="logo" src="' + esc(d.logo) + '" onerror="this.style.display=\'none\'"/>' : "")
+ "\n<h2>" + name + "</h2>\n"
+ '<div class="sub">' + (addr ? addr + "<br/>" : "") + (phone ? "Ph " + phone : "") + (phone && gstin ? "<br/>" : "") + (gstin ? "GSTIN " + gstin : "") + "</div>\n"
+ '<div class="kind">Tax Invoice</div>\n'
+ (d.invNo ? '<div class="kv"><span>Invoice</span><b>' + esc(d.invNo) + "</b></div>" : "") + "\n"
+ (d.billNo !== "" && d.billNo != null ? '<div class="kv"><span>Bill no</span><b>#' + esc(d.billNo) + "</b></div>" : "") + "\n"
+ (d.parcel ? '<div class="kv"><span>Parcel</span><b></b></div>' : '<div class="kv"><span>Table</span><b>' + esc(d.tableDisp) + "</b></div>") + "\n"
+ '<div class="kv"><span>Date</span><b>' + esc(d.dateStr) + "</b></div>\n"
+ custBlock + "\n"
+ '<div class="dash"></div>\n'
+ "<table>\n"
+ "<colgroup><col><col style=\"width:calc(" + widest.qty + "ch + 8px)\"><col style=\"width:calc(" + widest.rate + "ch + 11px)\"><col style=\"width:calc(" + widest.amt + "ch + 11px)\"></colgroup>\n"
+ '<thead><tr><th>Item</th><th class="c">Qty</th><th class="r">Rate</th><th class="r">Amt</th></tr></thead><tbody>' + rows + "</tbody></table>\n"
+ '<div class="totals">\n'
+ '  <div class="t"><span>Subtotal</span><span>' + inr(d.subtotal) + "</span></div>\n"
+ "  " + discBlock + "\n"
+ "  " + taxRows + "\n"
+ '  <div class="g"><span>TOTAL</span><span>' + inr(d.total) + "</span></div>\n"
+ "</div>\n"
+ '<div class="foot">' + footer + "</div>\n"
+ pageScript(d.autoPrint);
  }

  /* ───────────────────────── THE KITCHEN TICKET (KOT) ─────────────────────────
   * o = { title, rname, head, kot, tableLabel, when,
   *       lines: [{ qty, title, options, removed, note }]  (or linesHtml, pre-built),
   *       allergies: [], extraHtml, note }
   * 66mm thermal, validated through the real CUPS/ESC-POS chain 2026-07-21. The zero page margin
   * plus the break-inside rules are what keep a ticket on ONE piece of paper — the admin's old
   * sample had neither and printed in two parts (owner, 2026-08-02). NO PRICES: a KOT is for
   * the kitchen, not a bill. */
  function kotLineHtml(r) {
    var opts = Array.isArray(r.options) ? r.options.map(function (x) { return typeof x === "string" ? x : ((x && x.label) || ""); }).filter(Boolean).join(", ") : "";
    var rem = Array.isArray(r.removed) ? r.removed.filter(Boolean).join(", ") : "";
    return '<div class="kl"><span class="q">' + (r.qty || 1) + '×</span><span class="n">' + esc(r.title || "")
      + (opts ? " <i>(" + esc(opts) + ")</i>" : "")
      + (rem ? " <i>— no " + esc(rem) + "</i>" : "")
      + (r.note ? "<br><small>&raquo; " + esc(r.note) + "</small>" : "")
      + "</span></div>";
  }

  function kotDocHtml(o) {
    o = o || {};
    var linesHtml = o.linesHtml != null ? o.linesHtml : (o.lines || []).map(kotLineHtml).join("");
    var allergHtml = o.allergHtml != null ? o.allergHtml
      : (Array.isArray(o.allergies) && o.allergies.length ? '<div class="al">⚠ AVOID: ' + esc(o.allergies.join(", ")) + "</div>" : "");
    return '<!doctype html><html><head><meta charset="utf-8"><title>' + esc(o.title || "KOT") + "</title><style>\n"
+ "      *{margin:0;padding:0;box-sizing:border-box}body{font-family:ui-monospace,monospace;width:280px;padding:8px;color:#000}\n"
+ "      .h{text-align:center;font-weight:700;font-size:15px;border-bottom:2px dashed #000;padding-bottom:6px;margin-bottom:6px}\n"
+ "      .meta{display:flex;justify-content:space-between;font-size:13px;font-weight:700;margin-bottom:4px}\n"
+ "      .kl{font-size:14px;padding:4px 0;border-bottom:1px dotted #999}.kl .q{font-weight:700;margin-right:6px}.kl i{font-style:italic;color:#333;font-size:12px}\n"
+ "      .al{margin-top:8px;font-weight:700;font-size:13px;border:1px solid #000;padding:4px}\n"
// The duplicate banner (owner, 2026-08-04: "reprint … like duplicate in big words on top").
// Big, bordered, uppercase — a reprinted ticket must be impossible to mistake for a fresh
// order on a rushed pass. One ink, one weight family, same 66mm discipline as everything else.
+ "      .rp{text-align:center;font-weight:700;font-size:18px;letter-spacing:2px;border:3px double #000;padding:5px 2px;margin:0 0 6px;text-transform:uppercase}\n"
+ "      @page{margin:0}\n"
+ "      @media print{body{margin:0 !important;padding:2mm 5mm 4mm !important}.kl,.meta,.al{break-inside:avoid;page-break-inside:avoid}}\n"
+ (o.note ? kotBarCss() : "")
+ "    </style></head><body>\n"
// The toolbar sits ABOVE the ticket, as it does on the bill. Below it, a short ticket lets the
// sticky bar ride up over the last line — it hid the allergy box, which is the one line on a
// KOT nobody may miss.
+ kotBarHtml(o.note)
// A REPRINT is branded as one, in big words, at the very top of the paper (owner,
// 2026-08-04) — the kitchen must never mistake a duplicate for a fresh order. The flag,
// not free text, so every panel's reprint looks identical.
+ (o.reprint ? '      <div class="rp">*** Reprint · Duplicate ***</div>\n' : "")
+ '      <div class="h">' + esc(o.rname || "Kitchen") + "<br>" + esc(o.head || "KITCHEN TICKET") + "</div>\n"
+ '      <div class="meta"><span>KOT #' + esc(String(o.kot)) + "</span><span>" + esc(o.tableLabel || "") + "</span></div>\n"
+ '      <div class="meta"><span>' + esc(o.when || "") + "</span></div>\n"
+ "      " + (linesHtml || "<div>(no items)</div>") + "\n"
+ "      " + allergHtml + "\n"
+ "      " + (o.extraHtml || "") + "\n"
+ (o.note ? pageScriptKot() : "")
+ "    </body></html>";
  }

  /* A KOT printed from a panel goes through a HIDDEN IFRAME — no toolbar, no script, nothing
     on screen. Opened as its own page (the admin's preview) it needs a way to be printed and
     dismissed, so it borrows the bill's bar. Both are screen-only: the paper is unchanged. */
  function kotBarCss() {
    return "      .bar{position:sticky;top:0;z-index:9;display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;\n"
+ "           margin:-8px -8px 10px;padding:8px;background:#f2f2f4;border-bottom:1px solid #d8d8dc}\n"
+ "      .bar button{font:13px/1 system-ui,sans-serif;padding:7px 11px;border-radius:8px;cursor:pointer;\n"
+ "                  border:1px solid #b9b9c0;background:#fff;color:#000}\n"
+ "      .bar button.x{background:#111;color:#fff;border-color:#111}\n"
+ "      .bar .note{flex:1 1 100%;font:11.5px/1.35 system-ui,sans-serif;color:#3a3a42;text-align:left}\n"
+ "      @media print{.bar{display:none !important}}\n";
  }
  function kotBarHtml(note) {
    if (!note) return "";
    return '<div class="bar"><span class="note">' + esc(note) + "</span>"
      + '<button onclick="printAgain()">🖨 Print this</button>'
      + '<button class="x" onclick="closeBill()">✕ Close</button></div>';
  }

  /* The POS-80 queue has its own default page length, so a long bill came out chopped into
     several sheets (owner, 2026-07-30 — "it prints in four parts"). Measure the finished bill
     and declare a page exactly that long, so the page MATCHES the roll instead of being
     smaller/squarer than it (that older case is what CUPS rotates or bottom-anchors).
     A PREVIEW runs the very same measurement — printing the preview gives the same paper —
     it just does not fire the dialog by itself. */
  function pageScript(autoPrint) {
    return "<script>\n"
+ "function measure(){\n"
+ "  // The toolbar is screen-only, but scrollHeight measures the SCREEN layout — leaving it in\n"
+ "  // would declare a page ~11mm longer than the bill and feed that much blank roll after every\n"
+ "  // print. Hide it for the measurement, then put it back.\n"
+ "  var bar = document.querySelector(\".bar\"), prev = bar ? bar.style.display : \"\";\n"
+ "  if (bar) bar.style.display = \"none\";\n"
+ "  try{\n"
+ "    var mm = 96/25.4, h = Math.ceil(document.body.scrollHeight/mm) + 6;\n"
+ "    var st = document.getElementById(\"pagesize\") || document.createElement(\"style\");\n"
+ "    st.id = \"pagesize\";\n"
+ "    st.textContent = \"@media print{@page{size:80mm \" + h + \"mm;margin:0}}\";\n"
+ "    document.head.appendChild(st);\n"
+ "  }catch(e){}\n"
+ "  if (bar) bar.style.display = prev;\n"
+ "}\n"
+ "function printAgain(){ measure(); print(); }\n"
+ "function closeBill(){ try{ if (opener && !opener.closed) opener.focus(); }catch(e){} try{ close(); }catch(e){} }\n"
+ "// NOTHING here closes this window. Print and Cancel look identical to the page (one afterprint\n"
+ "// event, no flag), so closing on that event also destroyed the bill when the person pressed\n"
+ "// Cancel — the fault the owner reported on 2026-08-02. After the dialog closes the bill simply\n"
+ "// stays on screen with its own ✕ Close (which also brings the panel back to the front), and the\n"
+ "// next bill REUSES this window, so nothing can pile up. Esc closes it too.\n"
+ "// afterprint is not used to CLOSE (it can't be trusted for that) — only to put the keyboard on\n"
+ "// the ✕ Close button, so the moment the dialog goes away Enter/Space/Esc dismisses the bill.\n"
+ "addEventListener(\"keydown\", function(e){ if (e.key === \"Escape\") closeBill(); });\n"
+ "onafterprint = function(){ try{ var b = document.querySelector(\".bar .x\"); if (b) b.focus(); }catch(e){} };\n"
+ (autoPrint ? "setTimeout(printAgain, 300);\n" : "setTimeout(measure, 300);\n")
+ "<\/script>";
  }
  // Same three buttons for a KOT opened as a page. It is a short ticket, so there is no page
  // measuring to do — printAgain() is just print().
  function pageScriptKot() {
    return "<script>\n"
+ "function printAgain(){ try{ print(); }catch(e){} }\n"
+ "function closeBill(){ try{ if (opener && !opener.closed) opener.focus(); }catch(e){} try{ close(); }catch(e){} }\n"
+ "addEventListener(\"keydown\", function(e){ if (e.key === \"Escape\") closeBill(); });\n"
+ "<\/script>";
  }

  var API = {
    billDocHtml: billDocHtml,
    kotDocHtml: kotDocHtml,
    kotLineHtml: kotLineHtml,
    billIdentity: billIdentity,
    splitTax: splitTax,
    discPct: discPct,
    inr: inr,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof globalThis !== "undefined") globalThis.LFH_BILLDOC = API;
  else if (typeof window !== "undefined") window.LFH_BILLDOC = API;
})();
