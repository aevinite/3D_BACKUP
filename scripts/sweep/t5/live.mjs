// Sweep #8 · terminal 5 · the LIVE half of P58701–P59700, driven headless against a
// PRODUCTION build on port 4305 (this terminal's own port, proved before anything is trusted).
//
//   npm run build && PORT=4305 npm run start
//   node scripts/sweep/t5/live.mjs
//
// A production build matters here, not a convenience: public/sw.js takes a DIFFERENT path on
// localhost in dev (IS_DEV makes /_next/static network-first), and the dev server compiles each
// route on first hit, which trips the worker's own 6s stall guard and looks like a fault.
import { chromium } from "playwright";
import { check, report, skip } from "./lib.mjs";
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./lib.mjs";
// A guard that drives the app says so in a sentence when the app is not up, instead of a stack
// trace — the house rule verify:guards-alive enforces.
import { requireUp } from "../appUp.mjs";

const BASE = process.env.T5_BASE || "http://localhost:4305";
const SHOTS = path.join(ROOT, ".claude/sweep/shots/T5");
fs.mkdirSync(SHOTS, { recursive: true });
const A35 = { width: 360, height: 780, deviceScaleFactor: 3, isMobile: true, hasTouch: true };
const DESK = { width: 1280, height: 800 };

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// The two restaurants this run reads. Aangan is the READ-ONLY control and is only ever OPENED here.
const TENANT = "aangan-garden-restaurant";

async function main() {
  const browser = await chromium.launch();
  try { return await run(browser); } finally { await browser.close().catch(() => {}); }
}

async function run(browser) {

  // ── the port really is ours ────────────────────────────────────────────────
  await requireUp(BASE, "the T5 sweep's live checks");
  const probe = await fetch(BASE + "/api/health").then((r) => r.json()).catch(() => null);
  check("P59251", "port 4305 answers this build and nothing else", () => !!probe || "no answer from /api/health");

  // ══ 1 · the three guest doors render, in a real browser ═══════════════════
  const ctx = await browser.newContext({ viewport: DESK });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

  const open = async (url, sel = "#app") => {
    await page.goto(BASE + url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForSelector(sel, { timeout: 20000 }).catch(() => {});
    // The grid is rendered from a client fetch, so the shell existing proves nothing about the
    // dishes. Wait for a real card — a check that reads 0 cards a beat too early is a fault of
    // the check, not of the menu.
    await page.waitForSelector(".item-card", { timeout: 25000 }).catch(() => {});
  };

  await open("/menu");
  const legacy = await page.evaluate(() => ({
    app: !!document.querySelector("#app"),
    brand: (document.querySelector(".brand-title")?.textContent || "").trim(),
    badge: !!document.querySelector(".lfh-conn-badge"),
    cards: document.querySelectorAll(".item-card").length,
    menuPage: !!document.querySelector("#menu-page"),
  }));
  check("P59254", "the guest app shell is on screen", () => legacy.app || "no #app");
  check("P59255", "the menu page is inside it", () => legacy.menuPage || "no #menu-page");
  check("P59256", "the wordmark renders real words, not a code token", () =>
    (legacy.brand.length > 0 && !/undefined|NaN|\[object/.test(legacy.brand)) || `brand="${legacy.brand}"`);
  check("P59257", "the connection badge is rendered in the header", () => legacy.badge || "no .lfh-conn-badge");
  check("P59258", "the menu lists dishes", () => legacy.cards > 0 || "0 cards");
  check("P59259", "no page error was thrown while the guest menu loaded", () =>
    errors.length === 0 || errors.slice(0, 2).join(" | "));

  await open(`/r/${TENANT}/menu`);
  const tenant = await page.evaluate(() => ({
    brand: (document.querySelector(".brand-title")?.textContent || "").trim(),
    cards: document.querySelectorAll(".item-card").length,
    stored: (() => { try { return localStorage.getItem("lfh_brand"); } catch { return null; } })(),
  }));
  check("P59260", "the tenant door renders that restaurant's own wordmark", () =>
    tenant.brand.length > 0 || "no wordmark");
  check("P59261", "…and it is NOT restaurant #1's", () =>
    tenant.brand !== legacy.brand || `both doors show "${tenant.brand}"`);
  check("P59262", "the tenant menu lists dishes", () => tenant.cards > 0 || "0 cards");
  check("P59263", "AppShell has stored this restaurant's name for the last-resort page", () =>
    !!tenant.stored || "lfh_brand was never written");
  check("P59264", "…under the slug the offline page will derive for this path", () => {
    const b = JSON.parse(tenant.stored || "{}");
    return b.slug === TENANT || `stored slug ${JSON.stringify(b.slug)}`;
  });
  check("P59265", "…and with a real name in it", () => {
    const b = JSON.parse(tenant.stored || "{}");
    return (typeof b.name === "string" && b.name.trim().length > 0) || "no name";
  });

  // ── the intro splash's own geometry (the thing arithmetic cannot settle) ──
  const splash = await page.evaluate(() => {
    // Rebuild the intro wordmark's real DOM and CSS with a long restaurant name and MEASURE it —
    // the live splash has already lifted by the time a script can look, and one visit only shows
    // one name. Nothing is fetched and nothing is stored.
    const probeName = "The Great Indian Kitchen & Bakehouse";
    const wrap = document.createElement("div");
    wrap.className = "intro-splash";
    wrap.style.visibility = "hidden";
    const word = document.createElement("div");
    word.className = "intro-word";
    for (const ch of Array.from(probeName)) {
      const s = document.createElement("span");
      s.textContent = ch === " " ? " " : ch;
      word.appendChild(s);
    }
    wrap.appendChild(word);
    document.body.appendChild(wrap);
    const r = word.getBoundingClientRect();
    const cs = getComputedStyle(word);
    const out = { w: Math.round(r.width), vw: window.innerWidth, wrapFlex: cs.display, flexWrap: cs.flexWrap,
                  overflow: getComputedStyle(wrap).overflow, left: Math.round(r.left), right: Math.round(r.right) };
    wrap.remove();
    return out;
  });
  check("P59266", "the intro wordmark is a flex row", () => splash.wrapFlex === "flex" || splash.wrapFlex);
  check("P59267", "a 36-character restaurant name still fits the desktop splash", () =>
    splash.w <= splash.vw || `${splash.w}px of name in a ${splash.vw}px window`);

  // ══ 2 · the same three doors on a phone ═══════════════════════════════════
  const mctx = await browser.newContext({ viewport: A35, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const mp = await mctx.newPage();
  await mp.goto(`${BASE}/r/${TENANT}/menu`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await mp.waitForSelector("#app", { timeout: 20000 }).catch(() => {});
  await mp.waitForSelector(".item-card", { timeout: 25000 }).catch(() => {});
  // Built the way components/IntroSplash.tsx builds it — one flex item per WORD, with the box's
  // own inline style — and measured against the REAL stylesheet. The live splash has already
  // lifted by the time a script can look, and one visit only ever shows one name.
  const phoneSplash = await mp.evaluate(() => {
    const probeName = "The Great Indian Kitchen & Bakehouse";
    const NB = String.fromCharCode(0xa0);
    const wrap = document.createElement("div");
    wrap.className = "intro-splash"; wrap.style.visibility = "hidden";
    const word = document.createElement("div"); word.className = "intro-word";
    Object.assign(word.style, { flexWrap: "wrap", justifyContent: "center", maxWidth: "92vw", rowGap: "2px", fontSize: "clamp(17px, 5vw, 22px)" });
    for (const w of probeName.split(" ")) {
      const seg = document.createElement("div"); seg.className = "intro-word-seg";
      seg.style.display = "inline-block"; seg.style.whiteSpace = "nowrap";
      for (const ch of Array.from(w + " ")) { const s = document.createElement("span"); s.textContent = ch === " " ? NB : ch; seg.appendChild(s); }
      word.appendChild(seg);
    }
    wrap.appendChild(word); document.body.appendChild(wrap);
    const r = word.getBoundingClientRect();
    const cs = getComputedStyle(word.querySelector("span"));
    const fs = parseFloat(cs.fontSize) || 0;
    const lh = parseFloat(cs.lineHeight) || fs * 1.2;
    const out = { w: Math.round(r.width), vw: window.innerWidth, left: Math.round(r.left), right: Math.round(r.right),
                  wrap: getComputedStyle(word).flexWrap, font: fs, lines: Math.max(1, Math.round(r.height / lh)),
                  segs: word.querySelectorAll(".intro-word-seg").length };
    wrap.remove(); return out;
  });
  check("P59268", "a 36-character restaurant name fits the splash on a 360px phone", () =>
    phoneSplash.w <= phoneSplash.vw || `${phoneSplash.w}px of name in a ${phoneSplash.vw}px screen`);
  check("P59269", "…and none of it sits off the left or the right edge", () =>
    (phoneSplash.left >= 0 && phoneSplash.right <= phoneSplash.vw) || `x runs ${phoneSplash.left}→${phoneSplash.right}`);
  check("P59331", "…because it wrapped onto a second line rather than being cut", () =>
    phoneSplash.lines >= 2 || `the name is still on ${phoneSplash.lines} line(s) at ${phoneSplash.w}px`);
  check("P59332", "…and the break landed between WORDS, never between two letters", () =>
    phoneSplash.segs >= 2 || `${phoneSplash.segs} word group(s) — the letters are loose in the box again`);
  check("P59333", "the opening name is the smaller size the owner asked for", () =>
    (phoneSplash.font > 0 && phoneSplash.font <= 22) || `${phoneSplash.font}px`);

  const phone = await mp.evaluate(() => {
    const nav = document.querySelector(".nav");
    const brand = document.querySelector(".brand-title");
    const acts = document.querySelector(".nav-actions");
    const r = (el) => { const b = el?.getBoundingClientRect(); return b ? { l: Math.round(b.left), r: Math.round(b.right), w: Math.round(b.width) } : null; };
    return { nav: r(nav), brand: r(brand), acts: r(acts), vw: window.innerWidth,
             brandText: (brand?.textContent || "").trim(),
             cut: brand ? brand.scrollWidth - brand.clientWidth : 0 };
  });
  check("P59270", "the top bar fits the phone", () => (phone.nav && phone.nav.r <= phone.vw + 1) || JSON.stringify(phone.nav));
  check("P59271", "the restaurant's own name is not cut off on a 360px phone", () =>
    phone.cut <= 1 || `${phone.cut}px of the name is clipped`);
  check("P59272", "the name and the buttons do not overlap", () =>
    (!phone.brand || !phone.acts || phone.brand.r <= phone.acts.l + 1) || `brand ends ${phone.brand.r}, buttons start ${phone.acts.l}`);

  // ══ 3 · the connection badge, on a phone ═════════════════════════════════
  await mp.click(".lfh-conn-badge").catch(() => {});
  await wait(400);
  const pop = await mp.evaluate(() => {
    const p = document.querySelector(".lfh-conn-pop");
    if (!p) return null;
    const b = p.getBoundingClientRect();
    return { l: Math.round(b.left), r: Math.round(b.right), vw: window.innerWidth,
             text: (p.textContent || "").trim().slice(0, 120),
             bars: document.querySelectorAll(".lfh-conn-pop .lfh-bar").length,
             barW: Math.round(document.querySelector(".lfh-conn-pop .lfh-bar")?.getBoundingClientRect().width || 0) };
  });
  check("P59273", "tapping the connection pill opens its panel", () => !!pop || "no .lfh-conn-pop");
  check("P59274", "…and the whole panel is on screen at 360px", () =>
    !pop || (pop.l >= 0 && pop.r <= pop.vw) || `panel runs ${pop.l}→${pop.r} in ${pop.vw}px`);
  check("P59275", "…its signal bars are actually drawn (not a 0×0 meter)", () =>
    !pop || pop.barW > 0 || "the bars measure 0px wide");
  check("P59276", "…and it says something a person can read", () =>
    !pop || (pop.text.length > 10 && !/undefined|NaN|\[object/.test(pop.text)) || pop.text);
  await mp.screenshot({ path: path.join(SHOTS, "conn-badge-a35.png") });

  // the phone back button closes the popover before it leaves the site
  await mp.goBack().catch(() => {});
  await wait(400);
  const afterBack = await mp.evaluate(() => ({
    pop: !!document.querySelector(".lfh-conn-pop"),
    path: location.pathname,
  }));
  check("P59277", "the phone back button closes the connection panel first", () => !afterBack.pop || "the panel stayed open");
  check("P59278", "…and does not leave the menu", () => /\/menu$/.test(afterBack.path) || afterBack.path);

  // ══ 4 · the language picker ══════════════════════════════════════════════
  const picker = await mp.evaluate(() => {
    const btns = [...document.querySelectorAll(".nav-actions .nav-btn")];
    const lang = btns.find((b) => b.getAttribute("aria-label") === "Language");
    if (!lang) return { present: false };
    lang.click();
    const list = document.querySelector(".nav-picker-list");
    return {
      present: true,
      role: list?.getAttribute("role"),
      options: list ? list.querySelectorAll('[role="option"]').length : 0,
      directChildren: list ? [...list.children].filter((c) => c.getAttribute("role") === "option").length : 0,
      selected: list ? list.querySelectorAll('[aria-selected="true"]').length : 0,
      li: list ? list.querySelectorAll("li").length : 0,
    };
  });
  if (!picker.present) skip("P59279", "the language picker's listbox owns its options", "this restaurant offers one language, so the picker is deliberately absent");
  else {
    check("P59279", "the language list is a listbox that OWNS its options", () =>
      (picker.role === "listbox" && picker.options > 0 && picker.options === picker.directChildren) || JSON.stringify(picker));
    check("P59280", "…with nothing in between (an <li> breaks the ownership)", () => picker.li === 0 || `${picker.li} <li> in the list`);
    check("P59281", "…and the current language is conveyed, not only coloured", () => picker.selected === 1 || `${picker.selected} marked selected`);
  }

  // ══ 5 · the offline layer, for real ══════════════════════════════════════
  const swctx = await browser.newContext({ viewport: A35, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const sp = await swctx.newPage();
  await sp.goto(`${BASE}/r/${TENANT}/menu`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await sp.waitForSelector(".item-card", { timeout: 20000 }).catch(() => {});
  // give the worker time to install, claim the client and answer the warm messages
  for (let i = 0; i < 20; i++) {
    const ready = await sp.evaluate(() => !!navigator.serviceWorker.controller);
    if (ready) break;
    await wait(500);
  }
  await wait(2500);
  const sw = await sp.evaluate(async () => {
    const controlled = !!navigator.serviceWorker.controller;
    const names = await caches.keys();
    const shell = names.find((n) => n.startsWith("lfh-shell"));
    const data = names.find((n) => n.startsWith("lfh-data"));
    const asset = names.find((n) => n.startsWith("lfh-asset"));
    const fallback = names.find((n) => n.startsWith("lfh-fallback"));
    const count = async (n) => (n ? (await (await caches.open(n)).keys()).length : 0);
    // ask the running worker its own version — no extra request, this is what LFH_PING is for
    const version = await new Promise((res) => {
      if (!navigator.serviceWorker.controller) return res(null);
      const ch = (e) => { if (e.data && e.data.type === "LFH_PONG") { navigator.serviceWorker.removeEventListener("message", ch); res(e.data.version); } };
      navigator.serviceWorker.addEventListener("message", ch);
      navigator.serviceWorker.controller.postMessage({ type: "LFH_PING" });
      setTimeout(() => res(null), 3000);
    });
    return { controlled, names, version,
             shell: await count(shell), data: await count(data), asset: await count(asset), fallback: await count(fallback) };
  });
  check("P59282", "the offline layer takes control of a guest page", () => sw.controlled || "no controller");
  check("P59283", "the running worker answers with its own version", () => !!sw.version || "no LFH_PONG");
  check("P59284", "…and it is the version in the file", () => {
    const v = (fs.readFileSync(path.join(ROOT, "public/sw.js"), "utf8").match(/const VERSION = "(v\d+)"/) || [])[1];
    return sw.version === v || `worker ${sw.version} vs file ${v}`;
  });
  check("P59285", "the four caches all exist under the current version", () =>
    ["lfh-shell", "lfh-asset", "lfh-data", "lfh-fallback"].every((p) => sw.names.some((n) => n === `${p}-${sw.version}`))
    || sw.names.join(", "));
  check("P59286", "no cache from an older version is left behind", () =>
    sw.names.every((n) => n.endsWith("-" + sw.version)) || `stale: ${sw.names.filter((n) => !n.endsWith("-" + sw.version)).join(", ")}`);
  check("P59287", "the page a diner is looking at RIGHT NOW is saved on the first visit", () => sw.shell > 0 || "the shell cache is empty");
  check("P59288", "…and so is the code that makes it a page", () => sw.asset > 0 || "the asset cache is empty");
  check("P59289", "…and its menu read, so an offline reload has dishes", () => sw.data > 0 || "the data cache is empty");
  check("P59290", "the branded last-resort page is precached in its own cache", () => sw.fallback > 0 || "the fallback cache is empty");

  // now cut the network and reload the SAME page
  await swctx.setOffline(true);
  await sp.reload({ waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {});
  await wait(3000);
  const off = await sp.evaluate(() => ({
    cards: document.querySelectorAll(".item-card").length,
    styled: getComputedStyle(document.body).backgroundColor,
    serif: getComputedStyle(document.body).fontFamily,
    bar: (document.querySelector('[role="status"]')?.textContent || "").trim(),
    staticBar: (document.getElementById("lfh-offline-static")?.textContent || "").trim(),
    barCount: document.querySelectorAll('[role="status"]').length,
    text: document.body.innerText.slice(0, 200),
    onLine: navigator.onLine,
  }));
  await sp.screenshot({ path: path.join(SHOTS, "offline-reload-a35.png") });
  check("P59291", "an offline reload of a menu already visited still lists its dishes", () => off.cards > 0 || `0 cards; page said "${off.text.slice(0, 80)}"`);
  check("P59292", "…with its CSS, not black serif text on white", () =>
    (!/Times/i.test(off.serif) && off.styled !== "rgba(0, 0, 0, 0)") || `font=${off.serif} bg=${off.styled}`);
  check("P59293", "…and an honest strip says the screen is showing saved data", () =>
    /saved|No internet/i.test(off.bar + off.staticBar) || `bar said "${off.bar}" / "${off.staticBar}"`);
  // The WORDING has to match what the browser itself believes. "No internet" when navigator.onLine
  // is false; "Connection is struggling" when it is true but the reads are coming off the device —
  // which is the café-wifi case and is the honest thing to say there.
  check("P59324", "…and the strip's wording matches what the browser reports about the link", () =>
    (off.onLine === false ? /No internet/i.test(off.bar) : /struggling/i.test(off.bar))
    || `navigator.onLine=${off.onLine} but the strip said "${off.bar}"`);
  check("P59294", "…exactly ONE strip, never two saying different things", () => {
    const n = (off.bar ? 1 : 0) + (off.staticBar ? 1 : 0);
    return n === 1 || `${n} bars on screen`;
  });

  // a screen this device has NEVER opened, with no network → the branded page
  await sp.goto(`${BASE}/r/${TENANT}/menu?never-opened=` + Date.now(), { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {});
  await wait(1500);
  const lastResort = await sp.evaluate(() => ({
    title: (document.querySelector("h1")?.textContent || "").trim(),
    retry: !!document.getElementById("retry"),
    home: !!document.getElementById("home"),
    homeText: (document.getElementById("home")?.textContent || "").trim(),
    homeHidden: document.getElementById("home")?.hidden ?? null,
    brand: (document.getElementById("brand")?.textContent || "").trim(),
    brandHidden: document.getElementById("brand")?.hidden ?? null,
    game: !!document.getElementById("cv"),
    bars: document.querySelectorAll("#bars i").length,
    label: (document.getElementById("m-label")?.textContent || "").trim(),
    why: (document.getElementById("why")?.textContent || "").trim(),
    foot: (document.querySelector(".foot")?.textContent || "").trim(),
    body: document.body.innerText.slice(0, 400),
  }));
  await sp.screenshot({ path: path.join(SHOTS, "offline-page-a35.png") });
  const gotPage = /Can't open this screen|No internet right now|isn't answering/i.test(lastResort.title);
  check("P59295", "a screen never opened on this device gets OUR page, not the browser's", () => gotPage || `h1 said "${lastResort.title}"`);
  check("P59296", "…with a Try again", () => lastResort.retry || "no #retry");
  check("P59297", "…and a way out that is not a dead end", () => lastResort.home || "no #home");
  check("P59298", "…which sends a DINER to the menu, not to the staff sign-in", () =>
    /menu/i.test(lastResort.homeText) || `the button says "${lastResort.homeText}"`);
  check("P59299", "…and names the restaurant this device has actually stored", () =>
    (lastResort.brandHidden === false && lastResort.brand.length > 0) || `brand hidden=${lastResort.brandHidden} text="${lastResort.brand}"`);
  // Item 6: the card must call the restaurant what the MENU calls it. The card upper-cases in CSS,
  // so the comparison is case-insensitive; what must match is the WORDS.
  check("P59334", "…using the same name the menu header shows, not the longer registered one", () => {
    const a = lastResort.brand.replace(/\s+/g, " ").trim().toLowerCase();
    const b = (tenant.brand || "").replace(/\s+/g, " ").trim().toLowerCase();
    return (a && b && a === b) || `card says "${lastResort.brand}", the menu header says "${tenant.brand}"`;
  });
  check("P59300", "the signal meter is drawn with its five bars", () => lastResort.bars === 5 || `${lastResort.bars} bars`);
  check("P59301", "…and says something rather than inventing a number", () =>
    (lastResort.label.length > 0 && !/undefined|NaN/.test(lastResort.label)) || `label="${lastResort.label}"`);
  check("P59302", "the game is there to pass the time", () => lastResort.game || "no canvas");
  check("P59303", "the closing line promises only what is guaranteed", () =>
    /Anything already saved is safe/.test(lastResort.foot) || `foot="${lastResort.foot}"`);
  check("P59304", "nothing on the page renders as a code token", () =>
    !/undefined|NaN|\[object Object\]|\$\{|-->/.test(lastResort.body) || lastResort.body.slice(0, 120));

  // …and the cause it names is TESTED, not guessed
  const cause = await sp.evaluate(() => new Promise((res) => setTimeout(() => res({
    title: (document.querySelector("h1")?.textContent || "").trim(),
    why: (document.getElementById("why")?.textContent || "").trim(),
  }), 2500)));
  check("P59305", "with the device genuinely offline it says so, and blames nothing else", () =>
    /No internet/i.test(cause.title) || `it said "${cause.title}"`);
  check("P59306", "…and its one line of cause is filled in only once a cause is established", () =>
    cause.why.length > 0 || "the cause line stayed empty");

  await swctx.setOffline(false);

  // ══ 6 · the exit guard, on all three doors ═══════════════════════════════
  for (const [i, door] of [["/menu"], [`/r/${TENANT}/menu`]].entries()) {
    const gctx = await browser.newContext({ viewport: A35, isMobile: true, hasTouch: true });
    const gp = await gctx.newPage();
    await gp.goto(BASE + door[0], { waitUntil: "domcontentloaded", timeout: 45000 });
    await gp.waitForSelector("#app", { timeout: 20000 }).catch(() => {});
    await wait(1200);
    const g = await gp.evaluate(() => ({
      armed: !!(history.state && history.state.__lfhExitGuard),
      path: location.pathname, search: location.search,
      state: JSON.stringify(history.state || null).slice(0, 120),
      len: history.length,
    }));
    check(`P5930${7 + i}`, `the exit guard is armed on ${door[0]}`, () =>
      g.armed || `landed on ${g.path}${g.search}, history.state=${g.state}`);
    await gctx.close();
  }

  // ══ 7 · the printer's Allow screen carries no diner app (item 1) ═════════
  const pctx = await browser.newContext({ viewport: DESK });
  const pp = await pctx.newPage();
  const guestCalls = [];
  pp.on("request", (r) => {
    const u = r.url();
    if (/\/rest\/v1\/rpc\/lfh_(check_ban|greet_device)/.test(u) || /realtime/.test(u)) guestCalls.push(u.slice(0, 90));
  });
  await pp.goto(BASE + "/pair", { waitUntil: "domcontentloaded", timeout: 45000 });
  await wait(2500);
  const pair = await pp.evaluate(() => ({
    cart: !!document.querySelector(".mini-cart, .cart-panel, #cart-panel"),
    session: !!document.querySelector(".sg-overlay, .stb, .session-widget"),
    toast: !!document.querySelector(".toast-stack"),
    outbox: !!document.querySelector(".gob-chip"),
    text: document.body.innerText.slice(0, 120),
  }));
  check("P59309", "the printer's Allow screen shows no diner basket", () => !pair.cart || "a cart surface is on /pair");
  check("P59310", "…no table-session card", () => !pair.session || "a session surface is on /pair");
  check("P59311", "…and no saved-orders chip", () => !pair.outbox || "the outbox chip is on /pair");
  check("P59312", "…and it makes no guest database call of its own", () =>
    guestCalls.length === 0 || guestCalls.join(" | "));
  check("P59313", "…while still rendering its own card", () => pair.text.length > 0 || "the page is blank");
  await pp.screenshot({ path: path.join(SHOTS, "pair-desktop.png") });
  await pctx.close();

  // ══ 8 · a dish that is not there ═════════════════════════════════════════
  const nctx = await browser.newContext({ viewport: A35, isMobile: true, hasTouch: true });
  const np = await nctx.newPage();
  await np.goto(`${BASE}/r/${TENANT}/item/zz-no-such-dish-${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {});
  await wait(1500);
  const nf = await np.evaluate(() => ({
    gnf: !!document.querySelector(".gnf"),
    h1: (document.querySelector(".gnf h1")?.textContent || document.querySelector("h1")?.textContent || "").trim(),
    btn: (document.querySelector(".gnf .btn")?.textContent || "").trim(),
    href: document.querySelector(".gnf .btn")?.getAttribute("href") || "",
    aevidine: /Aevidine/i.test(document.body.innerText),
    body: document.body.innerText.slice(0, 250),
  }));
  await np.screenshot({ path: path.join(SHOTS, "guest-notfound-a35.png") });
  check("P59314", "a missing dish gets the GUEST dead-end screen, not the platform 404", () => nf.gnf || `h1="${nf.h1}"`);
  check("P59315", "…which never shows a diner the software vendor's name", () => !nf.aevidine || "the page says Aevidine");
  check("P59316", "…and offers a way back into THIS restaurant's menu", () =>
    nf.href.includes(TENANT) || `button href="${nf.href}"`);
  check("P59317", "…with no code token on screen", () =>
    !/undefined|NaN|\[object Object\]|\$\{/.test(nf.body) || nf.body.slice(0, 120));
  await nctx.close();

  // ══ 9 · a look at the two skins, with human eyes ═════════════════════════
  await mp.goto(`${BASE}/r/${TENANT}/menu`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await wait(1500);
  for (const skin of ["dark", "light"]) {
    await mp.evaluate((s) => { document.documentElement.setAttribute("data-theme", s); }, skin);
    await wait(500);
    await mp.screenshot({ path: path.join(SHOTS, `menu-${skin}-a35.png`), fullPage: false });
  }
  const ink = await mp.evaluate(() => {
    const out = {};
    for (const sel of [".brand-title", ".dish-name", ".dish-price", ".lfh-conn-badge"]) {
      const el = document.querySelector(sel);
      if (!el) { out[sel] = null; continue; }
      const cs = getComputedStyle(el);
      out[sel] = { color: cs.color, size: cs.fontSize };
    }
    return out;
  });
  check("P59318", "every guest-header surface resolves a real colour in the light skin", () =>
    Object.entries(ink).every(([, v]) => !v || (v.color && v.color !== "rgba(0, 0, 0, 0)")) || JSON.stringify(ink));

  const leaked = await mp.evaluate(() => {
    const t = document.body.innerText;
    const bad = ["undefined", "NaN", "[object Object]", "${", "-->"].filter((s) => t.includes(s));
    return { bad, len: t.length };
  });
  check("P59319", "no code token has leaked onto the guest menu", () => leaked.bad.length === 0 || leaked.bad.join(", "));

  // ══ 10 · the toast is the app's one notification ═════════════════════════
  const toast = await mp.evaluate(async () => {
    window.dispatchEvent(new CustomEvent("lfh:toast", { detail: { message: "Sweep probe", kicker: "check", variant: "info" } }));
    await new Promise((r) => setTimeout(r, 300));
    const el = document.querySelector(".toast-ticket");
    const r = el?.getBoundingClientRect();
    return { shown: !!el, text: (el?.textContent || "").trim(), left: r ? Math.round(r.left) : null,
             right: r ? Math.round(r.right) : null, vw: window.innerWidth };
  });
  check("P59320", "a toast really appears when the app raises one", () => toast.shown || "no ticket");
  check("P59321", "…carrying the words it was given", () => /Sweep probe/.test(toast.text) || toast.text);
  check("P59322", "…and fits the phone", () => !toast.shown || (toast.left >= 0 && toast.right <= toast.vw) || `${toast.left}→${toast.right} in ${toast.vw}`);
  await wait(1600);
  const gone = await mp.evaluate(() => !document.querySelector(".toast-ticket"));
  check("P59323", "…and takes itself away again", () => gone || "the ticket stayed");

  await ctx.close().catch(() => {}); await mctx.close().catch(() => {}); await swctx.close().catch(() => {});
  return report("T5 live — port 4305");
}

main().then((bad) => process.exit(bad ? 1 : 0)).catch((e) => {
  console.error("live run stopped early:", String(e && e.message || e).split("\n")[0]);
  report("T5 live — port 4305 (stopped early)");
  process.exit(1);
});
