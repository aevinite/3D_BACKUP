// Band F — the dashboard itself, driven: the eight periods, the picker, the estate table, the drawer,
// the dish drill, reload memory and the phone layout. ids P189431–P189480.
//
//   node scripts/sweep/t20s10/band-f-page.mjs --base http://localhost:4420 [--json=<file>]
//
// The one-restaurant diag owner for the period sweep and the drill; the two-restaurant diag owner for
// the picker, the table and the drawer. Nothing is written: every interaction here is a read.
import { openWith, closeBrowser, setRange, screenText } from "../t13/r2lib.mjs";
import { chk, report, junk } from "./lib.mjs";

const PG = "app/owner/page.tsx", AN = "components/owner/AnimatedNumber.tsx";
const MULTI = { username: "diagmulti", password: "diag-multi-2026", route: "/owner" };
const ready = async (pg) => {
  await pg.waitForSelector(".ow2-stats5", { timeout: 60000 });
  await pg.waitForFunction(() => document.querySelectorAll(".anim-skel").length === 0 && !/Loading…/.test(document.querySelector(".adm-main")?.innerText || ""), null, { timeout: 90000 }).catch(() => {});
};

// ── one restaurant: every period ─────────────────────────────────────────────────────────────
const one = await openWith({ settle: 5000 });
await ready(one.pg);
const PERIODS = ["Today", "Yesterday", "This week", "Last 7 days", "This month", "Last 30 days", "Last month", "All time"];
let n = 189431;
for (const label of PERIODS) {
  await setRange(one.pg, label);
  await ready(one.pg);
  const text = await screenText(one.pg);
  const tags = await one.pg.locator(".ow2-tag").allInnerTexts();
  const ownTags = tags.filter((t) => !/^1–\d+$|^Last 90 days$|^[A-Z][a-z]+$/.test(t.trim()) || t.trim() === label);
  await chk(`P${n++}`, PG, `${label}: every period chip on the cards names "${label}" (the month card and a clamped heatmap say their own window)`, `one-restaurant owner, desktop, pick ${label}`, () =>
    (ownTags.length >= 3 && ownTags.every((t) => t.trim() === label)) || `chips: ${tags.join(" · ")}`);
  await chk(`P${n++}`, PG, `${label}: the screen settles — no code text, nothing left saying Loading…`, `one-restaurant owner, pick ${label}, wait for the reads`, () =>
    (junk(text).length === 0 && !/Loading…/.test(text)) || `junk: ${junk(text).join(",")} loading: ${/Loading…/.test(text)}`);
}
// n = 189447
await one.pg.reload({ waitUntil: "load" }); await ready(one.pg);
await chk("P189447", PG, "the chosen period survives a reload (it was All time; it comes back All time)", "reload the tab", async () =>
  (await one.pg.locator(".owr-btn.main").innerText()).trim() === "All time" || await one.pg.locator(".owr-btn.main").innerText());
await setRange(one.pg, "This month"); await ready(one.pg);
await chk("P189448", PG, "Refresh spins, stops, and the 'updated …' line comes back", "press Refresh", async () => {
  await one.pg.locator(".ow2-bar .adm-btn", { hasText: "Refresh" }).click();
  const spun = await one.pg.waitForSelector(".fa-rotate-right.fa-spin", { timeout: 3000 }).then(() => true, () => false);
  const stopped = await one.pg.waitForSelector(".fa-rotate-right.fa-spin", { state: "detached", timeout: 60000 }).then(() => true, () => false);
  await one.pg.waitForTimeout(500);
  const line = await one.pg.locator(".ow2-tools span", { hasText: "updated" }).count();
  return (spun && stopped && line >= 1) || JSON.stringify({ spun, stopped, line });
});
await chk("P189449", PG, "the range dropdown opens from the keyboard and Escape closes it", "Tab to the period button, Enter, then Escape", async () => {
  await one.pg.locator(".owr-btn.main").focus(); await one.pg.keyboard.press("Enter");
  const open = await one.pg.waitForSelector(".owr-pop", { timeout: 4000 }).then(() => true, () => false);
  await one.pg.keyboard.press("Escape");
  const shut = await one.pg.waitForSelector(".owr-pop", { state: "detached", timeout: 4000 }).then(() => true, () => false);
  return (open && shut && (await one.pg.locator(".owr-btn.main").getAttribute("aria-expanded")) === "false") || JSON.stringify({ open, shut });
});
await chk("P189450", PG, "the Recent activity card reads as English — no raw action codes like order_place", "read the card", async () => {
  const t = await one.pg.locator(".ow2-acts").innerText().catch(() => "");
  return (t.length > 0 && !/\b[a-z]+_[a-z_]+\b/.test(t) && !/[0-9a-f]{8}-[0-9a-f]{4}/.test(t)) || t.slice(0, 200);
});
await chk("P189451", PG, "all five tiles stand the same height in their row (no ragged row, no layout jump)", "measure the five tiles", async () => {
  const hs = await one.pg.$$eval(".ow2-stats5 .ow2-kpi", (els) => els.map((e) => e.getBoundingClientRect().height));
  return (hs.length === 5 && Math.max(...hs) - Math.min(...hs) <= 1.5) || hs.join(",");
});
await chk("P189452", AN, "a counted-up money figure lands on its exact value, written the Indian way", "read a dish revenue figure after the count-up", async () => {
  await one.pg.waitForTimeout(800);
  const v = await one.pg.locator(".rv-recs .rv-rec b").first().innerText().catch(() => "");
  return /^₹\d{1,2}(,\d{2})*(,\d{3})$|^₹\d{1,3}$/.test(v.trim()) || `"${v}"`;
});
// the dish drill
const firstDish = one.pg.locator(".rv-dish").first();
const dishName = (await firstDish.locator(".rv-dn").innerText().catch(() => "")).trim();
await firstDish.click();
await one.pg.waitForSelector(".own-dish", { timeout: 20000 }).catch(() => {});
await chk("P189453", PG, "tapping a dish opens its own view, headed with that dish", "press the first dish in Every dish", async () =>
  (await one.pg.locator(".own-dish-name").innerText().catch(() => "")).trim() === dishName || `wanted ${dishName}`);
await chk("P189454", PG, "the dish view's ✕ is a 44px target with a spoken label", "measure the ✕", async () => {
  const b = await one.pg.locator(".own-dish-x").boundingBox(); const lab = await one.pg.locator(".own-dish-x").getAttribute("aria-label");
  return (b && b.width >= 44 && b.height >= 44 && /Back to the dashboard/.test(lab || "")) || JSON.stringify({ b, lab });
});
await one.pg.reload({ waitUntil: "load" }); await one.pg.waitForTimeout(6000);
await chk("P189455", PG, "a reload keeps him on the dish he opened (the refresh-proof drill)", "reload while on the dish", async () =>
  (await one.pg.locator(".own-dish-name").innerText().catch(() => "")).trim() === dishName);
await one.pg.evaluate(() => history.back()); await one.pg.waitForTimeout(1500);
await chk("P189456", PG, "BACK from the dish lands on the dashboard WITH the restaurant's hero and its shortcuts", "press the browser's back", async () =>
  (await one.pg.locator(".own-hero").count()) === 1 && (await one.pg.locator(".own-hero-link").count()) >= 1 && (await one.pg.locator(".own-dish").count()) === 0);
await chk("P189457", PG, "…and still inside the owner panel, not thrown out of it", "read the address", () => new URL(one.pg.url()).pathname === "/owner" || one.pg.url());
const errs1 = one.errs.filter((e) => !/panel-login|favicon|React DevTools/i.test(e));
await chk("P189458", PG, "the whole one-restaurant walk raised no console error and no failed request", "every console error and 4xx/5xx seen during the walk above", () => errs1.length === 0 || errs1.slice(0, 4).join(" | "));
await one.ctx.close();

// ── two restaurants: the picker, the table, the drawer ──────────────────────────────────────────
const m = await openWith({ creds: MULTI, settle: 5000 });
await ready(m.pg);
const rowsNow = async () => m.pg.$$eval(".hq-table tbody tr.hq-row", (rs) => rs.map((r) => ({
  name: r.querySelector(".hq-nm")?.textContent?.trim(), dot: getComputedStyle(r.querySelector(".hq-nm .sw")).backgroundColor,
  rev: r.querySelectorAll("td")[3]?.textContent?.trim(), orders: r.querySelectorAll("td")[4]?.textContent?.trim() })));
const rows = await rowsNow();
await chk("P189459", PG, "the estate table lists both restaurants", "two-restaurant owner, All restaurants", () => rows.length === 2 || JSON.stringify(rows));
await m.pg.locator(".owd-btn").click(); await m.pg.waitForSelector(".owd-pop");
const pick = await m.pg.$$eval(".owd-pop button", (bs) => bs.map((b) => ({ t: b.querySelector(".nm")?.textContent?.trim(), sw: b.querySelector(".sw") ? getComputedStyle(b.querySelector(".sw")).backgroundColor : null })));
await chk("P189460", PG, "the restaurant picker offers All restaurants plus each restaurant", "open the picker", () => (pick.length === 3 && pick[0].t === "All restaurants") || JSON.stringify(pick));
await chk("P189461", PG, "each restaurant keeps ONE colour: the picker's swatch equals its table dot", "compare swatch and dot", () =>
  rows.every((r) => pick.find((p) => p.t === r.name)?.sw === r.dot) || JSON.stringify({ rows, pick }));
await m.pg.keyboard.press("Escape");
await chk("P189462", PG, "Escape closes the picker", "press Escape", async () => (await m.pg.waitForSelector(".owd-pop", { state: "detached", timeout: 3000 }).then(() => true, () => false)));
// sorting
await m.pg.locator(".hq-table th", { hasText: "Orders" }).click(); await m.pg.waitForTimeout(400);
await chk("P189463", PG, "pressing a column heading sorts by it and says so to a screen reader (aria-sort)", "press Orders", async () =>
  (await m.pg.locator(".hq-table th", { hasText: "Orders" }).getAttribute("aria-sort")) === "descending");
await m.pg.locator(".hq-table th", { hasText: "Orders" }).click(); await m.pg.waitForTimeout(400);
await chk("P189464", PG, "pressing it again flips the order", "press Orders again", async () =>
  (await m.pg.locator(".hq-table th", { hasText: "Orders" }).getAttribute("aria-sort")) === "ascending");
// search
await m.pg.locator(".hq-search input").fill("zzz-no-such");
await chk("P189465", PG, "a search that matches nothing says so in a sentence", "type a name nobody has", async () =>
  /No restaurant matches that search/.test(await m.pg.locator(".hq-table").innerText()));
await m.pg.locator(".hq-x").click();
await chk("P189466", PG, "clearing the search brings every row back", "press ×", async () => (await rowsNow()).length === 2);
// drawer
await m.pg.locator(".hq-table tbody tr.hq-row").first().click();
await m.pg.waitForSelector(".ow2-drawer", { timeout: 6000 }).catch(() => {});
const dTxt = await m.pg.locator(".ow2-drawer").innerText().catch(() => "");
const r0 = (await rowsNow())[0];
await chk("P189467", PG, "a row opens that restaurant's drawer, headed with its name", "press the first row", () => dTxt.includes(r0.name) || dTxt.slice(0, 80));
await chk("P189468", PG, "the drawer's period revenue is the very figure on the row", "compare the drawer with the row", () => dTxt.includes(r0.rev) || `${r0.rev} not in drawer`);
await chk("P189469", PG, "the drawer reads as English, no code text", "read the drawer", () => junk(dTxt).length === 0 || junk(dTxt).join(","));
await m.pg.keyboard.press("Escape");
await chk("P189470", PG, "Escape closes the drawer", "press Escape", async () => m.pg.waitForSelector(".ow2-drawer", { state: "detached", timeout: 3000 }).then(() => true, () => false));
await m.pg.locator(".hq-table tbody tr.hq-row").first().click(); await m.pg.waitForSelector(".ow2-drawer");
await m.pg.evaluate(() => history.back()); await m.pg.waitForTimeout(800);
await chk("P189471", PG, "the phone's BACK closes the drawer and stays on the dashboard", "open the drawer, press back", async () =>
  (await m.pg.locator(".ow2-drawer").count()) === 0 && new URL(m.pg.url()).pathname === "/owner");
await m.pg.locator(".hq-table tbody tr.hq-row").first().click(); await m.pg.waitForSelector(".ow2-drawer");
await m.pg.locator(".ow2-drawer .full").click(); await m.pg.waitForTimeout(4000); await ready(m.pg);
await chk("P189472", PG, "'View in full detail' opens that restaurant's own dashboard, and the picker names it", "drawer → View in full detail", async () =>
  (await m.pg.locator(".owd-btn .lbl").innerText()).trim() === r0.name || await m.pg.locator(".owd-btn .lbl").innerText());
await chk("P189473", PG, "…with that restaurant's own Every dish list (only a single restaurant has one)", "read the drilled view", async () => (await m.pg.locator(".rv-dishes").count()) === 1);
await m.pg.evaluate(() => history.back()); await m.pg.waitForTimeout(1500);
await chk("P189474", PG, "BACK from the restaurant returns to All restaurants", "press back", async () =>
  (await m.pg.locator(".owd-btn .lbl").innerText()).trim() === "All restaurants" && (await m.pg.locator(".hq-table").count()) === 1);
await chk("P189475", PG, "two restaurants draw the revenue as one stacked bar per day (the 2–3 tier), not the 4+ line chart", "read the trend card", async () =>
  (await m.pg.locator(".ow2-ct", { hasText: "each bar split by restaurant" }).count()) === 1);
const errs2 = m.errs.filter((e) => !/panel-login|favicon|React DevTools|inventory\?only=counts|status of 403/i.test(e));
await chk("P189476", PG, "the two-restaurant walk raised no console error and no failed request (stock-count refusals aside, see item 1)", "every console error seen during the walk", () => errs2.length === 0 || errs2.slice(0, 4).join(" | "));
await m.ctx.close();

// ── the estate on a phone ──────────────────────────────────────────────────────────────────────
const ph = await openWith({ creds: MULTI, width: 360, height: 780, mobile: true, settle: 6000 });
await ready(ph.pg);
const phm = await ph.pg.evaluate(() => {
  const rows = [...document.querySelectorAll(".hq-table tbody tr.hq-row")].map((r) => r.getBoundingClientRect());
  return { docW: document.documentElement.scrollWidth, docH: document.documentElement.scrollHeight, vw: innerWidth, vh: innerHeight,
    rows: rows.map((r) => [Math.round(r.left), Math.round(r.right)]), thead: getComputedStyle(document.querySelector(".hq-table thead")).display,
    labels: [...document.querySelectorAll(".hq-table tbody tr.hq-row td[data-l]")].slice(0, 6).map((td) => getComputedStyle(td, "::before").content) };
});
await chk("P189477", PG, "on a 360px phone the page never scrolls sideways", "A35-sized phone, two-restaurant owner", () => phm.docW <= phm.vw || `${phm.docW} on ${phm.vw}`);
await chk("P189478", PG, "…the estate table becomes one block per restaurant, each inside the screen", "same phone", () =>
  (phm.thead === "none" && phm.rows.length === 2 && phm.rows.every(([l, r]) => l >= 0 && r <= phm.vw)) || JSON.stringify(phm));
await chk("P189479", PG, "…and every figure in a block carries its own label (no header above it any more)", "read the ::before labels", () =>
  phm.labels.length >= 4 && phm.labels.every((c) => c && c !== "none" && c !== '""') || JSON.stringify(phm.labels));
await chk("P189480", PG, "…and the document is not taller than the panel that scrolls it (no phantom drag that hides the top bar)", "same phone", () =>
  phm.docH <= phm.vh + 1 || `document ${phm.docH}px on a ${phm.vh}px screen`);
await ph.ctx.close();
await closeBrowser();
report("T20 band F · the dashboard, driven (P189431–P189480)", { expect: 50 });
process.exit(process.exitCode || 0);
