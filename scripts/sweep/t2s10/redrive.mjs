// scripts/sweep/t2s10/redrive.mjs — sweep #10 T2's RE-RUN, driven half: the old ledger rows whose
// code moved since they were last proved (the tags since mig 402, the reveal curtain, AR at 40%,
// "my review" since mig 418, the related-row label, the lightbox) re-proved on a PRODUCTION build.
// Writes nothing to the database.   node scripts/sweep/t2s10/redrive.mjs --base http://localhost:4402
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { BASE, OUT } from "./lib.mjs";
const R = {};
const put = (k, ok, note) => { R[k] = { ok: !!ok, note: String(note).slice(0, 300) }; console.log(`${ok ? "✅" : "❌"} ${k} — ${R[k].note}`); };
const b = await chromium.launch();
const phone = { viewport: { width: 360, height: 780 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true };
async function page(opts = phone) { const ctx = await b.newContext(opts); const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(String(e))); return { ctx, p, errs }; }
const cardsUp = (p) => p.waitForFunction(() => { const c = [...document.querySelectorAll(".hs-card-wrap")]; return c.length > 0 && c.every((x) => x.style.opacity === "1"); }, null, { timeout: 25000 }).then(() => true, () => false);
const cardState = (p) => p.evaluate(() => ({ n: document.querySelectorAll(".hs-card-wrap").length, up: [...document.querySelectorAll(".hs-card-wrap")].filter((x) => x.style.opacity === "1").length, anchors: document.querySelectorAll(".hs-anchor").length, names: [...document.querySelectorAll(".hs-title")].map((t) => t.textContent.trim()) }));

if (!process.argv.includes("--only-fixes")) {
// R1/R2 — the cards, the reveal's landing, on restaurant #1 and on a second restaurant
for (const [label, url, expectFv] of [
  ["fh-croissant", "/view/Croissant?from=avocado-and-cream-cheese", null],
  ["fh-waffle", "/view/Waffle?from=lemon-blueberry-waffles", "519.36deg 71.39deg 1.937m"],
  ["aev-croissant", "/view/Croissant?from=avocado-and-cream-cheese&r=aevidine", null],
  ["aev-waffle", "/view/Waffle?from=lemon-blueberry-waffles&r=aevidine", "519.36deg 71.39deg 1.937m"],
]) {
  const { ctx, p, errs } = await page();
  await p.goto(BASE + url, { waitUntil: "load" });
  const up = await cardsUp(p);
  const s = await cardState(p);
  put(`R1 ${label} cards`, up && s.n === 3 && s.up === 3 && s.anchors === 3, `${s.up}/${s.n} cards visible, ${s.anchors} anchors: ${s.names.join(" · ")}`);
  const m = await p.evaluate(() => { const mv = document.querySelector("#mv"); return { scale: String(mv.scale), orbit: mv.getAttribute("camera-orbit"), co: mv.cameraOrbit ?? null, decay: mv.interpolationDecay, loader: !!document.querySelector("#load"), pre: !!document.querySelector(".pre-reveal") }; });
  put(`R2 ${label} reveal lands`, m.scale === "1 1 1" && !m.loader && !m.pre && (!expectFv || m.co === expectFv || m.orbit === expectFv) && m.decay === 50, JSON.stringify(m));
  const title = await p.evaluate(() => document.querySelector("#dish-title")?.textContent || "");
  put(`R2 ${label} bar names the dish`, /Avocado|Waffle/i.test(title), title);
  put(`R2 ${label} no page error`, errs.length === 0, errs.join(" | ") || "none");
  // R3 — triple-tap replays: cards reset then come back, and the line loop does not multiply
  if (label === "fh-croissant") {
    const count = () => p.evaluate(() => new Promise((res) => { let n = 0; const o = Element.prototype.getBoundingClientRect; Element.prototype.getBoundingClientRect = function () { n++; return o.call(this); }; setTimeout(() => { Element.prototype.getBoundingClientRect = o; res(n); }, 1000); }));
    const before = await count();
    const box = await p.locator("#mv").boundingBox();
    for (let r = 0; r < 3; r++) { for (let i = 0; i < 3; i++) await p.mouse.click(box.x + box.width / 2, box.y + box.height / 3); await p.waitForTimeout(300); }
    const mid = await cardState(p);
    const back = await cardsUp(p);
    const after = await count();
    put("R3 triple-tap replays and the loop does not multiply", mid.up < 3 && back && after < before * 1.6, `cards ${mid.up}/3 mid-replay then ${back ? "all back" : "NOT back"}; layout reads ${before}/s → ${after}/s`);
  }
  await ctx.close();
}

// R4 — menu card → dish page → View in 3D → Back: same dish, same category
{
  const { ctx, p } = await page();
  await p.goto(BASE + "/r/french-house/item/avocado-and-cream-cheese?cat=croissants", { waitUntil: "load" });
  await p.click("#view-3d-btn");
  await p.waitForURL(/\/view\/Croissant/, { timeout: 15000 });
  const u3 = p.url();
  await p.waitForSelector(".back-btn"); await p.click(".back-btn");
  await p.waitForURL(/\/item\//, { timeout: 15000 });
  const t = await p.evaluate(() => document.querySelector("#detail-title")?.textContent || "");
  put("R4 dish → 3D → Back keeps tenant, dish and category", /r=french-house/.test(u3) && /cat=croissants/.test(u3) && /\/r\/french-house\/item\/avocado-and-cream-cheese\?cat=croissants/.test(p.url()) && /Avocado/.test(t), `3D ${u3.replace(BASE, "")} → back ${p.url().replace(BASE, "")} "${t}"`);
  // R13 — the dish page paints with no spinner and the server's copy (item 12)
  const sp = await p.evaluate(() => !!document.querySelector(".infinity-loader, #load, .spinner"));
  put("R13 the dish page shows no spinner", !sp, sp ? "a spinner is on screen" : "none");
  await ctx.close();
}

}
// R5 — the review area follows each restaurant's own switches, and reads only when drawable
for (const [label, slug] of [["french-house", "french-house"], ["aangan", "aangan-garden-restaurant"], ["aevidine", "aevidine"]]) {
  const { ctx, p } = await page();
  const reads = [];
  p.on("request", (r) => { if (/\/rest\/v1\/rpc\/lfh_dish_reviews|\/rest\/v1\/reviews/.test(r.url())) reads.push(r.url()); });
  // A named Aangan dish, not "the first link on its menu": that read raced the menu's own hydration once and came back null.
  const dish = slug === "aangan-garden-restaurant" ? "virgin-mojito" : "avocado-and-cream-cheese";
  let path = `/r/${slug}/item/${dish}`;
  if (!dish) { await p.goto(`${BASE}/r/${slug}/menu`, { waitUntil: "load" }); const a = await p.$("a[href*='/item/']"); path = a ? await a.getAttribute("href") : path; }
  await p.goto(BASE + path, { waitUntil: "load" }); await p.waitForTimeout(2500);
  const tabs = await p.evaluate(() => document.querySelectorAll(".review-tab-btn").length);
  put(`R5 ${label} review area matches its switches (ratings+reviews ON)`, tabs === 2 && reads.length >= 1, `${tabs} tabs, ${reads.length} review read(s) on ${path}`);
  await ctx.close();
}

// R6 — the photo lightbox: opens at 1×, the X is on top at 1× and 2.5×, eight cycles leave nothing
{
  const { ctx, p } = await page();
  await p.goto(BASE + "/r/french-house/item/avocado-and-cream-cheese", { waitUntil: "load" });
  await p.click(".detail-visual");
  await p.waitForSelector(".img-lightbox");
  const t1 = await p.evaluate(() => { const x = document.querySelector(".img-lightbox-close").getBoundingClientRect(); const e = document.elementFromPoint(x.x + x.width / 2, x.y + x.height / 2); return { sc: document.querySelector(".img-lightbox-img").style.transform, top: !!e?.closest(".img-lightbox-close") }; });
  await p.click(".img-lightbox-img");
  const t2 = await p.evaluate(() => { const x = document.querySelector(".img-lightbox-close").getBoundingClientRect(); const e = document.elementFromPoint(x.x + x.width / 2, x.y + x.height / 2); return { sc: document.querySelector(".img-lightbox-img").style.transform, top: !!e?.closest(".img-lightbox-close") }; });
  put("R6 the lightbox opens at 1× and its X is on top at 1× and zoomed", /scale\(1\)/.test(t1.sc) && t1.top && /scale\(2\.5\)/.test(t2.sc) && t2.top, JSON.stringify([t1, t2]));
  await p.click(".img-lightbox-close");
  for (let i = 0; i < 8; i++) { await p.click(".detail-visual"); await p.waitForSelector(".img-lightbox"); await p.click(".img-lightbox-close"); }
  const left = await p.evaluate(() => document.querySelectorAll(".img-lightbox").length);
  put("R6 eight open/close cycles leave no lightbox behind", left === 0, `${left} left`);
  // R7 — related row: lazy, inside the tenant, and its label clears the 3D button
  const rel = await p.evaluate(() => { const imgs = [...document.querySelectorAll(".related-img")]; const links = [...document.querySelectorAll(".related-card-link")].map((a) => a.getAttribute("href")); const lab = [...document.querySelectorAll(".section-label")].find((l) => /might/i.test(l.textContent)); const btn = lab?.previousElementSibling; return { n: imgs.length, lazy: imgs.every((i) => i.loading === "lazy"), inside: links.every((h) => h.startsWith("/r/french-house/item/")), gap: lab && btn ? Math.round(lab.getBoundingClientRect().top - btn.getBoundingClientRect().bottom) : null }; });
  put("R7 the related row is lazy and stays inside the restaurant", rel.n > 0 && rel.lazy && rel.inside, JSON.stringify(rel));
  put("R7 'You might also like' has air above it (owner 2026-09-20)", rel.gap !== null && rel.gap >= 20, `gap ${rel.gap}px`);
  const lm = await p.evaluate(() => ({ main: document.querySelectorAll("main").length, eager: document.querySelector("#detail-img")?.loading, prio: document.querySelector("#detail-img")?.getAttribute("fetchpriority"), chevrons: [...document.querySelectorAll(".dish-nav-strip")].map((s) => s.querySelectorAll("i").length) }));
  put("R13 the dish page is one <main>, its photo eager, one chevron per strip", lm.main === 1 && lm.eager === "eager" && lm.prio === "high" && lm.chevrons.every((n) => n === 1), JSON.stringify(lm));
  await ctx.close();
}

// R9 — the static config answering 404 / 500 / nonsense on restaurant #1
for (const [label, status, body] of [["404", 404, "nope"], ["500", 500, "boom"], ["nonsense", 200, "{not json"]]) {
  // A COLD browser with the service worker kept out: with it in, the offline layer answers from the
  // device and the failure path is never reached at all (sweep #8's P95583 — the layer doing its job).
  const { ctx, p } = await page({ ...phone, serviceWorkers: "block" });
  await p.route("**/content/items/Croissant/config.json", (r) => r.fulfill({ status, body, contentType: "application/json" }));
  await p.goto(BASE + "/view/Croissant?from=avocado-and-cream-cheese", { waitUntil: "load" });
  await p.waitForTimeout(4000);
  const s = await p.evaluate(() => ({ card: document.querySelector(".try-again-title")?.textContent || "", back: !!document.querySelector(".try-again-btn, .back-btn"), mv: !!document.querySelector("#mv") }));
  const ok = status === 404 ? !s.card && s.back : (s.card === "3D view unavailable" && s.back);
  put(`R9 the 3D screen when its static config answers ${label}`, ok, JSON.stringify(s));
  await ctx.close();
}

// R10 — leaving the 3D screen mid-reveal three times leaves nothing animating on the dish page
{
  const { ctx, p } = await page();
  await p.goto(BASE + "/r/french-house/item/avocado-and-cream-cheese", { waitUntil: "load" });
  for (let i = 0; i < 3; i++) { await p.click("#view-3d-btn"); await p.waitForURL(/\/view\//); await p.waitForTimeout(1500 + i * 600); await p.goBack(); await p.waitForURL(/\/item\//); }
  await p.waitForTimeout(5000);
  const n = await p.evaluate(() => new Promise((res) => { let k = 0; const o = window.requestAnimationFrame; window.requestAnimationFrame = (f) => { k++; return o(f); }; setTimeout(() => { window.requestAnimationFrame = o; res(k); }, 1000); }));
  put("R10 leaving mid-reveal three times leaves nothing animating on the dish page", n < 20, `${n} animation frames requested in 1s on the dish page`);
  await ctx.close();
}

// R11 — leaving a slow 3D dish earns a ticket that names it
{
  const { ctx, p } = await page();
  let hold = true;
  await p.route("**/*.glb", async (r) => { if (hold) return; await r.continue(); });
  await p.goto(BASE + "/r/french-house/item/lemon-blueberry-waffles", { waitUntil: "load" });
  await p.click("#view-3d-btn"); await p.waitForURL(/\/view\//); await p.waitForTimeout(1500);
  await p.click(".back-btn"); await p.waitForURL(/\/item\//);
  hold = false;
  await p.unroute("**/*.glb");
  // a fresh queue pass picks the held files up again; the ticket rides on lfh:model-loaded
  await p.evaluate(() => globalThis.__lfh_modelLoader?.retryFailedOnReconnect?.());
  await p.evaluate(() => globalThis.__lfh_modelLoader?.prioritize?.(["/models/waffle_small.glb"]));
  const got = await p.waitForFunction(() => /in 3D/i.test(document.body.innerText) && /ready to view/i.test(document.body.innerText), null, { timeout: 30000 }).then(() => true, () => false);
  const txt = got ? await p.evaluate(() => [...document.querySelectorAll("a,div")].map((e) => e.innerText).find((t) => /ready to view/i.test(t) && t.length < 120) || "") : "";
  put("R11 leaving a slow 3D dish earns a ticket that names it", got && /Lemon Blueberry Waffles|Waffle/i.test(txt), txt.replace(/\s+/g, " ") || "no ticket");
  await ctx.close();
}
await b.close();
writeFileSync(join(OUT, "redrive.json"), JSON.stringify(R, null, 1));
const bad = Object.values(R).filter((x) => !x.ok).length;
console.log(`\n${Object.keys(R).length} re-drives · ${bad} red`);
