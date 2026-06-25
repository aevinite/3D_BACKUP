"use client";
// Owner · printable earnings report. A clean letterhead report (range KPIs +
// per-restaurant breakdown + grand totals) that prints / saves-to-PDF via the
// browser. Reuses the owner RPCs (admin cookie => all restaurants). The print CSS
// (globals @media print) hides the panel chrome so the printout is just the report.
import { useCallback, useEffect, useMemo, useState } from "react";
import { inr } from "@/components/admin/shared";

type Range = "today" | "7d" | "30d" | "all";
const RANGE_LABEL: Record<Range, string> = { today: "Today", "7d": "Last 7 days", "30d": "Last 30 days", all: "All time" };
type RevRow = { id: string; name: string; revenue: number; orders: number };

export default function OwnerReport() {
  const [range, setRange] = useState<Range>("30d");
  const [rev, setRev] = useState<RevRow[]>([]);
  const [openTables, setOpenTables] = useState(0);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    setLoaded(false);
    try {
      const [an, ov] = await Promise.all([
        fetch(`/api/owner/analytics?range=${range}`, { cache: "no-store" }).then((r) => r.json()),
        fetch("/api/owner/overview", { cache: "no-store" }).then((r) => r.json()),
      ]);
      setRev((an.restaurantRevenue || []).slice().sort((a: RevRow, b: RevRow) => b.revenue - a.revenue));
      setOpenTables(ov?.totals?.openTables ?? 0);
    } catch { /* leave empty */ }
    setLoaded(true);
  }, [range]);
  useEffect(() => { load(); }, [load]);

  const totals = useMemo(() => ({
    revenue: rev.reduce((a, r) => a + r.revenue, 0),
    orders: rev.reduce((a, r) => a + r.orders, 0),
    avg: (() => { const o = rev.reduce((a, r) => a + r.orders, 0); const v = rev.reduce((a, r) => a + r.revenue, 0); return o ? v / o : 0; })(),
  }), [rev]);
  const now = new Date();

  return (
    <div className="rep-wrap">
      {/* Controls (hidden in print) */}
      <div className="rep-controls">
        <div className="rep-range">
          {(Object.keys(RANGE_LABEL) as Range[]).map((k) => (
            <button key={k} className={range === k ? "on" : ""} onClick={() => setRange(k)}>{RANGE_LABEL[k]}</button>
          ))}
        </div>
        <button className="rep-print" onClick={() => window.print()}><i className="fas fa-print" /> Print / Save PDF</button>
      </div>

      {/* The printable document */}
      <div className="rep-doc">
        <div className="rep-head">
          <div className="rep-brand"><span className="rep-mark">✦</span><b>Aevidine</b></div>
          <div className="rep-meta">
            <div className="rep-title">Earnings report</div>
            <div className="rep-sub">{RANGE_LABEL[range]} · generated {now.toLocaleString("en-IN")}</div>
          </div>
        </div>

        <div className="rep-kpis">
          <div><div className="k">Total revenue</div><div className="v">{inr(totals.revenue)}</div></div>
          <div><div className="k">Orders</div><div className="v">{totals.orders.toLocaleString("en-IN")}</div></div>
          <div><div className="k">Avg order</div><div className="v">{inr(totals.avg)}</div></div>
          <div><div className="k">Restaurants</div><div className="v">{rev.length}</div></div>
          <div><div className="k">Open tables now</div><div className="v">{openTables}</div></div>
        </div>

        <div className="rep-section">Revenue by restaurant</div>
        <table className="rep-table">
          <thead><tr><th>#</th><th>Restaurant</th><th className="num">Orders</th><th className="num">Revenue</th><th className="num">Share</th></tr></thead>
          <tbody>
            {!loaded && <tr><td colSpan={5} className="rep-empty">Loading…</td></tr>}
            {loaded && rev.length === 0 && <tr><td colSpan={5} className="rep-empty">No sales in this range.</td></tr>}
            {rev.map((r, i) => (
              <tr key={r.id}>
                <td>{i + 1}</td><td>{r.name}</td>
                <td className="num">{r.orders.toLocaleString("en-IN")}</td>
                <td className="num">{inr(r.revenue)}</td>
                <td className="num">{totals.revenue ? Math.round((r.revenue / totals.revenue) * 100) : 0}%</td>
              </tr>
            ))}
          </tbody>
          {rev.length > 0 && (
            <tfoot><tr><td></td><td><b>Total</b></td><td className="num"><b>{totals.orders.toLocaleString("en-IN")}</b></td><td className="num"><b>{inr(totals.revenue)}</b></td><td className="num"><b>100%</b></td></tr></tfoot>
          )}
        </table>

        <div className="rep-foot">Aevidine · Restaurant OS — figures are net of discounts, exclude cancelled orders. Revenue in ₹.</div>
      </div>

      <style jsx>{`
        .rep-wrap { max-width: 900px; margin: 0 auto; }
        .rep-controls { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 18px; flex-wrap: wrap; }
        .rep-range { display: inline-flex; background: var(--card); border: var(--border); border-radius: 10px; padding: 3px; gap: 2px; }
        .rep-range button { background: none; border: none; padding: 7px 13px; border-radius: 7px; font: inherit; font-size: 12.5px; font-weight: 700; color: var(--muted); cursor: pointer; }
        .rep-range button.on { background: var(--accent); color: #fff; }
        .rep-print { display: inline-flex; align-items: center; gap: 8px; background: var(--accent); color: #fff; border: none; border-radius: 10px; padding: 10px 16px; font: inherit; font-weight: 700; font-size: 13.5px; cursor: pointer; }
        .rep-doc { background: var(--card); border: var(--border); border-radius: 16px; padding: 30px 32px; }
        .rep-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding-bottom: 18px; border-bottom: 2px solid var(--accent); }
        .rep-brand { display: flex; align-items: center; gap: 8px; font-size: 19px; font-weight: 800; }
        .rep-mark { color: var(--accent); }
        .rep-meta { text-align: right; }
        .rep-title { font-size: 16px; font-weight: 800; }
        .rep-sub { font-size: 12px; color: var(--muted); margin-top: 2px; }
        .rep-kpis { display: grid; grid-template-columns: repeat(5, 1fr); gap: 14px; margin: 22px 0; }
        .rep-kpis .k { font-size: 11px; color: var(--muted); }
        .rep-kpis .v { font-size: 20px; font-weight: 800; margin-top: 3px; font-variant-numeric: tabular-nums; }
        .rep-section { font-size: 13px; font-weight: 800; margin: 8px 0 10px; }
        .rep-table { width: 100%; border-collapse: collapse; font-size: 13px; }
        .rep-table th, .rep-table td { padding: 9px 8px; border-bottom: 1px solid var(--muted2, rgba(128,128,128,.18)); text-align: left; }
        .rep-table th { font-size: 11px; text-transform: uppercase; letter-spacing: .03em; color: var(--muted); font-weight: 700; }
        .rep-table .num { text-align: right; font-variant-numeric: tabular-nums; }
        .rep-table tfoot td { border-top: 2px solid var(--muted2, rgba(128,128,128,.3)); border-bottom: none; }
        .rep-empty { text-align: center; color: var(--muted); padding: 18px; }
        .rep-foot { margin-top: 20px; padding-top: 14px; border-top: var(--border); font-size: 11px; color: var(--muted); }
        @media (max-width: 720px) { .rep-kpis { grid-template-columns: repeat(2, 1fr); } }
      `}</style>
    </div>
  );
}
