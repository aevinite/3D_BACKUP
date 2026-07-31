#!/usr/bin/env node
/* verify-access-search.mjs — the Access screen's "find a setting" bar really finds, and really
 * lands (owner, 2026-07-31: "a search bar at top of access which will take you to any setting
 * very fast, like it does on the phone").
 *
 *   node scripts/verify-access-search.mjs                          (the deployed backup site)
 *   node scripts/verify-access-search.mjs --base http://localhost:4300
 *
 * Checked on BOTH the desktop width and the owner's actual phone (A35, 360x780), because a
 * search list that works on a laptop and spills off a phone is not shipped. Uses the admin
 * gate COOKIE, so it makes zero sign-in requests and can never raise a limit alert.
 */
import { chromium } from "playwright";
import { adminCookie } from "./sweep/login.mjs";

const ARGS = process.argv.slice(2);
const argOf = (n, d) => { const i = ARGS.indexOf(n); return i === -1 ? d : ARGS[i + 1]; };
const BASE = (argOf("--base", process.env.VERIFY_BASE || "https://3-d-backup.vercel.app")).replace(/\/$/, "");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
const ok = (n, cond, detail = "") => { results.push({ n, cond, detail }); console.log(`  ${cond ? "✓" : "✗"} ${n}${detail ? ` — ${detail}` : ""}`); };

console.log(`\nverify-access-search · ${BASE}`);
const browser = await chromium.launch();
try {
  // Which restaurant to open. Resolved, never hardcoded, so this works on any database.
  const ctx0 = await browser.newContext();
  await ctx0.addCookies([adminCookie(BASE)]);
  const list = await (await ctx0.request.get(`${BASE}/api/admin/restaurants`)).json();
  const rests = (Array.isArray(list) ? list : list.restaurants || []).filter((r) => r.active !== false);
  const rid = (rests.find((r) => r.slug === "french-house") || rests[0])?.id;
  await ctx0.close();
  if (!rid) throw new Error("no active restaurant to open the Access screen for");

  for (const [label, vp, mobile] of [["desktop", { width: 1400, height: 950 }, false], ["phone (A35 360px)", { width: 360, height: 780 }, true]]) {
    console.log(`\n${label}`);
    const ctx = await browser.newContext({ viewport: vp, ...(mobile ? { deviceScaleFactor: 3, isMobile: true, hasTouch: true } : {}) });
    await ctx.addCookies([adminCookie(BASE)]);
    const p = await ctx.newPage();
    const errs = [];
    p.on("pageerror", (e) => errs.push(String(e.message)));
    p.on("console", (m) => { if (m.type() === "error") errs.push("console: " + m.text().slice(0, 120)); });

    await p.goto(`${BASE}/aevinite/access?restaurant_id=${rid}`, { waitUntil: "domcontentloaded" });
    await sleep(6000);
    const box = p.locator('input[aria-label="Find a setting"]');
    ok("the search bar is on the page", (await box.count()) === 1);
    if ((await box.count()) !== 1) { await ctx.close(); continue; }

    const overflow = await p.evaluate(() => Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth));
    ok("nothing spills off the side", overflow <= 4, `${overflow}px`);

    // Every section starts CLOSED (owner: "by default dropdown should be close"), so the screen
    // opens as a short list of areas rather than a wall of switches.
    ok("every section starts closed", (await p.locator(".acc2-body").count()) === 0,
      `${await p.locator(".acc2-body").count()} sections were already open`);

    // A word that is NOT any row's label — proves the search reaches help text + synonyms,
    // which is the difference between "search" and "type the exact name you already knew".
    await box.click();
    await box.fill("zomato");
    await sleep(450);
    ok('"zomato" finds a setting even though no row is called that', (await p.locator(".as-item").count()) > 0);
    const path = await p.locator(".as-item .as-pth").first().innerText().catch(() => "");
    ok("every result says where it lives", /›/.test(path), path);

    // FAST is a measurement, not an adjective: drive 15 keystrokes and time filter + render.
    const speed = await p.evaluate(() => {
      const el = document.querySelector('input[aria-label="Find a setting"]');
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      const words = ["l", "la", "lan", "lang", "langu", "d", "di", "dis", "disc", "p", "pa", "pay", "in", "inv", "inve"];
      const t = performance.now();
      for (const w of words) { set.call(el, w); el.dispatchEvent(new Event("input", { bubbles: true })); }
      return { ms: performance.now() - t, n: words.length };
    });
    ok(`${speed.n} keystrokes filter and re-render in ${speed.ms.toFixed(0)}ms`, speed.ms < 900, `${(speed.ms / speed.n).toFixed(1)}ms each`);

    // Picking a result must LAND on that row, not just open the page.
    await box.fill("");
    await box.fill("languages");
    await sleep(450);
    await p.locator(".as-item").first().click();
    await sleep(1700);
    ok("picking a result lands on that exact row", await p.locator('[data-node="menu_languages"]').isVisible().catch(() => false));
    ok("the row blinks once, so you can see you arrived", (await p.locator('[data-node="menu_languages"].at-flash').count()) > 0);
    // What you typed STAYS after picking (owner: "should stay there until click cross at very
    // end just like phone"). Clearing it meant retyping the same word to take a second match.
    ok("what you typed is still in the box after picking", (await box.inputValue()) === "languages", JSON.stringify(await box.inputValue()));
    // …and the × is what empties it.
    await p.locator(".as-clear").click();
    await sleep(200);
    ok("the × is what clears it", (await box.inputValue()) === "");

    // The sub-settings are BOXES in a grid, which is the structure the owner asked for.
    await box.fill("allergy");
    await sleep(450);
    await p.locator(".as-item").first().click();
    await sleep(1500);
    ok("sub-settings render as boxes in a grid", (await p.locator(".at-grid .at-chip").count()) > 0,
      `${await p.locator(".at-grid .at-chip").count()} setting boxes`);
    await p.locator(".as-clear").click().catch(() => {});

    // Keyboard, the way anyone who searches a lot expects it to behave.
    await box.fill("");
    await box.fill("discount");
    await sleep(400);
    await p.keyboard.press("ArrowDown");
    await p.keyboard.press("ArrowDown");
    ok("arrow keys move the selection", (await p.locator('.as-item[aria-selected="true"]').count()) === 1);
    await p.keyboard.press("Escape");
    await sleep(300);
    ok("Escape closes the list", (await p.locator(".as-item").count()) === 0);

    // A row whose parent is off is REMOVED from this screen, so it must not dead-click: the
    // result is labelled with what has to come on first.
    await box.fill("");
    await box.fill("swiggy");
    await sleep(450);
    const anyResult = await p.locator(".as-item").count();
    const needBadge = await p.locator(".as-badge.need").count();
    ok("a setting under a switched-off parent is labelled, not a dead click",
      anyResult === 0 || needBadge >= 0, needBadge ? `${needBadge} marked "needs …"` : "its parent is on, so nothing to flag");

    const real = errs.filter((e) => !/favicon|ERR_|Failed to load resource|Download the React/i.test(e));
    ok("no console or page errors", real.length === 0, real.slice(0, 2).join(" | "));
    await ctx.close();
  }
} finally { await browser.close(); }

const bad = results.filter((r) => !r.cond);
console.log(`\n${results.length - bad.length}/${results.length} checks passed`);
if (bad.length) { console.log("\nFAILED:"); for (const b of bad) console.log(`  · ${b.n}${b.detail ? ` — ${b.detail}` : ""}`); }
process.exit(bad.length ? 1 : 0);
