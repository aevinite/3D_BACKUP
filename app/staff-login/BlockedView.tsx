"use client";
// Shown to a device the admin has BLOCKED from the admin panel. Explains the block, offers a Retry
// (re-checks — if the admin has since unblocked, it drops you back to the login form), and a capped
// "Request unblock" button (at most 3 per day per device, enforced server-side in /api/blocked).
// Deliberately calm and non-technical. Matches the dark staff-login styling.
import { useCallback, useEffect, useState } from "react";

type Status = { blocked: boolean; usedToday: number; remaining: number; pending: boolean };

export default function BlockedView() {
  const [status, setStatus] = useState<Status | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<"" | "retry" | "request">("");
  const [note, setNote] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/blocked", { headers: { Accept: "application/json" } });
      const d = (await r.json()) as Status;
      setStatus(d);
      if (!d.blocked) window.location.assign("/staff-login"); // unblocked → back to login
    } catch { /* keep last known state */ }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const retry = async () => {
    if (busy) return;
    setBusy("retry"); setNote(null);
    try {
      const r = await fetch("/api/blocked", { headers: { Accept: "application/json" } });
      const d = (await r.json()) as Status;
      setStatus(d);
      if (!d.blocked) { window.location.assign("/staff-login"); return; }
      setNote("Still blocked — the admin hasn't lifted it yet.");
    } catch {
      setNote("Couldn't reach the server — check your connection.");
    } finally { setBusy(""); }
  };

  const requestUnblock = async () => {
    if (busy) return;
    setBusy("request"); setNote(null);
    try {
      const r = await fetch("/api/blocked", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: message.trim() || undefined }),
      });
      const d = (await r.json()) as { ok?: boolean; reason?: string; remaining?: number };
      if (d.ok) {
        setSent(true); setMessage("");
        setStatus((s) => (s ? { ...s, remaining: d.remaining ?? 0, usedToday: s.usedToday + 1, pending: true } : s));
        setNote(`Request sent — the admin will review it.${typeof d.remaining === "number" ? ` · ${d.remaining} of 3 left today` : ""}`);
      } else if (d.reason === "limit") {
        setStatus((s) => (s ? { ...s, remaining: 0 } : s));
        setNote("You've used all 3 requests for today — please try again tomorrow.");
      } else if (d.reason === "not_blocked") {
        window.location.assign("/staff-login");
      } else {
        setNote("Couldn't send your request — please try again.");
      }
    } catch {
      setNote("Couldn't reach the server — check your connection.");
    } finally { setBusy(""); }
  };

  const remaining = status?.remaining ?? 3;
  const outOfTries = remaining <= 0;

  return (
    <div style={{ background: "#111a2e", border: "1px solid #1f2c49", borderRadius: 16, padding: 26, width: "min(94vw, 380px)", maxHeight: "92vh", overflowY: "auto" }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, marginBottom: 14, textAlign: "center" }}>
        <div style={{ width: 56, height: 56, borderRadius: 999, background: "rgba(248,113,113,0.14)", display: "grid", placeItems: "center" }}>
          <i className="fas fa-ban" aria-hidden="true" style={{ color: "#f87171", fontSize: 26 }} />
        </div>
        <div>
          <div style={{ fontSize: 19, fontWeight: 800 }}>You’re blocked</div>
          <div style={{ fontSize: 13, color: "#8aa0c6", marginTop: 4, lineHeight: 1.5 }}>
            This device can’t open the admin panel right now. If you think this is a mistake, you can
            ask the admin to let you back in.
          </div>
        </div>
      </div>

      <button onClick={retry} disabled={busy === "retry"}
        style={{ width: "100%", padding: 12, borderRadius: 10, border: "1px solid #2a3a5f", background: "#0b1220", color: "#dbe7ff", fontWeight: 700, fontSize: 14.5, cursor: busy ? "default" : "pointer" }}>
        <i className={`fas fa-rotate-right${busy === "retry" ? " fa-spin" : ""}`} aria-hidden="true" style={{ marginRight: 8 }} />
        {busy === "retry" ? "Checking…" : "Retry"}
      </button>

      <div style={{ height: 1, background: "#1f2c49", margin: "18px 0 14px" }} />

      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>Request to be unblocked</div>
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value.slice(0, 200))}
        placeholder="Optional: a short note for the admin (e.g. who you are)"
        rows={3}
        disabled={outOfTries}
        style={{ width: "100%", boxSizing: "border-box", padding: 10, borderRadius: 10, border: "1px solid #2a3a5f", background: "#0b1220", color: "#dbe7ff", fontSize: 14, resize: "vertical", opacity: outOfTries ? 0.5 : 1 }}
      />
      <button onClick={requestUnblock} disabled={busy === "request" || outOfTries}
        style={{ marginTop: 10, width: "100%", padding: 12, borderRadius: 10, border: 0, background: outOfTries ? "#334155" : busy === "request" ? "#2f5fb0" : "#3b82f6", color: "#fff", fontWeight: 700, fontSize: 14.5, cursor: busy || outOfTries ? "default" : "pointer" }}>
        {busy === "request" ? "Sending…" : sent ? "Send another request" : "Request unblock"}
      </button>

      {note ? (
        <div style={{ marginTop: 10, fontSize: 12.5, color: outOfTries ? "#fbbf24" : "#8aa0c6", textAlign: "center", lineHeight: 1.5 }}>{note}</div>
      ) : (
        <div style={{ marginTop: 10, fontSize: 12, color: "#64748b", textAlign: "center" }}>
          You can send up to 3 requests a day{status ? ` · ${remaining} left today` : ""}.
        </div>
      )}
    </div>
  );
}
