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
  const subtotal = SAMPLE.reduce((t, l) => t + l.price * l.qty, 0);
  const discount = parcel ? 0 : SAMPLE_DISCOUNT;
  const taxable = subtotal - discount;

  // The tax rows the restaurant actually configured, split the way the printer splits them
  // (whole rupees, the last line takes the remainder) so the preview foots to the same total.
  const configured = Array.isArray(settings.tax_components)
    ? (settings.tax_components as { label?: string; rate?: number }[]).filter((c) => s(c?.label) && num(c?.rate) > 0)
    : [];
  const pct = num(settings.tax_rate, 0.05) * 100;
  const comps = configured.length ? configured : [{ label: "CGST", rate: pct / 2 }, { label: "SGST", rate: pct / 2 }];
  const rateSum = comps.reduce((t, c) => t + num(c.rate), 0);
  const taxWhole = Math.round((taxable * rateSum) / 100);
  const taxRows = BILLDOC.splitTax(taxWhole, comps);

  const discLabel = discount > 0 ? `${Math.round((discount / subtotal) * 1000) / 10}%` : "";
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
    lines: SAMPLE,
    subtotal, discount, discLabel, taxable,
    total: taxable + taxWhole,
    taxRows,
    autoPrint: false,
    note: parcel
      ? "A sample parcel bill from this restaurant's own settings — the exact page the counter prints. The same details as a table bill, with PARCEL where the table would be."
      : "A sample bill from this restaurant's own settings — the exact page the manager panel prints. It carries an add-on, a discount and a named customer so the busiest version of the layout is visible.",
  });
}
