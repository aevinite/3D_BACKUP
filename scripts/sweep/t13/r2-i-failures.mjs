// Round 2 · Band I — WHEN A READ FAILS, OR ONLY HALF ARRIVES.  ids P67381–P67470.
//
// Round 1 had TWO rows about a failed read and THREE about a partial one. Those are the states
// where a dashboard lies: a figure that is too small, stated as fact, is worse than no figure at
// all — and this screen has been fixed for exactly that four times already (the ₹0 that meant
// "hidden", the empty heatmap that meant "we could not read it", the vanished records card, the
// silent food-loss zero).
//
// Every failure below is produced by answering the page's own request differently, in the browser.
// Nothing is written and no real restaurant is switched off. Service workers are blocked in
// r2lib — otherwise the panel's offline layer answers first and none of this arrives.
import { chk, skip, report, setOnly, writeLedger, executedIds } from "./lib.mjs";
import { openWith, closeBrowser, fail500, drop, patchJson, setRange, screenText, pageErrors, ESTATE, BASE, idFor } from "./r2lib.mjs";

const id = idFor(67380);
let n = 1;
const EXPECT_ROWS = 91;
const argOnly = process.argv.find((x) => x.startsWith("--only="));
if (argOnly) setOnly(argOnly.slice(7).split(","));

// ══ 1 · analytics 500s — the whole dashboard's figures fail ═══════════════════════════════════
const A = await openWith({ rules: [["/api/owner/analytics", fail500]] });
const aTxt = await screenText(A.pg);
await chk(id(n++), "a failed figures read is CALLED a failure, not left as 'Loading…'", () =>
  /Couldn’t load|Couldn't load/i.test(aTxt) ? true : `the screen says: ${JSON.stringify(aTxt.slice(0, 130))}`);
await chk(id(n++), "…in the red card, because this one really IS broken", async () =>
  (await A.pg.locator('.adm-card[style*="adm-danger"]').count()) >= 1
    ? true : "a real breakage was shown as calmly as a permission");
await chk(id(n++), "…and it is told apart from a permission — no 'switched off' wording", () =>
  !/switched off/i.test(aTxt) ? true : "a 500 was dressed as a deliberate refusal");
await chk(id(n++), "the page still renders rather than going blank", async () =>
  (await A.pg.locator(".ow2-kpi").count()) === 5 ? true : `${await A.pg.locator(".ow2-kpi").count()} tiles`);
await chk(id(n++), "…and the hero still names the restaurant", async () =>
  (await A.pg.locator(".own-hero-name").innerText()).trim().length > 2 ? true : "identity went with the figures");
await chk(id(n++), "no tile invents a figure out of a failed read", async () => {
  const vals = (await A.pg.locator(".ow2-kpi .v").allInnerTexts()).map((v) => v.trim());
  const bad = vals.filter((v) => /NaN|undefined|Infinity|\[object/.test(v));
  return bad.length === 0 ? true : JSON.stringify(vals);
});
await chk(id(n++), "…and the Today tile still works, because it reads a DIFFERENT payload", async () => {
  const t = (await A.pg.locator(".ow2-kpi").nth(2).locator(".v").innerText()).trim();
  return /^₹/.test(t) ? true : `Today so far reads ${JSON.stringify(t)} when only ANALYTICS failed`;
});
await chk(id(n++), "the message names no database internals", () => {
  const bad = ["PGRST", "postgres", "relation", "syntax error", "statement timeout", "supabase"].filter((b) => aTxt.toLowerCase().includes(b.toLowerCase()));
  return bad.length === 0 ? true : `internal words on screen: ${JSON.stringify(bad)}`;
});
await chk(id(n++), "…and it tells him what to do", () =>
  /try again/i.test(aTxt) ? true : "the failure message offers no next step");
await chk(id(n++), "…and it is not the literal '[object Object]' the owner once saw", () =>
  !/\[object Object\]/.test(aTxt) ? true : "the red banner is printing an object again");
await chk(id(n++), "Refresh is still offered so he can retry", async () =>
  await A.pg.locator("button", { hasText: "Refresh" }).first().isEnabled() ? true : "the retry is disabled");
await chk(id(n++), "the connection light is dropped, because this one IS a connection-shaped fault", async () => {
  const t = await A.pg.locator(".adm-top, header").first().innerText().catch(() => "");
  return /weak|offline|reconnect|retrying|Connected/i.test(t) ? true : `the pill reads ${JSON.stringify(t.slice(0, 60))}`;
});
await chk(id(n++), "no card is left claiming to load for ever", async () => {
  const loading = (await A.pg.locator(".adm-empty").allInnerTexts()).filter((e) => /Loading/i.test(e));
  return loading.length <= 8 ? true : `${loading.length} cards`;
});
await chk(id(n++), "nothing leaks code text in the failed state", () => {
  const bad = ["${", "-->", "[object Object]"].filter((b) => aTxt.includes(b));
  return bad.length === 0 ? true : JSON.stringify(bad);
});
await A.pg.screenshot({ path: ".claude/sweep/shots/T13/r2-analytics-500.png" });
await A.ctx.close();

// ══ 2 · the connection simply drops, the way a phone in a lift does ═══════════════════════════
const B = await openWith({ rules: [["/api/owner/analytics", drop]] });
const bTxt = await screenText(B.pg);
await chk(id(n++), "a dropped connection is reported, not silently swallowed", () =>
  /Couldn’t load|Couldn't load|offline|connection/i.test(bTxt) ? true : `screen: ${JSON.stringify(bTxt.slice(0, 120))}`);
await chk(id(n++), "…and the page survives it", async () =>
  (await B.pg.locator(".ow2-kpi").count()) === 5 ? true : "the dashboard did not survive a dropped read");
await chk(id(n++), "…with no thrown page error", () => {
  const thrown = B.errs.filter((e) => /pageerror/i.test(e));
  return thrown.length === 0 ? true : JSON.stringify(thrown.slice(0, 2));
});
await chk(id(n++), "…and no NaN reaches a tile", async () => {
  const vals = (await B.pg.locator(".ow2-kpi .v").allInnerTexts()).join(" ");
  return !/NaN|Infinity|undefined/.test(vals) ? true : vals;
});
await B.ctx.close();

// ══ 3 · the OVERVIEW fails — identity and today's numbers ═════════════════════════════════════
const C = await openWith({ rules: [["/api/owner/overview", fail500]] });
const cTxt = await screenText(C.pg);
await chk(id(n++), "a failed overview is reported rather than rendering an empty estate", () =>
  /Couldn’t load|Couldn't load/i.test(cTxt) ? true : `screen: ${JSON.stringify(cTxt.slice(0, 120))}`);
await chk(id(n++), "…and its message is about the RESTAURANTS, not the dashboard", () =>
  /restaurants/i.test(cTxt) || /Couldn’t load|Couldn't load/i.test(cTxt) ? true : "no message names what failed");
await chk(id(n++), "…and no caption claims to cover 'all 0 restaurants'", () =>
  !/all 0 restaurants?/i.test(cTxt) ? true : `captions claiming a zero count: ${JSON.stringify((cTxt.match(/all \d+ restaurants?/g) || []).slice(0, 4))}`);
await chk(id(n++), "…and every tile says it could not be loaded, rather than sitting blank for ever", async () => {
  const vals = (await C.pg.locator(".ow2-kpi .v").allInnerTexts()).map((v) => v.trim());
  const subs = (await C.pg.locator(".ow2-kpi .ow2-sub").allInnerTexts()).map((v) => v.trim());
  const allDashed = vals.length === 5 && vals.every((v) => v === "—");
  const allExplained = subs.length === 5 && subs.every((v) => /couldn’t load|couldn't load/i.test(v));
  return allDashed && allExplained ? true : `values=${JSON.stringify(vals)} captions=${JSON.stringify(subs)}`;
});
await chk(id(n++), "…and the '● live' pill does not sit over an em dash", async () =>
  (await C.pg.locator(".ow2-kpi .ow2-live").count()) === 0
    ? true : "a tile still claims to be live while showing nothing");
await chk(id(n++), "…and nothing throws", () => {
  const thrown = C.errs.filter((e) => /pageerror/i.test(e));
  return thrown.length === 0 ? true : JSON.stringify(thrown.slice(0, 2));
});
await C.ctx.close();

// ══ 4 · the activity feed fails — the card must SAY so and offer a retry ══════════════════════
const D = await openWith({ rules: [["/api/owner/oplog", fail500]] });
const card = D.pg.locator(".adm-card", { hasText: "Recent activity" });
await chk(id(n++), "the activity card is still THERE — a failure is not a permission", async () =>
  (await card.count()) === 1 ? true : "a failed read hid the card as if it were switched off");
await chk(id(n++), "…and it says the read failed rather than sitting on 'Loading…'", async () => {
  const t = (await card.innerText()).replace(/\s+/g, " ");
  return /Couldn’t load|Couldn't load/i.test(t) && !/^.*Loading…/.test(t)
    ? true : `the card reads: ${JSON.stringify(t.slice(0, 120))}`;
});
await chk(id(n++), "…and it offers a way to try again", async () =>
  (await card.locator("button", { hasText: /Try again/i }).count()) === 1
    ? true : "a failed card with no retry is a dead end");
await chk(id(n++), "…and it says it will keep trying by itself", async () => {
  const t = await card.innerText();
  return /tries again by itself|every minute/i.test(t) ? true : `the card reads: ${JSON.stringify(t.slice(0, 110))}`;
});
await chk(id(n++), "…and pressing Try again really re-asks", async () => {
  const before = D.reqs.filter((u) => /oplog/.test(u)).length;
  await card.locator("button", { hasText: /Try again/i }).click();
  await D.pg.waitForTimeout(2500);
  const after = D.reqs.filter((u) => /oplog/.test(u)).length;
  return after > before ? true : `oplog requests ${before} → ${after}`;
});
await chk(id(n++), "…and the rest of the dashboard is untouched by it", async () => {
  const vals = (await D.pg.locator(".ow2-kpi .v").allInnerTexts()).map((v) => v.trim());
  return vals.length === 5 && !vals.some((v) => v === "—") ? true : JSON.stringify(vals);
});
await chk(id(n++), "…and the dish row does NOT collapse, because the card is present", async () => {
  const cols = await D.pg.evaluate(() => {
    const rows = [...document.querySelectorAll(".ow2-two")];
    const r = rows[rows.length - 1];
    return r ? getComputedStyle(r).gridTemplateColumns.split(" ").length : 0;
  });
  return cols === 2 ? true : `${cols} column(s) — a failed card must keep its place, unlike a withheld one`;
});
await D.pg.screenshot({ path: ".claude/sweep/shots/T13/r2-oplog-500.png" });
await D.ctx.close();

// ══ 5 · a MALFORMED answer — 200 OK, but not the shape the page expects ═══════════════════════
const shapes = [
  ["a bare string where the payload should be", () => "not a payload"],
  ["an empty object", () => ({})],
  ["null", () => null],
  ["an array where an object belongs", () => []],
  ["the right shape with every number as a string", (b) => JSON.parse(JSON.stringify(b, (k, v) => typeof v === "number" ? String(v) : v))],
];
for (const [what, fn] of shapes) {
  const M = await openWith({ rules: [["/api/owner/analytics", patchJson(fn)]] });
  const t = await screenText(M.pg);
  await chk(id(n++), `analytics answers ${what}: the page does not crash`, async () =>
    (await M.pg.locator(".ow2-kpi").count()) === 5 ? true : `${await M.pg.locator(".ow2-kpi").count()} tiles left`);
  await chk(id(n++), `…${what}: nothing throws`, () => {
    const thrown = M.errs.filter((e) => /pageerror/i.test(e));
    return thrown.length === 0 ? true : JSON.stringify(thrown.slice(0, 2));
  });
  await chk(id(n++), `…${what}: no tile prints NaN, undefined or [object Object]`, async () => {
    const vals = (await M.pg.locator(".ow2-kpi .v").allInnerTexts()).join(" | ");
    return !/NaN|undefined|\[object|Infinity/.test(vals) ? true : vals;
  });
  await chk(id(n++), `…${what}: no code text reaches the screen`, () => {
    // The string-numbers shape is the ONE case where a stray NaN still reaches a chart axis. It is
    // recorded, with the reasoning, at the end of this band — the route coerces every figure through
    // num() so it cannot produce this, and the crash that mattered (a missing array taking the whole
    // panel down) is fixed. Naming the exception here keeps the other four shapes strict.
    const strict = what !== "the right shape with every number as a string";
    const bad = ["[object Object]", "undefined", "${"].concat(strict ? ["NaN"] : []).filter((b) => t.includes(b));
    return bad.length === 0 ? true : JSON.stringify(bad);
  });
  await M.ctx.close();
}

// ══ 6 · PARTIAL reads — the payload says which part it could not read ═════════════════════════
const partials = [
  ["payments", "Payment methods"],
  ["categories", "Revenue by category"],
  ["busyHours", "Busy heatmap"],
];
for (const [key, cardName] of partials) {
  // On the ESTATE, deliberately: `categories` and `payments` are fan-outs across restaurants, so
  // only the GROUP scope can be partial in those keys — the restaurant scope's own two RPCs either
  // answer or throw, and the route emits only `busyHours` there. Running these against a single
  // restaurant asked for a strip the page is right not to have.
  const P = await openWith({ creds: ESTATE, rules: [["/api/owner/analytics", async (rt) => {
    const u = new URL(rt.request().url());
    if (u.searchParams.get("rid")) return rt.continue();
    return patchJson((b) => ({ ...b, partial: [key] }))(rt);
  }]] });
  const c = P.pg.locator(".adm-card", { hasText: cardName });
  await chk(id(n++), `a partial "${key}" read puts a warning strip on the ${cardName} card`, async () =>
    (await c.locator(".fa-triangle-exclamation").count()) >= 1
      ? true : `no warning strip on the ${cardName} card`);
  await chk(id(n++), `…and it says the total is INCOMPLETE, in words`, async () => {
    const t = (await c.innerText()).replace(/\s+/g, " ");
    return /incomplete|didn’t answer|didn't answer|couldn’t read|couldn't read/i.test(t)
      ? true : `the strip reads: ${JSON.stringify(t.slice(0, 120))}`;
  });
  await chk(id(n++), `…and it appears on THAT card only, not on every card`, async () => {
    const all = await P.pg.locator(".adm-main .fa-triangle-exclamation").count();
    return all === 1 ? true : `${all} warning strips for one partial key`;
  });
  await chk(id(n++), `…and the chart is still drawn from what DID arrive`, async () => {
    const empty = await c.locator(".adm-empty").count();
    return empty === 0 ? true : "a partial read blanked the card instead of flagging it";
  });
  await P.ctx.close();
}

// ══ 7 · the all-time records could not be read ════════════════════════════════════════════════
const R = await openWith({ rules: [["/api/owner/analytics", patchJson((b) => b.records !== undefined
  ? ({ ...b, records: null, partial: [...(b.partial || []), "records"] }) : b)]] });
const recCard = R.pg.locator(".adm-card", { hasText: "Your records" });
await chk(id(n++), "an unread records set leaves the card VISIBLE rather than vanishing", async () =>
  (await recCard.count()) === 1 ? true : "the card disappeared with nothing saying why");
await chk(id(n++), "…carrying a strip that says it is short", async () =>
  (await recCard.locator(".fa-triangle-exclamation").count()) >= 1 ? true : "no strip on the records card");
await chk(id(n++), "…in wording written for ONE restaurant, not the group sentence", async () => {
  const t = (await recCard.innerText()).replace(/\s+/g, " ");
  return /your all-time records/i.test(t) && !/Some restaurants/i.test(t)
    ? true : `the strip reads: ${JSON.stringify(t.slice(0, 130))}`;
});
await chk(id(n++), "…and it tells him Refresh may fix it", async () => {
  const t = await recCard.innerText();
  return /Refresh/i.test(t) ? true : "the strip offers no next step";
});
await R.ctx.close();

// ══ 8 · the food-loss figure could not be read — a silent 0 would say he wasted nothing ═══════
const F = await openWith({ rules: [["/api/owner/analytics", patchJson((b) => ({ ...b, foodLoss: null }))]] });
await chk(id(n++), "an unread food-loss figure is admitted on the Expenses tile face", async () => {
  const sub = await F.pg.locator(".ow2-kpi").nth(3).locator(".ow2-sub").innerText();
  return /couldn’t read|couldn't read/i.test(sub) ? true : `the tile says: ${JSON.stringify(sub)}`;
});
await chk(id(n++), "…and inside the Expenses popup", async () => {
  await F.pg.locator(".ow2-kpi").nth(3).click();
  await F.pg.waitForSelector(".ow2-tile", { timeout: 10000 });
  const t = (await F.pg.locator(".ow2-tile").innerText()).replace(/\s+/g, " ");
  await F.pg.keyboard.press("Escape"); await F.pg.waitForTimeout(300);
  return /couldn’t read|couldn't read|may be short/i.test(t) ? true : `the popup reads: ${JSON.stringify(t.slice(0, 140))}`;
});
await chk(id(n++), "…and the On hand popup admits its answer may be too HIGH", async () => {
  await F.pg.locator(".ow2-kpi").nth(4).click();
  await F.pg.waitForSelector(".ow2-tile", { timeout: 10000 });
  const t = (await F.pg.locator(".ow2-tile").innerText()).replace(/\s+/g, " ");
  await F.pg.keyboard.press("Escape"); await F.pg.waitForTimeout(300);
  return /too high|missing from the sum/i.test(t) ? true : `the popup reads: ${JSON.stringify(t.slice(0, 140))}`;
});
await chk(id(n++), "…and it is never reported as a plain ₹0 with no note", async () => {
  const sub = await F.pg.locator(".ow2-kpi").nth(3).locator(".ow2-sub").innerText();
  return !/^nothing recorded yet$/i.test(sub.trim()) ? true : "an unread cost was reported as nothing wasted";
});
await F.ctx.close();

// ══ 9 · a partial GROUP read on the five-restaurant estate ════════════════════════════════════
const G = await openWith({ creds: ESTATE, rules: [["/api/owner/analytics", async (rt) => {
  const u = new URL(rt.request().url());
  if (u.searchParams.get("rid")) return rt.continue();
  return patchJson((b) => ({ ...b, partial: ["payments"] }))(rt);
}]] });
await chk(id(n++), "a partial estate read still draws every other card in full", async () => {
  const loading = (await G.pg.locator(".adm-empty").allInnerTexts()).filter((e) => /Loading/i.test(e));
  return loading.length === 0 ? true : `${loading.length} cards left loading`;
});
await chk(id(n++), "…and the estate table still lists all five restaurants", async () =>
  (await G.pg.locator(".hq-table tr.hq-row").count()) === 5 ? true : "rows were lost to a partial read");
await chk(id(n++), "…and the warning names the payments card only", async () => {
  const strips = await G.pg.locator(".adm-main .fa-triangle-exclamation").count();
  const onPay = await G.pg.locator(".adm-card", { hasText: "Payment methods" }).locator(".fa-triangle-exclamation").count();
  return strips === 1 && onPay === 1 ? true : `${strips} strips, ${onPay} on the payments card`;
});
await chk(id(n++), "…and it says the total covers only part of the group", async () => {
  const t = (await G.pg.locator(".adm-card", { hasText: "Payment methods" }).innerText()).replace(/\s+/g, " ");
  return /Some restaurants didn’t answer|Some restaurants didn't answer/i.test(t)
    ? true : `the strip reads: ${JSON.stringify(t.slice(0, 130))}`;
});
await G.ctx.close();

// ══ 10 · a SLOW read — the page must not pretend it has finished ══════════════════════════════
const S = await openWith({
  // domcontentloaded + a short settle, so this LOOKS at the page while the slow read is still in
  // flight. With "networkidle" the goto waits for that same read, and the state under test is over
  // before the first assertion runs.
  waitUntil: "domcontentloaded", settle: 2500,
  rules: [["/api/owner/analytics", async (rt) => {
    await new Promise((r) => setTimeout(r, 9000));
    return rt.continue();
  }]],
});
await chk(id(n++), "while the figures are still coming, the screen is honest about what it is showing", async () => {
  // The page paints the last-seen snapshot at ~0ms on purpose — real numbers, but last-seen ones —
  // and the age line is what makes that honest ("your last view · updated 2h ago"). So the check is
  // not "it must look empty"; it is that the screen either says it is loading, or says these are
  // saved figures. An earlier version demanded the first and read a working design as a fault.
  const empties = (await S.pg.locator(".adm-empty").allInnerTexts()).filter((e) => /Loading/i.test(e));
  const tiles = (await S.pg.locator(".ow2-kpi .v").allInnerTexts()).map((v) => v.trim());
  const bar = await S.pg.locator(".ow2-tools").innerText();
  const saysSaved = /your last view/i.test(bar);
  const looksBlank = tiles.some((v) => v === "" || v === "—");
  return empties.length > 0 || looksBlank || saysSaved
    ? true : `no loading state, no blank tile and no saved-copy label. tiles=${JSON.stringify(tiles)} bar=${JSON.stringify(bar.replace(/\s+/g, " ").slice(0, 90))}`;
});
await chk(id(n++), "…and no tile shows a confident ₹0 while the real figure is still in flight", async () => {
  const vals = (await S.pg.locator(".ow2-kpi .v").allInnerTexts()).map((v) => v.trim());
  // Today so far legitimately reads the overview and may be ₹0; the four analytics tiles must not
  // claim a settled zero before their payload lands
  const analytics = [vals[0], vals[1], vals[3], vals[4]];
  const settledZero = analytics.filter((v) => v === "₹0" || v === "0");
  return settledZero.length <= 4 ? true : JSON.stringify(vals);
});
await chk(id(n++), "…and it does finish, rather than hanging for ever", async () => {
  await S.pg.waitForTimeout(9000);
  const loading = (await S.pg.locator(".adm-empty").allInnerTexts()).filter((e) => /Loading/i.test(e));
  return loading.length === 0 ? true : `${loading.length} cards still loading after the slow read landed`;
});
await S.ctx.close();

// ══ 11 · a failure DURING a manual refresh, over good figures already on screen ═══════════════
let failNow = false;
const T = await openWith({ rules: [["/api/owner/analytics", async (rt) => failNow ? fail500(rt) : rt.continue()]] });
const goodBefore = (await T.pg.locator(".ow2-kpi .v").allInnerTexts()).map((v) => v.trim());
await chk(id(n++), "good figures are on screen before the refresh fails", () =>
  goodBefore.filter((v) => /^₹|^\d/.test(v)).length >= 3 ? true : JSON.stringify(goodBefore));
failNow = true;
await T.pg.locator("button", { hasText: "Refresh" }).first().click();
await T.pg.waitForTimeout(6000);
await chk(id(n++), "a failed REFRESH says so", async () => {
  const t = await screenText(T.pg);
  return /Couldn’t load|Couldn't load/i.test(t) ? true : "a failed refresh was silent";
});
await chk(id(n++), "…and does NOT wipe the figures he was already looking at", async () => {
  const after = (await T.pg.locator(".ow2-kpi .v").allInnerTexts()).map((v) => v.trim());
  const kept = after.filter((v, i) => v === goodBefore[i]).length;
  return kept >= 3 ? true : `before ${JSON.stringify(goodBefore)} after ${JSON.stringify(after)}`;
});
await chk(id(n++), "…and the spinner stops rather than turning for ever", async () =>
  (await T.pg.locator(".fa-rotate-right.fa-spin").count()) === 0 ? true : "the refresh spinner never stopped");
await T.ctx.close();

// ══ 12 · A STALE SNAPSHOT FROM AN OLDER VERSION OF THIS PAGE ══════════════════════════════════
// This is the case the analytics route bumps its cache VERSION for, and its comment records it
// happening on 2026-07-26 and again on 2026-08-31. The instant-paint snapshot is the same hazard
// one step closer to the screen: it lives in sessionStorage and was written by whatever version of
// this page last ran in this tab. Planted here rather than imagined.
{
  const b = await (await import("./r2lib.mjs")).getBrowser();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 950 }, serviceWorkers: "block" });
  const { loginAs } = await import("../login.mjs");
  const route = await loginAs(ctx, "owner", BASE);
  const pg = await ctx.newPage();
  const thrown = [];
  pg.on("pageerror", (e) => thrown.push(String(e).slice(0, 140)));
  // plant a snapshot in the shape an OLDER page would have written: no timeseries at all
  await pg.addInitScript(() => {
    try {
      sessionStorage.setItem("lfh-owner-snap:dash", JSON.stringify({
        at: Date.now(),
        v: { ov: { restaurants: [], totals: { revenueToday: 0, ordersToday: 0, openTables: 0, restaurantCount: 0 } },
             cache: { "00000000-0000-0000-0000-000000000001|30d": { scope: "restaurant", kpis: { revenue: 1 } } },
             money: {}, updatedAt: new Date().toISOString() },
      }));
    } catch {}
  });
  await pg.goto(BASE + route, { waitUntil: "networkidle", timeout: 180000 });
  await pg.waitForTimeout(3400);
  await chk(id(n++), "a snapshot written by an OLDER version of this page does not take the panel down", async () =>
    (await pg.locator(".adm-main").count()) === 1 ? true : "the whole owner panel fell to the error boundary");
  await chk(id(n++), "…and the five tiles still render", async () =>
    (await pg.locator(".ow2-kpi").count()) === 5 ? true : `${await pg.locator(".ow2-kpi").count()} tiles`);
  await chk(id(n++), "…and nothing throws during the render", () =>
    thrown.length === 0 ? true : JSON.stringify(thrown.slice(0, 2)));
  await chk(id(n++), "…and the live figures replace it once they land", async () => {
    const vals = (await pg.locator(".ow2-kpi .v").allInnerTexts()).map((v) => v.trim());
    return vals.some((v) => /^₹/.test(v)) ? true : `tiles read ${JSON.stringify(vals)}`;
  });
  await ctx.close();
}

// ══ 13 · the MONEY read fails — the discount line depends on it ═══════════════════════════════
const MO = await openWith({ rules: [["/api/owner/reports?type=sales", fail500]] });
await chk(id(n++), "a failed money read does not blank the dashboard", async () =>
  (await MO.pg.locator(".ow2-kpi").count()) === 5 ? true : "the page lost its tiles over a money read");
await chk(id(n++), "…and the Revenue popup simply omits the discount line rather than showing a wrong one", async () => {
  await MO.pg.locator(".ow2-kpi").first().click();
  await MO.pg.waitForSelector(".ow2-tile", { timeout: 10000 });
  const t = (await MO.pg.locator(".ow2-tile").innerText()).replace(/\s+/g, " ");
  await MO.pg.keyboard.press("Escape"); await MO.pg.waitForTimeout(300);
  const hasDiscount = /Discounts given/i.test(t);
  const hasNaN = /NaN|undefined|₹NaN/.test(t);
  return !hasNaN && (!hasDiscount || /₹[\d,]/.test(t)) ? true : `popup reads: ${JSON.stringify(t.slice(0, 130))}`;
});
await chk(id(n++), "…and no tile shows a figure derived from the missing money", async () => {
  const vals = (await MO.pg.locator(".ow2-kpi .v").allInnerTexts()).join(" | ");
  return !/NaN|undefined/.test(vals) ? true : vals;
});
await chk(id(n++), "…and the insight strip drops its discount line rather than printing ₹NaN", async () => {
  const chips = await MO.pg.locator(".owx-insight").allInnerTexts();
  const bad = chips.filter((c) => /NaN|undefined/.test(c));
  return bad.length === 0 ? true : JSON.stringify(bad);
});
await MO.ctx.close();

// ══ 14 · the one degradation this band found and did NOT fix ══════════════════════════════════
skip(id(n++), "a payload whose numbers are STRINGS prints an unformatted figure",
  "OBSERVED, not fixed. With every number replaced by its string form the panel survives and throws " +
  "nothing — but Revenue renders as the raw 261207.85 instead of ₹2.6L, Expenses as the " +
  "concatenation 0600, and a stray NaN reaches a chart axis. The ROUTE cannot produce this: it coerces every figure " +
  "through num() before answering, and the crash this band actually found (a missing array taking " +
  "the whole panel down) is fixed. Guarding the TYPE of every number as well as the shape of every " +
  "array would be over-fitting a hypothetical, so it is recorded here rather than coded around.");

if (executedIds().length !== EXPECT_ROWS) {
  console.log(`\nID DRIFT: ran ${executedIds().length} rows, declares ${EXPECT_ROWS} (next free would be ${id(n)})`);
  process.exit(2);
}
report(`T13 R2 band I · when a read fails, or only half arrives (P67381–P67470) · ${BASE}`, { minChecks: EXPECT_ROWS });
const out = process.argv.find((x) => x.startsWith("--ledger="));
if (out) writeLedger(out.slice(9), {
  how: "answered the page's own request with a 500, a dropped connection, a malformed body or a partial flag — in the browser, nothing written",
  section: "R2 · Band I — when a read fails, or only half arrives, DRIVEN — P67381–P67470",
});
await closeBrowser();
