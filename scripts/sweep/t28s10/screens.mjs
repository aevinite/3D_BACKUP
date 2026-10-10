#!/usr/bin/env node
// SWEEP #10 · T28 — the console screens my 26 admin routes feed, rendered and READ.
//
//   node scripts/sweep/t28s10/screens.mjs --base http://localhost:4428 [--json out.json] [--shots]
//
// For each screen, three looks: desktop 1280×800 in the dark skin, the same in the light skin, and a
// Samsung A35 (360×780, dpr 3) in dark. Each look records what a person would SEE — the rendered text
// length, an error banner, leaked code text (NaN / undefined / [object Object] / ${ / --> / a database
// sentence), a sideways page scroll — and with --shots writes a screenshot to
// .claude/sweep/shots/S10-T28/ for a human (or me) to look at. Shots are deleted once looked at.
//
// Zero sign-ins: the admin cookie the gate already accepts (scripts/sweep/login.mjs adminCookie).
// Read-only: every screen is opened, waited on and read; nothing is clicked that writes.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { adminCookie } from "../login.mjs";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const BASE = arg("--base", "http://localhost:4428").replace(/\/$/, "");
const OUT = arg("--json", "");
const SHOTS = process.argv.includes("--shots");
const DIR = new URL("../../../.claude/sweep/shots/S10-T28/", import.meta.url).pathname;
if (SHOTS) mkdirSync(DIR, { recursive: true });

export const SCREENS = [
  ["home", "/aevinite"], ["floor", "/aevinite/floor"], ["analytics", "/aevinite/analytics"], ["repair", "/aevinite/repair"],
  ["logs", "/aevinite/logs"], ["bills", "/aevinite/bill-audit"], ["changes", "/aevinite/bill-audit/changes"], ["billing", "/aevinite/billing"],
  ["customers", "/aevinite/customers"], ["health", "/aevinite/health"], ["owners", "/aevinite/owners"], ["recycle", "/aevinite/recycle"],
  ["rate-limits", "/aevinite/rate-limits"], ["restaurants", "/aevinite/restaurants"], ["printing", "/aevinite/printing"],
];
const LOOKS = [
  { key: "desk-dark", viewport: { width: 1280, height: 800 }, dpr: 1, skin: "dark" },
  { key: "desk-light", viewport: { width: 1280, height: 800 }, dpr: 1, skin: "light" },
  { key: "a35-dark", viewport: { width: 360, height: 780 }, dpr: 3, skin: "dark", mobile: true },
];
const LEAK = /\bNaN\b|\bundefined\b|\[object Object\]|\$\{|-->|invalid input syntax|violates|relation "|PGRST|duplicate key/;

const browser = await chromium.launch();
const c = adminCookie(BASE);
const results = {};
try {
  for (const look of LOOKS) {
    const ctx = await browser.newContext({ viewport: look.viewport, deviceScaleFactor: look.dpr, isMobile: !!look.mobile, hasTouch: !!look.mobile });
    await ctx.addCookies([{ name: c.name, value: c.value, url: BASE }, { name: "aevidine_skin", value: look.skin, url: BASE }]);
    await ctx.addInitScript((s) => { try { localStorage.setItem("aevidine_skin", s); } catch { /* none */ } }, look.skin);
    const page = await ctx.newPage();
    for (const [name, path] of SCREENS) {
      const errs = [];
      const onErr = (e) => errs.push(String(e?.message || e).slice(0, 120));
      page.on("pageerror", onErr);
      let status = 0;
      try {
        const resp = await page.goto(BASE + path, { waitUntil: "networkidle", timeout: 60000 });
        status = resp?.status() || 0;
        await page.waitForTimeout(800);
      } catch (e) { errs.push("goto: " + String(e?.message || e).slice(0, 80)); }
      const seen = await page.evaluate(() => {
        const t = document.body?.innerText || "";
        const d = document.documentElement;
        return {
          len: t.trim().length,
          text: t.slice(0, 20000),
          sideways: d.scrollWidth > d.clientWidth + 1,
          skin: document.querySelector("[data-skin]")?.getAttribute("data-skin") || null,
        };
      });
      page.off("pageerror", onErr);
      const leak = (seen.text.match(LEAK) || [])[0] || null;
      const banner = /Couldn't load|Can't open this screen|Something went wrong/i.test(seen.text);
      const r = { status, len: seen.len, banner, leak, sideways: seen.sideways, skin: seen.skin, errors: errs.slice(0, 3) };
      results[`${name}.${look.key}`] = r;
      if (SHOTS) await page.screenshot({ path: `${DIR}${name}-${look.key}.png`, fullPage: false });
      const ok = status === 200 && seen.len > 40 && !banner && !leak && !(look.mobile && seen.sideways) && seen.skin === look.skin;
      console.log(`${ok ? "✅" : "❌"} ${name.padEnd(12)} ${look.key.padEnd(10)} ${status} · ${seen.len} chars${banner ? " · BANNER" : ""}${leak ? ` · leak "${leak}"` : ""}${seen.sideways ? " · sideways" : ""} · skin ${seen.skin}${errs.length ? " · " + errs[0] : ""}`);
    }
    await ctx.close();
  }
} finally {
  await browser.close();
}
if (OUT) writeFileSync(OUT, JSON.stringify(results, null, 1));
