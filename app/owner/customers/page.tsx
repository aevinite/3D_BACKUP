"use client";
// Owner · Customers — the guest list built from the `customers` table (name, phone,
// first/last seen), scoped server-side to the owner's restaurants and gated by the
// admin-controlled "customers" entitlement. READ-ONLY and money-free. A 60s backstop
// refresh (paused while hidden) keeps it fresh without a faster poll (egress rule).
import { useCallback, useEffect, useRef, useState } from "react";

const IST = "Asia/Kolkata";
type Customer = {
  restaurant_id: string; restaurantName: string; phone: string; name: string | null;
  blocked: boolean; first_seen_at: string; last_seen_at: string; returning: boolean;
};
type Summary = { total: number; returning: number; newThisMonth: number; blocked: number; shown: number };

const fmt = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: IST });

export default function OwnerCustomers() {
  const [scopePin] = useState<string | null>(() =>
    typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("rid"));

  const [customers, setCustomers] = useState<Customer[] | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [disabled, setDisabled] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const searchRef = useRef(search); searchRef.current = search;

  const load = useCallback(async () => {
    try {
      const s = searchRef.current.trim();
      const qs = [scopePin ? `scope=${scopePin}` : "", s ? `q=${encodeURIComponent(s)}` : ""].filter(Boolean).join("&");
      const j = await (await fetch(`/api/owner/customers${qs ? `?${qs}` : ""}`, { cache: "no-store" })).json();
      if (j.disabled) { setDisabled(true); return; }
      if (j.error) throw new Error(j.error);
      setCustomers(j.customers || []); setSummary(j.summary || null); setErr(null);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }, [scopePin]);

  // First load is immediate; later reloads (as the owner types) are debounced. A single
  // effect handles both so mount doesn't fire TWO back-to-back requests (audit 2026-07-09).
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) { firstRun.current = false; load(); return; }
    const t = setTimeout(() => load(), 350);
    return () => clearTimeout(t);
  }, [search, load]);

  // 60s backstop refresh, paused while the tab is hidden (egress-safe).
  useEffect(() => {
    let t: ReturnType<typeof setInterval> | null = null;
    const start = () => { if (!t) t = setInterval(() => { if (!document.hidden) load(); }, 60_000); };
    const stop = () => { if (t) { clearInterval(t); t = null; } };
    const onVis = () => { if (document.hidden) stop(); else { load(); start(); } };
    start(); document.addEventListener("visibilitychange", onVis);
    return () => { stop(); document.removeEventListener("visibilitychange", onVis); };
  }, [load]);

  const rows = customers || [];

  return (
    <>
      <h1 className="adm-page-h">Customers</h1>
      <p className="adm-page-sub">The guests who&apos;ve dined with you — when they first came, when they were last in, and who keeps coming back.</p>

      {disabled ? (
        <div className="adm-card"><div className="adm-empty">Customers isn&apos;t enabled for your restaurant — contact Aevidine.</div></div>
      ) : (
        <>
          {/* Summary tiles */}
          <div className="adm-stats" style={{ marginBottom: 14 }}>
            <div className="adm-stat"><div className="k">Total customers</div><div className="v">{summary ? summary.total.toLocaleString("en-IN") : "…"}</div></div>
            <div className="adm-stat"><div className="k">Regulars (came back)</div><div className="v">{summary ? summary.returning.toLocaleString("en-IN") : "…"}</div></div>
            <div className="adm-stat"><div className="k">New (last 30 days)</div><div className="v">{summary ? summary.newThisMonth.toLocaleString("en-IN") : "…"}</div></div>
            <div className="adm-stat"><div className="k">Blocked</div><div className="v">{summary ? summary.blocked.toLocaleString("en-IN") : "…"}</div></div>
          </div>

          <div className="adm-card">
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
              <input className="adm-input" style={{ flex: 1, minWidth: 200 }} placeholder="Search by name or phone…"
                value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search customers" />
              <button className="adm-btn" onClick={() => load()}><i className="fas fa-rotate" aria-hidden="true" /> Refresh</button>
            </div>

            {err && (
              <div className="adm-card" style={{ borderColor: "var(--adm-danger)", margin: "0 0 12px" }}>
                <b>Couldn&apos;t load.</b> <span className="adm-muted" style={{ fontSize: 12.5 }}>{err}</span>{" "}
                <button className="adm-btn" style={{ marginLeft: 6 }} onClick={() => load()}>Try again</button>
              </div>
            )}

            {customers === null && !err ? (
              <div className="adm-empty">Loading customers…</div>
            ) : rows.length === 0 ? (
              <div className="adm-empty">{search ? "No customers match that search." : "No customers yet. They appear here once guests dine in and share a name/phone."}</div>
            ) : (
              <div className="adm-tablewrap" style={{ overflow: "auto" }}>
                <table className="adm-table" style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ textAlign: "left", fontSize: 12, color: "var(--muted)" }}>
                      <th style={{ padding: "8px 10px" }}>Name</th>
                      <th style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>Phone</th>
                      <th style={{ padding: "8px 10px" }}>Restaurant</th>
                      <th style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>First visit</th>
                      <th style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>Last visit</th>
                      <th style={{ padding: "8px 10px" }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((c) => (
                      <tr key={`${c.restaurant_id}:${c.phone}`} style={{ borderTop: "1px solid var(--border,#e5e7eb)", opacity: c.blocked ? 0.65 : 1 }}>
                        <td style={{ padding: "9px 10px", fontWeight: 700 }}>{c.name || <span className="adm-muted">Guest</span>}</td>
                        <td style={{ padding: "9px 10px", whiteSpace: "nowrap", fontFamily: "ui-monospace, monospace", fontSize: 12.5 }}>{c.phone || "—"}</td>
                        <td style={{ padding: "9px 10px" }}><span className="adm-chip">{c.restaurantName}</span></td>
                        <td style={{ padding: "9px 10px", whiteSpace: "nowrap", fontSize: 12.5 }}>{fmt(c.first_seen_at)}</td>
                        <td style={{ padding: "9px 10px", whiteSpace: "nowrap", fontSize: 12.5 }}>{fmt(c.last_seen_at)}</td>
                        <td style={{ padding: "9px 10px" }}>
                          {c.blocked ? <span className="adm-chip" style={{ background: "color-mix(in srgb, var(--adm-danger,#e5484d) 16%, transparent)", color: "var(--adm-danger,#e5484d)" }}>blocked</span>
                            : c.returning ? <span className="adm-chip" style={{ background: "color-mix(in srgb, var(--adm-ok,#16a34a) 16%, transparent)", color: "var(--adm-ok,#16a34a)" }}>regular</span>
                            : <span className="adm-chip">new</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {/* Only the UNFILTERED list is "the N most-recent of TOTAL" — during a search the
                    rows are matches, not the most-recent, and total is the whole-list head-count, so
                    the line would be misleading (audit 2026-07-09). Show a plain match count instead. */}
                {search ? (
                  <div className="adm-muted" style={{ fontSize: 12, marginTop: 10 }}>
                    {rows.length} match{rows.length === 1 ? "" : "es"} for “{search.trim()}”.
                  </div>
                ) : summary && summary.total > summary.shown ? (
                  <div className="adm-muted" style={{ fontSize: 12, marginTop: 10 }}>
                    Showing the {summary.shown} most-recent of {summary.total.toLocaleString("en-IN")}. Search to find an older guest.
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}
