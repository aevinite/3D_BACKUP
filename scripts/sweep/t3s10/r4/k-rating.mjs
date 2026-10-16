// Round 4 · K — A REAL RATING, AND A CHANGED MIND. A diner rates a French House dish 4 stars with a note,
// then changes it to 2: there must be ONE review from that phone, saying 2, under the name given — and the
// dish page must say it is theirs. The review is then deleted by its own id (the only row this area writes).
// Then every way the save can fail is played back to the page, which must answer in words, never a code.
import { check } from "./h4.mjs";
import { rest, FH_ID } from "./db.mjs";
import { page, open } from "./live4.mjs";

const SLUG = "pink-pineapple-smoothie";   // a quiet dish, so a review of ours never sits on a busy page for long
async function rate(p, stars, note, name) {
  await p.locator(".review-tab-btn").first().click(); await p.waitForTimeout(600);
  await p.locator(".sr-toggle").nth(stars - 1).click(); await p.waitForTimeout(500);
  const box = p.locator(".review-form textarea").first(); await box.fill(note);
  const nm = p.locator('.review-form input[type="text"]').first(); if (await nm.count()) await nm.fill(name);
  await p.locator("#submit-review").click(); await p.waitForTimeout(2500);
}
check("R4-K01", "K", "rate a dish 4 stars, then change to 2: ONE review from this phone, saying 2, with the note and name given — shown on the page as the diner's own", async () => {
  const FH = await FH_ID(); const { ctx, p, errs } = await page({ w: 390 }); let device = null;
  try {
    await open(p, `/r/french-house/item/${SLUG}`);
    device = await p.evaluate(() => localStorage.getItem("lfh_device_id"));
    await rate(p, 4, "Round-4 test review — removed straight away", "R4 Tester");
    await p.reload({ waitUntil: "domcontentloaded" }); await p.locator(".review-tab-btn").first().waitFor({ timeout: 60000 }); await p.waitForTimeout(1500);
    device = device || await p.evaluate(() => localStorage.getItem("lfh_device_id"));
    await rate(p, 2, "Changed my mind — round-4 test", "R4 Tester");
    const rows = (await rest(`reviews?restaurant_id=eq.${FH}&item_slug=eq.${SLUG}&device_id=eq.${encodeURIComponent(device)}&select=id,stars,name,comment`)).json || [];
    await p.locator(".review-tab-btn").nth(1).click(); await p.waitForTimeout(800);   // the Reviews tab lists them
    const page_ = (await p.locator("body").innerText()).replace(/\s+/g, " ");
    const shown = /Changed my mind/.test(page_);
    return { ok: rows.length === 1 && rows[0].stars === 2 && rows[0].name === "R4 Tester" && /Changed my mind/.test(rows[0].comment) && shown && !errs.length, note: `${rows.length} review(s) from this phone · stars ${rows[0]?.stars} · name "${rows[0]?.name}" · on the page: ${shown}${errs.length ? " · " + errs[0] : ""}` };
  } finally {
    await ctx.close();
    if (device) { const rows = (await rest(`reviews?restaurant_id=eq.${FH}&item_slug=eq.${SLUG}&device_id=eq.${encodeURIComponent(device)}&select=id`)).json || []; for (const r of rows) await rest(`reviews?id=eq.${r.id}&restaurant_id=eq.${FH}`, { method: "DELETE" }); }
  }
});
check("R4-K02", "K", "the review is gone afterwards: no round-4 review is left on any French House dish", async () => {
  const FH = await FH_ID();
  const rows = (await rest(`reviews?restaurant_id=eq.${FH}&name=eq.R4%20Tester&select=id`)).json || [];
  return { ok: Array.isArray(rows) && !rows.length, note: `${rows.length} left` };
});
const FAILS = [
  ["the database refuses the stars", { status: 200, body: '{"ok":false,"reason":"bad_stars"}' }],
  ["the database says the dish is gone", { status: 200, body: '{"ok":false,"reason":"no_such_item"}' }],
  ["the database errors", { status: 400, body: '{"code":"42501","message":"permission denied for function lfh_submit_review"}' }],
  ["the restaurant is too busy to answer", { status: 503, body: "upstream timeout" }],
];
let k = 2;
for (const [name, ans] of FAILS) {
  k++;
  check(`R4-K0${k}`, "K", `a rating when ${name}: the diner is told in words that it was not saved — no code, no database text — and the page keeps working`, async () => {
    const { ctx, p, errs } = await page({ w: 390 });
    await p.addInitScript(() => { window.__r4t = []; window.addEventListener("lfh:toast", (e) => window.__r4t.push(`${e.detail?.message || ""} · ${e.detail?.subtitle || ""}`)); });
    try {
      await p.route("**/rest/v1/rpc/lfh_submit_review*", (r) => r.fulfill({ status: ans.status, contentType: "application/json", body: ans.body }));
      await open(p, `/r/french-house/item/${SLUG}`); await rate(p, 3, "never saved", "R4");
      const said = await p.evaluate(() => (window.__r4t || []).join(" / "));
      const text = (await p.locator("body").innerText()).replace(/\s+/g, " ");
      const leaked = /bad_stars|no_such_item|42501|permission denied|upstream|lfh_/i.test(said + " " + text);
      return { ok: /couldn't save|not saved|try again/i.test(said) && !leaked && !errs.length, note: `told: "${said}"${leaked ? " · SHOWS A CODE" : ""}${errs.length ? " · " + errs[0] : ""}` };
    } finally { await ctx.close(); }
  });
}
