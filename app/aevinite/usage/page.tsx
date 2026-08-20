"use client";
// Admin · Usage & cost — which restaurants are busiest / heaviest to serve (order volume,
// active staff, configured tables). Order volume is a PROXY for how much a restaurant costs
// to serve (database reads + bandwidth). No food money here. Data from /api/admin/usage.
//
// ── IT COULD ONLY ANSWER ONE QUESTION (owner, 2026-08-20 — decision 19) ──────────────────────
// It was always 30-day order volume, always biggest first. So "what did last week look like" and
// "who has the most staff" — both a click away from the numbers already on the page — could not be
// asked at all. Two additions, and they cost very differently:
//   · SORTING is free. Ten rows are already in the browser; sorting them is arithmetic, not a
//     query. No extra request, no extra egress, whichever column you pick.
//   · A WINDOW is a query, so it is bounded on the server (mig 347 + the clamp in the route): one
//     aggregate round-trip, at most 400 days, counts computed in the database.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useActiveAutoRefresh } from "@/components/admin/shared";

type Row = { id: string; name: string; slug: string; orders7d: number; orders30d: number; ordersRange: number | null; staff: number; tables: number };
type Data = {
  rows: Row[];
  totals: { orders7d: number; orders30d: number; ordersRange: number | null; staff: number; restaurants: number };
  range: { from: string; to: string } | null;
  generatedAt: string;
};

const nf = (n: number) => (Number(n) || 0).toLocaleString("en-IN");

// The windows worth one tap. "Custom" opens two date boxes; everything else is a preset, because a
// date picker for "last week" is three actions where one will do.
const PRESETS: { key: string; label: string; days: number | null }[] = [
  { key: "default", label: "7 & 30 days", days: null },
  { key: "7", label: "Last 7 days", days: 7 },
  { key: "30", label: "Last 30 days", days: 30 },
  { key: "90", label: "Last 90 days", days: 90 },
];

const dayStr = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const daysAgo = (n: number) => { const d = new Date(); d.setDate(d.getDate() - (n - 1)); return dayStr(d); };
const prettyDay = (s: string) => { try { return new Date(`${s}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }); } catch { return s; } };

// Which column the table is sorted by. `orders` means whichever order column is on screen — the
// range's when a window is chosen, the 30-day one otherwise — so the control means the same thing
// in both modes instead of pointing at a column that isn't there.
type SortKey = "name" | "orders" | "orders7d" | "staff" | "tables";

// A sortable heading is a BUTTON, so it is reachable by keyboard and says out loud what it does —
// a clickable <span> is the thing that looks the same and works for nobody else. Declared at module
// level, not inside the page: a component created during render is a NEW component type every
// render, which throws away its state and its DOM node each time (React 19's static-components rule).
function Th({ k, sort, desc, onSort, children, align }: {
  k: SortKey; sort: SortKey; desc: boolean; onSort: (k: SortKey) => void;
  children: React.ReactNode; align?: "right";
}) {
  const on = sort === k;
  return (
    <button className={`us-th${on ? " on" : ""}`} style={{ justifyContent: align === "right" ? "flex-end" : "flex-start" }}
      onClick={() => onSort(k)} title={`Sort by ${typeof children === "string" ? children : k}`}>
      {children}
      <i className={`fas fa-${on ? (desc ? "arrow-down" : "arrow-up") : "sort"}`} aria-hidden="true" />
    </button>
  );
}

export default function AdminUsage() {
  const [d, setD] = useState<Data | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [preset, setPreset] = useState("default");
  const [from, setFrom] = useState(daysAgo(30));
  const [to, setTo] = useState(dayStr(new Date()));
  const [sort, setSort] = useState<SortKey>("orders");
  const [desc, setDesc] = useState(true);

  // The window the NEXT load will ask for. Derived, so the presets and the two date boxes can't
  // drift apart: choosing "Last 7 days" fills the boxes, and editing a box selects Custom.
  const window_ = preset === "default" ? null
    : preset === "custom" ? { from, to }
    : { from: daysAgo(Number(preset)), to: dayStr(new Date()) };

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const q = window_ ? `?from=${window_.from}&to=${window_.to}` : "";
      const res = await fetch(`/api/admin/usage${q}`, { cache: "no-store" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Couldn't load usage.");
      setD(j);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setLoading(false); }
    // window_ is rebuilt each render from these three, so they are the real dependencies.
  }, [preset, from, to]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);
  useActiveAutoRefresh(load, 60000);

  // Is the answer we are LOOKING at a windowed one? Read from the server's echo, not from local
  // state — otherwise a moment after changing the preset the headings would rename themselves
  // above numbers that are still the old ones.
  const ranged = !!d?.range;
  const orderOf = (r: Row) => (ranged ? (r.ordersRange || 0) : r.orders30d);

  // SORTING IS LOCAL. Every row is already here, so this is arithmetic — no request, no egress,
  // and it works identically in both modes.
  const rows = useMemo(() => {
    const list = [...(d?.rows || [])];
    const dir = desc ? -1 : 1;
    list.sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name) * dir;
      const va = sort === "orders" ? orderOf(a) : sort === "orders7d" ? a.orders7d : sort === "staff" ? a.staff : a.tables;
      const vb = sort === "orders" ? orderOf(b) : sort === "orders7d" ? b.orders7d : sort === "staff" ? b.staff : b.tables;
      // Ties fall back to the name, so the order is stable and a refresh doesn't reshuffle equals.
      return va === vb ? a.name.localeCompare(b.name) : (va - vb) * dir;
    });
    return list;
  }, [d, sort, desc, ranged]); // eslint-disable-line react-hooks/exhaustive-deps

  const max = Math.max(1, ...rows.map(orderOf));
  // "…" MEANS STILL LOADING. After a failed read it never resolves, so the four headline numbers
  // sat on an ellipsis for ever and the page looked like it was still working (T17 sweep,
  // 2026-08-19). A read that failed shows "—" — unknown — with the error line and Retry above it.
  const blank = err ? "—" : "…";
  const rangeLabel = d?.range ? `${prettyDay(d.range.from)} → ${prettyDay(d.range.to)}` : "";
  const STATS: { k: string; v: string | number; hint?: string }[] = ranged
    ? [
        { k: "Orders · this range", v: d ? nf(d.totals.ordersRange || 0) : blank, hint: rangeLabel },
        { k: "Restaurants", v: d ? d.totals.restaurants : blank, hint: "live" },
        { k: "Staff (active)", v: d ? nf(d.totals.staff) : blank, hint: "across all" },
        { k: "Tables", v: d ? nf(rows.reduce((s, r) => s + r.tables, 0)) : blank, hint: "configured" },
      ]
    : [
        { k: "Orders · 30 days", v: d ? nf(d.totals.orders30d) : blank, hint: "all restaurants" },
        { k: "Orders · 7 days", v: d ? nf(d.totals.orders7d) : blank, hint: "all restaurants" },
        { k: "Restaurants", v: d ? d.totals.restaurants : blank, hint: "live" },
        { k: "Staff (active)", v: d ? nf(d.totals.staff) : blank, hint: "across all" },
      ];

  // Pressing the heading already chosen flips the direction; a different one starts at "biggest
  // first" for numbers and A→Z for the name, which is what you meant either way.
  const onSort = (k: SortKey) => {
    if (sort === k) setDesc((v) => !v);
    else { setSort(k); setDesc(k !== "name"); }
  };

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 className="adm-page-h" style={{ marginBottom: 0 }}>Usage &amp; cost</h1>
          <p className="adm-page-sub" style={{ marginTop: 4 }}>Which restaurants are busiest — a proxy for how much each costs you to serve. No earnings shown.</p>
        </div>
        <button className="adm-btn" disabled={loading} onClick={load}>
          <i className={`fas fa-rotate-right${loading ? " fa-spin" : ""}`} style={{ marginRight: 7 }} aria-hidden="true" />Refresh
        </button>
      </div>

      {/* ── Which window ──────────────────────────────────────────────────────────────────────── */}
      <div className="us-range adm-card">
        <i className="fas fa-calendar-days" aria-hidden="true" style={{ opacity: 0.7 }} />
        <span className="adm-muted" style={{ fontSize: 12.5 }}>Show</span>
        {PRESETS.map((p) => (
          <button key={p.key} className={`adm-btn${preset === p.key ? " primary" : ""}`} style={{ fontSize: 12 }} onClick={() => setPreset(p.key)}>{p.label}</button>
        ))}
        <button className={`adm-btn${preset === "custom" ? " primary" : ""}`} style={{ fontSize: 12 }} onClick={() => setPreset("custom")}>Pick dates</button>
        {preset === "custom" && (
          <span className="us-dates">
            <input type="date" value={from} max={to} onChange={(e) => { setFrom(e.target.value); setPreset("custom"); }} aria-label="From date" />
            <span className="adm-muted" style={{ fontSize: 12 }}>to</span>
            <input type="date" value={to} min={from} max={dayStr(new Date())} onChange={(e) => { setTo(e.target.value); setPreset("custom"); }} aria-label="To date" />
          </span>
        )}
      </div>

      {err && <p style={{ color: "var(--adm-danger)", fontSize: 13 }}>{err} <button className="adm-btn" style={{ marginLeft: 8 }} onClick={load}>Retry</button></p>}

      <div className="rev-strip adm-card" style={{ opacity: loading && d ? 0.6 : 1 }}>
        {STATS.map((s) => (
          <div key={s.k} className="cell">
            <span className="k">{s.k}</span>
            <span className="v">{s.v}</span>
            {s.hint && <span className="h">{s.hint}</span>}
          </div>
        ))}
      </div>

      <div className="adm-card">
        <h2 style={{ margin: "0 0 4px" }}>By restaurant</h2>
        <p className="hint" style={{ marginTop: 0 }}>
          {ranged ? <>Orders between <b>{rangeLabel}</b>.</> : <>Order volume over the last 7 and 30 days.</>}{" "}
          The bar shows each restaurant&rsquo;s share of the busiest one. Tap any heading to sort by it.
        </p>
        {!d ? <div className="adm-empty">{err ? "Couldn't load." : "Loading…"}</div> : rows.length === 0 ? (
          <div className="adm-empty">No restaurants yet.</div>
        ) : (
          <div className="adm-logwrap">
            <div className="adm-logrow head us-row" style={{ gridTemplateColumns: ranged ? "1.6fr 1fr 70px 70px" : "1.6fr 80px 1fr 70px 70px" }}>
              <Th k="name" sort={sort} desc={desc} onSort={onSort}>Restaurant</Th>
              {!ranged && <Th k="orders7d" sort={sort} desc={desc} onSort={onSort} align="right">7-day</Th>}
              <Th k="orders" sort={sort} desc={desc} onSort={onSort}>{ranged ? "Orders" : "30-day"}</Th>
              <Th k="staff" sort={sort} desc={desc} onSort={onSort} align="right">Staff</Th>
              <Th k="tables" sort={sort} desc={desc} onSort={onSort} align="right">Tables</Th>
            </div>
            {rows.map((r) => (
              <div key={r.id} className="adm-logrow us-row" style={{ gridTemplateColumns: ranged ? "1.6fr 1fr 70px 70px" : "1.6fr 80px 1fr 70px 70px", alignItems: "center" }}>
                <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</span>
                {!ranged && <span style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }} className="adm-muted">{nf(r.orders7d)}</span>}
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ flex: 1, height: 8, borderRadius: 999, background: "var(--muted2, rgba(255,255,255,.06))", overflow: "hidden" }}>
                    <span style={{ display: "block", height: "100%", width: `${Math.max((orderOf(r) / max) * 100, orderOf(r) > 0 ? 3 : 0)}%`, background: "var(--accent)", borderRadius: 999 }} />
                  </span>
                  <span style={{ width: 52, textAlign: "right", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{nf(orderOf(r))}</span>
                </span>
                <span style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }} className="adm-muted">{r.staff}</span>
                <span style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }} className="adm-muted">{r.tables}</span>
              </div>
            ))}
          </div>
        )}
        <p className="hint" style={{ marginTop: 10, marginBottom: 0 }}>
          <i className="fas fa-circle-info" style={{ marginRight: 6, opacity: 0.7 }} aria-hidden="true" />
          Order volume is the best cheap signal for load. Per-restaurant storage / bandwidth metering would need a usage-events table — a later add.
        </p>
      </div>

      <style href="adm-usage" precedence="default">{`
        .rev-strip { display: flex; flex-wrap: wrap; padding: 0; margin-bottom: 12px; }
        .rev-strip .cell { display: flex; flex-direction: column; gap: 3px; padding: 12px 18px; border-right: var(--border); flex: 1 1 auto; min-width: 150px; }
        .rev-strip .cell:last-child { border-right: 0; }
        .rev-strip .k { font-size: 11.5px; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); font-weight: 600; }
        .rev-strip .v { font-size: 22px; font-weight: 800; font-variant-numeric: tabular-nums; line-height: 1.1; }
        .rev-strip .h { font-size: 11px; color: var(--muted); }

        /* The window picker. One row on a desktop, wrapping on a phone; the date boxes only exist
           once "Pick dates" is chosen, so the default view stays as short as it was. */
        .us-range { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 11px 14px; margin-bottom: 12px; }
        .us-dates { display: inline-flex; align-items: center; gap: 7px; flex-wrap: wrap; }
        .us-dates input { padding: 5px 8px; border-radius: 8px; border: var(--border); background: var(--card); color: var(--text); font: inherit; font-size: 12.5px; min-height: 32px; }

        /* A sortable heading is a BUTTON, so it is reachable by keyboard and says out loud what it
           does — a clickable <span> is the thing that looks the same and works for nobody else. */
        .us-th { display: flex; align-items: center; gap: 6px; width: 100%; background: none; border: 0; padding: 0; margin: 0; font: inherit; color: inherit; cursor: pointer; min-height: 28px; text-align: inherit; }
        .us-th i { font-size: 9px; opacity: .35; }
        .us-th.on { color: var(--accent); }
        .us-th.on i { opacity: 1; }
        .us-th:hover i { opacity: .8; }

        /* ON A PHONE the four numbers took a whole screen and left a stray rule (T17 sweep,
           2026-08-19). Each cell asked for 150px plus 36px of padding, so two would not fit in
           360px and they stacked one per row — 4 numbers, ~380px of scrolling before the table
           they are meant to be read WITH. Worse, a right-hand border on a stacked cell draws a short
           vertical line floating at the right edge of each row. Two per row, and the divider
           follows the direction they actually sit in. */
        @media (max-width: 560px) {
          .rev-strip .cell { flex: 1 1 44%; min-width: 0; padding: 11px 13px; border-right: 0; border-bottom: var(--border); }
          .rev-strip .cell:nth-child(odd) { border-right: var(--border); }
          .rev-strip .cell:nth-last-child(-n+2) { border-bottom: 0; }
          .rev-strip .v { font-size: 20px; }
        }
      `}</style>
    </>
  );
}
