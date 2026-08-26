// verify-warm-shell.mjs — A DEVICE'S *FIRST* VISIT MUST LEAVE IT ABLE TO OPEN THE APP.
//
//   node scripts/verify-warm-shell.mjs
//
// WHY THIS EXISTS. The offline layer promises "the HTML of pages you've already visited, so the
// app still opens". Saving that HTML needed its own fix (LFH_WARM_SHELL), because the very first
// navigation to a URL happens BEFORE the worker controls the client, so the worker never sees it.
//
// That fix shipped and was measured — but only for the DOCUMENT. The chunks a page is built from
// arrive in the same uncontrolled window, so `lfh-asset` was still completely empty after one
// visit. Measured on the deployed site, fresh device, one visit to a guest menu:
//
//     lfh-fallback-v8: 1     lfh-shell-v8: 1     lfh-asset-v8: DOES NOT EXIST
//
// Cut the network and reload and the saved HTML IS served — then every /_next/static/ request
// goes to cacheFirst(), misses, hits the network and throws. Verified by blocking every request
// including the worker's own: the diner got the document with NO CSS and NO JavaScript — black
// Times-serif text on white, "CATEGORIESSlide" run together, no dishes. That is worse-looking
// than the branded "Can't open this screen" page they would have got with nothing saved at all,
// and it happens in the commonest offline moment there is: scan the QR, walk to a table with
// thick walls, pull to refresh.
//
// So the page now tells the worker which same-origin files it just loaded, and the worker stores
// the ones it is missing. This proves that, against the REAL shipped public/sw.js, driven in a
// real browser against a local stub — no build, no database, no deployed site, no login, so it
// can never add load or trip one of the app's own limits.
//
//   1. a first visit leaves the document saved              (the original fix, still working)
//   2. …and the CODE that document needs, so it can render  (the half that was missing)
//   3. warming never re-fetches a read — /api/ is excluded   (egress: a menu payload is not small)
//   4. warming refuses anything that isn't this origin       (it must not pull in a foreign file)
//   5. a second visit stores nothing again                   (the cost is one first visit, not every one)
//   6. a READ the page already holds is stored WITHOUT re-fetching it — the same first-visit race,
//      closed without spending a single extra request (LFH_WARM_DATA)
import { chromium } from "playwright";
import http from "node:http";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log(`  ✅ ${m}`); };
const bad = (m, extra) => { fail++; console.log(`  ❌ ${m}${extra ? ` — ${extra}` : ""}`); };

// ── a stub site: a page, its stylesheet and chunk, one API read, and the REAL worker ────────
const hits = [];
const server = http.createServer((req, res) => {
  hits.push(req.url);
  if (req.url === "/sw.js") {
    res.writeHead(200, { "content-type": "application/javascript" });
    return res.end(readFileSync(join(ROOT, "public/sw.js"), "utf8"));
  }
  if (req.url === "/offline.html") {
    res.writeHead(200, { "content-type": "text/html" });
    return res.end("<!doctype html><body>offline</body>");
  }
  if (req.url.startsWith("/_next/static/")) {
    const css = req.url.endsWith(".css");
    res.writeHead(200, { "content-type": css ? "text/css" : "application/javascript", "cache-control": "public, max-age=31536000, immutable" });
    return res.end(css ? "body{background:#0b1020}" : "/* chunk */");
  }
  if (req.url.startsWith("/api/r/")) {          // a read: must NEVER be warmed
    res.writeHead(200, { "content-type": "application/json" });
    return res.end('{"dishes":[]}');
  }
  // A STAFF PANEL's board read. Same family as the real /api/editor/all — the one that matters
  // most offline, and the one a first visit used to save none of. See /panelpage below.
  if (req.url.startsWith("/api/editor/all")) {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end('{"orders":[],"tables":[]}');
  }
  if (req.url.startsWith("/panelpage")) {
    res.writeHead(200, { "content-type": "text/html" });
    // Loads the REAL public/panels/swreg.js and hands over a read the way each panel's api() now
    // does. Deliberately fetched BEFORE the worker can be controlling, which is the whole point.
    return res.end(`<!doctype html><meta charset="utf-8"><body>panel
      <script>
        window.__uncontrolled = !(navigator.serviceWorker && navigator.serviceWorker.controller);
        fetch("/api/editor/all").then(function (r) { return r.json(); }).then(function (j) {
          if (window.__uncontrolled && window.LFH_WARM) {
            window.LFH_WARM.data(new URL("/api/editor/all", location.origin).href, JSON.stringify(j));
          }
        });
      </script>
      <script>${readFileSync(join(ROOT, "public/panels/swreg.js"), "utf8")}</script>`);
  }
  if (req.url.startsWith("/page")) {
    res.writeHead(200, { "content-type": "text/html" });
    // Registers the worker exactly as components/OfflineShell.tsx does, including the asset list.
    return res.end(`<!doctype html><meta charset="utf-8">
      <link rel="stylesheet" href="/_next/static/chunks/app.css">
      <body>menu
      <script src="/_next/static/chunks/main.js"></script>
      <script>
        fetch("/api/r/french-house/menu-data");           // a read, in the same window
        navigator.serviceWorker.register("/sw.js", { scope: "/" }).then(function () {
          function pageAssets() {
            return performance.getEntriesByType("resource")
              .filter(function (r) { return ["script","link","css","font","img"].indexOf(r.initiatorType) >= 0; })
              .map(function (r) { return r.name; })
              .filter(function (n) { return n.indexOf(location.origin) === 0; })
              // A foreign file the page happened to load must never be warmed (check 4).
              .concat(["https://example.invalid/evil.js", location.origin + "/api/r/french-house/menu-data"]);
          }
          function warm() {
            if (navigator.serviceWorker.controller) {
              navigator.serviceWorker.controller.postMessage({ type: "LFH_WARM_SHELL", url: location.href, assets: pageAssets() });
            }
          }
          if (navigator.serviceWorker.controller) warm();
          else navigator.serviceWorker.addEventListener("controllerchange", warm, { once: true });
        });
      </script>`);
  }
  res.writeHead(404); res.end("no");
});
await new Promise((r) => server.listen(4327, r));
const BASE = "http://127.0.0.1:4327";

const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();
page.on("pageerror", (e) => bad("the page threw", String(e).slice(0, 120)));

const until = async (fn, ms) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 150)); }
  return false;
};
const stored = () => page.evaluate(async () => {
  const out = {};
  for (const k of await caches.keys()) {
    out[k.replace(/-v\d+$/, "")] = (await (await caches.open(k)).keys()).map((r) => new URL(r.url).pathname);
  }
  return out;
});

console.log("\n1+2) One visit — is the page saved, AND the code it needs to be a page?");
await page.goto(`${BASE}/page`, { waitUntil: "networkidle" });
await until(async () => Object.keys(await stored()).some((k) => k === "lfh-asset"), 12000);
const c = await stored();

if ((c["lfh-shell"] || []).some((p) => p.startsWith("/page"))) ok("the document is saved on the FIRST visit");
else bad("the page itself was not saved", JSON.stringify(c["lfh-shell"]));

const assets = c["lfh-asset"] || [];
if (assets.some((p) => p.endsWith(".css"))) ok("its stylesheet is saved — an offline reload can't come up unstyled");
else bad("NO CSS SAVED: an offline reload renders the raw document", JSON.stringify(assets));
if (assets.some((p) => p.endsWith(".js"))) ok("its script is saved — the page can still run");
else bad("NO SCRIPT SAVED: an offline reload renders a dead page", JSON.stringify(assets));

console.log("\n3+4) What warming must NEVER pull in");
if (!assets.some((p) => p.startsWith("/api/"))) ok("no read was re-fetched into the cache (egress stays honest)");
else bad("a read was warmed — that doubles a menu payload on every first visit", JSON.stringify(assets));
const foreign = hits.filter((u) => u.includes("evil"));
if (!foreign.length) ok("a file from another origin is refused");
else bad("warming followed a foreign URL", foreign.join(","));

console.log("\n5) A second visit must not pay for it again");
const before = hits.filter((u) => u.startsWith("/_next/static/")).length;
await page.reload({ waitUntil: "networkidle" });
await new Promise((r) => setTimeout(r, 2500));
const after = hits.filter((u) => u.startsWith("/_next/static/")).length;
// A reload naturally re-requests its own assets; what must NOT happen is the warm loop fetching
// them a second time on top. Anything already stored is skipped, so the extra should be small.
if (after - before <= 2) ok(`nothing was warmed twice (${after - before} extra static request(s))`);
else bad("the warm ran again on an already-warmed device", `${after - before} extra static requests`);

// ── 6. the DATA half of the same race, at zero egress ────────────────────────────────────────
// The code half is fetched (checks 1-5). A read must NOT be: pulling the menu a second time on
// every diner's first visit is a real per-device cost. The page hands over what it already has.
console.log("\n6) A read the page already holds is saved without re-fetching it");
{
  // A path this page NEVER requests — so if it lands in the cache, only the warm can have put it
  // there. My first version used the page's OWN read and passed even with the handler disabled,
  // because the normal network-first path had already cached it: a check that cannot fail.
  const before = hits.filter((u) => u.startsWith("/api/r/")).length;
  await page.evaluate(() => new Promise((done) => {
    const c = navigator.serviceWorker.controller;
    c.postMessage({ type: "LFH_WARM_DATA", url: location.origin + "/api/r/never-fetched-by-this-page/menu-data", body: JSON.stringify({ items: [{ id: "x" }], categories: [] }) });
    // …and two it must REFUSE: another origin, and a route that is never cached.
    c.postMessage({ type: "LFH_WARM_DATA", url: "https://example.invalid/api/r/x/menu-data", body: "{}" });
    c.postMessage({ type: "LFH_WARM_DATA", url: location.origin + "/api/health", body: "{}" });
    setTimeout(done, 1200);
  }));
  const stored = await page.evaluate(async () => {
    const k = (await caches.keys()).find((x) => x.startsWith("lfh-data"));
    if (!k) return [];
    return (await (await caches.open(k)).keys()).map((r) => new URL(r.url).pathname);
  });
  const after = hits.filter((u) => u.startsWith("/api/r/")).length;
  stored.includes("/api/r/never-fetched-by-this-page/menu-data")
    ? ok("the read is in the offline cache, from the page's own copy")
    : bad("the handed-over read was not stored", JSON.stringify(stored));
  after === before
    ? ok("…and NOTHING was fetched to do it (egress unchanged)")
    : bad("warming a read cost a request", `${after - before} extra`);
  !stored.some((p) => p.includes("/api/health"))
    ? ok("a never-cached route is refused")
    : bad("a never-cached route was stored");
  // Nothing from another origin can appear: those are keyed by full URL, so check none are foreign.
  const foreign = await page.evaluate(async () => {
    const k = (await caches.keys()).find((x) => x.startsWith("lfh-data"));
    if (!k) return [];
    return (await (await caches.open(k)).keys()).map((r) => r.url).filter((u) => !u.startsWith(location.origin));
  });
  foreign.length === 0 ? ok("a foreign origin is refused") : bad("stored another origin's data", foreign.join(","));
  // …and it must never clobber something the worker fetched itself.
  await page.evaluate(() => new Promise((done) => {
    navigator.serviceWorker.controller.postMessage({ type: "LFH_WARM_DATA", url: location.origin + "/api/r/never-fetched-by-this-page/menu-data", body: JSON.stringify({ items: [], categories: [], OVERWRITTEN: true }) });
    setTimeout(done, 1000);
  }));
  const body = await page.evaluate(async () => {
    const k = (await caches.keys()).find((x) => x.startsWith("lfh-data"));
    const r = await (await caches.open(k)).match(location.origin + "/api/r/never-fetched-by-this-page/menu-data", { ignoreVary: true });
    return r ? await r.text() : "";
  });
  !body.includes("OVERWRITTEN") ? ok("an already-saved read is never overwritten by a later offer") : bad("a saved read was overwritten");
}

// ── 7. A STAFF PANEL's first visit ────────────────────────────────────────────────────────────
// The guest menu got the read-warming fix on 2026-08-07; the panels did not, and nobody noticed
// because nothing checked them. Measured on a production build, fresh profile, manager panel:
//
//   after the FIRST visit : /api/editor/platform  /api/rt-config
//   after ONE reload      : /api/editor/all  + four more
//
// So a waiter who opened a panel for the first time and then lost signal that same shift got the
// branded "Can't open this screen" page instead of the last board — the exact thing this layer
// exists to prevent. public/panels/swreg.js now exposes LFH_WARM.data and each panel's api()
// hands over first-visit reads; this drives the REAL file.
console.log("\n7) A staff panel's FIRST visit saves its board too");
{
  const p2 = await ctx.newPage();
  p2.on("pageerror", (e) => bad("the panel page threw", String(e).slice(0, 120)));
  const netBefore = hits.length;
  await p2.goto(`${BASE}/panelpage`, { waitUntil: "networkidle" });
  const got = await until(async () => {
    const d = await p2.evaluate(async () => {
      const k = (await caches.keys()).find((x) => x.startsWith("lfh-data"));
      if (!k) return [];
      return (await (await caches.open(k)).keys()).map((r) => new URL(r.url).pathname);
    });
    return d.some((x) => x.startsWith("/api/editor/"));
  }, 12000);
  got
    ? ok("the panel's board read is saved on the FIRST visit, before any reload")
    : bad("a panel's first visit still saves no board — an offline reload that shift shows nothing");
  // …and it cost no second request: the panel handed over the body it already had.
  const boardFetches = hits.slice(netBefore).filter((u) => u.startsWith("/api/editor/all")).length;
  boardFetches <= 1
    ? ok("…and it was not re-fetched to do it (egress unchanged)")
    : bad("the panel's read was fetched twice to warm it", `${boardFetches} requests`);
  await p2.close();
}

// ── 8 · WHICH VERSION OF THE OFFLINE LAYER IS ACTUALLY RUNNING? ────────────────────────────
// The worker answers a {type:"LFH_PING"} message with its own VERSION. That handler had NO
// CALLER anywhere in the repo — and the sweep-#6 ledger recorded it as green with the note "used
// by verify-warm-shell.mjs", which was never true: `git log -S LFH_PING` shows it has only ever
// appeared in public/sw.js. So a row said the hook was covered, and nothing was asking.
//
// It is worth asking, because VERSION is load-bearing and had nothing watching it either. Every
// cache name interpolates it, `activate` deletes every lfh- cache that is not one of the four
// current names, and /offline.html is PRECACHED — so a device keeps serving the old page until
// those names change. That is exactly why the file's own header says to bump it. If VERSION and
// the live cache names ever disagree, a deploy silently keeps the previous offline layer.
console.log("\n8) The running worker agrees with the file about its VERSION");
{
  const declared = (readFileSync(join(ROOT, "public/sw.js"), "utf8").match(/const VERSION = "([^"]+)"/) || [])[1];
  const p3 = await ctx.newPage();
  await p3.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await p3.evaluate(() => navigator.serviceWorker.ready);
  const reported = await p3.evaluate(() => new Promise((resolve) => {
    const done = (v) => resolve(v);
    const t = setTimeout(() => done(null), 4000);   // never hang the suite on a silent worker
    navigator.serviceWorker.addEventListener("message", (e) => {
      if (e.data && e.data.type === "LFH_PONG") { clearTimeout(t); done(e.data.version || ""); }
    });
    navigator.serviceWorker.controller.postMessage({ type: "LFH_PING" });
  }));
  reported === declared
    ? ok(`the controlling worker reports the VERSION the file declares (${declared})`)
    : bad("the running offline layer is not the one in the file",
      reported === null
        ? "LFH_PING got no answer — the diagnostic hook is dead, so nothing can tell which layer a device is on"
        : `sw.js says ${declared}, the worker says ${reported}`);

  // …and every live cache name really carries it. A name that missed the bump survives `activate`
  // only by accident, and one that carries an OLD version is a cache nothing will ever clear.
  const names = await p3.evaluate(() => caches.keys().then((k) => k.filter((x) => x.startsWith("lfh-"))));
  const versions = [...new Set(names.map((n) => n.slice(n.lastIndexOf("-") + 1)))];
  versions.length === 1 && versions[0] === declared
    ? ok(`all ${names.length} live cache(s) carry that same version`)
    : bad("the live caches do not all carry the declared version",
      `declared ${declared}, found ${versions.join(", ")} in: ${names.join(", ")}`);
  await p3.close();
}

await browser.close();
server.close();
console.log(`\n${fail ? "❌" : "✅"} warm shell: ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
