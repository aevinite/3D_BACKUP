/* netretry.js — the panels' half of "a blip is not a diagnosis".
 *
 * ── THE OWNER'S REPORT, 2026-09-12 ──────────────────────────────────────────────────────────────
 * "My network was fully functional ... and for three seconds it said your network is not good. I
 * click retry, now it's okay — it should not even come for three seconds if my network is good."
 *
 * Every panel's api() made ONE attempt and, on a single rejected fetch, told the person their
 * connection was bad. The manual retry worked because the blip was over by then. This makes the
 * second attempt the app's job.
 *
 * THIS IS THE SAME RULE AS lib/netRetry.ts, and it exists separately only because the panels are
 * plain <script> files with no bundler and cannot import TypeScript. ONE file, loaded by all three
 * panels — editor, kitchen and tablet each had their own api() and this is exactly the shape that
 * drifts when it is copied three times. If you change the rule, change it in BOTH places and keep
 * verify:panel-twins green.
 *
 * WHAT IS RETRIED:
 *   · GET/HEAD only. Re-sending a write can ring up a second order or a second bill; writes go
 *     through the offline outbox (public/panels/outbox.js), which is at-most-once by design.
 *   · Transient plumbing only — fetch rejecting outright, or 502/503/504 from the edge. A 4xx is an
 *     answer, and 429 must never be hammered.
 *   · Never after an abort, and never when navigator.onLine is false — "no internet" is honest and
 *     immediate, and the offline layer already shows saved data for it.
 */
(function () {
  "use strict";

  var ATTEMPT_WAITS_MS = [250, 600];
  var TRANSIENT_STATUS = { 502: 1, 503: 1, 504: 1 };

  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function jitter(ms) { return ms + Math.floor(Math.random() * (ms / 2)); }

  function isIdempotent(opts) {
    var m = ((opts && opts.method) || "GET").toUpperCase();
    return m === "GET" || m === "HEAD";
  }

  function isAbort(e) {
    return !!e && (e.name === "AbortError" || e.name === "TimeoutError");
  }

  function knownOffline() {
    return typeof navigator !== "undefined" && navigator.onLine === false;
  }

  /** fetch(), with a quiet retry for an idempotent request that hit a blip. Same signature. */
  async function netFetch(url, opts) {
    if (!isIdempotent(opts)) return fetch(url, opts);

    var lastRes = null;
    var lastErr = null;

    for (var attempt = 0; attempt <= ATTEMPT_WAITS_MS.length; attempt++) {
      if (attempt > 0) {
        await wait(jitter(ATTEMPT_WAITS_MS[attempt - 1]));
        if (opts && opts.signal && opts.signal.aborted) break;
      }
      try {
        var res = await fetch(url, opts);
        if (!TRANSIENT_STATUS[res.status]) return res; // a real answer, 4xx included
        lastRes = res;
      } catch (e) {
        // Told to stop, or genuinely offline: say so now instead of stalling on hopeless retries.
        if (isAbort(e) || (opts && opts.signal && opts.signal.aborted) || knownOffline()) throw e;
        lastErr = e;
      }
    }

    if (lastRes) return lastRes;
    throw lastErr;
  }

  window.LFH_NET = { fetch: netFetch };
})();
