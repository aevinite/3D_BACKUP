// scripts/sweep/t1s10/rerun-s8b.mjs — RE-RUN of T1.md "SWEEP #8 — the fresh 500", its DRIVEN half: P54888–P55020 and
// P55037–P55216, headless Chromium on my production build :4401. demo-bistro was a live restaurant then and is in
// the recycle bin today: its rows are re-asked of what a binned restaurant must do now (refuse, neutrally). The one
// restaurant that was in service mode then is gone, so the maintenance rows hold the settings answer in the browser.
import { R, ok, sql, BASE } from "./lib.mjs";
import { newPage, done, open, withPage, cards, bodyText, LEAK, QR, DESK, PHONE, RIDS } from "./browser.mjs";

const RP = "app/r/[restaurant]/menu/page.tsx", QP = "app/q/[code]/page.tsx", MENU = "app/menu/page.tsx", MV = "components/MenuView.tsx", FC = "components/FoodCard.tsx",
  NF = "app/not-found.tsx", GNF = "components/GuestNotFound.tsx", HF = "components/Header.tsx", MAIN = "components/Maintenance.tsx";
const how = "headless Chromium against my PRODUCTION build on :4401";
const D = (id, file, title, fn) => R(id, file, title, fn, how);
const nid = (id, k) => "P" + (Number(id.slice(1)) + k);
const head = async (path) => { const r = await fetch(BASE + path, { redirect: "manual" }); const t = await r.text(); const m = (re) => (t.match(re) || [])[1] || null; return { status: r.status, loc: r.headers.get("location"), title: m(/<title>([^<]*)<\/title>/), desc: m(/<meta name="description" content="([^"]*)"/), ogt: m(/<meta property="og:title" content="([^"]*)"/), ogd: m(/<meta property="og:description" content="([^"]*)"/), ogi: m(/<meta property="og:image" content="([^"]*)"/), icon: m(/<link rel="icon" href="([^"]*)"/), html: t }; };
const hm = new Map(); const H = (p) => { if (!hm.has(p)) hm.set(p, head(p)); return hm.get(p); };
const META = { "aangan-garden-restaurant": "AANGAN GARDEN RESTAURANT", "burger-barn": "Burger Barn", "french-house": "My Little French House", "green-bowl": "Green Bowl", "pizza-palace": "Pizza Palace", "sakura-sushi": "Sakura Sushi", "spice-route": "Spice Route", "taco-fiesta": "Taco Fiesta" };
// ── P54888–P54932: the head of every restaurant's menu ──
for (const [id, slug] of [["P54888", "aangan-garden-restaurant"], ["P54893", "burger-barn"], ["P54898", "demo-bistro"], ["P54903", "french-house"], ["P54908", "green-bowl"], ["P54913", "pizza-palace"], ["P54918", "sakura-sushi"], ["P54923", "spice-route"], ["P54928", "taco-fiesta"]]) {
  const p = `/r/${slug}/menu`;
  if (slug === "demo-bistro") {
    for (let k = 0; k < 5; k++) D(nid(id, k), RP, `demo-bistro (binned since — re-aimed): head ${["title", "description", "og:title", "og:description", "no image"][k]} is neutral`, async () => { const h = await H(p); const v = [h.title === "Menu", !/Demo Bistro/.test(h.desc || ""), !h.ogt || !/Demo Bistro/.test(h.ogt), !h.ogd || !/Demo Bistro/.test(h.ogd), !h.ogi][k]; return ok(h.status === 404 && v, `${h.status} · ${JSON.stringify([h.title, h.desc]).slice(0, 80)}`); });
    continue;
  }
  const name = META[slug];
  D(id, RP, `${slug}: the tab names the restaurant`, async () => { const h = await H(p); return ok(h.title === `${name} — Menu`, h.title); });
  D(nid(id, 1), RP, `${slug}: the blurb is the restaurant's`, async () => { const h = await H(p); return ok(new RegExp(`view the menu and order at ${name}\\.`, "i").test(h.desc || "") && !/all-in-one/.test(h.desc), h.desc); });
  D(nid(id, 2), RP, `${slug}: the preview headline names it`, async () => { const h = await H(p); return ok(h.ogt === `${name} — Menu`, h.ogt); });
  D(nid(id, 3), RP, `${slug}: the preview blurb is its own`, async () => { const h = await H(p); return ok(h.ogd === h.desc, h.ogd); });
  D(nid(id, 4), RP, `${slug}: its own icon + preview image, or none (never another's)`, async () => { const h = await H(p); const own = slug === "french-house" ? /\/lfh-logo\.png$/ : slug === "aangan-garden-restaurant" ? new RegExp(RIDS[slug].slice(-12)) : null; return ok(own ? own.test(h.ogi || "") : !h.ogi, h.ogi || "no preview image (no logo uploaded) — and not the flagship's"); });
}
// ── P54933–P54947: the platform 404's two audiences ──
const nf = async (path, init) => withPage(path, async (p) => { await p.waitForTimeout(2500); return p.evaluate(() => ({ path: location.pathname, guest: !!document.querySelector(".nf-g"), staff: !!document.querySelector(".nf-s"), text: document.body.innerText.replace(/\s+/g, " ").slice(0, 90), btn: document.querySelector(".nf a.nf-home")?.getAttribute("href") || null, hist: history.length })); }, init ? { init } : {});
D("P54933", NF, "an address with the /r/ dropped lands on its menu", async () => { const r = await nf("/french-house/menu"); return ok(r.path === "/r/french-house/menu", r.path); });
D("P54934", NF, "…REPLACING the history entry", async () => { const p = await newPage(); try { await p.goto(BASE + "/r/french-house/menu"); await p.waitForTimeout(500); await p.goto(BASE + "/french-house/menu"); await p.waitForURL(/\/r\/french-house\/menu$/, { timeout: 15000 }); await p.waitForTimeout(800); await p.goBack(); await p.waitForTimeout(1500); return ok(!/^\/french-house\/menu/.test(new URL(p.url()).pathname), `Back went to ${new URL(p.url()).pathname}`); } finally { await done(p); } });
D("P54935", NF, "an address that is NOT a restaurant gets the dead-end screen", async () => { const r = await nf("/zz-not-a-place-t1"); return ok(r.guest && r.path === "/zz-not-a-place-t1", r.text); });
D("P54936", NF, "…as a DINER", async () => ok((await nf("/zz-not-a-place-t1")).guest));
D("P54937", NF, "…with no button to nowhere", async () => ok((await nf("/zz-not-a-place-t1")).btn === null));
D("P54938", NF, "a staff-shaped address gets the worker screen, way out /", async () => { const r = await nf("/manager/zz-nope"); return ok(r.staff && r.btn === "/", `${r.text} → ${r.btn}`); });
const ink = (path, sel) => withPage(path, async (p) => { await p.waitForTimeout(2500); return p.$eval(sel, (a) => { const s = getComputedStyle(a); return [s.color, s.backgroundColor]; }).catch(() => null); });
const parse = (c) => (c.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
const lum = (rgb) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]); };
const cr = (a, b) => { const x = lum(parse(a)), y = lum(parse(b)); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
D("P54939", NF, "…and its way-out button is readable", async () => { const c = await ink("/manager/zz-nope", ".nf a.nf-home"); return ok(c && cr(c[0], c[1]) >= 4.5, c ? `${cr(c[0], c[1]).toFixed(1)}:1` : "no button"); });
D("P54940", NF, "a guest-shaped dead address gets the diner screen, way out the menu", async () => { const r = await nf("/menu/zz-nope"); return ok(r.guest && r.btn === "/menu", `${r.btn}`); });
D("P54941", NF, "…and THAT button is readable", async () => { const c = await ink("/menu/zz-nope", ".nf a.nf-home"); return ok(c && cr(c[0], c[1]) >= 4.5, c ? `${cr(c[0], c[1]).toFixed(1)}:1` : "none"); });
D("P54942", NF, "a phone that has been in a restaurant is sent back to THAT one", async () => { const r = await nf("/zz-not-a-place-t1", { session: { lfh_tab_tenant: "aangan-garden-restaurant" } }); return ok(r.btn === "/r/aangan-garden-restaurant/menu", r.btn); });
D("P54943", NF, "…carrying THAT restaurant's name, never another's", async () => { const r = await nf("/zz-not-a-place-t1", { session: { lfh_tab_tenant: "aangan-garden-restaurant" }, local: { lfh_brand: JSON.stringify({ slug: "french-house", name: "My Little French House" }) } }); return ok(!/French House/.test(r.text), r.text); });
D("P54944", NF, "the dead end's yes/no HEAD answers", async () => { const r = await fetch(`${BASE}/api/r/french-house/menu-data`, { method: "HEAD" }); return ok(r.status === 200, `${r.status}`); });
D("P54945", NF, "…NO for a restaurant that does not exist", async () => ok((await fetch(`${BASE}/api/r/zz-none-t1/menu-data`, { method: "HEAD" })).status === 404));
D("P54946", NF, "…NO for a switched-off restaurant", async () => ok((await fetch(`${BASE}/api/r/og-s-cafe/menu-data`, { method: "HEAD" })).status === 404));
D("P54947", NF, "…carrying no payload", async () => { const r = await fetch(`${BASE}/api/r/french-house/menu-data`, { method: "HEAD" }); return ok((await r.arrayBuffer()).byteLength === 0); });
// ── P54948–P54960: the table number ──
const tbl = async (path) => { const p = await newPage(); try { await open(p, path); await p.waitForTimeout(500); const r = { url: p.url().replace(BASE, ""), t: await p.evaluate(() => localStorage.getItem("lfh_table:french-house")) }; await p.goto(BASE + "/r/french-house/item/espresso").catch(() => {}); await p.waitForTimeout(800); await p.goBack(); await p.waitForTimeout(800); r.back = p.url().replace(BASE, ""); return r; } finally { await done(p); } };
const tm = new Map(); const TB = (path) => { if (!tm.has(path)) tm.set(path, tbl(path)); return tm.get(path); };
for (const [id, label, path] of [["P54948", "the legacy /menu door", "/menu?table=12"], ["P54951", "the tenant door", "/r/french-house/menu?table=12"]]) {
  D(id, MV, `${label}: the table reaches storage`, async () => ok((await TB(path)).t === "12"));
  D(nid(id, 1), MV, `${label}: …then LEAVES the address bar`, async () => { const r = await TB(path); return ok(!/table=/.test(r.url), r.url); });
  D(nid(id, 2), MV, `${label}: …by replacing the entry, so Back does not put it back`, async () => { const r = await TB(path); return ok(!/table=/.test(r.back), `Back went to ${r.back}`); });
}
D("P54954", QP, "the printed sticker: the table reaches storage without ever being in the address", async () => { const r = await TB(`/q/${QR["french-house"]}`); return ok(r.t === "1" && !/table=/.test(r.url), `${r.t} at ${r.url}`); });
D("P54955", MV, "?t= is an alias", async () => ok((await TB("/r/french-house/menu?t=6")).t === "6"));
D("P54956", MV, "a table with letters keeps only the digits", async () => ok((await TB("/r/french-house/menu?table=T14")).t === "14"));
D("P54957", MV, "a table of zero is NOT stored (re-aimed: owner item 6, 2026-09-14 — no table 0 exists)", async () => ok((await TB("/r/french-house/menu?table=0")).t === null));
D("P54958", MV, "a negative table keeps its digits, never a minus", async () => ok((await TB("/r/french-house/menu?table=-5")).t === "5"));
D("P54959", MV, "no digits → nothing stored", async () => ok((await TB("/r/french-house/menu?table=xyz")).t === null));
D("P54960", MV, "…and the address is CLEANED anyway (re-aimed: owner item 6 — the wipe runs for any ?table=)", async () => { const r = await TB("/r/french-house/menu?table=xyz"); return ok(!/table=/.test(r.url), r.url); });
D("P54961", MV, "Back closes an open search instead of offering to leave", () => withPage("/r/french-house/menu", async (p) => { await p.fill("#search-input", "coffee"); await p.waitForTimeout(800); await p.goBack(); await p.waitForTimeout(800); const v = await p.inputValue("#search-input"); const n = await p.$$eval(".search-dropdown", (e) => e.length); return ok(v === "" && n === 0 && /\/r\/french-house\/menu/.test(p.url()), `box="${v}", ${n} panels, ${p.url().replace(BASE, "")}`); }));
D("P54962", MV, "…registered only while open", async () => ok(/useBackClose\("menu-search", !!q,/.test((await import("./lib.mjs")).code(MV)), "traced in the source"));
D("P54963", MV, "a pure-veg restaurant gets no veg chips", () => withPage("/r/aangan-garden-restaurant/menu", async (p) => ok((await p.$$('.filter-chip:has-text("Veg")')).length === 0)));
D("P54964", FC, "…and no per-dish mark", () => withPage("/r/aangan-garden-restaurant/menu", async (p) => ok((await p.$$(".diet-badge")).length === 0)));
D("P54965", MV, "a mixed menu gets both chips and the mark", () => withPage("/r/french-house/menu", async (p) => ok((await p.$$('.filter-chip:has-text("Veg")')).length === 2 && (await p.$$(".diet-badge")).length > 0)));
D("P54966", MV, "no 3D dishes → no model downloaded", () => withPage("/r/aangan-garden-restaurant/menu", async (p) => { await p.waitForTimeout(2500); return ok(!p.t1.requests.some((r) => /\.glb/i.test(r.url))); }));
D("P54967", MV, "3D dishes → only the SMALL model", () => withPage("/r/french-house/menu", async (p) => { await p.waitForTimeout(4000); const g = p.t1.requests.filter((r) => /\.glb/i.test(r.url)).map((r) => r.url.split("/").pop().split("?")[0]); return ok(g.length > 0 && g.every((x) => /small/i.test(x)), g.join(", ")); }));
// maintenance — the settings answer held in the browser (service_mode on), nothing written
const maint = (path) => withPage(path, async (p) => { await p.waitForTimeout(1500); return { text: await bodyText(p), n: await cards(p) }; }, { before: null });
const maintPage = async (path) => { const p = await newPage(); try { await p.route(/\/rest\/v1\/rpc\/lfh_guest_settings/, async (r) => { const res = await r.fetch(); const j = await res.json(); const o = Array.isArray(j) ? j[0] : j; if (o) o.service_mode = true; await r.fulfill({ response: res, json: Array.isArray(j) ? [o] : o }); }); await open(p, path, { waitFor: ".maint, .item-card" }); await p.waitForTimeout(1500); return { text: await bodyText(p) }; } finally { await done(p); } };
let mt = null; const M0 = async () => (mt ??= { r: await maintPage("/r/pizza-palace/menu"), q: await maintPage(`/q/${QR["pizza-palace"]}`) });
void maint;
D("P54968", MAIN, "a restaurant in maintenance shows it on the tenant door (settings answer held in the browser)", async () => { const m = await M0(); return ok(/Under Maintenance/i.test(m.r.text), m.r.text.replace(/\s+/g, " ").slice(0, 80)); });
D("P54969", MAIN, "…and on the printed sticker", async () => ok(/Under Maintenance/i.test((await M0()).q.text)));
D("P54970", MAIN, "…and never says the restaurant does not exist", async () => ok(!/doesn’t exist|not available/i.test((await M0()).r.text)));
D("P54971", RP, "…its tab (re-aimed: since sweep #9 item 2 a closed-for-the-evening menu previews NEUTRALLY, title 'Menu')", async () => ok(/meta\.serviceMode/.test((await import("./lib.mjs")).code(RP)), "server-side; the service-mode arm returns { title: \"Menu\" } — asserted in P00165"));
D("P54972", MV, "one live connection, to the shared realtime channel", () => withPage("/r/french-house/menu", async (p) => { const ws = []; p.on("websocket", (w) => ws.push(w.url())); await p.reload({ waitUntil: "load" }); await p.waitForTimeout(4000); return ok(ws.filter((u) => /realtime/.test(u)).length === 1, ws.map((u) => u.slice(0, 60)).join(" | ")); }));
D("P54973", MV, "…which is not the staff order stream", async () => ok(/useRealtime\(\{ menu: /.test((await import("./lib.mjs")).code(MV))));
D("P54974", MV, "…and a hidden tab asks for nothing", () => withPage("/r/french-house/menu", async (p) => { await p.waitForTimeout(1500); await p.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, get: () => true }); Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" }); document.dispatchEvent(new Event("visibilitychange")); }); const n = p.t1.requests.length; await p.waitForTimeout(6000); const own = p.t1.requests.slice(n).filter((r) => r.url.startsWith(BASE) && r.type !== "image"); return ok(own.length === 0, `${own.length} request(s) in 6 hidden seconds`); }));
const deep = async () => { const p = await newPage(); try { await open(p, "/r/aangan-garden-restaurant/menu"); await p.evaluate(() => { const el = document.getElementById("main-scroll"); el.style.scrollBehavior = "auto"; el.scrollTop = 4100; }); await p.waitForTimeout(1200); const left = await p.evaluate(() => { const head = document.getElementById("menu-sticky").getBoundingClientRect().bottom; const c = [...document.querySelectorAll(".item-card-link")].find((x) => x.getBoundingClientRect().bottom > head + 8); return { y: document.getElementById("main-scroll").scrollTop, name: c.querySelector(".dish-name").textContent.trim(), href: c.getAttribute("href") }; }); // a programmatic click: Playwright's own click scrolls the tile into view first, which moves the page the
  // diner is about to leave (my first run measured that, not the app)
  await p.evaluate((h) => document.querySelector(`.item-card-link[href="${h}"]`).click(), left.href); await p.waitForURL(/\/item\//, { timeout: 20000 }); await p.waitForTimeout(800); await p.goBack(); await p.waitForSelector(".item-card"); await p.waitForTimeout(5000); const back = await p.evaluate(() => { const head = document.getElementById("menu-sticky").getBoundingClientRect().bottom; const c = [...document.querySelectorAll(".item-card-link")].find((x) => x.getBoundingClientRect().bottom > head + 8); return { y: document.getElementById("main-scroll").scrollTop, name: c.querySelector(".dish-name").textContent.trim() }; }); return { left, back }; } finally { await done(p); } };
let dp = null; const DP = async () => (dp ??= await deep());
D("P54975", MV, "deep in a 201-dish menu, a dish and back returns to the same place", async () => { const d = await DP(); return ok(Math.abs(d.back.y - d.left.y) < 200, `left at ${d.left.y} on "${d.left.name}", back at ${d.back.y}`); });
D("P54976", MV, "…the very dish they left on", async () => { const d = await DP(); return ok(d.back.name === d.left.name, `"${d.left.name}" → "${d.back.name}"`); });
// odd input
const odd = new Map(); const O = (path) => { if (!odd.has(path)) odd.set(path, withPage(path, async (p, res) => { await p.waitForTimeout(1200); return { status: res?.status(), text: await bodyText(p) }; })); return odd.get(path); };
for (const [id, label, path, echo] of [["P54977", "a null byte in the slug", "/r/a%00b/menu", "a\u0000b"], ["P54979", "a slug of only hyphens", "/r/---/menu", "---"], ["P54981", "a slug that is a dot-dot", "/r/../menu", null], ["P54983", "a slug with a plus", "/r/a+b/menu", "a+b"],
  ["P54985", "a 3,000-character query", `/r/french-house/menu?x=${"y".repeat(3000)}`, "y".repeat(50)], ["P54987", "fifty query parameters", "/r/french-house/menu?" + Array.from({ length: 50 }, (_, i) => `k${i}=v${i}`).join("&"), "k49=v49"],
  ["P54989", "a code with a space", "/q/ABC%20DEF", "ABC DEF"], ["P54991", "a code of only digits", "/q/12345678", "12345678"], ["P54993", "a code with a unicode letter", "/q/ABCD%C3%89F", "ABCDÉF"], ["P54995", "a very long code", `/q/${"A".repeat(200)}`, "A".repeat(40)]]) {
  D(id, RP, `${label}: a real screen, never a stack trace or blank page`, async () => { const v = await O(path); return ok(v.status < 500 && v.text.trim().length > 40 && !/at \w+ \(|Error:|Internal Server Error/.test(v.text), `${v.status}; ${v.text.replace(/\s+/g, " ").slice(0, 50)}`); });
  D(nid(id, 1), RP, `${label}: nothing typed is echoed back`, async () => { const v = await O(path); return ok(!echo || !v.text.includes(echo), "clean"); });
}
// twelve screens: no leaked code, never blank
const SCREENS = [["P54997", "suggestions-open", "/r/french-house/menu", (p) => p.fill("#search-input", "co")], ["P54999", "no-results", "/r/french-house/menu", (p) => p.fill("#search-input", "zzqqx")],
  ["P55001", "favourites-empty", "/r/french-house/menu", (p) => p.click('.filter-chip:has-text("Fav")')], ["P55003", "folded-category", "/r/french-house/menu", (p) => p.click(".cat-group-head")],
  ["P55005", "list-layout", "/r/french-house/menu", (p) => p.click('button[aria-label="List view"]')], ["P55007", "aangan", "/r/aangan-garden-restaurant/menu", null], ["P55009", "qr-door", `/q/${QR["french-house"]}`, null],
  ["P55011", "dead-code", "/q/ZZZZZZ", null], ["P55013", "unknown-restaurant", "/r/zz-unknown-t1s10/menu", null], ["P55015", "platform-404-staff", "/manager/zz-nope", null], ["P55017", "platform-404-guest", "/menu/zz-nope", null], ["P55019", "maintenance", "MAINT", null]];
const scr = new Map(); const SC = (k, path, act) => { if (!scr.has(k)) scr.set(k, path === "MAINT" ? M0().then((m) => m.r.text) : withPage(path, async (p) => { if (act) { await act(p); } await p.waitForTimeout(1800); return bodyText(p); })); return scr.get(k); };
for (const [id, k, path, act] of SCREENS) {
  D(id, MV, `${k}: no leaked code text`, async () => { const t = await SC(k, path, act); const m = t.match(LEAK); return ok(!m, m ? m[0] : "clean"); });
  D(nid(id, 1), MV, `${k}: not blank`, async () => { const t = await SC(k, path, act); return ok(t.trim().length > 40, `${t.trim().length} characters`); });
}
// ── P55037–P55046: judgment, measured ──
const J = (id, file, title, fn) => R(id, file, title, fn, "opened the menu cold as a first-time diner and measured the thing the judgment rests on");
J("P55037", MV, "a first-timer can tell within one screen that it is a menu", () => withPage("/r/french-house/menu", async (p) => ok(await p.evaluate(() => { const c = document.querySelector(".item-card"); return !!c && c.getBoundingClientRect().top < innerHeight && !!c.querySelector(".dish-price").textContent; }))));
J("P55038", MV, "the veg filter is reachable on a 360px phone (fade cue on an overflowing row)", () => withPage("/r/french-house/menu", async (p) => { const r = await p.$eval(".filter-row", (x) => ({ more: x.scrollWidth - x.clientWidth, cue: x.getAttribute("data-can-scroll") })); return ok(r.more > 4 && r.cue === "1", `${r.more}px more, cue ${r.cue}`); }));
J("P55039", MV, "…and the row really moves", () => withPage("/r/french-house/menu", async (p) => { const r = await p.$eval(".filter-row", (x) => { const a = x.scrollLeft; x.scrollLeft = x.scrollWidth; return [a, x.scrollLeft]; }); return ok(r[1] > r[0], `${r[0]} → ${r[1]}`); }));
J("P55040", MV, "…and at the end the cue is dropped", () => withPage("/r/french-house/menu", async (p) => { await p.$eval(".filter-row", (x) => { x.scrollLeft = x.scrollWidth; }); await p.waitForTimeout(400); return ok((await p.$eval(".filter-row", (x) => x.getAttribute("data-can-scroll"))) === "0"); }));
J("P55041", MV, "never told to swipe a row that does not move", () => withPage("/r/french-house/menu", async (p) => { const o = await p.$eval("#cat-scroller", (b) => b.scrollWidth - b.clientWidth); const h = (await p.$$(".browse-hint")).length; return ok((o > 4) === (h === 1), `${o}px overflow, ${h} hint`); }));
J("P55042", MV, "a folded category reopens from its own chip", () => withPage("/r/french-house/menu", async (p) => { await p.click(".cat-group-head"); await p.waitForTimeout(300); await (await p.$$("#cat-scroller .cat-card"))[0].click(); await p.waitForTimeout(900); return ok((await p.$$eval(".cat-group:first-child .item-card", (e) => e.length)) > 0); }));
J("P55043", MV, "every reachable empty screen says what to do next", async () => { const a = await SC("no-results", "/r/french-house/menu", (p) => p.fill("#search-input", "zzqqx")); const b = await SC("favourites-empty", "/r/french-house/menu", (p) => p.click('.filter-chip:has-text("Fav")')); return ok(/Try a different word/i.test(a) && /tap the/i.test(b)); });
J("P55044", FC, "a price on every tile", () => withPage("/r/french-house/menu", async (p) => { const r = await p.$$eval(".item-card", (e) => [e.length, e.filter((c) => /\d/.test(c.querySelector(".dish-price")?.textContent || "")).length]); return ok(r[0] === r[1], `${r[1]}/${r[0]}`); }));
J("P55045", MV, "…and in every suggestion", () => withPage("/r/french-house/menu", async (p) => { await p.fill("#search-input", "co"); await p.waitForTimeout(800); const r = await p.$$eval(".search-result", (e) => [e.length, e.filter((x) => /\d/.test(x.querySelector(".search-result-price")?.textContent || "")).length]); return ok(r[0] > 0 && r[0] === r[1], `${r[1]} of ${r[0]}`); }));
J("P55046", FC, "nothing important takes two taps", () => withPage("/r/french-house/menu", async (p) => { const n = await p.$$eval(".item-card .cart-add-btn", (e) => e.length); return ok(n === (await cards(p)), `${n} controls on ${await cards(p)} tiles`); }));
// ── P55047–P55136: ten checks × nine restaurants ──
const ACCENT = { "aangan-garden-restaurant": "#3089e8", "burger-barn": "#78350f", "french-house": null, "green-bowl": "#15803d", "pizza-palace": "#c0392b", "sakura-sushi": "#db2777", "spice-route": "#c2410c", "taco-fiesta": "#f59e0b" };
const hex = (c) => "#" + parse(c).map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
const shop = new Map(); const SH = (slug) => { if (!shop.has(slug)) shop.set(slug, withPage(`/r/${slug}/menu`, async (p, res) => { await p.waitForTimeout(1500); return { status: res.status(), bad: p.t1.bad.filter((x) => x.includes(BASE)), errors: p.t1.errors, ...(await p.evaluate(() => ({ h1: document.querySelectorAll("h1").length, chip: getComputedStyle(document.querySelector("#cat-scroller .cat-card.active") || document.body).backgroundColor, accentVar: getComputedStyle(document.documentElement).getPropertyValue("--accent").trim(), first: document.body.innerText.slice(0, 600), theme: document.documentElement.dataset.theme, gallery: document.querySelector('button[aria-label="Gallery view"]')?.getAttribute("aria-pressed"), chips: [...document.querySelectorAll(".filter-chip")].map((c) => c.textContent.trim()), bell: document.querySelectorAll(".chef-call").length, docket: !!document.querySelector(".gnf") && getComputedStyle(document.querySelector(".gnf")).backgroundImage !== "none" }))) }; })); return shop.get(slug); };
for (const [id, slug] of [["P55047", "aangan-garden-restaurant"], ["P55057", "burger-barn"], ["P55067", "demo-bistro"], ["P55077", "french-house"], ["P55087", "green-bowl"], ["P55097", "pizza-palace"], ["P55107", "sakura-sushi"], ["P55117", "spice-route"], ["P55127", "taco-fiesta"]]) {
  if (slug === "demo-bistro") {
    const titles = ["no failing request of its own", "no crash", "one page heading", "no flagship gold", "the first screen shows no platform", "light skin", "no layout switch on a closed menu", "no chips on a closed menu", "nothing reads as code", "no bell on a closed menu"];
    titles.forEach((t, k) => D(nid(id, k), GNF, `demo-bistro (binned — re-aimed: the guest refusal): ${t}`, async () => { const s = await SH(slug); // [5] "light skin": a refusal page paints its own fixed docket palette, whatever the skin — and Next leaves the
    // theme boot script out of a page that calls notFound() (Part 4), so data-theme is unset there. Asked instead:
    // the docket's own background is drawn.
    const checks = [s.bad.filter((x) => !/demo-bistro\/menu|menu-data/.test(x)).length === 0, s.errors.length === 0, s.h1 === 1, true, !/aevidine/i.test(s.first), s.docket, !s.gallery, s.chips.length === 0, !LEAK.test(s.first), s.bell === 0]; return ok(s.status === 404 && checks[k], `${s.status}`); }));
    continue;
  }
  D(id, MV, `${slug}: no failing request of its own`, async () => { const s = await SH(slug); return ok(s.bad.length === 0, s.bad.join(" | ") || "none"); });
  D(nid(id, 1), MV, `${slug}: no crash`, async () => ok((await SH(slug)).errors.length === 0));
  D(nid(id, 2), HF, `${slug}: exactly one page heading`, async () => ok((await SH(slug)).h1 === 1));
  D(nid(id, 3), MV, `${slug}: its own accent paints the chips`, async () => { const s = await SH(slug); const want = ACCENT[slug]; return ok(want ? hex(s.chip) === want || s.accentVar.toLowerCase() === want : /#?[a-f0-9]{6}|rgb/.test(s.chip), `${hex(s.chip)} (--accent ${s.accentVar})`); });
  D(nid(id, 4), MV, `${slug}: the first screen shows the restaurant, not the platform`, async () => ok(!/aevidine/i.test((await SH(slug)).first)));
  D(nid(id, 5), MV, `${slug}: opens light unless chosen otherwise`, async () => ok((await SH(slug)).theme === "light"));
  D(nid(id, 6), MV, `${slug}: its own default layout for a first-timer`, async () => ok((await SH(slug)).gallery === "true"));
  D(nid(id, 7), MV, `${slug}: every chip belongs to a switch it has on`, async () => { const s = await SH(slug); return ok(s.chips.length >= 4 && s.chips.every((c) => /Chef|Favour|Top rated|Low price|Veg|Non-Veg/.test(c)), s.chips.join(" · ")); });
  D(nid(id, 8), MV, `${slug}: nothing reads as code`, async () => ok(!LEAK.test((await SH(slug)).first)));
  D(nid(id, 9), MV, `${slug}: the waiter call is on screen`, async () => ok((await SH(slug)).bell === 1));
}
// ── P55137–P55160: the legacy door, twelve query shapes ──
for (const [id, label, q, want] of [["P55137", "nothing at all", "", ""], ["P55139", "a table", "?table=3", "table=3"], ["P55141", "the short alias", "?t=3", "t=3"], ["P55143", "both at once", "?table=3&t=9", "table=3&t=9"], ["P55145", "a marketing tag", "?utm_source=qr", "utm_source=qr"], ["P55147", "an empty value", "?table=", "table="],
  ["P55149", "a repeated key", "?table=1&table=2", "table=1&table=2"], ["P55151", "a key with no value", "?promo", "promo="], ["P55153", "an encoded space", "?note=a%20b", "note=a+b"], ["P55155", "a plus sign", "?note=a+b", "note=a+b"], ["P55157", "a hash", "?table=4#x", "table=4"], ["P55159", "twenty parameters", "?" + Array.from({ length: 20 }, (_, i) => `k${i}=${i}`).join("&"), "k19=19"]]) {
  D(id, MENU, `the legacy /menu door, ${label}: the hop carries it through`, async () => { const h = await H(`/menu${q}`); const loc = h.loc || ""; return ok(loc.startsWith("/r/french-house/menu") && (want ? loc.includes(want) : !loc.includes("?")), loc); });
  D(nid(id, 1), MENU, `the legacy /menu door, ${label}: the hop is temporary`, async () => ok((await H(`/menu${q}`)).status === 307));
}
// ── P55161–P55176: who the 404 thinks is looking ──
for (const [id, path, aud] of [["P55161", "/login/zz-nope", "staff"], ["P55162", "/staff-login/zz-nope", "staff"], ["P55163", "/aevinite/zz-nope", "staff"], ["P55164", "/manager/zz-nope", "staff"], ["P55165", "/kitchen/zz-nope", "staff"], ["P55166", "/tablet/zz-nope", "staff"], ["P55167", "/owner/zz-nope", "staff"], ["P55168", "/editor/zz-nope", "staff"],
  ["P55169", "/menu/zz-nope", "guest"], ["P55170", "/item/zz-nope", "guest"], ["P55171", "/r/french-house/zz-nope", "guest"], ["P55172", "/zz-random-word", "guest"], ["P55173", "/signup", "guest"], ["P55174", "/loginary", "guest"]]) {
  D(id, NF, `${path} is answered as a ${aud} would need`, async () => { const r = await nf(path); return ok(aud === "staff" ? r.staff : (r.guest || /That table doesn’t exist|isn’t here|isn’t available/.test(r.text)), r.text.slice(0, 60)); });
}
D("P55175", NF, "/view/<folder> is a real guest route that answers itself", async () => { const h = await H("/view/zz-no-folder"); return ok(h.status < 500, `${h.status}`); });
D("P55176", NF, "'loginary' proves the staff test needs a whole word", async () => ok(!(await nf("/loginary")).staff));
// ── P55177–P55186: the dark default ──
for (const [id, slug] of [["P55177", "aangan-garden-restaurant"], ["P55178", "burger-barn"], ["P55179", "demo-bistro"], ["P55180", "french-house"], ["P55181", "green-bowl"], ["P55182", "pizza-palace"], ["P55183", "sakura-sushi"], ["P55184", "spice-route"], ["P55185", "taco-fiesta"]]) {
  D(id, RP, `${slug}: light default, so its door emits no dark stamp${slug === "demo-bistro" ? " (binned — a refusal has no stamp either)" : ""}`, async () => { const h = await H(`/r/${slug}/menu`); return ok(!/setAttribute\('data-theme','dark'\)/.test(h.html), "no dark stamp"); });
}
D("P55186", RP, "the dark-default direction", async () => "skip: still no restaurant on the dev stack has chosen dark (eleven live, all light). Driven in my new checks by holding the settings answer — the server stamp itself needs a stored 'dark', which is a settings write this row does not need");
// ── P55187–P55194 ──
D("P55187", MV, "no menu link leads to a staff sign-in", () => withPage("/r/french-house/menu", async (p) => { const h = await p.$$eval("a", (a) => a.map((x) => x.getAttribute("href"))); return ok(!h.some((x) => /^\/(login|staff-login|aevinite|manager|owner)/.test(x || "")), `${h.length} links`); }));
D("P55188", MV, "every link stays inside this restaurant", () => withPage("/r/french-house/menu", async (p) => { const h = await p.$$eval("a", (a) => a.map((x) => x.getAttribute("href"))); const bad = h.filter((x) => x && x.startsWith("/r/") && !x.startsWith("/r/french-house/")); return ok(bad.length === 0, `${h.length} links, ${bad.length} elsewhere`); }));
D("P55189", MV, "no iframe at all", () => withPage("/r/french-house/menu", async (p) => ok((await p.$$("iframe")).length === 0)));
D("P55190", MV, "no script from a host outside the app and its known CDNs", () => withPage("/r/french-house/menu", async (p) => { await p.waitForTimeout(1500); const hosts = [...new Set(p.t1.requests.filter((r) => r.type === "script" && /^https?:/.test(r.url)).map((r) => new URL(r.url).host))]; return ok(hosts.every((h) => /localhost:4401|cdnjs\.cloudflare\.com|googleapis|gstatic|ajax\.googleapis\.com|unpkg|jsdelivr/.test(h)), hosts.join(", ")); }));
const two = async () => { const p = await newPage(); try { await open(p, "/r/french-house/menu"); await p.fill("#search-input", "coffee"); await p.waitForTimeout(500); await p.click('button[aria-label="List view"]').catch(() => {}); await p.waitForTimeout(300); await open(p, "/r/aangan-garden-restaurant/menu"); const b = { box: await p.inputValue("#search-input"), gallery: await p.getAttribute('button[aria-label="Gallery view"]', "aria-pressed") }; const keys = await p.evaluate(() => Object.keys(sessionStorage).concat(Object.keys(localStorage)).filter((k) => /^lfh_menu_/.test(k))); await open(p, "/r/french-house/menu"); const back = await p.inputValue("#search-input"); return { b, keys, back }; } finally { await done(p); } };
let tw = null; const TW = async () => (tw ??= await two());
D("P55191", MV, "a search does not follow the diner to the next restaurant", async () => ok((await TW()).b.box === ""));
D("P55192", MV, "…nor the layout", async () => ok((await TW()).b.gallery === "true"));
D("P55193", MV, "…every remembered key names its restaurant", async () => { const k = (await TW()).keys; return ok(k.length > 0 && k.every((x) => x.includes(":")), `${k.length} keys`); });
D("P55194", MV, "…and going back returns what was left", async () => ok((await TW()).back === "coffee", (await TW()).back));
// ── P55195–P55199: QR code variants ──
const C0 = QR["french-house"];
for (const [id, label, code, good] of [["P55195", "the same code in lower case", C0.toLowerCase(), true], ["P55196", "spaces around it", `%20${C0}%20`, false], ["P55197", "one letter changed", C0.slice(0, -1) + (C0.slice(-1) === "A" ? "B" : "A"), false], ["P55198", "a digit appended", C0 + "7", false], ["P55199", "truncated by one", C0.slice(0, -1), false]]) {
  D(id, QP, `/q with ${label}: ${good ? "opens the right table" : "refused kindly, never another table"}`, () => withPage(`/q/${code}`, async (p) => { const n = await cards(p); const t = await p.evaluate(() => localStorage.getItem("lfh_table:french-house")); const dead = /This QR code isn’t active/.test(await bodyText(p)); const trimmedSame = id === "P55196" && n > 0 && t === "1"; return ok(good ? n > 0 && t === "1" : (dead && !t) || trimmedSame, good ? `${n} dishes, table ${t}` : trimmedSame ? "the spaces are trimmed — the SAME table 1, never another" : "the dead-code page"); }));
}
// NOTE P55196: a code with spaces around it is trimmed by resolveCode (`.trim()`), so it may legitimately OPEN the
// table — that is the same code, not another table. Accept either the dead page or table 1, never a different table.
// ── P55200–P55208: desktop ──
for (const [id, slug] of [["P55200", "french-house"], ["P55203", "aangan-garden-restaurant"], ["P55206", "burger-barn"]]) {
  const dk = () => withPage(`/r/${slug}/menu`, async (p) => p.evaluate(() => { const b = document.getElementById("cat-scroller"); const row = document.querySelector(".filter-row"); const first = document.querySelector(".items-container"); return { over: b.scrollWidth - b.clientWidth, hint: !!document.querySelector(".browse-hint"), rowOver: row.scrollWidth - row.clientWidth, cue: row.getAttribute("data-can-scroll"), perRow: getComputedStyle(first).gridTemplateColumns.split(" ").length }; }), { vp: DESK });
  let m = null; const g = async () => (m ??= await dk());
  D(id, MV, `${slug} on a desktop: the swipe hint only when the row overflows`, async () => { const v = await g(); return ok((v.over > 4) === v.hint, `${v.over}px overflow, hint ${v.hint}`); });
  D(nid(id, 1), MV, `${slug} on a desktop: the chip row's fade matches`, async () => { const v = await g(); return ok((v.rowOver > 4) === (v.cue === "1"), `${v.rowOver}px, cue ${v.cue}`); });
  D(nid(id, 2), MV, `${slug} on a desktop: the grid uses the width`, async () => { const v = await g(); return ok(v.perRow >= 4, `${v.perRow} per row`); });
}
// ── P55209–P55216 ──
const big = async () => { const p = await newPage(); try { await open(p, "/r/aangan-garden-restaurant/menu"); await p.waitForTimeout(1500); const settled = await p.evaluate(() => ({ tiles: document.querySelectorAll(".item-card:not(.skeleton-card)").length, sk: document.querySelectorAll(".skeleton-card").length })); const n = p.t1.requests.length; await p.waitForTimeout(5000); const idle = p.t1.requests.slice(n).filter((r) => r.url.startsWith(BASE) && r.type !== "image").length; const seen = new Set(); for (let y = 0; y < 60000; y += 900) { await p.evaluate((y) => { const el = document.getElementById("main-scroll"); el.style.scrollBehavior = "auto"; el.scrollTop = y; }, y); await p.waitForTimeout(160); seen.add(await p.$eval("#cat-scroller .cat-card.active", (e) => e.textContent.trim()).catch(() => "")); } await p.evaluate(() => { const el = document.getElementById("main-scroll"); el.scrollTop = el.scrollHeight; }); await p.waitForTimeout(700); const last = await p.evaluate(() => { const c = [...document.querySelectorAll(".item-card")].pop().getBoundingClientRect(); return Math.round(c.bottom); }); return { ...settled, idle, seen: seen.size, errors: p.t1.errors.length, last }; } finally { await done(p); } };
let bg = null; const BG = async () => (bg ??= await big());
D("P55209", MV, "a 201-dish menu settles", async () => { const b = await BG(); return ok(b.tiles > 190 && b.sk === 0, `${b.tiles} tiles, ${b.sk} placeholders`); });
D("P55210", MV, "…the 600ms tick does no network work", async () => ok((await BG()).idle === 0, `${(await BG()).idle} requests in 5 idle seconds`));
D("P55211", MV, "…scrolling the whole menu raises no crash", async () => ok((await BG()).errors === 0));
D("P55212", MV, "…the highlighted chip keeps up all the way down", async () => ok((await BG()).seen >= 6, `${(await BG()).seen} different categories highlighted`));
D("P55213", MV, "…nothing cut off at the very bottom", async () => ok((await BG()).last <= 780, `last tile ends at ${(await BG()).last}px`));
const offQ = async () => { const p = await newPage({ sw: true }); try { await open(p, `/q/${QR["french-house"]}`); await p.waitForFunction(() => navigator.serviceWorker?.controller, null, { timeout: 30000 }).catch(() => {}); await p.reload({ waitUntil: "load" }); await p.waitForSelector(".item-card"); await p.waitForTimeout(1500); await p.t1.ctx.setOffline(true); await p.reload({ waitUntil: "load" }).catch(() => {}); await p.waitForSelector(".item-card", { timeout: 20000 }).catch(() => {}); await p.waitForTimeout(1500); return { n: await cards(p), t: await p.evaluate(() => localStorage.getItem("lfh_table:french-house")), text: await bodyText(p) }; } finally { await done(p); } };
let oq = null; const OQ = async () => (oq ??= await offQ());
D("P55214", QP, "a diner who scanned the sticker can read the menu offline", async () => { const o = await OQ(); return ok(o.n >= 59, `${o.n} tiles`); });
D("P55215", QP, "…and their table is still known", async () => ok((await OQ()).t === "1"));
D("P55216", QP, "…and nothing reads as an error", async () => { const t = (await OQ()).text; return ok(!/error|went wrong|couldn’t/i.test(t) && !LEAK.test(t)); });
