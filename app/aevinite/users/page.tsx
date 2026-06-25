"use client";
// /aevinite/users — the admin's staff-user manager. Create logins for the three
// panels (manager / kitchen / tablet); then EVERYTHING about an existing user
// (rename, role, password, enable/disable, self-reset, delete) lives inside a
// per-user EDIT panel that opens as a modal — the list itself stays clean and
// only shows who each person is, not a wall of buttons. Behind the admin gate
// via the /aevinite layout. All data comes from /api/admin/users (service-role,
// admin-cookie protected). Passwords are stored HASHED — the only time one is
// ever visible is the one-time "copy it now" reveal right after you set it.
import { useCallback, useEffect, useState } from "react";

type User = {
  id: string; username: string; role: string; name: string | null; phone: string | null;
  active: boolean; last_seen_at: string | null; created_at: string; hasPin: boolean;
  can_self_reset: boolean; can_self_set_pin: boolean;
  restaurant_id?: string | null; restaurantName?: string | null;
};

const ROLES = ["manager", "kitchen", "tablet"] as const;
const ROLE_LABEL: Record<string, string> = { manager: "Manager", kitchen: "Kitchen", tablet: "Tablet (waiter)" };
const ROLE_COLOR: Record<string, string> = { manager: "#d4a574", kitchen: "#7ec88a", tablet: "#60a5fa" };

// Shared visual tokens — now theme-driven so this page matches the warm light/dark
// admin shell (was a hardcoded navy palette).
const card: React.CSSProperties = { background: "var(--card)", border: "var(--border)", borderRadius: 14, padding: 18 };
const field: React.CSSProperties = { boxSizing: "border-box", padding: "10px 12px", borderRadius: 10, border: "var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 14, width: "100%" };
const btn = (bg: string): React.CSSProperties => ({ padding: "10px 14px", borderRadius: 9, border: 0, background: bg, color: "#fff", fontWeight: 600, fontSize: 13, cursor: "pointer", minHeight: 40 });
const label: React.CSSProperties = { display: "grid", gap: 4, fontSize: 12, color: "var(--muted)" };

export default function AdminUsers() {
  const [users, setUsers] = useState<User[]>([]);
  const [restaurants, setRestaurants] = useState<{ id: string; name: string }[]>([]);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);

  // New-user form state. The single "Name" is the whole identity (it becomes the
  // login id under the hood) — there is no separate username field any more.
  const [nu, setNu] = useState({ role: "manager", restaurant_id: "", name: "", phone: "", password: "" });
  const [showNewPw, setShowNewPw] = useState(false);
  const [creating, setCreating] = useState(false);
  // The password to reveal once after a CREATE (shown at the top until dismissed).
  const [reveal, setReveal] = useState<{ name: string; password: string } | null>(null);

  // Which user's edit modal is open (null = closed) + a working copy of editable fields.
  const [editId, setEditId] = useState<string | null>(null);
  const editing = users.find((u) => u.id === editId) || null;

  const load = useCallback(async () => {
    setErr("");
    try {
      const [ur, rr] = await Promise.all([
        fetch("/api/admin/users", { cache: "no-store" }),
        fetch("/api/admin/restaurants", { cache: "no-store" }),
      ]);
      const j = await ur.json();
      if (!ur.ok) { setErr(j.error || "Failed to load."); return; }
      setUsers(j.users || []);
      const rj = await rr.json().catch(() => ({}));
      const rests = rj.restaurants || [];
      setRestaurants(rests);
      // Default the "Add user" restaurant to the first one until the admin picks.
      setNu((n) => (n.restaurant_id ? n : { ...n, restaurant_id: rests[0]?.id || "" }));
    } catch { setErr("Network error."); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setErr(""); setCreating(true);
    try {
      const r = await fetch("/api/admin/users", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(nu) });
      const j = await r.json();
      if (!r.ok) { setErr(j.error || "Could not create user."); return; }
      setReveal({ name: j.name || j.username, password: j.password });
      setNu((n) => ({ role: "manager", restaurant_id: n.restaurant_id, name: "", phone: "", password: "" }));
      setShowNewPw(false);
      load();
    } catch { setErr("Network error."); }
    finally { setCreating(false); }
  }

  return (
    <>
      <h1 className="adm-page-h">Users &amp; access</h1>
      <p className="adm-page-sub">Create logins for any restaurant&apos;s manager, kitchen and tablet panels — each user is scoped to the restaurant you pick. (Owners are assigned on the Restaurants page.)</p>

      {err ? <div style={{ ...card, borderColor: "#7f1d1d", color: "#fca5a5", marginBottom: 14 }}>{err}</div> : null}

      {/* One-time password reveal banner (after CREATE) */}
      {reveal ? (
        <div style={{ ...card, borderColor: "#166534", marginBottom: 14 }}>
          <div style={{ fontSize: 13, color: "#86efac" }}>
            Password for <b>{reveal.name}</b> — copy it now, it won&apos;t be shown again:
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
            <code style={{ fontSize: 18, background: "var(--bg)", padding: "8px 12px", borderRadius: 8, letterSpacing: 1 }}>{reveal.password}</code>
            <button style={btn("#3b82f6")} onClick={() => navigator.clipboard?.writeText(reveal.password)}>Copy</button>
            <button style={btn("#374151")} onClick={() => setReveal(null)}>Done</button>
          </div>
        </div>
      ) : null}

      {/* Create user */}
      <section style={{ ...card, marginBottom: 18 }}>
        <h2 style={{ fontSize: 15, margin: "0 0 12px" }}>Add a user</h2>
        <form onSubmit={create} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, alignItems: "end" }}>
          <label style={label}>
            Name
            <input value={nu.name} onChange={(e) => setNu({ ...nu, name: e.target.value })} placeholder="e.g. Raj" autoCapitalize="words" style={field} required />
          </label>
          <label style={label}>
            Restaurant
            <select value={nu.restaurant_id} onChange={(e) => setNu({ ...nu, restaurant_id: e.target.value })} style={field} required>
              {restaurants.length === 0 && <option value="">Loading…</option>}
              {restaurants.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </label>
          <label style={label}>
            Role
            <select value={nu.role} onChange={(e) => setNu({ ...nu, role: e.target.value })} style={field}>
              {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </select>
          </label>
          <label style={label}>
            Phone (optional)
            <input value={nu.phone} onChange={(e) => setNu({ ...nu, phone: e.target.value })} placeholder="Phone" style={field} />
          </label>
          <label style={label}>
            Password (blank = auto)
            {/* Masked by default with a show/hide eye so it never sits on screen as plain text. */}
            <span style={{ position: "relative", display: "block" }}>
              <input type={showNewPw ? "text" : "password"} value={nu.password} onChange={(e) => setNu({ ...nu, password: e.target.value })} placeholder="leave blank to generate" autoComplete="new-password" style={{ ...field, paddingRight: 44 }} />
              <button type="button" onClick={() => setShowNewPw((s) => !s)} aria-label={showNewPw ? "Hide password" : "Show password"} style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", background: "transparent", border: 0, color: "var(--muted)", cursor: "pointer", fontSize: 16, padding: 6 }}>
                {showNewPw ? "🙈" : "👁️"}
              </button>
            </span>
          </label>
          <button type="submit" disabled={creating} style={{ ...btn("#22c55e"), padding: "11px 14px", opacity: creating ? 0.7 : 1 }}>
            {creating ? "Creating…" : "Create user"}
          </button>
        </form>
        <p style={{ fontSize: 12, color: "var(--muted)", margin: "10px 0 0" }}>
          The <b>Name</b> is what they sign in with (and how they appear everywhere) — it must be unique. They confirm their details once on first login and can edit their name/phone, change their password, and set a PIN in their profile.
        </p>
      </section>

      {/* User list — compact rows, ONE button (Edit) each. Everything else lives in the modal. */}
      <section style={{ ...card }}>
        <h2 style={{ fontSize: 15, margin: "0 0 12px" }}>All users {loading ? "" : `(${users.length})`}</h2>
        {loading ? <div style={{ color: "var(--muted)" }}>Loading…</div> : users.length === 0 ? (
          <div style={{ color: "var(--muted)" }}>No users yet — add your first one above.</div>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {users.map((u) => (
              <div key={u.id} style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 12, alignItems: "center", padding: 12, borderRadius: 10, background: "var(--bg)", border: "var(--border)", opacity: u.active ? 1 : 0.55 }}>
                {/* Initial badge */}
                <div aria-hidden style={{ width: 38, height: 38, borderRadius: 999, background: ROLE_COLOR[u.role] || "#9ca3af", color: "var(--bg)", display: "grid", placeItems: "center", fontWeight: 800, fontSize: 16 }}>
                  {(u.name || u.username).charAt(0).toUpperCase()}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <strong style={{ fontSize: 15 }}>{u.name || u.username}</strong>
                    <span style={{ fontSize: 11, fontWeight: 700, color: "var(--bg)", background: ROLE_COLOR[u.role] || "#9ca3af", padding: "2px 8px", borderRadius: 999 }}>{ROLE_LABEL[u.role] || u.role}</span>
                    {!u.active ? <span style={{ fontSize: 11, color: "#fca5a5" }}>disabled</span> : null}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {u.restaurantName ? <><b style={{ color: "var(--text)", fontWeight: 600 }}>{u.restaurantName}</b> · </> : ""}{u.phone || "no phone"} · last seen {u.last_seen_at ? new Date(u.last_seen_at).toLocaleString() : "never"}
                  </div>
                </div>
                <button style={{ ...btn("transparent"), border: "var(--border)", color: "var(--text)" }} onClick={() => setEditId(u.id)}>Edit</button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* The per-user edit modal: all the controls for one person, in one focused place. */}
      {editing ? (
        <EditUserModal
          user={editing}
          onClose={() => setEditId(null)}
          onChanged={load}
          onDeleted={() => { setEditId(null); load(); }}
        />
      ) : null}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// The edit modal. Holds a working copy of the editable fields, a "Save changes"
// button that only sends what actually changed, a password area (masked + one-time
// reveal), and a clearly-separated danger zone for delete.
// ─────────────────────────────────────────────────────────────────────────────
function EditUserModal({ user, onClose, onChanged, onDeleted }: {
  user: User; onClose: () => void; onChanged: () => void; onDeleted: () => void;
}) {
  // Working copy of the editable bits (compared against `user` on save).
  const [form, setForm] = useState({ name: user.name || "", phone: user.phone || "", role: user.role, active: user.active, can_self_reset: user.can_self_reset, can_self_set_pin: user.can_self_set_pin });
  const [saving, setSaving] = useState(false);
  const [mErr, setMErr] = useState("");
  const [ok, setOk] = useState("");

  // Password change state.
  const [pw, setPw] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [pwBusy, setPwBusy] = useState(false);
  const [pwReveal, setPwReveal] = useState<string | null>(null);
  // In-app confirm step (replaces the ugly native browser popup). null = nothing
  // pending; true = a generated password awaiting confirm; false = a typed one.
  const [pendingGen, setPendingGen] = useState<null | boolean>(null);

  // Manager-PIN admin controls (set/clear the manager's PIN directly).
  const [pin, setPin] = useState("");
  const [pinBusy, setPinBusy] = useState(false);
  const [pinMsg, setPinMsg] = useState("");

  async function setManagerPin() {
    setPinMsg(""); setMErr("");
    if (!/^\d{4,8}$/.test(pin.trim())) { setPinMsg("PIN must be 4–8 digits."); return; }
    setPinBusy(true);
    try { await apiPatch({ action: "set_pin", pin: pin.trim() }); setPin(""); setPinMsg("PIN saved."); onChanged(); }
    catch (e: any) { setPinMsg(e.message || "Could not set PIN."); }
    finally { setPinBusy(false); }
  }
  async function clearManagerPin() {
    if (!confirm(`Remove ${user.name || user.username}'s PIN? Until a new one is set, their account can't authorise tablet actions.`)) return;
    setPinMsg(""); setMErr(""); setPinBusy(true);
    try { await apiPatch({ action: "set_pin", clear: true }); setPinMsg("PIN cleared."); onChanged(); }
    catch (e: any) { setPinMsg(e.message || "Could not clear PIN."); }
    finally { setPinBusy(false); }
  }

  // Escape closes; lock background scroll while open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  // Low-level PATCH helper that returns the parsed JSON (or throws a friendly error).
  async function apiPatch(payload: object): Promise<any> {
    const r = await fetch("/api/admin/users", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: user.id, ...payload }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "Action failed.");
    return j;
  }

  // Save only the fields that changed. Role change logs the user out, so confirm it.
  async function save() {
    setMErr(""); setOk("");
    if (form.role !== user.role && !confirm(`Change ${user.name || user.username} to ${ROLE_LABEL[form.role]}? They'll be logged out.`)) return;
    setSaving(true);
    try {
      if (form.name !== (user.name || "") || form.phone !== (user.phone || "")) {
        await apiPatch({ action: "edit", name: form.name, phone: form.phone });
      }
      if (form.role !== user.role) await apiPatch({ action: "set_role", role: form.role });
      if (form.active !== user.active) await apiPatch({ action: "set_active", active: form.active });
      if (form.can_self_reset !== user.can_self_reset || form.can_self_set_pin !== user.can_self_set_pin) {
        await apiPatch({ action: "set_access", can_self_reset: form.can_self_reset, can_self_set_pin: form.can_self_set_pin });
      }
      setOk("Saved.");
      onChanged();
    } catch (e: any) { setMErr(e.message || "Could not save."); }
    finally { setSaving(false); }
  }

  // Step 1: validate, then ask for confirmation IN the panel (no native popup).
  function askReset(generate: boolean) {
    setMErr(""); setOk(""); setPwReveal(null);
    if (!generate && pw.trim().length < 6) { setMErr("Password must be at least 6 characters."); return; }
    setPendingGen(generate);
  }

  // Step 2: actually set the password once the admin confirms in-app.
  async function doReset() {
    if (pendingGen === null) return;
    const generate = pendingGen;
    setPwBusy(true); setMErr("");
    try {
      const j = await apiPatch({ action: "reset_password", password: generate ? "" : pw.trim() });
      setPwReveal(j.password);
      setPw(""); setShowPw(false); setPendingGen(null);
      onChanged();
    } catch (e: any) { setMErr(e.message || "Could not update password."); }
    finally { setPwBusy(false); }
  }

  async function remove() {
    if (!confirm(`Delete "${user.name || user.username}" permanently? They won't be able to log in.`)) return;
    setMErr("");
    try {
      const r = await fetch(`/api/admin/users?id=${encodeURIComponent(user.id)}`, { method: "DELETE" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setMErr(j.error || "Delete failed."); return; }
      onDeleted();
    } catch { setMErr("Network error."); }
  }

  const dirty = form.name !== (user.name || "") || form.phone !== (user.phone || "") || form.role !== user.role || form.active !== user.active || form.can_self_reset !== user.can_self_reset || form.can_self_set_pin !== user.can_self_set_pin;

  return (
    <>
      {/* Scrim — strong enough to isolate the dialog; click to dismiss. */}
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(2,6,16,0.66)", backdropFilter: "blur(2px)", zIndex: 1000, animation: "lfhFade 160ms ease-out" }} />
      <div role="dialog" aria-modal="true" aria-label={`Edit ${user.name || user.username}`} style={{ position: "fixed", inset: 0, zIndex: 1001, display: "grid", placeItems: "center", padding: 16, pointerEvents: "none" }}>
        <div style={{ ...card, pointerEvents: "auto", width: "min(96vw, 460px)", maxHeight: "90vh", overflowY: "auto", padding: 0, animation: "lfhPop 180ms cubic-bezier(0.16,1,0.3,1)" }}>
          {/* Header */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "16px 18px", borderBottom: "var(--border)", position: "sticky", top: 0, background: "var(--card)", borderRadius: "14px 14px 0 0" }}>
            <div aria-hidden style={{ width: 36, height: 36, borderRadius: 999, background: ROLE_COLOR[user.role] || "#9ca3af", color: "var(--bg)", display: "grid", placeItems: "center", fontWeight: 800 }}>{(user.name || user.username).charAt(0).toUpperCase()}</div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 16, fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user.name || user.username}</div>
              <div style={{ fontSize: 11, color: "var(--muted)" }}>
                {user.hasPin ? "🔑 PIN set · " : ""}created {new Date(user.created_at).toLocaleDateString()} · last seen {user.last_seen_at ? new Date(user.last_seen_at).toLocaleString() : "never"}
              </div>
            </div>
            <button onClick={onClose} aria-label="Close" style={{ marginLeft: "auto", background: "transparent", border: 0, color: "var(--muted)", fontSize: 22, cursor: "pointer", lineHeight: 1, padding: 6 }}>×</button>
          </div>

          <div style={{ padding: 18, display: "grid", gap: 16 }}>
            {mErr ? <div style={{ ...card, padding: 12, borderColor: "#7f1d1d", color: "#fca5a5" }}>{mErr}</div> : null}
            {ok ? <div style={{ ...card, padding: 12, borderColor: "#166534", color: "#86efac" }}>{ok}</div> : null}

            {/* Details */}
            <div style={{ display: "grid", gap: 10 }}>
              <label style={label}>Name <span style={{ color: "var(--muted)" }}>· this is their login</span>
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Raj" style={field} />
              </label>
              <label style={label}>Phone
                <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="Phone" style={field} />
              </label>
              <label style={label}>Role
                <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} style={field}>
                  {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                </select>
              </label>
            </div>

            {/* Toggles */}
            <div style={{ display: "grid", gap: 8 }}>
              <ToggleRow
                title="Account active" desc="Turn off to block this person from logging in."
                on={form.active} onChange={(v) => setForm({ ...form, active: v })}
              />
              <ToggleRow
                title="Can change own password" desc="Off = only you (admin) can reset it for them."
                on={form.can_self_reset} onChange={(v) => setForm({ ...form, can_self_reset: v })}
              />
              {form.role === "manager" ? (
                <ToggleRow
                  title="Can change own PIN" desc="Off = only you (admin) can set their manager PIN; the option is hidden from their profile."
                  on={form.can_self_set_pin} onChange={(v) => setForm({ ...form, can_self_set_pin: v })}
                />
              ) : null}
            </div>

            <button onClick={save} disabled={!dirty || saving} style={{ ...btn("#22c55e"), opacity: !dirty || saving ? 0.5 : 1 }}>
              {saving ? "Saving…" : dirty ? "Save changes" : "No changes"}
            </button>

            {/* Password area */}
            <div style={{ ...card, padding: 14, background: "var(--bg)" }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>🔒 Password</div>
              {pwReveal ? (
                <div style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 12, color: "#86efac" }}>New password — copy it now, it won&apos;t be shown again:</div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6, flexWrap: "wrap" }}>
                    <code style={{ fontSize: 17, background: "var(--bg)", padding: "8px 12px", borderRadius: 8, letterSpacing: 1 }}>{pwReveal}</code>
                    <button style={btn("#3b82f6")} onClick={() => navigator.clipboard?.writeText(pwReveal)}>Copy</button>
                  </div>
                </div>
              ) : null}
              <span style={{ position: "relative", display: "block" }}>
                <input type={showPw ? "text" : "password"} value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Type a new password…" autoComplete="new-password" style={{ ...field, paddingRight: 44 }} />
                <button type="button" onClick={() => setShowPw((s) => !s)} aria-label={showPw ? "Hide password" : "Show password"} style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", background: "transparent", border: 0, color: "var(--muted)", cursor: "pointer", fontSize: 16, padding: 6 }}>
                  {showPw ? "🙈" : "👁️"}
                </button>
              </span>
              {pendingGen === null ? (
                <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                  <button style={btn("#3b82f6")} onClick={() => askReset(false)}>Set password</button>
                  <button style={btn("#374151")} onClick={() => askReset(true)}>Generate random</button>
                </div>
              ) : (
                /* In-app confirmation (no browser popup from the top). */
                <div style={{ marginTop: 10, padding: 12, borderRadius: 10, background: "#1a1407", border: "1px solid #b45309" }}>
                  <div style={{ fontSize: 12.5, color: "#fcd34d", display: "flex", gap: 8, alignItems: "flex-start", lineHeight: 1.45 }}>
                    <span aria-hidden>⚠️</span>
                    <span>This sets a {pendingGen ? "new random" : "new"} password for <b>{user.name || user.username}</b> and <b>logs them out on every device</b>. They&apos;ll need the new password to sign back in.</span>
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                    <button style={{ ...btn("#b45309"), opacity: pwBusy ? 0.6 : 1 }} disabled={pwBusy} onClick={doReset}>{pwBusy ? "Setting…" : "Yes, set new password"}</button>
                    <button style={btn("#374151")} disabled={pwBusy} onClick={() => setPendingGen(null)}>Cancel</button>
                  </div>
                </div>
              )}
            </div>

            {/* Manager PIN — admin set/clear (managers only). The PIN unlocks the
                tablet's gated actions; a manager can also set it themselves if their
                "Can change own PIN" toggle is on. */}
            {user.role === "manager" ? (
              <div style={{ ...card, padding: 14, background: "var(--bg)" }}>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>🔑 Manager PIN {user.hasPin ? <span style={{ color: "#86efac", fontWeight: 500 }}>· set</span> : <span style={{ color: "var(--muted)", fontWeight: 500 }}>· not set</span>}</div>
                {pinMsg ? <div style={{ fontSize: 12, color: pinMsg.includes("saved") || pinMsg.includes("cleared") ? "#86efac" : "#fca5a5", marginBottom: 8 }}>{pinMsg}</div> : null}
                <input value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} placeholder="4–8 digit PIN" inputMode="numeric" maxLength={8} style={{ ...field, letterSpacing: 2 }} />
                <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                  <button style={{ ...btn("#8b5cf6"), opacity: pinBusy ? 0.6 : 1 }} disabled={pinBusy} onClick={setManagerPin}>{user.hasPin ? "Change PIN" : "Set PIN"}</button>
                  {user.hasPin ? <button style={{ ...btn("#374151"), opacity: pinBusy ? 0.6 : 1 }} disabled={pinBusy} onClick={clearManagerPin}>Clear PIN</button> : null}
                </div>
              </div>
            ) : null}

            {/* Danger zone — visually + spatially separated from everything else. */}
            <div style={{ ...card, padding: 14, borderColor: "#7f1d1d", background: "#1a0f14" }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#fca5a5", marginBottom: 6 }}>Danger zone</div>
              <div style={{ fontSize: 12, color: "#caa", marginBottom: 10 }}>Deleting removes this login permanently — it can&apos;t be undone.</div>
              <button style={btn("#991b1b")} onClick={remove}>Delete user</button>
            </div>
          </div>
        </div>
      </div>

      {/* Tiny keyframes for the modal entrance (no layout shift — opacity + transform only). */}
      <style>{`@keyframes lfhFade{from{opacity:0}to{opacity:1}}@keyframes lfhPop{from{opacity:0;transform:scale(0.96) translateY(8px)}to{opacity:1;transform:scale(1) translateY(0)}}`}</style>
    </>
  );
}

// A simple labelled on/off toggle row used inside the modal.
function ToggleRow({ title, desc, on, onChange }: { title: string; desc: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" onClick={() => onChange(!on)} style={{ display: "flex", alignItems: "center", gap: 12, textAlign: "left", padding: 12, borderRadius: 10, background: "var(--bg)", border: "var(--border)", cursor: "pointer", color: "var(--text)" }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{title}</div>
        <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>{desc}</div>
      </div>
      {/* Track + knob */}
      <span aria-hidden style={{ width: 42, height: 24, borderRadius: 999, background: on ? "#22c55e" : "#374151", position: "relative", flexShrink: 0, transition: "background 160ms ease" }}>
        <span style={{ position: "absolute", top: 2, left: on ? 20 : 2, width: 20, height: 20, borderRadius: 999, background: "#fff", transition: "left 160ms ease" }} />
      </span>
    </button>
  );
}
