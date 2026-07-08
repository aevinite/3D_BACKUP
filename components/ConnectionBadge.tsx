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
import { useState } from "react";
import { useConnection, latencyTier, LATENCY_FRESH_MS } from "@/lib/connectionStatus";
import { useGuestOutbox, dismissGuestFailed, type GuestOrder } from "@/lib/guestOutbox";
import { useBackClose } from "@/lib/backStack"; // phone back button closes the popover first

type View = {
  kind: "live" | "connecting" | "weak" | "offline";
  color: string;  // vivid tier colour — used for the signal bars + status dot
  text: string;   // legible (darker) colour — used for the ms number so it stays readable on the tint
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
    return { kind: "offline", color: "#ef4444", text: "#dc2626", tint: "rgba(239,68,68,.16)", bars: 0, label: "Offline", ms: null, pulse: false };
  if (level === "weak") {
    // First connect not made yet → calm neutral "Connecting…" (NOT alarming amber
    // "Reconnecting", which is reserved for a drop after we WERE connected).
    if (!everConnected && !pollMode)
      return { kind: "connecting", color: "#94a3b8", text: "inherit", tint: "rgba(100,116,139,.14)", bars: 2, label: "Connecting…", ms: null, pulse: true };
    return { kind: "weak", color: "#f59e0b", text: "#d97706", tint: "rgba(245,158,11,.16)", bars: 1, label: pollMode ? "Retrying" : "Reconnecting", ms: null, pulse: true };
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
  return { kind: "live", color: "#22c55e", text: "#16a34a", tint: "rgba(34,197,94,.16)", bars: 3, label: pollMode ? "Connected" : "Live", ms: null, pulse: false };
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
function SignalBars({ lit, color, big = false }: { lit: number; color: string; big?: boolean }) {
  const h = big ? [10, 15, 20] : [6, 9, 12];
  return (
    <span className={`lfh-bars${big ? " big" : ""}`} aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <span key={i} className="lfh-bar" style={{ height: h[i], background: i < lit ? color : "currentColor", opacity: i < lit ? 1 : 0.22 }} />
      ))}
    </span>
  );
}

// A tiny sparkline of the recent latency readings — each bar coloured by its own tier,
// so the history literally shows green/amber/orange spikes. No axes; decorative-but-
// meaningful. Empty until at least two readings exist.
function Sparkline({ history }: { history: number[] }) {
  const data = history.slice(-16);
  if (data.length < 2) return null;
  const max = Math.max(...data, 1);
  return (
    <span className="lfh-spark" aria-hidden="true">
      {data.map((v, i) => {
        const t = latencyTier(v);
        return <span key={i} className="lfh-spark-bar" style={{ height: `${Math.max(12, Math.round((v / max) * 100))}%`, background: t ? t.color : "#22c55e" }} />;
      })}
    </span>
  );
}

export default function ConnectionBadge({ className = "", pollMode = false }: { className?: string; pollMode?: boolean }) {
  const { level, everConnected, latencyMs, latencyAt, history } = useConnection();
  const box = useGuestOutbox();
  const [open, setOpen] = useState(false);
  // Register the popover with the phone back-button manager (self-noops while closed).
  useBackClose("conn-badge", open, () => setOpen(false));

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
        {v.ms != null
          ? <span className="lfh-conn-ms" style={{ color: v.text }}>{v.ms}<span className="lfh-conn-unit"> ms</span></span>
          : <span className="lfh-conn-txt" style={{ color: v.text }}>{v.label}</span>}
        {extra && <span className={`lfh-conn-n${failed ? " warn" : ""}`}>· {extra}</span>}
        <svg className="lfh-conn-chev" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>

      {open && (
        <span className="lfh-conn-pop" role="dialog" aria-label="Connection details">
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
        .lfh-bars.big { height: 20px; gap: 3px; }
        .lfh-bar { width: 3px; border-radius: 1.5px; }
        .lfh-bars.big .lfh-bar { width: 4px; border-radius: 2px; }
        .is-pulse .lfh-bars .lfh-bar { animation: lfhBarPulse 1.1s ease-in-out infinite; }
        @keyframes lfhBarPulse { 0%,100% { opacity: 1; } 50% { opacity: 0.35; } }
        .lfh-conn-ms { font-variant-numeric: tabular-nums; font-weight: 800; }
        .lfh-conn-unit { font-weight: 600; opacity: 0.7; font-size: 10px; }
        .lfh-conn-txt { font-weight: 700; }
        .lfh-conn-n { font-weight: 800; opacity: 0.9; }
        .lfh-conn-n.warn { color: #ef4444; }
        .lfh-conn-chev { opacity: 0.5; flex: 0 0 auto; }

        .lfh-conn-pop {
          position: absolute; top: calc(100% + 8px); right: 0; z-index: 9999;
          width: min(86vw, 288px); display: flex; flex-direction: column; gap: 12px;
          padding: 14px; background: var(--panel, #10182b); color: var(--text, #e7eefc);
          border: 1px solid var(--line, rgba(127,127,127,.28)); border-radius: 14px;
          box-shadow: 0 18px 50px rgba(0,0,0,.4);
          font: 500 12.5px/1.35 system-ui, sans-serif;
          animation: lfhConnPop 0.16s cubic-bezier(.16,1,.3,1);
        }
        @keyframes lfhConnPop { from { transform: translateY(-4px); opacity: 0; } to { transform: none; opacity: 1; } }
        .lfh-conn-pop-hd { display: flex; align-items: center; gap: 8px; font-weight: 700; font-size: 12.5px; }
        .lfh-conn-pop-dot { width: 9px; height: 9px; border-radius: 999px; flex: 0 0 auto; }
        .lfh-conn-pop-main { display: flex; align-items: center; gap: 12px; padding: 4px 2px; }
        .lfh-conn-pop-figs { display: flex; flex-direction: column; gap: 2px; }
        .lfh-conn-pop-figs b { font-size: 24px; font-weight: 800; line-height: 1; font-variant-numeric: tabular-nums; }
        .lfh-conn-pop-unit { font-size: 13px; font-weight: 600; opacity: 0.7; }
        .lfh-conn-pop-figs small { font-size: 11px; opacity: 0.7; }

        .lfh-spark { display: flex; align-items: flex-end; gap: 2px; height: 30px; padding: 4px 2px 0; border-top: 1px solid var(--line, rgba(127,127,127,.14)); }
        .lfh-spark-bar { flex: 1; min-width: 2px; border-radius: 2px 2px 0 0; opacity: 0.85; }

        .lfh-conn-pop-sync { display: flex; flex-direction: column; gap: 6px; border-top: 1px solid var(--line, rgba(127,127,127,.14)); padding-top: 10px; }
        .lfh-conn-pop-sub { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; opacity: 0.6; }
        .lfh-conn-row { display: flex; align-items: center; gap: 8px; }
        .lfh-conn-row-t { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
        .lfh-conn-row-t b { font-size: 12.5px; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .lfh-conn-row-t small { font-size: 11px; opacity: 0.7; }
        .lfh-conn-row-t small.err { color: #fca5a5; opacity: 1; }
        .lfh-conn-pill { font-size: 10.5px; font-weight: 800; padding: 3px 8px; border-radius: 999px; background: rgba(34,197,94,.16); color: #86efac; flex: 0 0 auto; }
        .lfh-conn-x { border: 0; border-radius: 8px; padding: 6px 10px; font-size: 11.5px; font-weight: 700; cursor: pointer; background: #64748b; color: #fff; flex: 0 0 auto; }
        .lfh-conn-pop-ok { font-size: 11.5px; opacity: 0.6; border-top: 1px solid var(--line, rgba(127,127,127,.14)); padding-top: 10px; }

        @media (prefers-reduced-motion: reduce) {
          .is-pulse .lfh-bars .lfh-bar { animation: none; }
          .lfh-conn-pop { animation: none; }
        }
      `}</style>
    </span>
  );
}
