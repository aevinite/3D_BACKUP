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
    // A 0% COMPONENT CANNOT CARRY RUPEES (2026-08-06). With one such component this handed it the
    // whole remainder and the paper printed "A 0% ₹19" — a line contradicting itself on a tax
    // invoice, which is the same look billRows() works to avoid. Unreachable today (taxModel and
    // lib/tax.ts both drop non-positive rates before this is called), but this function is exported
    // and callable on its own, and the amounts it hands out are printed as GST.
    var list = ((comps && comps.length) ? comps : []).filter(function (c) { return (Number(c && c.rate) || 0) > 0; });
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
    /* A FIELD OF SPACES IS AN EMPTY FIELD (T8 sweep #7, 2026-08-22).
       Every rule below says "empty prints NO line at all", and every one of them was defeated by a
       single typed space, because `s.x || fallback` treats "  " as a real value. A restaurant whose
       Billing card held a space in each box printed a letterhead reading

           <blank>            ← the h2, where the biggest text on a customer's bill goes
           Ph
           GSTIN

       — a "GSTIN" label with nothing after it on a document headed Tax Invoice, which is the exact
       thing the note below refuses to do with a placeholder. Trimmed at the one place that resolves
       the identity, so the document, the preview and the printer all agree. */
    var pick = function (v) { return String(v == null ? "" : v).trim(); };
    return {
      isDefault: isDefault,
      name: pick(s.restaurant_name) || (isDefault ? "Little French House" : (pick(r.logo_text) || pick(r.name && r.name.en) || "Restaurant")),
      // NO INVENTED IDENTITY ON A REAL BILL (2026-08-04). These used to fall back to
      // DEFAULT_BILL for any restaurant that had not filled its Billing card — so a paying
      // client's tax invoice carried another company's address and a phone number that does not
      // exist, beside a real bill number. The GSTIN line below already refused to invent a value,
      // with a comment saying why; the same reasoning applies here. Empty prints NO line at all.
      address: pick(s.restaurant_address),
      phone: pick(s.restaurant_phone) || (isDefault ? "+91 90999 14418" : ""),
      // NEVER fall back to a placeholder GSTIN — a fake tax number on a real bill is illegal.
      // Empty prints no GSTIN line (the document handles it).
      gstin: pick(s.gstin),
      prefix: pick(s.invoice_prefix) || "INV",
      footer: pick(s.bill_footer) || FOOTERS[r.slug] || (isDefault ? "Merci — see you again soon 🥐" : "Thank you — please visit again"),
      /* TWO PLACES, TWO DEFAULT WORDS, ONE SETTING (owner, 2026-08-28).
         "for the printed bill, it should show like it is CGST as GST and total GST and all that
         stuff … but for the panel I want to show just tax, not any particular gst name."

         So the PAPER's generic word defaults to **GST** — it sits beside CGST and SGST rows and is
         read by a customer and by an inspector, where "Tax 18%" is vaguer than the document should
         be. The SCREEN's word defaults to **Tax** — a staff panel is not a tax document and should
         not commit to a tax regime's name.

         It is still ONE setting: the moment a restaurant types its own word (say VAT), both use it.
         Only the fallback differs, which is the whole point — an unconfigured restaurant gets the
         right word in each place instead of the same word in the wrong one.

         Nothing may write either default back INTO `settings.tax_label`. That is what caused the
         split this replaces: the Settings form prefilled the setting with the screen's word, so the
         PAPER then printed "Tax" on the manager's copy and "GST" everywhere else. Both prefills are
         now hints, exactly as the GSTIN two lines above already is — nothing fake is saved unless
         someone types a real value. `verify:print-paper` §3j pins all four cases. */
      taxLabel: pick(s.tax_label) || "GST",
      taxLabelScreen: pick(s.tax_label) || "Tax",
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
    /* THE UNTAXED PILE IS A PART OF THIS BILL, SO IT CANNOT BE BIGGER THAN IT (T8 sweep #7,
       2026-08-22). `nontax` is the MRP slice OF the subtotal, and the split is only meaningful while
       that is true. With nontax 400 against a subtotal of 100 the paper read "Food subtotal ₹-300"
       beside "MRP items ₹400" — a negative figure in a labelled money box, which is what the
       2026-08-06 rule forbids. `mrpPart()` already reasons exactly this way for a composition
       restaurant ("splitting into food and MRP says nothing and reads as broken"), so the same
       answer is right here: when the pile is not a genuine part of the subtotal, drop the split and
       print the plain single Subtotal the caller handed us. Unreachable through billData, which
       builds subtotalShown as foodShown + mrpPart(m) — so nontax is a subset by construction. */
    var subtotalRaw = Math.round(Number(d.subtotal) || 0);
    var nontax = Math.round(Number(d.nontax) || 0);
    if (nontax > subtotalRaw || nontax < 0) nontax = 0;
    /* AN ALL-MRP BILL IS JUST A BILL (owner, 2026-08-28 — item 15). A shop whose whole sale is
       sealed products printed "Food subtotal ₹0" over "MRP items ₹42": the split into food and
       sealed goods says nothing when there is no food, and a zero in a labelled money box reads as
       a mistake even though the column adds up. `mrpPart()` already reasons exactly this way for a
       composition restaurant ("splitting into food and MRP says nothing and reads as broken"), so
       the same answer is right here — drop the split and print the plain single Subtotal.
       A bill with ANY food in it is untouched. */
    if (nontax > 0 && nontax === subtotalRaw) nontax = 0;
    var subAmount = subtotalRaw - nontax;
    var subtotalShown = nontax > 0 ? subAmount : subtotalRaw;
    // THE PAPER NEVER PRINTS A NEGATIVE TAXABLE VALUE (2026-08-06). A discount larger than the row
    // it comes off produced `taxable: -50` and a matching round-off — billRows(subtotal 100,
    // discount 150) measured exactly that. Every real caller clamps first (billMoney caps a discount
    // at its own base), but billDocHtml is also called DIRECTLY by lib/billPreview.ts and the admin
    // preview with hand-built figures, and this function is the last thing between an arithmetic slip
    // and a guest's hands. Clamping here changes nothing for any current caller.
    /* THE SAME TWO FLOORS billMoney ALREADY HAS (T8 sweep #7, 2026-08-22). The clamp above stops a
       discount BIGGER than its row; it did not stop a NEGATIVE one, and the taxable value was not
       floored at all — while billMoney, thirty lines away in this same file, has always ended
       `taxable: Math.max(0, ...)`. Two money functions on one document disagreeing about whether a
       figure can go below zero is how the 2026-08-06 rule ("THE PAPER NEVER PRINTS A NEGATIVE
       TAXABLE VALUE") gets quietly re-broken. Measured before this: a discount of -50 on a ₹100 row
       printed no Discount row at all and a phantom "Round off + ₹5"; nontax of 400 against a
       subtotal of 100 printed "Food subtotal ₹-300".
       Neither is reachable through billData (it clamps both), and that is exactly why the clamp is
       here — billDocHtml is also called directly with hand-built figures by lib/billPreview.ts, the
       admin preview and lib/auditDetail.ts replaying a stored snapshot. No reachable bill moves by
       a paisa. */
    var discount = Math.min(Math.max(0, Math.round(disc)), Math.max(0, subtotalShown));
    var taxable = Math.max(0, subtotalShown - discount);
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
    /* ONE BAD LINE MUST NOT COST THE WHOLE PIECE OF PAPER (T8 sweep #7, 2026-08-22). A single
       null in a line list threw out of the render — on all three documents — and these are drawn
       into a window.open or a hidden iframe, so a throw here is a BLANK WINDOW: the kitchen gets no
       ticket, or the guest gets no bill, with nothing on screen saying why. That is the worst
       possible shape of "a tap must never vanish in silence", at the till, mid-rush.
       Every line list this file reads now drops empty entries instead. `items` is JSONB in this
       product, so a null element is a database write away, and printing the other nine dishes is
       strictly better than printing nothing. */
    var rows = (d.lines || []).filter(Boolean).map(function (i) {
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
    //
    // …AND A COMPOSITION BILL HAS NO TAXABLE VALUE AT ALL (2026-08-11, T7 finding F9). A
    // composition-scheme restaurant may show the diner no tax (COMPLIANCE §3), so `taxRows` is
    // empty — but this restatement still printed, and a discounted composition bill read
    // "Subtotal ₹880 / Discount −₹50 / Taxable value ₹830 / TOTAL ₹830": a line naming the one
    // concept this document exists to have none of. The tax LINE was suppressed and the row that
    // describes it was left behind.
    var composition = !!d.composition;
    var restate = !inclusive && !inclOnly && !composition;
    // THE ROWS MUST FOOT TO THE TOTAL (see billRows). Every figure below comes from there, so the
    // paper and the manager's screen quote the same whole-rupee numbers and they reconcile.
    var R = billRows(d);
    /* THE PERCENTAGE MUST DESCRIBE THE RUPEES PRINTED BESIDE IT (T8 sweep, 2026-08-17).
       billRows() clamps a discount larger than the row it comes off — that was added on 2026-08-06
       so no negative "Taxable value" could reach a guest's hands — but the LABEL is the caller's own
       string and was printed unchanged, so a bill built with subtotal ₹100 and discount ₹150 read
       "Discount (150%) − ₹100": a percentage of the subtotal that nobody was given, against the
       amount that was actually deducted. Every panel path clamps before it gets here, but
       billDocHtml is also called DIRECTLY with hand-built figures (lib/billPreview.ts, the admin
       preview, lib/auditDetail.ts replaying a stored snapshot), which is the same reasoning that put
       the clamp in billRows in the first place — this function is the last thing between an
       arithmetic slip and a piece of paper. So when, and ONLY when, the clamp actually bites, the
       label is re-worded from what the document really deducted. An ordinary bill keeps the caller's
       own label byte-for-byte. */
    var discLabel = d.discLabel;
    if (disc > R.discount) discLabel = discPct(R.subtotal, R.discount);
    var discBlock = disc > 0
      ? '<div class="t"><span>Discount' + (discLabel ? " (" + esc(discLabel) + ")" : "") + "</span><span>− " + inr(R.discount) + "</span></div>"
        + (restate ? '<div class="t tx"><span>Taxable value</span><span>' + inr(R.taxable) + "</span></div>" : "")
      : "";

    /* MRP / untaxed lines (mig 270). 'nontax' is the part of the bill GST is NOT charged on —
       a sealed water bottle sold at its printed price. It is added AFTER the tax lines, which
       is exactly how the owner described it, and the first row above becomes "Food subtotal"
       so the column still FOOTS: food − discount = taxable value, and taxable + tax + MRP =
       total. (A "Subtotal" of 880 followed by "Taxable value 720" with only an 80 discount
       between them reads as an arithmetic error even though it isn't.)
       When there are no such lines — every restaurant today — nothing here renders and the
       bill is byte-identical to the one before this feature. */
    // ONE DECISION ABOUT THE UNTAXED PILE, read from billRows rather than recomputed here (T8
    // sweep #7, 2026-08-22). These were two separate reads of d.nontax — so the label, the MRP row
    // and the arithmetic could each answer differently, which is precisely the twin-value hazard
    // the dead second `subAmount` note above this block was removed for.
    var nontax = R.nontax;
    var subLabel = nontax > 0 ? "Food subtotal" : "Subtotal";
    // (There used to be a second `subAmount` computed here. It was dead — the render below reads
    // R.subtotal — so a later editor "fixing" one of the two would have changed nothing. Gone.)
    // (`R` is billRows(d), resolved once above the discount block — it used to be called three
    // separate times for the same bill, which is three chances for two of them to disagree.)
    // What the cancelled bill WOULD have come to — added straight from the printed lines, so
    // the "Ordered value" row and the item rows above it are the same arithmetic.
    var orderedValue = (d.lines || []).filter(Boolean).reduce(function (a, i) {
      return a + (parseFloat(i.price) || 0) * Math.max(1, parseInt(i.qty, 10) || 1);
    }, 0);
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

    /* WHAT THIS PIECE OF PAPER IS CALLED (2026-08-11, T7 finding F9).
       A COMPOSITION-SCHEME restaurant cannot issue a tax invoice — it is not allowed to collect
       tax from the diner at all (which is why its rate genuinely is 0, mig 272, and why no tax
       line prints). The document such a business hands over is a BILL OF SUPPLY, and it has to
       carry the declaration that the supplier is a composition taxable person not eligible to
       collect tax on supplies. This file had exactly two names — "Tax Invoice" and "Cancelled
       Bill" — so a composition tenant's guest was handed a sheet headed TAX INVOICE with the
       restaurant's GSTIN on it. docs/COMPLIANCE-GUARDRAILS.md §3 covered the tax LINE and
       stopped at the letterhead; the money was right and the heading was not. */
    /* A SHEET WITH NO GSTIN ON IT IS NOT A TAX INVOICE (T8 sweep #7, 2026-08-22).
       This file already refuses to invent a GSTIN — "NEVER fall back to a placeholder GSTIN, a fake
       tax number on a real bill is illegal" (2026-08-04), so an unconfigured restaurant prints no
       GSTIN line at all. The heading was never given the same reasoning, so the sheet went on
       calling itself a TAX INVOICE with the one field that makes it one simply absent.

       CGST Rule 46(b)/(c) makes the supplier's GSTIN a mandatory particular of a tax invoice, and
       docs/COMPLIANCE-GUARDRAILS.md carries the same rule in one line: "Real GSTIN on any tax
       invoice". A sheet headed Tax Invoice with no registration on it is not one — the same class
       of fault as T7's F9, where the money was right and the letterhead was not.

       This is NOT hypothetical or a corner: measured on the dev database, 16 of 17 restaurants have
       no GSTIN, the flagship included — an empty Billing card is the state every new tenant starts
       in, and taxModel() falls back to 5% for all of them. So every one of those tenants is handing
       guests a "Tax Invoice".

       What changed, and only this: the WORD at the top. A restaurant with no GSTIN gets "Bill",
       which is what it is and what such a restaurant wants. Nothing about the money, the numbers or
       any row moves — the TOTAL is still passed straight through, and a restaurant that HAS filled
       its GSTIN in prints exactly what it printed before, byte for byte.

       LEFT FOR THE OWNER, deliberately not changed here: the sheet still adds and names CGST/SGST
       rows for a restaurant with no registration. Those rupees were genuinely charged and are
       inside the TOTAL, so removing the rows would stop the column footing — which is a real
       product decision about what an unregistered tenant should collect, not a formatting one.
       Written up in .claude/sweep/T8-findings.md. */
    var registered = !!String(d.gstin == null ? "" : d.gstin).trim();
    var docName = d.cancelled ? "Cancelled Bill"
      : (composition ? "Bill of Supply" : (registered ? "Tax Invoice" : "Bill"));
    return '<!doctype html><title>' + docName + " — " + name + "</title>\n"
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
// ── THE PAPER'S FULL SAFE WIDTH, CENTRED (owner, 2026-08-19 — measured, not guessed) ─────────────
// Ground truth, taken by pushing a real bill through this Mac's own CUPS chain (Chrome PDF →
// cgpdftoraster with the queue's PPD → the printer's rastertozj filter) and decoding the ESC/POS the
// printer would receive: the raster is 560 dots = 70.1mm wide, and the bill's ink ran from x=0 to
// x=482 — **60mm of ink, flush against the left edge, with 10mm of paper unused on the right.**
// `padding:2mm 5mm` was meant to inset it; the filter chain drops that left inset, so the bill ended
// up narrower AND off-centre — which is exactly how his printed copy looked next to the preview.
//
// So the width is stated as a WIDTH and centred, instead of hoping padding survives: 66mm is the
// documented safe maximum for an 80mm head (the July note: "Content ≤66mm CENTERED — the 80mm head
// only prints ~70mm, offset ~5mm from the left paper edge; a full-width 80mm body loses ~8mm of every
// line on the right"). 66mm instead of 60mm is 10% more line length, so fewer lines wrap — which is
// the only honest way to bring the paper closer to the preview, because 80mm paper can never be as
// wide as a browser window.
//
// This is PRINT ONLY. The preview is untouched: he asked for the previous view back and it is back.
+ "  @media print{body{margin:0 auto !important;padding:2mm 0 !important;width:66mm !important;box-sizing:border-box !important}\n"
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
// ── THE PREVIEW *IS* THE PRINT (owner, 2026-08-19: "go back to preview that exactly match the print,
//    I want preview and print same") ────────────────────────────────────────────────────────────────
// The screen now uses the printer's own column, to the millimetre: the same 66mm width and the same
// 2mm top/bottom padding the @media print rule above uses. Not "about the same" — the identical
// numbers, so a line that wraps on paper wraps on screen at the same word.
//
// WHY 66mm AND NOT 70: measured from the printer's own bytes on 2026-08-19 (Chrome PDF → this Mac's
// cgpdftoraster with the queue's PPD → the printer's rastertozj filter → decoded ESC/POS). The head
// images 560 dots = 70.1mm, the chain CROPS TO THE INK AND LEFT-ALIGNS IT (which is why the old
// padding:2mm 5mm silently vanished and the bill printed off-centre), and 66mm is the documented safe
// maximum for an 80mm head. Declaring 70 or 72 changed nothing — the crop saturates.
//
// ZOOM IS WHY THIS IS READABLE. 66mm on a monitor is a ~250px strip. `zoom` scales every used length
// together — font size, padding, borders — so the layout is mathematically identical and only the
// display size changes: same wraps, same rhythm, just big enough to read. It is SCREEN ONLY; print
// resets it to 1, so nothing about the paper is affected.
+ "       font-size:12.5px;line-height:1.55;color:#000;font-weight:400;\n"
+ "       font-variant-numeric:tabular-nums;\n"
+ "       width:66mm;margin:0 auto;padding:2mm 0;box-sizing:border-box}\n"
// The white sheet is shown 72mm wide with the 66mm of INK centred inside it, because that is what the
// roll actually is: 80mm of paper, ~70mm of printable head, 66mm of ink. With border-box the content
// column stays exactly 66mm — the same number the print rule uses — so the line breaks are identical;
// only the visible paper edge is added. Without it the ink ran to the very edge and the preview looked
// like a bill with its margins cut off.
// HOW BIG THE PREVIEW IS SHOWN — FITTED TO THE WINDOW, NOT A FIXED NUMBER (owner, 2026-08-19:
// "make sure the preview looks in a small screen … I could able to see the whole bill in preview
// … maybe some more zoom out. Don't change anything in the code because the bill printed right
// now is exactly like the format"). So NOTHING below the @media print rule moved: the paper is
// finished and this is display size only.
//
// A fixed 2x was right for a short bill and wrong for a real one — his 4-dish Aangan bill is
// 178mm of paper (measured off the printer's own bytes), which at 2x is ~1340px and does not fit
// any bill window, so he was handed a preview he had to scroll to judge. The number below is now
// only the fallback for a frame where scripts cannot run (the Audit card's sandboxed iframe);
// wherever the page CAN run, zFit() measures the document at 1x and picks the zoom that shows all
// of it, then -/+ nudge it and the choice is remembered.
+ "  @media screen{html{background:#e9e9ec;min-height:100%}\n"
+ "    body{zoom:1.35;background:#fff;box-shadow:0 2px 18px rgba(0,0,0,.2);width:72mm;padding:2mm 3mm;\n"
+ "         margin:10px auto 30px;padding-top:calc(2mm + 34px)}}\n"
+ "  @media print{body{zoom:1 !important}}\n"
+ "  .logo{display:block;height:46px;margin:0 auto 8px;filter:grayscale(1) contrast(1.4)}\n"
// 60-odd millimetres holds about 20 uppercase characters at this size, so a real name — "AANGAN GARDEN
// RESTAURANT" is 24 — takes two lines on paper AND now in the preview. It was inheriting the body's
// 1.44 leading, which left those two lines sitting in 14.5mm of loose air; 1.12 makes them read as one
// block. The SIZE is deliberately unchanged: the name is the biggest thing on a customer's bill.
+ "  h2{font-size:19px;font-weight:700;letter-spacing:.03em;text-transform:uppercase;text-align:center;\n"
+ "     line-height:1.18;margin:0 0 6px}\n"
+ "  .sub{text-align:center;font-size:11.5px;line-height:1.55}\n"
+ "  .kind{border-top:1px solid #000;border-bottom:1px solid #000;margin:12px 0 10px;padding:5px 0;\n"
+ "        text-align:center;font-size:11px;letter-spacing:.24em;text-transform:uppercase}\n"
// The cancelled band — same one ink, same double border the KOT's DUPLICATE banner uses, so
// a voided bill is as unmistakable on paper as a reprinted ticket is.
+ "  .vband{text-align:center;font-weight:700;font-size:15px;letter-spacing:1.5px;\n"
+ "         border:3px double #000;padding:5px 2px;margin:8px 0 2px;text-transform:uppercase}\n"
+ "  .kv{display:flex;justify-content:space-between;gap:10px;font-size:12px;padding:3.5px 0}\n"
+ "  .kv span:first-child{font-size:11px;letter-spacing:.09em;text-transform:uppercase;white-space:nowrap}\n"
+ "  .kv b{font-weight:400;text-align:right}\n"
+ "  .dash{border-top:1px solid #000;margin:11px 0}\n"
+ "  /* fixed columns, sized from THIS bill's own figures (see widest{}) so a ₹1,07,880 line\n"
+ "     and a long dish name can never crowd each other */\n"
+ "  table{width:100%;border-collapse:collapse;margin-top:2px;table-layout:fixed}\n"
+ "  th{font-size:11px;letter-spacing:.09em;text-transform:uppercase;text-align:left;font-weight:400;\n"
+ "     border-bottom:1px solid #000;padding:0 0 4px}\n"
+ "  th.c,td.c{text-align:center;padding-left:4px}\n"
+ "  th.r,td.r{text-align:right;padding-left:7px}\n"
+ "  td{font-size:12.5px;padding:6.5px 0;vertical-align:top;border:0}\n"
+ "  td.n{padding-right:4px;word-break:break-word}\n"
+ "  tr.ex td{font-size:11px;padding:0 0 5px 9px}\n"
+ "  tbody tr:last-child td{padding-bottom:6px}\n"
+ "  .t{display:flex;justify-content:space-between;font-size:12px;padding:3.5px 0}\n"
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
// FIXED to the window, not sticky inside a 66mm column where the buttons would be squeezed. It sits
// inside the zoomed body, so its own zoom is wound back to keep the buttons a normal size.
+ "  .bar{position:fixed;top:0;left:0;right:0;z-index:9;display:flex;gap:8px;justify-content:flex-end;\n"
+ "       margin:0;padding:10px 12px;background:#f2f2f4;border-bottom:1px solid #d8d8dc;zoom:.74}\n"
// .74 is 1/1.35 — the inverse of the fallback body zoom above, so the buttons come out life-size
// when no script runs. zApply() overwrites it with the inverse of whatever zoom is actually in use.
+ "  .bar .zg{margin-right:auto;display:flex;align-items:center;gap:4px}\n"
+ "  .bar .zg button{padding:6px 10px;font-size:13px;min-width:32px}\n"
+ "  .bar .zl{font:12px/1 system-ui,sans-serif;color:#3a3a42;min-width:44px;text-align:center;\n"
+ "           background:#fff;border:1px solid #d8d8dc;border-radius:7px;padding:6px 4px;cursor:pointer}\n"
+ "  .bar button{font:inherit;font-size:13px;padding:7px 13px;border-radius:8px;cursor:pointer;\n"
+ "              border:1px solid #b9b9c0;background:#fff;color:#000}\n"
+ "  .bar button.x{background:#111;color:#fff;border-color:#111}\n"
+ (d.note
? "  .bar .note{margin-right:auto;align-self:center;text-align:left;max-width:52%;\n"
+ "             font:11.5px/1.35 system-ui,sans-serif;color:#3a3a42}\n"
: "")
+ "  @media print{.bar{display:none !important}}\n"
+ "</style>\n"
/* NO TOOLBAR WHEN THE BILL IS BEING READ AS EVIDENCE (2026-08-12).
   The Audit card shows the bill inside a sandboxed iframe — no scripts, by design, because it is a
   record being read and not a bill being issued. The bar's two buttons call printAgain()/closeBill(),
   so in that frame they were DEAD: a "Print this" that cannot print and a "✕ Close" that closes
   nothing, sitting on top of the document. A tap that does nothing is worse than no button at all
   (the panel's own tap rule), so the caller can leave the chrome off. Nothing else passes noBar, so
   every real bill and every preview keeps its bar exactly as before. */
+ (d.noBar ? "" : '<div class="bar">'
/* Zoom out / in / fit. Deliberately on the LEFT and quiet: the two things that DO something to a
   bill — print it, close it — keep the right-hand end where every panel puts its actions. The
   middle chip shows the current size and is itself the "fit the whole bill" button, so three
   controls cover all of it without a fourth. They touch nothing but the display size. */
+   '<span class="zg"><button title="Show it smaller" onclick="zStep(-1)">\u2212</button>'
+   '<span class="zl" title="Fit the whole bill in the window" onclick="zFit(1)">100%</span>'
+   '<button title="Show it bigger" onclick="zStep(1)">+</button></span>'
+   (d.note ? '<span class="note">' + esc(d.note) + "</span>" : "")
+   '<button onclick="printAgain()">🖨 Print' + (d.autoPrint ? " again" : " this") + "</button>"
+   '<button class="x" onclick="closeBill()">✕ Close</button></div>') + "\n"
+ (d.logo ? '<img class="logo" src="' + esc(d.logo) + '" onerror="this.style.display=\'none\'"/>' : "")
+ "\n<h2>" + name + "</h2>\n"
+ '<div class="sub">' + (addr ? addr + "<br/>" : "") + (phone ? "Ph " + phone : "") + (phone && gstin ? "<br/>" : "") + (gstin ? "GSTIN " + gstin : "") + "</div>\n"
/* REJECTED (owner, 2026-08-19): the BILL never says it is a reprint. There was a
   "Reprint · Duplicate" band here from 2026-08-17 to 2026-08-19; the owner removed it —
   "in the printing bill I don't even want the reprinted bill shown in the bill … and make the
   guard also in code like never change that to reprint thing and stuff". A second copy of a bill
   is a service action, not an incident: the guest asks for the paper again, or the first sheet
   jammed. Branding it made the guest's own copy look like a lesser document.
   Do NOT re-add a band, a watermark, a "(copy)" suffix in the doc name, or a small-print line
   here. Bill data carries no reprint flag at all any more, for exactly that reason, and
   scripts/verify-bill-reprint-is-silent.mjs fails the build if the word comes back onto this
   sheet. The one record of a re-print is where it belongs: sessions.bill_printed_at (mig 333,
   re-commented by mig 339) is what makes the panels' button read 'Reprint', and reopening a bill
   is a different act entirely — that one IS recorded in the Audit, and stays so.
   The KITCHEN TICKET keeps its big DUPLICATE banner (owner, 2026-08-04, re-confirmed
   2026-08-19: "bill only keep kot banner") — a cook mistaking a duplicate for a fresh order
   cooks the food twice, which is a real kitchen fault, not a piece of paperwork.
   The cancelled band below is unrelated and stays: it changes what is owed. */
+ (d.cancelled ? '<div class="vband">Cancelled — no charge</div>\n' : "")
+ '<div class="kind">' + docName + "</div>\n"
/* THE ROW IS NAMED AFTER THE DOCUMENT IT IS ON (owner, 2026-08-28 — item 18).
   A composition-scheme restaurant's sheet is headed BILL OF SUPPLY and then, three lines below,
   labelled its number row "INVOICE" — the sheet arguing with itself on the one document that kind
   of business hands over. A composition dealer may not issue a tax invoice at all; what CGST
   Rule 49 asks that sheet to carry is "a consecutive serial number", so that is what the row is
   called there. Nothing about the NUMBER changes — it is the same number, drawn the same way, with
   the same restaurant-chosen prefix (Settings › Billing → "Invoice prefix", default INV). Only the
   word to the left of it moves, and only on a Bill of Supply.
   A cancelled sheet keeps "Invoice", because it names the invoice number it RETIRED. */
+ (d.invNo ? '<div class="kv"><span>' + ((composition && !d.cancelled) ? "Serial no" : "Invoice")
   + '</span><b>' + esc(d.invNo) + "</b></div>" : "") + "\n"
/* THE INTERNAL BILL NUMBER IS NOT THE CUSTOMER'S BUSINESS WHEN THERE IS A REAL INVOICE NUMBER
   (owner, 2026-08-21). This app hands out THREE numbers where a POS normally has two: the KOT
   number for the kitchen, the INVOICE number (the tax record — drawn only when an invoice is
   actually generated, never reset, and a bill cancelled before that draws none at all), and
   'bill_no', an internal daily reference given out when a table's FIRST ORDER lands.
   Only the last one can have visible holes: a table that ordered and then cancelled leaves its
   number spent. Printing it beside the invoice number meant a customer — and an owner flicking
   through the day's sheets — saw #12, #14, #15 and read it as sloppiness.
   So the sheet now shows it ONLY when there is no invoice number to show instead. A restaurant
   without GST invoicing still gets a number on its paper (that is the case bill_no exists for);
   a restaurant that issues invoices shows the number that is meant to be quoted, and nothing
   else. Nothing about how numbers are ASSIGNED changed — see docs/NUMBERING.md. */
+ (!d.invNo && d.billNo !== "" && d.billNo != null ? '<div class="kv"><span>Bill no</span><b>#' + esc(d.billNo) + "</b></div>" : "") + "\n"
+ (d.parcel ? '<div class="kv"><span>Parcel</span><b></b></div>' : '<div class="kv"><span>Table</span><b>' + esc(d.tableDisp) + "</b></div>") + "\n"
+ '<div class="kv"><span>Date</span><b>' + esc(d.dateStr) + "</b></div>\n"
+ custBlock + "\n"
+ '<div class="dash"></div>\n'
+ "<table>\n"
+ "<colgroup><col><col style=\"width:calc(" + widest.qty + "ch + 8px)\"><col style=\"width:calc(" + widest.rate + "ch + 11px)\"><col style=\"width:calc(" + widest.amt + "ch + 11px)\"></colgroup>\n"
+ '<thead><tr><th>Item</th><th class="c">Qty</th><th class="r">Rate</th><th class="r">Amt</th></tr></thead><tbody>' + rows + "</tbody></table>\n"
+ '<div class="totals">\n'
// A CANCELLED BILL'S MONEY BLOCK MUST NOT CONTRADICT ITS OWN ITEM LIST. The rows above are
// what was ORDERED, so they are named that; then one line says the sale was cancelled, and
// the total is ₹0. Printing "Subtotal ₹0" over ₹250 of priced dishes — or a CGST line on a
// sale that never happened — is the arithmetic-error look the record card already removed
// from the screen (owner's 2026-07-03 screenshot). No discount, tax, MRP or round-off row:
// none of them describe a bill nobody paid. The normal branch is untouched T7 work.
+ (d.cancelled
   ? '  <div class="t"><span>Ordered value</span><span>' + inr(orderedValue) + "</span></div>\n"
     + '  <div class="t"><span>Cancelled — not charged</span><span>− ' + inr(orderedValue) + "</span></div>\n"
     + '  <div class="g"><span>TOTAL</span><span>' + inr(0) + "</span></div>\n"
   : '  <div class="t"><span>' + subLabel + "</span><span>" + inr(R.subtotal) + "</span></div>\n"
     + "  " + discBlock + "\n"
     + "  " + (inclusive ? "" : taxRows) + "\n"
     + "  " + mrpBlock + "\n"
     + "  " + roundBlock + "\n"
     + '  <div class="g"><span>TOTAL</span><span>' + inr(R.total) + "</span></div>\n"
     + (inclBelow
        ? '  <div class="incl"><div class="t"><span>Price includes</span><span></span></div>' + inclBelow + "</div>\n"
        : ""))
+ "</div>\n"
+ mrpNote + "\n"
// The composition declaration — the words that make a Bill of Supply a Bill of Supply. Boxed in
// the same one-ink style as mrpNote (no grey: a thermal head has no grey). Never on a cancelled
// sheet, which charges nothing and says so in its own band.
+ ((composition && !d.cancelled)
   ? '<div class="mini" style="border-top:1px solid #000;margin-top:6px;padding-top:5px">Composition taxable person — not eligible to collect tax on supplies.</div>\n'
   : "")
/* THE VERIFICATION LINE — the signed chain, on the paper (owner, 2026-08-17).
   Migration 332 writes one hash-chained row the moment a bill becomes a tax document, so a removed
   or altered sale is DETECTABLE rather than merely forbidden. Until now that proof lived only in
   the database: the person holding the receipt had to take the software's word for it. Germany's
   KassenSichV settled this the same way — the signature is printed ON the receipt, which is what
   makes it checkable by whoever holds it rather than only by whoever owns the server.
   So: the bill's position in that chain and the first 12 characters of its hash. Twelve is enough
   to pick one bill out of a restaurant's whole history and short enough for a 66mm roll; the full
   value stays in the ledger, which is where a real verification reads it from anyway.
   Formatted HERE, not at the call sites, for the reason this whole file exists — the manager panel,
   the waiter tablet and the admin preview must print the same reference for the same bill.
   Renders NOTHING unless the caller supplies both parts, so every bill printed today is unchanged,
   and never on a cancelled sheet (that sale was withdrawn; its chain row records the issue, and the
   band across the top is what the paper is for). */
+ ((!d.cancelled && d.chainSeq != null && d.chainHash)
   ? '<div class="mini" style="margin-top:6px">Verification ' + esc(String(d.chainSeq)) + " · "
     + esc(String(d.chainHash).slice(0, 12)) + "</div>\n"
   : "")
+ '<div class="foot">' + footer + "</div>\n"
+ (d.noBar ? "" : pageScript(d.autoPrint));
  }

  /* ───────────────────────── THE KITCHEN TICKET (KOT) ─────────────────────────
   * o = { title, rname, head, kot, tableLabel, when,
   *       lines: [{ qty, title, options, removed, note }]  (or linesHtml, pre-built),
   *       allergies: [], extraHtml, note }
   * 66mm thermal, validated through the real CUPS/ESC-POS chain 2026-07-21. The zero page margin
   * plus the break-inside rules are what keep a ticket on ONE piece of paper — the admin's old
   * sample had neither and printed in two parts (owner, 2026-08-02). NO PRICES: a KOT is for
   * the kitchen, not a bill. */
  /** kotWhen(ts) — WHAT TIME, AND WHICH DAY, on a printed kitchen ticket.
   *
   * The paper used to carry a bare "09:31 PM" and nothing else, so a ticket rung five days ago on an
   * overnight table printed exactly like one rung tonight. On screen the board says "5d 3h"; on
   * paper there was no way to tell at all — and the owner's point (2026-08-11) is that a thermal
   * head is BLACK AND WHITE, so nothing about this can be solved with a colour. It has to be words.
   *
   * Words are also what this document already uses for hierarchy: "a thermal head has no grey — it
   * fakes one with sparse dots" (the note above kotDocHtml's .kl rule), so size, weight and borders
   * are the only tools here. Today reads exactly as it always did — a ticket from today is the
   * normal case and gains nothing from a date. Anything older says so, in capitals, before the time.
   *
   * Lives HERE, in the one print document, because FOUR callers built this string for themselves
   * (the kitchen's auto-print and queued reprints, and the manager panel twice). One of them getting
   * the day and the others not is precisely the twin-drift this file exists to prevent.
   */
  /* ONE CLOCK AND ONE DAY, ON EVERY DEVICE IN THE BUILDING (T8 sweep, 2026-08-17).
   *
   * The paragraph above says a kitchen ticket "must read the same on every device in the building",
   * and only the MONTH NAME was ever made to obey it. Everything else here was left to the device:
   * the time came from 'toLocaleTimeString([], …)' — the machine's own locale AND its own time zone —
   * and the today/yesterday decision compared local calendar dates. Measured on one order rung at
   * 2026-08-16 21:31 IST, the same ticket printed:
   *
   *     India tablet   YESTERDAY 09:31 pm      London   YESTERDAY 05:01 pm
   *     New York       12:01 pm                Sydney   02:01 am
   *
   * — four different times and three different days, while the BILL for that same order said
   * "16/08/2026 09:31 pm" on all four and the banquet sheet said "16-08-2026 09:31PM" on all four.
   * The thermal bill was pinned to en-IN + Asia/Kolkata on 2026-08-05 and the banquet sheet on
   * 2026-08-06; the ticket was the one document left on device time. A tablet bought abroad, or one
   * left on its factory zone, hands the kitchen a time that is hours out and a day that is wrong —
   * which is precisely the confusion this function was written to remove.
   *
   * AND THE DAY IS THE RESTAURANT'S DAY, NOT THE CALENDAR'S. "Today" in this product rolls over at
   * 05:00 IST, not at midnight (mig 044, 'lib/businessDay.ts', 'docs/NUMBERING.md') — the counters,
   * every panel's Today filter and the Z-report all agree on that, because a service running past
   * midnight is still the same night's trade. On a calendar day a ticket rung at 23:50 and reprinted
   * at 00:10 of the SAME rush came back branded "YESTERDAY". It now uses the same business day
   * everything else uses, so the ticket agrees with the board, the bill and the Z-report.
   * (The trade: a ticket rung at 03:00 and reprinted after 05:00 now says YESTERDAY on what is still
   * the same calendar date. That is the correct answer — the restaurant HAS turned the day over by
   * then, and every other "today" in the product has turned with it.)
   *
   * The business-day key is derived the way 'businessDayDate()' derives it — UTC+05:30 − 05:00 =
   * UTC+00:30, so the key is the UTC date half an hour on. This file takes no imports (it is loaded
   * by the panels, the Next server and React alike), so the arithmetic is repeated here rather than
   * shared; if 'lib/businessDay.ts' ever changes, change this with it. 'verify:billdoc-paper' pins
   * both halves.
   */
  function kotWhen(ts) {
    if (ts == null || ts === "") return "";
    var d = new Date(ts);
    var t = d.getTime();
    if (!isFinite(t) || t <= 0) return "";          // never print "Invalid Date" on a ticket
    // The same clock the bill's date row uses (see dateStr in billData), uppercased because this one
    // is read at arm's length off a 203dpi roll.
    var time = d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" }).toUpperCase();
    var bkey = function (ms) { return new Date(ms + 30 * 60000).toISOString().slice(0, 10); };
    var today = bkey(Date.now());
    var mine = bkey(t);
    if (mine === today) return time;
    if (mine === bkey(Date.now() - 86400000)) return "YESTERDAY " + time;
    // Older than that: the date itself. Day-and-month only — a KOT is never a year old, and the
    // paper is 66mm wide.
    // Built explicitly, NOT via toLocaleDateString's own ordering: the system locale decided it, so
    // the same ticket printed "AUG 6" on one machine and "6 AUG" on another. A kitchen ticket must
    // read the same on every device in the building — and the DAY NUMBER has to come from India too,
    // or a ticket rung at 01:30 IST prints the previous date on a device sitting behind UTC.
    var day = d.toLocaleDateString("en-GB", { day: "numeric", timeZone: "Asia/Kolkata" });
    var mon = d.toLocaleDateString("en-GB", { month: "short", timeZone: "Asia/Kolkata" }).toUpperCase();
    return day + " " + mon + " " + time;
  }

  function kotLineHtml(r) {
    r = r || {};   // one bad line must not cost the whole ticket — see the note in billDocHtml
    var opts = Array.isArray(r.options) ? r.options.map(function (x) { return typeof x === "string" ? x : ((x && x.label) || ""); }).filter(Boolean).join(", ") : "";
    var rem = Array.isArray(r.removed) ? r.removed.filter(Boolean).join(", ") : "";
    return '<div class="kl"><span class="q">' + (r.qty || 1) + '×</span><span class="n">' + esc(r.title || "")
      + (opts ? " <i>(" + esc(opts) + ")</i>" : "")
      + (rem ? " <i>— no " + esc(rem) + "</i>" : "")
      + (r.note ? "<br><small>&raquo; " + esc(r.note) + "</small>" : "")
      + "</span></div>";
  }

  // REJECTED (owner, 2026-08-16) — docs/REJECTED-IDEAS.md → R26. The `width:280px` on the body
  // below is built for 66/80mm paper and STAYS that way. Measured by T15 on 2026-08-15 by rendering
  // this document's real output at both roll widths: at 80mm it is clean, and at 58mm the table
  // name, the "— no <ingredient>" line and the ⚠ AVOID allergy box run past the paper edge. That is
  // known and accepted — *"for different restaurant we use different printer and all that stuff so
  // right now keep IT AS IT IS."* Each restaurant is set up with a printer that suits it (the
  // flagship and Aangan both run POS-80), so the answer to a narrow roll is the right printer, not
  // a document that tries to fit every width and reads worse on all of them.
  //
  // So: do NOT add responsive print CSS here, do NOT shrink the body, and do NOT re-report the
  // 58mm overflow as a bug. If a client ever turns up with 58mm hardware he will say so, and it
  // becomes a real piece of work with a real printer to test against.
  // (The BILL is a separate document and is already clean at both widths — nothing to do there.)
  function kotDocHtml(o) {
    o = o || {};
    var linesHtml = o.linesHtml != null ? o.linesHtml : (o.lines || []).filter(Boolean).map(kotLineHtml).join("");
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
// …AND THE PER-LINE NOTE, which was the one size left to the browser (2026-08-06). It is emitted in
// a bare <small>, so it inherited the UA's 0.83em off the 14px line — measured 11.67px in Chrome,
// under the 12px floor this ticket's own rule states two comments up. That note is the guest's
// specific instruction ("no onion for the child"), i.e. the line a cook most needs to read on a
// rushed pass, and it was the smallest text on the paper. Pinned like every other size here.
+ "      .kl small{font-size:12px}\n"
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
// ── NO PAGE SIZE IS DECLARED. THIS FUNCTION IS DELIBERATELY EMPTY (owner, 2026-08-19, with a photo) ──
// It used to measure the bill and inject `@page{size:80mm <content height>mm}` so the roll would be
// fed exactly the bill's length. On a real thermal queue that is the wrong instruction, and the
// failure it produced is the one he photographed: **the bill printed sideways and at half size.**
//
// The numbers, measured rather than guessed: an 8-line bill declares `size:80mm 134mm`. The queue's
// media is a SHORT receipt page (70mm x 65mm — the recipe validated in July). To put an 80x134mm page
// on 70x65mm media the driver must scale to min(70/80, 65/134) = 0.49 — half size — and it rotates the
// job to fit the better axis, which is the landscape. Meanwhile the KOT, which declares NOTHING, is
// perfect: the queue's own short page paginates it and Chrome never slices a line.
//
// So the bill now does exactly what the KOT does. The rule was already written 340 lines above this
// one — "NO @page size override — a forced size smaller/squarer than the paper gets rotated or
// bottom-anchored by CUPS (sideways prints + 20cm blank lead-ins)" — and this code contradicted it.
// The blank-tail worry it was written for is handled by the QUEUE (FeedWhere=AfterJob,
// FeedDist=9feed30mm), which is where paper feed belongs.
//
// It is kept as a no-op rather than deleted because `printAgain()` is called from the bill's own
// toolbar button and from the onload path, and a missing function would break both.
// Guarded by verify:print-format so it cannot come back.
+ "function measure(){ /* intentionally nothing — see the note in billdoc.js */ }\n"
/* ── SEE THE WHOLE BILL (owner, 2026-08-19) ────────────────────────────────────────────────────
   The paper column is 66mm — about a 250px strip on a monitor — so the preview has always been
   DISPLAYED zoomed. The zoom is now fitted to the window instead of fixed: measure the document at
   1x, then show it at the largest size that still fits, floor 0.6 (below that a 10.5px label stops
   being readable and a scrollbar is the better answer) and ceiling 2.
   CSS 'zoom' scales every used length together — font size, padding, borders, the 66mm column — so
   the LAYOUT IS UNTOUCHED at any of these numbers: the same words wrap where the paper wraps them.
   Print resets it to 1 with the 'body{zoom:1 !important}' rule above, which an inline style cannot
   beat, so none of this can reach the printer.
   His nudge is remembered per browser, and remembering it is the point: a bill window is opened
   dozens of times a shift and nobody wants to re-zoom every time. The word 'fit' is stored so a
   longer bill still fits later, rather than freezing today's percentage. */
/* REMEMBERED PER SCREEN, NOT ONE SIZE FOR EVERY DEVICE (owner, 2026-08-28 — item 16).
   The chosen size was stored under one key, so a manager who works on a laptop and a tablet shared
   a single number between two very different screens: a size picked on the desktop made the bill
   unreadable on the tablet, and the tablet's choice wasted half the desktop. The key now carries
   the window's shape, rounded to the nearest 100px so an ordinary resize does not lose the choice
   but a genuinely different device gets its own. The old single key is still read once as a
   starting point, so nobody's existing preference is thrown away. */
+ "var ZMIN = .6, ZMAX = 2, Zn = 0;\n"
+ "var ZKEY_OLD = \"lfh_bill_zoom\";\n"
+ "function zKey(){ var w = Math.round((innerWidth || 380) / 100) * 100;\n"
+ "  var h = Math.round((innerHeight || 680) / 100) * 100; return ZKEY_OLD + \":\" + w + \"x\" + h; }\n"
+ "function zGet(){ try{ var v = localStorage.getItem(zKey());\n"
+ "    return v == null ? localStorage.getItem(ZKEY_OLD) : v; }catch(e){ return null; } }\n"
+ "function zSet(v){ try{ localStorage.setItem(zKey(), v); }catch(e){} }\n"
/* THE ROOM RESERVED FOR THE TOOLBAR HAS TO BE IN THE TOOLBAR'S OWN UNITS (T8 sweep #7,
   2026-08-22). The bar is `position:fixed` and wound back to life-size with the INVERSE zoom, so
   its height on screen is constant — but the space kept clear for it is `body{padding-top:calc(2mm
   + 34px)}`, which sits INSIDE the zoomed body and therefore shrinks with the zoom. The two scale
   in opposite directions, so the moment the fit lands at or below about 1.0 the bar starts eating
   the restaurant name — the biggest thing on a customer's bill. Measured:

       A35 360x780, 8-line bill    zoom 1.02   the name is covered by 4px
       A35 360x780, 60-line bill   zoom 0.60   covered by 26px — the whole name
       desktop 1280x900, 60 lines  zoom 0.60   covered by 26px
       desktop 1280x420, 8 lines   zoom 0.60   covered by 26px

   and the 60-line case is not a corner: the owner's own Aangan bill is 178mm of paper, which is
   what put the 0.6 floor in this file in the first place. The ledger row that checked this
   (P03899, "on the A35 it does not cover the first line either") passed in sweep #6 because the
   zoom layer did not exist yet — it landed 2026-08-19.

   So the allowance is now MEASURED from the bar and divided by the zoom, which converts it into
   the body's own coordinates. It is screen-only: the print rule
   `@media print{body{...padding:2mm 0 !important}}` carries !important and beats an inline style,
   so nothing here can reach the paper. The CSS `calc(2mm + 34px)` stays as the fallback for a
   frame where scripts cannot run. */
+ "function zBarH(){ try{ var b = document.querySelector(\".bar\");\n"
+ "    return b ? b.getBoundingClientRect().height : 0; }catch(e){ return 0; } }\n"
+ "function zApply(z){ Zn = z; try{ document.body.style.zoom = z; }catch(e){}\n"
+ "  try{ var b = document.querySelector(\".bar\"); if (b) b.style.zoom = (1 / z).toFixed(3); }catch(e){}\n"
+ "  try{ var h = zBarH(); if (h > 0) document.body.style.paddingTop = ((h + 8) / z).toFixed(2) + \"px\"; }catch(e){}\n"
+ "  try{ var l = document.querySelector(\".zl\"); if (l) l.textContent = Math.round(z * 100) + \"%\"; }catch(e){} }\n"
// WHAT "THE HEIGHT OF THE BILL" MEANS, measured twice before it was right:
//   · body.scrollHeight  — too SHORT: it leaves out body's own margin:10px auto 30px (the white
//     paper edge above and below the sheet), so the fit left 40 zoomed pixels hanging over the
//     bottom of the window and the bill still scrolled by a hair.
//   · documentElement.scrollHeight — too TALL: html carries min-height:100%, so it can never
//     report less than the window. Every bill then fitted at ~99% and a SHORT one could never use
//     the room it had. A min-height on the measured box turns a fit into a no-op.
// So the content is measured as what it is: the sheet plus its own two margins.
// The bar's height is subtracted from the WINDOW rather than added to the document, because it
// does not scale: the height a bill needs on screen is content*z + barH, so the largest zoom that
// fits is (window - barH) / content. Measured with the top allowance stripped back to the plain
// 2mm, or the allowance zApply just wrote would be counted twice and each fit would shrink the
// next one.
+ "function zRoom(){ /* what the document needs at 1x, and what the window has to give */\n"
+ "  var b = document.body, was = b.style.zoom, wasPad = b.style.paddingTop;\n"
+ "  b.style.zoom = 1; b.style.paddingTop = \"2mm\";\n"
+ "  var cs = getComputedStyle(b), w = b.offsetWidth || 272;\n"
+ "  var h = b.offsetHeight + (parseFloat(cs.marginTop) || 0) + (parseFloat(cs.marginBottom) || 0);\n"
+ "  b.style.zoom = was; b.style.paddingTop = wasPad; if (!(h > 0)) h = 740;\n"
+ "  var room = (innerHeight || 680) - zBarH() - 10;\n"
+ "  return { z: Math.min(((innerWidth || 380) - 14) / w, Math.max(1, room) / h) }; }\n"
+ "function zFit(remember){ var z = Math.max(ZMIN, Math.min(ZMAX, Math.round(zRoom().z * 100) / 100));\n"
+ "  zApply(z); if (remember) zSet(\"fit\"); }\n"
+ "function zStep(d){ var z = Math.max(ZMIN, Math.min(ZMAX, Math.round((Zn + d * .15) * 100) / 100));\n"
+ "  zApply(z); zSet(String(z)); }\n"
+ "function zStart(){ var v = zGet();\n"
+ "  var n = parseFloat(v); if (v && v !== \"fit\" && n >= ZMIN && n <= ZMAX) zApply(n); else zFit(0); }\n"
// A bill window is REUSED for the next bill, so this runs per document, and the fit is redone when
// the window is resized — but only while he has not set a size of his own, or a drag would undo it.
+ "addEventListener(\"resize\", function(){ var v = zGet();\n"
+ "  if (!v || v === \"fit\") zFit(0); });\n"
+ "function printAgain(){ print(); }\n"
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
// Sized BEFORE the print dialog opens on the auto-print path: the dialog is modal, so a bill left
// at the wrong size until it closed would be the first thing he saw behind it.
+ "zStart();\n"
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
     and "Special"@150 can never merge. The separator is a VISIBLE escape written as \u0001 rather
     than a raw byte: adjacent fields must not run together, and an invisible character in the
     source begs to be "tidied" away to "". */
  function combineBillLines(entries) {
    var SEP = "\u0001";  // a real, visible escape — see the note above
    var out = [], at = {};
    (entries || []).filter(Boolean).forEach(function (e) {
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
    // A SOFT-DELETED ORDER IS NOT ON THE BILL — the same predicate billMoney and billData use
    // (2026-08-11, T7 finding F7). This filtered `cancelled` only. Nothing reached it today
    // because billData hands it the already-filtered `live` list, but it is on the public API
    // (LFH_BILLDOC.mrpTaxInside) and the manager panel wraps it as a one-liner that passes
    // whatever its caller holds — so a future call site would have printed "MRP items include
    // ₹X GST" counting a tombstoned line, on the one document that must reconcile to the rupee.
    (orders || []).filter(function (x) { return x.status !== "cancelled" && !x.deleted_at; }).forEach(function (o) {
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
  /* THE FINANCIAL YEAR IS INDIA'S, NOT THE PRINTING DEVICE'S (T8 sweep #7, 2026-08-22).
     This read `getFullYear()`/`getMonth()` — the machine's own time zone — so the FY inside the
     invoice number was the last thing on this document still decided by whichever tablet held the
     paper. Measured on one invoice issued at 2026-04-01 01:00 IST, the first hour of the new
     Indian financial year:

         India tablet   INV/2026-27/000041      dated 01/04/2026
         London / UTC   INV/2025-26/000041      dated 01/04/2026
         New York       INV/2025-26/000041      dated 01/04/2026

     — the same sale, two different invoice numbers, and on the non-India devices a sheet DATED
     1 April 2026 carrying financial year 2025-26, because the date row was pinned to IST on
     2026-08-05 and this was not. It is the same fault class as the bill's date (fixed 2026-08-05),
     the banquet sheet's (2026-08-06) and the kitchen ticket's (2026-08-17); this is the fourth and
     last place, and it is the worst of them, because the FY is part of the number that IDENTIFIES
     the tax document. Two devices in one restaurant quoting two numbers for one sale is precisely
     what `financialYear` was written to prevent when it chose the invoice's own date over "today".

     31 March / 1 April is the single most consequential date in Indian accounting and IST runs
     +05:30, so every device behind India — the whole of Europe and the Americas — reads the
     previous FY for the first five and a half hours of it.

     Pinned the same way `kotWhen` derives its business day: shift by +05:30 and read the UTC
     parts, which is India's calendar date with no imports (this file is loaded by the panels, the
     Next server and React alike). `verify:print-paper` pins it at the boundary in both directions. */
  function financialYear(when) {
    var d = when ? new Date(when) : new Date();
    var t = d.getTime();
    var base = isFinite(t) ? t : Date.now();
    var ist = new Date(base + 330 * 60000);
    var y = ist.getUTCFullYear();
    var start = ist.getUTCMonth() >= 3 ? y : y - 1;
    return start + "-" + String(start + 1).slice(2);
  }
  function invFmt(no, when, prefix) {
    if (no == null) return "";
    return (prefix || "INV") + "/" + financialYear(when) + "/" + String(no).padStart(6, "0");
  }

  /* orderTaxRate(order, settingsRate): THE rate ONE order was charged at — the single definition,
     used by the printed bill (billMoney below) AND by settling a bill in parts (lib/paySplit.ts).

     IT LIVES HERE BECAUSE IT EXISTED TWICE AND THE TWO HAD DRIFTED (2026-08-06). paySplit kept the
     older "rate > 0 ? stamped : settings" rule while this file was taught (2026-08-05) to honour a
     stamped ZERO from an order that carries money — the fix that stops a 0%-era bill reprinting with
     tax nobody charged after the restaurant switches GST on. They happened to still agree on every
     input I could construct, because each path that stamps a 0 also drives the taxable base or the
     discount somewhere that collapses both formulas to the same total. "Agrees by luck" is not a
     property to rely on for money: if it ever diverged the symptom is the worst kind — the paper says
     ₹1,000 and Pay-in-parts refuses every split until the parts add to ₹1,050, a button no waiter
     can satisfy while a guest waits. So there is one rule now, in the file that is already the
     shared home for a bill's money.

     The three cases, in order:
       · a POSITIVE stamped rate (mig 284) — what this order was actually charged, so a banquet at
         18% is never re-asked at the dine-in 5% and a rate corrected today cannot re-price it.
       · a stamped ZERO on an order that carries money — a real rate, not a missing one.
       · anything else (never stamped, or a ₹0 line) — fall back to the restaurant's settings, so a
         ₹0 line sitting on a taxed bill cannot drag that bill's rate down to nothing. */
  function orderTaxRate(o, settingsRate) {
    o = o || {};
    if (Number(o.tax_rate) > 0) return Number(o.tax_rate);
    if (o.tax_rate != null && (parseFloat(o.subtotal) || 0) > 0) return 0;
    return Number(settingsRate) || 0;
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
    // A STAMPED ZERO IS A RATE, NOT A MISSING ONE (T18, 2026-08-05). The per-order lookup above
    // is right, but `> 0` alone still cannot tell a deliberate stamped 0 from a legacy row that
    // was never stamped. The note that "a genuine 0 falls through to the settings, which also
    // answer 0" holds only while the restaurant has not CHANGED: the moment a 0%/composition
    // restaurant switches GST on, tm.rate becomes 0.05 and every 0% bill still inside the Bills
    // record showed and PRINTED tax that was never charged — a ₹1,000 bill reprinting as ₹1,050.
    // That is the one direction mig 284's stamp was meant to cover and did not. So a stamped 0 is
    // honoured — but only from an order that actually carries money, so a ₹0 line sitting on a
    // taxed bill still cannot drag that bill's rate down to nothing.
    var rateOf = function (o) { return orderTaxRate(o, tm.rate); };
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
        /* AN MRP LINE IS NOT ONE OF THE TAXED ROWS (T8 sweep, 2026-08-17).
           A sealed bottle sold at its printed price is kept OUT of this order's taxable base — that
           is what 'nontax_amount' is — and the tax sitting inside its price is the manufacturer's,
           reported separately under the total by 'mrpTaxInside'. But an MRP line whose tax_mode is
           "incl" is not "exempt", so it fell through to both sums below: counted here as a taxed
           row, and counted AGAIN as the "MRP items" row the document adds after the tax.

           A ₹400 dal beside two ₹21 bottles printed, on paper headed Tax Invoice:
               Food subtotal ₹442   ← the whole bill, under a heading that says food
               CGST ₹9 · SGST ₹9    ← ₹18 of a ₹20 tax, the other ₹2 pushed below the total
               MRP items ₹42        ← the bottles, a second time
               Round off − ₹40      ← the double count, silently clawed back
               TOTAL ₹462
           The amount charged was right; every row explaining it was wrong, and a "round off" of ₹40
           on a ₹462 bill is not a rounding — it is this file's own note ("at most a rupee or two")
           being contradicted on the one document that has to reconcile to the rupee.

           Only skipped when this order really does hold the line outside its taxable base (ntx > 0);
           an order carrying MRP lines with no 'nontax_amount' behaves exactly as it did before. */
        if (i.is_mrp && ntx > 0) return;
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

  /* chainRef(session, orders) — a bill's position in the signed chain (mig 332) and its hash, as a
     PAIR. The manager's API attaches these to every order row of the bill; older callers may carry
     them on the session. Both parts always come from the same place, because a sequence from one
     row beside a hash from another would be a reference that verifies nothing. */
  function chainRef(sess, orders) {
    var s = sess || {};
    if (s.chain_seq != null && s.chain_hash) return { seq: s.chain_seq, hash: s.chain_hash };
    var row = (orders || []).find(function (o) { return o && o.chain_seq != null && o.chain_hash; });
    return row ? { seq: row.chain_seq, hash: row.chain_hash } : { seq: undefined, hash: undefined };
  }

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
    // THE ITEM ROWS AND THE MONEY MUST DROP THE SAME ORDERS (2026-08-06). billMoney() was taught
    // on 2026-08-05 to exclude a soft-deleted order from the subtotal, the tax and the TOTAL; this
    // list — which is what actually gets PRINTED as the item rows — was left filtering only
    // `cancelled`, while the comment below already claimed otherwise. So a tombstoned line stayed on
    // the paper when its money did not: one live ₹200 order beside a deleted ₹100 one printed rows
    // adding to ₹300 over a Subtotal of ₹200 and a TOTAL of ₹210, on a document headed "Tax
    // Invoice", with no round-off row able to explain the gap. Both panel doors happen to strip
    // soft-deletes before they get here (the editor route's `oq.is("deleted_at", null)` and
    // lib/liveBoard), so nothing reached it today — but a bill's rows and its total may not sit one
    // filter apart from disagreeing (COMPLIANCE §3, reconcile to the rupee). Same predicate as
    // billMoney now; verify:print-format asserts the ROWS, not just the total.
    var live = orders.filter(function (o) { return o.status !== "cancelled" && !o.deleted_at; });
    var bi = billIdentity(s, a.restaurant || {});

    /* A CANCELLED BILL IS NOT A TAX INVOICE (2026-08-05).
       Every order on this bill is cancelled, so 'live' is empty and the document came out as
       the full invoice template with NOTHING in it: headed "Tax Invoice", carrying the
       restaurant's GSTIN and a real bill number, an empty item table, and CGST/SGST/TOTAL all
       ₹0 — with no word anywhere saying the sale was cancelled. For a tool whose whole safety
       argument is that it cannot misrepresent a sale, that is the wrong piece of paper, and
       the Bills record puts a 🖨 Print button directly under the words "This bill was
       cancelled — no charge".
       So it prints as what it IS: a CANCELLED BILL, saying so in a band across the top, still
       listing what was ordered (a void record nobody can read is no record at all) and
       charging nothing. Nothing is hidden — the compliance rule is that a cancelled sale stays
       visible, not that it prints as a tax invoice. */
    // Explicitly "every order was CANCELLED", not "live is empty": `live` also drops soft-deleted
    // orders (see above), and a tombstoned bill is a different thing from a voided sale.
    var voidedAll = orders.length > 0 && orders.every(function (o) { return o.status === "cancelled"; });
    if (voidedAll) live = orders;   // show what WAS ordered; the money below stays ₹0

    // WHO THE BILL IS FOR, in priority order: the pair captured at invoice time and stored on the
    // bill itself (mig 227), else the guest's own name. Printing them is the restaurant's switch;
    // they are always SAVED either way. Blank hides the line rather than printing it empty.
    var printCust = s.bill_customer_print !== false;
    var row = orders.find(function (o) { return o.bill_cust_name || o.bill_cust_phone; }) || {};
    var named = orders.find(function (o) { return String(o.customer_name || "").trim(); }) || {};
    var cust = printCust ? (row.bill_cust_name || named.customer_name || "") : "";
    var phoneRaw = printCust ? String(row.bill_cust_phone || "").replace(/\D/g, "") : "";
    // 10 digits print as "98250 12345" — easier to read back to a guest than one long run.
    //
    // A COUNTRY CODE MUST NOT COST THE GROUPING (2026-08-06). The grouping applied at EXACTLY ten
    // digits, so a number stored as "+91 98250 12345" printed as "919825012345" — the "+" stripped,
    // the 91 kept, and the 5+5 gone, which reads like a wrong number rather than the guest's own on
    // the one row that exists to be read back to them. Not hypothetical: lib/billCustomer.ts stores
    // up to FIFTEEN digits and only enforces a minimum of ten, so a 12-digit value is ordinary
    // accepted input. So: peel a leading 91 (12 digits) or a leading trunk 0 (11) down to the
    // national number, then group. Anything else prints as-is rather than being guessed at — a
    // number we cannot confidently parse is safer whole than wrongly chopped.
    var phone10 = phoneRaw.length === 12 && phoneRaw.slice(0, 2) === "91" ? phoneRaw.slice(2)
      : phoneRaw.length === 11 && phoneRaw.charAt(0) === "0" ? phoneRaw.slice(1)
      : phoneRaw;
    var custPhone = phone10.length === 10 ? phone10.slice(0, 5) + " " + phone10.slice(5) : phoneRaw;

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
    /* A MIXED-RATE BILL STILL SPLITS ITS TAX INTO CGST/SGST (2026-08-11, T7 finding F1).
       This printed one flat "GST 18%" / "GST 5%" line per rate, while every other bill from the
       same printer names the restaurant's configured halves. On a document headed Tax Invoice the
       central/state split is what a person (and an inspector) expects to see, and dropping it made
       the mixed bill the one sheet that states its tax more thinly than all the others.
       What was rightly being protected is the PERCENTAGE: naming one rate for the whole bill would
       have put correct rupees under a rate nobody was charged. So each rate row is now split by the
       configured components' own SHAPE — CGST 2.5 + SGST 2.5 becomes CGST 9 + SGST 9 at 18% — and
       splitTax still gives the last line the remainder, so every row foots to that rate's tax.
       With no components configured the historical CGST/SGST halves are used, exactly as the
       single-rate branch below already does. */
    // THE SHAPE COMES FROM THE RESTAURANT'S OWN COMPONENTS, not from the CGST/SGST halves.
    // `taxComps` above falls back to two halves whenever billMoney refuses to vouch for the
    // configured list — which it always does on a mixed bill (compsMatch is false there by
    // construction). Scaling THOSE would quietly drop a third component: a restaurant on
    // CGST 2.5 + SGST 2.5 + CESS 1 printed "CGST 9% / SGST 9%" on the 18% slice and lost its cess
    // altogether. So the shape is read from the settings, and only a restaurant that has
    // configured none falls back to halves — the same answer the single-rate branch gives.
    var shapeComps = (taxModel(s).components || []);
    var scaleComps = function (bucketPct) {
      var shape = shapeComps.length ? shapeComps : [{ label: "CGST", rate: 1 }, { label: "SGST", rate: 1 }];
      var sum = shape.reduce(function (a, c) { return a + (Number(c.rate) || 0); }, 0);
      if (!sum) return [{ label: bi.taxLabel, rate: bucketPct }];   // one word — see mrpNote below
      return shape.map(function (c) {
        return { label: c.label, rate: Math.round(((Number(c.rate) || 0) / sum) * bucketPct * 100) / 100 };
      });
    };
    var addRows = (m.composition || addWhole <= 0)
      ? []
      : (m.mixedRates
        ? (m.rateRows || []).filter(function (b) { return Math.round(b.tax) > 0; }).reduce(function (acc, b) {
          return acc.concat(splitTax(Math.round(b.tax), scaleComps(Math.round(b.rate * 10000) / 100)));
        }, [])
        : splitTax(addWhole, taxComps));
    var insideWhole = Math.round(m.taxInside);
    var inclRows = (m.composition || !hasInside || insideWhole <= 0) ? [] : splitTax(insideWhole, taxComps);

    return {
      logo: a.logo || "",
      name: bi.name, addr: bi.address, phone: bi.phone, gstin: bi.gstin, footer: bi.footer,
      cancelled: voidedAll,
      // A CANCELLED SHEET NAMES THE NUMBER IT RETIRED (2026-08-06). This dropped the Invoice row
      // entirely on a cancelled bill, so the paper could only be tied back by its Bill no. But the
      // compliance rule is that a voided number RETIRES and stays on the record rather than
      // disappearing (COMPLIANCE §2, and mig 073's "the number stays on the record, never reused"),
      // and handing an inspector a "Cancelled — no charge" sheet that names the invoice it voided is
      // a stronger record than one that stays silent about it. "— voided" is on the same line so no
      // one can mistake this for a live invoice; a cancelled bill that never had one still prints
      // nothing.
      invNo: sess.invoice_no == null ? ""
        : invFmt(sess.invoice_no, sess.invoice_at, bi.prefix) + (voidedAll ? " — voided" : ""),
      /* REJECTED (owner, 2026-08-16, re-confirmed 2026-08-22): a cancelled bill keeps its number.
         Never free 'bill_no' for reuse to tidy the series — CGST Rule 46(b), Rule 49 (a Bill of
         Supply needs the same consecutive serial, and that is the document a composition-scheme
         restaurant prints, so here 'bill_no' IS the statutory number) and Rule 56 (keep the
         cancelled document WITH its number). Two documents under one number reads as a deleted
         sale. Gaps are correct and explainable. Recorded as R44 in docs/REJECTED-IDEAS.md; the
         full legal note is in lib/billLedger.ts and docs/COMPLIANCE-GUARDRAILS.md. */
      billNo: sess.bill_no != null ? sess.bill_no : "",
      // REJECTED (owner, 2026-08-19): NO `reprint` field on bill data, deliberately. A `reprint`
      // flag existed here 2026-08-17 → 2026-08-19 and drew a band on the sheet; the owner removed
      // the whole idea, so the flag is gone rather than left accepted-and-ignored — a field that
      // silently does nothing is how a band gets drawn again by the next person who finds it.
      // The KOT's own `reprint` flag (kotDocHtml) is untouched and still brands the ticket.
      /* THE SIGNED CHAIN (mig 332) — DELIVERED PROPERLY, AND DELIBERATELY NOT ON PAPER YET.
         (owner, 2026-08-28 — item 23 done, item 19 still his decision.)

         The delivery was broken: this read the reference off the SESSION, while the manager's API
         attaches it to every ORDER row of the bill (`o.chain_seq` / `o.chain_hash`, the editor
         route). So the two halves never met and the line could not print however it was called.
         It now reads the session first and falls back to the orders — taking BOTH parts from the
         SAME order, because a sequence from one row beside a hash from another would be a
         verification reference that verifies nothing.

         ⚠️ IT IS STILL OFF, ON PURPOSE, and this is NOT a field that silently does nothing —
         it is a decision the owner has not made yet. Printing it puts one more line of small print
         on every guest's receipt, and the very adjacent decision (the "Reprint · Duplicate" band,
         R37) he reversed two days after asking for it. So the paper is held behind one explicit
         flag that nothing sets. Switching it on is one word — `chainOnPaper: true` — at the two
         panels' billData() calls, and every surface lights up together because the format lives in
         one place. If the answer comes back NO, delete this flag and the two fields with it; do not
         leave it here half-alive. */
      chainSeq: a.chainOnPaper ? chainRef(sess, orders).seq : undefined,
      chainHash: a.chainOnPaper ? chainRef(sess, orders).hash : undefined,
      parcel: !!a.parcel,
      tableDisp: a.tableDisp || "—",
      // en-IN + Asia/Kolkata, NOT the printing device's locale. This is a document headed "Tax
      // Invoice": on a US-locale tablet the same bill printed 8/5/2026 where an India-locale one
      // printed 05/08/2026 — one says August 5, the other May 8. The money on this doc is already
      // en-IN and the logs are already pinned to IST (the one-time-zone rule); the date was the
      // last thing left to the device (T15 sweep, 2026-08-05).
      dateStr: now.toLocaleDateString("en-IN", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Asia/Kolkata" })
        + " " + now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" }),
      cust: cust, custPhone: custPhone,
      lines: combineBillLines(live.reduce(function (acc, o) { return acc.concat(Array.isArray(o.items) ? o.items : []); }, [])),
      subtotal: subtotalShown, discount: discShown,
      discLabel: discPct(foodShown, discShown),
      taxable: m.taxable, total: m.total,
      taxRows: addRows,
      inclRows: inclRows,
      // A composition restaurant's paper is a BILL OF SUPPLY, not a tax invoice, and carries the
      // declaration to say so — the document decides both from this one flag (T7 finding F9).
      composition: !!m.composition,
      nontax: mrpPart(m), mrpLabel: "MRP items",
      /* ONE WORD FOR THE TAX, DECIDED ONCE (T8 sweep #7, 2026-08-22). This and two other lines read
         `s.tax_label || "GST"` inline, while billIdentity — thirty lines away, in the function whose
         whole job is resolving exactly this kind of value — defaults it to "Tax". A restaurant that
         has never set the word (the default state) then got a DIFFERENT one depending on which panel
         printed the bill, because the manager panel copies billIdentity's answer into its own
         settings first (editor/app.js) and nothing else does:

             manager panel        MRP items include Rs 2 Tax
             waiter tablet        MRP items include Rs 2 GST
             Access preview       MRP items include Rs 2 GST
             admin preview        MRP items include Rs 2 GST

         Same restaurant, same bill, two words — the exact fault this whole file was created to end
         (owner, 2026-08-02: "whatever the manager panel prints, that is the format ... both should
         be sync"). All three now read billIdentity's one answer, so they converge on the word the
         admin's own Settings screen already shows the owner as the default. A restaurant that HAS
         set its own word was always consistent and is untouched. */
      mrpNote: inside > 0 ? "MRP items include " + inr(inside) + " " + bi.taxLabel : "",
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
  /* IT NAMES A CURRENCY, AND GETS THE SINGULAR RIGHT (2026-08-11, T7 finding F2).
     The currency word used to appear ONLY when there happened to be paise, so the common case —
     a whole-rupee total — read "One Lakh Thirty-Five Thousand Seven Hundred Only" with no mention
     of rupees at all, in a box captioned "Invoice Total (In Words)" on the product's largest-value
     document. And with paise it said "One Rupees and One Paise". On a tax invoice the amount in
     words is the controlling figure, so it says Rupees/Rupee and Paise/Paisa properly, and a
     NEGATIVE amount says so rather than printing positive words beside a negative figure. */
  const value = Number(amount) || 0;
  const sign = value < 0 ? "Minus " : "";
  const exact = Math.round(Math.abs(value) * 100);
  const paise = exact % 100;
  const rupeeWord = (r) => (r === 1 ? "Rupee" : "Rupees");
  const paiseWord = (p) => (p === 1 ? "Paisa" : "Paise");
  let n = Math.floor(exact / 100);
  const tail = paise
    ? " " + rupeeWord(n) + " and " + two(paise) + " " + paiseWord(paise) + " Only"
    : " " + rupeeWord(n) + " Only";
  if (!n) return sign + (paise ? two(paise) + " " + paiseWord(paise) + " Only" : "Zero Rupees Only");
  const p = [];
  const cr = Math.floor(n / 1e7); n %= 1e7;
  const la = Math.floor(n / 1e5); n %= 1e5;
  const th = Math.floor(n / 1e3); n %= 1e3;
  if (cr) p.push(three(cr) + " Crore");
  if (la) p.push(three(la) + " Lakh");
  if (th) p.push(three(th) + " Thousand");
  if (n) p.push(three(n));
  return sign + p.join(" ").trim() + tail;
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
    a = a || {};   // the whole sheet, like the bill and the ticket, survives a missing argument
    var b = a.bill || {}, lines = (a.lines || []).filter(Boolean);
    var s = a.settings || {};
    var bi = billIdentity(s, a.restaurant || {});
    var P = bqPaper(s);
  const isA4 = P.size === "a4";
  const W = isA4 ? 210 : 148, H = isA4 ? 297 : 210;
  /* NO DOCUMENT IN THIS FILE PRINTS "Invalid Date" — INCLUDING THIS ONE (T8 sweep #7, 2026-08-22).
     The kitchen ticket has refused since it was written (`kotWhen` returns "" on an unparseable
     value) and the thermal bill since 2026-08-05 (`stampAt`'s isNaN fallback). The banquet sheet —
     the product's largest-value document — guarded none of its THREE date fields, so it printed:

         Dated                Invalid Date        ← the field that decides the GST period
         Function: Reception · Invalid Date
         UPI PAY DT.Invalid Date — 500/-

     REACHABLE, and not only through the admin's hand-built preview. `banquet_bills.advances` is
     JSONB and migrations 237/239 store the date with NO cast — `'date', COALESCE(NULLIF(
     v_a->>'date',''), to_char(v_now,'YYYY-MM-DD'))` — so any non-empty text the client sends is
     kept verbatim and comes straight out here. (`fn_date` IS a real `date` column and `issued_at`
     a timestamptz, so those two are protected by the database; the document is still the last
     thing between a bad value and a customer's hands, which is the same reasoning that put the
     guard on the other two documents.)

     bqDay(v) → the IST day as dd/mm/yyyy, or "" when there is nothing real to print. A missing
     date prints NOTHING rather than a lie; the money on an advance row is never dropped. */
  const bqDay = (v) => {
    if (v == null || v === "") return "";
    const d = new Date(v);
    const ms = d.getTime();
    if (!isFinite(ms)) return "";
    return d.toLocaleDateString("en-GB", { timeZone: "Asia/Kolkata" });
  };
  const issuedMs = new Date(b.issued_at || Date.now()).getTime();
  const when = new Date(isFinite(issuedMs) ? issuedMs : Date.now());
  // PINNED TO IST, NOT THE PRINTING DEVICE (2026-08-06). These read the device's own time zone —
  // and `[]` left it the 12h/24h choice too — so the SAME banquet invoice printed two different
  // dates: issued_at 2026-08-05T19:30:00Z came out "06-08-2026 01:00AM" on an India-set device and
  // "05-08-2026 03:30PM" on one set to New York. The thermal bill had exactly this fixed on
  // 2026-08-05 (see dateStr in billData) and this sheet was left behind — on the product's
  // largest-value document, headed "Tax Invoice", whose date decides which GST period the sale
  // falls in. One time zone everywhere, like the money and the logs.
  const dstr = when.toLocaleDateString("en-GB", { timeZone: "Asia/Kolkata" }).replace(/\//g, "-");
  const tstr = when.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" }).toUpperCase().replace(" ", "");
  const sub = Number(b.subtotal) || 0, disc = Number(b.discount) || 0;
  const taxAmt = Number(b.tax) || 0, total = Number(b.total) || 0;
  const recv = Number(b.received) || 0;
  const bal = Math.round((total - recv) * 100) / 100;
  const taxable = Math.round((sub - disc) * 100) / 100;
  // Owner 2026-07-31: "whatever is in the bill I have sent you of banquet, it should be
  // like that" — a banquet bill ALWAYS prints as a tax invoice with the per-line taxable
  // value + CGST/SGST columns. The receiver's GSTIN line only shows when there is one.
  const b2b = true;
  // THE TABLE'S NAME REACHES THIS PAPER TOO (T3 sweep, 2026-08-06). A banquet booked ON a table
  // carries that table's number (mig 130), and this sheet printed the bare digit — so a restaurant
  // that renamed T5 to "Terrace 2" got "Table 5" on the banquet's tax invoice while its thermal
  // bill and its KOT both said "Terrace 2" (they resolve the name via tableDisp / tablePrintLabel).
  // Resolved HERE rather than at the call sites so both of them — the manager panel's
  // printBanquetBill and the admin's "See the banquet bill" preview — get it for free and cannot
  // drift apart, which is the whole reason this document only exists once.
  const bqTableDisp = (function () {
    const t = String(b.table_number == null ? "" : b.table_number).trim();
    if (!t) return "";
    const nm = (((s.table_names || {})[t]) || "").trim();
    return nm || t;
  })();
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
      : [{ label: bi.taxLabel, rate: Math.round(billRate * 10000) / 100 }]);   // one word — see billData's mrpNote
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
  /* …AND THE COLUMN FOOTS TO THE BILL, NOT JUST TO ITSELF (2026-08-11, T7 improvement I8).
     Two sources of truth meet on this sheet: the item TABLE adds up the LINES, while the money box
     on the right prints the totals STORED on the bill (b.subtotal / b.discount). They agree today,
     but nothing made them: a line edited after the bill was saved, or a line missing from the fetch,
     and the taxable column silently landed real rupees away from the TOTAL row under it with nothing
     on the paper to explain the gap. The stored bill is the authority — it is what was charged — so
     the LAST line absorbs any difference, the same rule the tax columns and the thermal bill's
     splitTax already use. When the lines do add up to the bill (every sheet today) this moves at
     most a paisa, and it is what makes the in-table TOTAL row true by construction. */
  /* …AND NO CELL IN THAT COLUMN IS EVER NEGATIVE (T8 sweep #7, 2026-08-22).
     The absorption above put the WHOLE difference on the last line, so whenever the lines added up
     to MORE than the stored bill — which is the exact case I8 was written for, "a line edited after
     the bill was saved, or a line missing from the fetch" — the last line went past zero and this
     sheet printed negative money. Measured on the real rendered A5:

       4  Stage decoration   1   28,800.00   -691.63   18.00%   -124.50

     and it does not need a big gap: a ₹1,00,000 hall beside a ₹100 welcome gift, with the lines
     ₹1,000 over the bill, printed the gift at -1,000.00 taxable and -90.00 tax.

     The thermal bill has forbidden this since 2026-08-06 — "THE PAPER NEVER PRINTS A NEGATIVE
     TAXABLE VALUE", the clamp in billRows() — and the rule was never carried to the product's
     LARGEST-VALUE document. A negative line on a tax invoice reads as a refund nobody gave.

     So the shortfall is absorbed the same way, but walking BACKWARDS from the last line and taking
     from each only what that line actually has. The column still foots to the TOTAL row by
     construction (that is what I8 bought), and no cell can go below zero. A sheet whose lines DO
     add up to its bill — every sheet today — is byte-identical: the drift is 0 and this does
     nothing. An OVER-shoot (the lines adding to less than the bill) still lands on the last line
     exactly as before, because growing a line cannot make it negative. */
  if (L.length) {
    const r2b = (n) => Math.round(n * 100) / 100;
    const sumTaxable = L.reduce((a, l) => a + l.taxable, 0);
    let drift = r2b(taxable - sumTaxable);
    if (drift > 0) {
      const last = L[L.length - 1];
      last.taxable = r2b(last.taxable + drift);
    } else if (drift < 0) {
      let owed = -drift;
      for (let i = L.length - 1; i >= 0 && owed > 0; i--) {
        const take = Math.min(Math.max(0, L[i].taxable), owed);
        if (take > 0) { L[i].taxable = r2b(L[i].taxable - take); owed = r2b(owed - take); }
      }
      // Only reachable when the bill's OWN taxable is negative (a discount larger than the
      // subtotal). Nothing on the paper can describe that, so it stays where it always was —
      // on the last line — rather than being silently spread across lines a guest can read.
      if (owed > 0) L[L.length - 1].taxable = r2b(L[L.length - 1].taxable - owed);
    }
  }
  /* EACH TAX COLUMN FOOTS TO ITS OWN TOTAL ROW (2026-08-11, T7 finding F10).
     Every cell used to be rounded on its own — round(line.taxable × rate) — while the TOTAL row
     printed below comes from the bill's STORED tax. On a multi-line bill the two disagreed:
     measured off the real rendered A5 sheet, CGST 9,703.13 + 646.88 = 10,350.01 sitting under a
     TOTAL row reading 10,350.00, and replayed over 960 realistic line/price/discount combinations
     47.8% of sheets printed at least one column that did not add up.
     That row is not decoration — this document's own note calls it "the proof that the per-line
     tax columns add up to the summary". So the columns are allocated the same way splitTax does it
     for the thermal bill: round every cell except the LAST, and give the last the remainder. */
  const colTax = taxRows.map((c) => {
    const r2c = (n) => Math.round(n * 100) / 100;
    const target = r2c(Number(c.amt) || 0);
    // Every cell pro-rata off its own line's taxable value…
    const cells = L.map((l) => r2c(Math.max(0, l.taxable) * ((Number(c.rate) || 0) / 100)));
    // …then the difference against the bill's STORED tax is absorbed from the last cell
    // backwards, taking from each only what it holds — so the column foots to its TOTAL row
    // AND no cell prints negative tax (T8 sweep #7, 2026-08-22; see the taxable column above,
    // where the same last-cell-takes-everything rule printed -124.50 on a real A5 sheet).
    let drift = r2c(target - cells.reduce((a, x) => a + x, 0));
    if (drift > 0) cells[cells.length - 1] = r2c(cells[cells.length - 1] + drift);
    else if (drift < 0) {
      let owed = -drift;
      for (let i = cells.length - 1; i >= 0 && owed > 0; i--) {
        const take = Math.min(Math.max(0, cells[i]), owed);
        if (take > 0) { cells[i] = r2c(cells[i] - take); owed = r2c(owed - take); }
      }
      if (owed > 0) cells[cells.length - 1] = r2c(cells[cells.length - 1] - owed);
    }
    return cells;
  });

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
    const tds = taxRows.map((c, ci) => `<td class="c">${bq2(c.rate)}%</td><td class="r">${bq2(colTax[ci][i])}</td>`).join("");
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
      const d = bqDay(a.date);
      terms.push(`${esc(String(a.mode || "").toUpperCase())} PAY${d ? " DT." + d : ""} — ${bq0(a.amt)}/-`);
    }
  }
  if (b.remark) terms.push(esc(b.remark));
  const fnBits = [];
  if (b.func) fnBits.push(esc(b.func));
  // IST here too — see the `dstr`/`tstr` note above. A bare date like "2026-08-01" is parsed as
  // midnight UTC, so on a device set behind UTC it printed as 31/07/2026: an advance receipt and a
  // function date both a day out on the same sheet as the invoice date they are meant to support.
  if (b.fn_date && bqDay(b.fn_date)) fnBits.push(bqDay(b.fn_date) + (b.fn_from ? ` ${esc(b.fn_from)}${b.fn_to ? "–" + esc(b.fn_to) : ""}` : ""));
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
          ${bqTableDisp ? `<div><div class="lbl">Table</div><div class="v">${esc(bqTableDisp)}</div></div>` : ""}
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
    kotWhen: kotWhen,
    billIdentity: billIdentity,
    splitTax: splitTax,
    discPct: discPct,
    billRows: billRows,
    taxModel: taxModel,
    orderTaxRate: orderTaxRate,
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
