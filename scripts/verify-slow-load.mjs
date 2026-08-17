// verify:slow-load — what a diner on a weak restaurant connection actually gets.
//
// Holds every GLB open so the model cannot arrive, then checks that the 3D screen stays a usable
// screen the whole time: the dish is readable, the way out works, the honest overlays arrive on
// schedule, and when the model finally lands the guest is told, by name, with a link that works.
//
//   node scripts/verify-slow-load.mjs --base http://localhost:4102
//
// ── THIS GUARD WAS DEAD, AND NOT QUIETLY (sweep #6 T2, 2026-08-17) ────────────────────────────
// It had been FAILING, not skipping, for months — three separate ways, all of them the guard's
// fault rather than the app's:
//
//   1. it waited 10s for the "Still preparing" overlay, which had been moved to 15s ("6s was too
//      eager and looked like a failure", ViewerClient) — so the wait could never succeed;
//   2. it asked `globalThis.__lfh_modelWatchlist.has("MP")`, and ModelWatchlist has never had a
//      `has()` method — that assertion was hard-coded to false;
//   3. it drove `/view/MP?from=gourmet-burger`, and neither the folder nor the dish exists any
//      more (the folder is "Croissant"; the dish slug 404s).
//
// A guard that always says FAIL teaches people to ignore it, which is worse than one that is
// skipped — the same disease verify-cache was cured of in 2026-07-30. So: no hardcoded dish (it
// is discovered from the menu, the way verify-cache does it), no private-API probes (the toast is
// observable, so observe the toast), and the timings are read from the same numbers the screen
// uses. Everything below is a promise to a person, not a fact about an implementation.

import { chromium } from "playwright";
import { requireAppUp } from "./sweep/appUp.mjs";

const BASE = (() => {
  const i = process.argv.indexOf("--base");
  return (i > -1 && process.argv[i + 1]) || process.env.VERIFY_BASE || process.env.BASE_URL
    || process.env.BASE || "http://localhost:4000";
})().replace(/\/$/, "");

await requireAppUp(["--base", BASE], "the slow-network check");

// The screen's own schedule, mirrored here so a change to one is a visible change to the other.
const STILL_PREPARING_AT_MS = 15000;  // ViewerClient: the patience overlay
const UNAVAILABLE_AT_MS = 32000;      // ViewerClient: the escalation
const SLOW_BAR_AT_MS = 2500;          // ViewerClient: SLOW_BAR_GRACE_MS

let verdict = "PASS";
const findings = [];
const log = (...a) => console.log(...a);
const fail = (m) => { verdict = "FAIL"; findings.push(m); };

const browser = await chromium.launch({ headless: true });
// A Samsung A35 is the phone this has to work on, so measure on one.
const A35 = { viewport: { width: 360, height: 780 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true };

// How long a held GLB waits before completing. Past the 15s patience overlay, short of the 32s
// escalation — so one run sees both the "still preparing" wording AND the model arriving.
const HOLD_MS = 22000;
// If somebody moves the screen's timers, say so here rather than failing mysteriously twenty
// seconds later. The hold has to land between the two overlays for one run to see both.
if (!(SLOW_BAR_AT_MS < STILL_PREPARING_AT_MS && STILL_PREPARING_AT_MS < HOLD_MS && HOLD_MS < UNAVAILABLE_AT_MS)) {
  console.log(
    "\nThis guard's stopwatch no longer matches the screen's. ViewerClient's timers must satisfy\n" +
    `  SLOW_BAR_GRACE_MS (${SLOW_BAR_AT_MS}) < still-preparing (${STILL_PREPARING_AT_MS}) < this guard's HOLD_MS (${HOLD_MS}) < unavailable (${UNAVAILABLE_AT_MS}).\n` +
    "Update the four numbers at the top of this file to match, then re-run.\n"
  );
  process.exit(1);
}
/** Hold every GLB in this context for HOLD_MS, then serve it normally. */
const holdModels = (c, ms = HOLD_MS) =>
  c.route("**/*.glb", async (route) => { await new Promise((r) => setTimeout(r, ms)); return route.continue(); });

// DISCOVERY GETS ITS OWN CONTEXT, AND THE SLOW TEST GETS A FRESH ONE. Both matter: the discovery
// walk opens real dish pages, and the model cache is a per-tab singleton on globalThis — so
// re-using that context would hand the viewer a model it already holds, and nothing would ever be
// slow. (That is exactly how the first draft of this rewrite passed Phase A and then found no
// overlay at all: the model was already in memory.)
const discoverCtx = await browser.newContext(A35);
const page = await discoverCtx.newPage();

let ctx, viewPage;
try {
  // ── find the 3D dish rather than hardcoding one ─────────────────────────────────────────────
  log("=== Phase 0: find a dish that actually has a 3D model ===");
  await page.goto(`${BASE}/menu`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForSelector('a[href*="/item/"]', { timeout: 20000 });
  // The grid itself tells us which dishes have a model: components/FoodCard.tsx puts the `is-4d`
  // class on a card only when the dish is flagged 4D, the restaurant's 3D switch is on AND both
  // model files exist. So ask the grid instead of opening dish pages one by one — the earlier
  // draft walked the first sixteen links and missed the 3D dish, which sits around the twentieth.
  const target = await page.evaluate(() => {
    const card = document.querySelector("a.item-card-link .is-4d");
    const link = card?.closest("a.item-card-link");
    return link ? link.getAttribute("href") : null;
  });
  if (!target) throw new Error("no dish on /menu is marked as having a 3D model — cannot check the slow path");
  await page.goto(BASE + target, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForSelector("#view-3d-btn", { timeout: 20000 });
  const dishTitle = (await page.textContent(".detail-title"))?.trim() || "";
  log(`  using ${target}  ·  "${dishTitle}"`);
  await discoverCtx.close();

  // ── the slow 3D screen, in a tab that holds no model yet ────────────────────────────────────
  log("\n=== Phase A: open it in 3D with the model held open ===");
  ctx = await browser.newContext(A35);
  await holdModels(ctx);
  viewPage = await ctx.newPage();
  await viewPage.goto(BASE + target, { waitUntil: "domcontentloaded", timeout: 30000 });
  await viewPage.waitForSelector("#view-3d-btn", { timeout: 20000 });
  const openedAt = Date.now();
  await viewPage.click("#view-3d-btn");
  await viewPage.waitForURL(/\/view\//, { timeout: 20000 });
  log("  viewer:", viewPage.url().replace(BASE, ""));

  // A1 — the way out must work. The loading panel is fixed/inset-0/opaque at z-index 100 in
  // app/globals.css while #topbar is 30, so it once covered BACK entirely: a real tap hit the
  // panel and the address never changed. A diner on weak wi-fi could not leave the screen.
  await viewPage.waitForTimeout(1500);
  const backReachable = await viewPage.evaluate(() => {
    const back = document.querySelector("a.back-btn");
    if (!back) return { ok: false, why: "no back button rendered" };
    const r = back.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { ok: top === back || back.contains(top), why: top ? (top.id || top.className || top.tagName).toString() : "nothing" };
  });
  log("  BACK reachable while the spinner is up:", backReachable.ok, `(top element: ${backReachable.why})`);
  if (!backReachable.ok) fail(`The BACK button is covered while the model loads — "${backReachable.why}" is on top of it.`);

  // A2 — the dish itself must be readable while waiting. Name, price and a live Add button are
  // all known long before the GLB arrives; hiding them behind an opaque spinner is a blank wait.
  const sinceOpen = Date.now() - openedAt;
  if (sinceOpen < SLOW_BAR_AT_MS + 1200) await viewPage.waitForTimeout(SLOW_BAR_AT_MS + 1200 - sinceOpen);
  const bar = await viewPage.evaluate(() => {
    const el = document.querySelector("#bar");
    const add = document.querySelector(".badd");
    const r = el?.getBoundingClientRect();
    const a = add?.getBoundingClientRect();
    const top = a ? document.elementFromPoint(a.left + a.width / 2, a.top + a.height / 2) : null;
    return {
      onScreen: !!r && r.top < innerHeight,
      name: document.querySelector("#dish-title")?.textContent?.trim() || "",
      price: document.querySelector("#stat-price")?.textContent?.trim() || "",
      addEnabled: add ? !add.disabled : false,
      addReachable: !!add && (top === add || add.contains(top)),
    };
  });
  log("  the dish bar while waiting:", JSON.stringify(bar));
  if (!bar.onScreen) fail("The dish bar is still off screen after the grace period — the guest sees a spinner and nothing else.");
  if (!bar.name) fail("The dish's name is not shown while the model loads, although it is already loaded.");
  if (!bar.price || bar.price === "—") fail("The dish's price is not shown while the model loads.");
  if (!bar.addReachable || !bar.addEnabled) fail("The Add button is not usable while the model loads.");
  if (dishTitle && bar.name && bar.name !== dishTitle) fail(`The 3D screen names "${bar.name}" for the dish page's "${dishTitle}".`);

  // A3 — the honest overlays, on schedule.
  log("\n=== Phase B: the patience overlay arrives, and says the right thing ===");
  await viewPage.waitForSelector("#try-again-overlay", { timeout: STILL_PREPARING_AT_MS + 10000 });
  const at = ((Date.now() - openedAt) / 1000).toFixed(1);
  const overlay = await viewPage.evaluate(() => ({
    title: document.querySelector(".try-again-title")?.textContent?.trim() || "",
    sub: document.querySelector(".try-again-sub")?.textContent?.trim() || "",
    back: document.querySelector(".try-again-btn")?.getAttribute("href") || null,
  }));
  log(`  at ${at}s:`, JSON.stringify(overlay));
  if (!/still preparing/i.test(overlay.title)) fail(`Expected the "still preparing" wording first, got "${overlay.title}".`);
  if (!overlay.back) fail("The patience overlay offers no way back.");
  if (overlay.back && !overlay.back.includes("/item/")) fail(`The overlay's way back does not lead to the dish: ${overlay.back}`);
  // It must not promise anything it cannot keep, and it must never show internal wording.
  if (/config|error|failed to load/i.test(overlay.sub)) fail(`The overlay shows internal wording to a diner: "${overlay.sub}"`);

  // ── the model finally lands ─────────────────────────────────────────────────────────────────
  log("\n=== Phase C: the model lands, and the guest is told — by name ===");
  await viewPage.waitForFunction(() => {
    const mv = document.querySelector("#mv");
    return mv && (mv.src || "").startsWith("blob:");
  }, undefined, { timeout: 40000 });
  // The blob lands on `src` BEFORE <model-viewer> has parsed the file and fired `load` — parsing a
  // 2 MB GLB and spinning up WebGL takes a moment — and it is `load` that clears the overlay. So
  // wait for the overlay to go, rather than sampling once and calling a slow parse a fault.
  log("  the model's file is in place; waiting for the overlay to clear itself");
  const overlayGone = await viewPage
    .waitForSelector("#try-again-overlay", { state: "detached", timeout: 25000 })
    .then(() => true).catch(() => false);
  if (!overlayGone) {
    fail("The model arrived but the 'still preparing' overlay never cleared — a guest would be told " +
      "the dish is still coming while it is on screen behind the card.");
  } else {
    log("  overlay cleared ✓");
  }

  // ── the ticket, from a page the guest has moved on to ───────────────────────────────────────
  log("\n=== Phase D: leaving before the model lands still earns a ticket, named correctly ===");
  await ctx.close(); ctx = null;
  const ctx2 = await browser.newContext(A35);
  const p2 = await ctx2.newPage();
  await holdModels(ctx2, 12000);
  await p2.goto(BASE + target, { waitUntil: "domcontentloaded", timeout: 30000 });
  await p2.waitForSelector("#view-3d-btn", { timeout: 20000 });
  await p2.click("#view-3d-btn");
  await p2.waitForURL(/\/view\//, { timeout: 20000 });
  const viewer2 = p2.url();
  await p2.waitForTimeout(2000);
  await p2.goBack();                       // leave before it is ready
  await p2.waitForURL(/\/item\//, { timeout: 20000 });
  let ticket = null;
  for (let i = 0; i < 50; i++) {
    ticket = await p2.evaluate(() => {
      const el = document.querySelector(".toast-ticket.toast-tappable");
      return el ? { text: el.innerText.replace(/\s+/g, " ").trim() } : null;
    });
    if (ticket) break;
    await p2.waitForTimeout(500);
  }
  if (!ticket) {
    fail("No 'your 3D is ready' ticket arrived after leaving a dish whose model was still loading.");
  } else {
    log("  ticket:", JSON.stringify(ticket.text));
    if (!/ready to view|in 3D/i.test(ticket.text)) fail(`The ticket does not read as a 3D-ready notice: ${ticket.text}`);
    // THE NAME MATTERS. The ticket used to be titled from the STATIC /content config, which
    // belongs to restaurant #1's flagship folder — so opening one dish produced a ticket naming a
    // different one, and every other restaurant (which ships no static config) got the raw model
    // folder slug as a dish name.
    if (dishTitle && !ticket.text.includes(dishTitle)) {
      fail(`The ticket names the wrong dish: it says "${ticket.text}" for "${dishTitle}".`);
    }
    await p2.click(".toast-ticket.toast-tappable");
    await p2.waitForTimeout(2000);
    const landed = p2.url();
    log("  tapping it lands on:", landed.replace(BASE, ""));
    const folder = decodeURIComponent(new URL(viewer2).pathname.split("/").pop());
    if (!decodeURIComponent(new URL(landed).pathname).includes(`/view/${folder}`)) {
      fail(`The ticket leads to ${landed} instead of the dish's own viewer (/view/${folder}).`);
    }
  }
  await ctx2.close();
} catch (e) {
  fail("Driver exception: " + (e?.message || String(e)));
} finally {
  await browser.close();
}

log("\n========================================");
log("Verdict:", verdict);
findings.forEach((f) => log(" -", f));
process.exit(verdict === "PASS" ? 0 : 1);
