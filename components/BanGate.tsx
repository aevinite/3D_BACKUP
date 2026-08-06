"use client";

// BanGate — the full-screen "you've been blocked" wall for a banned guest. On load
// (and whenever the tab regains focus) it asks the server whether THIS device is
// banned; if so it covers the entire menu with a blocking overlay so a banned guest
// can't browse or order, and offers a single action: leave a mobile number to ask
// staff to unblock them (which surfaces on the manager's ban panel). When it's NOT
// banned it renders nothing, so normal guests never see it. (owner, 2026-06-22)

import { useEffect, useState } from "react";
import { checkBan, requestUnban } from "@/lib/session";
import { useRestaurantMeta } from "@/lib/restaurant-context";

export default function BanGate() {
  // The ban check is scoped to THIS restaurant so a ban at another restaurant
  // doesn't wall this one (mig 139 / audit fix 2026-07-06).
  //
  // `ready` matters here: on a /r/<slug> page the id starts as restaurant #1's and only
  // becomes the real one a beat later, so this used to ask the server TWICE per page load
  // — the first time about the wrong restaurant (guest sweep 2026-08-04). Waiting costs
  // nothing: with nothing rendered until an answer arrives, one request is strictly better
  // than two, and the first answer was about a restaurant the guest isn't at.
  const { id: restaurantId, ready } = useRestaurantMeta();
  const [banned, setBanned] = useState(false);          // is this device blocked?
  const [reason, setReason] = useState<string | null>(null); // optional staff reason
  const [requested, setRequested] = useState(false);    // has an unblock request already gone in?
  const [phone, setPhone] = useState("");               // the number the guest types
  const [sending, setSending] = useState(false);        // request in flight
  const [failed, setFailed] = useState(false);          // the server matched no block record

  // Ask the server on mount, and re-ask when the tab is refocused — so the moment
  // staff unblock them, the wall lifts on their next look without a manual reload.
  useEffect(() => {
    if (!ready) return; // the real restaurant id hasn't landed yet — don't ask about #1
    let alive = true;
    const check = async () => {
      const r = await checkBan(restaurantId);
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
    // `ready` is in the deps so the check runs exactly once, the moment the real
    // restaurant id is known — never once for #1 and again for the real one.
  }, [restaurantId, ready]);

  // Not banned → render nothing (normal guests are unaffected).
  if (!banned) return null;

  // Send the unblock request: stamp the guest's number onto their blocklist row.
  // ONLY claim it was sent when the server says a row actually changed (mig 304). It used to
  // answer ok:true unconditionally, so the guest saw "✓ sent" for a request that wrote nothing
  // and then waited for staff who had nothing to see — a tap reporting success it never had.
  const submit = async () => {
    const p = phone.trim();
    if (p.length < 5 || sending) return;
    setSending(true);
    setFailed(false);
    const r = await requestUnban(p, restaurantId);
    setSending(false);
    if (r.ok) setRequested(true);
    else setFailed(true); // refuse visibly rather than pretend
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
            {failed && (
              <p className="ban-fail" role="status">
                We couldn&apos;t match that number to this block. Please speak to a member of staff.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
