// Simulates a slow network: blocks Supabase GLB requests, navigates straight
// to /view/MP, waits for the "Still preparing" overlay, then unblocks the
// requests and confirms the targeted toast appears with a clickable link
// back to the viewer.

import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://localhost:4000";

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext();
const page = await ctx.newPage();

let verdict = "PASS";
const findings = [];
const log = (...a) => console.log(...a);

// Simulate a slow network: every GLB request hangs for ~10 seconds before
// being served. The viewer's 6-second try-again timer fires while the
// fetch is still in flight, so the user sees the overlay before the model
// arrives. After the delay, the GLB finishes loading and the targeted
// toast fires.
const start = Date.now();
await ctx.route("**/*.glb", async (route) => {
  if (Date.now() - start < 11000) {
    await new Promise((r) => setTimeout(r, 10000));
  }
  return route.continue();
});

try {
  log("=== Phase A: navigate to /view/MP with GLBs blocked ===");
  await page.goto(`${BASE}/view/MP?from=gourmet-burger`, {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });
  log("  waiting up to 10s for try-again overlay...");
  try {
    await page.waitForSelector("#try-again-overlay", { timeout: 10000 });
  } catch (err) {
    const html = await page.content();
    const hasOverlay = html.includes("try-again-overlay");
    const hasLoader = html.includes('id="load"');
    log(`  DEBUG: html length=${html.length}, hasOverlay=${hasOverlay}, hasLoader=${hasLoader}`);
    await page.screenshot({ path: "scripts/_debug-try-again.png" });
    throw err;
  }
  log("  try-again overlay visible.");

  const backHref = await page.getAttribute("#try-again-overlay a", "href");
  log("  try-again back href:", backHref);
  if (backHref !== "/item/gourmet-burger") {
    verdict = "FAIL";
    findings.push(`Try-again back href wrong: ${backHref}`);
  }

  const watching = await page.evaluate(() => {
    return globalThis.__lfh_modelWatchlist?.has("MP") ?? false;
  });
  log("  watchlist has MP:", watching);
  if (!watching) {
    verdict = "FAIL";
    findings.push("Watchlist did not record MP.");
  }

  log("\n=== Phase B: wait for slow fetch to complete and toast to appear ===");
  log("  waiting up to 20s for clickable targeted toast...");
  await page.waitForSelector(".toast-ticket.toast-tappable", {
    timeout: 20000,
  });
  const text = await page
    .locator(".toast-ticket.toast-tappable")
    .first()
    .innerText();
  log("  toast text:", JSON.stringify(text));
  if (!/ready to view|in 3D/i.test(text)) {
    verdict = "FAIL";
    findings.push(`Toast text unexpected: ${text}`);
  }

  log("\n=== Phase C: clicking the toast navigates to /view/MP ===");
  await page.click(".toast-ticket.toast-tappable");
  await page.waitForURL(/\/view\/MP/, { timeout: 5000 });
  log("  navigated to:", page.url());
} catch (e) {
  verdict = "FAIL";
  findings.push("Driver exception: " + (e?.message || String(e)));
} finally {
  await browser.close();
}

log("\n========================================");
log("Verdict:", verdict);
findings.forEach((f) => log(" -", f));
process.exit(verdict === "PASS" ? 0 : 1);
