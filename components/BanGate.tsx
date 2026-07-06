"use client";

// BanGate — the full-screen "you've been blocked" wall for a banned guest. On load
// (and whenever the tab regains focus) it asks the server whether THIS device is
// banned; if so it covers the entire menu with a blocking overlay so a banned guest
// can't browse or order, and offers a single action: leave a mobile number to ask
// staff to unblock them (which surfaces on the manager's ban panel). When it's NOT
// banned it renders nothing, so normal guests never see it. (owner, 2026-06-22)

import { useEffect, useState } from "react";
import { checkBan, requestUnban } from "@/lib/session";
import { useResolvedRestaurantId } from "@/lib/restaurant-context";

export default function BanGate() {
  const resolvedId = useResolvedRestaurantId();         // null until the /r/<slug> tenant is known
  const [banned, setBanned] = useState(false);          // is this device blocked?
  const [reason, setReason] = useState<string | null>(null); // optional staff reason
  const [requested, setRequested] = useState(false);    // has an unblock request already gone in?
  const [phone, setPhone] = useState("");               // the number the guest types
  const [sending, setSending] = useState(false);        // request in flight

  // Ask the server on mount, and re-ask when the tab is refocused — so the moment
  // staff unblock them, the wall lifts on their next look without a manual reload.
  useEffect(() => {
    // Wait for the real restaurant id — bans are per-restaurant, so checking as
    // the #1 default before the /r/<slug> tenant resolves would use the wrong scope.
    if (!resolvedId) return;
    let alive = true;
    const check = async () => {
      const r = await checkBan(resolvedId);
      if (!alive) return;
      if (r.ok !== false && r.banned) {
        setBanned(true);
        setReason((r.reason as string) || null);
        setRequested(!!r.unban_requested);
      } else {
        setBanned(false);
      }
    };
    check();
    const onVis = () => { if (!document.hidden) check(); };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onVis);
    return () => { alive = false; document.removeEventListener("visibilitychange", onVis); window.removeEventListener("focus", onVis); };
  }, [resolvedId]);

  // Not banned → render nothing (normal guests are unaffected).
  if (!banned) return null;

  // Send the unblock request: stamp the guest's number onto their blocklist row.
  const submit = async () => {
    const p = phone.trim();
    if (p.length < 5 || sending) return;
    setSending(true);
    const r = await requestUnban(p);
    setSending(false);
    if (r.ok) setRequested(true);
  };

  return (
    <div className="ban-overlay" role="dialog" aria-modal="true" aria-label="Access blocked">
      <div className="ban-card">
        <div className="ban-emoji" aria-hidden="true">🚫</div>
        <h1 className="ban-title">You&apos;ve been blocked</h1>
        <p className="ban-sub">
          Access to this menu has been blocked from this device{reason ? ` — ${reason}` : ""}. If you think
          this is a mistake, leave your number below and ask a member of staff to unblock you.
        </p>
        {requested ? (
          <p className="ban-done">✓ Your unblock request has been sent. Please speak to a member of staff.</p>
        ) : (
          <div className="ban-form">
            <input
              className="ban-input"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="Your mobile number"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
            <button className="ban-btn" disabled={sending || phone.trim().length < 5} onClick={submit}>
              {sending ? "Sending…" : "Request unblock"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
