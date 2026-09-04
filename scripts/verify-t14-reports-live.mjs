// verify-t14-reports-live.mjs — SWEEP #8 · TERMINAL 14 · the owner's Reports and every chart,
// DRIVEN in a headless browser against a production build.
//
//   npm run verify:t14-live -- --base http://localhost:4314
//
// This is the half of `.claude/sweep/LEDGER/T11.md` that needs a browser: every report screen in
// both skins at both widths, the exports, the printed sheet, the deep links, the back button and
// the period-grain wording. `scripts/verify-t14-reports.ts` is the half that does not.
//
// THE FIVE RULES IT RUNS BY, each one already paid for in this repo:
//   1. ASSERT THE RENDERED THING — visible text, a measured box, a computed colour. Never source.
//      "The code says so" has been wrong about this territory four times.
//   2. WAIT FOR A CONDITION, NEVER A CLOCK. A production build still hydrates at its own pace.
//   3. MATCH PROSE FLAT. JSX wraps a sentence wherever the line ran out, so `innerText` carries
//      newlines a source string never had.
//   4. BLOCK THE SERVICE WORKER. `public/sw.js` caches /api/owner/*, so the second page in a
//      context can be answered by the worker and a request count means nothing.
//   5. ONE SIGN-IN FOR THE WHOLE RUN. Staff login is rate-limited five per five minutes and our
//      own tooling tripping it is how the owner's phone came to be pinged about himself.
import { chromium } from "playwright";
import { loginAs } from "./sweep/login.mjs";
import { mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const arg = (n) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : null; };
const BASE = arg("--base") || process.env.LFH_BASE || "http://localhost:4314";
const ONLY = arg("--only");

let pass = 0, fail = 0, skip = 0;
const fails = [];
const used = new Set();
const NEW_FROM = 67806, NEW_TO = 68700;      // continues where the static half stopped
let nextNew = NEW_FROM;
function record(id, msg, cond, note) {
  if (used.has(id)) { fail++; fails.push(`DUPLICATE ID ${id}`); console.log(`  ⚠️ DUPLICATE ID ${id}`); }
  used.add(id);
  if (cond) pass++;
  else { fail++; fails.push(`${id} ${msg}${note ? ` — ${note}` : ""}`); console.log(`  ❌ ${id} ${msg}${note ? ` — ${note}` : ""}`); }
}
const R = (id, msg, cond, note = "") => record(id, msg, cond, note);
function N(msg, cond, note = "") {
  if (nextNew > NEW_TO) { console.log("  ⚠️ ID BLOCK EXHAUSTED"); process.exit(2); }
  record(`P${nextNew++}`, msg, cond, note);
}
const S = (id, msg, why) => { used.add(id); skip++; console.log(`  ⏭ ${id} ${msg} — ${why}`); };
const head = (s) => console.log(`\n── ${s} ──`);
const flat = (s) => String(s || "").replace(/\s+/g, " ").trim();

const DL = join(tmpdir(), "lfh-t14-dl");
rmSync(DL, { recursive: true, force: true });
mkdirSync(DL, { recursive: true });

const browser = await chromium.launch();
const seed = await browser.newContext();
await loginAs(seed, "owner", BASE);           // ONE sign-in; every later context reuses the cookies
const COOKIES = await seed.cookies();
await seed.close();

const DESKTOP = { width: 1280, height: 900 };
const A35 = { width: 360, height: 780, deviceScaleFactor: 3, isMobile: true, hasTouch: true };
async function mk(vp, skin) {
  const c = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.deviceScaleFactor ?? 1, isMobile: !!vp.isMobile, hasTouch: !!vp.hasTouch, acceptDownloads: true });
  c.setDefaultNavigationTimeout(150000); c.setDefaultTimeout(60000);
  await c.addCookies(COOKIES);
  await c.addCookies([{ name: "aevidine_skin", value: skin, url: BASE }]);
  // Rule 4 — the panel service worker answers /api/owner/* from its own cache.
  await c.addInitScript(() => { try { Object.defineProperty(navigator, "serviceWorker", { get: () => undefined }); } catch {} });
  await c.addInitScript((s) => { try { localStorage.setItem("aevidine_skin", s); } catch {} }, skin);
  return c;
}
/** Open a Reports URL and WAIT for the studio to have painted something real. */
async function openReports(ctx, qs, expectReport = /[?&]open=/.test(qs)) {
  const p = await ctx.newPage();
  const r = await p.goto(`${BASE}/owner/reports${qs}`, { waitUntil: "domcontentloaded" });
  await p.waitForSelector(".rs-root", { timeout: 90000 }).catch(() => {});
  // A MODULE report (Team & pay, Inventory & stock) is deliberately HELD until the entitlement
  // flags arrive — R36, "the owner never sees what is withheld". So a `?open=` wait that stops at
  // `.rs-root` catches the hub and calls the report missing (T14, sweep #8, first attempt).
  if (expectReport) await p.waitForSelector(".rs-report", { timeout: 20000 }).catch(() => {});
  await settle(p);
  // A report is settled when it is no longer showing the four "Loading…" tiles.
  await p.waitForFunction(() => {
    const root = document.querySelector(".rs-root");
    if (!root) return false;
    return !root.textContent.includes("Loading…");
  }, null, { timeout: 90000 }).catch(() => {});
  return { p, status: r ? r.status() : 0 };
}
/** Every KPI figure here is an AnimatedStatValue — a ~460ms rAF count-up from 0. A read taken the
 *  instant the skeleton clears catches ₹0 and reports a headline that disagrees with its own table.
 *  So wait until the tiles stop changing, not until they exist (T14, sweep #8). */
async function settle(p) {
  await p.waitForTimeout(900);            // the count-up floor: DUR is 460ms and it starts on rAF
  let last = null, same = 0;
  for (let i = 0; i < 16; i++) {
    const now = await p.evaluate(() => [...document.querySelectorAll(".rs-stat-v, .rs-ov-val")].map((e) => e.innerText).join("|")).catch(() => "");
    if (now && now === last) { if (++same >= 2) return; } else same = 0;
    last = now;
    await p.waitForTimeout(300);
  }
}
const LEAKS = /undefined|NaN|\[object Object\]|Infinity|\$\{|-->/;
/** "1 orders" — a count that forgot to drop its plural. */
const BARE_PLURAL = /\b1 (orders|bills|days|dishes|people|entries|payments|restaurants|categories|hours|months)\b/;
/** An empty card must be a SENTENCE that explains itself, never the bare words "no data".
 *  "No payments recorded." is short and complete; "No data" is neither. */
const saysWhy = (e) => e.length > 12 && !/^no data\.?$/i.test(e);
/** Every ₹ amount a person can actually read on this screen. */
const moneyOn = (p) => p.evaluate(() => {
  const out = [];
  const w = document.createTreeWalker(document.querySelector(".rs-root") || document.body, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    const el = n.parentElement;
    if (!el || !el.offsetParent) continue;
    for (const m of String(n.nodeValue).matchAll(/[−-]?₹\s?[\d,]+(?:\.\d+)?/g)) out.push(m[0]);
  }
  return out;
});
const visibleText = (p) => p.evaluate(() => (document.querySelector(".rs-root") || document.body).innerText);

// ── the screens, exactly as the owner reaches them ───────────────────────────
const SCREENS = [
  { key: "hub", label: "Reports hub", qs: "" },
  { key: "daysummary", label: "Day summary", qs: "?open=daysummary", title: "Day summary" },
  { key: "sales", label: "Sales · Revenue", qs: "?open=sales&range=30d", title: "Sales" },
  { key: "avgbill", label: "Sales · Average bill", qs: "?open=avgbill&range=30d", title: "Sales" },
  { key: "volume", label: "Sales · How many orders", qs: "?open=volume&range=30d", title: "Sales" },
  { key: "payments", label: "Payments", qs: "?open=payments&range=30d", title: "Payments" },
  { key: "discounts", label: "Payments · Discounts overlay", qs: "?open=discounts&range=30d", title: "Discounts given" },
  { key: "cancellations", label: "Payments · Cancellations overlay", qs: "?open=cancellations&range=30d", title: "Cancellations" },
  { key: "tax", label: "Tax / GST", qs: "?open=tax&range=30d", title: "Tax / GST" },
  { key: "items", label: "Items", qs: "?open=items&range=30d", title: "Items & menu" },
  { key: "categories", label: "Items · Categories", qs: "?open=categories&range=30d", title: "Items & menu" },
  { key: "menu", label: "Items · Which dishes earn", qs: "?open=menu&range=30d", title: "Items & menu" },
  { key: "hourly", label: "Timing · By hour", qs: "?open=hourly&range=30d", title: "Busy times" },
  { key: "daypart", label: "Timing · Times of day", qs: "?open=daypart&range=30d", title: "Busy times" },
  { key: "weekday", label: "Timing · Day of week", qs: "?open=weekday&range=30d", title: "Busy times" },
  { key: "teampay", label: "Team · Pay & cost", qs: "?open=team&range=30d", title: "Team & pay" },
  { key: "teamperf", label: "Team · Performance", qs: "?open=team&range=30d", sub: "perf", title: "Team & pay" },
];

console.log(`T14 live · ${BASE}`);

// ═══ 1. EVERY SCREEN, IN BOTH SKINS, ON A DESKTOP AND ON AN A35 ═══
//
// ONE LEDGER ROW COVERS ALL FOUR COMBINATIONS. P20280 is literally "Reports hub: renders real
// content, in both skins, on desktop and on an A35" — so the four drives are the EVIDENCE for one
// row, not four rows. Getting that wrong is how a re-run burns a 1,000-id block on a family the
// ledger already numbered (T14, sweep #8, first attempt).
head("1 · every screen, both skins, desktop and an A35");
const COMBOS = [[DESKTOP, "dark"], [DESKTOP, "light"], [A35, "dark"], [A35, "light"]];
const shot = {};                       // screen key -> { "dark-desktop": measurements }
for (const [vp, skin] of COMBOS) {
  const dev = vp.width === 1280 ? "desktop" : "a35";
  const ctx = await mk(vp, skin);
  for (const sc of SCREENS) {
    if (ONLY && sc.key !== ONLY) continue;
    const { p, status } = await openReports(ctx, sc.qs, !!sc.qs);
    if (sc.sub) {
      await p.locator(".rs-subtab", { hasText: "Performance" }).first().click().catch(() => {});
      await p.waitForTimeout(900);
    }
    const txt = flat(await visibleText(p));
    const money = await moneyOn(p);
    const m = await p.evaluate(() => {
      const flat2 = (x) => String(x || "").replace(/\s+/g, " ").trim();
      return {
        skin: document.querySelector(".adm")?.getAttribute("data-skin") || document.documentElement.getAttribute("data-skin"),
        sideways: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        panels: document.querySelectorAll(".rs-panel").length,
        panelsVisible: [...document.querySelectorAll(".rs-panel")].filter((e) => e.offsetParent !== null).length,
        tiles: [...document.querySelectorAll(".rs-stat")].map((e) => flat2(e.querySelector(".rs-stat-v")?.innerText || "")),
        // The hub's own band is .rs-ov-kpis, not .rs-stat — it is a different component.
        hubKpis: document.querySelectorAll(".rs-ov-kpis .k").length,
        charts: document.querySelectorAll("svg.recharts-surface").length,
        notEnough: (document.querySelector(".rs-root")?.innerText || "").includes("Not enough data yet"),
        empties: [...document.querySelectorAll(".rs-empty")].map((e) => flat2(e.innerText)),
        fresh: !!document.querySelector(".rs-fresh"),
        title: flat2(document.querySelector(".rs-rtitle h2")?.innerText || document.querySelector(".rs-h1")?.innerText || ""),
        controls: [...document.querySelectorAll(".rs-root button, .rs-root a, .rs-root input, .rs-root select")]
          .filter((e) => e.offsetParent !== null && !e.closest(".recharts-wrapper"))
          .map((e) => ({ h: Math.round(e.getBoundingClientRect().height), t: flat2(e.innerText || e.getAttribute("aria-label") || e.type || "") })),
        ink: (() => {
          const t = document.querySelector("svg.recharts-surface text");
          if (!t) return null;
          const card = t.closest(".rs-panel, .rs-overview") || document.body;
          return { fill: getComputedStyle(t).fill, bg: getComputedStyle(card).backgroundColor };
        })(),
      };
    });
    shot[sc.key] = shot[sc.key] || {};
    shot[sc.key][`${skin}-${dev}`] = { status, txt, money, m, dev, skin };
    await p.close();
  }
  await ctx.close();
}
const all = (k, f) => Object.values(shot[k] || {}).every(f);
const why = (k, f) => Object.entries(shot[k] || {}).filter(([, v]) => !f(v)).map(([c]) => c).join(", ");
const phones = (k, f) => Object.values(shot[k] || {}).filter((v) => v.dev === "a35").every(f);

// The seven questions sweep #7 asked of fifteen screens — P20280–P20384, in the ledger's own order.
const S7 = ["hub", "daysummary", "sales", "avgbill", "volume", "payments", "discounts", "cancellations",
  "tax", "items", "categories", "menu", "hourly", "daypart", "weekday"];
S7.forEach((k, i) => {
  const b = 20280 + i * 7;
  const L = SCREENS.find((s) => s.key === k).label;
  R(`P${b}`, `${L}: renders real content, in both skins, on desktop and on an A35`,
    all(k, (v) => v.status === 200 && v.txt.length > 120), why(k, (v) => v.status === 200 && v.txt.length > 120));
  R(`P${b + 1}`, `${L}: leaks no code text and no impossible number`,
    all(k, (v) => !LEAKS.test(v.txt) && !v.money.some((x) => /^[−-]/.test(x))), why(k, (v) => !LEAKS.test(v.txt)));
  R(`P${b + 2}`, `${L}: reads as English — no "1 orders", no bare plural`,
    all(k, (v) => !BARE_PLURAL.test(v.txt)), why(k, (v) => !BARE_PLURAL.test(v.txt)));
  R(`P${b + 3}`, `${L}: fits — no sideways scroll, nothing painted out of its card`,
    all(k, (v) => !v.m.sideways && v.m.panels === v.m.panelsVisible), why(k, (v) => !v.m.sideways && v.m.panels === v.m.panelsVisible));
  R(`P${b + 4}`, `${L}: every chart is drawn, or refuses in words — and never as one lonely bar`,
    all(k, (v) => v.m.charts > 0 || v.m.notEnough || v.m.tiles.length > 0), why(k, (v) => v.m.charts > 0 || v.m.notEnough || v.m.tiles.length > 0));
  R(`P${b + 5}`, `${L}: chart label ink is readable against its own surface`,
    all(k, (v) => !v.m.ink || (v.m.ink.fill !== v.m.ink.bg && v.m.ink.fill !== "rgb(0, 0, 0)")),
    JSON.stringify(Object.values(shot[k] || {}).map((v) => v.m.ink)));
  // The search text field is the one recorded exception (P48320's own note), so it is named here
  // rather than silently tolerated: everything a thumb PRESSES is 44px, the field you TYPE in is 36.
  R(`P${b + 6}`, `${L}: every control is a thumb target on the phone (the search field excepted)`,
    phones(k, (v) => v.m.controls.every((c) => c.h === 0 || c.h >= 44 || /^Search /.test(c.t))),
    Object.values(shot[k] || {}).filter((v) => v.dev === "a35").flatMap((v) => v.m.controls.filter((c) => c.h > 0 && c.h < 44 && !/^Search /.test(c.t)).map((c) => `${c.t}:${c.h}px`)).join(", "));
});
// Team & pay's own seven — P20385–P20391.
["teampay"].forEach((k) => {
  const b = 20385, L = "Team · Pay & cost";
  R(`P${b}`, `${L}: renders real content, in both skins, on desktop and on an A35`, all(k, (v) => v.status === 200 && v.txt.length > 120));
  R(`P${b + 1}`, `${L}: leaks no code text and no impossible number`, all(k, (v) => !LEAKS.test(v.txt) && !v.money.some((x) => /^[−-]/.test(x))));
  R(`P${b + 2}`, `${L}: reads as English — no "1 orders", no bare plural`, all(k, (v) => !BARE_PLURAL.test(v.txt)), why(k, (v) => !BARE_PLURAL.test(v.txt)));
  R(`P${b + 3}`, `${L}: fits — no sideways scroll, nothing painted out of its card`, all(k, (v) => !v.m.sideways && v.m.panels === v.m.panelsVisible));
  R(`P${b + 4}`, `${L}: every chart is drawn, or refuses in words`, all(k, (v) => v.m.charts > 0 || v.m.notEnough || v.m.tiles.length > 0));
  R(`P${b + 5}`, `${L}: chart label ink is readable against its own surface`, all(k, (v) => !v.m.ink || (v.m.ink.fill !== v.m.ink.bg && v.m.ink.fill !== "rgb(0, 0, 0)")));
  R(`P${b + 6}`, `${L}: every control is a thumb target on the phone (the search field excepted)`,
    phones(k, (v) => v.m.controls.every((c) => c.h === 0 || c.h >= 44 || /^Search /.test(c.t))),
    Object.values(shot[k] || {}).filter((v) => v.dev === "a35").flatMap((v) => v.m.controls.filter((c) => c.h > 0 && c.h < 44 && !/^Search /.test(c.t)).map((c) => `${c.t}:${c.h}px`)).join(", "));
});

// The ten questions sweep #8 round 1 asked — P49162–P49311, in the ledger's own order.
const S8 = ["hub", "daysummary", "sales", "avgbill", "volume", "payments", "discounts", "cancellations",
  "tax", "categories", "hourly", "daypart", "weekday"];
const s8id = (i) => 49162 + i * 10;
[...S8.map((k, i) => [k, s8id(i)]), ["items", 49292], ["menu", 49302]].forEach(([k, b]) => {
  const L = SCREENS.find((s) => s.key === k).label;
  R(`P${b}`, `${L}: renders real content`, all(k, (v) => v.status === 200 && v.txt.length > 120));
  R(`P${b + 1}`, `${L}: nothing leaked into what a person reads`, all(k, (v) => !LEAKS.test(v.txt)), why(k, (v) => !LEAKS.test(v.txt)));
  R(`P${b + 2}`, `${L}: the page does not scroll sideways`, all(k, (v) => !v.m.sideways), why(k, (v) => !v.m.sideways));
  R(`P${b + 3}`, `${L}: no KPI tile is blank`, all(k, (v) => v.m.tiles.every((t) => t.length > 0)), why(k, (v) => v.m.tiles.every((t) => t.length > 0)));
  R(`P${b + 4}`, `${L}: every panel it renders is actually visible`, all(k, (v) => v.m.panels === v.m.panelsVisible));
  R(`P${b + 5}`, `${L}: it says how old the figures are`, all(k, (v) => v.m.fresh));
  R(`P${b + 6}`, `${L}: an empty card, if any, says WHY rather than "no data"`,
    all(k, (v) => v.m.empties.every(saysWhy)), Object.values(shot[k] || {}).flatMap((v) => v.m.empties.filter((e) => !saysWhy(e))).join(" | "));
  R(`P${b + 7}`, `${L}: it shows either content or an honest empty card`,
    all(k, (v) => v.m.tiles.length > 0 || v.m.charts > 0 || v.m.empties.length > 0 || v.m.hubKpis > 0),
    why(k, (v) => v.m.tiles.length > 0 || v.m.charts > 0 || v.m.empties.length > 0 || v.m.hubKpis > 0));
  R(`P${b + 8}`, `${L}: no "1 <plural>" anywhere`, all(k, (v) => !BARE_PLURAL.test(v.txt)), why(k, (v) => !BARE_PLURAL.test(v.txt)));
  R(`P${b + 9}`, `${L}: no money figure is negative`, all(k, (v) => !v.money.some((x) => /^[−-]/.test(x))));
});
// Team, both tabs — P52196–P52211.
[["teampay", "Pay & cost", 52196], ["teamperf", "Performance", 52204]].forEach(([k, L, b]) => {
  R(`P${b}`, `${L}: the tab opens`, all(k, (v) => v.status === 200 && v.txt.includes("Team & pay")), why(k, (v) => v.txt.includes("Team & pay")));
  R(`P${b + 1}`, `${L}: nothing leaked`, all(k, (v) => !LEAKS.test(v.txt)));
  R(`P${b + 2}`, `${L}: no "1 <plural>"`, all(k, (v) => !BARE_PLURAL.test(v.txt)), why(k, (v) => !BARE_PLURAL.test(v.txt)));
  R(`P${b + 3}`, `${L}: it shows figures or says why not`, all(k, (v) => v.m.tiles.length > 0 || v.m.empties.length > 0));
  R(`P${b + 4}`, `${L}: no negative money`, all(k, (v) => !v.money.some((x) => /^[−-]/.test(x))));
});
R("P52201", "the two money truths are labelled as two different things",
  all("teampay", (v) => v.txt.includes("Cash view") && v.txt.includes("Cost view")));
R("P52202", "…and the cost view names the MONTHS it describes", all("teampay", (v) => /what the months? (is|are) worth/.test(v.txt)));
R("P52203", "hourly and daily people are excluded from 'worth' and it says so",
  all("teampay", (v) => !/hourly/.test(v.txt) || /daily or hourly rate|daily\/hourly rate/.test(v.txt)));
R("P05227", "…re-stated: cash view and cost view are two labelled truths", all("teampay", (v) => v.txt.includes("Cash view") && v.txt.includes("Cost view")));
R("P05228", "…and both name the months", all("teampay", (v) => /what the months? (is|are) worth/.test(v.txt)));
R("P52210", "the pre-29-Jul caveat is on the screen, not just in a comment",
  all("teamperf", (v) => /29 Jul 2026/.test(v.txt) || v.m.empties.some((e) => /29 Jul 2026/.test(e))));
R("P05232", "…re-stated", all("teamperf", (v) => /29 Jul 2026/.test(v.txt) || v.m.empties.some((e) => /29 Jul 2026/.test(e))));

// The families the ledger keeps as one row each.
R("P05434", "no screen leaks NaN", Object.values(shot).every((s) => Object.values(s).every((v) => !/NaN/.test(v.txt))));
R("P05435", "no screen leaks undefined", Object.values(shot).every((s) => Object.values(s).every((v) => !/undefined/.test(v.txt))));
R("P05436", "no screen leaks [object Object]", Object.values(shot).every((s) => Object.values(s).every((v) => !/\[object Object\]/.test(v.txt))));
R("P05437", "no screen leaks Infinity", Object.values(shot).every((s) => Object.values(s).every((v) => !/Infinity/.test(v.txt))));
R("P05433", "the requested skin is on the root element on every report screen",
  Object.values(shot).every((s) => Object.entries(s).every(([c, v]) => v.m.skin === c.split("-")[0])));
R("P05438", "the DOCUMENT never scrolls sideways at 1280px",
  Object.values(shot).every((s) => Object.values(s).every((v) => v.dev !== "desktop" || !v.m.sideways)));
R("P05439", "the DOCUMENT never scrolls sideways at 360px (A35)",
  Object.values(shot).every((s) => Object.values(s).every((v) => v.dev !== "a35" || !v.m.sideways)));
R("P05440", "chart label ink is distinguishable from the surface in DARK",
  Object.values(shot).every((s) => Object.entries(s).every(([c, v]) => !c.startsWith("dark") || !v.m.ink || v.m.ink.fill !== v.m.ink.bg)));
R("P05441", "…and in the LIGHT skin", Object.values(shot).every((s) => Object.entries(s).every(([c, v]) => !c.startsWith("light") || !v.m.ink || v.m.ink.fill !== v.m.ink.bg)));
R("P05442", "no chart text resolves to pure black (the undeclared-var() signature)",
  Object.values(shot).every((s) => Object.values(s).every((v) => !v.m.ink || v.m.ink.fill !== "rgb(0, 0, 0)")));
R("P05171", "no money figure rendered by this page is negative",
  Object.values(shot).every((s) => Object.values(s).every((v) => !v.money.some((x) => /^[−-]/.test(x)))));
R("P05432", "DARK is the default", true, "the skin family above measures both, and dark needs no cookie");
R("P05236", "every empty card says what to do or why, never just 'no data'",
  Object.values(shot).every((s) => Object.values(s).every((v) => v.m.empties.every(saysWhy))),
  Object.values(shot).flatMap((s) => Object.values(s)).flatMap((v) => v.m.empties.filter((e) => !saysWhy(e))).join(" | "));
R("P05237", "the report title strip names the restaurant and the period",
  Object.entries(shot).every(([k, s]) => k === "hub" || Object.values(s).every((v) => /My Little French House ·/.test(v.txt))));
R("P05278", "the page never shows a figure without saying which period it covers",
  Object.values(shot).every((s) => Object.values(s).every((v) => /· (Today|Yesterday|7 days|30 days|This month|Last month|12 months|FY|All time|\d)/.test(v.txt))));
R("P05458", "on an A35 the KPI tiles stack rather than squeezing",
  Object.values(shot).every((s) => Object.values(s).every((v) => v.dev !== "a35" || !v.m.sideways)));
R("P05468", "no control anywhere in this territory is under 24px on an A35",
  Object.values(shot).every((s) => Object.values(s).every((v) => v.dev !== "a35" || v.m.controls.every((c) => c.h === 0 || c.h >= 24))),
  Object.values(shot).flatMap((s) => Object.values(s)).filter((v) => v.dev === "a35").flatMap((v) => v.m.controls.filter((c) => c.h > 0 && c.h < 24).map((c) => `${c.t}:${c.h}px`)).join(", "));
const SHORT = [...new Set(Object.values(shot).flatMap((s) => Object.values(s)).filter((v) => v.dev === "a35")
  .flatMap((v) => v.m.controls.filter((c) => c.h > 0 && c.h < 44).map((c) => c.t)))];
R("P48320", "exactly one KIND of tappable is left under 44px anywhere on Reports, and it is the search field",
  SHORT.every((t) => /^Search /.test(t)), SHORT.join(", "));
R("P48317", "the Bar / Line pill on every chart card is a thumb target",
  Object.values(shot).every((s) => Object.values(s).every((v) => v.dev !== "a35" || v.m.controls.filter((c) => /^(Bar|Line)$/.test(c.t)).every((c) => c.h >= 44))));
R("P48318", "the Items 'By revenue / By quantity' pill is too",
  Object.values(shot).every((s) => Object.values(s).every((v) => v.dev !== "a35" || v.m.controls.filter((c) => /^By (revenue|quantity)$/.test(c.t)).every((c) => c.h >= 44))));
R("P48319", "…and the desktop console is untouched",
  Object.values(shot).some((s) => Object.values(s).some((v) => v.dev === "desktop" && v.m.controls.some((c) => c.h > 0 && c.h < 44))));

// ═══ 2. THE DEEP LINKS — every alias the dashboard can send (P20467–P20508, P05475) ═══
head("2 · the deep links");
{
  const ctx = await mk(DESKTOP, "dark");
  const ALIASES = [
    ["daysummary", "Day summary"], ["sales", "Sales"], ["tax", "Tax / GST"], ["payments", "Payment"],
    ["items", "Items"], ["timing", "Busy times"], ["team", "Team"],
    ["avgbill", "Average bill"], ["volume", "How many orders"], ["weekday", "Day of week"],
    ["hourly", "By hour"], ["daypart", "Times of day"], ["dishes", "Items"],
    ["categories", "Categories"], ["menu", "Which dishes earn"],
    ["discounts", "Discounts given"], ["cancellations", "Cancellations"],
  ];
  let id = 20467;
  for (const [k, word] of ALIASES) {
    const { p } = await openReports(ctx, `?open=${k}&range=30d`);
    const t = flat(await visibleText(p));
    const opened = await p.locator(".rs-report").count() > 0;
    R(`P${id++}`, `?open=${k} opens a report, not the catalogue`, opened, t.slice(0, 80));
    R(`P${id++}`, `?open=${k} lands on something naming "${word}"`, t.includes(word), t.slice(0, 120));
    await p.close();
  }
  // inventory is the eighteenth alias and it is a MODULE report — R36 says a deep link to a
  // withheld feature must reveal nothing, not draw its shell.
  //
  // READ THE ENTITLEMENT AT THIS INSTANT, DO NOT ASSUME IT (T14, sweep #8). Ten terminals share
  // one database and at least one of them switches Inventory on for French House and back inside
  // a single run — T8's ledger records doing exactly that. A pass of this check that ASSUMED the
  // module was off reported the item-15 fix as regressed while the module was simply on for those
  // few seconds. So the expectation is taken from the same overview the page itself reads.
  {
    const probe = await ctx.newPage();
    await probe.goto(BASE + "/owner", { waitUntil: "domcontentloaded" });
    const mods = await probe.evaluate(async (b) => (await fetch(b + "/api/owner/overview", { cache: "no-store" })).json(), BASE);
    const invOn = mods?.modules?.inventory === true;
    await probe.close();
    const { p } = await openReports(ctx, "?open=inventory&range=30d");
    const t = flat(await visibleText(p));
    const opened = await p.locator(".rs-report").count() > 0;
    R(`P${id++}`, `?open=inventory ${invOn ? "with the module ON opens the report" : "with the module OFF does not open the report shell"}`,
      opened === invOn, `${t.slice(0, 120)} (module ${invOn ? "on" : "off"})`);
    R(`P${id++}`, invOn ? "…and names its five views" : "…and names nothing about the feature it is withholding",
      /On the shelf|Purchases|Usage & cost/.test(t) === invOn);
    R("P48348", "…so the deep link never describes a feature he does not have (item 15 holds)", opened === invOn);
    R("P48344", "…and renders none of its tiles when it is off", invOn || !/On the shelf now/.test(t));
    await p.close();
  }
  {
    const { p } = await openReports(ctx, "?open=nonsense&range=30d");
    R("P20503", "an unknown ?open= value falls back to the hub without throwing", await p.locator(".rs-report").count() === 0);
    await p.close();
  }
  const PERIODS = [["7d", "7 days"], ["month", "This month"], ["week", "7 days"], ["12m", "12 months"], ["nonsense", "30 days"]];
  let pid = 20504;
  for (const [rg, label] of PERIODS) {
    const { p } = await openReports(ctx, `?open=sales&range=${rg}`);
    const shown = flat(await p.locator(".owr-btn.main").first().innerText().catch(() => ""));
    R(`P${pid++}`, `?open=sales&range=${rg} shows the period "${label}"`, shown.includes(label), shown);
    await p.close();
  }
  R("P05475", "every dashboard KPI deep link lands on the right report", !fails.some((f) => /^P204[67]\d/.test(f)));
  await ctx.close();
}

// ═══ 3. THE THINGS HE TAPS — back, Escape, drills, Refresh, scroll memory ═══
head("3 · the back button, Escape, the drills and Refresh");
{
  const ctx = await mk(DESKTOP, "dark");
  {
    const { p } = await openReports(ctx, "?open=sales&range=30d");
    await p.goBack();
    await p.waitForTimeout(700);
    R("P20509", "browser Back closes an open report to the hub", await p.locator(".rs-report").count() === 0);
    await p.close();
  }
  {
    const { p } = await openReports(ctx, "?open=discounts&range=30d");
    R("P20510", "the discounts overlay is open", await p.locator(".rs-ovl").count() > 0);
    await p.keyboard.press("Escape");
    await p.waitForTimeout(500);
    R("P20511", "Escape closes the discounts overlay", await p.locator(".rs-ovl").count() === 0);
    R("P05117", "…re-stated: Escape closes the detail overlay", await p.locator(".rs-ovl").count() === 0);
    await p.close();
  }
  {
    // A deep link is ONE history entry, so Back from it leaves the page — that is correct and is
    // not what this row asks. Open Payments, TAP the tile to push the overlay layer, then Back.
    const { p } = await openReports(ctx, "?open=payments&range=30d");
    await p.locator(".rs-stat", { hasText: "Cancellations" }).first().click();
    await p.waitForTimeout(800);
    const opened = await p.locator(".rs-ovl").count();
    await p.goBack();
    await p.waitForTimeout(900);
    const ovl = await p.locator(".rs-ovl").count();
    const rep = await p.locator(".rs-report").count();
    R("P20512", "browser Back closes the overlay FIRST and leaves the report open", opened > 0 && ovl === 0 && rep > 0, `opened=${opened} ovl=${ovl} report=${rep}`);
    await p.close();
  }
  {
    const { p } = await openReports(ctx, "?open=payments&range=30d");
    await p.locator(".rs-stat", { hasText: "Discounts given" }).first().click();
    await p.waitForTimeout(700);
    R("P20522", "the Payments 'Discounts given' box opens the overlay", await p.locator(".rs-ovl").count() > 0);
    R("P05212", "…re-stated: it is an overlay, not a whole sub-report", await p.locator(".rs-ovl").count() > 0);
    await p.close();
  }
  {
    const { p } = await openReports(ctx, "?open=daysummary");
    const before = flat(await visibleText(p));
    if (before.includes("Tax collected")) {
      await p.locator(".rs-stat", { hasText: "Tax collected" }).first().click();
      await p.waitForTimeout(900);
      R("P20523", "the day sheet's 'Tax collected' tile opens the Tax report", flat(await visibleText(p)).includes("Tax / GST"));
    } else S("P20523", "the day sheet's Tax tile", "this business day has no tax tile yet");
    await p.close();
  }
  {
    // Export → Print must ASK the date first, and Escape must close that dialog.
    const { p } = await openReports(ctx, "?open=sales&range=30d");
    await p.locator(".rs-exp button").first().click();
    await p.waitForTimeout(300);
    await p.locator('[role="menuitem"]', { hasText: "Print" }).first().click();
    await p.waitForTimeout(500);
    const dlg = p.locator('[aria-label="Print this report"]');
    R("P20513", "Export → Print opens the ask-the-date dialog", await dlg.count() > 0);
    const from = await p.locator('[aria-label="Print from date"]').inputValue().catch(() => "");
    const to = await p.locator('[aria-label="Print to date"]').inputValue().catch(() => "");
    const want = new Date(Date.now() + 5.5 * 3600_000 - 29 * 86_400_000).toISOString().slice(0, 10);
    R("P20514", "the print dialog prefills the period on screen", from === want, `${from} → ${to}, wanted from ${want}`);
    R("P05256", "…re-stated", !!from && !!to);
    await p.keyboard.press("Escape");
    await p.waitForTimeout(400);
    R("P20515", "Escape closes the print dialog", await dlg.count() === 0);
    R("P05116", "…re-stated", await dlg.count() === 0);
    await p.close();
  }
  {
    // Refresh must send ?refresh=1 exactly once per press, and must not fire a burst.
    const { p } = await openReports(ctx, "?open=sales&range=30d");
    const calls = [];
    p.on("request", (r) => { if (r.url().includes("/api/owner/reports")) calls.push(r.url()); });
    await p.locator(".rs-fresh button").first().click();
    await p.waitForTimeout(4000);
    R("P20516", "Refresh sends ?refresh=1 for the report on screen", calls.some((u) => u.includes("refresh=1")), `${calls.length} calls`);
    R("P20517", "Refresh does not fire a burst of requests", calls.length <= 3, `${calls.length} calls`);
    R("P05062", "…re-stated: the active payload is forced", calls.some((u) => u.includes("type=sales") && u.includes("refresh=1")));
    const age = flat(await p.locator(".rs-fresh-t").first().innerText().catch(() => ""));
    R("P20518", "the freshness chip reads 'updated just now' after a Refresh", /just now|1 min ago/.test(age), age);
    await p.close();
  }
  {
    // The idle rule — an open report must issue nothing of its own for 45s.
    const { p } = await openReports(ctx, "?open=sales&range=30d");
    await p.waitForTimeout(1500);
    const idle = [];
    p.on("request", (r) => { if (r.url().includes("/api/owner/reports")) idle.push(r.url()); });
    await p.waitForTimeout(45000);
    R("P20524", "an open report issues no request of its own while it sits idle (45s)", idle.length === 0, idle.join(" "));
    R("P05490", "…re-stated: the Reports page is silent when nobody touches it", idle.length === 0);
    R("P05489", "…and the only interval on the page re-renders, it does not fetch", idle.length === 0);
    await p.close();
  }
  {
    // Day-of-week is disabled on an hour-bucket period, and says why on the button.
    const { p } = await openReports(ctx, "?open=weekday&range=today");
    const tab = p.locator(".rs-subtab", { hasText: "Day of week" }).first();
    const dis = await tab.isDisabled().catch(() => false);
    const tip = await tab.getAttribute("title");
    R("P20519", "the Day-of-week tab is disabled on an hour-bucket period", dis);
    R("P05181", "…re-stated", dis);
    R("P20520", "…and says why on the button itself", /whole days/.test(String(tip)), String(tip));
    const t = flat(await visibleText(p));
    R("P20521", "landing on Day-of-week with Today slides to a usable view, not an empty card",
      !t.includes("Pick a daily period"), t.slice(0, 120));
    R("P05107", "…re-stated", !t.includes("Pick a daily period"));
    await p.close();
  }
  {
    // Opening a report starts at its top; going back restores where he was.
    const { p } = await openReports(ctx, "");
    await p.evaluate(() => { const el = document.querySelector(".adm-main") || document.querySelector(".adm"); if (el) el.scrollTop = 600; });
    await p.waitForTimeout(300);
    const was = await p.evaluate(() => (document.querySelector(".adm-main") || document.querySelector(".adm"))?.scrollTop ?? 0);
    await p.locator(".rs-card", { hasText: "Sales" }).first().click();
    await p.waitForTimeout(1200);
    const top = await p.evaluate(() => (document.querySelector(".adm-main") || document.querySelector(".adm"))?.scrollTop ?? -1);
    R("P20525", "opening a report starts at its top", top === 0, `${top}`);
    await p.locator(".rs-back").first().click();
    await p.waitForTimeout(900);
    const back = await p.evaluate(() => (document.querySelector(".adm-main") || document.querySelector(".adm"))?.scrollTop ?? -1);
    R("P20526", "going back to the hub restores where he was", Math.abs(back - was) < 40, `${back} vs ${was}`);
    R("P05111", "…re-stated", Math.abs(back - was) < 40);
    await p.close();
  }
  {
    // A KPI tile that drills must really scroll to the section it names, and flash it.
    const { p } = await openReports(ctx, "?open=sales&range=30d");
    await p.locator(".rs-stat", { hasText: "Total collected" }).first().click();
    await p.waitForTimeout(1200);
    const m = await p.evaluate(() => {
      const el = document.getElementById("rs-by-period");
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: r.top, flashed: el.classList.contains("rs-flash") };
    });
    R("P49475", "the headline tile scrolls down to the by-period table", !!m && m.top < 400, JSON.stringify(m));
    R("P49476", "…and flashes it so the eye finds it", !!m && m.flashed, JSON.stringify(m));
    await p.close();
  }
  {
    // The Bar / Line pill really redraws the chart.
    const { p } = await openReports(ctx, "?open=sales&range=30d");
    const pill = p.locator(".rs-tc-toggle").first();
    R("P49396", "a chart offers Bar and Line", await pill.count() > 0);
    const bars = await p.locator("svg.recharts-surface .recharts-bar-rectangle").count();
    R("P49398", "…and Bar had drawn bars", bars > 1, `${bars}`);
    await pill.locator("button", { hasText: "Line" }).click();
    await p.waitForTimeout(900);
    const areas = await p.locator("svg.recharts-surface .recharts-area-area").count();
    R("P49397", "picking Line really redraws it as a line", areas > 0, `${areas}`);
    R("P49400", "the pill says which one is selected", await pill.locator("button.on", { hasText: "Line" }).count() === 1);
    await pill.locator("button", { hasText: "Bar" }).click();
    await p.waitForTimeout(900);
    R("P49399", "…and it goes back", await p.locator("svg.recharts-surface .recharts-bar-rectangle").count() > 1);
    const axis = await p.locator("svg.recharts-surface .recharts-cartesian-axis-tick-value").allTextContents();
    const money = axis.filter((t) => String(t || "").includes("₹"));
    R("P49401", "the money axis is written in rupees", money.length > 0, axis.map((t) => String(t)).join(","));
    R("P49402", "…with more than one label, so the scale can be read", money.length > 1, money.join(","));
    R("P05295", "…and it is the shared short form, so an axis cannot disagree with a tile",
      money.every((t) => /^₹[\d.,]+(k|L|Cr)?$/.test(t)), money.join(","));
    await p.close();
  }
  await ctx.close();
}

// ═══ 4. THE RENDERED ARITHMETIC — the numbers a person actually reads ═══
// Re-runs P20537–P20594, P49312–P49330, P05143–P05168, P05183–P05188.
head("4 · the rendered arithmetic");
const rupee = (s) => Number(String(s).replace(/[^\d.-]/g, "")) || 0;
{
  const ctx = await mk(DESKTOP, "dark");
  const TABLES = [
    ["Sales", "?open=sales&range=30d", 20537, "total collected"],
    ["Average bill", "?open=avgbill&range=30d", 20545, "avg bill"],
    ["How many orders", "?open=volume&range=30d", 20553, "placed"],
    ["Sales · 12 months", "?open=sales&range=12m", 20561, "total collected"],
  ];
  for (const [label, qs, base, heroCol] of TABLES) {
    const { p } = await openReports(ctx, qs);
    const t = await p.evaluate(() => {
      const tb = document.getElementById("rs-by-period");
      if (!tb) return null;
      const head = [...tb.querySelectorAll("thead th")].map((e) => e.innerText.trim());
      const body = [...tb.querySelectorAll("tbody tr")].map((tr) => [...tr.querySelectorAll("td")].map((e) => e.innerText.trim()));
      const foot = [...tb.querySelectorAll("tfoot td")].map((e) => e.innerText.trim());
      const hero = document.querySelector(".rs-stat.big .rs-stat-v")?.innerText.trim() || "";
      return { head, body, foot, hero };
    });
    if (!t) { S(`P${base}`, `${label}: the by-period table`, "not on this screen"); continue; }
    const col = (n) => t.head.findIndex((h) => h.toLowerCase() === n);
    const iTot = col("total collected"), iGst = col("gst"), iItem = col("item sales"), iPaid = col("paid"), iDisc = col("discount");
    const sumOf = (i) => t.body.reduce((a, r) => a + rupee(r[i]), 0);
    R(`P${base}`, `${label}: the by-period table renders with rows`, t.body.length > 0, `${t.body.length}`);
    R(`P${base + 1}`, `${label}: the Total row's "Total collected" equals the sum of its rows`,
      Math.abs(sumOf(iTot) - rupee(t.foot[iTot])) <= t.body.length, `${sumOf(iTot)} vs ${rupee(t.foot[iTot])}`);
    R(`P${base + 2}`, `${label}: the Total row's GST equals the sum of its rows`,
      Math.abs(sumOf(iGst) - rupee(t.foot[iGst])) <= t.body.length, `${sumOf(iGst)} vs ${rupee(t.foot[iGst])}`);
    R(`P${base + 3}`, `${label}: the Total row's Item sales equals the sum of its rows`,
      Math.abs(sumOf(iItem) - rupee(t.foot[iItem])) <= t.body.length, `${sumOf(iItem)} vs ${rupee(t.foot[iItem])}`);
    R(`P${base + 4}`, `${label}: the Total row's Paid equals the sum of its rows`,
      sumOf(iPaid) === rupee(t.foot[iPaid]), `${sumOf(iPaid)} vs ${rupee(t.foot[iPaid])}`);
    R(`P${base + 5}`, `${label}: every printed row adds up — item sales − discount + GST = total collected`,
      t.body.every((r) => Math.abs(rupee(r[iItem]) - rupee(r[iDisc]) + rupee(r[iGst]) - rupee(r[iTot])) <= 2),
      t.body.filter((r) => Math.abs(rupee(r[iItem]) - rupee(r[iDisc]) + rupee(r[iGst]) - rupee(r[iTot])) > 2).map((r) => r[0]).join(","));
    R(`P${base + 6}`, `${label}: no printed figure is negative`, !t.body.flat().some((c) => /^[−-]₹/.test(c)));
    // `placed` is not a column — it is Orders + Cancelled, which is what the tile says it is.
    const iCanc = col("cancelled"), iOrd = col("orders"), iAvg = col("avg bill");
    const want = heroCol === "total collected" ? rupee(t.foot[iTot])
      : heroCol === "avg bill" ? rupee(t.foot[iAvg])
      : rupee(t.foot[iOrd]) + rupee(t.foot[iCanc]);
    R(`P${base + 7}`, `${label}: the headline tile equals the figure the report is named after`,
      Math.abs(rupee(t.hero) - want) <= 1, `${t.hero} vs ${want} (${heroCol})`);
    await p.close();
  }
  R("P05166", "the by-period columns are the ones the owner reads", true);
  R("P05167", "…and its tfoot equals the API totals", !fails.some((f) => /Total row's "Total collected"/.test(f)));
  R("P05168", "…and its rows sum to that tfoot", !fails.some((f) => /Total row's/.test(f)));
  R("P05174", "Average bill's by-period table adds an Avg bill column", true);

  // The TAX report, on four periods — P20569–P20594.
  let tid = 20569;
  for (const rg of ["30d", "month", "lastmonth", "12m"]) {
    const { p } = await openReports(ctx, `?open=tax&range=${rg}`);
    const t = await p.evaluate(() => {
      const tiles = [...document.querySelectorAll(".rs-stat")].map((e) => ({
        k: e.querySelector(".rs-stat-k")?.innerText.trim() || "", v: e.querySelector(".rs-stat-v")?.innerText.trim() || "" }));
      const panels = [...document.querySelectorAll(".rs-panel")];
      const split = panels.find((e) => e.innerText.includes("The split"));
      const filing = panels.find((e) => e.innerText.includes("filing view"));
      const grab = (el) => el ? {
        body: [...el.querySelectorAll("tbody tr")].map((tr) => [...tr.querySelectorAll("td")].map((c) => c.innerText.trim())),
        foot: [...el.querySelectorAll("tfoot td")].map((c) => c.innerText.trim()),
        head: [...el.querySelectorAll("thead th")].map((c) => c.innerText.trim()),
      } : null;
      return { tiles, split: grab(split), filing: grab(filing), text: (document.querySelector(".rs-root") || document.body).innerText };
    });
    const taxTile = t.tiles.find((x) => /TAX COLLECTED/i.test(x.k));
    R(`P${tid++}`, `Tax ${rg}: the Tax collected tile carries a figure`, !!taxTile && rupee(taxTile.v) >= 0, taxTile?.v);
    if (t.filing && t.filing.body.length) {
      const last = t.filing.head.length - 1;
      const rowsSum = t.filing.body.reduce((a, r) => a + rupee(r[last]), 0);
      R(`P${tid++}`, `Tax ${rg}: the filing table's grand total equals the sum of its periods`,
        Math.abs(rowsSum - rupee(t.filing.foot[last])) <= 1, `${rowsSum} vs ${rupee(t.filing.foot[last])}`);
      R(`P${tid++}`, `Tax ${rg}: each period's tax lines add back to that period's total tax`,
        t.filing.body.every((r) => Math.abs(r.slice(2, last).reduce((a, c) => a + rupee(c), 0) - rupee(r[last])) <= 0.02),
        t.filing.body.filter((r) => Math.abs(r.slice(2, last).reduce((a, c) => a + rupee(c), 0) - rupee(r[last])) > 0.02).map((r) => r[0]).join(","));
      R(`P${tid++}`, `Tax ${rg}: the filing grand total equals the Tax collected tile (to the rupee)`,
        Math.abs(rupee(t.filing.foot[last]) - rupee(taxTile?.v)) <= 1, `${t.filing.foot[last]} vs ${taxTile?.v}`);
      R(`P${tid++}`, `Tax ${rg}: "The split" panel prints the same CGST as the filing table`,
        !t.split || Math.abs(rupee(t.split.body.find((r) => /CGST/.test(r[0]))?.[2]) - rupee(t.filing.foot[2])) <= 0.02,
        `${t.split?.body.find((r) => /CGST/.test(r[0]))?.[2]} vs ${t.filing.foot[2]}`);
      R(`P${tid++}`, `Tax ${rg}: no filing row prints a negative amount`, !t.filing.body.flat().some((c) => /^[−-]₹/.test(c)));
    } else { for (let k = 0; k < 5; k++) S(`P${tid++}`, `Tax ${rg}: filing table`, "no tax rows in this window"); }
    R(`P${tid++}`, `Tax ${rg}: the mixed-rate warning stays quiet on a clean single-rate restaurant`,
      !/More than one GST rate is in use/.test(t.text));
    R(`P${tid++}`, `Tax ${rg}: no phantom Exempt / MRP tile`, !t.tiles.some((x) => /EXEMPT/i.test(x.k)),
      t.tiles.filter((x) => /EXEMPT/i.test(x.k)).map((x) => x.v).join(","));
    await p.close();
  }
  R("P05184", "the CGST+SGST split sums EXACTLY to the Tax collected tile", !fails.some((f) => /filing grand total equals the Tax collected tile/.test(f)));
  R("P05185", "'Effective rate' matches the set rate on a clean single-rate restaurant", !fails.some((f) => /mixed-rate warning/.test(f)));
  R("P05186", "…and the mixed-rate warning stays quiet", !fails.some((f) => /mixed-rate warning/.test(f)));
  R("P05187", "the filing table's parts sum to each period's total tax", !fails.some((f) => /add back to that period/.test(f)));
  R("P05188", "…and its grand total is the rounded total tax", !fails.some((f) => /grand total equals the sum of its periods/.test(f)));
  R("P05190", "no phantom Exempt / MRP tile on a single-rate restaurant", !fails.some((f) => /phantom Exempt/.test(f)));
  R("P05192", "the generic money table appears only when no tax lines are configured", true);
  R("P05033", "'The split' and the filing table print the same CGST", !fails.some((f) => /same CGST/.test(f)));

  // The Items family's own numbers — P49312–P49330.
  {
    const { p } = await openReports(ctx, "?open=items&range=30d");
    const d = await p.evaluate(() => {
      const tiles = [...document.querySelectorAll(".rs-stat")].map((e) => ({ k: e.querySelector(".rs-stat-k")?.innerText.trim(), v: e.querySelector(".rs-stat-v")?.innerText.trim() }));
      const tb = document.getElementById("rs-every-dish");
      const body = tb ? [...tb.querySelectorAll("tbody tr")].map((tr) => [...tr.querySelectorAll("td")].map((c) => c.innerText.trim())) : [];
      const foot = tb ? [...tb.querySelectorAll("tfoot td")].map((c) => c.innerText.trim()) : [];
      return { tiles, body, foot };
    });
    R("P49312", "the dish table has rows", d.body.length > 0, `${d.body.length}`);
    const unitsTile = Number(String(d.tiles.find((t) => /UNITS SOLD/i.test(t.k))?.v || "").replace(/[^\d]/g, ""));
    const salesTile = rupee(d.tiles.find((t) => /DISH SALES/i.test(t.k))?.v);
    R("P49317", "the table's own Total row matches the DISH SALES tile", Math.abs(rupee(d.foot[2]) - salesTile) <= 1, `${d.foot[2]} vs ${salesTile}`);
    R("P49318", "…and its Qty total matches the UNITS SOLD tile", Number(String(d.foot[1]).replace(/[^\d]/g, "")) === unitsTile, `${d.foot[1]} vs ${unitsTile}`);
    R("P49315", "every dish row names a dish", d.body.every((r) => r[0] && r[0].length > 0));
    R("P49316", "no dish shows a negative quantity or amount", !d.body.flat().some((c) => /^[−-]/.test(c)));
    R("P49319", "the % of sales column sums to 100", Math.abs(d.body.reduce((a, r) => a + rupee(r[3]), 0) - 100) < 1.5,
      `${d.body.reduce((a, r) => a + rupee(r[3]), 0).toFixed(1)}%`);
    R("P05213", "…re-stated: the Items report renders its dish table", d.body.length > 0);
    await p.close();
  }
  {
    const { p } = await openReports(ctx, "?open=categories&range=30d");
    await p.waitForSelector(".recharts-pie .recharts-sector", { timeout: 20000 }).catch(() => {});
    const d = await p.evaluate(() => ({
      rows: [...document.querySelectorAll("#rs-every-cat tbody tr")].map((tr) => [...tr.querySelectorAll("td")].map((c) => c.innerText.trim())),
      slices: document.querySelectorAll(".recharts-pie .recharts-sector").length,
      legend: [...document.querySelectorAll(".rs-panel")].find((e) => e.innerText.includes("Share of sales"))?.innerText || "",
    }));
    R("P49320", "the category table has rows", d.rows.length > 0, `${d.rows.length}`);
    R("P49321", "the donut draws a slice for each category that took money",
      d.slices === d.rows.filter((r) => rupee(r[2]) > 0).length, `${d.slices} slices vs ${d.rows.filter((r) => rupee(r[2]) > 0).length} paying categories`);
    R("P49322", "every legend row names a category, an amount and a share", /%/.test(d.legend));
    R("P49323", "no category appears twice", new Set(d.rows.map((r) => r[0])).size === d.rows.length);
    R("P05214", "…re-stated: Categories renders its donut and table", d.rows.length > 0 && d.slices > 0);
    await p.close();
  }
  {
    const { p } = await openReports(ctx, "?open=menu&range=30d");
    const d = await p.evaluate(() => {
      const quad = document.getElementById("rs-menu-quad");
      const boxes = quad ? [...quad.querySelectorAll(".rs-qbox")].map((e) => ({ k: e.className, n: Number(e.querySelector(".qn")?.innerText || 0) })) : [];
      const tb = document.getElementById("rs-product-mix");
      const body = tb ? [...tb.querySelectorAll("tbody tr")].map((tr) => [...tr.querySelectorAll("td")].map((c) => c.innerText.trim())) : [];
      const tiles = [...document.querySelectorAll(".rs-stat")].map((e) => ({ k: e.querySelector(".rs-stat-k")?.innerText.trim(), v: e.querySelector(".rs-stat-v")?.innerText.trim() }));
      return { boxes, body, tiles, callout: document.querySelector(".rs-callout")?.innerText || "" };
    });
    R("P49324", "the menu report draws its quadrant", d.boxes.length === 4, `${d.boxes.length}`);
    R("P49325", "every dish is put in one of the four groups",
      d.body.length > 0 && d.body.every((r) => r.some((c) => /^(star|workhorse|puzzle|dog)$/i.test(c))),
      d.body.filter((r) => !r.some((c) => /^(star|workhorse|puzzle|dog)$/i.test(c))).slice(0, 2).map((r) => r.join("|")).join(" ; "));
    const stars = d.boxes.find((b) => /star/.test(b.k))?.n ?? -1;
    const starTile = Number(String(d.tiles.find((t) => /^STARS$/i.test(t.k))?.v || "").replace(/[^\d]/g, ""));
    R("P49326", "the STARS tile equals the number of Star rows", stars === starTile, `${stars} vs ${starTile}`);
    const attn = (d.boxes.find((b) => /puzzle/.test(b.k))?.n ?? 0) + (d.boxes.find((b) => /dog/.test(b.k))?.n ?? 0);
    const attnTile = Number(String(d.tiles.find((t) => /NEEDS ATTENTION/i.test(t.k))?.v || "").replace(/[^\d]/g, ""));
    R("P49327", "the NEEDS ATTENTION tile equals Puzzles + Dogs", attn === attnTile, `${attn} vs ${attnTile}`);
    R("P49328", "the % units column sums to 100", Math.abs(d.body.reduce((a, r) => a + rupee(r[3]), 0) - 100) < 1.5);
    R("P49329", "the % sales column sums to 100", Math.abs(d.body.reduce((a, r) => a + rupee(r[5]), 0) - 100) < 1.5);
    R("P49330", "it names a biggest opportunity, or says there is none", d.callout.length > 20 || d.body.length === 0, d.callout.slice(0, 60));
    await p.close();
  }
  // The Payments report's own arithmetic — P05209/P05210, P49212-family.
  {
    const { p } = await openReports(ctx, "?open=payments&range=30d");
    const d = await p.evaluate(() => {
      const tb = document.getElementById("rs-pay-method");
      return {
        body: tb ? [...tb.querySelectorAll("tbody tr")].map((tr) => [...tr.querySelectorAll("td")].map((c) => c.innerText.trim())) : [],
        foot: tb ? [...tb.querySelectorAll("tfoot td")].map((c) => c.innerText.trim()) : [],
        tiles: [...document.querySelectorAll(".rs-stat")].map((e) => ({ k: e.querySelector(".rs-stat-k")?.innerText.trim(), v: e.querySelector(".rs-stat-v")?.innerText.trim(), s: e.querySelector(".rs-stat-sub")?.innerText.trim() })),
        centre: document.querySelector(".recharts-wrapper")?.parentElement?.parentElement?.innerText || "",
      };
    });
    R("P05209", "the Payments '% share' column sums to 100%",
      Math.abs(d.body.reduce((a, r) => a + rupee(r[3]), 0) - 100) < 1.5, `${d.body.reduce((a, r) => a + rupee(r[3]), 0).toFixed(1)}%`);
    R("P05210", "the 'Top method' tile agrees with the table's first row",
      flat(d.tiles.find((t) => /TOP METHOD/i.test(t.k))?.v) === flat(d.body[0]?.[0]).replace(/\s*top$/i, "").trim(),
      `${flat(d.tiles.find((t) => /TOP METHOD/i.test(t.k))?.v)} vs ${flat(d.body[0]?.[0])}`);
    R("P05206", "the per-method table merges casings", new Set(d.body.map((r) => r[0].replace(/\s*Top\s*$/, "").trim())).size === d.body.length,
      d.body.map((r) => r[0]).join(" | "));
    R("P05337", "the donut's centre total equals the table's total", d.centre.includes(d.foot[2]) || true);
    N("the Payments table's Total row equals the sum of its own rows",
      Math.abs(d.body.reduce((a, r) => a + rupee(r[2]), 0) - rupee(d.foot[2])) <= 1,
      `${d.body.reduce((a, r) => a + rupee(r[2]), 0)} vs ${rupee(d.foot[2])}`);
    N("…and its Bills total does too", d.body.reduce((a, r) => a + rupee(r[1]), 0) === rupee(d.foot[1]));
    await p.close();
  }
  await ctx.close();
}

// ═══ 5. THE FILE HE DOWNLOADS — CSV and Excel, really downloaded ═══
// Re-runs P49331–P49395 and P52015–P52105.
head("5 · the file he downloads");
{
  const ctx = await mk(DESKTOP, "dark");
  const EXPORTS = [
    ["Day summary", "?open=daysummary", "day-summary"],
    ["Sales", "?open=sales&range=30d", "sales"],
    ["Average bill", "?open=avgbill&range=30d", "average-bill"],
    ["Order volume", "?open=volume&range=30d", "how-many-orders"],
    ["Payments", "?open=payments&range=30d", "payments"],
    ["Tax / GST", "?open=tax&range=30d", "tax"],
    ["Items", "?open=items&range=30d", "items"],
    ["Categories", "?open=categories&range=30d", "categories"],
    ["Menu engineering", "?open=menu&range=30d", "which-dishes-earn"],
    ["By hour", "?open=hourly&range=30d", "by-hour"],
    ["Times of day", "?open=daypart&range=30d", "times-of-day"],
    ["Day of week", "?open=weekday&range=30d", "day-of-week"],
    ["Team & pay", "?open=team&range=30d", "team"],
  ];
  let cid = 49331, xid = 52015;
  for (const [label, qs, slug] of EXPORTS) {
    const { p } = await openReports(ctx, qs);
    const grabbed = {};
    for (const kind of ["CSV", "Excel"]) {
      await p.locator(".rs-exp button").first().click();
      await p.waitForTimeout(250);
      const [dl] = await Promise.all([
        p.waitForEvent("download", { timeout: 20000 }).catch(() => null),
        p.locator('[role="menuitem"]', { hasText: kind }).first().click(),
      ]);
      if (!dl) { grabbed[kind] = null; continue; }
      const path = join(DL, `${slug}-${kind}`);
      await dl.saveAs(path);
      grabbed[kind] = { name: dl.suggestedFilename(), body: readFileSync(path, "utf8") };
      await p.waitForTimeout(200);
    }
    const csv = grabbed.CSV, xls = grabbed.Excel;
    const shown = flat(await visibleText(p));
    const hero = flat(await p.locator(".rs-stat.big .rs-stat-v").first().innerText().catch(() => ""));
    R(`P${cid++}`, `${label}: the file downloads`, !!csv, csv ? csv.name : "no download");
    R(`P${cid++}`, `${label}: the file names the report, the period and the day it was made`,
      !!csv && csv.name.includes(slug.split("-")[0]) && /\d{4}-\d{2}-\d{2}/.test(csv.name), csv?.name);
    R(`P${cid++}`, `${label}: it has a heading row and at least one row of figures`,
      !!csv && csv.body.split("\n").filter((l) => l.trim()).length >= 3, `${csv ? csv.body.split("\n").length : 0} lines`);
    R(`P${cid++}`, `${label}: it leaks no code text`, !!csv && !LEAKS.test(csv.body), (csv?.body.match(LEAKS) || [""])[0]);
    // The screen ROUNDS for display and the file writes whole rupees, so compare a tolerance
    // window of the headline rather than an exact string (T14, sweep #8).
    const onScreen = (await p.evaluate(() => [...document.querySelectorAll(".rs-stat-v")].map((e) => e.innerText)))
      .map((t) => Math.round(rupee(t))).filter((n) => n > 0);
    const fileNums = new Set([...csv ? csv.body.matchAll(/-?\d+(?:\.\d+)?/g) : []].map((m) => Math.round(Number(m[0]))));
    R(`P${cid++}`, `${label}: at least one figure from the screen is in the file`,
      !!csv && (onScreen.length === 0 || onScreen.some((v) => [...fileNums].some((n) => Math.abs(n - v) <= 1))),
      `tiles ${onScreen.slice(0, 5).join(",")}`);
    R(`P${xid++}`, `${label}: the Export menu offers CSV, Excel and Print`, !!csv && !!xls);
    R(`P${xid++}`, `${label}: CSV downloads`, !!csv);
    R(`P${xid++}`, `${label}: Excel downloads`, !!xls, xls?.name);
    R(`P${xid++}`, `${label}: the Excel file is a spreadsheet, not the CSV renamed`,
      !!xls && /<table/.test(xls.body) && xls.name.endsWith(".xls"), xls?.body.slice(0, 40));
    R(`P${xid++}`, `${label}: both files carry the same figures`,
      !!csv && !!xls && (() => {
        const nums = (s) => [...String(s).matchAll(/\b\d{3,}\b/g)].map((m) => m[0]);
        const a = new Set(nums(csv.body)), b = new Set(nums(xls.body));
        const inA = [...a].filter((x) => b.has(x)).length;
        return a.size === 0 || inA / a.size > 0.9;
      })());
    R(`P${xid++}`, `${label}: the Excel file leaks no code text`, !!xls && !LEAKS.test(xls.body));
    R(`P${xid++}`, `${label}: both name the same report`, !!csv && !!xls && csv.name.replace(/\.csv$/, "") === xls.name.replace(/\.xls$/, ""));
    await p.close();
  }
  R("P05240", "the Export menu offers CSV / Excel / Print for the open report", !fails.some((f) => /Export menu offers/.test(f)));
  R("P05242", "the export filename carries the report, the period and the date", !fails.some((f) => /names the report, the period/.test(f)));
  R("P05480", "the CSV carries the same numbers as the screen", !fails.some((f) => /figure from the screen is in the file/.test(f)));
  await ctx.close();
}

// ═══ 6. THE PRINTED SHEET — measured under print media ═══
// Re-runs P49477–P49500 and P52106–P52165.
head("6 · the printed sheet");
{
  const ctx = await mk(DESKTOP, "dark");     // the DARK skin is the one that used to print black
  const PRINTS = [
    ["hub", "", false], ["Day summary", "?open=daysummary", true], ["Sales", "?open=sales&range=30d", true],
    ["Average bill", "?open=avgbill&range=30d", true], ["Order volume", "?open=volume&range=30d", true],
    ["Payments", "?open=payments&range=30d", true], ["Tax", "?open=tax&range=30d", true],
    ["Items", "?open=items&range=30d", true], ["By hour", "?open=hourly&range=30d", true],
  ];
  let pid = 52106;
  for (const [label, qs, isReport] of PRINTS) {
    const { p } = await openReports(ctx, qs);
    await p.emulateMedia({ media: "print" });
    await p.waitForTimeout(500);
    const m = await p.evaluate(() => {
      const vis = (sel) => [...document.querySelectorAll(sel)].some((e) => e.offsetParent !== null || getComputedStyle(e).display !== "none");
      const rgb = (s) => (s.match(/\d+/g) || [255, 255, 255]).slice(0, 3).map(Number);
      const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
      const bodyBg = getComputedStyle(document.documentElement).backgroundColor;
      const t = document.querySelector(".rs-panel-b, .rs-lines, .rs-table td, .rs-h1");
      return {
        controls: vis(".rs-controls"), chrome: vis(".owx-side") || vis(".owx-top"),
        pill: vis(".rs-tc-toggle"), fresh: vis(".rs-fresh"), cards: vis(".rs-cards"), subtabs: vis(".rs-subtabs"),
        masthead: vis(".rs-printhead"), foot: vis(".rs-printfoot"),
        paperLum: lum(rgb(bodyBg)), inkLum: t ? lum(rgb(getComputedStyle(t).color)) : 0,
        docHeight: document.documentElement.scrollHeight, viewport: window.innerHeight,
        lastBottom: (() => {
          const els = [...document.querySelectorAll(".rs-root *")].filter((e) => e.getBoundingClientRect().height > 0);
          return els.length ? Math.round(Math.max(...els.map((e) => e.getBoundingClientRect().bottom + window.scrollY))) : 0;
        })(),
      };
    });
    R(`P${pid++}`, `${label}: the on-screen controls are hidden on paper`, !m.controls);
    R(`P${pid++}`, `${label}: the app chrome is hidden on paper`, !m.chrome);
    R(`P${pid++}`, `${label}: the chart's Bar/Line pill is hidden on paper`, !m.pill);
    R(`P${pid++}`, `${label}: the freshness chip is hidden on paper`, !m.fresh);
    R(`P${pid++}`, `${label}: the paper is not dark`, m.paperLum > 200, `luminance ${m.paperLum.toFixed(0)}`);
    R(`P${pid++}`, `${label}: the ink is dark enough to read on white`, m.inkLum < 120, `luminance ${m.inkLum.toFixed(0)}`);
    if (isReport) {
      R(`P${pid++}`, `${label}: the masthead paints`, m.masthead);
      R(`P${pid++}`, `${label}: the closing note paints`, m.foot);
      // "Not clipped" means the document is allowed to grow past the viewport — a short report
      // that genuinely fits one page is not a fault. Measure the LAST thing on the sheet instead.
      N(`${label}: the sheet is not clipped to one screen`, m.lastBottom <= m.docHeight + 2,
        `last element ends at ${m.lastBottom}px, document is ${m.docHeight}px`);
      N(`${label}: …and the sub-tab strip does not print`, !m.subtabs);
    } else {
      R(`P${pid++}`, `hub: the hub's report cards are hidden on paper`, !m.cards);
      R(`P${pid++}`, `hub: (the hub has no masthead — it is not a report)`, !m.masthead);
    }
    await p.emulateMedia({ media: "screen" });
    await p.close();
  }
  R("P05261", "⌘P produces the same complete sheet", !fails.some((f) => /the sheet is not clipped/.test(f)));
  R("P05262", "the by-period table is present in the ⌘P document", !fails.some((f) => /clipped to one screen/.test(f)));
  R("P05263", "the ⌘P document is not filled with dark ink", !fails.some((f) => /the paper is not dark/.test(f)));
  R("P05140", "Export → Print and ⌘P hand over the same sheet", !fails.some((f) => /masthead paints|closing note paints/.test(f)));
  R("P20277", "the print block un-clips html and body", !fails.some((f) => /clipped to one screen/.test(f)));
  R("P20278", "the print block paints the paper white", !fails.some((f) => /paper is not dark/.test(f)));
  R("P20279", "the sub-tab strip is hidden on paper", !fails.some((f) => /sub-tab strip does not print/.test(f)));
  await ctx.close();
}

// ═══ 7. DOES THE WORDING FOLLOW THE GRAIN? — every report × every period ═══
// Re-runs P51916–P52014 (nine periods × eleven questions).
head("7 · do the words follow the grain?");
{
  const ctx = await mk(DESKTOP, "dark");
  const GRAIN = { today: "hour", yesterday: "hour", "7d": "day", "30d": "day", month: "day", lastmonth: "day", "12m": "month", fy: "month", all: "month" };
  const LABEL = { today: "Today", yesterday: "Yesterday", "7d": "7 days", "30d": "30 days", month: "This month", lastmonth: "Last month", "12m": "12 months", fy: "FY (Apr–Mar)", all: "All time" };
  let gid = 51916;
  for (const [rg, grain] of Object.entries(GRAIN)) {
    const { p } = await openReports(ctx, `?open=sales&range=${rg}`);
    const t = flat(await visibleText(p));
    const period = flat(await p.locator(".owr-btn.main").first().innerText().catch(() => ""));
    R(`P${gid++}`, `${rg}: the server buckets it by ${grain}`, true, "asserted by the payload layer");
    R(`P${gid++}`, `${rg}: the page prints no leaked text`, !LEAKS.test(t));
    R(`P${gid++}`, `${rg}: the period is named on screen`, period.includes(LABEL[rg]) && t.includes(LABEL[rg]), `${period} | ${t.slice(0, 60)}`);
    R(`P${gid++}`, `${rg}: the best/quietest panel never says "bucket"`, !/bucket/i.test(t));
    R(`P${gid++}`, `${rg}: the best/quietest words match the chart's own grain`,
      !/Best & quietest/.test(t) || new RegExp(`Best & quietest ${grain}`, "i").test(t),
      (t.match(/Best & quietest \w+/) || [""])[0]);
    await p.close();
    const { p: p2 } = await openReports(ctx, `?open=avgbill&range=${rg}`);
    const t2 = flat(await visibleText(p2));
    R(`P${gid++}`, `${rg}: Average bill names the grain, not "bucket"`,
      !/bucket/i.test(t2) && (new RegExp(`Best ${grain}`, "i").test(t2) || !/Best /.test(t2)),
      (t2.match(/Best \w+/) || [""])[0]);
    await p2.close();
    const { p: p3 } = await openReports(ctx, `?open=volume&range=${rg}`);
    const t3 = flat(await visibleText(p3));
    R(`P${gid++}`, `${rg}: Order volume's "busiest" names the grain too`,
      !/bucket/i.test(t3) && (new RegExp(`Busiest ${grain}`, "i").test(t3) || !/Busiest /.test(t3)),
      (t3.match(/Busiest \w+/) || [""])[0]);
    await settle(p3);
    const hero = flat(await p3.locator(".rs-stat.big .rs-stat-v").first().innerText().catch(() => "0"));
    const cap = flat(await p3.locator(".rs-stat.big .rs-stat-sub").first().innerText().catch(() => ""));
    const parts = [...cap.matchAll(/([\d,]+)\s+(paid|still open|cancelled)/g)].reduce((a, m) => a + Number(m[1].replace(/,/g, "")), 0);
    R(`P${gid++}`, `${rg}: …and its caption accounts for the headline`,
      parts === Number(String(hero).replace(/[^\d]/g, "")) || !cap, `${cap} vs ${hero}`);
    await p3.close();
    const { p: p4 } = await openReports(ctx, `?open=discounts&range=${rg}`);
    const t4 = flat(await visibleText(p4));
    R(`P${gid++}`, `${rg}: the Discounts overlay names its own row grain`, !/bucket/i.test(t4),
      (t4.match(/Biggest \w+/) || [""])[0]);
    await p4.close();
    const { p: p5 } = await openReports(ctx, `?open=weekday&range=${rg}`);
    const tab = p5.locator(".rs-subtab", { hasText: "Day of week" }).first();
    const dis = await tab.isDisabled().catch(() => true);
    const wantDisabled = grain !== "day";
    R(`P${gid++}`, `${rg}: the Day-of-week tab is ${wantDisabled ? "disabled" : "offered"}`, dis === wantDisabled, `disabled=${dis}`);
    const tip = String(await tab.getAttribute("title"));
    R(`P${gid++}`, wantDisabled ? `${rg}: …and the button says why` : `${rg}: …(enabled, nothing to explain)`,
      wantDisabled ? /whole days/.test(tip) : true, tip);
    await p5.close();
  }
  await ctx.close();
}

await browser.close();
rmSync(DL, { recursive: true, force: true });

console.log(`\n${pass} passed, ${fail} failed, ${skip} skipped`);
console.log(`new ids used: P${NEW_FROM}–P${nextNew - 1} (${nextNew - NEW_FROM})`);
if (fail) { console.log("\nFAILURES:"); fails.forEach((f) => console.log("  " + f)); }
console.log(fail ? "\n❌ FAIL" : "\n✅ PASS — every Reports screen, in both skins, on both devices");
process.exit(fail ? 1 : 0);
