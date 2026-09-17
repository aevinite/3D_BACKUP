/* Port 8938: the states page at "/", and everything else proxied to the real app on 4000 —
   so the LIVE panel embedded in that page is the real thing, on the same port, same origin. */
import { createServer } from "node:http";
import { request } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
const DIR = new URL(".", import.meta.url).pathname;
const APP = { host: "127.0.0.1", port: 4000 };
const TYPE = { ".html": "text/html; charset=utf-8", ".png": "image/png", ".json": "application/json",
               ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8" };
const OURS = (p) => p === "/" || p === "/index.html" || p.startsWith("/shots/") || p === "/shots.json";
const proxy = (req, res) => {
  const p = request({ ...APP, method: req.method, path: req.url, headers: { ...req.headers, host: `127.0.0.1:${APP.port}` } },
    (up) => { res.writeHead(up.statusCode || 502, up.headers); up.pipe(res); });
  p.on("error", (e) => { res.writeHead(502, { "content-type": "text/plain" }); res.end("the app is not up on 4000: " + e.message); });
  req.pipe(p);
};
const srv = createServer(async (req, res) => {
  const path = decodeURIComponent((req.url || "/").split("?")[0]);
  if (!OURS(path)) return proxy(req, res);
  const file = join(DIR, path === "/" ? "index.html" : path.replace(/^\/+/, ""));
  try {
    const buf = await readFile(file);
    res.writeHead(200, { "content-type": TYPE[extname(file)] || "application/octet-stream", "cache-control": "no-store" });
    res.end(buf);
  } catch { proxy(req, res); }
});
srv.on("upgrade", (req, socket, head) => {           // the app's dev websocket
  const p = request({ ...APP, method: req.method, path: req.url, headers: { ...req.headers, host: `127.0.0.1:${APP.port}` } });
  p.on("upgrade", (up, upSocket, upHead) => {
    socket.write("HTTP/1.1 101 Switching Protocols\r\n" + Object.entries(up.headers).map(([k, v]) => `${k}: ${v}`).join("\r\n") + "\r\n\r\n");
    if (upHead && upHead.length) socket.write(upHead);
    upSocket.pipe(socket); socket.pipe(upSocket);
  });
  p.on("error", () => socket.destroy());
  p.end(head);
});
srv.listen(8938, "127.0.0.1", () => console.log("8938 → the states page at /, the real app for everything else"));
