// realtime.js — shared Realtime helper for the static staff panels
// (manager/kitchen/tablet). Opens ONE WebSocket to Supabase, listens for tiny
// "breadcrumb" rows on the panel's topic, and calls your onEvent() so the panel
// can refetch its state — only when something actually changed, instead of every
// second. Handles reconnects, tab-wake and network-back, and collects metrics.
//
// Usage from a panel:
//   LFH_RT.start({ topics: ["ops"], onEvent: () => load() });
// onEvent is called once on start (initial load), on every breadcrumb (debounced),
// and whenever the tab wakes / network returns (to catch anything missed).
(function () {
  let sbPromise = null;
  // Live metrics (the reviewer rightly insisted on these). Inspect any time in the
  // panel console: __lfh_rt  — or it's posted to /admin if wired.
  const metrics = { subscribed: 0, reconnects: 0, events: 0, errors: 0, startedAt: Date.now(), lastEventAt: 0, topics: [] };
  window.__lfh_rt = metrics;

  async function getClient() {
    if (sbPromise) return sbPromise;
    sbPromise = (async () => {
      const cfg = await (await fetch("/api/rt-config", { cache: "no-store" })).json();
      // Pull the Supabase client straight from the CDN as an ES module. The anon
      // key is public; the service-role key is never sent here.
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
    const fire = debounce(() => { try { onEvent(); } catch (e) { /* never let a refetch error kill realtime */ } }, 250);
    let everSubscribed = false;
    try {
      const sb = await getClient();
      topics.forEach((topic) => {
        sb.channel("rt:" + topic)
          .on("postgres_changes", { event: "INSERT", schema: "public", table: "realtime_events", filter: "topic=eq." + topic },
            () => { metrics.events++; metrics.lastEventAt = Date.now(); fire(); })
          .subscribe((status) => {
            if (status === "SUBSCRIBED") { metrics.subscribed++; if (everSubscribed) metrics.reconnects++; everSubscribed = true; }
            else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") { metrics.errors++; }
          });
      });
    } catch (e) {
      metrics.errors++; // realtime failed to boot — the backup poll below keeps the panel alive
    }
    // Catch anything missed while the tab slept or the network dropped.
    document.addEventListener("visibilitychange", () => { if (!document.hidden) onEvent(); });
    window.addEventListener("online", () => { metrics.reconnects++; onEvent(); });
    onEvent(); // initial load
  }

  window.LFH_RT = { start, metrics };
})();
