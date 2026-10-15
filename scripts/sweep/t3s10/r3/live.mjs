// scripts/sweep/t3s10/r3/live.mjs — ROUND 3, THE LIVE HALF: terminal 3's screens, driven like a diner.
//
//   (faultProxy on :5499, the app on :4403 with NEXT_PUBLIC_SUPABASE_URL=http://localhost:5499)
//   node scripts/sweep/t3s10/r3/live.mjs [--areas L1,L2,L3,L4,L5,L6]
//
//   L1  every screen × both skins × four widths: nothing spills sideways, every text readable (WCAG AA),
//       no leaked code ("undefined", "NaN", "[object", "${"), taps big enough, no page error
//   L2  the phone's back button and Escape close every popup; the score pill shows the pick (item 26)
//   L3  item 29 for real: with the phone's own table check blinded, the DATABASE refuses table 45 and the
//       bell popup shows its sentence
//   L4  item 31 for real: the bill with the settings read failing says "+ any tax", then the real GST
//   L5  the idle phone: every request an open menu, bill and live tab make in 75 s
//   L6  one real order and one real waiter call through the real database, one failure injected each, then
//       put back (cancelled, archived, session closed, call deleted — by their own ids)
// Writes only to French House, and only in L6. Aangan is never written to.
import { check, runAll } from "./h.mjs";

import { BASE, FH_PATH, WIDTHS, LEAK, page, open, addTwo, measure, closeBrowser } from "./livelib.mjs";
const SCREENS = [
  ["menu: the strip, the basket pill, the bell and the saved chip", null, ".order-tracker, .mini-cart, .chef-call, .gob-chip"],
  ["the bell popup", async (p) => { await p.locator(".chef-call").evaluate((el) => el.click()); await p.waitForTimeout(900); }, "#chef-popup"],
  ["the dish popup (Add to Order)", async (p) => { await p.evaluate(() => window.dispatchEvent(new CustomEvent("lfh:open-order-confirm", { detail: { item: { id: "probe", title: "Caffè Latte", price: "4.50", image: "" }, options: [{ name: "Milk", type: "single", choices: [{ label: "Whole", price: 0 }, { label: "Oat", price: 0.5 }] }], allergens: ["dairy"] } }))); await p.locator(".order-confirm").waitFor({ timeout: 8000 }); await p.waitForTimeout(600); }, ".order-confirm"],
  ["the bill (Current bill)", async (p) => { await addTwo(p); await p.evaluate(() => window.dispatchEvent(new Event("lfh:open-cart"))); await p.waitForTimeout(1500); }, "#cart-panel"],
  ["the bill (Live status)", async (p) => { await p.evaluate(() => window.dispatchEvent(new Event("lfh:open-cart"))); await p.waitForTimeout(1200); await p.locator(".cart-tabs button", { hasText: "Live status" }).click(); await p.waitForTimeout(2500); }, "#cart-panel"],
  ["the saved list (On this phone)", async (p, ctx) => { await addTwo(p); await p.evaluate(() => window.dispatchEvent(new Event("lfh:open-cart"))); await p.waitForTimeout(1000); await p.locator("#cart-table").fill("4"); await ctx.setOffline(true); await p.locator(".cart-foot .btn-gold").click(); await p.waitForTimeout(1500); await p.evaluate(() => window.dispatchEvent(new Event("lfh:close-all"))); await p.waitForTimeout(600); await p.locator(".gob-chip").click(); await p.waitForTimeout(800); }, ".gob-sheet"],
  ["the dish page's Rate tab (stars and score)", async (p) => { await p.locator(".review-tab-btn").first().click(); await p.waitForTimeout(800); await p.locator(".sr-toggle").nth(2).click(); await p.waitForTimeout(2200); }, ".review-form", "/r/french-house/item/espresso?cat=coffee"],
];
let ln = 1;
for (const [name, go, sel, path] of SCREENS) {
  check(`R3-L1${String(ln++).padStart(2, "0")}`, "L1", `${name} — at 360/390/768/1280 px, dark and light: readable, no leaked code, no sideways spill, taps ≥ 40 px, no page error`, async () => {
    const bad = []; let measured = 0;
    for (const [w, h, touch] of WIDTHS) for (const skin of ["dark", "light"]) {
      const { ctx, p, errs } = await page({ w, h, touch, skin });
      try {
        await open(p, path); if (go) await go(p, ctx);
        const m = await measure(p, sel); measured += m.n;
        if (!m.found) bad.push(`${w}/${skin}: the screen did not appear`);
        if (m.bad.length) bad.push(`${w}/${skin}: ${m.bad.length} unreadable (${m.bad.slice(0, 2).map((r) => `"${r.text}" ${r.ratio}:1`).join(", ")})`);
        if (LEAK.test(m.text)) bad.push(`${w}/${skin}: leaked code "${(m.text.match(LEAK) || [])[0]}"`);
        if (m.spill) bad.push(`${w}/${skin}: the page spills sideways`);
        if (m.small.length) bad.push(`${w}/${skin}: small taps ${m.small.slice(0, 3).join(", ")}`);
        if (errs.length) bad.push(`${w}/${skin}: page error ${errs[0]}`);
        await p.evaluate(() => new Promise((r) => { const q = indexedDB.deleteDatabase("lfh_guest_outbox"); q.onsuccess = q.onerror = q.onblocked = () => r(); })).catch(() => {});
      } finally { await ctx.close(); }
    }
    return { ok: !bad.length, note: bad.slice(0, 4).join(" · ") || `${measured} text pieces over 8 views` };
  });
}

const areas = (process.argv.includes("--areas") ? process.argv[process.argv.indexOf("--areas") + 1] : "L1,L2,L3,L4,L5,L6").split(",");
// L2–L6 live in ./live2.mjs — load it whenever any of them is asked for (not only when L2 is)
if (areas.some((a) => /^L[2-6]/.test(a))) await import("./live2.mjs");
const up = await fetch(BASE + FH_PATH).then((r) => r.status).catch(() => 0);
if (up !== 200) { console.log(`nothing answered on ${BASE} — start the app first (see the header)`); process.exit(2); }
const r = await runAll({ areas });
await closeBrowser();
process.stdout.write("", () => process.exit(r.bad ? 1 : 0));
