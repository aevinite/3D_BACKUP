"use client";
// Shown by the owner layout when the auth lookup hits a TRANSIENT database error
// (AuthDbError) — a blip is NOT "logged out", so we must never bounce the owner to
// /login. Instead we hold their session, show a calm "reconnecting" card, and retry
// automatically. Mirrors the gate rule in lib/userAuth.ts (DB blip → 503-retry).
import { useEffect, useState } from "react";

// Each retry reloads the whole page, so we can't hold an attempt counter in React state —
// keep it in sessionStorage. The delay backs off 3s → 6s → 12s → 24s → 30s (capped) so a
// SUSTAINED outage doesn't become a reload storm every 3s (audit 2026-07-07). OwnerShell
// clears this key on a successful load, so the next outage starts fresh at 3s.
const ATTEMPTS_KEY = "owner_reconnect_attempts";

export default function OwnerReconnecting() {
  // THE COUNTER IS BUMPED WHEN WE ACTUALLY RETRY, NOT WHILE WORKING OUT THE WAIT (T17 sweep,
  // 2026-09-04). Both halves used to sit inside this `useState` initializer — a READ and a WRITE.
  // React requires an initializer to be pure and in development deliberately renders twice to
  // catch exactly this, so the stored attempt count went up TWICE per reconnect screen and the
  // ladder climbed 3s → 12s → 30s instead of 3s → 6s → 12s → 24s → 30s: after two blips the owner
  // waited half a minute for a retry that was designed to come in six seconds. A production build
  // runs it once, so this was a development-only wrong number — but this is the third time this
  // file's own family has been caught doing work in a place React may call twice (see the same
  // note over `toggleSkin` in OwnerShell, T12 sweep), and an impure initializer is a writer nobody
  // can count. The read stays here (it is pure); the write moved next to `location.reload()`,
  // which is the moment an attempt genuinely happens.
  const [delay] = useState(() => {
    let a = 0;
    try { a = Number(sessionStorage.getItem(ATTEMPTS_KEY)) || 0; } catch {}
    return Math.min(3000 * 2 ** a, 30000);
  });
  // BOTH ways of retrying count, exactly as they did before: the timer below and the button at the
  // bottom of the card. If only the timer counted, someone tapping "Retry now" through a sustained
  // outage would sit at 3s for ever and the storm guard would be gone for the one person able to
  // cause a storm by hand.
  const retryNow = () => {
    try {
      const a = Number(sessionStorage.getItem(ATTEMPTS_KEY)) || 0;
      sessionStorage.setItem(ATTEMPTS_KEY, String(a + 1));
    } catch { /* a counter we cannot store just means the next wait starts at 3s again */ }
    location.reload();
  };
  const [secs, setSecs] = useState(Math.ceil(delay / 1000));
  // Follow the owner's chosen skin instead of a hardcoded dark hex (which clashed for
  // a light-mode owner). We render inside `.adm.owx` so the same CSS tokens the panel
  // defines (--bg / --card / --text / --muted / --accent …) resolve here too, then
  // read the persisted preference on mount. Defaults to dark on the SSR pass (no
  // localStorage) — a harmless one-frame default on a transient retry screen.
  const [skin, setSkin] = useState<"light" | "dark">("dark");
  useEffect(() => {
    try { const s = localStorage.getItem("aevidine_skin"); if (s === "light" || s === "dark") setSkin(s); } catch {}
    const tick = setInterval(() => setSecs((s) => (s > 0 ? s - 1 : 0)), 1000);
    // ONE attempt = one bump, recorded the instant we make it. StrictMode mounts this effect twice
    // in development, but the first mount's cleanup clears its timeout, so exactly one ever fires.
    const go = setTimeout(retryNow, delay);
    return () => { clearInterval(tick); clearTimeout(go); };
  }, [delay]);
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
        <button onClick={retryNow} style={{
          border: "none", borderRadius: 10, padding: "10px 18px", fontWeight: 700, fontSize: 13.5,
          background: "var(--accent)", color: "#fff", cursor: "pointer",
        }}>
          Retry now
        </button>
      </div>
    </div>
  );
}
