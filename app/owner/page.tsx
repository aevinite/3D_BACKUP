"use client";
// Owner · Dashboard — MERGED redesign (owner-approved 2026-07-26, spec in memory
// "owner-dashboard-merge-spec"). What changed vs the 2026-07-04 adaptive dashboard:
//   · NO global range tabs — every card carries its OWN small range dropdown
//     ("half the graphs didn't react to the global switch, so it looked broken").
//     Data is cached client-side PER (scope, range): cards sharing a range share one
//     fetch, and switching a card only fetches that range once (egress-safe).
//   · Top row = FIVE KPI cards (Revenue / Orders / Avg order / Today so far / Lost
//     to cancellations) with a sparkline living inside each card — no open-tables card.
//   · Breadcrumb merged into the shell's top strip (Owner › Dashboard › <name>) via
//     the lfh:owner-crumb event — the second heading row is gone.
//   · Single-restaurant view: revenue trend (tooltip shows ₹ AND orders), busy hours,
//     category donut, payment donut (the ONLY payment chart — same-hour + 14-day
//     stacked bars removed), NEW day×hour heatmap (mig 197), records, every-dish list,
//     recent-activity mini feed. Charts are theme-emerald — never the restaurant accent.
//   · Multi-restaurant: 2–3 → Samsung-style stacked daily bars (one bar per day,
//     split by restaurant); every multi tier gets ONE sortable table; a row click
//     slides a summary drawer from the right with "View in full detail" → the
//     restaurant's own dashboard (the owner's 3-phase drill).
//   · Report ▾ (top right): Print / CSV / Excel of what's currently on screen.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { inr, useActiveAutoRefresh } from "@/components/admin/shared";
import { asSuffix } from "@/lib/ownerPin";
import {
  AreaTrend, TimeBar, LeaderBar, HourlyBar, CategoryDonut, PaymentDonut, canonPayMethod,
  DeltaChip, Spark, Heatmap, StackedDailyBars,
} from "@/components/owner/Charts";
import { businessDayStartIso } from "@/lib/businessDay";
import { AnimatedNumber } from "@/components/owner/AnimatedNumber";
import { reportRealtime } from "@/lib/connectionStatus";
import { fetchOwnerOverview } from "@/lib/ownerOverviewCache";
import { useBackClose } from "@/lib/backStack";

const DAY_MS = 86400000;
type Range = "today" | "yesterday" | "7d" | "30d" | "all";
const RANGES: { k: Range; label: string }[] = [
  { k: "today", label: "Today" }, { k: "yesterday", label: "Yesterday" },
  { k: "7d", label: "7 days" }, { k: "30d", label: "30 days" }, { k: "all", label: "All time" },
];
const RANGE_LABEL: Record<Range, string> = {
  today: "today", yesterday: "yesterday", "7d": "last 7 days", "30d": "last 30 days", all: "all time",
};
const PREV_LABEL: Record<Range, string> = {
  today: "vs yesterday (same hours)", yesterday: "vs the day before", "7d": "vs the 7 days before",
  "30d": "vs the 30 days before", all: "",
};
// Theme accent for every single-scope chart (owner 2026-07-26: "it should be green
// everywhere" — Burger Barn's charts were rendering in its brown accent).
const GREEN = "#34d399";
const FALLBACK = GREEN;

type Restaurant = {
  id: string; slug: string; name: string; active: boolean; accentColor: string;
  ordersToday: number; revenueToday: number; ordersAll: number; revenueAll: number; openTables: number;
};
type Overview = { restaurants: Restaurant[]; totals: { revenueToday: number; ordersToday: number; openTables: number; restaurantCount: number }; entitlements?: Record<string, boolean> };
type GroupRev = { id: string; slug: string; name: string; accentColor: string; revenue: number; orders: number };
type TsRow = { bucket: string; restaurantId?: string; revenue: number; orders: number };
type Pay = { method: string; revenue: number; orders: number };
type HeatRow = { dow: number; hr: number; orders: number; revenue: number };
type Prev = { revenue: number; orders: number } | null;
type GroupA = { scope: "group"; restaurantRevenue: GroupRev[]; timeseries: TsRow[]; paymentMethods: Pay[]; heatmap?: HeatRow[]; prev: Prev; cachedAt?: string };
type Dish = { title: string; qty: number; revenue: number };
type Records = {
  bestDay?: { date: string; revenue: number } | null;
  bigBill?: { table: string | null; revenue: number } | null;
  fastHour?: { at: string; orders: number } | null;
  starDish?: { title: string; qty: number } | null;
  regulars?: number | null;
} | null;
type RestA = {
  scope: "restaurant"; prev: Prev;
  restaurant: { id: string; slug: string; name: string; accentColor: string; heroTitle: string };
  kpis: { revenue: number; orders: number; paidOrders?: number; avgOrder: number; openTables: number; topDish: string };
  timeseries: TsRow[]; dishes: Dish[]; categories: { category: string; qty: number; revenue: number }[];
  hourly: { hour: number; orders: number; revenue: number }[]; paymentMethods: Pay[];
  heatmap?: HeatRow[]; records?: Records; cachedAt?: string;
};
type Payload = GroupA | RestA;
type MoneyTotals = { revenue: number; discount: number; cancelledOrders: number; cancelledValue: number; tax: number };
type View = { level: "home" } | { level: "restaurant"; rid: string } | { level: "dish"; rid: string; dish: string };
type Act = { id: string; panel: string; action: string; actor: string | null; table_number: string | null; created_at: string };

// Every card that owns a range dropdown (owner 2026-07-26: per-section ranges).
type CardId = "rev" | "ord" | "avg" | "cancel" | "trend" | "hours" | "cats" | "pay" | "heat" | "dishes" | "table";
const CARD_DEFAULTS: Record<CardId, Range> = {
  rev: "30d", ord: "30d", avg: "30d", cancel: "30d",
  trend: "30d", hours: "30d", cats: "30d", pay: "30d", heat: "30d", dishes: "30d", table: "30d",
};

const IST = "Asia/Kolkata";
// Some RPCs return a zone-LESS IST wall-clock timestamp — see the note in the old
// dashboard (owner audit 2026-07-06): treat zone-less as UTC so numbers print the same
// wherever they're viewed.
function istWall(ts: string, opts: Intl.DateTimeFormatOptions): string {
  const zoneless = /T/.test(ts) && !/[Z+]|[+-]\d\d:?\d\d$/.test(ts);
  const d = new Date(zoneless ? ts + "Z" : ts);
  return d.toLocaleString("en-IN", { ...opts, timeZone: zoneless ? "UTC" : IST });
}
function tsLabel(iso: string, range: Range): string {
  const d = new Date(iso);
  if (range === "today" || range === "yesterday") return d.toLocaleTimeString("en-IN", { hour: "numeric", hour12: true, timeZone: IST });
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: IST });
}
// Stable IST bucket key (hour or day grain) — lines timeseries rows up against the
// COMPLETE expected bucket sequence so no-sales periods show as zeros (2026-07-05).
function istKey(d: Date, range: Range): string {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: IST, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23",
  }).formatToParts(d).map((x) => [x.type, x.value]));
  if (range === "today" || range === "yesterday") return `${p.year}-${p.month}-${p.day} ${p.hour}`;
  return `${p.year}-${p.month}-${p.day}`;
}
function expectedBuckets(range: Range): { key: string; label: string }[] {
  const now = new Date();
  const out: { key: string; label: string }[] = [];
  if (range === "today" || range === "yesterday") {
    // Hour keys aligned to the server's 05:00-IST business day (bug H5) — "today"
    // stops at the current hour so future hours aren't zero-padded.
    const startMs = Date.parse(businessDayStartIso(now)) - (range === "yesterday" ? DAY_MS : 0);
    const endMs = range === "yesterday" ? startMs + DAY_MS - 1 : now.getTime();
    for (let t = startMs; t <= endMs; t += 3600_000) {
      const d = new Date(t);
      out.push({ key: istKey(d, range), label: d.toLocaleTimeString("en-IN", { hour: "numeric", hour12: true, timeZone: IST }) });
    }
  } else if (range === "7d" || range === "30d") {
    const n = range === "7d" ? 7 : 30;
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(now); d.setDate(d.getDate() - i);
      out.push({ key: istKey(d, range), label: d.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: IST }) });
    }
  }
  return out;
}
// Exact-days caption for a range — shown as the dropdown's tooltip.
function rangeSpanText(k: Range): string {
  const now = new Date();
  const f = (d: Date) => d.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: IST });
  if (k === "today") return `Today · ${f(now)}`;
  if (k === "yesterday") return `Yesterday · ${f(new Date(now.getTime() - DAY_MS))}`;
  if (k === "7d") return `${f(new Date(now.getTime() - 6 * DAY_MS))} – ${f(now)} (7 days)`;
  if (k === "30d") return `${f(new Date(now.getTime() - 29 * DAY_MS))} – ${f(now)} (30 days)`;
  return `Everything up to ${f(now)}`;
}
function timeAgo(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr ago`;
  return `${Math.round(h / 24)} d ago`;
}

// ── Per-card range dropdown (the global tab bar's replacement) ────────────────
function RangeDrop({ id, value, onChange, compactBtn }: { id: string; value: Range; onChange: (r: Range) => void; compactBtn?: boolean }) {
  const [open, setOpen] = useState(false);
  // Project rule: every popup registers with the back-stack manager (self-noops closed).
  useBackClose(`owner-rng-${id}`, open, () => setOpen(false));
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!(e.target as HTMLElement | null)?.closest?.(`[data-rng="${id}"]`)) setOpen(false);
    };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [open, id]);
  const cur = RANGES.find((r) => r.k === value)!;
  return (
    <span className="owr" data-rng={id}>
      <button type="button" className={`owr-btn${compactBtn ? " sm" : ""}`} title={rangeSpanText(value)}
        aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {cur.label} <i className="fas fa-chevron-down" aria-hidden="true" />
      </button>
      {open && (
        <span className="owr-pop" role="listbox" aria-label="Range">
          {RANGES.map((r) => (
            <button key={r.k} type="button" role="option" aria-selected={r.k === value}
              className={r.k === value ? "on" : ""}
              onClick={() => { onChange(r.k); setOpen(false); }}>
              {r.label}<small>{rangeSpanText(r.k)}</small>
            </button>
          ))}
        </span>
      )}
      <style jsx>{`
        .owr { position: relative; display: inline-flex; }
        .owr-btn { display: inline-flex; align-items: center; gap: 6px; background: var(--bg); border: var(--border); border-radius: 8px; padding: 5px 10px; font: inherit; font-size: 11.5px; font-weight: 700; color: var(--muted); cursor: pointer; white-space: nowrap; }
        .owr-btn.sm { padding: 3px 8px; font-size: 10.5px; }
        .owr-btn:hover { color: var(--accent); border-color: var(--accent); }
        .owr-btn i { font-size: 9px; opacity: .7; }
        .owr-pop { position: absolute; top: calc(100% + 6px); right: 0; z-index: 40; min-width: 200px; display: flex; flex-direction: column; background: var(--card); border: var(--border); border-radius: 12px; padding: 5px; box-shadow: 0 14px 34px rgba(0,0,0,.35); }
        .owr-pop button { display: flex; flex-direction: column; align-items: flex-start; gap: 1px; background: none; border: none; border-radius: 8px; padding: 7px 10px; font: inherit; font-size: 12.5px; font-weight: 700; color: inherit; cursor: pointer; text-align: left; }
        .owr-pop button:hover { background: color-mix(in srgb, var(--accent) 10%, transparent); }
        .owr-pop button.on { color: var(--accent); }
        .owr-pop button small { font-size: 10px; color: var(--muted); font-weight: 500; }
      `}</style>
    </span>
  );
}

// ── D1-style KPI card: sparkline inside, delta chip, own range dropdown ───────
function Kpi({ id, k, v, money, delta, prevTitle, sub, loading, spark, range, onRange, pill }: {
  id?: string; k: string; v: number | string; money?: boolean; delta?: { now: number; prev: number | null };
  prevTitle?: string; sub?: string; loading?: boolean; spark?: number[]; range?: Range; onRange?: (r: Range) => void;
  pill?: string;
}) {
  return (
    <div className="adm-stat owx-kpi ow2-kpi">
      <div className="ow2-kt">
        <span className="k">{k}</span>
        {range && onRange && id ? <RangeDrop id={id} value={range} onChange={onRange} compactBtn /> :
          pill ? <span className="ow2-live">{pill}</span> : null}
      </div>
      <div className="row">
        <div className="v">{typeof v === "number" ? <AnimatedNumber value={v} loading={loading} money={money} /> : v}</div>
        {!loading && delta && <DeltaChip now={delta.now} prev={delta.prev} title={prevTitle || ""} />}
      </div>
      {sub && !loading && <div className="ow2-sub">{sub}</div>}
      {spark && spark.length >= 2 && !loading && (
        <div className="ow2-spark" aria-hidden="true"><Spark points={spark} color={GREEN} width={150} height={30} /></div>
      )}
      <style jsx>{`
        .ow2-kpi { position: relative; overflow: hidden; }
        .ow2-kt { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
        .ow2-kt .k { font-size: 10.5px; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); font-weight: 800; }
        .ow2-live { font-size: 10px; font-weight: 800; color: ${GREEN}; background: color-mix(in srgb, ${GREEN} 14%, transparent); border-radius: 999px; padding: 2px 8px; }
        .ow2-sub { font-size: 11px; color: var(--muted); margin-top: 2px; }
        .ow2-spark { position: absolute; right: 0; bottom: 0; opacity: .45; pointer-events: none; }
      `}</style>
    </div>
  );
}

// ── Report ▾ — Print / CSV / Excel of what's on screen (owner 2026-07-26) ─────
type ExportTable = { title: string; head: string[]; rows: (string | number)[][] };
function ReportMenu({ tables, filename }: { tables: ExportTable[]; filename: string }) {
  const [open, setOpen] = useState(false);
  useBackClose("owner-report-menu", open, () => setOpen(false));
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!(e.target as HTMLElement | null)?.closest?.(".ow2-report")) setOpen(false);
    };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [open]);
  const download = (blob: Blob, name: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  };
  const esc = (v: string | number) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const asCsv = () => {
    const parts = tables.map((t) => [t.title, t.head.map(esc).join(","), ...t.rows.map((r) => r.map(esc).join(","))].join("\n"));
    // ﻿ BOM so Excel opens the ₹ column as UTF-8, not mojibake.
    download(new Blob(["﻿" + parts.join("\n\n")], { type: "text/csv;charset=utf-8" }), `${filename}.csv`);
  };
  const asExcel = () => {
    // The .xls HTML-table format — opens natively in Excel/Numbers/Sheets, zero deps.
    const html = `<html><head><meta charset="utf-8"></head><body>` + tables.map((t) =>
      `<h3>${t.title}</h3><table border="1"><tr>${t.head.map((h) => `<th>${h}</th>`).join("")}</tr>` +
      t.rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("") + `</table>`).join("<br/>") + `</body></html>`;
    download(new Blob([html], { type: "application/vnd.ms-excel" }), `${filename}.xls`);
  };
  return (
    <span className="ow2-report" style={{ position: "relative", display: "inline-flex" }}>
      <button className="adm-btn" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open}>
        <i className="fas fa-file-export" style={{ marginRight: 6 }} aria-hidden="true" />Report
        <i className="fas fa-chevron-down" style={{ marginLeft: 6, fontSize: 9, opacity: .7 }} aria-hidden="true" />
      </button>
      {open && (
        <span role="menu" style={{ position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 40, minWidth: 190, display: "flex", flexDirection: "column", background: "var(--card)", border: "var(--border)", borderRadius: 12, padding: 5, boxShadow: "0 14px 34px rgba(0,0,0,.35)" }}>
          {[
            { ic: "fa-print", lb: "Print", hint: "printer / save as PDF", fn: () => { setOpen(false); setTimeout(() => window.print(), 60); } },
            { ic: "fa-file-csv", lb: "Download CSV", hint: "opens anywhere", fn: () => { setOpen(false); asCsv(); } },
            { ic: "fa-file-excel", lb: "Download Excel", hint: ".xls for spreadsheets", fn: () => { setOpen(false); asExcel(); } },
          ].map((o) => (
            <button key={o.lb} role="menuitem" onClick={o.fn}
              style={{ display: "flex", alignItems: "center", gap: 10, background: "none", border: "none", borderRadius: 8, padding: "8px 10px", font: "inherit", fontSize: 12.5, fontWeight: 700, color: "inherit", cursor: "pointer", textAlign: "left" }}>
              <i className={`fas ${o.ic}`} style={{ width: 16, color: "var(--accent)" }} aria-hidden="true" />
              <span>{o.lb}<small style={{ display: "block", fontSize: 10, color: "var(--muted)", fontWeight: 500 }}>{o.hint}</small></span>
            </button>
          ))}
        </span>
      )}
    </span>
  );
}

export default function OwnerDashboard() {
  const [view, setView] = useState<View>({ level: "home" });
  const [cr, setCr] = useState<Record<CardId, Range>>(CARD_DEFAULTS);
  const setCardRange = (id: CardId) => (r: Range) => setCr((c) => ({ ...c, [id]: r }));
  const [ov, setOv] = useState<Overview | null>(null);
  // Payload cache — key `${scopeKey}|${range}`; cards sharing a range share ONE fetch,
  // and a range the owner already looked at repaints instantly (session-cached).
  const [cache, setCache] = useState<Record<string, Payload>>({});
  const [moneyCache, setMoneyCache] = useState<Record<string, MoneyTotals | "err">>({});
  const [recs, setRecs] = useState<Record<string, Records>>({});
  const [acts, setActs] = useState<Act[] | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [dishSort, setDishSort] = useState<"revenue" | "qty">("revenue");
  const inflight = useRef<Set<string>>(new Set());
  // Admin tab pin (bug C1): ?rid= rides on EVERY call so a second tab's act-as cookie
  // can never repaint this one under a different restaurant.
  const [scopePin] = useState<string | null>(() =>
    typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("rid"));
  const withPin = (href: string) => (scopePin ? `${href}?rid=${scopePin}${asSuffix()}` : href);
  const scp = scopePin ? `&scope=${scopePin}${asSuffix()}` : "";

  const single = ov?.restaurants.length === 1;
  const homeRid = single ? ov!.restaurants[0].id : null;
  const activeRid = view.level === "home" ? homeRid : (view as { rid: string }).rid;
  const restCount = ov?.restaurants.length ?? 0;
  const scopeKey = activeRid ?? "group";
  const pl = useCallback((range: Range): Payload | undefined => cache[`${scopeKey}|${range}`], [cache, scopeKey]);
  const moneyOf = (range: Range): MoneyTotals | "err" | undefined => moneyCache[`${scopeKey}|${range}`];

  // Sidebar "My restaurants" rows open a restaurant from any page (event / ?focus=).
  useEffect(() => {
    const focus = new URLSearchParams(window.location.search).get("focus");
    if (focus) setView({ level: "restaurant", rid: focus });
    const onOpen = (e: Event) => {
      const rid = (e as CustomEvent).detail?.rid as string | null | undefined;
      setView(rid ? { level: "restaurant", rid } : { level: "home" });
    };
    window.addEventListener("lfh:owner-open-restaurant", onOpen);
    return () => window.removeEventListener("lfh:owner-open-restaurant", onOpen);
  }, []);

  // Merged breadcrumb (owner 2026-07-26): the restaurant/dish tail renders in the
  // SHELL's top strip (Owner › Dashboard › …), not as a second heading row here.
  useEffect(() => {
    const tail: string[] = [];
    if (!single && view.level !== "home") {
      const name = ov?.restaurants.find((r) => r.id === (view as { rid: string }).rid)?.name;
      if (name) tail.push(name);
    }
    if (view.level === "dish") tail.push(view.dish);
    window.dispatchEvent(new CustomEvent("lfh:owner-crumb", { detail: { tail } }));
    return () => { window.dispatchEvent(new CustomEvent("lfh:owner-crumb", { detail: { tail: [] } })); };
  }, [view, ov, single]);

  // ── data layer: fetch one (scope, range) payload if missing ──
  const fetchPayload = useCallback(async (sk: string, range: Range, opts?: { force?: boolean; refresh?: boolean }) => {
    const key = `${sk}|${range}`;
    if (inflight.current.has(key)) return;
    inflight.current.add(key);
    try {
      const rid = sk === "group" ? null : sk;
      // records ride ONCE per restaurant (unbounded scan — not worth re-running per range).
      const recQ = rid && !(rid in ((recsRef.current) || {})) ? "&records=1" : "";
      const refQ = opts?.refresh ? "&refresh=1" : "";
      const a = await fetch(`/api/owner/analytics?range=${range}${rid ? `&rid=${rid}` : ""}&compare=1${recQ}${scp}${refQ}`, { cache: "no-store" }).then((r) => r.json());
      if (a.error) throw new Error(a.error);
      setCache((c) => ({ ...c, [key]: a }));
      if (a.cachedAt) setUpdatedAt(a.cachedAt);
      if (rid && a.records) setRecs((m) => ({ ...m, [rid]: a.records }));
      setErr(null);
      reportRealtime("online");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      reportRealtime("weak");
    } finally {
      inflight.current.delete(key);
    }
  }, [scp]);
  const recsRef = useRef(recs); recsRef.current = recs;

  const fetchMoney = useCallback(async (sk: string, range: Range, opts?: { refresh?: boolean }) => {
    const key = `money:${sk}|${range}`;
    if (inflight.current.has(key)) return;
    inflight.current.add(key);
    try {
      const rid = sk === "group" ? null : sk;
      const refQ = opts?.refresh ? "&refresh=1" : "";
      const m = await fetch(`/api/owner/reports?type=sales&range=${range}${rid ? `&rid=${rid}` : ""}${scp}${refQ}`, { cache: "no-store" }).then((r) => r.json());
      setMoneyCache((c) => ({ ...c, [`${sk}|${range}`]: m.error ? "err" : m.totals }));
      if (m.cachedAt) setUpdatedAt(m.cachedAt);
    } catch {
      setMoneyCache((c) => ({ ...c, [`${sk}|${range}`]: "err" }));
    } finally {
      inflight.current.delete(key);
    }
  }, [scp]);

  // Recent activity mini feed (single/drilled view) — 6 rows, scoped, egress-tiny.
  const fetchActs = useCallback(async (rid: string) => {
    try {
      const j = await fetch(`/api/owner/oplog?limit=6&rid=${rid}${scopePin ? `&scope=${scopePin}${asSuffix()}` : ""}`, { cache: "no-store" }).then((r) => r.json());
      setActs(Array.isArray(j.actions) ? j.actions : null);
    } catch { setActs(null); }
  }, [scopePin]);

  // The distinct (scope, range) keys the CURRENT view's cards need.
  const neededRanges = useMemo(() => {
    const ranges = new Set<Range>([cr.rev, cr.ord, cr.avg, cr.trend]);
    if (scopeKey !== "group") { ranges.add(cr.hours); ranges.add(cr.cats); ranges.add(cr.pay); ranges.add(cr.dishes); }
    ranges.add(cr.heat);
    if (scopeKey === "group") ranges.add(cr.table);
    return Array.from(ranges);
  }, [cr, scopeKey]);

  // Overview first (identity + today-so-far numbers), then ensure every needed payload.
  const loadOverview = useCallback(async () => {
    try {
      const o = (await fetchOwnerOverview(scp)) as Overview;
      if ((o as unknown as { error?: string }).error) throw new Error((o as unknown as { error: string }).error);
      setOv(o);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      reportRealtime("weak");
    }
  }, [scp]);
  useEffect(() => { loadOverview(); }, [loadOverview]);

  useEffect(() => {
    if (!ov) return;
    for (const r of neededRanges) if (!cache[`${scopeKey}|${r}`]) fetchPayload(scopeKey, r);
    if (!moneyCache[`${scopeKey}|${cr.cancel}`]) fetchMoney(scopeKey, cr.cancel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ov, scopeKey, neededRanges, cr.cancel]);

  useEffect(() => { if (activeRid) { setActs(null); fetchActs(activeRid); } }, [activeRid, fetchActs]);

  // Auto-refresh (activity-gated 60s): overview + the payloads in use. Group payloads
  // are compute-on-view cached server-side (mig 196), so this stays cheap.
  const tick = useCallback(() => {
    loadOverview();
    for (const r of neededRanges) fetchPayload(scopeKey, r);
    fetchMoney(scopeKey, cr.cancel);
  }, [loadOverview, fetchPayload, fetchMoney, neededRanges, scopeKey, cr.cancel]);
  const tickRef = useRef(tick); tickRef.current = tick;
  useActiveAutoRefresh(() => tickRef.current(), 60000);

  const [refreshing, setRefreshing] = useState(false);
  const manualRefresh = () => {
    setRefreshing(true);
    const started = Date.now();
    const jobs: Promise<unknown>[] = [loadOverview()];
    for (const r of neededRanges) jobs.push(fetchPayload(scopeKey, r, { refresh: true }));
    jobs.push(fetchMoney(scopeKey, cr.cancel, { refresh: true }));
    if (activeRid) jobs.push(fetchActs(activeRid));
    Promise.allSettled(jobs).finally(() => {
      const wait = Math.max(0, 400 - (Date.now() - started));
      setTimeout(() => setRefreshing(false), wait);
    });
  };

  // ── derived: KPI values from each card's own range ──
  const kpiOf = useCallback((range: Range) => {
    const p = pl(range);
    if (!p) return null;
    if (p.scope === "restaurant") {
      return { revenue: p.kpis.revenue, orders: p.kpis.orders, paidOrders: p.kpis.paidOrders ?? p.kpis.orders, avg: p.kpis.avgOrder, prev: p.prev, ts: p.timeseries };
    }
    const revenue = p.restaurantRevenue.reduce((a, r) => a + r.revenue, 0);
    const orders = p.restaurantRevenue.reduce((a, r) => a + r.orders, 0);
    const paidOrders = p.paymentMethods.reduce((a, m) => a + (m.orders || 0), 0);
    return { revenue, orders, paidOrders, avg: paidOrders ? revenue / paidOrders : 0, prev: p.prev, ts: p.timeseries };
  }, [pl]);

  // Sparkline points (per bucket) for a range — group sums across restaurants.
  const sparkOf = useCallback((range: Range, kind: "revenue" | "orders") => {
    const k = kpiOf(range);
    if (!k) return undefined;
    const by = new Map<string, number>();
    for (const t of k.ts) {
      const key = istKey(new Date(t.bucket), range);
      by.set(key, (by.get(key) || 0) + (kind === "revenue" ? t.revenue : t.orders));
    }
    const exp = expectedBuckets(range);
    const pts = exp.length ? exp.map((e) => by.get(e.key) ?? 0) : Array.from(by.values());
    return pts.length >= 2 ? pts : undefined;
  }, [kpiOf]);

  // Trend rows for the main chart (single scope) — carries __orders for the tooltip.
  const restTrend = useMemo(() => {
    const p = pl(cr.trend);
    if (!p || p.scope !== "restaurant") return [];
    const by = new Map<string, { rev: number; ord: number }>();
    for (const t of p.timeseries) by.set(istKey(new Date(t.bucket), cr.trend), { rev: t.revenue, ord: t.orders });
    const exp = expectedBuckets(cr.trend);
    if (!exp.length) return p.timeseries.map((t) => ({ label: tsLabel(t.bucket, cr.trend), Revenue: t.revenue, __orders: t.orders }));
    return exp.map((e) => ({ label: e.label, Revenue: by.get(e.key)?.rev ?? 0, __orders: by.get(e.key)?.ord ?? 0 }));
  }, [pl, cr.trend]);

  // Group trend (multi): 2–3 restaurants → per-restaurant stacked rows; 4+ → one
  // summed line. Both carry __orders so the hover shows orders too (owner ask).
  const groupTrend = useMemo(() => {
    const p = pl(cr.trend);
    if (!p || p.scope !== "group") return { rows: [] as Record<string, unknown>[], lines: [] as { key: string; name: string; color: string }[], stacked: false };
    const stacked = p.restaurantRevenue.length >= 2 && p.restaurantRevenue.length <= 3;
    const lines = stacked
      ? p.restaurantRevenue.map((r) => ({ key: r.id, name: r.name, color: r.accentColor || FALLBACK }))
      : [{ key: "Revenue", name: "Revenue", color: GREEN }];
    const by = new Map<string, Record<string, number>>();
    for (const t of p.timeseries) {
      const k = istKey(new Date(t.bucket), cr.trend);
      const row = by.get(k) || {};
      if (stacked && t.restaurantId) row[t.restaurantId] = (row[t.restaurantId] || 0) + t.revenue;
      row.Revenue = (row.Revenue || 0) + t.revenue;
      row.__orders = (row.__orders || 0) + t.orders;
      by.set(k, row);
    }
    const exp = expectedBuckets(cr.trend);
    const keys = exp.length ? exp : Array.from(by.keys()).sort().map((k) => ({ key: k, label: k }));
    const rows = keys.map((e) => {
      const found = by.get(e.key) || {};
      const row: Record<string, unknown> = { label: e.label, __orders: found.__orders || 0 };
      for (const l of lines) row[l.key] = found[l.key] || 0;
      return row;
    });
    return { rows, lines, stacked };
  }, [pl, cr.trend]);

  // ── multi-restaurant table (all multi tiers — owner: design #4) ──
  const [tq, setTq] = useState("");
  const [tSort, setTSort] = useState<{ k: "rank" | "name" | "today" | "revenue" | "orders" | "avg" | "openTables"; asc: boolean }>({ k: "revenue", asc: false });
  const tableRows = useMemo(() => {
    if (!ov || single) return [];
    const p = pl(cr.table);
    const revById = new Map((p?.scope === "group" ? p.restaurantRevenue : []).map((r) => [r.id, r]));
    // per-restaurant sparkline from the group timeseries of the table's range
    const sparks = new Map<string, number[]>();
    if (p?.scope === "group") {
      const byRest = new Map<string, Map<string, number>>();
      for (const t of p.timeseries) {
        if (!t.restaurantId) continue;
        const m = byRest.get(t.restaurantId) || new Map<string, number>();
        const k = istKey(new Date(t.bucket), cr.table);
        m.set(k, (m.get(k) || 0) + t.revenue);
        byRest.set(t.restaurantId, m);
      }
      const exp = expectedBuckets(cr.table);
      for (const [rid, m] of byRest) sparks.set(rid, exp.length ? exp.map((e) => m.get(e.key) ?? 0) : Array.from(m.values()));
    }
    const total = Math.max(1, Array.from(revById.values()).reduce((a, r) => a + r.revenue, 0));
    const base = ov.restaurants.map((r) => {
      const g = revById.get(r.id);
      const revenue = g?.revenue ?? 0, orders = g?.orders ?? 0;
      return {
        id: r.id, slug: r.slug, name: r.name, active: r.active, accent: r.accentColor || FALLBACK,
        revenue, orders, avg: orders ? revenue / orders : 0, share: revenue / total,
        openTables: r.openTables, today: r.revenueToday, ordersToday: r.ordersToday,
        revenueAll: r.revenueAll, ordersAll: r.ordersAll, spark: sparks.get(r.id),
      };
    });
    const rank = new Map([...base].sort((a, b) => b.revenue - a.revenue).map((r, i) => [r.id, i + 1]));
    const q = tq.trim().toLowerCase();
    const rows = q ? base.filter((r) => r.name.toLowerCase().includes(q) || r.slug.toLowerCase().includes(q)) : base;
    const dir = tSort.asc ? 1 : -1;
    rows.sort((a, b) => {
      if (tSort.k === "name") return a.name.localeCompare(b.name) * dir;
      if (tSort.k === "rank") return ((rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0)) * dir;
      const key = tSort.k === "today" ? "today" : tSort.k;
      return ((a[key as "revenue"] as number) - (b[key as "revenue"] as number)) * dir;
    });
    return rows.map((r) => ({ ...r, rank: rank.get(r.id)! }));
  }, [ov, single, pl, cr.table, tq, tSort]);
  const th = (k: typeof tSort.k, label: string, left?: boolean) => (
    <th className={left ? "l" : undefined} onClick={() => setTSort((s) => ({ k, asc: s.k === k ? !s.asc : false }))}
      role="columnheader" aria-sort={tSort.k === k ? (tSort.asc ? "ascending" : "descending") : "none"}
      style={{ cursor: "pointer" }}>
      {label} {tSort.k === k && <i className={`fas fa-caret-${tSort.asc ? "up" : "down"}`} aria-hidden="true" />}
    </th>
  );

  // Best / needs-attention callouts (multi) — momentum = 2nd half vs 1st half of the
  // trend range's own series (accurate, zero extra fetches).
  const callouts = useMemo(() => {
    const p = pl(cr.trend);
    if (!p || p.scope !== "group" || p.restaurantRevenue.length < 2) return null;
    const total = p.restaurantRevenue.reduce((a, r) => a + r.revenue, 0);
    const best = p.restaurantRevenue[0];
    const halves = new Map<string, { a: number; b: number }>();
    const buckets = Array.from(new Set(p.timeseries.map((t) => t.bucket))).sort();
    const mid = Math.floor(buckets.length / 2);
    const rankIdx = new Map(buckets.map((b, i) => [b, i]));
    for (const t of p.timeseries) {
      if (!t.restaurantId) continue;
      const h = halves.get(t.restaurantId) || { a: 0, b: 0 };
      if ((rankIdx.get(t.bucket) ?? 0) < mid) h.a += t.revenue; else h.b += t.revenue;
      halves.set(t.restaurantId, h);
    }
    let watch: { name: string; pct: number } | null = null;
    for (const r of p.restaurantRevenue) {
      const h = halves.get(r.id);
      if (!h || h.a <= 0) continue;
      const pct = ((h.b - h.a) / h.a) * 100;
      if (pct < -5 && (!watch || pct < watch.pct)) watch = { name: r.name, pct };
    }
    return { best: best ? { name: best.name, revenue: best.revenue, share: total ? best.revenue / total : 0 } : null, watch };
  }, [pl, cr.trend]);

  // ── plain-language insights (derived from data already on screen) ──
  const insights = useMemo(() => {
    const out: { icon: string; text: string }[] = [];
    const rl = RANGE_LABEL[cr.trend];
    const p = pl(cr.trend);
    const money = moneyOf(cr.cancel);
    if (p?.scope === "restaurant") {
      const k = p.kpis;
      if (p.prev && p.prev.revenue > 0 && k.revenue > 0) {
        const pct = Math.round(((k.revenue - p.prev.revenue) / p.prev.revenue) * 100);
        if (pct >= 300) out.push({ icon: "fa-arrow-trend-up", text: `Revenue is ${Math.round(k.revenue / p.prev.revenue)}× the period before` });
        else if (Math.abs(pct) >= 3) out.push({ icon: pct > 0 ? "fa-arrow-trend-up" : "fa-arrow-trend-down", text: `Revenue is ${pct > 0 ? "up" : "down"} ${Math.abs(pct)}% ${PREV_LABEL[cr.trend]}` });
      }
      const busiest = [...p.hourly].sort((a, b) => b.orders - a.orders)[0];
      if (busiest?.orders) out.push({ icon: "fa-clock", text: `Busiest at ${busiest.hour}:00 — ${busiest.orders} order${busiest.orders === 1 ? "" : "s"}` });
      const total = p.dishes.reduce((a, d) => a + d.revenue, 0);
      if (p.dishes[0] && total > 0) out.push({ icon: "fa-utensils", text: `${p.dishes[0].title} makes ${Math.round((p.dishes[0].revenue / total) * 100)}% of dish revenue` });
      if (money && money !== "err" && money.cancelledValue > 0) out.push({ icon: "fa-ban", text: `${inr(money.cancelledValue)} lost to ${money.cancelledOrders} cancelled order${money.cancelledOrders === 1 ? "" : "s"} ${RANGE_LABEL[cr.cancel]}` });
      const payRows = (p.paymentMethods ?? []).map((x) => ({ ...x, method: canonPayMethod(x.method) }));
      const pay = payRows.filter((x) => x.method !== "Not recorded").sort((a, b) => b.revenue - a.revenue)[0];
      const payTotal = payRows.reduce((a, x) => a + x.revenue, 0);
      if (pay && payTotal > 0 && pay.revenue / payTotal >= 0.15)
        out.push({ icon: "fa-wallet", text: `${pay.method} is ${Math.round((pay.revenue / payTotal) * 100)}% of payments` });
    } else if (p?.scope === "group") {
      const total = p.restaurantRevenue.reduce((a, r) => a + r.revenue, 0);
      if (p.prev && p.prev.revenue > 0 && total > 0) {
        const pct = Math.round(((total - p.prev.revenue) / p.prev.revenue) * 100);
        if (pct >= 300) out.push({ icon: "fa-arrow-trend-up", text: `Group revenue is ${Math.round(total / p.prev.revenue)}× the period before` });
        else if (Math.abs(pct) >= 3) out.push({ icon: pct > 0 ? "fa-arrow-trend-up" : "fa-arrow-trend-down", text: `Group revenue is ${pct > 0 ? "up" : "down"} ${Math.abs(pct)}% ${PREV_LABEL[cr.trend]}` });
      }
      const top = p.restaurantRevenue[0];
      if (top && total > 0 && p.restaurantRevenue.length > 1)
        out.push({ icon: "fa-trophy", text: `${top.name} leads with ${Math.round((top.revenue / total) * 100)}% of revenue ${rl}` });
      if (money && money !== "err" && money.cancelledValue > 0) out.push({ icon: "fa-ban", text: `${inr(money.cancelledValue)} lost to cancellations ${RANGE_LABEL[cr.cancel]}` });
      if (money && money !== "err" && money.discount > 0 && total > 0) out.push({ icon: "fa-tag", text: `${inr(money.discount)} given as discounts` });
    }
    return out.slice(0, 4);
  }, [pl, cr.trend, cr.cancel, moneyCache, scopeKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const dishView = useMemo(() => {
    if (view.level !== "dish") return null;
    const p = pl(cr.dishes);
    if (!p || p.scope !== "restaurant" || p.restaurant.id !== view.rid) return "loading" as const;
    const total = p.dishes.reduce((a, d) => a + d.revenue, 0) || 1;
    const idx = p.dishes.findIndex((d) => d.title === view.dish);
    const d = p.dishes[idx];
    return d ? { d, rank: idx + 1, share: Math.round((d.revenue / total) * 100), of: p.dishes.length, dishes: p.dishes } : ("missing" as const);
  }, [view, pl, cr.dishes]);

  // ── drawer (multi): row click → summary from data ALREADY loaded (zero fetches) ──
  const [drawerRid, setDrawerRid] = useState<string | null>(null);
  useBackClose("owner-rest-drawer", !!drawerRid, () => setDrawerRid(null));
  const drawer = useMemo(() => {
    if (!drawerRid || !ov) return null;
    const r = ov.restaurants.find((x) => x.id === drawerRid);
    if (!r) return null;
    const row = tableRows.find((x) => x.id === drawerRid);
    return { r, row };
  }, [drawerRid, ov, tableRows]);

  // ── Report export tables for the current view ──
  const exportTables = useMemo((): ExportTable[] => {
    const out: ExportTable[] = [];
    const p = pl(cr.trend);
    if (!single && view.level === "home") {
      out.push({
        title: `Restaurants · ${RANGE_LABEL[cr.table]}`,
        head: ["#", "Restaurant", "Revenue", "Orders", "Avg check", "Today", "Open tables", "Status"],
        rows: tableRows.map((r) => [r.rank, r.name, Math.round(r.revenue), r.orders, Math.round(r.avg), Math.round(r.today), r.openTables, r.active ? "Active" : "Off"]),
      });
    }
    if (p) {
      const rows = (p.scope === "restaurant" ? restTrend : groupTrend.rows).map((r) => [String(r.label), Math.round(Number(r.Revenue) || 0), Number(r.__orders) || 0]);
      out.push({ title: `Revenue over time · ${RANGE_LABEL[cr.trend]}`, head: ["Bucket", "Revenue", "Orders"], rows });
    }
    if (p?.scope === "restaurant") {
      out.push({ title: `Dishes · ${RANGE_LABEL[cr.dishes]}`, head: ["Dish", "Qty", "Revenue"], rows: (pl(cr.dishes) as RestA | undefined)?.dishes?.map((d) => [d.title, d.qty, Math.round(d.revenue)]) ?? [] });
      out.push({ title: `Payments · ${RANGE_LABEL[cr.pay]}`, head: ["Method", "Bills", "Revenue"], rows: ((pl(cr.pay) as RestA | undefined)?.paymentMethods ?? []).map((m) => [canonPayMethod(m.method), m.orders, Math.round(m.revenue)]) });
    }
    return out;
  }, [pl, cr, single, view.level, tableRows, restTrend, groupTrend]);
  const exportName = `aevidine-dashboard-${new Date().toISOString().slice(0, 10)}`;

  const goHome = () => setView({ level: "home" });
  const openFull = (rid: string) => { setDrawerRid(null); setView({ level: "restaurant", rid }); };

  // Today-so-far numbers (from the overview — no extra call).
  const todayRow = activeRid ? ov?.restaurants.find((r) => r.id === activeRid) : null;
  const todayRev = activeRid ? (todayRow?.revenueToday ?? 0) : (ov?.totals.revenueToday ?? 0);
  const todayOrd = activeRid ? (todayRow?.ordersToday ?? 0) : (ov?.totals.ordersToday ?? 0);

  const kRev = kpiOf(cr.rev), kOrd = kpiOf(cr.ord), kAvg = kpiOf(cr.avg);
  const money = moneyOf(cr.cancel);
  const trendPayload = pl(cr.trend);
  const records = activeRid ? recs[activeRid] : null;

  const kpiRow = (
    <div className="adm-stats ow2-stats">
      <Kpi id="rev" k="Revenue" v={kRev?.revenue ?? 0} money loading={!kRev}
        range={cr.rev} onRange={setCardRange("rev")}
        delta={kRev?.prev ? { now: kRev.revenue, prev: kRev.prev.revenue } : undefined}
        prevTitle={PREV_LABEL[cr.rev]} sub={PREV_LABEL[cr.rev] || "whole history"} spark={sparkOf(cr.rev, "revenue")} />
      <Kpi id="ord" k="Orders" v={kOrd?.orders ?? 0} loading={!kOrd}
        range={cr.ord} onRange={setCardRange("ord")}
        sub={kOrd && kOrd.paidOrders !== kOrd.orders ? `${kOrd.paidOrders} paid · rest still open` : PREV_LABEL[cr.ord] || "whole history"}
        delta={kOrd?.prev ? { now: kOrd.orders, prev: kOrd.prev.orders } : undefined}
        prevTitle={PREV_LABEL[cr.ord]} spark={sparkOf(cr.ord, "orders")} />
      <Kpi id="avg" k="Avg order" v={kAvg?.avg ?? 0} money loading={!kAvg}
        range={cr.avg} onRange={setCardRange("avg")} sub="per paid order" />
      <Kpi k="Today so far" v={todayRev} money loading={!ov} pill="● live"
        sub={`${todayOrd} order${todayOrd === 1 ? "" : "s"} today`} />
      <Kpi id="cancel" k="Lost to cancellations" v={money === "err" ? "—" : ((money as MoneyTotals | undefined)?.cancelledValue ?? 0)} money
        loading={!money} range={cr.cancel} onRange={setCardRange("cancel")}
        sub={money === "err" ? "couldn't total for this range" : ((money as MoneyTotals | undefined)?.cancelledOrders ? `${(money as MoneyTotals).cancelledOrders} order${(money as MoneyTotals).cancelledOrders === 1 ? "" : "s"}` : "none — great")} />
    </div>
  );

  return (
    <>
      {/* Toolbar — Report ▾ + Refresh (the global range tabs are GONE by design) */}
      <div className="ow2-bar">
        {!single && view.level !== "home" ? (
          <button className="ow2-back" onClick={goHome}><i className="fas fa-arrow-left" aria-hidden="true" /> All restaurants</button>
        ) : <span className="ow2-title">{single ? "Dashboard" : `Your ${restCount || "…"} restaurant${restCount === 1 ? "" : "s"}`}</span>}
        <div className="ow2-tools">
          <ReportMenu tables={exportTables} filename={exportName} />
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
            <button className="adm-btn" onClick={manualRefresh} disabled={refreshing} title="Refresh now — recomputes the live numbers">
              <i className={`fas fa-rotate-right${refreshing ? " fa-spin" : ""}`} style={{ marginRight: 6 }} aria-hidden="true" />Refresh
            </button>
            {updatedAt && !refreshing && <span style={{ fontSize: 10.5, color: "var(--muted)" }}>updated {timeAgo(updatedAt)}</span>}
          </div>
        </div>
      </div>

      {err && <div className="adm-card" style={{ borderColor: "var(--adm-danger)", marginBottom: 16 }}><b>Couldn&apos;t load.</b> <span className="adm-muted" style={{ fontSize: 12.5 }}>{err}</span></div>}

      {/* Insight strip — the panel talks like a person, not a spreadsheet */}
      {insights.length > 0 && view.level !== "dish" && (
        <div className="owx-insights">
          {insights.map((ins, i) => (
            <span key={i} className="owx-insight"><i className={`fas ${ins.icon}`} aria-hidden="true" />{ins.text}</span>
          ))}
        </div>
      )}

      {/* ═══════ HOME · MULTI ═══════ */}
      {view.level === "home" && !single && (
        <>
          {kpiRow}

          {/* Best / needs-attention callouts (surprise add — from data already loaded) */}
          {callouts && (callouts.best || callouts.watch) && (
            <div className="ow2-callouts">
              {callouts.best && (
                <div className="ow2-co good">
                  <span className="ic">🏆</span>
                  <span><small>Top performer · {RANGE_LABEL[cr.trend]}</small><b>{callouts.best.name}</b>
                    <i>{inr(callouts.best.revenue)} · {Math.round(callouts.best.share * 100)}% of revenue</i></span>
                </div>
              )}
              {callouts.watch && (
                <div className="ow2-co warn">
                  <span className="ic">⚠️</span>
                  <span><small>Needs attention</small><b>{callouts.watch.name}</b>
                    <i>trending {Math.round(callouts.watch.pct)}% inside this period</i></span>
                </div>
              )}
            </div>
          )}

          {/* Group revenue — 2–3 restaurants: Samsung-style stacked daily bars ·
              4+: one summed line. Tooltip carries orders. */}
          <div className="adm-card" style={{ marginBottom: 12 }}>
            <div className="ow2-ct">
              <span>Revenue over time <span className="mut">· {cr.trend === "today" || cr.trend === "yesterday" ? "by hour" : "by day"}{groupTrend.stacked ? " · each bar split by restaurant" : ""}</span></span>
              <RangeDrop id="trend" value={cr.trend} onChange={setCardRange("trend")} />
            </div>
            {!trendPayload ? <div className="adm-empty">Loading…</div>
              : groupTrend.stacked
                ? <StackedDailyBars data={groupTrend.rows} lines={groupTrend.lines} />
                : <AreaTrend data={groupTrend.rows} lines={groupTrend.lines} />}
          </div>

          {/* THE table (design #4) — every multi tier. Click a row → side drawer. */}
          <div className="adm-card" style={{ padding: 0, overflow: "hidden", marginBottom: 12 }}>
            <div className="hq-bar">
              <span className="hq-search">
                <i className="fas fa-magnifying-glass" aria-hidden="true" />
                <input value={tq} onChange={(e) => setTq(e.target.value)} placeholder={`Search ${restCount} restaurants…`} aria-label="Search restaurants" />
                {tq && <button className="hq-x" onClick={() => setTq("")} aria-label="Clear search">×</button>}
              </span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 11.5, color: "var(--muted)", fontWeight: 600 }}>
                Revenue window <RangeDrop id="table" value={cr.table} onChange={setCardRange("table")} compactBtn />
              </span>
            </div>
            <div className="hq-scroll">
              <table className="hq-table ow2-table">
                <thead><tr>
                  {th("rank", "#", true)}
                  {th("name", "Restaurant", true)}
                  {th("today", "Today")}
                  {th("revenue", `Revenue (${RANGE_LABEL[cr.table]})`)}
                  {th("orders", "Orders")}
                  {th("avg", "Avg check")}
                  <th className="hide-m">Trend</th>
                  <th className="hide-m">Share</th>
                  {th("openTables", "Open")}
                  <th aria-hidden="true" />
                </tr></thead>
                <tbody>
                  {tableRows.length === 0 && (
                    <tr><td colSpan={10} className="hq-empty">{ov ? "No restaurant matches that search." : "Loading…"}</td></tr>
                  )}
                  {tableRows.map((r) => (
                    <tr key={r.id} className="hq-row" onClick={() => setDrawerRid(r.id)}
                      tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter") setDrawerRid(r.id); }}>
                      <td className="rk l">{r.rank}</td>
                      <td className="l"><span className="hq-nm"><span className="sw" style={{ background: r.accent }} aria-hidden="true" />{r.name}</span></td>
                      <td className="mut"><AnimatedNumber value={r.today} money /></td>
                      <td><b><AnimatedNumber value={r.revenue} money /></b></td>
                      <td className="mut"><AnimatedNumber value={r.orders} /></td>
                      <td className="mut"><AnimatedNumber value={r.avg} money /></td>
                      <td className="hide-m">{r.spark && r.spark.length >= 2 ? <Spark points={r.spark} color={r.accent} width={84} height={22} /> : <span className="mut">—</span>}</td>
                      <td className="hide-m"><span className="hq-meter" aria-hidden="true"><span style={{ width: `${Math.round(r.share * 100)}%`, background: r.accent }} /></span><span style={{ fontSize: 11 }}>{Math.round(r.share * 100)}%</span></td>
                      <td className="mut"><AnimatedNumber value={r.openTables} /></td>
                      <td className="go"><i className="fas fa-chevron-right" aria-hidden="true" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Heatmap + payments, side by side (group scope) */}
          <div className="ow2-two">
            <div className="adm-card">
              <div className="ow2-ct"><span>Busy heatmap <span className="mut">· orders by day × hour</span></span><RangeDrop id="heat" value={cr.heat} onChange={setCardRange("heat")} /></div>
              {(pl(cr.heat) as GroupA | undefined)?.heatmap
                ? <Heatmap data={(pl(cr.heat) as GroupA).heatmap!} accent={GREEN} />
                : <div className="adm-empty">Loading…</div>}
            </div>
            <div className="adm-card">
              <div className="ow2-ct"><span>Payment methods <span className="mut">· how customers paid</span></span><RangeDrop id="pay" value={cr.pay} onChange={setCardRange("pay")} /></div>
              {(pl(cr.pay) as GroupA | undefined)?.paymentMethods
                ? <PaymentDonut data={(pl(cr.pay) as GroupA).paymentMethods} />
                : <div className="adm-empty">Loading…</div>}
            </div>
          </div>
        </>
      )}

      {/* ═══════ SINGLE-OWNER HERO — identity + one-tap jumps ═══════ */}
      {view.level === "home" && single && ov && (
        <div className="own-hero" style={{ ["--rcol" as string]: GREEN }}>
          <div className="own-hero-id">
            <div className="own-hero-name">{ov.restaurants[0].name}</div>
            <div className="own-hero-sub">
              <span className={`own-pill ${ov.restaurants[0].active ? "on" : "off"}`}>{ov.restaurants[0].active ? "Active" : "Off"}</span>
              <span className="mono">{ov.restaurants[0].slug}</span>
              <span className="live"><i className="fas fa-chair" aria-hidden="true" /> {ov.restaurants[0].openTables} table{ov.restaurants[0].openTables === 1 ? "" : "s"} open now</span>
            </div>
          </div>
          <div className="own-hero-links">
            {ov.entitlements?.reports !== false && <Link href={withPin("/owner/reports")} className="own-hero-link"><i className="fas fa-file-invoice" aria-hidden="true" /> Reports</Link>}
            {ov.entitlements?.staff !== false && <Link href={withPin("/owner/staff")} className="own-hero-link"><i className="fas fa-users-gear" aria-hidden="true" /> Staff &amp; powers</Link>}
            {ov.entitlements?.issues !== false && <Link href={withPin("/owner/issues")} className="own-hero-link"><i className="fas fa-triangle-exclamation" aria-hidden="true" /> Feedback</Link>}
          </div>
        </div>
      )}

      {/* ═══════ RESTAURANT (drill-down, or HOME when there's only one) ═══════ */}
      {((view.level === "home" && single) || view.level === "restaurant") && activeRid && (
        <>
          {kpiRow}
          <div className="adm-card" style={{ marginBottom: 12 }}>
            <div className="ow2-ct">
              <span>Revenue over time <span className="mut">· {cr.trend === "today" || cr.trend === "yesterday" ? "by hour" : "by day"}</span></span>
              <RangeDrop id="trend" value={cr.trend} onChange={setCardRange("trend")} />
            </div>
            {!trendPayload || trendPayload.scope !== "restaurant" ? <div className="adm-empty">Loading…</div>
              : restTrend.length >= 9
                ? <AreaTrend data={restTrend} lines={[{ key: "Revenue", name: "Revenue", color: GREEN }]} />
                : <TimeBar data={restTrend.map((r) => ({ label: String(r.label), revenue: Number(r.Revenue) || 0, __orders: Number(r.__orders) || 0 })) as { label: string; revenue: number }[]} color={GREEN} />}
          </div>

          <div className="ow2-two">
            <div className="adm-card">
              <div className="ow2-ct"><span>Busy hours <span className="mut">· orders by hour</span></span><RangeDrop id="hours" value={cr.hours} onChange={setCardRange("hours")} /></div>
              {(pl(cr.hours) as RestA | undefined)?.hourly
                ? <HourlyBar data={(pl(cr.hours) as RestA).hourly} color={GREEN} />
                : <div className="adm-empty">Loading…</div>}
            </div>
            <div className="adm-card">
              <div className="ow2-ct"><span>Revenue by category</span><RangeDrop id="cats" value={cr.cats} onChange={setCardRange("cats")} /></div>
              {(pl(cr.cats) as RestA | undefined)?.categories
                ? <CategoryDonut data={(pl(cr.cats) as RestA).categories} />
                : <div className="adm-empty">Loading…</div>}
            </div>
          </div>

          <div className="ow2-two" style={{ marginTop: 12 }}>
            <div className="adm-card">
              <div className="ow2-ct"><span>Busy heatmap <span className="mut">· orders by day × hour</span></span><RangeDrop id="heat" value={cr.heat} onChange={setCardRange("heat")} /></div>
              {(pl(cr.heat) as RestA | undefined)?.heatmap
                ? <Heatmap data={(pl(cr.heat) as RestA).heatmap!} accent={GREEN} />
                : <div className="adm-empty">Loading…</div>}
            </div>
            <div className="adm-card">
              <div className="ow2-ct"><span>Payment methods <span className="mut">· how customers paid</span></span><RangeDrop id="pay" value={cr.pay} onChange={setCardRange("pay")} /></div>
              {(pl(cr.pay) as RestA | undefined)?.paymentMethods && ((pl(cr.pay) as RestA).paymentMethods.reduce((a, m) => a + m.revenue, 0) > 0)
                ? <PaymentDonut data={(pl(cr.pay) as RestA).paymentMethods} />
                : (pl(cr.pay) ? <div className="adm-empty">No recorded payments in this range.</div> : <div className="adm-empty">Loading…</div>)}
            </div>
          </div>

          {/* Records strip — the numbers worth bragging about */}
          {records && (records.bestDay || records.starDish) && (
            <div className="adm-card" style={{ marginTop: 12 }}>
              <div className="ow2-ct"><span>Your records <span className="mut">· the numbers worth bragging about</span></span></div>
              <div className="rv-recs">
                {records.bestDay && (
                  <div className="rv-rec"><span className="e">🏆</span><span><small>BEST DAY EVER</small><b><AnimatedNumber value={records.bestDay.revenue} money /></b>
                    <i>{new Date(records.bestDay.date).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: IST })} — beat it!</i></span></div>
                )}
                {records.starDish && (
                  <div className="rv-rec"><span className="e">👑</span><span><small>STAR DISH · 30 DAYS</small><b>{records.starDish.title}</b>
                    <i>{records.starDish.qty} plates</i></span></div>
                )}
                {records.fastHour && (
                  <div className="rv-rec"><span className="e">⚡</span><span><small>BUSIEST HOUR EVER</small><b><AnimatedNumber value={records.fastHour.orders} /> orders</b>
                    <i>{istWall(records.fastHour.at, { day: "numeric", month: "short", hour: "numeric", hour12: true })}</i></span></div>
                )}
                {records.bigBill && (
                  <div className="rv-rec"><span className="e">💎</span><span><small>BIGGEST BILL</small><b><AnimatedNumber value={records.bigBill.revenue} money /></b>
                    <i>{records.bigBill.table ? `table ${records.bigBill.table}` : "one sitting"}</i></span></div>
                )}
                {(records.regulars ?? 0) > 0 && (
                  <div className="rv-rec"><span className="e">🔁</span><span><small>REGULARS · 30 DAYS</small><b><AnimatedNumber value={records.regulars ?? 0} /> returning guests</b>
                    <i>same name, 2+ visits</i></span></div>
                )}
              </div>
            </div>
          )}

          <div className="ow2-two" style={{ marginTop: 12 }}>
            {/* Every dish — tap one for detail */}
            <div className="adm-card">
              <div className="ow2-ct">
                <span>Every dish <span className="mut">· tap one for detail</span></span>
                <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
                  <span className="rv-sort">
                    <button className={dishSort === "revenue" ? "on" : ""} onClick={() => setDishSort("revenue")}>By revenue</button>
                    <button className={dishSort === "qty" ? "on" : ""} onClick={() => setDishSort("qty")}>By qty</button>
                  </span>
                  <RangeDrop id="dishes" value={cr.dishes} onChange={setCardRange("dishes")} compactBtn />
                </span>
              </div>
              <DishList payload={pl(cr.dishes) as RestA | undefined} sort={dishSort}
                onDish={(t) => setView({ level: "dish", rid: activeRid, dish: t })} />
            </div>
            {/* Recent activity — the owner's mini log (surprise add) */}
            <div className="adm-card">
              <div className="ow2-ct">
                <span>Recent activity <span className="mut">· who did what</span></span>
                {ov?.entitlements?.activity !== false && <Link href={withPin("/owner/activity")} className="ow2-seeall">See all <i className="fas fa-arrow-right" aria-hidden="true" /></Link>}
              </div>
              {!acts ? <div className="adm-empty">Loading…</div>
                : acts.length === 0 ? <div className="adm-empty">Nothing yet.</div>
                : (
                  <div className="ow2-acts">
                    {acts.map((a) => (
                      <div key={a.id} className="ow2-act">
                        <span className={`pn pn-${a.panel}`}>{a.panel}</span>
                        <span className="tx">{a.action}{a.table_number ? ` · table ${a.table_number}` : ""}</span>
                        <span className="who">{a.actor || "—"}</span>
                        <span className="when">{timeAgo(a.created_at)}</span>
                      </div>
                    ))}
                  </div>
                )}
            </div>
          </div>
        </>
      )}

      {/* ═══════ DISH ═══════ */}
      {view.level === "dish" && (
        <div className="adm-card own-dish">
          {dishView === "loading" || dishView === null ? <div className="adm-empty">Loading dish…</div>
          : dishView === "missing" ? (
            <div className="adm-empty">
              No sales for <b>{view.dish}</b> in {RANGE_LABEL[cr.dishes]}.{" "}
              <button className="adm-btn" style={{ marginLeft: 6 }} onClick={() => setView({ level: "restaurant", rid: view.rid })}>
                <i className="fas fa-arrow-left" aria-hidden="true" /> Back to restaurant
              </button>
            </div>
          ) : (<>
            <div className="own-dish-h" style={{ ["--rcol" as string]: GREEN }}>
              <div className="own-dish-name">{dishView.d.title}</div>
              <div className="adm-muted">{RANGE_LABEL[cr.dishes]} · <RangeDrop id="dishes-d" value={cr.dishes} onChange={setCardRange("dishes")} compactBtn /></div>
            </div>
            <div className="adm-stats" style={{ marginTop: 14 }}>
              <div className="adm-stat"><div className="k">Revenue</div><div className="v"><AnimatedNumber value={dishView.d.revenue} money /></div></div>
              <div className="adm-stat"><div className="k">Sold</div><div className="v">{dishView.d.qty}</div></div>
              <div className="adm-stat"><div className="k">Share of revenue</div><div className="v">{dishView.share}%</div></div>
              <div className="adm-stat"><div className="k">Rank by revenue</div><div className="v">#{dishView.rank}<span style={{ fontSize: 13, color: "var(--muted)" }}> / {dishView.of}</span></div></div>
            </div>
            <div className="ow2-ct" style={{ marginTop: 18 }}><span>How it compares <span className="mut">· revenue vs other dishes</span></span></div>
            <LeaderBar data={dishView.dishes.slice(0, 12).map((d) => ({ id: d.title, name: d.title, revenue: d.revenue, orders: d.qty, accentColor: d.title === dishView.d.title ? GREEN : "rgba(128,128,128,.35)" }))}
              onSelect={(title) => setView({ level: "dish", rid: (view as { rid: string }).rid, dish: title })} />
          </>)}
        </div>
      )}

      {/* ═══════ DRAWER — phase 2 of the 3-phase drill (multi only) ═══════ */}
      {drawer && (
        <div className="ow2-drawer-wrap" role="dialog" aria-label={`${drawer.r.name} summary`}>
          <div className="ow2-drawer-back" onClick={() => setDrawerRid(null)} aria-hidden="true" />
          <aside className="ow2-drawer">
            <header>
              <span className="hq-nm" style={{ fontSize: 15 }}><span className="sw" style={{ background: drawer.row?.accent || GREEN }} aria-hidden="true" />{drawer.r.name}</span>
              <button className="x" onClick={() => setDrawerRid(null)} aria-label="Close">✕</button>
            </header>
            <div className="bd">
              <div className="dstats">
                <div><small>Today</small><b><AnimatedNumber value={drawer.r.revenueToday} money /></b><i>{drawer.r.ordersToday} orders</i></div>
                <div><small>Revenue · {RANGE_LABEL[cr.table]}</small><b><AnimatedNumber value={drawer.row?.revenue ?? 0} money /></b><i>{drawer.row?.orders ?? 0} orders</i></div>
                <div><small>Avg check</small><b><AnimatedNumber value={drawer.row?.avg ?? 0} money /></b><i>per order</i></div>
                <div><small>Open tables</small><b><AnimatedNumber value={drawer.r.openTables} /></b><i>right now</i></div>
              </div>
              {drawer.row?.spark && drawer.row.spark.length >= 2 && (
                <div className="dspark"><small>Trend · {RANGE_LABEL[cr.table]}</small><Spark points={drawer.row.spark} color={drawer.row.accent} width={300} height={54} /></div>
              )}
              <div className="dall">
                <span><i className="fas fa-receipt" aria-hidden="true" /> {drawer.r.ordersAll.toLocaleString("en-IN")} orders all-time</span>
                <span><i className="fas fa-indian-rupee-sign" aria-hidden="true" /> {inr(drawer.r.revenueAll)} all-time</span>
                <span className={`own-pill ${drawer.r.active ? "on" : "off"}`}>{drawer.r.active ? "Active" : "Off"}</span>
              </div>
            </div>
            <footer>
              <button className="full" onClick={() => openFull(drawer.r.id)}>
                View in full detail <i className="fas fa-arrow-right" aria-hidden="true" />
              </button>
            </footer>
          </aside>
        </div>
      )}

      <style jsx>{`
        .ow2-bar { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 14px; }
        .ow2-title { font-size: 17px; font-weight: 800; }
        .ow2-back { display: inline-flex; align-items: center; gap: 8px; background: none; border: var(--border); border-radius: 9px; padding: 7px 13px; font: inherit; font-size: 12.5px; font-weight: 700; color: var(--muted); cursor: pointer; }
        .ow2-back:hover { color: var(--accent); border-color: var(--accent); }
        .ow2-tools { display: flex; gap: 10px; align-items: flex-start; }
        .ow2-stats { margin-bottom: 12px; }
        :global(.ow2-stats) { display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; }
        .ow2-ct { display: flex; align-items: center; justify-content: space-between; gap: 10px; font-size: 13px; font-weight: 800; margin-bottom: 10px; flex-wrap: wrap; }
        .ow2-ct .mut { color: var(--muted); font-weight: 500; }
        .ow2-two { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        .ow2-callouts { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px; }
        .ow2-co { display: flex; align-items: center; gap: 12px; border: var(--border); border-radius: 12px; padding: 12px 15px; }
        .ow2-co.good { border-left: 3px solid ${GREEN}; }
        .ow2-co.warn { border-left: 3px solid #d97706; }
        .ow2-co .ic { font-size: 20px; }
        .ow2-co small { display: block; font-size: 10px; color: var(--muted); font-weight: 800; letter-spacing: .04em; text-transform: uppercase; }
        .ow2-co b { display: block; font-size: 14.5px; line-height: 1.3; }
        .ow2-co i { display: block; font-style: normal; font-size: 11.5px; color: var(--muted); }
        /* table */
        .hq-bar { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; padding: 12px 14px; border-bottom: var(--border); }
        .hq-search { flex: 1 1 220px; display: flex; align-items: center; gap: 9px; border: var(--border); background: var(--bg); border-radius: 9px; padding: 7px 12px; color: var(--muted); }
        .hq-search input { flex: 1; min-width: 0; background: none; border: none; outline: none; font: inherit; font-size: 13px; color: var(--text); }
        .hq-search i { font-size: 12px; }
        .hq-x { background: none; border: none; color: var(--muted); font-size: 15px; cursor: pointer; padding: 0 2px; line-height: 1; }
        .hq-scroll { overflow: auto; max-height: 64vh; }
        .hq-table { width: 100%; border-collapse: collapse; font-size: 13px; }
        .hq-table th { position: sticky; top: 0; background: var(--card); z-index: 1; text-align: right; font-size: 10.5px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); font-weight: 700; padding: 9px 12px; border-bottom: var(--border); white-space: nowrap; user-select: none; }
        .hq-table th:hover { color: var(--accent); }
        .hq-table th.l, .hq-table td.l { text-align: left; }
        .hq-table td { padding: 9px 12px; border-bottom: var(--border); text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
        .hq-table .rk { width: 30px; color: var(--muted); font-weight: 800; font-size: 11.5px; }
        .hq-row { cursor: pointer; }
        .hq-row:hover td, .hq-row:focus-visible td { background: var(--muted2); }
        .hq-nm { display: inline-flex; align-items: center; gap: 9px; font-weight: 700; max-width: 240px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .hq-nm .sw { width: 8px; height: 8px; border-radius: 999px; flex-shrink: 0; }
        .hq-meter { display: inline-block; vertical-align: middle; width: 52px; height: 7px; border-radius: 4px; background: rgba(128,128,128,.14); overflow: hidden; margin-right: 8px; }
        .hq-meter span { display: block; height: 100%; border-radius: 4px; }
        .hq-table .mut { color: var(--muted); }
        .hq-table .go i { color: var(--muted); font-size: 11px; }
        .hq-empty { text-align: center !important; color: var(--muted); padding: 26px 12px !important; }
        /* dish view bits reused */
        .own-dish-h { border-left: 4px solid var(--rcol); padding-left: 12px; }
        .own-dish-name { font-size: 22px; font-weight: 800; }
        .rv-sort { display: inline-flex; gap: 2px; }
        .rv-sort button { background: none; border: var(--border); padding: 4px 10px; border-radius: 7px; font-size: 11.5px; font-weight: 700; color: var(--muted); cursor: pointer; }
        .rv-sort button.on { background: var(--accent); color: #fff; border-color: var(--accent); }
        .rv-recs { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 6px; }
        .rv-rec { flex: 1 1 190px; min-width: 170px; display: flex; gap: 11px; align-items: center; border: 1px solid var(--border-c, rgba(128,128,128,.22)); border-radius: 12px; padding: 11px 14px; }
        .rv-rec .e { font-size: 20px; }
        .rv-rec small { display: block; font-size: 9.5px; color: var(--muted); font-weight: 800; letter-spacing: 0.5px; }
        .rv-rec b { display: block; font-size: 14px; line-height: 1.3; font-variant-numeric: tabular-nums; }
        .rv-rec i { display: block; font-style: normal; font-size: 10.5px; color: var(--muted); }
        /* hero */
        .own-hero { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; border: var(--border); border-left: 4px solid var(--rcol); border-radius: 12px; padding: 14px 16px; margin-bottom: 14px; background: linear-gradient(90deg, color-mix(in srgb, var(--rcol) 9%, transparent), transparent 55%); }
        .own-hero-id { min-width: 0; flex: 1; }
        .own-hero-name { font-size: 20px; font-weight: 800; line-height: 1.2; }
        .own-hero-sub { display: flex; align-items: center; gap: 10px; margin-top: 6px; flex-wrap: wrap; font-size: 12px; color: var(--muted); }
        .own-hero-sub .live { display: inline-flex; align-items: center; gap: 6px; font-weight: 600; color: var(--text); }
        .own-hero-sub .live i { color: var(--rcol); font-size: 11px; }
        .own-hero-links { display: flex; gap: 8px; flex-wrap: wrap; }
        :global(.own-hero-link) { display: inline-flex; align-items: center; gap: 8px; border: var(--border); background: var(--card); border-radius: 9px; padding: 8px 13px; font-size: 12.5px; font-weight: 700; color: var(--text) !important; text-decoration: none; transition: border-color .15s; }
        :global(.own-hero-link:hover) { border-color: var(--rcol); }
        :global(.own-hero-link i) { color: var(--rcol); font-size: 12px; }
        .own-pill { font-size: 10px; font-weight: 800; padding: 3px 9px; border-radius: 999px; text-transform: uppercase; letter-spacing: .03em; flex-shrink: 0; }
        .own-pill.on { background: color-mix(in srgb, var(--adm-ok) 18%, transparent); color: var(--adm-ok); }
        .own-pill.off { background: rgba(120,120,120,.18); color: var(--muted); }
        /* recent activity */
        :global(.ow2-seeall) { font-size: 11.5px; font-weight: 700; color: var(--accent) !important; text-decoration: none; }
        :global(.ow2-seeall i) { font-size: 10px; margin-left: 4px; }
        .ow2-acts { display: flex; flex-direction: column; gap: 2px; }
        .ow2-act { display: grid; grid-template-columns: auto 1fr auto auto; gap: 10px; align-items: center; padding: 8px 6px; border-radius: 8px; font-size: 12.5px; }
        .ow2-act:hover { background: color-mix(in srgb, var(--accent) 6%, transparent); }
        .ow2-act .pn { font-size: 9.5px; font-weight: 800; text-transform: uppercase; letter-spacing: .04em; padding: 2px 7px; border-radius: 999px; background: rgba(128,128,128,.14); color: var(--muted); }
        .ow2-act .tx { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .ow2-act .who { color: var(--muted); font-size: 11.5px; }
        .ow2-act .when { color: var(--muted); font-size: 10.5px; white-space: nowrap; }
        /* drawer */
        .ow2-drawer-wrap { position: fixed; inset: 0; z-index: 90; }
        .ow2-drawer-back { position: absolute; inset: 0; background: rgba(5,8,14,.55); backdrop-filter: blur(2px); animation: ow2fade .2s ease-out; }
        .ow2-drawer { position: absolute; top: 0; right: 0; height: 100%; width: min(400px, 94vw); background: var(--card); border-left: var(--border); box-shadow: -18px 0 50px rgba(0,0,0,.4); display: flex; flex-direction: column; animation: ow2slide .24s cubic-bezier(.4,0,.2,1); }
        @keyframes ow2slide { from { transform: translateX(100%); } to { transform: translateX(0); } }
        @keyframes ow2fade { from { opacity: 0; } to { opacity: 1; } }
        .ow2-drawer header { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 16px 18px; border-bottom: var(--border); }
        .ow2-drawer .x { background: var(--bg); border: var(--border); color: var(--text); width: 32px; height: 32px; border-radius: 9px; font-size: 13px; cursor: pointer; }
        .ow2-drawer .bd { flex: 1; overflow-y: auto; padding: 16px 18px; display: flex; flex-direction: column; gap: 14px; }
        .dstats { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
        .dstats > div { border: var(--border); border-radius: 11px; padding: 11px 13px; }
        .dstats small { display: block; font-size: 10px; color: var(--muted); font-weight: 800; text-transform: uppercase; letter-spacing: .04em; }
        .dstats b { display: block; font-size: 18px; font-weight: 800; font-variant-numeric: tabular-nums; margin-top: 2px; }
        .dstats i { display: block; font-style: normal; font-size: 10.5px; color: var(--muted); }
        .dspark { border: var(--border); border-radius: 11px; padding: 11px 13px; }
        .dspark small { display: block; font-size: 10px; color: var(--muted); font-weight: 800; text-transform: uppercase; letter-spacing: .04em; margin-bottom: 6px; }
        .dall { display: flex; flex-wrap: wrap; gap: 8px 14px; align-items: center; font-size: 12px; color: var(--muted); }
        .dall i { opacity: .7; margin-right: 4px; }
        .ow2-drawer footer { padding: 14px 18px; border-top: var(--border); }
        .ow2-drawer .full { width: 100%; display: flex; align-items: center; justify-content: center; gap: 9px; background: var(--accent); color: #06251a; border: none; border-radius: 11px; padding: 12px; font: inherit; font-size: 13.5px; font-weight: 800; cursor: pointer; }
        .ow2-drawer .full:hover { filter: brightness(1.08); }
        @media (max-width: 1080px) { :global(.ow2-stats) { grid-template-columns: repeat(3, 1fr) !important; } }
        @media (max-width: 760px) {
          :global(.ow2-stats) { grid-template-columns: repeat(2, 1fr) !important; }
          .ow2-two, .ow2-callouts { grid-template-columns: 1fr; }
          .hq-table .hide-m { display: none; }
          .hq-table th:nth-child(3), .hq-table td:nth-child(3), .hq-table th:nth-child(6), .hq-table td:nth-child(6) { display: none; }
          .ow2-act .who { display: none; }
        }
      `}</style>
    </>
  );
}

// ── Every-dish list (kept from the old view, range now per-card) ──────────────
function DishList({ payload, sort, onDish }: { payload?: RestA; sort: "revenue" | "qty"; onDish: (t: string) => void }) {
  if (!payload) return <div className="adm-empty">Loading…</div>;
  const dishes = [...payload.dishes].sort((a, b) => (sort === "revenue" ? b.revenue - a.revenue : b.qty - a.qty));
  const maxRev = Math.max(1, ...dishes.map((d) => d.revenue));
  return (
    <div className="rv-dishes">
      {dishes.length === 0 && <div className="adm-empty">No dish sales in this range.</div>}
      {dishes.map((d) => (
        <button key={d.title} className="rv-dish" onClick={() => onDish(d.title)}>
          <span className="rv-dn">{d.title}</span>
          <span className="rv-bar"><span style={{ width: `${(d.revenue / maxRev) * 100}%`, background: GREEN }} /></span>
          <span className="rv-q">{d.qty} sold</span>
          <span className="rv-r">{inr(d.revenue)}</span>
          <i className="fas fa-chevron-right" aria-hidden="true" />
        </button>
      ))}
      <style jsx>{`
        .rv-dishes { display: flex; flex-direction: column; gap: 2px; margin-top: 6px; max-height: 420px; overflow-y: auto; }
        .rv-dish { display: grid; grid-template-columns: minmax(110px, 1.4fr) 1.6fr auto auto auto; align-items: center; gap: 12px; padding: 9px 8px; border: none; border-radius: 8px; background: none; cursor: pointer; font: inherit; color: inherit; text-align: left; }
        .rv-dish:hover { background: color-mix(in srgb, var(--accent) 8%, transparent); }
        .rv-dn { font-weight: 700; font-size: 13.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .rv-bar { height: 8px; border-radius: 4px; background: rgba(128,128,128,.14); overflow: hidden; }
        .rv-bar span { display: block; height: 100%; border-radius: 4px; }
        .rv-q { font-size: 12px; color: var(--muted); font-variant-numeric: tabular-nums; }
        .rv-r { font-weight: 800; font-variant-numeric: tabular-nums; min-width: 70px; text-align: right; }
        .rv-dish i { color: var(--muted); font-size: 11px; }
        @media (max-width: 760px) { .rv-dish { grid-template-columns: 1fr auto auto; } .rv-bar { display: none; } }
      `}</style>
    </div>
  );
}
