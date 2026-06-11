"use client";

// SessionGate — the guest's gate for ORDER / CALL-WAITER when the v2 dining-
// session system is ON (settings.sessions_enabled). Mounted globally; listens for
// `lfh:session-do` { action: 'order'|'call', table, payload }.
//
// HEAD model (migration 018):
//   already have a token for this table? -> act (or wait for approval)
//   else -> LOCATION check (coords sent to the server, which enforces the geofence)
//             ok + table NOT open  -> YOU are the HEAD: join silently (no name) -> act
//             ok + table IS open    -> someone holds it: give your NAME -> ask to join
//                                        approved (auto) -> act
//                                        not approved    -> wait for the head (+ escapes)
//             far / denied          -> formal "request a waiter to your table"
//
// Ordering used to need a phone OTP; that's shelved (email verification will slot
// in where the `// EMAIL SEAM` note is). When sessions are OFF the cart/chef act
// the legacy way and never dispatch here, so this component stays idle.

// React building blocks: useState/useRef remember values, useEffect runs setup
// code, useCallback reuses a function between re-draws.
import { useCallback, useEffect, useRef, useState } from "react";
// Reads the restaurant's settings (location rules, whether sessions are on, etc.).
import { getSettings, type Settings } from "@/lib/menu";
// Lets us set the "default table" hint used by the cart and call-waiter.
import { setScannedTable } from "@/lib/table";
// All the server helpers for the dining-session flow: store/read/clear the saved
// session, check the guest's location, check/join a table, place an order, etc.
import {
  getStoredSession, storeSession, clearStoredSession,
  checkLocation, tableStatus, joinSession, getSessionState, requestAccess,
  placeSessionOrder, callWaiterSession,
} from "@/lib/session";

// Once you're in a session, that table becomes your default everywhere (cart +
// call-waiter prefill from the scanned-table key, and re-read on lfh:table-scanned).
const rememberTable = (table: string) => {
  setScannedTable(table);
  window.dispatchEvent(new Event("lfh:table-scanned"));
};

// The named screens this gate can show. Think of it as "which page are we on".
type Step =
  | "idle" | "ask_table" | "location_intro" | "locating" | "location_help" | "not_open" | "guest_name" | "joining"
  | "waiting_approval" | "request_sent" | "working" | "blocked";

// Remember (per device) that the guest has already seen the "why we check your
// location" consent screen, so we only show it the FIRST time and go straight to
// the check on later visits.
const LOC_CONSENT_KEY = "lfh_loc_consent";

// The job we were asked to do, for which table, with whatever data it needs:
//  • "order" / "call" — the original server actions.
//  • "connect" — just get the guest connected + approved to the table, then report
//    back. Used by the Add-to-cart gate (lib/tableConnection): no server call, the
//    caller does the actual cart add once we confirm they're in.
interface Pending { action: "order" | "call" | "connect"; table: string; payload: Record<string, unknown>; }

// Tiny helper to pop a notification toast.
const toast = (message: string, kicker = "table", variant = "success") =>
  window.dispatchEvent(new CustomEvent("lfh:toast", { detail: { message, kicker, variant } }));

// SessionGate — the step-by-step pop-up that gets a guest connected to their table
// (location check, joining, waiting for approval) and then carries out their
// queued action (order / call waiter) once they're in.
export default function SessionGate() {
  // What the on-screen pop-up needs to remember:
  const [open, setOpen] = useState(false); // is the pop-up showing?
  const [step, setStep] = useState<Step>("idle"); // which screen we're on (see Step above)
  const [tableInput, setTableInput] = useState(""); // typed table number when no QR scan yet
  const [name, setName] = useState(""); // the name the guest types when asking to join
  const [note, setNote] = useState(""); // a small explanatory message (e.g. "too far")

  // Working values that shouldn't trigger a re-draw when they change:
  const settingsRef = useRef<Settings | null>(null); // cached restaurant settings
  const pending = useRef<Pending | null>(null); // the action we're trying to complete
  const coords = useRef<{ lat: number | null; lng: number | null }>({ lat: null, lng: null }); // the guest's location
  const sess = useRef<{ table: string; token: string; memberId: string; role: "owner" | "guest" } | null>(null); // our session once we have one
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null); // the active repeating timer, if any
  const settled = useRef(false); // whether we've already reported how this action ended

  // Stops whatever repeating check is currently running.
  const stopPoll = () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
  // Report how this action ended to the cart/chef — exactly once. If the sheet is
  // dismissed before the action completes, send a cancel so the caller's button
  // never gets stuck on "Placing…".
  const fireDone = (detail: Record<string, unknown>) => {
    if (settled.current) return;
    settled.current = true;
    window.dispatchEvent(new CustomEvent("lfh:session-done", { detail }));
  };
  // Closes the pop-up. If the action never finished, report it as cancelled so the
  // button that started it (Place Order, etc.) doesn't get stuck on "Placing…".
  const close = useCallback(() => {
    // Tag the cancel with WHICH action was abandoned. The Add-to-cart gate listens
    // for { action:"connect", ok:false } to DROP the held add when the guest backs
    // out — without this tag the gate couldn't tell its cancel apart and would keep
    // the abandoned item, adding it later on the next successful connect.
    fireDone({ ok: false, reason: "cancelled", action: pending.current?.action });
    stopPoll(); setOpen(false); setStep("idle"); setName(""); setNote(""); pending.current = null;
  }, []);

  // ── perform the queued action once the session is ready ────────────────────
  // Now that we're in the session, actually do the job: place the order or call
  // the waiter, then report success/failure and close.
  const act = useCallback(async () => {
    const p = pending.current, s = sess.current;
    if (!p || !s) return close(); // nothing queued or no session — bail out
    // "connect" has no server work: we only needed to get the guest in. Report
    // success so the Add-to-cart gate can carry out the held add, then close.
    if (p.action === "connect") { fireDone({ ok: true, action: "connect" }); close(); return; }
    setStep("working"); // show the "One moment…" screen
    if (p.action === "order") {
      // EMAIL SEAM: when email verification lands, gate this on a verified member.
      // Only the item lines + allergies travel to the server — no prices. The
      // server prices the whole bill itself (see lfh_place_order).
      const pl = p.payload as { items: unknown[]; allergies: string[] };
      // Send the order to the kitchen against this table's shared bill.
      const r = await placeSessionOrder(s.token, pl.items, pl.allergies || []);
      if (r.reason === "blocked") { fireDone({ ok: false, reason: "blocked" }); setStep("blocked"); return; } // table was blocked by staff
      if (r.ok) { fireDone({ ok: true, action: "order", orderId: r.order_id }); toast("Order placed", "to the kitchen"); close(); } // success
      else { toast("Couldn't place order", "order", "error"); fireDone({ ok: false, reason: r.reason }); close(); } // failed
    } else {
      // The action was "call a waiter" — send that for this table.
      const r = await callWaiterSession(s.token, (p.payload?.reason as string) || "");
      if (r.reason === "blocked") { fireDone({ ok: false, reason: "blocked" }); setStep("blocked"); return; }
      if (r.ok) { fireDone({ ok: true, action: "call" }); toast("On our way!", "service"); close(); }
      else { toast("Couldn't reach staff", "service", "error"); close(); }
    }
  }, [close]);

  // Functions below are ordered so each only references ones defined ABOVE it —
  // no forward references, no useCallback dependency cycle.

  // ── join as HEAD (no name) — only when the table is OPEN and still empty ────
  // Become the table's host. No name needed because you're the first one in.
  // After joining, immediately carry out the queued action.
  const joinAsHead = useCallback(async () => {
    const p = pending.current!; setStep("joining");
    const r = await joinSession(p.table, null, coords.current.lat, coords.current.lng);
    if (r.reason === "blocked") { setStep("blocked"); return; }
    if (r.reason === "too_far") { setNote("You seem too far from the café."); setStep("location_help"); return; }
    if (r.reason === "no_open_session") { setStep("not_open"); return; } // staff hasn't opened it
    if (!r.ok) { toast("Couldn't join the table", "table", "error"); close(); return; }
    // Save the new session and make this table our default everywhere.
    const s = { table: p.table, token: r.token as string, memberId: r.member_id as string, role: (r.role as "owner" | "guest") };
    sess.current = s; storeSession(s); rememberTable(s.table);
    window.dispatchEvent(new Event("lfh:session-changed")); // wake the owner-approve poller
    await act();
  }, [act, close]);

  // While the guest waits for staff to open the table, poll until it opens — then
  // continue automatically (become head & place the queued order, or ask to join).
  // We keep checking the table every 1.5 seconds until a waiter opens it.
  const proceedWhenOpen = useCallback(() => {
    stopPoll();
    pollRef.current = setInterval(async () => {
      const p = pending.current; if (!p) return stopPoll();
      const st = await tableStatus(p.table);
      if (st.ok && st.open) {
        stopPoll();
        if ((st.members as number) === 0) joinAsHead(); // first one in -> head -> acts
        else setStep("guest_name");                     // others already there -> ask to join
      }
    }, 1500); // staff just opened it -> guest moves on within ~1.5s
  }, [joinAsHead]);

  // ── after location: tables are opened by STAFF, not by guests ──────────────
  //   not open      -> request a waiter; keep watching so we auto-continue on open
  //   open + empty  -> you're the first guest in -> become head (no name)
  //   open + others -> give your name -> ask the head to let you in
  // Decides what to do once we know the guest is at the café: wait for staff to
  // open the table, become the host, or ask the existing host to let them in.
  const afterLocation = useCallback(async () => {
    const p = pending.current!;
    const st = await tableStatus(p.table);
    if (st.reason === "blocked") { setStep("blocked"); return; }
    if (!st.open) { setStep("not_open"); proceedWhenOpen(); return; } // wait for staff to open it
    if ((st.members as number) === 0) { await joinAsHead(); return; } // empty table -> you're the host
    setStep("guest_name"); // someone's there -> ask to join
  }, [joinAsHead, proceedWhenOpen]);

  // Phase 2: actually ask the browser for the location and judge the result. This
  // is where the OS permission prompt appears, so we only reach it AFTER the guest
  // has agreed on the intro screen (or on later visits, where they already have).
  const runLocation = useCallback(async () => {
    const st = settingsRef.current!;
    setStep("locating"); // show the "Confirming you're at the café…" screen
    const loc = await checkLocation(st.geoLat, st.geoLng, st.geoRadiusM);
    coords.current = { lat: loc.lat, lng: loc.lng };
    if (loc.near) return afterLocation(); // close enough -> carry on
    // Too far / blocked / unreadable -> explain and offer the waiter-request screen.
    setNote(loc.reason === "denied" ? "Location was blocked." : loc.reason === "far" ? "You seem too far from the café." : "Couldn't read your location.");
    setStep("location_help");
  }, [afterLocation]);

  // Step 1 of the flow: confirm the guest is physically at the café (if the
  // restaurant requires it). Two-phase: the FIRST time on this device we show a
  // friendly consent screen explaining why, and only request the location once the
  // guest taps "I'm here". On later visits we skip straight to the check.
  const beginLocation = useCallback(async () => {
    const st = settingsRef.current!;
    if (!st.requireLocation) { coords.current = { lat: null, lng: null }; return afterLocation(); } // location not required -> skip
    let consented = false;
    try { consented = localStorage.getItem(LOC_CONSENT_KEY) === "1"; } catch {}
    if (!consented) { setStep("location_intro"); return; } // first time -> explain before prompting
    await runLocation(); // returning guest -> straight to the check
  }, [afterLocation, runLocation]);

  // The intro's "I'm here — continue" button: remember the consent so we don't ask
  // again on this device, then run the real location check (which prompts the OS).
  const continueFromIntro = useCallback(async () => {
    try { localStorage.setItem(LOC_CONSENT_KEY, "1"); } catch {}
    await runLocation();
  }, [runLocation]);

  // poll until the head approves this guest, then act
  // While waiting for the host's OK, we re-check about once a second; the moment
  // we're approved, we carry out the queued action.
  const startApprovalPoll = useCallback(() => {
    stopPoll();
    pollRef.current = setInterval(async () => {
      const s = sess.current; if (!s) return stopPoll();
      const state = await getSessionState(s.token);
      const member = state.member as { approved?: boolean } | undefined;
      if (state.ok && member?.approved) { stopPoll(); act(); }
    }, 1200); // move on within ~1s of the head approving
  }, [act]);

  // ── given a stored token, make sure it's still good + approved, then act ───
  // If we already had a saved session, double-check it's still valid and that
  // we're approved before doing the action.
  const ensureReadyAndAct = useCallback(async () => {
    const s = sess.current;
    if (!s) return;
    const state = await getSessionState(s.token);
    // token died OR the table was closed -> drop it and rerun the flow (which, for
    // a now-free table, makes us the head again).
    const sessionObj = state.session as { status?: string } | undefined;
    if (!state.ok || sessionObj?.status !== "open") { clearStoredSession(); sess.current = null; return beginLocation(); } // token dead/table closed -> start over
    const member = state.member as { approved?: boolean } | undefined;
    if (!member?.approved) { setStep("waiting_approval"); startApprovalPoll(); return; } // not yet approved -> wait
    await act();
  }, [act, beginLocation, startApprovalPoll]);

  // ── entry: reuse a stored session, else start the location flow ────────────
  // The very start of the flow: if we already belong to this table, jump straight
  // to acting; otherwise begin the location check.
  const beginFlow = useCallback(async () => {
    const stored = getStoredSession(pending.current!.table);
    if (stored) { sess.current = stored; await ensureReadyAndAct(); }
    else { await beginLocation(); }
  }, [beginLocation, ensureReadyAndAct]);

  // This runs once on first appear. It listens for the "do this action" event
  // (fired by the cart or the chef pop-up) and kicks off the whole flow.
  useEffect(() => {
    // Runs when something asks us to order / call a waiter through a session.
    const onDo = async (e: Event) => {
      const detail = (e as CustomEvent).detail as Pending;
      // Need an action. A TABLE is required too — EXCEPT for "connect", which can
      // ask the guest for their table number when one isn't known yet (no QR scan).
      if (!detail?.action) return;
      if (!detail.table && detail.action !== "connect") return;
      // Remember the job, reset the "reported result" flag and any old coords.
      pending.current = detail;
      settled.current = false;
      coords.current = { lat: null, lng: null };
      // Load settings once and reuse them after.
      settingsRef.current = settingsRef.current || (await getSettings());
      if (detail.action === "connect") {
        // SILENT FAST-PATH: already in an open session AND approved → finish without
        // ever showing the popup (the gate's cache can lag a poll, so re-check here).
        if (detail.table) {
          const stored = getStoredSession(detail.table);
          if (stored) {
            sess.current = stored;
            const state = await getSessionState(stored.token);
            const sObj = state.session as { status?: string } | undefined;
            const member = state.member as { approved?: boolean } | undefined;
            if (state.ok && sObj?.status === "open" && member?.approved) { await act(); return; }
          }
        } else {
          // No table known yet → ASK for the table number first (QR scan will fill
          // this automatically once that's built). Once entered, the flow continues.
          setNote(""); setTableInput(""); setOpen(true); setStep("ask_table");
          return;
        }
      }
      setOpen(true);
      await beginFlow();
    };
    window.addEventListener("lfh:session-do", onDo);
    // Cleanup when the component disappears: stop listening and stop any timer.
    return () => { window.removeEventListener("lfh:session-do", onDo); stopPoll(); };
  }, [beginFlow, act]);

  // ── screen actions ─────────────────────────────────────────────────────────
  // The guest typed their table number (no QR scan yet). Validate it, remember it
  // so the cart + future adds prefill it (no re-asking), then run the join flow.
  const submitTable = () => {
    const t = (tableInput || "").trim();
    if (!/^\d+$/.test(t) || Number(t) < 1) { setNote("Please enter your table number."); return; }
    pending.current = { ...(pending.current as Pending), table: t };
    rememberTable(t);
    setNote("");
    beginFlow();
  };
  // This runs when the guest taps "Ask to join this table": send their name to
  // the host. If auto-approved, act now; otherwise wait for the host's OK.
  const doJoinAsGuest = async () => {
    const p = pending.current!; setStep("joining");
    const r = await joinSession(p.table, name.trim() || null, coords.current.lat, coords.current.lng);
    if (r.reason === "blocked") { setStep("blocked"); return; }
    if (r.reason === "too_far") { setNote("You seem too far from the café."); setStep("location_help"); return; }
    if (r.reason === "no_open_session") { setStep("not_open"); return; }
    if (!r.ok) { toast("Couldn't join", "table", "error"); close(); return; }
    // Save the session and make this our default table.
    const s = { table: p.table, token: r.token as string, memberId: r.member_id as string, role: (r.role as "owner" | "guest") };
    sess.current = s; storeSession(s); rememberTable(s.table);
    window.dispatchEvent(new Event("lfh:session-changed"));
    // If the table auto-approves, go straight to acting; else wait for the host.
    if (r.approved) await ensureReadyAndAct();
    else { setStep("waiting_approval"); startApprovalPoll(); }
  };

  // Formal "request a waiter to your table" — used when location can't be
  // confirmed, or as the escape hatch on a table someone else holds.
  const doRequest = async (type: "open" | "access") => {
    const p = pending.current!; await requestAccess(p.table, type, name.trim() || null, null);
    setStep("request_sent");
  };
  // From the "not open" screen: tell staff, then keep waiting — proceedWhenOpen
  // (already running) auto-continues the moment they open the table.
  const doRequestOpen = async () => {
    const p = pending.current!; await requestAccess(p.table, "open", null, null);
    setStep("request_sent");
  };

  // Sends the guest back to the menu so they can scan/pick a different table.
  const rescan = () => { window.location.href = "/menu"; };

  // If the pop-up isn't open, draw nothing.
  if (!open) return null;

  // What the guest sees: one card over a dimmed background. Which screen shows
  // depends on `step`. Tapping the background closes it.
  return (
    <div className="sg-overlay" onClick={close}>
      {/* The card itself — stopPropagation keeps taps inside from closing it. */}
      <div className="sg-box" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="sg-x" aria-label="Close" onClick={close}>✕</button>

        {/* No QR scan yet → ask for the table number before anything else. Once a
            QR scanner is added it will fill this in and skip straight past. */}
        {step === "ask_table" && (<>
          <div className="sg-badge"><i className="fas fa-chair"></i></div>
          <div className="sg-kicker">My Little French House</div>
          <h3 className="sg-title">Which table are you at?</h3>
          <p className="sg-sub">Enter your table number to start your order. (Scanning the QR code on your table will fill this in for you.)</p>
          <input className="sg-input" type="number" inputMode="numeric" min={1} placeholder="Table number" value={tableInput}
            onChange={(e) => setTableInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") submitTable(); }} autoFocus />
          {note && <p className="sg-sub" style={{ color: "#fca5a5" }}>{note}</p>}
          <div className="sg-actions">
            <button className="sg-btn gold" onClick={submitTable}>Continue</button>
          </div>
        </>)}

        {/* PHASE 1 (first visit only): explain WHY we check location, before the
            browser prompt. Tapping continue records consent and runs the check. */}
        {step === "location_intro" && (<>
          <div className="sg-badge"><i className="fas fa-location-dot"></i></div>
          <div className="sg-kicker">My Little French House</div>
          <h3 className="sg-title">You&apos;re at table {pending.current?.table}</h3>
          <p className="sg-sub">Before you order, we quickly confirm you&apos;re here at the restaurant — so every order is genuine. Your location is used once, just for this. We never store or share it.</p>
          <div className="sg-actions">
            <button className="sg-btn gold" onClick={continueFromIntro}>I&apos;m here — continue</button>
          </div>
          <div className="sg-links">
            <button className="sg-link" onClick={() => doRequest("access")}>Not at the restaurant? Call a waiter</button>
          </div>
        </>)}

        {/* PHASE 2: "Checking you're at the café" — the OS prompt appears here. */}
        {step === "locating" && (<>
          <div className="sg-badge spin"><i className="fas fa-location-crosshairs"></i></div>
          <h3 className="sg-title">Confirming you&apos;re at the café…</h3>
          <p className="sg-sub">We use your location only to make sure orders and waiter calls are real. Please tap Allow if your browser asks.</p>
        </>)}

        {/* Brief "joining the table" waiting screen. */}
        {step === "joining" && (<><div className="sg-badge spin"><i className="fas fa-hourglass-half"></i></div><h3 className="sg-title">One moment…</h3></>)}
        {/* Brief "carrying out your action" waiting screen. */}
        {step === "working" && (<><div className="sg-badge spin"><i className="fas fa-hourglass-half"></i></div><h3 className="sg-title">One moment…</h3></>)}

        {/* Location couldn't be confirmed -> offer to retry or send a waiter. */}
        {step === "location_help" && (<>
          <div className="sg-badge"><i className="fas fa-bell-concierge"></i></div><h3 className="sg-title">Let us bring a waiter over</h3>
          <p className="sg-sub">{note} No problem — we&apos;ll send a staff member to your table. It usually takes about 5 minutes.</p>
          <div className="sg-actions">
            <button className="sg-btn ghost" onClick={() => runLocation()}>Try location again</button>
            <button className="sg-btn gold" onClick={() => doRequest("access")}>Request a waiter</button>
          </div>
        </>)}

        {/* Table not opened by staff yet -> offer to scan another or request a waiter. */}
        {step === "not_open" && (<>
          <div className="sg-badge"><i className="fas fa-bell"></i></div><h3 className="sg-title">Your table isn&apos;t open yet</h3>
          <p className="sg-sub">A waiter opens your table once you&apos;re seated. We can let them know you&apos;re ready at table {pending.current?.table} — it usually takes a few minutes.</p>
          <div className="sg-actions">
            <button className="sg-btn ghost" onClick={rescan}>Scan another table</button>
            <button className="sg-btn gold" onClick={doRequestOpen}>Request a waiter</button>
          </div>
        </>)}

        {/* Someone already holds the table -> ask for the guest's name to join. */}
        {step === "guest_name" && (<>
          <div className="sg-badge"><i className="fas fa-handshake"></i></div><h3 className="sg-title">This table&apos;s already open</h3>
          <p className="sg-sub">Someone at table {pending.current?.table} started this tab. Add your name so they can confirm it&apos;s you, then ask to join.</p>
          <input className="sg-input" placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          <div className="sg-actions">
            <button className="sg-btn gold" onClick={doJoinAsGuest}>Ask to join this table</button>
          </div>
          <div className="sg-links">
            <button className="sg-link" onClick={rescan}>Wrong table? Scan again</button>
            <button className="sg-link" onClick={() => doRequest("access")}>Call a waiter instead</button>
          </div>
        </>)}

        {/* Waiting for the host to approve this guest. */}
        {step === "waiting_approval" && (<>
          <div className="sg-badge spin"><i className="fas fa-hourglass-half"></i></div><h3 className="sg-title">Waiting for the table to let you in…</h3>
          <p className="sg-sub">The person who opened table {pending.current?.table} needs to confirm you. This usually takes a moment.</p>
          <div className="sg-actions"><button className="sg-btn ghost" onClick={() => doRequest("access")}>Call a waiter instead</button></div>
        </>)}

        {/* We've notified staff -> keep open so we auto-continue when they act. */}
        {step === "request_sent" && (<>
          <div className="sg-badge"><i className="fas fa-bell-concierge"></i></div><h3 className="sg-title">We&apos;ve let the staff know</h3>
          <p className="sg-sub">Keep this open — the moment a waiter opens your table you&apos;ll be brought in and your order sent automatically. Tap cancel to stop.</p>
          <div className="sg-actions"><button className="sg-btn ghost" onClick={close}>Cancel</button></div>
        </>)}

        {/* The restaurant has blocked this table -> dead end with an explanation. */}
        {step === "blocked" && (<>
          <div className="sg-badge danger"><i className="fas fa-ban"></i></div><h3 className="sg-title">Access blocked</h3>
          <p className="sg-sub">This table has been blocked by the restaurant. Please speak to a staff member if you think this is a mistake.</p>
          <div className="sg-actions"><button className="sg-btn ghost" onClick={close}>Close</button></div>
        </>)}
      </div>
    </div>
  );
}
