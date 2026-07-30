/* sw.js — the OFFLINE SHELL for the whole app (guest menu + all staff panels).
 *
 * WHY THIS EXISTS
 *   Before this file, losing the connection didn't just stop new data — it BROKE the
 *   app: a reload (or a phone waking the tab) had no HTML to load, so staff got the
 *   browser's dinosaur page mid-service. The write side was already safe (actions are
 *   saved on-device and replayed — see public/panels/outbox.js + lib/idempotency.ts);
 *   what was missing was being able to OPEN and READ the app with no internet.
 *
 * WHAT IT DOES (three caches, all per-device, nothing leaves the device)
 *   1. lfh-shell — the HTML of pages you've already visited, so the app still opens.
 *   2. lfh-asset — the JS/CSS/images it needs to render (hashed Next chunks + /panels).
 *   3. lfh-data  — the last successful reply of each read (GET /api/...), so a panel
 *      shows the LAST KNOWN board instead of an empty screen. Served with
 *      `X-LFH-From-Cache: 1` + `X-LFH-Cached-At` so the UI can honestly say
 *      "showing saved data from 7:42 pm" rather than pretending it's live.
 *
 * SAFETY RULES BAKED IN (do not "optimise" these away)
 *   - ONLINE FRESHNESS IS NEVER TRADED AWAY. Every dynamic request is NETWORK-FIRST;
 *     the cache is only a fallback for a dead/stalled network. The one cache-FIRST
 *     path is /_next/static/, whose filenames contain a content hash, so it cannot go
 *     stale. This is what stops the classic "I deployed but the panel shows old code".
 *   - WRITES ARE NEVER TOUCHED. Anything that isn't a GET goes straight to the network
 *     (the outbox owns offline writes; a service worker replaying a POST would risk a
 *     double bill).
 *   - THE AUTH ROUTES are never cached (the sign-in PAGE is — it's public HTML with no data,
 *     and staff need it to open offline), and the caches are WIPED on sign-in and sign-out,
 *     so one device can never show another account's screens or numbers offline.
 *   - KILL SWITCH: deleting/404-ing this file unregisters it (browser behaviour), and
 *     posting {type:"LFH_SW_KILL"} from the page drops every cache + unregisters.
 */
const VERSION = "v4"; // v2: 2h expiry. v3: sign-in page cached. v4: no false "struggling" alarm.
const SHELL = `lfh-shell-${VERSION}`;
const ASSET = `lfh-asset-${VERSION}`;
const DATA = `lfh-data-${VERSION}`;
const OFFLINE_URL = "/offline.html";

// A stalled network is the WORST case for staff ("less internet" — it hangs forever and
// the panel looks frozen). Race every fallback-able request against a timer and fall
// back to the saved copy instead of spinning.
// Falling back FAST is right: on a hanging connection, staff should see the saved board in a
// few seconds, not stare at nothing for twelve. The owner's "Connection is struggling" false
// alarm was NOT caused by this — it was the BAR shouting about one slow read while live
// updates were flowing. That's fixed where it belongs (connIsBad() in panels/offline.js), so
// the fallback stays quick and only the WARNING is judged on the real connection state.
const NAV_TIMEOUT_MS = 6000;
const READ_TIMEOUT_MS = 6000;
// Assets get a MUCH longer leash than reads. It used to be none at all, which meant a
// crawling connection could hang a script request forever with no fallback; and before
// that it was 8s, which cut off a slow 3D model download. Big media is now excluded by
// path (isBigMedia), so a generous guard is safe and still rescues a hung script.
const ASSET_TIMEOUT_MS = 25000;

// Caps, so no cache can grow without limit (SHELL collects a key per visited URL, ASSET
// one per chunk of every deploy). Oldest entries go first.
const CAPS = { data: 150, shell: 60, asset: 400 };
const MAX_DATA_BYTES = 3_000_000; // don't cache a huge report payload

// A saved copy is only good for so long. After this, being offline shows the "no internet"
// page instead of stale screens and figures. This ALSO bounds how long a device that was
// left signed in keeps anything readable on it — which is why the owner chose a short
// window (2026-07-30): a tablet left lying around goes blank quickly, and the trade-off he
// accepted is that an outage longer than this comes back to an empty screen rather than
// the last known board.
const MAX_STALE_MS = 2 * 60 * 60 * 1000; // 2 hours

// Never cached, ever: the API routes that sign someone in or out, or hand out a code.
//
// The sign-in PAGES are deliberately NOT here, and that was a real mistake to fix. They
// were excluded at first "because login", but the page itself is public HTML with no data
// on it — the secret only ever travels in the POST to /api/panel-login, which is a write
// and is never cached anyway. Excluding the page meant the worker refused to handle it, so
// a device that woke up with no signal and got bounced to /login saw the BROWSER's error
// page — and worse, that failed navigation stopped the next one being handled too, taking
// our offline page down with it. This is the single most likely offline moment for staff:
// tab wakes, reloads, no signal. (Found on the live client site.)
const NEVER = [
  /^\/api\/(staff-)?login/, /^\/api\/auth/, /^\/api\/owner\/login/,
  /^\/api\/panel-login/, /^\/api\/verify/, /^\/api\/health/,
];
// Signing out is a plain link (a navigation), so the page's JS never gets to run
// afterwards — the ONLY reliable place to forget this device's saved screens and
// numbers is right here, as the request passes through.
const LOGOUT = /^\/api\/(panel|staff)-logout/; // the only two logout routes that exist
// Read families worth remembering for offline (panel + dashboard + guest-menu reads).
const DATA_PATHS = [
  /^\/api\/editor\//, /^\/api\/tablet\//, /^\/api\/kitchen\//, /^\/api\/admin\//,
  /^\/api\/owner\//, /^\/api\/guest\//, /^\/api\/inventory\//, /^\/api\/menu/,
  /^\/api\/r\//,            // guest menu data per restaurant
  /^\/api\/panel-profile/,  // who am I → the ⚙/👤 button still appears offline
  /^\/api\/maintenance/,    // maintenance flag → panels don't misjudge it offline
  /^\/api\/rt-config/,      // realtime config → reconnects the instant we're back
];

// BIG MEDIA IS NONE OF OUR BUSINESS. The 3D dish models are multi-megabyte files with
// their own in-memory loader (lib/modelLoader.ts) and a 1-year immutable cache header, and
// buffering them here would be pure waste. Worse, an earlier version raced them against a
// timeout, which ABORTED a slow model download and broke the 3D viewer — caught by
// scripts/verify-cache.mjs.
const isBigMedia = (p) => p.startsWith("/models/") || /\.(glb|gltf|mp4|webm|mov|zip)$/i.test(p);

// Query flags that mean "give me the live value or tell me you can't" — never a saved one.
const WANTS_LIVE = ["refresh", "force", "nocache"];

const isNever = (p) => NEVER.some((re) => re.test(p));
const isData = (p) => DATA_PATHS.some((re) => re.test(p));

// On localhost the dev server's chunk filenames are NOT content-hashed, so the
// cache-first shortcut would happily serve yesterday's code and look like "my change
// didn't work". Dev gets network-first for everything (offline still works, just no
// instant-asset shortcut). Also skip dev-only plumbing entirely.
const IS_DEV = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(self.location.hostname);
const isDevPlumbing = (p) => p.startsWith("/_next/webpack-hmr") || p.startsWith("/__nextjs") || p.includes("/_next/static/webpack/");

// ── install / activate ──────────────────────────────────────────────────────────
// The last-resort page lives in the SHELL cache — which is WIPED on sign-in and sign-out
// (so one person's saved screens can't be read by the next). That wipe used to take the
// offline page with it and it was only restored by the NEXT worker install, so a device
// that had simply been signed into showed the browser's own error page instead of ours.
// Every wipe now re-stores it immediately.
async function precacheOffline() {
  try {
    const c = await caches.open(SHELL);
    await c.addAll([OFFLINE_URL]);
  } catch { /* best-effort: offlinePage() still has an inline fallback */ }
}

self.addEventListener("install", (e) => {
  e.waitUntil(precacheOffline().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    const keep = new Set([SHELL, ASSET, DATA]);
    for (const k of await caches.keys()) if (k.startsWith("lfh-") && !keep.has(k)) await caches.delete(k);
    await self.clients.claim();
  })());
});

// ── messages from the page ──────────────────────────────────────────────────────
self.addEventListener("message", (e) => {
  const type = e.data && e.data.type;
  if (type === "LFH_CLEAR_DATA") {
    // Logout / switched restaurant → forget every saved read so the next person on this
    // device can't see the previous account's numbers while offline.
    e.waitUntil(caches.delete(DATA).then(() => caches.delete(SHELL)).then(precacheOffline));
  } else if (type === "LFH_SW_KILL") {
    e.waitUntil((async () => {
      for (const k of await caches.keys()) if (k.startsWith("lfh-")) await caches.delete(k);
      await self.registration.unregister();
    })());
  } else if (type === "LFH_SKIP_WAITING") {
    self.skipWaiting(); // a fresh deploy takes over now, not next time the tab closes
  } else if (type === "LFH_PING") {
    if (e.source) e.source.postMessage({ type: "LFH_PONG", version: VERSION });
  }
});

// ── helpers ─────────────────────────────────────────────────────────────────────
// Rebuild a response with our provenance headers attached (fetch headers are immutable,
// so this is how a cached body gets labelled "this is saved data, from this time").
async function tagged(res, cachedAt) {
  const body = await res.blob();
  const h = new Headers(res.headers);
  h.set("X-LFH-From-Cache", "1");
  h.set("X-LFH-Cached-At", String(cachedAt || Date.now()));
  return new Response(body, { status: res.status, statusText: res.statusText, headers: h });
}

// Stamp the save time INTO the stored copy, so a later offline read can say how old it is.
async function putStamped(cacheName, key, res) {
  try {
    // Check the declared size BEFORE buffering, so a big file is skipped without ever
    // being copied into memory.
    const declared = Number(res.headers.get("content-length") || 0);
    if (declared > MAX_DATA_BYTES) return;
    const buf = await res.clone().arrayBuffer();
    if (buf.byteLength > MAX_DATA_BYTES) return;
    const h = new Headers(res.headers);
    h.set("X-LFH-Cached-At", String(Date.now()));
    const cache = await caches.open(cacheName);
    await cache.put(key, new Response(buf, { status: res.status, statusText: res.statusText, headers: h }));
    trim(cache, cacheName === DATA ? CAPS.data : cacheName === SHELL ? CAPS.shell : CAPS.asset);
  } catch { /* quota/opaque → skip silently, caching is a bonus not a dependency */ }
}

// Keep the read cache from growing forever: drop the oldest entries past the cap.
async function trim(cache, cap) {
  try {
    const keys = await cache.keys();
    if (keys.length <= cap) return;
    const aged = [];
    for (const k of keys) {
      const r = await cache.match(k);
      aged.push({ k, at: Number((r && r.headers.get("X-LFH-Cached-At")) || 0) });
    }
    aged.sort((a, b) => a.at - b.at);
    for (const { k } of aged.slice(0, keys.length - cap)) await cache.delete(k);
  } catch { /* best effort */ }
}

// Tell every open page that what it just received was SAVED data, not live data. The
// panels read the same fact off the response headers, but a React page's fetches are
// spread over many files — one broadcast from here means the banner is correct
// everywhere without touching a single call site.
async function announceStale(at, clientId) {
  try {
    const msg = { type: "LFH_SERVED_FROM_CACHE", at: at || Date.now() };
    // ONLY the page that made this request. Telling every open tab meant a slow staff read
    // painted a "showing saved figures" strip across unrelated tabs — including a
    // customer's menu on the same device.
    if (clientId) {
      const c = await self.clients.get(clientId);
      if (c) c.postMessage(msg);
      return;
    }
    const all = await self.clients.matchAll({ type: "window" });
    all.forEach((c) => c.postMessage(msg));
  } catch { /* best effort */ }
}

async function cachedCopy(cacheName, key, opts, clientId) {
  const cache = await caches.open(cacheName);
  // `ignoreVary` is ESSENTIAL, not a nicety: Next sends `Vary` on its replies, and a
  // lookup by bare URL builds a request whose headers don't match the saved one — so
  // every saved read silently missed and offline screens came up empty. (Found while
  // testing the guest menu offline: the page opened but listed no dishes.)
  const hit = await cache.match(key, { ignoreVary: true, ...(opts || {}) });
  if (!hit) return null;
  const at = Number(hit.headers.get("X-LFH-Cached-At") || 0);
  // Too old to be worth showing — better an honest "no internet" than figures from
  // another day presented as the current state of the restaurant.
  if (at && Date.now() - at > MAX_STALE_MS) { await cache.delete(key); return null; }
  if (cacheName === DATA) announceStale(at, clientId);
  return tagged(hit, at);
}

// The branded last-resort page. `ignoreVary` matters here for the same reason it does for
// every other lookup: the stored reply carries a Vary header, and a bare match() builds a
// request whose headers don't match it — so the page was never found and staff got the
// browser's own error page instead. (Caught on the live client site: with the network cut,
// a screen that had never been opened on that device showed nothing at all.)
async function offlinePage() {
  try {
    const c = await caches.open(SHELL);
    const hit = (await c.match(OFFLINE_URL, { ignoreVary: true })) || (await caches.match(OFFLINE_URL, { ignoreVary: true }));
    if (hit) { precacheOffline(); return hit; } // re-store in the background if it was the global match
  } catch { /* fall through */ }
  try { const net = await fetch(OFFLINE_URL); if (net && net.ok) { precacheOffline(); return net; } } catch { /* really offline */ }
  // Nothing saved and no network: say the important part inline rather than letting the
  // browser's error page tell staff nothing.
  return new Response(
    '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<body style="margin:0;min-height:100dvh;display:grid;place-items:center;background:#0b1020;color:#e7eefc;' +
    'font:600 15px/1.5 system-ui,sans-serif;text-align:center;padding:24px">' +
    '<div><h1 style="font-size:20px;margin:0 0 10px">No internet right now</h1>' +
    '<p style="color:#b8c5de;margin:0 0 14px">This screen hasn\'t been opened on this device yet.</p>' +
    '<p style="color:#86efac;margin:0">Nothing you did is lost — anything saved on this device will send itself when the connection is back.</p>' +
    '<p style="margin:16px 0 0"><a href="" onclick="location.reload();return false" style="color:#38bdf8">Try again</a></p></div></body>',
    { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

// React client-side navigation fetches the SAME url with an RSC header; it must not
// share a cache key with the HTML document, so give it its own suffix.
const rscKey = (url) => url + (url.includes("?") ? "&" : "?") + "__lfh_rsc=1";

// ── the router ──────────────────────────────────────────────────────────────────
self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Writes, cross-origin (Supabase/CDN), range requests (3D models, media) and
  // only-if-cached probes are none of our business.
  if (req.method !== "GET") return;
  if (req.cache === "only-if-cached" && req.mode !== "same-origin") return;
  if (req.headers.has("range")) return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (LOGOUT.test(url.pathname)) {
    // Let the logout itself go to the network untouched, but wipe the device's saved
    // pages + saved reads as it goes, so the next person to open this device offline
    // can't page through the previous account's screens.
    event.waitUntil(caches.delete(DATA).then(() => caches.delete(SHELL)).then(precacheOffline).catch(() => {}));
    return;
  }
  if (isNever(url.pathname)) return;
  if (isDevPlumbing(url.pathname)) return;
  if (isBigMedia(url.pathname)) return;

  const isNav = req.mode === "navigate";
  const isRsc = req.headers.get("RSC") === "1" || url.searchParams.has("_rsc");

  if (isNav) return event.respondWith(handleNav(req, url));
  if (isRsc) return event.respondWith(networkFirst(req, SHELL, rscKey(req.url), READ_TIMEOUT_MS));
  if (url.pathname.startsWith("/_next/static/")) {
    return event.respondWith(IS_DEV ? networkFirst(req, ASSET, req.url, ASSET_TIMEOUT_MS) : cacheFirst(req, ASSET));
  }
  if (url.pathname.startsWith("/api/")) {
    if (!isData(url.pathname)) return;
    // A FORCED REFRESH means "I want the real number, I'll wait" (that's the contract of
    // the owner panel's Refresh button — see the snapshot-cache rule in CLAUDE.md). It must
    // never be answered from the device, not even if the network is crawling.
    if (WANTS_LIVE.some((p) => url.searchParams.has(p))) {
      return event.respondWith(networkFirst(req, DATA, req.url, 0, { noFallback: true, clientId: event.clientId }));
    }
    // Dashboards and reports are ALLOWED to be slow — they scan and aggregate. Racing them
    // against a few seconds would hand an owner saved figures on a perfectly good
    // connection. They still fall back if the network is genuinely dead, just never on
    // grounds of slowness. Operational panel reads are small, so a stall there is a real
    // problem and does get the guard.
    const slowByNature = /^\/api\/(owner|admin|inventory)\//.test(url.pathname);
    return event.respondWith(networkFirst(req, DATA, req.url, slowByNature ? 0 : READ_TIMEOUT_MS, { clientId: event.clientId }));
  }
  // Everything else same-origin static: /panels/*, /brand/*, fonts, images, /vendor/*.
  return event.respondWith(networkFirst(req, ASSET, req.url, ASSET_TIMEOUT_MS));
});

// Pages: always try the network, fall back to this page's saved HTML, then to a
// same-path match ignoring the query, then to the branded offline page.
async function handleNav(req, url) {
  // Same rule as reads: the request is never thrown away. If it's merely slow we show the
  // saved page, but the real one still lands and is saved for next time.
  const live = fetch(req).then((res) => {
    // Don't memorise redirects or error pages — only a real rendered page.
    if (res && res.ok && res.status === 200 && res.type !== "opaqueredirect") putStamped(SHELL, req.url, res);
    return res;
  });
  try {
    let timer;
    const stalled = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("stall")), NAV_TIMEOUT_MS); });
    try { return await Promise.race([live, stalled]); } finally { clearTimeout(timer); }
  } catch {
    live.catch(() => {});
    return (await cachedCopy(SHELL, req.url))
      || (await cachedCopy(SHELL, req.url, { ignoreSearch: true }))
      || (await offlinePage()); // always answers: cache → network → an inline branded page
  }
}

// Fresh when there's a network, saved copy when there isn't. Never the other way round.
//
// `timeout` (0 = none) is the STALL guard for a connection that hangs rather than dies.
// Two rules make it safe to use on a working connection:
//   - The abandoned request is NOT cancelled or thrown away. It keeps going and its reply
//     is still saved, so the device's copy ages FORWARD and the bandwidth isn't wasted.
//     (Racing-and-discarding meant a permanently slow link stayed pinned to one ancient
//     snapshot while paying full egress for every read — the worst of both worlds.)
//   - Callers that must have the live value (a forced Refresh, the analytics reads that
//     are legitimately slow) pass timeout 0 and simply wait.
async function networkFirst(req, cacheName, key, timeout, opts) {
  const noFallback = opts && opts.noFallback; // must be live or fail honestly
  // Start the real request ONCE and let it finish on its own terms.
  const live = fetch(req).then((res) => {
    if (res && res.ok) putStamped(cacheName, key, res);
    return res;
  });
  try {
    let res;
    if (!timeout) {
      res = await live;
    } else {
      let timer;
      const stalled = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("stall")), timeout); });
      try { res = await Promise.race([live, stalled]); } finally { clearTimeout(timer); }
    }
    // A real server error (500/404) is the truth — pass it through rather than papering
    // over it with stale data; only a dead or hung network falls back.
    return res;
  } catch (e) {
    const stalled = e && e.message === "stall";
    live.catch(() => {}); // keep it alive to update the saved copy; just don't wait for it
    const hit = noFallback ? null : await cachedCopy(cacheName, key, null, opts && opts.clientId);
    if (hit) return hit;
    // A STALL with nothing saved to show instead is not a reason to fail: that's simply a
    // slow FIRST load (a cold server, a heavy query), and before this layer existed the
    // page would just have waited. Keep waiting. Only a genuinely dead network falls
    // through to the answers below. (Caught by a flaky run of the verify script: the first
    // load after a fresh build got a 503 "offline" while perfectly online.)
    if (stalled) {
      try { return await live; } catch { /* really gone → answer below */ }
    }
    // Nothing saved: answer reads with a shape the panels already understand
    // (an error object) instead of a network exception that blanks the screen.
    if (cacheName === DATA) {
      return new Response(JSON.stringify({ error: "offline", offline: true }), {
        status: 503, headers: { "Content-Type": "application/json", "X-LFH-Offline": "1" },
      });
    }
    throw new Error("offline");
  }
}

// Content-hashed assets can't go stale → serve instantly from cache, fill on first use.
async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req.url, { ignoreVary: true });
  if (hit) return hit;
  const res = await fetch(req);
  if (res && res.ok) putStamped(cacheName, req.url, res);
  return res;
}
