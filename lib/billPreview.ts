// lib/billPreview.ts — "show me what will actually come out of the printer".
//
// WHY (owner, 2026-08-02): "the format of KOT is different, but in the manager panel if you
// print, it is different… whatever the manager panel prints, that is the format — the preview
// should only be that. Both should be sync, and it should not change the manager bill."
//
// He was right, and it was worse than one mismatch. This file used to draw its OWN bill —
// monospace, a Georgia heading, dashed rules, an allergy box a real bill never carries — while
// the printer produced a Helvetica thermal invoice with Qty/Rate/Amt columns. An admin could
// set a bill up here, approve the preview, and a guest would be handed something else.
//
// There is no second layout now. This builds SAMPLE figures and hands them to the very file the
// manager panel and the kitchen board print from — public/panels/billdoc.js. A change to the
// paper is a change to that file, and every screen follows it in the same commit.
//
// The sample deliberately carries every optional part — an add-on, a dish note, a discount, a
// named customer, an allergy line — even for a restaurant whose real bills rarely have them:
// a preview that only shows the plain case doesn't tell you how the busy case looks, and the
// busy case is the one that breaks a layout.
import BILLDOC from "@/public/panels/billdoc.js";
// The tax rules live in ONE file (lib/tax.ts), which is the TypeScript half of migration 270's
// SQL. This preview must not re-derive any of them: a sample bill that disagrees with the real
// one is worse than no sample at all, because it gets approved.
import { effectiveTaxPct, isMrpDish, itemTaxModesAllowed, priceTaxMode, resolveTaxMode, splitBill } from "@/lib/tax";

export type BillMode = "bill" | "parcel" | "kot";

type Settings = Record<string, unknown>;
type Restaurant = Record<string, unknown>;

const s = (v: unknown, d = "") => (typeof v === "string" && v.trim() ? v.trim() : d);
const num = (v: unknown, d = 0) => (typeof v === "number" && isFinite(v) ? v : d);

// One sample order, used by all three formats so the previews are comparable line for line.
// `price` is the unit price INCLUDING its add-ons, which is how a real order row is stored.
const SAMPLE = [
  { title: "Paneer Butter Masala", qty: 2, price: 360, options: [{ label: "Extra gravy", price: 40 }], note: "less oil" },
  { title: "Garlic Naan", qty: 4, price: 85, options: [{ label: "Butter", price: 15 }] },
  { title: "Fresh Lime Soda", qty: 2, price: 120, options: [] as { label: string; price: number }[] },
];
// The MRP line (mig 270) — shown ONLY when this restaurant may give a dish its own tax mode.
// Without it, an admin turning per-dish modes on has no way to see what the thing they just
// enabled does to the paper: the MRP stamp beside the name, the separate untaxed block under
// the tax rows, and the note explaining why nothing was added to it. A sealed water bottle is
// the case that forced the whole feature — its printed price is final, so charging 5% on top
// would put the bill above MRP.
const SAMPLE_MRP = { title: "Packaged Drinking Water 1L", qty: 2, price: 20, options: [] as { label: string; price: number }[] };
const SAMPLE_ALLERGY = ["dairy", "nuts"];
const SAMPLE_DISCOUNT = 50;

const tableNamed = (settings: Settings, fallback: string) =>
  s((settings.table_names as Record<string, string> | undefined)?.["5"], fallback);

/** The finished document as a standalone printable HTML page. */
export function billPreviewHtml(settings: Settings, mode: BillMode, restaurant: Restaurant = {}): string {
  const bi = BILLDOC.billIdentity(settings, restaurant);
  const now = new Date();
  const dateStr =
    now.toLocaleDateString("en-IN") + " " +
    now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });

  if (mode === "kot") {
    return BILLDOC.kotDocHtml({
      title: "Sample kitchen ticket",
      rname: bi.name,
      head: "KITCHEN TICKET · SAMPLE",
      kot: "SAMPLE",
      // A restaurant that renamed its tables should see the name it will really get.
      tableLabel: tableNamed(settings, "Table 5"),
      when: now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }),
      lines: SAMPLE.map((l) => ({ qty: l.qty, title: l.title, options: l.options, note: l.note })),
      allergies: SAMPLE_ALLERGY,
      note: "A sample kitchen ticket — the exact ticket the manager panel and the kitchen board print. It carries an add-on, a dish note and an allergy line so the busiest version of the layout is visible.",
    });
  }

  const parcel = mode === "parcel";

  // ── What a price MEANS here, and whether a dish may differ (mig 270) ─────────────────────
  // Every decision below is asked of lib/tax.ts — the same resolver the server prices an order
  // with — so this page can never approve a shape the printer won't produce.
  const composition = priceTaxMode(settings) === "composition";
  const perDishModes = itemTaxModesAllowed(settings);
  // The MRP sample only exists for a restaurant that may actually have one. While the master
  // switch is off, a dish's own mode is ignored ENTIRELY, so showing an MRP line would promise
  // behaviour this restaurant cannot get, and the preview stays exactly what it was before.
  const sampleLines = perDishModes ? [...SAMPLE, SAMPLE_MRP] : SAMPLE;
  const lines = sampleLines.map((l) => {
    const dishMode = l === SAMPLE_MRP ? "mrp" : "default";
    return { ...l, tax_mode: resolveTaxMode(dishMode, settings), is_mrp: isMrpDish(dishMode, settings) };
  });

  // A PARCEL CAN BE DISCOUNTED TOO, so its preview has to show the line (2026-08-03). This used
  // to be forced to 0 — true when a parcel was punched at full price and nothing else, wrong
  // since the ⚡ QO/P builder started carrying a discount out with the order. An admin checking
  // "what does our parcel bill look like?" was shown a layout missing a row the real one prints.
  //
  // splitBill applies the discount cap for us: a whole-bill discount may never eat a locked MRP
  // price (lfh_order_discount_base does the same on the server), so what shows here is the
  // discount the real bill would carry, not the one we asked for.
  const split = splitBill(lines, settings, SAMPLE_DISCOUNT);
  const subtotal = split.subtotal;
  const discount = split.discount;
  const taxable = split.taxable;

  // The tax rows the restaurant actually configured, split the way the printer splits them
  // (whole rupees, the last line takes the remainder) so the preview foots to the same total.
  const configured = Array.isArray(settings.tax_components)
    ? (settings.tax_components as { label?: string; rate?: number }[]).filter((c) => s(c?.label) && num(c?.rate) > 0)
    : [];
  // effectiveTaxPct is THE rule for "what rate is this restaurant on" (named components if it
  // has them, else its own tax_rate, else 5%). This line used to read settings.tax_rate itself,
  // which is a second copy of half that rule — and a second copy is how the preview and the
  // printed bill start disagreeing.
  const pct = effectiveTaxPct(settings);
  const comps = configured.length ? configured : [{ label: "CGST", rate: pct / 2 }, { label: "SGST", rate: pct / 2 }];
  const rateSum = comps.reduce((t, c) => t + num(c.rate), 0);
  const taxWhole = composition ? 0 : Math.round((taxable * rateSum) / 100);
  // A COMPOSITION-SCHEME RESTAURANT MAY NOT SHOW A DINER ANY GST AT ALL
  // (docs/COMPLIANCE-GUARDRAILS.md §3) — so no tax rows, not even a zero one.
  // (The single `taxRows` that used to be built here is now split into the ADDED rows and the
  //  ALREADY-INSIDE rows just below, so a tax-inclusive sample prints the shape the printer prints.)

  // The untaxed block under the tax rows. Under composition NOTHING on the bill is taxed, so
  // there is no taxed-versus-untaxed split to draw: printing "Food subtotal 0 / MRP items 1,150"
  // would misstate what those two rows mean. It is 0 there, and the bill simply carries no tax.
  const nontax = composition ? 0 : split.nontaxAmount;
  const mrpInclusive = String(settings.mrp_tax_treatment) === "inclusive";
  // THE TOTAL COMES FROM splitBill, NOT FROM A SECOND SUM HERE (2026-08-05). This used to be
  // `taxable + taxWhole + split.nontaxAmount`, which quietly dropped the discount for a
  // COMPOSITION-scheme restaurant: there every line resolves to `exempt`, so `taxable` is 0 and the
  // whole bill sits in `nontaxAmount` — the preview then showed "Discount − ₹50" and handed it
  // straight back as "Round off + ₹50", with the TOTAL unchanged. splitBill had the right answer
  // all along, and using it is also the only way this page can promise what the printer produces
  // (the reason this file exists — see the header).
  const total = split.total;

  // The percentage must be quoted against the row the paper actually SHOWS above it — "Food
  // subtotal" (the taxable part) when there are untaxed/MRP lines, else the plain subtotal. Reading
  // the full subtotal here made the preview say "3.7%" where the printer said "3.8%" on the same
  // bill; discPct exists precisely so every surface quotes one figure.
  // ── TAX ALREADY INSIDE THE PRICES — the same shape billdoc's billData() builds ──────────────
  // A restaurant on "GST inside the price" prints item rows at the GROSS menu price, so a NET
  // Subtotal under that column does not equal it (the rows said ₹1,300 and the subtotal ₹1,238).
  // Worked out here the same way and in the same order as billData, because a preview that
  // disagrees with the printer is the one fault this file exists to prevent.
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const amountOf = (l: { qty?: number; price?: number }) => r2((Number(l.price) || 0) * Math.max(1, Number(l.qty) || 1));
  const grossTaxed = r2(lines.filter((l) => l.tax_mode !== "exempt").reduce((a, l) => a + amountOf(l), 0));
  const netIncl = r2(lines.filter((l) => l.tax_mode === "incl")
    .reduce((a, l) => a + r2(amountOf(l) / (1 + split.rate)), 0));
  const insideShare = split.taxableBase > 0 ? Math.min(1, Math.max(0, netIncl / split.taxableBase)) : 0;
  // Split at FULL precision. Deriving the shown discount from a whole-rupee tax makes it absorb the
  // rounding (a ₹50 discount printed as ₹51 with a "Round off +₹1" beside it), so the rows below
  // round only at the last moment — the same order billdoc's billRows() uses.
  const taxPrecise = composition ? 0 : (taxable * rateSum) / 100;
  const taxInside = r2(taxPrecise * insideShare);
  const taxAdded = r2(taxPrecise - taxInside);
  const hasInside = taxInside > 0;
  // The food row as the paper shows it — gross when tax is inside, otherwise exactly what it was
  // (which is what keeps a COMPOSITION restaurant, where there is no taxable base, correct).
  const foodShown = hasInside ? grossTaxed : r2(subtotal - nontax);
  const subtotalShown = r2(foodShown + nontax);
  // Stated so the column closes: what is shown, less the tax genuinely added and the untaxed pile,
  // must leave the TOTAL. On an ordinary bill this is exactly `discount`.
  // Without inside tax the discount is stated exactly as it always was, so every restaurant that is
  // not on "GST inside the price" gets a byte-identical preview.
  const discShown = !hasInside ? discount
    : (discount > 0 ? Math.max(0, r2(foodShown + taxAdded + nontax - total)) : 0);
  const addWhole = Math.round(taxAdded);
  const insideWhole = Math.round(taxInside);
  const taxRowsAdded = composition || addWhole <= 0 ? [] : BILLDOC.splitTax(addWhole, comps);
  const taxRowsInside = composition || insideWhole <= 0 ? [] : BILLDOC.splitTax(insideWhole, comps);

  const discLabel = BILLDOC.discPct(foodShown, discShown);
  // Printing the customer's details is the restaurant's own switch — respect it here too, or
  // the preview would promise a line the printer leaves off.
  const showCust = settings.bill_customer_print !== false;

  return BILLDOC.billDocHtml({
    logo: /^https?:\/\//i.test(s(restaurant.logo_url)) ? s(restaurant.logo_url) : "",
    name: bi.name, addr: bi.address, phone: bi.phone, gstin: bi.gstin, footer: bi.footer,
    invNo: `${bi.prefix}/2026-27/000042`,
    billNo: 42,
    parcel,
    tableDisp: tableNamed(settings, "T5"),
    dateStr,
    cust: showCust ? "Riya Sharma" : "",
    custPhone: showCust ? "98250 12345" : "",
    lines,
    subtotal: subtotalShown, discount: discShown, discLabel, taxable,
    total,
    taxRows: taxRowsAdded,
    inclRows: taxRowsInside,
    // A composition tenant's paper is a BILL OF SUPPLY carrying the "not eligible to collect tax"
    // declaration, and it has no "Taxable value" row (T7 finding F9). The preview has to pass this
    // or it would approve a heading the printer no longer produces — the one fault this file exists
    // to prevent (see the header).
    composition,
    nontax,
    mrpLabel: "MRP items",
    // The note must only ever say what the accounts support (billdoc.js says so itself). With
    // "No GST on MRP items" nothing is declared on the line; with "GST is inside the MRP price"
    // it is pulled out of the printed price. Either way the guest pays the MRP and not a rupee more.
    mrpNote: mrpInclusive
      ? "MRP items are sold at their printed price — the GST shown above already includes the tax inside it. Nothing is added on top."
      : "MRP items are sold at their printed maximum retail price. No GST is charged on them, so nothing is added on top.",
    autoPrint: false,
    note: (parcel
      ? "A sample parcel bill from this restaurant's own settings — the exact page the counter prints. The same details as a table bill, with PARCEL where the table would be."
      : "A sample bill from this restaurant's own settings — the exact page the manager panel prints. It carries an add-on, a discount and a named customer so the busiest version of the layout is visible.")
      + (composition ? " This restaurant is set to the composition scheme, so no GST line is shown to the diner and a whole-bill discount has nothing taxable to come off." : "")
      + (perDishModes ? " Dishes may set their own tax mode here, so a sample MRP item is included — its price is final and nothing is added to it." : ""),
  });
}
