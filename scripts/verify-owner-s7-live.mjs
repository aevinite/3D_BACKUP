// verify-owner-s7-live.mjs — the SWEEP #7 driven checks for the owner's Settings / Team screens.
//
//   npm run verify:owner-s7-live -- --base http://localhost:4213
//
// P21401–P21600. The static half is scripts/verify-owner-territory-s7.mjs (P21101–P21400).
//
// WHAT THIS COVERS THAT NOTHING ELSE DOES (T13, sweep #7, 2026-08-27)
// The **Kitchen printing card** on /owner/settings did not exist when the 500 phases of P06001–P06500
// were written, so it has never been driven or looked at once. Most of this file is that card: every
// state it can be in, in both skins, at 1280 and at 360.
//
// THE RULES IT RUNS BY, each learned by getting it wrong in an earlier pass:
//   · Wait for a CONDITION, never a clock.
//   · Assert the RENDERED thing — visible text, a measured colour, a measured box — never the source.
//   · A forced state is produced by answering this browser's own request differently. That is reading
//     our own screen against a server answer we control, the way the existing live guard already
//     forces a 403 or a tableCount of 0. Nothing is written to the database by this file at all.
//   · Every colour is COMPUTED against what is actually painted behind it, never eyeballed.
import { requireUp } from "./sweep/appUp.mjs";

const arg = (n) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : null; };
const BASE = arg("--base") || process.env.LFH_BASE || "http://localhost:4000";
await requireUp(BASE);

let pass = 0, fail = 0, skip = 0; const fails = [];
const P = (id, m, c, n = "") => {
  if (c) { pass++; console.log(`  ✅ ${id} ${m}`); }
  else { fail++; fails.push(`${id} ${m}${n ? ` — ${n}` : ""}`); console.log(`  ❌ ${id} ${m}${n ? ` — ${n}` : ""}`); }
};
const S = (id, m, why) => { skip++; console.log(`  ⏭ ${id} ${m} — ${why}`); };
const lum = (r, g, b) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const cr = (a, b) => { const L1 = lum(...a), L2 = lum(...b); return (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05); };
const rgb = (s) => (s.match(/\d+/g) || [0, 0, 0]).slice(0, 3).map(Number);
// The ink and what is REALLY painted behind it — walk up until a parent has a non-transparent
// background, because a card's own background is usually transparent and comparing against that
// measures nothing. A real function, not a string: `evaluate("el=>…")` evaluates the string as an
// expression and never calls it, which returned undefined and stopped this file 11 checks in.
const INK = (el) => {
  let n = el, bg = "rgba(0, 0, 0, 0)";
  while (n && bg === "rgba(0, 0, 0, 0)") { bg = getComputedStyle(n).backgroundColor; n = n.parentElement; }
  return { c: getComputedStyle(el).color, b: bg };
};

const { chromium } = await import("playwright");
const { loginAs } = await import("./sweep/login.mjs");
const br = await chromium.launch();
// SERVICE WORKERS OFF, DELIBERATELY (T13, 2026-08-27 — this cost an hour).
// `public/sw.js` caches `/^\/api\/owner\//` so the owner console opens from a saved copy offline.
// That also means the SECOND page opened in a context is served BY THE WORKER, and a page-level
// route handler never sees the request: eleven checks below reported a roster with no disabled
// group when the forced answer had simply never been delivered (the handler fired 0 times). It
// also makes a request count meaningless, because a cached read is not a request.
// Blocking the worker is the right tool here — every check in this file is about what the PAGE
// asks for and what it then draws. The offline behaviour itself is T4's territory and has its own
// guards; this file must not be measuring it by accident.
const mk = async (vp, skin) => {
  const c = await br.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: vp.d || 1, serviceWorkers: "block" });
  c.setDefaultNavigationTimeout(150000); c.setDefaultTimeout(60000);
  await loginAs(c, "owner", BASE);
  if (skin) await c.addCookies([{ name: "aevidine_skin", value: skin, url: BASE }]);
  return c;
};
const DESK = { w: 1280, h: 900 }, A35 = { w: 360, h: 780, d: 3 };

console.log(`Sweep #7 — the owner's new ground, driven — ${BASE}\n`);
try {

// ══ H1 · THE KITCHEN PRINTING CARD, ON SCREEN (P21401–P21480) ════════════════════════════════
console.log("H1 · the Kitchen printing card, in both skins and at both widths (P21401–P21480)");
{
  // Does this restaurant even have printing on? Everything below depends on that answer, and saying
  // so out loud is what stops a whole band quietly skipping and looking like a pass.
  const probe = await mk(DESK);
  const pp = await probe.newPage();
  await pp.goto(`${BASE}/owner/settings`, { waitUntil: "networkidle" });
  const answers = await pp.evaluate(async () => ({
    set: await (await fetch("/api/owner/settings", { cache: "no-store" })).json(),
    pr: await (await fetch("/api/owner/printing", { cache: "no-store" })).json(),
  }));
  const hasCard = !!(answers.set.printing && answers.set.printing.length);
  P("P21401", "the server tells this page whether printing is on, per restaurant", Array.isArray(answers.set.printing));
  P("P21402", "…and the live read answers the same restaurant's question", typeof answers.pr.allowed === "boolean");
  P("P21403", "the card is on screen exactly when the server listed a restaurant",
    (await pp.locator("text=Kitchen printing").count() > 0) === hasCard);
  await probe.close();

  if (!hasCard) {
    for (let i = 21404; i <= 21460; i++) S(`P${i}`, "printing card state", "this restaurant has printing switched off — the card correctly does not render (R36)");
  } else {
    for (const [vp, tag] of [[DESK, "desk"], [A35, "a35"]]) {
      for (const skin of ["dark", "light"]) {
        const ctx = await mk(vp, skin);
        const p = await ctx.newPage();
        await p.addInitScript((s) => { try { localStorage.setItem("aevidine_skin", s); } catch {} }, skin);
        await p.goto(`${BASE}/owner/settings`, { waitUntil: "networkidle" });
        await p.waitForSelector("text=Kitchen printing", { timeout: 30000 });
        const card = p.locator(".adm-card").filter({ hasText: "Kitchen printing" }).first();
        const base = tag === "desk" ? (skin === "dark" ? 21404 : 21418) : (skin === "dark" ? 21432 : 21446);
        const t = (await card.innerText()).replace(/\s+/g, " ");

        P(`P${base + 0}`, `the card renders with a heading (${tag}/${skin})`, /Kitchen printing/.test(t));
        P(`P${base + 1}`, `…and names this restaurant, not a placeholder (${tag}/${skin})`, !/This restaurant/.test(t) || /My Little/.test(t));
        P(`P${base + 2}`, `…and says where the tickets print (${tag}/${skin})`, /tickets print on/.test(t));
        P(`P${base + 3}`, `…and answers "where is my paper coming out" (${tag}/${skin})`, /Where your paper comes out right now/.test(t));
        P(`P${base + 4}`, `…and says whether anything is waiting (${tag}/${skin})`, /waiting to print/.test(t));
        P(`P${base + 5}`, `no code text leaks onto the card (${tag}/${skin})`,
          !/\$\{|\[object Object\]|undefined|NaN|-->/.test(t), t.slice(0, 90));
        P(`P${base + 6}`, `nothing on the card is cut off sideways (${tag}/${skin})`,
          await card.evaluate((el) => el.scrollWidth <= el.clientWidth + 1));
        {
          const h = await card.locator(".adm-section-h").first().evaluate(INK);
          P(`P${base + 7}`, `the heading clears 4.5:1 (${tag}/${skin})`, cr(rgb(h.c), rgb(h.b)) >= 4.5, `${cr(rgb(h.c), rgb(h.b)).toFixed(2)}:1`);
        }
        {
          const b = card.locator("a.adm-btn").first();
          const v = await b.evaluate(INK);
          P(`P${base + 8}`, `the guide button's label clears 4.5:1 (${tag}/${skin})`, cr(rgb(v.c), rgb(v.b)) >= 4.5, `${cr(rgb(v.c), rgb(v.b)).toFixed(2)}:1`);
          const box = await b.boundingBox();
          P(`P${base + 9}`, `…and it is a real tap target, 30px or more (${tag}/${skin})`, box.height >= 30, `${Math.round(box.height)}px`);
          const gap = await b.evaluate((el) => {
            const i = el.querySelector("i"); if (!i) return 99;
            const tn = [...el.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim());
            const rg = document.createRange(); rg.selectNodeContents(tn);
            return Math.round(rg.getBoundingClientRect().left - i.getBoundingClientRect().right);
          });
          P(`P${base + 10}`, `…and its icon does not touch its first letter (${tag}/${skin})`, gap >= 4, `${gap}px`);
        }
        {
          const links = await card.locator("a.adm-btn").all();
          P(`P${base + 11}`, `all four ways into the guide are on the card (${tag}/${skin})`, links.length === 4, `${links.length}`);
          const hrefs = await Promise.all(links.map((l) => l.getAttribute("href")));
          P(`P${base + 12}`, `…and every one of them opens the guide page (${tag}/${skin})`, hrefs.every((h) => h.startsWith("/print-setup.html")));
          const tgts = await Promise.all(links.map((l) => l.getAttribute("target")));
          P(`P${base + 13}`, `…each in its own tab, so the owner keeps their place (${tag}/${skin})`, tgts.every((x) => x === "_blank"));
        }
        await ctx.close();
      }
    }
    // ── forced states: what the owner sees when the answer is different ──────────────────────
    const force = async (patch, fn) => {
      const ctx = await mk(DESK, "dark"); const p = await ctx.newPage();
      await p.route("**/api/owner/printing*", async (route) => {
        const r = await route.fetch(); const j = await r.json();
        await route.fulfill({ response: r, json: { ...j, ...patch } });
      });
      await p.goto(`${BASE}/owner/settings`, { waitUntil: "networkidle" });
      await p.waitForSelector("text=Kitchen printing", { timeout: 30000 });
      await p.waitForTimeout(400);
      const card = p.locator(".adm-card").filter({ hasText: "Kitchen printing" }).first();
      await fn((await card.innerText()).replace(/\s+/g, " "), card, p);
      await ctx.close();
    };
    await force({ allowed: false }, (t) => {
      P("P21460", "with the live read not allowed, the sub-card vanishes and nothing hints at it",
        !/Where your paper comes out right now/.test(t) && !/not allowed|switched off for/i.test(t));
      P("P21461", "…and the per-restaurant row is still there, so the page is not half-empty", /tickets print on/.test(t));
    });
    await force({ computers: [], routes: [] }, (t) => {
      P("P21462", "with no computer set up, it says a screen has to do it", /so a screen has to do it/.test(t));
      P("P21463", "…and tells the owner the one thing that changes that", /Ask us to set one up/.test(t));
      P("P21464", "…and lists no printer rows at all, rather than an empty table", !/Kitchen slips/.test(t));
    });
    await force({
      computers: [{ name: "Counter PC", connected: true, secondsAgo: 3, printers: ["EPSON TM-T82"] }],
      routes: [{ kind: "kot", printer: "EPSON TM-T82", computer: "Counter PC", connected: true }],
    }, (t) => {
      P("P21465", "with a computer awake, it says no screen is needed", /no screen needed/.test(t));
      P("P21466", "…and names the printer the kitchen slips go to", /EPSON TM-T82/.test(t));
      P("P21467", "…and the computer doing it", /Counter PC/.test(t));
      P("P21468", "…and says it is ready, with how long ago it was seen", /ready · seen 3s ago/.test(t));
      P("P21469", "…and calls the paper by its English name, not its code", /Kitchen slips/.test(t) && !/\bkot\b/.test(t));
    });
    await force({
      computers: [{ name: "Counter PC", connected: false, secondsAgo: 900, printers: ["EPSON TM-T82"] }],
      routes: [{ kind: "kot", printer: "EPSON TM-T82", computer: "Counter PC", connected: false }],
    }, (t) => {
      P("P21470", "with the computer asleep, it says so in the row", /asleep, tickets waiting/.test(t));
      P("P21471", "…and gives a human age, not raw seconds", /15 min ago/.test(t));
      P("P21472", "…and marks the route as waiting too", /asleep — waiting/.test(t));
      P("P21473", "…and never claims it is ready", !/ready ·/.test(t));
    });
    await force({ computers: [{ name: "Old PC", connected: false, secondsAgo: null, printers: [] }] }, (t) => {
      P("P21474", "a computer that has never checked in says exactly that", /has never checked in/.test(t));
      P("P21475", "…rather than \"0s ago\", which would be a lie", !/seen 0s ago/.test(t));
      P("P21476", "…and no printer list is drawn for it", !/Old PC ·/.test(t));
    });
    await force({ waiting: 1 }, (t) => P("P21477", "one waiting thing is described in the singular", /1 thing is waiting to print/.test(t)));
    await force({ waiting: 7 }, (t) => P("P21478", "several are described in the plural", /7 things are waiting to print/.test(t)));
    await force({ on: false, waiting: 3 }, (t) => {
      P("P21479", "with automatic printing off, it says so AND reassures nothing is lost", /switched off at the moment/.test(t) && /nothing is lost/.test(t));
      P("P21480", "…and still gives the count, so the two facts are not in conflict", /3 things are waiting to print/.test(t));
    });
  }
}

// ══ H2 · THE ROSTER'S SEARCH AND ITS TWO GROUPS (P21481–P21520) ══════════════════════════════
console.log("\nH2 · finding a person, driven (P21481–P21520)");
{
  const ctx = await mk(DESK, "dark"); const p = await ctx.newPage();
  await p.goto(`${BASE}/owner/staff`, { waitUntil: "networkidle" });
  await p.waitForSelector(".ost-row", { timeout: 30000 });
  const find = p.locator(".ost-find input").first();
  const rows = () => p.locator(".ost-row").count();
  const before = await rows();
  P("P21481", "the search box is on the tab strip", await find.count() > 0);
  P("P21482", "…and it is a search field, so a phone shows the right keyboard", await find.getAttribute("type") === "search");
  P("P21483", "…with a label for a screen reader", !!(await find.getAttribute("aria-label")));
  P("P21484", "…and a placeholder that says what it matches", /name, phone or role/.test(await find.getAttribute("placeholder") || ""));
  P("P21485", "there is no clear button until something is typed", await p.locator(".ost-find .ost-x").count() === 0);
  const first = (await p.locator(".ost-row .ost-pn").first().innerText()).trim();
  await find.fill(first);
  await p.waitForFunction((n) => document.querySelectorAll(".ost-row").length < n, before, { timeout: 10000 }).catch(() => {});
  P("P21486", "typing a name narrows the list", await rows() < before, `${await rows()} of ${before}`);
  P("P21487", "…and the person searched for is still on screen", await p.locator(`.ost-row .ost-pn:text-is("${first}")`).count() > 0);
  P("P21488", "…and the clear button appears", await p.locator(".ost-find .ost-x").count() > 0);
  P("P21489", "…and the card header says how many of how many", /\d+ of \d+ shown/.test(await p.locator(".ost-head").first().innerText()));
  await find.fill(first.toUpperCase());
  await p.waitForTimeout(250);
  P("P21490", "the match ignores capitals", await p.locator(`.ost-row .ost-pn:text-is("${first}")`).count() > 0);
  await find.fill(`  ${first}  `);
  await p.waitForTimeout(250);
  P("P21491", "…and stray spaces", await p.locator(`.ost-row .ost-pn:text-is("${first}")`).count() > 0);
  await find.fill("waiter");
  await p.waitForTimeout(250);
  const waiterRows = await p.locator('.ost-rolebadge[data-role="tablet"]').count();
  P("P21492", "searching the word the badge SHOWS finds a waiter", waiterRows > 0 || await p.locator(".adm-empty").count() > 0);
  await find.fill("zzz-nobody-by-this-name");
  await p.waitForFunction(() => document.querySelectorAll(".ost-row").length === 0, null, { timeout: 10000 }).catch(() => {});
  const empty = (await p.locator(".adm-empty").first().innerText()).replace(/\s+/g, " ");
  P("P21493", "no match says so, naming what was typed", /Nobody here matches/.test(empty) && /zzz-nobody/.test(empty));
  P("P21494", "…and never says \"No staff yet\", which would be false", !/No staff yet/.test(empty));
  P("P21495", "…and the header still states the real total", /0 of \d+ shown/.test(await p.locator(".ost-head").first().innerText()));
  await p.locator(".ost-find .ost-x").first().click();
  await p.waitForFunction((n) => document.querySelectorAll(".ost-row").length === n, before, { timeout: 10000 }).catch(() => {});
  P("P21496", "clearing brings every row back", await rows() === before, `${await rows()} vs ${before}`);
  P("P21497", "…and the clear button goes away again", await p.locator(".ost-find .ost-x").count() === 0);
  P("P21498", "…and the header goes back to the plain count", /\d+ staff/.test(await p.locator(".ost-head").first().innerText()));
  const reqs = [];
  p.on("request", (rq) => { if (rq.url().includes("/api/owner/staff")) reqs.push(rq.url()); });
  await find.type("abcdef", { delay: 40 });
  await p.waitForTimeout(900);
  P("P21499", "typing fetches nothing at all — it filters the list already on screen", reqs.length === 0, `${reqs.length} request(s)`);
  await find.fill("");
  await p.waitForTimeout(300);

  // forced: a roster with one working and one disabled person, so the grouping can be read
  const p2 = await ctx.newPage();
  await p2.route("**/api/owner/staff*", async (route) => {
    const r = await route.fetch(); const j = await r.json();
    if (Array.isArray(j.staff) && j.staff.length >= 2) {
      j.staff = j.staff.slice(0, 2).map((s, i) => ({ ...s, active: i === 0, name: i === 0 ? "ZZ Working" : "ZZ Sleeping" }));
    }
    await route.fulfill({ response: r, json: j });
  });
  await p2.goto(`${BASE}/owner/staff`, { waitUntil: "networkidle" });
  await p2.waitForSelector(".ost-row", { timeout: 30000 });
  const heads = async () => (await p2.locator(".ost-section-t").allInnerTexts()).map((x) => x.replace(/\s+/g, " ").trim());
  P("P21500", "working people and disabled people are under separate headings", (await heads()).length === 2);
  P("P21501", "…the working group first", (await heads())[0] === "Team");
  P("P21502", "…and the disabled group states its count", /Disabled · 1/.test((await heads())[1]));
  P("P21503", "…and says what disabled means", /cannot sign in/.test((await heads())[1]));
  P("P21504", "the disabled row is dimmed", await p2.locator(".ost-row.off").count() === 1);
  P("P21505", "…and carries the word too, never colour alone", await p2.locator(".ost-disabled").count() === 1);
  P("P21506", "…and still offers Enable in one tap", await p2.locator('.ost-row.off button:text-is("Enable")').count() === 1);
  P("P21507", "the working row does not", await p2.locator('.ost-row:not(.off) button:text-is("Enable")').count() === 0);
  const f2 = p2.locator(".ost-find input").first();
  await f2.fill("Sleeping");
  await p2.waitForTimeout(350);
  const teamBlock = p2.locator(".ost-team").first();
  P("P21508", "searching only a disabled person leaves no row under the Team heading", await teamBlock.locator(".ost-row").count() === 0);
  const gap = (await teamBlock.innerText()).replace(/\s+/g, " ").trim();
  P("P21509", "…and the gap explains it instead of being blank", gap.length > 0, JSON.stringify(gap));
  P("P21510", "…saying the match cannot sign in", /cannot sign in/.test(gap));
  P("P21511", "…and naming what was typed", /Sleeping/.test(gap));
  P("P21512", "…while the match itself is still shown below", await p2.locator(".ost-row.off").count() === 1);
  P("P21513", "…and the header confirms one of two is shown", /1 of 2 shown/.test(await p2.locator(".ost-head").first().innerText()));
  await f2.fill("Working");
  await p2.waitForTimeout(350);
  P("P21514", "searching only a working person hides the disabled heading entirely", (await heads()).length === 1);
  P("P21515", "…and shows the working row", await p2.locator(".ost-row:not(.off)").count() === 1);
  P("P21516", "…with no empty-gap sentence, because the group is not empty", !/cannot sign in/.test((await p2.locator(".ost-team").first().innerText())));
  await f2.fill("");
  await p2.waitForTimeout(350);
  P("P21517", "clearing restores both groups", (await heads()).length === 2);
  P("P21518", "the Add form is still usable with a search on", await p2.locator("form.ost-add").count() > 0);
  await f2.fill("ZZ");
  await p2.waitForTimeout(300);
  P("P21519", "…and stays usable, so somebody can be added mid-search", await p2.locator('form.ost-add button[type="submit"]').count() > 0);
  P("P21520", "a search matching both groups keeps both headings", (await heads()).length === 2);
  await ctx.close();
}

// ══ H3 · WHAT THESE SCREENS COST WHILE THEY SIT OPEN (P21521–P21550) ═════════════════════════
console.log("\nH3 · what each screen costs while it sits open (P21521–P21550)");
{
  const count = async (path, ms, hide) => {
    const ctx = await mk(DESK, "dark"); const p = await ctx.newPage();
    const hits = {};
    p.on("request", (rq) => { const u = new URL(rq.url()).pathname; if (u.startsWith("/api/")) hits[u] = (hits[u] || 0) + 1; });
    await p.goto(BASE + path, { waitUntil: "networkidle" });
    await p.waitForTimeout(1200);
    const onLoad = JSON.parse(JSON.stringify(hits));
    if (hide) await p.evaluate(() => {
      Object.defineProperty(document, "hidden", { get: () => true, configurable: true });
      Object.defineProperty(document, "visibilityState", { get: () => "hidden", configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    for (const k of Object.keys(hits)) delete hits[k];
    await p.waitForTimeout(ms);
    const after = JSON.parse(JSON.stringify(hits));
    await ctx.close();
    return { onLoad, after };
  };
  const staff = await count("/owner/staff", 20000, false);
  P("P21521", "opening the Team roster costs ONE call to its own endpoint", (staff.onLoad["/api/owner/staff"] || 0) === 1, JSON.stringify(staff.onLoad));
  P("P21522", "…and it asks for nothing again while it just sits there", (staff.after["/api/owner/staff"] || 0) === 0, JSON.stringify(staff.after));
  P("P21523", "…and starts no other data poll either", Object.keys(staff.after).filter((k) => k.startsWith("/api/owner")).length === 0, JSON.stringify(staff.after));
  const menu = await count("/owner/menu", 20000, false);
  P("P21524", "the Menu page starts no poll of its own", Object.keys(menu.after).filter((k) => k.startsWith("/api/owner")).length === 0, JSON.stringify(menu.after));
  const setV = await count("/owner/settings", 40000, false);
  P("P21525", "opening Settings costs ONE call for the page itself", (setV.onLoad["/api/owner/settings"] || 0) === 1, JSON.stringify(setV.onLoad));
  P("P21526", "…and the page itself is not re-read on a timer", (setV.after["/api/owner/settings"] || 0) === 0, JSON.stringify(setV.after));
  const printVisible = setV.after["/api/owner/printing"] || 0;
  P("P21527", "the printing card does keep itself current while you are looking at it", printVisible > 0, `${printVisible} in 40s`);
  P("P21528", "…but not faster than its own truth window (under 30s of staleness)", printVisible <= 4, `${printVisible} in 40s`);
  const setH = await count("/owner/settings", 40000, true);
  P("P21529", "…and it STOPS the moment the tab is hidden", (setH.after["/api/owner/printing"] || 0) === 0, `${setH.after["/api/owner/printing"] || 0} in 40s hidden`);
  P("P21530", "…and nothing else on Settings keeps asking either", Object.keys(setH.after).filter((k) => k.startsWith("/api/owner")).length === 0, JSON.stringify(setH.after));
  // navigating away must not leave a timer behind
  {
    const ctx = await mk(DESK, "dark"); const p = await ctx.newPage();
    await p.goto(`${BASE}/owner/settings`, { waitUntil: "networkidle" });
    await p.waitForTimeout(1500);
    const hits = [];
    p.on("request", (rq) => { if (rq.url().includes("/api/owner/printing")) hits.push(1); });
    await p.goto(`${BASE}/owner/staff`, { waitUntil: "networkidle" });
    await p.waitForTimeout(35000);
    P("P21531", "leaving Settings for the roster stops the printing refresh dead", hits.length === 0, `${hits.length} after navigating away`);
    await ctx.close();
  }
  // The owner SHELL reads its own overview on every page — that is the sidebar, not this screen,
  // and counting it as the roster's cost reported a fault that is not one. Assert the roster's own
  // endpoint instead, and that the shell asks for its overview exactly once too.
  const person = await count("/owner/staff", 3000, false);
  P("P21532", "the roster's first paint asks its own endpoint once and no more",
    (person.onLoad["/api/owner/staff"] || 0) === 1 && (person.onLoad["/api/owner/overview"] || 0) <= 1, JSON.stringify(person.onLoad));
  // ── the printing refresh must COME BACK when the owner comes back ──────────────────────────
  {
    const ctx = await mk(DESK, "dark"); const p = await ctx.newPage();
    await p.goto(`${BASE}/owner/settings`, { waitUntil: "networkidle" });
    await p.waitForTimeout(1500);
    const hidden = [];
    p.on("request", (rq) => { if (rq.url().includes("/api/owner/printing")) hidden.push(Date.now()); });
    await p.evaluate(() => {
      Object.defineProperty(document, "hidden", { get: () => true, configurable: true });
      Object.defineProperty(document, "visibilityState", { get: () => "hidden", configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await p.waitForTimeout(20000);
    const whileHidden = hidden.length;
    await p.evaluate(() => {
      Object.defineProperty(document, "hidden", { get: () => false, configurable: true });
      Object.defineProperty(document, "visibilityState", { get: () => "visible", configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await p.waitForTimeout(2500);
    const afterReturn = hidden.length - whileHidden;
    P("P21533", "hiding the tab stops the printing refresh", whileHidden === 0, `${whileHidden} while hidden`);
    P("P21534", "…and coming back refreshes it at once, so the first thing seen is current", afterReturn >= 1, `${afterReturn} on return`);
    await p.waitForTimeout(18000);
    P("P21535", "…and the repeat is running again, not left stopped", hidden.length - whileHidden - afterReturn >= 1);
    await ctx.close();
  }
  // ── the roster only asks again when it is TOLD to ────────────────────────────────────────
  {
    const ctx = await mk(DESK, "dark"); const p = await ctx.newPage();
    await p.goto(`${BASE}/owner/staff`, { waitUntil: "networkidle" });
    await p.waitForSelector(".ost-row", { timeout: 30000 });
    const hits = [];
    p.on("request", (rq) => { if (new URL(rq.url()).pathname === "/api/owner/staff") hits.push(rq.method()); });
    await p.locator(".ost-find input").first().fill("a");
    await p.waitForTimeout(600);
    P("P21536", "searching asks the server for nothing", hits.length === 0, JSON.stringify(hits));
    await p.locator(".ost-find input").first().fill("");
    await p.locator('.ost-row button:text-is("Rename / edit phone")').first().click();
    await p.waitForTimeout(500);
    P("P21537", "opening the rename editor asks for nothing either", hits.length === 0, JSON.stringify(hits));
    await p.locator('.ost-editrow button:text-is("Cancel")').first().click();
    await p.waitForTimeout(400);
    P("P21538", "…and cancelling it sends nothing", hits.length === 0, JSON.stringify(hits));
    P("P21539", "…and the editor really closed", await p.locator(".ost-editrow").count() === 0);
    await ctx.close();
  }
  // ── the Menu page: one embed, and no history entry to swallow the phone's Back ──────────
  {
    const ctx = await mk(DESK, "dark"); const p = await ctx.newPage();
    await p.goto(`${BASE}/owner`, { waitUntil: "networkidle" });
    const before = await p.evaluate(() => history.length);
    await p.goto(`${BASE}/owner/menu`, { waitUntil: "networkidle" });
    await p.waitForTimeout(2500);
    const frames = await p.locator("iframe").count();
    P("P21540", "the Menu page mounts exactly one editor frame", frames === 1, `${frames}`);
    P("P21541", "…pointed at the shared editor, in menu-only mode",
      /\/panels\/editor\/index\.html\?rid=[^&]+&menuonly=1/.test(await p.locator("iframe").first().getAttribute("src") || ""));
    P("P21542", "…carrying the skin it was born with", /skin=(dark|light)/.test(await p.locator("iframe").first().getAttribute("src") || ""));
    const after = await p.evaluate(() => history.length);
    P("P21543", "…and mounting it adds no extra history entry beyond the page itself", after - before <= 1, `${before} → ${after}`);
    P("P21544", "the editor fills the content area rather than sitting in a box", await p.locator(".ome-full").count() === 1);
    P("P21545", "a single-restaurant owner is shown no restaurant picker", await p.locator(".ome-switch").count() === 0);
    await ctx.close();
  }
  // ── the skin: one writer, and it reaches everything it should ────────────────────────────
  {
    const ctx = await mk(DESK, "dark"); const p = await ctx.newPage();
    await p.goto(`${BASE}/owner/settings`, { waitUntil: "networkidle" });
    const startKeys = await p.evaluate(() => ({ theme: localStorage.getItem("lfh_theme"), panel: localStorage.getItem("lfh_panel_theme") }));
    await p.locator('button[aria-pressed]').filter({ hasText: "Light" }).first().click();
    await p.waitForLoadState("networkidle");
    await p.waitForTimeout(800);
    const state = await p.evaluate(() => ({
      ls: localStorage.getItem("aevidine_skin"),
      cookie: /aevidine_skin=light/.test(document.cookie),
      attr: document.querySelector(".adm")?.getAttribute("data-skin") ?? document.documentElement.getAttribute("data-skin"),
      theme: localStorage.getItem("lfh_theme"), panel: localStorage.getItem("lfh_panel_theme"),
    }));
    P("P21546", "choosing Light writes the console skin key", state.ls === "light", String(state.ls));
    P("P21547", "…and the cookie the server reads, so the next load paints right first time", state.cookie);
    P("P21548", "…and the panel really repaints", state.attr !== "dark", String(state.attr));
    P("P21549", "…and it does NOT touch the guest menu's theme", state.theme === startKeys.theme);
    P("P21550", "…or the staff panels' theme", state.panel === startKeys.panel);
    // put it back, in the same run
    await p.evaluate(() => { try { localStorage.setItem("aevidine_skin", "dark"); document.cookie = "aevidine_skin=dark; path=/; max-age=31536000; samesite=lax"; } catch {} });
    await ctx.close();
  }
}

// ══ H4 · DOES IT AGREE WITH THE REST OF THE PRODUCT (P21551–P21580) ══════════════════════════
console.log("\nH4 · does the owner's answer agree with everyone else's (P21551–P21580)");
{
  const ctx = await mk(DESK, "dark"); const p = await ctx.newPage();
  await p.goto(`${BASE}/owner/settings`, { waitUntil: "networkidle" });
  const j = await p.evaluate(async () => ({
    set: await (await fetch("/api/owner/settings", { cache: "no-store" })).json(),
    pr: await (await fetch("/api/owner/printing", { cache: "no-store" })).json(),
  }));
  P("P21551", "the owner's own settings answer names the restaurants they hold", Array.isArray(j.set.restaurants));
  P("P21552", "…and the What's enabled card lists one chip per section that is ON",
    await p.locator(".adm-card").filter({ hasText: "What's enabled" }).locator(".adm-chip").count() > 0);
  P("P21553", "…and shows no cross, no count and no off-state anywhere (R36)",
    !/✗|✕|not enabled|switched off/i.test(await p.locator(".adm-card").filter({ hasText: "What's enabled" }).innerText()));
  const chips = (await p.locator(".adm-card").filter({ hasText: "What's enabled" }).locator(".adm-chip").allInnerTexts()).map((x) => x.trim());
  const nav = (await p.locator(".owx-navlink, nav a").allInnerTexts()).map((x) => x.replace(/\s+/g, " ").trim());
  // The chips are uppercased by the stylesheet, the sidebar labels are not — comparing the two
  // literally reported a disagreement that only exists in letter case.
  const norm = (x) => x.toLowerCase().replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
  // NOT EVERY SECTION IS A SIDEBAR ITEM, and that is correct (checked 2026-08-27, do not re-file).
  // "Guest ratings" is a real owner section — `ratings` in OWNER_SECTION_KEYS — but it is reached as
  // a TAB inside Feedback & complaints (app/owner/issues/page.tsx), not as its own nav row.
  // EXPECTATION MOVED 2026-09-01, same id, same claim: the owner asked for that chip to SAY where it
  // lives, so it now reads "Guest ratings — in Feedback & complaints". The chip therefore CONTAINS
  // the nav label rather than matching it, and the hard-coded special case this check used to carry
  // is gone — a chip that names its own home needs no lookup table to be judged reachable.
  const reachable = (c) => nav.some((n) => norm(n).includes(norm(c)) || norm(c).includes(norm(n)));
  P("P21554", "every chip names a section the owner can actually reach",
    nav.length === 0 || chips.every(reachable), `chips=${chips.join("|")} nav=${nav.join("|")}`);
  P("P21555", "…and the two never contradict each other about a section he HAS", chips.length > 0);
  if (j.pr.allowed) {
    P("P21556", "the printing answer names a real restaurant of this owner's", true);
    P("P21557", "…and the two reads agree that printing is on here", j.set.printing.length > 0);
    P("P21558", "…and every route it lists actually has a printer", (j.pr.routes || []).every((r) => !!r.printer));
    P("P21559", "…and every route's kind has an English word on the card", (j.pr.routes || []).every((r) => ["kot", "bill", "banquet", "label", "test"].includes(r.kind)));
    P("P21560", "…and no route names a computer that is not in the computer list",
      (j.pr.routes || []).every((r) => !r.computer || (j.pr.computers || []).some((c) => c.name === r.computer)));
    P("P21561", "…and the waiting count is a number, never null", typeof j.pr.waiting === "number");
    P("P21562", "…and it is never negative", (j.pr.waiting ?? 0) >= 0);
    P("P21563", "…and every computer says whether it is connected", (j.pr.computers || []).every((c) => typeof c.connected === "boolean"));
    P("P21564", "…and a connected one has a real age", (j.pr.computers || []).every((c) => !c.connected || typeof c.secondsAgo === "number"));
    P("P21565", "…and the answer carries no id, key or fingerprint", !/fingerprint|token|secret/i.test(JSON.stringify(j.pr)));
  } else {
    for (let i = 21556; i <= 21565; i++) S(`P${i}`, "printing agreement", "printing is not allowed for this restaurant, so there is nothing to agree about");
  }
  // the roster's people, traced to the two other lists that must show them
  const roster = await p.evaluate(async () => (await (await fetch("/api/owner/staff", { cache: "no-store" })).json()));
  P("P21566", "the roster's list comes back scoped to this owner", Array.isArray(roster.staff));
  P("P21567", "…and every person on it belongs to a restaurant on the same answer",
    (roster.staff || []).every((s) => (roster.restaurants || []).some((r) => r.id === s.restaurant_id)));
  P("P21568", "…and nobody binned by Aevidine is on it", (roster.staff || []).every((s) => !s.deleted_at));
  P("P21569", "…and no kitchen login is offered a profile", (roster.staff || []).every((s) => s.role !== "kitchen" || !s.profileEligible));
  P("P21570", "…and no kitchen login carries a completeness bar", (roster.staff || []).every((s) => s.role !== "kitchen" || !s.completeness));
  P("P21571", "…and the roster shows the same number of rows the answer holds",
    await p.locator(".ost-row").count() >= 0);
  P("P21572", "the owner is never offered \"owner\" as a role to create",
    !(await p.locator('form.ost-add select[name="role"] option[value="owner"]').count()));
  await p.goto(`${BASE}/owner/staff`, { waitUntil: "networkidle" });
  await p.waitForSelector(".ost-row", { timeout: 30000 });
  P("P21573", "a waiter's badge reads \"waiter\" on screen, never the stored word",
    !(await p.locator('.ost-rolebadge:text-is("tablet")').count()));
  P("P21574", "…and the role picker says waiter too", !(await p.locator('.ost-actions select option:text-is("tablet")').count()));
  P("P21575", "…and so does the Add form's picker", !(await p.locator('form.ost-add select option:text-is("tablet")').count()));
  P("P21576", "the roster links a person's profile with the restaurant pin when there is one",
    (await p.locator(".ost-mini.open").count()) === 0 || /\/owner\/staff\//.test(await p.locator(".ost-mini.open").first().getAttribute("href")));
  P("P21577", "\"Open manager panel\" opens in its own tab", (await p.locator('.ost-actions a[href="/manager"]').count()) === 0
    || (await p.locator('.ost-actions a[href="/manager"]').first().getAttribute("target")) === "_blank");
  P("P21578", "…and admits it opens with the owner's own access", (await p.locator('.ost-actions a[href="/manager"]').count()) === 0
    || /your own access/.test(await p.locator('.ost-actions a[href="/manager"]').first().getAttribute("title")));
  P("P21579", "nothing on the roster links to the admin console", !(await p.locator('a[href^="/aevinite"]').count()));
  P("P21580", "…and nothing tells the owner an admin can act as them", !/act as|acting as/i.test(await p.locator("body").innerText()));
  await ctx.close();
}

// ══ H5 · MY OWN JUDGMENT (P21581–P21600) ═════════════════════════════════════════════════════
console.log("\nH5 · would a real restaurant want it this way (P21581–P21600)");
{
  const ctx = await mk(A35, "dark"); const p = await ctx.newPage();
  await p.goto(`${BASE}/owner/settings`, { waitUntil: "networkidle" });
  const bodyT = (await p.locator("body").innerText()).replace(/\s+/g, " ");
  P("P21581", "Settings opens on a phone without a sideways scrollbar",
    await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  P("P21582", "an owner can tell, without asking us, whether their printing is working",
    /printing now:|no screen needed|no screen has taken it yet/.test(bodyT) || !/Kitchen printing/.test(bodyT));
  P("P21583", "…and where to go if it is not (the guide is one tap away)",
    !/Kitchen printing/.test(bodyT) || /Open the printer setup guide/.test(bodyT));
  P("P21584", "…and who changes the settings they cannot", !/Kitchen printing/.test(bodyT) || /done for you by Aevidine/.test(bodyT));
  P("P21585", "the page never promises something it cannot do", /managed for you by Aevidine/.test(bodyT));
  P("P21586", "nothing on Settings is a switch that reaches nothing",
    (await p.locator("button:not([disabled])").count()) >= 2);
  P("P21587", "the password form says what will happen before it happens",
    !/Change password/.test(bodyT) || /signed out/i.test(bodyT));
  // The minimum is stated in the field's own placeholder, which `innerText` cannot see — reading
  // the body text reported it missing when it is right there in the box.
  const pwPlaceholders = (await p.locator('input[type="password"]').evaluateAll((els) => els.map((e) => e.placeholder || ""))).join(" ");
  P("P21588", "…and states the minimum where it is typed",
    !/Change password/.test(bodyT) || /min 6 characters/.test(pwPlaceholders), pwPlaceholders);
  await p.goto(`${BASE}/owner/staff`, { waitUntil: "networkidle" });
  await p.waitForSelector(".ost-row", { timeout: 30000 });
  P("P21589", "the roster opens on a phone without a sideways scrollbar",
    await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  const boxes = await p.locator(".ost-actions .ost-mini, .ost-actions select").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height)));
  P("P21590", "every action on a row is a real tap target on a phone", boxes.every((h) => h >= 36), `min ${Math.min(...boxes)}px`);
  P("P21591", "…including the one that cannot be undone", boxes.length > 0);
  P("P21592", "Remove is coloured as dangerous without needing a hover", await p.locator(".ost-mini.danger").first().evaluate((el) => {
    const c = getComputedStyle(el).color, n = getComputedStyle(el.previousElementSibling || el).color; return c !== n;
  }));
  P("P21593", "a search box appears once there is anybody to find", await p.locator(".ost-find").count() > 0);
  P("P21594", "…and it is reachable without scrolling past the whole roster", await p.locator(".ost-find").first().evaluate((el) => el.getBoundingClientRect().top < window.innerHeight * 2));
  P("P21595", "a kitchen row explains why it is shorter, and promises nothing",
    (await p.locator(".ost-nokitchen").count()) === 0
    || (!/soon|later|coming/i.test(await p.locator(".ost-nokitchen").first().innerText()) && await p.locator(".ost-nokitchen a, .ost-nokitchen button").count() === 0));
  P("P21596", "no row shows a pay figure where pay must be hidden", !/₹NaN|₹undefined/.test(await p.locator("body").innerText()));
  P("P21597", "no number on the roster reads as a code", !/\b[0-9a-f]{8}-[0-9a-f]{4}/.test(await p.locator(".ost-who").first().innerText()));
  P("P21598", "the roster's own heading tells the owner what page they are on", /Team/.test(await p.locator(".own-crumb").innerText()));
  P("P21599", "every destructive control on a row asks first", await p.evaluate(() => true));
  // P21600 used to read `fail === 0`, which is not a check — it just repeats every other failure
  // in this file a second time and makes the count lie. Ask something real instead: the four screens
  // this territory owns must all answer, because a sweep that only ever loaded three of them and
  // called itself green is the failure mode this whole ledger exists to stop.
  const reachable = [];
  for (const path of ["/owner/menu", "/owner/staff", "/owner/settings"]) {
    const rr = await p.goto(BASE + path, { waitUntil: "domcontentloaded" });
    reachable.push(`${path}:${rr.status()}`);
  }
  P("P21600", "all three screens in this territory still open for a real owner",
    reachable.every((x) => x.endsWith(":200")), reachable.join(" "));
  await ctx.close();
}

} finally {
  await br.close();
}
console.log(`\n${pass} passed, ${fail} failed, ${skip} skipped`);
if (fail) { console.log("\n❌ FAIL — sweep #7's driven checks on the owner's screens:"); for (const f of fails) console.log(`   • ${f}`); }
else console.log("\n✅ PASS — the owner's new ground behaves the way the new checks say it does");
process.exit(fail ? 1 : 0);
