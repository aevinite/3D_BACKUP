"use client";
import Link from "next/link";
import { useId, useState } from "react";

/**
 * ── THE DOCKET (owner, 2026-10-04 — he chose this one from five) ─────────────────────────────
 * The sheet that opens when he presses a dashboard tile. Two instructions shaped it:
 *
 *   "it's completely shit … make five … show me all five"   → five directions were built and
 *                                                              shown on a preview; this won.
 *   "can't you make it big wider? … this is like kitchen bill size … for phone you can keep the
 *    portrait, but for the other thing"                      → WIDE on a screen, portrait on a
 *                                                              phone. The old sheet was 430px
 *                                                              on a 1,400px dashboard.
 *
 * The language is the till slip he already reads every night — monospace figures, dotted
 * leaders, a double-ruled total — but laid out landscape like a kitchen docket: the figures on
 * the left where the eye starts, the charts on the right, the caveat along the bottom. Below
 * 860px it folds to one column, which is the only place the tall narrow shape belongs.
 *
 * Charts are hand-rolled SVG on data the page ALREADY has (lib/ownerCache's payload). No new
 * fetch, no new dependency — opening a tile must not cost a read.
 */

export type DocketRow = [label: string, value: string, hint?: string, total?: boolean];
export type DocketPoint = { x: string; v: number; hint?: string };
export type DocketStep = { k: string; s: string; v: number; total?: boolean };
export type DocketChart =
  | { kind: "area"; pts: DocketPoint[] }
  // `compare`: the bars are restaurants side by side, not days in a row — a comparison, so
  // one restaurant trading beside two at ₹0 is a fair picture and the trend gate below is off.
  | { kind: "bars"; pts: DocketPoint[]; compare?: boolean }
  | { kind: "waterfall"; steps: DocketStep[] };
export type DocketBar = { k: string; v: number; t: string; c?: string };

const INK = "#1b1a16", PAPER = "#fffdf7", RULE = "#cdc6b4", MUT = "#7a7465";
const GREEN = "#0d9b63", SOFT = "#cfe6da", RED = "#e8a0a0";

// ── A TREND NEEDS TWO DAYS THAT HAPPENED (the rule components/owner/Charts.tsx keeps) ──────────
// Charts.tsx: "< 2 points with real activity → DON'T draw a chart". A zero bucket is not a data
// point. This sheet was built on 2026-10-04 with its own hand-rolled SVG and only asked "is the
// array empty?", so a restaurant with one day of trade in the period got a single full-width bar
// on "Orders a day", and a line lying flat on the floor with one spike — the shape that reads as
// broken, which is why the rule exists (sweep #10 T39 item 2; verify:owner-reports names it).
const MIN_POINTS = 2;
const populated = (pts: DocketPoint[]) => pts.filter((p) => (Number(p.v) || 0) > 0).length;

/** smooth area with a soft fill — the shape of a period */
function Area({ pts, h = 118 }: { pts: DocketPoint[]; h?: number }) {
  const gid = useId().replace(/:/g, "");
  const { on, off, line } = useReadout("Hover the line for a day");
  if (pts.length < 2 || populated(pts) < MIN_POINTS) return <Empty />;
  const w = 600, max = Math.max(...pts.map((p) => p.v), 1);
  const X = (i: number) => i * (w / (pts.length - 1)), Y = (v: number) => h - 6 - (v / max) * (h - 18);
  let d = "", a = "";
  pts.forEach((p, i) => {
    const x = X(i), y = Y(p.v);
    if (!i) { d = `M${x},${y}`; a = `M${x},${h}L${x},${y}`; return; }
    const px = X(i - 1), py = Y(pts[i - 1].v), cx = (px + x) / 2;
    d += `C${cx},${py} ${cx},${y} ${x},${y}`; a += `C${cx},${py} ${cx},${y} ${x},${y}`;
  });
  a += `L${X(pts.length - 1)},${h}Z`;
  const svg = (
    <svg viewBox={`0 0 ${w} ${h + 16}`} preserveAspectRatio="none" className="chart" role="img"
      aria-label={`${pts.length} points, highest ${Math.round(max)}`}>
      <defs><linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor={GREEN} stopOpacity={0.26} /><stop offset="100%" stopColor={GREEN} stopOpacity={0} />
      </linearGradient></defs>
      {[0, 1, 2, 3].map((g) => <line key={g} x1={0} x2={w} y1={6 + g * ((h - 12) / 3)} y2={6 + g * ((h - 12) / 3)}
        stroke="#e8e2d2" strokeWidth={1} vectorEffect="non-scaling-stroke" />)}
      <path d={a} fill={`url(#${gid})`} />
      <path d={d} fill="none" stroke={GREEN} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      {pts.map((p, i) => <rect key={i} x={X(i) - w / pts.length / 2} y={0} width={w / pts.length} height={h}
        fill="transparent" {...on(p.hint || `${p.x} · ${Math.round(p.v)}`)}>
        <title>{p.hint || `${p.x} · ${Math.round(p.v)}`}</title></rect>)}
      {[0, Math.floor(pts.length / 2), pts.length - 1].map((i, k) =>
        <text key={i} x={X(i)} y={h + 12} textAnchor={k === 0 ? "start" : k === 2 ? "end" : "middle"}>{pts[i].x}</text>)}
    </svg>
  );
  return <div {...off}>{svg}{line}</div>;
}

function Bars({ pts, compare, h = 118 }: { pts: DocketPoint[]; compare?: boolean; h?: number }) {
  const { on, off, line } = useReadout("Hover a bar for its day");
  if (!pts.length || (!compare && populated(pts) < MIN_POINTS)) return <Empty />;
  const w = 600, max = Math.max(...pts.map((p) => p.v), 1), bw = w / pts.length;
  const svg = (
    <svg viewBox={`0 0 ${w} ${h + 16}`} preserveAspectRatio="none" className="chart" role="img"
      aria-label={`${pts.length} bars, highest ${Math.round(max)}`}>
      {pts.map((p, i) => {
        const bh = Math.max(p.v > 0 ? 3 : 0, (p.v / max) * (h - 8));
        const t = p.hint || `${p.x} · ${Math.round(p.v)}`;
        return (
          <g key={i} {...on(t)}>
            {/* a full-height invisible target, so a short bar is as easy to hover as a tall one */}
            <rect x={i * bw} y={0} width={bw} height={h} fill="transparent" />
            <rect x={i * bw + bw * 0.17} y={h - bh} width={bw * 0.66} height={bh}
              rx={Math.min(4, bw * 0.3)} fill={p.v ? GREEN : "#efe9da"} />
            <title>{t}</title>
          </g>
        );
      })}
      {[0, pts.length - 1].map((i, k) =>
        <text key={i} x={i * bw + bw / 2} y={h + 12} textAnchor={k ? "end" : "start"}>{pts[i].x}</text>)}
    </svg>
  );
  return <div {...off}>{svg}{line}</div>;
}

/** the honest picture of a figure that is a subtraction */
function Waterfall({ steps, h = 136 }: { steps: DocketStep[]; h?: number }) {
  const { on, off, line } = useReadout("Hover a step to see what it took out");
  if (!steps.length) return <Empty />;
  const w = 600, bw = w / steps.length;
  let run = 0; const tops: number[] = [];
  steps.forEach((s) => { if (s.total) tops.push(s.v); else { run += s.v; tops.push(run); } });
  const max = Math.max(...tops.map(Math.abs), ...steps.map((s) => Math.abs(s.v)), 1);
  run = 0;
  const out: React.ReactNode[] = [];
  steps.forEach((st, i) => {
    const from = st.total ? 0 : run, to = st.total ? st.v : run + st.v;
    const y0 = h - (Math.max(from, 0) / max) * (h - 10), y1 = h - (Math.max(to, 0) / max) * (h - 10);
    out.push(
      <g key={`b${i}`} {...on(st.k)}>
        {/* full-height target: "less food binned" is a 4px sliver and must still be hoverable */}
        <rect x={i * bw} y={0} width={bw} height={h} fill="transparent" />
        <rect x={i * bw + bw * 0.22} y={Math.min(y0, y1)} width={bw * 0.56}
          height={Math.max(4, Math.abs(y1 - y0))} rx={4} fill={st.total ? GREEN : st.v < 0 ? RED : SOFT} />
        <title>{st.k}</title>
      </g>);
    if (!st.total && i < steps.length - 1)
      out.push(<line key={`l${i}`} x1={i * bw + bw * 0.78} x2={(i + 1) * bw + bw * 0.22} y1={y1} y2={y1}
        stroke={RULE} strokeWidth={1} strokeDasharray="2 2" vectorEffect="non-scaling-stroke" />);
    out.push(<text key={`t${i}`} x={i * bw + bw / 2} y={h + 12} textAnchor="middle">{st.s}</text>);
    if (!st.total) run = to;
  });
  return (
    <div {...off}>
      <svg viewBox={`0 0 ${w} ${h + 16}`} preserveAspectRatio="none" className="chart" role="img">{out}</svg>
      {line}
    </div>
  );
}

const Empty = () => <p className="empty">Not enough in this period to draw.</p>;

/**
 * ── HOVER TELLS YOU, AND IT TELLS YOU AT ONCE (owner, 2026-10-04) ───────────────────────────
 * *"if you hover over any box it will tell how much percent it is … you don't have to judge the
 * colour"* and *"after three second if you stay there it should tell what it is."*
 *
 * The charts DID carry an SVG <title> on every hit area, which is the browser's own tooltip —
 * it takes about a second to appear, it is an unstyled grey OS bubble, it never shows on a
 * touchscreen, and near the right edge of a phone it is clipped. So it may as well not exist,
 * which is why he asked for it.
 *
 * A READOUT LINE instead: one line under the chart that changes the instant the pointer moves
 * over a bar, a day or a step. No delay to wait out, nothing to clip, it works identically on a
 * phone (tap a bar), and it is always visible so you know the information is there to be had.
 * The <title>s stay for screen readers and for a right-click-save of the SVG.
 */
function useReadout(idle: string) {
  const [tip, setTip] = useState<string | null>(null);
  const on = (t: string) => ({
    onMouseEnter: () => setTip(t), onMouseMove: () => setTip(t),
    onTouchStart: () => setTip(t), onFocus: () => setTip(t),
  });
  const off = { onMouseLeave: () => setTip(null), onBlur: () => setTip(null) };
  const line = <p className={`rd${tip ? " live" : ""}`} aria-live="polite">{tip ?? idle}</p>;
  return { on, off, line };
}

/** Enough clearly-different hues for a split, readable on cream, and never the only signal —
 *  every row below the bar carries its own figure. */
const SPLIT = ["#1f7a5a", "#2f6f9f", "#9c7b2e", "#b4553f", "#6f63a0", "#5a7d4f", "#3f7f86", "#8a5668"];

/**
 * ── THE SHARE BAR (owner picked it from five, 2026-10-04) ───────────────────────────────────
 * His words on what was here before: *"UPI is full, the cash is half full — how will I be able
 * to identify it? It doesn't look good."* The old bars were scaled to the BIGGEST line, so the
 * top one was always a full bar and every other was read against it. "Cash is half of UPI" is
 * the only thing that said; it could not answer "what part of my money is cash?".
 *
 * One bar IS the whole. Each segment is its true share of the total, so the picture answers the
 * question directly. No pie and no donut — he ruled those out because a circle gets clipped on a
 * phone, and this shape is the same shape at 390px as at 1600.
 */
function ShareBar({ items: raw }: { items: DocketBar[] }) {
  const total = raw.reduce((a, b) => a + Math.max(0, b.v), 0);
  const { on, off, line } = useReadout("Hover a slice for its share");
  // Biggest first, always. "Earned where" arrives in the overview's own order, so the bar read
  // 71% · 10% · 19% left to right — a ranking that is not ranked. Sorting here fixes every
  // caller at once and costs nothing: the legend is built from the same sorted list.
  const items = [...raw].sort((a, b) => b.v - a.v);
  if (!items.length || total <= 0) return <Empty />;
  const share = (v: number) => (Math.max(0, v) / total) * 100;
  const pct = (v: number) => { const p = share(v); return `${p < 10 ? p.toFixed(1) : Math.round(p)}%`; };
  return (
    <div>
      <div className="shb" {...off}>
        {items.map((m, i) => {
          const w = share(m.v), c = m.c || SPLIT[i % SPLIT.length];
          return (
            // `title` as an ATTRIBUTE, never a <title> CHILD. The charts use <title> children
            // because they are inside an <svg>, where that is the tooltip element; this slice is
            // an HTML <i>, and an HTML <title> is the DOCUMENT title — it rewrote the browser
            // tab to "Website · 2.0% · ₹16,044" the moment the sheet opened.
            <i key={m.k} style={{ width: `${w.toFixed(2)}%`, background: c }}
              title={`${m.k} · ${pct(m.v)} · ${m.t}`}
              {...on(`${m.k} · ${pct(m.v)} · ${m.t}`)}>
              {/* a number only goes inside a slice wide enough to hold it; the rest read theirs
                  off the list below, which is why that list carries every figure */}
              {w >= 11 ? <span>{Math.round(w)}%</span> : null}
            </i>
          );
        })}
      </div>
      <div className="shl" {...off}>
        {items.map((m, i) => (
          <div className="shr" key={m.k} {...on(`${m.k} · ${pct(m.v)} · ${m.t}`)}>
            <em style={{ background: m.c || SPLIT[i % SPLIT.length] }} />
            <span className="k">{m.k}</span>
            <span className="p">{pct(m.v)}</span>
            <span className="v">{m.t}</span>
          </div>
        ))}
      </div>
      {line}
    </div>
  );
}

export default function TileDocket({
  title, sub, big, cap, rows, note, chart, chartTitle, side, sideTitle,
  auditHref, detailHref, detailOffNote, onClose,
}: {
  title: string; sub: string; big: string; cap: string;
  rows: DocketRow[]; note?: string;
  chart?: DocketChart; chartTitle?: string;
  side?: DocketBar[]; sideTitle?: string;
  auditHref?: string; detailHref?: string; detailOffNote?: string;
  onClose: () => void;
}) {
  return (
    <div className="tdk-wrap" role="dialog" aria-modal="true" aria-label={`${title} detail`}>
      <div className="tdk-back" onClick={onClose} aria-hidden="true" />
      <div className="tdk">
        <header>
          <b>{title}</b><i>{sub}</i>
          <span className="stamp" aria-hidden="true">NOT A BILL</span>
          <button className="x" onClick={onClose} aria-label="Close">✕</button>
        </header>

        <div className="body">
          <div className="lcol">
            <div className="big">{big}</div>
            <div className="cap">{cap}</div>
            {/* ── EVERY ROW IS THE SAME HEIGHT (owner, 2026-10-04) ──────────────────────────
                "One of the things doesn't have a bottom written something, but it should have
                that gap so that the gap looks even for all." Only some rows carry an
                explanatory line, so "Average per paid order" sat in a block a line shorter
                than its neighbours and the rhythm went ragged. When ANY row in a sheet has
                one, the ones that do not reserve the same line — so the gaps are identical
                down the column. When none has one, nothing is reserved and the sheet stays
                tight. */}
            <div className={`rows${rows.some((r) => r[2]) ? " hinted" : ""}`}>
              {rows.map(([l, v, hint, total]) => (
                <div className={`r${total ? " total" : ""}`} key={l}>
                  <div className="rline">
                    <span className="l">{l}</span>
                    <span className="dots" aria-hidden="true" />
                    <span className="v">{v}</span>
                  </div>
                  <small>{hint || " "}</small>
                </div>
              ))}
            </div>
          </div>

          <div className="rcol">
            {chart ? (
              <div>
                <div className="ttl">{chartTitle}</div>
                {chart.kind === "area" ? <Area pts={chart.pts} />
                  : chart.kind === "bars" ? <Bars pts={chart.pts} compare={chart.compare} />
                  : <Waterfall steps={chart.steps} />}
              </div>
            ) : null}
            {side && side.length ? (
              <div>
                <div className="ttl">{sideTitle}</div>
                <ShareBar items={side} />
              </div>
            ) : null}
          </div>
        </div>

        <footer>
          {note ? (
            <p className="note">
              {note}
              {auditHref ? <> <Link className="nlink" href={auditHref}>Open Audit &amp; logs →</Link></> : null}
            </p>
          ) : <span />}
          {/* HE ASKED FOR THIS BY NAME: "make sure to view in full detail button should be there
              … even though it's a big one". A wide sheet shows more, and showing more is not the
              same as being the whole report. */}
          {detailHref
            ? <Link className="full" href={detailHref}>See the full detail <span aria-hidden="true">→</span></Link>
            : <span className="full off">{detailOffNote || "Reports are switched off for this restaurant"}</span>}
        </footer>
      </div>

      <style jsx>{`
        .tdk-wrap{position:fixed;inset:0;z-index:95;display:grid;place-items:center;padding:20px}
        .tdk-back{position:absolute;inset:0;background:rgba(5,8,14,.6);backdrop-filter:blur(2px);
          animation:tdkfade .18s ease-out}
        .tdk{position:relative;width:min(980px,100%);max-height:min(90vh,780px);overflow-y:auto;
          background:${PAPER};color:${INK};border:1px solid #e8e0cd;border-radius:14px;
          box-shadow:0 30px 80px rgba(0,0,0,.42);
          font-family:ui-monospace,"SF Mono",Menlo,monospace;
          animation:tdkpop .2s cubic-bezier(.4,0,.2,1)}
        header{display:flex;align-items:center;gap:14px;flex-wrap:wrap;
          padding:16px 60px 16px 26px;border-bottom:1px dashed ${RULE};position:sticky;top:0;
          background:${PAPER};z-index:2}
        header b{font-size:12px;letter-spacing:.24em;text-transform:uppercase}
        header i{font-style:normal;font-size:11px;color:${MUT};letter-spacing:.04em}
        .stamp{margin-left:auto;border:1.5px solid #b4553f;color:#b4553f;transform:rotate(-2.5deg);
          padding:3px 9px;border-radius:3px;font-size:9.5px;letter-spacing:.14em;font-weight:700;white-space:nowrap}
        .x{position:absolute;top:13px;right:14px;width:30px;height:30px;border-radius:8px;
          border:1px solid #e0d8c4;background:#fff;color:${MUT};cursor:pointer;font-size:13px}
        .x:active{transform:scale(.94)}

        .body{display:grid;grid-template-columns:minmax(0,1.3fr) minmax(0,1fr)}
        .lcol{padding:24px 26px;border-right:1px dashed ${RULE};min-width:0}
        .big{font-size:46px;font-weight:700;letter-spacing:-.035em;line-height:1;
          font-variant-numeric:tabular-nums}
        .cap{font-size:11px;color:${MUT};margin-top:8px;letter-spacing:.04em}
        .rows{margin-top:20px;font-size:12.5px}
        .r{padding:6px 0}
        .rline{display:flex;align-items:baseline;gap:6px}
        .r .l{white-space:nowrap}
        .r .dots{flex:1;border-bottom:1px dotted #bdb6a4;transform:translateY(-3px)}
        .r .v{font-weight:700;white-space:nowrap;font-variant-numeric:tabular-nums}
        /* A row with no explanation renders a blank one, so the gaps stay even — but only in a
           sheet where something DOES explain itself. Empty by default, reserved under .hinted. */
        .r small{display:none}
        .rows.hinted .r small{display:block;font-size:10px;color:#8a8373;padding-top:2px;
          white-space:normal;min-height:13px}
        .r.total{border-top:1px solid ${INK};border-bottom:3px double ${INK};margin-top:9px;
          padding:9px 0;font-size:14px}
        .rcol{padding:24px 26px;display:grid;align-content:start;gap:20px;min-width:0}
        .ttl{font-size:10.5px;letter-spacing:.16em;text-transform:uppercase;color:${MUT};margin-bottom:10px}

        footer{border-top:1px dashed ${RULE};padding:15px 26px 18px;display:flex;gap:18px;
          align-items:center;flex-wrap:wrap}
        .note{flex:1 1 320px;font-size:11px;line-height:1.7;color:#6f6959;margin:0}
        /* ── :global() IS NOT OPTIONAL ON A <Link> (2026-10-04) ──────────────────────────
           styled-jsx adds its scope class to the JSX elements it can SEE. A capitalised
           component — next/link here — is opaque to it, so the scope class never reaches the
           rendered <a> and a plain '.full' rule matches nothing. The button he asked for by
           name shipped as 171x16 of unstyled text, with no background and no padding, and the
           Audit link beside it the same; measured live on the deployed page. The retired popup
           knew this and used :global for exactly these two. Scoping '.tdk' and leaving the
           child global keeps the rule off every other screen. */
        /* 'color' carries !important because app/globals.css sets
           a, a:visited … to "color: inherit !important" for the guest menu's cards, and that
           beats any component rule. Without it the button renders as an ink-on-ink rectangle
           with the words invisible — which is how it shipped, and how the retired popup already
           knew to write it. */
        .tdk :global(.full){flex:0 0 auto;display:inline-flex;align-items:center;gap:7px;
          padding:11px 18px;border-radius:9px;background:${INK};color:${PAPER} !important;font-size:12.5px;
          font-weight:700;letter-spacing:.04em;text-decoration:none;min-height:44px;
          box-sizing:border-box;justify-content:center;
          transition:transform 120ms ease-out,opacity 140ms}
        .tdk :global(.full:hover){opacity:.9}
        .tdk :global(.full:active){transform:scale(.985)}
        .tdk :global(.full.off){background:none;color:${MUT} !important;border:1px dashed ${RULE};
          font-weight:500}

        /* ── PORTRAIT IS FOR A PHONE AND NOWHERE ELSE ───────────────────────────────────── */
        @media (max-width:860px){
          .tdk-wrap{padding:0;place-items:end stretch}
          .tdk{width:100%;max-height:92vh;border-radius:16px 16px 0 0;border-bottom:0}
          .body{grid-template-columns:1fr}
          .lcol{border-right:0;border-bottom:1px dashed ${RULE}}
          .big{font-size:38px}
          footer{flex-direction:column;align-items:stretch}
          .tdk :global(.full){width:100%}
        }
        @keyframes tdkfade{from{opacity:0}to{opacity:1}}
        @keyframes tdkpop{from{opacity:0;transform:translateY(10px) scale(.985)}to{opacity:1;transform:none}}
        @media (prefers-reduced-motion:reduce){
          .tdk,.tdk-back{animation:none}
          .x{transition:none}
          .tdk :global(.full){transition:none}
        }
      `}</style>
      {/* ── A SUB-COMPONENT'S MARKUP NEEDS THE GLOBAL BLOCK (2026-10-04) ────────────────
           styled-jsx stamps its scope class only on the JSX of THIS component. <Area/>,
           <Bars/>, <Waterfall/>, <ShareBar/> and <Empty/> are separate functions, so the
           class never reaches the <svg> or the bar they return and a scoped `.shb { … }`
           matches nothing — the share bar shipped as 15px of unstyled text the first time.
           Same trap as the <Link> above, one level up. Everything a sub-component renders is
           styled here, prefixed with .tdk so it cannot escape the sheet. */}
      <style jsx global>{`
        .tdk .chart{display:block;width:100%;overflow:visible}
        /* ── the share bar ─────────────────────────────────────────────────────────────── */
        .tdk .shb{display:flex;height:30px;border-radius:7px;overflow:hidden;background:#efe9da}
        .tdk .shb i{display:block;height:100%;position:relative;cursor:default;
          transition:filter 120ms ease-out}
        .tdk .shb i:hover{filter:brightness(1.12)}
        .tdk .shb i span{position:absolute;inset:0;display:grid;place-items:center;color:#fff;
          font:700 10px/1 ui-monospace,"SF Mono",Menlo,monospace}
        /* ONE COLUMN. Two fitted the payment names and then truncated "Saffron Street 19%
           ₹49,78,218" at the card's edge — the right column is ~425px, and a restaurant name
           plus a share plus a lakh figure does not go in half of that. A list that cuts off the
           money is worse than a list one row longer. */
        .tdk .shl{margin-top:13px;display:grid;grid-template-columns:1fr;gap:1px}
        .tdk .shr{display:flex;align-items:center;gap:7px;font-size:11px;padding:3px 0;
          cursor:default;border-radius:4px}
        .tdk .shr:hover{background:#f6f1e3}
        .tdk .shr em{width:8px;height:8px;border-radius:2.5px;flex:none}
        .tdk .shr .k{flex:1;color:${MUT};overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .tdk .shr .p{font-weight:700;font-variant-numeric:tabular-nums}
        .tdk .shr .v{font-weight:700;font-variant-numeric:tabular-nums;white-space:nowrap;
          margin-left:auto}
        /* The readout: one line that answers the hover at once. See useReadout() for why this
           and not the browser's own <title> bubble. */
        .tdk .rd{margin:8px 0 0;font-size:10.5px;color:#a9a294;min-height:15px;
          letter-spacing:.02em;line-height:1.45}
        .tdk .rd.live{color:${INK};font-weight:700}
        .tdk .empty{font-size:11.5px;color:${MUT};padding:18px 0}

        .tdk .chart text{font:500 9.5px ui-sans-serif,system-ui,sans-serif;fill:${MUT}}
        .tdk :global(.nlink){color:${INK} !important;font-weight:700;text-decoration:underline;text-underline-offset:2px}
      `}</style>
    </div>
  );
}
