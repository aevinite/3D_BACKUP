// ============================================================================
// lib/banquetFields.ts — WHICH boxes a restaurant is asked for on a banquet bill.
//
// Owner, 2026-07-31: "only ask for what's necessary … there will be one info-format
// option in banquet in Access & permissions in the admin panel, and the restaurant
// will only get to choose what they fill." So the bill screen and the printed paper
// are both BUILT from this list; an unticked key is absent from the screen AND from
// the paper (no empty boxes). Everything tax-sensitive is deliberately NOT here —
// bill number, date, amounts, tax, totals, words, our own GSTIN and who made the
// bill are filled by the server and cannot be typed over.
//
// The manager panel is vanilla JS and mirrors this list in
// public/panels/editor/app.js (BQ_FIELDS) — keep the two in step; the SERVER is the
// one that decides what gets stored (mig 237 filters every meta key by this list).
// ============================================================================

export type BanquetFieldKey =
  | "cust_name" | "cust_phone" | "dish" | "pax" | "rate" | "advance"
  | "extras" | "disc" | "func" | "hall" | "fndate" | "gstin" | "address"
  | "person" | "paysplit" | "remark" | "by";

export const BANQUET_FIELDS: { key: BanquetFieldKey; label: string; what: string }[] = [
  { key: "cust_name",  label: "Customer name",        what: "Prints as “Bill To”." },
  { key: "cust_phone", label: "Mobile number",        what: "Typing it finds a past customer and fills the name." },
  { key: "dish",       label: "Package / dish name",  what: "Picked from this restaurant’s banquet packages." },
  { key: "pax",        label: "No. of plates (pax)",  what: "The quantity on the bill line." },
  { key: "rate",       label: "Price per plate",      what: "Only for an open-price package; a priced package uses its own rate." },
  { key: "advance",    label: "Advance received",     what: "One amount — the balance is worked out for them." },
  { key: "extras",     label: "Extra lines",          what: "Décor, DJ, live counter, extra plates — more bill lines." },
  { key: "disc",       label: "Discount",             what: "A percentage off a line. Off ⇒ nobody can discount a banquet." },
  { key: "func",       label: "Function name",        what: "Reception, wedding, birthday…" },
  { key: "hall",       label: "Hall / banquet name",  what: "Prints as “Banq. Name”." },
  { key: "fndate",     label: "Function date & time", what: "When the event is — separate from the bill date." },
  { key: "gstin",      label: "Customer GSTIN",       what: "Turns the paper into a full company tax invoice with per-line CGST/SGST." },
  { key: "address",    label: "Customer address",     what: "Needed on company bills." },
  { key: "person",     label: "Contact person",       what: "Who to call about the booking." },
  { key: "paysplit",   label: "How they paid",        what: "Several dated rows: cash / card / online / cheque." },
  { key: "remark",     label: "Remark on the bill",   what: "Free text under Terms & conditions." },
  { key: "by",         label: "Print “prepared by”",  what: "Always recorded — this only decides whether it prints." },
];

// What the app fills itself. Shown to the admin as a locked list so it is obvious
// that no restaurant (and no client) can touch these.
export const BANQUET_LOCKED: [string, string][] = [
  ["Bill number", "Its own banquet series — never shared with a table bill, never sent by the browser."],
  ["Bill date & time", "Taken from the clock when the bill is issued."],
  ["Amounts, tax, round off, total", "Priced on the server from the restaurant’s own rate."],
  ["Amount in words", "Written from the total."],
  ["Your name, address, GSTIN", "From the restaurant’s billing settings."],
  ["Who made the bill", "Recorded on every bill even when it isn’t printed."],
  ["Cancel = a visible void", "A wrong bill is voided from Bills with a reason and stays in the ledger."],
];

export const BANQUET_PRESETS: Record<"simple" | "company" | "full", BanquetFieldKey[]> = {
  simple:  ["cust_name", "cust_phone", "dish", "pax", "rate", "advance"],
  company: ["cust_name", "cust_phone", "dish", "pax", "rate", "advance", "extras", "gstin", "address", "func", "fndate", "remark"],
  full:    BANQUET_FIELDS.map((f) => f.key),
};

const KEYS = new Set(BANQUET_FIELDS.map((f) => f.key));

/** Clean a fields list coming from a client: known keys only, deduped, order kept. */
export function cleanBanquetFields(v: unknown): BanquetFieldKey[] {
  const arr = Array.isArray(v) ? v : [];
  const out: BanquetFieldKey[] = [];
  for (const x of arr) {
    const k = String(x) as BanquetFieldKey;
    if (KEYS.has(k) && !out.includes(k)) out.push(k);
  }
  return out.length ? out : BANQUET_PRESETS.simple;
}

/** The paper a restaurant prints on. 'plain' (default) = the app prints the header too. */
export type BanquetPaper = {
  paper: "plain" | "pad";
  size: "a4" | "a5";
  top: number; bot: number; side: number;
  foot: boolean; sign: boolean; fill: boolean;
};
export const BANQUET_PAPER_DEFAULTS: BanquetPaper = {
  paper: "plain", size: "a5", top: 33, bot: 14, side: 6, foot: false, sign: true, fill: true,
};
const clamp = (n: unknown, lo: number, hi: number, dflt: number) => {
  const v = Math.round(Number(n));
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : dflt;
};
/** Read the paper setup out of a settings row, with every default applied. */
export function banquetPaperOf(s: Record<string, unknown> | null | undefined): BanquetPaper {
  const r = s || {};
  return {
    paper: r.banquet_paper === "pad" ? "pad" : "plain",
    size: r.banquet_paper_size === "a4" ? "a4" : "a5",
    top: clamp(r.banquet_paper_top, 0, 80, 33),
    bot: clamp(r.banquet_paper_bot, 0, 50, 14),
    side: clamp(r.banquet_paper_side, 2, 25, 6),
    foot: r.banquet_paper_foot === true,
    sign: r.banquet_paper_sign !== false,
    fill: r.banquet_paper_fill !== false,
  };
}

/** Render a bill number the same way SQL does (lfh_banquet_bill_no, mig 237). */
export function banquetBillNo(prefix: string, style: string, seq: number, when: Date = new Date()): string {
  const p = (prefix || "BQB").toUpperCase();
  const dd = String(when.getDate()).padStart(2, "0") + String(when.getMonth() + 1).padStart(2, "0") + String(when.getFullYear()).slice(2);
  const y = when.getFullYear();
  const fy = when.getMonth() + 1 >= 4 ? `${y}-${String(y + 1).slice(2)}` : `${y - 1}-${String(y).slice(2)}`;
  if (style === "date") return `${p}-${dd}-${seq}`;
  if (style === "plain") return `${p}-${String(seq).padStart(6, "0")}`;
  return `${p}/${fy}/${String(seq).padStart(6, "0")}`;
}

/** The banquet's own tax lines, or [] when it borrows the restaurant's normal tax (mig 239). */
export function banquetTaxOf(s: Record<string, unknown> | null | undefined): { label: string; rate: number }[] {
  const raw = Array.isArray((s || {}).banquet_tax_components) ? ((s || {}) as Record<string, unknown>).banquet_tax_components as unknown[] : [];
  return raw
    .map((c) => ({ label: String((c as Record<string, unknown>)?.label ?? "").trim().slice(0, 24), rate: Math.round((Number((c as Record<string, unknown>)?.rate) || 0) * 100) / 100 }))
    .filter((c) => c.label && c.rate > 0 && c.rate <= 100)
    .slice(0, 6);
}
