"use client";
// Shown by the owner layout when the auth lookup hits a TRANSIENT database error
// (AuthDbError) — a blip is NOT "logged out", so we must never bounce the owner to
// /login. Instead we hold their session, show a calm "reconnecting" card, and retry
// automatically. Mirrors the gate rule in lib/userAuth.ts (DB blip → 503-retry).
import { useEffect, useState } from "react";

export default function OwnerReconnecting() {
  const [secs, setSecs] = useState(3);
  // Follow the owner's chosen skin instead of a hardcoded dark hex (which clashed for
  // a light-mode owner). We render inside `.adm.owx` so the same CSS tokens the panel
  // defines (--bg / --card / --text / --muted / --accent …) resolve here too, then
  // read the persisted preference on mount. Defaults to dark on the SSR pass (no
  // localStorage) — a harmless one-frame default on a transient retry screen.
  const [skin, setSkin] = useState<"light" | "dark">("dark");
  useEffect(() => {
    try { const s = localStorage.getItem("aevidine_skin"); if (s === "light" || s === "dark") setSkin(s); } catch {}
    const tick = setInterval(() => setSecs((s) => (s > 0 ? s - 1 : 0)), 1000);
    const go = setTimeout(() => location.reload(), 3000);
    return () => { clearInterval(tick); clearTimeout(go); };
  }, []);
  return (
    <div className="adm owx" data-skin={skin} style={{
      minHeight: "100vh", display: "grid", placeItems: "center", padding: 24,
      background: "var(--bg)", color: "var(--text)", fontFamily: "system-ui, sans-serif",
    }}>
      <div style={{
        maxWidth: 420, width: "100%", textAlign: "center", border: "var(--border)",
        borderRadius: 16, padding: "32px 28px", background: "var(--card)",
      }}>
        <div style={{ fontSize: 34, marginBottom: 10 }} aria-hidden="true">📶</div>
        <h1 style={{ fontSize: 18, fontWeight: 800, margin: "0 0 8px", color: "var(--text)" }}>Reconnecting…</h1>
        <p style={{ fontSize: 13.5, lineHeight: 1.5, color: "var(--muted)", margin: "0 0 18px" }}>
          We hit a brief hiccup reaching the database. You&apos;re still signed in — this
          will retry on its own in {secs}s.
        </p>
        <button onClick={() => location.reload()} style={{
          border: "none", borderRadius: 10, padding: "10px 18px", fontWeight: 700, fontSize: 13.5,
          background: "var(--accent)", color: "#fff", cursor: "pointer",
        }}>
          Retry now
        </button>
      </div>
    </div>
  );
}
