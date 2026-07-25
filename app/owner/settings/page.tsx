"use client";
// Owner · Settings — the owner's ACCOUNT page (not the restaurant's admin config, which
// stays with Aevidine/admin). Three safe things an owner controls or should see:
//   1. Appearance — light/dark, shared with the header toggle (localStorage + cookie).
//   2. Change password — self-service, verified server-side; re-login after.
//   3. What's enabled — a read-only view of the owner-panel sections the admin turned on,
//      plus the restaurants they own. Everything money/branding stays admin-controlled.
import { useCallback, useEffect, useState } from "react";
import { asSuffix } from "@/lib/ownerPin";

type Module = { restaurant_id: string; name: string; key: string; label: string; enabled: boolean };
type Data = {
  name: string; isAdmin: boolean; canChangePassword: boolean;
  sections: Record<string, boolean>; restaurants: { id: string; name: string }[];
  modules?: Module[];
};
const SECTION_LABEL: Record<string, string> = {
  reports: "Reports", staff: "Staff & powers", customers: "Customers",
  issues: "Feedback & issues", ratings: "Guest ratings", settings: "Settings",
};

export default function OwnerSettings() {
  const [scopePin] = useState<string | null>(() =>
    typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("rid"));
  const scp = scopePin ? `?scope=${scopePin}${asSuffix()}` : "";

  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const j = await (await fetch(`/api/owner/settings${scp}`, { cache: "no-store" })).json();
      if (j.error) throw new Error(j.error);
      setData(j); setErr(null);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }, [scp]);
  useEffect(() => { load(); }, [load]);

  // ── Appearance (mirrors OwnerShell.toggleSkin) ──
  const [skin, setSkin] = useState<"light" | "dark">("dark");
  useEffect(() => { try { const s = localStorage.getItem("aevidine_skin"); if (s === "light" || s === "dark") setSkin(s); } catch {} }, []);
  const applySkin = (next: "light" | "dark") => {
    setSkin(next);
    try { localStorage.setItem("aevidine_skin", next); } catch {}
    try { document.cookie = `aevidine_skin=${next}; path=/; max-age=31536000; samesite=lax`; } catch {}
    // The shell reads the skin on mount, so reload once to repaint the whole panel.
    location.reload();
  };

  // ── Change password ──
  const [cur, setCur] = useState(""); const [nw, setNw] = useState(""); const [cf, setCf] = useState("");
  const [pwBusy, setPwBusy] = useState(false); const [pwMsg, setPwMsg] = useState<string | null>(null); const [pwErr, setPwErr] = useState<string | null>(null);
  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwErr(null); setPwMsg(null);
    if (nw !== cf) { setPwErr("The new passwords don't match."); return; }
    if (nw.length < 6) { setPwErr("New password must be at least 6 characters."); return; }
    setPwBusy(true);
    try {
      const r = await fetch(`/api/owner/settings${scp}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ current: cur, next: nw }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
      setPwMsg("Password changed — signing you out so you can log in with the new one…");
      setCur(""); setNw(""); setCf("");
      setTimeout(() => { window.location.href = "/login"; }, 1600);
    } catch (e) { setPwErr(e instanceof Error ? e.message : String(e)); }
    finally { setPwBusy(false); }
  };

  return (
    <>
      <h1 className="adm-page-h">Settings</h1>
      <p className="adm-page-sub">Your account and what&apos;s switched on. Taxes, branding and billing are managed for you by Aevidine.</p>

      {err && (
        <div className="adm-card" style={{ borderColor: "var(--adm-danger)", marginBottom: 14 }}>
          <b>Couldn&apos;t load.</b> <span className="adm-muted" style={{ fontSize: 12.5 }}>{err}</span>{" "}
          <button className="adm-btn" style={{ marginLeft: 6 }} onClick={load}>Try again</button>
        </div>
      )}

      {/* Appearance */}
      <div className="adm-card" style={{ marginBottom: 14 }}>
        <div className="adm-section-h" style={{ fontWeight: 800, marginBottom: 4 }}>Appearance</div>
        <p className="adm-muted" style={{ fontSize: 12.5, marginBottom: 10 }}>Choose how the owner panel looks on this device.</p>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="adm-btn" aria-pressed={skin === "light"} onClick={() => applySkin("light")}
            style={skin === "light" ? { borderColor: "var(--accent)", color: "var(--accent)" } : undefined}>
            <i className="fas fa-sun" aria-hidden="true" /> Light
          </button>
          <button className="adm-btn" aria-pressed={skin === "dark"} onClick={() => applySkin("dark")}
            style={skin === "dark" ? { borderColor: "var(--accent)", color: "var(--accent)" } : undefined}>
            <i className="fas fa-moon" aria-hidden="true" /> Dark
          </button>
        </div>
      </div>

      {/* Change password */}
      {data?.canChangePassword && (
        <div className="adm-card" style={{ marginBottom: 14 }}>
          <div className="adm-section-h" style={{ fontWeight: 800, marginBottom: 4 }}>Change password</div>
          <p className="adm-muted" style={{ fontSize: 12.5, marginBottom: 10 }}>You&apos;ll be signed out and asked to log in again with the new password.</p>
          <form onSubmit={changePassword} style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 340 }}>
            <input className="adm-input" type="password" autoComplete="current-password" placeholder="Current password" value={cur} onChange={(e) => setCur(e.target.value)} required />
            <input className="adm-input" type="password" autoComplete="new-password" placeholder="New password (min 6 characters)" value={nw} onChange={(e) => setNw(e.target.value)} required />
            <input className="adm-input" type="password" autoComplete="new-password" placeholder="Repeat new password" value={cf} onChange={(e) => setCf(e.target.value)} required />
            {pwErr && <div style={{ color: "var(--adm-danger)", fontSize: 12.5 }}>{pwErr}</div>}
            {pwMsg && <div style={{ color: "var(--adm-ok, #16a34a)", fontSize: 12.5 }}>{pwMsg}</div>}
            <div><button className="adm-btn" type="submit" disabled={pwBusy}>{pwBusy ? "Saving…" : "Update password"}</button></div>
          </form>
        </div>
      )}

      {/* What's enabled */}
      <div className="adm-card" style={{ marginBottom: 14 }}>
        <div className="adm-section-h" style={{ fontWeight: 800, marginBottom: 4 }}>What&apos;s enabled</div>
        <p className="adm-muted" style={{ fontSize: 12.5, marginBottom: 10 }}>The sections Aevidine has switched on for you. To change these, contact Aevidine.</p>
        {err ? <div className="adm-empty">Not available.</div> : !data ? <div className="adm-empty">Loading…</div> : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {Object.keys(SECTION_LABEL).map((k) => {
              const on = data.sections[k] !== false;
              return (
                <span key={k} className="adm-chip" style={{ background: on ? "color-mix(in srgb, var(--adm-ok,#16a34a) 14%, transparent)" : "rgba(128,128,128,.14)", color: on ? "var(--adm-ok,#16a34a)" : "var(--muted)" }}>
                  <i className={`fas ${on ? "fa-check" : "fa-xmark"}`} aria-hidden="true" /> {SECTION_LABEL[k]}
                </span>
              );
            })}
          </div>
        )}
      </div>

      {/* Features you control (mig 166): modules whose on/off the admin handed to this
          owner — flipping one takes effect on the manager + tablet panels immediately. */}
      {data && (data.modules || []).length > 0 && (
        <div className="adm-card" style={{ marginBottom: 14 }}>
          <div className="adm-section-h" style={{ fontWeight: 800, marginBottom: 4 }}>Features you control</div>
          <p className="adm-muted" style={{ fontSize: 12.5, marginBottom: 10 }}>Aevidine handed you the switch for these. Off = the feature disappears from your manager and waiter panels.</p>
          {(data.modules || []).map((m) => (
            <div key={m.restaurant_id + m.key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "8px 0", borderBottom: "1px solid var(--adm-line, rgba(128,128,128,.2))" }}>
              <span style={{ fontSize: 13.5 }}>
                {m.label}
                {data.restaurants.length > 1 && <span className="adm-muted" style={{ display: "block", fontSize: 11.5 }}>{m.name}</span>}
              </span>
              <button type="button" role="switch" aria-checked={m.enabled} className="adm-btn"
                style={m.enabled ? { borderColor: "var(--adm-ok,#16a34a)", color: "var(--adm-ok,#16a34a)", minWidth: 64 } : { minWidth: 64 }}
                onClick={async () => {
                  const next = !m.enabled;
                  setData((d) => d ? { ...d, modules: (d.modules || []).map((x) => x === m ? { ...x, enabled: next } : x) } : d);
                  const r = await fetch(`/api/owner/settings${scp}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ restaurant_id: m.restaurant_id, key: m.key, enabled: next }) });
                  if (!r.ok) load(); // revert to the server truth on failure
                }}>
                {m.enabled ? "On" : "Off"}
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Your restaurants */}
      {data && data.restaurants.length > 0 && (
        <div className="adm-card">
          <div className="adm-section-h" style={{ fontWeight: 800, marginBottom: 4 }}>Your restaurants <span className="adm-muted" style={{ fontWeight: 500 }}>· {data.restaurants.length}</span></div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
            {data.restaurants.map((r) => <span key={r.id} className="adm-chip">{r.name}</span>)}
          </div>
        </div>
      )}
    </>
  );
}
