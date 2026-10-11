// backstack.js — the vanilla-JS sibling of lib/backStack.ts, for the staff panels
// (kitchen / tablet / editor). They run inside an <iframe>, and a history.pushState
// made INSIDE an iframe feeds the shared browser history — so the phone's hardware
// BACK button pops the iframe entry (closing the top drawer/modal) instead of
// leaving the panel.
//
// No "Leave this site?" guard here (unlike the guest app): a staff member pressing
// back with nothing open SHOULD leave the panel — they hop panels via the admin
// switcher, so guarding the exit would only get in their way.
//
// USAGE (one line per overlay, the moment it opens):
//   var off = LFH_BACK.layer("86-board", closeDrawer);  // closeDrawer hides it
//   ...and call off() inside your OWN close path (✕ / backdrop / completion).
// Closing via the back button calls your close() for you and auto-unregisters.
(function () {
  "use strict";
  if (window.LFH_BACK) return; // one manager per frame

  var layers = [];   // [{ id, close }] — open overlays, top = last
  var pushed = 0;    // history entries we've added that are still live
  var ignore = 0;    // popstate events WE triggered (history.go) — swallow them
  var pending = false;

  // Add/drop history entries until there's exactly one per open overlay. Runs once
  // per microtask so a burst of opens/closes collapses into a single change.
  // A REWIND THAT HAS NOT LANDED YET MUST NOT BE STACKED ON (sweep #10 T16, 2026-10-12; reported by
  // the T12 waiter-tablet sweep). history.go(-N) is ASYNCHRONOUS. A card that closes and a second card
  // that opens straight after (the "Yes → why?" shape: Mark unpaid → Yes → the reason card) used to
  // pushState the second card's entry BEFORE the rewind for the first had landed. The rewind then
  // took the panel back over the new entry, `pushed` stayed one too high, and the NEXT close rewound
  // past the panel's own entry — on /tablet the whole page went back, out of the panel. Driven: with
  // the second card opened a microtask or a 0ms timeout after the first closed, Cancel on it left the
  // page every time.
  //
  // So while a rewind is in flight nothing is pushed or rewound; the popstate that ends it re-runs
  // reconcile, and from a settled history the count is exact again. The timer is a seat belt for a
  // browser that never delivers that popstate: without it Back would stop closing overlays at all.
  var rewindWait = null;
  function settleRewind() {
    if (rewindWait) { clearTimeout(rewindWait); rewindWait = null; }
    schedule();
  }
  function reconcile() {
    pending = false;
    if (ignore > 0) {
      if (!rewindWait) rewindWait = setTimeout(function () { rewindWait = null; ignore = 0; schedule(); }, 1500);
      return;
    }
    var target = layers.length;
    if (target > pushed) {
      for (var i = pushed; i < target; i++) history.pushState({ __lfhPanelLayer: true }, "");
      pushed = target;
    } else if (target < pushed) {
      // history.go(-N) fires exactly ONE popstate (not N) for same-document
      // entries, so swallow exactly ONE regardless of N (see lib/backStack.ts).
      var remove = pushed - target;
      pushed = target;
      ignore += 1;
      history.go(-remove);
    }
  }
  function schedule() { if (pending) return; pending = true; Promise.resolve().then(reconcile); }

  window.addEventListener("popstate", function () {
    // our own reconcile rewind, not a back press — and once it has landed, catch up with whatever
    // opened or closed while it was in flight (see the note above reconcile)
    if (ignore > 0) { ignore -= 1; if (ignore === 0) settleRewind(); return; }
    if (pushed > 0) {
      pushed -= 1;
      var top = layers.pop();                      // drop the top overlay to match
      if (top) { try { top.close(); } catch (e) { /* never let a close throw break back */ } }
      return;
    }
    // pushed === 0 → nothing open; let the back press leave the panel.
  });

  window.LFH_BACK = {
    layer: function (id, close) {
      var layer = { id: id, close: close };
      layers.push(layer);
      schedule();
      return function unregister() {
        var i = layers.indexOf(layer);
        if (i === -1) return;   // already removed by a back press → nothing to rewind
        layers.splice(i, 1);
        schedule();             // closed via UI → reconcile() rewinds its buffer entry
      };
    },
  };
})();
