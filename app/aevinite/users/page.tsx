"use client";
// /aevinite/users — the admin's staff-user manager. Create logins for the three
// panels (manager / kitchen / tablet); then EVERYTHING about an existing user
// (rename, role, password, enable/disable, self-reset, delete) lives inside a
// per-user EDIT panel that opens as a modal — the list itself stays clean and
// only shows who each person is, not a wall of buttons. Behind the admin gate
// via the /aevinite layout. All data comes from /api/admin/users (service-role,
// admin-cookie protected). Passwords are stored HASHED — the only time one is
// ever visible is the one-time "copy it now" reveal right after you set it.
import { useCallback, useEffect, useRef, useState } from "react";
import { useAdminModal } from "@/components/admin/useAdminModal";
import { CopyButton } from "@/components/admin/CopyButton";

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
  // Synchronous re-entry guard so a fast double-click can't create the same user twice
  // before the async `creating` state disables the button (audit 2026-07-07).
  const creatingRef = useRef(false);
  // The password to reveal once after a CREATE (shown at the top until dismissed).
  const [reveal, setReveal] = useState<{ name: string; password: string } | null>(null);

  // Which user's edit modal is open (null = closed) + a working copy of editable fields.
  const [editId, setEditId] = useState<string | null>(null);
  const editing = users.find((u) => u.id === editId) || null;

  // ── List filters (all client-side over the data we already loaded — no extra reads) ──
  // Merged 2026-07-08: main added a free-text search (admin audit 2026-07-07); this
  // adds a restaurant SCOPE + combinable role chips on top. Together they keep the
  // list to just the people you care about across many restaurants.
  // filterRid = "" means "All restaurants"; otherwise scope to one restaurant.
  const [filterRid, setFilterRid] = useState("");
  // Which roles to show. Empty = all roles. Roles combine (e.g. manager + tablet).
  const [filterRoles, setFilterRoles] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  // Spotlight redesign (owner 2026-07-24): the create form is tucked behind a "+ Add user"
  // button so the SEARCH is the hero. Opens on demand.
  const [addOpen, setAddOpen] = useState(false);

  const scopedName = filterRid ? restaurants.find((r) => r.id === filterRid)?.name : "";

  // When the admin scopes to ONE restaurant, lock the "Add a user" form to it so a
  // new user can't accidentally be created under the wrong restaurant.
  useEffect(() => {
    if (filterRid) setNu((n) => (n.restaurant_id === filterRid ? n : { ...n, restaurant_id: filterRid }));
  }, [filterRid]);

  const toggleRole = (r: string) =>
    setFilterRoles((prev) => (prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r]));

  const q = search.trim().toLowerCase();
  const visible = users.filter((u) =>
    (!filterRid || u.restaurant_id === filterRid) &&
    (filterRoles.length === 0 || filterRoles.includes(u.role)) &&
    (!q ||
      (u.name || u.username).toLowerCase().includes(q) ||
      (ROLE_LABEL[u.role] || u.role).toLowerCase().includes(q) ||
      (u.restaurantName || "").toLowerCase().includes(q) ||
      (u.phone || "").toLowerCase().includes(q))
  );
  const filtered = filterRid !== "" || filterRoles.length > 0 || q !== "";

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
    if (creatingRef.current) return;
    creatingRef.current = true;
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
    finally { setCreating(false); creatingRef.current = false; }
  }

  // Group the visible users by restaurant (Spotlight "browse by restaurant" list).
  const groups: Record<string, User[]> = {};
  visible.forEach((u) => { const k = u.restaurantName || "No restaurant"; (groups[k] ||= []).push(u); });
  const groupNames = Object.keys(groups).sort((a, b) => a.localeCompare(b));
  const initialOf = (u: User) => (u.name || u.username).charAt(0).toUpperCase();

  return (
    <div className="usp">
      <UsersStyle />
      <h1 className="adm-page-h">Users &amp; access</h1>
      <p className="adm-page-sub">Every staff login across your restaurants. Search a person, or filter by restaurant / role — then tap them to edit. (Owners are assigned on the Restaurants page.)</p>

      {err ? <div className="usp-banner err">{err}</div> : null}

      {/* One-time password reveal banner (after CREATE) */}
      {reveal ? (
        <div className="usp-banner ok">
          <div style={{ fontSize: 13 }}>Password for <b>{reveal.name}</b> — copy it now, it won&apos;t be shown again:</div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
            <code className="usp-code">{reveal.password}</code>
            <CopyButton className="usp-btn blue" text={reveal.password} />
            <button className="usp-btn ghost" onClick={() => setReveal(null)}>Done</button>
          </div>
        </div>
      ) : null}

      {/* ── Spotlight hero: search is the star ── */}
      <div className="usp-hero">
        <label className="usp-search">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search a person — name, role, restaurant or phone…" aria-label="Search users" />
          {search ? <button type="button" className="clr" onClick={() => setSearch("")} aria-label="Clear">×</button> : null}
        </label>
        <div className="usp-tools">
          <select value={filterRid} onChange={(e) => setFilterRid(e.target.value)} className="usp-sel" aria-label="Filter by restaurant">
            <option value="">All restaurants</option>
            {restaurants.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <div className="usp-chips">
            <button type="button" onClick={() => setFilterRoles([])} className={`usp-chip ${filterRoles.length === 0 ? "on" : ""}`}>All</button>
            {ROLES.map((r) => (
              <button key={r} type="button" onClick={() => toggleRole(r)} className={`usp-chip ${filterRoles.includes(r) ? "on" : ""}`}>
                <span className="dot" style={{ background: ROLE_COLOR[r] }} />{ROLE_LABEL[r]}
              </button>
            ))}
          </div>
          {filtered ? <button type="button" className="usp-clear" onClick={() => { setFilterRid(""); setFilterRoles([]); setSearch(""); }}>Clear</button> : null}
          <button type="button" className={`usp-add ${addOpen ? "open" : ""}`} onClick={() => setAddOpen((o) => !o)}>{addOpen ? "×  Close" : "+  Add user"}</button>
        </div>
      </div>

      {/* Create user — collapsible so search stays the hero */}
      {addOpen ? (
      <section className="usp-addpanel">
        <h2 style={{ fontSize: 15, margin: "0 0 12px" }}>
          Add a user{scopedName ? <> to <span style={{ color: "var(--text)" }}>{scopedName}</span></> : ""}
        </h2>
        <form onSubmit={create} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, alignItems: "end" }}>
          <label style={label}>
            Username
            <input value={nu.name} onChange={(e) => setNu({ ...nu, name: e.target.value })} placeholder="e.g. raj (their login)" autoCapitalize="none" style={field} required />
          </label>
          {/* When scoped to one restaurant the target is locked (shown read-only) so a
              new user can't land in the wrong restaurant. Pick "All restaurants" above
              to choose freely again. */}
          {scopedName ? (
            <label style={label}>
              Restaurant
              <div style={{ ...field, display: "flex", alignItems: "center", gap: 6, opacity: 0.85 }} title="Scoped by the filter above — switch to “All restaurants” to change">
                <span aria-hidden>🔒</span><span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{scopedName}</span>
              </div>
            </label>
          ) : (
            <label style={label}>
              Restaurant
              <select value={nu.restaurant_id} onChange={(e) => setNu({ ...nu, restaurant_id: e.target.value })} style={field} required>
                {restaurants.length === 0 && <option value="">{loading ? "Loading…" : "No restaurants yet — create one first"}</option>}
                {restaurants.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </label>
          )}
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
        <p className="usp-formhint">
          The <b>Username</b> is what they sign in with (and how they appear everywhere) — it must be unique. They can change their password and set a PIN in their own profile after signing in.
        </p>
      </section>
      ) : null}

      {/* Count + grouped results (browse by restaurant) */}
      <div className="usp-count">{loading ? "Loading…" : filtered ? `${visible.length} of ${users.length} shown` : `${users.length} ${users.length === 1 ? "person" : "people"}`}</div>
      {loading ? null : users.length === 0 ? (
        <div className="usp-empty">No users yet — add your first one with “+ Add user”.</div>
      ) : visible.length === 0 ? (
        <div className="usp-empty">No one matches. Try a different search, or clear the filters.</div>
      ) : (
        <div className="usp-results">
          {groupNames.map((gname) => (
            <div className="usp-group" key={gname}>
              <div className="usp-group-h"><span>{gname}</span><b>{groups[gname].length}</b></div>
              {groups[gname].map((u) => (
                <button key={u.id} className={`usp-row ${u.active ? "" : "off"}`} onClick={() => setEditId(u.id)}>
                  <span className="av" style={{ background: ROLE_COLOR[u.role] || "#64748b" }} aria-hidden>{initialOf(u)}</span>
                  <span className="pi">
                    <span className="nm">{u.name || u.username}{u.hasPin ? <span className="pin" title="PIN set">🔑</span> : null}{!u.active ? <em>disabled</em> : null}</span>
                    <span className="mt">{u.phone || "no phone"} · last seen {u.last_seen_at ? new Date(u.last_seen_at).toLocaleDateString() : "never"}</span>
                  </span>
                  <span className="rp" style={{ color: ROLE_COLOR[u.role], background: `color-mix(in srgb, ${ROLE_COLOR[u.role]} 16%, transparent)` }}>{ROLE_LABEL[u.role] || u.role}</span>
                  <svg className="chev" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* The per-user edit modal: all the controls for one person, in one focused place. */}
      {editing ? (
        <EditUserModal
          user={editing}
          onClose={() => setEditId(null)}
          onChanged={load}
          onDeleted={() => { setEditId(null); load(); }}
        />
      ) : null}
    </div>
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
  // One line: phone Back + Escape close it, focus trapped inside, page behind frozen.
  const dialogRef = useRef<HTMLDivElement>(null);
  useAdminModal(dialogRef, "admin-edit-user", onClose);

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
    // A role change logs the user out, so confirm it — but cancelling must only skip the
    // ROLE change, not throw away the name/phone/access edits too (audit 2026-07-08).
    let doRole = form.role !== user.role;
    if (doRole && !confirm(`Change ${user.name || user.username} to ${ROLE_LABEL[form.role]}? They'll be logged out.`)) doRole = false;
    setSaving(true);
    try {
      if (form.name !== (user.name || "") || form.phone !== (user.phone || "")) {
        await apiPatch({ action: "edit", name: form.name, phone: form.phone });
      }
      if (doRole) await apiPatch({ action: "set_role", role: form.role });
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
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={`Edit ${user.name || user.username}`} style={{ position: "fixed", inset: 0, zIndex: 1001, display: "grid", placeItems: "center", padding: 16, pointerEvents: "none" }}>
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
              <label style={label}>Username <span style={{ color: "var(--muted)" }}>· this is their login</span>
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
                    <CopyButton style={btn("#3b82f6")} text={pwReveal} />
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
                <div style={{ marginTop: 10, padding: 12, borderRadius: 10, background: "color-mix(in srgb, #b45309 12%, var(--card))", border: "1px solid color-mix(in srgb, #b45309 55%, transparent)" }}>
                  <div style={{ fontSize: 12.5, color: "var(--text)", display: "flex", gap: 8, alignItems: "flex-start", lineHeight: 1.45 }}>
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
            <div style={{ ...card, padding: 14, borderColor: "var(--adm-danger)", background: "color-mix(in srgb, var(--adm-danger) 9%, var(--card))" }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--adm-danger)", marginBottom: 6 }}>Danger zone</div>
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

// Spotlight look for the list view (owner 2026-07-24): electric-blue accent + a search-first
// hero + grouped result rows. Scoped to .usp so the rest of the admin keeps its own accent.
function UsersStyle() {
  return <style jsx global>{`
  .usp { --ub:#3b82f6; --ub2:#60a5fa; max-width:1100px; }
  .usp-banner { border-radius:14px; padding:14px 16px; margin-bottom:14px; border:var(--border); background:var(--card); }
  .usp-banner.err { border-color:#7f1d1d; color:#fca5a5; }
  .usp-banner.ok { border-color:#166534; color:#86efac; }
  .usp-code { font-size:18px; background:var(--bg); padding:8px 12px; border-radius:8px; letter-spacing:1px; }
  .usp-btn { padding:9px 14px; border-radius:9px; border:0; font-weight:700; font-size:13px; cursor:pointer; color:#fff; }
  .usp-btn.blue { background:var(--ub); } .usp-btn.ghost { background:#374151; }
  .usp-hero { border-radius:18px; padding:18px; margin-bottom:14px; border:var(--border);
    background: radial-gradient(700px 200px at 50% -40%, color-mix(in srgb, var(--ub) 22%, transparent), transparent 70%), var(--card); }
  .usp-search { display:flex; align-items:center; gap:13px; height:60px; padding:0 18px; border-radius:14px; background:var(--bg); border:1px solid var(--border); transition:border-color .15s, box-shadow .15s; }
  .usp-search:focus-within { border-color:var(--ub); box-shadow:0 0 0 4px color-mix(in srgb, var(--ub) 30%, transparent); }
  .usp-search svg { color:var(--muted); flex:none; }
  .usp-search input { flex:1; min-width:0; border:0; background:none; outline:none; color:var(--text); font-size:17px; font-weight:500; }
  .usp-search .clr { border:0; background:none; color:var(--muted); font-size:22px; line-height:1; cursor:pointer; padding:0 4px; flex:none; }
  .usp-tools { display:flex; align-items:center; gap:9px; flex-wrap:wrap; margin-top:13px; }
  .usp-sel { height:38px; border-radius:10px; border:var(--border); background:var(--bg); color:var(--text); font-weight:600; font-size:13px; padding:0 10px; }
  .usp-chips { display:flex; gap:6px; flex-wrap:wrap; }
  .usp-chip { display:flex; align-items:center; gap:7px; height:38px; padding:0 13px; border-radius:10px; border:var(--border); background:var(--bg); color:var(--muted); font-weight:700; font-size:12.5px; cursor:pointer; }
  .usp-chip .dot { width:8px; height:8px; border-radius:50%; }
  .usp-chip.on { border-color:var(--ub); background:color-mix(in srgb, var(--ub) 15%, transparent); color:var(--text); }
  .usp-clear { height:38px; padding:0 12px; border-radius:10px; border:var(--border); background:none; color:var(--muted); font-weight:600; font-size:12.5px; cursor:pointer; }
  .usp-add { margin-left:auto; height:38px; padding:0 16px; border-radius:10px; border:0; background:var(--ub); color:#fff; font-weight:700; font-size:13px; cursor:pointer; box-shadow:0 4px 14px color-mix(in srgb, var(--ub) 40%, transparent); }
  .usp-add.open { background:#374151; box-shadow:none; }
  .usp-addpanel { border-radius:16px; padding:18px; margin-bottom:16px; border:1px solid color-mix(in srgb, var(--ub) 40%, var(--border)); background:var(--card); }
  .usp-formhint { font-size:12px; color:var(--muted); margin:10px 0 0; }
  .usp-count { font-size:12px; font-weight:700; letter-spacing:.04em; text-transform:uppercase; color:var(--muted); margin:6px 2px 10px; }
  .usp-empty { padding:30px; text-align:center; color:var(--muted); border:var(--border); border-radius:14px; background:var(--card); }
  .usp-results { display:flex; flex-direction:column; gap:18px; }
  .usp-group-h { display:flex; align-items:center; gap:9px; padding:0 4px 8px; font-size:12.5px; font-weight:800; color:var(--text); }
  .usp-group-h b { font-family:ui-monospace,monospace; font-size:11px; font-weight:700; color:var(--muted); background:var(--card); border:var(--border); border-radius:20px; padding:2px 9px; }
  .usp-row { display:flex; align-items:center; gap:13px; width:100%; text-align:left; padding:11px 14px; margin-bottom:8px; border-radius:12px; background:var(--card); border:1px solid var(--border); cursor:pointer; transition:border-color .13s, background .13s; }
  .usp-row:hover { border-color:var(--ub); background:color-mix(in srgb, var(--ub) 7%, var(--card)); }
  .usp-row:hover .chev { color:var(--ub); transform:translateX(2px); }
  .usp-row.off { opacity:.55; }
  .usp-row .av { width:40px; height:40px; border-radius:11px; display:grid; place-items:center; color:#0b0f16; font-weight:800; font-size:16px; flex:none; }
  .usp-row .pi { flex:1; min-width:0; }
  .usp-row .nm { display:flex; align-items:center; gap:7px; font-size:14.5px; font-weight:700; color:var(--text); }
  .usp-row .nm em { font-style:normal; font-size:10.5px; font-weight:700; color:#fca5a5; background:color-mix(in srgb,#ef4444 16%,transparent); padding:2px 7px; border-radius:20px; }
  .usp-row .nm .pin { font-size:12px; }
  .usp-row .mt { display:block; font-size:12px; color:var(--muted); margin-top:2px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .usp-row .rp { font-size:11px; font-weight:800; padding:4px 10px; border-radius:20px; flex:none; }
  .usp-row .chev { color:var(--muted); flex:none; transition:color .13s, transform .13s; }
  @media (max-width:640px){ .usp-add { margin-left:0; } .usp-row .rp { display:none; } }
  `}</style>;
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
