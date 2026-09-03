// connbadge.js — the shared connection readout for the staff panels
// (manager/kitchen/tablet). Injects a small pill into the top bar, top-right, that
// shows SIGNAL BARS + a live latency number ("42 ms") coloured by speed
// (green → yellow → orange → red) instead of a vague pulsing "Reconnecting" dot that
// people mistook for a button (owner 2026-07-08). The whole pill is ALWAYS tappable
// and opens one small "Connection" panel that MERGES the live status, the ms with a
// quality label, a tiny recent-latency sparkline, whether live updates are flowing,
// and anything saved on-device waiting to sync — so a tap always does something clear.
//
// The ms comes only from the delivery time of breadcrumbs the panel ALREADY receives
// (LFH_RT.getLatency, from realtime.js) — no extra request, zero egress. Twin of the
// React components/ConnectionBadge.tsx; both read the same model & tiers.
(function () {
  var LATENCY_FRESH_MS = 90000; // a reading older than this → fall back to a calm "Live"
  var SPARK_SLOTS = 24;         // sparkline width in bars (matches HISTORY_MAX in lib/connectionStatus.ts)

  // latency (ms) → quality tier. Mirrors latencyTier() in lib/connectionStatus.ts.
  // `bars` (0–3) carries the same meaning as colour so it's never colour-only (a11y).
  function latencyTier(ms) {
    if (ms == null) return null;
    // `text` is the ink for the WORDS and the ms number, which sit on the pale `tint`; `color` is
    // the bright dot/bars. Every `text` was darkened one step on 2026-08-05 — "Live" measured
    // 2.63:1 on its own tint (T11 re-run), so the indicator staff are told to trust was the least
    // readable thing in the bar. Keep this table in step with components/ConnectionBadge.tsx.
    // `text` is the LIGHT-skin ink and it sits on `tint`, a wash of the same hue — not on plain
    // white. #15803d measured 4.38:1 on that wash (T11 sweep, 2026-08-13), just under the 4.5:1
    // a 12.5px label needs; green-800 takes it to 6.23:1 at the same hue. `color` (the dark-skin
    // ink and the bar colour) is untouched.
    if (ms <= 700)  return { color: "#22c55e", text: "#166534", tint: "rgba(34,197,94,.16)",  bars: 3, label: "Excellent" };
    if (ms <= 1500) return { color: "#eab308", text: "#a16207", tint: "rgba(234,179,8,.18)",  bars: 2, label: "Good" };
    if (ms <= 3000) return { color: "#f97316", text: "#c2410c", tint: "rgba(249,115,22,.16)", bars: 1, label: "Slow" };
    // 0 bars, not 1 — Slow and Poor used to show the same bars, so the two worst states differed
    // only by hue. Kept in step with latencyTier() in lib/connectionStatus.ts.
    return              { color: "#ef4444", text: "#b91c1c", tint: "rgba(239,68,68,.16)",  bars: 0, label: "Poor" };
  }

  function connLevel() {
    if (typeof navigator !== "undefined" && navigator.onLine === false) return "offline";
    var s = (window.LFH_RT && window.LFH_RT.getStatus && window.LFH_RT.getStatus()) || "weak";
    return s === "online" ? "online" : (s === "offline" ? "offline" : "weak");
  }

  // Build the view (colour/bars/label/ms) exactly like the React computeView().
  function computeView() {
    var level = connLevel();
    if (level === "offline") return { level: level, color: "#ef4444", text: "#b91c1c", tint: "rgba(239,68,68,.16)", bars: 0, label: "Offline", ms: null, pulse: false };
    if (level === "weak") {
      // First connect not made yet → calm neutral "Connecting…" (NOT the alarming amber
      // "Reconnecting", which is reserved for a drop after we WERE connected).
      var ever = window.LFH_RT && window.LFH_RT.everConnected && window.LFH_RT.everConnected();
      if (!ever) return { level: level, connecting: true, color: "#94a3b8", text: "inherit", tint: "rgba(100,116,139,.14)", bars: 2, label: "Connecting…", ms: null, pulse: true };
      return { level: level, color: "#f59e0b", text: "#b45309", tint: "rgba(245,158,11,.16)", bars: 1, label: "Reconnecting", ms: null, pulse: true };
    }
    var lat = (window.LFH_RT && window.LFH_RT.getLatency && window.LFH_RT.getLatency()) || { ms: null, at: 0 };
    var fresh = lat.at > 0 && (Date.now() - lat.at) < LATENCY_FRESH_MS;
    var tier = fresh ? latencyTier(lat.ms) : null;
    if (tier) return { level: level, color: tier.color, text: tier.text, tint: tier.tint, bars: tier.bars, label: tier.label, ms: lat.ms, pulse: false };
    // `rest: true` = THE RESTING HEALTHY STATE, and the only view whose wording a panel may drop.
    // A narrow panel needs the room this pill takes (the waiter tablet's top bar: see its
    // stylesheet's [data-rest="1"] rule), but "Offline", "Reconnecting" and "Connecting…" are
    // warnings and must never be the thing that hides. Naming it HERE rather than letting each
    // panel test the label keeps that judgement in one place — and a CSS rule cannot read text.
    return { level: level, rest: true, color: "#22c55e", text: "#15803d", tint: "rgba(34,197,94,.16)", bars: 3, label: "Live", ms: null, pulse: false };
  }
  function statusLine(v) {
    if (v.level === "offline") return "No internet connection";
    if (v.connecting) return "Connecting to live updates…";
    if (v.level === "weak") return "Live connection dropped — reconnecting…";
    return "Connected — live updates are flowing";
  }

  function injectStyles() {
    if (document.getElementById("lfh-conn-style")) return;
    var css = [
      // REJECTED (owner, 2026-08-20): do NOT enlarge this pill into a 44px tap target. It measures
      // 89 × 24.5 on the kitchen top bar at every width — the last control up there still under the
      // finger target after that bar was fixed — and it IS a button: it opens the connection-details
      // popover. He was shown both ways to fix it and the cost of each, and chose to leave it. Making it
      // genuinely 44px tall grows the chip in THREE panels at once (kitchen, tablet and manager all
      // load this file); keeping it visually identical means extending its hit area over the 🔔 beside
      // it, which trades a harmless miss for a harmful one. A mis-tap here opens or closes an
      // information popover and costs nothing — the cheapest mis-tap on the screen. Extends R4 and R22:
      // the same judgement, twice before. See docs/REJECTED-IDEAS.md (R40).
      ".lfh-conn{position:relative;display:inline-flex;align-items:center;gap:7px;padding:5px 9px;border-radius:999px;",
      "  font:700 12.5px/1 system-ui,sans-serif;white-space:nowrap;user-select:none;cursor:pointer;",
      "  border:1px solid var(--line,rgba(127,127,127,.22));color:var(--text,#334155);",
      "  transition:background .2s,border-color .2s,filter .15s}",
      ".lfh-conn:hover{filter:brightness(1.05)}",
      ".lfh-conn:focus-visible{outline:2px solid var(--accent,#6366f1);outline-offset:2px}",
      ".lfh-bars{display:inline-flex;align-items:flex-end;gap:2px;height:12px;flex:0 0 auto}",
      ".lfh-bars.lfh-big{height:20px;gap:3px}",
      ".lfh-bar{width:3px;border-radius:1.5px}",
      ".lfh-bars.lfh-big .lfh-bar{width:4px;border-radius:2px}",
      ".lfh-conn.is-pulse .lfh-bar{animation:lfhBarPulse 1.1s ease-in-out infinite}",
      "@keyframes lfhBarPulse{0%,100%{opacity:1}50%{opacity:.35}}",
      ".lfh-conn-ms{font-variant-numeric:tabular-nums;font-weight:800}",
      ".lfh-conn-unit{font-weight:600;opacity:.7;font-size:10px}",
      ".lfh-conn-txt{font-weight:700}",
      // A dark panel skin composites the tint to near-black, so the BRIGHT state colour is the
      // readable ink there (~6:1) and the darkened one is not (2.82:1). !important because the ink
      // is applied as an inline style. Mirrors the same rule in components/ConnectionBadge.tsx.
      'html[data-theme="dark"] .lfh-conn-txt,html[data-theme="dark"] .lfh-conn-ms{color:var(--ink-dark)!important}',
      // data-skin, not data-staffdark: the consoles keep data-staffdark on <html> in BOTH skins,
      // so the dark ink was being forced onto the light console (1.99:1). See ConnectionBadge.tsx.
      '[data-skin="dark"] .lfh-conn-txt,[data-skin="dark"] .lfh-conn-ms{color:var(--ink-dark)!important}',
      // A light console beats the document-level dark rule — see ConnectionBadge.tsx for the
      // lfh_theme=dark + aevidine_skin=light combination that exposed this.
      'html [data-skin="light"] .lfh-conn-txt,html [data-skin="light"] .lfh-conn-ms{color:var(--ink-light)!important}',
      ".lfh-conn-n{font-weight:800;opacity:.9}",
      // NOTHING TO SAY MUST COST NOTHING. This span is empty whenever the outbox is clear, but it
      // stayed a flex item, so the pill kept paying the 7px `gap` on either side of a span with no
      // width — 7px of a phone's top bar spent on the absence of a message. (Measured 2026-09-03
      // while the waiter tablet's restaurant name was being truncated for want of exactly this
      // kind of pixel.) Same `:empty` guard the panels already use on the restaurant-name pill.
      ".lfh-conn-n:empty{display:none}",
      ".lfh-conn-n.warn{color:#ef4444}",
      ".lfh-conn-chev{opacity:.5;flex:0 0 auto}",
      /* popover */
      ".lfh-conn-pop{position:absolute;top:calc(100% + 8px);right:0;z-index:99997;width:min(86vw,288px);",
      "  display:flex;flex-direction:column;gap:12px;padding:14px;background:var(--panel,#0f1830);color:var(--text,#e7eefc);",
      "  border:1px solid var(--line,rgba(127,127,127,.28));border-radius:14px;box-shadow:0 18px 50px rgba(0,0,0,.4);",
      "  font:500 12.5px/1.35 system-ui,sans-serif;--pop-x:0px;animation:lfhConnPop .16s cubic-bezier(.16,1,.3,1)}",
      /* The entry animation and the on-screen clamp BOTH want the 'transform' property, and
         a running animation outranks an inline style — so the clamp did nothing for its
         first 160ms and the panel painted clipped off-screen, then snapped into place. The
         keyframes carry the clamp through --pop-x, which clampPop() sets alongside the
         inline transform that takes over once the animation finishes. */
      "@keyframes lfhConnPop{from{transform:translate(var(--pop-x),-4px);opacity:0}to{transform:translate(var(--pop-x),0);opacity:1}}",
      ".lfh-conn-pop-hd{display:flex;align-items:center;gap:8px;font-weight:700;font-size:12.5px}",
      ".lfh-conn-pop-dot{width:9px;height:9px;border-radius:999px;flex:0 0 auto}",
      ".lfh-conn-pop-main{display:flex;align-items:center;gap:12px;padding:4px 2px}",
      ".lfh-conn-pop-figs{display:flex;flex-direction:column;gap:2px}",
      ".lfh-conn-pop-figs b{font-size:24px;font-weight:800;line-height:1;font-variant-numeric:tabular-nums}",
      ".lfh-conn-pop-unit{font-size:13px;font-weight:600;opacity:.7}",
      ".lfh-conn-pop-figs small{font-size:11px;opacity:.7}",
      ".lfh-spark-wrap{display:flex;flex-direction:column;gap:7px;border-top:1px solid var(--line,rgba(127,127,127,.14));padding-top:10px}",
      ".lfh-spark-cap{display:flex;justify-content:space-between;align-items:baseline;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;opacity:.55}",
      ".lfh-spark-cap span{font-weight:600;text-transform:none;letter-spacing:0;opacity:.85}",
      ".lfh-spark{display:flex;align-items:flex-end;gap:3px;height:32px}",
      ".lfh-spark-bar{flex:1 1 0;min-width:0;border-radius:2px 2px 0 0;opacity:.9}",
      ".lfh-spark-bar.lfh-empty{height:14%;background:currentColor;opacity:.1}",
      ".lfh-conn-pop-sync{display:flex;flex-direction:column;gap:6px;border-top:1px solid var(--line,rgba(127,127,127,.14));padding-top:10px}",
      ".lfh-conn-pop-sub{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;opacity:.6}",
      ".lfh-conn-row{display:flex;align-items:center;gap:8px}",
      ".lfh-conn-row-t{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}",
      ".lfh-conn-row-t b{font-size:12.5px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
      ".lfh-conn-row-t small{font-size:11px;opacity:.7}",
      ".lfh-conn-row-t small.lfh-e{color:#fca5a5;opacity:1}",
      ".lfh-conn-pill{font-size:10.5px;font-weight:800;padding:3px 8px;border-radius:999px;flex:0 0 auto}",
      ".lfh-conn-x{border:0;border-radius:8px;padding:6px 10px;font-size:11.5px;font-weight:700;cursor:pointer;color:#fff;flex:0 0 auto}",
      ".lfh-conn-pop-ok{font-size:11.5px;opacity:.6;border-top:1px solid var(--line,rgba(127,127,127,.14));padding-top:10px}",
      "@media (prefers-reduced-motion:reduce){.lfh-conn.is-pulse .lfh-bar{animation:none}.lfh-conn-pop{animation:none}}"
    ].join("\n");
    var s = document.createElement("style"); s.id = "lfh-conn-style"; s.textContent = css;
    document.head.appendChild(s);
  }

  var badge = null, barsEl = null, msEl = null, nEl = null, pop = null, backOff = null;
  var outbox = { queued: [], failed: [], count: 0 };
  // A finger is DOWN somewhere inside the open popover — see popSig()/renderPop().
  var popHeld = false;
  // What the popover currently says. Compared before every rebuild.
  var popPrinted = "";

  // SAY WHAT IS ACTUALLY HAPPENING TO THE WAITING WORK (T9 sweep, 2026-08-17).
  //
  // This panel said "Sending…" about every waiting change whenever the browser reported it was
  // online — which is not the same question. The queue backs off between rounds, out to two
  // minutes (outbox.js scheduleRetry), so for most of a wait NOTHING is being sent. outbox.js
  // publishes `syncing` for exactly this reason and says so in as many words: "the bar must not
  // say 'Sending…' purely because the count is above zero." The offline bar was fixed to read it;
  // this panel was still guessing, so the two of them described the same moment differently.
  //
  // Now it reads the same flag, and when nothing is in flight it says when the next go is due
  // instead of pretending one is under way. Cry-wolf is the fault this surface has already been
  // repaired for once.
  function syncState() {
    if (navigator.onLine === false) return { word: "Waiting", head: "Saved on this device", sending: false };
    if (outbox.syncing) return { word: "Sending…", head: "Sending…", sending: true };
    var due = 0;
    try { due = (window.LFH_OUTBOX && window.LFH_OUTBOX.nextTryAt && window.LFH_OUTBOX.nextTryAt()) || 0; } catch (e) {}
    var secs = due ? Math.max(0, Math.round((due - Date.now()) / 1000)) : 0;
    return { word: "Waiting", head: secs > 1 ? "Waiting to send · next try in " + secs + "s" : "Waiting to send", sending: false };
  }

  function el(tag, cls, txt) { var n = document.createElement(tag); if (cls) n.className = cls; if (txt != null) n.textContent = txt; return n; }
  // The reason a change is still waiting, in the words the rest of the app already uses. Anything
  // unrecognised falls back to the plainest true sentence rather than printing a code at somebody.
  var WHY = {
    offline: "no internet when this was done",
    slow: "the system did not answer",
    busy: "the system was busy",
    behind: "waiting for an earlier change on this table",
    signedout: "this device was signed out",
  };
  function whyLine(it) { return (it && WHY[it.why]) || "waiting to send"; }
  function fmtAgo(ts) { var m = Math.floor((Date.now() - ts) / 60000); return m < 1 ? "just now" : m < 60 ? m + "m ago" : Math.floor(m / 60) + "h ago"; }

  // Three signal bars; `lit` coloured, the rest faint. big = larger (popover).
  function barsHtml(lit, color, big) {
    var wrap = el("span", "lfh-bars" + (big ? " lfh-big" : ""));
    var h = big ? [10, 15, 20] : [6, 9, 12];
    for (var i = 0; i < 3; i++) {
      var b = el("span", "lfh-bar");
      b.style.height = h[i] + "px";
      b.style.background = i < lit ? color : "currentColor";
      b.style.opacity = i < lit ? "1" : ".22";
      wrap.appendChild(b);
    }
    return wrap;
  }

  function mount() {
    if (badge) return badge;
    injectStyles();
    // OBITUARY (2026-09-03): two lines here hid the manager panel's ORIGINAL text connection
    // indicator (`#conn`), the one this pill replaced. It was the last panel still shipping it,
    // and hiding a thing instead of removing it is what left the manager with two indicators —
    // one working, one invisible, and app.js still writing to the invisible one. The element,
    // its four writes and its CSS were all removed on that date, so there is nothing to hide.

    badge = el("button", "lfh-conn"); badge.id = "lfhConnBadge"; badge.type = "button";
    badge.setAttribute("aria-haspopup", "dialog");
    barsEl = el("span"); // replaced each render
    msEl = el("span", "lfh-conn-ms");
    nEl = el("span", "lfh-conn-n");
    var chev = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    chev.setAttribute("class", "lfh-conn-chev"); chev.setAttribute("width", "10"); chev.setAttribute("height", "10"); chev.setAttribute("viewBox", "0 0 10 10");
    var path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "M2 3.5 5 6.5 8 3.5"); path.setAttribute("fill", "none"); path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "1.4"); path.setAttribute("stroke-linecap", "round"); path.setAttribute("stroke-linejoin", "round");
    chev.appendChild(path);
    badge.appendChild(barsEl); badge.appendChild(msEl); badge.appendChild(nEl); badge.appendChild(chev);
    badge.addEventListener("click", function (e) { e.stopPropagation(); togglePop(); });

    var host = document.querySelector(".topbar .top-actions") || document.querySelector(".topbar");
    if (!host) return null;
    host.insertBefore(badge, host.firstChild);
    return badge;
  }

  // WHICH WAY DOES THE SURFACE RUN? The words sit on a translucent tint of their own state
  // colour, so the composited background follows the panel's skin: pale on light, near-black on
  // dark. One ink can't serve both — the dark ink that fixed light then measured 2.82:1 on dark
  // (T11 re-run, 2026-08-05). Dark ink on light, the BRIGHT state colour on dark. Mirrors
  // onDarkSurface() in components/ConnectionBadge.tsx; keep the two in step.
  function render() {
    if (!mount()) return;
    var v = computeView();
    badge.style.background = v.tint;
    badge.classList.toggle("is-pulse", !!v.pulse);
    // Read by a panel that has to choose between this pill's wording and its own content.
    badge.setAttribute("data-rest", v.rest ? "1" : "0");
    // bars
    var newBars = barsHtml(v.bars, v.color, false);
    badge.replaceChild(newBars, barsEl); barsEl = newBars;
    // ms number or label
    if (v.ms != null) {
      msEl.innerHTML = ""; msEl.appendChild(document.createTextNode(String(v.ms)));
      var u = el("span", "lfh-conn-unit", " ms"); msEl.appendChild(u);
      msEl.className = "lfh-conn-ms"; msEl.style.color = v.text; msEl.style.setProperty("--ink-dark", v.color); msEl.style.setProperty("--ink-light", v.text); msEl.style.display = "";
    } else {
      msEl.textContent = v.label; msEl.className = "lfh-conn-txt"; msEl.style.color = v.text; msEl.style.setProperty("--ink-dark", v.color); msEl.style.setProperty("--ink-light", v.text); msEl.style.display = "";
    }
    // waiting-to-sync count
    var waiting = outbox.queued.length, failed = outbox.failed.length;
    var extra = failed ? (failed + " failed") : waiting ? (waiting + " waiting") : "";
    nEl.textContent = extra ? "· " + extra : "";
    nEl.className = "lfh-conn-n" + (failed ? " warn" : "");
    badge.title = statusLine(v) + (v.ms != null ? " · " + v.ms + " ms" : "") + (extra ? " · " + extra + " to send" : "");
    badge.setAttribute("aria-label", "Connection: " + v.label + (v.ms != null ? ", " + v.ms + " milliseconds" : "") + (extra ? ", " + extra : "") + ". Tap for details.");
    badge.setAttribute("aria-expanded", pop ? "true" : "false");
    if (pop) { renderPop(v); clampPop(); } // keep the open popover live — and still on-screen
  }

  // WHAT THE POPOVER WOULD SAY, as one short string. Rebuilding only when this changes is what
  // keeps the Retry / Dismiss buttons alive under a finger — see renderPop().
  function popSig(v) {
    var s = syncState();
    return [v.level, v.label, v.ms, v.bars, s.head,
      outbox.failed.map(function (it) { return it.id + ":" + (it.error || "") + ":" + (it.retryable === false ? "0" : "1"); }).join("|"),
      outbox.queued.map(function (it) { return it.id; }).join("|"),
      (window.LFH_RT && window.LFH_RT.getLatencyHistory ? window.LFH_RT.getLatencyHistory().length : 0),
    ].join("~");
  }

  // A RETRY TAP MUST NOT BE SWALLOWED BY A REPAINT (T9 sweep, 2026-08-17).
  //
  // render() runs on every latency breadcrumb, on every outbox change and on an 8-second timer,
  // and it used to blow the whole popover away and build it again — `pop.innerHTML = ""`. A
  // browser only fires `click` when the press and the release land on the SAME element, so a
  // breadcrumb arriving between a manager's finger going down on Retry and coming back up meant
  // the button had been replaced and the tap simply did nothing. That is a dropped tap, which
  // this codebase does not allow, and on a busy floor breadcrumbs arrive several times a second.
  //
  // Two guards, both cheap: never rebuild while a finger is down inside the panel, and otherwise
  // only rebuild when what it would SAY has actually changed. A repaint that changes nothing was
  // never worth a single frame, let alone a lost tap.
  function renderPop(v) {
    var sig = popSig(v);
    if (popHeld || sig === popPrinted) return;
    popPrinted = sig;
    pop.innerHTML = "";
    // header
    var hd = el("span", "lfh-conn-pop-hd");
    var dot = el("span", "lfh-conn-pop-dot"); dot.style.background = v.color;
    hd.appendChild(dot); hd.appendChild(document.createTextNode(statusLine(v)));
    pop.appendChild(hd);
    // main: big bars + big ms/label
    var main = el("span", "lfh-conn-pop-main");
    main.appendChild(barsHtml(v.bars, v.color, true));
    var figs = el("span", "lfh-conn-pop-figs");
    var b = el("b"); b.style.color = v.text; b.style.setProperty("--ink-dark", v.color);
    if (v.ms != null) { b.appendChild(document.createTextNode(String(v.ms))); b.appendChild(el("span", "lfh-conn-pop-unit", " ms")); }
    else { b.textContent = v.label; }
    figs.appendChild(b);
    figs.appendChild(el("small", null, v.ms != null ? v.label : (v.level === "online" ? "Speed shows when data flows" : "")));
    main.appendChild(figs);
    pop.appendChild(main);
    // sparkline — a fixed 24-slot chart of recent latency, newest at the right.
    // Real readings fill from the right; any unused leading slots are faint baseline
    // ticks, so it always reads as a proper bar chart (never a couple of fat blocks)
    // and visibly fills up as more breadcrumbs arrive.
    if (v.level === "online") {
      var hist = (window.LFH_RT && window.LFH_RT.getLatencyHistory && window.LFH_RT.getLatencyHistory()) || [];
      var data = hist.slice(-SPARK_SLOTS);
      if (data.length >= 1) {
        var max = Math.max.apply(null, data.concat([1]));
        var wrap = el("span", "lfh-spark-wrap");
        var cap = el("span", "lfh-spark-cap");
        cap.appendChild(document.createTextNode("Recent speed"));
        cap.appendChild(el("span", null, data.length < 4 ? "building history…" : "last " + data.length + " updates"));
        wrap.appendChild(cap);
        var sp = el("span", "lfh-spark");
        for (var i = 0; i < SPARK_SLOTS - data.length; i++) sp.appendChild(el("span", "lfh-spark-bar lfh-empty"));
        data.forEach(function (val) {
          var t = latencyTier(val);
          var bar = el("span", "lfh-spark-bar");
          bar.style.height = Math.max(14, Math.round((val / max) * 100)) + "%";
          bar.style.background = t ? t.color : "#22c55e";
          sp.appendChild(bar);
        });
        wrap.appendChild(sp);
        pop.appendChild(wrap);
      }
    }
    // waiting-to-sync
    var off = navigator.onLine === false;
    var st = syncState();
    if (outbox.failed.length || outbox.queued.length) {
      var sync = el("span", "lfh-conn-pop-sync");
      sync.appendChild(el("span", "lfh-conn-pop-sub", outbox.failed.length ? "Couldn't send" : st.head));
      outbox.failed.forEach(function (it) {
        var row = el("span", "lfh-conn-row");
        var t = el("span", "lfh-conn-row-t");
        t.appendChild(el("b", null, it.label || "Action"));
        t.appendChild(el("small", "lfh-e", (it.error || "Failed") + " · " + fmtAgo(it.at)));
        row.appendChild(t);
        // RETRY THIS ROW, not all of them. It called retryFailed() — the whole list — from a
        // button sitting inside one row, so tapping Retry on the discount also re-sent the
        // unrelated change under it. The React twin has always been per-item; this is that.
        // A clash (retryable === false) gets NO Retry: the server said the ground moved, so
        // sending the identical change again cannot work and offering it only wastes a tap.
        if (it.retryable !== false) {
          var retry = el("button", "lfh-conn-x", "Retry"); retry.style.background = "#f59e0b";
          retry.addEventListener("click", function (e) {
            e.stopPropagation();
            if (window.LFH_OUTBOX) window.LFH_OUTBOX.retryOne(it.id);
          });
          row.appendChild(retry);
        }
        var dis = el("button", "lfh-conn-x", "Dismiss"); dis.style.background = "#64748b";
        dis.addEventListener("click", function (e) { e.stopPropagation(); if (window.LFH_OUTBOX) window.LFH_OUTBOX.dismiss(it.id); });
        row.appendChild(dis);
        sync.appendChild(row);
      });
      outbox.queued.forEach(function (it) {
        var row = el("span", "lfh-conn-row");
        var t = el("span", "lfh-conn-row-t");
        t.appendChild(el("b", null, it.label || "Action"));
        // WHY THIS ONE IS WAITING, not just how long (owner, 2026-08-28).
        //
        // The queue has recorded a reason per change since 2026-08-02 — offline / slow / busy /
        // behind — and nothing ever showed it. Two changes on the same table rendered as two
        // identical rows with a time under each, so "nothing is moving" and "this one is being
        // held until the one above it goes through" looked exactly alike. That got worse the day
        // the hold became real: a change queued behind a failed one is now genuinely held, and a
        // manager chasing a discount that has not applied has no way to tell that from a fault.
        //
        // The words are the ones already used elsewhere for the same states, so the pill, the
        // offline bar and this row cannot describe one moment three ways.
        t.appendChild(el("small", null, whyLine(it) + " · " + fmtAgo(it.at)));
        row.appendChild(t);
        var pill = el("span", "lfh-conn-pill", st.word);
        pill.style.background = st.sending ? "rgba(34,197,94,.18)" : "rgba(239,68,68,.18)";
        pill.style.color = st.sending ? "#86efac" : "#fca5a5";
        row.appendChild(pill);
        sync.appendChild(row);
      });
      pop.appendChild(sync);
    } else {
      pop.appendChild(el("span", "lfh-conn-pop-ok", "✓ Everything is synced"));
    }
  }

  // Keep the popover on-screen. It's anchored right:0 to the badge, so when the badge sits
  // near the LEFT edge (e.g. the kitchen top bar) the ~288px panel overflowed the left screen
  // edge on phones and clipped its own text. A CSS position:fixed clamp is defeated by
  // transformed ancestors, so measure the rendered rect and nudge it back inside the viewport.
  // Re-run after EVERY re-render, not just on open: the popover grows when the "waiting to
  // sync" list appears, and a one-shot clamp leaves the grown panel hanging off the edge.
  function clampPop() {
    if (!pop) return;
    // Measure from the UNSHIFTED position — the live rect already includes any shift applied
    // last time, so re-clamping on top of it would drift the panel further on every pass.
    pop.style.setProperty("--pop-x", "0px");
    pop.style.transform = "";
    var r = pop.getBoundingClientRect(), pad = 8, shift = 0;
    if (r.left < pad) shift = pad - r.left;
    else if (r.right > window.innerWidth - pad) shift = (window.innerWidth - pad) - r.right;
    if (!shift) return;
    shift = Math.round(shift) + "px";
    pop.style.setProperty("--pop-x", shift);            // carries through the entry animation
    pop.style.transform = "translateX(" + shift + ")";  // holds once the animation ends
  }

  var onDocClick = null, onPointerUp = null;
  function openPop() {
    if (pop) return;
    pop = el("span", "lfh-conn-pop"); pop.setAttribute("role", "dialog"); pop.setAttribute("aria-label", "Connection details");
    pop.addEventListener("click", function (e) { e.stopPropagation(); });
    // A finger is on this panel → hold every repaint until it lifts, so the button under it is
    // still the same node when the release arrives. See renderPop().
    pop.addEventListener("pointerdown", function () { popHeld = true; });
    onPointerUp = function () { if (!popHeld) return; popHeld = false; if (pop) { renderPop(computeView()); clampPop(); } };
    pop.addEventListener("pointercancel", onPointerUp);
    // On WINDOW, not on the panel: a finger that slides off the button before lifting still has
    // to release the hold, or the panel would freeze on whatever it last said.
    window.addEventListener("pointerup", onPointerUp);
    popPrinted = "";
    badge.appendChild(pop);
    renderPop(computeView());
    clampPop();
    badge.setAttribute("aria-expanded", "true");
    // click-away
    onDocClick = function () { closePop(); };
    setTimeout(function () { document.addEventListener("click", onDocClick); }, 0);
    // hardware BACK closes the popover first
    if (window.LFH_BACK && window.LFH_BACK.layer) backOff = window.LFH_BACK.layer("conn-badge", closePop);
  }
  function closePop() {
    if (!pop) return;
    pop.remove(); pop = null;
    popHeld = false; popPrinted = "";
    badge.setAttribute("aria-expanded", "false");
    if (onPointerUp) { window.removeEventListener("pointerup", onPointerUp); onPointerUp = null; }
    if (onDocClick) { document.removeEventListener("click", onDocClick); onDocClick = null; }
    if (backOff) { try { backOff(); } catch (e) {} backOff = null; }
  }
  function togglePop() { if (pop) closePop(); else openPop(); }

  function boot() {
    render();
    if (window.LFH_RT && window.LFH_RT.onStatus) window.LFH_RT.onStatus(render);
    if (window.LFH_RT && window.LFH_RT.onLatency) window.LFH_RT.onLatency(render);
    window.addEventListener("online", render);
    window.addEventListener("offline", render);
    if (window.LFH_OUTBOX && window.LFH_OUTBOX.onChange) {
      window.LFH_OUTBOX.onChange(function (snap) { outbox = snap; render(); });
    }
    // Refresh "ago" + latency freshness (no network). NOT while the tab is hidden: a kitchen
    // display left on all day was rebuilding this pill — a layout read and a handful of new
    // nodes — every eight seconds behind a screen nobody was looking at. Coming back repaints
    // once, which is the only moment the numbers matter.
    setInterval(function () { if (!document.hidden) render(); }, 8000);
    document.addEventListener("visibilitychange", function () { if (!document.hidden) render(); });
  }

  if (document.readyState !== "loading") boot();
  else document.addEventListener("DOMContentLoaded", boot);
})();
