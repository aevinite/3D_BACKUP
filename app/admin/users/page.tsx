"use client";
// /admin/users — the admin's staff-user manager. Create logins for the three
// panels (manager / kitchen / tablet), reset passwords, enable/disable, change
// role, or remove. Behind the admin gate via the /admin layout. All data comes
// from /api/admin/users (service-role, admin-cookie protected).
import { useCallback, useEffect, useState } from "react";

type User = {
  id: string; username: string; role: string; name: string | null; phone: string | null;
  active: boolean; last_seen_at: string | null; created_at: string; hasPin: boolean;
};

const ROLES = ["manager", "kitchen", "tablet"] as const;
const ROLE_LABEL: Record<string, string> = { manager: "Manager", kitchen: "Kitchen", tablet: "Tablet (waiter)" };
const ROLE_COLOR: Record<string, string> = { manager: "#d4a574", kitchen: "#7ec88a", tablet: "#60a5fa" };

const card: React.CSSProperties = { background: "#111a2e", border: "1px solid #1f2c49", borderRadius: 14, padding: 18 };
const field: React.CSSProperties = { boxSizing: "border-box", padding: "10px 12px", borderRadius: 10, border: "1px solid #2a3a5f", background: "#0b1220", color: "#eaf1ff", fontSize: 14 };
const btn = (bg: string): React.CSSProperties => ({ padding: "8px 12px", borderRadius: 9, border: 0, background: bg, color: "#fff", fontWeight: 600, fontSize: 13, cursor: "pointer" });

export default function AdminUsers() {
  const [users, setUsers] = useState<User[]>([]);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);

  // New-user form state
  const [nu, setNu] = useState({ username: "", role: "manager", name: "", phone: "", password: "" });
  const [creating, setCreating] = useState(false);
  // The password to reveal once after a create/reset (shown until dismissed).
  const [reveal, setReveal] = useState<{ username: string; password: string } | null>(null);

  const load = useCallback(async () => {
    setErr("");
    try {
      const r = await fetch("/api/admin/users", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) { setErr(j.error || "Failed to load."); return; }
      setUsers(j.users || []);
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
      setReveal({ username: j.username, password: j.password });
      setNu({ username: "", role: "manager", name: "", phone: "", password: "" });
      load();
    } catch { setErr("Network error."); }
    finally { setCreating(false); }
  }

  async function patch(id: string, payload: object, confirmMsg?: string) {
    if (confirmMsg && !confirm(confirmMsg)) return;
    const r = await fetch("/api/admin/users", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, ...payload }) });
    const j = await r.json();
    if (!r.ok) { setErr(j.error || "Action failed."); return; }
    if (j.password) setReveal({ username: users.find((u) => u.id === id)?.username || "user", password: j.password });
    load();
  }

  async function remove(u: User) {
    if (!confirm(`Delete "${u.username}" permanently? They won't be able to log in.`)) return;
    const r = await fetch(`/api/admin/users?id=${encodeURIComponent(u.id)}`, { method: "DELETE" });
    const j = await r.json();
    if (!r.ok) { setErr(j.error || "Delete failed."); return; }
    load();
  }

  return (
    <main style={{ minHeight: "100vh", background: "#0b1220", color: "#dbe7ff", fontFamily: "system-ui, sans-serif", padding: "20px clamp(12px, 4vw, 40px)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <a href="/admin" style={{ color: "#8aa0c9", textDecoration: "none", fontSize: 14 }}>← Admin</a>
        <h1 style={{ fontSize: 22, margin: 0, fontWeight: 800 }}>👥 Users &amp; access</h1>
      </div>

      {err ? <div style={{ ...card, borderColor: "#7f1d1d", color: "#fca5a5", marginBottom: 14 }}>{err}</div> : null}

      {/* One-time password reveal banner */}
      {reveal ? (
        <div style={{ ...card, borderColor: "#166534", marginBottom: 14 }}>
          <div style={{ fontSize: 13, color: "#86efac" }}>
            Password for <b>{reveal.username}</b> — copy it now, it won&apos;t be shown again:
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 8 }}>
            <code style={{ fontSize: 18, background: "#0b1220", padding: "8px 12px", borderRadius: 8, letterSpacing: 1 }}>{reveal.password}</code>
            <button style={btn("#3b82f6")} onClick={() => navigator.clipboard?.writeText(reveal.password)}>Copy</button>
            <button style={btn("#374151")} onClick={() => setReveal(null)}>Done</button>
          </div>
        </div>
      ) : null}

      {/* Create user */}
      <section style={{ ...card, marginBottom: 18 }}>
        <h2 style={{ fontSize: 15, margin: "0 0 12px" }}>Add a user</h2>
        <form onSubmit={create} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, alignItems: "end" }}>
          <label style={{ display: "grid", gap: 4, fontSize: 12, color: "#8aa0c9" }}>
            Username
            <input value={nu.username} onChange={(e) => setNu({ ...nu, username: e.target.value })} placeholder="e.g. raj" autoCapitalize="none" spellCheck={false} style={field} required />
          </label>
          <label style={{ display: "grid", gap: 4, fontSize: 12, color: "#8aa0c9" }}>
            Role
            <select value={nu.role} onChange={(e) => setNu({ ...nu, role: e.target.value })} style={field}>
              {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </select>
          </label>
          <label style={{ display: "grid", gap: 4, fontSize: 12, color: "#8aa0c9" }}>
            Name (optional)
            <input value={nu.name} onChange={(e) => setNu({ ...nu, name: e.target.value })} placeholder="Full name" style={field} />
          </label>
          <label style={{ display: "grid", gap: 4, fontSize: 12, color: "#8aa0c9" }}>
            Phone (optional)
            <input value={nu.phone} onChange={(e) => setNu({ ...nu, phone: e.target.value })} placeholder="Phone" style={field} />
          </label>
          <label style={{ display: "grid", gap: 4, fontSize: 12, color: "#8aa0c9" }}>
            Password (blank = auto)
            <input value={nu.password} onChange={(e) => setNu({ ...nu, password: e.target.value })} placeholder="leave blank to generate" style={field} />
          </label>
          <button type="submit" disabled={creating} style={{ ...btn("#22c55e"), padding: "11px 14px", opacity: creating ? 0.7 : 1 }}>
            {creating ? "Creating…" : "Create user"}
          </button>
        </form>
        <p style={{ fontSize: 12, color: "#6f86b0", margin: "10px 0 0" }}>
          The person sets their own name/phone on first login if you leave them blank, and can set a personal PIN in their profile.
        </p>
      </section>

      {/* User list */}
      <section style={{ ...card }}>
        <h2 style={{ fontSize: 15, margin: "0 0 12px" }}>All users {loading ? "" : `(${users.length})`}</h2>
        {loading ? <div style={{ color: "#8aa0c9" }}>Loading…</div> : users.length === 0 ? (
          <div style={{ color: "#8aa0c9" }}>No users yet — add your first one above.</div>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {users.map((u) => (
              <div key={u.id} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, alignItems: "center", padding: 12, borderRadius: 10, background: "#0e1830", border: "1px solid #1f2c49", opacity: u.active ? 1 : 0.55 }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <strong style={{ fontSize: 15 }}>{u.username}</strong>
                    <span style={{ fontSize: 11, fontWeight: 700, color: "#0b1220", background: ROLE_COLOR[u.role] || "#9ca3af", padding: "2px 8px", borderRadius: 999 }}>{ROLE_LABEL[u.role] || u.role}</span>
                    {!u.active ? <span style={{ fontSize: 11, color: "#fca5a5" }}>disabled</span> : null}
                    {u.hasPin ? <span style={{ fontSize: 11, color: "#8aa0c9" }}>🔑 PIN set</span> : null}
                  </div>
                  <div style={{ fontSize: 12, color: "#8aa0c9", marginTop: 3 }}>
                    {u.name || "—"} · {u.phone || "no phone"} · last seen {u.last_seen_at ? new Date(u.last_seen_at).toLocaleString() : "never"}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                  <select defaultValue={u.role} onChange={(e) => { if (e.target.value !== u.role) patch(u.id, { action: "set_role", role: e.target.value }, `Change ${u.username} to ${ROLE_LABEL[e.target.value]}? They'll be logged out.`); }} style={{ ...field, padding: "6px 8px", fontSize: 12 }}>
                    {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                  </select>
                  <button style={btn("#3b82f6")} onClick={() => patch(u.id, { action: "reset_password" }, `Reset ${u.username}'s password? They'll be logged out everywhere.`)}>Reset pw</button>
                  <button style={btn(u.active ? "#b45309" : "#15803d")} onClick={() => patch(u.id, { action: "set_active", active: !u.active })}>{u.active ? "Disable" : "Enable"}</button>
                  <button style={btn("#991b1b")} onClick={() => remove(u)}>Delete</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
