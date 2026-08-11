"use client";
// Shared "Report" button: an ask-first period dialog (today/yesterday/7d/30d/this
// month/last month/all/custom-dates) that then auto-generates the professional
// compiled statement as Print / CSV / Excel. Used by BOTH the owner dashboard's
// Report button and the /owner/reports hub, so the report is identical everywhere.
import { useEffect, useState } from "react";
import { useBackClose } from "@/lib/backStack";
import { buildReportHtml, buildReportTables, type ReportData, type ExportTable } from "@/components/owner/ownerReportDoc";
import { POPUP_BLOCKED } from "@/components/owner/reports/sectionExport";

const DAY_MS = 86400000;
const GREEN = "#34d399";

// The Reports Studio next door offers "This week", "12 months" and "FY (Apr–Mar)", and BOTH
// owner routes already understand all three — but this dialog did not list them, so the one
// document an Indian restaurant has to produce every year (the financial year) could only be
// made by typing two dates by hand (T5 sweep, 2026-08-11).
const REPORT_PERIODS: { k: string; label: string }[] = [
  { k: "today", label: "Today" }, { k: "yesterday", label: "Yesterday" },
  { k: "7d", label: "Last 7 days" }, { k: "30d", label: "Last 30 days" },
  { k: "week", label: "This week" }, { k: "month", label: "This month" },
  { k: "lastmonth", label: "Last month" }, { k: "12m", label: "12 months" },
  { k: "fy", label: "FY (Apr–Mar)" }, { k: "all", label: "All time" },
  { k: "custom", label: "Custom dates…" },
];
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const pad2 = (n: number) => String(n).padStart(2, "0");

export function ReportMenu({ gather, filename }: { gather: (qs: string, label: string) => Promise<ReportData>; filename: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);   // a refused/failed export must SAY so
  const [period, setPeriod] = useState("30d");
  const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
  const [dFrom, setDFrom] = useState(new Date(Date.now() + 5.5 * 3600_000 - 29 * DAY_MS).toISOString().slice(0, 10));
  const [dTo, setDTo] = useState(today);
  // Calendar browse (owner, 2026-07-27): year book → 12 month books → the days —
  // pick a whole year, a whole month, or one exact day without typing dates.
  const [browse, setBrowse] = useState<{ level: "years" | "months" | "days"; year: number; month: number } | null>(null);
  const [labelOv, setLabelOv] = useState<string | null>(null);
  const todayY = Number(today.slice(0, 4));
  const clampTo = (iso: string) => (iso > today ? today : iso);
  const pickRange = (from: string, to: string, lab: string) => {
    setPeriod("custom"); setDFrom(from); setDTo(clampTo(to)); setLabelOv(lab);
  };
  useBackClose("owner-report-modal", open, () => setOpen(false));
  // Escape, like every other overlay in this console (the report detail overlay, the print
  // ask-dialog and the dashboard drawer all bind it). Never while a report is compiling — that
  // would strand the tab it already opened (T5 sweep, 2026-08-11).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) setOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, busy]);
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
  // Excel here is an HTML table in disguise, so every title / header / cell must be ESCAPED —
  // an unescaped `&` or `<` in a restaurant, dish or supplier name corrupted the sheet
  // (found 2026-08-04). CSV was already correct via escCsv.
  const xEsc = (v: string | number) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const asExcel = (tables: ExportTable[]) => {
    const html = `<html><head><meta charset="utf-8"></head><body>` + tables.map((t) =>
      `<h3>${xEsc(t.title)}</h3><table border="1"><tr>${t.head.map((h) => `<th>${xEsc(h)}</th>`).join("")}</tr>` +
      t.rows.map((r) => `<tr>${r.map((c) => `<td>${xEsc(c)}</td>`).join("")}</tr>`).join("") + `</table>`).join("<br/>") + `</body></html>`;
    download(new Blob([html], { type: "application/vnd.ms-excel" }), `${filename}.xls`);
  };
  const custom = period === "custom";
  const customOk = !custom || (dFrom <= dTo && !!dFrom && !!dTo);
  const qs = custom ? `range=custom&from=${dFrom}&to=${dTo}` : `range=${period}`;
  const fdate = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  const label = custom && labelOv ? labelOv
    : custom ? `${fdate(dFrom)} – ${fdate(dTo)}`
    : (REPORT_PERIODS.find((x) => x.k === period)?.label ?? period);
  // The print tab must open synchronously inside the click (popup blockers) —
  // open it first, write the finished document into it once the data lands.
  const run = async (kind: "print" | "csv" | "xls") => {
    if (busy || !customOk) return;
    setBusy(true);
    setNote(null);
    const tab = kind === "print" ? window.open("", "_blank") : null;
    // A BLOCKED pop-up used to end the whole thing in silence: `tab` was null, so neither the
    // success path nor the catch had anywhere to write and the button simply un-busied. Say so
    // instead — "a tap must never vanish in silence" (found 2026-08-04).
    if (kind === "print" && !tab) { setNote(POPUP_BLOCKED); setBusy(false); return; }
    if (tab) tab.document.write("<title>Preparing report…</title><body style='font-family:sans-serif;padding:40px;color:#333'>Preparing your report…</body>");
    try {
      const data = await gather(qs, label);
      if (kind === "print" && tab) { tab.document.open(); tab.document.write(buildReportHtml(data)); tab.document.close(); }
      else if (kind === "csv") asCsv(buildReportTables(data));
      else if (kind === "xls") asExcel(buildReportTables(data));
      setOpen(false);
    } catch (e) {
      // …and a failed DOWNLOAD (csv/xls) had no surface at all, since there was no tab to
      // write the apology into. Both kinds now report back in the dialog.
      const msg = e instanceof Error ? e.message : String(e);
      if (tab) { tab.document.open(); tab.document.write("<body style='font-family:sans-serif;padding:40px'>Couldn't build the report — close this tab and try again.</body>"); tab.document.close(); }
      else setNote(`Couldn't build the report — ${msg}`);
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
                <button key={x.k} role="option" aria-selected={period === x.k} className={period === x.k ? "on" : ""} onClick={() => { setPeriod(x.k); setLabelOv(null); }}>{x.label}</button>
              ))}
            </div>
            {custom && !labelOv && (
              <div className="owrp-dates">
                <label>From <input type="date" value={dFrom} max={dTo} onChange={(e) => { setDFrom(e.target.value); setLabelOv(null); }} /></label>
                <i className="fas fa-arrow-right" aria-hidden="true" />
                <label>To <input type="date" value={dTo} min={dFrom} max={today} onChange={(e) => { setDTo(e.target.value); setLabelOv(null); }} /></label>
              </div>
            )}
            {!browse ? (
              <button className="owrp-browse-open" onClick={() => setBrowse({ level: "years", year: todayY, month: 0 })}>
                <i className="fas fa-calendar-days" aria-hidden="true" /> Or browse the calendar — pick a year, a month or one exact day
              </button>
            ) : (
              <div className="owrp-browse">
                <div className="owrp-bhead">
                  <button className="crumb" onClick={() => setBrowse({ ...browse, level: "years" })}>Years</button>
                  {browse.level !== "years" && (<>
                    <span aria-hidden="true">›</span>
                    <button className="crumb" onClick={() => setBrowse({ ...browse, level: "months" })}>{browse.year}</button>
                  </>)}
                  {browse.level === "days" && (<>
                    <span aria-hidden="true">›</span>
                    <b>{MONTH_NAMES[browse.month]}</b>
                  </>)}
                  <button className="bx" onClick={() => setBrowse(null)} aria-label="Close calendar browse">✕</button>
                </div>
                {browse.level === "years" && (
                  <div className="owrp-grid y">
                    {/* Reach as far back as "All time" does (2020) rather than three years —
                        an owner comparing against an older year could not get there without
                        typing (T5 sweep, 2026-08-11). */}
                    {Array.from({ length: Math.max(3, todayY - 2019) }, (_, i) => todayY - i).map((y) => (
                      <button key={y} onClick={() => setBrowse({ level: "months", year: y, month: 0 })}>{y} <i className="fas fa-chevron-right" aria-hidden="true" /></button>
                    ))}
                  </div>
                )}
                {browse.level === "months" && (<>
                  <button className="owrp-whole" onClick={() => pickRange(`${browse.year}-01-01`, `${browse.year}-12-31`,
                    `${browse.year}-12-31` > today ? `Year ${browse.year} — till today` : `Year ${browse.year}`)}>
                    Use the whole year {browse.year}
                  </button>
                  <div className="owrp-grid m">
                    {MONTH_NAMES.map((mn, m) => {
                      const future = `${browse.year}-${pad2(m + 1)}-01` > today;
                      return <button key={mn} disabled={future} onClick={() => setBrowse({ level: "days", year: browse.year, month: m })}>{mn.slice(0, 3)}</button>;
                    })}
                  </div>
                </>)}
                {browse.level === "days" && (<>
                  <button className="owrp-whole" onClick={() => {
                    const last = new Date(browse.year, browse.month + 1, 0).getDate();
                    const to = `${browse.year}-${pad2(browse.month + 1)}-${pad2(last)}`;
                    pickRange(`${browse.year}-${pad2(browse.month + 1)}-01`, to,
                      `${MONTH_NAMES[browse.month]} ${browse.year}${to > today ? " — till today" : ""}`);
                  }}>Use the whole of {MONTH_NAMES[browse.month]} {browse.year}</button>
                  <div className="owrp-grid d">
                    {Array.from({ length: new Date(browse.year, browse.month + 1, 0).getDate() }, (_, i) => i + 1).map((day) => {
                      const iso = `${browse.year}-${pad2(browse.month + 1)}-${pad2(day)}`;
                      return <button key={day} disabled={iso > today} className={custom && labelOv && dFrom === iso && dTo === iso ? "on" : ""}
                        onClick={() => pickRange(iso, iso, `${day} ${MONTH_NAMES[browse.month].slice(0, 3)} ${browse.year}`)}>{day}</button>;
                    })}
                  </div>
                </>)}
              </div>
            )}
            <footer>
              <span className="owrp-hint">{note
                ? <span style={{ color: "var(--adm-warn, #d97706)", fontWeight: 700 }}><i className="fas fa-triangle-exclamation" style={{ marginRight: 5 }} aria-hidden />{note}</span>
                : busy ? "Compiling your report…" : `Report for: ${label}`}</span>
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
            .owrp-browse-open { display: flex; align-items: center; gap: 8px; width: 100%; margin-top: 12px; background: var(--bg); border: 1px dashed color-mix(in srgb, ${GREEN} 45%, transparent); border-radius: 10px; padding: 9px 12px; font: inherit; font-size: 12px; font-weight: 700; color: var(--muted); cursor: pointer; }
            .owrp-browse-open:hover { color: var(--text); border-style: solid; }
            .owrp-browse { margin-top: 12px; border: var(--border); border-radius: 12px; padding: 10px 12px; background: var(--bg); }
            .owrp-bhead { display: flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 700; margin-bottom: 9px; color: var(--muted); }
            .owrp-bhead .crumb { background: none; border: none; color: ${GREEN}; font: inherit; font-weight: 800; cursor: pointer; padding: 0; }
            .owrp-bhead b { color: var(--text); }
            .owrp-bhead .bx { margin-left: auto; background: none; border: var(--border); color: var(--muted); border-radius: 7px; width: 24px; height: 24px; font-size: 11px; cursor: pointer; }
            .owrp-grid { display: grid; gap: 6px; }
            .owrp-grid.y { grid-template-columns: repeat(3, 1fr); max-height: 168px; overflow-y: auto; }
            .owrp-grid.m { grid-template-columns: repeat(4, 1fr); }
            .owrp-grid.d { grid-template-columns: repeat(7, 1fr); }
            .owrp-grid button { background: var(--card); border: var(--border); border-radius: 8px; padding: 8px 4px; font: inherit; font-size: 12px; font-weight: 700; color: var(--text); cursor: pointer; }
            .owrp-grid button:hover:not(:disabled) { border-color: ${GREEN}; }
            .owrp-grid button:disabled { opacity: .35; cursor: default; }
            .owrp-grid button.on { background: color-mix(in srgb, ${GREEN} 18%, transparent); border-color: ${GREEN}; }
            .owrp-whole { display: block; width: 100%; margin-bottom: 8px; background: color-mix(in srgb, ${GREEN} 10%, transparent); border: 1px solid color-mix(in srgb, ${GREEN} 40%, transparent); border-radius: 8px; padding: 8px 10px; font: inherit; font-size: 12px; font-weight: 700; color: var(--text); cursor: pointer; }
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
