// lib/billPreview.ts — "show me what the bill will actually look like".
//
// WHY (owner, 2026-08-02): the two bill FORMAT screens let you set GSTIN, the legal name,
// the tax rows, the footer — and then you have to imagine the result. This renders the
// finished page from the restaurant's own settings so it can be looked at, and printed on
// the real printer, before a customer ever gets one.
//
// It is deliberately filled with SAMPLE lines that carry every optional part — an add-on,
// a dish note and an allergy line — even for a restaurant whose real bills rarely have
// them. The owner's point: a preview that only shows the plain case doesn't tell you how
// the busy case looks, which is the one that breaks a layout.
//
// SCOPE, stated honestly: this is the preview renderer. The live printers still live in
// the panels (printParcelReceipt / the manager's print-bill window) and were NOT refactored
// to share this yet, so a layout change made in one has to be made in the other. Doing that
// properly means moving the panels onto this endpoint — worth doing, not done here.

export type BillMode = "bill" | "parcel";

type Settings = Record<string, unknown>;
const s = (v: unknown, d = "") => (typeof v === "string" && v.trim() ? v.trim() : d);
const n = (v: unknown, d = 0) => (typeof v === "number" && isFinite(v) ? v : d);
const esc = (v: unknown) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const inr = (v: number) => "₹" + (Math.round(v * 100) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// One sample order, used by BOTH formats so the two previews are comparable line for line.
const SAMPLE = [
  { title: "Paneer Butter Masala", qty: 2, price: 320, addons: [{ label: "Extra gravy", price: 40 }], note: "less oil" },
  { title: "Garlic Naan", qty: 4, price: 70, addons: [{ label: "Butter", price: 15 }] },
  { title: "Fresh Lime Soda", qty: 2, price: 120, addons: [] as { label: string; price: number }[] },
];
const SAMPLE_ALLERGY = ["dairy", "nuts"];

/** The finished bill as a standalone printable HTML document. */
export function billPreviewHtml(settings: Settings, mode: BillMode): string {
  const parcel = mode === "parcel";
  const name = s(settings.restaurant_name, "Your Restaurant");
  const legal = s(settings.bill_legal_name) || s(settings.legal_name);
  const addr = s(settings.bill_address) || s(settings.address);
  const phone = s(settings.bill_phone) || s(settings.phone);
  const gstin = s(settings.gstin);
  const prefix = s(settings.invoice_prefix, "INV");
  const footer = s(settings.bill_footer, "Thank you — please come again");

  // Money, computed exactly the way a real bill is: add-ons are part of the line, tax sits
  // on the discounted subtotal, and the components split that same tax (never a second one).
  const lines = SAMPLE.map((l) => {
    const addons = l.addons.reduce((t, a) => t + a.price, 0);
    return { ...l, each: l.price + addons, total: (l.price + addons) * l.qty };
  });
  const sub = lines.reduce((t, l) => t + l.total, 0);
  const discount = 50;
  const taxable = sub - discount;
  const comps = Array.isArray(settings.tax_components) && (settings.tax_components as unknown[]).length
    ? (settings.tax_components as { label?: string; rate?: number }[])
    : [{ label: "CGST", rate: n(settings.tax_rate, 0.05) / 2 }, { label: "SGST", rate: n(settings.tax_rate, 0.05) / 2 }];
  const taxRows = comps.map((c) => ({ label: s(c.label, "Tax"), amt: Math.round(taxable * n(c.rate, 0) * 100) / 100 }));
  const tax = taxRows.reduce((t, r) => t + r.amt, 0);
  const grand = Math.round((taxable + tax) * 100) / 100;

  const itemHtml = lines.map((l) => `
    <div class="ln"><span class="q">${l.qty}×</span><span class="nm">${esc(l.title)}</span><span class="amt">${inr(l.total)}</span></div>
    ${l.addons.map((a) => `<div class="sub-ln"><span>＋ ${esc(a.label)}</span><span>${inr(a.price * l.qty)}</span></div>`).join("")}
    ${l.note ? `<div class="sub-ln note">» ${esc(l.note)}</div>` : ""}`).join("");

  const width = parcel ? "72mm" : "80mm";
  return `<!doctype html><html><head><meta charset="utf-8">
<title>${esc(parcel ? "Parcel bill" : "Table bill")} — preview</title>
<style>
  @page { margin: 0 }
  body { margin: 0; background: #eceff3; font-family: ui-monospace, "IBM Plex Mono", Consolas, monospace; color: #111; }
  .sheet { width: ${width}; margin: 22px auto; background: #fff; padding: 12px 14px 18px; box-shadow: 0 8px 26px rgba(0,0,0,.16); }
  .bar { max-width: 420px; margin: 18px auto 0; text-align: center; font-family: system-ui, sans-serif; }
  .bar button { font: inherit; font-weight: 700; padding: 9px 20px; border-radius: 9px; border: 0; background: #111; color: #fff; cursor: pointer; }
  .bar p { font-size: 12px; color: #4a5568; line-height: 1.5; }
  h1 { font-family: Georgia, serif; font-size: 17px; margin: 0; text-align: center; }
  .meta { text-align: center; font-size: 10.5px; color: #333; margin: 3px 0 2px; line-height: 1.45; }
  .tag { text-align: center; font-weight: 700; letter-spacing: .12em; border-top: 1px solid #111; border-bottom: 1px solid #111; padding: 4px 0; margin: 9px 0; font-size: 12px; }
  .who { display: flex; justify-content: space-between; font-size: 11px; margin-bottom: 7px; }
  .ln { display: flex; gap: 6px; font-size: 12px; padding: 4px 0; }
  .ln .q { font-weight: 700; }
  .ln .nm { flex: 1; }
  .ln .amt, .sub-ln span:last-child { font-variant-numeric: tabular-nums; }
  .sub-ln { display: flex; justify-content: space-between; font-size: 10.5px; color: #444; padding: 0 0 2px 18px; }
  .sub-ln.note { font-style: italic; }
  .rule { border-top: 1px dashed #111; margin: 8px 0; }
  .tot { display: flex; justify-content: space-between; font-size: 11.5px; padding: 2px 0; }
  .grand { display: flex; justify-content: space-between; font-weight: 700; font-size: 15px; border-top: 1px solid #111; margin-top: 6px; padding-top: 6px; }
  .alg { border: 1px solid #111; padding: 4px 6px; margin: 9px 0 0; font-size: 11px; font-weight: 700; }
  .ft { text-align: center; font-size: 10.5px; color: #333; margin-top: 10px; }
  @media print { body { background: #fff } .sheet { box-shadow: none; margin: 0; width: auto } .bar { display: none } }
</style></head><body>
<div class="sheet">
  <h1>${esc(name)}</h1>
  ${legal ? `<div class="meta">${esc(legal)}</div>` : ""}
  ${addr ? `<div class="meta">${esc(addr)}</div>` : ""}
  ${phone ? `<div class="meta">${esc(phone)}</div>` : ""}
  ${gstin ? `<div class="meta">GSTIN ${esc(gstin)}</div>` : ""}
  <div class="tag">${parcel ? "PARCEL" : "TAX INVOICE"}</div>
  <div class="who"><span>${esc(prefix)}-0042</span><span>${parcel ? "Parcel 3" : "Table 7"}</span></div>
  <div class="who"><span>${new Date().toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</span><span>Riya S.</span></div>
  <div class="rule"></div>
  ${itemHtml}
  <div class="rule"></div>
  <div class="tot"><span>Subtotal</span><span>${inr(sub)}</span></div>
  <div class="tot"><span>Discount</span><span>− ${inr(discount)}</span></div>
  ${taxRows.map((r) => `<div class="tot"><span>${esc(r.label)}</span><span>${inr(r.amt)}</span></div>`).join("")}
  <div class="grand"><span>TOTAL</span><span>${inr(grand)}</span></div>
  <div class="alg">⚠ AVOID: ${esc(SAMPLE_ALLERGY.join(", "))}</div>
  <div class="ft">${esc(footer)}</div>
</div>
<div class="bar">
  <button onclick="window.print()">🖨 Print this preview</button>
  <p>A sample bill drawn from this restaurant's own settings.<br>
     It deliberately shows an add-on, a dish note, a discount and an allergy line so you can
     see the busiest version of the layout — real bills only print the parts they have.</p>
</div>
</body></html>`;
}
