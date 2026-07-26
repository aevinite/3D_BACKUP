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

const inr = (n: number) => "₹" + Math.round(Number(n) || 0).toLocaleString("en-IN");
const nfmt = (n: number) => Math.round(Number(n) || 0).toLocaleString("en-IN");
const esc = (s: string) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

type MoneyRow = { bucket: string; orders: number; paidOrders: number; subtotal: number; tax: number; discount: number; revenue: number; cancelledOrders: number; cancelledValue: number };
type Totals = Omit<MoneyRow, "bucket">;
type TaxInfo = { effectivePct: number; components: { label: string; rate: number; amount: number }[]; configured: boolean } | null;
type Payload = { rows?: unknown[]; totals?: Totals; tax?: TaxInfo; bucket?: string };

export type SectionMeta = { label: string; kind: string };
export type SectionCtx = {
  meta: SectionMeta; data: Payload; restName: string; periodLabel: string;
  isTax?: boolean;   // the Tax/GST report → append the CGST/SGST split table
  bucketLabel: (iso: string, bucket: string) => string;
};

// ── build the flat tables (CSV / Excel) for the current section ──────────────
export function sectionTables(c: SectionCtx): ExportTable[] {
  const { meta, data } = c;
  const grain = data.bucket || "day";
  const title = `${meta.label} — ${c.restName} — ${c.periodLabel}`;
  if (meta.kind === "money" || meta.kind === "daysummary") {
    const m = (data.rows ?? []) as MoneyRow[]; const t = data.totals;
    const head = ["Period", "Orders", "Paid", "Gross", "Tax", "Discount", "Net", "Cancelled", "Lost value"];
    const rows: (string | number)[][] = m.map((r) => [c.bucketLabel(r.bucket, grain), r.orders, r.paidOrders, Math.round(r.subtotal), Math.round(r.tax), Math.round(r.discount), Math.round(r.revenue), r.cancelledOrders, Math.round(r.cancelledValue)]);
    if (t) rows.push(["Total", t.orders, t.paidOrders, Math.round(t.subtotal), Math.round(t.tax), Math.round(t.discount), Math.round(t.revenue), t.cancelledOrders, Math.round(t.cancelledValue)]);
    const out: ExportTable[] = [{ title, head, rows }];
    if (c.isTax && data.tax) {
      out.push({ title: `${meta.label} — tax split`, head: ["Component", "Rate %", "Collected"],
        rows: [["Total tax", data.tax.effectivePct, Math.round(t?.tax ?? 0)], ...data.tax.components.map((x) => [x.label, x.rate, Math.round(x.amount)] as (string | number)[])] });
    }
    return out;
  }
  if (meta.kind === "dishes") return [{ title, head: ["Dish", "Qty sold", "Item sales (list price)"], rows: ((data.rows ?? []) as { title: string; qty: number; revenue: number }[]).map((r) => [r.title, r.qty, Math.round(r.revenue)]) }];
  if (meta.kind === "categories") return [{ title, head: ["Category", "Qty sold", "Item sales (list price)"], rows: ((data.rows ?? []) as { category: string; qty: number; revenue: number }[]).map((r) => [r.category, r.qty, Math.round(r.revenue)]) }];
  if (meta.kind === "payments") return [{ title, head: ["Method", "Bills", "Revenue"], rows: ((data.rows ?? []) as { method: string; revenue: number; orders: number }[]).map((r) => [canonPayMethod(r.method), r.orders, Math.round(r.revenue)]) }];
  if (meta.kind === "hourly") return [{ title, head: ["Hour", "Orders", "Revenue"], rows: ((data.rows ?? []) as { hour: number; orders: number; revenue: number }[]).map((r) => [`${r.hour}:00`, r.orders, Math.round(r.revenue)]) }];
  return [{ title, head: ["—"], rows: [] }];
}

// ── the print document (masthead + the section's table) ───────────────────────
export function sectionHtml(c: SectionCtx): string {
  const tables = sectionTables(c);
  const gen = new Date().toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });
  const isMoney = c.meta.kind === "money" || c.meta.kind === "daysummary";
  const tableHtml = (t: ExportTable) => `
    <h3>${esc(t.title.split(" — ")[1] ? t.title.split(" — ").slice(1).join(" · ") : t.title)}</h3>
    <table><thead><tr>${t.head.map((h, i) => `<th${i > 0 ? ' class="r"' : ""}>${esc(h)}</th>`).join("")}</tr></thead>
    <tbody>${t.rows.map((r, ri) => `<tr${ri === t.rows.length - 1 && isMoney && String(r[0]).startsWith("Total") ? ' class="tot"' : ""}>${r.map((cell, i) => `<td${i > 0 ? ' class="r"' : ""}>${typeof cell === "number" && i > 0 ? (isMoney && ![1, 2].includes(i) ? inr(cell) : nfmt(cell)) : esc(String(cell))}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
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
  <div class="note">Net revenue counts paid, non-cancelled orders and is net of discounts. Generated automatically by the Aevidine owner console.</div>
<script>window.addEventListener("load",function(){setTimeout(function(){window.print()},300)});</script>
</body></html>`;
}

// ── the Print / CSV / Excel dropdown for a section ────────────────────────────
export function SectionExport({ ctx, filename }: { ctx: SectionCtx; filename: string }) {
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
  const doPrint = () => { const w = window.open("", "_blank"); if (!w) return; w.document.write(sectionHtml(ctx)); w.document.close(); };
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
