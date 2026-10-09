// scripts/sweep/t18s10/shots.mjs — the screens terminal 18 READS BY EYE (nothing is asserted here;
// the ledger rows record what a person looking at each picture saw).
//   T18_BASE=http://localhost:4418 node scripts/sweep/t18s10/shots.mjs <outdir>
// Read-only: it opens screens and folds rows open; it never taps a switch.
import { chromium } from "playwright";
import { BASE, restaurantBySlug, sb } from "./env.mjs";
import { adminCookie, loginAs } from "../login.mjs";

const out = process.argv[2];
const fh = await restaurantBySlug("french-house");
const t1 = (await sb.from("staff_users").select("id").eq("username", "diagt1").maybeSingle()).data.id;
const b = await chromium.launch();
const VIEWS = { desktop: { viewport: { width: 1280, height: 900 } }, a35: { viewport: { width: 360, height: 780 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }, ipad: { viewport: { width: 1194, height: 834 }, deviceScaleFactor: 2, hasTouch: true } };
try {
  for (const [name, opts] of Object.entries(VIEWS)) {
    const ctx = await b.newContext(opts); await ctx.addCookies([adminCookie(BASE)]);
    const p = await ctx.newPage();
    await p.goto(`${BASE}/aevinite/access?rid=${fh.id}&focus=mgr_may`, { waitUntil: "networkidle", timeout: 120000 });
    await p.locator('[data-node="mgr_may"]').first().waitFor({ timeout: 60000 });
    await p.waitForTimeout(1200);
    await p.screenshot({ path: `${out}/access-manager-${name}.png` });
    await p.goto(`${BASE}/aevinite/access?rid=${fh.id}&focus=loyalty`, { waitUntil: "networkidle", timeout: 120000 });
    await p.locator('[data-node="loyalty"]').first().waitFor({ timeout: 60000 }); await p.waitForTimeout(1000);
    await p.screenshot({ path: `${out}/access-extra-${name}.png` });
    await ctx.close();
  }
  // the light skin, desktop
  const lctx = await b.newContext(VIEWS.desktop); await lctx.addCookies([adminCookie(BASE)]);
  const lp = await lctx.newPage();
  await lp.goto(`${BASE}/aevinite/access?rid=${fh.id}`, { waitUntil: "networkidle", timeout: 120000 });
  await lp.evaluate(() => { try { localStorage.setItem("lfh_admin_theme", "light"); localStorage.setItem("aevidine_skin", "light"); } catch {} });
  await lp.goto(`${BASE}/aevinite/access?rid=${fh.id}&focus=mgr_may`, { waitUntil: "networkidle", timeout: 120000 });
  await lp.locator('[data-node="mgr_may"]').first().waitFor({ timeout: 60000 }); await lp.waitForTimeout(1200);
  await lp.screenshot({ path: `${out}/access-manager-light.png` });
  await lctx.close();
  // the owner's own copy of a waiter's profile, desktop + phone — ONE sign-in, its session reused
  // for the second viewport (verify:test-safety: no login inside a loop).
  const first = await b.newContext(VIEWS.desktop); await loginAs(first, "owner", BASE);
  const ownerState = await first.storageState(); await first.close();
  for (const [name, opts] of [["desktop", VIEWS.desktop], ["a35", VIEWS.a35]]) {
    const octx = await b.newContext({ ...opts, storageState: ownerState });
    const op = await octx.newPage();
    await op.goto(`${BASE}/owner/staff/${t1}`, { waitUntil: "networkidle", timeout: 120000 }); await op.waitForTimeout(2500);
    const perm = op.getByText(/Permissions — what/).first();
    if (await perm.count()) { await perm.click(); await op.waitForTimeout(1200); }
    await op.screenshot({ path: `${out}/owner-waiter-profile-${name}.png`, fullPage: name === "desktop" });
    await octx.close();
  }
} finally { await b.close(); }
console.log("shots written to", out);
