"use client";
// GuestOutboxChip — the GUEST's view of orders saved on their own phone.
//
// WHY IT EXISTS (T1 improvement 12, 2026-08-07)
//   lib/guestOutbox.ts has done the hard part for a while: when a diner taps Place order with no
//   signal, the order is written to this phone's storage and sent by itself when the connection is
//   back, at-most-once. What was missing was any way for the DINER to SEE it. All they got was the
//   red strip at the bottom saying "your order is saved and will send by itself" — true, but with
//   nothing to look at and nothing to touch.
//
//   That mattered because the queue can decide to STOP. After roughly four minutes of trying (six
//   rounds of the backoff) it gives up and marks the order failed, and it also fails an order whose
//   table was closed or billed while the phone was offline. `retryGuestFailed()` and
//   `dismissGuestFailed()` existed for exactly that moment — with no UI on the menu to call them.
//   So a diner could be told "it's saved, it'll send" and then never learn that it didn't.
//
// WHAT IT IS
//   A small chip in the bottom-left corner while anything is waiting. Tapping it opens a short list:
//   what the order was, when it was placed, and — for one that could not be sent — why, with
//   "Try again" and "Remove". Nothing here places or changes an order; it only shows the queue and
//   calls the two functions that already existed.
//
// WHERE IT SITS
//   The bottom-left corner is a shared stack (the order tracker lives there; the mini-cart is a
//   full-width bar on phones). This chip is the BOTTOM of that stack and lifts the order tracker
//   above it with a `data-lfh-outbox` body flag — the same trick MiniCart already uses on the
//   tracker. It also clears the offline strip via --lfh-offbar-h, because the moment this chip is
//   on screen is exactly the moment that strip is too.

import { useEffect, useState } from "react";
import { useBackClose } from "@/lib/backStack";
import {
  useGuestOutbox,
  retryGuestFailed,
  dismissGuestFailed,
  orderRestWithout,
  type GuestOrder,
} from "@/lib/guestOutbox";
import { formatPrice, getCurrency, DEFAULT_CURRENCY, type CurrencyMeta } from "@/lib/format";

// "7:42 pm", or "a moment ago" for something that just happened. Same shape as the offline
// strip's own wording (components/OfflineNotice.tsx) so the two read as one voice.
function whenText(ts: number): string {
  if (!ts) return "just now";
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 1) return "a moment ago";
  if (mins < 60) return `${mins} min ago`;
  const d = new Date(ts);
  let h = d.getHours();
  const m = d.getMinutes();
  const ap = h >= 12 ? "pm" : "am";
  h = h % 12 || 12;
  return `${h}:${m < 10 ? "0" : ""}${m} ${ap}`;
}

// "2 × Espresso, 1 × Croissant" — read from the summary the cart stored with the order, so this
// never has to re-price or re-read anything.
function itemsText(o: GuestOrder): string {
  const list = o.track?.items;
  if (Array.isArray(list) && list.length) {
    return list.map((i) => `${i.qty} × ${i.title}`).join(", ");
  }
  const n = o.track?.itemCount ?? (Array.isArray(o.items) ? o.items.length : 0);
  return n === 1 ? "1 item" : `${n} items`;
}

export default function GuestOutboxChip() {
  const { queued, failed, count } = useGuestOutbox();
  const [open, setOpen] = useState(false);
  const [currency, setCurrency] = useState<CurrencyMeta | null>(null);
  // Which row is mid-action. A tap on Try again / Remove has to show it was HEARD even though the
  // work is asynchronous — otherwise the button looks dead for a moment, which is the one thing
  // the "a tap must never vanish in silence" rule forbids.
  const [busyId, setBusyId] = useState<string | null>(null);

  // Phone back button closes the list first, instead of leaving the site.
  useBackClose("guest-outbox", open, () => setOpen(false));

  useEffect(() => {
    setCurrency(getCurrency());
    const onCur = () => setCurrency(getCurrency());
    window.addEventListener("lfh:currency-changed", onCur);
    return () => window.removeEventListener("lfh:currency-changed", onCur);
  }, []);

  // Tell the stylesheet the corner is occupied so the order tracker rises above it.
  useEffect(() => {
    if (count > 0) document.body.setAttribute("data-lfh-outbox", "1");
    else document.body.removeAttribute("data-lfh-outbox");
    return () => document.body.removeAttribute("data-lfh-outbox");
  }, [count]);

  // Nothing waiting → nothing on screen. The chip only ever appears because something real is
  // sitting on this phone.
  useEffect(() => { if (count === 0) setOpen(false); }, [count]);
  if (count === 0) return null;

  const act = async (id: string, fn: (id: string) => Promise<void>) => {
    if (busyId) return;          // one at a time; the row is already showing "…"
    setBusyId(id);
    try { await fn(id); } finally { setBusyId(null); }
  };

  const label = failed.length
    ? (failed.length === 1 ? "1 order couldn’t send" : `${failed.length} orders couldn’t send`)
    : (queued.length === 1 ? "1 order waiting to send" : `${queued.length} orders waiting to send`);

  return (
    <>
      <button
        type="button"
        className={`gob-chip ${failed.length ? "gob-failed" : ""}`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={label}
      >
        <i className={`fas ${failed.length ? "fa-triangle-exclamation" : "fa-cloud-arrow-up"}`} aria-hidden="true" />
        <span className="gob-chip-text">{label}</span>
      </button>

      {open && (
        <>
          {/* Tapping anywhere outside closes the list — and the backdrop is what makes that
              possible on a touch screen, where there is no "click away" without one. */}
          <div className="gob-backdrop" onClick={() => setOpen(false)} aria-hidden="true" />
          <div className="gob-sheet" role="dialog" aria-label="Orders saved on this phone">
            <div className="gob-head">
              <span>On this phone</span>
              <button type="button" className="gob-x" onClick={() => setOpen(false)} aria-label="Close">
                <i className="fas fa-times" aria-hidden="true" />
              </button>
            </div>

            {queued.map((o) => (
              <div key={o.id} className="gob-row">
                <div className="gob-row-main">
                  <div className="gob-row-title">{itemsText(o)}</div>
                  <div className="gob-row-sub">
                    Waiting to send · {whenText(o.at)}
                    {o.track?.total ? ` · ${formatPrice(String(o.track.total), currency || DEFAULT_CURRENCY)}` : ""}
                  </div>
                </div>
                {/* Deliberately NO buttons on a waiting order. It sends itself, and the only thing a
                    "cancel" here could do is throw away an order the kitchen may already have. */}
                <span className="gob-spin" aria-hidden="true"><i className="fas fa-circle-notch" /></span>
              </div>
            ))}

            {failed.map((o) => (
              <div key={o.id} className="gob-row gob-row-failed">
                <div className="gob-row-main">
                  <div className="gob-row-title">{itemsText(o)}</div>
                  {/* The queue's own sentence, written for a diner (lib/guestOutbox.ts reasonMsg) —
                      never a code and never the server's words. */}
                  <div className="gob-row-sub gob-why">{o.error || "This one couldn’t be sent."}</div>
                  <div className="gob-row-sub">{whenText(o.at)}</div>
                </div>
                <div className="gob-row-acts">
                  {/* ONE DISH WAS THE PROBLEM — offer the rest of the basket.
                      This existed only on the connection badge at the TOP of the menu, which is a
                      small icon nobody taps; THIS is the surface a diner actually sees, and it is
                      the one that was missing the rescue. A table of six losing everything because
                      one item ran out — and rebuilding the basket by hand, on a phone, having
                      already waited — is the whole reason the function was written.
                      Shown only when the phone still knows which line to drop and there is
                      something left after dropping it, so the button can never do nothing. */}
                  {o.blocked && (o.lines || []).length > 1 && (
                    <button
                      type="button"
                      className="gob-btn gob-rest"
                      disabled={busyId === o.id}
                      onClick={() => act(o.id, async (id) => { await orderRestWithout(id); })}
                    >
                      Order the rest
                    </button>
                  )}
                  <button
                    type="button"
                    className="gob-btn gob-retry"
                    disabled={busyId === o.id}
                    onClick={() => act(o.id, retryGuestFailed)}
                  >
                    {busyId === o.id ? "Sending…" : "Try again"}
                  </button>
                  <button
                    type="button"
                    className="gob-btn gob-drop"
                    disabled={busyId === o.id}
                    onClick={() => act(o.id, dismissGuestFailed)}
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}

            <div className="gob-foot">
              Saved on this phone only. Anything still waiting sends by itself the moment you’re
              back online.
            </div>
          </div>
        </>
      )}
    </>
  );
}
