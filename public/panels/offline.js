/* offline.js — the HONEST OFFLINE READOUT for the staff panels.
 *
 * Three jobs, one small file:
 *
 *  1. A slim bar under the top bar that says what's actually true right now:
 *       "Offline — showing saved data from 7:42 pm · 3 changes waiting to send"
 *     Staff must never have to guess whether what they're looking at is live. The
 *     service worker (public/sw.js) labels every reply it served from the device with
 *     'X-LFH-From-Cache' + 'X-LFH-Cached-At'; each panel's api() hands those to
 *     noteResponse() below, so the age shown is the real age of the data.
 *
 *  2. A "Needs you" sheet: the changes that could NOT be applied when the connection
 *     came back — because someone else did something to the same table meanwhile, or
 *     the table was closed/paid while this device was offline. Each row says, in plain
 *     words, what happened and what to do, with "Do it again" / "Not needed".
 *     A change is NEVER silently dropped and NEVER silently applied over someone else's
 *     work: that's the whole point of the clash check on the server (lib/clash.ts).
 *
 *  3. It keeps the count of what's still saved on-device in front of the user, so
 *     nobody closes a tab thinking everything went through.
 *
 * Loaded after outbox.js + backstack.js on every staff panel.
 */
(function () {
  var stale = { fromCache: false, at: 0, seenOfflineRead: false };
  var box = { queued: [], failed: [], count: 0 };
  var bar = null, sheet = null, backOff = null;
  // How long a saved change may sit before the bar stops calling it "Sending…" and says plainly
  // that it hasn't gone. Long enough to cover a normal reconnect + a couple of retries.
  var STUCK_MS = 90000;
  try { if (window.LFH_TEST_PACING && window.LFH_TEST_PACING.stuck) STUCK_MS = window.LFH_TEST_PACING.stuck; } catch (e) {}

  // The person asking for it NOW. Never a dead tap: it always leaves a trace on screen.
  function sendNow() {
    if (!window.LFH_OUTBOX) return;
    nudgedAt = Date.now();       // makes the bar read "Sending…" again while this round runs
    render();
    try { window.LFH_OUTBOX.flush(); } catch (e) {}
  }
  var nudgedAt = 0;

  function isOffline() { return navigator.onLine === false; }

  // How long saved data has been on screen without a live socket. See connIsBad().
  var staleSince = 0;
  // A RELOAD ON A BAD LINE NEVER CONNECTS AT ALL, and that used to read as "fine".
  // `everConnected` is false in two completely different situations: the first second of a
  // healthy boot (stay quiet — the socket is about to come up), and a panel reloaded on a
  // crawling connection where it never will. Measured 2026-08-12 with every read held for 12s:
  // the manager floor painted 31 tiles from a copy saved at 9:06 pm, and the bar did not appear.
  // So "never connected" is judged on TIME, not treated as innocent: if the saved board has been
  // on screen this long and live updates still are not flowing, they are not coming.
  //
  // Short on purpose. The only way we reach this test at all is that a read STALLED and was
  // answered from the device — the service worker waits 6 seconds before doing that — so by the
  // time this clock starts the connection has already failed to answer for six seconds, and this
  // is not a healthy boot however much `everConnected` looks like one. So this is only long
  // enough to swallow a single-frame flash, not a judgement. Measured: at 5s the bar arrived
  // about eleven seconds after the reload — far too late to stop someone settling a bill against
  // a stale board, which is the whole reason it exists.
  var NEVER_CONNECTED_SETTLE_MS = 1200;

  // Is the connection ACTUALLY bad? Same source the connection badge reads, so the bar and
  // the badge can never contradict each other.
  function connIsBad() {
    if (isOffline()) return true;
    try {
      var rt = window.LFH_RT;
      if (rt && rt.getStatus) {
        var st = rt.getStatus();
        // "online" = live updates are flowing → the connection is fine, whatever one slow
        // read did. Only a real drop (after we HAD been connected) counts as bad.
        if (st === "online") return false;
        if (st === "offline") return true;
        if (rt.everConnected && rt.everConnected()) return true; // reconnecting after a real drop
        // Never connected in this session — see NEVER_CONNECTED_SETTLE_MS above.
        return !!staleSince && (Date.now() - staleSince) > NEVER_CONNECTED_SETTLE_MS;
      }
    } catch (e) { /* fall through */ }
    return false;
  }

  function fmtTime(ts) {
    if (!ts) return "earlier";
    var d = new Date(ts), now = Date.now();
    var mins = Math.floor((now - ts) / 60000);
    if (mins < 1) return "a moment ago";
    if (mins < 60) return mins + " min ago";
    var h = d.getHours(), m = d.getMinutes();
    var ap = h >= 12 ? "pm" : "am"; h = h % 12 || 12;
    return h + ":" + (m < 10 ? "0" : "") + m + " " + ap;
  }

  // ── what every panel's api() calls on each GET reply ─────────────────────────
  // Handed the raw Response so it can read the service worker's provenance headers.
  function noteResponse(res) {
    try {
      if (!res || !res.headers) return;
      var fromCache = res.headers.get("X-LFH-From-Cache") === "1";
      var offlineRead = res.headers.get("X-LFH-Offline") === "1";
      if (offlineRead) { stale.seenOfflineRead = true; render(); return; }
      if (fromCache) {
        if (!stale.fromCache) staleSince = Date.now();   // first saved reply of this spell
        stale.fromCache = true;
        stale.at = Number(res.headers.get("X-LFH-Cached-At") || 0) || Date.now();
        // AUTO-HEAL: don't wait for the next poll tick. Ask the panel to refetch shortly, and
        // forget the stale flag by itself if nothing else comes from the device — so a single
        // slow read can never leave a warning stuck on screen. ("It should autostart and work.")
        scheduleHeal();
      } else if (res.ok) {
        // A genuinely fresh reply means we're live again — stop claiming we're stale.
        stale.fromCache = false; stale.seenOfflineRead = false; stale.at = 0; staleSince = 0;
        if (healTimer) { clearTimeout(healTimer); healTimer = null; }
        if (forgetTimer) { clearTimeout(forgetTimer); forgetTimer = null; }
      }
      render();
    } catch (e) { /* never let the readout break a real request */ }
  }

  var healTimer = null, forgetTimer = null;
  function scheduleHeal() {
    if (!healTimer) {
      healTimer = setTimeout(function () {
        healTimer = null;
        if (isOffline()) return;                 // nothing to fetch yet
        // The panels listen for this and reload their own data (same handler as a finished
        // sync), which is what clears the stale flag for real.
        try { window.dispatchEvent(new CustomEvent("lfh:stale-refresh")); } catch (e) {}
      }, 2500);
    }
    // …and one re-draw once the "never connected" settle has passed, so the bar appears on a
    // panel that is sitting still. Nothing else re-renders in that window: the 2s tick only runs
    // while changes are queued, and the heartbeat is 30s — long enough for a manager to read a
    // saved floor labelled "live" and act on it. No network, no database.
    setTimeout(render, NEVER_CONNECTED_SETTLE_MS + 250);
    // And a hard stop: if no further saved replies arrive, drop the flag regardless.
    clearTimeout(forgetTimer);
    forgetTimer = setTimeout(function () {
      stale.fromCache = false; stale.seenOfflineRead = false; stale.at = 0; staleSince = 0; render();
    }, 25000);
  }

  // ── styles ───────────────────────────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById("lfh-off-style")) return;
    var css = [
      // SOLID, saturated tones with white text. The panels ship in BOTH a light and a dark
      // skin, and the first version used pale tints that were legible on dark and almost
      // invisible on light (checked on the owner's phone). One strong colour reads on both.
      // The bar sits ABOVE the panel's top bar, so IT is the element that must clear a
      // notch/status bar (--sat is the real inset PanelFrame injects; env() reads 0 in an iframe).
      ".lfh-offbar{display:flex;align-items:center;gap:10px;padding:calc(9px + var(--sat, 0px)) 14px 9px;",
      "  font:700 12.5px/1.35 system-ui,sans-serif;",
      "  color:#fff;position:relative;z-index:60}",
      ".lfh-offbar.tone-off{background:#dc2626}",
      ".lfh-offbar.tone-stale{background:#d97706}",
      ".lfh-offbar.tone-sync{background:#0284c7}",
      ".lfh-offbar.tone-bad{background:#b91c1c}",
      ".lfh-offbar-dot{width:9px;height:9px;border-radius:999px;background:#fff;flex:0 0 auto;animation:lfhOffPulse 1.6s ease-in-out infinite}",
      "@keyframes lfhOffPulse{0%,100%{opacity:1}50%{opacity:.4}}",
      ".lfh-offbar-t{flex:1;min-width:0;font-weight:800}",
      ".lfh-offbar-t small{display:block;font-weight:600;opacity:.92;font-size:11.5px}",
      ".lfh-offbar-btn{border:0;border-radius:8px;padding:7px 12px;font:800 11.5px/1 system-ui,sans-serif;cursor:pointer;",
      "  background:#fff;flex:0 0 auto}",
      ".lfh-offbar-btn span{color:#111827}",
      // the secondary button next to it (e.g. "See" beside "Send now") — readable on the same
      // solid bar without competing with the action we want tapped
      ".lfh-offbar-alt{background:rgba(255,255,255,.22);box-shadow:inset 0 0 0 1px rgba(255,255,255,.55)}",
      ".lfh-offbar-alt span{color:#fff}",
      /* the needs-you sheet */
      ".lfh-off-back{position:fixed;inset:0;z-index:99998;background:rgba(4,8,18,.6);backdrop-filter:blur(3px);",
      "  display:flex;align-items:flex-end;justify-content:center;padding:0}",
      "@media(min-width:700px){.lfh-off-back{align-items:center;padding:24px}}",
      ".lfh-off-sheet{width:min(560px,100%);max-height:min(84vh,720px);overflow:auto;background:var(--panel,#0f1830);",
      "  color:var(--text,#e7eefc);border:1px solid var(--line,rgba(127,127,127,.28));border-radius:18px 18px 0 0;",
      "  padding:18px 18px calc(18px + var(--safe-b,0px));box-shadow:0 -18px 60px rgba(0,0,0,.5);",
      "  font:500 13.5px/1.45 system-ui,sans-serif}",
      "@media(min-width:700px){.lfh-off-sheet{border-radius:18px}}",
      ".lfh-off-hd{display:flex;align-items:flex-start;gap:10px;margin-bottom:4px}",
      ".lfh-off-hd h3{margin:0;font-size:16.5px;font-weight:800;flex:1}",
      ".lfh-off-hd p{margin:6px 0 0;font-size:12.5px;opacity:.75;font-weight:500}",
      ".lfh-off-x{border:0;background:rgba(127,127,127,.18);color:inherit;border-radius:10px;width:32px;height:32px;",
      "  font-size:16px;cursor:pointer;flex:0 0 auto}",
      ".lfh-off-item{margin-top:12px;padding:12px 13px;border-radius:13px;background:rgba(239,68,68,.09);",
      "  border:1px solid rgba(239,68,68,.28)}",
      ".lfh-off-item.is-wait{background:rgba(56,189,248,.08);border-color:rgba(56,189,248,.26)}",
      ".lfh-off-item b{display:block;font-size:13.5px;font-weight:800}",
      ".lfh-off-why{margin:5px 0 0;font-size:12.5px;opacity:.9}",
      ".lfh-off-do{margin:8px 0 0;font-size:12.5px;font-weight:800;color:#d97706}",
      ".lfh-off-when{margin-top:6px;font-size:11.5px;opacity:.6;font-weight:600}",
      ".lfh-off-acts{display:flex;gap:8px;margin-top:11px;flex-wrap:wrap}",
      ".lfh-off-acts button{border:0;border-radius:9px;padding:9px 13px;font:800 12px/1 system-ui,sans-serif;cursor:pointer}",
      ".lfh-off-ok{background:#22c55e;color:#052e16}",
      ".lfh-off-ghost{background:rgba(127,127,127,.22);color:inherit}",
      /* armed = "tap again to discard". Red, because the next tap destroys the change. */
      ".lfh-off-ghost.is-armed{background:#dc2626;color:#fff}",
      ".lfh-off-empty{margin-top:14px;padding:14px;border-radius:12px;background:rgba(34,197,94,.1);",
      "  border:1px solid rgba(34,197,94,.35);color:#16a34a;font-weight:800;text-align:center}",
      /* the ⏳ mark on a table carrying unsent work */
      ".lfh-pend-chip{position:absolute;top:4px;left:4px;z-index:5;padding:2px 6px;border-radius:999px;",
      "  background:#f59e0b;color:#3b1d00;font:800 10.5px/1.35 system-ui,sans-serif;pointer-events:none;",
      "  box-shadow:0 2px 6px rgba(0,0,0,.3)}",
      ".lfh-has-pending{outline:2px dashed rgba(245,158,11,.75);outline-offset:-2px}",
      /* the ⚠ mark: this one has STOPPED and wants a person, so it is red and solid rather
         than the amber dashed "still going out" — the two must not read the same */
      ".lfh-pend-chip.is-blocked{background:#dc2626;color:#fff}",
      ".lfh-needs-you{outline:2px solid rgba(220,38,38,.85);outline-offset:-2px}",
      "@media(prefers-reduced-motion:reduce){.lfh-offbar-dot{animation:none}}"
    ].join("\n");
    var s = document.createElement("style"); s.id = "lfh-off-style"; s.textContent = css;
    document.head.appendChild(s);
  }

  function el(tag, cls, txt) { var n = document.createElement(tag); if (cls) n.className = cls; if (txt != null) n.textContent = txt; return n; }

  // ── the bar ──────────────────────────────────────────────────────────────────
  // Decide the single most important thing to say right now.
  //
  // ONE NAME PER THING. `waiting` used to mean the COUNT at the top of barState() and was then
  // re-declared inside the same function as `var waiting = dueIn > 1500` — a boolean. `var` is
  // function-scoped, so that was not a second variable: it overwrote the count, and three of the
  // four sentences below printed it. A waiter with three changes queued read
  // "Sending true saved changes…" on every staff panel, while the connection pill three inches
  // above said "Live · 3 waiting" (measured on the manager panel and the waiter tablet,
  // 2026-08-12). Two helpers had been added to dodge it in ONE branch and the other three were
  // missed, which is what a rename should have done in the first place — so the count is `n` and
  // the boolean is `retryDue`, and they can never be each other again.
  function changesWord(n) { return n === 1 ? " change" : " changes"; }
  function barState() {
    var failed = box.failed.length, waiting = box.queued.length;
    if (failed) {
      return { tone: "tone-bad", title: failed === 1 ? "1 change needs you" : failed + " changes need you",
               // Don't name a cause we haven't established: a change also lands here when the system
      // kept refusing it or this device was signed out — the connection may never have gone.
      sub: (failed === 1 ? "It couldn't be applied." : "They couldn't be applied.") + " Tap Review.", action: "Review" };
    }
    if (isOffline() || stale.seenOfflineRead) {
      var sub = stale.fromCache ? "Showing saved data from " + fmtTime(stale.at) : "Showing what's saved on this device";
      if (waiting) sub += " · " + waiting + (waiting === 1 ? " change" : " changes") + " waiting to send";
      return { tone: "tone-off", title: "No internet — you can keep working", sub: sub, action: waiting ? "See" : null };
    }
    if (waiting) {
      // "Sending…" has to be TRUE. The owner watched that word for a long while on a healthy
      // connection with nothing being sent (the queue had no timer left — fixed in outbox.js).
      // Belt and braces: once work has sat here past STUCK_MS, the bar says what is actually
      // happening and offers a tap that forces it, instead of a reassuring lie.
      var since = (window.LFH_OUTBOX && window.LFH_OUTBOX.waitingSince) ? window.LFH_OUTBOX.waitingSince() : 0;
      // A tap on "Send now" earns a genuine "Sending…" for a few seconds — that round really is
      // in flight, and a button that appears to do nothing is the same fault in a smaller box.
      // …AND ONLY IF NOTHING IS ACTUALLY DUE (improvement #8). Age alone was the wrong test: the
      // backoff between two normal rounds runs out to two minutes, so a perfectly healthy queue
      // waiting for its next try was announced as "hasn't sent yet — the connection looks fine",
      // which is the cry-wolf fault this bar was already fixed for once. If a retry is scheduled
      // and not overdue, this is a WAIT, not a fault — say when it will go instead.
      var nextAt = (window.LFH_OUTBOX && window.LFH_OUTBOX.nextTryAt) ? window.LFH_OUTBOX.nextTryAt() : 0;
      var dueIn = nextAt ? nextAt - Date.now() : 0;
      var retryDue = dueIn > 1500;                      // a real gap, not the last moment before it fires
      var stuck = since && (Date.now() - since) > STUCK_MS && (Date.now() - nudgedAt) > 8000 && !retryDue;
      if (!stuck && retryDue && since && (Date.now() - since) > STUCK_MS) {
        return { tone: "tone-sync",
                 title: waiting + changesWord(waiting) + (waiting === 1 ? " is waiting" : " are waiting"),
                 sub: "Saved on this device since " + fmtTime(since) + " — next try in about "
                      + Math.max(1, Math.round(dueIn / 1000)) + "s. Tap Send now if you'd rather not wait.",
                 action: "Send now", onAction: sendNow, alt: "See" };
      }
      if (stuck) {
        return { tone: "tone-stale",
                 title: waiting + changesWord(waiting) + (waiting === 1 ? " hasn't sent yet" : " haven't sent yet"),
                 sub: "Saved on this device since " + fmtTime(since) + " — the connection looks fine now.",
                 action: "Send now", onAction: sendNow, alt: "See" };
      }
      // AND SAY THE TRUE REASON. Even before the stuck threshold above, this line claimed
      // "Made while you were offline" for everything in the queue — so a change parked because
      // the system was slow, or merely queued behind an earlier one, told the owner his internet
      // was gone while the light next to it read 462 ms. A bar that contradicts the indicator
      // beside it is the cry-wolf fault we already fixed once, in another place.
      // (The TITLE is left exactly as it was: the "Sending… while nothing is being sent" problem
      // is already handled above by the stuck threshold + Send now. Only the reason changes.)
      var offlineMade = box.queued.every(function (it) { return !it.why || it.why === "offline"; });
      // …AND NEVER SAY "SAVED" ABOUT SOMETHING THIS DEVICE COULD NOT SAVE. When IndexedDB is
      // refused (private browsing, storage full, a locked-down tablet profile) the queue holds
      // the change in memory only, so closing or reloading the panel loses it — while every
      // toast on the way in said "Saved ✓ — syncing automatically". The queue now reports that
      // (LFH_OUTBOX.storageFailed), and it belongs here rather than in each of the ~16 toasts
      // across the three panels, because this bar is the one surface whose job is saying what is
      // actually true — and a per-toast fix misses the call site added next month.
      var unsafe = !!(window.LFH_OUTBOX && window.LFH_OUTBOX.storageFailed && window.LFH_OUTBOX.storageFailed());
      if (unsafe) {
        return { tone: "tone-bad",
                 title: waiting + changesWord(waiting) + (waiting === 1 ? " is NOT saved on this device" : " are NOT saved on this device"),
                 sub: "This device won't let the app store them, so closing this panel would lose them. Keep it open until they've gone.",
                 action: "See" };
      }
      return { tone: "tone-sync",
               title: "Sending " + waiting + " saved" + changesWord(waiting) + "…",
               sub: offlineMade
                 ? "Made while you were offline. Keep this panel open until it's done."
                 : "The system hasn't confirmed them yet. Keep this panel open until it's done.",
               action: "See" };
    }
    // ONE saved reply is NOT a crisis. A single read can be answered from this device for a
    // dull reason (a cold server taking a moment), and shouting "Connection is struggling"
    // over a panel whose own light says LIVE is worse than saying nothing — the owner saw
    // exactly that: a green "Live" badge above an orange warning bar. So this bar only
    // appears when the connection really is bad: we're offline, or live updates aren't
    // flowing. Otherwise we stay quiet and just refresh in the background.
    if (stale.fromCache && connIsBad()) {
      return { tone: "tone-stale", title: "Connection is struggling", sub: "Showing saved data from " + fmtTime(stale.at) + " — retrying.", action: null };
    }
    return null; // all good → no bar at all
  }

  function host() {
    // Sit directly above the panel's top bar so it pushes content down instead of
    // covering a control (a floating banner hid the kitchen's tabs).
    var top = document.querySelector(".topbar");
    if (top && top.parentNode) return { parent: top.parentNode, before: top };
    if (document.body) return { parent: document.body, before: document.body.firstChild };
    return null;
  }

  // Panels that size their layout off the viewport (the manager's grid is
  // `height: calc(100vh - 60px …)`) have no way to know this bar appeared, so it would
  // push their last 50px off-screen. Publish the height as --offbar-h and let their CSS
  // subtract it — exactly how the admin ribbon's --ribbon-h already works.
  function publishHeight() {
    try {
      var h = bar ? Math.round(bar.getBoundingClientRect().height) : 0;
      document.documentElement.style.setProperty("--offbar-h", h + "px");
    } catch (e) { /* ignore */ }
  }

  function render() {
    var st = barState();
    if (!st) { if (bar) { bar.remove(); bar = null; publishHeight(); } if (sheet) renderSheet(); return; }
    injectStyles();
    if (!bar) {
      var h = host(); if (!h) return;
      bar = el("div", "lfh-offbar"); bar.id = "lfhOffBar";
      bar.setAttribute("role", "status");
      h.parent.insertBefore(bar, h.before);
    }
    bar.className = "lfh-offbar " + st.tone;
    bar.innerHTML = "";
    bar.appendChild(el("span", "lfh-offbar-dot"));
    var t = el("span", "lfh-offbar-t", st.title);
    if (st.sub) t.appendChild(el("small", null, st.sub));
    bar.appendChild(t);
    if (st.action) {
      var b = el("button", "lfh-offbar-btn"); b.type = "button";
      b.appendChild(el("span", null, st.action));
      var run = st.onAction || openSheet;
      b.addEventListener("click", function (e) { e.stopPropagation(); run(); });
      bar.appendChild(b);
    }
    // A second, quieter button so offering "Send now" never costs the person the way IN to the
    // list of what is waiting.
    if (st.alt) {
      var b2 = el("button", "lfh-offbar-btn lfh-offbar-alt"); b2.type = "button";
      b2.appendChild(el("span", null, st.alt));
      b2.addEventListener("click", function (e) { e.stopPropagation(); openSheet(); });
      bar.appendChild(b2);
    }
    publishHeight(); // the text can wrap to 2 lines on a phone, so re-measure every render
    if (sheet) renderSheet();
  }

  // While anything is waiting, re-render on a slow tick so "Sending…" turns into the honest
  // wording the moment it stops being true (the 30s heartbeat below is too coarse for that).
  // No network, no database — it only runs while the queue is non-empty.
  var waitTimer = null;
  function syncWaitTick() {
    var any = box.queued.length > 0;
    if (waitTimer) { clearInterval(waitTimer); waitTimer = null; }
    if (any) waitTimer = setInterval(render, 2000);
  }

  // ── the "needs you" sheet ────────────────────────────────────────────────────
  // A failed change carries the server's plain-language explanation (item.plain) and,
  // where we know it, what the person should do next (item.todo).
  function whyText(it) {
    if (it.plain) return it.plain;
    if (it.error === "offline") return "Couldn't reach the restaurant's system.";
    return it.error || "It couldn't be sent.";
  }
  function todoText(it) {
    if (it.todo) return it.todo;
    return "Please check that table and do it again if it's still needed.";
  }

  function renderSheet() {
    if (!sheet) return;
    var body = sheet.querySelector(".lfh-off-sheet");
    body.innerHTML = "";
    var hd = el("div", "lfh-off-hd");
    var wrap = el("div"); wrap.style.flex = "1";
    wrap.appendChild(el("h3", null, box.failed.length ? "These changes need you" : "Saved on this device"));
    wrap.appendChild(el("p", null, box.failed.length
      ? "These couldn't be applied — the system wouldn't take them, or someone else changed the same thing first."
      : "Nothing is lost. These will send themselves as soon as there's internet."));
    hd.appendChild(wrap);
    var x = el("button", "lfh-off-x", "✕"); x.type = "button";
    x.addEventListener("click", closeSheet);
    hd.appendChild(x);
    body.appendChild(hd);

    box.failed.forEach(function (it) {
      var row = el("div", "lfh-off-item");
      row.appendChild(el("b", null, it.label || "Change"));
      row.appendChild(el("p", "lfh-off-why", whyText(it)));
      row.appendChild(el("p", "lfh-off-do", "→ " + todoText(it)));
      row.appendChild(el("div", "lfh-off-when", "You did this " + fmtTime(it.at)));
      var acts = el("div", "lfh-off-acts");
      // "Try again" only makes sense when it could still work (a clash won't fix itself
      // by resending the same thing — the person has to redo it on the current state).
      if (it.retryable !== false) {
        var again = el("button", "lfh-off-ok", "Try again"); again.type = "button";
        again.addEventListener("click", function () { if (window.LFH_OUTBOX) window.LFH_OUTBOX.retryOne(it.id); });
        acts.appendChild(again);
      }
      // THROWING WORK AWAY ASKS ONCE — INLINE, never a popup (owner, 2026-08-06: "no extra
      // click"). "Not needed anymore" sits next to "Try again" and is not undoable: one slip on a
      // phone, mid-service, and a change nobody has seen is gone for good. A confirm DIALOG would
      // be the usual answer and the wrong one here — this sheet is already the place that explains
      // what happened, so the question belongs in the same row, on the same tap the person was
      // already making. The button becomes its own confirmation and reverts after a few seconds,
      // so a mis-tap costs nothing and a deliberate one costs one more tap in the same spot.
      var done = el("button", "lfh-off-ghost", "Not needed anymore"); done.type = "button";
      var armed = null;
      done.addEventListener("click", function () {
        if (armed) {                                   // second tap → really discard
          clearTimeout(armed); armed = null;
          if (window.LFH_OUTBOX) window.LFH_OUTBOX.dismiss(it.id);
          return;
        }
        done.classList.add("is-armed");
        done.textContent = "Tap again to discard";
        armed = setTimeout(function () {               // …and forget it if they walk away
          armed = null;
          done.classList.remove("is-armed");
          done.textContent = "Not needed anymore";
        }, 4000);
      });
      acts.appendChild(done);
      row.appendChild(acts);
      body.appendChild(row);
    });

    box.queued.forEach(function (it, i) {
      var row = el("div", "lfh-off-item is-wait");
      row.appendChild(el("b", null, it.label || "Change"));
      var slow = !isOffline() && (Date.now() - it.at) > STUCK_MS && (Date.now() - nudgedAt) > 8000;
      row.appendChild(el("p", "lfh-off-why", isOffline()
        ? "Saved here — waiting for internet."
        : (slow ? "Saved here — it hasn't gone through yet." : "Sending now…")));
      row.appendChild(el("div", "lfh-off-when", "You did this " + fmtTime(it.at)));
      // One button for the whole queue (it sends in order), on the first row only.
      if (slow && i === 0) {
        var acts = el("div", "lfh-off-acts");
        var now = el("button", "lfh-off-ok", "Send now"); now.type = "button";
        now.addEventListener("click", sendNow);
        acts.appendChild(now);
        row.appendChild(acts);
      }
      body.appendChild(row);
    });

    if (!box.failed.length && !box.queued.length) {
      body.appendChild(el("div", "lfh-off-empty", "✓ Everything has been sent"));
    }
  }

  function openSheet() {
    if (sheet) return;
    injectStyles();
    sheet = el("div", "lfh-off-back");
    sheet.appendChild(el("div", "lfh-off-sheet"));
    sheet.addEventListener("click", function (e) { if (e.target === sheet) closeSheet(); });
    document.body.appendChild(sheet);
    renderSheet();
    // Hardware back closes this first instead of leaving the panel.
    if (window.LFH_BACK && window.LFH_BACK.layer) backOff = window.LFH_BACK.layer("offline-needs-you", closeSheet);
  }
  function closeSheet() {
    if (!sheet) return;
    sheet.remove(); sheet = null;
    if (backOff) { try { backOff(); } catch (e) {} backOff = null; }
  }

  // ── ⏳ marks on the tables that are carrying unsent work ─────────────────────
  // An order taken with no internet must be visible WHERE THE WAITER LOOKS: on the
  // table itself. Rather than teach every panel's renderer about the queue, this
  // stamps the already-rendered tiles — the manager floor (.ftile[data-floor-table])
  // and the waiter grid (.tile[data-t]) — so it keeps working when those renderers
  // change. It only runs while something is actually waiting, so a normal shift pays
  // nothing for it.
  // "STILL ON ITS WAY" AND "THIS NEEDS YOU" ARE NOT THE SAME MARK.
  // Both lists were counted together, so a change the server had already REFUSED — a clash, or a
  // table-op it settled ("that KOT is already paid") — kept an amber ⏳ reading "Saved on this
  // device — not sent yet" on the tile for the rest of the shift, because a non-retryable row sits
  // in `failed` until somebody taps "Not needed anymore". A waiter glancing at the floor read
  // that as work still going out, while the bar three inches above it said "1 change needs you".
  // Two marks now: ⏳ for work genuinely in flight, ⚠ for work that has stopped and wants a person.
  var stampTimer = null;
  function stampTiles() {
    var ob = window.LFH_OUTBOX;
    var byTable = (ob && ob.pendingByTable) ? ob.pendingByTable() : {};
    var blockedBy = (ob && ob.blockedByTable) ? ob.blockedByTable() : {};
    var tiles = document.querySelectorAll("[data-t],[data-floor-table]");
    for (var i = 0; i < tiles.length; i++) {
      var tile = tiles[i];
      var t = tile.getAttribute("data-t") || tile.getAttribute("data-floor-table");
      var blocked = blockedBy[String(t)] || 0;
      // pendingByTable counts BOTH lists, so take the blocked ones back out to get what is
      // really still trying.
      var n = Math.max(0, (byTable[String(t)] || 0) - blocked);
      var chip = tile.querySelector(".lfh-pend-chip");
      if (!n && !blocked) {
        if (chip) chip.remove();
        tile.classList.remove("lfh-has-pending");
        tile.classList.remove("lfh-needs-you");
        continue;
      }
      tile.classList.toggle("lfh-has-pending", n > 0);
      tile.classList.toggle("lfh-needs-you", blocked > 0);
      if (!chip) {
        chip = el("span", "lfh-pend-chip");
        if (getComputedStyle(tile).position === "static") tile.style.position = "relative";
        tile.appendChild(chip);
      }
      // A table can carry both; the one that needs a PERSON is the one worth showing.
      if (blocked) {
        chip.className = "lfh-pend-chip is-blocked";
        chip.title = "Couldn't be applied — tap the bar above to see why";
        chip.textContent = blocked > 1 ? "⚠ " + blocked : "⚠";
        chip.setAttribute("aria-label", blocked + (blocked === 1 ? " change" : " changes") + " on this table need you");
      } else {
        chip.className = "lfh-pend-chip";
        chip.title = "Saved on this device — not sent yet";
        chip.textContent = n > 1 ? "⏳ " + n : "⏳";
        chip.setAttribute("aria-label", n + (n === 1 ? " change" : " changes") + " on this table not sent yet");
      }
    }
  }
  function syncStamping() {
    var any = (box.queued.length + box.failed.length) > 0;
    clearInterval(stampTimer); stampTimer = null;
    stampTiles();
    // The panels repaint their grids constantly (every poll), which wipes the chip — so
    // while anything is waiting, re-stamp on a slow tick. No network, no DB, no cost.
    if (any) stampTimer = setInterval(stampTiles, 1200);
  }

  function boot() {
    if (window.LFH_OUTBOX && window.LFH_OUTBOX.onChange) {
      window.LFH_OUTBOX.onChange(function (snap) {
        var hadFailed = box.failed.length;
        box = snap;
        render();
        syncStamping();
        syncWaitTick();
        // A change that came back needing a person is important enough to put in front
        // of them once, unprompted — not buried behind a tap.
        if (!hadFailed && snap.failed.length && !sheet) openSheet();
      });
    }
    window.addEventListener("online", render);
    window.addEventListener("offline", render);
    window.addEventListener("resize", publishHeight);
    setInterval(render, 30000); // keeps the "7:42 pm / 12 min ago" honest
    render();
  }

  window.LFH_OFF = {
    noteResponse: noteResponse,
    // TRUE when this device can answer reads with no internet — i.e. the offline layer
    // (public/sw.js) is installed and controlling this page. The panels used to skip
    // their loads outright when offline (there was nothing to fetch); now a load while
    // offline is worth doing, because it comes back with the last known board.
    canReadOffline: function () {
      try { return !!(navigator.serviceWorker && navigator.serviceWorker.controller); } catch (e) { return false; }
    },
    // TRUE for an error that just means "no internet" — callers use it to stay quiet
    // (the bar is already saying it) instead of toasting a scary technical message.
    isOfflineErr: function (e) {
      return !!(e && (e.offline === true || e.message === "offline" || /Failed to fetch|NetworkError|Load failed/i.test(e.message || "")));
    },
    // "The server is up, its database didn't answer." Marked by the panels' api() from the
    // 503 + X-LFH-Busy our routes send (lib/panelFailure.ts), plus the bare gateway statuses
    // a platform can answer with instead of us. Kept SEPARATE from isOfflineErr on purpose:
    // this must never be worded as an internet problem — the connection is fine, and blaming
    // it is the "don't cry wolf" mistake this app has already made once.
    isBusyErr: function (e) {
      return !!(e && !e.offline && (e.busy === true || e.status === 502 || e.status === 503 || e.status === 504));
    },
    open: openSheet,
    close: closeSheet,
    isStale: function () { return stale.fromCache || stale.seenOfflineRead; },
    stamp: function () { return stale.at; },
  };

  if (document.readyState !== "loading") boot();
  else document.addEventListener("DOMContentLoaded", boot);
})();
