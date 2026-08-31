"use client";
// Phase-3 (owner round-6): a professional, section-scoped Print / CSV / Excel for
// EVERY sub-report — not a screenshot of the panel. Given the current report's shape
// it builds a clean standalone A4 document (masthead + the section's table) and the
// matching CSV/Excel tables. Reuses the ExportTable shape + the .xls trick from the
// full-statement builder, so exports look like one family across the whole panel.
import { useEffect, useState } from "react";
import { useBackClose } from "@/lib/backStack";
import { canonPayMethod } from "@/components/owner/Charts";
import { buildFiling, splitTax, taxableFor, exemptIsMaterial } from "@/lib/taxFiling";
import { DAYPARTS, WEEKDAY_SHORT, WEEKDAY_FULL, istWeekday } from "@/components/owner/reports/kit";
import { classifyMenu, type MI } from "@/components/owner/reports/DishReports";
import type { ExportTable, ExportCol } from "@/components/owner/ownerReportDoc";

// Paise only when the amount actually has them (the CGST/SGST halves of an odd tax total),
// so equal rates print as equal halves; whole-rupee amounts stay clean.
// The sign goes in FRONT of the whole amount ("−₹2,350"), matching components/admin/shared →
// inr and lib/money → compactINR. The printed day sheet's "Discounts given" row was the one
// place still writing "₹-2,350" (T5 re-run, 2026-08-11).
const inr = (n: number) => {
  const v = Number(n) || 0;
  const a = Math.abs(v);
  const hasPaise = Math.abs(Math.round(a) - a) > 0.005;
  return (v < 0 ? "−₹" : "₹") + a.toLocaleString("en-IN", { minimumFractionDigits: hasPaise ? 2 : 0, maximumFractionDigits: 2 });
};
const nfmt = (n: number) => Math.round(Number(n) || 0).toLocaleString("en-IN");
/** "8 PM" — the one clock this console writes (mirrors hour12 on the dashboard). */
const hour12 = (h: number) => `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? "AM" : "PM"}`;
// ── MERGE BY CANONICAL METHOD, DON'T JUST RELABEL (T11 sweep #7, 2026-08-27) ─────────────────
// The database groups the settlement by the RAW `payment_method` string, so one method stored
// with two casings arrives as two rows — French House really holds both "Cash" and "cash". The
// day sheet (2026-08-17) and the Payments table and the donut all merge them; the EXPORT ran the
// raw rows through canonPayMethod for the LABEL and stopped, which is the exact bug that was
// fixed on screen. So the downloaded file listed
//     Cash,274,316864
//     Cash,2,525
// two lines apart (they sort by amount), where the screen shows one row of ₹3,17,389 — and anyone
// pivoting the CSV by method in a spreadsheet got two "Cash" groups. The totals always
// reconciled, which is why nobody noticed. Merge FIRST, then filter and sort, so a method split
// across two casings can never be dropped in halves.
const mergePays = <T extends { method: unknown; revenue: number; orders: number }>(rows: T[]) => {
  const by = new Map<string, { method: string; revenue: number; orders: number }>();
  for (const p of rows) {
    const method = canonPayMethod(String(p.method ?? ""));
    const row = by.get(method) || { method, revenue: 0, orders: 0 };
    row.revenue += Number(p.revenue) || 0;
    row.orders += Number(p.orders) || 0;
    by.set(method, row);
  }
  return [...by.values()].sort((a, b) => b.revenue - a.revenue);
};
const esc = (s: string) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

type MoneyRow = { bucket: string; orders: number; paidOrders: number; subtotal: number; tax: number; discount: number; revenue: number; cancelledOrders: number; cancelledValue: number };
type Totals = Omit<MoneyRow, "bucket">;
type TaxInfo = { effectivePct: number; components: { label: string; rate: number; amount: number }[]; configured: boolean; composition?: boolean } | null;
type Payload = { rows?: unknown[]; totals?: Totals; tax?: TaxInfo; bucket?: string;
  // The DAY SHEET's own blocks. The export used to read none of them, so Print/CSV/Excel of a
  // Day summary carried the hourly money table and nothing else — no settlement split, no
  // CGST/SGST lines, no money-out — while the screen showed all of it (T5 sweep, 2026-08-11).
  payments?: { method: unknown; revenue: number; orders: number }[];
  staffPay?: { paidOut: number; people: number; entries: number } | null;
  tips?: { collected: number; orders: number } | null;
  inventory?: { bought: number; usedActual: number; usedTheoretical: number; wasted: number;
    expenses: number; stockValue: number; lowCount: number; negativeCount: number;
    foodCostPct: number | null; coveragePct: number; hasRecipes?: boolean } | null;
  // Team & pay carries its own shapes (mig 220/221) alongside the shared `rows`.
  people?: unknown[]; monthRows?: unknown[]; cashRows?: unknown[];
  // Inventory & stock (mig 227) — the five sub-tabs share one payload shape.
  summary?: InvSummary; coverage?: InvCoverage; costDataFrom?: string | null;
  merged?: boolean; perRestaurant?: InvPerRest[];
  dishes?: InvDish[]; items?: InvItem[]; vendors?: InvVendor[];
  series?: InvSeries[]; expenses?: InvExpense[]; waste?: InvWaste[] };

// The inventory shapes, mirrored from components/owner/reports/InventoryReports.tsx so the
// export can't drift from what the screen renders.
type InvSummary = {
  stockValue: number; stockItems: number; lowCount: number; negativeCount: number;
  purchases: number; purchaseCount: number; actualUsed: number; wasted: number; wasteCount: number;
  expenses: number; corrections: number; theoreticalCost: number; foodCostPct: number | null;
};
type InvCoverage = { totalRevenue: number; coveredRevenue: number; totalDishes: number; coveredDishes: number; mappedRecipes: number; menuDishes: number; pct: number };
type InvItem = {
  id: string; name: string; category: string; baseUom: string; buyUom: string; factor: number;
  onHandBase: number; onHandVal: number; parQty: number | null;
  boughtBase: number; boughtVal: number; usedBase: number; usedVal: number;
  wastedBase: number; wastedVal: number; adjustBase: number; adjustVal: number;
};
type InvDish = { slug: string; title: string; price: number; qtySold: number; revenue: number; plateCost: number; costTotal: number; ingredients: number; marginPct: number | null };
type InvPerRest = { name: string; stockValue: number; purchases: number; expenses: number; wasted: number; theoreticalCost: number };
type InvVendor = { vendor: string; bills: number; amount: number; isCash: boolean };
type InvSeries = { bucket: string; purchased: number; used: number; wasted: number };
type InvExpense = { category: string; title: string; amount: number; expense_date: string; note: string | null; created_by: string | null; voided_at: string | null; void_reason: string | null };
type InvWaste = { item_id: string; qty_base: number; reason: string; note: string | null; unit_cost_snap: number; waste_date: string; created_by: string | null; voided_at: string | null };

// Same wording the Inventory report shows on screen, so a printed sheet reads identically.
const EXP_LABELS: Record<string, string> = { breakage: "Breakage", repair: "Repair", utilities: "Utilities", cleaning: "Cleaning", supplies: "Supplies", rent: "Rent", transport: "Transport", misc: "Other" };
const WASTE_LABELS: Record<string, string> = { spoiled: "Spoiled", burnt: "Burnt", spilled: "Spilled", expired: "Expired", staff_meal: "Staff meal", complimentary: "On the house", other: "Other" };
const INV_KINDS = new Set(["invstock", "invpurchases", "invusage", "invwaste", "invexpenses"]);
// Round to 2dp for quantities (they are fractional) — amounts stay whole rupees like
// everywhere else in these exports.
const q2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

export type SectionMeta = {
  label: string;
  /** the payload SHAPE (money / hourly / dishes …) */
  kind: string;
  /** WHICH BODY is on screen. Several bodies share one shape — by-hour and times-of-day are both
   *  "hourly", day-of-week and average-bill are both "money" — and branching on the shape alone
   *  wrote the wrong report under the right heading (T11 round 2, 2026-09-01). */
  body?: string;
};
export type SectionCtx = {
  meta: SectionMeta; data: Payload; restName: string; periodLabel: string;
  isTax?: boolean;   // the Tax/GST report → append the CGST/SGST split table
  bucketLabel: (iso: string, bucket: string) => string;
  extra?: ExportTable[];   // extra tables appended to print/CSV (Day summary: dishes + hours)
  // When the SERVER computed these figures (the snapshot cache's `cachedAt`). "Generated
  // <now>" alone put a current timestamp over numbers that could be hours old, on a sheet
  // somebody files (owner-panel sweep 2026-08-04), so the masthead states both.
  asOf?: string;
};

// ── build the flat tables (CSV / Excel) for the current section ──────────────
export function sectionTables(c: SectionCtx): ExportTable[] {
  const { meta, data } = c;
  const grain = data.bucket || "day";
  const title = `${meta.label} — ${c.restName} — ${c.periodLabel}`;
  // ── THE FOUR THAT SHARE A SHAPE WITH ANOTHER REPORT ────────────────────────────────────────
  // Measured on 2026-09-01, 30 days, French House. Each file was headed with the right report and
  // filled with a different one:
  //   Times of day    → 24 hourly rows instead of Morning / Afternoon / Evening / Late night
  //   Day of week     → dated by-period rows instead of Monday…Sunday
  //   Which dishes earn → the plain dish list, with the Star/Workhorse/Puzzle/Dog grouping — the
  //                       entire point of that report — dropped
  //   Average bill    → the by-period table WITHOUT the Avg bill column it is named after
  // Each one below rebuilds exactly what the screen shows, from the same shared groupings.
  if (meta.body === "daypart") {
    const hrs = (data.rows ?? []) as { hour: number; orders: number; revenue: number }[];
    const byHour = new Map(hrs.map((h) => [h.hour, h]));
    const parts = DAYPARTS.map((p2) => {
      let rev = 0, orders = 0;
      for (const h of p2.hours) { const r = byHour.get(h); if (r) { rev += r.revenue; orders += r.orders; } }
      return { label: p2.label, rev, orders };
    });
    const totalRev = parts.reduce((a2, p2) => a2 + p2.rev, 0);
    const totalOrd = parts.reduce((a2, p2) => a2 + p2.orders, 0);
    return [{
      title, head: ["Day part", "Orders", "Revenue", "% share", "Per order"], cols: ["text", "num", "money", "pct", "money"],
      rows: [
        ...parts.map((p2) => [p2.label, p2.orders, Math.round(p2.rev),
          totalRev ? Math.round((p2.rev / totalRev) * 1000) / 10 : 0, p2.orders ? Math.round(p2.rev / p2.orders) : 0] as (string | number)[]),
        ["Total", totalOrd, Math.round(totalRev), 100, totalOrd ? Math.round(totalRev / totalOrd) : 0],
      ],
    }];
  }
  if (meta.body === "weekday") {
    const m = (data.rows ?? []) as MoneyRow[];
    const by = new Map<string, { rev: number; orders: number; days: number }>();
    for (const r of m) {
      const wd = istWeekday(r.bucket);
      const cur = by.get(wd) || { rev: 0, orders: 0, days: 0 };
      cur.rev += r.revenue; cur.orders += r.paidOrders; cur.days += (r.revenue > 0 || r.paidOrders > 0) ? 1 : 0;
      by.set(wd, cur);
    }
    const rows = WEEKDAY_SHORT.map((nm) => ({ nm, ...(by.get(nm) || { rev: 0, orders: 0, days: 0 }) }));
    const allRev = rows.reduce((a2, r) => a2 + r.rev, 0);
    const allDays = rows.reduce((a2, r) => a2 + r.days, 0);
    return [{
      title, head: ["Day", "Days counted", "Paid bills", "Revenue", "% of week", "Avg / day"],
      cols: ["text", "num", "num", "money", "pct", "money"],
      rows: [
        ...rows.map((r) => [WEEKDAY_FULL[r.nm], r.days, r.orders, Math.round(r.rev),
          allRev ? Math.round((r.rev / allRev) * 1000) / 10 : 0, r.days ? Math.round(r.rev / r.days) : 0] as (string | number)[]),
        ["Total", allDays, rows.reduce((a2, r) => a2 + r.orders, 0), Math.round(allRev), 100,
          allDays ? Math.round(allRev / allDays) : 0],
      ],
    }];
  }
  if (meta.body === "menu") {
    const { dishes, totalQty, totalRev } = classifyMenu((data.rows ?? []) as MI[]);
    const LABEL: Record<string, string> = { star: "Star", workhorse: "Workhorse", puzzle: "Puzzle", dog: "Dog" };
    return [{
      title, head: ["Dish", "Group", "Sold", "% units", "Sales", "% sales"],
      cols: ["text", "text", "num", "pct", "money", "pct"],
      rows: [
        ...[...dishes].sort((a2, b2) => b2.revenue - a2.revenue).map((d) => [
          d.title, LABEL[d.klass] || d.klass, d.qty, Math.round(d.qtyShare * 1000) / 10,
          Math.round(d.revenue), Math.round(d.revShare * 1000) / 10] as (string | number)[]),
        ["Total", "", totalQty, 100, Math.round(totalRev), 100],
      ],
    }];
  }
  if (meta.kind === "money" || meta.kind === "daysummary") {
    const m = (data.rows ?? []) as MoneyRow[]; const t = data.totals;
    // The Average-bill report shows an extra "Avg bill" column on screen — the one figure the
    // report is named after — and the file was leaving it out.
    const avg = meta.body === "avgbill";
    const head = ["Period", "Orders", "Paid", "Item sales", "GST", "Discount", "Total collected",
      ...(avg ? ["Avg bill"] : []), "Cancelled", "Lost value"];
    const rows: (string | number)[][] = m.map((r) => [c.bucketLabel(r.bucket, grain), r.orders, r.paidOrders, Math.round(r.subtotal), Math.round(r.tax), Math.round(r.discount), Math.round(r.revenue),
      ...(avg ? [r.paidOrders ? Math.round(r.revenue / r.paidOrders) : 0] : []), r.cancelledOrders, Math.round(r.cancelledValue)]);
    if (t) rows.push(["Total", t.orders, t.paidOrders, Math.round(t.subtotal), Math.round(t.tax), Math.round(t.discount), Math.round(t.revenue),
      ...(avg ? [t.paidOrders ? Math.round(t.revenue / t.paidOrders) : 0] : []), t.cancelledOrders, Math.round(t.cancelledValue)]);
    const out: ExportTable[] = [{ title, head, rows }];

    // ── THE DAY SHEET PRINTS WHAT THE DAY SHEET SHOWS (T5 sweep, 2026-08-11) ──────────────
    // Same order as the screen: where the money came from (with the tax lines), how it
    // arrived, then what went out. Every block is omitted when its payload is absent, so a
    // restaurant without payroll/inventory gets exactly the sheet it had before.
    if (meta.kind === "daysummary" && t) {
      const net = t.subtotal - t.discount;
      const flow: (string | number)[][] = [
        ["Item sales (menu prices)", Math.round(t.subtotal)],
        ["Discounts given", -Math.round(t.discount)],
        ["Net sales (your earnings, GST is charged on this)", Math.round(net)],
        ["GST collected (held for the government)", Math.round(t.tax)],
      ];
      // The SAME whole-rupee split the screen prints, so the sheet and the screen agree.
      if (data.tax?.components.length) {
        const parts = splitTax(data.tax.components.map((x) => x.rate), Math.round(t.tax));
        data.tax.components.forEach((cmp, i) => flow.push([`  ${cmp.label} (${cmp.rate}%)`, parts[i]]));
      }
      flow.push(["Total collected", Math.round(t.revenue)]);
      out.push({ title: `${meta.label} — where the money came from`, head: ["Line", "Amount"], cols: ["text", "money"], rows: flow });

      if (data.payments?.length) {
        const pays = mergePays(data.payments).filter((x) => x.orders > 0);
        const paid = pays.reduce((a, x) => a + x.revenue, 0);
        if (pays.length) out.push({
          title: `${meta.label} — settlement (how the money arrived)`,
          head: ["Method", "Bills", "Amount", "Share"], cols: ["text", "num", "money", "pct"],
          rows: [...pays.map((x) => [x.method, x.orders, Math.round(x.revenue), paid > 0 ? Math.round((x.revenue / paid) * 100) : 0] as (string | number)[]),
            ["Total settled", pays.reduce((a, x) => a + x.orders, 0), Math.round(paid), 100]],
        });
      }

      const outRows: (string | number)[][] = [];
      if (data.staffPay) outRows.push(["Staff paid out", Math.round(data.staffPay.paidOut)],
        ["Payments made", data.staffPay.entries], ["People paid", data.staffPay.people]);
      if (data.tips) outRows.push(["Tips collected (for the team, not revenue)", Math.round(data.tips.collected)],
        ["Bills with a tip", data.tips.orders]);
      if (data.inventory) outRows.push(["Stock bought (cash out to suppliers)", Math.round(data.inventory.bought)],
        ["Ingredients used (recipe cost)", Math.round(data.inventory.usedTheoretical)],
        ["Wasted", Math.round(data.inventory.wasted)], ["Other expenses", Math.round(data.inventory.expenses)],
        ["On the shelf at the end", Math.round(data.inventory.stockValue)]);
      if (outRows.length) out.push({ title: `${meta.label} — money out and money held`, head: ["Line", "Amount"], cols: ["text", "money"], rows: outRows });
    }

    if (c.isTax && data.tax && data.tax.components.length) {
      // ONE filing computation, shared with the screen (lib/taxFiling.ts) — so the exported
      // split, the exported per-period table and what the owner just looked at are the SAME
      // numbers. They used to be three separate roundings: the export split the period total
      // once, the screen's filing table rounded every day and summed them, and the two came
      // out ₹2 apart on a document captioned "ready to copy into a return"
      // (owner-panel sweep 2026-08-04).
      const lines = data.tax.components.map((x) => ({ label: x.label, rate: x.rate }));
      const filing = buildFiling(m.filter((r) => r.tax > 0), lines, (r) => r.tax);
      // The SAME exempt-vs-rounding decision the screen makes (lib/taxFiling → exemptIsMaterial),
      // so an exported "Taxable value" column can never differ from the tile the owner just read.
      const exemptMaterial = !!t && exemptIsMaterial(t, data.tax.effectivePct);
      out.push({ title: `${meta.label} — tax split`, head: ["Component", "Rate %", "Collected"],
        cols: ["text", "pct", "money"],
        rows: [["Total tax", data.tax.effectivePct, filing.total],
          ...lines.map((l, i) => [l.label, l.rate, filing.columnTotals[i]] as (string | number)[])] });
      if (filing.rows.length) out.push({
        title: `${meta.label} — tax by period (filing view)`,
        head: ["Period", "Taxable value", ...lines.map((l) => `${l.label} (${l.rate}%)`), "Total tax"],
        cols: ["text", "money", ...lines.map(() => "money" as ExportCol), "money"],
        rows: [
          ...filing.rows.map((fr) => [c.bucketLabel(fr.row.bucket, grain),
            Math.round(taxableFor(fr.row, data.tax!.effectivePct, exemptMaterial)), ...fr.parts, fr.tax] as (string | number)[]),
          ["Total", Math.round(filing.rows.reduce((a, fr) => a + taxableFor(fr.row, data.tax!.effectivePct, exemptMaterial), 0)),
            ...filing.columnTotals, filing.total] as (string | number)[],
        ],
      });
    }
    if (c.extra?.length) out.push(...c.extra);   // Day summary: the day's dishes + busy hours
    return out;
  }
  if (meta.kind === "dishes") return [{ title, head: ["Dish", "Qty sold", "Dish sales (GST included)"], rows: ((data.rows ?? []) as { title: string; qty: number; revenue: number }[]).map((r) => [r.title, r.qty, Math.round(r.revenue)]) }];
  if (meta.kind === "categories") return [{ title, head: ["Category", "Qty sold", "Category sales (GST included)"], rows: ((data.rows ?? []) as { category: string; qty: number; revenue: number }[]).map((r) => [r.category, r.qty, Math.round(r.revenue)]) }];
  if (meta.kind === "payments") {
    // The same merged, biggest-first list the on-screen table and the donut show — plus the
    // Total row and the % share the screen carries, so the file and the screen are one report.
    const pays = mergePays((data.rows ?? []) as { method: string; revenue: number; orders: number }[]);
    const paid = pays.reduce((a, x) => a + x.revenue, 0);
    const bills = pays.reduce((a, x) => a + x.orders, 0);
    return [{
      title, head: ["Method", "Bills", "Revenue", "Share", "Avg bill"], cols: ["text", "num", "money", "pct", "money"],
      rows: [
        ...pays.map((r) => [r.method, r.orders, Math.round(r.revenue),
          paid > 0 ? Math.round((r.revenue / paid) * 100) : 0,
          r.orders ? Math.round(r.revenue / r.orders) : 0] as (string | number)[]),
        ["Total", bills, Math.round(paid), 100, bills ? Math.round(paid / bills) : 0],
      ],
    }];
  }
  // "8 PM", not "20:00" — the whole console (hour12(), the Studio's hourLabel, the Busy-times
  // tiles) speaks the 12-hour clock, and only the EXPORT of it spoke 24-hour (T5 sweep, 2026-08-11).
  if (meta.kind === "hourly") return [{ title, head: ["Hour", "Orders", "Revenue"], rows: ((data.rows ?? []) as { hour: number; orders: number; revenue: number }[]).map((r) => [hour12(r.hour), r.orders, Math.round(r.revenue)]) }];
  // Team & pay (mig 220/221). Without these two branches the export fell through to the
  // empty "—" table below, so Export and Print produced a blank document (2026-07-31 sweep).
  if (meta.kind === "staffpay") {
    const people = (data.people ?? []) as { name: string; designation: string | null; role: string; pay_type: string | null; pay_amount: number; salary: number; advance: number; bonus: number; overtime: number; other: number; paid: number; advanceOutstanding: number; lastPaidOn: string | null }[];
    const months = (data.monthRows ?? []) as { bucket: string; people: number; expected: number; paid: number; owed: number }[];
    const cash = (data.cashRows ?? []) as { bucket: string; paid_out: number; people: number; entries: number }[];
    const out: ExportTable[] = [{
      title: `${title} — who you paid`,
      // Every amount here is RUPEES, including "Rate" (a monthly salary) — which the old
      // header guess read as a percentage and printed as "42000%".
      head: ["Person", "Role", "Rate", "Salary", "Advance", "Bonus / OT / other", "Total paid", "Advance left", "Last paid"],
      cols: ["text", "text", "money", "money", "money", "money", "money", "money", "text"],
      rows: people.map((r) => [r.name, r.designation || (r.role === "tablet" ? "waiter" : r.role),
        r.pay_amount ? Math.round(r.pay_amount) : "", Math.round(r.salary), Math.round(r.advance),
        Math.round(r.bonus + r.overtime + r.other), Math.round(r.paid), Math.round(r.advanceOutstanding),
        r.lastPaidOn || ""]),
    }];
    if (months.length) out.push({
      title: `${title} — what each month was worth`,
      head: ["Month", "On pay list", "Team cost", "Paid for it", "Still owed"],
      cols: ["text", "num", "money", "money", "money"],
      rows: months.map((m) => [new Date(m.bucket).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "Asia/Kolkata" }),
        m.people, Math.round(m.expected), Math.round(m.paid), Math.round(m.owed)]),
    });
    if (cash.length) out.push({
      title: `${title} — money out, by day`,
      head: ["Day", "Paid out", "People", "Entries"],
      cols: ["text", "money", "num", "num"],
      rows: cash.map((r) => [c.bucketLabel(r.bucket, grain), Math.round(r.paid_out), r.people, r.entries]),
    });
    return out;
  }
  if (meta.kind === "staffperf") {
    const rows = (data.rows ?? []) as { name: string; role: string; designation: string | null; active: boolean; daysActive: number; hours: number; orders: number; value: number; tables: number; sittings: number; discount: number; ratings: number; avgRating: number | null; paid: number }[];
    return [{
      title, head: ["Person", "Role", "Days worked", "Hours on shift", "Orders punched", "Value punched", "Tables", "Sittings", "Discount given", "Ratings", "Avg rating", "Paid"],
      cols: ["text", "text", "num", "num", "num", "money", "num", "num", "money", "num", "text", "money"],
      rows: rows.map((r) => [r.name + (r.active ? "" : " (disabled)"), r.designation || (r.role === "tablet" ? "waiter" : r.role),
        r.daysActive, r.hours, r.orders, Math.round(r.value), r.tables, r.sittings, Math.round(r.discount),
        r.ratings, r.avgRating ?? "", Math.round(r.paid)]),
    }];
  }
  // ── INVENTORY & STOCK (mig 227) ────────────────────────────────────────────────────
  // These five kinds had NO branch, so every one of them fell through to the empty "—"
  // table below: Export → CSV/Excel and Print each produced a document with a title and
  // nothing in it. That is the identical defect found and fixed for Team & pay on
  // 2026-07-31 (see the note above) — inventory landed after that fix and was missed.
  // Found by the 2026-08-04 owner-panel sweep.
  //
  // Every view leads with the SAME summary band the screen shows, so a printed stock sheet
  // stands on its own, then adds that view's own detail table.
  if (INV_KINDS.has(meta.kind)) {
    const s = data.summary, cov = data.coverage;
    const out: ExportTable[] = [];
    if (s) {
      const band: (string | number)[][] = [
        ["Stock on the shelf", Math.round(s.stockValue)],
        ["Ingredients tracked", s.stockItems],
        ["Running low", s.lowCount],
        ["Below zero", s.negativeCount],
        ["Bought in this period", Math.round(s.purchases)],
        ["Purchase bills", s.purchaseCount],
        ["Ingredients used (recipe cost)", Math.round(s.theoreticalCost)],
        ["Ingredients used (stock ledger)", Math.round(s.actualUsed)],
        ["Wasted", Math.round(s.wasted)],
        ["Waste entries", s.wasteCount],
        ["Other expenses", Math.round(s.expenses)],
        ["Count corrections", Math.round(s.corrections)],
        ["Food cost %", s.foodCostPct == null ? "not enough recipes mapped" : `${s.foodCostPct.toFixed(1)}%`],
      ];
      if (cov) band.push(
        ["Sales covered by a recipe", Math.round(cov.coveredRevenue)],
        ["Sales in this period", Math.round(cov.totalRevenue)],
        ["Recipes mapped", `${cov.mappedRecipes} of ${cov.menuDishes} dishes`],
      );
      out.push({ title, head: ["Figure", "Value"], cols: ["text", "text"], rows: band });
    }
    if (data.merged && data.perRestaurant?.length) {
      out.push({
        title: `${title} — by restaurant`,
        head: ["Restaurant", "On the shelf", "Bought", "Expenses", "Wasted", "Recipe cost of sales"],
        cols: ["text", "money", "money", "money", "money", "money"],
        rows: data.perRestaurant.map((r) => [r.name, Math.round(r.stockValue), Math.round(r.purchases), Math.round(r.expenses), Math.round(r.wasted), Math.round(r.theoreticalCost)]),
      });
    }
    const items = data.items ?? [];
    if (meta.kind === "invstock" && items.length) {
      out.push({
        title: `${title} — every ingredient`,
        head: ["Ingredient", "Category", "On hand", "Unit", "Value on shelf", "Par level", "Bought", "Used", "Wasted", "Corrections"],
        cols: ["text", "text", "num", "text", "money", "num", "num", "num", "num", "money"],
        rows: items.map((i) => [i.name, i.category || "", q2(i.onHandBase / (i.factor || 1)), i.buyUom,
          Math.round(i.onHandVal), i.parQty == null ? "" : q2(i.parQty / (i.factor || 1)),
          q2(i.boughtBase / (i.factor || 1)), q2(i.usedBase / (i.factor || 1)),
          q2(i.wastedBase / (i.factor || 1)), Math.round(i.adjustVal)]),
      });
    }
    if (meta.kind === "invpurchases" && (data.vendors?.length || data.series?.length)) {
      if (data.vendors?.length) out.push({
        title: `${title} — by supplier`,
        head: ["Supplier", "Bills", "Amount", "Paid in cash"],
        cols: ["text", "num", "money", "text"],
        rows: data.vendors.map((v) => [v.vendor, v.bills, Math.round(v.amount), v.isCash ? "yes" : "no"]),
      });
      if (data.series?.length) out.push({
        title: `${title} — day by day`,
        head: ["Period", "Bought", "Used", "Wasted"],
        cols: ["text", "money", "money", "money"],
        rows: data.series.map((r) => [c.bucketLabel(r.bucket, grain), Math.round(r.purchased), Math.round(r.used), Math.round(r.wasted)]),
      });
    }
    if (meta.kind === "invusage") {
      if (data.dishes?.length) out.push({
        title: `${title} — cost per dish`,
        head: ["Dish", "Sold", "Sales", "Price each", "Ingredient cost each", "Ingredient cost total", "Margin %", "Ingredients"],
        cols: ["text", "num", "money", "money", "money", "money", "text", "num"],
        rows: data.dishes.map((d) => [d.title, d.qtySold, Math.round(d.revenue), Math.round(d.price),
          q2(d.plateCost), Math.round(d.costTotal), d.marginPct == null ? "" : `${d.marginPct.toFixed(1)}%`, d.ingredients]),
      });
      if (items.length) out.push({
        title: `${title} — what left the shelf`,
        head: ["Ingredient", "Used", "Unit", "Cost of what was used", "Corrections"],
        cols: ["text", "num", "text", "money", "money"],
        rows: items.map((i) => [i.name, q2(i.usedBase / (i.factor || 1)), i.buyUom, Math.round(i.usedVal), Math.round(i.adjustVal)]),
      });
    }
    if (meta.kind === "invwaste" && data.waste?.length) {
      const nameOf = new Map(items.map((i) => [i.id, i]));
      out.push({
        title: `${title} — every waste entry`,
        head: ["Date", "Ingredient", "Quantity", "Unit", "Reason", "Value", "Logged by", "Note", "Cancelled"],
        cols: ["text", "text", "num", "text", "text", "money", "text", "text", "text"],
        rows: data.waste.map((w) => {
          const it = nameOf.get(w.item_id);
          return [w.waste_date, it?.name || "—", q2(w.qty_base / (it?.factor || 1)), it?.buyUom || "",
            WASTE_LABELS[w.reason] || w.reason, Math.round(w.qty_base * w.unit_cost_snap),
            w.created_by || "", w.note || "", w.voided_at ? "yes" : ""];
        }),
      });
    }
    if (meta.kind === "invexpenses" && data.expenses?.length) {
      out.push({
        title: `${title} — the expense book`,
        head: ["Date", "Kind", "What it was", "Amount", "Written by", "Note", "Cancelled", "Why cancelled"],
        cols: ["text", "text", "text", "money", "text", "text", "text", "text"],
        rows: data.expenses.map((e) => [e.expense_date, EXP_LABELS[e.category] || e.category, e.title,
          Math.round(e.amount), e.created_by || "", e.note || "", e.voided_at ? "yes" : "", e.void_reason || ""]),
      });
    }
    // A restaurant that has the module on but has entered nothing yet gets the summary band
    // alone rather than a blank sheet — an honest "here is the period, it is all zero".
    return out.length ? out : [{ title, head: ["Figure", "Value"], rows: [["Nothing recorded in this period", 0]] }];
  }
  return [{ title, head: ["—"], rows: [] }];
}

// ── the print document (masthead + the section's table) ───────────────────────
export function sectionHtml(c: SectionCtx): string {
  const tables = sectionTables(c);
  const gen = new Date().toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });
  const isMoney = c.meta.kind === "money" || c.meta.kind === "daysummary";
  // A cell is formatted by what its column IS. `t.cols[i]` says so explicitly; only tables
  // that don't declare it fall back to the old header-wording guess (kept so the compiled
  // statement's tables, built elsewhere, render exactly as before).
  const fmtCell = (cell: string | number, head: string, col?: ExportCol): string => {
    if (typeof cell !== "number") return esc(String(cell));
    if (col) return col === "money" ? inr(cell) : col === "pct" ? `${cell}%` : col === "num" ? nfmt(cell) : esc(String(cell));
    const h = head.toLowerCase();
    if (/rate|%/.test(h)) return `${cell}%`;
    if (/gross|gst|tax|discount|net|revenue|collected|lost|sales|value/.test(h)) return inr(cell);
    return nfmt(cell);
  };
  const tableHtml = (t: ExportTable) => `
    <h3>${esc(t.title.split(" — ")[1] ? t.title.split(" — ").slice(1).join(" · ") : t.title)}</h3>
    <table><thead><tr>${t.head.map((h, i) => `<th${i > 0 ? ' class="r"' : ""}>${esc(h)}</th>`).join("")}</tr></thead>
    <tbody>${t.rows.map((r, ri) => `<tr${ri === t.rows.length - 1 && isMoney && String(r[0]).startsWith("Total") ? ' class="tot"' : ""}>${r.map((cell, i) => `<td${i > 0 ? ' class="r"' : ""}>${i === 0 ? esc(String(cell)) : fmtCell(cell, String(t.head[i] ?? ""), t.cols?.[i])}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  return `<!doctype html><html><head><meta charset="utf-8"/><title>${esc(c.meta.label)} · ${esc(c.restName)} · ${esc(c.periodLabel)}</title>
<style>
  *{box-sizing:border-box} body{font-family:-apple-system,"Segoe UI",Inter,Roboto,sans-serif;color:#10231c;margin:0;padding:34px 40px 50px;font-size:12.5px;line-height:1.5}
  .mast{display:flex;justify-content:space-between;align-items:baseline;border-bottom:3px solid #0f766e;padding-bottom:10px}
  .brand{font-weight:800;font-size:13px;letter-spacing:.06em;color:#0f766e;text-transform:uppercase}.gen{font-size:10.5px;color:#6b7f78}
  h1{font-size:22px;margin:14px 0 2px}.scope{color:#4b615a;font-size:13px;margin-bottom:6px}
  .asof{color:#6b7f78;font-size:10.5px;margin:-3px 0 6px;font-variant-numeric:tabular-nums}
  h3{font-size:12px;margin:20px 0 7px;text-transform:uppercase;letter-spacing:.05em;color:#4b615a}
  table{width:100%;border-collapse:collapse;margin-top:4px}
  th{text-align:left;font-size:9.5px;text-transform:uppercase;letter-spacing:.05em;color:#4b615a;border-bottom:1.5px solid #0f766e;padding:5px 8px}
  td{padding:5.5px 8px;border-bottom:1px solid #e5eeeb;font-variant-numeric:tabular-nums}
  tr:nth-child(even) td{background:#f6faf9}.r{text-align:right}
  tr.tot td{border-top:1.5px solid #0f766e;background:#eef7f4;font-weight:700}
  .note{margin-top:26px;font-size:10px;color:#6b7f78;border-top:1px solid #d9e5e1;padding-top:8px}
  @page{margin:16mm 12mm}
</style></head><body>
  <div class="mast"><span class="brand">Aevidine · Restaurant OS</span><span class="gen">Generated ${esc(gen)}</span></div>
  <h1>${esc(c.meta.label)}</h1><div class="scope">${esc(c.restName)} · ${esc(c.periodLabel)}</div>
  ${c.asOf ? `<div class="asof">Figures as of ${esc(new Date(c.asOf).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }))}</div>` : ""}
  ${tables.map(tableHtml).join("")}
  <div class="note">Item sales are menu prices before discount. Total collected is every rupee guests paid (GST included) on paid, non-cancelled orders; your earnings are the item sales minus discount, before GST. Generated automatically by the Aevidine owner console.</div>
<script>window.addEventListener("load",function(){setTimeout(function(){window.print()},300)});</script>
</body></html>`;
}

// Open the print document for a section — exported so the page can print AFTER its
// ask-the-date dialog (owner 2026-07-26: print asks/confirms the date first).
//
// Returns FALSE when the browser refused the pop-up, so the caller can SAY so. It used to
// `return` on a null window, which meant a blocked pop-up made the Print button do nothing
// at all with no trace — the "a tap must never vanish in silence" rule (found 2026-08-04).
export function printSection(ctx: SectionCtx): boolean {
  const w = window.open("", "_blank");
  if (!w) return false;
  w.document.write(sectionHtml(ctx));
  w.document.close();
  return true;
}
/** The one wording used everywhere a print pop-up is refused. */
export const POPUP_BLOCKED = "Your browser blocked the print window. Allow pop-ups for this site, then tap Print again.";

// ── the Print / CSV / Excel dropdown for a section ────────────────────────────
// `onPrintClick` (optional) replaces the immediate print with the page's ask-first flow.
export function SectionExport({ ctx, filename, onPrintClick }: { ctx: SectionCtx; filename: string; onPrintClick?: () => void }) {
  const [open, setOpen] = useState(false);
  const ready = (ctx.data.rows?.length ?? 0) >= 0 && !!ctx.data;
  useBackClose("owner-section-export", open, () => setOpen(false));
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!(e.target as HTMLElement | null)?.closest?.(".rs-exp")) setOpen(false); };
    document.addEventListener("click", close); return () => document.removeEventListener("click", close);
  }, [open]);
  // A refused / failed export must SAY so — see POPUP_BLOCKED above.
  const [note, setNote] = useState<string | null>(null);
  const dl = (blob: Blob, name: string) => { const u = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = u; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(u), 4000); };
  const csvEsc = (v: string | number) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const doCsv = () => { const t = sectionTables(ctx); dl(new Blob(["﻿" + t.map((x) => [x.title, x.head.map(csvEsc).join(","), ...x.rows.map((r) => r.map(csvEsc).join(","))].join("\n")).join("\n\n")], { type: "text/csv;charset=utf-8" }), `${filename}.csv`); };
  // Excel is an HTML table in disguise, so every title/header/cell must be ESCAPED — an
  // unescaped `&` or `<` in a dish or supplier name corrupted the sheet (found 2026-08-04).
  const doXls = () => { const t = sectionTables(ctx); const html = `<html><head><meta charset="utf-8"></head><body>` + t.map((x) => `<h3>${esc(x.title)}</h3><table border="1"><tr>${x.head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr>${x.rows.map((r) => `<tr>${r.map((cell) => `<td>${esc(String(cell))}</td>`).join("")}</tr>`).join("")}</table>`).join("<br/>") + `</body></html>`; dl(new Blob([html], { type: "application/vnd.ms-excel" }), `${filename}.xls`); };
  const doPrint = () => {
    setNote(null);
    if (onPrintClick) { onPrintClick(); return; }
    if (!printSection(ctx)) setNote(POPUP_BLOCKED);
  };
  return (
    <span className="rs-exp" style={{ position: "relative", display: "inline-flex" }}>
      <button className="rs-btn" onClick={() => setOpen((o) => !o)} disabled={!ready} aria-haspopup="menu" aria-expanded={open}>
        <i className="fas fa-file-export" aria-hidden /> Export <i className="fas fa-chevron-down" style={{ fontSize: 9, opacity: .7 }} aria-hidden />
      </button>
      {open && (
        <span role="menu" style={{ position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 90, minWidth: 180, display: "flex", flexDirection: "column", background: "var(--card)", border: "1px solid var(--border-c)", borderRadius: 12, padding: 5, boxShadow: "0 14px 34px rgba(0,0,0,.35)" }}>
          {([["fa-print", "Print", doPrint], ["fa-file-csv", "Download CSV", doCsv], ["fa-file-excel", "Download Excel", doXls]] as [string, string, () => void][]).map(([ic, lb, fn]) => (
            <button key={lb} role="menuitem" onClick={() => { setOpen(false); fn(); }} style={{ display: "flex", alignItems: "center", gap: 10, background: "none", border: "none", borderRadius: 8, padding: "8px 10px", font: "inherit", fontSize: 12.5, fontWeight: 700, color: "inherit", cursor: "pointer", textAlign: "left" }}>
              <i className={`fas ${ic}`} style={{ width: 16, color: "var(--accent)" }} aria-hidden /> {lb}
            </button>
          ))}
        </span>
      )}
      {note && (
        <span role="status" style={{ position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 91, width: 250,
          background: "var(--card)", border: "1px solid var(--adm-warn, #d97706)", borderRadius: 10, padding: "9px 11px",
          fontSize: 11.5, fontWeight: 600, lineHeight: 1.45, color: "var(--text)", boxShadow: "0 14px 34px rgba(0,0,0,.35)" }}>
          <i className="fas fa-triangle-exclamation" style={{ color: "var(--adm-warn, #d97706)", marginRight: 6 }} aria-hidden />
          {note}
          <button onClick={() => setNote(null)} aria-label="Dismiss"
            style={{ display: "block", marginTop: 7, background: "none", border: "none", padding: 0, font: "inherit", fontSize: 11, fontWeight: 700, color: "var(--accent)", cursor: "pointer" }}>OK</button>
        </span>
      )}
    </span>
  );
}
