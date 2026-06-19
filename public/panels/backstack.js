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
  function reconcile() {
    pending = false;
    var target = layers.length;
    if (target > pushed) {
      for (var i = pushed; i < target; i++) history.pushState({ __lfhPanelLayer: true }, "");
      pushed = target;
    } else if (target < pushed) {
      var remove = pushed - target;
      pushed = target;
      ignore += remove;
      history.go(-remove);
    }
  }
  function schedule() { if (pending) return; pending = true; Promise.resolve().then(reconcile); }

  window.addEventListener("popstate", function () {
    if (ignore > 0) { ignore -= 1; return; }     // our own reconcile rewind, not a back press
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
