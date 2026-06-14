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
      const mod = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm");
      return mod.createClient(cfg.url, cfg.anonKey, { realtime: { params: { eventsPerSecond: 10 } } });
    })();
    return sbPromise;
  }

  function debounce(fn, ms) { let t; return () => { clearTimeout(t); t = setTimeout(fn, ms); }; }

  async function start(opts) {
    const onEvent = (opts && opts.onEvent) || function () {};
    const topics = (opts && opts.topics) || ["ops"];
    metrics.topics = topics;

    // The one true refetch path: count it, run it, count failures (never throws).
    async function doRefetch() {
      metrics.refetch_count++;
      try { await onEvent(); } catch (e) { metrics.sync_failures++; }
    }
    // Debounce bursts → one refetch. Used by breadcrumbs AND wake/reconnect.
    const fire = debounce(doRefetch, 300);

    let everSubscribed = false;
    try {
      const sb = await getClient();
      topics.forEach((topic) => {
        sb.channel("rt:" + topic)
          .on("postgres_changes", { event: "INSERT", schema: "public", table: "realtime_events", filter: "topic=eq." + topic },
            (payload) => {
              metrics.events++; metrics.lastEventAt = Date.now();
              // Delivery latency = now − when the breadcrumb was written.
              const ts = payload && payload.new && payload.new.created_at;
              if (ts) { const lat = Date.now() - Date.parse(ts); if (lat >= 0 && lat < 60000) { metrics._latSum += lat; metrics._latN++; metrics.avgLatencyMs = Math.round(metrics._latSum / metrics._latN); } }
              fire();
            })
          .subscribe((status) => {
            if (status === "SUBSCRIBED") { metrics.subscribed++; if (everSubscribed) { metrics.reconnects++; fire(); } everSubscribed = true; }
            else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") { metrics.errors++; }
          });
      });
    } catch (e) {
      metrics.errors++; // realtime failed to boot — the backup poll keeps the panel alive
    }

    // Catch anything missed while the tab slept / lost focus / dropped network.
    // All routed through the debounced fire() so they can't stack up.
    const wake = () => { if (!document.hidden) fire(); };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("focus", wake);
    window.addEventListener("pageshow", wake);   // fires on bfcache restore (phone wake)
    window.addEventListener("online", () => { metrics.reconnects++; fire(); });

    doRefetch(); // initial load (immediate, not debounced)
  }

  window.LFH_RT = { start, metrics };
})();
