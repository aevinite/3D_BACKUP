"use client";
// Owner · Staff & powers. Per restaurant the owner owns: flip what their MANAGERS
// are allowed to do (the manager_permissions flags), and add / disable / reset /
// remove staff. Data + writes go through /api/owner/staff and
// /api/owner/manager-permissions, which are scoped server-side to exactly the
// restaurants this caller owns — the UI never has to police that itself.
//
// A manager who was granted "manage_staff" lands here too (same API), but sees only
// their one restaurant and can't change the power toggles (those stay owner-only).
import { useCallback, useEffect, useState } from "react";

type Perms = Record<string, boolean>;
type Restaurant = { id: string; name: string; slug: string; accentColor: string; managerPermissions: Perms };
type Staff = { id: string; username: string; role: string; name: string | null; phone: string | null; active: boolean; restaurant_id: string; hasPin: boolean; last_seen_at?: string | null };

const PERMS: [string, string, string][] = [
  ["manage_staff", "Manage staff", "Add / remove team members"],
  ["edit_menu", "Edit menu", "Change dishes, prices, categories"],
  ["give_discounts", "Give discounts", "Apply a discount to a bill"],
  ["view_dashboard", "View dashboard", "See sales numbers & charts"],
  ["void_bills", "Void bills", "Cancel / void an invoiced bill"],
];
const ROLES = ["manager", "kitchen", "tablet"];

export default function OwnerStaffPage() {
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [actor, setActor] = useState<string>("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reveal, setReveal] = useState<{ name: string; password: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/owner/staff", { cache: "no-store" }).then((x) => x.json());
      if (r.error) throw new Error(r.error);
      setRestaurants(r.restaurants || []); setStaff(r.staff || []); setActor(r.actor || ""); setErr(null);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

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
      const d = await call("/api/owner/manager-permissions", { method: "PATCH", body: JSON.stringify({ restaurant_id: rid, permissions: { [key]: value } }) });
      setRestaurants((rs) => rs.map((r) => (r.id === rid ? { ...r, managerPermissions: d.manager_permissions } : r)));
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }

  async function addStaff(rid: string, form: HTMLFormElement) {
    const fd = new FormData(form);
    const name = String(fd.get("name") || "").trim();
    const role = String(fd.get("role") || "manager");
    const password = String(fd.get("password") || "").trim();
    if (name.length < 2) { setErr("Name must be at least 2 characters."); return; }
    try {
      const d = await call("/api/owner/staff", { method: "POST", body: JSON.stringify({ name, role, password: password || undefined, restaurant_id: rid }) });
      setReveal({ name: d.name, password: d.password });
      form.reset();
      await load();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }

  async function resetPw(s: Staff) {
    if (!confirm(`Reset ${s.name || s.username}'s password? Their current login stops working.`)) return;
    try {
      const d = await call("/api/owner/staff", { method: "PATCH", body: JSON.stringify({ id: s.id, action: "reset_password" }) });
      setReveal({ name: s.name || s.username, password: d.password });
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }
  async function setActive(s: Staff, active: boolean) {
    try { await call("/api/owner/staff", { method: "PATCH", body: JSON.stringify({ id: s.id, action: "set_active", active }) }); await load(); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }
  async function setRole(s: Staff, role: string) {
    try { await call("/api/owner/staff", { method: "PATCH", body: JSON.stringify({ id: s.id, action: "set_role", role }) }); await load(); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }
  async function del(s: Staff) {
    if (!confirm(`Remove ${s.name || s.username} for good? This can't be undone.`)) return;
    try { await call(`/api/owner/staff?id=${encodeURIComponent(s.id)}`, { method: "DELETE" }); await load(); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }

  return (
    <>
      <div className="own-bar"><div className="own-crumb"><span className="cur">Staff &amp; powers</span></div></div>

      {err && <div className="adm-card" style={{ borderColor: "var(--adm-danger)", marginBottom: 14 }}><b>Something went wrong.</b> <span className="adm-muted" style={{ fontSize: 12.5 }}>{err}</span> <button className="ost-x" onClick={() => setErr(null)}>dismiss</button></div>}

      {reveal && (
        <div className="adm-card ost-reveal">
          <div><b>New password for {reveal.name}</b><div className="adm-muted" style={{ fontSize: 12.5 }}>Copy it now — it can&apos;t be shown again.</div></div>
          <code className="ost-pw">{reveal.password}</code>
          <button className="ost-btn" onClick={() => { navigator.clipboard?.writeText(reveal.password).catch(() => {}); }}>Copy</button>
          <button className="ost-x" onClick={() => setReveal(null)}>Done</button>
        </div>
      )}

      {loading && <div className="adm-empty">Loading…</div>}
      {!loading && restaurants.length === 0 && <div className="adm-empty">No restaurants are assigned to you yet. Ask the admin to assign one.</div>}

      {restaurants.map((r) => {
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
                const on = !!r.managerPermissions?.[key];
                return (
                  <button key={key} type="button" className={`ost-perm ${on ? "on" : ""}`} disabled={!canEditPowers || busy}
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
                    {!s.active && <span className="ost-disabled">disabled</span>}
                  </div>
                  <div className="ost-actions">
                    <select className="ost-mini" value={s.role} disabled={busy} onChange={(e) => setRole(s, e.target.value)} aria-label="Role">
                      {ROLES.map((ro) => <option key={ro} value={ro}>{ro}</option>)}
                    </select>
                    <button className="ost-mini" disabled={busy} onClick={() => resetPw(s)}>Reset password</button>
                    <button className="ost-mini" disabled={busy} onClick={() => setActive(s, !s.active)}>{s.active ? "Disable" : "Enable"}</button>
                    <button className="ost-mini danger" disabled={busy} onClick={() => del(s)}>Remove</button>
                  </div>
                </div>
              ))}
            </div>

            {/* Add staff */}
            <form className="ost-add" onSubmit={(e) => { e.preventDefault(); addStaff(r.id, e.currentTarget); }}>
              <input className="ost-in" name="name" placeholder="Name (their login)" autoComplete="off" required />
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
        .ost-team { display: flex; flex-direction: column; gap: 4px; margin-bottom: 12px; }
        .ost-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; padding: 9px 10px; border-radius: 9px; background: color-mix(in srgb, var(--fg, #888) 4%, transparent); }
        .ost-row.off { opacity: .6; }
        .ost-who { display: flex; align-items: center; gap: 9px; min-width: 0; }
        .ost-pn { font-weight: 700; font-size: 13.5px; }
        .ost-rolebadge { font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: .03em; padding: 3px 8px; border-radius: 999px; background: rgba(128,128,128,.18); color: var(--muted); }
        .ost-rolebadge[data-role="manager"] { background: color-mix(in srgb, var(--accent) 18%, transparent); color: var(--accent); }
        .ost-disabled { font-size: 10.5px; color: var(--adm-danger, #c0392b); font-weight: 700; }
        .ost-actions { display: flex; flex-wrap: wrap; gap: 6px; }
        .ost-mini { font: inherit; font-size: 11.5px; font-weight: 700; padding: 5px 9px; border-radius: 7px; border: var(--border); background: var(--card); color: var(--fg, inherit); cursor: pointer; }
        .ost-mini:hover:not(:disabled) { border-color: var(--accent); }
        .ost-mini.danger:hover:not(:disabled) { border-color: var(--adm-danger, #c0392b); color: var(--adm-danger, #c0392b); }
        .ost-add { display: flex; flex-wrap: wrap; gap: 8px; padding-top: 12px; border-top: var(--border); }
        .ost-in { font: inherit; font-size: 13px; padding: 8px 10px; border-radius: 8px; border: var(--border); background: var(--card); color: var(--fg, inherit); flex: 1 1 150px; }
        .ost-btn { font: inherit; font-size: 13px; font-weight: 700; padding: 8px 14px; border-radius: 8px; border: none; background: var(--accent); color: #fff; cursor: pointer; display: inline-flex; align-items: center; gap: 7px; }
        .ost-btn:disabled { opacity: .6; cursor: default; }
        .ost-reveal { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 14px; border-color: var(--adm-ok, #2e7d32); }
        .ost-pw { font-family: ui-monospace, monospace; font-size: 15px; font-weight: 700; padding: 6px 12px; border-radius: 8px; background: color-mix(in srgb, var(--accent) 12%, transparent); letter-spacing: .04em; }
        .ost-x { margin-left: auto; background: none; border: none; color: var(--muted); font: inherit; font-size: 12px; cursor: pointer; text-decoration: underline; }
      `}</style>
    </>
  );
}
