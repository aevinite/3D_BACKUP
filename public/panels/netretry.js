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

  /* ── A READ MUST ALWAYS END (owner, 2026-09-12) ──────────────────────────────────────────────
   * "When you keep a tab on for 30min or 1hr and you click any button it loads and loads and you
   * have to refresh."
   *
   * A socket that has gone stale — the laptop slept, the wifi roamed, a NAT entry expired — does
   * not refuse a request. It accepts it and says nothing, and the browser will wait a very long
   * time before giving up. Three things then lined up:
   *
   *   1. The panels' api() passed NO signal, so that fetch could never settle. Writes were fixed
   *      long ago (public/panels/outbox.js: "spinner forever: not applied, not saved, no trace")
   *      — the READ path never got the same treatment.
   *   2. The service worker's stall fallback, which normally answers a hanging read from the
   *      saved copy after 6s, is DELIBERATELY switched off for 60s after any write from this
   *      device (AFTER_WRITE_FRESH_MS in public/sw.js) so a change can never be masked by stale
   *      data. Clicking a button is usually a write — so the guard was down at exactly the moment
   *      he describes.
   *   3. The manager panel coalesces identical GETs in `_inflightGET` and only removes the entry
   *      when the promise SETTLES. A promise that never settles is therefore cached for ever, and
   *      every later click on anything reading that URL joins the same dead promise. That is why
   *      it is "any button", and why only a refresh clears it.
   *
   * A deadline fixes all three at once: the promise always settles, so the map always heals.
   *
   * 15s matches the browser Supabase client (lib/supabase.ts) — the same phones on the same
   * restaurant wifi — and is 2.5x the worker's 6s stall guard, so this only ever catches the case
   * the worker was not allowed to. A timed-out read surfaces as a normal failure and is NOT
   * quietly answered from the saved copy: that is the whole point of rule 2 above, and must stay.
   */
  var READ_TIMEOUT_MS = 15000;

  /* THE DEADLINE IS ASKED FOR, NEVER ASSUMED — reading AbortSignal.timeout THROWS on some older
   * phones, and a throw here would break every panel read on exactly the devices least able to
   * spare it. Five other files in this repo feature-test it for the same reason. A device without
   * the API simply gets no deadline, which is the behaviour it had before: a slow read, not a
   * dead one. A protection must never become the thing that breaks. */
  function readDeadline() {
    try {
      return typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
        ? AbortSignal.timeout(READ_TIMEOUT_MS)
        : undefined;
    } catch (e) { return undefined; }
  }

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

    // A caller's OWN signal always wins — the same rule lib/adminFetch.ts and lib/supabase.ts
    // follow. Otherwise we give the read a ceiling so it can never hang the panel for ever.
    // ONE signal for all attempts on purpose: the retries share the 15s, they do not each get it.
    if (!opts || !opts.signal) {
      var d = readDeadline();
      if (d) opts = Object.assign({}, opts, { signal: d });
    }

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
