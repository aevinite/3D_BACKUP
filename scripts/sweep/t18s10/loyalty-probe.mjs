// scripts/sweep/t18s10/loyalty-probe.mjs — does the Access screen's Loyalty switch SHOW what it saved?
//
//   node scripts/sweep/t18s10/loyalty-probe.mjs [--shot <png>]
//
// Opens /aevinite/access for French House (the restaurant sweeps write to), taps "Loyalty points"
// once, then reads two things: what the switch SAYS (aria-checked) and what the database HOLDS
// (settings.modules.loyalty). They must agree. French House's original `modules` value is read first
// and written back in a finally and on SIGINT/SIGTERM. Aangan is never touched.
// Headless Playwright rather than the DevTools browser for one reason: the admin cookie is derived
// from the admin password inside this script, so the secret never passes through a chat transcript.
import { chromium } from "playwright";
import { sb, BASE, restaurantBySlug } from "./env.mjs";
import { adminCookie } from "../login.mjs";

const shot = process.argv.includes("--shot") ? process.argv[process.argv.indexOf("--shot") + 1] : null;
const fh = await restaurantBySlug("french-house");
const before = await sb.from("settings").select("modules").eq("restaurant_id", fh.id).maybeSingle();
if (before.error) throw new Error("could not read French House settings — nothing touched");
const original = before.data?.modules ?? null;
let restored = false;
const restore = async () => {
  if (restored) return; restored = true;
  const w = await sb.from("settings").update({ modules: original }).eq("restaurant_id", fh.id);
  console.log(w.error ? `RESTORE FAILED: ${w.error.message}` : `restored modules → ${JSON.stringify(original?.loyalty ?? null)} for loyalty`);
};
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, async () => { await restore(); process.exit(1); });

const browser = await chromium.launch();
const out = {};
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addCookies([adminCookie(BASE)]);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/aevinite/access?rid=${fh.id}&focus=loyalty`, { waitUntil: "networkidle", timeout: 120000 });
  const row = page.locator('[data-node="loyalty"]').first();
  await row.waitFor({ timeout: 60000 });
  const sw = row.locator('[role="switch"]').first();
  out.before = { screen: await sw.getAttribute("aria-checked"), db: original?.loyalty ?? null };
  await sw.click();
  await page.waitForTimeout(3000);           // the save round-trip; the screen does NOT reload after a success
  const after = await sb.from("settings").select("modules").eq("restaurant_id", fh.id).maybeSingle();
  out.after = { screen: await sw.getAttribute("aria-checked"), db: after.data?.modules?.loyalty ?? null };
  if (shot) await row.screenshot({ path: shot });
  await page.reload({ waitUntil: "networkidle" });
  await page.locator('[data-node="loyalty"] [role="switch"]').first().waitFor();
  out.afterReload = { screen: await page.locator('[data-node="loyalty"] [role="switch"]').first().getAttribute("aria-checked") };
  out.agrees = String(out.after.db?.allowed === true) === out.after.screen;
} finally {
  await browser.close();
  await restore();
}
console.log(JSON.stringify(out));
