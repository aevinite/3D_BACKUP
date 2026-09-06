"use client";
// Admin · Live floor — the WHOLE platform at a glance, "year calendar" style
// (owner 2026-07-04): each restaurant is a block (a "month"), each table a tiny
// coloured cell (a "date"). Colour = kitchen state, ring = unpaid/paid, dot = a
// waiter call. Clicking a restaurant's name quick-opens its manager panel.
//
// 2026-07-06 (owner): this page fetches ONLY on first load and on the manual
// Refresh button — no timer, no realtime (a platform-wide firehose would
// refetch the whole fan-out on every order anywhere; this page is a lookout,
// not an ops screen). The "Updated Xs ago" chip goes amber when the snapshot
// is old so stale data is never mistaken for live. On top: platform totals
// (counts only — the admin panel shows NO earnings, owner 2026-07-03) that
// count up when a fresh snapshot lands; a Sort control orders the restaurant
// blocks; skeletons shimmer while the first snapshot loads.
import { useCallback, useEffect, useRef, useState } from "react";
import Dropdown from "@/components/admin/Dropdown";
import { openRestaurantPanel } from "@/components/admin/shared";
import { useToast } from "@/components/admin/toast";
import { useAdminModal } from "@/components/admin/useAdminModal";
import { SkelList } from "@/components/admin/Skeleton";

type MiniTable = { n: string; s: string; p: string; c: boolean; g?: string };
// Special table types (mig 166): tint + emoji on the mini tile — still money-free.
const TAG_MINI: Record<string, { emoji: string; color: string; label: string }> = {
  vip: { emoji: "👑", color: "#8b5cf6", label: "VIP" },
  family: { emoji: "🏠", color: "#e11d48", label: "Family" },
  guest: { emoji: "🤝", color: "#aab4c4", label: "Owner's guest" },
};
type RestFloor = {
  id: string; name: string; slug: string; active: boolean; tables: MiniTable[];
  ordersToday: number; activeOrders: number; unpaidOrders: number;
  paidToday: number; cancelledToday: number; error: string | null;
};
// A cancelled order, for the Today tab's expandable list (counts/labels only, NO money).
type CancelledRow = { id: string; restaurantName: string; table: string | number | null; kot: number | null; at: string };

// Same palette the manager/tablet legends use, so colours mean ONE thing everywhere.
const STATE_COLOR: Record<string, string> = {
  free: "", seated: "#2dd4bf", new: "#f59e0b", preparing: "#4f9dff", served: "#22c55e", cleared: "#6b6253",
};
const LEGEND: [string, string][] = [
  ["Free", "var(--muted2, rgba(120,120,120,.25))"], ["Seated", "#2dd4bf"], ["New order", "#f59e0b"],
  ["Preparing", "#4f9dff"], ["Served", "#22c55e"], ["Cleared", "#6b6253"],
];

const SORT_KEY = "lfh_admin_floor_sort";
const SORTS = [
  { value: "busy", label: "Busiest first" },
  { value: "active", label: "Most cooking now" },
  { value: "orders", label: "Most orders today" },
  { value: "attention", label: "Needs attention" },
  { value: "name", label: "Name A–Z" },
];

const busyCount = (t: MiniTable[]) => t.filter((x) => x.s !== "free").length;
const callCount = (t: MiniTable[]) => t.filter((x) => x.c).length;
const unpaidTableCount = (t: MiniTable[]) => t.filter((x) => x.p === "red").length;
// "Needs attention" = waiter calls (weigh double — a human is waiting), then
// unpaid bills and orders the kitchen hasn't picked up yet.
const attentionScore = (r: RestFloor) =>
  callCount(r.tables) * 2 + unpaidTableCount(r.tables) + r.tables.filter((x) => x.s === "new").length;

function sortRests(rests: RestFloor[], by: string): RestFloor[] {
  const byName = (a: RestFloor, b: RestFloor) => a.name.localeCompare(b.name);
  const desc = (f: (r: RestFloor) => number) => (a: RestFloor, b: RestFloor) => f(b) - f(a) || byName(a, b);
  const copy = [...rests];
  if (by === "busy") return copy.sort(desc((r) => busyCount(r.tables)));
  if (by === "active") return copy.sort(desc((r) => r.activeOrders));
  if (by === "orders") return copy.sort(desc((r) => r.ordersToday));
  if (by === "attention") return copy.sort(desc(attentionScore));
  return copy.sort(byName);
}

// Count-up: whenever the target number changes (a fresh snapshot landed), roll
// the displayed value from the previous one — the "calculating live" feel the
// owner asked for. Starts from 0 on the very first snapshot.
function useCountUp(target: number, ms = 650) {
  const [shown, setShown] = useState(0);
  const prev = useRef(0);
  useEffect(() => {
    const from = prev.current;
    prev.current = target;
    if (from === target) { setShown(target); return; }
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / ms);
      const eased = 1 - Math.pow(1 - p, 3);
      setShown(Math.round(from + (target - from) * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return shown;
}

function Stat({ icon, label, value, calculating, sub }: {
  icon: string; label: string; value: number; calculating: boolean; sub?: string;
}) {
  const shown = useCountUp(value);
  return (
    <div className={`adm-stat${calculating ? " adm-stat-calc" : ""}`}>
      <div className="ic"><i className={`fas ${icon}`} aria-hidden="true" /></div>
      <div className="k">{label}</div>
      <div className="v">{shown}{sub ? <span className="adm-stat-sub">{sub}</span> : null}</div>
    </div>
  );
}

// Ticks every 10s so "Updated Xs ago" stays honest; amber after 2 minutes.
function UpdatedAgo({ at }: { at: number }) {
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 10000);
    return () => clearInterval(id);
  }, []);
  const s = Math.max(0, Math.floor((Date.now() - at) / 1000));
  const label = s < 15 ? "just now" : s < 60 ? `${s}s ago` : s < 3600 ? `${Math.floor(s / 60)}m ago` : `${Math.floor(s / 3600)}h ago`;
  return (
    <span className={`adm-agochip${s >= 120 ? " old" : ""}`} title="This page only refreshes when you press Refresh">
      <i className="fas fa-clock" aria-hidden="true" /> Updated {label}
    </span>
  );
}

export default function AdminFloor() {
  const toast = useToast();
  // OPENING A RESTAURANT MUST NEVER JUST DO NOTHING (T16 sweep, 2026-08-19).
  //
  // Every restaurant name and every open-table chip on this page is a door into that
  // restaurant's manager panel. They all called openRestaurantPanel and THREW THE HANDLE
  // AWAY — and that helper returns null precisely so a caller can tell the admin when the
  // browser blocked the pop-up (its own comment says so, and the Restaurants page has always
  // obeyed it). With a blocker on, tapping a restaurant here produced nothing at all: no tab,
  // no message, nothing to retry — a dead button, which is the one thing a tap may never be.
  //
  // …AND A BLOCKED TAB IS NOT A LOCKED DOOR (owner, 2026-08-20: "admin has access to everything,
  // so it shouldn't be 'you can't access the restaurant' — it should take you to the restaurant").
  // The first version said "allow pop-ups for this site, then tap again", which reads like a
  // refusal — and the admin can reach every restaurant, always. So a blocked new tab now opens a
  // small card that takes him there instead: the manager panel IN THIS TAB (no pop-up needed at
  // all), or the restaurant's own details page, which is where its owner, settings and access live.
  // `active` travels with it (T16 sweep #7, 2026-08-27): the card offers this restaurant's guest
  // menu, and a SUSPENDED restaurant's menu is offline — sending the admin to a "this menu isn't
  // available right now" page is the same dead end the Restaurants page already disables.
  const [blocked, setBlocked] = useState<{ rid: string; name: string; slug: string; active: boolean } | null>(null);
  const openPanel = useCallback(async (r: { id: string; name: string; slug: string; active: boolean }) => {
    try {
      const w = await openRestaurantPanel(r.id, "/manager");
      if (!w) setBlocked({ rid: r.id, name: r.name, slug: r.slug, active: r.active });
    } catch (e) {
      toast(`Couldn't open ${r.name} — ${e instanceof Error ? e.message : String(e)}`, "err");
    }
  }, [toast]);
  const [rests, setRests] = useState<RestFloor[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [statsErr, setStatsErr] = useState<string | null>(null);
  // If the all-restaurants tiles call fails, say so — otherwise every restaurant would render
  // "no tables" with no warning (the tiles now come from ONE call, migration 145).
  const [tilesErr, setTilesErr] = useState<string | null>(null);
  const [fetching, setFetching] = useState(false);
  // Lazy gate: this platform-wide snapshot is heavy, so it does NOT auto-load on
  // open any more (owner 2026-07-08 — it was fetching every visit and eating load).
  // Nothing is fetched until the admin presses "Load live floor"; after that it only
  // updates on the manual Refresh button. `started` flips true on the first load.
  const [started, setStarted] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [sortBy, setSortBy] = useState("busy");
  const [tab, setTab] = useState<"live" | "today">("live");
  // Cancelled-today list is lazy — fetched only when the section is first opened.
  const [cancelledOpen, setCancelledOpen] = useState(false);
  const [cancelledList, setCancelledList] = useState<CancelledRow[] | null>(null);
  const [cancelledLoading, setCancelledLoading] = useState(false);
  const [cancelledErr, setCancelledErr] = useState<string | null>(null);
  // "Open tables" box at the top of the Live floor (folded in from the old hidden
  // /aevinite/open-tables page, 2026-07-24). Collapsed by default; the occupied list
  // only expands on click. Counts come from the ALREADY-loaded floor snapshot — NO extra
  // fetch, no new query (egress-free; the whole floor is already behind the load gate).
  const [openTablesOpen, setOpenTablesOpen] = useState(false);
  const seq = useRef(0); // latest-wins: a slow old response must never overwrite a newer one

  const load = useCallback(() => {
    const mySeq = ++seq.current;
    setFetching(true);
    fetch("/api/admin/floor?all=1", { cache: "no-store" }).then((r) => r.json()).then((j) => {
      if (mySeq !== seq.current) return;
      setFetching(false);
      if (j.error) setErr(j.error);
      else {
        setErr(null);
        setStatsErr(j.statsError || null);
        setTilesErr(j.tilesError || null);
        setRests(j.restaurants as RestFloor[]);
        setUpdatedAt(j.generatedAt ? new Date(j.generatedAt).getTime() : Date.now());
      }
    }).catch((e) => {
      if (mySeq !== seq.current) return;
      setFetching(false);
      setErr(e instanceof Error ? e.message : String(e));
    });
  }, []);
  // First load is on-demand only (the "Load live floor" button); no fetch on mount.
  const start = useCallback(() => { setStarted(true); load(); }, [load]);

  // When a fresh snapshot lands (Refresh) and the cancelled list is open, reload it too so
  // the drill-down list can't show stale rows next to a freshly-counted "Cancelled today".
  useEffect(() => {
    if (updatedAt !== null && cancelledOpen) loadCancelled();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [updatedAt]);

  // Read the saved sort AFTER mount (not in the initializer) so the server and
  // first client paint agree — avoids a hydration mismatch.
  useEffect(() => {
    try { const s = localStorage.getItem(SORT_KEY); if (s && SORTS.some((o) => o.value === s)) setSortBy(s); } catch {}
  }, []);
  const changeSort = (v: string) => { setSortBy(v); try { localStorage.setItem(SORT_KEY, v); } catch {} };

  // Lazy-load the cancelled-today list (only when the section is opened, or re-opened
  // after a Refresh). Keeps the normal floor snapshot free of this extra read.
  const loadCancelled = useCallback(() => {
    setCancelledLoading(true); setCancelledErr(null);
    fetch("/api/admin/cancelled-today", { cache: "no-store" }).then((r) => r.json()).then((j) => {
      if (j.error) setCancelledErr(j.error);
      else setCancelledList((j.orders as CancelledRow[]) || []);
    }).catch((e) => setCancelledErr(e instanceof Error ? e.message : String(e))).finally(() => setCancelledLoading(false));
  }, []);
  const toggleCancelled = () => {
    const next = !cancelledOpen;
    setCancelledOpen(next);
    if (next && cancelledList === null && !cancelledLoading) loadCancelled();
  };

  const firstLoad = rests === null;
  const sorted = rests ? sortRests(rests, sortBy) : [];

  // Platform totals — all derived from the one snapshot, no extra fetches.
  const tablesTotal = sorted.reduce((s, r) => s + r.tables.length, 0);
  const tablesBusy = sorted.reduce((s, r) => s + busyCount(r.tables), 0);
  const restsLive = sorted.filter((r) => busyCount(r.tables) > 0).length;
  const ordersToday = sorted.reduce((s, r) => s + r.ordersToday, 0);
  const cookingNow = sorted.reduce((s, r) => s + r.activeOrders, 0);
  const unpaidBills = sorted.reduce((s, r) => s + r.unpaidOrders, 0);
  const waiterCalls = sorted.reduce((s, r) => s + callCount(r.tables), 0);
  const paidTodayTotal = sorted.reduce((s, r) => s + r.paidToday, 0);
  const cancelledTotal = sorted.reduce((s, r) => s + r.cancelledToday, 0);

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <h1 className="adm-page-h" style={{ marginBottom: 0 }}>Live floor</h1>
        {started && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            {fetching && (
              <span className="adm-calcchip" role="status">
                <i className="fas fa-circle-notch fa-spin" aria-hidden="true" />
                Calculating live totals<span className="dots" aria-hidden="true"><i>.</i><i>.</i><i>.</i></span>
              </span>
            )}
            {/* Always-visible reminder that this is a manual snapshot, not a live feed. */}
            <span className="adm-snapchip" title="This page does not update on its own — press Refresh to pull a fresh snapshot">
              <i className="fas fa-hand-pointer" aria-hidden="true" /> Manual — press Refresh to update
            </span>
            {!fetching && updatedAt !== null && <UpdatedAgo at={updatedAt} />}
            <Dropdown value={sortBy} onChange={changeSort} options={SORTS} ariaLabel="Sort restaurants" minWidth={182} />
            <button className="adm-btn adm-btn-primary" onClick={load} disabled={fetching}>
              <i className={`fas fa-rotate-right${fetching ? " fa-spin" : ""}`} style={{ marginRight: 7 }} aria-hidden="true" />Refresh
            </button>
          </div>
        )}
      </div>
      {!started ? (
        /* On-demand gate: nothing is fetched until the admin asks for it. */
        <div className="adm-card floor-gate">
          <div className="floor-gate-ic"><i className="fas fa-chair" aria-hidden="true" /></div>
          <h2>See every restaurant&rsquo;s floor</h2>
          <p>
            This is a big platform-wide snapshot (every table of every restaurant), so it
            doesn&rsquo;t load on its own — that keeps the database load down. Press below to
            pull it once. It <b>won&rsquo;t auto-refresh</b>; use the Refresh button to update.
          </p>
          <button className="adm-btn adm-btn-primary floor-gate-btn" onClick={start}>
            <i className="fas fa-bolt" style={{ marginRight: 8 }} aria-hidden="true" />Load live floor
          </button>
        </div>
      ) : (
      <>
      {/* Two views on ONE snapshot: Live (the real-time floor) and Today (day totals,
          bills settled/unpaid, and cancelled orders). Both read the same fetch — the
          Today tab adds no extra load. */}
      <div className="adm-tabs" role="tablist" aria-label="Floor view">
        <button role="tab" aria-selected={tab === "live"} className={tab === "live" ? "active" : ""} onClick={() => setTab("live")}>Live</button>
        <button role="tab" aria-selected={tab === "today"} className={tab === "today" ? "active" : ""} onClick={() => setTab("today")}>Today</button>
      </div>

      {tab === "live" && (
      <>
      <p className="adm-page-sub">
        Every table of every restaurant — colour is the kitchen state, a red ring is an unpaid bill, a dot is a waiter call.
        Numbers are counted fresh each time you press Refresh.
      </p>

      {firstLoad && !err ? (
        <div className="adm-stats">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="adm-stat">
              <div className="adm-skel" style={{ width: 38, height: 38, borderRadius: 11, marginBottom: 12 }} />
              <div className="adm-skel" style={{ width: "62%", height: 11, marginBottom: 8 }} />
              <div className="adm-skel" style={{ width: "40%", height: 22 }} />
            </div>
          ))}
        </div>
      ) : rests ? (
        <div className="adm-stats">
          <Stat icon="fa-store" label="Restaurants live" value={restsLive} sub={` / ${sorted.length}`} calculating={fetching} />
          <Stat icon="fa-chair" label="Tables busy" value={tablesBusy} sub={` / ${tablesTotal}`} calculating={fetching} />
          <Stat icon="fa-receipt" label="Orders today" value={ordersToday} calculating={fetching} />
          <Stat icon="fa-fire-burner" label="Cooking now" value={cookingNow} calculating={fetching} />
          <Stat icon="fa-file-invoice" label="Unpaid bills" value={unpaidBills} calculating={fetching} />
          <Stat icon="fa-bell" label="Waiter calls" value={waiterCalls} calculating={fetching} />
        </div>
      ) : null}

      {rests && (() => {
        const occ = rests.map((r) => ({ r, ts: r.tables.filter((t) => t.s !== "free") })).filter((x) => x.ts.length);
        const total = occ.reduce((s, x) => s + x.ts.length, 0);
        return (
          <div className="adm-card" style={{ marginBottom: 14, padding: 0, overflow: "hidden" }}>
            <button onClick={() => setOpenTablesOpen((o) => !o)} aria-expanded={openTablesOpen}
              style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", background: "transparent", border: 0, color: "var(--text)", cursor: "pointer", font: "inherit", textAlign: "left" }}>
              <i className="fas fa-chair" style={{ color: "var(--accent)" }} aria-hidden="true" />
              <b style={{ fontSize: 14 }}>Open tables</b>
              <span className="adm-muted" style={{ fontSize: 12.5 }}>{total} occupied · {occ.length} restaurant{occ.length === 1 ? "" : "s"}</span>
              <i className={`fas fa-chevron-${openTablesOpen ? "up" : "down"}`} style={{ marginLeft: "auto", opacity: 0.6, fontSize: 12 }} aria-hidden="true" />
            </button>
            {openTablesOpen && (
              <div style={{ borderTop: "var(--border)", padding: "6px 14px 12px" }}>
                {occ.length === 0 ? (
                  <div className="adm-muted" style={{ fontSize: 13, padding: "8px 0" }}>No tables occupied right now.</div>
                ) : occ.map(({ r, ts }) => (
                  <div key={r.id} style={{ padding: "9px 0", borderBottom: "var(--border)" }}>
                    <button onClick={() => openPanel(r)} title={`Open ${r.name}'s manager panel`}
                      style={{ background: "none", border: 0, color: "var(--accent)", fontWeight: 700, fontSize: 13, cursor: "pointer", padding: 0, marginBottom: 7 }}>
                      {r.name} <span className="adm-muted" style={{ fontWeight: 400 }}>· {ts.length} open</span>
                    </button>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {ts.map((t) => (
                        <button key={t.n} onClick={() => openPanel(r)} title={`Table ${t.n} · ${t.s}${t.c ? " · waiter call" : ""}`}
                          style={{ display: "inline-flex", alignItems: "center", gap: 6, border: "var(--border)", borderRadius: 8, padding: "4px 9px", background: "var(--card)", color: "var(--text)", fontSize: 12, cursor: "pointer" }}>
                          <span style={{ width: 8, height: 8, borderRadius: 999, background: STATE_COLOR[t.s] || "var(--muted)" }} aria-hidden="true" />#{t.n}{t.c ? " •" : ""}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })()}

      <div className="adm-card" style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center", padding: "10px 14px", marginBottom: 14, fontSize: 12 }}>
        {LEGEND.map(([label, color]) => (
          <span key={label} style={{ display: "inline-flex", alignItems: "center", gap: 6 }} className="adm-muted">
            <i style={{ width: 11, height: 11, borderRadius: 3, background: color, display: "inline-block" }} aria-hidden="true" />{label}
          </span>
        ))}
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }} className="adm-muted">
          <i style={{ width: 11, height: 11, borderRadius: 3, border: "2px solid #f87171", display: "inline-block", boxSizing: "border-box" }} aria-hidden="true" />Unpaid
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }} className="adm-muted">
          <i style={{ width: 11, height: 11, borderRadius: 3, border: "2px solid #34d399", display: "inline-block", boxSizing: "border-box" }} aria-hidden="true" />Paid
        </span>
        <span className="adm-muted">• = waiter call</span>
      </div>

      {err && <p style={{ color: "var(--adm-danger)" }}>Couldn&apos;t load the floors: {err}</p>}
      {statsErr && (
        <p style={{ color: "#d97706", fontSize: 12.5, fontWeight: 600 }}>
          <i className="fas fa-triangle-exclamation" style={{ marginRight: 6 }} aria-hidden="true" />
          Order counts unavailable ({statsErr}) — the coloured floor below is still live.
        </p>
      )}
      {tilesErr && (
        <p style={{ color: "var(--adm-danger)", fontSize: 12.5, fontWeight: 600 }}>
          <i className="fas fa-triangle-exclamation" style={{ marginRight: 6 }} aria-hidden="true" />
          Live tables unavailable ({tilesErr}) — the floors below may show empty. <button className="adm-btn" style={{ marginLeft: 8, padding: "2px 10px" }} onClick={load}>Retry</button>
        </p>
      )}
      {firstLoad && !err ? (
        <div className="adm-flooryear">
          {Array.from({ length: 6 }, (_, i) => (
            <section key={i} className="adm-card adm-floormonth" aria-hidden="true">
              <header>
                <div className="adm-skel" style={{ width: 130, height: 14 }} />
                <div className="adm-skel" style={{ width: 64, height: 11 }} />
              </header>
              <div className="adm-skel" style={{ width: "88%", height: 10, marginBottom: 9 }} />
              <div className="adm-skel" style={{ width: "100%", height: 74 }} />
            </section>
          ))}
        </div>
      ) : rests ? (
        <div className="adm-flooryear">
          {sorted.map((r) => {
            const calls = callCount(r.tables);
            const unpaidT = unpaidTableCount(r.tables);
            return (
              <section key={r.id} className="adm-card adm-floormonth" aria-label={`${r.name} floor`}>
                <header>
                  <button className="adm-floormonth-name" onClick={() => openPanel(r)}
                    title={`Open ${r.name}'s manager panel (new tab, no password)`}>
                    {r.name}
                  </button>
                  <span className="adm-muted" style={{ fontSize: 11.5, whiteSpace: "nowrap" }}>
                    {r.error ? "floor unavailable" : `${busyCount(r.tables)}/${r.tables.length} busy`}
                    {!r.active && <span style={{ color: "var(--adm-danger)", fontWeight: 700 }}> · suspended</span>}
                  </span>
                </header>
                <div className="adm-floorstats">
                  <span title="Orders placed today"><i className="fas fa-receipt" aria-hidden="true" /> {r.ordersToday} today</span>
                  <span title="Orders the kitchen is on right now"><i className="fas fa-fire-burner" aria-hidden="true" /> {r.activeOrders} cooking</span>
                  {r.unpaidOrders > 0 && <span className="warn" title="Unpaid bills"><i className="fas fa-file-invoice" aria-hidden="true" /> {r.unpaidOrders} unpaid</span>}
                  {calls > 0 && <span className="warn" title="Tables calling a waiter"><i className="fas fa-bell" aria-hidden="true" /> {calls} calling</span>}
                </div>
                {r.error ? (
                  <div className="adm-empty" style={{ padding: 10, fontSize: 12 }}>{r.error}</div>
                ) : r.tables.length === 0 ? (
                  <div className="adm-empty" style={{ padding: 10, fontSize: 12 }}>No tables.</div>
                ) : (
                  <div className="adm-minigrid">
                    {r.tables.map((t) => {
                      const tg = t.g ? TAG_MINI[t.g] : undefined;
                      // A LABEL THAT IS NOT A TABLE NUMBER MUST NOT SMEAR ACROSS ITS NEIGHBOURS
                      // (T16 sweep, 2026-08-19). A tile is a 22px square with an 8.5px font, built
                      // for "1".."300". But the floor's table list is generate_series(1, table_count)
                      // UNION the table_number of every session and order — so an order keyed by
                      // something else (French House carries eight 7-digit ones) arrives as a
                      // "table", and with nothing clipping the tile its digits ran straight over the
                      // tiles beside it: two of that restaurant's four rows rendered as one
                      // unreadable run of numbers. Seen in a 1280×800 screenshot of this page.
                      // Clipped, shortened with a leading ellipsis so it never pretends to be the
                      // whole value, and the full label stays in the tooltip below.
                      const long = String(t.n).length > 3;
                      const face = t.c ? "•" : tg ? tg.emoji : long ? "…" + String(t.n).slice(-2) : t.n;
                      return (
                      <span key={t.n}
                        className="adm-minitile"
                        style={{
                          background: STATE_COLOR[t.s] || "var(--muted2, rgba(120,120,120,.25))",
                          // A tagged table wears its tag colour as the ring; the unpaid-red ring
                          // still wins (money state beats decoration).
                          boxShadow: t.p === "red" ? "inset 0 0 0 2px #f87171" : t.p === "green" ? "inset 0 0 0 2px #34d399" : tg ? `inset 0 0 0 2px ${tg.color}` : undefined,
                          color: t.s === "free" ? "var(--muted)" : "#fff",
                          // Nothing may leave its own square, whatever the label turns out to be.
                          overflow: "hidden",
                          ...(long ? { fontSize: 7 } : null),
                        }}
                        title={`Table ${t.n} — ${t.s}${tg ? ` · ${tg.label}` : ""}${t.p === "red" ? " · UNPAID" : t.p === "green" ? " · paid" : ""}${t.c ? " · waiter called" : ""}`}>
                        {face}
                      </span>
                      );
                    })}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      ) : null}
      </>
      )}

      {tab === "today" && (
        <>
          <p className="adm-page-sub">
            Today so far (since 5am, the business day). Order counts exclude cancelled orders;
            cancelled ones are listed on their own below so nothing is hidden.
          </p>
          {firstLoad && !err ? (
            <div className="adm-stats">
              {Array.from({ length: 4 }, (_, i) => (
                <div key={i} className="adm-stat">
                  <div className="adm-skel" style={{ width: 38, height: 38, borderRadius: 11, marginBottom: 12 }} />
                  <div className="adm-skel" style={{ width: "62%", height: 11, marginBottom: 8 }} />
                  <div className="adm-skel" style={{ width: "40%", height: 22 }} />
                </div>
              ))}
            </div>
          ) : rests ? (
            <>
              <div className="adm-stats">
                <Stat icon="fa-receipt" label="Orders today" value={ordersToday} calculating={fetching} />
                <Stat icon="fa-circle-check" label="Bills settled today" value={paidTodayTotal} calculating={fetching} />
                <Stat icon="fa-file-invoice" label="Unpaid bills now" value={unpaidBills} calculating={fetching} />
                <Stat icon="fa-ban" label="Cancelled today" value={cancelledTotal} calculating={fetching} />
              </div>

              {/* Per-restaurant breakdown — reuses the same snapshot, no extra fetch. */}
              <div className="adm-card" style={{ marginBottom: 14 }}>
                <h2>By restaurant</h2>
                <div className="adm-logwrap">
                  <div className="adm-logrow head" style={{ gridTemplateColumns: "1fr 64px 60px 66px 76px" }}>
                    <span>Restaurant</span>
                    <span style={{ textAlign: "right" }}>Orders</span>
                    <span style={{ textAlign: "right" }}>Paid</span>
                    <span style={{ textAlign: "right" }}>Unpaid</span>
                    <span style={{ textAlign: "right" }}>Cancelled</span>
                  </div>
                  {sorted.map((r) => (
                    <div key={r.id} className="adm-logrow" style={{ gridTemplateColumns: "1fr 64px 60px 66px 76px" }}>
                      <span>
                        <button className="adm-floormonth-name" style={{ fontSize: 13 }} onClick={() => openPanel(r)}
                          title={`Open ${r.name}'s manager panel (new tab, no password)`}>{r.name}</button>
                        {!r.active && <span style={{ color: "var(--adm-danger)", fontWeight: 700, fontSize: 11 }}> · suspended</span>}
                      </span>
                      <span style={{ textAlign: "right", fontWeight: 700 }}>{r.ordersToday}</span>
                      <span style={{ textAlign: "right" }}>{r.paidToday}</span>
                      <span style={{ textAlign: "right", color: r.unpaidOrders > 0 ? "var(--adm-danger)" : undefined, fontWeight: r.unpaidOrders > 0 ? 700 : 400 }}>{r.unpaidOrders}</span>
                      <span style={{ textAlign: "right", color: r.cancelledToday > 0 ? "#d97706" : undefined, fontWeight: r.cancelledToday > 0 ? 700 : 400 }}>{r.cancelledToday}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Cancelled today — lazy, expandable. The list is only fetched when opened. */}
              <div className="adm-card">
                <button className="adm-btn" onClick={toggleCancelled} aria-expanded={cancelledOpen} style={{ width: "100%", justifyContent: "space-between", display: "flex" }}>
                  <span><i className="fas fa-ban" style={{ marginRight: 8, color: "#d97706" }} aria-hidden="true" />Cancelled today ({cancelledTotal})</span>
                  <i className={`fas fa-chevron-${cancelledOpen ? "up" : "down"}`} aria-hidden="true" />
                </button>
                {cancelledOpen && (
                  <div style={{ marginTop: 12 }}>
                    {cancelledLoading ? (
                      <SkelList rows={4} label="Loading floor" />
                    ) : cancelledErr ? (
                      <p style={{ color: "var(--adm-danger)", fontSize: 13 }}>Couldn&apos;t load: {cancelledErr}</p>
                    ) : cancelledList && cancelledList.length > 0 ? (
                      <div className="adm-logwrap">
                        <div className="adm-logrow head" style={{ gridTemplateColumns: "1fr 80px 80px 110px" }}>
                          <span>Restaurant</span><span>Table</span><span>KOT</span><span style={{ textAlign: "right" }}>Cancelled at</span>
                        </div>
                        {cancelledList.map((c) => (
                          <div key={c.id} className="adm-logrow" style={{ gridTemplateColumns: "1fr 80px 80px 110px" }}>
                            <span>{c.restaurantName}</span>
                            <span className="adm-muted">{c.table != null ? `#${c.table}` : "—"}</span>
                            <span className="adm-muted">{c.kot != null ? `#${c.kot}` : "—"}</span>
                            <span style={{ textAlign: "right" }} className="adm-muted">{new Date(c.at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="adm-empty">No orders were cancelled today.</div>
                    )}
                  </div>
                )}
              </div>
            </>
          ) : null}
        </>
      )}
      </>
      )}

      {blocked && <BlockedDoor r={blocked} onClose={() => setBlocked(null)} />}

      <style href="adm-floor" precedence="default">{`
        .floor-gate { text-align: center; padding: 44px 24px; max-width: 560px; margin: 8px auto; }
        .floor-gate-ic { width: 56px; height: 56px; border-radius: 16px; margin: 0 auto 16px; display: grid; place-items: center; font-size: 24px; color: var(--accent); background: color-mix(in srgb, var(--accent) 14%, transparent); }
        .floor-gate h2 { font-size: 18px; font-weight: 800; margin: 0 0 8px; }
        .floor-gate p { color: var(--muted); font-size: 13.5px; line-height: 1.5; margin: 0 auto 20px; max-width: 440px; }
        /* THIS BUTTON ASKED FOR 44px AND GOT 40 (T16 sweep, 2026-08-19). It is the only thing to
           press on an otherwise empty screen, so it was given a 44px floor — but on a phone
           globals.css sets ".adx .adm-btn { min-height: 40px }" inside a media query, which is a
           two-class selector and therefore beats a one-class ".floor-gate-btn". The declaration
           was live, readable and doing nothing; measured 40px on an A35 at 360px. Three classes
           wins it back without touching the platform-wide 40px every other admin button uses. */
        .adx .floor-gate .floor-gate-btn { font-size: 14px; padding: 11px 20px; min-height: 44px; }
        .adm-btn-primary { background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 700; }
        .adm-btn-primary:hover:not(:disabled) { filter: brightness(1.07); }
        /* A NOTE, NOT A WARNING (item 4, sweep #8 T21 — the same call already made on Staff online).
           This pill says "this page doesn't update on its own", which is deliberate and correct, not
           a fault: the page is a lookout, and its own gate card says so twice. It was drawn in the
           console's WARNING colour, so an amber badge sat on the Live floor on every single load, for
           ever. A bar that is always up is how the admin learns to stop reading amber — the reason
           .so-snap on /aevinite/staff-online was changed to neutral grey in sweep #6 (T17 item 11).
           This was the other half of that pair, on the busier screen of the two. Same colours as
           .so-snap, deliberately, so the two "manual" pills read as one idea. */
        .adm-snapchip { display: inline-flex; align-items: center; gap: 6px; font-size: 11.5px; font-weight: 600; padding: 4px 10px; border-radius: 999px; color: var(--muted); background: color-mix(in srgb, var(--text) 7%, transparent); white-space: nowrap; }
      `}</style>
    </>
  );
}

// A blocked new tab, answered the way an admin's screen should answer it: not "you can't get in",
// but two ways in (owner, 2026-08-20). "Open it here" needs no pop-up at all — it is an ordinary
// navigation — so it always works, and the line at the bottom points at the one page that holds
// everything about the restaurant.
function BlockedDoor({ r, onClose }: { r: { rid: string; name: string; slug: string; active: boolean }; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useAdminModal(ref, "adm-floor-blocked", onClose);
  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(2,6,16,0.66)", backdropFilter: "blur(3px)", zIndex: 1000 }} />
      <div style={{ position: "fixed", inset: 0, zIndex: 1001, display: "grid", placeItems: "center", padding: 16, pointerEvents: "none" }}>
        <div ref={ref} role="dialog" aria-modal="true" aria-label={`Open ${r.name}`} className="adm-card"
          style={{ pointerEvents: "auto", width: "min(100%, 460px)", maxHeight: "90dvh", overflowY: "auto" }}>
          <h2 style={{ margin: "0 0 4px", fontSize: 17 }}>Open {r.name}</h2>
          <p className="hint" style={{ margin: "0 0 14px" }}>
            Your browser blocked the new tab — nothing else is in the way. You can open this
            restaurant right here instead.
          </p>
          <div style={{ display: "grid", gap: 8 }}>
            <a className="adm-btn primary" href={`/api/admin/act-as/go?rid=${encodeURIComponent(r.rid)}&to=${encodeURIComponent("/manager")}`}
              style={{ textAlign: "center" }}>
              <i className="fas fa-table-columns" style={{ marginRight: 7 }} aria-hidden="true" />Open its manager panel here
            </a>
            {r.active ? (
              <a className="adm-btn" href={`/r/${r.slug}/menu`} target="_blank" rel="noopener" style={{ textAlign: "center" }}>
                <i className="fas fa-utensils" style={{ marginRight: 7 }} aria-hidden="true" />See its guest menu
              </a>
            ) : (
              <button className="adm-btn" disabled style={{ textAlign: "center" }}
                title="This restaurant is suspended, so its guest menu is offline. Reactivate it in the danger zone on its details page.">
                <i className="fas fa-utensils" style={{ marginRight: 7 }} aria-hidden="true" />Guest menu offline &mdash; it&rsquo;s suspended
              </button>
            )}
          </div>
          <p className="hint" style={{ margin: "14px 0 0", paddingTop: 12, borderTop: "var(--border)" }}>
            Everything about {r.name} — its owner, its bill, its tables, its access and who may sign
            in — is on its own page: <a href={`/aevinite/restaurants?focus=${encodeURIComponent(r.slug)}`}><b>go to its details &amp; settings</b></a>.
          </p>
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
            <button className="adm-btn" onClick={onClose}>Close</button>
          </div>
        </div>
      </div>
    </>
  );
}
