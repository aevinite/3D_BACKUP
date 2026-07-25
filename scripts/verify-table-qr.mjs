// Headless verify for the per-table Guest-QR-links card (Manager → Settings → Tables).
// Runs against the REAL running app, logged in as a real per-restaurant manager (NOT admin —
// admin shows the console). Checks #1 (french-house) AND a NON-#1 (pizza-palace), at phone
// (A35 360px) AND desktop widths. Asserts:
//   • the "Guest QR links" card renders one row per table
//   • each link is PERMANENT + table-scoped: …/r/<thisRestaurantSlug>/menu?table=N (N matches the row)
//   • nothing overflows its container (card + each row) on phone or desktop
//   • Copy actually writes the FULL url to the clipboard and the button flips to "✓ Copied"
// Base URL: env VERIFY_BASE (default http://localhost:4000). Point it at the prod alias to
// verify the live build (fast + stable, no dev-compile / iframe-remount races).
// Run: node scripts/verify-table-qr.mjs   |   VERIFY_BASE=https://<prod> node scripts/verify-table-qr.mjs
import { chromium } from "playwright";
import os from "os";
import path from "path";

const BASE = process.env.VERIFY_BASE || "http://localhost:4000";
const DESK = path.join(os.homedir(), "Desktop");
const TARGETS = [
  { role: "#1",     user: "diagm1", pass: "diag-mgr-2026", slug: "french-house" },
  { role: "non-#1", user: "diagm2", pass: "diag-mgr-2026", slug: "pizza-palace" },
];
const results = [];
const fail = (t, m) => { results.push(`❌ [${t}] ${m}`); console.log(`❌ [${t}] ${m}`); };
const ok   = (t, m) => { results.push(`✅ [${t}] ${m}`); console.log(`✅ [${t}] ${m}`); };
const getFrame = (page) => page.frames().find((f) => /\/panels\/editor/.test(f.url()));

// Re-grab the frame EVERY iteration: the panel iframe re-mounts once on boot, and the settings
// list isn't reachable until loadAll() runs. Short timeouts so a stale frame / pre-load state
// just retries fast instead of hanging 15s per attempt.
async function openTablesRows(page) {
  for (let i = 0; i < 45; i++) {
    const frame = getFrame(page);
    if (frame) {
      try {
        await frame.click('[data-tab="general"]', { timeout: 2500 });
        await frame.click('[data-settings-section="tables"]', { timeout: 2500 });
        const n = await frame.locator("[data-copy-link]").count();
        if (n > 0) return { frame, n };
      } catch { /* stale frame / not ready — retry */ }
    }
    await page.waitForTimeout(1000);
  }
  return { frame: getFrame(page), n: 0 };
}

console.log(`VERIFY_BASE = ${BASE}\n`);
const browser = await chromium.launch({ headless: true });

for (const T of TARGETS) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE });
  try {
    const login = await ctx.request.post(`${BASE}/api/panel-login`, { data: { username: T.user, password: T.pass } });
    if (login.status() !== 200) { fail(T.role, `login as ${T.user} → HTTP ${login.status()} (skipping)`); await ctx.close(); continue; }
    ok(T.role, `logged in as ${T.user}`);

    const page = await ctx.newPage();
    await page.goto(`${BASE}/manager`, { waitUntil: "domcontentloaded", timeout: 60000 });

    const { frame, n: rowCount } = await openTablesRows(page);
    if (!frame || rowCount === 0) { fail(T.role, "Guest QR links card never rendered table rows"); await ctx.close(); continue; }
    ok(T.role, `Settings → Tables shows the Guest QR links card (${rowCount} rows)`);

    // Table-scoped, correct-slug, permanent links.
    const info = await frame.evaluate((slug) => {
      const btns = Array.from(document.querySelectorAll("[data-copy-link]"));
      let scoped = true, wrongSlug = false;
      btns.forEach((b, i) => {
        const u = b.getAttribute("data-copy-link") || "";
        if (u !== `${location.origin}/r/${slug}/menu?table=${i + 1}`) scoped = false;
        if (!u.includes(`/r/${slug}/`)) wrongSlug = true;
      });
      return { count: btns.length, first: btns[0]?.getAttribute("data-copy-link") || "", scoped, wrongSlug };
    }, T.slug);
    ok(T.role, `first link: ${info.first}`);
    if (info.wrongSlug) fail(T.role, `a link used the wrong restaurant slug (expected ${T.slug})`);
    else ok(T.role, `all links use THIS restaurant's slug (${T.slug})`);
    if (!info.scoped) fail(T.role, "a link was not scoped to its own table (table N must map to ?table=N)");
    else ok(T.role, "every link is permanent + scoped to its own table (table N → ?table=N), no expiry token");

    // Overflow at desktop then phone.
    for (const [label, w, h] of [["desktop", 1280, 900], ["phone-A35", 360, 780]]) {
      await page.setViewportSize({ width: w, height: h });
      await page.waitForTimeout(300);
      const of = await frame.evaluate(() => {
        const rows = Array.from(document.querySelectorAll("[data-copy-link]")).map((b) => b.closest("div"));
        return {
          bodyOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
          rowOverflow: rows.some((r) => r && r.scrollWidth > r.clientWidth + 2),
        };
      });
      if (of.bodyOverflow) fail(T.role, `${label}: page overflows horizontally (something off-screen)`);
      else ok(T.role, `${label}: no horizontal overflow`);
      if (of.rowOverflow) fail(T.role, `${label}: a table row overflows its card (content off-screen)`);
      else ok(T.role, `${label}: every table row fits inside the card`);
      await page.screenshot({ path: path.join(DESK, `table-qr-${T.slug}-${label}.png`), fullPage: false }).catch(() => {});
    }

    // Copy actually copies.
    await page.setViewportSize({ width: 1280, height: 900 });
    await frame.click("[data-copy-link]");
    await page.waitForTimeout(400);
    const clip = await page.evaluate(() => navigator.clipboard.readText().catch(() => "read-blocked"));
    const btnText = await frame.evaluate(() => document.querySelector("[data-copy-link]")?.textContent || "");
    if (clip === info.first) ok(T.role, `Copy wrote the FULL link to the clipboard`);
    else fail(T.role, `Copy did not put the link on the clipboard (got "${clip}")`);
    if (/Copied/.test(btnText)) ok(T.role, `Copy button confirms "✓ Copied"`);
    else fail(T.role, `Copy button did not flash "Copied" (was "${btnText}")`);

    await ctx.close();
  } catch (e) {
    fail(T.role, `threw: ${e.message}`);
    await ctx.close().catch(() => {});
  }
}
await browser.close();

console.log("\n==================== SUMMARY ====================");
results.forEach((r) => console.log(r));
const failed = results.filter((r) => r.startsWith("❌"));
console.log(failed.length ? `\n${failed.length} CHECK(S) FAILED` : `\nALL CHECKS PASSED ✅  (screenshots on Desktop)`);
process.exit(failed.length ? 1 : 0);
