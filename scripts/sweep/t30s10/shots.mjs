// scripts/sweep/t30s10/shots.mjs — sweep #10 · terminal 30 · the screens the money libraries draw.
//   node scripts/sweep/t30s10/shots.mjs --base http://localhost:4430 [--out <dir>]
// Reuses the ONE sign-in per role (scripts/sweep/login.mjs caches it); the admin uses the
// adminCookie, which is no sign-in at all. Each shot is asserted by machine (no leaked code text, no
// sideways scroll, the money figures present) and the PNGs are written for a person to READ.
import { chromium } from "playwright";
import { loginAs, adminCookie } from "../login.mjs";
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const BASE = arg("--base", "http://localhost:4430");
const OUT = arg("--out", ".claude/sweep/shots/S10-T30");
const VP = {
  desktop: { viewport: { width: 1280, height: 800 } },
  a35: { viewport: { width: 360, height: 780 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  ipad: { viewport: { width: 1194, height: 834 }, hasTouch: true },
};
const browser = await chromium.launch();
const results = [];
async function shoot(role, path, vpName, skin, name, mustSee) {
  const ctx = await browser.newContext(VP[vpName]);
  if (role === "admin") await ctx.addCookies([adminCookie(BASE)]); else if (role !== "guest") await loginAs(ctx, role, BASE);
  if (skin) await ctx.addCookies([{ name: "aevidine_skin", value: skin, url: BASE }]);
  const page = await ctx.newPage();
  const errs = []; page.on("pageerror", (e) => errs.push(String(e.message).slice(0, 120)));
  await page.goto(BASE + path, { waitUntil: "networkidle", timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(2500);
  // The manager panel draws inside an iframe, so read every frame, not only the top document.
  let frameText = "";
  for (const f of page.frames()) { try { frameText += await f.evaluate(() => document.body ? document.body.innerText : ""); } catch { /* cross-origin or gone */ } }
  const info = await page.evaluate(() => {
    const txt = document.body.innerText || "";
    const leaks = (txt.match(/\bNaN\b|\bundefined\b|\[object Object\]|\bInfinity\b|\$\{/g) || []);
    const doc = document.scrollingElement || document.documentElement;
    return { leaks, sideways: doc.scrollWidth - doc.clientWidth, len: txt.length, rupee: (txt.match(/₹/g) || []).length, text: txt.slice(0, 4000) };
  });
  const file = `${OUT}/${name}-${vpName}${skin ? "-" + skin : ""}.png`;
  await page.screenshot({ path: file });
  info.len = Math.max(info.len, frameText.length);
  info.leaks = info.leaks.concat(frameText.match(/\bNaN\b|\bundefined\b|\[object Object\]|\bInfinity\b|\$\{/g) || []);
  const seen = mustSee ? mustSee.test(info.text + frameText) : true;
  results.push({ name: `${name} · ${vpName}${skin ? " · " + skin : ""}`, ok: !info.leaks.length && info.sideways <= 1 && info.len > 50 && seen && !errs.length, note: `leaks ${info.leaks.length}, sideways ${info.sideways}px, ₹×${info.rupee}, page errors ${errs.length}${errs.length ? " (" + errs[0] + ")" : ""}${seen ? "" : ", expected text missing"}`, file });
  await ctx.close();
}
for (const vp of ["desktop", "a35", "ipad"]) for (const skin of ["light", "dark"]) {
  await shoot("owner", "/owner/reports?open=tax", vp, skin, "owner-tax-report", /GST|Tax/i);
  await shoot("owner", "/owner", vp, skin, "owner-dashboard", /₹/);
}
for (const vp of ["desktop", "a35", "ipad"]) await shoot("admin", "/aevinite/billing", vp, null, "admin-billing", /plan|billing/i);
for (const vp of ["desktop", "a35"]) await shoot("manager", "/manager", vp, null, "manager-floor", null);
// round 3 (items 15–18, 24–27): the screens those changes feed — the manager floor reads FLOOR_COLS now
// (item 17), the owner screens answer a failed read honestly (item 15), the tablet undoes a split first.
for (const vp of ["desktop", "a35"]) {
  await shoot("owner", "/owner/settings", vp, null, "r3-owner-settings", /password|setting/i);
  await shoot("owner", "/owner/staff", vp, null, "r3-owner-staff", /staff|team|people/i);
  await shoot("owner", "/owner/inventory", vp, null, "r3-owner-inventory", /stock|inventory|item/i);
  await shoot("owner", "/owner/reports?open=inventory", vp, null, "r3-owner-reports-inventory", /report/i);
}
for (const vp of ["ipad", "a35"]) await shoot("tablet", "/tablet", vp, null, "r3-tablet-floor", null);
await shoot("admin", "/aevinite/restaurants", "desktop", null, "r3-admin-restaurants", /restaurant/i);
// round 4 (items 10, 16, 28): the dish page's reviews now come through lfh_dish_reviews; the panels and
// the admin's GST example round by the one exact rule.
for (const vp of ["desktop", "a35"]) for (const [rest, slug] of [["french-house", "truffle-and-wild-mushroom-pizza"], ["aevidine", "ranch-pickled-veggies"]])
  await shoot("guest", `/r/${rest}/item/${slug}`, vp, null, `r4-dish-reviews-${rest}`, /review/i);
await shoot("admin", "/aevinite/access?rid=00000000-0000-0000-0000-000000000001", "desktop", null, "r4-admin-access", /access|permission|billing/i);
for (const vp of ["ipad", "a35"]) await shoot("tablet", "/tablet", vp, null, "r4-tablet-floor", null);
for (const vp of ["desktop", "a35"]) await shoot("manager", "/manager", vp, null, "r4-manager-floor", null);
// (A busy-table block — one real order placed, photographed and cancelled — was REMOVED: the owner
// rejected that step on 2026-10-09. Item 17's column list is checked by verify-t24-money-rules --db.)
await browser.close();
for (const r of results) console.log(`${r.ok ? "✅" : "❌"} ${r.name} → ${r.note} · ${r.file}`);
process.stdout.write("", () => process.exit(results.some((r) => !r.ok) ? 1 : 0));
