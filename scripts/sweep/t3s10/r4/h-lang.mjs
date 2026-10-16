// Round 4 · H — EVERY GUEST LANGUAGE. The ordering screens are English on purpose (owner, R23 — not raised
// as work); what is checked is that a diner who browses in German, French, Arabic, Hindi or Korean can
// still order: every ordering screen opens with no page error, no leaked code text, nothing spilling off a
// 360 px phone, and Arabic's right-to-left page does not push a popup off the screen.
import { check } from "./h4.mjs";
import { page, open, addDish, openBill, closeAll, LEAK } from "./live4.mjs";

const LANGS = [["en", "English"], ["de", "German"], ["fr", "French"], ["ar", "Arabic"], ["hi", "Hindi"], ["ko", "Korean"]];
async function catchAll(p) {
  await p.route("**/api/guest/**", (r) => r.fulfill({ status: 200, contentType: "application/json", body: '{"ok":false,"reason":"sold_out","item":"round-4 test"}' }));
  await p.route("**/rest/v1/rpc/lfh_call_waiter_table*", (r) => r.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' }));
  await p.route("**/rest/v1/rpc/lfh_place_order*", (r) => r.abort());
}
const measure = (p, sel) => p.evaluate((sel) => {
  const box = document.querySelector(sel); if (!box) return { missing: true };
  const r = box.getBoundingClientRect();
  return { text: box.innerText, spill: document.documentElement.scrollWidth - innerWidth, off: Math.round(Math.max(0, -r.left, r.right - innerWidth)) };
}, sel);
let i = 0;
for (const [code, name] of LANGS) {
  i++;
  check(`R4-H0${i}`, "H", `menu in ${name}: the bill, the bell popup and the dish popup all open on a 360 px phone — no page error, no leaked code, nothing off the screen`, async () => {
    const { ctx, p, errs } = await page({ w: 360, h: 780, lang: code });
    const bad = [];
    try {
      await catchAll(p); await open(p); await addDish(p, 0); await addDish(p, 6);
      const steps = [
        ["bill", "#cart-panel", () => openBill(p)],
        ["bell", "#chef-popup", async () => { await closeAll(p); await p.locator(".chef-call").evaluate((el) => el.click()); await p.waitForTimeout(900); }],
        ["dish popup", ".order-confirm", async () => { await closeAll(p); await p.locator(".customize-btn").first().evaluate((b) => { b.scrollIntoView({ block: "center" }); b.click(); }); await p.waitForTimeout(1000); }],
      ];
      for (const [k, sel, go] of steps) {
        await go(); const m = await measure(p, sel);
        if (m.missing) { bad.push(`${k} did not open`); continue; }
        if (LEAK.test(m.text)) bad.push(`${k} shows "${(m.text.match(LEAK) || [])[0]}"`);
        if (m.spill > 1) bad.push(`${k}: page ${m.spill}px wider than the phone`);
        if (m.off > 1) bad.push(`${k}: ${m.off}px of it off the screen`);
      }
      const dir = await p.evaluate(() => document.documentElement.dir || getComputedStyle(document.documentElement).direction);
      if (errs.length) bad.push(`page error ${errs[0]}`);
      return { ok: !bad.length, note: bad.join(" · ") || `3 screens clean · page direction ${dir}` };
    } finally { await ctx.close(); }
  });
}
