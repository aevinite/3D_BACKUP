"use client";
// The login card itself (client side, so it can read the JSON reply and route by
// role). Posts to /api/panel-login; on success redirects to the user's own panel.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { clearOwnerSnaps } from "@/lib/ownerSnap";
import BotTrap, { botFields } from "@/components/BotTrap";

// Must match the server's ROLE_HOME map (lib/panelGate.ts).
const ROLE_HOME: Record<string, string> = { owner: "/owner", manager: "/manager", kitchen: "/kitchen", tablet: "/tablet" };

// restaurantSlug/restaurantName come from the tenant-scoped door (/r/<slug>/login):
// the slug is posted so only THAT restaurant's staff can match, and the card shows
// the restaurant's own name instead of the platform brand.
// The only place a sign-in's ?next is trusted: same site, and inside the signed-in person's own panel.
function landingFor(next: string, home: string): string {
  if (!next || !home.startsWith("/") || typeof window === "undefined") return home;
  try {
    const u = new URL(next, window.location.origin);
    if (u.origin !== window.location.origin) return home;
    if (u.pathname !== home && !u.pathname.startsWith(home + "/")) return home;
    return u.pathname + u.search + u.hash;
  } catch {
    return home;
  }
}

export default function LoginForm({
  next, restaurantSlug, restaurantName, notice,
}: { next: string; restaurantSlug?: string; restaurantName?: string; notice?: string }) {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    // Read the invisible bot fields BEFORE the first await — after it, React has already
    // cleared currentTarget and this would silently send empty values (which the server treats
    // as "no opinion", so it would fail quietly rather than loudly).
    const bot = botFields(e.currentTarget as HTMLFormElement);
    try {
      const r = await fetch("/api/panel-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, ...bot, ...(restaurantSlug ? { restaurant: restaurantSlug } : {}) }),
      });
      // A reply that is not JSON came FROM the server (a platform timeout page, a crash) — the
      // device's internet is fine, so it must not be called a network error (sweep #10 T17, item 3).
      const data = await r.json().catch(() => null);
      if (!data) {
        setErr("The server didn\u2019t answer properly \u2014 try again in a moment.");
        setBusy(false);
        return;
      }
      if (!r.ok || !data.ok) {
        setErr(data.error || "That username and password don\u2019t match \u2014 check both and try again.");
        setBusy(false);
        return;
      }
      // A new sign-in starts with a clean slate of device snapshots, so the previous
      // account's instant-paint numbers can never show inside this tab.
      clearOwnerSnaps();
      // Same reasoning for the OFFLINE layer: a shared tablet handed to the next person
      // must not keep the last person's saved screens and figures readable with no
      // internet. (Signing out already wipes them inside public/sw.js; this covers the
      // case where the previous session simply expired or the tab was closed.)
      try { navigator.serviceWorker?.controller?.postMessage({ type: "LFH_CLEAR_DATA" }); } catch { /* best effort */ }
      // From the scoped door, land on the scoped panel URL so the address bar
      // keeps saying which restaurant this is.
      const base = ROLE_HOME[data.role];
      const home = base ? (restaurantSlug ? `/r/${restaurantSlug}${base}` : base) : "/menu";
      // Open-redirect guard: a ?next is honoured only inside THIS user's own panel (see landingFor).
      // WHERE TO LAND (sweep #10 T17 round 5, item 31, owner 2026-10-09). The old rule honoured ?next only when it was
      // EXACTLY the panel's home, so a deep link (an owner's bookmark to /owner/reports) always landed on the home page.
      // Now a ?next INSIDE this person's own panel is kept — resolved by the browser against this site, so only a path
      // on this site, under their own home, ever survives (never another site, never someone else's panel).
      const dest = landingFor(next, home);
      router.push(dest);
    } catch {
      setErr("Network error — please try again.");
      setBusy(false);
    }
  }

  // — styling: a warm, calm card on a dark backdrop; matches the app's tone —
  // The card is min(100%, 380px), not 92vw (sweep #10 T17, item 10): <main> keeps a 16px gutter, so 92vw came
  // out wider than the room at phone width and the card sat off-centre (13px gap on the right, 16 on the left).
  const field: React.CSSProperties = {
    width: "100%", boxSizing: "border-box", padding: "12px 14px", borderRadius: 12,
    border: "1px solid #2a3a5f", background: "#0b1220", color: "#eaf1ff", fontSize: 16, outline: "none",
  };

  // REJECTED (owner, 2026-08-13): the `minHeight: "100vh"` below stays — do NOT change it to
  // `100dvh`. Raised by the T12 phone sweep (on Android the card sits low and the on-screen
  // keyboard can cover "Sign in") and judged not a problem in practice: "i don't thing 7th is
  // problem". See docs/REJECTED-IDEAS.md R19.
  // (RECONSTRUCTED 2026-08-13 from the doc row after a parallel session's uncommitted edit
  // here was destroyed by a `git reset --hard` in this shared folder — the decision and the
  // quote are the owner's; the wording is not the original.)
  // THE PAGE SCROLLS BY ITSELF (owner, 2026-10-08, sweep #10 T17 item 18: "do all"). The app-wide stylesheet
  // locks html/body (`overflow: hidden`, app/globals.css) for the guest menu's own inner scrolling, so on a phone
  // held SIDEWAYS (780×360) this card — taller than the screen — had its Sign in half off-screen with no way to
  // reach it. <main> is now its own scroll box (height 100% + overflowY auto) and the card centres with
  // `margin: auto`, which can never push the card's top out of reach the way a centred overflow can.
  // This is NOT R19's change: minHeight stays 100vh exactly as the owner ruled; only scrolling was added.
  return (
    <main style={{ margin: 0, minHeight: "100vh", height: "100%", overflowY: "auto", display: "grid", placeItems: "center", background: "radial-gradient(1200px 600px at 50% -10%, #16223e 0%, #0b1220 60%)", color: "#dbe7ff", fontFamily: "system-ui, sans-serif", padding: 16 }}>
      <form onSubmit={submit} className="lfh-signin" style={{ margin: "auto", background: "#111a2e", border: "1px solid #1f2c49", borderRadius: 18, padding: 28, width: "min(100%, 380px)", boxShadow: "0 20px 60px rgba(0,0,0,.45)" }}>
        <div style={{ textAlign: "center", marginBottom: 18 }}>
          {/* REJECTED (owner, 2026-08-14): making this match /staff-login's SVG brand mark.
              The T11 visual sweep offered it as a "one product" consistency fix; he said
              "we don't need/require one i guess". The two sign-in doors keep their own marks.
              See docs/REJECTED-IDEAS.md R24 — do not re-offer this. */}
          <div style={{ fontSize: 30, letterSpacing: "0.04em" }}>✦</div>
          <h1 style={{ fontSize: 22, margin: "8px 0 2px", fontWeight: 800, letterSpacing: "0.02em" }}>{restaurantName || "Aevidine"}</h1>
          <p style={{ margin: 0, fontSize: 13, color: "#8aa0c9" }}>{restaurantName ? "Staff sign in" : "Restaurant OS · staff sign in"}</p>
        </div>

        {/* Item 19 (owner, 2026-10-08): a visible ring on the box the cursor is in. The boxes keep
            outline:none for the mouse; :focus-visible draws the ring for the keyboard (inline styles
            cannot express :focus, hence this one small rule). Item 20: each word is tied to its box
            (htmlFor/id), so tapping "Username" selects the box and screen readers read "Username". */}
        <style>{`.lfh-signin input:focus-visible{box-shadow:0 0 0 3px rgba(91,140,255,.55);border-color:#5b8cff!important}`}</style>
        {/* Item 30/33: why this person cannot go in right now (switched off / no longer available). One of a few fixed
            sentences chosen by the server — never text from the address bar. */}
        {notice ? <div role="status" style={{ margin: "0 0 14px", padding: "10px 12px", borderRadius: 10, background: "rgba(251,191,36,.12)", border: "1px solid rgba(251,191,36,.35)", color: "#fbbf24", fontSize: 13, lineHeight: 1.45 }}>{notice}</div> : null}
        <label htmlFor="lfh-login-username" style={{ fontSize: 12, color: "#8aa0c9" }}>Username</label>
        <input
          id="lfh-login-username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="your username"
          autoFocus
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          style={{ ...field, margin: "4px 0 12px" }}
        />

        <label htmlFor="lfh-login-password" style={{ fontSize: 12, color: "#8aa0c9" }}>Password</label>
        <div style={{ position: "relative", margin: "4px 0 4px" }}>
          <input
            id="lfh-login-password"
            type={show ? "text" : "password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="your password"
            autoComplete="current-password"
            style={{ ...field, paddingRight: 54 }}
          />
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: "transparent", border: 0, color: "#8aa0c9", fontSize: 12, cursor: "pointer", padding: 6 }}
          >
            {show ? "Hide" : "Show"}
          </button>
        </div>

        {err ? <div style={{ color: "#f87171", fontSize: 13, marginTop: 8 }}>{err}</div> : null}

        <button
          type="submit"
          disabled={busy || !username || !password}
          /* #2563eb, not #3b82f6: WHITE sits on this fill, and on blue-500 that measured 3.68:1 at 15px/700 — the primary action on the page every staff member starts at, under the floor in BOTH skins. Blue-600 is the same hue one step deeper: 5.17:1. The busy/blocked fills beside it already read 6.2–10.4:1. (T26 round 2, 2026-08-22.) */
          style={{ marginTop: 16, width: "100%", padding: 13, borderRadius: 12, border: 0, background: busy ? "#2747a0" : "#2563eb", color: "#fff", fontWeight: 700, fontSize: 15, cursor: busy ? "default" : "pointer", opacity: busy || !username || !password ? 0.7 : 1 }}
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>

        <p style={{ margin: "14px 0 0", fontSize: 12, color: "#6f86b0", textAlign: "center" }}>
          No account? Your manager or admin sets one up for you.
        </p>

        {/* LAST in the form, never first — and that placement is the whole point, not tidiness.
            Anything that reaches for "the first text box on the page" (a password manager's
            heuristic, an accessibility tool, a test script) would otherwise land in the trap and
            get a REAL person refused. Caught exactly that way in a browser on 2026-08-16.
            Invisible to a person, and the server ignores it entirely if it never arrives, so an
            old cached copy of this page still signs in fine. See lib/botCheck.ts. */}
        <BotTrap />
      </form>
    </main>
  );
}
