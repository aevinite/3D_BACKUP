import { chromium } from "playwright";

// Accept a target the same way every other guard here does. Requiring port 4000 meant this
// could only run when the human's dev server happened to be up — so in practice it was skipped,
// and a parallel session or CI could never run it at all. (2026-08-04 sweep.)
const BASE = (() => {
  const i = process.argv.indexOf("--base");
  return (i > -1 && process.argv[i + 1]) || process.env.VERIFY_BASE || process.env.BASE_URL
    || process.env.BASE || "http://localhost:4000";
})().replace(/\/$/, "");
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
    // The menu preloads ONLY the small (~2MB) tier — the heavy optimized model is preloaded on
    // the dish page instead (MenuView: "preload only the SMALL models", 2026-06-25), so the menu
    // never pulls ~9MB in the background. This script used to wait for BOTH here and therefore
    // timed out for over a month, which meant the no-re-fetch guard it exists to provide was not
    // running at all. Wait for what the menu actually loads. (2026-07-30)
    await page.waitForFunction(
      (s) => {
        const l = globalThis.__lfh_modelLoader;
        return l && l.isLoaded(s);
      },
      SMALL,
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

  if (!p1.includes("croissant_small.glb")) {
    verdict = "FAIL";
    findings.push("⚠️  Expected the small GLB to preload on /menu; saw: " + JSON.stringify(p1));
  }
  if (p1.includes("croissant-optimized.glb")) {
    verdict = "FAIL";
    findings.push("⚠️  The menu pulled the HEAVY optimized model — it must not (that is ~9MB on a phone): " + JSON.stringify(p1));
  }

  // The dish whose 3D model is the croissant, found from the page rather than hardcoded: dish
  // URLs became restaurant-scoped (/r/<slug>/item/<dish>, 2026-06-25) and the old
  // dishHref link no longer exists, so this click had been timing out. Pick the
  // link for the dish that actually carries the model this script tracks. (2026-07-30)
  const dishHref = await page.evaluate(() => {
    const a = [...document.querySelectorAll('a[href*="/item/"]')]
      .find((x) => /avocado-and-cream-cheese/.test(x.getAttribute("href") || ""));
    return a ? a.getAttribute("href") : null;
  });
  if (!dishHref) throw new Error("could not find the 3D dish's link on /menu");
  const p2 = await phase(
    `Phase 2: SPA-click into ${dishHref}`,
    async () => {
      await page.click(`a[href="${dishHref}"]`);
      await page.waitForURL("**/item/avocado-and-cream-cheese**", { timeout: 15000 });
      await page.waitForSelector("#view-3d-btn", { timeout: 15000 });
    }
  );
  log("  GLB requests during phase 2:", p2);
  // The dish page is where the heavy tier is SUPPOSED to be fetched (so the 3D view opens
  // instantly). What must never happen is re-fetching something already held — so the small
  // model must not appear here again.
  if (p2.some((u) => u.includes("_small.glb"))) {
    verdict = "FAIL";
    findings.push("⚠️  Item page RE-FETCHED a small GLB already in memory: " + JSON.stringify(p2));
  }

  // The viewer folder is the dish's model_folder ("Croissant"); it used to be "MP". (2026-07-30)
  const p3 = await phase("Phase 3: click View in 3D → /view/Croissant", async () => {
    await page.click("#view-3d-btn");
    await page.waitForURL(/\/view\/Croissant(\?|$)/, { timeout: 10000 });
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
  if (backHref !== dishHref) {
    verdict = "FAIL";
    findings.push(
      `Expected back href "${dishHref}", got "${backHref}"`
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
