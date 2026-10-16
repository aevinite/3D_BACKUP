// scripts/sweep/t12r3/f-record.mjs — take the REAL shapes of the tablet's server answers, once, so the
// fixture world (f-world.mjs) is built from what the server actually says rather than from memory.
//
//   node scripts/sweep/t12r3/f-record.mjs [--base http://localhost:4412] > fixtures written to t12r3/fixtures/
//
// Read-only by construction: the service worker is blocked and every request that is not a GET is
// refused inside the browser before it leaves, so nothing this does can change anything anywhere.
// Signed in as the diag waiter of French House (the restaurant this terminal writes to); Aangan is
// never opened. Ids and names in the recorded answers are French House's own test data.
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { loginAs } from "../login.mjs";

const BASE = (() => { const i = process.argv.indexOf("--base"); return (i > 0 && process.argv[i + 1]) || "http://localhost:4412"; })();
const OUT = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
mkdirSync(OUT, { recursive: true });
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1194, height: 834 }, hasTouch: true, serviceWorkers: "block" });
await loginAs(ctx, "tablet", BASE);
const seen = {};
await ctx.route("**/api/**", async (r) => {
  if (r.request().method() !== "GET") return r.fulfill({ status: 418, contentType: "application/json", body: JSON.stringify({ error: "recorder refuses writes" }) });
  const res = await r.fetch();
  const body = await res.text();
  const u = new URL(r.request().url());
  const key = u.pathname.replace("/api/tablet/", "").replace(/^\/api\//, "api_").replace(/\//g, "_") + (u.searchParams.get("table") ? "_table_" + u.searchParams.get("table") : "");
  if (!seen[key]) { seen[key] = { url: u.pathname + u.search, status: res.status(), body: (() => { try { return JSON.parse(body); } catch { return body; } })() }; }
  return r.fulfill({ response: res, body });
});
const page = await ctx.newPage();
await page.goto(`${BASE}/panels/tablet/index.html?cb=${Date.now()}`, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => typeof state !== "undefined" && state.settingsSettled && TABLET_WHO, null, { timeout: 60000 });
await page.waitForTimeout(3000);
// Reads the panel makes only on demand: one table's detail, the khata list, the banquet menu, the summary.
await page.evaluate(async () => {
  // One table of every state the floor is showing right now, plus one free table.
  const tiles = (state.summary && state.summary.tiles) || {};
  const byState = {};
  for (const [n, t] of Object.entries(tiles)) if (t && !byState[t.state || "free"]) byState[t.state || "free"] = n;
  const tries = [...Object.values(byState).map((n) => `/state?table=${encodeURIComponent(n)}`), "/khata/customers", "/banquet-items"];
  for (const p of tries.filter(Boolean)) { try { await api("GET", p); } catch (e) { /* recorded with its status */ } }
});
await page.waitForTimeout(1500);
for (const [k, v] of Object.entries(seen)) writeFileSync(join(OUT, k + ".json"), JSON.stringify(v, null, 1));
console.log(Object.entries(seen).map(([k, v]) => `${k} ${v.status} ${JSON.stringify(v.body).length}b`).join("\n"));
await b.close();
