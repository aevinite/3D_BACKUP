// verify-offline-retry.mjs — THE LAST-RESORT PAGE MUST NOT SPEED UP WHEN THE LINE GETS WORSE.
//
//   node scripts/verify-offline-retry.mjs
//   npm run verify:offline-retry
//
// WHY THIS EXISTS
//   public/offline.html is the screen a phone lands on when it has nothing saved and no
//   connection. It re-checks on a doubling, jittered timer, and the comment above that timer says
//   why: "back off so a bad network isn't hammered" — every device in the restaurant lands on this
//   page within a second of the others, so a lockstep re-check is a wave of requests arriving at
//   exactly the moment the thing needs a quiet gap.
//
//   A phone on the edge of coverage fires `online` over and over. Each of those events called
//   cycle(), and every cycle() that landed while no check happened to be running scheduled ANOTHER
//   independent timer — with no handle kept anywhere, so nothing could ever cancel it. The chains
//   only died by colliding with each other. The result is the opposite of the stated design: the
//   worse the line flaps, the FASTER this page probes the server that is already struggling.
//
//   The fix keeps ONE timer handle and clears it before scheduling, so there is exactly one retry
//   chain no matter how many times the device says it is back.
//
// HOW IT IS PROVED
//   The REAL public/offline.html is served from a tiny local stub that answers the two probe paths
//   and counts them. No build, no database, no login, no deployed site — so this is safe to run on
//   every push and cannot trip any of the app's own limits. Time is compressed by overriding the
//   page's own clock knobs before it runs, so the whole check takes seconds.
//
// It also asserts the things a person depends on, which a timing fix must not break:
//   · the page never states a cause before it has tested one
//   · with the device offline it blames the DEVICE, not the app
//   · with the device online but the app unhealthy it blames the APP, not the internet
//   · it always offers the way out (#home)
import { chromium } from "playwright";
import http from "node:http";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log(`  ✅ ${m}`); };
const bad = (m, extra) => { fail++; console.log(`  ❌ ${m}${extra ? ` — ${extra}` : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── the stub site ───────────────────────────────────────────────────────────────────────────
// `mode` decides what the two probes answer, so each scenario below is one variable.
//   "dead"     → nothing answers (the device might as well be offline)
//   "app-down" → the reachability probe answers, /api/health does not
//   "well"     → both answer
let mode = "dead";
let reachHits = 0, healthHits = 0;
const server = http.createServer((req, res) => {
  const path = String(req.url).split("?")[0];
  if (path === "/offline.html" || path === "/") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    return res.end(readFileSync(join(ROOT, "public/offline.html"), "utf8"));
  }
  if (path === "/api/__offline-check") {
    reachHits++;
    if (mode === "dead") { res.destroy(); return; }
    res.writeHead(404); return res.end("no route");     // a 404 is a perfectly good yes
  }
  if (path === "/api/health") {
    healthHits++;
    if (mode === "well") { res.writeHead(200, { "content-type": "application/json" }); return res.end('{"ok":true}'); }
    res.writeHead(503); return res.end("busy");
  }
  // ANY OTHER PATH GETS THE LAST-RESORT PAGE, which is exactly what the service worker does:
  // event.respondWith() answers the original navigation without changing the address, so the page
  // runs with location.pathname still set to the screen the person asked for. That is the only
  // thing its "way out" logic has to go on, so it is the only way to check that logic honestly.
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(readFileSync(join(ROOT, "public/offline.html"), "utf8"));
});

// Shrink the page's own clock so a check that is designed to run over minutes runs in seconds.
// Nothing about the page's LOGIC is replaced — only how long its timers wait and how long its
// probes are allowed to take. That is the difference between compressing time and faking a pass.
const COMPRESS = `
  (() => {
    const realTimeout = window.setTimeout.bind(window);
    window.__lfhScheduled = 0;
    window.setTimeout = function (fn, ms, ...rest) {
      // The page's retry gaps are seconds; its probe timeouts are 6000/9000. Count only the
      // retry gaps (>= 1000ms and not one of the two probe timeouts) so the tally is the thing
      // we care about: how many retry chains are alive.
      if (ms >= 1000 && ms !== 6000 && ms !== 9000) window.__lfhScheduled++;
      return realTimeout(fn, Math.max(1, Math.round(ms / 50)), ...rest);
    };
  })();
`;

async function run() {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true });

  try {
    // ══ 1 · ONE RETRY CHAIN, HOWEVER MANY TIMES THE DEVICE SAYS IT IS BACK ═════════════════
    // A phone on the edge of coverage fires `online` repeatedly. Each of those must join the
    // existing loop, never start a second one.
    {
      mode = "dead";
      const ctx = await browser.newContext();
      await ctx.addInitScript(COMPRESS);
      const page = await ctx.newPage();
      await page.goto(base + "/offline.html", { waitUntil: "domcontentloaded" });
      await sleep(400);                       // let the first check settle

      const before = await page.evaluate(() => window.__lfhScheduled);
      // Ten "we're back" events, spaced far enough apart that each one lands while the page is
      // idle — which is exactly the window that used to spawn a chain.
      for (let i = 0; i < 10; i++) {
        await page.evaluate(() => window.dispatchEvent(new Event("online")));
        await sleep(120);
      }
      await sleep(1500);
      const after = await page.evaluate(() => window.__lfhScheduled);
      const grew = after - before;
      // With ONE chain, ten `online` events in ~1.2s of compressed time can only ever re-arm the
      // same timer, so the number of retry gaps scheduled stays close to the number of checks
      // that actually ran. With a chain per event it climbs with the event count and never comes
      // back down. 32 is a generous ceiling for one chain over this window (measured: 22 with one
      // chain, 47 with a chain per event).
      grew <= 32
        ? ok(`ten "back online" events left the retry loop intact (${grew} retry gaps scheduled)`)
        : bad(`ten "back online" events multiplied the retry loop (${grew} retry gaps scheduled)`,
              "each event started an independent timer chain, so the page probes a struggling server faster the worse the line flaps");
      // …and the shape that makes it possible: the retry gap must be held in a handle that is
      // cleared before each schedule. Asserting the behaviour above and the mechanism here means a
      // revert is caught even if a future change makes the count coincidentally land under the cap.
      const html = readFileSync(join(ROOT, "public/offline.html"), "utf8");
      /retryTimer\s*=\s*setTimeout/.test(html) && /clearTimeout\(retryTimer\)/.test(html)
        ? ok("the retry gap is held in one handle that is cleared before each schedule")
        : bad("the retry gap is scheduled with no handle kept, so nothing can cancel a duplicate loop");
      await ctx.close();
    }

    // ══ 2 · IT PROBES A DEAD LINE LESS OFTEN AS TIME GOES ON ═══════════════════════════════
    {
      mode = "dead";
      reachHits = 0;
      const ctx = await browser.newContext();
      await ctx.addInitScript(COMPRESS);
      const page = await ctx.newPage();
      await page.goto(base + "/offline.html", { waitUntil: "domcontentloaded" });
      await sleep(300);
      // Keep telling it we're back, the way a flapping phone does.
      for (let i = 0; i < 12; i++) {
        await page.evaluate(() => window.dispatchEvent(new Event("online")));
        await sleep(100);
      }
      await sleep(2000);
      // A single backing-off chain over this compressed window makes a handful of probes.
      // A chain per event makes many times that.
      reachHits <= 42
        ? ok(`a flapping connection produced ${reachHits} reachability probes, not a flood`)
        : bad(`a flapping connection produced ${reachHits} reachability probes`, "the backoff is being multiplied by extra timer chains");
      await ctx.close();
    }

    // ══ 3 · IT STILL SAYS THE RIGHT THING ═════════════════════════════════════════════════
    // A timing fix must not change a single verdict. Read the VERDICT ELEMENTS, never the whole
    // body — this page's inline script holds all three verdict strings in its source.
    {
      mode = "dead";
      const ctx = await browser.newContext();
      await ctx.addInitScript(COMPRESS);
      const page = await ctx.newPage();
      // Load the page FIRST and only then cut the line. Opening it in an already-offline context
      // means the document itself never arrives, so #title and #home do not exist and the run
      // reports four faults describing one test-setup mistake.
      await page.goto(base + "/offline.html", { waitUntil: "domcontentloaded" });
      await ctx.setOffline(true);
      await page.evaluate(() => window.dispatchEvent(new Event("offline")));
      await page.evaluate(() => window.dispatchEvent(new Event("online")));  // re-run diagnose now
      await sleep(800);
      const title = (await page.locator("#title").textContent().catch(() => "")) || "";
      const why = (await page.locator("#why").textContent().catch(() => "")) || "";
      /This device is offline|can't reach the internet/i.test(`${title} ${why}`)
        ? ok(`with the device offline it blames the device: "${title.trim()}"`)
        : bad("with the device offline it did not name the device", JSON.stringify(`${title} ${why}`.slice(0, 120)));
      !/this one is on us/i.test(`${title} ${why}`)
        ? ok("and it does not blame the app")
        : bad("it blamed the app while the device was the one offline");
      const homeCount = await page.locator("#home").count();
      const homeVisible = homeCount > 0 && (await page.locator("#home").isVisible());
      homeVisible ? ok("and it offers the way out (#home)") : bad("the last-resort page has no way out");
      const retryCount = await page.locator("#retry").count();
      retryCount > 0 ? ok("and it offers Try again (#retry)") : bad("the last-resort page has no retry");
      await ctx.close();
    }

    // ══ 4 · THE APP IS DOWN BUT THE INTERNET IS FINE ══════════════════════════════════════
    // The day the database stopped answering, this page told an owner whose Wi-Fi was fine that
    // his internet was gone. It must reach the opposite verdict here.
    {
      mode = "app-down";
      const ctx = await browser.newContext();
      await ctx.addInitScript(COMPRESS);
      const page = await ctx.newPage();
      await page.goto(base + "/offline.html", { waitUntil: "domcontentloaded" });
      const verdict = await (async () => {
        for (let i = 0; i < 60; i++) {
          const t = (await page.locator("#title").textContent().catch(() => "")) || "";
          const w = (await page.locator("#why").textContent().catch(() => "")) || "";
          if (/on us|isn't answering/i.test(`${t} ${w}`)) return `${t} ${w}`;
          await sleep(100);
        }
        return "";
      })();
      verdict
        ? ok(`with our server reachable but unhealthy it says it is on us: "${verdict.trim().slice(0, 70)}"`)
        : bad("it never reached the 'the app isn't answering' verdict", "it may still be blaming the internet");
      !/This device is offline/i.test(verdict)
        ? ok("and it does not blame the person's internet")
        : bad("it blamed the internet while our own server was answering");
      await ctx.close();
    }

    // ══ 5 · IT NEVER STATES A CAUSE BEFORE IT HAS TESTED ONE ══════════════════════════════
    {
      const html = readFileSync(join(ROOT, "public/offline.html"), "utf8");
      /Checking what's wrong/.test(html)
        ? ok("the page starts as \"Checking what's wrong...\", not with a guess")
        : bad("the page's initial state names a cause it has not tested");
      // Nothing off-origin can be fetched by definition, so nothing may be referenced.
      const foreign = [...html.matchAll(/(?:src|href)\s*=\s*["'](https?:)?\/\//g)];
      foreign.length === 0
        ? ok("nothing on the page is loaded from another origin")
        : bad(`${foreign.length} off-origin reference(s) on a page that by definition cannot fetch`);
      // One unprefixed backdrop-filter: hand-adding -webkit- makes the build DROP it.
      const webkitBlur = /-webkit-backdrop-filter/.test(html);
      !webkitBlur ? ok("the frosted card uses one unprefixed backdrop-filter") : bad("a -webkit-backdrop-filter was added — the build drops the whole declaration");
      // The reassurance must stay the honest form.
      /already saved on this device is safe/i.test(html)
        ? ok("the reassurance promises only what is actually guaranteed")
        : bad("the honest reassurance wording is gone");
      !/Nothing you did is lost/i.test(html)
        ? ok("and it does not promise that everything done offline was saved")
        : bad("the page promises more than it can keep (blocked storage, guest actions with no queue)");
    }

    // ══ 6 · THE SAME PROMISE ON THE WORKER'S INLINE COPY ══════════════════════════════════
    // public/sw.js carries a bare inline version of this page for the case where even the
    // branded one is missing. The two must keep the same contract, or a guard can only ever see
    // one of them.
    {
      const sw = readFileSync(join(ROOT, "public/sw.js"), "utf8");
      /id="home"/.test(sw) ? ok("the worker's inline last-resort page carries #home") : bad("the worker's inline page lost its way out (#home)");
      /id="retry"/.test(sw) ? ok("…and #retry") : bad("the worker's inline page lost #retry");
      /already saved on this device is safe/.test(sw)
        ? ok("…and the same honest reassurance")
        : bad("the worker's inline page no longer matches the honest reassurance wording");
    }

    // ══ 7 · THE WAY OUT HAS TO SUIT WHO IS LOOKING ════════════════════════════════════════
    // "/" is the PLATFORM door — app/page.tsx redirects it to /login, the staff username and
    // password screen. Right for a waiter; for a DINER it is the dead end components/
    // GuestNotFound.tsx was written to remove, and offline it is worse than useless because "/"
    // is very unlikely to be saved either, so it bounces straight back to this page.
    //
    // Sweep #6 gave the page this logic and sweep #7 found it had missed a door: /view/<folder>,
    // the 3D DISH VIEWER — the product's differentiator, reached by "View in 3D" from any dish —
    // has no /r/<slug> in its path, so it fell through to "/". Measured on a production build,
    // not read: the button said "Go to the home screen" and went to "/". A reload of the 3D view
    // with no signal is exactly the "tab wakes, reloads, no signal" moment this layer exists for.
    //
    // So every guest door is asked, by driving the REAL page at that address and clicking.
    {
      const doors = [
        { path: "/r/french-house/menu/never-opened", to: "/r/french-house/menu", label: "Go to the menu", who: "a diner at a tenant restaurant" },
        { path: "/menu/never-opened", to: "/menu", label: "Go to the menu", who: "a diner on the legacy menu" },
        { path: "/item/some-dish", to: "/menu", label: "Go to the menu", who: "a diner on a legacy dish page" },
        { path: "/view/some-model", to: "/menu", label: "Go to the menu", who: "a diner in the 3D dish viewer" },
        { path: "/view/some-model?r=french-house", to: "/r/french-house/menu", label: "Go to the menu", who: "a diner in the 3D viewer whose link names the restaurant" },
        { path: "/q/SOMECODE", to: "/q/SOMECODE", label: "Go to the menu", who: "a diner on a printed table QR with nothing pinned" },
        { path: "/manager/tables", to: "/", label: "Go to the home screen", who: "a member of staff" },
      ];
      mode = "dead"; // offline, which is when this page is seen
      for (const d of doors) {
        const p = await browser.newPage();
        try {
          await p.addInitScript(COMPRESS);
          await p.goto(base + d.path, { waitUntil: "domcontentloaded" });
          await p.waitForSelector("#home", { timeout: 5000 });
          const label = (await p.locator("#home").textContent()).trim();
          await p.locator("#home").click();
          await p.waitForTimeout(300);
          const landed = new URL(p.url()).pathname;
          landed === d.to && label === d.label
            ? ok(`${d.who}: "${label}" → ${landed}`)
            : bad(`${d.who} is sent to the wrong place from ${d.path}`,
              `expected "${d.label}" → ${d.to}, got "${label}" → ${landed}`
              + (d.to !== "/" && landed === "/" ? "\n       \"/\" is the STAFF sign-in. A diner must never be handed it." : ""));
        } catch (e) {
          bad(`${d.who}: the way out could not be read from ${d.path}`, e.message);
        } finally { await p.close().catch(() => {}); }
      }
      // …and the worker's inline copy must know the SAME doors, or a device that fell all the way
      // back to it gets the old dead end on the one screen that is hardest to notice.
      const sw2 = readFileSync(join(ROOT, "public/sw.js"), "utf8");
      const html = readFileSync(join(ROOT, "public/offline.html"), "utf8");
      // Literal needles, not regexes. The inline copy lives inside a JS string inside sw.js, so
      // its slashes are DOUBLE-escaped ("\\/view\\/") while offline.html's are single ("\/view\/").
      // A first attempt compared them with one pattern and reported a disagreement that was purely
      // its own escaping — so each side names the exact text to look for.
      const doorPairs = [
        { name: "/r/<slug>", html: "/^\\/r\\/([^/]+)\\//", sw: "/^\\\\/r\\\\/([^/]+)\\\\//" },
        { name: "/menu and /item", html: "/^\\/(menu|item)(\\/|$)/", sw: "/^\\\\/(menu|item)(\\\\/|$)/" },
        { name: "/q/<code>", html: "/^\\/q\\/[^/]+/", sw: "/^\\\\/q\\\\/[^/]+/" },
        { name: "/view/<folder> (the 3D dish viewer)", html: "/^\\/view\\/[^/]+/", sw: "/^\\\\/view\\\\/[^/]+/" },
      ];
      for (const d of doorPairs) {
        const inHtml = html.includes(d.html), inSw = sw2.includes(d.sw);
        inSw && inHtml
          ? ok(`both copies of the last-resort page know the ${d.name} door`)
          : bad(`the two copies of the last-resort page disagree about the ${d.name} door`,
            `offline.html: ${inHtml ? "yes" : "NO"} · sw.js inline copy: ${inSw ? "yes" : "NO"}`
            + "\n       A device that fell back to the worker's inline copy would get the old dead end.");
      }
      // /offline.html is PRECACHED, so a device keeps the old copy until the cache names move.
      // Changing the page without bumping VERSION ships a fix nobody receives.
      /BUMP THIS whenever \/offline\.html changes/.test(sw2)
        ? ok("the worker still records that changing the offline page needs a VERSION bump")
        : bad("the bump rule has gone from sw.js", "a change to /offline.html would never reach a device that already has one");
    }

  } catch (e) {
    bad("the run stopped early", e.stack || e.message);
  } finally {
    await browser.close().catch(() => {});
    server.close();
    console.log(`\n${fail === 0 ? "✅ PASS" : "❌ FAIL"} — ${pass} passed, ${fail} failed\n`);
    process.exit(fail === 0 ? 0 : 1);
  }
}

run();
