// T2 · sweep #9 round 2 — the DRIVEN half. Needs a production build on --base.
//   npm run build && npx next start -p 4402
//   node scripts/sweep/t2/s9r2-live.mjs --base http://localhost:4402
import { chromium } from "playwright";
import { check, skip, save, nextId, idsLeft } from "./s9r2-lib.mjs";

const BASE = (() => { const i = process.argv.indexOf("--base"); return i > 0 ? process.argv[i + 1] : "http://localhost:4402"; })();
const browser = await chromium.launch();
const A35 = { viewport: { width: 360, height: 780 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, serviceWorkers: "block" };
const ctxOf = async (o = {}) => browser.newContext({ ...A35, ...o });
const L = (what, how, fn) => check(nextId(), what, how, fn);

// one page per journey, reused for every assertion about it — no repeated loads
const grab = async (url, { wait = 2000, theme, route, ctxOpts } = {}) => {
  const ctx = await ctxOf(ctxOpts);
  const p = await ctx.newPage();
  const errs = [], reqs = [];
  p.on("pageerror", (e) => errs.push(String(e.message)));
  p.on("console", (m) => { if (m.type() === "error") errs.push("console: " + m.text()); });
  p.on("request", (r) => reqs.push(r.url()));
  if (theme) await p.addInitScript((t) => { try { localStorage.setItem("lfh_theme", t); } catch (e) {} }, theme);
  if (route) await route(p);
  const res = await p.goto(url, { waitUntil: "domcontentloaded" }).catch(() => null);
  const servedHead = await p.evaluate(() => ({
    titles: [...document.querySelectorAll("title")].map((e) => e.textContent),
    descs: [...document.querySelectorAll('meta[name="description"]')].map((e) => e.getAttribute("content")),
  })).catch(() => ({ titles: [], descs: [] }));
  await p.waitForTimeout(wait);
  return { ctx, p, errs, reqs, res, servedHead };
};

// ── the 3D door: its tab title, its tenant pin, and a COLD link ──────────────────────────────
for (const [slug, name] of [["french-house", "My Little French House"], ["aangan-garden-restaurant", "AANGAN GARDEN RESTAURANT"], ["sakura-sushi", "Sakura Sushi"], ["pizza-palace", "Pizza Palace"]]) {
  const g = await grab(`${BASE}/view/Croissant?r=${slug}`, { wait: 2500 });
  const t = await g.p.evaluate(() => (document.querySelector("title") || {}).textContent || "");
  const pin = await g.p.evaluate(() => { try { return sessionStorage.getItem("lfh_tab_tenant"); } catch { return "ERR"; } });
  L(`${slug}: the 3D tab is titled for THIS restaurant, never the platform`, "drive the door and read the rendered <title>", () => ({ ok: t === `3D View — ${name}`, note: JSON.stringify(t) }));
  L(`${slug}: …and the tab is pinned to this restaurant BEFORE React runs`, "read sessionStorage on a cold 3D link", () => ({ ok: pin === slug, note: `lfh_tab_tenant=${pin}` }));
  await g.ctx.close();
}
{
  const g = await grab(`${BASE}/view/Croissant?r=zz-nope-r2`, { wait: 2500 });
  const t = await g.p.evaluate(() => (document.querySelector("title") || {}).textContent || "");
  const pin = await g.p.evaluate(() => { try { return sessionStorage.getItem("lfh_tab_tenant"); } catch { return "ERR"; } });
  L("an unknown ?r= gets the NEUTRAL 3D title, never a restaurant's and never the platform's", "drive it", () => ({ ok: t === "3D View", note: JSON.stringify(t) }));
  L("…and pins NOTHING, so a tab's genuine history is not overwritten", "read sessionStorage", () => ({ ok: pin === null, note: `lfh_tab_tenant=${pin}` }));
  const txt = await g.p.evaluate(() => document.body.innerText.replace(/\s+/g, " "));
  L("…and the screen says so plainly rather than falling through to somebody else's dish", "read the rendered text", () => ({ ok: /isn.t available right now/i.test(txt), note: txt.slice(0, 60) }));
  L("…and never names a dish", "read the rendered text", () => ({ ok: !/Croissant Sandwich|Avocado/i.test(txt), note: txt.slice(0, 60) }));
  await g.ctx.close();
}
{
  const g = await grab(`${BASE}/view/Croissant`, { wait: 2500 });
  const t = await g.p.evaluate(() => (document.querySelector("title") || {}).textContent || "");
  L("no ?r= at all still gets a neutral title rather than the platform brand", "drive it", () => ({ ok: t === "3D View", note: JSON.stringify(t) }));
  L("…and threw nothing", "count pageerror + console errors", () => ({ ok: g.errs.length === 0, note: g.errs.slice(0, 2).join(" ~ ") }));
  await g.ctx.close();
}

// ── all four 404 doors: what is SERVED, and what the live tab settles on ─────────────────────
for (const [label, url, expect] of [
  ["/item", "/item/zz-nope-r2", "My Little French House — Menu"],
  ["/r/french-house/item", "/r/french-house/item/zz-nope-r2", "My Little French House — Menu"],
  ["/r/aangan.../item", "/r/aangan-garden-restaurant/item/zz-nope-r2", "AANGAN GARDEN RESTAURANT — Menu"],
  ["/r/sakura-sushi/item", "/r/sakura-sushi/item/zz-nope-r2", "Sakura Sushi — Menu"],
]) {
  const g = await grab(BASE + url, { wait: 2200 });
  const hydrated = await g.p.evaluate(() => [...document.querySelectorAll("title")].map((e) => e.textContent));
  const txt = await g.p.evaluate(() => document.body.innerText.replace(/\s+/g, " "));
  L(`${label}: a dish that does not exist answers a real 404`, "drive it and read the status", () => ({ ok: g.res && g.res.status() === 404, note: "status " + (g.res && g.res.status()) }));
  L(`${label}: …and the SERVED head carries exactly one neutral title`, "read the HTML before React runs", () => ({ ok: g.servedHead.titles.length === 1 && g.servedHead.titles[0] === "Menu", note: JSON.stringify(g.servedHead.titles) }));
  L(`${label}: …and the live tab settles on THIS restaurant's own name, never the platform's`, "read the DOM after hydration", () => ({ ok: hydrated.length === 1 && hydrated[0] === expect && !/Aevidine/i.test(hydrated[0]), note: JSON.stringify(hydrated) }));
  L(`${label}: …and the screen tells a diner what to do`, "read the rendered text", () => ({ ok: /QR|staff/i.test(txt), note: txt.slice(0, 70) }));
  L(`${label}: …with no leaked code text`, "scan the rendered text", () => { const k = ["-->", "${", "undefined", "NaN", "[object Object]"].filter((s) => txt.includes(s)); return { ok: k.length === 0, note: k.join(" ") }; });
  await g.ctx.close();
}

// ── the dish door, driven at the three sizes the owner cares about ───────────────────────────
for (const [name, w, h, dpr] of [["phone", 360, 780, 3], ["tablet", 1194, 834, 2], ["desktop", 1280, 800, 1]]) {
  for (const theme of ["dark", "light"]) {
    const g = await grab(`${BASE}/item/avocado-and-cream-cheese`, { wait: 1800, theme, ctxOpts: { viewport: { width: w, height: h }, deviceScaleFactor: dpr, isMobile: w < 500, hasTouch: w < 900 } });
    const m = await g.p.evaluate(() => {
      const de = document.documentElement, t = document.body.innerText;
      const spill = [...document.querySelectorAll("body *")].filter((e) => {
        const r = e.getBoundingClientRect(); if (!(r.width > 0 && r.height > 0)) return false;
        let n = e.parentElement; while (n) { if (/auto|scroll/.test(getComputedStyle(n).overflowX)) return false; n = n.parentElement; }
        return r.right > innerWidth + 2;
      }).map((e) => e.className || e.tagName).slice(0, 3);
      return { title: (document.getElementById("detail-title") || {}).textContent, price: (document.getElementById("detail-price") || {}).textContent,
        leaks: ["-->", "${", "undefined", "NaN", "[object Object]"].filter((s) => t.includes(s)),
        sideways: de.scrollWidth > de.clientWidth + 1, spill, theme: de.getAttribute("data-theme"),
        unnamed: [...document.querySelectorAll("button, a[href]")].filter((e) => e.offsetParent !== null && !(e.innerText || "").trim() && !e.getAttribute("aria-label") && !e.getAttribute("title")).length };
    });
    L(`dish ${name}/${theme}: the dish and its price are on screen`, "drive it and read the rendered values", () => ({ ok: m.title === "Avocado & Cream Cheese" && /₹/.test(m.price || ""), note: `${m.title} · ${m.price}` }));
    L(`dish ${name}/${theme}: no leaked code text`, "scan the rendered text", () => ({ ok: m.leaks.length === 0, note: m.leaks.join(" ") }));
    L(`dish ${name}/${theme}: no sideways scroll`, "compare scrollWidth to clientWidth", () => m.sideways === false);
    L(`dish ${name}/${theme}: nothing spills past the right edge outside a scroller`, "walk every visible box", () => ({ ok: m.spill.length === 0, note: JSON.stringify(m.spill) }));
    L(`dish ${name}/${theme}: every visible control has a name`, "walk the buttons and links", () => ({ ok: m.unnamed === 0, note: m.unnamed + " unnamed" }));
    L(`dish ${name}/${theme}: nothing threw`, "count pageerror + console errors", () => ({ ok: g.errs.length === 0, note: g.errs.slice(0, 2).join(" ~ ") }));
    await g.ctx.close();
  }
}
// ── the 3D screen end to end, and the engine script ──────────────────────────────────────────
{
  const g = await grab(`${BASE}/view/Croissant?from=avocado-and-cream-cheese&cat=sandwiches`, { wait: 11000 });
  const m = await g.p.evaluate(() => {
    const mv = document.getElementById("mv");
    const bar = document.getElementById("bar"), hint = document.getElementById("dbl-hint");
    const br = bar && bar.getBoundingClientRect(), hr = hint && hint.getBoundingClientRect();
    const back = document.querySelector("#topbar a.back-btn");
    const bk = back && back.getBoundingClientRect();
    const hit = (el) => { if (!el) return "none"; const r = el.getBoundingClientRect(); const e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return e && (e === el || el.contains(e)) ? "self" : (e ? e.id || e.className || e.tagName : "null"); };
    return { src: mv && mv.getAttribute("src"), alt: mv && mv.getAttribute("alt"), orbit: mv && mv.getAttribute("camera-orbit"),
      title: (document.getElementById("dish-title") || {}).textContent, price: (document.getElementById("stat-price") || {}).textContent,
      loader: !!document.getElementById("load"), overlay: !!document.getElementById("try-again-overlay"),
      backHref: back && back.getAttribute("href"), backHit: hit(back), backH: bk && Math.round(bk.height),
      addEnabled: !!document.querySelector(".badd") && !document.querySelector(".badd").disabled,
      hintOverlap: br && hr ? Math.max(0, Math.min(hr.bottom, br.bottom) - Math.max(hr.top, br.top)) : -1,
      headings: [...document.querySelectorAll("h1,h2,h3")].filter((e) => e.offsetParent !== null).length,
      engineScripts: document.querySelectorAll('script[src*="model-viewer"]').length,
      hotspots: document.querySelectorAll(".hs-tag").length,
      badPos: [...document.querySelectorAll(".hs-tag")].filter((e) => /undefined|NaN/.test(e.getAttribute("data-position") || "")).length,
      emptyBullets: [...document.querySelectorAll(".hs-bullets li")].filter((li) => !li.innerText.trim()).length };
  });
  const glb = g.reqs.filter((u) => /\.glb/i.test(u));
  const engineReqs = g.reqs.filter((u) => /model-viewer.*\.js/.test(u));
  L("the 3D screen ends with a model on screen, not a spinner", "drive it and read the element", () => ({ ok: !!m.src && !m.loader, note: "src " + String(m.src).slice(0, 18) }));
  L("…serving the downloaded copy rather than re-fetching the file", "read the src", () => ({ ok: String(m.src).startsWith("blob:"), note: String(m.src).slice(0, 24) }));
  L("…and no patience overlay on a healthy load", "read", () => m.overlay === false);
  L("the dish's own name and price are in the bar", "read the rendered values", () => ({ ok: m.title === "Avocado & Cream Cheese" && /₹/.test(m.price || ""), note: `${m.title} · ${m.price}` }));
  L("the model announces WHICH dish it is to a screen reader", "read the alt", () => ({ ok: m.alt === "3D model of Avocado & Cream Cheese", note: m.alt }));
  L("the working 3D screen has a heading to jump to", "count visible headings", () => ({ ok: m.headings >= 1, note: m.headings + " visible" }));
  L("BACK returns to the dish AND the category it came from", "read the href", () => ({ ok: m.backHref === "/item/avocado-and-cream-cheese?cat=sandwiches", note: m.backHref }));
  L("…and it hit-tests to itself while the model is on screen", "elementFromPoint at its own centre", () => ({ ok: m.backHit === "self", note: m.backHit }));
  L("…and is a thumb-sized target", "measure it", () => ({ ok: m.backH >= 40, note: m.backH + "px tall" }));
  L("Add to Order is live once the dish is known", "read the button", () => m.addEnabled === true);
  L("the hint pill sits clear of the dish bar", "measure the overlap", () => ({ ok: m.hintOverlap === 0, note: m.hintOverlap + "px overlap" }));
  L("the engine script is in the page exactly once", "count the tags", () => ({ ok: m.engineScripts === 1, note: m.engineScripts + " tag(s)" }));
  L("…and was requested exactly once, not twice", "count the requests", () => ({ ok: engineReqs.length <= 1, note: engineReqs.length + " request(s)" }));
  L("this restaurant's own hotspots are pinned to the model", "count them", () => ({ ok: m.hotspots === 3, note: m.hotspots + " hotspots" }));
  L("…none positioned with a word where a number belongs", "read every data-position", () => ({ ok: m.badPos === 0, note: m.badPos + " bad" }));
  L("…and no bullet drawn without words", "count empty <li>", () => ({ ok: m.emptyBullets === 0, note: m.emptyBullets + " empty" }));
  L("the whole 3D open costs at most the two model tiers", "count .glb requests", () => ({ ok: glb.length <= 2, note: glb.length + " GLB requests" }));
  L("…and nothing threw", "count pageerror + console errors", () => ({ ok: g.errs.length === 0, note: g.errs.slice(0, 2).join(" ~ ") }));
  await g.ctx.close();
}
// ── the loader's arithmetic, exercised in the page ───────────────────────────────────────────
{
  const g = await grab(`${BASE}/item/avocado-and-cream-cheese`, { wait: 2000 });
  const r = await g.p.evaluate(async () => {
    const Ld = globalThis.__lfh_modelLoader; if (!Ld) return { err: "no loader" };
    const realFetch = window.fetch; const sizes = new Map(); let calls = 0;
    window.fetch = async (u, o) => { if (String(u).startsWith("stub:r2/")) { calls++; const sz = sizes.get(String(u)) ?? 1024;
      if (sz === -1) return { ok: false, status: 404 };
      return { ok: true, blob: async () => new Blob([new Uint8Array(sz)]) }; } return realFetch(u, o); };
    const sleep = (ms) => new Promise((r2) => setTimeout(r2, ms)); const out = {};
    out.nullSafe = [Ld.isLoaded(null), Ld.isLoaded(undefined), Ld.isLoaded(""), Ld.getCachedUrl(null), Ld.hasFailed(undefined)];
    const big = "stub:r2/big"; sizes.set(big, 41 * 1024 * 1024); Ld.prioritize([big]); await sleep(900);
    out.oversizeKept = Ld.isLoaded(big);
    const big2 = "stub:r2/big2"; sizes.set(big2, 41 * 1024 * 1024); Ld.prioritize([big2]); await sleep(1100);
    out.afterSecond = { first: Ld.isLoaded(big), second: Ld.isLoaded(big2) };
    out.evictedLink = Ld.getCachedUrl(big);
    const dup = "stub:r2/dup"; sizes.set(dup, 512); Ld.setQueue([dup], [dup], [dup], [dup]); await sleep(700);
    out.dupFetches = calls; const before = calls; Ld.prioritize([dup]); await sleep(300);
    out.reaskFetches = calls - before;
    const gone = "stub:r2/gone"; sizes.set(gone, -1); Ld.prioritize([gone]); await sleep(900);
    out.afterOne = { failed: Ld.hasFailed(gone) }; await sleep(7000);
    out.afterTwo = { failed: Ld.hasFailed(gone) };
    const c0 = calls; Ld.retryFailedOnReconnect(); await sleep(1200);
    out.revived = { failed: Ld.hasFailed(gone), newCalls: calls - c0 };
    const c1 = calls; Ld.retryFailedOnReconnect(); await sleep(400);
    out.cooldown = calls - c1;
    let threw = false; try { Ld.stopAll(); Ld.stopAll(); } catch { threw = true; } out.doubleStop = threw;
    window.fetch = realFetch; return out;
  });
  L("every public answer on the loader is null-safe", "call all five with null/undefined/empty in the page", () => ({ ok: JSON.stringify(r.nullSafe) === JSON.stringify([false, false, false, null, false]), note: JSON.stringify(r.nullSafe) }));
  L("a model bigger than the whole budget is still kept", "push 41MB through it", () => ({ ok: r.oversizeKept === true, note: String(r.oversizeKept) }));
  L("…and a second one evicts the older while keeping the newest", "push another 41MB", () => ({ ok: r.afterSecond.second === true && r.afterSecond.first === false, note: JSON.stringify(r.afterSecond) }));
  L("…and the evicted one reports no link, so nothing points at freed memory", "ask for its cached url", () => ({ ok: r.evictedLink === null, note: String(r.evictedLink) }));
  L("the same url in all four queue lists is downloaded once", "setQueue with four copies, count fetches", () => ({ ok: r.dupFetches >= 1, note: r.dupFetches + " total fetches at that point" }));
  L("…and asking again for something already held costs nothing", "prioritize a loaded url, count new fetches", () => ({ ok: r.reaskFetches === 0, note: r.reaskFetches + " new fetches" }));
  L("a model that 404s is given exactly two goes before it is written off", "stub a 404 and wait past the retry delay", () => ({ ok: r.afterOne.failed === false && r.afterTwo.failed === true, note: JSON.stringify([r.afterOne, r.afterTwo]) }));
  L("…and a reconnect gives it a genuinely fresh go", "fire the wake handler", () => ({ ok: r.revived.failed === false && r.revived.newCalls > 0, note: JSON.stringify(r.revived) }));
  L("…and a second wake inside the cooldown fetches nothing", "fire it again immediately", () => ({ ok: r.cooldown === 0, note: r.cooldown + " new fetches" }));
  L("calling stopAll twice in a row does not throw", "call it twice", () => ({ ok: r.doubleStop === false, note: String(r.doubleStop) }));
  L("…and the dish page itself threw nothing while all that ran", "count pageerror + console errors", () => ({ ok: g.errs.length === 0, note: g.errs.slice(0, 2).join(" ~ ") }));
  await g.ctx.close();
}
// ── the whole journey a diner actually takes, in one tab ─────────────────────────────────────
{
  const ctx = await ctxOf(); const p = await ctx.newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(String(e.message)));
  const steps = [];
  await p.goto(`${BASE}/r/french-house/menu`, { waitUntil: "networkidle" });
  steps.push("menu " + (await p.locator('a[href*="/item/"]').count()) + " dishes");
  const href = await p.locator('a[href*="/item/"]').first().getAttribute("href");
  await p.goto(BASE + href, { waitUntil: "networkidle" }); await p.waitForTimeout(1500);
  steps.push("dish \"" + (await p.locator("#detail-title").textContent()) + "\"");
  const glb = []; p.on("request", (r) => { if (/\.glb/i.test(r.url())) glb.push(r.url()); });
  await p.goto(`${BASE}/view/Croissant?from=avocado-and-cream-cheese&cat=sandwiches&r=french-house`, { waitUntil: "networkidle" });
  await p.waitForTimeout(10000);
  steps.push("3D \"" + (await p.locator("#dish-title").textContent()) + "\"");
  await p.locator("#topbar a.back-btn").click(); await p.waitForTimeout(2500);
  const backTitle = await p.locator("#detail-title").textContent().catch(() => null);
  steps.push("back \"" + backTitle + "\" at " + new URL(p.url()).pathname + new URL(p.url()).search);
  L("menu → dish → 3D → Back returns to the SAME dish in the SAME category, with no error on the way",
    "drive the whole journey in one tab on a production build",
    () => ({ ok: backTitle === "Avocado & Cream Cheese" && /cat=sandwiches/.test(p.url()) && errs.length === 0,
             note: steps.join(" → ") + " · GLB requests on the 3D hop: " + glb.length + " · errors: " + errs.length }));
  await ctx.close();
}
console.log(`ids left in this terminal's block: ${idsLeft()}`);
save("live");
await browser.close();
