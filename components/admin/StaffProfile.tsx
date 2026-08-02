"use client";
/* components/admin/StaffProfile.tsx — THE staff profile panel (owner's design 1 "Dossier",
 * chosen 2026-08-01). ONE component for EVERY person in the product: manager, waiter,
 * kitchen and owner. Opened from /aevinite → Users and from /aevinite → Owners.
 *
 * THE STRUCTURE THE OWNER ASKED FOR — keep it, and put new things INSIDE it rather than
 * inventing a second shape (owner, 2026-08-01: "arrange in this structure only"):
 *
 *   left rail   photo (optional) · name · role · how complete the record is · the buttons
 *               you press daily · when they joined / were last seen
 *   right       ① what they've done  ② PERMISSIONS  ③ who they are  ④ emergency contact
 *               ⑤ the job  ⑥ pay + what has been paid  ⑦ papers  ⑧ signing in
 *               ⑨ what they did lately  ⑩ your private note  ⑪ danger zone
 *
 * PERMISSIONS — the rule (owner, 2026-08-01):
 *   • The rows are EXACTLY the ones Access & permissions has for that role, no others
 *     (lib/staffCaps reads the same tree the Access screen renders).
 *   • Each row is ONE dropdown with three states: “Default (On)” · “On” · “Off”
 *     (waiter money rows add “On + manager PIN”). The bracket shows what the restaurant
 *     gives that role, so the row says both things at once.
 *   • A new person starts on Default everywhere; a stored value exists only where someone
 *     deliberately set one.
 *   • A MANAGER gets two blocks — their menus, and what they may manage. An OWNER gets one
 *     (their own menu; they run a separate panel), and it is read-only because
 *     owner_entitlements is a restaurant setting, not a per-person one.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAdminModal } from "@/components/admin/useAdminModal";
import { openRestaurantPanel } from "@/components/admin/shared";
import { useScrollMemory } from "@/components/admin/useOverlayParam";
import type { TreeState } from "@/lib/accessTree";
import {
  capGroupsForRole, capStates, effectiveCap, roleDefault, countOverrides,
  GROUP_MANAGE, type Cap, type CapValue,
} from "@/lib/staffCaps";
import {
  completeness, EMPLOYMENT_TYPES, PAY_TYPES, PAY_MODES, PAY_KINDS, WEEK_DAYS,
} from "@/lib/staffProfileShared";

// ── types ────────────────────────────────────────────────────────────────────
type Person = {
  id: string; username: string; name: string | null; role: string; phone: string | null;
  active: boolean; last_seen_at: string | null; created_at: string; hasPin: boolean;
  can_self_reset: boolean; can_self_set_pin: boolean; restaurant_id: string;
  permissions: Record<string, string> | null;
  profile: Record<string, any> | null;
  joined_on: string | null; left_on: string | null; designation: string | null;
  employment_type: string | null; shift_label: string | null; weekly_off: string[] | null;
  pay_type: string | null; pay_amount: number | string | null; pay_day: string | null;
  pay_mode: string | null; pay_extras: { label: string; kind: string; amount: number }[] | null;
  can_see_own_pay: boolean; in_payroll: boolean;
};
type Payment = { id: string; kind: string; amount: number; for_period: string | null; mode: string; paid_on: string; note: string | null; recorded_by: string | null; voided_at: string | null; void_reason: string | null };
type Act = { action: string; detail: string | null; created_at: string; panel: string | null };
type Detail = { person: Person; restaurant: { id: string; name: string; slug: string } | null; payrollOn: boolean; payments: Payment[]; activity: Act[] };

const ROLE_LABEL: Record<string, string> = { owner: "Owner", manager: "Manager", kitchen: "Kitchen", tablet: "Waiter (tablet)" };
const ROLE_COLOR: Record<string, string> = { owner: "#b491f0", manager: "#d4a574", kitchen: "#7ec88a", tablet: "#60a5fa" };
const EMP_LABEL: Record<string, string> = { full_time: "Full time", part_time: "Part time", trial: "Trial", casual: "Casual" };
const PAY_LABEL: Record<string, string> = { monthly: "Monthly", daily: "Daily", hourly: "Hourly", per_shift: "Per shift" };
const DAY_LABEL: Record<string, string> = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };
const STATE_LABEL: Record<string, string> = { on: "On", off: "Off", pin: "On + manager PIN" };
// Which panel each person signs into — for the rail's "Visit their panel" button. The
// route is /manager (the folder is still called editor internally; users never see it).
const PANEL_PATH: Record<string, string> = { manager: "/manager", kitchen: "/kitchen", tablet: "/tablet" };
const PANEL_WORD: Record<string, string> = { manager: "manager panel", kitchen: "kitchen screen", tablet: "waiter tablet" };

const money = (n: number | string | null | undefined) =>
  n === null || n === undefined || n === "" ? "—" : "₹" + Number(n).toLocaleString("en-IN");
// A person's short name for a sentence ("what Ramesh may manage"). Plenty of logins are not
// people's names — "AANGAN GARDEN RESTAURANT manager" reads as "what AANGAN may manage" — so
// anything long or restaurant-shaped falls back to a neutral wording.
function shortName(name: string): string {
  const n = (name || "").trim();
  const first = n.split(/\s+/)[0] || "";
  const looksLikeAPerson = n.length <= 22 && !/restaurant|hotel|cafe|garden|kitchen|manager|waiter|owner/i.test(first);
  return looksLikeAPerson && first.length >= 2 ? first : "this person";
}
const day = (s: string | null) => (s ? new Date(s + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—");
const when = (s: string | null) => (s ? new Date(s).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "never");

// ═════════════════════════════════════════════════════════════════════════════
export default function StaffProfile({ userId, onClose, onChanged }: {
  userId: string; onClose: () => void; onChanged?: () => void;
}) {
  const [d, setD] = useState<Detail | null>(null);
  const [tree, setTree] = useState<TreeState | null>(null);
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");           // the small "Saved" line under the header
  const dialogRef = useRef<HTMLDivElement>(null);
  useAdminModal(dialogRef, "admin-staff-profile", onClose); // phone Back + Escape close it
  // "A refresh leaves me where I am" (owner, 2026-08-02). Which profile is open is in the
  // URL — see the page that mounts this — and how far DOWN it was scrolled is remembered
  // here, per person, for this visit only. Without it a reload reopened the profile at the
  // top, which still reads as being thrown back to the start.
  useScrollMemory(dialogRef, `stp-scroll:${userId}`, !!d);

  const load = useCallback(async () => {
    setErr("");
    try {
      const r = await fetch(`/api/admin/users?id=${encodeURIComponent(userId)}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) { setErr(j.error || "Couldn't open this person."); return; }
      setD(j);
      // The restaurant's own settings — this is what "Default (…)" reads.
      const t = await fetch(`/api/admin/restaurants/access-tree?restaurant_id=${j.person.restaurant_id}`, { cache: "no-store" })
        .then((x) => x.json()).catch(() => null);
      if (t && !t.error) setTree(t.state);
    } catch { setErr("Network error — please try again."); }
  }, [userId]);
  useEffect(() => { load(); }, [load]);

  const flash = (m: string) => { setNote(m); setTimeout(() => setNote((n) => (n === m ? "" : n)), 1800); };

  // One PATCH helper for every write on this screen.
  const patch = useCallback(async (payload: object): Promise<any> => {
    const r = await fetch("/api/admin/users", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: userId, ...payload }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "That didn't save.");
    return j;
  }, [userId]);

  const p = d?.person;
  const isOwner = p?.role === "owner";

  return (
    <>
      <div className="stp-scrim" onClick={onClose} />
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Staff profile" className="stp-wrap">
        <div className="stp-sheet">
          <ProfileStyle />
          <header className="stp-top">
            <div>
              <h1>Staff profile</h1>
              <div className="sub">{d?.restaurant?.name || "…"} · {p ? ROLE_LABEL[p.role] || p.role : ""}</div>
            </div>
            <span className={`stp-note ${note ? "on" : ""}`}>{note}</span>
            <button className="stp-x" onClick={onClose} aria-label="Close">×</button>
          </header>

          {err ? <div className="stp-err">{err}</div> : null}
          {!d ? <div className="stp-loading">Opening…</div> : (
            <div className="stp-body">
              <Rail d={d} patch={patch} reload={load} flash={flash} onChanged={onChanged} />
              <main className="stp-main">
                <Permissions d={d} tree={tree} patch={patch} reload={load} flash={flash} />
                <Personal d={d} patch={patch} reload={load} flash={flash} onChanged={onChanged} />
                <Emergency d={d} patch={patch} reload={load} flash={flash} />
                <Job d={d} patch={patch} reload={load} flash={flash} />
                {!isOwner && d.payrollOn ? <Pay d={d} patch={patch} reload={load} flash={flash} /> : null}
                <Papers d={d} patch={patch} reload={load} flash={flash} />
                <SigningIn d={d} patch={patch} reload={load} flash={flash} onChanged={onChanged} />
                <Activity d={d} />
                <PrivateNote d={d} patch={patch} reload={load} flash={flash} />
                {!isOwner ? <Danger d={d} patch={patch} reload={load} flash={flash} onClose={onClose} onChanged={onChanged} /> : null}
              </main>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ── LEFT RAIL: photo, who, completeness, the daily buttons ───────────────────
function Rail({ d, patch, reload, flash, onChanged }: Kit & { onChanged?: () => void }) {
  const p = d.person;
  const c = completeness(p);
  const pct = Math.round((c.filled / c.total) * 100);
  const photo = p.profile?.photo_url as string | undefined;
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  async function upload(f: File) {
    setBusy(true);
    try {
      const fd = new FormData(); fd.append("id", p.id); fd.append("file", f);
      const r = await fetch("/api/admin/users/photo", { method: "POST", body: fd });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "The photo didn't upload.");
      flash("Photo saved"); reload(); onChanged?.();
    } catch (e: any) { flash(e.message || "The photo didn't upload."); }
    finally { setBusy(false); }
  }
  async function removePhoto() {
    setBusy(true);
    try {
      const r = await fetch(`/api/admin/users/photo?id=${p.id}`, { method: "DELETE" });
      if (!r.ok) throw new Error("Couldn't remove the photo.");
      flash("Photo removed"); reload(); onChanged?.();
    } catch (e: any) { flash(e.message); }
    finally { setBusy(false); }
  }

  return (
    <aside className="stp-rail">
      <div className="stp-photo-wrap">
        <div className="stp-photo" style={photo
          ? { backgroundImage: `url(${photo})` }
          : { background: ROLE_COLOR[p.role] || "#64748b" }}>
          {photo ? null : (p.name || p.username).charAt(0).toUpperCase()}
        </div>
        {/* Optional, always — a restaurant that never adds a photo just sees the initial. */}
        <button className="stp-cam" disabled={busy} onClick={() => file.current?.click()}
          title={photo ? "Change the photo" : "Add a photo (optional)"}>{busy ? "…" : photo ? "✎" : "＋"}</button>
        <input ref={file} type="file" accept="image/png,image/jpeg,image/webp" hidden
          onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ""; }} />
      </div>
      {photo ? <button className="stp-photo-rm" onClick={removePhoto}>Remove photo</button> : null}

      <h2>{p.name || p.username}</h2>
      <div className="stp-who">{p.designation || ROLE_LABEL[p.role] || p.role} · signs in as <b>{p.username}</b></div>
      <div className="stp-chips">
        <span className="stp-chip" style={{ color: ROLE_COLOR[p.role], background: `color-mix(in srgb, ${ROLE_COLOR[p.role]} 16%, transparent)` }}>{ROLE_LABEL[p.role] || p.role}</span>
        <span className={`stp-chip ${p.active ? "ok" : "bad"}`}>{p.active ? "Active" : "Disabled"}</span>
        {p.hasPin ? <span className="stp-chip mut">PIN set</span> : null}
        {p.left_on ? <span className="stp-chip warn">Left {day(p.left_on)}</span> : null}
      </div>

      <div className="stp-meter">
        <div className="lab"><span>Record complete</span><b>{c.filled} of {c.total}</b></div>
        <div className="bar"><i style={{ width: `${pct}%` }} /></div>
        {c.missing.length ? <div className="miss">Still missing: {c.missing.slice(0, 4).join(", ")}{c.missing.length > 4 ? "…" : ""}.</div> : <div className="miss">Everything is filled in.</div>}
      </div>

      <QuickActions d={d} patch={patch} reload={reload} flash={flash} onChanged={onChanged} />

      <div className="stp-facts">
        <Row k="Last seen" v={when(p.last_seen_at)} />
        <Row k="Joined the team" v={day(p.joined_on)} />
        <Row k="Login created" v={new Date(p.created_at).toLocaleDateString("en-IN")} />
        <Row k="Restaurant" v={d.restaurant?.name || "—"} />
      </div>
    </aside>
  );
}

function QuickActions({ d, patch, reload, flash, onChanged }: Kit & { onChanged?: () => void }) {
  const p = d.person;
  const [pwOpen, setPwOpen] = useState(false);
  const [pw, setPw] = useState("");
  const [reveal, setReveal] = useState("");
  const [pinOpen, setPinOpen] = useState(false);
  const [pin, setPin] = useState("");

  async function resetPw(generate: boolean) {
    try {
      const j = await patch({ action: "reset_password", password: generate ? "" : pw.trim() });
      setReveal(j.password); setPw(""); flash("Password changed — they're signed out everywhere"); reload(); onChanged?.();
    } catch (e: any) { flash(e.message); }
  }
  async function savePin(clear: boolean) {
    try { await patch({ action: "set_pin", ...(clear ? { clear: true } : { pin: pin.trim() }) }); setPin(""); flash(clear ? "PIN cleared" : "PIN saved"); reload(); }
    catch (e: any) { flash(e.message); }
  }
  async function toggleActive() {
    try { await patch({ action: "set_active", active: !p.active }); flash(p.active ? "Login disabled" : "Login enabled"); reload(); onChanged?.(); }
    catch (e: any) { flash(e.message); }
  }
  // Opens in a new tab, SYNCHRONOUSLY on the click (openRestaurantPanel) so the browser
  // doesn't treat it as a popup. A blocked popup returns null — say so rather than let
  // the tap vanish (the owner's "a tap must never disappear in silence" rule).
  async function visitPanel() {
    const w = await openRestaurantPanel(p.restaurant_id, PANEL_PATH[p.role] || "/manager", p.id);
    if (!w) flash("Your browser blocked the new tab — allow pop-ups for this site.");
  }

  return (
    <div className="stp-qa">
      <button className="stp-btn" onClick={() => setPwOpen((o) => !o)}>🔒 Reset password</button>
      {pwOpen ? (
        <div className="stp-pop">
          {reveal ? (
            <div className="stp-reveal">
              New password — copy it now, it isn&apos;t shown again:
              <code>{reveal}</code>
              <button className="stp-btn sm" onClick={() => navigator.clipboard?.writeText(reveal)}>Copy</button>
            </div>
          ) : null}
          <input className="stp-in" type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Type a new password…" autoComplete="new-password" />
          <div className="stp-pop-row">
            <button className="stp-btn pri sm" disabled={pw.trim().length < 6} onClick={() => resetPw(false)}>Set it</button>
            <button className="stp-btn sm" onClick={() => resetPw(true)}>Generate one</button>
          </div>
          <div className="stp-hint">Setting a password signs them out on every device.</div>
        </div>
      ) : null}

      {p.role === "manager" ? (
        <>
          <button className="stp-btn" onClick={() => setPinOpen((o) => !o)}>🔑 {p.hasPin ? "Change" : "Set"} manager PIN</button>
          {pinOpen ? (
            <div className="stp-pop">
              <input className="stp-in" value={pin} inputMode="numeric" maxLength={8}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} placeholder="4–8 digits" />
              <div className="stp-pop-row">
                <button className="stp-btn pri sm" disabled={!/^\d{4,8}$/.test(pin)} onClick={() => savePin(false)}>Save PIN</button>
                {p.hasPin ? <button className="stp-btn sm" onClick={() => savePin(true)}>Clear it</button> : null}
              </div>
            </div>
          ) : null}
        </>
      ) : null}

      {/* VISIT THEIR PANEL (owner, 2026-08-02) — open the panel this person signs into,
          as THEM: a waiter's own tables and their own switches, a manager's own menus.
          Two things it fixes over the old plain link:
            • it goes through /api/admin/act-as/go, which SETS the view-as restaurant on
              the way — the bare /manager?rid=… link bounced back to the console whenever
              this browser hadn't entered a restaurant yet (lib/panelGate requires it);
            • it carries ?as=<their id>, so the panel renders their view instead of the
              admin X-ray. Writes are still the admin's — nothing is ever recorded as them.
          Owners are left out on purpose: an owner can hold several restaurants, and their
          row's restaurant_id is the #1 home namespace, not "the one they run" — the Owners
          roster asks WHICH restaurant first and links from there. */}
      {d.restaurant && p.role !== "owner" ? (
        <button className="stp-btn" onClick={visitPanel}
          title={`Open ${d.restaurant.name}'s ${PANEL_WORD[p.role] || "panel"} exactly as ${p.name || p.username} sees it`}>
          👁 Visit their panel
        </button>
      ) : null}
      <a className="stp-btn" href={`/aevinite/access?restaurant=${p.restaurant_id}`}>🔑 Access &amp; permissions</a>
      <button className="stp-btn" onClick={toggleActive}>{p.active ? "⏸ Disable this login" : "▶ Enable this login"}</button>
    </div>
  );
}

// ── ② PERMISSIONS — the dropdown block ───────────────────────────────────────
function Permissions({ d, tree, patch, reload, flash }: Kit & { tree: TreeState | null }) {
  const p = d.person;
  const groups = useMemo(() => capGroupsForRole(p.role), [p.role]);
  const [open, setOpen] = useState(false);
  const [perms, setPerms] = useState<Record<string, string>>(p.permissions || {});
  useEffect(() => { setPerms(p.permissions || {}); }, [p.permissions]);
  const changed = countOverrides(p.role, perms);

  async function set(cap: Cap, v: CapValue) {
    const before = perms;
    // Paint it immediately, then put it back if the server refuses — a permission that
    // silently doesn't save is worse than one that visibly fails.
    setPerms((x) => { const n = { ...x }; if (v === "default") delete n[cap.key]; else n[cap.key] = v; return n; });
    try {
      await patch({ action: "set_permissions", permissions: { [cap.key]: v === "default" ? "" : v } });
      flash(v === "default" ? "Back to the restaurant's default" : `Saved · ${STATE_LABEL[v]}`);
      reload();
    } catch (e: any) { setPerms(before); flash(e.message || "That permission didn't save."); }
  }

  if (!groups.length) {
    return (
      <section className="stp-card">
        <h3>🔑 Permissions</h3>
        <p className="stp-sub">
          {p.role === "kitchen"
            ? "The kitchen display has no per-person settings — what it shows is decided by Main features and the Manager's menu."
            : "This role has no permission rows."}
        </p>
      </section>
    );
  }

  return (
    <section className="stp-card stp-perms">
      <button className={`stp-fold ${open ? "open" : ""}`} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="ic">🔑</span>
        <span className="tt">
          <b>Permissions — what {shortName(p.name || p.username)} may do</b>
          <i>
            The same rows as Access &amp; permissions → {ROLE_LABEL[p.role]}.{" "}
            {changed ? <em>{changed} changed just for this person.</em> : "Every row is following the restaurant's default."}
          </i>
        </span>
        <span className={`stp-chip ${changed ? "warn" : "mut"}`}>{changed ? `${changed} custom` : "All default"}</span>
        <span className="caret">›</span>
      </button>

      {open ? (
        <div className="stp-fold-body">
          <p className="stp-permnote">
            <b>Default</b> means this person follows what every {ROLE_LABEL[p.role].toLowerCase()} at{" "}
            {d.restaurant?.name || "this restaurant"} gets — the bracket shows what that is, and it&apos;s set on{" "}
            <a href={`/aevinite/access?restaurant=${p.restaurant_id}`}>Access &amp; permissions</a>. Choosing On or Off
            applies to this person alone and takes effect on their next tap, with no re-login.
          </p>
          {groups.map((g) => (
            <div className="stp-permgrp" key={g.group}>
              <div className="stp-permgrp-h">
                <b>{g.group === GROUP_MANAGE ? `What ${shortName(p.name || p.username)} may manage` : g.group}</b>
                <i>{g.caps.length} {g.caps.length === 1 ? "setting" : "settings"}</i>
              </div>
              {g.caps.map((cap) => (
                <PermRow key={cap.key} cap={cap} tree={tree} perms={perms} onSet={set} />
              ))}
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function PermRow({ cap, tree, perms, onSet }: {
  cap: Cap; tree: TreeState | null; perms: Record<string, string>; onSet: (c: Cap, v: CapValue) => void;
}) {
  const def = roleDefault(cap, tree);
  const own = (cap.perPerson ? perms[cap.key] : undefined) as CapValue | undefined;
  const value: CapValue = own === "on" || own === "off" || own === "pin" ? own : "default";
  const eff = effectiveCap(cap, tree, perms);
  // Until the restaurant's settings have loaded we say plain "Default" — never a bracket
  // guessing at a value we don't have yet. (A half-second of "Default (not set)" reads as a
  // broken permission, and this screen must never say something it can't stand behind.)
  const defText = def ? STATE_LABEL[def] : null;

  return (
    <div className={`stp-perm ${value !== "default" ? "custom" : ""}`}>
      <div className="stp-perm-t">
        <div className="nm">
          {cap.node.name}
          {value !== "default" ? <span className="stp-chip warn sm">changed</span> : null}
          {cap.node.leftToBuild ? <span className="stp-chip mut sm">left to build</span> : null}
        </div>
        <div className="ds">{cap.node.what}</div>
      </div>
      <div className="stp-perm-c">
        {cap.perPerson ? (
          <select className="stp-sel" value={value} onChange={(e) => onSet(cap, e.target.value as CapValue)} aria-label={cap.node.name}>
            {capStates(cap.pin).map((s) => (
              <option key={s} value={s}>
                {s === "default" ? (defText ? `Default (${defText})` : "Default") : STATE_LABEL[s]}
              </option>
            ))}
          </select>
        ) : (
          // Restaurant-wide row (an owner's pages): show the truth, don't offer a switch that
          // would save nothing. The link goes to the screen that actually owns it.
          <div className="stp-fixed">
            <span className={`stp-chip ${eff === "on" ? "ok" : "bad"}`}>{eff ? STATE_LABEL[eff] : "—"}</span>
            <span className="hint">set for the restaurant</span>
          </div>
        )}
        <span className={`stp-eff ${eff === "off" ? "no" : "yes"}`}>
          {eff === "off" ? "Cannot do this" : eff ? "Can do this" : ""}
        </span>
      </div>
    </div>
  );
}

// ── ③ who they are ───────────────────────────────────────────────────────────
function Personal({ d, patch, reload, flash, onChanged }: Kit & { onChanged?: () => void }) {
  const p = d.person;
  const pr = p.profile || {};
  const [f, setF] = useState({
    name: p.name || "", phone: p.phone || "",
    full_name: pr.full_name || "", alt_phone: pr.alt_phone || "", email: pr.email || "",
    dob: pr.dob || "", blood_group: pr.blood_group || "", language: pr.language || "",
    address: pr.address || "", city: pr.city || "", pincode: pr.pincode || "",
  });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const q = p.profile || {};
    setF({
      name: p.name || "", phone: p.phone || "", full_name: q.full_name || "", alt_phone: q.alt_phone || "",
      email: q.email || "", dob: q.dob || "", blood_group: q.blood_group || "", language: q.language || "",
      address: q.address || "", city: q.city || "", pincode: q.pincode || "",
    });
  }, [p]);

  async function save() {
    setBusy(true);
    try {
      // A NON-owner's login name + phone are account fields ("edit"); an OWNER's name is
      // changed only on the Owners page (it is tied to the primary/co-owner handoff), so for
      // them the phone rides along with the profile save instead.
      if (p.role !== "owner" && (f.name !== (p.name || "") || f.phone !== (p.phone || ""))) {
        await patch({ action: "edit", name: f.name, phone: f.phone });
      }
      const { name, phone, ...profile } = f;
      await patch({ action: "set_profile", profile, ...(p.role === "owner" ? { phone } : {}) });
      flash("Saved"); reload(); onChanged?.();
    } catch (e: any) { flash(e.message); }
    finally { setBusy(false); }
  }

  return (
    <section className="stp-card">
      <h3>👤 Who they are</h3>
      <p className="stp-sub">The login name is what they type to sign in; everything else is the person.</p>
      <div className="stp-grid">
        <Field label={p.role === "owner" ? "Login name (changed on the Owners page)" : "Login / display name"} v={f.name} on={(v) => setF({ ...f, name: v })} disabled={p.role === "owner"} />
        <Field label="Phone (their main number)" v={f.phone} on={(v) => setF({ ...f, phone: v })} />
        <Field label="Full legal name" v={f.full_name} on={(v) => setF({ ...f, full_name: v })} />
        <Field label="Other phone" v={f.alt_phone} on={(v) => setF({ ...f, alt_phone: v })} />
        <Field label="Email" v={f.email} on={(v) => setF({ ...f, email: v })} type="email" />
        <Field label="Date of birth" v={f.dob} on={(v) => setF({ ...f, dob: v })} type="date" />
        <Field label="Blood group" v={f.blood_group} on={(v) => setF({ ...f, blood_group: v })} placeholder="e.g. B+" />
        <Field label="Languages they speak" v={f.language} on={(v) => setF({ ...f, language: v })} placeholder="Hindi, Gujarati" />
        <Field label="City" v={f.city} on={(v) => setF({ ...f, city: v })} />
        <Field label="PIN code" v={f.pincode} on={(v) => setF({ ...f, pincode: v })} />
        <Field label="Address" v={f.address} on={(v) => setF({ ...f, address: v })} wide />
      </div>
      <SaveRow busy={busy} onSave={save} />
    </section>
  );
}

// ── ④ emergency contact ──────────────────────────────────────────────────────
function Emergency({ d, patch, reload, flash }: Kit) {
  const pr = d.person.profile || {};
  const [f, setF] = useState({ emg_name: pr.emg_name || "", emg_relation: pr.emg_relation || "", emg_phone: pr.emg_phone || "" });
  const [busy, setBusy] = useState(false);
  useEffect(() => { const q = d.person.profile || {}; setF({ emg_name: q.emg_name || "", emg_relation: q.emg_relation || "", emg_phone: q.emg_phone || "" }); }, [d.person]);
  async function save() {
    setBusy(true);
    try { await patch({ action: "set_profile", profile: f }); flash("Saved"); reload(); }
    catch (e: any) { flash(e.message); } finally { setBusy(false); }
  }
  return (
    <section className="stp-card">
      <h3>🚑 If something happens to them</h3>
      <p className="stp-sub">Who the restaurant calls. Every staff record should have this filled.</p>
      <div className="stp-grid three">
        <Field label="Name" v={f.emg_name} on={(v) => setF({ ...f, emg_name: v })} />
        <Field label="Relation" v={f.emg_relation} on={(v) => setF({ ...f, emg_relation: v })} placeholder="Wife, brother…" />
        <Field label="Phone" v={f.emg_phone} on={(v) => setF({ ...f, emg_phone: v })} />
      </div>
      <SaveRow busy={busy} onSave={save} />
    </section>
  );
}

// ── ⑤ the job ────────────────────────────────────────────────────────────────
function Job({ d, patch, reload, flash }: Kit) {
  const p = d.person;
  const [f, setF] = useState({
    designation: p.designation || "", employment_type: p.employment_type || "",
    joined_on: p.joined_on || "", left_on: p.left_on || "", shift_label: p.shift_label || "",
    weekly_off: p.weekly_off || [],
  });
  const [busy, setBusy] = useState(false);
  useEffect(() => setF({
    designation: p.designation || "", employment_type: p.employment_type || "",
    joined_on: p.joined_on || "", left_on: p.left_on || "", shift_label: p.shift_label || "",
    weekly_off: p.weekly_off || [],
  }), [p]);

  const toggleDay = (dd: string) =>
    setF((x) => ({ ...x, weekly_off: x.weekly_off.includes(dd) ? x.weekly_off.filter((y) => y !== dd) : [...x.weekly_off, dd] }));

  async function save() {
    setBusy(true);
    try { await patch({ action: "set_job", job: f }); flash("Saved"); reload(); }
    catch (e: any) { flash(e.message); } finally { setBusy(false); }
  }
  return (
    <section className="stp-card">
      <h3>🧾 The job</h3>
      <p className="stp-sub">What they were hired as, and when they work. Setting a “left on” date keeps the whole record while marking them as gone.</p>
      <div className="stp-grid">
        <Field label="Designation" v={f.designation} on={(v) => setF({ ...f, designation: v })} placeholder="Floor manager" />
        <label className="stp-f"><span>Employment type</span>
          <select className="stp-in" value={f.employment_type} onChange={(e) => setF({ ...f, employment_type: e.target.value })}>
            <option value="">—</option>
            {EMPLOYMENT_TYPES.map((t) => <option key={t} value={t}>{EMP_LABEL[t]}</option>)}
          </select>
        </label>
        <Field label="Joined on" v={f.joined_on} on={(v) => setF({ ...f, joined_on: v })} type="date" />
        <Field label="Left on (blank = still working)" v={f.left_on} on={(v) => setF({ ...f, left_on: v })} type="date" />
        <Field label="Shift" v={f.shift_label} on={(v) => setF({ ...f, shift_label: v })} placeholder="Evening · 4 PM – 12 AM" wide />
      </div>
      <div className="stp-days">
        <span>Weekly off</span>
        {WEEK_DAYS.map((dd) => (
          <button key={dd} type="button" className={f.weekly_off.includes(dd) ? "on" : ""} onClick={() => toggleDay(dd)}>{DAY_LABEL[dd]}</button>
        ))}
      </div>
      <SaveRow busy={busy} onSave={save} />
    </section>
  );
}

// ── ⑥ pay + what has actually been paid ──────────────────────────────────────
function Pay({ d, patch, reload, flash }: Kit) {
  const p = d.person;
  const [f, setF] = useState({
    pay_type: p.pay_type || "", pay_amount: p.pay_amount ?? "", pay_day: p.pay_day || "", pay_mode: p.pay_mode || "",
  });
  const [busy, setBusy] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [np, setNp] = useState({ kind: "salary", amount: "", mode: "cash", paid_on: new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10), note: "" });
  useEffect(() => setF({ pay_type: p.pay_type || "", pay_amount: p.pay_amount ?? "", pay_day: p.pay_day || "", pay_mode: p.pay_mode || "" }), [p]);

  async function save() {
    setBusy(true);
    try { await patch({ action: "set_job", job: f }); flash("Saved"); reload(); }
    catch (e: any) { flash(e.message); } finally { setBusy(false); }
  }
  async function setPayroll(on: boolean) {
    try { await patch({ action: "set_job", in_payroll: on }); flash(on ? "Added to the pay list" : "Taken off the pay list"); reload(); }
    catch (e: any) { flash(e.message); }
  }
  async function record() {
    try {
      const r = await fetch("/api/owner/staff", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "record_payment", staff_id: p.id, ...np }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "That payment didn't save.");
      setNp({ ...np, amount: "", note: "" }); setPayOpen(false); flash("Payment recorded"); reload();
    } catch (e: any) { flash(e.message); }
  }

  const paid = d.payments.filter((x) => !x.voided_at);
  return (
    <section className="stp-card">
      <h3>💰 Pay <span className="stp-chip mut">Payroll module is on</span></h3>
      <p className="stp-sub">
        Being on the pay list is deliberate — only people on it get a rate, can have a payment recorded, and count as an
        expense in the reports. The ledger is append-only: a wrong entry is cancelled with a reason, never deleted.
      </p>
      <button className={`stp-tgl ${p.in_payroll ? "on" : ""}`} onClick={() => setPayroll(!p.in_payroll)}>
        <span className="tb"><b>On the pay list</b><i>Off means no rate, no payments and nothing counted as an expense for them.</i></span>
        <span className="track"><b /></span>
      </button>

      {p.in_payroll ? (
        <>
          <div className="stp-grid three" style={{ marginTop: 12 }}>
            <label className="stp-f"><span>Pay type</span>
              <select className="stp-in" value={f.pay_type} onChange={(e) => setF({ ...f, pay_type: e.target.value })}>
                <option value="">—</option>
                {PAY_TYPES.map((t) => <option key={t} value={t}>{PAY_LABEL[t]}</option>)}
              </select>
            </label>
            <Field label="Amount" v={String(f.pay_amount ?? "")} on={(v) => setF({ ...f, pay_amount: v })} placeholder="28000" />
            <Field label="Paid on" v={f.pay_day} on={(v) => setF({ ...f, pay_day: v })} placeholder="5th of the month" />
            <label className="stp-f"><span>Usual mode</span>
              <select className="stp-in" value={f.pay_mode} onChange={(e) => setF({ ...f, pay_mode: e.target.value })}>
                <option value="">—</option>
                {PAY_MODES.map((m) => <option key={m} value={m}>{m.toUpperCase()}</option>)}
              </select>
            </label>
          </div>
          <SaveRow busy={busy} onSave={save} extra={
            <button className="stp-btn pri sm" onClick={() => setPayOpen((o) => !o)}>＋ Record a payment</button>
          } />

          {payOpen ? (
            <div className="stp-pop wide">
              <div className="stp-grid three">
                <label className="stp-f"><span>What</span>
                  <select className="stp-in" value={np.kind} onChange={(e) => setNp({ ...np, kind: e.target.value })}>
                    {PAY_KINDS.map((k) => <option key={k} value={k}>{k[0].toUpperCase() + k.slice(1)}</option>)}
                  </select>
                </label>
                <Field label="Amount" v={np.amount} on={(v) => setNp({ ...np, amount: v })} />
                <label className="stp-f"><span>Mode</span>
                  <select className="stp-in" value={np.mode} onChange={(e) => setNp({ ...np, mode: e.target.value })}>
                    {PAY_MODES.map((m) => <option key={m} value={m}>{m.toUpperCase()}</option>)}
                  </select>
                </label>
                <Field label="Paid on" v={np.paid_on} on={(v) => setNp({ ...np, paid_on: v })} type="date" />
                <Field label="Note" v={np.note} on={(v) => setNp({ ...np, note: v })} wide />
              </div>
              <div className="stp-pop-row">
                <button className="stp-btn pri sm" onClick={record}>Save this payment</button>
                <button className="stp-btn sm" onClick={() => setPayOpen(false)}>Cancel</button>
              </div>
            </div>
          ) : null}

          {paid.length ? (
            <table className="stp-table">
              <thead><tr><th>When</th><th>What</th><th>For</th><th>Mode</th><th>Amount</th></tr></thead>
              <tbody>
                {paid.slice(0, 12).map((x) => (
                  <tr key={x.id}>
                    <td>{day(x.paid_on)}</td>
                    <td>{x.kind[0].toUpperCase() + x.kind.slice(1)}</td>
                    <td>{x.for_period ? day(x.for_period).slice(3) : "—"}</td>
                    <td>{x.mode.toUpperCase()}</td>
                    <td>{money(x.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="stp-sub" style={{ marginTop: 12 }}>Nothing has been paid to them through the app yet.</p>}
        </>
      ) : null}
    </section>
  );
}

// ── ⑦ papers ─────────────────────────────────────────────────────────────────
function Papers({ d, patch, reload, flash }: Kit) {
  const pr = d.person.profile || {};
  const [f, setF] = useState({ id_type: pr.id_type || "", id_last4: pr.id_last4 || "", upi_id: pr.upi_id || "", bank_last4: pr.bank_last4 || "", id_verified: !!pr.id_verified });
  const [busy, setBusy] = useState(false);
  useEffect(() => { const q = d.person.profile || {}; setF({ id_type: q.id_type || "", id_last4: q.id_last4 || "", upi_id: q.upi_id || "", bank_last4: q.bank_last4 || "", id_verified: !!q.id_verified }); }, [d.person]);
  async function save(next = f) {
    setBusy(true);
    try { await patch({ action: "set_profile", profile: next }); flash("Saved"); reload(); }
    catch (e: any) { flash(e.message); } finally { setBusy(false); }
  }
  return (
    <section className="stp-card">
      <h3>🪪 Papers &amp; money details</h3>
      <p className="stp-sub">Only the last four digits are ever stored — enough to match a document you are holding, never a copy of it.</p>
      <div className="stp-grid">
        <label className="stp-f"><span>ID type</span>
          <select className="stp-in" value={f.id_type} onChange={(e) => setF({ ...f, id_type: e.target.value })}>
            <option value="">—</option>
            {["Aadhaar", "PAN", "Driving licence", "Voter ID", "Passport"].map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <Field label="Last 4 digits" v={f.id_last4} on={(v) => setF({ ...f, id_last4: v.replace(/\D/g, "").slice(0, 4) })} />
        <Field label="UPI id" v={f.upi_id} on={(v) => setF({ ...f, upi_id: v })} placeholder="name@bank" />
        <Field label="Bank account · last 4" v={f.bank_last4} on={(v) => setF({ ...f, bank_last4: v.replace(/\D/g, "").slice(0, 4) })} />
      </div>
      <button className={`stp-tgl ${f.id_verified ? "on" : ""}`} style={{ marginTop: 12 }}
        onClick={() => { const next = { ...f, id_verified: !f.id_verified }; setF(next); save(next); }}>
        <span className="tb"><b>ID seen and verified</b><i>You have physically checked the document against this person.</i></span>
        <span className="track"><b /></span>
      </button>
      <SaveRow busy={busy} onSave={() => save()} />
    </section>
  );
}

// ── ⑧ signing in ─────────────────────────────────────────────────────────────
function SigningIn({ d, patch, reload, flash, onChanged }: Kit & { onChanged?: () => void }) {
  const p = d.person;
  async function set(key: "can_self_reset" | "can_self_set_pin", v: boolean) {
    try { await patch({ action: "set_access", [key]: v }); flash("Saved"); reload(); onChanged?.(); }
    catch (e: any) { flash(e.message); }
  }
  return (
    <section className="stp-card">
      <h3>🔐 Signing in</h3>
      <button className={`stp-tgl ${p.can_self_reset ? "on" : ""}`} onClick={() => set("can_self_reset", !p.can_self_reset)}>
        <span className="tb"><b>Can change their own password</b><i>Off = only you can reset it for them.</i></span>
        <span className="track"><b /></span>
      </button>
      {p.role === "manager" ? (
        <button className={`stp-tgl ${p.can_self_set_pin ? "on" : ""}`} style={{ marginTop: 8 }} onClick={() => set("can_self_set_pin", !p.can_self_set_pin)}>
          <span className="tb"><b>Can change their own manager PIN</b><i>Off = only you set it; the option disappears from their own profile.</i></span>
          <span className="track"><b /></span>
        </button>
      ) : null}
      <div className="stp-facts" style={{ marginTop: 12 }}>
        <Row k="Last seen" v={when(p.last_seen_at)} />
        <Row k="Manager PIN" v={p.hasPin ? "set" : "not set"} />
        <Row k="Account" v={p.active ? "active" : "disabled"} />
      </div>
    </section>
  );
}

// ── ⑨ what they did lately ───────────────────────────────────────────────────
function Activity({ d }: { d: Detail }) {
  return (
    <section className="stp-card">
      <h3>🕘 What they did lately</h3>
      {d.activity.length ? (
        <div className="stp-tl">
          {d.activity.map((a, i) => (
            <div key={i}>
              <time>{when(a.created_at)}</time>
              <span>{a.detail || a.action.replace(/_/g, " ")}{a.panel ? ` · ${a.panel}` : ""}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="stp-sub">
          Nothing recorded against this person yet. Actions are stamped with WHO did them, so this fills up as they work.
        </p>
      )}
    </section>
  );
}

// ── ⑩ private note ───────────────────────────────────────────────────────────
function PrivateNote({ d, patch, reload, flash }: Kit) {
  const [v, setV] = useState((d.person.profile || {}).notes || "");
  const [busy, setBusy] = useState(false);
  useEffect(() => setV((d.person.profile || {}).notes || ""), [d.person]);
  async function save() {
    setBusy(true);
    try { await patch({ action: "set_profile", profile: { notes: v } }); flash("Saved"); reload(); }
    catch (e: any) { flash(e.message); } finally { setBusy(false); }
  }
  return (
    <section className="stp-card">
      <h3>📝 Your private note</h3>
      <p className="stp-sub">Only you and the owner see this. The person never does.</p>
      <textarea className="stp-in" rows={3} value={v} onChange={(e) => setV(e.target.value)} />
      <SaveRow busy={busy} onSave={save} />
    </section>
  );
}

// ── ⑪ danger zone ────────────────────────────────────────────────────────────
function Danger({ d, patch, reload, onClose, onChanged }: Kit & { onClose: () => void; onChanged?: () => void }) {
  const p = d.person;
  const [confirm, setConfirm] = useState(false);
  const [msg, setMsg] = useState("");
  async function del() {
    try {
      const r = await fetch(`/api/admin/users?id=${p.id}`, { method: "DELETE" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg(j.error || "Delete failed."); return; }
      onChanged?.(); onClose();
    } catch { setMsg("Network error."); }
  }
  // "Mark as left today" WROTE A DATE AND NOTHING ELSE, so the profile ended up saying
  // "Left 02 Aug 2026" and "Account: active" at the same time and the button looked dead
  // (owner, 2026-08-02: "why is there a mark-as-left option, if it does nothing remove it").
  // It was never dead — the date is what stops their salary counting from that day
  // (migs 220/221 prorate expected pay by joined_on/left_on, and mig 252 the day's money in
  // hand) — it just did HALF of what leaving means. Now it does both: records the day AND
  // switches the login off, which is the thing you can actually see. Nothing is deleted;
  // their orders, bills and pay history stay exactly where they are.
  async function markLeft() {
    try {
      await patch({ action: "set_job", job: { left_on: new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10) } });
      if (p.active) await patch({ action: "set_active", active: false });
      reload(); onChanged?.();
    } catch (e: any) { setMsg(e.message); }
  }
  // They came back — clear the leaving date and let them sign in again.
  async function unmarkLeft() {
    try {
      await patch({ action: "set_job", job: { left_on: "" } });
      if (!p.active) await patch({ action: "set_active", active: true });
      reload(); onChanged?.();
    } catch (e: any) { setMsg(e.message); }
  }
  return (
    <section className="stp-card danger">
      <h3>⚠️ Remove this person</h3>
      <p className="stp-sub">
        {p.left_on
          ? <>This person is marked as having left on <b>{day(p.left_on)}</b>, so their pay stops counting from that
            day{p.active
              ? <> — but their login is still <b>active</b>, so they can still sign in. Press the button below to
                mark them as left properly, or switch the login off from the left.</>
              : <> and they can&apos;t sign in.</>} Everything they did is still in the books.</>
          : <>Marking someone as left records the day, stops their pay counting from it, and switches their login off —
            that is what you want when someone leaves. Deleting removes the login for good. Their past orders and bills
            stay in the books either way.</>}
      </p>
      {msg ? <div className="stp-err" style={{ marginBottom: 10 }}>{msg}</div> : null}
      <div className="stp-row">
        {/* A record from before this button did the whole job (a leaving date but the login
            still on) gets the FINISH button, not the undo — the undo only makes sense once
            the two agree. */}
        {p.left_on && !p.active
          ? <button className="stp-btn" onClick={unmarkLeft}>↩ They&apos;re back — undo this</button>
          : <button className="stp-btn" onClick={markLeft}>📅 Mark as left{p.left_on ? " (switch their login off)" : " today"}</button>}
        {confirm ? (
          <>
            <button className="stp-btn dan" onClick={del}>Yes, delete {p.name || p.username}</button>
            <button className="stp-btn" onClick={() => setConfirm(false)}>Cancel</button>
          </>
        ) : <button className="stp-btn dan" onClick={() => setConfirm(true)}>Delete this person</button>}
      </div>
    </section>
  );
}

// ── small shared bits ────────────────────────────────────────────────────────
type Kit = { d: Detail; patch: (payload: object) => Promise<any>; reload: () => void; flash: (m: string) => void };

function Field({ label, v, on, type = "text", placeholder, wide, disabled }: {
  label: string; v: string; on: (v: string) => void; type?: string; placeholder?: string; wide?: boolean; disabled?: boolean;
}) {
  return (
    <label className={`stp-f ${wide ? "wide" : ""}`}>
      <span>{label}</span>
      <input className="stp-in" type={type} value={v} placeholder={placeholder} disabled={disabled}
        onChange={(e) => on(e.target.value)} />
    </label>
  );
}
const Row = ({ k, v }: { k: string; v: string }) => (
  <div className="stp-kv"><span>{k}</span><b>{v}</b></div>
);
const SaveRow = ({ busy, onSave, extra }: { busy: boolean; onSave: () => void; extra?: React.ReactNode }) => (
  <div className="stp-row" style={{ marginTop: 14 }}>
    <button className="stp-btn pri sm" disabled={busy} onClick={onSave}>{busy ? "Saving…" : "Save"}</button>
    {extra}
  </div>
);

// ── styling: the admin shell's own tokens, scoped to .stp-* ──────────────────
function ProfileStyle() {
  return <style jsx global>{`
  .stp-scrim { position:fixed; inset:0; background:rgba(2,6,16,.72); backdrop-filter:blur(3px); z-index:1000; animation:stpFade .16s ease-out; }
  /* NO padding on the scroller. The sheet's own margin gives the gap at the top, so the
     sticky header can pin flush to the viewport: with padding here, the header pinned 18px
     DOWN and the cards scrolled through the strip above it — a sliver of a permission row
     floating over the page, which is what looked broken (owner, 2026-08-02). */
  .stp-wrap { position:fixed; inset:0; z-index:1001; overflow-y:auto; padding:0; }
  .stp-sheet { position:relative; width:min(1120px,100%); margin:18px auto 40px; background:var(--card); border:var(--border);
    border-radius:20px; box-shadow:0 30px 90px rgba(0,0,0,.55); animation:stpPop .2s cubic-bezier(.16,1,.3,1); }
  @keyframes stpFade { from { opacity:0 } to { opacity:1 } }
  @keyframes stpPop { from { opacity:0; transform:translateY(10px) scale(.985) } to { opacity:1; transform:none } }
  .stp-top { position:sticky; top:0; z-index:6; display:flex; align-items:center; gap:12px; padding:15px 18px;
    border-bottom:var(--border); background:color-mix(in srgb,var(--card) 94%,transparent); backdrop-filter:blur(20px); border-radius:20px 20px 0 0; }
  .stp-top h1 { margin:0; font-size:16px; font-weight:800; }
  .stp-top .sub { font-size:12px; color:var(--muted); margin-top:2px; }
  .stp-note { margin-left:auto; font-size:12px; font-weight:700; color:var(--adm-ok,#34d399); opacity:0; transition:opacity .18s; }
  .stp-note.on { opacity:1; }
  .stp-x { width:34px; height:34px; border-radius:10px; border:var(--border); background:var(--bg); color:var(--muted); font-size:19px; cursor:pointer; }
  .stp-loading { padding:60px; text-align:center; color:var(--muted); }
  .stp-err { margin:14px 18px; padding:11px 13px; border-radius:11px; font-size:13px;
    color:var(--adm-danger,#f87171); border:1px solid color-mix(in srgb,var(--adm-danger,#f87171) 45%,transparent);
    background:color-mix(in srgb,var(--adm-danger,#f87171) 10%,transparent); }
  .stp-body { display:grid; grid-template-columns:300px 1fr; align-items:start; }

  /* rail — pinned directly under the header (68px = its height), and always as tall as the
     window so the divider runs the full height instead of stopping halfway and leaving a dead
     patch beside the long right-hand column. It scrolls inside itself if it ever outgrows the
     screen, so nothing in it can become unreachable. */
  .stp-rail { padding:22px 18px; border-right:var(--border); position:sticky; top:68px;
    min-height:calc(100dvh - 68px); max-height:calc(100dvh - 68px); overflow-y:auto; }
  .stp-photo-wrap { position:relative; width:132px; height:132px; margin:0 auto 12px; }
  .stp-photo { width:132px; height:132px; border-radius:50%; display:grid; place-items:center; font-size:42px; font-weight:800;
    color:#0b0f16; background-size:cover; background-position:center; }
  .stp-cam { position:absolute; right:2px; bottom:2px; width:38px; height:38px; border-radius:50%; border:3px solid var(--card);
    background:var(--accent); color:#fff; font-size:15px; cursor:pointer; }
  .stp-photo-rm { display:block; margin:0 auto 10px; background:none; border:0; color:var(--muted); font-size:11.5px; cursor:pointer; text-decoration:underline; }
  .stp-rail h2 { text-align:center; margin:0 0 4px; font-size:19px; font-weight:800; }
  .stp-who { text-align:center; font-size:12.5px; color:var(--muted); margin-bottom:12px; }
  .stp-chips { display:flex; justify-content:center; gap:6px; flex-wrap:wrap; margin-bottom:14px; }
  .stp-chip { display:inline-flex; align-items:center; gap:6px; font-size:11px; font-weight:800; padding:4px 9px; border-radius:999px;
    color:var(--muted); background:var(--muted2); }
  .stp-chip.sm { font-size:9.5px; padding:2px 7px; }
  .stp-chip.ok { color:var(--adm-ok,#34d399); background:color-mix(in srgb,var(--adm-ok,#34d399) 16%,transparent); }
  .stp-chip.bad { color:var(--adm-danger,#f87171); background:color-mix(in srgb,var(--adm-danger,#f87171) 16%,transparent); }
  .stp-chip.warn { color:var(--adm-warn,#fbbf24); background:color-mix(in srgb,var(--adm-warn,#fbbf24) 16%,transparent); }
  .stp-meter { background:var(--bg); border:var(--border); border-radius:12px; padding:12px; margin-bottom:14px; }
  .stp-meter .lab { display:flex; justify-content:space-between; font-size:12px; font-weight:700; margin-bottom:8px; }
  .stp-meter .bar { height:7px; border-radius:999px; background:var(--muted2); overflow:hidden; }
  .stp-meter .bar i { display:block; height:100%; background:linear-gradient(90deg,var(--accent),var(--adm-ok,#34d399)); }
  .stp-meter .miss { font-size:11.5px; color:var(--muted); margin-top:8px; line-height:1.5; }
  .stp-qa { display:grid; gap:7px; }
  .stp-facts { margin-top:16px; }
  .stp-kv { display:flex; justify-content:space-between; gap:12px; padding:8px 0; border-bottom:1px dashed var(--border-c,#1d2430); font-size:12.5px; }
  .stp-kv:last-child { border-bottom:0; }
  .stp-kv span { color:var(--muted); }
  .stp-kv b { text-align:right; font-weight:700; }

  /* main column */
  .stp-main { padding:20px; display:grid; gap:13px; min-width:0; }
  .stp-card { background:var(--bg); border:var(--border); border-radius:15px; padding:17px; }
  .stp-card h3 { margin:0 0 4px; font-size:14.5px; font-weight:800; display:flex; align-items:center; gap:9px; flex-wrap:wrap; }
  .stp-sub { font-size:12.5px; color:var(--muted); line-height:1.6; margin:0 0 13px; }
  .stp-card.danger { border-color:color-mix(in srgb,var(--adm-danger,#f87171) 45%,transparent);
    background:color-mix(in srgb,var(--adm-danger,#f87171) 8%,var(--bg)); }
  .stp-grid { display:grid; grid-template-columns:1fr 1fr; gap:11px; }
  .stp-grid.three { grid-template-columns:repeat(3,1fr); }
  .stp-f { display:grid; gap:5px; min-width:0; }
  .stp-f.wide { grid-column:1/-1; }
  .stp-f > span { font-size:11.5px; font-weight:700; color:var(--muted); }
  .stp-in { width:100%; min-height:40px; padding:9px 11px; border-radius:10px; border:var(--border);
    background:var(--card); color:var(--text); font-size:13.5px; }
  .stp-in:focus { outline:none; border-color:var(--accent); box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 25%,transparent); }
  .stp-in:disabled { opacity:.55; }
  textarea.stp-in { min-height:70px; resize:vertical; }
  .stp-row { display:flex; gap:9px; flex-wrap:wrap; align-items:center; }
  .stp-btn { display:inline-flex; align-items:center; justify-content:flex-start; gap:8px; min-height:40px; padding:0 14px;
    border-radius:10px; border:var(--border); background:var(--card); color:var(--text); font-size:13px; font-weight:700;
    cursor:pointer; text-decoration:none; }
  .stp-btn:hover { border-color:var(--accent); }
  .stp-btn.pri { background:var(--accent); border-color:transparent; color:#fff; justify-content:center; }
  .stp-btn.dan { color:var(--adm-danger,#f87171); border-color:color-mix(in srgb,var(--adm-danger,#f87171) 45%,transparent);
    background:color-mix(in srgb,var(--adm-danger,#f87171) 12%,transparent); }
  .stp-btn.sm { min-height:32px; padding:0 12px; font-size:12.5px; }
  .stp-btn:disabled { opacity:.5; cursor:default; }
  .stp-pop { margin:8px 0 4px; padding:12px; border-radius:12px; background:var(--card); border:var(--border); display:grid; gap:9px; }
  .stp-pop.wide { margin-top:12px; }
  .stp-pop-row { display:flex; gap:8px; flex-wrap:wrap; }
  .stp-hint { font-size:11.5px; color:var(--muted); line-height:1.5; }
  .stp-reveal { font-size:12px; color:var(--adm-ok,#34d399); display:grid; gap:7px; }
  .stp-reveal code { font-size:16px; letter-spacing:1px; background:var(--bg); padding:8px 12px; border-radius:8px; color:var(--text); }
  .stp-tgl { display:flex; align-items:center; gap:12px; width:100%; padding:11px 13px; border-radius:11px;
    background:var(--card); border:var(--border); cursor:pointer; text-align:left; color:var(--text); }
  .stp-tgl .tb { flex:1; min-width:0; }
  .stp-tgl .tb b { display:block; font-size:13.5px; font-weight:700; }
  .stp-tgl .tb i { display:block; font-style:normal; font-size:11.5px; color:var(--muted); margin-top:2px; line-height:1.45; }
  .stp-tgl .track { width:42px; height:24px; border-radius:999px; background:var(--muted2); position:relative; flex:none; transition:background .16s; }
  .stp-tgl .track b { position:absolute; top:2px; left:2px; width:20px; height:20px; border-radius:50%; background:#fff; transition:left .16s; }
  .stp-tgl.on .track { background:var(--adm-ok,#34d399); }
  .stp-tgl.on .track b { left:20px; }
  .stp-days { display:flex; align-items:center; gap:6px; flex-wrap:wrap; margin-top:12px; }
  .stp-days > span { font-size:11.5px; font-weight:700; color:var(--muted); margin-right:4px; }
  .stp-days button { min-height:32px; padding:0 11px; border-radius:9px; border:var(--border); background:var(--card);
    color:var(--muted); font-size:12px; font-weight:700; cursor:pointer; }
  .stp-days button.on { border-color:var(--accent); background:color-mix(in srgb,var(--accent) 14%,transparent); color:var(--text); }
  .stp-table { width:100%; border-collapse:collapse; font-size:12.5px; margin-top:14px; }
  .stp-table th { text-align:left; font-size:10.5px; text-transform:uppercase; letter-spacing:.06em; color:var(--muted); padding:6px 8px; font-weight:800; }
  .stp-table td { padding:9px 8px; border-top:1px dashed var(--border-c,#1d2430); }
  .stp-table td:last-child, .stp-table th:last-child { text-align:right; font-weight:700; }
  .stp-tl div { display:flex; gap:12px; padding:9px 0; border-bottom:1px dashed var(--border-c,#1d2430); font-size:12.5px; }
  .stp-tl div:last-child { border-bottom:0; }
  .stp-tl time { color:var(--muted); flex:none; width:132px; }

  /* the permissions block */
  .stp-perms { border-color:color-mix(in srgb,#8344ee 45%,var(--border-c,#1d2430)); }
  .stp-fold { display:flex; align-items:center; gap:12px; width:100%; padding:0; border:0; background:none; color:var(--text); cursor:pointer; text-align:left; }
  .stp-fold .ic { width:36px; height:36px; border-radius:10px; display:grid; place-items:center; flex:none; font-size:16px;
    background:linear-gradient(135deg,#5f47ed,#8344ee 40%,#ad50c5 70%,#dd649e); }
  .stp-fold .tt { flex:1; min-width:0; }
  .stp-fold .tt b { display:block; font-size:14.5px; font-weight:800; }
  .stp-fold .tt i { display:block; font-style:normal; font-size:12.5px; color:var(--muted); margin-top:3px; line-height:1.5; }
  .stp-fold .tt em { font-style:normal; font-weight:800; color:var(--adm-warn,#fbbf24); }
  .stp-fold .caret { color:var(--muted); font-size:20px; transition:transform .18s; }
  .stp-fold.open .caret { transform:rotate(90deg); }
  .stp-fold-body { margin-top:14px; }
  .stp-permnote { font-size:12.5px; color:var(--muted); line-height:1.65; padding:11px 13px; border-radius:11px;
    background:color-mix(in srgb,#8344ee 8%,var(--card)); border:1px solid color-mix(in srgb,#8344ee 28%,transparent); margin:0 0 12px; }
  .stp-permnote a { color:var(--accent); }
  .stp-permgrp { border:1.5px solid color-mix(in srgb,#8344ee 45%,transparent); border-radius:14px; padding:13px; margin-bottom:10px;
    background:color-mix(in srgb,#8344ee 5%,var(--card)); }
  .stp-permgrp-h { margin-bottom:10px; }
  .stp-permgrp-h b { display:block; font-size:14px; font-weight:800; }
  .stp-permgrp-h i { display:block; font-style:normal; font-size:11.5px; color:var(--muted); margin-top:2px; }
  .stp-perm { display:flex; align-items:flex-start; gap:16px; padding:11px 12px; border-radius:11px; background:var(--bg);
    border:1px solid color-mix(in srgb,#dd649e 28%,transparent); margin-bottom:7px; }
  .stp-perm.custom { box-shadow:inset 4px 0 0 var(--adm-warn,#fbbf24); }
  .stp-perm-t { flex:1; min-width:0; }
  .stp-perm-t .nm { display:flex; align-items:center; gap:7px; flex-wrap:wrap; font-size:13.5px; font-weight:750; }
  .stp-perm-t .ds { font-size:12px; color:var(--muted); margin-top:3px; line-height:1.5; max-width:68ch; }
  .stp-perm-c { display:flex; flex-direction:column; align-items:flex-end; gap:5px; flex:none; }
  .stp-sel { min-height:36px; min-width:170px; padding:0 10px; border-radius:9px; border:var(--border);
    background:var(--card); color:var(--text); font-size:12.5px; font-weight:700; cursor:pointer; }
  .stp-sel:focus { outline:none; border-color:var(--accent); box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 25%,transparent); }
  .stp-fixed { display:flex; align-items:center; gap:8px; }
  .stp-fixed .hint { font-size:10.5px; color:var(--muted); }
  .stp-eff { font-size:10.5px; font-weight:800; }
  .stp-eff.yes { color:var(--adm-ok,#34d399); }
  .stp-eff.no { color:var(--adm-danger,#f87171); }

  @media (max-width:900px) {
    .stp-body { grid-template-columns:1fr; }
    .stp-rail { position:static; border-right:0; border-bottom:var(--border);
      min-height:0; max-height:none; overflow:visible; }
    .stp-grid, .stp-grid.three { grid-template-columns:1fr; }
    .stp-perm { flex-direction:column; }
    .stp-perm-c { align-items:flex-start; width:100%; }
    .stp-sel { width:100%; }
    .stp-tl time { width:auto; }
    .stp-sheet { border-radius:0; min-height:100dvh; margin:0; }
    /* On a phone the permissions header wraps to four lines, and a centred icon then floats in
       the middle of them. Pin it to the first line and let the text use the full width. */
    .stp-fold { align-items:flex-start; }
    .stp-fold .ic { margin-top:2px; }
    .stp-fold .caret { align-self:center; }
    .stp-top { border-radius:0; }
  }
  `}</style>;
}
