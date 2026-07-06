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

  function doFetch(item) {
    return fetch(item.base + item.path, {
      method: item.method,
      headers: { "Content-Type": "application/json", "X-LFH-Action-Id": item.id },
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

  async function moveToFailed(item, reason) {
    queued = queued.filter((x) => x.id !== item.id);
    item.status = "failed";
    item.error = reason || "Could not sync";
    failed.push(item);
    await idbPut(item);
  }

  // ── the public send(): fetch-or-queue with the api() contract ───────────────
  async function send({ base, method, path, body, panel, label }) {
    const item = { id: uuid(), base, method, path, body, panel: panel || "", label: label || labelFor(method, path), at: Date.now() };

    // Known offline → don't even try; queue straight away.
    if (navigator.onLine === false) { await enqueue(item); return { ok: true, queued: true, action_id: item.id }; }

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
    if (!res.ok) throw new Error((j && j.error) || res.statusText);
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
        try { res = await doFetch(item); }
        catch (netErr) { break; }               // still offline → stop; keep the queue for next time
        if (res.status === 401) { break; }        // not logged in → can't sync now; keep the queue
        if (res.ok) { await removeItem(item.id); notify(); continue; } // sent (incl. server-dedup ok:true,duplicate:true)
        if (res.status === 409) {
          const j = await res.json().catch(() => null);
          if (j && j.retry) break;                // server is processing this id right now → try again shortly
          await moveToFailed(item, (j && j.error) || "Already changed"); notify(); continue;
        }
        // Any other 4xx/5xx → the server rejected this action (state changed while
        // offline, or it's no longer valid). Surface it instead of losing it.
        const j = await res.json().catch(() => null);
        await moveToFailed(item, (j && j.error) || ("Sync failed (" + res.status + ")")); notify(); continue;
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
    dismiss,
    getSnapshot: () => ({ queued: queued.slice(), failed: failed.slice(), count: queued.length + failed.length }),
    pendingCount: () => queued.length,
    failedCount: () => failed.length,
    onChange: (cb) => { listeners.add(cb); try { cb(window.LFH_OUTBOX.getSnapshot()); } catch (e) {} return () => listeners.delete(cb); },
  };

  if (document.readyState !== "loading") boot();
  else document.addEventListener("DOMContentLoaded", boot);
})();
