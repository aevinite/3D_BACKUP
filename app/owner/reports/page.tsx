"use client";
// Owner · Reports Studio (redesign 2026-07-25).
//
// A categorised HUB of report cards → a premium report VIEW (KPI hero band, best-fit
// chart, breakdown, clean table), print- and CSV-ready. On-demand only: a report runs
// when the owner opens it (owner's rule — never scheduled). Every number comes from the
// existing lfh_owner_* RPCs via /api/owner/reports; a dozen reports share a handful of
// query shapes (sales/avgbill/volume/weekday/tax/discounts/cancellations all read ONE
// bucketed money payload; daypart re-slices hourly; menu re-slices dishes) so the studio
// is rich without being egress-heavy. Charts adopt the SELECTED restaurant's brand accent.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { inr } from "@/components/admin/shared";
import { AnimatedNumber } from "@/components/owner/AnimatedNumber";
import {
  AreaTrend, TimeBar, CountBar, HourlyBar, CategoryDonut, PaymentDonut, LeaderBar,
  Spark, canonPayMethod, PAY_COLORS,
} from "@/components/owner/Charts";
import {
  REPORTS, CATEGORIES, ReportsStyles, Stat, Panel, nfmt, type RKey, type DataKind,
} from "@/components/owner/reports/kit";

type Range = "today" | "yesterday" | "7d" | "30d" | "month" | "lastmonth" | "12m" | "fy";
const RANGES: { k: Range; label: string }[] = [
  { k: "today", label: "Today" }, { k: "yesterday", label: "Yesterday" },
  { k: "7d", label: "7 days" }, { k: "30d", label: "30 days" },
  { k: "month", label: "This month" }, { k: "lastmonth", label: "Last month" },
  { k: "12m", label: "12 months" }, { k: "fy", label: "FY (Apr–Mar)" },
];
const rangeLabel = (r: Range) => RANGES.find((x) => x.k === r)?.label ?? r;

type Rest = { id: string; name: string; accent: string };
type MoneyRow = { bucket: string; orders: number; paidOrders: number; subtotal: number; tax: number; discount: number; revenue: number; cancelledOrders: number; cancelledValue: number };
type Totals = Omit<MoneyRow, "bucket">;
type TaxInfo = { effectivePct: number; components: { label: string; rate: number; amount: number }[]; configured: boolean } | null;
type PayRow = { method: string; revenue: number; orders: number };
type DishRow = { title: string; qty: number; revenue: number };
type CatRow = { category: string; qty: number; revenue: number };
type HourRow = { hour: number; orders: number; revenue: number };
type Payload = { rows?: unknown[]; totals?: Totals; tax?: TaxInfo; payments?: PayRow[]; bucket?: string };
type Entry = { loading?: boolean; error?: string; data?: Payload };

const apiType = (kind: DataKind): string =>
  kind === "money" ? "sales" : kind === "daysummary" ? "daysummary" : kind;

// Bucket instants are IST (the RPC truncates in Asia/Kolkata) — format IN that zone or a
// non-IST viewer sees every day/month off by one (wrong on a GST document).
const TZ = "Asia/Kolkata";
function bucketLabel(iso: string, bucket: string): string {
  const d = new Date(iso);
  if (bucket === "hour") return d.toLocaleTimeString("en-IN", { hour: "numeric", hour12: true, timeZone: TZ });
  if (bucket === "month") return d.toLocaleDateString("en-IN", { month: "short", year: "2-digit", timeZone: TZ });
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: TZ });
}

// Split a list into whole numbers that STILL sum to a target integer (largest-remainder),
// so the CGST/SGST rupees always add back to the displayed Total tax.
function roundToSum(vals: number[], target: number): number[] {
  const floors = vals.map((v) => Math.floor(v));
  const out = [...floors];
  let rem = Math.round(target) - floors.reduce((a, b) => a + b, 0);
  const order = vals.map((v, i) => ({ i, frac: v - Math.floor(v) })).sort((a, b) => b.frac - a.frac);
  for (let k = 0; k < order.length && rem > 0; k++) { out[order[k].i]++; rem--; }
  return out;
}

function downloadCsv(filename: string, header: string[], rows: (string | number)[][]) {
  const esc = (v: string | number) => {
    let s = String(v);
    if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = "'" + s;      // neutralise formula injection
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [header, ...rows].map((r) => r.map(esc).join(",")).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
  a.download = filename; a.click(); URL.revokeObjectURL(a.href);
}

// ── Menu-engineering quadrant (client-only view over the dishes payload) ──────
type MI = { title: string; qty: number; revenue: number };
type Klass = "star" | "workhorse" | "puzzle" | "dog";
const KLASS: Record<Klass, { label: string; icon: string; sub: string; tip: string }> = {
  star:      { label: "Stars",      icon: "fa-star",         sub: "Ordered a lot · priced high",  tip: "Your winners — show them off: top of the menu, photos, specials." },
  workhorse: { label: "Workhorses", icon: "fa-horse",        sub: "Ordered a lot · low price",    tip: "Nudge the price up a little, or add a combo — easy extra money." },
  puzzle:    { label: "Puzzles",    icon: "fa-puzzle-piece", sub: "Priced high · rarely ordered", tip: "Give them a photo, a clearer name, or a small offer to move them." },
  dog:       { label: "Dogs",       icon: "fa-face-frown",   sub: "Low price · rarely ordered",   tip: "Mostly clutter — worth thinking about dropping." },
};
function median(arr: number[]): number {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function classifyMenu(rows: MI[]) {
  const clean = rows.filter((r) => (Number(r.qty) || 0) > 0);
  const totalQty = clean.reduce((a, r) => a + r.qty, 0);
  const totalRev = clean.reduce((a, r) => a + r.revenue, 0);
  const medQty = median(clean.map((r) => r.qty));
  const medPrice = median(clean.map((r) => (r.qty ? r.revenue / r.qty : 0)));
  const dishes = clean.map((r) => {
    const price = r.qty ? r.revenue / r.qty : 0;
    const klass: Klass = r.qty >= medQty && price >= medPrice ? "star" : r.qty >= medQty ? "workhorse" : price >= medPrice ? "puzzle" : "dog";
    return { ...r, price, qtyShare: totalQty ? r.qty / totalQty : 0, revShare: totalRev ? r.revenue / totalRev : 0, klass };
  });
  return { dishes };
}

const DAYPARTS: { label: string; icon: string; hours: number[] }[] = [
  { label: "Morning",    icon: "fa-mug-hot",   hours: [5, 6, 7, 8, 9, 10, 11] },
  { label: "Afternoon",  icon: "fa-sun",       hours: [12, 13, 14, 15, 16] },
  { label: "Evening",    icon: "fa-cloud-sun", hours: [17, 18, 19, 20, 21] },
  { label: "Late night", icon: "fa-moon",      hours: [22, 23, 0, 1, 2, 3, 4] },
];

export default function OwnerReports() {
  const [rests, setRests] = useState<Rest[]>([]);
  const [ready, setReady] = useState(false);
  // Pin the scope immediately from the URL (admin act-as ?rid) so the first query is
  // scoped and correctly labelled, without waiting on the (heavy) overview call. "" = all.
  const [rid, setRid] = useState<string>(() =>
    typeof window === "undefined" ? "" : (new URLSearchParams(window.location.search).get("rid") || ""));
  const [sel, setSel] = useState<RKey | "">("");         // "" = hub
  const [range, setRange] = useState<Range>("30d");
  const [store, setStore] = useState<Record<string, Entry>>({});

  // Admin act-as scope pin (mirrors app/owner/page.tsx): rides on every call so a second
  // tab's act-as cookie can't hijack this one.
  const scopePin = useMemo(() =>
    typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("rid"), []);
  const scp = scopePin ? `&scope=${scopePin}` : "";

  useEffect(() => {
    fetch(`/api/owner/overview?_=1${scp}`, { cache: "no-store" }).then((r) => r.json()).then((o) => {
      // Overview returns camelCase (accentColor) — reading accent_color left every chart
      // on the fallback green instead of the restaurant's own brand accent.
      const list: Rest[] = (o.restaurants ?? []).map((r: Record<string, unknown>) => ({
        id: r.id as string, name: r.name as string, accent: (r.accentColor as string) || "",
      }));
      setRests(list);
      // rid is already pinned from the URL for admin act-as; a single-restaurant owner
      // (no ?rid) gets pinned here once we know there's exactly one.
      if (!scopePin && list.length === 1) setRid(list[0].id);
      setReady(true);
    }).catch(() => setReady(true));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const cacheKey = (kind: DataKind, r: string, rg: Range) => `${kind}|${r}|${rg}`;
  // A key is fetched at most once (period/rid/kind combos are stable) — dedup via a ref so
  // React StrictMode's double-invoke can't double-fetch, and no stale `store` closure.
  const started = useRef<Set<string>>(new Set());
  const ensure = useCallback((kind: DataKind, r: string, rg: Range) => {
    const ck = `${kind}|${r}|${rg}`;
    if (started.current.has(ck)) return;
    started.current.add(ck);
    setStore((s) => ({ ...s, [ck]: { loading: true } }));
    const q = new URLSearchParams({ type: apiType(kind), range: rg });
    if (r) q.set("rid", r);
    if (scopePin) q.set("scope", scopePin);
    fetch(`/api/owner/reports?${q}`, { cache: "no-store" })
      .then((x) => x.json())
      .then((d) => {
        if (d.error) throw new Error(d.error);
        setStore((s) => ({ ...s, [ck]: { data: d } }));
      })
      .catch((e) => {
        started.current.delete(ck);                       // allow a later retry
        setStore((s) => ({ ...s, [ck]: { error: e instanceof Error ? e.message : String(e) } }));
      });
  }, [scopePin]); // eslint-disable-line react-hooks/exhaustive-deps

  const activeKind: DataKind = sel ? REPORTS[sel].kind : "money";
  useEffect(() => { if (ready) ensure(activeKind, rid, range); }, [ready, activeKind, rid, range, ensure]);

  const entry = store[cacheKey(activeKind, rid, range)];
  const data = entry?.data;
  const restName = rid ? (rests.find((r) => r.id === rid)?.name ?? "This restaurant") : "All restaurants";
  const accent = (rid ? rests.find((r) => r.id === rid)?.accent : "") || "var(--accent)";
  const singleRest = !!rid;

  const exportCsv = () => {
    if (!sel || !data) return;
    const meta = REPORTS[sel];
    const stamp = new Date().toISOString().slice(0, 10);
    const name = `${meta.label.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${range}-${stamp}.csv`;
    const m = (data.rows ?? []) as MoneyRow[];
    const t = data.totals;
    if (meta.kind === "money" || meta.kind === "daysummary") {
      const header = ["Period", "Orders", "Paid", "Subtotal", "Tax", "Discount", "Revenue", "Cancelled", "Lost value"];
      const rows: (string | number)[][] = m.map((r) => [bucketLabel(r.bucket, data.bucket || "day"), r.orders, r.paidOrders, r.subtotal, r.tax, r.discount, r.revenue, r.cancelledOrders, r.cancelledValue]);
      if (t) rows.push(["Total", t.orders, t.paidOrders, t.subtotal, t.tax, t.discount, t.revenue, t.cancelledOrders, t.cancelledValue]);
      if (sel === "tax" && data.tax) {
        rows.push([], ["Tax split", "Rate %", "Collected"], ["Total tax", data.tax.effectivePct, t?.tax ?? 0]);
        for (const c of data.tax.components) rows.push([c.label, c.rate, c.amount]);
      }
      downloadCsv(name, header, rows);
    } else if (meta.kind === "dishes") {
      downloadCsv(name, ["Dish", "Qty", "Item sales (list price)"], ((data.rows ?? []) as DishRow[]).map((r) => [r.title, r.qty, r.revenue]));
    } else if (meta.kind === "categories") {
      downloadCsv(name, ["Category", "Qty", "Item sales (list price)"], ((data.rows ?? []) as CatRow[]).map((r) => [r.category, r.qty, r.revenue]));
    } else if (meta.kind === "payments") {
      downloadCsv(name, ["Method", "Bills", "Revenue"], ((data.rows ?? []) as PayRow[]).map((r) => [canonPayMethod(r.method), r.orders, r.revenue]));
    } else if (meta.kind === "hourly") {
      downloadCsv(name, ["Hour", "Orders", "Revenue"], ((data.rows ?? []) as HourRow[]).map((r) => [`${r.hour}:00`, r.orders, r.revenue]));
    }
  };

  return (
    <div className="rs-root">
      <ReportsStyles />

      <div className="rs-head">
        <div>
          {sel && (
            <div className="rs-crumb">
              <button onClick={() => setSel("")}><i className="fas fa-arrow-left" aria-hidden /> Reports</button>
              <span>/</span><span style={{ color: "var(--text)" }}>{REPORTS[sel].label}</span>
            </div>
          )}
          {!sel && <h1 className="rs-h1">Reports</h1>}
          {!sel && <p className="rs-sub">Every report you need, on demand — pick one, choose a period, then print or download it.</p>}
        </div>
      </div>

      <div className="rs-controls">
        {rests.length > 1 && (
          <select className="rs-select" value={rid} onChange={(e) => setRid(e.target.value)} aria-label="Restaurant">
            <option value="">All restaurants</option>
            {rests.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        )}
        <div className="rs-seg" role="tablist" aria-label="Period">
          {RANGES.map((r) => (
            <button key={r.k} role="tab" aria-selected={range === r.k} className={range === r.k ? "on" : ""} onClick={() => setRange(r.k)}>{r.label}</button>
          ))}
        </div>
        {sel && (
          <div className="rs-actions">
            <button className="rs-btn" onClick={exportCsv} disabled={!data} title="Download this report as a CSV (Excel/Sheets)">
              <i className="fas fa-download" aria-hidden /> CSV
            </button>
            <button className="rs-btn" onClick={() => window.print()} disabled={!data} title="Print or save as PDF">
              <i className="fas fa-print" aria-hidden /> Print
            </button>
          </div>
        )}
      </div>

      {!sel ? (
        <Hub range={range} money={store[cacheKey("money", rid, range)]} restName={restName} accent={accent} onOpen={setSel} />
      ) : (
        <ReportView sel={sel} data={data} loading={entry?.loading} error={entry?.error}
          range={range} accent={accent} restName={restName} singleRest={singleRest} />
      )}
    </div>
  );
}

// ── The hub: hero snapshot + categorised report cards ─────────────────────────
function Hub({ range, money, restName, accent, onOpen }: {
  range: Range; money?: Entry; restName: string; accent: string; onOpen: (k: RKey) => void;
}) {
  const t = money?.data?.totals;
  const rows = (money?.data?.rows ?? []) as MoneyRow[];
  const spark = rows.map((r) => r.revenue);
  const avg = t && t.paidOrders ? t.revenue / t.paidOrders : 0;
  return (
    <>
      <div className="rs-hero">
        <div className="rs-hero-l">
          <div className="rs-hero-eyebrow">{restName} · {rangeLabel(range)}</div>
          <div className="rs-hero-val"><AnimatedNumber value={t?.revenue || 0} money loading={money?.loading} /></div>
          <div className="rs-hero-sub">Net revenue kept in this period{money?.error ? " — couldn't load" : ""}</div>
          <div className="rs-hero-mini">
            <div className="m"><div className="k">Paid bills</div><div className="v"><AnimatedNumber value={t?.paidOrders || 0} format={nfmt} loading={money?.loading} /></div></div>
            <div className="m"><div className="k">Avg bill</div><div className="v"><AnimatedNumber value={avg} money loading={money?.loading} /></div></div>
            <div className="m"><div className="k">Tax collected</div><div className="v"><AnimatedNumber value={t?.tax || 0} money loading={money?.loading} /></div></div>
            <div className="m"><div className="k">Discounts</div><div className="v"><AnimatedNumber value={t?.discount || 0} money loading={money?.loading} /></div></div>
          </div>
        </div>
        <div className="rs-hero-r">
          {spark.length > 1
            ? <Spark points={spark} color={accent} width={280} height={110} />
            : <i className="fas fa-chart-line" style={{ fontSize: 60, color: "color-mix(in srgb, var(--accent) 35%, transparent)" }} aria-hidden />}
        </div>
      </div>

      {CATEGORIES.map((cat) => (
        <div key={cat.key}>
          <div className="rs-catrow">
            <span className="ic"><i className={`fas ${cat.icon}`} aria-hidden /></span>
            <b>{cat.label}</b><span className="n">{cat.keys.length}</span>
          </div>
          <div className="rs-cards">
            {cat.keys.map((k) => {
              const m = REPORTS[k];
              return (
                <button key={k} className={`rs-card tone-${m.tone || "accent"}`} onClick={() => onOpen(k)}>
                  <span className="cic"><i className={`fas ${m.icon}`} aria-hidden /></span>
                  <span className="ct"><b>{m.label}</b><p>{m.blurb}</p></span>
                  <i className="fas fa-arrow-right go" aria-hidden />
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </>
  );
}

// ── The report view (title + loading/error, delegates body) ───────────────────
function ReportView({ sel, data, loading, error, range, accent, restName, singleRest }: {
  sel: RKey; data?: Payload; loading?: boolean; error?: string;
  range: Range; accent: string; restName: string; singleRest: boolean;
}) {
  const meta = REPORTS[sel];
  const tone = meta.tone || "accent";
  return (
    <div className={`rs-report tone-${tone}`} id="rs-print">
      <div className="rs-rtitle">
        <span className="cic"><i className={`fas ${meta.icon}`} aria-hidden /></span>
        <div><h2>{meta.label}</h2><div className="scope">{restName} · {rangeLabel(range)}</div></div>
      </div>
      {error ? (
        <Panel><div className="rs-empty"><i className="fas fa-triangle-exclamation" aria-hidden />{error}</div></Panel>
      ) : loading || !data ? (
        <div className="rs-kpis">{[0, 1, 2, 3].map((i) => <div key={i} className="rs-stat tone-accent" style={{ opacity: .5 }}><div className="rs-stat-k">Loading…</div><div className="rs-stat-v">—</div></div>)}</div>
      ) : (
        <ReportBody sel={sel} data={data} accent={accent} singleRest={singleRest} />
      )}
    </div>
  );
}

function EmptyCard({ text }: { text: string }) {
  return <Panel><div className="rs-empty"><i className="fas fa-inbox" aria-hidden />{text}</div></Panel>;
}

function ReportBody({ sel, data, accent, singleRest }: { sel: RKey; data: Payload; accent: string; singleRest: boolean }) {
  const bucket = data.bucket || "day";
  const t = data.totals;
  const mrows = (data.rows ?? []) as MoneyRow[];
  const series = mrows.map((r) => ({ label: bucketLabel(r.bucket, bucket), revenue: r.revenue }));

  // ── DAY SUMMARY ──
  if (sel === "daysummary") {
    if (!t) return <EmptyCard text="Nothing in this period yet." />;
    const pays = (data.payments || []).map((p) => ({ ...p, method: canonPayMethod(p.method) })).filter((p) => p.revenue > 0);
    const payTotal = pays.reduce((a, p) => a + p.revenue, 0);
    const avg = t.paidOrders ? t.revenue / t.paidOrders : 0;
    const taxLines = data.tax
      ? roundToSum(data.tax.components.map((c) => c.amount), t.tax).map((amt, i) => ({ label: data.tax!.components[i].label, rate: data.tax!.components[i].rate, amt }))
      : [];
    return (
      <>
        <div className="rs-kpis">
          <Stat label="Gross income" tone="accent" icon="fa-indian-rupee-sign" big value={inr(t.revenue)} sub="net of discounts, tax included" spark={series.map((s) => s.revenue)} />
          <Stat label="Paid bills" tone="info" icon="fa-receipt" value={nfmt(t.paidOrders)} sub={`${nfmt(t.orders)} orders total`} />
          <Stat label="Average bill" tone="info" icon="fa-scale-balanced" value={inr(avg)} />
          <Stat label="Tax collected" tone="accent" icon="fa-landmark" value={inr(t.tax)} />
          <Stat label="Cancelled" tone="bad" icon="fa-ban" value={nfmt(t.cancelledOrders)} sub={`${inr(t.cancelledValue)} lost`} />
        </div>

        <div className="rs-daysheet">
          <Panel title="Billing details" hint="what the bills added up to">
            <div className="rs-lines">
              <div className="rs-line"><span className="lbl">Gross sales (subtotal)</span><span className="val">{inr(t.subtotal)}</span></div>
              <div className="rs-line"><span className="lbl">Discounts given</span><span className="val neg">− {inr(t.discount)}</span></div>
              <div className="rs-line"><span className="lbl">Taxable sales</span><span className="val">{inr(t.subtotal - t.discount)}</span></div>
              {taxLines.length > 0
                ? taxLines.map((l) => <div key={l.label} className="rs-line sub"><span className="lbl">{l.label} ({l.rate}%)</span><span className="val">{inr(l.amt)}</span></div>)
                : <div className="rs-line"><span className="lbl">Tax</span><span className="val">{inr(t.tax)}</span></div>}
              <div className="rs-line"><span className="lbl">Total tax</span><span className="val">{inr(t.tax)}</span></div>
              <div className="rs-line total"><span className="lbl">Net total</span><span className="val">{inr(t.revenue)}</span></div>
            </div>
            {!singleRest && <p className="rs-note">Pick one restaurant to see the CGST/SGST split (tax lines are set per restaurant).</p>}
          </Panel>

          <Panel title="Settlement" hint="how the money arrived">
            {pays.length === 0 ? <div className="rs-empty" style={{ padding: 20 }}>No payments recorded.</div> : (
              <div className="rs-paylist">
                {pays.map((p) => {
                  const c = PAY_COLORS[p.method] || PAY_COLORS["Not recorded"];
                  const share = payTotal ? (p.revenue / payTotal) * 100 : 0;
                  return (
                    <div key={p.method}>
                      <div className="rs-payrow">
                        <span className="sw" style={{ background: c }} />
                        <span className="pm">{p.method} <span style={{ color: "var(--muted)", fontWeight: 600, fontSize: 11.5 }}>· {Math.round(share)}% · {p.orders} bill{p.orders === 1 ? "" : "s"}</span></span>
                        <span className="amt">{inr(p.revenue)}</span>
                      </div>
                      <div className="rs-paybar"><span style={{ width: `${share}%`, background: c }} /></div>
                    </div>
                  );
                })}
                <div className="rs-line total" style={{ marginTop: 6 }}><span className="lbl">Total collected</span><span className="val">{inr(payTotal)}</span></div>
              </div>
            )}
          </Panel>

          <Panel title="Order stats" hint="volume & health">
            <div className="rs-lines">
              <div className="rs-line"><span className="lbl">Orders placed</span><span className="val">{nfmt(t.orders)}</span></div>
              <div className="rs-line"><span className="lbl">Paid bills</span><span className="val">{nfmt(t.paidOrders)}</span></div>
              <div className="rs-line"><span className="lbl">Cancelled orders</span><span className="val neg">{nfmt(t.cancelledOrders)}</span></div>
              <div className="rs-line"><span className="lbl">Value lost to cancels</span><span className="val neg">{inr(t.cancelledValue)}</span></div>
              <div className="rs-line"><span className="lbl">Average bill</span><span className="val">{inr(avg)}</span></div>
              <div className="rs-line"><span className="lbl">Effective discount rate</span><span className="val">{t.subtotal ? ((t.discount / t.subtotal) * 100).toFixed(1) : "0.0"}%</span></div>
            </div>
          </Panel>
        </div>

        {series.length > 1 && (
          <Panel title="Revenue through the period" pad={false}>
            <div style={{ padding: 12 }}><AreaTrend data={series} lines={[{ key: "revenue", name: "Revenue", color: accent }]} height={220} /></div>
          </Panel>
        )}
      </>
    );
  }

  // ── SALES TREND ──
  if (sel === "sales") {
    if (!t) return <EmptyCard text="No sales in this period yet." />;
    return (
      <>
        <div className="rs-kpis">
          <Stat label="Revenue (kept)" tone="accent" icon="fa-indian-rupee-sign" big value={inr(t.revenue)} spark={series.map((s) => s.revenue)} />
          <Stat label="Paid bills" tone="info" icon="fa-receipt" value={nfmt(t.paidOrders)} />
          <Stat label="Gross sales" tone="accent" icon="fa-cart-shopping" value={inr(t.subtotal)} />
          <Stat label="Tax collected" tone="accent" icon="fa-landmark" value={inr(t.tax)} />
          <Stat label="Discounts" tone="warn" icon="fa-tag" value={inr(t.discount)} />
        </div>
        <Panel title="Revenue over time" pad={false}>
          <div style={{ padding: 12 }}>{bucket === "hour" ? <TimeBar data={series} color={accent} height={240} /> : <AreaTrend data={series} lines={[{ key: "revenue", name: "Revenue", color: accent }]} height={240} />}</div>
        </Panel>
        <MoneyTable rows={mrows} totals={t} bucket={bucket} />
      </>
    );
  }

  // ── AVERAGE BILL ──
  if (sel === "avgbill") {
    if (!t) return <EmptyCard text="No paid bills in this period yet." />;
    const avgSeries = mrows.map((r) => ({ label: bucketLabel(r.bucket, bucket), revenue: r.paidOrders ? Math.round(r.revenue / r.paidOrders) : 0 }));
    const avg = t.paidOrders ? t.revenue / t.paidOrders : 0;
    const withData = avgSeries.filter((s) => s.revenue > 0).map((s) => s.revenue);
    return (
      <>
        <div className="rs-kpis">
          <Stat label="Average bill" tone="info" icon="fa-scale-balanced" big value={inr(avg)} sub="revenue ÷ paid bills" spark={avgSeries.map((s) => s.revenue)} />
          <Stat label="Paid bills" tone="accent" icon="fa-receipt" value={nfmt(t.paidOrders)} />
          <Stat label="Highest bucket" tone="good" icon="fa-arrow-up" value={inr(withData.length ? Math.max(...withData) : 0)} />
          <Stat label="Lowest bucket" tone="warn" icon="fa-arrow-down" value={inr(withData.length ? Math.min(...withData) : 0)} />
        </div>
        <Panel title="Average bill over time" pad={false}>
          <div style={{ padding: 12 }}><AreaTrend data={avgSeries} lines={[{ key: "revenue", name: "Avg bill", color: accent }]} height={240} /></div>
        </Panel>
        <MoneyTable rows={mrows} totals={t} bucket={bucket} showAvg />
      </>
    );
  }

  // ── ORDER VOLUME ──
  if (sel === "volume") {
    if (!t) return <EmptyCard text="No orders in this period yet." />;
    const vol = mrows.map((r) => ({ label: bucketLabel(r.bucket, bucket), value: r.orders }));
    const paidPct = t.orders ? (t.paidOrders / t.orders) * 100 : 0;
    return (
      <>
        <div className="rs-kpis">
          <Stat label="Orders placed" tone="info" icon="fa-list-check" big value={nfmt(t.orders)} spark={vol.map((v) => v.value)} />
          <Stat label="Paid bills" tone="good" icon="fa-circle-check" value={nfmt(t.paidOrders)} sub={`${paidPct.toFixed(0)}% of orders`} />
          <Stat label="Cancelled" tone="bad" icon="fa-ban" value={nfmt(t.cancelledOrders)} />
          <Stat label="Busiest bucket" tone="accent" icon="fa-fire" value={nfmt(vol.length ? Math.max(...vol.map((v) => v.value)) : 0)} sub="orders in one bucket" />
        </div>
        <Panel title="Orders over time" pad={false}>
          <div style={{ padding: 12 }}><CountBar data={vol} color={accent} name="Orders" height={240} /></div>
        </Panel>
        <MoneyTable rows={mrows} totals={t} bucket={bucket} />
      </>
    );
  }

  // ── DAY OF WEEK ──
  if (sel === "weekday") {
    if (bucket !== "day") return <EmptyCard text="Pick a daily period (7 days, 30 days, this or last month) to see the day-of-week breakdown." />;
    const NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const by = new Map<string, { rev: number; orders: number; days: number }>();
    for (const r of mrows) {
      const wd = new Date(r.bucket).toLocaleDateString("en-US", { weekday: "short", timeZone: TZ });
      const cur = by.get(wd) || { rev: 0, orders: 0, days: 0 };
      cur.rev += r.revenue; cur.orders += r.paidOrders; cur.days += (r.revenue > 0 || r.paidOrders > 0) ? 1 : 0;
      by.set(wd, cur);
    }
    const rows = NAMES.map((nm) => ({ nm, ...(by.get(nm) || { rev: 0, orders: 0, days: 0 }) }));
    const chart = rows.map((r) => ({ label: r.nm, revenue: r.rev }));
    const best = rows.reduce((a, b) => (b.rev > a.rev ? b : a), rows[0]);
    const wkRev = (by.get("Sat")?.rev || 0) + (by.get("Sun")?.rev || 0);
    const allRev = rows.reduce((a, r) => a + r.rev, 0);
    return (
      <>
        <div className="rs-kpis">
          <Stat label="Best weekday" tone="good" icon="fa-crown" big value={best.rev > 0 ? best.nm : "—"} sub={`${inr(best.rev)} total`} />
          <Stat label="Weekend share" tone="info" icon="fa-champagne-glasses" value={allRev ? `${Math.round((wkRev / allRev) * 100)}%` : "0%"} sub="Sat + Sun of revenue" />
        </div>
        <Panel title="Revenue by day of week" pad={false}>
          <div style={{ padding: 12 }}><TimeBar data={chart} color={accent} height={240} /></div>
        </Panel>
        <Panel title="Breakdown" pad={false}>
          <div className="rs-tablewrap">
            <table className="rs-table">
              <thead><tr><th>Day</th><th className="num">Days counted</th><th className="num">Paid bills</th><th className="num">Revenue</th><th className="num">Avg / day</th></tr></thead>
              <tbody>{rows.map((r) => <tr key={r.nm}><td>{r.nm}</td><td className="num">{r.days}</td><td className="num">{nfmt(r.orders)}</td><td className="num"><b>{inr(r.rev)}</b></td><td className="num">{inr(r.days ? r.rev / r.days : 0)}</td></tr>)}</tbody>
            </table>
          </div>
        </Panel>
      </>
    );
  }

  // ── TAX / GST ──
  if (sel === "tax") {
    if (!t) return <EmptyCard text="No taxable sales in this period yet." />;
    return (
      <>
        <div className="rs-kpis">
          <Stat label="Tax collected" tone="accent" icon="fa-landmark" big value={inr(t.tax)} spark={mrows.map((r) => r.tax)} />
          {data.tax && <Stat label="Tax rate" tone="info" icon="fa-percent" value={`${data.tax.effectivePct}%`} />}
          <Stat label="Taxable sales" tone="accent" icon="fa-cart-shopping" value={inr(t.subtotal - t.discount)} sub="subtotal − discount" />
          <Stat label="Paid bills" tone="info" icon="fa-receipt" value={nfmt(t.paidOrders)} />
        </div>
        {data.tax ? (
          <Panel title="The split" hint="same total, shown the way the printed bill shows it">
            <div className="rs-tablewrap">
              <table className="rs-table">
                <thead><tr><th>Tax line</th><th className="num">Rate</th><th className="num">Collected</th></tr></thead>
                <tbody>
                  <tr><td><b>Total tax</b></td><td className="num">{data.tax.effectivePct}%</td><td className="num"><b>{inr(t.tax)}</b></td></tr>
                  {roundToSum(data.tax.components.map((c) => c.amount), t.tax).map((amt, i) => {
                    const c = data.tax!.components[i];
                    return <tr key={c.label}><td>{c.label}</td><td className="num">{c.rate}%</td><td className="num">{inr(amt)}</td></tr>;
                  })}
                </tbody>
              </table>
            </div>
            {!data.tax.configured && <p className="rs-note">No custom tax lines set — showing the standard CGST/SGST halves.</p>}
          </Panel>
        ) : (
          <EmptyCard text="Pick a single restaurant to see its CGST/SGST split — tax lines are set per restaurant." />
        )}
        <MoneyTable rows={mrows} totals={t} bucket={bucket} />
      </>
    );
  }

  // ── PAYMENT SETTLEMENT ──
  if (sel === "payments") {
    const pays = (data.rows ?? []) as PayRow[];
    if (!pays.length) return <EmptyCard text="No payments recorded in this period." />;
    const total = pays.reduce((a, p) => a + p.revenue, 0);
    const bills = pays.reduce((a, p) => a + p.orders, 0);
    const top = [...pays].sort((a, b) => b.revenue - a.revenue)[0];
    return (
      <>
        <div className="rs-kpis">
          <Stat label="Total collected" tone="accent" icon="fa-indian-rupee-sign" big value={inr(total)} />
          <Stat label="Bills settled" tone="info" icon="fa-receipt" value={nfmt(bills)} />
          <Stat label="Top method" tone="good" icon="fa-wallet" value={canonPayMethod(top?.method)} sub={`${total ? Math.round((top.revenue / total) * 100) : 0}% of money`} />
        </div>
        <Panel title="How the money arrived"><PaymentDonut data={pays} /></Panel>
      </>
    );
  }

  // ── ITEM SALES ──
  if (sel === "dishes") {
    const dishes = (data.rows ?? []) as DishRow[];
    if (!dishes.length) return <EmptyCard text="No dish sales in this period." />;
    const totalRev = dishes.reduce((a, d) => a + d.revenue, 0);
    const totalQty = dishes.reduce((a, d) => a + d.qty, 0);
    return (
      <>
        <div className="rs-kpis">
          <Stat label="Item sales (list price)" tone="accent" icon="fa-indian-rupee-sign" big value={inr(totalRev)} sub="menu price × paid qty" />
          <Stat label="Units sold" tone="info" icon="fa-boxes-stacked" value={nfmt(totalQty)} />
          <Stat label="Distinct dishes" tone="info" icon="fa-utensils" value={nfmt(dishes.length)} />
          <Stat label="Top seller" tone="good" icon="fa-crown" value={dishes[0]?.title || "—"} sub={`${nfmt(dishes[0]?.qty || 0)} sold`} />
        </div>
        <Panel title="Top earners" hint="by item sales"><LeaderBar data={dishes.slice(0, 10).map((d) => ({ id: d.title, name: d.title, revenue: d.revenue, orders: d.qty, accentColor: accent }))} /></Panel>
        <Panel title="Every dish" pad={false}>
          <div className="rs-tablewrap">
            <table className="rs-table">
              <thead><tr><th>Dish</th><th className="num">Qty sold</th><th className="num">Item sales</th><th className="num">% of sales</th></tr></thead>
              <tbody>{dishes.map((d) => <tr key={d.title}><td>{d.title}</td><td className="num">{nfmt(d.qty)}</td><td className="num"><b>{inr(d.revenue)}</b></td><td className="num">{totalRev ? ((d.revenue / totalRev) * 100).toFixed(1) : "0.0"}%</td></tr>)}</tbody>
            </table>
          </div>
          <p className="rs-note">Item sales is menu list price × paid quantity — before discounts and tax — so it won&apos;t equal the net revenue on the Sales report.</p>
        </Panel>
      </>
    );
  }

  // ── CATEGORY MIX ──
  if (sel === "categories") {
    const cats = (data.rows ?? []) as CatRow[];
    if (!cats.length) return <EmptyCard text="No category sales in this period." />;
    const totalRev = cats.reduce((a, c) => a + c.revenue, 0);
    return (
      <>
        <div className="rs-kpis">
          <Stat label="Item sales (list price)" tone="accent" icon="fa-indian-rupee-sign" big value={inr(totalRev)} />
          <Stat label="Categories" tone="info" icon="fa-layer-group" value={nfmt(cats.length)} />
          <Stat label="Top category" tone="good" icon="fa-crown" value={cats[0]?.category || "—"} sub={`${totalRev ? Math.round((cats[0].revenue / totalRev) * 100) : 0}% of sales`} />
        </div>
        <div className="rs-grid two">
          <Panel title="Every category" pad={false}>
            <div className="rs-tablewrap">
              <table className="rs-table">
                <thead><tr><th>Category</th><th className="num">Qty</th><th className="num">Item sales</th><th className="num">%</th></tr></thead>
                <tbody>{cats.map((c) => <tr key={c.category}><td>{c.category}</td><td className="num">{nfmt(c.qty)}</td><td className="num"><b>{inr(c.revenue)}</b></td><td className="num">{totalRev ? ((c.revenue / totalRev) * 100).toFixed(1) : "0.0"}%</td></tr>)}</tbody>
              </table>
            </div>
          </Panel>
          <Panel title="Share of sales"><CategoryDonut data={cats.map((c) => ({ category: c.category, revenue: c.revenue }))} /></Panel>
        </div>
      </>
    );
  }

  // ── MENU ENGINEERING ──
  if (sel === "menu") {
    const { dishes } = classifyMenu((data.rows ?? []) as MI[]);
    if (!dishes.length) return <EmptyCard text="No dish sales in this period." />;
    const byRev = [...dishes].sort((a, b) => b.revenue - a.revenue);
    const count = (k: Klass) => dishes.filter((d) => d.klass === k).length;
    const QORDER: Klass[] = ["star", "workhorse", "puzzle", "dog"];
    return (
      <>
        <div className="rs-kpis">
          {QORDER.map((k) => <Stat key={k} label={KLASS[k].label} tone={k === "star" ? "good" : k === "workhorse" ? "info" : k === "puzzle" ? "warn" : "bad"} icon={KLASS[k].icon} value={nfmt(count(k))} sub="dishes" />)}
        </div>
        <p className="rs-note" style={{ marginBottom: 12 }}>Every dish is grouped by how <b>often</b> it&apos;s ordered and how <b>pricey</b> it is. Uses menu price (not cost) — a per-dish cost field would make this profit-true.</p>
        <div className="rs-quad">
          {QORDER.map((k) => {
            const list = byRev.filter((d) => d.klass === k);
            return (
              <div key={k} className={`rs-qbox ${k}`}>
                <div className="rs-qh"><span className="qi"><i className={`fas ${KLASS[k].icon}`} aria-hidden /></span><b>{KLASS[k].label}</b><span className="qn">{list.length}</span></div>
                <div className="rs-qsub">{KLASS[k].sub}</div>
                <div className="rs-qtip">{KLASS[k].tip}</div>
                <div className="rs-qchips">
                  {list.length === 0 ? <span className="rs-qmore">none</span> : list.slice(0, 8).map((d) => <span key={d.title} className="rs-qchip" title={`${nfmt(d.qty)} sold · ₹${Math.round(d.price)} each`}>{d.title}</span>)}
                  {list.length > 8 && <span className="rs-qmore">+{list.length - 8} more</span>}
                </div>
              </div>
            );
          })}
        </div>
        <Panel title="Product mix" hint="each dish's share of what sold" pad={false}>
          <div className="rs-tablewrap">
            <table className="rs-table">
              <thead><tr><th>Dish</th><th>Group</th><th className="num">Sold</th><th className="num">% units</th><th className="num">Item sales</th><th className="num">% sales</th></tr></thead>
              <tbody>{byRev.map((d) => <tr key={d.title}><td>{d.title}</td><td><span className={`rs-tag ${d.klass}`}>{KLASS[d.klass].label.replace(/s$/, "")}</span></td><td className="num">{nfmt(d.qty)}</td><td className="num">{(d.qtyShare * 100).toFixed(1)}%</td><td className="num"><b>{inr(d.revenue)}</b></td><td className="num">{(d.revShare * 100).toFixed(1)}%</td></tr>)}</tbody>
            </table>
          </div>
        </Panel>
      </>
    );
  }

  // ── BUSY HOURS ──
  if (sel === "hourly") {
    const hrs = (data.rows ?? []) as HourRow[];
    if (!hrs.length) return <EmptyCard text="No orders in this period yet." />;
    const totalOrders = hrs.reduce((a, h) => a + h.orders, 0);
    const totalRev = hrs.reduce((a, h) => a + h.revenue, 0);
    const peak = [...hrs].sort((a, b) => b.revenue - a.revenue)[0];
    const revSeries = Array.from({ length: 24 }, (_, h) => ({ label: `${h}:00`, revenue: hrs.find((x) => x.hour === h)?.revenue || 0 }));
    return (
      <>
        <div className="rs-kpis">
          <Stat label="Peak hour" tone="accent" icon="fa-fire" big value={`${peak.hour}:00`} sub={`${inr(peak.revenue)} · ${nfmt(peak.orders)} orders`} />
          <Stat label="Total orders" tone="info" icon="fa-list-check" value={nfmt(totalOrders)} />
          <Stat label="Total revenue" tone="accent" icon="fa-indian-rupee-sign" value={inr(totalRev)} />
        </div>
        <Panel title="Revenue by hour" pad={false}>
          <div style={{ padding: 12 }}><TimeBar data={revSeries} color={accent} height={240} /></div>
        </Panel>
        <Panel title="Orders by hour" pad={false}>
          <div style={{ padding: 12 }}><HourlyBar data={hrs.map((h) => ({ hour: h.hour, orders: h.orders }))} color={accent} /></div>
        </Panel>
      </>
    );
  }

  // ── DAY PARTS ──
  if (sel === "daypart") {
    const hrs = (data.rows ?? []) as HourRow[];
    if (!hrs.length) return <EmptyCard text="No orders in this period yet." />;
    const byHour = new Map(hrs.map((h) => [h.hour, h]));
    const parts = DAYPARTS.map((p) => {
      let rev = 0, orders = 0;
      for (const h of p.hours) { const r = byHour.get(h); if (r) { rev += r.revenue; orders += r.orders; } }
      return { ...p, rev, orders };
    });
    const totalRev = parts.reduce((a, p) => a + p.rev, 0);
    const best = parts.reduce((a, b) => (b.rev > a.rev ? b : a), parts[0]);
    const chart = parts.map((p) => ({ label: p.label, revenue: p.rev }));
    return (
      <>
        <div className="rs-kpis">
          <Stat label="Strongest part" tone="good" icon={best.icon} big value={best.rev > 0 ? best.label : "—"} sub={`${inr(best.rev)} · ${totalRev ? Math.round((best.rev / totalRev) * 100) : 0}%`} />
          {parts.map((p) => <Stat key={p.label} label={p.label} tone="info" icon={p.icon} value={inr(p.rev)} sub={`${nfmt(p.orders)} orders`} />)}
        </div>
        <Panel title="Revenue by day part" pad={false}>
          <div style={{ padding: 12 }}><TimeBar data={chart} color={accent} height={230} /></div>
        </Panel>
      </>
    );
  }

  return <EmptyCard text="Report not available." />;
}

// ── Shared money table (sales / avgbill / volume / tax) ───────────────────────
function MoneyTable({ rows, totals, bucket, showAvg }: { rows: MoneyRow[]; totals: Totals; bucket: string; showAvg?: boolean }) {
  if (!rows.length) return <EmptyCard text="Nothing in this period." />;
  return (
    <Panel title="By period" pad={false}>
      <div className="rs-tablewrap">
        <table className="rs-table">
          <thead><tr><th>Period</th><th className="num">Orders</th><th className="num">Paid</th><th className="num">Subtotal</th><th className="num">Tax</th><th className="num">Discount</th><th className="num">Revenue</th>{showAvg && <th className="num">Avg bill</th>}<th className="num">Cancelled</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.bucket}>
                <td>{bucketLabel(r.bucket, bucket)}</td>
                <td className="num">{nfmt(r.orders)}</td><td className="num">{nfmt(r.paidOrders)}</td>
                <td className="num">{inr(r.subtotal)}</td><td className="num">{inr(r.tax)}</td><td className="num">{inr(r.discount)}</td>
                <td className="num"><b>{inr(r.revenue)}</b></td>
                {showAvg && <td className="num">{inr(r.paidOrders ? r.revenue / r.paidOrders : 0)}</td>}
                <td className="num">{nfmt(r.cancelledOrders)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr>
            <td>Total</td><td className="num">{nfmt(totals.orders)}</td><td className="num">{nfmt(totals.paidOrders)}</td>
            <td className="num">{inr(totals.subtotal)}</td><td className="num">{inr(totals.tax)}</td><td className="num">{inr(totals.discount)}</td>
            <td className="num">{inr(totals.revenue)}</td>{showAvg && <td className="num">{inr(totals.paidOrders ? totals.revenue / totals.paidOrders : 0)}</td>}
            <td className="num">{nfmt(totals.cancelledOrders)}</td>
          </tr></tfoot>
        </table>
      </div>
    </Panel>
  );
}
