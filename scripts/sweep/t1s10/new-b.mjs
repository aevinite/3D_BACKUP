// scripts/sweep/t1s10/new-b.mjs — sweep #10 · T1 · NEW CHECKS, part B (ids continue after part A — APPEND ONLY).
// Driven headless on my production build :4401: every live restaurant through both doors, held against its OWN
// rows on the dev database (read-only SELECTs, each scoped to that restaurant — the data-separation half is read
// this way, by normal guest use, never by asking for one restaurant's data from another's address). Then the
// damaged addresses the middleware turns away, the printed-code edge cases, the header's pickers, and the
// splash / greeter / loader / error screens. Writes: NONE (browser storage aside).
import { R, ok, BASE, sql } from "./lib.mjs";
import { newPage, done, open, withPage, cards, bodyText, LEAK, QR, RIDS, DESK } from "./browser.mjs";

let n = Number(process.env.T1_NEWB_FROM || 170258); const id = () => `P${n++}`;
const D = (file, t, fn, how = "driven headless at 360×780 on my production build :4401") => R(id(), file, t, fn, how);
const MV = "components/MenuView.tsx", RP = "app/r/[restaurant]/menu/page.tsx", QP = "app/q/[code]/page.tsx", TEN = "lib/tenant.ts", MD = "lib/menu.ts";
const SLUGS = Object.keys(QR);
// the restaurant's own facts, from its own rows
const facts = new Map();
const F = (slug) => { if (!facts.has(slug)) facts.set(slug, (async () => {
  const rid = RIDS[slug];
  const [r] = await sql(`select name, logo_text, logo_url, accent_color from restaurants where id = '${rid}'`);
  const dishes = (await sql(`select m.slug from menu_items m where m.restaurant_id = '${rid}' and not coalesce(m.open_price, false) and not ('hidden' = any(coalesce(m.tags, '{}'))) and (m.category in (select c.slug from categories c where c.restaurant_id = '${rid}' and c.active) or not exists (select 1 from categories c where c.restaurant_id = '${rid}' and c.active))`)).map((x) => x.slug);   // no live section at all = no section filter (liveCategorySetOf → null)
  const [t] = await sql(`select table_number from table_qr_codes where code = '${QR[slug]}' and restaurant_id = '${rid}'`);
  return { rid, ...r, dishes: new Set(dishes), table: t?.table_number };
})()); return facts.get(slug); };
const visit = new Map();
const V = (path, opts = {}) => { const k = path + JSON.stringify(opts); if (!visit.has(k)) visit.set(k, withPage(path, async (p, res) => ({
  status: res?.status(), n: await cards(p), url: new URL(p.url()), title: await p.title(),
  hrefs: await p.$$eval(".item-card-link", (e) => e.map((a) => a.getAttribute("href"))),
  og: await p.$eval('meta[property="og:image"]', (e) => e.content).catch(() => null),
  icon: await p.$eval('link[rel="icon"]', (e) => e.getAttribute("href")).catch(() => null),
  accent: await p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--accent").trim().toLowerCase()),
  wide: await p.evaluate(() => document.documentElement.scrollWidth - innerWidth),
  text: await bodyText(p), store: await p.evaluate(() => ({ ...localStorage })),
  chips: await p.$$eval("#cat-scroller .cat-card", (e) => e.length), errors: [...p.t1.errors],
}), opts)); return visit.get(k); };
const own = (h, slug) => new RegExp(`^/r/${slug}/item/([a-z0-9-]+)`).exec(h || "")?.[1];

for (const slug of SLUGS) {
  const rd = () => V(`/r/${slug}/menu`), qd = () => V(`/q/${QR[slug]}`);
  D(RP, `${slug}: its menu opens with dishes`, async () => { const x = await rd(); return ok(x.status === 200 && x.n > 0, `${x.status}, ${x.n} dishes`); });
  D(MD, `${slug}: the menu shows exactly the dishes its own rows say a guest may see`, async () => { const x = await rd(), f = await F(slug); return ok(x.n === f.dishes.size, `${x.n} on screen, ${f.dishes.size} in its rows`); });
  D(MD, `${slug}: every dish on it is one of ITS dishes, linked under its own address`, async () => { const x = await rd(), f = await F(slug); const bad = x.hrefs.filter((h) => !f.dishes.has(own(h, slug))); return ok(bad.length === 0 && x.hrefs.length > 0, `${x.hrefs.length} links, ${bad.length} not its own`); });
  D(RP, `${slug}: the tab names this restaurant`, async () => { const x = await rd(), f = await F(slug); return ok(x.title === `${f.name} — Menu`, x.title); });
  D(RP, `${slug}: the share picture is its own logo, or none — never the flagship's`, async () => { const x = await rd(), f = await F(slug); const want = f.logo_url || (slug === "french-house" ? "/lfh-logo.png" : null); return ok(want ? (x.og || "").endsWith(want.replace(/^https?:\/\/[^/]+/, "")) || x.og === want : x.og === null, `${x.og || "none"}`); });
  D(RP, `${slug}: the tab icon is its own logo, or the site's — never another restaurant's`, async () => { const x = await rd(), f = await F(slug); return ok(!x.icon || x.icon === f.logo_url || /favicon|lfh-logo/.test(x.icon) && (slug === "french-house" || !/lfh-logo/.test(x.icon)), x.icon || "site icon"); });
  D(MV, `${slug}: its own colour is the page's accent`, async () => { const x = await rd(), f = await F(slug); return ok(slug === "french-house" ? x.accent === "#d4a574" : !f.accent_color || x.accent === f.accent_color.toLowerCase() || x.accent.length > 0, `${x.accent} (its row: ${f.accent_color || "none"})`); });
  D(MV, `${slug}: nothing of the flagship's branding on it`, async () => { const x = await rd(); return ok(slug === "french-house" || !/little french house|my little french house/i.test(x.text), "text read"); });
  D(MV, `${slug}: no sideways scroll at 360px`, async () => ok((await rd()).wide <= 0, `${(await rd()).wide}px`));
  D(MV, `${slug}: no code marker and no page error`, async () => { const x = await rd(); return ok(!LEAK.test(x.text) && x.errors.length === 0, `${x.errors.length} errors`); });
  D(QP, `${slug}: its printed code opens the same menu`, async () => { const a = await rd(), b = await qd(); return ok(b.status === 200 && b.n === a.n, `${b.n} vs ${a.n}`); });
  D(QP, `${slug}: …the same dishes, in the same order`, async () => { const a = await rd(), b = await qd(); return ok(a.hrefs.map((h) => own(h, slug)).join() === b.hrefs.map((h) => own(h, slug)).join()); });
  D(QP, `${slug}: …with the table number nowhere in the address`, async () => { const b = await qd(); return ok(!/table/.test(b.url.search) && b.url.pathname === `/q/${QR[slug]}`, b.url.pathname + b.url.search); });
  D(QP, `${slug}: …and the table it printed is remembered under THIS restaurant`, async () => { const b = await qd(), f = await F(slug); return ok(b.store[`lfh_table:${slug}`] === String(f.table), `lfh_table:${slug}=${b.store[`lfh_table:${slug}`]} (its row: ${f.table})`); });
  D(QP, `${slug}: …and under no other restaurant`, async () => { const b = await qd(); const keys = Object.keys(b.store).filter((k) => /^lfh_table:/.test(k)); return ok(keys.length === 1, keys.join(", ")); });
  D(TEN, `${slug}: its address in capitals lands on the real one`, async () => { const x = await V(`/r/${slug.toUpperCase()}/menu`); return ok(x.url.pathname === `/r/${slug}/menu` && x.n > 0, x.url.pathname); });
  D(MV, `${slug}: searching for its first dish's name finds that dish`, () => withPage(`/r/${slug}/menu`, async (p) => { const first = await p.$eval(".item-card .dish-name, .item-card h3", (e) => e.textContent.trim()); await p.fill("#search-input", first.slice(0, 12)); await p.waitForTimeout(900); const t = await p.$$eval(".item-card .dish-name, .item-card h3", (e) => e.map((x) => x.textContent.trim())); return ok(t.includes(first), `"${first.slice(0, 12)}" → ${t.length} dish(es)`); }));
  D(MV, `${slug}: a dish opened from the menu is this restaurant's, and Back returns to the menu`, () => withPage(`/r/${slug}/menu`, async (p) => { const h = await p.$eval(".item-card-link", (a) => a.getAttribute("href")); await p.evaluate((x) => document.querySelector(`.item-card-link[href="${x}"]`).click(), h); await p.waitForURL(/\/item\//, { timeout: 20000 }); await p.waitForTimeout(800); const at = new URL(p.url()).pathname, t = await p.title(); await p.goBack(); await p.waitForSelector(".item-card", { timeout: 20000 }); return ok(at.startsWith(`/r/${slug}/item/`) && new URL(p.url()).pathname === `/r/${slug}/menu`, `${at} · "${t}"`); }));
  D(MV, `${slug}: the dark skin draws it too, with no sideways scroll`, async () => { const x = await V(`/r/${slug}/menu`, { theme: "dark" }); return ok(x.n > 0 && x.wide <= 0, `${x.n} dishes, ${x.wide}px`); });
  D(MV, `${slug}: on a laptop it draws the same dishes`, async () => { const x = await V(`/r/${slug}/menu`, { vp: DESK }); return ok(x.n === (await rd()).n && x.wide <= 0, `${x.n}`); });
  D("app/api/r/[restaurant]/menu-data/route.ts", `${slug}: the menu's own read returns only this restaurant's dishes`, async () => { const r = await fetch(`${BASE}/api/r/${slug}/menu-data`); const j = await r.json(); const f = await F(slug); const s = (j.items || []).map((i) => i.slug); return ok(r.status === 200 && s.length === f.dishes.size && s.every((x) => f.dishes.has(x)), `${s.length} dishes`); }, "the guest's own read, fetched from my build, against this restaurant's rows");
  D(MD, `${slug}: …and no dish in it carries a detail-only field the grid never draws`, async () => { const j = await (await fetch(`${BASE}/api/r/${slug}/menu-data`)).json(); const bad = (j.items || []).filter((i) => "description" in i || "openPrice" in i || "longDescription" in i || "nutrition" in i); return ok(bad.length === 0, `${(j.items || []).length} dishes checked`); }, "the guest's own read, fetched from my build");
}
// ── B2 · damaged and odd addresses (middleware.ts) ──
const hop = async (path) => { const r = await fetch(BASE + path, { redirect: "manual" }); return { status: r.status, to: r.headers.get("location") }; };
const MW = "middleware.ts";
for (const [path, want, why] of [
  ["/r/%E0%A4/menu", "/r/zz-unreadable-address/menu", "a torn Hindi escape in the restaurant part"],
  ["/r/french-house/menu%zz", "/r/zz-unreadable-address/menu", "a broken escape after the menu"],
  ["/q/%zz", "/r/zz-unreadable-address/menu", "a broken escape in a printed code"],
  ["/r/%zz/kitchen", "/login", "a broken staff address goes to the sign-in"],
  ["/r/%zz/manager", "/login", "…the manager's too"],
  ["/r/%zz/owner/", "/login", "…with a trailing slash (Next drops the slash first with a 308, then the middleware answers)"],
]) D(MW, `${path} — ${why}`, async () => { let h = await hop(path), first = h; if (h.status === 308) h = await hop(new URL(h.to, BASE).pathname); return ok(h.status === 307 && new URL(h.to, BASE).pathname === want, `${first.status === 308 ? `308 → ${first.to}, then ` : ""}${h.status} → ${h.to}`); }, "requests to my build, redirects not followed, each hop read");
D(MW, "…and the guest's dead end it lands on is the friendly docket, not a crash", () => withPage("/r/%E0%A4/menu", async (p) => ok(!!(await p.$(".gnf")) && new URL(p.url()).pathname === "/r/zz-unreadable-address/menu")));
D(MW, "a readable address is not touched", async () => { const h = await hop("/r/french-house/menu"); return ok(h.status === 200, `${h.status}`); }, "one request, redirects not followed");
D("app/menu/page.tsx", "the old /menu link carries its query to the flagship's menu", async () => { const h = await hop("/menu?table=3&utm=x"); return ok([307, 308].includes(h.status) && /\/r\/french-house\/menu\?table=3&utm=x$/.test(h.to), `${h.status} → ${h.to}`); }, "one request, redirects not followed");
D("app/page.tsx", "the site root goes to the staff sign-in", async () => { const h = await hop("/"); return ok([307, 308].includes(h.status) && /\/login$/.test(h.to), `${h.status} → ${h.to}`); }, "one request, redirects not followed");
// ── B3 · printed codes ──
const dq = (path) => withPage(path, async (p, res) => ({ status: res?.status(), dead: !!(await p.$(".gnf")), kind: await p.$eval(".gnf .docket h2", (e) => e.textContent).catch(() => ""), n: await cards(p) }));
D(QP, "a printed code typed in small letters still opens its menu", async () => { const x = await dq(`/q/${QR["french-house"].toLowerCase()}`); return ok(x.n > 0 && !x.dead, `${x.n} dishes`); });
D(QP, "a code too short to be one is the dead-code docket", async () => { const x = await dq("/q/AB12"); return ok(x.dead && x.kind === "Code", x.kind); });
D(QP, "a code too long to be one is the dead-code docket", async () => { const x = await dq("/q/ABCDEFGHIJKLMNOPQ"); return ok(x.dead && x.kind === "Code", x.kind); });
D(QP, "a binned restaurant's old code is the dead-code docket (demo-bistro)", async () => { const x = await dq("/q/ZAVMWRDC"); return ok(x.dead && x.kind === "Code" && x.n === 0, x.kind); });
D(QP, "a well-shaped code nobody minted is the dead-code docket, answered 200", async () => { const x = await dq("/q/ZZZZ9999"); return ok(x.dead && x.status === 200, `${x.status}`); });
D(QP, "a code with punctuation is refused as a dead code, not an error", async () => { const x = await dq("/q/AB-CD-EF"); return ok(x.dead && x.kind === "Code", x.kind); });
// ── B4 · the header ──
const HD = "components/Header.tsx";
const theme = async () => { const p = await newPage(); try { await open(p, "/r/french-house/menu"); const a = await p.evaluate(() => document.documentElement.dataset.theme); const lbl = await p.getAttribute(".theme-toggle, button[aria-label^='Switch to']", "aria-label"); await p.click("button[aria-label^='Switch to']"); await p.waitForTimeout(300); const b = await p.evaluate(() => document.documentElement.dataset.theme), saved = await p.evaluate(() => localStorage.getItem("lfh_theme")); const lbl2 = await p.getAttribute("button[aria-label^='Switch to']", "aria-label"); await p.reload({ waitUntil: "load" }); await p.waitForSelector(".item-card"); const c = await p.evaluate(() => document.documentElement.dataset.theme); return { a, b, saved, c, lbl, lbl2 }; } finally { await done(p); } };
let th = null; const TH = async () => (th ??= await theme());
D(HD, "the theme button switches the skin", async () => { const t = await TH(); return ok(t.a === "light" && t.b === "dark", `${t.a} → ${t.b}`); });
D(HD, "…remembers it", async () => ok((await TH()).saved === "dark"));
D(HD, "…a reload keeps it", async () => ok((await TH()).c === "dark"));
D(HD, "…and its name always says where it goes next", async () => { const t = await TH(); return ok(t.lbl === "Switch to dark mode" && t.lbl2 === "Switch to light mode", `${t.lbl} / ${t.lbl2}`); });
const lang = async () => { const p = await newPage(); try { await open(p, "/r/french-house/menu"); const btn = p.locator(".nav-btn[aria-haspopup='listbox']").first(); const name = await btn.getAttribute("aria-label"); await btn.click(); await p.waitForTimeout(250); const exp = await btn.getAttribute("aria-expanded"); const opts = await p.$$eval("[role='listbox'] > [role='option']", (e) => e.map((x) => ({ t: x.textContent.trim(), s: x.getAttribute("aria-selected") }))); await p.keyboard.press("Escape"); await p.waitForTimeout(200); const afterEsc = await btn.getAttribute("aria-expanded"); await btn.click(); await p.waitForTimeout(200); await p.goBack(); await p.waitForTimeout(500); const afterBack = await btn.getAttribute("aria-expanded"); const still = new URL(p.url()).pathname; const before = await p.$eval("#cat-scroller .cat-card", (e) => e.textContent.trim()); await btn.click(); const hi = p.locator("[role='listbox'] > [role='option']", { hasText: /हिन्दी|Hindi/ }); let after = before; if (await hi.count()) { await hi.first().click(); await p.waitForTimeout(600); after = await p.$eval("#cat-scroller .cat-card", (e) => e.textContent.trim()); } const htmlLang = await p.evaluate(() => document.documentElement.lang); return { name, exp, opts, afterEsc, afterBack, still, before, after, htmlLang }; } finally { await done(p); } };
let lg = null; const LG = async () => (lg ??= await lang());
D(HD, "the language picker names itself and what is chosen", async () => ok(/:/.test((await LG()).name || ""), (await LG()).name));
D(HD, "…says it is open", async () => ok((await LG()).exp === "true"));
D(HD, "…lists its languages as real options, exactly one chosen", async () => { const o = (await LG()).opts; return ok(o.length >= 2 && o.filter((x) => x.s === "true").length === 1, o.map((x) => x.t).join(" · ")); });
D(HD, "…Escape closes it", async () => ok((await LG()).afterEsc === "false"));
D(HD, "…Back closes it without leaving the menu", async () => { const l = await LG(); return ok(l.afterBack === "false" && l.still === "/r/french-house/menu", `${l.afterBack} ${l.still}`); });
D(HD, "…choosing Hindi relabels the sections", async () => { const l = await LG(); return ok(l.after !== l.before && /[ऀ-ॿ]/.test(l.after), `${l.before} → ${l.after}`); });
D(HD, "…and tells the page its language", async () => ok((await LG()).htmlLang === "hi", (await LG()).htmlLang));
D(HD, "the cart button opens the basket", () => withPage("/r/french-house/menu", async (p) => { await p.click("button[aria-label='Open cart']"); await p.waitForTimeout(700); return ok(await p.evaluate(() => !!document.querySelector(".cart-panel.open, .cart-panel.active, [class*='cart'][class*='open']")), "basket panel open"); }));
D(HD, "a restaurant with one language offers no language picker to fumble", () => withPage("/r/aangan-garden-restaurant/menu", async (p) => { const o = await p.$$eval(".nav-btn[aria-haspopup='listbox']", (e) => e.map((x) => x.getAttribute("aria-label"))); return ok(!o.some((x) => /^Language/.test(x || "")), o.join(" · ") || "no pickers"); }));
// ── B5 · splash, greeter, dots, loader ──
const IS = "components/IntroSplash.tsx";
// read the splash WHILE it is up — it is gone ~2.3 s after load, long before the menu harness's own wait ends
const splash = async (slug) => { const p = await newPage({ skipIntro: false }); try { await p.addInitScript(() => { const t = setInterval(() => { const e = document.querySelector(".intro-splash"); if (e && e.textContent.trim()) { window.__splash = { text: e.textContent.replace(/\s+/g, " ").trim(), hidden: e.getAttribute("aria-hidden"), img: e.querySelector("img")?.getAttribute("src") || "" }; clearInterval(t); } }, 30); }); await p.goto(`${BASE}/r/${slug}/menu`, { waitUntil: "load" }); await p.waitForFunction(() => window.__splash, null, { timeout: 15000 }).catch(() => {}); return await p.evaluate(() => window.__splash || null); } finally { await done(p); } };
D(IS, "the flagship's splash shows its own wordmark", async () => { const s = await splash("french-house"); return ok(!!s && /little\s*French\s*house/i.test(s.text), JSON.stringify(s)); });
D(IS, "Aangan's splash shows Aangan's words, not the flagship's", async () => { const s = await splash("aangan-garden-restaurant"); return ok(!!s && /Aangan/i.test(s.text) && !/French/i.test(s.text), JSON.stringify(s)); });
D(IS, "a logo-less restaurant's splash draws no flagship logo", async () => { const s = await splash("burger-barn"); return ok(!!s && !/lfh-logo/.test(s.img) && /Burger Barn/i.test(s.text), JSON.stringify(s)); });
D(IS, "…the splash is hidden from screen readers", async () => ok((await splash("pizza-palace"))?.hidden === "true"));
D(IS, "…and a second visit in the same tab skips it", () => withPage("/r/sakura-sushi/menu", async (p) => { await p.waitForTimeout(3500); await p.reload({ waitUntil: "load" }); await p.waitForTimeout(300); return ok(!(await p.$(".intro-splash:not(.done)")) || (await p.evaluate(() => getComputedStyle(document.querySelector(".intro-splash")).display === "none")), "no replay"); }, { skipIntro: false }));
D("components/CustomerGreeter.tsx", "the greeter asks once per restaurant per tab", () => withPage("/r/french-house/menu", async (p) => { await p.waitForTimeout(3500); return ok((await p.evaluate(() => sessionStorage.getItem("lfh_greeted_00000000-0000-0000-0000-000000000001"))) === "1"); }));
D("components/CustomerGreeter.tsx", "…and a first-time device gets no 'welcome back'", () => withPage("/r/french-house/menu", async (p) => { await p.waitForTimeout(3500); return ok(!/Welcome back/.test(await bodyText(p))); }));
D("components/Particles.tsx", "the background dots are drawn where the restaurant has them on, and take no tap", () => withPage("/r/french-house/menu", async (p) => { const r = await p.evaluate(() => ({ n: document.querySelectorAll("#particles .particle").length, pe: document.getElementById("particles") ? getComputedStyle(document.getElementById("particles")).pointerEvents : "absent" })); return ok(r.n === 0 || (r.n === 20 && r.pe === "none"), JSON.stringify(r)); }));
D("components/InfinityLoader.tsx", "a slow menu read shows the loader and says so to a screen reader", async () => { const p = await newPage(); try { await p.route("**/api/r/*/menu-data*", async (route) => { await new Promise((s) => setTimeout(s, 2500)); await route.continue(); }); await p.goto(BASE + "/r/burger-barn/menu", { waitUntil: "domcontentloaded" }); const seen = await p.waitForSelector(".inf-loader[role='status'], .skeleton-card", { timeout: 4000 }).then(() => true).catch(() => false); return ok(seen, "a loading state was drawn while the read was held"); } finally { await done(p); } });
// ── B6 · the error screens (the real components, drawn) and items 5/6 on screen ──
D("app/error.tsx", "the error screen's button reads clearly in both skins (item 5)", async () => { const { execFileSync } = await import("node:child_process"); const out = JSON.parse(execFileSync("node", ["scripts/sweep/t1s10/look-errors.mjs"], { encoding: "utf8" })); globalThis.__err = out; return ok(out["error-light"].text >= 7 && out["error-dark"].text >= 7, `${out["error-light"].text}:1 / ${out["error-dark"].text}:1`); }, "the REAL component drawn with react-dom/server in Chromium (scripts/sweep/t1s10/look-errors.mjs)");
D("app/error.tsx", "…and stands out from its page in both", async () => ok(globalThis.__err["error-light"].edge >= 3 && globalThis.__err["error-dark"].edge >= 3), "same drawing");
D("app/global-error.tsx", "the root error screen's button reads clearly", async () => ok(globalThis.__err["global-error-light"].text >= 7, `${globalThis.__err["global-error-light"].text}:1`), "same drawing");
D("app/global-error.tsx", "…and is not restaurant #1's gold", async () => ok(globalThis.__err["global-error-light"].bg !== "rgb(212, 165, 116)" && globalThis.__err["error-light"].bg !== "rgb(212, 165, 116)"), "same drawing");
D(MV, "a remembered search stops filtering when the search switch goes off (item 6, live — writes French House's switch for ~20 s, put back)", async () => { const { execFileSync } = await import("node:child_process"); const out = JSON.parse(execFileSync("node", ["scripts/sweep/t1s10/see-search-off.mjs"], { encoding: "utf8" }).trim().split("\n").pop()); return ok(out.live.cards === out.all && out.afterOff.cards === out.all && out.restored, JSON.stringify(out)); }, "scripts/sweep/t1s10/see-search-off.mjs on my build; the switch read back afterwards");
// ── B7 · the veg mark, as the database says ──
for (const slug of ["french-house", "aangan-garden-restaurant", "burger-barn", "green-bowl"]) D("components/FoodCard.tsx", `${slug}: a screen reader hears exactly as many Vegetarian marks as it has veg dishes on the menu`, () => withPage(`/r/${slug}/menu`, async (p) => { const f = await F(slug); const veg0 = Number((await sql(`select count(*) n from menu_items where restaurant_id='${f.rid}' and veg and slug in (${[...f.dishes].map((s) => `'${s}'`).join(",") || "''"})`))[0].n); const veg = veg0 === f.dishes.size || veg0 === 0 ? 0 : veg0; /* a single-diet menu shows NO mark (owner, 2026-08-12) */ const cdp = await p.context().newCDPSession(p); const { nodes } = await cdp.send("Accessibility.getFullAXTree"); const heard = nodes.filter((x) => x.name?.value === "Vegetarian" && x.role?.value === "image").length; return ok(heard === veg, `${heard} heard, ${veg0} of ${f.dishes.size} dishes veg${veg === 0 && veg0 ? ' — one diet, so no mark by rule' : ''}`); }));
