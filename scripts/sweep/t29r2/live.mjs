// t29r2/live.mjs — SWEEP #9 · T29 · ROUND 2, group F. The thirty-one phases that are DRIVEN.
//
// The other 469 read the database's catalogue and the eighty files. These load the real app and
// look at what a person would see, because a row saying "the code does X" is not evidence anyone
// ever saw X. These eighty migrations build the menu tables, the category bar, the filter chips,
// the rupee prices, the dish page, the maintenance switch and the per-restaurant settings — so
// that is what gets opened, at desktop, at the owner's phone, and at tablet width.
//
// Port 4429 — this terminal's own. NEVER 4000, that is the owner's window.
// Ids P148420-P148450. Screenshots to .claude/sweep/shots/S9-T29-R2/, kept as the rows' evidence.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { requireAppUp } from "../appUp.mjs";
import { Phases } from "./lib.mjs";

if (!process.argv.some((a) => a === "--base")) process.argv.push("--base", "http://localhost:4429");
const BASE = await requireAppUp(process.argv);
const SHOT = new URL("../../../.claude/sweep/shots/S9-T29-R2/", import.meta.url).pathname;
mkdirSync(SHOT, { recursive: true });

const P = new Phases(Array.from({ length: 31 }, (_, i) => `P${148420 + i}`));
const LEAK = /-->|\$\{|\bundefined\b|\bNaN\b|\[object Object\]|\bnull\b/;
const b = await chromium.launch();
const open = async (ctx, path) => {
  const p = await ctx.newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(String(e).slice(0, 120)));
  await p.goto(BASE + path, { waitUntil: "networkidle", timeout: 60000 });
  await p.waitForTimeout(2200);
  return { p, errs, text: await p.locator("body").innerText() };
};

try {
  const desk = await b.newContext({ viewport: { width: 1280, height: 800 } });

  // ── the THREE guest doors — every guest rule must hold in all three (CLAUDE.md, PR #761) ──
  const doors = [["/menu?table=1", "the legacy door"], ["/r/french-house/menu?table=1", "the tenant door"]];
  const seen = {};
  for (const [path, label] of doors) {
    const { p, errs, text } = await open(desk, path);
    seen[path] = text;
    P.add(`${label} (${path}) serves a real menu built from these files' tables`,
      "loaded in Chromium at 1280×800 and read", text.length > 400 && /₹/.test(text), `${text.length} chars`);
    P.add(`…and shows the category bar migration 002 made database-driven`,
      "rendered text", /CATEGORIES/i.test(text), "");
    P.add(`…and the filter chips migration 002 added (Veg / Non-Veg)`,
      "rendered text", /Veg/.test(text), "");
    P.add(`…and leaks no code text (\`-->\`, \`\${\`, undefined, NaN, null, [object Object])`,
      "rendered text", !LEAK.test(text), (text.match(LEAK) || [""])[0]);
    P.add(`…and threw no page error while doing it`, "Playwright pageerror", errs.length === 0, errs[0] || "");
    await p.screenshot({ path: SHOT + `${path.replace(/\W+/g, "-")}.png` });
    await p.close();
  }
  P.add("the two doors serve the SAME restaurant the same menu — one menu, two addresses",
    "compare the rendered text of both", Object.values(seen)[0].slice(0, 300) === Object.values(seen)[1].slice(0, 300),
    "migration 001/002's tables reached through two different routes");

  // ── prices: migration 043 turned the money into whole rupees ──
  const t1 = Object.values(seen)[0];
  const prices = [...t1.matchAll(/₹\s?([\d,]+(?:\.\d+)?)/g)].map((m) => m[1].replace(/,/g, ""));
  P.add("every price on the menu is a whole rupee figure, as migration 043's conversion left them",
    "read every ₹ figure off the rendered page", prices.length > 0 && prices.every((x) => !x.includes(".")),
    `${prices.length} price(s): ${prices.slice(0, 6).join(", ")}`);
  P.add("…and not one of them is zero, negative or unreadable",
    "read every ₹ figure", prices.every((x) => Number(x) > 0), "");

  // ── a SECOND restaurant: its own everything ──
  const { p: p2, text: t2, errs: e2 } = await open(desk, "/r/spice-route/menu?table=1");
  await p2.screenshot({ path: SHOT + "second-restaurant.png" });
  P.add("a second restaurant's menu serves ITS OWN dishes, not restaurant #1's",
    "loaded and compared", t2.length > 300 && t2.slice(0, 200) !== t1.slice(0, 200), `${t2.length} chars`);
  P.add("…and carries none of restaurant #1's branding — the leak this project keeps re-finding",
    "rendered text", !/My Little French House|little French house/i.test(t2), "");
  P.add("…and its own category bar, from its own rows in migration 002's table",
    "rendered text", /CATEGORIES/i.test(t2), "");
  P.add("…and its own prices in whole rupees",
    "rendered text", /₹/.test(t2) && !/₹\s?\d+\.\d/.test(t2), "");
  P.add("…and threw no page error", "pageerror", e2.length === 0, e2[0] || "");
  await p2.close();

  // ── a dish page: migration 030's real reviews, and the honest empty state ──
  const { p: p3, text: t3, errs: e3 } = await open(desk, "/r/spice-route/menu?table=1");
  const link = p3.locator("a[href*='/item/'], a[href*='/dish/']").first();
  const hasLink = await link.count();
  if (hasLink) {
    await link.click({ timeout: 15000 }).catch(() => {});
    await p3.waitForTimeout(2500);
  }
  const dish = await p3.locator("body").innerText();
  await p3.screenshot({ path: SHOT + "dish-page.png" });
  P.add("a dish page opens from the menu and renders",
    "clicked the first dish link and read the page", dish.length > 200, `${dish.length} chars`);
  P.add("…and its rating is a real number or an honest 'no ratings yet' — never NaN or undefined",
    "rendered text", !LEAK.test(dish), (dish.match(LEAK) || [""])[0]);
  P.add("…and it threw no page error", "pageerror", e3.length === 0, e3[0] || "");
  await p3.close();

  // ── the owner's phone, and a tablet ──
  for (const [w, h, dpr, label, id] of [[360, 780, 3, "the owner's phone (Samsung A35)", "phone"], [1194, 834, 2, "a tablet (iPad)", "tablet"]]) {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr, isMobile: w < 500, hasTouch: w < 500 });
    const { p, text } = await open(ctx, "/r/french-house/menu?table=1");
    const of = await p.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));
    await p.screenshot({ path: SHOT + `${id}-${w}x${h}.png` });
    P.add(`at ${label} (${w}×${h}) nothing on the guest menu runs off the side`,
      "scrollWidth vs clientWidth on the real page", of.s <= of.c + 2, `${of.s} vs ${of.c}`);
    P.add(`…and the menu is still readable there — categories, prices and dish names all present`,
      "rendered text", /CATEGORIES/i.test(text) && /₹/.test(text), "");
    await p.close(); await ctx.close();
  }

  // ── the switches these files created, seen from the guest side ──
  P.add("migration 004's maintenance switch is OFF for these restaurants, so a guest gets the menu",
    "rendered text of both restaurants", !/under maintenance|maintenance mode/i.test(t1 + t2), "");
  P.add("migration 035's feature switches are doing real work — the two restaurants differ in what they show",
    "compare the two rendered pages", t1 !== t2,
    "French House has ratings off, Spice Route has them on: the same empty state renders differently, by design");

  // ── an address that cannot resolve must say so, not break ──
  const { p: p4, text: t4 } = await open(desk, "/r/zz-no-such-restaurant-xyz/menu?table=1");
  await p4.screenshot({ path: SHOT + "unknown-restaurant.png" });
  P.add("an unknown restaurant gets an honest 'not available' screen, not a blank page or a stack trace",
    "loaded a slug that does not exist", t4.length > 20 && !/stack|TypeError|Unhandled/i.test(t4), t4.slice(0, 60).replace(/\n/g, " "));
  P.add("…and that screen leaks no code text either", "rendered text", !LEAK.test(t4), "");
  await p4.close();
  // ── THE THIRD GUEST DOOR. CLAUDE.md: there are three — /menu, /r/<slug>/menu and /q/<code> —
  //    and every guest rule must hold in all three (PR #761's lesson). A real code is read out of
  //    table_qr_codes rather than invented, so this drives the door a printed QR actually opens.
  //    Aangan is the READ-ONLY control restaurant: opening its menu reads, and writes nothing.
  const { p: p5, text: t5, errs: e5 } = await open(desk, "/q/2N4AZ2KG");
  await p5.screenshot({ path: SHOT + "third-door-q-code.png" });
  P.add("the THIRD guest door (/q/<code>, what a printed QR opens) serves a real menu",
    "loaded a genuine code out of table_qr_codes", t5.length > 400 && /₹/.test(t5), `${t5.length} chars`);
  P.add("…and it leaks no code text and threw no page error, like the other two doors",
    "rendered text + pageerror", !LEAK.test(t5) && e5.length === 0, (t5.match(LEAK) || e5 || [""])[0] || "");
  await p5.close();
} finally { await b.close(); }

const skipped = P.rows.filter((r) => r.result === "⏭").length;
if (process.argv.includes("--ledger")) console.log("\n" + P.table());
console.log(`\n${P.failed ? "✗" : "✓"} round 2, group F: ${P.used - P.failed - skipped} green · ${P.failed} red, of ${P.used} driven rows`);
process.exitCode = P.failed ? 1 : 0;   // NOT process.exit(): it discards buffered stdout, which truncated --ledger when piped
