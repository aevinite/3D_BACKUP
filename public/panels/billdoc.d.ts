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
  /** The discount written as a percentage, in brackets after the word "Discount". Use `discPct()`
   *  so every screen quotes the same figure. On the one bill where the document has to CLAMP the
   *  discount (more discount than there is subtotal), it re-words this from what it actually
   *  deducted rather than print a percentage nobody was given. */
  discLabel?: string;
  /** DECLARED FOR THE CALLERS THAT STILL PASS IT — the document does NOT render this value.
   *  "Taxable value" is DERIVED as (subtotal − discount) inside `billRows()`, precisely so the row
   *  cannot disagree with the two rows above it. Passing a different number here changes nothing;
   *  if it ever needs to, it has to go through `billRows()`. */
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
  /** true = this restaurant is on the COMPOSITION scheme, so the paper is a **Bill of Supply**,
   *  not a tax invoice: the heading and `<title>` change, the "not eligible to collect tax on
   *  supplies" declaration prints, and the "Taxable value" restatement is dropped (a composition
   *  bill has no taxable value to restate). `billData` sets it from the money; a caller building
   *  figures by hand (the admin preview, `lib/billPreview.ts`) must pass it too. */
  composition?: boolean;
  /** true = every order on this bill was CANCELLED, so the paper is a **Cancelled Bill**, not a tax
   *  invoice: the heading and `<title>` change, the "Cancelled — no charge" band prints across the
   *  top, the item rows are re-titled "Ordered value" against a matching "Cancelled — not charged"
   *  line, and the TOTAL is ₹0. No discount, tax, MRP or round-off row prints — none of them
   *  describes a bill nobody paid. A cancelled bill that HAD an invoice number still names it,
   *  marked "— voided" (COMPLIANCE §2): the number retires, it is never freed.
   *
   *  `billData` sets it from the orders. It was undeclared here until 2026-08-17, so a TypeScript
   *  caller could not render this document at all — on the one flag the whole sheet's identity
   *  turns on. */
  cancelled?: boolean;
  /* REJECTED (owner, 2026-08-19): there is no `reprint` on a BILL. The band was live 2026-08-17 →
   * 2026-08-19 and the owner removed it — a second copy of a bill is a service action, not an
   * incident. Declaring the flag again is what would let a caller pass it, so it stays undeclared.
   * The kitchen TICKET keeps its own `reprint` (BillDocKot below) — that one he confirmed.
   * R37 in docs/REJECTED-IDEAS.md. */
  /** The bill's position in the signed chain (mig 332) and its `chain_hash`. Supply BOTH or the
   *  verification line does not print at all. The document takes the first 12 characters of the
   *  hash — enough to identify one bill, short enough for a 66mm roll — and formats the line
   *  itself, so every panel prints the same reference for the same bill.
   *  Never printed on a cancelled sheet. */
  chainSeq?: number | string;
  chainHash?: string;
  /** true = leave OFF the screen-only toolbar and its script. For a bill shown as EVIDENCE (the Audit
   *  card renders it in a sandboxed iframe with no scripts), where the bar's Print and Close buttons
   *  would be dead controls sitting on the document. The paper is identical either way. */
  noBar?: boolean;
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
  /** The word the PAPER uses for tax where it needs a generic one (the MRP note, and the fallback
   *  line when the configured components do not describe this bill's rate). Defaults to **"GST"** —
   *  it sits beside CGST/SGST on a document a customer and an inspector read. */
  taxLabel: string;
  /** The word a STAFF PANEL uses on screen. Defaults to **"Tax"** — a panel is not a tax document
   *  and does not commit to a regime's name (owner, 2026-08-28). Same setting, different fallback:
   *  a restaurant that types its own word gets it in both places. */
  taxLabelScreen: string;
}

export function billDocHtml(d: BillDocData): string;
export function kotDocHtml(o: KotDocData): string;
/** The time on a printed kitchen ticket, with the DAY when it isn't today
 *  ("09:31 PM" · "YESTERDAY 09:31 PM" · "6 AUG 09:31 PM"). Black-and-white by design.
 *
 *  Pinned to en-IN + Asia/Kolkata like the bill's date row and the banquet sheet's, so one order
 *  reads the same on every device in the building — and "today" is the restaurant's **05:00 IST
 *  business day** (mig 044, `lib/businessDay.ts`), the same day the counters, the panels' Today
 *  filter and the Z-report use, so a ticket rung at 23:50 is not "YESTERDAY" at 00:10 of the same
 *  service. Returns "" for a missing or unparseable timestamp — never "Invalid Date". */
export function kotWhen(ts: string | number | Date | null | undefined): string;
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
/** billData({ …, chainOnPaper }) — set `chainOnPaper: true` to print the mig-332 verification
 *  line. It is OFF everywhere on purpose: whether a guest's receipt should carry it is an open
 *  decision (see the note in billData). The reference itself is read from the session, or from the
 *  order rows the manager's API attaches it to, both parts always from the same place. */
export function billData(a: {
  settings?: Record<string, unknown>;
  restaurant?: Record<string, unknown>;
  orders?: Record<string, unknown>[];
  money?: BillMoney;
  session?: Record<string, unknown>;
  tableDisp?: string;
  logo?: string;
  parcel?: boolean;
  /* REJECTED (owner, 2026-08-19): no `reprint` argument. See the note on BillDocData above —
   * a bill sheet is identical on the tenth copy and the first. */
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
