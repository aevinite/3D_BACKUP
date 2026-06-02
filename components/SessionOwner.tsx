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

// React building blocks: useState remembers values, useEffect runs setup code,
// useRef keeps a value that survives re-draws, useCallback reuses a function.
import { useCallback, useEffect, useRef, useState } from "react";
// Reads the restaurant's on/off settings (e.g. is the session system turned on).
import { getSettings } from "@/lib/menu";
// Helpers that talk to the server about the table's dining session: read the
// state, approve/remove a guest, or flip on "let anyone join automatically".
import {
  getStoredSession, clearStoredSession, getSessionState,
  approveMember, removeMember, setAutoApprove,
} from "@/lib/session";

// One person waiting to be let in: their id and (optional) name.
interface PendingMember { id: string; name: string | null; }

const POLL_MS = 1500; // owner sees "X wants to join" within ~1.5s
const SNOOZE_MS = 20000; // "Later" hides the prompt briefly so the owner isn't trapped

// SessionOwner — only does anything on the TABLE HOST's device. It quietly checks
// the table over and over, and pops up an "approve / deny" card whenever someone
// new asks to join the host's table.
export default function SessionOwner() {
  // Tracks each piece of what this component needs:
  const [pending, setPending] = useState<PendingMember[]>([]); // people waiting to be let in
  const [table, setTable] = useState(""); // the host's table number, for the message
  const [busy, setBusy] = useState(false); // true while an approve/deny is in flight
  const enabledRef = useRef(false); // is the session system turned on?
  const tokenRef = useRef<string | null>(null); // the host's session token
  const snoozeUntil = useRef(0); // time until which we keep the prompt hidden ("Later")

  // The owner's token, or null when this device isn't the table owner.
  const ownerToken = (): string | null => {
    const s = getStoredSession();
    return s && s.role === "owner" ? s.token : null;
  };

  // Asks the server for the host's current table state and updates the waiting
  // list. We run this on a timer and also when certain events happen.
  const poll = useCallback(async () => {
    if (!enabledRef.current) return; // session system off — nothing to do
    if (typeof document !== "undefined" && document.hidden) return; // save battery in background tabs
    // Only the owner device has an owner token; without one, clear and stop.
    const token = ownerToken();
    tokenRef.current = token;
    if (!token) { setPending([]); return; }
    // Fetch the latest state for this session from the server.
    const state = await getSessionState(token);
    // Only forget the token if it's CONFIRMED dead — a network blip (ok:false with
    // any other reason) must not disconnect the head mid-meal.
    if (!state.ok) { if (state.reason === "invalid_token") { clearStoredSession(); setPending([]); } return; }
    const session = state.session as { table_number?: string; status?: string } | undefined;
    if (session?.status !== "open") { clearStoredSession(); setPending([]); return; } // meal ended
    // Remember the table number and the current list of people waiting to join.
    setTable(session?.table_number || "");
    setPending((state.pending as PendingMember[]) || []);
  }, []);

  // This runs once when the component first appears. It reads settings, then starts
  // polling on a timer and re-polls on session-change / when the tab is refocused.
  useEffect(() => {
    let alive = true; // guards against updating state after the component is gone
    // Find out if the session system is on; if so, do an immediate first poll.
    getSettings()
      .then((s) => { if (alive) { enabledRef.current = s.sessionsEnabled; if (s.sessionsEnabled) poll(); } })
      .catch(() => {});
    // Keep polling on a steady timer.
    const id = setInterval(poll, POLL_MS);
    const onChanged = () => poll();                       // fired right after we become an owner
    const onVis = () => { if (!document.hidden) poll(); }; // refresh the instant the tab is reopened
    window.addEventListener("lfh:session-changed", onChanged);
    document.addEventListener("visibilitychange", onVis);
    // Cleanup when the component disappears: stop the timer and remove listeners.
    return () => {
      alive = false;
      clearInterval(id);
      window.removeEventListener("lfh:session-changed", onChanged);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [poll]);

  // Only show the prompt when someone's waiting AND we're not in a "Later" snooze.
  const visible = pending.length > 0 && Date.now() >= snoozeUntil.current;
  if (!visible) return null;

  // The first person in the queue — that's who this prompt is about.
  const head = pending[0];

  // This runs when the host taps "Let them in": approve this person, then re-poll.
  const doApprove = async () => {
    const token = tokenRef.current; if (!token || busy) return;
    setBusy(true);
    await approveMember(token, head.id, head.name);
    setBusy(false);
    poll();
  };
  // This runs when the host taps "Not them": remove this person, then re-poll.
  const doDeny = async () => {
    const token = tokenRef.current; if (!token || busy) return;
    setBusy(true);
    await removeMember(token, head.id);
    setBusy(false);
    poll();
  };
  // This runs when the host taps "Let anyone join automatically": flip the
  // auto-approve switch, then approve everyone already waiting, then re-poll.
  const doAuto = async () => {
    const token = tokenRef.current; if (!token || busy) return;
    setBusy(true);
    await setAutoApprove(token, true);
    for (const m of pending) await approveMember(token, m.id, m.name); // clear the current queue too
    setBusy(false);
    poll();
  };
  // "Later"/close: hide the prompt for SNOOZE_MS so the host isn't trapped by it.
  // (Re-setting pending forces a re-draw so the hidden state takes effect now.)
  const snooze = () => { snoozeUntil.current = Date.now() + SNOOZE_MS; setPending((p) => [...p]); };

  // What the host sees: a small approve/deny card over a dimmed background.
  return (
    // Tapping the dimmed background snoozes the prompt.
    <div className="sg-overlay" onClick={snooze}>
      {/* The card itself — stopPropagation keeps taps inside from snoozing. */}
      <div className="sg-box" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        {/* The little X also snoozes ("Later"). */}
        <button type="button" className="sg-x" aria-label="Later" onClick={snooze}>✕</button>
        <div className="sg-emoji">🙋</div>
        <h3 className="sg-title">{head.name ? `${head.name} wants to join` : "Someone wants to join"}</h3>
        <p className="sg-sub">
          They&apos;re asking to join <b>table {table}</b>. Only let in people you&apos;re actually
          dining with — approved guests can order on your shared bill.
          {pending.length > 1 ? ` ${pending.length - 1} more waiting.` : ""}
        </p>
        {/* The two main choices: deny or approve this person. */}
        <div className="sg-actions">
          <button className="sg-btn ghost" disabled={busy} onClick={doDeny}>Not them</button>
          <button className="sg-btn gold" disabled={busy} onClick={doApprove}>Let them in</button>
        </div>
        {/* The shortcut to stop being asked for the rest of the meal. */}
        <div className="sg-links">
          <button className="sg-link" disabled={busy} onClick={doAuto}>Let anyone join automatically</button>
        </div>
      </div>
    </div>
  );
}
