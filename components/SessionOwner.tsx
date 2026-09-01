"use client";
import { useRestaurantId } from "@/lib/restaurant-context";

// SessionOwner — runs only on the TABLE OWNER's device when the v2 dining-session
// system is ON. It quietly polls the owner's own session and, the moment someone
// asks to join the table (a "pending" member), pops a small approve / deny prompt.
// It also lets the owner switch to "anyone can join automatically" for the rest of
// the meal.
//
// Realtime is the FAST path: a partner joining drops a breadcrumb on the head's
// `table:<n>` topic (migration 059), which fires `lfh:rt-tick` here → instant refetch.
// But approving a waiting partner is time-sensitive, so the backup poll is kept
// TIGHT (a few seconds, not the usual 60s) to catch any realtime lapse quickly. It's
// cheap: only the OWNER device, only while it actually holds an owner token + visible.

// React building blocks: useState remembers values, useEffect runs setup code,
// useRef keeps a value that survives re-draws, useCallback reuses a function.
import { useCallback, useEffect, useRef, useState } from "react";
// Hardware back-button manager: registers this popup as a "layer" so the phone
// back button closes IT instead of quitting the site (CLAUDE.md rule).
import { useBackClose } from "@/lib/backStack";
// Reads the restaurant's on/off settings (e.g. is the session system turned on).
import { getSettings } from "@/lib/menu";
// Helpers that talk to the server about the table's dining session: read the
// state, approve/remove a guest, or flip on "let anyone join automatically".
import {
  getStoredSession, clearStoredSession, getSessionState,
  approveMember, removeMember, setAutoApprove,
} from "@/lib/session";
// Tight backup poll for the head's join-approval prompt (realtime is the instant
// path; this catches any lapse fast because a partner is waiting to be let in).
const OWNER_POLL_MS = 4000;

// One person waiting to be let in: their id and (optional) name.
interface PendingMember { id: string; name: string | null; }

const SNOOZE_MS = 20000; // "Later" hides the prompt briefly so the owner isn't trapped

// SessionOwner — only does anything on the TABLE HOST's device. It quietly checks
// the table over and over, and pops up an "approve / deny" card whenever someone
// new asks to join the host's table.
export default function SessionOwner() {
  const restaurantId = useRestaurantId();
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
    getSettings(restaurantId)
      .then((s) => { if (alive) { enabledRef.current = s.sessionsEnabled; if (s.sessionsEnabled) poll(); } })
      .catch(() => {});
    // Realtime nudges drive instant refetches; this TIGHT 4s timer is the backup so
    // a waiting partner's request never lingers unseen if realtime briefly lapses.
    const id = setInterval(poll, OWNER_POLL_MS);
    const onChanged = () => poll();                       // fired right after we become an owner
    const onTick = () => poll();                          // realtime breadcrumb for this table
    const onVis = () => { if (!document.hidden) poll(); }; // refresh the instant the tab is reopened
    window.addEventListener("lfh:session-changed", onChanged);
    window.addEventListener("lfh:rt-tick", onTick);
    document.addEventListener("visibilitychange", onVis);
    // Cleanup when the component disappears: stop the timer and remove listeners.
    return () => {
      alive = false;
      clearInterval(id);
      window.removeEventListener("lfh:session-changed", onChanged);
      window.removeEventListener("lfh:rt-tick", onTick);
      document.removeEventListener("visibilitychange", onVis);
    };
    // restaurantId is in the deps: the global widgets resolve their restaurant
    // ASYNCHRONOUSLY (RestaurantProvider starts at #1, then fixes itself once the
    // /r/<slug> lookup lands — React runs child effects before the parent's). Without
    // restaurantId here, this effect read restaurant #1's sessions_enabled and cached
    // it forever, so on a NON-#1 restaurant the host's approval poll never started and
    // a guest asking to join waited forever (owner: "guest stuck at the menu"). Now it
    // re-runs the instant the real id arrives. (poll has no deps, so it's stable.)
  }, [poll, restaurantId]);

  // "Later"/close: hide the prompt for SNOOZE_MS so the host isn't trapped by it.
  // (Re-setting pending forces a re-draw so the hidden state takes effect now.)
  // Defined BEFORE the back-button hook + early return so the hook can reference it
  // and is always called unconditionally (Rules of Hooks).
  const snooze = () => { snoozeUntil.current = Date.now() + SNOOZE_MS; setPending((p) => [...p]); };

  // Only show the prompt when someone's waiting AND we're not in a "Later" snooze.
  const visible = pending.length > 0 && Date.now() >= snoozeUntil.current;
  // Register with the hardware back-button manager (CLAUDE.md rule: EVERY overlay must
  // register, or the phone back button skips it and quits the site). Called every render,
  // self-noops while not visible; a back press "closes" this popup by snoozing it — the
  // same as tapping the ✕ / backdrop — instead of falling through to the exit guard.
  useBackClose("session-owner", visible, snooze);
  if (!visible) return null;

  // The first person in the queue — that's who this prompt is about.
  const head = pending[0];

  // A TAP HERE MUST NEVER VANISH IN SILENCE (sweep 7 T3).
  //
  // All three handlers used to throw the answer away. None of these calls throws — a timeout comes
  // back as { ok:false, reason:"timed_out" } — so when one failed, the prompt simply stayed with
  // the same person still first in the queue, and the head tapped "Let them in" again, and again,
  // with nothing on screen ever explaining why their friend was not getting in.
  //
  // The prompt STAYING is the right behaviour (the person really is still waiting); the sentence is
  // what was missing.
  const say = (msg: string) =>
    window.dispatchEvent(new CustomEvent("lfh:toast", { detail: { message: msg, kicker: "table", variant: "error" } }));
  // The one refusal these three can actually give is not_owner (mig 015) — this device is no longer
  // the head, because staff moved the table or the meal ended. That is not "try again in a moment",
  // so it gets its own sentence; the poll straight after will take the prompt away by itself.
  const whyFailed = (r: { ok?: boolean; reason?: string } | undefined, tryAgain: string): string =>
    r?.reason === "not_owner" ? "You're not the host of this table any more." : tryAgain;

  // This runs when the host taps "Let them in": approve this person, then re-poll.
  const doApprove = async () => {
    const token = tokenRef.current; if (!token || busy) return;
    setBusy(true);
    const r = await approveMember(token, head.id, head.name);
    setBusy(false);
    if (r?.ok !== true) say(whyFailed(r, "We couldn't let them in just now — please try again in a moment."));
    poll();
  };
  // This runs when the host taps "Not them": remove this person, then re-poll.
  const doDeny = async () => {
    const token = tokenRef.current; if (!token || busy) return;
    setBusy(true);
    const r = await removeMember(token, head.id);
    setBusy(false);
    if (r?.ok !== true) say(whyFailed(r, "We couldn't turn that request down just now — please try again in a moment."));
    poll();
  };
  // This runs when the host taps "Let anyone join automatically": flip the
  // auto-approve switch, then approve everyone already waiting, then re-poll.
  const doAuto = async () => {
    const token = tokenRef.current; if (!token || busy) return;
    setBusy(true);
    const r = await setAutoApprove(token, true);
    // Clear the queue that is already waiting, remembering whether every one of them got in — a
    // PARTIAL result is exactly the case the head must not be left to guess about.
    let allIn = true;
    for (const m of pending) {
      const a = await approveMember(token, m.id, m.name);
      if (a?.ok !== true) allIn = false;
    }
    setBusy(false);
    if (r?.ok !== true) say(whyFailed(r, "We couldn't switch that on just now — please try again in a moment."));
    else if (!allIn) say("Anyone new can join now, but we couldn't let everyone already waiting in — please try those again.");
    poll();
  };

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
