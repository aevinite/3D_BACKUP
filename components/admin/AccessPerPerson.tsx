"use client";
/* components/admin/AccessPerPerson.tsx — the Per-person tab of Access & permissions
 * (owner rebuild, 2026-07-31; spec docs/ACCESS-MODEL.md).
 *
 * The role sections (Manager / Owner's menu / Waiter) say what a person starts with. This screen is
 * the exception list: give ONE person more or less than their role's default. It renders
 * the SAME capability rows as that section — both come from lib/accessTree.ts — so the two
 * screens can never drift into offering different powers.
 *
 * WHERE AN OVERRIDE IS ENFORCED (role-dependent — getting this wrong writes a key nothing
 * reads, which is the bug class this rebuild exists to kill):
 *   • manager → the BARE power flag, read by managerCan()
 *   • waiter  → the tablet_* column,  read by tabletPerm()
 *   • owner / kitchen → no per-person path at all, so those people show an honest line
 *     instead of a switch that would save and do nothing.
 * Both live in staff_users.permissions and are written through /api/owner/staff. */
import { useCallback, useEffect, useMemo, useState } from "react";
import { type TreeState } from "@/lib/accessTree";
// The rows each role has now live in lib/staffCaps, shared with the person's PROFILE panel
// (components/admin/StaffProfile) and with the admin write route. One list, three screens —
// this used to be a private copy here, and a second copy would be free to drift.
import { capGroupsForRole, capVisible, capStates, roleDefault as capRoleDefault, countOverrides as countRoleOverrides } from "@/lib/staffCaps";

type Staff = { id: string; name: string | null; username: string; role: string; active?: boolean; permissions?: Record<string, string> };

const ROLE_LABEL: Record<string, string> = { owner: "Owner", manager: "Manager", tablet: "Waiter", kitchen: "Kitchen" };
const ROLE_COLOR: Record<string, string> = { owner: "#b491f0", manager: "#d4a574", tablet: "#60a5fa", kitchen: "#7ec88a" };
const ROLE_ORDER: Record<string, number> = { owner: 0, manager: 1, tablet: 2, kitchen: 3 };

// The states and their words come from lib/staffCaps, not a copy here — a private
// `OVERRIDE_STATES` said "On + PIN" while the person's profile said "On + manager PIN" for the
// same row, which reads as two different systems for one idea.
const STATE_LABEL: Record<string, string> = { default: "Default", on: "On", pin: "On + manager PIN", off: "Off" };

export default function AccessPerPerson({ rid }: { rid: string }) {
  const [staff, setStaff] = useState<Staff[] | null>(null);
  const [st, setSt] = useState<TreeState | null>(null);
  const [personId, setPersonId] = useState("");
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [saving, setSaving] = useState<"" | "saving" | "saved" | "err">("");
  const [err, setErr] = useState("");
  // THE RAIL COLLAPSES ON A PHONE ONCE YOU HAVE PICKED SOMEBODY (2026-08-06). Below 820px the
  // person list stacks ABOVE the card, so on a restaurant with eight staff you scrolled past
  // every name before the first permission appeared — on the tab whose whole point is ONE
  // person's exceptions. Open by default (you have to choose someone first), then it folds into
  // a "Choose a person ▾" button the moment you do. Desktop is untouched: there the rail is a
  // sticky column beside the card and hiding it would only take something away.
  const [pickerOpen, setPickerOpen] = useState(true);

  const load = useCallback((id: string) => {
    if (!id) return;
    fetch(`/api/owner/staff?rid=${id}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => { const s = (d.staff || d.users || d || []) as Staff[]; setStaff(Array.isArray(s) ? s : []); })
      .catch(() => setStaff([]));
    fetch(`/api/admin/restaurants/access-tree?restaurant_id=${id}`, { cache: "no-store" })
      .then((r) => r.json()).then((d) => { if (!d.error) setSt(d.state); }).catch(() => {});
  }, []);
  useEffect(() => { setStaff(null); setPersonId(""); load(rid); }, [rid, load]);

  const people = useMemo(() => {
    const list = (staff || []).filter((u) => u.active !== false);
    const q = query.trim().toLowerCase();
    return list
      .filter((u) => roleFilter === "all" || u.role === roleFilter)
      .filter((u) => !q || (u.name || "").toLowerCase().includes(q) || u.username.toLowerCase().includes(q))
      .sort((a, b) => (ROLE_ORDER[a.role] ?? 9) - (ROLE_ORDER[b.role] ?? 9) || (a.name || a.username).localeCompare(b.name || b.username));
  }, [staff, query, roleFilter]);

  const person = people.find((u) => u.id === personId) || people[0];

  const setOverride = (u: Staff, key: string, value: string) => {
    // "default" REMOVES the person's own setting so they follow their role again — sending
    // an empty string is how the staff API clears a key.
    const sent = value === "default" ? "" : value;
    setStaff((prev) => (prev || []).map((x) => x.id === u.id
      ? { ...x, permissions: { ...(x.permissions || {}), ...(sent ? { [key]: sent } : {}) , ...(sent ? {} : { [key]: undefined as unknown as string }) } }
      : x));
    setSaving("saving");
    // THE ADMIN ROUTE, deliberately (2026-08-04). This posted to /api/owner/staff, whose allow-list
    // was two hand-picked constants that had drifted from the rows this very screen renders — so
    // "Delete a bill" for one manager answered `Unknown permission` and the row snapped back with
    // "That change didn't save", while the identical dropdown in that person's profile worked.
    // Both routes now derive their allow-list from lib/staffCaps, and an admin screen uses the
    // admin route, which is what docs/STAFF-PROFILE.md has always said ("one list, three screens":
    // this tab, the profile, and app/api/admin/users).
    fetch("/api/admin/users", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: u.id, action: "set_permissions", permissions: { [key]: sent } }),
    })
      .then((r) => {
        if (!r.ok) { setErr("That change didn't save."); setSaving("err"); load(rid); return; }
        setErr(""); setSaving("saved"); setTimeout(() => setSaving(""), 1200);
      })
      .catch(() => { setErr("That change didn't save — the connection dropped."); setSaving("err"); load(rid); });
  };

  // Same rule as the tree: the stylesheet renders in every state, including while the list is in
  // flight, so nothing ever paints before its CSS exists.
  // No stylesheet render here: app/aevinite/access/page.tsx renders PerPersonStyle unconditionally,
  // so the CSS is in the server HTML long before this component decides what to show.
  if (!staff) return <div className="adm-muted" style={{ padding: 28, textAlign: "center" }}>Loading people…</div>;
  if (!staff.length) return <div className="acc2-warn"><div>This restaurant has no staff logins yet. Add people in the manager panel first.</div></div>;

  return (
    <>
      <div className="app-head">
        <span className={`acc2-save ${saving}`}>
          {saving === "saving" ? "Saving…" : saving === "saved" ? "Saved" : saving === "err" ? "Not saved" : ""}
        </span>
      </div>
      {err ? <div className="acc2-warn"><div>{err}</div></div> : null}

      <div className="app-wrap">
        {/* PHONE ONLY (display:none above 820px) — the fold handle for the rail below it. It
            names who is showing, so the collapsed state still answers "whose permissions am I
            looking at?" without opening anything. */}
        <button type="button" className="app-pick" aria-expanded={pickerOpen} onClick={() => setPickerOpen((v) => !v)}>
          <span className="who">{person ? (person.name || person.username) : "Choose a person"}</span>
          <span className="cta">{pickerOpen ? "Close" : "Change"}</span>
        </button>
        <aside className={`app-rail ${pickerOpen ? "" : "folded"}`}>
          <input className="app-search" placeholder="Find a person…" value={query} onChange={(e) => setQuery(e.target.value)} />
          <div className="app-chips">
            {["all", "manager", "tablet", "kitchen", "owner"].map((r) => (
              <button key={r} className={roleFilter === r ? "on" : ""} onClick={() => setRoleFilter(r)}
                style={r !== "all" ? { borderColor: roleFilter === r ? ROLE_COLOR[r] : undefined, color: roleFilter === r ? ROLE_COLOR[r] : undefined } : undefined}>
                {r === "all" ? "Everyone" : ROLE_LABEL[r]}
              </button>
            ))}
          </div>
          {people.length ? people.map((u) => (
            <button key={u.id} className={`app-prow ${person?.id === u.id ? "on" : ""}`} onClick={() => { setPersonId(u.id); setPickerOpen(false); }}>
              <span className="av" style={{ background: ROLE_COLOR[u.role] || "#888" }}>{(u.name || u.username).slice(0, 1).toUpperCase()}</span>
              <span className="nm">
                {u.name || u.username}
                <span className="rl" style={{ color: ROLE_COLOR[u.role] }}>{ROLE_LABEL[u.role] || u.role}</span>
              </span>
              <span className="ct">{overrideCount(u)}</span>
            </button>
          )) : <div className="adm-muted" style={{ padding: 14, fontSize: 12.5 }}>Nobody matches that.</div>}
        </aside>

        <section className="app-main">
          {person ? <PersonCard person={person} st={st} onSet={setOverride} /> : null}
        </section>
      </div>
    </>
  );
}

// The SHARED counter (lib/staffCaps), which counts only rows this person's role actually has.
// A private copy here counted every value in staff_users.permissions, so a leftover key from a
// retired permission put a blue "2" on someone whose every row read "Default" — and the same
// person's profile, which uses the shared helper, correctly said "All default".
const overrideCount = (u: Staff) => {
  const n = countRoleOverrides(u.role, u.permissions);
  return n ? String(n) : "";
};

function PersonCard({ person, st, onSet }: { person: Staff; st: TreeState | null; onSet: (u: Staff, key: string, v: string) => void }) {
  // THE SAME STRUCTURE AS ACCESS → MANAGER (owner, 2026-08-02: "inside permission, there will
  // be the same thing — manager menu, permission for manager and manager setting"). The groups
  // and rows come from the one tree, so a row added to the Manager section appears here by
  // itself — and a row whose FEATURE is off for this restaurant is NOT shown at all ("if the
  // feature is closed, it should not even be seen there"): a per-person dropdown for a thing
  // the restaurant doesn't have would be a dead switch wearing a person's name.
  // Restaurant-wide rows (the mgrset sections, an owner's pages) show read-only — the truth,
  // never a control that saves nothing.
  const groups = capGroupsForRole(person.role)
    .map((g) => ({ ...g, caps: g.caps.filter((c) => capVisible(c, st)) }))
    .filter((g) => g.caps.length);
  const editable = groups.some((g) => g.caps.some((c) => c.perPerson));
  const roleName = ROLE_LABEL[person.role] || person.role;

  if (!editable) {
    // Owners and kitchen staff have no per-person enforcement path, so we say that plainly
    // rather than render switches that would save and never be read.
    return (
      <div className="adm-card">
        <h2 style={{ margin: "0 0 6px", fontSize: 16 }}>{person.name || person.username}</h2>
        <p className="adm-muted" style={{ fontSize: 13, margin: 0, lineHeight: 1.6 }}>
          {person.role === "owner"
            ? "An owner is the top of their own restaurant — there is nothing to limit here. What their restaurant has at all is set in Main features."
            : "The kitchen app has no per-person settings. What it shows is decided by Main features and the Manager's menu."}
        </p>
      </div>
    );
  }

  return (
    <div className="adm-card">
      <div className="app-phead">
        <span className="av lg" style={{ background: ROLE_COLOR[person.role] || "#888" }}>{(person.name || person.username).slice(0, 1).toUpperCase()}</span>
        <div>
          <h2>{person.name || person.username}</h2>
          <p>{roleName} · {person.username}</p>
        </div>
      </div>
      <p className="app-note">
        <b>Default</b> follows what every {roleName.toLowerCase()} here gets — change that in the <b>{roleName}</b> section of the General tab.
        Anything you set below applies to this one person and takes effect on their very next tap; no re-login.
      </p>

      {groups.map((g) => (
        <div key={g.group}>
          <div className="app-grp-h">{g.group}</div>
          {g.caps.map((cap) => {
            const { node, key, pin, perPerson } = cap;
            const restaurantSays = st ? capRoleDefault(cap, st) : null;
            const cur = person.permissions?.[key];
            const value = cur === "on" || cur === "off" || cur === "pin" ? cur : "default";
            const defaultReads = restaurantSays ? (STATE_LABEL[restaurantSays] || restaurantSays) : "";
            return (
              <div key={key} className="app-cap">
                <div className="app-cap-b">
                  <div className="nm">{node.name}</div>
                  <div className="ds">{node.what}</div>
                </div>
                {perPerson ? (
                  <div className="app-segs" role="radiogroup" aria-label={node.name}>
                    {capStates(pin).map((s) => (
                      <button key={s} role="radio" aria-checked={value === s}
                        className={`${value === s ? "on" : ""} ${s === "default" ? "def" : ""}`}
                        onClick={() => onSet(person, key, s)}>
                        {s === "default" && defaultReads ? `Default · ${defaultReads}` : STATE_LABEL[s]}
                      </button>
                    ))}
                  </div>
                ) : (
                  /* Restaurant-wide row (a Manager-settings section): the truth, read-only —
                     a per-person dropdown here would save a key nothing reads. */
                  <div className="app-fixed">
                    {/* The truth, and only once we know it — a chip that says "On" while the
                        restaurant's settings are still loading is a claim we can't stand behind. */}
                    <span className={`chip ${restaurantSays === "off" ? "off" : restaurantSays ? "on" : "wait"}`}>
                      {restaurantSays ? (STATE_LABEL[restaurantSays] || restaurantSays) : "…"}
                    </span>
                    <span className="hint">set for the restaurant</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

export function PerPersonStyle() {
  // PLAIN <style href precedence>, deliberately NOT `<style jsx global>` — the same rule the
  // Access page itself follows (app/aevinite/access/page.tsx). styled-jsx injects its CSS from
  // JavaScript AFTER hydration, so this tab painted as raw browser defaults for a frame: unboxed
  // rows, unstyled segmented buttons, a rail with no card. A plain <style> is server-rendered
  // above the markup it styles. Do not convert this back. (2026-08-04)
  return <style href="adm-access-person" precedence="default">{`
  .app-head { display:flex; justify-content:flex-end; min-height:18px; margin:0 0 8px; }
  .app-wrap { display:grid; grid-template-columns:260px 1fr; gap:16px; align-items:start; }
  .app-rail { position:sticky; top:12px; max-height:calc(100dvh - 96px); overflow-y:auto; background:var(--card); border:var(--border); border-radius:14px; padding:8px; }
  .app-search { width:100%; height:36px; border-radius:9px; border:var(--border); background:var(--bg); color:var(--text); font-size:13px; padding:0 10px; margin-bottom:8px; }
  .app-chips { display:flex; flex-wrap:wrap; gap:5px; margin-bottom:8px; }
  .app-chips button { min-height:28px; padding:0 9px; border-radius:8px; border:var(--border); background:var(--bg); color:var(--muted); font-size:11.5px; font-weight:700; cursor:pointer; }
  .app-chips button.on { background:color-mix(in srgb,var(--accent) 14%,transparent); border-color:var(--accent); color:var(--accent); }
  .app-prow { display:flex; align-items:center; gap:10px; width:100%; min-height:46px; padding:6px 9px; border:none; background:transparent; border-radius:10px; cursor:pointer; text-align:left; color:var(--text); }
  .app-prow:hover { background:color-mix(in srgb,var(--accent) 7%,transparent); }
  .app-prow.on { background:color-mix(in srgb,var(--accent) 12%,transparent); }
  .app-prow .av, .app-phead .av { width:28px; height:28px; border-radius:50%; display:grid; place-items:center; flex:none; font-weight:800; font-size:12px; color:#10131a; }
  .app-phead .av.lg { width:42px; height:42px; font-size:17px; }
  .app-prow .nm { flex:1; min-width:0; font-size:13.5px; font-weight:700; display:flex; flex-direction:column; }
  .app-prow .rl { font-size:10.5px; font-weight:800; letter-spacing:.02em; }
  .app-prow .ct { font-size:10.5px; font-weight:800; color:var(--accent); }
  .app-main { min-width:0; }
  .app-phead { display:flex; align-items:center; gap:12px; margin-bottom:10px; }
  .app-phead h2 { margin:0; font-size:16.5px; font-weight:800; }
  .app-phead p { margin:2px 0 0; font-size:12.5px; color:var(--muted); }
  .app-note { font-size:12.5px; color:var(--muted); line-height:1.6; margin:0 0 14px; padding:10px 12px; border-radius:10px; background:var(--bg); border:var(--border); }
  .app-grp-h { font-size:11px; font-weight:800; letter-spacing:.06em; text-transform:uppercase; color:var(--muted); margin:16px 2px 7px; }
  .app-fixed { display:flex; align-items:center; gap:8px; flex:none; }
  .app-fixed .chip { font-size:11px; font-weight:800; padding:4px 10px; border-radius:8px; }
  .app-fixed .chip.on { color:#22c55e; background:color-mix(in srgb,#22c55e 14%,transparent); }
  .app-fixed .chip.off { color:#ef4444; background:color-mix(in srgb,#ef4444 14%,transparent); }
  .app-fixed .chip.wait { color:var(--muted); background:var(--muted2); }
  .app-fixed .hint { font-size:11px; color:var(--muted); }
  .app-cap { display:flex; align-items:flex-start; gap:14px; padding:11px 12px; border-radius:11px; background:var(--bg); margin-bottom:7px; }
  .app-cap-b { flex:1; min-width:0; }
  .app-cap .nm { font-size:14px; font-weight:700; }
  .app-cap .ds { font-size:12px; color:var(--muted); margin-top:2px; line-height:1.5; }
  .app-segs { display:flex; gap:3px; background:var(--card); border:var(--border); border-radius:9px; padding:3px; flex:none; flex-wrap:wrap; justify-content:flex-end; }
  .app-segs button { min-height:30px; padding:0 10px; border:none; border-radius:7px; background:transparent; color:var(--muted); font-weight:700; font-size:11.5px; cursor:pointer; white-space:nowrap; }
  .app-segs button.on { background:var(--accent); color:#fff; }
  .app-segs button.def.on { background:var(--muted2); color:var(--text); }
  /* The fold handle is a PHONE control only — on desktop the rail is a sticky column beside the
     card and there is nothing to fold. */
  .app-pick { display:none; }
  @media (max-width:820px) {
    .app-wrap { grid-template-columns:1fr; }
    .app-rail { position:static; max-height:none; }
    .app-cap { flex-direction:column; }
    .app-segs { justify-content:flex-start; }
    .app-pick { display:flex; align-items:center; justify-content:space-between; gap:10px; width:100%; min-height:46px; padding:0 14px; margin:0 0 10px; border-radius:12px; border:var(--border); background:var(--card); color:var(--text); font-size:14px; font-weight:700; cursor:pointer; }
    .app-pick .who { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .app-pick .cta { flex:none; font-size:12px; font-weight:800; color:var(--accent); }
    /* Folded = the whole rail is out of the way, so the card is the first thing on the screen.
       display:none rather than height:0 — a list nobody can reach should not be in the tab order
       or read out by a screen reader either. */
    .app-rail.folded { display:none; }
  }
  `}</style>;
}
