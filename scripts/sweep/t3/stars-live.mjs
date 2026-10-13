#!/usr/bin/env node
// The star picker, measured on the rendered dish page: rows P00932 and P00935.
//   T3_BASE=http://localhost:4403 node scripts/sweep/t3/stars-live.mjs
//
// Written in sweep #10 T3 round 2 — both rows had been left ⏭ ("not measured this round"). Reads
// French House's first dish page, opens its "⭐ Rate" tab and picks stars; nothing is submitted.
//   P00932 — the picks never move the page: the review form keeps its height, and the browser
//            records no layout shift inside it while the stars dive and crush.
//   P00935 — one pick = one onChange: the score pill (which shows the parent's value, i.e. what
//            onChange handed it) changes exactly once per pick, straight to the picked number.
import { chromium } from "playwright";
const BASE = process.env.T3_BASE || "http://localhost:4403";
const A35 = { viewport: { width: 360, height: 780 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true };
let pass = 0; const fails = [];
const P = (id, n, ok, e) => { if (ok) { pass++; console.log(`ok   ${id} ${n}${e !== undefined ? ` — ${e}` : ""}`); } else { fails.push(`${id} ${n}`); console.log(`FAIL ${id} ${n}${e !== undefined ? ` — got ${JSON.stringify(e)}` : ""}`); } };
const b = await chromium.launch();
try {
  const ctx = await b.newContext(A35); const p = await ctx.newPage();
  await p.goto(BASE + "/r/french-house/menu", { waitUntil: "domcontentloaded" });
  await p.locator('a[href*="/item/"]').first().waitFor({ timeout: 60000 });
  const href = await p.locator('a[href*="/item/"]').first().getAttribute("href");
  await p.goto(BASE + href, { waitUntil: "domcontentloaded" }); await p.waitForTimeout(3500);
  await p.locator(".review-tab-btn").first().click(); await p.waitForTimeout(900);
  await p.locator(".sr-toggle").first().scrollIntoViewIfNeeded(); await p.waitForTimeout(600);
  await p.evaluate(() => {
    // Only shifts of things INSIDE the rating form count, input or not. The dish page's cyan button
    // runs an endless shine that animates `left` (.btn-cyan::before → @keyframes shimmer) and
    // registers a small shift every 2 s whether anyone taps or not — that is the dish page's, not
    // the stars' (a note for its owner in .claude/sweep/T3-S10-findings.md), so it is counted apart.
    const w = window; w.__shift = 0; w.__other = 0; w.__pill = [];
    const f = document.querySelector(".review-form").getBoundingClientRect();
    const inForm = (r) => r.bottom > f.top && r.top < f.bottom && r.right > f.left && r.left < f.right;
    new PerformanceObserver((l) => { for (const e of l.getEntries()) { const mine = (e.sources || []).some((x) => inForm(x.previousRect) || inForm(x.currentRect)); if (mine) w.__shift += e.value; else w.__other += e.value; } }).observe({ type: "layout-shift", buffered: false });
    const num = document.querySelector(".sr-score-num");
    new MutationObserver(() => w.__pill.push(num.textContent)).observe(num, { childList: true, characterData: true, subtree: true });
  });
  const h0 = await p.locator(".review-form").evaluate((e) => e.getBoundingClientRect().height);
  const seq = [4, 2, 5, 1, 3]; const perPick = [];
  for (const n of seq) {
    const before = await p.evaluate(() => window.__pill.length);
    await p.locator(".sr-toggle").nth(n - 1).click(); await p.waitForTimeout(1400);
    perPick.push(await p.evaluate((k) => window.__pill.slice(k), before));
  }
  const t = p.locator(".sr-toggle").nth(3); await t.focus();
  const kb = await p.evaluate(() => window.__pill.length); await p.keyboard.press("Enter"); await p.waitForTimeout(1400);
  perPick.push(await p.evaluate((k) => window.__pill.slice(k), kb));
  const h1 = await p.locator(".review-form").evaluate((e) => e.getBoundingClientRect().height);
  const shift = await p.evaluate(() => window.__shift); const other = await p.evaluate(() => window.__other);
  P("P00932", "the animation does not push page content around (no layout shift)", Math.abs(h1 - h0) < 0.5 && shift < 0.001, `form ${Math.round(h0)}px → ${Math.round(h1)}px · layout shift inside the form ${shift.toFixed(4)} over six picks (elsewhere on the page: ${other.toFixed(4)})`);
  const want = [...seq, 4].map(String);
  P("P00935", "onChange is called exactly once per pick", perPick.every((x, i) => x.length === 1 && x[0] === want[i]), perPick.map((x) => x.join("→")).join(" | ") + " (five taps, then Enter)");
  await ctx.close();
} finally { await b.close(); }
console.log(`\nSTARS LIVE: ${pass} passed, ${fails.length} failed`);
if (fails.length) { console.log("FAILED:\n  " + fails.join("\n  ")); process.exit(1); }
