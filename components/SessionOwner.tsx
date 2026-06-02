"use client";

// SessionOwner — runs only on the TABLE OWNER's device when the v2 dining-session
// system is ON. It quietly polls the owner's own session and, the moment someone
// asks to join the table (a "pending" member), pops a small approve / deny prompt.
// It also lets the owner switch to "anyone can join automatically" for the rest of
// the meal.
//
// Why polling (every 5s) instead of Supabase Realtime: session_members has RLS with
// NO public read policy — guests only ever touch the lfh_* RPCs — so Realtime can't
// subscribe to it. Polling is the right fit here, and we keep it cheap: we only hit
// the network when an OWNER token actually exists and the tab is visible.

import { useCallback, useEffect, useRef, useState } from "react";
import { getSettings } from "@/lib/menu";
import {
  getStoredSession, clearStoredSession, getSessionState,
  approveMember, removeMember, setAutoApprove,
} from "@/lib/session";

interface PendingMember { id: string; name: string | null; }

const POLL_MS = 1500; // owner sees "X wants to join" within ~1.5s
const SNOOZE_MS = 20000; // "Later" hides the prompt briefly so the owner isn't trapped

export default function SessionOwner() {
  const [pending, setPending] = useState<PendingMember[]>([]);
  const [table, setTable] = useState("");
  const [busy, setBusy] = useState(false);
  const enabledRef = useRef(false);
  const tokenRef = useRef<string | null>(null);
  const snoozeUntil = useRef(0);

  // The owner's token, or null when this device isn't the table owner.
  const ownerToken = (): string | null => {
    const s = getStoredSession();
    return s && s.role === "owner" ? s.token : null;
  };

  const poll = useCallback(async () => {
    if (!enabledRef.current) return;
    if (typeof document !== "undefined" && document.hidden) return; // save battery in background tabs
    const token = ownerToken();
    tokenRef.current = token;
    if (!token) { setPending([]); return; }
    const state = await getSessionState(token);
    // Only forget the token if it's CONFIRMED dead — a network blip (ok:false with
    // any other reason) must not disconnect the head mid-meal.
    if (!state.ok) { if (state.reason === "invalid_token") { clearStoredSession(); setPending([]); } return; }
    const session = state.session as { table_number?: string; status?: string } | undefined;
    if (session?.status !== "open") { clearStoredSession(); setPending([]); return; } // meal ended
    setTable(session?.table_number || "");
    setPending((state.pending as PendingMember[]) || []);
  }, []);

  useEffect(() => {
    let alive = true;
    getSettings()
      .then((s) => { if (alive) { enabledRef.current = s.sessionsEnabled; if (s.sessionsEnabled) poll(); } })
      .catch(() => {});
    const id = setInterval(poll, POLL_MS);
    const onChanged = () => poll();                       // fired right after we become an owner
    const onVis = () => { if (!document.hidden) poll(); }; // refresh the instant the tab is reopened
    window.addEventListener("lfh:session-changed", onChanged);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      alive = false;
      clearInterval(id);
      window.removeEventListener("lfh:session-changed", onChanged);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [poll]);

  const visible = pending.length > 0 && Date.now() >= snoozeUntil.current;
  if (!visible) return null;

  const head = pending[0];

  const doApprove = async () => {
    const token = tokenRef.current; if (!token || busy) return;
    setBusy(true);
    await approveMember(token, head.id, head.name);
    setBusy(false);
    poll();
  };
  const doDeny = async () => {
    const token = tokenRef.current; if (!token || busy) return;
    setBusy(true);
    await removeMember(token, head.id);
    setBusy(false);
    poll();
  };
  const doAuto = async () => {
    const token = tokenRef.current; if (!token || busy) return;
    setBusy(true);
    await setAutoApprove(token, true);
    for (const m of pending) await approveMember(token, m.id, m.name); // clear the current queue too
    setBusy(false);
    poll();
  };
  const snooze = () => { snoozeUntil.current = Date.now() + SNOOZE_MS; setPending((p) => [...p]); };

  return (
    <div className="sg-overlay" onClick={snooze}>
      <div className="sg-box" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="sg-x" aria-label="Later" onClick={snooze}>✕</button>
        <div className="sg-emoji">🙋</div>
        <h3 className="sg-title">{head.name ? `${head.name} wants to join` : "Someone wants to join"}</h3>
        <p className="sg-sub">
          They&apos;re asking to join <b>table {table}</b>. Only let in people you&apos;re actually
          dining with — approved guests can order on your shared bill.
          {pending.length > 1 ? ` ${pending.length - 1} more waiting.` : ""}
        </p>
        <div className="sg-actions">
          <button className="sg-btn ghost" disabled={busy} onClick={doDeny}>Not them</button>
          <button className="sg-btn gold" disabled={busy} onClick={doApprove}>Let them in</button>
        </div>
        <div className="sg-links">
          <button className="sg-link" disabled={busy} onClick={doAuto}>Let anyone join automatically</button>
        </div>
      </div>
    </div>
  );
}
