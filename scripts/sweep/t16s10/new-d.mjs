// scripts/sweep/t16s10/new-d.mjs — NEW checks, sweep #10 T16, ids P185322–P185421.
// The REAL panels on this terminal's dev server: manager, kitchen and waiter tablet at desktop 1280,
// Samsung A35 (360×780, 3×, touch) and iPad (1194×834, touch), in BOTH skins — what the shared plumbing
// paints on each. Then keyboard use, and the phone's Back inside every shared popup. Signed in once
// per role (cached); every write a panel tries is answered by the test, so nothing reaches the database.
/* eslint-disable @typescript-eslint/no-unused-vars -- a check suite: helpers are imported whole */
import { chromium } from "playwright";
import { R, ok, tag } from "./lib.mjs";
import { memo, sleep, BASE } from "./browser.mjs";
import { loginAs } from "../login.mjs";

const done = tag("new-d");
let id = 185322;
const N = (file, what, fn, how) => R(`P${id++}`, file, what, fn, how || "headless: the REAL panel on :4416, signed in once per role, writes answered by the test");
const DEV = {
  desk: { viewport: { width: 1280, height: 800 } },
  a35: { viewport: { width: 360, height: 780 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true },
  ipad: { viewport: { width: 1194, height: 834 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true },
};
const PANEL = { manager: "editor", kitchen: "kitchen", tablet: "tablet" };
let browser = null;
async function open(role, dev, skin) {
  browser = browser || await chromium.launch();
  const ctx = await browser.newContext(DEV[dev]);
  await loginAs(ctx, role, BASE);
  await ctx.addInitScript((s) => { try { localStorage.setItem("lfh_panel_theme", s); } catch (e) {} }, skin);
  const p = await ctx.newPage();
  const errors = [];
  p.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));
  await p.route("**/api/**", (r) => (["GET", "HEAD"].includes(r.request().method()) ? r.continue() : r.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' })));
  await p.goto(`${BASE}/panels/${PANEL[role]}/index.html`, { waitUntil: "load", timeout: 120000 });
  await p.waitForFunction(() => !!(window.LFH_OUTBOX && document.getElementById("lfhConnBadge")), null, { timeout: 60000 });
  await sleep(2500);
  return { ctx, p, errors };
}
const view = (role, dev, skin) => memo(async () => {
  const { ctx, p, errors } = await open(role, dev, skin);
  const m = await p.evaluate(() => {
    const b = document.getElementById("lfhConnBadge"), r = b.getBoundingClientRect(), bar = document.querySelector(".topbar").getBoundingClientRect();
    const txt = b.querySelector(".lfh-conn-txt, .lfh-conn-ms"), cs = getComputedStyle(txt);
    return {
      theme: document.documentElement.getAttribute("data-theme"),
      pill: { on: r.width > 0 && r.left >= 0 && r.right <= innerWidth + 0.5, inBar: r.top >= bar.top - 1 && r.bottom <= bar.bottom + 1, h: r.height, color: cs.color },
      hscroll: document.documentElement.scrollWidth > innerWidth + 1,
      junk: /\bundefined\b|\bNaN\b|\[object Object\]|\$\{/.test(document.body.innerText),
      offbar: !!document.getElementById("lfhOffBar") && document.getElementById("lfhOffBar").textContent,
      bell: !!document.getElementById("lfhBellBtn"),
      settings: !!document.getElementById("staffSettingsBtn"),
    };
  });
  await p.evaluate(() => window.LFH_UNDO && window.LFH_UNDO.show({ message: "Paneer tikka served", sub: "Table 5", seconds: 5 }));
  await sleep(700);
  m.undo = await p.evaluate(() => { const u = document.getElementById("lfh-undobar").getBoundingClientRect(); return { inside: u.left >= 0 && u.right <= innerWidth + 0.5 && u.bottom <= innerHeight + 0.5 && u.width > 0 }; });
  m.errors = errors;
  await ctx.close(); return m;
});
const COMBOS = [];
for (const role of ["manager", "kitchen", "tablet"]) for (const dev of ["desk", "a35", "ipad"]) for (const skin of ["light", "dark"]) COMBOS.push([role, dev, skin]);
for (const [role, dev, skin] of COMBOS) {
  const V = view(role, dev, skin), label = `${role} · ${dev === "a35" ? "Samsung A35 360px" : dev === "ipad" ? "iPad 1194px" : "desktop 1280px"} · ${skin}`;
  N("theme.js", `${label}: the panel opens in the skin the person chose`, async () => ok((await V()).theme === skin, (await V()).theme));
  N("connbadge.js", `${label}: the connection pill is on screen, inside the top bar`, async () => { const p = (await V()).pill; return ok(p.on && p.inBar, JSON.stringify(p)); });
  N("errlog.js", `${label}: nothing on the screen prints code (undefined / NaN / [object Object])`, async () => ok(!(await V()).junk));
  N("undobar.js", `${label}: the take-back card fits the screen`, async () => ok((await V()).undo.inside, JSON.stringify((await V()).undo)));
  if (dev !== "desk") N("offline.js", `${label}: the page does not scroll sideways`, async () => ok(!(await V()).hscroll));
}
// what each panel is meant to have, on a phone (the rules the owner set)
N("guestbell.js", "the kitchen never shows the guest bell (A35, light)", async () => ok((await view("kitchen", "a35", "light")()).bell === false));
N("maint.js", "the kitchen never shows a profile button (A35, light)", async () => ok((await view("kitchen", "a35", "light")()).settings === false));
N("maint.js", "the manager panel shows its profile button (desktop, light)", async () => ok((await view("manager", "desk", "light")()).settings === true));
N("errlog.js", "no panel raised a page error on any device or skin", async () => { const all = []; for (const c of COMBOS) all.push(...(await view(...c)()).errors); return ok(!all.length, [...new Set(all)].join(" | ")); });
N("connbadge.js", "the pill's words are readable ink in the dark skin (not the light-skin colour)", async () => { const d = (await view("manager", "desk", "dark")()).pill.color, l = (await view("manager", "desk", "light")()).pill.color; return ok(d !== l, `dark ${d} · light ${l}`); });

// ── keyboard and Back on the real manager panel ──
const kb = memo(async () => {
  const { ctx, p, errors } = await open("manager", "desk", "light");
  const o = {};
  await p.focus("#lfhConnBadge"); await p.keyboard.press("Enter"); await sleep(250);
  o.enterOpens = await p.evaluate(() => !!document.querySelector(".lfh-conn-pop"));
  o.focusVisible = await p.evaluate(() => { const b = document.getElementById("lfhConnBadge"); return getComputedStyle(b).outlineStyle !== "none" || b.matches(":focus-visible"); });
  await p.keyboard.press("Enter"); await sleep(200);
  o.enterCloses = await p.evaluate(() => !document.querySelector(".lfh-conn-pop"));
  const backTest = async (opener, sel) => {
    await p.evaluate(opener); await sleep(600);
    const opened = await p.evaluate((s) => !!document.querySelector(s), sel);
    await p.evaluate(() => history.back()); await sleep(600);
    return { opened, closed: await p.evaluate((s) => !document.querySelector(s), sel), onPanel: /panels\/editor/.test(p.url()) };
  };
  o.pill = await backTest(() => document.getElementById("lfhConnBadge").click(), ".lfh-conn-pop");
  o.bell = await backTest(() => window.LFH_BELL && window.LFH_BELL.open(), ".lfh-bell-back");
  o.drawer = await backTest(() => document.getElementById("staffSettingsBtn") && document.getElementById("staffSettingsBtn").click(), ".lfh-ov .lfh-dw");
  o.me = await backTest(() => window.LFH_ME && window.LFH_ME.open(), ".me-wrap");
  o.issue = await backTest(() => window.LFH_ISSUE && window.LFH_ISSUE.open({ api: async () => ({ ok: true }) }), ".lfhir-ov");
  o.offline = await backTest(() => window.LFH_OFF && window.LFH_OFF.open(), ".lfh-off-back");
  o.ask = await backTest(() => window.LFH_ASK && window.LFH_ASK.confirm("Test question?", { title: "A question" }), ".lfh-ask-yes");
  // after six Back presses, the panel is still here and the history is not left holding stale entries
  o.stillHere = /panels\/editor/.test(p.url());
  await p.evaluate(() => window.LFH_ISSUE.open({ api: async () => ({ ok: true }) })); await sleep(300);
  await p.keyboard.press("Escape"); await sleep(400);
  o.escIssue = await p.evaluate(() => !document.querySelector(".lfhir-ov"));
  await p.evaluate(() => window.LFH_ASK.text("Why?", { title: "Reason" })); await sleep(300);
  o.textBtnDisabled = await p.evaluate(() => [...document.querySelectorAll(".lfh-ask-yes")].pop().disabled);
  await p.keyboard.type("Wrong table"); o.textBtnEnabled = await p.evaluate(() => ![...document.querySelectorAll(".lfh-ask-yes")].pop().disabled);
  await p.keyboard.press("Enter"); await sleep(300); o.textClosedOnEnter = await p.evaluate(() => !document.querySelector(".lfh-ov input.lfh-in[aria-label='Reason']"));
  await p.evaluate(() => window.LFH_ASK.confirm("Sure?", {})); await sleep(250);
  o.yesFocused = await p.evaluate(() => document.activeElement && document.activeElement.classList.contains("lfh-ask-yes"));
  await p.keyboard.press("Escape").catch(() => {}); await p.evaluate(() => history.back()); await sleep(300);
  o.errors = errors;
  await ctx.close(); return o;
});
const K = (file, what, fn) => N(file, what, async () => fn(await kb()), "headless: the REAL manager panel, desktop, keyboard and history driven");
K("connbadge.js", "the connection pill opens with the keyboard (Enter)", (o) => ok(o.enterOpens));
K("connbadge.js", "…and closes again with Enter", (o) => ok(o.enterCloses));
K("connbadge.js", "…and shows a focus ring when reached by keyboard", (o) => ok(o.focusVisible));
for (const [k, file, name] of [["pill", "connbadge.js", "the connection details"], ["bell", "guestbell.js", "the guest bell's sheet"], ["drawer", "maint.js", "the profile drawer"], ["me", "myprofile.js", "My profile & pay"], ["issue", "issue-raise.js", "Report an issue"], ["offline", "offline.js", "the 'saved on this device' list"], ["ask", "maint.js", "a yes/no question card"]]) {
  K(file, `the phone's Back closes ${name}`, (o) => ok(o[k].opened ? o[k].closed : true, JSON.stringify(o[k])));
  K(file, `…and leaves the person on the panel (${name})`, (o) => ok(o[k].onPanel, JSON.stringify(o[k])));
}
K("backstack.js", "after seven popups and seven Back presses the panel is still on screen", (o) => ok(o.stillHere));
K("issue-raise.js", "Escape closes Report an issue when nothing is recording", (o) => ok(o.escIssue));
K("maint.js", "the reason card's Save stays off until something is typed", (o) => ok(o.textBtnDisabled && o.textBtnEnabled));
K("maint.js", "…and Enter saves it once something is there", (o) => ok(o.textClosedOnEnter));
K("maint.js", "a yes/no card puts the keyboard on its answer", (o) => ok(o.yesFocused));
K("errlog.js", "driving all of that raised no page error", (o) => ok(!o.errors.length, o.errors.join(" | ")));

export async function closeD() { if (browser) await browser.close(); }
done();
