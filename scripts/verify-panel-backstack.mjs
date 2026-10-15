// verify-panel-backstack.mjs — PROVES THE PHONE'S BACK BUTTON CLOSES THE TOP CARD, AND NEVER THE PANEL.
//
//   npm run verify:panel-backstack
//
// public/panels/backstack.js keeps one history entry per open overlay, so the hardware Back button
// closes the top drawer / card instead of leaving the panel. Its count of those entries has to stay
// EXACT, because the panel runs inside an iframe (components/PanelFrame.tsx) whose history is the
// page's history: one rewind too many and Back takes the whole window off /tablet or /manager.
//
// WHY THIS EXISTS (sweep #10 T16, 2026-10-12, reported by the T12 waiter-tablet sweep). history.go()
// is asynchronous, and a card that closed with the next one opening straight after — the waiter
// tablet's ↩ Mark unpaid → Yes → reason card — pushed the new entry before the old rewind had
// landed. The count ended one too high, and Cancel on the reason card took the page back out of the
// panel. Driven against the real file with the second card opened a microtask, and a 0 ms timeout,
// after the first closed: the page left every time. The fix waits for the rewind to land before
// stacking on it.
//
// Runs the REAL shipped file in a real browser against a tiny local server of its own. No app, no
// database, no login — it can never add load or set off one of the app's own limits.
import { chromium } from "playwright";
import http from "node:http";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
// Coverage for sweep #10 T16 round 2 (scripts/sweep/t16s10/cov.mjs) — a no-op unless T16_COV is set.
import { covStart, covStop } from "./sweep/t16s10/cov.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log(`  ✅ ${m}`); };
const bad = (m, extra) => { fail++; console.log(`  ❌ ${m}${extra ? ` — ${extra}` : ""}`); };

const server = http.createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/html" });
  if (req.url === "/start") return res.end("<!doctype html><title>start</title>the page before the panel");
  if (req.url === "/outer") return res.end('<!doctype html><title>outer</title><iframe id="f" src="/panel" style="width:400px;height:300px"></iframe>');
  return res.end(`<!doctype html><meta charset="utf-8"><title>panel</title><script>${readFileSync(join(ROOT, "public/panels/backstack.js"), "utf8")}</script>`);
});
await new Promise((r, j) => { server.once("error", j); server.listen(0, "127.0.0.1", r); });
const BASE = "http://127.0.0.1:" + server.address().port;
if (process.argv.some((a) => a === "--base" || a.startsWith("--base="))) console.log(`verify-panel-backstack: --base does not apply — this guard runs its own server on ${BASE}.`);

const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();
await covStart(page);
page.on("pageerror", (e) => bad("the panel threw", String(e).slice(0, 120)));
const onPanel = async () => { await page.goto(BASE + "/start"); await page.goto(BASE + "/panel"); await page.waitForFunction(() => !!window.LFH_BACK); };
const stillOnPanel = () => /\/panel$/.test(page.url());

console.log("\n1) One entry per overlay, and closing them by hand rewinds exactly");
await onPanel();
const r1 = await page.evaluate(async () => {
  const t = () => new Promise((ok) => setTimeout(ok, 80)), start = history.length, offs = [];
  for (let i = 0; i < 10; i++) offs.push(window.LFH_BACK.layer("l" + i, () => {}));
  await t(); const ten = history.length;
  offs.forEach((f) => f()); await t();
  return { added: ten - start, state: history.state };
});
if (r1.added === 10) ok("ten overlays added exactly ten history entries"); else bad("the entries did not match the overlays", JSON.stringify(r1));
if (r1.state === null) ok("closing all ten by hand left the panel on its own entry"); else bad("the rewind did not land on the panel's own entry", JSON.stringify(r1.state));

console.log("\n2) Back closes the TOP overlay only");
const closed = await page.evaluate(async () => {
  const t = () => new Promise((ok) => setTimeout(ok, 80)), seen = [];
  const a = window.LFH_BACK.layer("a", () => seen.push("a")); window.LFH_BACK.layer("b", () => seen.push("b"));
  await t(); history.back(); await t(); a(); await t();
  return seen;
});
if (closed.join() === "b") ok("Back closed the top card and left the one under it open"); else bad("Back closed the wrong card", closed.join());

// ── 3. the reported fault: close one, open the next straight after, close that ─────────────────
for (const gap of ["a microtask", "a 0 ms timeout", "50 ms"]) {
  console.log(`\n3) Close a card, open the next ${gap} later, then close that one`);
  await onPanel();
  const r = await page.evaluate(async (gap) => {
    const wait = () => (gap === "a microtask" ? Promise.resolve() : new Promise((ok) => setTimeout(ok, gap === "50 ms" ? 50 : 0)));
    const offA = window.LFH_BACK.layer("ask", () => {});
    await new Promise((ok) => setTimeout(ok, 100));
    offA(); await wait();
    const offB = window.LFH_BACK.layer("reason", () => {});
    await new Promise((ok) => setTimeout(ok, 200));
    offB(); await new Promise((ok) => setTimeout(ok, 400));
    return { path: location.pathname, state: history.state };
  }, gap).catch(() => null);
  await page.waitForTimeout(200);
  if (r && stillOnPanel()) ok("the panel is still on screen after the second card closed");
  else bad("closing the second card took the page OUT of the panel", page.url());
  if (r && r.state === null) ok("…and it is back on its own history entry, with nothing left over");
  else if (r) bad("a stray history entry was left behind", JSON.stringify(r.state));
  // …and the count is exact afterwards: one more card, one Back press, still on the panel.
  if (stillOnPanel()) {
    const after = await page.evaluate(async () => {
      let shut = false; window.LFH_BACK.layer("next", () => { shut = true; });
      await new Promise((ok) => setTimeout(ok, 100)); history.back(); await new Promise((ok) => setTimeout(ok, 300));
      return shut;
    }).catch(() => false);
    await page.waitForTimeout(150);
    if (after && stillOnPanel()) ok("the next card's Back press closes that card and keeps the panel");
    else bad("the count drifted: Back on the next card left the panel", page.url());
  }
}

console.log("\n4) The same sequence inside an IFRAME — the way /tablet and /manager really host a panel");
await page.goto(BASE + "/start"); await page.goto(BASE + "/outer");
const frame = page.frames().find((f) => /\/panel$/.test(f.url()));
await frame.waitForFunction(() => !!window.LFH_BACK);
await frame.evaluate(async () => {
  const offA = window.LFH_BACK.layer("ask", () => {}); await new Promise((ok) => setTimeout(ok, 100));
  offA(); await Promise.resolve();
  const offB = window.LFH_BACK.layer("reason", () => {}); await new Promise((ok) => setTimeout(ok, 200));
  offB(); await new Promise((ok) => setTimeout(ok, 400));
}).catch(() => {});
await page.waitForTimeout(200);
if (/\/outer$/.test(page.url())) ok("the page hosting the panel did not go back"); else bad("the whole window left the panel's page", page.url());

console.log("\n5) Back with nothing open still leaves the panel — deliberately, staff hop panels that way");
await onPanel();
await page.goBack();
if (/\/start$/.test(page.url())) ok("an empty stack lets Back leave, as designed"); else bad("Back with nothing open did not leave", page.url());

await covStop(page);
await browser.close();
server.close();
console.log(`\n${fail ? "❌" : "✅"} panel back button: ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
