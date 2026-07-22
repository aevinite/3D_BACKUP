// undobar.js — the shared "just undo that" bar for the staff panels
// (manager/kitchen/tablet). The owner's ask (2026-07-22): after a mis-tap on
// Serve / Ready / Settle, staff get a few seconds to take it back — a bottom
// bar with a countdown LINE that shrinks left→right and, when it reaches the
// end, the bar quietly disappears and the action is final. Same idea as
// Gmail's "Undo send": do the thing instantly, offer a short takeback window.
//
// It is deliberately its ONE shared module (like connbadge.js / backstack.js)
// so the bar looks and behaves identically in every panel — each panel only
// calls:  LFH_UNDO.show({ message, onUndo })  right after the action fires.
//
// Latest-wins (owner's choice): a new show() replaces the current bar and
// resets the timer, so only the most recent action is undoable — no clutter on
// a busy floor. It carries ZERO egress on its own: showing/hiding is pure DOM;
// the only network call is the caller's onUndo(), and only if the staff taps it.
(function () {
  var DEFAULT_SECONDS = 4; // the takeback window the owner asked for ("maybe 3 or 4 sec")

  var el = null;     // the singleton bar element (reused, never re-created)
  var msgEl = null;  // the message text span
  var btnEl = null;  // the UNDO button
  var lineEl = null; // the shrinking countdown line
  var timer = null;  // the auto-dismiss timer
  var busy = false;  // true while an onUndo() is running (blocks double-taps)

  function injectStyles() {
    if (document.getElementById("lfh-undo-style")) return;
    // --sab is the reusable safe-area bottom var every panel CSS now defines
    // (safe-area-all-devices, 2026-07-20); fall back to env() then 0 so the bar
    // never hides under a phone's gesture/nav bar.
    var css = [
      "#lfh-undobar{position:fixed;left:50%;transform:translateX(-50%) translateY(150%);",
      "bottom:calc(16px + var(--sab, env(safe-area-inset-bottom, 0px)));z-index:2147483000;",
      "display:flex;align-items:center;gap:14px;max-width:min(520px,calc(100vw - 24px));",
      "padding:12px 14px 14px;border-radius:14px;overflow:hidden;",
      "background:#1f2937;color:#f8fafc;font:600 14px/1.3 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;",
      "box-shadow:0 12px 34px rgba(0,0,0,.42);opacity:0;pointer-events:none;",
      "transition:transform .26s cubic-bezier(.2,.9,.3,1),opacity .2s ease;}",
      "#lfh-undobar.show{transform:translateX(-50%) translateY(0);opacity:1;pointer-events:auto;}",
      "#lfh-undobar .lfh-undo-msg{flex:1;min-width:0;}",
      "#lfh-undobar .lfh-undo-btn{flex:none;appearance:none;border:0;cursor:pointer;",
      "background:#f4b740;color:#1a1205;font:800 13px/1 system-ui,sans-serif;letter-spacing:.04em;",
      "text-transform:uppercase;padding:10px 16px;border-radius:10px;min-height:40px;min-width:64px;",
      "transition:filter .12s ease,transform .08s ease;}",
      "#lfh-undobar .lfh-undo-btn:hover{filter:brightness(1.06);}",
      "#lfh-undobar .lfh-undo-btn:active{transform:scale(.96);}",
      "#lfh-undobar .lfh-undo-btn:disabled{opacity:.6;cursor:default;}",
      // the countdown line: full width, shrinks to 0 via a transform transition.
      "#lfh-undobar .lfh-undo-line{position:absolute;left:0;bottom:0;height:3px;width:100%;",
      "background:#f4b740;transform-origin:left center;transform:scaleX(1);border-radius:0 0 14px 14px;}",
      "@media (prefers-reduced-motion:reduce){#lfh-undobar{transition:opacity .2s ease;transform:translateX(-50%) translateY(0);}}",
    ].join("");
    var s = document.createElement("style");
    s.id = "lfh-undo-style";
    s.textContent = css;
    document.head.appendChild(s);
  }

  function build() {
    if (el) return;
    injectStyles();
    el = document.createElement("div");
    el.id = "lfh-undobar";
    el.setAttribute("role", "status");        // announced by screen readers, non-interrupting
    el.setAttribute("aria-live", "polite");
    msgEl = document.createElement("span");
    msgEl.className = "lfh-undo-msg";
    btnEl = document.createElement("button");
    btnEl.className = "lfh-undo-btn";
    btnEl.type = "button";
    lineEl = document.createElement("div");
    lineEl.className = "lfh-undo-line";
    el.appendChild(msgEl);
    el.appendChild(btnEl);
    el.appendChild(lineEl);
    document.body.appendChild(el);
  }

  function clearTimer() {
    if (timer) { clearTimeout(timer); timer = null; }
  }

  // Slide the bar away and stop the countdown. `hard` skips the exit animation
  // (used right before re-showing so a replacement doesn't flicker).
  function hide(hard) {
    clearTimer();
    if (!el) return;
    if (hard) { el.classList.remove("show"); return; }
    el.classList.remove("show");
  }

  // Start (or restart) the shrinking line + auto-dismiss timer for `seconds`.
  function runCountdown(seconds, onExpire) {
    // reset the line to full width with NO transition, then on the next frame
    // give it a transition and shrink it — that's what makes it animate.
    lineEl.style.transition = "none";
    lineEl.style.transform = "scaleX(1)";
    // force reflow so the browser registers the reset before we animate
    void lineEl.offsetWidth;
    lineEl.style.transition = "transform " + seconds + "s linear";
    lineEl.style.transform = "scaleX(0)";
    clearTimer();
    timer = setTimeout(function () {
      timer = null;
      hide(false);
      if (typeof onExpire === "function") { try { onExpire(); } catch (e) {} }
    }, seconds * 1000);
  }

  // The one public call. opts:
  //   message   (string)   — what happened, e.g. "Table 5 served".
  //   onUndo    (fn)        — runs when staff taps UNDO (may return a Promise).
  //   seconds   (number)    — takeback window, default 4.
  //   undoLabel (string)    — button text, default "Undo".
  //   onExpire  (fn)        — optional, runs if the window closes without an undo.
  function show(opts) {
    opts = opts || {};
    build();
    busy = false;
    var seconds = opts.seconds != null ? opts.seconds : DEFAULT_SECONDS;
    msgEl.textContent = opts.message || "Done";
    btnEl.textContent = opts.undoLabel || "Undo";
    btnEl.disabled = false;

    btnEl.onclick = function () {
      if (busy) return;                        // guard the double-tap
      if (typeof opts.onUndo !== "function") { hide(false); return; }
      busy = true;
      btnEl.disabled = true;
      clearTimer();                            // clicking undo cancels the auto-dismiss
      // Freeze the line where it is so it doesn't keep shrinking while undoing.
      var cs = getComputedStyle(lineEl).transform;
      lineEl.style.transition = "none";
      lineEl.style.transform = cs && cs !== "none" ? cs : "scaleX(0)";
      Promise.resolve()
        .then(function () { return opts.onUndo(); })
        .then(function () { hide(false); })
        .catch(function () {
          // The revert call failed — let the caller's own error toast speak;
          // just re-arm the bar briefly so the staff isn't left staring at a
          // dead button, then fade out.
          busy = false;
          btnEl.disabled = false;
          runCountdown(seconds, opts.onExpire);
        });
    };

    // latest-wins: if a bar is ALREADY up, just swap its text/handlers and restart
    // the countdown in place — no slide-out/in flicker. Otherwise slide it in (two
    // rAFs so the browser registers the off-screen start before the transition).
    if (el.classList.contains("show")) {
      runCountdown(seconds, opts.onExpire);
    } else {
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          el.classList.add("show");
          runCountdown(seconds, opts.onExpire);
        });
      });
    }
  }

  // Let a panel dismiss the bar itself (e.g. the underlying data changed and an
  // undo no longer makes sense). Optional; most callers never need it.
  function dismiss() { hide(false); }

  window.LFH_UNDO = { show: show, dismiss: dismiss };
})();
