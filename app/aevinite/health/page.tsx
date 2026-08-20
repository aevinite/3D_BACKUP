"use client";
// Admin · System health — read-only platform diagnostics. Deliberately cheap: one
// small API call (/api/admin/health) that times a trivial round-trip, reads
// planner ROW ESTIMATES (not exact counts) for the big tables, and a couple of
// small bounded queries. No secrets, no food revenue. Manual Refresh +
// useActiveAutoRefresh (60s, only while visible & in use) — this page must never
// itself become a load source.
import { useCallback, useEffect, useState } from "react";
import { timeAgo, useActiveAutoRefresh } from "@/components/admin/shared";
import { SkelList } from "@/components/admin/Skeleton";

type Health = {
  dbOk: boolean;
  latencyMs: number;
  tableEstimates: { table: string; estRows: number }[];
  tableEstimatesError: string | null;
  restaurants: { active: number; suspended: number; total: number };
  restaurantsError?: string | null;
  staffOnlineNow: number;
  staffTotal: number;
  staffError?: string | null;
  realtime: { configuredHost: string | null };
  openIssues: number | null;
  issuesFeedWired: boolean;
  // Dishes ticked "4D" whose model file was never uploaded, so their 3D view cannot open.
  // null = the read failed (say "unreadable", never a reassuring zero).
  broken3d: { count: number; dishes: { slug: string; title: string; restaurantId: string; missing: string }[] } | null;
  broken3dError: string | null;
  checkedAt: string;
  error?: string;
};

const TABLE_LABEL: Record<string, string> = {
  orders: "Orders", order_items: "Order items", sessions: "Sessions", staff_users: "Staff users", restaurants: "Restaurants",
};

function latencyTier(ms: number): "good" | "warn" | "bad" {
  if (ms < 300) return "good";
  if (ms < 900) return "warn";
  return "bad";
}

// ── Panels & devices — folded in from the old separate "Panel status" page (2026-07-23):
// per-restaurant panel CONNECTIVITY (last-seen → online/idle/quiet/never), from
// /api/admin/panels-health. Two health screens were one job; this is now a section here.
type Panel = { role: string; on: boolean; lastSeen: string | null; status: "off" | "never" | "online" | "idle" | "offline" };
type PRow = { id: string; name: string; slug: string; active: boolean; panels: Panel[] };
type PData = { rows: PRow[]; roles: string[]; attention: number; generatedAt: string };

const ROLE_LABEL: Record<string, string> = { manager: "Manager", kitchen: "Kitchen", tablet: "Tablet", owner: "Owner" };
const PSTATUS = {
  online: { c: "var(--adm-ok)", t: "Online" },
  idle: { c: "#d4a574", t: "Idle" },
  offline: { c: "var(--adm-danger)", t: "Quiet" },
  never: { c: "var(--adm-danger)", t: "Never seen" },
  off: { c: "var(--muted)", t: "Off" },
} as const;

function PanelCell({ p }: { p: Panel }) {
  // The OWNER panel is left OUT of the attention count (owners don't sit logged in), so a
  // red "never/quiet" owner cell was a false alarm — render it neutral instead.
  const ownerQuiet = p.role === "owner" && (p.status === "never" || p.status === "offline");
  const s = ownerQuiet ? { c: "var(--muted)", t: p.status === "never" ? "Not signed in" : "Quiet" } : PSTATUS[p.status];
  const hollow = p.status === "never" && !ownerQuiet;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 7, minWidth: 0 }} title={p.on ? (p.lastSeen ? `Last active ${timeAgo(p.lastSeen)}` : "Never seen active") : "Panel disabled for this restaurant"}>
      <span style={{ width: 8, height: 8, borderRadius: 999, flex: "0 0 auto", border: hollow ? `1px solid ${s.c}` : undefined, backgroundColor: hollow ? "transparent" : s.c }} aria-hidden="true" />
      <span style={{ fontSize: 12.5, color: p.status === "off" || ownerQuiet ? "var(--muted)" : "var(--text)" }}>
        {s.t}{p.on && p.lastSeen && (p.status === "idle" || p.status === "offline") ? ` · ${timeAgo(p.lastSeen)}` : ""}
      </span>
    </span>
  );
}

export default function AdminHealth() {
  const [h, setH] = useState<Health | null>(null);
  const [pd, setPd] = useState<PData | null>(null);
  const [pErr, setPErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null); setPErr(null);
    // Both health checks in parallel; they're independent, so a panels failure never blocks
    // the diagnostics above and vice-versa.
    const [healthRes, panelsRes] = await Promise.allSettled([
      fetch("/api/admin/health", { cache: "no-store" }).then((r) => r.json().then((j) => ({ ok: r.ok, j }))),
      fetch("/api/admin/panels-health", { cache: "no-store" }).then((r) => r.json().then((j) => ({ ok: r.ok, j }))),
    ]);
    if (healthRes.status === "fulfilled" && healthRes.value.ok) setH(healthRes.value.j);
    else setErr(healthRes.status === "fulfilled" ? (healthRes.value.j?.error || "Couldn't load health.") : "Couldn't load health.");
    if (panelsRes.status === "fulfilled" && panelsRes.value.ok) setPd(panelsRes.value.j);
    else setPErr(panelsRes.status === "fulfilled" ? (panelsRes.value.j?.error || "Couldn't load panel status.") : "Couldn't load panel status.");
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);
  useActiveAutoRefresh(load, 60000);

  // Restaurant id → name, from the panels-health rows this page already has. No extra request.
  const restaurantName = (id: string) => pd?.rows.find((r) => r.id === id)?.name || "unknown restaurant";

  const tier = h ? latencyTier(h.latencyMs) : "warn";

  return (
    <>
      <h1 className="adm-page-h">System health</h1>
      <p className="adm-page-sub">Read-only platform diagnostics + per-restaurant panel status. {h ? <>Last checked {timeAgo(h.checkedAt)}.</> : null}</p>

      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 14 }}>
        <button className="adm-btn" disabled={loading} onClick={load}>
          <i className={`fas fa-rotate-right${loading ? " fa-spin" : ""}`} style={{ marginRight: 6 }} aria-hidden="true" />Refresh
        </button>
      </div>

      {h === null && err ? (
        // A FAILED CHECK IS NOT A CHECK IN PROGRESS (T17 sweep, 2026-08-19). The error line was
        // printed and then the page fell through to "Checking…" underneath it — so the one screen
        // that answers "is the platform up?" sat saying it was still looking, for ever.
        <div className="adm-card" style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", borderColor: "var(--adm-warn)" }}>
          <span className="adx-pill warn"><span className="dot" />Couldn&apos;t check</span>
          <span className="adm-muted" style={{ fontSize: 13 }}>{err} This is <b>unknown</b>, not healthy.</span>
          <button className="adm-btn" style={{ marginLeft: "auto" }} disabled={loading} onClick={load}>Retry</button>
        </div>
      ) : null}

      {h === null ? (
        err ? null : <div className="adm-empty">Checking…</div>
      ) : !h.dbOk ? (
        // Database ping failed → the API omits every summary field, so we must NOT
        // fall through to the normal render (it reads h.restaurants.* and would crash
        // the whole page exactly when the DB is down — the one moment this page matters).
        <div className="adm-card" style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
          <span className="adx-pill bad"><span className="dot" />Database unreachable</span>
          <span className="adm-muted" style={{ fontSize: 13 }}>
            The health check couldn&apos;t reach the database{h.latencyMs ? ` (after ${h.latencyMs}ms)` : ""}.
            {h.error ? <> Details: <span className="mono">{h.error}</span></> : null} Press Refresh to retry.
          </span>
        </div>
      ) : (
        <>
          <div className="adm-card" style={{ marginBottom: 14, display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
            <span className={`adx-pill ${h.dbOk ? tier : "bad"}`}><span className="dot" />{h.dbOk ? `Database ${h.latencyMs}ms` : "Database unreachable"}</span>
            <span className={`adx-pill ${h.restaurantsError ? "warn" : "good"}`}><span className="dot" />{h.restaurantsError ? "restaurants unreadable" : `${h.restaurants.active} restaurant${h.restaurants.active !== 1 ? "s" : ""} live`}</span>
            {h.restaurants.suspended > 0 && <span className="adx-pill warn"><span className="dot" />{h.restaurants.suspended} suspended</span>}
            {/* 0 staff online is normal (e.g. overnight) — it's NOT a health warning; only a
                failed READ is. Green when someone's on, neutral when nobody is (audit 2026-07-23). */}
            <span className={`adx-pill ${h.staffError ? "warn" : h.staffOnlineNow > 0 ? "good" : ""}`}><span className="dot" />{h.staffError ? "staff status unreadable" : `${h.staffOnlineNow} staff online now`}</span>
            <span className={`adx-pill ${h.issuesFeedWired ? (h.openIssues ? "warn" : "good") : "warn"}`}><span className="dot" />{h.issuesFeedWired ? `${h.openIssues} open issue${h.openIssues === 1 ? "" : "s"}` : "issue feed unreachable"}</span>
          </div>

          <div className="adx-grid2col">
            <div className="adm-card" style={{ marginBottom: 14 }}>
              <h2>Row count estimates</h2>
              <p className="hint">Planner estimates (not exact counts) — an exact COUNT(*) on these tables would itself be a heavy scan, so we read Postgres&apos; own row-count metadata instead.</p>
              {h.tableEstimatesError ? (
                <div className="adm-empty">Couldn&apos;t read estimates: {h.tableEstimatesError}</div>
              ) : (
                <div className="adm-logwrap hx-kv">
                  <div className="adm-logrow head" style={{ gridTemplateColumns: "1fr 120px" }}><span>Table</span><span style={{ textAlign: "right" }}>~ rows</span></div>
                  {h.tableEstimates.map((t) => (
                    <div key={t.table} className="adm-logrow" style={{ gridTemplateColumns: "1fr 120px" }}>
                      <span>{TABLE_LABEL[t.table] || t.table}</span>
                      <span style={{ textAlign: "right", fontWeight: 700 }}>{t.estRows.toLocaleString("en-US")}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="adm-card" style={{ marginBottom: 14 }}>
              <h2>Realtime &amp; connections</h2>
              <p className="hint">Confirms the app is pointed at the right backend — no keys shown.</p>
              <div className="adm-logwrap hx-kv">
                <div className="adm-logrow" style={{ gridTemplateColumns: "1fr auto" }}><span>Realtime host</span><span className="mono adm-muted">{h.realtime.configuredHost || "not configured"}</span></div>
                <div className="adm-logrow" style={{ gridTemplateColumns: "1fr auto" }}><span>Staff online (last 3 min)</span><span style={{ fontWeight: 700 }}>{h.staffOnlineNow} / {h.staffTotal}</span></div>
                <div className="adm-logrow" style={{ gridTemplateColumns: "1fr auto" }}><span>Restaurants</span><span style={{ fontWeight: 700 }}>{h.restaurants.active} live · {h.restaurants.suspended} suspended</span></div>
              </div>
              <p className="hint" style={{ marginTop: 10, marginBottom: 0 }}>
                {h.issuesFeedWired
                  ? `Staff-raised issues (the closest thing to an error feed): ${h.openIssues} open across the platform.`
                  : "Couldn't reach the issues table — no error feed available right now."}
              </p>
            </div>
          </div>

          {/* 3D THAT CANNOT OPEN (owner, 2026-08-12). A dish ticked "4D" whose model file was never
              uploaded used to wear a "4D" badge on the menu and then tell the diner "3D view isn't
              ready for this dish". The badge no longer lies (components/FoodCard.tsx → has3d), and
              this is where the owner finds out there is something to upload. Read-only and quiet on
              purpose — no phone alert for a missing file. */}
          <div className="adm-card" style={{ marginTop: 14 }}>
            <div className="adm-cardbody">
              <h2>3D dishes with no model file</h2>
              <p className="hint">
                A dish marked <strong>4D</strong> needs its model uploaded before a diner can spin it.
                These are ticked but have no file, so their 3D view cannot open — the menu quietly shows
                them as ordinary dishes until the file is there.
              </p>
              {h.broken3d === null ? (
                <p className="hint" style={{ marginBottom: 0 }}>
                  Couldn&rsquo;t check this right now{h.broken3dError ? ` (${h.broken3dError})` : ""} — so this is
                  <strong> unknown</strong>, not zero.
                </p>
              ) : h.broken3d.count === 0 ? (
                <p className="hint" style={{ marginBottom: 0 }}>
                  <span className="adx-pill good"><span className="dot" />Nothing to fix</span>{" "}
                  Every dish marked 4D has both of its model files.
                </p>
              ) : (
                <>
                  <p style={{ margin: "0 0 10px" }}>
                    <span className="adx-pill warn"><span className="dot" />
                      {h.broken3d.count} dish{h.broken3d.count === 1 ? "" : "es"} to fix
                    </span>
                  </p>
                  {/* WHICH RESTAURANT — otherwise this is a dish name and nothing to do with it
                      (T17 sweep, 2026-08-19). There are nine restaurants on this platform; a row
                      reading "Truffle Fries · missing: small" does not tell the admin whose menu to
                      open. The name comes from the panels-health rows already fetched below, so it
                      costs no extra request. */}
                  <div className="adm-logwrap hx-kv">
                    {h.broken3d.dishes.map((d) => (
                      <div key={`${d.restaurantId}-${d.slug}`} className="adm-logrow" style={{ gridTemplateColumns: "1fr auto" }}>
                        <span style={{ minWidth: 0 }}>
                          {d.title || d.slug}
                          <span className="adm-muted" style={{ display: "block", fontSize: 11.5, marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            <i className="fas fa-store" style={{ fontSize: 9, marginRight: 4, opacity: 0.7 }} aria-hidden="true" />
                            {restaurantName(d.restaurantId)}
                          </span>
                        </span>
                        <span className="mono adm-muted">missing: {d.missing}</span>
                      </div>
                    ))}
                  </div>
                  {h.broken3d.count > h.broken3d.dishes.length && (
                    <p className="hint" style={{ marginTop: 8, marginBottom: 0 }}>
                      Showing the first {h.broken3d.dishes.length} of {h.broken3d.count}.
                    </p>
                  )}
                </>
              )}
            </div>
          </div>
        </>
      )}

      {/* Panels & devices (was the separate "Panel status" page) — per-restaurant connectivity. */}
      <div style={{ display: "flex", alignItems: "center", gap: 9, margin: "18px 0 11px" }}>
        <i className="fas fa-signal" aria-hidden="true" style={{ color: "var(--muted)" }} />
        <h2 style={{ margin: 0, fontSize: 16 }}>Panels &amp; devices</h2>
        <span className="adm-muted" style={{ fontSize: 12 }}>which staff screens are connected, per restaurant</span>
      </div>
      {pErr && <p style={{ color: "var(--adm-danger)", fontSize: 13 }}>{pErr} <button className="adm-btn" style={{ marginLeft: 8 }} onClick={load}>Retry</button></p>}
      {pd && (() => {
        // A WARNING THAT IS ALWAYS UP IS NOT A WARNING (T17 sweep, 2026-08-19).
        //
        // This bar counted every enabled panel not seen in the last HOUR and called all of them
        // "a device or login may be down". A restaurant that is shut, between shifts, or simply
        // closed on a Monday has every panel quiet — so on this platform the bar read
        // "23 enabled panels quiet or never seen" on every single load, with a warning triangle,
        // for ever. Twenty of the twenty-three were closed restaurants. An admin who sees the same
        // amber bar every morning stops reading it, and the three that DO matter go with it.
        //
        // NEVER SEEN is the one that is genuinely wrong: an enabled panel nobody has ever signed
        // into is a setup that was not finished, and it stays true whatever the hour. That keeps
        // the warning. "Quiet for over an hour" is stated as the plain fact it is, in the same
        // sentence, so nothing is hidden and nothing is dressed up.
        const never = pd.rows.filter((r) => r.active).reduce((n, r) => n + r.panels.filter((x) => x.role !== "owner" && x.status === "never").length, 0);
        const quiet = pd.rows.filter((r) => r.active).reduce((n, r) => n + r.panels.filter((x) => x.role !== "owner" && x.status === "offline").length, 0);
        const alarm = never > 0;
        return (
          <div className="adm-card" style={{ marginBottom: 12, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", borderColor: alarm ? "#d4a574" : undefined }}>
            <i className={`fas ${alarm ? "fa-triangle-exclamation" : "fa-circle-check"}`} style={{ color: alarm ? "#d4a574" : "var(--adm-ok)" }} aria-hidden="true" />
            <span style={{ fontSize: 13, flex: "1 1 240px", minWidth: 0 }}>
              {alarm ? (
                <>
                  <b>{never}</b> enabled panel{never === 1 ? " has" : "s have"} never been signed into — that setup was never finished.
                  {quiet > 0 ? <span className="adm-muted"> {quiet} more {quiet === 1 ? "is" : "are"} simply quiet (nothing in the last hour), which is normal for a closed restaurant.</span> : null}
                </>
              ) : quiet > 0 ? (
                <span className="adm-muted">Every enabled panel has been signed into. {quiet} {quiet === 1 ? "is" : "are"} quiet right now — nothing in the last hour, which is normal for a closed restaurant.</span>
              ) : (
                "All enabled panels have been active recently."
              )}
            </span>
          </div>
        );
      })()}
      <div className="adm-card" style={{ padding: 0, overflow: "hidden" }}>
        {!pd ? (pErr ? <div className="adm-empty">Couldn&apos;t load.</div> : <SkelList rows={4} label="Loading" />) : pd.rows.length === 0 ? (
          <div className="adm-empty">No restaurants yet.</div>
        ) : (
          // Horizontal scroll on narrow screens (the 5-col grid is ~560px min).
          <div className="adm-logwrap" style={{ border: 0, overflowX: "auto" }}>
            <div className="adm-logrow head" style={{ gridTemplateColumns: "1.4fr repeat(4, minmax(120px, 1fr))", minWidth: 560 }}>
              <span>Restaurant</span>
              {pd.roles.map((r) => <span key={r}>{ROLE_LABEL[r] || r}</span>)}
            </div>
            {pd.rows.map((row) => (
              <div key={row.id} className="adm-logrow" style={{ gridTemplateColumns: "1.4fr repeat(4, minmax(120px, 1fr))", minWidth: 560, alignItems: "center" }}>
                <span style={{ minWidth: 0 }}>
                  <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block" }}>{row.name}</span>
                  {!row.active && <span style={{ fontSize: 11, color: "var(--muted)" }}>suspended</span>}
                </span>
                {row.panels.map((p) => <PanelCell key={p.role} p={p} />)}
              </div>
            ))}
          </div>
        )}
      </div>

      <style href="adm-health" precedence="default">{`
        /* THE NUMBERS ARE THE WHOLE POINT OF THESE TWO CARDS (T17 sweep, 2026-08-19).
           The console's phone rule gives every .adm-logrow a 540px min-width and lets the wrapper
           scroll sideways. That is the right call for the admin's comparison tables — you read
           down a column there. It is the wrong call for a two-column key -> value list: measured on
           a 360px screen the card is 296px wide and the row is 540px, so "Row count estimates"
           showed five table names and NOT ONE number, and "Realtime & connections" showed three
           labels and none of their values. Nothing hinted the card could be dragged.
           These lists fit instead, the value sitting under its label. Same rows, same order. */
        @media (max-width: 560px) {
          .hx-kv .adm-logrow { min-width: 0; grid-template-columns: 1fr !important; gap: 3px; padding: 10px 14px; }
          .hx-kv .adm-logrow > :nth-child(2) { text-align: left !important; font-size: 12.5px; }
          .hx-kv .adm-logrow.head { display: none !important; }
        }
      `}</style>
    </>
  );
}
