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

type MiniTable = { n: string; s: string; p: string; c: boolean };
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
  ["Preparing", "#4f9dff"], ["Served", "#22c55e"],
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
  const [rests, setRests] = useState<RestFloor[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [statsErr, setStatsErr] = useState<string | null>(null);
  const [fetching, setFetching] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [sortBy, setSortBy] = useState("busy");
  const [tab, setTab] = useState<"live" | "today">("live");
  // Cancelled-today list is lazy — fetched only when the section is first opened.
  const [cancelledOpen, setCancelledOpen] = useState(false);
  const [cancelledList, setCancelledList] = useState<CancelledRow[] | null>(null);
  const [cancelledLoading, setCancelledLoading] = useState(false);
  const [cancelledErr, setCancelledErr] = useState<string | null>(null);
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
        setRests(j.restaurants as RestFloor[]);
        setUpdatedAt(j.generatedAt ? new Date(j.generatedAt).getTime() : Date.now());
      }
    }).catch((e) => {
      if (mySeq !== seq.current) return;
      setFetching(false);
      setErr(e instanceof Error ? e.message : String(e));
    });
  }, []);
  useEffect(() => { load(); }, [load]);

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
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          {fetching && (
            <span className="adm-calcchip" role="status">
              <i className="fas fa-circle-notch fa-spin" aria-hidden="true" />
              Calculating live totals<span className="dots" aria-hidden="true"><i>.</i><i>.</i><i>.</i></span>
            </span>
          )}
          {!fetching && updatedAt !== null && <UpdatedAgo at={updatedAt} />}
          <Dropdown value={sortBy} onChange={changeSort} options={SORTS} ariaLabel="Sort restaurants" minWidth={182} />
          <button className="adm-btn" onClick={load} disabled={fetching}>
            <i className={`fas fa-rotate-right${fetching ? " fa-spin" : ""}`} style={{ marginRight: 7 }} aria-hidden="true" />Refresh
          </button>
        </div>
      </div>
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
                  <button className="adm-floormonth-name" onClick={() => openRestaurantPanel(r.id, "/manager")}
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
                    {r.tables.map((t) => (
                      <span key={t.n}
                        className="adm-minitile"
                        style={{
                          background: STATE_COLOR[t.s] || "var(--muted2, rgba(120,120,120,.25))",
                          boxShadow: t.p === "red" ? "inset 0 0 0 2px #f87171" : t.p === "green" ? "inset 0 0 0 2px #34d399" : undefined,
                          color: t.s === "free" ? "var(--muted)" : "#fff",
                        }}
                        title={`Table ${t.n} — ${t.s}${t.p === "red" ? " · UNPAID" : t.p === "green" ? " · paid" : ""}${t.c ? " · waiter called" : ""}`}>
                        {t.c ? "•" : t.n}
                      </span>
                    ))}
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
                        <button className="adm-floormonth-name" style={{ fontSize: 13 }} onClick={() => openRestaurantPanel(r.id, "/manager")}
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
                      <div className="adm-empty">Loading…</div>
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
  );
}
