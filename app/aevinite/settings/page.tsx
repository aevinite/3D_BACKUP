"use client";
// Admin · Settings — platform-level info + the PLATFORM DEFAULT log retention. Guest-menu
// maintenance is per-restaurant (each restaurant's own page). Log retention is genuinely
// platform-wide now: migration 157 made lfh_prune_logs use this id='site' value as the DEFAULT
// for any restaurant that hasn't set its own window (a restaurant's own manager setting still
// wins). The old control here was a lie (only affected restaurant #1) until 157 wired the
// default for real; #279 removed the misleading version, this restores it as a true control.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

const RET_OPTS = [{ d: 7, label: "7 days" }, { d: 30, label: "1 month" }, { d: 90, label: "3 months" }];

export default function AdminSettings() {
  const [ret, setRet] = useState<{ oplog_retention_days: number; custlog_retention_days: number } | null>(null);
  const [retErr, setRetErr] = useState(false);
  const [msg, setMsg] = useState("");

  const loadRet = useCallback(async () => {
    try {
      const j = await (await fetch("/api/admin/settings", { cache: "no-store" })).json();
      if (j.error) setRetErr(true); else { setRet(j); setRetErr(false); }
    } catch { setRetErr(true); }
  }, []);
  useEffect(() => { loadRet(); }, [loadRet]);

  const saveRet = async (which: "oplog_retention_days" | "custlog_retention_days", val: number) => {
    setRet((r) => (r ? { ...r, [which]: val } : r));
    setMsg("");
    try {
      const r = await fetch("/api/admin/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ [which]: val }) });
      if (!r.ok) throw new Error();
      setMsg("Saved — the default for restaurants that haven't set their own.");
    } catch { setMsg("Couldn't save that just now."); loadRet(); }
  };

  return (
    <>
      <h1 className="adm-page-h">Settings</h1>
      <p className="adm-page-sub">Platform-level settings — everything else is managed on each restaurant&rsquo;s own page.</p>

      <div className="adx-grid2col" style={{ marginBottom: 14 }}>
        <div className="adm-card">
          <h2>Platform</h2>
          <p className="hint">Aevidine · Restaurant OS — your control room for every restaurant on this backend.</p>
          <div className="adm-logwrap" style={{ marginTop: 6 }}>
            <div className="adm-logrow" style={{ gridTemplateColumns: "1fr auto" }}><span>Environment</span><span style={{ fontWeight: 700, color: "var(--adm-ok)" }}>Production</span></div>
            <div className="adm-logrow" style={{ gridTemplateColumns: "1fr auto" }}><span>You&rsquo;re signed in as</span><span className="adm-muted">Platform admin</span></div>
            <div className="adm-logrow" style={{ gridTemplateColumns: "1fr auto" }}><span>Guest-menu maintenance</span><span className="adm-muted">per restaurant</span></div>
          </div>
          <p className="hint" style={{ marginTop: 10, marginBottom: 0 }}>To put a restaurant&rsquo;s menu into a &ldquo;we&rsquo;ll be right back&rdquo; state, open it on the <b>Restaurants</b> page and use its <b>Maintenance</b> toggle (or <b>Suspend</b> to take it fully offline).</p>
        </div>

        <div className="adm-card">
          <h2>Log retention <span className="adm-muted">· platform default</span></h2>
          <p className="hint">The default window for keeping the activity &amp; customer logs. It applies to any restaurant that hasn&rsquo;t chosen its own — a restaurant&rsquo;s own manager setting takes priority. Older entries auto-delete each night; bills are never touched.</p>
          {retErr && <p className="adm-muted" style={{ fontSize: 12, marginBottom: 8 }}>Couldn&rsquo;t load retention. <button className="adm-btn" style={{ marginLeft: 6 }} onClick={loadRet}>Retry</button></p>}
          <div style={{ display: "grid", gap: 12 }}>
            <label className="adm-ret" style={{ justifyContent: "space-between" }}>
              <span>Operations log</span>
              <select value={ret?.oplog_retention_days ?? 90} disabled={!ret} onChange={(e) => saveRet("oplog_retention_days", Number(e.target.value))}>
                {RET_OPTS.map((o) => <option key={o.d} value={o.d}>{o.label}</option>)}
                {ret && !RET_OPTS.some((o) => o.d === ret.oplog_retention_days) && <option value={ret.oplog_retention_days}>{ret.oplog_retention_days} days</option>}
              </select>
            </label>
            <label className="adm-ret" style={{ justifyContent: "space-between" }}>
              <span>Customer log</span>
              <select value={ret?.custlog_retention_days ?? 90} disabled={!ret} onChange={(e) => saveRet("custlog_retention_days", Number(e.target.value))}>
                {RET_OPTS.map((o) => <option key={o.d} value={o.d}>{o.label}</option>)}
                {ret && !RET_OPTS.some((o) => o.d === ret.custlog_retention_days) && <option value={ret.custlog_retention_days}>{ret.custlog_retention_days} days</option>}
              </select>
            </label>
          </div>
          {msg && <p className="adm-muted" style={{ fontSize: 12, marginTop: 10 }}>{msg}</p>}
        </div>
      </div>

      <div className="adm-card">
        <h2>Restaurants</h2>
        <p className="hint">Each restaurant&rsquo;s identity, branding, guest features, panels, maintenance and suspend/delete are managed on its own page.</p>
        <Link href="/aevinite/restaurants" className="adm-btn" style={{ display: "inline-flex", marginTop: 4 }}>Manage restaurants</Link>
      </div>
    </>
  );
}
