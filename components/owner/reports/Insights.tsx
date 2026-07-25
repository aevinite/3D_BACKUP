"use client";
// Owner · Reports Studio — shared INSIGHT widgets (2026-07-25).
//
// Small, reusable "what's winning / what needs attention" pieces that sit between
// the KPI band and the detail table in a report. Presentational only — every number
// is derived from the payload rows the parent already fetched (no new queries). CSS
// is scoped under `.ri-` inside a `<style jsx global>` so it never touches the shared
// kit styles or other reports. All of it renders inside `.rs-root`, so it inherits the
// owner THEME green + the tone-* variables (`--tone-c`) from the kit.
import { inr } from "@/components/admin/shared";
import { nfmt } from "@/components/owner/reports/kit";

export type Pt = { label: string; value: number };

// Derive best / worst / average from a numeric series, ignoring empty buckets so a
// closed day never counts as the "quietest" one and drags the average to zero.
export function seriesStats(series: Pt[]) {
  const active = series.filter((s) => Number.isFinite(s.value) && s.value > 0);
  const total = active.reduce((a, s) => a + s.value, 0);
  const best = active.length ? active.reduce((a, b) => (b.value > a.value ? b : a)) : null;
  const worst = active.length ? active.reduce((a, b) => (b.value < a.value ? b : a)) : null;
  const avg = active.length ? total / active.length : 0;
  // First-half vs second-half average → a plain "trending up / down / steady".
  const half = Math.floor(active.length / 2);
  const firstAvg = half ? active.slice(0, half).reduce((a, s) => a + s.value, 0) / half : 0;
  const lastAvg = active.length - half ? active.slice(half).reduce((a, s) => a + s.value, 0) / (active.length - half) : 0;
  const trendPct = firstAvg ? ((lastAvg - firstAvg) / firstAvg) * 100 : 0;
  return { active, total, best, worst, avg, count: active.length, trendPct };
}

function TrendPill({ pct, invert = false }: { pct: number; invert?: boolean }) {
  const steady = Math.abs(pct) < 5;
  const up = pct > 0;
  const good = invert ? !up : up;
  const tone = steady ? "flat" : good ? "good" : "bad";
  const icon = steady ? "fa-arrows-left-right" : up ? "fa-arrow-trend-up" : "fa-arrow-trend-down";
  const word = steady ? "Holding steady" : up ? "Trending up" : "Trending down";
  return (
    <span className={`ri-trend ${tone}`}>
      <i className={`fas ${icon}`} aria-hidden /> {word}
      {!steady && <b> · {Math.abs(Math.round(pct))}%</b>}
    </span>
  );
}

// Best / quietest / typical bucket, each with a share-of-period bar, plus a
// concentration footnote ("what's driving it"). `noun` names the metric for humans.
export function BestWorst({
  series, money = true, unit = "day", noun = "revenue",
  invertTrend = false, title = "Best & quietest " + unit,
}: {
  series: Pt[]; money?: boolean; unit?: string; noun?: string; invertTrend?: boolean; title?: string;
}) {
  const { total, best, worst, avg, count, trendPct } = seriesStats(series);
  if (!best || !worst) return null;
  const fmt = (n: number) => (money ? inr(n) : nfmt(Math.round(n)));
  const share = (n: number) => (total ? (n / total) * 100 : 0);
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const sorted = [...series].filter((s) => s.value > 0).sort((a, b) => b.value - a.value);
  const top3 = sorted.slice(0, 3).reduce((a, s) => a + s.value, 0);
  const same = best.label === worst.label;

  const cards: { tone: string; icon: string; k: string; pt: Pt }[] = [
    { tone: "good", icon: "fa-crown", k: `Best ${unit}`, pt: best },
    { tone: "warn", icon: "fa-arrow-down-wide-short", k: `Quietest ${unit}`, pt: worst },
    { tone: "info", icon: "fa-scale-balanced", k: `Typical ${unit}`, pt: { label: `avg of ${count} active`, value: avg } },
  ];

  return (
    <section className="rs-panel ri-wrap">
      <header className="rs-panel-h">
        <div><b>{title}</b><span className="rs-panel-hint"> · what&apos;s carrying the {noun}</span></div>
        <TrendPill pct={trendPct} invert={invertTrend} />
      </header>
      <div className="ri-body">
        <div className="ri-cards">
          {cards.map((c) => {
            const sh = share(c.pt.value);
            return (
              <div key={c.k} className={`ri-card tone-${c.tone}`}>
                <div className="ri-k"><i className={`fas ${c.icon}`} aria-hidden /> {c.k}</div>
                <div className="ri-when">{cap(c.pt.label)}</div>
                <div className="ri-v">{fmt(c.pt.value)}</div>
                <div className="ri-bar"><span style={{ width: `${Math.min(100, Math.max(3, sh))}%` }} /></div>
                <div className="ri-share">{Math.round(sh)}% of the period</div>
              </div>
            );
          })}
        </div>
        <p className="ri-foot">
          {same
            ? <>Only one {unit} carried {noun} this period.</>
            : <>Your best {unit} (<b>{cap(best.label)}</b>) brought <b>{Math.round(share(best.value))}%</b> of the period&apos;s {noun}
              {count >= 3 && <> · the top 3 {unit}s made <b>{Math.round(total ? (top3 / total) * 100 : 0)}%</b></>}
              {worst.value > 0 && <> · the best {unit} did <b>{(worst.value ? best.value / worst.value : 0).toFixed(1)}×</b> the quietest</>}.</>}
        </p>
      </div>
      <RiStyles />
    </section>
  );
}

// A single horizontal proportion bar (e.g. paid vs cancelled) with a two-item legend.
export function SplitBar({
  title, segments,
}: {
  title?: string; segments: { label: string; value: number; tone: "good" | "bad" | "warn" | "info" | "accent"; note?: string }[];
}) {
  const total = segments.reduce((a, s) => a + s.value, 0) || 1;
  const TONE: Record<string, string> = {
    good: "var(--adm-ok)", bad: "var(--adm-danger)", warn: "var(--adm-warn)", info: "#5b8def", accent: "var(--accent)",
  };
  return (
    <section className="rs-panel ri-wrap">
      {title && <header className="rs-panel-h"><div><b>{title}</b></div></header>}
      <div className="ri-body">
        <div className="ri-split">
          {segments.map((s) => {
            const pct = (s.value / total) * 100;
            return pct > 0 ? <span key={s.label} title={`${s.label}: ${nfmt(s.value)}`} style={{ width: `${pct}%`, background: TONE[s.tone] }} /> : null;
          })}
        </div>
        <div className="ri-legend">
          {segments.map((s) => (
            <div key={s.label} className="ri-leg">
              <span className="dot" style={{ background: TONE[s.tone] }} />
              <span className="lg-k">{s.label}</span>
              <span className="lg-v">{nfmt(s.value)}<span className="lg-p"> · {Math.round((s.value / total) * 100)}%</span></span>
              {s.note && <span className="lg-note">{s.note}</span>}
            </div>
          ))}
        </div>
      </div>
      <RiStyles />
    </section>
  );
}

// Scoped styles. Rendered by every widget; identical <style jsx global> blocks dedupe.
function RiStyles() {
  return (
    <style jsx global>{`
      .rs-root .ri-wrap { margin-top: 2px; }
      .rs-root .ri-body { padding: 16px; }
      .rs-root .ri-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; }
      .rs-root .ri-card { border: 1px solid var(--border-c); border-radius: 12px; padding: 13px 14px; background: linear-gradient(135deg, color-mix(in srgb, var(--tone-c) 9%, var(--card)), var(--card) 72%); position: relative; overflow: hidden; }
      .rs-root .ri-card::before { content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 3px; background: var(--tone-c); opacity: .85; }
      .rs-root .ri-k { font-size: 10.5px; font-weight: 800; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); display: inline-flex; align-items: center; gap: 6px; }
      .rs-root .ri-k i { color: var(--tone-c); font-size: 11px; }
      .rs-root .ri-when { font-size: 12.5px; font-weight: 700; color: var(--text); margin-top: 6px; }
      .rs-root .ri-v { font-size: 22px; font-weight: 800; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; margin-top: 2px; line-height: 1.1; }
      .rs-root .ri-bar { height: 6px; border-radius: 999px; background: var(--muted2); overflow: hidden; margin: 9px 0 5px; }
      .rs-root .ri-bar > span { display: block; height: 100%; border-radius: 999px; background: var(--tone-c); }
      .rs-root .ri-share { font-size: 11px; color: var(--muted); font-weight: 600; font-variant-numeric: tabular-nums; }
      .rs-root .ri-foot { font-size: 12px; color: var(--muted); margin: 13px 2px 0; line-height: 1.5; }
      .rs-root .ri-foot b { color: var(--text); font-weight: 800; font-variant-numeric: tabular-nums; }

      .rs-root .ri-trend { display: inline-flex; align-items: center; gap: 5px; font-size: 11.5px; font-weight: 800; padding: 3px 10px; border-radius: 999px; white-space: nowrap; font-variant-numeric: tabular-nums; }
      .rs-root .ri-trend i { font-size: 10px; }
      .rs-root .ri-trend.good { color: var(--adm-ok); background: color-mix(in srgb, var(--adm-ok) 15%, transparent); }
      .rs-root .ri-trend.bad  { color: var(--adm-danger); background: color-mix(in srgb, var(--adm-danger) 15%, transparent); }
      .rs-root .ri-trend.flat { color: var(--muted); background: var(--muted2); }

      .rs-root .ri-split { display: flex; height: 14px; border-radius: 999px; overflow: hidden; background: var(--muted2); }
      .rs-root .ri-split > span { display: block; height: 100%; transition: width .3s ease; }
      .rs-root .ri-legend { display: flex; flex-wrap: wrap; gap: 16px; margin-top: 13px; }
      .rs-root .ri-leg { display: flex; align-items: center; gap: 7px; font-size: 12.5px; }
      .rs-root .ri-leg .dot { width: 11px; height: 11px; border-radius: 4px; flex-shrink: 0; }
      .rs-root .ri-leg .lg-k { font-weight: 700; color: var(--text); }
      .rs-root .ri-leg .lg-v { font-weight: 800; font-variant-numeric: tabular-nums; }
      .rs-root .ri-leg .lg-p { color: var(--muted); font-weight: 700; }
      .rs-root .ri-leg .lg-note { font-size: 11px; color: var(--muted); }

      @media print {
        .rs-root .ri-card, .rs-root .ri-wrap { border: 1px solid #ccc !important; background: #fff !important; break-inside: avoid; }
      }
    `}</style>
  );
}
