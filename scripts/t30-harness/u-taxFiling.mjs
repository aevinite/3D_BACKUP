// lib/taxFiling.ts — every function and branch.
import { suite } from "./lib.mjs";
const t = suite("lib/taxFiling.ts", 168081, 60);
const F = await import("@/lib/taxFiling.ts");
t("splitTax([]) → []", F.splitTax([], 10).length === 0);
t("splitTax: one line takes everything", F.splitTax([5], 12.34)[0] === 12.34);
t("splitTax: 2.5/2.5 on ₹58.75 → 29.38 + 29.37 (the last line absorbs the paisa)", JSON.stringify(F.splitTax([2.5, 2.5], 58.75)) === "[29.38,29.37]");
t("splitTax: rates that sum to 0 split as if they summed to 1, still exact", (() => { const p = F.splitTax([0, 0], 10); return Math.round((p[0] + p[1]) * 100) === 1000; })());
t("splitTax: a non-numeric rate counts 0", (() => { const p = F.splitTax(["x", 5], 10); return p[0] === 0 && p[1] === 10; })());
t("splitTax: a non-numeric target counts 0", F.splitTax([2.5, 2.5], "x").every((v) => v === 0));
t("splitTax: a negative target splits exactly", (() => { const p = F.splitTax([2.5, 2.5], -10.01); return Math.round((p[0] + p[1]) * 100) === -1001; })());
t("splitTax: three lines 9/9/0 on ₹100 → 50 + 50 + 0", JSON.stringify(F.splitTax([9, 9, 0], 100)) === "[50,50,0]");
t("allocateWhole([]) → []", F.allocateWhole(10, []).length === 0);
t("allocateWhole: all-zero weights put the whole total on row 1", JSON.stringify(F.allocateWhole(7, [0, 0, 0])) === "[7,0,0]");
t("allocateWhole: negative / junk weights count as zero", JSON.stringify(F.allocateWhole(10, [-1, "x", 1])) === "[0,0,10]");
t("allocateWhole: 10 over [1,1,1] → 4,3,3 (largest remainder, earlier row wins a tie)", JSON.stringify(F.allocateWhole(10, [1, 1, 1])) === "[4,3,3]");
t("allocateWhole: a non-integer total is rounded first", F.allocateWhole(9.6, [1]).join() === "10");
t("allocateWhole: a non-numeric total counts 0", F.allocateWhole("x", [1, 1]).every((v) => v === 0));
t("allocateWhole: a negative total spreads to integers that still sum exactly", (() => { const a = F.allocateWhole(-7, [1, 1, 1]); return a.every(Number.isInteger) && a.reduce((x, y) => x + y, 0) === -7; })());
t("allocateWhole: exact weights produce exact shares (no leftover handed out)", JSON.stringify(F.allocateWhole(6, [1, 2, 3])) === "[1,2,3]");
t("taxableValue: no rate → net sales", F.taxableValue({ tax: 5, subtotal: 100, discount: 10 }, null) === 90 && F.taxableValue({ tax: 5, subtotal: 100, discount: 10 }, 0) === 90);
t("taxableValue: tax ÷ rate when that is below net", F.taxableValue({ tax: 4, subtotal: 100, discount: 0 }, 5) === 80);
t("taxableValue: capped at net when tax ÷ rate is above it", F.taxableValue({ tax: 6, subtotal: 100, discount: 0 }, 5) === 100);
t("taxableValue: junk fields count 0", F.taxableValue({ tax: "x", subtotal: "y", discount: null }, 5) === 0);
t("netSalesOf: subtotal − discount, to the paisa; junk counts 0", F.netSalesOf({ subtotal: 10.005, discount: 0 }) === 10.01 && F.netSalesOf({ subtotal: "x", discount: "y" }) === 0);
t("exemptTolerance: ₹100 floor, ½ rupee a bill above 200 bills, junk → ₹100", F.exemptTolerance(0) === 100 && F.exemptTolerance(201) === 100.5 && F.exemptTolerance("x") === 100);
t("exemptIsMaterial: no rate → false", F.exemptIsMaterial({ tax: 0, subtotal: 9999, discount: 0, paidOrders: 1 }, null) === false);
t("exemptIsMaterial: residue under the tolerance → false", F.exemptIsMaterial({ tax: 49, subtotal: 1050, discount: 0, paidOrders: 1 }, 5) === false);
t("exemptIsMaterial: residue over the tolerance → true", F.exemptIsMaterial({ tax: 40, subtotal: 1000, discount: 0, paidOrders: 1 }, 5) === true);
t("exemptIsMaterial: a negative residue (tax above net × rate) is never 'exempt'", F.exemptIsMaterial({ tax: 99, subtotal: 1000, discount: 0, paidOrders: 1 }, 5) === false);
t("taxableFor: material → tax ÷ rate; not material → net sales", F.taxableFor({ tax: 4, subtotal: 100, discount: 0 }, 5, true) === 80 && F.taxableFor({ tax: 4, subtotal: 100, discount: 0 }, 5, false) === 100);
{ const f = F.buildFiling([{ t: 10.4 }, { t: 10.4 }, { t: 10.4 }], [{ label: "CGST", rate: 2.5 }, { label: "SGST", rate: 2.5 }], (r) => r.t);
  t("buildFiling: three days of ₹10.40 → total ₹31 (round of the SUM), rows 11/10/10", f.total === 31 && JSON.stringify(f.rows.map((r) => r.tax)) === "[11,10,10]");
  t("buildFiling: each row's lines add to that row", f.rows.every((r) => Math.round((r.parts[0] + r.parts[1]) * 100) === r.tax * 100));
  t("buildFiling: the columns add to the total", Math.round((f.columnTotals[0] + f.columnTotals[1]) * 100) === 3100);
  t("buildFiling: rows keep their original objects", f.rows[0].row.t === 10.4); }
t("buildFiling with no tax lines → rows carry empty parts and no column totals", (() => { const f = F.buildFiling([{ t: 5 }], [], (r) => r.t); return f.rows[0].parts.length === 0 && f.columnTotals.length === 0 && f.total === 5; })());
t("buildFiling: a junk tax reads as 0", F.buildFiling([{ t: "x" }], [{ label: "GST", rate: 5 }], (r) => r.t).total === 0);
{ let ok = true, seed = 11; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let i = 0; i < 3000 && ok; i++) { const rows = Array.from({ length: 1 + Math.floor(rnd() * 31) }, () => ({ t: Math.round(rnd() * 200000) / 100 }));
    const f = F.buildFiling(rows, [{ label: "CGST", rate: 2.5 }, { label: "SGST", rate: 2.5 }], (r) => r.t);
    if (f.total !== Math.round(rows.reduce((a, r) => a + r.t, 0)) || f.rows.reduce((a, r) => a + r.tax, 0) !== f.total || Math.round(f.columnTotals.reduce((a, x) => a + x, 0) * 100) !== f.total * 100) ok = false; }
  t("buildFiling on 3,000 random months reconciles every way (rows, columns, headline)", ok); }
// round-2 mutation survivors, closed
t("allocateWhole: the leftover rupee goes to the BIGGEST fractional share, not the earliest row (₹1 over [1,2] → 0,1)", JSON.stringify(F.allocateWhole(1, [1, 2])) === "[0,1]");
t("netSalesOf: ₹100 with ₹10 off is ₹90 (both sides read)", F.netSalesOf({ subtotal: 100, discount: 10 }) === 90);
t("exemptIsMaterial: a residue EXACTLY at the tolerance (₹100 on one bill) is still dust, not exempt supply", F.exemptIsMaterial({ tax: 45, subtotal: 1000, discount: 0, paidOrders: 1 }, 5) === false);
