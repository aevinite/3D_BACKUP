// Types for /panels/billdoc.js — the ONE description of the two pieces of paper this product
// prints. The panels load it as a plain <script> (window.LFH_BILLDOC); the Next server and the
// admin React screens import it, so the preview and the printer cannot drift apart.

export interface BillDocLine {
  title?: string;
  qty?: number;
  /** Unit price INCLUDING its priced add-ons — the document works the base price back out. */
  price?: number | string;
  options?: { label?: string; price?: number }[];
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
  taxRows?: BillDocTaxRow[];
  total?: number;
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
export function inr(v: number | string): string;
