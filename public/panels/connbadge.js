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
    if (ms <= 700)  return { color: "#22c55e", text: "#16a34a", tint: "rgba(34,197,94,.16)",  bars: 3, label: "Excellent" };
    if (ms <= 1500) return { color: "#eab308", text: "#ca8a04", tint: "rgba(234,179,8,.18)",  bars: 2, label: "Good" };
    if (ms <= 3000) return { color: "#f97316", text: "#ea580c", tint: "rgba(249,115,22,.16)", bars: 1, label: "Slow" };
    return              { color: "#ef4444", text: "#dc2626", tint: "rgba(239,68,68,.16)",  bars: 1, label: "Poor" };
  }

  function connLevel() {
    if (typeof navigator !== "undefined" && navigator.onLine === false) return "offline";
    var s = (window.LFH_RT && window.LFH_RT.getStatus && window.LFH_RT.getStatus()) || "weak";
    return s === "online" ? "online" : (s === "offline" ? "offline" : "weak");
  }

  // Build the view (colour/bars/label/ms) exactly like the React computeView().
  function computeView() {
    var level = connLevel();
    if (level === "offline") return { level: level, color: "#ef4444", text: "#dc2626", tint: "rgba(239,68,68,.16)", bars: 0, label: "Offline", ms: null, pulse: false };
    if (level === "weak") {
      // First connect not made yet → calm neutral "Connecting…" (NOT the alarming amber
      // "Reconnecting", which is reserved for a drop after we WERE connected).
      var ever = window.LFH_RT && window.LFH_RT.everConnected && window.LFH_RT.everConnected();
      if (!ever) return { level: level, connecting: true, color: "#94a3b8", text: "inherit", tint: "rgba(100,116,139,.14)", bars: 2, label: "Connecting…", ms: null, pulse: true };
      return { level: level, color: "#f59e0b", text: "#d97706", tint: "rgba(245,158,11,.16)", bars: 1, label: "Reconnecting", ms: null, pulse: true };
    }
    var lat = (window.LFH_RT && window.LFH_RT.getLatency && window.LFH_RT.getLatency()) || { ms: null, at: 0 };
    var fresh = lat.at > 0 && (Date.now() - lat.at) < LATENCY_FRESH_MS;
    var tier = fresh ? latencyTier(lat.ms) : null;
    if (tier) return { level: level, color: tier.color, text: tier.text, tint: tier.tint, bars: tier.bars, label: tier.label, ms: lat.ms, pulse: false };
    return { level: level, color: "#22c55e", text: "#16a34a", tint: "rgba(34,197,94,.16)", bars: 3, label: "Live", ms: null, pulse: false };
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
      ".lfh-conn-n{font-weight:800;opacity:.9}",
      ".lfh-conn-n.warn{color:#ef4444}",
      ".lfh-conn-chev{opacity:.5;flex:0 0 auto}",
      /* popover */
      ".lfh-conn-pop{position:absolute;top:calc(100% + 8px);right:0;z-index:99997;width:min(86vw,288px);",
      "  display:flex;flex-direction:column;gap:12px;padding:14px;background:var(--panel,#0f1830);color:var(--text,#e7eefc);",
      "  border:1px solid var(--line,rgba(127,127,127,.28));border-radius:14px;box-shadow:0 18px 50px rgba(0,0,0,.4);",
      "  font:500 12.5px/1.35 system-ui,sans-serif;animation:lfhConnPop .16s cubic-bezier(.16,1,.3,1)}",
      "@keyframes lfhConnPop{from{transform:translateY(-4px);opacity:0}to{transform:none;opacity:1}}",
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

  function el(tag, cls, txt) { var n = document.createElement(tag); if (cls) n.className = cls; if (txt != null) n.textContent = txt; return n; }
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
    var legacy = document.getElementById("conn");
    if (legacy && legacy.classList.contains("conn")) legacy.style.display = "none";

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

  function render() {
    if (!mount()) return;
    var v = computeView();
    badge.style.background = v.tint;
    badge.classList.toggle("is-pulse", !!v.pulse);
    // bars
    var newBars = barsHtml(v.bars, v.color, false);
    badge.replaceChild(newBars, barsEl); barsEl = newBars;
    // ms number or label
    if (v.ms != null) {
      msEl.innerHTML = ""; msEl.appendChild(document.createTextNode(String(v.ms)));
      var u = el("span", "lfh-conn-unit", " ms"); msEl.appendChild(u);
      msEl.className = "lfh-conn-ms"; msEl.style.color = v.text; msEl.style.display = "";
    } else {
      msEl.textContent = v.label; msEl.className = "lfh-conn-txt"; msEl.style.color = v.text; msEl.style.display = "";
    }
    // waiting-to-sync count
    var waiting = outbox.queued.length, failed = outbox.failed.length;
    var extra = failed ? (failed + " failed") : waiting ? (waiting + " waiting") : "";
    nEl.textContent = extra ? "· " + extra : "";
    nEl.className = "lfh-conn-n" + (failed ? " warn" : "");
    badge.title = statusLine(v) + (v.ms != null ? " · " + v.ms + " ms" : "") + (extra ? " · " + extra + " to send" : "");
    badge.setAttribute("aria-label", "Connection: " + v.label + (v.ms != null ? ", " + v.ms + " milliseconds" : "") + (extra ? ", " + extra : "") + ". Tap for details.");
    badge.setAttribute("aria-expanded", pop ? "true" : "false");
    if (pop) renderPop(v); // keep the open popover live
  }

  function renderPop(v) {
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
    var b = el("b"); b.style.color = v.text;
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
    if (outbox.failed.length || outbox.queued.length) {
      var sync = el("span", "lfh-conn-pop-sync");
      sync.appendChild(el("span", "lfh-conn-pop-sub", outbox.failed.length ? "Couldn't send" : off ? "Saved on this device" : "Sending…"));
      outbox.failed.forEach(function (it) {
        var row = el("span", "lfh-conn-row");
        var t = el("span", "lfh-conn-row-t");
        t.appendChild(el("b", null, it.label || "Action"));
        t.appendChild(el("small", "lfh-e", (it.error || "Failed") + " · " + fmtAgo(it.at)));
        row.appendChild(t);
        var retry = el("button", "lfh-conn-x", "Retry"); retry.style.background = "#f59e0b";
        retry.addEventListener("click", function (e) { e.stopPropagation(); if (window.LFH_OUTBOX) window.LFH_OUTBOX.retryFailed(); });
        var dis = el("button", "lfh-conn-x", "Dismiss"); dis.style.background = "#64748b";
        dis.addEventListener("click", function (e) { e.stopPropagation(); if (window.LFH_OUTBOX) window.LFH_OUTBOX.dismiss(it.id); });
        row.appendChild(retry); row.appendChild(dis);
        sync.appendChild(row);
      });
      outbox.queued.forEach(function (it) {
        var row = el("span", "lfh-conn-row");
        var t = el("span", "lfh-conn-row-t");
        t.appendChild(el("b", null, it.label || "Action"));
        t.appendChild(el("small", null, fmtAgo(it.at)));
        row.appendChild(t);
        var pill = el("span", "lfh-conn-pill", off ? "Waiting" : "Sending…");
        pill.style.background = off ? "rgba(239,68,68,.18)" : "rgba(34,197,94,.18)";
        pill.style.color = off ? "#fca5a5" : "#86efac";
        row.appendChild(pill);
        sync.appendChild(row);
      });
      pop.appendChild(sync);
    } else {
      pop.appendChild(el("span", "lfh-conn-pop-ok", "✓ Everything is synced"));
    }
  }

  var onDocClick = null;
  function openPop() {
    if (pop) return;
    pop = el("span", "lfh-conn-pop"); pop.setAttribute("role", "dialog"); pop.setAttribute("aria-label", "Connection details");
    pop.addEventListener("click", function (e) { e.stopPropagation(); });
    badge.appendChild(pop);
    renderPop(computeView());
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
    badge.setAttribute("aria-expanded", "false");
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
    setInterval(render, 8000); // refresh "ago" + latency freshness (no network)
  }

  if (document.readyState !== "loading") boot();
  else document.addEventListener("DOMContentLoaded", boot);
})();
