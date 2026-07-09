"use client";
// Owner · Staff & powers. Per restaurant the owner owns: flip what their MANAGERS
// are allowed to do (the manager_permissions flags), and add / disable / reset /
// remove staff. Data + writes go through /api/owner/staff and
// /api/owner/manager-permissions, which are scoped server-side to exactly the
// restaurants this caller owns — the UI never has to police that itself.
//
// This /owner/staff route is OWNER/ADMIN-only — the owner layout bounces anyone else to
// /login. A manager granted "manage_staff" manages staff from the EDITOR panel, which
// reuses this same API (they can't change the power toggles — those stay owner-only).
import { useCallback, useEffect, useRef, useState } from "react";

type Perms = Record<string, boolean>;
type Restaurant = { id: string; name: string; slug: string; accentColor: string; managerPermissions: Perms; ownerEntitlements?: Perms };
type Staff = { id: string; username: string; role: string; name: string | null; phone: string | null; active: boolean; restaurant_id: string; hasPin: boolean; last_seen_at?: string | null };

// [flag, label, hint]. Rendered by mapping — add a new power here (and to the API
// FLAGS whitelist) and it just appears; nothing is hardcoded to a fixed count.
const PERMS: [string, string, string][] = [
  ["manage_staff", "Manage staff", "Add / remove team members"],
  ["edit_menu", "Edit menu", "Change dishes, prices, categories"],
  ["give_discounts", "Give discounts", "Apply a discount to a bill"],
  ["view_dashboard", "View dashboard", "See sales numbers & charts"],
  ["void_bills", "Void bills", "Cancel / void an invoiced bill"],
  ["edit_settings", "Change settings", "Edit restaurant settings & preferences"],
  ["view_ratings", "Guest ratings", "See & handle guest star-ratings"],
];
const ROLES = ["manager", "kitchen", "tablet"];

export default function OwnerStaffPage() {
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [actor, setActor] = useState<string>("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reveal, setReveal] = useState<{ name: string; password: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [notEnabled, setNotEnabled] = useState<string | null>(null); // calm "section off" state, not an error
  const pwRef = useRef<HTMLInputElement>(null);
  const revealRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  // Bumped only to force a re-render so a controlled <select> snaps back to the real value
  // when the owner cancels a role change (otherwise the native picker keeps the chosen row).
  const [, forceRerender] = useState(0);
  // Inline rename / edit-phone editor: which row is open + its draft values.
  const [editing, setEditing] = useState<{ id: string; name: string; phone: string } | null>(null);
  // Synchronous re-entry guard so a fast double-click on "Add" can't fire twice before
  // React flushes the disabled state (the exact race that showed a raw duplicate-key error).
  const addingRef = useRef(false);
  // Admin-in-one-restaurant scope pin (bug C1) — mirrors app/owner/page.tsx & reports.
  // Rides on EVERY call as ?scope= so an admin viewing restaurant A in one tab and B
  // in another sees each tab's OWN restaurant, not the whole platform / the other tab's
  // (before, Staff ignored the pin: admin saw every restaurant regardless). Null for a
  // real owner (server scopes them by membership and ignores the param anyway).
  const [scopePin] = useState<string | null>(() =>
    typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("rid"));
  const withScope = useCallback(
    (p: string) => (scopePin ? `${p}${p.includes("?") ? "&" : "?"}scope=${scopePin}` : p),
    [scopePin]);
  // Deep-link from an X-ray zone ("open the setting that controls this"): ?focus=<flag>
  // scrolls to that power toggle and pulses it.
  const [linked] = useState<{ focus: string | null; rid: string | null }>(() =>
    typeof window === "undefined" ? { focus: null, rid: null }
    : { focus: new URLSearchParams(window.location.search).get("focus"), rid: new URLSearchParams(window.location.search).get("rid") });

  const load = useCallback(async () => {
    try {
      const r = await fetch(withScope("/api/owner/staff"), { cache: "no-store" }).then((x) => x.json());
      // A 403 "not enabled" is a legitimate state, NOT an error — show a calm card, not the
      // red "Something went wrong" banner (audit 2026-07-07).
      if (r.disabled) { setNotEnabled(r.error || "Staff management isn't enabled for your restaurant — contact Aevidine."); return; }
      if (r.error) throw new Error(r.error);
      setNotEnabled(null);
      setRestaurants(r.restaurants || []); setStaff(r.staff || []); setActor(r.actor || ""); setErr(null);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }, [withScope]);
  useEffect(() => { load(); }, [load]);

  // When a new one-time password appears, bring the reveal card into view (it renders at the
  // TOP of a possibly-long page) and select it — an owner low on the page used to never see
  // it, and it can't be shown again (audit 2026-07-07).
  useEffect(() => {
    if (!reveal) return;
    revealRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    const t = setTimeout(() => { pwRef.current?.focus(); pwRef.current?.select(); }, 250);
    return () => clearTimeout(t);
  }, [reveal]);

  // After a deep-linked load, locate the named power toggle and pulse it once.
  useEffect(() => {
    if (loading || !linked.focus) return;
    const el = document.querySelector<HTMLElement>(`[data-perm-key="${CSS.escape(linked.focus)}"]`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.style.transition = "box-shadow .3s";
    el.style.boxShadow = "0 0 0 4px rgba(217,119,6,.55)";
    const t = setTimeout(() => { el.style.boxShadow = ""; }, 2200);
    return () => clearTimeout(t);
  }, [loading, linked.focus]);

  const canEditPowers = actor === "owner" || actor === "admin";

  async function call(path: string, init: RequestInit): Promise<any> {
    setBusy(true);
    try {
      const r = await fetch(path, { ...init, headers: { "Content-Type": "application/json", ...(init.headers || {}) } });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || `Request failed (${r.status})`);
      return d;
    } finally { setBusy(false); }
  }

  async function togglePerm(rid: string, key: string, value: boolean) {
    try {
      const d = await call(withScope("/api/owner/manager-permissions"), { method: "PATCH", body: JSON.stringify({ restaurant_id: rid, permissions: { [key]: value } }) });
      setRestaurants((rs) => rs.map((r) => (r.id === rid ? { ...r, managerPermissions: d.manager_permissions } : r)));
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }

  async function addStaff(rid: string, form: HTMLFormElement) {
    if (addingRef.current) return; // block a second immediate submit (double-click)
    addingRef.current = true;
    try {
      const fd = new FormData(form);
      const name = String(fd.get("name") || "").trim();
      const role = String(fd.get("role") || "manager");
      const password = String(fd.get("password") || "").trim();
      if (name.length < 2) { setErr("Name must be at least 2 characters."); return; }
      const d = await call(withScope("/api/owner/staff"), { method: "POST", body: JSON.stringify({ name, role, password: password || undefined, restaurant_id: rid }) });
      setReveal({ name: d.name, password: d.password }); setCopied(false);
      form.reset();
      await load();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { addingRef.current = false; }
  }

  // Copy the one-time password. Confirms with "Copied!"; on a non-secure origin (no
  // navigator.clipboard) it falls back to selecting the field so it's never silently lost.
  async function copyPw(pw: string) {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(pw);
        setCopied(true); setTimeout(() => setCopied(false), 1800); return;
      }
    } catch { /* fall through to manual-select fallback */ }
    const el = pwRef.current;
    if (el) {
      el.focus(); el.select();
      try { document.execCommand?.("copy"); } catch { /* selection still lets them Ctrl/Cmd-C */ }
      setCopied(true); setTimeout(() => setCopied(false), 1800);
    }
  }

  async function saveEdit(s: Staff) {
    if (!editing || editing.id !== s.id) return;
    const name = editing.name.trim(); const phone = editing.phone.trim();
    if (name.length < 2) { setErr("Name must be at least 2 characters."); return; }
    try {
      await call(withScope("/api/owner/staff"), { method: "PATCH", body: JSON.stringify({ id: s.id, action: "edit", name, phone }) });
      setEditing(null); await load();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }

  async function resetPw(s: Staff) {
    if (!confirm(`Reset ${s.name || s.username}'s password? Their current login stops working.`)) return;
    try {
      const d = await call(withScope("/api/owner/staff"), { method: "PATCH", body: JSON.stringify({ id: s.id, action: "reset_password" }) });
      setReveal({ name: s.name || s.username, password: d.password }); setCopied(false);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }
  async function setActive(s: Staff, active: boolean) {
    // Disabling bumps their token → instant logout mid-shift, so confirm first (a mis-click
    // used to kick a working staffer off with no prompt). Re-enabling is harmless, no confirm.
    if (!active && !confirm(`Disable ${s.name || s.username}? They'll be logged out immediately and can't sign in until re-enabled.`)) return;
    try { await call(withScope("/api/owner/staff"), { method: "PATCH", body: JSON.stringify({ id: s.id, action: "set_active", active }) }); await load(); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }
  async function setRole(s: Staff, role: string) {
    if (role === s.role) return;
    // A role change bumps their token → instant logout mid-shift (exactly like Disable),
    // so warn first. Before, changing the role — or a mis-tap on the mobile select wheel —
    // silently booted a working staffer with no prompt (audit 2026-07-09). On cancel, force a
    // re-render so the controlled <select> snaps back to their real role.
    if (!confirm(`Change ${s.name || s.username} from ${s.role} to ${role}? They'll be logged out and must sign in again with their new ${role} access.`)) {
      forceRerender((n) => n + 1);
      return;
    }
    try { await call(withScope("/api/owner/staff"), { method: "PATCH", body: JSON.stringify({ id: s.id, action: "set_role", role }) }); await load(); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }
  async function del(s: Staff) {
    if (!confirm(`Remove ${s.name || s.username} for good? This can't be undone.`)) return;
    try { await call(withScope(`/api/owner/staff?id=${encodeURIComponent(s.id)}`), { method: "DELETE" }); await load(); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }

  return (
    <>
      <div className="own-bar"><div className="own-crumb"><span className="cur">Staff &amp; powers</span></div></div>

      {err && <div className="adm-card" style={{ borderColor: "var(--adm-danger)", marginBottom: 14 }}><b>Something went wrong.</b> <span className="adm-muted" style={{ fontSize: 12.5 }}>{err}</span> <button className="ost-x" onClick={() => setErr(null)}>dismiss</button></div>}

      {reveal && (
        <div className="adm-card ost-reveal" ref={revealRef}>
          <div><b>New password for {reveal.name}</b><div className="adm-muted" style={{ fontSize: 12.5 }}>Copy it now — it can&apos;t be shown again.</div></div>
          <input ref={pwRef} className="ost-pw" readOnly value={reveal.password} onFocus={(e) => e.currentTarget.select()} aria-label="One-time password" />
          <button className="ost-btn" onClick={() => copyPw(reveal.password)}>{copied ? "Copied!" : "Copy"}</button>
          <button className="ost-x" onClick={() => { setReveal(null); setCopied(false); }}>Done</button>
        </div>
      )}

      {loading && <div className="adm-empty">Loading…</div>}
      {!loading && notEnabled && <div className="adm-card"><div className="adm-empty">{notEnabled}</div></div>}
      {!loading && !notEnabled && restaurants.length === 0 && <div className="adm-empty">No restaurants are assigned to you yet. Ask the admin to assign one.</div>}

      {!notEnabled && restaurants.map((r) => {
        const team = staff.filter((s) => s.restaurant_id === r.id);
        return (
          <div key={r.id} className="adm-card ost-card" style={{ ["--rcol" as string]: r.accentColor }}>
            <span className="ost-accent" aria-hidden="true" />
            <div className="ost-head">
              <div><div className="ost-name">{r.name}</div><div className="adm-muted" style={{ fontSize: 12 }}>{r.slug} · {team.length} staff</div></div>
            </div>

            {/* Manager powers */}
            <div className="ost-section-t">Manager powers <span className="adm-muted" style={{ fontWeight: 500 }}>· what a manager here may do</span></div>
            <div className="ost-perms">
              {PERMS.map(([key, label, hint]) => {
                // The ladder (mig 133): a power the ADMIN removed doesn't exist here.
                // Hidden from the real owner; the admin act-as sees it amber-tinted,
                // and clicking it jumps to the admin Access hub instead of toggling.
                const exists = r.ownerEntitlements?.[`power_${key}`] !== false;
                if (!exists && actor !== "admin") return null;
                const on = !!r.managerPermissions?.[key];
                if (!exists) {
                  return (
                    <button key={key} type="button" className="ost-perm xray-off" data-perm-key={key}
                      onClick={() => { window.location.href = `/aevinite/access?rid=${r.id}&focus=manager-powers`; }}
                      title="Removed by admin — the owner can't see this. Tap to change it in Access control.">
                      <i className="fas fa-lock" /> <span>{label}</span>
                    </button>
                  );
                }
                return (
                  <button key={key} type="button" className={`ost-perm ${on ? "on" : ""}`} data-perm-key={key} disabled={!canEditPowers || busy}
                    onClick={() => togglePerm(r.id, key, !on)} title={canEditPowers ? hint : "Only the owner can change this"}>
                    <i className={`fas ${on ? "fa-toggle-on" : "fa-toggle-off"}`} /> <span>{label}</span>
                  </button>
                );
              })}
            </div>
            {!canEditPowers && <div className="adm-muted" style={{ fontSize: 11.5, marginTop: 4 }}>Only the owner can change these.</div>}

            {/* Staff list */}
            <div className="ost-section-t" style={{ marginTop: 16 }}>Team</div>
            <div className="ost-team">
              {team.length === 0 && <div className="adm-empty" style={{ padding: "10px 0" }}>No staff yet — add the first below.</div>}
              {team.map((s) => (
                <div key={s.id} className={`ost-row ${s.active ? "" : "off"}`}>
                  <div className="ost-who">
                    <span className="ost-rolebadge" data-role={s.role}>{s.role}</span>
                    <span className="ost-pn">{s.name || s.username}</span>
                    {s.phone && <span className="adm-muted" style={{ fontSize: 11.5 }}>{s.phone}</span>}
                    {!s.active && <span className="ost-disabled">disabled</span>}
                  </div>
                  <div className="ost-actions">
                    <select className="ost-mini" value={s.role} disabled={busy} onChange={(e) => setRole(s, e.target.value)} aria-label="Role">
                      {ROLES.map((ro) => <option key={ro} value={ro}>{ro}</option>)}
                    </select>
                    <button className="ost-mini" disabled={busy} onClick={() => setEditing(editing?.id === s.id ? null : { id: s.id, name: s.name || s.username, phone: s.phone || "" })}>Rename / edit phone</button>
                    <button className="ost-mini" disabled={busy} onClick={() => resetPw(s)}>Reset password</button>
                    <button className="ost-mini" disabled={busy} onClick={() => setActive(s, !s.active)}>{s.active ? "Disable" : "Enable"}</button>
                    <button className="ost-mini danger" disabled={busy} onClick={() => del(s)}>Remove</button>
                  </div>
                  {editing?.id === s.id && (
                    <div className="ost-editrow">
                      <input className="ost-in" value={editing.name} autoFocus placeholder="Username (their login)" autoComplete="off" maxLength={80}
                        onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
                      <input className="ost-in" value={editing.phone} placeholder="Phone (optional)" autoComplete="off"
                        onChange={(e) => setEditing({ ...editing, phone: e.target.value })} />
                      <button className="ost-btn" disabled={busy} onClick={() => saveEdit(s)}>Save</button>
                      <button className="ost-mini" disabled={busy} onClick={() => setEditing(null)}>Cancel</button>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Add staff */}
            <form className="ost-add" onSubmit={(e) => { e.preventDefault(); addStaff(r.id, e.currentTarget); }}>
              <input className="ost-in" name="name" placeholder="Username (their login)" autoComplete="off" maxLength={80} required />
              <select className="ost-in" name="role" defaultValue="manager">{ROLES.map((ro) => <option key={ro} value={ro}>{ro}</option>)}</select>
              <input className="ost-in" name="password" placeholder="Password (blank = auto)" autoComplete="off" />
              <button className="ost-btn" type="submit" disabled={busy}><i className="fas fa-user-plus" /> Add</button>
            </form>
          </div>
        );
      })}

      <style jsx>{`
        .ost-card { position: relative; overflow: hidden; padding-left: 22px; margin-bottom: 14px; }
        .ost-accent { position: absolute; left: 0; top: 0; bottom: 0; width: 5px; background: var(--rcol, var(--accent)); }
        .ost-head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px; }
        .ost-name { font-size: 17px; font-weight: 800; }
        .ost-section-t { font-size: 12.5px; font-weight: 800; margin-bottom: 8px; }
        .ost-perms { display: flex; flex-wrap: wrap; gap: 8px; }
        .ost-perm { display: inline-flex; align-items: center; gap: 7px; padding: 7px 12px; border: var(--border); border-radius: 10px; background: var(--card); color: var(--muted); font: inherit; font-size: 12.5px; font-weight: 700; cursor: pointer; }
        .ost-perm:hover:not(:disabled) { border-color: var(--accent); }
        .ost-perm.on { color: var(--rcol, var(--accent)); border-color: color-mix(in srgb, var(--rcol, var(--accent)) 55%, transparent); background: color-mix(in srgb, var(--rcol, var(--accent)) 9%, transparent); }
        .ost-perm i { font-size: 16px; }
        .ost-perm:disabled { opacity: .75; cursor: default; }
        .ost-perm.xray-off { color: #b45309; border-color: color-mix(in srgb, #d97706 45%, transparent); opacity: .8; }
        .ost-team { display: flex; flex-direction: column; gap: 4px; margin-bottom: 12px; }
        .ost-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; padding: 9px 10px; border-radius: 9px; background: color-mix(in srgb, var(--fg, #888) 4%, transparent); }
        .ost-row.off { opacity: .6; }
        .ost-who { display: flex; align-items: center; gap: 9px; min-width: 0; }
        .ost-pn { font-weight: 700; font-size: 13.5px; }
        .ost-rolebadge { font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: .03em; padding: 3px 8px; border-radius: 999px; background: rgba(128,128,128,.18); color: var(--muted); }
        .ost-rolebadge[data-role="manager"] { background: color-mix(in srgb, var(--accent) 18%, transparent); color: var(--accent); }
        .ost-disabled { font-size: 10.5px; color: var(--adm-danger, #c0392b); font-weight: 700; }
        .ost-actions { display: flex; flex-wrap: wrap; gap: 6px; }
        .ost-editrow { flex-basis: 100%; display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 8px; padding-top: 8px; border-top: var(--border); }
        .ost-mini { font: inherit; font-size: 11.5px; font-weight: 700; padding: 5px 9px; border-radius: 7px; border: var(--border); background: var(--card); color: var(--fg, inherit); cursor: pointer; }
        .ost-mini:hover:not(:disabled) { border-color: var(--accent); }
        .ost-mini.danger:hover:not(:disabled) { border-color: var(--adm-danger, #c0392b); color: var(--adm-danger, #c0392b); }
        .ost-add { display: flex; flex-wrap: wrap; gap: 8px; padding-top: 12px; border-top: var(--border); }
        .ost-in { font: inherit; font-size: 13px; padding: 8px 10px; border-radius: 8px; border: var(--border); background: var(--card); color: var(--fg, inherit); flex: 1 1 150px; }
        .ost-btn { font: inherit; font-size: 13px; font-weight: 700; padding: 8px 14px; border-radius: 8px; border: none; background: var(--accent); color: #fff; cursor: pointer; display: inline-flex; align-items: center; gap: 7px; }
        .ost-btn:disabled { opacity: .6; cursor: default; }
        .ost-reveal { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 14px; border-color: var(--adm-ok, #2e7d32); }
        .ost-pw { font-family: ui-monospace, monospace; font-size: 15px; font-weight: 700; padding: 6px 12px; border-radius: 8px; border: none; color: var(--fg, inherit); background: color-mix(in srgb, var(--accent) 12%, transparent); letter-spacing: .04em; min-width: 130px; }
        .ost-x { margin-left: auto; background: none; border: none; color: var(--muted); font: inherit; font-size: 12px; cursor: pointer; text-decoration: underline; }
        /* On a phone the 5-control action cluster was wrapping messily mid-row. Drop the
           actions onto their own full-width line under the name and let each button grow to
           share the width evenly — cleaner + bigger tap targets (audit 2026-07-07). */
        @media (max-width: 560px) {
          .ost-row { align-items: flex-start; }
          .ost-actions { flex-basis: 100%; margin-top: 8px; }
          .ost-actions .ost-mini, .ost-actions select { flex: 1 1 auto; text-align: center; }
        }
      `}</style>
    </>
  );
}
