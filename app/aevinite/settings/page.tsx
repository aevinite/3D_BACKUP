"use client";
// Admin · Settings — the owner-only switches that aren't features: the guest-menu
// maintenance mode, how long logs are kept, and the restaurant identity.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

const RET_OPTS = [{ d: 7, label: "7 days" }, { d: 30, label: "1 month" }, { d: 90, label: "3 months" }];

export default function AdminSettings() {
  const [maint, setMaint] = useState<boolean | null>(null);
  const [ret, setRet] = useState<{ oplog_retention_days: number; custlog_retention_days: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  // Load-error flags so a failed fetch shows a Retry instead of a button stuck on "…"
  // / dropdowns disabled forever (bug #7, 2026-07-06).
  const [maintErr, setMaintErr] = useState(false);
  const [retErr, setRetErr] = useState(false);

  const loadMaint = useCallback(async () => {
    // flagshipMaintenance = the flagship's OWN service_mode. The old `maintenance` field is
    // platform-wide ("any restaurant offline"), which made this flagship toggle show the
    // wrong state / look stuck whenever a different tenant was in maintenance (audit 2026-07-07).
    try { const j = await (await fetch("/api/admin/overview", { cache: "no-store" })).json(); if (j.error) setMaintErr(true); else { setMaint(!!j.flagshipMaintenance); setMaintErr(false); } } catch { setMaintErr(true); }
  }, []);
  const loadRet = useCallback(async () => {
    try { const j = await (await fetch("/api/admin/settings", { cache: "no-store" })).json(); if (j.error) setRetErr(true); else { setRet(j); setRetErr(false); } } catch { setRetErr(true); }
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
    } catch { setMsg("Couldn't save that just now."); loadRet(); /* revert the dropdown to server truth (bug #15) */ }
  };

  return (
    <>
      <h1 className="adm-page-h">Settings</h1>
      <p className="adm-page-sub">Maintenance, how long logs are kept, and your restaurant.</p>

      <div className="adm-grid2" style={{ marginBottom: 14 }}>
        <div className="adm-card">
          <h2>Guest menu · <span className="adm-muted">My Little French House</span></h2>
          <p className="hint">Puts the <b>flagship restaurant&rsquo;s</b> guest menu behind a &ldquo;we&rsquo;ll be right back&rdquo; screen. Staff panels keep working. To take <b>another</b> restaurant offline, open it in Restaurants and use <b>Suspend</b>.</p>
          {maintErr ? (
            <button className="adm-btn" style={{ width: "100%" }} onClick={loadMaint}>Couldn&rsquo;t load — Retry</button>
          ) : (
            <button className={`adm-btn ${maint ? "ok" : "danger"}`} style={{ width: "100%" }} disabled={maint === null || busy} onClick={toggleMaint}>
              {maint === null ? "…" : maint ? "Bring menu back online" : "Take menu offline"}
            </button>
          )}
          {maint && !maintErr && <p className="adm-muted" style={{ fontSize: 12, marginTop: 10 }}>⚠ The flagship menu is currently offline.</p>}
        </div>

        <div className="adm-card">
          <h2>Log retention <span className="adm-muted">· platform-wide</span></h2>
          <p className="hint">Applies to the admin activity &amp; customer logs across all restaurants. Older entries are deleted automatically each night. Bills are never touched.</p>
          {retErr && <p className="adm-muted" style={{ fontSize: 12, marginBottom: 8 }}>Couldn&rsquo;t load retention. <button className="adm-btn" style={{ marginLeft: 6 }} onClick={loadRet}>Retry</button></p>}
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
        <h2>Restaurants</h2>
        <p className="hint">Each restaurant&rsquo;s identity, branding, guest features, panels and suspend/delete are managed on its own page.</p>
        <Link href="/aevinite/restaurants" className="adm-btn" style={{ display: "inline-flex", marginTop: 4 }}>
          Manage restaurants
        </Link>
      </div>
    </>
  );
}
