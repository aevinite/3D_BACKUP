"use client";
// Owner · Reports Studio — shared kit (2026-07-25 redesign).
//
// A premium, print-ready report suite for the owner panel. The old /owner/reports
// was one flat chip row → tiles → a generic chart → a table; this kit gives the
// page a cohesive design language (a categorised hub of report cards, a KPI hero
// band with period-over-period deltas, best-fit charts, clean tables) so the
// section reads like a real POS reporting product, not an admin table.
//
// Everything here is presentational + the report CATALOG. All numbers are still
// produced by the existing lfh_owner_* RPCs via /api/owner/reports — nothing is
// invented. Reports that need data the DB can't yet back (expenses, purchases,
// cash-drawer, tips, staff payroll) are intentionally NOT listed; they arrive
// with their own data-entry modules.
import { useEffect, useState } from "react";
import { inr } from "@/components/admin/shared";
import { Spark } from "@/components/owner/Charts";
import { AnimatedStatValue } from "@/components/owner/AnimatedNumber";

// ── The report catalog ─────────────────────────────────────────────────────
export type RKey =
  | "daysummary" | "sales" | "avgbill" | "volume" | "weekday"
  | "payments" | "discounts" | "cancellations"
  | "tax"
  | "dishes" | "categories" | "menu"
  | "hourly" | "daypart";

// Which server payload a report reads. Several reports are different VIEWS over the
// same bucketed money payload (one RPC round-trip) — sales/avgbill/volume/weekday/
// discounts/cancellations/tax all render from "money"; daypart re-slices "hourly";
// menu re-slices "dishes". So a dozen reports cost only a handful of query shapes.
export type DataKind = "money" | "daysummary" | "payments" | "dishes" | "categories" | "hourly";
export type Tone = "accent" | "good" | "warn" | "bad" | "info";

export type ReportMeta = {
  key: RKey; label: string; icon: string; blurb: string; kind: DataKind; tone?: Tone;
};
export type ReportCat = { key: string; label: string; icon: string; keys: RKey[] };

export const REPORTS: Record<RKey, ReportMeta> = {
  daysummary:    { key: "daysummary",    label: "Day summary",       icon: "fa-file-invoice-dollar", kind: "daysummary", tone: "accent", blurb: "The whole day on one sheet — money in, how it was paid, tax, and what you kept." },
  sales:         { key: "sales",         label: "Sales trend",       icon: "fa-chart-line",          kind: "money",      tone: "accent", blurb: "Revenue over time — subtotal, tax, discounts and net kept." },
  avgbill:       { key: "avgbill",       label: "Average bill",      icon: "fa-receipt",             kind: "money",      tone: "info",   blurb: "Average spend per paid bill, and which way it's trending." },
  volume:        { key: "volume",        label: "Order volume",      icon: "fa-list-check",          kind: "money",      tone: "info",   blurb: "How many orders came in — paid vs cancelled — over the period." },
  weekday:       { key: "weekday",       label: "Day of week",       icon: "fa-calendar-week",       kind: "money",      tone: "info",   blurb: "Which weekdays actually carry the business." },
  payments:      { key: "payments",      label: "Payment settlement",icon: "fa-wallet",              kind: "payments",   tone: "accent", blurb: "How the money truly arrived — UPI, cash, card, other." },
  discounts:     { key: "discounts",     label: "Discounts given",   icon: "fa-tag",                 kind: "money",      tone: "warn",   blurb: "What was given away, on which days." },
  cancellations: { key: "cancellations", label: "Cancellations",     icon: "fa-ban",                 kind: "money",      tone: "bad",    blurb: "Voided orders and the value lost with them." },
  tax:           { key: "tax",           label: "Tax / GST",         icon: "fa-landmark",            kind: "money",      tone: "accent", blurb: "Tax collected with the CGST/SGST split — ready for filing." },
  dishes:        { key: "dishes",        label: "Item sales",        icon: "fa-utensils",            kind: "dishes",     tone: "accent", blurb: "Every dish: how many sold and what it earned." },
  categories:    { key: "categories",    label: "Category mix",      icon: "fa-layer-group",         kind: "categories", tone: "accent", blurb: "Which sections of the menu carry the money." },
  menu:          { key: "menu",          label: "Menu engineering",  icon: "fa-lightbulb",           kind: "dishes",     tone: "info",   blurb: "Stars, workhorses, puzzles, dogs — what to push, price, fix or drop." },
  hourly:        { key: "hourly",        label: "Busy hours",        icon: "fa-clock",               kind: "hourly",     tone: "accent", blurb: "When the money comes in, hour by hour." },
  daypart:       { key: "daypart",       label: "Day parts",         icon: "fa-sun",                 kind: "hourly",     tone: "info",   blurb: "Morning, afternoon, evening and late-night at a glance." },
};

export const CATEGORIES: ReportCat[] = [
  { key: "overview", label: "Overview",             icon: "fa-gauge-high",  keys: ["daysummary", "sales", "avgbill", "volume"] },
  { key: "money",    label: "Money & settlement",   icon: "fa-sack-dollar", keys: ["payments", "discounts", "cancellations"] },
  { key: "tax",      label: "Tax & compliance",     icon: "fa-landmark",    keys: ["tax"] },
  { key: "menu",     label: "Menu & items",         icon: "fa-utensils",    keys: ["dishes", "categories", "menu"] },
  { key: "ops",      label: "Operations & timing",  icon: "fa-clock",       keys: ["hourly", "daypart", "weekday"] },
];

// ── Shared formatting ───────────────────────────────────────────────────────
export const money = (n: number) => inr(n);
export const nfmt = (n: number) => (Number(n) || 0).toLocaleString("en-IN");
export const pct = (n: number, digits = 0) => `${(Number(n) || 0).toFixed(digits)}%`;

// ── Delta vs the previous equal-length period ────────────────────────────────
// A muted "—" when there's nothing to compare, so a first period never lies with
// a fake "+100%". Big multipliers read as "12×" not "↑1174%".
export function Delta({ now, prev, invert = false }: { now: number; prev: number | null | undefined; invert?: boolean }) {
  if (prev == null || !Number.isFinite(prev)) return null;
  if (prev === 0 && now === 0) return <span className="rs-delta flat">—</span>;
  if (prev === 0) return <span className={`rs-delta ${invert ? "bad" : "good"}`}><i className="fas fa-arrow-up" aria-hidden />new</span>;
  const raw = ((now - prev) / prev) * 100;
  if (Math.abs(raw) < 0.5) return <span className="rs-delta flat">±0%</span>;
  const up = raw > 0;
  const good = invert ? !up : up;      // for "lost value"/discounts, up is bad
  const label = Math.abs(raw) >= 300 ? `${Math.round(now / prev)}×` : `${Math.abs(Math.round(raw))}%`;
  return (
    <span className={`rs-delta ${good ? "good" : "bad"}`}>
      <i className={`fas fa-arrow-${up ? "up" : "down"}`} aria-hidden />{label}
    </span>
  );
}

// ── KPI stat card ─────────────────────────────────────────────────────────────
// A tile can be made "clickable" by passing `onClick` — it then drills into the
// list/section it summarises (same-report smooth-scroll) or jumps to a related
// report. Clickable tiles are keyboard-operable (role=button, Enter/Space) and show
// a subtle arrow affordance that stays faintly visible on touch (no hover there).
export function Stat({ label, value, sub, tone = "accent", icon, delta, spark, big = false, onClick, title }: {
  label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: Tone; icon?: string;
  delta?: { now: number; prev: number | null | undefined; invert?: boolean };
  spark?: number[]; big?: boolean;
  onClick?: () => void;      // makes the tile a button that expands what it summarises
  title?: string;            // native tooltip + screen-reader label (e.g. "Jump to the dish list")
}) {
  const clickable = !!onClick;
  return (
    <div
      className={`rs-stat tone-${tone}${big ? " big" : ""}${clickable ? " clickable" : ""}`}
      onClick={onClick}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      title={title}
      aria-label={clickable ? (title || (typeof label === "string" ? label : undefined)) : undefined}
      onKeyDown={clickable ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } } : undefined}
    >
      <div className="rs-stat-top">
        <span className="rs-stat-k">{icon && <i className={`fas ${icon}`} aria-hidden />}{label}</span>
        {delta ? <Delta now={delta.now} prev={delta.prev} invert={delta.invert} />
          : clickable ? <span className="rs-stat-go" aria-hidden><i className="fas fa-arrow-right-long" /></span> : null}
      </div>
      <div className="rs-stat-v"><AnimatedStatValue value={value} /></div>
      {sub != null && <div className="rs-stat-sub">{sub}</div>}
      {spark && spark.length > 1 && <div className="rs-stat-spark"><Spark points={spark} color="var(--accent)" width={128} height={30} /></div>}
    </div>
  );
}

// Smooth-scroll to a section within the report and briefly flash it, so a tile that
// says "12 dishes" can carry the eye to the actual dish table. Respects reduced-motion
// (jumps instead of animating) and is a no-op if the id isn't on the page.
export function scrollToId(id: string) {
  if (typeof document === "undefined") return;
  const el = document.getElementById(id);
  if (!el) return;
  const reduce = typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  el.classList.remove("rs-flash");
  void el.offsetWidth;                 // restart the flash even on a repeat click
  el.classList.add("rs-flash");
  window.setTimeout(() => el.classList.remove("rs-flash"), 1400);
}

// ── Panel — a titled card that content sits inside ────────────────────────────
export function Panel({ title, hint, right, children, pad = true, id }: {
  title?: React.ReactNode; hint?: React.ReactNode; right?: React.ReactNode; children: React.ReactNode; pad?: boolean;
  id?: string;   // anchor target so a KPI tile can smooth-scroll to this panel
}) {
  return (
    <section className="rs-panel" id={id}>
      {(title || right) && (
        <header className="rs-panel-h">
          <div><b>{title}</b>{hint && <span className="rs-panel-hint"> · {hint}</span>}</div>
          {right}
        </header>
      )}
      <div className={pad ? "rs-panel-b" : ""}>{children}</div>
    </section>
  );
}

// ── Print-only document header ────────────────────────────────────────────────
// Hidden on screen (display:none), painted ONLY in @media print. Gives the printed
// sheet a real document masthead — brand line, report title, "restaurant · period"
// scope, and a "Generated <date, time>" stamp — so a printout reads like an official
// statement rather than a screenshot of the console. The timestamp is filled on mount
// (empty on the server + first client paint) to avoid an SSR/CSR hydration mismatch,
// and refreshed on `beforeprint` so it reflects the moment the sheet is actually made.
export function PrintHead({ restName, title, period }: { restName: string; title: string; period: string }) {
  const [gen, setGen] = useState("");
  useEffect(() => {
    const stamp = () =>
      setGen(new Date().toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }));
    stamp();
    window.addEventListener("beforeprint", stamp);
    return () => window.removeEventListener("beforeprint", stamp);
  }, []);
  return (
    <div className="rs-printhead" aria-hidden>
      <div className="rs-ph-row">
        <span className="rs-ph-brand">Aevidine · Restaurant OS</span>
        {gen && <span className="rs-ph-gen">Generated {gen}</span>}
      </div>
      <div className="rs-ph-title">{title}</div>
      <div className="rs-ph-scope">{restName} · {period}</div>
    </div>
  );
}

// The full design-system CSS for the reports studio. Scoped to `.rs-root` so it
// never bleeds into the rest of the owner console; rendered once by the page.
export function ReportsStyles() {
  return (
    <style jsx global>{`
      .rs-root { --r: 14px; }
      .rs-root .tone-accent { --tone-c: var(--accent); }
      .rs-root .tone-good   { --tone-c: var(--adm-ok); }
      .rs-root .tone-warn   { --tone-c: var(--adm-warn); }
      .rs-root .tone-bad    { --tone-c: var(--adm-danger); }
      .rs-root .tone-info   { --tone-c: #5b8def; }

      /* ── Header + controls ─────────────────────────────────────────────── */
      .rs-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 14px; flex-wrap: wrap; margin-bottom: 4px; }
      .rs-crumb { display: inline-flex; align-items: center; gap: 8px; font-size: 12px; color: var(--muted); font-weight: 600; }
      .rs-crumb button { background: none; border: none; color: var(--muted); font: inherit; font-weight: 600; padding: 0; cursor: pointer; }
      .rs-crumb button:hover { color: var(--accent); }
      .rs-h1 { font-size: 22px; font-weight: 800; margin: 2px 0 0; letter-spacing: -0.02em; }
      .rs-sub { font-size: 12.5px; color: var(--muted); margin: 4px 0 0; }
      .rs-controls { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin: 16px 0 18px; }
      .rs-select { height: 34px; padding: 0 12px; border-radius: 9px; border: 1px solid var(--border-c); background: var(--card); color: var(--text); font-size: 12.5px; font-weight: 600; }
      .rs-seg { display: inline-flex; background: var(--card); border: 1px solid var(--border-c); border-radius: 10px; padding: 3px; gap: 2px; flex-wrap: wrap; }
      .rs-seg button { border: none; background: none; color: var(--muted); font: inherit; font-size: 12px; font-weight: 700; padding: 6px 11px; border-radius: 7px; cursor: pointer; transition: background .15s ease, color .15s ease; }
      .rs-seg button:hover { color: var(--text); }
      .rs-seg button.on { background: color-mix(in srgb, var(--accent) 16%, transparent); color: var(--accent); }
      .rs-actions { display: flex; gap: 8px; margin-left: auto; }
      .rs-btn { display: inline-flex; align-items: center; gap: 7px; height: 34px; padding: 0 13px; border-radius: 9px; border: 1px solid var(--border-c); background: var(--card); color: var(--text); font-size: 12.5px; font-weight: 700; cursor: pointer; transition: background .15s ease, border-color .15s ease, box-shadow .15s ease; }
      .rs-btn:hover { background: var(--muted2); }
      .rs-btn.cta { background: var(--own-cta); border-color: var(--own-cta); color: #fff; }
      .rs-btn.cta:hover { filter: brightness(1.06); }
      .rs-btn.pulse { box-shadow: 0 0 0 3px color-mix(in srgb, var(--own-cta) 34%, transparent); animation: rs-pulse 1.6s ease-in-out infinite; }
      @keyframes rs-pulse { 0%,100% { box-shadow: 0 0 0 3px color-mix(in srgb, var(--own-cta) 30%, transparent); } 50% { box-shadow: 0 0 0 6px color-mix(in srgb, var(--own-cta) 10%, transparent); } }
      @media (prefers-reduced-motion: reduce) { .rs-btn.pulse { animation: none; } }
      .rs-dirty-hint { font-size: 11.5px; font-weight: 700; color: var(--own-cta); display: inline-flex; align-items: center; gap: 6px; }

      /* ── Hub: overview strip + category sections + report cards ─────────── */
      .rs-overview { border: 1px solid var(--border-c); border-radius: var(--r); background: linear-gradient(135deg, color-mix(in srgb, var(--accent) 10%, var(--card)), var(--card) 60%); padding: 20px 22px; margin-bottom: 22px; overflow: hidden; }
      .rs-ov-eyebrow { font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: .08em; color: var(--accent); }
      .rs-ov-val { font-size: 40px; font-weight: 800; letter-spacing: -0.03em; line-height: 1.05; margin: 6px 0 2px; font-variant-numeric: tabular-nums; }
      .rs-ov-sub { font-size: 12.5px; color: var(--muted); }
      .rs-ov-kpis { display: flex; gap: 30px; flex-wrap: wrap; margin: 16px 0 4px; }
      .rs-ov-kpis .k { display: flex; flex-direction: column; min-width: 0; }
      .rs-ov-kpis .lbl { font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); }
      .rs-ov-kpis .v { font-size: 18px; font-weight: 800; font-variant-numeric: tabular-nums; margin-top: 3px; }
      .rs-ov-charthead { display: flex; align-items: center; justify-content: space-between; margin-top: 16px; }
      .rs-ov-charthead .t { font-size: 12px; font-weight: 700; color: var(--muted); }
      .rs-ov-toggle { display: inline-flex; background: var(--muted2); border-radius: 999px; padding: 3px; gap: 3px; }
      .rs-ov-toggle button { border: none; background: none; color: var(--muted); font: inherit; font-size: 12px; font-weight: 700; padding: 5px 16px; border-radius: 999px; cursor: pointer; transition: background .18s ease, color .18s ease; }
      .rs-ov-toggle button:hover { color: var(--text); }
      .rs-ov-toggle button.on { background: var(--accent); color: #fff; }
      .rs-ov-chart { margin-top: 8px; }
      .rs-ov-empty { height: 210px; display: grid; place-items: center; color: var(--muted); font-size: 13px; }
      /* Shared toggle-chart (bar/line) header — used by the hub + every time-based report. */
      .rs-tc-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 6px; }
      .rs-tc-title { font-size: 12px; font-weight: 700; color: var(--muted); }
      .rs-tc-toggle { display: inline-flex; background: var(--muted2); border-radius: 999px; padding: 3px; gap: 3px; }
      .rs-tc-toggle button { border: none; background: none; color: var(--muted); font: inherit; font-size: 11.5px; font-weight: 700; padding: 4px 14px; border-radius: 999px; cursor: pointer; transition: background .18s ease, color .18s ease; }
      .rs-tc-toggle button:hover { color: var(--text); }
      .rs-tc-toggle button.on { background: var(--accent); color: #fff; }
      .rs-ov-skel { height: 210px; border-radius: 10px; background: linear-gradient(90deg, color-mix(in srgb, var(--muted2) 55%, transparent), var(--muted2), color-mix(in srgb, var(--muted2) 55%, transparent)); background-size: 200% 100%; animation: rs-shimmer 1.3s ease-in-out infinite; }
      @keyframes rs-shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
      @media (prefers-reduced-motion: reduce) { .rs-ov-skel { animation: none; } }

      .rs-catrow { display: flex; align-items: center; gap: 9px; margin: 26px 2px 12px; }
      .rs-catrow .ic { width: 26px; height: 26px; border-radius: 8px; display: grid; place-items: center; background: color-mix(in srgb, var(--accent) 14%, transparent); color: var(--accent); font-size: 12px; }
      .rs-catrow b { font-size: 14px; font-weight: 800; letter-spacing: -0.01em; }
      .rs-catrow .n { font-size: 11px; color: var(--muted); font-weight: 700; }
      .rs-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; }
      .rs-card { text-align: left; display: flex; gap: 13px; align-items: flex-start; padding: 15px 15px; border: 1px solid var(--border-c); border-radius: var(--r); background: var(--card); cursor: pointer; transition: transform .16s ease, border-color .16s ease, box-shadow .16s ease; position: relative; }
      .rs-card:hover { transform: translateY(-2px); border-color: color-mix(in srgb, var(--tone-c) 55%, var(--border-c)); box-shadow: 0 10px 26px -14px color-mix(in srgb, var(--tone-c) 60%, transparent); }
      .rs-card .cic { width: 40px; height: 40px; flex-shrink: 0; border-radius: 11px; display: grid; place-items: center; font-size: 16px; background: color-mix(in srgb, var(--tone-c) 15%, transparent); color: var(--tone-c); }
      .rs-card .ct { min-width: 0; }
      .rs-card .ct b { display: block; font-size: 13.5px; font-weight: 700; letter-spacing: -0.01em; }
      .rs-card .ct p { font-size: 11.5px; color: var(--muted); margin: 3px 0 0; line-height: 1.4; }
      .rs-card .go { position: absolute; top: 15px; right: 14px; color: var(--muted); font-size: 11px; opacity: 0; transform: translateX(-3px); transition: opacity .16s ease, transform .16s ease; }
      .rs-card:hover .go { opacity: 1; transform: translateX(0); color: var(--tone-c); }

      /* ── Report view: title, KPI band, panels ──────────────────────────── */
      .rs-report { animation: rs-fade .22s ease; }
      @keyframes rs-fade { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
      @media (prefers-reduced-motion: reduce) { .rs-report { animation: none; } }
      .rs-rtitle { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; }
      .rs-rtitle .cic { width: 42px; height: 42px; flex-shrink: 0; border-radius: 12px; display: grid; place-items: center; font-size: 17px; background: color-mix(in srgb, var(--tone-c) 15%, transparent); color: var(--tone-c); }
      .rs-rtitle h2 { font-size: 18px; font-weight: 800; margin: 0; letter-spacing: -0.02em; }
      .rs-rtitle .scope { font-size: 12px; color: var(--muted); margin-top: 2px; }

      .rs-kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-bottom: 16px; }
      .rs-stat { border: 1px solid var(--border-c); border-radius: var(--r); background: var(--card); padding: 14px 15px; position: relative; overflow: hidden; }
      .rs-stat::before { content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 3px; background: var(--tone-c); opacity: .85; }
      .rs-stat.big { background: linear-gradient(135deg, color-mix(in srgb, var(--tone-c) 12%, var(--card)), var(--card) 68%); }
      .rs-stat-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
      .rs-stat-k { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); display: inline-flex; align-items: center; gap: 6px; }
      .rs-stat-k i { color: var(--tone-c); font-size: 11px; }
      .rs-stat-v { font-size: 25px; font-weight: 800; letter-spacing: -0.02em; margin-top: 7px; font-variant-numeric: tabular-nums; line-height: 1.1; }
      .rs-stat.big .rs-stat-v { font-size: 30px; }
      .rs-stat-sub { font-size: 11.5px; color: var(--muted); margin-top: 4px; }
      .rs-stat-spark { margin-top: 8px; }

      /* Clickable KPI tile — drills into the list/section it summarises. */
      .rs-stat.clickable { cursor: pointer; transition: transform .16s ease, border-color .16s ease, box-shadow .16s ease; }
      .rs-stat.clickable:hover { transform: translateY(-2px); border-color: color-mix(in srgb, var(--tone-c) 50%, var(--border-c)); box-shadow: 0 10px 24px -14px color-mix(in srgb, var(--tone-c) 55%, transparent); }
      .rs-stat.clickable:focus-visible { outline: none; box-shadow: 0 0 0 3px color-mix(in srgb, var(--tone-c) 40%, transparent); border-color: color-mix(in srgb, var(--tone-c) 55%, var(--border-c)); }
      .rs-stat-go { display: inline-grid; place-items: center; width: 22px; height: 22px; flex-shrink: 0; border-radius: 999px; color: var(--tone-c); background: color-mix(in srgb, var(--tone-c) 13%, transparent); font-size: 10px; opacity: .6; transition: opacity .16s ease, transform .16s ease; }
      .rs-stat.clickable:hover .rs-stat-go, .rs-stat.clickable:focus-visible .rs-stat-go { opacity: 1; transform: translateX(2px); }
      @media (prefers-reduced-motion: reduce) { .rs-stat.clickable { transition: none; } .rs-stat.clickable:hover { transform: none; } .rs-stat.clickable:hover .rs-stat-go, .rs-stat.clickable:focus-visible .rs-stat-go { transform: none; } }

      /* Inline "open the full report / view items" affordance used inside tables + panel headers. */
      .rs-drill { display: inline-flex; align-items: center; gap: 5px; font: inherit; font-size: 11.5px; font-weight: 700; color: var(--accent); background: color-mix(in srgb, var(--accent) 10%, transparent); border: 1px solid color-mix(in srgb, var(--accent) 24%, transparent); border-radius: 8px; padding: 3px 9px; cursor: pointer; white-space: nowrap; transition: background .14s ease, transform .14s ease; }
      .rs-drill:hover { background: color-mix(in srgb, var(--accent) 18%, transparent); transform: translateX(1px); }
      .rs-drill:focus-visible { outline: none; box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 30%, transparent); }
      .rs-drill i { font-size: 9px; }
      @media (prefers-reduced-motion: reduce) { .rs-drill:hover { transform: none; } }

      /* Landing flash — a brief accent ring when a tile scrolls you to a section. */
      .rs-flash { animation: rs-flash 1.4s ease; }
      @keyframes rs-flash { 0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent) 45%, transparent); } 35% { box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 34%, transparent); } 100% { box-shadow: 0 0 0 0 transparent; } }
      @media (prefers-reduced-motion: reduce) { .rs-flash { animation: none; } }

      .rs-delta { display: inline-flex; align-items: center; gap: 3px; font-size: 11px; font-weight: 800; padding: 2px 7px; border-radius: 999px; font-variant-numeric: tabular-nums; white-space: nowrap; }
      .rs-delta i { font-size: 9px; }
      .rs-delta.good { color: var(--adm-ok); background: color-mix(in srgb, var(--adm-ok) 15%, transparent); }
      .rs-delta.bad  { color: var(--adm-danger); background: color-mix(in srgb, var(--adm-danger) 15%, transparent); }
      .rs-delta.flat { color: var(--muted); background: var(--muted2); }

      .rs-grid { display: grid; gap: 14px; }
      .rs-grid.two { grid-template-columns: 1.5fr 1fr; }
      @media (max-width: 900px) { .rs-grid.two { grid-template-columns: 1fr; } }

      .rs-panel { border: 1px solid var(--border-c); border-radius: var(--r); background: var(--card); overflow: hidden; scroll-margin-top: 84px; }
      .rs-panel-h { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 13px 16px; border-bottom: 1px solid var(--border-c); font-size: 13px; }
      .rs-panel-h b { font-weight: 800; letter-spacing: -0.01em; }
      .rs-panel-hint { font-weight: 500; color: var(--muted); }
      .rs-panel-b { padding: 16px; }

      /* ── Tables ────────────────────────────────────────────────────────── */
      .rs-tablewrap { overflow-x: auto; }
      .rs-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
      .rs-table th { text-align: left; font-size: 10.5px; font-weight: 800; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); padding: 9px 12px; border-bottom: 1px solid var(--border-c); position: sticky; top: 0; background: var(--card); }
      .rs-table td { padding: 9px 12px; border-bottom: 1px solid color-mix(in srgb, var(--border-c) 60%, transparent); font-variant-numeric: tabular-nums; }
      .rs-table tbody tr:hover { background: var(--muted2); }
      .rs-table .num { text-align: right; }
      .rs-table tfoot td { font-weight: 800; border-top: 2px solid var(--border-c); border-bottom: none; }
      .rs-note { font-size: 11.5px; color: var(--muted); margin: 10px 4px 2px; line-height: 1.5; }
      .rs-empty { padding: 34px 16px; text-align: center; color: var(--muted); font-size: 13px; }
      .rs-empty i { font-size: 22px; display: block; margin-bottom: 8px; opacity: .5; }

      /* ── Day summary sheet ─────────────────────────────────────────────── */
      .rs-daysheet { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 14px; }
      .rs-lines { display: flex; flex-direction: column; }
      .rs-line { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; padding: 8px 0; border-bottom: 1px dashed color-mix(in srgb, var(--border-c) 80%, transparent); font-size: 13px; }
      .rs-line:last-child { border-bottom: none; }
      .rs-line .lbl { color: var(--muted); font-weight: 600; }
      .rs-line .val { font-weight: 700; font-variant-numeric: tabular-nums; }
      .rs-line.total { margin-top: 4px; padding-top: 12px; border-top: 2px solid var(--border-c); border-bottom: none; font-size: 15px; }
      .rs-line.total .lbl { color: var(--text); font-weight: 800; }
      .rs-line.total .val { font-weight: 800; color: var(--accent); }
      .rs-line.sub { padding-left: 14px; font-size: 12px; }
      .rs-line.sub .lbl::before { content: "└ "; opacity: .5; }
      .rs-line .neg { color: var(--adm-warn); }

      .rs-paylist { display: flex; flex-direction: column; gap: 11px; }
      .rs-payrow { display: grid; grid-template-columns: 12px 1fr auto; gap: 10px; align-items: center; }
      .rs-payrow .sw { width: 12px; height: 12px; border-radius: 4px; }
      .rs-payrow .pm { font-size: 13px; font-weight: 700; }
      .rs-payrow .amt { font-size: 13.5px; font-weight: 800; font-variant-numeric: tabular-nums; }
      .rs-paybar { grid-column: 2 / 4; height: 6px; border-radius: 999px; background: var(--muted2); overflow: hidden; margin-top: -3px; }
      .rs-paybar > span { display: block; height: 100%; border-radius: 999px; }

      /* ── Menu-engineering quadrant ─────────────────────────────────────── */
      .rs-quad { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; scroll-margin-top: 84px; }
      @media (max-width: 720px) { .rs-quad { grid-template-columns: 1fr; } }
      .rs-qbox { border: 1px solid var(--border-c); border-radius: 12px; padding: 13px 14px; background: var(--card); border-top: 3px solid var(--qc, var(--border-c)); }
      .rs-qbox.star { --qc: #16a34a; } .rs-qbox.workhorse { --qc: #3987e5; }
      .rs-qbox.puzzle { --qc: #d97706; } .rs-qbox.dog { --qc: #e2607a; }
      .rs-qh { display: flex; align-items: center; gap: 9px; }
      .rs-qh .qi { width: 26px; height: 26px; border-radius: 7px; display: grid; place-items: center; background: color-mix(in srgb, var(--qc) 16%, transparent); color: var(--qc); font-size: 12px; }
      .rs-qh b { font-size: 13.5px; font-weight: 800; }
      .rs-qh .qn { margin-left: auto; font-size: 11.5px; font-weight: 800; color: var(--muted); background: var(--muted2); border-radius: 999px; padding: 1px 9px; }
      .rs-qsub { font-size: 11px; font-weight: 700; color: var(--text); opacity: .8; margin: 6px 0 1px; }
      .rs-qtip { font-size: 11.5px; color: var(--muted); margin: 4px 0 9px; line-height: 1.4; }
      .rs-qchips { display: flex; flex-wrap: wrap; gap: 6px; }
      .rs-qchip { font-size: 11.5px; font-weight: 600; padding: 3px 9px; border-radius: 7px; background: color-mix(in srgb, var(--qc) 10%, transparent); border: 1px solid color-mix(in srgb, var(--qc) 26%, transparent); }
      .rs-qmore { font-size: 11px; color: var(--muted); align-self: center; }
      .rs-tag { font-size: 10px; font-weight: 800; padding: 2px 8px; border-radius: 999px; white-space: nowrap; text-transform: uppercase; letter-spacing: .03em; }
      .rs-tag.star { background: color-mix(in srgb, #16a34a 16%, transparent); color: #16a34a; }
      .rs-tag.workhorse { background: color-mix(in srgb, #3987e5 16%, transparent); color: #3987e5; }
      .rs-tag.puzzle { background: color-mix(in srgb, #d97706 18%, transparent); color: #d97706; }
      .rs-tag.dog { background: color-mix(in srgb, #e2607a 16%, transparent); color: #e2607a; }

      @media (max-width: 640px) {
        .rs-ov-val { font-size: 32px; }
        .rs-ov-kpis { gap: 20px; }
      }

      /* The document masthead is invisible on screen; it only paints in @media print. */
      .rs-printhead { display: none; }

      /* ── Print: a clean one-report document, not a screenshot of the console ──
         Works for EVERY report (the rules are generic by class): money/day-summary,
         item/category/menu, tax with its split table, hourly/daypart, etc. */
      @media print {
        @page { margin: 14mm; }

        /* Force an ink-friendly light palette regardless of the dark/light skin, by
           re-pointing the CSS tokens the whole studio reads from. Without this a dark
           skin would print light text onto white paper (invisible). */
        .adm.owx, .rs-root {
          --text: #111 !important;
          --muted: #555 !important;
          --muted2: #f1f1f1 !important;
          --card: #ffffff !important;
          --border-c: #cfcfcf !important;
          background: #fff !important;
          color: #111 !important;
        }
        /* Print backgrounds/rules faithfully (chart bars, coloured tags, split bars). */
        * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }

        /* Hide every piece of app chrome + on-screen-only affordances:
           sidebar, top strip, admin bar, drawer backdrop; the period control + CSV/Print
           buttons; the report-hub cards + category rows; the breadcrumb; the bar/line
           toggle pills; the search boxes; and all hover/drill arrows. Also hide the
           on-screen report title strip — the print masthead replaces it. */
        .owx-side, .owx-top, .owx-backdrop, .adm-adminbar,
        .rs-head, .rs-controls, .rs-crumb, .rs-actions,
        .rs-catrow, .rs-cards, .rs-card,
        .rs-rtitle,
        .rs-tc-toggle, .rs-ov-toggle,
        .rs-stat-go, .rs-drill, .rs-card .go,
        .rs-st-search, .rs-st-clear {
          display: none !important;
        }

        /* Flatten the shell so the report owns the full page width. */
        .adm, .adm.owx, .adm-body, .adm-main, .owx-wrap, .rs-root {
          display: block !important;
          padding: 0 !important;
          margin: 0 !important;
          overflow: visible !important;
          width: auto !important;
          max-width: none !important;
        }

        /* The print-only document masthead. */
        .rs-printhead { display: block !important; margin: 0 0 16px; padding: 0 0 10px; border-bottom: 1.5px solid #111; color: #111; break-inside: avoid; break-after: avoid; }
        .rs-ph-row { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
        .rs-ph-brand { font-size: 10.5px; font-weight: 800; letter-spacing: .09em; text-transform: uppercase; color: #333; }
        .rs-ph-gen { font-size: 10.5px; color: #555; font-variant-numeric: tabular-nums; }
        .rs-ph-title { font-size: 23px; font-weight: 800; letter-spacing: -0.02em; margin: 9px 0 2px; color: #111; }
        .rs-ph-scope { font-size: 12.5px; color: #444; font-weight: 600; }

        /* KPI tiles, panels and quadrant boxes → clean bordered boxes; no colour
           wash, no shadow, and never split across a page. */
        .rs-report { animation: none !important; }
        .rs-overview, .rs-stat, .rs-panel, .rs-qbox {
          border: 1px solid #cfcfcf !important;
          background: #fff !important;
          box-shadow: none !important;
          break-inside: avoid;
        }
        .rs-stat::before { display: none !important; }        /* drop the coloured accent bar */
        .rs-stat.big, .rs-overview { background: #fff !important; }
        .rs-stat.clickable, .rs-card { transform: none !important; }
        .rs-payrow, .rs-line, .rs-qbox, .rs-panel-h, .rs-panel-b, .rs-ov-chart, .ri-card { break-inside: avoid; }
        .rs-h1 { color: #111 !important; }

        /* Tables print in FULL — no inner scroll cap, no sticky header, rows kept whole.
           (.rs-st-scroll carries an inline max-height that this !important overrides.) */
        .rs-tablewrap, .rs-st-scroll { overflow: visible !important; max-height: none !important; }
        .rs-table th { position: static !important; background: #fff !important; color: #333 !important; border-bottom: 1px solid #999 !important; }
        .rs-table td { border-bottom: 1px solid #e4e4e4 !important; }
        .rs-table tbody tr { break-inside: avoid; }
        .rs-table tbody tr:hover { background: none !important; }
      }
    `}</style>
  );
}
