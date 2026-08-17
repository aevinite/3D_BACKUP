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
// THE CARD THAT ANSWERS "WHY CAN'T I SEE THAT?" COULD NOT ANSWER IT (T13 sweep, 2026-08-17).
//
// This list had six entries. `OWNER_SECTION_KEYS` (lib/ownerEntitlements.ts) has twelve, and the
// API sends an answer for every one of them — so three sections the admin really can switch off
// had no chip at all: Menu (2026-07-25), Audit & logs (2026-07-31) and Manager mode (2026-08-02).
// Verified on the running panel: with `menu` switched off, the Menu item vanished from the
// sidebar, /owner/menu said "ask your administrator", and this card — whose whole job is to be
// the place that confirms it — still showed the same six chips and said nothing about Menu.
//
// Two of those six were also named after screens that no longer exist. "Staff & powers" lost its
// Powers tab in the access rebuild of 2026-07-31; the sidebar was corrected to "Team" on
// 2026-08-05 ("the sidebar promised a screen that no longer exists") and the roster's own crumb on
// 2026-08-14 — this chip was the third copy of the same stale name, sitting one card below a
// sidebar that says "Team". Same for "Feedback & issues", which every other surface calls
// "Feedback & complaints". A chip he cannot match to a sidebar item cannot explain anything.
//
// ORDER MIRRORS THE SIDEBAR (components/owner/OwnerShell.tsx) so the two can be read side by side,
// with "Guest ratings" after Feedback because that is the page it lives inside rather than a nav
// item of its own.
//
// DELIBERATELY NOT CHIPS: logs_signins / logs_service / logs_staff_changes. Those three are not
// sections — they are which KINDS of row the Audit & logs page shows (read by /api/owner/oplog).
// A chip for each would read as three more screens he does not have, which is the same confusion
// in the opposite direction. Pay Later and Inventory are MODULES, not sections, and are correctly
// absent too. If a genuine SECTION is ever added to OWNER_SECTION_KEYS, it needs a line here —
// `npm run verify:owner-panel` fails until it has one.
const SECTION_LABEL: Record<string, string> = {
  manager_mode: "Manager mode", menu: "Menu", reports: "Reports", staff: "Team",
  customers: "Customers", logs: "Audit & logs", issues: "Feedback & complaints",
  ratings: "Guest ratings", settings: "Settings",
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

      {/* "Features you control" was removed in the access rebuild (owner, 2026-07-31):
          owners configure no features at all now — every switch lives on the admin's
          Access & permissions screen, so a feature can never be on in one place and off
          in another. The API still answers `modules` for older clients; nothing renders it. */}

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
