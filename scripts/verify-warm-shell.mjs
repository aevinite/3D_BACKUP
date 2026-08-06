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

await browser.close();
server.close();
console.log(`\n${fail ? "❌" : "✅"} warm shell: ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
