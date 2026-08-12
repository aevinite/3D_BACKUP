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
// BUMP THIS whenever /offline.html changes. The page is precached at install, so devices
// keep serving the OLD copy from the old cache until new cache names force a re-precache.
// THE SHELL-KEY CHANGE (2026-08-12) NEEDS NO BUMP OF ITS OWN. The table number is no longer part of a
// page's cache key (see shellKey), so entries saved under the old table-specific keys are simply never
// looked up again — they are capped (CAPS.shell), trimmed oldest-first, and the first online visit
// re-saves the page under the new key. It rides along with whatever the current VERSION is: v9 below
// wipes the caches anyway for its own reasons, which for this change is strictly the nicer outcome
// (every device re-saves under the new key immediately instead of missing once).
const VERSION = "v9"; // v4: no false alarm. v5: a saved copy can't mask a change you just made. v6: the offline page names the real reason. v7: the last-resort page survives a sign-out. v8: the page you're ON is saved on the FIRST visit, and the offline page's re-checks are jittered. v9: a STAFF PANEL's first visit saves its reads too (it saved none), and the last-resort page no longer promises work it can't know was saved.
const SHELL = `lfh-shell-${VERSION}`;
const ASSET = `lfh-asset-${VERSION}`;
const DATA = `lfh-data-${VERSION}`;
// The last-resort page gets its OWN cache, and the sign-out wipe never touches it.
//
// It used to live in SHELL, which IS wiped on sign-in/sign-out: the wipe deleted it and re-stored it
// afterwards, leaving a window with no branded page at all. Go offline inside that window — and the
// wipe fires on the way to /login, which is exactly when somebody is signing in or out — and the
// BROWSER'S own error page appeared instead of ours, with no way back into the app. Measured against
// the deployed site 2026-08-01 ("the last-resort page has no way out", plus a console error); the
// comment below already recorded this bug once and the re-store was thought to have closed it.
//
// Separating it is safe because this page holds NO account data — it is a static branded screen.
// Wiping it never protected anyone; it only ever created the gap.
const FALLBACK = `lfh-fallback-${VERSION}`;
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
// How many missing files one first-visit warm may store (see LFH_WARM_SHELL). A page loads
// roughly 30-40 chunks; this leaves headroom without ever letting a single message walk a long
// list, and it stays well inside CAPS.asset.
const WARM_ASSET_MAX = 80;
const MAX_DATA_BYTES = 3_000_000; // don't cache a huge report payload

// A saved copy is only good for so long. After this, being offline shows the "no internet"
// page instead of stale screens and figures. This ALSO bounds how long a device that was
// left signed in keeps anything readable on it — which is why the owner chose a short
// window (2026-07-30): a tablet left lying around goes blank quickly, and the trade-off he
// accepted is that an outage longer than this comes back to an empty screen rather than
// the last known board.
//
// REJECTED (owner, 2026-08-12): do NOT give the GUEST menu a longer window than this. Offered as T1
// improvement 7 ("the 2-hour limit was tuned for staff tablets, not diners — a diner who comes back
// three hours later gets the no-internet page"). His answer: *"there is no off-line limit for diner.
// Diner should be online."* A diner is expected to be on the restaurant's wifi or their own data;
// this window exists for STAFF continuity, and one number covers everyone. Do not add a per-family
// window, and do not re-report it. See docs/REJECTED-IDEAS.md R13.
const MAX_STALE_MS = 2 * 60 * 60 * 1000; // 2 hours

// A CHANGE MUST NEVER BE MASKED BY A SAVED COPY.
// The stall fallback (show saved data when a read hangs) is right for a bad connection, but it
// has one dangerous moment: just after someone CHANGES something. If a module is switched on and
// the panel's next read stalls, the saved copy still says "off" — so the change appears not to
// have worked. (The whole-app suite caught exactly this shape: "tab is GONE" always passed while
// "tab comes back" intermittently failed.)
// So for a short window after any write from this device, an ONLINE read must wait for the truth.
// Offline is unaffected: with no network the saved copy is still the best thing we have.
const AFTER_WRITE_FRESH_MS = 60_000;
// PER FAMILY, and telemetry doesn't count. A first attempt recorded ANY write, and the panels
// post error/breadcrumb logs constantly — which held the window permanently open and quietly
// disabled the slow-connection fallback altogether. A write to /api/editor/* can only affect
// /api/editor/* reads, and a log post affects nothing anyone reads.
const lastWriteAt = Object.create(null);
const NOT_A_CHANGE = /^\/api\/(log|errlog|log\/client-error|rt-config|health)/;
const apiFamily = (p) => { const m = p.match(/^\/api\/([^/?]+)/); return m ? m[1] : ""; };

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
  /^\/api\/owner\//, /^\/api\/inventory\//,
  // `/^\/api\/guest\//` used to sit above and, like the one below, matched NOTHING. Every route
  // under app/api/guest/ — place-order, call-waiter, limit-hit — is POST only, and a non-GET
  // returns from the fetch handler before this list is ever consulted. It read as "the diner's
  // reads are saved for offline", and none of them are: what a diner actually needs offline is
  // the menu (/api/r/, below) and their own queued order (lib/guestOutbox.ts, on the device).
  // Removed for exactly the reason given for the next one. (Guest sweep T1, 2026-08-12.)
  // `/^\/api\/menu/` used to sit here and matched NOTHING — there is no /api/menu route; the
  // guest menu has always been served by /api/r/<restaurant>/menu-data, the entry below. A dead
  // pattern is worse than a missing one: it reads as "guest menu reads are covered here", which
  // is exactly the sort of line a later session trusts instead of checking.
  /^\/api\/r\//,            // guest menu data per restaurant
  /^\/api\/blocked/,         // the blocked-staff screen — it came up empty with no internet
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

// Statuses that mean "the server is there but can't answer this right now" — a database that
// didn't reply in time (our routes send 503 + X-LFH-Busy, lib/panelFailure.ts), a gateway that
// gave up (502/504), or the platform shedding load. Deliberately NOT 500: a 500 is a bug and must
// reach the screen. See the note where this is used, in networkFirst().
const CANT_ANSWER_NOW = new Set([502, 503, 504]);

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
    const c = await caches.open(FALLBACK);
    await c.addAll([OFFLINE_URL]);
  } catch { /* best-effort: offlinePage() still has an inline fallback */ }
}

self.addEventListener("install", (e) => {
  e.waitUntil(precacheOffline().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    const keep = new Set([SHELL, ASSET, DATA, FALLBACK]);
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
    // FALLBACK is deliberately NOT deleted — it holds only the static last-resort page, and
    // deleting it is what left a device with the browser's error page mid-sign-out. precacheOffline
    // still runs, so a device that somehow lost it gets it back.
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
  } else if (type === "LFH_WARM_SHELL") {
    // SAVE THE PAGE THAT IS ALREADY OPEN.
    //
    // handleNav() is the only thing that writes to SHELL, and it only runs for a navigation this
    // worker HANDLED. The very first navigation to a page is served by the network before the
    // worker controls the client, so that page's HTML was never stored — and the layer's whole
    // promise is "the HTML of pages you've already visited, so the app still opens".
    //
    // Measured on the deployed site: after one visit to a guest menu, SHELL held the item pages'
    // RSC keys but NOT the menu document. Go offline and reload and you got the branded "this
    // screen hasn't been opened on this device yet" page — for a screen that was on the diner's
    // phone a second earlier. That is the commonest offline moment there is: scan the QR, walk to
    // a table with thick walls, pull to refresh. Same for a waiter opening a panel for the first
    // time on a new device.
    //
    // So once the page is up and controlled, it asks us to fetch and store its own URL. Cheap
    // (one request, only when the shell is genuinely missing), never on the critical path, and it
    // stores the same key handleNav would have.
    const url = e.data && e.data.url;
    if (url) e.waitUntil((async () => {
      try {
        const key = shellKey(new URL(url, self.location.origin).href);
        if (new URL(key).origin !== self.location.origin) return;
        const cache = await caches.open(SHELL);
        if (await cache.match(key, { ignoreVary: true })) return; // already saved — do nothing
        const res = await fetch(key, { credentials: "same-origin" });
        // Same rule as handleNav: only a real rendered page, never a redirect or an error.
        if (res && res.ok && res.status === 200 && res.type !== "opaqueredirect") await putStamped(SHELL, key, res);
      } catch { /* best-effort: being unable to pre-save must never affect the page */ }
    })());
    // …AND THE CODE THAT MAKES THAT PAGE A PAGE.
    //
    // Saving the HTML was only half the fix, and the missing half made the common case LOOK
    // worse rather than better. Measured on the deployed site, fresh device, one visit to a guest
    // menu: SHELL held the document, and `lfh-asset` DID NOT EXIST AT ALL — the chunks were
    // fetched before this worker took control of the client, so it never saw them. Cut the
    // network and reload and the saved HTML is served, then every /_next/static/ request goes to
    // cacheFirst(), misses, hits the network and throws. The diner gets the document with NO CSS
    // and NO JavaScript: black Times-serif text on white, "CATEGORIESSlide" run together, no
    // dishes — measurably worse-looking than the branded "Can't open this screen" page they would
    // have got if nothing had been saved at all. That is exactly the moment this layer exists for:
    // scan the QR, walk to a table with thick walls, pull to refresh.
    //
    // So the page also tells us the same-origin files it just loaded, and we store the ones we
    // are missing. Deliberately ADDITIVE — it changes no caching RULE, so no VERSION bump (a bump
    // would wipe every device's caches, which is the opposite of what this is for). It only ever
    // fills a cache that is otherwise empty: anything already stored is skipped, so this costs
    // one round of small immutable files on a device's FIRST visit and nothing on any visit after.
    const assets = e.data && e.data.assets;
    if (Array.isArray(assets) && assets.length) e.waitUntil((async () => {
      try {
        const cache = await caches.open(ASSET);
        let stored = 0;
        for (const raw of assets.slice(0, WARM_ASSET_MAX)) {
          if (stored >= WARM_ASSET_MAX) break;
          let u;
          try { u = new URL(raw, self.location.origin); } catch { continue; }
          // The same exclusions the fetch router applies, so warming can never pull in a write,
          // an auth route, a multi-megabyte model, or another origin's file.
          if (u.origin !== self.location.origin) continue;
          if (u.pathname.startsWith("/api/")) continue;   // reads are cached when they happen; never re-fetch one here (egress)
          if (isNever(u.pathname) || isBigMedia(u.pathname) || isDevPlumbing(u.pathname)) continue;
          if (await cache.match(u.href, { ignoreVary: true })) continue;
          try {
            const res = await fetch(u.href, { credentials: "same-origin" });
            if (res && res.ok) { await putStamped(ASSET, u.href, res); stored++; }
          } catch { /* one asset failing must not stop the rest */ }
        }
      } catch { /* best-effort, exactly like the shell warm above */ }
    })());
  } else if (type === "LFH_WARM_DATA") {
    // A READ THE PAGE ALREADY HAS — stored WITHOUT fetching anything (see lib/warmData.ts).
    //
    // The offline layer promises that a screen you have opened will open again with no internet,
    // showing its last known state. For the guest menu that was only true from the SECOND visit
    // (measured on the deployed site, 2026-08-07): a first visit left no saved read, so an offline
    // reload rendered a correctly styled, branded page with NO DISHES on it.
    //
    // It is the same race the page's CODE used to lose — we only handle a request once we CONTROL
    // the client, and the menu's data fetch fires before that on a first visit. The code half was
    // fixed by FETCHING the missing files (above). Doing that for a read would mean pulling the
    // menu a second time on every diner's first visit, and egress is the one budget this project
    // will not spend loosely. So nothing is re-fetched: the page hands over the payload it already
    // holds and we store it under the key the next read will look for.
    //
    // Everything is validated rather than trusted, and we NEVER overwrite something already
    // stored — a copy this worker fetched itself always wins over one the page offered.
    const wUrl = e.data && e.data.url, wBody = e.data && e.data.body;
    if (wUrl && typeof wBody === "string") e.waitUntil((async () => {
      try {
        const u = new URL(wUrl, self.location.origin);
        if (u.origin !== self.location.origin) return;                        // never another origin
        if (!u.pathname.startsWith("/api/") || !isData(u.pathname)) return;   // only a read we cache anyway
        if (isNever(u.pathname)) return;                                      // never sign-in / health
        if (wBody.length > MAX_DATA_BYTES) return;                            // same ceiling as any saved read
        const cache = await caches.open(DATA);
        if (await cache.match(u.href, { ignoreVary: true })) return;          // already saved — leave it
        await putStamped(DATA, u.href, new Response(wBody, {
          status: 200, headers: { "Content-Type": "application/json" },
        }));
      } catch { /* best-effort: being unable to pre-save must never affect the page */ }
    })());
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
    const c = await caches.open(FALLBACK);
    const hit = (await c.match(OFFLINE_URL, { ignoreVary: true })) || (await caches.match(OFFLINE_URL, { ignoreVary: true }));
    if (hit) { precacheOffline(); return hit; } // re-store in the background if it was the global match
  } catch { /* fall through */ }
  try { const net = await fetch(OFFLINE_URL); if (net && net.ok) { precacheOffline(); return net; } } catch { /* really offline */ }
  // Nothing saved and no network: say the important part inline rather than letting the
  // browser's error page tell staff nothing. It does NOT name a cause — this bare fallback
  // can't run the checks /offline.html runs, and the wrong cause is worse than none (the
  // page used to blame the internet on a day the internet was fine). It always offers the
  // way home, so this is never a dead end.
  return new Response(
    '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<body style="margin:0;min-height:100dvh;display:grid;place-items:center;background:#0b1020;color:#e7eefc;' +
    'font:600 15px/1.5 system-ui,sans-serif;text-align:center;padding:24px">' +
    '<div><h1 style="font-size:20px;margin:0 0 10px">Can\'t open this screen</h1>' +
    '<p style="color:#b8c5de;margin:0 0 14px">This screen hasn\'t been opened on this device yet, and it couldn\'t be loaded — either this device is offline or the app isn\'t answering.</p>' +
    // Same honesty rule as /offline.html: promise only what is actually guaranteed. "Nothing you
    // did is lost" is untrue on a device whose storage was refused, and for the guest actions that
    // have no queue — and this bare copy is the one a device falls back to when even the branded
    // page is missing, i.e. the worst moment to overstate anything.
    '<p style="color:#86efac;margin:0">Anything already saved on this device is safe — it sends itself when the connection is back.</p>' +
    // The ids MATTER: offline.html carries #retry / #home, and verify:offline looks for #home to
    // prove the page isn't a dead end. This bare fallback offered the same two ways out but with
    // no ids, so the check read it as "the last-resort page has no way out" (2026-07-31). Same
    // contract on both pages, or the guard can only ever see one of them.
    '<p style="margin:16px 0 0"><a id="retry" href="" onclick="location.reload();return false" style="color:#38bdf8">Try again</a>' +
    ' &nbsp;·&nbsp; <a id="home" href="/" style="color:#38bdf8">Go to the home screen</a></p></div></body>',
    { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

// React client-side navigation fetches the SAME url with an RSC header; it must not
// share a cache key with the HTML document, so give it its own suffix.
const rscKey = (url) => url + (url.includes("?") ? "&" : "?") + "__lfh_rsc=1";

// WHATEVER TABLE THEY SCAN IS THE TABLE THEY ORDER FOR — offline too (owner, 2026-08-12:
// *"whatever the table he scans, you can order for that"*; T1 improvement 8).
//
// A guest menu page is byte-identical whichever table opened it: the table number is not rendered
// into the HTML, it is read from the address by the page's own JavaScript (MenuView's table capture)
// and stored per restaurant. So `?table=4` and `?table=7` were filling the shell cache with
// duplicate copies of one page — and the offline fallback then had to guess between them. It guessed
// with `{ ignoreSearch: true }`, which is how a phone that had saved table 7 could be handed table
// 7's document after scanning table 4.
//
// Stripping the table out of the KEY fixes both halves at once: one saved copy per page (so scanning
// ANY table finds it, first time, instead of only the table you happened to save), and no guessing
// left to do, because there is only ever one candidate. The live URL still carries the real
// `?table=N`, and that is what the page reads — so the scanned table always wins.
//
// Only these two are dropped. Everything else in the query (`?cat=`, anything future) still
// distinguishes pages, because it can change what is rendered.
const TABLE_PARAMS = ["table", "t"];
const shellKey = (rawUrl) => {
  try {
    const u = new URL(rawUrl);
    let touched = false;
    for (const p of TABLE_PARAMS) if (u.searchParams.has(p)) { u.searchParams.delete(p); touched = true; }
    return touched ? u.href : rawUrl;
  } catch { return rawUrl; }
};

// ── the router ──────────────────────────────────────────────────────────────────
self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Writes, cross-origin (Supabase/CDN), range requests (3D models, media) and
  // only-if-cached probes are none of our business.
  if (req.method !== "GET") {
    // Note the moment of any write to our own API, so the reads that follow can't be answered
    // with a copy from before it (see AFTER_WRITE_FRESH_MS).
    try {
      const u = new URL(req.url);
      if (u.origin === self.location.origin && u.pathname.startsWith("/api/") && !NOT_A_CHANGE.test(u.pathname)) {
        lastWriteAt[apiFamily(u.pathname)] = Date.now();
      }
    } catch { /* ignore */ }
    return;
  }
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
    // Just after a write, wait for the truth rather than risk showing the state before it.
    const wroteAt = lastWriteAt[apiFamily(url.pathname)] || 0;
    const justWrote = self.navigator.onLine !== false && (Date.now() - wroteAt) < AFTER_WRITE_FRESH_MS;
    const timeout = slowByNature || justWrote ? 0 : READ_TIMEOUT_MS;
    // `justWrote` has to travel INTO networkFirst, not just shorten its timer. It used to only
    // zero the stall timeout — which was enough while a saved copy was the answer to slowness
    // alone. Now that a BUSY reply also falls back (below), the same masking is possible without
    // any slowness: mark a bill paid, the next read gets a 503, and the device answers with the
    // board from BEFORE the payment — the tile flicks back to unpaid and the change looks lost.
    // Same rule as ever: just after a write, wait for the truth.
    return event.respondWith(networkFirst(req, DATA, req.url, timeout, { clientId: event.clientId, justWrote }));
  }
  // Everything else same-origin static: /panels/*, /brand/*, fonts, images, /vendor/*.
  return event.respondWith(networkFirst(req, ASSET, req.url, ASSET_TIMEOUT_MS));
});

// Pages: always try the network, fall back to this page's saved HTML, then to a
// same-path match ignoring the query, then to the branded offline page.
async function handleNav(req, url) {
  // The table number is not part of what this page IS — see shellKey.
  const key = shellKey(req.url);
  // Same rule as reads: the request is never thrown away. If it's merely slow we show the
  // saved page, but the real one still lands and is saved for next time.
  const live = fetch(req).then((res) => {
    // Don't memorise redirects or error pages — only a real rendered page.
    if (res && res.ok && res.status === 200 && res.type !== "opaqueredirect") putStamped(SHELL, key, res);
    return res;
  });
  try {
    let timer;
    const stalled = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("stall")), NAV_TIMEOUT_MS); });
    try { return await Promise.race([live, stalled]); } finally { clearTimeout(timer); }
  } catch {
    live.catch(() => {});
    // No `ignoreSearch` guess any more: the table is out of the key, so an exact hit is the right
    // answer for every table, and anything else in the query genuinely IS a different page.
    return (await cachedCopy(SHELL, key))
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
  const justWrote = opts && opts.justWrote;   // this device changed something seconds ago
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
    // A real server error (a 500 from a bug, a 404, any refusal) is the truth — pass it through
    // rather than papering over it with stale data.
    //
    // BUT "I couldn't reach my database just now" is NOT a verdict about this request, and by the
    // app's own rule it takes the same path as no internet (CLAUDE.md, the rush section; the
    // write half of that rule already lives in public/panels/outbox.js). Those replies arrive as
    // 503 + X-LFH-Busy from lib/panelFailure.ts, or as a bare 502/503/504 when a gateway or the
    // platform answers instead of us. On 2026-08-03 a two-hour database wobble put 56 of them on
    // the Repair board, and each one blanked a manager's screen with the words "TimeoutError: The
    // operation was aborted due to timeout" — while the device held the same floor from a minute
    // earlier. Show that, stamped, so the offline bar can say "showing saved data from 7:42 pm".
    //
    // Only ever a FALLBACK: with nothing saved (or a forced Refresh, which must be live or fail)
    // the busy reply itself is returned untouched, so the panel still hears the truth.
    if (!noFallback && !justWrote && cacheName === DATA && res && CANT_ANSWER_NOW.has(res.status)) {
      const saved = await cachedCopy(cacheName, key, null, opts && opts.clientId);
      if (saved) return saved;
    }
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
