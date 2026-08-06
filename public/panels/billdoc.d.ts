// Types for /panels/billdoc.js — the ONE description of the two pieces of paper this product
// prints. The panels load it as a plain <script> (window.LFH_BILLDOC); the Next server and the
// admin React screens import it, so the preview and the printer cannot drift apart.

export interface BillDocLine {
  title?: string;
  qty?: number;
  /** Unit price INCLUDING its priced add-ons — the document works the base price back out. */
  price?: number | string;
  options?: { label?: string; price?: number }[];
  /** true = this line wears the "MRP" stamp beside its name — its price is FINAL (mig 270). */
  is_mrp?: boolean;
}

export interface BillDocTaxRow {
  label?: string;
  rate?: number;
  amt?: number;
}

export interface BillDocData {
  logo?: string;
  name?: string;
  addr?: string;
  phone?: string;
  gstin?: string;
  footer?: string;
  invNo?: string;
  billNo?: string | number;
  parcel?: boolean;
  tableDisp?: string;
  dateStr?: string;
  cust?: string;
  custPhone?: string;
  lines?: BillDocLine[];
  subtotal?: number;
  discount?: number;
  discLabel?: string;
  taxable?: number;
  /** Tax rows ADDED on top, printed above the TOTAL. An EMPTY array means no tax line at all —
   *  a composition-scheme restaurant, or a bill whose prices already contain all of their tax. */
  taxRows?: BillDocTaxRow[];
  /** The tax ALREADY INSIDE the printed prices, reported UNDER the total as "Price includes" and
   *  never added to it. One bill can carry both: `taxRows` is what is added, this is what the
   *  prices already hold, so a bill mixing tax-on-top and tax-inside dishes still foots. */
  inclRows?: BillDocTaxRow[];
  /** The original all-or-nothing flag: treat `taxRows` itself as inside-tax and add nothing.
   *  `inclRows` is preferred; this is kept for callers that pass it directly. */
  taxIncluded?: boolean;
  total?: number;
  /** MRP / untaxed lines (mig 270) — the part of the bill GST is NOT charged on. 0 or absent
   *  renders exactly as before; above 0 the first row becomes "Food subtotal" and this amount
   *  is added AFTER the tax rows, so the column still foots. */
  nontax?: number;
  /** The wording of that row. Defaults to "MRP items". */
  mrpLabel?: string;
  /** One printed line under the totals explaining the untaxed part. Only rendered when
   *  `nontax` is above 0, and it must only claim tax is inside the price when it really is. */
  mrpNote?: string;
  /** true = the page opens the print dialog by itself (a real print, not a preview). */
  autoPrint?: boolean;
  /** A line of explanation in the screen-only toolbar. Never printed. */
  note?: string;
}

export interface KotDocLine {
  qty?: number;
  title?: string;
  options?: (string | { label?: string })[];
  removed?: string[];
  note?: string;
}

export interface KotDocData {
  title?: string;
  rname?: string;
  head?: string;
  kot?: string | number;
  tableLabel?: string;
  when?: string;
  lines?: KotDocLine[];
  /** Pre-built rows, for callers that still assemble their own. `lines` is preferred. */
  linesHtml?: string;
  allergies?: string[];
  allergHtml?: string;
  extraHtml?: string;
  note?: string;
  /** A reprinted ticket carries the big "*** REPRINT · DUPLICATE ***" banner on top,
   *  so the kitchen can never mistake a duplicate for a fresh order (owner, 2026-08-04). */
  reprint?: boolean;
}

export interface BillIdentity {
  isDefault: boolean;
  name: string;
  address: string;
  phone: string;
  gstin: string;
  prefix: string;
  footer: string;
  taxLabel: string;
}

export function billDocHtml(d: BillDocData): string;
export function kotDocHtml(o: KotDocData): string;
export function kotLineHtml(r: KotDocLine): string;
export function billIdentity(
  settings: Record<string, unknown>,
  restaurant: Record<string, unknown>,
): BillIdentity;
export function splitTax(
  taxWhole: number,
  comps: { label?: string; rate?: number }[],
): BillDocTaxRow[];
/** A discount as a percentage of the pre-discount subtotal — "10%" / "12.5%", "" when there
 *  is nothing to show. Derived in ONE place so the paper and every screen quote the same figure. */
export function discPct(subtotal: number, disc: number): string;
export function inr(v: number | string): string;

// ── the bill's MONEY and the assembly of its data (moved here 2026-08-04) ────────────────────
// The waiter panel could do every step of issuing a tax invoice except produce it, because the
// whole assembly lived inside the manager panel. Both panels feed these now, so there is one
// place that decides a bill's figures and one place that decides what goes on the paper.

export interface BillMoney {
  subtotal: number; disc: number; taxable: number; rate: number; tax: number; total: number;
  taxComponents: { label: string; rate: number }[];
  taxableBase: number; nontax: number; mrpAmount: number;
  discountBase: number; discountFixed: number; hasMrp: boolean; composition: boolean;
  /** What the TAXED item rows add up to on the paper. Equals `taxableBase` on an ordinary bill;
   *  bigger when prices already contain their tax, and the difference is that tax. */
  grossTaxed: number;
  /** The part of `tax` already inside the printed prices — reported under the total, never added. */
  taxInside: number;
  /** The part of `tax` still to be added on top. `taxInside + taxAdded === tax`. */
  taxAdded: number;
  /** True when one bill carries orders charged at DIFFERENT rates (a banquet beside dine-in food),
   *  so the paper names each rate on its own line instead of one percentage nobody was charged. */
  mixedRates: boolean;
  /** One entry per distinct rate, biggest taxed slice first. */
  rateRows: { rate: number; taxable: number; tax: number }[];
}
export interface TaxModel {
  rate: number; pct: number;
  components: { label: string; rate: number }[];
  composition: boolean;
}

/** The ONE tax model: named components sum to the rate, else the fallback, else 5% — and a
 *  composition-scheme restaurant's rate genuinely IS zero (mig 272). */
export function taxModel(settings: Record<string, unknown>): TaxModel;
/** A bill's figures. Discount BEFORE tax, tax on the TAXABLE BASE (not the subtotal), at the rate
 *  the order was actually charged at (orders.tax_rate, mig 284). */
export function billMoney(orders: Record<string, unknown>[], settings: Record<string, unknown>): BillMoney;
/** THE rate ONE order was charged at — the single definition, shared by the printed bill and by
 *  settling a bill in parts (`lib/paySplit.ts`), because it existed twice and had drifted.
 *
 *  A positive stamped rate wins (mig 284). A stamped ZERO from an order that carries money is a
 *  real rate, not a missing one — that is what stops a 0%-era bill reprinting with tax nobody
 *  charged once the restaurant switches GST on. Anything else falls back to `settingsRate`, so a
 *  ₹0 line on a taxed bill cannot drag the whole bill's rate to nothing. */
export function orderTaxRate(
  order: { tax_rate?: number | null; subtotal?: number | string | null } | null | undefined,
  settingsRate: number,
): number;
/** Everything the paper needs, assembled once. Pass what only the panel knows. */
export function billData(a: {
  settings?: Record<string, unknown>;
  restaurant?: Record<string, unknown>;
  orders?: Record<string, unknown>[];
  money?: BillMoney;
  session?: Record<string, unknown>;
  tableDisp?: string;
  logo?: string;
  parcel?: boolean;
  autoPrint?: boolean;
  now?: string | number | Date;
}): BillDocData;
/** One bill line per dish, not one per KOT. */
export function combineBillLines(entries: BillDocLine[]): BillDocLine[];
/** The GST sitting INSIDE tax-inclusive MRP lines. */
export function mrpTaxInside(orders: Record<string, unknown>[], rate: number): number;
/** The untaxed pile as a bill should show it — 0 on a composition restaurant, where splitting
 *  "food" from "MRP" says nothing and reads as broken. */
export function mrpPart(m: BillMoney | null | undefined): number;
/** <prefix>/<FY>/<6-digit>. The FY is the INVOICE'S OWN — a March bill reprinted in April keeps
 *  its year, or one sale ends up with two identities. */
export function invFmt(no: number | null | undefined, when?: string | null, prefix?: string): string;
export function financialYear(when?: string | null): string;

// ── the banquet bill: the third piece of paper, and the last that existed twice ──────────────
/** The banquet tax invoice. `bill` is a banquet_bills row (its frozen tax_lines are used when
 *  present, so a re-print years later cannot be re-split by a rate that changed since). */
export function banquetDocHtml(a: {
  bill: Record<string, unknown>;
  lines: { title?: string; qty?: number; price?: number }[];
  settings?: Record<string, unknown>;
  restaurant?: Record<string, unknown>;
  logo?: string;
  /** false = a PREVIEW: show the sheet and its toolbar, but do not fire the print dialog by
   *  itself. Default (omitted/true) is the real print. */
  autoPrint?: boolean;
  /** A line in the screen-only toolbar — a preview says so there. */
  note?: string;
}): string;
export function bqPaper(settings: Record<string, unknown>): {
  pad: boolean; size: "a4" | "a5"; top: number; bot: number; side: number;
  foot: boolean; sign: boolean; fill: boolean;
};
export function bqTaxModel(settings: Record<string, unknown>): TaxModel & { own: boolean };
export function bqOn(settings: Record<string, unknown>, k: string): boolean;
export function bqWords(amount: number): string;
/** The rows a bill SHOWS, in whole rupees, made to reconcile to the TOTAL (a "Round off" row
 *  carries what whole rupees cannot express). Never changes what is charged. */
export function billRows(d: BillDocData): {
  disc: number; inclusive: boolean; subtotal: number; discount: number;
  taxable: number; tax: number; nontax: number; total: number; roundOff: number;
};
