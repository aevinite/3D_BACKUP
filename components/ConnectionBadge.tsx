"use client";

// ConnectionBadge — the top-right 🟢/🟡/🔴 connection light for the React surfaces
// (guest menu, admin, owner). Twin of public/panels/connbadge.js for the vanilla
// panels; both read the same three-state model so every screen speaks one language.
import { useConnectionStatus, type ConnLevel } from "@/lib/connectionStatus";

const STATES: Record<ConnLevel, { dot: string; label: string; title: string }> = {
  online:  { dot: "#22c55e", label: "Live",         title: "Connected — live updates are flowing." },
  weak:    { dot: "#f59e0b", label: "Reconnecting", title: "You're online, but the live connection dropped — reconnecting…" },
  offline: { dot: "#ef4444", label: "Offline",      title: "No internet. Changes are saved on this device and will sync when you're back online." },
};

export default function ConnectionBadge({ className = "" }: { className?: string }) {
  const level = useConnectionStatus();
  const st = STATES[level];
  return (
    <span
      className={`lfh-conn-badge${level === "offline" ? " is-offline" : ""} ${className}`}
      title={st.title}
      aria-label={`Connection: ${st.label}`}
      role="status"
    >
      <span className="lfh-conn-badge-dot" style={{ background: st.dot }} aria-hidden="true" />
      <span className="lfh-conn-badge-txt">{st.label}</span>
      <style jsx>{`
        .lfh-conn-badge {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          padding: 5px 11px 5px 9px;
          border-radius: 999px;
          font: 600 12px/1 system-ui, sans-serif;
          white-space: nowrap;
          user-select: none;
          background: var(--panel-2, rgba(127, 127, 127, 0.12));
          border: 1px solid var(--line, rgba(127, 127, 127, 0.25));
          color: var(--text, currentColor);
          transition: background 0.2s, border-color 0.2s, color 0.2s;
        }
        .lfh-conn-badge-dot {
          width: 9px;
          height: 9px;
          border-radius: 999px;
          flex: 0 0 auto;
          position: relative;
        }
        .lfh-conn-badge-dot::after {
          content: "";
          position: absolute;
          inset: -3px;
          border-radius: 999px;
          background: inherit;
          opacity: 0.35;
          animation: lfhConnPulse 1.8s ease-out infinite;
        }
        .is-offline .lfh-conn-badge-dot::after {
          animation: none;
          opacity: 0;
        }
        @keyframes lfhConnPulse {
          0% { transform: scale(0.7); opacity: 0.5; }
          70% { transform: scale(1.9); opacity: 0; }
          100% { opacity: 0; }
        }
        @media (max-width: 560px) {
          .lfh-conn-badge-txt { display: none; }
          .lfh-conn-badge { padding: 6px; }
        }
        @media (prefers-reduced-motion: reduce) {
          .lfh-conn-badge-dot::after { animation: none; }
        }
      `}</style>
    </span>
  );
}
