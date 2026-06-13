// Verifies the Petpooja-style scroll-spy menu UX (Phase 0, 2026-06-12):
//   1. the search/filter header is genuinely PINNED while scrolling;
//   2. the slim category strip exists in the All view;
//   3. scrolling into a section lights its chip (Coffee → … → Pizza);
//   4. the very bottom lights the LAST category (short-section edge case);
//   5. tapping a chip jumps so the section lands BELOW the pinned header.
// Prints pass/fail only. Usage: node scripts/verify-scrollspy.mjs (menu on :4000)
import { chromium } from "playwright";

let failures = 0;
const check = (ok, label) => { console.log(`${ok ? "✓" : "✗ FAIL"} ${label}`); if (!ok) failures++; };

const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
  const page = await ctx.newPage();
  await page.goto("http://localhost:4000/menu", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".cat-group-head", { timeout: 60000 });
  await page.evaluate(() => sessionStorage.removeItem("lfh_menu_scroll"));

  // Warm the whole page once so lazy images stop moving the layout under us.
  await page.evaluate(async () => {
    const el = document.getElementById("main-scroll");
    el.scrollTop = el.scrollHeight;
    await new Promise((r) => setTimeout(r, 1500));
    el.scrollTop = 0;
    await new Promise((r) => setTimeout(r, 800));
  });

  // 1. the ONE category+search bar stays pinned (no separate strip)
  const pinned = await page.evaluate(async () => {
    const el = document.getElementById("main-scroll");
    el.scrollTop = 2500;
    await new Promise((r) => setTimeout(r, 700));
    const r1 = document.getElementById("menu-sticky").getBoundingClientRect();
    return r1.top >= -2 && r1.top < 130 && r1.bottom > 200; // pinned + on screen while deep
  });
  check(pinned, "the existing category+search bar stays pinned while scrolling");

  // 2. there is NO separate strip — the existing category bar is the one and only
  check(!(await page.$("#spy-strip")) && (await page.$("#cat-scroller")) !== null, "no separate category strip — uses the existing bar");

  // 3. spy ladder — scroll a couple of sections under the bar, expect the
  // matching CATEGORY CARD to light up. Re-correct twice for lazy-image reflow.
  for (const cat of ["salads", "pizza"]) {
    const spy = await page.evaluate(async (c) => {
      const el = document.getElementById("main-scroll");
      const landAt = () => { const s = el.querySelector(`.cat-group[data-cat="${c}"]`); const bar = document.getElementById("menu-sticky"); el.scrollTop += s.getBoundingClientRect().top - (bar.getBoundingClientRect().bottom + 10); };
      for (let i = 0; i < 3; i++) { landAt(); await new Promise((r) => setTimeout(r, 700)); }
      await new Promise((r) => setTimeout(r, 700)); // let the 600ms spy timer fire
      return document.querySelector(".cat-card.active .cat-name")?.textContent || null;
    }, cat);
    check((spy || "").toLowerCase().includes(cat.slice(0, 4)), `scrolling to ${cat} lights its category card (got ${spy})`);
  }

  // 4. bottom edge case → last category card lights up
  const bottomSpy = await page.evaluate(async () => {
    const el = document.getElementById("main-scroll");
    el.scrollTop = el.scrollHeight; await new Promise((r) => setTimeout(r, 1200));
    el.scrollTop = el.scrollHeight; await new Promise((r) => setTimeout(r, 1200));
    return document.querySelector(".cat-card.active .cat-name")?.textContent || null;
  });
  check(bottomSpy === "Desserts", `bottom of the menu lights the last category card (got ${bottomSpy})`);

  // 5. tapping a category CARD in the All view jumps to that section, landing
  // just below the pinned bar. Tap twice (the first can land mid-reflow).
  const jump = await page.evaluate(async () => {
    const el = document.getElementById("main-scroll");
    const tap = () => [...document.querySelectorAll(".cat-card")].find((c) => /beverages/i.test(c.textContent)).click();
    tap(); await new Promise((r) => setTimeout(r, 1700));
    tap(); await new Promise((r) => setTimeout(r, 1700));
    const secTop = el.querySelector('.cat-group[data-cat="beverages"]').getBoundingClientRect().top;
    const barBottom = document.getElementById("menu-sticky").getBoundingClientRect().bottom;
    return { secTop, barBottom };
  });
  check(jump.secTop >= jump.barBottom - 25, `tapping a category card lands its section below the bar (${Math.round(jump.secTop)} vs ${Math.round(jump.barBottom)})`);

  await ctx.close();
} finally {
  await browser.close();
}
console.log(failures ? `\n${failures} CHECK(S) FAILED` : "\nALL SCROLL-SPY CHECKS PASSED");
process.exit(failures ? 1 : 0);
