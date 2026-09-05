// scripts/sweep/t13/r2lib.mjs — shared plumbing for T13's ROUND 2.
//
// Round 2 is planned from a measurement of round 1, not from a fresh idea. Round 1 filed 557
// checks, 334 of them driven against the real app — and almost every one of those walked the
// HAPPY PATH. Measured, by counting how many round-1 rows so much as mention each state:
//
//     the switched-off state (Reports removed by the admin)   1
//     a FAILED read (500 / dropped connection)                2
//     a PARTIAL read (some restaurants did not answer)         3
//     the ADMIN acting as this owner (?rid pin)               1
//     keyboard only, no mouse                                 0
//     a restaurant that is switched OFF (active = false)      0
//     two tabs of the same panel at once                      0
//
// Those are the states a screen enters when something is wrong, and they are where the faults
// this sweep already found actually lived — every one of round 1's five was a wrong ANSWER in an
// unusual state, never a crash on the happy path. So round 2 is those states.
//
// ── HOW THE FAILURES ARE FORCED, AND WHY IT IS SAFE ──────────────────────────────────────────
// By intercepting the network IN THE BROWSER, never by touching the shared database. A 500, a
// dropped connection, a half-written payload and a refusal are all produced by answering the
// page's own request differently. Nothing is written, nothing is switched off for a real
// restaurant, and no other terminal's figures move. It is also the only honest way to see these
// screens: the alternative is flipping a real entitlement and hoping to put it back.
import { chromium } from "playwright";
import { loginAs } from "../login.mjs";

export const BASE = (() => {
  const i = process.argv.indexOf("--base");
  return (i > -1 && process.argv[i + 1] ? process.argv[i + 1] : "http://localhost:4313").replace(/\/$/, "");
})();
export const ESTATE = { username: "diagestate", password: "diag-estate-2026", route: "/owner" };

/** Stable ids: `id(BAND, n)` is always the same check, however the file is edited around it. */
export const idFor = (base) => (n) => `P${base + n}`;

let browser = null;
export async function getBrowser() { return (browser ??= await chromium.launch()); }
export async function closeBrowser() { if (browser) { await browser.close(); browser = null; } }

/**
 * Open the owner panel with a set of network rules applied.
 * `rules` is a list of [urlSubstring, handler]; the handler gets Playwright's Route and the
 * original response body, so a test can corrupt a REAL payload rather than invent a fake shape.
 */
export async function openWith({ creds = null, width = 1440, height = 950, mobile = false,
                                 skin = "dark", path = null, rules = [] } = {}) {
  const b = await getBrowser();
  // ── serviceWorkers: "block", OR NONE OF THIS WORKS ──────────────────────────────────────────
  // The owner panel registers public/sw.js, and its DATA_PATHS include the /api/owner/* family —
  // that is the offline layer, and it is supposed to be there. But a request answered by a service
  // worker never reaches Playwright's network layer, so `page.route()` matches NOTHING and every
  // fault this file injects is silently not injected. The first run of band H looked like eleven
  // product faults; the handler had fired ZERO times. Measured with a counter inside the handler
  // before believing any of it.
  //
  // Blocking the worker is the right trade for THIS band: I am asking what the screen does when the
  // server refuses or fails, and the worker's job is to hide exactly that. The offline behaviour it
  // provides is a different question, tested on its own terms elsewhere.
  const ctx = await b.newContext({
    viewport: { width, height },
    serviceWorkers: "block",
    ...(mobile ? { deviceScaleFactor: 3, isMobile: true, hasTouch: true } : {}),
  });
  const route = await loginAs(ctx, creds ? null : "owner", BASE, creds || undefined);
  await ctx.addCookies([{ name: "aevidine_skin", value: skin, url: BASE }]);
  const pg = await ctx.newPage();
  const errs = [], reqs = [];
  pg.on("console", (m) => { if (m.type() === "error") errs.push(m.text().slice(0, 220)); });
  pg.on("pageerror", (e) => errs.push("pageerror: " + String(e).slice(0, 220)));
  pg.on("response", (r) => { if (r.status() >= 400 && r.url().startsWith(BASE)) errs.push(`HTTP ${r.status()} ${r.url().replace(BASE, "")}`); });
  pg.on("request", (r) => { if (/\/api\/owner\//.test(r.url())) reqs.push(r.url().replace(BASE, "")); });
  for (const [needle, handler] of rules) {
    await pg.route((u) => u.href.includes(needle), (rt) => handler(rt, pg));
  }
  await pg.addInitScript((s) => { try { localStorage.setItem("aevidine_skin", s); } catch {} }, skin);
  await pg.goto(BASE + (path || route), { waitUntil: "networkidle", timeout: 180000 });
  await pg.waitForTimeout(3400);
  return { pg, ctx, errs, reqs, route };
}

/** Answer a request with a deliberate refusal, exactly as the route would. */
export const refuse = (msg) => (rt) => rt.fulfill({
  status: 403, contentType: "application/json",
  body: JSON.stringify({ error: msg, disabled: true }),
});
/** Answer with a server failure. */
export const fail500 = (rt) => rt.fulfill({
  status: 500, contentType: "application/json",
  body: JSON.stringify({ error: "Couldn't load your dashboard just now — please try again." }),
});
/** Drop the connection, the way a phone in a lift does. */
export const drop = (rt) => rt.abort("connectionfailed");
/** Take the REAL answer and change one thing about it — never an invented shape. */
export const patchJson = (fn) => async (rt) => {
  let body;
  try {
    const res = await rt.fetch();
    body = await res.json();
  } catch { return rt.abort("connectionfailed"); }
  rt.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(fn(body)) });
};

/** Move the whole page to a period and wait for it to settle. */
export async function setRange(pg, label) {
  await pg.locator(".owr-btn.main").click();
  await pg.waitForSelector(".owr-pop", { timeout: 15000 });
  await pg.locator(".owr-pop button", { hasText: new RegExp("^" + label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) }).first().click();
  await pg.waitForFunction((l) => (document.querySelector(".owr-btn.main")?.textContent || "").includes(l), label, { timeout: 20000 });
  await pg.waitForTimeout(5000);
}
/** The visible text of the main pane — what a person would actually read. */
export const screenText = (pg) => pg.locator(".adm-main").innerText();
/** Console/network problems the PAGE caused, as opposed to our own sign-in traffic. */
export const pageErrors = (errs) => errs.filter((e) => !/panel-login|favicon|model-viewer|React DevTools/i.test(e));
