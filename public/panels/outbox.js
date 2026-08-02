// outbox.js — the OFFLINE ACTION QUEUE for the staff panels (manager/kitchen/tablet).
// (Offline sync feature, 2026-07-06.)
//
// WHAT IT DOES
//   When the panel is offline (or a write hits a dead network mid-flight), the
//   action is SAVED on this device (IndexedDB, survives reloads/crashes) and the
//   UI proceeds optimistically. The moment the connection returns, every saved
//   action is REPLAYED to the server in order. Each carries a unique X-LFH-Action-Id
//   so the server runs it AT MOST ONCE (see lib/idempotency.ts) — no double bills,
//   no duplicate orders.
//
//   If a replayed action is REJECTED by the server (e.g. the table was already
//   closed by someone else while you were offline — "the same change was already
//   made"), it's moved to a FAILED list and surfaced in the UI instead of silently
//   vanishing — the "what's still waiting / what couldn't sync" view.
//
// CONTRACT (so the panels' existing api() helper behaves the same):
//   send() returns the parsed JSON on an online success, THROWS on a real server
//   error (non-2xx response), redirects to /login on 401 — exactly like the old
//   fetch did. ONLY a genuine network failure diverts into the queue, returning an
//   optimistic { ok:true, queued:true } so the caller's happy path continues.
(function () {
  const DB_NAME = "lfh_outbox";
  const STORE = "actions";
  const listeners = new Set();
  let queued = [];   // status:"queued"  — waiting to sync, in FIFO order
  let failed = [];   // status:"failed"  — server rejected on replay; needs attention
  let flushing = false;
  let retryTimer = null;
  // How long a single write may wait for an answer before it is treated as "the server can't
  // take this right now" and saved on the device instead. See doFetch().
  const WRITE_TIMEOUT_MS = 15000;
  // Re-flush pacing. It used to be a FIXED 15s, which is the shape that turns a struggling
  // server into a dead one: every device retries on the same beat, so the load arrives in
  // synchronised waves that never let it recover (a retry storm). Now each round waits longer
  // than the last, and each device rolls its own jitter so they spread out.
  // The FIRST re-try is quick, because by far the commonest reason a write fails is one dropped
  // request on a connection that is otherwise fine — making that wait 15s just to try again is
  // what makes a panel feel stuck. Everything after it backs off as before.
  let RETRY_FIRST_MS = 5000;
  let RETRY_BASE_MS = 15000;
  let RETRY_MAX_MS = 120000;
  // Don't flush more than this often just because the person keeps switching tabs.
  let WAKE_MIN_GAP_MS = 4000;
  let retryStep = 0;
  let lastWakeAt = 0;
  let paused = false; // test-only; see __pause below
  // A saved change may not sit in a silent retry loop forever. After this many rounds of the
  // same non-answer it becomes a person's decision instead of a spinner nobody can see.
  const AUTH_MAX_TRIES = 3;   // 401 — this device is signed out
  const BUSY_MAX_TRIES = 6;   // 409 {retry:true} — the server says it is still handling this id
  // The verifier (scripts/verify-outbox-drain.mjs) shrinks the waits so a run takes seconds
  // instead of minutes. Nothing in the app sets this.
  try {
    var P = window.LFH_TEST_PACING;
    if (P) {
      if (P.first) RETRY_FIRST_MS = P.first;
      if (P.base) RETRY_BASE_MS = P.base;
      if (P.max) RETRY_MAX_MS = P.max;
      if (P.wake) WAKE_MIN_GAP_MS = P.wake;
    }
  } catch (e) { /* no window (unlikely) → shipped timings */ }

  // ── tiny IndexedDB wrapper (no external lib) ────────────────────────────────
  let dbPromise = null;
  function db() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      let req;
      try { req = indexedDB.open(DB_NAME, 1); } catch (e) { return reject(e); }
      req.onupgradeneeded = () => { req.result.createObjectStore(STORE, { keyPath: "id" }); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }
  async function idbAll() {
    try {
      const d = await db();
      return await new Promise((resolve, reject) => {
        const r = d.transaction(STORE, "readonly").objectStore(STORE).getAll();
        r.onsuccess = () => resolve(r.result || []);
        r.onerror = () => reject(r.error);
      });
    } catch { return []; } // IDB blocked (private mode etc.) → in-memory only
  }
  // Await the TRANSACTION completing (not just the request) so an action can't be
  // lost if the tab is reloaded/killed the instant after it's queued offline.
  function idbWrite(fn) {
    return db().then((d) => new Promise((resolve, reject) => {
      const tx = d.transaction(STORE, "readwrite");
      fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    })).catch(() => {}); // IDB blocked (private mode etc.) → in-memory only
  }
  async function idbPut(item) { await idbWrite((store) => store.put(item)); }
  async function idbDel(id) { await idbWrite((store) => store.delete(id)); }

  // ── helpers ─────────────────────────────────────────────────────────────────
  const uuid = () => (self.crypto && self.crypto.randomUUID)
    ? self.crypto.randomUUID()
    : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => { const r = Math.random() * 16 | 0; return (c === "x" ? r : (r & 3 | 8)).toString(16); });

  function notify() {
    const snap = { queued: queued.slice(), failed: failed.slice(), count: queued.length + failed.length };
    listeners.forEach((fn) => { try { fn(snap); } catch (e) {} });
    // Also fire a DOM event so the connection badge / any UI can react without importing us.
    try { window.dispatchEvent(new CustomEvent("lfh:outbox-changed", { detail: snap })); } catch (e) {}
  }

  // Turn a request into a short human label for the "waiting to sync" list.
  function labelFor(method, path) {
    const p = (path || "").split("?")[0];
    const t = (p.match(/\/tables\/([^/]+)/) || [])[1];
    const table = t ? " · Table " + decodeURIComponent(t) : "";
    if (/\/order$/.test(p)) return "Place order";
    if (/\/banquet\/place$/.test(p)) return "Place banquet order";
    if (/\/pay$/.test(p)) return "Settle bill" + table;
    if (/\/discount$/.test(p)) return "Apply discount";
    if (/\/invoice$/.test(p) && /void/.test(p)) return "Void invoice";
    if (/\/invoice$/.test(p)) return "Generate invoice";
    if (/\/accept$/.test(p)) return "Accept order";
    if (/\/serve-all$/.test(p)) return "Serve all";
    if (/\/ready$/.test(p)) return "Mark ready";
    if (/sold-out|\/status$/.test(p)) return "Update availability";
    if (/\/allergies$/.test(p)) return "Update allergies";
    if (/\/shift$/.test(p)) return "Shift table" + table;
    if (/\/close$/.test(p)) return "Close table" + table;
    if (/\/open/.test(p)) return "Open table" + table;
    // fallback: METHOD last-segment
    const seg = p.split("/").filter(Boolean).slice(-2).join(" ");
    return (method === "DELETE" ? "Delete " : "") + (seg || "Action");
  }

  // Which TABLE does this action belong to? Used to show, on the table itself, that
  // something taken on this device hasn't reached the kitchen yet — so an offline order
  // is never invisible. Returns null when an action can't be tied to one table (those
  // stay visible in the top bar + the "waiting" list instead).
  function tableOf(item) {
    try {
      var b = item.body || {};
      if (b.table != null && b.table !== "") return String(b.table);
      if (b.table_number != null && b.table_number !== "") return String(b.table_number);
      var p = item.path || "";
      var m = p.match(/\/tables\/([^/?&]+)/) || p.match(/[?&]table=([^&]+)/);
      if (m) return decodeURIComponent(m[1]);
    } catch (e) { /* ignore */ }
    return null;
  }

  // `replay` = this is a change coming OUT of the queue (it was saved on the device
  // earlier), not a live write. Only a replay is clash-checked on the server, which is
  // what keeps the normal online path byte-for-byte unchanged.
  function doFetch(item, replay) {
    var headers = {
      "Content-Type": "application/json",
      "X-LFH-Action-Id": item.id,
      // WHEN the person actually did this. The server uses it to spot a clash: if the
      // table was closed or the bill was settled after this moment, applying it now
      // would quietly overwrite someone else's work (see lib/clash.ts).
      "X-LFH-Queued-At": new Date(item.at || Date.now()).toISOString(),
    };
    // What the person believed when they acted. Sent on LIVE writes too, not just replays:
    // two waiters editing the same dish at the same moment is the common case.
    if (item.expect) headers["X-LFH-Expect"] = JSON.stringify(item.expect);
    if (replay) headers["X-LFH-Replay"] = "1";
    return fetch(item.base + item.path, {
      method: item.method,
      headers: headers,
      body: item.body != null ? JSON.stringify(item.body) : undefined,
      // EVERY write gets a deadline. Without one, a database that is up but overloaded (it
      // answers NOTHING, measured at 30-90s on 2026-07-31) left the waiter's tap hanging on a
      // spinner forever: not applied, not saved, no trace. A timeout turns that into the path
      // that was already safe and already tested — the action lands in the on-device queue and
      // replays itself. 15s, not less: a route can make two or three database calls of up to 8s
      // each, so anything shorter would queue writes that were about to succeed.
      // Replaying after a timeout cannot double anything: the same X-LFH-Action-Id above is
      // what withIdempotency() dedups on, and this is the same ambiguity the offline path has
      // always had.
      signal: typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(WRITE_TIMEOUT_MS) : undefined,
    });
  }

  async function enqueue(item) {
    item.status = "queued";
    queued.push(item);
    await idbPut(item);
    notify();
    // NEVER leave saved work with nothing to send it. This one line is the whole of the
    // 2026-08-02 fault: a write that died mid-flight was saved here and then simply waited,
    // because the only wake-ups were the browser's 'online' event and realtime reconnecting —
    // and neither of those happens when the connection never actually dropped. The owner
    // watched "Sending 3 saved changes…" on a healthy connection while nothing was being sent.
    ensureRetry();
  }

  // There is a timer pending for whatever is in the queue — or there is about to be.
  function ensureRetry() {
    if (flushing) return;            // the running flush will schedule the next round itself
    if (retryTimer) return;          // already covered
    if (!queued.length) return;
    scheduleRetry();
  }

  async function removeItem(id) {
    queued = queued.filter((x) => x.id !== id);
    failed = failed.filter((x) => x.id !== id);
    await idbDel(id);
  }

  // A change that came back needing a PERSON. `info` carries the server's plain-language
  // explanation + what to do next, so the "Needs you" sheet can say something useful
  // instead of a status code. Nothing is ever thrown away here.
  async function moveToFailed(item, reason, info) {
    queued = queued.filter((x) => x.id !== item.id);
    item.status = "failed";
    item.error = reason || "Could not sync";
    if (info) {
      item.plain = info.plain || null;   // "Table 5 was already billed and closed."
      item.todo = info.todo || null;     // "Open the table again and re-take this order."
      // A clash won't fix itself by resending the same thing — the person has to redo it
      // against how things are NOW. Anything else (a timeout, a server hiccup) can retry.
      item.retryable = info.retryable === undefined ? true : !!info.retryable;
    }
    failed.push(item);
    await idbPut(item);
  }

  // ── the public send(): fetch-or-queue with the api() contract ───────────────
  // `expect` = what the person was looking at when they started editing, e.g.
  // { note: "more spicy" }. It travels with the write so the server can refuse instead of
  // silently overwriting a change someone else made on another device in the meantime.
  // Used by the dish-edit modal in both staff panels; see lib/clash.ts fieldClash().
  async function send({ base, method, path, body, panel, label, expect }) {
    const item = { id: uuid(), base, method, path, body, panel: panel || "", label: label || labelFor(method, path), at: Date.now(), expect: expect || null };

    // Known offline → don't even try; queue straight away.
    if (navigator.onLine === false) { await enqueue(item); return { ok: true, queued: true, action_id: item.id }; }

    // FIFO GUARD (#6): if earlier actions are STILL waiting to sync, this new write must
    // NOT be sent directly ahead of them — that let a fresh "Mark paid" commit before a
    // queued discount, settling the bill at the wrong amount. Append to the queue and kick
    // a flush so it replays in order behind the pending ones.
    if (queued.length) { await enqueue(item); flush(); return { ok: true, queued: true, action_id: item.id }; }

    let res;
    try {
      res = await doFetch(item);
    } catch (netErr) {
      // Genuine network failure (offline / DNS / dropped) → save for later.
      await enqueue(item);
      return { ok: true, queued: true, action_id: item.id };
    }
    // We got a response → behave exactly like the old api() helper.
    if (res.status === 401) { location.href = "/login"; throw new Error("login"); }
    // THE SERVER IS UP BUT CAN'T TAKE IT (5xx) → this is not a rejection, so don't hand the
    // person an error and drop their work. Save it and let the replay loop deliver it, which is
    // exactly what that loop already does for the SAME statuses once an action is queued
    // ("a transient server problem is not a rejection", below) — this closes the one hole left:
    // the FIRST attempt used to throw instead. It is what makes a rush behave like a slow shift
    // rather than a broken app: 800 orders arriving at once are all kept and drained in order.
    // 4xx is deliberately NOT included: that is the server refusing on the merits (a clash, a
    // closed table, a limit), and a person must see it rather than have it retried behind them.
    if (res.status >= 500) {
      await enqueue(item);
      flush();
      return { ok: true, queued: true, busy: true, action_id: item.id };
    }
    const j = await res.json().catch(() => null);
    // Carry the parsed body + status on the error so callers can read server flags
    // (e.g. duplicateWarning) that a bare message string would drop.
    if (!res.ok) { const e = new Error((j && j.error) || res.statusText); e.status = res.status; e.data = j; throw e; }
    return j;
  }

  // ── flush: replay the queue in order when we're back online ─────────────────
  async function flush() {
    if (flushing) return;
    if (!queued.length) { clearTimeout(retryTimer); retryTimer = null; retryStep = 0; return; }
    // Reported offline → don't try, but LEAVE A TIMER BEHIND. This used to return bare, and a
    // retry that happened to land during a one-second blip killed the last timer the queue had:
    // from then on nothing sent, however good the connection became.
    if (navigator.onLine === false) { scheduleRetry(false); return; }
    flushing = true;
    let progressed = false; // did anything actually get through this round?
    try {
      while (queued.length && navigator.onLine !== false) {
        const item = queued[0];
        let res;
        try { res = await doFetch(item, true); } // true = a saved change being replayed
        catch (netErr) { break; }               // still offline → stop; keep the queue for next time
        // NOT LOGGED IN. Keep the change and try again — a session can come back (the panel
        // refreshes its own login). But not forever in silence: if this device really has been
        // signed out, the person has to be told, or their work waits behind a spinner all shift.
        if (res.status === 401) {
          item.authTries = (item.authTries || 0) + 1;
          if (item.authTries < AUTH_MAX_TRIES) { await idbPut(item); break; }
          await moveToFailed(item, "This device is signed out", {
            plain: "This device was signed out, so this couldn't be sent.",
            todo: "Sign in on this device, then tap Try again.",
            retryable: true,
          });
          notify(); continue;
        }
        if (res.ok) { progressed = true; await removeItem(item.id); notify(); continue; } // sent (incl. server-dedup ok:true,duplicate:true)
        if (res.status === 409) {
          const j = await res.json().catch(() => null);
          if (j && j.retry) {
            // The server says it is handling this id right now. That normally clears in
            // seconds (a stale claim is taken over after 30s — lib/idempotency.ts), so if it
            // keeps saying it, something is wrong and a person should hear about it.
            item.busyTries = (item.busyTries || 0) + 1;
            if (item.busyTries < BUSY_MAX_TRIES) { await idbPut(item); break; }
            await moveToFailed(item, "The system is still working on this one", {
              plain: "The system says it is still busy with this change.",
              todo: "Check whether it already happened; if not, do it again.",
              retryable: true,
            });
            notify(); continue;
          }
          // A CLASH: while this device was offline, the same thing moved on (the table
          // was closed/billed, or another device changed exactly what this was changing).
          // The server refuses rather than overwrite it, and tells us how to say so.
          await moveToFailed(item, (j && j.clash && j.clash.plain) || (j && j.error) || "Already changed", j && j.clash);
          notify(); continue;
        }
        // A TRANSIENT server problem (5xx) is not a rejection — keep it queued so the
        // periodic re-flush tries again, exactly like the guest outbox does. Otherwise a
        // single database hiccup would strand a real order in the "needs you" list.
        // BUT not forever: if it keeps failing, a person needs to know rather than watch
        // "sending…" spin all shift. After a few goes it becomes their decision.
        if (res.status >= 500) {
          item.tries = (item.tries || 0) + 1;
          if (item.tries < 5) { await idbPut(item); break; }
          await moveToFailed(item, "The restaurant's system kept refusing this", {
            plain: "The system couldn't accept this after several tries.",
            todo: "Check whether it already happened; if not, do it again.",
            retryable: true,
          });
          notify(); continue;
        }
        // Any other 4xx → the server genuinely won't accept this action any more.
        // Surface it instead of losing it.
        const j = await res.json().catch(() => null);
        await moveToFailed(item, (j && j.error) || ("Sync failed (" + res.status + ")"), j && j.clash); notify(); continue;
      }
    } finally {
      flushing = false;
      notify();
      // If anything actually synced, nudge the panel to refetch true server state.
      try { window.dispatchEvent(new CustomEvent("lfh:outbox-flushed")); } catch (e) {}
      scheduleRetry(progressed);
    }
  }

  // While the queue is non-empty and we're online, retry periodically (covers a
  // flaky connection that comes back without firing an 'online' event).
  //
  // BACKING OFF, WITH JITTER, IS THE POINT. A fixed beat means every device in the restaurant
  // retries at the same instant: a server that is merely struggling gets hit by synchronised
  // waves and never gets the quiet moment it needs to catch up. Each failed round now waits
  // longer (15s, 30s, 60s… capped at 2 min) and each device rolls its own ±25%, so the load
  // spreads out instead of pulsing. `progressed` = something actually synced, which means the
  // server is healthy again, so go straight back to fast retries.
  function scheduleRetry(progressed) {
    clearTimeout(retryTimer); retryTimer = null;
    if (paused) return;                                  // test-only: hold the automatic retry
    if (!queued.length) { retryStep = 0; return; }
    if (progressed) retryStep = 0;
    // A TIMER IS SCHEDULED EVEN WHEN THE BROWSER SAYS WE ARE OFFLINE. It used to return here,
    // which meant the queue's last timer was thrown away the moment a retry coincided with a
    // blip, leaving the 'online' event as the only way back — and that event does not fire when
    // the browser never noticed a problem in the first place (a Wi-Fi that stays "connected"
    // with a dead uplink, a lid reopened, one request the server hung up on). While genuinely
    // offline this costs nothing: flush() sees navigator.onLine === false and returns without
    // touching the network, and the backoff below settles it to a two-minute heartbeat.
    const base = retryStep === 0
      ? RETRY_FIRST_MS                                                            // quick first go
      : Math.min(RETRY_BASE_MS * Math.pow(2, retryStep - 1), RETRY_MAX_MS);       // then 15s, 30s, 60s…
    const wait = Math.round(base * (0.75 + Math.random() * 0.5));
    retryStep = Math.min(retryStep + 1, 8);
    retryTimer = setTimeout(flush, wait);
  }

  // ── wake-ups ────────────────────────────────────────────────────────────────
  // Anything that means "a person is looking at this panel again" or "the connection just
  // changed" is a reason to try now instead of waiting out the backoff. Throttled, and it does
  // nothing at all when the queue is empty — a normal shift pays nothing for this.
  function wake(force) {
    if (!queued.length) return;
    if (navigator.onLine === false) return;
    const now = Date.now();
    if (!force && now - lastWakeAt < WAKE_MIN_GAP_MS) return;
    lastWakeAt = now;
    retryStep = 0; // a fresh signal → go back to fast retries
    flush();
  }

  // ── manual controls for the "waiting to sync" UI ────────────────────────────
  async function retryFailed() {
    if (!failed.length) return;
    const items = failed.splice(0, failed.length);
    for (const it of items) { it.status = "queued"; it.error = undefined; queued.push(it); await idbPut(it); }
    notify();
    flush();
  }
  async function dismiss(id) { await removeItem(id); notify(); }
  // Retry ONE specific change from the "Needs you" sheet (the old retryFailed() put the
  // whole list back at once, which is wrong when only one of them is worth another go).
  async function retryOne(id) {
    const it = failed.filter((x) => x.id === id)[0];
    if (!it) return;
    failed = failed.filter((x) => x.id !== id);
    // Reset the attempt counter too: a person choosing "Try again" is asking for a fresh
    // go, not for the one attempt left over from the automatic retries.
    it.status = "queued"; it.error = undefined; it.plain = undefined; it.todo = undefined; it.tries = 0;
    queued.push(it);
    await idbPut(it);
    notify();
    flush();
  }

  // ── boot: load any actions left over from a previous (offline) session ──────
  async function boot() {
    const all = await idbAll();
    queued = all.filter((x) => x.status !== "failed").sort((a, b) => a.at - b.at);
    failed = all.filter((x) => x.status === "failed");
    notify();
    // Flush now (if online), whenever the connection returns, and whenever the person comes
    // back to this panel. The last two matter because the first two can BOTH stay silent while
    // the connection quietly recovers — that is the 2026-08-02 fault.
    window.addEventListener("online", () => wake(true));
    if (window.LFH_RT && window.LFH_RT.onStatus) window.LFH_RT.onStatus((s) => { if (s === "online") wake(true); });
    document.addEventListener("visibilitychange", () => { if (!document.hidden) wake(); });
    window.addEventListener("focus", () => wake());
    if (navigator.onLine !== false) flush();
    scheduleRetry();
  }

  window.LFH_OUTBOX = {
    send,
    flush,
    retryFailed,
    retryOne,
    dismiss,
    // Everything taken on this device for ONE table that hasn't reached the server yet.
    // The panels use this to mark the table (⏳) and to list what's waiting inside it, so
    // an order taken with no internet is visible where the waiter looks for it.
    pendingForTable: function (t) {
      if (t == null) return [];
      const key = String(t);
      return queued.concat(failed).filter((it) => tableOf(it) === key);
    },
    // { "5": 2, "7": 1 } — how many unsent changes each table is carrying.
    pendingByTable: function () {
      const out = {};
      queued.concat(failed).forEach((it) => {
        const t = tableOf(it);
        if (t != null) out[t] = (out[t] || 0) + 1;
      });
      return out;
    },
    tableOf,
    getSnapshot: () => ({ queued: queued.slice(), failed: failed.slice(), count: queued.length + failed.length }),
    pendingCount: () => queued.length,
    failedCount: () => failed.length,
    // WHEN the oldest thing still waiting was done (ms since epoch, 0 = nothing waiting).
    // The bar uses it to stop saying "Sending…" about work that has plainly stopped moving.
    waitingSince: () => queued.reduce((a, it) => (a && a < it.at ? a : it.at), 0),
    isFlushing: () => flushing,
    // TEST-ONLY (scripts/verify-outbox-drain.mjs): hold the automatic retry so a check can
    // prove that a specific signal — coming back to the tab, tapping Send now — is what
    // delivered the change. Nothing in the app calls these.
    __pause: () => { paused = true; clearTimeout(retryTimer); retryTimer = null; },
    __resume: () => { paused = false; ensureRetry(); },
    onChange: (cb) => { listeners.add(cb); try { cb(window.LFH_OUTBOX.getSnapshot()); } catch (e) {} return () => listeners.delete(cb); },
  };

  if (document.readyState !== "loading") boot();
  else document.addEventListener("DOMContentLoaded", boot);
})();
