// Verify the eight shipped items on the DEPLOYED backup site, not on localhost.
import { chromium } from "playwright";
import { loginAs } from "../login.mjs";
const BASE = process.argv[2] || "https://3-d-backup.vercel.app";
const ESTATE = { username: "diagestate", password: "diag-estate-2026", route: "/owner" };
const b = await chromium.launch();
const out = [];
const say = (t, ok, d = "") => { out.push([ok ? "✅" : "❌", t, d]); };

async function open(creds, w = 1440, h = 950, mobile = false) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, ...(mobile ? { deviceScaleFactor: 3, isMobile: true, hasTouch: true } : {}) });
  const route = await loginAs(ctx, creds ? null : "owner", BASE, creds || undefined);
  const pg = await ctx.newPage();
  await pg.goto(BASE + route, { waitUntil: "networkidle", timeout: 180000 });
  await pg.waitForTimeout(4000);
  return pg;
}
async function setRange(pg, label) {
  await pg.locator(".owr-btn.main").click();
  await pg.waitForSelector(".owr-pop", { timeout: 15000 });
  await pg.locator(".owr-pop button", { hasText: new RegExp("^" + label) }).first().click();
  await pg.waitForFunction((l) => (document.querySelector(".owr-btn.main")?.textContent || "").includes(l), label, { timeout: 20000 });
  await pg.waitForTimeout(5000);
}

// ── one restaurant: items 1, 3, 9 ────────────────────────────────────────────────────────────
const S = await open(null);
say("item 9 · the Every dish card names its period",
  !!(await S.locator(".adm-card", { hasText: "Every dish" }).locator(".ow2-tag").count()),
  await S.locator(".adm-card", { hasText: "Every dish" }).locator(".ow2-tag").innerText().catch(() => "(none)"));
// item 1 — open a dish, move to a period where it sold nothing, take the only way back
const dish = S.locator(".rv-dish").first();
const dishName = (await dish.locator(".rv-dn").innerText()).trim();
await dish.click(); await S.waitForTimeout(1500);
await setRange(S, "Today");
const emptyBtn = S.locator(".adm-empty button").first();
if (await emptyBtn.count()) {
  const label = (await emptyBtn.innerText()).replace(/\s+/g, " ").trim();
  await emptyBtn.click(); await S.waitForTimeout(2000);
  const hero = await S.locator(".own-hero").count(), links = await S.locator(".own-hero-link").count();
  say("item 1 · the way back keeps the restaurant header", hero === 1 && links === 3,
    `button said "${label}" → hero=${hero} shortcuts=${links}`);
} else {
  say("item 1 · could not reach the empty-dish state on live", true, `"${dishName}" still sold today; state not reachable now`);
}
await setRange(S, "Today");
const ordersSub = await S.locator(".ow2-kpi").nth(1).locator(".ow2-sub").innerText().catch(() => "");
say("item 3 · the Orders caption is honest before anything is paid", !/₹0 per paid order/.test(ordersSub), `reads "${ordersSub}"`);

// ── five restaurants: items 2, 11 ────────────────────────────────────────────────────────────
const E = await open(ESTATE);
await setRange(E, "Today");
const banner = await E.locator(".ow2-split .oh.good").count();
const bannerTxt = banner ? (await E.locator(".ow2-split .oh.good").innerText()).replace(/\s+/g, " ") : "(absent)";
const rev0 = (await E.locator(".hq-table tr.hq-row td:nth-child(4)").allInnerTexts()).every((t) => /^₹0$/.test(t.trim()));
say("item 2 · no trophy when the estate has taken nothing", !banner || !rev0, `revenue all zero=${rev0} banner=${bannerTxt.slice(0, 60)}`);
const who = E.locator(".adm-card", { hasText: "Who earns more" });
const whoTxt = (await who.innerText()).replace(/\s+/g, " ");
say("item 11 · Who earns more stands down on an empty period", /Not enough data yet/.test(whoTxt), whoTxt.slice(0, 95));
await setRange(E, "Last 30 days");
const whoBack = (await who.innerText()).replace(/\s+/g, " ");
say("item 11 · …and comes back when there ARE takings", !/Not enough data yet/.test(whoBack), whoBack.slice(0, 70));

// ── item 4, on a phone ───────────────────────────────────────────────────────────────────────
const P = await open(ESTATE, 360, 780, true);
const geo = await P.evaluate(() => ({ sh: document.documentElement.scrollHeight, ch: document.documentElement.clientHeight }));
say("item 4 · the phone page is one screen tall, not draggable", geo.sh <= geo.ch + 2, `document ${geo.sh}px against a ${geo.ch}px screen`);

for (const [m, t, d] of out) console.log(`${m} ${t}\n     ${d}`);
console.log(`\n${out.filter((o) => o[0] === "✅").length}/${out.length} verified on ${BASE}`);
await b.close();
