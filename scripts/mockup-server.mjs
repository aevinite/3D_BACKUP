// Tiny standalone static server for design mockups — runs on its OWN port so the
// owner can open it directly (no Next, no login, no iframe). Serves the files in
// public/mockups/. Stop it with Ctrl-C (or just close the terminal).
import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const PORT = 4555;
const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "public", "mockups");
const TYPES = { ".html":"text/html", ".css":"text/css", ".js":"text/javascript", ".png":"image/png", ".svg":"image/svg+xml" };

http.createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(req.url.split("?")[0]);
    if (path === "/") path = "/manager-redesign.html"; // default to the new redesign
    // keep it inside ROOT (no path traversal)
    const file = normalize(join(ROOT, path));
    if (!file.startsWith(ROOT)) { res.writeHead(403).end("nope"); return; }
    const body = await readFile(file);
    res.writeHead(200, { "Content-Type": TYPES[extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
    res.end(body);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found");
  }
}).listen(PORT, () => console.log(`Mockup server ready → http://localhost:${PORT}/`));
