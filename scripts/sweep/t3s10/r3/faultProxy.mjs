#!/usr/bin/env node
// scripts/sweep/t3s10/r3/faultProxy.mjs — A PASS-THROUGH IN FRONT OF THE DEV DATABASE THAT CAN BE TOLD TO FAIL.
//
//   node scripts/sweep/t3s10/r3/faultProxy.mjs            (listens on :5499 — FAULT_PORT to change)
//   NEXT_PUBLIC_SUPABASE_URL=http://localhost:5499 npx next dev -p 4403     (the app under test)
//
// WHY (sweep #10 T3 round 3). The ordering screens are built to survive a database that does not answer
// — "busy = offline, both ways". A browser test can fake a failure for what the PHONE asks (page.route),
// but not for what the SERVER asks: the menu page's own settings read, the order routes' calls. That is
// where item 31's failure lived ("Minified React error #441" — a server render that threw), so it needs a
// tool that can fail exactly that read, a set number of times, and then let the next one through.
//
// Everything passes through untouched (HTTP and the realtime websocket) until a fault is armed:
//   POST /__fault  { "match": "rpc/lfh_guest_settings", "side": "server"|"browser"|"any",
//                    "mode": "57014"|"503"|"hang"|"drop", "times": 2 }
//   POST /__clear   — disarm everything        GET /__log — what was matched and what was done
// `side` tells the server's calls (no Origin header) from the phone's (Origin set). Modes:
//   57014 — exactly what PostgREST answers for a statement timeout (HTTP 500, code 57014)
//   503   — a gateway that gave up              hang — never answers     drop — the connection is cut
// DEV DATABASE ONLY: it refuses to start unless .env.local points at the dev project.
import http from "node:http";
import https from "node:https";
import tls from "node:tls";
import { readFileSync } from "node:fs";

const env = readFileSync(new URL("../../../../.env.local", import.meta.url), "utf8");
const target = new URL((env.match(/^NEXT_PUBLIC_SUPABASE_URL=(.+)$/m) || [])[1].trim().replace(/^["']|["']$/g, ""));
if (target.hostname.split(".")[0] !== "wnsfcizclkbobwzcxqsf") { console.error("faultProxy: .env.local is not the dev database — refusing"); process.exit(2); }
const PORT = Number(process.env.FAULT_PORT || 5499);
let faults = []; const log = [];

const pick = (req) => {
  const side = req.headers.origin ? "browser" : "server";
  const f = faults.find((x) => x.times > 0 && req.url.includes(x.match) && (x.side === "any" || x.side === side));
  if (f) { f.times--; log.push({ at: Date.now(), url: req.url.slice(0, 120), side, mode: f.mode }); }
  return f;
};
const server = http.createServer((req, res) => {
  if (req.url === "/__fault" && req.method === "POST") { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => { const f = JSON.parse(b || "{}"); faults.push({ match: f.match, side: f.side || "any", mode: f.mode || "57014", times: f.times ?? 1 }); res.end("armed"); }); return; }
  if (req.url === "/__clear") { faults = []; res.end("clear"); return; }
  if (req.url === "/__log") { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ faults, log: log.slice(-200) })); return; }
  const f = pick(req);
  const cors = { "access-control-allow-origin": req.headers.origin || "*", "access-control-allow-credentials": "true", "access-control-allow-headers": "*", "access-control-allow-methods": "*" };
  if (f && req.method !== "OPTIONS") {
    if (f.mode === "hang") return;                                   // never answers
    if (f.mode === "drop") { req.socket.destroy(); return; }
    if (f.mode === "503") { res.writeHead(503, { ...cors, "content-type": "text/plain" }); res.end("upstream request timeout"); return; }
    res.writeHead(500, { ...cors, "content-type": "application/json" });
    res.end(JSON.stringify({ code: "57014", details: null, hint: null, message: "canceling statement due to statement timeout" })); return;
  }
  const headers = { ...req.headers, host: target.host }; delete headers["accept-encoding"];
  const up = https.request({ hostname: target.hostname, port: 443, path: req.url, method: req.method, headers }, (r) => { res.writeHead(r.statusCode || 502, r.headers); r.pipe(res); });
  up.on("error", () => { if (!res.headersSent) res.writeHead(502); res.end(); });
  req.pipe(up);
});
// realtime: a websocket upgrade is piped straight through to the real host
server.on("upgrade", (req, sock, head) => {
  const up = tls.connect(443, target.hostname, { servername: target.hostname }, () => {
    const lines = [`${req.method} ${req.url} HTTP/1.1`, ...Object.entries({ ...req.headers, host: target.host }).map(([k, v]) => `${k}: ${v}`), "", ""];
    up.write(lines.join("\r\n")); if (head?.length) up.write(head); up.pipe(sock); sock.pipe(up);
  });
  up.on("error", () => sock.destroy()); sock.on("error", () => up.destroy());
});
server.listen(PORT, () => console.log(`faultProxy: :${PORT} → ${target.host} (pass-through until a fault is armed)`));
