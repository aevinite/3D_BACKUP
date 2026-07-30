// slow-proxy.mjs — a tiny stand-in for "the internet is there, but hopeless".
//
// WHY THIS EXISTS
//   Chrome's own network throttling (CDP Network.emulateNetworkConditions) applies to the
//   PAGE target only — it does not slow requests made by a service worker, which is where
//   all of this app's reads go. So throttling the browser proved nothing: the reads came
//   back instantly and the test was measuring air. Slowing the SERVER is the honest way to
//   reproduce a crawling connection end-to-end.
//
//   Used by scripts/verify-offline.mjs. Start it, warm the app up through it (so the device
//   saves its copies), then flip it slow and reload: the offline layer should stop waiting
//   and paint the saved board instead of spinning.
//
//   node scripts/slow-proxy.mjs --target http://localhost:4013 --port 4099
//   curl "http://localhost:4099/__slow?ms=12000"   # every /api read now takes 12s
//   curl "http://localhost:4099/__slow?ms=0"       # back to normal
import http from "node:http";

const args = process.argv.slice(2);
const arg = (name, dflt) => (args.includes(name) ? args[args.indexOf(name) + 1] : dflt);
const TARGET = new URL(arg("--target", "http://localhost:4013"));
const PORT = Number(arg("--port", "4099"));

let delayMs = 0; // how long every /api reply is held back

const server = http.createServer((req, res) => {
  // Control endpoint: flip the slowness on and off mid-test.
  if (req.url.startsWith("/__slow")) {
    const u = new URL(req.url, "http://x");
    delayMs = Number(u.searchParams.get("ms") || 0) || 0;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, delayMs }));
    return;
  }

  const opts = {
    hostname: TARGET.hostname,
    port: TARGET.port || 80,
    path: req.url,
    method: req.method,
    headers: { ...req.headers, host: TARGET.host },
  };

  const proxied = http.request(opts, (up) => {
    // Only READS are held back. Holding writes would test something else entirely (and
    // the offline queue already covers writes).
    const hold = delayMs > 0 && req.method === "GET" && req.url.startsWith("/api/") ? delayMs : 0;
    setTimeout(() => {
      res.writeHead(up.statusCode || 502, up.headers);
      up.pipe(res);
    }, hold);
  });
  proxied.on("error", () => { if (!res.headersSent) res.writeHead(502); res.end(); });
  req.pipe(proxied);
});

server.listen(PORT, () => console.log(`slow-proxy: ${TARGET.origin} → http://localhost:${PORT}`));
