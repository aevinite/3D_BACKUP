"use client";
// Admin · Recycle bin — things that were DELETED (soft-deleted) sit here for 90
// days: RESTORE any time, and only AFTER 90 days can they be PERMANENTLY purged.
// Two kinds live here now: deleted RESTAURANTS (mig 128) and deleted OWNERS (mig
// 208). Each purge button stays locked (with a countdown) until the retention
// window elapses — there is no early-purge override. Purge is irreversible.
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAdminModal } from "@/components/admin/useAdminModal";

type Trashed = {
  id: string; slug: string; name: string;
  deletedAt: string; deletedBy: string | null; reason: string | null;
  purgeEligibleAt: string; daysLeft: number; canPurge: boolean;
};

type OwnerTrashed = {
  id: string; username: string; name: string; restaurants: number;
  deletedAt: string; deletedBy: string | null; reason: string | null;
  purgeEligibleAt: string; daysLeft: number; canPurge: boolean;
};

const fmtDate = (iso: string) => { try { return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }); } catch { return iso; } };

export default function RecycleBin() {
  const [list, setList] = useState<Trashed[] | null>(null);
  const [owners, setOwners] = useState<OwnerTrashed[] | null>(null);
  const [retentionDays, setRetentionDays] = useState(90);
  const [msg, setMsg] = useState<string | null>(null);
  const [ownerMsg, setOwnerMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setMsg(null); setOwnerMsg(null);
    try {
      const j = await (await fetch("/api/admin/restaurants?deleted=1", { cache: "no-store" })).json();
      if (!j.error) { setList(j.trashed || []); if (j.retentionDays) setRetentionDays(j.retentionDays); }
      else { setMsg(j.error); setList([]); } // show the error + Retry, not a perpetual "Loading…" (audit 2026-07-08)
    } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); setList([]); }
    try {
      const j = await (await fetch("/api/admin/owners?deleted=1", { cache: "no-store" })).json();
      if (!j.error) { setOwners(j.trashed || []); if (j.retentionDays) setRetentionDays(j.retentionDays); }
      else { setOwnerMsg(j.error); setOwners([]); }
    } catch (e) { setOwnerMsg(e instanceof Error ? e.message : String(e)); setOwners([]); }
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
        Deleted restaurants and owners stay here for <b>{retentionDays} days</b>. Restore any of them any time. Anything can only be
        <b> permanently removed</b> once its {retentionDays} days are up — until then, purge is locked for everyone.
      </p>

      <h2 style={{ fontSize: 15, fontWeight: 700, margin: "18px 0 8px" }}>Deleted restaurants</h2>
      <div className="adm-card">
        {msg && <div className="adm-empty" style={{ color: "var(--adm-danger)" }}>{msg} <button className="adm-btn" style={{ marginLeft: 8 }} onClick={load}>Retry</button></div>}
        {list === null ? (
          <div className="adm-empty">Loading…</div>
        ) : list.length === 0 ? (
          <div className="adm-empty">{msg ? "" : "No deleted restaurants."}</div>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            {list.map((r) => <BinRow key={r.id} r={r} onChanged={load} />)}
          </div>
        )}
      </div>

      <h2 style={{ fontSize: 15, fontWeight: 700, margin: "22px 0 8px" }}>Deleted owners</h2>
      <div className="adm-card">
        {ownerMsg && <div className="adm-empty" style={{ color: "var(--adm-danger)" }}>{ownerMsg} <button className="adm-btn" style={{ marginLeft: 8 }} onClick={load}>Retry</button></div>}
        {owners === null ? (
          <div className="adm-empty">Loading…</div>
        ) : owners.length === 0 ? (
          <div className="adm-empty">{ownerMsg ? "" : "No deleted owners."}</div>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            {owners.map((o) => <OwnerBinRow key={o.id} o={o} onChanged={load} />)}
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

// Deleted OWNER row (mig 208). Restore brings them back SUSPENDED (reactivate from
// the Owners list). Purge is the old permanent delete — locked until 90 days — and
// releases their restaurants to a co-owner / "no owner". No data-backup step: an
// owner is just a login; its restaurants aren't erased.
function OwnerBinRow({ o, onChanged }: { o: OwnerTrashed; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [purgeOpen, setPurgeOpen] = useState(false);
  const [confirmName, setConfirmName] = useState("");
  // Set when the server says this name was taken while the owner sat in the bin —
  // the admin picks who keeps it, then we re-send the same restore with a resolve.
  const [clash, setClash] = useState<NameClash | null>(null);

  const nameMatches = confirmName.trim().toLowerCase() === o.username.trim().toLowerCase();

  // resolve = undefined for the plain first attempt; the dialog re-calls with one.
  const restore = async (resolve?: Resolve) => {
    setBusy(true); setErr(null);
    try {
      const res = await fetch("/api/admin/owners", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "restore_owner", owner_id: o.id, ...(resolve ? { resolve } : {}) }),
      });
      const d = await res.json();
      // A name clash isn't an error to dump on the page — it's a question. Open the
      // chooser instead, with the row un-busied so the dialog's buttons work.
      if (res.status === 409 && d.conflict) { setClash(d.conflict as NameClash); setBusy(false); return; }
      if (!res.ok) throw new Error(d.error || "Couldn't restore.");
      setClash(null);
      onChanged();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); setBusy(false); }
  };

  const purge = async () => {
    if (!nameMatches) { setErr("Type the owner's exact username to confirm."); return; }
    setBusy(true); setErr(null);
    try {
      const res = await fetch("/api/admin/owners", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "purge_owner", owner_id: o.id }),
      });
      const d = await res.json(); if (!res.ok) throw new Error(d.error || "Couldn't purge.");
      onChanged();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); setBusy(false); }
  };

  return (
    <div style={{ border: "var(--border)", borderRadius: 12, padding: 14, background: "var(--bg)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>{o.name} <span className="adm-muted" style={{ fontWeight: 400, fontSize: 12.5 }}>@{o.username}</span></div>
          <div className="adm-muted" style={{ fontSize: 12.5 }}>{o.restaurants} restaurant{o.restaurants === 1 ? "" : "s"} still linked (returned on restore)</div>
          <div className="adm-muted" style={{ fontSize: 12, marginTop: 4 }}>
            Deleted {fmtDate(o.deletedAt)}{o.deletedBy ? ` by ${o.deletedBy}` : ""}{o.reason ? ` · “${o.reason}”` : ""}
          </div>
        </div>
        <span className="adm-chip" style={o.canPurge
          ? { background: "color-mix(in srgb, var(--adm-danger) 20%, transparent)", color: "var(--adm-danger)" }
          : { background: "var(--muted2, rgba(120,120,120,0.18))", color: "var(--muted)" }}>
          {o.canPurge ? "Ready to remove" : `${o.daysLeft} day${o.daysLeft === 1 ? "" : "s"} left`}
        </span>
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 12 }}>
        <button className="adm-btn primary" disabled={busy} onClick={() => restore()} title="Bring the owner back, suspended (reactivate from the Owners list)">
          <i className="fas fa-rotate-left" style={{ marginRight: 7 }} aria-hidden="true" />Restore (suspended)
        </button>
        <span style={{ flex: 1 }} />
        {o.canPurge ? (
          !purgeOpen && (
            <button className="adm-btn danger" disabled={busy} onClick={() => { setPurgeOpen(true); setErr(null); }}>
              <i className="fas fa-fire" style={{ marginRight: 7 }} aria-hidden="true" />Delete permanently…
            </button>
          )
        ) : (
          <button className="adm-btn" disabled title={`Locked until ${fmtDate(o.purgeEligibleAt)}`} style={{ opacity: 0.6, cursor: "not-allowed" }}>
            <i className="fas fa-lock" style={{ marginRight: 7 }} aria-hidden="true" />Purge locked until {fmtDate(o.purgeEligibleAt)}
          </button>
        )}
      </div>

      {purgeOpen && o.canPurge && (
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: "var(--border)", display: "grid", gap: 10, maxWidth: 460 }}>
          <p className="hint" style={{ margin: 0, color: "var(--adm-danger)" }}>
            This permanently deletes the owner login <b>{o.name}</b>. Their {o.restaurants} restaurant{o.restaurants === 1 ? "" : "s"} are handed to a co-owner or become “no owner” — the restaurants themselves are NOT deleted. This cannot be undone.
          </p>
          <label style={{ fontSize: 12.5 }}>
            Type <b style={{ fontFamily: "ui-monospace, monospace" }}>{o.username}</b> to confirm
            <input value={confirmName} onChange={(e) => setConfirmName(e.target.value)} disabled={busy} autoFocus placeholder={o.username}
              style={{ width: "100%", marginTop: 4, padding: "8px 11px", borderRadius: 8, border: nameMatches ? "1px solid var(--adm-danger)" : "var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 13 }} />
          </label>
          {err && <span style={{ color: "var(--adm-danger)", fontSize: 12.5 }}>{err}</span>}
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button className="adm-btn danger" disabled={busy || !nameMatches} onClick={purge}>
              <i className="fas fa-fire" style={{ marginRight: 7 }} aria-hidden="true" />{busy ? "Removing…" : "Permanently delete"}
            </button>
            <button className="adm-btn" disabled={busy} onClick={() => { setPurgeOpen(false); setConfirmName(""); setErr(null); }}>Cancel</button>
          </div>
        </div>
      )}
      {err && !purgeOpen && <div style={{ color: "var(--adm-danger)", fontSize: 12.5, marginTop: 8 }}>{err}</div>}

      {clash && (
        <NameClashDialog clash={clash} busy={busy}
          onClose={() => setClash(null)}
          onResolve={(r) => restore(r)} />
      )}
    </div>
  );
}

// ── The name chooser (owner, 2026-08-01) ────────────────────────────────────────
// A binned login no longer reserves its name (mig 245), so by restore time someone
// else may be called "rishi" too. Rather than failing — or silently renaming a real
// person's login — the admin says which one keeps the name. Every path renames
// somebody VISIBLY and states who; nothing happens until a button is pressed.
type NameClash = {
  username: string;
  restored: { id: string; name: string; username: string };
  existing: { id: string; name: string; username: string; role: string; active: boolean };
  canRenameExisting: boolean;
};
type Resolve = { mode: "rename_restored" | "rename_existing"; name: string };

function NameClashDialog({ clash, busy, onClose, onResolve }: {
  clash: NameClash; busy: boolean; onClose: () => void; onResolve: (r: Resolve) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useAdminModal(ref, "owner-name-clash", onClose);
  // Prefilled suggestions so the admin can just press a button; both are editable.
  const [restoredName, setRestoredName] = useState(`${clash.restored.name} (old)`);
  const [existingName, setExistingName] = useState(`${clash.existing.name} 2`);
  const tooShort = (s: string) => s.trim().replace(/\s+/g, " ").length < 2;

  // PORTAL, not an inline overlay. This dialog is rendered from deep inside a bin ROW,
  // and an ancestor there establishes a containing block, so `position: fixed` anchored
  // to the ROW instead of the screen: the box appeared level with its row and its second
  // choice was cut off below the fold.
  // Target `.adm`, NOT <body>: the whole admin palette (--card/--text/--border and the
  // data-skin=dark switch) is scoped to that element, so a body portal came out as a
  // WHITE card in the dark console. `.adm` has no transform/filter, so "fixed" still
  // means the viewport there.
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => { setHost(document.querySelector<HTMLElement>(".adm") ?? document.body); }, []);
  if (!host) return null;

  return createPortal(
    <>
      <div onClick={busy ? undefined : onClose} style={{ position: "fixed", inset: 0, background: "rgba(2,6,16,0.66)", backdropFilter: "blur(2px)", zIndex: 1000 }} />
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="clash-title" style={{ position: "fixed", inset: 0, zIndex: 1001, display: "grid", placeItems: "center", padding: 16, pointerEvents: "none" }}>
        <div className="adm-card" style={{ pointerEvents: "auto", width: "min(94vw, 520px)", maxHeight: "90dvh", overflowY: "auto" }}>
        <h3 id="clash-title" style={{ margin: "0 0 6px", fontSize: 17, fontWeight: 800 }}>
          The name “{clash.restored.name}” is taken
        </h3>
        <p className="adm-muted" style={{ margin: "0 0 14px", fontSize: 13, lineHeight: 1.5 }}>
          While this owner sat in the recycle bin, <b>{clash.existing.name}</b>{clash.existing.active ? "" : " (suspended)"}{" "}
          took that name. Two logins can&apos;t share one, so choose who keeps it — the other one gets
          renamed, and you can see exactly what it becomes.
        </p>

        <div style={{ display: "grid", gap: 10 }}>
          <div style={{ border: "var(--border)", borderRadius: 10, padding: 12 }}>
            <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 6 }}>
              <i className="fas fa-rotate-left" style={{ marginRight: 7, opacity: 0.8 }} aria-hidden="true" />
              Rename the one coming back
            </div>
            <p className="adm-muted" style={{ margin: "0 0 8px", fontSize: 12 }}>
              <b>{clash.existing.name}</b> keeps the name. The restored owner comes back under this one:
            </p>
            <input value={restoredName} onChange={(e) => setRestoredName(e.target.value)} disabled={busy}
              aria-label="New name for the owner being restored"
              style={{ width: "100%", padding: "8px 11px", borderRadius: 8, border: "var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 13 }} />
            <button className="adm-btn primary" style={{ marginTop: 9 }} disabled={busy || tooShort(restoredName)}
              onClick={() => onResolve({ mode: "rename_restored", name: restoredName })}>
              {busy ? "Restoring…" : "Restore under this name"}
            </button>
          </div>

          {clash.canRenameExisting ? (
            <div style={{ border: "var(--border)", borderRadius: 10, padding: 12 }}>
              <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 6 }}>
                <i className="fas fa-user-pen" style={{ marginRight: 7, opacity: 0.8 }} aria-hidden="true" />
                Rename the current owner instead
              </div>
              <p className="adm-muted" style={{ margin: "0 0 8px", fontSize: 12 }}>
                The owner coming back keeps <b>{clash.restored.name}</b>. Today&apos;s <b>{clash.existing.name}</b> is
                renamed to this, and signs in with the new name from then on:
              </p>
              <input value={existingName} onChange={(e) => setExistingName(e.target.value)} disabled={busy}
                aria-label="New name for the owner who currently has it"
                style={{ width: "100%", padding: "8px 11px", borderRadius: 8, border: "var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 13 }} />
              <button className="adm-btn" style={{ marginTop: 9 }} disabled={busy || tooShort(existingName)}
                onClick={() => onResolve({ mode: "rename_existing", name: existingName })}>
                {busy ? "Working…" : "Rename them & restore"}
              </button>
            </div>
          ) : (
            <p className="adm-muted" style={{ margin: 0, fontSize: 12 }}>
              <i className="fas fa-circle-info" style={{ marginRight: 6 }} aria-hidden="true" />
              That name belongs to a restaurant&apos;s <b>{clash.existing.role}</b> login, not an owner — rename it on
              that restaurant&apos;s Users page if it should be freed up.
            </p>
          )}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
          <button className="adm-btn" disabled={busy} onClick={onClose}>Cancel</button>
        </div>
        </div>
      </div>
    </>,
    host,
  );
}
