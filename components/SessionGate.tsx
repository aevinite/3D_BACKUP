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

import { useCallback, useEffect, useRef, useState } from "react";
import { getSettings, type Settings } from "@/lib/menu";
import {
  getStoredSession, storeSession, clearStoredSession,
  checkLocation, tableStatus, joinSession, getSessionState, requestAccess,
  placeSessionOrder, callWaiterSession,
} from "@/lib/session";

type Step =
  | "idle" | "locating" | "location_help" | "not_open" | "guest_name" | "joining"
  | "waiting_approval" | "request_sent" | "working" | "blocked";

interface Pending { action: "order" | "call"; table: string; payload: Record<string, unknown>; }

const toast = (message: string, kicker = "table", variant = "success") =>
  window.dispatchEvent(new CustomEvent("lfh:toast", { detail: { message, kicker, variant } }));

export default function SessionGate() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("idle");
  const [name, setName] = useState("");
  const [note, setNote] = useState("");

  const settingsRef = useRef<Settings | null>(null);
  const pending = useRef<Pending | null>(null);
  const coords = useRef<{ lat: number | null; lng: number | null }>({ lat: null, lng: null });
  const sess = useRef<{ table: string; token: string; memberId: string; role: "owner" | "guest" } | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const settled = useRef(false); // whether we've already reported how this action ended

  const stopPoll = () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
  // Report how this action ended to the cart/chef — exactly once. If the sheet is
  // dismissed before the action completes, send a cancel so the caller's button
  // never gets stuck on "Placing…".
  const fireDone = (detail: Record<string, unknown>) => {
    if (settled.current) return;
    settled.current = true;
    window.dispatchEvent(new CustomEvent("lfh:session-done", { detail }));
  };
  const close = useCallback(() => {
    fireDone({ ok: false, reason: "cancelled" });
    stopPoll(); setOpen(false); setStep("idle"); setName(""); setNote(""); pending.current = null;
  }, []);

  // ── perform the queued action once the session is ready ────────────────────
  const act = useCallback(async () => {
    const p = pending.current, s = sess.current;
    if (!p || !s) return close();
    setStep("working");
    if (p.action === "order") {
      // EMAIL SEAM: when email verification lands, gate this on a verified member.
      const pl = p.payload as { items: unknown[]; subtotal: number; tax: number; total: number; allergies: string[] };
      const r = await placeSessionOrder(s.token, pl.items, pl.subtotal, pl.tax, pl.total, pl.allergies || []);
      if (r.reason === "blocked") { fireDone({ ok: false, reason: "blocked" }); setStep("blocked"); return; }
      if (r.ok) { fireDone({ ok: true, action: "order", orderId: r.order_id }); toast("Order placed", "to the kitchen"); close(); }
      else { toast("Couldn't place order", "order", "error"); fireDone({ ok: false, reason: r.reason }); close(); }
    } else {
      const r = await callWaiterSession(s.token, (p.payload?.reason as string) || "");
      if (r.reason === "blocked") { fireDone({ ok: false, reason: "blocked" }); setStep("blocked"); return; }
      if (r.ok) { fireDone({ ok: true, action: "call" }); toast("On our way!", "service"); close(); }
      else { toast("Couldn't reach staff", "service", "error"); close(); }
    }
  }, [close]);

  // Functions below are ordered so each only references ones defined ABOVE it —
  // no forward references, no useCallback dependency cycle.

  // ── join as HEAD (no name) — only when the table is OPEN and still empty ────
  const joinAsHead = useCallback(async () => {
    const p = pending.current!; setStep("joining");
    const r = await joinSession(p.table, null, coords.current.lat, coords.current.lng);
    if (r.reason === "blocked") { setStep("blocked"); return; }
    if (r.reason === "too_far") { setNote("You seem too far from the café."); setStep("location_help"); return; }
    if (r.reason === "no_open_session") { setStep("not_open"); return; } // staff hasn't opened it
    if (!r.ok) { toast("Couldn't join the table", "table", "error"); close(); return; }
    const s = { table: p.table, token: r.token as string, memberId: r.member_id as string, role: (r.role as "owner" | "guest") };
    sess.current = s; storeSession(s);
    window.dispatchEvent(new Event("lfh:session-changed")); // wake the owner-approve poller
    await act();
  }, [act, close]);

  // While the guest waits for staff to open the table, poll until it opens — then
  // continue automatically (become head & place the queued order, or ask to join).
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
  const afterLocation = useCallback(async () => {
    const p = pending.current!;
    const st = await tableStatus(p.table);
    if (st.reason === "blocked") { setStep("blocked"); return; }
    if (!st.open) { setStep("not_open"); proceedWhenOpen(); return; }
    if ((st.members as number) === 0) { await joinAsHead(); return; }
    setStep("guest_name");
  }, [joinAsHead, proceedWhenOpen]);

  const beginLocation = useCallback(async () => {
    const st = settingsRef.current!;
    if (!st.requireLocation) { coords.current = { lat: null, lng: null }; return afterLocation(); }
    setStep("locating");
    const loc = await checkLocation(st.geoLat, st.geoLng, st.geoRadiusM);
    coords.current = { lat: loc.lat, lng: loc.lng };
    if (loc.near) return afterLocation();
    setNote(loc.reason === "denied" ? "Location was blocked." : loc.reason === "far" ? "You seem too far from the café." : "Couldn't read your location.");
    setStep("location_help");
  }, [afterLocation]);

  // poll until the head approves this guest, then act
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
  const ensureReadyAndAct = useCallback(async () => {
    const s = sess.current;
    if (!s) return;
    const state = await getSessionState(s.token);
    // token died OR the table was closed -> drop it and rerun the flow (which, for
    // a now-free table, makes us the head again).
    const sessionObj = state.session as { status?: string } | undefined;
    if (!state.ok || sessionObj?.status !== "open") { clearStoredSession(); sess.current = null; return beginLocation(); }
    const member = state.member as { approved?: boolean } | undefined;
    if (!member?.approved) { setStep("waiting_approval"); startApprovalPoll(); return; }
    await act();
  }, [act, beginLocation, startApprovalPoll]);

  // ── entry: reuse a stored session, else start the location flow ────────────
  const beginFlow = useCallback(async () => {
    const stored = getStoredSession(pending.current!.table);
    if (stored) { sess.current = stored; await ensureReadyAndAct(); }
    else { await beginLocation(); }
  }, [beginLocation, ensureReadyAndAct]);

  useEffect(() => {
    const onDo = async (e: Event) => {
      const detail = (e as CustomEvent).detail as Pending;
      if (!detail?.action || !detail?.table) return;
      pending.current = detail;
      settled.current = false;
      coords.current = { lat: null, lng: null };
      settingsRef.current = settingsRef.current || (await getSettings());
      setOpen(true);
      await beginFlow();
    };
    window.addEventListener("lfh:session-do", onDo);
    return () => { window.removeEventListener("lfh:session-do", onDo); stopPoll(); };
  }, [beginFlow]);

  // ── screen actions ─────────────────────────────────────────────────────────
  const doJoinAsGuest = async () => {
    const p = pending.current!; setStep("joining");
    const r = await joinSession(p.table, name.trim() || null, coords.current.lat, coords.current.lng);
    if (r.reason === "blocked") { setStep("blocked"); return; }
    if (r.reason === "too_far") { setNote("You seem too far from the café."); setStep("location_help"); return; }
    if (r.reason === "no_open_session") { setStep("not_open"); return; }
    if (!r.ok) { toast("Couldn't join", "table", "error"); close(); return; }
    const s = { table: p.table, token: r.token as string, memberId: r.member_id as string, role: (r.role as "owner" | "guest") };
    sess.current = s; storeSession(s);
    window.dispatchEvent(new Event("lfh:session-changed"));
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

  const rescan = () => { window.location.href = "/menu"; };

  if (!open) return null;

  return (
    <div className="sg-overlay" onClick={close}>
      <div className="sg-box" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="sg-x" aria-label="Close" onClick={close}>✕</button>

        {step === "locating" && (<><div className="sg-emoji">📍</div><h3 className="sg-title">Confirming you&apos;re at the café…</h3><p className="sg-sub">We use your location only to make sure orders and waiter calls are real. Please tap Allow if your browser asks.</p></>)}

        {step === "joining" && (<><div className="sg-emoji">⏳</div><h3 className="sg-title">One moment…</h3></>)}
        {step === "working" && (<><div className="sg-emoji">⏳</div><h3 className="sg-title">One moment…</h3></>)}

        {step === "location_help" && (<>
          <div className="sg-emoji">🛎️</div><h3 className="sg-title">Let us bring a waiter over</h3>
          <p className="sg-sub">{note} No problem — we&apos;ll send a staff member to your table. It usually takes about 5 minutes.</p>
          <div className="sg-actions">
            <button className="sg-btn ghost" onClick={() => beginLocation()}>Try location again</button>
            <button className="sg-btn gold" onClick={() => doRequest("access")}>Request a waiter</button>
          </div>
        </>)}

        {step === "not_open" && (<>
          <div className="sg-emoji">🔔</div><h3 className="sg-title">Your table isn&apos;t open yet</h3>
          <p className="sg-sub">A waiter opens your table once you&apos;re seated. We can let them know you&apos;re ready at table {pending.current?.table} — it usually takes a few minutes.</p>
          <div className="sg-actions">
            <button className="sg-btn ghost" onClick={rescan}>Scan another table</button>
            <button className="sg-btn gold" onClick={doRequestOpen}>Request a waiter</button>
          </div>
        </>)}

        {step === "guest_name" && (<>
          <div className="sg-emoji">🤝</div><h3 className="sg-title">This table&apos;s already open</h3>
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

        {step === "waiting_approval" && (<>
          <div className="sg-emoji">⏳</div><h3 className="sg-title">Waiting for the table to let you in…</h3>
          <p className="sg-sub">The person who opened table {pending.current?.table} needs to confirm you. This usually takes a moment.</p>
          <div className="sg-actions"><button className="sg-btn ghost" onClick={() => doRequest("access")}>Call a waiter instead</button></div>
        </>)}

        {step === "request_sent" && (<>
          <div className="sg-emoji">🛎️</div><h3 className="sg-title">We&apos;ve let the staff know</h3>
          <p className="sg-sub">Keep this open — the moment a waiter opens your table you&apos;ll be brought in and your order sent automatically. Tap cancel to stop.</p>
          <div className="sg-actions"><button className="sg-btn ghost" onClick={close}>Cancel</button></div>
        </>)}

        {step === "blocked" && (<>
          <div className="sg-emoji">🚫</div><h3 className="sg-title">Access blocked</h3>
          <p className="sg-sub">This table has been blocked by the restaurant. Please speak to a staff member if you think this is a mistake.</p>
          <div className="sg-actions"><button className="sg-btn ghost" onClick={close}>Close</button></div>
        </>)}
      </div>
    </div>
  );
}
