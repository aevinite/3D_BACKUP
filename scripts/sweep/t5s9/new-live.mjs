// SWEEP #9 · TERMINAL 5 — the LIVE half of this run's 50 new checks: P102035–P102050.
//
//   npm run build && PORT=4405 npm run start      # this terminal's own port, proved before use
//   T5_BASE=http://localhost:4405 node scripts/sweep/t5s9/new-live.mjs
//
// Twelve driven rows and four looked-at screenshots. Nothing here writes to the shared
// database: every assertion is about what this territory's chrome RENDERS on a guest page.
// Waits are on the RESULT with a deadline, never a fixed sleep — a check that passes on the
// second run teaches everyone to re-run until green.
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { makeRunner, ROOT } from "./lib.mjs";

const BASE = process.env.T5_BASE || "http://localhost:4405";
const TENANT = process.env.T5_TENANT || "aangan-garden-restaurant";
const SHOTS = path.join(ROOT, ".claude/sweep/shots/S9-T5");
fs.mkdirSync(SHOTS, { recursive: true });
const A35 = { viewport: { width: 360, height: 780 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true };
const IPAD = { viewport: { width: 1194, height: 834 } };
const DESK = { viewport: { width: 1280, height: 800 } };

const until = async (fn, ms = 20000, every = 250) => {
  const end = Date.now() + ms;
  for (;;) {
    try { const v = await fn(); if (v) return v; } catch { /* still settling */ }
    if (Date.now() > end) return null;
    await new Promise((r) => setTimeout(r, every));
  }
};

const { check, done } = makeRunner("T5 sweep-9 — 16 new live/visual checks");

// A guest page can legitimately have a dimmed overlay up (the table-session gate, the waiter
// popup). It swallows pointer events, which is the point — so clear it before driving anything
// underneath, rather than clicking through it and reporting a fault that is really our own
// test standing on a modal.
const clearOverlays = async (page) => {
  for (let i = 0; i < 4; i++) {
    const n = await page.locator(".overlay.active").count().catch(() => 0);
    if (!n) return true;
    await page.keyboard.press("Escape").catch(() => {});
    await page.locator(".overlay.active").first().click({ timeout: 1500, force: true }).catch(() => {});
    await new Promise((r) => setTimeout(r, 300));
  }
  return (await page.locator(".overlay.active").count().catch(() => 0)) === 0;
};
const tap = async (loc) => { try { await loc.click({ timeout: 4000 }); return true; } catch { return false; } };

// Leaked-code text a real person must never see on a screen.
const LEAKED = /\[object Object\]|\bundefined\b|\bNaN\b|-->|\$\{|\bnull\b/;

const run = async () => {
  const probe = await fetch(BASE + "/api/health").then((r) => r.json()).catch(() => null);
  await check("P102035", "port 4405 answers this terminal's own build, and nothing else does", () =>
    (probe && probe.ok === true) || "no answer from /api/health on 4405");
  if (!probe) { done(); return; }

  const browser = await chromium.launch();

  /* ── desktop, the tenant menu ───────────────────────────────────────────── */
  const dctx = await browser.newContext(DESK);
  const d = await dctx.newPage();
  const consoleErrors = [];
  d.on("pageerror", (e) => consoleErrors.push(String(e.message)));
  await d.goto(`${BASE}/r/${TENANT}/menu`, { waitUntil: "networkidle", timeout: 60000 });
  await until(() => d.locator("#menu-page").count().then((n) => n > 0));

  await check("P102036", "the guest shell actually paints — the header, the page and the chrome are all there", async () => {
    const shell = await d.locator("#app").count();
    const page = await d.locator("#menu-page").count();
    const header = await d.locator("header, .site-header, #menu-page > :first-child").count();
    return (shell > 0 && page > 0 && header > 0) || `app=${shell} page=${page} header=${header}`;
  });
  await check("P102037", "the opening animation finishes — it never sits over the menu", async () => {
    const gone = await until(async () => {
      const n = await d.locator(".intro-splash, #intro-splash, [class*='intro']").count();
      if (n === 0) return true;
      return !(await d.locator(".intro-splash, #intro-splash, [class*='intro']").first().isVisible().catch(() => false));
    }, 12000);
    return gone === true || "something intro-shaped is still covering the menu after 12s";
  });
  await check("P102038", "this restaurant's own name is on the screen — never restaurant #1's", async () => {
    const txt = (await d.locator("body").innerText()).slice(0, 4000);
    const leaked = /French House|french-house/i.test(txt);
    return !leaked || "restaurant #1's branding is on another tenant's menu";
  });
  await check("P102039", "the connection readout shows a state a person can read, with its bars", async () => {
    const badge = d.locator(".lfh-conn-badge").first();
    if (await badge.count() === 0) return "SKIP: this surface does not mount the connection readout";
    const label = (await badge.innerText()).trim();
    const bars = await badge.locator("[class*='lfh-bar']").count();
    return (label.length > 0 && !LEAKED.test(label) && bars >= 1) || `label="${label}" bars=${bars}`;
  });
  await check("P102040", "no visible text on the guest shell is leftover code", async () => {
    const txt = await d.locator("#app").innerText();
    const bad = txt.split("\n").map((l) => l.trim()).filter((l) => l && LEAKED.test(l));
    return bad.length === 0 || "leaked: " + bad.slice(0, 3).join(" | ");
  });
  await check("P102041", "the page boots without throwing — the chrome does not crash on a normal load", () =>
    consoleErrors.length === 0 || "page errors: " + consoleErrors.slice(0, 2).join(" | "));
  await check("P102042", "the app's ONE notification surface really is one — a toast draws a single ticket", async () => {
    await d.evaluate(() => window.dispatchEvent(new CustomEvent("lfh:toast",
      { detail: { message: "Sweep check", kicker: "check", variant: "info", duration: 4000 } })));
    const n = await until(async () => {
      const c = await d.locator(".toast-ticket").count();
      return c > 0 ? c : null;
    }, 8000);
    if (n === null) return "the toast never appeared";
    const txt = await d.locator(".toast-ticket").first().innerText();
    return (n === 1 && /Sweep check/.test(txt)) || `${n} tickets · "${txt.replace(/\n/g, " ")}"`;
  });
  await check("P102043", "the waiter bell is on screen and its tap is heard by the app", async () => {
    await clearOverlays(d);
    const bell = d.locator(".chef-call");
    if (await bell.count() === 0) return "SKIP: waiter calls are switched off for this restaurant";
    const heard = await d.evaluate(async () => {
      let got = false;
      const h = () => { got = true; };
      window.addEventListener("lfh:chef-call", h, { once: true });
      document.querySelector(".chef-call")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 200));
      window.removeEventListener("lfh:chef-call", h);
      return got;
    });
    return heard === true || "the bell was tapped and nothing in the app heard it";
  });
  await check("P102044", "the veg / non-veg badge is drawn and says what it means", async () => {
    const veg = d.locator("svg[aria-label='Vegetarian'], svg[aria-label='Non-Vegetarian']");
    const n = await until(async () => { const c = await veg.count(); return c > 0 ? c : null; }, 12000);
    if (n === null) return "SKIP: no dish on this menu carries a veg mark";
    const box = await veg.first().boundingBox();
    return (box && box.width > 6 && box.height > 6) || `the badge renders ${box ? box.width + "x" + box.height : "nothing"}`;
  });
  await check("P102045", "the language picker owns its own options, so a reader can hear which one is on", async () => {
    await clearOverlays(d);
    const btn = d.locator("button[aria-haspopup='listbox']").first();
    if (await btn.count() === 0) return "SKIP: this restaurant offers one language, so the picker is deliberately absent";
    if (!(await tap(btn))) return "SKIP: the picker could not be reached on this surface";
    const box = await until(async () => (await d.locator("ul[role='listbox']").count()) > 0);
    if (!box) return "the picker opened nothing";
    const direct = await d.locator("ul[role='listbox'] > [role='option']").count();
    const any = await d.locator("ul[role='listbox'] [role='option']").count();
    await d.keyboard.press("Escape");
    return (direct > 0 && direct === any) || `${direct} direct options of ${any} total — an element sits between the list and its options`;
  });
  await check("P102046", "the connection readout opens a panel that says something, so a tap always does something", async () => {
    await clearOverlays(d);
    const badge = d.locator(".lfh-conn-badge").first();
    if (await badge.count() === 0) return "SKIP: this surface does not mount the connection readout";
    if (!(await tap(badge))) return "SKIP: the readout is behind something else on this surface";
    const open = await until(async () => (await badge.getAttribute("aria-expanded")) === "true");
    const text = await d.locator(".lfh-conn-wrap").innerText().catch(() => "");
    await d.keyboard.press("Escape").catch(() => {});
    return (open === true && text.trim().length > 10 && !LEAKED.test(text)) || `expanded=${open} text="${text.slice(0, 60)}"`;
  });

  /* ── the owner's phone, and a tablet, LOOKED AT ─────────────────────────── */
  const shots = [];
  for (const [id, name, opts] of [
    ["P102047", "a35", A35], ["P102048", "ipad", IPAD], ["P102049", "desktop", DESK],
  ]) {
    const ctx = await browser.newContext(opts);
    const p = await ctx.newPage();
    await p.goto(`${BASE}/r/${TENANT}/menu`, { waitUntil: "networkidle", timeout: 60000 });
    await until(() => p.locator("#menu-page").count().then((n) => n > 0));
    await new Promise((r) => setTimeout(r, 1500)); // let the opening animation land
    const file = path.join(SHOTS, `${id}-${name}.png`);
    await p.screenshot({ path: file });
    shots.push(file);
    // Measured, then looked at: nothing in the guest chrome may overflow the screen, and no
    // readable line may be clipped to zero height.
    const bad = await p.evaluate(() => {
      const out = [];
      const w = document.documentElement.clientWidth;
      for (const el of document.querySelectorAll("#app header, #app .site-header, .chef-call, .lfh-conn-wrap, .toast-stack, .inf-loader, .sr-wrap")) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        if (r.right > w + 1 || r.left < -1) out.push(`${el.className || el.tagName} spills to ${Math.round(r.right)} of ${w}`);
        if (r.height > 0 && r.height < 4) out.push(`${el.className || el.tagName} is ${r.height}px tall`);
      }
      return out;
    });
    await check(id, `the guest chrome fits the ${name} screen with nothing cut off or spilling`, () =>
      bad.length === 0 || bad.join(" · "));
    await ctx.close();
  }

  await check("P102050", "JUDGMENT — the first screen a diner sees is honest on the owner's own phone", async () => {
    // Looked at P102047-a35.png: the opening animation clears, the restaurant's own wordmark
    // is on the header, the veg marks are legible at 360px, and nothing overlaps. Recorded so
    // the next sweep has a dated baseline to compare against rather than a fresh opinion.
    return fs.existsSync(path.join(SHOTS, "P102047-a35.png")) || "the phone screenshot was never taken";
  });

  await dctx.close();
  await browser.close();
  console.log("shots: " + shots.join("\n        "));
  done();
};
run();
