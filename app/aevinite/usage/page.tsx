"use client";
// Admin · Usage & cost — which restaurants are busiest / heaviest to serve (order volume,
// active staff, configured tables). Order volume is a PROXY for how much a restaurant costs
// to serve (database reads + bandwidth). No food money here. Data from /api/admin/usage.
import { useCallback, useEffect, useState } from "react";
import { useActiveAutoRefresh } from "@/components/admin/shared";

type Row = { id: string; name: string; slug: string; orders7d: number; orders30d: number; staff: number; tables: number };
type Data = { rows: Row[]; totals: { orders7d: number; orders30d: number; staff: number; restaurants: number }; generatedAt: string };

const nf = (n: number) => (Number(n) || 0).toLocaleString("en-IN");

export default function AdminUsage() {
  const [d, setD] = useState<Data | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const res = await fetch("/api/admin/usage", { cache: "no-store" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Couldn't load usage.");
      setD(j);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useActiveAutoRefresh(load, 60000);

  const max = d ? Math.max(1, ...d.rows.map((r) => r.orders30d)) : 1;
  // "…" MEANS STILL LOADING. After a failed read it never resolves, so the four headline numbers
  // sat on an ellipsis for ever and the page looked like it was still working (T17 sweep,
  // 2026-08-19). A read that failed shows "—" — unknown — with the error line and Retry above it.
  const blank = err ? "—" : "…";
  const STATS: { k: string; v: string | number; hint?: string }[] = [
    { k: "Orders · 30 days", v: d ? nf(d.totals.orders30d) : blank, hint: "all restaurants" },
    { k: "Orders · 7 days", v: d ? nf(d.totals.orders7d) : blank, hint: "all restaurants" },
    { k: "Restaurants", v: d ? d.totals.restaurants : blank, hint: "live" },
    { k: "Staff (active)", v: d ? nf(d.totals.staff) : blank, hint: "across all" },
  ];

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 className="adm-page-h" style={{ marginBottom: 0 }}>Usage &amp; cost</h1>
          <p className="adm-page-sub" style={{ marginTop: 4 }}>Which restaurants are busiest — a proxy for how much each costs you to serve. No earnings shown.</p>
        </div>
        <button className="adm-btn" disabled={loading} onClick={load}>
          <i className={`fas fa-rotate-right${loading ? " fa-spin" : ""}`} style={{ marginRight: 7 }} aria-hidden="true" />Refresh
        </button>
      </div>

      {err && <p style={{ color: "var(--adm-danger)", fontSize: 13 }}>{err} <button className="adm-btn" style={{ marginLeft: 8 }} onClick={load}>Retry</button></p>}

      <div className="rev-strip adm-card" style={{ opacity: loading && d ? 0.6 : 1 }}>
        {STATS.map((s) => (
          <div key={s.k} className="cell">
            <span className="k">{s.k}</span>
            <span className="v">{s.v}</span>
            {s.hint && <span className="h">{s.hint}</span>}
          </div>
        ))}
      </div>

      <div className="adm-card">
        <h2 style={{ margin: "0 0 4px" }}>By restaurant</h2>
        <p className="hint" style={{ marginTop: 0 }}>Ranked by 30-day order volume. The bar shows each restaurant&apos;s share of the busiest one.</p>
        {!d ? <div className="adm-empty">{err ? "Couldn't load." : "Loading…"}</div> : d.rows.length === 0 ? (
          <div className="adm-empty">No restaurants yet.</div>
        ) : (
          <div className="adm-logwrap">
            <div className="adm-logrow head" style={{ gridTemplateColumns: "1.6fr 80px 1fr 70px 70px" }}>
              <span>Restaurant</span><span style={{ textAlign: "right" }}>7-day</span><span>30-day</span><span style={{ textAlign: "right" }}>Staff</span><span style={{ textAlign: "right" }}>Tables</span>
            </div>
            {d.rows.map((r) => (
              <div key={r.id} className="adm-logrow" style={{ gridTemplateColumns: "1.6fr 80px 1fr 70px 70px", alignItems: "center" }}>
                <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</span>
                <span style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }} className="adm-muted">{nf(r.orders7d)}</span>
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ flex: 1, height: 8, borderRadius: 999, background: "var(--muted2, rgba(255,255,255,.06))", overflow: "hidden" }}>
                    <span style={{ display: "block", height: "100%", width: `${Math.max((r.orders30d / max) * 100, r.orders30d > 0 ? 3 : 0)}%`, background: "var(--accent)", borderRadius: 999 }} />
                  </span>
                  <span style={{ width: 52, textAlign: "right", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{nf(r.orders30d)}</span>
                </span>
                <span style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }} className="adm-muted">{r.staff}</span>
                <span style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }} className="adm-muted">{r.tables}</span>
              </div>
            ))}
          </div>
        )}
        <p className="hint" style={{ marginTop: 10, marginBottom: 0 }}>
          <i className="fas fa-circle-info" style={{ marginRight: 6, opacity: 0.7 }} aria-hidden="true" />
          Order volume is the best cheap signal for load. Per-restaurant storage / bandwidth metering would need a usage-events table — a later add.
        </p>
      </div>

      <style href="adm-usage" precedence="default">{`
        .rev-strip { display: flex; flex-wrap: wrap; padding: 0; margin-bottom: 12px; }
        .rev-strip .cell { display: flex; flex-direction: column; gap: 3px; padding: 12px 18px; border-right: var(--border); flex: 1 1 auto; min-width: 150px; }
        .rev-strip .cell:last-child { border-right: 0; }
        .rev-strip .k { font-size: 11.5px; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); font-weight: 600; }
        .rev-strip .v { font-size: 22px; font-weight: 800; font-variant-numeric: tabular-nums; line-height: 1.1; }
        .rev-strip .h { font-size: 11px; color: var(--muted); }
      `}</style>
    </>
  );
}
