"use client";
// Phase-3 (owner round-6): a professional, section-scoped Print / CSV / Excel for
// EVERY sub-report — not a screenshot of the panel. Given the current report's shape
// it builds a clean standalone A4 document (masthead + the section's table) and the
// matching CSV/Excel tables. Reuses the ExportTable shape + the .xls trick from the
// full-statement builder, so exports look like one family across the whole panel.
import { useEffect, useState } from "react";
import { useBackClose } from "@/lib/backStack";
import { canonPayMethod } from "@/components/owner/Charts";
import type { ExportTable } from "@/components/owner/ownerReportDoc";

// Paise only when the amount actually has them (the CGST/SGST halves of an odd tax total),
// so equal rates print as equal halves; whole-rupee amounts stay clean.
const inr = (n: number) => {
  const v = Number(n) || 0;
  const hasPaise = Math.abs(Math.round(v) - v) > 0.005;
  return "₹" + v.toLocaleString("en-IN", { minimumFractionDigits: hasPaise ? 2 : 0, maximumFractionDigits: 2 });
};
const nfmt = (n: number) => Math.round(Number(n) || 0).toLocaleString("en-IN");
// Proportional-by-rate split, paise, last line absorbs the remainder so parts add to total.
const splitTax = (rates: number[], target: number): number[] => {
  const sum = rates.reduce((a, r) => a + r, 0) || 1;
  const p2 = (v: number) => Math.round(v * 100) / 100;
  let running = 0;
  return rates.map((r, i) => { const amt = i === rates.length - 1 ? p2(target - running) : p2(target * (r / sum)); running = p2(running + amt); return amt; });
};
const esc = (s: string) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

type MoneyRow = { bucket: string; orders: number; paidOrders: number; subtotal: number; tax: number; discount: number; revenue: number; cancelledOrders: number; cancelledValue: number };
type Totals = Omit<MoneyRow, "bucket">;
type TaxInfo = { effectivePct: number; components: { label: string; rate: number; amount: number }[]; configured: boolean } | null;
type InHandExport = {
  itemSales: number; discounts: number; netSales: number; gst: number;
  collected: number; yours: number; expenses: number; left: number;
  parts: {
    manual: { amount: number; entries: number; byCategory: Record<string, number> } | null;
    salary: { accrued: number; paid: number; people: number; excluded: number } | null;
    stock: { used: number; wasted: number; cancelledFoodRemoved: number } | null;
    cancelled: { mode: string; lostSales: number; orders: number; foodCost: number; charged: number };
  };
};
type Payload = { rows?: unknown[]; totals?: Totals; tax?: TaxInfo; bucket?: string;
  // Team & pay carries its own shapes (mig 220/221) alongside the shared `rows`.
  people?: unknown[]; monthRows?: unknown[]; cashRows?: unknown[];
  // The in-hand ladder (mig 252) and the inventory sub-tab shapes (mig 227).
  inHand?: InHandExport | null;
  summary?: Record<string, number | null>; items?: unknown[]; vendors?: unknown[];
  expenses?: unknown[]; waste?: unknown[]; dishes?: unknown[] };

export type SectionMeta = { label: string; kind: string };
export type SectionCtx = {
  meta: SectionMeta; data: Payload; restName: string; periodLabel: string;
  isTax?: boolean;   // the Tax/GST report → append the CGST/SGST split table
  bucketLabel: (iso: string, bucket: string) => string;
  extra?: ExportTable[];   // extra tables appended to print/CSV (Day summary: dishes + hours)
};

// ── build the flat tables (CSV / Excel) for the current section ──────────────
export function sectionTables(c: SectionCtx): ExportTable[] {
  const { meta, data } = c;
  const grain = data.bucket || "day";
  const title = `${meta.label} — ${c.restName} — ${c.periodLabel}`;
  if (meta.kind === "money" || meta.kind === "daysummary") {
    const m = (data.rows ?? []) as MoneyRow[]; const t = data.totals;
    const head = ["Period", "Orders", "Paid", "Item sales", "GST", "Discount", "Total collected", "Cancelled", "Lost value"];
    const rows: (string | number)[][] = m.map((r) => [c.bucketLabel(r.bucket, grain), r.orders, r.paidOrders, Math.round(r.subtotal), Math.round(r.tax), Math.round(r.discount), Math.round(r.revenue), r.cancelledOrders, Math.round(r.cancelledValue)]);
    if (t) rows.push(["Total", t.orders, t.paidOrders, Math.round(t.subtotal), Math.round(t.tax), Math.round(t.discount), Math.round(t.revenue), t.cancelledOrders, Math.round(t.cancelledValue)]);
    const out: ExportTable[] = [{ title, head, rows }];
    if (c.isTax && data.tax) {
      // Whole-rupee target (GST-return rounding): equal rates export equal halves that sum
      // to the shown total — mirrors the on-screen split exactly.
      out.push({ title: `${meta.label} — tax split`, head: ["Component", "Rate %", "Collected"],
        rows: [["Total tax", data.tax.effectivePct, Math.round(t?.tax ?? 0)], ...splitTax(data.tax.components.map((x) => x.rate), Math.round(t?.tax ?? 0)).map((amt, i) => [data.tax!.components[i].label, data.tax!.components[i].rate, amt] as (string | number)[])] });
    }
    // The in-hand ladder (mig 252). Exported as its own small table so the printed sheet
    // and the spreadsheet both end on the number the owner actually reads, instead of
    // stopping at "Total collected" the way the screen used to.
    const ih = data.inHand;
    if (ih) {
      const rows2: (string | number)[][] = [
        ["Item sales", Math.round(ih.itemSales)],
        ["Discounts given", -Math.round(ih.discounts)],
        ["Net sales", Math.round(ih.netSales)],
        ["GST collected", Math.round(ih.gst)],
        ["Total collected", Math.round(ih.collected)],
        ["GST set aside for the government", -Math.round(ih.gst)],
        ["Your money", Math.round(ih.yours)],
      ];
      const pt = ih.parts;
      if (pt.manual) rows2.push(["Costs you entered", -Math.round(pt.manual.amount)]);
      for (const [k, v] of Object.entries(pt.manual?.byCategory || {})) rows2.push([`   ${k}`, -Math.round(Number(v))]);
      rows2.push(["Team wages (period's share)", pt.salary ? -Math.round(pt.salary.accrued) : "not tracked"]);
      rows2.push(["Food taken from stock", pt.stock ? -Math.round(pt.stock.used) : "not tracked"]);
      rows2.push(["Thrown away", pt.stock ? -Math.round(pt.stock.wasted) : "not tracked"]);
      rows2.push([`Cancelled orders (${pt.cancelled.mode === "bill" ? "charged at menu price" : "taken out of stock"})`,
        pt.cancelled.charged ? -Math.round(pt.cancelled.charged) : 0]);
      rows2.push(["Expenses in total", -Math.round(ih.expenses)]);
      rows2.push(["PROFIT IN HAND", Math.round(ih.left)]);
      rows2.push(["Lost to cancellations (not charged above)", Math.round(ih.parts.cancelled.lostSales)]);
      out.push({ title: `${meta.label} — profit in hand`, head: ["Line", "Amount"], rows: rows2 });
    }
    if (c.extra?.length) out.push(...c.extra);   // Day summary: the day's dishes + busy hours
    return out;
  }
  if (meta.kind === "dishes") return [{ title, head: ["Dish", "Qty sold", "Item sales (list price)"], rows: ((data.rows ?? []) as { title: string; qty: number; revenue: number }[]).map((r) => [r.title, r.qty, Math.round(r.revenue)]) }];
  if (meta.kind === "categories") return [{ title, head: ["Category", "Qty sold", "Item sales (list price)"], rows: ((data.rows ?? []) as { category: string; qty: number; revenue: number }[]).map((r) => [r.category, r.qty, Math.round(r.revenue)]) }];
  if (meta.kind === "payments") return [{ title, head: ["Method", "Bills", "Revenue"], rows: ((data.rows ?? []) as { method: string; revenue: number; orders: number }[]).map((r) => [canonPayMethod(r.method), r.orders, Math.round(r.revenue)]) }];
  if (meta.kind === "hourly") return [{ title, head: ["Hour", "Orders", "Revenue"], rows: ((data.rows ?? []) as { hour: number; orders: number; revenue: number }[]).map((r) => [`${r.hour}:00`, r.orders, Math.round(r.revenue)]) }];
  // Team & pay (mig 220/221). Without these two branches the export fell through to the
  // empty "—" table below, so Export and Print produced a blank document (2026-07-31 sweep).
  if (meta.kind === "staffpay") {
    const people = (data.people ?? []) as { name: string; designation: string | null; role: string; pay_type: string | null; pay_amount: number; salary: number; advance: number; bonus: number; overtime: number; other: number; paid: number; advanceOutstanding: number; lastPaidOn: string | null }[];
    const months = (data.monthRows ?? []) as { bucket: string; people: number; expected: number; paid: number; owed: number }[];
    const cash = (data.cashRows ?? []) as { bucket: string; paid_out: number; people: number; entries: number }[];
    const out: ExportTable[] = [{
      title: `${title} — who you paid`,
      head: ["Person", "Role", "Rate", "Salary", "Advance", "Bonus / OT / other", "Total paid", "Advance left", "Last paid"],
      rows: people.map((r) => [r.name, r.designation || (r.role === "tablet" ? "waiter" : r.role),
        r.pay_amount ? Math.round(r.pay_amount) : "", Math.round(r.salary), Math.round(r.advance),
        Math.round(r.bonus + r.overtime + r.other), Math.round(r.paid), Math.round(r.advanceOutstanding),
        r.lastPaidOn || ""]),
    }];
    if (months.length) out.push({
      title: `${title} — what each month was worth`,
      head: ["Month", "On pay list", "Team cost", "Paid for it", "Still owed"],
      rows: months.map((m) => [new Date(m.bucket).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "Asia/Kolkata" }),
        m.people, Math.round(m.expected), Math.round(m.paid), Math.round(m.owed)]),
    });
    if (cash.length) out.push({
      title: `${title} — money out, by day`,
      head: ["Day", "Paid out", "People", "Entries"],
      rows: cash.map((r) => [c.bucketLabel(r.bucket, grain), Math.round(r.paid_out), r.people, r.entries]),
    });
    return out;
  }
  if (meta.kind === "staffperf") {
    const rows = (data.rows ?? []) as { name: string; role: string; designation: string | null; active: boolean; daysActive: number; hours: number; orders: number; value: number; tables: number; sittings: number; discount: number; ratings: number; avgRating: number | null; paid: number }[];
    return [{
      title, head: ["Person", "Role", "Days worked", "Hours on shift", "Orders punched", "Value punched", "Tables", "Sittings", "Discount given", "Ratings", "Avg rating", "Paid"],
      rows: rows.map((r) => [r.name + (r.active ? "" : " (disabled)"), r.designation || (r.role === "tablet" ? "waiter" : r.role),
        r.daysActive, r.hours, r.orders, Math.round(r.value), r.tables, r.sittings, Math.round(r.discount),
        r.ratings, r.avgRating ?? "", Math.round(r.paid)]),
    }];
  }
  // Inventory & stock (mig 227). Without these the five sub-tabs fell through to the empty
  // "—" table below and Export/Print produced a BLANK document — the same fault the two
  // staff branches above were added to fix, left behind on the inventory tabs.
  if (meta.kind.startsWith("inv")) {
    const sum = data.summary as Record<string, number | null> | undefined;
    const out: ExportTable[] = [];
    if (sum) out.push({ title: `${title} — the money`, head: ["Line", "Amount"], rows: [
      ["Stock on the shelf now", Math.round(Number(sum.stockValue) || 0)],
      ["Bought in this period", Math.round(Number(sum.purchases) || 0)],
      ["Ingredients used by dishes sold", Math.round(Number(sum.theoreticalCost) || 0)],
      ["Food taken from stock (ledger)", Math.round(Number(sum.actualUsed) || 0)],
      ["Thrown away", Math.round(Number(sum.wasted) || 0)],
      ["Other expenses", Math.round(Number(sum.expenses) || 0)],
      ["Count corrections", Math.round(Number(sum.corrections) || 0)],
    ] });
    const items = (data.items ?? []) as Record<string, unknown>[];
    if (items.length) out.push({ title: `${title} — every ingredient`,
      head: ["Ingredient", "Category", "On hand", "Unit", "Value", "Bought", "Used", "Wasted", "Corrections"],
      rows: items.map((i) => [String(i.name), String(i.category || ""), Number(i.onHandBase) || 0, String(i.baseUom || ""),
        Math.round(Number(i.onHandVal) || 0), Math.round(Number(i.boughtVal) || 0), Math.round(Number(i.usedVal) || 0),
        Math.round(Number(i.wastedVal) || 0), Math.round(Number(i.adjustVal) || 0)]) });
    const vend = (data.vendors ?? []) as Record<string, unknown>[];
    if (vend.length) out.push({ title: `${title} — suppliers`, head: ["Supplier", "Bills", "Amount"],
      rows: vend.map((v) => [String(v.vendor), Number(v.bills) || 0, Math.round(Number(v.amount) || 0)]) });
    const exp = (data.expenses ?? []) as Record<string, unknown>[];
    if (exp.length) out.push({ title: `${title} — the expense book`,
      head: ["Date", "Category", "What", "Amount", "Recorded by", "Struck out"],
      rows: exp.map((e) => [String(e.expense_date), String(e.category), String(e.title),
        Math.round(Number(e.amount) || 0), String(e.created_by || ""), e.voided_at ? String(e.void_reason || "yes") : ""]) });
    const wst = (data.waste ?? []) as Record<string, unknown>[];
    if (wst.length) out.push({ title: `${title} — waste`, head: ["Date", "Reason", "Qty", "Value", "Struck out"],
      rows: wst.map((w) => [String(w.waste_date), String(w.reason), Number(w.qty_base) || 0,
        Math.round((Number(w.qty_base) || 0) * (Number(w.unit_cost_snap) || 0)), w.voided_at ? "yes" : ""]) });
    const dsh = (data.dishes ?? []) as Record<string, unknown>[];
    if (dsh.length) out.push({ title: `${title} — cost per dish`,
      head: ["Dish", "Price", "Sold", "Sales", "Plate cost", "Cost total"],
      rows: dsh.map((d) => [String(d.title), Math.round(Number(d.price) || 0), Number(d.qtySold) || 0,
        Math.round(Number(d.revenue) || 0), Math.round(Number(d.plateCost) || 0), Math.round(Number(d.costTotal) || 0)]) });
    return out.length ? out : [{ title, head: ["—"], rows: [] }];
  }
  return [{ title, head: ["—"], rows: [] }];
}

// ── the print document (masthead + the section's table) ───────────────────────
export function sectionHtml(c: SectionCtx): string {
  const tables = sectionTables(c);
  const gen = new Date().toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });
  const isMoney = c.meta.kind === "money" || c.meta.kind === "daysummary";
  // Format each numeric cell by what its COLUMN HEADER says, not its index — the tables have
  // different shapes (money table vs the tax-split table vs breakdowns), so an index-based
  // guess mis-rendered the split's rate/amount. Money headers → ₹ (paise-aware); "Rate" → N%;
  // everything else numeric → plain count.
  const fmtCell = (cell: string | number, head: string): string => {
    if (typeof cell !== "number") return esc(String(cell));
    const h = head.toLowerCase();
    if (/rate|%/.test(h)) return `${cell}%`;
    if (/gross|gst|tax|discount|net|revenue|collected|lost|sales|value/.test(h)) return inr(cell);
    return nfmt(cell);
  };
  const tableHtml = (t: ExportTable) => `
    <h3>${esc(t.title.split(" — ")[1] ? t.title.split(" — ").slice(1).join(" · ") : t.title)}</h3>
    <table><thead><tr>${t.head.map((h, i) => `<th${i > 0 ? ' class="r"' : ""}>${esc(h)}</th>`).join("")}</tr></thead>
    <tbody>${t.rows.map((r, ri) => `<tr${ri === t.rows.length - 1 && isMoney && String(r[0]).startsWith("Total") ? ' class="tot"' : ""}>${r.map((cell, i) => `<td${i > 0 ? ' class="r"' : ""}>${i === 0 ? esc(String(cell)) : fmtCell(cell, String(t.head[i] ?? ""))}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  return `<!doctype html><html><head><meta charset="utf-8"/><title>${esc(c.meta.label)} · ${esc(c.restName)} · ${esc(c.periodLabel)}</title>
<style>
  *{box-sizing:border-box} body{font-family:-apple-system,"Segoe UI",Inter,Roboto,sans-serif;color:#10231c;margin:0;padding:34px 40px 50px;font-size:12.5px;line-height:1.5}
  .mast{display:flex;justify-content:space-between;align-items:baseline;border-bottom:3px solid #0f766e;padding-bottom:10px}
  .brand{font-weight:800;font-size:13px;letter-spacing:.06em;color:#0f766e;text-transform:uppercase}.gen{font-size:10.5px;color:#6b7f78}
  h1{font-size:22px;margin:14px 0 2px}.scope{color:#4b615a;font-size:13px;margin-bottom:6px}
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
  ${tables.map(tableHtml).join("")}
  <div class="note">Item sales are menu prices before discount. Total collected is every rupee guests paid (GST included) on paid, non-cancelled orders; your earnings are the item sales minus discount, before GST. Generated automatically by the Aevidine owner console.</div>
<script>window.addEventListener("load",function(){setTimeout(function(){window.print()},300)});</script>
</body></html>`;
}

// Open the print document for a section — exported so the page can print AFTER its
// ask-the-date dialog (owner 2026-07-26: print asks/confirms the date first).
export function printSection(ctx: SectionCtx) {
  const w = window.open("", "_blank");
  if (!w) return;
  w.document.write(sectionHtml(ctx));
  w.document.close();
}

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
  const dl = (blob: Blob, name: string) => { const u = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = u; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(u), 4000); };
  const csvEsc = (v: string | number) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const doCsv = () => { const t = sectionTables(ctx); dl(new Blob(["﻿" + t.map((x) => [x.title, x.head.map(csvEsc).join(","), ...x.rows.map((r) => r.map(csvEsc).join(","))].join("\n")).join("\n\n")], { type: "text/csv;charset=utf-8" }), `${filename}.csv`); };
  const doXls = () => { const t = sectionTables(ctx); const html = `<html><head><meta charset="utf-8"></head><body>` + t.map((x) => `<h3>${x.title}</h3><table border="1"><tr>${x.head.map((h) => `<th>${h}</th>`).join("")}</tr>${x.rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</table>`).join("<br/>") + `</body></html>`; dl(new Blob([html], { type: "application/vnd.ms-excel" }), `${filename}.xls`); };
  const doPrint = () => (onPrintClick ? onPrintClick() : printSection(ctx));
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
    </span>
  );
}
