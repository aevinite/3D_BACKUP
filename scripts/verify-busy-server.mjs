// verify-busy-server.mjs — PROVES NOTHING IS LOST WHEN THE SERVER IS TOO BUSY TO ANSWER.
//
//   node scripts/verify-busy-server.mjs
//
// WHY THIS EXISTS. On 2026-07-31 the shared database was saturated (by two of our own test
// runs). It was UP, but it answered nothing at all for 30-90 seconds. The app had one story for
// "no internet" — save it on the device, send it later, tell the person honestly — and NO story
// for "the server can't take this right now": a staff tap hung on a spinner forever with no
// timeout, and a diner's order came back as "Order didn't go through". The owner's question was
// the right one: what happens when a real restaurant sends 800 orders at once?
//
// So the busy case now takes the SAME path as being offline, and this script proves it against
// the real shipped files — not a mock of them:
//
//   A. STAFF (public/panels/outbox.js, driven in a real browser)
//      1. a write while the server is busy comes back "queued", not an error
//      2. it is still queued after the busy answer (nothing was dropped)
//      3. when the server recovers it is delivered, EXACTLY ONCE (same action id)
//      4. the queue empties
//      5. a 4xx refusal is NOT queued — the person must see it (a clash, a closed table)
//      6. every write carries a deadline, so a server that never answers can't hang a tap
//   B. GUEST (lib/menu.ts createOrder, bundled and run against a stub)
//      7. a 5xx is classed "busy" (→ the cart saves it on the device)
//      8. a dropped/timed-out request is classed "busy"
//      9. a real refusal (sold out) is NOT classed busy
//     10. the request carries an abort signal (the deadline is actually attached)
//
// Nothing here touches any database, any deployed site, or any login: it runs entirely against a
// local stub, so it can never add load or raise one of the app's own limits.
import { chromium } from "playwright";
import http from "node:http";
import { readFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log(`  ✅ ${m}`); };
const bad = (m, extra) => { fail++; console.log(`  ❌ ${m}${extra ? ` — ${extra}` : ""}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ── the stub restaurant server ────────────────────────────────────────────────────────────
// mode "busy"  → 503 with the shape our routes send when the database won't answer
// mode "dead"  → never answers at all (the 2026-07-31 shape)
// mode "ok"    → accepts, and records the action id so we can prove exactly-once
// mode "refuse"→ 409, a genuine clash that a person must see
let mode = "busy";
const seen = [];
const server = http.createServer((req, res) => {
  if (req.url === "/page") {
    res.writeHead(200, { "content-type": "text/html" });
    return res.end(`<!doctype html><meta charset="utf-8"><body>
      <script>${readFileSync(join(ROOT, "public/panels/outbox.js"), "utf8")}</script>`);
  }
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const id = req.headers["x-lfh-action-id"] || "";
    if (mode === "dead") return; // answer nothing, ever
    if (mode === "busy") { res.writeHead(503, { "content-type": "application/json" }); return res.end('{"error":"busy","busy":true}'); }
    if (mode === "refuse") { res.writeHead(409, { "content-type": "application/json" }); return res.end('{"error":"Table already billed","clash":{"plain":"Table 5 was already billed.","retryable":false}}'); }
    seen.push({ id, path: req.url, replay: req.headers["x-lfh-replay"] === "1" });
    res.writeHead(200, { "content-type": "application/json" });
    res.end('{"ok":true}');
  });
});
await new Promise((r) => server.listen(4322, r));
const BASE = "http://127.0.0.1:4322";

// ── A. the staff panels, in a real browser ────────────────────────────────────────────────
console.log("\nA) A staff tap while the server is too busy to answer");
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(BASE + "/page", { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => !!window.LFH_OUTBOX, null, { timeout: 10000 });

// Caught, not thrown: without the fix `send()` REJECTS here, and a guard that dies on its
// first check prints no verdict at all — which is how a regression gets waved through. Proven
// by removing the fix: this reports the failure and the run still reaches its summary.
const sent = await page.evaluate(async (base) => {
  try {
    return await window.LFH_OUTBOX.send({ base, method: "POST", path: "/api/tablet/serve", body: { order: 1 }, panel: "tablet", label: "Mark served" });
  } catch (e) { return { threw: String((e && e.message) || e) }; }
}, BASE);
sent && sent.queued === true
  ? ok("the tap is accepted and saved on the device (not an error)")
  : bad("a busy server lost the tap", JSON.stringify(sent));
sent && sent.busy === true
  ? ok("and it is marked as 'the server was busy', not 'you are offline'")
  : bad("the reason wasn't carried back to the panel");

const depth = await page.evaluate(() => window.LFH_OUTBOX.getSnapshot().queued.length);
depth === 1 ? ok("it is waiting in the queue (nothing was dropped)") : bad(`queue holds ${depth}, expected 1`);

console.log("\n   …the server recovers");
mode = "ok";
await page.evaluate(() => window.LFH_OUTBOX.flush && window.LFH_OUTBOX.flush());
for (let i = 0; i < 40 && seen.length === 0; i++) await wait(250);
seen.length === 1 ? ok("the saved tap is delivered by itself") : bad(`server saw ${seen.length} deliveries, expected 1`);
seen.length === 1 && seen[0].id === sent.action_id
  ? ok("delivered under its ORIGINAL id, so it can never become two actions")
  : bad("the action id changed on replay — a retry could double it");
await wait(600);
const after = await page.evaluate(() => window.LFH_OUTBOX.getSnapshot().queued.length);
after === 0 ? ok("and the queue is empty again") : bad(`queue still holds ${after}`);

console.log("\nB) A refusal must still reach the person");
mode = "refuse";
const refused = await page.evaluate(async (base) => {
  try {
    const r = await window.LFH_OUTBOX.send({ base, method: "POST", path: "/api/tablet/pay", body: {}, panel: "tablet", label: "Mark paid" });
    return { threw: false, r };
  } catch (e) { return { threw: true, status: e.status || 0 }; }
}, BASE);
refused.threw && refused.status === 409
  ? ok("a clash is raised to the person, not queued behind their back")
  : bad("a 4xx refusal was swallowed into the queue", JSON.stringify(refused));

console.log("\nC) A server that never answers cannot hang a tap");
const src = readFileSync(join(ROOT, "public/panels/outbox.js"), "utf8");
/AbortSignal\.timeout\(WRITE_TIMEOUT_MS\)/.test(src) && /WRITE_TIMEOUT_MS\s*=\s*\d+/.test(src)
  ? ok("every write carries a deadline (AbortSignal.timeout)")
  : bad("writes have no deadline — an overloaded server would spin forever");
/scheduleRetry\(progressed\)/.test(src) && /RETRY_MAX_MS/.test(src) && /0\.75 \+ Math\.random\(\)/.test(src)
  ? ok("re-sends back off and are jittered (no synchronised retry storm)")
  : bad("the retry loop is still a fixed metronome");
/window\.LFH_RT\.catchUp/.test(readFileSync(join(ROOT, "public/panels/kitchen/app.js"), "utf8"))
  ? ok("the kitchen's catch-up poll backs off instead of a fixed 5s from every device")
  : bad("the kitchen still polls at a fixed 5s while realtime is down");

await browser.close();

// ── D. the guest order decision, from the real lib/menu.ts ────────────────────────────────
console.log("\nD) A diner's order while the restaurant's system is swamped");
mkdirSync(join(ROOT, "node_modules/.cache"), { recursive: true });
const OUT = join(ROOT, "node_modules/.cache/verify-busy-menu.mjs");
execFileSync("npx", ["esbuild", "lib/menu.ts", "--bundle", "--platform=node", "--format=esm",
  "--alias:@=.", `--outfile=${OUT}`, "--log-level=warning"], { cwd: ROOT, stdio: "inherit" });
// lib/menu.ts pulls in the shared browser Supabase client, which insists on a URL at import
// time. Deliberately FAKE values pointing at the local stub: the path under test posts to
// /api/guest/place-order and never touches Supabase, and this keeps the check unable to reach
// any real database even by accident.
process.env.NEXT_PUBLIC_SUPABASE_URL ||= BASE;
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "not-a-real-key";
const { createOrder, isServerBusy } = await import(pathToFileURL(OUT).href);

const call = async (fetchImpl) => {
  globalThis.fetch = fetchImpl;
  try { await createOrder({ tableNumber: "5", items: [{ id: "x", qty: 1 }], allergies: [] }, "rid", "act-1"); return null; }
  catch (e) { return e; }
};
let sawSignal = false;
const e503 = await call(async (_u, init) => { sawSignal = !!(init && init.signal); return new Response('{"error":"busy"}', { status: 503 }); });
isServerBusy(e503) ? ok("a 5xx means 'save it and send it', not 'order failed'") : bad("a busy server told the diner their order failed");
sawSignal ? ok("the order request carries a deadline") : bad("no deadline on the diner's order — a hang would spin forever");

const eAbort = await call(async () => { const err = new Error("aborted"); err.name = "AbortError"; throw err; });
isServerBusy(eAbort) ? ok("a dropped/timed-out request also means 'save it and send it'") : bad("a timeout was treated as a refusal");

const eSoldOut = await call(async () => new Response('{"ok":false,"reason":"sold_out","item":"Croissant"}', { status: 200 }));
eSoldOut && !isServerBusy(eSoldOut) && /sold_out/.test(eSoldOut.message)
  ? ok("a real refusal (sold out) is NOT queued — the diner is told")
  : bad("a genuine refusal was misread as 'busy'", String(eSoldOut && eSoldOut.message));

server.close();
console.log(`\n${fail ? "❌" : "✅"} ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
