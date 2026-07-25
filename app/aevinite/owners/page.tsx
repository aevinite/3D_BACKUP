"use client";
// /aevinite/owners — manage OWNER accounts platform-wide (redesign 2026-07-25:
// two-pane "Roster", sibling of the Access + Users pages). One owner can own
// 1..N restaurants; a restaurant can have MANY owners (the restaurant_owners join
// table, mig 097). Create the login ONCE, then attach/detach restaurants.
//   LEFT rail  → searchable list of every owner (avatar, login, count, status).
//   RIGHT pane → the selected owner: profile, restaurants owned (primary/co-owner
//                badge + open-their-panel eye + remove), activity trail, danger zone.
// Opening a panel carries &uid=<owner> so it lands on THAT owner's cockpit even when
// the restaurant has several owners (the dashboard chooser uses the same uid).
// Data + writes: /api/admin/owners (admin-cookie gated, service-role) — unchanged.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAdminModal } from "@/components/admin/useAdminModal";

type OwnedRest = { id: string; slug: string; name: string; active: boolean; primary: boolean };
type Owner = {
  id: string; username: string; name: string; active: boolean;
  lastSeenAt: string | null; createdAt: string; restaurants: OwnedRest[];
};
type Rest = { id: string; slug: string; name: string; active: boolean; hasOwner: boolean };

const card: React.CSSProperties = { background: "var(--card)", border: "var(--border)", borderRadius: 14, padding: 18 };
const field: React.CSSProperties = { boxSizing: "border-box", padding: "10px 12px", borderRadius: 10, border: "var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 14, width: "100%" };
const btn = (bg: string): React.CSSProperties => ({ padding: "9px 13px", borderRadius: 9, border: 0, background: bg, color: "#fff", fontWeight: 600, fontSize: 13, cursor: "pointer" });
const label: React.CSSProperties = { display: "grid", gap: 4, fontSize: 12, color: "var(--muted)" };

// A stable accent per restaurant so its chip is recognisable across owners.
const CHIP_COLORS = ["#34d399", "#60a5fa", "#a78bfa", "#fb923c", "#f472b6", "#22d3ee", "#fbbf24", "#a3e635", "#f87171", "#818cf8", "#2dd4bf", "#e879f9"];
const chipColor = (id: string) => {
  let h = 0; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return CHIP_COLORS[h % CHIP_COLORS.length];
};
const initials = (n: string) => n.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
const seen = (iso: string | null) => {
  if (!iso) return "never";
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 2) return "just now";
  if (m < 60) return `${m} min ago`;
  if (m < 60 * 24) return `${Math.floor(m / 60)} h ago`;
  return `${Math.floor(m / 1440)} d ago`;
};
// Open a specific owner's cockpit for one restaurant — pins to the owner (uid) so a
// restaurant with several owners still lands on the right person (dashboard chooser
// uses the identical link). No password, invisible to the owner.
const panelHref = (rid: string, uid: string) =>
  `/api/admin/act-as/go?rid=${encodeURIComponent(rid)}&to=/owner&uid=${encodeURIComponent(uid)}`;

export default function AdminOwners() {
  const [owners, setOwners] = useState<Owner[]>([]);
  const [rests, setRests] = useState<Rest[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [query, setQuery] = useState("");
  // The owner shown in the RIGHT pane. Defaults to the first owner once loaded; on a
  // phone the pane is a drill-in (rail hidden while a person is open).
  const [selId, setSelId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setErr("");
    try {
      const r = await fetch("/api/admin/owners", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) { setErr(j.error || "Failed to load."); return; }
      setOwners(j.owners || []);
      setRests(j.restaurants || []);
    } catch { setErr("Network error."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const unowned = useMemo(() => rests.filter((r) => !r.hasOwner && r.active), [rests]);
  const filteredOwners = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return owners;
    return owners.filter((o) =>
      o.name.toLowerCase().includes(q) ||
      o.username.toLowerCase().includes(q) ||
      o.restaurants.some((r) => r.name.toLowerCase().includes(q)));
  }, [owners, query]);
  const kpis = useMemo(() => ({
    owners: owners.filter((o) => o.active).length,
    covered: rests.filter((r) => r.hasOwner).length,
    total: rests.length,
    multi: owners.filter((o) => o.restaurants.length > 1).length,
    suspended: owners.filter((o) => !o.active).length,
  }), [owners, rests]);

  // Keep a valid selection: pick the first owner once loaded / after filtering / after a
  // delete removes the selected one. Never auto-select on a phone (would hide the rail).
  const isPhone = typeof window !== "undefined" && !!window.matchMedia?.("(max-width: 860px)").matches;
  useEffect(() => {
    if (loading || isPhone) return;
    if (selId && filteredOwners.some((o) => o.id === selId)) return;
    setSelId(filteredOwners[0]?.id ?? null);
  }, [loading, filteredOwners, selId, isPhone]);
  const selected = owners.find((o) => o.id === selId) || null;

  return (
    <>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 260 }}>
          <h1 className="adm-page-h">Owners</h1>
          <p className="adm-page-sub">One owner account owns <b>1 or many</b> restaurants — and a restaurant can have <b>several owners</b>. Pick a person on the left to manage them.</p>
        </div>
        <button style={btn("#3b82f6")} onClick={() => setShowCreate(true)}><i className="fas fa-plus" style={{ marginRight: 7, fontSize: 11 }} aria-hidden="true" />New owner</button>
      </div>

      {err ? <div style={{ ...card, borderColor: "#7f1d1d", color: "#fca5a5", margin: "12px 0", padding: 12 }}>{err}</div> : null}

      {/* KPI strip */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, margin: "14px 0" }}>
        <Kpi label="Active owners" value={loading ? "…" : kpis.owners} icon="fa-crown" color="#60a5fa" />
        <Kpi label="Restaurants covered" value={loading ? "…" : `${kpis.covered} / ${kpis.total}`} icon="fa-store" color="#34d399" />
        <Kpi label="Multi-restaurant owners" value={loading ? "…" : kpis.multi} icon="fa-layer-group" color="#fbbf24" />
        <Kpi label="Suspended" value={loading ? "…" : kpis.suspended} icon="fa-ban" color="#f87171" />
      </div>

      {/* No-owner warning — an unowned ACTIVE restaurant has an unreachable owner panel */}
      {unowned.length > 0 && (
        <div style={{ ...card, padding: 12, marginBottom: 14, borderColor: "#b45309", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 13, color: "#fcd34d" }}><i className="fas fa-triangle-exclamation" style={{ marginRight: 7 }} aria-hidden="true" />{unowned.length === 1 ? "1 restaurant has" : `${unowned.length} restaurants have`} no owner:</span>
          {unowned.map((r) => <span key={r.id} style={{ ...chip, borderColor: "#b45309" }}><span style={{ ...dot, background: chipColor(r.id) }} />{r.name}</span>)}
          <span style={{ fontSize: 12, color: "var(--muted)" }}>— attach them to an owner.</span>
        </div>
      )}

      {/* ── Two-pane roster ─────────────────────────────────────────────────── */}
      {loading ? (
        <div style={{ ...card, color: "var(--muted)" }}>Loading…</div>
      ) : owners.length === 0 ? (
        <div style={{ ...card, color: "var(--muted)", textAlign: "center", padding: 40 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", marginBottom: 6 }}>No owners yet</div>
          <div style={{ fontSize: 13, marginBottom: 16 }}>Create your first owner and attach the restaurants they run.</div>
          <button style={btn("#3b82f6")} onClick={() => setShowCreate(true)}><i className="fas fa-plus" style={{ marginRight: 7, fontSize: 11 }} aria-hidden="true" />New owner</button>
        </div>
      ) : (
        <div className="own-pane">
          {/* LEFT rail — search + people list */}
          <div className={`own-rail${selected ? " has-sel" : ""}`}>
            <div style={{ position: "relative", padding: 10, borderBottom: "var(--border)" }}>
              <i className="fas fa-magnifying-glass" aria-hidden="true" style={{ position: "absolute", left: 21, top: "50%", transform: "translateY(-50%)", color: "var(--muted)", fontSize: 12 }} />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search owners…" aria-label="Search owners" style={{ ...field, paddingLeft: 32 }} />
            </div>
            <div className="own-list">
              {filteredOwners.length === 0 ? (
                <div style={{ padding: 16, fontSize: 13, color: "var(--muted)" }}>No owners match “{query}”.</div>
              ) : filteredOwners.map((o) => {
                const on = o.id === selId;
                return (
                  <button key={o.id} className={`own-row${on ? " sel" : ""}`} onClick={() => setSelId(o.id)}>
                    <span aria-hidden className="own-av" style={{ background: `${chipColor(o.id)}33`, color: chipColor(o.id) }}>{initials(o.name)}</span>
                    <span style={{ minWidth: 0, flex: 1, textAlign: "left" }}>
                      <span className="own-nm">{o.name}{!o.active && <span style={{ fontSize: 10.5, color: "#fca5a5", fontWeight: 600 }}> · off</span>}</span>
                      <span className="own-sub">@{o.username} · {o.restaurants.length} restaurant{o.restaurants.length === 1 ? "" : "s"}</span>
                    </span>
                    <span className={`own-cnt${!o.active ? " off" : ""}`}>{o.restaurants.length}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* RIGHT pane — the selected owner */}
          <div className={`own-detail${selected ? " open" : ""}`}>
            {!selected ? (
              <div style={{ ...card, color: "var(--muted)", minHeight: 320, display: "grid", placeItems: "center", textAlign: "center" }}>
                <div><i className="fas fa-hand-pointer" style={{ fontSize: 22, opacity: .5, marginBottom: 10 }} aria-hidden="true" /><div>Pick an owner on the left to manage them.</div></div>
              </div>
            ) : (
              <OwnerDetail key={selected.id} owner={selected} rests={rests}
                onBack={() => setSelId(null)}
                busy={busy} setBusy={setBusy}
                onChanged={load}
                onDeleted={() => { setSelId(null); load(); }} />
            )}
          </div>
        </div>
      )}

      {showCreate && (
        <CreateOwnerModal rests={rests}
          onClose={() => setShowCreate(false)}
          onCreated={(id) => { setShowCreate(false); load(); setSelId(id); }} />
      )}

      <style jsx>{`
        .own-pane { display: grid; grid-template-columns: 320px 1fr; gap: 14px; align-items: start; }
        .own-rail { background: var(--card); border: var(--border); border-radius: 14px; overflow: hidden; position: sticky; top: 12px; }
        .own-list { max-height: 66vh; overflow-y: auto; }
        .own-row { display: flex; align-items: center; gap: 11px; width: 100%; padding: 11px 12px; background: transparent; border: 0; border-bottom: var(--border); border-left: 3px solid transparent; cursor: pointer; transition: background .14s ease; text-align: left; }
        .own-row:hover { background: color-mix(in srgb, var(--accent) 8%, transparent); }
        .own-row.sel { background: color-mix(in srgb, var(--accent) 14%, transparent); border-left-color: var(--accent); }
        .own-av { width: 38px; height: 38px; border-radius: 11px; display: grid; place-items: center; font-weight: 800; font-size: 14px; flex: none; }
        .own-nm { display: block; font-weight: 700; font-size: 13.5px; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .own-sub { display: block; font-size: 11.5px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .own-cnt { font-size: 12px; font-weight: 800; color: var(--accent); background: color-mix(in srgb, var(--accent) 15%, transparent); border-radius: 8px; padding: 3px 9px; flex: none; }
        .own-cnt.off { color: var(--muted); background: var(--muted2); }
        @media (max-width: 860px) {
          .own-pane { grid-template-columns: 1fr; }
          .own-rail { position: static; }
          .own-rail.has-sel { display: none; }
          .own-detail:not(.open) { display: none; }
          .own-list { max-height: none; }
        }
      `}</style>
    </>
  );
}

function Kpi({ label, value, icon, color }: { label: string; value: React.ReactNode; icon: string; color: string }) {
  return (
    <div style={{ ...card, padding: 14, display: "flex", alignItems: "center", gap: 12 }}>
      <span aria-hidden style={{ width: 34, height: 34, borderRadius: 10, background: `${color}22`, color, display: "grid", placeItems: "center", flex: "none" }}>
        <i className={`fas ${icon}`} style={{ fontSize: 14 }} />
      </span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 10.5, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--muted)" }}>{label}</div>
        <div style={{ fontSize: 21, fontWeight: 800, marginTop: 2 }}>{value}</div>
      </div>
    </div>
  );
}

const chip: React.CSSProperties = { display: "inline-flex", gap: 6, alignItems: "center", border: "var(--border)", borderRadius: 999, padding: "3.5px 10px", fontSize: 12, color: "var(--text)", fontWeight: 600 };
const dot: React.CSSProperties = { width: 7, height: 7, borderRadius: "50%", flexShrink: 0 };
const actBtn: React.CSSProperties = { border: "var(--border)", background: "var(--bg)", borderRadius: 9, padding: "8px 11px", fontSize: 12.5, fontWeight: 700, color: "var(--text)", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 };
const ic: React.CSSProperties = { fontSize: 11 };

// ─────────────────────────────────────────────────────────────────────────────
// OwnerDetail — the RIGHT pane. Everything about one owner: profile + actions,
// the restaurants they own (add / remove / open-their-panel), the activity trail,
// and the suspend-first permanent-delete zone. Activity is fetched ONCE per owner.
// ─────────────────────────────────────────────────────────────────────────────
type ActivityRow = { id: string; panel: string; action: string; actor: string | null; detail: string | null; restaurant: string | null; at: string };
const PANEL_COLOR: Record<string, string> = { owner: "#34d399", admin: "#60a5fa", manager: "#d4a574", kitchen: "#7ec88a", tablet: "#a78bfa", editor: "#d4a574" };

function OwnerDetail({ owner, rests, onBack, busy, setBusy, onChanged, onDeleted }: {
  owner: Owner; rests: Rest[]; onBack: () => void; busy: boolean; setBusy: (b: boolean) => void;
  onChanged: () => void; onDeleted: () => void;
}) {
  const [activity, setActivity] = useState<ActivityRow[] | null>(null);
  const [created, setCreated] = useState<string | null>(owner.createdAt || null);
  const [mErr, setMErr] = useState("");
  const [pwReveal, setPwReveal] = useState<string | null>(null);
  const [showAttach, setShowAttach] = useState(false);
  const attachable = rests.filter((r) => !owner.restaurants.some((x) => x.id === r.id));

  async function patch(payload: object): Promise<any> {
    const r = await fetch("/api/admin/owners", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "Action failed.");
    return j;
  }
  const run = async (fn: () => Promise<void>) => {
    setMErr(""); setBusy(true);
    try { await fn(); onChanged(); } catch (e: any) { setMErr(e.message || "Action failed."); }
    finally { setBusy(false); }
  };

  useEffect(() => {
    let dead = false;
    setActivity(null);
    fetch(`/api/admin/owners?id=${encodeURIComponent(owner.id)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => { if (dead) return; setActivity(j.activity || []); if (j.owner?.createdAt) setCreated(j.owner.createdAt); })
      .catch(() => { if (!dead) setActivity([]); });
    return () => { dead = true; };
  }, [owner.id]);

  const attachRestaurant = (rid: string) => { setShowAttach(false); run(async () => { await patch({ owner_id: owner.id, action: "attach", restaurant_id: rid }); }); };
  const detachRestaurant = (r: OwnedRest) => {
    if (!confirm(`Remove "${r.name}" from ${owner.name}? They immediately stop seeing its numbers.`)) return;
    run(async () => { await patch({ owner_id: owner.id, action: "detach", restaurant_id: r.id }); });
  };

  async function deleteForever() {
    if (!confirm(`Delete ${owner.name} FOREVER?\n\nThis cannot be undone. Their restaurants fall back to a co-owner or to "no owner". The activity log is kept.`)) return;
    const typed = prompt(`Type their username (${owner.username}) to confirm the permanent delete:`);
    if (typed === null) return;
    if (typed.trim().toLowerCase() !== owner.username.toLowerCase()) { setMErr("Username didn't match — nothing was deleted."); return; }
    setMErr(""); setBusy(true);
    try {
      const r = await fetch(`/api/admin/owners?id=${encodeURIComponent(owner.id)}`, { method: "DELETE" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "Delete failed.");
      onDeleted();
    } catch (e: any) { setMErr(e.message || "Delete failed."); setBusy(false); }
  }

  const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true });

  return (
    <div style={{ ...card, padding: 0, overflow: "hidden" }}>
      {/* Hero */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "18px 20px", borderBottom: "var(--border)", background: "color-mix(in srgb, var(--accent) 5%, transparent)" }}>
        <button className="own-back" onClick={onBack} aria-label="Back to list"><i className="fas fa-arrow-left" aria-hidden="true" /></button>
        <span aria-hidden style={{ width: 52, height: 52, borderRadius: 14, background: `${chipColor(owner.id)}33`, color: chipColor(owner.id), display: "grid", placeItems: "center", fontWeight: 800, fontSize: 19, flex: "none" }}>{initials(owner.name)}</span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 19, fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{owner.name}</div>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>
            @{owner.username} · {owner.active ? <span style={{ color: "#34d399", fontWeight: 700 }}>Active</span> : <span style={{ color: "#f87171", fontWeight: 700 }}>Suspended</span>}
            · created {created ? new Date(created).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—"} · seen {seen(owner.lastSeenAt)}
          </div>
        </div>
      </div>

      <div style={{ padding: 18, display: "grid", gap: 16 }}>
        {mErr ? <div style={{ ...card, padding: 12, borderColor: "#7f1d1d", color: "#fca5a5" }}>{mErr}</div> : null}

        {/* Actions */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button style={actBtn} disabled={busy}
            onClick={() => { const nn = prompt(`New name / login for ${owner.name}:`, owner.name); if (nn && nn.trim() && nn.trim() !== owner.name) run(async () => { await patch({ owner_id: owner.id, action: "rename", name: nn.trim() }); }); }}><i className="fas fa-pen" style={ic} aria-hidden="true" />Rename</button>
          <button style={actBtn} disabled={busy}
            onClick={() => { if (confirm(`Set a NEW password for ${owner.name}? They'll be logged out everywhere.`)) run(async () => { const j = await patch({ owner_id: owner.id, action: "reset_password" }); setPwReveal(j.password); }); }}><i className="fas fa-key" style={ic} aria-hidden="true" />Reset password</button>
          <button style={{ ...actBtn, color: owner.active ? "#fca5a5" : "#86efac" }} disabled={busy}
            onClick={() => { if (confirm(owner.active ? `Suspend ${owner.name}? They're logged out immediately and can't sign in.` : `Restore ${owner.name}'s access?`)) run(async () => { await patch({ owner_id: owner.id, action: "set_active", active: !owner.active }); }); }}>
            <i className={`fas ${owner.active ? "fa-ban" : "fa-rotate-left"}`} style={ic} aria-hidden="true" />{owner.active ? "Suspend" : "Restore"}</button>
        </div>

        {/* One-time reset password */}
        {pwReveal ? (
          <div style={{ ...card, padding: 12, borderColor: "#166534", background: "rgba(22,101,52,.08)" }}>
            <div style={{ fontSize: 12.5, color: "#86efac" }}>New password for <b>{owner.name}</b> — copy it now, it won&apos;t be shown again:</div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
              <code style={{ fontSize: 17, background: "var(--bg)", padding: "8px 12px", borderRadius: 8, letterSpacing: 1 }}>{pwReveal}</code>
              <button style={btn("#3b82f6")} onClick={() => navigator.clipboard?.writeText(pwReveal)}>Copy</button>
              <button style={btn("#374151")} onClick={() => setPwReveal(null)}>Done</button>
            </div>
          </div>
        ) : null}

        {/* Restaurants owned */}
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <div style={{ fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--muted)", flex: 1 }}>Owns {owner.restaurants.length} restaurant{owner.restaurants.length === 1 ? "" : "s"}</div>
            <button style={{ ...chip, borderStyle: "dashed", color: "#60a5fa", cursor: "pointer", background: "transparent", padding: "7px 11px" }} disabled={busy}
              onClick={() => setShowAttach((s) => !s)}>
              <i className={`fas ${showAttach ? "fa-xmark" : "fa-plus"}`} style={{ fontSize: 10 }} aria-hidden="true" />{showAttach ? "Close" : "Assign restaurant"}</button>
          </div>

          <div style={{ display: "grid", gap: 8 }}>
            {owner.restaurants.map((r) => (
              <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 13px", border: "var(--border)", borderRadius: 11, flexWrap: "wrap" }}>
                <span aria-hidden style={{ width: 30, height: 30, borderRadius: 8, background: chipColor(r.id), flex: "none" }} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 13.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}{!r.active && <span style={{ fontSize: 10.5, color: "#fca5a5", fontWeight: 600 }}> · suspended</span>}</div>
                  <div style={{ fontSize: 11.5, marginTop: 1 }}>
                    {r.primary
                      ? <span style={{ color: "#fbbf24", fontWeight: 700 }}><i className="fas fa-star" style={{ fontSize: 9, marginRight: 4 }} aria-hidden="true" />Primary owner</span>
                      : <span style={{ color: "#60a5fa", fontWeight: 700 }}><i className="fas fa-user-group" style={{ fontSize: 9, marginRight: 4 }} aria-hidden="true" />Co-owner</span>}
                  </div>
                </div>
                <a style={{ ...actBtn, textDecoration: "none", color: "#60a5fa", padding: "7px 10px" }}
                  title={`Open ${owner.name}'s owner panel for ${r.name} (no password, invisible to them)`}
                  href={panelHref(r.id, owner.id)} target="_blank" rel="noreferrer">
                  <i className="fas fa-eye" style={ic} aria-hidden="true" />Open panel</a>
                <button aria-label={`Remove ${r.name}`} disabled={busy} style={{ ...actBtn, color: "#fca5a5", padding: "7px 10px" }} onClick={() => detachRestaurant(r)}><i className="fas fa-xmark" style={ic} aria-hidden="true" /></button>
              </div>
            ))}
            {owner.restaurants.length === 0 && <div style={{ fontSize: 12.5, color: "var(--muted)", padding: "6px 2px" }}>No restaurants yet — assign one above.</div>}
          </div>

          {/* Assign picker */}
          {showAttach && (
            <div style={{ border: "var(--border)", borderRadius: 10, maxHeight: 220, overflowY: "auto", marginTop: 8 }}>
              {attachable.length === 0 && <div style={{ padding: 10, fontSize: 12.5, color: "var(--muted)" }}>They already own every restaurant.</div>}
              {attachable.map((r) => (
                <button key={r.id} disabled={busy} style={{ display: "flex", gap: 9, alignItems: "center", width: "100%", padding: "9px 12px", background: "transparent", border: 0, borderTop: "var(--border)", color: "var(--text)", fontSize: 13, cursor: "pointer", textAlign: "left" }}
                  onClick={() => attachRestaurant(r.id)}>
                  <i className="fas fa-plus" style={{ fontSize: 10, color: "#60a5fa" }} aria-hidden="true" />
                  <span style={{ ...dot, background: chipColor(r.id) }} />
                  <span style={{ flex: 1 }}>{r.name}</span>
                  <span style={{ fontSize: 11, color: r.hasOwner ? "var(--muted)" : "#fcd34d" }}>{r.hasOwner ? "co-own" : "no owner yet"}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Activity trail */}
        <div>
          <div style={{ fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--muted)", marginBottom: 8 }}>Activity — what they did &amp; what was done to them</div>
          <div style={{ border: "var(--border)", borderRadius: 10, maxHeight: 300, overflowY: "auto" }}>
            {activity === null && <div style={{ padding: 12, fontSize: 12.5, color: "var(--muted)" }}>Loading activity…</div>}
            {activity?.length === 0 && <div style={{ padding: 12, fontSize: 12.5, color: "var(--muted)" }}>No recorded activity yet.</div>}
            {activity?.map((a) => (
              <div key={a.id} style={{ display: "flex", gap: 9, alignItems: "flex-start", padding: "8px 12px", borderTop: "var(--border)", fontSize: 12.5 }}>
                <span style={{ flexShrink: 0, marginTop: 3, width: 7, height: 7, borderRadius: "50%", background: PANEL_COLOR[a.panel] || "#9ca3af" }} title={a.panel} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <span style={{ fontWeight: 700 }}>{a.action.replace(/_/g, " ")}</span>
                  {a.actor ? <span style={{ color: "var(--muted)" }}> · by {a.actor}</span> : null}
                  {a.restaurant ? <span style={{ color: "var(--muted)" }}> · {a.restaurant}</span> : null}
                  {a.detail ? <div style={{ color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={a.detail}>{a.detail}</div> : null}
                </div>
                <span style={{ flexShrink: 0, color: "var(--muted)", fontSize: 11 }} title={a.at}>{when(a.at)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Danger zone */}
        <div style={{ ...card, padding: 14, borderColor: "#7f1d1d", background: "rgba(127,29,29,.06)" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#fca5a5", marginBottom: 6 }}>Danger zone</div>
          {owner.active ? (
            <div style={{ fontSize: 12, color: "var(--muted)" }}>
              To delete this owner forever, <b>suspend them first</b> (the reversible step). Once deleted there is NO restore.
            </div>
          ) : (
            <>
              <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>
                This owner is suspended. Deleting is <b>permanent</b> — no restore. Their restaurants fall to a co-owner or become &ldquo;no owner&rdquo;; the activity log is kept.
              </div>
              <button style={btn("#991b1b")} disabled={busy} onClick={deleteForever}><i className="fas fa-trash-can" style={{ marginRight: 6, fontSize: 11 }} aria-hidden="true" />Delete forever</button>
            </>
          )}
        </div>
      </div>

      <style jsx>{`
        .own-back { display: none; }
        @media (max-width: 860px) {
          .own-back { display: inline-grid; place-items: center; width: 34px; height: 34px; border-radius: 9px; border: var(--border); background: var(--bg); color: var(--text); cursor: pointer; flex: none; }
        }
      `}</style>
    </div>
  );
}

// ── Create-owner modal: name + optional password + multi-select restaurants ──
function CreateOwnerModal({ rests, onClose, onCreated }: {
  rests: Rest[]; onClose: () => void; onCreated: (id: string) => void;
}) {
  const [name, setName] = useState("");
  const [pw, setPw] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [reveal, setReveal] = useState<{ id: string; name: string; password: string; warn?: string } | null>(null);
  const creatingRef = useRef(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  useAdminModal(dialogRef, "admin-new-owner", onClose);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (creatingRef.current) return;
    creatingRef.current = true;
    setErr(""); setBusy(true);
    try {
      const r = await fetch("/api/admin/owners", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create_owner", name, password: pw, restaurant_ids: Array.from(picked) }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(j.error || "Could not create owner."); return; }
      // Show the one-time password INSIDE the modal, then hand the new id up on "Done"
      // so the roster selects the new person.
      setReveal({ id: j.id, name: j.name, password: j.password, warn: j.attachErrors && j.attachErrors.length ? `Heads-up: ${j.attachErrors.length} restaurant(s) couldn't be attached — add them from their card.` : undefined });
    } catch { setErr("Network error."); }
    finally { setBusy(false); creatingRef.current = false; }
  }

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(2,6,16,0.66)", backdropFilter: "blur(2px)", zIndex: 1000 }} />
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="New owner" style={{ position: "fixed", inset: 0, zIndex: 1001, display: "grid", placeItems: "center", padding: 16, pointerEvents: "none" }}>
        {reveal ? (
          <div style={{ ...card, pointerEvents: "auto", width: "min(96vw, 440px)", display: "grid", gap: 12 }}>
            <div style={{ fontSize: 16, fontWeight: 800 }}>Owner “{reveal.name}” created</div>
            <div style={{ fontSize: 12.5, color: "#86efac" }}>Password — copy it now, it won&apos;t be shown again:</div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <code style={{ fontSize: 18, background: "var(--bg)", padding: "8px 12px", borderRadius: 8, letterSpacing: 1 }}>{reveal.password}</code>
              <button style={btn("#3b82f6")} onClick={() => navigator.clipboard?.writeText(reveal.password)}>Copy</button>
            </div>
            {reveal.warn && <div style={{ fontSize: 12, color: "#fcd34d" }}>{reveal.warn}</div>}
            <button style={btn("#22c55e")} onClick={() => onCreated(reveal.id)}>Done</button>
          </div>
        ) : (
          <form onSubmit={create} style={{ ...card, pointerEvents: "auto", width: "min(96vw, 440px)", maxHeight: "90vh", overflowY: "auto", display: "grid", gap: 13 }}>
            <div style={{ fontSize: 16, fontWeight: 800 }}>New owner</div>
            {err ? <div style={{ fontSize: 12.5, color: "#fca5a5" }}>{err}</div> : null}
            <label style={label}>Name / username <span style={{ color: "var(--muted)" }}>· this is their login</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Rakesh Patel" style={field} autoFocus required />
            </label>
            <label style={label}>Password (blank = auto-generated, shown once)
              <div style={{ position: "relative" }}>
                <input type={showPw ? "text" : "password"} value={pw} onChange={(e) => setPw(e.target.value)} placeholder="leave blank to generate" autoComplete="new-password" style={{ ...field, paddingRight: 44 }} />
                <button type="button" onClick={() => setShowPw((s) => !s)} aria-label={showPw ? "Hide password" : "Show password"} style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", background: "transparent", border: 0, color: "var(--muted)", cursor: "pointer", fontSize: 14, padding: 8 }}>
                  <i className={`fas ${showPw ? "fa-eye-slash" : "fa-eye"}`} aria-hidden="true" />
                </button>
              </div>
            </label>
            <div style={label as React.CSSProperties}>
              Assign restaurants (pick 1 or many — a restaurant can have several owners)
              <div style={{ border: "var(--border)", borderRadius: 10, maxHeight: 220, overflowY: "auto", marginTop: 4 }}>
                {rests.length === 0 && <div style={{ padding: 10, fontSize: 12.5, color: "var(--muted)" }}>No restaurants yet.</div>}
                {rests.map((r) => {
                  const on = picked.has(r.id);
                  return (
                    <button type="button" key={r.id} style={{ display: "flex", gap: 10, alignItems: "center", width: "100%", padding: "9px 12px", background: "transparent", border: 0, borderTop: "var(--border)", color: "var(--text)", fontSize: 13.5, cursor: "pointer", textAlign: "left" }}
                      onClick={() => setPicked((s) => { const n = new Set(s); if (on) n.delete(r.id); else n.add(r.id); return n; })}>
                      <span aria-hidden style={{ width: 17, height: 17, borderRadius: 5, border: on ? 0 : "1.5px solid var(--muted)", background: on ? "#22c55e" : "transparent", color: "#052e16", display: "grid", placeItems: "center", fontSize: 10, fontWeight: 900, flexShrink: 0 }}>{on ? <i className="fas fa-check" /> : null}</span>
                      <span style={{ ...dot, background: chipColor(r.id) }} />
                      <span style={{ flex: 1 }}>{r.name}</span>
                      <span style={{ fontSize: 11, color: r.hasOwner ? "var(--muted)" : "#fcd34d" }}>{r.hasOwner ? "has an owner" : "no owner yet"}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="submit" disabled={busy} style={{ ...btn("#22c55e"), flex: 1, opacity: busy ? 0.6 : 1 }}>{busy ? "Creating…" : "Create owner & show password"}</button>
              <button type="button" style={btn("#374151")} onClick={onClose}>Cancel</button>
            </div>
          </form>
        )}
      </div>
    </>
  );
}
