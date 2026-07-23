"use client";
// Admin · Bill audit — a read-only trail of every bill change across all restaurants
// (paid / deleted / discounted / reverted / closed-unpaid / moved), from the activity log.
// Emphasises removals & reverts (tamper-risk). Money redacted (admin sees no ₹). Safe v1 of
// the tamper-proof log — no triggers, no new table. From /api/admin/bill-audit.
import { useCallback, useEffect, useState } from "react";
import { useActiveAutoRefresh, timeAgo } from "@/components/admin/shared";

type Row = { id: string; action: string; restaurantName: string; table: string | null; actor: string; detail: string | null; at: string; risk: boolean };
type Rest = { id: string; name: string };
type Data = { rows: Row[]; riskCount: number; restaurants: Rest[]; generatedAt: string };

const ACT: Record<string, { t: string; risk: boolean }> = {
  order_delete: { t: "Bill deleted", risk: true },
  payment_revert: { t: "Payment reverted", risk: true },
  close_unpaid: { t: "Closed unpaid", risk: true },
  order_discount: { t: "Discount applied", risk: false },
  order_move: { t: "Order moved", risk: false },
  table_shift: { t: "Table moved", risk: false },
  // Admin Repair-Kit surgery (the route returns these too) — without labels they showed as
  // raw snake_case; risk flags mirror the server's RISK set (audit 2026-07-23).
  repair_void_bill: { t: "Bill voided (repair)", risk: true },
  repair_delete_order: { t: "Order deleted (repair)", risk: true },
  repair_edit_time: { t: "Order time edited (repair)", risk: true },
  repair_refire_order: { t: "Order re-fired (repair)", risk: false },
};

export default function AdminBillAudit() {
  const [d, setD] = useState<Data | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [type, setType] = useState<"all" | "risk">("all");
  const [rid, setRid] = useState<string>("");

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const qs = new URLSearchParams();
      if (type === "risk") qs.set("type", "risk");
      if (rid) qs.set("restaurant_id", rid);
      const res = await fetch("/api/admin/bill-audit?" + qs.toString(), { cache: "no-store" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Couldn't load.");
      setD(j);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setLoading(false); }
  }, [type, rid]);
  useEffect(() => { load(); }, [load]);
  useActiveAutoRefresh(load, 60000);

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 className="adm-page-h" style={{ marginBottom: 0 }}>Bill audit</h1>
          <p className="adm-page-sub" style={{ marginTop: 4 }}>Bill changes across all restaurants — deleted, reverted, closed-unpaid, discounted, moved. Read-only from the activity log (payments live on Revenue &amp; Billing); a fully un-editable ledger is a later add.</p>
        </div>
        <button className="adm-btn" disabled={loading} onClick={load}>
          <i className={`fas fa-rotate-right${loading ? " fa-spin" : ""}`} style={{ marginRight: 7 }} aria-hidden="true" />Refresh
        </button>
      </div>

      {err && <p style={{ color: "var(--adm-danger)", fontSize: 13 }}>{err} <button className="adm-btn" style={{ marginLeft: 8 }} onClick={load}>Retry</button></p>}

      {d && (
        <div className="adm-card" style={{ marginBottom: 12, display: "flex", alignItems: "center", gap: 10, borderColor: d.riskCount > 0 ? "var(--adm-danger)" : undefined }}>
          <i className={`fas ${d.riskCount > 0 ? "fa-triangle-exclamation" : "fa-shield-halved"}`} style={{ color: d.riskCount > 0 ? "var(--adm-danger)" : "var(--adm-ok)" }} aria-hidden="true" />
          <span style={{ fontSize: 13 }}>{d.riskCount > 0 ? <><b>{d.riskCount}</b> bill removal{d.riskCount === 1 ? "" : "s"}/revert{d.riskCount === 1 ? "" : "s"} in this view — worth a glance.</> : "No bill removals or reverts in this view."}</span>
        </div>
      )}

      {/* Filters */}
      <div className="adm-card" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        {(["all", "risk"] as const).map((k) => (
          <button key={k} className="adm-chip" onClick={() => setType(k)}
            style={{ cursor: "pointer", padding: "7px 12px", border: type === k ? "1px solid var(--accent)" : "var(--border)", background: type === k ? "color-mix(in srgb, var(--accent) 18%, transparent)" : "transparent", color: type === k ? "var(--accent)" : "var(--muted)", fontWeight: type === k ? 700 : 500 }}>
            {k === "all" ? "All changes" : "At-risk only (deletions & reverts)"}
          </button>
        ))}
        <select value={rid} onChange={(e) => setRid(e.target.value)} style={{ marginLeft: "auto", padding: "8px 10px", borderRadius: 8, border: "var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 13 }}>
          <option value="">All restaurants</option>
          {(d?.restaurants || []).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
      </div>

      <div className="adm-card" style={{ padding: 0, overflow: "hidden" }}>
        {!d ? <div className="adm-empty">{err ? "Couldn't load." : "Loading…"}</div> : d.rows.length === 0 ? (
          <div className="adm-empty">No bill changes recorded in this view.</div>
        ) : (
          // Reason column added 2026-07-23 (owner: "it should show WHY it was reverted").
          // Horizontal scroll (minWidth below) so the 6 columns don't crush on a phone.
          <div className="adm-logwrap" style={{ border: 0, overflowX: "auto" }}>
            <div className="adm-logrow head" style={{ gridTemplateColumns: "150px 1.1fr 60px 0.9fr 1.4fr 84px", minWidth: 720 }}>
              <span>Change</span><span>Restaurant</span><span>Table</span><span>By</span><span>Reason</span><span style={{ textAlign: "right" }}>When</span>
            </div>
            {d.rows.map((r) => {
              const a = ACT[r.action] || { t: r.action, risk: r.risk };
              return (
                <div key={r.id} className="adm-logrow" style={{ gridTemplateColumns: "150px 1.1fr 60px 0.9fr 1.4fr 84px", minWidth: 720, alignItems: "center" }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                    <span style={{ width: 7, height: 7, borderRadius: 999, background: a.risk ? "var(--adm-danger)" : "var(--muted)", flex: "0 0 auto" }} aria-hidden="true" />
                    <span style={{ fontWeight: 600, color: a.risk ? "var(--adm-danger)" : "var(--text)", fontSize: 12.5 }}>{a.t}</span>
                  </span>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.restaurantName}</span>
                  <span className="adm-muted">{r.table ? `#${r.table}` : "—"}</span>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} className="adm-muted">{r.actor}</span>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} className="adm-muted" title={r.detail || undefined}>{r.detail || "—"}</span>
                  <span style={{ textAlign: "right" }} className="adm-muted" title={r.at}>{timeAgo(r.at)}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
