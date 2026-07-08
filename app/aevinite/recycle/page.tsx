"use client";
// Admin · Recycle bin — restaurants that were DELETED (soft-deleted, mig 128). Each
// sits here for 90 days: it can be RESTORED any time, and only AFTER 90 days can it
// be PERMANENTLY purged. The purge button stays locked (with a countdown) until the
// retention window elapses — there is no early-purge override. Purge is irreversible,
// so it needs a type-the-name confirm and offers a one-click data backup first.
import { useCallback, useEffect, useState } from "react";

type Trashed = {
  id: string; slug: string; name: string;
  deletedAt: string; deletedBy: string | null; reason: string | null;
  purgeEligibleAt: string; daysLeft: number; canPurge: boolean;
};

const fmtDate = (iso: string) => { try { return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }); } catch { return iso; } };

export default function RecycleBin() {
  const [list, setList] = useState<Trashed[] | null>(null);
  const [retentionDays, setRetentionDays] = useState(90);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setMsg(null);
    try {
      const j = await (await fetch("/api/admin/restaurants?deleted=1", { cache: "no-store" })).json();
      if (!j.error) { setList(j.trashed || []); if (j.retentionDays) setRetentionDays(j.retentionDays); }
      else { setMsg(j.error); setList([]); } // show the error + Retry, not a perpetual "Loading…" (audit 2026-07-08)
    } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); setList([]); }
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <>
      <nav className="adm-crumbs" aria-label="Breadcrumb" style={{ marginBottom: 14 }}>
        <a href="/aevinite/restaurants">Restaurants</a>
        <i className="fas fa-chevron-right sep" aria-hidden="true" />
        <span className="cur">Recycle bin</span>
      </nav>
      <h1 className="adm-page-h">Recycle bin</h1>
      <p className="adm-page-sub">
        Deleted restaurants stay here for <b>{retentionDays} days</b>. Restore any of them any time. A restaurant can only be
        <b> permanently removed</b> once its {retentionDays} days are up — until then, purge is locked for everyone.
      </p>

      <div className="adm-card">
        {msg && <div className="adm-empty" style={{ color: "var(--adm-danger)" }}>{msg} <button className="adm-btn" style={{ marginLeft: 8 }} onClick={load}>Retry</button></div>}
        {list === null ? (
          <div className="adm-empty">Loading…</div>
        ) : list.length === 0 ? (
          <div className="adm-empty">{msg ? "" : "The recycle bin is empty — no deleted restaurants."}</div>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            {list.map((r) => <BinRow key={r.id} r={r} onChanged={load} />)}
          </div>
        )}
      </div>
    </>
  );
}

function BinRow({ r, onChanged }: { r: Trashed; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [purgeOpen, setPurgeOpen] = useState(false);
  const [confirmName, setConfirmName] = useState("");
  const [wantBackup, setWantBackup] = useState(true);

  const nameMatches = confirmName.trim() === r.name.trim();

  const restore = async (activate: boolean) => {
    setBusy(true); setErr(null);
    try {
      const res = await fetch("/api/admin/restaurants", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "restore_restaurant", restaurant_id: r.id, activate }),
      });
      const d = await res.json(); if (!res.ok) throw new Error(d.error || "Couldn't restore.");
      onChanged();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); setBusy(false); }
  };

  const downloadBackup = async (): Promise<boolean> => {
    // Stream the JSON backup to a file BEFORE we erase. If it fails, we abort the purge.
    try {
      const res = await fetch(`/api/admin/restaurants/export?rid=${encodeURIComponent(r.id)}`, { cache: "no-store" });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || "Backup download failed."); }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `backup-${r.slug}-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      return true;
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); return false; }
  };

  const purge = async () => {
    if (!nameMatches) { setErr("Type the restaurant's exact name to confirm."); return; }
    setBusy(true); setErr(null);
    try {
      if (wantBackup) { const okBackup = await downloadBackup(); if (!okBackup) { setBusy(false); return; } }
      const res = await fetch("/api/admin/restaurants", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "purge_restaurant", restaurant_id: r.id }),
      });
      const d = await res.json(); if (!res.ok) throw new Error(d.error || "Couldn't purge.");
      onChanged();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); setBusy(false); }
  };

  return (
    <div style={{ border: "var(--border)", borderRadius: 12, padding: 14, background: "var(--bg)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>{r.name}</div>
          <div className="adm-muted" style={{ fontSize: 12.5, fontFamily: "ui-monospace, monospace" }}>/r/{r.slug}/menu</div>
          <div className="adm-muted" style={{ fontSize: 12, marginTop: 4 }}>
            Deleted {fmtDate(r.deletedAt)}{r.deletedBy ? ` by ${r.deletedBy}` : ""}{r.reason ? ` · “${r.reason}”` : ""}
          </div>
        </div>
        <span className="adm-chip" style={r.canPurge
          ? { background: "color-mix(in srgb, var(--adm-danger) 20%, transparent)", color: "var(--adm-danger)" }
          : { background: "var(--muted2, rgba(120,120,120,0.18))", color: "var(--muted)" }}>
          {r.canPurge ? "Ready to purge" : `${r.daysLeft} day${r.daysLeft === 1 ? "" : "s"} left`}
        </span>
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 12 }}>
        <button className="adm-btn primary" disabled={busy} onClick={() => restore(false)} title="Bring it back, suspended (turn it live from the Restaurants page)">
          <i className="fas fa-rotate-left" style={{ marginRight: 7 }} aria-hidden="true" />Restore (suspended)
        </button>
        <button className="adm-btn" disabled={busy} onClick={() => restore(true)} title="Bring it back and make it live immediately">
          <i className="fas fa-play" style={{ marginRight: 7 }} aria-hidden="true" />Restore &amp; make live
        </button>
        <span style={{ flex: 1 }} />
        {r.canPurge ? (
          !purgeOpen && (
            <button className="adm-btn danger" disabled={busy} onClick={() => { setPurgeOpen(true); setErr(null); }}>
              <i className="fas fa-fire" style={{ marginRight: 7 }} aria-hidden="true" />Delete permanently…
            </button>
          )
        ) : (
          <button className="adm-btn" disabled title={`Locked until ${fmtDate(r.purgeEligibleAt)}`} style={{ opacity: 0.6, cursor: "not-allowed" }}>
            <i className="fas fa-lock" style={{ marginRight: 7 }} aria-hidden="true" />Purge locked until {fmtDate(r.purgeEligibleAt)}
          </button>
        )}
      </div>

      {purgeOpen && r.canPurge && (
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: "var(--border)", display: "grid", gap: 10, maxWidth: 460 }}>
          <p className="hint" style={{ margin: 0, color: "var(--adm-danger)" }}>
            This permanently erases <b>{r.name}</b> and ALL its data (menu, orders, bills, staff). This cannot be undone.
          </p>
          <label style={{ fontSize: 12.5, display: "flex", alignItems: "center", gap: 8 }}>
            <input type="checkbox" checked={wantBackup} onChange={(e) => setWantBackup(e.target.checked)} disabled={busy} />
            Download a backup file of this restaurant&apos;s data first (recommended)
          </label>
          {wantBackup && (
            <p className="hint" style={{ margin: "-4px 0 0 26px", fontSize: 11.5, color: "var(--muted)" }}>
              <i className="fas fa-circle-info" style={{ marginRight: 6 }} aria-hidden="true" />
              This file includes customer names &amp; phone numbers (staff passwords are removed). Keep it private and delete it once the restaurant is rebuilt.
            </p>
          )}
          <label style={{ fontSize: 12.5 }}>
            Type <b style={{ fontFamily: "ui-monospace, monospace" }}>{r.name}</b> to confirm
            <input value={confirmName} onChange={(e) => setConfirmName(e.target.value)} disabled={busy} autoFocus placeholder={r.name}
              style={{ width: "100%", marginTop: 4, padding: "8px 11px", borderRadius: 8, border: nameMatches ? "1px solid var(--adm-danger)" : "var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 13 }} />
          </label>
          {err && <span style={{ color: "var(--adm-danger)", fontSize: 12.5 }}>{err}</span>}
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button className="adm-btn danger" disabled={busy || !nameMatches} onClick={purge}>
              <i className="fas fa-fire" style={{ marginRight: 7 }} aria-hidden="true" />{busy ? "Purging…" : "Permanently delete"}
            </button>
            <button className="adm-btn" disabled={busy} onClick={() => { setPurgeOpen(false); setConfirmName(""); setErr(null); }}>Cancel</button>
          </div>
        </div>
      )}
      {err && !purgeOpen && <div style={{ color: "var(--adm-danger)", fontSize: 12.5, marginTop: 8 }}>{err}</div>}
    </div>
  );
}
