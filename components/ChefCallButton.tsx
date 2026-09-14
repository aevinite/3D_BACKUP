// "use client" tells Next.js this is an interactive piece that runs in the
// visitor's browser (it can respond to taps), not just pre-built on the server.
"use client";

// Feature switches: when the restaurant turns waiter calls OFF, this button
// disappears entirely (as if the feature never existed).
import { useFeatures } from "@/lib/features";
import { useRestaurantId } from "@/lib/restaurant-context";

// ChefCallButton: the little "ring the bell" button. When a guest taps it, it
// shouts a message ("lfh:chef-call") out to the rest of the app, and whatever
// part of the app is listening for that message handles calling the waiter.
export default function ChefCallButton() {
  const features = useFeatures(useRestaurantId());
  if (!features.waiter_calls) return null; // switched off -> no bell at all

  return (
    // A REAL <button>, not a <div> with a tap handler (owner, 2026-09-14, item 1).
    //
    // It used to be a `<div className="chef-call" onClick={…}>`. A finger worked perfectly, which
    // is why nine sweeps never noticed: a div is not focusable, is not in the tab order, and is
    // announced by a screen reader as nothing at all. So the one control a diner uses to get a
    // human — the bell — was the single thing on the guest menu that a blind diner, or anyone
    // driving the page from a keyboard, could not reach. Nothing else changes: same class, same
    // fixed corner, same float animation, same icon.
    //
    // NOT A CHANGE TO WHERE THE BELL SITS. R29 in docs/REJECTED-IDEAS.md is explicit — the owner
    // reverted a built fix that made the bell move out of the way: "i want like previous bell of
    // call waiter should be stuck at his place we can scrool and click the thing make sure don't
    // change that again." This touches the ELEMENT, never its position, and `.chef-call` now
    // carries the three declarations (border/padding/font) that keep a <button> pixel-identical
    // to the <div> it replaces.
    //
    // dispatchEvent is like ringing a bell the whole app can hear: it sends out the
    // "lfh:chef-call" signal so another component can react to it.
    <button
      type="button"
      className="chef-call"
      aria-label="Call a waiter"
      onClick={() => window.dispatchEvent(new Event("lfh:chef-call"))}
    >
      {/* This <i> is just the bell icon (from the Font Awesome icon set). */}
      <i className="fas fa-bell-concierge" aria-hidden="true"></i>
    </button>
  );
}
