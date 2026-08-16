"use client";
// Client login form for the shared admin/staff password. Submits via fetch so it can, on a
// wrong password: KEEP what you typed (no wipe), show "N attempts left", and auto-clear the
// "Wrong password" message after 3s instead of leaving it stuck. A no-JS browser still works
// via the plain <form> POST fallback (the route redirects with ?bad=1 / ?locked=1).
import { useEffect, useRef, useState } from "react";
import BotTrap, { botFields } from "@/components/BotTrap";
import { BOT_TRAP_FIELD, BOT_ELAPSED_FIELD } from "@/lib/botCheck";

type Err = { kind: "wrong" | "locked" | "network"; attemptsLeft?: number } | null;

export default function LoginForm({ next, initialError }: { next: string; initialError: Err }) {
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<Err>(initialError);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // "Wrong password" auto-dismisses after 3s (owner 2026-07-26) — it shouldn't just sit there.
  // A lockout message stays put (you genuinely have to wait).
  useEffect(() => {
    if (err?.kind !== "wrong") return;
    const t = setTimeout(() => setErr((e) => (e?.kind === "wrong" ? null : e)), 3000);
    return () => clearTimeout(t);
  }, [err]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    // Read before the first await — after it, currentTarget is gone.
    const bot = botFields(e.currentTarget as HTMLFormElement);
    try {
      const r = await fetch("/api/staff-login", {
        method: "POST",
        headers: { Accept: "application/json" },
        // The fetch path posts url-encoded, so the two fields go under their real form names —
        // exactly what the no-JS <form> POST would have sent. One shape for the route to read.
        body: new URLSearchParams({ password, next, [BOT_TRAP_FIELD]: bot.trap, [BOT_ELAPSED_FIELD]: bot.elapsed }),
      });
      const data = (await r.json().catch(() => ({}))) as { ok?: boolean; next?: string; locked?: boolean; attemptsLeft?: number };
      if (data.ok) { window.location.assign(data.next || next); return; }
      // Keep the typed password so they can just fix a typo — don't wipe the field.
      setErr(data.locked ? { kind: "locked" } : { kind: "wrong", attemptsLeft: data.attemptsLeft });
      inputRef.current?.focus();
      inputRef.current?.select();
    } catch {
      setErr({ kind: "network" });
    } finally {
      setBusy(false);
    }
  };

  const msg =
    err?.kind === "locked" ? "Too many wrong tries — wait a few minutes and try again."
    : err?.kind === "network" ? "Couldn't reach the server — check your connection and try again."
    : err?.kind === "wrong" ? "Wrong password — try again."
    : null;

  return (
    <form onSubmit={submit} method="POST" action="/api/staff-login"
      style={{ background: "#111a2e", border: "1px solid #1f2c49", borderRadius: 16, padding: 28, width: "min(92vw, 360px)" }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, marginBottom: 18 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {/* REJECTED (owner, 2026-08-14): unifying this with the text ✦ that /login draws.
            Offered by the T11 visual sweep as a brand-consistency fix and declined —
            docs/REJECTED-IDEAS.md R24. Do not re-offer. */}
        <img src="/brand/aevidine-mark.svg" alt="Aevidine" width={48} height={48} />
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: 0.2 }}>Aevidine</div>
          {/* THIS DOOR IS THE ADMIN CONSOLE, AND IT NOW SAYS SO (owner, 2026-08-13). It used to
              read "Restaurant OS · staff sign in" — the SAME line /login shows — while asking for
              a single password and no username. A waiter who landed here saw a door that claimed
              to be theirs, had nowhere to type their username, and refused their password. The
              two doors are told apart by their words now, and the link below sends a person who
              took the wrong one to the right one instead of leaving them stuck. */}
          <div style={{ fontSize: 12.5, color: "#8aa0c6" }}>Restaurant OS · admin console</div>
        </div>
      </div>
      <input type="hidden" name="next" value={next} />
      <input
        ref={inputRef}
        type="password"
        name="password"
        placeholder="Password"
        autoFocus
        autoComplete="current-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        style={{ width: "100%", boxSizing: "border-box", padding: 12, borderRadius: 10, border: "1px solid #2a3a5f", background: "#0b1220", color: "#dbe7ff", fontSize: 16 }}
      />
      {msg ? (
        <div style={{ color: err?.kind === "locked" ? "#fbbf24" : "#f87171", fontSize: 13, marginTop: 8 }}>
          {msg}
          {/* Attempts-left warning once you've started missing (owner 2026-07-26). */}
          {err?.kind === "wrong" && typeof err.attemptsLeft === "number" ? (
            <span style={{ display: "block", color: "#fbbf24", fontSize: 12.5, marginTop: 3 }}>
              {err.attemptsLeft} {err.attemptsLeft === 1 ? "attempt" : "attempts"} left before a temporary lock.
            </span>
          ) : null}
        </div>
      ) : null}
      <button type="submit" disabled={busy}
        style={{ marginTop: 12, width: "100%", padding: 12, borderRadius: 10, border: 0, background: busy ? "#2f5fb0" : "#3b82f6", color: "#fff", fontWeight: 700, fontSize: 15, cursor: busy ? "default" : "pointer" }}>
        {busy ? "Checking…" : "Enter"}
      </button>
      {/* The way out for someone who took the wrong door. It is a plain link, not a redirect:
          an admin who bookmarked this page must still land here. */}
      <a href="/login" style={{ display: "block", marginTop: 14, textAlign: "center", fontSize: 12.5, color: "#8aa0c6", textDecoration: "none" }}>
        Staff sign in →
      </a>

      {/* LAST in the form — see the note on the same component in app/login/LoginForm.tsx for why
          first would be a real hazard. These ride the no-JS <form> POST too, because they are
          ordinary inputs inside this form, so the fallback keeps working either way. */}
      <BotTrap />
    </form>
  );
}
