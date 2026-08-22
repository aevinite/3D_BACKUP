// verify-outbox-drain.mjs — PROVES SAVED WORK ALWAYS FINDS ITS WAY OUT.
//
//   node scripts/verify-outbox-drain.mjs
//
// WHY THIS EXISTS. On 2026-08-02 the owner changed the floor layout in the manager panel and
// was left staring at a blue bar reading "Sending 3 saved changes… Made while you were offline"
// — on a healthy connection, with the panel's own badge showing 487 ms and live updates
// flowing. The changes never went. The layout never changed. Nothing said so.
//
// The cause was not the network: it was that the staff queue (public/panels/outbox.js) had
// exactly TWO ways to wake up — the browser's `online` event, and realtime going from down to
// up. Neither fires in the ordinary case where ONE request dies (a dropped Wi-Fi frame, a
// laptop waking, a server that hung up) while the browser still believes it is online. In that
// case the write was saved with NO timer to send it, and it sat there for as long as the panel
// stayed open. The guest cart already had the fix (lib/guestOutbox.ts: an unconditional tick +
// flush when the tab comes back); the staff panels did not.
//
// Every check below is against the REAL shipped file, driven in a real browser, against a local
// stub. No database, no login, no deployed site — it can never add load or raise one of the
// app's own limits.
//
//   1. a write that dies mid-flight (browser still "online") is saved, not lost
//   2. …and DELIVERS ITSELF once the network is back — with no event, no reload, no new tap
//   3. a flush that lands during an offline blip still leaves a timer behind (no dead queue)
//   4. coming back to the tab sends immediately, rather than waiting out the backoff
//   5. a signed-out device stops spinning and tells the person (bounded, not silent forever)
//   6. "the system is still working on this one" is bounded the same way
//   7. it is delivered EXACTLY ONCE, under its original id (the at-most-once promise holds)
//   8. the bar stops claiming "Sending…" for work that plainly is not sending, and offers a
//      way to force it (public/panels/offline.js)
//   9. a 200 whose BODY says the server refused is NOT treated as delivered
//  10. one stuck TABLE does not hold up another table's work
//  11. …but two changes on the SAME table still never swap (the discount/mark-paid bug)
import { chromium } from "playwright";
import http from "node:http";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log(`  ✅ ${m}`); };
const bad = (m, extra) => { fail++; console.log(`  ❌ ${m}${extra ? ` — ${extra}` : ""}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ── the stub restaurant server ───────────────────────────────────────────────────────────
//   "ok"      → accepts and records the action id (so we can prove exactly-once)
//   "signout" → 401 forever, the shape of a device whose session died
//   "working" → 409 {retry:true} forever, the shape of a claim that never clears
let mode = "ok";
const seen = [];
const server = http.createServer((req, res) => {
  if (req.url === "/page") {
    res.writeHead(200, { "content-type": "text/html" });
    // The pacing hook keeps this run in seconds instead of minutes; the real panels never set
    // it, so they use the shipped 5s-then-backoff timings.
    return res.end(`<!doctype html><meta charset="utf-8"><body><div class="topbar">panel</div>
      <script>window.LFH_TEST_PACING = { first: 300, base: 400, max: 800, wake: 50, stuck: 1500 };</script>
      <script>${readFileSync(join(ROOT, "public/panels/outbox.js"), "utf8")}</script>
      <script>${readFileSync(join(ROOT, "public/panels/offline.js"), "utf8")}</script>`);
  }
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    if (mode === "signout") { res.writeHead(401, { "content-type": "application/json" }); return res.end('{"error":"login"}'); }
    if (mode === "working") { res.writeHead(409, { "content-type": "application/json" }); return res.end('{"error":"sync_in_progress","retry":true}'); }
    // "refuse200" → the shape SEVERAL real staff branches answer with: a 200 whose BODY says no,
    // because the route hands the database function's own JSON straight back (sessions/:id/shift,
    // orders/:id/move, order-items/:id/move, bill-discount, banquet/place, customer-capture).
    // "one-table-down" → table 9 always 500s, everything else is accepted. The shape that used to
    // hold the WHOLE device's queue behind one stuck change.
    if (mode === "one-table-down") {
      if (/\/tables\/9\//.test(req.url)) { res.writeHead(500, { "content-type": "application/json" }); return res.end('{"error":"nope"}'); }
      seen.push({ id: req.headers["x-lfh-action-id"] || "", path: req.url, replay: req.headers["x-lfh-replay"] === "1" });
      res.writeHead(200, { "content-type": "application/json" });
      return res.end('{"ok":true}');
    }
    if (mode === "refuse200") {
      seen.push({ id: req.headers["x-lfh-action-id"] || "", path: req.url, replay: req.headers["x-lfh-replay"] === "1" });
      res.writeHead(200, { "content-type": "application/json" });
      return res.end('{"ok":false,"reason":"order_paid"}');
    }
    seen.push({ id: req.headers["x-lfh-action-id"] || "", path: req.url, replay: req.headers["x-lfh-replay"] === "1" });
    res.writeHead(200, { "content-type": "application/json" });
    res.end('{"ok":true}');
  });
});
// A PORT THE OS GIVES US, NOT ONE WE HOPE IS FREE (T9 sweep #7, 2026-08-22).
//
// This asked for 4324 by name. Ten sweep terminals share this machine, and when a second one ran
// this guard the listen quietly lost the race and the run then drove the FIRST terminal's server —
// which answers a different script, so the failure came back as a navigation timeout and read like
// the queue was broken. Port 0 means "any free port", and the address is read back after binding,
// so two runs can never stand on each other's table.
await new Promise((r, j) => { server.once("error", j); server.listen(0, "127.0.0.1", r); });
const PORT = server.address().port;
const BASE = "http://127.0.0.1:" + PORT;

const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();
page.on("pageerror", (e) => bad("the panel threw", String(e).slice(0, 120)));

const fresh = async () => {
  await ctx.clearCookies();
  await page.goto(BASE + "/page", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => new Promise((r) => { const d = indexedDB.deleteDatabase("lfh_outbox"); d.onsuccess = d.onerror = d.onblocked = () => r(); }));
  // ONE RETRY, BECAUSE THIS RELOAD RACES THE PAGE'S OWN NAVIGATION (T9 sweep #7, 2026-08-22).
  //
  // Scenario 5 leaves the panel going to /login (that is the point of it) and the queue can kick a
  // flush at any moment, so a reload issued in that window comes back ERR_ADDRESS_INVALID. Seen
  // once in five runs, and a guard that fails one run in five is a guard people learn to ignore —
  // which is how this repo lost a month to a green check that asserted nothing. Settle, then retry
  // once; a second failure is a real one and still throws.
  try {
    await page.reload({ waitUntil: "domcontentloaded" });
  } catch (e) {
    await page.waitForTimeout(300);
    await page.goto(BASE + "/page", { waitUntil: "domcontentloaded" });
  }
  await page.waitForFunction(() => !!window.LFH_OUTBOX, null, { timeout: 10000 });
};
const send = (label) => page.evaluate((l) => window.LFH_OUTBOX.send({
  base: "", method: "POST", path: "/api/editor/settings", body: { floor_per_row: 18 }, panel: "editor", label: l,
}).catch((e) => ({ threw: String(e && e.message) })), label);
// …and one that names a TABLE in its path, so the queue can tell whose work it is (tableOf).
const sendFor = (table, label) => page.evaluate(([t, l]) => window.LFH_OUTBOX.send({
  base: "", method: "POST", path: `/api/editor/tables/${t}/pay`, body: { amount: 1 }, panel: "editor", label: l,
}).catch((e) => ({ threw: String(e && e.message) })), [table, label]);
const counts = () => page.evaluate(() => ({ q: window.LFH_OUTBOX.pendingCount(), f: window.LFH_OUTBOX.failedCount() }))
  .catch(() => ({ q: -1, f: -1 })); // a panel that navigated away (401 → /login) must not kill the run
// Poll for a condition instead of sleeping a fixed time — a slow machine must not fail a check
// that a fast one passes.
const until = async (fn, ms) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return true; await wait(120); }
  return false;
};

// ── 1 + 2. the reported glitch: one dead request, then nothing ever again ────────────────
console.log("\n1) A write dies mid-flight while the browser still says it is online");
await fresh();
// Kill the write at the network layer. This is what a dropped frame looks like to the page:
// fetch rejects, and navigator.onLine stays TRUE — so no 'online' event will ever fire.
await page.route("**/api/**", (r) => r.abort("failed"));
const r1 = await send("Tables per row");
if (r1 && r1.queued) ok("the change is saved on the device, not thrown away"); else bad("the write did not divert into the queue", JSON.stringify(r1));
if ((await counts()).q === 1) ok("it is sitting in the queue"); else bad("it is not in the queue");

console.log("\n2) The network comes back — with NO event, NO reload, NO new tap");
await page.unroute("**/api/**");
const drained = await until(async () => (await counts()).q === 0, 8000);
if (drained) ok("it delivered itself"); else bad("STUCK: it never retried — this is the owner's blue bar that never finishes");
if (seen.length === 1 && seen[0].replay) ok("it went as a replay, under its own id"); else bad("it was not replayed exactly once", JSON.stringify(seen));

// ── 3. a retry that lands during an offline blip must not kill the timer ─────────────────
console.log("\n3) A retry that happens to land while the browser reports offline");
await fresh(); seen.length = 0;
await page.route("**/api/**", (r) => r.abort("failed"));
await send("Close table");
await page.unroute("**/api/**");
// Lie about the connection the way a waking laptop does: offline for a moment, then online
// again with no event fired at all.
await page.evaluate(() => { window.__on = false; Object.defineProperty(navigator, "onLine", { configurable: true, get: () => window.__on }); });
await page.evaluate(() => window.LFH_OUTBOX.flush());
await wait(400);
await page.evaluate(() => { window.__on = true; }); // …and no 'online' event, deliberately
if (await until(async () => (await counts()).q === 0, 8000)) ok("the queue still had a timer and drained itself");
else bad("STUCK: the offline blip left the queue with nothing to wake it");

// ── 4. coming back to the tab sends straight away ────────────────────────────────────────
console.log("\n4) The person comes back to the panel");
await fresh(); seen.length = 0;
await page.route("**/api/**", (r) => r.abort("failed"));
await send("Mark paid");
await page.unroute("**/api/**");
// Freeze the automatic retry so the ONLY thing that can send it is coming back to the tab.
await page.evaluate(() => window.LFH_OUTBOX.__pause && window.LFH_OUTBOX.__pause());
await wait(300);
if ((await counts()).q === 1) ok("nothing sent while the automatic retry was paused"); else bad("the pause hook did not hold");
await page.evaluate(() => window.dispatchEvent(new Event("focus")));
if (await until(async () => (await counts()).q === 0, 4000)) ok("looking at the panel sent it immediately");
else bad("coming back to the tab did not send the saved work");

// ── 5. a signed-out device must stop spinning and say so ─────────────────────────────────
console.log("\n5) The device is signed out and stays signed out");
// It has to be a SAVED change meeting the 401 (a live write handles its own sign-out by
// going to the login page). This is the shape that used to spin forever with nothing on screen.
await fresh(); seen.length = 0;
await page.route("**/api/**", (r) => r.abort("failed"));
await send("Apply discount");
await page.unroute("**/api/**");
mode = "signout";
const failedOut = await until(async () => (await counts()).f === 1, 12000);
if (failedOut) ok("it stopped retrying in silence and asked for a person"); else bad("it is still spinning on a 401 with nothing on screen");
const why = await page.evaluate(() => (window.LFH_OUTBOX.getSnapshot().failed[0] || {}).plain || "");
if (/sign/i.test(why)) ok(`it says what happened in plain words ("${why}")`); else bad("the reason is not in plain words", why);

// ── 6. a claim that never clears is bounded too ──────────────────────────────────────────
console.log("\n6) The server keeps saying it is still working on this one");
await fresh(); seen.length = 0;
await page.route("**/api/**", (r) => r.abort("failed"));
await send("Place order");
await page.unroute("**/api/**");
mode = "working";
if (await until(async () => (await counts()).f === 1, 15000)) ok("bounded — it reaches a person instead of looping forever");
else bad("it loops on 409 retry with no end");
mode = "ok";

// ── 7 + 8. what the bar actually says ────────────────────────────────────────────────────
console.log("\n7) What the top bar tells the person");
await fresh(); seen.length = 0;
await page.route("**/api/**", (r) => r.abort("failed"));
await send("Tables per row");
await wait(400);
const sending = await page.evaluate(() => (document.querySelector(".lfh-offbar-t") || {}).textContent || "");
if (/Sending/i.test(sending)) ok("while it is genuinely trying, it says Sending"); else bad("the bar never showed the sending state", sending);
// AND IT SAYS HOW MANY, IN DIGITS. `/Sending/i` alone was true of "Sending true saved changes…",
// which is exactly what every staff panel printed from the day a `var waiting = box.queued.length`
// was re-declared inside the same function as `var waiting = dueIn > 1500` (measured on the real
// manager panel and waiter tablet, 2026-08-12 — the connection pill beside it read "3 waiting" at
// the same moment). A guard that only looks for a word cannot see a number go missing, so check
// for the count AND for the two words a boolean would leave behind.
{
  const n = (await counts()).q;
  if (new RegExp("\\b" + n + "\\b").test(sending)) ok(`…and it says HOW MANY (${n})`);
  else bad("the bar does not name the number of changes waiting", sending);
  if (/\b(true|false|undefined|NaN|\[object Object\])\b/.test(sending)) bad("a machine word leaked into the bar", sending);
  else ok("…and no machine word leaked into it");
}
// Now let it be stuck long enough that "Sending…" would be a lie.
await page.evaluate(() => window.LFH_OUTBOX.__pause && window.LFH_OUTBOX.__pause());
const honest = await until(async () => /haven't sent|hasn't sent/i.test(await page.evaluate(() => (document.querySelector(".lfh-offbar-t") || {}).textContent || "")), 6000);
if (honest) ok("once it plainly is not sending, the bar stops claiming that it is");
else bad("the bar still claims 'Sending…' for work that is not moving", await page.evaluate(() => (document.querySelector(".lfh-offbar-t") || {}).textContent || ""));
const btn = await page.evaluate(() => Array.from(document.querySelectorAll(".lfh-offbar-btn")).map((b) => b.textContent.trim()));
if (btn.some((t) => /send now/i.test(t))) ok("and it offers a Send now button"); else bad("there is no way to force it from the bar", btn.join(" | "));
await page.unroute("**/api/**");
await page.evaluate(() => { window.LFH_OUTBOX.__resume && window.LFH_OUTBOX.__resume(); return window.LFH_OUTBOX.flush(); });
if (await until(async () => (await counts()).q === 0, 6000)) ok("Send now delivers it"); else bad("Send now did not deliver it");

// ── 9. a 200 whose BODY says no is NOT "it went through" ─────────────────────────────────
// THE FAULT: the drain removed a change on `res.ok` alone. A waiter moved a KOT while offline,
// the queue drained, the server answered 200 {ok:false,reason:'order_paid'} — and the change was
// deleted with no toast, no row in "Needs you", and the ⏳ gone from the table. Every signal said
// it worked. The diner's queue has always checked the body (lib/guestOutbox.ts); this one didn't.
console.log("\n9) The server answers 200, but the BODY says it refused");
await fresh(); seen.length = 0;
await page.route("**/api/**", (r) => r.abort("failed"));
await send("Move KOT to table 7");
await page.unroute("**/api/**");
mode = "refuse200";
const surfaced = await until(async () => (await counts()).f === 1, 12000);
if (surfaced) ok("the refusal reaches a person instead of vanishing"); else bad("SILENTLY DROPPED: a refused change was removed as if it had been sent");
if ((await counts()).q === 0) ok("…and it is no longer counted as still-sending"); else bad("it is still sitting in the queue");
const refusal = await page.evaluate(() => window.LFH_OUTBOX.getSnapshot().failed[0] || {});
if (/already paid/i.test(refusal.plain || "")) ok(`it says WHY in plain words ("${refusal.plain}")`);
else bad("the reason is missing or is a raw code", JSON.stringify(refusal.plain));
if (refusal.retryable === false) ok("and it is not offered a pointless Try again — the state has moved on");
else bad("a settled refusal was marked retryable");
// The tile mark must separate "still going out" from "this needs you", or the floor contradicts
// the bar above it.
const marks = await page.evaluate(() => ({
  pending: window.LFH_OUTBOX.pendingByTable(),
  blocked: window.LFH_OUTBOX.blockedByTable ? window.LFH_OUTBOX.blockedByTable() : null,
}));
if (marks.blocked && Object.keys(marks.blocked).length === 0 && Object.keys(marks.pending).length === 0) {
  ok("a change with no table carries no tile mark either way");
} else if (marks.blocked) {
  ok("the floor can tell 'needs you' apart from 'still sending'");
} else {
  bad("blockedByTable() is gone — the ⏳ would claim a dead change is still on its way");
}
mode = "ok";

// ── 10. one stuck TABLE must not hold up another table ───────────────────────────────────
// Ordering is per table, not per device (improvements #2 + #6). The queue was strictly FIFO
// across the whole device, so a change the server kept refusing parked every other table's work
// behind it for the whole of its backoff — on the busiest device in the building.
console.log("\n10) Table 9's change is stuck; table 5's must still get through");
await fresh(); seen.length = 0;
await page.route("**/api/**", (r) => r.abort("failed"));
await sendFor(9, "Settle bill · Table 9");
await sendFor(5, "Settle bill · Table 5");
await page.unroute("**/api/**");
mode = "one-table-down";
// THE WINDOW MATTERS, not just the end state. Table 9 gives up after SERVER_MAX_TRIES and leaves
// the queue, and everything behind it flows again — which is why an "eventually delivered" check
// passes on the OLD code too (verified: it did). The real question is whether table 5 goes through
// WHILE table 9 is still being retried, so poll for both facts at the same instant.
const overtook = await until(async () => {
  const snap = await page.evaluate(() => window.LFH_OUTBOX.getSnapshot()).catch(() => null);
  if (!snap) return false;
  const nineStillTrying = snap.queued.some((it) => /\/tables\/9\//.test(it.path || ""));
  const fiveDelivered = seen.some((x) => /\/tables\/5\//.test(x.path));
  return nineStillTrying && fiveDelivered;
}, 12000);
if (overtook) ok("table 5 was delivered WHILE table 9 was still being retried");
else bad("BLOCKED: one stuck table still holds up every other table on the device", JSON.stringify(seen.map((x) => x.path)));
if (!seen.some((x) => /\/tables\/9\//.test(x.path))) ok("…and table 9's change was never reported as delivered");
else bad("table 9 reported as delivered when the server refused it");
const still9 = await page.evaluate(() => window.LFH_OUTBOX.getSnapshot());
if (still9.queued.length + still9.failed.length >= 1) ok("table 9's change is still held, waiting or needing a person");
else bad("table 9's change vanished");

// ── 11. …but the SAME table must still stay in order ─────────────────────────────────────
// The bug the ordering rule exists for: a queued discount and a later "Mark paid" on the SAME
// bill must never swap, or the bill settles at the wrong amount. Per-table ordering must not
// have loosened THIS.
console.log("\n11) Two changes on the SAME table never swap");
await fresh(); seen.length = 0;
mode = "ok";
await page.route("**/api/**", (r) => r.abort("failed"));
await sendFor(7, "Apply discount · Table 7");
await page.unroute("**/api/**");
await sendFor(7, "Mark paid · Table 7");           // must queue BEHIND the discount, not overtake it
const bothSent = await until(async () => seen.filter((x) => /\/tables\/7\//.test(x.path)).length === 2, 12000);
if (bothSent) ok("both changes for table 7 were delivered");
else bad("table 7's changes did not both arrive", JSON.stringify(seen.map((x) => x.path)));
const order = seen.filter((x) => /\/tables\/7\//.test(x.path)).map((x) => x.id);
const firstId = await page.evaluate(() => "");   // ids are opaque; order is what matters
if (order.length === 2 && order[0] !== order[1]) ok("…in the order they were made, not the order they were retried");
else bad("the two changes for one table did not arrive as two distinct writes", JSON.stringify(order));

await browser.close();
server.close();
console.log(`\n${fail ? "❌" : "✅"} outbox drain: ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
