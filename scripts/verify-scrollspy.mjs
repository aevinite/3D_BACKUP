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

  // 1. pinned header
  const pinned = await page.evaluate(async () => {
    const el = document.getElementById("main-scroll");
    el.scrollTop = 2500;
    await new Promise((r) => setTimeout(r, 700));
    const r1 = document.getElementById("sticky-header").getBoundingClientRect();
    return r1.top >= 0 && r1.top < 200 && r1.bottom > 100; // on screen while deep
  });
  check(pinned, "search/filter header stays pinned while scrolling");

  // 2. strip exists
  check(await page.isVisible("#spy-strip .spy-chip"), "category strip is present in the All view");

  // 3. spy ladder — scroll a couple of sections under the header, expect their chip
  for (const cat of ["salads", "pizza"]) {
    const spy = await page.evaluate(async (c) => {
      const el = document.getElementById("main-scroll");
      const s = el.querySelector(`.cat-group[data-cat="${c}"]`);
      el.scrollTop = s.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop - 230;
      await new Promise((r) => setTimeout(r, 1500));
      return document.querySelector(".spy-chip.active")?.textContent || null;
    }, cat);
    check((spy || "").toLowerCase().includes(cat.slice(0, 4)), `scrolling to ${cat} lights its chip (got ${spy})`);
  }

  // 4. bottom edge case → last category lights up
  const bottomSpy = await page.evaluate(async () => {
    const el = document.getElementById("main-scroll");
    el.scrollTop = el.scrollHeight; await new Promise((r) => setTimeout(r, 1200));
    el.scrollTop = el.scrollHeight; await new Promise((r) => setTimeout(r, 1200));
    return document.querySelector(".spy-chip.active")?.textContent || null;
  });
  check(bottomSpy === "Desserts", `bottom of the menu lights the last category (got ${bottomSpy})`);

  // 5. tap-to-jump lands the section below the pinned header
  const jump = await page.evaluate(async () => {
    const chip = [...document.querySelectorAll(".spy-chip")].find((c) => /beverages/i.test(c.textContent));
    chip.click();
    await new Promise((r) => setTimeout(r, 2200));
    const el = document.getElementById("main-scroll");
    const secTop = el.querySelector('.cat-group[data-cat="beverages"]').getBoundingClientRect().top;
    const headerBottom = document.getElementById("sticky-header").getBoundingClientRect().bottom;
    return { secTop, headerBottom };
  });
  check(jump.secTop >= jump.headerBottom - 10, `tapping a chip lands the section below the header (${Math.round(jump.secTop)} vs ${Math.round(jump.headerBottom)})`);

  await ctx.close();
} finally {
  await browser.close();
}
console.log(failures ? `\n${failures} CHECK(S) FAILED` : "\nALL SCROLL-SPY CHECKS PASSED");
process.exit(failures ? 1 : 0);
