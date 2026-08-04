// Single source of truth for a restaurant's EFFECTIVE tax rate.
//
// A restaurant sets its tax as either a set of NAMED components (CGST/SGST/… — mig 117,
// each a percent) whose SUM is the total rate, OR, if none are configured, a single
// fallback `tax_rate` (a decimal like 0.05), and if that's blank too, 5%.
//
// This mirrors, byte-for-byte, taxModel() in public/panels/editor/app.js and the SQL
// lfh_effective_tax_rate() (migration 119). They MUST agree — the printed bill, the
// manager pay screen, the guest cart, the Z-report, the dashboard and the server-stored
// order totals all derive their tax from this one rule, so a bill can never show four
// different totals (the "cosmetic multi-tax" bug, 2026-07-04).

type TaxSettings = { tax_components?: unknown; tax_rate?: unknown } | null | undefined;

/** Named components with a real label + a positive rate — the only ones that count. */
function components(raw: TaxSettings): { label: string; rate: number }[] {
  const list = raw && Array.isArray((raw as { tax_components?: unknown }).tax_components)
    ? ((raw as { tax_components: unknown[] }).tax_components)
    : [];
  return list
    .map((c) => ({ label: String((c as { label?: unknown })?.label ?? "").trim(), rate: Number((c as { rate?: unknown })?.rate) || 0 }))
    .filter((c) => c.label && c.rate > 0);
}

/** Named tax components (CGST/SGST/…), each rate a PERCENT — for display + splitting a tax
 *  total into its parts. Empty when the restaurant uses a single flat rate instead. */
export function taxComponents(raw: TaxSettings): { label: string; rate: number }[] { return components(raw); }

/** The effective tax rate as a DECIMAL (e.g. 0.05 for 5%).
 *
 *  A COMPOSITION-SCHEME restaurant's rate is 0 (mig 272). It cannot legally pass GST to the
 *  diner, so its rate genuinely is zero — not "5% that we then hide". Hiding a rate while
 *  still arithmetically applying it is how a bill stops adding up: every `due = total −
 *  discount × (1 + rate)` in the app would have over-subtracted on a discounted bill. */
export function effectiveTaxRate(raw: TaxSettings): number {
  if (String((raw as { price_tax_mode?: unknown })?.price_tax_mode ?? "") === "composition") return 0;
  const comps = components(raw);
  if (comps.length) return comps.reduce((a, c) => a + c.rate, 0) / 100;
  const rate = Number((raw as { tax_rate?: unknown })?.tax_rate) || 0.05;
  return rate;
}

/** The effective tax rate as a PERCENT for display (e.g. 5 or 12.5). */
export function effectiveTaxPct(raw: TaxSettings): number {
  return Math.round(effectiveTaxRate(raw) * 10000) / 100;
}

// ─────────────────── PRICE MODES: GST on top, GST inside, MRP (mig 270) ───────────────────
//
// A dish's price answers one of three questions, and the answer changes the arithmetic:
//   'excl'   — the price is net; GST is ADDED on top.               (the default, today)
//   'incl'   — the price already CONTAINS GST; it is pulled out.
//   'exempt' — no GST at all; the price is final.                   (MRP items, nil-rated)
//
// This is the TypeScript half of `lfh_resolve_tax_mode` / `lfh_split_items_tax` (migration
// 269). The two MUST agree — the server prices the order, but the guest cart, the manager's
// bill card and the printed paper all show a figure derived here, so a disagreement is four
// different totals for one meal (the bug this codebase already learned in 2026-07-04).

export type TaxBehaviour = "excl" | "incl" | "exempt";
export type DishTaxMode = "default" | "excl" | "incl" | "mrp" | "none";

// NonNullable first, then re-add the nullable arms: TaxSettings already ends in `| null |
// undefined`, and intersecting a union with an object type distributes over it and drops
// those arms — which made every caller holding a nullable settings row (lib/menu.ts) stop
// compiling.
type ModeSettings = (NonNullable<TaxSettings> & {
  price_tax_mode?: unknown;
  item_tax_modes_allowed?: unknown;
  mrp_tax_treatment?: unknown;
}) | null | undefined;

/** The restaurant-wide answer: are typed menu prices net, gross, or untaxable entirely? */
export function priceTaxMode(raw: ModeSettings): "excl" | "incl" | "composition" {
  const v = String((raw as { price_tax_mode?: unknown })?.price_tax_mode ?? "excl");
  return v === "incl" || v === "composition" ? v : "excl";
}

/** Are per-dish overrides switched on for this restaurant? Admin-only; OFF everywhere by
 *  default (owner, 2026-08-04: "off this for all restaurant for now"). While it is off, a
 *  dish's own setting is ignored completely — not merely hidden. */
export function itemTaxModesAllowed(raw: ModeSettings): boolean {
  return (raw as { item_tax_modes_allowed?: unknown })?.item_tax_modes_allowed === true;
}

/** Turn a dish's stored choice into the behaviour a LINE actually gets, for this restaurant.
 *  Mirrors lfh_resolve_tax_mode() exactly, including the order the cases are tested in. */
export function resolveTaxMode(dishMode: unknown, raw: ModeSettings): TaxBehaviour {
  // A composition-scheme restaurant cannot legally pass GST to the diner, so nothing on its
  // bill is taxable and no tax line prints (docs/COMPLIANCE-GUARDRAILS.md §3).
  if (priceTaxMode(raw) === "composition") return "exempt";
  const restaurant: TaxBehaviour = priceTaxMode(raw) === "incl" ? "incl" : "excl";
  if (!itemTaxModesAllowed(raw)) return restaurant;
  const m = String(dishMode ?? "default") as DishTaxMode;
  if (m === "excl" || m === "incl") return m;
  if (m === "none") return "exempt";
  if (m === "mrp") {
    return String((raw as { mrp_tax_treatment?: unknown })?.mrp_tax_treatment) === "inclusive"
      ? "incl"
      : "exempt";
  }
  return restaurant;
}

/** True when a dish should wear the "MRP" stamp on a bill — the price is final and locked.
 *  Purely presentational; the money comes from resolveTaxMode(). */
export function isMrpDish(dishMode: unknown, raw: ModeSettings): boolean {
  return String(dishMode ?? "") === "mrp" && itemTaxModesAllowed(raw);
}

export type BillSplit = {
  taxableBase: number;   // the net amount GST is charged on
  nontaxAmount: number;  // every untaxed line — MRP AND ordinary nil-rated goods
  mrpAmount: number;     // the LOCKED part only: a sealed item whose printed price is final
  subtotal: number;      // taxableBase + nontaxAmount  (so subtotal + tax = total, as before)
  discountBase: number;  // the most a discount may be — see maxDiscount() for the rule
  discount: number;      // clamped to discountBase, never silently beyond it
  taxable: number;       // taxableBase − discount (when tax applies)
  rate: number;
  tax: number;
  total: number;
  hasMrp: boolean;
  composition: boolean;  // true = print no tax line at all
};

type SplitLine = { price?: unknown; qty?: unknown; tax_mode?: unknown; is_mrp?: unknown };

/** The most a whole-bill discount may be, stated once. Mirrors lfh_order_discount_base (271).
 *
 *  · rate > 0  → the TAXABLE base. The discount has to land on the taxed part, or the identity
 *                every panel relies on — due = total − discount × (1 + rate) — silently stops
 *                being true and each screen drifts by discount × rate.
 *  · rate = 0  → everything except the locked MRP lines. With no tax, (1 + rate) is 1, so the
 *                identity holds wherever the discount lands; only the MRP lock still bites.
 *                This is what lets a composition-scheme restaurant discount at all.
 *
 *  Note MRP ≠ untaxed. A sealed bottle's printed price is final; an ordinary nil-rated dish is
 *  a normal item that simply carries no GST, and staff may absolutely discount it. */
function discountBaseOf(taxableBase: number, nontaxAmount: number, mrpAmount: number, rate: number): number {
  if (rate > 0) return taxableBase;
  return Math.max(0, Math.round((taxableBase + nontaxAmount - mrpAmount) * 100) / 100);
}

/** The ONE place three behaviours turn into money on the client. Rounding is PER LINE, to
 *  match lfh_split_items_tax — a bill's lines are what a person checks against the paper. */
export function splitBill(lines: SplitLine[], raw: ModeSettings, discount = 0): BillSplit {
  const rate = effectiveTaxRate(raw);
  let taxableBase = 0;
  let nontaxAmount = 0;
  let mrpAmount = 0;
  let hasMrp = false;

  for (const ln of lines || []) {
    const unit = parseFloat(String(ln?.price ?? "").replace(/[^0-9.]/g, "")) || 0;
    const qty = Math.max(1, parseInt(String(ln?.qty ?? "1"), 10) || 1);
    const amt = Math.round(unit * qty * 100) / 100;
    const mode = String(ln?.tax_mode ?? "excl");
    if (ln?.is_mrp) { hasMrp = true; mrpAmount += amt; }
    if (mode === "exempt") nontaxAmount += amt;
    else if (mode === "incl") taxableBase += Math.round((amt / (1 + rate)) * 100) / 100;
    else taxableBase += amt;
  }

  taxableBase = Math.round(taxableBase * 100) / 100;
  nontaxAmount = Math.round(nontaxAmount * 100) / 100;
  mrpAmount = Math.round(mrpAmount * 100) / 100;

  const discountBase = discountBaseOf(taxableBase, nontaxAmount, mrpAmount, rate);
  const disc = Math.min(Math.max(0, Number(discount) || 0), discountBase);
  const subtotal = Math.round((taxableBase + nontaxAmount) * 100) / 100;

  // With no tax the discount can come off any unlocked line, so it reduces the bill directly.
  // With tax it must come off the taxable part, which is what keeps the due identity true.
  const taxable = rate > 0 ? Math.round((taxableBase - disc) * 100) / 100 : taxableBase;
  const tax = Math.round(taxable * rate * 100) / 100;
  const total = rate > 0
    ? Math.round((taxable + tax + nontaxAmount) * 100) / 100
    : Math.round((subtotal - disc) * 100) / 100;

  return {
    taxableBase, nontaxAmount, mrpAmount, subtotal, discountBase, discount: disc,
    taxable, rate, tax, total, hasMrp, composition: priceTaxMode(raw) === "composition",
  };
}

/** The most a whole-bill discount may be. Anything above this is REFUSED out loud rather
 *  than silently trimmed — a tap that vanishes is indistinguishable from a broken button. */
export function maxDiscount(lines: SplitLine[], raw: ModeSettings): number {
  return splitBill(lines, raw, 0).discountBase;
}
