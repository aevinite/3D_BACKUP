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
    // (A DEFAULT_BILL constant used to sit here holding an invented address + phone number. It was
    // unwired on 2026-08-04 — a paying client's tax invoice must never carry another company's
    // details — and DELETED on 2026-08-05, because a dead constant holding exactly the wrong answer
    // is an invitation to wire it back in.)
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
      // NO INVENTED IDENTITY ON A REAL BILL (2026-08-04). These used to fall back to
      // DEFAULT_BILL for any restaurant that had not filled its Billing card — so a paying
      // client's tax invoice carried another company's address and a phone number that does not
      // exist, beside a real bill number. The GSTIN line below already refused to invent a value,
      // with a comment saying why; the same reasoning applies here. Empty prints NO line at all.
      address: s.restaurant_address || "",
      phone: s.restaurant_phone || (isDefault ? "+91 90999 14418" : ""),
      // NEVER fall back to a placeholder GSTIN — a fake tax number on a real bill is illegal.
      // Empty prints no GSTIN line (the document handles it).
      gstin: s.gstin || "",
      prefix: s.invoice_prefix || "INV",
      footer: s.bill_footer || FOOTERS[r.slug] || (isDefault ? "Merci — see you again soon 🥐" : "Thank you — please visit again"),
      taxLabel: ((s.tax_label || "Tax") + "").trim() || "Tax",
    };
  }

  /* billRows(d) — the whole-rupee money rows a bill SHOWS, worked out once so the paper and every
     screen quote the same figures and every one of them ADDS UP.

     WHY (2026-08-04). Every row here is rounded to whole rupees on its own, while the TOTAL is
     computed at full precision and only rounded at the end. Those two facts disagree, and on a
     DISCOUNTED bill they disagree often: replaying this document over whole-rupee subtotals with
     the discounts the modal offers (5/10/15/20/25/50%) printed rows that contradicted their own
     TOTAL in 4,508 of 13,806 cases — 32.7%. Undiscounted bills were always fine, which is why it
     went unnoticed. Two examples off the real numbers:
       · ₹201, 15% off → Taxable 171 + CGST 5 + SGST 4 = 180, but the TOTAL line said 179.
       · ₹201, 50% off → Discount −101 against Subtotal 201 and Taxable 101 (201−101 = 100).
     The amount COLLECTED was always right; it is the arithmetic on a document headed "Tax Invoice"
     that was wrong, and a guest who adds it up cannot be shown where the rupee went.

     Fixed by making the paper obey its identities by construction, and never by moving money — the
     TOTAL is passed straight through. 'Taxable value' is DERIVED as subtotal − discount, and a
     "Round off" row carries whatever the whole-rupee rows cannot express. That row is how every
     Indian POS bill states this, it is at most a rupee or two, and it is the honest place to put it;
     the alternative is silently bending one of the GST figures.

     It handles all four shapes this document prints (mig 270/272): plain, with MRP/untaxed lines,
     tax-inclusive, and inclusive-with-MRP — the additive chain a person reads differs in each, so
     'base' follows the rows actually shown above the TOTAL. */
  function billRows(d) {
    d = d || {};
    var disc = Number(d.discount) || 0;
    var inclusive = !!d.taxIncluded;
    var nontax = Math.round(Number(d.nontax) || 0);
    var subAmount = Math.round((Number(d.subtotal) || 0) - (Number(d.nontax) || 0));
    var subtotalShown = nontax > 0 ? subAmount : Math.round(Number(d.subtotal) || 0);
    var discount = Math.round(disc);
    var taxable = subtotalShown - discount;
    var tax = (d.taxRows || []).reduce(function (a, c) { return a + (Math.round(Number(c.amt)) || 0); }, 0);
    var total = Math.round(parseFloat(d.total) || 0);
    // What the rows above the TOTAL actually add up to, in the order a person reads them.
    // Non-inclusive keeps a "Taxable value" restatement when there is a discount; inclusive has
    // none (the tax is reported below the total, not added), so the chain is subtotal − discount.
    var base = disc > 0 ? taxable : subtotalShown;
    return {
      disc: disc, inclusive: inclusive, subtotal: subtotalShown, discount: discount,
      taxable: taxable, tax: tax, nontax: nontax, total: total,
      roundOff: total - (base + (inclusive ? 0 : tax) + nontax),
    };
  }

  /* ───────────────────────────── THE BILL ─────────────────────────────
   * d = {
   *   logo, name, addr, phone, gstin, footer,          // identity (raw, escaped here)
   *   invNo, billNo, parcel, tableDisp, dateStr,       // the header rows ("" hides a row)
   *   cust, custPhone,                                 // who it is for ("" hides the block)
   *   lines: [{ title, qty, price, options:[{label,price}], is_mrp }], // price = unit INCLUDING add-ons
   *   subtotal, discount, discLabel, taxable, taxRows:[{label,rate,amt}], total,
   *   taxIncluded,                                     // true = menu prices already contain
   *                                                    //   GST. Pass GROSS subtotal+discount;
   *                                                    //   tax prints BELOW the total as
   *                                                    //   "Price includes", never added.
   *   nontax, mrpLabel, mrpNote,                       // MRP / untaxed lines (mig 270).
   *                                                    // nontax 0 or absent = render as before.
   *                                                    // taxRows [] = no tax line at all
   *                                                    //   (a composition-scheme restaurant).
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
      // An MRP line wears its stamp right next to the name, in the one list where the guest
      // looks for it (owner's chosen layout, 2026-08-04). The stamp is the promise that this
      // price is FINAL — nothing below the line adds to it.
      var mrp = i.is_mrp ? '<span class="mrpt">MRP</span>' : "";
      var r = '<tr><td class="n">' + esc(i.title) + mrp + '</td><td class="c">' + pn(q) + '</td><td class="r">' + pn(baseUnit) + '</td><td class="r">' + pn(baseUnit * q) + "</td></tr>";
      for (var k = 0; k < opts.length; k++) {
        var x = opts[k];
        measure("rate", pn(x.price)); measure("amt", pn(Number(x.price) * q));
        r += '<tr class="ex"><td class="n" colspan="2">+ ' + esc(x.label) + '</td><td class="r">' + pn(x.price) + '</td><td class="r">' + pn(Number(x.price) * q) + "</td></tr>";
      }
      return r;
    }).join("");

    var money = function (list) {
      return (list || []).map(function (c) {
        return '<div class="t"><span>' + esc(c.label) + " " + c.rate + '%</span><span>' + inr(c.amt) + "</span></div>";
      }).join("");
    };
    var taxRows = money(d.taxRows);
    // What prints UNDER the total as "Price includes": the explicit inside-tax rows when the caller
    // supplies them, else — for the original all-or-nothing flag — the tax rows themselves.
    var inclBelow = (d.inclRows || []).length ? money(d.inclRows) : (d.taxIncluded ? taxRows : "");

    var disc = Number(d.discount) || 0;
    /* TAX ALREADY INSIDE THE PRICES IS REPORTED, NEVER ADDED — and it has to be.
       When menu prices already contain GST, the item rows show the GROSS price the guest
       recognises — so a "Taxable value" line (the net) sitting under them, with the tax then
       ADDED below, reads as an arithmetic error to anyone who checks the column: the rows sum
       to ₹1,340 and the subtotal says ₹1,276.
       So that tax is reported, not applied: Subtotal → Discount → TOTAL, and those lines sit
       BELOW the total labelled as already included. That is the standard tax-inclusive receipt
       and it foots exactly.

       TWO WAYS IN, because a bill can need BOTH at once (2026-08-05):
         · 'inclRows'    — the tax INSIDE the prices. Printed below the total. 'taxRows' stays the
                          tax genuinely ADDED on top, so a bill that mixes tax-inside and
                          tax-on-top dishes prints one of each and still foots. This is what
                          billData() now fills in.
         · 'taxIncluded' — the original all-or-nothing flag: treat 'taxRows' itself as inside-tax
                          and add nothing. Kept working for callers that pass it directly.
       This file formats; it never computes money (see the header) — the caller passes figures
       that already match the item rows above. */
    var inclusive = !!d.taxIncluded;
    var inclOnly = (d.inclRows || []).length > 0;
    // A "Taxable value" restatement only makes sense when the row above it really is the taxable
    // figure. With tax inside the prices it is the gross, so the restatement would misname it.
    var restate = !inclusive && !inclOnly;
    var discBlock = disc > 0
      ? '<div class="t"><span>Discount' + (d.discLabel ? " (" + esc(d.discLabel) + ")" : "") + "</span><span>− " + inr(billRows(d).discount) + "</span></div>"
        + (restate ? '<div class="t tx"><span>Taxable value</span><span>' + inr(billRows(d).taxable) + "</span></div>" : "")
      : "";

    /* MRP / untaxed lines (mig 270). 'nontax' is the part of the bill GST is NOT charged on —
       a sealed water bottle sold at its printed price. It is added AFTER the tax lines, which
       is exactly how the owner described it, and the first row above becomes "Food subtotal"
       so the column still FOOTS: food − discount = taxable value, and taxable + tax + MRP =
       total. (A "Subtotal" of 880 followed by "Taxable value 720" with only an 80 discount
       between them reads as an arithmetic error even though it isn't.)
       When there are no such lines — every restaurant today — nothing here renders and the
       bill is byte-identical to the one before this feature. */
    var nontax = Number(d.nontax) || 0;
    var subLabel = nontax > 0 ? "Food subtotal" : "Subtotal";
    // (There used to be a second `subAmount` computed here. It was dead — the render below reads
    // R.subtotal — so a later editor "fixing" one of the two would have changed nothing. Gone.)
    // THE ROWS MUST FOOT TO THE TOTAL (see billRows). Every figure below comes from there, so the
    // paper and the manager's screen quote the same whole-rupee numbers and they reconcile.
    var R = billRows(d);
    var roundBlock = R.roundOff !== 0
      ? '<div class="t"><span>Round off</span><span>' + (R.roundOff < 0 ? "− " : "+ ") + inr(Math.abs(R.roundOff)) + "</span></div>"
      : "";
    var mrpBlock = nontax > 0
      ? '<div class="t"><span>' + esc(d.mrpLabel || "MRP items") + "</span><span>" + inr(nontax) + "</span></div>"
      : "";
    /* The note only claims tax is inside the price when tax genuinely IS inside it — i.e.
       when the restaurant treats MRP as tax-inclusive. Saying it otherwise would be a
       statement on a tax invoice that the accounts do not support. */
    var mrpNote = (nontax > 0 && d.mrpNote)
      ? '<div class="mini" style="border-top:1px solid #000;margin-top:6px;padding-top:5px">' + esc(d.mrpNote) + "</div>"
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
+ "  /* The MRP stamp and the note under the total. Boxed outline rather than a shade —\n"
+ "     a thermal head has no grey (see the ONE INK note above), so a tint would print as\n"
+ "     broken dots. 10px is the floor; nothing smaller survives 203 dpi. */\n"
+ "  .mrpt{font-size:10px;letter-spacing:.08em;border:1px solid #000;border-radius:2px;\n"
+ "        padding:0 3px;margin-left:5px;white-space:nowrap}\n"
+ "  .mini{font-size:10.5px;text-align:center}\n"
+ "  /* the 'price includes' block sits UNDER the total: reported, not added */\n"
+ "  .incl{margin-top:5px;font-size:11px}\n"
+ "  .incl .t{padding:1px 0;font-size:11px}\n"
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
+ '  <div class="t"><span>' + subLabel + "</span><span>" + inr(R.subtotal) + "</span></div>\n"
+ "  " + discBlock + "\n"
+ "  " + (inclusive ? "" : taxRows) + "\n"
+ "  " + mrpBlock + "\n"
+ "  " + roundBlock + "\n"
+ '  <div class="g"><span>TOTAL</span><span>' + inr(R.total) + "</span></div>\n"
+ (inclBelow
   ? '  <div class="incl"><div class="t"><span>Price includes</span><span></span></div>' + inclBelow + "</div>\n"
   : "")
+ "</div>\n"
+ mrpNote + "\n"
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
// ONE INK ON THE TICKET TOO (2026-08-05). The bill was moved to pure #000 at weight 400 on
// 2026-07-30 because a thermal head has no grey — it fakes one with sparse dots, and light text
// came out broken and pale. The KOT prints on the SAME head and was left behind: options and
// removals ("(extra cheese)", "— no onion") were #333 ITALIC, and every line separator a #999
// dotted rule. Those are the lines a cook must read correctly on a rushed pass, so they were the
// worst place to keep grey. Hierarchy is size, as on the bill; nothing here is under 12px.
+ "      .kl{font-size:14px;padding:4px 0;border-bottom:1px solid #000}.kl .q{font-weight:700;margin-right:6px}.kl i{font-style:normal;color:#000;font-size:12px}\n"
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


  /* ─────────────────── THE BILL'S MONEY, AND THE DATA THE PAPER NEEDS ───────────────────
   * Moved here 2026-08-04 so the WAITER PANEL can print a bill at all.
   *
   * It could not: it can take the money, split it, capture the customer and mint a numbered tax
   * invoice — every step of issuing one except producing it — because the whole assembly of a
   * bill's DATA lived inside the manager panel's printBill(). The obvious shortcut was to write a
   * second assembler on the tablet, which is precisely the fault this file exists to prevent (and
   * the one just removed from the split-payment path). So the assembly moved to where the document
   * already lives, and both panels feed it.
   *
   * Everything here is PURE — orders and settings in, figures out, no panel state — which is why
   * it can be shared at all. The manager's taxModel()/billMath()/combineBillLines() are now
   * one-line doors onto these, so the existing call sites are untouched.
   */

  // priceTaxMode / taxModel: the ONE tax model. Mirrors lib/tax.ts and SQL lfh_effective_tax_rate;
  // a composition-scheme restaurant's rate genuinely IS zero (mig 272), not "5% we then hide".
  function priceTaxMode(s) { return String((s || {}).price_tax_mode || "excl"); }
  function taxModel(settings) {
    var s = settings || {};
    var comps = Array.isArray(s.tax_components) ? s.tax_components
      .map(function (c) { return { label: String((c && c.label) || "").trim(), rate: Number(c && c.rate) || 0 }; })
      .filter(function (c) { return c.label && c.rate > 0; }) : [];
    var composition = priceTaxMode(s) === "composition";
    if (composition) return { rate: 0, pct: 0, components: [], composition: composition };
    if (comps.length) {
      var pct = comps.reduce(function (a, c) { return a + c.rate; }, 0);
      return { rate: pct / 100, pct: Math.round(pct * 100) / 100, components: comps, composition: composition };
    }
    var rate = Number(s.tax_rate) || 0.05;
    return { rate: rate, pct: Math.round(rate * 10000) / 100, components: [], composition: composition };
  }

  /* combineBillLines(entries): the BILL shows one line per dish, not one per KOT. Grouped by
     everything a guest can see differ — title, price, options, removals, note — so "Special 1"@50
     and "Special"@150 can never merge. The separator is a VISIBLE escape written as  rather
     than a raw byte: adjacent fields must not run together, and an invisible character in the
     source begs to be "tidied" away to "". */
  function combineBillLines(entries) {
    var SEP = "";
    var out = [], at = {};
    (entries || []).forEach(function (e) {
      var sig = [e.title, e.price, JSON.stringify(e.options || null), JSON.stringify(e.removed || null), e.note || ""].join(SEP);
      var i = at[sig];
      var qty = Math.max(1, parseInt(e.qty, 10) || 1);
      if (i == null) { at[sig] = out.length; out.push(Object.assign({}, e, { qty: qty })); }
      else out[i].qty += qty;
    });
    return out;
  }

  /* mrpTaxInside(orders, rate): the GST sitting INSIDE the MRP lines. Only meaningful when the
     restaurant treats MRP as tax-inclusive — under 'none' there is no tax on those lines to name,
     and saying otherwise on a tax invoice is a claim the accounts don't support. */
  function mrpTaxInside(orders, rate) {
    var inside = 0;
    (orders || []).filter(function (x) { return x.status !== "cancelled"; }).forEach(function (o) {
      (Array.isArray(o.items) ? o.items : []).forEach(function (i) {
        if (!i || !i.is_mrp || i.tax_mode !== "incl") return;
        var amt = Math.round((parseFloat(i.price) || 0) * Math.max(1, parseInt(i.qty, 10) || 1) * 100) / 100;
        inside += amt - Math.round((amt / (1 + rate)) * 100) / 100;
      });
    });
    return Math.round(inside * 100) / 100;
  }

  /* financialYear / invFmt: the FY of the INVOICE'S OWN date, never "today" — reprinting a March
     invoice after 1 April must keep its issued year, or one sale ends up with two identities and
     the reprint collides with the real invoice of that number. */
  function financialYear(when) {
    var d = when ? new Date(when) : new Date();
    var base = isNaN(d.getTime()) ? new Date() : d;
    var y = base.getFullYear();
    var start = base.getMonth() >= 3 ? y : y - 1;
    return start + "-" + String(start + 1).slice(2);
  }
  function invFmt(no, when, prefix) {
    if (no == null) return "";
    return (prefix || "INV") + "/" + financialYear(when) + "/" + String(no).padStart(6, "0");
  }

  /* billMoney(orders, settings): a bill's figures, once. Discount comes off BEFORE tax; the tax is
     charged on the TAXABLE BASE, not the subtotal (migs 270/272 — a bill can carry untaxed MRP
     lines or prices that already contain the tax); and the rate is the one the ORDER was actually
     charged at (orders.tax_rate, mig 284) so a banquet is never re-taxed at the dine-in rate and a
     rate corrected today cannot re-price a bill taken this morning. */
  function billMoney(orders, settings) {
    // A SOFT-DELETED ORDER IS NOT ON THE BILL (2026-08-05). This filtered only `cancelled`, so a
    // tombstoned order stayed in the subtotal, the tax and the TOTAL — while lib/billLedger.ts
    // drops it, so the paper charged for a line the admin ledger said was not there. Whichever is
    // right they may not disagree (COMPLIANCE §3, reconcile to the rupee), and a deleted line is
    // by definition off the bill.
    var live = (orders || []).filter(function (o) { return o.status !== "cancelled" && !o.deleted_at; });
    var tm = taxModel(settings);
    var r2 = function (n) { return Math.round(n * 100) / 100; };
    // THE RATE EACH ORDER WAS ACTUALLY CHARGED AT (orders.tax_rate, mig 284), per order — not one
    // rate borrowed from whichever order happened to come first (2026-08-05). Taking `find(> 0)`
    // for the whole bill re-taxed every other order at that rate, so a banquet at 18% sharing a
    // session with 5% dine-in food over-charged the food, which is the exact re-pricing mig 284
    // exists to prevent. `> 0` is kept deliberately: a genuine 0 (composition) falls through to
    // the settings, which also answer 0 — guarded by verify:audit.
    var rateOf = function (o) { return Number(o.tax_rate) > 0 ? Number(o.tax_rate) : tm.rate; };
    var taxableBase = 0, nontax = 0, mrpAmount = 0, hasMrp = false, grossTaxed = 0, netIncl = 0;
    // One bucket per distinct rate, so the tax is still rounded ONCE per rate (never per order —
    // that drifts ±½ paise an order and can reject a split that equals the printed bill).
    var buckets = {};
    live.forEach(function (o) {
      var sub = parseFloat(o.subtotal) || 0;
      var base = o.taxable_base == null ? sub : (parseFloat(o.taxable_base) || 0);
      var ntx = o.nontax_amount == null ? 0 : (parseFloat(o.nontax_amount) || 0);
      taxableBase += base;
      nontax += ntx;
      var r = rateOf(o);
      var k = String(r);
      var bk = buckets[k] || (buckets[k] = { rate: r, base: 0, disc: 0 });
      bk.base += base;
      bk.disc += parseFloat(o.discount) || 0;
      var lines = Array.isArray(o.items) ? o.items : [];
      if (o.mrp_amount != null) mrpAmount += parseFloat(o.mrp_amount) || 0;
      else lines.forEach(function (i) { if (i && i.is_mrp) mrpAmount += r2((parseFloat(i.price) || 0) * Math.max(1, parseInt(i.qty, 10) || 1)); });
      if (!hasMrp && lines.some(function (i) { return i && i.is_mrp; })) hasMrp = true;
      // What the ITEM ROWS on the paper add up to for the TAXED lines, and how much of that base
      // came from prices that ALREADY CONTAIN their tax. On an ordinary bill grossTaxed equals the
      // taxable base and netIncl is 0; on a tax-inside bill the rows show the gross menu price, so
      // grossTaxed is bigger. Both fall back to 0 when a row carries no items, which makes
      // `taxInside` 0 and the bill print exactly as it does today.
      lines.forEach(function (i) {
        if (!i) return;
        var mode = String(i.tax_mode || "excl");
        if (mode === "exempt") return;
        var amt = r2((parseFloat(i.price) || 0) * Math.max(1, parseInt(i.qty, 10) || 1));
        grossTaxed += amt;
        if (mode === "incl") netIncl += r2(amt / (1 + r));
      });
    });
    taxableBase = r2(taxableBase); nontax = r2(nontax); mrpAmount = r2(mrpAmount);
    grossTaxed = r2(grossTaxed); netIncl = r2(netIncl);
    var subtotal = r2(taxableBase + nontax);
    var rateList = Object.keys(buckets).map(function (k) { return buckets[k]; });
    // The headline rate: the one the bill is actually on. With several, the biggest taxed slice
    // speaks for the bill and `mixedRates` tells the document to name each rate on its own line.
    rateList.sort(function (a, b) { return b.base - a.base; });
    var rate = rateList.length ? rateList[0].rate : tm.rate;
    var mixedRates = rateList.length > 1;
    // What may be discounted (mig 272's lfh_order_discount_base): with tax, the taxable base — the
    // discount MUST land there or the `total − discount × (1 + rate)` identity stops holding. With
    // no tax, everything except the locked MRP.
    var anyTax = rateList.some(function (b) { return b.rate > 0; }) || (!rateList.length && rate > 0);
    var discountBase = anyTax ? taxableBase : Math.max(0, r2(subtotal - mrpAmount));
    var discountFixed = anyTax ? nontax : mrpAmount;
    var rawDisc = r2(live.reduce(function (a, o) { return a + (parseFloat(o.discount) || 0); }, 0));
    var disc = Math.min(Math.max(0, rawDisc), discountBase);
    var taxable = Math.max(0, r2(taxableBase - Math.min(disc, taxableBase)));
    // Tax per rate bucket, each rounded once, each capping its own discount at its own base.
    var tax = 0;
    var taxRowsByRate = [];
    rateList.forEach(function (bk) {
      var bBase = r2(bk.base);
      var bDisc = Math.min(Math.max(0, r2(bk.disc)), bBase);
      var bTaxable = Math.max(0, r2(bBase - bDisc));
      var bTax = r2(bTaxable * bk.rate);
      tax = r2(tax + bTax);
      if (bk.rate > 0) taxRowsByRate.push({ rate: bk.rate, taxable: bTaxable, tax: bTax });
    });
    var total = r2(subtotal - disc + tax);
    // How much of that tax is INSIDE the printed prices (nothing to add) versus ADDED on top.
    // Apportioned by the share of the taxable base that came from tax-inside prices, so the two
    // always sum back to `tax` and the TOTAL is untouched. On every ordinary bill netIncl is 0, so
    // taxInside is 0, taxAdded is the whole tax, and nothing below changes by a paise.
    var taxInside = 0, taxAdded = tax;
    if (netIncl > 0 && taxableBase > 0) {
      var share = Math.min(1, Math.max(0, netIncl / taxableBase));
      taxInside = r2(tax * share);
      taxAdded = r2(tax - taxInside);
    }
    // Components carried through ONLY when they describe THIS bill's rate: a banquet at 18% must
    // not be itemised with the dine-in CGST 2.5% + SGST 2.5% labels — splitTax would hand out the
    // right rupees under percentages that do not add up to what was charged.
    var compPct = (tm.components || []).reduce(function (a, c) { return a + (Number(c.rate) || 0); }, 0);
    var compsMatch = !mixedRates && (tm.components || []).length > 0 && Math.abs(compPct / 100 - rate) < 0.0001;
    return {
      subtotal: subtotal, disc: disc, taxable: taxable, rate: rate, tax: tax, total: total,
      taxComponents: compsMatch ? tm.components : [],
      taxableBase: taxableBase, nontax: nontax, mrpAmount: mrpAmount,
      discountBase: discountBase, discountFixed: discountFixed, hasMrp: hasMrp,
      composition: tm.composition,
      // NEW (2026-08-05), all zero/false on an ordinary bill so nothing renders differently:
      grossTaxed: grossTaxed,        // what the taxed ITEM ROWS add up to
      taxInside: taxInside,          // the part of `tax` already inside those prices
      taxAdded: taxAdded,            // the part still to be added on top
      mixedRates: mixedRates,        // several rates on one bill → name each rate on its own line
      rateRows: taxRowsByRate,       // [{rate, taxable, tax}] per rate, biggest slice first
    };
  }
  // The untaxed pile AS A BILL SHOULD SHOW IT: on a composition restaurant EVERY line is untaxed,
  // so splitting into "food" and "MRP" says nothing and reads as broken ("Food subtotal 0 / MRP
  // items 880"). There the plain single Subtotal row is simpler and truer.
  function mrpPart(m) { return m && m.composition ? 0 : (Number(m && m.nontax) || 0); }

  /* billData(a): everything the paper needs, assembled once. 'a' is what only the PANEL knows:
       settings, restaurant, orders, money (billMoney), session, tableDisp, logo, parcel, autoPrint
     Returns the object billDocHtml() takes, so a caller does:
       BILLDOC.billDocHtml(BILLDOC.billData({ ... }))
     and there is exactly one place that decides what goes on a bill. */
  function billData(a) {
    a = a || {};
    var s = a.settings || {};
    var orders = a.orders || [];
    var m = a.money || billMoney(orders, s);
    var live = orders.filter(function (o) { return o.status !== "cancelled"; });
    var bi = billIdentity(s, a.restaurant || {});

    // WHO THE BILL IS FOR, in priority order: the pair captured at invoice time and stored on the
    // bill itself (mig 227), else the guest's own name. Printing them is the restaurant's switch;
    // they are always SAVED either way. Blank hides the line rather than printing it empty.
    var printCust = s.bill_customer_print !== false;
    var row = orders.find(function (o) { return o.bill_cust_name || o.bill_cust_phone; }) || {};
    var named = orders.find(function (o) { return String(o.customer_name || "").trim(); }) || {};
    var cust = printCust ? (row.bill_cust_name || named.customer_name || "") : "";
    var phoneRaw = printCust ? String(row.bill_cust_phone || "").replace(/\D/g, "") : "";
    // 10 digits print as "98250 12345" — easier to read back to a guest than one long run.
    var custPhone = phoneRaw.length === 10 ? phoneRaw.slice(0, 5) + " " + phoneRaw.slice(5) : phoneRaw;

    var sess = a.session || {};
    var pct = Math.round(m.rate * 10000) / 100;
    var taxComps = (m.taxComponents && m.taxComponents.length)
      ? m.taxComponents
      : [{ label: "CGST", rate: pct / 2 }, { label: "SGST", rate: pct / 2 }];
    var inside = String(s.mrp_tax_treatment) === "inclusive" ? mrpTaxInside(live, m.rate) : 0;
    // A REPRINT KEEPS THE BILL'S OWN DATE (2026-08-05). This was always `new Date()` and no caller
    // ever passed `a.now`, so reprinting last June's invoice stamped today on it — beside an invoice
    // number whose financial year says otherwise. financialYear() two functions up already reasons
    // about exactly this hazard for the NUMBER; the date row never got the same treatment. Order of
    // truth: an explicit `now`, then when the invoice was issued, then when the bill closed, then
    // really now (a bill still open on the floor).
    var stampAt = a.now || sess.invoice_at || sess.closed_at || null;
    var stamped = stampAt ? new Date(stampAt) : null;
    var now = stamped && !isNaN(stamped.getTime()) ? stamped : new Date();

    // ── THE TAX THAT IS ALREADY INSIDE THE PRICES vs THE TAX STILL TO ADD ────────────────────
    // A restaurant on "GST inside the price" (price_tax_mode='incl') prints item rows at the GROSS
    // menu price the guest recognises, so a NET "Subtotal" under that column does not equal it: the
    // rows said ₹1,340 and the subtotal said ₹1,276 (found 2026-08-05). The document has always had
    // the right layout for this — tax reported BELOW the total, never added — and nothing ever
    // switched it on, because billData never set `taxIncluded`.
    //
    // Fixed by telling the paper what the rows actually add up to. `m.grossTaxed` is the sum of the
    // taxed item rows, so the Subtotal always matches the column above it, and `m.taxInside` /
    // `m.taxAdded` split the tax into the part already in those prices and the part to add. On every
    // ordinary bill grossTaxed === taxableBase, taxInside is 0, and every figure below is unchanged.
    var hasInside = m.taxInside > 0;
    // The food row as the paper shows it. Without inside tax this is exactly what it always was
    // (subtotal less whatever the MRP row states separately) — which matters for a COMPOSITION
    // restaurant, where every line is exempt so there is no taxable base to read instead.
    var foodShown = hasInside ? m.grossTaxed : Math.round((m.subtotal - mrpPart(m)) * 100) / 100;
    var subtotalShown = Math.round((foodShown + mrpPart(m)) * 100) / 100;
    // The discount as the PAPER must state it, so the column closes: what is shown at the top, less
    // the tax that is genuinely added, less the untaxed pile, must leave the TOTAL. On an ordinary
    // bill this is exactly m.disc; on a tax-inside bill it is that discount grossed up, which is what
    // a guest sees come off a price that already contained its tax.
    var discShown = m.disc > 0
      ? Math.max(0, Math.round((foodShown + m.taxAdded + mrpPart(m) - m.total) * 100) / 100)
      : 0;
    // One tax line per RATE when a bill carries more than one (a banquet at 18% beside 5% food):
    // naming a single percentage there would put the right rupees under a rate nobody was charged.
    // A ₹0 tax line reads as a mistake, so when there is nothing to ADD the rows are dropped rather
    // than printed as zeros (the same rule the guest cart follows for a bill with nothing to add).
    var addWhole = Math.round(m.taxAdded);
    var addRows = (m.composition || addWhole <= 0)
      ? []
      : (m.mixedRates
        ? (m.rateRows || []).filter(function (b) { return Math.round(b.tax) > 0; }).map(function (b) {
          return { label: ((s.tax_label || "GST") + "").trim() || "GST", rate: Math.round(b.rate * 10000) / 100, amt: Math.round(b.tax) };
        })
        : splitTax(addWhole, taxComps));
    var insideWhole = Math.round(m.taxInside);
    var inclRows = (m.composition || !hasInside || insideWhole <= 0) ? [] : splitTax(insideWhole, taxComps);

    return {
      logo: a.logo || "",
      name: bi.name, addr: bi.address, phone: bi.phone, gstin: bi.gstin, footer: bi.footer,
      invNo: sess.invoice_no != null ? invFmt(sess.invoice_no, sess.invoice_at, bi.prefix) : "",
      billNo: sess.bill_no != null ? sess.bill_no : "",
      parcel: !!a.parcel,
      tableDisp: a.tableDisp || "—",
      dateStr: now.toLocaleDateString() + " " + now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      cust: cust, custPhone: custPhone,
      lines: combineBillLines(live.reduce(function (acc, o) { return acc.concat(Array.isArray(o.items) ? o.items : []); }, [])),
      subtotal: subtotalShown, discount: discShown,
      discLabel: discPct(foodShown, discShown),
      taxable: m.taxable, total: m.total,
      taxRows: addRows,
      inclRows: inclRows,
      nontax: mrpPart(m), mrpLabel: "MRP items",
      mrpNote: inside > 0 ? "MRP items include " + inr(inside) + " " + (((s.tax_label || "GST") + "").trim() || "GST") : "",
      autoPrint: a.autoPrint !== false,
    };
  }

  // The banquet sheet's own money formatters: 2dp with Indian grouping, and whole numbers.
  var bq2 = function (n) { return (Math.round((Number(n) || 0) * 100) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
  var bq0 = function (n) { return Math.round(Number(n) || 0).toLocaleString("en-IN"); };

  // bqPaper(settings): the banquet sheet setup — A4/A5, margins, pad mode, the fill rows.
  function bqPaper(settings) {
  const s = settings || {};
  const num = (v, lo, hi, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
  return {
    pad: s.banquet_paper === "pad",
    size: s.banquet_paper_size === "a4" ? "a4" : "a5",
    top: num(s.banquet_paper_top, 0, 80, 33),
    bot: num(s.banquet_paper_bot, 0, 50, 14),
    side: num(s.banquet_paper_side, 2, 25, 6),
    foot: s.banquet_paper_foot === true,
    sign: s.banquet_paper_sign !== false,
    fill: s.banquet_paper_fill !== false,
  };
}

  // bqTaxModel(settings): a banquet is taxed at its OWN rate (mig 239), falling back to the
  // restaurant's dine-in model when it has set none.
  function bqTaxModel(settings) {
  const s = settings || {};
  const raw = Array.isArray(s.banquet_tax_components) ? s.banquet_tax_components : [];
  const comps = raw.map((c) => ({ label: String((c && c.label) || "").trim(), rate: Number(c && c.rate) || 0 }))
    .filter((c) => c.label && c.rate > 0);
  if (comps.length) {
    const pct = comps.reduce((a, c) => a + c.rate, 0);
    return { rate: pct / 100, pct: Math.round(pct * 100) / 100, components: comps, own: true };
  }
  const tm = taxModel(s);
  return { rate: tm.rate, pct: tm.pct, components: tm.components, own: false };
}


  // Which optional fields this restaurant asks for on a banquet bill (settings.banquet_fields).
  // Pure over settings, like the rest of the banquet document.
  var BQ_DEFAULT_FIELDS = ["cust_name", "cust_phone", "dish", "pax", "rate", "advance"];
  function bqOn(settings, k) {
    var f = (settings || {}).banquet_fields;
    var list = Array.isArray(f) && f.length ? f : BQ_DEFAULT_FIELDS;
    return list.indexOf(k) >= 0;
  }

  // Amount in words for the banquet tax invoice — Indian grouping (Crore / Lakh / Thousand).
  var BQ_ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve",
    "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  var BQ_TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
function bqWords(amount) {
  const two = (n) => (n < 20 ? BQ_ONES[n] : BQ_TENS[Math.floor(n / 10)] + (n % 10 ? "-" + BQ_ONES[n % 10] : ""));
  const three = (n) => (n >= 100 ? BQ_ONES[Math.floor(n / 100)] + " Hundred" + (n % 100 ? " " : "") : "") + (n % 100 ? two(n % 100) : "");
  // THE WORDS MUST NAME THE SAME AMOUNT AS THE FIGURE BESIDE THEM (2026-08-05). This floored to
  // whole rupees while the total prints 2dp (bq2), so a ₹1,234.56 banquet invoice read "One Thousand
  // Two Hundred Thirty-Four Only" next to "1,234.56". On a tax invoice the amount in words is the
  // controlling figure, so the paper contradicted itself. Paise are now said when there are any.
  const exact = Math.round(Math.abs(Number(amount) || 0) * 100);
  const paise = exact % 100;
  const tail = paise ? " Rupees and " + two(paise) + " Paise Only" : " Only";
  let n = Math.floor(exact / 100);
  if (!n) return paise ? two(paise) + " Paise Only" : "Zero Only";
  const p = [];
  const cr = Math.floor(n / 1e7); n %= 1e7;
  const la = Math.floor(n / 1e5); n %= 1e5;
  const th = Math.floor(n / 1e3); n %= 1e3;
  if (cr) p.push(three(cr) + " Crore");
  if (la) p.push(three(la) + " Lakh");
  if (th) p.push(three(th) + " Thousand");
  if (n) p.push(three(n));
  return p.join(" ").trim() + tail;
}


  /* ───────────────────────── THE BANQUET BILL ─────────────────────────
   * The third piece of paper, moved here 2026-08-04 — it was the last document that still existed
   * TWICE. The real one lived in the manager panel; the admin's "See the banquet bill" button drew
   * its own from scratch, and the two had already parted company: the printer re-uses the bill's
   * FROZEN tax_lines (mig 239) while the preview recomputed them live, and the printer honours the
   * A4/A5 paper setup which the preview did not model at all. So an admin could set the banquet card
   * up, approve what they saw, and the paper came out different — the exact fault that created this
   * file for the bill and the KOT, still alive in the one document nobody had got to.
   *
   * verify:print-format now fingerprints this document too, so a third copy cannot appear.
   *
   * a = { bill, lines, settings, restaurant, logo }. Pure: no panel state, returns the HTML.
   */
function banquetDocHtml(a) {
    var b = a.bill || {}, lines = a.lines || [];
    var s = a.settings || {};
    var bi = billIdentity(s, a.restaurant || {});
    var P = bqPaper(s);
  const isA4 = P.size === "a4";
  const W = isA4 ? 210 : 148, H = isA4 ? 297 : 210;
  const when = new Date(b.issued_at || Date.now());
  const dstr = when.toLocaleDateString("en-GB").replace(/\//g, "-");
  const tstr = when.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }).toUpperCase().replace(" ", "");
  const sub = Number(b.subtotal) || 0, disc = Number(b.discount) || 0;
  const taxAmt = Number(b.tax) || 0, total = Number(b.total) || 0;
  const recv = Number(b.received) || 0;
  const bal = Math.round((total - recv) * 100) / 100;
  const taxable = Math.round((sub - disc) * 100) / 100;
  // Owner 2026-07-31: "whatever is in the bill I have sent you of banquet, it should be
  // like that" — a banquet bill ALWAYS prints as a tax invoice with the per-line taxable
  // value + CGST/SGST columns. The receiver's GSTIN line only shows when there is one.
  const b2b = true;
  const hasCustGstin = !!String(b.cust_gstin || "").trim();
  // named tax components, or the historical CGST+SGST halves; the last one takes the
  // remainder so the printed lines always foot to the tax on the total.
  // The split PRINTED on this bill. A saved bill carries its own frozen tax_lines
  // (mig 239), so re-printing after a rate change can never re-split an old total.
  var tmB = bqTaxModel(s);
  // COMPONENTS ONLY WHEN THEY DESCRIBE THIS BILL'S OWN RATE (2026-08-05) — the same guard the
  // thermal bill has had (billMoney's compsMatch) and this sheet did not. A banquet bill carries a
  // FROZEN tax split (mig 239) so a later rate change cannot re-price it; but bills written before
  // 239 have an empty `tax_lines`, and this then fell back to the LIVE component rates while every
  // amount was still split out of the bill's STORED tax. One sheet ended up stating three different
  // things: the item line claimed 9% = ₹21,600, the column's own TOTAL row said ₹6,000, and the
  // summary labelled ₹6,000 as "9%". So: use the configured components only if their sum really is
  // the rate this bill was charged, else name the bill's own effective rate on one line.
  const billRate = taxable > 0 ? Math.round((taxAmt / taxable) * 10000) / 10000 : 0;
  const cPct = (tmB.components || []).reduce((a, c) => a + (Number(c.rate) || 0), 0);
  const cMatch = (tmB.components || []).length > 0 && Math.abs(cPct / 100 - billRate) < 0.0005;
  const halvesMatch = Math.abs(tmB.pct / 100 - billRate) < 0.0005;
  const comps = cMatch ? tmB.components
    : (halvesMatch
      ? [{ label: "CGST", rate: tmB.pct / 2 }, { label: "SGST", rate: tmB.pct / 2 }]
      : [{ label: ((s.tax_label || "GST") + "").trim() || "GST", rate: Math.round(billRate * 10000) / 100 }]);
  let taxRows;
  if (Array.isArray(b.tax_lines) && b.tax_lines.length) {
    taxRows = b.tax_lines.map((c) => ({ label: String(c.label || ""), rate: Number(c.rate) || 0, amt: Number(c.amt) || 0 }));
  } else {
    const rateSum = comps.reduce((a, c) => a + (Number(c.rate) || 0), 0) || 1;
    let run = 0;
    taxRows = comps.map((c, i) => {
      const amt = i === comps.length - 1 ? Math.round((taxAmt - run) * 100) / 100
        : Math.round(taxAmt * ((Number(c.rate) || 0) / rateSum) * 100) / 100;
      run = Math.round((run + amt) * 100) / 100;
      return { label: c.label, rate: Number(c.rate) || 0, amt };
    });
  }
  const L = (lines || []).map((l) => {
    const gross = (Number(l.qty) || 0) * (Number(l.price) || 0);
    return { title: l.title, qty: Number(l.qty) || 0, price: Number(l.price) || 0, gross };
  });
  // per-line taxable value: the bill's discount spread pro-rata so the column foots
  const grossAll = L.reduce((a, l) => a + l.gross, 0) || 1;
  L.forEach((l) => { l.taxable = Math.round((l.gross - disc * (l.gross / grossAll)) * 100) / 100; });

  const cols = 5 + taxRows.length * 2;
  // One <col> per column. Built by concatenation, NOT by joining half-open tags — the
  // clever join printed a stray "<" on the paper (caught in the print check).
  const colg = b2b
    ? `<col style="width:7mm"><col><col style="width:11mm"><col style="width:14mm"><col style="width:19mm">`
      + taxRows.map(() => `<col style="width:10mm"><col style="width:15mm">`).join("")
    : `<col style="width:7mm"><col><col style="width:14mm"><col style="width:18mm"><col style="width:22mm">`;
  const head = b2b
    ? `<tr><th rowspan="2">Sr</th><th rowspan="2">Item Name</th><th rowspan="2">Qty.</th><th rowspan="2">Rate</th><th rowspan="2">Taxable<br/>Value</th>${taxRows.map((c) => `<th colspan="2">${esc(c.label)}</th>`).join("")}</tr>
       <tr>${taxRows.map(() => "<th>Rate</th><th>Amount</th>").join("")}</tr>`
    : `<tr><th>Sr</th><th>Item Name</th><th>Qty.</th><th>Rate</th><th>Amount</th></tr>`;
  const rows = L.map((l, i) => {
    const nameCell = `<td class="n">${esc(l.title)}</td>`;
    if (!b2b) return `<tr><td class="c">${i + 1}</td>${nameCell}<td class="c">${bq0(l.qty)}</td><td class="r">${bq2(l.price)}</td><td class="r">${bq2(l.gross)}</td></tr>`;
    const tds = taxRows.map((c) => `<td class="c">${bq2(c.rate)}%</td><td class="r">${bq2(Math.round(l.taxable * (c.rate / 100) * 100) / 100)}</td>`).join("");
    return `<tr><td class="c">${i + 1}</td>${nameCell}<td class="c">${bq0(l.qty)}</td><td class="r">${bq2(l.price)}</td><td class="r">${bq2(l.taxable)}</td>${tds}</tr>`;
  }).join("");
  const fillN = P.fill ? Math.max(0, (isA4 ? 12 : 6) - L.length) : 0;
  let fill = "";
  for (let i = 0; i < fillN; i++) fill += `<tr class="fill">${"<td></td>".repeat(cols)}</tr>`;
  // The reference bill foots its columns INSIDE the table (TOTAL | taxable | each tax),
  // which is also the proof that the per-line tax columns add up to the summary.
  const totRow = `<tr class="tot"><td colspan="4" class="r">TOTAL</td><td class="r">${bq2(taxable)}</td>`
    + taxRows.map((c) => `<td></td><td class="r">${bq2(c.amt)}</td>`).join("") + `</tr>`;

  // Terms box: the advances, the remark, and the function line — each only if present.
  const terms = [];
  for (const a of (b.advances || [])) {
    if (Number(a.amt) > 0) {
      const d = a.date ? new Date(a.date).toLocaleDateString("en-GB") : "";
      terms.push(`${esc(String(a.mode || "").toUpperCase())} PAY${d ? " DT." + d : ""} — ${bq0(a.amt)}/-`);
    }
  }
  if (b.remark) terms.push(esc(b.remark));
  const fnBits = [];
  if (b.func) fnBits.push(esc(b.func));
  if (b.fn_date) fnBits.push(new Date(b.fn_date).toLocaleDateString("en-GB") + (b.fn_from ? ` ${esc(b.fn_from)}${b.fn_to ? "–" + esc(b.fn_to) : ""}` : ""));
  if (b.pax) fnBits.push(b.pax + (b.func || b.fn_date ? " pax" : " plates"));
  const fnLead = fnBits.length && (b.func || b.fn_date) ? "Function: " : "";
  const toBits = [];
  if (b.cust_name) toBits.push(`<div class="who">${esc(b.cust_name)}</div>`);
  if (b.cust_addr) toBits.push(`<div class="adr">${esc(b.cust_addr).split("\n").join("<br/>")}</div>`);
  const line2 = [b.cust_person, b.cust_phone].filter(Boolean).map(esc).join(" · ");
  if (line2) toBits.push(`<div class="adr">${line2}</div>`);
  if (hasCustGstin) toBits.push(`<div style="font-size:7.6pt;margin-top:1.2mm">GSTIN / UID&nbsp;: <b>${esc(b.cust_gstin)}</b></div>`);

  const money = [];
  money.push(`<div class="ms"><span>Subtotal</span><i>${bq2(sub)}</i></div>`);
  if (disc > 0) money.push(`<div class="ms"><span>Discount</span><i>− ${bq2(disc)}</i></div><div class="ms"><span>Taxable value</span><i>${bq2(taxable)}</i></div>`);
  taxRows.forEach((c) => money.push(`<div class="ms"><span>${esc(c.label)} ${c.rate}%</span><i>${bq2(c.amt)}</i></div>`));
  const roundOff = Math.round((total - (taxable + taxAmt)) * 100) / 100;
  if (roundOff) money.push(`<div class="ms"><span>Round off</span><i>${(roundOff > 0 ? "+" : "") + bq2(roundOff)}</i></div>`);
  money.push(`<div class="ms tot"><span>INVOICE TOTAL</span><i>${bq2(total)}</i></div>`);
  if (recv > 0) {
    money.push(`<div class="ms bal"><span>Received</span><i>${bq2(recv)}</i></div>`);
    money.push(`<div class="ms" style="font-weight:700"><span>${bal > 0 ? "Balance due" : "Balance"}</span><i>${bq2(Math.max(0, bal))}</i></div>`);
  }

  return `<!doctype html><html><head><meta charset="utf-8"><title>Tax Invoice ${esc(b.bill_no || "")} — ${esc(bi.name)}</title>
<style>
  /* A5/A4 sheet print recipe: an EXPLICIT @page size is correct here (unlike the 80mm
     thermal bill, where forcing a size makes CUPS rotate the job) because the tray
     really holds this sheet. margin:0 kills the browser's own header/footer. */
  @page{size:${W}mm ${H}mm;margin:0}
  *{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  html,body{margin:0;padding:0;background:#fff}
  .pg{width:${W}mm;min-height:${H}mm;background:#fff;color:#000;position:relative;
      font-family:"Helvetica Neue",Helvetica,Arial,sans-serif;font-size:${isA4 ? 9.4 : 8.2}pt;line-height:1.34}
  .body{padding:0 ${P.side}mm ${P.bot}mm}
  .selfhead{text-align:center;padding:${P.pad ? 0 : 4}mm 0 2.2mm;border-bottom:1.1px solid #000;margin-bottom:1.4mm}
  .selfhead .nm{font-size:${isA4 ? 16 : 14}pt;font-weight:800;letter-spacing:.2px}
  .selfhead .ad{font-size:7.5pt;line-height:1.34;margin-top:.7mm}
  .doct{text-align:center;margin:2.4mm 0 2mm}
  .doct b{font-size:10pt;font-weight:700;letter-spacing:.22em;text-transform:uppercase}
  table{width:100%;border-collapse:collapse}
  .bx{border:1px solid #000}
  .bx td{border:1px solid #000;padding:1.5mm 1.9mm;vertical-align:top}
  .lbl{font-size:6.7pt;letter-spacing:.09em;text-transform:uppercase;opacity:.7}
  .who{font-weight:700;font-size:8.7pt;text-transform:uppercase;letter-spacing:.2px;margin-top:.5mm}
  .adr{font-size:7.5pt;line-height:1.36;margin-top:.5mm}
  .v{font-weight:700;font-size:8.2pt;white-space:nowrap}
  .metag{display:grid;grid-template-columns:1fr 1fr;gap:1.4mm 2mm}
  .terms{font-size:7.4pt;line-height:1.44}
  table.it{border:1px solid #000;table-layout:fixed;margin-top:0}
  table.it th,table.it td{border:1px solid #000;padding:1.2mm 1.5mm;font-size:7.7pt}
  table.it th{font-weight:700;text-align:center;font-size:6.9pt;line-height:1.2}
  table.it td.n{text-align:left}table.it td.c{text-align:center}
  table.it td.r{text-align:right;font-variant-numeric:tabular-nums}
  table.it tr.fill td{height:5.4mm;border-top:0;border-bottom:0}
  table.it tr.tot td{font-weight:700;border-top:1px solid #000}
  .footg{display:flex;border:1px solid #000;border-top:0}
  .footg .fl{flex:1;padding:1.6mm 1.9mm;border-right:1px solid #000;min-width:0}
  .footg .fr{width:${isA4 ? 74 : 56}mm;padding:1.2mm 1.9mm}
  .wrd{font-size:7.6pt;line-height:1.38;margin-top:.4mm}
  .ms{display:flex;justify-content:space-between;gap:2mm;font-size:7.8pt;padding:.5mm 0}
  .ms.tot{border-top:1px solid #000;margin-top:.9mm;padding-top:1.1mm;font-weight:700;font-size:9.4pt}
  .ms.bal{border-top:1px dashed #000;margin-top:.9mm;padding-top:1.1mm;font-weight:700}
  .ms i{font-style:normal;font-variant-numeric:tabular-nums}
  .stamp{display:inline-block;border:1.1px solid #000;border-radius:1mm;padding:.5mm 2mm;font-size:7.4pt;
         font-weight:700;letter-spacing:.12em;margin-top:1.4mm}
  .sign{text-align:right;font-size:7.7pt;margin-top:2.6mm;line-height:1.5}
  .sign .sp{height:9mm}
  .pfoot{text-align:center;font-size:7.2pt;margin-top:3mm;line-height:1.45}
  /* Screen-only toolbar — the same one the bill and the KOT carry, and for the same reason
     (2026-08-05). This sheet used to fire the print dialog by itself, unconditionally, with no
     toolbar, no close button and no Esc: so the ADMIN'S PREVIEW threw a print dialog at them, and
     once dismissed the window could only be closed with the browser's own controls. Nothing here
     closes the window either — Print and Cancel are the same event to the page, which is why the
     bill stopped closing on afterprint on 2026-08-02. */
  .bar{position:sticky;top:0;z-index:9;display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;
       padding:10px 12px;background:#f2f2f4;border-bottom:1px solid #d8d8dc}
  .bar button{font:13px/1 system-ui,sans-serif;padding:7px 13px;border-radius:8px;cursor:pointer;
              border:1px solid #b9b9c0;background:#fff;color:#000}
  .bar button.x{background:#111;color:#fff;border-color:#111}
  .bar .note{margin-right:auto;align-self:center;text-align:left;max-width:52%;
             font:11.5px/1.35 system-ui,sans-serif;color:#3a3a42}
  @media print{.bar{display:none !important}}
  @media print{tr,.ms,.footg,.bx{break-inside:avoid}thead{display:table-row-group}}
</style></head><body>
<div class="bar">${a.note ? `<span class="note">${esc(a.note)}</span>` : ""}<button onclick="printAgain()">🖨 Print${a.autoPrint === false ? " this" : " again"}</button><button class="x" onclick="closeBill()">✕ Close</button></div>
<div class="pg">
  <div style="height:${P.pad ? P.top : 0}mm"></div>
  <div class="body">
    ${P.pad ? "" : `<div class="selfhead"><div class="nm">${esc(bi.name)}</div>
      <div class="ad">${esc(bi.address)}${bi.phone ? "<br/>Ph " + esc(bi.phone) : ""}${bi.gstin ? "<br/>GSTIN " + esc(bi.gstin) : ""}</div></div>`}
    <div class="doct"><b>Tax Invoice</b></div>
    <table class="bx">
      <tr>
        <td style="width:53%"><div class="lbl">Supplier</div><div class="who">${esc(bi.name)}</div>
          <div class="adr">${esc(bi.address)}</div>
          ${bi.gstin ? `<div style="font-size:7.5pt;margin-top:1mm">GSTIN&nbsp;: <b>${esc(bi.gstin)}</b></div>` : ""}</td>
        <td><div class="metag">
          <div><div class="lbl">Invoice No.</div><div class="v">${esc(b.bill_no || "—")}</div></div>
          <div><div class="lbl">Dated</div><div class="v">${esc(dstr)}</div></div>
          ${b.hall ? `<div><div class="lbl">Banq. Name</div><div class="v">${esc(b.hall)}</div></div>` : ""}
          <div><div class="lbl">Time</div><div class="v">${esc(tstr)}</div></div>
          ${b.table_number ? `<div><div class="lbl">Table</div><div class="v">${esc(String(b.table_number))}</div></div>` : ""}
        </div></td>
      </tr>
      ${toBits.length || terms.length || fnBits.length ? `<tr>
        <td>${toBits.length ? `<div class="lbl">Details of receiver (Bill to)</div>${toBits.join("")}`
             : `<div class="lbl">Bill to</div><div class="adr">Counter booking</div>`}</td>
        <td><div class="lbl">Terms &amp; conditions</div>
          ${terms.length ? `<div class="terms" style="margin-top:.6mm">${terms.join("<br/>")}</div>` : ""}
          ${fnBits.length ? `<div class="terms" style="margin-top:${terms.length ? "1mm" : ".6mm"}">${fnLead}${fnBits.join(" · ")}</div>` : ""}
          ${!terms.length && !fnBits.length ? `<div class="terms" style="margin-top:.6mm">—</div>` : ""}</td>
      </tr>` : ""}
    </table>
    <table class="it" style="border-top:0"><colgroup>${colg}</colgroup><thead>${head}</thead><tbody>${rows}${fill}${totRow}</tbody></table>
    <div class="footg">
      <div class="fl"><div class="lbl">Invoice Total (In Words)</div>
        <div class="wrd">${esc(bqWords(total))}</div>
        ${recv > 0 ? `<div class="stamp">${bal > 0 ? "BALANCE DUE " + bq2(bal) : "PAID IN FULL"}</div>` : ""}</div>
      <div class="fr">${money.join("")}</div>
    </div>
    ${P.sign ? `<div class="sign">For <b>${esc(bi.name)}</b><div class="sp"></div>Authorised Signatory</div>` : ""}
    ${bqOn(s, "by") && b.prepared_by ? `<div style="font-size:7pt;margin-top:1.4mm">Prepared by ${esc(b.prepared_by)}</div>` : ""}
    ${P.foot ? `<div class="pfoot">${esc(bi.footer)}${bi.gstin ? "<br/>GST No: " + esc(bi.gstin) : ""}</div>` : ""}
  </div>
</div>
<script>
function printAgain(){ try{ print(); }catch(e){} }
function closeBill(){ try{ if (opener && !opener.closed) opener.focus(); }catch(e){} try{ close(); }catch(e){} }
addEventListener("keydown", function(e){ if (e.key === "Escape") closeBill(); });
onafterprint = function(){ try{ var b = document.querySelector(".bar .x"); if (b) b.focus(); }catch(e){} };
${a.autoPrint === false ? "" : "setTimeout(printAgain, 350);"}
<\/script>
</body></html>`;
}


  var API = {
    billDocHtml: billDocHtml,
    kotDocHtml: kotDocHtml,
    kotLineHtml: kotLineHtml,
    billIdentity: billIdentity,
    splitTax: splitTax,
    discPct: discPct,
    billRows: billRows,
    taxModel: taxModel,
    billMoney: billMoney,
    billData: billData,
    banquetDocHtml: banquetDocHtml,
    bqPaper: bqPaper,
    bqTaxModel: bqTaxModel,
    bqOn: bqOn,
    bqWords: bqWords,
    combineBillLines: combineBillLines,
    mrpTaxInside: mrpTaxInside,
    mrpPart: mrpPart,
    invFmt: invFmt,
    financialYear: financialYear,
    inr: inr,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof globalThis !== "undefined") globalThis.LFH_BILLDOC = API;
  else if (typeof window !== "undefined") window.LFH_BILLDOC = API;
})();
