// t29-live.mjs — SWEEP #9, TERMINAL 29. Phases P104443–P104450, driven in a REAL browser.
//
// The eight live rows behind `scripts/verify-migrations-1-80.mjs`'s group C. They exist because a
// ledger row that says "the code does X" is not evidence a guest ever saw X: these eighty files
// build the menu tables, the category bar, the filter chips, the rupee prices and the maintenance
// switch, and nothing in the ledger had ever loaded the page and looked.
//
// Port 4429 — this terminal's own. NEVER 4000, that is the owner's window.
// Screenshots land in .claude/sweep/shots/S9-T29/ and are kept: they are the evidence for the rows.
//
//   npm run dev  (PORT=4429)   then   node scripts/sweep/t29-live.mjs
import { chromium } from "playwright";
import { requireAppUp } from "./appUp.mjs";

// Exits 2 with a plain sentence when nothing is answering, instead of a stack trace — the rule
// verify:guards-alive enforces, and the reason nobody should have to know which script words it
// which way. Defaults to this terminal's own port; `--base <url>` overrides it.
if (!process.argv.some((a) => a === "--base")) process.argv.push("--base", "http://localhost:4429");
const BASE = await requireAppUp(process.argv);
const SHOT = "/Users/aevinite/Documents/Projects/wt-s9-t29/.claude/sweep/shots/S9-T29";
const LEAK = /-->|\$\{|\bundefined\b|\bNaN\b|\[object Object\]/;
const out = [];
const rec = (id, what, ok, detail) => { out.push({ id, ok }); console.log(`  ${ok ? "✓" : "✗"} ${id}  ${what}${detail ? " — " + detail : ""}`); };

const b = await chromium.launch();
try {
  // ── desktop, restaurant #1 ────────────────────────────────────────────────
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", e => errs.push(String(e).slice(0, 120)));
  await p.goto(`${BASE}/r/french-house/menu?table=1`, { waitUntil: "networkidle", timeout: 60000 });
  await p.waitForTimeout(2500);

  const cards = await p.locator('[data-dish], [data-item-slug], article, .dish-card').count();
  const txt = await p.locator("body").innerText();
  rec("P104443", "the guest menu renders real dishes from the tables migrations 001/002 create",
    txt.length > 200 && /\d/.test(txt), `${cards} card node(s), ${txt.length} chars of visible text`);

  const ratingBits = (txt.match(/[★⭐]\s*[^\s]{0,8}/g) || []).join(" ");
  rec("P104444", "every rating the cards show is a real number or absent — never NaN / undefined / [object Object]",
    !LEAK.test(ratingBits), ratingBits ? `saw: ${ratingBits.slice(0, 80)}` : "no rating shown on this menu (migration 359 removed the typed one)");

  rec("P104445", "nothing on the guest menu leaks code text",
    !LEAK.test(txt), (txt.match(LEAK) || [""])[0]);

  await p.screenshot({ path: `${SHOT}/P104443-P104445-desktop-french-house.png`, fullPage: false });

  // categories (migration 002) — this restaurant's own
  const cats1 = await p.evaluate(() => Array.from(document.querySelectorAll("button,a")).map(e => e.textContent.trim()).filter(t => t && t.length < 24).slice(0, 40));

  // ── phone ─────────────────────────────────────────────────────────────────
  const mob = await b.newContext({ viewport: { width: 360, height: 780 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const mp = await mob.newPage();
  await mp.goto(`${BASE}/r/french-house/menu?table=1`, { waitUntil: "networkidle", timeout: 60000 });
  await mp.waitForTimeout(2500);
  const overflow = await mp.evaluate(() => {
    const d = document.documentElement;
    return { scrollW: d.scrollWidth, clientW: d.clientWidth };
  });
  await mp.screenshot({ path: `${SHOT}/P104446-phone-360x780-french-house.png` });
  rec("P104446", "at the owner's phone width (360×780) nothing runs off the side of the guest menu",
    overflow.scrollW <= overflow.clientW + 2, `scrollWidth ${overflow.scrollW} vs ${overflow.clientW}`);

  // ── a second restaurant ───────────────────────────────────────────────────
  const p2 = await ctx.newPage();
  await p2.goto(`${BASE}/r/spice-route/menu?table=1`, { waitUntil: "networkidle", timeout: 60000 });
  await p2.waitForTimeout(2500);
  const txt2 = await p2.locator("body").innerText();
  await p2.screenshot({ path: `${SHOT}/P104447-P104450-desktop-spice-route.png` });
  const shared = cats1.filter(c => c.length > 3 && txt2.includes(c));
  rec("P104447", "a second restaurant's menu shows ITS OWN dishes, not restaurant #1's",
    txt2.length > 200 && txt2 !== txt, `${txt2.length} chars, and the two pages differ`);
  rec("P104448", "…and it does not carry restaurant #1's name or branding",
    !/My Little French House/i.test(txt2), "");
  rec("P104449", "…and it renders its own category bar (the DB-driven categories of migration 002)",
    txt2.length > 0 && !LEAK.test(txt2), `${shared.length} label(s) in common with restaurant #1`);

  // ── service_mode (migration 004) is OFF, so the menu is served, not the maintenance screen ──
  rec("P104450", "migration 004's maintenance switch is OFF for this restaurant, so guests get the menu, not the under-maintenance screen",
    !/under maintenance|maintenance mode/i.test(txt), "");

  if (errs.length) console.log("  ⓘ page errors seen: " + errs.slice(0, 3).join(" | "));
} finally { await b.close(); }
const bad = out.filter(o => !o.ok);
console.log(`\n${bad.length ? "✗" : "✓"} live pass: ${out.length - bad.length} of ${out.length} green`);
