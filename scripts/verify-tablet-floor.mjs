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
const ctx = await browser.newContext({ viewport: { width: 1194, height: 834 } });
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
const vis = (sel) => F.evaluate((s) => { const e = document.querySelector(s); return !!e && e.offsetParent !== null; }, sel).catch(() => false);
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
  return { cols: getComputedStyle(g).gridTemplateColumns.split(" ").length, perRow: g.style.getPropertyValue("--per-row").trim(), w: t.width, h: t.height };
});
expect(grid.perRow !== "", `tiles-per-row comes from the restaurant's own setting (${grid.perRow})`);
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
    const t = tiles.find((x) => !/t-merged/.test(x.className) && /t-prep|t-new|t-bill|t-done/.test(x.className)) || tiles[0];
    const cs = getComputedStyle(t);
    const seen = (sel) => { const e = t.querySelector(sel); return !!e && getComputedStyle(e).display !== "none"; };
    const doc = document.documentElement;
    return {
      outer: Math.round(t.getBoundingClientRect().width),
      content: Math.round(t.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)),
      num: seen(".tnum"), bar: seen(".tstrip") || !t.querySelector(".tstrip"),
      clip: tiles.filter((x) => x.scrollHeight > x.clientHeight + 1).length,
      ovf: doc.scrollWidth > doc.clientWidth + 1,
      firstTop: Math.round(tiles[0].getBoundingClientRect().top),
      onScreen: tiles.filter((x) => x.getBoundingClientRect().bottom <= window.innerHeight).length,
      rest: (() => { const n = document.getElementById("restName"); return !!n && n.offsetParent !== null && n.textContent.trim() !== ""; })(),
      qo: (() => { const q = document.getElementById("quickOrderBtn"); return !!q && q.offsetParent !== null; })(),
    };
  });
  expect(m.clip === 0, `${tag}: no tile clips (tile ${m.outer}px, ${m.content}px inside)`);
  expect(m.num, `${tag}: the table number survives`);
  expect(m.bar, `${tag}: the progress bar survives`);
  expect(!m.ovf, `${tag}: the page does not scroll sideways`);
  expect(m.qo, `${tag}: ⚡ Quick order is reachable`);
  // The floor must GET the screen — the owner's words were "as big as possible".
  if (w <= 420) {
    expect(m.firstTop <= 200, `${tag}: the first tile starts ${m.firstTop}px down (≤200)`);
    expect(m.onScreen >= 6, `${tag}: ${m.onScreen} tiles visible without scrolling (≥6)`);
    expect(m.rest, `${tag}: the restaurant's own name is still on the bar`);
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
  const measureInsets = (sel) => F.evaluate((s) => {
    const SAT = 47, SAB = 34, root = document.documentElement;
    const prevT = root.style.getPropertyValue("--safe-t"), prevB = root.style.getPropertyValue("--safe-b");
    root.style.setProperty("--safe-t", SAT + "px");
    root.style.setProperty("--safe-b", SAB + "px");
    const cs = getComputedStyle(document.querySelector(s));               // forces a sync recalc
    const out = { padT: parseFloat(cs.paddingTop), padB: parseFloat(cs.paddingBottom), under: [] };
    const vh = window.innerHeight;
    for (const q of ["#hamburger", "#quickOrderBtn", ".fnav", ".tile:last-of-type", "#sendOrder", ".om-viewpill"]) {
      const el = document.querySelector(q);
      if (!el || !el.offsetParent) continue;
      const r = el.getBoundingClientRect();
      if (r.bottom > vh - SAB + 1 && r.top < vh) out.under.push(`${q} (bottom ${Math.round(r.bottom)} of ${vh}; the band starts at ${vh - SAB})`);
    }
    root.style.setProperty("--safe-t", prevT); root.style.setProperty("--safe-b", prevB);
    return out;
  }, sel);

  const floorIn = await measureInsets(".layout");
  expect(floorIn.under.length === 0, floorIn.under.length ? `controls sit under the home bar / nav bar: ${floorIn.under.join(", ")}` : "nothing a finger needs sits under the iPhone home bar / Samsung nav bar");
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
    await F.click("#omExit");
    await page.waitForTimeout(800);
  }
  await page.setViewportSize({ width: 1194, height: 834 });
  await page.waitForTimeout(700);
}

// ── 5 · BOTH SKINS: no label may sink into its background ─────────────────────
const flipTheme = async () => {
  await F.click("#hamburger");
  await F.waitForSelector(".tbl-drawer.open", { timeout: 6000 });
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

// ── 7 · ☰ → ⚙️ Settings → Log out; no parcel on the tablet ────────────────────
await F.click("#hamburger");
await F.waitForSelector(".tbl-drawer.open", { timeout: 6000 });
expect(!(await F.$("#dwParcel")), "☰ menu: no parcel entry (parcels are a manager feature)");
expect(await vis("#dwSettings"), "☰ menu: ⚙️ Settings");
await F.click("#dwSettings");
await F.waitForSelector(".set-overlay", { timeout: 6000 });
expect(await vis('.set-overlay a[href="/api/panel-logout"]'), "Settings holds Log out");
await shot("settings");
await F.click(".set-overlay .set-close");
await page.waitForTimeout(600);

// ── 8 · ⚡ QUICK ORDER: build first, pick the table LAST — and that pick sends ──
// This is the only part that writes, so --read-only stops here. The order it places is put
// back by CLOSING the table (never deleted — an issued bill may not be erased).
if (READ_ONLY) {
  ok("read-only run: the live order → serve → pay → close loop was not walked (by design)");
} else {
  let loopOk = false, why = "";
  for (let attempt = 1; attempt <= 3 && !loopOk; attempt++) {
    const soft = (m) => { why = m; console.log(`  ..   attempt ${attempt}: ${m}`); };
    await F.click("#quickOrderBtn");
    await F.waitForSelector(".om.lite", { timeout: 10000 });
    if (attempt === 1) expect((await F.textContent(".om.lite .om-head h2")).includes("Quick order"), "⚡ Quick order opens the dish browser with NO table chosen yet");
    await F.click(".dish:not(.out)");
    await page.waitForTimeout(400);
    await F.click("#omViewBtn");
    await F.waitForSelector(".om.lite.vieworder", { timeout: 8000 });
    const sendTxt = await F.textContent("#sendOrder");
    if (attempt === 1) expect(/CHOOSE TABLE/i.test(sendTxt), `the send button asks for the table (${sendTxt.trim()})`);
    await F.click("#sendOrder");
    await F.waitForSelector(".qdest-overlay .qdest-t", { timeout: 8000 });
    if (attempt === 1) { ok("the table picker IS the second step (no confirm on top of it)"); await shot("quick-dest"); }
    // pick a FREE table as high up the floor as possible (another session's suite works the low ones)
    const destT = await F.evaluate(() => {
      const free = [...document.querySelectorAll(".qdest-t:not(.busy)")];
      const b = free.length ? free[free.length - 1] : document.querySelector(".qdest-t");
      return b && b.dataset.qdest;
    });
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
    if (!(await F.waitForSelector("#confirmOverlay:not([hidden])", { timeout: 8000 }).catch(() => null))) { bad("closing a table fired with NO confirm — that breaks the two-step rule"); break; }
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
    loopOk = true;
  }
  if (!loopOk) bad(`the order → serve → pay → close loop never completed in 3 attempts (last: ${why})`);
}

expect(errors.length === 0, errors.length ? `page errors: ${errors.join(" | ")}` : "no page errors anywhere in the walk");

await browser.close();
console.log(failed ? `\n${failed} of ${passed + failed} checks FAILED — the waiter's floor is not right yet.` : `\nAll ${passed} checks passed — the waiter's floor looks and works the way it was asked for.`);
process.exit(failed ? 1 : 0);
