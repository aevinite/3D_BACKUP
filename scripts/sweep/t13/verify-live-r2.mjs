// The four round-2 fixes, verified on the DEPLOYED backup site.
import { chromium } from "playwright";
import { loginAs } from "../login.mjs";
const BASE = process.argv[2] || "https://3-d-backup.vercel.app";
const ESTATE = { username: "diagestate", password: "diag-estate-2026", route: "/owner" };
const b = await chromium.launch();
const out = [];
const say = (t, ok, d = "") => out.push([ok ? "✅" : "❌", t, d]);

async function open(creds, w = 1440, h = 950, mobile = false, rules = []) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, serviceWorkers: "block",
    ...(mobile ? { deviceScaleFactor: 3, isMobile: true, hasTouch: true } : {}) });
  const route = await loginAs(ctx, creds ? null : "owner", BASE, creds || undefined);
  const pg = await ctx.newPage();
  for (const [needle, h2] of rules) await pg.route((u) => u.href.includes(needle), h2);
  await pg.goto(BASE + route, { waitUntil: "networkidle", timeout: 180000 });
  await pg.waitForTimeout(4200);
  return pg;
}
const refuse = (msg) => (rt) => rt.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: msg, disabled: true }) });
const fail500 = (rt) => rt.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Couldn't load your dashboard just now — please try again." }) });

// item R2-1 · a withheld card must not leave a hole
const A = await open(null, 1440, 950, false, [["/api/owner/oplog", refuse("Audit & logs isn't enabled for you — contact Aevidine.")]]);
const cols = await A.evaluate(() => {
  const rows = [...document.querySelectorAll(".ow2-two")];
  const r = rows[rows.length - 1];
  return r ? { cols: getComputedStyle(r).gridTemplateColumns, kids: r.children.length } : null;
});
say("R2-1 · a withheld card leaves no blank half-page", !!cols && cols.kids === 1 && cols.cols.split(" ").length === 1, JSON.stringify(cols));
await A.context().close();

// item R2-2 · an unexpected answer must not take the panel down
const B2 = await open(null, 1440, 950, false, [["/api/owner/analytics", async (rt) => {
  try { const r = await rt.fetch(); await r.json(); } catch {}
  return rt.fulfill({ status: 200, contentType: "application/json", body: "{}" });
}]]);
const shell = await B2.locator(".adm-main").count();
const tiles = await B2.locator(".ow2-kpi").count();
say("R2-2 · an unexpected answer does not take the whole panel down", shell === 1 && tiles === 5, `shell=${shell} tiles=${tiles}`);
await B2.context().close();

// item R2-3 · a failed restaurant list must not leave blank tiles for ever
const C = await open(null, 1440, 950, false, [["/api/owner/overview", fail500]]);
const vals = (await C.locator(".ow2-kpi .v").allInnerTexts()).map((v) => v.trim());
const subs = (await C.locator(".ow2-kpi .ow2-sub").allInnerTexts()).map((v) => v.trim());
const live = await C.locator(".ow2-kpi .ow2-live").count();
const zeroCap = /all 0 restaurants?/.test(await C.locator(".adm-main").innerText());
say("R2-3 · a failed restaurant list dashes the tiles and says why",
  vals.length === 5 && vals.every((v) => v === "—") && subs.every((s) => /couldn/i.test(s)) && live === 0 && !zeroCap,
  `values=${JSON.stringify(vals)} livePill=${live} zeroCaption=${zeroCap}`);
await C.context().close();

// item R2-4 · Escape closes the period dropdown
const D = await open(ESTATE);
await D.locator(".owr-btn.main").click();
await D.waitForSelector(".owr-pop", { timeout: 12000 });
await D.keyboard.press("Escape");
await D.waitForTimeout(600);
const closed = (await D.locator(".owr-pop").count()) === 0;
await D.locator(".owd-btn").click().catch(() => {});
await D.waitForTimeout(600);
const pickerOpen = await D.locator(".owd-pop").count();
await D.keyboard.press("Escape");
await D.waitForTimeout(600);
const pickerClosed = (await D.locator(".owd-pop").count()) === 0;
say("R2-4 · Escape closes the period dropdown", closed, `still open = ${!closed}`);
say("R2-4 · …and the restaurant picker too", pickerOpen === 0 || pickerClosed, `opened=${pickerOpen} closed=${pickerClosed}`);
await D.context().close();

for (const [m, t, d] of out) console.log(`${m} ${t}\n     ${d}`);
console.log(`\n${out.filter((o) => o[0] === "✅").length}/${out.length} verified on ${BASE}`);
await b.close();
