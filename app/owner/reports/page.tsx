"use client";
// Owner · Reports (redesign 2026-07-04). On-demand only — a report exists when the
// owner ASKS for one (never compulsory/scheduled, owner's rule). Eight well-named
// reports instead of a 300-report jungle: pick a report + a period (+ a restaurant
// when there's more than one), hit Generate, read it, download it as CSV or print
// it. The Tax / GST report shows the ONE merged rate the manager panel shows, then
// breaks the same figure into its named components (CGST/SGST/…) underneath —
// identical totals, only the presentation differs (owner's tax spec).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { inr } from "@/components/admin/shared";
import { TimeBar, LeaderBar } from "@/components/owner/Charts";

type RType = "sales" | "tax" | "dishes" | "categories" | "payments" | "discounts" | "cancellations" | "hourly" | "menu";
type Range = "today" | "yesterday" | "7d" | "30d" | "month" | "lastmonth" | "12m" | "fy";

const REPORTS: { k: RType; label: string; icon: string; blurb: string }[] = [
  { k: "sales", label: "Sales summary", icon: "fa-chart-line", blurb: "Money in, per day — subtotal, tax, discounts, what you kept" },
  { k: "tax", label: "Tax / GST", icon: "fa-landmark", blurb: "Tax collected, with the CGST/SGST split for filing" },
  { k: "dishes", label: "Dishes (item-wise)", icon: "fa-utensils", blurb: "Every dish: how many sold, what it earned" },
  { k: "categories", label: "Categories", icon: "fa-layer-group", blurb: "Which sections of the menu earn" },
  { k: "menu", label: "Menu insights", icon: "fa-lightbulb", blurb: "Which dishes to promote, reprice or drop — popularity vs price" },
  { k: "payments", label: "Payment methods", icon: "fa-wallet", blurb: "UPI vs cash vs card" },
  { k: "discounts", label: "Discounts", icon: "fa-tag", blurb: "What was given away, when" },
  { k: "cancellations", label: "Cancellations", icon: "fa-ban", blurb: "Lost business — voided orders and their value" },
  { k: "hourly", label: "Busy hours", icon: "fa-clock", blurb: "Revenue by hour of day (order counts in the table)" },
];
// Rolling windows first, then the calendar/filing periods a GST return actually needs.
const RANGES: { k: Range; label: string }[] = [
  { k: "today", label: "Today" }, { k: "yesterday", label: "Yesterday" },
  { k: "7d", label: "7 days" }, { k: "30d", label: "30 days" },
  { k: "month", label: "This month" }, { k: "lastmonth", label: "Last month" },
  { k: "12m", label: "12 months" }, { k: "fy", label: "FY (Apr–Mar)" },
];

type Row = Record<string, unknown>;
type MoneyRow = { bucket: string; orders: number; paidOrders: number; subtotal: number; tax: number; discount: number; revenue: number; cancelledOrders: number; cancelledValue: number };
type TaxInfo = { effectivePct: number; components: { label: string; rate: number; amount: number }[]; configured: boolean } | null;
type Report = { type: RType; range: Range; rows: Row[]; totals?: Record<string, number>; tax?: TaxInfo };
type Rest = { id: string; name: string };

const PAY_LABEL: Record<string, string> = { upi: "UPI", cash: "Cash", card: "Card", other: "Other" };
// Look the friendly label up case-INsensitively — a stored "UPI"/"Cash" would otherwise
// miss the lowercase keys and render raw (audit 2026-07-07).
const payLabel = (m: string) => PAY_LABEL[String(m || "").toLowerCase()] || m || "Unknown";

function bucketLabel(iso: string, range: Range): string {
  const d = new Date(iso);
  // Buckets are IST instants (the RPC truncates in Asia/Kolkata). Format IN THAT zone
  // explicitly, or a viewer/SSR outside IST sees every day & month off by one — wrong
  // on a GST document (found 2026-07-05). tz pinned to Asia/Kolkata always.
  const tz = "Asia/Kolkata";
  if (range === "today" || range === "yesterday") return d.toLocaleTimeString("en-IN", { hour: "numeric", hour12: true, timeZone: tz });
  if (range === "12m" || range === "fy") return d.toLocaleDateString("en-IN", { month: "short", year: "2-digit", timeZone: tz });
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: tz });
}

// Round a list of values to whole numbers that STILL add up to a given integer total
// (largest-remainder method). Used for the CGST/SGST split so the displayed component
// rupees always sum to the displayed "Total tax" — rounding each half on its own let
// e.g. 29.5 + 29.5 show as ₹30 + ₹30 = ₹60 under a ₹59 total (audit 2026-07-09).
function roundToSum(vals: number[], target: number): number[] {
  const floors = vals.map((v) => Math.floor(v));
  const out = [...floors];
  let rem = Math.round(target) - floors.reduce((a, b) => a + b, 0);
  const order = vals.map((v, i) => ({ i, frac: v - Math.floor(v) })).sort((a, b) => b.frac - a.frac);
  for (let k = 0; k < order.length && rem > 0; k++) { out[order[k].i]++; rem--; }
  return out;
}

// CSV download — plain client-side blob, no server round-trip.
function downloadCsv(filename: string, header: string[], rows: (string | number)[][]) {
  const esc = (v: string | number) => {
    let s = String(v);
    // Neutralise spreadsheet formula injection: a TEXT cell starting with = + - @ (or a
    // tab/CR) is run as a formula by Excel/Sheets, so a dish named "=HYPERLINK(...)" would
    // execute on open. Prefix a single quote to keep it literal text. Only for strings —
    // numeric cells (orders/revenue) stay numeric so a value like -50 isn't corrupted.
    if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [header, ...rows].map((r) => r.map(esc).join(",")).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ── Menu insights helpers: group dishes by how OFTEN they sell vs their PRICE ──
type MI = { title: string; qty: number; revenue: number };
type Klass = "star" | "workhorse" | "puzzle" | "dog";
const KLASS: Record<Klass, { label: string; emoji: string; tip: string }> = {
  star:      { label: "Stars",      emoji: "⭐", tip: "Popular & higher-priced — keep them front and centre." },
  workhorse: { label: "Workhorses", emoji: "🐎", tip: "Popular but low-priced — a small rise or an upsell adds up." },
  puzzle:    { label: "Puzzles",    emoji: "🧩", tip: "Higher-priced but rarely ordered — promote or reposition." },
  dog:       { label: "Dogs",       emoji: "🐕", tip: "Rarely ordered & low-priced — rework or drop." },
};
function miMedian(arr: number[]): number {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
// Popularity (units sold) × price (list-price ÷ units), each split at its median — the classic
// menu-engineering quadrant. Honest: it uses PRICE not profit (no per-dish cost stored yet).
function classifyMenu(rows: MI[]) {
  const clean = rows.filter((r) => (Number(r.qty) || 0) > 0);
  const totalQty = clean.reduce((a, r) => a + r.qty, 0);
  const totalRev = clean.reduce((a, r) => a + r.revenue, 0);
  const medQty = miMedian(clean.map((r) => r.qty));
  const medPrice = miMedian(clean.map((r) => (r.qty ? r.revenue / r.qty : 0)));
  const dishes = clean.map((r) => {
    const price = r.qty ? r.revenue / r.qty : 0;
    const popular = r.qty >= medQty, dear = price >= medPrice;
    const klass: Klass = popular && dear ? "star" : popular ? "workhorse" : dear ? "puzzle" : "dog";
    return { ...r, price, qtyShare: totalQty ? r.qty / totalQty : 0, revShare: totalRev ? r.revenue / totalRev : 0, klass };
  });
  return { dishes, totalQty, totalRev, medQty, medPrice };
}

export default function OwnerReports() {
  const [rests, setRests] = useState<Rest[]>([]);
  const [ready, setReady] = useState(false);           // restaurant list has loaded
  const [rid, setRid] = useState<string>("");          // "" = all restaurants
  const [type, setType] = useState<RType>("sales");
  const [range, setRange] = useState<Range>("30d");
  const [rep, setRep] = useState<Report | null>(null);
  // What actually produced `rep` — the title/scope MUST read from this, never from the
  // live pickers, or switching a tab shows old numbers under the new heading (found
  // 2026-07-05). null rid = all restaurants.
  const [gen, setGen] = useState<{ type: RType; rid: string; range: Range } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Admin-in-one-restaurant scope pin (bug C1, 2026-07-05) — mirrors app/owner/page.tsx.
  // Rides on every call as ?scope= so a second tab's act-as cookie can't hijack this one.
  const [scopePin] = useState<string | null>(() =>
    typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("rid"));
  const scp = scopePin ? `&scope=${scopePin}` : "";

  // Restaurant list once (for the scope picker); single-restaurant owners skip it.
  useEffect(() => {
    fetch(`/api/owner/overview?_=1${scp}`, { cache: "no-store" }).then((r) => r.json()).then((o) => {
      const list: Rest[] = (o.restaurants ?? []).map((r: Row) => ({ id: r.id as string, name: r.name as string }));
      setRests(list);
      if (list.length === 1) setRid(list[0].id);
      setReady(true);
    }).catch(() => setReady(true));
  }, []);

  // Latest-wins guard: rapidly switching report type/restaurant fires overlapping
  // fetches; without this the SLOWEST response wins and paints a report that doesn't
  // match the selected chip (this app's classic stale-response race). Each call takes a
  // sequence number and only the newest one is allowed to touch state (added 2026-07-06).
  const seqRef = useRef(0);
  const generate = useCallback(async () => {
    const myseq = ++seqRef.current;
    setBusy(true); setErr(null);
    const asked = { type, rid, range };
    // "menu" is a client-only VIEW over the dishes data — fetch dishes, then re-tag the
    // result so the render switches to the Menu-insights view (no API or DB change).
    const apiType = type === "menu" ? "dishes" : type;
    try {
      const q = new URLSearchParams({ type: apiType, range });
      if (rid) q.set("rid", rid);
      if (scopePin) q.set("scope", scopePin);
      const r = await fetch(`/api/owner/reports?${q}`, { cache: "no-store" }).then((x) => x.json());
      if (myseq !== seqRef.current) return; // a newer request superseded this one
      if (r.error) throw new Error(r.error);
      setRep(asked.type === "menu" ? { ...r, type: "menu" as RType } : r); setGen({ type: asked.type, rid: asked.rid, range: asked.range });
    } catch (e) {
      if (myseq !== seqRef.current) return;
      setErr(e instanceof Error ? e.message : String(e)); setRep(null); setGen(null);
    } finally {
      if (myseq === seqRef.current) setBusy(false);
    }
  }, [type, range, rid]);

  // Auto-generate once the restaurant list is in (so single-restaurant owners have
  // their rid before the first Tax report runs — else the CGST/SGST split dead-ends
  // with no picker to obey, found 2026-07-05) and whenever the report TYPE or the
  // RESTAURANT changes (clicking a chip / dropdown is itself an on-demand ask). A
  // RANGE change stays behind the Generate button (the heavier date choice).
  useEffect(() => { if (ready) generate(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [ready, type, rid]);

  // The period picker is the ONE control gated behind Generate — so if the selected
  // range no longer matches the generated report, the numbers on screen are for a
  // DIFFERENT period than the highlighted chip. Flag it so we can cue "press Generate"
  // instead of silently showing 30-day figures under a "7 days" selection (2026-07-06).
  const rangeDirty = !!gen && gen.range !== range;

  // Title + scope come from the GENERATED report, so heading and body can't disagree.
  const shownType = gen?.type ?? type;
  const shownRange = gen?.range ?? range;
  const meta = REPORTS.find((r) => r.k === shownType)!;
  const restName = gen ? (gen.rid ? (rests.find((r) => r.id === gen.rid)?.name ?? "This restaurant") : "All restaurants") : "";
  const money = rep && ["sales", "tax", "discounts", "cancellations"].includes(rep.type);
  const mrows = (money ? (rep!.rows as unknown as MoneyRow[]) : []);
  const t = rep?.totals;
  // The bucketed money summary lists EVERY day in the window. For Discounts / Cancellations
  // that means a wall of all-zero days; show only the days that actually had a discount /
  // a cancellation. Totals stay correct — they're summed server-side into `t`, not from
  // these filtered rows. (bug L-…)
  const tableRows = useMemo(() => {
    if (!money) return mrows;
    if (rep!.type === "discounts") return mrows.filter((r) => r.discount > 0);
    if (rep!.type === "cancellations") return mrows.filter((r) => r.cancelledOrders > 0);
    return mrows;
  }, [money, mrows, rep]);
  // The "Revenue" columns elsewhere are NET (after discount, tax-inclusive); the Dishes /
  // Categories money column is raw list price (Σ price×qty, pre-tax, pre-discount). Label it
  // differently so the two aren't read as the same number. (bug M-…)
  const LIST_PRICE_LABEL = "Item sales (list price)";

  // Chart + table + CSV shapes per report type.
  const chart = useMemo(() => {
    if (!rep) return null;
    if (money) {
      const key = rep.type === "sales" ? "revenue" : rep.type === "tax" ? "tax" : rep.type === "discounts" ? "discount" : "cancelledValue";
      return mrows.map((r) => ({ label: bucketLabel(r.bucket, rep.range), revenue: Number(r[key as keyof MoneyRow]) || 0 }));
    }
    if (rep.type === "hourly") {
      // Zero-fill all 24 hours so quiet hours read as empty bars, not as if they never
      // existed (the old chart plotted only hours with sales and drew them contiguously,
      // misrepresenting dead hours — found 2026-07-06).
      const byHour = new Map<number, number>();
      for (const r of rep.rows as { hour: number; revenue: number }[]) byHour.set(r.hour, r.revenue);
      return Array.from({ length: 24 }, (_, h) => ({ label: `${h}:00`, revenue: byHour.get(h) || 0 }));
    }
    return null;
  }, [rep, money, mrows]);

  const exportCsv = () => {
    if (!rep) return;
    const stamp = new Date().toISOString().slice(0, 10);
    const name = `${meta.label.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${rep.range}-${stamp}.csv`;
    if (rep.type === "tax") {
      // The whole point of the Tax report is the CGST/SGST split "for filing" — the CSV
      // used to drop it entirely (found 2026-07-06). Emit the period rows, then a labelled
      // split block underneath (ragged rows are valid CSV).
      const header = ["Period", "Orders", "Paid orders", "Subtotal", "Tax", "Discount", "Revenue", "Cancelled orders", "Cancelled value"];
      const rows: (string | number)[][] = mrows.map((r) => [bucketLabel(r.bucket, rep.range), r.orders, r.paidOrders, r.subtotal, r.tax, r.discount, r.revenue, r.cancelledOrders, r.cancelledValue]);
      if (t) rows.push(["Total", t.orders, t.paidOrders, t.subtotal, t.tax, t.discount, t.revenue, t.cancelledOrders, t.cancelledValue]);
      if (rep.tax) {
        rows.push([]);
        rows.push(["Tax split", "Rate %", "Collected"]);
        rows.push(["Total tax (as the manager panel shows)", rep.tax.effectivePct, t?.tax ?? 0]);
        for (const c of rep.tax.components) rows.push([c.label, c.rate, c.amount]);
      }
      downloadCsv(name, header, rows);
    } else if (money) {
      downloadCsv(name,
        ["Period", "Orders", "Paid orders", "Subtotal", "Tax", "Discount", "Revenue", "Cancelled orders", "Cancelled value"],
        mrows.map((r) => [bucketLabel(r.bucket, rep.range), r.orders, r.paidOrders, r.subtotal, r.tax, r.discount, r.revenue, r.cancelledOrders, r.cancelledValue]));
    } else if (rep.type === "dishes") {
      downloadCsv(name, ["Dish", "Qty", LIST_PRICE_LABEL], (rep.rows as { title: string; qty: number; revenue: number }[]).map((r) => [r.title, r.qty, r.revenue]));
    } else if (rep.type === "categories") {
      downloadCsv(name, ["Category", "Qty", LIST_PRICE_LABEL], (rep.rows as { category: string; qty: number; revenue: number }[]).map((r) => [r.category, r.qty, r.revenue]));
    } else if (rep.type === "payments") {
      downloadCsv(name, ["Method", "Orders", "Revenue"], (rep.rows as { method: string; orders: number; revenue: number }[]).map((r) => [payLabel(r.method), r.orders, r.revenue]));
    } else if (rep.type === "hourly") {
      downloadCsv(name, ["Hour", "Orders", "Revenue"], (rep.rows as { hour: number; orders: number; revenue: number }[]).map((r) => [`${r.hour}:00`, r.orders, r.revenue]));
    } else if (rep.type === "menu") {
      const byRev = [...classifyMenu(rep.rows as MI[]).dishes].sort((a, b) => b.revenue - a.revenue);
      downloadCsv(name, ["Dish", "Group", "Sold", "% of units", "Item sales (list price)", "% of sales"],
        byRev.map((d) => [d.title, KLASS[d.klass].label.replace(/s$/, ""), d.qty, +(d.qtyShare * 100).toFixed(1), d.revenue, +(d.revShare * 100).toFixed(1)]));
    }
  };

  return (
    <>
      <div className="rp-head">
        <div>
          <h1 className="rp-h1">Reports</h1>
          <p className="rp-sub">Pick a report, pick a period, hit Generate — then download or print it.</p>
        </div>
      </div>

      {/* Report picker */}
      <div className="owx-chips" role="tablist" aria-label="Report type">
        {REPORTS.map((r) => (
          <button key={r.k} role="tab" aria-selected={type === r.k} className={`owx-chip${type === r.k ? " on" : ""}`}
            title={r.blurb} onClick={() => setType(r.k)}>
            <i className={`fas ${r.icon}`} aria-hidden="true" />{r.label}
          </button>
        ))}
      </div>

      {/* Scope + period + generate */}
      <div className="rp-controls">
        {rests.length > 1 && (
          <select className="rp-select" value={rid} onChange={(e) => setRid(e.target.value)} aria-label="Restaurant">
            <option value="">All restaurants</option>
            {rests.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        )}
        <div className="owx-range" role="tablist" aria-label="Period">
          {RANGES.map((r) => (
            <button key={r.k} role="tab" aria-selected={range === r.k} className={range === r.k ? "on" : ""} onClick={() => setRange(r.k)}>{r.label}</button>
          ))}
        </div>
        <button className={`adm-btn primary${rangeDirty ? " rp-dirty" : ""}`} onClick={generate} disabled={busy}>
          <i className={`fas ${busy ? "fa-spinner fa-spin" : "fa-bolt"}`} style={{ marginRight: 6 }} aria-hidden="true" />
          {busy ? "Generating…" : rangeDirty ? `Generate · ${RANGES.find((r) => r.k === range)?.label}` : "Generate"}
        </button>
        {rangeDirty && !busy && (
          <span className="rp-dirty-hint" role="status">
            <i className="fas fa-arrow-left" aria-hidden="true" /> Press Generate to apply “{RANGES.find((r) => r.k === range)?.label}”
          </span>
        )}
        {rep && (
          <div className="rp-actions">
            <button className="adm-btn" onClick={exportCsv} title="Download this report as a CSV (opens in Excel/Sheets)">
              <i className="fas fa-download" style={{ marginRight: 6 }} aria-hidden="true" />Download CSV
            </button>
            <button className="adm-btn" onClick={() => window.print()} title="Print or save as PDF">
              <i className="fas fa-print" style={{ marginRight: 6 }} aria-hidden="true" />Print
            </button>
          </div>
        )}
      </div>

      {err && <div className="adm-card" style={{ borderColor: "var(--adm-danger)", marginBottom: 14 }}><b>Couldn&apos;t generate.</b> <span className="adm-muted" style={{ fontSize: 12.5 }}>{err}</span></div>}

      {rep && (
        <div className="rp-report" id="rp-print">
          <div className="rp-title">
            <b>{meta.label}</b>
            <span className="adm-muted"> · {restName} · {RANGES.find((r) => r.k === rep.range)?.label}</span>
          </div>

          {rep.type === "menu" ? (
            <MenuInsights rows={rep.rows as MI[]} />
          ) : (<>
          {/* Summary tiles */}
          {money && t && (
            <div className="adm-stats" style={{ marginTop: 10 }}>
              {rep.type === "sales" && (<>
                <div className="adm-stat"><div className="k">Revenue (kept)</div><div className="v">{inr(t.revenue)}</div></div>
                <div className="adm-stat"><div className="k">Paid orders</div><div className="v">{t.paidOrders}</div></div>
                <div className="adm-stat"><div className="k">Tax collected</div><div className="v">{inr(t.tax)}</div></div>
                <div className="adm-stat"><div className="k">Discounts</div><div className="v">{inr(t.discount)}</div></div>
              </>)}
              {rep.type === "tax" && (<>
                <div className="adm-stat"><div className="k">Tax collected</div><div className="v">{inr(t.tax)}</div></div>
                {rep.tax && <div className="adm-stat"><div className="k">Tax rate</div><div className="v">{rep.tax.effectivePct}%</div></div>}
                {/* Taxable base = subtotal MINUS discount (this app taxes after discount, mig 126),
                    so tax ÷ taxable equals the stated rate on the filing document (audit 2026-07-07). */}
                <div className="adm-stat"><div className="k">Taxable sales</div><div className="v">{inr(t.subtotal - t.discount)}</div></div>
                <div className="adm-stat"><div className="k">Paid orders</div><div className="v">{t.paidOrders}</div></div>
              </>)}
              {rep.type === "discounts" && (<>
                <div className="adm-stat"><div className="k">Discounts given</div><div className="v">{inr(t.discount)}</div></div>
                <div className="adm-stat"><div className="k">Revenue (after discounts)</div><div className="v">{inr(t.revenue)}</div></div>
                <div className="adm-stat"><div className="k">Paid orders</div><div className="v">{t.paidOrders}</div></div>
              </>)}
              {rep.type === "cancellations" && (<>
                <div className="adm-stat"><div className="k">Lost value</div><div className="v">{inr(t.cancelledValue)}</div></div>
                <div className="adm-stat"><div className="k">Cancelled orders</div><div className="v">{t.cancelledOrders}</div></div>
                <div className="adm-stat"><div className="k">Kept revenue</div><div className="v">{inr(t.revenue)}</div></div>
              </>)}
            </div>
          )}

          {/* Tax split — the merged figure broken into its named parts (single restaurant) */}
          {rep.type === "tax" && rep.tax && (
            <div className="adm-card" style={{ marginTop: 10 }}>
              <div className="rp-ct">The split <span className="adm-muted">· same total, shown the way the printed bill shows it{rep.tax.configured ? "" : " (no custom taxes set — standard CGST/SGST halves)"}</span></div>
              <table className="owx-table" style={{ marginTop: 6 }}>
                <thead><tr><th>Tax line</th><th>Rate</th><th>Collected</th></tr></thead>
                <tbody>
                  <tr><td><b>Total tax (as the manager panel shows)</b></td><td>{rep.tax.effectivePct}%</td><td><b>{inr(t?.tax ?? 0)}</b></td></tr>
                  {roundToSum(rep.tax.components.map((c) => c.amount), t?.tax ?? 0).map((amt, idx) => {
                    const c = rep.tax!.components[idx];
                    return <tr key={c.label} className="owx-taxsplit"><td>{c.label}</td><td>{c.rate}%</td><td>{inr(amt)}</td></tr>;
                  })}
                </tbody>
              </table>
            </div>
          )}
          {rep.type === "tax" && !rep.tax && (
            <div className="adm-card" style={{ marginTop: 10 }}>
              <span className="adm-muted" style={{ fontSize: 12.5 }}>
                Pick a single restaurant to see its CGST/SGST split — tax lines are set per restaurant, so they can&apos;t be merged across all of them.
              </span>
            </div>
          )}

          {/* Chart */}
          {chart && chart.length > 0 && (
            <div className="adm-card" style={{ marginTop: 10 }}>
              <div className="rp-ct">{meta.label} <span className="adm-muted">· over the period</span></div>
              <TimeBar data={chart} color="var(--accent)" height={220} />
            </div>
          )}
          {rep.type === "dishes" && (
            <div className="adm-card" style={{ marginTop: 10 }}>
              <div className="rp-ct">Top dishes</div>
              <LeaderBar data={(rep.rows as { title: string; qty: number; revenue: number }[]).slice(0, 10).map((d) => ({ id: d.title, name: d.title, revenue: d.revenue, orders: d.qty, accentColor: "var(--accent)" }))} />
            </div>
          )}
          {rep.type === "categories" && (
            <div className="adm-card" style={{ marginTop: 10 }}>
              <div className="rp-ct">Categories</div>
              <LeaderBar data={(rep.rows as { category: string; qty: number; revenue: number }[]).slice(0, 10).map((d) => ({ id: d.category, name: d.category, revenue: d.revenue, orders: d.qty, accentColor: "var(--accent)" }))} />
            </div>
          )}
          {rep.type === "payments" && (
            <div className="adm-card" style={{ marginTop: 10 }}>
              <div className="rp-ct">Payment methods</div>
              <LeaderBar data={(rep.rows as { method: string; orders: number; revenue: number }[]).map((d) => ({ id: d.method || "unknown", name: payLabel(d.method), revenue: d.revenue, orders: d.orders, accentColor: "var(--accent)" }))} />
            </div>
          )}

          {/* Table */}
          <div className="owx-tablewrap" style={{ marginTop: 10 }}>
            <table className="owx-table">
              {money && (<>
                <thead><tr><th>Period</th><th>Orders</th><th>Paid</th><th>Subtotal</th><th>Tax</th><th>Discount</th><th>Revenue</th><th>Cancelled</th><th>Lost ₹</th></tr></thead>
                <tbody>
                  {tableRows.map((r) => (
                    <tr key={r.bucket}>
                      <td>{bucketLabel(r.bucket, rep.range)}</td>
                      <td>{r.orders}</td><td>{r.paidOrders}</td>
                      <td>{inr(r.subtotal)}</td><td>{inr(r.tax)}</td><td>{inr(r.discount)}</td>
                      <td><b>{inr(r.revenue)}</b></td>
                      <td>{r.cancelledOrders}</td><td>{inr(r.cancelledValue)}</td>
                    </tr>
                  ))}
                </tbody>
                {t && (
                  <tfoot><tr>
                    <td>Total</td><td>{t.orders}</td><td>{t.paidOrders}</td>
                    <td>{inr(t.subtotal)}</td><td>{inr(t.tax)}</td><td>{inr(t.discount)}</td>
                    <td>{inr(t.revenue)}</td><td>{t.cancelledOrders}</td><td>{inr(t.cancelledValue)}</td>
                  </tr></tfoot>
                )}
              </>)}
              {rep.type === "dishes" && (<>
                <thead><tr><th>Dish</th><th>Qty</th><th>{LIST_PRICE_LABEL}</th></tr></thead>
                <tbody>{(rep.rows as { title: string; qty: number; revenue: number }[]).map((r) => (
                  <tr key={r.title}><td>{r.title}</td><td>{r.qty}</td><td><b>{inr(r.revenue)}</b></td></tr>
                ))}</tbody>
              </>)}
              {rep.type === "categories" && (<>
                <thead><tr><th>Category</th><th>Qty</th><th>{LIST_PRICE_LABEL}</th></tr></thead>
                <tbody>{(rep.rows as { category: string; qty: number; revenue: number }[]).map((r) => (
                  <tr key={r.category}><td>{r.category}</td><td>{r.qty}</td><td><b>{inr(r.revenue)}</b></td></tr>
                ))}</tbody>
              </>)}
              {rep.type === "payments" && (<>
                <thead><tr><th>Method</th><th>Orders</th><th>Revenue</th></tr></thead>
                <tbody>{(rep.rows as { method: string; orders: number; revenue: number }[]).map((r) => (
                  <tr key={r.method || "unknown"}><td>{payLabel(r.method)}</td><td>{r.orders}</td><td><b>{inr(r.revenue)}</b></td></tr>
                ))}</tbody>
              </>)}
              {rep.type === "hourly" && (<>
                <thead><tr><th>Hour</th><th>Orders</th><th>Revenue</th></tr></thead>
                <tbody>{(rep.rows as { hour: number; orders: number; revenue: number }[]).map((r) => (
                  <tr key={r.hour}><td>{r.hour}:00</td><td>{r.orders}</td><td><b>{inr(r.revenue)}</b></td></tr>
                ))}</tbody>
              </>)}
            </table>
            {(money ? tableRows.length === 0 : rep.rows.length === 0) && (
              <div className="adm-empty">
                {rep.type === "discounts" ? "No discounts were given in this period."
                  : rep.type === "cancellations" ? "No cancellations in this period."
                  : "Nothing in this period."}
              </div>
            )}
            {(rep.type === "dishes" || rep.type === "categories") && rep.rows.length > 0 && (
              <p className="rp-note"><b>Qty</b> counts every order placed (kitchen volume). <b>{LIST_PRICE_LABEL}</b> is menu list price × <i>paid</i> quantity — before discounts and tax — so it counts only paid orders and won&apos;t equal Qty × price, nor the net Revenue on the Sales report.</p>
            )}
          </div>
          </>)}
        </div>
      )}

      <style jsx>{`
        .rp-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
        .rp-h1 { font-size: 18px; font-weight: 800; margin: 0; }
        .rp-sub { font-size: 12.5px; color: var(--muted); margin: 3px 0 0; }
        .rp-controls { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin: 12px 0 14px; }
        .rp-actions { display: flex; gap: 8px; margin-left: auto; }
        /* When the picked period hasn't been applied yet, draw the eye to Generate. */
        .rp-dirty { box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 35%, transparent); animation: rp-pulse 1.6s ease-in-out infinite; }
        @keyframes rp-pulse { 0%,100% { box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 30%, transparent); } 50% { box-shadow: 0 0 0 5px color-mix(in srgb, var(--accent) 12%, transparent); } }
        @media (prefers-reduced-motion: reduce) { .rp-dirty { animation: none; } }
        .rp-dirty-hint { font-size: 11.5px; font-weight: 700; color: var(--accent); display: inline-flex; align-items: center; gap: 6px; }
        .rp-select {
          height: 32px; padding: 0 10px; border-radius: 8px; border: var(--border);
          background: var(--card); color: var(--text); font-size: 12.5px; font-weight: 600;
        }
        .rp-title { font-size: 14px; }
        .rp-ct { font-size: 13px; font-weight: 800; }
        .rp-note { font-size: 11.5px; color: var(--muted); margin: 8px 2px 0; }
        @media print {
          .rp-controls, .owx-chips { display: none !important; }
          .rp-head :global(.rp-sub) { display: none; }
          /* Strip the console chrome + card borders/shadows so the PDF is a clean
             document, not a screenshot of the panel. The report page's own class names
             (.rp-*) drifted from the old global print block (.rep-*) so those never
             applied — target the real markup here. (found 2026-07-05) */
          :global(.owx-side), :global(.owx-top), :global(.adm-adminbar) { display: none !important; }
          :global(.adm-main), :global(.adm-body), :global(.owx-wrap) { padding: 0 !important; margin: 0 !important; overflow: visible !important; }
          :global(.adm-card) { border: 1px solid #ddd !important; box-shadow: none !important; break-inside: avoid; }
          :global(.owx-tablewrap) { max-height: none !important; overflow: visible !important; }
        }
      `}</style>
    </>
  );
}

// ── Menu insights view: the Stars / Workhorses / Puzzles / Dogs quadrant + product mix ──
// A client-only VIEW over the existing dishes report (no API/DB change). Popularity (units
// sold) runs left→right, price (list-price ÷ units) runs bottom→top; each split at its median.
function MenuInsights({ rows }: { rows: MI[] }) {
  const { dishes } = useMemo(() => classifyMenu(rows), [rows]);
  const byRev = useMemo(() => [...dishes].sort((a, b) => b.revenue - a.revenue), [dishes]);
  if (!dishes.length) return <div className="adm-empty" style={{ marginTop: 12 }}>No dish sales in this period.</div>;
  const ORDER: Klass[] = ["puzzle", "star", "dog", "workhorse"]; // grid cells: top-left, top-right, bottom-left, bottom-right
  return (
    <>
      <p className="mi-note">
        Every dish grouped by how <b>often</b> it sells (popularity) against its <b>price</b> — the classic
        menu map. It uses menu price, not profit, so add a cost per dish later for true margin; the median
        splits popular-vs-quiet and dearer-vs-cheaper.
      </p>
      <div className="mi-axis-y">↑ Higher price</div>
      <div className="mi-grid">
        {ORDER.map((k) => {
          const list = byRev.filter((d) => d.klass === k);
          return (
            <div key={k} className={`mi-box mi-${k}`}>
              <div className="mi-box-h">
                <span className="mi-emoji" aria-hidden="true">{KLASS[k].emoji}</span>
                <b>{KLASS[k].label}</b>
                <span className="mi-n">{list.length}</span>
              </div>
              <div className="mi-tip">{KLASS[k].tip}</div>
              <div className="mi-chips">
                {list.length === 0 ? <span className="mi-more">none</span>
                  : list.slice(0, 8).map((d) => (
                    <span key={d.title} className="mi-chip" title={`${d.qty} sold · ₹${Math.round(d.price)} each`}>{d.title}</span>
                  ))}
                {list.length > 8 && <span className="mi-more">+{list.length - 8} more</span>}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mi-axis-x">More often ordered →</div>

      <div className="owx-tablewrap" style={{ marginTop: 14 }}>
        <div className="rp-ct" style={{ marginBottom: 6 }}>Product mix <span className="adm-muted">· each dish&apos;s share of what sold</span></div>
        <table className="owx-table">
          <thead><tr><th>Dish</th><th>Group</th><th>Sold</th><th>% of units</th><th>Item sales (list price)</th><th>% of sales</th></tr></thead>
          <tbody>
            {byRev.map((d) => (
              <tr key={d.title}>
                <td>{d.title}</td>
                <td><span className={`mi-tag mi-${d.klass}`}>{KLASS[d.klass].label.replace(/s$/, "")}</span></td>
                <td>{d.qty}</td>
                <td>{(d.qtyShare * 100).toFixed(1)}%</td>
                <td><b>{inr(d.revenue)}</b></td>
                <td>{(d.revShare * 100).toFixed(1)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="rp-note">Item sales is menu list price × quantity — before discounts and tax.</p>
      </div>

      <style jsx global>{`
        .mi-note { font-size: 12px; color: var(--muted); margin: 12px 2px 10px; line-height: 1.5; }
        .mi-axis-y { font-size: 10px; font-weight: 800; color: var(--muted); text-transform: uppercase; letter-spacing: .06em; margin-bottom: 5px; }
        .mi-axis-x { font-size: 10px; font-weight: 800; color: var(--muted); text-transform: uppercase; letter-spacing: .06em; text-align: right; margin-top: 5px; }
        .mi-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
        .mi-box { border: 1px solid var(--border-c, rgba(128,128,128,.22)); border-radius: 12px; padding: 12px 13px; min-height: 118px; background: var(--card); }
        .mi-box.mi-star { border-color: color-mix(in srgb, #16a34a 45%, transparent); }
        .mi-box.mi-workhorse { border-color: color-mix(in srgb, #3987e5 42%, transparent); }
        .mi-box.mi-puzzle { border-color: color-mix(in srgb, #c98500 48%, transparent); }
        .mi-box.mi-dog { border-color: color-mix(in srgb, #e2607a 42%, transparent); }
        .mi-box-h { display: flex; align-items: center; gap: 8px; font-size: 14px; }
        .mi-emoji { font-size: 16px; }
        .mi-n { margin-left: auto; font-size: 12px; font-weight: 800; color: var(--muted); background: rgba(128,128,128,.16); border-radius: 999px; padding: 1px 9px; }
        .mi-tip { font-size: 11.5px; color: var(--muted); margin: 5px 0 9px; line-height: 1.4; }
        .mi-chips { display: flex; flex-wrap: wrap; gap: 6px; }
        .mi-chip { font-size: 12px; font-weight: 600; padding: 4px 9px; border-radius: 8px; background: color-mix(in srgb, var(--accent) 9%, transparent); border: 1px solid color-mix(in srgb, var(--accent) 22%, transparent); }
        .mi-more { font-size: 11.5px; color: var(--muted); align-self: center; }
        .mi-tag { font-size: 10.5px; font-weight: 800; padding: 2px 8px; border-radius: 999px; background: rgba(128,128,128,.16); color: var(--muted); white-space: nowrap; }
        .mi-tag.mi-star { background: color-mix(in srgb, #16a34a 16%, transparent); color: #16a34a; }
        .mi-tag.mi-workhorse { background: color-mix(in srgb, #3987e5 16%, transparent); color: #3987e5; }
        .mi-tag.mi-puzzle { background: color-mix(in srgb, #c98500 18%, transparent); color: #c98500; }
        .mi-tag.mi-dog { background: color-mix(in srgb, #e2607a 16%, transparent); color: #e2607a; }
        @media (max-width: 640px) { .mi-grid { grid-template-columns: 1fr; } .mi-axis-y, .mi-axis-x { display: none; } }
      `}</style>
    </>
  );
}
