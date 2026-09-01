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
// SIX full reports (owner 2026-07-26: "there are too many sub-reports which are not needed").
// Each merged report bundles what used to be separate cards, as sub-tabs / KPI drill-boxes
// inside ONE report, so the owner never hops sub-report → sub-report:
//   • sales   = revenue trend + average bill + order volume
//   • payments= settlement + discounts + cancellations (the last two open as detail overlays)
//   • items   = item sales + category mix + menu engineering (sub-tabs)
//   • timing  = busy hours + day parts + day of the week (sub-tabs)
export type RKey = "daysummary" | "sales" | "payments" | "tax" | "items" | "timing" | "team" | "inventory";

// Which server payload a report reads. Merged reports may pull a SECOND payload on demand
// (items also fetches categories; timing also fetches the money series for day-of-week) —
// the page requests that extra shape when the report opens.
export type DataKind = "money" | "daysummary" | "payments" | "dishes" | "categories" | "hourly" | "staffpay" | "staffperf"
  // Inventory & stock (mig 227) — one kind per sub-tab, each hitting /api/owner/reports?type=inv*
  | "invstock" | "invpurchases" | "invusage" | "invwaste" | "invexpenses";
export type Tone = "accent" | "good" | "warn" | "bad" | "info";

export type ReportMeta = {
  key: RKey; label: string; icon: string; blurb: string; kind: DataKind; tone?: Tone;
};
export type ReportCat = { key: string; label: string; icon: string; keys: RKey[] };

export const REPORTS: Record<RKey, ReportMeta> = {
  daysummary: { key: "daysummary", label: "Day summary",   icon: "fa-file-invoice-dollar", kind: "daysummary", tone: "accent", blurb: "The whole day on one sheet — money in, how it was paid, the tax, plus the day's dishes and busy hours." },
  sales:      { key: "sales",      label: "Sales",         icon: "fa-chart-line",          kind: "money",      tone: "accent", blurb: "Money over time — total collected, net sales, average bill and how many orders came in." },
  payments:   { key: "payments",   label: "Payments",      icon: "fa-wallet",              kind: "payments",   tone: "accent", blurb: "How the money arrived — UPI, cash, card — with discounts given and value lost to cancellations." },
  tax:        { key: "tax",        label: "Tax / GST",     icon: "fa-landmark",            kind: "money",      tone: "accent", blurb: "GST collected with the CGST/SGST split — ready for filing." },
  items:      { key: "items",      label: "Items & menu",  icon: "fa-utensils",            kind: "dishes",     tone: "accent", blurb: "Every dish and category: what sells, what earns, and what to push, price, fix or drop." },
  timing:     { key: "timing",     label: "Busy times",    icon: "fa-clock",               kind: "hourly",     tone: "accent", blurb: "When the business comes in — by hour, by part of the day, and by day of the week." },
  // Staff profiles & pay module (mig 220). Two views: what the team COST and was PAID, and how
  // each person is doing. Both owner-only; the card is hidden unless the module is on.
  team:       { key: "team",       label: "Team & pay",    icon: "fa-users",               kind: "staffpay",   tone: "accent", blurb: "Salary and advances you paid out — as cash leaving on the day, and as what each month cost — plus how every person is performing." },
  // Inventory & stock module (migs 221/224/227). Five views: what's left on the shelf, what
  // you bought, what your dishes ate, what was thrown away, and the expense book. The card
  // is hidden entirely unless the module is on for at least one restaurant.
  inventory:  { key: "inventory",  label: "Inventory & stock", icon: "fa-boxes-stacked",   kind: "invstock",   tone: "accent", blurb: "What's on the shelf right now and what it's worth, everything you bought, what your dishes actually ate, waste, and the expense book — with an honest cost-per-dish." },
};

export const CATEGORIES: ReportCat[] = [
  { key: "overview", label: "Overview",            icon: "fa-gauge-high",  keys: ["daysummary", "sales"] },
  { key: "money",    label: "Money & tax",         icon: "fa-sack-dollar", keys: ["payments", "tax"] },
  { key: "menu",     label: "Menu & items",        icon: "fa-utensils",    keys: ["items"] },
  { key: "ops",      label: "Operations & timing", icon: "fa-clock",       keys: ["timing"] },
  { key: "team",     label: "Team & pay",          icon: "fa-users",       keys: ["team"] },
  { key: "inventory", label: "Inventory & stock",   icon: "fa-boxes-stacked", keys: ["inventory"] },
];

// ── The groupings a report SHOWS, in one place ──────────────────────────────
// These used to live only inside app/owner/reports/page.tsx, so the EXPORT could not reach
// them — which is why "Times of day" downloaded the by-hour table and "Day of week"
// downloaded the dated by-period one (T11 round 2, 2026-09-01). One definition, two readers:
// the screen and the file can no longer describe different groupings under the same heading.
export const DAYPARTS: { label: string; icon: string; hours: number[] }[] = [
  { label: "Morning",    icon: "fa-mug-hot",   hours: [5, 6, 7, 8, 9, 10, 11] },
  { label: "Afternoon",  icon: "fa-sun",       hours: [12, 13, 14, 15, 16] },
  { label: "Evening",    icon: "fa-cloud-sun", hours: [17, 18, 19, 20, 21] },
  { label: "Late night", icon: "fa-moon",      hours: [22, 23, 0, 1, 2, 3, 4] },
];
export const WEEKDAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
export const WEEKDAY_FULL: Record<string, string> = {
  Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Fri: "Friday", Sat: "Saturday", Sun: "Sunday",
};
/** A bucket instant → its IST weekday. IST, or a non-IST reader groups a day into the wrong one. */
export const istWeekday = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { weekday: "short", timeZone: "Asia/Kolkata" });

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
export function Panel({ title, hint, right, children, pad = true, id, fill = false }: {
  title?: React.ReactNode; hint?: React.ReactNode; right?: React.ReactNode; children: React.ReactNode; pad?: boolean;
  id?: string;   // anchor target so a KPI tile can smooth-scroll to this panel
  // fill: hand the leftover height DOWN to the child instead of leaving a blank band under it.
  // A .rs-grid row stretches both panels to the taller one, so a short chart beside a 400px
  // table sat in dead space (same fault the owner reported on the dashboard, 2026-08-19).
  // Opt-in, because most panels hold text that must NOT be stretched.
  fill?: boolean;
}) {
  return (
    <section className="rs-panel" id={id} style={fill ? { display: "flex", flexDirection: "column" } : undefined}>
      {(title || right) && (
        <header className="rs-panel-h">
          <div><b>{title}</b>{hint && <span className="rs-panel-hint"> · {hint}</span>}</div>
          {right}
        </header>
      )}
      <div className={pad ? "rs-panel-b" : ""} style={fill ? { display: "flex", flexDirection: "column", flex: "1 1 auto", minHeight: 0 } : undefined}>{children}</div>
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
/** An ISO instant → "4 Aug 2026, 9:52 pm" in IST (a printed sheet is read in India). */
const fmtAsOf = (iso: string) => {
  const t = Date.parse(iso);
  return Number.isFinite(t)
    ? new Date(t).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" })
    : "";
};
export function PrintHead({ restName, title, period, asOf }: { restName: string; title: string; period: string; asOf?: string }) {
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
      {/* "Generated <now>" is when the PAPER was made. These figures come from the snapshot
          cache, so the sheet also has to say when the NUMBERS were computed — otherwise a
          current timestamp sits over figures that may be hours old, on a document somebody
          files (owner-panel sweep 2026-08-04). */}
      {asOf && <div className="rs-ph-asof">Figures as of {fmtAsOf(asOf)}</div>}
    </div>
  );
}

/** The closing note, word-for-word the one sectionHtml() prints, so both sheets read alike. */
export function PrintFoot() {
  return (
    <div className="rs-printfoot" aria-hidden>
      Item sales are menu prices before discount. Total collected is every rupee guests paid
      (GST included) on paid, non-cancelled orders; your earnings are the item sales minus
      discount, before GST. Generated automatically by the Aevidine owner console.
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
      /* The no-internet note (owner, 2026-08-30 — item 5). Amber, at the TOP, above everything
         else on the page. Deliberately quiet: one row, the same border weight as the print-blocked
         bar next to it, and it does not steal the accent colour that means "this is your money". */
      .rs-offnote { display: flex; align-items: center; gap: 10px; margin: 0 0 14px; padding: 10px 13px;
        border: 1px solid var(--adm-warn, #d97706); border-radius: 10px; color: var(--text);
        background: color-mix(in srgb, var(--adm-warn, #d97706) 9%, transparent); font-size: 13px; line-height: 1.45; }
      .rs-offnote > span { flex: 1; min-width: 0; }
      .rs-offnote > i { color: var(--adm-warn, #d97706); flex-shrink: 0; }
      /* On paper it is meaningless — the sheet is printed from whatever was on screen. */
      @media print { .rs-offnote { display: none !important; } }
      @media (max-width: 640px) { .rs-offnote { flex-wrap: wrap; } .rs-offnote > span { flex: 1 1 100%; } }

      /* A dash where a figure would be, when there is no connection and nothing saved. Same size
         and weight as the number it replaces, so the card does not jump; muted, so it reads as
         "not known" rather than as a value. */
      .rs-ov-dash { color: var(--muted); }
      /* No chart region at all when there is nothing to draw — a 210px void under a row of
         dashes reads as "it failed to paint" rather than as "there is nothing here". */
      .rs-ov-blank { min-height: 0; }

      .rs-back { display: inline-flex; align-items: center; gap: 7px; background: none; border: none; color: var(--muted); font: inherit; font-size: 12.5px; font-weight: 700; padding: 4px 0; cursor: pointer; transition: color .14s ease; }
      .rs-back:hover { color: var(--accent); }
      .rs-back i { font-size: 11px; }
      @media print { .rs-back { display: none !important; } }
      .rs-h1 { font-size: 22px; font-weight: 800; margin: 2px 0 0; letter-spacing: -0.02em; }
      .rs-sub { font-size: 12.5px; color: var(--muted); margin: 4px 0 0; }
      .rs-controls { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin: 16px 0 18px; }
      .rs-select { height: 34px; padding: 0 12px; border-radius: 9px; border: 1px solid var(--border-c); background: var(--card); color: var(--text); font-size: 12.5px; font-weight: 600; }
      .rs-seg { display: inline-flex; background: var(--card); border: 1px solid var(--border-c); border-radius: 10px; padding: 3px; gap: 2px; flex-wrap: wrap; }
      .rs-seg button { border: none; background: none; color: var(--muted); font: inherit; font-size: 12px; font-weight: 700; padding: 6px 11px; border-radius: 7px; cursor: pointer; transition: background .15s ease, color .15s ease; }
      .rs-seg button:hover { color: var(--text); }
      .rs-seg button.on { background: color-mix(in srgb, var(--accent) 16%, transparent); color: var(--accent); }
      .rs-date { border: none; background: none; color: var(--text); font: inherit; font-size: 12px; font-weight: 700; padding: 5px 8px; border-radius: 7px; cursor: pointer; color-scheme: dark light; }
      .rs-date:hover { background: color-mix(in srgb, var(--accent) 10%, transparent); }
      .rs-custom { display: inline-flex; align-items: center; gap: 8px; color: var(--muted); background: var(--card); border: 1px solid var(--border-c); border-radius: 10px; padding: 3px 8px; }
      .rs-custom .rs-date { border: 1px solid var(--border-c); }
      .rs-actions { display: flex; gap: 8px; margin-left: auto; }
      /* "Refresh · updated X ago" — the figures on this page come from a saved snapshot, so
         the page has to say how old they are (owner-panel sweep 2026-08-04). Hidden in print;
         the printed sheet carries the same age in its masthead instead. */
      .rs-fresh { display: inline-flex; align-items: center; gap: 8px; }
      .rs-fresh-t { font-size: 10.5px; color: var(--muted); font-weight: 600; white-space: nowrap; }
      @media print { .rs-fresh { display: none !important; } }
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
      /* --accent-on, not #fff: the owner console's accent is a LIGHT emerald — white on it
         measures 2.54:1 in the dark skin and 3.77:1 in the light one, so you cannot tell which
         option is selected. .rs-tc-toggle was moved to this token on 2026-08-05 and its
         siblings were missed (T5 sweep, 2026-08-06). */
      .rs-ov-toggle button.on { background: var(--accent); color: var(--accent-on, #fff); }
      .rs-ov-chart { margin-top: 8px; }
      .rs-ov-empty { height: 210px; display: grid; place-items: center; color: var(--muted); font-size: 13px; }
      /* Shared toggle-chart (bar/line) header — used by the hub + every time-based report. */
      .rs-tc-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 6px; }
      .rs-tc-title { font-size: 12px; font-weight: 700; color: var(--muted); }
      .rs-tc-toggle { display: inline-flex; background: var(--muted2); border-radius: 999px; padding: 3px; gap: 3px; }
      .rs-tc-toggle button { border: none; background: none; color: var(--muted); font: inherit; font-size: 11.5px; font-weight: 700; padding: 4px 14px; border-radius: 999px; cursor: pointer; transition: background .18s ease, color .18s ease; }
      .rs-tc-toggle button:hover { color: var(--text); }
      /* --accent-on, not #fff: the owner console's accent is a LIGHT emerald and white on it
         measured 2.54:1 on the Bar/Line toggle (T11 re-run, 2026-08-05). Same token the range
         chips now use; consoles with a dark accent still get white from its default. */
      .rs-tc-toggle button.on { background: var(--accent); color: var(--accent-on, #fff); }
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

      /* ── Sub-tabs (the merge: one report, several views) ────────────────── */
      .rs-subtabs { display: flex; gap: 4px; flex-wrap: wrap; margin: 0 0 16px; border-bottom: 1px solid var(--border-c); padding-bottom: 2px; }
      .rs-subtab { border: none; background: none; color: var(--muted); font: inherit; font-size: 13px; font-weight: 700; padding: 9px 14px; border-radius: 8px 8px 0 0; cursor: pointer; display: inline-flex; align-items: center; gap: 7px; position: relative; transition: color .15s ease, background .15s ease; }
      .rs-subtab i { font-size: 12px; opacity: .85; }
      .rs-subtab:hover { color: var(--text); background: var(--muted2); }
      .rs-subtab.on { color: var(--accent); }
      .rs-subtab.on::after { content: ""; position: absolute; left: 10px; right: 10px; bottom: -3px; height: 2.5px; border-radius: 2px; background: var(--accent); }
      /* A view the chosen period cannot produce (Day of week on Today) is shown as unavailable
         rather than as a tab that only ever says "pick something else" (T5 sweep, 2026-08-06).
         Its title attribute carries the reason. */
      .rs-subtab.off { opacity: .42; cursor: not-allowed; }
      .rs-subtab.off:hover { color: var(--muted); background: none; }
      @media print { .rs-subtabs { display: none !important; } }

      /* ── Detail overlay (discount/cancellation drill from Payments) ──────── */
      .rs-ovl { position: fixed; inset: 0; z-index: 120; background: color-mix(in srgb, #000 55%, transparent); backdrop-filter: blur(3px); display: flex; align-items: flex-start; justify-content: center; padding: 40px 16px; overflow-y: auto; animation: rs-fade .18s ease; }
      .rs-ovl-card { width: min(920px, 100%); background: var(--card); border: 1px solid var(--border-c); border-radius: 16px; box-shadow: 0 30px 80px -20px rgba(0,0,0,.6); overflow: hidden; margin: auto 0; }
      .rs-ovl-h { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 15px 18px; border-bottom: 1px solid var(--border-c); position: sticky; top: 0; background: var(--card); }
      .rs-ovl-h b { font-size: 15px; font-weight: 800; letter-spacing: -0.01em; }
      .rs-ovl-x { width: 32px; height: 32px; border-radius: 8px; border: 1px solid var(--border-c); background: var(--muted2); color: var(--text); cursor: pointer; font-size: 14px; }
      .rs-ovl-x:hover { background: var(--card); }
      .rs-ovl-b { padding: 18px; }
      @media (prefers-reduced-motion: reduce) { .rs-ovl { animation: none; } }
      /* Ctrl+P with the overlay open must print the REPORT, not a black wash + card. */
      @media print { .rs-ovl { display: none !important; } }

      /* ── Per-restaurant brief (all-restaurants hub) ─────────────────────── */
      .rs-brief { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 12px; margin: 4px 0 8px; }
      .rs-brief-card { text-align: left; border: 1px solid var(--border-c); border-radius: 12px; background: var(--card); padding: 13px 15px; cursor: pointer; transition: transform .16s ease, border-color .16s ease, box-shadow .16s ease; }
      .rs-brief-card:hover { transform: translateY(-2px); border-color: color-mix(in srgb, var(--accent) 45%, var(--border-c)); box-shadow: 0 10px 24px -14px color-mix(in srgb, var(--accent) 50%, transparent); }
      .rs-brief-top { display: flex; align-items: center; gap: 8px; }
      .rs-brief-top .sw { width: 10px; height: 10px; border-radius: 3px; flex-shrink: 0; }
      .rs-brief-top .nm { font-size: 13px; font-weight: 700; letter-spacing: -0.01em; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .rs-brief-top .rk { margin-left: auto; font-size: 10.5px; font-weight: 800; color: var(--muted); }
      .rs-brief-v { font-size: 20px; font-weight: 800; font-variant-numeric: tabular-nums; margin: 8px 0 2px; }
      .rs-brief-sub { font-size: 11px; color: var(--muted); }
      .rs-brief-bar { height: 5px; border-radius: 999px; background: var(--muted2); overflow: hidden; margin-top: 9px; }
      .rs-brief-bar > span { display: block; height: 100%; border-radius: 999px; background: var(--accent); }

      /* ── Report view: title, KPI band, panels ──────────────────────────── */
      .rs-report { animation: rs-fade .22s ease; }
      @keyframes rs-fade { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
      @media (prefers-reduced-motion: reduce) { .rs-report { animation: none; } }
      .rs-rtitle { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; }
      .rs-rtitle .cic { width: 42px; height: 42px; flex-shrink: 0; border-radius: 12px; display: grid; place-items: center; font-size: 17px; background: color-mix(in srgb, var(--tone-c) 15%, transparent); color: var(--tone-c); }
      .rs-rtitle h2 { font-size: 18px; font-weight: 800; margin: 0; letter-spacing: -0.02em; }
      .rs-rtitle .scope { font-size: 12px; color: var(--muted); margin-top: 2px; }

      /* rs-mut: the "quieter second half" of a table cell / label. Used by several report
         bodies since the Studio landed but never actually styled, so it rendered at full
         strength (found in the 2026-07-30 staff-pay sweep). */
      .rs-mut { color: var(--muted); font-weight: 500; }
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

      /* ── A THUMB TARGET ON A PHONE (T11 sweep, 2026-08-18) ─────────────────────────────────
         Measured on a Samsung A35 (360x780): Refresh / Report / Export sat at 34px and the day
         sheet's Today / Yesterday at 27px. Every tap I drove did land, so nothing was BROKEN —
         but they are the controls he uses most one-handed, and 44px is the size a thumb expects.
         Raised only under 640px, so the desktop console is pixel-for-pixel unchanged; the extra
         height comes from min-height, not padding, so nothing re-flows sideways. */
      @media (max-width: 640px) {
        .rs-btn { min-height: 44px; padding: 0 15px; }
        .rs-seg { padding: 4px; }
        .rs-seg button { min-height: 44px; padding: 6px 14px; }
        .rs-date { min-height: 44px; }
        /* The hub's Report button and the Export menu are the shared .adm-btn, which the whole
           admin console uses — so raise it only INSIDE the Reports actions, never globally. */
        .rs-actions .adm-btn, .rs-actions button { min-height: 44px; }

        /* ── …AND THE CONTROLS THAT FIX MISSED (T11 sweep #7, 2026-08-27) ───────────────────
           The block above raised the control STRIP and stopped there, so on the same A35
           screen the row of buttons at the top was 44px while everything used to MOVE
           between views was still small. Re-measured, every screen, both skins:
             · "← All reports"      23px — the only way back to the hub on the page
             · the sub-tab strip    34px — Revenue / Average bill / How many orders,
                                           Items / Categories / Which dishes earn,
                                           By hour / Times of day / Day of week, Pay / Performance
             · "Full report →"      22px — the day sheet's Settlement drill
             · the overlay ✕        32px — closes the Discounts / Cancellations sheet
           Nothing was BROKEN here either (the taps land — measured 2026-08-18), so this is
           consistency, not a repair: one screen should not offer two sizes of the same
           gesture. Navigation only. The in-chart Bar/Line pill and the Items By revenue /
           By quantity pill are deliberately NOT raised — they sit inside a panel header, and
           making them 44px would add ~26px to every chart card on a 780px-tall phone. That is
           a look decision, so it goes to the owner rather than into this block.
           min-height again, never padding, so nothing re-flows sideways; >640px untouched. */
        .rs-back { min-height: 44px; padding: 4px 2px; }
        .rs-subtab { min-height: 44px; }
        .rs-drill { min-height: 44px; padding: 3px 12px; }
        .rs-ovl-x { width: 44px; height: 44px; }

        /* ── …AND THE TWO PILLS INSIDE THE PANEL HEADERS (owner, 2026-08-30 — item 7) ────────
           These were deliberately left out of the block above and put to him as a choice,
           because they sit INSIDE a card header and 44px there makes every chart card taller
           on a 780px phone. He said do it. Measured before: the Bar / Line pill 22px on every
           chart card, and Items → "By revenue / By quantity" 38px — the last two things on
           Reports smaller than a thumb.
           min-height only, and the pill's own padding is untouched, so the desktop console
           is again pixel-for-pixel unchanged. .rs-metric is declared in DishReports.tsx and
           InventoryReports.tsx rather than here; this sets a property NEITHER of them sets,
           so there is nothing for the cascade to fight over. */
        .rs-tc-toggle button, .rs-metric button, .rs-ov-toggle button { min-height: 44px; }
      }

      /* The masthead and closing note are invisible on screen; they only paint in @media print. */
      .rs-printhead, .rs-printfoot { display: none; }

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

        /* ── The print-only document masthead ──────────────────────────────────────────
           Deliberately mirrors components/owner/reports/sectionExport.tsx → sectionHtml(): the
           SAME brand line, the same "Generated"/"Figures as of" pair, the same teal rule and the
           same closing note. There are two printing paths — Ctrl+P renders THIS page through the
           rules below, while Export → Print opens a freshly-built document — and until now they
           produced two visibly different sheets for one report (T5 sweep, 2026-08-06). They are
           still two code paths; they are no longer two documents. If you change one masthead,
           change the other. */
        .rs-printhead { display: block !important; margin: 0 0 16px; padding: 0 0 10px; border-bottom: 3px solid #0f766e; color: #10231c; break-inside: avoid; break-after: avoid; }
        .rs-ph-row { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
        .rs-ph-brand { font-size: 13px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; color: #0f766e; }
        .rs-ph-gen { font-size: 10.5px; color: #6b7f78; font-variant-numeric: tabular-nums; }
        .rs-ph-title { font-size: 22px; font-weight: 800; letter-spacing: -0.02em; margin: 14px 0 2px; color: #10231c; }
        .rs-ph-scope { font-size: 13px; color: #4b615a; font-weight: 600; }
        .rs-ph-asof { font-size: 10.5px; color: #6b7f78; margin-top: 3px; font-variant-numeric: tabular-nums; }
        /* the same closing note the built document carries */
        .rs-printfoot { display: block !important; margin-top: 26px; font-size: 10px; color: #6b7f78; border-top: 1px solid #d9e5e1; padding-top: 8px; }

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
