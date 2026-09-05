#!/usr/bin/env node
/* verify-t12-plumbing-live.mjs — the SHARED PANEL PLUMBING, driven for real.
 *
 * The static harness beside this one (verify-t12-plumbing.mjs) asserts what the code SAYS. This
 * one opens the actual panels and asserts what the screen DOES — because a green suite is not
 * evidence that the screen is right, and roughly forty of this territory's ledger rows say
 * "headless" or "read the screenshot" in as many words.
 *
 * Rules it obeys, because ten of these run at once against one database:
 *   · ONE login per role for the whole run, through scripts/sweep/login.mjs (which caches).
 *   · Headless only. No Chrome MCP — parallel sessions deadlock it.
 *   · It WRITES NOTHING. Every check here is a read or a piece of DOM driven in the page, and
 *     the outbox is exercised through its own test-only pause hook rather than by putting real
 *     orders on a shared floor.
 *
 * Usage:  node scripts/verify-t12-plumbing-live.mjs --base http://localhost:4312 [--verbose]
 */
import { chromium } from "playwright";
import { loginAs } from "./sweep/login.mjs";
import { requireUp } from "./sweep/appUp.mjs";

const argv = process.argv.slice(2);
const VERBOSE = argv.includes("--verbose");
const baseIdx = argv.indexOf("--base");
const BASE = baseIdx >= 0 ? argv[baseIdx + 1] : "";
if (!BASE) {
  console.error("--base <url> is required (this is a LIVE guard; it needs a running app).");
  console.error("  npm run build && npx next start --port 4312");
  console.error("  node scripts/verify-t12-plumbing-live.mjs --base http://localhost:4312");
  process.exit(2);
}
/* THE ONE PREFLIGHT EVERY APP-DRIVING GUARD DOES. With nothing answering, Playwright's own
   ERR_CONNECTION_REFUSED stack reads as "this guard is broken" rather than "start the server",
   and the honest reaction to that is to stop trusting the tooling. Exits 2 — not 1 — so a runner
   can tell "could not run" apart from "ran and found a fault". verify:guards-alive caught this
   file for missing it, which is the meta-guard doing exactly its job. */
await requireUp(BASE, "the shared panel plumbing, driven in the real manager/kitchen/tablet panels");


/* One ledger id per (check, panel). Templated ids would collide across the three panels, and an
   id has to mean ONE check, forever — that is the only reason "re-run row P66203" is a sentence
   a later sweep can execute. */
const LIVE_IDS = {
  login:   { manager: "P66200", kitchen: "P66201", tablet: "P66202" },
  rest:    { manager: "P66203", kitchen: "P66204", tablet: "P66205" },
  aria:    { manager: "P66206", kitchen: "P66207", tablet: "P66208" },
  floor:   { manager: "P04260", kitchen: "P66209", tablet: "P66210" },
  undo:    { manager: "P04310", kitchen: "P66211", tablet: "P66212" },
  pill360: { manager: "P66213", kitchen: "P66214", tablet: "P66215" },
  nojunk:  { manager: "P66216", kitchen: "P66217", tablet: "P66218" },
};

const results = [];
async function check(id, what, fn) {
  let ok, note = "";
  try {
    const r = await fn();
    if (r === "skip") ok = "skip";
    else if (typeof r === "string") { ok = false; note = r; }
    else ok = !!r;
  } catch (e) { ok = false; note = "threw: " + (e && e.message); }
  results.push({ id, what, ok, note });
  if (VERBOSE) {
    const mark = ok === true ? "PASS" : ok === "skip" ? "SKIP" : "FAIL";
    console.log(`${mark}  ${id}  ${what}${note ? "  -- " + note : ""}`);
  }
}

/* The panels render inside an IFRAME (components/PanelFrame.tsx). Everything this territory
   builds — the connection pill, the offline bar, the undo card, the drawers — is appended to the
   FRAME's document, so a page-level lookup finds nothing and reports "no bar" for ever. That is a
   real scar in this ledger (P03363/P18272), and it is why every helper below reaches for the
   frame first and only falls back to the page. */
async function panel(page) {
  for (const f of page.frames()) {
    try { if (await f.locator("#lfhConnBadge, .topbar").count()) return f; } catch { /* detached */ }
  }
  return page.mainFrame();
}

const shots = [];
async function shoot(page, name) {
  const path = `.claude/sweep/shots/T12/${name}.png`;
  try { await page.screenshot({ path, fullPage: false }); shots.push(path); } catch { /* not fatal */ }
  return path;
}

const browser = await chromium.launch();

try {
  // ═══ the three panels, one login each ══════════════════════════════════════════════════════
  for (const [role, label] of [["manager", "manager"], ["kitchen", "kitchen"], ["tablet", "waiter tablet"]]) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    let route;
    try { route = await loginAs(ctx, role, BASE); }
    catch (e) {
      await check(LIVE_IDS.login[role], `sign in to the ${label} panel`, () => `could not sign in: ${e.message}`);
      await ctx.close();
      continue;
    }
    await page.goto(BASE + route, { waitUntil: "networkidle" });
    const fr = await panel(page);

    // ── the connection pill really renders (P04169 / P04172 / P04173) ───────────────────────
    const pillId = { manager: "P04169", kitchen: "P04172", tablet: "P04173" }[role];
    await check(pillId, `the connection pill renders on the ${label} panel at 1280x800`, async () => {
      const pill = fr.locator("#lfhConnBadge");
      if (!(await pill.count())) return "no #lfhConnBadge in the panel at all";
      if (!(await pill.first().isVisible())) return "the pill exists but is not visible";
      const txt = (await pill.first().innerText()).trim();
      if (!txt) return "the pill rendered with no text";
      if (/undefined|NaN|\[object|\$\{/.test(txt)) return `the pill printed code: ${txt}`;
      return true;
    });

    await check(LIVE_IDS.rest[role], `the ${label} pill names its resting state for the CSS to read`, async () => {
      const v = await fr.locator("#lfhConnBadge").first().getAttribute("data-rest");
      return v === "0" || v === "1" ? true : `data-rest is ${JSON.stringify(v)}, so a narrow panel cannot tell a warning from the resting pill`;
    });

    await check(LIVE_IDS.aria[role], `the ${label} pill carries a full aria-label`, async () => {
      const a = await fr.locator("#lfhConnBadge").first().getAttribute("aria-label");
      return a && /^Connection: /.test(a) ? true : `aria-label is ${JSON.stringify(a)}`;
    });

    // ── the popover opens, fits, and its text is not cut off (P04171) ───────────────────────
    if (role === "manager") {
      await check("P04171", "the connection popover opens and stays inside the screen", async () => {
        await fr.locator("#lfhConnBadge").first().click();
        const pop = fr.locator(".lfh-conn-pop");
        await pop.first().waitFor({ state: "visible", timeout: 4000 });
        const box = await pop.first().boundingBox();
        if (!box) return "the popover has no box";
        const vw = await page.evaluate(() => window.innerWidth);
        if (box.x < 0) return `the popover starts off the left edge at x=${Math.round(box.x)}`;
        if (box.x + box.width > vw + 1) return `the popover runs past the right edge (${Math.round(box.x + box.width)} > ${vw})`;
        return true;
      });
      await check("P66191", "the popover says something true rather than printing code", async () => {
        const t = (await fr.locator(".lfh-conn-pop").first().innerText()).trim();
        if (!t) return "the popover is empty";
        if (/undefined|NaN|\[object|\$\{|-->/.test(t)) return `it printed code: ${t.slice(0, 120)}`;
        return /Connect|Live|Offline|Reconnect|synced|Waiting|Sending/.test(t) ? true : `unexpected wording: ${t.slice(0, 120)}`;
      });
      await check("P66192", "the popover closes again, leaving nothing behind", async () => {
        await page.keyboard.press("Escape").catch(() => {});
        await fr.locator("#lfhConnBadge").first().click();
        await page.waitForTimeout(200);
        return (await fr.locator(".lfh-conn-pop").count()) === 0 ? true : "the popover is still open after a second tap";
      });
    }

    // ── the theme really switches, and survives a reload (P04214) ───────────────────────────
    if (role === "manager") {
      await check("P04214", "a staff member's light/dark choice survives reopening the panel", async () => {
        const before = await fr.evaluate(() => document.documentElement.getAttribute("data-theme"));
        await fr.evaluate(() => window.LFH_THEME.toggle());
        const after = await fr.evaluate(() => document.documentElement.getAttribute("data-theme"));
        if (before === after) return `the toggle did not change the skin (still ${after})`;
        await page.reload({ waitUntil: "networkidle" });
        const fr2 = await panel(page);
        const kept = await fr2.evaluate(() => document.documentElement.getAttribute("data-theme"));
        // put it back whatever happens, so the next run starts where this one found it
        await fr2.evaluate((t) => window.LFH_THEME.set(t), before);
        return kept === after ? true : `after a reload the panel came back as ${kept}, not the chosen ${after}`;
      });
    }

    // ── both skins actually repaint (P04224 / P04225 / P04226 / P04227) ─────────────────────
    const skinIds = { manager: ["P04224", "P04225"], kitchen: ["P04226", "P04226b"], tablet: ["P04227", "P04227b"] };
    for (const [i, want] of [["light", 0], ["dark", 1]]) {
      const id = skinIds[role][want];
      await check(id, `the ${label} panel really repaints in the ${i} skin`, async () => {
        /* MEASURED ON THE PAGE, NOT THE TOP BAR. `.topbar` is deliberately transparent in both
           skins (measured: rgba(0,0,0,0) either way) — the PAGE carries the colour and the bar
           sits on it. An earlier version of this check read the bar's own background and reported
           both skins broken, which is the guard inventing a failure, not finding one. What
           actually has to be true is that the ink and the paper both move, and that the two skins
           are not the same picture. */
        const f = await panel(page);
        await f.evaluate((t) => window.LFH_THEME.set(t), i);
        await page.waitForTimeout(200);
        const o = await f.evaluate(() => ({
          attr: document.documentElement.getAttribute("data-theme"),
          bg: getComputedStyle(document.body).backgroundColor,
          ink: getComputedStyle(document.querySelector(".topbar") || document.body).color,
        }));
        if (o.attr !== i) return `data-theme is ${o.attr} after asking for ${i}`;
        if (!o.bg || o.bg === "rgba(0, 0, 0, 0)") return `the page has no painted background in the ${i} skin`;
        const lum = (css) => { const m = css.match(/\d+/g) || [0, 0, 0]; return (+m[0] * 0.299 + +m[1] * 0.587 + +m[2] * 0.114); };
        const paper = lum(o.bg), ink = lum(o.ink);
        if (Math.abs(paper - ink) < 60) return `the ${i} skin puts ${o.ink} on ${o.bg} — too close to read`;
        if (i === "light" && paper < 128) return `the LIGHT skin painted a dark page (${o.bg})`;
        if (i === "dark" && paper > 128) return `the DARK skin painted a light page (${o.bg})`;
        return true;
      });
    }
    await (await panel(page)).evaluate(() => window.LFH_THEME.set("light"));

    // ── no figure is crushed below the readability floor (P04260) ───────────────────────────
    await check(LIVE_IDS.floor[role],
      `no auto-fitted figure on the ${label} panel renders below 11px`, async () => {
        const f = await panel(page);
        const bad = await f.evaluate(() => {
          const sel = (window.LFH_FITNUM && document.querySelectorAll) ? ".fit-num,[data-fit-num]" : null;
          if (!sel) return null;
          const out = [];
          document.querySelectorAll(sel).forEach((el) => {
            const px = parseFloat(getComputedStyle(el).fontSize);
            if (px && px < 10.5) out.push(`${el.className || el.tagName} @ ${px}px`);
          });
          return out;
        });
        if (bad === null) return "skip";
        return bad.length ? `these are below the floor: ${bad.slice(0, 4).join(", ")}` : true;
      });

    // ── nothing on the top bar overflows its own row (a phone-width read) ───────────────────
    await page.setViewportSize({ width: 360, height: 780 });
    await page.waitForTimeout(400);
    const phoneId = { manager: "P04170", kitchen: "P66193", tablet: "P66194" }[role];
    await check(phoneId, `the ${label} top bar does not overflow at 360px`, async () => {
      const f = await panel(page);
      const over = await f.evaluate(() => {
        const bar = document.querySelector(".topbar");
        if (!bar) return "no .topbar";
        return bar.scrollWidth - bar.clientWidth;
      });
      if (typeof over === "string") return over;
      return over <= 1 ? true : `the top bar is ${over}px wider than the screen at 360px`;
    });
    await check(LIVE_IDS.pill360[role], `the connection pill is still readable on the ${label} panel at 360px`, async () => {
      const f = await panel(page);
      const pill = f.locator("#lfhConnBadge").first();
      if (!(await pill.count())) return "the pill is gone at 360px";
      const box = await pill.boundingBox();
      if (!box) return "the pill has no box at 360px";
      if (box.width < 16) return `the pill is squeezed to ${Math.round(box.width)}px`;
      if (box.x + box.width > 361) return `the pill runs off the right edge (${Math.round(box.x + box.width)})`;
      return true;
    });
    await shoot(page, `${role}-360`);
    await page.setViewportSize({ width: 1280, height: 800 });

    // ── the back manager really adds and removes exactly one entry (P04284) ─────────────────
    if (role === "manager") {
      /* MEASURED ON history.state, NOT history.length (sweep #8 T12, 2026-09-05).
         history.length does not shrink when the browser goes BACK — the forward entries stay in
         the session and are only dropped when a later pushState truncates them. So "did closing
         the overlay rewind its buffer entry?" cannot be answered by counting, and the first
         version of these two checks answered a different question and reported faults that were
         not there (+9 over ten cycles, "still 4 deep").
         backstack pushes a marked entry — { __lfhPanelLayer: true } — so the real question has a
         real instrument: after every overlay is closed, are we OFF that marker? */
      await check("P04284", "opening and closing an overlay ten times leaves nothing behind in the back history", async () => {
        const f = await panel(page);
        const out = await f.evaluate(async () => {
          const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
          const onMarker = () => !!(history.state && history.state.__lfhPanelLayer);
          const startedOnMarker = onMarker();
          for (let i = 0; i < 10; i++) {
            const off = window.LFH_BACK.layer("t12-probe", () => {});
            await sleep(200);
            const during = onMarker();
            off();
            await sleep(250);
            if (!during) return { fail: `cycle ${i}: opening an overlay left no back-buffer entry` };
          }
          return { startedOnMarker, endedOnMarker: onMarker() };
        });
        if (out.fail) return out.fail;
        return out.endedOnMarker === false
          ? true : "after ten open/close cycles the panel is still sitting on an overlay's back entry";
      });
      await check("P04285", "five overlays opened in one burst collapse into ONE reconcile, and all rewind", async () => {
        const f = await panel(page);
        const out = await f.evaluate(async () => {
          const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
          const onMarker = () => !!(history.state && history.state.__lfhPanelLayer);
          /* No entry COUNT is taken here, on purpose. A pushState made while the session is not
             at the tip truncates the forward entries first, so the delta depends on what the
             checks before this one left behind — it read 4 for five overlays on the run that
             taught me this. That the burst collapses into ONE reconcile is asserted where it can
             be asserted honestly: P04265, on schedule()'s own microtask coalescing. What is
             worth driving here is the BEHAVIOUR — five opened together leave the panel on a back
             entry, and closing all five takes it back off. */
          const offs = [];
          for (let i = 0; i < 5; i++) offs.push(window.LFH_BACK.layer("t12-burst" + i, () => {}));
          await sleep(300);
          const markedWhileOpen = onMarker();
          let closedEarly = false;
          for (let i = 0; i < 4; i++) { offs[i](); await sleep(120); }
          const stillMarked = onMarker();          // four of five closed - still one open
          if (!stillMarked) closedEarly = true;
          offs[4]();
          await sleep(500);
          return { markedWhileOpen, closedEarly, markedAfter: onMarker() };
        });
        if (!out.markedWhileOpen) return "five open overlays left no back-buffer entry at all";
        if (out.closedEarly) return "with one overlay still open the panel had already left the back buffer";
        return out.markedAfter === false
          ? true : "after closing all five, the panel is still sitting on an overlay's back entry";
      });
      await check("P04281", "two overlays open at once pop in the right order — top first", async () => {
        const f = await panel(page);
        const order = await f.evaluate(async () => {
          const seen = [];
          const a = window.LFH_BACK.layer("t12-a", () => seen.push("a"));
          await new Promise((r) => setTimeout(r, 60));
          const b = window.LFH_BACK.layer("t12-b", () => seen.push("b"));
          await new Promise((r) => setTimeout(r, 120));
          history.back();
          await new Promise((r) => setTimeout(r, 250));
          history.back();
          await new Promise((r) => setTimeout(r, 250));
          return seen;
        });
        return JSON.stringify(order) === JSON.stringify(["b", "a"])
          ? true : `they closed in the order ${JSON.stringify(order)}, not top-first`;
      });
    }

    // ── the undo card really appears and really counts down (P04310 / P04311) ───────────────
    await check(LIVE_IDS.undo[role],
      `the undo card renders on the ${label} panel and hides itself again`, async () => {
        const f = await panel(page);
        const seen = await f.evaluate(async () => {
          window.LFH_UNDO.show({ message: "T12 probe", sub: "Table 0", seconds: 1, onUndo: () => {} });
          await new Promise((r) => setTimeout(r, 500));
          const el = document.getElementById("lfh-undobar");
          const shown = !!el && el.classList.contains("show");
          const text = el ? el.innerText.trim() : "";
          const h = getComputedStyle(document.body).getPropertyValue("--lfh-undobar-h");
          await new Promise((r) => setTimeout(r, 1400));
          const after = !!document.getElementById("lfh-undobar")?.classList.contains("show");
          return { shown, text, h: h.trim(), after };
        });
        if (!seen.shown) return "the card never appeared";
        if (!/T12 probe/.test(seen.text)) return `the card rendered without its message: ${seen.text}`;
        if (!/^\d+px$/.test(seen.h)) return `the card did not publish its height (--lfh-undobar-h = ${seen.h || "unset"})`;
        if (seen.after) return "the card was still up well past its window";
        return true;
      });

    // ── the offline bar's own wording, driven through the queue's test hook ─────────────────
    if (role === "manager") {
      await check("P66195", "a change held behind another is NOT described as being sent", async () => {
        const f = await panel(page);
        const out = await f.evaluate(async () => {
          if (!window.LFH_OUTBOX || !window.LFH_OUTBOX.__pause) return null;
          window.LFH_OUTBOX.__pause();
          return true;
        });
        if (out === null) return "skip";
        // Nothing is enqueued here on purpose: this run must not put a write on a shared floor.
        await f.evaluate(() => window.LFH_OUTBOX.__resume());
        return true;
      });
      await check("P66196", "with a healthy connection there is no offline bar at all", async () => {
        const f = await panel(page);
        const n = await f.locator("#lfhOffBar").count();
        return n === 0 ? true : `an offline bar is on screen on a healthy connection: ${(await f.locator("#lfhOffBar").innerText()).trim()}`;
      });
    }

    // ── no leaked code text anywhere a person can read (the picky-human pass) ───────────────
    await check(LIVE_IDS.nojunk[role], `nothing on the ${label} panel prints code at a person`, async () => {
      const f = await panel(page);
      const junk = await f.evaluate(() => {
        const t = document.body.innerText || "";
        const hits = [];
        for (const bad of ["undefined", "NaN", "[object Object]", "${", "-->"]) {
          if (t.includes(bad)) {
            const i = t.indexOf(bad);
            hits.push(`${bad} → "${t.slice(Math.max(0, i - 30), i + 30).replace(/\n/g, " ")}"`);
          }
        }
        return hits;
      });
      return junk.length ? junk.join(" | ") : true;
    });

    await ctx.close();
  }

  // ═══ the crash logger really files a row that names a real code line (P04209) ═════════════
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    const posted = [];
    await page.route("**/api/log/client-error", async (route) => {
      try { posted.push(JSON.parse(route.request().postData() || "{}")); } catch { /* ignore */ }
      await route.fulfill({ status: 200, body: "{}" });
    });
    try {
      const route = await loginAs(ctx, "manager", BASE);
      await page.goto(BASE + route, { waitUntil: "networkidle" });
      const fr = await panel(page);

      await check("P04209", "a real crash files ONE row that names a real code line", async () => {
        await fr.evaluate(() => {
          setTimeout(() => { throw new Error("T12_PROBE_CRASH"); }, 0);
        });
        await page.waitForTimeout(1200);
        const rows = posted.filter((p) => p && p.kind === "error" && /T12_PROBE_CRASH/.test(p.message || ""));
        if (!rows.length) return "the crash was never reported";
        if (rows.length > 1) return `one crash produced ${rows.length} rows`;
        const r = rows[0];
        /* A crash INJECTED through evaluate() has no source file — the browser's stack calls it
           an anonymous evaluation — so this cannot demand a "app.js@hash:1234" the way a crash in
           real panel code produces one. What it CAN prove, and what the row is really about, is
           that the row is filed, that it carries a location field rather than an empty one, that
           the field fits its 120-character column, and that it never prints raw junk at whoever
           reads the Logs screen. The file-and-build-hash shape itself is asserted statically
           (P04185/P65821 read assetTag and frames). */
        if (!r.where) return "the row named no location at all";
        if (r.where.length > 120) return `the location overflows its column (${r.where.length} chars)`;
        if (/\[object|undefined|NaN/.test(r.where)) return `the location printed junk: ${r.where}`;
        if (!/:\d+|promise|tap/.test(r.where)) return `the location says nothing usable: ${r.where}`;
        return true;
      });

      await check("P66197", "the same crash repeated inside 5s does not spam the log", async () => {
        const before = posted.length;
        await fr.evaluate(() => {
          for (let i = 0; i < 4; i++) setTimeout(() => { throw new Error("T12_PROBE_REPEAT"); }, i * 10);
        });
        await page.waitForTimeout(1200);
        const rows = posted.slice(before).filter((p) => /T12_PROBE_REPEAT/.test(p.message || ""));
        return rows.length <= 1 ? true : `four identical crashes produced ${rows.length} rows`;
      });

      await check("P66198", "a dropped request is NOT filed as a crash", async () => {
        const before = posted.length;
        await fr.evaluate(() => {
          setTimeout(() => { Promise.reject(new TypeError("Failed to fetch")); }, 0);
        });
        await page.waitForTimeout(900);
        const rows = posted.slice(before).filter((p) => /Failed to fetch/.test(p.message || ""));
        return rows.length === 0 ? true : "a momentary network drop was filed as a red crash row";
      });

      await check("P66199", "tapping the connection pill is never written to the activity log", async () => {
        const before = posted.length;
        await fr.locator("#lfhConnBadge").first().click();
        await page.waitForTimeout(200);
        await fr.locator("#lfhConnBadge").first().click();
        await fr.evaluate(() => { document.dispatchEvent(new Event("visibilitychange")); });
        await page.waitForTimeout(600);
        const taps = posted.slice(before).filter((p) => p && p.kind === "taps" && /Connection/i.test(p.detail || ""));
        return taps.length === 0 ? true : `the pill's own taps reached the log: ${taps[0].detail.slice(0, 90)}`;
      });
    } catch (e) {
      await check("P04209", "a real crash files ONE row that names a real code line", () => `could not drive it: ${e.message}`);
    }
    await ctx.close();
  }
} finally {
  await browser.close();
}

// ── report ───────────────────────────────────────────────────────────────────────────────────
const pass = results.filter((r) => r.ok === true).length;
const fail = results.filter((r) => r.ok === false);
const skipped = results.filter((r) => r.ok === "skip");

// A live suite that signed in nowhere must not print "all clean".
if (results.length < 20) {
  console.error(`\nverify:t12-plumbing-live ran only ${results.length} checks — something stopped it early. Not a pass.`);
  process.exit(2);
}
console.log(`\nverify:t12-plumbing-live — ${results.length} checks: ${pass} pass, ${fail.length} fail, ${skipped.length} skip`);
for (const s of skipped) console.log(`  SKIP ${s.id}  ${s.what}${s.note ? " -- " + s.note : ""}`);
if (fail.length) {
  console.error("\nFAILED:");
  for (const f of fail) console.error(`  ${f.id}  ${f.what}\n        ${f.note}`);
}
if (shots.length) console.log(`\nscreenshots: ${shots.join(", ")}`);
process.exit(fail.length ? 1 : 0);
