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
    if (replay) headers["X-LFH-Replay"] = "1";
    return fetch(item.base + item.path, {
      method: item.method,
      headers: headers,
      body: item.body != null ? JSON.stringify(item.body) : undefined,
    });
  }

  async function enqueue(item) {
    item.status = "queued";
    queued.push(item);
    await idbPut(item);
    notify();
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
  async function send({ base, method, path, body, panel, label }) {
    const item = { id: uuid(), base, method, path, body, panel: panel || "", label: label || labelFor(method, path), at: Date.now() };

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
    const j = await res.json().catch(() => null);
    // Carry the parsed body + status on the error so callers can read server flags
    // (e.g. duplicateWarning) that a bare message string would drop.
    if (!res.ok) { const e = new Error((j && j.error) || res.statusText); e.status = res.status; e.data = j; throw e; }
    return j;
  }

  // ── flush: replay the queue in order when we're back online ─────────────────
  async function flush() {
    if (flushing) return;
    if (navigator.onLine === false) return;
    if (!queued.length) return;
    flushing = true;
    try {
      while (queued.length && navigator.onLine !== false) {
        const item = queued[0];
        let res;
        try { res = await doFetch(item, true); } // true = a saved change being replayed
        catch (netErr) { break; }               // still offline → stop; keep the queue for next time
        if (res.status === 401) { break; }        // not logged in → can't sync now; keep the queue
        if (res.ok) { await removeItem(item.id); notify(); continue; } // sent (incl. server-dedup ok:true,duplicate:true)
        if (res.status === 409) {
          const j = await res.json().catch(() => null);
          if (j && j.retry) break;                // server is processing this id right now → try again shortly
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
      scheduleRetry();
    }
  }

  // While the queue is non-empty and we're online, retry periodically (covers a
  // flaky connection that comes back without firing an 'online' event).
  function scheduleRetry() {
    clearTimeout(retryTimer);
    if (queued.length && navigator.onLine !== false) retryTimer = setTimeout(flush, 15000);
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
    // Flush now (if online) and whenever the connection returns.
    window.addEventListener("online", flush);
    if (window.LFH_RT && window.LFH_RT.onStatus) window.LFH_RT.onStatus((s) => { if (s === "online") flush(); });
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
    onChange: (cb) => { listeners.add(cb); try { cb(window.LFH_OUTBOX.getSnapshot()); } catch (e) {} return () => listeners.delete(cb); },
  };

  if (document.readyState !== "loading") boot();
  else document.addEventListener("DOMContentLoaded", boot);
})();
