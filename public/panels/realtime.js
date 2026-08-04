// realtime.js — shared Realtime helper for the static staff panels
// (manager/kitchen/tablet). Opens ONE WebSocket to Supabase, listens for tiny
// "breadcrumb" rows on the panel's topic, and calls your onEvent() so the panel
// can refetch its state — only when something actually changed, instead of every
// second. Handles reconnects, tab-wake (visibility/focus/pageshow) and
// network-back, DEBOUNCES bursts into one refetch, and collects metrics.
//
// Usage from a panel:
//   LFH_RT.start({ topics: ["ops"], onEvent: () => load() });
// onEvent runs once on start (initial load), on every breadcrumb (debounced ~300ms
// so a Preparing→Ready→Served burst = ONE refetch), and on wake/reconnect.
(function () {
  let sbPromise = null;
  // This panel's restaurant id, learned from /api/rt-config. Used to DROP realtime
  // breadcrumbs belonging to OTHER restaurants: the rt:ops / rt:menu topic names are
  // shared across every tenant, so without this each restaurant's panel refetched on
  // every other restaurant's activity (owner's #1 scaling fear — egress). Mirrors the
  // guest RealtimeProvider / lib/useRealtime.ts filter. Empty until config loads (then
  // we keep everything — safe: at worst an extra refetch, never a missed update).
  let RT_RID = "";
  // The admin's per-tab pin (?rid=) rides on the iframe URL; forward it so rt-config
  // resolves THIS tab's restaurant (not the browser-wide act-as cookie).
  const RT_RID_Q = new URLSearchParams(location.search).get("rid") || "";
  // Live metrics — inspect any time in the panel console:  __lfh_rt
  const metrics = {
    subscribed: 0, reconnects: 0, events: 0, errors: 0,
    refetch_count: 0, sync_failures: 0,
    avgLatencyMs: 0, lastEventAt: 0, startedAt: Date.now(), topics: [],
    _latSum: 0, _latN: 0,
    // Live latency for the connection badge: the LAST breadcrumb delivery time (now −
    // created_at) + when it was read + a short ring of recent readings for the sparkline.
    // Measured from events the panel ALREADY receives — no extra request (owner 2026-07-08).
    lastLatencyMs: null, lastLatencyAt: 0, latHist: [],
  };
  window.__lfh_rt = metrics;
  const LAT_HIST_MAX = 24;
  const latListeners = new Set();
  function recordLatency(ms) {
    if (!(ms >= 0) || ms > 60000) return;
    ms = Math.round(ms);
    metrics.lastLatencyMs = ms; metrics.lastLatencyAt = Date.now();
    metrics.latHist.push(ms); if (metrics.latHist.length > LAT_HIST_MAX) metrics.latHist.shift();
    metrics._latSum += ms; metrics._latN++; metrics.avgLatencyMs = Math.round(metrics._latSum / metrics._latN);
    latListeners.forEach((fn) => { try { fn(ms); } catch (e) {} });
  }

  // ── connection status (drives the top-right green/yellow/red badge) ─────────
  // Three human states the badge paints:
  //   "online"  🟢  websocket subscribed → live updates are flowing.
  //   "weak"    🟡  the device HAS internet but the live socket is connecting /
  //                 errored / reconnecting (so updates may lag).
  //   "offline" 🔴  the device has NO internet at all (navigator.onLine === false).
  // Starts pessimistic ("weak") until the first SUBSCRIBED flips it green.
  const statusListeners = new Set();
  let connStatus = (typeof navigator !== "undefined" && navigator.onLine === false) ? "offline" : "weak";
  // Has the socket EVER successfully connected? Lets the badge show a calm "Connecting…"
  // on first load instead of the alarming amber "Reconnecting" (owner 2026-07-08 — the
  // startup "weak" window is ~5–8s and looked like it was broken). Only a DROP after a
  // real connection shows "Reconnecting".
  let everConnected = false;
  metrics.status = connStatus;
  function setStatus(s) {
    if (s === "online") everConnected = true;
    if (s === connStatus) return;
    connStatus = s; metrics.status = s;
    statusListeners.forEach((fn) => { try { fn(s); } catch (e) {} });
  }
  // A hard device-level offline/online flips the badge INSTANTLY, before the
  // websocket even notices. (The reconnect wake() inside start() is separate —
  // this pair only moves the badge colour.)
  if (typeof window !== "undefined") {
    window.addEventListener("offline", () => setStatus("offline"));
    window.addEventListener("online", () => { if (connStatus === "offline") setStatus("weak"); });
  }

  // A FAILED BOOT MUST NOT BE REMEMBERED FOREVER (T4 sweep, 2026-08-04). This used to cache
  // the promise unconditionally — including a REJECTED one. So a single blip on the way up
  // (a cold start, a slow tunnel, /api/rt-config answering 500 once) meant `sb` stayed null for
  // the life of the page: every subscribe() returned immediately and every wake() — visibility,
  // focus, pageshow, `online` — was a no-op, because nothing ever asked for the client again.
  // The panel sat on its slow backstop while the device had a perfectly good connection, and the
  // badge said "weak" with no way back. Forgetting the rejection is what lets ensureClient()
  // (below) genuinely try again on the next wake.
  async function getClient() {
    if (sbPromise) return sbPromise;
    const p = sbPromise = (async () => {
      const cfg = await (await fetch("/api/rt-config" + (RT_RID_Q ? "?rid=" + encodeURIComponent(RT_RID_Q) : ""), { cache: "no-store" })).json();
      RT_RID = cfg.restaurantId || ""; // this panel's restaurant → cross-tenant event filter (noteEvent)
      // SELF-HOSTED: import the Supabase client from OUR origin (built by
      // scripts/build-vendor.mjs), not the jsdelivr CDN. A restaurant's wifi can be
      // slow or block public CDNs, which made the panel hang or silently fall back
      // to slow polling — a same-origin file removes that whole failure mode.
      // worker:true keeps the websocket heartbeat alive in a Web Worker so a
      // backgrounded tablet tab doesn't silently drop the live connection.
      const mod = await import("/vendor/supabase.js");
      return mod.createClient(cfg.url, cfg.anonKey, { realtime: { worker: true, params: { eventsPerSecond: 10 } } });
    })();
    // Drop the memo on failure so the NEXT call re-boots. The rejection still reaches this
    // caller (we attach a separate handler rather than swallowing it), and the `p === sbPromise`
    // test means a newer boot already in flight is never cleared out from under itself.
    p.catch(() => { if (sbPromise === p) sbPromise = null; });
    return p;
  }

  function debounce(fn, ms) { let t; return () => { clearTimeout(t); t = setTimeout(fn, ms); }; }

  async function start(opts) {
    opts = opts || {};
    // Normalise to a { topic: handler } map. Back-compat with {topics, onEvent}:
    //   LFH_RT.start({ topics: ["ops","menu"], onEvent: () => load() })   // one fn, many topics
    //   LFH_RT.start({ handlers: { ops: pollOrders, menu: loadAll } })    // a fn PER topic
    // Per-topic handlers matter when one topic is cheap (ops → pollOrders) and
    // another is expensive (menu → loadAll): a cheap event must not trigger the
    // expensive refetch.
    let handlers = opts.handlers;
    if (!handlers) {
      const onEvent = opts.onEvent || function () {};
      const topics = opts.topics || ["ops"];
      handlers = {};
      topics.forEach((t) => { handlers[t] = onEvent; });
    }
    const topicList = Object.keys(handlers);
    metrics.topics = topicList;

    // One debounced refetch PER topic (counts it, runs it, never throws). Bursts on
    // a topic coalesce into a single refetch of THAT topic's handler.
    // TARGETED REFETCH (owner 2026-06-26 — egress cut): each breadcrumb names the table
    // that changed (table_number) + what changed (kind). We ACCUMULATE the set of changed
    // tables during the debounce window and hand it to the handler as { full, tables[] },
    // so a smart handler can refetch ONLY those tables instead of the whole floor. If any
    // event in the window can't be scoped to one table (no table_number, or kind that
    // spans tables like 'platform'), we flag `full` → the handler does a whole-board
    // reload. SAFE FALLBACK: worst case is one wasted full reload, never a wrong floor.
    // Handlers that ignore the argument (kitchen/tablet today) keep doing full loads.
    const acc = {};
    const firePerTopic = {};
    topicList.forEach((topic) => {
      acc[topic] = { tables: new Set(), full: false };
      const run = async () => {
        const a = acc[topic];
        const detail = a.full ? { full: true } : { full: false, tables: [...a.tables] };
        acc[topic] = { tables: new Set(), full: false }; // reset for the next burst
        metrics.refetch_count++;
        try { await handlers[topic](detail); } catch (e) { metrics.sync_failures++; }
      };
      firePerTopic[topic] = debounce(run, 200); // coalesce a burst into one refetch; 200ms feels instant while still collapsing a Preparing→Ready→Served burst
    });
    // Record one breadcrumb's scope, then schedule the (debounced) refetch.
    const noteEvent = (topic, row) => {
      const a = acc[topic]; if (!a) return;
      // Drop breadcrumbs from OTHER restaurants (shared rt:ops/rt:menu topic names).
      // If either id is missing, keep the event (safe fallback — never miss an update).
      if (RT_RID && row && row.restaurant_id && row.restaurant_id !== RT_RID) return;
      const tn = row && row.table_number;
      const spans = !tn || (row && row.kind === "platform"); // unscopable → full reload
      if (spans) a.full = true;
      else {
        a.tables.add(String(tn));
        // A bulk action (open-all / close-all) emits ONE breadcrumb per table; past ~20 changed
        // tables a single full reload is far cheaper than N per-table fetches. (B13 egress)
        if (a.tables.size > 20) { a.full = true; a.tables.clear(); }
      }
      firePerTopic[topic]();
    };
    // Wake/reconnect/initial → FULL refetch of every topic once (each debounced).
    const fireAll = () => topicList.forEach((t) => { if (acc[t]) acc[t].full = true; firePerTopic[t](); });

    let everSubscribed = false;
    let sb = null;
    let channels = [];
    // Build (or REBUILD) the per-topic channels. Tears down any existing ones first
    // so we can call it again on tab wake to replace a socket that died while the
    // tablet was backgrounded — the same "force reconnect" the guest app uses.
    const subscribe = () => {
      if (!sb) return;
      channels.forEach((c) => { try { sb.removeChannel(c); } catch (e) {} });
      // SCOPE THE SOCKET TO THIS RESTAURANT (mig 267 / sweep F7). Migration 145 added the
      // combined `topic_rid` column ("<topic>:<restaurant_id>") so a subscriber could filter
      // SERVER-side to its own restaurant. The guest app has always used it
      // (lib/useRealtime.ts); these panels never switched — they filtered on the bare topic
      // and then threw other restaurants' events away in JavaScript (noteEvent, below). The
      // display was right, but every manager/waiter/kitchen device was being handed a
      // websocket message for EVERY order, session, tag and log row of EVERY restaurant on
      // the platform — nine times the traffic it needs today, and it grows with the number of
      // restaurants rather than with this restaurant's own business. That is the connection
      // budget the owner asked us to protect.
      // RT_RID is resolved by getClient() BEFORE this runs, so it is available here. If it is
      // ever empty (rt-config failed) we fall back to the topic-only filter — worst case is
      // the old behaviour, never a missed update.
      channels = topicList.map((topic) =>
        sb.channel(RT_RID ? "rt:" + topic + ":" + RT_RID : "rt:" + topic)
          .on("postgres_changes", { event: "INSERT", schema: "public", table: "realtime_events", filter: RT_RID ? "topic_rid=eq." + topic + ":" + RT_RID : "topic=eq." + topic },
            (payload) => {
              metrics.events++; metrics.lastEventAt = Date.now();
              // Delivery latency = now − when the breadcrumb was written. Feeds the
              // connection badge's live "ms" number + sparkline (free — the event already arrived).
              const ts = payload && payload.new && payload.new.created_at;
              if (ts) { const lat = Date.now() - Date.parse(ts); recordLatency(lat); }
              noteEvent(topic, payload && payload.new);
            })
          .subscribe((status) => {
            if (status === "SUBSCRIBED") { metrics.subscribed++; setStatus("online"); if (everSubscribed) { metrics.reconnects++; fireAll(); } everSubscribed = true; }
            // Only genuine socket faults downgrade the badge — NOT "CLOSED", which
            // also fires on our own intentional teardown (idle/resubscribe) and would
            // flash yellow on every tab-wake. A hard device drop is caught by the
            // window "offline" listener above.
            else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") { metrics.errors++; setStatus(navigator.onLine === false ? "offline" : "weak"); }
          })
      );
    };
    // BOOT — or RE-BOOT — the client and its channels. Kept as a function (it used to be an
    // inline try/catch) so a wake AFTER a failed boot can try again instead of finding `sb` null
    // and giving up: see the note on getClient(). Answers true once there is a live client.
    const ensureClient = async () => {
      if (sb) return true;
      try {
        sb = await getClient();
        subscribe();
        return true;
      } catch (e) {
        metrics.errors++; // realtime failed to boot — the backup poll keeps the panel alive
        setStatus((typeof navigator !== "undefined" && navigator.onLine === false) ? "offline" : "weak");
        return false;
      }
    };
    await ensureClient();

    // Catch anything missed while the tab slept / lost focus / dropped network, AND
    // rebuild the (likely dead) socket on wake. visibilitychange + focus + pageshow
    // (and sometimes online) all fire on return, so THROTTLE the rebuild to once per
    // wake (1.5s); the rest just refetch. Refetches route through the debounced fires.
    // IDLE-DISCONNECT (owner 2026-06-26 — protect the realtime connection budget): a tab
    // left HIDDEN for IDLE_MS drops its channels so a backgrounded/forgotten panel tab stops
    // holding a websocket connection. It reconnects + refetches the instant it's shown again.
    // An always-VISIBLE panel (e.g. a kitchen display left on) never disconnects.
    const IDLE_MS = 120000;
    let idleTimer = null, torndown = false;
    const teardown = () => { if (!sb) return; channels.forEach((c) => { try { sb.removeChannel(c); } catch (e) {} }); channels = []; torndown = true; };
    let lastWake = 0;
    const wake = () => {
      if (document.hidden) return;
      clearTimeout(idleTimer);
      const now = Date.now();
      // NO CLIENT AT ALL — the boot failed. Try to build one now (the whole point of the
      // getClient memo fix), and refetch either way so the panel still catches up even if the
      // socket stays down. Throttled by the same 1.5s window as a socket rebuild.
      if (!sb) {
        if (now - lastWake < 1500) { fireAll(); return; }
        lastWake = now;
        ensureClient().then(() => fireAll(), () => fireAll());
        return;
      }
      if (torndown) { torndown = false; lastWake = now; subscribe(); fireAll(); return; } // reconnect after idle
      if (now - lastWake < 1500) { fireAll(); return; } // already rebuilt this wake — just refetch
      lastWake = now;
      subscribe();  // force a fresh socket
      fireAll();
    };
    const onVisibility = () => {
      if (document.hidden) { clearTimeout(idleTimer); idleTimer = setTimeout(teardown, IDLE_MS); } // arm the idle drop
      else wake();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", wake);
    window.addEventListener("pageshow", wake);   // fires on bfcache restore (phone wake)
    window.addEventListener("online", () => { metrics.reconnects++; wake(); });

    fireAll(); // initial load
  }

  // ── the catch-up poll: keeps a panel live when the live socket ISN'T ─────────
  // While realtime is connected this costs nothing. When it isn't (a blocked WebSocket on a
  // hotel/office network, or a database that dropped its realtime connection), a panel would
  // only refresh on its 60s backstop and a new KOT could sit unseen for a minute (bug M9) — so
  // it polls every few seconds instead.
  //
  // WHAT THIS ADDS IS THE BACKING OFF, and it matters more than the polling. A saturated
  // database is precisely the thing that drops realtime, so every device notices at the same
  // moment and every device switched to a FIXED 5-second board read, together, indefinitely.
  // That is an amplifier aimed at a database that is already struggling: it can't recover, so
  // the sockets never come back, so the polling never stops. That is the shape of the
  // 2026-07-31 outage, and it is entirely ours to prevent.
  //
  // So: quick (5s) while the socket is down AND the reads are getting through — the legitimate
  // blocked-socket case, which must stay live — then doubling up to a minute for as long as
  // they fail, and straight back to quick the moment one succeeds. Jittered, so twenty devices
  // never poll on the same beat. `fn` MUST reject (or throw) when its read fails, or there is
  // nothing to back off from.
  function catchUp(fn, opts) {
    const base = (opts && opts.baseMs) || 5000;
    const max = (opts && opts.maxMs) || 60000;
    let step = 0, timer = null, stopped = false;
    const spread = (ms) => Math.round(ms * (0.8 + Math.random() * 0.4));
    const arm = () => {
      if (stopped) return;
      timer = setTimeout(run, spread(Math.min(base * Math.pow(2, step), max)));
    };
    async function run() {
      // Live again, hidden, or genuinely offline → nothing to catch up on. Reset the backoff so
      // the next real gap starts responsive.
      if (stopped) return;
      if (document.hidden || connStatus === "online" || navigator.onLine === false) { step = 0; return arm(); }
      try { await fn(); step = 0; }
      catch (e) { step = Math.min(step + 1, 8); }
      arm();
    }
    arm();
    return () => { stopped = true; clearTimeout(timer); };
  }

  window.LFH_RT = {
    start, metrics, catchUp,
    // This panel's restaurant id, once learned from /api/rt-config (empty until then).
    // Shared so errlog.js can tag client-error / tap-batch diary lines with the tenant.
    getRid: () => RT_RID,
    // Current connection state: "online" | "weak" | "offline".
    getStatus: () => connStatus,
    // Has the live socket connected at least once this session? (badge: calm
    // "Connecting…" before the first connect vs amber "Reconnecting" after a drop.)
    everConnected: () => everConnected,
    // Subscribe to status changes. Fires once immediately with the current state,
    // then on every change. Returns an unsubscribe fn.
    onStatus: (cb) => { statusListeners.add(cb); try { cb(connStatus); } catch (e) {} return () => statusListeners.delete(cb); },
    // Live latency for the badge: { ms, at } of the last reading (ms null until first),
    // and the recent-readings ring for the sparkline. From events already received.
    getLatency: () => ({ ms: metrics.lastLatencyMs, at: metrics.lastLatencyAt }),
    getLatencyHistory: () => metrics.latHist.slice(),
    // Subscribe to new latency readings (re-render the badge). Returns an unsubscribe fn.
    onLatency: (cb) => { latListeners.add(cb); return () => latListeners.delete(cb); },
  };
})();
