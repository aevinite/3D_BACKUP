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
import { CopyButton } from "@/components/admin/CopyButton";
import StaffProfile from "@/components/admin/StaffProfile";
import { useOverlayParam } from "@/components/admin/useOverlayParam";
import { SkelList, SkelLine } from "@/components/admin/Skeleton";

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

  // Which person's profile is open (null = closed). It lives in the URL (?staff=<id>) so a
  // REFRESH LEAVES YOU EXACTLY WHERE YOU ARE instead of dropping you back on the list — owner,
  // 2026-08-02: "I refresh, why do I go back to the main thing? I should be staying here."
  // Back closes the profile as a bonus, and the address bar is a link to that person.
  const [editId, setEditId] = useOverlayParam("staff");

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
      <div className="usp-count">{loading ? <SkelLine w={92} size="sm" /> : filtered ? `${visible.length} of ${users.length} shown` : `${users.length} ${users.length === 1 ? "person" : "people"}`}</div>
      {/* Loading shows the SHAPE of the list (avatar + name + meta + role pill), so when the
          real rows land nothing moves — it was a bare "Loading…" line that then jumped. */}
      {loading ? <SkelList rows={6} label="Loading users" /> : users.length === 0 ? (
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
                    {/* The ROLE, in words, for the phone. Below 640px the role pill on the right is
                        hidden for width, which left the colour of the avatar circle as the only
                        thing saying whether "diagm11" is a manager or a waiter — and a real person
                        is called Raj, not "…tablet". Hidden above 640px, where the pill says it. */}
                    <span className="mt"><span className="rolew"><b>{ROLE_LABEL[u.role] || u.role}</b>{" · "}</span>{u.phone || "no phone"} · last seen {u.last_seen_at ? new Date(u.last_seen_at).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" }) : "never"}</span>
                  </span>
                  <span className="rp" style={{ ["--hue" as string]: ROLE_COLOR[u.role], background: `color-mix(in srgb, ${ROLE_COLOR[u.role]} 16%, transparent)` }}>{ROLE_LABEL[u.role] || u.role}</span>
                  <svg className="chev" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* The full PROFILE panel — one component for every person in the product; the small
          edit modal that used to live here was replaced by it (owner's design 1, 2026-08-01).
          See components/admin/StaffProfile.tsx for the structure every profile must keep. */}
      {/* Rendered straight off the id, NOT off a row in the loaded list: on a refresh the list
          is still in flight, and waiting for it would flash the list before the profile —
          exactly the "back to the main thing" this fixes. The profile loads its own person. */}
      {editId ? (
        <StaffProfile userId={editId} onClose={() => setEditId(null)} onChanged={load} />
      ) : null}
    </div>
  );
}

// Spotlight look for the list view (owner 2026-07-24): electric-blue accent + a search-first
// hero + grouped result rows. Scoped to .usp so the rest of the admin keeps its own accent.
function UsersStyle() {
  // PLAIN <style>, deliberately NOT `<style jsx global>` (owner, 2026-08-02). styled-jsx
  // injects its CSS from JavaScript AFTER hydration, so this page shipped with none of its
  // own styling in the HTML: every control below painted as a raw browser default — white
  // boxes, unstyled selects, bare "Loading" text — until the bundle downloaded and ran. A
  // plain <style> is server-rendered into the document, and it sits ABOVE the markup it
  // styles, so the CSS is parsed before any of that markup paints. Zero unstyled frames.
  // Do not convert this back to styled-jsx. (/aevinite/rate-limits and /repair were always
  // plain <style> and never had the flash — that is the proof.)
  return <style href="adm-users" precedence="default">{`
  .usp { --ub:#3b82f6; --ub2:#60a5fa; max-width:1100px; }
  .usp-banner { border-radius:14px; padding:14px 16px; margin-bottom:14px; border:var(--border); background:var(--card); }
  .usp-banner.err { border-color:#7f1d1d; color:#fca5a5; }
  .usp-banner.ok { border-color:#166534; color:#86efac; }
  /* ── BOTH BANNERS ON THE LIGHT CONSOLE (sweep T15, 2026-08-18) ────────────────────────────
     #fca5a5 and #86efac are DARK-skin inks and a hard-coded hex cannot follow the skin, so on the
     light console they sat on a white card at 1.90:1 and 1.40:1 (measured; on the dark console
     they read 9.72 and 13.14). The green one is the worst sentence in the product to be unable to
     read — it is the "copy it now, it won't be shown again" line that carries a brand-new
     password — and the red one is every failure this page can report. Same hues taken darker;
     the border and the card are untouched, and the dark console is not touched at all.
     After: 5.61:1 and 6.77:1. (.usp-row .nm em below was fixed the same way in T11.) */
  [data-skin="light"] .usp-banner.err { color: color-mix(in srgb, #fca5a5 55%, #000); }
  [data-skin="light"] .usp-banner.ok  { color: color-mix(in srgb, #86efac 42%, #000); }
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
  /* #fca5a5 on its own 16% wash reads 1.54:1 on the light console — same red, dark enough to read. */
  [data-skin="light"] .usp-row .nm em { color: color-mix(in srgb, #ef4444 62%, #000); }
  .usp-row .nm .pin { font-size:12px; }
  .usp-row .mt { display:block; font-size:12px; color:var(--muted); margin-top:2px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  /* Desktop shows the role in the pill on the right, so the word in the meta line is redundant. */
  .usp-row .mt .rolew { display:none; }
  .usp-row .rp { font-size:11px; font-weight:800; padding:4px 10px; border-radius:20px; flex:none; }
  .usp-row .chev { color:var(--muted); flex:none; transition:color .13s, transform .13s; }
  @media (max-width:640px){
    .usp-add { margin-left:0; }
    /* The pill goes for width — so the role has to be said in words instead, or the colour of the
       avatar circle is the only thing telling a manager from a waiter (sweep T15, 2026-08-18). */
    .usp-row .rp { display:none; }
    /* The separator is REAL TEXT in the markup, not a ::after — generated content is invisible to
       innerText, to a copy-paste and to a screen reader, which is how this looked right in a
       screenshot and read as "Kitchenno phone" to everything else. */
    .usp-row .mt .rolew { display:inline; }
    .usp-row .mt .rolew b { font-weight:800; color:var(--text); }
  }
  `}</style>;
}
