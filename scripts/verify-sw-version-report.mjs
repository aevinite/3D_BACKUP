// verify-sw-version-report.mjs — CAN WE SEE WHICH OFFLINE LAYER A STAFF DEVICE IS RUNNING?
//
//   node scripts/verify-sw-version-report.mjs --base http://localhost:4204
//   npm run verify:sw-version -- --base http://localhost:4204
//
// WHY THIS EXISTS (owner asked for it, 2026-08-26; sweep #7 / T4 item 13).
//
// Every phone and tablet keeps its own saved copy of the app (public/sw.js) so staff can keep
// working with no internet. When a new copy ships, a device that has not picked it up keeps the
// OLD one — and until mig 366 nothing anywhere could see that. A tablet quietly a version behind
// can behave differently from the one next to it, and the only way to find out was for somebody
// to notice odd behaviour mid-service.
//
// THE CHAIN HAS FOUR LINKS AND A BREAK IN ANY ONE IS INVISIBLE:
//
//   1. the worker stamps X-LFH-SW on reads it is ALREADY making   (public/sw.js, withVersion)
//   2. the server validates it and writes it on the heartbeat     (lib/userAuth.ts)
//   3. the admin health read reports current vs behind            (app/api/admin/health)
//   4. the screen says it in words a person can act on            (app/aevinite/health)
//
// Link 1 failing looks exactly like "every device is up to date", because a device that reports
// nothing is counted as "hasn't said", never as behind. That is the right way round — inventing an
// alarm is worse — but it means a silent break here reads as good news. So this drives the real
// chain rather than reading it.
//
// It writes NOTHING of its own: it signs in once as the shared manager fixture (the cached login,
// per the rate-limit rule) and reads. The only row that changes is that user's own heartbeat, which
// every normal request already updates.
import { chromium } from "playwright";
import { loginAs, adminCookie, adminHeaders } from "./sweep/login.mjs";
import { requireUp } from "./sweep/appUp.mjs";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const BASE = (args[args.indexOf("--base") + 1] || "").replace(/\/$/, "");
if (!BASE || !args.includes("--base")) {
  console.log("\n--base <url> is required. This guard needs the app running:\n" +
    "  npm run build && npx next start --port 4204\n" +
    "  npm run verify:sw-version -- --base http://localhost:4204\n");
  process.exit(2);
}
// …and having a base is not the same as something answering on it (see appUp.mjs): a stopped
// server used to come back as a Playwright stack trace instead of one plain sentence.
await requireUp(BASE, "the offline-layer version chain");

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log(`  ✅ ${m}`); };
const bad = (m, why) => { fail++; console.log(`  ❌ ${m}${why ? `\n       ${why}` : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// What the shipped file DECLARES — the one number everything else is compared against.
const declared = (readFileSync(join(ROOT, "public/sw.js"), "utf8").match(/const VERSION = "(v\d{1,4})"/) || [])[1];

const run = async () => {
  const browser = await chromium.launch();
  try {
    declared
      ? ok(`public/sw.js declares a version (${declared})`)
      : bad("public/sw.js declares no VERSION", "nothing below can mean anything without it");

    // ── 1 · does the worker really stamp the header on a read it already makes? ────────────
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await loginAs(ctx, "manager", BASE);
    const page = await ctx.newPage();
    await page.goto(`${BASE}/manager`, { waitUntil: "networkidle" });
    const controlling = await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 25000 })
      .then(() => true).catch(() => false);
    controlling
      ? ok("a signed-in panel is controlled by the offline layer")
      : bad("the offline layer never took control of the panel", "nothing downstream can be evidence about a device's version");
    // Ask the worker itself, which is the only thing that knows for certain which copy is running.
    const running = await page.evaluate(() => new Promise((res) => {
      const t = setTimeout(() => res(null), 4000);
      navigator.serviceWorker.addEventListener("message", (e) => {
        if (e.data && e.data.type === "LFH_PONG") { clearTimeout(t); res(e.data.version || ""); }
      });
      navigator.serviceWorker.controller.postMessage({ type: "LFH_PING" });
    })).catch(() => null);
    running === declared
      ? ok(`the running worker is the shipped copy (${running})`)
      : bad("the running worker is not the shipped copy", `file says ${declared}, device is running ${running}`);
    // The worker only stamps requests it HANDLES, and it handles them once it controls the client.
    // A first load is served before that, so reload to get a controlled one.
    await page.reload({ waitUntil: "networkidle" });
    await sleep(2500);

    // WHY LINK 1 IS PROVED AT THE SERVER AND NOT IN THE BROWSER.
    //
    // A first version of this guard listened for the X-LFH-SW header on page.on("request") and
    // reported it missing on a chain that was working perfectly. Playwright surfaces the request
    // the PAGE made; the header is added inside the service worker, on the worker's own outgoing
    // fetch, which that listener does not show. So the browser is the wrong place to ask.
    //
    // The server's own record IS the proof, and it is a stronger one: the count below can only be
    // non-zero if the worker stamped the header (link 1), the server validated and wrote it
    // (link 2), and it came back on the admin read (link 3). One assertion, three links.

    // ── 2+3 · did the server record it, and does the admin read report it? ─────────────────
    // Give the throttled heartbeat a moment; a CHANGED version is written even inside the window.
    await sleep(1500);
    // The admin is a COOKIE, never a staff role — and never a POST to a login route (the
    // rate-limit rule). adminCookie() for a browser context, adminHeaders() for a bare request.
    const admin = await browser.newContext();
    await admin.addCookies([adminCookie(BASE)]);
    const health = await admin.request.get(`${BASE}/api/admin/health`, {
      headers: { ...adminHeaders(BASE), "cache-control": "no-store" },
    });
    const j = health.ok() ? await health.json() : null;
    if (!j) {
      bad("the admin health read did not answer", `HTTP ${health.status()}`);
    } else {
      const ol = j.offlineLayer;
      ol ? ok("the admin health read reports the offline layer") : bad("offlineLayer is missing from /api/admin/health", "link 3 is broken");
      if (ol) {
        ol.shipped === declared
          ? ok(`it knows which version is shipped (${ol.shipped})`)
          : bad("the server disagrees with the file about the shipped version", `file says ${declared}, server says ${ol.shipped}`);
        ol.current >= 1
          ? ok(`a real signed-in visit was recorded on the current version — links 1, 2 and 3 all hold (${ol.current} current, ${ol.behind} behind, ${ol.unknown} haven't said)`)
          : bad("no device was recorded on the current version after a real signed-in visit",
            `current=${ol.current} behind=${ol.behind} unknown=${ol.unknown}.\n       `
            + "One of: the worker did not stamp X-LFH-SW, the server rejected or ignored it, or the "
            + "admin read is not returning it. A break here reads as 'every device is up to date'.");
        // The reported version must be the SHIPPED one, not merely some version — otherwise this
        // whole check would pass while every device sat on an old copy.
        ol.behind === 0
          ? ok("no device used in the last day is on an older copy")
          : ok(`${ol.behind} device(s) are on an older copy — that is the figure this exists to surface`);
        // The counts must be internally honest: an unreported device is "hasn't said", NEVER behind.
        typeof ol.behind === "number" && ol.behind >= 0
          ? ok("a device that has not reported is counted as 'hasn't said', not as behind")
          : bad("the behind count is not a sane number", JSON.stringify(ol));
      }
    }

    // ── 4 · does the screen say it in words? ──────────────────────────────────────────────
    const ap = await admin.newPage();
    await ap.goto(`${BASE}/aevinite/health`, { waitUntil: "networkidle" });
    await sleep(2000);
    const shown = await ap.evaluate(() => {
      const rows = [...document.querySelectorAll("*")].filter((e) => e.children.length === 0 && /Offline layer/i.test(e.textContent || ""));
      if (!rows.length) return null;
      const row = rows[0].closest("div,li,tr") || rows[0].parentElement;
      return (row && row.textContent || "").replace(/\s+/g, " ").trim().slice(0, 200);
    });
    shown
      ? ok(`the System health screen shows it: "${shown}"`)
      : bad("no 'Offline layer' line on the admin System health screen", "link 4 is broken — the figure exists but nobody can see it");
    shown && !/undefined|NaN|\[object/.test(shown)
      ? ok("…and it reads as words, with no leaked code in it")
      : bad("the line contains leaked code", String(shown));
    await ap.close();
    await admin.close();
    await ctx.close();
  } catch (e) {
    bad("the run stopped early", e.stack || e.message);
  } finally {
    await browser.close().catch(() => {});
    console.log(`\n${fail === 0 ? "✅ PASS" : "❌ FAIL"} — ${pass} passed, ${fail} failed\n`);
    process.exit(fail === 0 ? 0 : 1);
  }
};
run();
