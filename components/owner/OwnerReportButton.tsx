"use client";
// Shared "Report" button: an ask-first period dialog (today/yesterday/7d/30d/this
// month/last month/all/custom-dates) that then auto-generates the professional
// compiled statement as Print / CSV / Excel. Used by BOTH the owner dashboard's
// Report button and the /owner/reports hub, so the report is identical everywhere.
import { useEffect, useState } from "react";
import { useBackClose } from "@/lib/backStack";
import { buildReportHtml, buildReportTables, type ReportData, type ExportTable } from "@/components/owner/ownerReportDoc";

const DAY_MS = 86400000;
const GREEN = "#34d399";

const REPORT_PERIODS: { k: string; label: string }[] = [
  { k: "today", label: "Today" }, { k: "yesterday", label: "Yesterday" },
  { k: "7d", label: "Last 7 days" }, { k: "30d", label: "Last 30 days" },
  { k: "month", label: "This month" }, { k: "lastmonth", label: "Last month" },
  { k: "all", label: "All time" }, { k: "custom", label: "Custom dates…" },
];
export function ReportMenu({ gather, filename }: { gather: (qs: string, label: string) => Promise<ReportData>; filename: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [period, setPeriod] = useState("30d");
  const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
  const [dFrom, setDFrom] = useState(new Date(Date.now() + 5.5 * 3600_000 - 29 * DAY_MS).toISOString().slice(0, 10));
  const [dTo, setDTo] = useState(today);
  useBackClose("owner-report-modal", open, () => setOpen(false));
  const download = (blob: Blob, name: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  };
  const escCsv = (v: string | number) => {
    const x = String(v ?? "");
    return /[",\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x;
  };
  const asCsv = (tables: ExportTable[]) => {
    const parts = tables.map((t) => [t.title, t.head.map(escCsv).join(","), ...t.rows.map((r) => r.map(escCsv).join(","))].join("\n"));
    download(new Blob(["\ufeff" + parts.join("\n\n")], { type: "text/csv;charset=utf-8" }), `${filename}.csv`);
  };
  const asExcel = (tables: ExportTable[]) => {
    const html = `<html><head><meta charset="utf-8"></head><body>` + tables.map((t) =>
      `<h3>${t.title}</h3><table border="1"><tr>${t.head.map((h) => `<th>${h}</th>`).join("")}</tr>` +
      t.rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("") + `</table>`).join("<br/>") + `</body></html>`;
    download(new Blob([html], { type: "application/vnd.ms-excel" }), `${filename}.xls`);
  };
  const custom = period === "custom";
  const customOk = !custom || (dFrom <= dTo && !!dFrom && !!dTo);
  const qs = custom ? `range=custom&from=${dFrom}&to=${dTo}` : `range=${period}`;
  const fdate = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  const label = custom ? `${fdate(dFrom)} – ${fdate(dTo)}` : (REPORT_PERIODS.find((x) => x.k === period)?.label ?? period);
  // The print tab must open synchronously inside the click (popup blockers) —
  // open it first, write the finished document into it once the data lands.
  const run = async (kind: "print" | "csv" | "xls") => {
    if (busy || !customOk) return;
    setBusy(true);
    const tab = kind === "print" ? window.open("", "_blank") : null;
    if (tab) tab.document.write("<title>Preparing report…</title><body style='font-family:sans-serif;padding:40px;color:#333'>Preparing your report…</body>");
    try {
      const data = await gather(qs, label);
      if (kind === "print" && tab) { tab.document.open(); tab.document.write(buildReportHtml(data)); tab.document.close(); }
      else if (kind === "csv") asCsv(buildReportTables(data));
      else if (kind === "xls") asExcel(buildReportTables(data));
      setOpen(false);
    } catch {
      if (tab) { tab.document.open(); tab.document.write("<body style='font-family:sans-serif;padding:40px'>Couldn't build the report — close this tab and try again.</body>"); tab.document.close(); }
    } finally { setBusy(false); }
  };
  return (
    <>
      <button className="adm-btn" onClick={() => setOpen(true)}>
        <i className="fas fa-file-export" style={{ marginRight: 6 }} aria-hidden="true" />Report
      </button>
      {open && (
        <div className="owrp-wrap" role="dialog" aria-label="Generate report">
          <div className="owrp-back" onClick={() => !busy && setOpen(false)} aria-hidden="true" />
          <div className="owrp">
            <header>
              <div><h3>Generate report</h3><p>Pick the period, then choose a format — the report compiles billing, GST and settlement for every restaurant.</p></div>
              <button className="x" onClick={() => setOpen(false)} aria-label="Close" disabled={busy}>✕</button>
            </header>
            <div className="owrp-periods" role="listbox" aria-label="Period">
              {REPORT_PERIODS.map((x) => (
                <button key={x.k} role="option" aria-selected={period === x.k} className={period === x.k ? "on" : ""} onClick={() => setPeriod(x.k)}>{x.label}</button>
              ))}
            </div>
            {custom && (
              <div className="owrp-dates">
                <label>From <input type="date" value={dFrom} max={dTo} onChange={(e) => setDFrom(e.target.value)} /></label>
                <i className="fas fa-arrow-right" aria-hidden="true" />
                <label>To <input type="date" value={dTo} min={dFrom} max={today} onChange={(e) => setDTo(e.target.value)} /></label>
              </div>
            )}
            <footer>
              <span className="owrp-hint">{busy ? "Compiling your report…" : `Report for: ${label}`}</span>
              <span className="owrp-btns">
                <button className="adm-btn" disabled={busy || !customOk} onClick={() => run("print")}><i className={`fas ${busy ? "fa-spinner fa-spin" : "fa-print"}`} aria-hidden="true" /> Print</button>
                <button className="adm-btn" disabled={busy || !customOk} onClick={() => run("csv")}><i className="fas fa-file-csv" aria-hidden="true" /> CSV</button>
                <button className="adm-btn" disabled={busy || !customOk} onClick={() => run("xls")}><i className="fas fa-file-excel" aria-hidden="true" /> Excel</button>
              </span>
            </footer>
          </div>
          <style jsx>{`
            .owrp-wrap { position: fixed; inset: 0; z-index: 120; display: grid; place-items: center; }
            .owrp-back { position: absolute; inset: 0; background: rgba(5,8,14,.55); backdrop-filter: blur(2px); }
            .owrp { position: relative; width: min(560px, 94vw); background: var(--card); border: var(--border); border-radius: 16px; box-shadow: 0 24px 70px rgba(0,0,0,.45); padding: 18px 20px; }
            .owrp header { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin-bottom: 14px; }
            .owrp h3 { margin: 0; font-size: 16px; }
            .owrp header p { margin: 4px 0 0; font-size: 12px; color: var(--muted); line-height: 1.5; }
            .owrp .x { background: var(--bg); border: var(--border); color: var(--text); width: 30px; height: 30px; border-radius: 9px; font-size: 13px; cursor: pointer; flex: none; }
            .owrp-periods { display: grid; grid-template-columns: repeat(4, 1fr); gap: 7px; }
            .owrp-periods button { background: var(--bg); border: var(--border); border-radius: 9px; padding: 8px 6px; font: inherit; font-size: 12px; font-weight: 700; color: var(--muted); cursor: pointer; }
            .owrp-periods button.on { background: color-mix(in srgb, ${GREEN} 16%, transparent); border-color: ${GREEN}; color: var(--text); }
            .owrp-dates { display: flex; align-items: center; gap: 12px; margin-top: 12px; flex-wrap: wrap; color: var(--muted); }
            .owrp-dates label { display: flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 700; }
            .owrp-dates input { background: var(--bg); border: var(--border); border-radius: 8px; padding: 7px 9px; font: inherit; font-size: 12.5px; color: var(--text); color-scheme: dark light; }
            .owrp footer { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-top: 16px; flex-wrap: wrap; }
            .owrp-hint { font-size: 11.5px; color: var(--muted); font-weight: 600; }
            .owrp-btns { display: inline-flex; gap: 8px; }
            @media (max-width: 560px) { .owrp-periods { grid-template-columns: repeat(2, 1fr); } }
          `}</style>
        </div>
      )}
    </>
  );
}
