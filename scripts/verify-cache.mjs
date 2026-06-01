import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://localhost:4000";
const SMALL =
  "/models/croissant_small.glb";
const OPT =
  "/models/croissant-optimized.glb";

const log = (...a) => console.log(...a);

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext();
const page = await ctx.newPage();

const glb = [];
page.on("request", (r) => {
  const u = r.url();
  if (u.endsWith(".glb")) glb.push({ at: Date.now(), url: u });
});

const phase = async (label, fn) => {
  const before = glb.length;
  log(`\n=== ${label} ===`);
  await fn();
  return glb.slice(before).map((r) => r.url.split("/").pop());
};

let verdict = "PASS";
const findings = [];

try {
  const p1 = await phase("Phase 1: load /menu (fresh tab)", async () => {
    await page.goto(`${BASE}/menu`, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await page.waitForFunction(
      ([s, o]) => {
        const l = globalThis.__lfh_modelLoader;
        return l && l.isLoaded(s) && l.isLoaded(o);
      },
      [SMALL, OPT],
      { timeout: 120000 }
    );
  });
  log("  GLB requests during phase 1:", p1);

  log("\n=== Phase 1b: no toast on happy path (no watchlist entry) ===");
  // Toasts are now targeted — they only fire for items the user tried to
  // view but couldn't see in time. On a clean menu load, the watchlist is
  // empty so no toast should appear.
  await page.waitForTimeout(1000);
  const toastCount = await page.locator(".toast-ticket").count();
  log("  toast count:", toastCount);
  if (toastCount !== 0) {
    verdict = "FAIL";
    findings.push(`Expected 0 toasts on happy path, saw ${toastCount}.`);
  }

  if (!p1.includes("croissant_small.glb") || !p1.includes("croissant-optimized.glb")) {
    verdict = "FAIL";
    findings.push(
      "⚠️  Expected both small + optimized GLB fetches on /menu; saw: " + JSON.stringify(p1)
    );
  }

  const p2 = await phase(
    "Phase 2: SPA-click into /item/gourmet-burger",
    async () => {
      await page.click('a[href="/item/gourmet-burger"]');
      await page.waitForURL("**/item/gourmet-burger", { timeout: 10000 });
      await page.waitForSelector("#view-3d-btn", { timeout: 10000 });
    }
  );
  log("  GLB requests during phase 2:", p2);
  if (p2.length !== 0) {
    verdict = "FAIL";
    findings.push("⚠️  Item page re-fetched GLBs (should be 0): " + JSON.stringify(p2));
  }

  const p3 = await phase("Phase 3: click View in 3D → /view/MP", async () => {
    await page.click("#view-3d-btn");
    await page.waitForURL(/\/view\/MP(\?|$)/, { timeout: 10000 });
    await page.waitForSelector("#mv", { timeout: 15000 });
    await page.waitForFunction(
      () => {
        const mv = document.querySelector("#mv");
        return mv && (mv.src || "").startsWith("blob:");
      },
      undefined,
      { timeout: 15000 }
    );
  });
  log("  GLB requests during phase 3:", p3);
  if (p3.length !== 0) {
    verdict = "FAIL";
    findings.push("Viewer re-fetched GLBs (should be 0): " + JSON.stringify(p3));
  }

  log("\n=== Phase 3b: viewer back button points at source item ===");
  const backHref = await page.getAttribute("a.back-btn", "href");
  log("  back href:", backHref);
  if (backHref !== "/item/gourmet-burger") {
    verdict = "FAIL";
    findings.push(
      `Expected back href "/item/gourmet-burger", got "${backHref}"`
    );
  }

  const mvSrc = await page.evaluate(() => document.querySelector("#mv")?.src || "");
  log("  <model-viewer>.src starts with:", mvSrc.slice(0, 12));
  if (!mvSrc.startsWith("blob:")) {
    verdict = "FAIL";
    findings.push("model-viewer.src is not a blob: URL — cache not consumed");
  }

  const upgraded = await page.evaluate(
    ([s, o]) => {
      const mv = document.querySelector("#mv");
      const l = globalThis.__lfh_modelLoader;
      return {
        smallLoaded: l?.isLoaded(s) ?? false,
        optLoaded: l?.isLoaded(o) ?? false,
        srcIsOptBlob: mv?.src === l?.getCachedUrl(o),
        srcIsSmallBlob: mv?.src === l?.getCachedUrl(s),
      };
    },
    [SMALL, OPT]
  );
  log("  upgrade-to-optimized check:", upgraded);
  if (!upgraded.srcIsOptBlob) {
    findings.push(
      `ℹ️  Viewer not upgraded to optimized blob yet (small=${upgraded.srcIsSmallBlob}, opt=${upgraded.srcIsOptBlob}). Acceptable on first paint; should swap after optimized load completes.`
    );
  }
} catch (err) {
  verdict = "FAIL";
  findings.push("⚠️  Driver exception: " + (err?.message || String(err)));
} finally {
  await browser.close();
}

log("\n========================================");
log("Verdict:", verdict);
findings.forEach((f) => log(" -", f));
process.exit(verdict === "PASS" ? 0 : 1);
