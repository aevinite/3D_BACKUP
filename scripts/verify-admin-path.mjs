#!/usr/bin/env node
// verify:path — EVERY CRUMB ON EVERY ADMIN SCREEN ACTUALLY GOES SOMEWHERE.
//
// WHY THIS EXISTS (owner, 2026-09-13). He asked twice. First the path was FICTION — Printing said
// "Restaurants › My Little French House › Printing" to someone who had opened it from the sidebar.
// That was fixed. Then:
//
//   *"You also have to make the path workable. For example, right now I'm inside of the printing,
//    and I'm inside a particular restaurant. So whenever I click printing in that path, I should
//    able to go to printing."*  … *"Check every single bit of path of admin panel and do it for all."*
//
// It did not work, and no amount of source-reading would have said so, because the markup was
// perfect: a real <a> with a real href to a real address. The fault was one level down — the
// Printing overview and one restaurant SHARE the address /aevinite/printing, and which you see is
// React state, so Next did not remount and the click moved the address bar while leaving the
// restaurant on screen. A guard that reads code cannot see that. This one clicks.
//
// WHAT IT ASSERTS, per crumb, on every screen and every drilled-in state:
//   1. a crumb that is a LINK must change what is on screen — not just the URL;
//   2. the crumb you are ON is never a link (you cannot navigate to where you already are);
//   3. no underline anywhere on the path (owner, 2026-09-13: *"there shouldn't be any underline"*);
//   4. the pointer tells the truth — `pointer` on a link, `default` on the current crumb;
//   5. a link that deliberately has no destination must be declared, below, with its reason —
//      so "not a link" can never be an accident nobody noticed.
import { chromium } from "playwright";
import { adminCookie } from "./sweep/login.mjs";
import { requireUp } from "./sweep/appUp.mjs";

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const BASE = arg("--base", "http://localhost:4000");

// A crumb that is DELIBERATELY not a way out. Each needs a reason, and the reason has to be about
// the product, not about the code being hard.
const NOT_A_DESTINATION = {
  "/aevinite/access :: Access & permissions":
    "Access is always scoped to one restaurant — there is no all-restaurants view of it — so this " +
    "crumb names where you already are. As a link it moved the address and changed nothing.",
};

let pass = 0; const fails = [];
const ok = (what) => { pass++; console.log(`  ok   ${what}`); };
const bad = (what, why) => { fails.push(`${what} — ${why}`); console.log(`  ✗    ${what}\n         ${why}`); };

await requireUp(BASE, "the admin console, to click every crumb on every screen");

const c = adminCookie(BASE);
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addCookies([{ name: c.name, value: c.value, url: BASE }, { name: "aevidine_skin", value: "dark", url: BASE }]);
const page = await ctx.newPage();

const snap = () => page.evaluate(() => {
  const n = document.querySelector('nav[aria-label="Breadcrumb"]');
  const parts = n ? [...n.children].filter((e) => !e.classList.contains("sep")) : [];
  return {
    url: location.pathname + location.search,
    h1: document.querySelector("h1")?.textContent?.trim() || "(no h1)",
    body: (document.querySelector("main")?.innerText || "").slice(0, 400),
    crumbs: parts.map((e) => {
      const cs = getComputedStyle(e);
      return { text: e.textContent.trim(), isLink: e.tagName === "A", cursor: cs.cursor,
               underline: cs.textDecorationLine, aria: e.getAttribute("aria-current"), title: e.getAttribute("title") };
    }),
  };
});

async function check(label, open) {
  await open(); await page.waitForTimeout(2200);
  const start = await snap();
  if (!start.crumbs.length) { bad(`${label} — the path`, "there is no path above this screen at all"); return; }

  // (3) and (4): the LOOK of the line, once per screen.
  const underlined = start.crumbs.filter((c) => c.underline && c.underline !== "none");
  if (underlined.length) bad(`${label} — no underline on the path`, `underlined: ${underlined.map((c) => c.text).join(", ")}`);
  else ok(`${label} — no underline on the path`);

  const last = start.crumbs[start.crumbs.length - 1];
  if (last.isLink) bad(`${label} — the crumb you are ON is not a link`, `"${last.text}" is a link to where you already are`);
  else if (last.cursor !== "default") bad(`${label} — the crumb you are ON is not a link`, `"${last.text}" shows a ${last.cursor} pointer`);
  else ok(`${label} — the crumb you are ON is not a link`);

  // (1), (2), (5): click each crumb before the last and see whether the SCREEN moved.
  for (let i = 0; i < start.crumbs.length - 1; i++) {
    const key = `${label} :: ${start.crumbs[i].text}`;
    await open(); await page.waitForTimeout(2200);
    const before = await snap();
    const cr = before.crumbs[i];
    if (!cr) { bad(key, "the path changed shape between two identical visits"); continue; }

    if (!cr.isLink) {
      if (NOT_A_DESTINATION[key]) ok(`${key} — deliberately not a way out (${NOT_A_DESTINATION[key].slice(0, 46)}…)`);
      else bad(key, "is not a link, and is not declared in NOT_A_DESTINATION with a reason");
      continue;
    }
    if (cr.cursor !== "pointer") { bad(key, `is a link but shows a ${cr.cursor} pointer`); continue; }

    await page.evaluate((idx) => {
      const n = document.querySelector('nav[aria-label="Breadcrumb"]');
      [...n.children].filter((e) => !e.classList.contains("sep"))[idx].click();
    }, i);
    await page.waitForTimeout(2500);
    const after = await snap();
    const screenMoved = after.h1 !== before.h1 || after.crumbs.length !== before.crumbs.length || after.body !== before.body;
    if (screenMoved) ok(`${key} — goes somewhere`);
    else if (after.url !== before.url) bad(key, `the address moved to ${after.url} and the screen did not — still "${after.h1}"`);
    else bad(key, "clicking it did nothing at all");
  }
}

const go = (p) => async () => { await page.goto(BASE + p, { waitUntil: "networkidle" }).catch(() => {}); };
const SCREENS = ["/aevinite", "/aevinite/floor", "/aevinite/analytics", "/aevinite/bill-audit", "/aevinite/repair",
  "/aevinite/logs", "/aevinite/restaurants", "/aevinite/people", "/aevinite/customers", "/aevinite/recycle",
  "/aevinite/access", "/aevinite/printing", "/aevinite/revenue", "/aevinite/usage", "/aevinite/billing",
  "/aevinite/health", "/aevinite/rate-limits", "/aevinite/settings", "/aevinite/bill-audit/changes",
  "/aevinite/staff-online"];

console.log("verify:path — every crumb on every admin screen, clicked\n");
for (const p of SCREENS) await check(p, go(p));

// The drilled-in states, which is where every fault so far has lived.
await check("printing + a restaurant", async () => {
  await go("/aevinite/printing")(); await page.waitForTimeout(2200);
  await page.evaluate(() => { const r = [...document.querySelectorAll("button")].find((b) => b.textContent.includes("My Little French House")); if (r) r.click(); });
});
await check("access arrived from the Restaurants list", go("/aevinite/access?from=rest"));
await check("restaurants + a restaurant open", go("/aevinite/restaurants?focus=aangan-garden-restaurant"));
await check("restaurants + the full report open", async () => {
  await go("/aevinite/restaurants?focus=aangan-garden-restaurant")(); await page.waitForTimeout(2500);
  await page.evaluate(() => { const r = [...document.querySelectorAll("button")].find((b) => /Full report/i.test(b.textContent)); if (r) r.click(); });
});

await ctx.close(); await browser.close();
console.log(`\n${pass} passed · ${fails.length} failed`);
if (fails.length) { console.log("\nwhat is wrong:"); for (const f of fails) console.log("  · " + f); process.exit(1); }
console.log("✅ every path in the admin console is clickable, and every click lands.");
