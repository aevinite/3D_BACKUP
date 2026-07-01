"use client";
// Admin · Overview — the Aevidine command center. The admin is the TOP of the
// hierarchy, so this shows EVERY restaurant on the platform, who owns each one
// (or "independent · manager-run"), and platform-wide analytics with charts.
// Data is reused from the owner RPCs (for the admin cookie they return ALL
// restaurants) + /api/admin/restaurants (the owner mapping). Live + egress-safe
// via useActiveAutoRefresh (refetch only while visible & in use).
//
// Two interaction upgrades (2026-06-27):
//   • Each of the 5 KPI tiles opens a DETAIL DRAWER — rendered from data already in
//     state, so a tile-click costs ZERO extra DB egress.
//   • A date-range dropdown drives the analytics fetch (today/yesterday/7d/30d/all);
//     the "Orders" KPI label + chart titles follow the chosen range.
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { inr, useActiveAutoRefresh, ActivityFeed, type Action } from "@/components/admin/shared";
import { RevenueBar, TrendLine, TimeBar } from "@/components/owner/Charts";
import Dropdown from "@/components/admin/Dropdown";

const FALLBACK = "#e3c06f";
type Rest = { id: string; slug: string; name: string; active: boolean; ownerUserId: string | null; ownerName: string | null };
type OvRow = { id: string; revenueToday: number; ordersToday: number; revenueAll: number; ordersAll: number; openTables: number };
type RevRow = { id: string; name: string; accentColor: string; revenue: number; orders: number };
type TsRow = { bucket: string; restaurantId?: string; revenue: number };
type Issue = { id: string; restaurantName: string; subject: string; status: string; raised_by: string | null; created_at: string };
type DetailKey = "restaurants" | "owners" | "issues" | "orders" | "tables";

// Range presets — "includes both" a single day (Today/Yesterday) and rolling ranges.
const RANGE_OPTS = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "all", label: "All time" },
];
const RANGE_SHORT: Record<string, string> = { today: "today", yesterday: "yest.", "7d": "7d", "30d": "30d", all: "all" };
const RANGE_LONG: Record<string, string> = { today: "today", yesterday: "yesterday", "7d": "last 7 days", "30d": "last 30 days", all: "all time" };

export default function AdminOverview() {
  const [rests, setRests] = useState<Rest[]>([]);
  const [owners, setOwners] = useState<{ id: string; name: string }[]>([]);
  const [ov, setOv] = useState<{ restaurants: OvRow[]; totals: { openTables: number } } | null>(null);
  const [rev, setRev] = useState<RevRow[]>([]);
  const [ts, setTs] = useState<TsRow[]>([]);
  const [pay, setPay] = useState<{ method: string; revenue: number; orders: number }[]>([]);
  const [maintenance, setMaintenance] = useState(false);
  const [activity, setActivity] = useState<Action[]>([]);
  const [staff, setStaff] = useState<{ name: string | null; username: string; role: string; restaurantName: string | null; last_seen_at: string | null }[]>([]);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [range, setRange] = useState("30d");
  const [detail, setDetail] = useState<DetailKey | null>(null);

  // Analytics is its OWN fetch keyed on the chosen period, so switching the date
  // range refetches ONLY the charts — not the other 6 endpoints (egress-safe; the
  // owner's #1 fear is whole-page refetches on every little interaction).
  const loadAnalytics = useCallback(() => {
    fetch(`/api/owner/analytics?range=${range}`, { cache: "no-store" }).then((r) => r.json()).then((j) => { if (!j.error) { setRev(j.restaurantRevenue || []); setTs(j.timeseries || []); setPay(j.paymentMethods || []); } }).catch(() => {});
  }, [range]);
  // Everything else — refreshed on mount, on the 60s active poll, and on manual ↻.
  const loadRest = useCallback(() => {
    fetch("/api/admin/restaurants", { cache: "no-store" }).then((r) => r.json()).then((j) => { if (!j.error) { setRests(j.restaurants || []); setOwners(j.owners || []); } }).catch(() => {});
    fetch("/api/owner/overview", { cache: "no-store" }).then((r) => r.json()).then((j) => { if (!j.error) setOv(j); }).catch(() => {});
    fetch("/api/admin/overview", { cache: "no-store" }).then((r) => r.json()).then((j) => { if (!j.error) setMaintenance(!!j.maintenance); }).catch(() => {});
    fetch("/api/admin/oplog?limit=18", { cache: "no-store" }).then((r) => r.json()).then((j) => { if (!j.error) setActivity(j.actions || []); }).catch(() => {});
    fetch("/api/admin/users", { cache: "no-store" }).then((r) => r.json()).then((j) => { if (!j.error) setStaff(j.users || []); }).catch(() => {});
    fetch("/api/owner/issues", { cache: "no-store" }).then((r) => r.json()).then((j) => { if (!j.error) setIssues(j.issues || []); }).catch(() => {});
  }, []);
  const load = useCallback(() => { loadRest(); loadAnalytics(); }, [loadRest, loadAnalytics]);
  useEffect(() => { loadRest(); }, [loadRest]);            // mount: the bulk of the page
  useEffect(() => { loadAnalytics(); }, [loadAnalytics]);  // mount + ONLY when the period changes
  // Heavy dashboard: a gentle ~60s auto-refresh that runs ONLY while the tab is visible
  // AND in use (click/scroll/key) — it stops when idle or hidden, and the heavy page
  // never opens a realtime websocket. Manual ↻ Refresh is instant. (owner 2026-06-26)
  const [refreshing, setRefreshing] = useState(false);
  useActiveAutoRefresh(load, 60000);
  const manualRefresh = () => { setRefreshing(true); load(); setTimeout(() => setRefreshing(false), 600); };

  // Resolve / reopen an issue from the drawer — reuses the existing PATCH (admin in scope).
  const setIssueStatus = async (id: string, status: "resolved" | "open") => {
    setIssues((prev) => prev.map((i) => (i.id === id ? { ...i, status } : i)));
    try {
      const r = await fetch("/api/owner/issues", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, status }) });
      if (!r.ok) load();
    } catch { load(); }
  };

  const ovById = useMemo(() => Object.fromEntries((ov?.restaurants || []).map((r) => [r.id, r])), [ov]);
  const totals = useMemo(() => ({
    revenue: rev.reduce((a, r) => a + r.revenue, 0),
    orders: rev.reduce((a, r) => a + r.orders, 0),
    openTables: ov?.totals.openTables ?? 0,
    ownerCount: owners.length,
  }), [rev, ov, owners]);

  // Staff "working now" — active within the last 3 minutes (presence heartbeat).
  const PANEL = (role: string) => (({ owner: "Owner", manager: "Manager", kitchen: "Kitchen", tablet: "Tablet" } as Record<string, string>)[role] || role);
  const online = useMemo(() => staff.filter((u) => u.last_seen_at && Date.now() - new Date(u.last_seen_at).getTime() < 180_000), [staff]);

  // Bucket label: hourly for single-day ranges, daily otherwise.
  const fmtBucket = useCallback((iso: string) => {
    const d = new Date(iso);
    return range === "today" || range === "yesterday"
      ? d.toLocaleTimeString("en-IN", { hour: "numeric", hour12: true })
      : d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  }, [range]);

  // Multi-line trend: rows {label,[restaurantName]:revenue}; one accent-colored line per restaurant.
  const trend = useMemo(() => {
    const meta = new Map(rev.map((r) => [r.id, { name: r.name, color: r.accentColor || FALLBACK }]));
    const byBucket = new Map<string, Record<string, unknown>>();
    for (const t of ts) {
      const label = fmtBucket(t.bucket);
      if (!byBucket.has(t.bucket)) byBucket.set(t.bucket, { label });
      const m = meta.get(t.restaurantId || "");
      if (m) (byBucket.get(t.bucket)!)[m.name] = t.revenue;
    }
    return { rows: Array.from(byBucket.values()), lines: rev.slice(0, 8).map((r) => ({ key: r.name, name: r.name, color: r.accentColor || FALLBACK })) };
  }, [rev, ts, fmtBucket]);

  // Chart focus: "all" shows every restaurant (bar by restaurant + all trend lines);
  // a specific restaurant shows ITS revenue by DAY (clearer than one lonely bar / one
  // line lost in the pack). Drives both charts via the dropdown above them.
  const [chartRest, setChartRest] = useState("all");
  const selRev = rev.find((r) => r.name === chartRest);
  const timeBar = useMemo(
    () => trend.rows.map((row) => ({ label: String((row as Record<string, unknown>).label ?? ""), revenue: Number((row as Record<string, unknown>)[chartRest]) || 0 })),
    [trend, chartRest]
  );
  const restOpts = useMemo(() => [{ value: "all", label: "All restaurants" }, ...rev.map((r) => ({ value: r.name, label: r.name }))], [rev]);
  const rLong = RANGE_LONG[range] || range;

  // Admin = platform oversight, NOT profit (that's the owner's view). Lead with
  // operational signals: restaurants, owners, open complaints, activity, live tables.
  // Each KPI tile is clickable → opens its detail drawer.
  const openIssues = issues.filter((i) => i.status === "open");
  const KPIS: { key: DetailKey; label: string; value: string | number; icon: string }[] = [
    { key: "restaurants", label: "Restaurants", value: rests.length || "…", icon: "fa-store" },
    { key: "owners", label: "Owners", value: totals.ownerCount, icon: "fa-crown" },
    { key: "issues", label: "Open issues", value: openIssues.length, icon: "fa-triangle-exclamation" },
    { key: "orders", label: `Orders · ${RANGE_SHORT[range] || range}`, value: rev.length ? totals.orders : "…", icon: "fa-receipt" },
    { key: "tables", label: "Open tables now", value: ov ? totals.openTables : "…", icon: "fa-chair" },
  ];

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <h1 className="adm-page-h" style={{ marginBottom: 0 }}>Aevidine · all restaurants</h1>
        <button className="adm-btn" onClick={manualRefresh} disabled={refreshing} title="Refresh now (auto-updates are throttled to save load)">
          <i className={`fas fa-rotate-right${refreshing ? " fa-spin" : ""}`} style={{ marginRight: 7 }} aria-hidden="true" />Refresh
        </button>
      </div>
      <p className="adm-page-sub">Every restaurant on the platform, who runs it, and how it&apos;s doing.</p>

      {maintenance && (
        <div className="adm-card" style={{ borderColor: "var(--adm-danger)", marginBottom: 18, display: "flex", alignItems: "center", gap: 12 }}>
          <i className="fas fa-triangle-exclamation" style={{ color: "var(--adm-danger)", fontSize: 18 }} aria-hidden="true" />
          <div style={{ flex: 1 }}><b>A guest menu is in maintenance.</b></div>
          <Link href="/aevinite/settings" className="adm-btn">Settings</Link>
        </div>
      )}

      <div className="adm-stats">
        {KPIS.map((k) => (
          <button key={k.key} type="button" className="adm-stat adm-stat-btn" onClick={() => setDetail(k.key)}
            aria-label={`${k.label} — view details`}>
            <div className="ic"><i className={`fas ${k.icon}`} aria-hidden="true" /></div>
            <div className="k">{k.label}</div>
            <div className="v">{k.value}</div>
            <i className="fas fa-arrow-right adm-stat-go" aria-hidden="true" />
          </button>
        ))}
      </div>

      <div className="adm-card" style={{ marginBottom: 8 }}>
        <div className="adm-ctitle">Working now <span>· {online.length} active across all restaurants</span></div>
        {online.length === 0 ? (
          <div className="adm-empty" style={{ padding: "6px 0" }}>No staff active right now.</div>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {online.map((u, i) => (
              <div key={i} style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "7px 12px", borderRadius: 999, background: "color-mix(in srgb, var(--adm-ok) 12%, transparent)", border: "1px solid color-mix(in srgb, var(--adm-ok) 35%, transparent)", fontSize: 12.5 }}>
                <span style={{ width: 8, height: 8, borderRadius: 999, background: "var(--adm-ok)", boxShadow: "0 0 0 3px color-mix(in srgb, var(--adm-ok) 22%, transparent)" }} />
                <b>{u.name || u.username}</b>
                <span style={{ color: "var(--accent)", fontWeight: 700 }}>{PANEL(u.role)}</span>
                <span style={{ color: "var(--muted)" }}>{u.restaurantName || "—"}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="adm-card" style={{ marginBottom: 8 }}>
        <div className="adm-ctitle">Complaints &amp; issues <span>· {openIssues.length} open across all restaurants</span></div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {openIssues.length === 0 ? (
            <div className="adm-empty" style={{ padding: "6px 0" }}>No open issues right now. 🎉</div>
          ) : (
            openIssues.slice(0, 6).map((i) => (
              <div key={i.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderRadius: 10, background: "color-mix(in srgb, var(--adm-danger, #e5484d) 8%, transparent)", border: "1px solid color-mix(in srgb, var(--adm-danger, #e5484d) 26%, transparent)" }}>
                <i className="fas fa-triangle-exclamation" style={{ color: "var(--adm-danger, #e5484d)" }} aria-hidden="true" />
                <b style={{ fontSize: 13.5 }}>{i.subject}</b>
                <span style={{ color: "var(--accent)", fontWeight: 700, fontSize: 12 }}>{i.restaurantName}</span>
                <span style={{ marginLeft: "auto", color: "var(--muted)", fontSize: 11.5 }}>{i.raised_by || "—"} · {new Date(i.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</span>
              </div>
            ))
          )}
          {/* Always reachable (even at zero open) so the admin can review resolved history. */}
          <Link href="/aevinite/issues" style={{ fontSize: 12, marginTop: 2, color: "var(--accent)", fontWeight: 700 }}>View all &amp; resolve →</Link>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "16px 0 8px", flexWrap: "wrap" }}>
        <span style={{ fontSize: 13.5, fontWeight: 800 }}>Revenue</span>
        <Dropdown value={chartRest} onChange={setChartRest} options={restOpts} ariaLabel="Focus a restaurant" align="left" />
        {chartRest !== "all" && <button className="adm-btn" style={{ padding: "6px 12px", fontSize: 12.5 }} onClick={() => setChartRest("all")}>← All restaurants</button>}
      </div>
      <div className="adm-charts2">
        <div className="adm-card">
          {/* The date-range (period) dropdown lives in THIS graph card's own top-right
              corner — it scopes the whole revenue view to the chosen window. */}
          <div className="adm-chead">
            <div className="adm-ctitle">
              {chartRest === "all"
                ? <>Who earns more <span>· revenue by restaurant ({rLong}) · tap a bar to focus</span></>
                : <>{chartRest} <span>· revenue over {rLong}</span></>}
            </div>
            <Dropdown value={range} onChange={setRange} options={RANGE_OPTS} ariaLabel="Choose date range" align="right" />
          </div>
          {chartRest === "all" ? (
            <RevenueBar
              data={rev.map((r) => ({ id: r.id, name: r.name, revenue: r.revenue, orders: r.orders, accentColor: r.accentColor || FALLBACK }))}
              onSelect={(id) => { const m = rev.find((x) => x.id === id); if (m) setChartRest(m.name); }} />
          ) : (
            <TimeBar data={timeBar} color={selRev?.accentColor || FALLBACK} />
          )}
        </div>
        <div className="adm-card">
          <div className="adm-chead">
            <div className="adm-ctitle">Revenue over time <span>· {chartRest === "all" ? `${rLong}, per restaurant` : chartRest}</span></div>
            <Dropdown value={range} onChange={setRange} options={RANGE_OPTS} ariaLabel="Choose date range" align="right" />
          </div>
          <TrendLine data={trend.rows} lines={chartRest === "all" ? trend.lines : trend.lines.filter((l) => l.name === chartRest)} />
        </div>
      </div>

      {/* Payment methods (owner, 2026-07-01): how bills got paid, summed across every
          restaurant on the platform for the chosen period. Reuses paymentMethods from
          the SAME /api/owner/analytics fetch above — no extra request. */}
      <div className="adm-card" style={{ marginBottom: 8 }}>
        <div className="adm-chead">
          <div className="adm-ctitle">Payment methods <span>· {rLong}, across every restaurant</span></div>
        </div>
        {pay.length === 0 ? (
          <div className="adm-empty">No paid bills in this period yet.</div>
        ) : (() => {
          const payTotal = pay.reduce((a, p) => a + p.revenue, 0) || 1;
          const payColor: Record<string, string> = { UPI: "#4f9dff", Cash: "#7ec88a", Card: "#e3c06f", Other: "#b58ae6", "Not recorded": "#9aa3b0" };
          return (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {pay.map((p) => (
                <div key={p.method} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ width: 96, fontSize: 12.5, fontWeight: 700, flexShrink: 0 }}>{p.method}</span>
                  <div style={{ flex: 1, height: 8, borderRadius: 999, background: "var(--line)", overflow: "hidden" }}>
                    <div style={{ width: `${(p.revenue / payTotal) * 100}%`, height: "100%", background: payColor[p.method] || FALLBACK }} />
                  </div>
                  <span style={{ fontSize: 12.5, fontWeight: 700, width: 96, textAlign: "right", flexShrink: 0 }}>{inr(p.revenue)}</span>
                </div>
              ))}
            </div>
          );
        })()}
      </div>

      <h2 className="adm-h2">Restaurants &amp; owners</h2>
      <div className="adm-rgrid">
        {rests.length === 0 && <div className="adm-empty" style={{ gridColumn: "1 / -1" }}>Loading restaurants…</div>}
        {rests.map((r) => {
          const o = ovById[r.id];
          const accent = rev.find((x) => x.id === r.id)?.accentColor || FALLBACK;
          return (
            <Link key={r.id} href="/aevinite/restaurants" className="adm-card adm-rcard" style={{ ["--rcol" as string]: accent }}>
              <span className="adm-raccent" aria-hidden="true" />
              <div className="adm-rhead">
                <div style={{ minWidth: 0 }}>
                  <div className="adm-rname" title={r.name}>{r.name}</div>
                  <div className="adm-muted" style={{ fontSize: 12 }}>{r.slug}</div>
                </div>
                <span className={`adm-chip ${r.active ? "on" : "off"}`}>{r.active ? "Active" : "Off"}</span>
              </div>
              <div className="adm-rowner">
                {r.ownerUserId
                  ? <><i className="fas fa-crown" aria-hidden="true" /> {r.ownerName}</>
                  : <><i className="fas fa-user-gear" aria-hidden="true" /> Independent · manager-run</>}
              </div>
              <div className="adm-rnums">
                <div><div className="k">Today</div><div className="v">{o ? inr(o.revenueToday) : "—"}</div></div>
                <div><div className="k">Orders</div><div className="v">{o ? o.ordersToday : "—"}</div></div>
                <div><div className="k">Open</div><div className="v">{o ? o.openTables : "—"}</div></div>
              </div>
            </Link>
          );
        })}
      </div>

      <h2 className="adm-h2">Platform tools</h2>
      <div className="adm-teasers" style={{ marginBottom: 18 }}>
        {([
          ["/aevinite/owners", "fa-crown", "Owners", "Directory & account status"],
          ["/aevinite/analytics", "fa-chart-pie", "Analytics", "Platform GMV, growth & cohorts"],
          ["/aevinite/billing", "fa-file-invoice-dollar", "Billing & plans", "Subscriptions & invoices"],
          ["/aevinite/health", "fa-heart-pulse", "System health", "Uptime, errors & jobs"],
        ] as [string, string, string, string][]).map(([href, icon, title, blurb]) => (
          <Link key={href} href={href} className="adm-teaser">
            <span className="ti"><i className={`fas ${icon}`} aria-hidden="true" /></span>
            <span style={{ minWidth: 0 }}><span className="tt">{title}<span className="soon">Soon</span></span><span className="tb">{blurb}</span></span>
          </Link>
        ))}
      </div>

      <div className="adm-card" style={{ marginTop: 18 }}>
        <h2>Recent activity <span className="adm-muted" style={{ fontWeight: 400 }}>· across all restaurants &amp; panels</span></h2>
        <ActivityFeed rows={activity} />
      </div>

      <DetailDrawer
        which={detail} onClose={() => setDetail(null)}
        rests={rests} ovById={ovById} owners={owners} rev={rev}
        openIssues={openIssues} rangeLong={rLong} onIssue={setIssueStatus} />

      <style jsx>{`
        .adm-charts2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 8px; }
        .adm-ctitle { font-size: 13px; font-weight: 800; margin-bottom: 10px; }
        .adm-ctitle span { color: var(--muted); font-weight: 500; }
        /* Graph-card header: title on the left, the period dropdown pinned top-right. */
        .adm-chead { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
        .adm-chead .adm-ctitle { margin-bottom: 0; flex: 1; min-width: 0; }
        .adm-h2 { font-size: 14px; font-weight: 800; margin: 22px 0 10px; }
        .adm-rgrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 14px; }
        .adm-rcard { position: relative; overflow: hidden; padding-left: 22px; text-decoration: none; color: inherit; display: block; transition: transform .12s, box-shadow .12s; }
        .adm-rcard:hover { transform: translateY(-2px); box-shadow: 0 10px 26px rgba(0,0,0,.12); }
        .adm-raccent { position: absolute; left: 0; top: 0; bottom: 0; width: 5px; background: var(--rcol, var(--accent)); }
        .adm-rhead { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; margin-bottom: 10px; }
        .adm-rname { font-size: 15.5px; font-weight: 800; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .adm-chip { font-size: 10.5px; font-weight: 800; padding: 3px 9px; border-radius: 999px; text-transform: uppercase; letter-spacing: .03em; flex-shrink: 0; }
        .adm-chip.on { background: color-mix(in srgb, var(--adm-ok) 20%, transparent); color: var(--adm-ok); }
        .adm-chip.off { background: rgba(120,120,120,.18); color: var(--muted); }
        .adm-rowner { display: flex; align-items: center; gap: 7px; font-size: 12.5px; font-weight: 700; color: var(--rcol, var(--accent)); margin-bottom: 12px; }
        .adm-rowner i { opacity: .85; }
        .adm-rnums { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; padding-top: 10px; border-top: var(--border); }
        .adm-rnums .k { font-size: 10.5px; color: var(--muted); }
        .adm-rnums .v { font-size: 16px; font-weight: 800; font-variant-numeric: tabular-nums; }
        /* KPI tiles are now buttons: reset native button styling, keep the .adm-stat card look. */
        .adm-stat-btn { font: inherit; text-align: left; width: 100%; cursor: pointer; color: inherit; }
        .adm-stat-go { position: absolute; right: 16px; bottom: 14px; font-size: 12px; color: var(--accent); opacity: 0; transform: translateX(-4px); transition: opacity .15s, transform .15s; }
        .adm-stat-btn:hover .adm-stat-go { opacity: 1; transform: translateX(0); }
        .adm-stat-btn:focus-visible { outline: none; box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 30%, transparent); }
        @media (max-width: 760px) { .adm-charts2 { grid-template-columns: 1fr; } }
      `}</style>
    </>
  );
}

// ── Detail drawer ────────────────────────────────────────────────────────────
// A right-side slide-over showing the breakdown BEHIND a KPI tile. It renders from
// data already loaded by the page (rests/owners/rev/issues/ov) → a tile-click adds
// NO database egress. Closes on Escape, backdrop click, or the ✕. (The /aevinite
// panel doesn't use the guest/staff back-stack manager, so Escape+backdrop is the
// right close affordance here — desktop-first admin surface.)
function DetailDrawer({
  which, onClose, rests, ovById, owners, rev, openIssues, rangeLong, onIssue,
}: {
  which: DetailKey | null;
  onClose: () => void;
  rests: Rest[];
  ovById: Record<string, OvRow>;
  owners: { id: string; name: string }[];
  rev: RevRow[];
  openIssues: Issue[];
  rangeLong: string;
  onIssue: (id: string, status: "resolved" | "open") => void;
}) {
  useEffect(() => {
    if (!which) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [which, onClose]);

  if (!which) return null;
  const TITLES: Record<DetailKey, string> = {
    restaurants: "All restaurants", owners: "Owners", issues: "Open issues",
    orders: `Orders · ${rangeLong}`, tables: "Open tables now",
  };

  return (
    <div className="adm-dx-ov" onClick={onClose}>
      <aside className="adm-dx" role="dialog" aria-modal="true" aria-label={TITLES[which]} onClick={(e) => e.stopPropagation()}>
        <div className="adm-dx-head">
          <h2>{TITLES[which]}</h2>
          <button className="adm-dx-x" onClick={onClose} aria-label="Close"><i className="fas fa-xmark" aria-hidden="true" /></button>
        </div>
        <div className="adm-dx-body">
          {which === "restaurants" && (
            <>
              {rests.map((r) => {
                const o = ovById[r.id];
                return (
                  <div key={r.id} className="adm-dx-row">
                    <div style={{ minWidth: 0 }}>
                      <div className="t">{r.name} {!r.active && <span className="adm-dx-tag off">Off</span>}</div>
                      <div className="s">{r.ownerName ? <><i className="fas fa-crown" /> {r.ownerName}</> : "Independent · manager-run"}</div>
                    </div>
                    <div className="adm-dx-num">{o ? inr(o.revenueToday) : "—"}<span>today</span></div>
                  </div>
                );
              })}
              <Link href="/aevinite/restaurants" className="adm-btn primary adm-dx-cta">Open Restaurants page →</Link>
            </>
          )}
          {which === "owners" && (
            owners.length === 0 ? <div className="adm-empty">No owners yet.</div> : owners.map((ow) => {
              const mine = rests.filter((r) => r.ownerUserId === ow.id);
              return (
                <div key={ow.id} className="adm-dx-row">
                  <div style={{ minWidth: 0 }}>
                    <div className="t"><i className="fas fa-crown" style={{ color: "var(--accent)", marginRight: 6 }} />{ow.name}</div>
                    <div className="s">{mine.length ? mine.map((r) => r.name).join(" · ") : "No restaurants assigned"}</div>
                  </div>
                  <div className="adm-dx-num">{mine.length}<span>{mine.length === 1 ? "venue" : "venues"}</span></div>
                </div>
              );
            })
          )}
          {which === "issues" && (
            <>
              {openIssues.length === 0 ? <div className="adm-empty">No open issues. 🎉</div> : openIssues.map((i) => (
                <div key={i.id} className="adm-dx-row">
                  <div style={{ minWidth: 0 }}>
                    <div className="t">{i.subject}</div>
                    <div className="s"><span style={{ color: "var(--accent)", fontWeight: 700 }}>{i.restaurantName}</span> · {i.raised_by || "—"} · {new Date(i.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</div>
                  </div>
                  <button className="adm-btn ok" style={{ padding: "7px 12px", fontSize: 12.5, flexShrink: 0 }} onClick={() => onIssue(i.id, "resolved")}>Resolve</button>
                </div>
              ))}
              <Link href="/aevinite/issues" className="adm-btn primary adm-dx-cta">Manage all issues →</Link>
            </>
          )}
          {which === "orders" && (
            rev.length === 0 ? <div className="adm-empty">No orders in this period yet.</div> : rev.map((r) => (
              <div key={r.id} className="adm-dx-row">
                <div style={{ minWidth: 0 }}>
                  <div className="t"><span style={{ display: "inline-block", width: 9, height: 9, borderRadius: 3, background: r.accentColor || FALLBACK, marginRight: 7 }} />{r.name}</div>
                  <div className="s">{inr(r.revenue)} revenue</div>
                </div>
                <div className="adm-dx-num">{r.orders}<span>orders</span></div>
              </div>
            ))
          )}
          {which === "tables" && (
            <>
              {rests.map((r) => {
                const o = ovById[r.id];
                if (!o || o.openTables <= 0) return null;
                return (
                  <div key={r.id} className="adm-dx-row">
                    <div className="t">{r.name}</div>
                    <div className="adm-dx-num">{o.openTables}<span>open</span></div>
                  </div>
                );
              })}
              {Object.values(ovById).every((o) => !o.openTables) && <div className="adm-empty">No tables open right now.</div>}
              <Link href="/aevinite/floor" className="adm-btn primary adm-dx-cta">Open Live floor →</Link>
            </>
          )}
        </div>
      </aside>
      <style jsx>{`
        .adm-dx-ov { position: fixed; inset: 0; z-index: 80; background: rgba(0,0,0,.42); backdrop-filter: blur(2px); display: flex; justify-content: flex-end; animation: adm-dx-fade .15s ease-out; }
        @keyframes adm-dx-fade { from { opacity: 0; } to { opacity: 1; } }
        .adm-dx { width: min(440px, 100%); height: 100%; background: var(--bg); border-left: var(--border); box-shadow: -16px 0 48px rgba(0,0,0,.32); display: flex; flex-direction: column; animation: adm-dx-slide .2s cubic-bezier(.2,.7,.3,1); }
        @keyframes adm-dx-slide { from { transform: translateX(24px); opacity: .6; } to { transform: translateX(0); opacity: 1; } }
        .adm-dx-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 18px 18px 12px; border-bottom: var(--border); }
        .adm-dx-head h2 { font-size: 16px; font-weight: 800; margin: 0; }
        .adm-dx-x { width: 34px; height: 34px; border-radius: 9px; border: var(--border); background: var(--card); color: var(--text); cursor: pointer; font-size: 15px; }
        .adm-dx-x:hover { filter: brightness(1.06); }
        .adm-dx-body { padding: 12px 16px 22px; overflow-y: auto; flex: 1; }
        .adm-dx-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 11px 4px; border-bottom: var(--border); }
        .adm-dx-row .t { font-size: 14px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .adm-dx-row .s { font-size: 11.5px; color: var(--muted); margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .adm-dx-num { text-align: right; font-size: 17px; font-weight: 800; font-variant-numeric: tabular-nums; flex-shrink: 0; }
        .adm-dx-num span { display: block; font-size: 10px; font-weight: 600; color: var(--muted); }
        .adm-dx-tag.off { font-size: 9.5px; font-weight: 800; padding: 2px 7px; border-radius: 999px; background: rgba(120,120,120,.18); color: var(--muted); vertical-align: middle; }
        .adm-dx-cta { display: block; text-align: center; margin-top: 16px; text-decoration: none; }
      `}</style>
    </div>
  );
}
