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
  // Live metrics — inspect any time in the panel console:  __lfh_rt
  const metrics = {
    subscribed: 0, reconnects: 0, events: 0, errors: 0,
    refetch_count: 0, sync_failures: 0,
    avgLatencyMs: 0, lastEventAt: 0, startedAt: Date.now(), topics: [],
    _latSum: 0, _latN: 0,
  };
  window.__lfh_rt = metrics;

  async function getClient() {
    if (sbPromise) return sbPromise;
    sbPromise = (async () => {
      const cfg = await (await fetch("/api/rt-config", { cache: "no-store" })).json();
      // SELF-HOSTED: import the Supabase client from OUR origin (built by
      // scripts/build-vendor.mjs), not the jsdelivr CDN. A restaurant's wifi can be
      // slow or block public CDNs, which made the panel hang or silently fall back
      // to slow polling — a same-origin file removes that whole failure mode.
      // worker:true keeps the websocket heartbeat alive in a Web Worker so a
      // backgrounded tablet tab doesn't silently drop the live connection.
      const mod = await import("/vendor/supabase.js");
      return mod.createClient(cfg.url, cfg.anonKey, { realtime: { worker: true, params: { eventsPerSecond: 10 } } });
    })();
    return sbPromise;
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
      const tn = row && row.table_number;
      const spans = !tn || (row && row.kind === "platform"); // unscopable → full reload
      if (spans) a.full = true; else a.tables.add(String(tn));
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
      channels = topicList.map((topic) =>
        sb.channel("rt:" + topic)
          .on("postgres_changes", { event: "INSERT", schema: "public", table: "realtime_events", filter: "topic=eq." + topic },
            (payload) => {
              metrics.events++; metrics.lastEventAt = Date.now();
              // Delivery latency = now − when the breadcrumb was written.
              const ts = payload && payload.new && payload.new.created_at;
              if (ts) { const lat = Date.now() - Date.parse(ts); if (lat >= 0 && lat < 60000) { metrics._latSum += lat; metrics._latN++; metrics.avgLatencyMs = Math.round(metrics._latSum / metrics._latN); } }
              noteEvent(topic, payload && payload.new);
            })
          .subscribe((status) => {
            if (status === "SUBSCRIBED") { metrics.subscribed++; if (everSubscribed) { metrics.reconnects++; fireAll(); } everSubscribed = true; }
            else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") { metrics.errors++; }
          })
      );
    };
    try {
      sb = await getClient();
      subscribe();
    } catch (e) {
      metrics.errors++; // realtime failed to boot — the backup poll keeps the panel alive
    }

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

  window.LFH_RT = { start, metrics };
})();
