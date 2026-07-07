"use client";

// ConnectionBadge — the top-right 🟢/🟡/🔴 connection light for the React surfaces
// (guest menu, admin, owner). Twin of public/panels/connbadge.js for the vanilla
// panels; both read the same three-state model so every screen speaks one language.
//
// On the GUEST menu it ALSO shows any orders saved while offline: a "· N waiting"
// count that opens a small list of what's still to send (and anything that couldn't
// send). On admin/owner the guest queue is always empty, so nothing extra shows.
import { useState } from "react";
import { useConnectionStatus, type ConnLevel } from "@/lib/connectionStatus";
import { useGuestOutbox, dismissGuestFailed, type GuestOrder } from "@/lib/guestOutbox";
import { useBackClose } from "@/lib/backStack"; // phone back button closes the popover first

const STATES: Record<ConnLevel, { dot: string; label: string; title: string }> = {
  online:  { dot: "#22c55e", label: "Live",         title: "Connected — live updates are flowing." },
  weak:    { dot: "#f59e0b", label: "Reconnecting", title: "You're online, but the live connection dropped — reconnecting…" },
  offline: { dot: "#ef4444", label: "Offline",      title: "No internet. Anything you order is saved on this device and sent when you're back online." },
};

// The owner panel has no live socket — it refreshes on a timer. In `pollMode` the badge
// tells that honest story (and turns amber when a refresh actually fails) instead of
// claiming a websocket is "flowing" (audit 2026-07-07).
const POLL_STATES: Record<ConnLevel, { dot: string; label: string; title: string }> = {
  online:  { dot: "#22c55e", label: "Connected", title: "Connected — the numbers refresh every minute." },
  weak:    { dot: "#f59e0b", label: "Retrying",  title: "Couldn't reach the server on the last refresh — retrying every minute." },
  offline: { dot: "#ef4444", label: "Offline",   title: "No internet — the numbers can't refresh until you're back online." },
};

function orderLabel(o: GuestOrder): string {
  const t = o.track?.tableNumber || o.table;
  return "Order" + (t ? ` · Table ${t}` : "");
}
const fmtAgo = (ts: number) => { const m = Math.floor((Date.now() - ts) / 60000); return m < 1 ? "just now" : m < 60 ? `${m}m ago` : `${Math.floor(m / 60)}h ago`; };

export default function ConnectionBadge({ className = "", pollMode = false }: { className?: string; pollMode?: boolean }) {
  const level = useConnectionStatus();
  const box = useGuestOutbox();
  const [open, setOpen] = useState(false);
  // Register the popover with the phone back-button manager so pressing Back closes
  // THIS popover first instead of falling through to another layer / the exit dialog.
  // (self-noops while closed.)
  useBackClose("conn-badge", open, () => setOpen(false));
  const st = (pollMode ? POLL_STATES : STATES)[level];
  const extra = box.failed.length ? `${box.failed.length} failed` : box.queued.length ? `${box.queued.length} waiting` : "";
  const clickable = box.count > 0;

  return (
    <span className={`lfh-conn-wrap ${className}`}>
      <span
        className={`lfh-conn-badge${level === "offline" ? " is-offline" : ""}${clickable ? " is-click" : ""}`}
        title={extra ? `${extra} to send — tap to see.` : st.title}
        aria-label={`Connection: ${st.label}${extra ? `, ${extra}` : ""}`}
        role={clickable ? "button" : "status"}
        onClick={clickable ? () => setOpen((v) => !v) : undefined}
      >
        <span className="lfh-conn-badge-dot" style={{ background: st.dot }} aria-hidden="true" />
        <span className="lfh-conn-badge-txt">{st.label}</span>
        {extra && <span className={`lfh-conn-badge-n${box.failed.length ? " warn" : ""}`}>· {extra}</span>}
      </span>

      {open && clickable && (
        <span className="lfh-conn-pop" role="dialog" aria-label="Orders waiting to send">
          <span className="lfh-conn-pop-hd">
            {level === "offline" ? "📴 Offline — saved on this device" : "🟢 Sending your orders…"}
          </span>
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

      <style jsx>{`
        .lfh-conn-wrap { position: relative; display: inline-flex; }
        .lfh-conn-badge {
          display: inline-flex; align-items: center; gap: 7px;
          padding: 5px 11px 5px 9px; border-radius: 999px;
          font: 600 12px/1 system-ui, sans-serif; white-space: nowrap; user-select: none;
          background: var(--panel-2, rgba(127, 127, 127, 0.12));
          border: 1px solid var(--line, rgba(127, 127, 127, 0.25));
          color: var(--text, currentColor);
          transition: background 0.2s, border-color 0.2s, color 0.2s;
        }
        .lfh-conn-badge.is-click { cursor: pointer; }
        .lfh-conn-badge.is-click:hover { filter: brightness(1.06); }
        .lfh-conn-badge-dot { width: 9px; height: 9px; border-radius: 999px; flex: 0 0 auto; position: relative; }
        .lfh-conn-badge-dot::after {
          content: ""; position: absolute; inset: -3px; border-radius: 999px;
          background: inherit; opacity: 0.35; animation: lfhConnPulse 1.8s ease-out infinite;
        }
        .is-offline .lfh-conn-badge-dot::after { animation: none; opacity: 0; }
        .lfh-conn-badge-n { font-weight: 800; opacity: 0.9; }
        .lfh-conn-badge-n.warn { color: #ef4444; }
        @keyframes lfhConnPulse { 0% { transform: scale(0.7); opacity: 0.5; } 70% { transform: scale(1.9); opacity: 0; } 100% { opacity: 0; } }
        .lfh-conn-pop {
          position: absolute; top: calc(100% + 8px); right: 0; z-index: 9999;
          width: min(84vw, 300px); display: flex; flex-direction: column;
          background: var(--panel, #10182b); color: var(--text, #e7eefc);
          border: 1px solid var(--line, rgba(127,127,127,.3)); border-radius: 14px;
          box-shadow: 0 18px 50px rgba(0,0,0,.4); overflow: hidden;
          font: 500 12.5px/1.3 system-ui, sans-serif;
        }
        .lfh-conn-pop-hd { padding: 11px 13px; font-weight: 700; font-size: 12px; border-bottom: 1px solid var(--line, rgba(127,127,127,.2)); }
        .lfh-conn-row { display: flex; align-items: center; gap: 8px; padding: 9px 13px; border-bottom: 1px solid var(--line, rgba(127,127,127,.12)); }
        .lfh-conn-row:last-child { border-bottom: 0; }
        .lfh-conn-row-t { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
        .lfh-conn-row-t b { font-size: 13px; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .lfh-conn-row-t small { font-size: 11px; opacity: 0.7; }
        .lfh-conn-row-t small.err { color: #fca5a5; opacity: 1; }
        .lfh-conn-pill { font-size: 10.5px; font-weight: 800; padding: 3px 8px; border-radius: 999px; background: rgba(34,197,94,.16); color: #86efac; flex: 0 0 auto; }
        .is-offline ~ .lfh-conn-pop .lfh-conn-pill { background: rgba(239,68,68,.16); color: #fca5a5; }
        .lfh-conn-x { border: 0; border-radius: 8px; padding: 6px 10px; font-size: 11.5px; font-weight: 700; cursor: pointer; background: #64748b; color: #fff; flex: 0 0 auto; }
        @media (max-width: 560px) { .lfh-conn-badge-txt { display: none; } }
        @media (prefers-reduced-motion: reduce) { .lfh-conn-badge-dot::after { animation: none; } }
      `}</style>
    </span>
  );
}
