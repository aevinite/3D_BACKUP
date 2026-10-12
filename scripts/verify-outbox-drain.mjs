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
let profileBusyLeft = 0;   // section 14: how many more profile reads answer 503
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
  // THE PROFILE DRAWER'S PAGE (section 12): the queue AND the shared profile helper that lives in
  // maint.js, which is the caller that named no base. The boot read answers "not a staff member",
  // so maint.js builds nothing and only its two shared helpers are on the page.
  if (req.url === "/page-profile") {
    res.writeHead(200, { "content-type": "text/html" });
    return res.end(`<!doctype html><meta charset="utf-8"><body><div class="topbar"><div class="top-actions"></div></div>
      <script>window.LFH_TEST_PACING = { first: 300, base: 400, max: 800, wake: 50, stuck: 1500 };</script>
      <script>${readFileSync(join(ROOT, "public/panels/maint.js"), "utf8")}</script>
      <script>${readFileSync(join(ROOT, "public/panels/outbox.js"), "utf8")}</script>`);
  }
  // THE BUSY-BOOT PAGE (section 14): the drawer, the queue and the profile screen, booted while the
  // profile read answers 503 — the shape of a database too busy to answer for the first moments.
  if (req.url === "/page-boot") {
    res.writeHead(200, { "content-type": "text/html" });
    return res.end(`<!doctype html><meta charset="utf-8"><body><div class="topbar"><div class="top-actions"><button id="myProfileBtn" hidden>me</button></div></div>
      <script>window.LFH_TEST_PACING = { first: 300, base: 400, max: 800, wake: 50, stuck: 1500, boot: 400 };</script>
      <script>${readFileSync(join(ROOT, "public/panels/backstack.js"), "utf8")}</script>
      <script>${readFileSync(join(ROOT, "public/panels/maint.js"), "utf8")}</script>
      <script>${readFileSync(join(ROOT, "public/panels/outbox.js"), "utf8")}</script>
      <script>${readFileSync(join(ROOT, "public/panels/myprofile.js"), "utf8")}</script>`);
  }
  if (req.method === "GET" && req.url === "/api/panel-profile") {
    if (mode === "profile-busy" && profileBusyLeft > 0) {
      profileBusyLeft--;
      res.writeHead(503, { "content-type": "application/json" });
      return res.end('{"error":"Server can\'t reach the database — retrying."}');
    }
    res.writeHead(200, { "content-type": "application/json" });
    if (mode === "profile-busy") return res.end(JSON.stringify({ staff: true, id: "u1", username: "diagm1", role: "manager", name: "Diag", phone: "9", needsProfile: false, profileModule: true, profile: {}, completeness: { filled: 1, total: 8 }, job: {} }));
    return res.end('{"staff":false}');
  }
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    // "discount-down" (section 13) → table 5's DISCOUNT always answers 503; everything else is
    // accepted and recorded. The shape of one route failing while the rest of the server is fine.
    if (mode === "discount-down") {
      if (/\/tables\/5\/discount/.test(req.url)) { res.writeHead(503, { "content-type": "application/json" }); return res.end('{"error":"busy"}'); }
      seen.push({ id: req.headers["x-lfh-action-id"] || "", path: req.url, replay: req.headers["x-lfh-replay"] === "1" });
      res.writeHead(200, { "content-type": "application/json" });
      return res.end('{"ok":true}');
    }
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

// A --base HANDED TO THIS GUARD IS NOT THE APP'S ADDRESS, AND SAYING SO BEATS SWALLOWING IT
// (T28, sweep #7, 2026-08-30). This guard stands up its OWN tiny server on the port below and
// drives a page there — the real app is never involved, which is exactly why it can run with
// nothing else up. That is fine, and deliberate. What is not fine is accepting `--base
// http://localhost:4228` in silence: every sweep lane passes that flag to every guard, and a
// silent accept lets the lane record "I checked port 4228" when this guard never went near it.
// Found by pointing all 153 guards at a DEAD port and asking which still said "33 passed".
// `verify:panel-cache` already had the right answer — say it out loud — so this copies its manner.
if (process.argv.some((a) => a === "--base" || a.startsWith("--base="))) {
  console.log(`verify-outbox-drain: --base does not apply here — this guard runs its own server on ${BASE} and never touches the app. Running anyway; nothing about your --base was checked.`);
}


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
  } catch  {
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
   // ids are opaque; order is what matters
if (order.length === 2 && order[0] !== order[1]) ok("…in the order they were made, not the order they were retried");
else bad("the two changes for one table did not arrive as two distinct writes", JSON.stringify(order));

// ── 12. a save that names no base still reaches its own address ──────────────────────────
// Sweep #10 T16, 2026-10-12. maint.js's LFH_PROFILE_SAVE (the ⚙ drawer's Save details / Set PIN /
// first-login card, and "My profile & pay") called the queue with no `base`, and the queue built
// the address as base + path — "undefined/api/panel-profile", which the browser resolved against
// the panel's page into a 404. Driven here through the REAL helper on a page at the site root, so
// the broken address would have arrived as "/undefined/api/panel-profile".
console.log("\n12) A profile save goes to /api/panel-profile, not to an address with 'undefined' in it");
mode = "ok"; seen.length = 0;
await page.goto(BASE + "/page-profile", { waitUntil: "domcontentloaded" });
await page.evaluate(() => new Promise((r) => { const d = indexedDB.deleteDatabase("lfh_outbox"); d.onsuccess = d.onerror = d.onblocked = () => r(); }));
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForFunction(() => !!(window.LFH_OUTBOX && window.LFH_PROFILE_SAVE), null, { timeout: 10000 });
const prof = await page.evaluate(() => window.LFH_PROFILE_SAVE({ phone: "9000000000" }, { label: "save your phone number" })
  .then((r) => ({ ok: r.ok, queued: r.queued }), (e) => ({ threw: String(e && e.message) })));
const profPaths = seen.map((x) => x.path);
if (profPaths.length === 1 && profPaths[0] === "/api/panel-profile") ok("the drawer's save reached /api/panel-profile");
else bad("the drawer's save went somewhere else", JSON.stringify(profPaths));
if (prof && prof.ok && !prof.queued && !prof.threw) ok("…and the person is told it saved, because it did");
else bad("the save did not come back as saved", JSON.stringify(prof));
if (!profPaths.some((p) => /undefined/.test(p))) ok("no request carried the word 'undefined' in its address");
else bad("an address was built from a missing base", JSON.stringify(profPaths));
// …and the queue's own default, for a change already saved on a device in the old shape.
seen.length = 0;
await page.evaluate(() => window.LFH_OUTBOX.send({ method: "POST", path: "/api/panel-profile", body: { phone: "1" }, label: "an old-shape save" }).catch(() => null));
if (seen.length === 1 && seen[0].path === "/api/panel-profile") ok("the queue sends a base-less change to its own path");
else bad("the queue still builds 'undefined' + path", JSON.stringify(seen.map((x) => x.path)));

// ── 13. a change that runs out of tries IN THIS ROUND still holds the next one on its table ──
// Sweep #10 T16, 2026-10-12. Section 11 proves the order holds while both changes are still trying,
// and the start of every round stalls a table that is already owed something in `failed`. What was
// not covered: the round in which a change GIVES UP. The discount moved to "Needs you" and the walk
// carried straight on to the settle for the same table — so the bill went out at full price while
// the discount sat there with a Try again button that would land on an already-settled bill.
console.log("\n13) A discount that gives up mid-round still holds the settle behind it");
await fresh(); seen.length = 0;
mode = "discount-down";
await page.evaluate(() => window.LFH_OUTBOX.__pause());
const hold = await page.evaluate(async () => {
  const O = window.LFH_OUTBOX;
  const a = await O.send({ base: "", method: "POST", path: "/api/editor/tables/5/discount", body: { pct: 10 }, panel: "editor" });
  const b = await O.send({ base: "", method: "POST", path: "/api/editor/tables/5/pay", body: {}, panel: "editor" });
  // One round at a time: a round kicked by send() may still be running, and flush() returns at once
  // while one is. Wait it out, then start the next — until the discount gives up (6 tries) or 40 goes.
  for (let i = 0; i < 40 && !O.getSnapshot().failed.length; i++) {
    while (O.isFlushing()) await new Promise((r) => setTimeout(r, 15));
    await O.flush();
  }
  while (O.isFlushing()) await new Promise((r) => setTimeout(r, 15));
  const s = O.getSnapshot();
  return { a: a.why, b: b.why, queued: s.queued.map((x) => x.path), failed: s.failed.map((x) => ({ p: x.path, r: x.retryable })) };
});
if (hold.a === "busy" && hold.b === "behind") ok("the settle was queued behind the busy discount");
else bad("the setup did not queue as expected", JSON.stringify(hold));
if (hold.failed.some((f) => /\/5\/discount/.test(f.p) && f.r !== false)) ok("the discount ran out of tries and is waiting for a person, with Try again");
else bad("the discount did not reach Needs you", JSON.stringify(hold.failed));
if (!seen.some((x) => /\/tables\/5\/pay/.test(x.path))) ok("the settle for table 5 was NOT sent while its discount needs a person");
else bad("the settle went out at full price the moment the discount gave up", JSON.stringify(seen.map((x) => x.path)));
if (hold.queued.some((p) => /\/5\/pay/.test(p))) ok("…it is still waiting, behind the discount");
else bad("the settle is not in the queue any more", JSON.stringify(hold));
// …and it is released by the person's own choice, exactly as section 11's rule promises.
mode = "ok";
await page.evaluate(() => { const O = window.LFH_OUTBOX; const f = O.getSnapshot().failed[0]; return f ? O.retryOne(f.id) : null; });
const released = await until(async () => seen.filter((x) => /\/tables\/5\//.test(x.path)).length === 2, 6000);
const order5 = seen.filter((x) => /\/tables\/5\//.test(x.path)).map((x) => x.path.split("/").pop());
if (released && order5.join(",") === "discount,pay") ok("Try again sent the discount FIRST, then the settle");
else bad("after Try again the two did not go discount → settle", JSON.stringify(order5));
await page.evaluate(() => window.LFH_OUTBOX.__resume());

// ── 14. a busy moment at boot does not hide the Profile button, or claim you are not signed in ──
// Sweep #10 T16, 2026-10-12. The profile read answered 503 twice at boot (a database too busy to
// answer) and was healthy a second later. maint.js only ever asked again on the browser's `online`
// event — which never fires when the connection was fine — so the panel had no ⚙ Profile (and no Sign
// out) for the rest of the shift; and "My profile & pay" told a signed-in manager "You are not signed
// in as a staff member". Both now treat a failed read as "could not ask", never as an answer.
console.log("\n14) The profile read is busy at boot, then recovers");
mode = "profile-busy"; profileBusyLeft = 2;
await page.goto(BASE + "/page-boot", { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => !!(window.LFH_ME && window.LFH_PROFILE_GET), null, { timeout: 10000 });
await wait(150);
const bootSaid = await page.evaluate(async () => { await window.LFH_ME.open(); return document.getElementById("meBody").innerText; });
if (!/not signed in/i.test(bootSaid)) ok("a busy read does not tell a signed-in manager they are not signed in");
else bad("a busy read was reported as 'not signed in'", bootSaid.slice(0, 120));
if (/Couldn't load your profile just now/.test(bootSaid)) ok(`…it says what happened and offers Try again ("${bootSaid.split("\n")[0]}")`);
else bad("the failed read did not say what happened", bootSaid.slice(0, 120));
await page.evaluate(() => window.LFH_ME.close());
const backBy = await until(async () => page.evaluate(() => !!document.getElementById("staffSettingsBtn")), 8000);
if (backBy) ok("the ⚙ Profile button (with Sign out) came back by itself once the server answered");
else bad("the Profile button never came back after a busy boot — no Sign out for the rest of the shift");
const mine = await until(async () => page.evaluate(() => { const b = document.getElementById("myProfileBtn"); return b && !b.hidden; }), 8000);
if (mine) ok("…and so did 'My profile & pay'");
else bad("'My profile & pay' stayed hidden after a busy boot");
mode = "ok";

await browser.close();
server.close();
console.log(`\n${fail ? "❌" : "✅"} outbox drain: ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
