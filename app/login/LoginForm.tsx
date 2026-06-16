"use client";
// The login card itself (client side, so it can read the JSON reply and route by
// role). Posts to /api/panel-login; on success redirects to the user's own panel.
import { useState } from "react";
import { useRouter } from "next/navigation";

// Must match the server's ROLE_HOME map.
const ROLE_HOME: Record<string, string> = { manager: "/manager", kitchen: "/kitchen", tablet: "/tablet" };

export default function LoginForm({ next }: { next: string }) {
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
    try {
      const r = await fetch("/api/panel-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await r.json();
      if (!r.ok || !data.ok) {
        setErr(data.error || "Login failed.");
        setBusy(false);
        return;
      }
      const home = ROLE_HOME[data.role] || "/menu";
      // Open-redirect guard: only honour ?next if it points to THIS user's panel.
      const dest = next && next === home ? next : home;
      router.push(dest);
    } catch {
      setErr("Network error — please try again.");
      setBusy(false);
    }
  }

  // — styling: a warm, calm card on a dark backdrop; matches the app's tone —
  const field: React.CSSProperties = {
    width: "100%", boxSizing: "border-box", padding: "12px 14px", borderRadius: 12,
    border: "1px solid #2a3a5f", background: "#0b1220", color: "#eaf1ff", fontSize: 15, outline: "none",
  };

  return (
    <main style={{ margin: 0, minHeight: "100vh", display: "grid", placeItems: "center", background: "radial-gradient(1200px 600px at 50% -10%, #16223e 0%, #0b1220 60%)", color: "#dbe7ff", fontFamily: "system-ui, sans-serif", padding: 16 }}>
      <form onSubmit={submit} style={{ background: "#111a2e", border: "1px solid #1f2c49", borderRadius: 18, padding: 28, width: "min(92vw, 380px)", boxShadow: "0 20px 60px rgba(0,0,0,.45)" }}>
        <div style={{ textAlign: "center", marginBottom: 18 }}>
          <div style={{ fontSize: 30 }}>🏠</div>
          <h1 style={{ fontSize: 19, margin: "8px 0 2px", fontWeight: 800 }}>My Little French House</h1>
          <p style={{ margin: 0, fontSize: 13, color: "#8aa0c9" }}>Staff sign in</p>
        </div>

        <label style={{ fontSize: 12, color: "#8aa0c9" }}>Username</label>
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="your username"
          autoFocus
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          style={{ ...field, margin: "4px 0 12px" }}
        />

        <label style={{ fontSize: 12, color: "#8aa0c9" }}>Password</label>
        <div style={{ position: "relative", margin: "4px 0 4px" }}>
          <input
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
          style={{ marginTop: 16, width: "100%", padding: 13, borderRadius: 12, border: 0, background: busy ? "#2747a0" : "#3b82f6", color: "#fff", fontWeight: 700, fontSize: 15, cursor: busy ? "default" : "pointer", opacity: busy || !username || !password ? 0.7 : 1 }}
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>

        <p style={{ margin: "14px 0 0", fontSize: 12, color: "#6f86b0", textAlign: "center" }}>
          No account? Your manager or admin sets one up for you.
        </p>
      </form>
    </main>
  );
}
