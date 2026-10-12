// scripts/sweep/t16s10/shots.mjs — the screenshot rows: each shared overlay opened on the REAL panel
// on this terminal's dev server, signed in once per role, every write answered by the test. Writes
// PNGs to .claude/sweep/shots/S10-T16/ and a measures JSON beside them; a person then LOOKS at each.
//   node scripts/sweep/t16s10/shots.mjs [--base http://localhost:4416]
/* eslint-disable @typescript-eslint/no-unused-vars -- a re-run harness: each suite imports the shared helper set whole, and scenario objects carry fields only some rows read */
import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { loginAs } from "../login.mjs";
import { ROOT } from "./lib.mjs";

const BASE = process.argv.includes("--base") ? process.argv[process.argv.indexOf("--base") + 1] : "http://localhost:4416";
const OUT = join(ROOT, ".claude/sweep/shots/S10-T16"); mkdirSync(OUT, { recursive: true });
const b = await chromium.launch();
const M = {};
const VP = { phone: { viewport: { width: 360, height: 780 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true }, desk: { viewport: { width: 1280, height: 800 } } };
async function open(role, vp, skin = "light") {
  const ctx = await b.newContext(VP[vp]);
  await loginAs(ctx, role, BASE);
  await ctx.addInitScript((s) => { try { localStorage.setItem("lfh_panel_theme", s); } catch (e) {} }, skin);
  const p = await ctx.newPage();
  await p.route("**/api/**", (r) => (["GET", "HEAD"].includes(r.request().method()) ? r.continue() : r.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' })));
  const panel = { manager: "editor", kitchen: "kitchen", tablet: "tablet" }[role];
  await p.goto(`${BASE}/panels/${panel}/index.html`, { waitUntil: "load", timeout: 120000 });
  await p.waitForFunction(() => !!(window.LFH_OUTBOX && document.getElementById("lfhConnBadge")), null, { timeout: 60000 });
  await p.waitForTimeout(3000);
  return { ctx, p };
}
const shot = async (p, name) => { await p.screenshot({ path: join(OUT, name + ".png") }); };
const hscroll = (p) => p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
const junk = (p) => p.evaluate(() => /\bundefined\b|\bNaN\b|\[object Object\]|\$\{/.test(document.body.innerText));
try {
  if (process.argv.includes("--strip-only")) { /* skip to the strip */ } else {
  // the bell sheet — manager 1280, tablet 360
  for (const [role, vp, name] of [["manager", "desk", "bell-manager-1280"], ["tablet", "phone", "bell-tablet-360"]]) {
    const { ctx, p } = await open(role, vp);
    const has = await p.evaluate(() => !!document.getElementById("lfhBellBtn"));
    if (has) { await p.evaluate(() => document.getElementById("lfhBellBtn").click()); await p.waitForTimeout(400); }
    M[name] = { has, junk: await junk(p), hscroll: await hscroll(p), sheet: await p.evaluate(() => { const s = document.querySelector(".lfh-bell-sheet"); if (!s) return null; const r = s.getBoundingClientRect(); return { inside: r.left >= 0 && r.right <= innerWidth + 0.5 && r.bottom <= innerHeight + 0.5, w: r.width }; }) };
    await shot(p, name); await ctx.close();
  }
  // the profile screen + drawer — manager 1280 (both skins) and 360
  for (const [skin, vp, name] of [["light", "desk", "me-manager-1280-light"], ["dark", "desk", "me-manager-1280-dark"], ["light", "phone", "me-manager-360"]]) {
    const { ctx, p } = await open("manager", vp, skin);
    await p.evaluate(async () => { if (window.LFH_ME) await window.LFH_ME.open(); });
    await p.waitForTimeout(1500);
    M[name] = { junk: await junk(p), hscroll: await hscroll(p), text: await p.evaluate(() => (document.querySelector("#meBody") || {}).innerText ? document.querySelector("#meBody").innerText.slice(0, 120) : "") };
    await shot(p, name);
    await p.evaluate(() => window.LFH_ME && window.LFH_ME.close());
    const dr = name.replace("me-", "drawer-");
    const has = await p.evaluate(() => !!document.getElementById("staffSettingsBtn"));
    if (has) { await p.evaluate(() => document.getElementById("staffSettingsBtn").click()); await p.waitForTimeout(800); }
    M[dr] = { has, junk: await junk(p), card: await p.evaluate(() => { const c = document.querySelector(".lfh-dw"); if (!c) return null; const r = c.getBoundingClientRect(); return { inside: r.top >= 0 && r.bottom <= innerHeight + 0.5 && r.left >= 0 && r.right <= innerWidth + 0.5 }; }) };
    await shot(p, dr); await ctx.close();
  }
  // the issue modal — manager 1280 and tablet 360
  for (const [role, vp, name] of [["manager", "desk", "issue-manager-1280"], ["tablet", "phone", "issue-tablet-360"]]) {
    const { ctx, p } = await open(role, vp);
    await p.evaluate(() => window.LFH_ISSUE && window.LFH_ISSUE.open({ api: async () => ({ ok: true }) }));
    await p.waitForTimeout(500);
    M[name] = { junk: await junk(p), btns: await p.evaluate(() => [...document.querySelectorAll(".lfhir-mbtn")].map((x) => { const r = x.getBoundingClientRect(); return r.right <= innerWidth && r.bottom <= innerHeight && r.width > 0; })) };
    await shot(p, name); await ctx.close();
  }
  // the undo card — manager 360 with a toast, and the dark skin
  for (const [skin, name] of [["light", "undo-manager-360"], ["dark", "undo-manager-360-dark"]]) {
    const { ctx, p } = await open("manager", "phone", skin);
    await p.evaluate(() => window.LFH_UNDO.show({ message: "Butter Chicken served", sub: "Table 5", seconds: 5 }));
    await p.waitForTimeout(600);
    await p.evaluate(() => { const t = document.querySelector(".toasts") || document.body; const d = document.createElement("div"); d.className = "toast"; d.textContent = "A toast raised while the card is up"; t.appendChild(d); });
    await p.waitForTimeout(300);
    M[name] = await p.evaluate(() => { const u = document.getElementById("lfh-undobar").getBoundingClientRect(), t = document.querySelector(".toast"); const tr = t ? t.getBoundingClientRect() : null; return { overlap: tr ? !(tr.bottom <= u.top || tr.top >= u.bottom) : null, card: { top: u.top, bottom: u.bottom } }; });
    await shot(p, name); await ctx.close();
  }
  // kitchen tickets and tablet totals at 360
  { const { ctx, p } = await open("kitchen", "phone"); M["kitchen-360"] = { junk: await junk(p), hscroll: await hscroll(p), clipped: await p.evaluate(() => [...document.querySelectorAll(".kot")].filter((k) => k.scrollWidth > k.clientWidth + 2).length) }; await shot(p, "kitchen-360"); await ctx.close(); }
  { const { ctx, p } = await open("tablet", "phone"); M["tablet-360"] = { junk: await junk(p), hscroll: await hscroll(p), totals: await p.evaluate(() => [...document.querySelectorAll(".ordtotal,.ctotal")].map((e) => e.textContent.trim()).slice(0, 6)) }; await shot(p, "tablet-360"); await ctx.close(); }
  }
  // the take-order category strip (swipe hint) — manager 360 and 1280
  for (const [vp, name] of [["phone", "strip-manager-360"], ["desk", "strip-manager-1280"]]) {
    const { ctx, p } = await open("manager", vp);
    const opened = await p.evaluate(() => { const b = [...document.querySelectorAll("button, [role=button], .ft-take, a")].find((x) => /take order/i.test((x.textContent || "") + " " + (x.getAttribute("aria-label") || "") + " " + (x.title || ""))); if (b) { b.click(); return b.outerHTML.slice(0, 80); } return [...document.querySelectorAll("button")].map((x) => x.textContent.trim()).filter(Boolean).slice(0, 30).join(" | "); });
    await p.waitForTimeout(1500);
    M[name] = { opened, rows: await p.evaluate(() => [...document.querySelectorAll("[data-swipe-hint]")].filter((r) => r.offsetParent).map((r) => ({ more: r.getAttribute("data-more"), chip: !!(r.__lfhChip && !r.__lfhChip.hidden), over: r.scrollWidth - r.clientWidth }))) };
    await shot(p, name); await ctx.close();
  }
} finally {
  writeFileSync(join(OUT, process.argv.includes("--strip-only") ? "measures-strip.json" : "measures.json"), JSON.stringify(M, null, 1));
  await b.close();
}
console.log(JSON.stringify(M, null, 1));
