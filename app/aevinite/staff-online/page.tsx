"use client";
// /aevinite/staff-online — everyone signed in and active RIGHT NOW, across every
// restaurant (owner 2026-07-08: reached by clicking "Staff online now" on the
// dashboard). First view = ALL restaurants; a restaurant picker + role chips narrow
// it (same filter feel as the Users screen). Each person is a glowing "live" card —
// bright pulse = seen in the last minute, steadier glow = seen in the last few. Data
// comes from the tiny /api/admin/staff-online call (one scoped query — cheap to open).
// It loads once on open and only updates on Refresh (no auto-poll, shown as a hint).
import { useCallback, useEffect, useRef, useState } from "react";

type Staff = {
  id: string; name: string | null; username: string; role: string;
  restaurant_id: string | null; restaurantName: string | null; last_seen_at: string | null;
};

const ROLES = ["manager", "kitchen", "tablet", "owner"] as const;
const ROLE_LABEL: Record<string, string> = { manager: "Manager", kitchen: "Kitchen", tablet: "Tablet", owner: "Owner" };
const ROLE_COLOR: Record<string, string> = { manager: "#d4a574", kitchen: "#7ec88a", tablet: "#60a5fa", owner: "#f5c451" };
const ROLE_ORDER: Record<string, number> = { owner: 0, manager: 1, kitchen: 2, tablet: 3 };

const field: React.CSSProperties = { boxSizing: "border-box", padding: "10px 12px", borderRadius: 10, border: "var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 14 };
// The ink has to follow the FILL. When no colour is passed the active pill falls back to
// `var(--text)` as its background — which in this dark console is a near-white (#e6ebf3) — while
// the ink was hard-coded #fff. That is white on white: the "All" chip measured 1.2:1, the worst
// reading anywhere in the app (T11 re-run, 2026-08-05). A caller-supplied colour keeps white ink;
// the --text fallback now takes --bg as its ink, which is the same swap the pill already implies.
const chip = (on: boolean, color?: string): React.CSSProperties => ({
  padding: "7px 14px", borderRadius: 999, border: on ? "1px solid transparent" : "var(--border)",
  background: on ? (color || "var(--text)") : "var(--bg)",
  color: on ? (color ? "#fff" : "var(--bg)") : "var(--text)",
  fontWeight: 600, fontSize: 12.5, cursor: "pointer", minHeight: 34, lineHeight: 1,
});

function agoLabel(iso: string | null): string {
  if (!iso) return "—";
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  return s < 15 ? "just now" : s < 60 ? `${s}s ago` : s < 3600 ? `${Math.floor(s / 60)}m ago` : `${Math.floor(s / 3600)}h ago`;
}

export default function AdminStaffOnline() {
  const [staff, setStaff] = useState<Staff[] | null>(null);
  const [restaurants, setRestaurants] = useState<{ id: string; name: string }[]>([]);
  const [err, setErr] = useState("");
  const [fetching, setFetching] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const seq = useRef(0); // latest-wins guard

  // Filters (client-side over the small online list — no extra reads).
  const [filterRid, setFilterRid] = useState("");
  const [filterRoles, setFilterRoles] = useState<string[]>([]);
  const [search, setSearch] = useState("");

  const load = useCallback(() => {
    const my = ++seq.current;
    setFetching(true);
    fetch("/api/admin/staff-online", { cache: "no-store" }).then((r) => r.json()).then((j) => {
      if (my !== seq.current) return;
      setFetching(false);
      if (j.error) { setErr(j.error); return; }
      setErr("");
      setStaff(j.staff || []);
      const rl = (j.restaurants || []) as { id: string; name: string }[];
      setRestaurants(rl);
      // ── THE PICKER MUST NEVER SAY "ALL" WHILE A FILTER IS STILL ON (item 3, sweep #8 T21) ──────
      // This list only carries the restaurants that have SOMEBODY online right now (the route says
      // so in its own words), so it changes on every Refresh — a restaurant whose last person signs
      // out simply leaves it. The chosen id was kept anyway, and a <select> whose value matches no
      // option falls back to showing its FIRST one. So the screen read:
      //
      //     picker: "All restaurants"      count: "0 of 2 online"      "No online staff match these filters."
      //
      // …with two people genuinely online. The control said one thing, the list obeyed another, and
      // the only clue was a "Clear filters" button the admin had no reason to press. Measured
      // headless: pick a restaurant, refresh onto a roster from a different one, read the picker.
      // A filter that no longer names anything is dropped, so the picker and the list agree again.
      setFilterRid((cur) => (cur && !rl.some((r) => r.id === cur) ? "" : cur));
      setUpdatedAt(Date.now());
    }).catch((e) => {
      if (my !== seq.current) return;
      setFetching(false);
      setErr(e instanceof Error ? e.message : String(e));
    });
  }, []);
  useEffect(() => { load(); }, [load]);

  // Re-tick the "Xs ago" labels every 15s (display only — no fetch).
  const [, force] = useState(0);
  useEffect(() => { const id = setInterval(() => force((n) => n + 1), 15000); return () => clearInterval(id); }, []);

  const toggleRole = (r: string) =>
    setFilterRoles((prev) => (prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r]));

  const q = search.trim().toLowerCase();
  const all = staff || [];
  const visible = all.filter((u) =>
    (!filterRid || u.restaurant_id === filterRid) &&
    (filterRoles.length === 0 || filterRoles.includes(u.role)) &&
    (!q ||
      (u.name || u.username).toLowerCase().includes(q) ||
      (ROLE_LABEL[u.role] || u.role).toLowerCase().includes(q) ||
      (u.restaurantName || "").toLowerCase().includes(q))
  ).sort((a, b) =>
    (a.restaurantName || "~").localeCompare(b.restaurantName || "~") ||
    (ROLE_ORDER[a.role] ?? 9) - (ROLE_ORDER[b.role] ?? 9) ||
    (a.name || a.username).localeCompare(b.name || b.username)
  );
  const filtered = filterRid !== "" || filterRoles.length > 0 || q !== "";

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <h1 className="adm-page-h" style={{ marginBottom: 0 }}>Staff online</h1>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span className="so-snap" title="This page does not update on its own — press Refresh for a fresh snapshot">
            <i className="fas fa-hand-pointer" aria-hidden="true" /> Manual — press Refresh
            {updatedAt !== null && !fetching ? <> · updated {agoLabel(new Date(updatedAt).toISOString())}</> : null}
          </span>
          <button className="adm-btn" onClick={load} disabled={fetching}>
            <i className={`fas fa-rotate-right${fetching ? " fa-spin" : ""}`} style={{ marginRight: 7 }} aria-hidden="true" />Refresh
          </button>
        </div>
      </div>
      <p className="adm-page-sub">Everyone signed in and active in the last few minutes, across every restaurant. A bright pulse means they were active in the last minute.</p>

      {/* Filters: pick a restaurant, narrow by role (combinable), or search. */}
      <div className="adm-card" style={{ marginBottom: 14 }}>
        <div style={{ display: "grid", gap: 10 }}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <select value={filterRid} onChange={(e) => setFilterRid(e.target.value)} style={{ ...field, minWidth: 190 }}>
              <option value="">All restaurants</option>
              {restaurants.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
            <span style={{ position: "relative", flex: "1 1 180px", maxWidth: 320, minWidth: 180 }}>
              <i className="fas fa-magnifying-glass" aria-hidden="true" style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--muted)", fontSize: 13 }} />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, role or restaurant…" aria-label="Search online staff" style={{ ...field, paddingLeft: 34, width: "100%" }} />
            </span>
            {filtered ? <button type="button" onClick={() => { setFilterRid(""); setFilterRoles([]); setSearch(""); }} style={{ ...chip(false), color: "var(--muted)" }}>Clear filters</button> : null}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>Role:</span>
            <button type="button" onClick={() => setFilterRoles([])} style={chip(filterRoles.length === 0)}>All</button>
            {ROLES.map((r) => (
              <button key={r} type="button" onClick={() => toggleRole(r)} style={chip(filterRoles.includes(r), ROLE_COLOR[r])}>{ROLE_LABEL[r]}</button>
            ))}
          </div>
        </div>
      </div>

      <div className="cmd-sec" style={{ marginBottom: 10 }}>
        {staff === null ? "Loading…" : filtered ? `${visible.length} of ${all.length} online` : `${all.length} online`}
      </div>

      {err ? (
        <div className="adm-card" style={{ borderColor: "var(--adm-danger)", color: "var(--adm-danger)" }}>Couldn&apos;t load: {err} <button className="adm-btn" style={{ marginLeft: 8 }} onClick={load}>Retry</button></div>
      ) : staff === null ? (
        <div className="so-grid">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="so-card"><div className="adm-skel" style={{ width: 46, height: 46, borderRadius: 999 }} /><div style={{ flex: 1 }}><div className="adm-skel" style={{ width: "70%", height: 13, marginBottom: 8 }} /><div className="adm-skel" style={{ width: "45%", height: 11 }} /></div></div>
          ))}
        </div>
      ) : all.length === 0 ? (
        <div className="adm-empty">No staff are online right now.</div>
      ) : visible.length === 0 ? (
        <div className="adm-empty">No online staff match these filters.</div>
      ) : (
        <div className="so-grid">
          {visible.map((u) => {
            const secs = u.last_seen_at ? Math.floor((Date.now() - new Date(u.last_seen_at).getTime()) / 1000) : 999;
            const hot = secs < 60; // active in the last minute → bright pulse
            const color = ROLE_COLOR[u.role] || "#9ca3af";
            return (
              <div key={u.id} className={`so-card${hot ? " hot" : ""}`}>
                <div className="so-avatar" style={{ background: color }}>
                  {(u.name || u.username).charAt(0).toUpperCase()}
                  <span className={`so-dot${hot ? " hot" : ""}`} aria-hidden="true" />
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="so-name">{u.name || u.username}</div>
                  <div className="so-meta">
                    <span className="so-role" style={{ ["--hue" as string]: color, borderColor: color }}>{ROLE_LABEL[u.role] || u.role}</span>
                    <span className="so-rest">{u.restaurantName || "—"}</span>
                  </div>
                  <div className={`so-status${hot ? " hot" : ""}`}>
                    <span className="d" aria-hidden="true" />{hot ? "Active now" : "Online"} · seen {agoLabel(u.last_seen_at)}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <style href="adm-staff-online" precedence="default">{`
        /* A NOTE, NOT A WARNING (T17 sweep, 2026-08-19). This pill says "this page doesn't update
           on its own" — which is deliberate and correct, not a fault. It was drawn in the console's
           WARNING colour, so an amber badge sat on this screen on every single load, for ever. A
           bar that is always up is how the admin learns to stop reading amber. It now looks like
           what it is: a quiet piece of information next to the button it points at. */
        .so-snap { display: inline-flex; align-items: center; gap: 6px; font-size: 11.5px; font-weight: 600; padding: 4px 10px; border-radius: 999px; color: var(--muted); background: color-mix(in srgb, var(--text) 7%, transparent); white-space: nowrap; }
        .so-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 12px; }
        .so-card { display: flex; align-items: center; gap: 14px; padding: 14px; border-radius: 14px; background: var(--card); border: var(--border); position: relative; overflow: hidden; transition: transform .14s ease, box-shadow .14s ease; }
        .so-card:hover { transform: translateY(-2px); box-shadow: 0 8px 24px rgba(0,0,0,.18); }
        .so-card.hot { border-color: color-mix(in srgb, #22c55e 45%, transparent); }
        .so-card.hot::before { content: ""; position: absolute; inset: 0 auto 0 0; width: 3px; background: linear-gradient(#22c55e, #16a34a); }
        .so-avatar { position: relative; width: 46px; height: 46px; border-radius: 999px; display: grid; place-items: center; font-weight: 800; font-size: 19px; color: #101418; flex-shrink: 0; }
        .so-dot { position: absolute; right: -1px; bottom: -1px; width: 14px; height: 14px; border-radius: 999px; background: #22c55e; border: 2.5px solid var(--card); }
        .so-dot.hot { animation: soPulse 1.6s ease-out infinite; }
        @keyframes soPulse { 0% { box-shadow: 0 0 0 0 rgba(34,197,94,.55); } 70% { box-shadow: 0 0 0 7px rgba(34,197,94,0); } 100% { box-shadow: 0 0 0 0 rgba(34,197,94,0); } }
        .so-name { font-size: 15px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .so-meta { display: flex; align-items: center; gap: 8px; margin-top: 4px; min-width: 0; }
        .so-role { font-size: 10.5px; font-weight: 800; text-transform: uppercase; letter-spacing: .03em; padding: 1px 8px; border-radius: 999px; border: 1px solid; }
        .so-rest { font-size: 12px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .so-status { display: flex; align-items: center; gap: 6px; margin-top: 6px; font-size: 11.5px; color: var(--muted); }
        .so-status .d { width: 7px; height: 7px; border-radius: 999px; background: #22c55e; flex-shrink: 0; }
        .so-status.hot { color: #16a34a; font-weight: 600; }
        .cmd-sec { display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; color: var(--text); }
      `}</style>
    </>
  );
}
