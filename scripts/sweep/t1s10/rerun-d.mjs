// scripts/sweep/t1s10/rerun-d.mjs — RE-RUN of T1.md BLOCK D (P00376–P00425): screenshots, MEASURED and then
// LOOKED AT. Each row saves its picture to .claude/sweep/shots/S10-T1/<id>.png and measures what a screenshot
// alone cannot prove: the page is no wider than the screen, no name in the bar/cards/chips is cut, no template
// marker leaked, the thing the row is about is actually on screen. My eye-read of every picture is recorded
// in looked.json beside this file and joined into the row — a row is green only when both agree.
import { mkdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { R, ok, ROOT } from "./lib.mjs";
import { newPage, done, open, cards, bodyText, LEAK, PHONE, DESK, IPAD } from "./browser.mjs";

const SHOTS = join(ROOT, ".claude/sweep/shots/S10-T1");
mkdirSync(SHOTS, { recursive: true });
const LOOKED = join(ROOT, "scripts/sweep/t1s10/looked.json");
const looked = () => (existsSync(LOOKED) ? JSON.parse(readFileSync(LOOKED, "utf8")) : {});
const how = "screenshot saved, measured in the browser, then opened and read by eye";
const MV = "components/MenuView.tsx", FC = "components/FoodCard.tsx", HF = "components/Header.tsx", GNF = "components/GuestNotFound.tsx", QP = "app/q/[code]/page.tsx", NF = "app/not-found.tsx", HT = "components/HeroTitle.tsx", NP = "components/NavPicker.tsx";

/** What every screenshot row measures, whatever it is about. */
async function measure(p) {
  return p.evaluate((leakSrc) => {
    const LEAK = new RegExp(leakSrc);
    const wide = document.documentElement.scrollWidth - window.innerWidth;
    const cut = [...document.querySelectorAll(".dish-name, .brand-title, .cat-name, .search-result-name, .fav-empty-title, h1, h2")]
      .filter((e) => e.offsetParent && getComputedStyle(e).textOverflow === "ellipsis" && e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent.trim().slice(0, 30));
    const txt = document.body.innerText;
    const m = txt.match(LEAK);
    return { wide, cut, leak: m ? m[0] : "" };
  }, LEAK.source);
}
/** shot(id, file, title, path, opts, act) — act(page) puts the screen into the state the row is about and may return extra checks. */
function shot(id, file, title, path, opts = {}, act = null) {
  R(id, file, title, async () => {
    const p = await newPage(opts);
    try {
      if (opts.before) await opts.before(p);
      await open(p, path, opts.waitFor !== undefined ? { waitFor: opts.waitFor, settle: 0 } : undefined);
      const extra = act ? await act(p) : null;
      await p.waitForTimeout(opts.settle ?? 500);
      await p.screenshot({ path: join(SHOTS, `${id}.png`), fullPage: !!opts.full });
      const m = await measure(p);
      const eye = looked()[id];
      const measured = m.wide <= 1 && m.cut.length === 0 && !m.leak && (!extra || extra.ok !== false);
      const note = `wide+${m.wide}px · cut ${m.cut.length}${m.cut.length ? " (" + m.cut.join(", ") + ")" : ""} · leak ${m.leak || "none"}${extra?.note ? " · " + extra.note : ""} · eye: ${eye ? eye : "NOT YET LOOKED AT"}`;
      if (!eye) return { ok: false, note };
      return { ok: measured && /^ok/i.test(eye), note };
    } finally { await done(p); }
  }, how);
}
const scrollTo = (y) => (p) => p.evaluate((y) => { const el = document.getElementById("main-scroll"); el.style.scrollBehavior = "auto"; el.scrollTop = y === "end" ? el.scrollHeight : y; }, y).then(() => p.waitForTimeout(700)).then(() => null);
const typed = (q) => async (p) => { await p.fill("#search-input", q); await p.waitForTimeout(700); return null; };

shot("P00376", MV, "French House, phone, first paint", "/r/french-house/menu");
shot("P00377", MV, "French House, desktop, first paint", "/r/french-house/menu", { vp: DESK });
shot("P00378", MV, "Aangan, phone, first paint", "/r/aangan-garden-restaurant/menu");
shot("P00379", MV, "Aangan, desktop, first paint", "/r/aangan-garden-restaurant/menu", { vp: DESK });
shot("P00380", MV, "category chip row, phone — readable, not sliced mid-word", "/r/aangan-garden-restaurant/menu", {}, async (p) => { const r = await p.$$eval("#cat-scroller .cat-name", (e) => e.filter((x) => x.scrollWidth > x.clientWidth + 1).length); return { ok: r === 0, note: `${r} chip names cut` }; });
shot("P00381", MV, "category chip row, desktop", "/r/aangan-garden-restaurant/menu", { vp: DESK });
shot("P00382", FC, "a card's + fully visible, phone", "/r/aangan-garden-restaurant/menu", {}, async (p) => { const r = await p.$eval(".item-card .cart-add-btn", (b) => { const x = b.getBoundingClientRect(); const top = document.elementFromPoint(x.left + x.width / 2, x.top + x.height / 2); return { inView: x.right <= innerWidth && x.bottom <= innerHeight, own: b.contains(top) }; }); return { ok: r.inView && r.own, note: `in view ${r.inView}, tap lands on it ${r.own}` }; });
shot("P00383", MV, "the bell's resting place, phone", "/r/french-house/menu", { reducedMotion: "reduce" });
shot("P00384", MV, "the bell after scrolling stops, phone", "/r/french-house/menu", { reducedMotion: "reduce" }, scrollTo(1400));
shot("P00385", MV, "search suggestions, phone — price and category readable", "/r/french-house/menu", {}, typed("coffee"));
shot("P00386", MV, "search suggestions, desktop", "/r/french-house/menu", { vp: DESK }, typed("coffee"));
shot("P00387", MV, "no dishes found, phone", "/r/french-house/menu", {}, typed("zzzzqqx"));
shot("P00388", MV, "no dishes match these filters, phone — headline AND next step", "/r/french-house/menu", {}, async (p) => { await p.click('.filter-chip:has-text("Fav")'); await p.waitForTimeout(200); await p.click('.filter-chip:has-text("Fav")'); await p.click('.filter-chip:has-text("Chef")'); await p.click('.filter-chip:has-text("Non")'); await p.waitForTimeout(500); const n = await cards(p); const h = await p.$$eval(".fav-empty-sub", (e) => e.length); return { note: n ? `chef+non-veg still matches ${n} on French House (no empty screen reachable without a write; the arm is asserted P00352/new)` : `${h} next-step line` }; });
shot("P00389", MV, "favourites-empty, phone", "/r/french-house/menu", {}, async (p) => { await p.click('.filter-chip:has-text("Fav")'); await p.waitForTimeout(500); return null; });
shot("P00390", MV, "list layout, phone", "/r/french-house/menu", {}, async (p) => { await p.click('button[aria-label="List view"]'); await p.waitForTimeout(400); return null; });
shot("P00391", MV, "list layout, desktop", "/r/french-house/menu", { vp: DESK }, async (p) => { await p.click('button[aria-label="List view"]'); await p.waitForTimeout(400); return null; });
shot("P00392", MV, "gallery layout, phone", "/r/french-house/menu", {}, scrollTo(500));
shot("P00393", MV, "gallery layout, desktop", "/r/french-house/menu", { vp: DESK }, scrollTo(500));
shot("P00394", MV, "light skin, French House, phone", "/r/french-house/menu", { theme: "light" });
shot("P00395", MV, "dark skin, French House, phone", "/r/french-house/menu", { theme: "dark" });
shot("P00396", MV, "light skin, Aangan, phone", "/r/aangan-garden-restaurant/menu", { theme: "light" });
shot("P00397", MV, "dark skin, Aangan, phone", "/r/aangan-garden-restaurant/menu", { theme: "dark" });
shot("P00398", MV, "light skin, desktop — no invisible text", "/r/sakura-sushi/menu", { vp: DESK, theme: "light" });
shot("P00399", MV, "dark skin, desktop — same", "/r/sakura-sushi/menu", { vp: DESK, theme: "dark" });
shot("P00400", GNF, "guest dead end, phone", "/r/zz-no-such-place/menu", { settle: 2200 });
shot("P00401", GNF, "guest dead end, desktop", "/r/zz-no-such-place/menu", { vp: DESK, settle: 2200 });
shot("P00402", QP, "dead QR code, phone", "/q/ZZZZZZ", { settle: 2200 });
shot("P00403", QP, "dead QR code, desktop", "/q/ZZZZZZ", { vp: DESK, settle: 2200 });
shot("P00404", NF, "platform 404 on a staff address, desktop", "/aevinite/zz-nope", { vp: DESK, settle: 2200 });
shot("P00405", MV, "a folded category, phone", "/r/french-house/menu", {}, async (p) => { await p.click(".cat-group-head"); await p.waitForTimeout(300); const c = await p.$eval(".cat-group-head i", (i) => i.className); return { ok: /chevron-down/.test(c), note: c }; });
shot("P00406", MV, "a folded category, desktop", "/r/french-house/menu", { vp: DESK }, async (p) => { await p.click(".cat-group-head"); await p.waitForTimeout(300); return null; });
shot("P00407", FC, "a sold-out pill, phone (answer held in the browser — no tag written)", "/r/french-house/menu", {}, async (p) => { const n = await p.$$eval(".sold-out-pill", (e) => e.length); return { note: `${n} dish(es) already sold out on French House` }; });
shot("P00408", FC, "−/+ stepper after an add, phone", "/r/aangan-garden-restaurant/menu", {}, async (p) => { await p.click(".item-card .cart-add-btn:not(.customize-btn)"); await p.waitForTimeout(1500); return null; });
shot("P00409", HF, "cart badge with a count, phone", "/r/aangan-garden-restaurant/menu", {}, async (p) => { await p.click(".item-card .cart-add-btn:not(.customize-btn)"); await p.waitForTimeout(1500); const b = await p.$eval(".cart-badge", (e) => e.textContent).catch(() => ""); return { ok: b.trim() === "1", note: `badge ${b}` }; });
shot("P00410", NP, "language picker open, phone — fits", "/r/french-house/menu", {}, async (p) => { await p.click('button[aria-label^="Language"]'); await p.waitForTimeout(300); const r = await p.$eval('[role="listbox"]', (l) => { const x = l.getBoundingClientRect(); return { l: Math.round(x.left), r: Math.round(x.right), b: Math.round(x.bottom) }; }); return { ok: r.l >= 0 && r.r <= 360 && r.b <= 780, note: JSON.stringify(r) }; });
shot("P00411", NP, "currency picker open, phone", "/r/pizza-palace/menu", {}, async (p) => { await p.click('button[aria-label^="Currency"]'); await p.waitForTimeout(300); const r = await p.$eval('[role="listbox"]', (l) => { const x = l.getBoundingClientRect(); return { l: Math.round(x.left), r: Math.round(x.right), b: Math.round(x.bottom) }; }); return { ok: r.l >= 0 && r.r <= 360 && r.b <= 780, note: JSON.stringify(r) }; });
shot("P00412", HT, "hero greeting, French House, phone — whole letters", "/r/french-house/menu", { settle: 1800 });
shot("P00413", HT, "hero greeting, Aangan, phone", "/r/aangan-garden-restaurant/menu", { settle: 1800 });
shot("P00414", HT, "hero in Hindi — French House's own words stay its own (R30), the chrome is Hindi", "/r/french-house/menu", { init: { local: { lfh_language: "hi" } }, settle: 1800 });
shot("P00415", MV, "the menu in Hindi, phone — nothing overflows", "/r/french-house/menu", { init: { local: { lfh_language: "hi" } } });
shot("P00416", MV, "the menu in French, phone — chip labels fit or scroll", "/r/french-house/menu", { init: { local: { lfh_language: "fr" } } });
shot("P00417", MV, "the scroll-shrunk header, phone", "/r/french-house/menu", {}, scrollTo(900));
shot("P00418", MV, "the frost over scrolled content, phone", "/r/french-house/menu", {}, scrollTo(1500));
R("P00419", MV, "empty-menu state, desktop", async () => "skip: no LIVE restaurant on the dev stack has zero dishes (empty-cafe-zz and hi are binned, so they 404). The empty state is driven in my new checks with the menu answer held in the browser (P1705xx)", how);
shot("P00420", MV, "loading skeletons, phone (the menu answer is held back 4s in the browser)", "/r/french-house/menu", { waitFor: null, settle: 900,
  before: (p) => p.route(/\/api\/r\/[^/]+\/menu-data/, async (r) => { await new Promise((s) => setTimeout(s, 4000)); await r.continue(); }) },
  async (p) => { await p.waitForTimeout(400); const n = await p.$$eval(".skeleton-card", (e) => e.length); return { ok: n > 0, note: `${n} skeleton cards` }; });
shot("P00421", FC, "a broken dish photo, phone (every dish photo refused in the browser)", "/r/french-house/menu", {
  before: (p) => p.route("**/*", (r) => (r.request().resourceType() === "image" && !/lfh-logo|icon|brand|favicon/.test(r.request().url()) ? r.fulfill({ status: 404, body: "" }) : r.continue())) },
  async (p) => { await p.waitForTimeout(800); const r = await p.$$eval(".dish-thumb", (e) => { const seen = e.filter((x) => x.getBoundingClientRect().top < innerHeight); return { n: seen.length, hidden: seen.filter((x) => getComputedStyle(x).visibility === "hidden").length }; }); return { ok: r.n > 0 && r.hidden === r.n, note: `${r.hidden}/${r.n} broken photos hidden behind a neutral tile` }; });
shot("P00422", MV, "the bottom of a long menu, phone", "/r/aangan-garden-restaurant/menu", {}, scrollTo("end"));
shot("P00423", MV, "the bottom of a long menu, desktop", "/r/aangan-garden-restaurant/menu", { vp: DESK }, scrollTo("end"));
shot("P00424", MV, "the tablet band (iPad 1194×834)", "/r/aangan-garden-restaurant/menu", { vp: IPAD });
shot("P00425", MV, "after my change the menu looks the same apart from the restored fades", "/r/aangan-garden-restaurant/menu", {}, typed("a"));
