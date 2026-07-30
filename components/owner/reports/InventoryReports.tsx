"use client";
// Owner · Reports Studio — the INVENTORY & STOCK report bodies (migs 221/224/227).
//
// Five sub-tabs, one payload shape: Stock on hand · Purchases · Usage & cost · Waste ·
// Expenses. They live here (not in page.tsx) because each needs its own local UI state
// and page.tsx renders report bodies inside conditional blocks where hooks can't live.
// Presentational only — every row arrives already aggregated, so zero extra egress.
//
// ── THE HONESTY RULES BAKED IN HERE (the owner's "no calculation error") ──────
// 1. TWO cost truths are shown separately and never added:
//      • "Cost of dishes sold" = recipe cost × quantity sold. Valid over ANY window,
//        so it drives the food-cost % and per-dish margins.
//      • "Left the shelf (recorded)" = what the movement ledger actually captured. It
//        only exists from the day recipes were mapped, so it is NEVER a % denominator.
// 2. Every percentage divides by COVERED revenue (dishes that have a recipe), never by
//    all revenue, and the coverage is printed next to it. A menu that's 20% mapped can
//    therefore never show a flattering food cost.
// 3. Cash vs cost vs asset are three separate tiles with three separate labels:
//      bought (cash out) · used in dishes (cost) · on the shelf (asset).
// 4. When the ledger is younger than the window, a plain-language note says so instead
//    of letting the owner read a partial-period number as a full-period one.
import { useMemo, useState } from "react";
import { inr } from "@/components/admin/shared";
import { Panel, Stat, nfmt } from "@/components/owner/reports/kit";
import { SearchTable, type Col } from "@/components/owner/reports/SearchTable";
import { ToggleChart, LeaderBar } from "@/components/owner/Charts";

export type InvSummary = {
  stockValue: number; stockItems: number; lowCount: number; negativeCount: number;
  purchases: number; purchaseCount: number;
  actualUsed: number; wasted: number; wasteCount: number;
  expenses: number; corrections: number;
  theoreticalCost: number; foodCostPct: number | null;
};
export type InvCoverage = {
  totalRevenue: number; coveredRevenue: number;
  totalDishes: number; coveredDishes: number;
  mappedRecipes: number; menuDishes: number; pct: number;
};
export type InvItem = {
  id: string; name: string; category: string;
  baseUom: string; buyUom: string; factor: number;
  onHandBase: number; onHandVal: number; parQty: number | null;
  boughtBase: number; boughtVal: number;
  usedBase: number; usedVal: number;
  wastedBase: number; wastedVal: number;
  adjustBase: number; adjustVal: number;
};
export type InvDish = {
  slug: string; title: string; price: number; qtySold: number; revenue: number;
  plateCost: number; costTotal: number; ingredients: number; marginPct: number | null;
};
export type InvPayload = {
  summary: InvSummary; coverage: InvCoverage; costDataFrom: string | null;
  dishes: InvDish[]; items: InvItem[];
  vendors: { vendor: string; bills: number; amount: number; isCash: boolean }[];
  series: { bucket: string; purchased: number; used: number; wasted: number }[];
  expenses: { id: string; category: string; title: string; amount: number; expense_date: string; note: string | null; photo_url: string | null; created_by: string | null; voided_at: string | null; void_reason: string | null }[];
  waste: { id: string; item_id: string; qty_base: number; reason: string; note: string | null; unit_cost_snap: number; waste_date: string; created_by: string | null; voided_at: string | null }[];
};

// Styles these bodies need that the studio doesn't already define globally. Kept HERE
// (the house pattern — each report file carries its own <style jsx global>) so a body
// never renders unstyled just because another report file happens not to be mounted:
// .rs-metric lives in DishReports, and .rs-note has no warn/ok variants in kit.tsx.
export function InvReportStyles() {
  return (
    <style jsx global>{`
      .rs-metric { display: inline-flex; background: var(--muted2); border-radius: 999px; padding: 3px; gap: 3px; }
      .rs-metric button { border: none; background: none; color: var(--muted); font: inherit; font-size: 11.5px;
        font-weight: 700; padding: 5px 13px; border-radius: 999px; cursor: pointer; transition: background .16s ease, color .16s ease; }
      .rs-metric button:hover { color: var(--text); }
      .rs-metric button[aria-pressed="true"] { background: var(--accent); color: #fff; }
      /* the honesty callouts — a real box, because these carry the caveat for every % above */
      .rs-note.warn, .rs-note.ok { display: block; margin: 12px 0; padding: 10px 13px; border-radius: 11px;
        font-size: 12.5px; line-height: 1.55; color: var(--text); border: 1px solid; }
      .rs-note.warn { background: color-mix(in srgb, #f59e0b 12%, transparent); border-color: color-mix(in srgb, #f59e0b 42%, transparent); }
      .rs-note.ok { background: color-mix(in srgb, #22c55e 10%, transparent); border-color: color-mix(in srgb, #22c55e 34%, transparent); }
      .rs-note-sub { margin-top: 7px; padding-top: 7px; border-top: 1px solid var(--muted2); color: var(--muted); font-size: 11.5px; }
      /* the two-cost split — side by side on desktop, stacked on a phone */
      .rs-split { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
      .rs-split-k { font-size: 11.5px; font-weight: 800; color: var(--muted); text-transform: uppercase; letter-spacing: .04em; }
      .rs-split-v { font-size: 22px; font-weight: 800; font-variant-numeric: tabular-nums; margin: 2px 0 4px; }
      .rs-split p { font-size: 12px; line-height: 1.5; margin: 0; }
      @media (max-width: 620px) { .rs-split { grid-template-columns: 1fr; gap: 14px; } }
      .rs-dim { color: var(--muted); font-weight: 600; }
      .rs-struck { text-decoration: line-through; opacity: .6; }
      .rs-bad { color: #ef4444; } .rs-warn { color: #f59e0b; } .rs-good { color: #22c55e; }
    `}</style>
  );
}

const EXP_LABELS: Record<string, string> = { breakage: "Breakage", repair: "Repair", utilities: "Utilities", cleaning: "Cleaning", supplies: "Supplies", rent: "Rent", transport: "Transport", misc: "Other" };
const WASTE_LABELS: Record<string, string> = { spoiled: "Spoiled", burnt: "Burnt", spilled: "Spilled", expired: "Expired", staff_meal: "Staff meal", complimentary: "On the house", other: "Other" };
// LeaderBar speaks RevDatum (id/name/revenue/orders/accentColor) — this keeps the four
// ranking bars in this file on the studio's own component instead of a parallel one.
const bars = (rows: { label: string; value: number }[], accent = "") =>
  rows.map((r, i) => ({ id: `${i}-${r.label}`, name: r.label, revenue: r.value, orders: 0, accentColor: accent }));
const pct1 = (n: number | null) => (n == null ? "—" : `${n.toFixed(1)}%`);
// Base units → the unit people buy in (kg / L / pc), which is how stock is discussed.
const inBuy = (i: { factor: number; buyUom: string }, base: number) =>
  `${Math.round((Number(base || 0) / (i.factor || 1)) * 100) / 100} ${i.buyUom}`;
const dayLabel = (b: string) => (b.length === 7
  ? new Date(b + "-01").toLocaleDateString("en-IN", { month: "short", year: "2-digit" })
  : new Date(b).toLocaleDateString("en-IN", { day: "numeric", month: "short" }));

// ── the shared honesty banner ────────────────────────────────────────────────
// Rendered on every sub-tab that shows a cost figure, so the caveat travels with the
// number instead of living in a help page nobody opens.
export function CoverageNote({ cov, from }: { cov: InvCoverage; from: string | null }) {
  const full = cov.pct >= 99.5;
  const none = cov.mappedRecipes === 0;
  const ledgerLate = !!from && cov.totalRevenue > 0;
  return (
    <div className={`rs-note ${none ? "warn" : full ? "ok" : "warn"}`}>
      {none ? (
        <>
          <b>No recipes mapped yet.</b> Costs and the food-cost % stay empty until you map at
          least one dish&apos;s ingredients (Manager panel → Inventory → Recipes). Everything
          else on this page — what you bought, what&apos;s on the shelf, waste, expenses — is
          already real.
        </>
      ) : full ? (
        <><b>All {nfmt(cov.coveredDishes)} dishes sold in this period have recipes</b>, so the cost
        figures below cover every sale.</>
      ) : (
        <>
          <b>Recipes cover {Math.round(cov.pct)}% of what you sold</b> ({nfmt(cov.coveredDishes)} of{" "}
          {nfmt(cov.totalDishes)} dishes sold, {inr(cov.coveredRevenue)} of {inr(cov.totalRevenue)}).
          Every cost % below is worked out <b>on those dishes only</b> — never spread across
          unmapped sales, which would make it look better than it is. Map more dishes to sharpen it.
        </>
      )}
      {ledgerLate && (
        <div className="rs-note-sub">
          Stock started being recorded on{" "}
          {new Date(from!).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
          . For a period starting before that, &ldquo;left the shelf (recorded)&rdquo; covers only
          the days since — which is why the cost of dishes sold is worked out from recipes instead.
        </div>
      )}
    </div>
  );
}

// The hero band shared by all five sub-tabs (identical numbers everywhere by construction).
export function InvHero({ s, kind }: { s: InvSummary; kind: string }) {
  return (
    <div className="rs-kpis">
      <Stat label="On the shelf now" value={inr(s.stockValue)} tone="accent" icon="fa-boxes-stacked" big
        sub={`${nfmt(s.stockItems)} ingredient${s.stockItems === 1 ? "" : "s"}${s.lowCount ? ` · ${nfmt(s.lowCount)} low` : ""}`} />
      <Stat label="Stock bought" value={inr(s.purchases)} tone="accent" icon="fa-truck"
        sub={`${nfmt(s.purchaseCount)} purchase${s.purchaseCount === 1 ? "" : "s"} · cash out`} />
      <Stat label="Cost of dishes sold" value={inr(s.theoreticalCost)} tone="accent" icon="fa-utensils"
        sub={s.foodCostPct == null ? "needs recipes" : `${pct1(s.foodCostPct)} of those dishes' sales`} />
      <Stat label="Wasted" value={inr(s.wasted)} tone={s.wasted > 0 ? "warn" : "accent"} icon="fa-trash"
        sub={`${nfmt(s.wasteCount)} entr${s.wasteCount === 1 ? "y" : "ies"}`} />
      <Stat label="Other expenses" value={inr(s.expenses)} tone="accent" icon="fa-receipt"
        sub="breakage, repairs, bills" />
      {kind !== "invexpenses" && (
        <Stat label="Count corrections" value={inr(s.corrections)}
          tone={s.corrections < -1 ? "bad" : "accent"} icon="fa-scale-balanced"
          sub={s.corrections < -1 ? "shelf had less than the books" : s.corrections > 1 ? "shelf had more" : "in line"} />
      )}
    </div>
  );
}

// ══ 1. STOCK ON HAND — "you can see remaining inventory also" ════════════════
export function InvStockReport({ d }: { d: InvPayload }) {
  const [onlyLow, setOnlyLow] = useState(false);
  const rows = useMemo(
    () => (onlyLow ? d.items.filter((i) => i.parQty != null && i.onHandBase < i.parQty) : d.items),
    [d.items, onlyLow]);
  const cols: Col<InvItem>[] = [
    { key: "name", label: "Ingredient", render: (r) => (
      <span>{r.name}{r.onHandBase < 0 && <b className="rs-bad"> · below zero</b>}
        {r.parQty != null && r.onHandBase < r.parQty && r.onHandBase >= 0 && <b className="rs-warn"> · low</b>}
        <span className="rs-dim"> {r.category}</span></span>
    ), sortBy: (r) => r.name },
    { key: "onhand", label: "On the shelf", num: true, render: (r) => inBuy(r, r.onHandBase), sortBy: (r) => r.onHandBase },
    { key: "par", label: "Par", num: true, render: (r) => (r.parQty == null ? "—" : inBuy(r, r.parQty)), sortBy: (r) => r.parQty ?? -1 },
    { key: "val", label: "Worth", num: true, render: (r) => inr(r.onHandVal), sortBy: (r) => r.onHandVal },
  ];
  const top = d.items.filter((i) => i.onHandVal > 0).slice(0, 8).map((i) => ({ label: i.name, value: i.onHandVal }));
  return (
    <>
      <InvHero s={d.summary} kind="invstock" />
      {d.summary.negativeCount > 0 && (
        <div className="rs-note warn">
          <b>{nfmt(d.summary.negativeCount)} ingredient{d.summary.negativeCount === 1 ? " shows" : "s show"} less than
          zero.</b> That almost always means a delivery was never entered — ask your manager to add
          the missing bill, then the shelf value here will be right.
        </div>
      )}
      {top.length > 1 && (
        <Panel title="Where the money is sitting" hint="the biggest slices of your shelf value" id="inv-top">
          <LeaderBar data={bars(top)} />
        </Panel>
      )}
      <Panel title="Everything on the shelf" hint={`${nfmt(d.items.length)} ingredients · ${inr(d.summary.stockValue)} total`}
        right={<span className="rs-metric"><button aria-pressed={onlyLow} onClick={() => setOnlyLow((v) => !v)}>{onlyLow ? "Showing low only" : "Show low only"}</button></span>} id="inv-stock-table">
        <SearchTable rows={rows} columns={cols} searchKey={(r) => `${r.name} ${r.category}`}
          initialSort={{ key: "val", dir: "desc" }} placeholder="Search ingredients…"
          emptyText={onlyLow ? "Nothing is below its par level." : "No ingredients yet."}
          footer={<tr><td><b>Total</b></td><td /><td /><td className="num"><b>{inr(rows.reduce((a, r) => a + r.onHandVal, 0))}</b></td></tr>} />
      </Panel>
    </>
  );
}

// ══ 2. PURCHASES — "the price of all the inventory we buy" ═══════════════════
export function InvPurchasesReport({ d, accent, rangeText }: { d: InvPayload; accent: string; rangeText: string }) {
  const chart = d.series.map((r) => ({ label: dayLabel(r.bucket), value: r.purchased }));
  const cols: Col<{ vendor: string; bills: number; amount: number; isCash: boolean }>[] = [
    { key: "vendor", label: "Supplier", render: (r) => <span>{r.vendor}{r.isCash && <span className="rs-dim"> · cash</span>}</span>, sortBy: (r) => r.vendor },
    { key: "bills", label: "Purchases", num: true, render: (r) => nfmt(r.bills), sortBy: (r) => r.bills },
    { key: "amount", label: "Paid", num: true, render: (r) => inr(r.amount), sortBy: (r) => r.amount },
    { key: "share", label: "Share", num: true, render: (r) => `${Math.round(d.summary.purchases ? (r.amount / d.summary.purchases) * 100 : 0)}%`, sortBy: (r) => r.amount },
  ];
  return (
    <>
      <InvHero s={d.summary} kind="invpurchases" />
      <Panel title={`What you spent on stock — ${rangeText}`} hint="cash paid to suppliers, by day" id="inv-buy-chart">
        <ToggleChart data={chart} color={accent} name="Bought" title="" />
      </Panel>
      <Panel title="By supplier" hint={`${nfmt(d.vendors.length)} supplier${d.vendors.length === 1 ? "" : "s"}`} id="inv-vendors">
        <SearchTable rows={d.vendors} columns={cols} searchKey={(r) => r.vendor}
          initialSort={{ key: "amount", dir: "desc" }} placeholder="Search suppliers…"
          emptyText="No purchases entered in this period."
          footer={<tr><td><b>Total</b></td><td className="num"><b>{nfmt(d.vendors.reduce((a, r) => a + r.bills, 0))}</b></td><td className="num"><b>{inr(d.summary.purchases)}</b></td><td /></tr>} />
      </Panel>
      <Panel title="What came in, per ingredient" hint="quantity and cost received in this period" id="inv-buy-items">
        <SearchTable rows={d.items.filter((i) => i.boughtBase !== 0)} columns={[
          { key: "name", label: "Ingredient", render: (r) => r.name, sortBy: (r) => r.name },
          { key: "qty", label: "Received", num: true, render: (r) => inBuy(r, r.boughtBase), sortBy: (r) => r.boughtBase },
          { key: "val", label: "Cost", num: true, render: (r) => inr(r.boughtVal), sortBy: (r) => r.boughtVal },
        ] as Col<InvItem>[]} searchKey={(r) => r.name} initialSort={{ key: "val", dir: "desc" }}
          placeholder="Search ingredients…" emptyText="Nothing was received in this period." />
      </Panel>
    </>
  );
}

// ══ 3. USAGE & COST — "for making a dish how much thing is used" ═════════════
export function InvUsageReport({ d }: { d: InvPayload }) {
  const [byCost, setByCost] = useState(true);
  const dishCols: Col<InvDish>[] = [
    { key: "title", label: "Dish", render: (r) => (
      <span>{r.title}<span className="rs-dim"> {nfmt(r.ingredients)} ingredient{r.ingredients === 1 ? "" : "s"}</span></span>
    ), sortBy: (r) => r.title },
    { key: "sold", label: "Sold", num: true, render: (r) => nfmt(r.qtySold), sortBy: (r) => r.qtySold },
    { key: "plate", label: "Cost to make one", num: true, render: (r) => inr(r.plateCost), sortBy: (r) => r.plateCost },
    { key: "price", label: "Sells for", num: true, render: (r) => (r.price ? inr(r.price) : "—"), sortBy: (r) => r.price },
    { key: "margin", label: "Margin", num: true, render: (r) => (
      r.marginPct == null ? "—" : <b className={r.marginPct < 50 ? "rs-warn" : ""}>{Math.round(r.marginPct)}%</b>
    ), sortBy: (r) => r.marginPct ?? -1 },
    { key: "total", label: "Ingredients used", num: true, render: (r) => inr(r.costTotal), sortBy: (r) => r.costTotal },
  ];
  const itemRows = d.items.filter((i) => i.usedBase !== 0 || i.adjustBase !== 0);
  const leak = itemRows.filter((i) => i.adjustVal < -0.01).sort((a, b) => a.adjustVal - b.adjustVal);
  return (
    <>
      <InvHero s={d.summary} kind="invusage" />
      <CoverageNote cov={d.coverage} from={d.costDataFrom} />
      <Panel title="The two cost numbers — and why they differ" id="inv-two-costs">
        <div className="rs-split">
          <div>
            <div className="rs-split-k">Cost of dishes sold (from recipes)</div>
            <div className="rs-split-v">{inr(d.summary.theoreticalCost)}</div>
            <p className="rs-dim">Recipe cost × how many were sold. Works for any period, so this is
              the number the food-cost % uses.</p>
          </div>
          <div>
            <div className="rs-split-k">Left the shelf (recorded)</div>
            <div className="rs-split-v">{inr(d.summary.actualUsed)}</div>
            <p className="rs-dim">What the stock ledger actually captured as orders were made. Only
              covers days when recipes were already mapped — never use it as a percentage.</p>
          </div>
        </div>
      </Panel>
      <Panel title="Cost per dish" hint="what each dish costs to make today, and what it earns"
        right={<span className="rs-metric"><button aria-pressed={byCost} onClick={() => setByCost((v) => !v)}>{byCost ? "Sorted by ingredients used" : "Sorted by margin"}</button></span>} id="inv-dishes">
        {d.dishes.length ? (
          <SearchTable rows={byCost ? d.dishes : [...d.dishes].sort((a, b) => (a.marginPct ?? 999) - (b.marginPct ?? 999))}
            columns={dishCols} searchKey={(r) => r.title}
            initialSort={{ key: byCost ? "total" : "margin", dir: byCost ? "desc" : "asc" }}
            placeholder="Search dishes…" emptyText="No mapped dish was sold in this period."
            footer={<tr><td><b>Total</b></td><td className="num"><b>{nfmt(d.dishes.reduce((a, r) => a + r.qtySold, 0))}</b></td><td /><td /><td /><td className="num"><b>{inr(d.summary.theoreticalCost)}</b></td></tr>} />
        ) : (
          <div className="rs-empty">No dish has a recipe yet — map one in the Manager panel under
            Inventory → Recipes and this table fills itself in.</div>
        )}
      </Panel>
      <Panel title="Per ingredient" hint="what your dishes ate, and what the counts corrected" id="inv-use-items">
        <SearchTable rows={itemRows} columns={[
          { key: "name", label: "Ingredient", render: (r) => r.name, sortBy: (r) => r.name },
          { key: "used", label: "Used by dishes", num: true, render: (r) => inBuy(r, r.usedBase), sortBy: (r) => r.usedBase },
          { key: "usedv", label: "Cost", num: true, render: (r) => inr(r.usedVal), sortBy: (r) => r.usedVal },
          { key: "adj", label: "Count correction", num: true, render: (r) => (
            r.adjustBase ? <b className={r.adjustVal < 0 ? "rs-bad" : "rs-good"}>{r.adjustVal > 0 ? "+" : ""}{inr(r.adjustVal)}</b> : "—"
          ), sortBy: (r) => r.adjustVal },
        ] as Col<InvItem>[]} searchKey={(r) => r.name} initialSort={{ key: "usedv", dir: "desc" }}
          placeholder="Search ingredients…" emptyText="Nothing moved in this period." />
      </Panel>
      {leak.length > 0 && (
        <Panel title="Where stock went missing" hint="counted less than the books said — after orders and logged waste" id="inv-leak">
          <div className="rs-note warn">
            These are the gaps a physical count found that orders and waste don&apos;t explain. Usual
            causes, in order: over-portioning, a delivery entered short, waste nobody logged, or
            something walking out. It sharpens as more dishes get recipes.
          </div>
          <LeaderBar data={bars(leak.slice(0, 8).map((i) => ({ label: i.name, value: Math.abs(i.adjustVal) })))} />
        </Panel>
      )}
    </>
  );
}

// ══ 4. WASTE ════════════════════════════════════════════════════════════════
export function InvWasteReport({ d }: { d: InvPayload }) {
  const nameOf = (id: string) => d.items.find((i) => i.id === id)?.name || "—";
  const byReason = useMemo(() => {
    const m = new Map<string, number>();
    for (const w of d.waste) {
      if (w.voided_at) continue;
      m.set(w.reason, (m.get(w.reason) || 0) + Number(w.qty_base) * Number(w.unit_cost_snap));
    }
    return [...m.entries()].map(([k, v]) => ({ label: WASTE_LABELS[k] || k, value: v })).sort((a, b) => b.value - a.value);
  }, [d.waste]);
  return (
    <>
      <InvHero s={d.summary} kind="invwaste" />
      {byReason.length > 0 && (
        <Panel title="Why it was thrown away" id="inv-waste-reason"><LeaderBar data={bars(byReason)} /></Panel>
      )}
      <Panel title="Every waste entry" hint={`${nfmt(d.waste.filter((w) => !w.voided_at).length)} entries · ${inr(d.summary.wasted)}`} id="inv-waste-list">
        <SearchTable rows={d.waste} columns={[
          { key: "date", label: "Date", render: (r) => r.waste_date, sortBy: (r) => r.waste_date },
          { key: "item", label: "Ingredient", render: (r) => (
            <span className={r.voided_at ? "rs-struck" : ""}>{nameOf(r.item_id)}{r.voided_at && <span className="rs-dim"> · struck out</span>}</span>
          ), sortBy: (r) => nameOf(r.item_id) },
          { key: "why", label: "Reason", render: (r) => WASTE_LABELS[r.reason] || r.reason, sortBy: (r) => r.reason },
          { key: "who", label: "Logged by", render: (r) => r.created_by || "—", sortBy: (r) => r.created_by || "" },
          { key: "val", label: "Cost", num: true, render: (r) => (r.voided_at ? "—" : inr(Number(r.qty_base) * Number(r.unit_cost_snap))), sortBy: (r) => Number(r.qty_base) * Number(r.unit_cost_snap) },
        ] as Col<InvPayload["waste"][number]>[]} searchKey={(r) => `${nameOf(r.item_id)} ${r.reason} ${r.note || ""}`}
          initialSort={{ key: "date", dir: "desc" }} placeholder="Search waste…"
          emptyText="Nothing was logged as wasted in this period — good." />
      </Panel>
    </>
  );
}

// ══ 5. EXPENSES — the broken-lamp book ══════════════════════════════════════
export function InvExpensesReport({ d }: { d: InvPayload }) {
  const live = d.expenses.filter((e) => !e.voided_at);
  const byCat = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of live) m.set(e.category, (m.get(e.category) || 0) + Number(e.amount));
    return [...m.entries()].map(([k, v]) => ({ label: EXP_LABELS[k] || k, value: v })).sort((a, b) => b.value - a.value);
  }, [live]);
  return (
    <>
      <InvHero s={d.summary} kind="invexpenses" />
      {byCat.length > 0 && (
        <Panel title="What the money went on" id="inv-exp-cat"><LeaderBar data={bars(byCat)} /></Panel>
      )}
      <Panel title="Every expense" hint={`${nfmt(live.length)} entr${live.length === 1 ? "y" : "ies"} · ${inr(d.summary.expenses)}`} id="inv-exp-list">
        <SearchTable rows={d.expenses} columns={[
          { key: "date", label: "Date", render: (r) => r.expense_date, sortBy: (r) => r.expense_date },
          { key: "cat", label: "Kind", render: (r) => EXP_LABELS[r.category] || r.category, sortBy: (r) => r.category },
          { key: "what", label: "What happened", render: (r) => (
            <span className={r.voided_at ? "rs-struck" : ""}>
              {r.title}
              {r.note && <span className="rs-dim"> · {r.note}</span>}
              {r.voided_at && <span className="rs-dim"> · struck out{r.void_reason ? `: ${r.void_reason}` : ""}</span>}
              {r.photo_url && <a className="rs-dim" href={r.photo_url} target="_blank" rel="noopener noreferrer"> · photo</a>}
            </span>
          ), sortBy: (r) => r.title },
          { key: "who", label: "Recorded by", render: (r) => r.created_by || "—", sortBy: (r) => r.created_by || "" },
          { key: "amt", label: "Amount", num: true, render: (r) => (r.voided_at ? <span className="rs-struck">{inr(r.amount)}</span> : inr(r.amount)), sortBy: (r) => Number(r.amount) },
        ] as Col<InvPayload["expenses"][number]>[]} searchKey={(r) => `${r.title} ${r.category} ${r.note || ""} ${r.created_by || ""}`}
          initialSort={{ key: "date", dir: "desc" }} placeholder="Search expenses…"
          emptyText="No expenses recorded in this period."
          footer={<tr><td><b>Total</b></td><td /><td /><td /><td className="num"><b>{inr(d.summary.expenses)}</b></td></tr>} />
      </Panel>
    </>
  );
}
