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
  var lastMsg = "", lastAt = 0;
  function reportError(message, where) {
    var now = Date.now();
    // Dedupe an identical message firing repeatedly within 5s (a render loop shouldn't spam).
    if (message === lastMsg && now - lastAt < 5000) return;
    lastMsg = message; lastAt = now;
    post({ kind: "error", message: String(message || "error").slice(0, 300), where: String(where || "").slice(0, 120) });
  }
  window.addEventListener("error", function (e) {
    reportError(e && e.message ? e.message : "script error", (e && e.filename ? e.filename : "") + (e && e.lineno ? ":" + e.lineno : ""));
  });
  window.addEventListener("unhandledrejection", function (e) {
    var r = e && e.reason;
    reportError(r && r.message ? r.message : String(r || "unhandled rejection"), "promise");
  });
  // Let panel code report a handled-but-notable failure (e.g. a failed api() call):
  //   window.LFH_ERRLOG.report("save failed", "POST /orders")
  window.LFH_ERRLOG = { report: reportError };

  // ── 2) Tap breadcrumbs (batched) ─────────────────────────────────────────────
  var taps = [];
  var t0 = Date.now();
  function label(el) {
    var t = (el.getAttribute("data-log") || el.getAttribute("aria-label") || el.title || el.textContent || "").trim();
    return t.replace(/\s+/g, " ").slice(0, 40);
  }
  document.addEventListener("click", function (e) {
    try {
      var el = e.target && e.target.closest ? e.target.closest("button, [data-log], a.btn, .btn") : null;
      if (!el) return;
      taps.push({ t: Math.round((Date.now() - t0) / 1000), l: label(el) });
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
