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
  ToggleChart, PaymentDonut, LeaderBar,
  canonPayMethod, PAY_COLORS,
} from "@/components/owner/Charts";
import {
  REPORTS, CATEGORIES, ReportsStyles, Stat, Panel, nfmt, scrollToId, type RKey, type DataKind,
} from "@/components/owner/reports/kit";
import { BestWorst, SplitBar } from "@/components/owner/reports/Insights";
import { DishesReport, CategoriesReport, MenuReport } from "@/components/owner/reports/DishReports";

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
  // Start "" so SSR and the first client render agree (reading the URL in the initial
  // state caused a hydration mismatch on the "This restaurant"/"All restaurants" label).
  // An effect below pins it from ?rid; the data fetch is gated on `ready`, so no query
  // fires against the wrong scope in the meantime. "" = all restaurants.
  const [rid, setRid] = useState<string>("");
  const [sel, setSel] = useState<RKey | "">("");         // "" = hub
  const [range, setRange] = useState<Range>("30d");
  const [store, setStore] = useState<Record<string, Entry>>({});

  // Admin act-as scope pin (mirrors app/owner/page.tsx): rides on every call so a second
  // tab's act-as cookie can't hijack this one.
  const scopePin = useMemo(() =>
    typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("rid"), []);
  const scp = scopePin ? `&scope=${scopePin}` : "";

  // Pin the scope from the URL (admin act-as ?rid) after hydration — not in the initial
  // state (that mismatches SSR). Runs once on mount, before `ready`, so the gated fetch
  // already sees the pinned rid.
  useEffect(() => { if (scopePin) setRid(scopePin); }, [scopePin]);

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
  // Charts follow the owner-panel THEME (green), not each restaurant's brand colour —
  // a brown/orange/red chart inside the green owner console read as a bug (owner 2026-07-25).
  const accent = "var(--accent)";
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
          range={range} accent={accent} restName={restName} singleRest={singleRest}
          onOpenReport={(k) => setSel(k)} />
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
  const bucket = money?.data?.bucket || "day";
  const series = rows.map((r) => ({ label: bucketLabel(r.bucket, bucket), revenue: r.revenue }));
  const avg = t && t.paidOrders ? t.revenue / t.paidOrders : 0;
  const loading = money?.loading;
  return (
    <>
      {/* Overview: the animated headline + KPIs and the revenue chart, together in one panel.
          The chart is CONTAINED here (the old hero re-used the dashboard's corner-Spark, whose
          global `.owx-spark{position:absolute}` yanked it to the page corner — the "stray graph"). */}
      <div className="rs-overview">
        <div className="rs-ov-eyebrow">{restName} · {rangeLabel(range)}</div>
        <div className="rs-ov-val"><AnimatedNumber value={t?.revenue || 0} money loading={loading} /></div>
        <div className="rs-ov-sub">Net revenue kept in this period{money?.error ? " — couldn't load" : ""}</div>
        <div className="rs-ov-kpis">
          <div className="k"><span className="lbl">Paid bills</span><span className="v"><AnimatedNumber value={t?.paidOrders || 0} format={nfmt} loading={loading} /></span></div>
          <div className="k"><span className="lbl">Avg bill</span><span className="v"><AnimatedNumber value={avg} money loading={loading} /></span></div>
          <div className="k"><span className="lbl">Tax collected</span><span className="v"><AnimatedNumber value={t?.tax || 0} money loading={loading} /></span></div>
          <div className="k"><span className="lbl">Discounts</span><span className="v"><AnimatedNumber value={t?.discount || 0} money loading={loading} /></span></div>
        </div>
        <div className="rs-ov-chart">
          {loading
            ? <div className="rs-ov-skel" aria-hidden />
            : series.length > 1
              ? <ToggleChart data={series.map((s) => ({ label: s.label, value: s.revenue }))} color={accent} money height={210} title="Revenue over the period" />
              : <div className="rs-ov-empty">Not enough data to chart this period yet.</div>}
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
function ReportView({ sel, data, loading, error, range, accent, restName, singleRest, onOpenReport }: {
  sel: RKey; data?: Payload; loading?: boolean; error?: string;
  range: Range; accent: string; restName: string; singleRest: boolean;
  onOpenReport: (k: RKey) => void;
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
        <ReportBody sel={sel} data={data} accent={accent} singleRest={singleRest} onOpenReport={onOpenReport} />
      )}
    </div>
  );
}

function EmptyCard({ text }: { text: string }) {
  return <Panel><div className="rs-empty"><i className="fas fa-inbox" aria-hidden />{text}</div></Panel>;
}

function ReportBody({ sel, data, accent, singleRest, onOpenReport }: { sel: RKey; data: Payload; accent: string; singleRest: boolean; onOpenReport: (k: RKey) => void }) {
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
          <Stat label="Tax collected" tone="accent" icon="fa-landmark" value={inr(t.tax)} onClick={() => onOpenReport("tax")} title="Open the Tax / GST report" />
          <Stat label="Cancelled" tone="bad" icon="fa-ban" value={nfmt(t.cancelledOrders)} sub={`${inr(t.cancelledValue)} lost`} onClick={() => onOpenReport("cancellations")} title="Open the Cancellations report" />
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

          <Panel title="Settlement" hint="how the money arrived"
            right={<button type="button" className="rs-drill" onClick={() => onOpenReport("payments")} title="Open the Payment settlement report">Full report <i className="fas fa-arrow-right" aria-hidden /></button>}>

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
          <>
            <BestWorst
              series={series.map((s) => ({ label: s.label, value: s.revenue }))}
              money noun="income"
              unit={bucket === "month" ? "month" : bucket === "hour" ? "hour" : "day"}
            />
            <Panel title="Revenue through the period" pad={false}>
              <div style={{ padding: 12 }}><ToggleChart data={series.map((s) => ({ label: s.label, value: s.revenue }))} color={accent} money height={220} /></div>
            </Panel>
          </>
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
          <Stat label="Revenue (kept)" tone="accent" icon="fa-indian-rupee-sign" big value={inr(t.revenue)} spark={series.map((s) => s.revenue)} onClick={() => scrollToId("rs-by-period")} title="Jump to the by-period table" />
          <Stat label="Paid bills" tone="info" icon="fa-receipt" value={nfmt(t.paidOrders)} onClick={() => onOpenReport("volume")} title="Open the Order volume report" />
          <Stat label="Gross sales" tone="accent" icon="fa-cart-shopping" value={inr(t.subtotal)} />
          <Stat label="Tax collected" tone="accent" icon="fa-landmark" value={inr(t.tax)} onClick={() => onOpenReport("tax")} title="Open the Tax / GST report" />
          <Stat label="Discounts" tone="warn" icon="fa-tag" value={inr(t.discount)} onClick={() => onOpenReport("discounts")} title="Open the Discounts report" />
        </div>
        <Panel title="Revenue over time" pad={false}>
          <div style={{ padding: 12 }}><ToggleChart data={series.map((s) => ({ label: s.label, value: s.revenue }))} color={accent} money height={240} /></div>
        </Panel>
        {series.filter((s) => s.revenue > 0).length > 1 && (
          <BestWorst
            series={series.map((s) => ({ label: s.label, value: s.revenue }))}
            money noun="revenue"
            unit={bucket === "month" ? "month" : bucket === "hour" ? "hour" : "day"}
          />
        )}
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
          <Stat label="Average bill" tone="info" icon="fa-scale-balanced" big value={inr(avg)} sub="revenue ÷ paid bills" spark={avgSeries.map((s) => s.revenue)} onClick={() => scrollToId("rs-by-period")} title="Jump to the by-period table" />
          <Stat label="Paid bills" tone="accent" icon="fa-receipt" value={nfmt(t.paidOrders)} onClick={() => onOpenReport("volume")} title="Open the Order volume report" />
          <Stat label="Highest bucket" tone="good" icon="fa-arrow-up" value={inr(withData.length ? Math.max(...withData) : 0)} />
          <Stat label="Lowest bucket" tone="warn" icon="fa-arrow-down" value={inr(withData.length ? Math.min(...withData) : 0)} />
        </div>
        <Panel title="Average bill over time" pad={false}>
          <div style={{ padding: 12 }}><ToggleChart data={avgSeries.map((s) => ({ label: s.label, value: s.revenue }))} color={accent} money name="Avg bill" height={240} /></div>
        </Panel>
        {withData.length > 1 && (
          <BestWorst
            series={avgSeries.map((s) => ({ label: s.label, value: s.revenue }))}
            money noun="basket size"
            title={`Fullest & thinnest ${bucket === "month" ? "month" : bucket === "hour" ? "hour" : "day"}`}
            unit={bucket === "month" ? "month" : bucket === "hour" ? "hour" : "day"}
          />
        )}
        <MoneyTable rows={mrows} totals={t} bucket={bucket} showAvg />
      </>
    );
  }

  // ── ORDER VOLUME ──
  if (sel === "volume") {
    if (!t) return <EmptyCard text="No orders in this period yet." />;
    const vol = mrows.map((r) => ({ label: bucketLabel(r.bucket, bucket), value: r.orders }));
    const placed = t.orders + t.cancelledOrders;
    const paidPct = placed ? (t.paidOrders / placed) * 100 : 0;
    const openOrders = Math.max(0, t.orders - t.paidOrders);   // placed, not cancelled, not yet paid
    const unitWord = bucket === "month" ? "month" : bucket === "hour" ? "hour" : "day";
    return (
      <>
        <div className="rs-kpis">
          <Stat label="Orders placed" tone="info" icon="fa-list-check" big value={nfmt(placed)} sub={`${nfmt(t.paidOrders)} paid · ${nfmt(t.cancelledOrders)} cancelled`} spark={vol.map((v) => v.value)} onClick={() => scrollToId("rs-by-period")} title="Jump to the by-period table" />
          <Stat label="Paid bills" tone="good" icon="fa-circle-check" value={nfmt(t.paidOrders)} sub={`${paidPct.toFixed(0)}% of placed`} />
          <Stat label="Cancelled" tone="bad" icon="fa-ban" value={nfmt(t.cancelledOrders)} sub={placed ? `${((t.cancelledOrders / placed) * 100).toFixed(1)}% of placed` : ""} onClick={() => onOpenReport("cancellations")} title="Open the Cancellations report" />
          <Stat label={`Busiest ${unitWord}`} tone="accent" icon="fa-fire" value={nfmt(vol.length ? Math.max(...vol.map((v) => v.value)) : 0)} sub={`orders in one ${unitWord}`} />
        </div>
        <SplitBar
          title="Where the orders went"
          segments={[
            { label: "Paid", value: t.paidOrders, tone: "good" },
            { label: "Open / unpaid", value: openOrders, tone: "info" },
            { label: "Cancelled", value: t.cancelledOrders, tone: "bad" },
          ]}
        />
        <Panel title="Orders over time" pad={false}>
          <div style={{ padding: 12 }}><ToggleChart data={vol} color={accent} money={false} name="Orders" height={240} /></div>
        </Panel>
        {vol.filter((v) => v.value > 0).length > 1 && (
          <BestWorst series={vol} money={false} noun="orders" unit={unitWord} />
        )}
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
    const FULL: Record<string, string> = { Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Fri: "Friday", Sat: "Saturday", Sun: "Sunday" };
    const rows = NAMES.map((nm) => ({ nm, ...(by.get(nm) || { rev: 0, orders: 0, days: 0 }) }));
    const chart = rows.map((r) => ({ label: r.nm, revenue: r.rev }));
    const allRev = rows.reduce((a, r) => a + r.rev, 0);
    // Only weekdays that actually occurred in the window can win/lose — a day that never
    // came round (days === 0) isn't the "worst", it just wasn't in the period.
    const seen = rows.filter((r) => r.days > 0);
    const best = seen.length ? seen.reduce((a, b) => (b.rev > a.rev ? b : a), seen[0]) : null;
    const worst = seen.length ? seen.reduce((a, b) => (b.rev < a.rev ? b : a), seen[0]) : null;
    // Weekend (Sat+Sun) vs weekday (Mon–Fri): compare per-DAY averages, not totals, so a
    // 2-day weekend isn't unfairly dwarfed by a 5-day working week.
    const WKEND = new Set(["Sat", "Sun"]);
    const wkRev = rows.filter((r) => WKEND.has(r.nm)).reduce((a, r) => a + r.rev, 0);
    const wkDays = rows.filter((r) => WKEND.has(r.nm)).reduce((a, r) => a + r.days, 0);
    const wdRev = rows.filter((r) => !WKEND.has(r.nm)).reduce((a, r) => a + r.rev, 0);
    const wdDays = rows.filter((r) => !WKEND.has(r.nm)).reduce((a, r) => a + r.days, 0);
    const wkAvg = wkDays ? wkRev / wkDays : 0;
    const wdAvg = wdDays ? wdRev / wdDays : 0;
    const gap = wdAvg ? ((wkAvg - wdAvg) / wdAvg) * 100 : 0;
    const goodTint = { background: "color-mix(in srgb, var(--adm-ok) 11%, transparent)" };
    const badTint = { background: "color-mix(in srgb, var(--adm-warn) 11%, transparent)" };
    return (
      <>
        <div className="rs-kpis">
          <Stat label="Best weekday" tone="good" icon="fa-crown" big value={best ? FULL[best.nm] : "—"} sub={best ? `${inr(best.rev)} · ${inr(best.days ? best.rev / best.days : 0)}/day` : "no data yet"} onClick={best ? () => scrollToId("rs-weekday-breakdown") : undefined} title={best ? "Jump to the day-of-week breakdown" : undefined} />
          <Stat label="Slowest weekday" tone="warn" icon="fa-arrow-trend-down" value={worst ? FULL[worst.nm] : "—"} sub={worst ? `${inr(worst.rev)} · ${inr(worst.days ? worst.rev / worst.days : 0)}/day` : ""} onClick={worst ? () => scrollToId("rs-weekday-breakdown") : undefined} title={worst ? "Jump to the day-of-week breakdown" : undefined} />
          <Stat label="Weekend share" tone="info" icon="fa-champagne-glasses" value={allRev ? `${Math.round((wkRev / allRev) * 100)}%` : "0%"} sub="Sat + Sun of revenue" />
          <Stat label="Weekend / day" tone="accent" icon="fa-calendar-day" value={inr(wkAvg)} sub={`across ${nfmt(wkDays)} day${wkDays === 1 ? "" : "s"}`} />
          <Stat label="Weekday / day" tone="accent" icon="fa-calendar-day" value={inr(wdAvg)} sub={`across ${nfmt(wdDays)} day${wdDays === 1 ? "" : "s"}`} />
        </div>
        {wkDays > 0 && wdDays > 0 && (
          <p className="rs-note" style={{ marginBottom: 12 }}>
            An average <b>weekend</b> day takes <b>{inr(wkAvg)}</b> versus <b>{inr(wdAvg)}</b> on a working day —{" "}
            {Math.abs(gap) < 1 ? "about the same." : <><b>{Math.abs(Math.round(gap))}% {gap > 0 ? "more" : "less"}</b> on the weekend.</>}
          </p>
        )}
        <Panel title="Revenue by day of week" pad={false}>
          <div style={{ padding: 12 }}><ToggleChart data={chart.map((c) => ({ label: c.label, value: c.revenue }))} color={accent} money height={240} title="Which day earns most" /></div>
        </Panel>
        <Panel id="rs-weekday-breakdown" title="Breakdown" hint="each day added up across the period" pad={false}>
          <div className="rs-tablewrap">
            <table className="rs-table">
              <thead><tr><th>Day</th><th className="num">Days counted</th><th className="num">Paid bills</th><th className="num">Revenue</th><th className="num">% of week</th><th className="num">Avg / day</th></tr></thead>
              <tbody>{rows.map((r) => {
                const isBest = best && r.nm === best.nm && r.rev > 0;
                const isWorst = worst && r.nm === worst.nm && !isBest && r.days > 0;
                return (
                  <tr key={r.nm} style={isBest ? goodTint : isWorst ? badTint : undefined}>
                    <td>{FULL[r.nm]}{isBest && <i className="fas fa-crown" aria-hidden style={{ color: "var(--adm-ok)", marginLeft: 6, fontSize: 10 }} />}{isWorst && <i className="fas fa-arrow-trend-down" aria-hidden style={{ color: "var(--adm-warn)", marginLeft: 6, fontSize: 10 }} />}</td>
                    <td className="num">{r.days}</td><td className="num">{nfmt(r.orders)}</td>
                    <td className="num"><b>{inr(r.rev)}</b></td>
                    <td className="num">{allRev ? ((r.rev / allRev) * 100).toFixed(1) : "0.0"}%</td>
                    <td className="num">{inr(r.days ? r.rev / r.days : 0)}</td>
                  </tr>
                );
              })}</tbody>
              <tfoot><tr>
                <td>Total</td><td className="num">{nfmt(rows.reduce((a, r) => a + r.days, 0))}</td>
                <td className="num">{nfmt(rows.reduce((a, r) => a + r.orders, 0))}</td>
                <td className="num">{inr(allRev)}</td><td className="num">100%</td>
                <td className="num">{inr((wkDays + wdDays) ? allRev / (wkDays + wdDays) : 0)}</td>
              </tr></tfoot>
            </table>
          </div>
        </Panel>
      </>
    );
  }

  // ── TAX / GST ──
  if (sel === "tax") {
    if (!t) return <EmptyCard text="No taxable sales in this period yet." />;
    const taxable = t.subtotal - t.discount;                       // the value tax is charged on
    const actualPct = taxable ? (t.tax / taxable) * 100 : 0;       // rate the numbers actually realised
    const configuredPct = data.tax?.effectivePct ?? null;         // the rate that's set up
    const rateOk = configuredPct == null || Math.abs(actualPct - configuredPct) < 0.5;
    const avgTaxPerBill = t.paidOrders ? t.tax / t.paidOrders : 0;
    const comps = data.tax?.components ?? [];
    // Per-period filing view: split each period's tax across the set tax lines, integer-rounded
    // so each row's parts still sum to that row's total tax (matches the printed-bill split).
    const filingRows = (comps.length ? mrows.filter((r) => r.tax > 0) : []).map((r) => ({
      bucket: r.bucket,
      taxable: r.subtotal - r.discount,
      tax: r.tax,
      parts: roundToSum(comps.map((c) => (configuredPct ? r.tax * (c.rate / configuredPct) : r.tax / comps.length)), r.tax),
    }));
    const compTotals = comps.map((_, i) => filingRows.reduce((a, r) => a + r.parts[i], 0));
    const filingTaxable = filingRows.reduce((a, r) => a + r.taxable, 0);
    const filingTax = filingRows.reduce((a, r) => a + r.tax, 0);
    return (
      <>
        <div className="rs-kpis">
          <Stat label="Tax collected" tone="accent" icon="fa-landmark" big value={inr(t.tax)} sub={`${nfmt(t.paidOrders)} paid bills`} spark={mrows.map((r) => r.tax)} onClick={() => scrollToId("rs-by-period")} title="Jump to the by-period table" />
          <Stat label="Taxable sales" tone="accent" icon="fa-cart-shopping" value={inr(taxable)} sub="subtotal − discount" />
          <Stat label="Effective rate" tone={rateOk ? "good" : "warn"} icon="fa-percent" value={`${actualPct.toFixed(2)}%`}
            sub={configuredPct != null ? (rateOk ? `matches the set ${configuredPct}%` : `set rate is ${configuredPct}%`) : "tax ÷ taxable sales"} />
          <Stat label="Tax per bill" tone="info" icon="fa-receipt" value={inr(avgTaxPerBill)} sub="average" />
        </div>
        {configuredPct != null && !rateOk && (
          <p className="rs-note" style={{ marginTop: -4, marginBottom: 12 }}>
            <i className="fas fa-triangle-exclamation" aria-hidden style={{ color: "var(--adm-warn)", marginRight: 6 }} />
            The rate the bills actually realised ({actualPct.toFixed(2)}%) doesn&apos;t match the set rate ({configuredPct}%) — usually from tax-free or specially-priced items in this period. Worth a look before filing.
          </p>
        )}
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
        <Panel title="Tax over time" pad={false}>
          <div style={{ padding: 12 }}><ToggleChart data={mrows.map((r) => ({ label: bucketLabel(r.bucket, bucket), value: r.tax }))} color={accent} money name="Tax" height={220} /></div>
        </Panel>
        {filingRows.length > 0 && (
          <Panel title="Tax by period — filing view" hint="taxable value and each tax line, per period" pad={false}>
            <div className="rs-tablewrap">
              <table className="rs-table">
                <thead><tr><th>Period</th><th className="num">Taxable value</th>{comps.map((c) => <th key={c.label} className="num">{c.label} ({c.rate}%)</th>)}<th className="num">Total tax</th></tr></thead>
                <tbody>{filingRows.map((r) => (
                  <tr key={r.bucket}>
                    <td>{bucketLabel(r.bucket, bucket)}</td>
                    <td className="num">{inr(r.taxable)}</td>
                    {r.parts.map((amt, i) => <td key={comps[i].label} className="num">{inr(amt)}</td>)}
                    <td className="num"><b>{inr(r.tax)}</b></td>
                  </tr>
                ))}</tbody>
                <tfoot><tr><td>Total</td><td className="num">{inr(filingTaxable)}</td>{compTotals.map((amt, i) => <td key={comps[i].label} className="num">{inr(amt)}</td>)}<td className="num">{inr(filingTax)}</td></tr></tfoot>
              </table>
            </div>
            <p className="rs-note">Each period&apos;s tax is split across the set tax lines and rounded so the parts add back to that period&apos;s total — ready to copy into a return.</p>
          </Panel>
        )}
        <MoneyTable rows={mrows} totals={t} bucket={bucket} />
      </>
    );
  }

  // ── DISCOUNTS GIVEN ──
  if (sel === "discounts") {
    if (!t) return <EmptyCard text="No sales in this period yet." />;
    const discRows = mrows.filter((r) => r.discount > 0);
    const effPct = t.subtotal ? (t.discount / t.subtotal) * 100 : 0;
    const byDisc = [...discRows].sort((a, b) => b.discount - a.discount);
    const biggest = byDisc[0];
    const totalDisc = discRows.reduce((a, r) => a + r.discount, 0);
    const top5 = byDisc.slice(0, 5).map((r) => ({ id: r.bucket, name: bucketLabel(r.bucket, bucket), revenue: r.discount, orders: r.paidOrders, accentColor: accent }));
    const top5Share = totalDisc ? (top5.reduce((a, d) => a + d.revenue, 0) / totalDisc) * 100 : 0;
    // Trend: is the discount RATE (share of sales given away) rising or easing across the period?
    const rateOf = (r: MoneyRow) => (r.subtotal ? (r.discount / r.subtotal) * 100 : 0);
    const half = Math.floor(discRows.length / 2);
    const firstAvg = half ? discRows.slice(0, half).reduce((a, r) => a + rateOf(r), 0) / half : 0;
    const lastAvg = discRows.length - half ? discRows.slice(half).reduce((a, r) => a + rateOf(r), 0) / (discRows.length - half) : 0;
    const trendDelta = lastAvg - firstAvg;
    const trend = discRows.length < 4 ? "steady" : trendDelta > 0.5 ? "rising" : trendDelta < -0.5 ? "easing" : "steady";
    return (
      <>
        <div className="rs-kpis">
          <Stat label="Discounts given" tone="warn" icon="fa-tag" big value={inr(t.discount)} sub={`over ${nfmt(discRows.length)} day${discRows.length === 1 ? "" : "s"}`} spark={mrows.map((r) => r.discount)} />
          <Stat label="Effective rate" tone="warn" icon="fa-percent" value={`${effPct.toFixed(1)}%`} sub="of gross sales" />
          <Stat label="Revenue after discounts" tone="accent" icon="fa-indian-rupee-sign" value={inr(t.revenue)} onClick={() => onOpenReport("sales")} title="Open the Sales trend report" />
          <Stat label="Paid bills" tone="info" icon="fa-receipt" value={nfmt(t.paidOrders)} />
          <Stat label="Biggest day" tone="bad" icon="fa-arrow-up" value={biggest ? inr(biggest.discount) : "—"} sub={biggest ? bucketLabel(biggest.bucket, bucket) : ""} onClick={biggest ? () => scrollToId("rs-disc-days") : undefined} title={biggest ? "Jump to the days-with-discounts table" : undefined} />
        </div>
        <Panel title="Discounts over time" pad={false}>
          <div style={{ padding: 12 }}><ToggleChart data={mrows.map((r) => ({ label: bucketLabel(r.bucket, bucket), value: r.discount }))} color={accent} money name="Discount" height={240} /></div>
        </Panel>
        {top5.length > 0 && (
          <Panel title="Biggest discount days" hint="top 5 by amount given away">
            <LeaderBar data={top5} />
            <p className="rs-note">
              These {top5.length} day{top5.length === 1 ? "" : "s"} account for {top5Share.toFixed(0)}% of everything discounted this period.
              {" "}Discounting is <b>{trend}</b>{trend === "steady" ? " — the give-away rate is holding flat." : trend === "rising" ? ` — the give-away rate climbed from ~${firstAvg.toFixed(1)}% to ~${lastAvg.toFixed(1)}% of sales.` : ` — the give-away rate fell from ~${firstAvg.toFixed(1)}% to ~${lastAvg.toFixed(1)}% of sales.`}
            </p>
          </Panel>
        )}
        <Panel id="rs-disc-days" title="Days with discounts" hint="only days a discount was given" pad={false}>
          <div className="rs-tablewrap">
            <table className="rs-table">
              <thead><tr><th>Period</th><th className="num">Paid bills</th><th className="num">Discount</th><th className="num">Revenue</th><th className="num">Disc. rate</th></tr></thead>
              <tbody>{discRows.length ? discRows.map((r) => <tr key={r.bucket}><td>{bucketLabel(r.bucket, bucket)}</td><td className="num">{nfmt(r.paidOrders)}</td><td className="num"><b>{inr(r.discount)}</b></td><td className="num">{inr(r.revenue)}</td><td className="num">{r.subtotal ? ((r.discount / r.subtotal) * 100).toFixed(1) : "0.0"}%</td></tr>) : <tr><td colSpan={5} style={{ textAlign: "center", color: "var(--muted)", padding: 22 }}>No discounts were given in this period.</td></tr>}</tbody>
              {discRows.length > 0 && <tfoot><tr><td>Total</td><td className="num">{nfmt(discRows.reduce((a, r) => a + r.paidOrders, 0))}</td><td className="num">{inr(totalDisc)}</td><td className="num">{inr(discRows.reduce((a, r) => a + r.revenue, 0))}</td><td className="num">{effPct.toFixed(1)}%</td></tr></tfoot>}
            </table>
          </div>
        </Panel>
      </>
    );
  }

  // ── CANCELLATIONS ──
  if (sel === "cancellations") {
    if (!t) return <EmptyCard text="No orders in this period yet." />;
    const cxRows = mrows.filter((r) => r.cancelledOrders > 0);
    const placed = t.orders + t.cancelledOrders;
    const cxPct = placed ? (t.cancelledOrders / placed) * 100 : 0;
    const byLoss = [...cxRows].sort((a, b) => b.cancelledValue - a.cancelledValue);
    const worst = byLoss[0];
    const top5 = byLoss.slice(0, 5).map((r) => ({ id: r.bucket, name: bucketLabel(r.bucket, bucket), revenue: r.cancelledValue, orders: r.cancelledOrders, accentColor: accent }));
    const top5Share = t.cancelledValue ? (top5.reduce((a, d) => a + d.revenue, 0) / t.cancelledValue) * 100 : 0;
    const avgPerCx = t.cancelledOrders ? t.cancelledValue / t.cancelledOrders : 0;
    // Health band on the cancel rate — plain words + a tone so the note reads at a glance.
    const health = cxPct >= 8 ? { word: "high", tone: "var(--adm-danger)", icon: "fa-triangle-exclamation" }
      : cxPct >= 4 ? { word: "worth watching", tone: "var(--adm-warn)", icon: "fa-circle-exclamation" }
      : { word: "healthy", tone: "var(--adm-ok)", icon: "fa-circle-check" };
    return (
      <>
        <div className="rs-kpis">
          <Stat label="Value lost" tone="bad" icon="fa-ban" big value={inr(t.cancelledValue)} sub={`over ${nfmt(cxRows.length)} day${cxRows.length === 1 ? "" : "s"}`} spark={mrows.map((r) => r.cancelledValue)} />
          <Stat label="Cancelled orders" tone="bad" icon="fa-circle-xmark" value={nfmt(t.cancelledOrders)} sub={`${cxPct.toFixed(1)}% of all placed`} />
          <Stat label="Avg lost / cancel" tone="warn" icon="fa-scale-balanced" value={inr(avgPerCx)} />
          <Stat label="Kept revenue" tone="accent" icon="fa-indian-rupee-sign" value={inr(t.revenue)} onClick={() => onOpenReport("sales")} title="Open the Sales trend report" />
          <Stat label="Worst day" tone="warn" icon="fa-arrow-up" value={worst ? inr(worst.cancelledValue) : "—"} sub={worst ? bucketLabel(worst.bucket, bucket) : ""} onClick={worst ? () => scrollToId("rs-cx-days") : undefined} title={worst ? "Jump to the days-with-cancellations table" : undefined} />
        </div>
        <p className="rs-note" style={{ marginTop: -4, marginBottom: 12 }}>
          <i className={`fas ${health.icon}`} aria-hidden style={{ color: health.tone, marginRight: 6 }} />
          Your cancel rate is <b>{cxPct.toFixed(1)}%</b> ({health.word}) — {nfmt(t.cancelledOrders)} of {nfmt(placed)} placed orders were voided, losing {inr(t.cancelledValue)} (about {inr(avgPerCx)} per cancel).
        </p>
        <Panel title="Value lost over time" pad={false}>
          <div style={{ padding: 12 }}><ToggleChart data={mrows.map((r) => ({ label: bucketLabel(r.bucket, bucket), value: r.cancelledValue }))} color={accent} money name="Lost value" height={240} /></div>
        </Panel>
        {top5.length > 0 && (
          <Panel title="Worst cancellation days" hint="top 5 by value lost">
            <LeaderBar data={top5} />
            <p className="rs-note">These {top5.length} day{top5.length === 1 ? "" : "s"} account for {top5Share.toFixed(0)}% of all the value lost to cancellations this period.</p>
          </Panel>
        )}
        <Panel id="rs-cx-days" title="Days with cancellations" hint="only days something was voided" pad={false}>
          <div className="rs-tablewrap">
            <table className="rs-table">
              <thead><tr><th>Period</th><th className="num">Cancelled orders</th><th className="num">Value lost</th><th className="num">Kept revenue</th></tr></thead>
              <tbody>{cxRows.length ? cxRows.map((r) => <tr key={r.bucket}><td>{bucketLabel(r.bucket, bucket)}</td><td className="num">{nfmt(r.cancelledOrders)}</td><td className="num"><b>{inr(r.cancelledValue)}</b></td><td className="num">{inr(r.revenue)}</td></tr>) : <tr><td colSpan={4} style={{ textAlign: "center", color: "var(--muted)", padding: 22 }}>No cancellations in this period.</td></tr>}</tbody>
              {cxRows.length > 0 && <tfoot><tr><td>Total</td><td className="num">{nfmt(t.cancelledOrders)}</td><td className="num">{inr(t.cancelledValue)}</td><td className="num">{inr(cxRows.reduce((a, r) => a + r.revenue, 0))}</td></tr></tfoot>}
            </table>
          </div>
        </Panel>
      </>
    );
  }

  // ── PAYMENT SETTLEMENT ──
  if (sel === "payments") {
    const raw = (data.rows ?? []) as PayRow[];
    if (!raw.length) return <EmptyCard text="No payments recorded in this period." />;
    // Merge by canonical method (mirrors PaymentDonut) so the table and the donut agree.
    const merged = new Map<string, PayRow & { method: string }>();
    for (const p of raw) {
      const method = canonPayMethod(p.method);
      const row = merged.get(method) || { method, revenue: 0, orders: 0 };
      row.revenue += p.revenue; row.orders += p.orders;
      merged.set(method, row);
    }
    const pays = [...merged.values()].filter((p) => p.revenue > 0).sort((a, b) => b.revenue - a.revenue);
    const total = pays.reduce((a, p) => a + p.revenue, 0);
    const bills = pays.reduce((a, p) => a + p.orders, 0);
    const top = pays[0];
    const topShare = total ? (top.revenue / total) * 100 : 0;
    const avgBill = bills ? total / bills : 0;
    return (
      <>
        <div className="rs-kpis">
          <Stat label="Total collected" tone="accent" icon="fa-indian-rupee-sign" big value={inr(total)} sub={`${nfmt(bills)} bills settled`} />
          <Stat label="Bills settled" tone="info" icon="fa-receipt" value={nfmt(bills)} />
          <Stat label="Average bill" tone="info" icon="fa-scale-balanced" value={inr(avgBill)} />
          <Stat label="Top method" tone="good" icon="fa-wallet" value={canonPayMethod(top?.method)} sub={`${Math.round(topShare)}% of money · ${nfmt(top?.orders || 0)} bills`} onClick={() => scrollToId("rs-pay-method")} title="Jump to the per-method table" />
          <Stat label="Methods used" tone="info" icon="fa-layer-group" value={nfmt(pays.length)} onClick={() => scrollToId("rs-pay-method")} title="Jump to the per-method table" />
        </div>
        <div className="rs-grid two">
          <Panel id="rs-pay-method" title="Per method" hint="bills, money and average" pad={false}>
            <div className="rs-tablewrap">
              <table className="rs-table">
                <thead><tr><th>Method</th><th className="num">Bills</th><th className="num">Revenue</th><th className="num">% share</th><th className="num">Avg bill</th></tr></thead>
                <tbody>{pays.map((p) => {
                  const share = total ? (p.revenue / total) * 100 : 0;
                  const dom = p.method === top.method;
                  return (
                    <tr key={p.method} style={dom ? { background: "color-mix(in srgb, var(--accent) 8%, transparent)" } : undefined}>
                      <td>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                          <span style={{ width: 10, height: 10, borderRadius: 3, background: PAY_COLORS[p.method] || PAY_COLORS["Not recorded"], flexShrink: 0 }} />
                          {p.method}
                          {dom && <span className="rs-tag" style={{ background: "color-mix(in srgb, var(--accent) 16%, transparent)", color: "var(--accent)" }}>Top</span>}
                        </span>
                      </td>
                      <td className="num">{nfmt(p.orders)}</td>
                      <td className="num"><b>{inr(p.revenue)}</b></td>
                      <td className="num">{share.toFixed(1)}%</td>
                      <td className="num">{inr(p.orders ? p.revenue / p.orders : 0)}</td>
                    </tr>
                  );
                })}</tbody>
                <tfoot><tr><td>Total</td><td className="num">{nfmt(bills)}</td><td className="num">{inr(total)}</td><td className="num">100%</td><td className="num">{inr(avgBill)}</td></tr></tfoot>
              </table>
            </div>
          </Panel>
          <Panel title="How the money arrived"><PaymentDonut data={pays} /></Panel>
        </div>
        <p className="rs-note">
          <b>{canonPayMethod(top?.method)}</b> is the dominant way guests pay — {Math.round(topShare)}% of collections ({inr(top.revenue)}) across {nfmt(top.orders)} bill{top.orders === 1 ? "" : "s"}.
        </p>
      </>
    );
  }

  // ── ITEM SALES ──
  if (sel === "dishes") {
    const dishes = (data.rows ?? []) as DishRow[];
    if (!dishes.length) return <EmptyCard text="No dish sales in this period." />;
    return <DishesReport rows={dishes} onOpenReport={onOpenReport} />;
  }

  // ── CATEGORY MIX ──
  if (sel === "categories") {
    const cats = (data.rows ?? []) as CatRow[];
    if (!cats.length) return <EmptyCard text="No category sales in this period." />;
    return <CategoriesReport rows={cats} onOpenReport={onOpenReport} />;
  }

  // ── MENU ENGINEERING ──
  if (sel === "menu") {
    const mrowsMenu = (data.rows ?? []) as MI[];
    if (!classifyMenu(mrowsMenu).dishes.length) return <EmptyCard text="No dish sales in this period." />;
    return <MenuReport rows={mrowsMenu} onOpenReport={onOpenReport} />;
  }

  // ── BUSY HOURS ──
  if (sel === "hourly") {
    const hrs = (data.rows ?? []) as HourRow[];
    if (!hrs.length) return <EmptyCard text="No orders in this period yet." />;
    // 12-hour clock label ("2 PM") — friendlier than "14:00" on a customer-facing report.
    const hourLabel = (h: number) => `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? "AM" : "PM"}`;
    const totalOrders = hrs.reduce((a, h) => a + h.orders, 0);
    const totalRev = hrs.reduce((a, h) => a + h.revenue, 0);
    const avgBill = totalOrders ? totalRev / totalOrders : 0;
    const byRev = [...hrs].sort((a, b) => b.revenue - a.revenue);
    const peak = byRev[0];
    // "Quietest" only makes sense among hours that actually took an order.
    const active = hrs.filter((h) => h.orders > 0).sort((a, b) => a.revenue - b.revenue);
    const quietest = active[0] || null;
    const top3 = byRev.slice(0, 3).filter((h) => h.revenue > 0);
    const top3Rev = top3.reduce((a, h) => a + h.revenue, 0);
    const top3Share = totalRev ? Math.round((top3Rev / totalRev) * 100) : 0;
    const revSeries = Array.from({ length: 24 }, (_, h) => ({ label: hourLabel(h), value: hrs.find((x) => x.hour === h)?.revenue || 0 }));
    const ordSeries = Array.from({ length: 24 }, (_, h) => ({ label: hourLabel(h), value: hrs.find((x) => x.hour === h)?.orders || 0 }));
    const tableRows = active.slice().sort((a, b) => a.hour - b.hour);   // active hours, chronological
    const goodTint = { background: "color-mix(in srgb, var(--adm-ok) 11%, transparent)" };
    return (
      <>
        <div className="rs-kpis">
          <Stat label="Peak hour" tone="accent" icon="fa-fire" big value={hourLabel(peak.hour)} sub={`${inr(peak.revenue)} · ${nfmt(peak.orders)} orders`} spark={ordSeries.map((s) => s.value)} onClick={() => scrollToId("rs-hourly-table")} title="Jump to the hour-by-hour table" />
          <Stat label="Quietest hour" tone="info" icon="fa-moon" value={quietest ? hourLabel(quietest.hour) : "—"} sub={quietest ? `${inr(quietest.revenue)} · ${nfmt(quietest.orders)} orders` : "no orders yet"} onClick={quietest ? () => scrollToId("rs-hourly-table") : undefined} title={quietest ? "Jump to the hour-by-hour table" : undefined} />
          <Stat label="Total orders" tone="info" icon="fa-list-check" value={nfmt(totalOrders)} />
          <Stat label="Total revenue" tone="accent" icon="fa-indian-rupee-sign" value={inr(totalRev)} />
          <Stat label="Avg bill" tone="good" icon="fa-scale-balanced" value={inr(avgBill)} sub="revenue ÷ orders" />
        </div>
        {top3.length > 0 && (
          <p className="rs-note" style={{ marginBottom: 12 }}>
            Your three busiest hours — <b>{top3.map((h) => hourLabel(h.hour)).join(", ")}</b> — bring in{" "}
            <b>{top3Share}%</b> of the period&apos;s revenue. Staff and stock for those windows first.
          </p>
        )}
        <Panel title="Revenue by hour" pad={false}>
          <div style={{ padding: 12 }}><ToggleChart data={revSeries} color={accent} money height={240} title="When the money comes in" /></div>
        </Panel>
        <Panel title="Orders by hour" pad={false}>
          <div style={{ padding: 12 }}><ToggleChart data={ordSeries} color={accent} money={false} name="Orders" height={210} title="When it's busiest" /></div>
        </Panel>
        <Panel id="rs-hourly-table" title="Hour by hour" hint="only hours with orders" pad={false}>
          <div className="rs-tablewrap">
            <table className="rs-table">
              <thead><tr><th>Hour</th><th className="num">Orders</th><th className="num">Revenue</th><th className="num">% of revenue</th><th className="num">Avg bill</th></tr></thead>
              <tbody>{tableRows.map((h) => {
                const isPeak = h.hour === peak.hour && h.revenue > 0;
                return (
                  <tr key={h.hour} style={isPeak ? goodTint : undefined}>
                    <td>{hourLabel(h.hour)}{isPeak && <i className="fas fa-fire" aria-hidden style={{ color: "var(--adm-ok)", marginLeft: 6, fontSize: 10 }} />}</td>
                    <td className="num">{nfmt(h.orders)}</td>
                    <td className="num"><b>{inr(h.revenue)}</b></td>
                    <td className="num">{totalRev ? ((h.revenue / totalRev) * 100).toFixed(1) : "0.0"}%</td>
                    <td className="num">{inr(h.orders ? h.revenue / h.orders : 0)}</td>
                  </tr>
                );
              })}</tbody>
              <tfoot><tr>
                <td>Total</td><td className="num">{nfmt(totalOrders)}</td><td className="num">{inr(totalRev)}</td>
                <td className="num">100%</td><td className="num">{inr(avgBill)}</td>
              </tr></tfoot>
            </table>
          </div>
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
    const totalOrders = parts.reduce((a, p) => a + p.orders, 0);
    const best = parts.reduce((a, b) => (b.rev > a.rev ? b : a), parts[0]);
    // "Quietest" among parts that actually took money — an empty part isn't the weakest.
    const active = parts.filter((p) => p.rev > 0);
    const weakest = active.length ? active.reduce((a, b) => (b.rev < a.rev ? b : a), active[0]) : null;
    const chart = parts.map((p) => ({ label: p.label, revenue: p.rev }));
    const goodTint = { background: "color-mix(in srgb, var(--adm-ok) 11%, transparent)" };
    const badTint = { background: "color-mix(in srgb, var(--adm-warn) 11%, transparent)" };
    return (
      <>
        <div className="rs-kpis">
          <Stat label="Strongest part" tone="good" icon={best.icon} big value={best.rev > 0 ? best.label : "—"} sub={best.rev > 0 ? `${inr(best.rev)} · ${totalRev ? Math.round((best.rev / totalRev) * 100) : 0}% of revenue` : "no data yet"} onClick={best.rev > 0 ? () => scrollToId("rs-daypart-breakdown") : undefined} title={best.rev > 0 ? "Jump to the day-part breakdown" : undefined} />
          <Stat label="Quietest part" tone="warn" icon="fa-arrow-trend-down" value={weakest ? weakest.label : "—"} sub={weakest ? `${inr(weakest.rev)} · ${totalRev ? Math.round((weakest.rev / totalRev) * 100) : 0}% of revenue` : ""} onClick={weakest ? () => scrollToId("rs-daypart-breakdown") : undefined} title={weakest ? "Jump to the day-part breakdown" : undefined} />
          {parts.map((p) => <Stat key={p.label} label={p.label} tone="info" icon={p.icon} value={inr(p.rev)} sub={`${nfmt(p.orders)} orders`} />)}
        </div>
        {best.rev > 0 && (
          <p className="rs-note" style={{ marginBottom: 12 }}>
            <b>{best.label}</b> is your money-maker — <b>{totalRev ? Math.round((best.rev / totalRev) * 100) : 0}%</b> of everything you take.
            {weakest && weakest.label !== best.label && <> <b>{weakest.label}</b> is the quietest stretch; a small offer there can even out the day.</>}
          </p>
        )}
        <Panel title="Revenue by day part" pad={false}>
          <div style={{ padding: 12 }}><ToggleChart data={chart.map((c) => ({ label: c.label, value: c.revenue }))} color={accent} money height={230} title="How the day splits" /></div>
        </Panel>
        <Panel id="rs-daypart-breakdown" title="Breakdown" hint="each stretch of the day" pad={false}>
          <div className="rs-tablewrap">
            <table className="rs-table">
              <thead><tr><th>Day part</th><th className="num">Orders</th><th className="num">Revenue</th><th className="num">% share</th><th className="num">Avg bill</th></tr></thead>
              <tbody>{parts.map((p) => {
                const isBest = p.label === best.label && p.rev > 0;
                const isWorst = weakest && p.label === weakest.label && !isBest;
                return (
                  <tr key={p.label} style={isBest ? goodTint : isWorst ? badTint : undefined}>
                    <td><i className={`fas ${p.icon}`} aria-hidden style={{ color: "var(--muted)", marginRight: 8, fontSize: 11, width: 14 }} />{p.label}
                      {isBest && <i className="fas fa-crown" aria-hidden style={{ color: "var(--adm-ok)", marginLeft: 6, fontSize: 10 }} />}
                      {isWorst && <i className="fas fa-arrow-trend-down" aria-hidden style={{ color: "var(--adm-warn)", marginLeft: 6, fontSize: 10 }} />}
                    </td>
                    <td className="num">{nfmt(p.orders)}</td>
                    <td className="num"><b>{inr(p.rev)}</b></td>
                    <td className="num">{totalRev ? ((p.rev / totalRev) * 100).toFixed(1) : "0.0"}%</td>
                    <td className="num">{inr(p.orders ? p.rev / p.orders : 0)}</td>
                  </tr>
                );
              })}</tbody>
              <tfoot><tr>
                <td>Total</td><td className="num">{nfmt(totalOrders)}</td><td className="num">{inr(totalRev)}</td>
                <td className="num">100%</td><td className="num">{inr(totalOrders ? totalRev / totalOrders : 0)}</td>
              </tr></tfoot>
            </table>
          </div>
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
    <Panel id="rs-by-period" title="By period" pad={false}>
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
