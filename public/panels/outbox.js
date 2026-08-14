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
  let nextTryAt = 0;   // ms since epoch of the next scheduled flush (0 = none pending)
  let lastWakeAt = 0;
  let paused = false; // test-only; see __pause below
  // A saved change may not sit in a silent retry loop forever. After this many rounds of the
  // same non-answer it becomes a person's decision instead of a spinner nobody can see.
  const AUTH_MAX_TRIES = 3;   // 401 — this device is signed out
  const BUSY_MAX_TRIES = 6;   // 409 {retry:true} — the server says it is still handling this id
  const NET_MAX_TRIES = 6;    // the request itself never completed, while the device says it is online
  // HOW MUCH ONE DEVICE MAY HOLD (improvement #1). Nothing bounded this: a tablet left with no
  // signal piled up changes until the browser's own storage refused — and that refusal landed on
  // the NEWEST change, the one the waiter was making, while the oldest sat there safely. The
  // diner's phone has stopped at 25 since it was written; a tablet does far more per shift, so
  // this is higher, and the OLDEST goes first with the person told, never a silent drop.
  const MAX_QUEUED = 200;
  const SERVER_MAX_TRIES = 6; // 5xx — the server is up but keeps refusing. Was a hard-typed `5`
                              // sitting beside these three named ones, and the DINER's queue
                              // used 6 for the same case: four ceilings in view of each other
                              // should read the same way, or the odd one out is the one a
                              // future change forgets. Now they do, and both queues agree.
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
  //
  // Resolves TRUE when the change really reached this device's storage and FALSE when it did
  // not (private browsing, storage full, a locked-down tablet profile). It used to swallow the
  // failure and resolve either way, so `enqueue()` reported success and the panel toasted
  // "Saved ✓ — syncing automatically" for a change that existed only in a JavaScript variable
  // and died on the next reload. The DINER's queue was fixed for exactly this
  // (lib/guestOutbox.ts idbWrite → `persisted`); the staff queue was left on the old behaviour.
  // The caller decides what to say; this just stops lying about it.
  function idbWrite(fn) {
    return db().then((d) => new Promise((resolve, reject) => {
      const tx = d.transaction(STORE, "readwrite");
      fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    })).catch(() => false); // IDB blocked (private mode etc.) → in-memory only, and SAY so
  }
  async function idbPut(item) { return await idbWrite((store) => store.put(item)); }
  async function idbDel(id) { await idbWrite((store) => store.delete(id)); }

  // ── WHY THE SERVER SAID NO, in words a waiter reads ─────────────────────────
  // THE ONE LIST, and it lives here because this file is the one place every panel's queue
  // drains through. It used to live only in the manager panel (KOT_REASON_TEXT in
  // editor/app.js), which reads it back OUT of here now — so there is a single copy and the
  // waiter tablet gets the same sentences for free instead of the raw code it had before.
  //
  // Each entry is a FRAGMENT, so it reads correctly both in the manager's live toast
  // ("Couldn't shift: that table already has a party on it") and in the "Needs you" sheet
  // ("It couldn't be applied — that table already has a party on it.").
  //
  // Every code below is one the table-ops database functions really answer with
  // (lfh_staff_shift_table, lfh_staff_move_order, lfh_staff_move_order_item — migs 166/264).
  // If you add a reason to any of those, add its sentence here in the same commit.
  //
  // THE PANELS ARE ENGLISH. FULL STOP. (owner, 2026-08-13: *"make sure you write the code also
  // that the panel will be in English, only the other things can be changed."*)
  //
  // These are literals on purpose and must stay literals: do NOT move them into lib/i18n.ts, do
  // not add a locale argument, do not "finish the translation" here later. The guest MENU is the
  // multilingual surface — staff screens are one language so that a manager, a waiter and a cook
  // reading the same refusal are reading the same words, and so a bug report quotes a sentence
  // anyone on the team can search for. The same rule covers the offline bar's wording in
  // public/panels/offline.js and the two panels' errText().
  const REASONS = {
    party_merged: "this party spans merged tables — unmerge first, then move it",
    merged_child: "that table is joined with another and shares its bill — unmerge it first",
    target_occupied: "that table already has a party on it",
    target_invoiced: "that table's bill is already invoiced — void it first",
    source_invoiced: "this bill is already invoiced — void it first",
    order_paid: "that KOT is already paid — settled money doesn't move",
    order_cancelled: "that order was cancelled",
    same_table: "that's the same bill it is on now",
    no_session: "that table's party is gone — refresh and try again",
    no_order: "that order is no longer there — refresh and try again",
    item_not_found: "that dish is no longer on the order",
    order_not_found: "that order is no longer there — refresh and try again",
    session_closed: "this table has already been closed — refresh and try again",
    bad_table: "that isn't a valid table number",
    target_not_open: "that table has no party — use Change table to move there instead",
  };
  function reasonText(code) { return (code && REASONS[code]) || ""; }

  // ── helpers ─────────────────────────────────────────────────────────────────
  const uuid = () => (self.crypto && self.crypto.randomUUID)
    ? self.crypto.randomUUID()
    : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => { const r = Math.random() * 16 | 0; return (c === "x" ? r : (r & 3 | 8)).toString(16); });

  // THIS DEVICE COULDN'T WRITE TO ITS OWN STORAGE. Sticky for the life of the page, because it
  // is a property of the device (private browsing, storage full, a locked-down profile), not of
  // one change. Surfaced in the bar rather than in each of the ~16 "Saved ✓" toasts across the
  // three panels: the bar is the one surface whose whole job is saying what is actually true,
  // and a per-toast fix is a fix that misses the call site added next month.
  let unsafeStore = false;

  function notify() {
    // `syncing` = a replay round is ACTUALLY in flight. The bar must not say "Sending…"
    // purely because the count is above zero.
    const snap = { queued: queued.slice(), failed: failed.slice(), count: queued.length + failed.length, syncing: flushing, unsafeStore: unsafeStore };
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
  // EVERY table a change touches — a move has TWO (improvement #9). `tableOf` answers "whose work
  // is this?" (the source), which is right for ordering; but the ⏳ mark answered the same
  // question, so a ticket on its way to table 7 left table 7 showing nothing at all and the
  // waiter looking at it had no idea something was coming.
  function tablesOf(item) {
    const out = [];
    const from = tableOf(item);
    if (from != null) out.push(String(from));
    try {
      const to = (item.body || {}).to;
      if (to != null && String(to) !== "" && String(to) !== String(from)) out.push(String(to));
    } catch (e) { /* ignore */ }
    return out;
  }

  function tableOf(item) {
    try {
      // WHOSE WORK IS THIS? An action that names a ROW rather than a table — /orders/:id/accept is
      // the commonest, and it is what the floor's one-tap ✓ sends — has no table in its path OR its
      // body, so this answered null and the table carried no ⏳ mark at all. Measured on the manager
      // floor: with no signal the only sign anywhere was a bar at the top of the screen, nowhere
      // near the table that had just been tapped.
      // The caller always knows the table (it is the argument to acceptTableOrders), so it may now
      // say so. Deliberately NOT put on the body: the body is what the server parses, and a readout
      // must never be able to change what a write means.
      if (item.table != null && String(item.table) !== "") return String(item.table);
      var b = item.body || {};
      if (b.table != null && b.table !== "") return String(b.table);
      if (b.table_number != null && b.table_number !== "") return String(b.table_number);
      var p = item.path || "";
      var m = p.match(/\/tables\/([^/?&]+)/) || p.match(/[?&]table=([^&]+)/);
      if (m) return decodeURIComponent(m[1]);
    } catch (e) { /* ignore */ }
    return null;
  }

  // WHAT MUST STAY IN ORDER WITH WHAT (improvements #2 + #6, 2026-08-06).
  //
  // The queue was strictly first-in-first-out across the WHOLE device, and that is stricter than
  // the rule it was written for. The bug it exists to stop is real and specific: a queued discount
  // and a later "Mark paid" on the SAME BILL must not swap, or the bill settles at the wrong
  // amount. Two changes on two DIFFERENT tables have no such relationship — yet one stuck change
  // held up every other table's work behind it, for as long as six rounds of backoff (~4 minutes),
  // on the busiest device in the building.
  //
  // So ordering is kept per TABLE. Everything the queue can't tie to a table (a parcel, a floor
  // issue, a settings save) shares one bucket and stays strictly ordered with itself — "I can't
  // tell" must never be read as "these are independent", which is the same direction every other
  // judgement in this pipeline takes.
  const UNTABLED = "\u0000untabled";
  function orderKey(it) { const t = tableOf(it); return t == null ? UNTABLED : String(t); }

  // `replay` = this is a change coming OUT of the queue (it was saved on the device
  // earlier), not a live write. Only a replay is clash-checked on the server, which is
  // what keeps the normal online path byte-for-byte unchanged.
  // A DEADLINE, WITHOUT ASSUMING THE DEVICE CAN MAKE ONE. Both diner-side twins
  // (lib/menu.ts orderDeadline, lib/guestOutbox.ts sendDeadline) wrap this in try/catch because
  // READING AbortSignal.timeout throws on some older phones — and when it did, the throw was
  // caught somewhere else and mis-reported as "the restaurant is busy". This file tested it with
  // a bare `?:`, so the same throw would have escaped into doFetch and killed a waiter's write.
  // Staff tablets are usually older and cheaper than the diners' phones, so if anywhere needs the
  // guard it is here. No signal is better than no write.
  function writeDeadline() {
    try {
      return typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
        ? AbortSignal.timeout(WRITE_TIMEOUT_MS)
        : undefined;
    } catch (e) { return undefined; }
  }

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
      signal: writeDeadline(),
    });
  }

  // `why` = the reason this landed in the queue, kept so the bar can say something TRUE.
  // "offline" is the only one that may say "made while you were offline"; a write parked
  // because the system was slow, refusing, or because earlier changes were still waiting is
  // NOT an offline change, and calling it one is how the panel told the owner he had no
  // internet while the connection light beside it read 462 ms (2026-08-02).
  //
  // Returns whether the change reached this device's STORAGE. `false` = it is queued in memory
  // and will send, but closing or reloading the panel loses it — so a caller must not promise
  // "we'll send it automatically". See idbWrite().
  async function enqueue(item, why) {
    item.status = "queued";
    item.why = why || item.why || "offline";
    queued.push(item);
    // Over the ceiling → the OLDEST goes to "Needs you" (never deleted): it is the one least
    // likely to still be wanted, and the person can see it and decide. Marked non-retryable
    // because re-sending something this old against a floor that has moved on is exactly what
    // the clash gate would refuse anyway.
    while (queued.length > MAX_QUEUED) {
      const oldest = queued[0];
      await moveToFailed(oldest, "This waited too long to send", {
        plain: "This device is holding more unsent changes than it can keep, so the oldest one was set aside.",
        todo: "Check whether it still needs doing, and do it again if so.",
        retryable: false,
      });
    }
    const persisted = await idbPut(item);
    if (!persisted) unsafeStore = true;   // the bar says so; see the note on unsafeStore
    notify();
    // NEVER leave saved work with nothing to send it. This one line is the whole of the
    // 2026-08-02 fault: a write that died mid-flight was saved here and then simply waited,
    // because the only wake-ups were the browser's 'online' event and realtime reconnecting —
    // and neither of those happens when the connection never actually dropped. The owner
    // watched "Sending 3 saved changes…" on a healthy connection while nothing was being sent.
    ensureRetry();
    return persisted;
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
  async function send({ base, method, path, body, panel, label, expect, table }) {
    const item = { id: uuid(), base, method, path, body, panel: panel || "", label: label || labelFor(method, path), at: Date.now(), expect: expect || null, table: (table == null || table === "") ? null : String(table) };
    // WHICH TABLE, ON EVERY ROW. The "Needs you" / "Saved on this device" sheet lists changes by
    // label, and a call site that passes its own label ("Set table tag", "Place order") named no
    // table at all — so two changes on tables 5 and 7 rendered as two identical rows with nothing
    // to tell them apart (seen on a 360px phone, 2026-08-12). The queue already knows whose work
    // it is (tableOf reads the path OR the body), so it is added here, once, rather than at the
    // ~16 call sites across three panels. Skipped when the label already says it, so
    // labelFor's own "· Table 5" is never doubled.
    try {
      var whose = tableOf(item);
      if (whose != null && String(whose) !== "" && !/·\s*Table\s/i.test(item.label)) {
        item.label += " · Table " + whose;
      }
    } catch (e) { /* a label is a nicety; never let it stop a write */ }

    // Known offline → don't even try; queue straight away.
    if (navigator.onLine === false) { const p = await enqueue(item, "offline"); return { ok: true, queued: true, action_id: item.id, persisted: p, why: "offline" }; }

    // FIFO GUARD (#6): if earlier actions are STILL waiting to sync, this new write must
    // NOT be sent directly ahead of them — that let a fresh "Mark paid" commit before a
    // queued discount, settling the bill at the wrong amount. Append to the queue and kick
    // a flush so it replays in order behind the pending ones.
    //
    // `failed` COUNTS TOO, and leaving it out re-opened the very bug this guard exists for.
    // A change that is retryable but has run out of automatic attempts (six timed-out rounds on
    // a flaky connection) moves to the "Needs you" list and OUT of `queued` — so the queue looked
    // empty and the next write went straight to the server. Real sequence: a discount times out
    // into Needs-you, "Mark paid" then commits at the FULL amount, and the person taps Try again
    // on the discount afterwards, applying it to an already-settled bill. Anything still owed to
    // this table has to clear before a later change to it can be sent.
    // …and it is judged PER TABLE now (see orderKey): a change for table 5 waits behind other
    // work for table 5, and sails past a stuck change for table 9. `failed` still counts, and for
    // the original reason — a retryable change that ran out of automatic attempts leaves `queued`
    // for the "Needs you" list, and if that did not count here, a later "Mark paid" for the SAME
    // table would go straight to the server ahead of a discount the person is about to retry.
    const key = orderKey(item);
    const owed = function (it) { return orderKey(it) === key; };
    if (queued.some(owed) || failed.some(function (f) { return f.retryable !== false && owed(f); })) {
      const p = await enqueue(item, "behind"); flush(); return { ok: true, queued: true, action_id: item.id, persisted: p, why: "behind" };
    }

    let res;
    try {
      res = await doFetch(item);
    } catch (netErr) {
      // Genuine network failure (offline / DNS / dropped) → save for later.
      // A timeout while the browser still believes it is online is a SLOW system, not an
      // offline device — do not let the bar call it one.
      const why = navigator.onLine === false ? "offline" : "slow";
      const p = await enqueue(item, why);
      // WHY it is waiting travels back to the caller (improvement #3). The panels toasted one
      // sentence — "Saved ✓ — syncing automatically" — for four quite different situations, and a
      // waiter who hears "saved" about something the kitchen has not got may not chase it.
      return { ok: true, queued: true, action_id: item.id, persisted: p, why };
    }
    // We got a response → behave exactly like the old api() helper.
    //
    // SIGNED OUT MID-TAP: keep the work, THEN go to the sign-in page. This used to throw the
    // change away, which made a shift login that expired between two taps the one way to lose
    // a discount / a close / an order outright — while the IDENTICAL tap made with no signal
    // survived, because the replay loop treats a 401 as "keep it and tell them" (see the 401
    // branch in flush(), which says so in as many words). IndexedDB outlives the navigation, so
    // this replays itself the moment they sign back in, which is what that branch already
    // promises. The throw is unchanged, so callers behave exactly as before.
    if (res.status === 401) { await enqueue(item, "signedout"); location.href = "/login"; throw new Error("login"); }
    // THE SERVER IS UP BUT CAN'T TAKE IT (5xx) → this is not a rejection, so don't hand the
    // person an error and drop their work. Save it and let the replay loop deliver it, which is
    // exactly what that loop already does for the SAME statuses once an action is queued
    // ("a transient server problem is not a rejection", below) — this closes the one hole left:
    // the FIRST attempt used to throw instead. It is what makes a rush behave like a slow shift
    // rather than a broken app: 800 orders arriving at once are all kept and drained in order.
    // 4xx is deliberately NOT included: that is the server refusing on the merits (a clash, a
    // closed table, a limit), and a person must see it rather than have it retried behind them.
    if (res.status >= 500) {
      const p = await enqueue(item, "busy");
      flush();
      return { ok: true, queued: true, busy: true, action_id: item.id, persisted: p, why: "busy" };
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
      // WALK THE QUEUE, DON'T STOP AT THE FIRST OBSTACLE (improvements #2 + #6).
      //
      // This used to take queued[0] and `break` the whole drain the moment anything was not
      // delivered — so one change the server kept refusing held every other table's work on the
      // device for the rest of its backoff. Now a stuck change parks its OWN table (see orderKey)
      // and the walk carries on to the next one, which is exactly the promise the per-table rule
      // in send() makes: table 9 being stuck is not table 5's problem.
      //
      // `stalled` is per ROUND, not persistent: the next flush starts fresh and retries everything
      // in order again. `i` only advances when the item is still in the queue — a delivered or
      // failed item is spliced out, so the next one has already taken its index.
      const stalled = new Set();
      let i = 0;
      while (i < queued.length && navigator.onLine !== false) {
        const item = queued[i];
        const key = orderKey(item);
        // An earlier change for this same table did not get through this round. Sending a LATER
        // one now is the exact swap the ordering rule exists to prevent.
        if (stalled.has(key)) { i++; continue; }
        let res;
        try { res = await doFetch(item, true); } // true = a saved change being replayed
        catch (netErr) {
          // Genuinely offline → stop and keep the queue; that is what it is for.
          if (navigator.onLine === false) break;   // genuinely offline → stop the whole round
          // ONLINE and still not getting through (each attempt timing out, a request dropped
          // every time). This was the last path that could loop forever in silence — and a
          // change stuck in "waiting" is the worst place for it, because a waiting row has no
          // buttons. Same treatment as the signed-out and still-busy cases beside it.
          item.netTries = (item.netTries || 0) + 1;
          if (item.netTries < NET_MAX_TRIES) { await idbPut(item); stalled.add(key); i++; continue; }
          await moveToFailed(item, "The restaurant's system didn't answer", {
            plain: "The system didn't answer, several times over.",
            todo: "Check whether it already happened; if not, do it again.",
            retryable: true,
          });
          notify(); continue;
        }
        // NOT LOGGED IN. Keep the change and try again — a session can come back (the panel
        // refreshes its own login). But not forever in silence: if this device really has been
        // signed out, the person has to be told, or their work waits behind a spinner all shift.
        if (res.status === 401) {
          item.authTries = (item.authTries || 0) + 1;
          // Signed out is a DEVICE-wide problem, not this table's: nothing else will get through
          // either, so park the whole round rather than walking the queue to fail every item.
          if (item.authTries < AUTH_MAX_TRIES) { await idbPut(item); break; }
          await moveToFailed(item, "This device is signed out", {
            plain: "This device was signed out, so this couldn't be sent.",
            todo: "Sign in on this device, then tap Try again.",
            retryable: true,
          });
          notify(); continue;
        }
        // A 2xx ALONE IS NOT "IT WENT THROUGH". Several staff branches report a refusal INSIDE
        // a 200, because they hand the database function's own JSON straight back:
        // `sessions/:id/shift`, `orders/:id/move`, `order-items/:id/move`,
        // `sessions/:id/bill-discount`, `banquet/place` and `customer-capture` all answer
        // `{ ok:false, reason:'order_paid' | 'session_closed' | 'target_occupied' | … }` with a 200.
        //
        // This used to remove the change on `res.ok` alone, so every one of those VANISHED: a
        // waiter moved a KOT while offline, the queue drained, the server said "that order is
        // already paid" — and the ⏳ on the table simply disappeared. No toast, no row in "Needs
        // you", nothing to tap. Every signal the waiter had said it worked; the KOT was still on
        // the old table. (The live path was always fine — each call site checks `r.ok` itself.)
        //
        // The DINER's queue has had this exact check since it was written (lib/guestOutbox.ts:
        // "A DUPLICATE THAT SAYS ok:false IS NOT A PLACED ORDER"), and lib/idempotencyRule.ts
        // fixed the SERVER half of the same shape — it refuses to REMEMBER a 200 that says no.
        // The staff queue was the last place still reading the status and ignoring the answer.
        if (res.ok) {
          const j = await res.json().catch(() => null);
          if (j && j.ok === false) {
            const why = reasonText(j.reason);
            await moveToFailed(item, "The system wouldn't accept this", {
              plain: why ? "It couldn't be applied — " + why + "." : "The system wouldn't accept this change.",
              todo: "Nothing was applied. Check that table and do it again if it's still needed.",
              // NOT retryable, for the same reason a clash isn't: every code above is a state
              // that has already moved on, so sending the identical change again can only fail
              // the same way. A person has to look at how things are NOW.
              retryable: false,
            });
            notify(); continue;
          }
          progressed = true; await removeItem(item.id); notify(); continue; // sent (incl. server-dedup ok:true,duplicate:true)
        }
        if (res.status === 409) {
          const j = await res.json().catch(() => null);
          if (j && j.retry) {
            // The server says it is handling this id right now. That normally clears in
            // seconds (a stale claim is taken over after 30s — lib/idempotency.ts), so if it
            // keeps saying it, something is wrong and a person should hear about it.
            item.busyTries = (item.busyTries || 0) + 1;
            if (item.busyTries < BUSY_MAX_TRIES) { await idbPut(item); stalled.add(key); i++; continue; }
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
          if (item.tries < SERVER_MAX_TRIES) { await idbPut(item); stalled.add(key); i++; continue; }
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
    clearTimeout(retryTimer); retryTimer = null; nextTryAt = 0;
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
    nextTryAt = Date.now() + wait;
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
  // Put every RETRYABLE failure back. Two things this deliberately does not do:
  //  · it no longer re-sends a clash (`retryable: false`). The server said the ground moved, so
  //    sending the identical change again cannot help — it just fails a second time and the row
  //    reappears looking like the app is stuck. Those stay put until a person redoes them.
  //  · it no longer leaves the attempt counters at their ceiling. Clearing only `status`/`error`
  //    meant a re-queued item had already spent its six network / six busy / three auth rounds,
  //    so it was ejected again after ONE attempt and "Try again" looked broken.
  async function retryFailed() {
    if (!failed.length) return;
    const again = failed.filter(function (x) { return x.retryable !== false; });
    if (!again.length) return;
    failed = failed.filter(function (x) { return x.retryable === false; });
    for (const it of again) { resetTries(it); queued.push(it); await idbPut(it); }
    notify();
    flush();
  }

  // One place that says what "a fresh go" means, so the two retry entry points can't drift.
  function resetTries(it) {
    it.status = "queued";
    it.error = undefined; it.plain = undefined; it.todo = undefined;
    it.tries = 0; it.netTries = 0; it.busyTries = 0; it.authTries = 0;
  }
  async function dismiss(id) { await removeItem(id); notify(); }
  // Retry ONE specific change from the "Needs you" sheet (the old retryFailed() put the
  // whole list back at once, which is wrong when only one of them is worth another go).
  async function retryOne(id) {
    const it = failed.filter((x) => x.id === id)[0];
    if (!it) return;
    failed = failed.filter((x) => x.id !== id);
    // Reset EVERY attempt counter: a person choosing "Try again" is asking for a fresh go, not
    // for the one attempt left over from the automatic retries. It used to clear `tries` alone,
    // which left the three newer counters (network / busy / signed-out) at their ceiling.
    resetTries(it);
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
      return queued.concat(failed).filter((it) => tablesOf(it).indexOf(key) >= 0);
    },
    // { "5": 2, "7": 1 } — how many unsent changes each table is carrying.
    pendingByTable: function () {
      const out = {};
      queued.concat(failed).forEach((it) => {
        tablesOf(it).forEach((t) => { out[t] = (out[t] || 0) + 1; });
      });
      return out;
    },
    tableOf,
    tablesOf,
    // THE ONE LIST of "why the server said no", so the manager panel's live toast and the
    // "Needs you" sheet can never word the same refusal differently (see REASONS above).
    REASONS,
    reasonText,
    // Everything on ONE table that came back needing a person and cannot be re-sent as-is
    // (a clash, or a refusal the server has already settled). The tables mark those
    // differently from work that is genuinely still on its way — "not sent yet" on a change
    // that can never be sent is the same cry-wolf fault the top bar was fixed for.
    blockedByTable: function () {
      const out = {};
      failed.forEach((it) => {
        if (it.retryable !== false) return;
        tablesOf(it).forEach((t) => { out[t] = (out[t] || 0) + 1; });
      });
      return out;
    },
    getSnapshot: () => ({ queued: queued.slice(), failed: failed.slice(), count: queued.length + failed.length }),
    pendingCount: () => queued.length,
    failedCount: () => failed.length,
    // WHEN the oldest thing still waiting was done (ms since epoch, 0 = nothing waiting).
    // The bar uses it to stop saying "Sending…" about work that has plainly stopped moving.
    waitingSince: () => queued.reduce((a, it) => (a && a < it.at ? a : it.at), 0),
    // WHEN THE NEXT ATTEMPT IS DUE (improvement #8). The bar decided "this is stuck" purely on
    // age — 90 seconds — while the backoff between rounds runs out to two minutes. So the honest
    // wait between two normal tries was being announced as a fault, on a healthy connection: the
    // cry-wolf shape this bar has already been fixed for once. It can ask now instead of guessing.
    nextTryAt: () => nextTryAt,
    isFlushing: () => flushing,
    // TRUE once anything failed to reach this device's storage — so what is waiting will NOT
    // survive a reload, and the bar has to say so rather than promise "syncing automatically".
    storageFailed: () => unsafeStore,
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
