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
import { asSuffix } from "@/lib/ownerPin";
import { MANAGER_POWER_FLAGS, ABSENT_ON_POWERS, PERM_BY_ID } from "@/lib/accessModel";

type Perms = Record<string, boolean>;
type Restaurant = { id: string; name: string; slug: string; accentColor: string; managerPermissions: Perms; ownerEntitlements?: Perms; modules?: Record<string, boolean>; payAccess?: PayAccess; tableCount?: number };
type Staff = { id: string; username: string; role: string; name: string | null; phone: string | null; active: boolean; restaurant_id: string; hasPin: boolean; last_seen_at?: string | null; permissions?: Record<string, string>;
  // Profiles & pay (mig 220). profileEligible is false for KITCHEN (no profile, owner's call)
  // and for any restaurant without the module — the row then shows account actions only.
  profileEligible?: boolean; completeness?: { filled: number; total: number } | null;
  joined_on?: string | null; designation?: string | null;
  pay_type?: string | null; pay_amount?: number | null;
  paidThisMonth?: number; advanceOutstanding?: number; lastPaidOn?: string | null; payHidden?: boolean };
type PayAccess = { moduleOn: boolean; canSeePay: boolean; canRecordPay: boolean; canEditProfile: boolean; canEditJobPay: boolean };

// Per-user override caps for a WAITER (tablet) account — the tablet_* keys tabletPerm enforces.
// The module gate (or null) is what the admin must have enabled for the restaurant; a gated cap
// whose module is OFF is greyed here (and refused server-side by GAP-B).
const WAITER_CAPS: [string, string, string | null][] = [
  ["tablet_mark_paid", "Mark bill paid", null],
  ["tablet_discount", "Give discount", null],
  ["tablet_invoice", "Generate invoice", null],
  ["tablet_take_orders", "Take orders", "take_orders"],
  ["tablet_parcel", "Parcel / takeaway", "parcel"],
  ["tablet_table_ops", "Table & KOT ops", "table_ops"],
  ["tablet_table_tags", "Mark table types", "table_tags"],
  ["tablet_khata", "Khata (pay later)", "table_tags"],
  ["tablet_banquet", "Banquet billing", "banquet"],
];
const OVR_MODES: [string, string][] = [["default", "Default"], ["on", "On"], ["pin", "PIN"], ["off", "Off"]];

// Owner-page copy per power flag (shorter, owner-voiced). The FLAG LIST itself is
// DERIVED from lib/accessModel.ts (2026-07-26) so this page can never miss a power the
// admin panel + server know about (the old hand-typed list was missing view_logs); a
// flag without copy here still renders, using the access model's own name/description.
const PERM_COPY: Record<string, [string, string]> = {
  manage_staff: ["Manage staff", "Add / remove team members"],
  edit_menu: ["Edit menu", "Change dishes, prices, categories"],
  give_discounts: ["Give discounts", "Apply a discount to a bill"],
  view_dashboard: ["View dashboard", "See sales numbers & charts"],
  void_bills: ["Void bills", "Cancel / void an invoiced bill"],
  edit_settings: ["Change settings", "Edit restaurant settings & preferences"],
  view_ratings: ["Guest ratings", "See & handle guest star-ratings"],
  view_logs: ["Activity log", "See the restaurant's activity record — who did what"],
  table_tags: ["Mark table types", "Mark tables VIP / Family / Owner's guest + settle on the house"],
  khata: ["Pay later (khata)", "Park bills on a person & collect later"],
  banquet: ["Banquet billing", "Create fixed-plate banquet bills"],
  table_ops: ["Table & KOT operations", "Merge tables, move KOTs/items, split bills"],
  take_orders: ["Take orders", "Start a new dine-in order at a table, like the waiter tablet"],
  parcel: ["Parcel / takeaway", "Punch in a quick takeaway (parcel) order from the floor — shows in the Platform board"],
  platform: ["Platform board", "See & manage online delivery orders (Zomato / Swiggy / website) in the 🛵 Platform tab"],
  table_assign: ["Give waiters their own tables", "Decide which tables each waiter's tablet shows — turn this off to keep sections in your hands only"],
};
const PERMS: [string, string, string][] = MANAGER_POWER_FLAGS.map((f) => {
  const p = PERM_BY_ID[f];
  return [f, PERM_COPY[f]?.[0] || p?.name || f, PERM_COPY[f]?.[1] || p?.what || ""];
});
const ROLES = ["manager", "kitchen", "tablet"];
// Powers that only exist while the "Staff profiles & pay" module is on for that restaurant
// (mig 220). With the module off these would be dead switches, so they're not rendered at all.
const PAYROLL_POWERS = new Set(["see_staff_pay", "record_staff_payment", "edit_staff_profiles"]);
const money = (n: number | null | undefined) => "\u20b9" + Math.round(Number(n || 0)).toLocaleString("en-IN");

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
  // Waiter sections: which tables the person being added will serve, and which restaurant's
  // Add form is currently showing the waiter role. A waiter must be given at least one table
  // (owner 2026-07-30), so the Add button stays disabled until one is picked.
  const [newRole, setNewRole] = useState<Record<string, string>>({});
  const [newTables, setNewTables] = useState<Record<string, number[]>>({});
  // Bumped only to force a re-render so a controlled <select> snaps back to the real value
  // when the owner cancels a role change (otherwise the native picker keeps the chosen row).
  const [, forceRerender] = useState(0);
  // Inline rename / edit-phone editor: which row is open + its draft values.
  const [editing, setEditing] = useState<{ id: string; name: string; phone: string } | null>(null);
  // Two views of the same page: the PEOPLE (a roster you open a profile from) and the POWERS
  // (what managers here may do). Splitting them stopped the page being one long scroll where
  // the person list was buried under toggles. ?tab=powers deep-links the second one.
  const [tab, setTab] = useState<"team" | "powers">(() =>
    typeof window !== "undefined" && new URLSearchParams(window.location.search).get("tab") === "powers" ? "powers" : "team");
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
  // Same pin, but for a PAGE link (the profile route) rather than an API call.
  const withRid = useCallback((p: string) => (scopePin ? `${p}?rid=${scopePin}` : p), [scopePin]);
  const withScope = useCallback(
    (p: string) => (scopePin ? `${p}${p.includes("?") ? "&" : "?"}scope=${scopePin}${asSuffix()}` : p),
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

  // Per-user override for a waiter's tablet cap (Default/On/PIN/Off). Server (GAP-B) refuses a
  // grant beyond the restaurant's ceiling; the UI also greys those, so this only ever sends valid ones.
  async function setUserPerm(u: Staff, key: string, v: string) {
    setStaff((prev) => prev.map((x) => x.id === u.id ? { ...x, permissions: { ...(x.permissions || {}), [key]: v } } : x));
    try {
      const d = await call(withScope("/api/owner/staff"), { method: "PATCH", body: JSON.stringify({ id: u.id, action: "set_permissions", permissions: { [key]: v === "default" ? null : v } }) });
      setStaff((prev) => prev.map((x) => x.id === u.id ? { ...x, permissions: d.permissions || {} } : x));
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); load(); }
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
      // Optional details typed on the same form. Only non-empty ones are sent, so a bare
      // add is exactly the request it always was.
      const opt: Record<string, unknown> = {};
      const put = (k: string, v: FormDataEntryValue | null) => { const x = String(v ?? "").trim(); if (x) opt[k] = x; };
      put("phone", fd.get("phone"));
      put("designation", fd.get("designation"));
      put("joined_on", fd.get("joined_on"));
      put("pay_type", fd.get("pay_type"));
      put("pay_amount", fd.get("pay_amount"));
      const fullName = String(fd.get("full_name") || "").trim();
      if (fullName) opt.profile = { full_name: fullName };
      const tables = role === "tablet" ? (newTables[rid] || []) : undefined;
      if (role === "tablet" && !tables!.length) { setErr("Pick at least one table for this waiter."); return; }
      const d = await call(withScope("/api/owner/staff"), { method: "POST", body: JSON.stringify({ name, role, password: password || undefined, restaurant_id: rid, tables, ...opt }) });
      setReveal({ name: d.name, password: d.password }); setCopied(false);
      form.reset();
      setNewRole((m) => ({ ...m, [rid]: "manager" }));
      setNewTables((m) => ({ ...m, [rid]: [] }));
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
      <div className="own-bar"><div className="own-crumb"><span className="cur">{restaurants.some((r) => r.modules?.payroll) ? "Team & pay" : "Staff & powers"}</span></div></div>

      {/* People first, toggles second — the roster is what an owner opens this page for. */}
      <div className="ost-tabs" role="tablist">
        <button role="tab" aria-selected={tab === "team"} className="ost-tab" onClick={() => setTab("team")}>
          <i className="fas fa-users" /> Team
          <span className="ost-tcount">{staff.filter((s) => s.active).length}</span>
        </button>
        <button role="tab" aria-selected={tab === "powers"} className="ost-tab" onClick={() => setTab("powers")}>
          <i className="fas fa-shield-halved" /> Powers
        </button>
      </div>

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

            {/* ── POWERS tab: what a manager here may do ─────────────────────────── */}
            {tab === "powers" && <>
            <div className="ost-section-t">Manager powers <span className="adm-muted" style={{ fontWeight: 500 }}>· what a manager here may do</span>
              <span className="reach-legend" title="Each power shows how far it reaches. M = passed down to your managers."><span className="reach-chip on" aria-hidden="true">M</span> reaches managers</span>
            </div>
            <div className="ost-perms">
              {PERMS.map(([key, label, hint]) => {
                // The ladder (mig 133): a power the ADMIN removed doesn't exist here.
                // Hidden from the real owner; the admin act-as sees it amber-tinted,
                // and clicking it jumps to the admin Access hub instead of toggling.
                const exists = r.ownerEntitlements?.[`power_${key}`] !== false;
                if (!exists && actor !== "admin") return null;
                // A power belonging to a module the restaurant doesn't have isn't hidden
                // information — it doesn't exist. Rendering it would be a switch that does
                // nothing (and the server refuses it anyway).
                if (PAYROLL_POWERS.has(key) && !r.modules?.payroll) return null;
                // absentOn flags (view_logs): an ABSENT grant means ON — the toggle must show
                // what the server enforces, never "off" while managers genuinely have it.
                const on = ABSENT_ON_POWERS.has(key) ? r.managerPermissions?.[key] !== false : !!r.managerPermissions?.[key];
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
            </>}

            {/* ── TEAM tab: the roster ───────────────────────────────────────────── */}
            {tab === "team" && <>
            <div className="ost-section-t" style={{ marginTop: 16 }}>Team</div>
            <div className="ost-team">
              {team.length === 0 && <div className="adm-empty" style={{ padding: "10px 0" }}>No staff yet — add the first below.</div>}
              {team.map((s) => (
                <div key={s.id} className={`ost-row ${s.active ? "" : "off"}`}>
                  <div className="ost-who">
                    <span className="ost-rolebadge" data-role={s.role}>{s.role === "tablet" ? "waiter" : s.role}</span>
                    <span className="ost-pn">{s.name || s.username}</span>
                    {s.phone && <span className="adm-muted" style={{ fontSize: 11.5 }}>{s.phone}</span>}
                    {!s.active && <span className="ost-disabled">disabled</span>}
                    {/* How complete their record is, and where their money stands. Kitchen rows
                        show neither — they have no profile (owner's call 2026-07-29). */}
                    {s.profileEligible && s.completeness && (
                      <a className="ost-prog" href={withRid(`/owner/staff/${s.id}`)}
                         title={`${s.completeness.filled} of ${s.completeness.total} details filled — open their profile`}>
                        <span className={`ost-bar ${s.completeness.filled < s.completeness.total ? "part" : ""}`}>
                          <i style={{ width: `${Math.round((s.completeness.filled / Math.max(1, s.completeness.total)) * 100)}%` }} />
                        </span>
                        <span className="adm-muted" style={{ fontSize: 11 }}>
                          {s.completeness.filled === s.completeness.total ? "complete" : `${s.completeness.filled} of ${s.completeness.total} filled`}
                        </span>
                      </a>
                    )}
                    {s.profileEligible && !s.payHidden && (s.pay_amount ? (
                      <span className="adm-muted" style={{ fontSize: 11.5 }}>
                        {money(s.pay_amount)}{s.pay_type === "monthly" ? "/mo" : s.pay_type === "daily" ? "/day" : s.pay_type === "hourly" ? "/hr" : ""}
                        {" · "}<b style={{ color: s.paidThisMonth ? "var(--adm-ok)" : "var(--muted)" }}>{money(s.paidThisMonth)}</b> paid this month
                        {s.advanceOutstanding ? <span style={{ color: "var(--adm-warn)" }}> · {money(s.advanceOutstanding)} advance</span> : null}
                      </span>
                    ) : <span className="ost-nopay">pay not set</span>)}
                  </div>
                  <div className="ost-actions">
                    {s.profileEligible && (
                      <a className="ost-mini open" href={withRid(`/owner/staff/${s.id}`)}>
                        <i className="fas fa-id-card" /> Open profile
                      </a>
                    )}
                    {/* Two DIFFERENT things, kept apart (owner 2026-07-29): "Open profile" is the
                        person's record; "Visit panel" is the app THEY use, opened in a new tab so
                        you don't lose your place in the roster. */}
                    {(s.role === "manager" || s.role === "tablet") && (
                      <a className="ost-mini" href={s.role === "manager" ? "/manager" : "/tablet"} target="_blank" rel="noopener"
                        title={`Open the ${s.role === "manager" ? "manager" : "waiter"} panel — the screen ${s.name || s.username} works on`}>
                        <i className="fas fa-up-right-from-square" /> Visit panel
                      </a>
                    )}
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
                  {/* Per-user tablet permissions — only for waiter accounts, only the owner can set.
                      A cap the admin hasn't enabled for this restaurant is greyed (and refused server-side). */}
                  {s.role === "tablet" && canEditPowers && !r.modules?.payroll && (
                    <div style={{ marginTop: 10, paddingTop: 10, borderTop: "var(--border)", display: "flex", flexWrap: "wrap", gap: 8 }}>
                      {WAITER_CAPS.map(([key, label, gate]) => {
                        const gated = !!gate && !(r.modules?.[gate]);
                        const cur = s.permissions?.[key] || "default";
                        return (
                          <div key={key} style={{ display: "flex", alignItems: "center", gap: 7, opacity: gated ? 0.45 : 1 }}>
                            <span style={{ fontSize: 11.5, fontWeight: 600, minWidth: 96 }}>{label}{gated ? " · not enabled" : ""}</span>
                            <div style={{ display: "inline-flex", gap: 2, background: "var(--bg)", border: "var(--border)", borderRadius: 8, padding: 2 }}>
                              {OVR_MODES.map(([v, ml]) => (
                                <button key={v} disabled={busy || gated}
                                  onClick={() => setUserPerm(s, key, v)}
                                  title={gated ? "The admin hasn't enabled this feature for the restaurant" : `Set ${label} to ${ml}`}
                                  style={{ minHeight: 28, padding: "0 9px", borderRadius: 6, border: "none", fontSize: 11.5, fontWeight: 700, cursor: gated ? "not-allowed" : "pointer",
                                    background: cur === v ? (v === "off" ? "var(--adm-danger)" : v === "default" ? "var(--muted2)" : "var(--accent)") : "transparent",
                                    color: cur === v ? (v === "default" ? "var(--text)" : "#fff") : "var(--muted)" }}>{ml}</button>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Add staff */}
            <form className="ost-add" onSubmit={(e) => { e.preventDefault(); addStaff(r.id, e.currentTarget); }}>
              <input className="ost-in" name="name" placeholder="Username (their login)" autoComplete="off" maxLength={80} required />
              <select className="ost-in" name="role" defaultValue="manager"
                onChange={(e) => setNewRole((m) => ({ ...m, [r.id]: e.target.value }))}>
                {ROLES.map((ro) => <option key={ro} value={ro}>{ro === "tablet" ? "waiter" : ro}</option>)}
              </select>
              <input className="ost-in" name="password" placeholder="Password (blank = auto)" autoComplete="off" />
              <button className="ost-btn" type="submit"
                disabled={busy || (newRole[r.id] === "tablet" && !(newTables[r.id] || []).length)}
                title={newRole[r.id] === "tablet" && !(newTables[r.id] || []).length ? "Pick at least one table for this waiter first" : ""}>
                <i className="fas fa-user-plus" /> Add
              </button>
              {/* Waiter sections: a waiter's tablet shows ONLY the tables picked here, so the
                  choice is made as they're created. "Select all" is the whole floor in one tap. */}
              {newRole[r.id] === "tablet" && (
                <div className="ost-tables">
                  <div className="ost-tables-head">
                    <b>Tables this waiter will serve</b>
                    <button type="button" className="ost-btn sm" onClick={() => setNewTables((m) => ({ ...m, [r.id]: Array.from({ length: r.tableCount || 0 }, (_, k) => k + 1) }))}>Select all</button>
                    <button type="button" className="ost-btn sm" onClick={() => setNewTables((m) => ({ ...m, [r.id]: [] }))}>Clear</button>
                    <span className="adm-muted">{(newTables[r.id] || []).length} of {r.tableCount || 0} picked</span>
                  </div>
                  <div className="ost-tgrid">
                    {Array.from({ length: r.tableCount || 0 }, (_, k) => k + 1).map((i) => {
                      const on = (newTables[r.id] || []).includes(i);
                      return (
                        <button key={i} type="button" className={on ? "on" : ""}
                          onClick={() => setNewTables((m) => {
                            const cur = m[r.id] || [];
                            return { ...m, [r.id]: on ? cur.filter((x) => x !== i) : [...cur, i].sort((a, b) => a - b) };
                          })}>{on ? "\u2713 " : ""}T{i}</button>
                      );
                    })}
                  </div>
                  {!(newTables[r.id] || []).length && (
                    <div className="ost-tables-warn">Pick at least one table — their tablet shows only the tables you give them.</div>
                  )}
                </div>
              )}
              {/* Fill the person in right away — or skip it entirely and finish their profile
                  later. Every field here is optional; the server ignores the job/pay ones for a
                  kitchen login and for a manager who may not set pay. */}
              {r.modules?.payroll && (
                <details className="ost-more">
                  <summary>Add their details now <span className="adm-muted">· optional, you can do this later</span></summary>
                  <div className="ost-moregrid">
                    <input className="ost-in" name="phone" placeholder="Phone" autoComplete="off" inputMode="tel" />
                    <input className="ost-in" name="full_name" placeholder="Full name" autoComplete="off" maxLength={80} />
                    <input className="ost-in" name="designation" placeholder="Designation (e.g. Senior waiter)" autoComplete="off" maxLength={80} />
                    <label className="ost-lbl">Joined on<input className="ost-in" name="joined_on" type="date" /></label>
                    {r.payAccess?.canEditJobPay && <>
                      <select className="ost-in" name="pay_type" defaultValue="">
                        <option value="">Pay type…</option>
                        <option value="monthly">Monthly salary</option>
                        <option value="daily">Daily wage</option>
                        <option value="hourly">Hourly</option>
                        <option value="per_shift">Per shift</option>
                      </select>
                      <input className="ost-in" name="pay_amount" placeholder="Amount (\u20b9)" autoComplete="off" inputMode="numeric" />
                    </>}
                  </div>
                </details>
              )}
            </form>
            </>}
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
        /* Reach badges — one letter shows how far a power reaches (M = managers).
           Accent-tinted when it reaches, muted outline when it doesn't. The letter
           itself carries the meaning (never colour-only) + a tooltip. */
        .reach-chip { display: inline-flex; align-items: center; justify-content: center; min-width: 18px; height: 18px; padding: 0 4px; margin-left: 2px; border-radius: 6px; font-size: 10px; font-weight: 800; letter-spacing: .02em; line-height: 1; border: 1px solid transparent; transition: background .18s ease, color .18s ease, border-color .18s ease, opacity .18s ease; }
        .reach-chip.on { color: var(--rcol, var(--accent)); border-color: color-mix(in srgb, var(--rcol, var(--accent)) 45%, transparent); background: color-mix(in srgb, var(--rcol, var(--accent)) 14%, transparent); }
        .reach-chip.off { color: var(--muted); border-color: color-mix(in srgb, var(--fg, #888) 20%, transparent); background: transparent; }
        .reach-legend { display: inline-flex; align-items: center; gap: 5px; margin-left: 10px; font-size: 11px; font-weight: 600; color: var(--muted); vertical-align: middle; }
        @media (prefers-reduced-motion: reduce) { .reach-chip { transition: none; } }
        .ost-tabs { display: flex; gap: 4px; flex-wrap: wrap; margin-bottom: 14px; border-bottom: var(--border); }
        .ost-tab { min-height: 40px; padding: 0 14px; border: 0; border-bottom: 2px solid transparent; background: none; color: var(--muted); font: inherit; font-size: 13px; font-weight: 800; cursor: pointer; display: inline-flex; align-items: center; gap: 8px; }
        .ost-tab[aria-selected="true"] { color: var(--text); border-bottom-color: var(--accent); }
        .ost-tcount { min-width: 18px; padding: 0 5px; border-radius: 6px; background: var(--muted2); font-size: 10.5px; }
        .ost-prog { display: inline-flex; align-items: center; gap: 6px; text-decoration: none; }
        .ost-bar { display: block; width: 74px; height: 6px; border-radius: 99px; background: var(--muted2); overflow: hidden; }
        .ost-bar i { display: block; height: 100%; background: var(--adm-ok, #34d399); }
        .ost-bar.part i { background: var(--adm-warn, #fbbf24); }
        .ost-nopay { font-size: 10.5px; font-weight: 800; text-transform: uppercase; letter-spacing: .02em; padding: 2px 8px; border-radius: 999px; background: color-mix(in srgb, var(--adm-warn) 16%, transparent); color: var(--adm-warn); }
        .ost-mini.open { text-decoration: none; display: inline-flex; align-items: center; gap: 6px; }
        .ost-mini.open:hover { border-color: var(--accent); }
        .ost-team { display: flex; flex-direction: column; gap: 4px; margin-bottom: 12px; }
        .ost-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; flex-wrap: wrap; padding: 10px 12px; border-radius: 9px; background: color-mix(in srgb, var(--fg, #888) 4%, transparent); }
        .ost-row.off { opacity: .6; }
        .ost-who { display: flex; align-items: center; gap: 9px; min-width: 0; flex-wrap: wrap; }
        .ost-pn { font-weight: 700; font-size: 13.5px; }
        .ost-rolebadge { font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: .03em; padding: 3px 8px; border-radius: 999px; background: rgba(128,128,128,.18); color: var(--muted); }
        .ost-rolebadge[data-role="manager"] { background: color-mix(in srgb, var(--accent) 18%, transparent); color: var(--accent); }
        .ost-disabled { font-size: 10.5px; color: var(--adm-danger, #c0392b); font-weight: 700; }
        .ost-actions { display: flex; flex-wrap: wrap; gap: 6px; flex-basis: 100%; margin-top: 8px; }
        .ost-editrow { flex-basis: 100%; display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 8px; padding-top: 8px; border-top: var(--border); }
        .ost-mini { font: inherit; font-size: 11.5px; font-weight: 700; padding: 5px 9px; border-radius: 7px; border: var(--border); background: var(--card); color: var(--fg, inherit); cursor: pointer; }
        .ost-mini:hover:not(:disabled) { border-color: var(--accent); }
        .ost-mini.danger:hover:not(:disabled) { border-color: var(--adm-danger, #c0392b); color: var(--adm-danger, #c0392b); }
        .ost-add { display: flex; flex-wrap: wrap; gap: 8px; padding-top: 12px; border-top: var(--border); }
        /* Waiter sections: the table picker inside the Add form. Full width so it sits under
           the name/role/password row rather than squeezing them. */
        .ost-tables { flex: 1 1 100%; border: var(--border); border-radius: 12px; padding: 11px 12px; background: color-mix(in srgb, var(--fg, #888) 4%, transparent); }
        .ost-tables-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 9px; font-size: 13px; }
        .ost-tables-head .adm-muted { margin-left: auto; font-size: 12px; }
        .ost-btn.sm { min-height: 30px; padding: 0 10px; font-size: 12px; }
        .ost-tgrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(62px, 1fr)); gap: 6px; max-height: 190px; overflow-y: auto; padding-right: 4px; }
        .ost-tgrid button { min-height: 36px; border-radius: 9px; border: var(--border); background: var(--bg); color: var(--muted); font: inherit; font-size: 12px; font-weight: 800; cursor: pointer; }
        .ost-tgrid button.on { background: color-mix(in srgb, var(--accent) 16%, transparent); border-color: var(--accent); color: var(--adm-ok); }
        .ost-tables-warn { margin-top: 9px; font-size: 12.5px; font-weight: 700; color: var(--adm-bad, #ef4444); }
        .ost-more { flex-basis: 100%; margin-top: 4px; }
        .ost-more summary { cursor: pointer; font-size: 12px; font-weight: 700; color: var(--muted); padding: 4px 0; }
        .ost-moregrid { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
        .ost-lbl { display: flex; flex-direction: column; gap: 3px; font-size: 11px; font-weight: 700; color: var(--muted); flex: 1 1 150px; }
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
