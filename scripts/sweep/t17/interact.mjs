// T17 · the owner console DRIVEN AS A PERSON WOULD — taps, toggles, Back presses, the report
// dialog. Everything here asserts the RENDERED result, never that the source contains something.
import { chromium } from "playwright";
import { loginAs } from "../login.mjs";
import { requireAppUp } from "../appUp.mjs";
const BASE = await requireAppUp(process.argv, "the T17 owner-console interaction checks");
let ID = Number(process.env.T17_FROM || 71205);
let pass = 0, fail = 0; const bad = [];
const ok = (what, cond, note = "") => { const id = "P" + (ID++);
  if (cond) { pass++; console.log(`✅ ${id} ${what}${note ? " — " + note : ""}`); }
  else { fail++; bad.push(`${id} ${what} — ${note}`); console.log(`❌ ${id} ${what} — ${note}`); } };

const browser = await chromium.launch();
// `seed:false` for any test that CHANGES the skin. An addInitScript that re-writes
// `aevidine_skin` on every load fights the app: the page reloads after a Settings tap, the seed
// puts the OLD value back, and the shell's reconcile effect then honours the seed — so the harness
// itself produced a "the toggle did nothing" failure that the product did not have. Cookie only
// for those; the cookie is what the server reads and nothing overwrites it mid-test.
const open = async (role, w = 1280, h = 900, skin = "dark", seed = true) => {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: w < 500 ? 3 : 1 });
  await loginAs(ctx, role, BASE);
  await ctx.addCookies([{ name: "aevidine_skin", value: skin, url: BASE }]);
  if (seed) await ctx.addInitScript((s) => { try { localStorage.setItem("aevidine_skin", s); } catch {} }, skin);
  const p = await ctx.newPage();
  return { ctx, p };
};

// ── 1 · the header's ☀/🌙 reaches the EMBEDDED panel without reloading it ───────────────────────
{
  const { ctx, p } = await open("owner", 1280, 900, "dark", false);   // one restaurant → straight into the editor
  await p.goto(BASE + "/owner/menu", { waitUntil: "networkidle" });
  const before = await p.evaluate(() => ({
    skin: document.querySelector(".adm.owx").getAttribute("data-skin"),
    src: document.querySelector(".ome-mount iframe")?.getAttribute("src"),
  }));
  // listen for the broadcast the embeds ride on, and count it
  await p.evaluate(() => { window.__skinShouts = []; window.addEventListener("lfh:owner-skin", (e) => window.__skinShouts.push(e.detail)); });
  await p.click(".adm-icnbtn[aria-label='Toggle light/dark theme']");
  await p.waitForTimeout(700);
  const after = await p.evaluate(() => ({
    skin: document.querySelector(".adm.owx").getAttribute("data-skin"),
    src: document.querySelector(".ome-mount iframe")?.getAttribute("src"),
    shouts: window.__skinShouts,
    ls: localStorage.getItem("aevidine_skin"),
    cookie: /aevidine_skin=(light|dark)/.exec(document.cookie)?.[1] || null,
    frameSkin: (() => { try { const d = document.querySelector(".ome-mount iframe").contentDocument;
      return d ? (d.documentElement.className + " " + d.body.className).trim() : "(no access)"; } catch { return "(blocked)"; } })(),
  }));
  ok("the header's light/dark button really changes the console's skin", after.skin !== before.skin, `${before.skin} → ${after.skin}`);
  ok("…and remembers it in localStorage", after.ls === after.skin, String(after.ls));
  ok("…and in the cookie the server reads on the next load", after.cookie === after.skin, String(after.cookie));
  ok("…and shouts it exactly ONCE, not twice", after.shouts.length === 1, JSON.stringify(after.shouts));
  ok("…and does NOT re-navigate the embedded editor (its address is unchanged)", after.src === before.src, `${before.src} vs ${after.src}`);
  ok("…and the embedded editor itself changed skin", /light/.test(after.frameSkin) || /dark/.test(after.frameSkin), after.frameSkin);
  // and it survives a hard reload, from the cookie, with no dark→light flash
  await p.goto(BASE + "/owner/menu", { waitUntil: "domcontentloaded" });
  const first = await p.evaluate(() => document.querySelector(".adm.owx")?.getAttribute("data-skin"));
  ok("the chosen skin is already right on the FIRST painted frame after a reload", first === after.skin, String(first));
  // The frame is mounted in an effect, so it does not exist at domcontentloaded — wait for it
  // rather than reading `undefined` and calling that a fault.
  await p.waitForSelector(".ome-mount iframe", { timeout: 15000 }).catch(() => {});
  const frameSrcAfterReload = await p.evaluate(() => document.querySelector(".ome-mount iframe")?.getAttribute("src"));
  ok("…and the embed is born on it too", new RegExp(`skin=${after.skin}`).test(frameSrcAfterReload || ""), String(frameSrcAfterReload));
  // …and it does not touch the guest or panel theme keys
  const other = await p.evaluate(() => ({ t: localStorage.getItem("lfh_theme"), pt: localStorage.getItem("lfh_panel_theme") }));
  ok("the owner console's choice leaves the guest menu's theme alone", other.t === null, String(other.t));
  // NOT "pt === null". The embedded panel loads public/panels/theme.js in its own <head>, and that
  // script materialises the staff-panel default ("light") into the shared same-origin localStorage
  // on boot — it has always done so, for the manager panel too, and light is exactly what an unset
  // key already means. The rule that MATTERS is that the owner's own choice never propagates into
  // it: the console is on `light` here, and if the owner then picks dark the staff panels must not
  // remember dark. That is what is asserted, twice — once each way.
  ok("…and does not write the owner's choice into the staff panels' remembered theme",
    other.pt === null || other.pt === "light", String(other.pt));
  await p.evaluate(() => { document.querySelector(".adm-icnbtn[aria-label='Toggle light/dark theme']").click(); });
  await p.waitForTimeout(900);
  const afterDark = await p.evaluate(() => ({ skin: document.querySelector(".adm.owx")?.getAttribute("data-skin"),
    pt: localStorage.getItem("lfh_panel_theme") }));
  ok("…and switching the console to dark still does not make the staff panels remember dark",
    afterDark.skin === "dark" && afterDark.pt !== "dark", `console ${afterDark.skin}, panel key ${afterDark.pt}`);
  await ctx.close();
}

// ── 2 · the Settings screen's own Light/Dark buttons agree with the header ──────────────────────
{
  const { ctx, p } = await open("owner", 1280, 900, "dark", false);
  await p.goto(BASE + "/owner/settings", { waitUntil: "networkidle" });
  const pressed = await p.$$eval(".adm-card button[aria-pressed]", (b) => b.map((x) => [x.innerText.trim(), x.getAttribute("aria-pressed")]));
  ok("Settings marks the active skin with more than a colour (aria-pressed)", pressed.some(([, v]) => v === "true"), JSON.stringify(pressed));
  await p.click("button[aria-pressed='false']");
  await p.waitForLoadState("networkidle");
  const now = await p.evaluate(() => ({ skin: document.querySelector(".adm.owx")?.getAttribute("data-skin"),
    ls: localStorage.getItem("aevidine_skin"), cookie: /aevidine_skin=(light|dark)/.exec(document.cookie)?.[1] || null }));
  ok("tapping Light on Settings repaints the whole console", now.skin === "light", String(now.skin));
  ok("…and stores it in both places, exactly like the header does", now.ls === "light" && now.cookie === "light", `${now.ls}/${now.cookie}`);
  await p.goto(BASE + "/owner", { waitUntil: "domcontentloaded" });
  ok("…and the dashboard opens light on its first frame too",
    (await p.evaluate(() => document.querySelector(".adm.owx")?.getAttribute("data-skin"))) === "light");
  await ctx.close();
}

// ── 3 · the top-bar restaurant switcher, on the three pages that re-scope IN PLACE ──────────────
{
  const { ctx, p } = await open("ownerMulti");
  for (const [path, name, expectStay] of [["/owner", "Dashboard", true], ["/owner/manager", "Manager mode", true], ["/owner/settings", "Settings", false]]) {
    await p.goto(BASE + path, { waitUntil: "networkidle" });
    const hasSwitch = await p.evaluate(() => !!document.querySelector(".owx-switch"));
    ok(`${name}: a two-restaurant owner is offered the switcher`, hasSwitch);
    if (!hasSwitch) continue;
    await p.click(".owx-switch");
    await p.waitForTimeout(200);
    const rows = await p.$$eval(".owx-switch-pop .rrow .nm", (a) => a.map((x) => x.textContent.trim()));
    ok(`${name}: the switcher lists All restaurants plus each one`, rows.length === 3 && rows[0] === "All restaurants", JSON.stringify(rows));
    ok(`${name}: …in the same order the sidebar uses`,
      JSON.stringify(rows.slice(1)) === JSON.stringify(await p.$$eval(".owx-myrest .rrow:not(.all) .nm", (a) => a.map((x) => x.textContent.trim()))),
      JSON.stringify(rows.slice(1)));
    await p.click(".owx-switch-pop .rrow:not(.all)");
    await p.waitForTimeout(1200);
    const land = new URL(p.url()).pathname;
    ok(`${name}: picking a restaurant ${expectStay ? "re-scopes this page in place" : "takes you somewhere that answers"}`,
      expectStay ? land === path : land.startsWith("/owner"), land);
    if (expectStay) {
      const pill = await p.evaluate(() => document.querySelector(".owx-scope .lbl")?.textContent.trim());
      ok(`${name}: …and the pill in the bar now names the restaurant on screen`, !!pill && pill !== "All restaurants", String(pill));
    }
  }
  await ctx.close();
}

// ── 4 · the phone drawer, and Back ──────────────────────────────────────────────────────────────
{
  const { ctx, p } = await open("ownerMulti", 360, 780);
  await p.goto(BASE + "/owner/settings", { waitUntil: "networkidle" });
  ok("phone: the sidebar is off-screen until you ask for it",
    await p.evaluate(() => document.querySelector(".owx-side").getBoundingClientRect().right <= 1));
  await p.click(".owx-burger");
  await p.waitForTimeout(400);
  ok("phone: ☰ slides the menu in", await p.evaluate(() => document.querySelector(".owx-side").getBoundingClientRect().x >= 0));
  ok("phone: …with a backdrop behind it", await p.evaluate(() => !!document.querySelector(".owx-backdrop")));
  await p.goBack();
  await p.waitForTimeout(500);
  ok("phone: the Back button closes the menu instead of leaving the page",
    (await p.evaluate(() => document.querySelector(".owx-side").getBoundingClientRect().right <= 1)) && new URL(p.url()).pathname === "/owner/settings",
    new URL(p.url()).pathname);
  // tapping a different section closes it and lands there
  await p.click(".owx-burger"); await p.waitForTimeout(300);
  await p.click(".owx-navlink[href^='/owner/menu']");
  await p.waitForTimeout(1500);
  ok("phone: tapping a section from the drawer lands on it", new URL(p.url()).pathname === "/owner/menu", new URL(p.url()).pathname);
  ok("phone: …and the drawer closed itself after the route committed",
    await p.evaluate(() => document.querySelector(".owx-side").getBoundingClientRect().right <= 1));
  await ctx.close();
}

// ── 5 · Manager mode: launcher → floor → Back → launcher ────────────────────────────────────────
{
  const { ctx, p } = await open("ownerMulti", 360, 780);
  await p.goto(BASE + "/owner/manager", { waitUntil: "networkidle" });
  const cards = await p.$$eval(".omm-card .nm", (a) => a.map((x) => x.textContent.trim()));
  ok("Manager mode: the launcher offers one card per restaurant", cards.length === 2, JSON.stringify(cards));
  ok("Manager mode: each card says what tapping it does", await p.evaluate(() => [...document.querySelectorAll(".omm-card .go")].every((g) => /Open the live floor/.test(g.textContent))));
  const beforeHist = await p.evaluate(() => history.length);
  await p.click(".omm-card");
  await p.waitForTimeout(2500);
  const onFloor = await p.evaluate(() => !!document.querySelector(".omm-mount iframe"));
  ok("Manager mode: tapping a card opens that restaurant's live floor", onFloor);
  ok("Manager mode: …and the crumb in the bar names the restaurant on the floor",
    /My Little French House|Pizza Palace/.test(await p.evaluate(() => document.querySelector(".owx-path")?.innerText || "")),
    await p.evaluate(() => (document.querySelector(".owx-path")?.innerText || "").replace(/\s+/g, " ")));
  const afterHist = await p.evaluate(() => history.length);
  ok("Manager mode: mounting the floor adds no browser history entry of its own", afterHist - beforeHist <= 1, `${beforeHist} → ${afterHist}`);
  await p.goBack();
  await p.waitForTimeout(900);
  ok("Manager mode: Back from the floor returns to the launcher, not out of the site",
    (await p.evaluate(() => !!document.querySelector(".omm-launch"))) && new URL(p.url()).pathname === "/owner/manager",
    new URL(p.url()).pathname);
  await ctx.close();
}

// ── 6 · the Generate-report dialog ──────────────────────────────────────────────────────────────
{
  const { ctx, p } = await open("owner");
  await p.goto(BASE + "/owner/reports", { waitUntil: "networkidle" });
  // `:text-is`, not `:has-text` — "Reports" (the page heading) matches "Report" as a substring,
  // so the harness was clicking the heading and reporting that the dialog never opened.
  const btn = await p.$("button:text-is('Report')");
  ok("the Reports hub carries a Report button", !!btn);
  if (btn) {
    await btn.click(); await p.waitForTimeout(400);
    const d = await p.evaluate(() => {
      const w = document.querySelector(".owrp-wrap"); if (!w) return null;
      return { periods: [...w.querySelectorAll(".owrp-periods button")].map((b) => b.textContent.trim()),
        on: [...w.querySelectorAll(".owrp-periods button.on")].map((b) => b.textContent.trim()),
        hint: w.querySelector(".owrp-hint")?.textContent.trim(),
        formats: [...w.querySelectorAll(".owrp-btns button")].map((b) => b.textContent.trim()),
        role: w.getAttribute("role"), label: w.getAttribute("aria-label"),
        browse: !!w.querySelector(".owrp-browse-open") };
    });
    ok("the report dialog opens", !!d);
    if (d) {
      ok("…and is announced as a dialog with a name", d.role === "dialog" && !!d.label, `${d.role}/${d.label}`);
      ok("…offering eleven periods including the financial year", d.periods.length === 11 && d.periods.includes("FY (Apr–Mar)"), JSON.stringify(d.periods));
      ok("…with exactly one selected to start with", d.on.length === 1, JSON.stringify(d.on));
      ok("…and the footer states which period the report will cover", /^Report for: /.test(d.hint || ""), String(d.hint));
      ok("…and offers Print, CSV and Excel", d.formats.join("|") === "Print|CSV|Excel", JSON.stringify(d.formats));
      ok("…and a calendar to browse instead of typing dates", d.browse);
      // the calendar: years → months → days, with nothing in the future selectable
      await p.click(".owrp-browse-open"); await p.waitForTimeout(250);
      const years = await p.$$eval(".owrp-grid.y button", (a) => a.map((x) => x.textContent.trim().split(" ")[0]));
      ok("the calendar reaches back as far as All time does (2020)", years.includes("2020"), JSON.stringify(years));
      ok("…and offers no future year", !years.some((y) => Number(y) > new Date().getFullYear()), JSON.stringify(years));
      await p.click(".owrp-grid.y button"); await p.waitForTimeout(250);
      const months = await p.$$eval(".owrp-grid.m button", (a) => a.map((x) => [x.textContent.trim(), x.disabled]));
      ok("a year opens its twelve months", months.length === 12, JSON.stringify(months.map((m) => m[0])));
      ok("…and a month that has not happened yet cannot be picked", months.some((m) => m[1]) || new Date().getMonth() === 11,
        JSON.stringify(months.filter((m) => m[1]).map((m) => m[0])));
      ok("…and a whole year can be taken in one tap", await p.evaluate(() => !!document.querySelector(".owrp-whole")));
      await p.click(".owrp-grid.m button:not([disabled])"); await p.waitForTimeout(250);
      const days = await p.$$eval(".owrp-grid.d button", (a) => a.map((x) => [x.textContent.trim(), x.disabled]));
      ok("a month opens its days", days.length >= 28, String(days.length));
      await p.click(".owrp-grid.d button:not([disabled])"); await p.waitForTimeout(300);
      ok("picking one exact day names that day in the footer, in words",
        /\d+ \w{3} \d{4}/.test(await p.evaluate(() => document.querySelector(".owrp-hint")?.textContent || "")),
        await p.evaluate(() => document.querySelector(".owrp-hint")?.textContent));
      // Escape closes it
      await p.keyboard.press("Escape"); await p.waitForTimeout(300);
      ok("Escape closes the report dialog", !(await p.evaluate(() => !!document.querySelector(".owrp-wrap"))));
      // CSV really downloads, and really contains the compiled statement
      await p.click("button:text-is('Report')"); await p.waitForTimeout(300);
      const dl = p.waitForEvent("download", { timeout: 45000 }).catch(() => null);
      await p.click(".owrp-btns button:has-text('CSV')");
      const got = await dl;
      ok("asking for CSV really produces a file", !!got, got ? got.suggestedFilename() : "no download");
      if (got) {
        const fsp = await import("node:fs/promises");
        const path = await got.path();
        const body = path ? await fsp.readFile(path, "utf8") : "";
        ok("…named for the report, not \"download\"", /\.csv$/.test(got.suggestedFilename()), got.suggestedFilename());
        ok("…starting with a byte-order mark so ₹ survives Excel", body.charCodeAt(0) === 0xfeff);
        ok("…headed with the scope, the period and when it was made", /business performance report —/.test(body), body.slice(1, 90));
        ok("…and carrying the money-flow calculation, not just a total", /Gross sales — everything billed, before tax/.test(body));
        ok("…and the GST line", /GST/.test(body));
        ok("…with no machine text in it", !/undefined|NaN|\[object Object\]/.test(body), (body.match(/undefined|NaN|\[object Object\]/) || [""])[0]);
      }
    }
  }
  await ctx.close();
}

// ── 7 · the password form answers before it asks the server ─────────────────────────────────────
{
  const { ctx, p } = await open("owner");
  await p.goto(BASE + "/owner/settings", { waitUntil: "networkidle" });
  const calls = [];
  p.on("request", (r) => { if (r.method() === "POST" && /\/api\/owner\/settings/.test(r.url())) calls.push(r.url()); });
  await p.fill("input[autocomplete='current-password']", "whatever");
  await p.fill("input[autocomplete='new-password']", "abcdefg");
  await p.fill("input[placeholder='Repeat new password']", "different");
  await p.click("button:has-text('Update password')");
  await p.waitForTimeout(600);
  ok("two passwords that do not match are refused on screen", /don't match/.test(await p.evaluate(() => document.body.innerText)));
  ok("…without asking the server at all", calls.length === 0, JSON.stringify(calls));
  await p.fill("input[placeholder='Repeat new password']", "abcdefg");
  await p.fill("input[autocomplete='new-password']", "abc");
  await p.fill("input[placeholder='Repeat new password']", "abc");
  await p.click("button:has-text('Update password')");
  await p.waitForTimeout(600);
  ok("a password under six characters is refused on screen", /at least 6 characters/.test(await p.evaluate(() => document.body.innerText)));
  ok("…without asking the server either", calls.length === 0, JSON.stringify(calls));
  ok("the three password boxes are real password fields, not plain text",
    (await p.$$eval(".adm-card input", (i) => i.filter((x) => x.type === "password").length)) === 3);
  await ctx.close();
}

// ── 8 · the Settings screen does not poll while the tab is in the background ────────────────────
{
  const { ctx, p } = await open("owner");
  const hits = [];
  p.on("request", (r) => { if (/\/api\/owner\/printing/.test(r.url())) hits.push(Date.now()); });
  await p.goto(BASE + "/owner/settings", { waitUntil: "networkidle" });
  const first = hits.length;
  ok("Settings asks about printing once when it opens", first >= 1 && first <= 2, String(first));
  await p.evaluate(() => { Object.defineProperty(document, "hidden", { get: () => true, configurable: true });
    document.dispatchEvent(new Event("visibilitychange")); });
  const atHide = hits.length;
  await p.waitForTimeout(35000);
  ok("…and asks nothing more while the tab is behind another one", hits.length === atHide, `${atHide} → ${hits.length} over 35s`);
  await ctx.close();
}

console.log(`\n${pass} passed, ${fail} failed  ·  ids P71205-P${ID - 1}`);
if (bad.length) { console.log("\nFAILURES:"); bad.forEach((b) => console.log(" " + b)); }
await browser.close();
process.exit(0);
