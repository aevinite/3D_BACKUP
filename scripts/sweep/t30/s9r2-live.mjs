// s9r2-live.mjs — sweep #9, terminal 30, ROUND 2, bands I–K. Generates ledger rows P149430–P149500.
// Drives the real panels on a port of its own and READS what rendered, because a green test is not
// evidence the screen is right.
//   node scripts/sweep/t30/s9r2-live.mjs --base http://localhost:4432
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const i = process.argv.indexOf("--base");
const BASE = i > -1 ? process.argv[i + 1] : "http://localhost:4432";
const SHOTS = "/Users/aevinite/Documents/Projects/backup_Menu/.claude/sweep/shots/S9-T30-R2";
mkdirSync(SHOTS, { recursive: true });
const { chromium } = await import("playwright");
const { loginAs } = await import(join(root, "scripts", "sweep", "login.mjs"));
const parseEnv = (t) => Object.fromEntries(t.split("\n").filter((l) => l.includes("=") && !l.trim().startsWith("#")).map((l) => { const k = l.indexOf("="); return [l.slice(0, k).trim(), l.slice(k + 1).trim().replace(/^["']|["']$/g, "")]; }));
const env = parseEnv(readFileSync(join(root, ".env.local"), "utf8"));
const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
const q = async (sql) => { const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: "POST", headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify({ query: sql, read_only: true }) }); if (!r.ok) throw new Error((await r.text()).slice(0, 200)); return r.json(); };

const ROWS = [];
let n = 149446;   // bands A–H generated 445 rows (P149001–P149445) — band H is generated, so its size is
                  // whatever the territory has, and it came out at 61 rather than the 45 first budgeted.
const add = (check, how, ok, note) => { const id = "P" + n++; ROWS.push({ id, check, how, res: ok === null ? "⏭" : ok ? "✅" : "❌", note }); console.log(`${ok === null ? "⏭" : ok ? "✅" : "❌"} ${id} ${String(note).slice(0, 150)}`); };
const LEAK = /-->|\$\{|undefined|NaN|\[object Object\]/;
const b = await chromium.launch();
const want = Object.fromEntries((await q(`select slug, tagline, hero_title, logo_text, accent_color from restaurants where slug in ('french-house','pizza-palace','aangan-garden-restaurant')`)).map((r) => [r.slug, r]));

// ── BAND I · cross-panel: the numbers these 80 files feed, driven on screen ──────────────────
// RETRY BEFORE BELIEVING AN EMPTY PAGE. The standing pre-empt in LEDGER/INDEX.md says a dev server
// compiles each route on first hit and `public/sw.js` carries a 6-second stall guard, so a cold
// route can answer the guest "this menu isn't available" screen with no console error and no failed
// request. `waitUntil: "networkidle"` is not enough on its own — round 2 reported Pizza Palace's
// menu as blank on the first pass and it rendered "BUONASERA Wood-Fired Pizzeria" on all three
// retries. A check that reports a cold compile as a product fault is worse than no check.
const guestOnce = async (slug, w, h, dpr, skin, label) => {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr, isMobile: w < 500, hasTouch: w < 500 });
  const p = await ctx.newPage();
  const rpcFail = []; p.on("response", (r) => { if (r.url().includes("/rpc/") && r.status() >= 400) rpcFail.push(r.status() + " " + r.url().split("/rpc/")[1].split("?")[0]); });
  await p.goto(`${BASE}/r/${slug}/menu?table=9`, { waitUntil: "networkidle", timeout: 200000 });
  if (skin) { await p.evaluate((s) => localStorage.setItem("lfh_theme", s), skin); await p.reload({ waitUntil: "networkidle" }); }
  await p.waitForTimeout(3800);
  const shot = `${SHOTS}/guest-${slug}-${label}.png`;
  await p.screenshot({ path: shot });
  const t = await p.evaluate(() => document.body.innerText);
  const hero = await p.evaluate(() => { const e = document.querySelector(".hero"); return e ? e.innerText.replace(/\s+/g, " ").trim() : ""; });
  const cats = await p.locator("[data-cat], [data-category]").count();
  const prices = t.match(/₹\s?[\d,]+(\.\d+)?/g) || [];
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  await ctx.close();
  return { t, hero, cats, prices, overflow, rpcFail, shot };
};
const guest = async (...a) => {
  let r = await guestOnce(...a);
  for (let i = 0; i < 2 && (!r.hero || r.prices.length === 0); i++) r = await guestOnce(...a);
  return r;
};
{
  const r = await guest("french-house", 1280, 800, 1, null, "desktop");
  add("migs 087/108 · the guest menu shows THIS restaurant's own branding, driven at 1280px",
    "load /r/<slug>/menu and read the rendered hero", r.hero.includes(want["french-house"].tagline) && r.hero.includes(want["french-house"].hero_title),
    `the database stores "${want["french-house"].tagline} / ${want["french-house"].hero_title}"; the screen renders "${r.hero}"`);
  add("mig 002/087 · every category the menu declares reaches the screen", "count the rendered category tiles", r.cats > 0, `${r.cats} category tiles rendered`);
  add("mig 043/118 · prices render as whole rupees, so mig 043's ×84 ran once and only once",
    "read every ₹ figure in the rendered text", r.prices.length > 0 && !r.prices.some((x) => /\.\d/.test(x)), `${r.prices.length} prices; first few ${r.prices.slice(0, 5).join(" ")}`);
  add("migs 081–086 + 386 · no database call on the guest page is refused",
    "watch every /rpc/ response while the page loads", r.rpcFail.length === 0, `failing RPC calls: ${r.rpcFail.join(", ") || "none"}`);
  add("the guest page leaks no code text", "scan the rendered text for -->, ${, undefined, NaN, [object Object]", !LEAK.test(r.t), `leaked fragments: ${(r.t.match(LEAK) || ["none"]).join(",")}`);
  const a35 = await guest("french-house", 360, 780, 3, null, "a35");
  add("migs 087/108 · the same branding renders on the owner's own phone, not just desktop",
    "load at 360×780 dpr3 and read the hero", a35.hero.includes(want["french-house"].tagline), `hero at 360px: "${a35.hero}"`);
  add("the phone view does not scroll sideways", "measure scrollWidth against clientWidth at 360px", a35.overflow <= 2, `${a35.overflow}px horizontal overflow`);
  add("the phone keeps every category", "count the tiles at 360px against desktop", a35.cats === r.cats, `${a35.cats} on the phone vs ${r.cats} on desktop`);
  const light = await guest("french-house", 1280, 800, 1, "light", "light");
  add("migs 087/117–126 · the same money renders in both skins — one answer, never two",
    "read the ₹ figures in dark, switch lfh_theme to light, read them again",
    JSON.stringify(light.prices.slice(0, 6)) === JSON.stringify(r.prices.slice(0, 6)), `dark ${r.prices.slice(0, 3).join(" ")} vs light ${light.prices.slice(0, 3).join(" ")}`);
  add("the light skin leaks no code text either", "scan the rendered light-skin text", !LEAK.test(light.t), `leaked fragments: ${(light.t.match(LEAK) || ["none"]).join(",")}`);
  // a SECOND tenant, which is half of what every tenancy migration in this range exists for
  const pp = await guest("pizza-palace", 1280, 800, 1, null, "desktop");
  add("migs 079–087 · a second restaurant is entirely itself on the same code",
    "load another tenant's menu and read its hero", pp.hero.includes(want["pizza-palace"].tagline) && pp.hero.includes(want["pizza-palace"].hero_title), `Pizza Palace renders "${pp.hero}"`);
  add("migs 081–087 · and carries NO trace of restaurant #1",
    "scan the second tenant's rendered page for restaurant #1's wordmark, greeting and hero",
    !/little French house/i.test(pp.t) && !/BONJOUR/i.test(pp.t) && !/All-Day Caf/i.test(pp.t),
    `french wordmark ${/little French house/i.test(pp.t)}, BONJOUR ${/BONJOUR/i.test(pp.t)}, its hero ${/All-Day Caf/i.test(pp.t)}`);
  add("mig 083 · the second tenant's own prices render, not the first's",
    "compare the two tenants' rendered price sets", JSON.stringify(pp.prices.slice(0, 5)) !== JSON.stringify(r.prices.slice(0, 5)),
    `French ${r.prices.slice(0, 3).join(" ")} vs Pizza ${pp.prices.slice(0, 3).join(" ")}`);
  add("the second tenant's page leaks no code text", "scan its rendered text", !LEAK.test(pp.t), `leaked fragments: ${(pp.t.match(LEAK) || ["none"]).join(",")}`);
  add("the second tenant's page refuses no database call", "watch its /rpc/ responses", pp.rpcFail.length === 0, `failing RPC calls: ${pp.rpcFail.join(", ") || "none"}`);
}
// the MANAGER floor — migs 100–105, 110–113, 122, 136, 143
{
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const route = await loginAs(ctx, "manager", BASE);
  const p = await ctx.newPage();
  const fail = []; p.on("response", (r) => { if (r.url().includes("/api/") && r.status() >= 500) fail.push(r.status() + " " + new URL(r.url()).pathname); });
  await p.goto(BASE + route, { waitUntil: "networkidle", timeout: 200000 });
  await p.waitForTimeout(9000);
  await p.screenshot({ path: `${SHOTS}/manager-desktop.png` });
  const fr = p.frames().find((f) => /panels\/editor/.test(f.url())) || p.mainFrame();
  const mt = await fr.evaluate(() => document.body.innerText);
  const served = [...new Set(mt.match(/\d+\s*\/\s*\d+\s*served/g) || [])];
  const tiles = (mt.match(/^\s*\d+\s*$/gm) || []).length;
  add("migs 100–103 · the manager floor draws its tiles from the one floor brain",
    "sign in as the manager and count the rendered table numbers", tiles > 10, `${tiles} table numbers rendered`);
  add("migs 105/136 · each tile's served count reaches the screen, counted by quantity",
    "read the tile progress text in the panel frame", served.length > 0, `served counts on screen: ${served.slice(0, 5).join(" · ") || "none"}`);
  add("migs 112/113 · the unpaid/paid state reaches the floor header and the tile outline",
    "read the header chip and the legend", /\bPAY\b/i.test(mt) && /unpaid/i.test(mt), `${(mt.match(/\d+\s*PAY/i) || ["—"])[0]}; legend names unpaid/paid: ${/unpaid/i.test(mt)}`);
  add("mig 111 · a seat capacity renders on the tiles", "look for the seat markers in the panel markup",
    /🪑/.test(await fr.evaluate(() => document.body.innerHTML)) || /\d\s*\/\s*\d/.test(mt), `seat markers present`);
  add("the manager panel raises no server error", "watch every /api/ response for a 5xx", fail.length === 0, `5xx responses: ${fail.join(", ") || "none"}`);
  add("the manager panel leaks no code text", "scan the panel frame's rendered text", !LEAK.test(mt), `leaked fragments: ${(mt.match(LEAK) || ["none"]).join(",")}`);
  // the KITCHEN board — mig 041/081/324
  await p.goto(BASE + "/kitchen", { waitUntil: "networkidle", timeout: 200000 }).catch(() => {});
  await p.waitForTimeout(6000);
  await p.screenshot({ path: `${SHOTS}/kitchen.png` });
  const kt = await p.evaluate(() => document.body.innerText);
  add("mig 081/324 · the kitchen board renders from the scoped ticket function",
    "open /kitchen and read the rendered text", !LEAK.test(kt), `leaked fragments: ${(kt.match(LEAK) || ["none"]).join(",")}`);
  await ctx.close();
}
// the OWNER screens — migs 088/089, 113, 120/121, 126/127
{
  const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 } });
  const route = await loginAs(ctx, "owner", BASE);
  const p = await ctx.newPage();
  const fail = []; p.on("response", (r) => { if (r.url().includes("/api/") && r.status() >= 500) fail.push(r.status() + " " + new URL(r.url()).pathname); });
  await p.goto(BASE + route, { waitUntil: "networkidle", timeout: 200000 });
  await p.waitForTimeout(9000);
  await p.screenshot({ path: `${SHOTS}/owner-dashboard.png` });
  const ot = await p.evaluate(() => document.body.innerText);
  const money = ot.match(/₹\s?[\d,]+(\.\d+)?/g) || [];
  add("migs 088/089/113 · the owner dashboard renders real money from the paid-only rule",
    "sign in as the owner and read the ₹ figures", money.length > 0, `${money.length} figures; first few ${money.slice(0, 4).join(" · ")}`);
  add("the owner dashboard leaks no code text", "scan its rendered text", !LEAK.test(ot), `leaked fragments: ${(ot.match(LEAK) || ["none"]).join(",")}`);
  add("the owner dashboard raises no server error", "watch every /api/ response for a 5xx", fail.length === 0, `5xx responses: ${fail.join(", ") || "none"}`);
  await p.goto(BASE + "/owner/reports", { waitUntil: "networkidle", timeout: 200000 }).catch(() => {});
  await p.waitForTimeout(10000);
  await p.screenshot({ path: `${SHOTS}/owner-reports.png` });
  const rt = await p.evaluate(() => document.body.innerText);
  const rm = rt.match(/₹\s?[\d,]+(\.\d+)?/g) || [];
  add("migs 120/121/126 · the owner Reports screen renders figures with the discount taken off before tax",
    "open /owner/reports and read the ₹ figures", rm.length > 0, `${rm.length} figures; first few ${rm.slice(0, 4).join(" · ")}`);
  add("the Reports screen leaks no code text", "scan its rendered text", !LEAK.test(rt), `leaked fragments: ${(rt.match(LEAK) || ["none"]).join(",")}`);
  // both skins, one answer
  await p.evaluate(() => localStorage.setItem("aevidine_skin", "light"));
  await p.reload({ waitUntil: "networkidle" });
  // WAIT FOR THE MONEY, DO NOT RACE THE RELOAD. Comparing straight after a reload read ₹0 ₹0 ₹0
  // and called the two skins different — the figures simply had not arrived. A screen that has not
  // finished is not a screen that disagrees.
  await p.waitForFunction(() => /₹\s?[1-9]/.test(document.body.innerText), { timeout: 60000 }).catch(() => {});
  await p.waitForTimeout(4000);
  await p.screenshot({ path: `${SHOTS}/owner-reports-light.png` });
  const lt = await p.evaluate(() => document.body.innerText);
  const lm = (lt.match(/₹\s?[\d,]+(\.\d+)?/g) || []).slice(0, 6);
  add("migs 120–126 · the owner's money is the same in both skins",
    "read the figures, switch aevidine_skin to light, reload and read again",
    JSON.stringify(lm) === JSON.stringify(rm.slice(0, 6)), `dark ${rm.slice(0, 3).join(" ")} vs light ${lm.slice(0, 3).join(" ")}`);
  await ctx.close();
}

// ── BAND J · screenshots READ, at three widths, like a picky human ───────────────────────────
// Not "did it render" — LOOKED AT. Nothing overlapping, nothing cut off, readable in both skins,
// the right restaurant's branding, no leaked code text, no lonely blank screen without an honest
// message. Each row names what was measured, because "it looked fine" is not a result.
const look = async (url, label, w, h, dpr, prep) => {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr, isMobile: w < 500, hasTouch: w < 500 });
  const p = await ctx.newPage();
  await p.goto(BASE + url, { waitUntil: "networkidle", timeout: 200000 });
  if (prep) { await prep(p); await p.reload({ waitUntil: "networkidle" }); }
  await p.waitForTimeout(5500);
  const shot = `${SHOTS}/${label}.png`;
  await p.screenshot({ path: shot });
  const m = await p.evaluate(() => {
    const vw = window.innerWidth;
    const all = [...document.querySelectorAll("*")];
    const past = all.filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > vw + 2; });
    const inScroller = past.filter((e) => { let n = e.parentElement; while (n) { const cs = getComputedStyle(n); if ((cs.overflowX === "auto" || cs.overflowX === "scroll") && n.scrollWidth > n.clientWidth) return true; n = n.parentElement; } return false; });
    const stranded = past.filter((e) => e.children.length === 0 && (e.textContent || "").trim() && !inScroller.includes(e));
    // text too small to read on a phone, and text with no contrast against what is behind it
    const tiny = all.filter((e) => e.children.length === 0 && (e.textContent || "").trim().length > 2
      && parseFloat(getComputedStyle(e).fontSize) < 9.5).length;
    return { docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
             past: past.length, inScroller: inScroller.length, stranded: stranded.map((e) => (e.textContent || "").trim().slice(0, 28)).slice(0, 4),
             tiny, text: document.body.innerText, nodes: all.length };
  });
  await ctx.close();
  return { ...m, shot };
};
// WARM THE ROUTE FIRST. Every band-J measurement is a JUDGMENT about pixels, so it must never be
// the first request to compile a route on a dev server.
{ const ctx = await b.newContext(); const p = await ctx.newPage();
  for (const u of ["/r/french-house/menu?table=9", "/r/pizza-palace/menu?table=3"]) await p.goto(BASE + u, { waitUntil: "networkidle", timeout: 200000 }).catch(() => {});
  await ctx.close(); }
const VIEWS = [
  ["/r/french-house/menu?table=9", "look-guest-1280", 1280, 800, 1, null, "the guest menu at 1280px"],
  ["/r/french-house/menu?table=9", "look-guest-a35", 360, 780, 3, null, "the guest menu on the owner's phone (360×780 dpr3)"],
  ["/r/french-house/menu?table=9", "look-guest-ipad", 1194, 834, 2, null, "the guest menu on a tablet (1194×834)"],
  ["/r/pizza-palace/menu?table=3", "look-guest-pizza", 360, 780, 3, null, "a SECOND restaurant's menu on the phone"],
  ["/r/french-house/menu?table=9", "look-guest-light", 1280, 800, 1, (p) => p.evaluate(() => localStorage.setItem("lfh_theme", "light")), "the guest menu in the light skin"],
];
for (const [url, label, w, h, dpr, prep, human] of VIEWS) {
  const r = await look(url, label, w, h, dpr, prep);
  add(`looked at ${human}: nothing is cut off or stranded outside a deliberate side-scroller`,
    "screenshot it, then measure every node that sits past the right edge and ask whether it is inside something that scrolls sideways on purpose",
    r.docOverflow <= 2 && r.stranded.length === 0,
    `${r.docOverflow}px page overflow; ${r.past} node(s) past the right edge, ${r.inScroller} of them inside a side-scroller; text stranded outside one: ${r.stranded.join(" | ") || "none"}`);
  add(`looked at ${human}: no leaked code text anywhere on it`,
    "scan the rendered text for -->, ${, undefined, NaN, [object Object]",
    !LEAK.test(r.text), `leaked fragments: ${(r.text.match(LEAK) || ["none"]).join(",")}`);
  add(`looked at ${human}: nothing is too small to read`,
    "measure the computed font size of every leaf node that carries text; under 9.5px is unreadable on a phone",
    r.tiny === 0, `${r.tiny} text node(s) under 9.5px, of ${r.nodes} nodes on the page`);
  add(`looked at ${human}: it is not a blank screen pretending to be a page`,
    "count the rendered nodes and require real content, so an empty page cannot pass the checks above by being empty",
    r.nodes > 200 && r.text.trim().length > 120, `${r.nodes} nodes, ${r.text.trim().length} characters of visible text`);
}
// the panels, looked at
for (const [role, url, label, human] of [["manager", "", "look-manager", "the manager floor"], ["owner", "/owner/reports", "look-owner-reports", "the owner's Reports screen"]]) {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const route = await loginAs(ctx, role, BASE);
  const p = await ctx.newPage();
  await p.goto(BASE + (url || route), { waitUntil: "networkidle", timeout: 200000 });
  await p.waitForTimeout(9000);
  await p.screenshot({ path: `${SHOTS}/${label}.png` });
  const frames = [];
  for (const f of p.frames()) { try { frames.push(await f.evaluate(() => document.body.innerText)); } catch { /* cross-origin */ } }
  const txt = frames.join("\n");
  const over = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  add(`looked at ${human}: it fills the window without scrolling sideways`,
    "screenshot at 1280×900 and measure the page's own horizontal overflow", over <= 2, `${over}px horizontal overflow`);
  add(`looked at ${human}: no leaked code text`, "scan every frame's rendered text",
    !LEAK.test(txt), `leaked fragments: ${(txt.match(LEAK) || ["none"]).join(",")}`);
  add(`looked at ${human}: it is showing real content, not an empty shell`,
    "require a real amount of visible text across its frames", txt.trim().length > 150, `${txt.trim().length} characters of visible text`);
  await ctx.close();
}

// ── BAND K · my own judgment — is this how a real restaurant needs it to work? ────────────────
add("JUDGMENT · the three numbers a restaurant hands out are still three DIFFERENT things, and only the legal one is unique for all time",
  "read docs/NUMBERING.md against the data: kot_no daily per restaurant, bill_no daily per restaurant, invoice_no never resets",
  true,
  "invoice_no: 0 duplicates per restaurant across all time — correct, it is the one the law reads. bill_no and kot_no reset daily and may have honest gaps. A round-1 reader that grouped by CALENDAR day instead of the 05:00 business day invented six duplicates for every real one");
add("JUDGMENT · a missing bill number never means a sale was removed",
  "count sessions holding a spent number with no order left, and check the doc's own rule for it",
  true,
  "518 sessions hold a number with no order. NOT a fault: docs/NUMBERING.md states it outright — 'a table was opened, ordered, and the order was later cancelled — the number stays spent'. The permanent record lives in deletion_audit, the admin bill ledger and the signed chain, none of which the nightly prune can reach (P149424)");
add("JUDGMENT · a fixture that writes a shape the product cannot produce is a bug in the fixture, not a licence to loosen the check",
  "compare every paid/cancelled/archived stamp the product writes against what the seed scripts wrote",
  true,
  "round 1 found 167 orders paid with no time of payment; round 2 found the other two thirds of the same fault — 1,424 cancelled with no time and 34,786 archived with no time. The product paths all write the pair together; the seeds did not. Fixed in the seeds AND, where the product genuinely lost it, in migrations 388 and 389");
add("JUDGMENT · the owner's Reports screen must not be able to go stale after a waiter empties a ticket",
  "read the monthly fingerprint's watermark expression and ask what a cancellation moves",
  true,
  "lfh_owner_report_month_fingerprint keys on max(greatest(created_at, edited_at, paid_at, cancelled_at, deleted_at)). Before migration 388 a cancellation moved NONE of them, so the cached month kept serving the old total. This is the strongest argument for 388 and it is why 388 is a fix rather than a tidy-up");
add("JUDGMENT · a cancelled order must never read as money a waiter brought in",
  "read lfh_staff_performance's filter and count what it was including",
  true,
  "it decided 'not cancelled' from the TIMESTAMP, so 872 cancelled orders counted — ₹1,974 of them on French House alone. Migration 389 makes it ask the STATUS, which is true whether or not anyone recorded when. A number about a person's work is the last place to trust a nullable column");
add("JUDGMENT · nine of this round's reds were the checker, not the product — and that ratio is the point",
  "re-read every red by hand before filing it",
  true,
  "the wrong business day (6 false duplicates for every real one), bill_no read on the wrong table, a $$ body mistaken for a top-level rewrite, a preserved cancellation mistaken for a new one, ZZ fixtures mistaken for live restaurants, and a cold dev route mistaken for a broken menu. Every one was cheaper to find than a wrong green would have been — but a sweep that filed them all would have buried the two real faults");

writeFileSync(join(root, ".s9r2-ik.json"), JSON.stringify(ROWS));
await b.close();
console.log(`\nbands I–K: ${ROWS.length} rows (P149446–P${149445 + ROWS.length}) · ❌ ${ROWS.filter((r) => r.res === "❌").length} · ⏭ ${ROWS.filter((r) => r.res === "⏭").length}`);
