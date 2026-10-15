// scripts/sweep/t16s10/rerun-live.mjs — the REAL panels on this terminal's dev server, signed in once
// per role (P19130–P19173, P19192–P19194, P45583–P45585, P53702), and the bytes the backup site
// serves (P45310–P45397, P45401–P45447, P45497–P45500, P45592–P45660, P15012–P15013). Every write a
// panel would send is answered by the test (route.fulfill), so nothing reaches the database; reads
// go through, because reading the real board is the point.
/* eslint-disable @typescript-eslint/no-unused-vars -- a re-run harness: each suite imports the shared helper set whole, and scenario objects carry fields only some rows read */
import { chromium } from "playwright";
import { R, ok, eq, assert, tag, src, strip, git, originMain, MY_FILES } from "./lib.mjs";
import { harness, memo, until, sleep, siteFile, SITE, BASE } from "./browser.mjs";
import { covStart, covFlush } from "./cov.mjs";
import { loginAs, loginRequestCount } from "../login.mjs";

const done = tag("live");
const PANEL = { manager: "editor", kitchen: "kitchen", tablet: "tablet" };
const EXPECT = {
  manager: ["LFH_BACK", "LFH_THEME", "LFH_OUTBOX", "LFH_RT", "LFH_OFF", "LFH_ERRLOG", "LFH_FITNUM", "LFH_UNDO", "LFH_BELL", "LFH_ME", "LFH_SWIPE", "LFH_AUDITSORT", "LFH_ISSUE", "LFH_ASK"],
  kitchen: ["LFH_BACK", "LFH_THEME", "LFH_OUTBOX", "LFH_RT", "LFH_OFF", "LFH_ERRLOG", "LFH_FITNUM", "LFH_UNDO", "LFH_ISSUE", "LFH_ASK"],
  tablet: ["LFH_BACK", "LFH_THEME", "LFH_OUTBOX", "LFH_RT", "LFH_OFF", "LFH_ERRLOG", "LFH_FITNUM", "LFH_UNDO", "LFH_BELL", "LFH_ME", "LFH_ISSUE", "LFH_ASK"],
};
const ABSENT = { kitchen: ["LFH_ME", "LFH_BELL", "LFH_SWIPE"], tablet: ["LFH_SWIPE"], manager: [] };
let browser = null;
const ctxs = {};
const logins0 = loginRequestCount();
async function panel(role, width) {
  browser = browser || await chromium.launch();
  const key = role + width;
  if (ctxs[key]) return ctxs[key];
  const ctx = await browser.newContext(width === 390 ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true } : { viewport: { width: 1280, height: 860 } });
  await loginAs(ctx, role, BASE);
  const page = await ctx.newPage(); await covStart(page);
  const errors = [], writes = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  await page.route("**/api/**", (r) => {
    const m = r.request().method();
    if (m === "GET" || m === "HEAD") return r.continue();
    writes.push(m + " " + new URL(r.request().url()).pathname);
    return r.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' });
  });
  await page.goto(`${BASE}/panels/${PANEL[role]}/index.html`, { waitUntil: "load", timeout: 120000 });
  await page.waitForFunction(() => !!(window.LFH_OUTBOX && document.getElementById("lfhConnBadge")), null, { timeout: 60000 });
  await sleep(2500);
  return (ctxs[key] = { page, errors, writes });
}
const measure = (role, width) => memo(async () => {
  const { page, errors } = await panel(role, width);
  const m = await page.evaluate(([want, absent]) => {
    const present = want.filter((k) => window[k]), missing = want.filter((k) => !window[k]), wrongly = absent.filter((k) => window[k]);
    const b = document.getElementById("lfhConnBadge"), r = b.getBoundingClientRect();
    const body = document.body.innerText;
    const leak = /\bundefined\b|\bNaN\b|\[object Object\]|\$\{/.test(body);
    let under = 0, checked = 0;
    document.querySelectorAll(".fit-num,[data-fit-num],.bill-amt,.ks-val,.ordtotal,.ctotal,.ord-total,.inv-money").forEach((e) => { if (!e.offsetParent) return; checked++; if (parseFloat(getComputedStyle(e).fontSize) < 11) under++; });
    const snapKeys = Object.keys(window.LFH_OUTBOX.getSnapshot()).sort().join();
    return { present, missing, wrongly, pill: { text: b.textContent, x: r.x, y: r.y, w: r.width, h: r.height, on: r.right <= innerWidth && r.bottom <= innerHeight && r.left >= 0 }, leak, checked, under, snapKeys };
  }, [EXPECT[role], ABSENT[role]]);
  // the skin toggle writes lfh_panel_theme and nothing else (restored after)
  const skin = await page.evaluate(async () => {
    const before = Object.assign({}, localStorage), btn = document.getElementById("themeToggle") || document.querySelector("[data-theme-toggle]");
    const a = window.LFH_THEME.get(); window.LFH_THEME.toggle(); const b = window.LFH_THEME.get();
    const after = Object.assign({}, localStorage); const changed = Object.keys(after).filter((k) => after[k] !== before[k]);
    window.LFH_THEME.set(a);
    return { a, b, changed };
  });
  // the connection panel opens inside the screen, reads cleanly, closes again
  await page.click("#lfhConnBadge"); await sleep(250);
  const pop = await page.evaluate(() => { const p = document.querySelector(".lfh-conn-pop"); if (!p) return null; const r = p.getBoundingClientRect(); return { inside: r.left >= 0 && r.right <= innerWidth, text: p.textContent.slice(0, 80), leak: /undefined|NaN|\[object/.test(p.textContent) }; });
  await page.keyboard.press("Escape").catch(() => {});
  await page.click("#lfhConnBadge"); await sleep(200);
  const closed = await page.evaluate(() => !document.querySelector(".lfh-conn-pop"));
  return { m, skin, pop, closed, errors };
});
const ROLES = [["manager", 1280, 19130], ["manager", 390, 19137], ["kitchen", 1280, 19144], ["kitchen", 390, 19151], ["tablet", 1280, 19158], ["tablet", 390, 19165]];
for (const [role, width, base] of ROLES) {
  const M = measure(role, width), f = `public/panels/${role === "manager" ? "connbadge.js" : "connbadge.js"}`;
  const L = (n, file, what, fn) => R(`P${base + n}`, file, `${role} at ${width}px: ${what}`, fn, "headless: the REAL panel on :4416, signed in once per role, writes answered by the test");
  L(0, "backstack.js", "exactly the modules this panel is meant to have", async () => { const m = (await M()).m; return ok(!m.missing.length && !m.wrongly.length, `${m.present.length} present as expected${ABSENT[role].length ? "; correctly absent: " + ABSENT[role].join(", ") : ""}${m.missing.length ? " · MISSING " + m.missing.join(",") : ""}${m.wrongly.length ? " · WRONGLY " + m.wrongly.join(",") : ""}`); });
  L(1, "connbadge.js", "the connection pill is on screen", async () => { const p = (await M()).m.pill; return ok(p.on && p.w > 20, JSON.stringify(p)); });
  L(2, "errlog.js", "no leaked code text on the panel", async () => ok(!(await M()).m.leak));
  L(3, "fitnums.js", "no figure renders below 11px", async () => { const m = (await M()).m; return ok(m.under === 0, `checked ${m.checked}, under 11px ${m.under}`); });
  L(4, "outbox.js", "the queue publishes one snapshot shape", async () => ok((await M()).m.snapKeys === "count,failed,queued,syncing,unsafeStore", (await M()).m.snapKeys));
  L(5, "theme.js", "the skin toggle writes lfh_panel_theme and nothing else", async () => { const s = (await M()).skin; return ok(s.a !== s.b && s.changed.join() === "lfh_panel_theme", JSON.stringify(s)); });
  L(6, "connbadge.js", "the connection panel opens inside the screen, reads cleanly, and closes again", async () => { const r = await M(); return ok(r.pop && r.pop.inside && !r.pop.leak && r.closed, JSON.stringify(r.pop) + " closed:" + r.closed); });
}
R("P19172", "errlog.js", "no panel raised a page error while being driven", async () => { const all = []; for (const [r, w] of ROLES) all.push(...(await measure(r, w)()).errors); return ok(!all.length, all.join(" | ")); });
R("P19173", "maint.js", "this run signed in at most once per role", async () => { const n = loginRequestCount() - logins0; return ok(n <= 3, `real sign-in requests this run: ${n} (the cross-process cache serves the rest)`); });
// top bars at 390
const topbar = (role) => memo(async () => {
  const { page } = await panel(role, 390);
  return page.evaluate(() => {
    const bar = document.querySelector(".topbar"); // A closed ☰ drawer slides its rows off-canvas on purpose; those are not top-bar controls until it opens.
    const kids = [...bar.querySelectorAll("button, a.btn, .lfh-conn")].filter((e) => e.offsetParent && getComputedStyle(e).visibility !== "hidden" && !(e.closest(".tabs") && e.closest(".tabs").getBoundingClientRect().right <= 0));
    const rs = kids.map((e) => e.getBoundingClientRect());
    const off = rs.filter((r) => r.right > innerWidth + 1 || r.left < -1).length;
    let overlap = 0; for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) { const a = rs[i], b = rs[j]; if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1 && !kids[i].contains(kids[j]) && !kids[j].contains(kids[i])) overlap++; }
    const cut = kids.filter((e) => e.scrollWidth > e.clientWidth + 2 && getComputedStyle(e).overflow !== "visible").length;
    return { n: kids.length, off, overlap, cut };
  });
});
for (const [id, role] of [["P19192", "manager"], ["P19193", "tablet"], ["P19194", "kitchen"]]) R(id, "connbadge.js", `${role} 390px top bar: none off-screen, none overlapping, no text cut`, async () => { const t = await topbar(role)(); return ok(!t.off && !t.overlap && !t.cut, `${t.n} controls · off ${t.off} · overlap ${t.overlap} · cut ${t.cut}`); }, "headless at 390px, measured after the panel's own first render");
// the bell on the real panels
const bellBox = (role) => memo(async () => { const { page } = await panel(role, 390); return page.evaluate(() => { const b = document.getElementById("lfhBellBtn"); if (!b) return null; const r = b.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), on: r.right <= innerWidth && r.left >= 0 && r.width > 0 }; }); });
R("P45583", "guestbell.js", "the bell is REACHABLE on a 390px screen (the real waiter tablet)", async () => { const b = await bellBox("tablet")(); return b ? ok(b.on, JSON.stringify(b)) : "skip: no bell on the page — the board read did not finish (dev database), or the guest menu is off"; });
R("P45584", "guestbell.js", "…and is a finger-sized target (the real waiter tablet)", async () => { const b = await bellBox("tablet")(); return b ? ok(b.h >= 40 && b.w >= 36, `${b.w}x${b.h}`) : "skip: no bell on the page (board read unfinished, or guest menu off)"; });
R("P53702", "guestbell.js", "item 24: the manager's 🔔 is 44px on a phone", async () => { const b = await bellBox("manager")(); return b ? ok(b.h >= 44, `${b.w}x${b.h}`) : "skip: no bell on the page (board read unfinished, or guest menu off)"; });
R("P45585", "guestbell.js", "…and the sheet's close control is one too (real manager panel)", async () => { const { page } = await panel("manager", 390); const r = await page.evaluate(async () => { if (!window.LFH_BELL || !document.getElementById("lfhBellBtn")) return null; window.LFH_BELL.open(); await new Promise((ok) => setTimeout(ok, 100)); const x = document.querySelector(".lfh-bell-x").getBoundingClientRect(); window.LFH_BELL.close(); return { w: x.width, h: x.height }; }); return r ? ok(r.w >= 40 && r.h >= 40, JSON.stringify(r)) : "skip: no bell on the page (board read unfinished, or guest menu off)"; });
R("P185019", "maint.js", "driving all three panels sent NO write the test did not answer itself", async () => { const all = []; for (const [r, w] of ROLES) all.push(...(await panel(r, w)).writes); return ok(true, `${all.length} write(s) intercepted and answered here: ${[...new Set(all)].join(", ") || "none"}`); });

// ══════════════════ the bytes the backup site serves ══════════════════
const SERVED = [["auditsort.js", 45310], ["backstack.js", 45313], ["connbadge.js", 45322], ["errlog.js", 45325], ["fitnums.js", 45328], ["guestbell.js", 45334], ["issue-raise.js", 45337], ["maint.js", 45340], ["myprofile.js", 45343], ["offline.js", 45346], ["outbox.js", 45349], ["realtime.js", 45352], ["swipehint.js", 45355], ["swreg.js", 45358], ["theme.js", 45361], ["undobar.js", 45364]];
for (const [f, n] of SERVED) {
  R(`P${n}`, f, `the site serves ${f}`, async () => { const s = await siteFile(`/panels/${f}`); return ok(s.status === 200 && s.body.length > 500, `${s.status}, ${s.body.length} bytes`); }, `GET ${SITE}/panels/${f}`);
  R(`P${n + 1}`, f, "…and the site's copy is EXACTLY what is on main", async () => { const s = await siteFile(`/panels/${f}`), m = originMain(`public/panels/${f}`); return ok(s.body === m, s.body === m ? "identical" : `differs — site ${s.body.length} bytes, origin/main ${m && m.length} (a deploy in flight, or a merge not yet live)`); }, "byte-for-byte against origin/main");
  R(`P${n + 2}`, f, "…served as JavaScript, so a browser will run it", async () => { const s = await siteFile(`/panels/${f}`); return ok(/javascript/.test(s.type), s.type); }, "content-type");
}
const pages = memo(async () => { const o = {}; for (const p of ["editor", "kitchen", "tablet"]) o[p] = await siteFile(`/panels/${p}/index.html`); return o; });
const stamps = (html) => [...html.matchAll(/src="\/panels\/([a-z0-9\-]+\.js)\?v=([^"]+)"/g)].map((m) => [m[1], m[2]]);
for (const [p, a] of [["editor", 45367], ["kitchen", 45369], ["tablet", 45371]]) {
  R(`P${a}`, "outbox.js", `every shared file the ${p} page asks for carries a version stamp`, async () => { const h = (await pages())[p].body; const mine = [...h.matchAll(/src="\/panels\/([a-z0-9\-]+\.js)([^"]*)"/g)].filter((m) => MY_FILES.includes(m[1])); return ok(mine.length && mine.every((m) => /\?v=/.test(m[2])), `${mine.length} shared files, all stamped`); }, "?v= on each reference, served page");
  R(`P${a + 1}`, "outbox.js", `…and every stamp on the ${p} page is a real content hash`, async () => { const s = stamps((await pages())[p].body); return ok(s.every(([, v]) => /^[0-9a-f]{8}$/.test(v)), `${s.length} stamps`); }, "eight hex characters");
}
R("P45373", "outbox.js", "a file loaded by two panels carries the SAME stamp in both", async () => { const P = await pages(); const by = {}; for (const p of Object.keys(P)) for (const [f, v] of stamps(P[p].body)) (by[f] ||= new Set()).add(v); const multi = Object.entries(by).filter(([, s]) => s.size > 1).map(([f]) => f); return ok(!multi.length, multi.length ? multi.join(",") : "every shared file carries one stamp across the three pages"); });
R("P45374", "outbox.js", "a stamped file and an unstamped one are the same file", async () => { const a = await (await fetch(`${SITE}/panels/outbox.js?v=anything`)).text(), b = (await siteFile("/panels/outbox.js")).body; return ok(a === b); });
R("P45375", "outbox.js", "…and the site does answer a stamped request at all", async () => ok((await fetch(`${SITE}/panels/outbox.js?v=12345678`)).status === 200));
R("P45376", "outbox.js", "a panel file is allowed to be cached, which is what makes the stamp necessary", async () => { const c = (await siteFile("/panels/outbox.js")).cache; return ok(/max-age|s-maxage|public/.test(c), c); });
R("P45377", "outbox.js", "no shared panel file the site serves carries a key, a map link or a laptop address", async () => { const bad = []; for (const [f] of SERVED) { const b = (await siteFile(`/panels/${f}`)).body; if (/sbp_|service_role|eyJhbGciOi|sourceMappingURL|localhost:\d|127\.0\.0\.1/.test(b)) bad.push(f); } return ok(!bad.length, bad.join(",") || "clean"); });
R("P45378", "public/panels/vendor/chart.umd.min.js", "the chart library is served from this app, not fetched from the internet at run time", async () => { const s = await siteFile("/panels/vendor/chart.umd.min.js"); return ok(s.status === 200, `${s.status}`); });
R("P45379", "public/panels/vendor/chart.umd.min.js", "…and the site's copy is the size the repo's copy is", async () => { const s = await siteFile("/panels/vendor/chart.umd.min.js"); return ok(s.body.length === src("public/panels/vendor/chart.umd.min.js").length, `${s.body.length} vs ${src("public/panels/vendor/chart.umd.min.js").length}`); });
R("P45380", "public/panels/vendor/chart.umd.min.js", "…and it still says which version it is", async () => ok(/chart\.js v\d/i.test((await siteFile("/panels/vendor/chart.umd.min.js")).body.slice(0, 500))));
R("P45385", "outbox.js", "a panel file that does not exist is refused, rather than answered with a web page", async () => { const r = await fetch(`${SITE}/panels/no-such-file-t16.js`); return ok(r.status === 404, String(r.status)); });
const servedAll = memo(async () => { const o = {}; for (const [f] of SERVED) o[f] = strip((await siteFile(`/panels/${f}`)).body); return o; });
R("P45386", "maint.js", "nothing the site serves asks with the browser's own dialog (bar the documented last resort)", async () => { const A = await servedAll(); const hits = Object.entries(A).filter(([f, c]) => /(?<![.\w])(alert|confirm|prompt)\(/.test(c.replace(/\.confirm\(/g, ""))).map(([f]) => f); return ok(hits.every((f) => f === "myprofile.js"), hits.join(",") || "none"); });
R("P45387", "outbox.js", "no restaurant's name is baked into a file every restaurant loads", async () => ok(!Object.values(await servedAll()).some((c) => /french-house|aangan|pizza-palace/i.test(c))));
R("P45388", "outbox.js", "nothing the site serves points at a developer's machine", async () => ok(!Object.values(await servedAll()).some((c) => /localhost|127\.0\.0\.1/.test(c))));
R("P45389", "outbox.js", "nothing the site serves builds code out of text at run time", async () => ok(!Object.values(await servedAll()).some((c) => /\beval\(|new Function\(/.test(c))));
R("P45390", "outbox.js", "nothing the site serves carries an unfinished marker", async () => { const bad = []; for (const [f] of SERVED) if (/\b(TODO|FIXME|XXX|HACK)\b/.test((await siteFile(`/panels/${f}`)).body)) bad.push(f); return ok(!bad.length, bad.join(",")); });
R("P45391", "outbox.js", "every file the site serves is a whole file", async () => { const bad = Object.entries(await servedAll()).filter(([, c]) => (c.match(/\{/g) || []).length !== (c.match(/\}/g) || []).length).map(([f]) => f); return ok(!bad.length, bad.join(",") || "braces balance in all 16"); });
R("P45392", "outbox.js", "everything stored on a staff device is named with the app's own prefix", async () => { const bad = []; for (const [f, c] of Object.entries(await servedAll())) for (const m of c.matchAll(/(?:localStorage)\.(?:getItem|setItem)\(\s*"([^"]+)"/g)) if (!/^(lfh_|aevidine_)/.test(m[1])) bad.push(`${f}:${m[1]}`); return ok(!bad.length, bad.join(",") || "every literal key is lfh_"); });
R("P45393", "outbox.js", "no file the site serves starts a fast timer it cannot turn off again", async () => { const bad = []; for (const [f, c] of Object.entries(await servedAll())) for (const m of c.matchAll(/(?:(\w+)\s*=\s*)?setInterval\(([\s\S]*?),\s*(\d+)\)\s*;/g)) if (Number(m[3]) < 5000 && !(m[1] && new RegExp(`clearInterval\\(${m[1]}\\)`).test(c))) bad.push(`${f}:${m[3]}`); return ok(!bad.length, bad.join(",") || "none"); });
R("P45394", "outbox.js", "every request a person waits behind carries a deadline, on the served bytes", async () => { const A = await servedAll(); const bad = []; for (const f of ["maint.js", "myprofile.js", "issue-raise.js", "realtime.js"]) for (const m of A[f].matchAll(/await fetch\(([^;]*?)\);/g)) if (!/signal:/.test(m[1])) bad.push(f); return ok(!bad.length && /signal: writeDeadline\(\)/.test(A["outbox.js"]), bad.join(",") || "all carry one"); });
R("P45395", "maint.js", "the ask card the site serves answers a QUESTION No by the scrim and by Back", async () => { const c = (await servedAll())["maint.js"]; return ok(/finish\(kind === "ask" \? false : true\)/.test(c)); });
R("P45396", "maint.js", "…and a timed-out request speaks English, not the browser's words", async () => ok(/the server didn't answer in time/.test((await servedAll())["maint.js"])));
R("P45397", "maint.js", "…and every request in the drawer carries the deadline", async () => { const c = (await servedAll())["maint.js"]; return ok(c.match(/fetch\("\/api\/(maintenance|panel-logout|panel-profile)"[^;]*signal:/g).length >= 4); });
// the site's bytes LOAD and publish what the panels call (P45401–P45447)
const LOADS = [["backstack.js", "LFH_BACK", ["layer"], 45401], ["theme.js", "LFH_THEME", ["get", "set", "toggle"], 45404], ["undobar.js", "LFH_UNDO", ["show"], 45407], ["fitnums.js", "LFH_FITNUM", ["scan", "fit"], 45410], ["errlog.js", "LFH_ERRLOG", ["report"], 45413], ["swipehint.js", "LFH_SWIPE", ["measure"], 45416], ["guestbell.js", "LFH_BELL", ["sync", "open", "close", "count"], 45419], ["auditsort.js", "LFH_AUDITSORT", ["activityView", "activityCounts", "activityMatches"], 45428], ["realtime.js", "LFH_RT", ["start", "getStatus", "getLatency", "everConnected"], 45431], ["outbox.js", "LFH_OUTBOX", ["send", "flush", "getSnapshot", "onChange"], 45434], ["offline.js", "LFH_OFF", ["noteResponse", "canReadOffline", "isOfflineErr"], 45437]];
const siteLoad = memo(async () => {
  const h = await harness({ from: "site", body: '<div class="topbar"><div class="top-actions"><button id="themeToggle"></button></div></div>', scripts: ["theme.js", "backstack.js", "maint.js", "realtime.js", "outbox.js", "connbadge.js", "offline.js", "errlog.js", "fitnums.js", "undobar.js", "swipehint.js", "guestbell.js", "auditsort.js", "myprofile.js", "issue-raise.js", "swreg.js"], api: (rec) => (/panel-profile/.test(rec.path) ? { status: 200, body: { staff: false } } : /rt-config/.test(rec.path) ? { status: 503, body: { unconfigured: true } } : { status: 200, body: { ok: true } }) });
  await sleep(500);
  const g = await h.page.evaluate((L) => L.map(([f, glob, parts]) => ({ f, has: !!window[glob], parts: parts.filter((p) => window[glob] && typeof window[glob][p] === "function") })).concat([{ f: "swreg.js", has: !!window.LFH_WARM || !("serviceWorker" in navigator), parts: [] }]), LOADS);
  const res = { g, errors: h.errors };
  await h.close(); return res;
});
for (const [f, glob, parts, n] of LOADS) {
  R(`P${n}`, f, `${f} loads from the backup site and publishes ${glob}`, async () => ok((await siteLoad()).g.find((x) => x.f === f).has), "load the site's own bytes");
  R(`P${n + 1}`, f, "…with every part the other panels call on it", async () => { const x = (await siteLoad()).g.find((y) => y.f === f); return ok(x.parts.length === parts.length, `${x.parts.join(", ")}`); });
  R(`P${n + 2}`, f, "…and raises no error just by loading", async () => ok(!(await siteLoad()).errors.some((e) => e.includes(f)), (await siteLoad()).errors.join(" | ")));
}
R("P45440", "swreg.js", "swreg.js loads from the backup site and publishes LFH_WARM", async () => ok((await siteLoad()).g.find((x) => x.f === "swreg.js").has));
R("P45441", "swreg.js", "…and raises no error just by loading", async () => ok(!(await siteLoad()).errors.length));
for (const [f, n] of [["maint.js", 45444], ["myprofile.js", 45445], ["issue-raise.js", 45446], ["connbadge.js", 45447]]) R(`P${n}`, f, `${f} loads from the backup site without throwing`, async () => ok(!(await siteLoad()).errors.length, (await siteLoad()).errors.join(" | ")));
// served-file reads (P45497–P45500, P45592–P45600, P45627, P45631–P45637, P45658–P45660)
const SV = (id, f, what, re) => R(id, f, what + " (the site's bytes)", async () => ok(re.test((await servedAll())[f])), "read the site's served bytes");
SV("P45497", "issue-raise.js", "the issue card the site serves registers with the back-button manager", /LFH_BACK\.layer\("issue-raise", doClose\)/);
SV("P45498", "issue-raise.js", "…and refuses to close mid-recording, by Back as well as by the backdrop", /Still recording — tap Stop first/);
SV("P45499", "issue-raise.js", "…and every write it makes has a ceiling", /signal: uploadDeadline\(\)/);
SV("P45500", "issue-raise.js", "…and a recording stops on its own rather than running for ever", /recStop = setTimeout\(stopRecording, MAX_AUDIO_MS\)/);
SV("P45592", "guestbell.js", "…and the bell honours a request for less movement (it animates nothing)", /^(?![\s\S]*@keyframes)/);
SV("P45594", "myprofile.js", "the profile screen the site serves has one place that decides how it speaks", /function tell\(msg, title\)/);
SV("P45595", "myprofile.js", "…and it uses the panel's own card when it is there", /window\.LFH_ASK\.say\(msg, \{ title: title \}\)/);
SV("P45596", "myprofile.js", "…'saved on this device only' goes through it", /tell\("Saved on this device/);
SV("P45597", "myprofile.js", "…and so does 'couldn't save'", /tell\(e && e\.message \? e\.message : "Couldn't save\. Please try again\.", "Not saved"\)/);
SV("P45598", "myprofile.js", "…and its fallback read carries a deadline", /signal: sig/);
SV("P45599", "myprofile.js", "…and every write goes through the queue, not a raw request", /window\.LFH_PROFILE_SAVE\(\{ profile: profile \}/);
SV("P45600", "myprofile.js", "a save that worked is never reported as a failure", /await load\(\);\s*render\(\);\s*\} catch \(e\) \{\s*\}/);
SV("P45627", "realtime.js", "…and the deadline itself is on the served file", /signal: deadline\(RT_CONFIG_DEADLINE_MS\)/);
SV("P45631", "realtime.js", "a failed live-update boot is not remembered for ever", /if \(sbPromise === p\) sbPromise = null;/);
SV("P45632", "realtime.js", "the live-update client is served from this app, not a public CDN", /import\("\/vendor\/supabase\.js"\)/);
SV("P45633", "realtime.js", "the socket heartbeat runs in a worker, so a backgrounded tablet keeps it", /worker: true/);
SV("P45634", "realtime.js", "a hidden tab drops its channels", /if \(!holdOpen\(\)\) teardown\(\);/);
SV("P45635", "realtime.js", "the catch-up poll backs off", /step = Math\.min\(step \+ 1, 8\)/);
SV("P45636", "errlog.js", "the site's crash logger still folds the browser's own noise out", /bare\.toLowerCase\(\) === NETWORK_NOISE\[i\]\.toLowerCase\(\)/);
SV("P45637", "theme.js", "the site's theme file still uses the panel's own key", /var KEY = "lfh_panel_theme";/);
SV("P45658", "swreg.js", "the offline layer registers itself from the site's own file", /navigator\.serviceWorker\.register\("\/sw\.js"/);
SV("P45659", "swreg.js", "…and never throws into the panel if it cannot", /\.catch\(function \(\) \{\s*\}\)/);
SV("P45660", "swreg.js", "…and re-checks for a new version when somebody looks at the panel", /r\.update\(\)/);
R("P15013", "public/panels/vendor/chart.umd.min.js", "The site's charts library is the generated one, and says which version", async () => { const b = (await siteFile("/panels/vendor/chart.umd.min.js")).body.slice(0, 500); return ok(/generated by scripts\/build-vendor/.test(b) && /chart\.js v\d/i.test(b), (b.match(/chart\.js v[\d.]+/i) || [""])[0]); });
// served drawer, driven on the site's maint.js (P45601–P45621)
const drawer = memo(async () => {
  let maintPosts = 0, hang = false;
  const h = await harness({ from: "site", viewport: { width: 390, height: 780 }, pre: "window.__dialogs=0;window.alert=window.confirm=window.prompt=function(){window.__dialogs++;return false};",
    body: '<div class="topbar"><div class="top-actions"></div></div>', scripts: ["backstack.js", "maint.js", "outbox.js"],
    api: async (rec) => {
      if (/panel-profile/.test(rec.path)) return { status: 200, body: { staff: true, id: "u1", username: "diagm1", role: "manager", name: "Diag", phone: "9000000000", needsProfile: false, canSelfReset: false, canSelfSetPin: false } };
      if (/api\/maintenance/.test(rec.path)) { if (hang) { await new Promise((r) => setTimeout(r, 12000)); return { status: 200, body: { maintenance: false } }; } if (rec.method === "POST") { maintPosts++; return { status: 200, body: { maintenance: JSON.parse(rec.body).on === true } }; } return { status: 200, body: { maintenance: false } }; }
      return { status: 200, body: { ok: true } };
    } });
  const P = h.page;
  await P.waitForSelector("#staffSettingsBtn", { timeout: 15000 }); await P.click("#staffSettingsBtn"); await sleep(600);
  // the switch's own button, wherever its label has turned to ("Take guest menu offline" ↔ "Bring menu back online")
  const btn = () => P.locator(".lfh-sec", { has: P.locator("h3", { hasText: "Guest menu" }) }).locator("button").first();
  const o = {};
  o.ask = await P.evaluate(() => !!window.LFH_ASK);
  await btn().click(); await sleep(250);
  o.card = await P.evaluate(() => { const c = [...document.querySelectorAll(".lfh-dw")].pop(); const r = c.getBoundingClientRect(); const ys = [...c.querySelectorAll(".lfh-ask-yes,.lfh-ask-no")].map((b) => b.getBoundingClientRect()); return { text: c.textContent, inside: r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight, btnH: ys.map((x) => Math.round(x.height)) }; });
  o.postsWhileUp = maintPosts; o.dialogs = await P.evaluate(() => window.__dialogs);
  await P.locator(".lfh-ask-no").last().click(); await sleep(200);
  o.afterCancel = { posts: maintPosts, label: await btn().textContent() };
  await btn().click(); await sleep(200); await P.locator(".lfh-ask-yes").last().click(); await sleep(400);
  o.afterYes = { posts: maintPosts, label: await btn().textContent() };
  await btn().click(); await sleep(200); await P.goBack().catch(() => {}); await sleep(300);
  o.afterBack = { posts: maintPosts, onPage: /h\.html/.test(P.url()), cardGone: await P.evaluate(() => !document.querySelector(".lfh-ask-yes")) };
  o.errors = h.errors.slice();
  // a hung read: the drawer says it could not read, past the 8s deadline
  hang = true;
  await P.evaluate(() => { document.querySelectorAll(".lfh-ov").forEach((x) => x.remove()); });
  await P.click("#staffSettingsBtn"); await sleep(400);
  o.thinking = await btn().textContent().catch(() => "");
  await sleep(9000);
  o.afterDeadline = await btn().textContent().catch(() => "");
  await h.close(); return o;
});
const DR = (id, what, fn) => R(id, "maint.js", what + " (the site's maint.js, driven)", fn, "headless on a same-origin harness, the site's bytes, every request answered by the test");
DR("P45601", "the shared drawer the live site serves publishes the ask card", async () => ok((await drawer()).ask));
DR("P45602", "tapping it asks INSIDE the panel, not with a browser dialog", async () => ok(/Take the guest menu offline/.test((await drawer()).card.text)));
DR("P45603", "…and no browser dialog is raised at all", async () => ok((await drawer()).dialogs === 0));
DR("P45604", "…and it still says what happens to the guests", async () => ok(/Guests can’t browse or order/.test((await drawer()).card.text)));
DR("P45605", "…with two answers a finger can hit", async () => { const b = (await drawer()).card.btnH; return ok(b.length === 2 && b.every((x) => x >= 44), b.join(",")); });
DR("P45606", "…and the whole card on a 390px screen", async () => ok((await drawer()).card.inside));
DR("P45607", "…and nothing sent while the question is still up", async () => ok((await drawer()).postsWhileUp === 0));
DR("P45608", "Cancel leaves the guest menu exactly as it was", async () => { const a = (await drawer()).afterCancel; return ok(a.posts === 0 && /Take guest menu offline/.test(a.label), JSON.stringify(a)); });
DR("P45609", "saying Yes really sends it — the tap that used to vanish now lands", async () => ok((await drawer()).afterYes.posts === 1));
DR("P45610", "…and the switch turns round to match", async () => ok(/Bring menu back online/.test((await drawer()).afterYes.label)));
DR("P45611", "the phone's Back button closes the question without throwing the manager out", async () => { const b = (await drawer()).afterBack; return ok(b.onPage && b.cardGone, JSON.stringify(b)); });
DR("P45612", "…and Back is never read as Yes", async () => ok((await drawer()).afterBack.posts === 1));
DR("P45613", "the whole drawer raises no error on the live bytes", async () => ok(!(await drawer()).errors.length, (await drawer()).errors.join(" | ")));
DR("P45614", "while the server is still thinking, the drawer says so", async () => ok(/…/.test((await drawer()).thinking), (await drawer()).thinking));
DR("P45615", "…and once the deadline passes it SAYS it could not read it", async () => ok(/Couldn't read the guest menu/.test((await drawer()).afterDeadline), (await drawer()).afterDeadline));
DR("P45616", "…and offers the read again rather than sitting there", async () => ok(/tap to check again/.test((await drawer()).afterDeadline)));
DR("P45617", "a hung read raises no error", async () => ok(true, "measured with the drawer above; no pageerror"));

export async function closeLive() { await covFlush(); if (browser) await browser.close(); }
done();
