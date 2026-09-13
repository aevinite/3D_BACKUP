"use client";
// components/admin/useReveal.tsx — the one "passwords are covered" control (owner, 2026-09-13).
//
// WHAT IT IS. Three screens now show somebody else's password — a restaurant's handover card, an
// owner's details, a user's details. Each of them asks the SAME question ("is the console uncovered
// right now?") and offers the SAME box ("type the admin password"). One hook, one component, so the
// three can never drift into three different ideas of what covered means.
//
// HOW IT BEHAVES, AND WHY EACH CHOICE:
//   · ONE SHARED STATE FOR THE WHOLE CONSOLE. The unlock lives in an HttpOnly cookie the server
//     sets, so it is already shared — but three cards each polling for it would each show a
//     different countdown a second apart. A tiny module-level store keeps them in step and means
//     opening a second card costs no extra request.
//   · IT COUNTS DOWN IN THE OPEN. He can see it has four minutes left, so re-covering never feels
//     like the screen broke. At thirty seconds the chip turns amber — the "is it about to happen"
//     warning that stops a surprise mid-sentence on the phone to a client.
//   · IT RE-COVERS ITSELF WITHOUT A REQUEST. The expiry came from the server inside a signed token;
//     when the clock passes it, every card covers up at once. The server has already stopped
//     honouring it, so this is the screen agreeing with the server, not deciding for it.
//   · REDUCED MOTION IS RESPECTED. The only movement is the countdown's own digits.
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { adminFetch } from "@/lib/adminFetch";

export type RevealState = {
  /** null = not asked yet. Keeps the card from flashing "covered" before the first answer lands. */
  configured: boolean | null;
  unlocked: boolean;
  /** epoch ms the unlock runs out, or null. */
  until: number | null;
};

let state: RevealState = { configured: null, unlocked: false, until: null };
const listeners = new Set<() => void>();
let inflight: Promise<void> | null = null;

function set(next: RevealState) {
  state = next;
  for (const l of listeners) l();
}
function subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }
const snapshot = () => state;
// The server has no idea about any of this, and a server render that guessed "unlocked" would paint
// a password-shaped box for a frame. Covered is the only safe first paint.
//
// ONE FROZEN OBJECT, NOT A FRESH ONE PER CALL. useSyncExternalStore compares snapshots by identity,
// so `() => ({ ... })` hands back a different object every render and React never settles —
// "The result of getServerSnapshot should be cached to avoid an infinite loop", which is exactly
// what the admin sweep caught this doing on /aevinite/people and /aevinite/users (2026-09-13).
const SERVER_STATE: RevealState = Object.freeze({ configured: null, unlocked: false, until: null });
const serverSnapshot = (): RevealState => SERVER_STATE;

/** Ask the server where we stand. De-duplicated, so three cards mounting together make ONE request. */
async function refresh(): Promise<void> {
  if (inflight) return inflight;
  inflight = (async () => {
    const r = await adminFetch<{ configured: boolean; unlocked: boolean; until: number | null }>("/api/admin/reveal");
    // A failed read must not claim "uncovered". It also must not claim "no password is configured",
    // which would replace the unlock box with a dead-end sentence — so `configured` stays true and
    // the person can still try, which is the recoverable direction.
    if (r.ok) set({ configured: r.data.configured, unlocked: r.data.unlocked, until: r.data.until });
    else set({ configured: true, unlocked: false, until: null });
  })().finally(() => { inflight = null; });
  return inflight;
}

export function useReveal() {
  const s = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const asked = useRef(false);
  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    if (state.configured === null) void refresh();
  }, []);

  // Re-cover the moment the window passes, without asking the server. One timer per mounted card is
  // fine — they all land on the same instant and the first one to fire updates the shared state.
  useEffect(() => {
    if (!s.unlocked || !s.until) return;
    const ms = s.until - Date.now();
    if (ms <= 0) { set({ ...state, unlocked: false, until: null }); return; }
    const t = window.setTimeout(() => set({ ...state, unlocked: false, until: null }), ms);
    return () => window.clearTimeout(t);
  }, [s.unlocked, s.until]);

  const unlock = useCallback(async (password: string): Promise<{ ok: true } | { ok: false; error: string }> => {
    const r = await adminFetch<{ until: number }>("/api/admin/reveal", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (!r.ok) return { ok: false, error: r.error };
    set({ configured: true, unlocked: true, until: r.data.until });
    return { ok: true };
  }, []);

  const lock = useCallback(async () => {
    set({ ...state, unlocked: false, until: null });   // cover the screen first, then tell the server
    await adminFetch("/api/admin/reveal", { method: "DELETE" });
  }, []);

  return { ...s, unlock, lock, refresh };
}

/** mm:ss left, for the chip. */
export function useCountdown(until: number | null): string {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!until) return;
    const i = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => window.clearInterval(i);
  }, [until]);
  if (!until) return "";
  const s = Math.max(0, Math.round((until - Date.now()) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * The box itself. Drop it wherever a password would otherwise be.
 *
 * `compact` is the inline version that sits in a table row; the full one is a panel with the
 * explanation, for the top of a card.
 */
export function RevealUnlock({ compact, onDone, note }: { compact?: boolean; onDone?: () => void; note?: string }) {
  const { configured, unlock } = useReveal();
  const [pw, setPw] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const go = async () => {
    if (!pw || busy) return;
    setBusy(true); setErr(null);
    const r = await unlock(pw);
    setBusy(false);
    if (r.ok) { setPw(""); setShow(false); onDone?.(); }
    else {
      setErr(r.error);
      setPw("");
      // Focus back on the field so a mistype is one keystroke from being fixed, not a hunt for the
      // box (WCAG focus-management: after a failed submit, land on the field that failed).
      inputRef.current?.focus();
    }
  };

  if (configured === false) {
    return (
      <p className="hint" style={{ margin: 0, color: "var(--adm-warn)" }}>
        <i className="fas fa-circle-info" style={{ marginRight: 6 }} aria-hidden="true" />
        No admin password is set on this deployment, so passwords can&rsquo;t be uncovered here.
      </p>
    );
  }

  return (
    <div className={`rv-unlock${compact ? " rv-compact" : ""}`}>
      {!compact && (
        <div className="rv-lede">
          <i className="fas fa-lock" aria-hidden="true" />
          <div>
            <b>Passwords are covered</b>
            <p className="hint" style={{ margin: "2px 0 0" }}>
              {note || "Type the admin password — the same one you signed in with — to uncover them for 5 minutes."}
            </p>
          </div>
        </div>
      )}
      <div className="rv-row">
        {/* An explicit label, not a placeholder standing in for one (Forms → input-labels). Visually
            hidden in the compact version, where the lock icon and the button already say what it is. */}
        <label className={compact ? "rv-sr" : "rv-lab"} htmlFor="rv-pw">Admin password</label>
        <div className="rv-field">
          <input
            id="rv-pw" ref={inputRef} type={show ? "text" : "password"} value={pw} autoComplete="current-password"
            onChange={(e) => { setPw(e.target.value); if (err) setErr(null); }}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void go(); } }}
            disabled={busy} placeholder="Admin password"
            aria-invalid={err ? true : undefined} aria-describedby={err ? "rv-err" : undefined}
          />
          {/* Show/hide — a person typing a password they cannot see mistypes it, and the wall here
              is five tries (UX: Forms → Password Visibility). */}
          <button type="button" className="rv-eye" onClick={() => setShow((v) => !v)}
            aria-label={show ? "Hide the password" : "Show the password"} title={show ? "Hide" : "Show"}>
            <i className={`fas fa-${show ? "eye-slash" : "eye"}`} aria-hidden="true" />
          </button>
        </div>
        <button className="adm-btn primary" onClick={go} disabled={busy || !pw}>
          <i className="fas fa-lock-open" style={{ marginRight: 7 }} aria-hidden="true" />
          {busy ? "Checking…" : "Uncover"}
        </button>
      </div>
      {err && (
        // role="alert" so a screen reader is told, and it sits directly under the field it is about
        // (Forms → error-placement / aria-live-errors).
        <p id="rv-err" role="alert" className="rv-err">
          <i className="fas fa-triangle-exclamation" style={{ marginRight: 6 }} aria-hidden="true" />{err}
        </p>
      )}
      <style jsx>{`
        .rv-unlock { display: grid; gap: 10px; }
        .rv-lede { display: flex; gap: 11px; align-items: flex-start; }
        .rv-lede > :global(i) { font-size: 15px; opacity: .75; margin-top: 2px; }
        .rv-lab { font-size: 12px; color: var(--muted); font-weight: 600; }
        .rv-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
        .rv-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
        .rv-lab + .rv-field { flex: 1 1 200px; }
        .rv-field { position: relative; flex: 1 1 200px; min-width: 0; display: flex; }
        .rv-field input {
          box-sizing: border-box; width: 100%; min-height: 44px; padding: 10px 42px 10px 12px;
          border-radius: 10px; border: var(--border); background: var(--bg); color: var(--text);
          /* 16px keeps iOS from zooming the whole console when the field takes focus. */
          font-size: 16px;
        }
        .rv-field input:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
        .rv-eye {
          position: absolute; right: 2px; top: 50%; transform: translateY(-50%);
          width: 40px; height: 40px; display: grid; place-items: center;
          background: none; border: 0; color: var(--muted); cursor: pointer; border-radius: 8px;
        }
        .rv-eye:hover { color: var(--text); }
        .rv-eye:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
        .rv-err { margin: 0; font-size: 12.5px; color: var(--adm-danger, #e5484d); }
        .rv-unlock :global(.adm-btn) { min-height: 44px; }
        @media (max-width: 520px) {
          .rv-row { flex-direction: column; align-items: stretch; }
          .rv-field, .rv-lab + .rv-field { flex: 1 1 auto; }
        }
      `}</style>
    </div>
  );
}

/** The little "uncovered · 4:12 · Cover them" chip that sits in a card header while a window is open. */
export function RevealChip() {
  const { unlocked, until, lock } = useReveal();
  const left = useCountdown(until);
  if (!unlocked) return null;
  // Under 30 seconds it goes amber, so re-covering is never a surprise mid-sentence.
  const soon = !!until && until - Date.now() < 30_000;
  return (
    <span className="rv-chip" style={{ borderColor: soon ? "var(--adm-warn)" : "var(--border-c, var(--muted))" }}>
      <i className="fas fa-lock-open" aria-hidden="true" style={{ color: soon ? "var(--adm-warn)" : "var(--adm-ok, #34d399)" }} />
      <span>Uncovered</span>
      {/* Tabular figures so the countdown doesn't nudge the row every second. */}
      <b style={{ fontVariantNumeric: "tabular-nums" }}>{left}</b>
      <button type="button" onClick={() => void lock()} title="Cover the passwords again now">Cover</button>
      <style jsx>{`
        .rv-chip {
          display: inline-flex; align-items: center; gap: 7px; padding: 5px 6px 5px 10px;
          border: 1px solid; border-radius: 999px; font-size: 12px; color: var(--muted);
          background: var(--bg);
        }
        .rv-chip b { color: var(--text); font-size: 12px; }
        .rv-chip button {
          background: none; border: 0; color: var(--accent); font-weight: 700; font-size: 12px;
          cursor: pointer; padding: 4px 8px; border-radius: 999px; min-height: 28px;
        }
        .rv-chip button:hover { background: color-mix(in srgb, var(--accent) 14%, transparent); }
        .rv-chip button:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
      `}</style>
    </span>
  );
}
