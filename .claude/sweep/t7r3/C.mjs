// T7 · third 500 · BLOCK C (P40624–P40676) — THE ADMIN VIEW OF THE WAITER TABLET, done properly.
//
// Skipped with ⏭ in both earlier T7 passes ("needs the console's act-as cookie"). It does — so this
// walks in the way the admin really does: /aevinite's quick-open link, which sets the act-as cookie
// and lands on /tablet?rid=…. The rule under test is the owner's: the admin view MARKS what a
// waiter lacks, it never strips it (R "admin view MARKS, never strips").
import { chromium } from "playwright";
import { adminCookie } from "../../../scripts/sweep/login.mjs";
import { seatParty, retireTables } from "../../../scripts/sweep/fixture.mjs";
import { C, dump, at, LEAK, BASE } from "./lib.mjs";
at(40624);
const RID = "00000000-0000-0000-0000-000000000001";   // My Little French House
const T = ["23"];
let browser;
try {
  await retireTables(T); await seatParty(T);
  browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1194, height: 834 }, deviceScaleFactor: 2, hasTouch: true });
  await ctx.addCookies([adminCookie(BASE)]);
  await ctx.addInitScript(() => { try { localStorage.setItem("lfh_panel_theme", "light"); } catch {} });
  const page = await ctx.newPage();
  const errs = []; page.on("pageerror", (e) => errs.push(String(e.message)));
  // THE REAL DOOR: the console's quick-open link, which sets the act-as cookie and redirects.
  await page.goto(`${BASE}/api/admin/act-as/go?rid=${RID}&to=/tablet`, { waitUntil: "networkidle", timeout: 150000 });
  C("the console's quick-open link lands on the tablet, not back at the console", /\/tablet/.test(page.url()), page.url().replace(BASE, ""));
  C("…and pins the tab to ONE restaurant with ?rid=", page.url().includes(`rid=${RID}`), page.url().replace(BASE, "").slice(0, 90));
  let fr = null;
  for (let i = 0; i < 100 && !fr; i++) { fr = page.frames().find((f) => /\/panels\/tablet\//.test(f.url())); if (!fr) await page.waitForTimeout(400); }
  C("the panel itself loads inside the admin tab", !!fr, fr ? fr.url().split("/").pop().slice(0, 60) : "no frame");
  await fr.waitForSelector(".tile[data-t]", { timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(3000);
  C("…and the pin is carried INTO the iframe, so its own calls stay on that restaurant", /rid=/.test(fr.url()), fr.url().split("?")[1] ? fr.url().split("?")[1].slice(0, 70) : "no query");

  // ── the ribbon: what it says, and that it says it at all ────────────────────────────────
  const rb = await fr.evaluate(() => {
    const r = document.getElementById("xrayRibbon");
    if (!r) return null;
    const cs = getComputedStyle(r);
    return { txt: r.innerText.replace(/\s+/g, " ").trim(), tag: (r.querySelector(".rb-tag") || {}).innerText || "",
      crumbs: [...r.querySelectorAll(".rb-crumbs a, .rb-crumbs span")].map((x) => x.innerText.trim()).filter((x) => x && x !== "›"),
      zonesBtn: (document.getElementById("xrayZonesBtn") || {}).innerText || "", exit: !!document.getElementById("xrayExit"),
      first: document.body.firstChild === r, wrap: cs.flexWrap, z: cs.zIndex };
  });
  C("the admin view marks itself with a ribbon", !!rb, rb ? rb.tag : "no ribbon — the tab is not being treated as an admin view");
  C("the ribbon says whose view this is", /Admin view/i.test(rb.tag), rb.tag);
  C("the ribbon names the restaurant the admin walked into", rb.crumbs.length >= 3 && rb.crumbs[1].length > 1, rb.crumbs.join(" › "));
  C("the breadcrumb starts at the Dashboard, where the admin came from", rb.crumbs[0] === "Dashboard", rb.crumbs[0]);
  C("…and ends at this panel by name", /Tablet panel/i.test(rb.crumbs[rb.crumbs.length - 1]), rb.crumbs[rb.crumbs.length - 1]);
  C("the ribbon counts what is off for waiters", /control|thing/i.test(rb.zonesBtn) && /\d/.test(rb.zonesBtn), rb.zonesBtn.trim());
  C("the ribbon offers a way out", rb.exit);
  C("the ribbon is the first thing on the page, above the panel", rb.first, `first=${rb.first}`);
  C("the ribbon is allowed to wrap, so it can never push the panel sideways", rb.wrap === "wrap", rb.wrap);
  C("nothing in the ribbon leaks code", !LEAK.test(rb.txt), rb.txt.slice(0, 120));

  // ── the ribbon's ink is readable in the LIGHT skin (it was 1.85:1 once) ─────────────────
  const ink = await fr.evaluate(() => {
    // A COLOUR IS NOT ALWAYS rgb(0-255). This ribbon's wash is a color-mix(), which Chrome hands
    // back as `color(srgb 0.979 0.925 0.863)` — already 0-1. Dividing those by 255 turned a
    // near-white background into near-black and reported 3.53:1 for a ribbon that measures 5.11:1.
    const lum = (c) => {
      const nums = (c.match(/[\d.]+/g) || []).map(Number);
      const srgb = /^color\(/.test(c);
      const [r, g, b] = nums.slice(srgb ? 0 : 0, 3).map((v) => { const x = srgb ? v : v / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const r = document.getElementById("xrayRibbon");
    const tag = r.querySelector(".rb-tag"), link = r.querySelector(".rb-crumbs a");
    const bg = getComputedStyle(r).backgroundColor;
    const ratio = (fg) => { const a = lum(fg) + 0.05, b2 = lum(bg) + 0.05; return +(Math.max(a, b2) / Math.min(a, b2)).toFixed(2); };
    return { theme: document.documentElement.dataset.theme || "", tag: ratio(getComputedStyle(tag).color), link: ratio(getComputedStyle(link).color), bg };
  });
  C("the ribbon's own label is readable against its wash", ink.tag >= 4.5, `${ink.tag}:1 (${ink.theme || "dark"})`);
  C("…and so is its breadcrumb link", ink.link >= 4.5, `${ink.link}:1 (${ink.theme || "dark"})`);

  // ── the MARKS: cyan where a waiter lacks it, and nothing hidden ─────────────────────────
  const marks = await fr.evaluate(() => {
    const off = [...document.querySelectorAll(".xray-off")];
    const filled = off.filter((e) => e.matches(".qo-top, .t-take, .tacc, .btn.primary, .btn.pay"));
    const plain = off.filter((e) => !e.matches(".qo-top, .t-take, .tacc, .btn.primary, .btn.pay"));
    const cyan = getComputedStyle(document.documentElement).getPropertyValue("--xray-c").trim();
    return { n: off.length,
      hidden: off.filter((e) => { const cs = getComputedStyle(e); return cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) < 0.5; }).length,
      dead: off.filter((e) => e.disabled === true).length,
      filledRing: filled.map((e) => getComputedStyle(e).boxShadow).filter((b) => /inset/.test(b)).length, filledN: filled.length,
      plainColour: plain.map((e) => getComputedStyle(e).color), cyan,
      caps: (typeof XRAY_CAPS !== "undefined" ? XRAY_CAPS : []).map((c) => c.key) };
  });
  C("the admin view MARKS things rather than removing them", marks.n === 0 || marks.hidden === 0, `${marks.hidden} of ${marks.n} marked controls were hidden`);
  C("…and never disables one — the admin is not the restricted person", marks.dead === 0, `${marks.dead} disabled`);
  C("a marked control on a filled button takes a RING, not unreadable cyan text", marks.filledN === 0 || marks.filledRing === marks.filledN, `${marks.filledRing}/${marks.filledN}`);
  C("cyan is a declared token, so the mark means one thing everywhere", !!marks.cyan, marks.cyan || "(no --xray-c)");
  C("every waiter capability the ribbon can list is a real key", marks.caps.length === 8, marks.caps.join(","));
  C("…and none of them is tablet_invoice, which no waiter can ever have", !marks.caps.includes("tablet_invoice"), marks.caps.join(","));

  // ── the popover: what is off, and how to change it ─────────────────────────────────────
  await fr.evaluate(() => document.getElementById("xrayZonesBtn").click());
  await page.waitForTimeout(700);
  const zp = await fr.evaluate(() => {
    const z = document.getElementById("xrayZones");
    if (!z) return null;
    return { head: (z.querySelector(".zh") || {}).innerText || "", rows: [...z.querySelectorAll(".zrow[data-zk]")].map((r) => ({ k: r.dataset.zk, txt: r.innerText.replace(/\s+/g, " ").trim() })), sim: !!document.getElementById("xraySimRow"), txt: z.innerText.replace(/\s+/g, " ").trim() };
  });
  C("the count opens a list of exactly what is off", !!zp, zp ? `${zp.rows.length} rows` : "no popover");
  C("the list is headed in plain words", /Off for waiters/i.test(zp.head), zp.head);
  C("every row names the control in words, not a settings key", zp.rows.every((r) => !/_/.test(r.txt.split("⚙")[0])), zp.rows.map((r) => r.txt.split("⚙")[0].trim()).join(" | ").slice(0, 120));
  C("every row offers the way to change it", zp.rows.length === 0 || zp.rows.every((r) => /change in Access/i.test(r.txt)), zp.rows[0] ? zp.rows[0].txt : "(nothing off)");
  C("…or says plainly that nothing is off", zp.rows.length > 0 || /Nothing is off/i.test(zp.txt), zp.txt.slice(0, 90));
  C("the list offers the switch to the real waiter's view", zp.sim, `sim row = ${zp.sim}`);
  C("nothing in the list leaks code", !LEAK.test(zp.txt), zp.txt.slice(0, 120));
  // hardware Back closes the POPOVER, not the panel
  await page.evaluate(() => history.back()); await page.waitForTimeout(1200);
  const afterBack = await fr.evaluate(() => ({ pop: !!document.getElementById("xrayZones"), ribbon: !!document.getElementById("xrayRibbon"), floor: document.querySelectorAll(".tile[data-t]").length }));
  C("hardware Back closes the popover", !afterBack.pop, `pop=${afterBack.pop}`);
  C("…and leaves the panel exactly where it was", afterBack.ribbon && afterBack.floor > 0, JSON.stringify(afterBack));

  // ── the x-ray rule: the admin can USE a control that is off for waiters ─────────────────
  const xray = await fr.evaluate(() => ({
    higher: tHigher(), sim: tSim(),
    kot: (() => { try { return tableOpsOn(); } catch { return null; } })(),
    show: ["tablet_mark_paid", "tablet_discount", "tablet_table_ops"].map((k) => ({ k, perm: tperm(k), shown: tshow(k) })),
  }));
  C("the panel knows this is an admin looking in", xray.higher === true, `tHigher=${xray.higher}`);
  C("…and that it is NOT the stripped view yet", xray.sim === false, `tSim=${xray.sim}`);
  for (const r of xray.show) C(`the admin keeps ${r.k} even when it is "${r.perm}" for waiters`, r.shown === true, `perm=${r.perm} shown=${r.shown}`);

  // ── the switch to the REAL waiter's tablet, and back ────────────────────────────────────
  await fr.evaluate(() => document.getElementById("xrayZonesBtn").click());
  await page.waitForTimeout(600);
  await fr.evaluate(() => document.getElementById("xraySimRow").click());
  await page.waitForTimeout(4000);
  fr = page.frames().find((f) => /\/panels\/tablet\//.test(f.url())) || fr;
  await fr.waitForSelector(".tile[data-t]", { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(2000);
  const sim = await fr.evaluate(() => {
    const r = document.getElementById("xrayRibbon");
    return { url: location.href, sim: tSim(), higher: tHigher(), tag: r ? (r.querySelector(".rb-tag") || {}).innerText : "",
      full: !!document.getElementById("xrayFullBtn"), zones: !!document.getElementById("xrayZonesBtn"),
      marks: document.querySelectorAll(".xray-off").length, exit: !!document.getElementById("xrayExit") };
  });
  C("the switch reloads the tab as the real waiter's tablet", /view=real/.test(sim.url), sim.url.split("?")[1] || sim.url);
  C("…and the panel knows it", sim.sim === true, `tSim=${sim.sim}`);
  C("the stripped view carries NO cyan marks — it is what the waiter really sees", sim.marks === 0, `${sim.marks} marks`);
  C("…and no count of what is off, which is admin information", !sim.zones, `zonesBtn=${sim.zones}`);
  C("the ribbon stays, as the only admin trace", /Admin view/i.test(sim.tag), sim.tag);
  C("…and says it is showing the real tablet", /real tablet/i.test(sim.tag), sim.tag);
  C("the way back to the full admin view is offered", sim.full);
  C("…and so is the way out to the console", sim.exit);
  await fr.evaluate(() => document.getElementById("xrayFullBtn").click());
  await page.waitForTimeout(4000);
  fr = page.frames().find((f) => /\/panels\/tablet\//.test(f.url())) || fr;
  await fr.waitForSelector(".tile[data-t]", { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const back2 = await fr.evaluate(() => ({ url: location.href, sim: tSim(), zones: !!document.getElementById("xrayZonesBtn") }));
  C("See full admin view returns to the marked view", back2.sim === false && back2.zones, JSON.stringify({ sim: back2.sim, zones: back2.zones }));
  C("…and drops view=real from the address", !/view=real/.test(back2.url), back2.url.split("?")[1] || "");

  // ── the admin floor still WORKS, not just displays ─────────────────────────────────────
  const floor = await fr.evaluate(() => ({ tiles: document.querySelectorAll(".tile[data-t]").length, take: document.querySelectorAll(".t-take").length, txt: document.body.innerText.replace(/\s+/g, " ").slice(0, 200) }));
  C("the admin sees a real floor, not an empty one", floor.tiles > 0, `${floor.tiles} tiles`);
  C("…with the controls a waiter would use", floor.take > 0, `${floor.take} take-order buttons`);
  C("no leaked code text anywhere in the admin view", !LEAK.test(floor.txt), floor.txt.slice(0, 110));
  C("no uncaught page error in the whole admin walk", errs.length === 0, errs.join(" | ").slice(0, 200));

  // ── a narrow screen: the ribbon must not push the panel sideways ────────────────────────
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(1500);
  const narrow = await fr.evaluate(() => {
    const r = document.getElementById("xrayRibbon");
    const rr = r.getBoundingClientRect();
    const exit = document.getElementById("xrayExit").getBoundingClientRect();
    return { w: +rr.width.toFixed(1), right: +exit.right.toFixed(1), scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth };
  });
  C("at 390px the ribbon fits its own width", narrow.w <= 391, `${narrow.w}px`);
  C("…and its Exit button is on screen, not at x364 of a 360px panel", narrow.right <= 391, `right=${narrow.right}`);
  C("…and nothing is pushed sideways", narrow.scroll <= narrow.client + 1, `${narrow.scroll} vs ${narrow.client}`);
} catch (e) { C("block C completed without crashing", false, String(e.message).slice(0, 220)); }
finally { if (browser) try { await browser.close(); } catch {} await retireTables(T); process.exitCode = dump("C") ? 1 : 0; }
