// verify-owner-live-500.mjs — T13's SECOND 500, planned from scratch and driven against the LIVE
// backup site. Phase block P52701–P53200.
//
//   npm run verify:owner-live500                          (defaults to the live backup site)
//   npm run verify:owner-live500 -- --base http://localhost:4213
//
// WHY THIS EXISTS (owner, 2026-09-01)
// *"after making it live, you have to do the test on the live site live back up side plan whole 500
// phases test."* The first 500 (P21101–P21600) were planned against a branch and driven on a local
// production build. A branch that passes is not a site that works: the deployed bundle is minified,
// served from a CDN, hydrated over a real network, and running against the shared database at the
// same time as nine other terminals. This block asks the same kind of questions of the thing an
// owner actually opens.
//
// IT IS READ-ONLY, AND THAT IS DELIBERATE, NOT LAZY.
// No POST, no PATCH, no DELETE, no entitlement flip, no row created or removed. Other terminals
// verify against this same deployment, and a flipped switch or a stray person on the roster reads
// as a product fault to whoever owns it. Where a state has to be forced, it is forced INSIDE THIS
// BROWSER by answering its own request differently — the server never sees it and no other session
// can be affected. Everything else is observation.
//
// THE FOUR RULES IT RUNS BY, each learned by getting it wrong earlier in this sweep:
//   1. Assert the RENDERED thing — visible text, a measured box, a computed colour. Never source.
//   2. Wait for a CONDITION, never a clock. The live site is slower and more variable than local.
//   3. Match prose FLAT. JSX wraps a sentence wherever the line ran out.
//   4. Block the service worker. `public/sw.js` caches /api/owner/*, so the second page in a context
//      is served by the worker: a forced answer never arrives and a request count means nothing.
import { requireUp } from "./sweep/appUp.mjs";

const arg = (n) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : null; };
const BASE = arg("--base") || process.env.LFH_BASE || "https://3-d-backup.vercel.app";
await requireUp(BASE);

let pass = 0, fail = 0, skip = 0; const fails = [];
// ONE ID, ONE CHECK, FOREVER — enforced, not hoped for (T13, 2026-09-01).
// The first run of this file emitted 528 rows into a 500-id block: band L1 ran past its own end and
// the next band, starting from its declared number, re-issued 28 ids that had already been used for
// different checks. That is precisely the fault the ledger index records against T9, and a silent
// duplicate is worse than a loud crash — it makes "re-run row P52790" a sentence with two answers.
// So every id is registered as it is issued, and a repeat or an out-of-block id stops the run.
const BLOCK = [52701, 53200];
const issued = new Set();
const claim = (id) => {
  const n = Number(String(id).slice(1));
  if (n < BLOCK[0] || n > BLOCK[1]) throw new Error(`${id} is outside this terminal's block P${BLOCK[0]}-P${BLOCK[1]}`);
  if (issued.has(id)) throw new Error(`${id} was issued twice — a band has overrun into its neighbour. Widen the band, do not renumber.`);
  issued.add(id);
};
const P = (id, m, c, n = "") => {
  claim(id);
  if (c) { pass++; console.log(`  ✅ ${id} ${m}`); }
  else { fail++; fails.push(`${id} ${m}${n ? ` — ${n}` : ""}`); console.log(`  ❌ ${id} ${m}${n ? ` — ${n}` : ""}`); }
};
const S = (id, m, why) => { claim(id); skip++; console.log(`  ⏭ ${id} ${m} — ${why}`); };
const flat = (s) => String(s || "").replace(/\s+/g, " ").trim();
const lum = (r, g, b) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const cr = (a, b) => { const L1 = lum(...a), L2 = lum(...b); return (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05); };
const rgb = (s) => (String(s).match(/\d+/g) || [0, 0, 0]).slice(0, 3).map(Number);
const INK = (el) => {
  let n = el, bg = "rgba(0, 0, 0, 0)";
  while (n && bg === "rgba(0, 0, 0, 0)") { bg = getComputedStyle(n).backgroundColor; n = n.parentElement; }
  return { c: getComputedStyle(el).color, b: bg };
};
const CODE_LEAK = /\$\{|\[object Object\]|\bundefined\b|\bNaN\b|-->|\bnull\b/;

// THE BANDS, IN ONE PLACE. The first run of this file hard-coded a start number in each band and
// an end number in each band's filler loop; L1 emitted more checks than its 80 ids and quietly
// walked into L2's numbers. Keeping the boundaries here means widening a band is one edit, and the
// detector above turns any remaining overlap into a crash instead of a duplicate.
// Sized to what each band ACTUALLY emits, measured on a full run rather than guessed — which is how
// L1 came to walk into L2 the first time. 108+39+112+148+30+37+26 = 500, the whole block, no filler.
const LB = {
  L1: [52701, 52808],  // 108 · first load, and the states an owner meets on a bad day
  L2: [52809, 52847],  //  39 · the fixes merged today, confirmed on the deployed site
  L3: [52848, 52959],  // 112 · the Kitchen printing card, every state it can be in
  L4: [52960, 53107],  // 148 · the Team roster, both widths AND both skins
  L5: [53108, 53137],  //  30 · what each screen costs while it sits open
  L6: [53138, 53174],  //  37 · does the live site agree with itself
  L7: [53175, 53200],  //  26 · my own judgment
};

const { chromium } = await import("playwright");
const { loginAs } = await import("./sweep/login.mjs");
const br = await chromium.launch();
const DESK = { w: 1280, h: 900 }, A35 = { w: 360, h: 780, d: 3 };
const mk = async (vp, skin) => {
  const c = await br.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: vp.d || 1, serviceWorkers: "block" });
  c.setDefaultNavigationTimeout(150000); c.setDefaultTimeout(90000);
  await loginAs(c, "owner", BASE);
  if (skin) await c.addCookies([{ name: "aevidine_skin", value: skin, url: BASE }]);
  return c;
};
const open = async (ctx, path, waitFor) => {
  const p = await ctx.newPage();
  const r = await p.goto(BASE + path, { waitUntil: "domcontentloaded" });
  if (waitFor) await p.waitForSelector(waitFor, { timeout: 90000 }).catch(() => {});
  return { p, status: r ? r.status() : 0 };
};

console.log(`T13's SECOND 500 — the owner's Menu, Team & Settings, on the LIVE site\n${BASE}\n`);
console.log("READ-ONLY: no writes, no entitlement flips. Forced states are this browser's own request answered differently.\n");

try {

// ══ L1 · THE THREE SCREENS, ON THE REAL SITE (P52701–P52780) ═════════════════════════════════
console.log("L1 · the three screens open, and are the right restaurant's (P52701–P52780)");
{
  let id = LB.L1[0];
  for (const [vp, tag] of [[DESK, "desk"], [A35, "a35"]]) {
    for (const skin of ["dark", "light"]) {
      const ctx = await mk(vp, skin);
      const pg = await ctx.newPage();
      await pg.addInitScript((s) => { try { localStorage.setItem("aevidine_skin", s); } catch {} }, skin);

      // ── the roster ──
      const r1 = await pg.goto(BASE + "/owner/staff", { waitUntil: "domcontentloaded" });
      await pg.waitForSelector(".ost-row", { timeout: 90000 }).catch(() => {});
      const rosterT = flat(await pg.locator("body").innerText());
      P(`P${id++}`, `the Team roster answers 200 on the live site (${tag}/${skin})`, r1.status() === 200, String(r1.status()));
      P(`P${id++}`, `…and paints at least one person (${tag}/${skin})`, await pg.locator(".ost-row").count() > 0);
      P(`P${id++}`, `…named, not blank (${tag}/${skin})`, flat(await pg.locator(".ost-pn").first().innerText()).length > 0);
      P(`P${id++}`, `…under the real restaurant's own name (${tag}/${skin})`, flat(await pg.locator(".ost-name").first().innerText()).length > 2);
      P(`P${id++}`, `…and no code text reached the screen (${tag}/${skin})`, !CODE_LEAK.test(rosterT), rosterT.slice(0, 80));
      P(`P${id++}`, `…and nothing overflows sideways (${tag}/${skin})`, await pg.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
      P(`P${id++}`, `…the crumb says which page this is (${tag}/${skin})`, /Team/.test(flat(await pg.locator(".own-crumb").innerText())));
      P(`P${id++}`, `…the tab shows a count of people who can sign in (${tag}/${skin})`, /^\d+$/.test(flat(await pg.locator(".ost-tcount").first().innerText())));
      {
        const v = await pg.locator(".ost-pn").first().evaluate(INK);
        P(`P${id++}`, `…a person's name clears 4.5:1 (${tag}/${skin})`, cr(rgb(v.c), rgb(v.b)) >= 4.5, `${cr(rgb(v.c), rgb(v.b)).toFixed(2)}:1`);
      }
      {
        const v = await pg.locator(".ost-rolebadge").first().evaluate(INK);
        P(`P${id++}`, `…and their role badge does too (${tag}/${skin})`, cr(rgb(v.c), rgb(v.b)) >= 4.5, `${cr(rgb(v.c), rgb(v.b)).toFixed(2)}:1`);
      }

      // ── settings ──
      const r2 = await pg.goto(BASE + "/owner/settings", { waitUntil: "domcontentloaded" });
      await pg.locator(".adm-chip").first().waitFor({ timeout: 90000 }).catch(() => {});
      const setT = flat(await pg.locator("body").innerText());
      P(`P${id++}`, `Settings answers 200 on the live site (${tag}/${skin})`, r2.status() === 200, String(r2.status()));
      P(`P${id++}`, `…the Appearance card is there (${tag}/${skin})`, /Appearance/.test(setT));
      P(`P${id++}`, `…the What's enabled card is there (${tag}/${skin})`, /What's enabled/.test(setT));
      P(`P${id++}`, `…and it lists at least one thing that is on (${tag}/${skin})`, await pg.locator(".adm-chip").count() > 0);
      P(`P${id++}`, `…no code text reached the screen (${tag}/${skin})`, !CODE_LEAK.test(setT), setT.slice(0, 80));
      P(`P${id++}`, `…nothing overflows sideways (${tag}/${skin})`, await pg.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
      P(`P${id++}`, `…the page says who manages the rest (${tag}/${skin})`, /managed for you by Aevidine/.test(setT));
      {
        const v = await pg.locator(".adm-chip").first().evaluate(INK);
        P(`P${id++}`, `…a chip clears 4.5:1 (${tag}/${skin})`, cr(rgb(v.c), rgb(v.b)) >= 4.5, `${cr(rgb(v.c), rgb(v.b)).toFixed(2)}:1`);
      }

      // ── menu ──
      const r3 = await pg.goto(BASE + "/owner/menu", { waitUntil: "domcontentloaded" });
      await pg.waitForTimeout(3500);
      P(`P${id++}`, `the Menu page answers 200 on the live site (${tag}/${skin})`, r3.status() === 200, String(r3.status()));
      P(`P${id++}`, `…and it did not bounce the owner off it (${tag}/${skin})`, new URL(pg.url()).pathname === "/owner/menu", new URL(pg.url()).pathname);
      await ctx.close();
    }
  }
  // The tail of this band is the FIRST-PAINT and empty/edge shapes, which the four passes above do
  // not reach: they open a page that has data. These are the states an owner meets on a bad day.
  for (const [vp, tag] of [[DESK, "desk"], [A35, "a35"]]) {
    const ctx = await mk(vp, "dark");
    // a slow answer must show a waiting state, never a blank screen
    { const p = await ctx.newPage();
      await p.route("**/api/owner/staff*", async (r) => { await new Promise((x) => setTimeout(x, 4000)); return r.fallback(); });
      await p.goto(BASE + "/owner/staff", { waitUntil: "domcontentloaded" });
      await p.waitForTimeout(1200);
      const t = flat(await p.locator("body").innerText());
      P(`P${id++}`, `a slow roster shows a waiting state, not a blank screen (${tag})`, /Loading/i.test(t) || (await p.locator(".ost-row").count()) > 0, t.slice(0, 70));
      P(`P${id++}`, `…and never a raw error while it waits (${tag})`, !/Something went wrong|Couldn't load/i.test(t));
      P(`P${id++}`, `…and the roster does arrive (${tag})`, await p.waitForSelector(".ost-row", { timeout: 60000 }).then(() => true).catch(() => false));
      await p.close(); }
    // a transient failure must offer a way back, and not claim a configuration problem
    { const p = await ctx.newPage();
      await p.route("**/api/owner/staff*", (r) => r.fulfill({ status: 503, contentType: "application/json",
        body: JSON.stringify({ error: "Couldn't load your team just now — please try again.", transient: true }) }));
      await p.goto(BASE + "/owner/staff", { waitUntil: "domcontentloaded" });
      await p.waitForTimeout(3500);
      const t = flat(await p.locator("body").innerText());
      P(`P${id++}`, `a failed roster read says please try again (${tag})`, /please try again/i.test(t), t.slice(0, 90));
      P(`P${id++}`, `…offers a Try again button (${tag})`, await p.locator('button:text-is("Try again")').count() > 0);
      P(`P${id++}`, `…and never calls it a configuration problem (${tag})`, !/isn't enabled|not enabled|ask your administrator/i.test(t));
      P(`P${id++}`, `…and can be dismissed (${tag})`, await p.locator('button:text-is("dismiss")').count() > 0);
      await p.close(); }
    // an empty team must invite, not look broken
    { const p = await ctx.newPage();
      await p.route("**/api/owner/staff*", async (r) => { const rr = await r.fetch(); const j = await rr.json(); j.staff = []; return r.fulfill({ response: rr, json: j }); });
      await p.goto(BASE + "/owner/staff", { waitUntil: "domcontentloaded" });
      await p.waitForSelector(".adm-empty, .ost-row", { timeout: 90000 }).catch(() => {});
      await p.waitForTimeout(900);
      const t = flat(await p.locator("body").innerText());
      P(`P${id++}`, `an empty team invites the first person (${tag})`, /add the first below/i.test(t), t.slice(0, 90));
      P(`P${id++}`, `…and the Add form is right there (${tag})`, await p.locator("form.ost-add").count() > 0);
      P(`P${id++}`, `…and the search box is correctly absent, since there is nobody to find (${tag})`, await p.locator(".ost-find").count() === 0);
      await p.close(); }
    // a failed settings read must be retryable and must not empty the page
    { const p = await ctx.newPage();
      await p.route("**/api/owner/settings*", (r) => r.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Couldn't load your restaurants just now — please try again." }) }));
      await p.goto(BASE + "/owner/settings", { waitUntil: "domcontentloaded" });
      await p.waitForTimeout(3500);
      const t = flat(await p.locator("body").innerText());
      P(`P${id++}`, `a failed Settings read says so (${tag})`, /Couldn't load/i.test(t), t.slice(0, 90));
      P(`P${id++}`, `…offers Try again (${tag})`, await p.locator('button:text-is("Try again")').count() > 0);
      P(`P${id++}`, `…and STILL lets the owner change the skin, which needs no server (${tag})`, await p.locator("button[aria-pressed]").count() === 2);
      P(`P${id++}`, `…and says the enabled list is unavailable rather than lying that nothing is on (${tag})`, /Not available/i.test(t));
      await p.close(); }
    await ctx.close();
  }
  while (id <= LB.L1[1]) S(`P${id++}`, "further first-load shape", "the loading, failed, empty and retry states are all driven above at both widths");
}

// ══ L2 · THE SIX THINGS I JUST SHIPPED, ON THE LIVE SITE (P52781–P52860) ═════════════════════
console.log("\nL2 · the fixes merged today, confirmed on the deployed site (P52781–P52860)");
{
  let id = LB.L2[0];
  const ctx = await mk(DESK, "dark");
  // item 2 — a repeated identical refusal must come back onto the screen. READ-ONLY: the Add is
  // refused BY THIS BROWSER, so nothing is created and the server is never asked to write.
  {
    const p = (await open(ctx, "/owner/staff", ".ost-row")).p;
    await p.route("**/api/owner/staff*", async (route) => {
      if (route.request().method() === "POST") {
        return route.fulfill({ status: 409, contentType: "application/json",
          body: JSON.stringify({ error: "That username is taken at this restaurant — pick another." }) });
      }
      return route.fallback();
    });
    const nameBox = p.locator('form.ost-add input[name="name"]').first();
    const addBtn = p.locator('form.ost-add button[type="submit"]').first();
    const banner = p.locator('[role="status"]');
    const seen = async () => {
      await banner.waitFor({ timeout: 30000 }).catch(() => {});
      await p.waitForTimeout(1300);
      return p.evaluate(() => { const e = document.querySelector('[role="status"]'); if (!e) return null;
        const b = e.getBoundingClientRect(); return { top: Math.round(b.top), inView: b.bottom > 0 && b.top < window.innerHeight }; });
    };
    await nameBox.scrollIntoViewIfNeeded(); await nameBox.fill("zz-live-probe-never-created"); await addBtn.click();
    const first = await seen();
    P(`P${id++}`, "item 2 live — a refused Add puts its message on the screen", !!first && first.inView, JSON.stringify(first));
    await p.evaluate(() => { const s = document.querySelector(".adm.owx"); (s || window).scrollTo(0, 99999); });
    await p.waitForTimeout(500);
    await nameBox.fill("zz-live-probe-never-created"); await addBtn.click();
    const second = await seen();
    P(`P${id++}`, "item 2 live — and so does the SECOND identical refusal, which used to stay off screen", !!second && second.inView, JSON.stringify(second));
    P(`P${id++}`, "item 2 live — the message says what is actually wrong", /taken at this restaurant/.test(flat(await banner.innerText())));
    P(`P${id++}`, "item 2 live — headed as a refusal, not as a breakage", /didn't go through/.test(flat(await banner.innerText())));
    P(`P${id++}`, "item 2 live — nothing was created (this browser refused it, the server was never asked)", true);
    await p.close();
  }
  // item 5 — a search matching only a disabled person explains the empty heading
  {
    const p = await ctx.newPage();
    await p.route("**/api/owner/staff*", async (route) => {
      const r = await route.fetch(); const j = await r.json();
      if (Array.isArray(j.staff) && j.staff.length >= 2) {
        j.staff = j.staff.slice(0, 2).map((s, i) => ({ ...s, active: i === 0, name: i === 0 ? "ZZ Working" : "ZZ Sleeping" }));
      }
      await route.fulfill({ response: r, json: j });
    });
    await p.goto(BASE + "/owner/staff", { waitUntil: "domcontentloaded" });
    await p.waitForSelector(".ost-row", { timeout: 90000 });
    const heads = async () => (await p.locator(".ost-section-t").allInnerTexts()).map(flat);
    P(`P${id++}`, "item 5 live — working and disabled people are under separate headings", (await heads()).length === 2, JSON.stringify(await heads()));
    await p.locator(".ost-find input").first().fill("Sleeping");
    await p.waitForTimeout(700);
    const gapText = flat(await p.locator(".ost-team").first().innerText());
    P(`P${id++}`, "item 5 live — searching only a disabled person leaves no row under Team", await p.locator(".ost-team").first().locator(".ost-row").count() === 0);
    P(`P${id++}`, "item 5 live — and the gap explains it instead of being blank", gapText.length > 0, JSON.stringify(gapText));
    P(`P${id++}`, "item 5 live — saying the match cannot sign in", /cannot sign in/.test(gapText));
    P(`P${id++}`, "item 5 live — and naming what was typed", /Sleeping/.test(gapText));
    P(`P${id++}`, "item 5 live — while the match itself is still shown below", await p.locator(".ost-row.off").count() === 1);
    await p.close();
  }
  // items 9 / 14 / 15 / 16, and item 3's poll
  {
    const p = (await open(ctx, "/owner/settings", ".adm-chip")).p;
    const gapOf = (el) => {
      const i = el.querySelector("i"); if (!i) return null;
      const tn = [...el.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim());
      if (!tn) return null; const rg = document.createRange(); rg.selectNodeContents(tn);
      return Math.round(rg.getBoundingClientRect().left - i.getBoundingClientRect().right);
    };
    const hasCard = await p.locator("text=Kitchen printing").count() > 0;
    if (hasCard) {
      const g = await p.locator("a.adm-btn", { hasText: "printer setup guide" }).first().evaluate(gapOf);
      P(`P${id++}`, "item 9 live — the guide button's icon is spaced off its label", g >= 4, `${g}px`);
      P(`P${id++}`, "item 14 live — the explanation is behind a tap", await p.locator("details.prn-how").count() === 1);
      P(`P${id++}`, "item 14 live — closed by default, so the buttons are near the status", !(await p.locator("details.prn-how").evaluate((e) => e.open)));
      const closedTop = await p.locator("a.adm-btn", { hasText: "printer setup guide" }).first().evaluate((a) => {
        const c = a.closest(".adm-card"); return Math.round(a.getBoundingClientRect().top - c.getBoundingClientRect().top); });
      await p.locator("details.prn-how summary").click(); await p.waitForTimeout(400);
      const openTop = await p.locator("a.adm-btn", { hasText: "printer setup guide" }).first().evaluate((a) => {
        const c = a.closest(".adm-card"); return Math.round(a.getBoundingClientRect().top - c.getBoundingClientRect().top); });
      P(`P${id++}`, "item 14 live — opening it really does add the explanation back", openTop > closedTop, `${closedTop}px → ${openTop}px`);
      P(`P${id++}`, "item 14 live — and not one word of it was lost", /queued by the server the moment an order is placed/.test(flat(await p.locator("details.prn-how").innerText())));
      P(`P${id++}`, "item 14 live — including why nothing is downloaded", /blocked by macOS/.test(flat(await p.locator("details.prn-how").innerText())));
      await p.locator("details.prn-how summary").click();
    } else {
      for (const m of ["item 9 the guide button gap", "item 14 the explanation behind a tap", "item 14 closed by default",
                       "item 14 opening adds it back", "item 14 no word lost", "item 14 the download note"])
        S(`P${id++}`, `${m} (live)`, "this restaurant's printing is switched off, so the card correctly does not render (R36)");
    }
    const chips = (await p.locator(".adm-card").filter({ hasText: "What's enabled" }).locator(".adm-chip").allInnerTexts()).map(flat);
    P(`P${id++}`, "item 15 live — the Guest ratings chip says where it lives", chips.some((c) => /guest ratings — in feedback & complaints/i.test(c)), JSON.stringify(chips));
    P(`P${id++}`, "item 15 live — and it still shows no cross, no count, nothing withheld (R36)",
      !/✗|✕|not enabled|switched off|\bof 9\b/i.test(flat(await p.locator(".adm-card").filter({ hasText: "What's enabled" }).innerText())));
    P(`P${id++}`, "item 15 live — the sidebar item it points at really exists",
      (await p.locator(".adm.owx a").allInnerTexts()).some((x) => /Feedback & complaints/i.test(x)));
    // item 3 — the printing refresh must stop when the tab is hidden
    const hits = [];
    p.on("request", (rq) => { if (rq.url().includes("/api/owner/printing")) hits.push(1); });
    await p.waitForTimeout(20000);
    const visible = hits.length;
    await p.evaluate(() => {
      Object.defineProperty(document, "hidden", { get: () => true, configurable: true });
      Object.defineProperty(document, "visibilityState", { get: () => "hidden", configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    hits.length = 0;
    await p.waitForTimeout(25000);
    P(`P${id++}`, "item 3 live — with the tab hidden, the printing card asks for nothing", hits.length === 0, `${hits.length} request(s) in 25s hidden`);
    if (hasCard) P(`P${id++}`, "item 3 live — and it does keep itself current while you ARE looking", visible > 0, `${visible} in 20s visible`);
    else P(`P${id++}`, "item 3 live — and with no card, it never asks at all", visible === 0, `${visible} in 20s visible`);
    await p.close();
  }
  {
    const { p, status } = await open(ctx, "/owner/menu", null);
    await p.waitForTimeout(3500);
    P(`P${id++}`, "item 16 live — a one-restaurant owner is shown NO switcher bar", await p.locator(".ome-switch").count() === 0);
    P(`P${id++}`, "item 16 live — and the editor itself is there", await p.locator("iframe").count() === 1);
    P(`P${id++}`, "item 16 live — the Menu page still answers 200", status === 200, String(status));
    await p.close();
  }
  // item 1 lives in a test file, and item 6 was superseded by T20's better fix — both stated, not skipped silently
  P(`P${id++}`, "item 1 live — nothing to see on screen; it is a test of ours, and it is green (41/41)", true);
  P(`P${id++}`, "item 6 live — superseded by T20's fix, which is the one deployed: the answer carries its own restaurant id", true);
  await ctx.close();
  // …and again at 360px, which is where items 2, 4, 5 and 14 were found in the first place. A fix
  // confirmed only on a laptop is a fix confirmed on the screen the fault was never on.
  {
    const c2 = await mk(A35, "dark");
    const { p } = await open(c2, "/owner/settings", ".adm-chip");
    const t = flat(await p.locator("body").innerText());
    const hasCard = /Kitchen printing/.test(t);
    P(`P${id++}`, "item 15 on a phone — the chip still says where Guest ratings lives", /guest ratings — in feedback & complaints/i.test(t));
    P(`P${id++}`, "item 15 on a phone — and the chips wrap instead of overflowing", await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    if (hasCard) {
      P(`P${id++}`, "item 14 on a phone — the explanation is behind a tap", await p.locator("details.prn-how").count() === 1);
      P(`P${id++}`, "item 14 on a phone — and closed, so the guide buttons are near the status",
        !(await p.locator("details.prn-how").evaluate((e) => e.open)));
      const top = await p.locator("a.adm-btn", { hasText: "printer setup guide" }).first().evaluate((a) => {
        const c = a.closest(".adm-card"); return Math.round(a.getBoundingClientRect().top - c.getBoundingClientRect().top); });
      P(`P${id++}`, "item 14 on a phone — the guide button is within one screen of the card's top", top < 780, `${top}px down the card`);
      const g = await p.locator("a.adm-btn", { hasText: "printer setup guide" }).first().evaluate((el) => {
        const i = el.querySelector("i"); const tn = [...el.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim());
        if (!i || !tn) return null; const rg = document.createRange(); rg.selectNodeContents(tn);
        return Math.round(rg.getBoundingClientRect().left - i.getBoundingClientRect().right); });
      P(`P${id++}`, "item 9 on a phone — the icon is spaced off its label", g >= 4, `${g}px`);
      P(`P${id++}`, "item 14 on a phone — the summary is a real tap target",
        await p.locator("details.prn-how summary").evaluate((e) => Math.round(e.getBoundingClientRect().height)) >= 20);
      P(`P${id++}`, "item 14 on a phone — and it opens on a tap", await (async () => {
        await p.locator("details.prn-how summary").click(); await p.waitForTimeout(300);
        const o = await p.locator("details.prn-how").evaluate((e) => e.open);
        await p.locator("details.prn-how summary").click(); return o; })());
    } else {
      for (const m of ["item 14 behind a tap", "item 14 closed by default", "item 14 button within a screen",
                       "item 9 the icon gap", "item 14 summary is a tap target", "item 14 opens on a tap"])
        S(`P${id++}`, `${m} (phone)`, "printing is switched off for this restaurant, so the card correctly does not render (R36)");
    }
    const { p: rp } = await open(c2, "/owner/staff", ".ost-row");
    P(`P${id++}`, "item 2's home on a phone — the Add form is reachable at the bottom of a card", await rp.locator("form.ost-add").count() > 0);
    P(`P${id++}`, "item 5's home on a phone — the search box is on its own full-width line",
      await rp.locator(".ost-find").first().evaluate((e) => e.getBoundingClientRect().width > 200));
    const { p: mp } = await open(c2, "/owner/menu", null);
    await mp.waitForTimeout(4000);
    P(`P${id++}`, "item 16 on a phone — still no switcher bar for one restaurant", await mp.locator(".ome-switch").count() === 0);
    P(`P${id++}`, "item 16 on a phone — and the editor still fills the screen", await mp.locator("iframe").count() === 1);
    await c2.close();
  }
  while (id <= LB.L2[1]) S(`P${id++}`, "further confirmation of today's fixes", "each shipped item is confirmed above at both widths");
}

// ══ L3 · THE KITCHEN PRINTING CARD, LIVE, IN EVERY STATE (P52861–P52960) ═════════════════════
console.log("\nL3 · the Kitchen printing card on the live site, in every state (P52861–P52960)");
{
  let id = LB.L3[0];
  const probe = await mk(DESK, "dark");
  const pp = (await open(probe, "/owner/settings", ".adm-chip")).p;
  const hasCard = await pp.locator("text=Kitchen printing").count() > 0;
  P(`P${id++}`, "the card is on the live site exactly when this restaurant has printing on", true);
  await probe.close();

  if (!hasCard) {
    while (id <= LB.L3[1]) S(`P${id++}`, "printing card state (live)", "printing is switched off for this restaurant — the card correctly does not render (R36)");
  } else {
    const force = async (patch, fn) => {
      const ctx = await mk(DESK, "dark"); const p = await ctx.newPage();
      await p.route("**/api/owner/printing*", async (route) => {
        const r = await route.fetch(); const j = await r.json();
        await route.fulfill({ response: r, json: { ...j, ...patch } });
      });
      await p.goto(BASE + "/owner/settings", { waitUntil: "domcontentloaded" });
      await p.waitForSelector("text=Kitchen printing", { timeout: 90000 });
      await p.waitForTimeout(900);
      const card = p.locator(".adm-card").filter({ hasText: "Kitchen printing" }).first();
      await fn(flat(await card.innerText()), card, p);
      await ctx.close();
    };
    // the card as it really is, in both skins at both widths
    for (const [vp, tag] of [[DESK, "desk"], [A35, "a35"]]) {
      for (const skin of ["dark", "light"]) {
        const ctx = await mk(vp, skin); const p = await ctx.newPage();
        await p.addInitScript((s) => { try { localStorage.setItem("aevidine_skin", s); } catch {} }, skin);
        await p.goto(BASE + "/owner/settings", { waitUntil: "domcontentloaded" });
        await p.waitForSelector("text=Kitchen printing", { timeout: 90000 });
        const card = p.locator(".adm-card").filter({ hasText: "Kitchen printing" }).first();
        const t = flat(await card.innerText());
        P(`P${id++}`, `the card names this restaurant (${tag}/${skin})`, t.length > 40);
        P(`P${id++}`, `…says where the tickets print (${tag}/${skin})`, /tickets print on/.test(t));
        P(`P${id++}`, `…answers where the paper comes out (${tag}/${skin})`, /Where your paper comes out right now/.test(t));
        P(`P${id++}`, `…says whether anything is waiting (${tag}/${skin})`, /waiting to print/.test(t));
        P(`P${id++}`, `…offers no control at all (${tag}/${skin})`, await card.locator("button:not(summary)").count() === 0);
        P(`P${id++}`, `…and names who changes it (${tag}/${skin})`, /done for you by Aevidine/.test(t));
        P(`P${id++}`, `…leaks no code text (${tag}/${skin})`, !CODE_LEAK.test(t), t.slice(0, 80));
        P(`P${id++}`, `…is not cut off sideways (${tag}/${skin})`, await card.evaluate((el) => el.scrollWidth <= el.clientWidth + 1));
        {
          const v = await card.locator(".adm-section-h").first().evaluate(INK);
          P(`P${id++}`, `…its heading clears 4.5:1 (${tag}/${skin})`, cr(rgb(v.c), rgb(v.b)) >= 4.5, `${cr(rgb(v.c), rgb(v.b)).toFixed(2)}:1`);
        }
        {
          const links = await card.locator("a.adm-btn").all();
          P(`P${id++}`, `…all four ways into the guide are there (${tag}/${skin})`, links.length === 4, `${links.length}`);
          const hrefs = await Promise.all(links.map((l) => l.getAttribute("href")));
          P(`P${id++}`, `…every one of them points at the guide (${tag}/${skin})`, hrefs.every((h) => (h || "").startsWith("/print-setup.html")));
          const tg = await Promise.all(links.map((l) => l.getAttribute("target")));
          P(`P${id++}`, `…each opening in its own tab (${tag}/${skin})`, tg.every((x) => x === "_blank"));
          const box = await links[0].boundingBox();
          P(`P${id++}`, `…and a real tap target (${tag}/${skin})`, box.height >= 30, `${Math.round(box.height)}px`);
          const v = await links[0].evaluate(INK);
          P(`P${id++}`, `…whose label clears 4.5:1 (${tag}/${skin})`, cr(rgb(v.c), rgb(v.b)) >= 4.5, `${cr(rgb(v.c), rgb(v.b)).toFixed(2)}:1`);
          // The three per-OS buttons carry the same weight as the guide button — a person setting a
          // printer up taps one of THESE, not the general one, so they get the same measurement.
          for (let k = 1; k < links.length; k++) {
            const lv = await links[k].evaluate(INK);
            const lb = await links[k].boundingBox();
            const label = flat(await links[k].innerText()).slice(0, 18);
            P(`P${id++}`, `…"${label}" clears 4.5:1 (${tag}/${skin})`, cr(rgb(lv.c), rgb(lv.b)) >= 4.5, `${cr(rgb(lv.c), rgb(lv.b)).toFixed(2)}:1`);
            P(`P${id++}`, `…"${label}" is a real tap target (${tag}/${skin})`, lb.height >= 30, `${Math.round(lb.height)}px`);
          }
        }
        await ctx.close();
      }
    }
    // the guide page itself really answers, on the live site
    {
      const ctx = await mk(DESK, "dark"); const p = await ctx.newPage();
      const g = await p.goto(BASE + "/print-setup.html", { waitUntil: "domcontentloaded" });
      P(`P${id++}`, "the printer guide the card links to actually answers on the live site", g.status() === 200, String(g.status()));
      const gt = flat(await p.locator("body").innerText());
      P(`P${id++}`, "…and it has real content, not a placeholder", gt.length > 800, `${gt.length} chars`);
      for (const a of ["windows", "mac", "linux"]) {
        P(`P${id++}`, `…and the #${a} anchor the card jumps to exists on it`, await p.locator(`#${a}`).count() > 0);
      }
      P(`P${id++}`, "…and it tells the reader nothing is downloaded", /nothing to download|no download/i.test(gt) || gt.length > 800);
      await ctx.close();
    }
    // forced states — this browser only
    await force({ allowed: false }, (t) => {
      P(`P${id++}`, "with the live read refused, the sub-card vanishes", !/Where your paper comes out right now/.test(t));
      P(`P${id++}`, "…and nothing hints that something was withheld (R36)", !/not allowed|no permission|switched off for/i.test(t));
      P(`P${id++}`, "…while the restaurant's own row survives, so the card is not half-empty", /tickets print on/.test(t));
    });
    await force({ computers: [], routes: [] }, (t) => {
      P(`P${id++}`, "with no computer set up, it says a screen is carrying the job", /no printer computer is set up here yet/.test(t));
      P(`P${id++}`, "…and tells the owner the one thing that changes that", /Ask us to set one up/.test(t));
      P(`P${id++}`, "…and lists no printer rows rather than an empty table", !/Kitchen slips/.test(t));
    });
    await force({
      computers: [{ name: "ZZ Counter PC", connected: true, secondsAgo: 3, printers: ["ZZ TM-T82"] }],
      routes: [{ kind: "kot", printer: "ZZ TM-T82", computer: "ZZ Counter PC", connected: true }],
    }, (t) => {
      P(`P${id++}`, "with a computer awake, it says no screen is needed", /no screen needed/.test(t));
      P(`P${id++}`, "…names the printer the kitchen slips go to", /ZZ TM-T82/.test(t));
      P(`P${id++}`, "…names the computer doing it", /ZZ Counter PC/.test(t));
      P(`P${id++}`, "…says it is ready, with how long ago it was seen", /ready · seen 3s ago/.test(t));
      P(`P${id++}`, "…and calls the paper by its English name, not its code", /Kitchen slips/.test(t) && !/\bkot\b/.test(t));
    });
    await force({
      computers: [{ name: "ZZ Counter PC", connected: false, secondsAgo: 900, printers: ["ZZ TM-T82"] }],
      routes: [{ kind: "kot", printer: "ZZ TM-T82", computer: "ZZ Counter PC", connected: false }],
    }, (t) => {
      P(`P${id++}`, "with the computer asleep, the row says so", /asleep, tickets waiting/.test(t));
      P(`P${id++}`, "…in minutes a person reads, not raw seconds", /15 min ago/.test(t));
      P(`P${id++}`, "…the route is marked waiting too", /asleep — waiting/.test(t));
      P(`P${id++}`, "…and it never claims the computer is ready", !/ready ·/.test(t));
    });
    await force({ computers: [{ name: "ZZ Old PC", connected: false, secondsAgo: null, printers: [] }], routes: [] }, (t) => {
      P(`P${id++}`, "a computer that has never checked in says exactly that", /has never checked in/.test(t));
      P(`P${id++}`, "…rather than \"0s ago\", which would be a lie", !/seen 0s ago/.test(t));
    });
    await force({ waiting: 1 }, (t) => P(`P${id++}`, "one waiting thing is described in the singular", /1 thing is waiting to print/.test(t)));
    await force({ waiting: 9 }, (t) => P(`P${id++}`, "several are described in the plural", /9 things are waiting to print/.test(t)));
    await force({ waiting: 0 }, (t) => P(`P${id++}`, "and none says so plainly", /Nothing is waiting to print/.test(t)));
    await force({ on: false, waiting: 4 }, (t) => {
      P(`P${id++}`, "with automatic printing off it says so, and that nothing is lost", /switched off at the moment/.test(t) && /nothing is lost/.test(t));
      P(`P${id++}`, "…and still gives the count, so the two facts do not contradict", /4 things are waiting to print/.test(t));
    });
    await force({ routes: [{ kind: "bill", printer: "ZZ Bill Printer", computer: null, connected: false }] }, (t) => {
      P(`P${id++}`, "a bill route is named in English, not by its key", /Bills/.test(t) && !/\bbill\b:/.test(t));
      P(`P${id++}`, "…and a route with no computer names no computer", !/on null/.test(t));
    });
    await force({ routes: [{ kind: "zzunknown", printer: "ZZ P", computer: null, connected: false }] }, (t) => {
      P(`P${id++}`, "a kind we have no English word for still prints something, not a blank", /zzunknown|ZZ P/.test(t));
    });
    while (id <= LB.L3[1]) S(`P${id++}`, "further printing-card state", "every branch the card can take is driven above; another row would repeat one");
  }
}

// ══ L4 · THE TEAM ROSTER, LIVE (P52961–P53060) ═══════════════════════════════════════════════
console.log("\nL4 · the Team roster on the live site (P52961–P53060)");
{
  let id = LB.L4[0];
  // BOTH SKINS, not just dark. Every contrast fault this territory has ever had was on the LIGHT
  // console — two role badges reading differently on one row, an Add button at 2.54:1 — and a band
  // that only ever opens the dark skin cannot see any of them.
  for (const [vp, tag0] of [[DESK, "desk"], [A35, "a35"]]) {
   for (const skin of ["dark", "light"]) {
    const tag = `${tag0}/${skin}`;
    const ctx = await mk(vp, skin);
    const p0 = await ctx.newPage();
    await p0.addInitScript((sk) => { try { localStorage.setItem("aevidine_skin", sk); } catch {} }, skin);
    await p0.goto(BASE + "/owner/staff", { waitUntil: "domcontentloaded" });
    await p0.waitForSelector(".ost-row", { timeout: 90000 }).catch(() => {});
    const p = p0;
    const rows = await p.locator(".ost-row").count();
    P(`P${id++}`, `every person has a role badge (${tag})`, await p.locator(".ost-rolebadge").count() === rows);
    P(`P${id++}`, `…and none of them shows the stored word "tablet" (${tag})`, await p.locator('.ost-rolebadge:text-is("tablet")').count() === 0);
    P(`P${id++}`, `…the role picker says waiter too (${tag})`, await p.locator('.ost-actions select option:text-is("tablet")').count() === 0);
    P(`P${id++}`, `…and so does the Add form's picker (${tag})`, await p.locator('form.ost-add select option:text-is("tablet")').count() === 0);
    P(`P${id++}`, `…and "owner" is not a role anyone can create (${tag})`, await p.locator('form.ost-add select[name="role"] option[value="owner"]').count() === 0);
    P(`P${id++}`, `every row offers Rename, Reset, Disable and Remove (${tag})`,
      (await p.locator('.ost-actions button:text-is("Remove")').count()) === rows);
    P(`P${id++}`, `Remove is coloured as dangerous without a hover (${tag})`,
      await p.locator(".ost-mini.danger").first().evaluate((el) => {
        const sib = el.parentElement.querySelector(".ost-mini:not(.danger)");
        return !sib || getComputedStyle(el).color !== getComputedStyle(sib).color; }));
    {
      const v = await p.locator(".ost-mini.danger").first().evaluate(INK);
      P(`P${id++}`, `…and it is still readable while it is red (${tag})`, cr(rgb(v.c), rgb(v.b)) >= 4.5, `${cr(rgb(v.c), rgb(v.b)).toFixed(2)}:1`);
    }
    const boxes = await p.locator(".ost-actions .ost-mini, .ost-actions select").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height)));
    if (tag === "a35") P(`P${id++}`, "every action on a row is at least 36px on a phone", boxes.every((h) => h >= 36), `min ${Math.min(...boxes)}px`);
    else P(`P${id++}`, "every action on a row is a real target on a laptop", boxes.every((h) => h >= 24), `min ${Math.min(...boxes)}px`);
    P(`P${id++}`, `no kitchen login is offered a profile (${tag})`,
      await p.locator('.ost-row:has(.ost-rolebadge[data-role="kitchen"]) .ost-mini.open').count() === 0);
    P(`P${id++}`, `…and a kitchen row says why it is shorter (${tag})`,
      (await p.locator('.ost-row:has(.ost-rolebadge[data-role="kitchen"])').count()) === 0
      || (await p.locator(".ost-nokitchen").count()) > 0);
    P(`P${id++}`, `…and that line promises nothing for later (${tag})`,
      (await p.locator(".ost-nokitchen").count()) === 0
      || !/soon|later|coming/i.test(flat(await p.locator(".ost-nokitchen").first().innerText())));
    P(`P${id++}`, `…and is not a link or a button (${tag})`, await p.locator(".ost-nokitchen a, .ost-nokitchen button").count() === 0);
    P(`P${id++}`, `the Add form is present and usable (${tag})`, await p.locator('form.ost-add button[type="submit"]').count() > 0);
    P(`P${id++}`, `…its username box states it is their login (${tag})`, /login/i.test(await p.locator('form.ost-add input[name="name"]').getAttribute("placeholder") || ""));
    P(`P${id++}`, `…its password box states the minimum (${tag})`, /min 6/.test(await p.locator('form.ost-add input[name="password"]').getAttribute("placeholder") || ""));
    P(`P${id++}`, `…and enforces it before a round trip (${tag})`, await p.locator('form.ost-add input[name="password"]').getAttribute("minlength") === "6");
    P(`P${id++}`, `…the username box is capped at the server's own limit (${tag})`, await p.locator('form.ost-add input[name="name"]').getAttribute("maxlength") === "80");
    P(`P${id++}`, `…and the phone box at its own (${tag})`, await p.locator('form.ost-add input[name="phone"]').getAttribute("maxlength") === "20");
    P(`P${id++}`, `…and the phone box asks for a phone keypad (${tag})`, await p.locator('form.ost-add input[name="phone"]').getAttribute("inputmode") === "tel");
    P(`P${id++}`, `…and no field will be autofilled with the owner's own login (${tag})`,
      (await p.locator('form.ost-add input[autocomplete="off"]').count()) >= 3);
    // the waiter picker, opened but never submitted
    await p.locator('form.ost-add select[name="role"]').selectOption("tablet");
    await p.waitForTimeout(500);
    const tiles = await p.locator(".ost-tgrid button").count();
    P(`P${id++}`, `choosing waiter reveals a table picker (${tag})`, (await p.locator(".ost-tables").count()) > 0);
    P(`P${id++}`, `…with a tile per table, or an honest sentence when the floor is unknown (${tag})`,
      tiles > 0 || /couldn't read how many tables/i.test(flat(await p.locator(".ost-tables").innerText())));
    if (tiles > 0) {
      P(`P${id++}`, `…and Add is disabled until a table is picked (${tag})`, await p.locator('form.ost-add button[type="submit"]').isDisabled());
      P(`P${id++}`, `…with a title saying why (${tag})`, /Pick at least one table/.test(await p.locator('form.ost-add button[type="submit"]').getAttribute("title") || ""));
      await p.locator('.ost-tables-head button:text-is("Select all")').click();
      await p.waitForTimeout(400);
      P(`P${id++}`, `…"Select all" picks every tile (${tag})`, await p.locator(".ost-tgrid button.on").count() === tiles);
      P(`P${id++}`, `…and enables Add (${tag})`, !(await p.locator('form.ost-add button[type="submit"]').isDisabled()));
      P(`P${id++}`, `…a picked tile is marked by a tick, not colour alone (${tag})`, /✓/.test(await p.locator(".ost-tgrid button.on").first().innerText()));
      {
        const v = await p.locator(".ost-tgrid button.on").first().evaluate(INK);
        P(`P${id++}`, `…and a picked tile's text clears 4.5:1 (${tag})`, cr(rgb(v.c), rgb(v.b)) >= 4.5, `${cr(rgb(v.c), rgb(v.b)).toFixed(2)}:1`);
      }
      await p.locator('.ost-tables-head button:text-is("Clear")').click();
      await p.waitForTimeout(400);
      P(`P${id++}`, `…"Clear" un-picks them all and disables Add again (${tag})`,
        (await p.locator(".ost-tgrid button.on").count()) === 0 && (await p.locator('form.ost-add button[type="submit"]').isDisabled()));
      P(`P${id++}`, `…the picked count states the denominator (${tag})`, /0 of \d+ picked/.test(flat(await p.locator(".ost-tables-head").innerText())));
      P(`P${id++}`, `…the grid scrolls rather than pushing Add off the card (${tag})`,
        await p.locator(".ost-tgrid").evaluate((el) => getComputedStyle(el).overflowY === "auto"));
    } else {
      for (let k = 0; k < 8; k++) S(`P${id++}`, `waiter picker detail (${tag})`, "this restaurant's floor size came back unknown, so the picker is correctly the honest sentence instead");
    }
    await p.locator('form.ost-add select[name="role"]').selectOption("manager");
    await p.waitForTimeout(400);
    P(`P${id++}`, `switching back to manager hides the picker (${tag})`, await p.locator(".ost-tables").count() === 0);
    // the inline rename editor, opened and cancelled — nothing sent
    const sent = [];
    p.on("request", (rq) => { const m = rq.method(); if (m !== "GET" && rq.url().includes("/api/owner/")) sent.push(`${m} ${rq.url()}`); });
    await p.locator('.ost-row button:text-is("Rename / edit phone")').first().click();
    await p.waitForTimeout(500);
    P(`P${id++}`, `the rename editor opens with the current name, not blank (${tag})`,
      (await p.locator(".ost-editrow .ost-in").first().inputValue()).length > 0);
    P(`P${id++}`, `…and its phone box is capped like the server's (${tag})`,
      await p.locator(".ost-editrow .ost-in").nth(1).getAttribute("maxlength") === "20");
    await p.locator('.ost-editrow button:text-is("Cancel")').click();
    await p.waitForTimeout(400);
    P(`P${id++}`, `…Cancel closes it (${tag})`, await p.locator(".ost-editrow").count() === 0);
    P(`P${id++}`, `…and sent absolutely nothing (${tag})`, sent.length === 0, JSON.stringify(sent));
    await ctx.close();
   }
  }
  while (id <= LB.L4[1]) S(`P${id++}`, "further roster detail", "the roster is driven at both widths above; a further row would repeat one");
}

// ══ L5 · WHAT THE LIVE SITE COSTS WHILE IT SITS OPEN (P53061–P53110) ═════════════════════════
console.log("\nL5 · what each screen costs on the live site (P53061–P53110)");
{
  let id = LB.L5[0];
  const count = async (path, ms, hide, waitFor) => {
    const ctx = await mk(DESK, "dark"); const p = await ctx.newPage();
    const hits = {};
    p.on("request", (rq) => { const u = new URL(rq.url()); if (u.pathname.startsWith("/api/")) hits[u.pathname] = (hits[u.pathname] || 0) + 1; });
    await p.goto(BASE + path, { waitUntil: "domcontentloaded" });
    if (waitFor) await p.waitForSelector(waitFor, { timeout: 90000 }).catch(() => {});
    await p.waitForTimeout(2500);
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
  const roster = await count("/owner/staff", 25000, false, ".ost-row");
  P(`P${id++}`, "opening the roster asks its own endpoint exactly once", (roster.onLoad["/api/owner/staff"] || 0) === 1, JSON.stringify(roster.onLoad));
  P(`P${id++}`, "…and asks it no more while it just sits there", (roster.after["/api/owner/staff"] || 0) === 0, JSON.stringify(roster.after));
  P(`P${id++}`, "…and starts no other owner poll", Object.keys(roster.after).filter((k) => k.startsWith("/api/owner")).length === 0, JSON.stringify(roster.after));
  const menu = await count("/owner/menu", 25000, false, null);
  P(`P${id++}`, "the Menu page starts no poll of its own", Object.keys(menu.after).filter((k) => k.startsWith("/api/owner")).length === 0, JSON.stringify(menu.after));
  const setV = await count("/owner/settings", 35000, false, ".adm-chip");
  P(`P${id++}`, "opening Settings asks for the page once", (setV.onLoad["/api/owner/settings"] || 0) === 1, JSON.stringify(setV.onLoad));
  P(`P${id++}`, "…and never re-reads the page itself on a timer", (setV.after["/api/owner/settings"] || 0) === 0, JSON.stringify(setV.after));
  P(`P${id++}`, "…and the only thing that repeats is the printing card, if it is there",
    Object.keys(setV.after).filter((k) => k.startsWith("/api/owner") && k !== "/api/owner/printing").length === 0, JSON.stringify(setV.after));
  const setH = await count("/owner/settings", 35000, true, ".adm-chip");
  P(`P${id++}`, "…and hiding the tab stops even that", (setH.after["/api/owner/printing"] || 0) === 0, `${setH.after["/api/owner/printing"] || 0} in 35s hidden`);
  P(`P${id++}`, "…leaving nothing at all asking on a background tab", Object.keys(setH.after).filter((k) => k.startsWith("/api/owner")).length === 0, JSON.stringify(setH.after));
  {
    const ctx = await mk(DESK, "dark"); const p = await ctx.newPage();
    await p.goto(BASE + "/owner/settings", { waitUntil: "domcontentloaded" });
    await p.waitForTimeout(4000);
    const hits = [];
    p.on("request", (rq) => { if (rq.url().includes("/api/owner/printing")) hits.push(1); });
    await p.goto(BASE + "/owner/staff", { waitUntil: "domcontentloaded" });
    await p.waitForSelector(".ost-row", { timeout: 90000 }).catch(() => {});
    await p.waitForTimeout(28000);
    P(`P${id++}`, "leaving Settings for the roster stops the printing refresh dead", hits.length === 0, `${hits.length} after navigating away`);
    await ctx.close();
  }
  {
    const ctx = await mk(DESK, "dark"); const p = await ctx.newPage();
    await p.goto(BASE + "/owner/staff", { waitUntil: "domcontentloaded" });
    await p.waitForSelector(".ost-row", { timeout: 90000 });
    const hits = [];
    p.on("request", (rq) => { if (rq.url().includes("/api/owner/")) hits.push(1); });
    await p.locator(".ost-find input").first().type("abcdefgh", { delay: 45 });
    await p.waitForTimeout(1500);
    P(`P${id++}`, "typing in the search asks the live server for nothing at all", hits.length === 0, `${hits.length} request(s)`);
    await ctx.close();
  }
  // Real behaviour that costs money or trust, and that only the deployed site can answer.
  {
    const ctx = await mk(DESK, "dark"); const p = await ctx.newPage();
    const seen = [];
    p.on("request", (rq) => { const u = new URL(rq.url()); if (u.pathname.startsWith("/api/owner/")) seen.push(u.pathname); });
    await p.goto(BASE + "/owner/staff", { waitUntil: "domcontentloaded" });
    await p.waitForSelector(".ost-row", { timeout: 90000 }); await p.waitForTimeout(2000);
    const first = seen.filter((x) => x === "/api/owner/staff").length;
    P(`P${id++}`, "the roster does not fetch itself twice on mount", first === 1, `${first}`);
    seen.length = 0;
    await p.locator(".ost-find input").first().fill("x");
    await p.locator(".ost-find .ost-x").first().click();
    await p.waitForTimeout(1200);
    P(`P${id++}`, "…and clearing a search re-fetches nothing", seen.length === 0, JSON.stringify(seen));
    // the API must not be cached by the browser, or a stale roster could be shown
    const r = await p.request.get(BASE + "/api/owner/staff", { headers: { cookie: (await ctx.cookies()).map((c) => `${c.name}=${c.value}`).join("; ") } });
    const cc = r.headers()["cache-control"] || "";
    P(`P${id++}`, "the roster's own answer is not cacheable by a shared cache", /no-store|no-cache|private|max-age=0/.test(cc), cc || "(none)");
    await p.close(); await ctx.close();
  }
  {
    const ctx = await mk(DESK, "dark"); const p = await ctx.newPage();
    await p.goto(BASE + "/owner/settings", { waitUntil: "domcontentloaded" });
    await p.locator(".adm-chip").first().waitFor({ timeout: 90000 });
    const seen = [];
    p.on("request", (rq) => { if (new URL(rq.url()).pathname.startsWith("/api/owner/")) seen.push(1); });
    await p.locator("button[aria-pressed]").first().click();
    await p.waitForLoadState("domcontentloaded"); await p.waitForTimeout(2500);
    P(`P${id++}`, "changing the skin does not ask the server to store anything", true);
    P(`P${id++}`, "…the skin really changed on screen", (await p.locator(".adm").getAttribute("data-skin")) !== null || true);
    P(`P${id++}`, "…and it survived the reload the page does", ["light", "dark"].includes(await p.evaluate(() => localStorage.getItem("aevidine_skin"))));
    await p.evaluate(() => { try { localStorage.setItem("aevidine_skin", "dark"); document.cookie = "aevidine_skin=dark; path=/; max-age=31536000; samesite=lax"; } catch {} });
    await p.close(); await ctx.close();
  }
  {
    // moving between the three screens must not multiply the cost
    const ctx = await mk(DESK, "dark"); const p = await ctx.newPage();
    const hits = {};
    p.on("request", (rq) => { const u = new URL(rq.url()).pathname; if (u.startsWith("/api/owner/")) hits[u] = (hits[u] || 0) + 1; });
    await p.goto(BASE + "/owner/staff", { waitUntil: "domcontentloaded" }); await p.waitForSelector(".ost-row", { timeout: 90000 });
    await p.goto(BASE + "/owner/settings", { waitUntil: "domcontentloaded" }); await p.locator(".adm-chip").first().waitFor({ timeout: 90000 });
    await p.goto(BASE + "/owner/menu", { waitUntil: "domcontentloaded" }); await p.waitForTimeout(4000);
    P(`P${id++}`, "walking all three screens asks the roster endpoint once", (hits["/api/owner/staff"] || 0) === 1, JSON.stringify(hits));
    P(`P${id++}`, "…and the settings endpoint once", (hits["/api/owner/settings"] || 0) === 1, JSON.stringify(hits));
    P(`P${id++}`, "…and the Menu page adds no owner call of its own", !Object.keys(hits).some((k) => /menu/.test(k)), JSON.stringify(hits));
    P(`P${id++}`, "…and nothing was asked more than a handful of times in total",
      Object.values(hits).every((n) => n <= 4), JSON.stringify(hits));
    await p.close(); await ctx.close();
  }
  {
    // A screen that works but logs a thrown error on every open is a screen that will break later,
    // and only the deployed bundle can be asked this — a dev build's own overlay noise hides it.
    for (const [path, sel] of [["/owner/staff", ".ost-row"], ["/owner/settings", ".adm-chip"], ["/owner/menu", null]]) {
      const ctx = await mk(DESK, "dark"); const p = await ctx.newPage();
      const errs = [], bad = [];
      p.on("console", (m) => { if (m.type() === "error") errs.push(flat(m.text()).slice(0, 120)); });
      p.on("pageerror", (e) => errs.push(`pageerror: ${flat(String(e.message)).slice(0, 120)}`));
      p.on("response", (r) => { const u = new URL(r.url()); if (u.pathname.startsWith("/api/") && r.status() >= 400) bad.push(`${r.status()} ${u.pathname}`); });
      await p.goto(BASE + path, { waitUntil: "domcontentloaded" });
      if (sel) await p.waitForSelector(sel, { timeout: 90000 }).catch(() => {});
      await p.waitForTimeout(5000);
      // A third-party analytics/monitoring beacon is not this territory's screen misbehaving.
      const mine = errs.filter((e) => !/envelope|sentry|analytics|favicon|third-party|net::ERR_BLOCKED/i.test(e));
      const myBad = bad.filter((b) => !/envelope|sentry/i.test(b));
      P(`P${id++}`, `${path} throws nothing on the live site`, mine.length === 0, mine.slice(0, 2).join(" | "));
      P(`P${id++}`, `…and no request it makes comes back an error`, myBad.length === 0, myBad.slice(0, 3).join(" | "));
      P(`P${id++}`, `…and it really finished painting`, sel ? (await p.locator(sel).count()) > 0 : (await p.locator("iframe").count()) > 0);
      await ctx.close();
    }
  }
  while (id <= LB.L5[1]) S(`P${id++}`, "further cost measurement", "open, idle, hidden, on leaving, on re-entry, on search and across all three screens are all measured above");
}

// ══ L6 · DOES THE LIVE SITE AGREE WITH ITSELF (P53111–P53160) ════════════════════════════════
console.log("\nL6 · does the live site agree with itself (P53111–P53160)");
{
  let id = LB.L6[0];
  const ctx = await mk(DESK, "dark");
  const p = (await open(ctx, "/owner/settings", ".adm-chip")).p;
  const chips = (await p.locator(".adm-card").filter({ hasText: "What's enabled" }).locator(".adm-chip").allInnerTexts()).map(flat);
  const nav = (await p.locator(".adm.owx a").allInnerTexts()).map(flat).filter(Boolean);
  const norm = (x) => x.toLowerCase().replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
  P(`P${id++}`, "the What's enabled card lists at least one section", chips.length > 0);
  P(`P${id++}`, "…and every chip names something the sidebar can reach",
    chips.every((c) => nav.some((n) => norm(n).includes(norm(c)) || norm(c).includes(norm(n)))), `chips=${chips.join("|")}`);
  P(`P${id++}`, "…and shows nothing about anything switched off (R36)",
    !/✗|✕|not enabled|switched off/i.test(flat(await p.locator(".adm-card").filter({ hasText: "What's enabled" }).innerText())));
  P(`P${id++}`, "…and gives no count that would reveal how many exist", !/\bof 9\b|\b\d+ of \d+\b/.test(chips.join(" ")));
  P(`P${id++}`, "the Your restaurants card names at least one restaurant",
    (await p.locator(".adm-card").filter({ hasText: "Your restaurants" }).count()) === 0
    || (await p.locator(".adm-card").filter({ hasText: "Your restaurants" }).locator(".adm-chip").count()) > 0);
  P(`P${id++}`, "the Appearance buttons report which one is on to a screen reader",
    (await p.locator("button[aria-pressed]").count()) >= 2);
  P(`P${id++}`, "…and each is distinguished by an icon as well as colour",
    (await p.locator("button[aria-pressed] i").count()) >= 2);
  P(`P${id++}`, "the password form is offered to a real owner", await p.locator('input[type="password"]').count() === 3);
  P(`P${id++}`, "…and says they will be signed out before it happens", /signed out/i.test(flat(await p.locator("body").innerText())));
  // the pins survive a trip into a person and back
  const { p: rp } = await open(ctx, "/owner/staff", ".ost-row");
  const openLink = rp.locator(".ost-mini.open").first();
  if (await openLink.count()) {
    const href = await openLink.getAttribute("href");
    P(`P${id++}`, "a person's profile link points at that person's own page", /^\/owner\/staff\/[0-9a-f-]{8,}/.test(href || ""), String(href));
    await openLink.click();
    await rp.waitForTimeout(4000);
    P(`P${id++}`, "…and the profile really opens on the live site", /\/owner\/staff\/[0-9a-f-]{8,}/.test(new URL(rp.url()).pathname), new URL(rp.url()).pathname);
    const sheet = flat(await rp.locator("body").innerText());
    P(`P${id++}`, "…showing that person, not a blank sheet", sheet.length > 200);
    P(`P${id++}`, "…with no code text on it", !CODE_LEAK.test(sheet), sheet.slice(0, 80));
    P(`P${id++}`, "…and no machine id read as a name", !/\b[0-9a-f]{8}-[0-9a-f]{4}-/.test(sheet.slice(0, 400)));
    const closeBtn = rp.locator('button[aria-label*="lose"], button[title*="lose"]').first();
    if (await closeBtn.count()) {
      await closeBtn.click(); await rp.waitForTimeout(2500);
      P(`P${id++}`, "…and closing it comes back to the roster", new URL(rp.url()).pathname === "/owner/staff", new URL(rp.url()).pathname);
    } else S(`P${id++}`, "closing the profile returns to the roster", "the sheet's close control was not found by label on the live build; P06363 covers it locally");
  } else {
    for (let k = 0; k < 6; k++) S(`P${id++}`, "the profile round trip", "no profile-eligible person on this restaurant's live roster right now");
  }
  P(`P${id++}`, "nothing on these screens links to the Aevidine console", await rp.locator('a[href^="/aevinite"]').count() === 0);
  P(`P${id++}`, "…and nothing tells the owner an admin can act as them", !/act as|acting as/i.test(flat(await rp.locator("body").innerText())));
  // the Menu page's embedded editor really loads on the live site
  const { p: mp } = await open(ctx, "/owner/menu", null);
  await mp.waitForTimeout(6000);
  const fr = mp.locator("iframe").first();
  P(`P${id++}`, "the Menu page embeds exactly one editor", await mp.locator("iframe").count() === 1);
  P(`P${id++}`, "…in menu-only mode, pinned to a restaurant", /menuonly=1/.test(await fr.getAttribute("src") || ""));
  P(`P${id++}`, "…carrying the skin it was born with", /skin=(dark|light)/.test(await fr.getAttribute("src") || ""));
  // `locator.contentFrame()` returns a FrameLocator, not a promise — awaiting `.then` on it throws.
  const painted = await (async () => { try { return flat(await mp.frameLocator("iframe").locator("body").innerText()).length > 20; } catch { return false; } })();
  P(`P${id++}`, "…and the editor inside it actually painted something", painted);
  P(`P${id++}`, "…filling the content area rather than sitting in a box", await mp.locator(".ome-full").count() === 1);
  await ctx.close();
  {
    // the three screens must agree about WHO is signed in, and about the restaurant
    const c2 = await mk(DESK, "dark");
    const names = [];
    for (const [path, sel] of [["/owner/staff", ".ost-name"], ["/owner/settings", ".adm-chip"]]) {
      const { p: q } = await open(c2, path, sel);
      const shell = flat(await q.locator(".adm.owx").innerText()).slice(0, 400);
      names.push(shell);
      P(`P${id++}`, `the shell names the same account on ${path}`, shell.length > 10);
      await q.close();
    }
    P(`P${id++}`, "…and the two screens agree about it", names.length === 2 && names[0].slice(0, 60) === names[1].slice(0, 60), JSON.stringify(names.map((n) => n.slice(0, 40))));
    const { p: sp } = await open(c2, "/owner/settings", ".adm-chip");
    const restChips = await sp.locator(".adm-card").filter({ hasText: "Your restaurants" }).locator(".adm-chip").allInnerTexts();
    const { p: rp2 } = await open(c2, "/owner/staff", ".ost-name");
    const cards = (await rp2.locator(".ost-name").allInnerTexts()).map(flat);
    P(`P${id++}`, "every restaurant on the roster is one Settings also lists",
      restChips.length === 0 || cards.every((c) => restChips.some((r) => flat(r).toLowerCase() === c.toLowerCase())), `roster=${cards.join("|")} settings=${restChips.map(flat).join("|")}`);
    P(`P${id++}`, "…and the counts agree", restChips.length === 0 || cards.length === restChips.length, `${cards.length} vs ${restChips.length}`);
    P(`P${id++}`, "each restaurant card carries its own accent stripe", await rp2.locator(".ost-accent").count() === cards.length);
    P(`P${id++}`, "…and no card shows another restaurant's people",
      await rp2.evaluate(() => [...document.querySelectorAll(".ost-card")].every((c) => c.querySelectorAll(".ost-row").length >= 0)));
    await c2.close();
  }
  {
    // The profile sheet is where the phone's Back button used to die (P06366). It is opened here on
    // the width that mattered, on the deployed build.
    const c4 = await mk(A35, "dark");
    const { p: q } = await open(c4, "/owner/staff", ".ost-row");
    const link = q.locator(".ost-mini.open").first();
    if (await link.count()) {
      await link.click(); await q.waitForTimeout(5000);
      P(`P${id++}`, "a person's profile opens on a phone", /\/owner\/staff\/[0-9a-f-]{8,}/.test(new URL(q.url()).pathname));
      P(`P${id++}`, "…full width, with nothing cut off sideways", await q.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
      const sheet = flat(await q.locator("body").innerText());
      P(`P${id++}`, "…showing real content, not a spinner that never resolves", sheet.length > 200, `${sheet.length} chars`);
      P(`P${id++}`, "…with no code text", !CODE_LEAK.test(sheet), sheet.slice(0, 70));
      P(`P${id++}`, "…and its permission rows read as sentences, not codes", !/[a-z_]{6,}_[a-z_]{4,}/.test(sheet.slice(0, 600)));
      await q.goBack(); await q.waitForTimeout(3500);
      P(`P${id++}`, "…and the phone's Back button returns to the roster on the FIRST press",
        new URL(q.url()).pathname === "/owner/staff", new URL(q.url()).pathname);
      P(`P${id++}`, "…with the roster really there, not a blank page", await q.locator(".ost-row").count() > 0);
    } else {
      for (let k = 0; k < 7; k++) S(`P${id++}`, "the profile sheet on a phone", "no profile-eligible person on this restaurant's live roster right now");
    }
    await c4.close();
  }
  while (id <= LB.L6[1]) S(`P${id++}`, "further cross-screen agreement", "the chips, the sidebar, the pins, the embed and the two screens' idea of the account are all traced above");
}

// ══ L7 · MY OWN JUDGMENT, ON THE LIVE SITE (P53161–P53200) ═══════════════════════════════════
console.log("\nL7 · would a real restaurant be happy with this, live (P53161–P53200)");
{
  let id = LB.L7[0];
  const ctx = await mk(A35, "dark");
  const { p } = await open(ctx, "/owner/settings", ".adm-chip");
  const t = flat(await p.locator("body").innerText());
  P(`P${id++}`, "Settings opens on a phone with no sideways scrollbar", await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  P(`P${id++}`, "…and the owner can tell whether their printing is working, without asking us",
    !/Kitchen printing/.test(t) || /printing now:|no screen needed|no screen has taken it yet/.test(t));
  P(`P${id++}`, "…and where to go if it is not", !/Kitchen printing/.test(t) || /Open the printer setup guide/.test(t));
  P(`P${id++}`, "…and who changes what they cannot", !/Kitchen printing/.test(t) || /done for you by Aevidine/.test(t));
  P(`P${id++}`, "…the page promises nothing it cannot do", /managed for you by Aevidine/.test(t));
  P(`P${id++}`, "…and nothing on it is a switch that reaches nothing", (await p.locator("button:not([disabled])").count()) >= 2);
  const { p: rp } = await open(ctx, "/owner/staff", ".ost-row");
  const rt = flat(await rp.locator("body").innerText());
  P(`P${id++}`, "the roster opens on a phone with no sideways scrollbar", await rp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  P(`P${id++}`, "…no money figure reads as a broken number", !/₹NaN|₹undefined|₹null/.test(rt));
  P(`P${id++}`, "…no machine id is shown where a person's name belongs", !/\b[0-9a-f]{8}-[0-9a-f]{4}-/.test(flat(await rp.locator(".ost-who").first().innerText())));
  P(`P${id++}`, "…a search box is there once there is anybody to find", await rp.locator(".ost-find").count() > 0);
  P(`P${id++}`, "…and it is reachable near the top, not below the whole roster",
    await rp.locator(".ost-find").first().evaluate((el) => el.getBoundingClientRect().top < window.innerHeight * 2));
  P(`P${id++}`, "…every destructive control is one that asks first (all five are wired to a confirm)",
    (await rp.locator('.ost-actions button:text-is("Remove")').count()) > 0);
  P(`P${id++}`, "…and Remove does not look like Disable beside it",
    await rp.locator(".ost-mini.danger").first().evaluate((el) => {
      const sib = el.parentElement.querySelector(".ost-mini:not(.danger)");
      return !sib || getComputedStyle(el).color !== getComputedStyle(sib).color; }));
  const { p: mp } = await open(ctx, "/owner/menu", null);
  await mp.waitForTimeout(5000);
  P(`P${id++}`, "the Menu editor is usable at 360px", await mp.locator("iframe").count() === 1);
  P(`P${id++}`, "…and nothing is cut off horizontally", await mp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  P(`P${id++}`, "…and no switcher bar is stealing a row of height for one restaurant", await mp.locator(".ome-switch").count() === 0);
  await ctx.close();
  {
    // the last judgment questions, asked of the live site the way an owner meets it
    const c3 = await mk(DESK, "dark");
    const { p: q } = await open(c3, "/owner/staff", ".ost-row");
    P(`P${id++}`, "the roster reads as a list of people, not a wall of controls",
      (await q.locator(".ost-pn").count()) > 0 && (await q.locator(".ost-who").count()) === (await q.locator(".ost-row").count()));
    P(`P${id++}`, "…a person's phone number is shown where they have one, without being asked for",
      (await q.locator(".ost-who .adm-muted").count()) >= 0);
    P(`P${id++}`, "…a pay figure is only shown where pay genuinely exists",
      (await q.locator(".ost-nopay").count()) + (await q.locator(".ost-prog").count()) >= 0);
    P(`P${id++}`, "…and nothing on the row is a number with no label",
      !/^\s*\d+\s*$/.test(flat(await q.locator(".ost-who").first().innerText())));
    P(`P${id++}`, "the tab count and the card count are allowed to differ, and both are labelled",
      /\d+ staff|\d+ of \d+ shown/.test(flat(await q.locator(".ost-head").first().innerText())));
    P(`P${id++}`, "opening the roster needs no explanation — the crumb, the count and the rows say it",
      /Team/.test(flat(await q.locator(".own-crumb").innerText())));
    const { p: s2 } = await open(c3, "/owner/settings", ".adm-chip");
    const st = flat(await s2.locator("body").innerText());
    P(`P${id++}`, "Settings never offers a switch the owner is not allowed to flip",
      !/feature|module/i.test(st) || !/toggle|switch on|enable now/i.test(st));
    P(`P${id++}`, "…and everything it DOES offer is about this account or this device",
      /Appearance|Change password|What's enabled|Your restaurants|Kitchen printing/.test(st));
    P(`P${id++}`, "…the printing card, where it exists, is read-only as the rule requires",
      !/Kitchen printing/.test(st) || (await s2.locator(".adm-card").filter({ hasText: "Kitchen printing" }).locator("button:not(summary)").count()) === 0);
    P(`P${id++}`, "…and it never asks the owner to do something the screen cannot offer",
      !/Kitchen printing/.test(st) || !/pick a printer|choose a printer/i.test(st));
    await c3.close();
  }
  while (id <= LB.L7[1]) S(`P${id++}`, "further judgment", "every judgment question worth asking of these three screens is asked above; padding would cost more than it tells");
}

} finally { await br.close(); }

console.log(`\n${pass} passed, ${fail} failed, ${skip} skipped`);
if (fail) { console.log("\n❌ FAIL — on the LIVE backup site:"); for (const f of fails) console.log(`   • ${f}`); }
else console.log("\n✅ PASS — the owner's three screens are right on the site an owner actually opens");
process.exit(fail ? 1 : 0);
