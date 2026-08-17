// undobar.js — the shared "just undo that" bar for the staff panels
// (manager/kitchen/tablet). The owner's ask (2026-07-22): after a mis-tap on
// Serve / Ready / Settle, staff get a few seconds to take it back.
//
// DESIGN — "ring card" (owner chose this of 3 options, 2026-07-22): a card in the
// panel's own colours with a DISH ICON wrapped in a GOLD COUNTDOWN RING. The ring
// starts as a full circle and drains away as the seconds run out; when it's gone the
// window is over and the card disappears. There is deliberately NO faint "track"
// circle behind it — the owner wants the circle to genuinely vanish, not leave a
// ghost outline. Dish name is in the panel's Playfair display serif, with a muted
// second line, and UNDO is an outlined gold button.
//
// It is ONE shared module (like connbadge.js / backstack.js) so the bar looks and
// behaves identically in every panel — each panel only calls:
//   LFH_UNDO.show({ message, sub, onUndo })  right after the action fires.
//
// Latest-wins (owner's choice): a new show() replaces the current card and resets the
// timer, so only the most recent action is undoable — no clutter on a busy floor. It
// carries ZERO egress on its own: showing/hiding is pure DOM; the only network call is
// the caller's onUndo(), and only if the staff taps it.
(function () {
  var DEFAULT_SECONDS = 4;  // the takeback window the owner asked for ("maybe 3 or 4 sec")
  var RING_LEN = 113;       // circumference of r=18 (2·π·18 ≈ 113.1) — the dash length

  var el = null;     // the singleton card element (reused, never re-created)
  var titleEl = null;// the bold serif line ("Butter Chicken served")
  var subEl = null;  // the muted second line ("Table 5 · …")
  var btnEl = null;  // the UNDO button
  var ringEl = null; // the draining gold circle (SVG <circle>)
  var iconEl = null; // the dish glyph inside the ring
  var timer = null;  // the auto-dismiss timer
  var busy = false;  // true once UNDO has been tapped (blocks a double-tap)

  function injectStyles() {
    if (document.getElementById("lfh-undo-style")) return;
    // Every colour comes from the panel's OWN tokens (var(--panel) / --gold / --line …)
    // with a dark-theme fallback, so the card matches whichever panel + light/dark
    // theme it's rendered in. --sab is the reusable safe-area bottom var the panels
    // define (safe-area-all-devices, 2026-07-20) so it never sits under a nav bar.
    var css = [
      "#lfh-undobar{position:fixed;left:50%;transform:translateX(-50%) translateY(150%);",
      "bottom:calc(16px + var(--sab, env(safe-area-inset-bottom, 0px)));z-index:2147483000;",
      "display:flex;align-items:center;gap:14px;max-width:min(520px,calc(100vw - 24px));",
      "padding:12px 14px;border-radius:var(--radius,12px);",
      "background:var(--panel,#1d1812);color:var(--text,#f2e9da);",
      "border:1px solid var(--line,#38301f);",
      "font:14px/1.35 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;",
      "box-shadow:var(--shadow-md,0 14px 34px rgba(0,0,0,.42));opacity:0;pointer-events:none;",
      "transition:transform .26s cubic-bezier(.2,.9,.3,1),opacity .2s ease;}",
      "#lfh-undobar.show{transform:translateX(-50%) translateY(0);opacity:1;pointer-events:auto;}",
      // ── the ring + dish icon ──────────────────────────────────────────────
      "#lfh-undobar .lfh-undo-ring{position:relative;flex:none;width:42px;height:42px;",
      "display:grid;place-items:center;}",
      "#lfh-undobar .lfh-undo-ring svg{position:absolute;inset:0;transform:rotate(-90deg);}",
      // NO track circle on purpose — the gold ring must vanish completely.
      "#lfh-undobar .lfh-undo-arc{stroke:var(--gold,#d4a574);stroke-width:2.5;fill:none;",
      "stroke-linecap:round;stroke-dasharray:" + RING_LEN + "px;stroke-dashoffset:0px;}",
      "#lfh-undobar .lfh-undo-ico{font-size:17px;line-height:1;}",
      // ── the text block ────────────────────────────────────────────────────
      "#lfh-undobar .lfh-undo-txt{flex:1;min-width:0;}",
      "#lfh-undobar .lfh-undo-title{display:block;font:600 14.5px/1.25 var(--display,Georgia,serif);",
      "letter-spacing:.2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}",
      "#lfh-undobar .lfh-undo-sub{display:block;color:var(--muted,#a8997f);font-size:12px;",
      "white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}",
      // ── the UNDO button (outlined gold, ≥40px tap target) ─────────────────
      "#lfh-undobar .lfh-undo-btn{flex:none;appearance:none;cursor:pointer;",
      "border:1px solid var(--gold,#d4a574);background:transparent;color:var(--gold,#d4a574);",
      "border-radius:10px;font:800 12.5px/1 system-ui,sans-serif;letter-spacing:.05em;",
      "text-transform:uppercase;padding:0 16px;min-height:40px;min-width:64px;",
      "transition:background .12s ease,transform .08s ease;}",
      "#lfh-undobar .lfh-undo-btn:hover{background:rgba(212,165,116,.14);}",
      "#lfh-undobar .lfh-undo-btn:active{transform:scale(.96);}",
      "@media (prefers-reduced-motion:reduce){#lfh-undobar{transition:opacity .2s ease;",
      "transform:translateX(-50%) translateY(0);}}",
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

    var ringWrap = document.createElement("div");
    ringWrap.className = "lfh-undo-ring";
    // Built via innerHTML because SVG children need the SVG namespace.
    ringWrap.innerHTML =
      '<svg viewBox="0 0 42 42" aria-hidden="true">' +
      '<circle class="lfh-undo-arc" cx="21" cy="21" r="18"></circle></svg>' +
      '<span class="lfh-undo-ico">🍽️</span>';
    ringEl = ringWrap.querySelector(".lfh-undo-arc");
    iconEl = ringWrap.querySelector(".lfh-undo-ico");

    var txt = document.createElement("div");
    txt.className = "lfh-undo-txt";
    titleEl = document.createElement("b");
    titleEl.className = "lfh-undo-title";
    subEl = document.createElement("small");
    subEl.className = "lfh-undo-sub";
    txt.appendChild(titleEl);
    txt.appendChild(subEl);

    btnEl = document.createElement("button");
    btnEl.className = "lfh-undo-btn";
    btnEl.type = "button";

    el.appendChild(ringWrap);
    el.appendChild(txt);
    el.appendChild(btnEl);
    document.body.appendChild(el);
  }

  function clearTimer() {
    if (timer) { clearTimeout(timer); timer = null; }
  }

  // TELL THE PANEL WE ARE ON SCREEN (T12 phone sweep, 2026-08-05). This card and each panel's
  // toast are both centred at the bottom ~8px apart, so on a 360px phone a "1 new order" toast
  // landed ON the "Undo serve" card — and the undo is the one with a deadline. A body class plus
  // the measured height let the toast step over us; nothing here depends on the panel reacting.
  function markBody(up) {
    try {
      document.body.classList.toggle("lfh-undobar-up", !!up);
      if (up && el) document.body.style.setProperty("--lfh-undobar-h", Math.round(el.getBoundingClientRect().height) + "px");
      else document.body.style.removeProperty("--lfh-undobar-h");
    } catch (_) { /* a cosmetic hint; never let it break an undo */ }
  }

  function hide() {
    clearTimer();
    if (el) el.classList.remove("show");
    markBody(false);
  }

  // Start (or restart) the draining ring + the auto-dismiss timer for `seconds`.
  // NOTE: stroke-dashoffset MUST carry a unit — a bare number is rejected by CSS and
  // the ring silently never animates (that bug shipped a static circle once).
  function runCountdown(seconds, onExpire) {
    ringEl.style.transition = "none";
    ringEl.style.strokeDashoffset = "0px";        // full circle
    void ringEl.getBoundingClientRect();          // force reflow so the reset sticks
    ringEl.style.transition = "stroke-dashoffset " + seconds + "s linear";
    ringEl.style.strokeDashoffset = RING_LEN + "px"; // drains away to nothing
    clearTimer();
    timer = setTimeout(function () {
      timer = null;
      hide();
      if (typeof onExpire === "function") { try { onExpire(); } catch (e) {} }
    }, seconds * 1000);
  }

  // The one public call. opts:
  //   message   (string) — what happened, e.g. "Butter Chicken served".
  //   sub       (string) — optional second line, e.g. "Table 5".
  //   onUndo    (fn)     — runs when staff taps UNDO (may return a Promise).
  //   seconds   (number) — takeback window, default 4.
  //   undoLabel (string) — button text, default "Undo".
  //   icon      (string) — glyph inside the ring, default a dish.
  //   onExpire  (fn)     — optional, runs if the window closes without an undo.
  function show(opts) {
    opts = opts || {};
    build();
    busy = false;
    var seconds = opts.seconds != null ? opts.seconds : DEFAULT_SECONDS;
    titleEl.textContent = opts.message || "Done";
    subEl.textContent = opts.sub || "Tap undo to put it back";
    btnEl.textContent = opts.undoLabel || "Undo";
    if (opts.icon) iconEl.textContent = opts.icon;

    btnEl.onclick = function () {
      if (busy) return;                        // guard the double-tap
      busy = true;
      clearTimer();
      // Hide IMMEDIATELY so the tap feels instant — the revert applies optimistically
      // on-screen and the network write runs in the background (callers each show their
      // own error toast if it fails). Waiting for the round-trip left the card sitting
      // there for seconds on a slow link.
      hide();
      if (typeof opts.onUndo === "function") {
        try { Promise.resolve(opts.onUndo()).catch(function () {}); } catch (e) {}
      }
    };

    // THE WINDOW RUNS ON THE CLOCK, NOT ON PAINTS (T9 sweep, 2026-08-17).
    //
    // The slide-in waited on two requestAnimationFrames, and a browser does not run those in a
    // BACKGROUND tab — so a Serve tapped a moment before a waiter's tablet went to sleep, or
    // before they switched app, produced no card and started no countdown at all. When they came
    // back minutes later the frames finally ran and the card slid in offering a live four-second
    // "Undo" for something the kitchen had long since started cooking. Measured headless with
    // rAF suspended: card built, never shown, timer never armed.
    //
    // So: when the tab is hidden the reveal runs on a timer instead, and either way it first
    // checks how much of the window is really left. A take-back offered for something done
    // minutes ago is worse than no take-back at all, so an expired one is dropped rather than
    // shown late. `revealed` makes the two schedulers idempotent.
    var askedAt = Date.now();
    var revealed = false;
    function reveal() {
      if (revealed) return;
      revealed = true;
      var leftMs = seconds * 1000 - (Date.now() - askedAt);
      if (leftMs <= 0) {                                  // the window ran out while we waited
        hide();
        if (typeof opts.onExpire === "function") { try { opts.onExpire(); } catch (e) {} }
        return;
      }
      el.classList.add("show");
      runCountdown(leftMs / 1000, opts.onExpire);
      markBody(true);
    }

    // latest-wins: if a card is ALREADY up, just swap its text and restart the ring in
    // place — no slide-out/in flicker. Otherwise slide it in (two rAFs so the browser
    // registers the off-screen start before the transition).
    if (el.classList.contains("show")) {
      runCountdown(seconds, opts.onExpire);
      markBody(true);   // re-measure: swapped text can change the card's height
    } else if (document.hidden) {
      reveal();         // no frames are coming — start the clock now
    } else {
      requestAnimationFrame(function () { requestAnimationFrame(reveal); });
      // …and a backstop, for the tab that goes hidden BETWEEN this line and those frames.
      setTimeout(reveal, 400);
    }
  }

  // Let a panel dismiss the card itself (e.g. the underlying data changed and an undo
  // no longer makes sense). Optional; most callers never need it.
  function dismiss() { hide(); }

  window.LFH_UNDO = { show: show, dismiss: dismiss };
})();
