"use client";

// SessionGate — the guest's gate for ORDER / CALL-WAITER when the v2 dining-
// session system is ON (settings.sessions_enabled). It is mounted globally and
// listens for `lfh:session-do` { action: 'order'|'call', table, payload }.
//
// Flow (all soft-gated, never a hard block):
//   have a valid session for this table?  -> do the action
//   else -> LOCATION (explainer + check)
//             near    -> JOIN screen (name) -> join_session
//                          approved      -> (order needs OTP once) -> ACT
//                          not approved  -> WAIT for owner approval (+ call escape)
//                          no open table -> "not open yet" -> request to open
//             far/denied -> offer a staff request (no hard block)
//
// When sessions are OFF, the cart/chef never dispatch here — they act the
// legacy way — so this component simply stays idle.

import { useCallback, useEffect, useRef, useState } from "react";
import { getSettings, type Settings } from "@/lib/menu";
import {
  getStoredSession, storeSession, clearStoredSession,
  checkLocation, joinSession, getSessionState, requestAccess,
  sendOtp, verifyOtp, placeSessionOrder, callWaiterSession,
} from "@/lib/session";

type Step =
  | "idle" | "locating" | "location_help" | "join" | "joining"
  | "otp" | "waiting_approval" | "not_open" | "request_sent" | "working";

interface Pending { action: "order" | "call"; table: string; payload: Record<string, unknown>; }

const toast = (message: string, kicker = "table", variant = "success") =>
  window.dispatchEvent(new CustomEvent("lfh:toast", { detail: { message, kicker, variant } }));

export default function SessionGate() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("idle");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [devCode, setDevCode] = useState<string | null>(null); // STUB: shown until real OTP is wired
  const [note, setNote] = useState("");

  const settingsRef = useRef<Settings | null>(null);
  const pending = useRef<Pending | null>(null);
  const sess = useRef<{ table: string; token: string; memberId: string; role: "owner" | "guest" } | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPoll = () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
  const close = useCallback(() => { stopPoll(); setOpen(false); setStep("idle"); setName(""); setPhone(""); setCode(""); setDevCode(null); setNote(""); }, []);

  // ── perform the queued action once the session is fully ready ──────────────
  const act = useCallback(async () => {
    const p = pending.current, s = sess.current;
    if (!p || !s) return close();
    setStep("working");
    if (p.action === "order") {
      const pl = p.payload as { items: unknown[]; subtotal: number; tax: number; total: number; allergies: string[] };
      const r = await placeSessionOrder(s.token, pl.items, pl.subtotal, pl.tax, pl.total, pl.allergies || []);
      if (r.ok) { window.dispatchEvent(new CustomEvent("lfh:session-done", { detail: { ok: true, action: "order", orderId: r.order_id } })); toast("Order placed", "to the kitchen"); close(); }
      else { setStep("working"); toast("Couldn't place order", "order", "error"); window.dispatchEvent(new CustomEvent("lfh:session-done", { detail: { ok: false, reason: r.reason } })); close(); }
    } else {
      const r = await callWaiterSession(s.token, (p.payload?.reason as string) || "");
      if (r.ok) { window.dispatchEvent(new CustomEvent("lfh:session-done", { detail: { ok: true, action: "call" } })); toast("On our way!", "service"); close(); }
      else { toast("Couldn't reach staff", "service", "error"); close(); }
    }
  }, [close]);

  // ── make sure the session is approved + (for orders) OTP-verified ──────────
  const ensureReadyAndAct = useCallback(async () => {
    const s = sess.current, st = settingsRef.current;
    if (!s) return;
    const state = await getSessionState(s.token);
    if (!state.ok) { clearStoredSession(); sess.current = null; setStep("join"); return; }
    const sessionObj = state.session as { status?: string } | undefined;
    const member = state.member as { approved?: boolean; phone_verified?: boolean } | undefined;
    if (sessionObj?.status !== "open") { clearStoredSession(); sess.current = null; setStep("not_open"); return; }
    if (!member?.approved) { setStep("waiting_approval"); startApprovalPoll(); return; }
    if (pending.current?.action === "order" && st?.requireOtp && !member?.phone_verified) { setStep("otp"); return; }
    await act();
  }, [act]);

  const startApprovalPoll = useCallback(() => {
    stopPoll();
    pollRef.current = setInterval(async () => {
      const s = sess.current; if (!s) return stopPoll();
      const state = await getSessionState(s.token);
      const member = state.member as { approved?: boolean } | undefined;
      if (state.ok && member?.approved) { stopPoll(); ensureReadyAndAct(); }
    }, 3000);
  }, [ensureReadyAndAct]);

  // ── kick off the flow for a queued action ──────────────────────────────────
  const beginLocation = useCallback(async () => {
    const st = settingsRef.current!;
    if (!st.requireLocation) { setStep("join"); return; }
    setStep("locating");
    const loc = await checkLocation(st.geoLat, st.geoLng, st.geoRadiusM);
    if (loc.near) setStep("join");
    else { setNote(loc.reason === "denied" ? "Location was blocked." : loc.reason === "far" ? "You seem too far from the café." : "Couldn't read your location."); setStep("location_help"); }
  }, []);

  useEffect(() => {
    const onDo = async (e: Event) => {
      const detail = (e as CustomEvent).detail as Pending;
      if (!detail?.action || !detail?.table) return;
      pending.current = detail;
      settingsRef.current = settingsRef.current || (await getSettings());
      setOpen(true);
      // reuse an existing session for this table if we have one
      const stored = getStoredSession(detail.table);
      if (stored) { sess.current = stored; await ensureReadyAndAct(); }
      else { beginLocation(); }
    };
    window.addEventListener("lfh:session-do", onDo);
    return () => { window.removeEventListener("lfh:session-do", onDo); stopPoll(); };
  }, [beginLocation, ensureReadyAndAct]);

  // ── actions on the screens ──────────────────────────────────────────────
  const doJoin = async () => {
    const p = pending.current!; setStep("joining");
    const r = await joinSession(p.table, name.trim() || null, true);
    if (r.reason === "no_open_session") { setStep("not_open"); return; }
    if (!r.ok) { toast(r.reason === "blocked" ? "This table is blocked" : "Couldn't join", "table", "error"); close(); return; }
    const s = { table: p.table, token: r.token as string, memberId: r.member_id as string, role: (r.role as "owner" | "guest") };
    sess.current = s; storeSession(s);
    if (r.approved) await ensureReadyAndAct();
    else { setStep("waiting_approval"); startApprovalPoll(); }
  };

  const doSendOtp = async () => {
    const r = await sendOtp(phone.trim());
    if (!r.ok) { toast(r.reason === "blocked" ? "This number is blocked" : "Couldn't send code", "order", "error"); return; }
    setDevCode((r.dev_code as string) || null); // STUB
    toast("Code sent", "order");
  };
  const doVerifyOtp = async () => {
    const s = sess.current!; const r = await verifyOtp(s.token, phone.trim(), code.trim());
    if (!r.ok) { toast(r.reason === "wrong_code" ? "Wrong code" : "Code expired — resend", "order", "error"); return; }
    await act();
  };

  const doRequest = async (type: "open" | "access") => {
    const p = pending.current!; await requestAccess(p.table, type, name.trim() || null, phone.trim() || null);
    setStep("request_sent");
  };

  const rescan = () => { window.location.href = "/menu"; };

  if (!open) return null;

  return (
    <div className="sg-overlay" onClick={close}>
      <div className="sg-box" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="sg-x" aria-label="Close" onClick={close}>✕</button>

        {step === "locating" && (<><div className="sg-emoji">📍</div><h3 className="sg-title">Confirming you&apos;re at the café…</h3><p className="sg-sub">We use your location only to make sure orders and waiter calls are real. Please tap Allow if your browser asks.</p></>)}

        {step === "location_help" && (<>
          <div className="sg-emoji">📍</div><h3 className="sg-title">Quick check</h3>
          <p className="sg-sub">{note} No problem — a staff member can let you in. We&apos;ll send a request; it usually takes about 5 minutes.</p>
          <div className="sg-actions">
            <button className="sg-btn ghost" onClick={() => beginLocation()}>Try again</button>
            <button className="sg-btn gold" onClick={() => doRequest("access")}>Ask staff</button>
          </div>
        </>)}

        {step === "join" && (<>
          <div className="sg-emoji">🍽️</div><h3 className="sg-title">Join table {pending.current?.table}</h3>
          <p className="sg-sub">Add your name so the table owner knows it&apos;s you.</p>
          <input className="sg-input" placeholder="Your name (optional)" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          <div className="sg-actions">
            <button className="sg-btn gold" onClick={doJoin}>Join this table</button>
          </div>
          <div className="sg-links">
            <button className="sg-link" onClick={rescan}>Wrong table? Scan again</button>
            <button className="sg-link" onClick={() => { pending.current = { action: "call", table: pending.current!.table, payload: { reason: "help" } }; doRequest("access"); }}>Call a waiter</button>
          </div>
        </>)}

        {step === "joining" && (<><div className="sg-emoji">⏳</div><h3 className="sg-title">Joining…</h3></>)}

        {step === "waiting_approval" && (<>
          <div className="sg-emoji">⏳</div><h3 className="sg-title">Waiting for the table owner…</h3>
          <p className="sg-sub">The person who opened this table needs to let you in. This usually takes a moment.</p>
          <div className="sg-actions"><button className="sg-btn ghost" onClick={() => doRequest("access")}>Call a waiter instead</button></div>
        </>)}

        {step === "not_open" && (<>
          <div className="sg-emoji">🔒</div><h3 className="sg-title">This table isn&apos;t open yet</h3>
          <p className="sg-sub">A waiter opens your table when you&apos;re seated. Want us to send a request?</p>
          <div className="sg-actions">
            <button className="sg-btn ghost" onClick={rescan}>Scan another table</button>
            <button className="sg-btn gold" onClick={() => doRequest("open")}>Request to open</button>
          </div>
        </>)}

        {step === "request_sent" && (<>
          <div className="sg-emoji">✅</div><h3 className="sg-title">Request sent</h3>
          <p className="sg-sub">A staff member will be with you shortly — it usually takes about 5 minutes. You can keep browsing the menu meanwhile.</p>
          <div className="sg-actions"><button className="sg-btn gold" onClick={close}>Okay</button></div>
        </>)}

        {step === "otp" && (<>
          <div className="sg-emoji">📱</div><h3 className="sg-title">Verify your number</h3>
          <p className="sg-sub">Just so we can send your order to the kitchen and let you track it.</p>
          <input className="sg-input" inputMode="tel" placeholder="Phone number" value={phone} onChange={(e) => setPhone(e.target.value)} />
          <div className="sg-actions"><button className="sg-btn ghost" onClick={doSendOtp}>Send code</button></div>
          {devCode && <p className="sg-dev">Dev code (stub until WhatsApp is connected): <b>{devCode}</b></p>}
          <input className="sg-input" inputMode="numeric" placeholder="6-digit code" value={code} onChange={(e) => setCode(e.target.value)} />
          <div className="sg-actions"><button className="sg-btn gold" onClick={doVerifyOtp}>Verify &amp; order</button></div>
        </>)}

        {step === "working" && (<><div className="sg-emoji">⏳</div><h3 className="sg-title">One moment…</h3></>)}
      </div>
    </div>
  );
}
