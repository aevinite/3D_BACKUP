"use client";
// Admin · Settings — the owner-only switches that aren't features: the guest-menu
// maintenance mode, how long logs are kept, and the restaurant identity.
import { useCallback, useEffect, useState } from "react";

const RET_OPTS = [{ d: 7, label: "7 days" }, { d: 30, label: "1 month" }, { d: 90, label: "3 months" }];

export default function AdminSettings() {
  const [maint, setMaint] = useState<boolean | null>(null);
  const [ret, setRet] = useState<{ oplog_retention_days: number; custlog_retention_days: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const loadMaint = useCallback(async () => {
    try { const j = await (await fetch("/api/admin/overview", { cache: "no-store" })).json(); if (!j.error) setMaint(!!j.maintenance); } catch {}
  }, []);
  const loadRet = useCallback(async () => {
    try { const j = await (await fetch("/api/admin/settings", { cache: "no-store" })).json(); if (!j.error) setRet(j); } catch {}
  }, []);
  useEffect(() => { loadMaint(); loadRet(); }, [loadMaint, loadRet]);

  const toggleMaint = async () => {
    if (maint === null) return;
    const turningOn = !maint;
    const ok = window.confirm(turningOn
      ? "Put the guest menu into maintenance (“we’ll be right back”)? Guests can’t browse or order until you turn it back on."
      : "Bring the guest menu back online?");
    if (!ok) return;
    setBusy(true);
    try {
      await fetch("/api/admin/maintenance", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ on: turningOn }) });
      await loadMaint();
    } finally { setBusy(false); }
  };

  const saveRet = async (which: "oplog_retention_days" | "custlog_retention_days", val: number) => {
    setRet((r) => (r ? { ...r, [which]: val } : r));
    setMsg("");
    try {
      const r = await fetch("/api/admin/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ [which]: val }) });
      if (!r.ok) throw new Error();
      setMsg("Saved — old logs auto-delete after the chosen window.");
    } catch { setMsg("Couldn't save that just now."); }
  };

  return (
    <>
      <h1 className="adm-page-h">Settings</h1>
      <p className="adm-page-sub">Maintenance, how long logs are kept, and your restaurant.</p>

      <div className="adm-grid2" style={{ marginBottom: 14 }}>
        <div className="adm-card">
          <h2>Guest menu</h2>
          <p className="hint">Take the guest menu offline with a &ldquo;we&rsquo;ll be right back&rdquo; screen. Staff panels keep working.</p>
          <button className={`adm-btn ${maint ? "ok" : "danger"}`} style={{ width: "100%" }} disabled={maint === null || busy} onClick={toggleMaint}>
            {maint === null ? "…" : maint ? "Bring menu back online" : "Take menu offline"}
          </button>
          {maint && <p className="adm-muted" style={{ fontSize: 12, marginTop: 10 }}>⚠ The menu is currently offline.</p>}
        </div>

        <div className="adm-card">
          <h2>Log retention</h2>
          <p className="hint">Logs older than this are deleted automatically each night. Bills are never touched.</p>
          <div style={{ display: "grid", gap: 12 }}>
            <label className="adm-ret" style={{ justifyContent: "space-between" }}>
              <span>Operations log</span>
              <select value={ret?.oplog_retention_days ?? 90} disabled={!ret} onChange={(e) => saveRet("oplog_retention_days", Number(e.target.value))}>
                {RET_OPTS.map((o) => <option key={o.d} value={o.d}>{o.label}</option>)}
              </select>
            </label>
            <label className="adm-ret" style={{ justifyContent: "space-between" }}>
              <span>Customer log</span>
              <select value={ret?.custlog_retention_days ?? 90} disabled={!ret} onChange={(e) => saveRet("custlog_retention_days", Number(e.target.value))}>
                {RET_OPTS.map((o) => <option key={o.d} value={o.d}>{o.label}</option>)}
              </select>
            </label>
          </div>
          {msg && <p className="adm-muted" style={{ fontSize: 12, marginTop: 10 }}>{msg}</p>}
        </div>
      </div>

      <div className="adm-card">
        <h2>Restaurant</h2>
        <p className="hint">This control room currently manages one restaurant. Managing several from here is coming later.</p>
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderRadius: 12, border: "var(--border)", background: "var(--bg)" }}>
          <span style={{ width: 34, height: 34, borderRadius: 10, background: "var(--accent-grad, var(--accent))", display: "grid", placeItems: "center" }}>🏠</span>
          <div style={{ flex: 1 }}>
            <b>My Little French House</b>
            <div className="adm-muted" style={{ fontSize: 12 }}>All-Day Café &amp; Bakery</div>
          </div>
          <span className="adm-chip" style={{ background: "color-mix(in srgb, var(--adm-ok) 20%, transparent)", color: "var(--adm-ok)" }}>active</span>
        </div>
      </div>
    </>
  );
}
