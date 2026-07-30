"use client";
// /aevinite/owners — manage OWNER accounts platform-wide (redesign 2026-07-25:
// two-pane "Roster", sibling of the Access + Users pages). One owner can own
// 1..N restaurants; a restaurant can have MANY owners (the restaurant_owners join
// table, mig 097). Create the login ONCE, then attach/detach restaurants.
//   PINNED HEADER → title + clickable KPI filters + search + sort (never scrolls).
//   LEFT rail  → the owner list (scrolls on its own).
//   RIGHT pane → the selected owner: profile, restaurants owned (primary/co-owner
//                badge + open-their-panel eye + remove), activity trail, danger zone.
// Opening a panel carries &uid=<owner> so it lands on THAT owner's cockpit even when
// the restaurant has several owners (the dashboard chooser uses the same uid).
// Data + writes: /api/admin/owners (admin-cookie gated, service-role) — unchanged.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAdminModal } from "@/components/admin/useAdminModal";
import { CopyButton } from "@/components/admin/CopyButton";

type OwnedRest = { id: string; slug: string; name: string; active: boolean; primary: boolean };
type Owner = {
  id: string; username: string; name: string; active: boolean;
  lastSeenAt: string | null; createdAt: string; restaurants: OwnedRest[];
};
type Rest = { id: string; slug: string; name: string; active: boolean; hasOwner: boolean };
type Filter = "all" | "active" | "multi" | "suspended";
type Sort = "name" | "restaurants" | "recent" | "status";

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
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("name");
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
  const kpis = useMemo(() => ({
    owners: owners.filter((o) => o.active).length,
    covered: rests.filter((r) => r.hasOwner).length,
    total: rests.length,
    multi: owners.filter((o) => o.restaurants.length > 1).length,
    suspended: owners.filter((o) => !o.active).length,
  }), [owners, rests]);

  // Which restaurant a search matched (so searching a RESTAURANT surfaces its owner and
  // shows why the row is here). Empty when the query matched the person's name/login.
  const matchedRestaurant = (o: Owner, q: string): string | null => {
    if (!q) return null;
    if (o.name.toLowerCase().includes(q) || o.username.toLowerCase().includes(q)) return null;
    return o.restaurants.find((r) => r.name.toLowerCase().includes(q))?.name || null;
  };

  const visibleOwners = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = owners.filter((o) => {
      if (filter === "active" && !o.active) return false;
      if (filter === "suspended" && o.active) return false;
      if (filter === "multi" && o.restaurants.length <= 1) return false;
      if (!q) return true;
      return o.name.toLowerCase().includes(q) || o.username.toLowerCase().includes(q) ||
        o.restaurants.some((r) => r.name.toLowerCase().includes(q));
    });
    const by: Record<Sort, (a: Owner, b: Owner) => number> = {
      name: (a, b) => a.name.localeCompare(b.name),
      restaurants: (a, b) => b.restaurants.length - a.restaurants.length || a.name.localeCompare(b.name),
      recent: (a, b) => (new Date(b.lastSeenAt || 0).getTime()) - (new Date(a.lastSeenAt || 0).getTime()) || a.name.localeCompare(b.name),
      status: (a, b) => (Number(b.active) - Number(a.active)) || a.name.localeCompare(b.name),
    };
    return [...list].sort(by[sort]);
  }, [owners, query, filter, sort]);

  // Keep a valid selection: pick the first owner once loaded / after filtering / after a
  // delete removes the selected one. Never auto-select on a phone (would hide the rail).
  const isPhone = typeof window !== "undefined" && !!window.matchMedia?.("(max-width: 860px)").matches;
  useEffect(() => {
    if (loading || isPhone) return;
    if (selId && visibleOwners.some((o) => o.id === selId)) return;
    setSelId(visibleOwners[0]?.id ?? null);
  }, [loading, visibleOwners, selId, isPhone]);
  const selected = owners.find((o) => o.id === selId) || null;
  const setF = (f: Filter) => setFilter((cur) => (cur === f ? "all" : f));

  return (
    <div className="own-page">
      {/* ── PINNED HEADER ─────────────────────────────────────────────────── */}
      <div className="own-head">
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <h1 className="adm-page-h" style={{ marginBottom: 2 }}>Owners</h1>
            <p className="adm-page-sub" style={{ marginBottom: 0 }}>One owner owns <b>1 or many</b> restaurants — and a restaurant can have <b>several owners</b>.</p>
          </div>
          <button style={btn("#3b82f6")} onClick={() => setShowCreate(true)}><i className="fas fa-plus" style={{ marginRight: 7, fontSize: 11 }} aria-hidden="true" />New owner</button>
        </div>

        {err ? <div style={{ ...card, borderColor: "#7f1d1d", color: "#fca5a5", margin: "10px 0 0", padding: 12 }}>{err}</div> : null}

        {/* KPI strip — each card is a FILTER (tap to filter the list, tap again to clear) */}
        <div className="own-kpis">
          <KpiButton label="Active owners" value={loading ? "…" : kpis.owners} icon="fa-crown" color="#60a5fa" active={filter === "active"} onClick={() => setF("active")} />
          <KpiButton label="Restaurants covered" value={loading ? "…" : `${kpis.covered} / ${kpis.total}`} icon="fa-store" color="#34d399" active={false} onClick={() => { setFilter("all"); setQuery(""); }} hint="Show all owners (clear filters)" />
          <KpiButton label="Multi-restaurant" value={loading ? "…" : kpis.multi} icon="fa-layer-group" color="#fbbf24" active={filter === "multi"} onClick={() => setF("multi")} />
          <KpiButton label="Suspended" value={loading ? "…" : kpis.suspended} icon="fa-ban" color="#f87171" active={filter === "suspended"} onClick={() => setF("suspended")} />
        </div>

        {/* No-owner warning */}
        {unowned.length > 0 && (
          <div style={{ ...card, padding: 11, marginTop: 10, borderColor: "#b45309", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: 13, color: "#fcd34d" }}><i className="fas fa-triangle-exclamation" style={{ marginRight: 7 }} aria-hidden="true" />{unowned.length === 1 ? "1 restaurant has" : `${unowned.length} restaurants have`} no owner:</span>
            {unowned.map((r) => <span key={r.id} style={{ ...chip, borderColor: "#b45309" }}><span style={{ ...dot, background: chipColor(r.id) }} />{r.name}</span>)}
          </div>
        )}

        {/* Search + sort */}
        <div className="own-tools">
          <div style={{ position: "relative", flex: 1, minWidth: 180 }}>
            <i className="fas fa-magnifying-glass" aria-hidden="true" style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--muted)", fontSize: 12 }} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search owners — or a restaurant to find its owner…" aria-label="Search owners or restaurants" style={{ ...field, paddingLeft: 32 }} />
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, color: "var(--muted)", whiteSpace: "nowrap" }}>
            <i className="fas fa-arrow-down-short-wide" aria-hidden="true" />
            <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort owners"
              style={{ ...field, width: "auto", padding: "9px 10px", cursor: "pointer" }}>
              <option value="name">Name A–Z</option>
              <option value="restaurants">Most restaurants</option>
              <option value="recent">Recently active</option>
              <option value="status">Status (active first)</option>
            </select>
          </label>
        </div>
      </div>

      {/* ── TWO-PANE BODY (scrolls under the header) ──────────────────────── */}
      {loading ? (
        <div style={{ ...card, color: "var(--muted)", marginTop: 12 }}>Loading…</div>
      ) : owners.length === 0 ? (
        <div style={{ ...card, color: "var(--muted)", textAlign: "center", padding: 40, marginTop: 12 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", marginBottom: 6 }}>No owners yet</div>
          <div style={{ fontSize: 13, marginBottom: 16 }}>Create your first owner and attach the restaurants they run.</div>
          <button style={btn("#3b82f6")} onClick={() => setShowCreate(true)}><i className="fas fa-plus" style={{ marginRight: 7, fontSize: 11 }} aria-hidden="true" />New owner</button>
        </div>
      ) : (
        <div className="own-pane">
          {/* LEFT rail — the owner list */}
          <div className={`own-rail${selected ? " has-sel" : ""}`}>
            {visibleOwners.length === 0 ? (
              <div style={{ padding: 16, fontSize: 13, color: "var(--muted)" }}>No owners match your filter{query ? ` / “${query}”` : ""}.</div>
            ) : visibleOwners.map((o) => {
              const on = o.id === selId;
              const match = matchedRestaurant(o, query.trim().toLowerCase());
              return (
                <button key={o.id} className={`own-row${on ? " sel" : ""}`} onClick={() => setSelId(o.id)}>
                  <span aria-hidden className="own-av" style={{ background: `${chipColor(o.id)}33`, color: chipColor(o.id) }}>{initials(o.name)}</span>
                  <span style={{ minWidth: 0, flex: 1, textAlign: "left" }}>
                    <span className="own-nm">{o.name}{!o.active && <span style={{ fontSize: 10.5, color: "#fca5a5", fontWeight: 600 }}> · off</span>}</span>
                    <span className="own-sub">@{o.username} · {o.restaurants.length} restaurant{o.restaurants.length === 1 ? "" : "s"}</span>
                    {match && <span className="own-match"><i className="fas fa-store" style={{ fontSize: 8.5, marginRight: 4 }} aria-hidden="true" />owns {match}</span>}
                  </span>
                  <span className={`own-cnt${!o.active ? " off" : ""}`}>{o.restaurants.length}</span>
                </button>
              );
            })}
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
          // Select the new owner AFTER the reload lands — setting selId before load()
          // resolves let the auto-select effect (running against the stale list) reset
          // it back to the first owner, so the detail pane showed the wrong person.
          onCreated={(id) => { setShowCreate(false); load().then(() => setSelId(id)); }} />
      )}

      <style jsx>{`
        .own-page { display: flex; flex-direction: column; overflow-x: hidden; }
        .own-head { flex: none; }
        /* minmax(0,1fr), not 1fr: a bare 1fr track has an implicit min of min-content,
           so a wide KPI card pushed the grid past the viewport and the cards ran
           off-screen with nothing to scroll on a phone. minmax(0,…) lets them shrink. */
        .own-kpis { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin-top: 12px; }
        .own-tools { display: flex; gap: 10px; align-items: center; margin-top: 10px; flex-wrap: wrap; }
        /* minmax(0,1fr): stop the detail column blowing out past its track when a child
           has wide min-content (e.g. long activity UUIDs) — the clip-on-the-right bug. */
        .own-pane { display: grid; grid-template-columns: 320px minmax(0, 1fr); gap: 14px; align-items: stretch; margin-top: 12px; }
        .own-rail { background: var(--card); border: var(--border); border-radius: 14px; overflow: hidden auto; min-height: 0; scrollbar-gutter: stable; }
        .own-detail { min-width: 0; min-height: 0; overflow: hidden auto; scrollbar-gutter: stable; }
        .own-row { display: flex; align-items: center; gap: 11px; width: 100%; padding: 11px 12px; background: transparent; border: 0; border-bottom: var(--border); border-left: 3px solid transparent; cursor: pointer; transition: background .14s ease; text-align: left; }
        .own-row:hover { background: color-mix(in srgb, var(--accent) 8%, transparent); }
        .own-row.sel { background: color-mix(in srgb, var(--accent) 14%, transparent); border-left-color: var(--accent); }
        .own-av { width: 38px; height: 38px; border-radius: 11px; display: grid; place-items: center; font-weight: 800; font-size: 14px; flex: none; }
        .own-nm { display: block; font-weight: 700; font-size: 13.5px; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .own-sub { display: block; font-size: 11.5px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .own-match { display: block; font-size: 11px; color: var(--accent); font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 1px; }
        .own-cnt { font-size: 12px; font-weight: 800; color: var(--accent); background: color-mix(in srgb, var(--accent) 15%, transparent); border-radius: 8px; padding: 3px 9px; flex: none; }
        .own-cnt.off { color: var(--muted); background: var(--muted2); }

        /* Desktop: pinned header, list + detail scroll independently inside the admin
           main scroll-port (which has a definite height: .adm is 100dvh, .adm-main flex:1). */
        @media (min-width: 861px) {
          :global(.adx-wrap) { height: 100%; }
          .own-page { height: 100%; min-height: 0; }
          .own-pane { flex: 1; min-height: 0; overflow: hidden; }
        }
        @media (max-width: 860px) {
          .own-kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); }
          .own-pane { grid-template-columns: 1fr; }
          .own-rail.has-sel { display: none; }
          .own-detail:not(.open) { display: none; }
        }
      `}</style>
    </div>
  );
}

// A KPI card that doubles as a FILTER toggle (owner 2026-07-25 — "click the top ones,
// give us the list"). Highlighted with an accent ring when its filter is active.
function KpiButton({ label, value, icon, color, active, onClick, hint }: {
  label: string; value: React.ReactNode; icon: string; color: string; active: boolean; onClick: () => void; hint?: string;
}) {
  return (
    <button onClick={onClick} title={hint ? hint : `Show ${label.toLowerCase()}`} aria-pressed={active}
      style={{
        ...card, padding: 13, display: "flex", alignItems: "center", gap: 11, cursor: "pointer", textAlign: "left",
        borderColor: active ? color : (card.border as string), boxShadow: active ? `0 0 0 2px ${color}` : undefined,
        background: active ? `color-mix(in srgb, ${color} 12%, var(--card))` : (card.background as string), transition: "box-shadow .14s, border-color .14s",
      }}>
      <span aria-hidden style={{ width: 32, height: 32, borderRadius: 9, background: `${color}22`, color, display: "grid", placeItems: "center", flex: "none" }}>
        <i className={`fas ${icon}`} style={{ fontSize: 13 }} />
      </span>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 10, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>
        <span style={{ display: "block", fontSize: 19, fontWeight: 800, marginTop: 1 }}>{value}</span>
      </span>
    </button>
  );
}

const chip: React.CSSProperties = { display: "inline-flex", gap: 6, alignItems: "center", border: "var(--border)", borderRadius: 999, padding: "3.5px 10px", fontSize: 12, color: "var(--text)", fontWeight: 600 };
const dot: React.CSSProperties = { width: 7, height: 7, borderRadius: "50%", flexShrink: 0 };
const actBtn: React.CSSProperties = { border: "var(--border)", background: "var(--bg)", borderRadius: 9, padding: "8px 11px", fontSize: 12.5, fontWeight: 700, color: "var(--text)", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 };
const ic: React.CSSProperties = { fontSize: 11 };

// ─────────────────────────────────────────────────────────────────────────────
// Shared modal kit — replaces the old native confirm()/prompt() browser boxes with
// on-theme dialogs (owner ask 2026-07-26). All plug into useAdminModal, so each one
// gets Escape-to-close, phone-Back-to-close, focus-trap and background scroll-lock.
// ─────────────────────────────────────────────────────────────────────────────
const TONE = {
  danger: { c: "#f87171", bg: "rgba(248,113,113,.14)", cta: "linear-gradient(135deg,#ef4444,#b91c1c)" },
  ok: { c: "#34d399", bg: "rgba(52,211,153,.14)", cta: "linear-gradient(135deg,#22c55e,#16a34a)" },
  blue: { c: "#60a5fa", bg: "rgba(96,165,250,.14)", cta: "linear-gradient(135deg,#3b82f6,#2563eb)" },
} as const;
type Tone = keyof typeof TONE;
type Fact = { i: string; c?: string; t: React.ReactNode };

const ghostBtn: React.CSSProperties = { background: "transparent", border: "var(--border)", color: "var(--text)", borderRadius: 11, padding: "11px 16px", fontSize: 13.5, fontWeight: 700, cursor: "pointer" };
const ctaBtn = (tone: Tone): React.CSSProperties => ({ border: 0, borderRadius: 11, padding: "11px 16px", fontSize: 13.5, fontWeight: 700, cursor: "pointer", color: "#fff", background: TONE[tone].cta, display: "inline-flex", alignItems: "center", gap: 8 });
const modalCard: React.CSSProperties = { pointerEvents: "auto", background: "var(--card)", border: "var(--border)", borderRadius: 18, boxShadow: "0 0 0 1px rgba(34,211,238,.10), 0 30px 70px -30px #000", maxHeight: "90vh", display: "flex", flexDirection: "column", overflow: "hidden" };

// Scrim + centred dialog wrapper. Every modal below renders through this.
function ModalShell({ id, onClose, width = 460, label, children }: {
  id: string; onClose: () => void; width?: number; label: string; children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useAdminModal(ref, id, onClose);
  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(2,6,16,0.66)", backdropFilter: "blur(3px)", zIndex: 1000 }} />
      <div style={{ position: "fixed", inset: 0, zIndex: 1001, display: "grid", placeItems: "center", padding: 16, pointerEvents: "none" }}>
        <div ref={ref} role="dialog" aria-modal="true" aria-label={label} style={{ ...modalCard, width: `min(96vw, ${width}px)` }}>
          {children}
        </div>
      </div>
    </>
  );
}

function ModalHead({ tone, icon, title, sub, subColor }: { tone: Tone; icon: string; title: string; sub?: string; subColor?: string }) {
  return (
    <div style={{ display: "flex", gap: 14, alignItems: "flex-start", padding: "20px 20px 4px" }}>
      <span aria-hidden style={{ width: 46, height: 46, borderRadius: 13, display: "grid", placeItems: "center", fontSize: 19, flex: "none", background: TONE[tone].bg, color: TONE[tone].c }}><i className={`fas ${icon}`} /></span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <h2 style={{ fontSize: 18, fontWeight: 800, letterSpacing: "-.01em", margin: 0 }}>{title}</h2>
        {sub ? <p style={{ fontSize: 12.5, color: subColor || "var(--muted)", margin: "3px 0 0", lineHeight: 1.5 }}>{sub}</p> : null}
      </div>
    </div>
  );
}

function FactList({ facts, danger }: { facts: Fact[]; danger?: boolean }) {
  return (
    <div style={{ display: "grid", gap: 8, border: danger ? "1px solid #7f1d1d" : "var(--border)", borderRadius: 12, padding: 12, background: danger ? "rgba(127,29,29,.10)" : "rgba(255,255,255,.015)" }}>
      {facts.map((f, i) => (
        <div key={i} style={{ display: "flex", gap: 10, fontSize: 12.5, alignItems: "flex-start" }}>
          <i className={`fas ${f.i}`} aria-hidden="true" style={{ width: 15, textAlign: "center", marginTop: 2, flex: "none", color: f.c || "var(--muted)" }} />
          <div>{f.t}</div>
        </div>
      ))}
    </div>
  );
}

function OwnerChip({ owner }: { owner: Owner }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "11px 12px", border: "var(--border)", borderRadius: 12, background: "rgba(255,255,255,.02)" }}>
      <span aria-hidden style={{ width: 38, height: 38, borderRadius: 11, background: `${chipColor(owner.id)}33`, color: chipColor(owner.id), display: "grid", placeItems: "center", fontWeight: 800, fontSize: 14, flex: "none" }}>{initials(owner.name)}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 750, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{owner.name}</div>
        <div style={{ fontSize: 11.5, color: "var(--muted)" }}>@{owner.username}</div>
      </div>
      <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: ".04em", textTransform: "uppercase", padding: "3px 8px", borderRadius: 999, background: owner.active ? TONE.ok.bg : TONE.danger.bg, color: owner.active ? TONE.ok.c : TONE.danger.c }}>{owner.active ? "Active" : "Suspended"}</span>
    </div>
  );
}

function RestChip({ r }: { r: OwnedRest }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "11px 12px", border: "var(--border)", borderRadius: 12, background: "rgba(255,255,255,.02)" }}>
      <span aria-hidden style={{ width: 30, height: 30, borderRadius: 8, background: chipColor(r.id), flex: "none" }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 13.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</div>
        <div style={{ fontSize: 11.5, marginTop: 1 }}>{r.primary ? <span style={{ color: "#fbbf24", fontWeight: 700 }}>Primary owner</span> : <span style={{ color: "#60a5fa", fontWeight: 700 }}>Co-owner</span>}</div>
      </div>
    </div>
  );
}

// Generic confirm dialog: header + optional chip + a "what happens" list + Cancel/CTA.
// Powers Suspend, Restore, Reset-password and Remove-restaurant.
export type ConfirmCfg = {
  tone: Tone; icon: string; title: string; sub?: string;
  ownerChip?: boolean; chip?: React.ReactNode; facts: Fact[];
  ctaLabel: string; ctaTone?: Tone; ctaIcon?: string; onYes: () => void;
};
function ConfirmModal({ cfg, owner, onConfirm, onClose }: {
  cfg: ConfirmCfg; owner: Owner; onConfirm: () => void; onClose: () => void;
}) {
  const ctaTone = cfg.ctaTone || cfg.tone;
  return (
    <ModalShell id="admin-owner-confirm" onClose={onClose} width={440} label={cfg.title}>
      <ModalHead tone={cfg.tone} icon={cfg.icon} title={cfg.title} sub={cfg.sub} subColor={cfg.tone === "danger" ? "#fca5a5" : undefined} />
      <div style={{ padding: "14px 20px 4px", display: "grid", gap: 12 }}>
        {cfg.ownerChip ? <OwnerChip owner={owner} /> : cfg.chip}
        <FactList facts={cfg.facts} />
      </div>
      <div style={{ display: "flex", gap: 9, justifyContent: "flex-end", padding: "16px 20px 20px" }}>
        <button style={ghostBtn} onClick={onClose}>Cancel</button>
        <button style={ctaBtn(ctaTone)} onClick={onConfirm}><i className={`fas ${cfg.ctaIcon || cfg.icon}`} aria-hidden="true" />{cfg.ctaLabel}</button>
      </div>
    </ModalShell>
  );
}

// Rename dialog — a single labelled field (replaces the native prompt()).
function RenameModal({ owner, busy, onSave, onClose }: { owner: Owner; busy: boolean; onSave: (name: string) => void; onClose: () => void }) {
  const [name, setName] = useState(owner.name);
  const valid = !!name.trim() && name.trim() !== owner.name;
  const submit = (e: React.FormEvent) => { e.preventDefault(); if (valid && !busy) onSave(name.trim()); };
  return (
    <ModalShell id="admin-owner-rename" onClose={onClose} width={440} label={`Rename ${owner.name}`}>
      <form onSubmit={submit}>
        <ModalHead tone="blue" icon="fa-pen" title={`Rename ${owner.name}`} sub="This is also their login — they sign in with the new name." />
        <div style={{ padding: "14px 20px 4px", display: "grid", gap: 8 }}>
          <label style={{ ...label }}>New name / login
            <input value={name} onChange={(e) => setName(e.target.value)} style={field} autoFocus required maxLength={80} />
          </label>
        </div>
        <div style={{ display: "flex", gap: 9, justifyContent: "flex-end", padding: "16px 20px 20px" }}>
          <button type="button" style={ghostBtn} onClick={onClose}>Cancel</button>
          <button type="submit" style={{ ...ctaBtn("blue"), opacity: valid && !busy ? 1 : 0.4, cursor: valid && !busy ? "pointer" : "not-allowed" }} disabled={!valid || busy}><i className="fas fa-check" aria-hidden="true" />Save name</button>
        </div>
      </form>
    </ModalShell>
  );
}

// Permanent-delete dialog — folds the old confirm()+prompt() into one card. The red
// button stays disabled until the typed text matches the username (case-insensitive).
function DeleteForeverModal({ owner, busy, onConfirm, onClose }: { owner: Owner; busy: boolean; onConfirm: () => void; onClose: () => void }) {
  const [typed, setTyped] = useState("");
  const v = typed.trim().toLowerCase();
  const match = v === owner.username.toLowerCase();
  const hint = !v
    ? { c: "var(--muted)", i: "fa-keyboard", t: "Waiting for the username…" }
    : match ? { c: TONE.ok.c, i: "fa-circle-check", t: "Matches — ready to move to the bin." }
      : { c: "#fbbf24", i: "fa-circle-exclamation", t: "Doesn’t match yet." };
  return (
    <ModalShell id="admin-owner-delete" onClose={onClose} width={460} label={`Move ${owner.name} to the recycle bin`}>
      <ModalHead tone="danger" icon="fa-trash-can" title={`Move ${owner.name} to the recycle bin?`} sub="Restorable for 90 days — nothing is erased yet." subColor="#fca5a5" />
      <div style={{ padding: "14px 20px 4px", display: "grid", gap: 12 }}>
        <FactList danger facts={[
          { i: "fa-box-archive", c: "#fbbf24", t: <>They leave the Owners list and go to the <b>Recycle bin</b></> },
          { i: "fa-store", c: "#34d399", t: <>Their restaurants <b>stay linked</b> and come back if you restore</> },
          { i: "fa-clock-rotate-left", c: "#34d399", t: <><b>Restorable for 90 days</b>; only after that can they be permanently removed</> },
        ]} />
        <div style={{ fontSize: 12.5, color: "var(--muted)" }}>Type <b style={{ color: "var(--text)" }}>{owner.username}</b> to confirm:</div>
        <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={owner.username} autoComplete="off" spellCheck={false} aria-label="Type the username to confirm deletion"
          style={{ ...field, fontFamily: "ui-monospace, Menlo, monospace", fontSize: 15, borderColor: match ? "#7f1d1d" : undefined }}
          onKeyDown={(e) => { if (e.key === "Enter" && match && !busy) onConfirm(); }} />
        <div style={{ fontSize: 11.5, display: "flex", alignItems: "center", gap: 6, color: hint.c }}><i className={`fas ${hint.i}`} aria-hidden="true" />{hint.t}</div>
      </div>
      <div style={{ display: "flex", gap: 9, justifyContent: "flex-end", padding: "16px 20px 20px" }}>
        <button style={ghostBtn} onClick={onClose}>Cancel</button>
        <button style={{ ...ctaBtn("danger"), opacity: match && !busy ? 1 : 0.4, cursor: match && !busy ? "pointer" : "not-allowed" }} disabled={!match || busy} onClick={onConfirm}><i className="fas fa-trash-can" aria-hidden="true" />Move to recycle bin</button>
      </div>
    </ModalShell>
  );
}

// Big searchable restaurant picker (owner ask 2026-07-26 — "a whole big pop up with
// search"). Multi-select so several can be attached in one go; "needs an owner"
// restaurants surface first so an unowned one is never lost.
function AssignRestaurantModal({ owner, attachable, busy, onAssign, onClose }: {
  owner: Owner; attachable: Rest[]; busy: boolean; onAssign: (ids: string[]) => void; onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const ql = q.trim().toLowerCase();
  const avail = useMemo(() => attachable.filter((r) => r.name.toLowerCase().includes(ql)), [attachable, ql]);
  const needs = avail.filter((r) => !r.hasOwner);
  const have = avail.filter((r) => r.hasOwner);
  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const n = picked.size;

  const Row = (r: Rest) => {
    const on = picked.has(r.id);
    return (
      <button key={r.id} type="button" onClick={() => toggle(r.id)}
        style={{ display: "flex", gap: 12, alignItems: "center", width: "100%", padding: "11px 14px", background: on ? "var(--muted2)" : "transparent", border: 0, borderTop: "var(--border)", color: "var(--text)", cursor: "pointer", textAlign: "left", fontSize: 14 }}>
        <span aria-hidden style={{ width: 20, height: 20, borderRadius: 6, border: on ? 0 : "1.6px solid var(--muted)", background: on ? "var(--accent)" : "transparent", color: "#04121a", display: "grid", placeItems: "center", fontSize: 11, fontWeight: 900, flex: "none" }}>{on ? <i className="fas fa-check" /> : null}</span>
        <span aria-hidden style={{ width: 26, height: 26, borderRadius: 8, background: chipColor(r.id), flex: "none" }} />
        <span style={{ flex: 1, fontWeight: 600 }}>{r.name}</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: r.hasOwner ? "var(--muted)" : "#fbbf24" }}>{r.hasOwner ? "co-own" : "needs an owner"}</span>
      </button>
    );
  };
  const ghead = (txt: string, color?: string): React.CSSProperties => ({ fontSize: 10.5, letterSpacing: ".09em", textTransform: "uppercase", color: color || "var(--muted)", padding: "10px 14px 6px", position: "sticky", top: 0, background: "var(--card)" });

  return (
    <ModalShell id="admin-owner-assign" onClose={onClose} width={560} label="Assign a restaurant">
      <ModalHead tone="blue" icon="fa-store" title="Assign a restaurant" sub={undefined} />
      <div style={{ padding: "0 20px", marginTop: -6 }}>
        <p style={{ fontSize: 12.5, color: "var(--muted)", margin: "0 0 12px", lineHeight: 1.5 }}>Pick one or many for <b style={{ color: "var(--text)" }}>{owner.name}</b> — a restaurant can have several owners.</p>
        <div style={{ position: "relative", marginBottom: 12 }}>
          <i className="fas fa-magnifying-glass" aria-hidden="true" style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "var(--muted)", fontSize: 13 }} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search restaurants…" aria-label="Search restaurants" autoComplete="off" autoFocus
            style={{ ...field, padding: "13px 14px 13px 38px", fontSize: 14.5 }} />
        </div>
      </div>
      <div style={{ padding: "0 20px", overflow: "auto", flex: 1, minHeight: 0 }}>
        <div style={{ border: "var(--border)", borderRadius: 12, overflow: "hidden" }}>
          {avail.length === 0 ? (
            <div style={{ padding: 24, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
              {attachable.length === 0 ? "They already own every restaurant." : <><i className="fas fa-magnifying-glass" style={{ opacity: .4, fontSize: 20 }} aria-hidden="true" /><div style={{ marginTop: 8 }}>No restaurant matches “{q}”.</div></>}
            </div>
          ) : (
            <>
              {needs.length > 0 && <div style={ghead(`Needs an owner · ${needs.length}`, "#fbbf24")}>Needs an owner · {needs.length}</div>}
              {needs.map(Row)}
              {have.length > 0 && <div style={ghead(`Already has owners · ${have.length}`)}>Already has owners · {have.length}</div>}
              {have.map(Row)}
            </>
          )}
        </div>
      </div>
      <div style={{ display: "flex", gap: 9, alignItems: "center", padding: "16px 20px 20px" }}>
        <span style={{ fontSize: 12, color: "var(--muted)", marginRight: "auto" }}>{n ? `${n} selected` : "Nothing selected"}</span>
        <button style={ghostBtn} onClick={onClose}>Cancel</button>
        <button style={{ ...ctaBtn("blue"), opacity: n && !busy ? 1 : 0.4, cursor: n && !busy ? "pointer" : "not-allowed" }} disabled={!n || busy} onClick={() => onAssign(Array.from(picked))}>
          <i className="fas fa-check" aria-hidden="true" />{n ? `Assign ${n} restaurant${n > 1 ? "s" : ""}` : "Assign"}</button>
      </div>
    </ModalShell>
  );
}

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
  const [showAssign, setShowAssign] = useState(false);
  const [showRename, setShowRename] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmCfg | null>(null);
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

  // Attach one or many restaurants in a single action (the big picker is multi-select).
  const assignRestaurants = (ids: string[]) => {
    setShowAssign(false);
    if (!ids.length) return;
    run(async () => { for (const rid of ids) await patch({ owner_id: owner.id, action: "attach", restaurant_id: rid }); });
  };
  // Remove-restaurant → the shared confirm dialog (was a native confirm()).
  const detachRestaurant = (r: OwnedRest) => setConfirm({
    tone: "danger", icon: "fa-link-slash", ctaLabel: "Remove restaurant", ctaTone: "danger",
    title: `Remove ${r.name}?`, sub: `${owner.name} stops seeing this restaurant’s numbers immediately.`,
    chip: <RestChip r={r} />,
    facts: [
      { i: "fa-eye-slash", c: "#f87171", t: "They immediately lose access to its numbers" },
      { i: "fa-store", t: <>The restaurant keeps running — only <b>this owner link</b> is removed</> },
      { i: "fa-user-group", t: "Other owners (if any) keep their access" },
    ],
    onYes: () => run(async () => { await patch({ owner_id: owner.id, action: "detach", restaurant_id: r.id }); }),
  });

  // Delete → moves the owner to the RECYCLE BIN (the server soft-deletes now, mig
  // 208). The modal's type-to-confirm gate already guards it, so this just runs it.
  async function doDelete() {
    setShowDelete(false);
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

      <div style={{ padding: 18, display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 16 }}>
        {mErr ? <div style={{ ...card, padding: 12, borderColor: "#7f1d1d", color: "#fca5a5" }}>{mErr}</div> : null}

        {/* Actions */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button style={actBtn} disabled={busy} onClick={() => setShowRename(true)}><i className="fas fa-pen" style={ic} aria-hidden="true" />Rename</button>
          <button style={actBtn} disabled={busy}
            onClick={() => setConfirm({
              tone: "blue", icon: "fa-key", ctaLabel: "Reset password", ctaTone: "blue",
              title: `Reset ${owner.name}’s password?`, sub: "A new one-time password is generated and shown once.",
              ownerChip: true,
              facts: [
                { i: "fa-key", c: "#60a5fa", t: <>A <b>new password</b> is shown once — copy it right then</> },
                { i: "fa-right-from-bracket", c: "#fbbf24", t: "They’re logged out everywhere" },
              ],
              onYes: () => run(async () => { const j = await patch({ owner_id: owner.id, action: "reset_password" }); setPwReveal(j.password); }),
            })}><i className="fas fa-key" style={ic} aria-hidden="true" />Reset password</button>
          {/* Visit: jump straight into THIS owner's panel from here (owner ask 2026-07-26) —
              starts on their primary restaurant; multi-restaurant owners can switch inside.
              Same act-as link as the per-restaurant "Open panel" (no password, invisible). */}
          {owner.restaurants.length > 0 && (() => {
            const home = owner.restaurants.find((r) => r.primary) || owner.restaurants[0];
            return (
              <a style={{ ...actBtn, textDecoration: "none", color: "#60a5fa" }}
                title={`Open ${owner.name}'s owner panel${owner.restaurants.length > 1 ? ` (opens on ${home.name})` : ""} — no password, invisible to them`}
                href={panelHref(home.id, owner.id)} target="_blank" rel="noreferrer">
                <i className="fas fa-eye" style={ic} aria-hidden="true" />Visit panel</a>
            );
          })()}
          <button style={{ ...actBtn, color: owner.active ? "#fca5a5" : "#86efac" }} disabled={busy}
            onClick={() => setConfirm(owner.active ? {
              tone: "danger", icon: "fa-ban", ctaLabel: "Suspend owner", ctaTone: "danger",
              title: `Suspend ${owner.name}?`, sub: "Reversible — you can restore them any time.", ownerChip: true,
              facts: [
                { i: "fa-right-from-bracket", c: "#f87171", t: <><b>Logged out</b> everywhere at once</> },
                { i: "fa-lock", c: "#fbbf24", t: "Can’t sign in until you restore" },
                { i: "fa-store", t: "Their restaurants keep running normally" },
              ],
              onYes: () => run(async () => { await patch({ owner_id: owner.id, action: "set_active", active: false }); }),
            } : {
              tone: "ok", icon: "fa-rotate-left", ctaLabel: "Restore access", ctaTone: "ok",
              title: `Restore ${owner.name}’s access?`, sub: "They can sign in again right away.", ownerChip: true,
              facts: [
                { i: "fa-right-to-bracket", c: "#34d399", t: <>Can <b>log in</b> again immediately</> },
                { i: "fa-store", c: "#60a5fa", t: "Sees their restaurants’ numbers again" },
                { i: "fa-clock-rotate-left", t: "Nothing was lost while suspended" },
              ],
              onYes: () => run(async () => { await patch({ owner_id: owner.id, action: "set_active", active: true }); }),
            })}>
            <i className={`fas ${owner.active ? "fa-ban" : "fa-rotate-left"}`} style={ic} aria-hidden="true" />{owner.active ? "Suspend" : "Restore"}</button>
        </div>

        {/* One-time reset password */}
        {pwReveal ? (
          <div style={{ ...card, padding: 12, borderColor: "#166534", background: "rgba(22,101,52,.08)" }}>
            <div style={{ fontSize: 12.5, color: "#86efac" }}>New password for <b>{owner.name}</b> — copy it now, it won&apos;t be shown again:</div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
              <code style={{ fontSize: 17, background: "var(--bg)", padding: "8px 12px", borderRadius: 8, letterSpacing: 1 }}>{pwReveal}</code>
              <CopyButton style={btn("#3b82f6")} text={pwReveal} />
              <button style={btn("#374151")} onClick={() => setPwReveal(null)}>Done</button>
            </div>
          </div>
        ) : null}

        {/* Restaurants owned */}
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <div style={{ fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--muted)", flex: 1 }}>Owns {owner.restaurants.length} restaurant{owner.restaurants.length === 1 ? "" : "s"}</div>
            <button style={{ ...chip, borderStyle: "dashed", color: "#60a5fa", cursor: "pointer", background: "transparent", padding: "7px 11px" }} disabled={busy}
              onClick={() => setShowAssign(true)}>
              <i className="fas fa-plus" style={{ fontSize: 10 }} aria-hidden="true" />Assign restaurant</button>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 8 }}>
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
              To delete this owner, <b>suspend them first</b> (the reversible step). Deleting then moves them to the <b>Recycle bin</b> — restorable for 90 days.
            </div>
          ) : (
            <>
              <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>
                This owner is suspended. Deleting moves them to the <b>Recycle bin</b>, where they can be <b>restored for 90 days</b>; nothing is erased yet and their restaurants stay linked. Only after 90 days can they be permanently removed.
              </div>
              <button style={btn("#991b1b")} disabled={busy} onClick={() => setShowDelete(true)}><i className="fas fa-trash-can" style={{ marginRight: 6, fontSize: 11 }} aria-hidden="true" />Move to recycle bin</button>
            </>
          )}
        </div>
      </div>

      {/* ── Dialogs (replace the old native confirm()/prompt() boxes) ── */}
      {confirm && (
        <ConfirmModal cfg={confirm} owner={owner}
          onClose={() => setConfirm(null)}
          onConfirm={() => { const y = confirm.onYes; setConfirm(null); y(); }} />
      )}
      {showRename && (
        <RenameModal owner={owner} busy={busy} onClose={() => setShowRename(false)}
          onSave={(name) => { setShowRename(false); run(async () => { await patch({ owner_id: owner.id, action: "rename", name }); }); }} />
      )}
      {showAssign && (
        <AssignRestaurantModal owner={owner} attachable={attachable} busy={busy}
          onClose={() => setShowAssign(false)} onAssign={assignRestaurants} />
      )}
      {showDelete && (
        <DeleteForeverModal owner={owner} busy={busy} onClose={() => setShowDelete(false)} onConfirm={doDelete} />
      )}

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
              <CopyButton style={btn("#3b82f6")} text={reveal.password} />
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
