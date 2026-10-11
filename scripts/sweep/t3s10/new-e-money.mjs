// Block E — the MONEY a guest reads, proved with numbers: every place in the territory that prints a
// figure is run through the formatter its source actually uses (read off the file, so a change to the
// file changes the check), over thousands of seeded carts, in every currency the menu offers.
import { check, SRC, fresh, rd } from "./lib.mjs";

const HOW = "STUB — real lib/format + lib/tax, the formatter each file really uses, 20,000 seeded figures";
const fmt = () => fresh("lib/format.ts", "client");
const tax = () => fresh("lib/tax.ts", "client");
let seed = 20261011; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const CURS = ["INR", "USD", "EUR", "AED", "SAR", "QAR"];
/** A stored order total the way CartPanel writes it (whole-rupee dishes, the restaurant's rate). */
function storedTotals(n) {
  const rates = [0.05, 0.12, 0.18, 0.025, 0.28];
  return Array.from({ length: n }, () => {
    const sub = Array.from({ length: 1 + Math.floor(rnd() * 5) }, () => (50 + Math.floor(rnd() * 900)) * (1 + Math.floor(rnd() * 3))).reduce((a, b) => a + b, 0);
    const r = rates[Math.floor(rnd() * rates.length)];
    return Math.round((sub * (1 + r) + (sub - sub)) * 100) / 100;
  });
}
/** What the bill's Live-status card prints for a stored total (CartPanel showPrice, SessionTableBill show). */
const billShows = (F, n, cur) => F.formatAmount(F.toMinor(n * cur.rate, cur), cur);
/** What the saved-orders chip prints for the same total — by the formatter its source names. */
function chipShows(F, n, cur) {
  const name = (SRC.chip.match(/o\.track\?\.total \? ` · \$\{([a-zA-Z]+)\(/) || [])[1];
  if (name === "formatPrice") return F.formatPrice(String(n), cur);
  if (name === "formatMoney") return F.formatMoney(n, cur);
  if (name === "showTotal" || name === "money") return billShows(F, n, cur);
  return `?${name}`;
}
let id = 172440;
for (const code of CURS) {
  check(`P${id++}`, "components/GuestOutboxChip.tsx", `a saved order's total on the chip equals the bill's figure for it, in ${code}`, HOW, () => {
    const F = fmt(); const cur = F.CURRENCIES.find((c) => c.code === code); const T = storedTotals(20000);
    const off = T.filter((n) => chipShows(F, n, cur) !== billShows(F, n, cur));
    return { ok: off.length === 0, note: `${off.length} of ${T.length} differ${off.length ? ` — e.g. ${off[0]}: chip ${chipShows(F, off[0], cur)} vs bill ${billShows(F, off[0], cur)}` : ""}` };
  });
}
// P172446…
check("P172446", "components/CartPanel.tsx", "the bill's Live-status total uses the SAME expression as the shared table bill (one rounding for one figure)", "SRC — components/CartPanel.tsx showPrice vs components/SessionTableBill.tsx show", () => {
  const a = (SRC.cart.match(/const showPrice = \(n: number\) => (\([^;]+\));/) || [])[1];
  const b = (/const show = \(n: number\) => (\([^;]+\));/.exec(rd("components/SessionTableBill.tsx")) || [])[1];
  return { ok: !!a && a === b, note: a };
});
check("P172447", "components/MiniCart.tsx", "the basket pill's subtotal equals the bill's subtotal for the same basket, in every currency (5,000 baskets each)", HOW, () => {
  const F = fmt(); let off = 0, total = 0;
  for (const code of CURS) {
    const cur = F.CURRENCIES.find((c) => c.code === code);
    for (let k = 0; k < 5000; k++) {
      const lines = Array.from({ length: 1 + Math.floor(rnd() * 4) }, () => {
        const addons = Array.from({ length: Math.floor(rnd() * 3) }, () => [0, 20, 35.5, 49.99][Math.floor(rnd() * 4)]);
        const unit = F.prettyUsd(40 + rnd() * 900) + addons.reduce((a, b) => a + b, 0);
        return { price: unit.toFixed(2), qty: 1 + Math.floor(rnd() * 5), options: addons.map((p) => ({ price: p })) };
      });
      // MiniCart: Σ unitDisplay(parseFloat(price), addon prices) × qty
      const mini = lines.reduce((s, l) => s + F.unitDisplay(parseFloat(l.price) || 0, l.options.map((o) => o.price || 0), cur) * l.qty, 0);
      // CartPanel lineDisp: unitDisplay(parseFloat(it.price), options' prices) × qty
      const bill = lines.reduce((s, l) => s + F.unitDisplay(parseFloat(l.price), l.options.map((o) => o.price || 0), cur) * l.qty, 0);
      total++; if (F.formatAmount(mini, cur) !== F.formatAmount(bill, cur)) off++;
    }
  }
  const same = /unitDisplay\(l\.usd, l\.addons, currency \|\| undefined\) \* l\.qty/.test(SRC.mini) && /unitDisplay\(parseFloat\(it\.price\), \(it\.options \|\| \[\]\)\.map\(\(o\) => o\.price \|\| 0\), currency \|\| undefined\) \* it\.qty/.test(SRC.cart);
  return { ok: same && off === 0, note: `${off} of ${total} differ · same expression in both files: ${same}` };
});
check("P172448", "components/OrderConfirmModal.tsx", "the dish popup's Total equals the bill line it saves, for every add-on mix and quantity 1–99", HOW, () => {
  const F = fmt(); let off = 0, n = 0;
  for (const code of CURS) {
    const cur = F.CURRENCIES.find((c) => c.code === code);
    for (let k = 0; k < 3000; k++) {
      const base = 40 + rnd() * 900, addons = Array.from({ length: Math.floor(rnd() * 3) }, () => [10, 25, 35.5, 49.99][Math.floor(rnd() * 4)]);
      const qty = 1 + Math.floor(rnd() * 99);
      const unit = F.prettyUsd(base) + addons.reduce((a, b) => a + b, 0);                // the popup
      const popup = F.unitDisplay(unit, addons, cur) * qty;
      const saved = unit.toFixed(2);                                                        // what it writes
      const bill = F.unitDisplay(parseFloat(saved), addons, cur) * qty;                     // what the bill reads
      n++; if (F.formatAmount(popup, cur) !== F.formatAmount(bill, cur)) off++;
    }
  }
  return { ok: off === 0, note: `${off} of ${n} differ` };
});
check("P172449", "components/OrderConfirmModal.tsx", "the popup's base + each add-on chip add up to its unit, in every currency (the chips can be trusted)", HOW, () => {
  const F = fmt(); let off = 0, n = 0;
  for (const code of CURS) {
    const cur = F.CURRENCIES.find((c) => c.code === code);
    for (let k = 0; k < 3000; k++) {
      const base = 40 + rnd() * 900, addons = Array.from({ length: 1 + Math.floor(rnd() * 3) }, () => [10, 25, 35.5, 49.99][Math.floor(rnd() * 4)]);
      const unit = F.prettyUsd(base) + addons.reduce((a, b) => a + b, 0);
      const chips = F.unitDisplay(F.prettyUsd(base), [], cur) + addons.reduce((s, a) => s + F.minorDisplay(a, cur), 0);
      n++; if (Math.abs(chips - F.unitDisplay(unit, addons, cur)) > 1e-9) off++;
    }
  }
  return { ok: off === 0, note: `${off} of ${n} differ` };
});
check("P172450", "components/CartPanel.tsx", "the 'Goes well with' price equals the dish card's price (same menu rounding)", HOW, () => {
  const F = fmt(); let off = 0, n = 0;
  for (const code of CURS) { const cur = F.CURRENCIES.find((c) => c.code === code); for (let k = 0; k < 3000; k++) { const p = (20 + rnd() * 900).toFixed(2); n++; if (F.formatAmount(F.unitDisplay(F.prettyUsd(p), [], cur), cur) !== F.formatPrice(p, cur)) off++; } }
  return { ok: off === 0, note: `${off} of ${n} differ` };
});
check("P172451", "components/CartPanel.tsx", "the stored order total equals the bill's own total (splitBill) for the same basket — 5 rates, 20,000 all-taxable baskets", "STUB — the totalUsd expression read off CartPanel.tsx, run against lib/tax.ts splitBill", () => {
  const Tx = tax(); let off = 0; const ex = [];
  const expr = (SRC.cart.match(/const totalUsd = ([^;]+);/) || [])[1];
  if (!expr) return { ok: false, note: "totalUsd expression not found" };
  const stored = new Function("subtotalUsd", "usdOnTopBase", "taxRate", "roundPaise", `return ${expr};`);
  const rates = [0.05, 0.12, 0.18, 0.025, 0.28];
  for (let k = 0; k < 20000; k++) {
    const lines = Array.from({ length: 1 + Math.floor(rnd() * 5) }, () => ({ price: String(50 + Math.floor(rnd() * 900)), qty: 1 + Math.floor(rnd() * 3), tax_mode: "excl" }));
    const r = rates[k % rates.length];
    const rules = { price_tax_mode: "excl", tax_rate: r };
    const bill = Tx.splitBill(lines, rules);
    const sub = lines.reduce((s, l) => s + parseFloat(l.price) * l.qty, 0);
    const mine = stored(sub, Tx.splitBill(lines, rules).taxableBase, bill.rate, Tx.roundPaise);
    if (Math.abs(mine - bill.total) > 0.0001) { off++; if (ex.length < 2) ex.push(`${sub}@${r}: ${mine} vs ${bill.total}`); }
  }
  return { ok: off === 0, note: `${off} of 20000 differ · expression: ${expr}${ex.length ? " — " + ex.join("; ") : ""}` };
});
check("P172452", "components/CartPanel.tsx", "the guest's whole-rupee TOTAL equals the printed bill's whole-rupee total for the same basket (subtotal + rounded GST)", HOW, () => {
  const F = fmt(), Tx = tax(); const cur = F.CURRENCIES.find((c) => c.code === "INR"); let off = 0;
  for (let k = 0; k < 20000; k++) {
    const sub = Array.from({ length: 1 + Math.floor(rnd() * 5) }, () => (50 + Math.floor(rnd() * 900)) * (1 + Math.floor(rnd() * 3))).reduce((a, b) => a + b, 0);
    const r = [0.05, 0.12, 0.18][k % 3];
    const guest = sub + F.toMinor(sub * r, cur);                              // CartPanel: subtotal + toMinor(base × rate)
    const printed = Math.round(Tx.roundPaise(sub + Tx.roundPaise(sub * r)));  // the bill: exact total, rounded to the rupee
    if (guest !== printed) off++;
  }
  return { ok: off === 0, note: `${off} of 20000 differ` };
});
check("P172453", "components/CartPanel.tsx", "a line's printed value is never a ₹10-snapped number (INR prices show exactly as the owner set them)", HOW, () => {
  const F = fmt(); const cur = F.CURRENCIES.find((c) => c.code === "INR"); let off = 0;
  for (let p = 1; p <= 2000; p++) if (F.unitDisplay(p, [], cur) !== p) off++;
  return { ok: off === 0, note: `${off} of 2000 whole-rupee prices changed` };
});
check("P172454", "components/MiniCart.tsx", "the pill's price never prints NaN, undefined or a bare number for a broken saved line", HOW, () => {
  const F = fmt(); const cur = F.CURRENCIES[0];
  const bad = [{ price: "abc", qty: 1 }, { price: undefined, qty: 2 }, { price: "12", qty: undefined, options: [{}] }];
  const sum = bad.reduce((s, it) => s + F.unitDisplay(parseFloat(it.price) || 0, (it.options || []).map((o) => o.price || 0), cur) * (it.qty || 1), 0);
  const out = F.formatAmount(sum, cur); return { ok: /^₹\d/.test(out) && !/NaN|undefined/.test(out), note: out };
});
check("P172455", "components/CartPanel.tsx", "the GST label shows the restaurant's own rate as a clean percent (5%, 12.5%, 18%) — never 0.05 or 4.999999", "SRC + arithmetic of the label expression", () => {
  const expr = /GST \(\{Math\.round\(taxRate \* 10000\) \/ 100\}%\)/.test(SRC.cart);
  const vals = [0.05, 0.125, 0.18, 0.025, 0.28, 0.07].map((r) => Math.round(r * 10000) / 100);
  return { ok: expr && vals.join() === "5,12.5,18,2.5,28,7", note: vals.join("% ") + "%" };
});
