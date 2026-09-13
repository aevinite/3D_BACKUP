"use client";
// components/admin/ShowPassword.tsx — "what is this person's password?", answered in one block
// (owner, 2026-09-13: "in owner panel owner detail there should be show pass same in the user panel").
//
// WHY ONE COMPONENT AND NOT THREE BLOCKS. The same question is now asked in three places — an
// owner's details, a user's profile, and a restaurant's handover card. The rules behind it are the
// ones you least want three slightly different copies of: what "covered" means, what happens when
// nothing was ever stored, and whether minting a new password throws people off their screens. So
// there is one block, it talks to one endpoint (/api/admin/reveal/password), and the three screens
// only decide where to put it.
//
// THE THREE THINGS IT HAS TO SAY APART, BECAUSE THEY LOOK THE SAME AND ARE NOT:
//   1. COVERED — there IS a password, the console just isn't uncovered. Type the admin password.
//   2. NEVER STORED — no readable copy has ever existed (the login predates migration 330, or the
//      vault key was rotated). Uncovering does nothing for this row; only minting a new password
//      does, and that is a real change to a live login, so it asks first.
//   3. HERE IT IS — shown, copyable, and it goes away by itself when the window runs out.
//
// WHAT IT WILL NOT DO. It never keeps the value in a ref, a cache or the URL, and it drops it the
// moment the uncover window closes — so a card left open on a second screen re-covers with
// everything else rather than holding the last thing anybody looked at.
import { useCallback, useEffect, useState } from "react";
import { adminFetch } from "@/lib/adminFetch";
import { CopyButton } from "@/components/admin/CopyButton";
import { RevealUnlock, useReveal } from "@/components/admin/useReveal";

const uuid = () => (crypto as { randomUUID?: () => string }).randomUUID?.() || String(Date.now()) + Math.random();
const mono: React.CSSProperties = { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" };

type Answer = { stored: true; password: string } | { stored: false };

export default function ShowPassword({ userId, name, onChanged, compact }: {
  userId: string;
  /** Only for the confirm wording — the server decides who this person actually is. */
  name: string;
  /** Called after a password is REPLACED, so the host list can re-read "last changed". */
  onChanged?: () => void;
  /** Inline version for a row of quick actions, vs. the full card. */
  compact?: boolean;
}) {
  const { unlocked, configured } = useReveal();
  const [ans, setAns] = useState<Answer | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  // Re-covering the console drops the value here too. Without this, a profile opened during the
  // window would keep a password on screen after every other card had covered up — the one hole
  // that would make the whole gate decorative.
  useEffect(() => { if (!unlocked) { setAns(null); setConfirming(false); setErr(null); } }, [unlocked]);
  // A different person selected in the same pane must never inherit the last one's answer.
  useEffect(() => { setAns(null); setConfirming(false); setErr(null); }, [userId]);

  const ask = useCallback(async (action?: "set", signOut?: boolean) => {
    setBusy(true); setErr(null); setConfirming(false);
    const r = await adminFetch<{ stored: boolean; password?: string }>("/api/admin/reveal/password", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-LFH-Action-Id": uuid() },
      body: JSON.stringify({ user_id: userId, ...(action ? { action, signOut: !!signOut } : {}) }),
    });
    setBusy(false);
    if (!r.ok) { setErr(r.error); return; }
    setAns(r.data.stored && r.data.password ? { stored: true, password: r.data.password } : { stored: false });
    if (action) onChanged?.();
  }, [userId, onChanged]);

  if (configured === false) return null;   // nothing to type on this deployment — say nothing here

  return (
    <div className={`sp${compact ? " sp-compact" : ""}`}>
      {!compact && (
        <div className="sp-h">
          <i className="fas fa-key" aria-hidden="true" />
          <b>Password</b>
        </div>
      )}

      {!unlocked ? (
        <RevealUnlock compact={compact} note={`Type the admin password to read ${name}'s password for 5 minutes.`} />
      ) : ans === null ? (
        <div className="sp-row">
          <button className="adm-btn" onClick={() => void ask()} disabled={busy}>
            <i className="fas fa-eye" style={{ marginRight: 7 }} aria-hidden="true" />
            {busy ? "Reading…" : "Show password"}
          </button>
          {!compact && <span className="hint">Stored encrypted — this is the only screen that can open it.</span>}
        </div>
      ) : ans.stored ? (
        <div className="sp-row">
          <code style={mono} className="sp-val">{ans.password}</code>
          <CopyButton className="adm-btn" style={{ fontSize: 12, padding: "5px 10px" }} text={ans.password} />
          <button className="adm-btn" onClick={() => setAns(null)} title="Cover it again">
            <i className="fas fa-eye-slash" style={{ marginRight: 7 }} aria-hidden="true" />Hide
          </button>
        </div>
      ) : (
        // NEVER STORED. The temptation is to write "couldn't read it", which sounds like a fault
        // somebody could go and fix. It is not a fault — the value was never written down, and the
        // only honest offer is a new one.
        <div className="sp-none">
          <p className="hint" style={{ margin: 0 }}>
            <i className="fas fa-circle-info" style={{ marginRight: 6 }} aria-hidden="true" />
            This password was set before Aevidine kept a readable copy, so nobody can read it back —
            not here, not anywhere. You can give {name} a new one.
          </p>
          {!confirming ? (
            <button className="adm-btn" onClick={() => setConfirming(true)} disabled={busy}>
              <i className="fas fa-key" style={{ marginRight: 7 }} aria-hidden="true" />Set a new password…
            </button>
          ) : (
            <div className="sp-confirm">
              <b style={{ fontSize: 13 }}>Give {name} a new password?</b>
              <p className="hint" style={{ margin: "2px 0 0" }}>
                Their old password stops working straight away. Choose whether their screens stay signed in.
              </p>
              <div className="sp-row" style={{ marginTop: 8 }}>
                <button className="adm-btn primary" disabled={busy} onClick={() => void ask("set", false)}
                  title="They stay signed in on every screen they have open">
                  Set it — keep them signed in
                </button>
                <button className="adm-btn danger" disabled={busy} onClick={() => void ask("set", true)}
                  title="Ends every session this person has open right now">
                  Set it and sign them out
                </button>
                <button className="adm-btn" disabled={busy} onClick={() => setConfirming(false)}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}

      {err && (
        <p role="alert" className="sp-err">
          <i className="fas fa-triangle-exclamation" style={{ marginRight: 6 }} aria-hidden="true" />{err}
        </p>
      )}

      <style jsx>{`
        .sp { display: grid; gap: 9px; }
        .sp:not(.sp-compact) {
          padding: 13px 14px; border: var(--border); border-radius: 12px; background: var(--bg);
        }
        .sp-h { display: flex; align-items: center; gap: 8px; font-size: 13px; }
        .sp-h :global(i) { opacity: .75; font-size: 12px; }
        .sp-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
        .sp-row :global(.adm-btn) { min-height: 38px; }
        .sp-val {
          padding: 7px 12px; border-radius: 8px; border: var(--border); background: var(--card);
          font-size: 14.5px; font-weight: 700; letter-spacing: .4px;
          /* Long enough to wrap on a phone rather than push the Copy button off the edge. */
          word-break: break-all; min-width: 0;
        }
        .sp-none { display: grid; gap: 9px; justify-items: start; }
        .sp-confirm {
          padding: 11px 12px; border: var(--border); border-radius: 10px; background: var(--card); width: 100%;
        }
        .sp-err { margin: 0; font-size: 12.5px; color: var(--adm-danger, #e5484d); }
        @media (max-width: 480px) {
          .sp-row { align-items: stretch; }
          .sp-row :global(.adm-btn) { flex: 1 1 auto; justify-content: center; }
          .sp-val { flex: 1 1 100%; }
        }
      `}</style>
    </div>
  );
}
