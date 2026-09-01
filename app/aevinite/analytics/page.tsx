"use client";
// Admin · Platform Analytics — cross-restaurant OPERATIONAL analytics. NO food
// revenue anywhere (CLAUDE.md hard rule: restaurant earnings are owner-panel-only).
// Everything here is a COUNT: orders, tables, restaurants, staff. Backed by ONE
// admin API (/api/admin/analytics) that aggregates server-side via the migration
// 119/129 RPCs — never a raw-orders fetch to the client. Refreshed by
// useActiveAutoRefresh (60s, only while visible & in use) + a manual Refresh.
//
// Layout follows the dataviz spec: a KPI row of stat tiles (value + context, no
// redundant tile — total tables lives inside the occupancy meter), one zero-filled
// orders-per-bucket chart (hourly for Today), then busiest restaurants (table +
// inline magnitude bar) beside the source split. Refetches hold the previous
// render at reduced opacity — no skeleton flash.
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { openRestaurantPanel, useActiveAutoRefresh, timeAgo } from "@/components/admin/shared";
import type { TrendPoint } from "@/components/admin/OrdersTrend";
import { labelFor } from "@/lib/timeView";

const OrdersTrend = dynamic(() => import("@/components/admin/OrdersTrend"), {
  ssr: false,
  loading: () => <div className="adm-empty">Loading chart…</div>,
});

type Range = "today" | "7d" | "30d";
type Busiest = { id: string; slug: string; name: string; orders: number; activeTablesNow: number };
type Quiet = { id: string; slug: string; name: string; now: number; before: number; dropPct: number; silent: boolean };
type Data = {
  totals: { totalOrders: number; activeTablesNow: number; activeRestaurants: number; totalRestaurants: number; totalStaff: number; totalTables: number };
  bucket?: "day" | "hour";
  // The snapshot cache stamps every payload (lib/ownerCache) — so the page can say how old the
  // numbers are instead of implying they are live.
  cachedAt?: string;
  cached?: boolean;
  trend: TrendPoint[];
  busiest: Busiest[];
  // null = this window is too short to compare against the one before it (today / a drilled day).
  quiet: Quiet[] | null;
  quietWindowDays: number | null;
  quietMinPerDay: number;
  quietDropPct: number;
  bySource: { source: string; orders: number }[];
};

const SOURCE_LABEL: Record<string, string> = { dine_in: "Dine-in", zomato: "Zomato", swiggy: "Swiggy", takeaway: "Website", parcel: "Parcel", other: "Other" };
const RANGE_LABEL: Record<Range, string> = { today: "Today", "7d": "Last 7 days", "30d": "Last 30 days" };
const nf = new Intl.NumberFormat("en-IN");

// 12-point sparkline for the Orders tile — muted stroke (the tile's value is the
// loud part), no axes; the trend it compresses is the chart right below.
function Spark({ pts }: { pts: number[] }) {
  if (pts.length < 2 || !pts.some((v) => v > 0)) return null;
  const w = 72, h = 26, hi = Math.max(...pts), step = w / (pts.length - 1);
  const d = pts.map((v, i) => `${i ? "L" : "M"}${(i * step).toFixed(1)},${(h - (v / (hi || 1)) * (h - 4) - 2).toFixed(1)}`).join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true" style={{ display: "block" }}>
      <path d={d} fill="none" stroke="var(--muted)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" opacity=".7" />
    </svg>
  );
}

export default function AdminAnalytics() {
  const [range, setRange] = useState<Range>("7d");
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Honor ?range= on first mount so a drill-in (dashboard "Orders today" → ?range=today) opens
  // the right window, not the 7-day default. Done in an effect (not the useState init) to avoid
  // an SSR hydration mismatch (audit 2026-07-08).
  useEffect(() => {
    const r = new URLSearchParams(window.location.search).get("range");
    if (r === "today" || r === "30d") setRange(r);
  }, []);

  // `live` = the ↻ button: ask the server to recompute and wait for it (?refresh=1). A normal open
  // and the 60s backstop take the snapshot, which is one row read.
  // THE DRILL (lib/timeView.ts). When a window's orders are all piled into one day, the chart
  // offers that day hour-by-hour instead of plotting mostly-empty columns. `drillDay` holds the
  // IST date we drilled into; clearing it returns to the whole window. It is ONE extra scoped
  // request (the same RPC, one day, bucketed by hour) and only when the person asks for it —
  // never on load, so a quiet platform costs exactly what it did before.
  const [drillDay, setDrillDay] = useState<string | null>(null);
  // ONLY THE NEWEST ANSWER MAY LAND (T18 sweep, 2026-08-20).
  //
  // Two requests are in flight on an ordinary open: the mount effect runs once with the default
  // 7d and again with the range read out of the address, and a range switch or the 60s backstop can
  // add more. Nothing sequenced them, so whichever REPLY arrived last won — regardless of which
  // range the page was showing. Both are served from the snapshot cache, so which one that is, is a
  // race. Measured before this guard: `/aevinite/analytics?range=30d` opened four times in a row
  // showed 290 / 290 / 290 / 290 under the label "ORDERS · LAST 30 DAYS", when the 30-day answer
  // from the same endpoint was 5,990 — the platform's headline order count wrong by a factor of 20,
  // with the right label and the right tab highlighted over it. (An earlier run gave
  // 6,355 / 291 / 6,355 / 291: it lands on the wrong answer often, not always.) The Dashboard's
  // "Orders today" card links here with ?range=today, so its drill-in had the same coin-flip.
  //
  // A monotonic token, not an AbortController: the request is cheap and may well be serving another
  // tab's cache warm-up, so we let it finish and simply refuse to WRITE a reply that is no longer
  // the one being waited for. `loading` is only cleared by the current attempt, so a slow loser
  // cannot un-dim the page under a request that is still running.
  const reqSeq = useRef(0);
  const load = useCallback(async (r: Range, live = false, day: string | null = null) => {
    const mine = ++reqSeq.current;
    setLoading(true); setErr(null);
    try {
      const q = day ? `day=${encodeURIComponent(day)}` : `range=${r}`;
      const res = await fetch(`/api/admin/analytics?${q}${live ? "&refresh=1" : ""}`, { cache: "no-store" });
      const j = await res.json();
      if (mine !== reqSeq.current) return;             // a newer window is being asked for — drop this
      if (!res.ok) throw new Error(j.error || "Couldn't load analytics.");
      setData(j);
    } catch (e) {
      if (mine !== reqSeq.current) return;
      setErr(e instanceof Error ? e.message : String(e));
    } finally { if (mine === reqSeq.current) setLoading(false); }
  }, []);
  // Changing the range always drops any drill — the drilled day belongs to the window it came from.
  useEffect(() => { setDrillDay(null); load(range); }, [range, load]);
  useActiveAutoRefresh(() => load(range, false, drillDay), 60000);

  const t = data?.totals;
  // WHEN THE NUMBERS NARROW, THE WORDS NARROW WITH THEM (T18 sweep, 2026-08-20).
  //
  // Drilling into a day re-fetches the WHOLE payload for that one day, so `totals`, `busiest` and
  // `bySource` all become one day's — but every label on this page was derived from
  // `RANGE_LABEL[range]`, and `range` never changes when you drill. Measured before this: after
  // "See 18 Aug hour by hour" the tile read "ORDERS · LAST 7 DAYS 73" (73 was that ONE day), the
  // page subtitle still ended "Last 7 days.", both card hints still said "for last 7 days", and the
  // chart heading still said "Orders per day" over an axis reading 12am…9pm. Only one small line
  // inside the chart card admitted what was on screen. Every label now comes from `windowText`,
  // which is the drilled day's own name while a drill is open.
  //
  // `windowLabel` on the chart stays the WHOLE window on purpose — its sentence is
  // "the rest of <the week> had almost nothing", which is about the window, not the day.
  const drillLabel = drillDay ? labelFor(drillDay, "day") : "";
  const windowText = drillDay ? drillLabel : RANGE_LABEL[range].toLowerCase();
  // The grain the SERVER actually bucketed by, not one re-derived from the range — a drill out of a
  // 7-day window comes back hourly, and the heading used to keep saying "per day".
  const grainWord = (data?.bucket || (range === "today" ? "hour" : "day")) === "hour" ? "hour" : "day";
  const occupancy = t && t.totalTables > 0 ? Math.min(1, t.activeTablesNow / t.totalTables) : 0;
  // Sparkline compresses the trend to ≤12 points so a 30-day range doesn't draw 30 segments 6px apart.
  const sparkPts = (() => {
    const tr = data?.trend || [];
    if (tr.length <= 12) return tr.map((p) => p.orders);
    const step = tr.length / 12;
    return Array.from({ length: 12 }, (_, i) => tr.slice(Math.floor(i * step), Math.floor((i + 1) * step)).reduce((s, p) => s + p.orders, 0));
  })();

  // The endpoint returns the top ten; the card lists eight. Say so when there are more, rather than
  // dropping a restaurant silently — this page is where he looks to see who is busy and who is not,
  // and a list that quietly ends is a list he cannot add up (T18 sweep, 2026-08-20).
  const busiestWithOrders = (data?.busiest || []).filter((r) => r.orders > 0);
  const busiestActive = busiestWithOrders.slice(0, 8);
  const busiestMax = Math.max(1, ...busiestActive.map((r) => r.orders));
  // `null` and `[]` mean different things here and must stay apart: null = this window is too short
  // to compare, [] = compared and nobody has gone quiet. `?? null` (not `|| null`) so an empty
  // array survives as an empty array.
  const quiet = data?.quiet ?? null;
  const sources = (data?.bySource || []).filter((s) => s.orders > 0 || s.source === "dine_in");
  const sourceTotal = sources.reduce((s, x) => s + x.orders, 0);
  const maxSource = Math.max(1, ...sources.map((s) => s.orders));

  // A stat tile: icon chip · label · big proportional value · context line.
  // `href`/`onClick` make the tile itself the way into its detail (house rule:
  // no dead stat tiles) — plain <div> only when there is nowhere deeper to go.
  const tile = (opts: { icon: string; label: string; value: React.ReactNode; sub?: React.ReactNode; extra?: React.ReactNode; href?: string; title?: string }) => {
    const inner = (
      <>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
          <span className="ic"><i className={`fas ${opts.icon}`} aria-hidden="true" /></span>
          {opts.extra}
        </div>
        <div className="k">{opts.label}</div>
        <div className="v" style={{ fontVariantNumeric: "normal" }}>{opts.value}</div>
        {opts.sub && <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 3 }}>{opts.sub}</div>}
      </>
    );
    return opts.href ? (
      <a key={opts.label} className="adm-stat" href={opts.href} title={opts.title} style={{ display: "block", color: "inherit", textDecoration: "none", cursor: "pointer" }}>{inner}</a>
    ) : (
      <div key={opts.label} className="adm-stat">{inner}</div>
    );
  };

  return (
    <>
      <h1 className="adm-page-h">Platform analytics</h1>
      <p className="adm-page-sub">Cross-restaurant operational trends — order counts only, never earnings.{" "}
        {drillDay ? `${drillLabel}, hour by hour.` : `${RANGE_LABEL[range]}.`}</p>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 16 }}>
        <div className="adm-tabs">
          {(["today", "7d", "30d"] as Range[]).map((r) => (
            <button key={r} className={range === r ? "active" : ""} onClick={() => setRange(r)}>{RANGE_LABEL[r]}</button>
          ))}
        </div>
        {/* "updated X ago" next to Refresh — the standing rule for anything served from the
            snapshot cache. Without it a cached number looks live, which is the one thing a
            dashboard must never do. */}
        {data?.cachedAt ? (
          <span className="adm-muted" style={{ fontSize: 12 }} title={new Date(data.cachedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}>
            updated {timeAgo(data.cachedAt)}
          </span>
        ) : null}
        {/* REFRESH RE-ASKS FOR WHAT IS ON SCREEN, WHICH MAY BE ONE DAY (T18 sweep #7, item 1).
            This was `load(range, true)` — no third argument, so `day` defaulted to null and the
            reply was the WHOLE WINDOW, while `drillDay` stayed set and every label on the page
            went on naming the drilled day. Measured: drill into 24 Aug (0 orders that day), press
            ↻, and the tile reads "Orders · 24 Aug  1,047" — the week's total under the day's name,
            with both card hints saying "for 24 Aug" and the chart still offering "← Back to the
            whole range". That is exactly the fault the drill-labels fix closed in the T18 sweep of
            2026-08-20, coming back through the one control that fix never touched. The 60s backstop
            three lines below has always passed `drillDay`; this is the same call. */}
        <button className="adm-btn" disabled={loading} onClick={() => load(range, true, drillDay)}>
          <i className={`fas fa-rotate-right${loading ? " fa-spin" : ""}`} style={{ marginRight: 6 }} aria-hidden="true" />Refresh
        </button>
      </div>

      {err && <p style={{ color: "var(--adm-danger)", fontSize: 13 }}>{err}</p>}

      {/* Refetch keeps the frame: previous numbers stay visible, slightly dimmed. */}
      <div style={{ opacity: loading && data ? 0.55 : 1, transition: "opacity .2s" }}>
        <div className="adm-stats" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))" }}>
          {tile({
            icon: "fa-receipt", label: `Orders · ${windowText}`,
            value: t ? nf.format(t.totalOrders) : "…",
            sub: t && t.totalOrders === 0 ? "no orders in this range" : "dine-in, all restaurants",
            extra: <Spark pts={sparkPts} />,
          })}
          {tile({
            icon: "fa-chair", label: "Tables occupied now",
            value: t ? nf.format(t.activeTablesNow) : "…",
            href: "/aevinite/floor", title: "Open the live floor",
            sub: t ? (
              <>
                {/* A PERCENTAGE MUST NOT ROUND ITSELF DOWN TO "NONE" (T18 sweep #7, item 3). The
                    BAR beside this already refuses to disappear — it keeps a 2% sliver whenever a
                    table is occupied — but the words said `Math.round(occupancy * 100)`%, so on
                    this platform the tile read "8" above "of 1,850 tables (0%)": eight tables
                    occupied, nought per cent, with a visible bar under it. Three readings that do
                    not agree. Under half a per cent now says so in words instead of claiming zero,
                    which is the same honesty the sliver was given. */}
                <span>of {nf.format(t.totalTables)} tables ({occupancy > 0 && occupancy * 100 < 0.5 ? "under 1" : Math.round(occupancy * 100)}%)</span>
                <span style={{ display: "block", height: 6, borderRadius: 999, background: "color-mix(in srgb, var(--accent) 16%, transparent)", overflow: "hidden", marginTop: 6 }}>
                  <span style={{ display: "block", height: "100%", width: `${Math.max(occupancy * 100, t.activeTablesNow > 0 ? 2 : 0)}%`, background: "var(--accent)", borderRadius: 999 }} />
                </span>
              </>
            ) : undefined,
          })}
          {tile({
            icon: "fa-store", label: "Active restaurants",
            value: t ? <>{t.activeRestaurants}<span style={{ color: "var(--muted)", fontWeight: 600, fontSize: 17 }}> / {t.totalRestaurants}</span></> : "…",
            href: "/aevinite/restaurants", title: "Manage restaurants",
            sub: t && t.totalRestaurants - t.activeRestaurants > 0 ? `${t.totalRestaurants - t.activeRestaurants} suspended` : "all live",
          })}
          {tile({
            icon: "fa-user-group", label: "Active staff",
            value: t ? nf.format(t.totalStaff) : "…",
            href: "/aevinite/users", title: "Manage users",
            sub: "manager · kitchen · tablet · owner",
          })}
        </div>

        <div className="adm-card" style={{ marginBottom: 14 }}>
          <h2>Orders per {grainWord}</h2>
          <p className="hint">Platform-wide order count for {windowText} — the chart follows the data: a normal spread is plotted, a window whose orders all land on one day offers that day hour by hour, and too little to chart is said in words.</p>
          {data ? <OrdersTrend data={data.trend} bucket={data.bucket || "day"}
            windowLabel={RANGE_LABEL[range].toLowerCase()}
            drilledInto={drillDay}
            onDrill={(d) => { setDrillDay(d); load(range, false, d); }}
            onBack={() => { setDrillDay(null); load(range); }} />
          : <div className="adm-empty">{err ? "Couldn't load — press Refresh." : "Loading…"}</div>}
        </div>

        <div className="adx-grid2col">
          <div className="adm-card" style={{ marginBottom: 14 }}>
            <h2>Busiest restaurants</h2>
            <p className="hint">
              Ranked by order count (not money) for {windowText}.
              {busiestWithOrders.length > busiestActive.length
                ? ` Showing the busiest ${busiestActive.length} of ${busiestWithOrders.length} restaurants that took an order.`
                : ""}
            </p>
            {data === null ? (
              <div className="adm-empty">{err ? "Couldn't load — press Refresh." : "Loading…"}</div>
            ) : busiestActive.length === 0 ? (
              <div className="adm-empty">No orders in this range yet.</div>
            ) : (
              <div className="adm-logwrap">
                <div className="adm-logrow head" style={{ gridTemplateColumns: "1.4fr 70px 80px 1fr" }}>
                  <span>Restaurant</span><span style={{ textAlign: "right" }}>Orders</span><span style={{ textAlign: "right" }}>Open now</span><span />
                </div>
                {busiestActive.map((r) => (
                  <div key={r.id} className="adm-logrow" style={{ gridTemplateColumns: "1.4fr 70px 80px 1fr", alignItems: "center" }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</div>
                      <div style={{ height: 5, borderRadius: 999, background: "color-mix(in srgb, var(--accent) 14%, transparent)", overflow: "hidden", marginTop: 5, maxWidth: 180 }}>
                        <div style={{ height: "100%", width: `${Math.max((r.orders / busiestMax) * 100, 2)}%`, background: "var(--accent)", borderRadius: 999 }} />
                      </div>
                    </div>
                    <div style={{ textAlign: "right", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{nf.format(r.orders)}</div>
                    <div style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }} className="adm-muted">{r.activeTablesNow}</div>
                    <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                      <button className="adm-btn" onClick={() => openRestaurantPanel(r.id, "/editor")} title={`Open ${r.name}'s manager panel`}>
                        <i className="fas fa-arrow-up-right-from-square" style={{ marginRight: 5 }} aria-hidden="true" />Manager
                      </button>
                      <a className="adm-btn" href={`/aevinite/restaurants?focus=${encodeURIComponent(r.slug)}`}>Manage →</a>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="adm-card" style={{ marginBottom: 14 }}>
            <h2>Orders by source</h2>
            <p className="hint">Dine-in vs platform (Zomato / Swiggy / takeaway) order counts for {windowText}.</p>
            {data === null ? (
              <div className="adm-empty">{err ? "Couldn't load — press Refresh." : "Loading…"}</div>
            ) : sourceTotal === 0 ? (
              <div className="adm-empty">No orders in this range yet.</div>
            ) : (
              <div style={{ display: "grid", gap: 12 }}>
                {sources.map((s) => (
                  <div key={s.source}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, marginBottom: 4 }}>
                      <span>{SOURCE_LABEL[s.source] || s.source}</span>
                      <span>
                        <b style={{ fontVariantNumeric: "tabular-nums" }}>{nf.format(s.orders)}</b>
                        <span className="adm-muted" style={{ marginLeft: 6 }}>{sourceTotal > 0 ? Math.round((s.orders / sourceTotal) * 100) : 0}%</span>
                      </span>
                    </div>
                    <div style={{ height: 8, borderRadius: 999, background: "color-mix(in srgb, var(--accent) 14%, transparent)", overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${Math.max((s.orders / maxSource) * 100, s.orders > 0 ? 2 : 0)}%`, background: "var(--accent)", borderRadius: 999 }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── GOING QUIET ─────────────────────────────────────────────────────────────────────
            The card above ranks restaurants against EACH OTHER. This one is the only place on any
            of these screens that compares a restaurant against ITS OWN past — which is the shape of
            a restaurant about to stop paying, and it used to be invisible here. Deliberately below
            the busiest list: it is the thing you act on, but only after you have seen the normal
            picture. Full width, because each row carries a sentence, not just a number. */}
        <div className="adm-card" style={{ marginBottom: 14 }}>
          <h2>Going quiet</h2>
          <p className="hint">
            Restaurants whose own orders have fallen against their previous {data?.quietWindowDays ?? ""} days
            {data ? ` — at least ${data.quietMinPerDay} orders a day before, and down ${data.quietDropPct}% or more` : ""}.
            This is the only list here that compares a restaurant with itself rather than with the others.
          </p>
          {data === null ? (
            <div className="adm-empty">{err ? "Couldn't load — press Refresh." : "Loading…"}</div>
          ) : quiet === null ? (
            // NOT an empty state — a refusal to answer, and it says why. One day against the day
            // before is noise, and a warning that cries wolf is one nobody reads.
            <div className="adm-empty">
              Choose <b>Last 7 days</b> or <b>Last 30 days</b> to see this — one day against the day
              before moves too much to mean anything.
            </div>
          ) : quiet.length === 0 ? (
            <div className="adm-empty">Nobody has gone quiet in {windowText}. Every restaurant is holding its own orders.</div>
          ) : (
            <div className="adm-logwrap">
              <div className="adm-logrow head qt-row">
                <span className="q-name">Restaurant</span>
                <span className="q-before">Before</span>
                <span className="q-now">Now</span>
                <span className="q-chg">Change</span>
                <span className="q-act" />
              </div>
              {quiet.map((r) => (
                <div key={r.id} className="adm-logrow qt-row">
                  <div className="q-name">{r.name}</div>
                  <div className="q-before adm-muted">{nf.format(r.before)}</div>
                  <div className="q-now">{nf.format(r.now)}</div>
                  <div className="q-chg">
                    <span className="hue-ink" style={{ ["--hue" as string]: r.silent ? "#ef4444" : "#f59e0b", fontSize: 11.5, padding: "3px 8px", borderRadius: 6, fontWeight: 700,
                      background: `color-mix(in srgb, ${r.silent ? "#ef4444" : "#f59e0b"} 16%, transparent)`, whiteSpace: "nowrap" }}>
                      {r.silent ? "no orders at all" : `down ${r.dropPct}%`}
                    </span>
                  </div>
                  <div className="q-act">
                    <button className="adm-btn" onClick={() => openRestaurantPanel(r.id, "/editor")} title={`Open ${r.name}'s manager panel`}>
                      <i className="fas fa-arrow-up-right-from-square" style={{ marginRight: 5 }} aria-hidden="true" />Manager
                    </button>
                    <a className="adm-btn" href={`/aevinite/restaurants?focus=${encodeURIComponent(r.slug)}`}>Manage →</a>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
