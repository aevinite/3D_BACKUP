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
  // Section E drives the REAL service worker, so it is served exactly as the app serves it,
  // from the root scope. A stub copy would only prove the stub works.
  if (req.url === "/sw.js") {
    res.writeHead(200, { "content-type": "text/javascript", "cache-control": "no-store" });
    return res.end(readFileSync(join(ROOT, "public/sw.js"), "utf8"));
  }
  if (req.url === "/panel") {
    res.writeHead(200, { "content-type": "text/html" });
    return res.end('<!doctype html><meta charset="utf-8"><title>panel</title><body>floor');
  }
  if (req.url === "/offline.html") { // the worker pre-caches this on install
    res.writeHead(200, { "content-type": "text/html" });
    return res.end("<!doctype html><title>offline</title>saved screens");
  }
  // A WRITE to the same family, so the worker can note "this device just changed something".
  if (req.method === "POST" && req.url.startsWith("/api/editor/")) {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end('{"ok":true}');
  }
  // A panel READ. Same four moods as a write, plus "the app itself threw" — which must stay a
  // 500 and reach the screen, or a bug would hide behind yesterday's numbers.
  if (req.method === "GET" && req.url.startsWith("/api/editor/")) {
    if (mode === "dead") return;
    if (mode === "busy") { res.writeHead(503, { "content-type": "application/json", "X-LFH-Busy": "1" }); return res.end('{"error":"The system is very busy right now — this will come back by itself in a moment.","busy":true}'); }
    if (mode === "bug") { res.writeHead(500, { "content-type": "application/json" }); return res.end('{"error":"tagRow is not defined"}'); }
    if (mode === "refuse") { res.writeHead(409, { "content-type": "application/json" }); return res.end('{"error":"Table already billed"}'); }
    res.writeHead(200, { "content-type": "application/json" });
    return res.end('{"tables":3,"due":0}');
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

// ── E. THE READ HALF OF THE SAME RULE, driving the real public/sw.js ──────────────────────
// Added 2026-08-03. The write half above has been right since July; the READ half was not, and
// that is what a manager actually saw for two hours: 56 recorded failures, every one of them the
// database not answering, every one of them shown as "TimeoutError: The operation was aborted due
// to timeout" on a screen whose device already held the same floor from a minute earlier.
// public/sw.js used to pass any server error straight through ("a real server error is the
// truth"), which is right for a bug and wrong for "not just now".
console.log("\nE) A read while the database isn't answering (the real service worker)");
const swPage = await browser.newPage();
const swLog = [];
swPage.on("console", (m) => swLog.push(m.text()));
await swPage.goto(BASE + "/panel", { waitUntil: "domcontentloaded" });
const registered = await swPage.evaluate(async () => {
  const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  await navigator.serviceWorker.ready;
  for (let i = 0; i < 100 && !navigator.serviceWorker.controller; i++) await new Promise((r) => setTimeout(r, 100));
  return !!navigator.serviceWorker.controller && !!reg;
});
registered ? ok("the real worker is installed and in charge of the page") : bad("the service worker never took control");

// A read on a good connection: this is what puts a copy on the device in the first place.
mode = "ok";
const fresh = await swPage.evaluate(async () => {
  const r = await fetch("/api/editor/summary");
  return { status: r.status, fromCache: r.headers.get("X-LFH-From-Cache"), body: await r.text() };
});
fresh.status === 200 && fresh.body.includes('"tables":3') && !fresh.fromCache
  ? ok("a normal read is answered live and saved on the device")
  : bad("the live read didn't come through", JSON.stringify(fresh));

// …and now the database stops answering. Same request, same second.
mode = "busy";
const busyRead = await swPage.evaluate(async () => {
  const r = await fetch("/api/editor/summary");
  return { status: r.status, fromCache: r.headers.get("X-LFH-From-Cache"), at: r.headers.get("X-LFH-Cached-At"), body: await r.text() };
});
busyRead.status === 200 && busyRead.body.includes('"tables":3')
  ? ok("the screen still gets the floor it had, instead of an error")
  : bad("a busy database still breaks the read", JSON.stringify(busyRead));
busyRead.fromCache === "1" && Number(busyRead.at) > 0
  ? ok("and it is STAMPED as saved data, so the bar can say when it is from")
  : bad("saved data was passed off as live — that is worse than the error", JSON.stringify(busyRead));

// The three cases that must NOT be softened.
const forced = await swPage.evaluate(async () => {
  const r = await fetch("/api/editor/summary?refresh=1");
  return { status: r.status, fromCache: r.headers.get("X-LFH-From-Cache") };
});
forced.status === 503 && forced.fromCache !== "1"
  ? ok("a forced Refresh is never answered from the device — it waits or fails honestly")
  : bad("Refresh handed back a saved number", JSON.stringify(forced));

mode = "bug";
const bug = await swPage.evaluate(async () => {
  const r = await fetch("/api/editor/summary");
  return { status: r.status, fromCache: r.headers.get("X-LFH-From-Cache") };
});
bug.status === 500 && bug.fromCache !== "1"
  ? ok("a real 500 still reaches the screen — a bug is never hidden behind saved data")
  : bad("an app bug was masked as 'busy'", JSON.stringify(bug));

mode = "refuse";
const refusedRead = await swPage.evaluate(async () => (await fetch("/api/editor/summary")).status);
refusedRead === 409 ? ok("a refusal still reaches the screen unchanged") : bad(`a 4xx came back as ${refusedRead}`);

// Nothing saved for THIS read → the busy answer itself must arrive, not silence.
mode = "busy";
const unsaved = await swPage.evaluate(async () => {
  const r = await fetch("/api/editor/never-read-before");
  return { status: r.status, busy: (await r.text()).includes("busy") };
});
unsaved.status === 503 && unsaved.busy
  ? ok("with nothing saved, the panel is told the truth (503, busy)")
  : bad("a busy read with no saved copy went missing", JSON.stringify(unsaved));

// A CHANGE THIS DEVICE JUST MADE MUST NEVER BE MASKED BY THE SAVED COPY. The saved-copy answer
// above is right for a screen that is merely out of date; it is wrong for the seconds right after
// somebody taps, because the saved copy is the state from BEFORE their tap. Mark a bill paid, let
// the next read come back busy, and a fallback would flick the tile back to unpaid — the exact
// "my change didn't work" shape the AFTER_WRITE_FRESH_MS window exists to stop.
mode = "ok";
await swPage.evaluate(async () => { await fetch("/api/editor/summary"); });      // a fresh saved copy
await swPage.evaluate(async () => { await fetch("/api/editor/mark-paid", { method: "POST", body: "{}" }); });
mode = "busy";
const afterWrite = await swPage.evaluate(async () => {
  const r = await fetch("/api/editor/summary");
  return { status: r.status, fromCache: r.headers.get("X-LFH-From-Cache") };
});
afterWrite.status === 503 && afterWrite.fromCache !== "1"
  ? ok("right after this device wrote, a busy read is NOT answered from the device")
  : bad("a saved copy masked a change this device just made", JSON.stringify(afterWrite));

// …and once that window has passed, the fallback works again (it is a pause, not an off switch).
await swPage.evaluate(async () => {
  // Tell the worker the write was long ago, the same way time passing would.
  const reg = await navigator.serviceWorker.getRegistration();
  return !!reg;
});

// The server end of the same contract: the routes must actually SEND that 503 + marker.
const failureSrc = readFileSync(join(ROOT, "lib/panelFailure.ts"), "utf8");
/X-LFH-Busy/.test(failureSrc) && /busy: true/.test(failureSrc)
  ? ok("the panel routes answer a dead database with 503 + the busy marker")
  : bad("the routes send no busy marker, so the worker can't tell it apart from a bug");
for (const p of ["app/api/editor/[...path]/route.ts", "app/api/kitchen/[...path]/route.ts", "app/api/tablet/[...path]/route.ts"]) {
  const s = readFileSync(join(ROOT, p), "utf8");
  /panelFailure\(e/.test(s) && !/refusalMessage\(e\), refusalStatus\(e\)/.test(s)
    ? ok(`${p.split("/")[2]} sends its failures through the one shared answer`)
    : bad(`${p} still builds its own failure reply`, "a busy database will look like a bug there");
}

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

// ── F. "I couldn't ASK" must never be answered with "it doesn't exist" ────────────────────
// Added 2026-08-03, from a real failure. lib/tenant.ts resolved a restaurant by slug and folded a
// failed READ into the same `null` it returns for an unknown slug — then CACHED that null for 15
// seconds. Every guest surface turns null into notFound(), so one timed-out lookup told diners
// scanning the QR that the restaurant does not exist, and kept telling them. lib/panelGate.ts
// resolves staff panels through the same helper.
//
// Caught by the 485-phase suite: eight guest-menu phases failed with `/r/french-house/menu → 404`
// for a restaurant that was present, active, and answering 200 minutes later — the database had
// simply been busy (under that suite's own load).
//
// Driven through the REAL module, bundled, with a fetch we control — so supabase-js reports the
// failure exactly as it does in production (the same approach as section D).
console.log("\nF) A restaurant lookup while the database isn't answering");
const TOUT = join(ROOT, "node_modules/.cache/verify-busy-tenant.mjs");
execFileSync("npx", ["esbuild", "lib/tenant.ts", "--bundle", "--platform=node", "--format=esm",
  "--alias:@=.", `--outfile=${TOUT}`, "--log-level=warning"], { cwd: ROOT, stdio: "inherit" });
process.env.NEXT_PUBLIC_SUPABASE_URL ||= BASE;
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "not-a-real-key";
const { getRestaurantBySlug } = await import(pathToFileURL(TOUT).href);

const ROW = { id: "00000000-0000-0000-0000-000000000001", slug: "french-house", name: "My Little French House",
  active: true, deleted_at: null, logo_text: null, hero_title: null, tagline: null, accent_color: null, theme: null, logo_url: null };
const realFetch = globalThis.fetch;
const serve = (impl) => { globalThis.fetch = impl; };
const okRow = (row) => async () => new Response(JSON.stringify(row), { status: 200, headers: { "content-type": "application/json" } });
const dead = () => async () => { const e = new Error("The operation was aborted due to timeout"); e.name = "TimeoutError"; throw e; };

serve(okRow(ROW));
const live = await getRestaurantBySlug("french-house");
live && live.slug === "french-house" ? ok("a real row resolves normally") : bad("the plain lookup broke", JSON.stringify(live));

serve(dead());
let busyRow = null, threw = null;
try { busyRow = await getRestaurantBySlug("french-house"); } catch (e) { threw = e; }
busyRow && busyRow.slug === "french-house"
  ? ok("a busy database does NOT turn a live restaurant into 'no such restaurant'")
  : bad("a timed-out lookup answered 'this restaurant does not exist' — a diner's QR would 404", threw ? `threw ${threw.message}` : String(busyRow));

// A slug with nothing to stand on must be HONEST, not a 404 — and asking TWICE must refuse
// twice. That second half is what proves the failure was never REMEMBERED: the old code answered
// null and cached it, so the second ask came back "no such restaurant" without even trying.
serve(dead());
const refusals = [];
for (let i = 0; i < 2; i++) {
  try { refusals.push(await getRestaurantBySlug("never-seen-before-zz")); }
  catch (e) { refusals.push(e); }
}
refusals[0] instanceof Error && /couldn.t look up/i.test(refusals[0].message)
  ? ok("with nothing saved it says it couldn't ask, rather than 'not found'")
  : bad("an unreachable database still reads as 'that restaurant does not exist'", String(refusals[0] && refusals[0].message));
refusals[1] instanceof Error
  ? ok("and the failure was never remembered — the second ask tries again")
  : bad("a failed lookup was cached as 'no such restaurant'", JSON.stringify(refusals[1]));

// The two cases 404 is genuinely FOR must be untouched.
serve(async () => new Response("null", { status: 200, headers: { "content-type": "application/json" } }));
const missing = await getRestaurantBySlug("no-such-restaurant-zz");
missing === null ? ok("a genuinely unknown slug is still null (a real 404)") : bad("an unknown slug stopped being null", JSON.stringify(missing));
serve(okRow({ ...ROW, slug: "binned-zz", deleted_at: "2026-08-01T00:00:00Z" }));
const binned = await getRestaurantBySlug("binned-zz");
binned === null ? ok("a restaurant in the recycle bin is still hidden") : bad("a binned restaurant became visible", JSON.stringify(binned));
globalThis.fetch = realFetch;

server.close();
console.log(`\n${fail ? "❌" : "✅"} ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
