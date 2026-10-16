// Band B — the docket and the tiles in the states the happy path never visits. ids P189181–P189240.
//
//   node scripts/sweep/t20s10/band-b-shapes.mjs --base http://localhost:4420 [--json=<file>]
//
// The unusual states are produced the way sweep #8's round 2 did it — by answering the PAGE'S OWN
// request differently in the browser (r2lib patchJson / refuse / fail500): two days of trade, nothing
// paid yet, one restaurant's figures withheld, a food-cost read that failed, more paid out than taken.
// Nothing is written to the shared database and no real switch is flipped. Each fix in this run
// (items 1–8) has rows here that would go red if it were undone.
import { openWith, closeBrowser, patchJson, refuse, fail500, setRange } from "../t13/r2lib.mjs";
import { chk, report, junk } from "./lib.mjs";

const PG = "app/owner/page.tsx", TD = "components/owner/TileDocket.tsx";
const MULTI = { username: "diagmulti", password: "diag-multi-2026", route: "/owner" };
const FH = "00000000-0000-0000-0000-000000000001";
const settle = async (pg) => {
  await pg.waitForSelector(".ow2-stats5", { timeout: 60000 });
  await pg.waitForFunction(() => document.querySelectorAll(".ow2-stats5 .anim-skel").length === 0, null, { timeout: 90000 }).catch(() => {});
  await pg.waitForTimeout(600);
};
const TILE = { revenue: 0, orders: 1, today: 2, expenses: 3, onhand: 4 };
async function sheet(pg, which) {
  await pg.locator(".ow2-stats5 .ow2-kpi").nth(TILE[which]).click();
  await pg.waitForSelector(".tdk", { timeout: 10000 });
  await pg.waitForTimeout(350);
  const s = await pg.evaluate(() => {
    const q = (sel) => document.querySelector(sel);
    const rows = [...document.querySelectorAll(".tdk .rows .r")].map((r) => ({ l: r.querySelector(".l")?.textContent.trim(), v: r.querySelector(".v")?.textContent.trim(), h: r.querySelector("small")?.textContent.trim() }));
    const ttl = [...document.querySelectorAll(".tdk .rcol .ttl")].map((t) => t.textContent.trim());
    const axis = [...document.querySelectorAll(".tdk svg.chart text")].map((t) => t.textContent.trim());
    const titles = [...document.querySelectorAll(".tdk svg.chart title")].map((t) => t.textContent.trim());
    const slices = [...document.querySelectorAll(".tdk .shl .shr")].map((r) => r.querySelector(".k")?.textContent.trim());
    const nl = q(".tdk .nlink"); const ns = nl ? getComputedStyle(nl) : null;
    return { head: q(".tdk header b")?.textContent.trim(), sub: q(".tdk header i")?.textContent.trim(), big: q(".tdk .big")?.textContent.trim(), cap: q(".tdk .cap")?.textContent.trim(),
      rows, ttl, axis, titles, slices, empty: document.querySelectorAll(".tdk .empty").length, text: q(".tdk").innerText,
      href: q(".tdk .full")?.getAttribute("href") || null,
      nlink: ns ? { deco: ns.textDecorationLine, color: ns.color } : null, rect: q(".tdk").getBoundingClientRect().toJSON(), vw: innerWidth };
  });
  return s;
}
const close = async (pg) => { await pg.keyboard.press("Escape"); await pg.waitForSelector(".tdk-wrap", { state: "detached", timeout: 5000 }).catch(() => {}); };
const row = (s, label) => s.rows.find((r) => r.l === label);
const num = (t) => Number(String(t || "").replace(/[^\d.−-]/g, "").replace("−", "-"));

// ── 1. the real one-restaurant estate, This month: the Orders chart is real counts (item 2) ──────
let A = await openWith({ settle: 5000 });
await settle(A.pg);
let o = await sheet(A.pg, "orders");
const barSum = o.titles.map((t) => Number((t.match(/·\s*([\d,]+)\s+orders?$/) || [])[1]?.replace(/,/g, "") ?? NaN));
await chk("P189181", PG, "Orders sheet: every day's bar is a real order count, never an estimate ('about N orders')", "one-restaurant owner, This month, open Orders", () =>
  (o.titles.length > 0 && !o.titles.some((t) => /about/.test(t))) || o.titles.slice(0, 4).join(" | "));
await chk("P189182", PG, "Orders sheet: the day bars add up to the Orders figure at the top of the same sheet", "sum the bars' own labels", () =>
  barSum.every(Number.isFinite) && barSum.reduce((a, b) => a + b, 0) === num(o.big) || `bars ${barSum.join("+")} vs headline ${o.big}`);
await chk("P189183", PG, "Orders sheet: the bars run in date order", "read the bars left to right", () => {
  const d = o.titles.map((t) => Date.parse(`${t.split(" · ")[0]} 2026`)); return d.every((x, i) => !i || x >= d[i - 1]) || o.titles.map((t) => t.split(" · ")[0]).join(",");
});
await chk("P189184", TD, "Orders sheet: the axis names the first and last day, once each", "read the chart's axis", () =>
  (new Set(o.axis).size === o.axis.length && o.axis.length >= 2) || JSON.stringify(o.axis));
await close(A.pg);
await chk("P189185", PG, "opening the dashboard asks for NO stock count when the restaurant has no Inventory module (item 1)", "one-restaurant owner (Inventory off), the requests the page made", () =>
  !A.reqs.some((u) => /\/api\/owner\/inventory/.test(u)) || A.reqs.filter((u) => /inventory/.test(u)).join(" | "));
await chk("P189186", PG, "…so the dashboard opens with no console error and no refused request at all", "every console error and 4xx/5xx while it opened", () => {
  const e = A.errs.filter((x) => !/panel-login|favicon|React DevTools/i.test(x)); return e.length === 0 || e.slice(0, 3).join(" | ");
});
await chk("P189187", PG, "…and no Stock shortcut is drawn when there is no count to show", "read the hero", async () => (await A.pg.locator(".own-hero-link", { hasText: "Stock" }).count()) === 0);
let s = await sheet(A.pg, "revenue");
await chk("P189188", TD, "the 'Open Audit & logs →' link is underlined, so it reads as a link inside the sentence (item 8)", "computed style of the link on the Revenue sheet", () =>
  s.nlink?.deco === "underline" || JSON.stringify(s.nlink));
await chk("P189189", TD, "…and drawn in the sheet's dark ink, not inherited grey", "computed colour", () => s.nlink?.color === "rgb(27, 26, 22)" || JSON.stringify(s.nlink));
await chk("P189190", PG, "Revenue sheet: 'See the full detail' opens the Sales report for this restaurant and this period", "read the footer link", () =>
  (/open=sales/.test(s.href) && /range=month/.test(s.href) && new RegExp(`view=${FH}`).test(s.href)) || s.href);
await chk("P189191", TD, "opening a sheet does not rename the browser tab", "the tab title with the sheet open", async () => (await A.pg.title()) === "Owner — Aevidine" || await A.pg.title());
await close(A.pg);
s = await sheet(A.pg, "onhand");
await chk("P189192", PG, "On hand, one restaurant: no 'Earned where' share bar — one slice at 100% is not a picture (item 4)", "open On hand", () => !s.ttl.some((t) => /EARNED WHERE/i.test(t)) || s.ttl.join(" · "));
await chk("P189193", PG, "On hand: its footer opens the Team & pay report", "read the footer link", () => /open=team/.test(s.href) || s.href);
await close(A.pg);
s = await sheet(A.pg, "today");
await chk("P189194", PG, "Today, one restaurant: no per-restaurant bar chart (one bar is not a chart)", "open Today so far", () => s.ttl.length === 0 || s.ttl.join(" · "));
const tAvg = row(s, "Average per order");
await chk("P189195", PG, "Today: the average says what it divides — taken so far ÷ every order, paid or open (item 5)", "read the row's explanation", () =>
  (!!tAvg && /paid or open|none paid yet|no orders yet/.test(tAvg.h || "")) || JSON.stringify(tAvg));
await chk("P189196", PG, "Today: the footer opens the day summary for TODAY whatever the dropdown says", "read the footer link", () => (/range=today/.test(s.href) && /open=daysummary/.test(s.href)) || s.href);
await close(A.pg);
s = await sheet(A.pg, "expenses");
await chk("P189197", PG, "Expenses: the footer opens the Team & pay report", "read the footer link", () => /open=team/.test(s.href) || s.href);
await chk("P189198", PG, "Expenses: the parts add up to the total row", "read the rows", () => {
  const t = s.rows.find((r) => /Total/.test(r.l)); const parts = s.rows.filter((r) => r !== t).map((r) => num(r.v));
  return (t && Math.abs(parts.reduce((a, b) => a + b, 0) - num(t.v)) <= 1) || JSON.stringify(s.rows);
});
await close(A.pg);
await A.ctx.close();

// ── 2. Last 30 days: the Orders sum holds over a full month window too ─────────────────────────
A = await openWith({ settle: 5000 });
await settle(A.pg);
await setRange(A.pg, "Last 30 days"); await settle(A.pg);
o = await sheet(A.pg, "orders");
const bs2 = o.titles.map((t) => Number((t.match(/·\s*([\d,]+)\s+orders?$/) || [])[1]?.replace(/,/g, "") ?? NaN));
await chk("P189199", PG, "Last 30 days: the Orders bars add up to the Orders figure", "pick Last 30 days, open Orders", () =>
  bs2.every(Number.isFinite) && bs2.reduce((a, b) => a + b, 0) === num(o.big) || `bars ${bs2.reduce((a, b) => a + b, 0)} vs ${o.big}`);
await chk("P189200", PG, "Last 30 days: the Orders sheet names the period in its heading", "read the sheet's sub-line", () => /last 30 days/.test(o.sub || "") || o.sub);
await close(A.pg);
await setRange(A.pg, "This month"); await A.ctx.close();

// ── 3. two days of trade: the axis (item 6) ───────────────────────────────────────────────────
const days = (n) => Array.from({ length: n }, (_, i) => ({ bucket: new Date(Date.UTC(2026, 9, 13 + i, -5, -30 + 330)).toISOString().replace(".000", ""), revenue: 1000 * (i + 1), orders: 2 * (i + 1) }));
const withTs = (n) => patchJson((b) => (b && b.scope ? { ...b, timeseries: days(n), timeseriesPrev: [] } : b));
for (const [n, ids] of [[2, ["P189201", "P189202", "P189203", "P189204"]], [3, ["P189205", "P189206", "P189207", "P189208"]]]) {
  const B = await openWith({ rules: [["/api/owner/analytics", withTs(n)]], settle: 5000 });
  await settle(B.pg);
  const r = await sheet(B.pg, "revenue");
  await chk(ids[0], TD, `Revenue sheet with ${n} days of trade: the axis prints ${n} dates, each once`, `answer the page's analytics read with ${n} days`, () =>
    (r.axis.length === n && new Set(r.axis).size === n) || JSON.stringify(r.axis));
  await chk(ids[1], TD, `…the first date is anchored left and the last right, so neither runs off the card`, "read the anchors", async () => {
    const a = await B.pg.$$eval(".tdk svg.chart text", (t) => t.map((x) => x.getAttribute("text-anchor")));
    return (a[0] === "start" && a[a.length - 1] === "end") || JSON.stringify(a);
  });
  await close(B.pg);
  const ob = await sheet(B.pg, "orders");
  await chk(ids[2], TD, `Orders sheet with ${n} days: one bar per day and the axis names each end once`, "same answer", () =>
    (ob.titles.length === n && new Set(ob.axis).size === ob.axis.length) || JSON.stringify({ t: ob.titles, a: ob.axis }));
  await close(B.pg);
  const dup = B.errs.filter((e) => /same key|unique "key"/i.test(e));
  await chk(ids[3], TD, `…and React raised no duplicate-key warning drawing it`, "the console while both sheets drew", () => dup.length === 0 || dup[0]);
  await B.ctx.close();
}
for (const [n, id] of [[1, "P189209"], [0, "P189210"]]) {
  const B = await openWith({ rules: [["/api/owner/analytics", withTs(n)]], settle: 5000 });
  await settle(B.pg);
  const r = await sheet(B.pg, "revenue");
  await chk(id, TD, `Revenue sheet with ${n === 1 ? "ONE day" : "NO days"} of trade: no chart, the sentence instead`, `answer with ${n} day(s)`, () =>
    (r.empty >= 1 && r.axis.length === 0 && /Not enough in this period to draw/.test(r.text)) || JSON.stringify({ empty: r.empty, axis: r.axis }));
  await B.ctx.close();
}

// ── 4. nothing paid yet today (item 5) ────────────────────────────────────────────────────────
const ovToday = (rev, ord) => patchJson((b) => (b && Array.isArray(b.restaurants)
  ? { ...b, restaurants: b.restaurants.map((r) => ({ ...r, revenueToday: rev, ordersToday: ord })), totals: { ...b.totals, revenueToday: rev, ordersToday: ord } } : b));
let C = await openWith({ rules: [["/api/owner/overview", ovToday(0, 7)]], settle: 5000 });
await settle(C.pg);
const tileSub = await C.pg.locator(".ow2-stats5 .ow2-kpi").nth(2).locator(".ow2-sub").innerText();
s = await sheet(C.pg, "today");
const a0 = row(s, "Average per order");
await chk("P189211", PG, "Today, 7 orders and none paid: the average is NOT printed as ₹0", "answer the overview with ₹0 taken from 7 orders", () => (a0 && a0.v !== "₹0") || JSON.stringify(a0));
await chk("P189212", PG, "…it says 'none paid yet', the owner's own wording for this", "same", () => (a0 && /none paid yet/.test(a0.h || "")) || JSON.stringify(a0));
await chk("P189213", PG, "…and the tile face says the same thing ('7 orders, none paid yet')", "same, read the tile", () => /7 orders, none paid yet/.test(tileSub) || tileSub);
await chk("P189214", PG, "…and the sheet still reads as English (no code text)", "same", () => junk(s.text).length === 0 || junk(s.text).join(","));
await close(C.pg); await C.ctx.close();
C = await openWith({ rules: [["/api/owner/overview", ovToday(0, 0)]], settle: 5000 });
await settle(C.pg);
s = await sheet(C.pg, "today");
const a1 = row(s, "Average per order");
await chk("P189215", PG, "Today with no orders at all: the average says 'no orders yet today', not ₹0", "answer the overview with nothing today", () => (a1 && a1.v !== "₹0" && /no orders yet/.test(a1.h || "")) || JSON.stringify(a1));
await close(C.pg); await C.ctx.close();
C = await openWith({ rules: [["/api/owner/overview", ovToday(1500, 4)]], settle: 5000 });
await settle(C.pg);
s = await sheet(C.pg, "today");
const a2 = row(s, "Average per order");
await chk("P189216", PG, "Today, ₹1,500 from 4 orders: the average is ₹375 and says it counts open orders too", "answer the overview with ₹1,500 / 4", () =>
  (a2 && a2.v === "₹375" && /paid or open/.test(a2.h || "")) || JSON.stringify(a2));
await close(C.pg); await C.ctx.close();

// ── 5. a failed food-cost read, and more paid out than taken ────────────────────────────────────
const kp = (fn) => patchJson((b) => (b && b.scope === "restaurant" ? fn(b) : b));
C = await openWith({ rules: [["/api/owner/analytics", kp((b) => ({ ...b, foodLoss: null }))]], settle: 5000 });
await settle(C.pg);
const expSub = await C.pg.locator(".ow2-stats5 .ow2-kpi").nth(3).locator(".ow2-sub").innerText();
await chk("P189217", PG, "a food-cost read that failed: the Expenses tile says so instead of looking complete", "answer analytics with foodLoss null", () => /couldn.t read the food figure/.test(expSub) || expSub);
s = await sheet(C.pg, "expenses");
await chk("P189218", PG, "…the Expenses sheet's food row says it could not be read", "open Expenses", () => /couldn't read this/.test(row(s, "Food made then binned")?.h || "") || JSON.stringify(row(s, "Food made then binned")));
await close(C.pg);
s = await sheet(C.pg, "onhand");
await chk("P189219", PG, "…and On hand warns its answer may be too high", "open On hand", () => /may be too high/.test(row(s, "Money on hand")?.h || "") || JSON.stringify(row(s, "Money on hand")));
await close(C.pg); await C.ctx.close();
C = await openWith({ rules: [["/api/owner/analytics", kp((b) => ({ ...b, staffPay: { paidOut: (b.kpis?.revenue || 0) + 50000, people: 3, entries: 4 } }))]], settle: 5000 });
await settle(C.pg);
s = await sheet(C.pg, "onhand");
await chk("P189220", PG, "paid out more than taken: On hand is a NEGATIVE figure, written with a minus", "answer analytics with staff pay above revenue", () => /^−₹/.test(s.big || "") || s.big);
await chk("P189221", TD, "…the waterfall still draws all four steps", "read the chart", () => s.axis.join(",") === "Revenue,− Staff,− Food,On hand" || s.axis.join(","));
await chk("P189222", TD, "…and nothing on the sheet reads NaN or undefined", "read the sheet", () => junk(s.text).length === 0 || junk(s.text).join(","));
await close(C.pg);
const ohFace = await C.pg.locator(".ow2-stats5 .ow2-kpi").nth(4).locator(".v").innerText();
await chk("P189223", PG, "…and the On hand tile face carries the minus too", "read the tile", () => /^−₹/.test(ohFace.trim()) || ohFace);
s = await sheet(C.pg, "expenses");
await chk("P189224", PG, "…and the Expenses sheet counts 4 staff payments to 3 people", "open Expenses", () => /4 payments to 3 people/.test(row(s, "Staff pay out")?.h || "") || JSON.stringify(row(s, "Staff pay out")));
await close(C.pg); await C.ctx.close();
// a way nobody paid by is not listed
C = await openWith({ rules: [["/api/owner/analytics", kp((b) => ({ ...b, paymentMethods: [...(b.paymentMethods || []), { method: "Swiggy", revenue: 0, orders: 0 }] }))]], settle: 5000 });
await settle(C.pg);
s = await sheet(C.pg, "revenue");
await chk("P189225", PG, "a payment channel that took ₹0 is not listed under How the money arrived", "add a ₹0 Swiggy line to the answer", () => !s.slices.includes("Swiggy") || s.slices.join(","));
await close(C.pg); await C.ctx.close();

// ── 6. switched off / failed (the tiles must not open) ─────────────────────────────────────────
C = await openWith({ rules: [["/api/owner/analytics", refuse("Reports aren't enabled for this restaurant.")]], settle: 6000 });
await C.pg.waitForTimeout(2500);
const offFaces = await C.pg.locator(".ow2-stats5 .ow2-kpi .v").allInnerTexts();
await chk("P189226", PG, "Reports switched off: all five tiles print a dash", "refuse the analytics read the way the route does", () => offFaces.length === 5 && offFaces.every((v) => v.trim() === "—") || offFaces.join(","));
await chk("P189227", PG, "…and pressing one opens nothing (no sheet promising figures he cannot have)", "press Revenue", async () => {
  await C.pg.locator(".ow2-stats5 .ow2-kpi").first().click({ force: true }); await C.pg.waitForTimeout(500); return (await C.pg.locator(".tdk").count()) === 0;
});
await chk("P189228", PG, "…and the calm 'Figures aren't shown here' card explains it — not the red Couldn't load", "read the page", async () => {
  const t = await C.pg.locator(".adm-main").innerText(); return (/Figures aren.t shown here/.test(t) && !/Couldn.t load\./.test(t)) || t.slice(0, 160);
});
await C.ctx.close();
C = await openWith({ rules: [["/api/owner/overview", fail500]], settle: 6000 });
await C.pg.waitForTimeout(2500);
const failSubs = await C.pg.locator(".ow2-stats5 .ow2-sub").allInnerTexts();
await chk("P189229", PG, "the overview read failed: every tile says it could not load, instead of spinning for ever", "answer the overview with a 500", () =>
  failSubs.length === 5 && failSubs.every((t) => /couldn.t load this just now/i.test(t)) || failSubs.join(" | "));
await chk("P189230", PG, "…and no tile wears the '● live' pill over nothing", "same", async () => (await C.pg.locator(".ow2-live").count()) === 0);
await C.ctx.close();

// ── 7. two restaurants: whose figures the sheet is about (items 3 and 4) ────────────────────────
const hideSecond = patchJson((b) => (b && Array.isArray(b.restaurants) && b.restaurants.length > 1
  ? { ...b, restaurants: b.restaurants.map((r, i) => (i === 1 ? { ...r, reportsOff: true, revenueToday: 0, ordersToday: 0, revenueAll: 0, ordersAll: 0 } : r)) } : b));
let M = await openWith({ creds: MULTI, rules: [["/api/owner/overview", hideSecond]], settle: 6000 });
await settle(M.pg);
const subs = [];
for (const t of ["revenue", "orders", "today", "expenses", "onhand"]) { const x = await sheet(M.pg, t); subs.push([t, x.sub, x.cap]); await close(M.pg); }
await chk("P189231", PG, "one restaurant's figures withheld: every sheet's heading says '1 of 2 restaurants', never 'all 2' (item 3)", "answer the overview with the second restaurant's Reports off", () =>
  subs.every(([, sub]) => /1 of 2 restaurants/.test(sub) && !/all 2 restaurants/.test(sub)) || JSON.stringify(subs));
await chk("P189232", PG, "…and the Revenue sheet's caption names the same coverage", "same", () => /1 of 2 restaurants/.test(subs[0][2]) || subs[0][2]);
await M.ctx.close();
M = await openWith({ creds: MULTI, settle: 6000 });
await settle(M.pg);
s = await sheet(M.pg, "today");
await chk("P189233", PG, "all restaurants, both reporting: the sheet says 'all 2 restaurants'", "two-restaurant owner, Today", () => /all 2 restaurants/.test(s.sub) || s.sub);
await chk("P189234", PG, "…and Today draws one bar per restaurant, both of them", "same", () => (s.ttl.some((t) => /by restaurant/i.test(t)) && s.titles.length === 2) || JSON.stringify({ ttl: s.ttl, t: s.titles }));
await close(M.pg);
s = await sheet(M.pg, "onhand");
await chk("P189235", PG, "…and On hand shows where it was earned, one slice per restaurant", "same, On hand", () => (s.ttl.some((t) => /EARNED WHERE/i.test(t)) && s.slices.length === 2) || JSON.stringify({ ttl: s.ttl, sl: s.slices }));
await close(M.pg);
// drill into French House
await M.pg.locator(".hq-table tbody tr.hq-row", { hasText: "French House" }).first().click();
await M.pg.waitForSelector(".ow2-drawer"); await M.pg.locator(".ow2-drawer .full").click();
await M.pg.waitForTimeout(3000); await settle(M.pg);
s = await sheet(M.pg, "today");
await chk("P189236", PG, "drilled into ONE restaurant: the Today sheet is about that restaurant only — no estate bar chart (item 4)", "drawer → View in full detail → Today", () =>
  (/French House/.test(s.sub) && !s.ttl.some((t) => /by restaurant/i.test(t))) || JSON.stringify({ sub: s.sub, ttl: s.ttl }));
await close(M.pg);
s = await sheet(M.pg, "onhand");
await chk("P189237", PG, "…and On hand shows no other restaurant's takings", "same, On hand", () =>
  (!s.ttl.some((t) => /EARNED WHERE/i.test(t)) && !/Pizza Palace/.test(s.text)) || JSON.stringify({ ttl: s.ttl, sl: s.slices }));
await close(M.pg);
s = await sheet(M.pg, "revenue");
await chk("P189238", PG, "…and the Revenue sheet's link opens that restaurant's report, not all of them", "same, Revenue footer", () => (new RegExp(`view=${FH}`).test(s.href) && !/view=all/.test(s.href)) || s.href);
await close(M.pg);
// ── item 9: Escape inside one restaurant closes ONLY the top popup ──────────────────────────────
for (const [id, name, open] of [
  ["P189501", "a tile sheet", async () => { await M.pg.locator(".ow2-stats5 .ow2-kpi").nth(4).click(); await M.pg.waitForSelector(".tdk"); }],
  ["P189502", "the period list", async () => { await M.pg.locator(".owr-btn.main").click(); await M.pg.waitForSelector(".owr-pop"); }],
  ["P189503", "the restaurant picker", async () => { await M.pg.locator(".owd-btn").click(); await M.pg.waitForSelector(".owd-pop"); }],
]) {
  await open(); await M.pg.waitForTimeout(300);
  await M.pg.keyboard.press("Escape"); await M.pg.waitForTimeout(700);
  const closed = (await M.pg.locator(".tdk, .owr-pop, .owd-pop").count()) === 0;
  const where = (await M.pg.locator(".owd-btn .lbl").innerText()).trim();
  await chk(id, PG, `inside one restaurant, Escape on ${name} closes it and he STAYS in that restaurant (item 9)`, "drilled into French House, open it, press Escape", () =>
    (closed && /French House/.test(where)) || JSON.stringify({ closed, where }));
}
await M.ctx.close();

// ── 8. the sheet's shape at the two widths either side of the fold ──────────────────────────────
for (const [w, id, want] of [[859, "P189239", "portrait"], [861, "P189240", "wide"]]) {
  const W = await openWith({ width: w, height: 800, settle: 5000 });
  await settle(W.pg);
  s = await sheet(W.pg, "revenue");
  const portrait = Math.abs(s.rect.width - s.vw) < 1 && Math.abs(s.rect.bottom - 800) < 1;
  await chk(id, TD, `at ${w}px the sheet is ${want === "portrait" ? "the phone's bottom sheet (full width, from the bottom)" : "the wide centred docket"}`, `${w}x800, open Revenue`, () =>
    (want === "portrait" ? portrait : !portrait && s.rect.width <= 980.5) || JSON.stringify({ w: s.rect.width, b: s.rect.bottom, vw: s.vw }));
  await W.ctx.close();
}

await closeBrowser();
report("T20 band B · the docket in the states nobody visits (P189181–P189240, P189501–P189503)", { expect: 63 });
process.exit(process.exitCode || 0);
