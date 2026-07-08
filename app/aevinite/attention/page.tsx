"use client";
// Admin · At-risk — the "who needs you" list (account-health, feature #11). Two derived
// signals: paying restaurants that have gone idle (churn risk), and new restaurants that
// never got going. From /api/admin/attention (billing + usage + created_at, no new table).
import { useCallback, useEffect, useState } from "react";
import { useActiveAutoRefresh } from "@/components/admin/shared";

type Risk = { id: string; name: string; slug: string; plan: string | null; reason: string };
type Onb = { id: string; name: string; slug: string; ageDays: number; reason: string };
type Data = { atRisk: Risk[]; onboarding: Onb[]; generatedAt: string };

export default function AdminAttention() {
  const [d, setD] = useState<Data | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const res = await fetch("/api/admin/attention", { cache: "no-store" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Couldn't load.");
      setD(j);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useActiveAutoRefresh(load, 60000);

  const manage = (slug: string) => `/aevinite/restaurants?focus=${encodeURIComponent(slug)}`;

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 className="adm-page-h" style={{ marginBottom: 0 }}>At-risk &amp; onboarding</h1>
          <p className="adm-page-sub" style={{ marginTop: 4 }}>Restaurants that need a nudge — paying but idle (churn risk), and new ones that haven&apos;t started.</p>
        </div>
        <button className="adm-btn" disabled={loading} onClick={load}>
          <i className={`fas fa-rotate-right${loading ? " fa-spin" : ""}`} style={{ marginRight: 7 }} aria-hidden="true" />Refresh
        </button>
      </div>

      {err && <p style={{ color: "var(--adm-danger)", fontSize: 13 }}>{err} <button className="adm-btn" style={{ marginLeft: 8 }} onClick={load}>Retry</button></p>}

      {/* At-risk (churn) */}
      <div className="adm-card">
        <div className="cmd-sec" style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 10 }}>
          <i className="fas fa-triangle-exclamation" style={{ color: "var(--adm-danger)" }} aria-hidden="true" />
          Churn risk <span style={{ color: "var(--muted)", fontWeight: 500, textTransform: "none", letterSpacing: 0 }}>· paying but not ordering</span>
        </div>
        {!d ? <div className="adm-empty">{err ? "Couldn't load." : "Loading…"}</div> : d.atRisk.length === 0 ? (
          <div className="adm-empty">✅ Nothing at risk — every paying restaurant is ordering.</div>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {d.atRisk.map((r) => (
              <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "10px 0", borderBottom: "var(--border)" }}>
                <span style={{ width: 8, height: 8, borderRadius: 999, background: "var(--adm-danger)", flex: "0 0 auto" }} aria-hidden="true" />
                <b style={{ fontSize: 14 }}>{r.name}</b>
                {r.plan && <span className="adm-chip" style={{ fontSize: 11 }}>{r.plan}</span>}
                <span className="adm-muted" style={{ fontSize: 12.5 }}>{r.reason}</span>
                <a className="adm-btn" style={{ marginLeft: "auto" }} href={manage(r.slug)}>Manage <i className="fas fa-arrow-right" style={{ fontSize: 10, marginLeft: 4 }} aria-hidden="true" /></a>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Onboarding */}
      <div className="adm-card" style={{ marginTop: 12 }}>
        <div className="cmd-sec" style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 10 }}>
          <i className="fas fa-seedling" style={{ color: "#60a5fa" }} aria-hidden="true" />
          Needs onboarding <span style={{ color: "var(--muted)", fontWeight: 500, textTransform: "none", letterSpacing: 0 }}>· new, no orders yet</span>
        </div>
        {!d ? <div className="adm-empty">{err ? "Couldn't load." : "Loading…"}</div> : d.onboarding.length === 0 ? (
          <div className="adm-empty">No stalled new restaurants — recent sign-ups are all ordering.</div>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {d.onboarding.map((r) => (
              <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "10px 0", borderBottom: "var(--border)" }}>
                <span style={{ width: 8, height: 8, borderRadius: 999, background: "#60a5fa", flex: "0 0 auto" }} aria-hidden="true" />
                <b style={{ fontSize: 14 }}>{r.name}</b>
                <span className="adm-muted" style={{ fontSize: 12.5 }}>{r.reason}</span>
                <a className="adm-btn" style={{ marginLeft: "auto" }} href={manage(r.slug)}>Set up <i className="fas fa-arrow-right" style={{ fontSize: 10, marginLeft: 4 }} aria-hidden="true" /></a>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
