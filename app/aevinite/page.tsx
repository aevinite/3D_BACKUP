"use client";
// Admin · Command — the restaurant-centric home of the ops console (redesign
// 2026-07-04). Purpose: reach ANY restaurant and its panels in one click.
//   1. Compact stat strip (counts only — NO food/earnings revenue in the admin panel; the
//      only money shown anywhere is platform SUBSCRIPTION income on Billing/Revenue).
//   2. The restaurant command table: one dense row per restaurant with panel
//      chips (M K T O), quick-open buttons (act-as +
//      new tab) and a Manage → link.
//   3. Working now (active staff) + Latest activity.
// Data: the SAME existing admin endpoints as before (one fetch each, no per-row
// fetches), refreshed by useActiveAutoRefresh (60s, only while visible & in use).
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { openRestaurantPanel, useActiveAutoRefresh, ActivityFeed, timeAgo, type Action } from "@/components/admin/shared";
import { useToast } from "@/components/admin/toast";
import { useAdminModal } from "@/components/admin/useAdminModal";

type RestOwner = { id: string; name: string; primary: boolean };
type Rest = {
  id: string; slug: string; name: string; active: boolean;
  ownerUserId: string | null; ownerName: string | null;
  owners: RestOwner[];
  panels: Record<string, boolean> | null;
};
type Issue = { id: string; restaurantName: string; subject: string; status: string; created_at: string };
type Staff = { name: string | null; username: string; role: string; restaurantName: string | null; last_seen_at: string | null };

// The four operational panels, in chip order. A panel is ON unless explicitly false.
const PANEL_DEFS: { key: string; letter: string; label: string; path: string }[] = [
  { key: "manager", letter: "M", label: "Manager", path: "/editor" },
  { key: "kitchen", letter: "K", label: "Kitchen", path: "/kitchen" },
  { key: "tablet", letter: "T", label: "Tablet", path: "/tablet" },
  { key: "owner", letter: "O", label: "Owner", path: "/owner" },
];
const panelOn = (r: Rest, key: string) => !r.panels || r.panels[key] !== false;

export default function AdminCommand() {
  const toast = useToast();
  const [rests, setRests] = useState<Rest[] | null>(null);
  const [ordersToday, setOrdersToday] = useState<number | null>(null);
  const [maintenance, setMaintenance] = useState(false);
  const [maintenanceNames, setMaintenanceNames] = useState<string[]>([]);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [online, setOnline] = useState<Staff[]>([]);
  const [onlineCount, setOnlineCount] = useState<number | null>(null);
  const [openIssuesCount, setOpenIssuesCount] = useState<number | null>(null);
  const [activity, setActivity] = useState<Action[]>([]);
  const [q, setQ] = useState("");
  const [busyRow, setBusyRow] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // Load-error flag so a backend hiccup shows a Retry instead of leaving the home screen
  // stuck on "Loading…" forever (audit 2026-07-07).
  const [loadErr, setLoadErr] = useState(false);
  // Red "Fix problems" button: 24h app errors + unsolved reported problems (owner 2026-07-22).
  const [fixCount, setFixCount] = useState(0);
  // "Which owner?" chooser: set to a restaurant when its Owner button is clicked AND it
  // has 2+ owners — otherwise the panel opens straight to the sole/primary owner (owner 2026-07-25).
  const [chooser, setChooser] = useState<Rest | null>(null);

  const load = useCallback(() => {
    // ONE combined call instead of six separate ones (egress: fewer round-trips on the 60s
    // refresh, and it returns only the CURRENTLY-online staff + counts instead of hauling the
    // whole staff/order/session tables to the client — improvement 2026-07-07).
    fetch("/api/admin/dashboard", { cache: "no-store" }).then((r) => r.json()).then((j) => {
      if (j.error) { setLoadErr(true); return; }
      setLoadErr(false);
      setRests(j.restaurants || []);
      setMaintenance(!!j.maintenance);
      setMaintenanceNames(Array.isArray(j.maintenanceNames) ? j.maintenanceNames : []);
      setOrdersToday(Number(j.ordersToday) || 0);
      setIssues(j.issues || []);
      setOpenIssuesCount(typeof j.openIssuesCount === "number" ? j.openIssuesCount : null);
      setOnline(j.online || []);
      setOnlineCount(typeof j.onlineCount === "number" ? j.onlineCount : null);
      setActivity(j.activity || []);
      setFixCount((Number(j.errorCount24h) || 0) + (Number(j.openFixRequests) || 0));
    }).catch(() => setLoadErr(true));
  }, []);
  useEffect(() => { load(); }, [load]);
  useActiveAutoRefresh(load, 60000);
  const [refreshing, setRefreshing] = useState(false);
  const manualRefresh = () => { setRefreshing(true); load(); setTimeout(() => setRefreshing(false), 600); };

  const openIssues = useMemo(() => issues.filter((i) => i.status === "open"), [issues]);
  // `online` now arrives already filtered to currently-online staff from the combined endpoint.
  const PANEL_NAME = (role: string) => (({ owner: "Owner", manager: "Manager", kitchen: "Kitchen", tablet: "Tablet" } as Record<string, string>)[role] || role);

  const needle = q.trim().toLowerCase();
  const rows = (rests || []).filter((r) => !needle || r.name.toLowerCase().includes(needle) || r.slug.toLowerCase().includes(needle));
  const activeCount = (rests || []).filter((r) => r.active).length;

  const openPanel = async (r: Rest, path: string) => {
    setBusyRow(r.id); setErr(null);
    try {
      // A BLOCKED POP-UP MUST NOT VANISH IN SILENCE (T20 sweep, 2026-08-16). This threw the window
      // handle away, so with pop-ups blocked — Safari's default in some setups — pressing Manager
      // did nothing at all: no tab, no message. openRestaurantPanel returns null for exactly this
      // reason ("so callers can tell the admin instead of falsely claiming 'now viewing'"), and
      // both sibling call sites (the owner chooser below, the Restaurants detail page) already
      // checked it. This was the one that didn't.
      const w = await openRestaurantPanel(r.id, path);
      if (!w) {
        const m = "Your browser blocked the new tab — allow pop-ups for this site, then try again.";
        setErr(m); toast(m, "err");
      }
    }
    catch (e) { const m = e instanceof Error ? e.message : String(e); setErr(m); toast(m, "err"); }
    finally { setBusyRow(null); }
  };

  // Every stat now drills into its own detail page (owner 2026-07-08: "everything
  // should be clickable"). A card with a `href` becomes a link with a → affordance.
  const STATS: { k: string; v: string | number; href?: string; warn?: boolean }[] = [
    { k: "Restaurants", v: rests === null ? "…" : `${activeCount} active / ${rests.length}`, href: "/aevinite/restaurants" },
    // "Staff-raised issues", not "Open issues" (T11 desktop sweep, 2026-08-05). This card read
    // "OPEN ISSUES · 0" while the button 300px to its right read "Fix problems · 7" and the bell
    // badge also said 7 — two counters with near-identical names giving opposite answers, with
    // nothing on the screen saying they count different things. They genuinely do: THIS is only
    // what a member of staff reported (the System health page already calls it exactly that),
    // while fixCount is app errors in the last 24h PLUS unsolved reports. Naming them apart is
    // the fix; making them agree would be a lie.
    { k: "Staff-raised issues", v: openIssuesCount ?? openIssues.length, href: "/aevinite/repair#complaints", warn: (openIssuesCount ?? openIssues.length) > 0 },
    { k: "Staff online now", v: onlineCount ?? online.length, href: "/aevinite/staff-online" },
    { k: "Orders today", v: ordersToday ?? "…", href: "/aevinite/analytics?range=today" },
  ];

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <h1 className="adm-page-h" style={{ marginBottom: 0 }}>Dashboard</h1>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {/* Loud red when something needs solving; quiet grey door to the same page otherwise.
              --adm-danger (#f87171) is a light red tuned for borders and dots; white text on it
              measured 2.31:1 — the least readable label in the console, on its most urgent button.
              Darkened here only (the token keeps its value everywhere else) so white sits at
              ~5.7:1 and it still reads as a danger button, not a warning chip. */}
          <Link href="/aevinite/repair" className={`adm-btn${fixCount > 0 ? " danger" : ""}`}
            style={fixCount > 0 ? { background: "color-mix(in srgb, var(--adm-danger) 72%, #000)", borderColor: "color-mix(in srgb, var(--adm-danger) 72%, #000)", color: "#fff", fontWeight: 700, boxShadow: "0 0 0 3px color-mix(in srgb, var(--adm-danger) 25%, transparent)" } : undefined}
            title={fixCount > 0 ? `${fixCount} to fix — app errors from the last 24h plus problems staff reported and nobody has solved. Separate from the "Staff-raised issues" count, which is only the reports.` : "Repair page — report a problem or use the repair tools"}>
            <i className={`fas ${fixCount > 0 ? "fa-triangle-exclamation" : "fa-screwdriver-wrench"}`} style={{ marginRight: 7 }} aria-hidden="true" />
            {fixCount > 0 ? `Fix problems · ${fixCount}` : "Repair"}
          </Link>
          <button className="adm-btn" onClick={manualRefresh} disabled={refreshing} title="Refresh now (auto-updates are throttled to save load)">
            <i className={`fas fa-rotate-right${refreshing ? " fa-spin" : ""}`} style={{ marginRight: 7 }} aria-hidden="true" />Refresh
          </button>
        </div>
      </div>
      <p className="adm-page-sub">Every restaurant on the platform — open any panel, no password.</p>

      {maintenance && (
        <div className="adm-card" style={{ borderColor: "var(--adm-danger)", marginBottom: 12, display: "flex", alignItems: "center", gap: 12 }}>
          <i className="fas fa-triangle-exclamation" style={{ color: "var(--adm-danger)", fontSize: 15 }} aria-hidden="true" />
          <div style={{ flex: 1, fontSize: 13 }}>
            <b>{maintenanceNames.length === 1 ? "1 guest menu is in maintenance" : `${maintenanceNames.length} guest menus are in maintenance`}.</b>
            {maintenanceNames.length > 0 && <span className="adm-muted"> — {maintenanceNames.join(", ")}</span>}
          </div>
          <Link href="/aevinite/restaurants" className="adm-btn">Manage</Link>
        </div>
      )}

      {/* 1 · Compact stat strip — each cell drills into its detail page. */}
      <div className="cmd-strip adm-card" role="list">
        {STATS.map((s) => {
          const inner = (
            <>
              <span className="k">{s.k}</span>
              <span className={`v${s.warn ? " warn" : ""}`}>{s.v}</span>
            </>
          );
          return s.href ? (
            <Link key={s.k} href={s.href} className="cell cell-link" role="listitem" title={`Open ${s.k.toLowerCase()}`}>
              {inner}
              <i className="fas fa-arrow-right cell-go" aria-hidden="true" />
            </Link>
          ) : (
            <div key={s.k} className="cell" role="listitem">{inner}</div>
          );
        })}
      </div>

      {/* 2 · Restaurant command table — the heart of the page. */}
      <div className="adm-card" style={{ marginBottom: 12, padding: 0, overflow: "hidden" }}>
        <div className="cmd-tools">
          <i className="fas fa-magnifying-glass" style={{ color: "var(--muted)", fontSize: 12 }} aria-hidden="true" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search restaurants by name or slug…" aria-label="Search restaurants" />
          <span style={{ color: "var(--muted)", fontSize: 12, whiteSpace: "nowrap" }}>{rows.length} of {rests?.length ?? 0}</span>
        </div>
        {err && <div style={{ padding: "8px 14px", color: "var(--adm-danger)", fontSize: 12.5, borderBottom: "var(--border)" }}>{err}</div>}
        <div className="cmd-row head">
          <span>Restaurant</span><span>Status</span><span>Panels</span><span>Quick open</span><span />
        </div>
        {rests === null ? (
          loadErr ? (
            <div className="adm-empty">Couldn&rsquo;t load restaurants. <button className="adm-btn" style={{ marginLeft: 8 }} onClick={() => { setLoadErr(false); load(); }}>Retry</button></div>
          ) : (
            <div className="adm-empty">Loading restaurants…</div>
          )
        ) : rows.length === 0 ? (
          <div className="adm-empty">No restaurants match &ldquo;{q}&rdquo;.</div>
        ) : (
          rows.map((r) => (
            <div key={r.id} className="cmd-row">
              <span style={{ minWidth: 0 }}>
                <span className="nm">{r.name}</span>
                <span className="sl">{r.slug}</span>
              </span>
              <span>
                <span className={`cmd-pill ${r.active ? "on" : "off"}`}>{r.active ? "Active" : "Suspended"}</span>
              </span>
              <span className="cmd-chips" title={PANEL_DEFS.map((p) => `${p.label}: ${panelOn(r, p.key) ? "on" : "off"}`).join(" · ")}>
                {PANEL_DEFS.map((p) => (
                  <span key={p.key} className={`cmd-pchip${panelOn(r, p.key) ? " on" : ""}`} aria-label={`${p.label} panel ${panelOn(r, p.key) ? "enabled" : "off"}`}>{p.letter}</span>
                ))}
              </span>
              <span className="cmd-open">
                {r.active ? (
                  <a className="cmd-obtn" href={`/r/${r.slug}/menu`} target="_blank" rel="noopener" title={`Open ${r.name}'s guest menu`}>Guest</a>
                ) : (
                  // Suspended → the guest menu is offline; show a disabled chip instead of a link
                  // to a maintenance page (matches the detail view's EnterCard guard, audit 2026-07-23).
                  <button className="cmd-obtn" disabled title={`${r.name}'s guest menu is offline while suspended`}>Guest</button>
                )}
                {PANEL_DEFS.map((p) => {
                  const multiOwner = p.key === "owner" && r.owners.length >= 2;
                  return (
                    <button key={p.key} className="cmd-obtn" disabled={!panelOn(r, p.key) || busyRow === r.id}
                      onClick={() => { if (multiOwner) setChooser(r); else openPanel(r, p.path); }}
                      title={panelOn(r, p.key)
                        ? (multiOwner ? `${r.name} has ${r.owners.length} owners — choose whose panel to open` : `Open ${p.label} as ${r.name} (new tab, no password)`)
                        : `${p.label} panel is off for this restaurant`}>
                      {p.label}{multiOwner ? ` (${r.owners.length})` : ""}
                    </button>
                  );
                })}
              </span>
              <span style={{ textAlign: "right" }}>
                <Link className="cmd-manage" href={`/aevinite/restaurants?focus=${encodeURIComponent(r.slug)}`} title={`Manage ${r.name}`}>
                  Manage <i className="fas fa-arrow-right" style={{ fontSize: 10 }} aria-hidden="true" />
                </Link>
              </span>
            </div>
          ))
        )}
      </div>

      {/* 3 · Working now + latest activity. */}
      <div className="cmd-grid2">
        <div className="adm-card">
          <div className="cmd-sec">
            Working now <span>· {online.length} active</span>
            <Link href="/aevinite/staff-online" style={{ marginLeft: "auto", fontSize: 12, color: "var(--accent)", fontWeight: 600, textDecoration: "none" }}>View all →</Link>
          </div>
          {online.length === 0 ? (
            <div style={{ color: "var(--muted)", fontSize: 13, padding: "6px 0" }}>No staff active right now.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column" }}>
              {online.map((u) => (
                <div key={`${u.username}-${u.role}`} className="cmd-staff">
                  <span className="dot" aria-hidden="true" />
                  <b>{u.name || u.username}</b>
                  <span style={{ color: "var(--accent)", fontWeight: 600, fontSize: 12 }}>{PANEL_NAME(u.role)}</span>
                  <span style={{ color: "var(--muted)", fontSize: 12, marginLeft: "auto", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u.restaurantName || "—"}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="adm-card">
          <div className="cmd-sec">
            Latest activity <span>· all restaurants</span>
            <Link href="/aevinite/logs" style={{ marginLeft: "auto", fontSize: 12, color: "var(--accent)", fontWeight: 600, textDecoration: "none" }}>View all →</Link>
          </div>
          <ActivityFeed rows={activity} />
        </div>
      </div>

      {/* Open issues — quiet row under the grid; loud only when something IS open. */}
      <div className="adm-card" style={{ marginTop: 12 }}>
        <div className="cmd-sec">
          Open issues <span>· {openIssues.length} open</span>
          <Link href="/aevinite/repair#complaints" style={{ marginLeft: "auto", fontSize: 12, color: "var(--accent)", fontWeight: 600, textDecoration: "none" }}>Manage →</Link>
        </div>
        {openIssues.length === 0 ? (
          <div style={{ color: "var(--muted)", fontSize: 13, padding: "4px 0" }}>Nothing open right now.</div>
        ) : (
          openIssues.slice(0, 5).map((i) => (
            <div key={i.id} className="cmd-issue">
              <i className="fas fa-triangle-exclamation" style={{ color: "var(--adm-warn)", fontSize: 12 }} aria-hidden="true" />
              <b style={{ fontSize: 13 }}>{i.subject}</b>
              <span style={{ color: "var(--accent)", fontSize: 12, fontWeight: 600 }}>{i.restaurantName}</span>
              <span style={{ marginLeft: "auto", color: "var(--muted)", fontSize: 12, whiteSpace: "nowrap" }}>{timeAgo(i.created_at)}</span>
            </div>
          ))
        )}
      </div>

      {chooser && (
        <OwnerChooser rest={chooser} onClose={() => setChooser(null)}
          onPick={async (uid) => {
            setChooser(null);
            const w = await openRestaurantPanel(chooser.id, "/owner", uid);
            if (!w) toast("Popup blocked — allow popups to open the owner panel.", "err");
          }} />
      )}

      <style href="adm-dashboard" precedence="default">{`
        /* stat-strip styles live in globals.css now — its cells are <Link>s, which styled-jsx
           can't scope (the scoped rules never matched, so labels+values ran together). */
        /* command table */
        .cmd-tools { display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-bottom: var(--border); }
        .cmd-tools input { flex: 1; min-width: 0; background: transparent; border: 0; outline: none; color: var(--text); font-size: 13px; padding: 2px 0; }
        .cmd-row { display: grid; grid-template-columns: minmax(140px, 1.1fr) 84px 96px minmax(340px, 1.9fr) 78px; gap: 8px; align-items: center; padding: 0 14px; min-height: 40px; border-bottom: var(--border); font-size: 13px; }
        .cmd-row:last-child { border-bottom: 0; }
        .cmd-row.head { font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); font-weight: 700; min-height: 32px; background: var(--muted2); }
        .cmd-row .nm { display: block; font-size: 13.5px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .cmd-row .sl { display: block; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .cmd-pill { font-size: 10.5px; font-weight: 700; padding: 2px 8px; border-radius: 999px; text-transform: uppercase; letter-spacing: .03em; white-space: nowrap; }
        .cmd-pill.on { background: color-mix(in srgb, var(--adm-ok) 16%, transparent); color: var(--adm-ok); }
        .cmd-pill.off { background: color-mix(in srgb, var(--adm-danger) 14%, transparent); color: var(--adm-danger); }
        /* M K T O chips: filled = enabled, hollow = off */
        .cmd-chips { display: inline-flex; gap: 4px; }
        .cmd-pchip { width: 20px; height: 20px; border-radius: 5px; display: grid; place-items: center; font-size: 10px; font-weight: 700; border: 1px solid var(--border-c, #1d2430); color: var(--muted); }
        .cmd-pchip.on { background: color-mix(in srgb, var(--accent) 16%, transparent); border-color: color-mix(in srgb, var(--accent) 45%, transparent); color: var(--accent); }
        /* quick-open buttons */
        .cmd-open { display: inline-flex; gap: 5px; flex-wrap: wrap; padding: 6px 0; }
        .cmd-obtn { display: inline-flex; align-items: center; height: 24px; padding: 0 8px; border-radius: 6px; border: var(--border); background: transparent; color: var(--text); font-size: 11.5px; font-weight: 600; text-decoration: none; cursor: pointer; transition: background .15s ease, border-color .15s ease; white-space: nowrap; }
        .cmd-obtn:hover:not(:disabled) { background: var(--muted2); border-color: color-mix(in srgb, var(--accent) 40%, transparent); }
        .cmd-obtn:disabled { opacity: .32; cursor: default; }
        a.cmd-obtn { color: var(--accent); border-color: color-mix(in srgb, var(--accent) 35%, transparent); }
        /* .cmd-manage lives in globals.css now (it's a <Link>). */
        /* two-column bottom grid */
        .cmd-grid2 { display: grid; grid-template-columns: 1fr 1.4fr; gap: 12px; }
        .cmd-sec { display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; color: var(--text); margin-bottom: 8px; }
        .cmd-sec span { color: var(--muted); font-weight: 500; text-transform: none; letter-spacing: 0; }
        .cmd-staff { display: flex; align-items: center; gap: 8px; padding: 8px 0; border-bottom: var(--border); font-size: 13px; }
        .cmd-staff:last-child { border-bottom: 0; }
        .cmd-staff .dot { width: 7px; height: 7px; border-radius: 999px; background: var(--adm-ok); flex-shrink: 0; }
        .cmd-issue { display: flex; align-items: center; gap: 8px; padding: 7px 0; border-bottom: var(--border); }
        .cmd-issue:last-child { border-bottom: 0; }
        @media (max-width: 1100px) {
          .cmd-row { grid-template-columns: minmax(140px, 1.2fr) 84px 100px minmax(280px, 1.6fr) 80px; }
        }
        @media (max-width: 900px) { .cmd-grid2 { grid-template-columns: 1fr; } }
        @media (max-width: 760px) {
          .cmd-row { grid-template-columns: 1fr; gap: 4px; padding: 10px 14px; }
          .cmd-row.head { display: none; }
          .cmd-row > span { text-align: left !important; }
          /* Bigger tap targets for the quick-open buttons on phones (audit 2026-07-07). */
          .cmd-obtn { min-height: 40px; padding: 0 12px; }
        }
      `}</style>
    </>
  );
}

// "Which owner's panel?" — shown when the admin opens the Owner panel for a restaurant
// that has SEVERAL owners (owner 2026-07-25). Each row opens THAT owner's cockpit
// (act-as, no password, invisible to them). Registers with the back-stack via useAdminModal.
function OwnerChooser({ rest, onClose, onPick }: { rest: Rest; onClose: () => void; onPick: (uid: string) => void }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useAdminModal(dialogRef, "admin-owner-chooser", onClose);
  const avc = (id: string) => { let h = 0; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0; return ["#60a5fa", "#a78bfa", "#34d399", "#fbbf24", "#f472b6", "#22d3ee"][h % 6]; };
  const initials = (n: string) => n.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(2,6,16,0.66)", backdropFilter: "blur(2px)", zIndex: 1000 }} />
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={`Choose an owner for ${rest.name}`} style={{ position: "fixed", inset: 0, zIndex: 1001, display: "grid", placeItems: "center", padding: 16, pointerEvents: "none" }}>
        <div style={{ pointerEvents: "auto", width: "min(96vw, 420px)", background: "var(--card)", border: "var(--border)", borderRadius: 16, padding: 18, display: "grid", gap: 12 }}>
          <div>
            <div style={{ fontSize: 16.5, fontWeight: 800 }}>Which owner&rsquo;s panel?</div>
            <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 3 }}><b style={{ color: "var(--text)" }}>{rest.name}</b> has {rest.owners.length} owners — pick whose owner panel to open.</div>
          </div>
          <div style={{ display: "grid", gap: 8 }}>
            {rest.owners.map((o) => (
              <button key={o.id} onClick={() => onPick(o.id)}
                style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", padding: "11px 13px", border: "var(--border)", borderRadius: 12, background: "var(--bg)", color: "var(--text)", cursor: "pointer", textAlign: "left" }}>
                <span aria-hidden style={{ width: 38, height: 38, borderRadius: 11, background: `${avc(o.id)}33`, color: avc(o.id), display: "grid", placeItems: "center", fontWeight: 800, fontSize: 13.5, flex: "none" }}>{initials(o.name)}</span>
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span style={{ display: "block", fontWeight: 700, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.name}</span>
                  <span style={{ display: "block", fontSize: 11.5, marginTop: 1 }}>
                    {o.primary
                      ? <span style={{ color: "#fbbf24", fontWeight: 700 }}><i className="fas fa-star" style={{ fontSize: 9, marginRight: 4 }} aria-hidden="true" />Primary owner</span>
                      : <span style={{ color: "#60a5fa", fontWeight: 700 }}><i className="fas fa-user-group" style={{ fontSize: 9, marginRight: 4 }} aria-hidden="true" />Co-owner</span>}
                  </span>
                </span>
                <i className="fas fa-chevron-right" style={{ color: "var(--muted)", fontSize: 12 }} aria-hidden="true" />
              </button>
            ))}
          </div>
          <button onClick={onClose} style={{ justifySelf: "end", background: "transparent", border: 0, color: "var(--muted)", fontWeight: 700, fontSize: 13, cursor: "pointer", padding: "6px 8px" }}>Cancel</button>
        </div>
      </div>
    </>
  );
}
