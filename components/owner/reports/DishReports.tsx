"use client";
// Owner · Reports Studio — Item / Category / Menu-engineering report bodies (2026-07-25).
//
// These three reports are the "menu & items" family and are the most data-heavy (item
// sales can be 200+ dishes). They live in their own file because each needs local UI
// state (a revenue/quantity ranking toggle, the SearchTable's own search + sort) — state
// can't live inside the conditional `if (sel === …)` blocks in page.tsx (rules of hooks).
// page.tsx just renders <DishesReport/> / <CategoriesReport/> / <MenuReport/> from those
// blocks. Presentational only: all rows are already fetched, so zero extra egress.
//
// A note on the ranking bars: the shared <LeaderBar> hard-codes a rupee tooltip, so it
// can't correctly label a "by quantity" ranking. This file's small <RankBars> renders the
// top movers with correct labels for BOTH metrics (₹ or units) and stays on the owner
// theme green — the honest fit for a toggleable ranking.
import { useState } from "react";
import { inr } from "@/components/admin/shared";
import { nfmt } from "@/components/owner/reports/kit";
import { CategoryDonut } from "@/components/owner/Charts";
import { Panel, Stat } from "@/components/owner/reports/kit";
import { SearchTable, type Col } from "@/components/owner/reports/SearchTable";

type DishRow = { title: string; qty: number; revenue: number };
type CatRow = { category: string; qty: number; revenue: number };

const pct1 = (part: number, whole: number) => (whole ? ((part / whole) * 100).toFixed(1) : "0.0") + "%";
const pct0 = (part: number, whole: number) => Math.round(whole ? (part / whole) * 100 : 0) + "%";

// ── Horizontal ranking bars (correct labels for money OR counts) ──────────────
function RankBars({ items, money }: { items: { name: string; value: number; sub?: string }[]; money: boolean }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <div className="rs-rank">
      {items.map((it, i) => (
        <div className="rs-rank-row" key={it.name}>
          <span className="rs-rank-n">{i + 1}</span>
          <div className="rs-rank-main">
            <div className="rs-rank-top">
              <span className="rs-rank-name" title={it.name}>{it.name}</span>
              <span className="rs-rank-val">{money ? inr(it.value) : nfmt(it.value)}</span>
            </div>
            <div className="rs-rank-track"><span style={{ width: `${(it.value / max) * 100}%` }} /></div>
            {it.sub && <span className="rs-rank-sub">{it.sub}</span>}
          </div>
        </div>
      ))}
      <RankStyles />
    </div>
  );
}

function RankStyles() {
  return (
    <style jsx global>{`
      .rs-rank { display: flex; flex-direction: column; gap: 12px; }
      .rs-rank-row { display: grid; grid-template-columns: 20px 1fr; gap: 10px; align-items: start; }
      .rs-rank-n { font-size: 12px; font-weight: 800; color: var(--muted); font-variant-numeric: tabular-nums; text-align: right; margin-top: 1px; }
      .rs-rank-main { min-width: 0; }
      .rs-rank-top { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
      .rs-rank-name { font-size: 12.5px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .rs-rank-val { font-size: 12.5px; font-weight: 800; font-variant-numeric: tabular-nums; color: var(--accent); white-space: nowrap; }
      .rs-rank-track { height: 7px; border-radius: 999px; background: var(--muted2); overflow: hidden; margin-top: 5px; }
      .rs-rank-track > span { display: block; height: 100%; border-radius: 999px; background: linear-gradient(90deg, color-mix(in srgb, var(--accent) 70%, transparent), var(--accent)); }
      .rs-rank-sub { font-size: 11px; color: var(--muted); font-weight: 600; }
      .rs-metric { display: inline-flex; background: var(--muted2); border-radius: 999px; padding: 3px; gap: 3px; }
      .rs-metric button { border: none; background: none; color: var(--muted); font: inherit; font-size: 11.5px; font-weight: 700; padding: 5px 13px; border-radius: 999px; cursor: pointer; transition: background .16s ease, color .16s ease; }
      .rs-metric button:hover { color: var(--text); }
      .rs-metric button.on { background: var(--accent); color: #fff; }
      .rs-callout { display: flex; gap: 12px; align-items: flex-start; border: 1px solid color-mix(in srgb, var(--adm-warn) 40%, var(--border-c)); background: color-mix(in srgb, var(--adm-warn) 9%, var(--card)); border-radius: 14px; padding: 14px 16px; margin-bottom: 14px; }
      .rs-callout .cico { width: 34px; height: 34px; flex-shrink: 0; border-radius: 10px; display: grid; place-items: center; background: color-mix(in srgb, var(--adm-warn) 18%, transparent); color: var(--adm-warn); font-size: 15px; }
      .rs-callout .ctxt b { font-size: 13px; font-weight: 800; }
      .rs-callout .ctxt p { font-size: 12px; color: var(--muted); margin: 3px 0 0; line-height: 1.45; }
    `}</style>
  );
}

// ── ITEM SALES ────────────────────────────────────────────────────────────────
export function DishesReport({ rows }: { rows: DishRow[] }) {
  const [metric, setMetric] = useState<"revenue" | "qty">("revenue");
  const totalRev = rows.reduce((a, d) => a + d.revenue, 0);
  const totalQty = rows.reduce((a, d) => a + d.qty, 0);
  const byRev = [...rows].sort((a, b) => b.revenue - a.revenue);
  const byQty = [...rows].sort((a, b) => b.qty - a.qty);
  const topSeller = byQty[0];
  const avgPerDish = rows.length ? totalRev / rows.length : 0;

  const ranked = metric === "revenue" ? byRev : byQty;
  const top = ranked.slice(0, 12).map((d) => ({
    name: d.title,
    value: metric === "revenue" ? d.revenue : d.qty,
    sub: metric === "revenue" ? `${nfmt(d.qty)} sold` : `${inr(d.revenue)} earned`,
  }));
  // "Selling less": the softest movers by units (only dishes that sold at least something).
  const worst = byQty.filter((d) => d.qty > 0).slice(-8).reverse();

  const cols: Col<DishRow>[] = [
    { key: "title", label: "Dish", render: (d) => d.title, sortBy: (d) => d.title },
    { key: "qty", label: "Qty sold", num: true, render: (d) => nfmt(d.qty), sortBy: (d) => d.qty },
    { key: "revenue", label: "Item sales", num: true, render: (d) => <b>{inr(d.revenue)}</b>, sortBy: (d) => d.revenue },
    { key: "share", label: "% of sales", num: true, render: (d) => pct1(d.revenue, totalRev), sortBy: (d) => d.revenue },
  ];
  const footer = (
    <tr>
      <td>Total</td>
      <td className="num">{nfmt(totalQty)}</td>
      <td className="num"><b>{inr(totalRev)}</b></td>
      <td className="num">100%</td>
    </tr>
  );

  return (
    <>
      <div className="rs-kpis">
        <Stat label="Item sales (list price)" tone="accent" icon="fa-indian-rupee-sign" big value={inr(totalRev)} sub="menu price × paid qty" />
        <Stat label="Units sold" tone="info" icon="fa-boxes-stacked" value={nfmt(totalQty)} />
        <Stat label="Distinct dishes" tone="info" icon="fa-utensils" value={nfmt(rows.length)} />
        <Stat label="Top seller" tone="good" icon="fa-crown" value={topSeller?.title || "—"} sub={topSeller ? `${nfmt(topSeller.qty)} sold · ${inr(topSeller.revenue)}` : ""} />
        <Stat label="Avg per dish" tone="accent" icon="fa-scale-balanced" value={inr(avgPerDish)} sub="item sales ÷ dishes" />
      </div>

      <Panel
        title="Top movers"
        hint={metric === "revenue" ? "top 12 by item sales" : "top 12 by units sold"}
        right={
          <div className="rs-metric" role="tablist" aria-label="Rank by">
            <button role="tab" aria-selected={metric === "revenue"} className={metric === "revenue" ? "on" : ""} onClick={() => setMetric("revenue")}>By revenue</button>
            <button role="tab" aria-selected={metric === "qty"} className={metric === "qty" ? "on" : ""} onClick={() => setMetric("qty")}>By quantity</button>
          </div>
        }
      >
        <RankBars items={top} money={metric === "revenue"} />
      </Panel>

      {worst.length > 0 && (
        <Panel title="Selling less" hint="softest movers — fix the name/photo/price, or drop">
          <RankBars items={worst.map((d) => ({ name: d.title, value: d.qty, sub: `${inr(d.revenue)} earned` }))} money={false} />
        </Panel>
      )}

      <Panel title="Every dish" pad={false}>
        <SearchTable
          rows={rows} columns={cols} searchKey={(d) => d.title}
          initialSort={{ key: "revenue", dir: "desc" }} placeholder="Search dishes…" footer={footer}
          emptyText="No dish matches your search."
        />
        <p className="rs-note">Item sales is menu list price × paid quantity — before discounts and tax — so it won&apos;t equal the net revenue on the Sales report.</p>
      </Panel>
    </>
  );
}

// ── CATEGORY MIX ────────────────────────────────────────────────────────────────
export function CategoriesReport({ rows }: { rows: CatRow[] }) {
  const byRev = [...rows].sort((a, b) => b.revenue - a.revenue);
  const totalRev = rows.reduce((a, c) => a + c.revenue, 0);
  const totalQty = rows.reduce((a, c) => a + c.qty, 0);
  const top = byRev[0];
  const weak = byRev.length > 1 ? byRev[byRev.length - 1] : undefined;

  const cols: Col<CatRow>[] = [
    { key: "category", label: "Category", render: (c) => c.category, sortBy: (c) => c.category },
    { key: "qty", label: "Qty", num: true, render: (c) => nfmt(c.qty), sortBy: (c) => c.qty },
    { key: "revenue", label: "Item sales", num: true, render: (c) => <b>{inr(c.revenue)}</b>, sortBy: (c) => c.revenue },
    { key: "share", label: "%", num: true, render: (c) => pct1(c.revenue, totalRev), sortBy: (c) => c.revenue },
  ];
  const footer = (
    <tr>
      <td>Total</td>
      <td className="num">{nfmt(totalQty)}</td>
      <td className="num"><b>{inr(totalRev)}</b></td>
      <td className="num">100%</td>
    </tr>
  );

  return (
    <>
      <div className="rs-kpis">
        <Stat label="Item sales (list price)" tone="accent" icon="fa-indian-rupee-sign" big value={inr(totalRev)} sub="across all sections" />
        <Stat label="Categories" tone="info" icon="fa-layer-group" value={nfmt(rows.length)} />
        <Stat label="Top category" tone="good" icon="fa-crown" value={top?.category || "—"} sub={top ? `${pct0(top.revenue, totalRev)} of sales` : ""} />
        <Stat label="Weakest category" tone="warn" icon="fa-arrow-down" value={weak?.category || "—"} sub={weak ? `${pct0(weak.revenue, totalRev)} of sales` : ""} />
      </div>
      <div className="rs-grid two">
        <Panel title="Every category" pad={false}>
          <SearchTable
            rows={rows} columns={cols} searchKey={(c) => c.category}
            initialSort={{ key: "revenue", dir: "desc" }} placeholder="Search categories…"
            maxHeight={400} footer={footer} emptyText="No category matches your search."
          />
        </Panel>
        <Panel title="Share of sales"><CategoryDonut data={byRev.map((c) => ({ category: c.category, revenue: c.revenue }))} /></Panel>
      </div>
    </>
  );
}

// ── MENU ENGINEERING ─────────────────────────────────────────────────────────────
type MI = { title: string; qty: number; revenue: number };
type Klass = "star" | "workhorse" | "puzzle" | "dog";
const KLASS: Record<Klass, { label: string; icon: string; sub: string; tip: string }> = {
  star:      { label: "Stars",      icon: "fa-star",         sub: "Ordered a lot · priced high",  tip: "Your winners — show them off: top of the menu, photos, specials." },
  workhorse: { label: "Workhorses", icon: "fa-horse",        sub: "Ordered a lot · low price",    tip: "Nudge the price up a little, or add a combo — easy extra money." },
  puzzle:    { label: "Puzzles",    icon: "fa-puzzle-piece", sub: "Priced high · rarely ordered", tip: "Give them a photo, a clearer name, or a small offer to move them." },
  dog:       { label: "Dogs",       icon: "fa-face-frown",   sub: "Low price · rarely ordered",   tip: "Mostly clutter — worth thinking about dropping." },
};
const KRANK: Record<Klass, number> = { star: 0, workhorse: 1, puzzle: 2, dog: 3 };
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
  return { dishes, totalQty, totalRev };
}
type MenuDish = ReturnType<typeof classifyMenu>["dishes"][number];

export function MenuReport({ rows }: { rows: MI[] }) {
  const { dishes, totalQty, totalRev } = classifyMenu(rows);
  const byRev = [...dishes].sort((a, b) => b.revenue - a.revenue);
  const count = (k: Klass) => dishes.filter((d) => d.klass === k).length;
  const QORDER: Klass[] = ["star", "workhorse", "puzzle", "dog"];
  const stars = count("star");
  const attention = count("puzzle") + count("dog");

  // Biggest opportunity: the top-earning Puzzle (priced well, under-ordered → most upside);
  // if there are none, the top-earning Dog (a candidate to fix or drop).
  const puzzles = byRev.filter((d) => d.klass === "puzzle");
  const dogs = byRev.filter((d) => d.klass === "dog");
  const opp = puzzles[0] || dogs[0];

  const cols: Col<MenuDish>[] = [
    { key: "title", label: "Dish", render: (d) => d.title, sortBy: (d) => d.title },
    { key: "group", label: "Group", render: (d) => <span className={`rs-tag ${d.klass}`}>{KLASS[d.klass].label.replace(/s$/, "")}</span>, sortBy: (d) => KRANK[d.klass] },
    { key: "qty", label: "Sold", num: true, render: (d) => nfmt(d.qty), sortBy: (d) => d.qty },
    { key: "ushare", label: "% units", num: true, render: (d) => (d.qtyShare * 100).toFixed(1) + "%", sortBy: (d) => d.qtyShare },
    { key: "revenue", label: "Item sales", num: true, render: (d) => <b>{inr(d.revenue)}</b>, sortBy: (d) => d.revenue },
    { key: "sshare", label: "% sales", num: true, render: (d) => (d.revShare * 100).toFixed(1) + "%", sortBy: (d) => d.revShare },
  ];
  const footer = (
    <tr>
      <td>Total</td><td />
      <td className="num">{nfmt(totalQty)}</td><td className="num">100%</td>
      <td className="num"><b>{inr(totalRev)}</b></td><td className="num">100%</td>
    </tr>
  );

  return (
    <>
      <div className="rs-kpis">
        <Stat label="Item sales (list price)" tone="accent" icon="fa-indian-rupee-sign" big value={inr(totalRev)} sub="menu price × paid qty" />
        <Stat label="Units sold" tone="info" icon="fa-boxes-stacked" value={nfmt(totalQty)} />
        <Stat label="Stars" tone="good" icon="fa-star" value={nfmt(stars)} sub="push these" />
        <Stat label="Needs attention" tone="warn" icon="fa-screwdriver-wrench" value={nfmt(attention)} sub="puzzles + dogs" />
      </div>

      {opp && (
        <div className="rs-callout">
          <span className="cico"><i className="fas fa-lightbulb" aria-hidden /></span>
          <div className="ctxt">
            <b>Biggest opportunity: {opp.title}</b>
            <p>
              It&apos;s a <b>{KLASS[opp.klass].label.replace(/s$/, "")}</b> — {KLASS[opp.klass].sub.toLowerCase()} (₹{Math.round(opp.price)} each, {nfmt(opp.qty)} sold). {KLASS[opp.klass].tip}
            </p>
          </div>
        </div>
      )}

      <p className="rs-note" style={{ marginTop: 0, marginBottom: 12 }}>Every dish is grouped by how <b>often</b> it&apos;s ordered and how <b>pricey</b> it is. Uses menu price (not cost) — a per-dish cost field would make this profit-true.</p>

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

      <div style={{ height: 14 }} />
      <Panel title="Product mix" hint="each dish's share of what sold" pad={false}>
        <SearchTable
          rows={byRev} columns={cols} searchKey={(d) => d.title}
          initialSort={{ key: "revenue", dir: "desc" }} placeholder="Search dishes…" footer={footer}
          emptyText="No dish matches your search."
        />
      </Panel>
    </>
  );
}
