#!/usr/bin/env node
// verify-tablet-floor.mjs — the waiter tablet's floor, walked the way a waiter walks it.
//
//   node scripts/verify-tablet-floor.mjs --base http://localhost:4000
//   node scripts/verify-tablet-floor.mjs --base https://3-d-backup.vercel.app --read-only
//
// WHY THIS EXISTS. On 2026-08-03 the tablet was rebuilt to look and work like the manager's
// table view: manager-style square tiles, a minimal top bar, ⚡ Quick order (build the order
// first, choose the table LAST), KOT operations at the TOP of the table popup, and ⚙️ Settings
// → Log out in the ☰ menu. Every fault found during that rebuild was invisible to the checks
// that existed, because each one was about what a PERSON SEES:
//
//   · merged tiles needed 115px of content inside an 87px square, so the progress bar was
//     sliced off flat — measured here on EVERY tile, at every size (a green suite is not
//     evidence that the screen is right);
//   · the filter chips and legend wrapped to two rows and pushed the first tile 270px down a
//     780px phone — the owner asked for the floor to be as big as possible, so that is measured;
//   · the restaurant's own name was truncated to "lit…" while a latency reading took the room —
//     a tenant may never lose its branding;
//   · a stray line of prose in the stylesheet silently discarded the rule that hides a tile's
//     wording when it doesn't fit (that one is now caught statically by verify:ui too);
//   · the ⚡ quick order's second step is the table PICKER — so it must not also ask a confirm,
//     while a per-table order must (two steps for anything important, never three).
//
// --read-only performs no writes at all (no order, no payment, no close): use it against a
// deployed site, or against AV LIVE, where verification is read-only by rule.
//
// It signs in ONCE via the shared cached helper (staff login is rate-limited and tripping it
// pings the owner's phone about himself), and it puts its own test table back by CLOSING the
// session — never by deleting, which the issued-bill rule rightly refuses.
import { chromium } from "playwright";
import { loginAs } from "./sweep/login.mjs";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const BASE = arg("--base", "http://localhost:4000").replace(/\/$/, "");
const READ_ONLY = process.argv.includes("--read-only");
const SHOTS = arg("--shots", "");

let failed = 0, passed = 0;
const ok = (m) => { passed++; console.log("  ok   " + m); };
const bad = (m) => { failed++; console.log("  FAIL " + m); };
const expect = (c, m) => (c ? ok(m) : bad(m));

const browser = await chromium.launch();
// hasTouch, because THIS PANEL IS A TOUCH PANEL and since 2026-08-16 the floor's tables-per-row
// rule asks the browser whether the pointer is a finger: a mouse gets the admin's number at any
// window size, a touchscreen gets 2 upright / 4 turned below ~10.5in. Resizing a MOUSE browser to
// 360px is a laptop window, not a phone — so without this every "iPhone 390px" / "A35 360px" check
// below measured a 12-per-row laptop floor squeezed into a phone's width (22px tiles) and reported
// it as the phone being broken. The pass at the bottom of this file already emulated touch for
// exactly this reason; this brings the device walk in line with it.
const ctx = await browser.newContext({ viewport: { width: 1194, height: 834 }, hasTouch: true });
await loginAs(ctx, "tablet", BASE);
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

// /tablet hosts the panel in an IFRAME, so every panel selector runs in that frame.
const frameOf = async (p) => {
  for (let i = 0; i < 80; i++) {
    const f = p.frames().find((fr) => fr.url().includes("/panels/tablet"));
    if (f) return f;
    await p.waitForTimeout(250);
  }
  throw new Error("the tablet panel frame never appeared");
};
await page.goto(BASE + "/tablet", { waitUntil: "domcontentloaded" });
let F = await frameOf(page);
await F.waitForSelector(".tile[data-t]", { timeout: 30000 });
await page.waitForTimeout(1800);                    // settings + floor summary settle

const shot = (n) => (SHOTS ? page.screenshot({ path: `${SHOTS}/${n}.png` }) : Promise.resolve());
// IS IT REALLY ON SCREEN? `offsetParent !== null` is the usual shorthand and it is WRONG for a
// fixed-position element — the spec says offsetParent is null for those — and this panel's order
// screen, settings sheet and table picker are all `position: fixed`. So every `vis()` on them
// answered "not visible" while they were covering the whole panel: the reset helper did nothing,
// and "the order screen closes again" passed without the screen ever closing. Measure the box and
// the computed styles instead (2026-08-04).
const vis = (sel) => F.evaluate((s) => {
  const e = document.querySelector(s);
  if (!e) return false;
  const cs = getComputedStyle(e);
  if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) return false;
  const r = e.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}, sel).catch(() => false);
// A picker (Change table / Move a KOT / the KOT menu) REUSES the .detail-pop card and its own
// hook is the ✕ .picker-back. Telling them apart matters: reading "the discount button isn't
// there" off a picker is a claim about the wrong screen.
const onPopup = async () => (await vis(".detail-pop")) && !(await vis(".picker-back"));
const onPicker = () => vis(".picker-back");
// One hardware-BACK press. If the frame DETACHES, the panel navigated away — that is the
// back button leaving the app, which is a real fault, so it is reported rather than thrown.
let leftThePanel = false;
const backOnce = async () => {
  try { await F.evaluate(() => history.back()); } catch (e) { leftThePanel = true; return; }
  await page.waitForTimeout(1000);
};
// Close an open popup the way a finger does, WITHOUT spending a history entry — so a check
// that comes later still knows how deep the back-stack is (mixing the two is what made this
// script's own back assertions drift out of step).
const closePopup = async () => {
  if (await vis(".detail-pop #detailClose")) { await F.click(".detail-pop #detailClose"); await page.waitForTimeout(800); }
  else if (await vis(".picker-back")) { await F.click(".picker-back"); await page.waitForTimeout(800); }
};
// A BACK assertion starts from a KNOWN history depth. Closing a layer with its ✕ deregisters
// the back-stack layer without spending its history entry, so mixing ✕ and BACK in one run
// drifts the depth and a later BACK sails past the panel and leaves it — which looked like a
// product fault the first time and was this script's own bookkeeping. Reload, then press once.
const freshPanel = async () => {
  await page.goto(BASE + "/tablet", { waitUntil: "domcontentloaded" });
  const f = await frameOf(page);
  await f.waitForSelector(".tile[data-t]", { timeout: 30000 });
  await page.waitForTimeout(1600);
  return f;
};

// EVERY SECTION STARTS ON THE FLOOR. Each block opens something — a builder, a popup, a
// picker, the drawer, the settings sheet — and any one left up covers the panel, so the NEXT
// block's first tap lands on it and waits for a control that will never be clickable. Three
// separate flakes in this file were that, dressed differently, before this existed.
const resetToFloor = async () => {
  // Driven through the panel's OWN exits rather than by hunting for buttons: the order screen
  // has two states and only one of them has #omExit (the review screen's back button is
  // #voBack), so a click-based reset silently waited out a 30s timeout per attempt on the
  // other. A reset is plumbing — it may use the app's exit functions; the ASSERTIONS never do.
  for (let i = 0; i < 4; i++) {
    const state = await F.evaluate(() => {
      const onScreen = (e) => { if (!e) return false; const c = getComputedStyle(e); if (c.display === "none" || c.visibility === "hidden" || Number(c.opacity) === 0) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
      const seen = (s) => onScreen(document.querySelector(s));
      if (seen(".set-overlay")) { document.querySelector(".set-overlay .set-close").click(); return "settings"; }
      if (seen(".qdest-overlay")) { document.querySelector(".qdest-overlay .qdest-x").click(); return "dest"; }
      if (seen(".tbl-drawer.open")) { document.querySelector(".tbl-drawer .dw-close").click(); return "drawer"; }
      if (seen(".om.lite")) { try { exitOrderMode(); } catch { const b = document.querySelector("#omExit, #voBack"); if (b) b.click(); } return "order"; }
      if (seen(".picker-back")) { document.querySelector(".picker-back").click(); return "picker"; }
      if (seen(".detail-pop")) { document.querySelector(".detail-pop #detailClose").click(); return "popup"; }
      return "floor";
    }).catch(() => "unknown");
    if (state === "floor") return true;
    await page.waitForTimeout(700);
  }
  // LAST RESORT: reload. A screen that won't close is not something a later section should
  // have to cope with, and a reload is the one move that always lands on a bare floor. Cheap
  // (~4s) and it cannot fail quietly the way a click on a button that isn't there does.
  console.log("  ..   a screen wouldn't close — reloading the panel to get back to the floor");
  F = await freshPanel();
  return !(await vis(".om.lite")) && !(await vis(".detail-pop")) && !(await vis(".set-overlay"));
};

// ── 1 · the minimal top bar ───────────────────────────────────────────────────
expect(!(await F.$("#counts")), "top bar: no live order counters (the owner asked for them gone)");
expect(!(await F.$("#clock")), "top bar: no clock (it lives in the ☰ menu)");
expect(await vis("#hamburger"), "top bar: ☰ menu");
expect(await vis("#quickOrderBtn"), "top bar: ⚡ Quick order is always there");
const barH = await F.evaluate(() => document.querySelector(".topbar").getBoundingClientRect().height);
expect(barH <= 64, `top bar is slim — ${Math.round(barH)}px (≤64)`);

// ── 2 · the floor reads like the manager's ────────────────────────────────────
expect(await vis("#floorNav"), "the one filter strip (All / Needs / Active / Free) is present");
const legend = (await F.textContent("#floorLegend").catch(() => "")) || "";
expect(/Free/.test(legend) && /Preparing/.test(legend) && /unpaid/.test(legend), "the one-line legend explains the colours and the rings");
const grid = await F.evaluate(() => {
  const g = document.getElementById("tiles");
  const t = g.querySelector(".tile").getBoundingClientRect();
  // The EFFECTIVE number is the computed --per-row, not the inline one. Since 2026-08-15 the panel
  // writes the restaurant's setting as `--per-row-pc` and the stylesheet's screen bands turn it
  // into `--per-row` (2 on a phone, 4 turned, the setting from 1024px up), so reading the inline
  // property gave "" here and every count below came out 0.
  return { cols: getComputedStyle(g).gridTemplateColumns.split(" ").length,
    perRow: getComputedStyle(g).getPropertyValue("--per-row").trim(),
    perRowSet: g.style.getPropertyValue("--per-row-pc").trim(), w: t.width, h: t.height };
});
expect(grid.perRowSet !== "", `tiles-per-row comes from the restaurant's own setting (${grid.perRowSet})`);
expect(String(grid.cols) === grid.perRow, `the floor draws exactly ${grid.perRow} per row (got ${grid.cols}) — same rule as the manager`);
expect(Math.abs(grid.w - grid.h) / grid.w < 0.35, `tiles are square (${Math.round(grid.w)}×${Math.round(grid.h)})`);
expect(await F.evaluate(() => { const n = document.querySelector(".tile .tnum"); return !!n && n.offsetParent !== null && n.textContent.trim() !== ""; }), "every tile shows its table number");
await shot("floor-desktop");

// ── 3 · NO TILE MAY CLIP ITS OWN CONTENT, at any size ─────────────────────────
// A tile is a square with overflow:hidden, so anything that doesn't fit is SLICED with no
// error anywhere. Measured, never eyeballed: scrollHeight vs clientHeight on every tile.
const clipReport = async (tag) => {
  const clipped = await F.evaluate(() => [...document.querySelectorAll(".tile")]
    .filter((t) => t.scrollHeight > t.clientHeight + 1)
    .map((t) => `T${t.dataset.t} needs ${t.scrollHeight}px in ${t.clientHeight}px`));
  expect(clipped.length === 0, clipped.length ? `${tag}: tiles clip their content — ${clipped.join(", ")}` : `${tag}: no tile clips its content`);
};
await clipReport("desktop 1194px");

// ── 4 · SHED DETAIL ON THE WAY DOWN, and never the number or the colour ───────
// At each size the tile drops the least important thing rather than clipping. The table
// number, the state colour and the progress bar are what must ALWAYS survive.
for (const [w, h, tag] of [[1194, 834, "tablet 1194px"], [1024, 768, "iPad 1024px"], [780, 360, "landscape 780px"], [390, 844, "iPhone 390px"], [360, 780, "A35 360px"]]) {
  await page.setViewportSize({ width: w, height: h });
  await page.waitForTimeout(800);
  const m = await F.evaluate(() => {
    const tiles = [...document.querySelectorAll(".tile")];
    // Measure a tile that HAS dishes, so the progress bar is one this tile really draws.
    const busy = tiles.find((x) => !/t-merged/.test(x.className) && /t-prep|t-new|t-bill/.test(x.className));
    const t = busy || tiles[0];
    const cs = getComputedStyle(t);
    const seen = (sel) => { const e = t.querySelector(sel); return !!e && getComputedStyle(e).display !== "none"; };
    // THE BAR IS MEASURED, NOT MERELY LOOKED FOR. This used to read
    // `seen(".tstrip") || !t.querySelector(".tstrip")`, which is true when the bar is there
    // AND true when it is absent — an assertion that could not fail (caught in review,
    // 2026-08-04). A drawn bar has real width and real height; that is the claim.
    const barEl = busy ? t.querySelector(".tstrip") : null;
    const barBox = barEl ? barEl.getBoundingClientRect() : null;
    const doc = document.documentElement;
    const nameEl = document.getElementById("restName");
    return {
      outer: Math.round(t.getBoundingClientRect().width),
      content: Math.round(t.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)),
      num: seen(".tnum"),
      hadBusy: !!busy,
      barW: barBox ? Math.round(barBox.width) : -1,
      barH: barBox ? Math.round(barBox.height) : -1,
      clip: tiles.filter((x) => x.scrollHeight > x.clientHeight + 1).length,
      ovf: doc.scrollWidth > doc.clientWidth + 1,
      firstTop: Math.round(tiles[0].getBoundingClientRect().top),
      onScreen: tiles.filter((x) => x.getBoundingClientRect().bottom <= window.innerHeight).length,
      // TRUNCATION, not emptiness. "not empty" passed happily on "little Fren…" — the very
      // fault this check was written for (caught in review, 2026-08-04).
      name: nameEl ? { text: nameEl.textContent.trim(), cut: nameEl.scrollWidth > nameEl.clientWidth + 1, w: Math.round(nameEl.clientWidth), need: nameEl.scrollWidth } : null,
      qo: (() => { const onScreen = (e) => { if (!e) return false; const c = getComputedStyle(e); if (c.display === "none" || c.visibility === "hidden" || Number(c.opacity) === 0) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; }; return onScreen(document.getElementById("quickOrderBtn")); })(),
    };
  });
  expect(m.clip === 0, `${tag}: no tile clips (tile ${m.outer}px, ${m.content}px inside)`);
  expect(m.num, `${tag}: the table number survives`);
  if (m.hadBusy) expect(m.barW > 8 && m.barH >= 2, `${tag}: a busy tile's progress bar is really drawn (${m.barW}×${m.barH}px)`);
  else ok(`${tag}: no busy tile on the floor to measure a progress bar on`);
  expect(!m.ovf, `${tag}: the page does not scroll sideways`);
  expect(m.qo, `${tag}: ⚡ Quick order is reachable`);
  // The floor must GET the screen — the owner's words were "as big as possible".
  if (w <= 420) {
    expect(m.firstTop <= 200, `${tag}: the first tile starts ${m.firstTop}px down (≤200)`);
    expect(m.onScreen >= 6, `${tag}: ${m.onScreen} tiles visible without scrolling (≥6)`);
    expect(m.name && !m.name.cut, m.name
      ? `${tag}: the restaurant's own name fits WHOLE on the bar — "${m.name.text}" (${m.name.w}px for ${m.name.need}px)`
      : `${tag}: the restaurant name element is missing from the bar`);
  }
  await shot(`floor-${w}`);
}
await page.setViewportSize({ width: 1194, height: 834 });
await page.waitForTimeout(700);

// ── 4b · THE iPHONE HOME BAR AND THE SAMSUNG NAVIGATION BAR ───────────────────
// Owner, 2026-08-03: "for the iPhone where you have to close the app from the bottom, for the
// Samsung where there is a navigation bar — make it whole dynamic." The host (PanelFrame)
// measures the real insets and pushes them in as --safe-t / --safe-b, so simulating them is
// exactly what a real device does. Anything a finger must reach has to sit ABOVE that band —
// otherwise the control is behind the home bar and a swipe closes the app instead.
{
  await page.setViewportSize({ width: 390, height: 844 });                 // iPhone-ish
  await page.waitForTimeout(600);
  // The insets are SET AND MEASURED inside ONE synchronous evaluate. The host (PanelFrame)
  // re-writes --safe-t / --safe-b on resize and on a timer with the REAL device values, which
  // are 0 in a headless desktop browser — so setting them, awaiting, then measuring reads
  // whatever won the race and this check flip-flopped between 46px and 12px. A style change
  // followed by a layout read in the same task cannot be raced.
  // WHAT ACTUALLY SITS LOW, not a fixed list that lives at the top. The first version named
  // ☰ / ⚡ / the filter chips — all of which are ~100px from the TOP — and skipped the last
  // tile because it was below the fold, so its `under` array was empty by construction and
  // the headline claim could never fail (caught in review, 2026-08-04). Now it scrolls to the
  // very bottom and judges whatever is genuinely down there: the LAST VISIBLE tile, plus any
  // control the panel is showing.
  const measureInsets = (sel, opts = {}) => F.evaluate(({ s, scrollFirst }) => {
    const SAT = 47, SAB = 34, root = document.documentElement;
    const prevT = root.style.getPropertyValue("--safe-t"), prevB = root.style.getPropertyValue("--safe-b");
    root.style.setProperty("--safe-t", SAT + "px");
    root.style.setProperty("--safe-b", SAB + "px");
    // INSETS FIRST, THEN SCROLL. Applying them grows the page by the reserved band, so a scroll
    // taken beforehand ends up exactly that far short of the new bottom — which read as "the
    // last tile is 35px under the home bar" when it was the measurement that was stale.
    if (scrollFirst) { void root.offsetHeight; window.scrollTo(0, document.body.scrollHeight); }
    const cs = getComputedStyle(document.querySelector(s));               // forces a sync recalc
    const out = { padT: parseFloat(cs.paddingTop), padB: parseFloat(cs.paddingBottom), under: [], judged: [] };
    const vh = window.innerHeight, band = vh - SAB;
    const judge = (label, el) => {
      const onScreen = (e) => { if (!e) return false; const c = getComputedStyle(e); if (c.display === "none" || c.visibility === "hidden" || Number(c.opacity) === 0) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; }; if (!onScreen(el)) return;
      const r = el.getBoundingClientRect();
      if (r.bottom <= 0 || r.top >= vh) return;                           // genuinely off screen
      out.judged.push(`${label}@${Math.round(r.bottom)}`);
      if (r.bottom > band + 1) out.under.push(`${label} (bottom ${Math.round(r.bottom)} of ${vh}; the band starts at ${band})`);
    };
    // the LOWEST tile that is actually on screen after scrolling to the end
    const onScreen = [...document.querySelectorAll(".tile")].filter((t) => { const r = t.getBoundingClientRect(); return r.top < vh && r.bottom > 0; });
    if (onScreen.length) judge(`lowest visible tile (T${onScreen[onScreen.length - 1].dataset.t})`, onScreen[onScreen.length - 1]);
    for (const q of ["#hamburger", "#quickOrderBtn", ".fnav", "#sendOrder", ".om-viewpill", ".detail-pop #closeTable", ".detail-pop #payBill", ".dw-btn.danger"]) {
      judge(q, document.querySelector(q));
    }
    root.style.setProperty("--safe-t", prevT); root.style.setProperty("--safe-b", prevB);
    if (scrollFirst) window.scrollTo(0, 0);
    return out;
  }, { s: sel, scrollFirst: !!opts.scrollFirst });

  const floorIn = await measureInsets(".layout", { scrollFirst: true });
  // The check has to have LOOKED at something low, or "nothing is under the bar" is a claim
  // about an empty list.
  expect(floorIn.judged.length >= 2, `the inset check actually measured what's on screen (${floorIn.judged.join(" ") || "nothing"})`);
  expect(floorIn.under.length === 0, floorIn.under.length ? `controls sit under the home bar / nav bar: ${floorIn.under.join(", ")}` : `nothing a finger needs sits under the iPhone home bar / Samsung nav bar (judged ${floorIn.judged.join(" ")})`);
  expect(floorIn.padB >= 34, `the floor reserves the bottom inset (${Math.round(floorIn.padB)}px ≥ 34)`);
  const barIn = await measureInsets(".topbar");
  expect(barIn.padT >= 47, `the top bar clears the notch (${Math.round(barIn.padT)}px ≥ 47)`);
  await shot("safe-area-iphone");
  // the same for the order screen, which is 100dvh and easy to forget
  if (await vis("#quickOrderBtn")) {
    await F.click("#quickOrderBtn");
    await F.waitForSelector(".om.lite", { timeout: 8000 });
    const om = await measureInsets(".om.lite");
    expect(om.padB >= 34, `the order screen reserves the bottom inset (${Math.round(om.padB)}px ≥ 34)`);
    expect(om.padT >= 47, `the order screen clears the notch (${Math.round(om.padT)}px ≥ 47)`);
    expect(om.under.length === 0, om.under.length ? `order-screen controls under the band: ${om.under.join(", ")}` : "the order screen's own controls clear the band too");
    await shot("safe-area-order");
    // …and leave the screen as we found it, provably: a builder left open covers the panel and
    // every later section's first tap lands on it instead of the control it wanted.
    await resetToFloor();
    expect(!(await vis(".om.lite")), "the order screen closes again after being measured");
  }
  await page.setViewportSize({ width: 1194, height: 834 });
  await page.waitForTimeout(700);
}

// ── 5 · BOTH SKINS: no label may sink into its background ─────────────────────
const flipTheme = async () => {
  await resetToFloor();
  await F.click("#hamburger");
  await F.waitForSelector(".tbl-drawer.open", { timeout: 8000 });
  await F.click("#dwTheme");
  await page.waitForTimeout(700);
  await F.click(".tbl-drawer .dw-close");
  await page.waitForTimeout(600);
};
const measureSkin = async () => {
  const skin = await F.evaluate(() => document.documentElement.getAttribute("data-theme") || "light");
  const contrast = await F.evaluate(() => {
    // color-mix() computes to `color(srgb 0.79 …)` (0..1) while plain colours are `rgb(20, 17, 13)`
    // (0..255). Reading both on one scale is how an earlier version of this check "found" a fault
    // in text that is actually near-white on near-black — a broken measurement, reported as a bug.
    const lum = (c) => {
      let m = (c.match(/[\d.]+/g) || ["0", "0", "0"]).map(Number);
      if (/^color\(/.test(c)) m = m.map((x) => x * 255);
      return 0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2];
    };
    const out = [];
    for (const sel of [".tile .tnum", ".tile .t-linenum", ".tile .tseats", ".tile .tmerge", ".fnav", ".floor-legend .lgi", ".brand"]) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const s = getComputedStyle(el);
      if (s.backgroundImage !== "none") continue;              // painted with a gradient — not measurable this way
      let bgEl = el, bg = s.backgroundColor, grad = false;
      while (bgEl && (bg === "rgba(0, 0, 0, 0)" || bg === "transparent")) {
        bgEl = bgEl.parentElement;
        if (!bgEl) break;
        const bs = getComputedStyle(bgEl);
        if (bs.backgroundImage !== "none") { grad = true; break; }
        bg = bs.backgroundColor;
      }
      if (grad) bg = getComputedStyle(document.body).backgroundColor;   // the honest worst case
      out.push({ sel, d: Math.abs(lum(s.color) - lum(bg || "rgb(255,255,255)")) });
    }
    return out;
  });
  const faint = contrast.filter((c) => c.d < 18).map((c) => `${c.sel} Δ${Math.round(c.d)}`);
  expect(faint.length === 0, faint.length ? `${skin} skin: text sinks into its background — ${faint.join(", ")}` : `${skin} skin: every floor label keeps real contrast`);
  await shot(`floor-skin-${skin}`);
};
await measureSkin();
await flipTheme();
await measureSkin();
await flipTheme();                                   // leave the skin as we found it

expect(await resetToFloor(), "back on the floor before the merged-tile check");
// ── 5b · A MERGED TABLE OPENS ITS PARTY, it never starts a new order ──────────
// A joined table has no session of its own, so its own summary row reads "free". Taking that
// at face value sent a tap on T7 (merged into T6) into a brand-new order and left the waiter
// no way to reach the party's bill, KOT ▾, ✕ Close or 💳 Mark paid — the exact lie mig 249
// exists to stop. Caught in review on 2026-08-03; asserted here by really tapping the tile.
{
  const merged = await F.evaluate(() => {
    const m = (window.LFH_TEST_MERGES || null);
    const el = document.querySelector(".tile.t-merged[data-t]");
    return el ? el.dataset.t : (m || null);
  });
  if (!merged) ok("no merged party on the floor right now — the merged-tile check needs one, skipped");
  else {
    await F.click(`.tile[data-t="${merged}"] .t-line`);      // the tile body, not an action
    await page.waitForTimeout(1600);
    const what = await F.evaluate(() => ({
      detail: !!document.querySelector(".detail-pop"),
      builder: !!document.querySelector(".om.lite"),
      head: (document.querySelector(".detail-pop h2") || document.querySelector(".om.lite .om-head h2") || {}).textContent || "",
    }));
    expect(what.detail && !what.builder, `a merged table (T${merged}) opens the PARTY's detail, not a new order (got ${what.builder ? "the order builder" : "the detail"}: ${what.head.trim()})`);
    if (what.detail) {
      expect(await vis(".detail-pop #closeTable") || await vis(".detail-pop .phead-ops"), "…and from there the party's bill controls are reachable");
      await closePopup();                                  // ✕, not BACK — keeps the stack depth honest
    } else if (what.builder) { await F.click("#omExit").catch(() => {}); await page.waitForTimeout(800); }
  }
}

expect(await resetToFloor(), "back on the floor before the popup checks");
// ── 6 · the table popup: KOT operations on TOP, money + close at the bottom ───
const busyT = await F.evaluate(() => {
  const t = [...document.querySelectorAll(".tile")].find((x) => !/t-free/.test(x.className));
  return t && t.dataset.t;
});
if (!busyT) ok("no occupied table on the floor right now — the popup checks need one, skipped");
else {
  await F.click(`.tile[data-t="${busyT}"]`);
  await F.waitForSelector(".detail-pop", { timeout: 10000 });
  await F.waitForSelector(".detail-pop .phead-ops", { timeout: 12000 }).catch(() => {});
  const opsAbove = await F.evaluate(() => {
    const ops = document.querySelector(".detail-pop .phead-ops");
    const body = document.querySelector(".detail-pop .detail-body");
    return !!(ops && body && ops.getBoundingClientRect().top < body.getBoundingClientRect().top);
  });
  expect(opsAbove, "popup: the KOT / table-operations row sits ABOVE the orders");
  // THE ACTIONS ARE ON SCREEN WITHOUT SCROLLING, on the busiest table the floor has. A long
  // order used to push ＋ Take order / 💳 Mark bill paid / ✕ Close table ~1100px below the fold
  // on a phone, and no check noticed because Playwright scrolls an element into view before it
  // clicks (caught in review, 2026-08-04 — the third time this panel buried its primary action).
  // Measured at 360px, where it actually hurts.
  {
    await page.setViewportSize({ width: 360, height: 780 });
    await page.waitForTimeout(900);
    const reach = await F.evaluate(() => {
      const card = document.querySelector(".detail-pop");
      if (!card) return null;
      const vis = (sel) => {
        const el = card.querySelector(sel);
        const onScreen = (e) => { if (!e) return false; const c = getComputedStyle(e); if (c.display === "none" || c.visibility === "hidden" || Number(c.opacity) === 0) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; }; if (!onScreen(el)) return null;
        const r = el.getBoundingClientRect(), c = card.getBoundingClientRect();
        return { inCard: r.bottom <= c.bottom + 1 && r.top >= c.top - 1, bottom: Math.round(r.bottom), cardBottom: Math.round(c.bottom) };
      };
      const body = card.querySelector(".detail-body");
      return { take: vis("#takeOrder"), close: vis("#closeTable"), bodyScrolls: body ? body.scrollHeight > body.clientHeight : false, content: body ? body.scrollHeight : 0 };
    });
    if (reach && reach.take) expect(reach.take.inCard, `360px: ＋ Take order is reachable without scrolling (its bottom ${reach.take.bottom} vs the card's ${reach.take.cardBottom}; ${reach.content}px of orders above it)`);
    if (reach && reach.close) expect(reach.close.inCard, `360px: ✕ Close table is reachable without scrolling (its bottom ${reach.close.bottom} vs the card's ${reach.close.cardBottom})`);
    if (reach) expect(reach.bodyScrolls || reach.content < 600, "360px: it is the ORDERS that scroll inside the card, not the card past its own buttons");
    await shot("popup-360-reach");
    await page.setViewportSize({ width: 1194, height: 834 });
    await page.waitForTimeout(800);
  }
  const opsTxt = (await F.textContent(".detail-pop .phead-ops").catch(() => "")) || "";
  expect(/KOT|Move|Table type/i.test(opsTxt), `popup: its top row carries the table operations (${opsTxt.replace(/\s+/g, " ").trim()})`);
  await shot("table-popup");

  // ‹ › STEP BETWEEN TABLES WITHOUT CLOSING — "toggle the tables very fast".
  {
    const step = await F.evaluate(() => {
      const bs = [...document.querySelectorAll("[data-step-table]")];
      return { n: bs.length, targets: bs.map((b) => b.dataset.stepTable), before: (document.querySelector(".detail-pop h2") || {}).textContent };
    });
    expect(step.n === 2, `the popup carries ‹ › to step tables (found ${step.n})`);
    if (step.n === 2) {
      const nextT = step.targets[1];
      await F.click(`[data-step-table="${nextT}"]`);
      await page.waitForTimeout(1600);
      const after = await F.evaluate(() => ({
        head: (document.querySelector(".detail-pop h2") || {}).textContent || "",
        stillOpen: !!document.querySelector(".detail-pop"),
      }));
      expect(after.stillOpen, "…and stepping keeps the popup open (no close-then-reopen)");
      expect(after.head.trim() !== (step.before || "").trim(), `…and it really moved on (${(step.before || "").trim()} → ${after.head.trim()})`);
      // step back to the table the rest of this section expects
      await F.click(`.tile[data-t="${busyT}"]`).catch(() => {});
      await F.waitForSelector(".detail-pop .phead-ops", { timeout: 10000 }).catch(() => {});
    }
  }

  // A KOT operation opens its OWN picker — the pick is that operation's second step.
  // Retried ONCE: this panel is live, so a realtime refresh landing on the same tick can
  // repaint the menu away between the open and the tap. A retry tells "the code is wrong"
  // apart from "the floor moved under the test" — and the panel now guards the repaint
  // (state.pickerOpen), so a second failure is a real one.
  if (await vis("#kotMenuBtn")) {
    let opened = false, which = "";
    for (let a = 1; a <= 2 && !opened; a++) {
      if (!(await vis("#kotMenuBtn"))) { await closePopup(); await F.click(`.tile[data-t="${busyT}"]`); await F.waitForSelector(".detail-pop .phead-ops", { timeout: 10000 }).catch(() => {}); }
      await F.click("#kotMenuBtn");
      const menu = await F.waitForSelector("[data-kotop]", { timeout: 8000 }).catch(() => null);
      if (!menu) continue;
      which = await F.evaluate(() => { const b = [...document.querySelectorAll("[data-kotop]")].find((x) => !x.disabled); return b && b.dataset.kotop; });
      if (!which) { ok("every KOT operation is correctly disabled for this table"); opened = true; break; }
      await F.click(`[data-kotop='${which}']`);
      await page.waitForTimeout(1400);
      opened = await onPicker();
    }
    if (which) expect(opened, `"${which}" opens its own picker — the PICK is its second step`);
    if (opened) await shot("kot-picker");
  }
  await closePopup();

  // ── the hardware BACK, from a KNOWN depth: reload, open ONE layer, press once. ──
  F = await freshPanel();
  await F.click(`.tile[data-t="${busyT}"]`);
  await F.waitForSelector(".detail-pop", { timeout: 10000 });
  await page.waitForTimeout(1200);
  await backOnce();
  expect(!leftThePanel, "BACK peels a layer — it never navigates the panel away");
  expect(!(await vis(".detail-pop")), "BACK closes the table popup and lands on the floor");
  expect(await vis("#tiles"), "…with the floor still there");
}

expect(await resetToFloor(), "back on the floor before the ☰ menu checks");
// ── 7 · ☰ → ⚙️ Settings → Log out; no parcel on the tablet ────────────────────
await F.click("#hamburger");
await F.waitForSelector(".tbl-drawer.open", { timeout: 6000 });
expect(!(await F.$("#dwParcel")), "☰ menu: no parcel entry (parcels are a manager feature)");
expect(await vis("#dwSettings"), "☰ menu: ⚙️ Settings");
await F.click("#dwSettings");
await F.waitForSelector(".set-overlay", { timeout: 6000 });
// LOG OUT IS A REAL BUTTON, IN BOTH SKINS. It shipped as a browser-default hyperlink —
// 55×18px, underlined, #0000EE, about 1.9:1 against the dark panel — because the .dw-btn look
// was scoped to .tbl-drawer and this sheet is mounted outside it. The old check only asked
// `offsetParent !== null`, which an invisible link satisfies (caught in review, 2026-08-04).
//
// IT IS NOW A FORM POSTING TO /api/panel-logout, not a link (T9 improvement 13, 2026-08-06):
// /api/panel-logout is POST-only, because a GET that ends a session fires from anything that merely
// POINTS at the URL — a waiter could be signed out mid-service. This selector was still hunting for
// the old `<a href>` and so reported the control MISSING when it was there and correct (measured on
// the live tablet: 324×45px, Δ152 on the dark skin, Δ179 on the light, weight 700, no underline).
// Both shapes are accepted so the check keeps working whichever way it is built; what it actually
// guards — that the thing is a real, readable control in BOTH skins — is unchanged.
{
  const lo = await F.evaluate(() => {
    const el = document.querySelector('.set-overlay form[action="/api/panel-logout"] button')
            || document.querySelector('.set-overlay a[href="/api/panel-logout"]');
    if (!el) return null;
    const lum = (c) => { let m = (c.match(/[\d.]+/g) || [0, 0, 0]).map(Number); if (/^color\(/.test(c)) m = m.map((x) => x * 255); return 0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]; };
    const contrastNow = () => {
      const cs = getComputedStyle(el);
      let bgEl = el, bg = cs.backgroundColor;
      while (bgEl && (bg === "rgba(0, 0, 0, 0)" || bg === "transparent")) { bgEl = bgEl.parentElement; bg = bgEl ? getComputedStyle(bgEl).backgroundColor : "rgb(255,255,255)"; }
      return Math.abs(lum(cs.color) - lum(bg));
    };
    // BOTH SKINS, in one synchronous pass. The default hyperlink this shipped as was #0000EE:
    // perfectly readable on the LIGHT panel (Δ194) and about 1.9:1 on the DARK one — so a check
    // that only measures whichever skin happens to be active would have called it fine.
    const root = document.documentElement, was = root.getAttribute("data-theme");
    const per = {};
    for (const skin of ["light", "dark"]) { root.setAttribute("data-theme", skin); per[skin] = contrastNow(); }
    if (was) root.setAttribute("data-theme", was); else root.removeAttribute("data-theme");
    const cs = getComputedStyle(el), r = el.getBoundingClientRect();
    return { h: Math.round(r.height), w: Math.round(r.width), radius: parseFloat(cs.borderTopLeftRadius) || 0, weight: cs.fontWeight, per };
  });
  expect(!!lo, "Settings holds Log out");
  if (lo) {
    expect(lo.h >= 40, `Log out is a real touch target (${lo.w}×${lo.h}px, ≥40 tall)`);
    expect(lo.radius >= 6 && Number(lo.weight) >= 600, `Log out wears the panel's button look, not a browser default (radius ${lo.radius}, weight ${lo.weight})`);
    const faint = Object.entries(lo.per).filter(([, d]) => d < 40).map(([s, d]) => `${s} Δ${Math.round(d)}`);
    expect(faint.length === 0, faint.length
      ? `Log out sinks into the panel — ${faint.join(", ")} (need Δ40 in BOTH skins)`
      : `Log out is readable in BOTH skins (light Δ${Math.round(lo.per.light)}, dark Δ${Math.round(lo.per.dark)})`);
  }
}
await shot("settings");
await F.click(".set-overlay .set-close");
await page.waitForTimeout(600);

expect(await resetToFloor(), "back on the floor before the live order loop");
// ── 8 · ⚡ QUICK ORDER: build first, pick the table LAST — and that pick sends ──
// This is the only part that writes, so --read-only stops here. The order it places is put
// back by CLOSING the table (never deleted — an issued bill may not be erased).
if (READ_ONLY) {
  ok("read-only run: the live order → serve → pay → close loop was not walked (by design)");
} else {
  let loopOk = false, why = "";
  // EVERY ATTEMPT PUTS ITS TABLE BACK, including the ones that give up half way. Before this,
  // each `soft(...) ; continue` abandoned a table that already had a real order on it (possibly
  // accepted, served and PAID), so a bad run could leave three orphaned parties on the demo
  // floor while the file header claimed it cleaned up after itself (caught in review,
  // 2026-08-04). Closing is the only correct way back — an order gets a bill number on insert,
  // so deleting it is refused by the issued-bill rule, and rightly.
  const opened = new Set();
  const sweepUp = async () => {
    for (const t of [...opened]) {
      try {
        const sid = await page.evaluate(async ([base, tbl]) => {
          const r = await fetch(`${base}/api/tablet/state?table=${encodeURIComponent(tbl)}`, { headers: { "Content-Type": "application/json" } });
          if (!r.ok) return null;
          const j = await r.json();
          const s = (j.sessions || []).find((x) => String(x.table_number) === String(tbl) && x.status !== "closed");
          return s ? s.id : null;
        }, [BASE, t]);
        if (!sid) { opened.delete(t); continue; }
        await page.evaluate(async ([base, id]) => {
          await fetch(`${base}/api/tablet/sessions/${id}/close`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ force: true }) });
        }, [BASE, sid]);
        console.log(`  ..   swept up: closed the test party on table ${t}`);
        opened.delete(t);
      } catch (e) { console.log(`  ..   could NOT sweep up table ${t}: ${e.message} — close it by hand`); }
    }
  };
  try {
  for (let attempt = 1; attempt <= 3 && !loopOk; attempt++) {
    const soft = (m) => { why = m; console.log(`  ..   attempt ${attempt}: ${m}`); };
    // START FROM A KNOWN SCREEN. An earlier section opens the order builder to measure it, and
    // if its ← back didn't land (or a live refresh reopened it) the builder covers the whole
    // panel — so this section's first tap hit `.om-head` and waited 30s for a button that was
    // never going to be clickable. Never assume the screen the last block left behind.
    if (!(await resetToFloor())) { soft("a screen was stuck open before this attempt"); continue; }
    await F.click("#quickOrderBtn");
    await F.waitForSelector(".om.lite", { timeout: 10000 });
    if (attempt === 1) expect((await F.textContent(".om.lite .om-head h2")).includes("Quick order"), "⚡ Quick order opens the dish browser with NO table chosen yet");
    await F.click(".dish:not(.out)");
    await page.waitForTimeout(400);
    // TWO LAYOUTS, AND ONLY A TOUCH DEVICE SEES THE SECOND ONE. On a touchscreen held sideways the
    // ⚡ Quick order screen is TWO PANES — dishes on the left, the order on the right — so the
    // bottom "View order" pill has nothing to do and the stylesheet hides it
    // (`@media (orientation: landscape) and (pointer: coarse)`, an approved design). There is no
    // separate review step there: Send is already on screen. This walk only started running in
    // touch mode on 2026-08-16, which is why it had never met that layout and clicked a button that
    // was `display: none`, waiting 30s for it.
    const hasPill = await F.evaluate(() => { const b = document.querySelector("#omViewBtn"); return !!b && !!b.offsetParent; });
    if (hasPill) {
      await F.click("#omViewBtn");
      await F.waitForSelector(".om.lite.vieworder", { timeout: 8000 });
      if (attempt === 1) ok("the bottom View-order pill opens the review step (single-pane layout)");
    } else if (attempt === 1) {
      ok("sideways on a touchscreen the order is already beside the dishes — no review step needed");
    }
    const sendTxt = await F.textContent("#sendOrder");
    if (attempt === 1) expect(/CHOOSE TABLE/i.test(sendTxt), `the send button asks for the table (${sendTxt.trim()})`);
    await F.click("#sendOrder");
    await F.waitForSelector(".qdest-overlay .qdest-t", { timeout: 8000 });
    if (attempt === 1) {
      ok("the table picker IS the second step (no confirm on top of it)");
      // EVERY DESTINATION IT OFFERS MUST BE SENDABLE. It used to list floorTableList(), which
      // includes tables numbered above the floor plan (they appear so their money stays
      // reachable) — and the server refuses those as a destination, so a stray row made the
      // picker offer "Table 9234792" and the send failed (2026-08-04).
      const offered = await F.evaluate(() => ({ nums: [...document.querySelectorAll("[data-qdest]")].map((b) => Number(b.dataset.qdest)) }));
      // `state` is a top-level const in a classic script: it is reachable as a bare identifier
      // but NOT as window.state — reading it through window gave undefined, the fallback said
      // "12 tables", and the check accused a picker that was right (its own bug, minutes old).
      const count = await F.evaluate(() => Math.max(1, parseInt(((state.data.settings || {}).table_count), 10) || 12));
      const offPlan = offered.nums.filter((x) => !Number.isFinite(x) || x < 1 || x > count);
      expect(offPlan.length === 0, offPlan.length
        ? `the picker offers ${offPlan.length} table(s) the server will refuse: ${offPlan.join(", ")} (the floor plan is 1..${count})`
        : `every table the picker offers is on the floor plan (1..${count}, ${offered.nums.length} shown)`);
      await shot("quick-dest");
    }
    // pick a FREE table as high up the floor as possible (another session's suite works the low ones)
    const destT = await F.evaluate(() => {
      const free = [...document.querySelectorAll(".qdest-t:not(.busy)")];
      const b = free.length ? free[free.length - 1] : document.querySelector(".qdest-t");
      return b && b.dataset.qdest;
    });
    opened.add(destT);                    // from here on, this table is OURS to put back
    await F.click(`.qdest-t[data-qdest="${destT}"]`);
    const toast = await F.waitForSelector(".toast", { timeout: 20000 }).then((t) => t.textContent()).catch(() => "");
    if (!/Kitchen ticket|Sent/i.test(toast || "")) { soft(`the order did not report as sent (${(toast || "no toast").trim()})`); continue; }
    if (attempt === 1) ok(`the pick sent it — ${(toast || "").trim()}`);
    await page.waitForTimeout(2800);

    await F.click(`.tile[data-t="${destT}"]`);
    await F.waitForSelector(".detail-pop", { timeout: 10000 });
    await F.waitForSelector(".detail-pop .phead-ops", { timeout: 12000 }).catch(() => {});
    if (!(await vis(".detail-pop #closeTable"))) { soft("the popup showed no live table — it was probably closed by something else mid-run"); await backOnce(); continue; }

    const acc = await F.$(".detail-pop [data-accept]");
    if (acc) { await acc.click(); await page.waitForTimeout(1800); }
    const serveAll = await F.$(".detail-pop [data-serve-all]");
    const serveOne = serveAll ? null : await F.$(".detail-pop [data-serve]");
    if (serveAll) { await serveAll.click(); await page.waitForTimeout(1800); }
    else if (serveOne) { await serveOne.click(); await page.waitForTimeout(1800); }
    else { soft("nothing to serve — the order vanished from the popup"); continue; }
    ok("the dishes served");

    if (!(await F.waitForSelector(".detail-pop #payBill:not([disabled])", { timeout: 10000 }).catch(() => null))) { soft("💳 Mark bill paid never became available"); continue; }
    await F.click(".detail-pop #payBill");
    if (!(await F.waitForSelector(".pay-overlay .pay-method-btn", { timeout: 8000 }).catch(() => null))) { soft("the payment-method sheet did not open"); continue; }
    ok("settling the bill asks HOW they paid — that sheet is its second step, and nothing asks again");
    await F.click('.pay-overlay .pay-method-btn[data-method="Cash"]');
    await page.waitForTimeout(2500);

    if (!(await F.waitForSelector(".detail-pop #closeTable", { timeout: 8000 }).catch(() => null))) { soft("✕ Close table disappeared after payment"); continue; }
    // A FINISHED table (everything served, bill paid) grows a ⏻ close ON ITS TILE, like the
    // manager's — so a waiter clearing tables doesn't have to open each one. Close THROUGH it,
    // which proves the control exists, is wired, and shares the popup's close path.
    await F.click(".detail-pop #detailClose");
    await page.waitForTimeout(1400);
    const tileClose = await F.waitForSelector(`.tile[data-t="${destT}"] .tclose`, { timeout: 9000 }).catch(() => null);
    if (!tileClose) { soft(`the finished tile T${destT} grew no ⏻ close control`); continue; }
    ok(`a finished table shows ⏻ close on its TILE (T${destT}) — manager parity`);
    // A finished tile carries the MOST controls of any state (⏻ + ＋ Take order), and the
    // clipping sweep above ran before this table existed — so measure this one now, in the
    // state that has the most to fit.
    const finClip = await F.evaluate((x) => { const e = document.querySelector(`.tile[data-t="${x}"]`); return e ? { sh: e.scrollHeight, ch: e.clientHeight } : null; }, destT);
    expect(finClip && finClip.sh <= finClip.ch + 1, finClip ? `the finished tile fits its own controls (${finClip.sh}px in ${finClip.ch}px)` : "could not measure the finished tile");
    await tileClose.click();
    if (!(await F.waitForSelector("#confirmOverlay:not([hidden])", { timeout: 8000 }).catch(() => null))) {
      bad("closing a table on the TABLET fired with no confirm. Deliberate? The manager's identical ⏻ is one tap "
        + "(owner, 2026-08-02) and the tablet asks because his newer word named this panel and the mis-tap on a "
        + "~22px tile control (2026-08-03). If he has since asked for one tap here too, change this check WITH the "
        + "panel — don't just delete it.");
      break;
    }
    ok("closing a table asks a confirm first (its second step)");
    await F.click("#confirmYes");
    let cls = "?";
    for (let i = 0; i < 20; i++) {
      await page.waitForTimeout(600);
      cls = await F.evaluate((t) => { const e = document.querySelector(`.tile[data-t="${t}"]`); return e ? e.className : "?"; }, destT);
      if (/t-free/.test(cls)) break;
    }
    if (!/t-free/.test(cls)) { soft(`table ${destT} did not go free after the close (${cls})`); continue; }
    ok(`table ${destT} is free again — order → serve → pay → close all worked, and the test table is put back`);
    opened.delete(destT);                 // the app closed it for real; nothing left to sweep
    loopOk = true;
  }
  } finally {
    // Runs whether the loop finished, gave up, or threw — no test order is ever left sitting
    // on a demo table.
    await sweepUp();
  }
  if (!loopOk) bad(`the order → serve → pay → close loop never completed in 3 attempts (last: ${why})`);
  expect(opened.size === 0, opened.size ? `left ${opened.size} test table(s) open: ${[...opened].join(", ")}` : "every table this run touched was put back");
}

// ── 12 · A FINGER, NOT A MOUSE — the tiles-per-row cap this run never exercised ────────────
// WHY THIS EXISTS (T4 improvement 3, 2026-08-11). Every size pass above resizes ONE browser
// context, and that context reports a MOUSE. The owner's 2026-08-05 rule — "when it is horizontal
// at least four to five to six can be shown… if there is twelve, then six will be shown" — is
// implemented as a cap that only applies to a COARSE pointer (floorPerRow / FLOOR_PER_ROW_TOUCH_MAX
// in tablet/app.js). So every "iPad"/"iPhone" check above measured the 12-per-row DESKTOP layout,
// and cheerfully reported things like "iPad 1024px: tile 73px" — a size no real iPad will ever draw.
// 78 checks passed while the one number he actually asked about went untested.
//
// So: a SECOND context with hasTouch, which is what makes `(pointer: coarse)` match in Chromium.
// It asserts the emulation really took effect first — a touch pass that silently ran as a mouse
// would be worse than no pass at all, since it would look like coverage.
{
  const tctx = await browser.newContext({ viewport: { width: 1024, height: 768 }, hasTouch: true, isMobile: false });
  // loginAs() caches per (base, username) for the whole process, so this reuses the session the run
  // already has — no second staff login, which is rate-limited and pings the owner's phone.
  // (Copying cookies across contexts by hand does NOT work here: a row from ctx.cookies() carries
  //  domain+path, and addCookies rejects those alongside a `url`, so the copy silently added nothing
  //  and the panel bounced to /login — which is what made the first version of this pass fail.)
  await loginAs(tctx, "tablet", BASE);
  const tpage = await tctx.newPage();
  const terrs = [];
  tpage.on("pageerror", (e) => terrs.push(String(e)));
  await tpage.goto(`${BASE}/tablet`, { waitUntil: "domcontentloaded" });
  let TF = null;
  for (let i = 0; i < 60 && !TF; i++) { TF = tpage.frames().find((f) => /panels\/tablet/.test(f.url())); if (!TF) await tpage.waitForTimeout(500); }
  if (!TF) { bad("touch pass: the tablet panel frame never appeared"); }
  else {
    await tpage.waitForTimeout(9000);
    const coarse = await TF.evaluate(() => window.matchMedia("(pointer: coarse)").matches);
    expect(coarse, "touch pass: the browser really reports a coarse pointer (otherwise this pass proves nothing)");
    for (const [w, h, tag, cap] of [[1194, 834, "touch tablet 1194px", 6], [1024, 768, "touch iPad 1024px", 6]]) {
      await tpage.setViewportSize({ width: w, height: h });
      await tpage.waitForTimeout(900);
      const m = await TF.evaluate(() => {
        const g = document.getElementById("tiles");
        const t = g.querySelector(".tile");
        const r = t ? t.getBoundingClientRect() : null;
        return {
          perRow: Number(getComputedStyle(g).getPropertyValue("--per-row").trim()) || 0,  // effective, after the screen bands
          cols: getComputedStyle(g).gridTemplateColumns.split(" ").length,
          w: r ? Math.round(r.width) : 0, h: r ? Math.round(r.height) : 0,
          clip: [...document.querySelectorAll(".tile")].filter((x) => x.scrollHeight > x.clientHeight + 1).length,
          ovf: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        };
      });
      // Below 1024px the SCREEN BANDS decide (2 upright, 4 turned) and they are tighter than this
      // cap, so the assertion is "no more than the cap", which both rules satisfy (owner, 2026-08-15).
      expect(m.perRow > 0 && m.perRow <= cap, `${tag}: at most ${cap} tiles per row on a touch screen (got ${m.perRow})`);
      expect(m.cols === m.perRow, `${tag}: the grid really draws ${m.perRow} per row (got ${m.cols})`);
      // 44px is the tappability floor named in lib/floorLayout.ts. A finger needs a bigger square
      // than a mouse does — that is the whole reason the cap exists.
      expect(m.w >= 44 && m.h >= 44, `${tag}: tiles are a real finger target (${m.w}×${m.h}, ≥44)`);
      expect(m.clip === 0, m.clip ? `${tag}: ${m.clip} tile(s) clip their content at touch size` : `${tag}: no tile clips at touch size`);
      expect(!m.ovf, `${tag}: the page does not scroll sideways on a touch screen`);
    }
    expect(terrs.length === 0, terrs.length ? `touch pass page errors: ${terrs.join(" | ")}` : "touch pass: no page errors");
  }
  await tctx.close();
}

expect(errors.length === 0, errors.length ? `page errors: ${errors.join(" | ")}` : "no page errors anywhere in the walk");

await browser.close();
console.log(failed ? `\n${failed} of ${passed + failed} checks FAILED — the waiter's floor is not right yet.` : `\nAll ${passed} checks passed — the waiter's floor looks and works the way it was asked for.`);
process.exit(failed ? 1 : 0);
