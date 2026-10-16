// Re-proves, by DRIVING the page, the old owner-home live rows whose sweep-8 detector went red on
// 2026-10-16 for a detector reason. Each is asked again the way a person would see it.
//
//   node scripts/sweep/t20s10/reprove-live.mjs --base http://localhost:4420 [--json=<file>]
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { openWith, closeBrowser, patchJson } from "../t13/r2lib.mjs";

const out = [];
const re = async (id, fn) => { let r; try { r = await fn(); } catch (e) { r = { ok: false, note: `threw: ${e.message}` }; } out.push({ id, ...r }); };
const ok = (note) => ({ ok: true, note }), no = (note) => ({ ok: false, note });
const MULTI = { username: "diagmulti", password: "diag-multi-2026" };
const settle = async (pg) => {
  await pg.waitForSelector(".ow2-stats5", { timeout: 60000 });
  await pg.waitForFunction(() => document.querySelectorAll(".ow2-stats5 .anim-skel").length === 0, null, { timeout: 90000 }).catch(() => {});
};

// P20860…P20866 — the sheet's heading. The docket prints it in CSS capitals; the text itself is the tile's name.
{
  const A = await openWith({ settle: 5000 }); await settle(A.pg);
  const got = [];
  for (const [i, name] of ["Revenue", "Orders", "Today so far", "Expenses", "On hand"].entries()) {
    await A.pg.locator(".ow2-stats5 .ow2-kpi").nth(i).click(); await A.pg.waitForSelector(".tdk");
    got.push([name, await A.pg.$eval(".tdk header b", (b) => b.textContent.trim()), await A.pg.locator(".tdk .rows .r").count()]);
    await A.pg.keyboard.press("Escape"); await A.pg.waitForSelector(".tdk-wrap", { state: "detached" });
  }
  for (const [id, k] of [["P20860", 0], ["P20861", 1], ["P20863", 2], ["P20865", 3], ["P20866", 4]]) {
    const [name, head, rows] = got[k];
    await re(id, () => head === name && rows >= 3
      ? ok(`the docket opens headed "${head}" (shown in CSS capitals — the old check compared innerText, which applies text-transform) with ${rows} rows`) : no(JSON.stringify(got[k])));
  }
  // P67031 — the three classes it saw nowhere are each drawn in a state it never visited
  await A.ctx.close();
}
{
  // ow2-chartslot: the reserved chart slot, drawn WHILE the figures load. Hold the analytics answer back.
  const hold = (rt) => setTimeout(() => rt.continue().catch(() => {}), 12000);
  const B = await openWith({ rules: [["/api/owner/analytics", hold]], waitUntil: "load", settle: 2500 });
  const slot = await B.pg.locator(".adm-empty.ow2-chartslot").count();
  await B.ctx.close();
  // ow2-one: one column when Audit & logs is withheld
  const C = await openWith({ rules: [["/api/owner/overview", patchJson((b) => (b?.entitlements ? { ...b, entitlements: { ...b.entitlements, logs: false } } : b))]], settle: 5000 });
  await settle(C.pg);
  const one = await C.pg.locator(".ow2-two.ow2-one").count();
  await C.ctx.close();
  // own-hero-badge: the stock count, when there is a count to show
  const D = await openWith({ rules: [
    ["/api/owner/overview", patchJson((b) => (b?.modules ? { ...b, modules: { ...b.modules, inventory: true } } : b))],
    ["/api/owner/inventory", (rt) => rt.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ lowCount: 3, negativeCount: 1 }) })],
  ], settle: 5000 });
  await settle(D.pg);
  const badge = await D.pg.locator(".own-hero-badge").innerText().catch(() => "");
  await D.ctx.close();
  await re("P67031", () => slot >= 1 && one === 1 && badge.trim() === "3"
    ? ok(`all three are drawn in states the old pass never visited: ow2-chartslot while the figures load (${slot} slots), ow2-one when Audit & logs is withheld, own-hero-badge when stock is low ("3")`)
    : no(JSON.stringify({ slot, one, badge })));
}
// P05816 / P67298 — the two-restaurant owner
{
  const M = await openWith({ creds: MULTI, settle: 5000 }); await settle(M.pg);
  const homeTitles = (await M.pg.locator(".ow2-ct > span:first-child").allInnerTexts()).map((s) => s.replace(/\s+/g, " ").trim());
  const tableHead = await M.pg.locator(".hq-bar").innerText().catch(() => "");
  const chartCards = await M.pg.$$eval(".adm-card", (cs) => cs.filter((c) => c.querySelector("svg")).map((c) => ({
    t: c.querySelector(".ow2-ct > span:first-child")?.textContent?.trim() || (c.querySelector(".hq-bar") ? "estate table" : "?"), chip: !!c.querySelector(".ow2-tag") })));
  await M.pg.locator(".hq-table tbody tr.hq-row").first().click(); await M.pg.waitForSelector(".ow2-drawer");
  await M.pg.locator(".ow2-drawer .full").click(); await M.pg.waitForTimeout(3000); await settle(M.pg);
  const drillTitles = (await M.pg.locator(".ow2-ct > span:first-child").allInnerTexts()).map((s) => s.replace(/\s+/g, " ").trim());
  const want = ["Revenue over time", "Revenue · this month vs last", "Revenue by category", "Busy heatmap", "Payment methods", "Every dish"];
  const missingDrill = want.filter((w) => !drillTitles.some((t) => t.startsWith(w)));
  const missingHome = want.slice(0, 5).filter((w) => !homeTitles.some((t) => t.startsWith(w)));
  await re("P05816", () => !missingDrill.length && !missingHome.length && !homeTitles.some((t) => t.startsWith("Every dish"))
    ? ok("all five estate cards render on All restaurants, and all six (Every dish included) inside one restaurant — Every dish is a ONE-restaurant card by design; the old check asked for it on the estate view")
    : no(JSON.stringify({ missingHome, missingDrill })));
  const unchipped = chartCards.filter((c) => !c.chip && c.t !== "estate table");
  await re("P67298", () => !unchipped.length && /Revenue window · /.test(tableHead)
    ? ok("every chart CARD carries its period chip; the '?' was the estate TABLE (its trend sparklines are SVG) — it names its period in its own bar, 'Revenue window · this month'")
    : no(JSON.stringify({ unchipped, tableHead })));
  await M.ctx.close();
}
// P67300 — the phone's ☰ menu (the owner shell's .owx-side, not the admin console's .adm-side)
{
  const P = await openWith({ width: 360, height: 780, mobile: true, settle: 5000 }); await settle(P.pg);
  await P.pg.locator(".owx-burger").tap();
  await P.pg.waitForTimeout(500);
  const opened = await P.pg.evaluate(() => !!document.querySelector(".owx-side.open") && document.querySelector(".owx-burger")?.getAttribute("aria-expanded") === "true");
  await P.pg.evaluate(() => history.back()); await P.pg.waitForTimeout(700);
  const closed = await P.pg.evaluate(() => !document.querySelector(".owx-side.open"));
  const here = new URL(P.pg.url()).pathname === "/owner";
  await re("P67300", () => opened && closed && here
    ? ok("tapping ☰ opens the owner shell's menu (.owx-side.open, aria-expanded true) and BACK closes it on /owner — the old check looked for the ADMIN console's .adm-side/.adm-nav (T39 item 68)")
    : no(JSON.stringify({ opened, closed, url: P.pg.url() })));
  await P.ctx.close();
}
// P67319 — "the age line stops claiming the page is fresh" with Reports switched off. The old band refused
// only the ANALYTICS read and let the sales-report read answer, so the line showed that read's age — and
// whether it read "just now" depended on how recently another run had computed it. Switched off for real,
// both routes refuse; asked that way, with both refused.
{
  const { refuse } = await import("../t13/r2lib.mjs");
  const R = await openWith({ rules: [["/api/owner/analytics", refuse("Reports aren't enabled for this restaurant — contact Aevidine.")],
    ["/api/owner/reports", refuse("Reports aren't enabled for this restaurant — contact Aevidine.")]], settle: 7000 });
  const tools = (await R.pg.locator(".ow2-tools").innerText()).replace(/\s+/g, " ");
  await R.ctx.close();
  await re("P67319", () => !/updated just now/i.test(tools) || /your last view/i.test(tools)
    ? ok(`with Reports really switched off (analytics AND the sales report refused) the toolbar makes no freshness claim: "${tools.slice(0, 90)}"`)
    : no(tools.slice(0, 120)));
}
// P67655 / P67656 / P67657 / P67661 — the ALL-ZERO estate. Sweep #8 drove it on a morning when all five
// restaurants really had taken nothing; tonight French House has, so the precondition is gone, not the
// behaviour. The state is produced the honest way instead: the page's own answers, with every figure 0.
if (process.argv.includes("--estate")) {
  const { ESTATE, setRange } = await import("../t13/r2lib.mjs");
  const zeroA = patchJson((b) => (b && b.scope === "group" ? { ...b,
    restaurantRevenue: (b.restaurantRevenue || []).map((r) => ({ ...r, revenue: 0, orders: 0 })), timeseries: [], timeseriesPrev: [],
    paymentMethods: [], categories: [], heatmap: [], prev: b.prev ? { revenue: 0, orders: 0 } : b.prev } : b));
  const zeroO = patchJson((b) => (b && Array.isArray(b.restaurants) ? { ...b,
    restaurants: b.restaurants.map((r) => ({ ...r, revenueToday: 0, ordersToday: 0 })), totals: { ...b.totals, revenueToday: 0, ordersToday: 0 } } : b));
  const Z = await openWith({ creds: ESTATE, rules: [["/api/owner/analytics", zeroA], ["/api/owner/overview", zeroO]], settle: 5000 });
  await setRange(Z.pg, "Today"); await settle(Z.pg);
  const rows = await Z.pg.locator(".hq-table tr.hq-row").count();
  const trophy = await Z.pg.locator(".ow2-split .oh.good").count();
  const who = await Z.pg.locator(".adm-card", { hasText: "Who earns more" }).innerText().catch(() => "");
  const trend = await Z.pg.locator(".adm-card", { hasText: "Revenue over time" }).innerText().catch(() => "");
  const insights = await Z.pg.locator(".owx-insight").count();
  await Z.ctx.close();
  const how = `the five-restaurant diag estate, Today, every figure in the page's own answers set to 0 (rows=${rows})`;
  await re("P67655", () => rows === 5 && trophy === 0 ? ok(`no trophy for ₹0 — ${how}`) : no(JSON.stringify({ rows, trophy })));
  await re("P67656", () => /Not enough data yet/.test(who) ? ok(`'Who earns more' says there is nothing to compare — ${how}`) : no(who.slice(0, 120)));
  await re("P67657", () => /Not enough data yet/.test(trend) ? ok(`the trend card says the same — ${how}`) : no(trend.slice(0, 120)));
  await re("P67661", () => insights === 0 ? ok(`the insight strip stays silent — ${how}`) : no(`${insights} insights`));
}
await closeBrowser();
const j = process.argv.find((a) => a.startsWith("--json="));
if (j) { mkdirSync(dirname(j.slice(7)), { recursive: true }); writeFileSync(j.slice(7), JSON.stringify(out, null, 1)); }
for (const r of out) console.log(`${r.ok ? "✅" : "❌"} ${r.id} ${r.note.slice(0, 170)}`);
