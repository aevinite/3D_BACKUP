"use client";
// Admin · Settings — platform-level info + the PLATFORM DEFAULT log retention. Guest-menu
// maintenance is per-restaurant (each restaurant's own page). Log retention is genuinely
// platform-wide now: migration 157 made lfh_prune_logs use this id='site' value as the DEFAULT
// for any restaurant that hasn't set its own window (a restaurant's own manager setting still
// wins). The old control here was a lie (only affected restaurant #1) until 157 wired the
// default for real; #279 removed the misleading version, this restores it as a true control.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

// Owner 2026-07-09: 1 month MAX, but freely toggleable down to a single day.
const RET_OPTS = [{ d: 1, label: "1 day" }, { d: 3, label: "3 days" }, { d: 7, label: "7 days" }, { d: 14, label: "2 weeks" }, { d: 30, label: "1 month" }];

export default function AdminSettings() {
  const [ret, setRet] = useState<{ oplog_retention_days: number; custlog_retention_days: number } | null>(null);
  // Which stack this console is pointed at, from the server (see the row below).
  const [env, setEnv] = useState<{ name: string; live: boolean } | null>(null);
  const [retErr, setRetErr] = useState(false);
  const [msg, setMsg] = useState("");

  const loadRet = useCallback(async () => {
    try {
      const j = await (await fetch("/api/admin/settings", { cache: "no-store" })).json();
      if (j.error) setRetErr(true); else { setRet(j); setRetErr(false); if (j.environment) setEnv(j.environment); }
    } catch { setRetErr(true); }
  }, []);
  useEffect(() => { loadRet(); }, [loadRet]);

  const saveRet = async (which: "oplog_retention_days" | "custlog_retention_days", val: number) => {
    setRet((r) => (r ? { ...r, [which]: val } : r));
    setMsg("");
    try {
      const r = await fetch("/api/admin/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ [which]: val }) });
      if (!r.ok) throw new Error();
      // WHAT IT REALLY DID (T16 sweep, 2026-08-19). This said "applied to every restaurant",
      // which migration 157 does not do: this value is the DEFAULT, and a restaurant that has
      // chosen its own window in its manager panel keeps that one.
      setMsg("Saved — the new default for every restaurant that hasn't chosen its own.");
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
            {/* Answered by the server from the database this deployment actually talks to — it
                used to be the word "Production" typed into the page, which on the backup stack
                was simply untrue (T20 sweep, 2026-08-16). Amber, not green, when it is the live
                client stack: that row should make you pause, not reassure you. */}
            <div className="adm-logrow" style={{ gridTemplateColumns: "1fr auto" }}>
              <span>Which stack</span>
              <span style={{ fontWeight: 700, color: env ? (env.live ? "var(--adm-warn)" : "var(--adm-ok)") : "var(--muted)" }}>
                {env ? env.name : "checking…"}
              </span>
            </div>
            <div className="adm-logrow" style={{ gridTemplateColumns: "1fr auto" }}><span>You&rsquo;re signed in as</span><span className="adm-muted">Platform admin</span></div>
            <div className="adm-logrow" style={{ gridTemplateColumns: "1fr auto" }}><span>Guest-menu maintenance</span><span className="adm-muted">per restaurant</span></div>
          </div>
          <p className="hint" style={{ marginTop: 10, marginBottom: 0 }}>To put a restaurant&rsquo;s menu into a &ldquo;we&rsquo;ll be right back&rdquo; state, open it on the <b>Restaurants</b> page and use its <b>Maintenance</b> toggle (or <b>Suspend</b> to take it fully offline).</p>
        </div>

        <div className="adm-card">
          <h2>Log retention <span className="adm-muted">· platform default</span></h2>
          {/* THIS CARD USED TO OVERSTATE ITSELF, TWICE (T16 sweep, 2026-08-19). It said "how long
              EVERY restaurant keeps its logs — one platform-wide setting" with a "1-month MAXIMUM".
              Migration 157 made this value the DEFAULT for restaurants that have not chosen their
              own, and a restaurant's own choice wins; the manager panel's Activity log still offers
              "3 months", which the editor route stores. So the maximum was not a maximum and the
              setting was not platform-wide, and nothing on screen said so — the admin could set 7
              days here and a restaurant would still be holding 90 days of customer log. */}
          <p className="hint">
            The <b>default</b> every restaurant follows for its activity &amp; customer logs — from a single
            day up to 1 month. Older entries auto-delete each night; bills are never touched.
          </p>
          <p className="hint" style={{ marginTop: -4 }}>
            A restaurant that has picked its <b>own</b> window on its manager panel keeps that one instead,
            and that choice goes up to <b>3 months</b> — so this default does not cap it.
          </p>
          {retErr && <p className="adm-muted" style={{ fontSize: 12, marginBottom: 8 }}>Couldn&rsquo;t load retention. <button className="adm-btn" style={{ marginLeft: 6 }} onClick={loadRet}>Retry</button></p>}
          <div style={{ display: "grid", gap: 12 }}>
            <label className="adm-ret" style={{ justifyContent: "space-between" }}>
              <span>Operations log</span>
              <select value={ret?.oplog_retention_days ?? 30} disabled={!ret} onChange={(e) => saveRet("oplog_retention_days", Number(e.target.value))}>
                {RET_OPTS.map((o) => <option key={o.d} value={o.d}>{o.label}</option>)}
                {ret && !RET_OPTS.some((o) => o.d === ret.oplog_retention_days) && <option value={ret.oplog_retention_days}>{ret.oplog_retention_days} days</option>}
              </select>
            </label>
            <label className="adm-ret" style={{ justifyContent: "space-between" }}>
              <span>Customer log</span>
              <select value={ret?.custlog_retention_days ?? 30} disabled={!ret} onChange={(e) => saveRet("custlog_retention_days", Number(e.target.value))}>
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
