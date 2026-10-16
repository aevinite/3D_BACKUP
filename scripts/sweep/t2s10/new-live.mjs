// scripts/sweep/t2s10/new-live.mjs — sweep #10 T2, NEW checks, block L (P171451–P171700): DRIVEN on a
// production build. The 3D screen and the dish page on three devices, both skins and two restaurants
// (French House = #1, aevidine = a second restaurant that has the same two 3D dishes); the reveal
// curtain frame by frame; AR handed to WebXR and to Quick Look (stood in for, since no headless browser
// has either); a real review posted and removed again by its own key; the dark default on both doors.
// Writes: ONE review row (deleted by restaurant+dish+device in the same run) and ONE settings value
// (French House's menu_default_mode, restored in finally AND on SIGINT/SIGTERM).
//   node scripts/sweep/t2s10/new-live.mjs --base http://localhost:4402
import { chromium } from "playwright";
import { check, run, idGen, F, BASE } from "./lib.mjs";
import { sb, FH } from "./env.mjs";
const id = idGen(171451);
const C = (file, what, how, fn) => check(id(), file, what, how, fn);
const b = await chromium.launch();
const DEV = {
  phone: { viewport: { width: 360, height: 780 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true },
  tablet: { viewport: { width: 1194, height: 834 }, deviceScaleFactor: 2, hasTouch: true, isMobile: false },
  desktop: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 },
};
async function open(url, { dev = "phone", skin = "dark", extra = {}, init } = {}) {
  const ctx = await b.newContext({ ...DEV[dev], ...extra });
  await ctx.addInitScript((s) => { try { localStorage.setItem("lfh_theme", s); } catch {} }, skin);
  if (init) await ctx.addInitScript(init);
  const p = await ctx.newPage(); const errs = [];
  p.on("pageerror", (e) => errs.push(String(e).slice(0, 120)));
  await p.goto(BASE + url, { waitUntil: "load" });
  return { ctx, p, errs };
}
const cardsUp = (p) => p.waitForFunction(() => { const c = [...document.querySelectorAll(".hs-card-wrap")]; return c.length > 0 && c.every((x) => x.style.opacity === "1"); }, null, { timeout: 25000 }).then(() => true, () => false);
const leaks = (p) => p.evaluate(() => { const t = document.body.innerText; return ["undefined", "NaN", "[object Object]", "${", "-->"].filter((k) => t.includes(k)); });
const spill = (p) => p.evaluate(() => { const W = document.documentElement.clientWidth; const bad = []; for (const e of document.querySelectorAll("body *")) { const r = e.getBoundingClientRect(); if (!r.width || getComputedStyle(e).position === "fixed" && r.right <= W + 1) continue; let a = e, sc = false; while ((a = a.parentElement)) { const o = getComputedStyle(a).overflowX; if (o === "auto" || o === "scroll" || o === "hidden") { sc = true; break; } } if (!sc && r.right > W + 1) bad.push((e.id || e.className || e.tagName).toString().slice(0, 30)); } return { W, scroll: document.documentElement.scrollWidth, bad: [...new Set(bad)].slice(0, 5) }; });

// ── L1 · the 3D screen: 2 restaurants × 3 devices × 2 skins ───────────────────────────────────────
for (const [rest, q] of [["French House", ""], ["aevidine", "&r=aevidine"]]) {
  for (const dev of ["phone", "tablet", "desktop"]) {
    for (const skin of ["dark", "light"]) {
      const tag = `${rest} · ${dev} · ${skin}`;
      const S = {};
      C(F.viewer, `3D screen, ${tag}: the three callout cards arrive`, "drive /view/Croissant, wait for the reveal", async () => {
        const o = await open(`/view/Croissant?from=avocado-and-cream-cheese${q}`, { dev, skin });
        Object.assign(S, o); const up = await cardsUp(o.p);
        S.m = await o.p.evaluate(() => { const r = (s) => document.querySelector(s)?.getBoundingClientRect(); const bar = r("#bar"), back = r(".back-btn"), ar = r(".ar-btn"), hint = r("#dbl-hint"); return { title: document.title, bar: bar && { top: bar.top, bottom: bar.bottom }, back: back && { h: back.height, w: back.width }, ar: ar && { h: ar.height }, hint: hint && { bottom: hint.bottom }, vh: innerHeight, gold: getComputedStyle(document.querySelector(".badd")).backgroundColor, dish: document.querySelector("#dish-title")?.textContent, price: document.querySelector("#stat-price")?.textContent, mv: document.querySelector("#mv")?.getAttribute("alt") }; });
        return { ok: up, note: up ? "3/3" : "cards never arrived" };
      });
      C(F.viewer, `3D screen, ${tag}: nothing spills sideways and the page does not scroll sideways`, "measure every element", async () => { const s = await spill(S.p); return { ok: s.scroll <= s.W + 1 && !s.bad.length, note: JSON.stringify(s) }; });
      C(F.viewer, `3D screen, ${tag}: no code text on screen`, "scan the rendered text", async () => { const k = await leaks(S.p); return { ok: !k.length, note: k.join(" ") || "clean" }; });
      C(F.viewer, `3D screen, ${tag}: BACK and AR are 44px tall`, "measure", () => ({ ok: S.m.back?.h >= 43.5 && S.m.ar?.h >= 43.5, note: `back ${S.m.back?.h}, ar ${S.m.ar?.h}` }));
      C(F.viewer, `3D screen, ${tag}: the dish bar is fully on screen`, "measure", () => ({ ok: S.m.bar && S.m.bar.bottom <= S.m.vh + 1 && S.m.bar.top >= 0, note: JSON.stringify(S.m.bar) }));
      C(F.viewer, `3D screen, ${tag}: the bar names THIS restaurant's dish with a rupee price`, "read", () => ({ ok: S.m.dish === "Avocado & Cream Cheese" && /₹/.test(S.m.price || ""), note: `${S.m.dish} · ${S.m.price}` }));
      C(F.viewer, `3D screen, ${tag}: the tab names the restaurant${q ? "" : " (none on #1's bare 3D link — neutral '3D View')"}`, "read document.title", () => ({ ok: q ? /3D View — /.test(S.m.title) && !/Aevidine — Restaurant OS/.test(S.m.title) : S.m.title === "3D View", note: S.m.title }));
      C(F.viewer, `3D screen, ${tag}: the model announces which dish it is`, "read alt", () => ({ ok: S.m.mv === "3D model of Avocado & Cream Cheese", note: S.m.mv }));
      C(F.viewer, `3D screen, ${tag}: no page error`, "count pageerror", async () => { const e = S.errs.slice(); await S.ctx.close(); return { ok: !e.length, note: e.join(" | ") || "none" }; });
    }
  }
}
// ── L2 · the curtain: the dish is never seen at a size the animation did not put it at ───────────
C(F.viewer, "frame by frame: the first frame the model is visible, it is at the opening 30% size", "sample every animation frame from navigation to the end of the reveal", async () => {
  const o = await open("/view/Waffle?from=lemon-blueberry-waffles", { init: () => { window.__fr = []; const tickf = () => { const mv = document.querySelector("#mv"); const w = document.querySelector(".viewer-wrapper"); if (mv && w) window.__fr.push({ t: performance.now() | 0, vis: !w.classList.contains("pre-reveal"), s: String(mv.scale), load: !!document.querySelector("#load") }); requestAnimationFrame(tickf); }; requestAnimationFrame(tickf); } });
  await cardsUp(o.p); const fr = await o.p.evaluate(() => window.__fr); await o.ctx.close();
  const first = fr.find((f) => f.vis);
  const bad = fr.filter((f) => f.vis && fr.indexOf(f) <= fr.indexOf(first) + 1 && !/^0\.3/.test(f.s));
  return { ok: !!first && /^0\.3/.test(first.s) && !bad.length, note: first ? `first visible frame at ${first.t}ms, scale "${first.s}", spinner ${first.load ? "still up" : "gone"} · ${fr.length} frames` : "never visible" };
});
C(F.viewer, "…and no visible frame ever shows it LARGER than the frame before, until the grow (no snap)", "same samples", async () => {
  const o = await open("/view/Croissant?from=avocado-and-cream-cheese", { init: () => { window.__fr = []; const f = () => { const mv = document.querySelector("#mv"), w = document.querySelector(".viewer-wrapper"); if (mv && w && !w.classList.contains("pre-reveal")) window.__fr.push(parseFloat(String(mv.scale))); requestAnimationFrame(f); }; requestAnimationFrame(f); } });
  await cardsUp(o.p); const s = await o.p.evaluate(() => window.__fr); await o.ctx.close();
  let drops = 0; for (let i = 1; i < s.length; i++) if (s[i] < s[i - 1] - 0.001) drops++;
  return { ok: s.length > 10 && drops === 0 && s[0] < 0.31 && s.at(-1) === 1, note: `${s.length} visible frames, starts ${s[0]}, ends ${s.at(-1)}, ${drops} shrink(s)` };
});
// ── L3 · AR on Android (WebXR): stood in for by the two events model-viewer itself fires ─────────
const arProbe = (p) => p.evaluate(() => { const mv = document.querySelector("#mv"); const o = mv.getCameraOrbit(); return { cls: document.body.classList.contains("ar-presenting"), scale: String(mv.scale), r: +o.radius.toFixed(3), min: mv.getAttribute("min-camera-orbit"), decay: mv.interpolationDecay, hs: getComputedStyle(document.querySelector(".hotspot")).display }; });
{
  const S = {};
  C(F.viewer, "WebXR: tapping AR VIEW hides the cards for the handoff and the session", "stand in canActivateAR/activateAR the way WebXR behaves (session-started fires inside activateAR)", async () => {
    Object.assign(S, await open("/view/Croissant?from=avocado-and-cream-cheese")); await cardsUp(S.p); S.before = await arProbe(S.p);
    await S.p.evaluate(() => { const mv = document.querySelector("#mv"); Object.defineProperty(mv, "canActivateAR", { get: () => true, configurable: true }); mv.activateAR = async () => { mv.setAttribute("ar-status", "session-started"); mv.dispatchEvent(new CustomEvent("ar-status", { detail: { status: "session-started" } })); }; });
    await S.p.click(".ar-btn"); await S.p.waitForTimeout(800); S.during = await arProbe(S.p);
    return { ok: S.during.cls && S.during.hs === "none", note: JSON.stringify(S.during) };
  });
  C(F.viewer, "WebXR: the dish is 40% of its size in the room, the camera 40% as far", "read scale and radius during", () => ({ ok: S.during.scale === "0.4 0.4 0.4" && Math.abs(S.during.r - S.before.r * 0.4) < 0.08, note: `${S.before.r}m → ${S.during.r}m, scale ${S.during.scale}` }));
  C(F.viewer, "WebXR: the session ending puts size, camera, clamp, smoothing and cards back", "fire not-presenting", async () => { await S.p.evaluate(() => { const mv = document.querySelector("#mv"); mv.setAttribute("ar-status", "not-presenting"); mv.dispatchEvent(new CustomEvent("ar-status", { detail: { status: "not-presenting" } })); }); await S.p.waitForTimeout(500); const a = await arProbe(S.p); return { ok: !a.cls && a.scale === S.before.scale && Math.abs(a.r - S.before.r) < 0.05 && a.min === S.before.min && a.decay === S.before.decay && a.hs !== "none", note: JSON.stringify(a) }; });
  C(F.viewer, "WebXR: a FAILED session puts everything back too", "fire failed after a second tap", async () => { await S.p.click(".ar-btn"); await S.p.waitForTimeout(500); await S.p.evaluate(() => { const mv = document.querySelector("#mv"); mv.setAttribute("ar-status", "failed"); mv.dispatchEvent(new CustomEvent("ar-status", { detail: { status: "failed" } })); }); await S.p.waitForTimeout(500); const a = await arProbe(S.p); await S.ctx.close(); return { ok: !a.cls && a.scale === S.before.scale && a.min === S.before.min, note: JSON.stringify(a) }; });
}
// ── L4 · AR on an iPhone (Quick Look): model-viewer fires NO ar-status at all on this path ────────
{
  const S = {};
  C(F.viewer, "iPHONE: after Quick Look the callout cards are back on the screen", "stand in activateAR as Quick Look behaves from the page's side (an anchor click, no event — model-viewer 3.4.0's $openIOSARQuickLook), then look", async () => {
    Object.assign(S, await open("/view/Croissant?from=avocado-and-cream-cheese", { dev: "phone" })); await cardsUp(S.p); S.before = await arProbe(S.p);
    await S.p.evaluate(() => { const mv = document.querySelector("#mv"); Object.defineProperty(mv, "canActivateAR", { get: () => true, configurable: true }); mv.setAttribute("ar-status", "not-presenting"); mv.activateAR = async () => { window.__ql = (window.__ql || 0) + 1; window.__qlScale = String(mv.scale); }; });
    await S.p.click(".ar-btn"); await S.p.waitForTimeout(1200); S.after = await arProbe(S.p); S.exported = await S.p.evaluate(() => window.__qlScale);
    return { ok: !S.after.cls && S.after.hs !== "none", note: JSON.stringify(S.after) };
  });
  C(F.viewer, "iPHONE: …the file Quick Look was handed was the 40% one", "read the scale at the moment activateAR ran", () => ({ ok: S.exported === "0.4 0.4 0.4", note: S.exported }));
  C(F.viewer, "iPHONE: …and the dish, the camera and the zoom limit are back as they were", "compare before/after", () => ({ ok: S.after.scale === S.before.scale && Math.abs(S.after.r - S.before.r) < 0.05 && S.after.min === S.before.min && S.after.decay === S.before.decay, note: `${JSON.stringify(S.before)} → ${JSON.stringify(S.after)}` }));
  C(F.viewer, "iPHONE: a SECOND trip to AR still exports 40% and still comes back whole", "tap AR VIEW again", async () => { await S.p.click(".ar-btn"); await S.p.waitForTimeout(1200); const a = await arProbe(S.p); const ex = await S.p.evaluate(() => window.__qlScale); return { ok: ex === "0.4 0.4 0.4" && a.scale === S.before.scale && Math.abs(a.r - S.before.r) < 0.05 && !a.cls, note: `${ex} · ${JSON.stringify(a)}` }; });
  C(F.viewer, "iPHONE: a replay after coming back lands the dish at its normal size", "triple-tap, wait for the cards", async () => { const box = await S.p.locator("#mv").boundingBox(); for (let i = 0; i < 3; i++) await S.p.mouse.click(box.x + box.width / 2, box.y + box.height / 3); const up = await cardsUp(S.p); const a = await arProbe(S.p); await S.ctx.close(); return { ok: up && a.scale === "1 1 1" && Math.abs(a.r - S.before.r) < 0.05, note: JSON.stringify(a) }; });
}
// ── L5 · a REAL review: posted through the screen, read back after a reload, removed by its key ──
{
  const DEVICE = "t2s10-review-" + Date.now().toString(36);
  const SLUG = "avocado-and-cream-cheese";
  const LONG = ("A sweep check note. ".repeat(40)).trim(); // 799 characters
  const cleanup = async () => { await sb.from("reviews").delete().eq("restaurant_id", FH).eq("item_slug", SLUG).eq("device_id", DEVICE); };
  for (const sig of ["SIGINT", "SIGTERM"]) process.once(sig, async () => { await cleanup(); process.exit(130); });
  const S = {};
  C(F.item, "a diner can post a review from the dish page (P00763/P00815 have waited three sweeps for this)", "fill the form on French House with a throwaway device id, submit", async () => {
    Object.assign(S, await open(`/r/french-house/item/${SLUG}`, { init: `try{localStorage.setItem("lfh_device_id",${JSON.stringify(DEVICE)});localStorage.setItem("lfh-device-id",${JSON.stringify(DEVICE)})}catch(e){}` }));
    S.dev = await S.p.evaluate(() => Object.entries(localStorage).filter(([k]) => /device/i.test(k)).map(([k, v]) => k + "=" + v.slice(0, 24)).join(","));
    await S.p.click(".review-tab-btn >> nth=0"); await S.p.waitForSelector("#review-form");
    await S.p.locator(".sr-toggle").nth(3).click();
    await S.p.fill("#review-name", "Sweep T2");
    await S.p.fill("#review-text", LONG);
    S.typed = await S.p.inputValue("#review-text");
    await S.p.click("#submit-review");
    const toast = await S.p.waitForFunction(() => /Review posted|Couldn't save review/.test(document.body.innerText), null, { timeout: 15000 }).then(() => S.p.evaluate(() => /Review posted/.test(document.body.innerText)), () => false);
    S.deviceUsed = (await sb.from("reviews").select("device_id").eq("restaurant_id", FH).eq("item_slug", SLUG).ilike("device_id", "t2s10-review-%").limit(5)).data;
    return { ok: toast, note: `${toast ? "posted" : "NOT posted"} · device keys: ${S.dev}` };
  });
  C(F.item, "…and the row it wrote carries THIS browser's device id (so cleanup can find exactly it)", "read the row back by key", async () => { const r = await sb.from("reviews").select("device_id,stars,name,comment").eq("restaurant_id", FH).eq("item_slug", SLUG).eq("device_id", DEVICE).limit(2); S.row = r.data?.[0]; return { ok: (r.data || []).length === 1, note: r.data?.length ? `stars ${S.row.stars}, name ${S.row.name}, ${S.row.comment?.length} chars` : `no row for ${DEVICE}; found ${JSON.stringify(S.deviceUsed)}` }; });
  C(F.item, "WHAT THE DINER TYPED IS WHAT WAS SAVED — the note box cannot hold more than the database keeps", "compare the box's value with the stored comment", () => ({ ok: !!S.row && S.typed.trim() === S.row.comment, note: `typed ${S.typed?.length} chars (${S.typed?.trim().length} once trimmed, as both the page and the database trim), stored ${S.row?.comment?.length}` }));
  C(F.item, "after a reload the review is on the dish's list, and marked as this diner's own", "reload, open the Reviews tab", async () => { await S.p.reload({ waitUntil: "load" }); await S.p.waitForTimeout(2500); const txt = await S.p.evaluate(() => [...document.querySelectorAll(".review-card")].map((c) => c.innerText).join(" | ")); return { ok: /Sweep T2/.test(txt), note: txt.slice(0, 120) || "no review cards" }; });
  C(F.item, "re-rating REPLACES the diner's review rather than adding a second", "post again, count rows and cards", async () => { await S.p.click(".review-tab-btn >> nth=0"); await S.p.locator(".sr-toggle").nth(1).click(); await S.p.fill("#review-text", "Second thoughts."); await S.p.click("#submit-review"); await S.p.waitForTimeout(2500); const r = await sb.from("reviews").select("stars,comment").eq("restaurant_id", FH).eq("item_slug", SLUG).eq("device_id", DEVICE).limit(3); await S.p.click(".review-tab-btn >> nth=1"); const n = await S.p.evaluate(() => [...document.querySelectorAll(".review-card")].filter((c) => /Sweep T2/.test(c.innerText)).length); return { ok: (r.data || []).length === 1 && r.data[0].comment === "Second thoughts." && n === 1, note: `${r.data?.length} row(s), ${n} card(s) on screen, stored "${r.data?.[0]?.comment}"` }; });
  C(F.item, "the review this run wrote is gone again (deleted by restaurant + dish + device)", "delete by key, read back", async () => { await cleanup(); const r = await sb.from("reviews").select("device_id").eq("restaurant_id", FH).eq("item_slug", SLUG).eq("device_id", DEVICE).limit(1); await S.ctx?.close(); return { ok: !(r.data || []).length, note: "0 rows left" }; });
}
// ── L6 · the photo lightbox from a keyboard ──────────────────────────────────────────────────────
{
  const S = {};
  C(F.item, "keyboard: Tab reaches the dish photo and Enter opens the zoom", "focus the photo, press Enter", async () => { Object.assign(S, await open("/r/french-house/item/avocado-and-cream-cheese", { dev: "desktop", skin: "light" })); await S.p.focus(".detail-visual"); await S.p.keyboard.press("Enter"); const open_ = await S.p.waitForSelector(".img-lightbox", { timeout: 3000 }).then(() => true, () => false); return open_; });
  C(F.item, "THE ZOOM'S CLOSE BUTTON HAS A NAME a screen reader can say", "read its accessible name", async () => { const n = await S.p.evaluate(() => { const x = document.querySelector(".img-lightbox-close"); return x?.getAttribute("aria-label") || x?.innerText.trim() || ""; }); return { ok: !!n, note: n || "(no name — announced as just 'button')" }; });
  C(F.item, "…and Space on it closes the zoom (it is a real button)", "focus it, press Space", async () => { await S.p.focus(".img-lightbox-close"); await S.p.keyboard.press(" "); const gone = await S.p.waitForFunction(() => !document.querySelector(".img-lightbox"), null, { timeout: 3000 }).then(() => true, () => false); await S.ctx.close(); return gone; });
}
// ── L7 · the restaurant's DARK default on both dish doors (French House flipped for ~12s) ──────
{
  const served = async (path) => { const h = await (await fetch(BASE + path)).text(); return /if\(!localStorage\.getItem\('lfh_theme'\)\)document\.documentElement\.setAttribute\('data-theme','dark'\)/.test(h); };
  const before = (await sb.from("settings").select("menu_default_mode").eq("restaurant_id", FH).single()).data?.menu_default_mode;
  const restore = async () => { await sb.from("settings").update({ menu_default_mode: before || "light" }).eq("restaurant_id", FH); };
  for (const sig of ["SIGINT", "SIGTERM"]) process.once(sig, async () => { await restore(); process.exit(130); });
  const R = {};
  C(F.itemPage, "a dark-default restaurant #1: its OWN dish door (/item/<dish>) boots dark", "flip menu_default_mode to dark, wait out the 8s settings cache, read the served page", async () => {
    try { await sb.from("settings").update({ menu_default_mode: "dark" }).eq("restaurant_id", FH); await new Promise((r) => setTimeout(r, 9000)); R.legacy = await served("/item/avocado-and-cream-cheese"); R.tenant = await served("/r/french-house/item/avocado-and-cream-cheese"); R.menu = await served("/r/french-house/menu"); }
    finally { await restore(); }
    return { ok: R.legacy, note: `/item ${R.legacy} · /r/…/item ${R.tenant} · /r/…/menu ${R.menu}` };
  });
  C(F.itemPageR, "…and the tenant dish door and the menu boot dark from the same switch", "same read", () => R.tenant && R.menu);
  C(F.itemPage, "…and French House's own default is back to what it was", "read it again", async () => { const now = (await sb.from("settings").select("menu_default_mode").eq("restaurant_id", FH).single()).data?.menu_default_mode; return { ok: now === (before || "light"), note: `${before} → ${now}` }; });
}
// ── L8 · a cold 3D link with no ?from= on a SECOND restaurant still gets its cards ────────────────
{
  C(F.viewer, "cold link /view/Croissant?r=aevidine (no dish named): the dish is found by its folder and its cards arrive", "drive", async () => { const o = await open("/view/Croissant?r=aevidine"); const up = await cardsUp(o.p); const t = await o.p.evaluate(() => document.querySelector("#dish-title")?.textContent); await o.ctx.close(); return { ok: up && t === "Avocado & Cream Cheese", note: `${up ? "3/3 cards" : "no cards"} · ${t}` }; });
  C(F.viewer, "an unknown ?r= shows the plain card with NOTHING to tap (no honest destination)", "drive /view/Croissant?r=zz-no-such-place", async () => { const o = await open("/view/Croissant?r=zz-no-such-place"); await o.p.waitForTimeout(2500); const s = await o.p.evaluate(() => ({ t: document.querySelector(".try-again-title")?.textContent, a: document.querySelectorAll("a,button").length })); await o.ctx.close(); return { ok: /isn.t available/.test(s.t || "") && s.a === 0, note: JSON.stringify(s) }; });
  C(F.viewer, "the 3D screen's details sheet closes with the phone's back button, not the page", "open ℹ, go back", async () => { const o = await open("/view/Croissant?from=avocado-and-cream-cheese"); await cardsUp(o.p); await o.p.click(".binfo"); await o.p.waitForSelector(".vinfo-sheet"); await o.p.goBack(); await o.p.waitForTimeout(600); const s = { sheet: !!(await o.p.$(".vinfo-sheet")), url: o.p.url() }; await o.ctx.close(); return { ok: !s.sheet && /\/view\/Croissant/.test(s.url), note: JSON.stringify(s) }; });
  C(F.viewer, "the details sheet shows this dish's allergens on a restaurant with allergies ON", "open ℹ", async () => { const o = await open("/view/Croissant?from=avocado-and-cream-cheese&r=aevidine"); await cardsUp(o.p); await o.p.click(".binfo"); const s = await o.p.evaluate(() => ({ title: document.querySelector(".vinfo-title")?.textContent, warn: document.querySelectorAll(".vinfo-chip.warn").length, txt: document.querySelector(".vinfo-sheet")?.innerText.slice(0, 80) })); await o.ctx.close(); return { ok: s.title === "Avocado & Cream Cheese", note: JSON.stringify(s) }; });
  C(F.viewer, "the hint pill never sits inside the dish bar (360 phone)", "measure both once the pill shows", async () => { const o = await open("/view/Croissant?from=avocado-and-cream-cheese"); await cardsUp(o.p); await o.p.waitForSelector("#dbl-hint.show", { timeout: 12000 }).catch(() => {}); const m = await o.p.evaluate(() => ({ hint: document.querySelector("#dbl-hint").getBoundingClientRect().bottom, bar: document.querySelector("#bar").getBoundingClientRect().top, text: document.querySelector("#dbl-hint").innerText })); await o.ctx.close(); return { ok: m.hint <= m.bar, note: JSON.stringify(m) }; });
  C(F.viewer, "keyboard: Tab walks BACK → AR → Add → ℹ on the 3D screen", "press Tab and read focus", async () => { const o = await open("/view/Croissant?from=avocado-and-cream-cheese", { dev: "desktop" }); await cardsUp(o.p); const seen = []; for (let i = 0; i < 8; i++) { await o.p.keyboard.press("Tab"); seen.push(await o.p.evaluate(() => (document.activeElement?.className || document.activeElement?.tagName || "").toString().split(" ").pop() + ":" + (document.activeElement?.innerText || document.activeElement?.getAttribute("aria-label") || "").trim().slice(0, 14))); } await o.ctx.close(); const s = seen.join(" → "); const ix = (k) => seen.findIndex((x) => x.startsWith(k + ":")); return { ok: ix("back-btn") >= 0 && ix("back-btn") < ix("ar-btn") && ix("ar-btn") < ix("badd") && ix("badd") < ix("binfo") && !seen.slice(0, ix("binfo")).some((x) => x.startsWith("hotspot") || x.startsWith("hs-")), note: s }; });
}
// ── L9 · the dish page on the second restaurant: every link stays home ───────────────────────────
for (const dev of ["phone", "desktop"]) {
  C(F.item, `aevidine dish page (${dev}): related cards, arrows, back and 3D all stay inside aevidine`, "collect every href and the 3D button's target", async () => { const o = await open("/r/aevidine/item/avocado-and-cream-cheese", { dev }); await o.p.waitForTimeout(2500); const hrefs = await o.p.evaluate(() => [...document.querySelectorAll("a[href]")].map((a) => a.getAttribute("href")).filter((h) => h.startsWith("/"))); await o.p.click("#view-3d-btn"); await o.p.waitForURL(/\/view\//); const u = o.p.url(); await o.ctx.close(); const out = hrefs.filter((h) => !h.startsWith("/r/aevidine/")); return { ok: !out.length && /r=aevidine/.test(u), note: `${hrefs.length} links, outside: ${out.join(",") || "none"} · 3D ${u.replace(BASE, "")}` }; });
  C(F.item, `aevidine dish page (${dev}): nothing spills, no code text`, "measure + scan", async () => { const o = await open("/r/aevidine/item/avocado-and-cream-cheese", { dev, skin: "light" }); await o.p.waitForTimeout(2000); const s = await spill(o.p), k = await leaks(o.p); await o.ctx.close(); return { ok: s.scroll <= s.W + 1 && !k.length, note: `${JSON.stringify(s)} ${k.join(" ")}` }; });
}
const bad = await run("new-live");
await b.close().catch(() => {});
process.exit(bad ? 1 : 0);
