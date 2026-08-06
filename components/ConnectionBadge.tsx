"use client";

// ConnectionBadge — the top-right connection readout for the React surfaces (guest
// menu, admin, owner). Twin of public/panels/connbadge.js for the vanilla panels;
// both read the same model so every screen speaks one language.
//
// It shows SIGNAL BARS + a live latency number ("42 ms") coloured by speed
// (green → yellow → orange → red) instead of a vague pulsing "Reconnecting" dot that
// people mistook for a button (owner 2026-07-08). The whole pill is ALWAYS tappable
// and opens one small "Connection" panel that MERGES: the live status, the ms with a
// quality label, a tiny recent-latency sparkline, whether live updates are flowing,
// and anything saved on-device waiting to sync. So a tap always does something clear.
//
// The latency comes only from traffic the app ALREADY makes (realtime breadcrumb
// delivery time) — it never sends its own request, so it adds ZERO egress (owner's
// #1 fear). The poll-only owner panel shows a calm "Connected" (no ms — its refresh
// time is dominated by heavy analytics query time, not connection latency).
import { useLayoutEffect, useRef, useState } from "react";
import { useConnection, latencyTier, LATENCY_FRESH_MS } from "@/lib/connectionStatus";
import { useGuestOutbox, dismissGuestFailed, retryGuestFailed, type GuestOrder } from "@/lib/guestOutbox";
import { useBackClose } from "@/lib/backStack"; // phone back button closes the popover first

type View = {
  kind: "live" | "connecting" | "weak" | "offline";
  color: string;  // vivid tier colour — used for the signal bars + status dot
  // Legible (darker) colour for the WORDS and the ms number, which sit on the pale `tint`.
  // Darkened one step each on 2026-08-05: "Live" measured 2.63:1 on its own tint over the light
  // page (T11 re-run), i.e. the indicator staff are told to trust was the least readable thing in
  // the bar. `color` (the bright dot/bars) is unchanged — only text moved.
  text: string;
  tint: string;   // subtle pill background tint
  bars: number;   // 0–3 lit signal bars (carries the same meaning as colour → not colour-only)
  label: string;  // quality word: Excellent / Good / Slow / Poor / Reconnecting / Connecting… / Offline / Live
  ms: number | null;
  pulse: boolean;
};

function computeView(
  level: "online" | "weak" | "offline",
  everConnected: boolean,
  latencyMs: number | null,
  latencyAt: number,
  pollMode: boolean,
): View {
  if (level === "offline")
    return { kind: "offline", color: "#ef4444", text: "#b91c1c", tint: "rgba(239,68,68,.16)", bars: 0, label: "Offline", ms: null, pulse: false };
  if (level === "weak") {
    // First connect not made yet → calm neutral "Connecting…" (NOT alarming amber
    // "Reconnecting", which is reserved for a drop after we WERE connected).
    if (!everConnected && !pollMode)
      return { kind: "connecting", color: "#94a3b8", text: "inherit", tint: "rgba(100,116,139,.14)", bars: 2, label: "Connecting…", ms: null, pulse: true };
    return { kind: "weak", color: "#f59e0b", text: "#b45309", tint: "rgba(245,158,11,.16)", bars: 1, label: pollMode ? "Retrying" : "Reconnecting", ms: null, pulse: true };
  }
  // online — show a fresh ms number when we have one; otherwise a calm "Live" (a quiet
  // screen just hasn't measured lately — that's healthy, not a problem). The poll-only
  // owner panel never shows an ms: its refresh time is dominated by heavy analytics
  // QUERY time, not connection latency, so a slow query would falsely look like a bad
  // link (owner 2026-07-08). It stays a calm "Connected".
  const fresh = !pollMode && latencyAt > 0 && Date.now() - latencyAt < LATENCY_FRESH_MS;
  const tier = fresh ? latencyTier(latencyMs) : null;
  if (tier)
    return { kind: "live", color: tier.color, text: tier.text, tint: tier.tint, bars: tier.bars, label: tier.label, ms: latencyMs, pulse: false };
  return { kind: "live", color: "#22c55e", text: "#15803d", tint: "rgba(34,197,94,.16)", bars: 3, label: pollMode ? "Connected" : "Live", ms: null, pulse: false };
}

function statusLine(v: View, pollMode: boolean): string {
  if (v.kind === "offline") return "No internet connection";
  if (v.kind === "connecting") return "Connecting to live updates…";
  if (v.kind === "weak") return pollMode ? "Couldn't reach the server — retrying" : "Live connection dropped — reconnecting…";
  return pollMode ? "Connected — refreshes every minute" : "Connected — live updates are flowing";
}

function orderLabel(o: GuestOrder): string {
  const t = o.track?.tableNumber || o.table;
  return "Order" + (t ? ` · Table ${t}` : "");
}
const fmtAgo = (ts: number) => { const m = Math.floor((Date.now() - ts) / 60000); return m < 1 ? "just now" : m < 60 ? `${m}m ago` : `${Math.floor(m / 60)}h ago`; };

// Three signal bars; `lit` of them are coloured, the rest faint. Reduced height so it
// reads as a signal-strength meter, not a button.
// THE GEOMETRY IS INLINE ON PURPOSE — do not move it back into the <style jsx> block below.
// styled-jsx scopes its selectors to the component whose JSX holds the <style jsx> tag, and this
// is a SEPARATE function component, so these spans never received that scoping class: the
// `.lfh-bars { display: inline-flex }` and `.lfh-bar { width: 3px }` rules matched nothing, the
// bars computed to 0x0, and the meter has been invisible on every React badge since it was
// written — measured on the deployed site as well as locally (T12 phone sweep, 2026-08-05). The
// guest menu hid the fault because the "608 ms" text carries the meaning there; the owner top bar
// hides that text on a phone by design, so it drew a completely empty capsule. Inline styles
// cannot be scoped away. The style block below keeps the same rules for the pulse animation.
function SignalBars({ lit, color, big = false }: { lit: number; color: string; big?: boolean }) {
  const h = big ? [10, 15, 20] : [6, 9, 12];
  const w = big ? 4 : 3;
  return (
    <span
      className={`lfh-bars${big ? " lfh-big" : ""}`}
      aria-hidden="true"
      style={{ display: "inline-flex", alignItems: "flex-end", gap: big ? 3 : 2, height: big ? 20 : 12, flex: "0 0 auto" }}
    >
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="lfh-bar"
          style={{ width: w, borderRadius: w / 2, height: h[i], background: i < lit ? color : "currentColor", opacity: i < lit ? 1 : 0.22 }}
        />
      ))}
    </span>
  );
}

// A fixed-width sparkline of recent latency, newest at the right. Real readings (each
// coloured by its own tier, so the history shows green/amber spikes) fill from the
// right; any unused leading slots are faint baseline ticks — so it always reads as a
// proper bar chart (never a couple of fat blocks) and visibly fills up over time.
const SPARK_SLOTS = 24; // matches HISTORY_MAX in lib/connectionStatus.ts
function Sparkline({ history }: { history: number[] }) {
  const data = history.slice(-SPARK_SLOTS);
  if (data.length < 1) return null;
  const max = Math.max(...data, 1);
  const pad = SPARK_SLOTS - data.length;
  return (
    <span className="lfh-spark-wrap" aria-hidden="true">
      <span className="lfh-spark-cap">Recent speed<span>{data.length < 4 ? "building history…" : `last ${data.length} updates`}</span></span>
      <span className="lfh-spark">
        {Array.from({ length: pad }).map((_, i) => <span key={`e${i}`} className="lfh-spark-bar lfh-empty" />)}
        {data.map((v, i) => {
          const t = latencyTier(v);
          return <span key={i} className="lfh-spark-bar" style={{ height: `${Math.max(14, Math.round((v / max) * 100))}%`, background: t ? t.color : "#22c55e" }} />;
        })}
      </span>
    </span>
  );
}

// WHICH WAY DOES THE SURFACE RUN? The pill's words sit on a translucent tint of their own state
// colour, so the composited background follows the PAGE: pale green on the guest menu's light skin,
// near-black green inside the dark owner/admin consoles. One ink cannot serve both — the darkened
// ink that fixed the light page (2.63:1) then measured 2.82:1 on the dark consoles (T11 re-run,
// 2026-08-05). So the dark ink is applied inline for light surfaces and the BRIGHT state colour is
// handed to CSS as --ink-dark, which the rule at the bottom of this file switches to on any dark
// surface. It has to be done in CSS, NOT by reading document.documentElement here: this component
// renders on the SERVER, where there is no <html> to read, and React keeps the server's inline
// style after hydration — a first attempt at this returned "light" forever.

export default function ConnectionBadge({ className = "", pollMode = false, guest = false }:
  { className?: string; pollMode?: boolean; guest?: boolean }) {
  const { level, everConnected, latencyMs, latencyAt, history } = useConnection();
  const box = useGuestOutbox();
  const [open, setOpen] = useState(false);
  // Register the popover with the phone back-button manager (self-noops while closed).
  useBackClose("conn-badge", open, () => setOpen(false));

  // KEEP THE PANEL ON SCREEN. It is anchored `right: 0` to the badge and is up to 288px wide, so
  // it opens LEFTWARDS — and on the guest menu the badge sits in `.nav-actions` with the currency,
  // language, theme and cart buttons to its right, which pushes it well in from the left edge. On
  // the owner's 360px phone the panel's own box measured x = −58: 58px of every line was cut off,
  // so it read "nected — live updates are flowing", "ve", "d shows when data flows", "ything is
  // synced". Measured on the deployed site.
  //
  // A pure-CSS clamp can't do this (a transformed ancestor defeats position:fixed, which is why
  // the vanilla twin measures too — public/panels/connbadge.js clampPop). So measure the rendered
  // rect and nudge it back inside, re-running whenever the panel's CONTENT changes: it grows when
  // the "waiting to send" list appears, and a one-shot clamp leaves the grown panel hanging out.
  const popRef = useRef<HTMLSpanElement | null>(null);
  const [shift, setShift] = useState(0);
  const waitingN = box.queued.length, failedN = box.failed.length;
  useLayoutEffect(() => {
    if (!open) { setShift(0); return; }
    const clamp = () => {
      const el = popRef.current;
      if (!el) return;
      // Measure from the UNSHIFTED position — the live rect already includes any shift applied
      // last time, so re-clamping on top of it would walk the panel further on every pass.
      el.style.transform = "";
      const r = el.getBoundingClientRect(), pad = 8;
      let next = 0;
      if (r.left < pad) next = pad - r.left;
      else if (r.right > window.innerWidth - pad) next = (window.innerWidth - pad) - r.right;
      setShift(Math.round(next));
    };
    clamp();
    window.addEventListener("resize", clamp);
    return () => window.removeEventListener("resize", clamp);
  }, [open, waitingN, failedN, level, latencyMs]);

  const v = computeView(level, everConnected, latencyMs, latencyAt, pollMode);
  const waiting = box.queued.length, failed = box.failed.length;
  const extra = failed ? `${failed} failed` : waiting ? `${waiting} waiting` : "";

  return (
    <span className={`lfh-conn-wrap ${className}`}>
      <button
        type="button"
        className={`lfh-conn-badge${v.pulse ? " is-pulse" : ""}`}
        style={{ background: v.tint }}
        title={`${statusLine(v, pollMode)}${v.ms != null ? ` · ${v.ms} ms` : ""}${extra ? ` · ${extra} to send` : ""}`}
        aria-label={`Connection: ${v.label}${v.ms != null ? `, ${v.ms} milliseconds` : ""}${extra ? `, ${extra}` : ""}. Tap for details.`}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <SignalBars lit={v.bars} color={v.color} />
        {/* A DINER IS NOT A DEVELOPER. On staff screens the millisecond figure is the point — it
            is how someone decides whether the floor is lagging. On the GUEST menu the same pill
            sits second from the left in a 360px header, right beside the restaurant's own name,
            and a diner reading "608 ms" learns nothing from it; worse, it is only there when a
            measurement happens to be fresh, so the header changes wording on its own between two
            page loads (seen on the deployed site: three loads said "Live", the fourth "608 ms").
            Guests keep the SIGNAL — the bars and the colour, including amber when it really is
            slow — and get the plain word. The number is still one tap away in the panel below,
            which is where a detail belongs. */}
        {v.ms != null && !guest
          ? <span className="lfh-conn-ms" style={{ color: v.text, ["--ink-dark" as string]: v.color }}>{v.ms}<span className="lfh-conn-unit"> ms</span></span>
          : <span className="lfh-conn-txt" style={{ color: v.text, ["--ink-dark" as string]: v.color }}>{v.label}</span>}
        {extra && <span className={`lfh-conn-n${failed ? " warn" : ""}`}>· {extra}</span>}
        <svg className="lfh-conn-chev" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>

      {open && (
        <span
          className="lfh-conn-pop"
          role="dialog"
          aria-label="Connection details"
          ref={popRef}
          // The clamp travels through a CSS variable as well as the inline transform, because the
          // entry animation below also animates `transform` and a running animation outranks an
          // inline style — so without the variable the panel painted clipped for its first 160ms
          // and then snapped into place. (Same fix, same reason, as the vanilla twin.)
          style={shift ? ({ "--pop-x": `${shift}px`, transform: `translateX(${shift}px)` } as React.CSSProperties) : undefined}
        >
          <span className="lfh-conn-pop-hd">
            <span className="lfh-conn-pop-dot" style={{ background: v.color }} />
            {statusLine(v, pollMode)}
          </span>

          <span className="lfh-conn-pop-main">
            <SignalBars lit={v.bars} color={v.color} big />
            <span className="lfh-conn-pop-figs">
              {v.ms != null
                ? <><b style={{ color: v.text }}>{v.ms}<span className="lfh-conn-pop-unit"> ms</span></b><small>{v.label}</small></>
                : <><b style={{ color: v.text }}>{v.label}</b><small>{v.kind === "live" ? "Speed shows when data flows" : ""}</small></>}
            </span>
          </span>

          {v.kind === "live" && <Sparkline history={history} />}

          {(waiting > 0 || failed > 0) && (
            <span className="lfh-conn-pop-sync">
              <span className="lfh-conn-pop-sub">{failed > 0 ? "Couldn't send" : level === "offline" ? "Saved on this device" : "Sending…"}</span>
              {box.failed.map((o) => (
                <span key={o.id} className="lfh-conn-row">
                  <span className="lfh-conn-row-t"><b>{orderLabel(o)}</b><small className="err">{o.error} · {fmtAgo(o.at)}</small></span>
                  {/* Try again comes FIRST, and it is the point: the only control here used to be
                      "Dismiss", i.e. throw the order away. An order that failed for a reason that
                      has since passed (the system was busy, the dish came back) could not be sent
                      without building the whole basket again. */}
                  <button className="lfh-conn-go" onClick={() => retryGuestFailed(o.id)}>Try again</button>
                  <button className="lfh-conn-x" onClick={() => dismissGuestFailed(o.id)}>Dismiss</button>
                </span>
              ))}
              {box.queued.map((o) => (
                <span key={o.id} className="lfh-conn-row">
                  <span className="lfh-conn-row-t"><b>{orderLabel(o)}</b><small>{fmtAgo(o.at)}</small></span>
                  <span className="lfh-conn-pill">{level === "offline" ? "Waiting" : "Sending…"}</span>
                </span>
              ))}
            </span>
          )}
          {waiting === 0 && failed === 0 && (
            <span className="lfh-conn-pop-ok">✓ Everything is synced</span>
          )}
        </span>
      )}

      <style jsx>{`
        .lfh-conn-wrap { position: relative; display: inline-flex; }
        .lfh-conn-badge {
          display: inline-flex; align-items: center; gap: 7px;
          padding: 5px 9px; border-radius: 999px; border: 1px solid var(--line, rgba(127,127,127,.22));
          font: 700 12.5px/1 system-ui, sans-serif; white-space: nowrap; user-select: none; cursor: pointer;
          color: var(--text, currentColor);
          transition: background 0.2s, border-color 0.2s, filter 0.15s;
        }
        .lfh-conn-badge:hover { filter: brightness(1.05); }
        .lfh-conn-badge:focus-visible { outline: 2px solid var(--accent, #6366f1); outline-offset: 2px; }
        .lfh-bars { display: inline-flex; align-items: flex-end; gap: 2px; height: 12px; flex: 0 0 auto; }
        .lfh-bars.lfh-big { height: 20px; gap: 3px; }
        .lfh-bar { width: 3px; border-radius: 1.5px; }
        .lfh-bars.lfh-big .lfh-bar { width: 4px; border-radius: 2px; }
        .is-pulse .lfh-bars .lfh-bar { animation: lfhBarPulse 1.1s ease-in-out infinite; }
        @keyframes lfhBarPulse { 0%,100% { opacity: 1; } 50% { opacity: 0.35; } }
        .lfh-conn-ms { font-variant-numeric: tabular-nums; font-weight: 800; }
        .lfh-conn-unit { font-weight: 600; opacity: 0.7; font-size: 10px; }
        .lfh-conn-txt { font-weight: 700; }
        /* On a DARK surface the tint composites to near-black, so the bright state colour is the
           readable one (~6:1) and the darkened ink is not (2.82:1). !important because the ink
           above is an inline style, which a normal rule cannot beat. */
        /* Key off surfaces that are ACTUALLY dark. data-staffdark is on <html> and stays true on
           /owner and /aevinite in BOTH skins — those consoles carry their skin on a wrapper
           ([data-skin]) — so using it forced the dark-surface ink onto the LIGHT console and
           "Connected" measured 1.99:1 there (my own regression, caught 2026-08-06). data-skin
           handles the consoles; data-theme handles the guest menu and the panels. */
        :global([data-skin="dark"]) .lfh-conn-txt,
        :global([data-skin="dark"]) .lfh-conn-ms,
        :global(html[data-theme="dark"]) .lfh-conn-txt,
        :global(html[data-theme="dark"]) .lfh-conn-ms { color: var(--ink-dark) !important; }
        .lfh-conn-n { font-weight: 800; opacity: 0.9; }
        .lfh-conn-n.warn { color: #ef4444; }
        .lfh-conn-chev { opacity: 0.5; flex: 0 0 auto; }

        .lfh-conn-pop {
          position: absolute; top: calc(100% + 8px); right: 0; z-index: 9999;
          width: min(86vw, 288px); display: flex; flex-direction: column; gap: 12px;
          padding: 14px; background: var(--panel, var(--card, #10182b)); color: var(--text, #e7eefc);
          border: 1px solid var(--line, rgba(127,127,127,.28)); border-radius: 14px;
          box-shadow: 0 18px 50px rgba(0,0,0,.4);
          font: 500 12.5px/1.35 system-ui, sans-serif;
          --pop-x: 0px;
          animation: lfhConnPop 0.16s cubic-bezier(.16,1,.3,1);
        }
        /* Carries the on-screen clamp THROUGH the entry animation (see --pop-x above): a running
           animation on the transform property beats an inline transform, so the keyframes have to
           respect the nudge or the panel opens clipped and then jumps into place.
           NOTE: no backticks in here — this whole block is a template literal, so one would end
           it early and the file would stop parsing. */
        @keyframes lfhConnPop {
          from { transform: translate(var(--pop-x), -4px); opacity: 0; }
          to { transform: translate(var(--pop-x), 0); opacity: 1; }
        }
        .lfh-conn-pop-hd { display: flex; align-items: center; gap: 8px; font-weight: 700; font-size: 12.5px; }
        .lfh-conn-pop-dot { width: 9px; height: 9px; border-radius: 999px; flex: 0 0 auto; }
        .lfh-conn-pop-main { display: flex; align-items: center; gap: 12px; padding: 4px 2px; }
        .lfh-conn-pop-figs { display: flex; flex-direction: column; gap: 2px; }
        .lfh-conn-pop-figs b { font-size: 24px; font-weight: 800; line-height: 1; font-variant-numeric: tabular-nums; }
        .lfh-conn-pop-unit { font-size: 13px; font-weight: 600; opacity: 0.7; }
        .lfh-conn-pop-figs small { font-size: 11px; opacity: 0.7; }

        .lfh-spark-wrap { display: flex; flex-direction: column; gap: 7px; border-top: 1px solid var(--line, rgba(127,127,127,.14)); padding-top: 10px; }
        .lfh-spark-cap { display: flex; justify-content: space-between; align-items: baseline; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; opacity: 0.55; }
        .lfh-spark-cap span { font-weight: 600; text-transform: none; letter-spacing: 0; opacity: 0.85; }
        .lfh-spark { display: flex; align-items: flex-end; gap: 3px; height: 32px; }
        .lfh-spark-bar { flex: 1 1 0; min-width: 0; border-radius: 2px 2px 0 0; opacity: 0.9; }
        .lfh-spark-bar.lfh-empty { height: 14%; background: currentColor; opacity: 0.1; }

        .lfh-conn-pop-sync { display: flex; flex-direction: column; gap: 6px; border-top: 1px solid var(--line, rgba(127,127,127,.14)); padding-top: 10px; }
        .lfh-conn-pop-sub { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; opacity: 0.6; }
        .lfh-conn-row { display: flex; align-items: center; gap: 8px; }
        .lfh-conn-row-t { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
        .lfh-conn-row-t b { font-size: 12.5px; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .lfh-conn-row-t small { font-size: 11px; opacity: 0.7; }
        .lfh-conn-row-t small.err { color: #fca5a5; opacity: 1; }
        .lfh-conn-pill { font-size: 10.5px; font-weight: 800; padding: 3px 8px; border-radius: 999px; background: rgba(34,197,94,.16); color: #86efac; flex: 0 0 auto; }
        .lfh-conn-x { border: 0; border-radius: 8px; padding: 6px 10px; font-size: 11.5px; font-weight: 700; cursor: pointer; background: #64748b; color: #fff; flex: 0 0 auto; }
        /* The action we want tapped, so it carries the colour; Dismiss stays grey beside it. */
        .lfh-conn-go { border: 0; border-radius: 8px; padding: 6px 10px; font-size: 11.5px; font-weight: 700; cursor: pointer; background: #16a34a; color: #fff; flex: 0 0 auto; }
        .lfh-conn-pop-ok { font-size: 11.5px; opacity: 0.6; border-top: 1px solid var(--line, rgba(127,127,127,.14)); padding-top: 10px; }

        @media (prefers-reduced-motion: reduce) {
          .is-pulse .lfh-bars .lfh-bar { animation: none; }
          .lfh-conn-pop { animation: none; }
        }
      `}</style>
    </span>
  );
}
