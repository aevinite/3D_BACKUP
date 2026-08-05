// errlog.js — the client half of the "Everything Log" for the staff panels.
// Loaded via <script> in each panel's index.html (after realtime.js, like connbadge.js).
//
// It does two things, both feeding POST /api/log/client-error:
//   1) CRASH CAPTURE — window.onerror + unhandledrejection report the error (once, deduped)
//      so a screen that silently breaks during service still leaves a red line in the admin log.
//   2) TAP BREADCRUMBS — every tap on an action button is remembered and flushed as ONE batch
//      row per ~30s (or when the tab hides). This shows what the user was doing right before a
//      problem, at a cost of at most one DB write per panel per 30s (egress rule).
//
// Everything here is best-effort and must NEVER interfere with the panel: all sends are
// fire-and-forget with catch, and the tap listener is passive/capture-only.
(function () {
  "use strict";

  // Which panel is this? Infer from the served path (/panels/<name>/…). The editor folder IS
  // the manager panel, so map it to "manager" to match the server's logAction tag.
  function detectPanel() {
    var p = location.pathname;
    if (p.indexOf("/panels/tablet") >= 0) return "tablet";
    if (p.indexOf("/panels/kitchen") >= 0) return "kitchen";
    if (p.indexOf("/panels/editor") >= 0) return "manager";
    return "manager";
  }
  var PANEL = detectPanel();

  function rid() {
    try { return (window.LFH_RT && window.LFH_RT.getRid && window.LFH_RT.getRid()) || ""; } catch (e) { return ""; }
  }

  function post(payload) {
    try {
      payload.panel = PANEL;
      var rd = rid(); if (rd) payload.rid = rd;
      var body = JSON.stringify(payload);
      // sendBeacon survives a page unload (important for the on-hide tap flush); fall back to fetch.
      if (navigator.sendBeacon) {
        navigator.sendBeacon("/api/log/client-error", new Blob([body], { type: "application/json" }));
      } else {
        fetch("/api/log/client-error", { method: "POST", headers: { "Content-Type": "application/json" }, body: body, keepalive: true }).catch(function () {});
      }
    } catch (e) { /* never throw from the logger */ }
  }

  // ── 1) Crash capture ────────────────────────────────────────────────────────
  // Benign noise we deliberately never log as a red crash row. KOT auto-print is best-effort
  // ("printing must NEVER break the board" — kitchen printKot): Chrome can throw
  // "Failed to execute 'print' on 'Window': The provided callback is no longer runnable" a beat
  // LATE (as an unhandled promise rejection the synchronous try/catch around print() can't catch)
  // when the hidden print frame's context is gone — tab hidden mid-print, etc. It means at worst
  // one ticket didn't auto-print (staff can tap 🖨 reprint); it is NOT a crash, so it must not
  // create client_error rows / fake fix requests. The removal-timing cause was fixed in #353;
  // this guard covers the residual late-rejection path.
  //
  // Same reasoning for NETWORK-DROP noise: a background fetch whose promise rejects with
  // "Failed to fetch" (and its per-browser twins below) means the request never reached the
  // server — a momentary wifi/connection blip on the device, NOT a bug in our code. (A broken
  // endpoint returns an error *response*, which resolves the fetch; it never says "Failed to
  // fetch".) The connection light + offline queue already handle these blips visibly, so a
  // 2-second drop must not raise a red crash row / fake "Fix NOW". Repeated real outages still
  // surface via the connection badge going red.
  var NETWORK_NOISE = [
    "Failed to fetch",                              // Chrome / Edge
    "NetworkError when attempting to fetch",        // Firefox
    "Load failed",                                  // Safari (fetch abort/offline)
    "The network connection was lost",              // iOS / Safari
    "The Internet connection appears to be offline",// iOS / Safari
    "network error",                                // generic
  ];
  function isBenign(message) {
    var m = String(message || "");
    if (m.indexOf("Failed to execute 'print' on 'Window'") >= 0) return true;
    for (var i = 0; i < NETWORK_NOISE.length; i++) {
      if (m.indexOf(NETWORK_NOISE[i]) >= 0) return true;
    }
    return false;
  }
  var lastMsg = "", lastAt = 0;
  function reportError(message, where) {
    if (isBenign(message)) return;
    var now = Date.now();
    // Dedupe an identical message firing repeatedly within 5s (a render loop shouldn't spam).
    if (message === lastMsg && now - lastAt < 5000) return;
    lastMsg = message; lastAt = now;
    post({ kind: "error", message: String(message || "error").slice(0, 300), where: String(where || "").slice(0, 120) });
  }
  // WHERE it broke, in words we can act on. A crash row that only says
  // "Cannot set properties of null (setting 'innerHTML') @ promise" is unactionable — it
  // cost a whole repair session guessing which of ~65 places it was (2026-07-30). So pull
  // the first two frames of the error's own stack ("app.js@4dda46ba:7412 <- app.js@4dda46ba:9330"
  // = threw there, called from there): enough to open the line, small enough for the 120-char
  // `where` field. File name only (no long URL), and a graceful "" when a browser gives
  // us no usable stack — this must never itself throw or block the report.
  //
  // WHY THE @hash IS PART OF IT (sweep T20, finding F3). The location used to be a bare
  // "app.js:1108", with the `?v=` deliberately stripped. But `?v=` is the file's CONTENT HASH
  // (scripts/verify-panel-cache.mjs), and a staff device can be running a weeks-old cached
  // app.js — so a bare line number does not identify a line in any particular file. A real row
  // on the Repair board read "input is not defined @ app.js:1108" while line 1108 of the shipped
  // app.js was a comment, which makes the crash look invented and sends whoever picks up the
  // Fix-NOW ticket to the wrong code. Carrying the eight-character hash says exactly which build
  // the number belongs to: same hash as the current file → open that line; different → that
  // device was on an old bundle, which is itself the answer.
  function assetTag(name, query) {
    var m = /[?&]v=([A-Za-z0-9._-]{1,16})/.exec(query || "");
    return m ? name + "@" + m[1] : name;
  }
  function frames(err) {
    var st = (err && err.stack) || "";
    var out = [], seen = {};
    // Matches "…/panels/editor/app.js?v=4dda46ba:7412:23" in every engine's stack format.
    // Group 2 is the query (may be empty) so the build hash survives into the row.
    var re = /([A-Za-z0-9_.-]+\.js)(\?[^\s:)]*)?:(\d+):\d+/g, m;
    while ((m = re.exec(st)) && out.length < 2) {
      if (m[1].indexOf("errlog.js") === 0) continue; // our own listener frame says nothing
      var f = assetTag(m[1], m[2]) + ":" + m[3];
      if (seen[f]) continue;
      seen[f] = 1; out.push(f);
    }
    return out.join(" <- ");
  }
  window.addEventListener("error", function (e) {
    // filename:lineno is the throw site the browser already resolved; the stack (when
    // there is one) adds the CALLER, which is usually what explains the crash.
    var file = e && e.filename ? String(e.filename).split("/").pop() : "";
    var q = file.indexOf("?") >= 0 ? file.slice(file.indexOf("?")) : "";
    var at = (file ? assetTag(file.split("?")[0], q) : "") + (e && e.lineno ? ":" + e.lineno : "");
    var chain = frames(e && e.error);
    reportError(e && e.message ? e.message : "script error", chain || at);
  });
  window.addEventListener("unhandledrejection", function (e) {
    var r = e && e.reason;
    // "promise" alone told us nothing; keep it only as the fallback when there's no stack.
    // A rejection whose reason isn't a real Error (a rejected string, a DOMException from a
    // browser API) carries NO stack at all, so those rows read just "… @ promise" and could
    // not be located in the code — three "Cannot set properties of null (setting 'innerHTML')"
    // rows on 2026-07-29 were unfindable for exactly this reason. When there's no stack, name
    // the LAST BUTTON TAPPED instead (we already track taps for breadcrumbs below), which says
    // what the person was doing when it broke. (2026-07-30)
    reportError(r && r.message ? r.message : String(r || "unhandled rejection"), frames(r) || lastTapHint());
  });
  // Let panel code report a handled-but-notable failure (e.g. a failed api() call):
  //   window.LFH_ERRLOG.report("save failed", "POST /orders")
  window.LFH_ERRLOG = { report: reportError };

  // ── 2) Tap breadcrumbs (batched) ─────────────────────────────────────────────
  var taps = [];
  var t0 = Date.now();
  // The most recent tap, kept SEPARATELY from `taps` because that array is emptied on every
  // flush — a crash a moment after a flush would otherwise have no breadcrumb at all. Used by
  // lastTapHint() when a rejection carries no stack. (2026-07-30)
  var lastTap = null;
  function lastTapHint() {
    if (!lastTap || !lastTap.l) return "promise";
    var secs = Math.round((Date.now() - lastTap.at) / 1000);
    return "promise · after tap: " + lastTap.l + (secs > 0 ? " (" + secs + "s earlier)" : "");
  }
  // A button's NAME, as a person would read it off the screen.
  //
  // NOT el.textContent (T11 desktop sweep, 2026-08-05). textContent includes children that are
  // HIDDEN, and the manager's Tables / Bills / Platform tabs each carry a counter badge as a child
  // span — so the admin's activity feed printed "Button taps · Open menu ×6, Tables0, 📝 Editor,
  // 🧾 Bills, 🛵 Platform0, Dashboard" with a stray digit glued to two of the names. Tabs without a
  // badge logged cleanly, which is what made the pattern obvious. If a badge ever showed 3 it would
  // have read "Tables3". Breaks the owner's "the Activity log must read as English" rule.
  //
  // So: walk the visible text only — skip any element the layout is not showing (hidden attribute,
  // display:none, or the badge's own [hidden]) — and fall back to textContent if that leaves nothing
  // (an icon-only button whose label lives in a pseudo-element, say). Fixes every button with a
  // counter, not just these three tabs.
  function visibleText(node) {
    var out = "";
    for (var i = 0; i < node.childNodes.length; i++) {
      var n = node.childNodes[i];
      if (n.nodeType === 3) { out += n.nodeValue; continue; }
      if (n.nodeType !== 1) continue;
      if (n.hasAttribute && n.hasAttribute("hidden")) continue;
      try {
        var cs = window.getComputedStyle(n);
        if (cs && (cs.display === "none" || cs.visibility === "hidden")) continue;
      } catch (e) { /* no layout available — fall through and include it */ }
      // A SPACE across every element boundary, so a badge that IS on screen reads as its own
      // word: "Tables 3", never "Tables3". label() collapses runs of whitespace afterwards.
      out += " " + visibleText(n) + " ";
    }
    return out;
  }
  function label(el) {
    var own = "";
    try { own = visibleText(el).trim(); } catch (e) { own = ""; }
    var t = (el.getAttribute("data-log") || el.getAttribute("aria-label") || el.title || own || el.textContent || "").trim();
    return t.replace(/\s+/g, " ").slice(0, 40);
  }
  document.addEventListener("click", function (e) {
    try {
      var el = e.target && e.target.closest ? e.target.closest("button, [data-log], a.btn, .btn") : null;
      if (!el) return;
      // The connection-signal pill (connbadge.js: button.lfh-conn + its details popover) is NOT
      // an action — staff tap it constantly just to check their signal, which floods the admin
      // activity log with meaningless "Connection: Excellent…" rows. Never record it.
      if (el.closest(".lfh-conn") || el.closest(".lfh-conn-pop")) return;
      var lbl = label(el);
      taps.push({ t: Math.round((Date.now() - t0) / 1000), l: lbl });
      lastTap = { l: lbl, at: Date.now() }; // survives flush(); names the action if a crash has no stack
      if (taps.length > 60) taps.shift(); // bound memory between flushes
    } catch (err) { /* ignore */ }
  }, true); // capture phase: still see taps that stopPropagation

  function flush() {
    if (!taps.length) return;
    var batch = taps.slice(); taps = []; t0 = Date.now();
    post({ kind: "taps", detail: JSON.stringify(batch).slice(0, 1500) });
  }
  setInterval(flush, 30000);
  document.addEventListener("visibilitychange", function () { if (document.hidden) flush(); });
  window.addEventListener("pagehide", flush);
})();
