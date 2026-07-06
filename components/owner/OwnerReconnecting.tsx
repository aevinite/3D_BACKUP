"use client";
// Shown by the owner layout when the auth lookup hits a TRANSIENT database error
// (AuthDbError) — a blip is NOT "logged out", so we must never bounce the owner to
// /login. Instead we hold their session, show a calm "reconnecting" card, and retry
// automatically. Mirrors the gate rule in lib/userAuth.ts (DB blip → 503-retry).
import { useEffect, useState } from "react";

export default function OwnerReconnecting() {
  const [secs, setSecs] = useState(3);
  useEffect(() => {
    const tick = setInterval(() => setSecs((s) => (s > 0 ? s - 1 : 0)), 1000);
    const go = setTimeout(() => location.reload(), 3000);
    return () => { clearInterval(tick); clearTimeout(go); };
  }, []);
  return (
    <div style={{
      minHeight: "100vh", display: "grid", placeItems: "center", padding: 24,
      background: "#0b0f14", color: "#e6edf3", fontFamily: "system-ui, sans-serif",
    }}>
      <div style={{
        maxWidth: 420, width: "100%", textAlign: "center", border: "1px solid rgba(255,255,255,.1)",
        borderRadius: 16, padding: "32px 28px", background: "rgba(255,255,255,.03)",
      }}>
        <div style={{ fontSize: 34, marginBottom: 10 }} aria-hidden="true">📶</div>
        <h1 style={{ fontSize: 18, fontWeight: 800, margin: "0 0 8px" }}>Reconnecting…</h1>
        <p style={{ fontSize: 13.5, lineHeight: 1.5, color: "#9aa7b4", margin: "0 0 18px" }}>
          We hit a brief hiccup reaching the database. You&apos;re still signed in — this
          will retry on its own in {secs}s.
        </p>
        <button onClick={() => location.reload()} style={{
          border: "none", borderRadius: 10, padding: "10px 18px", fontWeight: 700, fontSize: 13.5,
          background: "#34d399", color: "#04231a", cursor: "pointer",
        }}>
          Retry now
        </button>
      </div>
    </div>
  );
}
