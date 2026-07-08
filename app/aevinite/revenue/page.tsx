"use client";
// Admin · Platform revenue — the operator's OWN business numbers (subscription income
// restaurants pay US). PLATFORM income is allowed here; restaurant FOOD revenue is not and
// never appears. All figures come from /api/admin/revenue (derived from restaurant_billing +
// restaurant_payments — no schema change). Dark ops-console theme, hand-rolled SVG chart.
import { useCallback, useEffect, useState } from "react";
import { useActiveAutoRefresh } from "@/components/admin/shared";

type Plan = { plan: string; mrr: number; count: number };
type Month = { month: string; label: string; collected: number };
type Paying = { name: string; plan: string; cycle: string; monthly: number; nextDue: string | null };
type Data = {
  currency: string; mrr: number; arr: number; nonInrActive: number; activeSubs: number;
  byStatus: Record<string, number>; mrrByPlan: Plan[];
  collectedThisYear: number; collectedAllTime: number; monthly: Month[]; paying: Paying[]; generatedAt: string;
};

const money = (n: number) => "₹" + Math.round(Number(n) || 0).toLocaleString("en-IN");
const STATUS_COLOR: Record<string, string> = { active: "var(--adm-ok)", trial: "var(--accent)", paused: "#d4a574", cancelled: "var(--adm-danger)" };
const STATUS_LABEL: Record<string, string> = { active: "Active (paying)", trial: "Trial", paused: "Paused", cancelled: "Cancelled" };

// Hand-rolled SVG area+line of "collected per month". Trend data → line; subtle gridlines,
// tabular hover values, an explicit empty state when there's nothing yet.
function CollectedChart({ data }: { data: Month[] }) {
  const W = 760, H = 190, padL = 10, padR = 10, padT = 16, padB = 26;
  const max = Math.max(1, ...data.map((d) => d.collected));
  const iw = W - padL - padR, ih = H - padT - padB;
  const x = (i: number) => padL + (data.length > 1 ? (i / (data.length - 1)) * iw : iw / 2);
  const y = (v: number) => padT + ih - (v / max) * ih;
  const line = data.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(d.collected).toFixed(1)}`).join(" ");
  const area = `${line} L${x(data.length - 1).toFixed(1)},${(padT + ih).toFixed(1)} L${x(0).toFixed(1)},${(padT + ih).toFixed(1)} Z`;
  const anyData = data.some((d) => d.collected > 0);
  if (!anyData) return <div className="adm-empty">No subscription payments recorded yet — record one on Billing &amp; plans.</div>;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Collected per month, last 12 months" style={{ display: "block" }}>
      {[0, 0.25, 0.5, 0.75, 1].map((f) => (
        <line key={f} x1={padL} x2={W - padR} y1={padT + ih - f * ih} y2={padT + ih - f * ih} stroke="var(--muted)" strokeWidth="1" opacity="0.16" />
      ))}
      <path d={area} fill="var(--accent)" opacity="0.14" />
      <path d={line} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {data.map((d, i) => (
        <circle key={d.month} cx={x(i)} cy={y(d.collected)} r="2.6" fill="var(--accent)"><title>{d.label}: {money(d.collected)}</title></circle>
      ))}
      {data.map((d, i) => (
        <text key={d.month} x={x(i)} y={H - 8} textAnchor="middle" fontSize="10" fill="var(--muted)">{d.label}</text>
      ))}
      <text x={padL} y={11} fontSize="10" fill="var(--muted)">peak {money(max)}</text>
    </svg>
  );
}

export default function AdminRevenue() {
  const [d, setD] = useState<Data | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const res = await fetch("/api/admin/revenue", { cache: "no-store" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Couldn't load revenue.");
      setD(j);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useActiveAutoRefresh(load, 60000);

  const statusMax = d ? Math.max(1, ...Object.values(d.byStatus)) : 1;
  const num = (v: number | undefined) => (v == null ? "…" : v);

  const STATS: { k: string; v: string | number; hint?: string; accent?: boolean }[] = [
    { k: "MRR", v: d ? money(d.mrr) : "…", hint: "monthly recurring", accent: true },
    { k: "ARR", v: d ? money(d.arr) : "…", hint: "yearly run-rate" },
    { k: "Active subscriptions", v: d ? num(d.activeSubs) : "…", hint: "paying now" },
    { k: "Collected this year", v: d ? money(d.collectedThisYear) : "…", hint: "payments in " + new Date().getFullYear() },
    { k: "Collected all-time", v: d ? money(d.collectedAllTime) : "…", hint: "every payment logged" },
  ];

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 className="adm-page-h" style={{ marginBottom: 0 }}>Platform revenue</h1>
          <p className="adm-page-sub" style={{ marginTop: 4 }}>Your subscription income — what restaurants pay you. Not their food sales.</p>
        </div>
        <button className="adm-btn" disabled={loading} onClick={load}>
          <i className={`fas fa-rotate-right${loading ? " fa-spin" : ""}`} style={{ marginRight: 7 }} aria-hidden="true" />Refresh
        </button>
      </div>

      {err && <p style={{ color: "var(--adm-danger)", fontSize: 13 }}>{err} <button className="adm-btn" style={{ marginLeft: 8 }} onClick={load}>Retry</button></p>}
      {d && d.nonInrActive > 0 && (
        <div className="adm-card" style={{ borderColor: "#d4a574", marginBottom: 12, fontSize: 12.5 }}>
          <i className="fas fa-circle-info" style={{ marginRight: 7, color: "#d4a574" }} aria-hidden="true" />
          {d.nonInrActive} active subscription{d.nonInrActive === 1 ? " is" : "s are"} in a non-₹ currency — those aren&apos;t added into MRR/ARR above (mixing currencies would be wrong).
        </div>
      )}

      {/* KPI strip */}
      <div className="rev-strip adm-card" style={{ opacity: loading && d ? 0.6 : 1 }}>
        {STATS.map((s) => (
          <div key={s.k} className="cell">
            <span className="k">{s.k}</span>
            <span className="v" style={s.accent ? { color: "var(--accent)" } : undefined}>{s.v}</span>
            {s.hint && <span className="h">{s.hint}</span>}
          </div>
        ))}
      </div>

      {/* Trend chart */}
      <div className="adm-card" style={{ marginBottom: 12 }}>
        <h2 style={{ margin: "0 0 2px" }}>Collected — last 12 months</h2>
        <p className="hint" style={{ marginTop: 0 }}>Real subscription payments recorded each month.</p>
        {d ? <CollectedChart data={d.monthly} /> : <div className="adm-empty">{err ? "Couldn't load." : "Loading…"}</div>}
      </div>

      <div className="adx-grid2col">
        {/* Subscriptions by status */}
        <div className="adm-card">
          <h2 style={{ margin: "0 0 10px" }}>Subscriptions by status</h2>
          {!d ? <div className="adm-empty">{err ? "Couldn't load." : "Loading…"}</div> : (
            <div style={{ display: "grid", gap: 10 }}>
              {(["active", "trial", "paused", "cancelled"] as const).map((st) => {
                const n = d.byStatus[st] || 0;
                return (
                  <div key={st} style={{ display: "grid", gridTemplateColumns: "120px 1fr 34px", gap: 10, alignItems: "center", fontSize: 13 }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 7 }}><span style={{ width: 8, height: 8, borderRadius: 999, background: STATUS_COLOR[st] }} />{STATUS_LABEL[st]}</span>
                    <span style={{ height: 8, borderRadius: 999, background: "var(--muted2, rgba(255,255,255,.06))", overflow: "hidden" }}>
                      <span style={{ display: "block", height: "100%", width: `${Math.max((n / statusMax) * 100, n > 0 ? 4 : 0)}%`, background: STATUS_COLOR[st], borderRadius: 999 }} />
                    </span>
                    <span style={{ textAlign: "right", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{n}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* MRR by plan */}
        <div className="adm-card">
          <h2 style={{ margin: "0 0 10px" }}>MRR by plan</h2>
          {!d ? <div className="adm-empty">{err ? "Couldn't load." : "Loading…"}</div> : d.mrrByPlan.length === 0 ? (
            <div className="adm-empty">No active paid plans yet.</div>
          ) : (
            <div className="adm-logwrap">
              <div className="adm-logrow head" style={{ gridTemplateColumns: "1fr 60px 100px" }}><span>Plan</span><span style={{ textAlign: "right" }}>Subs</span><span style={{ textAlign: "right" }}>MRR</span></div>
              {d.mrrByPlan.map((p) => (
                <div key={p.plan} className="adm-logrow" style={{ gridTemplateColumns: "1fr 60px 100px" }}>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.plan}</span>
                  <span style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{p.count}</span>
                  <span style={{ textAlign: "right", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{money(p.mrr)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Paying restaurants */}
      <div className="adm-card" style={{ marginTop: 12 }}>
        <h2 style={{ margin: "0 0 10px" }}>Paying restaurants</h2>
        {!d ? <div className="adm-empty">{err ? "Couldn't load." : "Loading…"}</div> : d.paying.length === 0 ? (
          <div className="adm-empty">No active paying subscriptions yet — set a plan on Billing &amp; plans.</div>
        ) : (
          <div className="adm-logwrap">
            <div className="adm-logrow head" style={{ gridTemplateColumns: "1.4fr 1fr 80px 110px 120px" }}>
              <span>Restaurant</span><span>Plan</span><span>Cycle</span><span style={{ textAlign: "right" }}>Monthly</span><span style={{ textAlign: "right" }}>Next due</span>
            </div>
            {d.paying.map((r, i) => (
              <div key={i} className="adm-logrow" style={{ gridTemplateColumns: "1.4fr 1fr 80px 110px 120px" }}>
                <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</span>
                <span className="adm-muted" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.plan}</span>
                <span className="adm-muted">{r.cycle === "monthly" ? "Monthly" : "Yearly"}</span>
                <span style={{ textAlign: "right", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{money(r.monthly)}</span>
                <span style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }} className="adm-muted">{r.nextDue || "—"}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <style jsx>{`
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
